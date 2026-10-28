// 세션 쿠키 서명 · 확인 (docs/ACCOUNT_PLAN.md 2.2): decoy_sid = v2.<계정ID>.<발급 초>.<로그인 초>.<HMAC-SHA256(비밀, 앞 네 칸) base64url>.
// DB 없이 서명만으로 확인한다(DB가 죽어도 WebSocket 연결이 늦어지지 않게). 구글 sub는 쿠키에 들지 않는다 — 계정 ID는 무작위 값.
// 로그인 초는 구글 로그인을 마친 때로, 7일마다 새로 발급해도 그대로 둔다(기기 기록 올리기는 로그인 뒤 10분 안만 — routes.ts).
// 삭제 페이지 전용 값(decoy_del)은 d1.<계정ID>.<발급 초>.<서명>, 10분 — 앞말이 달라 서로 바꿔 쓸 수 없다.
// tag · CSRF 값도 같은 비밀에서 만든다(쓰임마다 앞말을 달리해 서로 바꿔 쓸 수 없게)
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isAccountId } from './store';

/** 세션 수명: 180일 */
export const SESSION_MAX_AGE_SEC = 180 * 86_400;
/** 발급 7일이 지나면 GET /api/account 때 새로 발급한다 (쓰는 동안 끝나지 않게) */
export const SESSION_RENEW_SEC = 7 * 86_400;
/** 삭제 페이지 전용 값의 수명: 10분 */
export const DELETE_SESSION_MAX_AGE_SEC = 600;
/** 기기 기록 올리기(import에 기기 글)를 받는 로그인 뒤 시간: 10분 */
export const IMPORT_WINDOW_SEC = 600;
/** 발급 시각이 이만큼 넘게 미래인 세션은 받지 않는다 (서버 시계 어긋남 여유) */
const FUTURE_LEEWAY_SEC = 300;
const VERSION = 'v2';
const DELETE_VERSION = 'd1';
const SIG = /^[A-Za-z0-9_-]{43}$/;
const SECONDS = /^\d{1,12}$/;

function hmac(secret: string, text: string): string {
  return createHmac('sha256', secret).update(text).digest('base64url');
}

/** 같은 길이 글을 시간 상수로 비교 (길이가 다르면 false) */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const sec = (ms: number): number => Math.floor(ms / 1000);

/** 서명한 값 하나: 앞말 · 칸들 · 서명 */
function sign(version: string, fields: readonly (string | number)[], secret: string): string {
  const body = [version, ...fields].join('.');
  return `${body}.${hmac(secret, body)}`;
}

/**
 * 서명한 값을 읽는다: 앞말이 version이고 칸 수가 맞고(계정 ID + 초 칸 n개) 서명이 맞으면 [계정 ID, 초...]. 아니면 null
 */
function readSigned(
  value: unknown,
  version: string,
  secs: number,
  secret: string,
): [string, ...number[]] | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  const parts = value.split('.');
  if (parts.length !== secs + 3 || parts[0] !== version) return null;
  const id = parts[1] ?? '';
  const nums = parts.slice(2, -1);
  const sig = parts.at(-1) ?? '';
  if (!isAccountId(id) || !nums.every((n) => SECONDS.test(n)) || !SIG.test(sig)) return null;
  if (!safeEqual(sig, hmac(secret, parts.slice(0, -1).join('.')))) return null;
  return [id, ...nums.map(Number)];
}

/** 새 세션 값. loginMs = 구글 로그인을 마친 때 (새로 발급할 때는 처음 로그인 때를 그대로 넘긴다) */
export function signSession(accountId: string, secret: string, nowMs: number, loginMs = nowMs): string {
  return sign(VERSION, [accountId, sec(nowMs), sec(loginMs)], secret);
}

export interface SessionInfo {
  accountId: string;
  /** 발급 시각 (초) */
  issuedSec: number;
  /** 구글 로그인을 마친 시각 (초, 새로 발급해도 그대로) */
  loginSec: number;
  /** 새로 발급할 때가 됐다 (7일 넘음) */
  renew: boolean;
}

/** 세션 값 확인: 모양 · 서명 · 수명. 아니면 null */
export function verifySession(
  value: string | null | undefined,
  secret: string,
  nowMs: number,
): SessionInfo | null {
  const v = readSigned(value, VERSION, 2, secret);
  if (!v) return null;
  const [accountId, issuedSec = 0, loginSec = 0] = v;
  const age = nowMs / 1000 - issuedSec;
  if (age > SESSION_MAX_AGE_SEC || age < -FUTURE_LEEWAY_SEC || loginSec > issuedSec) return null;
  return { accountId, issuedSec, loginSec, renew: age > SESSION_RENEW_SEC };
}

/** 삭제 페이지 전용 값 (decoy_del, 10분): 게임 세션으로는 쓰지 못한다 */
export function signDeleteSession(accountId: string, secret: string, nowMs: number): string {
  return sign(DELETE_VERSION, [accountId, sec(nowMs)], secret);
}

/** 삭제 페이지 전용 값 확인 (10분 안). 아니면 null */
export function verifyDeleteSession(
  value: string | null | undefined,
  secret: string,
  nowMs: number,
): { accountId: string } | null {
  const v = readSigned(value, DELETE_VERSION, 1, secret);
  if (!v) return null;
  const age = nowMs / 1000 - (v[1] ?? 0);
  return age > DELETE_SESSION_MAX_AGE_SEC || age < -FUTURE_LEEWAY_SEC ? null : { accountId: v[0] };
}

/** 이 기기 표시 tag: HMAC(비밀, 'tag:' + 계정ID) 앞 16자 — 계정 ID · 구글 ID를 드러내지 않는 불투명한 값 */
export function accountTag(accountId: string, secret: string): string {
  return hmac(secret, `tag:${accountId}`).slice(0, 16);
}

/** 삭제 페이지 폼의 CSRF 값: 쿠키 값(세션 · 삭제 전용)에서 만든다 (값이 바뀌면 바뀐다) */
export function csrfFor(sessionValue: string, secret: string): string {
  return hmac(secret, `csrf:${sessionValue}`).slice(0, 32);
}
