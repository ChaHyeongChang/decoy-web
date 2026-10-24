// 판 중 메뉴 버튼 (PC, 설정 화면 통합): 판 화면 위 띠 왼쪽 빈 자리(팀 카드 위 · 거점 A 게이지 왼쪽)의 DOM 버튼 — 설정 아이콘 +
// '설정' + 키캡 Esc. 누르면 판 중 설정을 연다(GameScene → matchMenu.open). 판은 멈추지 않는다.
//  - 자리는 캔버스 사각형(창 CSS px)과 논리 px 띠 높이로 정하고 창 크기가 바뀔 때만 다시 놓는다(바뀐 값만 쓴다)
//  - #ui-root DOM이라 누르기가 캔버스 · 판 입력(#game-root)으로 가지 않는다. 포커스를 받지 않는다(tabindex -1 · 누를 때 포커스 막기):
//    포커스가 남으면 Space(생존자 능력 키)가 버튼을 다시 누른다. 키보드로는 Esc가 같은 일을 한다
//  - 터치 모드에서는 만들지 않는다(터치는 오른쪽 위 시스템 버튼 '설정', touchControls)
// Phaser를 import하지 않는다 (단위 시험: 자리 계산)
import { APP_TEXT, HELP_TEXT } from '../data/storyText';
import { h, icon, keycap } from './uiArt';
import './matchMenuButton.css';

/** 버튼 자리 · 크기: 캔버스 왼쪽에서 leftLogical(논리 px, 팀 카드 왼쪽 끝과 같은 줄), 높이 heightCss(CSS px — 누르기 쉬운 크기) */
export const MENU_BUTTON = { leftLogical: 14, heightCss: 44 } as const;

/**
 * 버튼 왼쪽 위 (창 CSS px): 위 띠(논리 band px) 세로 가운데. 띠가 버튼보다 낮으면(작은 창) 캔버스 맨 위에 붙인다 — 이때 아래 끝이
 * 띠 밑 팀 카드 위 테두리에 몇 px 걸칠 수 있다(960×540: 띠 32 CSS px)
 */
export function menuButtonPlace(
  canvas: { left: number; top: number; k: number },
  band: number,
): { left: number; top: number } {
  const bandCss = band * canvas.k;
  return {
    left: Math.round(canvas.left + MENU_BUTTON.leftLogical * canvas.k),
    top: Math.round(canvas.top + Math.max(0, (bandCss - MENU_BUTTON.heightCss) / 2)),
  };
}

export class MatchMenuButton {
  readonly el: HTMLButtonElement;
  private on = false;
  private left = Number.NaN;
  private top = Number.NaN;

  constructor(host: HTMLElement, onPress: () => void) {
    const el = h(
      'button',
      {
        type: 'button',
        class: 'btn match-menu',
        'data-testid': 'match-menu',
        tabindex: '-1',
        'aria-label': `${APP_TEXT.settings} (${HELP_TEXT.menuKey})`,
      },
      icon('sliders', 18),
      h('span', { class: 'match-menu-label' }, APP_TEXT.settings),
      keycap(HELP_TEXT.menuKey),
    );
    el.hidden = true;
    // 누를 때 포커스를 가져가지 않는다 (Space · Enter가 버튼을 다시 누르지 않게)
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      el.blur();
      onPress();
    });
    host.appendChild(el);
    this.el = el;
  }

  get shown(): boolean {
    return this.on;
  }

  show(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.hidden = !on;
  }

  /** 왼쪽 위 (창 CSS px, 바뀐 때만 쓴다) */
  place(left: number, top: number): void {
    if (left === this.left && top === this.top) return;
    this.left = left;
    this.top = top;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  destroy(): void {
    this.el.remove();
  }
}
