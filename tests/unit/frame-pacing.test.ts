// 프레임 페이싱 (렌더링 최적화, client/src/gfx/framePacing.ts): 프레임 제한 해석 · 저장, 화면 주사율 재기(맞추기 · 바닥 ·
// 잡음 · 흔들림 막기), 제한기(60 · 90 · 120 · 144 · 240Hz 합성 rAF, ±0.3ms 흔들림, 멈춤 뒤 다시 맞추기, 제한 바꾸기),
// 목표 FPS, 판이 없을 때 30fps 묶음, Phaser TimeStep.step 감싸기. rAF 시각은 시드 고정 의사 난수로 만든다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FRAME_LIMITS,
  FRAME_LIMIT_STORAGE_KEY,
  FrameLimiter,
  IDLE_CAP_HZ,
  LIMITER,
  Pacer,
  REFRESH,
  RefreshEstimator,
  EVEN_RATE,
  capHzFor,
  divisorFor,
  higherRate,
  isFrameLimit,
  lowerRate,
  rateLadder,
  loadFrameLimit,
  parseFrameLimit,
  patchTimeStep,
  saveFrameLimit,
  snapRefreshHz,
  targetHzFor,
  unpatchTimeStep,
  type FrameLimit,
} from '../../client/src/gfx/framePacing';
import { STORAGE_KEYS, type StorageLike } from '../../client/src/storageKeys';

/** 시드 고정 의사 난수 [0, 1) (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 화면 주사율 hz의 rAF 시각들: t0 + k·1000/hz (+ 흔들림 ±jitter ms). 쌓지 않고 k로 계산한다 */
function ticks(hz: number, ms: number, opts: { t0?: number; jitter?: number; seed?: number } = {}): number[] {
  const { t0 = 1000, jitter = 0, seed = 1 } = opts;
  const r = rng(seed);
  const out: number[] = [];
  for (let k = 0; k * (1000 / hz) < ms; k += 1) out.push(t0 + k * (1000 / hz) + (r() * 2 - 1) * jitter);
  return out;
}

/** 제한기에 rAF 시각들을 넣고 그린 tick의 번호 · 시각 */
function drive(lim: FrameLimiter, ts: readonly number[], displayHz: number): { idx: number[]; at: number[] } {
  const idx: number[] = [];
  const at: number[] = [];
  ts.forEach((t, i) => {
    if (lim.shouldRun(t, displayHz)) {
      idx.push(i);
      at.push(t);
    }
  });
  return { idx, at };
}

/** 이웃한 값의 차 */
function gaps(xs: readonly number[]): number[] {
  return xs.slice(1).map((x, i) => x - xs[i]!);
}

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('프레임 제한 해석 · 저장', () => {
  it('선택지는 자동 · 60 · 120 · 절반 (isFrameLimit은 그 넷만)', () => {
    expect(FRAME_LIMITS).toEqual(['auto', '60', '120', 'half']);
    for (const l of FRAME_LIMITS) expect(isFrameLimit(l)).toBe(true);
    for (const v of ['30', 60, 'AUTO', 'HALF', '', null, undefined]) expect(isFrameLimit(v)).toBe(false);
  });

  it('parseFrameLimit: 앞뒤 공백 · 대소문자 무시, 모르는 값 · null은 null', () => {
    expect(parseFrameLimit('auto')).toBe('auto');
    expect(parseFrameLimit(' AUTO ')).toBe('auto');
    expect(parseFrameLimit('Auto')).toBe('auto');
    expect(parseFrameLimit('60')).toBe('60');
    expect(parseFrameLimit(' 120\n')).toBe('120');
    expect(parseFrameLimit(' Half ')).toBe('half');
    for (const raw of [null, '', ' ', '30', '90', '144', '60fps', '0120', '6 0', 'max', 'off'])
      expect(parseFrameLimit(raw), String(raw)).toBeNull();
  });

  it("저장 키는 'decoy:frameLimit' (기기 저장소, 처리방침 표와 같은 목록)", () => {
    expect(FRAME_LIMIT_STORAGE_KEY).toBe('decoy:frameLimit');
    expect(STORAGE_KEYS.frameLimit).toEqual({
      key: 'decoy:frameLimit',
      area: 'local',
      what: '프레임 제한 선택 (자동이면 저장하지 않음)',
      keep: '사용자가 바꾸거나 브라우저 데이터를 지울 때까지',
    });
  });

  it('60 · 120은 저장하고 읽고, 자동은 저장값을 지운다', () => {
    const s = mem();
    expect(loadFrameLimit(s)).toBeNull();
    expect(saveFrameLimit('60', s)).toBe(true);
    expect(s.data.get('decoy:frameLimit')).toBe('60');
    expect(loadFrameLimit(s)).toBe('60');
    expect(saveFrameLimit('120', s)).toBe(true);
    expect(loadFrameLimit(s)).toBe('120');
    expect(saveFrameLimit('auto', s)).toBe(true);
    expect(s.data.has('decoy:frameLimit')).toBe(false);
    expect(loadFrameLimit(s)).toBeNull();
  });

  it('모르는 저장값은 없는 것으로 (null), 저장값의 공백 · 대소문자는 해석 규칙대로', () => {
    const s = mem();
    s.data.set('decoy:frameLimit', '30');
    expect(loadFrameLimit(s)).toBeNull();
    s.data.set('decoy:frameLimit', ' 120 ');
    expect(loadFrameLimit(s)).toBe('120');
  });

  it('막힌 저장소 · 저장소 없음: 읽기 null, 쓰기 · 지우기 false (예외 없음)', () => {
    expect(loadFrameLimit(broken)).toBeNull();
    expect(saveFrameLimit('60', broken)).toBe(false);
    expect(saveFrameLimit('auto', broken)).toBe(false);
    expect(loadFrameLimit(null)).toBeNull();
    expect(saveFrameLimit('120', null)).toBe(false);
  });
});

describe('화면 주사율 맞추기 (snapRefreshHz)', () => {
  it('흔한 주사율의 ±7% 안이면 그 값', () => {
    const cases: [number, number][] = [
      [59.94, 60],
      [61.2, 60],
      [56.5, 60],
      [71, 72],
      [74, 75],
      [89.5, 90],
      [99, 100],
      [119.6, 120],
      [126, 120],
      [143.8, 144],
      [165.2, 165],
      [239, 240],
    ];
    for (const [raw, hz] of cases) expect(snapRefreshHz(raw), String(raw)).toBe(hz);
  });

  it('어느 값에도 가깝지 않으면 반올림 (흔하지 않은 주사율도 그대로)', () => {
    expect(snapRefreshHz(66.4)).toBe(66);
    expect(snapRefreshHz(110.2)).toBe(110);
    expect(snapRefreshHz(200)).toBe(200);
  });

  it('바닥 60 · 위 240, 잘못된 값은 60', () => {
    expect(snapRefreshHz(30)).toBe(60);
    expect(snapRefreshHz(48)).toBe(60);
    expect(snapRefreshHz(360)).toBe(240);
    for (const v of [0, -5, Number.NaN, Infinity]) expect(snapRefreshHz(v), String(v)).toBe(60);
  });
});

describe('화면 주사율 재기 (RefreshEstimator)', () => {
  it('간격 30개가 모이기 전에는 60, 모이면 바로 잰 값 (처음 값은 흔들림 막기 없이)', () => {
    const e = new RefreshEstimator();
    const ts = ticks(120, 1000);
    // 첫 tick은 간격이 없다: 간격 29개(tick 30개)까지 60
    for (let i = 0; i < REFRESH.minSamples; i += 1) e.tick(ts[i]!);
    expect(e.sampleCount).toBe(REFRESH.minSamples - 1);
    expect(e.hz).toBe(60);
    expect(e.rawHz).toBeNull();
    e.tick(ts[REFRESH.minSamples]!);
    expect(e.hz).toBe(120);
    expect(e.rawHz).toBeCloseTo(120, 6);
  });

  for (const hz of [60, 72, 90, 120, 144, 165, 240])
    it(`${hz}Hz rAF(±0.3ms 흔들림) → ${hz}`, () => {
      const e = new RefreshEstimator();
      for (const t of ticks(hz, 3000, { jitter: 0.3, seed: hz })) e.tick(t);
      expect(e.hz).toBe(hz);
      expect(e.sampleCount).toBe(REFRESH.samples);
    });

  it('바닥 60: 바빠서 rAF가 30 · 45로 떨어진 기기도 60 (기준을 낮추지 않는다)', () => {
    for (const hz of [30, 45]) {
      const e = new RefreshEstimator();
      for (const t of ticks(hz, 5000, { jitter: 0.3 })) e.tick(t);
      expect(e.hz, `${hz}Hz`).toBe(60);
      expect(e.rawHz!).toBeCloseTo(hz, 0);
    }
  });

  it('잡음: 120Hz에 놓친 vsync(간격 두 배) 20% · 50ms 끊김 5% · 숨김 공백(300ms)이 섞여도 짧은 쪽 20% 백분위라 120', () => {
    const e = new RefreshEstimator();
    const r = rng(7);
    let t = 5000;
    let ignored = 0;
    for (let i = 0; i < 600; i += 1) {
      const x = r();
      const dt = x < 0.2 ? 2000 / 120 : x < 0.25 ? 50 : 1000 / 120;
      t += dt + (r() * 2 - 1) * 0.3;
      if (i === 300) {
        t += 300;
        ignored += 1;
      }
      e.tick(t);
    }
    expect(ignored).toBe(1);
    expect(e.hz).toBe(120);
  });

  it('100ms 넘는 간격 · 0 이하 간격(시간이 거꾸로)은 세지 않는다', () => {
    const e = new RefreshEstimator();
    e.tick(0);
    e.tick(101);
    e.tick(101);
    e.tick(90);
    expect(e.sampleCount).toBe(0);
    e.tick(100);
    expect(e.sampleCount).toBe(1);
  });

  it('다시 내는 것은 0.5초에 한 번까지, 바뀐 값은 두 번 잇달아 같아야 바꾼다 (120 → 60 화면)', () => {
    const e = new RefreshEstimator();
    const a = ticks(120, 2000, { t0: 0, jitter: 0.3 });
    for (const t of a) e.tick(t);
    expect(e.hz).toBe(120);
    // 60Hz로 바뀐다: 짧은 쪽 20% 백분위라 고리(120개)의 80%(96개, 약 1.6초)가 바뀌어야 움직이고, 그 뒤 한 번 더 같아야 바꾼다
    const start = a[a.length - 1]! + 1000 / 60;
    const fill = (Math.ceil(REFRESH.samples * (1 - REFRESH.percentile)) * 1000) / 60;
    let switchedAt: number | null = null;
    for (const t of ticks(60, 4000, { t0: start, jitter: 0.3 })) {
      e.tick(t);
      if (switchedAt === null && e.hz === 60) switchedAt = t - start;
    }
    expect(switchedAt).not.toBeNull();
    expect(switchedAt!).toBeGreaterThanOrEqual(fill - 20);
    expect(switchedAt!).toBeLessThanOrEqual(fill + 2 * REFRESH.recomputeMs + 20);
    expect(e.hz).toBe(60);
  });

  it('흔들림 막기: 한 번만 다르게 나온 값으로는 바꾸지 않는다 (120Hz 화면에 60 간격이 한 번 잴 만큼만)', () => {
    const e = new RefreshEstimator();
    const pendingOf = (): number | null => (e as unknown as { pending: number | null }).pending;
    let t = 0;
    const seen = new Set<number>();
    const step = (hz: number): void => {
      t += 1000 / hz;
      e.tick(t);
      seen.add(e.hz);
    };
    while (t < 2000) step(120);
    expect(e.hz).toBe(120);
    seen.clear();
    // 60 간격을 처음으로 60이라고 잴(아직 쓰지 않음) 때까지만 — 고리의 80%가 바뀌어야 하므로 약 1.6초 뒤
    let guard = 0;
    while (pendingOf() !== 60 && guard++ < 1000) step(60);
    expect(pendingOf(), '60을 한 번 쟀지만 쓰지 않았다').toBe(60);
    // 다시 120: 다음에 다시 낼 때 120이라 60으로 바꾸지 않는다
    const back = t + 2000;
    while (t < back) step(120);
    expect([...seen]).toEqual([120]);
    expect(pendingOf()).toBeNull();
    // 60이 이어지면 바뀐다
    const more = t + 3000;
    while (t < more) step(60);
    expect(e.hz).toBe(60);
  });

  it('바쁜 기기: 120Hz 화면에서 프레임 70%가 vsync를 놓쳐(16.7ms) 간격이 늘어도 120Hz로 잰다 (중앙값이면 60)', () => {
    const e = new RefreshEstimator();
    let t = 0;
    for (let i = 0; i < 600; i++) {
      t += i % 10 < 7 ? 1000 / 60 : 1000 / 120;
      e.tick(t);
    }
    expect(e.hz).toBe(120);
  });

  it('메모리: 간격 고리는 고정 크기 Float64Array 하나를 계속 쓴다 (tick마다 새로 잡지 않는다)', () => {
    const e = new RefreshEstimator();
    const inner = e as unknown as { ring: Float64Array; scratch: Float64Array };
    const ring = inner.ring;
    const scratch = inner.scratch;
    expect(ring).toBeInstanceOf(Float64Array);
    expect(ring.length).toBe(REFRESH.samples);
    for (const t of ticks(144, 3000)) e.tick(t);
    expect(inner.ring).toBe(ring);
    expect(inner.scratch).toBe(scratch);
  });
});

describe('제한기 (FrameLimiter): 차례 시각 방식', () => {
  it('제한 없음: 모든 rAF', () => {
    const lim = new FrameLimiter();
    const ts = ticks(144, 1000, { jitter: 0.3 });
    expect(drive(lim, ts, 144).idx.length).toBe(ts.length);
    expect(lim.skipped).toBe(0);
  });

  it('제한에 가장 가까운 화면 주사율의 약수가 화면 자신이면(n = 1) 제한하지 않는다 (60Hz에 60, 120Hz에 120, 61Hz에 60, 144Hz에 120, 165Hz에 120, 75Hz에 60)', () => {
    const cases: [number, number][] = [
      [60, 60],
      [120, 120],
      [61, 60],
      [60, 120],
      [144, 120],
      [165, 120],
      [75, 60],
    ];
    for (const [display, cap] of cases) {
      const lim = new FrameLimiter();
      lim.setCap(cap);
      const ts = ticks(display, 1000, { jitter: 0.3 });
      expect(drive(lim, ts, display).idx.length, `${display}Hz에 ${cap}`).toBe(ts.length);
      expect(divisorFor(display, cap), `${display}Hz에 ${cap}`).toBe(1);
    }
    expect(LIMITER.phaseSlack).toBe(0.5);
  });

  it('120Hz에 60: 정확히 한 번 걸러 한 번 (±0.3ms 흔들림에도)', () => {
    const lim = new FrameLimiter();
    lim.setCap(60);
    const ts = ticks(120, 2000, { jitter: 0.3, seed: 3 });
    const { idx } = drive(lim, ts, 120);
    expect(new Set(gaps(idx))).toEqual(new Set([2]));
    expect(idx.length).toBe(120);
    expect(lim.skipped).toBe(ts.length - idx.length);
  });

  it('240Hz에 60 → 네 번에 한 번, 240Hz에 120 → 두 번에 한 번', () => {
    for (const [cap, every] of [
      [60, 4],
      [120, 2],
    ] as const) {
      const lim = new FrameLimiter();
      lim.setCap(cap);
      const { idx } = drive(lim, ticks(240, 2000, { jitter: 0.3, seed: cap }), 240);
      expect(new Set(gaps(idx)), `240Hz에 ${cap}`).toEqual(new Set([every]));
      expect(idx.length).toBe(cap * 2);
    }
  });

  it('나누어떨어지지 않는 제한은 가장 가까운 약수로 고르게 — 90Hz에 60 → 45(2칸), 144Hz에 60 → 72(2칸), 165Hz에 60 → 55(3칸), 100Hz에 60 → 50(2칸)', () => {
    for (const [display, cap, every] of [
      [90, 60, 2],
      [144, 60, 2],
      [165, 60, 3],
      [100, 60, 2],
    ] as const) {
      const lim = new FrameLimiter();
      lim.setCap(cap);
      const ts = ticks(display, 10_000, { jitter: 0.3, seed: display + cap });
      const { idx } = drive(lim, ts, display);
      const label = `${display}Hz에 ${cap}`;
      // 간격이 늘 같은 vsync 수 (예전: 90Hz에 60이면 1 · 2칸이 섞임)
      expect(new Set(gaps(idx)), label).toEqual(new Set([every]));
      expect(Math.abs(idx.length - ts.length / every), label).toBeLessThanOrEqual(1);
      expect(divisorFor(display, cap), label).toBe(every);
    }
  });

  it('약수 제한은 흔들림이 있어도 늘 n칸마다 (90 · 120 · 144 · 165 · 240Hz, 82.5 · 80 같은 소수 · 3칸 제한 포함)', () => {
    for (const [display, cap, every] of [
      [90, 45, 2],
      [120, 60, 2],
      [144, 72, 2],
      [144, 48, 3],
      [165, 82.5, 2],
      [165, 55, 3],
      [240, 120, 2],
      [240, 80, 3],
      [240, 60, 4],
    ] as const) {
      const lim = new FrameLimiter();
      lim.setCap(cap);
      const { idx } = drive(lim, ticks(display, 5000, { jitter: 0.3, seed: display * every }), display);
      expect(new Set(gaps(idx)), `${display}Hz에 ${cap}`).toEqual(new Set([every]));
    }
  });

  it('위상 고정: 그리기로 한 vsync를 놓쳐도 다음 vsync에 몰아 그리지 않는다 (예전 차례 시각 누적은 2 · 3 · 1 · 2칸)', () => {
    for (const [display, cap] of [
      [120, 60],
      [144, 72],
      [165, 82.5],
    ] as const) {
      const lim = new FrameLimiter();
      lim.setCap(cap);
      // 12번째로 그릴 vsync(22번째 tick)를 놓친다(무거운 프레임 — 그 vsync의 rAF가 오지 않음)
      const all = ticks(display, 2000, { jitter: 0.3, seed: 7 });
      const ts = all.filter((_t, i) => i !== 22);
      const { at } = drive(lim, ts, display);
      const v = 1000 / display;
      const steps = gaps(at).map((g) => Math.round(g / v));
      // 놓친 자리만 3칸, 나머지는 모두 2칸 (1칸으로 몰아 그리지 않는다)
      expect(
        steps.filter((n) => n === 1),
        `${display}Hz에 ${cap}`,
      ).toEqual([]);
      expect(steps.filter((n) => n === 3).length, `${display}Hz에 ${cap}`).toBe(1);
      expect(
        steps.every((n) => n === 2 || n === 3),
        `${display}Hz에 ${cap}`,
      ).toBe(true);
    }
  });

  it('화면 주사율을 조금 잘못 재도(± 25%) 약수 제한은 n칸마다', () => {
    for (const [real, measured, cap] of [
      [150, 144, 72],
      [138, 144, 72],
      [125, 120, 60],
    ] as const) {
      const lim = new FrameLimiter();
      lim.setCap(cap);
      const { idx } = drive(lim, ticks(real, 3000, { jitter: 0.3, seed: real }), measured);
      expect(new Set(gaps(idx)), `실제 ${real} · 잰 ${measured}`).toEqual(new Set([2]));
    }
  });

  it('멈춤 뒤 다시 맞추기: 250ms 넘는 공백 뒤 첫 tick은 바로 그리고, 짧은 멈춤(60ms) 뒤에도 몰아 그리지 않는다', () => {
    const lim = new FrameLimiter();
    lim.setCap(60);
    const before = ticks(120, 500, { t0: 0 });
    drive(lim, before, 120);
    const last = before[before.length - 1]!;
    // 짧은 멈춤: 60ms 뒤 tick부터 다시 120Hz
    const after = ticks(120, 500, { t0: last + 60 });
    const { idx } = drive(lim, after, 120);
    expect(idx[0]).toBe(0);
    // 몰아 그리기 없음: 멈춤 뒤에도 한 번 걸러 한 번
    expect(new Set(gaps(idx))).toEqual(new Set([2]));
    // 긴 공백(숨김 300ms): 차례가 아직이어도 공백 뒤 첫 tick은 그린다
    const lim2 = new FrameLimiter();
    lim2.setCap(60);
    expect(lim2.shouldRun(0, 120)).toBe(true);
    expect(lim2.shouldRun(8.3, 120)).toBe(false);
    expect(lim2.shouldRun(8.3 + LIMITER.resyncGapMs + 1, 120)).toBe(true);
    expect(lim2.shouldRun(8.3 + LIMITER.resyncGapMs + 9.3, 120)).toBe(false);
    expect(lim2.shouldRun(8.3 + LIMITER.resyncGapMs + 17.7, 120)).toBe(true);
  });

  it('시간이 거꾸로 가면 다시 센다 (그 tick은 그린다)', () => {
    const lim = new FrameLimiter();
    lim.setCap(60);
    expect(lim.shouldRun(1000, 120)).toBe(true);
    expect(lim.shouldRun(1008.3, 120)).toBe(false);
    expect(lim.shouldRun(500, 120)).toBe(true);
    expect(lim.shouldRun(508.3, 120)).toBe(false);
  });

  it('제한을 바꾸면 그 tick에 그리고 새 주기로 센다, 같은 값이면 그대로, 잘못된 값은 제한 없음', () => {
    const lim = new FrameLimiter();
    lim.setCap(60);
    expect(lim.shouldRun(0, 240)).toBe(true);
    expect(lim.shouldRun(4.17, 240)).toBe(false);
    lim.setCap(60);
    expect(lim.shouldRun(8.33, 240)).toBe(false);
    lim.setCap(30);
    expect(lim.capHz).toBe(30);
    expect(lim.shouldRun(12.5, 240)).toBe(true);
    expect(lim.shouldRun(29.2, 240)).toBe(false);
    expect(lim.shouldRun(45.8, 240)).toBe(true);
    for (const bad of [0, -60, Number.NaN, Infinity, null]) {
      lim.setCap(bad);
      expect(lim.capHz, String(bad)).toBeNull();
    }
    expect(lim.shouldRun(50, 240)).toBe(true);
    expect(lim.shouldRun(54.2, 240)).toBe(true);
  });
});

describe('목표 FPS (targetHzFor) · 제한기 제한 (capHzFor)', () => {
  it('목표는 늘 화면 주사율의 약수: 자동 = 화면(낮춤이 있으면 그에 가장 가까운 약수), 60 · 120 = 가장 가까운 약수, 절반 = 화면 / 2, 고정 제한은 낮춤을 쓰지 않는다', () => {
    const rows: [FrameLimit, number, number | null, number, number | null][] = [
      ['auto', 60, null, 60, null],
      ['auto', 120, null, 120, null],
      ['auto', 144, null, 144, null],
      ['auto', 120, 60, 60, 60],
      ['auto', 144, 72, 72, 72],
      ['auto', 165, 82.5, 82.5, 82.5],
      ['auto', 240, 80, 80, 80],
      ['auto', 60, 60, 60, null],
      // 판 중 화면 주사율이 오르면(120 → 144) 낮춘 60은 새 화면의 가장 가까운 약수 72
      ['auto', 144, 60, 72, 72],
      ['60', 60, null, 60, null],
      ['60', 120, null, 60, 60],
      ['60', 90, null, 45, 45],
      ['60', 75, null, 75, null],
      ['60', 100, null, 50, 50],
      ['60', 144, null, 72, 72],
      ['60', 165, null, 55, 55],
      ['60', 240, null, 60, 60],
      ['120', 60, null, 60, null],
      ['120', 120, null, 120, null],
      ['120', 144, null, 144, null],
      ['120', 165, null, 165, null],
      ['120', 240, null, 120, 120],
      ['120', 144, 60, 144, null],
      ['60', 120, 60, 60, 60],
      ['half', 60, null, 30, 30],
      ['half', 120, null, 60, 60],
      ['half', 144, null, 72, 72],
      ['half', 165, null, 82.5, 82.5],
      ['half', 240, null, 120, 120],
      ['half', 144, 48, 72, 72],
    ];
    for (const [limit, display, fb, target, cap] of rows) {
      const label = `${limit} · 화면 ${display} · fallback ${fb}`;
      expect(targetHzFor(limit, display, fb), label).toBe(target);
      expect(capHzFor(limit, display, fb), label).toBe(cap);
    }
  });
});

describe('고른 목표 사다리 (rateLadder · lowerRate · higherRate · divisorFor)', () => {
  it('사다리: 화면 / n 중 60 이상, 그런 약수가 화면뿐이면 45 이상인 절반 하나', () => {
    const rows: [number, number[]][] = [
      [60, [60]],
      [72, [72]],
      [75, [75]],
      [90, [90, 45]],
      [100, [100, 50]],
      [120, [120, 60]],
      [144, [144, 72]],
      [165, [165, 82.5]],
      [240, [240, 120, 80, 60]],
    ];
    for (const [hz, ladder] of rows) expect(rateLadder(hz), `${hz}Hz`).toEqual(ladder);
    expect(EVEN_RATE).toEqual({ ladderMinHz: 60, ladderFloorHz: 45 });
  });

  it('한 칸 아래 · 위, 느린 FPS를 주면 그 FPS 이하 가장 높은 칸까지 한 번에 (없으면 맨 아래)', () => {
    expect(lowerRate(120, 120)).toBe(60);
    expect(lowerRate(120, 60)).toBeNull();
    expect(lowerRate(144, 144)).toBe(72);
    expect(lowerRate(165, 165)).toBe(82.5);
    expect(lowerRate(240, 240)).toBe(120);
    expect(lowerRate(240, 240, 200)).toBe(120);
    expect(lowerRate(240, 240, 100)).toBe(80);
    expect(lowerRate(240, 240, 70)).toBe(60);
    expect(lowerRate(240, 240, 30)).toBe(60);
    expect(lowerRate(240, 120, 100)).toBe(80);
    expect(lowerRate(144, 144, 132)).toBe(72);
    expect(lowerRate(60, 60)).toBeNull();
    expect(lowerRate(75, 75)).toBeNull();
    expect(lowerRate(90, 90)).toBe(45);
    expect(higherRate(240, 60)).toBe(80);
    expect(higherRate(240, 80)).toBe(120);
    expect(higherRate(240, 120)).toBe(240);
    expect(higherRate(240, 240)).toBeNull();
    expect(higherRate(144, 72)).toBe(144);
  });

  it('divisorFor: round(화면 / 원하는 값), 1 이상, 잘못된 값은 1', () => {
    expect(divisorFor(144, 60)).toBe(2);
    expect(divisorFor(165, 60)).toBe(3);
    expect(divisorFor(90, 60)).toBe(2);
    expect(divisorFor(75, 60)).toBe(1);
    expect(divisorFor(240, 80)).toBe(3);
    expect(divisorFor(60, 120)).toBe(1);
    for (const bad of [0, -1, Number.NaN, Infinity]) expect(divisorFor(144, bad)).toBe(1);
    expect(divisorFor(0, 60)).toBe(1);
  });
});

describe('Pacer (주사율 재기 + 제한기 + 판 없음 30fps)', () => {
  /** pacer에 rAF 시각들을 넣고 그린 수 */
  const feed = (p: Pacer, ts: readonly number[]): number => ts.filter((t) => p.onTick(t)).length;

  it('판 중에는 화면 주사율을 낮추지 않는다: 판 시작 때 120이면 rAF가 60 간격으로 밀려도 120 · 60 제한은 그대로, 판 밖에서 다시 잰다', () => {
    const p = new Pacer('60');
    feed(p, ticks(120, 1500, { t0: 0, jitter: 0.3 }));
    p.setIdle(false);
    expect([p.displayHz, p.capHz]).toEqual([120, 60]);
    // 판 중: 모든 rAF가 16.7ms 간격(게임이 바빠 vsync를 놓침) — 재는 값은 60으로 내려가도 붙잡은 120을 쓴다
    feed(p, ticks(60, 4000, { t0: 1500, jitter: 0.3 }));
    expect(p.estimator.hz).toBe(60);
    expect([p.displayHz, p.targetHz, p.capHz]).toEqual([120, 60, 60]);
    // 판 밖으로 나가면 잰 값을 그대로 쓴다
    p.setIdle(true);
    expect(p.displayHz).toBe(60);
  });

  it('판 중에도 더 높게 재면 올린다 (부팅 직후 60으로 시작한 판에서 120Hz를 재면 120)', () => {
    const p = new Pacer();
    p.setIdle(false);
    expect(p.displayHz).toBe(60);
    feed(p, ticks(120, 1500, { t0: 0, jitter: 0.3 }));
    expect([p.displayHz, p.targetHz]).toEqual([120, 120]);
  });

  it('자동: 120Hz 화면을 재면 목표 120 · 제한 없음 · 모든 rAF', () => {
    const p = new Pacer();
    const ts = ticks(120, 2000, { jitter: 0.3 });
    expect(feed(p, ts)).toBe(ts.length);
    expect([p.limit, p.displayHz, p.targetHz, p.capHz, p.skipped]).toEqual(['auto', 120, 120, null, 0]);
  });

  it('60 제한 · 120Hz 화면: 잰 뒤 1초에 60번, 건너뛴 수 = skipped = onSkip 수, 고른 제한을 바꾸면 바로 따른다', () => {
    const p = new Pacer('60');
    let skips = 0;
    p.onSkip = () => (skips += 1);
    feed(p, ticks(120, 1000, { t0: 0, jitter: 0.3 }));
    expect([p.displayHz, p.targetHz, p.capHz]).toEqual([120, 60, 60]);
    const ts = ticks(120, 1000, { t0: 1000, jitter: 0.3, seed: 2 });
    expect(feed(p, ts)).toBe(60);
    expect(p.skipped).toBe(skips);
    expect(skips).toBeGreaterThanOrEqual(60);
    p.setLimit('120');
    expect([p.limit, p.targetHz, p.capHz]).toEqual(['120', 120, null]);
    expect(feed(p, ticks(120, 1000, { t0: 2000, jitter: 0.3, seed: 3 }))).toBe(120);
  });

  it('PC 모니터: 120 제한 · 144Hz는 제한 없음(144), 60 · 절반 · 144Hz는 고른 72, 절반 · 165Hz는 82.5', () => {
    for (const [limit, display, target] of [
      ['120', 144, 144],
      ['60', 144, 72],
      ['half', 144, 72],
      ['half', 165, 82.5],
      ['60', 165, 55],
    ] as const) {
      const p = new Pacer(limit);
      const label = `${limit} · ${display}Hz`;
      feed(p, ticks(display, 1000, { t0: 0, jitter: 0.3 }));
      expect([p.displayHz, p.targetHz], label).toEqual([display, target]);
      const ts = ticks(display, 5000, { t0: 1000, jitter: 0.3, seed: 5 });
      const n = feed(p, ts);
      expect(Math.abs(n - target * 5), label).toBeLessThanOrEqual(1);
    }
  });

  it('fallback: 자동에서 60으로 내리고 되돌린다, 고정 제한(120)에는 쓰지 않는다, 잘못된 값은 null', () => {
    const p = new Pacer();
    feed(p, ticks(120, 1000, { t0: 0 }));
    p.setFallback(60);
    expect([p.fallbackHz, p.targetHz, p.capHz]).toEqual([60, 60, 60]);
    expect(feed(p, ticks(120, 1000, { t0: 1000 }))).toBe(60);
    p.setLimit('120');
    expect([p.targetHz, p.capHz]).toEqual([120, null]);
    p.setLimit('auto');
    p.setFallback(null);
    expect([p.fallbackHz, p.targetHz, p.capHz]).toEqual([null, 120, null]);
    for (const bad of [0, -1, Number.NaN]) {
      p.setFallback(bad);
      expect(p.fallbackHz).toBeNull();
    }
  });

  it('판 없음(setIdle): 제한 설정과 상관없이 30fps, 주사율 재기는 모든 rAF를 보고, 목표 FPS(판)는 그대로, 판이 시작하면 바로 그린다', () => {
    for (const [limit, display] of [
      ['auto', 120],
      ['auto', 60],
      ['60', 120],
      ['120', 144],
    ] as const) {
      const p = new Pacer(limit);
      const label = `${limit} · ${display}Hz`;
      p.setIdle(true);
      expect(p.idle).toBe(true);
      const ts = ticks(display, 3000, { t0: 0, jitter: 0.3, seed: display });
      const n = feed(p, ts);
      // 처음(아직 60으로 보는 동안)부터 차례 시각이 30Hz라 3초에 90번 안팎
      expect(n, label).toBeGreaterThanOrEqual(89);
      expect(n, label).toBeLessThanOrEqual(91);
      expect(p.capHz, label).toBe(display / divisorFor(display, IDLE_CAP_HZ));
      // 건너뛴 tick도 쟀다: 실제 화면 주사율
      expect(p.estimator.sampleCount, label).toBe(Math.min(REFRESH.samples, ts.length - 1));
      expect(p.displayHz, label).toBe(display);
      expect(p.targetHz, label).toBe(targetHzFor(limit, display, null));
      // 판 시작: 다음 tick을 바로 그리고 제한 설정대로
      p.setIdle(false);
      const after = ticks(display, 1000, { t0: 3000 + 1000 / display, seed: display + 1 });
      expect(p.onTick(after[0]!), label).toBe(true);
      const m = 1 + feed(p, after.slice(1));
      expect(m, label).toBeGreaterThanOrEqual(p.targetHz - 1);
      expect(m, label).toBeLessThanOrEqual(p.targetHz + 1);
    }
  });
});

describe('Phaser TimeStep.step 감싸기 (patchTimeStep)', () => {
  class FakeStep {
    calls: { self: FakeStep; time: number }[] = [];
    step(time: number): void {
      this.calls.push({ self: this, time });
    }
  }

  it('pacer가 그리라고 할 때만 원래 step을 부르고 this를 그대로 넘긴다, 다시 끼워도 겹겹이 감싸지 않는다, 되돌리면 원래 함수', () => {
    const proto = FakeStep.prototype;
    const original = proto.step;
    const p1 = new Pacer('60');
    patchTimeStep(proto, p1);
    const a = new FakeStep();
    const b = new FakeStep();
    // 120Hz를 잰 뒤(앞의 0.5초) 한 번 걸러 한 번
    const ts = ticks(120, 1500, { t0: 0 });
    for (const t of ts) a.step(t);
    expect(a.calls.every((c) => c.self === a)).toBe(true);
    const late = a.calls.filter((c) => c.time >= 1000);
    expect(late.length).toBe(30);
    expect(p1.skipped).toBeGreaterThan(0);
    // 다시 끼우기: 새 pacer 하나만 tick마다 한 번 (예전 pacer는 더 불리지 않는다)
    const p2 = new Pacer('auto');
    let ticksSeen = 0;
    const onTick = p2.onTick.bind(p2);
    p2.onTick = (t: number) => {
      ticksSeen += 1;
      return onTick(t);
    };
    const skippedBefore = p1.skipped;
    patchTimeStep(proto, p2);
    for (const t of ticks(120, 100, { t0: 5000 })) b.step(t);
    expect(ticksSeen).toBe(12);
    expect(b.calls.length).toBe(12);
    expect(b.calls.every((c) => c.self === b)).toBe(true);
    expect(p1.skipped).toBe(skippedBefore);
    unpatchTimeStep(proto);
    expect(proto.step).toBe(original);
    unpatchTimeStep(proto);
    expect(proto.step).toBe(original);
  });

  it('framePacing.ts는 Phaser를 import하지 않는다 (순수 로직, main.ts가 끼운다)', () => {
    const src = readFileSync('client/src/gfx/framePacing.ts', 'utf8');
    expect(src).not.toMatch(/from ['"]phaser['"]/);
  });
});
