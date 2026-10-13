// M13b 계약: 같은 프로세스 봇(BotDriver), 기기 안 연습 방(practice), 나가기('leave')
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  PRACTICE_ROOM_PREFIX,
  ROOM_CODE_ALPHABET,
  type ClientMessage,
  type Role,
  type Snapshot,
} from '@decoy/shared';
import {
  BotDriver,
  ServerCore,
  computeVisibility,
  devBotBrain,
  practiceBrain,
  type BotBrain,
  type Room,
  type RoomHooks,
} from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const raw = (msg: ClientMessage): string => JSON.stringify(msg);

function practiceCore(brain: (role: Role) => BotBrain = devBotBrain): {
  core: ServerCore;
  driver: BotDriver;
  clock: { t: number };
} {
  const clock = { t: 0 };
  const driver = new BotDriver((info) => brain(info.role), balance);
  const hooks: RoomHooks = { ...driver.hooks() };
  const core = new ServerCore({ balance, seed: 9, testHooks: true, practice: true }, hooks, () => clock.t);
  return { core, driver, clock };
}

/** 연습 방에 들어가 역할을 고르고 시작한다 (클라이언트가 보내는 순서 그대로) */
function startPractice(
  core: ServerCore,
  role: Role,
): { conn: FakeConn; link: ReturnType<ServerCore['connect']>; room: Room } {
  const conn = new FakeConn();
  const link = core.connect(conn, (err) => {
    throw err;
  });
  link.receive(
    raw({ t: 'join', room: null, create: true, name: '나', token: null, altTokens: [], bots: true }),
  );
  link.receive(raw({ t: 'role', role }));
  link.receive(raw({ t: 'ready', ready: true }));
  link.receive(raw({ t: 'start' }));
  const room = [...core.manager.rooms.values()][0];
  if (!room) throw new Error('방 없음');
  return { conn, link, room };
}

function runTicks(core: ServerCore, clock: { t: number }, n: number): void {
  for (let i = 0; i < n; i += 1) {
    clock.t += core.tickMs;
    core.advance(clock.t);
  }
}

describe('기기 안 연습 방', () => {
  it('연습 방 코드는 P- 접두 + 4글자라 서버 방 코드와 겹치지 않고, 종류가 practice다', () => {
    const { core } = practiceCore();
    const { room, conn } = startPractice(core, 'runner');
    expect(room.code.startsWith(PRACTICE_ROOM_PREFIX)).toBe(true);
    expect(room.code.slice(2)).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{4}$`));
    expect(room.kind).toBe('practice');
    expect(conn.last('lobby')?.lobby.kind).toBe('practice');
    expect(conn.last('lobby')?.lobby.autoStartAt).toBeNull();
  });

  it('역할을 고르고 시작하면 빈자리 셋을 봇이 채우고 판이 시작된다', () => {
    const { core, driver } = practiceCore();
    const { room, conn } = startPractice(core, 'guard');
    expect(room.phase).toBe('playing');
    expect(conn.last('match')?.info.role).toBe('guard');
    const roles = room.seats.map((s) => s.role).sort();
    expect(roles).toEqual(['guard', 'monster', 'runner', 'scout']);
    expect(room.seats.filter((s) => s.bot)).toHaveLength(3);
    expect(driver.botsOf(room)).toHaveLength(3);
    // 봇 자리에는 같은 프로세스 연결이 붙어 'match'를 받았다
    for (const b of driver.botsOf(room)) {
      expect(b.seat.conn).toBe(b);
      expect(b.info?.role).toBe(b.seat.role);
    }
  });

  it('봇 자리마다 틱당 입력이 정확히 하나 (굶주림 0)', () => {
    const { core, driver, clock } = practiceCore();
    const { room } = startPractice(core, 'runner');
    const game = room.game;
    if (!game) throw new Error('판 없음');
    const bots = driver.botsOf(room);
    for (let t = 1; t <= 300; t += 1) {
      runTicks(core, clock, 1);
      for (const b of bots) {
        expect(b.inputs).toBe(t);
        const p = game.players.get(b.seat.id);
        expect(p?.starved).toBe(0);
        expect(p?.debt).toBe(0);
        expect(p?.ack).toBe(t);
      }
    }
  });

  it('봇은 자기 자리에 온 스냅샷만 받는다 (괴물 봇은 시야 밖 생존자를 받지 않음 — interest.ts 그대로)', () => {
    const { core, driver, clock } = practiceCore();
    const { room } = startPractice(core, 'runner');
    const monsterBot = driver.botsOf(room).find((b) => b.seat.role === 'monster');
    let prev = monsterBot?.lastSnap;
    let checked = 0;
    for (let t = 0; t < 600 && room.phase === 'playing'; t += 1) {
      runTicks(core, clock, 1);
      const snap = monsterBot?.lastSnap;
      if (!snap || snap === prev) continue;
      prev = snap;
      expect(snap.you.role).toBe('monster');
      for (const s of snap.survivors) {
        // 괴물 스냅샷의 생존자 ID는 임시 ID다 (실제 자리 ID가 아니다)
        expect(room.seats.some((seat) => seat.id === s.id)).toBe(false);
        checked += 1;
      }
    }
    // 검사가 헛돌지 않게: 괴물 봇이 생존자를 실제로 본 스냅샷이 있었다 (60틱만 보던 옛 시험은 0명이었다)
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  // 출시 전 검토: 실서비스 봇 경로(빠른 매칭 · 기기 안 연습의 BotDriver → 실전 두뇌)의 정보 차단. SimMatch 경로 시험
  // (tests/bots/practice.test.ts)과 달리, 두뇌가 실제로 받는 입력이 그 봇 자리에 온 정보 차단 스냅샷인지 본다
  it('실전 두뇌가 받는 view는 그 자리에 온 스냅샷 그대로(내 위치 예측만 다름)이고, 괴물 봇의 생존자는 그 틱 괴물 시야 안이다', () => {
    const clock = { t: 0 };
    /** 틱 → 그 틱 괴물 시야 안 실제 생존자 위치 (recordTruth: step 직후 · 스냅샷 직전, 스냅샷과 같은 판정) */
    const truth = new Map<number, { x: number; y: number }[]>();
    const stats = { decide: 0, mismatch: 0, monsterSurvivors: 0, leaks: 0 };
    const problems: string[] = [];
    const withoutMove = (s: Snapshot): unknown => ({ ...s, you: { ...s.you, move: null } });
    const driver: BotDriver = new BotDriver((info, seat, room) => {
      const inner = practiceBrain(info.role, 7);
      return {
        decide(view, matchInfo, bal, seq) {
          stats.decide += 1;
          const own = driver.botsOf(room).find((b) => b.seat === seat)?.lastSnap;
          if (!own || !isDeepStrictEqual(withoutMove(view), withoutMove(own))) {
            stats.mismatch += 1;
            if (problems.length < 3) problems.push(`${seat.role} tick ${view.tick}: 자리 스냅샷과 다름`);
          }
          if (view.you.role === 'monster') {
            const seen = truth.get(view.tick) ?? [];
            for (const s of view.survivors) {
              stats.monsterSurvivors += 1;
              if (seen.some((p) => Math.abs(p.x - s.x) <= 6e-4 && Math.abs(p.y - s.y) <= 6e-4)) continue;
              stats.leaks += 1;
              if (problems.length < 3)
                problems.push(`괴물 tick ${view.tick}: 시야 밖 생존자 (${s.x}, ${s.y})`);
            }
          }
          return inner.decide(view, matchInfo, bal, seq);
        },
      };
    }, balance);
    const hooks: RoomHooks = {
      ...driver.hooks(),
      recordTruth: (room) => {
        const game = room.game;
        if (!game) return;
        const facts = computeVisibility(game);
        truth.set(
          game.tick,
          game.survivors
            .filter((s) => facts.monsterSees.has(s.id))
            .map((s) => ({ x: s.move.x, y: s.move.y })),
        );
      },
    };
    const core = new ServerCore({ balance, seed: 9, testHooks: true, practice: true }, hooks, () => clock.t);
    const { room } = startPractice(core, 'scout');
    expect(driver.botsOf(room)).toHaveLength(3);
    for (let t = 0; t < 4500 && room.phase === 'playing'; t += 1) runTicks(core, clock, 1);
    expect(problems).toEqual([]);
    expect(stats.mismatch).toBe(0);
    expect(stats.leaks).toBe(0);
    // 검사가 헛돌지 않게: 봇 셋이 많이 결정했고, 괴물 봇이 생존자를 실제로 많이 봤다
    expect(stats.decide).toBeGreaterThan(1000);
    expect(stats.monsterSurvivors).toBeGreaterThan(30);
  });

  it('결과에서 다시 하기를 누르면 같은 역할로 바로 다음 판, 봇 연결은 정리하고 새로 붙인다', () => {
    const { core, driver, clock } = practiceCore();
    const { room, link, conn } = startPractice(core, 'scout');
    const first = driver.botsOf(room);
    link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
    runTicks(core, clock, 5);
    expect(room.phase).toBe('result');
    link.receive(raw({ t: 'rematch' }));
    expect(room.phase).toBe('playing');
    expect(conn.count('match')).toBe(2);
    expect(conn.last('match')?.info.role).toBe('scout');
    for (const b of first) expect(b.closed).toBe(true);
    runTicks(core, clock, 2);
    const second = driver.botsOf(room);
    expect(second).toHaveLength(3);
    for (const b of second) expect(first).not.toContain(b);
  });

  it('시험 명령 setTime의 elapsed는 결과의 판 길이를 바꾼다 (없으면 실제로 흐른 시간)', () => {
    const { core, clock } = practiceCore();
    const { link, conn } = startPractice(core, 'guard');
    link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05, elapsed: 512.4 } }));
    runTicks(core, clock, 5);
    expect(conn.last('result')?.result.durationSec).toBe(512);
    link.receive(raw({ t: 'rematch' }));
    runTicks(core, clock, 30);
    link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
    runTicks(core, clock, 5);
    expect(conn.last('result')?.result.durationSec).toBe(1);
  });
});

describe('나가기 (leave)', () => {
  function codeRoom(): { core: ServerCore; links: ReturnType<ServerCore['connect']>[]; conns: FakeConn[] } {
    const core = new ServerCore({ balance, seed: 4, testHooks: false }, {}, () => 0);
    const conns = [new FakeConn(), new FakeConn()];
    const links = conns.map((c) => core.connect(c, () => {}));
    links[0]?.receive(
      raw({ t: 'join', room: null, create: true, name: '방장', token: null, altTokens: [], bots: false }),
    );
    const room = [...core.manager.rooms.values()][0];
    links[1]?.receive(
      raw({
        t: 'join',
        room: room?.code ?? '',
        create: false,
        name: '손님',
        token: null,
        altTokens: [],
        bots: false,
      }),
    );
    return { core, links, conns };
  }

  it('로비에서 나가면 자리가 지워지고 방장이 넘어가며, 같은 연결로 다른 방을 만들 수 있다', () => {
    const { core, links, conns } = codeRoom();
    const room = [...core.manager.rooms.values()][0];
    if (!room) throw new Error('방 없음');
    expect(room.seats).toHaveLength(2);
    const hostId = room.hostId;
    links[0]?.receive(raw({ t: 'leave' }));
    expect(room.seats).toHaveLength(1);
    expect(room.hostId).not.toBe(hostId);
    expect(room.hostId).toBe(room.seats[0]?.id);
    expect(conns[1]?.last('lobby')?.lobby.players).toHaveLength(1);
    // 풀린 연결: 이제 방 메시지는 무시하고, join이 다시 된다
    links[0]?.receive(raw({ t: 'ready', ready: true }));
    links[0]?.receive(
      raw({ t: 'join', room: null, create: true, name: '방장', token: null, altTokens: [], bots: false }),
    );
    expect(core.manager.rooms.size).toBe(2);
  });

  it('판 중에 나가면 끊김과 같다 (자리는 남고 유예를 센다)', () => {
    const { core, driver, clock } = practiceCore();
    const { room, link } = startPractice(core, 'runner');
    void driver;
    const me = room.seats.find((s) => !s.bot);
    link.receive(raw({ t: 'leave' }));
    expect(room.seats).toContain(me);
    expect(me?.conn).toBeNull();
    expect(room.game?.players.get(me?.id ?? '')?.connected).toBe(false);
    runTicks(core, clock, 3);
    expect(room.phase).toBe('playing');
  });
});
