// 방, 로비, 역할 선택, 재접속, 판 진행 (실시간 틱 → Game.step → 플레이어별 스냅샷)
import {
  MAX_NAME_LENGTH,
  ROLE_IDS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  Rng,
  balanceHash,
  teamOf,
  type Balance,
  type ClientMessage,
  type InputFrame,
  type LobbyState,
  type MatchInfo,
  type Role,
  type RoomPhase,
  type ServerMessage,
  type TestCommand,
} from '@decoy/shared';
import { randomBytes } from 'node:crypto';
import { Game } from './game';
import { AliasBook, buildSnapshot, computeVisibility } from './interest';

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
}

export interface RoomHooks {
  /** 빈자리를 채울 봇을 띄운다 (bots.ts) */
  spawnBot?: (room: Room, seat: Seat) => void;
  /** 틱마다 정답 상태 기록 (테스트 전용) */
  recordTruth?: (room: Room) => void;
  log?: (msg: string) => void;
}

export interface RoomConfig {
  balance: Balance;
  seed: number;
  testHooks: boolean;
}

const ALL_ROLES: readonly Role[] = ['monster', ...ROLE_IDS];
/** 사람이 아무도 없는 방을 지우기까지 (ms) */
export const ROOM_IDLE_TIMEOUT_MS = 60_000;

export class Room {
  phase: RoomPhase = 'lobby';
  readonly seats: Seat[] = [];
  hostId: string | null = null;
  game: Game | null = null;
  /** 괴물에게 보낼 생존자 임시 ID */
  private aliases = new AliasBook();
  matchCount = 0;
  lastResult: ServerMessage | null = null;
  emptySince: number | null = null;
  private joinCounter = 0;
  private readonly rng: Rng;
  private readonly balanceHash: string;

  constructor(
    readonly code: string,
    readonly config: RoomConfig,
    readonly bots: boolean,
    private readonly hooks: RoomHooks,
  ) {
    this.rng = new Rng(config.seed ^ hashCode(code));
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

  addSeat(conn: Conn | null, name: string, bot: boolean): Seat {
    this.joinCounter += 1;
    const seat: Seat = {
      id: `p${this.joinCounter}`,
      // 자리 토큰은 예측할 수 없어야 한다 (시드 난수는 시뮬레이션 전용)
      token: randomBytes(18).toString('base64url'),
      name: cleanName(name) || `플레이어 ${this.joinCounter}`,
      role: null,
      ready: bot,
      conn,
      bot,
      joinOrder: this.joinCounter,
      droppedAt: null,
      matchesPlayed: 0,
    };
    this.seats.push(seat);
    if (!bot && this.hostId === null) this.hostId = seat.id;
    this.emptySince = null;
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
    this.emptySince = null;
    const p = this.game?.players.get(seat.id);
    if (p) {
      p.connected = true;
      p.droppedFor = null;
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
    if (this.phase === 'result' && this.lastResult) seat.conn?.send(this.lastResult);
  }

  detach(seat: Seat, nowMs: number): void {
    seat.conn = null;
    seat.droppedAt = nowMs;
    const p = this.game?.players.get(seat.id);
    if (p) {
      p.connected = false;
      p.droppedFor = 0;
    }
    if (this.phase !== 'playing') seat.ready = false;
    this.sendLobby();
  }

  lobbyState(): LobbyState {
    const { ok, reason } = this.startCheck();
    return {
      room: this.code,
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
    };
  }

  sendLobby(): void {
    const full = this.lobbyState();
    for (const s of this.seats) {
      if (!s.conn) continue;
      s.conn.send({ t: 'lobby', lobby: this.lobbyFor(s, full) });
    }
  }

  /** 판 중에는 괴물에게 다른 사람의 역할 · 접속 상태를 보내지 않는다 (정보 차단) */
  lobbyFor(seat: Seat, full: LobbyState): LobbyState {
    if (full.phase === 'lobby' || seat.role !== 'monster') return full;
    return {
      ...full,
      players: full.players.map((p) =>
        p.id === seat.id ? p : { ...p, role: null, connected: true, ready: true },
      ),
    };
  }

  /** 시작 가능 여부. 봇 방이면 빈 역할은 봇이 채운다 */
  startCheck(): { ok: boolean; reason: string | null } {
    if (this.phase !== 'lobby') return { ok: false, reason: '진행 중' };
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
        if (this.phase !== 'lobby') return;
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
        if (this.phase === 'result') this.backToLobby();
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
    const roster =
      teamOf(role) === 'survivor'
        ? this.seats.map((s) => ({ id: s.id, name: s.name, role: s.role ?? 'runner', bot: s.bot }))
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
        const seat = this.addSeat(null, `봇 ${role}`, true);
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
    this.phase = 'playing';
    this.lastResult = null;
    for (const s of this.seats) s.conn?.send({ t: 'match', info: this.matchInfo(s) });
    for (const s of this.seats) s.matchesPlayed += 1;
    this.sendLobby();
    this.hooks.log?.(`방 ${this.code} 판 시작 (${setup.map((p) => `${p.name}:${p.role}`).join(', ')})`);
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
    // 사람이 아무도 접속해 있지 않으면 (판 중이어도) 빈 방 시계를 돌린다 → RoomManager가 지운다
    if (this.humanSeats.every((s) => s.conn === null)) this.emptySince ??= nowMs;
    else this.emptySince = null;
    const game = this.game;
    if (this.phase !== 'playing' || !game) return;
    game.step();
    this.hooks.recordTruth?.(this);
    if (this.isSnapshotTick(game.tick)) {
      const facts = computeVisibility(game);
      this.aliases.update(facts.monsterSees);
      for (const s of this.seats) {
        if (!s.conn) continue;
        const snap = buildSnapshot(game, s.id, nowMs, facts, this.aliases);
        if (snap) s.conn.send({ t: 'snap', s: snap });
      }
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

  private newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const code = this.rng.token(ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET);
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('방 코드를 만들 수 없습니다');
  }

  createRoom(bots: boolean): Room {
    const code = this.newCode();
    const room = new Room(code, this.config, bots, this.hooks);
    this.rooms.set(code, room);
    return room;
  }

  /** join 메시지 처리. 성공하면 (방, 자리), 실패하면 오류 메시지 */
  join(
    conn: Conn,
    msg: Extract<ClientMessage, { t: 'join' }>,
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
        if (room.seats.length >= this.config.balance.match.players) {
          return { error: { t: 'error', code: 'room-full', message: '방이 가득 찼습니다' } };
        }
        return { room, seat: room.addSeat(conn, msg.name, false) };
      }
      if (!msg.create)
        return {
          error: { t: 'error', code: 'room-not-found', message: `방 ${code}을(를) 찾을 수 없습니다` },
        };
    }
    if (!msg.create) return { error: { t: 'error', code: 'bad-request', message: '방 코드가 필요합니다' } };
    const room = this.createRoom(Boolean(msg.bots));
    return { room, seat: room.addSeat(conn, msg.name, false) };
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
