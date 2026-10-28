// 쿠키 읽기 · 쓰기 (선택형 구글 로그인): 세션 decoy_sid · 로그인 중 decoy_oauth. 모두 HttpOnly(화면 스크립트가 읽지 못한다)

export type SameSite = 'Lax' | 'Strict' | 'None';

export interface CookieOptions {
  path: string;
  maxAgeSec: number;
  sameSite: SameSite;
  /** HTTPS면 true (SameSite=None은 Secure가 있어야 브라우저가 받는다) */
  secure: boolean;
}

const NAME = /^[A-Za-z0-9_-]+$/;
const VALUE = /^[A-Za-z0-9._~-]*$/;

/** Cookie 머리에서 이름 하나의 값 (없으면 null, 여러 번이면 처음 것) */
export function readCookie(header: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(header) ? header.join('; ') : (header ?? '');
  if (raw.length > 8192) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    return v;
  }
  return null;
}

/** Set-Cookie 머리 값 (HttpOnly 늘 붙인다). 이름 · 값은 쿠키 글자만 (아니면 예외 — 머리 주입 막기) */
export function setCookie(name: string, value: string, opts: CookieOptions): string {
  if (!NAME.test(name) || !VALUE.test(value)) throw new Error('쿠키 이름 · 값 모양');
  const parts = [
    `${name}=${value}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`,
    'HttpOnly',
    `SameSite=${opts.sameSite}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** 쿠키 지우기 (같은 Path · SameSite · Secure로 Max-Age=0) */
export function clearCookie(name: string, opts: Omit<CookieOptions, 'maxAgeSec'>): string {
  return setCookie(name, '', { ...opts, maxAgeSec: 0 });
}
