// '내 기록' 창 (GAME_DESIGN 12.4, VISUAL_SPEC 9.7, 메타 b): 레벨 · 불씨 · 오늘의 접속 보상(받기) · 오늘의 도전 셋.
// 나눠 받는 조각(`hub`) — 첫 화면에는 필요 없다(ui/hubHost.ts가 받는다). 설정 화면(9.5)과 같은 막 + 깎은 패널 모양.
// 접속 보상은 자동으로 주지 않고 여기서 '받기'로 받는다(첫 화면 · 시험을 막지 않게, 칩의 점이 알린다)
import { PROGRESSION, challengeById, loginReward, type ChallengeTeam } from '@decoy/shared/meta';
import { META_TEXT } from '../data/storyText';
import type { MetaState } from '../meta/meta';
import { EMBER_SVG, fillText } from './levelChip';
import { h, icon } from './uiArt';

const TEAM_TEXT: Record<ChallengeTeam, string> = {
  survivor: META_TEXT.teamSurvivor,
  monster: META_TEXT.teamMonster,
  any: META_TEXT.teamAny,
};

function ember(): HTMLElement {
  const e = h('span', { class: 'lv-ember', 'aria-hidden': 'true' });
  e.innerHTML = EMBER_SVG;
  return e;
}

export class HubPanel {
  private readonly veil: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private notice = '';
  private unsub: (() => void) | null = null;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  };

  constructor(
    host: HTMLElement,
    private readonly meta: MetaState,
  ) {
    this.closeBtn = h(
      'button',
      { class: 'btn', type: 'button', 'data-testid': 'hub-close' },
      icon('back', 18),
      META_TEXT.hubClose,
    );
    this.closeBtn.addEventListener('click', () => this.close());
    this.body = h('div', { class: 'hub-body' });
    const card = h(
      'div',
      { class: 'panel hub-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': META_TEXT.hubTitle },
      h('div', { class: 'hub-head' }, h('h2', { class: 'hub-title' }, META_TEXT.hubTitle), this.closeBtn),
      this.body,
    );
    this.veil = h('div', { class: 'hub-veil', 'data-testid': 'hub' }, card);
    this.veil.hidden = true;
    // 막을 누르면 닫는다 (패널 안 누름은 닫지 않는다)
    this.veil.addEventListener('click', (e) => {
      if (e.target === this.veil) this.close();
    });
    host.appendChild(this.veil);
  }

  get isOpen(): boolean {
    return !this.veil.hidden;
  }

  open(): void {
    this.notice = '';
    this.render();
    this.veil.hidden = false;
    this.unsub ??= this.meta.onChange(() => {
      if (this.isOpen) this.render();
    });
    window.addEventListener('keydown', this.onKey);
    this.closeBtn.focus({ preventScroll: true });
  }

  close(): void {
    this.veil.hidden = true;
    window.removeEventListener('keydown', this.onKey);
  }

  private render(): void {
    const info = this.meta.level();
    const coins = this.meta.current.coins;
    const ratio = info.max ? 1 : info.need > 0 ? info.into / info.need : 0;
    const fill = h('span', { class: 'lv-fill' });
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    const summary = h(
      'div',
      { class: 'hub-summary' },
      h('span', { class: 'hub-level num' }, `${META_TEXT.levelShort} ${info.level}`),
      h('span', { class: 'lv-bar hub-bar', 'aria-hidden': 'true' }, fill),
      h('span', { class: 'hub-xp num' }, info.max ? '' : `${info.into}/${info.need}`),
      h('span', { class: 'hub-coins num', 'data-testid': 'hub-coins' }, ember(), String(coins)),
    );

    // 오늘의 접속 보상
    const login = this.meta.login();
    const reward = loginReward(login.streak, PROGRESSION);
    const claim = h(
      'button',
      { class: 'btn btn-primary', type: 'button', 'data-testid': 'login-claim' },
      META_TEXT.loginClaim,
    );
    claim.disabled = !login.available;
    claim.addEventListener('click', () => {
      if (claim.disabled) return;
      claim.disabled = true;
      void this.meta.claimLogin().then((r) => {
        this.notice = r ? (r.saved ? fillText(META_TEXT.loginGot, { n: r.reward }) : META_TEXT.notSaved) : '';
        this.render();
      });
    });
    const loginCard = h(
      'section',
      { class: 'hub-login cut', 'data-testid': 'hub-login' },
      h(
        'div',
        { class: 'hub-login-text' },
        h('span', { class: 'hub-sec-title' }, META_TEXT.loginTitle),
        h(
          'span',
          { class: 'hub-login-detail' },
          h('span', { 'data-testid': 'login-streak' }, fillText(META_TEXT.loginStreak, { n: login.streak })),
          ' · ',
          ember(),
          h('span', { class: 'num' }, `+${reward}`),
        ),
      ),
      login.available
        ? claim
        : h(
            'span',
            { class: 'hub-claimed', 'data-testid': 'login-claimed' },
            icon('ready', 18),
            META_TEXT.loginClaimed,
          ),
    );

    // 오늘의 도전 셋
    const daily = this.meta.daily();
    const list = h('ul', { class: 'hub-daily-list' });
    daily.ids.forEach((id, i) => {
      const found = challengeById(id, PROGRESSION);
      if (!found) return;
      const target = found.def.target;
      const progress = Math.min(target, daily.progress[i] ?? 0);
      const done = daily.done[i] === true;
      const bar = h('span', { class: 'hub-pbar', 'aria-hidden': 'true' }, h('span', { class: 'hub-pfill' }));
      const pf = bar.firstElementChild as HTMLElement | null;
      if (pf) pf.style.width = `${Math.round((progress / target) * 100)}%`;
      const text = fillText(META_TEXT.challenges[id] ?? id, { n: target });
      list.append(
        h(
          'li',
          {
            class: done ? 'hub-ch done' : 'hub-ch',
            'data-testid': `challenge-${id}`,
            'data-team': found.team,
          },
          h('span', { class: `tag hub-team team-${found.team}` }, TEAM_TEXT[found.team]),
          h('span', { class: 'hub-ch-text' }, text),
          bar,
          h('span', { class: 'hub-ch-count num' }, `${Math.floor(progress)}/${target}`),
          done
            ? h('span', { class: 'hub-ch-done' }, icon('ready', 16), META_TEXT.dailyDone)
            : h('span', { class: 'hub-ch-reward num' }, ember(), `+${found.def.reward}`),
        ),
      );
    });
    const dailyCard = h(
      'section',
      { class: 'hub-daily', 'data-testid': 'hub-daily' },
      h('span', { class: 'hub-sec-title' }, META_TEXT.dailyTitle),
      list,
      h('p', { class: 'hub-note' }, META_TEXT.dailyReset),
    );
    const notice = h(
      'div',
      { class: 'hub-notice', role: 'status', 'data-testid': 'hub-notice' },
      this.notice,
    );
    notice.hidden = this.notice === '';
    this.body.replaceChildren(summary, loginCard, notice, dailyCard);
  }
}
