// 터치 입력 (M11, MOBILE_PLAN M11 5번 조작 규칙). DOM 없는 순수 상태 기계: 손가락별 추적 · 데드존 · 조준 스틱 발사 대기.
// 터치 화면(ui/touchControls.ts)이 손가락 이벤트를 스틱 반지름으로 정규화해 넣고(TouchFeed),
// InputSampler(input.ts)가 입력 프레임마다 읽는다(TouchSource). 보내는 형식은 키보드 · 마우스와 같은 InputFrame이다.
// 시각은 인자로 받는다(performance · window를 쓰지 않는다 — 단위 테스트에서 시간을 정한다).
import { BTN, angleDiff } from '@decoy/shared';

/** 조작 수치 (판정과 무관한 입력 해석 값이라 balance.json이 아니라 여기 둔다. DECISIONS M11) */
export const TOUCH = {
  /** 스틱 데드존 (스틱 반지름 대비) */
  deadZone: 0.15,
  /** 발사 대기: 예측 face가 고정 각도 θ에서 이만큼 안이면 바로 공격 (라디안, 10°) */
  aimTolerance: (10 * Math.PI) / 180,
  /** 발사 대기 최대 시간 (ms). 지나면 face가 덜 돌았어도 공격 */
  maxFireWaitMs: 350,
  /** 조준 스틱 짧은 탭 (ms): 데드존을 벗어나지 않고 이 안에 떼면 지금 방향으로 공격 */
  shortTapMs: 250,
} as const;

/** 스틱 종류: 왼쪽 이동, 오른쪽 조준(괴물), 돌진 버튼을 끌어 만든 작은 스틱(괴물) */
export type StickKind = 'move' | 'aim' | 'dash';

/** 입력 프레임마다 InputSampler가 넘기는 상황 (예측 상태 · 마지막 스냅샷에서) */
export interface TouchFrameCtx {
  nowMs: number;
  /** 예측한 내 바라보는 방향 (라디안) */
  face: number;
  /** 지금 공격을 시작할 수 있는가 (쿨타임 0, 시작 대기 · 기절 · 돌진 · 준비 중 아님 — actionSlots와 같은 조건) */
  canAttack: boolean;
  /** 지금 돌진할 수 있는가 */
  canDash: boolean;
}

/**
 * InputSampler가 읽는 쪽. 한 입력 프레임에서 **takePressed(ctx)를 먼저**, 그다음 aimAngle(ctx)를 부른다
 * (발사 대기에서 공격을 내보낸 프레임까지 aim = θ가 되게)
 */
export interface TouchSource {
  /** 이동 벡터 (길이 0 또는 1, 방향 360°) */
  moveVector(): { x: number; y: number };
  /** 누르고 있는 버튼 비트 (BTN) */
  heldBits(): number;
  /** 새로 눌린 버튼 비트를 꺼내고 비운다. ctx로 발사 대기를 진행한다 (조건이 차면 ATTACK · DASH를 여기서 낸다) */
  takePressed(ctx: TouchFrameCtx): number;
  /** 보낼 조준 각도 (라디안). null = 터치가 조준을 정하지 않음(마우스 조준을 쓴다, 생존자) */
  aimAngle(ctx: TouchFrameCtx): number | null;
  /** 모든 손가락 · 발사 대기 · 눌림을 비운다 (blur · 숨김 · 회전 · 결과 · 관전 · 세로) */
  reset(): void;
}

/**
 * 터치 화면이 넣는 쪽. 스틱 좌표는 스틱 중심 기준, 스틱 반지름으로 나눈 값(길이 1 = 가장자리, 넘으면 1로 자른다).
 * 화면 y는 아래가 +다(게임 좌표와 같다)
 */
export interface TouchFeed {
  /** 손가락이 스틱에 닿음 (이동 · 돌진은 누른 자리가 중심, 조준 스틱은 고정 중심) */
  stickStart(pointerId: number, kind: StickKind, nowMs: number): void;
  stickMove(pointerId: number, nx: number, ny: number): void;
  /** 손가락을 뗌 (조준 · 돌진은 규칙에 따라 발사 대기로 가거나 취소) */
  stickEnd(pointerId: number, nowMs: number): void;
  /** 손가락이 사라짐 (pointercancel · lostpointercapture): 이 손가락의 효과를 버린다. 발사하지 않는다 */
  stickCancel(pointerId: number): void;
  /** 탭 버튼 (포효 · 시야 모드 · 능력): 다음 프레임 pressed */
  tap(bit: number): void;
  /** 누르고 있는 버튼 (구조 = RESCUE): 누르는 동안 held, 누른 순간 pressed */
  hold(bit: number, down: boolean): void;
}

/** 손가락 하나 (스틱에 닿은 손가락만. 탭 · 누르기 버튼 손가락은 따로 세지 않는다) */
interface Finger {
  kind: StickKind;
  /** 마지막 정규화 좌표 (자르기 전 값. 방향은 이 값으로 계산해 키보드와 같은 식이 된다) */
  x: number;
  y: number;
  startMs: number;
  /** 데드존 밖에 한 번이라도 나갔다 (조준 스틱 ② 조준 중) */
  armed: boolean;
  /** 마지막으로 데드존 밖에 있던 각도 (데드존 안에서는 갱신하지 않는다) */
  angle: number;
  /** 닿은 순서 (같은 종류 손가락이 여럿이면 나중 것을 쓴다) */
  order: number;
}

/** ③ 발사 대기: 각도 θ를 고정하고 예측 face가 따라오면(또는 0.35초가 지나면) bit를 낸다 */
interface PendingFire {
  bit: number;
  angle: number;
  atMs: number;
}

/** 데드존 밖인가 (길이가 데드존과 같으면 안으로 본다) */
function outside(f: Finger): boolean {
  return Math.hypot(f.x, f.y) > TOUCH.deadZone;
}

/** 터치 입력 상태 기계 */
export class TouchInput implements TouchSource, TouchFeed {
  private readonly fingers = new Map<number, Finger>();
  private order = 0;
  /** 다음 프레임에 무조건 낼 비트 (포효 · 시야 모드 · 능력 · 구조 누른 순간) */
  private queued = 0;
  /** 다음 프레임에 지금 방향으로 낼 ATTACK · DASH (짧은 탭 · 돌진 버튼 탭). 그 프레임에 할 수 없으면 버린다 */
  private fireNow = 0;
  private pending: PendingFire | null = null;
  /** 이번 프레임에 발사 대기에서 낸 각도 (aimAngle이 그 프레임까지 θ를 보내게) */
  private firedAngle: number | null = null;
  /** 누르고 있는 버튼 (구조) */
  private holds = 0;
  /** 마지막으로 정한 조준 각도 (멈춰 있으면 이 방향을 계속 본다). null = 터치가 아직 정하지 않음 */
  private lastDir: number | null = null;

  // ───────────── TouchSource (InputSampler가 읽는다) ─────────────

  moveVector(): { x: number; y: number } {
    const f = this.latest('move', false);
    if (!f || !outside(f)) return { x: 0, y: 0 };
    // 데드존 밖은 길이 1 (PC와 같은 최고 속도). 키보드와 같은 식(x / hypot)이라 같은 방향이면 같은 값이 된다
    const len = Math.hypot(f.x, f.y);
    return { x: f.x / len, y: f.y / len };
  }

  heldBits(): number {
    return this.holds;
  }

  takePressed(ctx: TouchFrameCtx): number {
    let out = this.queued;
    this.queued = 0;
    this.firedAngle = null;
    // 짧은 탭 · 돌진 탭: 할 수 없는 순간이면 보내지 않는다 (서버가 버리더라도 예측 효과음이 나지 않게)
    if ((this.fireNow & BTN.ATTACK) !== 0 && ctx.canAttack) out |= BTN.ATTACK;
    if ((this.fireNow & BTN.DASH) !== 0 && ctx.canDash) out |= BTN.DASH;
    this.fireNow = 0;
    const p = this.pending;
    if (p) {
      const can = p.bit === BTN.ATTACK ? ctx.canAttack : ctx.canDash;
      if (!can) {
        // 쿨타임 · 행동 불가면 ③에 들어가지 않는다 (기다리는 동안 기절해도 버린다)
        this.pending = null;
      } else if (
        Math.abs(angleDiff(ctx.face, p.angle)) <= TOUCH.aimTolerance ||
        ctx.nowMs - p.atMs >= TOUCH.maxFireWaitMs
      ) {
        out |= p.bit;
        this.firedAngle = p.angle;
        this.pending = null;
      }
    }
    return out;
  }

  aimAngle(_ctx: TouchFrameCtx): number | null {
    const a =
      this.firedAngle ??
      this.pending?.angle ??
      this.armedAngle('dash') ??
      this.armedAngle('aim') ??
      this.moveAngle();
    if (a !== null) this.lastDir = a;
    return this.lastDir;
  }

  reset(): void {
    this.fingers.clear();
    this.queued = 0;
    this.fireNow = 0;
    this.pending = null;
    this.firedAngle = null;
    this.holds = 0;
    this.lastDir = null;
  }

  // ───────────── TouchFeed (터치 화면이 넣는다) ─────────────

  stickStart(pointerId: number, kind: StickKind, nowMs: number): void {
    this.order += 1;
    this.fingers.set(pointerId, {
      kind,
      x: 0,
      y: 0,
      startMs: nowMs,
      armed: false,
      angle: 0,
      order: this.order,
    });
  }

  stickMove(pointerId: number, nx: number, ny: number): void {
    const f = this.fingers.get(pointerId);
    if (!f || !Number.isFinite(nx) || !Number.isFinite(ny)) return;
    f.x = nx;
    f.y = ny;
    if (outside(f)) {
      f.armed = true;
      f.angle = Math.atan2(ny, nx);
    }
  }

  stickEnd(pointerId: number, nowMs: number): void {
    const f = this.fingers.get(pointerId);
    if (!f) return;
    this.fingers.delete(pointerId);
    if (f.kind === 'aim') {
      // ② 바깥에서 뗌 → ③ 발사 대기, ② 가운데로 돌아와 뗌 → 취소, ① 0.25초 안에 뗌 → 지금 방향으로 공격
      if (f.armed) {
        if (outside(f)) this.pending = { bit: BTN.ATTACK, angle: f.angle, atMs: nowMs };
      } else if (nowMs - f.startMs <= TOUCH.shortTapMs) {
        this.fireNow |= BTN.ATTACK;
      }
    } else if (f.kind === 'dash') {
      // 끌어서 바깥에서 뗌 → 그 각도로 발사 대기, 끌었다 가운데로 돌아와 뗌 → 취소(조준 스틱과 같게),
      // 끌지 않고 뗌 → 조준 스틱을 잡고 있으면 그 각도로 발사 대기, 아니면 지금 방향으로 즉시
      if (f.armed) {
        if (outside(f)) this.pending = { bit: BTN.DASH, angle: f.angle, atMs: nowMs };
      } else {
        const aim = this.armedAngle('aim');
        if (aim !== null) this.pending = { bit: BTN.DASH, angle: aim, atMs: nowMs };
        else this.fireNow |= BTN.DASH;
      }
    }
  }

  stickCancel(pointerId: number): void {
    // 이미 뗀 손가락(뗀 뒤 오는 lostpointercapture)은 아무것도 하지 않는다: 그 손가락이 만든 발사 대기는 이미 확정이다
    if (!this.fingers.delete(pointerId)) return;
    // 손가락이 사라지면(시스템 제스처 · 캡처 잃음) 대개 다른 손가락도 같이 사라진다: 누르고 있던 구조도 뗀 것으로 본다
    this.holds = 0;
  }

  tap(bit: number): void {
    this.queued |= bit;
  }

  hold(bit: number, down: boolean): void {
    if (down) {
      this.holds |= bit;
      this.queued |= bit;
    } else {
      this.holds &= ~bit;
    }
  }

  // ───────────── 내부 ─────────────

  /** 그 종류의 가장 나중에 닿은 손가락 (armedOnly면 데드존 밖에 나간 적이 있는 손가락만) */
  private latest(kind: StickKind, armedOnly: boolean): Finger | null {
    let best: Finger | null = null;
    for (const f of this.fingers.values()) {
      if (f.kind !== kind || (armedOnly && !f.armed)) continue;
      if (!best || f.order > best.order) best = f;
    }
    return best;
  }

  private armedAngle(kind: StickKind): number | null {
    return this.latest(kind, true)?.angle ?? null;
  }

  private moveAngle(): number | null {
    const m = this.moveVector();
    return m.x === 0 && m.y === 0 ? null : Math.atan2(m.y, m.x);
  }
}
