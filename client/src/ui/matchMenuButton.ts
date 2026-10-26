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

/**
 * 버튼 자리 · 크기: 캔버스 왼쪽에서 leftLogical(논리 px, 팀 카드 왼쪽 끝과 같은 줄), 높이 heightCss(CSS px — 누르기 쉬운 크기).
 * gapCss = 피할 HUD(팀 카드 · 맵 · 게이지)와 떨어뜨리는 간격, minScale = 작은 창에서 줄이는 하한
 */
export const MENU_BUTTON = { leftLogical: 14, heightCss: 44, gapCss: 4, minScale: 0.4 } as const;

/** 버튼이 피할 판 HUD (논리 px, PC 배치 layout.HUD · MAP_RECT) */
export interface MenuKeepOut {
  /** 위 띠 높이 (= 맵 사각형 위 끝) */
  band: number;
  /** 팀 카드 위 끝 */
  cardTop: number;
  /** 맵 사각형 왼쪽 끝 */
  mapLeft: number;
  /** 거점 A 게이지 왼쪽 끝 (배지 포함) */
  gaugeLeft: number;
}

/** 버튼 왼쪽 위 (창 CSS px) · 배율 (CSS transform, 원점 왼쪽 위) */
export interface MenuButtonFit {
  left: number;
  top: number;
  scale: number;
}

/**
 * 버튼 자리와 배율 (창 CSS px). size = 줄이기 전 버튼 크기(CSS px). 팀 카드 · 맵 사각형 · 거점 A 게이지와 gapCss 넘게 떨어지게 둔다:
 *  ① 맵 위 끝보다 위(위 띠 + 캔버스 위 여백)면 게이지 왼쪽까지 넓게, ② 맵 왼쪽 옆이면 팀 카드 위 끝까지 — 둘 중 덜 줄이는 쪽.
 * 세로는 띠 가운데(예전 자리)를 바라고, 띠가 버튼보다 낮은데 캔버스 위 여백(레터박스)에 다 들어가면 그 가운데에 놓는다.
 * 큰 창(1280×720 이상)은 줄이지 않아 예전과 같다. 작은 창(960×540 등)은 들어가는 만큼 줄인다 — 예전에는 44px 그대로 팀 카드 위
 * 테두리에 걸쳤다(960×540 약 5px, 800×600은 맵 왼쪽 끝 · FPS 칩까지)
 */
export function menuButtonPlace(
  canvas: { left: number; top: number; k: number },
  size: { w: number; h: number },
  keep: MenuKeepOut,
): MenuButtonFit {
  const k = canvas.k;
  const g = MENU_BUTTON.gapCss;
  const left = Math.round(canvas.left + MENU_BUTTON.leftLogical * k);
  const w = size.w > 0 ? size.w : 1;
  const h = size.h > 0 ? size.h : MENU_BUTTON.heightCss;
  const mapTop = canvas.top + keep.band * k;
  const cardTop = canvas.top + keep.cardTop * k;
  const above = Math.min(1, (mapTop - g) / h, (canvas.left + keep.gaugeLeft * k - g - left) / w);
  const beside = Math.min(1, (cardTop - g) / h, (canvas.left + keep.mapLeft * k - g - left) / w);
  const useAbove = above >= beside;
  const scale = Math.max(MENU_BUTTON.minScale, Math.floor((useAbove ? above : beside) * 1000) / 1000);
  const bh = h * scale;
  const limit = (useAbove ? mapTop : cardTop) - g;
  const band = keep.band * k;
  let top = canvas.top + (band - bh) / 2;
  if (band < bh && canvas.top >= bh + 2 * g) top = (canvas.top - bh) / 2;
  top = Math.max(0, Math.min(top, limit - bh));
  return { left, top: Math.floor(top), scale };
}

export class MatchMenuButton {
  readonly el: HTMLButtonElement;
  private on = false;
  private left = Number.NaN;
  private top = Number.NaN;
  private scale = 1;

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

  /** 줄이기 전 크기 (CSS px — 배율을 빼고 잰다. 보일 때만 의미가 있다) */
  get naturalSize(): { w: number; h: number } {
    return { w: this.el.offsetWidth, h: this.el.offsetHeight };
  }

  /** 왼쪽 위 (창 CSS px) · 배율 (바뀐 때만 쓴다) */
  place(left: number, top: number, scale = 1): void {
    if (left !== this.left || top !== this.top) {
      this.left = left;
      this.top = top;
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
    }
    if (scale !== this.scale) {
      this.scale = scale;
      // transform이 아니라 scale 속성: .btn:active의 눌림 효과(translateY)와 함께 걸린다
      if (scale === 1) this.el.style.removeProperty('scale');
      else this.el.style.setProperty('scale', String(scale));
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
