// 계정 HTTP 경로 (docs/ACCOUNT_PLAN.md 2 · 4 · 8절): 실제 http 서버(0번 포트)에 계정 기능을 얹어 fetch로 두드린다.
// 꺼짐 상태 · 로그인 전체 흐름(start → 가짜 구글 → callback → 쿠키 → /api/account) · state · 쿠키 · 나쁜 토큰 · 취소 · CSRF ·
// 본문 크기 · 401 쿠키 지움 · DB 장애 503 · 삭제 즉시 · 삭제 뒤 적립이 계정을 다시 만들지 않음 · 삭제 페이지 · 비율 제한 ·
// 기기에서 보낸 보상 값을 받는 길이 없음
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountStatus, MatchRating } from '@decoy/shared';
import { PROGRESSION } from '@decoy/shared/meta';
import { signJwt, testKeyPair } from '../../server/src/account/testIdp';
import { StaticKeys } from '../../server/src/account/googleToken';
import { SESSION_RENEW_SEC, signSession } from '../../server/src/account/session';
import {
  CookieJar,
  LOGIN_ENV,
  TEST_SECRET,
  apiPost,
  hiddenFields,
  loginFlow,
  randomIp,
  setCookieLine,
  startAccountServer,
  type AccountTestServer,
} from '../helpers/accountServer';

const RATING: MatchRating = {
  matchId: 'ROOM.1.zz',
  role: 'monster',
  outcome: 'win',
  durationSec: 200,
  emblems: [{ id: 'hunt', tier: 2, score: 50 }],
  stats: { hits: 5 },
};

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function status(
  srv: AccountTestServer,
  jar: CookieJar,
): Promise<{ res: Response; body: AccountStatus }> {
  const res = await fetch(`${srv.base}/api/account`, { headers: { cookie: jar.header() } });
  return { res, body: (await res.json()) as AccountStatus };
}

interface Listed {
  id: string;
  sub: string;
  profile: string | null;
}

async function accounts(srv: AccountTestServer): Promise<Listed[]> {
  return json<Listed[]>(await fetch(`${srv.base}/test/accounts`));
}

async function signedIn(srv: AccountTestServer, sub: string): Promise<CookieJar> {
  const jar = new CookieJar();
  const cb = await loginFlow(srv, jar, { sub });
  expect(cb.headers.get('location')).toBe('/?login=ok');
  return jar;
}

describe('로그인 꺼짐 (기본)', () => {
  let srv: AccountTestServer;
  beforeAll(async () => {
    srv = await startAccountServer({ env: {}, testHooks: false });
  });
  afterAll(() => srv.close());

  it('GET /api/account는 200 {on:false}, 나머지 API는 404 off, 모두 no-store', async () => {
    const jar = new CookieJar();
    const { res, body } = await status(srv, jar);
    expect(res.status).toBe(200);
    expect(body).toEqual({ on: false });
    expect(res.headers.get('cache-control')).toBe('no-store');
    for (const op of ['import', 'claim-login', 'costume', 'logout', 'delete', 'nope']) {
      const r = await apiPost(srv, jar, `/api/account/${op}`, { choice: 'device', device: null });
      expect(r.status, op).toBe(404);
      expect(await r.json()).toEqual({ error: 'off' });
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(srv.system.on).toBe(false);
    expect(srv.system.summary).toBe('계정 로그인: 꺼짐 (DECOY_LOGIN)');
  });

  it('/auth/*는 /?login=off로 돌려보내고, 삭제 페이지는 "서버에 계정 기록이 없다"', async () => {
    const start = await fetch(`${srv.base}/auth/google/start`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toBe('/?login=off');
    expect(start.headers.getSetCookie()).toEqual([]);
    const cb = await fetch(`${srv.base}/auth/google/callback`, {
      method: 'POST',
      redirect: 'manual',
      body: 'id_token=x',
    });
    expect(cb.status).toBe(303);
    expect(cb.headers.get('location')).toBe('/?login=off');
    const page = await fetch(`${srv.base}/account/delete`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-state="off"');
    expect(html).toContain('서버에 계정 기록이 없습니다');
  });

  it('시험 훅 없이 /test/* 계정 훅은 404, 계정 경로가 아니면 정적 파일로 넘긴다', async () => {
    for (const p of ['/test/google/authorize', '/test/accounts', '/test/account-store?fail=1'])
      expect((await fetch(`${srv.base}${p}`)).status, p).toBe(404);
    const other = await fetch(`${srv.base}/index.html`);
    expect(other.headers.get('x-static')).toBe('1');
    const acct = await fetch(`${srv.base}/accounts`);
    expect(acct.headers.get('x-static')).toBe('1');
  });

  it('WebSocket 연결에 계정을 붙이지 않는다 (쿠키가 있어도)', () => {
    const req = { headers: { cookie: 'decoy_sid=v1.0123456789abcdef0123456789abcdef.1.x', host: 'a' } };
    expect(srv.system.accountOf(req as never)).toBeNull();
  });
});

describe('로그인 켜짐 (가짜 구글 · 메모리 저장소)', () => {
  let srv: AccountTestServer;
  beforeAll(async () => {
    srv = await startAccountServer();
  });
  afterAll(() => srv.close());

  it('전체 흐름: start → 가짜 구글 → callback → 세션 쿠키 → /api/account signedIn', async () => {
    const jar = new CookieJar();
    const start = await fetch(`${srv.base}/auth/google/start?test_sub=flow-user`, {
      redirect: 'manual',
      headers: { 'x-forwarded-for': randomIp() },
    });
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get('location')!, srv.base);
    expect(loc.pathname).toBe('/test/google/authorize');
    expect(Object.fromEntries(loc.searchParams)).toMatchObject({
      client_id: LOGIN_ENV.GOOGLE_CLIENT_ID,
      redirect_uri: `${srv.origin}/auth/google/callback`,
      response_type: 'id_token',
      response_mode: 'form_post',
      scope: 'openid',
      prompt: 'select_account',
      test_sub: 'flow-user',
    });
    const oauth = setCookieLine(start, 'decoy_oauth')!;
    expect(oauth).toMatch(/; Path=\/auth; Max-Age=600; HttpOnly; SameSite=Lax$/);
    expect(start.headers.get('cache-control')).toBe('no-store');

    const cb = await loginFlow(srv, jar, { sub: 'flow-user' });
    expect(cb.status).toBe(303);
    expect(cb.headers.get('location')).toBe('/?login=ok');
    const sid = setCookieLine(cb, 'decoy_sid')!;
    expect(sid).toMatch(
      /^decoy_sid=v1\.[0-9a-f]{32}\.\d+\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=15552000; HttpOnly; SameSite=Lax$/,
    );
    expect(setCookieLine(cb, 'decoy_oauth')).toMatch(/Max-Age=0/);
    expect(jar.get('decoy_oauth')).toBeUndefined();

    const { res, body } = await status(srv, jar);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      on: true,
      signedIn: true,
      fresh: true,
      profile: null,
      timeZone: 'Asia/Seoul',
    });
    if (!body.on || !body.signedIn) throw new Error('signed in');
    expect(body.tag).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 구글 sub · 계정 ID는 응답 · 쿠키 밖으로 (sub는 어디에도, 계정 ID는 서명된 쿠키에만)
    const listed = (await accounts(srv)).find((a) => a.sub === 'flow-user')!;
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('flow-user');
    expect(raw).not.toContain(listed.id);
    // 같은 sub로 다시 로그인하면 같은 계정
    const jar2 = await signedIn(srv, 'flow-user');
    expect(jar2.get('decoy_sid')!.split('.')[1]).toBe(listed.id);
    // 로그인 로그에 sub · 계정 ID가 없다
    const logs = srv.logs.join('\n');
    expect(logs).not.toContain('flow-user');
    expect(logs).not.toContain(listed.id);
  });

  it('next=delete로 시작하면 끝나고 삭제 페이지로', async () => {
    const jar = new CookieJar();
    const cb = await loginFlow(srv, jar, { sub: 'to-delete-page', next: 'delete' });
    expect(cb.headers.get('location')).toBe('/account/delete');
    expect(jar.get('decoy_sid')).toBeDefined();
  });

  it('state 틀림 · state 쿠키 없음 · 나쁜 토큰은 거절 (/?login=fail, 세션 없음), 구글 취소는 cancel', async () => {
    const cases: { name: string; o: Parameters<typeof loginFlow>[2]; want: string }[] = [
      { name: 'state', o: { tamper: (f) => f.set('state', 'A'.repeat(24)) }, want: 'fail' },
      { name: 'cookie', o: { dropOauthCookie: true }, want: 'fail' },
      { name: 'no-token', o: { tamper: (f) => f.delete('id_token') }, want: 'fail' },
      { name: 'expired', o: { testToken: 'expired' }, want: 'fail' },
      { name: 'badsig', o: { testToken: 'badsig' }, want: 'fail' },
      { name: 'wrongaud', o: { testToken: 'wrongaud' }, want: 'fail' },
      { name: 'nonce', o: { testToken: 'nonce' }, want: 'fail' },
      { name: 'sub', o: { sub: 'bad sub!' }, want: 'fail' },
      { name: 'cancel', o: { testError: 'access_denied' }, want: 'cancel' },
    ];
    const before = (await accounts(srv)).length;
    for (const c of cases) {
      const jar = new CookieJar();
      const cb = await loginFlow(srv, jar, { sub: `bad-${c.name}`, ...c.o });
      expect(cb.status, c.name).toBe(303);
      expect(cb.headers.get('location'), c.name).toBe(`/?login=${c.want}`);
      expect(jar.get('decoy_sid'), c.name).toBeUndefined();
    }
    expect((await accounts(srv)).length).toBe(before);
    const logs = srv.logs.join('\n');
    for (const reason of [
      'state',
      'state 쿠키 없음',
      '토큰 exp',
      '토큰 signature',
      '토큰 aud',
      '토큰 nonce',
      '토큰 sub',
    ])
      expect(logs).toContain(`로그인 실패: ${reason}`);
    // GET 콜백 (주소를 직접 연 경우)
    const get = await fetch(`${srv.base}/auth/google/callback`, { redirect: 'manual' });
    expect(get.headers.get('location')).toBe('/?login=fail');
  });

  it('POST API: 표시 헤더 · 같은 출처 Origin이 아니면 403 csrf, Origin이 없으면 헤더만으로 된다', async () => {
    const jar = await signedIn(srv, 'csrf-user');
    const noHeader = await apiPost(srv, jar, '/api/account/claim-login', {}, { 'x-decoy-account': '' });
    expect(noHeader.status).toBe(403);
    expect(await noHeader.json()).toEqual({ error: 'csrf' });
    const wrongValue = await apiPost(srv, jar, '/api/account/claim-login', {}, { 'x-decoy-account': 'yes' });
    expect(wrongValue.status).toBe(403);
    const evil = await apiPost(srv, jar, '/api/account/claim-login', {}, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const otherPort = await apiPost(
      srv,
      jar,
      '/api/account/claim-login',
      {},
      { origin: 'http://127.0.0.1:1' },
    );
    expect(otherPort.status).toBe(403);
    expect((await apiPost(srv, jar, '/api/account/claim-login', {}, { origin: 'null' })).status).toBe(403);
    // 같은 호스트면 https/http는 같은 서버로 본다 (프록시 뒤에서 x-forwarded-proto가 빠져도 거절하지 않게)
    const httpsOrigin = await apiPost(
      srv,
      jar,
      '/api/account/claim-login',
      {},
      { origin: srv.origin.replace('http:', 'https:') },
    );
    expect(httpsOrigin.status).toBe(200);
    const noOrigin = await apiPost(srv, jar, '/api/account/claim-login', {}, { origin: '' });
    expect(noOrigin.status).toBe(200);
    const sameOrigin = await apiPost(srv, jar, '/api/account/claim-login');
    expect(sameOrigin.status).toBe(200);
    // GET으로는 쓰지 못한다
    const get = await fetch(`${srv.base}/api/account/claim-login`, { headers: { cookie: jar.header() } });
    expect(get.status).toBe(405);
  });

  it('본문 상한: import 32KB · 그 밖 2KB를 넘으면 413', async () => {
    const jar = await signedIn(srv, 'size-user');
    const okImport = await apiPost(srv, jar, '/api/account/import', {
      choice: 'account',
      device: 'x'.repeat(30_000),
    });
    expect(okImport.status).toBe(200);
    const big = await apiPost(srv, jar, '/api/account/import', {
      choice: 'device',
      device: 'x'.repeat(33_000),
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'bad-request' });
    const claimBig = await apiPost(srv, jar, '/api/account/claim-login', 'x'.repeat(2049));
    expect(claimBig.status).toBe(413);
    const costumeBig = await apiPost(srv, jar, '/api/account/costume', {
      action: 'buy',
      team: 'survivor',
      id: 'scarf',
      pad: 'x'.repeat(3000),
    });
    expect(costumeBig.status).toBe(413);
    const huge = await apiPost(srv, jar, '/api/account/import', 'x'.repeat(400_000));
    expect(huge.status).toBe(413);
    // 모양이 틀린 본문은 400
    expect((await apiPost(srv, jar, '/api/account/import', '{not json')).status).toBe(400);
    expect((await apiPost(srv, jar, '/api/account/costume', { action: 'buy' })).status).toBe(400);
  });

  it('로그인 안 함 · 위조 세션 · 지운 계정은 401 auth (세션 쿠키도 지운다), 상태 읽기는 signedIn:false', async () => {
    const none = new CookieJar();
    const r1 = await apiPost(srv, none, '/api/account/claim-login');
    expect(r1.status).toBe(401);
    expect(await r1.json()).toEqual({ error: 'auth' });
    expect(setCookieLine(r1, 'decoy_sid')).toMatch(
      /^decoy_sid=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax$/,
    );
    const forged = new CookieJar();
    forged.values.set('decoy_sid', `v1.${'a'.repeat(32)}.${Math.floor(Date.now() / 1000)}.${'B'.repeat(43)}`);
    const r2 = await apiPost(srv, forged, '/api/account/import', { choice: 'device', device: null });
    expect(r2.status).toBe(401);
    expect(setCookieLine(r2, 'decoy_sid')).toMatch(/Max-Age=0/);
    const st = await status(srv, forged);
    expect(st.body).toEqual({ on: true, signedIn: false });
    expect(setCookieLine(st.res, 'decoy_sid')).toMatch(/Max-Age=0/);
    // 쿠키가 없으면 지우는 머리도 없다
    expect((await status(srv, none)).res.headers.getSetCookie()).toEqual([]);
  });

  it('기기 기록 올리기: 빈 계정은 올리고, 기록이 있으면 고른 쪽 (기기 · 계정)', async () => {
    const jar = await signedIn(srv, 'import-user');
    const device = JSON.stringify({ v: 1, xp: 120, coins: 300, played: { survivor: 2, monster: 0 } });
    const up = await apiPost(srv, jar, '/api/account/import', { choice: 'account', device });
    expect(up.status).toBe(200);
    const body = await json<{ profile: string; day: string }>(up);
    expect(JSON.parse(body.profile)).toMatchObject({ xp: 120, coins: 300 });
    const st = await status(srv, jar);
    expect(st.body).toMatchObject({ signedIn: true, fresh: false, profile: body.profile });
    const keep = await json<{ profile: string }>(
      await apiPost(srv, jar, '/api/account/import', {
        choice: 'account',
        device: JSON.stringify({ v: 1, xp: 5 }),
      }),
    );
    expect(keep.profile).toBe(body.profile);
    const replace = await json<{ profile: string }>(
      await apiPost(srv, jar, '/api/account/import', {
        choice: 'device',
        device: JSON.stringify({ v: 1, xp: 5 }),
      }),
    );
    expect(JSON.parse(replace.profile).xp).toBe(5);
  });

  it('기기에서 보낸 보상 값을 받는 길이 없다: 접속 보상 날짜 · 보상 · 의상 값 · 적립 경로', async () => {
    const jar = await signedIn(srv, 'cheat-user');
    // 접속 보상: 본문의 날짜 · 보상은 무시 (계정 날짜 + 공용 계산)
    const claim = await json<{ claimed: { reward: number; streak: number } | null; day: string }>(
      await apiPost(srv, jar, '/api/account/claim-login', { day: '2099-01-01', reward: 99_999, streak: 7 }),
    );
    expect(claim.claimed).toEqual({ reward: PROGRESSION.login.base, streak: 1 });
    expect(claim.day).not.toBe('2099-01-01');
    // 의상: 값 · 불씨를 보내도 서버의 불씨로 판단
    const buy = await json<{ result: string }>(
      await apiPost(srv, jar, '/api/account/costume', {
        action: 'buy',
        team: 'monster',
        id: 'chains',
        price: 0,
        coins: 99_999,
      }),
    );
    expect(buy.result).toBe('coins');
    // 판 보상을 적는 API는 없다 (적립은 서버가 판이 끝날 때만)
    for (const p of ['credit', 'profile', 'rating', 'save', 'reward'])
      expect(
        (await apiPost(srv, jar, `/api/account/${p}`, { profile: '{"v":1,"xp":99999}' })).status,
        p,
      ).toBe(404);
    const listed = (await accounts(srv)).find((a) => a.sub === 'cheat-user')!;
    expect(JSON.parse(listed.profile!)).toMatchObject({ xp: 0, coins: PROGRESSION.login.base });
  });

  it('DB 장애: 상태 · API는 503 db, 콜백은 /?login=db, 삭제 페이지는 db — 지나면 그대로', async () => {
    const jar = await signedIn(srv, 'db-user');
    expect(await json(await fetch(`${srv.base}/test/account-store?fail=1`))).toEqual({ failing: true });
    try {
      const st = await fetch(`${srv.base}/api/account`, { headers: { cookie: jar.header() } });
      expect(st.status).toBe(503);
      expect(await st.json()).toEqual({ error: 'db' });
      const claim = await apiPost(srv, jar, '/api/account/claim-login');
      expect(claim.status).toBe(503);
      expect(await claim.json()).toEqual({ error: 'db' });
      const cb = await loginFlow(srv, new CookieJar(), { sub: 'db-new-user' });
      expect(cb.headers.get('location')).toBe('/?login=db');
      expect(setCookieLine(cb, 'decoy_sid')).toBeUndefined();
      const page = await fetch(`${srv.base}/account/delete`, { headers: { cookie: jar.header() } });
      expect(page.status).toBe(503);
      expect(await page.text()).toContain('data-state="db"');
      // 세션이 없는 상태 읽기는 저장소 없이 답한다 (게스트 화면이 늦지 않게)
      expect((await status(srv, new CookieJar())).body).toEqual({ on: true, signedIn: false });
    } finally {
      await fetch(`${srv.base}/test/account-store?fail=0`);
    }
    expect((await status(srv, jar)).body).toMatchObject({ signedIn: true });
  });

  it('API 삭제: 계정 행을 바로 지우고 쿠키를 지운다, 그 뒤 적립은 계정을 다시 만들지 않는다', async () => {
    const jar = await signedIn(srv, 'api-delete-user');
    const id = jar.get('decoy_sid')!.split('.')[1]!;
    expect((await accounts(srv)).some((a) => a.id === id)).toBe(true);
    const old = jar.header();
    const del = await apiPost(srv, jar, '/api/account/delete');
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });
    expect(setCookieLine(del, 'decoy_sid')).toMatch(/Max-Age=0/);
    expect((await accounts(srv)).some((a) => a.id === id)).toBe(false);
    // 판이 끝나 적립이 와도 (그 자리에 계정 ID가 남아 있었다) 다시 만들지 않는다
    const credit = await srv.system.service!.credit(id, RATING);
    expect(credit.ok).toBe(false);
    expect((await accounts(srv)).some((a) => a.id === id || a.sub === 'api-delete-user')).toBe(false);
    // 옛 쿠키로는 로그인 안 한 것과 같다
    const st = await fetch(`${srv.base}/api/account`, { headers: { cookie: old } });
    expect(await st.json()).toEqual({ on: true, signedIn: false });
    const again = await fetch(`${srv.base}/api/account/delete`, {
      method: 'POST',
      headers: { cookie: old, 'x-decoy-account': '1', origin: srv.origin },
    });
    expect(await again.json()).toEqual({ deleted: false });
  });

  it('로그아웃: 세션 쿠키를 지운다 (계정 기록은 그대로)', async () => {
    const jar = await signedIn(srv, 'logout-user');
    const out = await apiPost(srv, jar, '/api/account/logout');
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect(jar.get('decoy_sid')).toBeDefined();
    jar.store(out);
    expect(jar.get('decoy_sid')).toBeUndefined();
    expect((await accounts(srv)).some((a) => a.sub === 'logout-user')).toBe(true);
  });

  it('삭제 페이지: 로그인 안 함 → 로그인 링크, 로그인함 → 레벨 · 판 수 + 폼, POST는 CSRF 값 · Origin을 본다', async () => {
    const anon = await fetch(`${srv.base}/account/delete`);
    expect(anon.status).toBe(200);
    expect(anon.headers.get('cache-control')).toBe('no-store');
    expect(anon.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const anonHtml = await anon.text();
    expect(anonHtml).toContain('data-state="signed-out"');
    expect(anonHtml).toContain('href="/auth/google/start?next=delete"');
    expect(anonHtml).not.toContain('<script');

    const jar = await signedIn(srv, 'page-delete-user');
    const id = jar.get('decoy_sid')!.split('.')[1]!;
    await srv.system.service!.credit(id, RATING);
    const page = await fetch(`${srv.base}/account/delete`, { headers: { cookie: jar.header() } });
    const html = await page.text();
    expect(html).toContain('data-state="signed-in"');
    expect(html).toContain('레벨 ');
    expect(html).toContain('한 판 <strong>1번</strong>');
    expect(html).not.toContain('page-delete-user');
    expect(html).not.toContain(id);
    const csrf = hiddenFields(html).csrf!;
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const post = (body: string, headers: Record<string, string> = {}): Promise<Response> =>
      fetch(`${srv.base}/account/delete`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: jar.header(),
          origin: srv.origin,
          ...headers,
        },
        body,
      });
    const noToken = await post('');
    expect(noToken.status).toBe(403);
    expect(await noToken.text()).toContain('data-state="retry"');
    expect((await post(`csrf=${'A'.repeat(32)}`)).status).toBe(403);
    expect((await post(`csrf=${csrf}`, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await accounts(srv)).some((a) => a.id === id)).toBe(true);
    // 다른 세션(같은 계정이라도)의 CSRF 값은 맞지 않는다
    const otherSession = signSession(id, TEST_SECRET, Date.now() - 10_000);
    expect(otherSession).not.toBe(jar.get('decoy_sid'));
    const cross = await fetch(`${srv.base}/account/delete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `decoy_sid=${otherSession}`,
        origin: srv.origin,
      },
      body: `csrf=${csrf}`,
    });
    expect(cross.status).toBe(403);
    expect((await accounts(srv)).some((a) => a.id === id)).toBe(true);

    const done = await post(`csrf=${csrf}`);
    expect(done.status).toBe(200);
    const doneHtml = await done.text();
    expect(doneHtml).toContain('data-state="deleted"');
    expect(doneHtml).toContain('계정과 서버의 성장 기록을 지웠습니다');
    expect(setCookieLine(done, 'decoy_sid')).toMatch(/Max-Age=0/);
    expect((await accounts(srv)).some((a) => a.id === id)).toBe(false);
    // 로그인 없이 POST → 로그인 안내
    const anonPost = await fetch(`${srv.base}/account/delete`, { method: 'POST', body: `csrf=${csrf}` });
    expect(anonPost.status).toBe(401);
    expect(await anonPost.text()).toContain('data-state="signed-out"');
  });
});

describe('세션 새로 발급 · HTTPS 쿠키 · 진짜 구글 주소', () => {
  it('발급 7일이 지난 세션은 상태 읽기 때 새로 발급한다', async () => {
    const clock = { now: Date.now() };
    const srv = await startAccountServer({ now: () => clock.now });
    try {
      const jar = await signedIn(srv, 'renew-user');
      const first = jar.get('decoy_sid')!;
      const st = await status(srv, jar);
      expect(st.res.headers.getSetCookie()).toEqual([]);
      clock.now += (SESSION_RENEW_SEC + 60) * 1000;
      const later = await status(srv, jar);
      expect(later.body).toMatchObject({ signedIn: true });
      jar.store(later.res);
      expect(jar.get('decoy_sid')).not.toBe(first);
      expect(jar.get('decoy_sid')!.split('.')[1]).toBe(first.split('.')[1]);
    } finally {
      await srv.close();
    }
  });

  it('진짜 구글: 인가 주소 · HTTPS면 SameSite=None; Secure 상태 쿠키 · Secure 세션, 콜백이 토큰을 검증한다', async () => {
    const keys = testKeyPair();
    const client = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
    const srv = await startAccountServer({
      env: { ...LOGIN_ENV, GOOGLE_CLIENT_ID: client, DECOY_ACCOUNT_IDP: 'google' },
      keys: new StaticKeys({ k1: keys.publicKey }),
    });
    try {
      expect(srv.system.testIdp).toBeNull();
      const https = { 'x-forwarded-proto': 'https', 'x-forwarded-for': randomIp() };
      const start = await fetch(`${srv.base}/auth/google/start`, { redirect: 'manual', headers: https });
      const loc = new URL(start.headers.get('location')!);
      expect(`${loc.origin}${loc.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      const host = new URL(srv.base).host;
      expect(Object.fromEntries(loc.searchParams)).toMatchObject({
        client_id: client,
        redirect_uri: `https://${host}/auth/google/callback`,
        response_type: 'id_token',
        response_mode: 'form_post',
        scope: 'openid',
        prompt: 'select_account',
      });
      expect(loc.searchParams.has('test_sub')).toBe(false);
      const oauth = setCookieLine(start, 'decoy_oauth')!;
      expect(oauth).toMatch(/; Path=\/auth; Max-Age=600; HttpOnly; SameSite=None; Secure$/);
      const [state, nonce] = oauth.split(';')[0]!.slice('decoy_oauth='.length).split('.');
      expect(loc.searchParams.get('state')).toBe(state);
      expect(loc.searchParams.get('nonce')).toBe(nonce);
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt(
        { alg: 'RS256', kid: 'k1' },
        {
          iss: 'https://accounts.google.com',
          aud: client,
          sub: '1122334455',
          nonce,
          iat: now,
          exp: now + 3600,
        },
        keys.privateKey,
      );
      // 구글이 보내는 다른 사이트발 POST (Origin: accounts.google.com — 콜백은 state · nonce로 지킨다)
      const cb = await fetch(`${srv.base}/auth/google/callback`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          ...https,
          origin: 'https://accounts.google.com',
          'content-type': 'application/x-www-form-urlencoded',
          cookie: oauth.split(';')[0]!,
        },
        body: new URLSearchParams({
          id_token: idToken,
          state: state!,
          authuser: '0',
          prompt: 'none',
        }).toString(),
      });
      expect(cb.headers.get('location')).toBe('/?login=ok');
      expect(setCookieLine(cb, 'decoy_sid')).toMatch(/; HttpOnly; SameSite=Lax; Secure$/);
      expect(setCookieLine(cb, 'decoy_oauth')).toMatch(/Max-Age=0; HttpOnly; SameSite=None; Secure$/);
      // 시험 키가 아닌 가짜 구글 페이지는 없다
      expect((await fetch(`${srv.base}/test/google/authorize`)).status).toBe(404);
    } finally {
      await srv.close();
    }
  });
});

describe('비율 제한', () => {
  it('IP마다 /auth/* 1분 20번, 계정마다 POST 1분 60번 → 429', async () => {
    const clock = { now: Date.now() };
    const srv = await startAccountServer({ now: () => clock.now });
    try {
      const ip = randomIp();
      const codes: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        const r = await fetch(`${srv.base}/auth/google/start`, {
          redirect: 'manual',
          headers: { 'x-forwarded-for': ip },
        });
        codes.push(r.status);
      }
      expect(codes.slice(0, 20).every((c) => c === 302)).toBe(true);
      expect(codes[20]).toBe(429);
      // 다른 IP는 따로
      expect(
        (
          await fetch(`${srv.base}/auth/google/start`, {
            redirect: 'manual',
            headers: { 'x-forwarded-for': randomIp() },
          })
        ).status,
      ).toBe(302);
      clock.now += 60_000;
      expect(
        (
          await fetch(`${srv.base}/auth/google/start`, {
            redirect: 'manual',
            headers: { 'x-forwarded-for': ip },
          })
        ).status,
      ).toBe(302);

      const jar = await signedIn(srv, 'rate-user');
      const post: number[] = [];
      for (let i = 0; i < 61; i += 1) post.push((await apiPost(srv, jar, '/api/account/claim-login')).status);
      expect(post.slice(0, 60).every((c) => c === 200)).toBe(true);
      expect(post[60]).toBe(429);
      const last = await apiPost(srv, jar, '/api/account/claim-login');
      expect(await last.json()).toEqual({ error: 'rate' });
      // 상태 읽기(GET)는 세지 않는다
      expect((await status(srv, jar)).res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });
});

describe('시험 비밀', () => {
  it('시험 도우미의 비밀은 32자 이상 (설정 검사를 통과)', () => {
    expect(TEST_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
