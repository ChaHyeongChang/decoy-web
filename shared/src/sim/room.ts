// 방, 로비, 역할 선택, 재접속, 판 진행 (실시간 틱 → Game.step → 플레이어별 스냅샷)
import {
  MAX_NAME_LENGTH,
  PRACTICE_ROOM_PREFIX,
  ROLE_IDS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  Rng,
  balanceHash,
  isKeptNote,
  teamOf,
  type Balance,
  type ClientMessage,
  type InputFrame,
  type LobbyPlayer,
  type LobbyState,
  type MatchInfo,
  type MatchResult,
  type Role,
  type RoomKind,
  type RoomPhase,
  type ServerMessage,
  type TestCommand,
} from '../index';
import { Game } from './game';
import { AliasBook, buildSnapshot, computeVisibility } from './interest';
import { newSeatToken } from './random';
import { applyDropExpired, buildResult } from './systems/match';

export interface Conn {
  readonly id: number;
  send(msg: ServerMessage): void;
  close(): void;
}

export interface Seat {
  id: string;
  token: string;
  name: string;
  role: Role | null;
  ready: boolean;
  conn: Conn | null;
  bot: boolean;
  joinOrder: number;
  /** 접속이 끊긴 시각 (ms). 연결 중이면 null */
  droppedAt: number | null;
  matchesPlayed: number;
  /** 마지막으로 보낸 lobby 내용 (판 중 같은 내용은 다시 보내지 않는다) */
  lastLobby: string | null;
  /**
   * 다른 사람에게 보이는 익명 이름 "플레이어 n" (M13c). n은 자리 순서와 무관한 무작위. 빠른 매칭 방에서는 다른 사람 이름이
   * 늘 이것이고, 어느 방이든 판 중 괴물에게 가는 로비 메시지의 다른 자리 이름도 이것이다
   */
  alias: string;
  /** 이 자리에서 마지막으로 메시지(ping 포함)를 받은 시각 (ms, M13c 빠른 매칭 자동 시작 때 쓴다) */
  lastSeen: number;
}

export interface RoomHooks {
  /**
   * 빈자리를 채울 봇을 띄운다. 서버 ?bots=1은 WebSocket 봇(server/src/bots.ts), 기기 안 연습 · 빠른 매칭은
   * 같은 프로세스 봇(botDriver.ts — 봇 자리에 가짜 연결을 붙인다). 판 시작 직전에 불린다('match' 전)
   */
  spawnBot?: (room: Room, seat: Seat) => void;
  /** 판 중 틱마다 game.step 직전 (botDriver.ts가 봇 자리마다 이번 틱 입력 하나를 넣는다. 스냅샷은 20Hz라 매 틱 필요) */
  beforeStep?: (room: Room) => void;
  /**
   * 빠른 매칭 방이 빈자리를 봇으로 채워 시작해도 되는가 (M13c, 동시 봇 방 상한). false면 "사람만 기다리는 중"으로
   * 4명이 모일 때까지 기다린다. 없으면 늘 된다
   */
  canFillBots?: (room: Room) => boolean;
  /** 틱마다 정답 상태 기록 (테스트 전용) */
  recordTruth?: (room: Room) => void;
  log?: (msg: string) => void;
}

export interface RoomConfig {
  balance: Balance;
  seed: number;
  testHooks: boolean;
  /** 기기 안 연습 서버 (M13b, client/src/localServer.ts): 새 방은 모두 연습 방(빈자리 = 실전 봇, `P-` 코드) */
  practice?: boolean;
}

const ALL_ROLES: readonly Role[] = ['monster', ...ROLE_IDS];
/** 사람이 아무도 없는 방을 지우기까지 (ms) */
export const ROOM_IDLE_TIMEOUT_MS = 60_000;
/** 빠른 매칭 자동 시작 순간 이보다 오래 소식(ping 포함)이 없던 자리는 빼고 봇으로 (ms, 클라이언트 ping은 1초마다) */
export const QUICK_STALE_MS = 3000;
/** 빠른 매칭: 봇을 채우지 못해 사람만 기다리는 중 (로비 안내) */
export const WAITING_HUMANS_ONLY = '사람만 기다리는 중';

export class Room {
  phase: RoomPhase = 'lobby';
  readonly seats: Seat[] = [];
  hostId: string | null = null;
  game: Game | null = null;
  /** 괴물에게 보낼 생존자 임시 ID */
  private aliases = new AliasBook();
  /** 이번 판에 괴물이 끊겨 있던 시간의 합 (초). 재접속해도 줄지 않는다 */
  private monsterAway = 0;
  matchCount = 0;
  lastResult: Extract<ServerMessage, { t: 'result' }> | null = null;
  emptySince: number | null = null;
  private joinCounter = 0;
  private readonly rng: Rng;
  /** 익명 이름 번호용 (판 시드 난수와 따로, 판 결과가 자리 수에 따라 달라지지 않게) */
  private readonly aliasRng: Rng;
  private readonly balanceHash: string;
  /** 빠른 매칭 자동 시작 시각 (ms, 서버 시계). 첫 사람이 들어올 때 정한다 */
  quickDeadline: number | null = null;
  /** 빠른 매칭: 봇을 채우지 못해 4명을 기다리는 중 */
  private humansOnly = false;

  constructor(
    readonly code: string,
    readonly config: RoomConfig,
    readonly bots: boolean,
    private readonly hooks: RoomHooks,
    /** 방 종류 (M13b): 친구 방 · 빠른 매칭(M13c) · 기기 안 연습 */
    readonly kind: RoomKind = 'code',
  ) {
    this.rng = new Rng(config.seed ^ hashCode(code));
    this.aliasRng = new Rng((config.seed ^ hashCode(code) ^ 0x51ed27) | 0);
    this.balanceHash = balanceHash(config.balance);
  }

  get humanSeats(): Seat[] {
    return this.seats.filter((s) => !s.bot);
  }

  seatById(id: string): Seat | undefined {
    return this.seats.find((s) => s.id === id);
  }

  seatByToken(token: string): Seat | undefined {
    return this.seats.find((s) => s.token === token);
  }

  /** 아직 이 방에서 쓰지 않은 익명 번호 하나 (1~4, 무작위) */
  private newAlias(): string {
    const used = new Set(this.seats.map((s) => s.alias));
    const free: string[] = [];
    for (let n = 1; n <= Math.max(this.config.balance.match.players, this.seats.length + 1); n += 1)
      if (!used.has(`플레이어 ${n}`)) free.push(`플레이어 ${n}`);
    return free[this.aliasRng.int(free.length)] ?? `플레이어 ${this.joinCounter}`;
  }

  addSeat(conn: Conn | null, name: string, bot: boolean, nowMs = 0): Seat {
    this.joinCounter += 1;
    const alias = this.newAlias();
    const seat: Seat = {
      id: `p${this.joinCounter}`,
      // 자리 토큰은 예측할 수 없어야 한다 (시드 난수는 시뮬레이션 전용)
      token: newSeatToken(),
      // 봇 이름에 역할을 넣지 않는다 (괴물이 남은 역할로 사람 역할을 짐작하지 못하게, M13c)
      name: bot ? `봇 ${alias.slice(alias.lastIndexOf(' ') + 1)}` : cleanName(name) || alias,
      alias,
      lastSeen: nowMs,
      role: null,
      ready: bot,
      conn,
      bot,
      joinOrder: this.joinCounter,
      droppedAt: null,
      matchesPlayed: 0,
      lastLobby: null,
    };
    this.seats.push(seat);
    if (!bot && this.hostId === null) this.hostId = seat.id;
    this.emptySince = null;
    // 빠른 매칭: 첫 사람이 들어온 때부터 대기 시간을 센다
    if (this.kind === 'quick' && !bot && this.quickDeadline === null)
      this.quickDeadline = nowMs + this.config.balance.matchmaking.quickMatchWait * 1000;
    return seat;
  }

  /** 기존 자리에 새 연결을 붙인다 (재접속) */
  attach(seat: Seat, conn: Conn): void {
    if (seat.conn && seat.conn.id !== conn.id) {
      // 다른 탭이 이 자리를 넘겨받았다: 이전 탭은 재접속하지 않도록 알리고 닫는다
      seat.conn.send({ t: 'error', code: 'replaced', message: '다른 탭에서 이 자리로 접속했습니다' });
      seat.conn.close();
    }
    seat.conn = conn;
    seat.droppedAt = null;
    seat.lastLobby = null;
    this.emptySince = null;
    const p = this.game?.players.get(seat.id);
    if (p) {
      p.connected = true;
      p.droppedFor = null;
      // 끊긴 동안 쌓인 일회성 알림은 버린다 (돌아온 첫 스냅샷에 지난 소리 · 배너가 몰려 오지 않게). 거점 메모(비밀번호)만 남긴다
      p.outbox = p.outbox.filter(isKeptNote);
    }
  }

  welcome(seat: Seat): void {
    seat.conn?.send({
      t: 'welcome',
      you: seat.id,
      token: seat.token,
      room: this.code,
      balance: this.config.balance,
      balanceHash: this.balanceHash,
    });
    this.sendLobby();
    if (this.phase === 'playing' && this.game) seat.conn?.send({ t: 'match', info: this.matchInfo(seat) });
    if (this.phase === 'result' && this.lastResult) seat.conn?.send(this.resultFor(seat, this.lastResult));
  }

  detach(seat: Seat, nowMs: number): void {
    seat.conn = null;
    seat.droppedAt = nowMs;
    const p = this.game?.players.get(seat.id);
    if (p) {
      p.connected = false;
      p.droppedFor = 0;
      // 끊기기 직전 큐에 남은 입력(공격 누름 등)이 돌아온 뒤 뒤늦게 처리되지 않게
      p.queue.length = 0;
    }
    if (this.phase !== 'playing') seat.ready = false;
    this.sendLobby();
  }

  /**
   * 방에서 나간다 (M13b, 'leave'): 로비 · 결과 단계면 자리를 지우고(방장은 다음 사람에게), 판 중이면 끊김과 같다
   * (유예를 센다 — M13c에서 바로 판정으로 바꾼다). 연결과 자리의 묶음은 ServerCore가 푼다
   */
  leave(seat: Seat, nowMs: number): void {
    if (this.phase === 'playing') {
      // 판 중 나가기는 유예 없이 바로 (M13c): 괴물이면 무효, 생존자면 사망 처리 후 판정
      this.detach(seat, nowMs);
      const p = this.game?.players.get(seat.id);
      if (p) p.droppedFor = null;
      if (this.game) applyDropExpired(this.game, seat.id);
      return;
    }
    this.removeSeat(seat);
    this.sendLobby();
  }

  lobbyState(): LobbyState {
    const { ok, reason } = this.startCheck();
    return {
      room: this.code,
      kind: this.kind,
      phase: this.phase,
      players: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        ready: s.ready,
        connected: s.bot || s.conn !== null,
        host: s.id === this.hostId,
        bot: s.bot,
      })),
      bots: this.bots,
      canStart: ok,
      waitingFor: reason,
      autoStartAt:
        this.kind === 'quick' && this.phase === 'lobby' && !this.humansOnly ? this.quickDeadline : null,
    };
  }

  sendLobby(): void {
    const full = this.lobbyState();
    for (const s of this.seats) {
      if (!s.conn) continue;
      const lobby = this.lobbyFor(s, full);
      const json = JSON.stringify(lobby);
      // 판 중에는 내용이 같으면 보내지 않는다: 괴물에게 "생존자 누군가 끊김 · 재접속"이 메시지 도착 자체로 새지 않게
      if (this.phase === 'playing' && json === s.lastLobby) continue;
      s.lastLobby = json;
      s.conn.send({ t: 'lobby', lobby });
    }
  }

  /**
   * 받는 사람별 로비 (정보 차단):
   *  - 판 중 괴물: 다른 자리의 역할 · 접속 상태 · 이름 · 봇 여부를 보내지 않는다 (이름은 익명 "플레이어 n", M13c)
   *  - 빠른 매칭 방: 다른 사람 이름은 늘 익명, 봇 여부도 보내지 않는다 (봇 표시는 결과 화면에서만, M13c)
   */
  lobbyFor(seat: Seat, full: LobbyState): LobbyState {
    const monsterInMatch = full.phase !== 'lobby' && seat.role === 'monster';
    if (!monsterInMatch && this.kind !== 'quick') return full;
    return {
      ...full,
      players: full.players.map((p): LobbyPlayer => {
        if (p.id === seat.id) return p;
        const other = this.seatById(p.id);
        const masked = { ...p, name: other?.alias ?? p.name, bot: false };
        return monsterInMatch ? { ...masked, role: null, connected: true, ready: true } : masked;
      }),
    };
  }

  /** 받는 사람별 결과: 봇 표시를 넣고, 빠른 매칭이면 다른 사람 이름을 익명으로 (M13c) */
  resultFor(seat: Seat, msg: Extract<ServerMessage, { t: 'result' }>): ServerMessage {
    const result: MatchResult = {
      ...msg.result,
      players: msg.result.players.map((p) => {
        const other = this.seatById(p.id);
        const name = this.kind === 'quick' && p.id !== seat.id ? (other?.alias ?? p.name) : p.name;
        return { ...p, name, bot: other?.bot ?? false };
      }),
    };
    return { t: 'result', result };
  }

  /** 시작 가능 여부. 봇 방이면 빈 역할은 봇이 채운다 */
  startCheck(): { ok: boolean; reason: string | null } {
    if (this.phase !== 'lobby') return { ok: false, reason: '진행 중' };
    // 빠른 매칭은 방장 시작 없이 자동으로 시작한다 (quickTick)
    if (this.kind === 'quick') return { ok: false, reason: this.humansOnly ? WAITING_HUMANS_ONLY : null };
    const humans = this.humanSeats;
    if (humans.some((s) => s.role === null))
      return { ok: false, reason: '역할을 고르지 않은 사람이 있습니다' };
    if (humans.some((s) => !s.ready)) return { ok: false, reason: '준비하지 않은 사람이 있습니다' };
    if (humans.some((s) => s.conn === null)) return { ok: false, reason: '접속이 끊긴 사람이 있습니다' };
    if (!this.bots && this.seats.length < this.config.balance.match.players) {
      return { ok: false, reason: `${this.config.balance.match.players}명이 모여야 합니다` };
    }
    if (humans.length === 0) return { ok: false, reason: '사람이 없습니다' };
    return { ok: true, reason: null };
  }

  handle(seat: Seat, msg: ClientMessage, nowMs: number): void {
    seat.lastSeen = nowMs;
    switch (msg.t) {
      case 'role': {
        if (this.phase !== 'lobby') return;
        const role = msg.role;
        if (role !== null && !ALL_ROLES.includes(role)) return;
        if (role !== null && this.seats.some((s) => s !== seat && s.role === role)) {
          this.sendLobby();
          return;
        }
        seat.role = role;
        seat.ready = false;
        this.sendLobby();
        return;
      }
      case 'ready':
        // 빠른 매칭에는 준비가 없다
        if (this.phase !== 'lobby' || this.kind === 'quick') return;
        seat.ready = msg.ready && seat.role !== null;
        this.sendLobby();
        return;
      case 'name':
        seat.name = cleanName(msg.name) || seat.name;
        this.sendLobby();
        return;
      case 'start':
        if (seat.id !== this.hostId) return;
        if (!this.startCheck().ok) {
          this.sendLobby();
          return;
        }
        this.startMatch();
        return;
      case 'input':
        if (this.phase === 'playing' && this.game && Array.isArray(msg.frames)) {
          const frames = msg.frames
            .slice(0, 16)
            .filter((f): f is InputFrame => typeof f === 'object' && f !== null && typeof f.seq === 'number');
          this.game.queueInput(seat.id, frames);
        }
        return;
      case 'ping':
        seat.conn?.send({ t: 'pong', c: msg.c, s: nowMs });
        return;
      case 'rematch':
        // 빠른 매칭은 판 뒤 방을 해산한다: 다시 하기는 누른 사람만 대기열로 (ServerCore가 옮긴다)
        if (this.phase !== 'result' || this.kind === 'quick') return;
        this.backToLobby();
        // 봇과 연습: 같은 역할로 바로 다음 판 (준비 · 방장 시작 없음)
        if (this.kind === 'practice' && seat.role !== null) {
          seat.ready = true;
          if (this.startCheck().ok) this.startMatch();
        }
        return;
      case 'leave':
        this.leave(seat, nowMs);
        return;
      case 'test':
        if (this.config.testHooks) this.applyTest(msg.cmd);
        return;
      default:
        return;
    }
  }

  matchInfo(seat: Seat): MatchInfo {
    const role = seat.role ?? 'runner';
    // 빠른 매칭: 다른 사람 이름은 익명, 봇 여부는 보내지 않는다 (결과 화면에서만)
    const quick = this.kind === 'quick';
    const roster =
      teamOf(role) === 'survivor'
        ? this.seats.map((s) => ({
            id: s.id,
            name: quick && s !== seat ? s.alias : s.name,
            role: s.role ?? 'runner',
            bot: quick && s !== seat ? false : s.bot,
          }))
        : [{ id: seat.id, name: seat.name, role, bot: seat.bot }];
    return {
      you: seat.id,
      role,
      roster,
      tickHz: this.config.balance.network.serverTickHz,
      firstMatch: seat.matchesPlayed === 0,
    };
  }

  startMatch(): void {
    // 봇 방이면 빈 역할을 봇으로 채운다
    if (this.bots) {
      for (const role of ALL_ROLES) {
        if (this.seats.some((s) => s.role === role)) continue;
        if (this.seats.length >= this.config.balance.match.players) break;
        const seat = this.addSeat(null, '', true);
        seat.role = role;
        seat.ready = true;
        this.hooks.spawnBot?.(this, seat);
      }
    }
    const setup = this.seats
      .filter((s): s is Seat & { role: Role } => s.role !== null)
      .map((s) => ({ id: s.id, name: s.name, role: s.role, bot: s.bot }));
    this.matchCount += 1;
    this.game = new Game(setup, this.config.balance, { seed: this.rng.int(2 ** 31) });
    this.aliases = new AliasBook();
    this.monsterAway = 0;
    this.phase = 'playing';
    this.lastResult = null;
    for (const s of this.seats) s.conn?.send({ t: 'match', info: this.matchInfo(s) });
    for (const s of this.seats) s.matchesPlayed += 1;
    this.sendLobby();
    // 서버 로그에 닉네임을 남기지 않는다 (M13c, 처리방침: 닉네임은 서버 메모리에만)
    const bots = setup.filter((p) => p.bot).length;
    this.hooks.log?.(`방 ${this.code} 판 시작 (${this.kind}, 사람 ${setup.length - bots} · 봇 ${bots})`);
  }

  /** 판이 끝났다: 결과를 보내고 결과 화면 단계로 */
  finishMatch(game: Game): void {
    if (this.phase !== 'playing') return;
    const result = buildResult(game);
    this.phase = 'result';
    this.lastResult = { t: 'result', result };
    for (const s of this.seats) {
      const last = this.lastResult;
      s.conn?.send(this.resultFor(s, last));
    }
    this.sendLobby();
    this.hooks.log?.(
      `방 ${this.code} 판 끝: ${result.winner} (${game.end?.reason ?? ''}, 탈출 ${result.escaped})`,
    );
  }

  backToLobby(): void {
    this.phase = 'lobby';
    this.game = null;
    this.lastResult = null;
    // 봇 자리는 비우고, 사람은 역할을 유지한 채 준비만 푼다
    for (let i = this.seats.length - 1; i >= 0; i -= 1) {
      const s = this.seats[i];
      if (s?.bot) {
        s.conn?.close();
        this.seats.splice(i, 1);
      }
    }
    for (const s of this.seats) s.ready = false;
    this.sendLobby();
  }

  private isSnapshotTick(tick: number): boolean {
    const n = this.config.balance.network;
    return (
      Math.floor((tick * n.snapshotHz) / n.serverTickHz) !==
      Math.floor(((tick - 1) * n.snapshotHz) / n.serverTickHz)
    );
  }

  /** 실시간 틱 */
  tick(nowMs: number): void {
    this.dropExpiredLobbySeats(nowMs);
    if (this.kind === 'quick' && this.phase === 'lobby') this.quickTick(nowMs);
    // 사람이 아무도 접속해 있지 않으면 (판 중이어도) 빈 방 시계를 돌린다 → RoomManager가 지운다
    if (this.humanSeats.every((s) => s.conn === null)) this.emptySince ??= nowMs;
    else this.emptySince = null;
    const game = this.game;
    if (this.phase !== 'playing' || !game) return;
    this.updateDrops(game);
    this.hooks.beforeStep?.(this);
    game.step();
    this.hooks.recordTruth?.(this);
    if (this.isSnapshotTick(game.tick) || game.end) {
      const facts = computeVisibility(game);
      this.aliases.update(facts.monsterSees);
      for (const s of this.seats) {
        if (!s.conn) continue;
        const snap = buildSnapshot(game, s.id, nowMs, facts, this.aliases);
        if (snap) s.conn.send({ t: 'snap', s: snap });
      }
    }
    if (game.end) this.finishMatch(game);
  }

  /**
   * 판 중 접속 끊김 (GAME_DESIGN 9장, DECISIONS D1): 끊긴 플레이어마다 유예 시간(`match.reconnectGrace`)을 센다.
   *  - 괴물: 유예 동안 판 전체를 일시정지(타이머 · 쿨 포함), 지나면 무효
   *  - 생존자: 판은 계속되고 제자리에 남는다(맞을 수 있다), 지나면 사망 처리 후 판정
   * 돌아오면(attach) 유예가 풀린다. 괴물의 대기 시간은 판마다 합산한다(끊고 붙기를 되풀이해 판을 무기한 멈추지 못하게)
   * 괴물을 먼저 본다: 모두 함께 끊겨도 결과가 자리 순서에 따라 갈리지 않고 무효가 된다
   */
  private updateDrops(game: Game): void {
    const grace = this.config.balance.match.reconnectGrace;
    const m = game.monster;
    if (!m.connected && !game.end) {
      this.monsterAway += game.dt;
      if (this.monsterAway >= grace - 1e-9) applyDropExpired(game, m.id);
    }
    const monsterAway = !m.connected && !game.end;
    for (const s of game.survivors) {
      if (s.connected || s.droppedFor === null || game.end) continue;
      if (s.status === 'dead' || s.status === 'escaped') {
        s.droppedFor = null;
        continue;
      }
      s.droppedFor += game.dt;
      if (s.droppedFor < grace - 1e-9) continue;
      s.droppedFor = null;
      // 괴물이 없는 동안(판 정지)에는 사망 처리만 하고, 판정은 판이 다시 흐를 때 한다
      if (monsterAway) s.status = 'dead';
      else applyDropExpired(game, s.id);
    }
    game.paused = monsterAway && !game.end ? Math.max(0, grace - this.monsterAway) : null;
  }

  /**
   * 빠른 매칭 자동 시작 (GAME_DESIGN 11장, M13c): 4명이면 바로, 아니면 첫 사람이 들어온 뒤 quickMatchWait가 지나면.
   * 그 순간 최근 QUICK_STALE_MS 안에 소식이 없던 사람 자리는 빼고(대기열에서 빠졌다고 알림), 역할을 고르지 않은 사람은
   * 남은 역할 중 무작위로, 빈자리는 실전 봇으로 채운다. 봇 방 상한이면 사람 4명을 기다린다("사람만 기다리는 중")
   */
  private quickTick(nowMs: number): void {
    if (this.quickDeadline === null || this.humanSeats.length === 0) return;
    const players = this.config.balance.match.players;
    const full = this.seats.length >= players;
    if (!full && nowMs < this.quickDeadline) return;
    for (const s of this.humanSeats) {
      if (nowMs - s.lastSeen <= QUICK_STALE_MS) continue;
      s.conn?.send({ t: 'error', code: 'queue-dropped', message: '대기열에서 빠졌어요' });
      this.removeSeat(s);
    }
    const humans = this.humanSeats;
    if (humans.length === 0) return;
    if (humans.length < players && this.hooks.canFillBots && !this.hooks.canFillBots(this)) {
      if (!this.humansOnly) {
        this.humansOnly = true;
        this.sendLobby();
      }
      return;
    }
    this.humansOnly = false;
    // 고르지 않은 사람: 남은 역할 중 무작위 (중복 없음, 고른 역할은 그대로)
    for (const s of humans) {
      if (s.role !== null) continue;
      const free = ALL_ROLES.filter((r) => !this.seats.some((q) => q.role === r));
      s.role = free[this.aliasRng.int(free.length)] ?? null;
    }
    for (const s of humans) s.ready = true;
    this.startMatch();
  }

  /** 자리를 지운다 (나가기 · 대기열에서 빠짐). 방장은 다음 사람에게 */
  private removeSeat(seat: Seat): void {
    const i = this.seats.indexOf(seat);
    if (i < 0) return;
    this.seats.splice(i, 1);
    seat.conn = null;
    if (this.hostId === seat.id) {
      const next = this.humanSeats.sort((a, b) => a.joinOrder - b.joinOrder)[0];
      this.hostId = next ? next.id : null;
    }
  }

  private dropExpiredLobbySeats(nowMs: number): void {
    if (this.phase === 'playing') return;
    const graceMs = this.config.balance.match.reconnectGrace * 1000;
    let changed = false;
    for (let i = this.seats.length - 1; i >= 0; i -= 1) {
      const s = this.seats[i];
      if (s && !s.bot && s.conn === null && s.droppedAt !== null && nowMs - s.droppedAt > graceMs) {
        this.seats.splice(i, 1);
        changed = true;
      }
    }
    if (this.hostId !== null && !this.seats.some((s) => s.id === this.hostId && !s.bot)) {
      const next = this.humanSeats.sort((a, b) => a.joinOrder - b.joinOrder)[0];
      this.hostId = next ? next.id : null;
      changed = true;
    }
    if (changed) this.sendLobby();
  }

  private applyTest(cmd: TestCommand): void {
    if (typeof cmd !== 'object' || cmd === null) return;
    const game = this.game;
    if (!game) return;
    switch (cmd.kind) {
      case 'teleport': {
        const p = game.players.get(cmd.target);
        if (!p) return;
        p.move.x = cmd.x;
        p.move.y = cmd.y;
        if (cmd.face !== undefined) p.move.face = cmd.face;
        p.move.frozen = 0;
        return;
      }
      case 'setTime':
        game.timeLeft = cmd.timeLeft;
        return;
      case 'setSurvivor': {
        const s = game.survivorById(cmd.target);
        if (!s) return;
        if (cmd.hp !== undefined) s.hp = cmd.hp;
        if (cmd.status !== undefined) s.status = cmd.status;
        if (cmd.imprisonCount !== undefined) s.imprisonCount = cmd.imprisonCount;
        return;
      }
      case 'setPoint': {
        const p = game.points.find((q) => q.id === cmd.point);
        if (p) p.progress = cmd.progress * game.balance.capturePoint.captureTime;
        return;
      }
      case 'freeze': {
        const p = game.players.get(cmd.target);
        if (p) p.move.frozen = cmd.frozen ? 1e9 : 0;
        return;
      }
      default:
        return;
    }
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly rng: Rng;

  constructor(
    readonly config: RoomConfig,
    private readonly hooks: RoomHooks,
  ) {
    this.rng = new Rng(config.seed);
  }

  private newCode(kind: RoomKind): string {
    // 연습 방은 접두가 달라 서버 방 코드와 겹치지 않는다 (주소 · 저장에도 쓰지 않는다)
    const prefix = kind === 'practice' ? PRACTICE_ROOM_PREFIX : '';
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const code = prefix + this.rng.token(ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET);
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('방 코드를 만들 수 없습니다');
  }

  createRoom(bots: boolean, kind: RoomKind = this.config.practice ? 'practice' : 'code'): Room {
    const code = this.newCode(kind);
    const room = new Room(code, this.config, bots || kind === 'practice', this.hooks, kind);
    this.rooms.set(code, room);
    return room;
  }

  /**
   * 빠른 매칭 대기열 (M13c): 대기 중인 빠른 매칭 방(로비 · 4명 미만 · 사람이 붙어 있음)이 있으면 들어가고 없으면 새로 만든다.
   * 방 코드로 만든 방은 섞이지 않는다
   */
  quick(conn: Conn, name: unknown, nowMs = 0): { room: Room; seat: Seat } {
    const players = this.config.balance.match.players;
    let room: Room | undefined;
    for (const r of this.rooms.values()) {
      if (r.kind !== 'quick' || r.phase !== 'lobby' || r.seats.length >= players) continue;
      if (!r.humanSeats.some((s) => s.conn !== null)) continue;
      room = r;
      break;
    }
    room ??= this.createRoom(true, 'quick');
    return { room, seat: room.addSeat(conn, typeof name === 'string' ? name : '', false, nowMs) };
  }

  /** join 메시지 처리. 성공하면 (방, 자리), 실패하면 오류 메시지 */
  join(
    conn: Conn,
    msg: Extract<ClientMessage, { t: 'join' }>,
    nowMs = 0,
  ): { room: Room; seat: Seat } | { error: Extract<ServerMessage, { t: 'error' }> } {
    const code = typeof msg.room === 'string' ? msg.room.trim().toUpperCase() : null;
    if (code) {
      const room = this.rooms.get(code);
      if (room) {
        // 1) 이 탭의 토큰 (sessionStorage): 연결 중이어도 새 연결로 바꾼다 (새로고침)
        const own = msg.token ? room.seatByToken(msg.token) : undefined;
        if (own) {
          room.attach(own, conn);
          return { room, seat: own };
        }
        // 2) 이 브라우저의 보조 토큰 (localStorage): 지금 끊겨 있는 자리만
        const alts = !msg.token && Array.isArray(msg.altTokens) ? msg.altTokens.slice(0, 8) : [];
        for (const t of alts) {
          if (typeof t !== 'string') continue;
          const seat = room.seatByToken(t);
          if (seat && !seat.bot && seat.conn === null) {
            room.attach(seat, conn);
            return { room, seat };
          }
        }
        if (room.phase !== 'lobby') {
          return { error: { t: 'error', code: 'in-progress', message: '이미 진행 중인 방입니다' } };
        }
        // 빠른 매칭 방에는 코드 · 링크로 새로 들어갈 수 없다 (돌아오는 자리만)
        if (room.kind === 'quick') {
          return {
            error: { t: 'error', code: 'not-allowed', message: '빠른 매칭 방에는 코드로 들어갈 수 없습니다' },
          };
        }
        if (room.seats.length >= this.config.balance.match.players) {
          return { error: { t: 'error', code: 'room-full', message: '방이 가득 찼습니다' } };
        }
        return { room, seat: room.addSeat(conn, msg.name, false, nowMs) };
      }
      if (!msg.create)
        return {
          error: { t: 'error', code: 'room-not-found', message: `방 ${code}을(를) 찾을 수 없습니다` },
        };
    }
    if (!msg.create) return { error: { t: 'error', code: 'bad-request', message: '방 코드가 필요합니다' } };
    const room = this.createRoom(Boolean(msg.bots));
    return { room, seat: room.addSeat(conn, msg.name, false, nowMs) };
  }

  tick(nowMs: number): void {
    for (const room of this.rooms.values()) {
      room.tick(nowMs);
      if (room.emptySince !== null && nowMs - room.emptySince > ROOM_IDLE_TIMEOUT_MS) {
        this.rooms.delete(room.code);
        for (const s of room.seats) s.conn?.close();
      }
    }
  }
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return Array.from(name)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== '<' && ch !== '>')
    .join('')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function hashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}
