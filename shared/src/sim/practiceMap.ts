// 실전 봇 두뇌 공용: 공개 지도에서 미리 계산하는 것 (길 거리 필드 · 도주 후보 · 순찰 · 감시 자리)과 기하 도구.
// 지도(map.ts)만으로 정해지고 판 상태는 읽지 않는다. 괴물 두뇌(practiceMonster.ts) · 생존자 두뇌(practiceSurvivor.ts)가 같이 쓴다.
// 플레이테스트 반영 c에서 practiceBrains.ts를 셋으로 나눴다 (공용 · 괴물 · 생존자, 진입점은 그대로 practiceBrains.ts)
import {
  CAPTURE_POINTS,
  POINT_IDS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_RECT,
  RESCUE_POINT,
  Rng,
  blocksMove,
  inRect,
  segmentBlocked,
  type BlockFn,
  type ExitId,
  type MoverContext,
  type PointState,
  type Role,
  type Vec2,
} from '../index';
import { dist } from './botBrains';

// ───────────────────────── 공개 지도에서 미리 계산하는 것 ─────────────────────────

/** 자유 생존자와 괴물이 함께 다닐 수 있는 칸 (탈출구 닫힘, 감옥 문은 둘 다 지나간다) */
export const OPEN_CTX: MoverContext = {
  kind: 'monster',
  imprisoned: false,
  openExits: { N: false, S: false },
};

export const EXIT_IDS: readonly ExitId[] = ['N', 'S'];

/** 지도 크기 (가져온 값을 지역 상수로: 자주 도는 반복문에서 모듈 바인딩을 매번 읽지 않게) */
export const W = MAP_W;
export const H = MAP_H;

const WALKABLE = new Uint8Array(W * H);
for (let j = 0; j < H; j += 1) {
  for (let i = 0; i < W; i += 1) WALKABLE[j * W + i] = blocksMove(i, j, OPEN_CTX) ? 0 : 1;
}

export function walkable(i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < W && j < H && WALKABLE[j * W + i] === 1;
}

export function walkableAt(p: Vec2): boolean {
  return walkable(Math.floor(p.x), Math.floor(p.y));
}

export const notWalkable: BlockFn = (i, j) => !walkable(i, j);

/** p가 바닥이면 그대로, 아니면 가장 가까운 바닥 칸 중심 (반경 4칸 안) */
export function snapToFloor(p: Vec2): Vec2 {
  if (walkableAt(p)) return p;
  const fi = Math.floor(p.x);
  const fj = Math.floor(p.y);
  let best: Vec2 = p;
  let bestD = Infinity;
  for (let r = 1; r <= 4 && bestD === Infinity; r += 1) {
    for (let j = fj - r; j <= fj + r; j += 1) {
      for (let i = fi - r; i <= fi + r; i += 1) {
        if (!walkable(i, j)) continue;
        const d = Math.hypot(i + 0.5 - p.x, j + 0.5 - p.y);
        if (d < bestD - 1e-9) {
          bestD = d;
          best = { x: i + 0.5, y: j + 0.5 };
        }
      }
    }
  }
  return best;
}

const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * 칸마다 이웃 목록 (8방향, 대각선은 양옆이 모두 열려 있을 때만 — 길찾기와 같은 규칙).
 * 칸 k의 이웃은 NB_CELL[NB_START[k] .. NB_START[k + 1]), 비용은 NB_COST
 */
const { NB_START, NB_CELL, NB_COST } = (() => {
  const start = new Int32Array(W * H + 1);
  const cells: number[] = [];
  const costs: number[] = [];
  for (let k = 0; k < W * H; k += 1) {
    start[k] = cells.length;
    const ci = k % W;
    const cj = (k - ci) / W;
    if (!walkable(ci, cj)) continue;
    for (const [dx, dy, cost] of STEPS) {
      const ni = ci + dx;
      const nj = cj + dy;
      if (!walkable(ni, nj)) continue;
      if (dx !== 0 && dy !== 0 && (!walkable(ci + dx, cj) || !walkable(ci, cj + dy))) continue;
      cells.push(nj * W + ni);
      costs.push(cost);
    }
  }
  start[W * H] = cells.length;
  return { NB_START: start, NB_CELL: Int32Array.from(cells), NB_COST: Float64Array.from(costs) };
})();

/** 다익스트라용 최소 힙 (거리, 칸). 같은 칸이 여러 번 들어갈 수 있고 늦은 것은 꺼낼 때 버린다. 넣는 횟수 ≤ 간선 수 + 1 */
const HEAP_KEY = new Float64Array(NB_CELL.length + 1);
const HEAP_VAL = new Int32Array(NB_CELL.length + 1);
let heapSize = 0;
let poppedKey = 0;

function heapPush(key: number, val: number): void {
  let k = heapSize;
  heapSize += 1;
  while (k > 0) {
    const p = (k - 1) >> 1;
    const pk = HEAP_KEY[p] ?? 0;
    if (pk <= key) break;
    HEAP_KEY[k] = pk;
    HEAP_VAL[k] = HEAP_VAL[p] ?? 0;
    k = p;
  }
  HEAP_KEY[k] = key;
  HEAP_VAL[k] = val;
}

/** 가장 가까운 칸을 꺼낸다 (거리는 poppedKey) */
function heapPop(): number {
  const top = HEAP_VAL[0] ?? 0;
  poppedKey = HEAP_KEY[0] ?? 0;
  heapSize -= 1;
  if (heapSize > 0) {
    const key = HEAP_KEY[heapSize] ?? 0;
    const val = HEAP_VAL[heapSize] ?? 0;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= heapSize) break;
      const r = l + 1;
      const c = r < heapSize && (HEAP_KEY[r] ?? 0) < (HEAP_KEY[l] ?? 0) ? r : l;
      const ck = HEAP_KEY[c] ?? 0;
      if (ck >= key) break;
      HEAP_KEY[k] = ck;
      HEAP_VAL[k] = HEAP_VAL[c] ?? 0;
      k = c;
    }
    HEAP_KEY[k] = key;
    HEAP_VAL[k] = val;
  }
  return top;
}

/** start 칸에서 길 거리 (out은 Infinity로 채워 둔다). target 칸에 닿으면 그 거리, limit을 넘으면 Infinity */
function dijkstra(start: number, out: Float64Array, target: number, limit: number): number {
  heapSize = 0;
  out[start] = 0;
  heapPush(0, start);
  while (heapSize > 0) {
    const k = heapPop();
    const d = poppedKey;
    if (d > (out[k] ?? Infinity)) continue;
    if (k === target) return d;
    if (d > limit) return Infinity;
    const end = NB_START[k + 1] ?? 0;
    for (let e = NB_START[k] ?? 0; e < end; e += 1) {
      const n = NB_CELL[e] ?? 0;
      const g = d + (NB_COST[e] ?? 0);
      if (g < (out[n] ?? Infinity)) {
        out[n] = g;
        heapPush(g, n);
      }
    }
  }
  return target < 0 ? 0 : Infinity;
}

/** 고정 지점(도주 후보 · 거점 · 탈출구 · 구조 지점 · 감시 자리)에서 모든 칸까지의 길 거리. 지도만으로 정해진다 */
const FIELDS = new Map<number, Float32Array>();
const SCRATCH = new Float64Array(W * H);

export function fieldFrom(anchor: Vec2): Float32Array {
  const q = snapToFloor(anchor);
  const key = Math.floor(q.y) * W + Math.floor(q.x);
  const cached = FIELDS.get(key);
  if (cached) return cached;
  SCRATCH.fill(Infinity);
  if (walkable(Math.floor(q.x), Math.floor(q.y))) dijkstra(key, SCRATCH, -1, Infinity);
  const f = Float32Array.from(SCRATCH);
  FIELDS.set(key, f);
  return f;
}

/** 필드의 고정 지점에서 p까지 길 거리. p가 막힌 칸(열린 탈출구 문 등)이면 이웃 바닥 칸으로 */
export function pathDist(f: Float32Array, p: Vec2): number {
  const i = Math.floor(p.x);
  const j = Math.floor(p.y);
  if (walkable(i, j)) return f[j * W + i] ?? Infinity;
  let best = Infinity;
  for (const [dx, dy, cost] of STEPS) {
    if (walkable(i + dx, j + dy)) best = Math.min(best, (f[(j + dy) * W + i + dx] ?? Infinity) + cost);
  }
  return best;
}

/** from → to 길 거리 (limit을 넘으면 Infinity). 괴물이 가까이 보일 때만 부르는 짧은 탐색 */
export function localPathDist(from: Vec2, to: Vec2, limit: number): number {
  const fi = Math.floor(from.x);
  const fj = Math.floor(from.y);
  const ti = Math.floor(to.x);
  const tj = Math.floor(to.y);
  if (fi === ti && fj === tj) return dist(from, to);
  // 막힌 칸 위(열린 문 등)면 직선 거리로 대신한다
  if (!walkable(fi, fj) || !walkable(ti, tj)) return dist(from, to);
  SCRATCH.fill(Infinity);
  return dijkstra(fj * W + fi, SCRATCH, tj * W + ti, limit);
}

/** 도주 후보 지점: 4칸 간격 격자를 바닥에 맞춘 것 (감옥 안 제외) */
export const FLEE_SPOTS: readonly Vec2[] = (() => {
  const out: Vec2[] = [];
  for (let y = 2; y < H; y += 4) {
    for (let x = 2; x < W; x += 4) {
      const p = snapToFloor({ x: x + 0.5, y: y + 0.5 });
      if (!walkableAt(p) || inRect(p, PRISON_RECT)) continue;
      if (out.some((q) => dist(q, p) < 1.5)) continue;
      out.push(p);
    }
  }
  return out;
})();

/** 열린 정도: 각 도주 후보에서 길 거리 OPEN_RADIUS 안에 있는 다른 후보 수 (구석 · 막다른 곳일수록 작다) */
export const OPEN_RADIUS = 10;
let openness: number[] | null = null;

/**
 * 도주 후보 · 고정 지점의 길 거리 필드와 열린 정도를 미리 계산한다 (지도만으로 정해진다).
 * 두뇌를 만들 때 부른다: 판 도중 첫 도주에서 한꺼번에 계산하면 그 틱이 길어진다
 */
export function preparePracticeMap(): void {
  if (openness) return;
  for (const s of FLEE_SPOTS) fieldFrom(s);
  for (const id of POINT_IDS) fieldFrom(CAPTURE_POINTS[id]);
  for (const id of EXIT_IDS) fieldFrom(EXITS[id].center);
  fieldFrom(RESCUE_POINT);
  openness = FLEE_SPOTS.map((s) => {
    const f = fieldFrom(s);
    let n = 0;
    for (const q of FLEE_SPOTS) if (q !== s && pathDist(f, q) <= OPEN_RADIUS) n += 1;
    return n;
  });
}

/** 실전 봇 지도 준비(preparePracticeMap)를 이미 했는가 (서버가 시작 때 미리 하는지 보는 시험용) */
export function practiceMapReady(): boolean {
  return openness !== null;
}

export function opennessOf(index: number): number {
  if (!openness) preparePracticeMap();
  return openness?.[index] ?? 0;
}

/** 괴물 순찰 고리 (바깥쪽을 한 바퀴, 감옥 반경을 지나지 않는다) */
export const MONSTER_LOOP: readonly Vec2[] = [
  { x: 41.5, y: 19.5 }, // B 방 남쪽
  { x: 44.5, y: 27.5 }, // 남동 구석
  { x: 33.5, y: 29.5 }, // 남쪽 복도 동
  { x: 24.5, y: 28.5 }, // 남문 앞
  { x: 15.5, y: 29.5 }, // 남쪽 복도 서
  { x: 5.5, y: 24.5 }, // 남서
  { x: 8.5, y: 13.5 }, // A 방 북쪽
  { x: 8.5, y: 2.5 }, // 북서
  { x: 20.5, y: 6.5 }, // 북쪽 복도 서
  { x: 24.5, y: 3.5 }, // 북문 앞
  { x: 33.5, y: 7.5 }, // 북쪽 복도 동
  { x: 40.5, y: 4.5 }, // 북동
  { x: 38.5, y: 12.5 }, // B 방 북쪽
].map(snapToFloor);

/** 순찰 중 가끔 들르는 가운데 네 모퉁이 (감옥 캠핑 반경 바로 바깥) */
export const MONSTER_CROSS: readonly Vec2[] = [
  { x: 17.5, y: 11.5 },
  { x: 30.5, y: 11.5 },
  { x: 30.5, y: 22.5 },
  { x: 17.5, y: 22.5 },
].map(snapToFloor);

/** 탈출구가 열린 뒤의 순찰: 북문 ↔ 남문 사이 */
export const MONSTER_EXIT_LOOP: readonly Vec2[] = [
  { x: 24.5, y: 3.5 },
  { x: 30.5, y: 11.5 },
  { x: 30.5, y: 22.5 },
  { x: 24.5, y: 27.5 },
  { x: 17.5, y: 22.5 },
  { x: 17.5, y: 11.5 },
].map(snapToFloor);

/** 막힘 판정: 이 틱 동안 이만큼(타일)도 못 움직였으면 막힌 것 (괴물: 다음 지점으로, 생존자: 잠깐 옆으로) */
export const STUCK_TICKS = 45;
export const STUCK_MOVE = 0.3;

/** 감옥 감시 자리: 캠핑 반경(철창 바깥 4칸) 밖에서 구조 지점이 보이는 곳 (도착 여유를 빼도 반경 밖) */
export const WATCH_SPOTS: readonly Vec2[] = [
  { x: 24, y: 23.5 },
  { x: 17.3, y: 18.5 },
  { x: 30.7, y: 18.5 },
].map(snapToFloor);
/** 감시 자리 도착 판정 (타일) */
export const WATCH_TOLERANCE = 0.3;

/** 탈출구 문 칸 안쪽 (들어가면 탈출) */
export const EXIT_DOORS: Readonly<Record<ExitId, Vec2>> = { N: { x: 24, y: 0.5 }, S: { x: 24, y: 31.5 } };
/** 탈출구 안쪽 방향 (문에서 맵 안으로) */
export const EXIT_INWARD: Readonly<Record<ExitId, number>> = { N: 1, S: -1 };

export function unit(dx: number, dy: number): Vec2 {
  const d = Math.hypot(dx, dy);
  return d < 1e-9 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
}

/** 몸 반지름만큼 양옆으로 벌린 세 직선이 모두 바닥 위인가 (곧장 가도 벽에 걸리지 않는가) */
export function clearPath(a: Vec2, b: Vec2, r: number): boolean {
  if (segmentBlocked(a, b, notWalkable)) return false;
  const d = dist(a, b);
  if (d < 1e-6) return true;
  const nx = (-(b.y - a.y) / d) * r;
  const ny = ((b.x - a.x) / d) * r;
  return (
    !segmentBlocked({ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, notWalkable) &&
    !segmentBlocked({ x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, notWalkable)
  );
}

const ROLE_SALT: Readonly<Record<Role, number>> = {
  monster: 0x2545f491,
  runner: 0x6a09e667,
  guard: 0x3c6ef372,
  scout: 0x510e527f,
};

export function brainRng(seed: number, role: Role): Rng {
  return new Rng((Math.imul(seed | 0, 0x9e3779b1) ^ ROLE_SALT[role]) >>> 0);
}

/** 아직 점령할 수 있는 거점인가 (끝났거나 꺼진 곳은 할 일이 아니다) */
export function pointOpen(state: PointState): boolean {
  return state !== 'done' && state !== 'off';
}
