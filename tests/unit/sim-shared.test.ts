// M13a 시뮬레이션 공유화: shared/src/sim이 브라우저에서도 묶이고(Node 전용 API 없음), 서버와 기기 안 연습이
// 같은 연결 처리 · 틱 스케줄러(ServerCore)를 쓴다
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { ESLint } from 'eslint';
import type { ClientMessage, ServerMessage } from '@decoy/shared';
import {
  MAX_CATCHUP_TICKS,
  ServerCore,
  newAliasId,
  newSeatToken,
  toBase64Url,
  toHex,
  type Conn,
} from '@decoy/shared/sim';
import { loadTestBalance } from '../helpers/fixtures';

describe('shared/src/sim은 브라우저용으로 묶인다', () => {
  it("esbuild platform 'browser'로 진입점을 묶으면 오류 · 경고 0, Node 모듈 참조 0", async () => {
    const out = await build({
      entryPoints: ['shared/src/sim/index.ts'],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      logLevel: 'silent',
    });
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
    const text = out.outputFiles[0]?.text ?? '';
    expect(text.length).toBeGreaterThan(10_000);
    expect(text).not.toMatch(/["']node:|require\(|from ["'](ws|fs)["']/);
  });

  it('eslint가 shared의 node:* · ws · fs import를 잡는다 (server는 허용)', async () => {
    const eslint = new ESLint();
    const code =
      "import { readFileSync } from 'node:fs';\nimport WebSocket from 'ws';\nimport { statSync } from 'fs';\nexport const used = [readFileSync, WebSocket, statSync];\n";
    const [shared] = await eslint.lintText(code, { filePath: 'shared/src/sim/probe.ts' });
    const hits = (shared?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
    expect(hits.map((m) => m.line)).toEqual([1, 2, 3]);
    const [server] = await eslint.lintText(code, { filePath: 'server/src/probe.ts' });
    expect((server?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
});

describe('Web Crypto 난수 문자열 (node:crypto 대체)', () => {
  it('base64url · hex 인코더가 Node Buffer와 같은 결과', () => {
    for (let n = 0; n <= 40; n += 1) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) bytes[i] = (i * 73 + n * 151 + 7) & 255;
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
      expect(toHex(bytes)).toBe(Buffer.from(bytes).toString('hex'));
    }
    const all = new Uint8Array(256).map((_, i) => i);
    expect(toBase64Url(all)).toBe(Buffer.from(all).toString('base64url'));
  });

  it('자리 토큰은 base64url 24자, 임시 ID는 s + 16진수 12자, 매번 다르다', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const t = newSeatToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{24}$/);
      tokens.add(t);
      expect(newAliasId()).toMatch(/^s[0-9a-f]{12}$/);
    }
    expect(tokens.size).toBe(200);
  });
});

class ProbeConn implements Conn {
  static next = 1;
  readonly id = ProbeConn.next++;
  readonly inbox: ServerMessage[] = [];
  closed = false;
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  types(): string[] {
    return this.inbox.map((m) => m.t);
  }
}

function newCore(clock: { t: number }): ServerCore {
  return new ServerCore({ balance: loadTestBalance(), seed: 7, testHooks: false }, {}, () => clock.t);
}

const raw = (msg: ClientMessage): string => JSON.stringify(msg);
const join = (room: string | null, token: string | null = null): string =>
  raw({ t: 'join', room, create: room === null, name: '시험', token, altTokens: [], bots: false });

describe('ServerCore 연결 처리', () => {
  it('join 전에는 ping에 바로 pong (서버 시각), 그 밖의 메시지는 무시', () => {
    const clock = { t: 1234 };
    const core = newCore(clock);
    const c = new ProbeConn();
    const link = core.connect(c, () => {});
    link.receive(raw({ t: 'ping', c: 5 }));
    link.receive(raw({ t: 'ready', ready: true }));
    link.receive('{잘못된 JSON');
    link.receive('null');
    expect(c.inbox).toEqual([{ t: 'pong', c: 5, s: 1234, build: null }]);
  });

  it('join하면 자리에 묶여 welcome · lobby를 받고, 두 번째 join은 무시', () => {
    const core = newCore({ t: 0 });
    const c = new ProbeConn();
    const link = core.connect(c, () => {});
    link.receive(join(null));
    expect(c.types()).toEqual(['welcome', 'lobby']);
    link.receive(join(null));
    expect(core.manager.rooms.size).toBe(1);
  });

  it('없는 방이면 오류를 보내고 묶지 않는다', () => {
    const core = newCore({ t: 0 });
    const c = new ProbeConn();
    const link = core.connect(c, () => {});
    link.receive(join('ZZZZ'));
    expect(c.inbox).toMatchObject([{ t: 'error', code: 'room-not-found' }]);
    link.receive(raw({ t: 'ping', c: 1 }));
    expect(c.inbox.at(-1)?.t).toBe('pong');
  });

  it('다른 연결이 자리를 넘겨받은 뒤 옛 연결의 메시지는 무시하고, 옛 연결이 닫혀도 자리를 끊지 않는다', () => {
    const core = newCore({ t: 0 });
    const a = new ProbeConn();
    const la = core.connect(a, () => {});
    la.receive(join(null));
    const welcome = a.inbox.find((m) => m.t === 'welcome');
    if (welcome?.t !== 'welcome') throw new Error('welcome 없음');
    const b = new ProbeConn();
    const lb = core.connect(b, () => {});
    lb.receive(join(welcome.room, welcome.token));
    expect(a.closed).toBe(true);
    const room = core.manager.rooms.get(welcome.room);
    const seat = room?.seats[0];
    la.receive(raw({ t: 'name', name: '옛탭' }));
    expect(seat?.name).toBe('시험');
    la.close();
    expect(seat?.conn?.id).toBe(b.id);
    lb.receive(raw({ t: 'name', name: '새탭' }));
    expect(seat?.name).toBe('새탭');
  });

  it('닫힌 뒤 도착한 메시지는 버리고, 닫히면 자리를 끊긴 상태로 (그때 시각)', () => {
    const clock = { t: 0 };
    const core = newCore(clock);
    const c = new ProbeConn();
    const link = core.connect(c, () => {});
    link.receive(join(null));
    const room = [...core.manager.rooms.values()][0];
    clock.t = 500;
    link.close();
    expect(room?.seats[0]?.conn).toBeNull();
    expect(room?.seats[0]?.droppedAt).toBe(500);
    link.receive(raw({ t: 'name', name: '유령' }));
    expect(room?.seats[0]?.name).toBe('시험');
  });

  it('메시지 처리 중 예외는 onError로 넘기고 링크는 계속 쓸 수 있다', () => {
    const core = newCore({ t: 0 });
    const c = new ProbeConn();
    const errors: unknown[] = [];
    const link = core.connect(c, (err) => errors.push(err));
    link.receive(join(null));
    const room = [...core.manager.rooms.values()][0];
    if (!room) throw new Error('방 없음');
    room.handle = () => {
      throw new Error('처리 실패');
    };
    link.receive(raw({ t: 'ready', ready: true }));
    expect(errors).toHaveLength(1);
    link.receive(raw({ t: 'ready', ready: true }));
    expect(errors).toHaveLength(2);
  });
});

/** 명목 시각은 틱 길이를 더해 가므로 부동소수 오차만 허용해 비교한다 */
function expectTimes(seen: number[], expected: number[]): void {
  expect(seen).toHaveLength(expected.length);
  seen.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? Number.NaN, 6));
}

describe('ServerCore 틱 스케줄러', () => {
  it('명목 시각(시작 + n × 틱)으로 틱을 돌리고, 한 번에 최대 5틱까지 따라잡은 뒤 밀린 시간은 버린다', () => {
    const clock = { t: 1000 };
    const core = newCore(clock);
    const seen: number[] = [];
    core.manager.tick = (now: number) => {
      seen.push(now);
    };
    const tick = core.tickMs;
    expect(core.advance(1000 + tick - 0.1)).toBe(0);
    expect(core.advance(1000 + tick)).toBe(1);
    expectTimes(seen, [1000 + tick]);
    expect(core.advance(1000 + 3.5 * tick)).toBe(2);
    expectTimes(seen.slice(1), [1000 + 2 * tick, 1000 + 3 * tick]);
    // 1초 멈췄다 돌아오면: 5틱만 돌리고 나머지는 버린다
    seen.length = 0;
    expect(core.advance(1000 + 3.5 * tick + 1000)).toBe(MAX_CATCHUP_TICKS);
    expectTimes(
      seen,
      [4, 5, 6, 7, 8].map((n) => 1000 + n * tick),
    );
    const resume = 1000 + 3.5 * tick + 1000;
    expect(core.advance(resume + tick - 0.1)).toBe(0);
    expect(core.advance(resume + tick)).toBe(1);
  });

  it('resync는 따라잡기 없이 지금부터 한 틱 뒤로 맞춘다', () => {
    const clock = { t: 0 };
    const core = newCore(clock);
    let n = 0;
    core.manager.tick = () => {
      n += 1;
    };
    core.resync(10_000);
    expect(core.advance(10_000)).toBe(0);
    expect(core.advance(10_000 + core.tickMs)).toBe(1);
    expect(n).toBe(1);
  });
});
