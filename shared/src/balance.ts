// balance.json의 타입과 검증. 수치의 원본은 config/balance.json이다.
// 서버가 시작할 때 파일을 읽어 검증하고, 접속한 클라이언트에 welcome 메시지로 내려 준다.
// 그래서 수치를 바꾸면 다시 빌드하지 않아도 서버 재시작만으로 양쪽이 같은 값을 쓴다.

export type RoleId = 'runner' | 'guard' | 'scout';
export type VisionModeId = 'search' | 'hunt';

export interface VisionModeBalance {
  name: string;
  angle: number;
  range: number;
}

export interface RunnerBalance {
  name: string;
  color: string;
  skill: 'sprint';
  sprintDuration: number;
  sprintMultiplier: number;
  cooldown: number;
}

export interface GuardBalance {
  name: string;
  color: string;
  skill: 'shove';
  shoveRange: number;
  stunDuration: number;
  cooldown: number;
}

export interface ScoutBalance {
  name: string;
  color: string;
  skill: 'track';
  trackDuration: number;
  cooldown: number;
  visionRadius: number;
}

export interface Balance {
  match: {
    players: number;
    survivors: number;
    timeLimit: number;
    monsterStartDelay: number;
    lastSurvivorGrace: number;
    reconnectGrace: number;
  };
  survivor: {
    moveSpeed: number;
    radius: number;
    visionRadius: number;
    visionSoftEdge: number;
    maxHp: number;
    maxImprisonments: number;
    rescueProtection: number;
    abilityRevealDuration: number;
  };
  roles: {
    runner: RunnerBalance;
    guard: GuardBalance;
    scout: ScoutBalance;
  };
  monster: {
    moveSpeed: number;
    radius: number;
    turnSlowAngle: number;
    turnSlowMultiplier: number;
    turnSlowDuration: number;
    turnSlowWindow: number;
    aimTurnRateDeg: number;
    nearVisionRadius: number;
    visionModes: Record<VisionModeId, VisionModeBalance>;
    visionModeSwitchTime: number;
    attack: { windup: number; cooldown: number; range: number; arc: number; windupMoveMultiplier: number };
    dash: { distance: number; duration: number; cooldown: number };
    roar: { radius: number; revealDuration: number; selfRevealDuration: number; cooldown: number };
  };
  prison: {
    rescueTime: number;
    rescueRadius: number;
    campRadius: number;
    campGrace: number;
    campSlowMultiplier: number;
    campWarnAt: number;
  };
  capturePoint: {
    count: number;
    radius: number;
    captureTime: number;
    groupMultiplier: number;
    pausedWhenMonsterInside: boolean;
    monsterBlockGrace: number;
    alertCooldown: number;
  };
  exit: {
    count: number;
    radius: number;
    requiredSurvivors: number;
    openTime: number;
    pausedWhenMonsterInside: boolean;
  };
  /** 빠른 매칭 (M13c, GAME_DESIGN 11장) */
  matchmaking: {
    /** 첫 사람이 들어온 뒤 이 시간(초)이 지나면 4명이 안 돼도 빈자리를 봇으로 채워 시작한다 */
    quickMatchWait: number;
  };
  network: {
    serverTickHz: number;
    snapshotHz: number;
    interpolationDelayMs: number;
    lagJitterMs: number;
    inputQueueMax: number;
    correctionSmoothMs: number;
    snapDistance: number;
  };
}

export const ROLE_IDS: readonly RoleId[] = ['runner', 'guard', 'scout'];

type Shape = 'num' | 'nonneg' | 'pos' | 'int' | 'bool' | 'str' | 'color' | { [key: string]: Shape };

const MODE_SHAPE: Shape = { name: 'str', angle: 'pos', range: 'pos' };

/** 검증 스키마. 'pos' = 0보다 큰 수, 'nonneg' = 0 이상, 'int' = 1 이상 정수 */
const SCHEMA: Shape = {
  match: {
    players: 'int',
    survivors: 'int',
    timeLimit: 'pos',
    monsterStartDelay: 'nonneg',
    lastSurvivorGrace: 'nonneg',
    reconnectGrace: 'nonneg',
  },
  survivor: {
    moveSpeed: 'pos',
    radius: 'pos',
    visionRadius: 'pos',
    visionSoftEdge: 'nonneg',
    maxHp: 'int',
    maxImprisonments: 'nonneg',
    rescueProtection: 'nonneg',
    abilityRevealDuration: 'nonneg',
  },
  roles: {
    runner: {
      name: 'str',
      color: 'color',
      skill: 'str',
      sprintDuration: 'pos',
      sprintMultiplier: 'pos',
      cooldown: 'nonneg',
    },
    guard: {
      name: 'str',
      color: 'color',
      skill: 'str',
      shoveRange: 'pos',
      stunDuration: 'pos',
      cooldown: 'nonneg',
    },
    scout: {
      name: 'str',
      color: 'color',
      skill: 'str',
      trackDuration: 'pos',
      cooldown: 'nonneg',
      visionRadius: 'pos',
    },
  },
  monster: {
    moveSpeed: 'pos',
    radius: 'pos',
    turnSlowAngle: 'nonneg',
    turnSlowMultiplier: 'nonneg',
    turnSlowDuration: 'nonneg',
    turnSlowWindow: 'nonneg',
    aimTurnRateDeg: 'pos',
    nearVisionRadius: 'nonneg',
    visionModes: { search: MODE_SHAPE, hunt: MODE_SHAPE },
    visionModeSwitchTime: 'nonneg',
    attack: {
      windup: 'nonneg',
      cooldown: 'nonneg',
      range: 'pos',
      arc: 'pos',
      windupMoveMultiplier: 'nonneg',
    },
    dash: { distance: 'nonneg', duration: 'pos', cooldown: 'nonneg' },
    roar: { radius: 'nonneg', revealDuration: 'nonneg', selfRevealDuration: 'nonneg', cooldown: 'nonneg' },
  },
  prison: {
    rescueTime: 'pos',
    rescueRadius: 'pos',
    campRadius: 'nonneg',
    campGrace: 'nonneg',
    campSlowMultiplier: 'nonneg',
    campWarnAt: 'nonneg',
  },
  capturePoint: {
    count: 'int',
    radius: 'pos',
    captureTime: 'pos',
    groupMultiplier: 'pos',
    pausedWhenMonsterInside: 'bool',
    monsterBlockGrace: 'nonneg',
    alertCooldown: 'nonneg',
  },
  exit: {
    count: 'int',
    radius: 'pos',
    requiredSurvivors: 'int',
    openTime: 'nonneg',
    pausedWhenMonsterInside: 'bool',
  },
  matchmaking: {
    quickMatchWait: 'pos',
  },
  network: {
    serverTickHz: 'pos',
    snapshotHz: 'pos',
    interpolationDelayMs: 'nonneg',
    lagJitterMs: 'nonneg',
    inputQueueMax: 'int',
    correctionSmoothMs: 'nonneg',
    snapDistance: 'pos',
  },
};

function check(value: unknown, shape: Shape, path: string, errors: string[]): void {
  if (typeof shape === 'object') {
    if (typeof value !== 'object' || value === null) {
      errors.push(`${path}: 객체가 필요합니다`);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(shape)) {
      const sub = shape[key];
      if (sub === undefined) continue;
      check(obj[key], sub, path ? `${path}.${key}` : key, errors);
    }
    return;
  }
  switch (shape) {
    case 'bool':
      if (typeof value !== 'boolean') errors.push(`${path}: true/false가 필요합니다`);
      return;
    case 'str':
      if (typeof value !== 'string' || value.length === 0) errors.push(`${path}: 문자열이 필요합니다`);
      return;
    case 'color':
      if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value))
        errors.push(`${path}: #RRGGBB 색이 필요합니다`);
      return;
    default:
      break;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: 숫자가 필요합니다`);
    return;
  }
  if (shape === 'pos' && value <= 0) errors.push(`${path}: 0보다 커야 합니다 (${value})`);
  if (shape === 'nonneg' && value < 0) errors.push(`${path}: 0 이상이어야 합니다 (${value})`);
  if (shape === 'int' && (!Number.isInteger(value) || value < 1))
    errors.push(`${path}: 1 이상 정수여야 합니다 (${value})`);
}

/** 구조에 묶인 값(인원 · 개수)은 맵과 역할 구조와 맞아야 한다 */
const STRUCTURAL: ReadonlyArray<[string, (b: Balance) => boolean]> = [
  ['match.players는 4여야 합니다', (b) => b.match.players === 4],
  ['match.survivors는 3이어야 합니다', (b) => b.match.survivors === 3],
  ['capturePoint.count는 2여야 합니다 (맵 구조)', (b) => b.capturePoint.count === 2],
  ['exit.count는 2여야 합니다 (맵 구조)', (b) => b.exit.count === 2],
  ['exit.requiredSurvivors는 1~3이어야 합니다', (b) => b.exit.requiredSurvivors <= 3],
  ['roles.runner.skill은 sprint', (b) => b.roles.runner.skill === 'sprint'],
  ['roles.guard.skill은 shove', (b) => b.roles.guard.skill === 'shove'],
  ['roles.scout.skill은 track', (b) => b.roles.scout.skill === 'track'],
];

export class BalanceError extends Error {
  constructor(public readonly problems: string[]) {
    super(`config/balance.json 오류:\n - ${problems.join('\n - ')}`);
    this.name = 'BalanceError';
  }
}

/** 알 수 없는 JSON 값을 검증해 Balance로 돌려준다. 문제가 있으면 BalanceError */
export function validateBalance(raw: unknown): Balance {
  const errors: string[] = [];
  check(raw, SCHEMA, '', errors);
  if (errors.length > 0) throw new BalanceError(errors);
  const balance = raw as Balance;
  for (const [message, ok] of STRUCTURAL) if (!ok(balance)) errors.push(message);
  if (errors.length > 0) throw new BalanceError(errors);
  return balance;
}

/** 내용 비교용 짧은 해시 (디버그 오버레이에서 서버·클라이언트 수치가 같은지 확인) */
export function balanceHash(balance: Balance): string {
  const text = JSON.stringify(balance);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
