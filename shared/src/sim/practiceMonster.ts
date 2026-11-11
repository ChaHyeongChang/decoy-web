// 실전 봇 두뇌: 괴물 (M13b, 플레이테스트 반영 c에서 practiceBrains.ts에서 나눔).
// 두뇌는 decide()로 받은 것 — 자기에게 온(정보 차단된) 스냅샷 · MatchInfo · Balance — 과 공개 지도만 본다.
// 결정적이다: 같은 seed + 같은 스냅샷이면 같은 입력 (시드 난수 Rng만, 괴물 화면 생존자 배열 순서 · 임시 ID 값에 기대지 않는다)
//
// 플레이테스트 반영 c (docs/playtest/c-bots.md 3.3절 M1~M7):
//  - M1 돌진이 끝나는 첫 틱에 거리 · 조준이 맞으면 바로 공격 (돌진 직후에 한해 공격 조건을 조금 느슨하게, 돌진 주사위 0.85 이상)
//  - M2 추격 중 멀어지는 표적에게 4.4~5.5타일에서 거리 좁히기 돌진
//  - M3 포효 핑을 목표로 쓴다 (놓친 곳 수색보다 앞, 핑이 여럿이면 가까운 것부터 차례로). 누르는 때는 놓친 곳을 둘러봐도 없을 때 ·
//    알림 거점에 닿았는데 아무도 없을 때 · 오래 못 봤을 때
//  - M4 점령 알림을 기억해 추적이 끝나면 그 거점부터 (놓친 곳 수색보다 앞)
//  - M5 서지 않기: 거점 매복 · 감옥 감시에 서 있는 대신 짧게 훑고 거점 둘레 · 감시 자리 사이를 걷는다. 같은 거점을 연달아 고르지 않는다.
//    추적 · 시작 대기 · 기절이 아니면 한자리에 STAND_LIMIT 넘게 머물지 않는다 (서 있기 감시)
//  - M6 추적 중 표적이 가까우면 탐색 시야(넓게), 넓히는 중에 탐색 시야 사거리 밖으로 멀어지면 추적 시야로 되돌림 (다 넓힌 뒤에는 놓칠 때까지)
//  - M7 놓친 뒤: 마지막 위치 → 달아나던 쪽의 안 보이는 도주 후보 둘 → 그래도 없으면 포효. 가뒀거나 죽었거나(세 번째로 잡힘)
//    탈출해 사라진 표적은 놓친 것이 아니다 (같은 스냅샷의 'imprisoned' · 'died' · 'escaped' 이벤트로 안다)
//  - 표적 동점(같은 거리)은 위치 → 속도 → 처음 본 틱으로 가르고, 그래도 같은 생존자들은 하나로 묶어 쫓는다 (누구인지 고르지 않는다)
//  - '아무도 못 본 시간'은 판 시작 카운트다운이 끝난 때부터 센다
//  - 조정 A (손): 공격을 겨누고 누를지 정하고 준비 동안 따라갈 때는 판마다 0.05~0.15초 전에 본 표적 모습을 이어 짐작한다 (방향을 튼
//    것은 늦게 안다). 공격마다 조준 오차 ±0.08라디안, 12%는 닿는 거리를 0.15~0.4타일 길게 보고 이르게 누른다. 쫓기 · 돌진은 그대로
// 통합 조정 d (감옥 지키기 강도 — 봇끼리 판 괴물 승률이 사람 괴물보다 높아서):
//  - 한 명을 가둔 직후 감옥 감시는 반반. 감시로 안 가면 감옥을 비우고 다른 생존자를 찾으러 가며, 감시 간격만큼 '가끔 감시'도 미룬다
//  - 둘 이상 갇혀 있을 때 감시 자리 넷을 오가는 감시도 감시 간격마다만 (할 일이 없을 때마다 되풀이하지 않는다)
import {
  BTN,
  CAPTURE_POINTS,
  POINT_IDS,
  EXITS,
  PRISON_RECT,
  RESCUE_POINT,
  Rng,
  angleDiff,
  distToRect,
  emptyInput,
  lineOfSight,
  type Balance,
  type InputFrame,
  type MatchInfo,
  type PointId,
  type PointView,
  type Snapshot,
  type Vec2,
  type VisionModeId,
} from '../index';
import { Walker, aimAt, dist, type BotBrain } from './botBrains';
import {
  brainRng,
  clearPath,
  EXIT_INWARD,
  fieldFrom,
  FLEE_SPOTS,
  MONSTER_CROSS,
  MONSTER_EXIT_LOOP,
  MONSTER_LOOP,
  pathDist,
  pointOpen,
  snapToFloor,
  STUCK_MOVE,
  STUCK_TICKS,
  unit,
  walkableAt,
  WATCH_SPOTS,
  WATCH_TOLERANCE,
} from './practiceMap';

// ───────────────────────── 괴물 ─────────────────────────

/** 공격: 준비(0.4초) 끝 예상 거리가 사거리 + 생존자 반지름 - 이 여유 안이면 누른다 (타일) */
const ATTACK_MARGIN = 0.25;
/** 공격을 누를 때 조준과 표적 방향의 최대 차이 (라디안). 준비 중에는 조준이 고정된다 */
const ATTACK_FACING = 0.4;
/** 공격은 지금 거리가 사거리 + 이만큼(타일) 안일 때만 (다가오는 속도 추정이 틀려 헛치지 않게) */
const ATTACK_NOW_SLACK = 0.55;
/** 다가오는 속도는 이만큼(타일/초)까지만 믿는다 (방향을 자주 바꾼다) */
const APPROACH_TRUST = 1.0;
/** 돌진(가까운 창, M1): 표적까지 이 거리 범위에서만 (타일). 돌진 4타일 뒤 바로 공격할 수 있는 거리 */
const DASH_MIN = 2.8;
const DASH_MAX = 4.4;
/** 거리 좁히기 돌진 (M2): 가까운 창 바깥 ~ 이 거리, 표적이 이 속도(타일/초) 이상으로 멀어지는 중일 때 */
const DASH_FAR = 5.5;
const DASH_CLOSE_AWAY = 2.0;
/** 돌진 주사위 확률 (최소 + 시드 범위): 사람처럼 아주 가끔은 안 쓴다 */
const DASH_CHANCE_MIN = 0.85;
const DASH_CHANCE_SPAN = 0.1;
/** 새로 보인 생존자에게 공격 · 돌진하기까지 반응 시간 (초) */
const REACT_TIME = 0.25;
/** 돌진 조준 허용 오차 (라디안). 돌진은 지금 조준 방향으로 나간다 */
const DASH_FACING = 0.12;
/** 돌진 기회를 놓쳤으면(주사위 실패) 다시 굴릴 때까지 (초) */
const DASH_REROLL = 2.0;
/** 돌진 → 공격 잇기 (M1): 돌진이 끝난 뒤 이 시간(초) 동안은 공격 조건을 아래 값으로 느슨하게 본다 */
const COMBO_WINDOW = 0.35;
const COMBO_MARGIN = 0.18;
const COMBO_NOW_SLACK = 0.65;
const COMBO_FACING = 0.5;
/** 이 거리 안이고 직선이 비어 있으면 길찾기 없이 곧장 쫓는다 (타일) */
const DIRECT_CHASE = 3.5;
/** 추적 중 표적의 이동을 내다보는 최대 시간 (초) */
const CHASE_LEAD_MAX = 0.35;
/**
 * 추적 중 시야 (M6): 표적이 WIDE_NEAR 안이면 탐색 시야(넓게), 탐색 시야 사거리(balance) 밖이면 추적 시야. 사이는 그대로 (이력, 타일).
 * 거두는 거리는 chaseVisionBand가 balance에서 읽는다
 */
const WIDE_NEAR = 3.5;
/** 보호 중인 생존자는 이만큼 먼 것으로 친다 (타일): 다른 표적이 있으면 그쪽 */
const PROTECTED_PENALTY = 8;
/** 지금 쫓는 표적을 유지하는 덤 (타일): 비슷하면 표적을 바꾸지 않는다 */
const KEEP_TARGET_BONUS = 1.5;
/** 같은 값으로 보는 차이 (거리 · 좌표 · 속도) */
const TIE_EPS = 1e-9;
/** 놓친 표적: 마지막 위치에서 이만큼 앞(초)을 찾아간다. 최대 거리(타일) */
const LOST_LEAD = 0.8;
const LOST_LEAD_MAX = 4;
/** 놓친 곳 · 도주 후보까지 가는 시간 한도 (초) */
const LOST_TIME = 4;
const SEARCH_TIME = 5;
/** 놓친 곳 · 도주 후보에 닿은 뒤 둘러보는 시간 (초) */
const LOST_LOOK = 1.2;
const SEARCH_LOOK = 0.8;
/** 놓친 뒤 수색할 도주 후보 (M7): 마지막 위치에서 길 거리 범위 (타일), 개수, 두 후보 사이 최소 거리 (타일) */
const SEARCH_PATH_MIN = 4;
const SEARCH_PATH_MAX = 8;
const SEARCH_SPOTS = 2;
const SEARCH_SPREAD = 3;
/** 탈출구 · 구조 알림 지점에 닿은 뒤 둘러보는 시간 (초) */
const LOOK_TIME = 1.8;
/** 거점에 닿은 뒤 훑는 시간 (초, 최소 + 시드 범위). 2초를 넘지 않는다 (M5) */
const POINT_LOOK_MIN = 1.0;
const POINT_LOOK_SPAN = 0.6;
/** 거점 가운데로 들어가 볼 때 둘러보는 시간 (초): 배지는 점령 중인데 둘레에서 아무도 안 보일 때 */
const CENTER_LOOK = 0.8;
/** 기다리는 자리: 거점 반경에서 이만큼 바깥 (타일) */
const AMBUSH_OUT = 0.7;
/** 거점 둘레 돌기 (M5): 거점 중심에서 이 직선 거리들로 바닥을 찾고 길 거리가 범위 안인 곳 (타일), 방향 수, 자리 사이 최소 거리 */
const RING_RADII: readonly number[] = [5, 4.5, 5.5, 4];
const RING_PATH_MIN = 4;
const RING_PATH_MAX = 6.5;
const RING_DIRS = 12;
const RING_SPREAD = 2.5;
/** 둘레 돌기: 한 번에 들르는 자리 수, 자리마다 거점 쪽을 보는 시간 (초, 최소 + 시드 범위), 도착 여유 (타일) */
const RING_STOPS = 4;
const RING_LOOK_MIN = 0.4;
const RING_LOOK_SPAN = 0.4;
const RING_TOLERANCE = 0.8;
/** 둘레 돌기 첫 자리는 지금 자리에서 이만큼(타일) 넘게 떨어진 곳 (도착하자마자 또 서지 않게) */
const RING_FIRST_GAP = 1.5;
/** 거점 가장자리 · 둘레에서 둘러보는 동안 옆걸음 (입력 크기 0~1), 앞이 비었는지 볼 거리 (타일), 방향을 바꾸는 흔들기 배율 */
const STRAFE_SPEED = 0.3;
const STRAFE_LOOKAHEAD = 0.6;
const STRAFE_FLIP = 0.5;
/** 조사 지점까지 가는 시간 한도 (초) */
const GOAL_TIME = 25;
/** 탈출구 · 구조 알림 지점에 닿아 아무도 없을 때 포효할 확률 */
const ROAR_AT_LOOK_PROB = 0.35;
/** 아무도 못 본 채 이만큼(초, 최소 + 시드 범위) 지나면 포효 */
const ROAR_IDLE_MIN = 14;
const ROAR_IDLE_SPAN = 14;
/** 포효하려던 마음은 이만큼(초) 안에 누르지 못하면 버린다 (기절 · 돌진 중이었을 때) */
const ROAR_WANT_TIME = 1.0;
/** 포효 핑 (M3): 핑 좌표를 기억하는 시간 (초 — 핑은 1.5초만 보인다), 핑까지 가는 시간 한도, 닿아서 둘러보는 시간 (초) */
const PING_MEMORY = 10;
const PING_TIME = 6;
const PING_LOOK = 1.0;
/**
 * 감옥 안 바닥 (철창 한 칸 안쪽 2×2): 수감자가 있을 수 있는 곳. 갇힌 생존자는 감옥 문 칸을 못 지나가므로(map.ts blocksMove) 이 밖의
 * 포효 핑(문 칸 · 문 앞)은 자유 생존자다
 */
const PRISON_INNER = {
  x0: PRISON_RECT.x0 + 1,
  y0: PRISON_RECT.y0 + 1,
  x1: PRISON_RECT.x1 - 1,
  y1: PRISON_RECT.y1 - 1,
} as const;
/** 점령 알림을 기억하는 시간 (초, M4): 추적이 끝났을 때 이 안이면 그 거점부터 */
const ALERT_MEMORY = 18;
/** 알림 거점으로 가는 중 다른 거점 알림이 오면: 진행이 이만큼(0~1) 더 많거나, 비슷하면 길이 이만큼(타일) 더 가까울 때만 바꾼다 */
const ALERT_SWITCH_PROGRESS = 0.1;
const ALERT_SWITCH_PATH = 6;
/** 순찰 중 가운데 모퉁이에 들를 확률 (지점마다) */
const DETOUR_PROB = 0.3;
/** 거점이 남아 있으면 순찰 대신 안 끝난 거점을 지킬 확률 (할 일이 없을 때마다) */
const POINT_PATROL_PROB = 0.65;
/** 순찰을 고르면 이만큼(순찰 지점 수, 최소 + 시드 범위) 돈 뒤 다시 고른다 */
const PATROL_LEGS_MIN = 1;
const PATROL_LEGS_SPAN = 3;
/** 감옥 감시 (M5): 자리마다 구조 지점을 보는 시간 (초, 최소 + 시드 범위), 한 번에 들르는 감시 자리 수 */
const WATCH_LOOK_MIN = 1.2;
const WATCH_LOOK_SPAN = 0.8;
const WATCH_STOPS = 2;
/** 둘 이상 갇혀 있을 때(한 명만 더 잡으면 이긴다) 한 번에 들르는 감시 자리 수 (셋을 오간다). 감시 간격마다 한 번 */
const WATCH_STOPS_GUARD = 4;
/** 감시 자리에 이미 서 있다고 보는 거리 (타일) */
const WATCH_HERE = 1.0;
/** 다음 감시까지 (초, 최소 + 시드 범위) — 예전 감시 길이(4~8초)를 더한 간격 그대로 */
const WATCH_GAP_MIN = 20;
const WATCH_GAP_SPAN = 12;
/**
 * 생존자를 가둔 직후 감옥 감시로 갈 확률 (구조하러 올 것이다). 갇힌 사람이 하나면 반반 — 사람 괴물은 가둔 뒤 다른 생존자를
 * 쫓아 감옥을 비우기도 한다. 둘 이상이면(한 명만 더 잡으면 이긴다) 거의 늘 감시. 감시로 안 가면 감시 간격(최소)만큼 감시를 미룬다
 */
const WATCH_AFTER_JAIL_PROB = 0.5;
const WATCH_AFTER_JAIL_PROB_GUARD = 0.85;
/** 감옥 캠핑 경고 전에 스스로 나가는 시간 (초, 규칙의 경고 3초 · 감속 5초보다 앞) */
const CAMP_LEAVE = 2.5;
/** 거점 안에 이만큼(초) 있으면 반경 밖으로 한 번 나갔다 온다 (규칙의 유예 5초보다 앞) */
const POINT_STAY_MAX = 3.5;
/** 서 있기 감시 (M5): 추적 · 시작 대기 · 기절이 아닌데 이만큼(초) 동안 STAND_MOVE(타일)도 못 움직였으면 다음 할 일로 */
const STAND_LIMIT = 2.4;
const STAND_MOVE = 0.3;
/** 시야 버튼을 다시 누르기까지 최소 틱 (스냅샷에 바뀐 모드가 오기 전에 또 눌러 되돌리지 않게) */
const MODE_PRESS_GAP = 10;
/** 조사하러 가는 길: 목표가 이보다 멀면 추적 시야 (타일) */
const GOAL_HUNT_DIST = 6;
/** 둘러보기 · 순찰 조준 흔들기 폭 (라디안)과 속도 (라디안/틱) */
const SWEEP_AMP_LOOK = 1.1;
const SWEEP_AMP_PATROL = 0.45;
const SWEEP_AMP_POINT = 0.7;
const SWEEP_AMP_WATCH = 0.3;
const SWEEP_AMP_RING = 0.5;
const SWEEP_RATE = 0.09;
/** 새 행동(c)의 난수 흐름 소금: 예전 난수 흐름(this.rng)의 순서를 밀지 않게 따로 뽑는다 */
const TACTICS_SALT = 0x7f4a7c15;

// ── 손 (플레이테스트 반영 c 조정 A): 전술(언제 · 어디로 쫓고 돌진하나)은 그대로 두고, 공격을 겨누고 누르고 준비 동안 따라가는 손에
//    사람다운 한계를 둔다. 예전에는 표적의 예상 위치를 1~2틱 만에 따라가 옆걸음을 거의 다 맞혔다 (docs/playtest/c-bots.md 2.2절)
/** 표적의 움직임이 바뀐 것을 알아채기까지 (초, 판마다 최소 + 시드 범위 — 판마다 사람이 다르듯). 공격을 겨누고 누를지 정할 때와
 *  준비 동안 따라갈 때는 이만큼 전에 본 모습을 그때 속도로 이어 짐작한다: 곧게 달아나는 표적은 그대로 맞히고, 방향을 튼 것은 늦게 안다 */
const HAND_LAG_MIN = 0.05;
const HAND_LAG_SPAN = 0.1;
/** 조준 오차 (±라디안, 균등): 공격 한 번마다 새로 뽑는다 */
const HAND_AIM_ERROR = 0.08;
/** 이르게 누르기: 공격 한 번마다 이 확률로 닿는 거리를 U(MIN, MAX)타일 길게 본다 */
const HAND_EARLY_PROB = 0.12;
const HAND_EARLY_MIN = 0.15;
const HAND_EARLY_MAX = 0.4;
/** 알아채기 지연을 넘는 모습 기록은 버린다 (틱, 여유) */
const HAND_HISTORY_EXTRA = 3;
/** 손의 난수 흐름 소금 (예전 흐름 · 새 행동 흐름의 뽑기 순서를 밀지 않는다) */
const HAND_SALT = 0x2c1b3c6d;

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

type GoalKind = 'lost' | 'search' | 'point' | 'ring' | 'roar' | 'exit' | 'rescue' | 'watch';

interface Goal {
  kind: GoalKind;
  x: number;
  y: number;
  /** 이 틱까지 못 닿으면 포기 */
  until: number;
  /** 닿은 뒤 둘러보기 끝 틱 (아직 안 닿았으면 null) */
  lookUntil: number | null;
  /** 둘러볼 중심 방향 (null이면 focus 쪽, 그것도 없으면 닿을 때의 조준) */
  aim: number | null;
  /** 닿으면 바라볼 곳 (거점 가운데 · 구조 지점) */
  focus: Vec2 | null;
  /** 닿은 뒤 둘러볼 시간 (초) */
  look: number;
  /** 닿은 뒤 포효 주사위를 굴렸는가 (탈출구 · 구조) */
  rolled: boolean;
  /** 거점 목표 (point · ring) */
  point: PointId | null;
  /** 알림 · 배지로 온 거점: 닿아서 아무도 없으면 포효 */
  alerted: boolean;
  /** 거점 가운데로 들어가 보는 목표 */
  center: boolean;
  /** 같은 종류로 이어서 들를 자리 (둘레 돌기 · 감시 · 도주 후보) */
  next: Vec2[];
}

interface GoalOptions {
  aim?: number | null;
  focus?: Vec2 | null;
  look?: number;
  point?: PointId | null;
  alerted?: boolean;
  center?: boolean;
  next?: Vec2[];
  rolled?: boolean;
}

/** 목표 우선순위: 낮은 것이 높은 것을 못 덮는다 (같으면 새것). 포효 핑 · 알림이 놓친 곳 수색보다 앞 (M3 · M4) */
const GOAL_PRIORITY: Readonly<Record<GoalKind, number>> = {
  watch: 0,
  ring: 0,
  rescue: 1,
  lost: 2,
  search: 2,
  point: 3,
  roar: 3,
  exit: 4,
};

const NEVER = -1e9;

export class PracticeMonsterBrain implements BotBrain {
  private readonly rng: Rng;
  /** 플레이테스트 반영 c에서 더한 행동의 난수 (둘러보기 길이 · 둘레 도는 방향 · 거리 좁히기 돌진 주사위) */
  private readonly tactics: Rng;
  /** 손 (조정 A)의 난수: 판마다 알아채기 지연, 공격마다 조준 오차 · 이르게 누르기 */
  private readonly hand: Rng;
  /** 알아채기 지연 (초, 판마다 시드로) */
  private readonly handLag: number;
  /** 이번 공격의 조준 오차 (라디안) · 닿는 거리 덤 (타일, 이르게 누르기) */
  private aimErr = 0;
  private reachErr = 0;
  /** 임시 ID별 최근 모습 기록 (오래된 것부터, 알아채기 지연만큼) */
  private readonly history = new Map<string, Sighting[]>();
  private readonly walker = new Walker();
  private hz = 30;
  private lastObserved = -1;
  private now = 0;
  /** 임시 ID별 최근 모습 (속도 추정용). 결정은 위치 · 속도 · 처음 본 틱으로만 하고 ID 값 자체에는 기대지 않는다 */
  private readonly tracks = new Map<string, Sighting>();
  private chase: Sighting | null = null;
  /** 쫓는 표적의 임시 ID: 보통 하나. 위치 · 속도 · 처음 본 틱까지 같은 생존자가 여럿이면 모두 (그중 하나를 고르지 않는다) */
  private chaseIds: ReadonlySet<string> = new Set<string>();
  private lastSawFree = 0;
  private goal: Goal | null = null;
  private loopIdx: number;
  private readonly loopStep: 1 | -1;
  private detour: Vec2 | null = null;
  private modePressSeq = -1e9;
  private roarIdle: number;
  private campTicks = 0;
  private readonly pointTicks: Record<PointId, number> = { A: 0, B: 0, C: 0 };
  private stepOut: { x: number; y: number; until: number } | null = null;
  private nextWatchAt = 0;
  private readonly dashChance: number;
  private dashBlockedUntil = 0;
  /** 돌진 직후 공격 조건을 느슨하게 보는 마지막 틱 (M1) */
  private comboUntil = NEVER;
  private sweep = 0;
  private stuckFrom: { x: number; y: number; tick: number } | null = null;
  /** 남은 순찰 구간 수 (0이면 할 일이 없을 때 거점 지키기와 순찰 중에 다시 고른다) */
  private patrolLegs = 0;
  private lastGuarded: PointId | null = null;
  /** 이 틱까지 기회가 오면 포효 (놓친 곳 수색이 끝났을 때 · 알림 거점이 비었을 때) */
  private roarWantUntil = NEVER;
  /** 기억하는 포효 핑 (가까운 것부터 차례로)과 받은 틱 (M3) */
  private pings: Vec2[] = [];
  private pingsAt = NEVER;
  /** 거점별 마지막 점령 알림 틱 (M4, 닿으면 지운다)과 마지막으로 들른 틱 */
  private readonly alertAt: Record<PointId, number> = { A: NEVER, B: NEVER, C: NEVER };
  private readonly visitedAt: Record<PointId, number> = { A: NEVER, B: NEVER, C: NEVER };
  /** 추적 중 원하는 시야 (M6 이력) */
  private chaseMode: VisionModeId = 'hunt';
  private chasing = false;
  /** 지난 스냅샷이 판 시작 카운트다운 중이었다 */
  private counting = false;
  /** 서 있기 감시: 이 자리 · 틱부터 STAND_MOVE 안에 머물렀다 */
  private standAnchor: { x: number; y: number; tick: number } | null = null;
  /** 이번 틱에 한 일 (진단용: 계측 도구 · 시험이 읽는다. 결정에는 쓰지 않는다) */
  act = 'wait';
  /** 마지막 돌진 종류 (진단용): 'close' 가까운 창(M1) · 'far' 거리 좁히기(M2) */
  lastDashKind = '';

  constructor(seed: number) {
    this.rng = brainRng(seed, 'monster');
    this.loopIdx = this.rng.int(MONSTER_LOOP.length);
    this.loopStep = this.rng.next() < 0.5 ? 1 : -1;
    this.roarIdle = ROAR_IDLE_MIN + this.rng.next() * ROAR_IDLE_SPAN;
    this.dashChance = DASH_CHANCE_MIN + this.rng.next() * DASH_CHANCE_SPAN;
    this.sweep = this.rng.next() * Math.PI * 2;
    this.tactics = new Rng((Math.imul(seed | 0, 0x9e3779b1) ^ TACTICS_SALT) >>> 0);
    this.hand = new Rng((Math.imul(seed | 0, 0x85ebca6b) ^ HAND_SALT) >>> 0);
    this.handLag = HAND_LAG_MIN + this.hand.next() * HAND_LAG_SPAN;
    this.rollHand();
  }

  /** 다음 공격의 손 오차를 뽑는다 (늘 세 번 뽑는다) */
  private rollHand(): void {
    const r = this.hand;
    this.aimErr = (r.next() * 2 - 1) * HAND_AIM_ERROR;
    const early = r.next() < HAND_EARLY_PROB;
    const extra = HAND_EARLY_MIN + r.next() * (HAND_EARLY_MAX - HAND_EARLY_MIN);
    this.reachErr = early ? extra : 0;
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
    if (snap.world.countdown > 0 || snap.world.monsterWait > 0 || me.frozen > 0) {
      out.aim = aimAt(me, firstStop);
      this.act = 'wait';
      this.standAnchor = null;
      return out;
    }
    this.sweep += SWEEP_RATE;
    let mode: VisionModeId = 'search';
    const target = this.pickTarget(snap);
    const slowedInCamp = snap.world.imprisoned > 0 && mon.camp >= 2;
    if (target && !slowedInCamp) {
      mode = this.chaseTarget(snap, b, target, out);
      this.act = 'chase';
      this.chasing = true;
      this.standAnchor = null;
    } else {
      this.chasing = false;
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
    // '아무도 못 본 시간'은 판이 흐를 때부터: 처음 받은 스냅샷(실제 방에서는 카운트다운이 끝난 틱)과 카운트다운 동안은 세지 않는다
    if (prevTick < 0 || snap.world.countdown > 0 || this.counting) this.lastSawFree = snap.tick;
    this.counting = snap.world.countdown > 0;
    const me = snap.you.move;
    // 이 스냅샷에 누가 죽었거나(세 번째로 잡힘 — 괴물의 공격으로만 죽는다) 탈출했다: 그 생존자는 괴물 화면에서 사라진다
    let gone = false;
    for (const ev of snap.events) {
      if (ev.k === 'died' || ev.k === 'escaped') gone = true;
      else if (ev.k === 'roarPings') this.takePings(ev.pts, me);
      else if (ev.k === 'text') {
        if (ev.id === 'ALERT_CAPTURE_START' && ev.point) {
          // 쫓는 중이면 기억만 하고 추적이 끝나면 간다 (M4). 다른 알림 거점으로 가는 중이면 더 급할 때만 바꾼다
          this.alertAt[ev.point] = snap.tick;
          if (!this.chase && this.moreUrgent(ev.point, snap.world.points, me))
            this.pointGoal(ev.point, me, b, true);
        } else if (ev.id === 'ALERT_EXIT_OPEN' && ev.exit) {
          const c = EXITS[ev.exit].center;
          this.setGoal('exit', { x: c.x, y: c.y + EXIT_INWARD[ev.exit] * 1.5 }, GOAL_TIME, {
            look: LOOK_TIME,
          });
        } else if (ev.id === 'ALERT_RESCUED') {
          this.setGoal('rescue', { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 2 }, GOAL_TIME, {
            look: LOOK_TIME,
          });
        }
      } else if (ev.k === 'imprisoned') {
        // 방금 가둔 표적은 놓친 것이 아니다. 구조하러 올 테니 감옥 감시로 가거나(둘 이상 갇혔으면 거의 늘),
        // 감옥을 비우고 다른 생존자를 찾으러 간다 — 그때는 '가끔 감시'도 감시 간격만큼 미뤄 곧바로 되돌아오지 않는다
        this.chase = null;
        this.chaseIds = new Set<string>();
        const watchProb = snap.world.imprisoned >= 2 ? WATCH_AFTER_JAIL_PROB_GUARD : WATCH_AFTER_JAIL_PROB;
        if (this.rng.next() < watchProb) this.goal = this.watchGoal(me);
        else this.nextWatchAt = Math.max(this.nextWatchAt, this.now + this.sec(WATCH_GAP_MIN));
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
      const sighting: Sighting = {
        id: s.id,
        x: s.x,
        y: s.y,
        vx,
        vy,
        tick: snap.tick,
        prot: s.protected,
        since,
      };
      this.tracks.set(s.id, sighting);
      // 손 (조정 A): 알아채기 지연만큼 지난 모습을 기억한다 (끊겼다 다시 보이면 새로)
      const keep = this.handLag * this.hz + HAND_HISTORY_EXTRA;
      const hist = prev && snap.tick - prev.tick <= 3 ? (this.history.get(s.id) ?? []) : [];
      hist.push(sighting);
      while (hist.length > 1 && (hist[1]?.tick ?? snap.tick) <= snap.tick - keep) hist.shift();
      this.history.set(s.id, hist);
      this.lastSawFree = snap.tick;
    }
    for (const [id, t] of this.tracks)
      if (!seenNow.has(id) && snap.tick - t.tick > 30) {
        this.tracks.delete(id);
        this.history.delete(id);
      }
    // 놓친 표적 (묶어 쫓던 것 중 아무도 안 보일 때): 알림이 기억나면 그 거점부터, 아니면 마지막 모습에서 조금 앞 → 도주 후보 (M4 · M7).
    // 같은 스냅샷에 누가 죽었거나 탈출했으면 쫓던 표적이 그렇게 사라진 것이다: 놓친 것이 아니므로 시체 자리 · 탈출구 앞을 수색하지 않고
    // (수색 뒤 포효도 없다) 다음 할 일로 — 기억하는 알림 · 거점 · 순찰은 roam이 고른다 (가둔 표적과 같다). 표적이 그대로 보이면 쫓기를 잇는다
    if (this.chase && ![...this.chaseIds].some((id) => seenNow.has(id))) {
      const c = this.chase;
      this.chase = null;
      this.chaseIds = new Set<string>();
      const alert = gone ? null : this.freshAlert(snap.world.points);
      if (alert) this.pointGoal(alert, me, b, true);
      else if (!gone) {
        let lx = c.vx * LOST_LEAD;
        let ly = c.vy * LOST_LEAD;
        const l = Math.hypot(lx, ly);
        if (l > LOST_LEAD_MAX) {
          lx = (lx / l) * LOST_LEAD_MAX;
          ly = (ly / l) * LOST_LEAD_MAX;
        }
        const ahead = { x: c.x + lx, y: c.y + ly };
        const spot = clearPath(c, ahead, 0.2) ? snapToFloor(ahead) : snapToFloor(c);
        this.setGoal('lost', spot, LOST_TIME, {
          aim: l > 0.1 ? Math.atan2(ly, lx) : null,
          look: LOST_LOOK,
          next: searchSpots(c, me),
        });
      }
    }
    // 거점 안 머문 시간 (규칙: 거점 반경 안 연속 시간)
    for (const id of POINT_IDS) {
      const inside = dist(me, CAPTURE_POINTS[id]) <= b.capturePoint.radius;
      this.pointTicks[id] = inside ? this.pointTicks[id] + elapsed : 0;
    }
    const inCamp = distToRect(me, PRISON_RECT) <= b.prison.campRadius;
    this.campTicks = snap.world.imprisoned > 0 && inCamp ? this.campTicks + elapsed : 0;
  }

  /**
   * 포효 핑: 감옥 안 바닥(수감자 자리)의 핑은 빼고, 가까운 것부터 차례로 들를 순서로 기억한다 (좌표 순으로 동점을 가른다 — 배열 순서와
   * 무관). 감옥 문 칸 · 문 앞은 자유 생존자만 설 수 있으니(구조하러 온 생존자) 따라간다. 감옥 안에 들어간 자유 생존자는 수감자와
   * 가를 수 없어 함께 빠진다
   */
  private takePings(pts: readonly Vec2[], me: Vec2): void {
    const left = pts.filter((p) => distToRect(p, PRISON_INNER) > 0).map((p) => snapToFloor(p));
    const order: Vec2[] = [];
    let from: Vec2 = me;
    while (left.length > 0) {
      let k = 0;
      for (let i = 1; i < left.length; i += 1) {
        const p = left[i];
        const q = left[k];
        if (p && q && closerThan(from, p, q)) k = i;
      }
      const [next] = left.splice(k, 1);
      if (!next) break;
      order.push(next);
      from = next;
    }
    this.pings = order;
    this.pingsAt = this.now;
    this.nextPing();
  }

  /**
   * 기억하는 다음 핑으로 (오래된 핑은 버린다). avoidCamp(타일)를 주면 감옥 철창에서 그 거리 안의 핑은 건너뛴다
   * (누가 갇혀 있을 때 다시 찾아가면 캠핑이 된다 — 받은 틱의 새 핑은 그대로 간다)
   */
  private nextPing(avoidCamp: number | null = null): boolean {
    if (this.now - this.pingsAt > this.sec(PING_MEMORY)) this.pings = [];
    if (avoidCamp !== null) this.pings = this.pings.filter((p) => distToRect(p, PRISON_RECT) > avoidCamp);
    const p = this.pings[0];
    if (!p) return false;
    this.setGoal('roar', p, PING_TIME, { look: PING_LOOK });
    return this.goal?.kind === 'roar';
  }

  /**
   * 새 알림 거점이 지금 가는 알림 거점보다 급한가: 진행이 ALERT_SWITCH_PROGRESS 넘게 많거나, 진행이 비슷하면 길이
   * ALERT_SWITCH_PATH(타일) 넘게 가까울 때만 바꾼다 (알림이 번갈아 와도 오가다 아무 데도 못 닿지 않게)
   */
  private moreUrgent(id: PointId, points: readonly PointView[], me: Vec2): boolean {
    const g = this.goal;
    if (!g || g.kind !== 'point' || !g.alerted || g.lookUntil !== null || !g.point || g.point === id)
      return true;
    const cur = points.find((p) => p.id === g.point);
    const nxt = points.find((p) => p.id === id);
    if (!cur || !nxt || !pointOpen(cur.state)) return true;
    if (nxt.progress > cur.progress + ALERT_SWITCH_PROGRESS) return true;
    if (nxt.progress < cur.progress - ALERT_SWITCH_PROGRESS) return false;
    const dNew = pathDist(fieldFrom(CAPTURE_POINTS[id]), me);
    const dCur = pathDist(fieldFrom(CAPTURE_POINTS[g.point]), me);
    return dNew < dCur - ALERT_SWITCH_PATH;
  }

  /** 기억하는 점령 알림 중 아직 갈 곳: 열린 거점, ALERT_MEMORY 안, 지금 목표가 아닌 곳. 진행 큰 쪽 → 최근 알림 → id 순 */
  private freshAlert(points: readonly PointView[]): PointId | null {
    let best: PointId | null = null;
    let bestProgress = -1;
    let bestAt = NEVER;
    for (const p of points) {
      if (!pointOpen(p.state)) continue;
      const at = this.alertAt[p.id];
      if (this.now - at > this.sec(ALERT_MEMORY)) continue;
      if (this.goal && this.goal.kind === 'point' && this.goal.point === p.id) continue;
      if (
        p.progress > bestProgress + TIE_EPS ||
        (Math.abs(p.progress - bestProgress) <= TIE_EPS && at > bestAt)
      ) {
        best = p.id;
        bestProgress = p.progress;
        bestAt = at;
      }
    }
    return best;
  }

  /** 거점 조사: 반경 바로 바깥, 내가 오는 쪽에 서서 거점을 바라본다 (짧게 훑은 뒤 둘레를 돈다) */
  private pointGoal(id: PointId, me: Vec2, b: Balance, alerted: boolean): void {
    const c = CAPTURE_POINTS[id];
    const u = unit(me.x - c.x, me.y - c.y);
    const dir = u.x === 0 && u.y === 0 ? { x: 1, y: 0 } : u;
    const r = b.capturePoint.radius + AMBUSH_OUT;
    const at = snapToFloor({ x: c.x + dir.x * r, y: c.y + dir.y * r });
    this.setGoal('point', at, GOAL_TIME, {
      focus: c,
      look: POINT_LOOK_MIN + this.tactics.next() * POINT_LOOK_SPAN,
      point: id,
      alerted,
    });
  }

  private setGoal(kind: GoalKind, at: Vec2, seconds: number, o: GoalOptions = {}): void {
    const cur = this.goal;
    if (cur && GOAL_PRIORITY[cur.kind] > GOAL_PRIORITY[kind] && cur.until > this.now) return;
    this.goal = {
      kind,
      x: at.x,
      y: at.y,
      until: this.now + this.sec(seconds),
      lookUntil: null,
      aim: o.aim ?? null,
      focus: o.focus ?? null,
      look: o.look ?? LOOK_TIME,
      rolled: o.rolled ?? false,
      point: o.point ?? null,
      alerted: o.alerted ?? false,
      center: o.center ?? false,
      next: o.next ?? [],
    };
    this.stuckFrom = null;
  }

  /**
   * 쫓을 생존자: 가까운 자유 생존자, 보호 중이면 뒤로. 같은 거리면 위치 → 속도 → 처음 본 틱 순으로 가르고, 그것까지 같은
   * 생존자들은 하나로 묶는다 (배열 순서 · 임시 ID 값에 기대지 않는다 — 같은 자리에 함께 풀려난 둘 등)
   */
  private pickTarget(snap: Snapshot): Sighting | null {
    const me = snap.you.move;
    const cands: { t: Sighting; score: number }[] = [];
    let min = Infinity;
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      let score = dist(me, s) + (s.protected ? PROTECTED_PENALTY : 0);
      if (this.chaseIds.has(s.id)) score -= KEEP_TARGET_BONUS;
      const t = this.tracks.get(s.id) ?? {
        id: s.id,
        x: s.x,
        y: s.y,
        vx: 0,
        vy: 0,
        tick: this.now,
        prot: s.protected,
        since: this.now,
      };
      cands.push({ t, score });
      if (score < min) min = score;
    }
    let best: Sighting | null = null;
    for (const c of cands) {
      if (c.score > min + TIE_EPS) continue;
      if (!best || compareSighting(c.t, best) < 0) best = c.t;
    }
    if (!best) return null;
    const pick = best;
    const ids = new Set(
      cands.filter((c) => c.score <= min + TIE_EPS && compareSighting(c.t, pick) === 0).map((c) => c.t.id),
    );
    if (![...ids].some((id) => this.chaseIds.has(id))) this.dashBlockedUntil = 0;
    this.chase = pick;
    this.chaseIds = ids;
    // 쫓는 동안 조사 목표는 잊는다 (감옥 감시는 남긴다. 놓치면 새로 정한다)
    if (this.goal && this.goal.kind !== 'watch') this.goal = null;
    return pick;
  }

  /** 추적: 쫓고 · 공격 · 돌진. 원하는 시야 모드를 돌려준다 */
  private chaseTarget(snap: Snapshot, b: Balance, t: Sighting, out: InputFrame): VisionModeId {
    const me = snap.you.move;
    const mon = snap.you.mon;
    const d = dist(me, t);
    // 시야 (M6): 가까우면 넓게, 넓히는 중에 탐색 시야 사거리 밖으로 멀어지면 되돌린다. 막 쫓기 시작했으면 지금 모드에서 시작한다
    if (!this.chasing && mon) this.chaseMode = mon.mode;
    const band = chaseVisionBand(b);
    if (d <= band.near) this.chaseMode = 'search';
    else if (d >= band.far) this.chaseMode = 'hunt';
    const mode = this.chaseMode;
    if (!mon) return mode;
    // 손 (조정 A): 겨누기 · 누르기 · 준비 중 따라가기는 알아채기 지연만큼 전에 본 모습으로 짐작한 자리로
    const seenAs = this.perceived(t);
    const follow = mon.windup > 0 ? seenAs : t;
    const lead = Math.min(CHASE_LEAD_MAX, dist(me, follow) / b.monster.moveSpeed);
    const predRaw = { x: follow.x + follow.vx * lead, y: follow.y + follow.vy * lead };
    const pred = walkableAt(predRaw) ? predRaw : { x: follow.x, y: follow.y };
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
    const strike = { x: seenAs.x + seenAs.vx * wind, y: seenAs.y + seenAs.vy * wind };
    // 손 (조정 A): 이번 공격의 조준 오차만큼 비껴 겨눈다 (누를지는 짐작한 표적 쪽과 견준다)
    out.aim = aimAt(me, strike) + this.aimErr;
    const canAct = me.stun <= 0 && me.dash <= 0 && mon.windup <= 0;
    if (!canAct || t.prot) return mode;
    const combo = this.now <= this.comboUntil;
    if (!combo && this.now - t.since < this.sec(REACT_TIME)) return mode;
    // 공격: 준비가 끝날 때 예상 거리 (표적이 멀어지는 속도만큼 덜 따라잡는다). 돌진 직후는 조금 느슨하게 (M1).
    // 거리 · 속도는 짐작한 모습으로, 이번 공격이 '이르게 누르기'면 닿는 거리를 길게 본다 (조정 A)
    const dSeen = dist(me, seenAs);
    const u = unit(seenAs.x - me.x, seenAs.y - me.y);
    const away = Math.max(-APPROACH_TRUST, seenAs.vx * u.x + seenAs.vy * u.y);
    const closing = b.monster.moveSpeed * b.monster.attack.windupMoveMultiplier - away;
    const contact = b.monster.radius + b.survivor.radius;
    const gap = Math.max(contact, dSeen - closing * wind);
    const reach =
      b.monster.attack.range + b.survivor.radius - (combo ? COMBO_MARGIN : ATTACK_MARGIN) + this.reachErr;
    const slack = combo ? COMBO_NOW_SLACK : ATTACK_NOW_SLACK;
    const facing = Math.abs(angleDiff(me.face, aimAt(me, strike)));
    if (
      mon.attackCd <= 0 &&
      gap <= reach &&
      dSeen <= reach + slack &&
      facing <= (combo ? COMBO_FACING : ATTACK_FACING)
    ) {
      out.pressed |= BTN.ATTACK;
      this.comboUntil = NEVER;
      this.rollHand();
      return mode;
    }
    // 돌진: 가까운 창은 끝나자마자 칠 수 있을 때(M1), 그 바깥은 멀어지는 표적에게 거리 좁히기(M2). 직선 · 조준이 맞을 때
    if (mon.dashCd > 0) return mode;
    const dur = b.monster.dash.duration;
    const close = d >= DASH_MIN && d <= DASH_MAX && mon.attackCd <= dur;
    const far = d > DASH_MAX && d <= DASH_FAR && away >= DASH_CLOSE_AWAY;
    if (!close && !far) return mode;
    const after = { x: t.x + t.vx * dur, y: t.y + t.vy * dur };
    const dashDir = aimAt(me, after);
    out.aim = dashDir;
    if (Math.abs(angleDiff(me.face, dashDir)) > DASH_FACING) return mode;
    const reachEnd = Math.min(b.monster.dash.distance, dist(me, after));
    const end = { x: me.x + Math.cos(dashDir) * reachEnd, y: me.y + Math.sin(dashDir) * reachEnd };
    if (!clearPath(me, end, b.monster.radius)) return mode;
    if (this.now < this.dashBlockedUntil) return mode;
    // 주사위: 가까운 창은 예전 흐름(this.rng), 새 거리 좁히기는 새 행동 흐름(tactics) — 예전 행동의 뽑기 순서를 덜 민다
    if ((close ? this.rng : this.tactics).next() < this.dashChance) {
      out.pressed |= BTN.DASH;
      this.comboUntil = this.now + this.sec(dur + COMBO_WINDOW);
      this.lastDashKind = close ? 'close' : 'far';
    } else this.dashBlockedUntil = this.now + this.sec(DASH_REROLL);
    return mode;
  }

  /**
   * 손 (조정 A): 알아채기 지연만큼 전에 본 표적 모습을 그때 속도로 지금까지 이어 짐작한 것. 기록이 그만큼 길지 않으면 가장 오래된
   * 모습에서. 이어 간 자리가 바닥이 아니면 본 자리 그대로. 묶어 쫓는 생존자가 여럿이면 각각 짐작해 위치 → 속도 순으로 앞인 것
   * (임시 ID 값 · 배열 순서와 무관)
   */
  private perceived(t: Sighting): Sighting {
    let best: Sighting | null = null;
    const ids = this.chaseIds.has(t.id) ? this.chaseIds : new Set([t.id]);
    for (const id of ids) {
      const hist = this.history.get(id);
      const cur = this.tracks.get(id) ?? t;
      let h = hist?.[0] ?? cur;
      const cut = this.now - this.handLag * this.hz;
      for (const e of hist ?? []) if (e.tick <= cut) h = e;
      const dt = (this.now - h.tick) / this.hz;
      const ahead = { x: h.x + h.vx * dt, y: h.y + h.vy * dt };
      const at = dt > 0 && walkableAt(ahead) && clearPath(h, ahead, 0.1) ? ahead : { x: h.x, y: h.y };
      const s: Sighting = { ...cur, x: at.x, y: at.y, vx: h.vx, vy: h.vy };
      if (!best || compareSighting(s, best) < 0) best = s;
    }
    return best ?? t;
  }

  /** 아무도 안 보일 때: 포효 → 캠핑 · 거점 유예 피하기 → 알림 · 핑 · 수색 → 감옥 감시 → 거점 둘레 · 순찰. 원하는 시야 모드를 돌려준다 */
  private roam(snap: Snapshot, b: Balance, out: InputFrame): VisionModeId {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (!mon) return 'search';
    const ready = me.stun <= 0 && me.dash <= 0 && mon.windup <= 0;
    // 서 있기 감시 (M5): 둘러보기는 짧게 끝내고, 못 움직이는 목표는 버린다
    const a = this.standAnchor;
    if (!a || me.stun > 0 || dist(a, me) > STAND_MOVE)
      this.standAnchor = { x: me.x, y: me.y, tick: this.now };
    else if (this.now - a.tick >= this.sec(STAND_LIMIT)) {
      this.unstick(snap, b);
      this.standAnchor = { x: me.x, y: me.y, tick: this.now };
    }
    // 포효: 놓친 곳 · 알림 거점을 둘러봐도 없을 때, 또는 한동안 아무도 못 봤을 때
    const want = this.now <= this.roarWantUntil;
    if (ready && mon.roarCd <= 0 && (want || this.now - this.lastSawFree >= this.sec(this.roarIdle))) {
      out.pressed |= BTN.ROAR;
      this.lastSawFree = this.now;
      this.roarIdle = ROAR_IDLE_MIN + this.rng.next() * ROAR_IDLE_SPAN;
      this.roarWantUntil = NEVER;
    } else if (mon.roarCd > 0) this.roarWantUntil = NEVER;
    // 감옥 캠핑: 경고 전에 감시 자리로 나간다 (감시 자리는 반경 밖). 나가는 동안은 알림 · 핑으로 다시 들어오지 않는다
    const leavingCamp =
      snap.world.imprisoned > 0 && (mon.camp >= 1 || this.campTicks >= this.sec(CAMP_LEAVE));
    if (leavingCamp && (!this.goal || this.goal.kind !== 'watch')) this.goal = this.watchGoal(me);
    // 거점 지키기 유예 (안 끝난 거점만 해당): 반경 밖으로 한 번 나갔다 온다
    if (!this.stepOut) {
      for (const id of POINT_IDS) {
        if (this.pointTicks[id] < this.sec(POINT_STAY_MAX)) continue;
        if (snap.world.points.some((p) => p.id === id && !pointOpen(p.state))) continue;
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
      this.act = 'stepout';
      return 'search';
    }
    // 둘 이상 갇혀 있으면 감시 간격마다 감시 자리 셋을 오간다 (한 명만 더 잡으면 이긴다 — 거점 둘레 돌기도 끊는다).
    // 간격 사이에는 감옥을 비운다 (할 일이 없을 때마다 되풀이하면 사람 괴물보다 빈틈이 없다). 알림 · 핑 · 수색은 그대로
    const guardPrison = snap.world.imprisoned >= 2;
    const g0 = this.goal;
    const idleGoal = !g0 || g0.kind === 'ring' || (g0.kind === 'point' && !g0.alerted);
    if (guardPrison && idleGoal && this.now >= this.nextWatchAt)
      this.goal = this.watchGoal(me, WATCH_STOPS_GUARD);
    // 새 정보가 먼저: 기억하는 점령 알림 → 점령 중 배지(진행 큰 쪽) → 포효 핑 (놓친 곳 수색 · 둘레 돌기 · 감시보다 앞)
    const curPrio = this.goal ? GOAL_PRIORITY[this.goal.kind] : -1;
    if (!leavingCamp && curPrio < GOAL_PRIORITY.point && !(guardPrison && this.goal?.kind === 'watch')) {
      const alert = this.freshAlert(snap.world.points);
      const badge = alert ?? this.capturingBadge(snap.world.points);
      if (badge) this.pointGoal(badge, me, b, true);
    }
    // 기억하는 핑으로 다시 (새 핑은 받은 틱에 놓친 곳 수색도 덮지만, 추적 뒤 남은 핑은 놓친 곳 수색 다음)
    if (!leavingCamp && (!this.goal || GOAL_PRIORITY[this.goal.kind] < GOAL_PRIORITY.lost))
      this.nextPing(snap.world.imprisoned > 0 ? b.prison.campRadius : null);
    // 감옥 감시: 갇힌 사람이 있고 할 일이 없으면 가끔
    if (!this.goal && snap.world.imprisoned > 0 && this.now >= this.nextWatchAt) {
      this.goal = this.watchGoal(me);
    }
    // 할 일이 없으면: 안 끝난 거점을 지키거나(둘레 돌기), 순찰을 몇 구간 돈다
    const exitsOn = snap.world.exits.some((e) => e.state !== 'inactive');
    if (!this.goal && this.patrolLegs <= 0 && !exitsOn) this.idleChoice(snap, b, me);
    if (this.goal) return this.followGoal(snap, b, this.goal, out, ready);
    this.act = 'patrol';
    return this.patrol(snap, out);
  }

  /** 점령 중 배지 (괴물 화면): 진행이 많은 거점 */
  private capturingBadge(points: readonly PointView[]): PointId | null {
    let best: PointId | null = null;
    let bestProgress = -1;
    for (const p of points) {
      if (p.state !== 'capturing' && p.state !== 'blocked') continue;
      // 지금 그 거점으로 가는 중이거나 그 둘레를 도는 중이면 (둘레에서 거점 쪽을 본다 — 새 알림은 따로 온다)
      if (this.goal && (this.goal.kind === 'point' || this.goal.kind === 'ring') && this.goal.point === p.id)
        continue;
      if (p.progress > bestProgress + TIE_EPS) {
        best = p.id;
        bestProgress = p.progress;
      }
    }
    return best;
  }

  /**
   * 할 일이 없을 때 (M5): 안 끝난 거점 하나를 골라 훑고 둘레를 돌거나, 순찰 몇 구간. 같은 거점을 연달아 고르지 않는다.
   * (열린 거점이 하나만 남는 때는 없다: 둘째 거점이 끝나는 틱에 셋째가 꺼지고 탈출구가 켜진다 — capture.ts, balance.ts 구조 검사
   * count 3 · required 2. 탈출구가 켜지면 이 함수를 부르지 않는다)
   */
  private idleChoice(snap: Snapshot, b: Balance, me: Vec2): void {
    const open = snap.world.points.filter((p) => pointOpen(p.state));
    if (open.length > 0 && this.rng.next() < POINT_PATROL_PROB) {
      const next = this.pickGuard(open);
      this.lastGuarded = next;
      this.pointGoal(next, me, b, false);
    } else {
      this.patrolLegs = PATROL_LEGS_MIN + this.rng.int(PATROL_LEGS_SPAN);
    }
  }

  /** 지킬 거점: 지난번 거점은 빼고(둘 이상일 때) 진행 큰 쪽 → 오래 안 들른 쪽 → id 순 */
  private pickGuard(open: readonly PointView[]): PointId {
    const cands = open.length > 1 ? open.filter((p) => p.id !== this.lastGuarded) : open;
    let best: PointView | null = null;
    for (const p of cands) {
      if (!best) best = p;
      else if (p.progress > best.progress + TIE_EPS) best = p;
      else if (
        Math.abs(p.progress - best.progress) <= TIE_EPS &&
        this.visitedAt[p.id] < this.visitedAt[best.id]
      )
        best = p;
    }
    return (
      best?.id ??
      nextGuarded(
        open.map((p) => p.id),
        this.lastGuarded,
      )
    );
  }

  /** 감옥 감시 (M5): 가까운 감시 자리에서 구조 지점을 잠깐 보고, 옆 감시 자리로 걸어가 또 본다 */
  private watchGoal(me: Vec2, stops = WATCH_STOPS): Goal {
    let best = WATCH_SPOTS[0] ?? RESCUE_POINT;
    let bestD = Infinity;
    for (const s of WATCH_SPOTS) {
      const d = pathDist(fieldFrom(s), me);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = s;
      }
    }
    // 감시 자리 순서: 가까운 곳부터 이웃으로 이어 가고, 끝에 닿으면 되돌아온다 (같은 자리를 연달아 들르지 않는다)
    const chain: Vec2[] = [best];
    while (chain.length < WATCH_SPOTS.length) {
      const rest = WATCH_SPOTS.filter((s) => !chain.includes(s));
      const last = chain[chain.length - 1] ?? best;
      if (rest.length === 0) break;
      chain.push(nearestOf(rest, last));
    }
    // 이미 그 감시 자리에 서 있으면(감시를 이어서 할 때) 다음 자리부터: 같은 자리에서 또 서지 않게
    let i = 0;
    let dir = 1;
    if (chain.length > 1 && dist(best, me) <= WATCH_HERE) {
      i = 1;
      const second = chain[1];
      if (second) best = second;
    }
    const next: Vec2[] = [];
    while (next.length < stops - 1 && chain.length > 1) {
      if (i + dir < 0 || i + dir >= chain.length) dir = -dir;
      i += dir;
      const s = chain[i];
      if (s) next.push(s);
    }
    this.nextWatchAt = this.now + this.sec(WATCH_GAP_MIN + this.rng.next() * WATCH_GAP_SPAN);
    return {
      kind: 'watch',
      x: best.x,
      y: best.y,
      until: this.now + this.sec(GOAL_TIME),
      lookUntil: null,
      aim: null,
      focus: RESCUE_POINT,
      look: WATCH_LOOK_MIN + this.tactics.next() * WATCH_LOOK_SPAN,
      rolled: true,
      point: null,
      alerted: false,
      center: false,
      next,
    };
  }

  /** 오래 서 있었다 (M5): 둘러보기 중이면 끝내고, 가는 중인데 못 움직이면 그 자리는 마친 셈으로 다음 할 일로 (순찰이면 다음 지점) */
  private unstick(snap: Snapshot, b: Balance): void {
    const g = this.goal;
    this.stuckFrom = null;
    if (g && g.lookUntil !== null) {
      g.lookUntil = this.now;
      return;
    }
    if (g) {
      this.finishGoal(snap, b, g, false);
      return;
    }
    this.detour = null;
    this.loopIdx += this.loopStep;
    this.patrolLegs = Math.max(this.patrolLegs, 1);
  }

  private followGoal(snap: Snapshot, b: Balance, g: Goal, out: InputFrame, ready: boolean): VisionModeId {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (g.lookUntil === null) {
      const tol = g.kind === 'watch' ? WATCH_TOLERANCE : g.kind === 'ring' ? RING_TOLERANCE : 0.6;
      const w = this.walker.toward(snap, g, tol);
      out.mx = w.mx;
      out.my = w.my;
      const moving = w.mx !== 0 || w.my !== 0;
      out.aim = moving ? Math.atan2(w.my, w.mx) + Math.sin(this.sweep) * SWEEP_AMP_PATROL : me.face;
      this.act = `go:${g.kind}`;
      const stuck = !w.arrived && this.stuck(me, moving);
      if (w.arrived || stuck) {
        // 막혀서 닿은 셈이면 둘러보지 않고 바로 다음 할 일로 (막힌 시간 + 둘러보기로 오래 서지 않게)
        g.lookUntil = this.now + (stuck ? 0 : this.sec(g.look));
        if (g.aim === null) g.aim = g.focus ? aimAt(me, g.focus) : me.face;
        if (g.point && (g.kind === 'point' || g.kind === 'ring')) {
          this.visitedAt[g.point] = this.now;
          if (g.kind === 'point') this.alertAt[g.point] = NEVER;
        }
        if ((g.kind === 'exit' || g.kind === 'rescue') && !g.rolled) {
          g.rolled = true;
          if (ready && mon && mon.roarCd <= 0 && this.rng.next() < ROAR_AT_LOOK_PROB) {
            out.pressed |= BTN.ROAR;
            this.lastSawFree = this.now;
          }
        }
      } else if (this.now >= g.until) {
        this.finishGoal(snap, b, g, false);
      }
      return dist(me, g) > GOAL_HUNT_DIST || g.kind === 'lost' || g.kind === 'search' ? 'hunt' : 'search';
    }
    // 둘러보기
    const base = g.aim ?? me.face;
    const edge = g.kind === 'point' && !g.center;
    if (g.kind === 'watch') out.aim = base + Math.sin(this.sweep) * SWEEP_AMP_WATCH;
    else if (edge) out.aim = base + Math.sin(this.sweep) * SWEEP_AMP_POINT;
    else if (g.kind === 'ring') out.aim = base + Math.sin(this.sweep) * SWEEP_AMP_RING;
    else out.aim = base + Math.sin(this.sweep * 1.4) * SWEEP_AMP_LOOK;
    // 거점 가장자리 · 둘레에서는 얼어붙지 않고 거점을 보며 옆으로 천천히 걷는다 (M5)
    if ((edge || g.kind === 'ring') && g.focus) this.strafe(me, g.focus, b, out);
    this.act = `look:${g.kind}`;
    if (this.now >= g.lookUntil) this.finishGoal(snap, b, g, true);
    return g.kind === 'watch' || edge ? 'hunt' : 'search';
  }

  /** 둘러보는 동안 focus를 둘레로 옆걸음 (STRAFE_SPEED). 앞이 막혔으면 그대로 선다 */
  private strafe(me: Vec2, focus: Vec2, b: Balance, out: InputFrame): void {
    const u = unit(me.x - focus.x, me.y - focus.y);
    if (u.x === 0 && u.y === 0) return;
    const side = Math.sin(this.sweep * STRAFE_FLIP) >= 0 ? 1 : -1;
    const tx = -u.y * side;
    const ty = u.x * side;
    const ahead = { x: me.x + tx * STRAFE_LOOKAHEAD, y: me.y + ty * STRAFE_LOOKAHEAD };
    if (!walkableAt(ahead) || !clearPath(me, ahead, b.monster.radius)) return;
    out.mx = tx * STRAFE_SPEED;
    out.my = ty * STRAFE_SPEED;
  }

  /** 목표를 마쳤다 (looked: 닿아서 둘러봤다, 아니면 시간 한도): 같은 종류의 다음 자리, 거점이면 둘레 돌기, 수색이 끝나면 포효 */
  private finishGoal(snap: Snapshot, b: Balance, g: Goal, looked: boolean): void {
    if (this.goal === g) this.goal = null;
    const me = snap.you.move;
    switch (g.kind) {
      case 'roar':
        this.pings.shift();
        this.nextPing();
        return;
      case 'point': {
        const p = g.point;
        if (!p) return;
        const view = snap.world.points.find((v) => v.id === p);
        if (!view || !pointOpen(view.state)) return;
        // 배지는 점령 중인데 둘레에서 아무도 안 보였다: 가운데로 들어가 본다 (괴물이 들어서면 점령이 멈춘다)
        if (looked && !g.center && (view.state === 'capturing' || view.state === 'blocked')) {
          this.setGoal('point', CAPTURE_POINTS[p], GOAL_TIME, {
            look: CENTER_LOOK,
            point: p,
            alerted: g.alerted,
            center: true,
          });
          return;
        }
        if (looked && g.alerted) this.roarWantUntil = this.now + this.sec(ROAR_WANT_TIME);
        const tour = this.ringTour(p, me, b);
        const first = tour.shift();
        if (first)
          this.setGoal('ring', first, GOAL_TIME, {
            focus: CAPTURE_POINTS[p],
            look: RING_LOOK_MIN + this.tactics.next() * RING_LOOK_SPAN,
            point: p,
            next: tour,
          });
        return;
      }
      case 'ring':
      case 'watch':
      case 'search':
      case 'lost': {
        const [next, ...rest] = g.next;
        if (next) {
          const kind: GoalKind = g.kind === 'lost' ? 'search' : g.kind;
          const look =
            kind === 'ring'
              ? RING_LOOK_MIN + this.tactics.next() * RING_LOOK_SPAN
              : kind === 'watch'
                ? WATCH_LOOK_MIN + this.tactics.next() * WATCH_LOOK_SPAN
                : SEARCH_LOOK;
          this.setGoal(kind, next, kind === 'search' ? SEARCH_TIME : GOAL_TIME, {
            focus: g.focus,
            look,
            point: g.point,
            next: rest,
            rolled: true,
          });
        } else if (g.kind === 'lost' || g.kind === 'search') {
          // 놓친 곳 · 도주 후보를 다 봐도 없다: 포효로 찾는다 (M3 · M7)
          this.roarWantUntil = this.now + this.sec(ROAR_WANT_TIME);
        }
        return;
      }
      default:
        return;
    }
  }

  /** 거점 둘레 돌기 자리: 지금 자리에서 가까운 방향부터 한쪽으로 RING_STOPS곳 (도는 방향은 시드 난수) */
  private ringTour(id: PointId, me: Vec2, b: Balance): Vec2[] {
    const ring = ringSpots(id, b);
    const n = ring.length;
    if (n === 0) return [];
    const c = CAPTURE_POINTS[id];
    const myAngle = Math.atan2(me.y - c.y, me.x - c.x);
    let start = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < n; i += 1) {
      const s = ring[i];
      if (!s || dist(s, me) <= RING_FIRST_GAP) continue;
      const diff = Math.abs(angleDiff(Math.atan2(s.y - c.y, s.x - c.x), myAngle));
      if (diff < bestDiff - 1e-9) {
        bestDiff = diff;
        start = i;
      }
    }
    const step = this.tactics.next() < 0.5 ? 1 : -1;
    const out: Vec2[] = [];
    for (let k = 0; k < Math.min(RING_STOPS, n); k += 1) {
      const s = ring[(((start + k * step) % n) + n) % n];
      if (s && (out.length > 0 || dist(s, me) > RING_FIRST_GAP)) out.push(s);
    }
    return out;
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

/** 표적 동점 가르기: 위치 → 속도 → 처음 본 틱 (작은 쪽이 먼저). 0이면 구분할 수 없다 */
function compareSighting(a: Sighting, b: Sighting): number {
  const keys: ReadonlyArray<readonly [number, number]> = [
    [a.x, b.x],
    [a.y, b.y],
    [a.vx, b.vx],
    [a.vy, b.vy],
    [a.since, b.since],
  ];
  for (const [p, q] of keys) {
    if (p < q - TIE_EPS) return -1;
    if (p > q + TIE_EPS) return 1;
  }
  return 0;
}

/** from에서 p가 q보다 가까운가 (같은 거리면 좌표 순) */
function closerThan(from: Vec2, p: Vec2, q: Vec2): boolean {
  const dp = dist(from, p);
  const dq = dist(from, q);
  if (dp < dq - TIE_EPS) return true;
  if (dp > dq + TIE_EPS) return false;
  return p.x < q.x || (p.x === q.x && p.y < q.y);
}

function nearestOf(spots: readonly Vec2[], to: Vec2): Vec2 {
  let best: Vec2 = spots[0] ?? to;
  for (const s of spots) if (closerThan(to, s, best)) best = s;
  return best;
}

/**
 * 추적 중 시야 문턱 (M6, 타일): near 안이면 탐색 시야(넓게), far 밖이면 추적 시야. far는 탐색 시야 사거리(balance) 그대로(여유 0)다.
 * 탐색 시야는 사거리 밖을 하드 컷으로 못 보므로 far 갈래는 넓히는 동안(추적 → 탐색 0.4초, 사거리가 아직 탐색 시야보다 길다)에만 닿는다:
 * 넓히는 중에 표적이 탐색 시야 사거리 밖이면 넓히기를 되돌리고, 탐색 시야로 다 바뀐 뒤에는 놓칠 때까지 유지한다.
 * 사거리 안쪽(예: 사거리 − 0.6 = 4.4)에서 좁히면 놓침은 줄지 않고 좁혔다 다시 넓히기를 1초 안에 오가며 누르는 일이 열 배 가까이 늘며
 * (생존자 화면에도 괴물 부채꼴이 떨린다) 봇끼리 판 괴물 승률이 약 4점 내려가 쓰지 않는다
 */
export function chaseVisionBand(b: Balance): { near: number; far: number } {
  return { near: WIDE_NEAR, far: b.monster.visionModes.search.range };
}

/**
 * 놓친 뒤 수색할 도주 후보 (M7): 마지막 위치에서 길 거리 SEARCH_PATH_MIN~MAX인 도주 후보 중 지금 괴물 자리에서 안 보이고
 * 달아나던 쪽(멈춰 있었으면 괴물 반대쪽)에 있는 곳. 그쪽으로 곧은 순서로 SEARCH_SPOTS곳 (서로 SEARCH_SPREAD 넘게 떨어진).
 * c는 마지막으로 본 자리 · 속도(타일/초), me는 놓친 때 괴물 자리. 시험이 직접 부른다
 */
export function searchSpots(c: Vec2 & { vx: number; vy: number }, me: Vec2): Vec2[] {
  const speed = Math.hypot(c.vx, c.vy);
  const dir = speed > 0.5 ? unit(c.vx, c.vy) : unit(c.x - me.x, c.y - me.y);
  const cands: { p: Vec2; score: number }[] = [];
  for (const p of FLEE_SPOTS) {
    const pd = pathDist(fieldFrom(p), c);
    if (pd < SEARCH_PATH_MIN || pd > SEARCH_PATH_MAX) continue;
    const u = unit(p.x - c.x, p.y - c.y);
    const score = u.x * dir.x + u.y * dir.y;
    if (score <= 0) continue;
    if (lineOfSight(me, p)) continue;
    cands.push({ p, score });
  }
  cands.sort((a, b) => b.score - a.score || a.p.x - b.p.x || a.p.y - b.p.y);
  const out: Vec2[] = [];
  for (const { p } of cands) {
    if (out.length >= SEARCH_SPOTS) break;
    if (out.every((q) => dist(q, p) > SEARCH_SPREAD)) out.push(p);
  }
  return out;
}

/** 거점 둘레 자리 (M5): 거점에서 RING_DIRS 방향으로 바닥을 찾아 길 거리가 범위 안 · 감옥 캠핑 반경 밖 · 거점이 보이는 곳 (방향 순) */
const RING_CACHE = new Map<string, readonly Vec2[]>();

export function ringSpots(id: PointId, b: Balance): readonly Vec2[] {
  const key = `${id}:${b.capturePoint.radius}:${b.prison.campRadius}`;
  const cached = RING_CACHE.get(key);
  if (cached) return cached;
  const c = CAPTURE_POINTS[id];
  const f = fieldFrom(c);
  const out: Vec2[] = [];
  for (let k = 0; k < RING_DIRS; k += 1) {
    const ang = (k * 2 * Math.PI) / RING_DIRS;
    for (const r of RING_RADII) {
      const p = snapToFloor({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
      if (!walkableAt(p)) continue;
      const pd = pathDist(f, p);
      if (pd < RING_PATH_MIN || pd > RING_PATH_MAX) continue;
      if (dist(p, c) <= b.capturePoint.radius + AMBUSH_OUT) continue;
      if (distToRect(p, PRISON_RECT) <= b.prison.campRadius + 0.5) continue;
      if (!lineOfSight(p, c)) continue;
      if (out.some((q) => dist(q, p) < RING_SPREAD)) continue;
      out.push(p);
      break;
    }
  }
  RING_CACHE.set(key, out);
  return out;
}

/** 괴물이 할 일 없을 때 번갈아 지킬 다음 거점: 지난번 거점 다음 id (A → B → C → A 순환, 열린 곳만) */
export function nextGuarded(open: readonly PointId[], last: PointId | null): PointId {
  const first = open[0] ?? 'A';
  if (last === null) return first;
  const at = POINT_IDS.indexOf(last);
  for (let k = 1; k <= POINT_IDS.length; k += 1) {
    const id = POINT_IDS[(at + k) % POINT_IDS.length] as PointId;
    if (open.includes(id)) return id;
  }
  return first;
}
