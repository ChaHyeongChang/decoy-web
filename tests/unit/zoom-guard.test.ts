// 화면 확대 막기 · 감지 · 복구 (플레이테스트 a-1): zoomGuard.ts의 판단 함수(배율 판정 · 멀티터치 · 두 번 탭 창 · 버튼 예외 ·
// 안내 자리)와 리스너 배선(가짜 문서 · visualViewport · 타이머), 그리고 CSS 쪽 방어(뿌리 touch-action · 스크롤 컨테이너 pan-y ·
// 입력 칸 16px · 안내 층)
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  TAP_KEEP,
  ZOOM_EPS,
  ZOOM_RELEASE_MS,
  blocksTap,
  blocksTouches,
  installZoomGuard,
  isDoubleTap,
  isZoomed,
  noticeBox,
  type ViewBox,
  type ZoomListens,
} from '../../client/src/zoomGuard';

describe('배율 판정 isZoomed', () => {
  it('1과 허용 오차 안(오므린 뒤 남는 값)은 확대가 아니다', () => {
    expect(ZOOM_EPS).toBe(0.02);
    for (const s of [1, 1.0000001, 1.01, 1.02]) expect(isZoomed(s), String(s)).toBe(false);
  });

  it('허용 오차를 넘으면 확대다', () => {
    for (const s of [1.021, 1.03, 1.12, 2, 3.978, 5]) expect(isZoomed(s), String(s)).toBe(true);
  });

  it('1보다 작은 배율은 확대가 아니다 (넓은 배치 뷰포트를 줄여 보이는 쉬는 배율 — 안내를 띄우면 닫을 길이 없다)', () => {
    for (const s of [0.99, 0.9, 0.861, 0.5]) expect(isZoomed(s), String(s)).toBe(false);
  });
});

describe('멀티터치 막기 blocksTouches', () => {
  it('손가락 2개 이상이면 막고, 1개(스틱 · 스크롤)는 막지 않는다', () => {
    expect(blocksTouches(2, false)).toBe(true);
    expect(blocksTouches(3, false)).toBe(true);
    expect(blocksTouches(1, false)).toBe(false);
    expect(blocksTouches(0, false)).toBe(false);
  });

  it('확대된 동안에는 막지 않는다 (오므려 되돌려야 한다)', () => {
    expect(blocksTouches(2, true)).toBe(false);
    expect(blocksTouches(3, true)).toBe(false);
  });
});

describe('두 번 탭 isDoubleTap · blocksTap', () => {
  const first = { t: 1000, x: 200, y: 120 };

  it('앞 탭 뒤 300ms 안 · 30px 안이면 두 번째 탭이다', () => {
    expect([DOUBLE_TAP_MS, DOUBLE_TAP_PX]).toEqual([300, 30]);
    expect(isDoubleTap(first, { t: 1250, x: 210, y: 120 })).toBe(true);
    expect(isDoubleTap(first, { t: 1299, x: 200, y: 149 })).toBe(true);
  });

  it('간격이 300ms 이상이거나 30px 이상 떨어졌거나 앞 탭이 없으면 아니다', () => {
    expect(isDoubleTap(first, { t: 1300, x: 200, y: 120 })).toBe(false);
    expect(isDoubleTap(first, { t: 1350, x: 210, y: 120 })).toBe(false);
    expect(isDoubleTap(first, { t: 1250, x: 280, y: 120 })).toBe(false);
    expect(isDoubleTap(first, { t: 1250, x: 200, y: 150 })).toBe(false);
    expect(isDoubleTap(null, { t: 1250, x: 200, y: 120 })).toBe(false);
  });

  it('막는 것은 누르는 것 밖의 두 번째 탭뿐이다 (버튼류는 click이 살아야 한다 · 확대된 동안에는 막지 않는다)', () => {
    const second = { t: 1200, x: 204, y: 122 };
    expect(blocksTap(first, second, false, false)).toBe(true);
    expect(blocksTap(first, second, true, false)).toBe(false);
    expect(blocksTap(first, second, false, true)).toBe(false);
    expect(blocksTap(null, second, false, false)).toBe(false);
    expect(blocksTap(first, { t: 1400, x: 204, y: 122 }, false, false)).toBe(false);
  });

  it('누르는 것 = 버튼 · 링크 · 입력 · 고르기 · 글상자 · 라벨', () => {
    expect(TAP_KEEP.split(', ')).toEqual(['button', 'a', 'input', 'select', 'textarea', 'label']);
  });
});

describe('안내 자리 noticeBox (보이는 화면에 꼭 맞게)', () => {
  it('배율 2 · 보이는 화면 422×170 @ (153, 0) → 상자 844×340을 반으로 줄여 그 자리로', () => {
    expect(noticeBox({ scale: 2, width: 422, height: 170, offsetLeft: 153, offsetTop: 0 })).toEqual({
      width: 844,
      height: 340,
      transform: 'translate(153px,0px) scale(0.5)',
    });
  });

  it('화면에 보이는 크기(상자 × 1/배율 × 배율)는 배율과 상관없이 확대 전 화면 크기다', () => {
    for (const scale of [1.12, 2, 3.978, 5]) {
      const v: ViewBox = { scale, width: 844 / scale, height: 340 / scale, offsetLeft: 31.5, offsetTop: 12 };
      const b = noticeBox(v);
      expect(b.width).toBeCloseTo(844, 6);
      expect(b.height).toBeCloseTo(340, 6);
      // 줄인 뒤 배치 px 크기 = 보이는 화면 크기, 자리 = 보이는 화면 왼쪽 위
      const k = Number(/scale\(([^)]+)\)/.exec(b.transform)?.[1]);
      expect(b.width * k).toBeCloseTo(v.width, 6);
      expect(b.height * k).toBeCloseTo(v.height, 6);
      expect(b.transform.startsWith('translate(31.5px,12px) ')).toBe(true);
    }
  });
});

// ───────────── 배선 ─────────────

interface Added {
  type: string;
  fn: (e: Event) => void;
  opts?: AddEventListenerOptions;
}

/** 리스너를 적어 두고 직접 부른다 */
class Recorder implements ZoomListens {
  readonly added: Added[] = [];
  addEventListener(type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    this.added.push({ type, fn, opts });
  }
  fire(type: string, e: object = {}): void {
    for (const l of this.added) if (l.type === type) l.fn(e as Event);
  }
}

class FakeView extends Recorder implements ViewBox {
  scale = 1;
  width = 844;
  height = 340;
  offsetLeft = 0;
  offsetTop = 0;
  /** 배율을 바꾸고 resize를 낸다 (브라우저처럼 보이는 크기도 같이) */
  zoom(scale: number): void {
    this.scale = scale;
    this.width = 844 / scale;
    this.height = 340 / scale;
    this.fire('resize');
  }
}

/** 가짜 타이머 */
class Timers {
  now = 0;
  private list: { at: number; fn: () => void; off: boolean }[] = [];
  later = (fn: () => void, ms: number): (() => void) => {
    const item = { at: this.now + ms, fn, off: false };
    this.list.push(item);
    return () => {
      item.off = true;
    };
  };
  advance(ms: number): void {
    this.now += ms;
    const due = this.list.filter((i) => !i.off && i.at <= this.now);
    this.list = this.list.filter((i) => !i.off && i.at > this.now);
    for (const i of due) i.fn();
  }
  get waiting(): number {
    return this.list.filter((i) => !i.off).length;
  }
}

interface FakeTouchEvent {
  cancelable: boolean;
  timeStamp: number;
  target: unknown;
  touches: { length: number };
  changedTouches: { clientX: number; clientY: number }[];
  preventDefault: ReturnType<typeof vi.fn>;
}

/** 보통 요소 · 버튼 · 버튼 안 글자 노드(closest가 없다 — 부모 요소에서 찾는다) */
const plain = { closest: (_sel: string): unknown => null };
const button = { closest: (sel: string): unknown => (sel === TAP_KEEP ? {} : null) };
const textInButton = { parentElement: button };
const textInPlain = { parentElement: plain };

function touchEvent(over: Partial<FakeTouchEvent> & { count?: number } = {}): FakeTouchEvent {
  return {
    cancelable: true,
    timeStamp: 0,
    target: plain,
    touches: { length: over.count ?? 1 },
    changedTouches: [{ clientX: 100, clientY: 100 }],
    preventDefault: vi.fn(),
    ...over,
  };
}

function setup(opts: { scale?: number; doc?: boolean; view?: boolean } = {}) {
  const doc = new Recorder();
  const view = new FakeView();
  if (opts.scale !== undefined) {
    view.scale = opts.scale;
    view.width = 844 / opts.scale;
    view.height = 340 / opts.scale;
  }
  const timers = new Timers();
  const changes: boolean[] = [];
  const views: ViewBox[] = [];
  const guard = installZoomGuard({
    doc: opts.doc === false ? null : doc,
    view: opts.view === false ? null : view,
    onChange: (z) => changes.push(z),
    onView: (v) =>
      views.push({
        scale: v.scale,
        width: v.width,
        height: v.height,
        offsetLeft: v.offsetLeft,
        offsetTop: v.offsetTop,
      }),
    later: timers.later,
  });
  /** 한 손가락 탭의 touchend (t ms, 자리, 대상) */
  const tapEnd = (t: number, x: number, y: number, target: unknown = plain): FakeTouchEvent => {
    const e = touchEvent({
      timeStamp: t,
      target,
      touches: { length: 0 },
      changedTouches: [{ clientX: x, clientY: y }],
    });
    doc.fire('touchend', e);
    return e;
  };
  return { doc, view, timers, changes, views, guard, tapEnd };
}

describe('installZoomGuard: 막기 리스너 (②)', () => {
  it('touchstart · touchmove · touchend · gesture*를 문서에 캡처 단계 · passive: false로 단다 (문서 터치 리스너는 기본이 passive라 적어야 막힌다)', () => {
    const { doc } = setup();
    const types = doc.added.map((l) => l.type).sort();
    expect(types).toEqual(
      ['gesturechange', 'gestureend', 'gesturestart', 'touchend', 'touchmove', 'touchstart'].sort(),
    );
    for (const l of doc.added) expect(l.opts, l.type).toEqual({ capture: true, passive: false });
  });

  it('손가락 2개 이상의 touchstart · touchmove를 막고, 1개는 그대로 둔다', () => {
    const { doc } = setup();
    for (const type of ['touchstart', 'touchmove']) {
      const two = touchEvent({ count: 2 });
      doc.fire(type, two);
      expect(two.preventDefault, `${type} 2`).toHaveBeenCalledTimes(1);
      const three = touchEvent({ count: 3 });
      doc.fire(type, three);
      expect(three.preventDefault, `${type} 3`).toHaveBeenCalledTimes(1);
      const one = touchEvent({ count: 1 });
      doc.fire(type, one);
      expect(one.preventDefault, `${type} 1`).not.toHaveBeenCalled();
    }
  });

  it('막을 수 없는 이벤트(스크롤 중 — cancelable false)는 건드리지 않는다 (브라우저 경고 없음)', () => {
    const { doc, tapEnd } = setup();
    const move = touchEvent({ count: 2, cancelable: false });
    doc.fire('touchmove', move);
    expect(move.preventDefault).not.toHaveBeenCalled();
    const gesture = { cancelable: false, preventDefault: vi.fn() };
    doc.fire('gesturestart', gesture);
    expect(gesture.preventDefault).not.toHaveBeenCalled();
    tapEnd(1000, 100, 100);
    const end = touchEvent({ timeStamp: 1100, touches: { length: 0 }, cancelable: false });
    doc.fire('touchend', end);
    expect(end.preventDefault).not.toHaveBeenCalled();
  });

  it('사파리 핀치 이벤트(gesturestart · gesturechange · gestureend)를 막는다', () => {
    const { doc } = setup();
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const e = { cancelable: true, preventDefault: vi.fn() };
      doc.fire(type, e);
      expect(e.preventDefault, type).toHaveBeenCalledTimes(1);
    }
  });

  it('보통 요소 위 빠른 두 번째 탭의 touchend만 막는다 (첫 탭 · 늦은 탭 · 먼 탭은 그대로)', () => {
    const { tapEnd } = setup();
    expect(tapEnd(1000, 100, 100).preventDefault).not.toHaveBeenCalled();
    expect(tapEnd(1200, 105, 102).preventDefault).toHaveBeenCalledTimes(1);
    // 세 번째도 앞 탭(1200)에서 300ms 안이면 막는다
    expect(tapEnd(1400, 105, 102).preventDefault).toHaveBeenCalledTimes(1);
    expect(tapEnd(1800, 105, 102).preventDefault).not.toHaveBeenCalled();
    expect(tapEnd(1900, 300, 102).preventDefault).not.toHaveBeenCalled();
  });

  it('버튼류 위의 두 번째 탭은 막지 않는다 — 빠르게 두 번 누르는 click이 산다. 글자 노드가 대상이면 부모 요소로 가린다', () => {
    const { tapEnd } = setup();
    tapEnd(1000, 100, 100, button);
    expect(tapEnd(1150, 100, 100, button).preventDefault).not.toHaveBeenCalled();
    expect(tapEnd(1300, 100, 100, textInButton).preventDefault).not.toHaveBeenCalled();
    // 버튼을 누른 직후 그 옆 보통 요소를 누르면 막는다 (앞 탭은 대상과 상관없이 센다)
    expect(tapEnd(1450, 110, 100, textInPlain).preventDefault).toHaveBeenCalledTimes(1);
    expect(tapEnd(1600, 110, 100, null).preventDefault).toHaveBeenCalledTimes(1);
  });

  it('다른 손가락이 아직 닿아 있는 touchend는 탭으로 세지 않는다 (두 스틱 조작)', () => {
    const { doc, tapEnd } = setup();
    tapEnd(1000, 100, 100);
    const partial = touchEvent({ timeStamp: 1100, touches: { length: 1 } });
    doc.fire('touchend', partial);
    expect(partial.preventDefault).not.toHaveBeenCalled();
    // 그 사이 touchend가 앞 탭을 덮어쓰지 않았다: 1000 → 1250은 여전히 두 번째 탭
    expect(tapEnd(1250, 100, 100).preventDefault).toHaveBeenCalledTimes(1);
  });

  it('doc가 null이면(?zoomguard=0) 막는 리스너를 달지 않고 감지는 그대로 한다', () => {
    const s = setup({ doc: false });
    expect(s.doc.added).toEqual([]);
    s.view.zoom(2);
    expect(s.changes).toEqual([true]);
  });

  it('visualViewport가 없으면 막기만 한다 (감지 없음, 오류 없음)', () => {
    const s = setup({ view: false });
    expect(s.doc.added.length).toBe(6);
    expect(s.view.added).toEqual([]);
    expect(s.changes).toEqual([]);
    expect(s.guard.zoomed).toBe(false);
  });
});

describe('installZoomGuard: 확대 감지 · 복구 (③)', () => {
  it('visualViewport의 resize · scroll을 듣는다', () => {
    const { view } = setup();
    expect(view.added.map((l) => l.type).sort()).toEqual(['resize', 'scroll']);
  });

  it('배율이 1이면 아무 일도 없다 (쉬는 배율이 1보다 작아도)', () => {
    const a = setup();
    a.view.fire('resize');
    a.view.fire('scroll');
    expect([a.changes, a.views, a.guard.zoomed]).toEqual([[], [], false]);
    const wide = setup({ scale: 0.861 });
    wide.view.fire('resize');
    expect([wide.changes, wide.guard.zoomed]).toEqual([[], false]);
  });

  it('확대되면 한 번 알리고 보이는 화면을 넘긴다. 더 확대 · 끌어 옮기면 자리만 다시 넘긴다', () => {
    const { view, changes, views, guard } = setup();
    view.zoom(2);
    expect(changes).toEqual([true]);
    expect(guard.zoomed).toBe(true);
    expect(views).toEqual([{ scale: 2, width: 422, height: 170, offsetLeft: 0, offsetTop: 0 }]);
    view.zoom(3);
    view.offsetLeft = 120;
    view.offsetTop = 40;
    view.fire('scroll');
    expect(changes).toEqual([true]);
    expect(views.length).toBe(3);
    expect(views[2]).toMatchObject({ scale: 3, offsetLeft: 120, offsetTop: 40 });
  });

  it('불러올 때 이미 확대돼 있으면 설치하자마자 알린다', () => {
    const { changes, views } = setup({ scale: 2.5 });
    expect(changes).toEqual([true]);
    expect(views.length).toBe(1);
  });

  it('확대된 동안에는 막지 않는다: 두 손가락 touchmove · gesture · 두 번째 탭이 그대로 간다 (오므릴 수 있다)', () => {
    const { doc, view, tapEnd } = setup();
    view.zoom(2);
    const move = touchEvent({ count: 2 });
    doc.fire('touchmove', move);
    doc.fire('touchstart', move);
    expect(move.preventDefault).not.toHaveBeenCalled();
    const g = { cancelable: true, preventDefault: vi.fn() };
    doc.fire('gesturechange', g);
    expect(g.preventDefault).not.toHaveBeenCalled();
    tapEnd(1000, 100, 100);
    expect(tapEnd(1100, 100, 100).preventDefault).not.toHaveBeenCalled();
  });

  it(`배율이 돌아와도 바로 풀지 않고 ${ZOOM_RELEASE_MS}ms 그대로일 때 푼다. 풀리면 다시 막는다`, () => {
    const { doc, view, timers, changes, guard } = setup();
    expect(ZOOM_RELEASE_MS).toBe(150);
    view.zoom(2);
    view.zoom(1);
    expect(changes).toEqual([true]);
    expect(guard.zoomed).toBe(true);
    timers.advance(ZOOM_RELEASE_MS - 1);
    expect(changes).toEqual([true]);
    timers.advance(1);
    expect(changes).toEqual([true, false]);
    expect(guard.zoomed).toBe(false);
    const move = touchEvent({ count: 2 });
    doc.fire('touchmove', move);
    expect(move.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('오므리는 도중 1 근처를 오가도 깜박이지 않는다 (다시 확대되면 기다리던 풀기를 버린다)', () => {
    const { view, timers, changes, views } = setup();
    view.zoom(1.4);
    view.zoom(1.01);
    timers.advance(100);
    view.zoom(1.2);
    expect(timers.waiting).toBe(0);
    timers.advance(1000);
    expect(changes).toEqual([true]);
    // 1 근처에 머무는 동안 이벤트가 여러 번 와도 타이머는 하나
    view.zoom(1.015);
    view.zoom(1);
    view.fire('scroll');
    expect(timers.waiting).toBe(1);
    timers.advance(ZOOM_RELEASE_MS);
    expect(changes).toEqual([true, false]);
    // 풀기를 기다리는 동안에도 안내 자리는 따라갔다
    expect(views.at(-1)).toMatchObject({ scale: 1 });
    // 풀린 뒤에는 자리를 넘기지 않는다
    const n = views.length;
    view.fire('scroll');
    expect(views.length).toBe(n);
  });

  it('다시 확대되면 다시 알린다', () => {
    const { view, timers, changes } = setup();
    view.zoom(2);
    view.zoom(1);
    timers.advance(ZOOM_RELEASE_MS);
    view.zoom(1.5);
    expect(changes).toEqual([true, false, true]);
  });
});

// ───────────── CSS 쪽 방어 (①) ─────────────

const styleCss = readFileSync('client/src/style.css', 'utf8');
const uiCss = readdirSync('client/src/ui')
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ file: `client/src/ui/${f}`, css: readFileSync(`client/src/ui/${f}`, 'utf8') }));
const allCss = [{ file: 'client/src/style.css', css: styleCss }, ...uiCss];

/** 가장 안쪽 규칙 블록들 (선택자 · 선언). 주석은 뺀다 */
function blocks(css: string): { sel: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    body: m[2] ?? '',
  }));
}

describe('CSS: 터치 모드는 문서 뿌리부터 확대를 막는다', () => {
  it('html.touch · body는 touch-action: none, 확대된 동안(html.zoomed)에는 풀린다', () => {
    const root = blocks(styleCss).find(
      (b) => b.sel === 'html.touch:not(.zoomed), html.touch:not(.zoomed) body',
    );
    expect(root?.body).toMatch(/touch-action:\s*none;/);
    // PC(html.touch 없음)의 html · body에는 걸지 않는다: 브라우저 확대를 그대로 둔다
    const base = /html,\s*body \{([^}]*)\}/.exec(styleCss)?.[1] ?? '';
    expect(base).not.toContain('touch-action');
  });

  it('스크롤 컨테이너(overflow auto · scroll)는 모두 자기 블록에 touch-action을 적는다 (뿌리가 none이라 빠뜨리면 구멍 · 스크롤 불가)', () => {
    const scrollers = allCss.flatMap(({ file, css }) =>
      blocks(css)
        .filter((b) => /overflow(-[xy])?:\s*(auto|scroll)/.test(b.body))
        .map((b) => ({ file, sel: b.sel, touch: /touch-action:\s*([^;]+);/.exec(b.body)?.[1] ?? '' })),
    );
    // 검사가 헛돌지 않는다: 알려진 컨테이너가 다 잡힌다
    const sels = scrollers.map((s) => s.sel);
    for (const want of [
      '.lobby',
      '.result',
      '.table-wrap',
      '.hub-card',
      '.set-body',
      '.set-tabs',
      '.life-modal',
      '.life-tutorial',
      '.acct-choose',
      '.le-bar',
    ])
      expect(sels, want).toContain(want);
    const missing = scrollers.filter((s) => !/^pan-[xy]( pan-[xy])?$/.test(s.touch));
    expect(missing).toEqual([]);
  });

  it('누르는 것은 manipulation(두 번 탭 확대 없음), 게임 영역 · 터치 화면 하위는 none', () => {
    const b = blocks(styleCss);
    expect(b.find((x) => x.sel === 'button, a, label, select, input, textarea')?.body).toMatch(
      /touch-action:\s*manipulation;/,
    );
    expect(b.find((x) => x.sel === '#game-root *, .touch-layer *')?.body).toMatch(/touch-action:\s*none;/);
  });

  it('터치 모드의 입력 칸은 16px 이상이다 (아이폰은 16px 미만 입력 칸에 포커스하면 확대한다)', () => {
    const size = (sel: string): number =>
      Number(/font-size:\s*(\d+)px/.exec(blocks(styleCss).find((x) => x.sel === sel)?.body ?? '')?.[1]);
    expect(size('.field input, .field select')).toBeGreaterThanOrEqual(16);
    expect(size('html.touch .invite-link input')).toBeGreaterThanOrEqual(16);
  });

  it('확대 안내 층: 세로 안내(80) 위 85, 끌기 · 오므리기를 브라우저에 맡긴다(manipulation), 왼쪽 위 기준으로 줄인다', () => {
    const life = uiCss.find((c) => c.file.endsWith('lifecycle.css'))?.css ?? '';
    const notice = blocks(life).find((b) => b.sel === '.zoom-notice')?.body ?? '';
    expect(Number(/z-index:\s*(\d+)/.exec(notice)?.[1])).toBe(85);
    expect(notice).toMatch(/position:\s*fixed;/);
    expect(notice).toMatch(/top:\s*0;/);
    expect(notice).toMatch(/left:\s*0;/);
    expect(notice).toMatch(/transform-origin:\s*0 0;/);
    expect(notice).toMatch(/touch-action:\s*manipulation;/);
    expect(Number(/\.rotate-notice \{[^}]*z-index:\s*(\d+)/.exec(styleCss)?.[1])).toBe(80);
  });
});
