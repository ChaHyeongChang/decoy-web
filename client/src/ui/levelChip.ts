// 내 레벨 칩 (GAME_DESIGN 12장, VISUAL_SPEC 9.6): 첫 화면 · 연습 고르기 · 방 · 빠른 매칭 대기 화면 위에 내 레벨과 다음 레벨까지 막대.
// 내 기기 기록으로만 그린다 — 서버에서 받은 것이 없고, 남의 레벨은 어디에도 그리지 않는다. 요소 하나를 만들어 화면을 다시 그릴 때
// 옮겨 붙인다(화면마다 새로 만들지 않는다). 판 중 HUD에는 붙이지 않는다
import { META_TEXT } from '../data/storyText';
import type { MetaState } from '../meta/meta';
import { h } from './uiArt';

function fill(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? ''));
}

export class LevelChip {
  readonly el: HTMLElement;
  private readonly num: HTMLElement;
  private readonly bar: HTMLElement;

  constructor(private readonly meta: MetaState) {
    this.num = h('span', { class: 'num lv-num', 'data-testid': 'level-num' }, '1');
    this.bar = h('span', { class: 'lv-fill' });
    this.el = h(
      'div',
      { class: 'lv-chip cut', 'data-testid': 'level-chip', role: 'img' },
      h('span', { class: 'lv-label' }, META_TEXT.levelShort),
      this.num,
      h('span', { class: 'lv-bar', 'aria-hidden': 'true' }, this.bar),
    );
    meta.onChange(() => this.update());
    this.update();
  }

  update(): void {
    const info = this.meta.level();
    this.num.textContent = String(info.level);
    const ratio = info.max ? 1 : info.need > 0 ? info.into / info.need : 0;
    this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    const label = info.max
      ? fill(META_TEXT.levelMaxAria, { level: info.level })
      : fill(META_TEXT.levelAria, { level: info.level, into: info.into, need: info.need });
    this.el.setAttribute('aria-label', label);
    this.el.title = label;
  }
}
