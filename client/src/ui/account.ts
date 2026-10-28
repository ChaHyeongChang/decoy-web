// 계정 화면 · 흐름 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 7 · 8절). 나눠 받는 조각 'account' — 로그인한 기기의 부팅 · 설정을 열 때만
// 받는다(게스트 첫 화면에서는 받지 않는다). 흐름은 account/controller.ts(이 조각에 함께 든다), 부팅 판단은 첫 묶음의 account/boot.ts.
//  - 설정 '계정' 탭: 로그인 안 함 = 설명 + 구글 로그인 단추 "Google 계정으로 로그인"(Google 브랜드 가이드라인의 흰 단추 · 공식 'G'
//    로고 — 2026-10-28 사용자 승인, docs/CREDITS.md 6절. 페이지째 이동 — 팝업 없음),
//    로그인함 = 로그아웃 · 계정 삭제(두 번 확인) · 웹 삭제 페이지 · 처리방침 링크. 손가락 48px, 960×540 · 800×360에서 스크롤 없이
//  - 첫 로그인 고르기 창: 계정 기록 · 이 기기 기록 (레벨 · 불씨 · 가진 의상 수 · 판 수)
//  - 안내: 화면 아래 가운데 작은 줄, 몇 초 뒤 사라진다. 포인터를 받지 않아 누르기 · 시험을 가리지 않는다
import { ACCOUNT_DELETE_PATH, AUTH_START_PATH } from '@decoy/shared';
import { PROGRESSION, levelOf, type Profile } from '@decoy/shared/meta';
import { ACCOUNT_TEXT } from '../data/accountText';
import { UI_TEXT } from '../data/storyText';
import { AccountController, type AccountDeps } from '../account/controller';
import { fillText } from './levelChip';
import { h, icon, svgSpan } from './uiArt';
import './account.css';

const T = ACCOUNT_TEXT;

/**
 * 구글 공식 'G' 로고 (Google 로그인 브랜드 가이드라인의 단추 예시와 같은 경로 · 네 가지 색). 색 · 비율을 바꾸지 않고 로그인 단추에만
 * 쓴다 — Google LLC의 상표, 출처 · 조건은 docs/CREDITS.md 6절
 */
export const GOOGLE_G_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" focusable="false">' +
  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
  '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
  '</svg>';

/** 계정 흐름을 만든다 (화면은 이 조각의 안내 · 고르기 창) */
export function createAccount(deps: Omit<AccountDeps, 'screens'>): AccountController {
  return new AccountController({ ...deps, screens: { notice, choose } });
}
/** 안내가 떠 있는 시간 (ms) */
const NOTICE_MS = 4000;

let tray: HTMLElement | null = null;

/** 안내 한 줄 (몇 초 뒤 사라진다, 여러 개면 쌓인다) */
export function notice(text: string): void {
  if (!tray?.isConnected) {
    tray = h('div', {
      class: 'acct-tray',
      role: 'status',
      'aria-live': 'polite',
      'data-testid': 'account-notice',
    });
    document.body.append(tray);
  }
  const line = h('div', { class: 'acct-note' }, text);
  tray.append(line);
  window.setTimeout(() => line.remove(), NOTICE_MS);
}

function summary(p: Profile): string {
  return fillText(T.chooseSummary, {
    level: levelOf(p.xp, PROGRESSION).level,
    coins: p.coins,
    costumes: p.owned.length,
    played: p.played.survivor + p.played.monster,
  });
}

/** 첫 로그인: 계정 기록과 이 기기 기록이 둘 다 있다 — 어느 쪽을 쓸지 고른다 (닫기 없음 — 둘 중 하나) */
export function choose(account: Profile, device: Profile): Promise<'account' | 'device'> {
  return new Promise((resolve) => {
    const pick = (choice: 'account' | 'device', label: string, p: Profile): HTMLButtonElement => {
      const b = h(
        'button',
        { class: 'btn acct-pick', type: 'button', 'data-testid': `account-choose-${choice}` },
        h('span', { class: 'acct-pick-name' }, label),
        h('span', { class: 'acct-pick-sum num' }, summary(p)),
      );
      b.addEventListener('click', () => {
        veil.remove();
        resolve(choice);
      });
      return b;
    };
    const first = pick('account', T.chooseAccount, account);
    const veil = h(
      'div',
      { class: 'acct-veil', 'data-testid': 'account-choose' },
      h(
        'section',
        { class: 'panel acct-choose', role: 'dialog', 'aria-modal': 'true', 'aria-label': T.chooseTitle },
        h('h2', { class: 'acct-title' }, T.chooseTitle),
        h('div', { class: 'acct-picks' }, first, pick('device', T.chooseDevice, device)),
        h('p', { class: 'set-hint' }, T.chooseHint),
      ),
    );
    document.body.append(veil);
    first.focus({ preventScroll: true });
  });
}

const pages = new WeakMap<HTMLElement, AccountPage>();

/** 설정 '계정' 탭 (로비에서 열 때): 상태를 모르면 그때 읽고, 로그인 기능이 켜졌으면 채워 보인다. 꺼짐 · 실패면 숨긴다 */
export function fillTab(page: HTMLElement, ctl: AccountController, show: (on: boolean) => void): void {
  void ctl.ensure().then((view) => {
    const on = view === 'in' || view === 'out';
    if (on) accountPage(page, ctl);
    show(on);
  });
}

/**
 * 설정 '계정' 탭을 채운다 (설정을 열 때마다 — 삭제 확인 · 알림은 풀린다). 계정 상태가 바뀌면(로그아웃 · 삭제 · 세션 끝) 다시 그린다
 */
export function accountPage(page: HTMLElement, ctl: AccountController): void {
  let view = pages.get(page);
  if (!view) {
    const made = new AccountPage(page, ctl);
    pages.set(page, made);
    ctl.onChange(() => made.reset());
    view = made;
  }
  view.reset();
}

class AccountPage {
  private confirm = false;
  private busy = false;
  private msg = '';

  constructor(
    private readonly page: HTMLElement,
    private readonly ctl: AccountController,
  ) {}

  reset(): void {
    this.confirm = false;
    if (!this.busy) this.msg = '';
    this.render();
  }

  private btn(testid: string, label: string, cls = 'btn'): HTMLButtonElement {
    const b = h('button', { class: cls, type: 'button', 'data-testid': testid }, label);
    b.disabled = this.busy;
    return b;
  }

  /** 로그아웃 · 삭제 (기다리는 동안 단추를 끈다). 닿지 않으면 한 줄 */
  private run(job: () => Promise<boolean>): void {
    if (this.busy) return;
    this.busy = true;
    this.msg = '';
    this.render();
    void job().then((ok) => {
      this.busy = false;
      this.confirm = false;
      this.msg = ok ? '' : T.callFailed;
      this.render();
    });
  }

  private render(): void {
    const ctl = this.ctl;
    const signedIn = ctl.view === 'in';
    const row = h('div', { class: 'set-row acct-row', 'data-testid': 'account-page', 'data-view': ctl.view });
    const actions = h('div', { class: 'acct-actions' });
    if (!signedIn) {
      // 구글 로그인 단추: 흰 바탕 · 회색 테두리 · 'G' 로고 + 문구 (게임 단추 모양 .btn을 쓰지 않는다 — 구글 단추 모양 그대로)
      const login = h(
        'button',
        { class: 'gsi-btn', type: 'button', 'data-testid': 'account-login' },
        svgSpan('gsi-logo', GOOGLE_G_SVG),
        h('span', { class: 'gsi-text' }, T.login),
      );
      login.disabled = this.busy;
      login.addEventListener('click', () => window.location.assign(AUTH_START_PATH));
      actions.append(login);
      row.append(h('p', { class: 'set-hint acct-intro' }, T.intro), actions);
    } else if (this.confirm) {
      const yes = this.btn('account-delete-yes', T.removeYes, 'btn btn-danger');
      const no = this.btn('account-delete-no', T.removeNo);
      yes.addEventListener('click', () => this.run(() => ctl.remove()));
      no.addEventListener('click', () => this.reset());
      actions.append(yes, no);
      row.append(h('p', { class: 'acct-warn', role: 'alert' }, T.removeSure), actions);
    } else {
      const out = this.btn('account-logout', T.logout);
      const del = this.btn('account-delete', T.remove);
      out.addEventListener('click', () => this.run(() => ctl.logout()));
      del.addEventListener('click', () => {
        this.confirm = true;
        this.msg = '';
        this.render();
      });
      actions.append(out, del);
      row.append(
        h('div', { class: 'acct-status', 'data-testid': 'account-signed-in' }, icon('check', 18), T.signedIn),
        actions,
      );
    }
    const note = h('div', { class: 'acct-msg', role: 'status', 'data-testid': 'account-msg' }, this.msg);
    note.hidden = this.msg === '';
    const links = h('div', { class: 'acct-links' });
    if (signedIn)
      links.append(
        h(
          'a',
          { class: 'privacy-link', href: ACCOUNT_DELETE_PATH, 'data-testid': 'account-delete-page' },
          T.removePage,
        ),
      );
    links.append(h('a', { class: 'privacy-link', href: '/privacy' }, UI_TEXT.privacy));
    row.append(note, links);
    this.page.replaceChildren(row);
  }
}
