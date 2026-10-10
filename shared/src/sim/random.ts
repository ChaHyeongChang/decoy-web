// 예측할 수 없는 난수 문자열 (M13a). 서버(Node)와 브라우저(기기 안 연습)가 같은 Web Crypto(globalThis.crypto)를 쓴다.
// 시드 난수(Rng)는 시뮬레이션 재현용이라 자리 토큰 · 임시 ID에는 쓰지 않는다
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const ch = (k: number): string => BASE64URL.charAt(k);

/** 바이트를 base64url(패딩 없음)로. Node `Buffer.toString('base64url')`과 같은 결과 */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ch((n >> 18) & 63) + ch((n >> 12) & 63) + ch((n >> 6) & 63) + ch(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += ch((n >> 18) & 63) + ch((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += ch((n >> 18) & 63) + ch((n >> 12) & 63) + ch((n >> 6) & 63);
  }
  return out;
}

/** 바이트를 소문자 16진수로. Node `Buffer.toString('hex')`와 같은 결과 */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 암호학적 난수 n바이트 */
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 자리 토큰: 18바이트 → base64url 24자 */
export function newSeatToken(): string {
  return toBase64Url(randomBytes(18));
}

/** 괴물에게 보낼 생존자 임시 ID: 's' + 6바이트 16진수 12자 */
export function newAliasId(): string {
  return `s${toHex(randomBytes(6))}`;
}
