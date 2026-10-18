// 로비 화면 (HTML). 방 만들기 · 코드 입장 · 링크 복사 · 역할 카드 · 준비 · 시작 (M10c 리디자인, VISUAL_SPEC 9장)
// 배경은 실제 맵 설계도, 역할 카드는 게임과 같은 실루엣 · 문양. 고른 카드 = 역할색 테두리 + ✓ + "내 역할",
// 남이 고른 카드 = 사선 해치 + 주인 이름 — 색만으로 구분하지 않는다
import type { LobbyPlayer, LobbyState, Role } from '@decoy/shared';
import type { IconId } from '../art/icons';
import { HUD_TEXT, ROLE_CARDS, TOUCH_TEXT, UI_TEXT, roleAbility, type InputMode } from '../data/storyText';
import { canOfferFullscreen, device, enterFullscreen } from '../device';
import { haptics } from '../haptics';
import {
  markTouchTutorialShown,
  requestTouchHints,
  resetTouchTutorial,
  touchTutorialNeeded,
} from '../touchTutorial';
import type { ServerStatusView } from '../serverStatus';
import {
  loadFrameLimit,
  pacingHooks,
  parseFrameLimit,
  saveFrameLimit,
  type FrameLimit,
} from '../gfx/framePacing';
import {
  loadSavedQuality,
  parseQualityChoice,
  qualityHooks,
  saveQualityChoice,
  type QualityChoice,
} from '../gfx/quality';
import {
  CHAR_STYLES,
  currentCharStyle,
  onCharStyleChange,
  parseCharStyle,
  setCharStyle,
  type CharStyle,
} from '../gfx/charStyle';
import { SettingsMenu, TouchTutorialCard } from './lifecycleUi';
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

/** 그래픽 품질 선택지 */
const QUALITY_OPTIONS: readonly { value: QualityChoice; label: string }[] = [
  { value: 'auto', label: UI_TEXT.qualityAuto },
  { value: 'high', label: UI_TEXT.qualityHigh },
  { value: 'medium', label: UI_TEXT.qualityMedium },
  { value: 'low', label: UI_TEXT.qualityLow },
];

/** 프레임 제한 선택지 (렌더링 최적화): 자동(화면 주사율) · 60(배터리 절약) · 120 */
const FRAME_LIMIT_OPTIONS: readonly { value: FrameLimit; label: string }[] = [
  { value: 'auto', label: UI_TEXT.frameLimitAuto },
  { value: '60', label: UI_TEXT.frameLimit60 },
  { value: '120', label: UI_TEXT.frameLimit120 },
];

/** 캐릭터 스타일 선택지 (캐릭터 리디자인 2단계): 기존 · 새 캐릭터 */
const CHAR_STYLE_LABELS: Record<CharStyle, string> = {
  classic: UI_TEXT.charStyleClassic,
  new: UI_TEXT.charStyleNew,
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
  /** 이번 접속에서 고른 품질 (저장하지 못했어도 선택 상자를 다시 그릴 때 이 값을 보여 준다) */
  private qualityChoice: QualityChoice | null = null;
  /** 이번 접속에서 고른 프레임 제한 (품질과 같다: 저장하지 못했어도 다시 그릴 때 이 값) */
  private frameLimitChoice: FrameLimit | null = null;
  /** "전체 화면" (휴대폰 브라우저에서만): 첫 화면은 로고 아래, 방 화면은 오른쪽 위 구석 */
  private readonly fsButton: HTMLButtonElement | null = null;
  /** 설정 (M12, 터치 모드에서만: 진동 · 프레임 제한 · 터치 안내 다시 보기). 첫 화면은 그래픽 줄 옆, 방 화면은 명령 줄 왼쪽 */
  private readonly settings: SettingsMenu | null = null;
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
    if (device.touch) {
      const menu = new SettingsMenu(this.root, {
        haptics: haptics.supported,
        frameLimit: true,
        tutorial: true,
        hapticsOn: () => haptics.enabled,
        setHaptics: (on) => haptics.setEnabled(on),
        frameLimitNow: () => this.frameLimitNow(),
        setFrameLimit: (limit) => this.chooseFrameLimit(limit),
        replayTutorial: () => {
          resetTouchTutorial();
          // 방에서 준비한 채 기다리는 중이면 바로 다시 보인다
          if (this.lastLobby && this.atRoom) this.renderRoom(this.lastLobby);
        },
      });
      if (menu.useful) this.settings = menu;
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
    const select = this.content.querySelector<HTMLSelectElement>('[data-testid="char-style-select"]');
    if (select) select.value = currentCharStyle();
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
    this.settings?.close();
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
    this.settings?.close();
  }

  /** 오류 문구 (빈 문자열이면 숨김) */
  showError(message: string): void {
    this.errorText.textContent = message;
    this.errorBox.hidden = message === '';
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
    this.settings?.close();
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
      h('label', { class: 'field' }, name),
      this.statusLine,
      this.errorBox,
      ...(queueDropped ? [this.droppedRow(() => this.actions.quick(name.value))] : []),
      quickBtn,
      practice,
      create,
      h('div', { class: 'divider' }),
      h('div', { class: 'row' }, h('label', { class: 'field field-code' }, code), join),
      ...this.qualityRow(),
    );
    this.netButtons = [quickBtn, create, join];
    this.applyStatus();
    this.content.className = 'lobby-content lobby-home';
    const brand = this.brand(true);
    if (this.fsButton) brand.querySelector('.brand-text')?.append(this.fsButton);
    brand.querySelector('.brand-text')?.append(privacyLink());
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
    this.settings?.close();
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
      h('div', { class: 'action-row' }, cancel),
    );
    this.netButtons = [];
    this.applyStatus();
    this.content.className = 'lobby-content lobby-home';
    const brand = this.brand(true);
    if (this.fsButton) brand.querySelector('.brand-text')?.append(this.fsButton);
    brand.querySelector('.brand-text')?.append(privacyLink());
    this.content.replaceChildren(brand, panel);
    this.show();
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
          ...(p.id === this.you ? [h('span', { class: 'tag' }, UI_TEXT.me)] : []),
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
      h('div', { class: 'action-row' }, ...(this.settings ? [this.settings.button()] : []), cancel),
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

  /**
   * 그래픽: 자동 / 높음 / 중간 / 낮음. 고르면 저장하고 바로 적용한다 (gfx/quality.ts, main.ts).
   * 저장하지 못해도 이번 접속에는 고른 값이 적용되고, 저장되지 않는다는 안내를 짧게 띄운다.
   * 같은 줄 오른쪽: PC는 프레임 제한 선택 상자, 터치는 설정 단추(프레임 제한 · 캐릭터 스타일은 설정 판 안).
   * PC는 그 아래 줄에 캐릭터 스타일 선택 상자
   */
  private qualityRow(): HTMLElement[] {
    // 저장 실패 안내는 품질 · 프레임 제한 · 캐릭터 스타일이 함께 쓴다 (저장소가 막히면 셋 다 못 쓴다)
    let qualityUnsaved = false;
    let frameUnsaved = false;
    let styleUnsaved = false;
    const select = h('select', { 'data-testid': 'quality-select' });
    const current: QualityChoice = this.qualityChoice ?? loadSavedQuality() ?? 'auto';
    for (const o of QUALITY_OPTIONS) {
      const opt = h('option', { value: o.value }, o.label);
      if (o.value === current) opt.selected = true;
      select.appendChild(opt);
    }
    const note = h(
      'div',
      { class: 'lobby-hint quality-note', 'data-testid': 'quality-note' },
      UI_TEXT.qualityNotSaved,
    );
    note.hidden = true;
    const syncNote = (): void => {
      note.hidden = !(qualityUnsaved || frameUnsaved || styleUnsaved);
    };
    select.addEventListener('change', () => {
      const choice = parseQualityChoice(select.value);
      if (!choice) return;
      this.qualityChoice = choice;
      qualityUnsaved = !saveQualityChoice(choice);
      syncNote();
      qualityHooks.choose?.(choice);
    });
    const row = h(
      'label',
      { class: 'field field-select' },
      icon('sliders', 18),
      h('span', { class: 'field-label' }, UI_TEXT.graphics),
      select,
    );
    // 터치 모드: 그래픽 줄 오른쪽에 설정 단추 (진동 · 프레임 제한 · 터치 안내 다시 보기)
    if (this.settings) return [h('div', { class: 'row' }, row, this.settings.button()), note];
    // PC: 그래픽 줄 오른쪽에 프레임 제한 (좁으면 다음 줄로), 그 아래 줄에 캐릭터 스타일
    const frame = this.frameLimitField((saved) => {
      frameUnsaved = !saved;
      syncNote();
    });
    const style = this.charStyleField((saved) => {
      styleUnsaved = !saved;
      syncNote();
    });
    return [h('div', { class: 'row gfx-row' }, row, frame), h('div', { class: 'row' }, style), note];
  }

  /**
   * 캐릭터 스타일 선택 상자 (PC 첫 화면, 그래픽 줄 아래): 기존 / 새 캐릭터. 고르면 바로 적용하고 저장한다(기존이면 저장값을 지움,
   * gfx/charStyle.ts). 저장하지 못해도 이번 접속에는 적용되고, 그래픽 줄과 같은 '저장되지 않아요' 안내를 띄운다(onSaved).
   * 그림만 바꾼다 — 서버로 보내지 않는다
   */
  private charStyleField(onSaved: (saved: boolean) => void): HTMLElement {
    const select = h('select', { 'data-testid': 'char-style-select' });
    const current = currentCharStyle();
    for (const value of CHAR_STYLES) {
      const opt = h('option', { value }, CHAR_STYLE_LABELS[value]);
      if (value === current) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const style = parseCharStyle(select.value);
      if (!style) return;
      onSaved(setCharStyle(style));
    });
    return h(
      'label',
      { class: 'field field-select field-chars' },
      // 아이콘 없이 이름만 (프레임 제한 상자와 같다 — 눈 아이콘은 게임에서 '발각' 뜻이라 쓰지 않는다)
      h('span', { class: 'field-label' }, UI_TEXT.charStyle),
      select,
    );
  }

  /** 지금 프레임 제한: 이번 접속에서 고른 값 > 저장값 > 자동 */
  private frameLimitNow(): FrameLimit {
    return this.frameLimitChoice ?? loadFrameLimit() ?? 'auto';
  }

  /** 프레임 제한을 고른다: 저장(자동이면 저장값을 지움) 뒤 바로 적용 (main.ts pacingHooks). 저장하지 못하면 false */
  private chooseFrameLimit(limit: FrameLimit): boolean {
    this.frameLimitChoice = limit;
    const saved = saveFrameLimit(limit);
    pacingHooks.setLimit?.(limit);
    return saved;
  }

  /**
   * 프레임 제한 선택 상자 (PC 첫 화면, 그래픽 줄 옆): 자동 / 60 / 120. 고르면 저장하고 바로 적용한다.
   * 저장하지 못해도 이번 접속에는 적용되고, 그래픽 줄과 같은 '저장되지 않아요' 안내를 띄운다(onSaved)
   */
  private frameLimitField(onSaved: (saved: boolean) => void): HTMLElement {
    const select = h('select', { 'data-testid': 'frame-limit-select', title: UI_TEXT.frameLimitHint });
    const current = this.frameLimitNow();
    for (const o of FRAME_LIMIT_OPTIONS) {
      const opt = h('option', { value: o.value }, o.label);
      if (o.value === current) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const limit = parseFrameLimit(select.value);
      if (!limit) return;
      onSaved(this.chooseFrameLimit(limit));
    });
    return h(
      'label',
      { class: 'field field-select field-frame' },
      h('span', { class: 'field-label' }, UI_TEXT.frameLimit),
      select,
    );
  }

  /** 방 로비 (빠른 매칭 방이면 대기 화면) */
  renderRoom(lobby: LobbyState): void {
    if (this.lastRoom !== lobby.room) this.showError('');
    if (lobby.kind === 'quick') {
      if (!this.atRoom) this.settings?.close();
      this.lastRoom = lobby.room;
      this.lastLobby = lobby;
      this.renderQuick(lobby);
      return;
    }
    this.quickCountdown = null;
    // 첫 화면에서 넘어왔으면 열려 있던 설정 판을 닫는다 (같은 방 화면을 다시 그릴 때는 그대로)
    if (!this.atRoom) this.settings?.close();
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
      if (p.id === this.you) name.append(h('span', { class: 'tag' }, UI_TEXT.me));
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
    const buttons = h(
      'div',
      { class: 'action-row' },
      leave,
      ...(this.settings ? [this.settings.button()] : []),
      ready,
    );
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
