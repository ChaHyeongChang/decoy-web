// '내 기록' 창 (GAME_DESIGN 12.4 · 12.5, VISUAL_SPEC 9.7 · 9.8, 메타 b · c): 오늘 탭(레벨 · 불씨 · 오늘의 접속 보상(받기) ·
// 오늘의 도전 셋) · 옷장 탭(의상 해금 · 입기, 나눠 받는 조각 ui/wardrobe.ts).
// 나눠 받는 조각(`hub`) — 첫 화면에는 필요 없다(ui/hubHost.ts가 받는다). 설정 화면(9.5)과 같은 막 + 깎은 패널 모양.
// 접속 보상은 자동으로 주지 않고 여기서 '받기'로 받는다(첫 화면 · 시험을 막지 않게, 칩의 점이 알린다)
import { PROGRESSION, challengeById, loginReward, type ChallengeTeam } from '@decoy/shared/meta';
import { META_TEXT } from '../data/storyText';
import type { MetaState } from '../meta/meta';
import { EMBER_SVG, fillText } from './levelChip';
import { h, icon } from './uiArt';
import type { Wardrobe } from './wardrobe';

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

type HubTab = 'today' | 'wardrobe';

export class HubPanel {
  private readonly veil: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly tabs = new Map<HubTab, HTMLButtonElement>();
  private tab: HubTab = 'today';
  /** 옷장 (나눠 받는 조각 `wardrobe` — 옷장 탭을 처음 열 때 받는다) */
  private wardrobe: Wardrobe | null = null;
  private wardrobeLoading = false;
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
    /** 옷장 조각을 받지 못했다 (배포 직후 옛 화면): "새 버전이 있어요" */
    private readonly onLoadFailed: () => void = () => undefined,
  ) {
    this.closeBtn = h(
      'button',
      { class: 'btn', type: 'button', 'data-testid': 'hub-close' },
      icon('back', 18),
      META_TEXT.hubClose,
    );
    this.closeBtn.addEventListener('click', () => this.close());
    this.body = h('div', { class: 'hub-body', role: 'tabpanel' });
    // 탭: 오늘(접속 보상 · 도전) · 옷장(메타 c). 설정 화면과 같은 탭 모양
    const tabBar = h('div', {
      class: 'set-tabs hub-tabs',
      role: 'tablist',
      'aria-label': META_TEXT.hubTitle,
    });
    for (const t of ['today', 'wardrobe'] as const) {
      const b = h(
        'button',
        {
          class: 'set-tab',
          type: 'button',
          role: 'tab',
          'aria-selected': 'false',
          'data-testid': `hub-tab-${t}`,
        },
        t === 'today' ? META_TEXT.tabToday : META_TEXT.tabWardrobe,
      );
      b.addEventListener('click', () => {
        if (this.tab === t) return;
        this.tab = t;
        this.notice = '';
        this.wardrobe?.reset();
        this.render();
      });
      this.tabs.set(t, b);
      tabBar.append(b);
    }
    const card = h(
      'div',
      { class: 'panel hub-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': META_TEXT.hubTitle },
      h('div', { class: 'hub-head' }, h('h2', { class: 'hub-title' }, META_TEXT.hubTitle), this.closeBtn),
      tabBar,
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
    // 늘 오늘 탭부터 (칩의 점 = 받을 접속 보상이 오늘 탭에 있다). 옷장의 해금 확인 · 미리보기는 풀어 둔다
    this.tab = 'today';
    this.notice = '';
    this.wardrobe?.reset();
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
    for (const [t, b] of this.tabs) b.setAttribute('aria-selected', String(t === this.tab));
    if (this.tab === 'wardrobe') {
      this.renderWardrobe();
      return;
    }
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

  /** 옷장 탭 (조각을 처음 열 때 받는다 — 불씨는 옷장 팀 줄 끝에) */
  private renderWardrobe(): void {
    if (this.wardrobe) {
      this.wardrobe.render();
      this.body.replaceChildren(this.wardrobe.el);
      return;
    }
    this.body.replaceChildren();
    if (this.wardrobeLoading) return;
    this.wardrobeLoading = true;
    void import('./wardrobe').then(
      (m) => {
        this.wardrobeLoading = false;
        this.wardrobe = new m.Wardrobe(this.meta);
        if (this.isOpen && this.tab === 'wardrobe') this.render();
      },
      () => {
        this.wardrobeLoading = false;
        this.tab = 'today';
        this.onLoadFailed();
        if (this.isOpen) this.render();
      },
    );
  }
}
