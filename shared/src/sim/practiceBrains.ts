// 실전 봇 두뇌 (M13b): 봇과 연습 · 빠른 매칭(M13c)의 빈자리.
// 두뇌는 decide()로 받은 것 — 자기에게 온(정보 차단된) 스냅샷 · MatchInfo · Balance — 과 공개 지도(map.ts: 타일 · 거점 ·
// 탈출구 · 감옥 · 구조 지점)만 본다. 게임 상태 · 다른 사람 스냅샷 · 전역 상태는 읽지 않는다.
// 결정적이다: 같은 seed + 같은 스냅샷이면 같은 입력 (시드 난수 Rng만, 괴물 화면 생존자 배열 순서 · 임시 ID에 기대지 않는다)
//
// 괴물: 순찰(탐색 시야) → 자유 생존자가 보이면 추적(추적 시야) · 사거리 안에서 공격, 중간 거리 직선이면 가끔 돌진.
//       거점 점령 알림 · 포효 핑 · 구조 알림 · 탈출구 열림 알림이 오면 그곳을 조사하고, 한동안 아무도 못 보면 포효.
//       동료가 갇혀 있으면 감옥 반경 밖 감시 자리에서 구조 지점을 지켜본다. 감옥 캠핑 감속 · 거점 지키기 유예를 넘기지 않게
//       잠깐 벗어났다 돌아온다
// 생존자: 거점 점령(둘이 함께 1.5배, 시드로 짝과 혼자 갈 거점을 정한다) → 괴물이 가까이 보이면 괴물보다 먼저 닿는 곳으로
//       도주 · 능력(러너 질주, 가드 밀치기, 스카우트 탐지) → 동료가 갇히면 구조 지점에 가장 가까운 사람이 구조 →
//       두 거점 뒤 모두가 같은 정보(괴물을 마지막으로 본 곳 · 메모 비밀번호)로 같은 탈출구를 골라 함께 연다
import {
  BTN,
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_RECT,
  RESCUE_POINT,
  Rng,
  angleDiff,
  blocksMove,
  blocksStrike,
  distToRect,
  emptyInput,
  inRect,
  lineOfSight,
  segmentBlocked,
  type Balance,
  type BlockFn,
  type ExitId,
  type InputFrame,
  type MatchInfo,
  type MoverContext,
  type PointId,
  type Role,
  type RoleId,
  type Snapshot,
  type SurvivorView,
  type Vec2,
  type VisionModeId,
} from '../index';
import { Walker, aimAt, dist, type BotBrain } from './botBrains';

// ───────────────────────── 공개 지도에서 미리 계산하는 것 ─────────────────────────

/** 자유 생존자와 괴물이 함께 다닐 수 있는 칸 (탈출구 닫힘, 감옥 문은 둘 다 지나간다) */
const OPEN_CTX: MoverContext = { kind: 'monster', imprisoned: false, openExits: { N: false, S: false } };

const POINT_IDS: readonly PointId[] = ['A', 'B'];
const EXIT_IDS: readonly ExitId[] = ['N', 'S'];

/** 지도 크기 (가져온 값을 지역 상수로: 자주 도는 반복문에서 모듈 바인딩을 매번 읽지 않게) */
const W = MAP_W;
const H = MAP_H;

const WALKABLE = new Uint8Array(W * H);
for (let j = 0; j < H; j += 1) {
  for (let i = 0; i < W; i += 1) WALKABLE[j * W + i] = blocksMove(i, j, OPEN_CTX) ? 0 : 1;
}

function walkable(i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < W && j < H && WALKABLE[j * W + i] === 1;
}

function walkableAt(p: Vec2): boolean {
  return walkable(Math.floor(p.x), Math.floor(p.y));
}

const notWalkable: BlockFn = (i, j) => !walkable(i, j);

/** p가 바닥이면 그대로, 아니면 가장 가까운 바닥 칸 중심 (반경 4칸 안) */
function snapToFloor(p: Vec2): Vec2 {
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

function fieldFrom(anchor: Vec2): Float32Array {
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
function pathDist(f: Float32Array, p: Vec2): number {
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
function localPathDist(from: Vec2, to: Vec2, limit: number): number {
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
const OPEN_RADIUS = 10;
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

function opennessOf(index: number): number {
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

/** 감옥 감시 자리: 캠핑 반경(철창 바깥 4칸) 밖에서 구조 지점이 보이는 곳 (도착 여유를 빼도 반경 밖) */
export const WATCH_SPOTS: readonly Vec2[] = [
  { x: 24, y: 23.5 },
  { x: 17.3, y: 18.5 },
  { x: 30.7, y: 18.5 },
].map(snapToFloor);
/** 감시 자리 도착 판정 (타일) */
const WATCH_TOLERANCE = 0.3;

/** 탈출구 문 칸 안쪽 (들어가면 탈출) */
const EXIT_DOORS: Readonly<Record<ExitId, Vec2>> = { N: { x: 24, y: 0.5 }, S: { x: 24, y: 31.5 } };
/** 탈출구 안쪽 방향 (문에서 맵 안으로) */
const EXIT_INWARD: Readonly<Record<ExitId, number>> = { N: 1, S: -1 };

function unit(dx: number, dy: number): Vec2 {
  const d = Math.hypot(dx, dy);
  return d < 1e-9 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
}

/** 몸 반지름만큼 양옆으로 벌린 세 직선이 모두 바닥 위인가 (곧장 가도 벽에 걸리지 않는가) */
function clearPath(a: Vec2, b: Vec2, r: number): boolean {
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

function brainRng(seed: number, role: Role): Rng {
  return new Rng((Math.imul(seed | 0, 0x9e3779b1) ^ ROLE_SALT[role]) >>> 0);
}

// ───────────────────────── 괴물 ─────────────────────────

/** 공격: 준비(0.4초) 끝 예상 거리가 사거리 + 생존자 반지름 - 이 여유 안이면 누른다 (타일) */
const ATTACK_MARGIN = 0.25;
/** 공격을 누를 때 조준과 표적 방향의 최대 차이 (라디안). 준비 중에는 조준이 고정된다 */
const ATTACK_FACING = 0.4;
/** 공격은 지금 거리가 사거리 + 이만큼(타일) 안일 때만 (다가오는 속도 추정이 틀려 헛치지 않게) */
const ATTACK_NOW_SLACK = 0.55;
/** 다가오는 속도는 이만큼(타일/초)까지만 믿는다 (방향을 자주 바꾼다) */
const APPROACH_TRUST = 1.0;
/** 돌진: 표적까지 이 거리 범위에서만 (타일). 돌진 4타일 뒤 바로 공격할 수 있는 거리 */
const DASH_MIN = 2.8;
const DASH_MAX = 4.4;
/** 돌진 주사위 확률 (최소 + 시드 범위): 사람처럼 매번 쓰지는 않는다 */
const DASH_CHANCE_MIN = 0.45;
const DASH_CHANCE_SPAN = 0.3;
/** 새로 보인 생존자에게 공격 · 돌진하기까지 반응 시간 (초) */
const REACT_TIME = 0.25;
/** 돌진 조준 허용 오차 (라디안). 돌진은 지금 조준 방향으로 나간다 */
const DASH_FACING = 0.12;
/** 돌진은 공격 쿨이 이만큼 이하로 남았을 때만 (돌진 끝에 바로 때리게, 초) */
const DASH_ATTACK_CD_MAX = 0.4;
/** 돌진 기회를 놓쳤으면(주사위 실패) 다시 굴릴 때까지 (초) */
const DASH_REROLL = 2.0;
/** 이 거리 안이고 직선이 비어 있으면 길찾기 없이 곧장 쫓는다 (타일) */
const DIRECT_CHASE = 3.5;
/** 추적 중 표적의 이동을 내다보는 최대 시간 (초) */
const CHASE_LEAD_MAX = 0.35;
/** 보호 중인 생존자는 이만큼 먼 것으로 친다 (타일): 다른 표적이 있으면 그쪽 */
const PROTECTED_PENALTY = 8;
/** 지금 쫓는 표적을 유지하는 덤 (타일): 비슷하면 표적을 바꾸지 않는다 */
const KEEP_TARGET_BONUS = 1.5;
/** 놓친 표적: 마지막 위치에서 이만큼 앞(초)을 찾아간다. 최대 거리(타일) */
const LOST_LEAD = 0.8;
const LOST_LEAD_MAX = 4;
/** 놓친 표적을 찾는 시간 (초) */
const LOST_TIME = 4;
/** 조사 지점에 닿은 뒤 둘러보는 시간 (초) */
const LOOK_TIME = 1.8;
/** 거점에 닿았는데 아무도 없으면 반경 바로 바깥에서 기다리는 시간 (초, 최소 + 시드 범위) */
const AMBUSH_MIN = 6;
const AMBUSH_SPAN = 6;
/** 기다리는 자리: 거점 반경에서 이만큼 바깥 (타일) */
const AMBUSH_OUT = 0.7;
/** 조사 지점까지 가는 시간 한도 (초) */
const GOAL_TIME = 25;
/** 조사 지점에 닿아 아무도 없을 때 포효할 확률 */
const ROAR_AT_LOOK_PROB = 0.35;
/** 쫓던 생존자를 놓쳤을 때 바로 포효할 확률 (반경 안이면 다시 찾는다) */
const ROAR_ON_LOST_PROB = 0.5;
/** 아무도 못 본 채 이만큼(초, 최소 + 시드 범위) 지나면 포효 */
const ROAR_IDLE_MIN = 14;
const ROAR_IDLE_SPAN = 14;
/** 순찰 중 가운데 모퉁이에 들를 확률 (지점마다) */
const DETOUR_PROB = 0.3;
/** 거점이 남아 있으면 순찰 대신 안 끝난 거점을 번갈아 지킬 확률 (할 일이 없을 때마다) */
const POINT_PATROL_PROB = 0.65;
/** 순찰을 고르면 이만큼(순찰 지점 수, 최소 + 시드 범위) 돈 뒤 다시 고른다 */
const PATROL_LEGS_MIN = 1;
const PATROL_LEGS_SPAN = 3;
/** 감옥 감시: 서 있는 시간(초, 최소 + 시드 범위), 다음 감시까지 (초, 최소 + 시드 범위) */
const WATCH_MIN = 4;
const WATCH_SPAN = 4;
const WATCH_GAP_MIN = 12;
const WATCH_GAP_SPAN = 12;
/** 생존자를 가둔 직후 감옥 감시로 갈 확률 (구조하러 올 것이다) */
const WATCH_AFTER_JAIL_PROB = 0.85;
/** 감옥 캠핑 경고 전에 스스로 나가는 시간 (초, 규칙의 경고 3초 · 감속 5초보다 앞) */
const CAMP_LEAVE = 2.5;
/** 거점 안에 이만큼(초) 있으면 반경 밖으로 한 번 나갔다 온다 (규칙의 유예 5초보다 앞) */
const POINT_STAY_MAX = 3.5;
/** 시야 버튼을 다시 누르기까지 최소 틱 (스냅샷에 바뀐 모드가 오기 전에 또 눌러 되돌리지 않게) */
const MODE_PRESS_GAP = 10;
/** 조사하러 가는 길: 목표가 이보다 멀면 추적 시야 (타일) */
const GOAL_HUNT_DIST = 6;
/** 막힘 판정: 이 틱 동안 이만큼(타일)도 못 움직였으면 다음 지점으로 */
const STUCK_TICKS = 45;
const STUCK_MOVE = 0.3;
/** 둘러보기 · 순찰 조준 흔들기 폭 (라디안)과 속도 (라디안/틱) */
const SWEEP_AMP_LOOK = 1.1;
const SWEEP_AMP_PATROL = 0.45;
const SWEEP_RATE = 0.09;

interface Sighting {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tick: number;
  prot: boolean;
  /** 이번에 처음 보인 틱 (반응 시간) */
  since: number;
}

type GoalKind = 'lost' | 'point' | 'roar' | 'exit' | 'rescue' | 'watch';

interface Goal {
  kind: GoalKind;
  x: number;
  y: number;
  /** 이 틱까지 못 닿으면 포기 */
  until: number;
  /** 닿은 뒤 둘러보기 끝 틱 (아직 안 닿았으면 null) */
  lookUntil: number | null;
  /** 둘러볼 중심 방향 (null이면 닿을 때의 조준) */
  aim: number | null;
  /** 닿은 뒤 포효 주사위를 굴렸는가 */
  rolled: boolean;
}

const GOAL_PRIORITY: Readonly<Record<GoalKind, number>> = {
  watch: 0,
  rescue: 1,
  point: 2,
  roar: 2,
  exit: 2,
  lost: 3,
};

export class PracticeMonsterBrain implements BotBrain {
  private readonly rng: Rng;
  private readonly walker = new Walker();
  private hz = 30;
  private lastObserved = -1;
  private now = 0;
  /** 임시 ID별 최근 모습 (속도 추정용). 결정은 위치로만 하고 ID 값 자체에는 기대지 않는다 */
  private readonly tracks = new Map<string, Sighting>();
  private chase: Sighting | null = null;
  private lastSawFree = 0;
  private goal: Goal | null = null;
  private loopIdx: number;
  private readonly loopStep: 1 | -1;
  private detour: Vec2 | null = null;
  private modePressSeq = -1e9;
  private roarIdle: number;
  private campTicks = 0;
  private readonly pointTicks: Record<PointId, number> = { A: 0, B: 0 };
  private stepOut: { x: number; y: number; until: number } | null = null;
  private nextWatchAt = 0;
  private readonly dashChance: number;
  private dashBlockedUntil = 0;
  private sweep = 0;
  private stuckFrom: { x: number; y: number; tick: number } | null = null;
  /** 남은 순찰 구간 수 (0이면 할 일이 없을 때 거점 지키기와 순찰 중에 다시 고른다) */
  private patrolLegs = 0;
  private lastGuarded: PointId | null = null;
  /** 다음 기회에 포효 (쫓던 생존자를 놓쳤을 때) */
  private roarNow = false;

  constructor(seed: number) {
    this.rng = brainRng(seed, 'monster');
    this.loopIdx = this.rng.int(MONSTER_LOOP.length);
    this.loopStep = this.rng.next() < 0.5 ? 1 : -1;
    this.roarIdle = ROAR_IDLE_MIN + this.rng.next() * ROAR_IDLE_SPAN;
    this.dashChance = DASH_CHANCE_MIN + this.rng.next() * DASH_CHANCE_SPAN;
    this.sweep = this.rng.next() * Math.PI * 2;
  }

  private sec(s: number): number {
    return Math.round(s * this.hz);
  }

  decide(snap: Snapshot, info: MatchInfo, b: Balance, seq: number): InputFrame {
    const mon = snap.you.mon;
    if (!mon) return emptyInput(seq);
    this.hz = info.tickHz > 0 ? info.tickHz : b.network.serverTickHz;
    this.observe(snap, b);
    const me = snap.you.move;
    const out: InputFrame = { seq, mx: 0, my: 0, aim: me.face, held: 0, pressed: 0 };
    const firstStop = MONSTER_LOOP[this.loopIdx] ?? MONSTER_LOOP[0] ?? me;
    if (snap.world.monsterWait > 0 || me.frozen > 0) {
      out.aim = aimAt(me, firstStop);
      return out;
    }
    this.sweep += SWEEP_RATE;
    let mode: VisionModeId = 'search';
    const target = this.pickTarget(snap);
    const slowedInCamp = snap.world.imprisoned > 0 && mon.camp >= 2;
    if (target && !slowedInCamp) {
      this.chaseTarget(snap, b, target, out);
      mode = 'hunt';
    } else {
      mode = this.roam(snap, b, out);
    }
    // 시야 모드: 원하는 모드와 다르면 한 번 누르고, 스냅샷에 반영될 때까지 다시 누르지 않는다
    if (mon.mode !== mode && me.stun <= 0 && seq - this.modePressSeq >= MODE_PRESS_GAP) {
      out.pressed |= BTN.MODE;
      this.modePressSeq = seq;
    }
    return out;
  }

  /** 새 스냅샷일 때만: 이벤트 · 보이는 생존자 기록 */
  private observe(snap: Snapshot, b: Balance): void {
    if (snap.tick === this.lastObserved) return;
    const prevTick = this.lastObserved;
    const elapsed = prevTick >= 0 ? snap.tick - prevTick : 0;
    this.lastObserved = snap.tick;
    this.now = snap.tick;
    const me = snap.you.move;
    for (const ev of snap.events) {
      if (ev.k === 'roarPings') {
        // 감옥 안(수감자)은 빼고 가장 가까운 핑
        let best: Vec2 | null = null;
        for (const p of ev.pts) {
          if (distToRect(p, PRISON_RECT) <= 0.3) continue;
          if (!best || dist(me, p) < dist(me, best) - 1e-9) best = p;
        }
        if (best) this.setGoal('roar', snapToFloor(best), null);
      } else if (ev.k === 'text') {
        if (ev.id === 'ALERT_CAPTURE_START' && ev.point) this.pointGoal(ev.point, me, b);
        else if (ev.id === 'ALERT_EXIT_OPEN' && ev.exit) {
          const c = EXITS[ev.exit].center;
          this.setGoal('exit', { x: c.x, y: c.y + EXIT_INWARD[ev.exit] * 1.5 }, null);
        } else if (ev.id === 'ALERT_RESCUED') {
          this.setGoal('rescue', { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 2 }, null);
        }
      } else if (ev.k === 'imprisoned') {
        // 방금 가둔 표적은 놓친 것이 아니다. 구조하러 올 테니 자주 곧장 감옥 감시로
        this.chase = null;
        if (this.rng.next() < WATCH_AFTER_JAIL_PROB) this.goal = this.watchGoal(me);
      }
    }
    // 보이는 생존자: 같은 임시 ID가 이어서 보이면 속도를 잰다
    const dtSec = elapsed / this.hz;
    const seenNow = new Set<string>();
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      seenNow.add(s.id);
      const prev = this.tracks.get(s.id);
      let vx = 0;
      let vy = 0;
      if (prev && dtSec > 0 && snap.tick - prev.tick <= 3) {
        const k = 0.6;
        vx = prev.vx * (1 - k) + ((s.x - prev.x) / dtSec) * k;
        vy = prev.vy * (1 - k) + ((s.y - prev.y) / dtSec) * k;
        const sp = Math.hypot(vx, vy);
        const cap = b.survivor.moveSpeed * b.roles.runner.sprintMultiplier;
        if (sp > cap) {
          vx = (vx / sp) * cap;
          vy = (vy / sp) * cap;
        }
      }
      const since = prev ? prev.since : snap.tick;
      this.tracks.set(s.id, { id: s.id, x: s.x, y: s.y, vx, vy, tick: snap.tick, prot: s.protected, since });
      this.lastSawFree = snap.tick;
    }
    for (const [id, t] of this.tracks)
      if (!seenNow.has(id) && snap.tick - t.tick > 30) this.tracks.delete(id);
    // 놓친 표적: 마지막 모습에서 조금 앞을 찾아간다
    if (this.chase && !seenNow.has(this.chase.id)) {
      const c = this.chase;
      let lx = c.vx * LOST_LEAD;
      let ly = c.vy * LOST_LEAD;
      const l = Math.hypot(lx, ly);
      if (l > LOST_LEAD_MAX) {
        lx = (lx / l) * LOST_LEAD_MAX;
        ly = (ly / l) * LOST_LEAD_MAX;
      }
      const ahead = { x: c.x + lx, y: c.y + ly };
      const spot = clearPath(c, ahead, 0.2) ? snapToFloor(ahead) : snapToFloor(c);
      this.chase = null;
      this.setGoal('lost', spot, l > 0.1 ? Math.atan2(ly, lx) : null, LOST_TIME);
      this.roarNow = this.rng.next() < ROAR_ON_LOST_PROB;
    }
    // 거점 안 머문 시간 (규칙: 거점 반경 안 연속 시간)
    for (const id of POINT_IDS) {
      const inside = dist(me, CAPTURE_POINTS[id]) <= b.capturePoint.radius;
      this.pointTicks[id] = inside ? this.pointTicks[id] + elapsed : 0;
    }
    const inCamp = distToRect(me, PRISON_RECT) <= b.prison.campRadius;
    this.campTicks = snap.world.imprisoned > 0 && inCamp ? this.campTicks + elapsed : 0;
  }

  /** 거점 조사: 반경 바로 바깥, 내가 오는 쪽에 서서 거점을 바라본다 */
  private pointGoal(id: PointId, me: Vec2, b: Balance): void {
    const c = CAPTURE_POINTS[id];
    const u = unit(me.x - c.x, me.y - c.y);
    const dir = u.x === 0 && u.y === 0 ? { x: 1, y: 0 } : u;
    const r = b.capturePoint.radius + AMBUSH_OUT;
    const at = snapToFloor({ x: c.x + dir.x * r, y: c.y + dir.y * r });
    this.setGoal('point', at, aimAt(at, c));
  }

  private setGoal(kind: GoalKind, at: Vec2, aim: number | null, seconds = GOAL_TIME): void {
    const cur = this.goal;
    if (cur && GOAL_PRIORITY[cur.kind] > GOAL_PRIORITY[kind] && cur.until > this.now) return;
    this.goal = {
      kind,
      x: at.x,
      y: at.y,
      until: this.now + this.sec(seconds),
      lookUntil: null,
      aim,
      rolled: false,
    };
    this.stuckFrom = null;
  }

  /** 쫓을 생존자: 가까운 자유 생존자, 보호 중이면 뒤로. 같으면 위치 순 (배열 순서 · 임시 ID에 기대지 않는다) */
  private pickTarget(snap: Snapshot): Sighting | null {
    const me = snap.you.move;
    let best: SurvivorView | null = null;
    let bestScore = Infinity;
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      let score = dist(me, s) + (s.protected ? PROTECTED_PENALTY : 0);
      if (this.chase && this.chase.id === s.id) score -= KEEP_TARGET_BONUS;
      const tie = Math.abs(score - bestScore) <= 1e-9;
      if (score < bestScore - 1e-9 || (tie && best && (s.x < best.x || (s.x === best.x && s.y < best.y)))) {
        best = s;
        bestScore = score;
      }
    }
    if (!best) return null;
    const t = this.tracks.get(best.id) ?? {
      id: best.id,
      x: best.x,
      y: best.y,
      vx: 0,
      vy: 0,
      tick: this.now,
      prot: best.protected,
      since: this.now,
    };
    if (!this.chase || this.chase.id !== t.id) this.dashBlockedUntil = 0;
    this.chase = t;
    // 쫓는 동안 조사 목표는 잊는다 (놓치면 새로 정한다)
    if (this.goal && this.goal.kind !== 'watch') this.goal = null;
    return t;
  }

  private chaseTarget(snap: Snapshot, b: Balance, t: Sighting, out: InputFrame): void {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (!mon) return;
    const d = dist(me, t);
    const lead = Math.min(CHASE_LEAD_MAX, d / b.monster.moveSpeed);
    const predRaw = { x: t.x + t.vx * lead, y: t.y + t.vy * lead };
    const pred = walkableAt(predRaw) ? predRaw : { x: t.x, y: t.y };
    if (d < DIRECT_CHASE && clearPath(me, pred, b.monster.radius)) {
      const u = unit(pred.x - me.x, pred.y - me.y);
      out.mx = u.x;
      out.my = u.y;
    } else {
      const w = this.walker.toward(snap, pred, 0.2);
      out.mx = w.mx;
      out.my = w.my;
    }
    const wind = b.monster.attack.windup;
    const strike = { x: t.x + t.vx * wind, y: t.y + t.vy * wind };
    out.aim = aimAt(me, strike);
    const canAct = me.stun <= 0 && me.dash <= 0 && mon.windup <= 0;
    if (!canAct || t.prot || this.now - t.since < this.sec(REACT_TIME)) return;
    // 공격: 준비가 끝날 때 예상 거리 (표적이 멀어지는 속도만큼 덜 따라잡는다)
    const u = unit(t.x - me.x, t.y - me.y);
    const away = Math.max(-APPROACH_TRUST, t.vx * u.x + t.vy * u.y);
    const closing = b.monster.moveSpeed * b.monster.attack.windupMoveMultiplier - away;
    const contact = b.monster.radius + b.survivor.radius;
    const gap = Math.max(contact, d - closing * wind);
    const reach = b.monster.attack.range + b.survivor.radius - ATTACK_MARGIN;
    const facing = Math.abs(angleDiff(me.face, aimAt(me, strike)));
    if (mon.attackCd <= 0 && gap <= reach && d <= reach + ATTACK_NOW_SLACK && facing <= ATTACK_FACING) {
      out.pressed |= BTN.ATTACK;
      return;
    }
    // 돌진: 중간 거리 · 직선 · 조준이 맞을 때, 공격이 곧 준비되면 (주사위로 가끔)
    if (mon.dashCd > 0 || mon.attackCd > DASH_ATTACK_CD_MAX) return;
    if (d < DASH_MIN || d > DASH_MAX) return;
    const dur = b.monster.dash.duration;
    const after = { x: t.x + t.vx * dur, y: t.y + t.vy * dur };
    const dashDir = aimAt(me, after);
    out.aim = dashDir;
    if (Math.abs(angleDiff(me.face, dashDir)) > DASH_FACING) return;
    const reachEnd = Math.min(b.monster.dash.distance, dist(me, after));
    const end = { x: me.x + Math.cos(dashDir) * reachEnd, y: me.y + Math.sin(dashDir) * reachEnd };
    if (!clearPath(me, end, b.monster.radius)) return;
    if (this.now < this.dashBlockedUntil) return;
    if (this.rng.next() < this.dashChance) out.pressed |= BTN.DASH;
    else this.dashBlockedUntil = this.now + this.sec(DASH_REROLL);
  }

  /** 아무도 안 보일 때: 캠핑 · 거점 유예 피하기 → 조사 → 감옥 감시 → 순찰. 원하는 시야 모드를 돌려준다 */
  private roam(snap: Snapshot, b: Balance, out: InputFrame): VisionModeId {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (!mon) return 'search';
    const ready = me.stun <= 0 && me.dash <= 0 && mon.windup <= 0;
    // 한동안 아무도 못 봤거나 방금 놓쳤으면 포효
    if (
      ready &&
      mon.roarCd <= 0 &&
      (this.roarNow || this.now - this.lastSawFree >= this.sec(this.roarIdle))
    ) {
      out.pressed |= BTN.ROAR;
      this.lastSawFree = this.now;
      this.roarIdle = ROAR_IDLE_MIN + this.rng.next() * ROAR_IDLE_SPAN;
    }
    this.roarNow = false;
    // 감옥 캠핑: 경고 전에 감시 자리로 나간다 (감시 자리는 반경 밖)
    if (snap.world.imprisoned > 0 && (mon.camp >= 1 || this.campTicks >= this.sec(CAMP_LEAVE))) {
      if (!this.goal || this.goal.kind !== 'watch') this.goal = this.watchGoal(me);
    }
    // 거점 지키기 유예 (안 끝난 거점만 해당): 반경 밖으로 한 번 나갔다 온다
    if (!this.stepOut) {
      for (const id of POINT_IDS) {
        if (this.pointTicks[id] < this.sec(POINT_STAY_MAX)) continue;
        if (snap.world.points.some((p) => p.id === id && p.state === 'done')) continue;
        const c = CAPTURE_POINTS[id];
        const u = unit(me.x - c.x, me.y - c.y);
        const dir = u.x === 0 && u.y === 0 ? { x: 1, y: 0 } : u;
        const r = b.capturePoint.radius + 1.0;
        const p = snapToFloor({ x: c.x + dir.x * r, y: c.y + dir.y * r });
        this.stepOut = { x: p.x, y: p.y, until: this.now + this.sec(1.5) };
      }
    }
    if (this.stepOut) {
      const s = this.stepOut;
      const w = this.walker.toward(snap, s, 0.3);
      out.mx = w.mx;
      out.my = w.my;
      out.aim = w.mx !== 0 || w.my !== 0 ? Math.atan2(w.my, w.mx) : me.face;
      if (w.arrived || this.now >= s.until) this.stepOut = null;
      return 'search';
    }
    // 둘 이상 갇혀 있으면 감옥 감시가 먼저 (한 명만 더 잡으면 이긴다)
    const guardPrison = snap.world.imprisoned >= 2;
    if (guardPrison && (!this.goal || this.goal.kind === 'point') && this.now >= this.nextWatchAt) {
      this.goal = this.watchGoal(me);
    }
    // 점령 중인 거점 (괴물 화면 배지): 진행이 많은 쪽으로
    if (!this.goal || (this.goal.kind === 'watch' && !guardPrison)) {
      let best: PointId | null = null;
      let bestProgress = -1;
      for (const p of snap.world.points) {
        if ((p.state === 'capturing' || p.state === 'blocked') && p.progress > bestProgress) {
          best = p.id;
          bestProgress = p.progress;
        }
      }
      if (best) this.pointGoal(best, me, b);
    }
    // 감옥 감시: 갇힌 사람이 있고 할 일이 없으면 가끔
    if (!this.goal && snap.world.imprisoned > 0 && this.now >= this.nextWatchAt) {
      this.goal = this.watchGoal(me);
    }
    // 할 일이 없으면: 안 끝난 거점을 번갈아 지키거나, 순찰을 몇 구간 돈다
    const exitsOn = snap.world.exits.some((e) => e.state !== 'inactive');
    if (!this.goal && this.patrolLegs <= 0 && !exitsOn) {
      const undone = snap.world.points.filter((p) => p.state !== 'done').map((p) => p.id);
      if (undone.length > 0 && this.rng.next() < POINT_PATROL_PROB) {
        const next = undone.find((id) => id !== this.lastGuarded) ?? undone[0] ?? 'A';
        this.lastGuarded = next;
        this.pointGoal(next, me, b);
      } else {
        this.patrolLegs = PATROL_LEGS_MIN + this.rng.int(PATROL_LEGS_SPAN);
      }
    }
    if (this.goal) return this.followGoal(snap, this.goal, out, ready);
    return this.patrol(snap, out);
  }

  private watchGoal(me: Vec2): Goal {
    let best = WATCH_SPOTS[0] ?? RESCUE_POINT;
    let bestD = Infinity;
    for (const s of WATCH_SPOTS) {
      const d = pathDist(fieldFrom(s), me);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = s;
      }
    }
    this.nextWatchAt =
      this.now + this.sec(WATCH_MIN + WATCH_SPAN + WATCH_GAP_MIN + this.rng.next() * WATCH_GAP_SPAN);
    return {
      kind: 'watch',
      x: best.x,
      y: best.y,
      until: this.now + this.sec(GOAL_TIME),
      lookUntil: null,
      aim: aimAt(best, RESCUE_POINT),
      rolled: true,
    };
  }

  private followGoal(snap: Snapshot, g: Goal, out: InputFrame, ready: boolean): VisionModeId {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (g.lookUntil === null) {
      const w = this.walker.toward(snap, g, g.kind === 'watch' ? WATCH_TOLERANCE : 0.6);
      out.mx = w.mx;
      out.my = w.my;
      const moving = w.mx !== 0 || w.my !== 0;
      out.aim = moving ? Math.atan2(w.my, w.mx) + Math.sin(this.sweep) * SWEEP_AMP_PATROL : me.face;
      if (w.arrived || this.stuck(me, moving)) {
        const look =
          g.kind === 'watch'
            ? WATCH_MIN + this.rng.next() * WATCH_SPAN
            : g.kind === 'point'
              ? AMBUSH_MIN + this.rng.next() * AMBUSH_SPAN
              : LOOK_TIME;
        g.lookUntil = this.now + this.sec(look);
        if (g.aim === null) g.aim = me.face;
      } else if (this.now >= g.until) {
        this.goal = null;
      }
      return dist(me, g) > GOAL_HUNT_DIST || g.kind === 'lost' ? 'hunt' : 'search';
    }
    // 둘러보기
    const base = g.aim ?? me.face;
    if (g.kind === 'watch' || g.kind === 'point') {
      out.aim = base + Math.sin(this.sweep) * (g.kind === 'watch' ? 0.3 : 0.7);
    } else {
      out.aim = base + Math.sin(this.sweep * 1.4) * SWEEP_AMP_LOOK;
      if (!g.rolled) {
        g.rolled = true;
        if (ready && mon && mon.roarCd <= 0 && this.rng.next() < ROAR_AT_LOOK_PROB) {
          out.pressed |= BTN.ROAR;
          this.lastSawFree = this.now;
        }
      }
    }
    if (this.now >= g.lookUntil) this.goal = null;
    return g.kind === 'watch' || g.kind === 'point' ? 'hunt' : 'search';
  }

  private patrol(snap: Snapshot, out: InputFrame): VisionModeId {
    const me = snap.you.move;
    const exitsOn = snap.world.exits.some((e) => e.state !== 'inactive');
    const loop = exitsOn ? MONSTER_EXIT_LOOP : MONSTER_LOOP;
    const n = loop.length;
    const idx = ((this.loopIdx % n) + n) % n;
    const stop = this.detour ?? loop[idx] ?? me;
    const w = this.walker.toward(snap, stop, 1.0);
    out.mx = w.mx;
    out.my = w.my;
    const moving = w.mx !== 0 || w.my !== 0;
    out.aim = moving ? Math.atan2(w.my, w.mx) + Math.sin(this.sweep) * SWEEP_AMP_PATROL : me.face + 0.1;
    if (w.arrived || this.stuck(me, moving)) {
      if (this.detour) this.detour = null;
      else {
        this.patrolLegs -= 1;
        this.loopIdx = idx + this.loopStep;
        if (!exitsOn && snap.world.imprisoned === 0 && this.rng.next() < DETOUR_PROB) {
          this.detour = this.rng.pick(MONSTER_CROSS);
        }
      }
      this.stuckFrom = null;
    }
    return 'search';
  }

  /** 움직이려는데 STUCK_TICKS 동안 거의 못 움직였는가 */
  private stuck(me: Vec2, moving: boolean): boolean {
    if (!moving) {
      this.stuckFrom = null;
      return false;
    }
    const s = this.stuckFrom;
    if (!s || dist(s, me) > STUCK_MOVE) {
      this.stuckFrom = { x: me.x, y: me.y, tick: this.now };
      return false;
    }
    if (this.now - s.tick >= STUCK_TICKS) {
      this.stuckFrom = null;
      return true;
    }
    return false;
  }
}

// ───────────────────────── 생존자 ─────────────────────────

/** 괴물이 이 거리(타일) 안에 보이면 달아난다 (역할별) */
const FLEE_DIST: Readonly<Record<RoleId, number>> = { runner: 6.5, guard: 6.0, scout: 7.0 };
/** 부상(체력 1)이면 도주 거리에 더한다 (타일) */
const FLEE_INJURED_BONUS = 1.0;
/** 이미 달아나는 중이면 이만큼 더 멀어질 때까지 계속 (타일) */
const FLEE_HYST = 1.5;
/** 밀치기가 준비된 가드는 이 거리까지 버틴다 (타일) */
const GUARD_HOLD_DIST = 2.4;
/** 괴물이 안 보인 뒤에도 이만큼(초) 계속 달아난다 */
const FLEE_MEMORY = 2.0;
/** 괴물은 안 보이는데 내가 발각 중이면, 이만큼(초) 안에 본 괴물 위치에서 달아난다 */
const SPOTTED_MEMORY = 3.0;
/** 이보다 가까우면(타일) 길찾기 대신 곧장 반대쪽으로 */
const CLOSE_EVADE = 1.9;
/** 도주 지점 다시 고르는 간격 (틱)과 바꾸는 문턱 (점수) */
const FLEE_REPLAN_TICKS = 6;
const FLEE_KEEP = 1.5;
/** 도주 지점 점수: 괴물 길 거리 - 비율 × 내 길 거리 (괴물이 10% 빠르다) */
const FLEE_SPEED_RATIO = 1.15;
/** 도주 지점 점수: 괴물에게서 먼 곳 가중치, 괴물에게서 안 보이는 곳 덤 */
const FLEE_FAR_WEIGHT = 0.3;
const FLEE_HIDDEN_BONUS = 2.5;
/** 도주 지점은 내게서 최소 이만큼(타일) */
const FLEE_MIN_SPOT = 2.5;
/** 도주 · 기다리는 자리 점수: 열린 정도(이웃 후보 수) 가중치. 구석으로 몰리지 않게 */
const OPEN_WEIGHT = 0.6;
/** 함께 달아나는 동료가 이 거리(타일) 안이면 갈라진다 (한 번 휘두르기에 둘이 맞지 않게) */
const SPLIT_RADIUS = 3;
/** 갈라지기: ID 순서로 한쪽은 왼쪽, 한쪽은 오른쪽 도주 지점에 주는 점수 */
const SPLIT_BIAS = 4;
/** 괴물이 최근(초) 이 거리(타일) 안에서 보인 목표는 위험하다고 보고 피한다 */
const HOT_TIME = 10;
const HOT_RADIUS = 7;
/** 최근 본 괴물이 이 거리(타일) 안이고 목표에 나보다 가까우면(가는 길에 있으면) 그 목표도 위험 */
const ROUTE_DANGER = 9;
/** 기다리는 자리를 다시 고르는 간격 (틱) */
const LURK_REPLAN_TICKS = 30;
/** 위험한 목표 근처에서 기다리는 자리: 목표에서 이 길 거리쯤 (타일) */
const LURK_DIST = 10;
/** 기다리는 자리는 괴물보다 이만큼(점수: 괴물 길 거리 - 1.15 × 내 길 거리) 먼저 닿는 곳만 */
const LURK_SAFE = 3;
/** 구조 담당: 나보다 이만큼(타일) 넘게 가까운 동료가 있으면 그 동료에게 맡긴다 */
const RESCUE_SLACK = 2.5;
/** 이 진행도 이상이면 괴물이 와도 마무리한다 (구조 · 탈출구), 단 괴물이 이 거리(타일)보다 가까우면 달아난다 */
const COMMIT_RESCUE = 0.55;
const COMMIT_EXIT = 0.4;
const COMMIT_MIN_DIST = 1.8;
/** 열린 탈출구 문까지 이 거리(타일) 안이면 괴물을 무시하고 뛰어든다 */
const COMMIT_DOOR = 3.5;
/** 내가 있는 거점 진행도가 이 이상이면 구조보다 마무리를 먼저 */
const FINISH_POINT = 0.8;
/** 러너 질주: 달아나는 중 괴물이 이 거리(타일) 안이면 */
const SPRINT_DIST = 3.5;
/** 가드 밀치기: 사거리에서 이만큼(타일) 안쪽이면 (스냅샷이 1~2틱 늦다) */
const SHOVE_MARGIN = 0.25;
/** 스카우트 탐지: 괴물 정보가 이만큼(초, 최소 + 시드 범위) 없을 때 할 일 중이면 */
const TRACK_IDLE_MIN = 8;
const TRACK_IDLE_SPAN = 8;
/** 스카우트 탐지: 구조하러 가는 중에는 괴물 정보가 이만큼(초)만 없어도 */
const TRACK_RESCUE_IDLE = 3;
/** 탈출구 바꾸기: 고른 문에서 이 거리(타일) 안에 괴물이 보이고, 다른 문은 이보다 멀 때 (타일), 다시 바꾸기까지 (초) */
const EXIT_SWITCH_NEAR = 5;
const EXIT_SWITCH_FAR = 12;
const EXIT_SWITCH_GAP = 10;
/** 거점에서 역할별로 서는 자리 (가운데에서 조금씩 비켜, 모두 반경 안) */
const POINT_OFFSET: Readonly<Record<RoleId, Vec2>> = {
  runner: { x: -0.8, y: 0 },
  guard: { x: 0.8, y: 0 },
  scout: { x: 0, y: 0.8 },
};
/** 탈출구에서 서는 자리 (가로 비킴, 안쪽으로 들어온 거리) */
const EXIT_OFFSET: Readonly<Record<RoleId, Vec2>> = {
  runner: { x: -0.5, y: 0.3 },
  guard: { x: 0.5, y: 0.3 },
  scout: { x: 0, y: 0.6 },
};

interface Threat {
  x: number;
  y: number;
  tick: number;
}

interface Task {
  kind: 'capture' | 'rescue' | 'exit' | 'door' | 'lurk' | 'idle';
  target: Vec2;
  tol: number;
  held: number;
  /** 괴물이 와도 버틸 진행 (COMMIT_MIN_DIST보다 멀면 달아나지 않는다) */
  commit: boolean;
}

interface Danger {
  x: number;
  y: number;
  d: number;
  fresh: boolean;
}

/** 팀 계획에서 셋이 한 거점에 함께 갈 확률 (아니면 둘 · 하나로 나뉜다) */
const TEAM_TOGETHER_PROB = 0.5;

/**
 * 생존자 팀이 함께 쓰는 계획 (같은 seed면 세 봇이 같은 계획): 먼저 갈 거점과, 혼자 다른 거점에 갈 역할(없으면 셋이 함께)
 */
function teamPlan(seed: number): { pair: PointId; solo: RoleId | null } {
  const r = new Rng((Math.imul(seed | 0, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0);
  const pair: PointId = r.next() < 0.5 ? 'A' : 'B';
  const together = r.next() < TEAM_TOGETHER_PROB;
  const solo: RoleId = r.next() < 0.5 ? 'runner' : 'scout';
  return { pair, solo: together ? null : solo };
}

export class PracticeSurvivorBrain implements BotBrain {
  private readonly rng: Rng;
  private readonly walker = new Walker();
  private hz = 30;
  private lastObserved = -1;
  private now = 0;
  private threat: Threat | null = null;
  /** 괴물 정보(보임 · 탐지 · 포효)를 마지막으로 받은 틱 */
  private lastInfo = 0;
  private fleeing = false;
  private fleeSpot: Vec2 | null = null;
  private fleeReplanAt = 0;
  private exitChoice: ExitId | null = null;
  private exitSwitchedAt = -1e9;
  private readonly codes: string[] = [];
  private readonly home: PointId;
  private trackIdle: number;
  private stuckFrom: { x: number; y: number; tick: number } | null = null;
  private wiggleUntil = 0;
  private wiggleDir: Vec2 = { x: 0, y: 0 };
  private lurk: { ax: number; ay: number; spot: Vec2; until: number } | null = null;
  private pathCache: { tick: number; cell: number; limit: number; d: number } | null = null;

  constructor(
    private readonly role: RoleId,
    seed: number,
  ) {
    this.rng = brainRng(seed, role);
    const plan = teamPlan(seed);
    this.home = plan.solo === role ? (plan.pair === 'A' ? 'B' : 'A') : plan.pair;
    this.trackIdle = TRACK_IDLE_MIN + this.rng.next() * TRACK_IDLE_SPAN;
  }

  private sec(s: number): number {
    return Math.round(s * this.hz);
  }

  decide(snap: Snapshot, info: MatchInfo, b: Balance, seq: number): InputFrame {
    this.hz = info.tickHz > 0 ? info.tickHz : b.network.serverTickHz;
    // 갇혀 있어도(죽어도) 관찰은 한다: 탈출구 선택이 팀 전원에게 같게 유지되도록
    this.observe(snap);
    const surv = snap.you.surv;
    if (!surv || surv.status !== 'free') return emptyInput(seq);
    const me = snap.you.move;
    const out: InputFrame = { seq, mx: 0, my: 0, aim: Number.NaN, held: 0, pressed: 0 };
    const task = this.task(snap, info, b);
    const danger = this.danger(snap, b, task);
    out.pressed |= this.ability(snap, b, danger, task);
    let mv: { mx: number; my: number; arrived: boolean };
    if (danger) {
      mv = this.flee(snap, b, danger);
    } else {
      this.fleeSpot = null;
      mv = this.walker.toward(snap, task.target, task.tol);
      if (task.held !== 0 && (mv.arrived || dist(me, task.target) <= task.tol + 0.4)) out.held = task.held;
    }
    // 막힘: 움직이려는데 못 움직이면 잠깐 옆으로
    if (this.now < this.wiggleUntil) {
      mv = { mx: this.wiggleDir.x, my: this.wiggleDir.y, arrived: false };
    } else if (this.stuck(me, mv.mx !== 0 || mv.my !== 0)) {
      const a = Math.atan2(mv.my, mv.mx) + (this.rng.next() < 0.5 ? 1.6 : -1.6);
      this.wiggleDir = { x: Math.cos(a), y: Math.sin(a) };
      this.wiggleUntil = this.now + 10;
      this.fleeSpot = null;
    }
    out.mx = mv.mx;
    out.my = mv.my;
    return out;
  }

  /** 새 스냅샷일 때만: 괴물 위치 기억, 메모 비밀번호, 탈출구 선택 */
  private observe(snap: Snapshot): void {
    if (snap.tick === this.lastObserved) return;
    this.lastObserved = snap.tick;
    this.now = snap.tick;
    let pos: Vec2 | null = snap.monster ? { x: snap.monster.x, y: snap.monster.y } : null;
    if (!pos) {
      for (const m of snap.marks) {
        if (m.kind === 'track' || (m.kind === 'roarSelf' && !pos)) pos = { x: m.x, y: m.y };
      }
    }
    if (pos) {
      this.threat = { x: pos.x, y: pos.y, tick: snap.tick };
      this.lastInfo = snap.tick;
    }
    for (const ev of snap.events) {
      if (ev.k === 'text' && ev.code && (ev.id === 'NOTE_FIRST' || ev.id === 'NOTE_SECOND'))
        this.codes.push(ev.code);
    }
    // 탈출구: 활성화된 첫 스냅샷에서 한 번 고른다. 팀 모두가 같은 스냅샷 정보로 고르므로 같은 문이 나온다
    const active = snap.world.exits.some((e) => e.state !== 'inactive');
    if (!active) return;
    if (this.exitChoice === null) {
      this.exitChoice = this.chooseExit();
      return;
    }
    // 고른 문 바로 앞에 괴물이 보이면(팀 모두 같은 스냅샷) 다른 문으로
    const cur = this.exitChoice;
    const other: ExitId = cur === 'N' ? 'S' : 'N';
    const curOpen = snap.world.exits.some((e) => e.id === cur && e.state === 'open');
    if (
      snap.monster &&
      !curOpen &&
      snap.tick - this.exitSwitchedAt >= this.sec(EXIT_SWITCH_GAP) &&
      dist(snap.monster, EXITS[cur].center) < EXIT_SWITCH_NEAR &&
      dist(snap.monster, EXITS[other].center) > EXIT_SWITCH_FAR
    ) {
      this.exitChoice = other;
      this.exitSwitchedAt = snap.tick;
    }
  }

  /** 괴물을 마지막으로 본 곳에서 길이 더 먼 문. 본 적이 없으면 두 번째 메모 비밀번호의 홀짝 */
  private chooseExit(): ExitId {
    const t = this.threat;
    if (t) {
      const dn = pathDist(fieldFrom(EXITS.N.center), t);
      const ds = pathDist(fieldFrom(EXITS.S.center), t);
      if (Math.abs(dn - ds) > 1e-6) return dn > ds ? 'N' : 'S';
    }
    const code = this.codes[this.codes.length - 1] ?? '0';
    return Number(code.charAt(code.length - 1)) % 2 === 0 ? 'N' : 'S';
  }

  /** 최근 본 괴물이 목표 가까이에 있거나, 내 근처에서 목표 쪽(나보다 목표에 가까운 곳)에 있었는가 */
  private hot(anchor: Vec2, me: Vec2): boolean {
    const t = this.threat;
    if (!t || this.now - t.tick > this.sec(HOT_TIME)) return false;
    if (dist(t, anchor) < HOT_RADIUS) return true;
    if (dist(t, me) >= ROUTE_DANGER) return false;
    const f = fieldFrom(anchor);
    return pathDist(f, t) < pathDist(f, me) + 1;
  }

  /** 할 일: 탈출 → 구조 → 점령 */
  private task(snap: Snapshot, info: MatchInfo, b: Balance): Task {
    const me = snap.you.move;
    const mates = snap.survivors;
    const freeMates = mates.filter((s) => s.status === 'free');
    const jailed = mates.filter((s) => s.status === 'imprisoned');
    const escaped = mates.filter((s) => s.status === 'escaped').length;
    const exitsOn = snap.world.exits.some((e) => e.state !== 'inactive');
    const anyOpen = snap.world.exits.some((e) => e.state === 'open');
    // 탈출: 나와 자유 동료 + 이미 탈출한 수가 승리 인원 이상이고, 열린 문이 있거나 둘이 함께 열 수 있을 때
    const need = b.exit.requiredSurvivors;
    if (exitsOn && 1 + freeMates.length + escaped >= need && (anyOpen || 1 + freeMates.length >= need)) {
      return this.exitTask(snap, info, b);
    }
    // 내 거점 마무리가 거의 다 됐으면 먼저 끝낸다
    const here = this.pointHere(snap, b);
    const finishing = here !== null && here.progress >= FINISH_POINT;
    const undone = snap.world.points.filter((p) => p.state !== 'done').map((p) => p.id);
    if (jailed.length > 0 && !finishing && this.isRescuer(snap, freeMates)) {
      const r = this.rescueTask(snap, b);
      // 감옥 근처가 위험하면 거점이 남아 있는 동안은 점령을 하다가 다시 본다 (모두 감옥 앞에서 기다리지 않게)
      if (r.kind !== 'lurk' || undone.length === 0 || freeMates.length === 0) return r;
    }
    if (undone.length > 0) {
      let goal: PointId = undone.includes(this.home) ? this.home : (undone[0] ?? this.home);
      const other = undone.find((p) => p !== goal);
      if (this.hot(CAPTURE_POINTS[goal], me) && other) {
        // 둘 다 위험하면 가까운 쪽 근처에서 기다린다
        if (
          !this.hot(CAPTURE_POINTS[other], me) ||
          dist(me, CAPTURE_POINTS[other]) < dist(me, CAPTURE_POINTS[goal])
        ) {
          goal = other;
        }
      }
      const c = CAPTURE_POINTS[goal];
      if (this.hot(c, me) && dist(me, c) > b.capturePoint.radius) {
        return { kind: 'lurk', target: this.lurkSpot(c, me), tol: 0.8, held: 0, commit: false };
      }
      const o = POINT_OFFSET[this.role];
      return {
        kind: 'capture',
        target: snapToFloor({ x: c.x + o.x, y: c.y + o.y }),
        tol: 0.4,
        held: 0,
        commit: false,
      };
    }
    if (jailed.length > 0) return this.rescueTask(snap, b);
    return { kind: 'idle', target: { x: me.x, y: me.y }, tol: 1, held: 0, commit: false };
  }

  /** 지금 서 있는 (안 끝난) 거점 */
  private pointHere(snap: Snapshot, b: Balance): { id: PointId; progress: number } | null {
    for (const p of snap.world.points) {
      if (p.state === 'done') continue;
      if (dist(snap.you.move, CAPTURE_POINTS[p.id]) <= b.capturePoint.radius)
        return { id: p.id, progress: p.progress };
    }
    return null;
  }

  /** 구조 담당인가: 구조 지점에 가장 가까운 자유 생존자 (비슷하면 둘 다 간다 — 아무도 안 가는 것보다 낫다) */
  private isRescuer(snap: Snapshot, freeMates: readonly SurvivorView[]): boolean {
    if (freeMates.length === 0) return true;
    if (freeMates.some((s) => (s.rescue ?? 0) > 0)) return false;
    const f = fieldFrom(RESCUE_POINT);
    const mine = pathDist(f, snap.you.move);
    let others = Infinity;
    for (const s of freeMates) others = Math.min(others, pathDist(f, s));
    return mine <= others + RESCUE_SLACK;
  }

  private rescueTask(snap: Snapshot, b: Balance): Task {
    const me = snap.you.move;
    const surv = snap.you.surv;
    const progress = surv?.rescue ?? 0;
    const inZone = dist(me, RESCUE_POINT) <= b.prison.rescueRadius - 0.2;
    const brave = this.role === 'guard' && (surv?.abilityCd ?? 1) <= 0;
    if (this.hot(RESCUE_POINT, me) && !inZone && !brave) {
      return { kind: 'lurk', target: this.lurkSpot(RESCUE_POINT, me), tol: 0.8, held: 0, commit: false };
    }
    return {
      kind: 'rescue',
      target: RESCUE_POINT,
      tol: 0.3,
      held: BTN.RESCUE,
      commit: inZone && progress >= COMMIT_RESCUE,
    };
  }

  private exitTask(snap: Snapshot, info: MatchInfo, b: Balance): Task {
    const me = snap.you.move;
    const open = EXIT_IDS.filter((id) => snap.world.exits.some((e) => e.id === id && e.state === 'open'));
    let choice: ExitId = this.exitChoice ?? 'N';
    // 사람 동료가 이미 다른 탈출구에 서 있으면 그쪽으로 (봇끼리는 같은 문을 고른다)
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      const human = info.roster.some((r) => r.id === s.id && !r.bot);
      if (!human) continue;
      for (const id of EXIT_IDS) if (dist(s, EXITS[id].center) <= b.exit.radius + 0.5) choice = id;
    }
    if (open.length > 0) {
      const id = open.includes(choice) ? choice : (open[0] ?? choice);
      const door = EXIT_DOORS[id];
      return { kind: 'door', target: door, tol: 0.05, held: 0, commit: dist(me, door) <= COMMIT_DOOR };
    }
    const c = EXITS[choice].center;
    const o = EXIT_OFFSET[this.role];
    const stand = { x: c.x + o.x, y: c.y + EXIT_INWARD[choice] * o.y };
    const ex = snap.world.exits.find((e) => e.id === choice);
    const inside = dist(me, c) <= b.exit.radius - 0.2;
    if (this.hot(c, me) && !inside) {
      return { kind: 'lurk', target: this.lurkSpot(c, me), tol: 0.8, held: 0, commit: false };
    }
    return {
      kind: 'exit',
      target: stand,
      tol: 0.3,
      held: 0,
      commit: inside && (ex?.progress ?? 0) >= COMMIT_EXIT,
    };
  }

  /** 위험한 목표 근처에서 기다릴 곳 (LURK_REPLAN_TICKS마다 다시 고른다: 매 틱 바뀌면 길을 매번 다시 찾는다) */
  private lurkSpot(anchor: Vec2, me: Vec2): Vec2 {
    const c = this.lurk;
    if (c && c.ax === anchor.x && c.ay === anchor.y && this.now < c.until) return c.spot;
    const spot = this.pickLurkSpot(anchor, me);
    this.lurk = { ax: anchor.x, ay: anchor.y, spot, until: this.now + LURK_REPLAN_TICKS };
    return spot;
  }

  /** 괴물보다 먼저 닿는(안전한) 도주 후보 중 목표에서 LURK_DIST쯤, 괴물에게서 안 보이고, 내게서 가까운 곳 */
  private pickLurkSpot(anchor: Vec2, me: Vec2): Vec2 {
    const fa = fieldFrom(anchor);
    const t = this.threat;
    let best: Vec2 = me;
    let bestScore = -Infinity;
    for (let k = 0; k < FLEE_SPOTS.length; k += 1) {
      const s = FLEE_SPOTS[k];
      if (!s) continue;
      const fs = fieldFrom(s);
      const dMe = pathDist(fs, me);
      if (!Number.isFinite(dMe)) continue;
      const da = pathDist(fa, s);
      let score = -0.5 * Math.abs(da - LURK_DIST) - 0.3 * dMe + OPEN_WEIGHT * opennessOf(k);
      if (t) {
        const margin = pathDist(fs, t) - FLEE_SPEED_RATIO * dMe;
        if (margin < LURK_SAFE) score -= 20 + (LURK_SAFE - margin);
        if (lineOfSight(t, s)) score -= 4;
      }
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /** 달아날 상황인가 */
  private danger(snap: Snapshot, b: Balance, task: Task): Danger | null {
    const t = this.threat;
    const surv = snap.you.surv;
    if (!t || !surv) {
      this.fleeing = false;
      return null;
    }
    const me = snap.you.move;
    const d = dist(me, t);
    const fresh = t.tick === this.now;
    if (task.commit && d > COMMIT_MIN_DIST) {
      this.fleeing = false;
      return null;
    }
    let radius = FLEE_DIST[this.role] + (surv.hp < b.survivor.maxHp ? FLEE_INJURED_BONUS : 0);
    if (this.role === 'guard' && surv.abilityCd <= 0 && !(snap.monster?.stunned ?? false)) {
      radius = Math.min(radius, GUARD_HOLD_DIST);
    }
    if (this.fleeing) radius += FLEE_HYST;
    const age = this.now - t.tick;
    let threatened = false;
    // 팀 시야에 보이는 괴물: 벽 너머라도 길 거리가 가까우면 달아난다
    if (fresh) threatened = d < radius && this.threatPathDist(me, radius) < radius;
    else threatened = this.fleeing && age <= this.sec(FLEE_MEMORY) && d < radius + 1;
    // 괴물이 나를 보고 있다(발각): 최근 본 괴물 위치에서 달아난다
    if (!threatened && surv.spotted && age <= this.sec(SPOTTED_MEMORY)) threatened = true;
    this.fleeing = threatened;
    return threatened ? { x: t.x, y: t.y, d, fresh } : null;
  }

  /** 괴물(이번 스냅샷 위치)에서 나까지 길 거리. 같은 스냅샷 · 같은 칸이면 다시 찾지 않는다 */
  private threatPathDist(me: Vec2, limit: number): number {
    const t = this.threat;
    if (!t) return Infinity;
    const cell = Math.floor(me.y) * W + Math.floor(me.x);
    const c = this.pathCache;
    if (c && c.tick === t.tick && c.cell === cell && c.limit === limit) return c.d;
    const d = localPathDist(t, me, limit);
    this.pathCache = { tick: t.tick, cell, limit, d };
    return d;
  }

  private flee(snap: Snapshot, b: Balance, dg: Danger): { mx: number; my: number; arrived: boolean } {
    const me = snap.you.move;
    if (dg.fresh && dg.d < CLOSE_EVADE && lineOfSight(me, dg)) {
      // 곧장 반대쪽으로. 공격 준비 중이면 고정된 조준에서 옆으로 비켜난다
      let ax = me.x - dg.x;
      let ay = me.y - dg.y;
      const split = this.splitSide(snap);
      if (split !== 0) {
        // 옆 동료와 반대쪽으로 비스듬히 (왼쪽 = 괴물 → 나 방향을 반시계로 돌린 쪽)
        const k = 0.6 * split;
        const rx = ax - ay * k;
        const ry = ay + ax * k;
        ax = rx;
        ay = ry;
      }
      const m = snap.monster;
      if (m && m.windup > 0) {
        const px = -Math.sin(m.aim);
        const py = Math.cos(m.aim);
        const side = (me.x - dg.x) * px + (me.y - dg.y) * py >= 0 ? 1 : -1;
        ax = ax / Math.max(dg.d, 0.1) + px * side * 0.8;
        ay = ay / Math.max(dg.d, 0.1) + py * side * 0.8;
      }
      const dir = freeDirection(me, Math.atan2(ay, ax), b.survivor.radius);
      if (dir) return { mx: dir.x, my: dir.y, arrived: false };
    }
    const split = this.splitSide(snap);
    if (!this.fleeSpot || this.now >= this.fleeReplanAt) {
      this.fleeSpot = this.chooseFleeSpot(me, dg, split);
      this.fleeReplanAt = this.now + FLEE_REPLAN_TICKS;
    }
    const w = this.walker.toward(snap, this.fleeSpot, 0.6);
    if (w.arrived) {
      // 닿았는데 아직 위험하면 지금 자리를 빼고 새로 고른다
      this.fleeSpot = this.chooseFleeSpot(me, dg, split, this.fleeSpot);
      this.fleeReplanAt = this.now + FLEE_REPLAN_TICKS;
      return this.walker.toward(snap, this.fleeSpot, 0.6);
    }
    return w;
  }

  /**
   * 가까이 있는 자유 동료와 갈라질 쪽: 내 ID가 작으면 왼쪽(+1), 크면 오른쪽(-1), 가까운 동료가 없으면 0.
   * 두 봇이 같은 ID 쌍을 보므로 서로 반대쪽을 고른다
   */
  private splitSide(snap: Snapshot): number {
    const me = snap.you.move;
    let mate: SurvivorView | null = null;
    for (const s of snap.survivors) {
      if (s.status !== 'free' || dist(s, me) > SPLIT_RADIUS) continue;
      if (!mate || dist(s, me) < dist(mate, me)) mate = s;
    }
    if (!mate) return 0;
    return snap.you.id < mate.id ? 1 : -1;
  }

  /** 괴물보다 먼저(괴물이 10% 빠름을 감안) 닿고, 괴물에게서 멀고 안 보이는 도주 후보. split이면 그쪽 옆으로 */
  private chooseFleeSpot(me: Vec2, dg: Danger, split: number, exclude: Vec2 | null = null): Vec2 {
    const ax = me.x - dg.x;
    const ay = me.y - dg.y;
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    let curScore = -Infinity;
    for (let k = 0; k < FLEE_SPOTS.length; k += 1) {
      const s = FLEE_SPOTS[k];
      if (!s || s === exclude) continue;
      const f = fieldFrom(s);
      const dMe = pathDist(f, me);
      if (!Number.isFinite(dMe) || dMe < FLEE_MIN_SPOT) continue;
      const dMon = pathDist(f, dg);
      let score =
        dMon - FLEE_SPEED_RATIO * dMe + FLEE_FAR_WEIGHT * Math.min(dMon, 20) + OPEN_WEIGHT * opennessOf(k);
      if (!lineOfSight(dg, s)) score += FLEE_HIDDEN_BONUS;
      if (split !== 0) {
        // 괴물 → 나 방향의 왼쪽(외적 > 0)이면 +1
        const cross = ax * (s.y - me.y) - ay * (s.x - me.x);
        score += cross * split > 0 ? SPLIT_BIAS : -SPLIT_BIAS;
      }
      if (s === this.fleeSpot) curScore = score;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (this.fleeSpot && this.fleeSpot !== exclude && curScore >= bestScore - FLEE_KEEP) return this.fleeSpot;
    return best ?? snapToFloor({ x: me.x + (me.x - dg.x), y: me.y + (me.y - dg.y) });
  }

  private ability(snap: Snapshot, b: Balance, dg: Danger | null, task: Task): number {
    const surv = snap.you.surv;
    if (!surv || surv.abilityCd > 0) return 0;
    const me = snap.you.move;
    const m = snap.monster;
    switch (this.role) {
      case 'runner':
        return dg && dg.fresh && dg.d < SPRINT_DIST ? BTN.ABILITY : 0;
      case 'guard': {
        if (!m || m.stunned) return 0;
        const d = dist(me, m);
        if (d > b.roles.guard.shoveRange - SHOVE_MARGIN) return 0;
        return segmentBlocked(me, m, blocksStrike) ? 0 : BTN.ABILITY;
      }
      case 'scout': {
        if (m) return 0;
        const idle = this.now - this.lastInfo;
        const rescuing = task.kind === 'rescue' && dist(me, task.target) <= 12;
        if (idle < this.sec(rescuing ? TRACK_RESCUE_IDLE : this.trackIdle)) return 0;
        const busy =
          task.kind === 'capture' || task.kind === 'rescue' || task.kind === 'exit' || task.kind === 'lurk';
        if (!busy || dist(me, task.target) > (rescuing ? 12 : 8)) return 0;
        this.trackIdle = TRACK_IDLE_MIN + this.rng.next() * TRACK_IDLE_SPAN;
        return BTN.ABILITY;
      }
      default:
        return 0;
    }
  }

  private stuck(me: Vec2, moving: boolean): boolean {
    if (!moving) {
      this.stuckFrom = null;
      return false;
    }
    const s = this.stuckFrom;
    if (!s || dist(s, me) > STUCK_MOVE) {
      this.stuckFrom = { x: me.x, y: me.y, tick: this.now };
      return false;
    }
    if (this.now - s.tick >= STUCK_TICKS) {
      this.stuckFrom = null;
      return true;
    }
    return false;
  }
}

/** angle 쪽으로 몸이 걸리지 않는 방향. 막혔으면 좌우로 약 30°씩 틀어 본다. 다 막혔으면 null */
function freeDirection(me: Vec2, angle: number, r: number): Vec2 | null {
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
    const a = angle + off;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const probe = { x: me.x + ux * (0.6 + r), y: me.y + uy * (0.6 + r) };
    if (walkableAt(probe) && clearPath(me, probe, r * 0.8)) return { x: ux, y: uy };
  }
  return null;
}

/** 역할에 맞는 실전 봇 두뇌. seed는 같은 판을 다시 돌릴 때 같은 결정을 내리게 하는 값 (한 판의 봇은 같은 seed를 쓴다) */
export function practiceBrain(role: Role, seed = 1): BotBrain {
  preparePracticeMap();
  if (role === 'monster') return new PracticeMonsterBrain(seed);
  return new PracticeSurvivorBrain(role, seed);
}
