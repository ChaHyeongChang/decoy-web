// 세션 쿠키 서명 · 확인 (docs/ACCOUNT_PLAN.md 2.2): decoy_sid = v1.<계정ID>.<발급 초>.<HMAC-SHA256(비밀, 앞 세 칸) base64url>.
// DB 없이 서명만으로 확인한다(DB가 죽어도 WebSocket 연결이 늦어지지 않게). 구글 sub는 쿠키에 들지 않는다 — 계정 ID는 무작위 값.
// tag · CSRF 값도 같은 비밀에서 만든다(쓰임마다 앞말을 달리해 서로 바꿔 쓸 수 없게)
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isAccountId } from './store';

/** 세션 수명: 180일 */
export const SESSION_MAX_AGE_SEC = 180 * 86_400;
/** 발급 7일이 지나면 GET /api/account 때 새로 발급한다 (쓰는 동안 끝나지 않게) */
export const SESSION_RENEW_SEC = 7 * 86_400;
/** 발급 시각이 이만큼 넘게 미래인 세션은 받지 않는다 (서버 시계 어긋남 여유) */
const FUTURE_LEEWAY_SEC = 300;
const VERSION = 'v1';
const SIG = /^[A-Za-z0-9_-]{43}$/;

function hmac(secret: string, text: string): string {
  return createHmac('sha256', secret).update(text).digest('base64url');
}

/** 같은 길이 글을 시간 상수로 비교 (길이가 다르면 false) */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 새 세션 값 */
export function signSession(accountId: string, secret: string, nowMs: number): string {
  const body = `${VERSION}.${accountId}.${Math.floor(nowMs / 1000)}`;
  return `${body}.${hmac(secret, body)}`;
}

export interface SessionInfo {
  accountId: string;
  /** 발급 시각 (초) */
  issuedSec: number;
  /** 새로 발급할 때가 됐다 (7일 넘음) */
  renew: boolean;
}

/** 세션 값 확인: 모양 · 서명 · 수명. 아니면 null */
export function verifySession(
  value: string | null | undefined,
  secret: string,
  nowMs: number,
): SessionInfo | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [ver, id, iatText, sig] = parts as [string, string, string, string];
  if (ver !== VERSION || !isAccountId(id) || !/^\d{1,12}$/.test(iatText) || !SIG.test(sig)) return null;
  if (!safeEqual(sig, hmac(secret, `${ver}.${id}.${iatText}`))) return null;
  const issuedSec = Number(iatText);
  const age = nowMs / 1000 - issuedSec;
  if (age > SESSION_MAX_AGE_SEC || age < -FUTURE_LEEWAY_SEC) return null;
  return { accountId: id, issuedSec, renew: age > SESSION_RENEW_SEC };
}

/** 이 기기 표시 tag: HMAC(비밀, 'tag:' + 계정ID) 앞 16자 — 계정 ID · 구글 ID를 드러내지 않는 불투명한 값 */
export function accountTag(accountId: string, secret: string): string {
  return hmac(secret, `tag:${accountId}`).slice(0, 16);
}

/** 삭제 페이지 폼의 CSRF 값: 세션 값에서 만든다 (세션이 바뀌면 바뀐다) */
export function csrfFor(sessionValue: string, secret: string): string {
  return hmac(secret, `csrf:${sessionValue}`).slice(0, 32);
}
