// 구글 ID 토큰 검증 (docs/ACCOUNT_PLAN.md 2.1): 실제 RSA 키(generateKeyPairSync)로 서명한 토큰으로 정상 · 가짜 서명 · 다른 키 ·
// alg none/HS256 · 만료 · 미래 iat · aud · iss · nonce · 모양 깨짐 · sub, 공개 키(JWKS) 캐시 · 모르는 kid 다시 받기 · 받기 실패
import { createHmac, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EXP_LEEWAY_SEC,
  GOOGLE_JWKS_URL,
  GoogleJwks,
  IAT_FUTURE_SEC,
  StaticKeys,
  maxAgeOf,
  parseJwks,
  verifyIdToken,
  type KeyProvider,
} from '../../server/src/account/googleToken';
import { TEST_TOKEN_FLAWS, TestIdp, signJwt, testKeyPair } from '../../server/src/account/testIdp';

const CLIENT = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 9, 28, 3, 0, 0);
const NOW_SEC = Math.floor(NOW / 1000);
const A = testKeyPair();
const B = testKeyPair();
const KEYS = new StaticKeys({ 'kid-a': A.publicKey });

function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    sub: '109876543210987654321',
    nonce: 'n0nce-value-1234567890',
    iat: NOW_SEC - 10,
    exp: NOW_SEC + 3590,
    ...over,
  };
}

function token(over: Record<string, unknown> = {}, key: KeyObject = A.privateKey, kid = 'kid-a'): string {
  return signJwt({ alg: 'RS256', kid, typ: 'JWT' }, claims(over), key);
}

function check(t: unknown, o: { nonce?: string; keys?: KeyProvider; now?: number; clientId?: string } = {}) {
  return verifyIdToken(t, {
    clientId: o.clientId ?? CLIENT,
    nonce: o.nonce ?? 'n0nce-value-1234567890',
    nowMs: o.now ?? NOW,
    keys: o.keys ?? KEYS,
  });
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('ID 토큰 검증', () => {
  it('정상 토큰: sub를 돌려준다 (iss 두 모양 · aud 배열)', async () => {
    expect(await check(token())).toEqual({ ok: true, sub: '109876543210987654321' });
    expect(await check(token({ iss: 'accounts.google.com' }))).toMatchObject({ ok: true });
    expect(await check(token({ aud: ['other', CLIENT] }))).toMatchObject({ ok: true });
  });

  it('가짜 서명 · 다른 키로 서명: 거절', async () => {
    // 같은 kid를 달고 다른 키(B)로 서명
    expect(await check(token({}, B.privateKey, 'kid-a'))).toEqual({ ok: false, reason: 'signature' });
    // 모르는 kid (B의 키를 공급자가 모른다)
    expect(await check(token({}, B.privateKey, 'kid-b'))).toEqual({ ok: false, reason: 'kid' });
    // 내용을 바꾼 토큰 (서명은 옛 내용)
    const [h, , s] = token().split('.');
    const forged = `${h}.${b64(claims({ sub: 'attacker' }))}.${s}`;
    expect(await check(forged)).toEqual({ ok: false, reason: 'signature' });
    // 서명 칸을 비운 토큰은 모양부터 틀리다
    expect(await check(`${h}.${b64(claims())}.`)).toEqual({ ok: false, reason: 'shape' });
  });

  it('alg none · HS256(공개 키를 HMAC 비밀로 쓰는 공격): 거절', async () => {
    const none = `${b64({ alg: 'none', kid: 'kid-a' })}.${b64(claims())}.${Buffer.from('x').toString('base64url')}`;
    expect(await check(none)).toEqual({ ok: false, reason: 'alg' });
    const pem = A.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const body = `${b64({ alg: 'HS256', kid: 'kid-a' })}.${b64(claims())}`;
    const hs = `${body}.${createHmac('sha256', pem).update(body).digest('base64url')}`;
    expect(await check(hs)).toEqual({ ok: false, reason: 'alg' });
    const noKid = signJwt({ alg: 'RS256' }, claims(), A.privateKey);
    expect(await check(noKid)).toEqual({ ok: false, reason: 'kid' });
  });

  it('만료 (60초 여유) · 미래 iat (300초 여유)', async () => {
    expect(await check(token({ exp: NOW_SEC - EXP_LEEWAY_SEC - 1 }))).toEqual({ ok: false, reason: 'exp' });
    expect(await check(token({ exp: NOW_SEC - EXP_LEEWAY_SEC + 5 }))).toMatchObject({ ok: true });
    expect(await check(token({ exp: undefined }))).toEqual({ ok: false, reason: 'exp' });
    expect(await check(token({ iat: NOW_SEC + IAT_FUTURE_SEC + 1 }))).toEqual({ ok: false, reason: 'iat' });
    expect(await check(token({ iat: NOW_SEC + IAT_FUTURE_SEC - 5 }))).toMatchObject({ ok: true });
    expect(await check(token({ iat: 'now' }))).toEqual({ ok: false, reason: 'iat' });
  });

  it('aud · iss · nonce · sub', async () => {
    expect(await check(token({ aud: 'someone-else.apps.googleusercontent.com' }))).toEqual({
      ok: false,
      reason: 'aud',
    });
    expect(await check(token({ aud: ['a', 'b'] }))).toEqual({ ok: false, reason: 'aud' });
    expect(await check(token(), { clientId: '' })).toEqual({ ok: false, reason: 'aud' });
    expect(await check(token({ iss: 'https://evil.example' }))).toEqual({ ok: false, reason: 'iss' });
    expect(await check(token({ iss: undefined }))).toEqual({ ok: false, reason: 'iss' });
    expect(await check(token(), { nonce: 'another-nonce' })).toEqual({ ok: false, reason: 'nonce' });
    expect(await check(token({ nonce: undefined }))).toEqual({ ok: false, reason: 'nonce' });
    expect(await check(token({ nonce: '' }), { nonce: '' })).toEqual({ ok: false, reason: 'nonce' });
    expect(await check(token({ sub: undefined }))).toEqual({ ok: false, reason: 'sub' });
    expect(await check(token({ sub: 'a b' }))).toEqual({ ok: false, reason: 'sub' });
    expect(await check(token({ sub: 'x'.repeat(256) }))).toEqual({ ok: false, reason: 'sub' });
    expect(await check(token({ sub: 12345 }))).toEqual({ ok: false, reason: 'sub' });
  });

  it('모양 깨짐: 조각 수 · base64url 아닌 글자 · JSON 아님 · 너무 김 · 문자열 아님', async () => {
    const good = token();
    for (const bad of [
      '',
      'abc',
      'a.b',
      `${good}.x`,
      good.replace('.', '.+'),
      'e30.e30.!!',
      `x${'a'.repeat(9000)}`,
    ])
      expect(await check(bad), bad.slice(0, 20)).toEqual({ ok: false, reason: 'shape' });
    expect(await check(`${Buffer.from('not json').toString('base64url')}.${b64(claims())}.AAAA`)).toEqual({
      ok: false,
      reason: 'shape',
    });
    expect(await check(`${b64([1, 2])}.${b64(claims())}.AAAA`)).toEqual({ ok: false, reason: 'shape' });
    expect(await check(null)).toEqual({ ok: false, reason: 'shape' });
    expect(await check(42)).toEqual({ ok: false, reason: 'shape' });
  });

  it('공개 키를 받지 못하면 검증 실패 (keys)', async () => {
    const broken: KeyProvider = { key: () => Promise.reject(new Error('network')) };
    expect(await check(token(), { keys: broken })).toEqual({ ok: false, reason: 'keys' });
  });

  it('가짜 구글(시험 훅)의 나쁜 토큰은 각각 다른 이유로 걸린다', async () => {
    const idp = new TestIdp(CLIENT);
    const opts = { keys: idp.keys, nonce: 'n-1234567890abcdef' };
    expect(await check(idp.idToken({ sub: 'u1', nonce: opts.nonce, nowMs: NOW }), opts)).toEqual({
      ok: true,
      sub: 'u1',
    });
    const want = { expired: 'exp', badsig: 'signature', wrongaud: 'aud', nonce: 'nonce' } as const;
    for (const flaw of TEST_TOKEN_FLAWS) {
      const t = idp.idToken({ sub: 'u1', nonce: opts.nonce, nowMs: NOW, flaw });
      expect(await check(t, opts), flaw).toEqual({ ok: false, reason: want[flaw] });
    }
  });
});

describe('구글 공개 키 (JWKS)', () => {
  const jwk = (k: KeyObject, kid: string): Record<string, unknown> => ({
    ...k.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig',
  });

  function fakeFetch(sets: Record<string, unknown>[][], maxAge = 3600) {
    const calls: string[] = [];
    let i = 0;
    const fn: typeof fetch = (input) => {
      calls.push(String(input));
      const keys = sets[Math.min(i, sets.length - 1)];
      i += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ keys }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': `public, max-age=${maxAge}, must-revalidate`,
          },
        }),
      );
    };
    return { fn, calls };
  }

  it('구글 주소에서 받아 max-age만큼 두고, 지나면 다시 받는다', async () => {
    let now = NOW;
    const f = fakeFetch([[jwk(A.publicKey, 'kid-a')]], 600);
    const jwks = new GoogleJwks({ fetchFn: f.fn, now: () => now });
    expect(await check(token(), { keys: jwks })).toMatchObject({ ok: true });
    expect(await check(token(), { keys: jwks })).toMatchObject({ ok: true });
    expect(f.calls).toEqual([GOOGLE_JWKS_URL]);
    now += 601_000;
    expect(await check(token(), { keys: jwks, now })).toMatchObject({ ok: true });
    expect(f.calls).toHaveLength(2);
  });

  it('모르는 kid면 한 번 다시 받는다 (키 교체), 1분 안에 또 모르는 kid면 다시 받지 않는다', async () => {
    let now = NOW;
    const f = fakeFetch([
      [jwk(A.publicKey, 'kid-a')],
      [jwk(A.publicKey, 'kid-a'), jwk(B.publicKey, 'kid-b')],
    ]);
    const jwks = new GoogleJwks({ fetchFn: f.fn, now: () => now });
    expect(await check(token(), { keys: jwks })).toMatchObject({ ok: true });
    now += 61_000;
    // 구글이 새 키(kid-b)로 서명하기 시작: 모르는 kid → 다시 받아 통과
    expect(await check(token({}, B.privateKey, 'kid-b'), { keys: jwks, now })).toMatchObject({ ok: true });
    expect(f.calls).toHaveLength(2);
    // 가짜 kid를 연달아 보내도 1분 안에는 다시 받지 않는다
    for (let i = 0; i < 5; i += 1)
      expect(await check(token({}, B.privateKey, `junk-${i}`), { keys: jwks, now })).toEqual({
        ok: false,
        reason: 'kid',
      });
    expect(f.calls).toHaveLength(2);
    now += 60_000;
    expect(await check(token({}, B.privateKey, 'junk-x'), { keys: jwks, now })).toEqual({
      ok: false,
      reason: 'kid',
    });
    expect(f.calls).toHaveLength(3);
  });

  it('받기 실패(오류 응답 · 네트워크 · 빈 키 · 시간 넘김)는 검증 실패', async () => {
    const status500: typeof fetch = () => Promise.resolve(new Response('no', { status: 500 }));
    expect(await check(token(), { keys: new GoogleJwks({ fetchFn: status500 }) })).toEqual({
      ok: false,
      reason: 'keys',
    });
    const offline: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    expect(await check(token(), { keys: new GoogleJwks({ fetchFn: offline }) })).toEqual({
      ok: false,
      reason: 'keys',
    });
    const empty = fakeFetch([[]]);
    expect(await check(token(), { keys: new GoogleJwks({ fetchFn: empty.fn }) })).toEqual({
      ok: false,
      reason: 'keys',
    });
    // 응답이 오지 않으면 제한 시간(시험은 50ms)에 끊는다
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const t0 = Date.now();
    expect(await check(token(), { keys: new GoogleJwks({ fetchFn: hang, timeoutMs: 50 }) })).toEqual({
      ok: false,
      reason: 'keys',
    });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('동시에 여러 검증이 와도 한 번만 받는다', async () => {
    const f = fakeFetch([[jwk(A.publicKey, 'kid-a')]]);
    const jwks = new GoogleJwks({ fetchFn: f.fn, now: () => NOW });
    const all = await Promise.all([1, 2, 3, 4].map(() => check(token(), { keys: jwks })));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(f.calls).toHaveLength(1);
  });

  it('JWKS 읽기: RSA 서명 키만, max-age 읽기', () => {
    const keys = parseJwks({
      keys: [
        jwk(A.publicKey, 'a'),
        { ...jwk(B.publicKey, 'enc'), use: 'enc' },
        { ...jwk(B.publicKey, 'hs'), alg: 'HS256' },
        { kty: 'EC', kid: 'ec', x: 'a', y: 'b' },
        { kty: 'RSA', kid: 'broken', n: '!!', e: 'AQAB' },
        null,
      ],
    });
    expect([...keys.keys()]).toEqual(['a']);
    expect(parseJwks(null).size).toBe(0);
    expect(parseJwks({ keys: 'x' }).size).toBe(0);
    expect(maxAgeOf('public, max-age=21600, must-revalidate')).toBe(21600);
    expect(maxAgeOf('no-store')).toBeNull();
    expect(maxAgeOf(null)).toBeNull();
  });
});
