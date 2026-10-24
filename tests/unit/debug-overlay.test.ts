// ?debug=1 오버레이 (렌더링 최적화): 펼친 표 글자(모든 항목 · WebGL/Canvas 그리기 이름) · 접은 칩 한 줄 ·
// 상자(칩만 입력을 받고 판 입력 · 문서 캡처 리스너로 보내지 않음 — 창 캡처 문지기 · 접기/펼치기 · 자리 · 4Hz · 바뀐 것만 씀)
import { describe, expect, it } from 'vitest';
import type { FrameStatsInfo } from '@decoy/shared';
import {
  DEBUG_OVERLAY_UPDATE_MS,
  GUARDED_EVENTS,
  formatDebugChip,
  formatDebugPanel,
  installDebugOverlay,
  type DebugOverlayData,
  type GuardTarget,
  type OverlayAnchor,
  type OverlayHost,
} from '../../client/src/ui/debugOverlay';

const STATS: FrameStatsInfo = {
  frames: 240,
  fps: 119.84,
  intervalAvg: 8.333,
  intervalP95: 8.9,
  workAvg: 4.1,
  workP95: 6.024,
  drawCalls: 12,
  skipped: 0,
};

const DATA: DebugOverlayData = {
  stats: STATS,
  late: 0.03,
  targetHz: 120,
  displayHz: 120,
  frameLimit: 'auto',
  ping: 42.4,
  lag: 0,
  tick: 1234,
  snapCount: 567,
  correction: 0.0123,
  pending: 3,
  inputMode: 'touch',
  renderer: 'webgl',
  quality: 'high',
  qualitySource: 'auto',
  adapt: 'on',
  dpr: 2.625,
  zoom: 1.25,
  backingW: 2402,
  backingH: 1081,
  balanceHash: '77d34f9f',
};

describe('formatDebugPanel (펼친 표)', () => {
  it('8줄: FPS · 목표 · 화면 · 제한 / 프레임 / 작업 / 그리기 · 렌더러 / 핑 · 서버 틱 / 예측 / 품질 / DPR · 밸런스', () => {
    expect(formatDebugPanel(DATA)).toBe(
      [
        'FPS 119.8 · 목표 120 · 화면 120Hz · 제한 자동',
        '프레임 8.33ms · p95 8.90ms · 늦음 3%',
        '작업 4.10ms · p95 6.02ms',
        '그리기 12회 · 건너뜀 0 · 렌더러 webgl',
        '핑 42ms · 지연설정 0ms · 서버 틱 1234 · 스냅샷 567',
        '예측 오차 0.012타일 · 대기 3 · 입력 touch',
        '품질 높음(자동) · 조정 on · 배율 1.25',
        'DPR 2.63 · 2402×1081 · 밸런스 77d34f9f',
      ].join('\n'),
    );
  });

  it('요청한 항목이 모두 있다 (예전 오버레이의 렌더러 · 지연설정 · 입력 · 밸런스 · 배율 포함)', () => {
    const text = formatDebugPanel(DATA);
    for (const label of [
      'FPS',
      '목표',
      '화면',
      '제한',
      '프레임',
      '작업',
      'p95',
      '그리기',
      '핑',
      '서버 틱',
      '스냅샷',
      '예측 오차',
      '대기',
      '품질',
      '조정',
      'DPR',
      '렌더러',
      '지연설정',
      '입력',
      '밸런스',
      '배율',
    ])
      expect(text, label).toContain(label);
    expect(text.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('Canvas 렌더러는 그린 객체 수(이름이 다르다), 렌더러가 없으면 -', () => {
    const canvas = formatDebugPanel({ ...DATA, renderer: 'canvas', stats: { ...STATS, drawCalls: 230 } });
    expect(canvas.split('\n')[3]).toBe('그리기 객체 230개 · 건너뜀 0 · 렌더러 canvas');
    expect(canvas).not.toContain('230회');
    expect(formatDebugPanel({ ...DATA, renderer: 'none' }).split('\n')[3]).toBe(
      '그리기 - · 건너뜀 0 · 렌더러 none',
    );
    // 오버레이를 켜지 않아 세지 않은 경우(drawCalls null)
    expect(formatDebugPanel({ ...DATA, stats: { ...STATS, drawCalls: null } }).split('\n')[3]).toBe(
      '그리기 - · 건너뜀 0 · 렌더러 webgl',
    );
  });

  it('다른 품질 · 출처 · 제한 · 조정, 목표 · 화면은 정수', () => {
    const lines = formatDebugPanel({
      ...DATA,
      quality: 'medium',
      qualitySource: 'saved',
      adapt: 'checking',
      frameLimit: '60',
      targetHz: 59.7,
      displayHz: 143.9,
      dpr: 1,
      zoom: 0.5,
    }).split('\n');
    expect(lines[0]).toBe('FPS 119.8 · 목표 60 · 화면 144Hz · 제한 60');
    expect(lines[6]).toBe('품질 중간(저장) · 조정 checking · 배율 0.50');
    expect(lines[7]).toBe('DPR 1.00 · 2402×1081 · 밸런스 77d34f9f');
    expect(formatDebugPanel({ ...DATA, quality: 'low', qualitySource: 'url', frameLimit: '120' })).toMatch(
      /제한 120\n[\s\S]*품질 낮음\(주소\)/,
    );
    // 잔렉 고치기: 목표는 화면 주사율의 약수라 반 정수가 될 수 있다(165Hz의 절반 82.5), 절반 제한
    expect(
      formatDebugPanel({ ...DATA, frameLimit: 'half', targetHz: 82.5, displayHz: 165 }).split('\n')[0],
    ).toBe('FPS 119.8 · 목표 82.5 · 화면 165Hz · 제한 절반');
    expect(formatDebugPanel({ ...DATA, targetHz: 72, displayHz: 144 }).split('\n')[0]).toMatch(
      /목표 72 · 화면 144Hz/,
    );
  });

  it('아직 렌더한 프레임이 없거나 스냅샷이 없으면 -', () => {
    const lines = formatDebugPanel({ ...DATA, stats: null, tick: null }).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      'FPS - · 목표 120 · 화면 120Hz · 제한 자동',
      '프레임 - · p95 - · 늦음 -',
      '작업 - · p95 -',
      '그리기 - · 건너뜀 - · 렌더러 webgl',
      '핑 42ms · 지연설정 0ms · 서버 틱 - · 스냅샷 567',
    ]);
  });
});

describe('formatDebugChip (접은 칩)', () => {
  it('한 줄: 접힘 ▸ · 펼침 ▾ + FPS 정수 + 프레임 간격 평균', () => {
    expect(formatDebugChip(STATS, false)).toBe('▸ 120fps 8.3ms');
    expect(formatDebugChip({ ...STATS, fps: 59.4, intervalAvg: 16.84 }, true)).toBe('▾ 59fps 16.8ms');
    expect(formatDebugChip(null, false)).toBe('▸ -fps -ms');
    expect(formatDebugChip(STATS, false)).not.toContain('\n');
  });
});

// ───────────── 상자 (가짜 DOM) ─────────────

interface FakeEvent {
  type: string;
  target: unknown;
  button: number;
  cancelable: boolean;
  prevented: boolean;
  /** stopPropagation 또는 stopImmediatePropagation (다음 노드로 가지 않는다) */
  stopped: boolean;
  /** stopImmediatePropagation (같은 노드의 나중 리스너도 받지 않는다) */
  immediate: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

function event(type: string, target: unknown, button = 0, cancelable = true): FakeEvent {
  return {
    type,
    target,
    button,
    cancelable,
    prevented: false,
    stopped: false,
    immediate: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
      this.immediate = true;
    },
  };
}

type Listener = { fn: (e: FakeEvent) => void; opts: unknown };

/** 리스너 목록 (같은 노드: stopImmediatePropagation이면 나머지를 건너뛴다) */
class FakeNode {
  readonly nodeType: number = 1;
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: (e: FakeEvent) => void, opts?: unknown): void {
    const l = this.listeners.get(type) ?? [];
    l.push({ fn, opts });
    this.listeners.set(type, l);
  }
  removeEventListener(type: string, fn: (e: FakeEvent) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn),
    );
  }
  fire(e: FakeEvent): void {
    for (const l of [...(this.listeners.get(e.type) ?? [])]) {
      l.fn(e);
      if (e.immediate) return;
    }
  }
}

/** 가짜 DOM 요소: textContent 쓰기 횟수 · 자식 · contains */
class FakeEl extends FakeNode {
  id = '';
  className = '';
  hidden = false;
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  writes = 0;
  removed = false;
  private text = '';
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  appendChild(c: FakeEl): void {
    this.children.push(c);
  }
  contains(n: unknown): boolean {
    return n === this || this.children.some((c) => c.contains(n));
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.writes++;
    this.text = v;
  }
  remove(): void {
    this.removed = true;
  }
}

/**
 * 가짜 창 · 문서: 창 캡처 → 문서 캡처 → 대상 순으로 보낸다(전파를 멈추면 다음 노드로 가지 않는다).
 * 실제 앱처럼 문지기(설치 때) 뒤에 창 캡처 리스너(input.ts)와 문서 캡처 리스너(점수판 · 설정 메뉴 닫기)를 단다
 */
class FakeWorld {
  readonly win = new FakeNode();
  readonly doc = new FakeNode();
  /** 칩 뒤에 단 리스너가 받은 이벤트 */
  laterWin: string[] = [];
  docCapture: string[] = [];
  addAppListeners(): void {
    for (const type of [
      'pointerdown',
      'touchstart',
      'mousedown',
      'click',
      'contextmenu',
      'pointerup',
      'touchend',
    ]) {
      this.win.addEventListener(type, (e) => this.laterWin.push(e.type), { capture: true });
      this.doc.addEventListener(type, (e) => this.docCapture.push(e.type), { capture: true });
    }
  }
  dispatch(e: FakeEvent): FakeEvent {
    this.win.fire(e);
    if (!e.stopped) this.doc.fire(e);
    // 대상 단계 (창 · 문서 자신이 대상이면 위에서 이미 받았다)
    if (!e.stopped && e.target instanceof FakeEl) e.target.fire(e);
    return e;
  }
}

function setup(
  expanded: boolean,
  anchor: () => OverlayAnchor | null = () => null,
): {
  root: FakeEl;
  toggle: FakeEl;
  chip: FakeEl;
  panel: FakeEl;
  world: FakeWorld;
  appended: unknown[];
  data: DebugOverlayData;
  tick: () => void;
  period: () => number;
  stopped: () => boolean;
  overlay: ReturnType<typeof installDebugOverlay>;
} {
  const made: FakeEl[] = [];
  const appended: unknown[] = [];
  const host: OverlayHost = {
    createElement: () => {
      const el = new FakeEl();
      made.push(el);
      return el as unknown as HTMLDivElement;
    },
    body: { appendChild: (x) => appended.push(x) },
  };
  const data: DebugOverlayData = { ...DATA };
  const world = new FakeWorld();
  let fn: (() => void) | null = null;
  let ms = 0;
  let stopped = false;
  const overlay = installDebugOverlay({
    data: () => data,
    expanded,
    anchor,
    host,
    win: world.win as unknown as GuardTarget,
    every: (f, period) => {
      fn = f;
      ms = period;
      return () => {
        stopped = true;
      };
    },
  });
  world.addAppListeners();
  const [root, toggle, chip, panel] = made as [FakeEl, FakeEl, FakeEl, FakeEl];
  return {
    root,
    toggle,
    chip,
    panel,
    world,
    appended,
    data,
    tick: () => fn?.(),
    period: () => ms,
    stopped: () => stopped,
    overlay,
  };
}

describe('installDebugOverlay', () => {
  it('#debug-overlay 안에 누르는 자리(칩을 감싼 버튼) · 표. 문서에 한 번 붙인다', () => {
    const { root, toggle, chip, panel, appended, overlay } = setup(true);
    expect(appended).toEqual([root]);
    expect(root.id).toBe('debug-overlay');
    expect(root.attrs.get('data-testid')).toBe('debug-overlay');
    expect(root.children).toEqual([toggle, panel]);
    expect(toggle.children).toEqual([chip]);
    expect(toggle.className).toBe('dbg-toggle');
    expect(toggle.attrs.get('role')).toBe('button');
    expect(toggle.attrs.get('data-testid')).toBe('debug-overlay-toggle');
    expect(chip.className).toBe('dbg-chip');
    expect(panel.className).toBe('dbg-panel');
    expect(overlay.el).toBe(root as unknown as HTMLDivElement);
  });

  it('PC(펼침)로 시작: 표가 보이고 글자가 있다, 칩은 ▾', () => {
    const { root, toggle, chip, panel, overlay } = setup(true);
    expect(overlay.expanded).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toBe(formatDebugPanel(DATA));
    expect(chip.textContent).toBe('▾ 120fps 8.3ms');
    expect(toggle.attrs.get('aria-expanded')).toBe('true');
    expect(root.className).toBe('dbg-bottom dbg-expanded');
  });

  it('터치(접힘)로 시작: 표는 숨기고 글자도 만들지 않는다, 칩은 ▸', () => {
    const { toggle, chip, panel, overlay, tick } = setup(false);
    expect(overlay.expanded).toBe(false);
    expect(panel.hidden).toBe(true);
    tick();
    expect(panel.writes).toBe(0);
    expect(chip.textContent).toBe('▸ 120fps 8.3ms');
    expect(toggle.attrs.get('aria-expanded')).toBe('false');
  });

  it('창 캡처 단계 문지기: 시작 이벤트 6종을 캡처로 단다(touchstart만 passive — 창 전체 터치 스크롤을 막지 않게), 끝 이벤트는 달지 않는다', () => {
    const { world } = setup(false);
    expect(GUARDED_EVENTS.map((g) => g.type)).toEqual([
      'pointerdown',
      'touchstart',
      'mousedown',
      'click',
      'dblclick',
      'contextmenu',
    ]);
    for (const g of GUARDED_EVENTS) {
      // 설치 때 단 문지기가 그 종류의 첫 창 리스너다 (나중에 붙는 input.ts 창 캡처보다 먼저)
      const first = world.win.listeners.get(g.type)?.[0];
      expect(first?.opts, g.type).toEqual({ capture: true, passive: g.type === 'touchstart' });
    }
    // 캔버스에서 시작한 끌기가 칩 위에서 끝나도 판 · Phaser가 뗌을 받도록 끝 이벤트는 그대로 둔다
    for (const type of ['pointerup', 'touchend', 'touchcancel', 'mouseup', 'pointermove'])
      expect(
        GUARDED_EVENTS.some((g) => g.type === type),
        type,
      ).toBe(false);
  });

  it('칩(보이는 칩 · 누르는 자리)을 누르면: 펼치고 접는다, 기본 동작을 막고, 나중 창 캡처 · 문서 캡처(점수판 닫기) · 칩 자신까지 아무도 받지 않는다', () => {
    const { toggle, chip, panel, overlay, world } = setup(false);
    const down = world.dispatch(event('pointerdown', chip));
    expect([down.prevented, down.immediate]).toEqual([true, true]);
    expect(overlay.expanded).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('서버 틱');
    expect(chip.textContent.startsWith('▾')).toBe(true);
    world.dispatch(event('pointerdown', toggle));
    expect(overlay.expanded).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(chip.textContent.startsWith('▸')).toBe(true);
    for (const type of ['mousedown', 'click', 'contextmenu']) {
      const e = world.dispatch(event(type, chip));
      expect([e.prevented, e.immediate], type).toEqual([true, true]);
    }
    // touchstart: passive라 막지 않고 전파만 멈춘다 (스크롤 · 확대는 칩의 touch-action: none이 막는다)
    const ts = world.dispatch(event('touchstart', chip));
    expect([ts.prevented, ts.immediate]).toEqual([false, true]);
    expect(world.laterWin).toEqual([]);
    expect(world.docCapture).toEqual([]);
    // 클릭 · 메뉴로는 접기/펼치기가 바뀌지 않는다 (pointerdown에서 한 번만)
    expect(overlay.expanded).toBe(false);
  });

  it('다른 버튼(오른쪽 클릭)은 접기/펼치기 없이 막기만, 취소할 수 없는 이벤트는 preventDefault를 부르지 않는다', () => {
    const { chip, overlay, world } = setup(false);
    const right = world.dispatch(event('pointerdown', chip, 2));
    expect([right.prevented, right.immediate]).toEqual([true, true]);
    expect(overlay.expanded).toBe(false);
    const late = world.dispatch(event('pointerdown', chip, 0, false));
    expect([late.prevented, late.immediate]).toEqual([false, true]);
    expect(overlay.expanded).toBe(true);
  });

  it('칩 밖(펼친 표 · 다른 요소 · 창 자신)의 이벤트는 건드리지 않는다: 점수판 · 설정 메뉴는 예전처럼 닫힌다', () => {
    const { panel, overlay, world } = setup(true);
    const other = new FakeEl();
    for (const target of [panel, other, world.win, null]) {
      const e = world.dispatch(event('pointerdown', target));
      expect([e.prevented, e.stopped]).toEqual([false, false]);
    }
    expect(world.laterWin).toEqual(['pointerdown', 'pointerdown', 'pointerdown', 'pointerdown']);
    expect(world.docCapture).toEqual(['pointerdown', 'pointerdown', 'pointerdown', 'pointerdown']);
    expect(overlay.expanded).toBe(true);
    // 끝 이벤트는 칩 위에서 나도 그대로 퍼진다
    const up = world.dispatch(event('pointerup', overlay.chipEl));
    expect([up.prevented, up.stopped]).toEqual([false, false]);
    expect(world.docCapture.at(-1)).toBe('pointerup');
  });

  it('자리: anchor가 있으면 그 px(반올림)에서 아래로 펼침(.dbg-top), 없으면 CSS 기본(왼쪽 아래, 인라인 자리 없음)', () => {
    let a: OverlayAnchor | null = { left: 156.4, top: 2 };
    const { root, tick, overlay } = setup(false, () => a);
    expect(root.style.left).toBe('156px');
    expect(root.style.top).toBe('2px');
    expect(root.className).toBe('dbg-top dbg-collapsed');
    overlay.setExpanded(true);
    expect(root.className).toBe('dbg-top dbg-expanded');
    a = null;
    tick();
    expect(root.style.left).toBe('');
    expect(root.style.top).toBe('');
    expect(root.className).toBe('dbg-bottom dbg-expanded');
  });

  it(`${DEBUG_OVERLAY_UPDATE_MS}ms(4Hz)마다 고치되 바뀐 글자만 쓴다`, () => {
    const { chip, panel, tick, period, data } = setup(true);
    expect(period()).toBe(250);
    const chipWrites = chip.writes;
    const panelWrites = panel.writes;
    tick();
    tick();
    expect([chip.writes, panel.writes]).toEqual([chipWrites, panelWrites]);
    data.ping = 80;
    tick();
    expect([chip.writes, panel.writes]).toEqual([chipWrites, panelWrites + 1]);
    expect(panel.textContent).toContain('핑 80ms');
    data.stats = { ...STATS, fps: 60, intervalAvg: 16.67 };
    tick();
    expect(chip.writes).toBe(chipWrites + 1);
    expect(chip.textContent).toBe('▾ 60fps 16.7ms');
  });

  it('dispose: 주기를 멈추고 문지기를 떼고 상자를 뗀다', () => {
    const { root, chip, overlay, stopped, world } = setup(true);
    overlay.dispose();
    expect(stopped()).toBe(true);
    expect(root.removed).toBe(true);
    const e = world.dispatch(event('pointerdown', chip));
    expect([e.prevented, e.stopped]).toEqual([false, false]);
    expect(overlay.expanded).toBe(true);
  });
});
