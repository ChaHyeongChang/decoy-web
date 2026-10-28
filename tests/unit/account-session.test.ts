// 세션 쿠키 서명 · 확인 (docs/ACCOUNT_PLAN.md 2.2) · tag · CSRF 값 · 쿠키 읽기 · 쓰기
import { describe, expect, it } from 'vitest';
import { clearCookie, readCookie, setCookie } from '../../server/src/account/cookies';
import {
  SESSION_MAX_AGE_SEC,
  SESSION_RENEW_SEC,
  accountTag,
  csrfFor,
  safeEqual,
  signSession,
  verifySession,
} from '../../server/src/account/session';
import { newAccountId } from '../../server/src/account/store';

const SECRET = 'a'.repeat(16) + 'b'.repeat(16) + 'c';
const OTHER = 'z'.repeat(40);
const ID = '0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 9, 28, 3, 0, 0);

describe('세션', () => {
  it('서명한 값은 그대로 확인되고 계정 ID를 돌려준다 (모양 v1.<id>.<초>.<서명>)', () => {
    const v = signSession(ID, SECRET, NOW);
    expect(v).toMatch(/^v1\.[0-9a-f]{32}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifySession(v, SECRET, NOW)).toEqual({
      accountId: ID,
      issuedSec: Math.floor(NOW / 1000),
      renew: false,
    });
    const id = newAccountId();
    expect(verifySession(signSession(id, SECRET, NOW), SECRET, NOW)?.accountId).toBe(id);
  });

  it('위조: 계정 ID · 발급 시각 · 서명을 바꾸거나 다른 비밀로 만든 값은 거절', () => {
    const v = signSession(ID, SECRET, NOW);
    const [ver, , iat, sig] = v.split('.');
    expect(verifySession(`${ver}.${'f'.repeat(32)}.${iat}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`${ver}.${ID}.${Number(iat) + 1000}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`${ver}.${ID}.${iat}.${'A'.repeat(43)}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`v2.${ID}.${iat}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(signSession(ID, OTHER, NOW), SECRET, NOW)).toBeNull();
    for (const bad of [null, undefined, '', 'v1', 'v1.x.y.z', `${v}.extra`, 'x'.repeat(300)])
      expect(verifySession(bad, SECRET, NOW)).toBeNull();
    // 계정 ID 모양이 아니면 (대문자 · 짧음) 서명 전에 거절
    const upper = signSession(ID.toUpperCase(), SECRET, NOW);
    expect(verifySession(upper, SECRET, NOW)).toBeNull();
  });

  it('180일이 지나면 끝, 7일이 지나면 새로 발급하라고 알린다, 미래 발급은 거절', () => {
    const v = signSession(ID, SECRET, NOW);
    expect(verifySession(v, SECRET, NOW + (SESSION_RENEW_SEC - 10) * 1000)?.renew).toBe(false);
    expect(verifySession(v, SECRET, NOW + (SESSION_RENEW_SEC + 10) * 1000)?.renew).toBe(true);
    expect(verifySession(v, SECRET, NOW + (SESSION_MAX_AGE_SEC - 10) * 1000)).not.toBeNull();
    expect(verifySession(v, SECRET, NOW + (SESSION_MAX_AGE_SEC + 10) * 1000)).toBeNull();
    expect(verifySession(signSession(ID, SECRET, NOW + 3600_000), SECRET, NOW)).toBeNull();
  });

  it('tag · CSRF 값: 비밀 · 계정 · 세션마다 다르고, 계정 ID를 드러내지 않는다', () => {
    const tag = accountTag(ID, SECRET);
    expect(tag).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(tag).toBe(accountTag(ID, SECRET));
    expect(tag).not.toBe(accountTag(ID, OTHER));
    expect(tag).not.toBe(accountTag('f'.repeat(32), SECRET));
    expect(ID).not.toContain(tag);
    const s1 = signSession(ID, SECRET, NOW);
    const s2 = signSession(ID, SECRET, NOW + 5000);
    expect(csrfFor(s1, SECRET)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(csrfFor(s1, SECRET)).not.toBe(csrfFor(s2, SECRET));
    // 쓰임마다 앞말이 달라 tag를 CSRF 값으로 쓸 수 없다
    expect(csrfFor(s1, SECRET).slice(0, 16)).not.toBe(tag);
  });

  it('시간 상수 비교: 길이가 달라도 예외 없이 false', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('쿠키', () => {
  it('읽기: 이름이 같은 첫 값, 공백 · 따옴표, 없으면 null', () => {
    expect(readCookie('a=1; decoy_sid=v1.x; b=2', 'decoy_sid')).toBe('v1.x');
    expect(readCookie('decoy_sid="q"', 'decoy_sid')).toBe('q');
    expect(readCookie('xdecoy_sid=1; decoy_sid=2', 'decoy_sid')).toBe('2');
    expect(readCookie(['a=1', 'decoy_sid=3'], 'decoy_sid')).toBe('3');
    expect(readCookie('a=1', 'decoy_sid')).toBeNull();
    expect(readCookie(undefined, 'decoy_sid')).toBeNull();
    expect(readCookie('broken', 'decoy_sid')).toBeNull();
  });

  it('쓰기: HttpOnly · SameSite · Path · Max-Age, HTTPS면 Secure, 지우기는 Max-Age=0', () => {
    expect(
      setCookie('decoy_sid', 'v1.a.1.b', { path: '/', maxAgeSec: 100, sameSite: 'Lax', secure: false }),
    ).toBe('decoy_sid=v1.a.1.b; Path=/; Max-Age=100; HttpOnly; SameSite=Lax');
    expect(
      setCookie('decoy_oauth', 's.n.home', { path: '/auth', maxAgeSec: 600, sameSite: 'None', secure: true }),
    ).toBe('decoy_oauth=s.n.home; Path=/auth; Max-Age=600; HttpOnly; SameSite=None; Secure');
    expect(clearCookie('decoy_sid', { path: '/', sameSite: 'Lax', secure: true })).toBe(
      'decoy_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
    );
    // 머리 주입이 될 글자는 받지 않는다
    expect(() =>
      setCookie('a', 'x; Domain=evil', { path: '/', maxAgeSec: 1, sameSite: 'Lax', secure: false }),
    ).toThrow();
    expect(() =>
      setCookie('a b', 'x', { path: '/', maxAgeSec: 1, sameSite: 'Lax', secure: false }),
    ).toThrow();
  });
});
