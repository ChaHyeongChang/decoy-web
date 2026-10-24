// 조작 배치 편집 (터치 기기, 로비에서만 — 설정 화면 조작 탭의 '조작 배치 편집'): 이동 스틱 · 조준 스틱 · 모든 터치 버튼을
// 끌어 옮기고 크기를 바꾼다. 생존자 · 괴물 배치를 따로 저장한다('decoy:controlLayout', controlLayout.ts). DOM만 쓴다(Phaser 없음).
// 화면은 판과 1:1이다(창 CSS px): 판 중 터치 화면과 같은 자리 계산(touchLayout) · 같은 판 HUD 배치(touchHudPlan)로 맵 사각형 윤곽,
// 늘 떠 있는 HUD 미리보기(조작을 놓을 수 없는 자리 — 사선 무늬 + 이름표), 진짜 버튼처럼 그린 조작(아이콘 + 이름표, 스틱은 고리)을
// 그린다. 판 정보는 하나도 없다(자리 그림뿐). 명령 판은 맵 안에서 조작 · HUD와 가장 덜 겹치는 자리에 뜨고, 끄는 동안 흐려져
// 그 아래로도 옮길 수 있다(판 위 · 아래 띠를 덮는 윗줄 막대는 시스템 버튼 · HUD를 가려 쓰지 않는다 — DECISIONS).
// 끌기: 포인터 캡처 · touch-action none. 안전 범위(가장자리 띠 안쪽 6px) 안으로 자르고, 다른 조작 · HUD와 겹치거나(이름표까지,
// 8px 간격) 이동 고리가 이동 영역(그쪽 화면 40% 띠) 밖이면 그 자리는 받지 않는다 — 한 축으로 미끄러질 수 있으면 미끄러지고, 아니면
// 마지막 자리에 둔다. 막은 조작 · HUD를 잠깐 경고 모양(점선 테두리 + ! 표시 — 색만으로 구분하지 않기)으로 보이고 안내를 띄운다.
// 고른 조작은 작게 · 크게(10%씩, 같은 규칙), 화살표 키로 4px(Shift 16px). 창 크기 · 방향이 바뀌면 비율 자리로 다시 그린다.
// 두 역할의 고친 배치는 저장 · 취소까지 둘 다 남는다. 저장 = 보이는 자리 그대로 두 역할을 저장, 취소 = 버린다
import type { ControlLayoutInfo, Team } from '@decoy/shared';
import { iconSvg, type IconId } from '../art/icons';
import {
  TEAMS,
  TEAM_CONTROLS,
  SIZE_SCALE,
  baseBoxes,
  blockersOf,
  clampBox,
  clampScale,
  flipItems,
  insideBox,
  isDefaultLayout,
  loadControlLayouts,
  matchTuning,
  moveRange,
  occupied,
  placeOf,
  placeOk,
  saveControlLayouts,
  sizedBox,
  type Box,
  type ControlBoxes,
  type ControlId,
  type ControlPlace,
  type PlaceRules,
  type SavedLayouts,
  type TeamLayout,
} from '../controlLayout';
import { EDITOR_TEXT, HUD_TEXT, TOUCH_TEXT, UI_TEXT } from '../data/storyText';
import { canOfferFullscreen } from '../device';
import { stickAlphaOf } from '../prefs';
import './layoutEditor.css';
import { thumbMetrics, tuningOf } from './layout';
import {
  controlBoxes,
  hudPreview,
  moveZone,
  touchLayout,
  type HudPreview,
  type Insets,
} from './touchControls';
import { h, icon } from './uiArt';

export interface LayoutEditorOptions {
  /** 붙일 곳 (#ui-root) */
  host: HTMLElement;
  /** 처음 보일 역할 배치 */
  role: 'survivor' | 'monster';
  /** 닫힌 뒤 (saved = 저장하고 닫았다) */
  onClose: (saved: boolean) => void;
}

export interface LayoutEditorHandle {
  close(): void;
}

/** 조작 모양: 종류 · 아이콘 · 이름표(판 중과 같은 글자) */
const LOOK: Readonly<
  Record<ControlId, { kind: 'btn' | 'sys' | 'aim' | 'move'; icon: IconId; label: string }>
> = {
  move: { kind: 'move', icon: 'dash', label: TOUCH_TEXT.move },
  attack: { kind: 'aim', icon: 'attack', label: HUD_TEXT.attack },
  dash: { kind: 'btn', icon: 'dash', label: HUD_TEXT.dash },
  roar: { kind: 'btn', icon: 'roar', label: HUD_TEXT.roar },
  mode: { kind: 'btn', icon: 'visionSearch', label: HUD_TEXT.mode },
  ability: { kind: 'btn', icon: 'sprint', label: EDITOR_TEXT.ability },
  rescue: { kind: 'btn', icon: 'rescue', label: TOUCH_TEXT.rescue },
  scoreboard: { kind: 'sys', icon: 'scoreboard', label: HUD_TEXT.scoreboard },
  menu: { kind: 'sys', icon: 'sliders', label: TOUCH_TEXT.menu },
  fullscreen: { kind: 'sys', icon: 'fullscreen', label: TOUCH_TEXT.fullscreen },
};

/** 고른 조작 이름 (명령 판) */
function nameOf(id: ControlId): string {
  return id === 'move' ? EDITOR_TEXT.move : LOOK[id].label;
}

/** HUD 미리보기 이름표 (팀 카드 · 거점 게이지는 첫 칸에만) */
const HUD_LABEL: Readonly<Record<string, string>> = {
  timer: EDITOR_TEXT.timer,
  gaugeA: EDITOR_TEXT.gaugeA,
  gaugeB: EDITOR_TEXT.gaugeB,
  card0: EDITOR_TEXT.cards,
  minimap: EDITOR_TEXT.minimap,
  minimapInset: EDITOR_TEXT.minimap,
};

/** 화살표 키로 옮기는 양 (CSS px, Shift는 4배) */
const KEY_STEP = 4;
/** 막힘 표시 · 안내가 남는 시간 (ms) */
const WARN_MS = 1100;

/** 한 역할 화면의 기하 (창 CSS px) */
interface Geo {
  team: Team;
  w: number;
  h: number;
  hud: HudPreview;
  /** 피할 HUD (rules.hud와 같은 순서) */
  hudIds: string[];
  /** 기본 배치 (좌우 반전이면 뒤집은 것) — 크기 배율의 기준 */
  def: ControlBoxes;
  /** 지금 보이는 자리 */
  boxes: ControlBoxes;
  safe: Box;
  zone: Box;
  rules: PlaceRules;
  fallback: boolean;
}

interface Drag {
  id: ControlId;
  pointerId: number;
  offX: number;
  offY: number;
  last: Box;
  moved: boolean;
}

/** 손가락 탭을 click 대신 받아도 되는 시간 (ms): 그 안의 click은 같은 누르기라 건너뛴다 */
const TAP_CLICK_MS = 800;

/**
 * 누르기: 손가락은 버튼 위에서 떼는 순간, 키보드 · 마우스는 click. 조작을 끈 바로 뒤의 탭에는 크롬이 click을 만들지 않는 때가
 * 있다(끌고 곧바로 '저장'을 누르면 아무 일도 없었다 — E2E에서 찾음)
 */
function onTap(el: HTMLButtonElement, fn: () => void): void {
  let down = -1;
  let touchAt = -Infinity;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') down = e.pointerId;
  });
  el.addEventListener('pointercancel', () => {
    down = -1;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== down) return;
    down = -1;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    touchAt = performance.now();
    if (!el.disabled) fn();
  });
  el.addEventListener('click', () => {
    if (performance.now() - touchAt < TAP_CLICK_MS) return;
    fn();
  });
}

/** 열려 있는 편집 화면 (하나만) */
const open: { editor: LayoutEditor | null } = { editor: null };

/** 디버그 · 시험: 열린 편집 화면의 배치 (없으면 null) */
export function editorControlLayout(): ControlLayoutInfo | null {
  return open.editor?.debugInfo() ?? null;
}

/** 편집 화면을 연다 (전체 화면 덮개). 닫히면 onClose (한 번). 이미 열려 있으면 그것을 취소하고 새로 연다 */
export function openLayoutEditor(opts: LayoutEditorOptions): LayoutEditorHandle {
  open.editor?.close(false);
  const ed = new LayoutEditor(opts);
  open.editor = ed;
  return { close: () => ed.close(false) };
}

class LayoutEditor {
  private readonly root: HTMLDivElement;
  private readonly probe: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly msg: HTMLDivElement;
  private readonly teamBtn = new Map<Team, HTMLButtonElement>();
  private readonly mirrorBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly smallerBtn: HTMLButtonElement;
  private readonly biggerBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly selLabel: HTMLSpanElement;
  private readonly drafts: Record<Team, TeamLayout>;
  /** 연 때 저장돼 있던 배치 (고치지 않은 역할은 저장할 때 이 값 그대로 — 이 화면 크기로 다시 계산하지 않는다) */
  private readonly loaded: SavedLayouts;
  /** 이 편집 화면에서 손댄 역할 (옮기기 · 크기 · 반전 · 기본값) */
  private readonly touched = new Set<Team>();
  private team: Team;
  private selected: ControlId | null = null;
  private geo: Geo | null = null;
  private readonly els = new Map<ControlId, HTMLElement>();
  private hudEls: HTMLElement[] = [];
  private rangeEl: HTMLDivElement | null = null;
  private drag: Drag | null = null;
  private warnTimer = 0;
  private closeTimer = 0;
  private againTimer = 0;
  private closed = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly opts: LayoutEditorOptions) {
    this.team = opts.role;
    const saved = loadControlLayouts();
    this.loaded = saved;
    const copy = (t: TeamLayout | null): TeamLayout => ({
      mirror: t?.mirror === true,
      items: { ...(t?.items ?? {}) },
    });
    this.drafts = { survivor: copy(saved.survivor), monster: copy(saved.monster) };

    const btn = (testid: string, label: string, cls = 'btn', ico?: IconId): HTMLButtonElement => {
      const b = h('button', { class: cls, type: 'button', 'data-testid': testid });
      if (ico) b.append(icon(ico, 18));
      b.append(h('span', {}, label));
      return b;
    };
    const seg = h('div', { class: 'le-seg', role: 'group', 'aria-label': EDITOR_TEXT.title });
    for (const t of TEAMS) {
      const b = btn(
        `le-team-${t}`,
        t === 'monster' ? EDITOR_TEXT.monster : EDITOR_TEXT.survivor,
        'btn le-toggle',
        'check',
      );
      onTap(b, () => this.setTeam(t));
      this.teamBtn.set(t, b);
      seg.append(b);
    }
    this.mirrorBtn = btn('le-mirror', EDITOR_TEXT.mirror, 'btn le-toggle', 'check');
    onTap(this.mirrorBtn, () => this.toggleMirror());
    this.resetBtn = btn('le-reset', EDITOR_TEXT.reset, 'btn', 'replay');
    onTap(this.resetBtn, () => this.resetTeam());
    this.smallerBtn = btn('le-smaller', EDITOR_TEXT.smaller);
    onTap(this.smallerBtn, () => this.resize(-1));
    this.biggerBtn = btn('le-bigger', EDITOR_TEXT.bigger);
    onTap(this.biggerBtn, () => this.resize(1));
    this.cancelBtn = btn('le-cancel', EDITOR_TEXT.cancel);
    onTap(this.cancelBtn, () => this.close(false));
    this.saveBtn = btn('le-save', EDITOR_TEXT.save, 'btn btn-primary');
    onTap(this.saveBtn, () => this.save());
    this.selLabel = h('span', { class: 'le-sel', 'data-testid': 'le-selected' });
    // 명령 판 (두 줄 + 안내 한 줄 — 낮은 휴대폰에서도 맵 안 빈 곳에 들어가게): 역할 · 반전 · 기본값 / 크기 · 취소 · 저장
    this.bar = h(
      'div',
      { class: 'panel le-bar', 'data-testid': 'le-bar' },
      h(
        'p',
        { class: 'le-note' },
        h('strong', { class: 'le-title' }, EDITOR_TEXT.title),
        ` ${EDITOR_TEXT.hint}`,
      ),
      h('div', { class: 'le-row' }, seg, this.mirrorBtn, this.resetBtn),
      h(
        'div',
        { class: 'le-row' },
        h(
          'div',
          { class: 'le-size', role: 'group', 'aria-label': EDITOR_TEXT.size },
          this.smallerBtn,
          this.selLabel,
          this.biggerBtn,
        ),
        h('div', { class: 'le-end' }, this.cancelBtn, this.saveBtn),
      ),
    );
    this.msg = h('div', { class: 'le-msg', role: 'status', 'aria-live': 'polite', 'data-testid': 'le-msg' });
    this.msg.hidden = true;
    this.probe = h('div', { class: 'tc-probe' });
    this.stage = h('div', { class: 'le-stage' });
    this.root = h(
      'div',
      {
        class: 'le-root',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': EDITOR_TEXT.title,
        'data-testid': 'layout-editor',
      },
      this.probe,
      this.stage,
      this.bar,
      this.msg,
    );
    const alpha = stickAlphaOf();
    if (alpha < 1) this.root.style.setProperty('--stick-a', String(alpha));

    const on = (t: EventTarget, type: string, fn: (e: Event) => void): void => {
      t.addEventListener(type, fn);
      this.cleanup.push(() => t.removeEventListener(type, fn));
    };
    on(this.stage, 'pointermove', (e) => this.onMove(e as PointerEvent));
    on(this.stage, 'pointerup', (e) => this.onUp(e as PointerEvent));
    on(this.stage, 'pointercancel', (e) => this.onUp(e as PointerEvent));
    on(this.stage, 'lostpointercapture', (e) => this.onUp(e as PointerEvent));
    on(this.root, 'contextmenu', (e) => e.preventDefault());
    // 키보드: 편집 화면은 모달이라 문서 전체에서 받는다 (꺼진 단추에서 포커스가 빠져도)
    on(document, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    // 창 크기 · 방향(가로 180° 뒤집기는 안전 영역만 바뀐다 — 0.3초 뒤 한 번 더): 비율 자리로 다시 그린다
    const onTurn = (): void => {
      this.endDrag();
      this.render();
      window.clearTimeout(this.againTimer);
      this.againTimer = window.setTimeout(() => this.render(), 300);
    };
    on(window, 'resize', onTurn);
    on(screen.orientation ?? window, screen.orientation ? 'change' : 'orientationchange', onTurn);
    opts.host.append(this.root);
    this.render();
    this.saveBtn.focus({ preventScroll: true });
  }

  // ───────────── 기하 ─────────────

  /** 역할 하나의 지금 화면 기하 (그 역할 고친 배치로) */
  private compute(team: Team): Geo {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const p = this.probe.getBoundingClientRect();
    const inset: Insets = { l: p.left, r: vw - p.right, t: p.top, b: vh - p.bottom };
    // 판은 가로에서만 한다: 세로로 받은 크기는 긴 변을 폭으로 (세로 안내가 덮고 있다)
    const w = Math.max(vw, vh);
    const hh = Math.min(vw, vh);
    const draft = this.drafts[team];
    const hud = hudPreview(team, w, hh, inset, { ...matchTuning(team), mirror: draft.mirror });
    const T = tuningOf(hud.layout);
    const avoid = hud.rects.map((r) => r.box);
    const obstacles = hud.inset ? [hud.inset] : [];
    const base = {
      stickScale: T.stickScale,
      menu: true,
      viewRatio: hud.layout.viewW / hud.layout.viewH,
      sysRows: hud.sysRows,
    };
    const monster = team === 'monster';
    const fs = canOfferFullscreen();
    const D = touchLayout(w, hh, inset, monster, fs, avoid, base);
    const L = touchLayout(w, hh, inset, monster, fs, avoid, { ...base, custom: draft, obstacles });
    const list = [...avoid, ...obstacles];
    const pad = thumbMetrics(hh - inset.t - inset.b).pad;
    return {
      team,
      w,
      h: hh,
      hud,
      hudIds: [...hud.rects.map((r) => r.id), ...(hud.inset ? ['minimapInset'] : [])],
      def: baseBoxes(controlBoxes(D), draft.mirror, L.safe),
      boxes: controlBoxes(L),
      safe: L.safe,
      zone: L.zone,
      rules: {
        range: moveRange(L.safe, pad),
        hud: list,
        zone: (side, r) => moveZone(w, L.safe, side, r, list),
        midX: L.safe.x + L.safe.w / 2,
      },
      fallback: L.fallback === true,
    };
  }

  /** 고친 배치의 지금 크기 배율 (하한 · 상한 안) */
  private scaleOf(g: Geo, id: ControlId): number {
    const base = g.def[id];
    const s = this.drafts[g.team].items[id]?.s ?? 1;
    return base ? clampScale(base, s) : s;
  }

  // ───────────── 그리기 ─────────────

  private render(): void {
    if (this.closed) return;
    let g = this.compute(this.team);
    // 저장값을 이 화면에 놓을 자리가 없어 기본 배치가 보이면 옮긴 것을 비운다 (보이는 것이 고치는 것)
    if (g.fallback) {
      this.drafts[this.team].items = {};
      g = this.compute(this.team);
    }
    this.geo = g;
    if (this.selected && !g.boxes[this.selected]) this.selected = null;
    const px = (el: HTMLElement, b: Box): void => {
      Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    };
    const kids: HTMLElement[] = [];
    // 맵 윤곽 + 아래 가운데 'HUD 미리보기' 이름표
    const map = h('div', { class: 'le-map' }, h('span', {}, EDITOR_TEXT.hudPreview));
    px(map, g.hud.map);
    const zone = h('div', { class: 'le-zone' });
    px(zone, g.zone);
    this.rangeEl = h('div', { class: 'le-range' });
    px(this.rangeEl, g.rules.range);
    kids.push(map, zone, this.rangeEl);
    this.hudEls = g.rules.hud.map((b, i) => {
      const id = g.hudIds[i] ?? '';
      const label = HUD_LABEL[id];
      const el = h('div', { class: 'le-hud', 'data-hud': id }, ...(label ? [h('span', {}, label)] : []));
      px(el, b);
      return el;
    });
    kids.push(...this.hudEls);
    this.els.clear();
    for (const id of TEAM_CONTROLS[g.team]) {
      const b = g.boxes[id];
      if (!b) continue;
      const el = this.control(id);
      px(el, b);
      el.classList.toggle('sel', id === this.selected);
      this.els.set(id, el);
      kids.push(el);
    }
    this.stage.replaceChildren(...kids);
    // 명령 판
    for (const [t, b] of this.teamBtn) b.setAttribute('aria-pressed', String(t === g.team));
    const draft = this.drafts[g.team];
    this.mirrorBtn.setAttribute('aria-pressed', String(draft.mirror));
    this.updateSize();
    this.placeBar();
  }

  /** 조작 하나 (진짜 버튼 모양: 판 중과 같은 클래스 · 아이콘 · 이름표) */
  private control(id: ControlId): HTMLElement {
    const look = LOOK[id];
    const ico = (size: number): HTMLElement => {
      const s = h('span', { class: 'tc-ico' });
      s.innerHTML = iconSvg(look.icon, size);
      return s;
    };
    const cap = h('span', { class: 'tc-cap' }, look.label);
    const attrs = {
      'data-ctl': id,
      role: 'button',
      tabindex: '0',
      'aria-label': nameOf(id),
    };
    let el: HTMLElement;
    if (look.kind === 'move') {
      el = h(
        'div',
        { ...attrs, class: 'le-ctl le-move' },
        h('span', { class: 'tc-base' }),
        h('span', { class: 'tc-knob' }),
        cap,
      );
    } else if (look.kind === 'aim') {
      el = h(
        'div',
        { ...attrs, class: 'le-ctl tc-aim', 'data-state': 'ready' },
        h('span', { class: 'tc-base' }, h('span', { class: 'tc-ring' })),
        h('span', { class: 'tc-face cut' }, ico(24)),
        cap,
      );
    } else if (look.kind === 'sys') {
      el = h(
        'div',
        { ...attrs, class: 'le-ctl tc-btn tc-sys' },
        h('span', { class: 'tc-face cut' }, ico(20)),
        cap,
      );
    } else {
      el = h(
        'div',
        { ...attrs, class: `le-ctl tc-btn${id === 'dash' ? ' tc-dash' : ''}`, 'data-state': 'ready' },
        h('span', { class: 'tc-face cut' }, h('span', { class: 'tc-ring' }), ico(24)),
        cap,
      );
    }
    // 눈금 링을 가득 (준비 상태 모양)
    el.style.setProperty('--lit', '24');
    el.addEventListener('pointerdown', (e) => this.onDown(e, id, el));
    el.addEventListener('focus', () => this.select(id));
    return el;
  }

  /** 고른 조작 · 크기 줄 */
  private updateSize(): void {
    const g = this.geo;
    const id = this.selected;
    if (!g || !id) {
      this.selLabel.textContent = `${EDITOR_TEXT.size} —`;
      this.smallerBtn.disabled = true;
      this.biggerBtn.disabled = true;
      return;
    }
    const s = this.scaleOf(g, id);
    const base = g.def[id];
    const lo = base ? clampScale(base, 0) : SIZE_SCALE.min;
    this.selLabel.textContent = `${nameOf(id)} · ${EDITOR_TEXT.size} ${Math.round(s * 100)}%`;
    this.smallerBtn.disabled = s <= lo + 1e-6;
    this.biggerBtn.disabled = s >= SIZE_SCALE.max - 1e-6;
  }

  /**
   * 명령 판 자리: 맵 안 가운데 · 위 · 아래 · 왼쪽 · 오른쪽 중 조작(이름표까지) · HUD와 가장 덜 겹치는 곳 (같으면 앞 순서).
   * 안전 영역 안 (가장자리 8px)
   */
  private placeBar(): void {
    const g = this.geo;
    if (!g) return;
    const bw = this.bar.offsetWidth;
    const bh = this.bar.offsetHeight;
    const m = g.hud.map;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = g.safe;
    const cands = [
      { x: m.x + m.w / 2 - bw / 2, y: m.y + m.h / 2 - bh / 2 },
      { x: m.x + m.w / 2 - bw / 2, y: m.y + 6 },
      { x: m.x + m.w / 2 - bw / 2, y: m.y + m.h - bh - 6 },
      { x: m.x + 6, y: m.y + m.h / 2 - bh / 2 },
      { x: m.x + m.w - bw - 6, y: m.y + m.h / 2 - bh / 2 },
    ].map((c) => ({
      x: Math.round(Math.max(s.x, Math.min(vw - s.x - bw, c.x))),
      y: Math.round(Math.max(8, Math.min(vh - bh - 8, c.y))),
    }));
    const solid: Box[] = [...g.rules.hud];
    for (const id of TEAM_CONTROLS[g.team]) {
      const b = g.boxes[id];
      if (b) solid.push(occupied(id, b));
    }
    const area = (c: { x: number; y: number }): number =>
      solid.reduce((sum, b) => {
        const ox = Math.min(c.x + bw, b.x + b.w) - Math.max(c.x, b.x);
        const oy = Math.min(c.y + bh, b.y + b.h) - Math.max(c.y, b.y);
        return sum + (ox > 0 && oy > 0 ? ox * oy : 0);
      }, 0);
    let best = cands[0]!;
    let bestA = area(best);
    for (const c of cands.slice(1)) {
      const a = area(c);
      if (a < bestA - 0.5) {
        best = c;
        bestA = a;
      }
    }
    Object.assign(this.bar.style, { left: `${best.x}px`, top: `${best.y}px` });
  }

  // ───────────── 고르기 · 끌기 ─────────────

  private select(id: ControlId | null): void {
    if (this.selected === id) return;
    this.selected = id;
    for (const [k, el] of this.els) el.classList.toggle('sel', k === id);
    this.updateSize();
  }

  private onDown(e: PointerEvent, id: ControlId, el: HTMLElement): void {
    const g = this.geo;
    const b = g?.boxes[id];
    if (!g || !b || this.drag || this.closed) return;
    e.preventDefault();
    this.select(id);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 이미 사라진 손가락
    }
    this.drag = {
      id,
      pointerId: e.pointerId,
      offX: e.clientX - b.x,
      offY: e.clientY - b.y,
      last: b,
      moved: false,
    };
    this.root.classList.add('dragging');
    el.classList.add('lifted');
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    const g = this.geo;
    if (!d || !g || e.pointerId !== d.pointerId) return;
    const raw: Box = { ...d.last, x: Math.round(e.clientX - d.offX), y: Math.round(e.clientY - d.offY) };
    const next = this.tryPlace(d.id, raw, d.last, true);
    if (next && (next.x !== d.last.x || next.y !== d.last.y)) {
      d.last = next;
      d.moved = true;
      g.boxes[d.id] = next;
      const el = this.els.get(d.id);
      if (el) Object.assign(el.style, { left: `${next.x}px`, top: `${next.y}px` });
    }
  }

  /**
   * raw 자리에 놓아 본다: 범위 안으로 자르고, 막히면(slide면) 한 축으로 미끄러진 자리, 그래도 막히면 null.
   * 범위 밖이었거나 막혔으면 막은 것을 잠깐 보인다
   */
  private tryPlace(id: ControlId, raw: Box, last: Box, slide: boolean): Box | null {
    const g = this.geo;
    if (!g) return null;
    const others = { ...g.boxes };
    delete others[id];
    const cand = clampBox(raw, g.rules.range);
    const outside = !insideBox(raw, g.rules.range);
    if (placeOk(id, cand, others, g.rules)) {
      if (outside) this.warn(id, { controls: [], hud: [], outside: true });
      return cand;
    }
    this.warn(id, blockersOf(id, cand, others, g.rules));
    if (!slide) return null;
    const tries = [
      { ...cand, y: last.y },
      { ...cand, x: last.x },
    ].filter((b) => placeOk(id, b, others, g.rules));
    if (tries.length === 0) return null;
    tries.sort((a, b) => Math.hypot(a.x - cand.x, a.y - cand.y) - Math.hypot(b.x - cand.x, b.y - cand.y));
    return tries[0] ?? null;
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.endDrag();
    if (d.moved) this.commit(d.id, d.last);
  }

  /** 끌기를 끝낸다 (자리는 그대로) */
  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.root.classList.remove('dragging');
    this.els.get(d.id)?.classList.remove('lifted', 'refused');
  }

  /** 조작 하나의 새 자리를 고친 배치에 적고 다시 그린다 */
  private commit(id: ControlId, box: Box): void {
    const g = this.geo;
    if (!g) return;
    const draft = this.drafts[g.team];
    const place: ControlPlace = placeOf(box, this.scaleOf(g, id), g.rules.range);
    draft.items = { ...draft.items, [id]: place };
    this.touched.add(g.team);
    this.render();
  }

  /** 작게 · 크게 (가운데 그대로, 같은 규칙) */
  private resize(dir: 1 | -1): void {
    const g = this.geo;
    const id = this.selected;
    if (!g || !id) return;
    const base = g.def[id];
    const cur = g.boxes[id];
    if (!base || !cur) return;
    const s0 = this.scaleOf(g, id);
    const s1 = clampScale(base, Math.round((s0 + dir * SIZE_SCALE.step) * 100) / 100);
    if (Math.abs(s1 - s0) < 1e-6) return;
    const box = sizedBox(base, s1, cur.x + cur.w / 2, cur.y + cur.h / 2);
    const next = this.tryPlace(id, box, cur, false);
    if (!next) return;
    const draft = this.drafts[g.team];
    draft.items = { ...draft.items, [id]: placeOf(next, s1, g.rules.range) };
    this.touched.add(g.team);
    this.render();
  }

  /** 막은 조작 · HUD · 가장자리를 잠깐 경고 모양으로 + 안내 */
  private warn(id: ControlId, b: { controls: ControlId[]; hud: number[]; outside: boolean }): void {
    this.clearWarn();
    for (const c of b.controls) this.els.get(c)?.classList.add('blocked');
    for (const i of b.hud) this.hudEls[i]?.classList.add('blocked');
    if (b.outside) this.rangeEl?.classList.add('blocked');
    this.els.get(id)?.classList.add('refused');
    this.say(EDITOR_TEXT.blocked, true);
    this.warnTimer = window.setTimeout(() => this.clearWarn(), WARN_MS);
  }

  private clearWarn(): void {
    window.clearTimeout(this.warnTimer);
    for (const el of this.stage.querySelectorAll('.blocked, .refused'))
      el.classList.remove('blocked', 'refused');
    if (this.msg.classList.contains('warn')) this.msg.hidden = true;
  }

  /** 안내 줄 (경고는 점선 테두리 + ! 아이콘) */
  private say(text: string, warn: boolean): void {
    this.msg.replaceChildren(...(warn ? [icon('warn', 16)] : [icon('check', 16)]), h('span', {}, text));
    this.msg.classList.toggle('warn', warn);
    this.msg.hidden = false;
  }

  private onKey(e: KeyboardEvent): void {
    // 저장하고 닫히는 중에는 받지 않는다
    if (this.closed || this.closeTimer) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close(false);
      return;
    }
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = dirs[e.key];
    const g = this.geo;
    const id = this.selected;
    if (!dir || !g || !id || this.drag) return;
    const cur = g.boxes[id];
    if (!cur) return;
    e.preventDefault();
    const step = KEY_STEP * (e.shiftKey ? 4 : 1);
    const next = this.tryPlace(
      id,
      { ...cur, x: cur.x + dir[0] * step, y: cur.y + dir[1] * step },
      cur,
      false,
    );
    if (next && (next.x !== cur.x || next.y !== cur.y)) {
      this.commit(id, next);
      this.els.get(id)?.focus({ preventScroll: true });
    }
  }

  // ───────────── 명령 ─────────────

  private setTeam(t: Team): void {
    if (t === this.team) return;
    this.endDrag();
    this.team = t;
    this.selected = null;
    this.clearWarn();
    this.render();
  }

  private toggleMirror(): void {
    const d = this.drafts[this.team];
    this.drafts[this.team] = { mirror: !d.mirror, items: flipItems(d.items) };
    this.touched.add(this.team);
    this.clearWarn();
    this.render();
  }

  private resetTeam(): void {
    this.drafts[this.team] = { mirror: false, items: {} };
    this.touched.add(this.team);
    this.selected = null;
    this.clearWarn();
    this.render();
  }

  /**
   * 저장할 역할 배치: 손댄 역할은 지금 화면에 보이는 자리 그대로(밀린 조작은 밀린 자리), 손대지 않은 역할은 연 때 저장값 그대로
   * (다른 크기 화면에서 만든 배치가 이 화면에서 밀리거나 기본으로 돌아간 모양으로 바뀌지 않게)
   */
  private settled(team: Team): TeamLayout | null {
    if (!this.touched.has(team)) return this.loaded[team];
    const draft = this.drafts[team];
    if (isDefaultLayout(draft)) return null;
    const g = this.compute(team);
    const items: Partial<Record<ControlId, ControlPlace>> = {};
    if (!g.fallback)
      for (const id of TEAM_CONTROLS[team]) {
        const b = g.boxes[id];
        if (b && draft.items[id]) items[id] = placeOf(b, this.scaleOf(g, id), g.rules.range);
      }
    return { mirror: draft.mirror, items };
  }

  private save(): void {
    if (this.closed || this.closeTimer) return;
    this.endDrag();
    const out: SavedLayouts = { survivor: this.settled('survivor'), monster: this.settled('monster') };
    const ok = saveControlLayouts(out);
    this.clearWarn();
    this.say(ok ? EDITOR_TEXT.saved : UI_TEXT.qualityNotSaved, false);
    for (const b of this.bar.querySelectorAll('button')) b.disabled = true;
    this.closeTimer = window.setTimeout(() => this.close(true), ok ? 600 : 1800);
  }

  close(saved: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.endDrag();
    window.clearTimeout(this.warnTimer);
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.againTimer);
    for (const f of this.cleanup.splice(0)) f();
    this.root.remove();
    if (open.editor === this) open.editor = null;
    this.opts.onClose(saved);
  }

  /** 디버그 · 시험 */
  debugInfo(): ControlLayoutInfo | null {
    const g = this.geo;
    if (!g || this.closed) return null;
    const box = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });
    return {
      source: 'editor',
      team: g.team,
      mirror: this.drafts[g.team].mirror,
      fallback: g.fallback,
      safe: box(g.safe),
      range: box(g.rules.range),
      zone: box(g.zone),
      controls: TEAM_CONTROLS[g.team].flatMap((id) => {
        const b = g.boxes[id];
        return b ? [{ id, ...box(b) }] : [];
      }),
      hud: g.rules.hud.map((b, i) => ({ id: g.hudIds[i] ?? '', ...box(b) })),
      selected: this.selected,
    };
  }
}
