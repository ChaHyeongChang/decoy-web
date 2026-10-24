// 프레임 측정 (렌더링 최적화): 고리 버퍼 · 백분위 · 최근 구간 FPS · 끊김 · FPS 덮어쓰기(injectFps) · 할당 없음 ·
// WebGL 그리기 호출 세기. ?debug=1 표시는 debug-overlay.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  FRAME_GAP_MS,
  FRAME_STATS_CAPACITY,
  FrameStats,
  frameStatsInfo,
  installDrawCounter,
  percentileInPlace,
  sessionFrameStats,
  type FrameWindow,
} from '../../client/src/gfx/frameStats';
import { setFpsOverride } from '../../client/src/gfx/state';
import { percentile } from '../perf/perfHooks';

/** hz로 n프레임을 그린다 (rAF 시각 = t0 + k·1000/hz, 작업 시간 work(k)) */
function feed(
  s: FrameStats,
  n: number,
  hz: number,
  t0 = 1000,
  work: (k: number) => number = () => 2,
): number {
  let t = t0;
  for (let k = 0; k < n; k++) {
    t = t0 + (k * 1000) / hz;
    s.begin(t, t + 0.5);
    s.end(t + 0.5 + work(k));
  }
  return t;
}

/** 시드 난수 (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('FrameStats: 간격 · 작업 시간', () => {
  it('첫 프레임은 간격이 없고, 그 뒤는 rAF 시각 차이 · 작업 시간 = end − begin의 벽시계', () => {
    const s = new FrameStats();
    s.begin(100, 101);
    s.end(105);
    let sum = s.summary();
    expect(sum.frames).toBe(1);
    expect(sum.intervalAvg).toBe(0);
    expect(sum.workAvg).toBeCloseTo(4, 5);
    s.begin(110, 112);
    s.end(113.5);
    sum = s.summary();
    expect(sum.frames).toBe(2);
    expect(sum.intervalAvg).toBeCloseTo(10, 5);
    expect(sum.intervalP95).toBeCloseTo(10, 5);
    expect(sum.workAvg).toBeCloseTo((4 + 1.5) / 2, 5);
  });

  it('begin의 벽시계를 주지 않으면 rAF 시각부터 잰다 · begin 없는 end는 무시 · 음수 · NaN 작업은 0', () => {
    const s = new FrameStats();
    s.end(50);
    expect(s.recorded).toBe(0);
    s.begin(10);
    s.end(13);
    expect(s.summary().workAvg).toBeCloseTo(3, 5);
    s.end(99);
    expect(s.recorded).toBe(1);
    s.begin(20, 30);
    s.end(25);
    s.begin(30, 30);
    s.end(Number.NaN);
    expect(s.summary().workP95).toBeCloseTo(3, 5);
    expect(s.summary().workAvg).toBeCloseTo(1, 5);
  });

  it('60Hz 정확히: 간격 16.67ms · p95 16.67ms · FPS 60', () => {
    const s = new FrameStats();
    feed(s, 200, 60);
    const sum = s.summary();
    expect(sum.intervalAvg).toBeCloseTo(1000 / 60, 3);
    expect(sum.intervalP95).toBeCloseTo(1000 / 60, 3);
    expect(sum.fps).toBeCloseTo(60, 3);
    expect(sum.workAvg).toBeCloseTo(2, 5);
  });

  it('끊김(탭 숨김 등 FRAME_GAP_MS 초과)은 간격 통계에서 빼고, 그 프레임의 작업 시간은 센다', () => {
    const s = new FrameStats();
    const last = feed(s, 60, 60);
    feed(s, 60, 60, last + 5000, () => 3);
    const sum = s.summary();
    expect(sum.frames).toBe(120);
    expect(sum.intervalAvg).toBeCloseTo(1000 / 60, 3);
    expect(sum.intervalP95).toBeCloseTo(1000 / 60, 3);
    expect(sum.workAvg).toBeCloseTo(2.5, 5);
    // 기준 바로 아래 간격(한 번 멈칫)은 넣는다
    const t = new FrameStats();
    t.begin(0);
    t.end(1);
    t.begin(FRAME_GAP_MS);
    t.end(FRAME_GAP_MS + 1);
    expect(t.summary().intervalAvg).toBe(FRAME_GAP_MS);
  });

  it('시각이 뒤로 가거나 같으면 간격 없음', () => {
    const s = new FrameStats();
    s.begin(100);
    s.end(101);
    s.begin(100);
    s.end(101);
    s.begin(90);
    s.end(91);
    expect(s.summary().intervalAvg).toBe(0);
    expect(s.recorded).toBe(3);
  });

  it('reset 뒤 첫 프레임은 간격 없이 시작한다 (누계 · 건너뜀은 그대로)', () => {
    const s = new FrameStats();
    feed(s, 10, 60);
    s.noteSkipped(3);
    s.reset();
    expect(s.recorded).toBe(0);
    expect(s.total).toBe(10);
    s.begin(5000);
    s.end(5001);
    const sum = s.summary();
    expect(sum.frames).toBe(1);
    expect(sum.intervalAvg).toBe(0);
    expect(sum.skipped).toBe(3);
  });
});

describe('FrameStats: 고리 버퍼', () => {
  it(`크기 ${FRAME_STATS_CAPACITY}: 넘치면 가장 오래된 프레임부터 덮어쓴다`, () => {
    const s = new FrameStats();
    expect(s.capacity).toBe(240);
    // 앞 100프레임은 30Hz · 작업 10ms, 뒤 200프레임은 60Hz · 작업 2ms → 남는 것은 30Hz 40개 + 60Hz 200개
    const last = feed(s, 100, 30, 0, () => 10);
    feed(s, 200, 60, last + 1000 / 60, () => 2);
    expect(s.recorded).toBe(240);
    expect(s.total).toBe(300);
    const sum = s.summary();
    expect(sum.frames).toBe(240);
    // 간격: 30Hz 39개(남은 40개 중 가장 오래된 것의 간격도 33.3) + 경계 1개(16.67) + 60Hz 199개
    // 가장 오래된 남은 프레임(61번째)의 간격은 60번째와의 차이 33.33이다
    const expected = (40 * (1000 / 30) + 200 * (1000 / 60)) / 240;
    expect(sum.intervalAvg).toBeCloseTo(expected, 3);
    expect(sum.workAvg).toBeCloseTo((40 * 10 + 200 * 2) / 240, 4);
    expect(sum.workP95).toBeCloseTo(10, 5);
  });

  it('작은 버퍼도 같은 규칙 (여러 바퀴)', () => {
    const s = new FrameStats(4);
    feed(s, 11, 100, 0, (k) => k);
    expect(s.recorded).toBe(4);
    // 남는 작업 시간 7 · 8 · 9 · 10
    expect(s.summary().workAvg).toBeCloseTo(8.5, 5);
    expect(s.summary().workP95).toBeCloseTo(10, 5);
  });

  it('begin · end를 몇 번 불러도 같은 버퍼를 다시 쓴다 (프레임마다 할당하지 않는다)', () => {
    const s = new FrameStats();
    const before = s.buffers;
    feed(s, 10_000, 120);
    s.summary();
    s.window(1000);
    const after = s.buffers;
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBe(before[i]);
      expect(after[i]?.length).toBe(FRAME_STATS_CAPACITY);
    }
  });
});

describe('백분위 (가까운 순위, tests/perf와 같은 정의)', () => {
  it('1~100의 p95 = 95, p50 = 50, 한 개 = 그 값, 없으면 0', () => {
    const a = new Float32Array(100);
    const r = rng(7);
    const vals = Array.from({ length: 100 }, (_, i) => i + 1).sort(() => r() - 0.5);
    a.set(vals);
    expect(percentileInPlace(a, 100, 0.95)).toBe(95);
    expect(percentileInPlace(a, 100, 0.5)).toBe(50);
    const one = new Float32Array([3.5]);
    expect(percentileInPlace(one, 1, 0.95)).toBe(3.5);
    expect(percentileInPlace(one, 0, 0.95)).toBe(0);
  });

  it('무작위 · 중복 많은 값에서 정렬 뒤 고른 값과 같다 (앞 n칸만 본다)', () => {
    const r = rng(20261013);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(r() * 240);
      const dup = trial % 3 === 0;
      const vals = Array.from({ length: n }, () => (dup ? Math.floor(r() * 5) : Math.fround(r() * 40)));
      const buf = new Float32Array(240).fill(-1);
      buf.set(vals);
      const sorted = [...vals].sort((x, y) => x - y);
      for (const p of [0.5, 0.95, 0.99, 1]) {
        const copy = buf.slice();
        expect(percentileInPlace(copy, n, p), `n=${n} p=${p}`).toBe(percentile(sorted, p * 100));
      }
    }
  });
});

describe('FrameStats: 최근 구간 FPS (적응형 품질 · 표시)', () => {
  it('120Hz 2초 뒤 60Hz 1초: 최근 1초 FPS 60, 버퍼 전체 간격 평균은 둘이 섞인다', () => {
    const s = new FrameStats();
    const last = feed(s, 240, 120, 0);
    feed(s, 61, 60, last + 1000 / 60);
    const w = s.window(1000);
    expect(w.fps).toBeCloseTo(60, 2);
    expect(w.intervalAvg).toBeCloseTo(1000 / 60, 3);
    expect(w.frames).toBe(60);
    expect(s.summary().fps).toBeCloseTo(60, 2);
    expect(s.window(500).fps).toBeCloseTo(60, 2);
  });

  it('처음 0.5초만 쟀어도 FPS는 실제 빠르기 (모자란 구간을 1초로 나누지 않는다)', () => {
    const s = new FrameStats();
    feed(s, 61, 120);
    expect(s.window(1000).fps).toBeCloseTo(120, 2);
    expect(s.window(1000).frames).toBe(61);
  });

  it('240Hz 1초는 버퍼 하나에 다 들어간다', () => {
    const s = new FrameStats();
    feed(s, 600, 240);
    const w = s.window(1000);
    expect(w.frames).toBe(240);
    expect(w.fps).toBeCloseTo(240, 2);
  });

  it('1초 안에 한 번 멈칫(200ms)하면 FPS가 그만큼 떨어진다', () => {
    const s = new FrameStats();
    let t = feed(s, 100, 60);
    t += 200;
    s.begin(t);
    s.end(t + 1);
    feed(s, 47, 60, t + 1000 / 60);
    const w = s.window(1000);
    // 최근 1초에 끝난 간격 49개 = 멈추기 전 마지막 간격 1 + 멈칫 200ms 1 + 47 → 합 200 + 48×16.67 = 1000ms
    expect(w.frames).toBe(49);
    expect(w.fps).toBeCloseTo((49 * 1000) / (200 + (48 * 1000) / 60), 2);
    expect(w.fps).toBeCloseTo(49, 2);
  });

  it('구간 작업 p95는 그 구간 프레임만 본다', () => {
    const s = new FrameStats();
    const last = feed(s, 120, 60, 0, () => 12);
    // 최근 60프레임 중 6개가 9ms → p95(57번째로 큰 값 이상)는 9, 3개뿐이면 3
    feed(s, 60, 60, last + 1000 / 60, (k) => (k < 6 ? 9 : 3));
    expect(s.window(1000).frames).toBe(60);
    expect(s.window(1000).workP95).toBeCloseTo(9, 5);
    expect(s.window(2000).workP95).toBeCloseTo(12, 5);
  });

  it('늦은 프레임 = 간격 ≥ 목표 주기 + 반 vsync: 144Hz · 목표 72에서 2칸(13.9ms)은 늦지 않고 3칸(20.8ms)은 늦다 (lateWindowFor와 같은 창)', () => {
    const s = new FrameStats();
    const v = 1000 / 144;
    let t = 1000;
    // 2칸 18번 + 3칸 2번 = 간격 20개 중 2개 늦음
    const steps = [...Array.from({ length: 9 }, () => 2), 3, ...Array.from({ length: 9 }, () => 2), 3];
    s.begin(t, t);
    s.end(t + 1);
    for (const k of steps) {
      t += k * v;
      s.begin(t, t);
      s.end(t + 1);
    }
    const late = { periodMs: 2 * v, slackMs: 0.5 * v };
    expect(s.window(1000, undefined, late).late).toBeCloseTo(0.1, 9);
    // 목표 144(주기 1칸)로 보면 모두 늦다
    expect(s.window(1000, undefined, { periodMs: v, slackMs: 0.5 * v }).late).toBe(1);
    // 창을 주지 않으면 0
    expect(s.window(1000).late).toBe(0);
  });

  it('out을 주면 그 객체를 채워 돌려준다 (프레임마다 불러도 할당 없음)', () => {
    const s = new FrameStats();
    feed(s, 30, 60);
    const out: FrameWindow = { fps: 0, intervalAvg: 0, workP95: 0, frames: 0, late: 0 };
    expect(s.window(1000, out)).toBe(out);
    expect(out.frames).toBe(30);
  });

  it('프레임이 없으면 0', () => {
    const s = new FrameStats();
    expect(s.window(1000)).toEqual({ fps: 0, intervalAvg: 0, workP95: 0, frames: 0, late: 0 });
    const sum = s.summary();
    expect(sum).toMatchObject({ frames: 0, fps: 0, intervalAvg: 0, intervalP95: 0, workAvg: 0, workP95: 0 });
  });
});

describe('FrameStats: 건너뜀 · 그리기 호출', () => {
  it('건너뛴 rAF 누계와 지난 프레임 그리기 수를 그대로 낸다', () => {
    const s = new FrameStats();
    feed(s, 5, 60);
    expect(s.summary().drawCalls).toBeNull();
    expect(s.summary().skipped).toBe(0);
    s.noteSkipped();
    s.noteSkipped(2);
    s.setDrawCalls(17);
    expect(s.summary()).toMatchObject({ skipped: 3, drawCalls: 17 });
    expect(s.skipped).toBe(3);
    s.setDrawCalls(null);
    expect(s.summary().drawCalls).toBeNull();
  });
});

describe('FrameStats: FPS 덮어쓰기 (디버그 injectFps)', () => {
  afterEach(() => {
    setFpsOverride(null);
    sessionFrameStats.setOverrideFps(null);
    sessionFrameStats.reset();
  });

  it('덮어쓰면 fps = f, 간격 = 작업 시간 = 1000/f (실제 측정과 상관없이). 프레임 수 · 그리기 · 건너뜀은 실제 값', () => {
    const s = new FrameStats();
    feed(s, 100, 120, 0, () => 1);
    s.setDrawCalls(9);
    s.noteSkipped(4);
    s.setOverrideFps(60);
    const sum = s.summary();
    expect(sum).toEqual({
      frames: 100,
      fps: 60,
      intervalAvg: 1000 / 60,
      intervalP95: 1000 / 60,
      workAvg: 1000 / 60,
      workP95: 1000 / 60,
      drawCalls: 9,
      skipped: 4,
    });
    expect(s.window(1000)).toEqual({
      fps: 60,
      intervalAvg: 1000 / 60,
      workP95: 1000 / 60,
      frames: 100,
      late: 0,
    });
    s.setOverrideFps(null);
    expect(s.window(1000).fps).toBeCloseTo(120, 2);
  });

  it('0 이하 · 무한 · NaN은 덮어쓰지 않음과 같다', () => {
    const s = new FrameStats();
    feed(s, 30, 60);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      s.setOverrideFps(bad);
      expect(s.overrideFps, String(bad)).toBeNull();
      expect(s.window(1000).fps).toBeCloseTo(60, 2);
    }
  });

  it('읽는 곳(overrideSource)을 따르되, setOverrideFps로 정한 값이 먼저', () => {
    let src: number | null = 20;
    const s = new FrameStats(240, () => src);
    feed(s, 30, 60);
    expect(s.summary().fps).toBe(20);
    expect(s.window(1000).workP95).toBe(50);
    s.setOverrideFps(45);
    expect(s.summary().fps).toBe(45);
    s.setOverrideFps(null);
    src = null;
    expect(s.summary().fps).toBeCloseTo(60, 2);
  });

  it('세션 측정은 gfx/state.ts setFpsOverride(= 디버그 injectFps)를 따른다. 렌더 전에는 frameStatsInfo가 null', () => {
    sessionFrameStats.reset();
    expect(frameStatsInfo()).toBeNull();
    sessionFrameStats.begin(0);
    sessionFrameStats.end(2);
    sessionFrameStats.begin(1000 / 60);
    sessionFrameStats.end(1000 / 60 + 2);
    expect(frameStatsInfo()?.intervalAvg).toBeCloseTo(1000 / 60, 3);
    setFpsOverride(60);
    // injectFps(60) at 목표 60: 100% 바쁨 → 적응형 품질이 올리지도 내리지도 않는다
    expect(frameStatsInfo()).toMatchObject({
      fps: 60,
      workP95: 1000 / 60,
      intervalAvg: 1000 / 60,
      frames: 2,
    });
    expect(sessionFrameStats.window(1000)).toMatchObject({ fps: 60, workP95: 1000 / 60 });
    setFpsOverride(null);
    expect(frameStatsInfo()?.workP95).toBeCloseTo(2, 5);
  });
});

// ───────────── WebGL 그리기 호출 세기 ─────────────

interface Call {
  name: string;
  self: unknown;
  args: unknown[];
}

/** WebGL2처럼 그리기 메서드 5개가 프로토타입에 있는 가짜 컨텍스트 */
class FakeGl2 {
  calls: Call[] = [];
  drawArrays(...args: unknown[]): string {
    this.calls.push({ name: 'drawArrays', self: this, args });
    return 'a';
  }
  drawElements(...args: unknown[]): string {
    this.calls.push({ name: 'drawElements', self: this, args });
    return 'e';
  }
  drawArraysInstanced(...args: unknown[]): void {
    this.calls.push({ name: 'drawArraysInstanced', self: this, args });
  }
  drawElementsInstanced(...args: unknown[]): void {
    this.calls.push({ name: 'drawElementsInstanced', self: this, args });
  }
  drawRangeElements(...args: unknown[]): void {
    this.calls.push({ name: 'drawRangeElements', self: this, args });
  }
  clear(): void {
    this.calls.push({ name: 'clear', self: this, args: [] });
  }
}

/** WebGL1처럼 drawArrays · drawElements만 (인스턴스 판 없음) */
class FakeGl1 {
  n = 0;
  drawArrays(): void {
    this.n++;
  }
  drawElements(): void {
    this.n++;
  }
}

const asGl = (x: object): WebGL2RenderingContext => x as unknown as WebGL2RenderingContext;

describe('installDrawCounter (WebGL 그리기 호출)', () => {
  it('그리기 메서드 5개를 프레임마다 센다 (그리기가 아닌 호출은 세지 않는다), 원래 함수에 인자 · this · 반환값 그대로', () => {
    const fake = new FakeGl2();
    const gl = asGl(fake);
    const seen: number[] = [];
    const c = installDrawCounter(gl, (n) => seen.push(n));
    expect(c.methods).toEqual([
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
      'drawRangeElements',
    ]);
    c.beginCount();
    expect(gl.drawArrays(4, 0, 6)).toBe('a');
    expect((gl.drawElements as unknown as (...a: number[]) => string)(4, 6, 5123, 0)).toBe('e');
    gl.drawArraysInstanced(4, 0, 6, 10);
    gl.drawElementsInstanced(4, 6, 5123, 0, 3);
    gl.drawRangeElements(4, 0, 5, 6, 5123, 0);
    gl.clear(0);
    expect(c.endCount()).toBe(5);
    expect(seen).toEqual([5]);
    c.beginCount();
    gl.drawArrays(4, 0, 3);
    expect(c.endCount()).toBe(1);
    expect(c.total).toBe(6);
    expect(fake.calls.map((x) => x.name)).toEqual([
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
      'drawRangeElements',
      'clear',
      'drawArrays',
    ]);
    for (const call of fake.calls) expect(call.self).toBe(fake);
    // 감싼 함수는 고정 인자 6개로 넘긴다 (남는 것은 undefined — WebIDL이 버린다)
    expect(fake.calls[0]?.args.slice(0, 3)).toEqual([4, 0, 6]);
    expect(fake.calls[0]?.args.slice(3).every((a) => a === undefined)).toBe(true);
    expect(fake.calls[4]?.args).toEqual([4, 0, 5, 6, 5123, 0]);
  });

  it('WebGL1: 있는 메서드만 감싼다. 같은 종류의 다른 컨텍스트 · 프로토타입은 그대로', () => {
    const a = new FakeGl1();
    const b = new FakeGl1();
    const c = installDrawCounter(asGl(a));
    expect(c.methods).toEqual(['drawArrays', 'drawElements']);
    c.beginCount();
    a.drawArrays();
    b.drawArrays();
    b.drawElements();
    expect(c.endCount()).toBe(1);
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(b, 'drawArrays')).toBe(false);
    expect(FakeGl1.prototype.drawArrays.length).toBe(0);
  });

  it('uninstall: 인스턴스에 덧붙인 것을 지운다(원래 자기 속성이었으면 그 값으로)', () => {
    const fake = new FakeGl1();
    const own = function ownDraw(): void {};
    (fake as unknown as { drawElements: () => void }).drawElements = own;
    const c = installDrawCounter(asGl(fake));
    expect(Object.prototype.hasOwnProperty.call(fake, 'drawArrays')).toBe(true);
    c.uninstall();
    expect(Object.prototype.hasOwnProperty.call(fake, 'drawArrays')).toBe(false);
    expect(fake.drawArrays).toBe(FakeGl1.prototype.drawArrays);
    expect(fake.drawElements).toBe(own);
    c.beginCount();
    fake.drawArrays();
    expect(c.endCount()).toBe(0);
  });
});
