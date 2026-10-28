// 가짜 구글 (시험 훅 전용, docs/ACCOUNT_PLAN.md 3절): 서버를 띄울 때 만든 시험 RSA 키로 ID 토큰에 서명해, 진짜 구글처럼
// 콜백으로 form_post한다. 배포 서버(--test-hooks 없음)는 쓰지 않는다(account/config.ts). 단위 시험도 같은 서명 함수를 쓴다
import { createHash, generateKeyPairSync, sign as signData, type KeyObject } from 'node:crypto';
import { StaticKeys } from './googleToken';

export const TEST_IDP_KID = 'decoy-test-1';
export const TEST_IDP_ISSUER = 'https://accounts.google.com';
/** 나쁜 토큰 종류 (/test/google/authorize?test_token=…) */
export const TEST_TOKEN_FLAWS = ['expired', 'badsig', 'wrongaud', 'nonce'] as const;
export type TestTokenFlaw = (typeof TEST_TOKEN_FLAWS)[number];

export function isTestTokenFlaw(v: unknown): v is TestTokenFlaw {
  return typeof v === 'string' && (TEST_TOKEN_FLAWS as readonly string[]).includes(v);
}

function b64urlJson(v: unknown): string {
  return Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
}

/** JWT 서명 (RS256). header · payload는 그대로 싣는다 — 시험이 나쁜 헤더도 만들 수 있게 */
export function signJwt(
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
  privateKey: KeyObject,
): string {
  const body = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = signData('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
  return `${body}.${sig}`;
}

/** 시험 RSA 키 한 쌍 (2048비트) */
export function testKeyPair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

export interface TestTokenRequest {
  sub: string;
  nonce: string;
  nowMs: number;
  flaw?: TestTokenFlaw | null;
}

/** 가짜 구글: 시험 키로 서명한 ID 토큰을 만든다 */
export class TestIdp {
  readonly keys: StaticKeys;
  private readonly privateKey: KeyObject;

  constructor(readonly clientId: string) {
    const pair = testKeyPair();
    this.privateKey = pair.privateKey;
    this.keys = new StaticKeys({ [TEST_IDP_KID]: pair.publicKey });
  }

  idToken(req: TestTokenRequest): string {
    const iat = Math.floor(req.nowMs / 1000);
    const expired = req.flaw === 'expired';
    const payload = {
      iss: TEST_IDP_ISSUER,
      aud: req.flaw === 'wrongaud' ? '1-other.apps.googleusercontent.com' : this.clientId,
      azp: this.clientId,
      sub: req.sub,
      nonce: req.flaw === 'nonce' ? 'wrong-nonce' : req.nonce,
      iat: expired ? iat - 7200 : iat,
      exp: expired ? iat - 3600 : iat + 3600,
    };
    const token = signJwt({ alg: 'RS256', kid: TEST_IDP_KID, typ: 'JWT' }, payload, this.privateKey);
    if (req.flaw !== 'badsig') return token;
    // 서명만 다른 값으로 (같은 길이 — 모양 검사는 통과하고 서명에서 걸린다)
    const [h, p] = token.split('.');
    const fake = createHash('sha512').update(token).digest();
    const sigLen = Buffer.from(token.split('.')[2] ?? '', 'base64url').length;
    const sig = Buffer.alloc(sigLen);
    for (let i = 0; i < sigLen; i += 1) sig[i] = fake[i % fake.length] ?? 0;
    return `${h}.${p}.${sig.toString('base64url')}`;
  }
}

function escapeAttr(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 진짜 구글의 form_post처럼 콜백으로 자동 POST하는 페이지 (시험 전용 — 스크립트 한 줄로 바로 보낸다).
 * fields: id_token · state 또는 error · state
 */
export function testAuthorizePage(action: string, fields: Readonly<Record<string, string>>): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(v)}">`)
    .join('');
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>가짜 구글 (시험)</title></head>' +
    `<body><form method="post" action="${escapeAttr(action)}">${inputs}<button type="submit">계속</button></form>` +
    '<script>document.forms[0].submit()</script></body></html>'
  );
}
