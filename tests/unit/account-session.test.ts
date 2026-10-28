// 세션 쿠키 서명 · 확인 (docs/ACCOUNT_PLAN.md 2.2) · 로그인 때(새로 발급해도 그대로) · 삭제 페이지 전용 값 · tag · CSRF 값 · 쿠키 읽기 · 쓰기
import { describe, expect, it } from 'vitest';
import { clearCookie, readCookie, setCookie } from '../../server/src/account/cookies';
import {
  DELETE_SESSION_MAX_AGE_SEC,
  SESSION_MAX_AGE_SEC,
  SESSION_RENEW_SEC,
  accountTag,
  csrfFor,
  safeEqual,
  signDeleteSession,
  signSession,
  verifyDeleteSession,
  verifySession,
} from '../../server/src/account/session';
import { newAccountId } from '../../server/src/account/store';

const SECRET = 'a'.repeat(16) + 'b'.repeat(16) + 'c';
const OTHER = 'z'.repeat(40);
const ID = '0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 9, 28, 3, 0, 0);

describe('세션', () => {
  it('서명한 값은 그대로 확인되고 계정 ID · 발급 · 로그인 때를 돌려준다 (모양 v2.<id>.<발급 초>.<로그인 초>.<서명>)', () => {
    const v = signSession(ID, SECRET, NOW);
    expect(v).toMatch(/^v2\.[0-9a-f]{32}\.\d+\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifySession(v, SECRET, NOW)).toEqual({
      accountId: ID,
      issuedSec: Math.floor(NOW / 1000),
      loginSec: Math.floor(NOW / 1000),
      renew: false,
    });
    const id = newAccountId();
    expect(verifySession(signSession(id, SECRET, NOW), SECRET, NOW)?.accountId).toBe(id);
  });

  it('위조: 계정 ID · 발급 시각 · 로그인 시각 · 서명을 바꾸거나 다른 비밀로 만든 값 · 옛 모양(v1)은 거절', () => {
    const v = signSession(ID, SECRET, NOW);
    const [ver, , iat, login, sig] = v.split('.');
    expect(verifySession(`${ver}.${'f'.repeat(32)}.${iat}.${login}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`${ver}.${ID}.${Number(iat) + 1000}.${login}.${sig}`, SECRET, NOW)).toBeNull();
    // 로그인 시각만 늦춰 기기 기록 올리기 10분 창을 다시 열 수 없다
    expect(verifySession(`${ver}.${ID}.${iat}.${Number(login) + 60}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`${ver}.${ID}.${iat}.${login}.${'A'.repeat(43)}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`v1.${ID}.${iat}.${login}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`v1.${ID}.${iat}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(signSession(ID, OTHER, NOW), SECRET, NOW)).toBeNull();
    for (const bad of [null, undefined, '', 'v2', 'v2.x.y.z.w', `${v}.extra`, 'x'.repeat(300)])
      expect(verifySession(bad, SECRET, NOW)).toBeNull();
    // 계정 ID 모양이 아니면 (대문자 · 짧음) 서명 전에 거절
    const upper = signSession(ID.toUpperCase(), SECRET, NOW);
    expect(verifySession(upper, SECRET, NOW)).toBeNull();
  });

  it('새로 발급해도 로그인 때는 그대로 (넘겨준 값), 로그인이 발급보다 늦은 값은 서명이 맞아도 거절', () => {
    const login = NOW - 30 * 86_400_000;
    const renewed = signSession(ID, SECRET, NOW, login);
    expect(verifySession(renewed, SECRET, NOW)).toEqual({
      accountId: ID,
      issuedSec: Math.floor(NOW / 1000),
      loginSec: Math.floor(login / 1000),
      renew: false,
    });
    expect(verifySession(signSession(ID, SECRET, NOW, NOW + 5000), SECRET, NOW)).toBeNull();
  });

  it('삭제 페이지 전용 값(d1): 10분만, 게임 세션과 서로 바꿔 쓸 수 없다', () => {
    const d = signDeleteSession(ID, SECRET, NOW);
    expect(d).toMatch(/^d1\.[0-9a-f]{32}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyDeleteSession(d, SECRET, NOW)).toEqual({ accountId: ID });
    expect(verifyDeleteSession(d, SECRET, NOW + (DELETE_SESSION_MAX_AGE_SEC - 5) * 1000)).not.toBeNull();
    expect(verifyDeleteSession(d, SECRET, NOW + (DELETE_SESSION_MAX_AGE_SEC + 5) * 1000)).toBeNull();
    expect(verifyDeleteSession(signDeleteSession(ID, SECRET, NOW + 3600_000), SECRET, NOW)).toBeNull();
    expect(verifyDeleteSession(d, OTHER, NOW)).toBeNull();
    // 앞말만 바꿔도 서명이 맞지 않는다: 삭제 전용 값은 게임 세션이 아니고, 게임 세션도 삭제 전용 값이 아니다
    expect(verifySession(d, SECRET, NOW)).toBeNull();
    const [, id, iat, sig] = d.split('.');
    expect(verifySession(`v2.${id}.${iat}.${iat}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyDeleteSession(signSession(ID, SECRET, NOW), SECRET, NOW)).toBeNull();
    const s = signSession(ID, SECRET, NOW).split('.');
    expect(verifyDeleteSession(`d1.${s[1]}.${s[2]}.${s[4]}`, SECRET, NOW)).toBeNull();
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
