// 구글 ID 토큰 검증 (docs/ACCOUNT_PLAN.md 2.1). 의존성 없이 node:crypto만 쓴다.
// 순서: 모양(JWT 세 조각 · base64url · JSON) → 헤더(alg RS256만, kid 필수) → 공개 키(kid) → 서명 RSA-SHA256 → 클레임
// (iss · aud · exp · iat · nonce · sub). 실패 이유는 종류만 돌려준다 — 부르는 쪽은 토큰 · sub를 로그에 찍지 않는다
import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';

export const GOOGLE_ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com'];
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** 만료(exp)는 이만큼 늦어도 받는다 (서버 시계 어긋남) */
export const EXP_LEEWAY_SEC = 60;
/** 발급(iat)이 이만큼 넘게 미래면 거절한다 */
export const IAT_FUTURE_SEC = 300;
/** 토큰 길이 상한 (구글 ID 토큰은 1~2KB) */
const TOKEN_MAX = 8192;
const B64URL = /^[A-Za-z0-9_-]+$/;
const SUB = /^[0-9A-Za-z_-]{1,255}$/;
const MIN_RSA_BITS = 2048;

export type TokenFailReason =
  /** JWT 모양이 아니다 */
  | 'shape'
  /** RS256이 아니다 (none · HS256 등) */
  | 'alg'
  /** kid가 없거나 모르는 키다 */
  | 'kid'
  /** 공개 키를 받지 못했다 */
  | 'keys'
  | 'signature'
  | 'iss'
  | 'aud'
  | 'exp'
  | 'iat'
  | 'nonce'
  | 'sub';

export type TokenCheck = { ok: true; sub: string } | { ok: false; reason: TokenFailReason };

/** 공개 키 공급자: kid → 키 (모르면 null). 받지 못하면 예외 — 검증 실패('keys')로 친다 */
export interface KeyProvider {
  key(kid: string): Promise<KeyObject | null>;
}

/** 고정 키 공급자 (시험 · 가짜 구글) */
export class StaticKeys implements KeyProvider {
  private readonly keys: Map<string, KeyObject>;
  constructor(keys: Readonly<Record<string, KeyObject>>) {
    this.keys = new Map(Object.entries(keys));
  }
  key(kid: string): Promise<KeyObject | null> {
    return Promise.resolve(this.keys.get(kid) ?? null);
  }
}

/** JWKS 글 → kid별 RSA 공개 키 (RS256 서명용이 아닌 키 · 깨진 키는 건너뛴다) */
export function parseJwks(raw: unknown): Map<string, KeyObject> {
  const out = new Map<string, KeyObject>();
  if (typeof raw !== 'object' || raw === null) return out;
  const keys = (raw as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return out;
  for (const k of keys) {
    if (typeof k !== 'object' || k === null) continue;
    const o = k as Record<string, unknown>;
    if (o.kty !== 'RSA' || typeof o.kid !== 'string' || o.kid === '') continue;
    if (typeof o.n !== 'string' || typeof o.e !== 'string' || !B64URL.test(o.n) || !B64URL.test(o.e))
      continue;
    if (o.alg !== undefined && o.alg !== 'RS256') continue;
    if (o.use !== undefined && o.use !== 'sig') continue;
    try {
      const jwk: JsonWebKey = { kty: 'RSA', n: o.n, e: o.e };
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      // 구글 키는 2048비트. 그보다 짧은 키는 받지 않는다
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) >= MIN_RSA_BITS) out.set(o.kid, key);
    } catch {
      // 깨진 키는 건너뛴다
    }
  }
  return out;
}

/** Cache-Control의 max-age (초). 없으면 null */
export function maxAgeOf(cacheControl: string | null): number | null {
  const m = /(?:^|[,\s])max-age=(\d+)/i.exec(cacheControl ?? '');
  return m ? Number(m[1]) : null;
}

export interface GoogleJwksOptions {
  url?: string;
  fetchFn?: typeof fetch;
  /** 시계 (ms, 기본 Date.now) */
  now?: () => number;
  /** 받기 제한 (기본 5초) */
  timeoutMs?: number;
  /** 모르는 kid로 다시 받기 최소 간격 (기본 1분) */
  refetchMs?: number;
}

/** max-age가 없을 때 · 범위 (초) */
const DEFAULT_MAX_AGE_SEC = 3600;
const MIN_MAX_AGE_SEC = 60;
const MAX_MAX_AGE_SEC = 86_400;

/**
 * 구글 공개 키 (JWKS): Cache-Control max-age만큼 두고, 모르는 kid면 다시 받는다(1분에 한 번까지 — 가짜 kid로 구글을
 * 두드리지 못하게). 받기 5초 제한, 실패하면 예외(검증 실패). 동시에 여러 요청이 와도 받기는 한 번
 */
export class GoogleJwks implements KeyProvider {
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;
  private lastFetch = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly refetchMs: number;

  constructor(opts: GoogleJwksOptions = {}) {
    this.url = opts.url ?? GOOGLE_JWKS_URL;
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.refetchMs = opts.refetchMs ?? 60_000;
  }

  async key(kid: string): Promise<KeyObject | null> {
    if (this.now() >= this.expiresAt) await this.refresh();
    const have = this.keys.get(kid);
    if (have) return have;
    if (this.now() - this.lastFetch < this.refetchMs) return null;
    await this.refresh();
    return this.keys.get(kid) ?? null;
  }

  private refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.load().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async load(): Promise<void> {
    this.lastFetch = this.now();
    const res = await this.fetchFn(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    const keys = parseJwks(await res.json());
    if (keys.size === 0) throw new Error('JWKS 키 없음');
    const age = maxAgeOf(res.headers.get('cache-control')) ?? DEFAULT_MAX_AGE_SEC;
    this.keys = keys;
    this.expiresAt = this.now() + Math.min(MAX_MAX_AGE_SEC, Math.max(MIN_MAX_AGE_SEC, age)) * 1000;
  }
}

function jsonPart(part: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface VerifyIdTokenOptions {
  /** 우리 OAuth 클라이언트 ID (aud) */
  clientId: string;
  /** 로그인을 시작할 때 쿠키에 둔 nonce */
  nonce: string;
  nowMs: number;
  keys: KeyProvider;
}

/** 구글 ID 토큰을 검증해 sub를 돌려준다 */
export async function verifyIdToken(token: unknown, opts: VerifyIdTokenOptions): Promise<TokenCheck> {
  const fail = (reason: TokenFailReason): TokenCheck => ({ ok: false, reason });
  if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX) return fail('shape');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) return fail('shape');
  const [h, p, s] = parts as [string, string, string];
  const header = jsonPart(h);
  const payload = jsonPart(p);
  if (!header || !payload) return fail('shape');
  if (header.alg !== 'RS256') return fail('alg');
  if (typeof header.kid !== 'string' || header.kid === '' || header.kid.length > 128) return fail('kid');

  let key: KeyObject | null;
  try {
    key = await opts.keys.key(header.kid);
  } catch {
    return fail('keys');
  }
  if (!key) return fail('kid');
  if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa') return fail('kid');
  let good = false;
  try {
    good = verifySignature('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  } catch {
    good = false;
  }
  if (!good) return fail('signature');

  const nowSec = opts.nowMs / 1000;
  if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.includes(payload.iss)) return fail('iss');
  const aud = payload.aud;
  const audOk =
    typeof aud === 'string'
      ? aud === opts.clientId
      : Array.isArray(aud) && aud.some((a) => typeof a === 'string' && a === opts.clientId);
  if (!audOk || opts.clientId === '') return fail('aud');
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return fail('exp');
  if (payload.exp <= nowSec - EXP_LEEWAY_SEC) return fail('exp');
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) return fail('iat');
  if (payload.iat > nowSec + IAT_FUTURE_SEC) return fail('iat');
  if (typeof payload.nonce !== 'string' || opts.nonce === '' || payload.nonce !== opts.nonce)
    return fail('nonce');
  if (typeof payload.sub !== 'string' || !SUB.test(payload.sub)) return fail('sub');
  return { ok: true, sub: payload.sub };
}
