// M13a 길찾기 수정: 이진 힙(예전과 같은 경로), 막힌 목표 보정, 실패한 탐색도 재탐색 시각을 지킴, 수감 중 탐색 안 함,
// 개발용 순찰점은 모두 바닥, 봇 4명 판 틱 비용
import { describe, expect, it } from 'vitest';
import {
  MAP_H,
  MAP_W,
  MONSTER_SPAWN,
  PRISON_SLOTS,
  blocksMove,
  type MoverContext,
  type Role,
  type Vec2,
} from '@decoy/shared';
import {
  DEV_PATROLS,
  GoAndHoldBrain,
  NodeHeap,
  PathFollower,
  REPATH_TICKS,
  SimMatch,
  devBotBrain,
  findPath,
  idleBrain,
  nearestWalkableTile,
  pathStats,
  type BotBrain,
} from '@decoy/shared/sim';
import { loadTestBalance } from '../helpers/fixtures';

const SURVIVOR: MoverContext = { kind: 'survivor', imprisoned: false, openExits: { N: false, S: false } };
const MONSTER: MoverContext = { kind: 'monster', imprisoned: false, openExits: { N: false, S: false } };

/** 예전(M13a 전) 구현: 열린 목록을 선형 탐색해 f가 가장 작은 첫 노드를 꺼낸다. 막힌 목표는 찾지 못한다 */
function legacyFindPath(from: Vec2, to: Vec2, ctx: MoverContext): Vec2[] {
  interface N {
    i: number;
    j: number;
    g: number;
    f: number;
    parent: N | null;
  }
  const dirs: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  const si = Math.floor(from.x);
  const sj = Math.floor(from.y);
  const ti = Math.floor(to.x);
  const tj = Math.floor(to.y);
  if (si === ti && sj === tj) return [to];
  const key = (i: number, j: number): number => j * MAP_W + i;
  const open: N[] = [{ i: si, j: sj, g: 0, f: Math.hypot(ti - si, tj - sj), parent: null }];
  const best = new Map<number, number>([[key(si, sj), 0]]);
  const closed = new Set<number>();
  let found: N | null = null;
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
    for (const [dx, dy, cost] of dirs) {
      const ni = cur.i + dx;
      const nj = cur.j + dy;
      if (ni < 0 || nj < 0 || ni >= MAP_W || nj >= MAP_H) continue;
      if (blocksMove(ni, nj, ctx)) continue;
      if (dx !== 0 && dy !== 0 && (blocksMove(cur.i + dx, cur.j, ctx) || blocksMove(cur.i, cur.j + dy, ctx)))
        continue;
      let pen = 0;
      for (const [ax, ay] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        if (blocksMove(ni + ax, nj + ay, ctx)) pen += 0.35;
      const g = cur.g + cost + pen;
      const nk = key(ni, nj);
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      open.push({ i: ni, j: nj, g, f: g + Math.hypot(ti - ni, tj - nj), parent: cur });
    }
  }
  if (!found) return [];
  const pts: Vec2[] = [];
  for (let n: N | null = found; n && n.parent; n = n.parent) pts.push({ x: n.i + 0.5, y: n.j + 0.5 });
  pts.reverse();
  if (pts.length > 0) pts[pts.length - 1] = { x: to.x, y: to.y };
  return pts;
}

function walkableTiles(ctx: MoverContext): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j < MAP_H; j += 1)
    for (let i = 0; i < MAP_W; i += 1) if (!blocksMove(i, j, ctx)) out.push({ x: i + 0.5, y: j + 0.5 });
  return out;
}

describe('이진 힙 열린 목록', () => {
  it('(f, 넣은 순서)로 꺼낸다', () => {
    const heap = new NodeHeap<{ f: number; seq: number }>();
    const items: { f: number; seq: number }[] = [];
    let x = 12345;
    for (let seq = 0; seq < 500; seq += 1) {
      x = (x * 1103515245 + 12345) % 2147483648;
      const item = { f: x % 37, seq };
      items.push(item);
      heap.push(item);
    }
    const out: { f: number; seq: number }[] = [];
    while (heap.size > 0) {
      const v = heap.pop();
      if (v) out.push(v);
    }
    const sorted = [...items].sort((a, b) => a.f - b.f || a.seq - b.seq);
    expect(out).toEqual(sorted);
    expect(heap.pop()).toBeUndefined();
  });

  it('닿을 수 있는 목표는 예전 선형 탐색과 똑같은 경로 (생존자 · 괴물, 300쌍)', () => {
    for (const ctx of [SURVIVOR, MONSTER]) {
      const tiles = walkableTiles(ctx);
      let x = 99;
      for (let n = 0; n < 150; n += 1) {
        x = (x * 1103515245 + 12345) % 2147483648;
        const a = tiles[x % tiles.length];
        x = (x * 1103515245 + 12345) % 2147483648;
        const b = tiles[x % tiles.length];
        if (!a || !b) continue;
        const from = { x: a.x - 0.2, y: a.y + 0.1 };
        const to = { x: b.x + 0.3, y: b.y - 0.25 };
        expect(findPath(from, to, ctx)).toEqual(legacyFindPath(from, to, ctx));
      }
    }
  });
});

describe('막힌 목표 · 실패한 탐색', () => {
  it('기둥 위 목표는 가장 가까운 바닥 타일로 길을 찾는다 (예전에는 길 없음)', () => {
    const pillar = { x: 24, y: 24 };
    expect(blocksMove(24, 24, SURVIVOR)).toBe(true);
    expect(legacyFindPath({ x: 10.5, y: 20.5 }, pillar, SURVIVOR)).toEqual([]);
    const near = nearestWalkableTile(pillar, SURVIVOR);
    expect(near).not.toBeNull();
    if (!near) return;
    expect(blocksMove(near.i, near.j, SURVIVOR)).toBe(false);
    expect(Math.hypot(near.i + 0.5 - pillar.x, near.j + 0.5 - pillar.y)).toBeLessThan(1.6);
    const path = findPath({ x: 10.5, y: 20.5 }, pillar, SURVIVOR);
    expect(path.length).toBeGreaterThan(5);
    expect(path.at(-2)).toEqual({ x: near.i + 0.5, y: near.j + 0.5 });
    expect(path.at(-1)).toEqual(pillar);
    for (const p of path.slice(0, -1))
      expect(blocksMove(Math.floor(p.x), Math.floor(p.y), SURVIVOR)).toBe(false);
  });

  it('길이 없으면 재탐색 시각 전에는 다시 찾지 않는다 (예전에는 매 틱 맵 전체 탐색)', () => {
    // 수감된 생존자 맥락으로 감옥 안에서 바깥 목표: 문이 막혀 길이 없다
    const jailed: MoverContext = { ...SURVIVOR, imprisoned: true };
    const from = PRISON_SLOTS[0] ?? { x: 23.5, y: 15.5 };
    expect(findPath(from, { x: 8, y: 16 }, jailed)).toEqual([]);
    const follower = new PathFollower();
    const before = pathStats.searches;
    const ticks = 60;
    for (let t = 0; t < ticks; t += 1) {
      const v = follower.moveToward(from, { x: 8, y: 16 }, jailed, t);
      // 길이 없는 동안은 목표로 곧장 (예전과 같은 움직임)
      expect(v.x).toBeLessThan(0);
    }
    expect(pathStats.searches - before).toBe(Math.ceil(ticks / REPATH_TICKS));
  });

  it('수감 중인 봇은 길을 찾지 않고 목표로 곧장 간다', () => {
    const balance = loadTestBalance();
    const brains = new Map<string, BotBrain>([
      ['p1', idleBrain],
      ['p2', new GoAndHoldBrain({ x: 8, y: 16 })],
      ['p3', idleBrain],
      ['p4', idleBrain],
    ]);
    const sim = new SimMatch(SimMatch.roles(), balance, brains, 3);
    const s = sim.game.survivorById('p2');
    if (!s) throw new Error('p2 없음');
    s.status = 'imprisoned';
    sim.step();
    sim.step();
    const before = pathStats.searches;
    const x0 = s.move.x;
    for (let t = 0; t < 90; t += 1) sim.step();
    expect(pathStats.searches - before).toBe(0);
    expect(s.move.x).toBeLessThan(x0);
  });
});

describe('개발용 봇 순찰점 (?bots=1)', () => {
  it('모든 순찰점이 그 역할에게 바닥 타일이고, 시작 자리에서 길이 있다', () => {
    for (const role of Object.keys(DEV_PATROLS) as Role[]) {
      const ctx = role === 'monster' ? MONSTER : SURVIVOR;
      const start = role === 'monster' ? MONSTER_SPAWN : (PRISON_SLOTS[0] ?? { x: 23.5, y: 15.5 });
      for (const p of DEV_PATROLS[role]) {
        // 점이 놓인 타일이 그 역할에게 바닥이다 (기둥 · 벽 위가 아님)
        expect(blocksMove(Math.floor(p.x), Math.floor(p.y), ctx), `${role} (${p.x},${p.y})`).toBe(false);
        expect(findPath(start, p, ctx).length, `${role} (${p.x},${p.y})`).toBeGreaterThan(0);
      }
    }
  });

  it('봇 4명 5400틱(3분) 평균 틱 시간이 0.5ms 미만 (M13a 전 이 컨테이너 약 5ms)', () => {
    const balance = loadTestBalance();
    const setup = SimMatch.roles();
    const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, devBotBrain(p.role)]));
    const sim = new SimMatch(setup, balance, brains, 1);
    const before = pathStats.searches;
    const t0 = performance.now();
    let n = 0;
    for (; n < 5400 && !sim.game.end; n += 1) sim.step();
    const avg = (performance.now() - t0) / n;
    console.log(`봇 4명 ${n}틱 평균 ${avg.toFixed(3)}ms, 길찾기 ${pathStats.searches - before}번`);
    expect(n).toBe(5400);
    expect(avg).toBeLessThan(0.5);
    // 봇마다 15틱에 한 번 남짓 (목표가 바뀔 때 더)
    expect(pathStats.searches - before).toBeLessThan((4 * 5400) / REPATH_TICKS + 200);
  });
});
