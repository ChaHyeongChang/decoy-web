// 앱 생명주기 화면 (M12, MOBILE_PLAN M12 5 · 6 · 8번): 판 직전 터치 안내 카드, 판 중 뒤로 가기 확인, 다른 탭 안내 +
// "여기서 계속하기" (설정은 설정 화면 통합에서 settingsPanel.ts로 옮겼다). 모양은 로비와 같은 깎은 패널 · 버튼
// (lifecycle.css, style.css 토큰), 문구는 storyText.ts(APP_TEXT · TOUCH_TEXT · UI_TEXT)에서만. 판 중 매 프레임 건드리지 않는다
// (열고 닫을 때만 DOM을 바꾼다)
import { teamOf, type Role } from '@decoy/shared';
import { APP_TEXT, HELP_TEXT, TOUCH_TEXT } from '../data/storyText';
import { currentCharStyle, type CharStyle } from '../gfx/charStyle';
import type { LeaveKind } from '../lifecycle';
import { frontFigureSvg, h, icon, roleVars, svgSpan } from './uiArt';
import './lifecycle.css';

// ───────────── 가운데 카드 (확인 창 · 다른 탭 안내) ─────────────

/** 화면 전체를 덮는 막 + 가운데 카드. 판 화면 · 터치 화면 · 로비 위(깨우기 안내와 같은 층) */
class CenterCard {
  readonly root: HTMLDivElement;
  readonly card: HTMLDivElement;
  private prevFocus: HTMLElement | null = null;

  constructor(
    host: HTMLElement,
    testid: string,
    role: 'dialog' | 'alertdialog',
    labelId: string,
    descId?: string,
  ) {
    this.card = h('div', {
      class: 'panel life-card',
      role,
      'aria-modal': 'true',
      'aria-labelledby': labelId,
      'aria-describedby': descId,
      'data-testid': testid,
    });
    this.root = h('div', { class: 'life-modal' }, this.card);
    this.root.hidden = true;
    host.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(focus: HTMLElement): void {
    if (!this.isOpen) {
      const active = document.activeElement;
      this.prevFocus = active instanceof HTMLElement ? active : null;
    }
    this.root.hidden = false;
    focus.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.prevFocus?.focus({ preventScroll: true });
    this.prevFocus = null;
  }
}

let ids = 0;
const nextId = (p: string): string => `${p}-${++ids}`;

/**
 * 뒤로 가기 확인 제목 · 본문 (LeaveKind별): 친구 방은 30초 유예 안내, 빠른 매칭 판은 나가기가 바로 판정된다는 안내
 * (GAME_DESIGN 11.2 — 유예 없음 · 이어서 할 수 없음, 검토 반영 F10), 연습 판은 기기 안 판을 닫고 첫 화면으로 간다는 안내
 * (다른 사람과 무관, 검토 반영 F16)
 */
export function leaveTextFor(kind: LeaveKind): { title: string; body: string } {
  switch (kind) {
    case 'practice':
      return { title: APP_TEXT.leaveTitlePractice, body: APP_TEXT.leaveBodyPractice };
    case 'quick':
      return { title: APP_TEXT.leaveTitle, body: APP_TEXT.leaveBodyQuick };
    case 'match':
      return { title: APP_TEXT.leaveTitle, body: APP_TEXT.leaveBody };
  }
}

/** 판 중 뒤로 가기 확인 (터치 · 설치 앱): "판에서 나가시겠어요?"(연습은 연습 문구) + 계속 / 나가기 */
export class LeaveDialog {
  private readonly box: CenterCard;
  private readonly stayBtn: HTMLButtonElement;
  private readonly titleText: HTMLHeadingElement;
  private readonly bodyText: HTMLParagraphElement;

  constructor(host: HTMLElement, actions: { stay: () => void; leave: () => void }) {
    const title = nextId('leave-title');
    const body = nextId('leave-body');
    this.box = new CenterCard(host, 'leave-dialog', 'alertdialog', title, body);
    this.stayBtn = h(
      'button',
      { class: 'btn btn-primary', type: 'button', 'data-testid': 'leave-stay' },
      icon('play', 18),
      APP_TEXT.leaveStay,
    );
    const go = h(
      'button',
      { class: 'btn btn-danger', type: 'button', 'data-testid': 'leave-go' },
      icon('exit', 18),
      APP_TEXT.leaveGo,
    );
    this.stayBtn.addEventListener('click', () => actions.stay());
    go.addEventListener('click', () => actions.leave());
    this.titleText = h('h2', { id: title }, APP_TEXT.leaveTitle);
    this.bodyText = h('p', { id: body, class: 'life-body' }, APP_TEXT.leaveBody);
    this.box.card.classList.add('life-leave');
    this.box.card.append(
      h('div', { class: 'life-head' }, icon('exit', 24, 'life-head-ico'), this.titleText),
      this.bodyText,
      h('div', { class: 'life-buttons' }, go, this.stayBtn),
    );
    // Esc(키보드 · 일부 기기의 뒤로 가기 키) = 계속
    this.box.card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') actions.stay();
    });
  }

  get isOpen(): boolean {
    return this.box.isOpen;
  }

  /** kind = 지금 판의 종류 (제목 · 본문이 다르다, leaveTextFor) */
  open(kind: LeaveKind = 'match'): void {
    const text = leaveTextFor(kind);
    this.titleText.textContent = text.title;
    this.bodyText.textContent = text.body;
    this.box.show(this.stayBtn);
  }

  close(): void {
    this.box.hide();
  }
}

/** 다른 탭(기기)이 이 자리를 넘겨받았다: 안내 + "여기서 계속하기" (누르면 이 기기로 다시 들어온다) */
export class ReplacedNotice {
  private readonly box: CenterCard;
  private readonly text: HTMLParagraphElement;
  private readonly button: HTMLButtonElement;

  constructor(host: HTMLElement, onContinue: () => void) {
    const title = nextId('replaced-text');
    this.box = new CenterCard(host, 'replaced-notice', 'alertdialog', title);
    this.text = h('p', { id: title, class: 'life-body life-strong' });
    this.button = h(
      'button',
      { class: 'btn btn-primary', type: 'button', 'data-testid': 'continue-here' },
      icon('replay', 18),
      APP_TEXT.continueHere,
    );
    this.button.addEventListener('click', onContinue);
    this.box.card.classList.add('life-replaced');
    this.box.card.append(
      h('div', { class: 'life-head' }, icon('disconnected', 26, 'life-head-ico')),
      this.text,
      h('div', { class: 'life-buttons' }, this.button),
    );
  }

  get isOpen(): boolean {
    return this.box.isOpen;
  }

  show(message: string): void {
    this.text.textContent = message;
    this.box.show(this.button);
  }

  hide(): void {
    this.box.hide();
  }
}

// ───────────── 판 직전 터치 안내 ─────────────

/** 손가락 자리 그림의 번호 표 (안내 줄 순서와 같다, 그림 단위. 18px 배지가 가장 작은 그림(112×56px) 안에 들게 x 9~91 · y 9~41.5) */
interface Spot {
  n: number;
  x: number;
  y: number;
}

/**
 * 터치 화면 자리 그림 (가로 휴대폰, 100 × 50 단위): 왼쪽 아래 이동 영역 · 오른쪽 아래 엄지 버튼 · 오른쪽 위 점수판.
 * 실제 배치(touchControls.ts touchLayout)를 줄여 그린 것. 번호는 안내 줄과 같다. 번호는 그림 위에 얹은 HTML 배지라 그림
 * 배율(휴대폰 폭 112~132px)과 상관없이 CSS 12px 글자다 (SVG 글자로는 6~7px이었다, M12 검토)
 */
function controlsDiagram(team: 'monster' | 'survivor'): string {
  const parts: string[] = [
    '<rect class="tt-frame" x="1" y="1" width="98" height="48" rx="6"/>',
    // 판 화면 (가운데 = 감옥)
    '<rect class="tt-map" x="22" y="4" width="56" height="42" rx="1.5"/>',
    '<rect class="tt-map-in" x="46" y="21" width="8" height="8"/>',
    // 이동 영역 (왼쪽 40%) + 스틱
    '<rect class="tt-zone" x="4" y="4" width="36" height="42" rx="3"/>',
    '<circle class="tt-ctl" cx="15" cy="35" r="7"/>',
    '<circle class="tt-knob" cx="18.5" cy="32" r="2.8"/>',
    // 점수판
    '<rect class="tt-ctl" x="86" y="4.5" width="10" height="6.5" rx="1.2"/>',
  ];
  let spots: Spot[];
  if (team === 'monster') {
    parts.push(
      '<circle class="tt-ctl tt-main" cx="87.5" cy="37" r="8.5"/>',
      '<circle class="tt-ctl" cx="73" cy="38.5" r="3.8"/>',
      '<circle class="tt-ctl" cx="87.5" cy="22.5" r="3.6"/>',
      '<circle class="tt-ctl" cx="78" cy="22.5" r="3.6"/>',
    );
    spots = [
      { n: 1, x: 9, y: 21 },
      { n: 2, x: 91, y: 41.5 },
      { n: 3, x: 66, y: 32 },
      { n: 4, x: 82.5, y: 14 },
    ];
  } else {
    parts.push(
      '<circle class="tt-ctl tt-main" cx="88" cy="38" r="7.5"/>',
      '<circle class="tt-ctl" cx="75" cy="31" r="4.6"/>',
    );
    spots = [
      { n: 1, x: 9, y: 21 },
      { n: 2, x: 80, y: 21 },
      { n: 3, x: 79, y: 9 },
    ];
  }
  const badges = spots.map(
    (s) => `<span class="tt-badge" style="left:${s.x}%;top:${s.y * 2}%">${s.n}</span>`,
  );
  return `<svg viewBox="0 0 100 50" width="100%" height="100%" aria-hidden="true">${parts.join('')}</svg>${badges.join('')}`;
}

/**
 * 판 직전 터치 안내 카드 (MOBILE_PLAN M12 5번): 제목 + 역할별 본문(번호 = 그림의 번호) + "알겠어요".
 * 로비 방 화면은 준비 뒤 명령 줄 바로 위에 띄운다(시작 · 준비 버튼을 가리지 않는다). 빠른 매칭 대기 · 연습 시작 전(M13)도
 * 같은 카드를 만들어 붙인다. 닫으면 onOk (보통 markTouchTutorialShown).
 * 캐릭터 스타일이 새 캐릭터면 제목 왼쪽에 내 역할의 작은 정면 그림(가장 낮은 화면에서도 세로로 쌓지 않는다). 기존이면 그림 없음
 */
export class TouchTutorialCard {
  readonly el: HTMLElement;
  private team: 'monster' | 'survivor' | null = null;
  private role: Role | null = null;
  /** 그린 캐릭터 스타일 (바뀌면 다시 그린다) */
  private style: CharStyle | null = null;
  /** 새 캐릭터 스타일의 내 역할 정면 그림 (기존 스타일이면 null) */
  private figure: HTMLSpanElement | null = null;

  /** 보이는 중이다 (다시 붙여도 등장 움직임을 되풀이하지 않는다) */
  private shown = false;

  constructor(private readonly onOk: () => void) {
    this.el = h('section', { class: 'panel life-tutorial', 'data-testid': 'touch-tutorial' });
    this.el.addEventListener('animationend', () => this.el.classList.remove('life-enter'));
  }

  get visible(): boolean {
    return this.shown;
  }

  /** parent 맨 끝에 붙여 보인다 (이미 보이던 중이면 자리만 옮긴다) */
  show(parent: HTMLElement, role: Role): void {
    this.render(role);
    if (!this.shown) this.el.classList.add('life-enter');
    this.shown = true;
    parent.append(this.el);
  }

  hide(): void {
    this.shown = false;
    this.el.classList.remove('life-enter');
    this.el.remove();
  }

  /**
   * 역할 · 캐릭터 스타일에 맞게 그린다 (같은 역할 · 같은 스타일이면 그대로). 같은 팀 · 같은 스타일이면 본문은 두고
   * 역할색(과 새 캐릭터면 정면 그림)만 바꾼다
   */
  render(role: Role): HTMLElement {
    const team = teamOf(role);
    const style = currentCharStyle();
    if (this.role === role && this.style === style) return this.el;
    const sameBody = this.team === team && this.style === style && this.el.firstChild !== null;
    this.role = role;
    this.style = style;
    this.el.setAttribute('style', roleVars(role));
    if (sameBody) {
      if (this.figure) {
        const next = ttFigure(role);
        this.figure.replaceWith(next);
        this.figure = next;
      }
      return this.el;
    }
    this.team = team;
    this.figure = style === 'new' ? ttFigure(role) : null;
    const title = nextId('tt-title');
    const lines = team === 'monster' ? TOUCH_TEXT.tutorialMonster : TOUCH_TEXT.tutorialSurvivor;
    const ok = h(
      'button',
      { class: 'btn btn-primary', type: 'button', 'data-testid': 'touch-tutorial-ok' },
      icon('check', 18),
      TOUCH_TEXT.tutorialOk,
    );
    ok.addEventListener('click', () => this.onOk());
    const list = h('ol', { class: 'tt-list' });
    for (const line of lines) list.append(h('li', {}, line));
    this.el.setAttribute('aria-labelledby', title);
    const heading = h('h2', { id: title, class: 'tt-title' }, TOUCH_TEXT.tutorialTitle);
    this.el.replaceChildren(
      h('div', { class: 'tt-side' }, svgSpan('tt-art', controlsDiagram(team)), ok),
      h(
        'div',
        { class: 'tt-main-col' },
        // 기존 스타일은 예전과 같은 구조 (제목 바로 아래 목록)
        this.figure ? h('div', { class: 'tt-head' }, this.figure, heading) : heading,
        list,
        // 화면 밖 화살표 뜻 (따라가는 카메라 — 번호 없는 한 줄, 그림에 자리가 없다)
        h(
          'p',
          { class: 'tt-edge', 'data-testid': 'touch-tutorial-edge' },
          (team === 'monster' ? HELP_TEXT.edgeLineMonster : HELP_TEXT.edgeLineSurvivor).replace('  ', ' — '),
        ),
      ),
    );
    return this.el;
  }
}

/** 터치 안내 카드 제목 옆 내 역할 정면 그림 (새 캐릭터 스타일, 장식: 스크린 리더는 건너뜀) */
function ttFigure(role: Role): HTMLSpanElement {
  const s = svgSpan('tt-figure', frontFigureSvg(role));
  s.dataset.testid = 'touch-tutorial-figure';
  return s;
}
