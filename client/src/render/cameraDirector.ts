// 카메라 감독 (순수, Phaser 없음): 이번 프레임에 무엇을 따라갈지 정하고(내 캐릭터 · 관전 중인 동료), 괴물 앞당김을 계산해
// 카메라(render/camera.ts CameraRig)를 한 걸음 옮긴 뒤 흔들림을 더하고 기기 픽셀 격자에 맞춘 창을 돌려준다.
// 시점 돌려보기(관전)는 생존자가 수감 · 사망 · 탈출했을 때만: 동료 화면으로 옮겨 본다. 생존자 화면은 세 명의 시야를 합쳐
// 보므로 동료 자리로 창을 옮겨도 서버가 이미 보낸 것만 보인다(새 정보가 없다). 사망 · 탈출하면 자동으로 동료를 따라간다
import {
  MAP_H,
  MAP_W,
  TILE_PX,
  monsterConeShape,
  type Balance,
  type Role,
  type SurvivorStatus,
  type SurvivorView,
  type Vec2,
} from '@decoy/shared';
import {
  CAMERA,
  CameraRig,
  ScreenShake,
  coneBox,
  dipAlpha,
  lookAhead,
  snapView,
  type ViewRect,
} from './camera';

export interface DirectorInput {
  nowMs: number;
  dtMs: number;
  role: Role;
  selfId: string;
  /** 예측한 내 자리 (없으면 null) */
  me: { x: number; y: number; face: number } | null;
  /** 내 생존자 상태 (괴물이면 null) */
  myStatus: SurvivorStatus | null;
  /** 보간한 다른 생존자 (생존자 화면: 팀원) */
  survivors: ReadonlyMap<string, SurvivorView>;
  /** 카드 순서 생존자 id (나 포함, 생존자 화면) */
  team: readonly string[];
  balance: Balance;
  /** 괴물 화면: 내 시야 모드 보간값 (0 탐색 ~ 1 추적) */
  blend: number;
  /** 보이는 창 크기 (타일) */
  viewW: number;
  viewH: number;
  /** 기기 px / 타일 (창 자리를 기기 픽셀 격자에 맞춘다) */
  devPerTile: number;
}

/** 시점을 돌려볼 수 있는 상태 (수감 · 사망 · 탈출) */
export function canSpectate(status: SurvivorStatus | null): boolean {
  return status === 'imprisoned' || status === 'dead' || status === 'escaped';
}

/** 맵 위에 있는 동료 (관전 대상 후보: 자유 · 수감, 카드 순서) */
export function spectateCandidates(
  team: readonly string[],
  selfId: string,
  survivors: ReadonlyMap<string, SurvivorView>,
): string[] {
  const out: string[] = [];
  for (const id of team) {
    if (id === selfId) continue;
    const s = survivors.get(id);
    if (s && (s.status === 'free' || s.status === 'imprisoned')) out.push(id);
  }
  return out;
}

/**
 * 이번 프레임에 볼 동료 (null = 내 시점). 돌려볼 수 없는 상태면 늘 null. 요청한 동료가 후보면 그 동료, 아니면
 * 사망 · 탈출일 때만 첫 후보(자유인 동료 먼저)를 자동으로 본다 — 수감 중에는 내 자리(감옥)가 기본이다
 */
export function resolveSpectate(
  requested: string | null,
  status: SurvivorStatus | null,
  candidates: readonly string[],
  survivors: ReadonlyMap<string, SurvivorView>,
): string | null {
  if (!canSpectate(status)) return null;
  if (requested !== null && candidates.includes(requested)) return requested;
  if (status === 'imprisoned') return null;
  const free = candidates.find((id) => survivors.get(id)?.status === 'free');
  return free ?? candidates[0] ?? null;
}

export class CameraDirector {
  private readonly rig: CameraRig;
  readonly shake = new ScreenShake();
  /** 관전 요청 (카드 · 숫자 키: 동료 id, null = 내 시점) */
  private requested: string | null = null;
  /** 이번 프레임에 관전 중인 동료 */
  spectating: string | null = null;
  /** 이번 프레임에 따라간 대상 */
  follow: string | null = null;
  canSpectate = false;
  /** 괴물 앞당김 목표 (lookAhead 원값, 타일) */
  readonly look: Vec2 = { x: 0, y: 0 };
  /** 실제 앞당김 (창 가운데 − 괴물, 타일) */
  readonly lookApplied: Vec2 = { x: 0, y: 0 };
  cuts = 0;
  private dipAt: number | null = null;
  private readonly shakeOut: Vec2 = { x: 0, y: 0 };
  /** 이번 프레임의 창 (기기 픽셀 격자) */
  readonly view: ViewRect = { x: 0, y: 0, w: MAP_W, h: MAP_H };

  constructor(viewW: number, viewH: number) {
    this.rig = new CameraRig(viewW, viewH);
  }

  /** 관전할 동료를 고른다 (id, 내 id · null이면 내 시점으로) */
  request(id: string | null): void {
    this.requested = id;
  }

  get requestedId(): string | null {
    return this.requested;
  }

  /** 다음 프레임에 목표로 바로 옮긴다 (판 시작) */
  reset(): void {
    this.rig.reset();
    this.dipAt = null;
  }

  update(i: DirectorInput): ViewRect {
    this.rig.w = i.viewW;
    this.rig.h = i.viewH;
    // 1) 따라갈 대상: 관전 중인 동료 > 내 캐릭터
    let target: Vec2 | null = null;
    let tau: number = CAMERA.followTauS;
    let look: Vec2 | null = null;
    this.canSpectate = i.role !== 'monster' && canSpectate(i.myStatus);
    if (i.role !== 'monster') {
      const cands = spectateCandidates(i.team, i.selfId, i.survivors);
      if (this.requested === i.selfId) this.requested = null;
      const spec = resolveSpectate(this.requested, i.myStatus, cands, i.survivors);
      // 돌려볼 수 없는 상태가 되면(구조됨) 요청을 지운다: 다음 수감에서 다시 내 시점으로 시작
      if (!this.canSpectate) this.requested = null;
      this.spectating = spec;
      const s = spec !== null ? i.survivors.get(spec) : undefined;
      if (s) {
        target = { x: s.x, y: s.y };
        tau = CAMERA.spectateTauS;
        this.follow = spec;
      }
    } else {
      this.spectating = null;
    }
    if (!target && i.me) {
      target = { x: i.me.x, y: i.me.y };
      this.follow = i.selfId;
      // 괴물: 조준 방향으로 앞당긴다 (지금 부채꼴 ∪ 근접 원이 창 안에 들게)
      if (i.role === 'monster') {
        const shape = monsterConeShape(i.balance, i.blend);
        const box = coneBox(i.me.face, shape.arc, shape.range, i.balance.monster.nearVisionRadius);
        look = lookAhead(box, i.viewW, i.viewH, CAMERA.lookMargin);
        this.look.x = look.x;
        this.look.y = look.y;
      }
    }
    if (!target) {
      // 따라갈 것이 없으면(아직 자리가 없음) 지난 가운데
      target = { x: this.rig.center.x, y: this.rig.center.y };
      this.follow = null;
    }
    const f = this.rig.update(i.dtMs, { x: target.x, y: target.y, look, tauS: tau, keepInside: true });
    if (f.cut) {
      this.cuts += 1;
      this.dipAt = i.nowMs;
    }
    // 2) 흔들림 (월드만) → 맵 안 → 기기 픽셀 격자
    const sh = this.shake.offset(i.nowMs, this.shakeOut);
    const maxX = Math.max(0, MAP_W - i.viewW);
    const maxY = Math.max(0, MAP_H - i.viewH);
    const x = Math.max(0, Math.min(maxX, f.view.x + sh.x));
    const y = Math.max(0, Math.min(maxY, f.view.y + sh.y));
    // 격자에 맞추되 맵 끝을 넘지 않게 (반올림이 끝을 반 기기 px 넘으면 Canvas 합성 영역이 창을 못 덮어 매 프레임 다시 합성한다)
    const k = i.devPerTile;
    this.view.x = k > 0 ? Math.min(snapView(x, k), Math.floor(maxX * k + 1e-9) / k) : x;
    this.view.y = k > 0 ? Math.min(snapView(y, k), Math.floor(maxY * k + 1e-9) / k) : y;
    this.view.w = i.viewW;
    this.view.h = i.viewH;
    // 실제 앞당김 (창 가운데 − 괴물: 감쇠 · 가장자리 · 맵 자르기 · 흔들림 뒤)
    if (i.role === 'monster' && i.me) {
      this.lookApplied.x = this.view.x + i.viewW / 2 - i.me.x;
      this.lookApplied.y = this.view.y + i.viewH / 2 - i.me.y;
    } else {
      this.lookApplied.x = 0;
      this.lookApplied.y = 0;
    }
    return this.view;
  }

  /** 잘라 옮긴 뒤 어두워짐 알파 (0이면 없음) */
  dip(nowMs: number): number {
    if (this.dipAt === null) return 0;
    const a = dipAlpha(nowMs - this.dipAt);
    if (a <= 0 && nowMs - this.dipAt > CAMERA.dipOutMs) this.dipAt = null;
    return a;
  }
}

/** 기기 px / 타일 (월드 배율 × 백버퍼 배율) */
export function devPerTile(worldScale: number, zoom: number): number {
  return TILE_PX * worldScale * zoom;
}
