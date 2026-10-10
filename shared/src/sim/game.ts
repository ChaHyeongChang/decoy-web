// 고정 틱 시뮬레이션. 실제 시간과 무관하게 step() 한 번이 1/serverTickHz초다.
// 방(room.ts)은 실시간으로 step()을 부르고, 테스트는 루프로 빠르게 부른다.
import {
  BTN,
  MONSTER_SPAWN,
  PRISON_CENTER,
  PRISON_SLOTS,
  Rng,
  createMoveState,
  stepMovement,
  type Balance,
  type Circle,
  type ExitId,
  type GameEvent,
  type InputFrame,
  type MoveEnv,
  type Role,
  type RoleId,
} from '../index';
import type {
  CapturePointState,
  ExitRuntime,
  GamePlayer,
  MatchEnd,
  MonsterState,
  PlayerStats,
  SurvivorState,
} from './state';
import { abilitiesTick, monsterAbilityInput, survivorAbilityInput } from './systems/abilities';
import { captureTick } from './systems/capture';
import { combatTick, monsterAttackInput } from './systems/combat';
import { exitTick } from './systems/exit';
import { matchTick } from './systems/match';
import { monsterBlendTick, monsterModeInput } from './systems/monster';
import { prisonTick } from './systems/prison';

export interface GamePlayerSetup {
  id: string;
  name: string;
  role: Role;
  bot: boolean;
}

export interface GameOptions {
  seed: number;
}

/** 한 틱에 처리할 수 있는 최대 입력 수와 크레딧 상한 */
const MAX_FRAMES_PER_TICK = 3;
const CREDIT_CAP = 4;
/** 이 틱 수 넘게 입력이 없으면 빈 입력으로 시간을 흘린다 (탭이 백그라운드거나 끊김) */
const STARVE_TICKS = 4;
/** 이보다 오래 입력이 없으면 늦게 올 입력이 없다고 본다 (1초) */
const LONG_STARVE_TICKS = 30;
/** 늦게 온 입력을 이동 없이 처리할 최대 개수 */
const DEBT_CAP = 8;

function newStats(): PlayerStats {
  return { hitsTaken: 0, hitsLanded: 0, rescues: 0, captureSeconds: 0 };
}

export class Game {
  readonly dt: number;
  tick = 0;
  /** 판 시작 후 흐른 시뮬레이션 시간 (초). 일시정지 중에는 멈춘다 */
  time = 0;
  readonly rng: Rng;
  readonly players = new Map<string, GamePlayer>();
  readonly survivors: SurvivorState[] = [];
  readonly monster: MonsterState;
  readonly points: CapturePointState[] = [
    {
      id: 'A',
      progress: 0,
      done: false,
      capturing: false,
      blocked: false,
      lastAlertAt: -1e9,
      wasCapturing: false,
    },
    {
      id: 'B',
      progress: 0,
      done: false,
      capturing: false,
      blocked: false,
      lastAlertAt: -1e9,
      wasCapturing: false,
    },
  ];
  readonly exits: ExitRuntime[] = [
    { id: 'N', state: 'inactive', progress: 0 },
    { id: 'S', state: 'inactive', progress: 0 },
  ];
  /** 남은 시간 (초) */
  timeLeft: number;
  /** 최후의 30초 남은 시간 */
  grace: number | null = null;
  /** 괴물 재접속 대기 (일시정지) 남은 시간 */
  paused: number | null = null;
  end: MatchEnd | null = null;
  /** 점령 순서대로 보여 줄 비밀번호 두 자리 × 2 */
  readonly codes: [string, string];
  capturedCount = 0;
  /** 이번 틱의 공용 이벤트 (interest.ts가 받는 사람별로 거른다) */
  readonly broadcast: GameEvent[] = [];

  constructor(
    setup: readonly GamePlayerSetup[],
    readonly balance: Balance,
    options: GameOptions,
  ) {
    this.dt = 1 / balance.network.serverTickHz;
    this.rng = new Rng(options.seed);
    this.timeLeft = balance.match.timeLimit;
    const digits = (): string => String(this.rng.int(100)).padStart(2, '0');
    this.codes = [digits(), digits()];

    let monster: MonsterState | null = null;
    let slot = 0;
    for (const p of setup) {
      if (p.role === 'monster') {
        const face = Math.atan2(PRISON_CENTER.y - MONSTER_SPAWN.y, PRISON_CENTER.x - MONSTER_SPAWN.x);
        const move = createMoveState(MONSTER_SPAWN, face);
        move.frozen = balance.match.monsterStartDelay;
        monster = {
          kind: 'monster',
          role: 'monster',
          id: p.id,
          name: p.name,
          bot: p.bot,
          move,
          queue: [],
          ack: 0,
          held: 0,
          credit: 0,
          starved: 0,
          processed: 0,
          debt: 0,
          connected: true,
          droppedFor: null,
          outbox: [],
          stats: newStats(),
          attackCd: 0,
          windupLeft: 0,
          windupDir: 0,
          dashCd: 0,
          roarCd: 0,
          mode: 'search',
          blend: 0,
          roarRevealLeft: 0,
          roarX: 0,
          roarY: 0,
          trackedLeft: 0,
          pointCamp: { A: 0, B: 0 },
        };
        this.players.set(p.id, monster);
      } else {
        const pos = PRISON_SLOTS[slot % PRISON_SLOTS.length] ?? PRISON_CENTER;
        slot += 1;
        const s: SurvivorState = {
          kind: 'survivor',
          role: p.role,
          id: p.id,
          name: p.name,
          bot: p.bot,
          move: createMoveState(pos, Math.PI / 2),
          queue: [],
          ack: 0,
          held: 0,
          credit: 0,
          starved: 0,
          processed: 0,
          debt: 0,
          connected: true,
          droppedFor: null,
          outbox: [],
          stats: newStats(),
          status: 'free',
          hp: balance.survivor.maxHp,
          imprisonCount: 0,
          protectLeft: 0,
          abilityCd: 0,
          abilityActive: 0,
          revealLeft: 0,
          rescueProgress: 0,
          hitTick: -1,
          spotted: false,
        };
        this.survivors.push(s);
        this.players.set(p.id, s);
      }
    }
    if (!monster) throw new Error('괴물 역할이 없습니다');
    this.monster = monster;
  }

  get openExits(): Record<ExitId, boolean> {
    return {
      N: this.exits[0]?.state === 'open',
      S: this.exits[1]?.state === 'open',
    };
  }

  /** 클라이언트 입력을 큐에 넣는다. 이미 처리한 seq와 중복은 버린다 */
  queueInput(playerId: string, frames: readonly InputFrame[]): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const lastQueued = p.queue.length > 0 ? (p.queue[p.queue.length - 1]?.seq ?? p.ack) : p.ack;
    let last = lastQueued;
    for (const f of frames) {
      if (!Number.isFinite(f.seq) || f.seq <= last) continue;
      p.queue.push(sanitizeInput(f));
      last = f.seq;
    }
    const max = this.balance.network.inputQueueMax;
    while (p.queue.length > max) {
      // 너무 밀리면 오래된 이동은 버리되 눌림 입력은 다음 입력에 합친다
      const dropped = p.queue.shift();
      const next = p.queue[0];
      if (dropped && next) next.pressed |= dropped.pressed;
      if (dropped) p.ack = dropped.seq;
    }
  }

  /** 움직이는 몸들 (다른 쪽 진영과는 서로 통과하지 않는다) */
  bodyOf(p: GamePlayer): Circle | null {
    if (p.kind === 'monster') return { x: p.move.x, y: p.move.y, r: this.balance.monster.radius };
    if (p.status !== 'free') return null;
    return { x: p.move.x, y: p.move.y, r: this.balance.survivor.radius };
  }

  moveEnvFor(p: GamePlayer): MoveEnv {
    const obstacles: Circle[] = [];
    if (p.kind === 'monster') {
      for (const s of this.survivors) {
        const body = this.bodyOf(s);
        if (body) obstacles.push(body);
      }
    } else if (p.status === 'free') {
      const body = this.bodyOf(this.monster);
      if (body) obstacles.push(body);
    }
    return {
      kind: p.kind,
      role: p.kind === 'survivor' ? p.role : null,
      mover: {
        kind: p.kind,
        imprisoned: p.kind === 'survivor' && p.status === 'imprisoned',
        openExits: this.openExits,
      },
      campActive: this.survivors.some((s) => s.status === 'imprisoned'),
      obstacles,
    };
  }

  /** 입력 한 개의 눌림 처리 (이동보다 먼저) */
  private handleActions(p: GamePlayer, input: InputFrame): void {
    if (p.kind === 'monster') {
      monsterModeInput(this, p, input);
      monsterAttackInput(this, p, input);
      monsterAbilityInput(this, p, input);
    } else {
      survivorAbilityInput(this, p, input);
    }
  }

  /** 틱마다 한 번 도는 규칙 처리 (DECISIONS: 입력·이동 → 능력 → 공격 → 구조 → 점령 → 탈출 → 승패 → 시간) */
  private runSystems(): void {
    monsterBlendTick(this, this.monster);
    abilitiesTick(this);
    combatTick(this);
    prisonTick(this);
    captureTick(this);
    exitTick(this);
    matchTick(this);
  }

  private processPlayerInputs(p: GamePlayer): void {
    if (p.kind === 'survivor' && (p.status === 'dead' || p.status === 'escaped')) {
      // 관전 중: 입력은 받기만 하고 버린다 (클라이언트 예측이 쌓이지 않게 ack는 올린다)
      const last = p.queue[p.queue.length - 1];
      if (last) p.ack = last.seq;
      p.queue.length = 0;
      return;
    }
    p.credit = Math.min(CREDIT_CAP, p.credit + 1);
    let processed = 0;
    while (p.queue.length > 0 && processed < MAX_FRAMES_PER_TICK) {
      const input = p.queue[0];
      if (!input) break;
      if (p.debt > 0) {
        // 서버가 이미 빈 입력으로 시간을 흘린 만큼, 늦게 도착한 입력은 이동 없이 처리한다
        // (안 그러면 입력이 영구히 몇 틱씩 밀린다). 버튼 눌림은 살린다
        p.queue.shift();
        p.debt -= 1;
        p.ack = input.seq;
        p.held = input.held;
        this.handleActions(p, input);
        continue;
      }
      if (p.credit < 1) break;
      p.queue.shift();
      p.credit -= 1;
      processed += 1;
      p.ack = input.seq;
      p.processed += 1;
      p.held = input.held;
      this.handleActions(p, input);
      this.stepBody(p, input);
    }
    if (processed > 0) {
      p.starved = 0;
      return;
    }
    p.starved += 1;
    if (p.starved > STARVE_TICKS) {
      // 입력이 끊긴 플레이어도 시간은 흐른다 (돌진 · 타이머). 이동 입력은 0, 버튼도 뗀 것으로 본다
      p.credit = Math.max(0, p.credit - 1);
      // 잠깐 막힌 경우 그동안의 입력이 늦게 올 수 있다: 그만큼을 빚으로 센다. 오래 끊기면(탭 숨김) 빚을 비운다
      p.debt = p.starved > LONG_STARVE_TICKS ? 0 : Math.min(DEBT_CAP, p.debt + 1);
      p.held = 0;
      this.stepBody(p, idleInput(p));
    }
  }

  private stepBody(p: GamePlayer, input: InputFrame): void {
    // 공격 준비 중 조준 고정은 준비 시간(틱마다 줄어듦)을 따른다. 한 틱에 입력이 몰려 처리돼도 타격 전에 풀리지 않게
    if (p.kind === 'monster' && p.windupLeft > 0) p.move.aimLock = Math.max(p.move.aimLock, p.windupLeft);
    stepMovement(p.move, input, this.moveEnvFor(p), this.balance, this.dt);
  }

  step(): void {
    if (this.end) return;
    this.tick += 1;
    if (this.paused !== null) return;
    this.time += this.dt;
    // 괴물 먼저, 그다음 생존자 (각자 다른 몸은 이 시점 위치의 정지한 원으로 본다)
    this.processPlayerInputs(this.monster);
    for (const s of this.survivors) this.processPlayerInputs(s);
    // 12분 타이머는 matchTick 안에서 줄인다 (0이 되는 바로 그 틱에 시간 초과 판정)
    this.runSystems();
  }

  /** 받는 사람별 이벤트를 꺼낸다 */
  drainOutbox(playerId: string): GameEvent[] {
    const p = this.players.get(playerId);
    if (!p || p.outbox.length === 0) return [];
    const out = p.outbox;
    p.outbox = [];
    return out;
  }

  emitTo(p: GamePlayer, event: GameEvent): void {
    p.outbox.push(event);
  }

  survivorById(id: string): SurvivorState | undefined {
    const p = this.players.get(id);
    return p && p.kind === 'survivor' ? p : undefined;
  }

  roleOf(id: string): Role | undefined {
    return this.players.get(id)?.role;
  }

  survivorsByRole(role: RoleId): SurvivorState | undefined {
    return this.survivors.find((s) => s.role === role);
  }
}

function idleInput(p: GamePlayer): InputFrame {
  return { seq: p.ack, mx: 0, my: 0, aim: Number.NaN, held: 0, pressed: 0 };
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

/** 클라이언트가 보낸 값을 믿지 않는다: 범위를 자르고 알 수 없는 비트는 버린다 */
export function sanitizeInput(f: InputFrame): InputFrame {
  const mask = BTN.ATTACK | BTN.MODE | BTN.RESCUE | BTN.ABILITY | BTN.DASH | BTN.ROAR;
  return {
    seq: Math.floor(f.seq),
    mx: clampUnit(f.mx),
    my: clampUnit(f.my),
    aim: Number.isFinite(f.aim) ? f.aim : Number.NaN,
    held: (f.held | 0) & mask,
    pressed: (f.pressed | 0) & mask,
  };
}
