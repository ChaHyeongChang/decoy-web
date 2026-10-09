// E2E 멀티터치 (M11): CDP Input.dispatchTouchEvent로 손가락 여러 개를 따로 누르고 · 끌고 · 뗀다.
// Playwright에는 손가락 하나짜리 tap만 있어서 스틱 두 개를 동시에 잡는 시험은 이것으로 한다.
//
// Chromium 141에서 실험으로 확인한 CDP 의미 (tests/e2e/m11-tools.spec.ts가 계속 확인한다):
// - touchStart · touchMove · touchEnd의 touchPoints에는 **바뀐 손가락만** 넣는다. 나머지 손가락은 그대로 눌려 있다
//   (손가락 하나만 뗄 때는 그 손가락만 touchEnd에 넣는다. 남은 손가락만 담은 touchMove로는 떼어지지 않는다)
// - 눌리지 않은 id로 touchMove · touchEnd를 보내면 새 손가락이 생긴다 → 이 모듈은 오류로 막는다
// - touchEnd에 빈 목록 = 모든 손가락 떼기. touchCancel은 손가락을 줄 수 없고 모든 손가락을 취소한다(하나만 취소는 불가)
// - 손가락마다 pointerId가 다르고 pointerType은 'touch', 처음 손가락만 isPrimary
// - 좌표는 CSS px, 창(레이아웃 뷰포트) 기준. 기기 배율(deviceScaleFactor)과 상관없다
// - 브라우저 제스처 처리를 그대로 탄다: touch-action이 auto인 곳을 끌면 스크롤되고 pointercancel이 난다(대조 시험에 쓸 수 있다)
// - 핀치: 두 손가락을 벌리면 보호하지 않은 페이지가 실제로 확대된다(visualViewport.scale > 1, 같은 touchMove로 함께
//   움직이는 쪽이 번갈아 보내기보다 더 크게 확대된다). meta viewport 잠금이나 touch-action: none이면 1 그대로.
//   Input.synthesizePinchGesture는 'touch' 원천이면 손가락 이벤트만 나고 확대되지 않는다. 'mouse' 원천은 터치패드 핀치라
//   확대되지만 touch-action을 무시한다(meta viewport 잠금만 확인된다) → 손가락 핀치(pinch)를 쓴다
import type { CDPSession, Page } from '@playwright/test';
import type { TouchTarget } from '@decoy/shared';

export interface Point {
  x: number;
  y: number;
}

export interface MoveOptions {
  /** 시작점에서 끝점까지 나눠 보낼 touchMove 수 (기본 1) */
  steps?: number;
  /** 단계 사이 쉬는 시간 ms (기본 0). 입력 프레임(1/30초)마다 다른 위치를 보게 하려면 34 정도 */
  stepMs?: number;
}

interface CdpTouchPoint {
  id: number;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  force: number;
}

/** 손가락 접촉면 반지름 (CSS px). 실제 손가락 크기쯤 */
const FINGER_RADIUS = 6;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 손가락 여러 개. 페이지마다 하나 붙인다.
 * ```ts
 * const t = await MultiTouch.attach(page);
 * await t.down(1, 120, 300);                     // 왼손: 이동 스틱
 * await t.move(1, 120, 240, { steps: 6 });       // 위로 끌기
 * await t.down(2, 760, 300);                     // 오른손: 조준 스틱
 * await t.move(2, 820, 300, { steps: 4 });
 * await t.up(2);                                 // 오른손만 뗀다 — 왼손은 계속 눌려 있다
 * await t.detach();                              // 남은 손가락을 떼고 CDP 세션을 닫는다
 * ```
 */
export class MultiTouch {
  private readonly fingers = new Map<number, CdpTouchPoint>();

  private constructor(
    readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(page: Page): Promise<MultiTouch> {
    return new MultiTouch(page, await page.context().newCDPSession(page));
  }

  /** 지금 눌린 손가락 id */
  get active(): number[] {
    return [...this.fingers.keys()];
  }

  /** 손가락의 지금 자리 (눌리지 않았으면 null) */
  position(id: number): Point | null {
    const f = this.fingers.get(id);
    return f ? { x: f.x, y: f.y } : null;
  }

  /** 손가락 id를 (x, y)에 댄다. 다른 손가락은 그대로 */
  async down(id: number, x: number, y: number): Promise<void> {
    if (this.fingers.has(id)) throw new Error(`손가락 ${id}는 이미 눌려 있습니다`);
    const p = point(id, x, y);
    this.fingers.set(id, p);
    await this.send('touchStart', [p]);
  }

  /** 손가락 id를 (x, y)까지 끈다 (steps번에 나눠). 다른 손가락은 그대로 */
  async move(id: number, x: number, y: number, opts: MoveOptions = {}): Promise<void> {
    await this.moveMany([{ id, x, y }], opts);
  }

  /** 여러 손가락을 같은 touchMove로 함께 끈다 (핀치 · 두 스틱 동시 조작) */
  async moveMany(targets: ({ id: number } & Point)[], opts: MoveOptions = {}): Promise<void> {
    const steps = Math.max(1, Math.round(opts.steps ?? 1));
    const from = targets.map((t) => {
      const f = this.fingers.get(t.id);
      if (!f) throw new Error(`손가락 ${t.id}는 눌려 있지 않습니다`);
      return { x: f.x, y: f.y };
    });
    for (let s = 1; s <= steps; s += 1) {
      const k = s / steps;
      const pts = targets.map((t, i) => {
        const a = from[i] ?? t;
        const p = point(t.id, a.x + (t.x - a.x) * k, a.y + (t.y - a.y) * k);
        this.fingers.set(t.id, p);
        return p;
      });
      await this.send('touchMove', pts);
      if (opts.stepMs && s < steps) await sleep(opts.stepMs);
    }
  }

  /** 손가락 id만 뗀다. 다른 손가락은 계속 눌려 있다 */
  async up(id: number): Promise<void> {
    const f = this.fingers.get(id);
    if (!f) throw new Error(`손가락 ${id}는 눌려 있지 않습니다`);
    this.fingers.delete(id);
    await this.send('touchEnd', [f]);
  }

  /** 모든 손가락을 뗀다 */
  async upAll(): Promise<void> {
    if (this.fingers.size === 0) return;
    this.fingers.clear();
    await this.send('touchEnd', []);
  }

  /** 모든 손가락을 취소한다 (pointercancel · touchcancel). CDP는 손가락 하나만 취소할 수 없다 */
  async cancel(): Promise<void> {
    if (this.fingers.size === 0) return;
    this.fingers.clear();
    await this.send('touchCancel', []);
  }

  /** 다른 손가락을 누른 채로 (x, y)를 짧게 탭한다 (holdMs 동안 누른다) */
  async tap(id: number, x: number, y: number, holdMs = 40): Promise<void> {
    await this.down(id, x, y);
    if (holdMs > 0) await sleep(holdMs);
    await this.up(id);
  }

  /**
   * 두 손가락 핀치: (cx, cy)를 가운데로 가로 방향 fromDist → toDist px 간격으로 벌리거나(확대) 모은다(축소).
   * 손가락 id는 ids로 (기본 101 · 102, 스틱 시험 손가락과 겹치지 않게). 끝나면 두 손가락을 뗀다
   */
  async pinch(
    cx: number,
    cy: number,
    fromDist: number,
    toDist: number,
    opts: MoveOptions & { ids?: [number, number] } = {},
  ): Promise<void> {
    const [a, b] = opts.ids ?? [101, 102];
    await this.down(a, cx - fromDist / 2, cy);
    await this.down(b, cx + fromDist / 2, cy);
    await this.moveMany(
      [
        { id: a, x: cx - toDist / 2, y: cy },
        { id: b, x: cx + toDist / 2, y: cy },
      ],
      { steps: opts.steps ?? 10, stepMs: opts.stepMs },
    );
    await this.up(a);
    await this.up(b);
  }

  /** 남은 손가락을 모두 떼고 CDP 세션을 닫는다 (브라우저 쪽 손가락 상태가 다음 시험에 남지 않게) */
  async detach(): Promise<void> {
    try {
      await this.upAll();
      await this.cdp.detach();
    } catch {
      // 페이지 · 컨텍스트가 이미 닫힘
    }
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', pts: CdpTouchPoint[]) {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  }
}

function point(id: number, x: number, y: number): CdpTouchPoint {
  return { id, x, y, radiusX: FINGER_RADIUS, radiusY: FINGER_RADIUS, force: 1 };
}

/**
 * CDP Input.synthesizePinchGesture (브라우저가 만드는 핀치). source 'mouse'(터치패드 핀치)만 실제로 확대되고 touch-action을
 * 무시한다 — meta viewport 잠금(user-scalable=no · maximum-scale=1) 확인용. 손가락 핀치는 MultiTouch.pinch
 */
export async function synthesizePinch(
  page: Page,
  opts: Point & { scale: number; source?: 'touch' | 'mouse'; speed?: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.synthesizePinchGesture', {
      x: opts.x,
      y: opts.y,
      scaleFactor: opts.scale,
      relativeSpeed: opts.speed ?? 800,
      gestureSourceType: opts.source ?? 'mouse',
    });
  } finally {
    await cdp.detach();
  }
}

/** 화면 확대 배율 (핀치 확인용). 1 = 확대 안 됨 */
export async function viewportScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

/** 안전 영역 흉내에 쓰는 세션: 닫으면 다음 페이지 불러오기부터 덮어쓰기가 사라져서 페이지가 닫힐 때까지 둔다 */
const safeAreaSessions = new WeakMap<Page, CDPSession>();

/**
 * 안전 영역(노치 · 펀치홀 · 제스처 막대) 흉내: env(safe-area-inset-*) 값을 CSS px로 정한다(빠진 쪽은 0). 다시 불러와도 남는다.
 * 실기기와 달리 meta viewport에 viewport-fit=cover가 없어도 값이 들어간다
 */
export async function emulateSafeArea(
  page: Page,
  insets: { top?: number; right?: number; bottom?: number; left?: number },
): Promise<void> {
  let cdp = safeAreaSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    safeAreaSessions.set(page, cdp);
  }
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 0, right: 0, bottom: 0, left: 0, ...insets },
  });
}

// ───────────── 터치 대상 (__DECOY__.getTouchTargets) ─────────────

/** 보이는 터치 대상 (CSS px, 창 기준). 디버그 훅이 없으면 빈 배열 */
export async function touchTargets(page: Page): Promise<TouchTarget[]> {
  return page.evaluate(() => window.__DECOY__?.getTouchTargets() ?? []);
}

/** 터치 대상 id가 보일 때까지 기다려 돌려준다 (100ms 간격 확인 — 느린 CI에서 rAF 폴링을 피한다) */
export async function waitForTouchTarget(page: Page, id: string, timeout = 15_000): Promise<TouchTarget> {
  const handle = await page.waitForFunction(
    (want) => window.__DECOY__?.getTouchTargets().find((t) => t.id === want) ?? null,
    id,
    { polling: 100, timeout },
  );
  const t = (await handle.jsonValue()) as TouchTarget;
  await handle.dispose();
  return t;
}

/** 대상의 가운데 */
export function centerOf(t: TouchTarget): Point {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
}

/**
 * 스틱 위의 점: 가운데에서 angle(라디안, 게임 좌표와 같이 y가 아래로 +) 방향으로 반지름(짧은 변의 반) × frac.
 * frac 1 = 가장자리(정규화 길이 1). 데드존은 0.15
 */
export function stickPoint(t: TouchTarget, angle: number, frac = 1): Point {
  const c = centerOf(t);
  const r = (Math.min(t.w, t.h) / 2) * frac;
  return { x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r };
}

// ───────────── 크기 · 배치 검사 (MOBILE_PLAN M11 4번) ─────────────

/** 터치 대상 규칙: 48 CSS px 이상, 서로 8px 이상, 좌우 안전 영역 + 32px · 아래 + 24px 띠 밖 */
export const TOUCH_LAYOUT = { minSize: 48, minGap: 8, sideBand: 32, bottomBand: 24 } as const;

export interface MeasuredTarget extends TouchTarget {
  /** 둥근 대상 (정사각형 + 모든 모서리 반지름 ≥ 변의 반). 적중 판정이 원이라 간격을 원으로 잰다 */
  round: boolean;
}

export interface TouchLayout {
  /** 창 크기 (CSS px) */
  viewport: { w: number; h: number };
  /** env(safe-area-inset-*) (CSS px) */
  insets: { top: number; right: number; bottom: number; left: number };
  targets: MeasuredTarget[];
}

/** 지금 보이는 터치 대상과 창 · 안전 영역을 잰다 (touchLayoutProblems에 넘긴다) */
export async function measureTouchLayout(page: Page): Promise<TouchLayout> {
  return page.evaluate(() => {
    const px = (v: string) => Number.parseFloat(v) || 0;
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const ps = getComputedStyle(probe);
    const insets = {
      top: px(ps.paddingTop),
      right: px(ps.paddingRight),
      bottom: px(ps.paddingBottom),
      left: px(ps.paddingLeft),
    };
    probe.remove();
    const els = [...document.querySelectorAll<HTMLElement>('#ui-root [data-touch-target]')];
    const targets = (window.__DECOY__?.getTouchTargets() ?? []).map((t) => {
      // 훅이 준 사각형과 같은 요소에서 모서리 반지름을 읽는다 (%는 변 길이 기준)
      const el = els.find((e) => {
        const r = e.getBoundingClientRect();
        return e.dataset.touchTarget === t.id && Math.abs(r.left - t.x) < 0.5 && Math.abs(r.top - t.y) < 0.5;
      });
      let round = false;
      if (el && Math.abs(t.w - t.h) < 1) {
        const cs = getComputedStyle(el);
        const radii = [
          cs.borderTopLeftRadius,
          cs.borderTopRightRadius,
          cs.borderBottomRightRadius,
          cs.borderBottomLeftRadius,
        ];
        round = radii.every((v) => {
          const first = v.split(' ')[0] ?? '0';
          const r = first.endsWith('%') ? (px(first) / 100) * t.w : px(first);
          return r >= t.w / 2 - 0.5;
        });
      }
      return { ...t, round };
    });
    return { viewport: { w: window.innerWidth, h: window.innerHeight }, insets, targets };
  });
}

/** 두 대상 사이 간격 (CSS px, 겹치면 음수). 둥근 대상은 원으로 */
export function targetGap(a: MeasuredTarget, b: MeasuredTarget): number {
  const ca = centerOf(a);
  const cb = centerOf(b);
  if (a.round && b.round) return Math.hypot(ca.x - cb.x, ca.y - cb.y) - a.w / 2 - b.w / 2;
  if (a.round || b.round) {
    const [c, r, box] = a.round ? [ca, a.w / 2, b] : [cb, b.w / 2, a];
    const nx = Math.min(Math.max(c.x, box.x), box.x + box.w);
    const ny = Math.min(Math.max(c.y, box.y), box.y + box.h);
    const inside = nx === c.x && ny === c.y;
    return inside ? -r : Math.hypot(c.x - nx, c.y - ny) - r;
  }
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gx < 0 && gy < 0) return Math.max(gx, gy);
  return Math.hypot(Math.max(gx, 0), Math.max(gy, 0));
}

/**
 * 크기 · 간격 · 화면 안 · 가장자리 띠 규칙을 어긴 것 (빈 배열이면 통과). 부동소수 오차 0.05px는 봐준다.
 * 띠: 왼쪽 x ≥ 안전 영역 + 32, 오른쪽 끝 ≤ 폭 − 안전 영역 − 32, 아래 끝 ≤ 높이 − 안전 영역 − 24, 위 y ≥ 안전 영역
 */
export function touchLayoutProblems(layout: TouchLayout, rules = TOUCH_LAYOUT): string[] {
  const EPS = 0.05;
  const out: string[] = [];
  const { w: W, h: H } = layout.viewport;
  const ins = layout.insets;
  const f = (v: number) => v.toFixed(1);
  for (const t of layout.targets) {
    if (t.w < rules.minSize - EPS || t.h < rules.minSize - EPS)
      out.push(`${t.id}: 크기 ${f(t.w)}×${f(t.h)} < ${rules.minSize}`);
    if (t.x < -EPS || t.y < -EPS || t.x + t.w > W + EPS || t.y + t.h > H + EPS)
      out.push(`${t.id}: 화면 밖 (${f(t.x)}, ${f(t.y)}, ${f(t.w)}×${f(t.h)} / ${W}×${H})`);
    if (t.x < ins.left + rules.sideBand - EPS)
      out.push(`${t.id}: 왼쪽 띠 안 (x ${f(t.x)} < ${ins.left + rules.sideBand})`);
    if (t.x + t.w > W - ins.right - rules.sideBand + EPS)
      out.push(`${t.id}: 오른쪽 띠 안 (끝 ${f(t.x + t.w)} > ${W - ins.right - rules.sideBand})`);
    if (t.y + t.h > H - ins.bottom - rules.bottomBand + EPS)
      out.push(`${t.id}: 아래 띠 안 (끝 ${f(t.y + t.h)} > ${H - ins.bottom - rules.bottomBand})`);
    if (t.y < ins.top - EPS) out.push(`${t.id}: 위 안전 영역 안 (y ${f(t.y)} < ${ins.top})`);
  }
  const ts = layout.targets;
  for (let i = 0; i < ts.length; i += 1)
    for (let j = i + 1; j < ts.length; j += 1) {
      const a = ts[i]!;
      const b = ts[j]!;
      const gap = targetGap(a, b);
      if (gap < rules.minGap - EPS) out.push(`${a.id}↔${b.id}: 간격 ${f(gap)} < ${rules.minGap}`);
    }
  return out;
}
