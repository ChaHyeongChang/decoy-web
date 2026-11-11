// 판 시작 카운트다운 (플레이테스트 a-8, GAME_DESIGN 1장): 수치 match.startCountdown, Game의 사전 단계(모두 정지 · 판 시간 · 12분 시계 ·
// 괴물 시작 정지가 흐르지 않음), 끝난 뒤의 판이 카운트다운 없는 판과 같음(틱 · ack만 다름), 방이 넘기는 값(시험 훅 방 0 · 방 설정 ·
// 시험 명령), 스냅샷 world.countdown(받는 사람과 무관하게 같은 값), 괴물이 끊기면 같이 멈춤, 재접속, 봇 · 판 기록 · 예측 보정
import { describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  BTN,
  Rng,
  validateBalance,
  type Balance,
  type ClientMessage,
  type InputFrame,
  type MoveEnv,
  type Role,
  type Snapshot,
} from '@decoy/shared';
import {
  AliasBook,
  BotDriver,
  Game,
  MatchRecorder,
  RoomManager,
  ServerCore,
  buildSnapshot,
  computeVisibility,
  practiceBrain,
  type Room,
  type RoomConfig,
  type Seat,
} from '@decoy/shared/sim';
import { BotClient } from '../../server/src/bots';
import { Predictor } from '../../client/src/sync';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance, newGame, setup4 } from '../helpers/fixtures';

const balance = loadTestBalance();
const COUNT = balance.match.startCountdown;
const HZ = balance.network.serverTickHz;
/** 카운트다운 틱 수 (3초 = 90틱) */
const COUNT_TICKS = Math.round(COUNT * HZ);
const ALL_BUTTONS = BTN.ATTACK | BTN.MODE | BTN.RESCUE | BTN.ABILITY | BTN.DASH | BTN.ROAR;
const ROLES: Role[] = ['monster', 'runner', 'guard', 'scout'];

function countdownGame(seconds = COUNT, seed = 77): Game {
  return new Game(setup4(), balance, { seed, countdown: seconds });
}

/**
 * 판 상태 전체를 글자로 (틱 · ack · 입력 큐 · 수치 · 카운트다운 남은 값은 뺀다). 틱으로 적는 값(맞은 틱 · 끝난 틱)은
 * 판이 흐르기 시작한 틱(base)에서 센 값으로 바꾼다 — "틱 · ack만 다르다"를 견주기 위해
 */
function stateOf(game: Game, base: number): string {
  return JSON.stringify(game, (key, value: unknown) => {
    if (key === 'tick' && typeof value === 'number') return value - base;
    if (key === 'hitTick' && typeof value === 'number') return value < 0 ? value : value - base;
    if (key === 'ack' || key === 'queue' || key === 'balance' || key === 'countdownLeft') return undefined;
    if (value instanceof Map) return undefined;
    return value;
  });
}

describe('수치 match.startCountdown', () => {
  const raw = (): { match: Record<string, unknown> } & Record<string, unknown> =>
    JSON.parse(JSON.stringify(balance)) as { match: Record<string, unknown> } & Record<string, unknown>;

  it('balance.json에 있고 3초다 (GAME_DESIGN 변경 이력 2026.11.10)', () => {
    expect(COUNT).toBe(3);
  });

  it('없거나 음수 · 수가 아니면 검증에서 막고, 0(끔)은 통과한다', () => {
    const missing = raw();
    delete missing.match.startCountdown;
    expect(() => validateBalance(missing)).toThrow(/startCountdown/);
    const negative = raw();
    negative.match.startCountdown = -1;
    expect(() => validateBalance(negative)).toThrow(/startCountdown/);
    const text = raw();
    text.match.startCountdown = '3';
    expect(() => validateBalance(text)).toThrow(/startCountdown/);
    const off = raw();
    off.match.startCountdown = 0;
    expect(validateBalance(off).match.startCountdown).toBe(0);
  });
});

describe('Game: 판 시작 카운트다운 (사전 단계)', () => {
  it('옵션이 없으면 0이다 — 판을 바로 만드는 시험 · 봇 시뮬레이션은 첫 틱부터 흐른다', () => {
    const game = newGame(3);
    expect(game.countdownLeft).toBe(0);
    game.step();
    expect(game.time).toBeCloseTo(game.dt, 12);
    expect(game.timeLeft).toBeCloseTo(balance.match.timeLimit - game.dt, 9);
  });

  it('음수 · 수가 아닌 값은 0으로 본다', () => {
    expect(countdownGame(-2).countdownLeft).toBe(0);
    expect(countdownGame(Number.NaN).countdownLeft).toBe(0);
    expect(countdownGame(Number.POSITIVE_INFINITY).countdownLeft).toBe(0);
  });

  it('3초 = 정확히 90틱: 그동안 모든 입력을 넣어도 자리 · 방향 · 쿨타임 · 모드 · 판 시간 · 12분 시계 · 괴물 정지가 그대로이고 ack만 오른다', () => {
    const game = countdownGame();
    const before = stateOf(game, 0);
    const startPos = [...game.players.values()].map((p) => ({ x: p.move.x, y: p.move.y, face: p.move.face }));
    expect(COUNT_TICKS).toBe(90);
    for (let t = 1; t <= COUNT_TICKS; t += 1) {
      // 이동 · 조준 · 공격 · 돌진 · 포효 · 모드 전환 · 능력 · 구조를 모두 누른다
      for (const id of game.players.keys())
        game.queueInput(id, [{ seq: t, mx: 1, my: -1, aim: 1.2, held: ALL_BUTTONS, pressed: ALL_BUTTONS }]);
      // 마지막 틱 전까지는 남은 시간이 0보다 크다
      expect(game.countdownLeft, `틱 ${t} 전`).toBeGreaterThan(0);
      game.step();
      expect(game.tick).toBe(t);
      expect(stateOf(game, t), `틱 ${t}`).toBe(before);
      for (const p of game.players.values()) {
        expect(p.ack).toBe(t);
        expect(p.queue.length).toBe(0);
      }
    }
    expect(game.countdownLeft).toBe(0);
    expect(game.time).toBe(0);
    expect(game.timeLeft).toBe(balance.match.timeLimit);
    expect(game.monster.move.frozen).toBe(balance.match.monsterStartDelay);
    expect(game.monster.mode).toBe('search');
    expect(game.monster.attackCd + game.monster.dashCd + game.monster.roarCd).toBe(0);
    for (const s of game.survivors) expect(s.abilityCd).toBe(0);
    [...game.players.values()].forEach((p, i) =>
      expect({ x: p.move.x, y: p.move.y, face: p.move.face }).toEqual(startPos[i]),
    );
    expect(game.broadcast.length).toBe(0);
    for (const p of game.players.values()) expect(p.outbox.length).toBe(0);
  });

  it('91틱째부터 판이 흐른다: 생존자는 바로 움직이고, 괴물 시작 정지 5초(150틱)는 카운트다운 뒤부터 그대로다', () => {
    const game = countdownGame();
    for (let t = 1; t <= COUNT_TICKS; t += 1) game.step();
    const runner = game.survivors[0]!;
    const monster = game.monster;
    const mx0 = monster.move.x;
    const rx0 = runner.move.x;
    const delayTicks = Math.round(balance.match.monsterStartDelay * HZ);
    let seq = 0;
    const tickWith = (): void => {
      seq += 1;
      game.queueInput(runner.id, [{ seq, mx: 1, my: 0, aim: Number.NaN, held: 0, pressed: 0 }]);
      game.queueInput(monster.id, [{ seq, mx: 1, my: 0, aim: Number.NaN, held: 0, pressed: 0 }]);
      game.step();
    };
    tickWith();
    expect(game.tick).toBe(COUNT_TICKS + 1);
    expect(game.time).toBeCloseTo(game.dt, 12);
    expect(game.timeLeft).toBeCloseTo(balance.match.timeLimit - game.dt, 9);
    expect(runner.move.x).toBeGreaterThan(rx0);
    // 괴물: 판이 흐른 150틱 동안 제자리 (입력마다 정지 시간이 준다 — 처리한 입력 150개)
    for (let i = 1; i < delayTicks; i += 1) tickWith();
    expect(monster.move.x).toBe(mx0);
    expect(monster.move.frozen).toBe(0);
    tickWith();
    expect(monster.move.x).toBeGreaterThan(mx0);
    expect(game.tick).toBe(COUNT_TICKS + delayTicks + 1);
  });

  it('동일성: 같은 입력이면 카운트다운 판의 (90 + n)틱 상태 = 카운트다운 없는 판의 n틱 상태 (3000틱, 틱 · ack만 다름)', () => {
    const a = countdownGame(COUNT, 20261110);
    const b = new Game(setup4(), balance, { seed: 20261110 });
    // 카운트다운 동안 a에만 입력을 퍼붓는다 (모두 버려져야 한다)
    for (let t = 1; t <= COUNT_TICKS; t += 1) {
      for (const id of a.players.keys())
        a.queueInput(id, [{ seq: t, mx: -1, my: 1, aim: -2, held: ALL_BUTTONS, pressed: ALL_BUTTONS }]);
      a.step();
    }
    expect(a.countdownLeft).toBe(0);
    const rng = new Rng(4242);
    // 사람마다 방향을 잠깐씩 유지한다 (맵을 돌아다녀 공격 · 수감 · 점령이 생기게)
    const hold = new Map<string, { mx: number; my: number; left: number }>();
    let hits = 0;
    for (let n = 0; n < 3000; n += 1) {
      expect(stateOf(a, COUNT_TICKS), `n = ${n}`).toBe(stateOf(b, 0));
      for (const id of a.players.keys()) {
        let h = hold.get(id);
        if (!h || h.left <= 0) {
          const ang = rng.next() * Math.PI * 2;
          h = { mx: Math.cos(ang), my: Math.sin(ang), left: 10 + rng.int(50) };
          hold.set(id, h);
        }
        h.left -= 1;
        const f = {
          mx: h.mx,
          my: h.my,
          aim: rng.next() * Math.PI * 2 - Math.PI,
          held: rng.int(64),
          pressed: rng.next() < 0.08 ? rng.int(64) : 0,
        };
        a.queueInput(id, [{ seq: COUNT_TICKS + n + 1, ...f }]);
        b.queueInput(id, [{ seq: n + 1, ...f }]);
      }
      a.step();
      b.step();
      // 이번 틱의 공용 이벤트 · 받는 사람별 이벤트도 같다 (상태 글자에 들어 있다). 다음 틱을 위해 비운다
      a.broadcast.length = 0;
      b.broadcast.length = 0;
      for (const p of a.players.values()) a.drainOutbox(p.id);
      for (const p of b.players.values()) b.drainOutbox(p.id);
      hits = b.monster.stats.hitsLanded;
    }
    expect(stateOf(a, COUNT_TICKS)).toBe(stateOf(b, 0));
    expect(a.tick - b.tick).toBe(COUNT_TICKS);
    expect(a.time).toBe(b.time);
    // 시나리오가 헛돌지 않았다: 판이 실제로 흘렀고(괴물이 깨어나 움직임) 뭔가 일어났다
    expect(b.time).toBeGreaterThan(50);
    expect(b.monster.move.frozen).toBe(0);
    expect(b.monster.processed).toBeGreaterThan(2000);
    expect(hits + b.monster.dashCd + b.monster.roarCd).toBeGreaterThan(0);
  });
});

// ───────────────────────── 방 ─────────────────────────

function joinMsg(room: string | null, token: string | null = null): Extract<ClientMessage, { t: 'join' }> {
  return {
    t: 'join',
    proto: PROTOCOL_VERSION,
    room,
    create: room === null,
    name: '',
    token,
    altTokens: [],
    bots: false,
  };
}

function fourRoom(config: Partial<RoomConfig> = {}): {
  mgr: RoomManager;
  room: Room;
  seats: Seat[];
  conns: FakeConn[];
} {
  const mgr = new RoomManager({ balance, seed: 3, testHooks: false, ...config }, {});
  const conns = [new FakeConn(), new FakeConn(), new FakeConn(), new FakeConn()];
  const first = mgr.join(conns[0]!, joinMsg(null));
  if ('error' in first) throw new Error('방 만들기 실패');
  const seats = [first.seat];
  for (let i = 1; i < 4; i += 1) {
    const r = mgr.join(conns[i]!, joinMsg(first.room.code));
    if ('error' in r) throw new Error('입장 실패');
    seats.push(r.seat);
  }
  return { mgr, room: first.room, seats, conns };
}

function ready(room: Room, seats: Seat[]): void {
  seats.forEach((s, i) => room.handle(s, { t: 'role', role: ROLES[i]! }, 0));
  seats.forEach((s) => room.handle(s, { t: 'ready', ready: true }, 0));
}

function begin(config: Partial<RoomConfig> = {}): ReturnType<typeof fourRoom> & { game: Game } {
  const r = fourRoom(config);
  ready(r.room, r.seats);
  r.room.handle(r.seats[0]!, { t: 'start' }, 0);
  const game = r.room.game;
  if (!game) throw new Error('판이 시작되지 않았다');
  return { ...r, game };
}

function run(room: Room, ticks: number, startMs = 0): void {
  for (let i = 0; i < ticks; i += 1) room.tick(startMs + i * (1000 / HZ));
}

function snapsOf(conn: FakeConn): Snapshot[] {
  return conn.inbox.flatMap((m) => (m.t === 'snap' ? [m.s] : []));
}

describe('방: 판마다 카운트다운을 넘긴다', () => {
  it('보통 방(시험 훅 없음)은 수치 match.startCountdown으로 시작한다', () => {
    const { game } = begin();
    expect(game.countdownLeft).toBe(COUNT);
  });

  it('수치를 바꾸면 그 값으로 시작한다 (코드에 박은 3이 아니다)', () => {
    const custom: Balance = { ...balance, match: { ...balance.match, startCountdown: 1.5 } };
    const { game } = begin({ balance: custom });
    expect(game.countdownLeft).toBe(1.5);
  });

  it('시험 훅이 켜진 방은 0이다 (기존 시험은 판 시작 직후를 가정한다)', () => {
    const { game, room } = begin({ testHooks: true });
    expect(game.countdownLeft).toBe(0);
    run(room, 3);
    expect(game.time).toBeGreaterThan(0);
  });

  it('방 설정 startCountdown이 이긴다: 시험 훅 방에서 켜고, 보통 방에서 끌 수 있다', () => {
    expect(begin({ testHooks: true, startCountdown: 2 }).game.countdownLeft).toBe(2);
    expect(begin({ testHooks: false, startCountdown: 0 }).game.countdownLeft).toBe(0);
  });

  it('시험 명령 startCountdown: 로비에서 보내면 다음 판 하나에만 듣는다', () => {
    const { room, seats } = fourRoom({ testHooks: true });
    ready(room, seats);
    room.handle(seats[1]!, { t: 'test', cmd: { kind: 'startCountdown', seconds: 3 } }, 0);
    expect(room.game).toBeNull();
    room.handle(seats[0]!, { t: 'start' }, 0);
    expect(room.game?.countdownLeft).toBe(3);
    // 다음 판은 다시 방 기본(시험 훅 방 = 0)
    room.backToLobby();
    ready(room, seats);
    room.handle(seats[0]!, { t: 'start' }, 0);
    expect(room.game?.countdownLeft).toBe(0);
  });

  it('시험 명령 startCountdown: 음수 · 수가 아닌 값은 버리고, 시험 훅이 꺼진 방은 받지 않는다', () => {
    const hooked = fourRoom({ testHooks: true });
    ready(hooked.room, hooked.seats);
    hooked.room.handle(hooked.seats[0]!, { t: 'test', cmd: { kind: 'startCountdown', seconds: -1 } }, 0);
    hooked.room.handle(
      hooked.seats[0]!,
      { t: 'test', cmd: { kind: 'startCountdown', seconds: Number.NaN } },
      0,
    );
    hooked.room.handle(hooked.seats[0]!, { t: 'start' }, 0);
    expect(hooked.room.game?.countdownLeft).toBe(0);
    // 배포 서버(시험 훅 없음): 누가 0을 보내도 카운트다운은 그대로
    const plain = fourRoom();
    ready(plain.room, plain.seats);
    plain.room.handle(plain.seats[1]!, { t: 'test', cmd: { kind: 'startCountdown', seconds: 0 } }, 0);
    plain.room.handle(plain.seats[0]!, { t: 'start' }, 0);
    expect(plain.room.game?.countdownLeft).toBe(COUNT);
  });

  it('카운트다운 동안 방은 스냅샷을 20Hz로 계속 보내고, 입력을 보내도 판은 흐르지 않는다', () => {
    const { room, seats, conns, game } = begin();
    const runner = game.survivors[0]!;
    const x0 = runner.move.x;
    for (let t = 0; t < COUNT_TICKS - 1; t += 1) {
      room.handle(
        seats[1]!,
        {
          t: 'input',
          frames: [{ seq: t + 1, mx: 1, my: 0, aim: Number.NaN, held: 0, pressed: BTN.ABILITY }],
        },
        0,
      );
      room.tick(t * (1000 / HZ));
    }
    expect(game.countdownLeft).toBeGreaterThan(0);
    expect(game.time).toBe(0);
    expect(runner.move.x).toBe(x0);
    expect(runner.abilityCd).toBe(0);
    const snaps = snapsOf(conns[1]!);
    // 89틱 동안 20Hz = 59개
    expect(snaps.length).toBe(Math.floor(((COUNT_TICKS - 1) * balance.network.snapshotHz) / HZ));
    expect(snaps[0]!.world.countdown).toBeCloseTo(COUNT - 2 / HZ, 2);
    expect(snaps.at(-1)!.world.countdown).toBeGreaterThan(0);
    for (const s of snaps) {
      expect(s.world.timeLeft).toBe(balance.match.timeLimit);
      expect(s.world.monsterWait).toBe(balance.match.monsterStartDelay);
      expect(s.you.move.x).toBe(x0);
    }
    // ack는 오른다 (클라이언트 예측이 쌓이지 않게)
    expect(snaps.at(-1)!.ack).toBeGreaterThan(80);
    // 끝나는 틱은 스냅샷 틱이다: 0이 바로 간다
    room.tick(COUNT_TICKS * (1000 / HZ));
    expect(game.countdownLeft).toBe(0);
    expect(snapsOf(conns[1]!).at(-1)!.world.countdown).toBe(0);
    expect(snapsOf(conns[1]!).at(-1)!.tick).toBe(COUNT_TICKS);
  });

  it('남은 값이 0.005초보다 작은 마지막 틱에도 스냅샷은 0이 아니다 (0은 판이 흐르기 시작한 뒤에만)', () => {
    // 정수 초가 아닌 카운트다운: 두 틱 뒤 0.004초가 남는다
    const game = countdownGame(2 / HZ + 0.004);
    const snapOf = (): Snapshot => {
      const snap = buildSnapshot(game, 'p2', 0, computeVisibility(game), new AliasBook());
      if (!snap) throw new Error('스냅샷 없음');
      return snap;
    };
    game.step();
    game.step();
    expect(game.countdownLeft).toBeGreaterThan(0);
    expect(game.countdownLeft).toBeLessThan(0.005);
    expect(snapOf().world.countdown).toBe(0.01);
    game.step();
    expect(game.countdownLeft).toBe(0);
    expect(game.time).toBe(0);
    expect(snapOf().world.countdown).toBe(0);
  });

  it('스냅샷 world.countdown은 받는 사람과 무관하게 같은 값이고, 괴물 스냅샷에는 시야 밖 생존자가 없다', () => {
    const { room, conns, game } = begin();
    // 생존자 하나를 괴물 시야 밖(먼 구석)으로 — 카운트다운 중에도 정보 차단은 같다
    const far = game.survivors[2]!;
    far.move.x = 2.5;
    far.move.y = 2.5;
    run(room, 30);
    const latest = conns.map((c) => snapsOf(c).at(-1)!);
    const values = new Set(latest.map((s) => s.world.countdown));
    expect(values.size).toBe(1);
    expect([...values][0]).toBeCloseTo(COUNT - 1, 2);
    // 매 스냅샷 틱에서도 네 사람 값이 같다
    const perTick = conns.map((c) => snapsOf(c).map((s) => `${s.tick}:${s.world.countdown}`));
    for (const list of perTick) expect(list).toEqual(perTick[0]);
    const monsterSnap = latest[0]!;
    expect(monsterSnap.you.role).toBe('monster');
    const facts = computeVisibility(game);
    expect(facts.monsterSees.has(far.id)).toBe(false);
    expect(monsterSnap.survivors.length).toBe(facts.monsterSees.size);
    expect(JSON.stringify(monsterSnap)).not.toContain(`"x":${far.move.x},"y":${far.move.y}`);
  });

  it('카운트다운 중 괴물이 끊기면 판 정지와 함께 카운트다운도 멈추고, 돌아오면 이어진다', () => {
    const { room, seats, game } = begin();
    run(room, 30);
    const left = game.countdownLeft;
    expect(left).toBeCloseTo(COUNT - 1, 6);
    room.detach(seats[0]!, 0);
    run(room, 60);
    expect(game.paused).not.toBeNull();
    expect(game.countdownLeft).toBe(left);
    expect(game.time).toBe(0);
    room.attach(seats[0]!, new FakeConn());
    run(room, 30);
    expect(game.paused).toBeNull();
    expect(game.countdownLeft).toBeCloseTo(left - 1, 6);
    run(room, 30);
    expect(game.countdownLeft).toBe(0);
    expect(game.time).toBe(0);
    // 카운트다운 90틱 + 정지 60틱 뒤 첫 틱에 판이 흐르기 시작한다
    expect(game.tick).toBe(COUNT_TICKS + 60);
    run(room, 1);
    expect(game.time).toBeCloseTo(game.dt, 9);
    expect(game.timeLeft).toBeCloseTo(balance.match.timeLimit - game.dt, 9);
  });

  it('카운트다운 중 괴물이 끊긴 채 유예가 지나면 무효로 끝난다 (판 시간 0초)', () => {
    const { room, seats, conns, game } = begin();
    run(room, 10);
    room.detach(seats[0]!, 0);
    run(room, Math.round(balance.match.reconnectGrace * HZ) + 5);
    expect(room.phase).toBe('result');
    expect(game.end?.winner).toBe('void');
    expect(conns[1]!.last('result')?.result.durationSec).toBe(0);
  });

  it('카운트다운 중 재접속: 새 연결의 첫 스냅샷이 남은 값부터 잇는다 (판 시작 메시지도 다시)', () => {
    const { mgr, room, seats, game } = begin();
    run(room, 45);
    room.detach(seats[2]!, 0);
    run(room, 15);
    const again = new FakeConn();
    const r = mgr.join(again, joinMsg(room.code, seats[2]!.token));
    if ('error' in r) throw new Error('재접속 실패');
    expect(r.seat).toBe(seats[2]);
    room.welcome(r.seat);
    expect(again.last('match')?.info.role).toBe('guard');
    run(room, 3, 2000);
    const first = snapsOf(again)[0]!;
    expect(first.world.countdown).toBeGreaterThan(0);
    expect(first.world.countdown).toBeLessThan(COUNT - 1.9);
    expect(first.world.countdown).toBeCloseTo(game.countdownLeft, 1);
    expect(first.world.timeLeft).toBe(balance.match.timeLimit);
  });

  it('판 기록은 판 시간 기준이라 카운트다운을 세지 않는다: 지켜본 90틱 뒤 판 길이 0초 · 모든 수치 0', () => {
    const game = countdownGame();
    const rec = new MatchRecorder(game);
    for (let t = 0; t < COUNT_TICKS; t += 1) {
      game.step();
      rec.observe(game, computeVisibility(game));
    }
    const still = new MatchRecorder(game).finish(game, 'x');
    const record = rec.finish(game, 'x');
    expect(record.durationSec).toBe(0);
    // 아무것도 지켜보지 않은 기록과 같다
    expect(record).toEqual(still);
    // 그 뒤 1초가 흐르면 판 길이 1초
    const rec2 = new MatchRecorder(game);
    for (let t = 0; t < HZ; t += 1) {
      game.step();
      rec2.observe(game, computeVisibility(game));
    }
    expect(rec2.finish(game, 'y').durationSec).toBe(1);
  });
});

// ───────────────────────── 연습 방 · 봇 ─────────────────────────

describe('연습 방(같은 프로세스 봇)과 카운트다운', () => {
  const raw = (msg: ClientMessage): string => JSON.stringify(msg);

  function practice(config: Partial<RoomConfig>) {
    const clock = { t: 0 };
    const driver = new BotDriver((info) => practiceBrain(info.role, 5), balance);
    const core = new ServerCore(
      { balance, seed: 9, testHooks: false, practice: true, ...config },
      driver.hooks(),
      () => clock.t,
    );
    const conn = new FakeConn();
    const link = core.connect(conn, (err) => {
      throw err;
    });
    link.receive(
      raw({
        t: 'join',
        proto: PROTOCOL_VERSION,
        room: null,
        create: true,
        name: '나',
        token: null,
        altTokens: [],
        bots: true,
      }),
    );
    link.receive(raw({ t: 'role', role: 'runner' }));
    link.receive(raw({ t: 'ready', ready: true }));
    link.receive(raw({ t: 'start' }));
    const room = [...core.manager.rooms.values()][0];
    if (!room?.game) throw new Error('연습 판이 시작되지 않았다');
    const ticks = (n: number): void => {
      for (let i = 0; i < n; i += 1) {
        clock.t += core.tickMs;
        core.advance(clock.t);
      }
    };
    return { core, driver, room, conn, link, ticks };
  }

  it('봇은 카운트다운 동안 입력을 넣지 않고 제자리에 있다가, 끝난 틱부터 틱마다 하나씩 넣는다', () => {
    const { driver, room, ticks } = practice({});
    const game = room.game!;
    expect(game.countdownLeft).toBe(COUNT);
    const bots = driver.botsOf(room);
    expect(bots.length).toBe(3);
    const at = new Map(bots.map((b) => [b.seat.id, { ...game.players.get(b.seat.id)!.move }]));
    ticks(COUNT_TICKS);
    expect(game.countdownLeft).toBe(0);
    for (const b of bots) {
      expect(b.inputs, b.seat.id).toBe(0);
      expect(game.players.get(b.seat.id)!.move).toEqual(at.get(b.seat.id));
    }
    ticks(60);
    for (const b of bots) expect(b.inputs, b.seat.id).toBe(60);
    // 생존자 봇은 움직였다
    const moved = bots
      .filter((b) => b.seat.role !== 'monster')
      .some((b) => {
        const p = game.players.get(b.seat.id)!.move;
        const o = at.get(b.seat.id)!;
        return Math.hypot(p.x - o.x, p.y - o.y) > 1;
      });
    expect(moved).toBe(true);
  });

  it('연습 다시 하기로 바로 시작한 판도 카운트다운을 한다', () => {
    const { room, link, ticks, conn } = practice({});
    const first = room.game!;
    ticks(COUNT_TICKS + 1);
    // 첫 판을 시간 초과로 끝낸다 (12분 시계를 바로 0으로)
    first.timeLeft = 0.01;
    ticks(3);
    expect(room.phase).toBe('result');
    link.receive(raw({ t: 'rematch' }));
    expect(room.phase).toBe('playing');
    const second = room.game!;
    expect(second).not.toBe(first);
    expect(second.countdownLeft).toBe(COUNT);
    ticks(4);
    expect(conn.last('snap')?.s.world.countdown).toBeGreaterThan(COUNT - 0.5);
  });

  it('시험(?debug) 연습 판은 0, ?countdown=1이면 수치 — 기기 안 연습 서버가 방 설정으로 넘긴다', () => {
    expect(practice({ testHooks: true }).room.game!.countdownLeft).toBe(0);
    expect(practice({ testHooks: true, startCountdown: COUNT }).room.game!.countdownLeft).toBe(COUNT);
    expect(practice({ testHooks: true, startCountdown: 0 }).room.game!.countdownLeft).toBe(0);
  });
});

describe('WebSocket 봇(server/src/bots.ts)과 카운트다운', () => {
  it('마지막 스냅샷의 world.countdown이 0보다 크면 입력을 보내지 않고, 0이 되면 틱마다 보낸다', async () => {
    const game = countdownGame();
    game.step();
    const snapOf = (): Snapshot => {
      const snap = buildSnapshot(game, 'p2', 0, computeVisibility(game), new AliasBook());
      if (!snap) throw new Error('스냅샷 없음');
      return snap;
    };
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const addr = wss.address();
    if (typeof addr !== 'object' || addr === null) throw new Error('포트 없음');
    const inputs: ClientMessage[] = [];
    const client = new Promise<WebSocket>((resolve) => {
      wss.once('connection', (ws) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(String(data)) as ClientMessage;
          if (msg.t === 'join') {
            const send = (m: unknown): void => ws.send(JSON.stringify(m));
            send({
              t: 'welcome',
              you: 'p2',
              token: 't',
              room: 'ABCD',
              balance,
              balanceHash: '',
              build: null,
            });
            send({
              t: 'match',
              info: { you: 'p2', role: 'runner', roster: [], tickHz: HZ, firstMatch: true },
            });
            send({ t: 'snap', s: snapOf() });
            resolve(ws);
          } else if (msg.t === 'input') inputs.push(msg);
        });
      });
    });
    // 봇 입력 루프가 돈 횟수: tick은 private이라 프로토타입을 감싸 센다 (고정 대기 뒤 한 번 읽으면 루프가 한 번도 돌지 않아도 통과한다)
    const loop = vi.spyOn(BotClient.prototype as unknown as { tick: () => void }, 'tick');
    const bot = new BotClient({ url: `ws://127.0.0.1:${addr.port}`, room: 'ABCD', token: null });
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    /** 조건이 참이 될 때까지 (바쁜 기기에서도 고정 대기에 기대지 않게, 최대 10초) */
    const until = async (ok: () => boolean): Promise<void> => {
      const end = Date.now() + 10_000;
      while (!ok() && Date.now() < end) await wait(20);
    };
    try {
      const ws = await client;
      expect(snapOf().world.countdown).toBeGreaterThan(0);
      // 봇이 카운트다운 스냅샷을 받은 뒤 입력 루프(33ms 주기)가 여섯 번 넘게 도는 동안 하나도 보내지 않는다
      await until(() => bot.lastSnap !== null);
      expect(bot.lastSnap?.world.countdown).toBeGreaterThan(0);
      const from = loop.mock.calls.length;
      await until(() => loop.mock.calls.length >= from + 6);
      expect(loop.mock.calls.length).toBeGreaterThanOrEqual(from + 6);
      expect(inputs.length).toBe(0);
      // 카운트다운이 끝난 스냅샷을 받으면 틱마다 보낸다
      for (let t = 0; t < COUNT_TICKS; t += 1) game.step();
      expect(game.countdownLeft).toBe(0);
      ws.send(JSON.stringify({ t: 'snap', s: snapOf() }));
      await until(() => inputs.length >= 3);
      expect(inputs.length).toBeGreaterThanOrEqual(3);
    } finally {
      bot.stop();
      loop.mockRestore();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });
});

// ───────────────────────── 클라이언트 예측 ─────────────────────────

describe('클라이언트 예측: 카운트다운 동안 보내지도 예측하지도 않으면 보정이 0이다', () => {
  const env = (): MoveEnv => ({
    kind: 'survivor',
    role: 'runner',
    mover: { kind: 'survivor', imprisoned: false, openExits: { N: false, S: false } },
    campActive: false,
    obstacles: [],
  });
  const snapshotTick = (tick: number): boolean =>
    Math.floor((tick * balance.network.snapshotHz) / HZ) !==
    Math.floor(((tick - 1) * balance.network.snapshotHz) / HZ);

  /** 러너가 처음부터 오른쪽 키를 누르고 있다. hold = 마지막 스냅샷의 world.countdown > 0이면 입력 틱을 건너뛴다 (GameScene.stepInput) */
  function play(hold: boolean, lagTicks: number) {
    const game = countdownGame(COUNT, 5);
    const id = 'p2';
    const pred = new Predictor(balance, game.dt, () => 0);
    const aliases = new AliasBook();
    const toClient: { at: number; snap: Snapshot }[] = [];
    const toServer: { at: number; frame: InputFrame }[] = [];
    let last: Snapshot | null = null;
    let seq = 0;
    let maxCorrection = 0;
    let firstServerMove = -1;
    let firstClientMove = -1;
    let reconciles = 0;
    const x0 = game.players.get(id)!.move.x;
    for (let t = 1; t <= COUNT_TICKS + 4 * HZ; t += 1) {
      while (toServer.length > 0 && toServer[0]!.at <= t) game.queueInput(id, [toServer.shift()!.frame]);
      game.step();
      if (firstServerMove < 0 && game.players.get(id)!.move.x !== x0) firstServerMove = game.tick;
      if (snapshotTick(game.tick)) {
        const facts = computeVisibility(game);
        aliases.update(facts.monsterSees);
        const snap = buildSnapshot(game, id, t * 33, facts, aliases);
        if (!snap) throw new Error('스냅샷 없음');
        toClient.push({ at: t + lagTicks, snap: JSON.parse(JSON.stringify(snap)) as Snapshot });
      }
      while (toClient.length > 0 && toClient[0]!.at <= t) {
        const first = last === null;
        last = toClient.shift()!.snap;
        pred.reconcile(last.you.move, last.ack, env());
        reconciles += 1;
        // 첫 스냅샷은 예측기의 처음 상태를 정한다 (보정이 아니다)
        if (!first) maxCorrection = Math.max(maxCorrection, pred.lastCorrection);
      }
      if (!last || !pred.state) continue;
      if (hold && last.world.countdown > 0) continue;
      seq += 1;
      const frame: InputFrame = { seq, mx: 1, my: 0, aim: Number.NaN, held: 0, pressed: 0 };
      pred.applyLocal(frame, env());
      if (firstClientMove < 0 && pred.state.x !== x0) firstClientMove = t;
      toServer.push({ at: t + lagTicks, frame });
    }
    return { maxCorrection, firstServerMove, firstClientMove, reconciles, moved: pred.state!.x - x0 };
  }

  for (const lag of [0, 1, 3, 6]) {
    it(`한쪽 지연 ${lag}틱: 보정 0, 내 화면은 "시작!"(0이 든 스냅샷)을 받은 틱에 움직이고 서버는 왕복 지연 뒤`, () => {
      const r = play(true, lag);
      expect(r.reconciles).toBeGreaterThan(100);
      expect(r.maxCorrection).toBe(0);
      // 내 화면: 0이 든 스냅샷(틱 90)이 도착한 바로 그 틱
      expect(r.firstClientMove).toBe(COUNT_TICKS + lag);
      // 서버: 그 입력이 도착해 처리된 틱 (왕복 지연 + 다음 틱)
      expect(r.firstServerMove).toBeGreaterThan(COUNT_TICKS);
      expect(r.firstServerMove).toBeLessThanOrEqual(COUNT_TICKS + 2 * lag + 1);
      // 실제로 걸었다 (오른쪽 벽에 닿을 때까지)
      expect(r.moved).toBeGreaterThan(1);
    });
  }

  it('카운트다운을 모르는 클라이언트(계속 보냄)는 그동안 되돌림 보정이 생긴다 — 그래서 화면이 멈춰야 한다', () => {
    const old = play(false, 1);
    expect(old.maxCorrection).toBeGreaterThan(0.1);
    // 판정은 같다: 서버에서는 카운트다운이 끝난 뒤에야 움직인다
    expect(old.firstServerMove).toBeGreaterThan(COUNT_TICKS);
  });
});
