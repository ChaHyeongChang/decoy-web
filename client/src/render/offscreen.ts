// 화면 밖 표시 (따라가는 카메라, 순수 · Phaser 없음): 보이는 창 밖에 있는 대상을 창 가장자리 안쪽의 화살표로 가리킨다.
// 정보 규칙 (서버가 보낸 것만): 대상은 세 곳에서만 고른다 — 이번 프레임 메인 화면에 그린 목록(drawn: 팀원 · 괴물 · 탐지 ·
// 포효 표시), 스냅샷의 세계 상태(거점 · 탈출구 상태, 팀원 상태), 고정 맵 좌표(거점 · 감옥 · 탈출구 자리). 그래서 메인 화면 ·
// 미니맵보다 많은 정보가 나올 수 없다. 출처가 drawn에서 사라진 프레임에 화살표도 바로 사라진다(여운 없음).
//  - 생존자 화면: 팀원(자유), 수감된 팀원이 있으면 감옥 구조 자리, 공유 시야로 보이는 괴물, 스카우트 탐지, 포효한 괴물 자리,
//    끝나지 않은 거점(상태별), 활성 · 열린 탈출구. 관전 중이면 내 자리도(수감 중일 때)
//  - 괴물 화면: 점령 중인 거점(깜빡임)과 포효로 드러난 자리(흰색 · 역할 없음)만. 생존자 엔티티 화살표는 없다
import {
  CAPTURE_POINTS,
  EXITS,
  RESCUE_POINT,
  type DrawnEntity,
  type ExitView,
  type PointView,
  type Role,
  type SurvivorStatus,
} from '@decoy/shared';

export type EdgeKind =
  'monster' | 'track' | 'roar' | 'roarPing' | 'prison' | 'teammate' | 'self' | 'exit' | 'point';

/** 화살표 대상 하나 (타일 자리 + 보여 줄 것) */
export interface EdgeTarget {
  kind: EdgeKind;
  id: string;
  tx: number;
  ty: number;
  /** 작을수록 먼저 (상한을 넘으면 뒤가 빠진다) */
  prio: number;
  /** 팀원 · 나: 역할 (문양) */
  role: Role | null;
  /** 거점 · 탈출구 상태 (그림을 고른다) */
  state: string | null;
}

/** 놓인 화살표 (논리 px) */
export interface EdgeMarker extends EdgeTarget {
  /** 배지 가운데 */
  x: number;
  y: number;
  /** 가리키는 방향 (배지 → 대상, 라디안) */
  dir: number;
  /** 캐릭터 몸과 겹쳐 흐리게 (HUD가 캐릭터를 덮지 않게, R15) */
  faded: boolean;
}

export const EDGE_PRIO: Readonly<Record<EdgeKind, number>> = {
  monster: 0,
  track: 1,
  roar: 2,
  roarPing: 2,
  prison: 3,
  teammate: 4,
  self: 5,
  exit: 6,
  point: 7,
};

/** 한 번에 보이는 화살표 상한 */
export const EDGE_MAX = 8;

export interface EdgeInput {
  role: Role;
  selfId: string;
  /** 내 생존자 상태 (괴물이면 null) */
  myStatus: SurvivorStatus | null;
  /** 카메라가 따라가는 대상 (관전 중인 동료면 그 id: 화살표에서 뺀다) */
  followId: string | null;
  /** 이번 프레임 메인 화면에 그린 것 */
  drawn: readonly DrawnEntity[];
  /** 팀원 상태 · 역할 (생존자 화면: 스냅샷의 survivors) */
  statusOf: (id: string) => SurvivorStatus | null;
  roleOf: (id: string) => Role | null;
  points: readonly PointView[];
  exits: readonly ExitView[];
}

/** 생존자가 구조할 수 있는 상태 (자유) */
const FREE: SurvivorStatus = 'free';

/**
 * 이번 프레임의 화살표 대상 (창 안 · 밖 가리지 않고, 정보 규칙에 맞는 것 전부). out을 비우고 채운다(프레임마다 배열을 만들지
 * 않게). 창 밖만 남기기 · 상한 · 자리는 placeEdges가 한다
 */
export function edgeTargets(i: EdgeInput, out: EdgeTarget[]): EdgeTarget[] {
  out.length = 0;
  const push = (
    kind: EdgeKind,
    id: string,
    tx: number,
    ty: number,
    role: Role | null,
    state: string | null,
  ): void => {
    out.push({ kind, id, tx, ty, prio: EDGE_PRIO[kind], role, state });
  };
  if (i.role === 'monster') {
    // 괴물: 포효로 드러난 자리 (흰색, 역할 없음 · 번호는 그린 순서) + 점령 중 거점
    let n = 0;
    for (const d of i.drawn) {
      if (d.layer === 'minimap') continue;
      if (d.kind === 'mark' && d.tag === 'roarPing') push('roarPing', `ping${n++}`, d.x, d.y, null, null);
    }
    for (const p of i.points) {
      if (p.state !== 'capturing') continue;
      const c = CAPTURE_POINTS[p.id];
      push('point', p.id, c.x, c.y, null, p.state);
    }
    return out;
  }
  let jailed = false;
  for (const d of i.drawn) {
    if (d.layer === 'minimap') continue;
    switch (d.kind) {
      case 'monster':
        push('monster', 'monster', d.x, d.y, 'monster', null);
        break;
      case 'mark':
        if (d.tag === 'track') push('track', 'track', d.x, d.y, null, null);
        else if (d.tag === 'roarSelf') push('roar', 'roar', d.x, d.y, null, null);
        break;
      case 'survivor': {
        if (d.id === i.followId) break;
        const st = i.statusOf(d.id);
        if (st === 'imprisoned') jailed = true;
        else if (st === FREE) push('teammate', d.id, d.x, d.y, i.roleOf(d.id), null);
        break;
      }
      case 'self':
        // 관전 중일 때만 내 자리 (수감 중이라 맵에 있다). 내 시점이면 늘 창 가운데 근처
        if (i.followId !== null && i.followId !== i.selfId && i.myStatus === 'imprisoned')
          push('self', i.selfId, d.x, d.y, i.roleOf(i.selfId), null);
        break;
    }
  }
  // 구조가 필요한 감옥: 수감된 팀원이 있고 내가 자유일 때 (구조 자리)
  if (jailed && i.myStatus === FREE) push('prison', 'prison', RESCUE_POINT.x, RESCUE_POINT.y, null, null);
  for (const e of i.exits) {
    if (e.state === 'inactive') continue;
    const c = EXITS[e.id].center;
    push('exit', e.id, c.x, c.y, null, e.state);
  }
  for (const p of i.points) {
    if (p.state === 'done') continue;
    const c = CAPTURE_POINTS[p.id];
    push('point', p.id, c.x, c.y, null, p.state);
  }
  return out;
}

export interface ViewPx {
  /** 보이는 창 (타일) */
  view: { x: number; y: number; w: number; h: number };
  /** 창이 그려지는 화면 사각형 (논리 px) */
  rect: { x: number; y: number; w: number; h: number };
}

/** 타일 → 논리 px (창 기준) */
export function toScreen(v: ViewPx, tx: number, ty: number): { x: number; y: number } {
  return {
    x: v.rect.x + ((tx - v.view.x) / v.view.w) * v.rect.w,
    y: v.rect.y + ((ty - v.view.y) / v.view.h) * v.rect.h,
  };
}

/** 대상이 창 안에 보이는가 (창 가장자리에서 margin 타일 안쪽이면 보인다고 본다) */
export function inView(v: ViewPx['view'], tx: number, ty: number, margin = 0.15): boolean {
  return tx >= v.x + margin && tx <= v.x + v.w - margin && ty >= v.y + margin && ty <= v.y + v.h - margin;
}

/** 안쪽 사각형 (화살표 배지 가운데가 다니는 길) */
interface Track {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function perimeter(t: Track): number {
  return 2 * (t.x1 - t.x0 + (t.y1 - t.y0));
}

/** 사각형 둘레 위 점 → 둘레 거리 (왼쪽 위에서 시계 방향) */
export function toPerim(t: Track, x: number, y: number): number {
  const w = t.x1 - t.x0;
  const h = t.y1 - t.y0;
  const dl = Math.abs(x - t.x0);
  const dr = Math.abs(x - t.x1);
  const dt = Math.abs(y - t.y0);
  const db = Math.abs(y - t.y1);
  const m = Math.min(dl, dr, dt, db);
  if (m === dt) return Math.max(0, Math.min(w, x - t.x0));
  if (m === dr) return w + Math.max(0, Math.min(h, y - t.y0));
  if (m === db) return w + h + Math.max(0, Math.min(w, t.x1 - x));
  return 2 * w + h + Math.max(0, Math.min(h, t.y1 - y));
}

/** 둘레 거리 → 점 */
export function fromPerim(t: Track, s: number): { x: number; y: number } {
  const w = t.x1 - t.x0;
  const h = t.y1 - t.y0;
  const P = 2 * (w + h);
  let d = ((s % P) + P) % P;
  if (d <= w) return { x: t.x0 + d, y: t.y0 };
  d -= w;
  if (d <= h) return { x: t.x1, y: t.y0 + d };
  d -= h;
  if (d <= w) return { x: t.x1 - d, y: t.y1 };
  d -= w;
  return { x: t.x0, y: t.y1 - d };
}

/** 창 가운데에서 대상 쪽 반직선이 안쪽 사각형과 만나는 점 */
export function rayToTrack(t: Track, tx: number, ty: number): { x: number; y: number } {
  const cx = (t.x0 + t.x1) / 2;
  const cy = (t.y0 + t.y1) / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const hx = (t.x1 - t.x0) / 2;
  const hy = (t.y1 - t.y0) / 2;
  const k = Math.min(dx !== 0 ? hx / Math.abs(dx) : Infinity, dy !== 0 ? hy / Math.abs(dy) : Infinity);
  if (!Number.isFinite(k)) return { x: cx, y: t.y0 };
  return { x: cx + dx * k, y: cy + dy * k };
}

export interface EdgeLayout {
  /** 창 가장자리에서 배지 가운데까지 (논리 px) */
  inset: number;
  /** 배지 반지름 (논리 px): 서로 이만큼의 두 배 + 틈보다 가깝지 않게 민다 */
  r: number;
  /** 배지 사이 틈 (논리 px) */
  gap: number;
  /** 피할 사각형 (논리 px, 터치 엄지 버튼 · 창 안에 든 HUD) */
  avoid: readonly { x: number; y: number; w: number; h: number }[];
  /** 캐릭터 몸 반지름 (논리 px): 배지가 몸과 겹치면 흐리게 */
  bodyR: number;
}

function hitsBox(
  x: number,
  y: number,
  r: number,
  b: { x: number; y: number; w: number; h: number },
): boolean {
  const nx = Math.max(b.x, Math.min(b.x + b.w, x));
  const ny = Math.max(b.y, Math.min(b.y + b.h, y));
  return Math.hypot(x - nx, y - ny) < r;
}

/**
 * 창 밖 대상만 골라(우선순위 · 상한) 창 가장자리 안쪽에 놓는다: 창 가운데 → 대상 반직선이 안쪽 사각형과 만나는 점에서,
 * 서로 겹치면 둘레를 따라 밀고, 피할 사각형 안이면 가까운 쪽 둘레 밖으로 옮긴다. 화살표는 놓인 자리에서 대상 쪽을 가리킨다.
 * bodies = 메인 화면에 그린 캐릭터 자리 (논리 px)
 */
export function placeEdges(
  targets: readonly EdgeTarget[],
  v: ViewPx,
  L: EdgeLayout,
  bodies: readonly { x: number; y: number }[],
  out: EdgeMarker[],
): EdgeMarker[] {
  out.length = 0;
  const t: Track = {
    x0: v.rect.x + L.inset,
    y0: v.rect.y + L.inset,
    x1: v.rect.x + v.rect.w - L.inset,
    y1: v.rect.y + v.rect.h - L.inset,
  };
  if (t.x1 <= t.x0 || t.y1 <= t.y0) return out;
  const P = perimeter(t);
  // 창 밖만, 우선순위 순 (같으면 들어온 순서), 상한
  const picked: EdgeTarget[] = [];
  for (const g of targets) if (!inView(v.view, g.tx, g.ty)) picked.push(g);
  picked.sort((a, b) => a.prio - b.prio);
  if (picked.length > EDGE_MAX) picked.length = EDGE_MAX;
  const s: number[] = [];
  const order: number[] = [];
  for (let k = 0; k < picked.length; k += 1) {
    const g = picked[k]!;
    const p = toScreen(v, g.tx, g.ty);
    const q = rayToTrack(t, p.x, p.y);
    s.push(toPerim(t, q.x, q.y));
    order.push(k);
  }
  // 겹침 풀기: 둘레 순으로 늘어놓고 이웃 사이가 최소 간격보다 좁으면 반씩 민다 (몇 번 반복)
  const minGap = L.r * 2 + L.gap;
  order.sort((a, b) => s[a]! - s[b]!);
  const n = order.length;
  if (n > 1 && minGap * n < P) {
    for (let pass = 0; pass < 16; pass += 1) {
      let moved = false;
      for (let k = 0; k < n; k += 1) {
        const a = order[k]!;
        const b = order[(k + 1) % n]!;
        let d = s[b]! - s[a]!;
        if (k === n - 1) d += P;
        if (d >= minGap) continue;
        const push = (minGap - d) / 2;
        s[a] = s[a]! - push;
        s[b] = s[b]! + push;
        moved = true;
      }
      if (!moved) break;
    }
  }
  // 피할 사각형(엄지 버튼 · 맵 안 미니맵): 걸린 화살표만 가까운 쪽으로 둘레를 따라 빠져나간다. 빠져나갈 자리는 사각형뿐 아니라
  // 이미 자리 잡은 다른 화살표(걸리지 않은 것 · 먼저 옮긴 것)와도 최소 간격을 지킨다 — 같은 버튼에 막힌 둘이 같은 빈자리에
  // 겹쳐 쌓이지 않게 (검토 반영). 빈자리가 없으면 제자리
  if (L.avoid.length > 0 && picked.length > 0) {
    const inBox = (q: number): boolean => {
      const p = fromPerim(t, q);
      return L.avoid.some((b) => hitsBox(p.x, p.y, L.r, b));
    };
    const moving: number[] = [];
    const fixed: number[] = [];
    for (let k = 0; k < picked.length; k += 1) {
      if (inBox(s[k]!)) moving.push(k);
      else fixed.push(s[k]!);
    }
    const near = (q: number): boolean => {
      for (const f of fixed) {
        const d = Math.abs(q - f) % P;
        if (Math.min(d, P - d) < minGap - 1e-6) return true;
      }
      return false;
    };
    const step = 4;
    for (const k of moving) {
      const at = s[k]!;
      for (let d = step; d < P / 2; d += step) {
        if (!inBox(at + d) && !near(at + d)) {
          s[k] = at + d;
          break;
        }
        if (!inBox(at - d) && !near(at - d)) {
          s[k] = at - d;
          break;
        }
      }
      fixed.push(s[k]!);
    }
  }
  for (let k = 0; k < picked.length; k += 1) {
    const g = picked[k]!;
    const p = fromPerim(t, s[k]!);
    const tp = toScreen(v, g.tx, g.ty);
    let faded = false;
    for (const b of bodies)
      if (Math.hypot(b.x - p.x, b.y - p.y) < L.r + L.bodyR) {
        faded = true;
        break;
      }
    out.push({ ...g, x: p.x, y: p.y, dir: Math.atan2(tp.y - p.y, tp.x - p.x), faded });
  }
  return out;
}
