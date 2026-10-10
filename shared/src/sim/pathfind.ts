// 봇용 길찾기: 타일 격자 A* (8방향, 모서리 끼어 지나가기 금지) → 웨이포인트(타일 중심)
// M13a 길찾기 수정: 열린 목록은 이진 힙(같은 f면 먼저 넣은 것 — 예전 선형 탐색과 같은 선택), 막힌 목표는 가장 가까운
// 이동 가능 타일로, 실패한 탐색도 재탐색 시각을 지킨다 (예전에는 경로를 못 찾으면 매 틱 맵 전체를 다시 뒤졌다)
import { MAP_H, MAP_W, blocksMove, type MoverContext, type Vec2 } from '../index';

interface Node {
  i: number;
  j: number;
  g: number;
  f: number;
  /** 넣은 순서 (같은 f에서 먼저 넣은 것을 먼저 꺼낸다) */
  seq: number;
  parent: Node | null;
}

const DIRS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

const SIDES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 경로를 다시 찾는 간격 (틱). 목표가 크게 움직이면 그 전에라도 다시 찾는다 */
export const REPATH_TICKS = 15;
/** 막힌 목표를 대신할 이동 가능 타일을 찾는 최대 거리 (타일) */
const NEAREST_SEARCH_RADIUS = 4;

/** 최소 힙: (f, seq) 순서. 같은 f면 먼저 넣은 노드 */
export class NodeHeap<T extends { f: number; seq: number }> {
  private readonly items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  private less(a: T, b: T): boolean {
    return a.f < b.f || (a.f === b.f && a.seq < b.seq);
  }

  push(item: T): void {
    const a = this.items;
    a.push(item);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      const parent = a[p];
      if (!parent || !this.less(item, parent)) break;
      a[k] = parent;
      k = p;
    }
    a[k] = item;
  }

  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length === 0 || last === undefined) return top;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= a.length) break;
      const r = l + 1;
      const left = a[l];
      const right = a[r];
      const child = right && left && this.less(right, left) ? r : l;
      const c = a[child];
      if (!c || !this.less(c, last)) break;
      a[k] = c;
      k = child;
    }
    a[k] = last;
    return top;
  }
}

/** 탐색 횟수 (시험 · 측정용) */
export const pathStats = { searches: 0 };

/**
 * 목표 타일이 막혀 있으면(기둥 · 벽 · 닫힌 문 위) 가장 가까운 이동 가능 타일. 거리가 같으면 위 → 아래, 왼쪽 → 오른쪽 순.
 * 반경 안에 없으면 null
 */
export function nearestWalkableTile(to: Vec2, ctx: MoverContext): { i: number; j: number } | null {
  const ti = Math.floor(to.x);
  const tj = Math.floor(to.y);
  if (!blocksMove(ti, tj, ctx)) return { i: ti, j: tj };
  let best: { i: number; j: number; d: number } | null = null;
  for (let j = tj - NEAREST_SEARCH_RADIUS; j <= tj + NEAREST_SEARCH_RADIUS; j += 1) {
    for (let i = ti - NEAREST_SEARCH_RADIUS; i <= ti + NEAREST_SEARCH_RADIUS; i += 1) {
      if (i < 0 || j < 0 || i >= MAP_W || j >= MAP_H || blocksMove(i, j, ctx)) continue;
      const d = Math.hypot(i + 0.5 - to.x, j + 0.5 - to.y);
      if (!best || d < best.d - 1e-9) best = { i, j, d };
    }
  }
  return best ? { i: best.i, j: best.j } : null;
}

export function findPath(from: Vec2, to: Vec2, ctx: MoverContext): Vec2[] {
  pathStats.searches += 1;
  const si = Math.floor(from.x);
  const sj = Math.floor(from.y);
  const goal = nearestWalkableTile(to, ctx);
  if (!goal) return [];
  const ti = goal.i;
  const tj = goal.j;
  if (si === ti && sj === tj) return [to];
  const key = (i: number, j: number): number => j * MAP_W + i;
  let seq = 0;
  const open = new NodeHeap<Node>();
  open.push({ i: si, j: sj, g: 0, f: Math.hypot(ti - si, tj - sj), seq: seq++, parent: null });
  const best = new Map<number, number>([[key(si, sj), 0]]);
  const closed = new Set<number>();
  let found: Node | null = null;
  while (open.size > 0) {
    const cur = open.pop();
    if (!cur) break;
    const ck = key(cur.i, cur.j);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.i === ti && cur.j === tj) {
      found = cur;
      break;
    }
    for (const [dx, dy, cost] of DIRS) {
      const ni = cur.i + dx;
      const nj = cur.j + dy;
      if (ni < 0 || nj < 0 || ni >= MAP_W || nj >= MAP_H) continue;
      if (blocksMove(ni, nj, ctx)) continue;
      // 대각선은 양옆 타일이 모두 열려 있어야 한다 (모서리 끼임 방지)
      if (dx !== 0 && dy !== 0 && (blocksMove(cur.i + dx, cur.j, ctx) || blocksMove(cur.i, cur.j + dy, ctx)))
        continue;
      // 벽에 바짝 붙은 타일은 조금 비싸게 (몸이 걸리지 않게 통로 가운데로)
      let wallPenalty = 0;
      for (const [ax, ay] of SIDES) {
        if (blocksMove(ni + ax, nj + ay, ctx)) wallPenalty += 0.35;
      }
      const g = cur.g + cost + wallPenalty;
      const nk = key(ni, nj);
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      open.push({ i: ni, j: nj, g, f: g + Math.hypot(ti - ni, tj - nj), seq: seq++, parent: cur });
    }
  }
  if (!found) return [];
  const pts: Vec2[] = [];
  for (let n: Node | null = found; n && n.parent; n = n.parent) pts.push({ x: n.i + 0.5, y: n.j + 0.5 });
  pts.reverse();
  // 마지막 점은 목표 그 자리. 막힌 목표면 대신 간 타일 중심까지 간 뒤 목표 쪽으로 붙는다
  if (goal.i === Math.floor(to.x) && goal.j === Math.floor(to.y)) {
    if (pts.length > 0) pts[pts.length - 1] = { x: to.x, y: to.y };
  } else pts.push({ x: to.x, y: to.y });
  return pts;
}

/** 경로를 따라가는 이동 벡터. 가까운 웨이포인트는 지나간 것으로 본다 */
export class PathFollower {
  private path: Vec2[] = [];
  private target: Vec2 | null = null;
  private repathAt = 0;

  moveToward(pos: Vec2, target: Vec2, ctx: MoverContext, nowTick: number): Vec2 {
    const far = !this.target || Math.hypot(this.target.x - target.x, this.target.y - target.y) > 0.75;
    // 경로가 비어 있어도(탐색 실패) 재탐색 시각 전에는 다시 찾지 않는다. 그동안은 목표로 곧장
    if (far || nowTick >= this.repathAt) {
      this.path = findPath(pos, target, ctx);
      this.target = { x: target.x, y: target.y };
      this.repathAt = nowTick + REPATH_TICKS;
    }
    while (this.path.length > 1) {
      const p = this.path[0];
      if (!p || Math.hypot(p.x - pos.x, p.y - pos.y) > 0.45) break;
      this.path.shift();
    }
    const next = this.path[0] ?? target;
    const dx = next.x - pos.x;
    const dy = next.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.08) return { x: 0, y: 0 };
    return { x: dx / d, y: dy / d };
  }

  reset(): void {
    this.path = [];
    this.target = null;
  }
}
