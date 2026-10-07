// 봇용 길찾기: 타일 격자 A* (8방향, 모서리 끼어 지나가기 금지) → 웨이포인트(타일 중심)
import { MAP_H, MAP_W, blocksMove, type MoverContext, type Vec2 } from '@decoy/shared';

interface Node {
  i: number;
  j: number;
  g: number;
  f: number;
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

/** 몸이 지나갈 수 있는 타일인가: 자기 타일 + 상하좌우 이웃 중 막힌 곳이 없어야 벽에 비비지 않는다 */
function walkable(i: number, j: number, ctx: MoverContext, strict: boolean): boolean {
  if (blocksMove(i, j, ctx)) return false;
  if (!strict) return true;
  return true;
}

export function findPath(from: Vec2, to: Vec2, ctx: MoverContext): Vec2[] {
  const si = Math.floor(from.x);
  const sj = Math.floor(from.y);
  const ti = Math.floor(to.x);
  const tj = Math.floor(to.y);
  if (si === ti && sj === tj) return [to];
  const key = (i: number, j: number): number => j * MAP_W + i;
  const open: Node[] = [{ i: si, j: sj, g: 0, f: Math.hypot(ti - si, tj - sj), parent: null }];
  const best = new Map<number, number>([[key(si, sj), 0]]);
  const closed = new Set<number>();
  let found: Node | null = null;
  while (open.length > 0) {
    let bi = 0;
    for (let k = 1; k < open.length; k += 1) if ((open[k]?.f ?? Infinity) < (open[bi]?.f ?? Infinity)) bi = k;
    const cur = open.splice(bi, 1)[0];
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
      if (!walkable(ni, nj, ctx, true)) continue;
      // 대각선은 양옆 타일이 모두 열려 있어야 한다 (모서리 끼임 방지)
      if (dx !== 0 && dy !== 0 && (blocksMove(cur.i + dx, cur.j, ctx) || blocksMove(cur.i, cur.j + dy, ctx)))
        continue;
      // 벽에 바짝 붙은 타일은 조금 비싸게 (몸이 걸리지 않게 통로 가운데로)
      let wallPenalty = 0;
      for (const [ax, ay] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (blocksMove(ni + ax, nj + ay, ctx)) wallPenalty += 0.35;
      }
      const g = cur.g + cost + wallPenalty;
      const nk = key(ni, nj);
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      open.push({ i: ni, j: nj, g, f: g + Math.hypot(ti - ni, tj - nj), parent: cur });
    }
  }
  if (!found) return [];
  const pts: Vec2[] = [];
  for (let n: Node | null = found; n && n.parent; n = n.parent) pts.push({ x: n.i + 0.5, y: n.j + 0.5 });
  pts.reverse();
  if (pts.length > 0) pts[pts.length - 1] = { x: to.x, y: to.y };
  return pts;
}

/** 경로를 따라가는 이동 벡터. 가까운 웨이포인트는 지나간 것으로 본다 */
export class PathFollower {
  private path: Vec2[] = [];
  private target: Vec2 | null = null;
  private repathAt = 0;

  moveToward(pos: Vec2, target: Vec2, ctx: MoverContext, nowTick: number): Vec2 {
    const far = !this.target || Math.hypot(this.target.x - target.x, this.target.y - target.y) > 0.75;
    if (far || nowTick >= this.repathAt || this.path.length === 0) {
      this.path = findPath(pos, target, ctx);
      this.target = { x: target.x, y: target.y };
      this.repathAt = nowTick + 15;
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
