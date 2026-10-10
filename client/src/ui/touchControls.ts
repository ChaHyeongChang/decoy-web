// 터치 화면 (M11, MOBILE_PLAN M11 4번): #ui-root 안 DOM. 왼쪽 떠 있는 이동 스틱, 오른쪽 역할별 버튼(괴물: 조준 스틱 ·
// 돌진 · 포효 · 시야 모드 · 점수판 / 생존자: 능력 · 구조 · 점수판), 버튼마다 쿨타임 게이지(HUD와 같은 actionSlots 결과).
// 터치 모드(device.touch)에서만 만든다. 손가락 이벤트를 정규화해 TouchFeed로 넣는다.
// 터치 대상 요소에는 data-touch-target="<id>" · data-touch-kind="zone|stick|button"을 단다 (__DECOY__.getTouchTargets).
// 배치는 순수 함수 touchLayout(창 크기 · 안전 영역)이 정하고(단위 테스트), 창 크기가 바뀔 때만 DOM에 쓴다.
// 판 중에는 바뀐 값만 쓴다: 게이지는 CSS 변수 --lit 하나(24눈금이라 쿨타임 동안 24번), 손잡이는 transform만.
// 색만으로 구분하지 않기: 준비 = 눈금 가득 + 강조색 아이콘, 쿨타임 = 눈금 일부 + 남은 초, 효과 중 = 채운 면, 못 씀 = 사선 해치
// M12: 판 HUD(왼쪽 칸 위쪽 타이머 · 게이지 · 팀 카드)와 겹치지 않게 이동 영역을 그 아래에서 시작한다(HUD 자리는 논리 px라
// 창 크기가 바뀌면 캔버스 위치로 다시 잰다). 첫 판(판 직전 터치 안내를 본 판)은 처음 10초 동안 이동 영역 · 스틱 · 버튼 자리를
// 반투명 도형 + 이름표로 보인다(입력을 막지 않음). 점수판이 열려 있으면 화면 어디를 눌러도 닫히고 다른 버튼은 흐려진다.
// 판 배치(HUD 자리 · 글자 px)는 판 시작 크기로 정해지고 판 중에는 캔버스만 줄지만, 버튼은 지금 창 가장자리에 붙는다: 창이 낮아져
// 버튼 · 조준 스틱이 HUD 부품을 덮으면 onCovered로 알린다(GameScene이 미니맵을 숨긴다 — 판 화면 전체가 늘 보여 같은 정보다).
// 가로 180° 뒤집기는 창 크기가 그대로라 resize가 없고 안전 영역만 바뀐다: 방향 change에서도 다시 잰다
import { BTN, type Role } from '@decoy/shared';
import { iconSvg, type IconId } from '../art/icons';
import { hexCss } from '../art/palette';
import { HUD_TEXT, TOUCH_TEXT } from '../data/storyText';
import { canOfferFullscreen, device, enterFullscreen, onDeviceChange } from '../device';
import { TOUCH, type StickKind, type TouchFeed } from '../touchInput';
import { ABILITY_ICON, ACCENT, TICKS, abilityName, litTicks, type ActionSlot, type SlotId } from './hudArt';
import { EDGE_BAND, MIN_GAP, MIN_TARGET, VIEW_H, VIEW_W, thumbMetrics } from './layout';
import { h } from './uiArt';

export { EDGE_BAND, MIN_GAP, MIN_TARGET };

/** 프레임마다 GameScene이 넘기는 값. 바뀐 것만 DOM에 반영한다 */
export interface TouchView {
  /** 행동 칸 (actionSlots 결과 그대로: 생존자 능력 · 구조, 괴물 공격 · 돌진 · 포효 · 시야 모드) */
  slots: ActionSlot[];
}

export interface TouchControlsOptions {
  role: Role;
  feed: TouchFeed;
  /**
   * 늘 떠 있는 판 HUD 부품 (논리 px)과 지금 캔버스 자리(창 CSS px의 왼쪽 위 · 논리 1px의 CSS px). 이동 영역을 그 아래에서
   * 시작한다 (M12). 없으면 M11 배치 그대로. onCovered = 다시 배치할 때마다 버튼 · 조준 스틱이 덮는 부품 id (hudCovered)
   */
  hud?: {
    rects: readonly { id: string; rect: Box }[];
    canvas: () => { left: number; top: number; k: number } | null;
    onCovered?: (ids: ReadonlySet<string>) => void;
  };
}

// ───────────────────────── 배치 (순수) ─────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 안전 영역 (env(safe-area-inset-*), CSS px) */
export interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

export type TouchButtonId = 'dash' | 'roar' | 'mode' | 'ability' | 'rescue' | 'scoreboard' | 'fullscreen';

// 화면 가장자리 제스처 띠(EDGE_BAND: 좌우 안전 영역 + 32px, 아래 + 24px — 이 띠에서 시작한 터치는 무시한다) ·
// 터치 대상 최소 크기 · 간격(MIN_TARGET · MIN_GAP, CSS px = dp)은 layout.ts에 있다 (HUD 배치가 같은 수치로 엄지 자리를 비운다)
/** 이동 스틱이 생기는 영역: 화면 왼쪽 이 비율 안 */
export const MOVE_ZONE_RATIO = 0.4;

export interface TouchLayout {
  /** 터치가 시작될 수 있는 사각형 (가장자리 띠 안쪽) */
  safe: Box;
  /** 이동 스틱 생성 영역 */
  zone: Box;
  /** 이동 스틱 반지름 (손가락 거리 / 이 값 = 스틱 값) */
  moveR: number;
  /** 손가락이 없을 때 이동 스틱을 흐리게 보여 주는 자리 (가운데) */
  moveHome: { x: number; y: number };
  /** 조준 스틱 (괴물, 정사각형 · 반지름 w/2) */
  aim: Box | null;
  /** 돌진 버튼을 끌어 만드는 작은 스틱의 반지름 */
  dashR: number;
  buttons: Partial<Record<TouchButtonId, Box>>;
}

/**
 * 터치 화면 배치 (CSS px). 크기는 안전 영역 안 높이에 비례(휴대폰 293~400px → 0.84~1.05배, 태블릿도 1.05배까지 —
 * dp는 손가락 크기라 큰 화면이라고 키우지 않는다, layout.thumbMetrics)하되 터치 대상은 48px 이상, 대상끼리 사각형 기준 8px 이상
 * 띄우고, 모두 가장자리 띠 안쪽에 둔다. 오른쪽 아래가 엄지 자리:
 * 괴물 = 조준 스틱(큰 원) + 왼쪽 돌진 · 위 시야 모드 · 그 왼쪽 포효, 생존자 = 능력(큰 버튼) + 왼쪽 위 구조.
 * 오른쪽 위에 점수판 · 전체 화면(브라우저 안일 때만).
 * avoid(M12) = 판 HUD 부품 사각형(창 CSS px): 이동 영역은 그와 가로로 겹치는 부품 아래에서 시작한다(이동 스틱 그림이 들어갈
 * 높이는 남긴다). 버튼 무리 · 시스템 버튼 자리는 판 HUD 배치(layout.touchHudPlan)가 같은 식으로 비워 두었다
 */
export function touchLayout(
  w: number,
  h: number,
  inset: Insets,
  monster: boolean,
  fullscreen: boolean,
  avoid: readonly Box[] = [],
): TouchLayout {
  const t = thumbMetrics(h - inset.t - inset.b);
  const pad = t.pad;
  const gap = t.gap;
  const rowGap = t.rowGap;
  const btn = t.btn;
  const safe: Box = {
    x: inset.l + EDGE_BAND.side,
    y: inset.t,
    w: w - inset.l - inset.r - EDGE_BAND.side * 2,
    h: h - inset.t - inset.b - EDGE_BAND.bottom,
  };
  const right = safe.x + safe.w - pad;
  const bottom = safe.y + safe.h - pad;
  const sq = (x: number, y: number, s: number): Box => ({ x, y, w: s, h: s });
  const buttons: Partial<Record<TouchButtonId, Box>> = {};
  let aim: Box | null = null;
  if (monster) {
    const r = t.aimR;
    aim = sq(right - r * 2, bottom - r * 2, r * 2);
    const top = aim.y - rowGap - btn;
    buttons.dash = sq(aim.x - gap - btn, aim.y + r - btn / 2, btn);
    buttons.mode = sq(aim.x + r - btn / 2, top, btn);
    // 포효: 시야 모드 바로 왼쪽 (조준 스틱 위 줄이라 사각형이 겹치지 않는다)
    buttons.roar = sq(buttons.mode.x - gap - btn, top, btn);
  } else {
    const a = t.ability;
    buttons.ability = sq(right - a, bottom - a, a);
    const rs = t.rescue;
    buttons.rescue = sq(right - a - gap - rs, bottom - a / 2 - rs / 2 - Math.round(a * 0.3), rs);
  }
  // 오른쪽 위: 점수판(맨 오른쪽 위) · 전체 화면. 전체 화면은 판 화면 옆 빈 띠에 자리가 있으면 점수판 아래(세로 줄),
  // 아니면 점수판 왼쪽
  const sysH = t.sysH;
  const sysW = t.sysW;
  const sysY = safe.y + pad + 2;
  buttons.scoreboard = { x: right - sysW, y: sysY, w: sysW, h: sysH };
  if (fullscreen) {
    const below = sysY + sysH + gap;
    // 엄지 자리 맨 윗줄 (괴물: 포효 · 시야 모드, 생존자: 구조)
    const thumbTop = (buttons.mode ?? buttons.rescue)?.y ?? bottom;
    // 16:9 판 화면 옆 빈 띠(긴 휴대폰 브라우저)에 세로 줄이 들어가면 미니맵을 가리지 않는다
    const pillar = (w - (h * VIEW_W) / VIEW_H) / 2;
    buttons.fullscreen =
      pillar >= w - buttons.scoreboard.x && below + sysH + rowGap <= thumbTop
        ? { x: right - sysW, y: below, w: sysW, h: sysH }
        : { x: right - sysW * 2 - gap, y: sysY, w: sysW, h: sysH };
  }
  const moveR = t.moveR;
  const zone: Box = { x: safe.x, y: safe.y, w: Math.round(w * MOVE_ZONE_RATIO) - safe.x, h: safe.h };
  // 판 HUD 아래에서 시작 (이동 스틱 그림 + 위 8px은 남긴다)
  const safeBottom = safe.y + safe.h;
  let top = zone.y;
  for (const r of avoid)
    if (r.x < zone.x + zone.w && r.x + r.w > zone.x && r.y < safeBottom)
      top = Math.max(top, r.y + r.h + MIN_GAP);
  top = Math.min(top, safeBottom - moveR * 2 - 24);
  if (top > zone.y) {
    zone.h = safeBottom - top;
    zone.y = top;
  }
  return {
    safe,
    zone,
    moveR,
    moveHome: { x: zone.x + moveR + 16, y: safe.y + safe.h - moveR - 16 },
    aim,
    dashR: Math.round(btn * 0.9),
    buttons,
  };
}

/**
 * 버튼 · 조준 스틱(점수판 · 전체 화면 포함)과 겹치는 판 HUD 부품의 id (창 CSS px, 닿기만 하면 아니다).
 * 판 시작 크기에서는 HUD 배치가 엄지 자리를 비워 두어 비어 있다. 판 중 창이 낮아지면 생긴다 (M12 검토)
 */
export function hudCovered(L: TouchLayout, boxes: readonly { id: string; b: Box }[]): Set<string> {
  const ts = [L.aim, ...Object.values(L.buttons)];
  const out = new Set<string>();
  for (const { id, b } of boxes)
    if (ts.some((t) => t && t.x < b.x + b.w && b.x < t.x + t.w && t.y < b.y + b.h && b.y < t.y + t.h))
      out.add(id);
  return out;
}

/** 가장자리 띠에서 시작한 터치인가 (안전 영역 사각형 밖) */
export function inEdgeBand(x: number, y: number, safe: Box): boolean {
  return x < safe.x || x > safe.x + safe.w || y < safe.y || y > safe.y + safe.h;
}

/**
 * 스틱 중심 (CSS px): 조준 스틱은 고정 중심(요소 가운데), 이동 · 돌진은 누른 자리.
 * 돌진 버튼을 가운데에서 벗어나 탭해도 그 어긋남이 '끌기'로 잡히지 않게 한다(끌지 않은 탭 = 지금 방향)
 */
export function stickCenter(kind: StickKind, L: TouchLayout, x: number, y: number): { x: number; y: number } {
  if (kind === 'aim' && L.aim) return { x: L.aim.x + L.aim.w / 2, y: L.aim.y + L.aim.h / 2 };
  return { x, y };
}

/** 스틱 값: 중심에서 손가락까지 / 반지름, 길이 1로 자른다 */
export function stickVector(dx: number, dy: number, r: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy) / r;
  const s = len > 1 ? 1 / len : 1;
  return { x: (dx / r) * s, y: (dy / r) * s };
}

// ───────────────────────── 화면 ─────────────────────────

type PartId = SlotId | 'scoreboard' | 'fullscreen';

/** 버튼 하나 (행동 칸 · 점수판 · 전체 화면) 또는 조준 스틱 */
interface Part {
  el: HTMLElement;
  /** 아이콘 · 남은 초가 든 면 (돌진 · 조준은 끄는 동안 손잡이가 되어 움직인다) */
  face: HTMLElement;
  ico: HTMLElement;
  secs: HTMLElement | null;
  cap: HTMLElement;
  /** 마지막으로 쓴 값 (바뀔 때만 DOM에) */
  key: string;
  accent: string;
  icon: string;
  label: string;
}

interface Finger {
  kind: StickKind | 'tap' | 'hold';
  /** 손가락을 붙잡은 요소 (눌림 · 조준 표시) */
  el: HTMLElement;
  /** 손잡이 (스틱) */
  knob: HTMLElement | null;
  cx: number;
  cy: number;
  r: number;
  /** 조준: 데드존 밖에 한 번이라도 나갔다 (가운데로 돌아오면 '취소' 표시) */
  out: boolean;
}

/** 탭 버튼 → 누름 비트 */
const TAP_BITS: Partial<Record<SlotId, number>> = { roar: BTN.ROAR, mode: BTN.MODE, ability: BTN.ABILITY };

/** 터치 화면 */
export class TouchControls {
  /** 점수판 버튼으로 켠 상태 (GameScene이 Tab 대신 읽는다) */
  scoreboard = false;
  private readonly layer: HTMLDivElement;
  private readonly probe: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly move: HTMLDivElement;
  private readonly moveKnob: HTMLDivElement;
  private readonly parts = new Map<PartId, Part>();
  private readonly fingers = new Map<number, Finger>();
  private readonly cleanup: (() => void)[] = [];
  private layout: TouchLayout | null = null;
  private active = true;
  private live = true;
  /** 판 안 첫 탭에서 전체 화면을 한 번 요청했다 */
  private fsTried = false;
  /** 첫 판 위치 표시 (M12): 반투명 도형 + 이름표, 입력을 막지 않는다 */
  private hints: HTMLDivElement | null = null;
  private hintTimer: number | null = null;

  constructor(
    readonly root: HTMLElement,
    readonly opts: TouchControlsOptions,
  ) {
    const role = opts.role;
    this.layer = h('div', { class: `touch-layer tc-${role === 'monster' ? 'monster' : 'survivor'}` });
    this.probe = h('div', { class: 'tc-probe' });
    this.zone = h('div', { class: 'tc-zone', 'data-touch-target': 'move-zone', 'data-touch-kind': 'zone' });
    this.moveKnob = h('div', { class: 'tc-knob' });
    this.move = h(
      'div',
      { class: 'tc-move', 'aria-hidden': 'true' },
      h('div', { class: 'tc-base' }),
      this.moveKnob,
      h('span', { class: 'tc-cap' }, TOUCH_TEXT.move),
    );
    this.layer.append(this.probe, this.move, this.zone);
    this.zone.addEventListener('pointerdown', (e) => this.startStick(e, 'move', this.zone, this.moveKnob));
    if (role === 'monster') {
      const aim = this.part('attack', 'aim-stick', 'attack', HUD_TEXT.attack, 'tc-aim');
      aim.el.addEventListener('pointerdown', (e) => this.startStick(e, 'aim', aim.el, aim.face));
      const dash = this.part('dash', 'dash', 'dash', HUD_TEXT.dash, 'tc-btn tc-dash');
      dash.el.addEventListener('pointerdown', (e) => this.startStick(e, 'dash', dash.el, dash.face));
      this.tapButton('roar', 'roar', HUD_TEXT.roar);
      this.tapButton('mode', 'visionSearch', HUD_TEXT.mode);
    } else {
      this.tapButton('ability', ABILITY_ICON[role], abilityName(role));
      const rescue = this.part('rescue', 'rescue', 'rescue', TOUCH_TEXT.rescue);
      rescue.el.addEventListener('pointerdown', (e) => {
        if (this.grab(e, 'hold', rescue.el)) opts.feed.hold(BTN.RESCUE, true);
      });
    }
    const board = this.part('scoreboard', 'scoreboard', 'scoreboard', HUD_TEXT.scoreboard, 'tc-btn tc-sys');
    board.el.setAttribute('aria-pressed', 'false');
    board.el.addEventListener('pointerdown', (e) => {
      if (!this.grab(e, 'tap', board.el)) return;
      this.setBoard(!this.scoreboard);
    });
    if (canOfferFullscreen()) {
      const fs = this.part(
        'fullscreen',
        'fullscreen',
        'fullscreen',
        TOUCH_TEXT.fullscreen,
        'tc-btn tc-sys tc-fs',
      );
      fs.el.addEventListener('pointerdown', (e) => this.grab(e, 'tap', fs.el));
    }

    const on = (t: EventTarget, type: string, fn: (e: Event) => void, capture = false): void => {
      t.addEventListener(type, fn, capture);
      this.cleanup.push(() => t.removeEventListener(type, fn, capture));
    };
    // 붙잡은 손가락의 이벤트는 그 요소로 와서 레이어까지 올라온다
    on(this.layer, 'pointermove', (e) => this.onMove(e as PointerEvent));
    on(this.layer, 'pointerup', (e) => this.onUp(e as PointerEvent));
    on(this.layer, 'pointercancel', (e) => this.drop((e as PointerEvent).pointerId));
    on(this.layer, 'lostpointercapture', (e) => this.drop((e as PointerEvent).pointerId));
    on(this.layer, 'contextmenu', (e) => e.preventDefault());
    // 점수판이 열려 있으면 화면 어디를 눌러도 닫힌다 (점수판 버튼 자체는 위 핸들러가 끈다). 누른 동작은 그대로 한다
    on(
      document,
      'pointerdown',
      (e) => {
        if (
          !this.scoreboard ||
          (e.target instanceof Element && e.target.closest('[data-touch-target="scoreboard"]'))
        )
          return;
        this.setBoard(false);
      },
      true,
    );
    // 손가락이 사라지는 경우: 창 이탈 · 숨김 · 화면 회전 · 전체 화면 전환(창 크기가 바뀌면 손가락 좌표 기준이 달라진다)
    on(window, 'blur', () => this.cancelAll());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.cancelAll();
    });
    // 창 크기 변화 · 화면 방향 change(가로 180° 뒤집기는 resize 없이 안전 영역만 바뀐다). 안전 영역(env) 값은 방향 이벤트보다
    // 늦게 올 수 있어 0.3초 뒤 한 번 더 잰다. 손가락 좌표 기준이 달라지므로 손가락은 버린다 (input.ts가 회전 때 TouchFeed도 비운다)
    let again = 0;
    const onTurn = (): void => {
      this.cancelAll();
      this.relayout();
      window.clearTimeout(again);
      again = window.setTimeout(() => this.relayout(), 300);
    };
    on(window, 'resize', onTurn);
    on(screen.orientation ?? window, screen.orientation ? 'change' : 'orientationchange', onTurn);
    this.cleanup.push(() => window.clearTimeout(again));
    this.cleanup.push(onDeviceChange(() => this.apply()));
    root.appendChild(this.layer);
    this.relayout();
    this.apply();
  }

  /** 버튼 · 조준 스틱 요소 하나: 면(눈금 링 + 아이콘 + 남은 초) + 이름표 */
  private part(id: PartId, target: string, icon: IconId, label: string, cls = 'tc-btn'): Part {
    const sys = cls.includes('tc-sys');
    const stick = cls === 'tc-aim';
    const ico = h('span', { class: 'tc-ico' });
    ico.innerHTML = iconSvg(icon, sys ? 20 : 24);
    const ring = h('span', { class: 'tc-ring' });
    const secs = sys ? null : h('span', { class: 'tc-secs num' });
    const face = h('span', { class: 'tc-face cut' });
    // 조준 스틱: 눈금 링(공격 쿨타임)은 움직이지 않는 바닥에, 손잡이에는 아이콘 · 남은 초
    face.append(...(sys || stick ? [] : [ring]), ico, ...(secs ? [secs] : []));
    const el = h(
      stick ? 'div' : 'button',
      {
        class: cls,
        'data-touch-target': target,
        'data-touch-kind': stick ? 'stick' : 'button',
        'aria-label': label,
        tabindex: '-1',
      },
      ...(stick ? [h('span', { class: 'tc-base' }, ring)] : []),
      ...(sys ? [] : [h('span', { class: 'tc-dir' })]),
      face,
    );
    if (!sys) el.dataset.state = 'blocked';
    const cap = h('span', { class: 'tc-cap' }, label);
    el.append(cap);
    if (el instanceof HTMLButtonElement) el.type = 'button';
    this.layer.append(el);
    const p: Part = { el, face, ico, secs, cap, key: '', accent: '', icon, label };
    this.parts.set(id, p);
    return p;
  }

  private tapButton(id: SlotId, icon: IconId, label: string): void {
    const p = this.part(id, id, icon, label);
    const bit = TAP_BITS[id] ?? 0;
    p.el.addEventListener('pointerdown', (e) => {
      if (this.grab(e, 'tap', p.el)) this.opts.feed.tap(bit);
    });
  }

  /** 손가락 하나를 붙잡는다 (켜져 있고 가장자리 띠 밖이면). 눌림 표시 */
  private grab(e: PointerEvent, kind: Finger['kind'], el: HTMLElement, f?: Partial<Finger>): boolean {
    const L = this.layout;
    if (!this.live || !L || inEdgeBand(e.clientX, e.clientY, L.safe)) return false;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 이미 사라진 손가락
    }
    this.fingers.set(e.pointerId, { kind, el, knob: null, cx: 0, cy: 0, r: 1, out: false, ...f });
    el.classList.add('down');
    return true;
  }

  /** 스틱 시작: 이동 · 돌진은 누른 자리가 중심, 조준은 고정 중심(stickCenter). 종류마다 손가락 하나 */
  private startStick(e: PointerEvent, kind: StickKind, el: HTMLElement, knob: HTMLElement): void {
    const L = this.layout;
    if (!L) return;
    for (const f of this.fingers.values()) if (f.kind === kind) return;
    const c = stickCenter(kind, L, e.clientX, e.clientY);
    const r = kind === 'aim' && L.aim ? L.aim.w / 2 : kind === 'dash' ? L.dashR : L.moveR;
    if (!this.grab(e, kind, el, { knob, cx: c.x, cy: c.y, r })) return;
    this.opts.feed.stickStart(e.pointerId, kind, performance.now());
    if (kind === 'move') {
      this.move.style.transform = `translate(${c.x}px,${c.y}px)`;
      this.move.classList.add('live');
    } else this.onMove(e);
  }

  private onMove(e: PointerEvent): void {
    const f = this.fingers.get(e.pointerId);
    if (!f || !f.knob) return;
    const v = stickVector(e.clientX - f.cx, e.clientY - f.cy, f.r);
    this.opts.feed.stickMove(e.pointerId, v.x, v.y);
    // 손잡이는 바닥 원 안에서만 (반지름 0.4 손잡이 → 0.6까지). 돌진은 버튼 전체가 끄는 고리까지 빠진다
    const travel = f.kind === 'dash' ? f.r : f.r * 0.6;
    f.knob.style.transform = `translate(${v.x * travel}px,${v.y * travel}px)`;
    const outside = Math.hypot(v.x, v.y) > TOUCH.deadZone;
    if (outside) {
      f.out = true;
      // 방향 표시: 12시가 0, 시계 방향
      f.el.style.setProperty('--dir', `${Math.atan2(v.x, -v.y)}rad`);
    }
    f.el.classList.toggle('aiming', outside);
    // 데드존 밖에 나갔다가 돌아오면 취소 표시 (조준 · 돌진, 상태 기계도 떼면 취소한다)
    f.el.classList.toggle('cancel', f.kind !== 'move' && f.out && !outside);
  }

  private onUp(e: PointerEvent): void {
    // 판 안 첫 탭에서 전체 화면 + 가로 고정 (터치의 pointerup은 사용자 활성화다). 전체 화면 버튼은 탭마다.
    // 다른 손가락을 누르고 있으면 미룬다: 전체 화면 전환의 창 크기 변화가 모든 손가락을 취소하므로(이동 · 구조가 끊김)
    const others = [...this.fingers.keys()].some((id) => id !== e.pointerId);
    const fsBtn = e.target instanceof Element && e.target.closest('.tc-fs') !== null;
    if ((!this.fsTried && !others) || fsBtn) {
      this.fsTried = true;
      enterFullscreen();
    }
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.release(e.pointerId, f);
    if (f.kind === 'hold') this.opts.feed.hold(BTN.RESCUE, false);
    else if (f.kind !== 'tap') this.opts.feed.stickEnd(e.pointerId, performance.now());
  }

  /** 손가락이 사라짐 (pointercancel · lostpointercapture): 효과를 버린다. 뗀 뒤 오는 lostpointercapture는 이미 없다 */
  private drop(id: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    this.release(id, f);
    if (f.kind === 'hold') this.opts.feed.hold(BTN.RESCUE, false);
    else if (f.kind !== 'tap') this.opts.feed.stickCancel(id);
  }

  /** 손가락 기록과 눌림 · 조준 표시를 지운다 */
  private release(id: number, f: Finger): void {
    this.fingers.delete(id);
    f.el.classList.remove('down', 'aiming', 'cancel');
    if (f.knob) f.knob.style.transform = '';
    if (f.kind === 'move') {
      this.move.style.transform = '';
      this.move.classList.remove('live');
    }
  }

  /** 모든 손가락을 버린다 (붙잡기도 놓는다) */
  private cancelAll(): void {
    for (const [id, f] of [...this.fingers]) {
      this.drop(id);
      try {
        f.el.releasePointerCapture(id);
      } catch {
        // 이미 놓였다
      }
    }
  }

  /** 점수판 켜고 끄기 (켜져 있으면 다른 터치 버튼을 흐리게) */
  private setBoard(on: boolean): void {
    this.scoreboard = on;
    this.parts.get('scoreboard')?.el.setAttribute('aria-pressed', String(on));
    this.layer.classList.toggle('board', on);
  }

  /** 판 HUD 부품 자리 (창 CSS px). 캔버스 자리를 모르면 빈 목록 */
  private hudBoxes(): { id: string; b: Box }[] {
    const hud = this.opts.hud;
    const c = hud?.canvas();
    if (!hud || !c) return [];
    return hud.rects.map(({ id, rect: r }) => ({
      id,
      b: { x: c.left + r.x * c.k, y: c.top + r.y * c.k, w: r.w * c.k, h: r.h * c.k },
    }));
  }

  /** 창 크기 · 안전 영역이 바뀌면 다시 배치한다 (읽기 → 쓰기) */
  private relayout(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const p = this.probe.getBoundingClientRect();
    const inset = { l: p.left, r: w - p.right, t: p.top, b: hgt - p.bottom };
    const boxes = this.hudBoxes();
    const L = touchLayout(
      w,
      hgt,
      inset,
      this.opts.role === 'monster',
      this.parts.has('fullscreen'),
      boxes.map((x) => x.b),
    );
    this.layout = L;
    this.opts.hud?.onCovered?.(hudCovered(L, boxes));
    const place = (el: HTMLElement | undefined, b: Box | null | undefined): void => {
      if (el && b)
        Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    };
    place(this.zone, L.zone);
    const st = this.layer.style;
    st.setProperty('--mr', `${L.moveR}px`);
    st.setProperty('--dr', `${L.dashR}px`);
    st.setProperty('--hx', `${L.moveHome.x}px`);
    st.setProperty('--hy', `${L.moveHome.y}px`);
    place(this.parts.get('attack')?.el, L.aim);
    for (const [id, b] of Object.entries(L.buttons)) place(this.parts.get(id as TouchButtonId)?.el, b);
    if (this.hints) this.drawHints();
  }

  /**
   * 첫 판 위치 표시 (M12, TOUCH_HINT_MS 동안): 이동 영역(점선 판 + '여기를 누르고 끌어 이동')과 스틱 · 버튼 둘레의 빛 고리.
   * 입력을 막지 않고(pointer-events 없음), 이동 영역은 화면 왼쪽 40% 안이라 가운데(감옥 = 생존자 시작 위치)를 가리지 않는다.
   * 버튼 이름은 버튼 이름표가 이미 보인다
   */
  showHints(ms: number): void {
    if (!this.hints) {
      this.hints = h('div', { class: 'tc-hints', 'aria-hidden': 'true' });
      this.layer.append(this.hints);
    }
    this.drawHints();
    this.hints.classList.remove('gone');
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hintTimer = null;
      this.hints?.classList.add('gone');
    }, ms);
  }

  /** 위치 표시 도형을 지금 배치에 맞춘다 (창 크기가 바뀔 때만) */
  private drawHints(): void {
    const L = this.layout;
    const root = this.hints;
    if (!L || !root) return;
    const box = (cls: string, b: Box, label?: string): HTMLElement => {
      const el = h('div', { class: cls }, ...(label ? [h('span', { class: 'tc-hint-cap' }, label)] : []));
      Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      return el;
    };
    const ring = (b: Box, cls = ''): HTMLElement =>
      box(`tc-hint-ring${cls}`, { x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 });
    const parts: HTMLElement[] = [box('tc-hint-zone', L.zone, TOUCH_TEXT.hintMove)];
    if (L.aim) parts.push(ring(L.aim, ' round'));
    for (const [id, b] of Object.entries(L.buttons)) if (b && id !== 'fullscreen') parts.push(ring(b));
    root.replaceChildren(...parts);
  }

  /** 디버그 · 테스트: 위치 표시가 보이는가 */
  get hintsShown(): boolean {
    return this.hints !== null && !this.hints.classList.contains('gone');
  }

  /** 프레임마다: 쿨타임 게이지 · 버튼 상태 (바뀐 것만) */
  update(view: TouchView): void {
    for (const s of view.slots) {
      const p = this.parts.get(s.id);
      if (!p) continue;
      const lit = s.state === 'blocked' ? 0 : s.fill >= 1 ? TICKS : litTicks(s.fill);
      const secs = s.state === 'cooldown' ? String(Math.ceil(s.cd)) : '';
      const key = `${s.state}|${lit}|${secs}`;
      if (s.accent !== p.accent) {
        p.accent = s.accent;
        const a = ACCENT[s.accent];
        const st = p.el.style;
        st.setProperty('--acc', hexCss(a.line));
        st.setProperty('--acc-t', hexCss(a.text));
        st.setProperty('--acc-a', `rgba(${[16, 8, 0].map((sh) => (a.line >> sh) & 255).join()},.3)`);
      }
      if (key !== p.key) {
        p.key = key;
        p.el.dataset.state = s.state;
        p.el.style.setProperty('--lit', String(lit));
        if (p.secs) p.secs.textContent = secs;
      }
      if (s.icon !== p.icon) {
        p.icon = s.icon;
        p.ico.innerHTML = iconSvg(s.icon, 24);
      }
      if (s.label !== p.label) {
        p.label = s.label;
        p.cap.textContent = s.label;
        p.el.setAttribute('aria-label', s.label);
      }
    }
  }

  /** 끄면(결과 · 관전 · 세로 · 대화상자) 즉시 손가락 상태를 비우고(feed.stickCancel) 입력을 받지 않는다 */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.apply();
  }

  /** 켜짐 = 바깥에서 켬 + 세로 화면이 아님 */
  private apply(): void {
    const live = this.active && !device.portrait;
    if (live === this.live) return;
    this.live = live;
    if (!live) {
      this.cancelAll();
      this.setBoard(false);
    }
    this.layer.classList.toggle('off', !live);
  }

  destroy(): void {
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.cancelAll();
    for (const f of this.cleanup.splice(0)) f();
    this.layer.remove();
  }
}
