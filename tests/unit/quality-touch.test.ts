// M12 성능: 터치 기기 품질 자동 선택 · 판 중 하향 기준(50fps) · 온라인/연습 따로 기억 · 터치 낮음 해상도 하한
// 렌더링 최적화: 목표 FPS에 비례한 터치 기준(5/6) · 120Hz 휴대폰의 목표 FPS 낮춤 · 기억 2판(시작 목표 FPS)
import { describe, expect, it } from 'vitest';
import { PRESETS, TOUCH_LOW_OVERRIDE, effectivePreset, type QualityTier } from '../../client/src/gfx/presets';
import {
  AutoDowngrade,
  DOWNGRADE_CHECK,
  FPS_WATCH,
  PERF_MEMORY_VERSION,
  TOUCH_FPS_WATCH,
  autoQuality,
  detectQuality,
  forgetPerfMemory,
  fpsWatchFor,
  loadPerfMemory,
  lowestTier,
  parsePerfMemory,
  perfToRemember,
  rememberPerf,
  type AdaptContext,
  type AutoQualityAction,
  type PerfMode,
  type QualityEnv,
  type StorageLike,
} from '../../client/src/gfx/quality';
import { computeRenderSize, presetScaleCap } from '../../client/src/render/resolution';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import { AdaptiveSession, injected, kinds, roomy } from '../helpers/adaptiveSession';

/** 60Hz 화면 · 목표 60 (렌더링 최적화 전과 같은 조건) */
const AT_60: AdaptContext = { targetHz: 60, displayHz: 60, canRateFallback: false };

const PHONE: QualityEnv = {
  url: null,
  saved: null,
  renderer: 'webgl',
  softwareGl: false,
  touch: true,
  cores: 8,
  memory: 4,
};

const PERF_KEY = STORAGE_KEYS.perf.key;

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

/** 세션 하나: 판을 이어서 돌리며 자동 조정을 적용한다 (main.ts qualityHooks.auto와 같은 규칙) */
class Session {
  readonly kinds: AutoQualityAction[] = [];
  private t = 0;

  constructor(
    public tier: QualityTier,
    readonly auto: AutoDowngrade,
  ) {}

  play(ms: number, fps: (tier: QualityTier) => number, mode?: PerfMode): AutoQualityAction[] {
    const start = this.t;
    const out: AutoQualityAction[] = [];
    this.auto.beginMatch(start, mode);
    for (; this.t < start + ms; this.t += 1000 / 60) {
      const a = this.auto.sample(this.t, injected(fps(this.tier)), this.tier, AT_60);
      if (!a) continue;
      out.push(a);
      if ((a.kind === 'downgrade' || a.kind === 'revert') && this.tier === a.from) this.tier = a.to;
    }
    this.auto.endMatch();
    this.t += 20_000;
    this.kinds.push(...out);
    return out;
  }
}

describe('터치 기기 판 중 하향 기준 (목표: 중간 50fps · 낮음 30fps)', () => {
  it('기준 FPS: 터치 50 · PC 40 그대로, 예열 · 지속 · 구간은 같다', () => {
    expect(TOUCH_FPS_WATCH.minFps).toBe(50);
    expect(FPS_WATCH.minFps).toBe(40);
    expect(fpsWatchFor(true)).toBe(TOUCH_FPS_WATCH);
    expect(fpsWatchFor(false)).toBe(FPS_WATCH);
    for (const k of ['warmupMs', 'sustainMs', 'windowMs', 'gapMs'] as const)
      expect(TOUCH_FPS_WATCH[k]).toBe(FPS_WATCH[k]);
  });

  it('평균 45fps: 터치는 중간 → 낮음 한 단계, PC 기준(40)으로는 그대로', () => {
    const touch = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    const down = touch.play(20_000, () => 45);
    expect(down.map((a) => a.kind)).toEqual(['downgrade']);
    expect(down[0]).toMatchObject({ kind: 'downgrade', mode: 'online', from: 'medium', to: 'low' });
    expect(touch.tier).toBe('low');

    const pc = new Session('medium', new AutoDowngrade(FPS_WATCH));
    expect(pc.play(60_000, () => 45)).toEqual([]);
    expect(pc.tier).toBe('medium');
  });

  it('평균 52fps(목표 이상)이면 터치도 내리지 않는다', () => {
    const s = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    expect(s.play(60_000, () => 52)).toEqual([]);
    expect(s.tier).toBe('medium');
  });

  it('하향 시점: 예열 5초 + 기준 미만 10초 뒤 (PC와 같은 시간 규칙)', () => {
    const auto = new AutoDowngrade(TOUCH_FPS_WATCH);
    auto.beginMatch(0);
    let at = -1;
    for (let t = 0; t < 30_000 && at < 0; t += 1000 / 60)
      if (auto.sample(t, injected(45), 'medium', AT_60)) at = t;
    expect(at).toBeGreaterThan(TOUCH_FPS_WATCH.warmupMs + TOUCH_FPS_WATCH.sustainMs);
    expect(at).toBeLessThan(TOUCH_FPS_WATCH.warmupMs + TOUCH_FPS_WATCH.sustainMs + 1200);
  });

  it('30Hz로 묶인 휴대폰(절전): 내려도 오르지 않으면 되돌리고 그 세션에서는 끈다', () => {
    const s = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    expect(s.play(60_000, () => 30).map((a) => a.kind)).toEqual(['downgrade', 'revert']);
    expect(s.tier).toBe('medium');
    expect(s.auto.status).toBe('off');
    expect(s.play(60_000, () => 30)).toEqual([]);
  });

  it('하향 뒤 FPS가 오르면 유지(keep) — 기억할 결과', () => {
    const s = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    const acts = s.play(60_000, (tier) => (tier === 'medium' ? 42 : 58));
    expect(acts.map((a) => a.kind)).toEqual(['downgrade', 'keep']);
    expect(acts[1]).toMatchObject({ kind: 'keep', mode: 'online', tier: 'low' });
    expect(s.tier).toBe('low');
  });

  it('기준은 setWatchConfig로 바꾸고 다음 판부터 쓴다', () => {
    const auto = new AutoDowngrade();
    expect(auto.config.minFps).toBe(40);
    auto.setWatchConfig(TOUCH_FPS_WATCH);
    expect(auto.config.minFps).toBe(50);
    const s = new Session('high', auto);
    expect(s.play(20_000, () => 47).map((a) => a.kind)).toEqual(['downgrade']);
  });
});

describe('판 모드 (온라인 · 연습)', () => {
  it('결정에 판의 모드가 실린다 (기본 온라인)', () => {
    const s = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    expect(s.play(16_000, () => 40, 'practice')[0]).toMatchObject({ kind: 'downgrade', mode: 'practice' });
    const t = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    expect(t.play(16_000, () => 40)[0]?.mode).toBe('online');
  });

  it('확인 중이던 하향은 같은 모드의 다음 판에서만 이어서 확인한다 (다른 모드 판으로 넘어가면 잊는다)', () => {
    const same = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    expect(same.play(16_000, () => 40, 'online').map((a) => a.kind)).toEqual(['downgrade']);
    expect(same.auto.status).toBe('checking');
    expect(same.play(60_000, () => 40, 'online').map((a) => a.kind)).toEqual(['revert']);

    const other = new Session('medium', new AutoDowngrade(TOUCH_FPS_WATCH));
    expect(other.play(16_000, () => 40, 'online').map((a) => a.kind)).toEqual(['downgrade']);
    // 연습 판: 온라인 판에서 내린 것의 확인을 이어 가지 않는다(부하가 다르다). 낮음이라 더 내릴 것도 없다
    expect(other.play(60_000, () => 40, 'practice')).toEqual([]);
    expect(other.auto.status).toBe('on');
    expect(other.tier).toBe('low');
  });
});

describe('판 중 측정 기억 (decoy:perf, 온라인 · 연습 따로)', () => {
  it('키는 저장 키 목록의 perf', () => {
    expect(PERF_KEY).toBe('decoy:perf');
    expect(STORAGE_KEYS.perf.area).toBe('local');
  });

  it('모드마다 따로 쓰고 읽는다 (다른 모드 기억은 그대로)', () => {
    const s = memStorage();
    expect(loadPerfMemory(s)).toEqual({});
    expect(rememberPerf('online', { tier: 'low', base: 'medium', hz: 60 }, s)).toBe(true);
    expect(rememberPerf('practice', { tier: 'medium', base: 'high', hz: 60 }, s)).toBe(true);
    expect(loadPerfMemory(s)).toEqual({
      online: { tier: 'low', base: 'medium', hz: 60 },
      practice: { tier: 'medium', base: 'high', hz: 60 },
    });
    expect(JSON.parse(s.data.get(PERF_KEY) ?? 'null')).toMatchObject({ v: PERF_MEMORY_VERSION });
    expect(rememberPerf('online', { tier: 'medium', base: 'high', hz: 60 }, s)).toBe(true);
    expect(loadPerfMemory(s).practice).toEqual({ tier: 'medium', base: 'high', hz: 60 });
    expect(loadPerfMemory(s).online).toEqual({ tier: 'medium', base: 'high', hz: 60 });
  });

  it('사용자가 품질을 고르면 모두 지운다', () => {
    const s = memStorage();
    rememberPerf('online', { tier: 'low', base: 'medium', hz: 60 }, s);
    rememberPerf('practice', { tier: 'low', base: 'medium', hz: 60 }, s);
    expect(forgetPerfMemory(s)).toBe(true);
    expect(s.data.has(PERF_KEY)).toBe(false);
    expect(loadPerfMemory(s)).toEqual({});
  });

  it('깨진 값 · 모르는 판 · 이상한 단계는 버린다', () => {
    expect(parsePerfMemory(null)).toEqual({});
    expect(parsePerfMemory('{')).toEqual({});
    expect(parsePerfMemory('"low"')).toEqual({});
    expect(parsePerfMemory(JSON.stringify({ v: 99, online: { tier: 'low', base: 'medium' } }))).toEqual({});
    expect(
      parsePerfMemory(
        JSON.stringify({
          v: PERF_MEMORY_VERSION,
          online: { tier: 'ultra', base: 'medium' },
          practice: { tier: 'low', base: 'x' },
        }),
      ),
    ).toEqual({});
    expect(
      parsePerfMemory(
        JSON.stringify({
          v: PERF_MEMORY_VERSION,
          online: { tier: 'low', base: 'medium' },
          other: { tier: 'low' },
        }),
      ),
    ).toEqual({ online: { tier: 'low', base: 'medium', hz: 60 } });
    // 이상한 시작 목표 FPS는 그 줄만 버린다
    expect(
      parsePerfMemory(
        JSON.stringify({
          v: PERF_MEMORY_VERSION,
          online: { tier: 'low', base: 'medium', hz: 'fast' },
          practice: { tier: 'low', base: 'medium', hz: -60 },
        }),
      ),
    ).toEqual({});
  });

  it('저장소를 못 쓰면 예외 없이 기억 없음', () => {
    expect(loadPerfMemory(brokenStorage)).toEqual({});
    expect(rememberPerf('online', { tier: 'low', base: 'medium', hz: 60 }, brokenStorage)).toBe(false);
    expect(forgetPerfMemory(brokenStorage)).toBe(false);
    expect(loadPerfMemory(null)).toEqual({});
    expect(rememberPerf('online', { tier: 'low', base: 'medium', hz: 60 }, null)).toBe(false);
  });

  it('기억할 결과: 터치 · 자동 · 효과를 확인한 하향(keep)만', () => {
    const keep: AutoQualityAction = {
      kind: 'keep',
      mode: 'online',
      tier: 'low',
      fpsBefore: 40,
      fpsAfter: 58,
    };
    expect(perfToRemember(keep, true, 'auto', 'medium')).toEqual({
      mode: 'online',
      rec: { tier: 'low', base: 'medium', hz: 60 },
    });
    expect(perfToRemember({ ...keep, mode: 'practice' }, true, 'auto', 'medium')?.mode).toBe('practice');
    // PC는 M10 그대로 세션 단위
    expect(perfToRemember(keep, false, 'auto', 'high')).toBeNull();
    // 사용자가 고른 단계 · 주소의 ?quality는 기억하지 않는다
    expect(perfToRemember(keep, true, 'saved', 'medium')).toBeNull();
    expect(perfToRemember(keep, true, 'url', 'medium')).toBeNull();
    // 하향 직후(확인 전) · 효과가 없어 되돌린 하향은 기억하지 않는다
    const down: AutoQualityAction = {
      kind: 'downgrade',
      mode: 'online',
      from: 'medium',
      to: 'low',
      fpsBefore: 40,
    };
    const revert: AutoQualityAction = {
      kind: 'revert',
      mode: 'online',
      from: 'low',
      to: 'medium',
      fpsBefore: 30,
      fpsAfter: 30,
    };
    expect(perfToRemember(down, true, 'auto', 'medium')).toBeNull();
    expect(perfToRemember(revert, true, 'auto', 'medium')).toBeNull();
  });
});

describe('시작 단계: 터치 기기 자동 선택 + 기억', () => {
  it('터치 기기 자동: 중간, 코어 4개 이하 또는 메모리 3GB 이하면 낮음 (Canvas · 소프트웨어 GL은 낮음)', () => {
    expect(autoQuality(PHONE)).toBe('medium');
    expect(autoQuality({ ...PHONE, memory: 2 })).toBe('low');
    expect(autoQuality({ ...PHONE, cores: 4 })).toBe('low');
    expect(autoQuality({ ...PHONE, softwareGl: true })).toBe('low');
    expect(autoQuality({ ...PHONE, renderer: 'canvas' })).toBe('low');
  });

  it('기억한 단계가 자동보다 낮으면 그것으로 시작한다 (출처는 자동)', () => {
    expect(detectQuality({ ...PHONE, perf: { tier: 'low', base: 'medium', hz: 60 } })).toEqual({
      tier: 'low',
      source: 'auto',
    });
    expect(detectQuality({ ...PHONE, perf: null })).toEqual({ tier: 'medium', source: 'auto' });
  });

  it('기억은 낮추기만 한다: 자동보다 높은 기억은 쓰지 않는다', () => {
    expect(detectQuality({ ...PHONE, perf: { tier: 'high', base: 'medium', hz: 60 } }).tier).toBe('medium');
  });

  it('그때의 자동 단계(base)가 지금과 다르면 옛 측정이라 쓰지 않는다', () => {
    // 그때는 하드웨어 WebGL(자동 중간)이었는데 지금은 Canvas(자동 낮음) → 지금 자동 그대로
    expect(
      detectQuality({ ...PHONE, renderer: 'canvas', perf: { tier: 'low', base: 'medium', hz: 60 } }),
    ).toEqual({
      tier: 'low',
      source: 'auto',
    });
    // 그때는 저사양 판단(자동 낮음)이었는데 지금은 중간 → 기억(낮음)을 쓰지 않는다
    expect(detectQuality({ ...PHONE, perf: { tier: 'low', base: 'low', hz: 60 } }).tier).toBe('medium');
  });

  it('?quality · 로비에서 고른 값이 기억보다 우선', () => {
    const perf = { tier: 'low', base: 'medium', hz: 60 } as const;
    expect(detectQuality({ ...PHONE, url: 'high', perf })).toEqual({ tier: 'high', source: 'url' });
    expect(detectQuality({ ...PHONE, saved: 'medium', perf })).toEqual({ tier: 'medium', source: 'saved' });
  });

  it('lowestTier', () => {
    expect(lowestTier('high', 'low')).toBe('low');
    expect(lowestTier('low', 'medium')).toBe('low');
    expect(lowestTier('medium', 'high')).toBe('medium');
    expect(lowestTier('high', 'high')).toBe('high');
  });
});

describe('터치 낮음 해상도: 배율 1.25, 백버퍼 높이 하한 450 (중간 상한 1.5까지)', () => {
  const touchLow = effectivePreset('low', 'webgl', true);
  const touchMedium = effectivePreset('medium', 'webgl', true);
  /** PC 배치(1920×1080) 기준 휴대폰 화면 */
  const size = (w: number, h: number, dpr: number, preset = touchLow) =>
    computeRenderSize({ cssW: w, cssH: h, dpr, logicalW: 1920, logicalH: 1080, preset, scaleOverride: null });

  it('값', () => {
    expect(TOUCH_LOW_OVERRIDE).toEqual({
      dprCap: 1.25,
      maxPixels: 1_200_000,
      minBackingH: 450,
      floorDprCap: 1.5,
    });
    expect(touchLow.dprCap).toBe(1.25);
    expect(touchLow.minBackingH).toBe(450);
    // PC 낮음 · 터치 중간 · 높음은 하한 없음
    for (const p of [PRESETS.low, PRESETS.medium, PRESETS.high, touchMedium]) expect(p.minBackingH).toBe(0);
    expect(effectivePreset('low', 'canvas', true).minBackingH).toBe(450);
  });

  it('흔한 휴대폰(높이 360 · 412)은 1.25배: 중간보다 픽셀이 약 30% 적다', () => {
    for (const [w, h, dpr] of [
      [800, 360, 2],
      [732, 412, 2.625],
      [844, 390, 3],
    ] as const) {
      const low = size(w, h, dpr);
      const med = size(w, h, dpr, touchMedium);
      expect(low.k).toBeCloseTo(1.25, 6);
      expect(low.backingH).toBeGreaterThanOrEqual(450);
      expect(med.k).toBeCloseTo(1.5, 6);
      const ratio = (low.backingW * low.backingH) / (med.backingW * med.backingH);
      expect(ratio).toBeGreaterThan(0.65);
      expect(ratio).toBeLessThan(0.72);
    }
  });

  it('낮은 화면(높이 293 · 320)은 하한 450 때문에 배율이 올라가되 중간(1.5)을 넘지 않는다', () => {
    const s9 = size(658, 320, 4.5);
    expect(s9.k).toBeCloseTo(450 / 320, 6);
    expect(s9.backingH).toBe(450);
    const p5 = size(802, 293, 2.75);
    expect(p5.k).toBe(1.5);
    expect(p5.backingH).toBeLessThan(450);
    expect(p5.backingH).toBe(size(802, 293, 2.75, touchMedium).backingH);
  });

  it('하한도 기기 픽셀 배율 · 픽셀 수 상한을 넘지 않는다', () => {
    // 배율 1 화면: 하한 때문에 기기보다 크게 만들지 않는다
    expect(size(800, 300, 1).k).toBe(1);
    // 큰 태블릿: 1.2MP 상한
    const tab = size(1280, 800, 2);
    expect(tab.backingW * tab.backingH).toBeLessThanOrEqual(1_200_000 + 2000);
  });

  it('presetScaleCap: 하한이 없으면 dprCap 그대로', () => {
    expect(presetScaleCap(PRESETS.medium, 300)).toBe(1.5);
    expect(presetScaleCap(touchLow, 400)).toBe(1.25);
    expect(presetScaleCap(touchLow, 320)).toBeCloseTo(450 / 320, 9);
    expect(presetScaleCap(touchLow, 200)).toBe(1.5);
    expect(presetScaleCap(touchLow, 0)).toBe(1.25);
  });
});

describe('PC는 M10 그대로', () => {
  it('PC 판 중 하향 기준 40fps · 예열 5초 · 10초', () => {
    expect(FPS_WATCH).toEqual({ warmupMs: 5000, minFps: 40, sustainMs: 10000, windowMs: 1000, gapMs: 1000 });
    expect(DOWNGRADE_CHECK).toEqual({ settleMs: 3000, measureMs: 10000, minGainRatio: 0.15, minGainFps: 5 });
  });

  it('PC 자동 선택은 기억을 받지 않으면 그대로 (main.ts는 PC에 기억을 넘기지 않는다)', () => {
    const pc: QualityEnv = { ...PHONE, touch: false };
    expect(detectQuality(pc)).toEqual({ tier: 'high', source: 'auto' });
  });

  it('PC 낮음 · 중간 · 높음 해상도 값', () => {
    expect([PRESETS.low.dprCap, PRESETS.medium.dprCap, PRESETS.high.dprCap]).toEqual([1, 1.5, 2]);
    expect(effectivePreset('low', 'webgl', false).dprCap).toBe(1);
  });
});

describe('렌더링 최적화: 터치 기준은 기준 목표의 5/6', () => {
  it('120 고정 제한 · 120Hz 휴대폰: 평균 95fps면 한 단계(100 미만), 105fps면 그대로', () => {
    const slow = new AdaptiveSession('medium', new AutoDowngrade(TOUCH_FPS_WATCH), '120', 120);
    expect(kinds(slow.play(20_000, () => injected(95)))).toEqual(['downgrade']);
    expect([slow.tier, slow.targetHz]).toEqual(['low', 120]);
    const ok = new AdaptiveSession('medium', new AutoDowngrade(TOUCH_FPS_WATCH), '120', 120);
    expect(ok.play(60_000, () => injected(105))).toEqual([]);
    expect(ok.auto.minFps).toBe(100);
  });

  it('자동 제한 · 120Hz 휴대폰: 90fps면 먼저 목표 60(품질 그대로), 60에서 45fps면 중간 → 낮음', () => {
    const s = new AdaptiveSession('medium', new AutoDowngrade(TOUCH_FPS_WATCH), 'auto', 120);
    const acts = s.play(40_000, (_tier, hz) => injected(hz > 60 ? 90 : 45));
    expect(acts.map((l) => l.action)).toEqual([
      { kind: 'rateDown', mode: 'online', from: 120, to: 60, fpsBefore: 90 },
      { kind: 'downgrade', mode: 'online', from: 'medium', to: 'low', fpsBefore: 45 },
    ]);
    expect([s.tier, s.targetHz]).toEqual(['low', 60]);
  });

  it('60Hz 휴대폰은 M12 그대로 50 (목표 FPS를 바꿀 것이 없다)', () => {
    const s = new AdaptiveSession('medium', new AutoDowngrade(TOUCH_FPS_WATCH), 'auto', 60);
    expect(s.play(60_000, () => injected(52))).toEqual([]);
    expect(kinds(s.play(20_000, () => injected(45)))).toEqual(['downgrade']);
    expect(s.fallback).toBeNull();
  });

  it('올린 뒤 확인을 통과한 품질(upKeep)은 기억할 결과다: 다음 접속이 내린 단계에 묶이지 않는다', () => {
    const s = new AdaptiveSession('medium', new AutoDowngrade(TOUCH_FPS_WATCH), 'auto', 60);
    expect(kinds(s.play(60_000, (t, hz, e) => (e < 20_000 ? injected(40) : roomy()(t, hz, e))))).toEqual([
      'downgrade',
      'keep',
    ]);
    const up = s.play(30_000, roomy());
    expect(kinds(up)).toEqual(['upgrade', 'upKeep']);
    const kept = up[1]!.action;
    expect(perfToRemember(kept, true, 'auto', 'medium')).toEqual({
      mode: 'online',
      rec: { tier: 'medium', base: 'medium', hz: 60 },
    });
  });
});

describe('렌더링 최적화: 판 중 측정 기억 2판 (시작 목표 FPS)', () => {
  it('저장 형식 2판: 1판 값(어느 목표에서 쟀는지 모름)은 버린다', () => {
    expect(PERF_MEMORY_VERSION).toBe(2);
    expect(parsePerfMemory(JSON.stringify({ v: 1, online: { tier: 'low', base: 'medium' } }))).toEqual({});
  });

  it('시작 목표 FPS를 함께 기억한다: 60이면 적지 않고(M12 모양 그대로), 다른 목표는 hz로', () => {
    const s = memStorage();
    expect(rememberPerf('online', { tier: 'low', base: 'medium', hz: 60 }, s)).toBe(true);
    // m12-perf.webgl E2E가 그대로 단언하는 모양
    expect(JSON.parse(s.data.get(PERF_KEY) ?? 'null')).toEqual({
      v: PERF_MEMORY_VERSION,
      online: { tier: 'low', base: 'medium' },
    });
    expect(rememberPerf('practice', { tier: 'medium', base: 'high', hz: 120 }, s)).toBe(true);
    expect(JSON.parse(s.data.get(PERF_KEY) ?? 'null')).toEqual({
      v: PERF_MEMORY_VERSION,
      online: { tier: 'low', base: 'medium' },
      practice: { tier: 'medium', base: 'high', hz: 120 },
    });
    expect(loadPerfMemory(s)).toEqual({
      online: { tier: 'low', base: 'medium', hz: 60 },
      practice: { tier: 'medium', base: 'high', hz: 120 },
    });
  });

  it('기억은 시작 목표 FPS가 같을 때만 쓴다 (없으면 60으로 본다)', () => {
    const at120 = { tier: 'low', base: 'medium', hz: 120 } as const;
    expect(detectQuality({ ...PHONE, perf: at120, targetHz: 120 }).tier).toBe('low');
    expect(detectQuality({ ...PHONE, perf: at120, targetHz: 60 }).tier).toBe('medium');
    expect(detectQuality({ ...PHONE, perf: at120 }).tier).toBe('medium');
    const at60 = { tier: 'low', base: 'medium', hz: 60 } as const;
    expect(detectQuality({ ...PHONE, perf: at60 }).tier).toBe('low');
    expect(detectQuality({ ...PHONE, perf: at60, targetHz: 120 }).tier).toBe('medium');
  });

  it('perfToRemember는 시작 목표 FPS를 싣는다. 목표 FPS 낮춤 · 올림 · 확인 전 단계는 기억하지 않는다', () => {
    const keep: AutoQualityAction = {
      kind: 'keep',
      mode: 'online',
      tier: 'low',
      fpsBefore: 90,
      fpsAfter: 118,
    };
    expect(perfToRemember(keep, true, 'auto', 'medium', 120)?.rec).toEqual({
      tier: 'low',
      base: 'medium',
      hz: 120,
    });
    expect(perfToRemember(keep, true, 'auto', 'medium')?.rec.hz).toBe(60);
    const none: AutoQualityAction[] = [
      { kind: 'rateDown', mode: 'online', from: 120, to: 60, fpsBefore: 70 },
      { kind: 'rateUp', mode: 'online', from: 60, to: 120, fps: 60, workP95: 3 },
      { kind: 'upgrade', mode: 'online', from: 'low', to: 'medium', fps: 60, workP95: 3 },
      { kind: 'upKeep', mode: 'online', step: 'rate', hz: 120, fpsAfter: 118 },
      { kind: 'upRevert', mode: 'online', step: 'tier', from: 'medium', to: 'low', fpsAfter: 40 },
      { kind: 'upRevert', mode: 'online', step: 'rate', from: 120, to: 60, fpsAfter: 70 },
    ];
    for (const a of none) expect(perfToRemember(a, true, 'auto', 'medium', 120)).toBeNull();
    // 터치 · 자동만 (PC · 고른 단계 · ?quality는 기억하지 않는다)
    const upKeep: AutoQualityAction = {
      kind: 'upKeep',
      mode: 'online',
      step: 'tier',
      tier: 'medium',
      fpsAfter: 58,
    };
    expect(perfToRemember(upKeep, false, 'auto', 'medium')).toBeNull();
    expect(perfToRemember(upKeep, true, 'saved', 'medium')).toBeNull();
    expect(perfToRemember(upKeep, true, 'url', 'medium')).toBeNull();
  });
});
