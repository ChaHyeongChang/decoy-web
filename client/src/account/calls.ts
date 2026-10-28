// 계정 API 엔드포인트별 부르기 · 응답 모양 읽기 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 4절). 나눠 받는 조각 'account'에 든다
// (controller · serverStore만 쓴다) — 첫 묶음에는 요청 하나를 보내는 api.ts만. 서버가 준 값도 모양을 본다(기록 글은 parseProfile이
// 다시 읽는다)
import {
  ACCOUNT_API,
  type AccountClaimResponse,
  type AccountCostumeRequest,
  type AccountCostumeResponse,
  type AccountImportRequest,
  type AccountProfileBody,
  type AccountStatus,
} from '@decoy/shared';
import { isTimeZone } from '@decoy/shared/meta';
import { TAG_RE, type AccountApi, type AccountCall } from './api';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/** GET /api/account 응답 읽기 (모양이 틀리면 null) */
export function readStatus(b: unknown): AccountStatus | null {
  if (!isObj(b) || typeof b.on !== 'boolean') return null;
  if (!b.on) return { on: false };
  if (b.signedIn !== true) return { on: true, signedIn: false };
  const { tag, fresh, profile, day, timeZone } = b;
  return typeof tag === 'string' &&
    TAG_RE.test(tag) &&
    typeof fresh === 'boolean' &&
    (profile === null || typeof profile === 'string') &&
    typeof day === 'string' &&
    isTimeZone(timeZone)
    ? { on: true, signedIn: true, tag, fresh, profile, day, timeZone }
    : null;
}

/** 모양을 보지 않은 상태 응답 (부팅 때 첫 묶음이 먼저 보낸 요청 — account/boot.ts) */
export function rawStatus(api: AccountApi): Promise<AccountCall<unknown>> {
  return api.request(ACCOUNT_API.status, null, (b) => b);
}

/** 상태 응답의 모양을 본다 (틀리면 'bad' 실패) */
export async function checkStatus(p: Promise<AccountCall<unknown>>): Promise<AccountCall<AccountStatus>> {
  const r = await p;
  if (!r.ok) return r;
  const st = readStatus(r.body);
  return st ? { ok: true, body: st } : { ok: false, status: 200, error: 'bad' };
}

export function getStatus(api: AccountApi): Promise<AccountCall<AccountStatus>> {
  return checkStatus(rawStatus(api));
}

/** 기록 글이 든 응답 (import · claim-login · costume) */
function readProfileBody<T extends AccountProfileBody>(b: unknown): T | null {
  return isObj(b) && typeof b.profile === 'string' && typeof b.day === 'string' ? (b as unknown as T) : null;
}

export function importDevice(
  api: AccountApi,
  req: AccountImportRequest,
): Promise<AccountCall<AccountProfileBody>> {
  return api.request(ACCOUNT_API.import, req, readProfileBody<AccountProfileBody>);
}

export function claimLogin(api: AccountApi): Promise<AccountCall<AccountClaimResponse>> {
  return api.request(ACCOUNT_API.claimLogin, {}, (b) => {
    const body = readProfileBody<AccountClaimResponse>(b);
    return body && (body.claimed === null || isObj(body.claimed)) ? body : null;
  });
}

export function costume(
  api: AccountApi,
  req: AccountCostumeRequest,
): Promise<AccountCall<AccountCostumeResponse>> {
  return api.request(ACCOUNT_API.costume, req, (b) => {
    const body = readProfileBody<AccountCostumeResponse>(b);
    return body && typeof body.result === 'string' ? body : null;
  });
}

/** 로그아웃 · 계정 삭제 (본문 없는 POST) */
export function post(api: AccountApi, path: string): Promise<AccountCall<true>> {
  return api.request(path, {}, () => true);
}
