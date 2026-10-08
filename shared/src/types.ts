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

export interface LobbyState {
  room: string;
  phase: RoomPhase;
  players: LobbyPlayer[];
  /** 빈자리를 봇으로 채울 수 있는 방 (?bots=1) */
  bots: boolean;
  /** 방장이 지금 시작할 수 있는가 */
  canStart: boolean;
  /** 시작할 수 없는 이유 (화면 안내용) */
  waitingFor: string | null;
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
}

export interface MatchResult {
  winner: 'survivors' | 'monster' | 'void';
  grade: ResultGrade | null;
  ending: TextId;
  escaped: number;
  durationSec: number;
  players: PlayerRecord[];
}

// ───────────────────────── 메시지 ─────────────────────────

export type TestCommand =
  | { kind: 'teleport'; target: string; x: number; y: number; face?: number }
  | { kind: 'setSurvivor'; target: string; hp?: number; status?: SurvivorStatus; imprisonCount?: number }
  | { kind: 'setPoint'; point: PointId; progress: number }
  | { kind: 'setTime'; timeLeft: number }
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
    }
  | { t: 'role'; role: Role | null }
  | { t: 'ready'; ready: boolean }
  | { t: 'name'; name: string }
  | { t: 'start' }
  | { t: 'input'; frames: InputFrame[] }
  | { t: 'ping'; c: number }
  | { t: 'rematch' }
  | { t: 'test'; cmd: TestCommand };

export type ErrorCode =
  'room-not-found' | 'room-full' | 'in-progress' | 'bad-request' | 'not-allowed' | 'replaced';

export type ServerMessage =
  | { t: 'welcome'; you: string; token: string; room: string; balance: Balance; balanceHash: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'match'; info: MatchInfo }
  | { t: 'snap'; s: Snapshot }
  | { t: 'pong'; c: number; s: number }
  | { t: 'result'; result: MatchResult }
  | { t: 'error'; code: ErrorCode; message: string };
