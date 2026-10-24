// 설정 화면 (설정 화면 통합, VISUAL_SPEC 9.5): PC · 휴대폰이 같은 구성의 한 화면. 탭 그래픽 · 화면 · 소리 · 조작.
// 여는 곳: 첫 화면 · 방 화면 · 빠른 매칭 대기의 '설정' 단추(button()), 판 중 메뉴 버튼(matchMenu — 판 중에는 조작 탭 없음).
// 온라인 판이라 판은 멈추지 않는다: 판 중에 열면 맨 위에 그 사실을 적고, 판 장면은 열려 있는 동안 입력을 받지 않는다(GameScene).
// 값은 settingsModel(그래픽 · 진동 · 배치) · prefs(화면 · 소리 · 조이스틱)에서 읽고 쓴다 — 고르면 바로 적용하고 저장한다.
// 저장이 막히면(사생활 보호 · 가득 참) 아래에 '저장되지 않아요' 안내 하나. 주소 옵션이 있는 줄은 잠그고 그 사실을 적는다.
// 줄마다 '기본값'(항목별 되돌리기), 아래에 '모두 기본값으로'(두 번 눌러 확인). 고른 쪽은 ✓ + 바탕(색만으로 구분하지 않기).
// DOM은 한 번 만들고 열 때 값만 맞춘다(판 중에 열어도 프레임을 떨어뜨리지 않게: 열기 = hidden 해제 + 줄마다 속성 몇 개).
// 흐림 필터(backdrop-filter)는 쓰지 않는다(판이 뒤에서 매 프레임 다시 그려진다)
import type { Role } from '@decoy/shared';
import { teamOf } from '@decoy/shared';
import { sfx } from '../audio';
import { APP_TEXT, CONTROLS, HELP_TEXT, SETTINGS_TEXT, UI_TEXT } from '../data/storyText';
import type { FrameLimit } from '../gfx/framePacing';
import type { QualityChoice } from '../gfx/quality';
import type { CharStyle } from '../gfx/charStyle';
import {
  STICK_CLEAR,
  STICK_SIZE,
  UI_SIZES,
  VOLUME,
  isDefaultPref,
  onPrefsChange,
  pref,
  resetPref,
  setPref,
  type PrefKey,
  type UiSize,
} from '../prefs';
import {
  charStyleIsDefault,
  charStyleNow,
  chooseCharStyle,
  chooseFrameLimit,
  chooseQuality,
  frameLimitIsDefault,
  frameLimitNow,
  hapticsIsDefault,
  qualityIsDefault,
  qualityNow,
  resetAllSettings,
  resetCharStyleSetting,
  resetFrameLimit,
  resetHaptics,
  resetQuality,
  tabsFor,
  urlLock,
  type SettingsContext,
  type TabId,
} from '../settingsModel';
import { onCharStyleChange } from '../gfx/charStyle';
import { h, icon } from './uiArt';
import './settings.css';

/** 연 손가락의 click을 버리는 시간 (ms, 연 뒤 설정 화면 안에서 누른 적 없는 포인터 click만 — ghostUntil) */
const GHOST_CLICK_MS = 800;

/** 설정 화면이 바깥에서 받는 것 */
export interface SettingsEnv {
  /** 터치 모드 (조작 탭 내용 · UI 크기 안내가 다르다) */
  touch: boolean;
  /** 진동 줄을 보이는가 (터치 모드 + 진동 API) */
  haptics: { supported: boolean; enabled(): boolean; setEnabled(on: boolean): boolean };
  /** 지금 내 역할 (조작 안내 · 화살표 설명을 그 팀 것만). 모르면 null → 두 팀 모두 */
  role(): Role | null;
  /** 터치 조작 안내 다시 보기 (조작 탭, 터치) */
  replayTutorial(): void;
  /** 조작 배치 편집 열기 (조작 탭, 터치 · 로비). 편집기가 닫히면 done */
  openLayoutEditor(done: () => void): void;
  /** 닫힌 뒤 (판 중이면 판 장면이 입력을 다시 받는다) */
  onClose?(): void;
}

const TAB_LABEL: Record<TabId, string> = {
  graphics: SETTINGS_TEXT.tabGraphics,
  screen: SETTINGS_TEXT.tabScreen,
  sound: SETTINGS_TEXT.tabSound,
  controls: SETTINGS_TEXT.tabControls,
};

/** 줄 하나: 만들기 · 값 맞추기 · 기본값인가 · 되돌리기 */
interface Row {
  id: string;
  tab: TabId;
  el: HTMLElement;
  sync(): void;
  /** 되돌리기 단추가 없는 줄(안내 · 단추 줄)은 null */
  isDefault: (() => boolean) | null;
  reset: (() => boolean) | null;
  /** 터치 모드에서만 · PC에서만 · 판 밖에서만 */
  when?: (ctx: SettingsContext) => boolean;
}

let ids = 0;
const nextId = (p: string): string => `${p}-${++ids}`;

/** 고른 쪽 = ✓ + 바탕 (lifecycle.css .seg) */
function segButton(testid: string, label: string): HTMLButtonElement {
  return h(
    'button',
    { class: 'seg', type: 'button', 'data-testid': testid, 'aria-pressed': 'false' },
    icon('check', 16, 'seg-ico'),
    label,
  );
}

export class SettingsPanel {
  readonly root: HTMLDivElement;
  private readonly card: HTMLElement;
  private readonly tabBar: HTMLDivElement;
  private readonly tabs = new Map<TabId, HTMLButtonElement>();
  private readonly pages = new Map<TabId, HTMLDivElement>();
  private readonly rows: Row[] = [];
  private readonly inMatchNote: HTMLParagraphElement;
  private readonly unsaved: HTMLDivElement;
  private readonly resetAll: HTMLButtonElement;
  private readonly resetDone: HTMLSpanElement;
  private readonly replayDone: HTMLDivElement;
  private ctx: SettingsContext = 'lobby';
  private tab: TabId = 'graphics';
  private prevFocus: HTMLElement | null = null;
  /** '모두 기본값으로'를 한 번 눌렀다 (두 번째에 되돌린다) */
  private resetArmedUntil = 0;
  /**
   * 연 손가락의 click 버리기: 터치 판 중 '설정' 버튼은 손가락을 댈 때(pointerdown) 여는데, 손을 떼면 브라우저가 만드는 click이 그
   * 자리에 새로 뜬 단추(오른쪽 위 닫기)에 떨어져 바로 닫혔다. 연 뒤 설정 화면 안에서 누른 적이 없는(pointerdown이 연 앞) 포인터
   * click은 이때(performance.now)까지 버린다. 키보드 click(detail 0) · 연 뒤에 누른 click은 그대로
   */
  private ghostUntil = 0;
  /** 연 뒤 설정 화면 안에서 포인터를 누른 적이 있다 */
  private downSinceOpen = false;
  /** 편집기가 열려 있는 동안 (설정 화면은 숨긴다) */
  private editing = false;

  constructor(
    host: HTMLElement,
    private readonly env: SettingsEnv,
  ) {
    const title = nextId('settings-title');
    this.inMatchNote = h(
      'p',
      { class: 'set-inmatch', role: 'note', 'data-testid': 'settings-inmatch' },
      icon('play', 16),
      h('span', {}, SETTINGS_TEXT.inMatch),
    );
    this.tabBar = h('div', { class: 'set-tabs', role: 'tablist', 'aria-label': SETTINGS_TEXT.title });
    const body = h('div', { class: 'set-body' });
    this.unsaved = h(
      'div',
      { class: 'lobby-hint quality-note', role: 'status', 'data-testid': 'quality-note' },
      UI_TEXT.qualityNotSaved,
    );
    this.unsaved.hidden = true;
    this.resetAll = h(
      'button',
      { class: 'btn set-reset-all', type: 'button', 'data-testid': 'settings-reset-all' },
      icon('replay', 18),
      h('span', {}, SETTINGS_TEXT.resetAll),
    );
    this.resetDone = h('span', { class: 'set-done', role: 'status', 'data-testid': 'settings-reset-done' });
    this.resetAll.addEventListener('click', () => this.onResetAll());
    this.replayDone = h(
      'div',
      { class: 'life-done', role: 'status' },
      icon('check', 16),
      APP_TEXT.tutorialReplayDone,
    );
    this.replayDone.hidden = true;
    const close = h(
      'button',
      { class: 'btn set-close', type: 'button', 'data-testid': 'settings-close' },
      icon('back', 18),
      SETTINGS_TEXT.close,
    );
    close.addEventListener('click', () => this.close());
    this.card = h(
      'section',
      {
        class: 'panel set-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': title,
        'data-testid': 'settings-panel',
      },
      h(
        'header',
        { class: 'set-head' },
        h('h2', { id: title, class: 'set-title' }, icon('sliders', 20), h('span', {}, SETTINGS_TEXT.title)),
        close,
      ),
      this.inMatchNote,
      this.tabBar,
      body,
      h(
        'footer',
        { class: 'set-foot' },
        this.unsaved,
        h('div', { class: 'set-foot-row' }, this.resetAll, this.resetDone),
      ),
    );
    this.root = h('div', { class: 'set-modal', 'data-testid': 'settings-modal' }, this.card);
    this.root.hidden = true;
    // 막을 누르면 닫힌다 (카드 안 누르기는 그대로)
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.card.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('pointerdown', () => (this.downSinceOpen = true), true);
    this.root.addEventListener(
      'click',
      (e) => {
        if (e.detail === 0 || this.downSinceOpen || performance.now() >= this.ghostUntil) return;
        this.ghostUntil = 0;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );

    for (const t of ['graphics', 'screen', 'sound', 'controls'] as const) {
      const panelId = nextId(`settings-page-${t}`);
      const tabId = nextId(`settings-tab-${t}`);
      const b = h(
        'button',
        {
          class: 'set-tab',
          type: 'button',
          role: 'tab',
          id: tabId,
          'aria-controls': panelId,
          'aria-selected': 'false',
          'data-testid': `settings-tab-${t}`,
        },
        TAB_LABEL[t],
      );
      b.addEventListener('click', () => {
        if (this.tab !== t) sfx.ui('tap');
        this.showTab(t);
      });
      this.tabs.set(t, b);
      this.tabBar.append(b);
      const page = h('div', {
        class: 'set-page',
        role: 'tabpanel',
        id: panelId,
        'aria-labelledby': tabId,
        'data-testid': `settings-page-${t}`,
      });
      page.hidden = true;
      this.pages.set(t, page);
      body.append(page);
    }
    this.buildRows();
    for (const r of this.rows) this.pages.get(r.tab)?.append(r.el);
    host.appendChild(this.root);
    // 바깥에서 바뀐 값(디버그 훅 · 다른 화면)도 열려 있으면 바로 맞춘다
    onPrefsChange(() => this.syncAll());
    onCharStyleChange(() => this.syncAll());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** 지금 연 곳 (판 · 로비) */
  get context(): SettingsContext {
    return this.ctx;
  }

  /**
   * 로비 화면의 '설정' 단추 (화면을 다시 그릴 때마다 새로 만든다 — 방 화면은 로비 상태가 올 때마다 다시 그려진다).
   * 누르면 로비 설정을 연다
   */
  button(): HTMLButtonElement {
    const b = h(
      'button',
      {
        class: 'btn life-gear',
        type: 'button',
        'aria-haspopup': 'dialog',
        'data-testid': 'settings-button',
      },
      icon('sliders', 18),
      APP_TEXT.settings,
    );
    b.addEventListener('click', () => this.open('lobby'));
    return b;
  }

  /** 연다. ctx = 'match'면 그래픽 · 화면 · 소리 탭만, 맨 위에 '판은 멈추지 않아요' */
  open(ctx: SettingsContext, tab?: TabId): void {
    const tabs = tabsFor(ctx);
    if (!this.isOpen) {
      const active = document.activeElement;
      this.prevFocus = active instanceof HTMLElement ? active : null;
      sfx.ui('open');
      this.ghostUntil = performance.now() + GHOST_CLICK_MS;
      this.downSinceOpen = false;
    }
    this.ctx = ctx;
    this.card.classList.toggle('in-match', ctx === 'match');
    this.inMatchNote.hidden = ctx !== 'match';
    for (const [t, b] of this.tabs) b.hidden = !tabs.includes(t);
    for (const r of this.rows) r.el.hidden = r.when ? !r.when(ctx) : false;
    this.resetArmedUntil = 0;
    this.resetDone.textContent = '';
    this.replayDone.hidden = true;
    this.root.hidden = false;
    const want = tab && tabs.includes(tab) ? tab : tabs.includes(this.tab) ? this.tab : 'graphics';
    this.showTab(want);
    this.syncAll();
    this.tabs.get(want)?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    sfx.ui('close');
    this.prevFocus?.focus({ preventScroll: true });
    this.prevFocus = null;
    this.env.onClose?.();
  }

  private showTab(t: TabId): void {
    this.tab = t;
    for (const [id, b] of this.tabs) {
      const on = id === t;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const [id, p] of this.pages) p.hidden = id !== t;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    // 탭 목록: 좌우 화살표로 옮긴다 (WAI-ARIA 탭)
    if (
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft') &&
      e.target instanceof HTMLElement &&
      e.target.getAttribute('role') === 'tab'
    ) {
      const tabs = tabsFor(this.ctx);
      const i = tabs.indexOf(this.tab);
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length] ?? this.tab;
      this.showTab(next);
      this.tabs.get(next)?.focus({ preventScroll: true });
      e.preventDefault();
    }
    // 판 중: 판 키(WASD 등)가 창으로 가지 않게 설정 화면 안 키는 여기서 멈춘다
    if (this.ctx === 'match') e.stopPropagation();
  }

  /** 저장 결과: 하나라도 못 하면 안내 (이번 접속에는 적용) */
  private saved(ok: boolean): void {
    if (!ok) this.unsaved.hidden = false;
  }

  private syncAll(): void {
    if (!this.isOpen) return;
    for (const r of this.rows) r.sync();
  }

  private onResetAll(): void {
    const now = performance.now();
    if (now > this.resetArmedUntil) {
      // 첫 번째 누름: 4초 안에 한 번 더 누르면 되돌린다
      this.resetArmedUntil = now + 4000;
      this.resetDone.textContent = SETTINGS_TEXT.resetAllConfirm;
      sfx.ui('tap');
      return;
    }
    this.resetArmedUntil = 0;
    this.saved(resetAllSettings());
    this.resetDone.textContent = SETTINGS_TEXT.resetAllDone;
    sfx.ui('toggle');
    for (const r of this.rows) r.sync();
  }

  // ───────────── 줄 만들기 ─────────────

  private buildRows(): void {
    const T = SETTINGS_TEXT;
    // ── 그래픽 ──
    this.rows.push(
      this.segRow<QualityChoice>({
        id: 'quality',
        tab: 'graphics',
        label: T.quality,
        options: [
          { value: 'auto', label: UI_TEXT.qualityAuto },
          { value: 'high', label: UI_TEXT.qualityHigh },
          { value: 'medium', label: UI_TEXT.qualityMedium },
          { value: 'low', label: UI_TEXT.qualityLow },
        ],
        testid: (v) => `quality-${v}`,
        get: qualityNow,
        set: chooseQuality,
        isDefault: qualityIsDefault,
        reset: resetQuality,
        hint: T.qualityHint,
        lock: () => urlLock('quality'),
        repress: true,
      }),
      this.segRow<FrameLimit>({
        id: 'frame-limit',
        tab: 'graphics',
        label: UI_TEXT.frameLimit,
        options: [
          { value: 'auto', label: UI_TEXT.frameLimitAuto },
          { value: '60', label: UI_TEXT.frameLimit60 },
          { value: '120', label: UI_TEXT.frameLimit120 },
        ],
        testid: (v) => `frame-limit-${v}`,
        get: frameLimitNow,
        set: chooseFrameLimit,
        isDefault: frameLimitIsDefault,
        reset: resetFrameLimit,
        hint: UI_TEXT.frameLimitHint,
        hintTestId: 'frame-limit-hint',
        lock: () => urlLock('frameLimit'),
      }),
      this.segRow<CharStyle>({
        id: 'char-style',
        tab: 'graphics',
        label: UI_TEXT.charStyle,
        options: [
          { value: 'new', label: UI_TEXT.charStyleNew },
          { value: 'classic', label: UI_TEXT.charStyleClassic },
        ],
        testid: (v) => `char-style-${v}`,
        get: charStyleNow,
        set: chooseCharStyle,
        isDefault: charStyleIsDefault,
        reset: resetCharStyleSetting,
        hint: T.charStyleHint,
        lock: () => urlLock('charStyle'),
      }),
    );
    // ── 화면 ──
    this.rows.push(
      this.prefSeg<UiSize>(
        'uiSize',
        'ui-size',
        'screen',
        T.uiSize,
        [
          { value: UI_SIZES[0]!, label: T.uiSizeNormal },
          { value: UI_SIZES[1]!, label: T.uiSizeLarge },
          { value: UI_SIZES[2]!, label: T.uiSizeXlarge },
        ],
        this.env.touch ? T.uiSizeHint : T.uiSizeHintPc,
      ),
      this.prefToggle('reduceShake', 'reduce-shake', 'screen', T.reduceShake, T.reduceShakeHint),
      this.prefToggle('reduceFlash', 'reduce-flash', 'screen', T.reduceFlash, T.reduceFlashHint),
      this.prefToggle('perfChip', 'perf-chip', 'screen', T.perfChip, T.perfChipHint),
    );
    // ── 소리 ──
    this.rows.push(
      this.prefSlider('volMaster', 'vol-master', 'sound', T.volMaster, VOLUME),
      this.prefSlider('volSfx', 'vol-sfx', 'sound', T.volSfx, VOLUME),
      this.prefSlider('volUi', 'vol-ui', 'sound', T.volUi, VOLUME),
      this.prefToggle('muted', 'muted', 'sound', T.muted),
    );
    // ── 조작 ──
    const touchOnly = (): boolean => this.env.touch;
    const pcOnly = (): boolean => !this.env.touch;
    if (this.env.touch) {
      this.rows.push(
        {
          ...this.prefSlider('stickSize', 'stick-size', 'controls', T.stickSize, STICK_SIZE),
          when: touchOnly,
        },
        {
          ...this.prefSlider('stickClear', 'stick-clear', 'controls', T.stickClear, STICK_CLEAR, T.stickHint),
          when: touchOnly,
        },
      );
      if (this.env.haptics.supported) this.rows.push({ ...this.hapticsRow(), when: touchOnly });
      this.rows.push({ ...this.layoutRow(), when: touchOnly }, { ...this.replayRow(), when: touchOnly });
    }
    this.rows.push({ ...this.controlsHelp(), when: pcOnly }, this.edgeHelp());
  }

  /** 줄 머리: 이름 + (되돌리기 단추) */
  private rowShell(
    id: string,
    tab: TabId,
    label: string,
    reset: (() => boolean) | null,
    extraClass = '',
  ): { el: HTMLElement; head: HTMLElement; resetBtn: HTMLButtonElement | null; labelId: string } {
    const labelId = nextId(`row-${id}`);
    const head = h('div', { class: 'set-row-head' }, h('span', { class: 'field-label', id: labelId }, label));
    let resetBtn: HTMLButtonElement | null = null;
    if (reset) {
      resetBtn = h(
        'button',
        {
          class: 'set-reset',
          type: 'button',
          'data-testid': `reset-${id}`,
          'aria-label': `${label} ${SETTINGS_TEXT.resetItem}`,
        },
        icon('replay', 14),
        SETTINGS_TEXT.resetItem,
      );
      resetBtn.addEventListener('click', () => {
        this.saved(reset());
        sfx.ui('tap');
        this.syncAll();
      });
      head.append(resetBtn);
    }
    const el = h('div', {
      class: `set-row${extraClass}`,
      role: 'group',
      'aria-labelledby': labelId,
      'data-testid': `row-${id}`,
      'data-tab': tab,
    });
    el.append(head);
    return { el, head, resetBtn, labelId };
  }

  private segRow<V extends string>(o: {
    id: string;
    tab: TabId;
    label: string;
    options: readonly { value: V; label: string }[];
    testid: (v: V) => string;
    get: () => V;
    set: (v: V) => boolean;
    isDefault: () => boolean;
    reset: () => boolean;
    hint?: string;
    hintTestId?: string;
    lock?: () => string | null;
    /** 고른 칸을 다시 눌러도 고르기를 부른다 (품질 '자동': 판 중 측정 기억을 지우고 기기 자동부터 다시 잰다) */
    repress?: boolean;
  }): Row {
    const shell = this.rowShell(o.id, o.tab, o.label, o.reset);
    const segs = o.options.map((opt) => {
      const b = segButton(o.testid(opt.value), opt.label);
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true' || (o.get() === opt.value && !o.repress)) return;
        this.saved(o.set(opt.value));
        sfx.ui('tap');
        this.syncAll();
      });
      return { value: opt.value, b };
    });
    shell.el.append(h('div', { class: 'segs' }, ...segs.map((s) => s.b)));
    if (o.hint)
      shell.el.append(
        h('div', { class: 'set-hint', ...(o.hintTestId ? { 'data-testid': o.hintTestId } : {}) }, o.hint),
      );
    const lockLine = h('div', { class: 'set-lock', role: 'note', 'data-testid': `lock-${o.id}` });
    lockLine.hidden = true;
    shell.el.append(lockLine);
    const sync = (): void => {
      const now = o.get();
      const lock = o.lock?.() ?? null;
      for (const s of segs) {
        s.b.setAttribute('aria-pressed', String(s.value === now));
        s.b.setAttribute('aria-disabled', String(lock !== null));
      }
      lockLine.hidden = lock === null;
      if (lock !== null)
        lockLine.replaceChildren(
          icon('link', 14),
          h('span', {}, SETTINGS_TEXT.urlOverride.replace('{param}', lock)),
        );
      shell.el.classList.toggle('locked', lock !== null);
      if (shell.resetBtn) shell.resetBtn.disabled = o.isDefault();
    };
    return { id: o.id, tab: o.tab, el: shell.el, sync, isDefault: o.isDefault, reset: o.reset };
  }

  private prefSeg<V extends string>(
    key: PrefKey,
    id: string,
    tab: TabId,
    label: string,
    options: readonly { value: V; label: string }[],
    hint?: string,
  ): Row {
    return this.segRow<V>({
      id,
      tab,
      label,
      options,
      testid: (v) => `${id}-${v}`,
      get: () => pref(key) as V,
      set: (v) => setPref(key, v as never),
      isDefault: () => isDefaultPref(key),
      reset: () => resetPref(key),
      hint,
    });
  }

  /** 켜기 · 끄기 두 칸 (✓ + 바탕) */
  private prefToggle(key: PrefKey, id: string, tab: TabId, label: string, hint?: string): Row {
    return this.segRow<'on' | 'off'>({
      id,
      tab,
      label,
      options: [
        { value: 'on', label: SETTINGS_TEXT.on },
        { value: 'off', label: SETTINGS_TEXT.off },
      ],
      testid: (v) => `${id}-${v}`,
      get: () => (pref(key) === true ? 'on' : 'off'),
      set: (v) => setPref(key, (v === 'on') as never),
      isDefault: () => isDefaultPref(key),
      reset: () => resetPref(key),
      hint,
    });
  }

  /** 밀대 (0~100% 등): 끄는 동안 바로 적용, 손을 떼면 소리 하나 */
  private prefSlider(
    key: PrefKey,
    id: string,
    tab: TabId,
    label: string,
    range: { min: number; max: number; step: number },
    hint?: string,
  ): Row {
    const shell = this.rowShell(id, tab, label, () => resetPref(key), ' set-slider');
    const input = h('input', {
      type: 'range',
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
      'data-testid': id,
      'aria-labelledby': shell.labelId,
    });
    const out = h('output', { class: 'set-value num', 'data-testid': `${id}-value` });
    input.addEventListener('input', () => {
      this.saved(setPref(key, Number(input.value) as never));
      out.textContent = SETTINGS_TEXT.percent.replace('{n}', input.value);
      if (shell.resetBtn) shell.resetBtn.disabled = isDefaultPref(key);
    });
    input.addEventListener('change', () => sfx.ui('tap'));
    shell.el.append(h('div', { class: 'set-slide' }, input, out));
    if (hint) shell.el.append(h('div', { class: 'set-hint' }, hint));
    const sync = (): void => {
      const v = String(pref(key));
      if (input.value !== v) input.value = v;
      out.textContent = SETTINGS_TEXT.percent.replace('{n}', v);
      input.setAttribute('aria-valuetext', out.textContent);
      if (shell.resetBtn) shell.resetBtn.disabled = isDefaultPref(key);
    };
    return { id, tab, el: shell.el, sync, isDefault: () => isDefaultPref(key), reset: () => resetPref(key) };
  }

  private hapticsRow(): Row {
    const env = this.env.haptics;
    const row = this.segRow<'on' | 'off'>({
      id: 'haptics',
      tab: 'controls',
      label: APP_TEXT.haptics,
      options: [
        { value: 'on', label: APP_TEXT.hapticsOn },
        { value: 'off', label: APP_TEXT.hapticsOff },
      ],
      testid: (v) => `haptics-${v}`,
      get: () => (env.enabled() ? 'on' : 'off'),
      set: (v) => env.setEnabled(v === 'on'),
      isDefault: hapticsIsDefault,
      reset: resetHaptics,
    });
    return row;
  }

  /** 조작 배치 편집 (로비에서만 — 판 중에는 조작 탭이 없다) */
  private layoutRow(): Row {
    const shell = this.rowShell('layout', 'controls', SETTINGS_TEXT.layoutEdit, null, ' set-action');
    const b = h(
      'button',
      { class: 'btn', type: 'button', 'data-testid': 'layout-edit' },
      icon('scoreboard', 18),
      SETTINGS_TEXT.layoutEdit,
    );
    b.addEventListener('click', () => {
      if (this.ctx !== 'lobby' || this.editing) return;
      sfx.ui('open');
      this.editing = true;
      this.root.hidden = true;
      this.env.openLayoutEditor(() => {
        this.editing = false;
        this.root.hidden = false;
        this.syncAll();
        b.focus({ preventScroll: true });
      });
    });
    shell.head.replaceChildren(b);
    shell.el.append(h('div', { class: 'set-hint' }, SETTINGS_TEXT.layoutEditHint));
    return {
      id: 'layout',
      tab: 'controls',
      el: shell.el,
      sync: () => undefined,
      isDefault: null,
      reset: null,
    };
  }

  private replayRow(): Row {
    const shell = this.rowShell('tutorial', 'controls', APP_TEXT.tutorialReplay, null, ' set-action');
    const b = h(
      'button',
      { class: 'btn life-replay', type: 'button', 'data-testid': 'tutorial-replay' },
      icon('replay', 18),
      APP_TEXT.tutorialReplay,
    );
    b.addEventListener('click', () => {
      this.env.replayTutorial();
      this.replayDone.hidden = false;
      sfx.ui('tap');
    });
    shell.head.replaceChildren(b);
    shell.el.append(this.replayDone);
    return {
      id: 'tutorial',
      tab: 'controls',
      el: shell.el,
      sync: () => undefined,
      isDefault: null,
      reset: null,
    };
  }

  /** PC 조작 안내 (키보드 · 마우스, 팀별) */
  private controlsHelp(): Row {
    const shell = this.rowShell('controls-help', 'controls', SETTINGS_TEXT.controlsPc, null, ' set-help');
    const lists = new Map<'survivor' | 'monster', HTMLElement[]>();
    for (const team of ['survivor', 'monster'] as const) {
      const head = h(
        'h3',
        { class: 'set-team' },
        team === 'survivor' ? SETTINGS_TEXT.teamSurvivor : SETTINGS_TEXT.teamMonster,
      );
      const ul = h('ul', { class: 'set-keys', 'data-team': team });
      for (const line of CONTROLS[team]) {
        const [key, ...rest] = line.split('  ');
        ul.append(
          rest.length > 0
            ? h('li', {}, h('span', { class: 'set-key' }, key ?? ''), h('span', {}, rest.join('  ')))
            : h('li', { class: 'set-goal' }, line),
        );
      }
      lists.set(team, [head, ul]);
      shell.el.append(head, ul);
    }
    const sync = (): void => {
      const role = this.env.role();
      const team = role ? teamOf(role) : null;
      for (const [t, els] of lists) for (const el of els) el.hidden = team !== null && team !== t;
    };
    return { id: 'controls-help', tab: 'controls', el: shell.el, sync, isDefault: null, reset: null };
  }

  /** 화면 밖 화살표 · 지도 설명 (PC · 터치) */
  private edgeHelp(): Row {
    const shell = this.rowShell('edge-help', 'controls', HELP_TEXT.edgeTitle, null, ' set-help');
    const surv = h('p', { class: 'set-hint', 'data-team': 'survivor' }, HELP_TEXT.edgeSurvivor);
    const mon = h('p', { class: 'set-hint', 'data-team': 'monster' }, HELP_TEXT.edgeMonster);
    shell.el.append(surv, mon, h('p', { class: 'set-hint' }, HELP_TEXT.minimapTap));
    const sync = (): void => {
      const role = this.env.role();
      const team = role ? teamOf(role) : null;
      surv.hidden = team === 'monster';
      mon.hidden = team === 'survivor';
    };
    return { id: 'edge-help', tab: 'controls', el: shell.el, sync, isDefault: null, reset: null };
  }
}
