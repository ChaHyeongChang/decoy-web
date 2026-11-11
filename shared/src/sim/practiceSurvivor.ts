// 실전 봇 두뇌: 생존자 (M13b, 플레이테스트 반영 c에서 practiceBrains.ts에서 나눔).
// 두뇌는 decide()로 받은 것 — 자기에게 온 스냅샷 · MatchInfo · Balance — 과 공개 지도만 본다. 시드 난수 Rng만 쓴다
//
// 플레이테스트 반영 c (사람다움 · 서 있지 않기):
//  - 지켜지는 목표(괴물을 그 근처에서 최근 봤다)는 버리고 다른 할 일로 간다(pickPoint). '가는 길에 괴물'은 서서 기다리지 않고
//    괴물을 본 자리에서 떨어진 거쳐 갈 곳으로 돌아간다(그래도 보이면 도주가 맡는다)
//  - 남은 할 일이 모두 지켜질 때만 기다리되 서지 않는다: 목표 둘레 기다리는 자리 몇 곳을 오가며 서성이고(한자리 ≤ 0.7초),
//    기다림 한도(3~4초)가 지나면 다른 쪽 자리로 옮기며, 미끼(판 시드로 섞은 순서의 첫 자유 생존자 — 역할에 묶지 않는다)는
//    목표로 들어가 본다. 미끼를 쫓는 괴물이 다른 곳에서 보이면 목표가 풀려 나머지가 들어간다
//  - 반응 지연: 공격 준비를 본 뒤 사람 반응 시간(0.25~0.35초, 가끔 미리 읽고 0.10~0.15초)이 지나야 옆으로 비키고, 가끔 못 비키거나
//    반대쪽으로 비키며 방향 오차가 있다. 질주 · 밀치기도 조건이 처음 참이 된 뒤 0.2~0.35초. 분포는 역할과 무관하다.
//    난수는 행동마다 따로 뽑은 시드 난수 흐름이다(한 행동의 난수가 다른 행동의 순서를 밀지 않게)
//  - 거점 · 탈출구에서 서는 자리는 역할이 아니라 (판 시드, 장소)로 섞어 정한다 (괴물 화면에서 자리로 역할을 짐작하지 못하게)
import {
  BTN,
  CAPTURE_POINTS,
  POINT_IDS,
  EXITS,
  RESCUE_POINT,
  Rng,
  blocksStrike,
  emptyInput,
  lineOfSight,
  segmentBlocked,
  type Balance,
  type ExitId,
  type InputFrame,
  type MatchInfo,
  type PointId,
  type RoleId,
  type Snapshot,
  type SurvivorView,
  type Vec2,
} from '../index';
import { Walker, dist, type BotBrain } from './botBrains';
import {
  brainRng,
  clearPath,
  EXIT_DOORS,
  EXIT_IDS,
  EXIT_INWARD,
  fieldFrom,
  FLEE_SPOTS,
  localPathDist,
  opennessOf,
  pathDist,
  pointOpen,
  snapToFloor,
  STUCK_MOVE,
  STUCK_TICKS,
  W,
  walkableAt,
} from './practiceMap';

// ───────────────────────── 생존자 ─────────────────────────

/**
 * 괴물이 이 거리(타일) 안에 보이면 달아난다. 역할과 무관하다 (예전 러너 6.5 · 가드 6.0 · 스카우트 7.0은 괴물 화면에서 '몇 타일에서
 * 달아나기 시작하나'로 역할을 가리는 단서였다 — 하나로 맞춰도 봇끼리 300판 괴물 승률 45.7% → 45.0%, novice 수감 2.59 → 2.65)
 */
const FLEE_DIST = 6.5;
/** 부상(체력 1)이면 도주 거리에 더한다 (타일) */
const FLEE_INJURED_BONUS = 1.0;
/** 이미 달아나는 중이면 이만큼 더 멀어질 때까지 계속 (타일) */
const FLEE_HYST = 1.5;
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
/**
 * 지켜지는 목표: 괴물을 그 목표 이 거리(타일) 안에서 본 지 이만큼(초) 안 (예전 HOT_RADIUS 7 · HOT_TIME 10). 거점 밖 매복
 * (반경 + 0.7)은 안에 든다. 7이면 감옥 감시 자리(구조 지점에서 5~6.7타일)까지 막혀 구조 · 점령을 너무 미뤘다 (봇끼리 300판 괴물 승률 53.0% → 47.0%)
 * 지켜지는 목표는 버리고 다른 할 일로 간다. 그 목표 근처에서 기다리는 중이면 반경에 이력을 더한다 (괴물이 경계를 오갈 때
 * 기다리기 ↔ 들어가기가 흔들리지 않게)
 */
const GUARD_RADIUS = 5;
const GUARD_MEMORY = 8;
const GUARD_HYST = 1.5;
/**
 * 가는 길에 괴물: 최근(초) 본 괴물이 내게서 이 거리(타일) 안이고 목표 쪽(나보다 목표에 가까운 곳)이면 그 목표는 거점 고르기에서
 * 위험으로 친다(다른 안전한 거점이 있으면 그리로). 그래도 그 목표로 가야 하면 서지 않고 돌아간다(detour)
 */
const ROUTE_MEMORY = 5;
const ROUTE_DANGER = 9;
/** 돌아가는 길: 괴물을 본 자리에서 이만큼(타일) 떨어져 지나는 거쳐 갈 곳, 곧장 가는 길 × 비율 + 덤까지만 */
const DETOUR_CLEAR = 4;
const DETOUR_RATIO = 2;
const DETOUR_EXTRA = 10;
/** 거쳐 갈 곳이 없을 때 다시 찾기까지 (틱), 닿았다고 보는 거리 (타일), 괴물 자리가 이만큼(타일) 옮겨지면 다시 고른다 */
const DETOUR_RETRY_TICKS = 15;
const DETOUR_REACHED = 1.5;
const DETOUR_THREAT_MOVE = 2;
/** 모두 위험할 때 지금 점령 목표를 가장 가까운 곳으로 옮기기 전에 유지하는 시간 (초) — pickPoint */
const GOAL_KEEP = 1.5;
/** 기다리기 (남은 할 일이 모두 지켜질 때): 목표에서 이 길 거리(타일)쯤인 자리 WAIT_SPOT_COUNT곳을 오가며 서성인다 */
const WAIT_DIST = 9;
const WAIT_SPOT_COUNT = 3;
/** 기다리는 자리끼리 길 거리 (타일, 최소 · 최대): 너무 붙으면 제자리, 너무 멀면 오가는 길이 길다 */
const WAIT_HOP_MIN = 3;
const WAIT_HOP_MAX = 9;
/** 기다리는 자리에 닿아 머무는 시간 (초, 최소 + 시드 범위) — 한자리 정지가 1초를 넘지 않게 */
const WAIT_DWELL_MIN = 0.2;
const WAIT_DWELL_SPAN = 0.5;
/** 기다리는 자리 도착 판정 (타일) */
const WAIT_TOL = 0.8;
/** 기다리는 자리는 괴물보다 이만큼(점수: 괴물 길 거리 - 1.15 × 내 길 거리) 먼저 닿는 곳만 (예전 LURK_SAFE) */
const WAIT_SAFE = 3;
/** 기다림 한도 (초, 최소 + 시드 범위): 지나면 다른 쪽 기다리는 자리로 옮기고, 미끼는 목표로 들어가 본다 */
const WAIT_PATIENCE_MIN = 3;
const WAIT_PATIENCE_SPAN = 1;
/** 미끼가 들어가 보는 시간 (초). 괴물이 보이면 도주가 맡는다 */
const PROBE_TIME = 5;
/** 기다림 한도를 이만큼 넘기면 미끼가 아니어도 들어가 본다 (모두 서성이기만 하다 판이 멈추지 않게) */
const PROBE_ALL_ROUND = 3;
/** 기다리기를 이만큼(틱) 안 하면 다음 기다리기는 처음부터 */
const WAIT_RESET_TICKS = 90;
/** 다른 쪽에서 접근: 앞 라운드 기다리는 자리 이 거리(타일) 안이면 벌점 */
const WAIT_AVOID_RADIUS = 5;
const WAIT_AVOID_PENALTY = 6;
/** 괴물을 본 자리가 이만큼(타일) 옮겨지면 기다리는 자리를 다시 고른다 */
const WAIT_REPLAN_MOVE = 4;
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
/**
 * 공격 준비를 보고 비키기까지 (초, 균등 — 사람 반응 시간). 준비 동작(windup 0 → 양수)을 본 스냅샷마다 한 번 굴린다.
 * 가끔은 미리 읽고 빨리 비킨다 (확률 · 그때 지연). 분포는 역할과 무관하다 (괴물 화면에서 반응 시간으로 역할을 가리지 못하게)
 */
const WINDUP_REACT: readonly [number, number] = [0.25, 0.35];
const WINDUP_ANTICIPATE_PROB = 0.2;
const WINDUP_ANTICIPATE: readonly [number, number] = [0.1, 0.15];
/** 아예 못 비킴(달아나던 방향 그대로) · 조준선 쪽으로 잘못 비킴 확률, 비키는 방향 오차 (±라디안, 균등) */
const DODGE_SKIP_PROB = 0.15;
const DODGE_WRONG_SIDE_PROB = 0.075;
const DODGE_ANGLE_ERROR = 0.3;
/** 질주 · 밀치기: 조건이 처음 참이 된 뒤 누르기까지 (초, 균등). 조건이 풀리면 취소 */
const ABILITY_REACT: readonly [number, number] = [0.2, 0.35];
/** 괴물이 팀 시야에 새로 보인 뒤 도주를 시작하기까지 (초, 균등). 단계 2(c-bots.md 2.4절) — 기본 끔 [0, 0] */
const NOTICE_DELAY: readonly [number, number] = [0, 0];
/** 행동마다 따로 뽑는 시드 난수 흐름의 소금 (기존 rng · 서로의 순서를 밀지 않게) */
const DODGE_SALT = 0x1b873593;
const ABILITY_SALT = 0x5bd1e995;
const WAIT_SALT = 0x27d4eb2f;
const NOTICE_SALT = 0x165667b1;
/** 거점에서 서는 자리 (가운데에서 조금씩 비켜, 모두 반경 안). 누가 어느 자리인지는 standSlot (판 시드 · 장소) */
const POINT_SLOTS: readonly Vec2[] = [
  { x: -0.8, y: 0 },
  { x: 0.8, y: 0 },
  { x: 0, y: 0.8 },
];
/** 탈출구에서 서는 자리 (가로 비킴, 안쪽으로 들어온 거리) */
const EXIT_SLOTS: readonly Vec2[] = [
  { x: -0.5, y: 0.3 },
  { x: 0.5, y: 0.3 },
  { x: 0, y: 0.6 },
];

interface Threat {
  x: number;
  y: number;
  tick: number;
}

/** 할 일 종류. wait = 남은 할 일이 모두 지켜질 때 목표 둘레를 서성이며 기다리기 (예전 lurk — 서 있지 않는다) */
export type SurvivorTaskKind = 'capture' | 'rescue' | 'exit' | 'door' | 'wait' | 'idle';

interface Task {
  kind: SurvivorTaskKind;
  target: Vec2;
  tol: number;
  held: number;
  /** 괴물이 와도 버틸 진행 (COMMIT_MIN_DIST보다 멀면 달아나지 않는다) */
  commit: boolean;
  /** 할 일의 장소 (거점 · 구조 지점 · 탈출구 가운데). 진단용 */
  anchor: Vec2;
  /** 돌아가는 길의 거쳐 갈 곳으로 가는 중 · 미끼로 들어가 보는 중 (진단용) */
  via?: boolean;
  probe?: boolean;
}

interface Danger {
  x: number;
  y: number;
  d: number;
  fresh: boolean;
}

/** 공격 준비 하나에 대한 반응 (본 스냅샷에서 한 번 굴린다) */
interface Dodge {
  /** 비키기 시작하는 스냅샷 틱 */
  at: number;
  skip: boolean;
  wrong: boolean;
  /** 비키는 방향 오차 (라디안) */
  noise: number;
}

/** 기다리기 계획 (목표 하나에 대해) */
interface WaitPlan {
  ax: number;
  ay: number;
  spots: Vec2[];
  idx: number;
  /** 지금 자리에 머무는 끝 틱 (-1이면 걷는 중) */
  dwellUntil: number;
  since: number;
  patienceAt: number;
  round: number;
  /** 앞 라운드 자리 (다른 쪽에서 접근하게 피한다) */
  prev: Vec2[];
  probeUntil: number;
  /** 자리를 고를 때 괴물 자리 */
  tx: number;
  ty: number;
  /** 마지막으로 기다린 틱과 그때 괴물 정보의 틱 (새 정보가 없으면 '가는 길' 막힘을 그대로 본다) */
  last: number;
  infoTick: number;
}

/** 진단 · 시험용 두뇌 상태 (읽기 전용 사본) */
export interface SurvivorBrainDebug {
  /** 두뇌의 지금 (마지막 스냅샷 틱) */
  tick: number;
  kind: SurvivorTaskKind;
  anchor: Vec2;
  target: Vec2;
  fleeing: boolean;
  via: boolean;
  probe: boolean;
}

/** 팀 계획에서 셋이 한 거점에 함께 갈 확률 (아니면 둘 · 하나로 나뉜다) */
const TEAM_TOGETHER_PROB = 0.5;

const SOLO_ROLES: readonly RoleId[] = ['runner', 'guard', 'scout'];

/**
 * 생존자 팀이 함께 쓰는 계획 (같은 seed면 세 봇이 같은 계획): 거점을 들를 순서(세 곳을 시드로 섞음 — 앞 두 곳이 먼저 갈 곳,
 * 셋째는 지켜질 때 갈 곳)와, 혼자 둘째 거점에 갈 역할(없으면 셋이 함께). 역할과 거점을 묶지 않는다 — 괴물 화면에서 자리로
 * 역할을 짐작할 단서가 생기지 않게 혼자 가는 역할도 셋 중 시드로 고른다(플레이테스트 반영 b)
 */
export function teamPlan(seed: number): { order: readonly PointId[]; solo: RoleId | null } {
  const r = new Rng((Math.imul(seed | 0, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0);
  const order = [...POINT_IDS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = r.int(i + 1);
    const t = order[i] as PointId;
    order[i] = order[j] as PointId;
    order[j] = t;
  }
  const together = r.next() < TEAM_TOGETHER_PROB;
  const solo = SOLO_ROLES[r.int(SOLO_ROLES.length)] ?? 'runner';
  return { order, solo: together ? null : solo };
}

/**
 * 생존자 한 명이 거점을 들를 순서 (팀 계획에서, PracticeSurvivorBrain이 그대로 쓴다): 혼자 가는 역할은 둘째 거점부터,
 * 나머지는 첫 거점부터. 셋째는 둘 다 지켜질 때 갈 곳
 */
export function survivorPlan(seed: number, role: RoleId): readonly PointId[] {
  const plan = teamPlan(seed);
  const [first, second, third] = plan.order;
  return (plan.solo === role ? [second, first, third] : [first, second, third]).filter(
    (id): id is PointId => id !== undefined,
  );
}

/** 세 역할을 시드 난수로 섞은 순서 (같은 seed면 세 봇이 같은 순서) */
function shuffledRoles(r: Rng): RoleId[] {
  const order = [...SOLO_ROLES];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = r.int(i + 1);
    const t = order[i] as RoleId;
    order[i] = order[j] as RoleId;
    order[j] = t;
  }
  return order;
}

/**
 * 장소(거점 id · 탈출구 id)에서 이 역할이 서는 자리 번호 (0~2): (판 시드, 장소)로 섞은 배정. 세 봇이 같은 시드로 같은 배정을
 * 쓰므로 서로 겹치지 않고, 역할과 자리의 관계는 판마다 · 장소마다 달라진다 (괴물 화면에서 '거점 왼쪽 = 러너' 같은 단서가 없게)
 */
export function standSlot(seed: number, place: PointId | ExitId, role: RoleId): number {
  const r = new Rng(
    (Math.imul(seed | 0, 0x2c1b3c6d) ^ Math.imul(place.charCodeAt(0), 0x297a2d39) ^ 0x7f4a7c15) >>> 0,
  );
  const order = shuffledRoles(r);
  const i = order.indexOf(role);
  return i < 0 ? 0 : i;
}

/**
 * 미끼 순서 (팀 공용, 판 시드로 섞음): 남은 할 일이 모두 지켜져 기다림 한도가 지나면 이 순서로 첫 자유 생존자가 목표로 들어가 본다.
 * 역할에 묶지 않는다 (판마다 다르다)
 */
export function decoyOrder(seed: number): readonly RoleId[] {
  return shuffledRoles(new Rng((Math.imul(seed | 0, 0x3b9a73c9) ^ 0x6c8e9cf5) >>> 0));
}

/**
 * 갈라지기 순서 (팀 공용, 판 시드로 섞음): 가까이 함께 달아나는 둘 중 앞 순서가 왼쪽으로 간다. 예전에는 자리 ID 순서였는데 봇 자리
 * ID가 역할 순서(러너 · 가드 · 스카우트)로 붙어 '왼쪽으로 갈라지는 쪽 = 러너' 같은 단서가 됐다
 */
export function splitOrder(seed: number): readonly RoleId[] {
  return shuffledRoles(new Rng((Math.imul(seed | 0, 0x7feb352d) ^ 0x846ca68b) >>> 0));
}

/**
 * 점령할 거점 고르기. undone은 계획 순서로 남은 거점(비어 있지 않다), hot · near는 거점별 위험 · 내게서 거리, cur는 지금 목표,
 * held는 지금 목표를 고른 지 GOAL_KEEP초 안인가.
 * 규칙: 계획 첫 곳이 위험하면 계획 순서 앞쪽의 안전한 곳, 모두 위험하면 가장 가까운 곳(그 근처에서 기다린다).
 * 이력: '가는 길' 위험은 내 자리에 따라 깜빡이므로, 지금 목표가 안전하면 그대로 간다(안전한 곳끼리 · 계획 첫 곳으로 오가지 않는다).
 * 지금 목표가 위험해지면 안전한 곳으로 바로 바꾸고, 모두 위험할 때 가까운 곳으로 옮기는 것은 유지 시간이 지난 뒤
 */
export function pickPoint(
  undone: readonly PointId[],
  hot: Readonly<Record<PointId, boolean>>,
  near: Readonly<Record<PointId, number>>,
  cur: PointId | null,
  held: boolean,
): PointId {
  const first = undone[0] ?? 'A';
  let pick: PointId = first;
  if (hot[first] && undone.length > 1) {
    let safe: PointId | null = null;
    for (const id of undone) {
      if (!hot[id]) {
        safe = id;
        break;
      }
    }
    if (safe !== null) pick = safe;
    else for (const id of undone) if (near[id] < near[pick]) pick = id;
  }
  if (cur === null || cur === pick || !undone.includes(cur)) return pick;
  if (!hot[cur]) return cur;
  return hot[pick] && held ? cur : pick;
}

/** [lo, hi] 균등 난수 */
function uniform(r: Rng, range: readonly [number, number]): number {
  return range[0] + r.next() * (range[1] - range[0]);
}

export class PracticeSurvivorBrain implements BotBrain {
  private readonly rng: Rng;
  /** 공격 준비 반응 · 능력 반응 · 기다리기 · 괴물 알아채기용 따로 뽑은 시드 난수 흐름 */
  private readonly dodgeRng: Rng;
  private readonly abilityRng: Rng;
  private readonly waitRng: Rng;
  private readonly noticeRng: Rng;
  private readonly walker = new Walker();
  private hz = 30;
  private lastObserved = -1;
  private now = 0;
  private threat: Threat | null = null;
  /** 괴물 정보(보임 · 탐지 · 포효)를 마지막으로 받은 틱 (판이 흐르기 전 시간은 세지 않는다) */
  private lastInfo = 0;
  private fleeing = false;
  private fleeSpot: Vec2 | null = null;
  private fleeReplanAt = 0;
  private exitChoice: ExitId | null = null;
  private exitSwitchedAt = -1e9;
  private readonly codes: string[] = [];
  /** 거점을 들를 순서 (팀 계획, 내 거점이 맨 앞) */
  private readonly plan: readonly PointId[];
  /** 미끼 순서 · 갈라지기 순서 (팀 계획) */
  private readonly decoys: readonly RoleId[];
  private readonly splits: readonly RoleId[];
  private trackIdle: number;
  private stuckFrom: { x: number; y: number; tick: number } | null = null;
  private wiggleUntil = 0;
  private wiggleDir: Vec2 = { x: 0, y: 0 };
  private wait: WaitPlan | null = null;
  /**
   * 돌아가는 길, 목표별 (한 틱에 구조 지점 · 거점을 차례로 볼 수 있어 하나만 두면 서로 덮어써 닿음을 알아채지 못한다):
   * 그때 괴물 자리 · 거쳐 갈 곳(없으면 null) · 없을 때 다시 찾는 틱
   */
  private readonly vias = new Map<number, { tx: number; ty: number; spot: Vec2 | null; retryAt: number }>();
  /** 이 괴물 자리에 대해서는 이미 돌아갔다 (거쳐 갈 곳에 닿음) */
  private viaDone: Vec2 | null = null;
  private pathCache: { tick: number; cell: number; limit: number; d: number } | null = null;
  /** 고른 점령 목표와 고른 틱 (pickPoint의 이력) */
  private pointGoal: PointId | null = null;
  private pointGoalAt = -1e9;
  /** 이번 틱 거점별 위험 · 거리 (pickPoint에 넘긴다. 틱마다 새 객체를 만들지 않게 재사용) */
  private readonly hotNow: Record<PointId, boolean> = { A: false, B: false, C: false };
  private readonly nearNow: Record<PointId, number> = { A: 0, B: 0, C: 0 };
  /** 공격 준비 반응: 지난 스냅샷에서 준비 중이었나, 이번 준비에 대해 굴린 반응 */
  private windupSeen = false;
  private dodge: Dodge | null = null;
  /** 질주 · 밀치기 조건이 처음 참이 된 틱 (-1이면 거짓)과 누르기까지 기다릴 틱 */
  private abilitySince = -1;
  private abilityWait = 0;
  /** 괴물 알아채기 (단계 2, 기본 끔): 지난 스냅샷에 괴물이 보였나, 도주를 시작할 수 있는 틱 */
  private monsterSeenPrev = false;
  private noticeAt = 0;
  /** 이번 틱 할 일 (진단용) */
  private lastTask: Task | null = null;

  constructor(
    private readonly role: RoleId,
    private readonly seed: number,
  ) {
    this.rng = brainRng(seed, role);
    this.dodgeRng = brainRng(seed ^ DODGE_SALT, role);
    this.abilityRng = brainRng(seed ^ ABILITY_SALT, role);
    this.waitRng = brainRng(seed ^ WAIT_SALT, role);
    this.noticeRng = brainRng(seed ^ NOTICE_SALT, role);
    this.plan = survivorPlan(seed, role);
    this.decoys = decoyOrder(seed);
    this.splits = splitOrder(seed);
    this.trackIdle = TRACK_IDLE_MIN + this.rng.next() * TRACK_IDLE_SPAN;
  }

  private sec(s: number): number {
    return Math.round(s * this.hz);
  }

  /** 진단 · 시험용: 이번 틱에 고른 할 일 · 달아나는 중인가 (두뇌 결정에는 쓰지 않는다) */
  debugState(): SurvivorBrainDebug | null {
    const t = this.lastTask;
    if (!t) return null;
    return {
      tick: this.now,
      kind: t.kind,
      anchor: { x: t.anchor.x, y: t.anchor.y },
      target: { x: t.target.x, y: t.target.y },
      fleeing: this.fleeing,
      via: t.via === true,
      probe: t.probe === true,
    };
  }

  decide(snap: Snapshot, info: MatchInfo, b: Balance, seq: number): InputFrame {
    this.hz = info.tickHz > 0 ? info.tickHz : b.network.serverTickHz;
    // 갇혀 있어도(죽어도) 관찰은 한다: 탈출구 선택이 팀 전원에게 같게 유지되도록
    this.observe(snap);
    const surv = snap.you.surv;
    if (!surv || surv.status !== 'free') {
      this.lastTask = null;
      return emptyInput(seq);
    }
    const me = snap.you.move;
    const out: InputFrame = { seq, mx: 0, my: 0, aim: Number.NaN, held: 0, pressed: 0 };
    const task = this.task(snap, info, b);
    this.lastTask = task;
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

  /** 새 스냅샷일 때만: 괴물 위치 기억, 공격 준비 반응 굴리기, 메모 비밀번호, 탈출구 선택 */
  private observe(snap: Snapshot): void {
    if (snap.tick === this.lastObserved) return;
    const first = this.lastObserved < 0;
    this.lastObserved = snap.tick;
    this.now = snap.tick;
    // 판이 흐르기 전(시작 카운트다운) · 두뇌가 판에 들어오기 전 시간은 '괴물 정보 없음'으로 세지 않는다 (카운트다운이 끝나는 틱부터)
    if (first || snap.world.countdown > 0) {
      this.lastInfo = Math.max(this.lastInfo, snap.tick + Math.round(snap.world.countdown * this.hz));
    }
    const m = snap.monster;
    // 공격 준비 반응: 준비가 새로 보인 스냅샷에서 한 번 굴린다 (난수를 늘 다섯 번 뽑아 흐름이 결과에 따라 밀리지 않게)
    const windup = m ? m.windup : 0;
    if (windup > 0 && !this.windupSeen) this.dodge = this.rollDodge(snap.tick);
    else if (windup <= 0) this.dodge = null;
    this.windupSeen = windup > 0;
    if (m && !this.monsterSeenPrev)
      this.noticeAt = snap.tick + uniform(this.noticeRng, NOTICE_DELAY) * this.hz;
    this.monsterSeenPrev = m !== null;
    let pos: Vec2 | null = m ? { x: m.x, y: m.y } : null;
    if (!pos) {
      for (const k of snap.marks) {
        if (k.kind === 'track' || (k.kind === 'roarSelf' && !pos)) pos = { x: k.x, y: k.y };
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
      m &&
      !curOpen &&
      snap.tick - this.exitSwitchedAt >= this.sec(EXIT_SWITCH_GAP) &&
      dist(m, EXITS[cur].center) < EXIT_SWITCH_NEAR &&
      dist(m, EXITS[other].center) > EXIT_SWITCH_FAR
    ) {
      this.exitChoice = other;
      this.exitSwitchedAt = snap.tick;
    }
  }

  /** 공격 준비 하나에 대한 사람 반응: 비키기 시작 틱 · 못 비킴 · 반대쪽 · 방향 오차 (늘 다섯 번 뽑는다) */
  private rollDodge(tick: number): Dodge {
    const r = this.dodgeRng;
    const early = r.next() < WINDUP_ANTICIPATE_PROB;
    const delay = uniform(r, early ? WINDUP_ANTICIPATE : WINDUP_REACT);
    const skip = r.next() < DODGE_SKIP_PROB;
    const wrong = r.next() < DODGE_WRONG_SIDE_PROB;
    const noise = (r.next() * 2 - 1) * DODGE_ANGLE_ERROR;
    return { at: tick + delay * this.hz, skip, wrong, noise };
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

  /** 지켜지는 목표: 최근(GUARD_MEMORY) 본 괴물이 목표 가까이(GUARD_RADIUS, 그 목표를 기다리는 중이면 + 이력) */
  private guarded(anchor: Vec2): boolean {
    const t = this.threat;
    if (!t || this.now - t.tick > this.sec(GUARD_MEMORY)) return false;
    const w = this.wait;
    const waiting = w !== null && w.ax === anchor.x && w.ay === anchor.y && this.now - w.last <= 3;
    return dist(t, anchor) < GUARD_RADIUS + (waiting ? GUARD_HYST : 0);
  }

  /** 가는 길에 괴물: 최근(ROUTE_MEMORY) 본 괴물이 내 근처(ROUTE_DANGER)에서 목표 쪽(나보다 목표에 가까운 곳)에 있었다 */
  private routeDanger(anchor: Vec2, me: Vec2): boolean {
    const t = this.threat;
    if (!t || this.now - t.tick > this.sec(ROUTE_MEMORY)) return false;
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
    const open = new Set(snap.world.points.filter((p) => pointOpen(p.state)).map((p) => p.id));
    // 계획 순서대로 남은 거점 (끝났거나 꺼진 곳은 뺀다)
    const undone = this.plan.filter((id) => open.has(id));
    if (jailed.length > 0 && !finishing && this.isRescuer(snap, freeMates)) {
      // 감옥 근처가 막히면(지켜짐 · 가는 길에 괴물) 거점이 남아 있고 자유 동료가 있는 동안은 점령을 하다가 다시 본다
      // (모두 감옥 앞에서 기다리지 않게)
      const enter = this.rescueEnter(snap, b);
      const go = this.approach(enter, me, this.rescueInZone(snap, b));
      if (go) return go;
      if (undone.length === 0 || freeMates.length === 0) return this.waitTask(snap, enter);
    }
    if (undone.length > 0) {
      // 지켜지거나 가는 길에 괴물이 있는 거점은 버리고 안전한 다른 거점으로 (계획 순서 앞쪽 먼저).
      // 모두 위험하면 가장 가까운 곳: 지켜지면 그 둘레에서 서성이며 기다리고, 가는 길만 위험하면 돌아간다
      for (const id of undone) {
        const c = CAPTURE_POINTS[id];
        this.hotNow[id] = this.guarded(c) || this.routeDanger(c, me);
        this.nearNow[id] = dist(me, c);
      }
      const held = this.now - this.pointGoalAt < this.sec(GOAL_KEEP);
      const goal = pickPoint(undone, this.hotNow, this.nearNow, this.pointGoal, held);
      if (goal !== this.pointGoal) {
        this.pointGoal = goal;
        this.pointGoalAt = this.now;
      }
      const c = CAPTURE_POINTS[goal];
      const o = POINT_SLOTS[standSlot(this.seed, goal, this.role)] ?? { x: 0, y: 0 };
      const enter: Task = {
        kind: 'capture',
        target: snapToFloor({ x: c.x + o.x, y: c.y + o.y }),
        tol: 0.4,
        held: 0,
        commit: false,
        anchor: c,
      };
      return this.approach(enter, me, dist(me, c) <= b.capturePoint.radius) ?? this.waitTask(snap, enter);
    }
    if (jailed.length > 0) {
      const enter = this.rescueEnter(snap, b);
      return this.approach(enter, me, this.rescueInZone(snap, b)) ?? this.waitTask(snap, enter);
    }
    return { kind: 'idle', target: { x: me.x, y: me.y }, tol: 1, held: 0, commit: false, anchor: me };
  }

  /** 지금 서 있는 (끝나지도 꺼지지도 않은) 거점 */
  private pointHere(snap: Snapshot, b: Balance): { id: PointId; progress: number } | null {
    for (const p of snap.world.points) {
      if (!pointOpen(p.state)) continue;
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

  /**
   * 막혀도 구조를 이어 가는가: 이미 구조 구역 안. 역할과 무관하다 (예전에는 밀치기가 준비된 가드만 지켜지는 구조 지점에 들어가
   * 괴물 화면에서 '지켜지는 감옥으로 걸어오는 흰 사람 = 가드'라는 단서였다 — 들어가 보기는 미끼 순서(decoyOrder)가 맡는다.
   * 없애도 봇끼리 300판 괴물 승률 48.0% → 47.0%, novice 수감 2.70 → 2.74)
   */
  private rescueInZone(snap: Snapshot, b: Balance): boolean {
    return dist(snap.you.move, RESCUE_POINT) <= b.prison.rescueRadius - 0.2;
  }

  private rescueEnter(snap: Snapshot, b: Balance): Task {
    const progress = snap.you.surv?.rescue ?? 0;
    const inZone = dist(snap.you.move, RESCUE_POINT) <= b.prison.rescueRadius - 0.2;
    return {
      kind: 'rescue',
      target: RESCUE_POINT,
      tol: 0.3,
      held: BTN.RESCUE,
      commit: inZone && progress >= COMMIT_RESCUE,
      anchor: RESCUE_POINT,
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
      return {
        kind: 'door',
        target: door,
        tol: 0.05,
        held: 0,
        commit: dist(me, door) <= COMMIT_DOOR,
        anchor: EXITS[id].center,
      };
    }
    const c = EXITS[choice].center;
    const o = EXIT_SLOTS[standSlot(this.seed, choice, this.role)] ?? { x: 0, y: 0 };
    const stand = { x: c.x + o.x, y: c.y + EXIT_INWARD[choice] * o.y };
    const ex = snap.world.exits.find((e) => e.id === choice);
    const inside = dist(me, c) <= b.exit.radius - 0.2;
    const enter: Task = {
      kind: 'exit',
      target: stand,
      tol: 0.3,
      held: 0,
      commit: inside && (ex?.progress ?? 0) >= COMMIT_EXIT,
      anchor: c,
    };
    return this.approach(enter, me, inside) ?? this.waitTask(snap, enter);
  }

  /**
   * 목표로 가는 할 일, 막혔으면 null (부르는 쪽이 다른 할 일 · 기다리기를 고른다).
   * 막힘 = 지켜짐(guarded) 또는 가는 길에 괴물(routeDanger)인데 돌아갈 곳(거쳐 갈 곳)이 없음. 이미 그 목표를 기다리는 중이고
   * 새 괴물 정보가 없으면 계속 막힘으로 본다 (기다리는 자리를 오가며 내 자리가 바뀔 때 '가는 길' 판정이 깜빡이지 않게).
   * inside(구역 안 · 들어가기로 함)면 그대로 들어간다
   */
  private approach(enter: Task, me: Vec2, inside: boolean): Task | null {
    if (inside) return enter;
    const a = enter.anchor;
    if (this.guarded(a)) return null;
    const t = this.threat;
    if (!t || !this.routeDanger(a, me)) {
      const w = this.wait;
      const sticky =
        t !== null &&
        w !== null &&
        w.ax === a.x &&
        w.ay === a.y &&
        this.now - w.last <= 3 &&
        w.infoTick === t.tick &&
        this.now - t.tick <= this.sec(ROUTE_MEMORY);
      return sticky ? null : enter;
    }
    const via = this.detour(a, me, t);
    if (via === 'go') return enter;
    if (!via) return null;
    return { kind: enter.kind, target: via, tol: 0.8, held: 0, commit: false, anchor: a, via: true };
  }

  /**
   * 가는 길에 괴물이 있을 때 거쳐 갈 곳 (괴물 자리가 크게 바뀌지 않으면 같은 곳을 유지한다). 이 괴물 자리에 대해 이미 거쳐 갈 곳에
   * 닿았으면 'go'(목표로 곧장 — 다시 돌면 제자리 지그재그), 없으면 null
   */
  private detour(anchor: Vec2, me: Vec2, t: Threat): Vec2 | 'go' | null {
    const done = this.viaDone;
    if (done && Math.hypot(t.x - done.x, t.y - done.y) <= DETOUR_THREAT_MOVE) return 'go';
    const key = Math.round(anchor.y * 4) * 1024 + Math.round(anchor.x * 4);
    const v = this.vias.get(key);
    if (v && Math.hypot(t.x - v.tx, t.y - v.ty) <= DETOUR_THREAT_MOVE) {
      if (v.spot) {
        if (dist(me, v.spot) > DETOUR_REACHED) return v.spot;
        this.viaDone = { x: t.x, y: t.y };
        this.vias.delete(key);
        return 'go';
      }
      if (this.now < v.retryAt) return null;
    }
    const fa = fieldFrom(anchor);
    const direct = pathDist(fa, me);
    const spot = Number.isFinite(direct) ? this.pickVia(fa, me, t, direct, dist(me, t)) : null;
    this.vias.set(key, { tx: t.x, ty: t.y, spot, retryAt: this.now + DETOUR_RETRY_TICKS });
    return spot;
  }

  /**
   * 거쳐 갈 곳: 도주 후보 중 (내 자리 → 그곳 → 목표) 길이 가장 짧은 곳. 두 다리 모두 괴물을 본 자리에서 떨어져 지나야 한다
   * (길 위 점이 r 안이면 두 끝까지의 길 거리 합이 길이 + 2r 이하 — 그보다 크면 r 밖). 곧장 가는 길의 DETOUR_RATIO배 + 덤까지만
   */
  private pickVia(fa: Float32Array, me: Vec2, t: Vec2, direct: number, dMeT: number): Vec2 | null {
    const ta = pathDist(fa, t);
    const rMe = Math.min(DETOUR_CLEAR, 0.5 * dMeT);
    let best: Vec2 | null = null;
    let bestCost = direct * DETOUR_RATIO + DETOUR_EXTRA;
    for (let k = 0; k < FLEE_SPOTS.length; k += 1) {
      const s = FLEE_SPOTS[k];
      if (!s) continue;
      const fs = fieldFrom(s);
      const dMe = pathDist(fs, me);
      // 이미 닿아 있는 곳은 거쳐 갈 곳이 아니다 (괴물 자리가 바뀌어 다시 고를 때 내 자리를 다시 고르면 거기 서 버린다)
      if (!Number.isFinite(dMe) || dMe <= DETOUR_REACHED) continue;
      const dA = pathDist(fa, s);
      const cost = dMe + dA;
      if (cost >= bestCost) continue;
      const dT = pathDist(fs, t);
      if (dT + ta <= dA + 2 * DETOUR_CLEAR) continue;
      if (dMeT + dT <= dMe + 2 * rMe) continue;
      best = s;
      bestCost = cost;
    }
    return best;
  }

  /**
   * 기다리기: 남은 할 일이 모두 지켜질 때. 목표 둘레의 기다리는 자리 몇 곳을 오가며 서성인다(한자리에 WAIT_DWELL 안쪽만 머문다).
   * 기다림 한도가 지나면 다른 쪽 자리로 옮기고, 미끼(decoyOrder의 첫 자유 생존자)는 PROBE_TIME 동안 목표로 들어가 본다
   * (PROBE_ALL_ROUND부터는 모두). enter는 들어갈 때의 할 일
   */
  private waitTask(snap: Snapshot, enter: Task): Task {
    const me = snap.you.move;
    const anchor = enter.anchor;
    const t = this.threat;
    let w = this.wait;
    if (!w || w.ax !== anchor.x || w.ay !== anchor.y || this.now - w.last > WAIT_RESET_TICKS) {
      w = {
        ax: anchor.x,
        ay: anchor.y,
        spots: [],
        idx: 0,
        dwellUntil: -1,
        since: this.now,
        patienceAt: this.now + this.patience(),
        round: 0,
        prev: [],
        probeUntil: -1,
        tx: Number.NaN,
        ty: Number.NaN,
        last: this.now,
        infoTick: -1,
      };
      this.wait = w;
    }
    w.last = this.now;
    w.infoTick = t?.tick ?? -1;
    if (this.now >= w.patienceAt) {
      w.round += 1;
      w.patienceAt = this.now + this.patience();
      if (w.spots.length > 0) w.prev = w.spots;
      w.spots = [];
      if (w.round >= PROBE_ALL_ROUND || this.isDecoy(snap)) w.probeUntil = this.now + this.sec(PROBE_TIME);
    }
    if (this.now < w.probeUntil) return { ...enter, probe: true };
    const moved = t !== null && !(Math.hypot(t.x - w.tx, t.y - w.ty) <= WAIT_REPLAN_MOVE);
    if (w.spots.length === 0 || moved) {
      w.spots = this.pickWaitSpots(anchor, me, w.prev);
      w.idx = 0;
      w.dwellUntil = -1;
      w.tx = t?.x ?? Number.NaN;
      w.ty = t?.y ?? Number.NaN;
    }
    const n = w.spots.length;
    let spot = w.spots[w.idx % n] ?? me;
    if (w.dwellUntil >= 0) {
      if (this.now >= w.dwellUntil) {
        w.idx = (w.idx + 1) % n;
        w.dwellUntil = -1;
        spot = w.spots[w.idx] ?? spot;
      }
    } else if (dist(me, spot) <= WAIT_TOL) {
      w.dwellUntil = this.now + this.sec(WAIT_DWELL_MIN + this.waitRng.next() * WAIT_DWELL_SPAN);
    }
    return { kind: 'wait', target: spot, tol: WAIT_TOL, held: 0, commit: false, anchor };
  }

  private patience(): number {
    return this.sec(WAIT_PATIENCE_MIN + this.waitRng.next() * WAIT_PATIENCE_SPAN);
  }

  /** 미끼 차례인가: 미끼 순서(판 시드)에서 자유로운 첫 생존자가 나 (동료 상태는 팀 모두가 같은 스냅샷으로 본다) */
  private isDecoy(snap: Snapshot): boolean {
    for (const role of this.decoys) {
      if (role === this.role) return true;
      const mate = snap.survivors.find((s) => s.role === role);
      if (mate && mate.status === 'free') return false;
    }
    return false;
  }

  /**
   * 기다리는 자리 WAIT_SPOT_COUNT곳: 도주 후보 중 목표에서 길 거리 WAIT_DIST쯤 · 괴물보다 먼저 닿는 곳 · 괴물에게서 안 보이는 곳 ·
   * 내게서 가까운 곳 · 앞 라운드 자리에서 먼 곳(다른 쪽에서 접근). 첫 자리에서 WAIT_HOP_MIN ~ WAIT_HOP_MAX 길 거리인 곳을 더한다
   */
  private pickWaitSpots(anchor: Vec2, me: Vec2, avoid: readonly Vec2[]): Vec2[] {
    const fa = fieldFrom(anchor);
    const t = this.threat;
    const scores: number[] = [];
    let first = -1;
    for (let k = 0; k < FLEE_SPOTS.length; k += 1) {
      const s = FLEE_SPOTS[k];
      scores.push(-Infinity);
      if (!s) continue;
      const fs = fieldFrom(s);
      const dMe = pathDist(fs, me);
      if (!Number.isFinite(dMe)) continue;
      const da = pathDist(fa, s);
      let score = -0.5 * Math.abs(da - WAIT_DIST) - 0.2 * dMe + OPEN_WEIGHT * opennessOf(k);
      if (t) {
        const margin = pathDist(fs, t) - FLEE_SPEED_RATIO * dMe;
        if (margin < WAIT_SAFE) score -= 20 + (WAIT_SAFE - margin);
        if (lineOfSight(t, s)) score -= 4;
      }
      for (const p of avoid) if (dist(p, s) < WAIT_AVOID_RADIUS) score -= WAIT_AVOID_PENALTY;
      scores[k] = score;
      if (first < 0 || score > (scores[first] ?? -Infinity)) first = k;
    }
    const s0 = FLEE_SPOTS[first];
    if (!s0) return [snapToFloor(me)];
    const out: Vec2[] = [s0];
    const f0 = fieldFrom(s0);
    while (out.length < WAIT_SPOT_COUNT) {
      let pick = -1;
      for (let k = 0; k < FLEE_SPOTS.length; k += 1) {
        const s = FLEE_SPOTS[k];
        if (!s || out.includes(s)) continue;
        const hop = pathDist(f0, s);
        if (hop < WAIT_HOP_MIN || hop > WAIT_HOP_MAX) continue;
        if (out.some((q) => dist(q, s) < WAIT_HOP_MIN)) continue;
        if (pick < 0 || (scores[k] ?? -Infinity) > (scores[pick] ?? -Infinity)) pick = k;
      }
      const s = FLEE_SPOTS[pick];
      if (!s) break;
      out.push(s);
    }
    // 이웃 자리가 하나도 없으면(막다른 곳) 내 자리와 오간다 — 한자리에 서 있지 않게
    if (out.length < 2) out.push(snapToFloor(me));
    return out;
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
    // 밀치기가 준비된 가드도 다른 생존자처럼 달아난다 (예전에는 2.4타일까지 버텼다 — 밀치기 반응 지연이 생긴 뒤로는 버티면 맞고,
    // 괴물 화면에서 '다가가도 안 도망가는 흰 사람 = 가드'라는 움직임 단서였다). 밀치기는 쫓아온 괴물이 사거리에 들면 누른다
    let radius = FLEE_DIST + (surv.hp < b.survivor.maxHp ? FLEE_INJURED_BONUS : 0);
    if (this.fleeing) radius += FLEE_HYST;
    const age = this.now - t.tick;
    let threatened = false;
    // 팀 시야에 보이는 괴물: 벽 너머라도 길 거리가 가까우면 달아난다 (새로 보인 괴물은 알아챈 뒤부터 — 단계 2, 기본 끔)
    if (fresh)
      threatened =
        (this.fleeing || this.now >= this.noticeAt) && d < radius && this.threatPathDist(me, radius) < radius;
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
      // 곧장 반대쪽으로. 공격 준비를 본 뒤 반응 시간이 지났으면 고정된 조준에서 옆으로 비켜난다 (굴린 대로: 못 비킴 · 반대쪽 · 오차)
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
      const dodge = this.dodge;
      let angle = Math.atan2(ay, ax);
      if (m && m.windup > 0 && dodge && !dodge.skip && this.now >= dodge.at) {
        const px = -Math.sin(m.aim);
        const py = Math.cos(m.aim);
        let side = (me.x - dg.x) * px + (me.y - dg.y) * py >= 0 ? 1 : -1;
        if (dodge.wrong) side = -side;
        ax = ax / Math.max(dg.d, 0.1) + px * side * 0.8;
        ay = ay / Math.max(dg.d, 0.1) + py * side * 0.8;
        angle = Math.atan2(ay, ax) + dodge.noise;
      }
      const dir = freeDirection(me, angle, b.survivor.radius);
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
   * 가까이 있는 자유 동료와 갈라질 쪽: 갈라지기 순서(splitOrder, 판 시드)에서 내가 앞이면 왼쪽(+1), 뒤면 오른쪽(-1), 가까운 동료가
   * 없으면 0. 두 봇이 같은 순서 · 같은 역할 쌍을 보므로 서로 반대쪽을 고른다. 동료 역할을 모르면 자리 ID 순서
   */
  private splitSide(snap: Snapshot): number {
    const me = snap.you.move;
    let mate: SurvivorView | null = null;
    for (const s of snap.survivors) {
      if (s.status !== 'free' || dist(s, me) > SPLIT_RADIUS) continue;
      if (!mate || dist(s, me) < dist(mate, me)) mate = s;
    }
    if (!mate) return 0;
    const mine = this.splits.indexOf(this.role);
    const theirs = mate.role ? this.splits.indexOf(mate.role) : -1;
    if (theirs < 0 || theirs === mine) return snap.you.id < mate.id ? 1 : -1;
    return mine < theirs ? 1 : -1;
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
    if (!surv) return 0;
    if (this.role === 'scout') return surv.abilityCd > 0 ? 0 : this.scoutTrack(snap, task);
    // 질주 · 밀치기: 조건이 처음 참이 된 때부터 사람 반응 시간(ABILITY_REACT)이 지나야 누른다. 조건이 풀리면 처음부터
    const want = surv.abilityCd <= 0 && this.abilityWanted(snap, b, dg);
    if (!want) {
      this.abilitySince = -1;
      return 0;
    }
    if (this.abilitySince < 0) {
      this.abilitySince = this.now;
      this.abilityWait = uniform(this.abilityRng, ABILITY_REACT) * this.hz;
    }
    if (this.now - this.abilitySince < this.abilityWait) return 0;
    this.abilitySince = -1;
    return BTN.ABILITY;
  }

  /** 질주(러너: 달아나는 중 괴물이 가까이 보임) · 밀치기(가드: 괴물이 사거리 안 · 벽 없음 · 기절 아님) 조건 */
  private abilityWanted(snap: Snapshot, b: Balance, dg: Danger | null): boolean {
    const m = snap.monster;
    if (this.role === 'runner') return dg !== null && dg.fresh && dg.d < SPRINT_DIST;
    if (this.role !== 'guard' || !m || m.stunned) return false;
    const me = snap.you.move;
    if (dist(me, m) > b.roles.guard.shoveRange - SHOVE_MARGIN) return false;
    return !segmentBlocked(me, m, blocksStrike);
  }

  /** 스카우트 탐지: 괴물 정보가 한동안 없고 할 일 근처일 때 */
  private scoutTrack(snap: Snapshot, task: Task): number {
    if (snap.monster) return 0;
    const me = snap.you.move;
    const idle = this.now - this.lastInfo;
    const rescuing = task.kind === 'rescue' && dist(me, task.target) <= 12;
    if (idle < this.sec(rescuing ? TRACK_RESCUE_IDLE : this.trackIdle)) return 0;
    const busy =
      task.kind === 'capture' || task.kind === 'rescue' || task.kind === 'exit' || task.kind === 'wait';
    if (!busy || dist(me, task.target) > (rescuing ? 12 : 8)) return 0;
    this.trackIdle = TRACK_IDLE_MIN + this.rng.next() * TRACK_IDLE_SPAN;
    return BTN.ABILITY;
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
