// 로비 화면 (HTML). 방 만들기 · 코드 입장 · 링크 복사 · 역할 카드 · 준비 · 시작 (M10c 리디자인, VISUAL_SPEC 9장)
// 배경은 실제 맵 설계도, 역할 카드는 게임과 같은 실루엣 · 문양. 고른 카드 = 역할색 테두리 + ✓ + "내 역할",
// 남이 고른 카드 = 사선 해치 + 주인 이름 — 색만으로 구분하지 않는다
import type { LobbyPlayer, LobbyState, Role } from '@decoy/shared';
import type { IconId } from '../art/icons';
import {
  HUD_TEXT,
  META_TEXT,
  ROLE_CARDS,
  TOUCH_TEXT,
  UI_TEXT,
  roleAbility,
  type InputMode,
} from '../data/storyText';
import { canOfferFullscreen, device, enterFullscreen } from '../device';
import {
  markTouchTutorialShown,
  requestTouchHints,
  resetTouchTutorial,
  touchTutorialNeeded,
} from '../touchTutorial';
import type { ServerStatusView } from '../serverStatus';
import { currentCharStyle, onCharStyleChange } from '../gfx/charStyle';
import { TouchTutorialCard } from './lifecycleUi';
import type { SettingsPanel } from './settingsPanel';
import {
  blueprintSvg,
  characterFigureSvg,
  glyphSvg,
  h,
  icon,
  keycap,
  logoImg,
  roleVars,
  svgSpan,
} from './uiArt';

export interface LobbyActions {
  create(name: string): void;
  join(code: string, name: string): void;
  /** 봇과 연습 (M13b): 고른 역할로 기기 안에서 바로 시작 */
  practice(role: Role, name: string): void;
  /** 빠른 매칭 대기열에 들어간다 (M13c) */
  quick(name: string): void;
  /** 빠른 매칭 대기 취소 (M13c): 자리를 비우고 첫 화면으로 */
  leaveQueue(): void;
  /** 친구 방 로비에서 나가기 (검토 반영 F09): 자리를 비우고 첫 화면으로 */
  leaveRoom(): void;
  pickRole(role: Role | null): void;
  setReady(ready: boolean): void;
  setName(name: string): void;
  start(): void;
}

const ROLE_ORDER: Role[] = ['monster', 'runner', 'guard', 'scout'];

/**
 * 연습 역할 고르기의 연타 가드 시간 (검토 반영 F17): '봇과 연습'을 빠르게 두 번 탭하면 두 번째 탭이 같은 자리에 막 그려진
 * 역할 버튼에 떨어져, 고르지 않은 역할로 판이 바로 시작됐다. 그린 뒤 이만큼 역할 격자가 포인터를 받지 않는다
 * (style.css '.practice-roles.arming'). 안드로이드 더블 탭 판정 시간(300ms)보다 길게. 키보드(Enter · Space)는 막지 않는다
 */
export const PRACTICE_ARM_MS = 400;
/** 연타 가드 중인 역할 격자에 붙는 클래스 */
export const ARMING_CLASS = 'arming';

/** 막 그린 요소에 연타 가드를 붙였다가 ms 뒤 뗀다 (클래스만 바꾼다 — 포인터를 막는 것은 CSS) */
export function armAgainstDoubleTap(
  el: { classList: { add(token: string): void; remove(token: string): void } },
  ms = PRACTICE_ARM_MS,
): void {
  el.classList.add(ARMING_CLASS);
  globalThis.setTimeout(() => el.classList.remove(ARMING_CLASS), ms);
}

/** 능력 줄(ROLE_CARDS.ability · abilityTouch)의 항목마다 붙는 아이콘 — 문구의 순서와 같다 */
const ABILITY_ICONS: Record<Role, IconId[]> = {
  monster: ['attack', 'visionSearch', 'dash', 'roar'],
  runner: ['sprint'],
  guard: ['shove'],
  scout: ['track'],
};

/** 정면 그림(새 캐릭터)에 붙는 클래스: 정면 그림만 크기 · 자리를 따로 맞춘다 (style.css — 기존 화면은 그대로) */
const FRONT_FIGURE_CLASS = 'front';

/**
 * 역할 그림 상자 (방 역할 카드 rc-figure · 연습 역할 고르기 pr-figure): 캐릭터 스타일을 따른다.
 * 기존 = 위에서 본 실루엣, 새 캐릭터 = 정면 그림 + 'front' 클래스. 그림 하나 = svg 하나
 */
function roleFigure(cls: string, role: Role): HTMLSpanElement {
  const front = currentCharStyle() === 'new';
  return svgSpan(front ? `${cls} ${FRONT_FIGURE_CLASS}` : cls, characterFigureSvg(role));
}

/**
 * 능력 줄 (M12 입력 방식별): 키보드 "Space 질주 — 3초간 …" · "좌클릭 공격 · 우클릭 시야 전환 · …" → 아이콘 · 키캡 · 이름 · 설명,
 * 터치 "질주 — 3초간 …" · "공격 · 시야 전환 · …" → 아이콘 · 이름 · 설명 (키캡 없음, 이름은 터치 버튼과 같다)
 */
function abilityList(role: Role, mode: InputMode): HTMLElement {
  const [head = '', desc] = roleAbility(role, mode).split(' — ');
  const items = head.split(' · ');
  const list = h('span', { class: 'role-ability' });
  items.forEach((item, i) => {
    const id = ABILITY_ICONS[role][i];
    const at = mode === 'touch' ? -1 : item.indexOf(' ');
    list.append(
      h(
        'span',
        {},
        ...(id ? [icon(id, 18)] : []),
        ...(at > 0 ? [keycap(item.slice(0, at))] : []),
        h('span', {}, item.slice(at + 1)),
      ),
    );
  });
  if (desc) list.append(h('span', { class: 'ability-desc' }, desc));
  return list;
}

/** 준비 상태: 아이콘 + 글자 (+ 색) */
function readyState(p: LobbyPlayer): HTMLElement {
  const [cls, id, text]: [string, IconId, string] = !p.connected
    ? ['state off', 'disconnected', HUD_TEXT.offline]
    : p.ready
      ? ['state on', 'ready', UI_TEXT.ready]
      : ['state', 'waiting', UI_TEXT.waiting];
  // 좁은 칩 모양에서는 글자를 숨기고 아이콘만 (스크린 리더용 이름은 남긴다)
  return h('span', { class: cls, title: text }, icon(id, 18), h('span', { class: 'st-text' }, text));
}

export class LobbyUI {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  private errorBox: HTMLDivElement;
  private errorText: HTMLSpanElement;
  private you: string | null = null;
  private lastRoom: string | null = null;
  /** "전체 화면" (휴대폰 브라우저에서만): 첫 화면은 로고 아래, 방 화면은 오른쪽 위 구석 */
  private readonly fsButton: HTMLButtonElement | null = null;
  /** 판 직전 터치 안내 (M12, 터치 모드 · 이 기기에서 처음): 준비 뒤 방장 시작을 기다리는 동안 명령 줄 위 */
  private readonly tutorial = new TouchTutorialCard(() => this.tutorialSeen());
  /** 마지막으로 그린 방 상태 (설정에서 안내 다시 보기를 누르면 그 자리에서 다시 그린다) */
  private lastLobby: LobbyState | null = null;
  /** 방 · 빠른 매칭 역할 카드의 그림 svg 노드 (역할|스타일 → 노드, cardFigure). 스타일이 바뀌면 비운다 */
  private readonly cardFigures = new Map<string, Element>();
  /** 역할 카드 능력 줄의 입력 방식 */
  private readonly mode: InputMode = device.touch ? 'touch' : 'keyboard';
  /** 첫 화면 서버 상태 줄 (M13b): 연결과 상관없이 첫 화면을 그리고 이 줄로 알린다 */
  private readonly statusLine: HTMLDivElement;
  private readonly statusText: HTMLSpanElement;
  private status: ServerStatusView = { status: 'waking', seconds: 0 };
  /** 연결이 필요한 첫 화면 버튼 (연결 전에는 끈다) */
  private netButtons: HTMLButtonElement[] = [];
  private netButtonsExtra: HTMLButtonElement | null = null;
  /** 빠른 매칭 대기 화면의 남은 시간 글자와 자동 시작 시각(서버 시계, M13c) */
  private quickCountdown: HTMLElement | null = null;
  private quickStartAt: number | null = null;

  constructor(
    host: HTMLElement,
    private readonly actions: LobbyActions,
    private readonly defaultName: string,
    /**
     * 설정 화면 (설정 화면 통합: PC · 터치 같은 화면). 첫 화면 패널 아래 · 방 화면 · 빠른 매칭 대기 명령 줄에 '설정' 단추를 둔다.
     * 화면 자체는 #ui-root에 있다(판 중에도 열린다 — App이 만든다)
     */
    private readonly settings: SettingsPanel,
    /**
     * 내 레벨 (GAME_DESIGN 12장, 내 기기 기록으로만 — 남의 레벨은 그리지 않는다): 첫 화면은 이름 칸 옆, 연습 고르기는 취소 옆에 칩
     * (요소 하나를 옮겨 붙인다 — 높이를 늘리지 않는 자리), 방 · 빠른 매칭 대기는 내 줄의 '나' 옆에 "Lv n" 꼬리표
     */
    private readonly myLevel: { chip: HTMLElement; level: () => number } | null = null,
  ) {
    this.root = h('div', { class: 'lobby', 'data-testid': 'lobby' });
    // 배경 레이어는 한 번만 만든다 (방 상태가 바뀔 때마다 다시 그리는 것은 내용뿐)
    const bg = h('div', { class: 'lobby-bg', 'aria-hidden': 'true' });
    bg.innerHTML = blueprintSvg();
    bg.append(h('div', { class: 'lobby-scan' }), h('div', { class: 'lobby-vignette' }));
    this.content = h('div', { class: 'lobby-content' });
    this.errorText = h('span', { 'data-testid': 'lobby-error' });
    this.errorBox = h('div', { class: 'lobby-error', role: 'alert' }, icon('warn', 18), this.errorText);
    this.showError('');
    this.statusText = h('span', { class: 'status-text' });
    this.statusLine = h(
      'div',
      { class: 'server-status', 'data-testid': 'server-status', role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'status-dot', 'aria-hidden': 'true' }),
      this.statusText,
    );
    this.root.append(bg, this.content);
    // 휴대폰 브라우저: "전체 화면" (누르면 전체 화면 + 가로 고정, M11). 준비 · 코드 입장도 같은 요청을 한다
    if (canOfferFullscreen()) {
      this.fsButton = h(
        'button',
        { class: 'btn lobby-fs', type: 'button', 'data-testid': 'lobby-fullscreen' },
        icon('fullscreen', 18),
        TOUCH_TEXT.fullscreen,
      );
      this.fsButton.addEventListener('click', enterFullscreen);
      this.root.classList.add('has-fs');
    }
    host.appendChild(this.root);
    // 캐릭터 스타일이 바뀌면 (첫 화면 선택 상자 · 휴대폰 설정 판 · 디버그 훅) 보이는 역할 그림을 맞춘다.
    // LobbyUI는 앱과 수명이 같다(app.ts가 한 번 만든다): 구독을 풀 때가 없다
    onCharStyleChange(() => this.charStyleChanged());
  }

  /**
   * 캐릭터 스타일이 바뀌었다: 방 화면 · 빠른 매칭 대기 화면은 다시 그리고(역할 카드), 연습 역할 고르기는 그림만 바꾼다.
   * 첫 화면은 다시 그리지 않는다(입력한 이름 · 방 코드가 지워진다) — 선택 상자 값만 맞춘다. 숨어 있으면(판 중) 다음에 그릴 때 따른다
   */
  private charStyleChanged(): void {
    this.cardFigures.clear();
    if (this.root.style.display === 'none') return;
    if (this.lastLobby && this.atRoom) {
      // 빠른 매칭 남은 시간 글자는 다음 tick(0.25초)까지 비므로 그대로 옮겨 둔다
      const countdown = this.quickCountdown?.textContent ?? '';
      this.renderRoom(this.lastLobby);
      if (this.quickCountdown && countdown !== '' && this.quickCountdown.textContent === '')
        this.quickCountdown.textContent = countdown;
      return;
    }
    for (const role of ROLE_ORDER)
      this.content
        .querySelector(`[data-testid="practice-role-${role}"] > .pr-figure`)
        ?.replaceWith(roleFigure('pr-figure', role));
  }

  /** 설정 화면의 '터치 조작 안내 다시 보기': 방에서 준비한 채 기다리는 중이면 그 자리에서 다시 보인다 */
  tutorialReset(): void {
    resetTouchTutorial();
    if (this.lastLobby && this.atRoom) this.renderRoom(this.lastLobby);
  }

  /** 조작 배치 편집을 닫은 뒤: 떠 있는 판 직전 터치 안내 그림을 바꾼 배치로 다시 그린다 */
  refreshTutorial(): void {
    this.tutorial.refresh();
  }

  /** 첫 화면이 보이는 중인가 */
  get atHome(): boolean {
    return this.root.style.display !== 'none' && this.content.classList.contains('lobby-home');
  }

  private get atRoom(): boolean {
    return this.root.style.display !== 'none' && this.content.classList.contains('lobby-room');
  }

  /**
   * 판이 시작한다 (서버 match): 판 직전 안내가 떠 있었으면 본 것으로 친다 — 그 판의 처음 10초 위치 표시는
   * 판 장면이 takeTouchHints()로 가져간다. 설정 판도 닫는다
   */
  matchStarting(): void {
    if (this.tutorial.visible) this.tutorialSeen();
    if (this.settings.context === 'lobby') this.settings.close();
  }

  private tutorialSeen(): void {
    markTouchTutorialShown();
    this.tutorial.hide();
  }

  setYou(id: string): void {
    this.you = id;
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** 오류 문구 (빈 문자열이면 숨김) */
  showError(message: string): void {
    this.errorText.textContent = message;
    this.errorBox.hidden = message === '';
  }

  /** 방 · 빠른 매칭 대기 내 줄의 "Lv n" (내 기기 기록) */
  private levelTag(): HTMLElement[] {
    if (!this.myLevel) return [];
    return [
      h(
        'span',
        { class: 'tag tag-lv num', 'data-testid': 'my-level' },
        `${META_TEXT.levelShort} ${this.myLevel.level()}`,
      ),
    ];
  }

  private brand(hero: boolean): HTMLElement {
    const text = h('div', { class: 'brand-text' }, h('div', { class: 'wordmark' }, UI_TEXT.title));
    if (hero) text.append(h('div', { class: 'brand-sub' }, UI_TEXT.subtitle));
    return h('div', { class: hero ? 'brand brand-hero' : 'brand' }, logoImg('brand-logo'), text);
  }

  /** 첫 화면: 빠른 매칭 · 봇과 연습 · 방 만들기 / 코드로 입장. queueDropped면 "대기열에서 빠졌어요 — 다시 찾기" (M13c) */
  renderHome(prefillCode = '', queueDropped = false): void {
    this.lastLobby = null;
    this.quickCountdown = null;
    this.netButtonsExtra = null;
    this.tutorial.hide();
    const name = h('input', {
      'data-testid': 'name-input',
      placeholder: UI_TEXT.namePlaceholder,
      maxlength: '12',
      'aria-label': UI_TEXT.namePlaceholder,
    });
    name.value = this.defaultName;
    // 빠른 매칭 (M13c): 모르는 사람과 자동으로 (서버 연결이 필요)
    const quickBtn = h(
      'button',
      { class: 'btn btn-primary btn-wide', 'data-testid': 'quick-match' },
      icon('play', 20),
      UI_TEXT.quickMatch,
    );
    quickBtn.addEventListener('click', () => {
      if (quickBtn.disabled) return;
      enterFullscreen();
      this.showError('');
      this.actions.quick(name.value);
    });
    const create = h('button', { class: 'btn btn-wide', 'data-testid': 'create-room' }, UI_TEXT.createRoom);
    create.addEventListener('click', () => {
      this.showError('');
      this.actions.create(name.value);
    });
    const code = h('input', {
      'data-testid': 'room-code-input',
      placeholder: UI_TEXT.roomCodePlaceholder,
      maxlength: '4',
      'aria-label': UI_TEXT.roomCodePlaceholder,
    });
    code.value = prefillCode;
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase();
    });
    const join = h('button', { class: 'btn', 'data-testid': 'join-room' }, UI_TEXT.joinRoom);
    // 봇과 연습 (M13b): 서버 연결과 상관없이 된다 (기기 안에서 판정)
    const practice = h(
      'button',
      { class: 'btn btn-wide btn-practice', 'data-testid': 'practice' },
      icon('replay', 20),
      UI_TEXT.practice,
    );
    practice.addEventListener('click', () => {
      this.showError('');
      this.renderPracticePicker(name.value);
    });
    const doJoin = (): void => {
      // 연결 전에는 입장 버튼이 꺼져 있다 (Enter도 같다)
      if (code.value.trim().length === 0 || join.disabled) return;
      enterFullscreen();
      this.showError('');
      this.actions.join(code.value.trim(), name.value);
    };
    join.addEventListener('click', doJoin);
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    // 상태 줄 · 오류 줄은 이름 칸 바로 아래 (검토 반영 F14): 패널 맨 아래면 높이 360 이하 휴대폰 가로 · 태블릿에서 화면 밖이라
    // 꺼진 빠른 매칭 · 방 만들기 · 입장의 이유와 입장 실패 오류가 보이지 않았다
    const panel = h(
      'div',
      { class: 'panel home-panel' },
      h(
        'div',
        { class: 'name-row' },
        h('label', { class: 'field' }, name),
        ...(this.myLevel ? [this.myLevel.chip] : []),
      ),
      this.statusLine,
      this.errorBox,
      ...(queueDropped ? [this.droppedRow(() => this.actions.quick(name.value))] : []),
      quickBtn,
      practice,
      create,
      h('div', { class: 'divider' }),
      h('div', { class: 'row' }, h('label', { class: 'field field-code' }, code), join),
    );
    this.netButtons = [quickBtn, create, join];
    this.applyStatus();
    this.content.className = 'lobby-content lobby-home';
    const brand = this.brand(true);
    brand.querySelector('.brand-text')?.append(this.brandActions(), privacyLink());
    this.content.replaceChildren(brand, panel);
    this.show();
  }

  /**
   * 봇과 연습: 역할 고르기 (첫 화면 자리). 고르면 바로 시작한다 — 앱을 연 뒤 탭 2번(봇과 연습 → 역할) 안에 판.
   * 터치 기기에서 아직 조작 안내를 보지 않았으면 안내 카드 대신 그 판의 처음 10초 위치 표시만 한다
   */
  renderPracticePicker(name: string): void {
    this.lastLobby = null;
    this.quickCountdown = null;
    this.netButtonsExtra = null;
    this.tutorial.hide();
    const grid = h('div', { class: 'practice-roles' });
    // '봇과 연습'을 두 번 탭한 두 번째 탭이 막 그린 역할 버튼에 떨어지지 않게 잠깐 포인터를 막는다 (검토 반영 F17)
    armAgainstDoubleTap(grid);
    for (const role of ROLE_ORDER) {
      const info = ROLE_CARDS[role];
      const b = h(
        'button',
        { class: 'practice-role cut', 'data-testid': `practice-role-${role}`, style: roleVars(role) },
        roleFigure('pr-figure', role),
        h(
          'span',
          { class: 'rc-head' },
          svgSpan('glyph', glyphSvg(role)),
          h('span', { class: 'role-name' }, info.name),
        ),
      );
      b.addEventListener('click', () => {
        // 휴대폰: 판 시작은 메시지라 그때는 전체 화면을 요청할 수 없다. 탭할 때 (M11과 같다)
        enterFullscreen();
        if (device.touch && touchTutorialNeeded()) requestTouchHints();
        this.actions.practice(role, name);
      });
      grid.append(b);
    }
    const cancel = h('button', { class: 'btn', 'data-testid': 'practice-cancel' }, UI_TEXT.practiceCancel);
    cancel.addEventListener('click', () => this.renderHome());
    // 상태 줄 · 오류 줄은 안내 바로 아래 (첫 화면과 같은 자리, 검토 반영 F14)
    const panel = h(
      'div',
      { class: 'panel home-panel practice-panel', 'data-testid': 'practice-picker' },
      h('div', { class: 'lobby-hint' }, UI_TEXT.practicePick),
      this.statusLine,
      this.errorBox,
      grid,
      h('div', { class: 'action-row' }, ...(this.myLevel ? [this.myLevel.chip] : []), cancel),
    );
    this.netButtons = [];
    this.applyStatus();
    this.content.className = 'lobby-content lobby-home';
    const brand = this.brand(true);
    brand.querySelector('.brand-text')?.append(this.brandActions(), privacyLink());
    this.content.replaceChildren(brand, panel);
    this.show();
  }

  /**
   * 첫 화면 · 연습 고르기 로고 아래 단추 줄: 전체 화면(휴대폰 브라우저) · 설정(설정 화면 통합 — PC · 터치 같은 자리, 휴대폰 가로
   * 화면에서도 스크롤 없이 보인다)
   */
  private brandActions(): HTMLElement {
    return h(
      'div',
      { class: 'brand-actions' },
      ...(this.fsButton ? [this.fsButton] : []),
      this.settings.button(),
    );
  }

  /** "대기열에서 빠졌어요 — 다시 찾기" (대기 중 화면을 숨겼거나 응답이 없어 서버가 뺀 뒤) */
  private droppedRow(retry: () => void): HTMLElement {
    const again = h(
      'button',
      { class: 'btn', 'data-testid': 'quick-retry' },
      icon('replay', 18),
      UI_TEXT.quickRetry,
    );
    again.addEventListener('click', () => {
      if (again.disabled) return;
      retry();
    });
    this.netButtonsExtra = again;
    return h(
      'div',
      { class: 'quick-dropped', role: 'status', 'data-testid': 'quick-dropped' },
      icon('warn', 18),
      h('span', {}, UI_TEXT.quickDropped),
      again,
    );
  }

  /**
   * 빠른 매칭 대기 화면 (M13c): 인원 · 자동 시작까지 남은 시간 · 역할 카드(다른 사람은 "플레이어 n") · 취소.
   * 준비 · 방장 시작은 없다. 남은 시간은 tick()이 서버 시계로 센다
   */
  private renderQuick(lobby: LobbyState): void {
    const me = lobby.players.find((p) => p.id === this.you);
    const cards = h('div', { class: 'role-cards' });
    for (const role of ROLE_ORDER) cards.appendChild(this.roleCard(role, lobby));
    const count = h(
      'span',
      { class: 'chip quick-count', 'data-testid': 'quick-count' },
      icon('scoreboard', 18),
      h('span', { class: 'num' }, UI_TEXT.quickCount.replace('{n}', String(lobby.players.length))),
    );
    this.quickStartAt = lobby.autoStartAt;
    this.quickCountdown = h('div', { class: 'lobby-hint quick-countdown', 'data-testid': 'quick-countdown' });
    if (lobby.autoStartAt === null) this.quickCountdown.textContent = UI_TEXT.quickHumansOnly;
    const cancel = h(
      'button',
      { class: 'btn', 'data-testid': 'quick-cancel' },
      icon('back', 18),
      UI_TEXT.quickCancel,
    );
    cancel.addEventListener('click', () => this.actions.leaveQueue());
    // 모인 사람 (다른 사람은 서버가 익명 "플레이어 n"으로 보낸다, 봇 여부는 결과 화면에서만)
    const people = h('div', { class: 'quick-people', 'data-testid': 'quick-people' });
    for (const p of lobby.players) {
      const avatar = p.role ? svgSpan('avatar', glyphSvg(p.role)) : h('span', { class: 'avatar none' });
      people.append(
        h(
          'span',
          { class: 'chip quick-person', style: p.role ? roleVars(p.role) : undefined },
          avatar,
          h('span', { class: 'nm' }, p.name),
          ...(p.id === this.you ? [h('span', { class: 'tag' }, UI_TEXT.me), ...this.levelTag()] : []),
        ),
      );
    }
    const head = h(
      'div',
      { class: 'panel quick-head' },
      h('div', { class: 'quick-title' }, icon('visionSearch', 20), h('span', {}, UI_TEXT.quickTitle)),
      count,
      this.quickCountdown,
      people,
    );
    const actions = h(
      'div',
      { class: device.touch ? 'lobby-actions life-anchor' : 'lobby-actions' },
      h('div', { class: 'action-row' }, this.settings.button(), cancel),
      h('div', { class: 'lobby-hint', 'data-testid': 'lobby-hint' }, me?.role ? '' : UI_TEXT.quickPickHint),
      this.errorBox,
    );
    // 판 직전 터치 안내 (M12 카드): 역할을 고른 뒤 기다리는 동안
    if (device.touch && me?.role && touchTutorialNeeded()) this.tutorial.show(actions, me.role);
    else this.tutorial.hide();
    this.content.className = 'lobby-content lobby-room lobby-quick';
    if (this.fsButton) this.root.append(this.fsButton);
    this.content.replaceChildren(h('div', { class: 'lobby-top' }, this.brand(false), head), cards, actions);
    this.show();
  }

  /** 0.25초마다 (App): 빠른 매칭 대기 남은 시간을 서버 시계로 센다 */
  tick(serverNow: number): void {
    const el = this.quickCountdown;
    const at = this.quickStartAt;
    if (!el || at === null || !el.isConnected) return;
    const left = Math.ceil((at - serverNow) / 1000);
    const text = left > 0 ? UI_TEXT.quickAutoStart.replace('{n}', String(left)) : UI_TEXT.quickStarting;
    if (el.textContent !== text) el.textContent = text;
  }

  /** 첫 화면 서버 상태 줄 (App이 0.25초마다 부른다). 바뀐 게 없으면 DOM을 건드리지 않는다 */
  setServerStatus(view: ServerStatusView): void {
    if (view.status === this.status.status && view.seconds === this.status.seconds) return;
    this.status = view;
    this.applyStatus();
  }

  private applyStatus(): void {
    const v = this.status;
    this.statusLine.dataset.state = v.status;
    this.statusText.textContent =
      v.status === 'connected'
        ? UI_TEXT.statusConnected
        : v.status === 'offline'
          ? UI_TEXT.statusOffline
          : v.status === 'unreachable'
            ? UI_TEXT.statusUnreachable
            : UI_TEXT.statusWaking.replace('{n}', String(v.seconds));
    // 연결이 필요한 버튼은 연결 전에 끈다 (봇과 연습은 늘 된다)
    for (const b of this.netButtons) b.disabled = v.status !== 'connected';
    if (this.netButtonsExtra) this.netButtonsExtra.disabled = v.status !== 'connected';
  }

  /** 방 로비 (빠른 매칭 방이면 대기 화면) */
  renderRoom(lobby: LobbyState): void {
    if (this.lastRoom !== lobby.room) this.showError('');
    if (lobby.kind === 'quick') {
      this.lastRoom = lobby.room;
      this.lastLobby = lobby;
      this.renderQuick(lobby);
      return;
    }
    this.quickCountdown = null;
    this.lastRoom = lobby.room;
    this.lastLobby = lobby;
    const me = lobby.players.find((p) => p.id === this.you);
    const isHost = me?.host ?? false;

    // 초대: 방 코드 4칸 키캡 + 링크 복사
    const link = `${window.location.origin}${window.location.pathname}?room=${lobby.room}`;
    const linkText = h('input', {
      readonly: 'true',
      'data-testid': 'room-link',
      'aria-label': UI_TEXT.inviteLink,
    });
    linkText.value = link;
    const copyLabel = h('span', {}, UI_TEXT.copyLink);
    const copy = h('button', { class: 'btn', 'data-testid': 'copy-link' }, icon('link', 18), copyLabel);
    copy.addEventListener('click', () => void copyText(link, linkText, copyLabel));
    const code = h('div', {
      class: 'room-code',
      'data-testid': 'room-code',
      'aria-label': `${UI_TEXT.roomCodeLabel} ${lobby.room}`,
    });
    for (const ch of lobby.room) code.append(h('span', { class: 'keytile' }, ch));
    const invite = h(
      'div',
      { class: 'panel invite' },
      h('div', { class: 'invite-code' }, h('span', { class: 'label' }, UI_TEXT.roomCodeLabel), code),
      h('div', { class: 'invite-link' }, h('label', { class: 'field' }, linkText), copy),
    );

    const cards = h('div', { class: 'role-cards' });
    for (const role of ROLE_ORDER) cards.appendChild(this.roleCard(role, lobby));

    const list = h('div', { class: 'panel player-list', 'data-testid': 'player-list' });
    for (const p of lobby.players) {
      const name = h('span', { class: 'player-name' });
      // 왕관은 그림이라 낭독기에 이름을 따로 준다 (아이콘 span은 aria-hidden)
      if (p.host)
        name.append(h('span', { role: 'img', 'aria-label': UI_TEXT.host }, icon('crown', 16, 'host')));
      name.append(h('span', { class: 'nm' }, p.name));
      if (p.id === this.you) name.append(h('span', { class: 'tag' }, UI_TEXT.me), ...this.levelTag());
      if (p.bot) name.append(h('span', { class: 'tag tag-bot' }, UI_TEXT.bot));
      const avatar = p.role ? svgSpan('avatar', glyphSvg(p.role)) : h('span', { class: 'avatar none' });
      list.append(
        h(
          'div',
          { class: `player${p.connected ? '' : ' offline'}`, style: p.role ? roleVars(p.role) : undefined },
          avatar,
          name,
          h('span', { class: 'player-role' }, p.role ? ROLE_CARDS[p.role].name : '—'),
          readyState(p),
        ),
      );
    }

    // 빈자리 (역할 수만큼 자리가 있다)
    for (let i = lobby.players.length; i < ROLE_ORDER.length; i += 1)
      list.append(h('div', { class: 'player-slot' }, h('span', { class: 'avatar none' }), UI_TEXT.emptySlot));

    const ready = h(
      'button',
      { class: `btn${me?.ready ? '' : ' btn-primary'}`, 'data-testid': 'ready-button' },
      icon(me?.ready ? 'waiting' : 'ready', 20),
      me?.ready ? UI_TEXT.notReady : UI_TEXT.ready,
    );
    if (!me?.role) ready.setAttribute('disabled', 'true');
    ready.addEventListener('click', () => {
      // 휴대폰: 판 시작은 서버 메시지라 그때는 전체 화면을 요청할 수 없다. 준비를 누를 때 미리 (M11)
      if (!me?.ready) enterFullscreen();
      this.actions.setReady(!(me?.ready ?? false));
    });
    // 나가기 (검토 반영 F09): 방에서 나가 첫 화면으로. 없으면 설치 앱 · 휴대폰에서 방 로비가 막다른 길이었다
    // (뒤로 가기는 앱을 닫고, 30초 안에 다시 열면 같은 방으로 돌아온다)
    const leave = h(
      'button',
      { class: 'btn room-leave', 'data-testid': 'room-leave' },
      icon('back', 18),
      UI_TEXT.roomLeave,
    );
    leave.addEventListener('click', () => this.actions.leaveRoom());
    const buttons = h('div', { class: 'action-row' }, leave, this.settings.button(), ready);
    if (isHost) {
      const start = h(
        'button',
        { class: 'btn btn-primary', 'data-testid': 'start-button' },
        icon('play', 18),
        UI_TEXT.start,
      );
      if (!lobby.canStart) start.setAttribute('disabled', 'true');
      start.addEventListener('click', () => this.actions.start());
      buttons.appendChild(start);
    }
    let hintText = !me?.role ? UI_TEXT.chooseRole : (lobby.waitingFor ?? (isHost ? '' : UI_TEXT.waitingHost));
    if (lobby.bots) hintText = `${hintText} · ${UI_TEXT.botsFill}`;
    // 준비 · 시작: 가운데 명령 줄 (안내 · 오류는 그 아래)
    const actions = h(
      'div',
      { class: device.touch ? 'lobby-actions life-anchor' : 'lobby-actions' },
      buttons,
      h('div', { class: 'lobby-hint', 'data-testid': 'lobby-hint' }, hintText),
      this.errorBox,
    );
    // 판 직전 터치 안내: 터치 모드에서 역할을 고르고 준비한 뒤 (이 기기에서 처음이거나 다시 보기를 눌렀을 때)
    if (device.touch && me?.role && me.ready && lobby.phase === 'lobby' && touchTutorialNeeded())
      this.tutorial.show(actions, me.role);
    else this.tutorial.hide();

    // 로비 상태가 올 때마다 방 화면을 새로 만든다. 키보드 포커스가 body로 날아가지 않게 같은 요소(data-testid)로 돌려준다
    const active = document.activeElement;
    const focusId =
      active instanceof HTMLElement && this.content.contains(active) ? active.dataset.testid : undefined;
    this.content.className = 'lobby-content lobby-room';
    if (this.fsButton) this.root.append(this.fsButton);
    this.content.replaceChildren(
      h('div', { class: 'lobby-top' }, this.brand(false), invite),
      cards,
      list,
      actions,
    );
    this.show();
    if (focusId)
      this.content.querySelector<HTMLElement>(`[data-testid="${focusId}"]`)?.focus({ preventScroll: true });
  }

  /**
   * 방 · 빠른 매칭 역할 카드 그림. 로비 상태가 올 때마다 카드를 새로 만들지만, 그림 svg 노드는 같은 역할 · 스타일이면 앞 화면의 것을
   * 새 카드로 옮겨 쓴다(새 캐릭터 정면 그림은 하나에 약 30KB · 경로 100개 — 준비 · 이름이 바뀔 때마다 다시 해석하지 않게).
   * 한 화면에 역할마다 카드가 하나라 옮겨도 겹치지 않는다
   */
  private cardFigure(role: Role): HTMLSpanElement {
    const style = currentCharStyle();
    const key = `${role}|${style}`;
    const cached = this.cardFigures.get(key);
    if (!cached) {
      const span = roleFigure('rc-figure', role);
      const svg = span.querySelector(':scope > svg');
      if (svg) this.cardFigures.set(key, svg);
      return span;
    }
    const span = h('span', {
      class: style === 'new' ? `rc-figure ${FRONT_FIGURE_CLASS}` : 'rc-figure',
      'aria-hidden': 'true',
    });
    span.append(cached);
    return span;
  }

  /** 역할 카드: 큰 실루엣 + 문양 + 이름 + 소개 + 능력(키캡) + 주인 */
  private roleCard(role: Role, lobby: LobbyState): HTMLElement {
    const info = ROLE_CARDS[role];
    const owner = lobby.players.find((p) => p.role === role);
    const mine = owner !== undefined && owner.id === this.you;
    const taken = owner !== undefined && !mine;
    const figure = this.cardFigure(role);
    if (mine) {
      figure.removeAttribute('aria-hidden');
      figure.append(h('span', { class: 'rc-tag' }, icon('check', 15), UI_TEXT.myRole));
    }
    const ownerRow = owner
      ? h(
          'span',
          { class: 'role-owner' },
          h('span', { class: 'owner-name' }, owner.name),
          ...(owner.id === this.you ? [h('span', { class: 'tag' }, UI_TEXT.me)] : []),
          readyState(owner),
        )
      : h('span', { class: 'role-owner empty' }, h('span', { class: 'avatar none' }), UI_TEXT.emptySlot);
    const body = h(
      'span',
      { class: 'rc-body cut' },
      figure,
      h(
        'span',
        { class: 'rc-head' },
        svgSpan('glyph', glyphSvg(role)),
        h('span', { class: 'role-name' }, info.name),
      ),
      h('span', { class: 'role-intro' }, info.intro),
      abilityList(role, this.mode),
      ownerRow,
    );
    const card = h(
      'button',
      {
        class: `role-card${mine ? ' mine' : ''}${taken ? ' taken' : ''}`,
        'data-testid': `role-${role}`,
        style: roleVars(role),
        'aria-pressed': mine ? 'true' : 'false',
        'aria-disabled': taken ? 'true' : undefined,
      },
      body,
    );
    card.addEventListener('click', () => {
      if (mine) this.actions.pickRole(null);
      else if (!owner) this.actions.pickRole(role);
    });
    return card;
  }
}

/** 링크 복사: clipboard API → execCommand → 직접 복사 안내 (http 같은 와이파이 접속 대비) */
async function copyText(text: string, input: HTMLInputElement, label: HTMLElement): Promise<void> {
  const done = (msg: string): void => {
    label.textContent = msg;
    window.setTimeout(() => {
      label.textContent = UI_TEXT.copyLink;
    }, 1500);
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      done(UI_TEXT.copied);
      return;
    }
  } catch {
    // 아래 방법으로
  }
  input.focus();
  input.select();
  try {
    // 보안 컨텍스트가 아닐 때(같은 와이파이 http 접속)의 대체 수단
    if (document.execCommand('copy')) {
      done(UI_TEXT.copied);
      return;
    }
  } catch {
    // 아래 안내로
  }
  done(UI_TEXT.copyManual);
}

/** 처리방침 링크 (M15, 플레이 정책: 앱 안에서도 열 수 있어야 한다). 첫 화면 로고 아래. 같은 탭으로 열어 설치 앱 안에서 열린다 */
function privacyLink(): HTMLAnchorElement {
  return h('a', { class: 'privacy-link', href: '/privacy', 'data-testid': 'privacy-link' }, UI_TEXT.privacy);
}
