// 서버 시뮬레이션 상태 타입 (클라이언트에 그대로 보내지 않는다. interest.ts가 걸러서 보낸다)
import type {
  ExitId,
  ExitState,
  GameEvent,
  InputFrame,
  MoveState,
  PointId,
  RoleId,
  SurvivorStatus,
  VisionModeId,
} from '@decoy/shared';

export interface PlayerStats {
  hitsTaken: number;
  hitsLanded: number;
  rescues: number;
  captureSeconds: number;
}

interface PlayerBase {
  id: string;
  name: string;
  bot: boolean;
  move: MoveState;
  /** 아직 처리하지 않은 입력 */
  queue: InputFrame[];
  /** 마지막으로 처리한 입력 seq */
  ack: number;
  /** 마지막으로 처리한 입력 (누르고 있는 버튼 상태) */
  held: number;
  /** 입력 처리 크레딧 (틱마다 1씩, 밀린 입력을 따라잡는 데 쓴다) */
  credit: number;
  /** 입력이 없었던 연속 틱 수 */
  starved: number;
  /** 지금까지 처리한 입력 수 */
  processed: number;
  connected: boolean;
  /** 접속이 끊긴 뒤 지난 시간 (끊겨 있지 않으면 null) */
  droppedFor: number | null;
  /** 다음 스냅샷에 실어 보낼 이벤트 */
  outbox: GameEvent[];
  stats: PlayerStats;
}

export interface SurvivorState extends PlayerBase {
  kind: 'survivor';
  role: RoleId;
  status: SurvivorStatus;
  hp: number;
  imprisonCount: number;
  protectLeft: number;
  abilityCd: number;
  /** 능력 효과 남은 시간 (질주 · 탐지) */
  abilityActive: number;
  /** 능력 사용 후 정체 노출 남은 시간 */
  revealLeft: number;
  rescueProgress: number;
  /** 이번 틱에 괴물에게 보이는가 (interest.ts가 채운다) */
  spotted: boolean;
}

export interface MonsterState extends PlayerBase {
  kind: 'monster';
  role: 'monster';
  attackCd: number;
  windupLeft: number;
  windupDir: number;
  dashCd: number;
  roarCd: number;
  mode: VisionModeId;
  /** 0 = 탐색, 1 = 추적. 모드 전환 중에는 사이 값 */
  blend: number;
  /** 포효로 생존자 화면에 자기 위치가 드러나는 남은 시간과 위치 */
  roarRevealLeft: number;
  roarX: number;
  roarY: number;
  /** 스카우트 탐지로 위치가 드러나는 남은 시간 */
  trackedLeft: number;
  /** 거점 안에 연속으로 머문 시간 */
  pointCamp: Record<PointId, number>;
}

export type GamePlayer = SurvivorState | MonsterState;

export interface CapturePointState {
  id: PointId;
  progress: number;
  done: boolean;
  /** 이번 틱 상태 */
  capturing: boolean;
  blocked: boolean;
  /** 마지막으로 점령 시작 알림을 보낸 시각 */
  lastAlertAt: number;
  wasCapturing: boolean;
}

export interface ExitRuntime {
  id: ExitId;
  state: ExitState;
  progress: number;
}

export type MatchOutcomeReason =
  'escaped' | 'deaths' | 'allImprisoned' | 'noFreeSurvivors' | 'timeout' | 'monsterLeft';

export interface MatchEnd {
  winner: 'survivors' | 'monster' | 'void';
  reason: MatchOutcomeReason;
  tick: number;
}
