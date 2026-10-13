// ?debug=1 오버레이 (렌더링 최적화): 펼친 표 글자(모든 항목 · WebGL/Canvas 그리기 이름) · 접은 칩 한 줄 ·
// 상자(칩만 입력을 받고 판 입력으로 보내지 않음 · 접기/펼치기 · 자리 · 4Hz · 바뀐 것만 씀)
import { describe, expect, it } from 'vitest';
import type { FrameStatsInfo } from '@decoy/shared';
import {
  DEBUG_OVERLAY_UPDATE_MS,
  formatDebugChip,
  formatDebugPanel,
  installDebugOverlay,
  type DebugOverlayData,
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
        '프레임 8.33ms · p95 8.90ms',
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
  });

  it('아직 렌더한 프레임이 없거나 스냅샷이 없으면 -', () => {
    const lines = formatDebugPanel({ ...DATA, stats: null, tick: null }).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      'FPS - · 목표 120 · 화면 120Hz · 제한 자동',
      '프레임 - · p95 -',
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
  button: number;
  cancelable: boolean;
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

function event(type: string, button = 0, cancelable = true): FakeEvent {
  return {
    type,
    button,
    cancelable,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

/** 가짜 DOM 요소: textContent 쓰기 횟수 · 리스너 · 자식 */
class FakeEl {
  id = '';
  className = '';
  hidden = false;
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  listeners = new Map<string, { fn: (e: FakeEvent) => void; opts: unknown }[]>();
  writes = 0;
  removed = false;
  private text = '';
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  appendChild(c: FakeEl): void {
    this.children.push(c);
  }
  addEventListener(type: string, fn: (e: FakeEvent) => void, opts?: unknown): void {
    const l = this.listeners.get(type) ?? [];
    l.push({ fn, opts });
    this.listeners.set(type, l);
  }
  dispatch(e: FakeEvent): FakeEvent {
    for (const l of this.listeners.get(e.type) ?? []) l.fn(e);
    return e;
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

function setup(
  expanded: boolean,
  anchor: () => OverlayAnchor | null = () => null,
): {
  root: FakeEl;
  toggle: FakeEl;
  chip: FakeEl;
  panel: FakeEl;
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
  let fn: (() => void) | null = null;
  let ms = 0;
  let stopped = false;
  const overlay = installDebugOverlay({
    data: () => data,
    expanded,
    anchor,
    host,
    every: (f, period) => {
      fn = f;
      ms = period;
      return () => {
        stopped = true;
      };
    },
  });
  const [root, toggle, chip, panel] = made as [FakeEl, FakeEl, FakeEl, FakeEl];
  return {
    root,
    toggle,
    chip,
    panel,
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

  it('누르면(주 버튼) 펼치고 다시 누르면 접는다. 다른 버튼은 무시. 누르기는 기본 동작 · 전파를 막는다', () => {
    const { toggle, panel, overlay, chip } = setup(false);
    const down = toggle.dispatch(event('pointerdown'));
    expect(down.prevented && down.stopped).toBe(true);
    expect(overlay.expanded).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('서버 틱');
    expect(chip.textContent.startsWith('▾')).toBe(true);
    toggle.dispatch(event('pointerdown', 2));
    expect(overlay.expanded).toBe(true);
    toggle.dispatch(event('pointerdown'));
    expect(overlay.expanded).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(chip.textContent.startsWith('▸')).toBe(true);
  });

  it('칩의 터치 · 마우스 · 클릭 · 메뉴 이벤트는 판 입력(Phaser 창 리스너는 defaultPrevented를 본다)으로 가지 않는다', () => {
    const { toggle, overlay } = setup(false);
    for (const type of [
      'touchstart',
      'touchend',
      'touchcancel',
      'mousedown',
      'mouseup',
      'click',
      'contextmenu',
    ]) {
      const l = toggle.listeners.get(type);
      expect(l?.length, type).toBe(1);
      // 터치 시작을 막으려면 passive가 아니어야 한다
      expect(l?.[0]?.opts, type).toEqual({ passive: false });
      const e = toggle.dispatch(event(type));
      expect([e.prevented, e.stopped], type).toEqual([true, true]);
    }
    // 취소할 수 없는 이벤트(스크롤 중)는 preventDefault를 부르지 않는다 (콘솔 경고가 나지 않게)
    const late = toggle.dispatch(event('touchstart', 0, false));
    expect([late.prevented, late.stopped]).toEqual([false, true]);
    // 클릭으로는 접기/펼치기가 바뀌지 않는다 (pointerdown에서 한 번만)
    expect(overlay.expanded).toBe(false);
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

  it('dispose: 주기를 멈추고 상자를 뗀다', () => {
    const { root, overlay, stopped } = setup(true);
    overlay.dispose();
    expect(stopped()).toBe(true);
    expect(root.removed).toBe(true);
  });
});
