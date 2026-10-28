// 내 레벨 · 불씨 칩 (GAME_DESIGN 12장, VISUAL_SPEC 9.6 · 9.7): 첫 화면 · 연습 고르기에 내 레벨 · 다음 레벨까지 막대 · 불씨 ·
// 받을 접속 보상 점. 누르면 '내 기록' 창(나눠 받는 조각 `hub`)을 연다. 내 기록(게스트: 이 기기, 로그인: 계정)으로만 그린다 —
// 남의 레벨은 어디에도 그리지 않는다. 계정 기록을 읽는 동안(최대 3초)은 '…'. 요소 하나를 만들어 화면을 다시 그릴 때 옮겨 붙인다.
// 판 중 HUD에는 붙이지 않는다. data-store: device · server · wait (시험이 본다)
import { META_TEXT } from '../data/storyText';
import type { MetaState } from '../meta/meta';
import { h } from './uiArt';

export function fillText(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? ''));
}

/** 불씨 아이콘 (24 격자 · 2px 선: 불꽃 + 안쪽 불씨) — 칩 · '내 기록' 창 · 결과가 같이 쓴다 */
export const EMBER_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5.5c.3 1.6 1 2.5 2 3c.2-2.6-.2-5 .5-7.5z" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M12 14.5c.9 1 1.5 1.8 1.5 2.7a1.5 1.5 0 0 1-3 0c0-.9.6-1.7 1.5-2.7z" fill="currentColor"/></svg>';

export class LevelChip {
  readonly el: HTMLButtonElement;
  private readonly num: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly dot: HTMLElement;

  constructor(
    private readonly meta: MetaState,
    /** 누르면 '내 기록' 창을 연다 */
    onOpen: () => void,
  ) {
    this.num = h('span', { class: 'num lv-num', 'data-testid': 'level-num' }, '1');
    this.bar = h('span', { class: 'lv-fill' });
    this.coins = h('span', { class: 'num lv-coins', 'data-testid': 'coin-num' }, '0');
    const ember = h('span', { class: 'lv-ember', 'aria-hidden': 'true' });
    ember.innerHTML = EMBER_SVG;
    this.dot = h('span', { class: 'lv-dot', 'data-testid': 'login-dot', title: META_TEXT.chipDot });
    this.el = h(
      'button',
      { class: 'lv-chip cut', type: 'button', 'data-testid': 'level-chip' },
      h('span', { class: 'lv-label' }, META_TEXT.levelShort),
      this.num,
      h('span', { class: 'lv-bar', 'aria-hidden': 'true' }, this.bar),
      ember,
      this.coins,
      this.dot,
    );
    this.el.addEventListener('click', onOpen);
    meta.onChange(() => this.update());
    this.update();
  }

  update(): void {
    const wait = this.meta.waiting;
    this.el.dataset.store = wait ? 'wait' : this.meta.mode;
    if (wait) {
      this.num.textContent = META_TEXT.waiting;
      this.coins.textContent = META_TEXT.waiting;
      this.bar.style.width = '0%';
      this.dot.hidden = true;
      return;
    }
    const info = this.meta.level();
    const coins = this.meta.current.coins;
    const login = this.meta.login();
    this.num.textContent = String(info.level);
    this.coins.textContent = String(coins);
    const ratio = info.max ? 1 : info.need > 0 ? info.into / info.need : 0;
    this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    this.dot.hidden = !login.available;
    const level = info.max
      ? fillText(META_TEXT.levelMaxAria, { level: info.level })
      : fillText(META_TEXT.levelAria, { level: info.level, into: info.into, need: info.need });
    const label = `${fillText(META_TEXT.chipAria, { level: info.level, coins })} · ${level}${
      login.available ? ` · ${META_TEXT.chipDot}` : ''
    }`;
    this.el.setAttribute('aria-label', label);
    this.el.title = label;
  }
}
