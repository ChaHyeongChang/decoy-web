// 엔티티 · 메시지 타입. 서버와 클라이언트가 주고받는 모든 메시지는 여기서만 정의한다.
import type { Balance, RoleId, VisionModeId } from './balance';
import type { ExitId, PointId } from './map';
import type { MoveState } from './movement';

export type Role = 'monster' | RoleId;
export type Team = 'survivor' | 'monster';
export type SurvivorStatus = 'free' | 'imprisoned' | 'dead' | 'escaped';
export type RoomPhase = 'lobby' | 'playing' | 'result';

export function teamOf(role: Role): Team {
  return role === 'monster' ? 'monster' : 'survivor';
}

/** 방 코드 길이와 글자 (헷갈리는 I, O 제외) */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_NAME_LENGTH = 12;

/** 버튼 비트 */
export const BTN = {
  ATTACK: 1,
  MODE: 2,
  RESCUE: 4,
  ABILITY: 8,
  DASH: 16,
  ROAR: 32,
} as const;

/**
 * 1/serverTickHz 간격으로 샘플링한 입력 한 개.
 * held = 누르고 있는 버튼, pressed = 직전 입력 이후 새로 눌린 버튼 (짧은 클릭도 놓치지 않게)
 */
export interface InputFrame {
  seq: number;
  mx: number;
  my: number;
  /** 괴물 목표 조준 각도 (라디안). 생존자는 0 */
  aim: number;
  held: number;
  pressed: number;
}

export function emptyInput(seq: number): InputFrame {
  return { seq, mx: 0, my: 0, aim: Number.NaN, held: 0, pressed: 0 };
}

// ───────────────────────── 로비 ─────────────────────────

export interface LobbyPlayer {
  id: string;
  name: string;
  role: Role | null;
  ready: boolean;
  connected: boolean;
  host: boolean;
  bot: boolean;
}

/**
 * 방 종류 (M13b): code = 방 코드 · 링크로 모이는 친구 방, quick = 빠른 매칭(M13c, 자동 시작 · 판 뒤 해산),
 * practice = 기기 안 봇과 연습(서버에 가지 않는다, 방 코드 `P-` 접두)
 */
export type RoomKind = 'code' | 'quick' | 'practice';

/** 기기 안 연습 방 코드의 접두. 서버 방 코드(4글자, ROOM_CODE_ALPHABET)와 겹치지 않는다 */
export const PRACTICE_ROOM_PREFIX = 'P-';

export interface LobbyState {
  room: string;
  /** 방 종류 (M13b) */
  kind: RoomKind;
  phase: RoomPhase;
  players: LobbyPlayer[];
  /** 빈자리를 봇으로 채울 수 있는 방 (?bots=1) */
  bots: boolean;
  /** 방장이 지금 시작할 수 있는가 */
  canStart: boolean;
  /** 시작할 수 없는 이유 (화면 안내용) */
  waitingFor: string | null;
  /** 빠른 매칭 자동 시작 서버 시각 (ms, 서버 시계 — pong · 스냅샷과 같은 시계). 없으면 null (M13c) */
  autoStartAt: number | null;
}

// ───────────────────────── 판 진행 상태 ─────────────────────────

export interface SurvivorSelf {
  status: SurvivorStatus;
  hp: number;
  imprisonCount: number;
  /** 보호 남은 시간 */
  protectLeft: number;
  /** 고유 능력 쿨타임 남은 시간 */
  abilityCd: number;
  /** 능력 효과 남은 시간 (질주 · 탐지) */
  abilityActive: number;
  /** 구조 진행 0~1 */
  rescue: number;
  /** 지금 괴물에게 보이는 중 (발각) */
  spotted: boolean;
}

export interface MonsterSelf {
  attackCd: number;
  /** 공격 준비 남은 시간 (0이면 준비 중 아님) */
  windup: number;
  dashCd: number;
  roarCd: number;
  mode: VisionModeId;
  /** 추적 모드 쪽으로 섞인 정도 0(탐색)~1(추적) */
  blend: number;
  /** 감옥 캠핑 경고 단계: 0 없음, 1 경고, 2 감속 */
  camp: 0 | 1 | 2;
  /** 거점 지키기 경고 중인 거점 */
  blockWarn: PointId | null;
}

export interface SelfView {
  id: string;
  role: Role;
  move: MoveState;
  surv: SurvivorSelf | null;
  mon: MonsterSelf | null;
}

/** 다른 생존자 (생존자에게는 팀원 전원, 괴물에게는 시야 안 생존자만 · 임시 ID) */
export interface SurvivorView {
  id: string;
  x: number;
  y: number;
  face: number;
  /** 생존자 화면: 항상. 괴물 화면: 능력 사용 직후 노출 창에만 */
  role: RoleId | null;
  status: SurvivorStatus;
  protected: boolean;
  /** 아래는 생존자 팀에게만 */
  hp: number | null;
  imprisonCount: number | null;
  abilityCd: number | null;
  rescue: number | null;
  spotted: boolean | null;
  connected: boolean | null;
}

/** 괴물 (생존자에게는 시야 합집합 안일 때만) */
export interface MonsterView {
  x: number;
  y: number;
  aim: number;
  mode: VisionModeId;
  blend: number;
  /** 공격 준비 남은 시간 (0 = 아님)과 고정된 방향 */
  windup: number;
  stunned: boolean;
  dashing: boolean;
  /** 생존자 누군가가 괴물에게 보이는 중 (부채꼴 빨강) */
  seesSomeone: boolean;
}

export type MarkKind = 'track' | 'roarPing' | 'roarSelf';

/** 안개 위 마커 (스카우트 탐지, 포효) */
export interface Mark {
  kind: MarkKind;
  x: number;
  y: number;
}

export type PointState = 'idle' | 'capturing' | 'blocked' | 'done';

export interface PointView {
  id: PointId;
  progress: number;
  state: PointState;
}

export type ExitState = 'inactive' | 'active' | 'open';

export interface ExitView {
  id: ExitId;
  state: ExitState;
  /** 2인 개방 진행 0~1 (생존자에게만) */
  progress: number | null;
}

/** 괴물에게 보이는 익명 생존자 상태 (정렬된 목록, 이름 · 역할 · ID 없음) */
export interface AnonStatus {
  state: 'normal' | 'injured' | 'imprisoned' | 'dead' | 'escaped';
  imprisonCount: number;
}

export interface WorldView {
  /** 남은 시간 (초) */
  timeLeft: number;
  /** 최후의 30초 남은 시간 (없으면 null) */
  grace: number | null;
  /** 괴물 시작 대기 남은 시간 */
  monsterWait: number;
  /** 괴물 재접속 대기 남은 시간 (일시정지 중이면) */
  paused: number | null;
  points: PointView[];
  exits: ExitView[];
  /** 수감 중인 인원 */
  imprisoned: number;
  /** 괴물에게만: 익명 상태 목록 */
  statusList: AnonStatus[] | null;
}

/** 텍스트 ID (client/src/data/storyText.ts) */
export type TextId =
  | 'INTRO_WALL'
  | 'INTRO_MONSTER'
  | 'NOTE_FIRST'
  | 'NOTE_SECOND'
  | 'ALERT_CAPTURE_START'
  | 'ALERT_CAPTURE_DONE'
  | 'ALERT_EXITS_ON'
  | 'ALERT_EXIT_OPEN'
  | 'ALERT_RESCUED'
  | 'ALERT_ROAR'
  | 'ALERT_LAST_30'
  | 'END_ALL'
  | 'END_TWO'
  | 'END_MONSTER'
  | 'END_TIMEOUT'
  | 'END_VOID';

/** 한 번만 일어나는 일. 받는 사람에게 보여도 되는 것만 담는다 */
export type GameEvent =
  | { k: 'text'; id: TextId; point?: PointId; exit?: ExitId; code?: string }
  | { k: 'attackStart'; x: number; y: number; dir: number }
  | { k: 'attackHit'; x: number; y: number; dir: number; hits: number }
  | { k: 'hit'; you: boolean; x: number; y: number }
  | { k: 'imprisoned'; you: boolean }
  | { k: 'died'; you: boolean }
  | { k: 'rescued'; you: boolean }
  | { k: 'escaped'; you: boolean }
  | { k: 'ability'; role: RoleId; you: boolean; x: number | null; y: number | null }
  | { k: 'shoveMiss' }
  | { k: 'stunned' }
  | { k: 'dash'; x: number; y: number; dir: number }
  | { k: 'roar'; x: number; y: number }
  | { k: 'roarPings'; pts: { x: number; y: number }[] }
  | { k: 'modeSwitch'; mode: VisionModeId };

export interface Snapshot {
  tick: number;
  /** 서버 시각 (ms, 서버 시계) */
  st: number;
  /** 받는 사람의 마지막으로 처리한 입력 seq */
  ack: number;
  you: SelfView;
  survivors: SurvivorView[];
  monster: MonsterView | null;
  marks: Mark[];
  world: WorldView;
  events: GameEvent[];
}

export interface RosterEntry {
  id: string;
  name: string;
  role: Role;
  bot: boolean;
  /**
   * 그 자리의 의상 (메타 c, 그 역할 팀 의상 · 기본이면 없다). 생존자 명단에만 생존자 의상이 들어가고, 괴물 명단은 자기
   * 하나뿐이라 괴물은 생존자 의상을 받지 않는다 (GAME_DESIGN 12.5, 정보 숨김)
   */
  costume?: SurvivorCostumeId | MonsterCostumeId;
}

export interface MatchInfo {
  you: string;
  role: Role;
  /** 생존자에게는 전원(ID · 이름 · 역할). 괴물에게는 자기 자신만 */
  roster: RosterEntry[];
  tickHz: number;
  /** 첫 판인가 (조작 안내 오버레이) */
  firstMatch: boolean;
}

export type ResultGrade = 'full' | 'success' | 'fail';

export interface PlayerRecord {
  id: string;
  name: string;
  role: Role;
  hitsTaken: number;
  hitsLanded: number;
  rescues: number;
  /** 점령 기여 (거점 안에서 게이지를 올린 초) */
  captureSeconds: number;
  status: SurvivorStatus | null;
  /** 봇 자리 (M13c: 빠른 매칭은 봇 표시를 결과 화면에서만 한다). 방이 보낼 때 채운다 */
  bot?: boolean;
}

export interface MatchResult {
  winner: 'survivors' | 'monster' | 'void';
  grade: ResultGrade | null;
  ending: TextId;
  escaped: number;
  durationSec: number;
  players: PlayerRecord[];
}

// ───────────────────────── 판 평가 (판 밖 메타, GAME_DESIGN 12장) ─────────────────────────

/**
 * 판 평가 항목. 생존자: 점령 · 구조 · 생존 · 회피 / 괴물: 사냥 · 저지 · 추적 · 문지기.
 * 이름 · 가중치 · 등급 기준은 config/progression.json (규칙 · 판정과 무관한 판 밖 수치)
 */
export type EmblemId = 'capture' | 'rescue' | 'survive' | 'evade' | 'hunt' | 'deny' | 'track' | 'gate';
export const SURVIVOR_EMBLEMS: readonly EmblemId[] = ['capture', 'rescue', 'survive', 'evade'];
export const MONSTER_EMBLEMS: readonly EmblemId[] = ['hunt', 'deny', 'track', 'gate'];

/** 평가 등급: 0 없음 · 1 동 · 2 은 · 3 금 · 4 빛 */
export type EmblemTier = 0 | 1 | 2 | 3 | 4;

/**
 * 판 기록의 내 수치 (평가 · 도전 진행에 쓴다). 서버가 판정 상태를 지켜보며 센다(shared/src/sim/record.ts) —
 * 판정에 끼어들지 않는다.
 *  생존자: captureSec 거점 점령 기여(초) · exitSec 탈출구 열기 기여(초) · rescues 구조 · freed 풀어 준 동료 수 ·
 *          rescueSec 구조 버틴 초 · escaped 탈출(0/1) · surviveRatio 버틴 비율(탈출 뒤는 버틴 것으로) · cleanEscape 한 번도
 *          갇히지 않고 탈출(0/1) · imprisons 갇힌 횟수 · died 사망(0/1) · hitsTaken 맞은 수 · chaseSec 발각된 채 버틴 초 ·
 *          evades 따돌린 추격 · abilityUses 능력 사용 · abilityGood 쓸모 있게 쓴 능력
 *  괴물:   hits 타격 · jails 수감시킨 수 · kills 사망시킨 수 · seeSec 생존자를 시야에 둔 초 · finds 새로 찾은 수 ·
 *          roarFinds 포효로 찾은 수 · blockSec 거점 진행을 멈춘 초 · pointStops 괴물이 가까이 와
 *          끊긴 점령 · pointsLeft 끝까지 남은 거점 · zoneHits 거점 · 탈출구
 *          안 타격 · kept 탈출 못 한 생존자 · exitStops 끊은 탈출구 열기 · exitHoldSec 탈출구가 켜진 뒤 첫 탈출까지 버틴 초
 */
export type RatingStatId =
  | 'captureSec'
  | 'exitSec'
  | 'rescues'
  | 'freed'
  | 'rescueSec'
  | 'escaped'
  | 'surviveRatio'
  | 'cleanEscape'
  | 'imprisons'
  | 'died'
  | 'hitsTaken'
  | 'chaseSec'
  | 'evades'
  | 'abilityUses'
  | 'abilityGood'
  | 'hits'
  | 'jails'
  | 'kills'
  | 'seeSec'
  | 'finds'
  | 'roarFinds'
  | 'blockSec'
  | 'pointStops'
  | 'pointsLeft'
  | 'zoneHits'
  | 'kept'
  | 'exitStops'
  | 'exitHoldSec';

export type RatingStats = Partial<Record<RatingStatId, number>>;

export interface EmblemResult {
  id: EmblemId;
  tier: EmblemTier;
  /** 가중합 점수 (소수 첫째 자리) */
  score: number;
}

/**
 * 판 평가 (판이 끝날 때 서버가 받는 사람 자기 것만 보낸다 — 판 중에는 누구에게도 보내지 않는다).
 * 보상(경험치 등)은 이것으로 공용 코드(shared/src/meta)가 계산한다
 */
export interface MatchRating {
  /** 판마다 다른 값: 같은 판 결과를 다시 받아도(재접속) 보상은 한 번 */
  matchId: string;
  role: Role;
  outcome: 'win' | 'lose' | 'void';
  durationSec: number;
  /** 역할 팀의 평가 넷 (순서 고정: SURVIVOR_EMBLEMS · MONSTER_EMBLEMS) */
  emblems: EmblemResult[];
  stats: RatingStats;
}

// ───────────────────────── 의상 (판 밖 메타 c, GAME_DESIGN 12장) ─────────────────────────

/**
 * 의상: 새 캐릭터 그림에만 얹는 모양 장식. 판정 원 · 크기 · 속도 · 소리와 무관하다. basic = 기본(늘 가짐).
 * 생존자 의상은 세 역할(러너 · 가드 · 스카우트) 모두에 같이 맞는다. 괴물 화면의 생존자(흰색 위장)는 의상을 그리지 않는다
 */
export const SURVIVOR_COSTUMES = ['basic', 'scarf', 'pack', 'cape'] as const;
export const MONSTER_COSTUMES = ['basic', 'hood', 'feathers', 'chains'] as const;
export type SurvivorCostumeId = (typeof SURVIVOR_COSTUMES)[number];
export type MonsterCostumeId = (typeof MONSTER_COSTUMES)[number];

/** 한 사람이 고른 의상 (생존자 역할일 때 · 괴물 역할일 때) */
export interface CostumeChoice {
  survivor: SurvivorCostumeId;
  monster: MonsterCostumeId;
}

// ───────────────────────── 메시지 ─────────────────────────

export type TestCommand =
  | { kind: 'teleport'; target: string; x: number; y: number; face?: number }
  | { kind: 'setSurvivor'; target: string; hp?: number; status?: SurvivorStatus; imprisonCount?: number }
  | { kind: 'setPoint'; point: PointId; progress: number }
  /** elapsed: 흐른 판 시간(초)도 바꾼다 — 결과의 판 길이 (M15 스토어 촬영). 시험 전용 */
  | { kind: 'setTime'; timeLeft: number; elapsed?: number }
  | { kind: 'freeze'; target: string; frozen: boolean };

export type ClientMessage =
  | {
      t: 'join';
      room: string | null;
      create: boolean;
      name: string;
      token: string | null;
      altTokens: string[];
      bots: boolean;
      /** 고른 의상 (메타 c). 서버는 id만 거르고(모르는 값 = 기본) 판 시작 명단에만 싣는다 — 로비 · 결과에는 싣지 않는다 */
      costume?: CostumeChoice;
    }
  | { t: 'role'; role: Role | null }
  | { t: 'ready'; ready: boolean }
  | { t: 'name'; name: string }
  | { t: 'start' }
  | { t: 'input'; frames: InputFrame[] }
  | { t: 'ping'; c: number }
  | { t: 'rematch' }
  /** 판 밖(로비 · 대기 · 결과)에서 옷장으로 바꾼 의상 (메타 c). 판 중에는 무시 — 판 시작 명단과 구운 그림이 판 끝까지 같게 */
  | { t: 'costume'; costume: CostumeChoice }
  /** 빠른 매칭 대기열에 들어간다 (M13c). 대기 중이거나 판이 없는 빠른 매칭 방에 넣거나 새로 만든다 */
  | { t: 'quick'; name: string; costume?: CostumeChoice }
  /**
   * 방에서 나간다 (M13b): 결과 화면 "홈으로" · 대기 취소. 로비 · 결과 단계에서는 자리를 지우고, 판 중에는 끊김과 같다
   * (M13c에서 판 중 나가기는 유예 없이 바로 판정). 연결은 방에서 풀려 다른 방에 들어갈 수 있다
   */
  | { t: 'leave' }
  | { t: 'test'; cmd: TestCommand };

export type ErrorCode =
  | 'room-not-found'
  | 'room-full'
  | 'in-progress'
  | 'bad-request'
  | 'not-allowed'
  | 'replaced'
  /** 빠른 매칭 대기열에서 빠졌다 (자동 시작 순간 3초 넘게 소식이 없던 자리, M13c) */
  | 'queue-dropped';

export type ServerMessage =
  | {
      t: 'welcome';
      you: string;
      token: string;
      room: string;
      balance: Balance;
      balanceHash: string;
      /** 서버 빌드 ID (M13d, client/dist/build-id.json). 화면 빌드와 다르면 "새 버전이 있어요". 없으면 비교 안 함 */
      build?: string | null;
    }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'match'; info: MatchInfo }
  | { t: 'snap'; s: Snapshot }
  /** build: 서버 빌드 ID (M13d, join 전에도 비교) */
  | { t: 'pong'; c: number; s: number; build?: string | null }
  /** rating: 받는 사람 자기 판 평가 (봇 자리 · 평가할 수 없는 판이면 없음, GAME_DESIGN 12장) */
  | { t: 'result'; result: MatchResult; rating?: MatchRating | null }
  | { t: 'error'; code: ErrorCode; message: string };
