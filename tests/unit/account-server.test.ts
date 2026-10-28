// 실제 서버 프로세스에서 계정 기능 (docs/ACCOUNT_PLAN.md 5 · 6절):
// - 기본(로그인 꺼짐): 지금과 똑같이 뜨고 계정 경로는 '꺼짐'으로만, 게임 연결은 그대로
// - 켜짐(시험 훅 · 메모리 저장소 · 가짜 구글): 로그인한 연결이 join에서 같은 계정 tag를 밝힌 친구 방 판이 끝나면 서버가 그 계정에
//   적립하고 그 계정 연결에만 credit(tag 실음), 다른 자리가 받은 메시지 원문에 계정 단서(계정 ID · tag · credit)가 없다. 쿠키가 있어도
//   tag를 밝히지 않았거나 다르면 적립하지 않는다. 삭제 페이지 전용 쿠키로 연 소켓은 계정 없음. 저장소 장애 중에도 판 결과는 그대로
//   가고 적립은 다시 시도한다
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AccountStatus, ClientMessage, Role, ServerMessage } from '@decoy/shared';
import { parseProfile } from '@decoy/shared/meta';
import { CookieJar, LOGIN_ENV, loginFlow, type AccountEndpoint } from '../helpers/accountServer';
import { startServer, type RunningServer } from '../helpers/serverProcess';

/** 받은 메시지를 모으는 WebSocket 손님 */
class Client {
  readonly inbox: ServerMessage[] = [];
  readonly raw: string[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = String(data);
      this.raw.push(text);
      this.inbox.push(JSON.parse(text) as ServerMessage);
    });
  }

  static open(port: number, headers: Record<string, string> = {}): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const c = new Client(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next<T extends ServerMessage['t']>(
    t: T,
    timeoutMs = 15_000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.inbox.find((m) => m.t === t);
      if (hit) return hit as Extract<ServerMessage, { t: T }>;
      if (Date.now() > until) throw new Error(`${t}를 받지 못함: ${this.inbox.map((m) => m.t).join(',')}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  close(): void {
    this.ws.close();
  }
}

const ROLES: Role[] = ['runner', 'monster', 'guard', 'scout'];

function join(room: string | null, account?: string): ClientMessage {
  const m: Extract<ClientMessage, { t: 'join' }> = {
    t: 'join',
    room,
    create: room === null,
    name: '',
    token: null,
    altTokens: [],
    bots: false,
  };
  if (account !== undefined) m.account = account;
  return m;
}

/**
 * 넷이 친구 방에 들어와 시작하고 시간을 끝내 결과까지. declare: 손님마다 join에 밝히는 계정 tag (화면이 계정 모드일 때 — 없으면 게스트)
 */
async function playRoom(
  clients: Client[],
  beforeEnd?: () => Promise<void>,
  declare: (string | undefined)[] = [],
): Promise<void> {
  const [host, ...rest] = clients as [Client, ...Client[]];
  host.send(join(null, declare[0]));
  const code = (await host.next('welcome')).room;
  for (const [i, c] of rest.entries()) {
    c.send(join(code, declare[i + 1]));
    await c.next('welcome');
  }
  clients.forEach((c, i) => c.send({ t: 'role', role: ROLES[i]! }));
  await new Promise((r) => setTimeout(r, 150));
  clients.forEach((c) => c.send({ t: 'ready', ready: true }));
  await new Promise((r) => setTimeout(r, 150));
  host.send({ t: 'start' });
  await Promise.all(clients.map((c) => c.next('match')));
  await beforeEnd?.();
  host.send({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } });
  await Promise.all(clients.map((c) => c.next('result')));
}

describe('실제 서버: 로그인 꺼짐 (기본)', () => {
  let srv: RunningServer;
  beforeAll(async () => {
    srv = await startServer([], { env: { DECOY_LOGIN: '', GOOGLE_CLIENT_ID: '', DECOY_SESSION_SECRET: '' } });
  });
  afterAll(() => srv.stop());

  it('시작 로그에 "계정 로그인: 꺼짐 (DECOY_LOGIN)", 계정 경로는 꺼짐으로만 답한다', async () => {
    expect(srv.output.join('')).toContain('계정 로그인: 꺼짐 (DECOY_LOGIN)');
    const base = `http://127.0.0.1:${srv.port}`;
    const st = await fetch(`${base}/api/account`);
    expect(st.status).toBe(200);
    expect(await st.json()).toEqual({ on: false });
    expect(st.headers.get('x-decoy-server')).toBe('1');
    const start = await fetch(`${base}/auth/google/start`, { redirect: 'manual' });
    expect(start.headers.get('location')).toBe('/?login=off');
    expect((await fetch(`${base}/test/accounts`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('게임 연결은 지금과 같다 (쿠키가 있어도 계정 없이)', async () => {
    const c = await Client.open(srv.port, { cookie: 'decoy_sid=v1.0123456789abcdef0123456789abcdef.1.x' });
    c.send({ t: 'ping', c: 1 });
    expect((await c.next('pong')).c).toBe(1);
    c.close();
  });
});

describe('실제 서버: 로그인 켜짐 (시험 훅 · 메모리 저장소 · 가짜 구글)', () => {
  let srv: RunningServer;
  let ep: AccountEndpoint;
  beforeAll(async () => {
    srv = await startServer(['--test-hooks', '--seed=7'], { env: { ...LOGIN_ENV } });
    const base = `http://127.0.0.1:${srv.port}`;
    ep = { base, origin: base };
  });
  afterAll(() => srv.stop());

  async function signIn(
    sub: string,
  ): Promise<{ jar: CookieJar; headers: Record<string, string>; tag: string }> {
    const jar = new CookieJar();
    const cb = await loginFlow(ep, jar, { sub });
    expect(cb.headers.get('location')).toBe('/?login=ok');
    const st = await accountStatus(jar);
    if (!st.on || !st.signedIn) throw new Error('signed in');
    return { jar, headers: { cookie: jar.header(), origin: ep.origin }, tag: st.tag };
  }

  async function accountStatus(jar: CookieJar): Promise<AccountStatus> {
    return (await (
      await fetch(`${ep.base}/api/account`, { headers: { cookie: jar.header() } })
    ).json()) as AccountStatus;
  }

  it('시작 로그: 켜짐(저장소 종류)만 — 값은 없다', () => {
    const out = srv.output.join('');
    expect(out).toContain('계정 로그인: 켜짐 (memory, 가짜 구글)');
    expect(out).not.toContain(LOGIN_ENV.DECOY_SESSION_SECRET);
    expect(out).not.toContain(LOGIN_ENV.GOOGLE_CLIENT_ID);
  });

  it('판이 끝나면 서버가 계정 tag를 밝힌 로그인한 자리에 적립하고 그 계정 연결(같은 계정의 다른 탭 포함)에만 credit(tag), 다른 자리에는 계정 단서가 없다', async () => {
    const { jar, headers, tag } = await signIn('ws-user');
    const accountId = jar.get('decoy_sid')!.split('.')[1]!;
    const a = await Client.open(srv.port, headers);
    const otherTab = await Client.open(srv.port, headers);
    const guests = await Promise.all([1, 2, 3].map(() => Client.open(srv.port)));
    try {
      await playRoom([a, ...guests], undefined, [tag]);
      // 받아들인 계정 tag는 본인 welcome에만
      expect((await a.next('welcome')).account).toBe(tag);
      for (const g of guests) expect((await g.next('welcome')).account).toBeNull();
      const credit = await a.next('credit');
      expect(credit.ok).toBe(true);
      expect(credit.tag).toBe(tag);
      const result = a.inbox.find((m) => m.t === 'result');
      expect(result && result.t === 'result' ? result.rating?.matchId : null).toBe(credit.matchId);
      // 결과를 먼저 받고 credit은 그 뒤
      expect(a.inbox.findIndex((m) => m.t === 'result')).toBeLessThan(
        a.inbox.findIndex((m) => m.t === 'credit'),
      );
      const p = parseProfile(credit.profile, Date.now()).profile;
      expect(p.played.survivor).toBe(1);
      expect(p.recent).toEqual([credit.matchId]);
      // 같은 계정의 다른 탭(방에 없음)도 받는다
      expect((await otherTab.next('credit')).matchId).toBe(credit.matchId);
      // 계정에 저장됐다 (새 브라우저에서 읽어도 같은 기록)
      const st = await accountStatus(jar);
      expect(st).toMatchObject({ signedIn: true, fresh: false, profile: credit.profile });
      // 다른 자리(괴물 포함)는 credit도, 계정 ID · tag도 받지 않는다 ("account" 칸은 자기 welcome의 null뿐)
      await new Promise((r) => setTimeout(r, 300));
      for (const g of guests) {
        expect(g.inbox.some((m) => m.t === 'credit')).toBe(false);
        const all = g.raw.join('\n');
        expect(all).not.toContain(accountId);
        expect(all).not.toContain(tag);
        expect(g.raw.filter((r) => /"account"\s*:/.test(r))).toEqual([
          expect.stringMatching(/^\{"t":"welcome".*"account":null\}$/),
        ]);
      }
      // 로그인한 사람 자신이 받은 판 메시지에도 계정 ID는 없다 (credit 말고는 계정 기록도 없다)
      expect(a.raw.join('\n')).not.toContain(accountId);
    } finally {
      for (const c of [a, otherTab, ...guests]) c.close();
    }
  });

  it('저장소 장애 중에 판이 끝나도 결과는 모두에게 그대로 가고, 적립은 다시 시도해 장애가 지나면 저장된다', async () => {
    const { jar, headers, tag } = await signIn('db-ws-user');
    const a = await Client.open(srv.port, headers);
    const guests = await Promise.all([1, 2, 3].map(() => Client.open(srv.port)));
    try {
      await playRoom(
        [a, ...guests],
        async () => {
          expect(await (await fetch(`${ep.base}/test/account-store?fail=1`)).json()).toEqual({
            failing: true,
          });
        },
        [tag],
      );
      // 판 결과는 장애와 상관없이 모두에게
      for (const c of [a, ...guests]) expect(c.inbox.some((m) => m.t === 'result')).toBe(true);
      // 장애 중 계정 요청은 503 (게스트로 계속)
      expect((await fetch(`${ep.base}/api/account`, { headers: { cookie: jar.header() } })).status).toBe(503);
      await fetch(`${ep.base}/test/account-store?fail=0`);
      const credit = await a.next('credit', 12_000);
      expect(credit.ok).toBe(true);
      expect(
        parseProfile(credit.profile, Date.now()).profile.played.monster +
          parseProfile(credit.profile, Date.now()).profile.played.survivor,
      ).toBe(1);
      expect(srv.output.join('')).not.toContain('메시지 처리 오류');
    } finally {
      await fetch(`${ep.base}/test/account-store?fail=0`);
      for (const c of [a, ...guests]) c.close();
    }
  });

  it('다른 사이트 페이지가 연 소켓에는 계정을 붙이지 않는다 (tag를 밝혀도 게스트로 받는다)', async () => {
    const { headers, tag } = await signIn('origin-user');
    const evil = await Client.open(srv.port, { ...headers, origin: 'https://evil.example' });
    const guests = await Promise.all([1, 2, 3].map(() => Client.open(srv.port)));
    try {
      await playRoom([evil, ...guests], undefined, [tag]);
      expect((await evil.next('welcome')).account).toBeNull();
      await new Promise((r) => setTimeout(r, 400));
      expect(evil.inbox.some((m) => m.t === 'credit')).toBe(false);
    } finally {
      for (const c of [evil, ...guests]) c.close();
    }
  });

  it('쿠키가 있어도 화면이 계정 tag를 밝히지 않았거나 다르면 게스트 자리 — 서버가 적립하지 않는다 (계정 기록 그대로, credit 없음)', async () => {
    const { jar, headers } = await signIn('silent-user');
    const other = await signIn('silent-other');
    const quiet = await Client.open(srv.port, headers);
    const wrong = await Client.open(srv.port, headers);
    const guests = await Promise.all([1, 2].map(() => Client.open(srv.port)));
    try {
      // quiet: 게스트 화면(밝히지 않음), wrong: 다른 계정의 tag를 밝힘 (쿠키는 silent-user)
      await playRoom([quiet, wrong, ...guests], undefined, [undefined, other.tag]);
      expect((await quiet.next('welcome')).account).toBeNull();
      expect((await wrong.next('welcome')).account).toBeNull();
      await new Promise((r) => setTimeout(r, 500));
      for (const c of [quiet, wrong]) expect(c.inbox.some((m) => m.t === 'credit')).toBe(false);
      expect(await accountStatus(jar)).toMatchObject({ signedIn: true, fresh: true, profile: null });
      expect(await accountStatus(other.jar)).toMatchObject({ signedIn: true, fresh: true, profile: null });
    } finally {
      for (const c of [quiet, wrong, ...guests]) c.close();
    }
  });

  it('삭제 페이지 전용 쿠키(decoy_del)로 연 소켓은 계정 없음 — tag를 밝혀도 게스트 자리', async () => {
    const { tag } = await signIn('del-ws-user');
    const del = new CookieJar();
    const cb = await loginFlow(ep, del, { sub: 'del-ws-user', next: 'delete' });
    expect(cb.headers.get('location')).toBe('/account/delete');
    expect(del.get('decoy_sid')).toBeUndefined();
    const value = del.get('decoy_del')!;
    for (const cookie of [`decoy_del=${value}`, `decoy_sid=${value}`]) {
      const c = await Client.open(srv.port, { cookie, origin: ep.origin });
      try {
        c.send(join(null, tag));
        expect((await c.next('welcome')).account, cookie).toBeNull();
      } finally {
        c.close();
      }
    }
  });
});
