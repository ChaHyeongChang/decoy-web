// 부팅 때 계정 상태 읽기 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 7절) — 첫 묶음에는 이 판단과 요청 시작만 둔다.
// 이 기기 표시(decoy:account)가 있거나 주소에 ?login=이 있을 때만 GET /api/account를 부른다 — 게스트 · 기능 꺼짐은 요청도 조각도 없다.
// 요청은 바로 시작하고(나눠 받는 조각을 받는 동안), 흐름(계정 모드 · 첫 로그인 · 안내)은 조각의 AccountController.boot가 잇는다.
// 표시가 있으면 레벨 칩은 계정을 읽을 때까지 '…'(최대 3초, 넘으면 기기 기록 — 늦게 오면 그때 계정으로).
// 표시 없이 로그인하고 돌아왔으면(?login=ok) 요청 전에 '로그인 시도 중' 표시를 적는다: 상태 읽기 · 올리기 · 조각 받기가 실패해
// 이번 접속이 게스트가 돼도(쿠키는 남아 서버는 계정에 적립한다) 다음 부팅이 상태를 읽어 첫 로그인을 잇는다. 성공하면 계정 tag로,
// 로그인 안 됨이면 지운다 (account/controller.ts)
import { ACCOUNT_API } from '@decoy/shared';
import type { MetaState } from '../meta/meta';
import type { AccountApi } from './api';
import type { AccountController } from './controller';
import type { AccountMark } from './mark';

/** 계정을 읽을 때까지 레벨 칩 '…'을 보이는 최대 시간 (ms) */
export const BOOT_WAIT_MS = 3000;

export interface AccountBootDeps {
  api: AccountApi;
  mark: AccountMark;
  meta: MetaState;
  /** 계정 흐름 (나눠 받는 조각, 받지 못하면 null — 게스트 그대로) */
  controller(): Promise<AccountController | null>;
}

/** login = 주소의 ?login= 값 (없으면 null). 읽을 것이 없으면(게스트) null을 돌려주고 아무 요청도 하지 않는다 */
export function bootAccount(d: AccountBootDeps, login: string | null): Promise<void> | null {
  const hadMark = d.mark.read() !== null;
  if (!hadMark && login === null) return null;
  if (!hadMark && login === 'ok') d.mark.write('');
  // 모양은 조각(account/calls.ts checkStatus)이 본다 — 첫 묶음에는 요청만
  const status = d.api.request(ACCOUNT_API.status, null, (b) => b);
  if (hadMark) d.meta.setWaiting(true);
  const timer = setTimeout(() => d.meta.setWaiting(false), BOOT_WAIT_MS);
  return d
    .controller()
    .then((ctl) => ctl?.boot(login, status, hadMark))
    .finally(() => {
      clearTimeout(timer);
      d.meta.setWaiting(false);
    });
}
