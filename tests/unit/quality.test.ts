// 그래픽 품질 자동 선택 · 저장 · 판 중 FPS 감시 (M10a) · 목표 FPS에 맞춘 적응형 품질 (렌더링 최적화)
import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../../client/src/gfx/presets';
import {
  AutoDowngrade,
  BASE_TARGET_HZ,
  DOWNGRADE_CHECK,
  DowngradeCheck,
  FPS_WATCH,
  FpsWatch,
  QUALITY_STORAGE_KEY,
  RATE_FALLBACK_HZ,
  SAMPLE_RING_SIZE,
  SlidingAverage,
  THRESHOLD_CAP_HZ,
  TOUCH_FPS_WATCH,
  UP_PROBATION,
  UP_WATCH,
  UpProbation,
  UpWatch,
  detectQuality,
  downgradeHelped,
  isSoftwareGl,
  isTouchDevice,
  loadSavedQuality,
  minFpsFor,
  parseQuality,
  parseQualityChoice,
  saveQualityChoice,
  savedForSession,
  type AdaptContext,
  type AutoQualityAction,
  type FrameSample,
  type QualityChoice,
  type QualityEnv,
  type StorageLike,
} from '../../client/src/gfx/quality';
import { AdaptiveSession, injected, kinds, roomy, type FrameFn } from '../helpers/adaptiveSession';

/** 60Hz 화면 · 목표 60 (렌더링 최적화 전과 같은 조건) */
const AT_60: AdaptContext = { targetHz: 60, displayHz: 60, canRateFallback: false };

const PC: QualityEnv = {
  url: null,
  saved: null,
  renderer: 'webgl',
  softwareGl: false,
  touch: false,
  cores: 8,
  memory: 8,
};

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

describe('자동 품질 선택', () => {
  it('하드웨어 WebGL PC는 4코어 / 4GB여도 높음 (PC는 코어 · 메모리로 내리지 않는다)', () => {
    expect(detectQuality({ ...PC, cores: 4, memory: 4 })).toEqual({ tier: 'high', source: 'auto' });
    expect(detectQuality({ ...PC, cores: 2, memory: 2 }).tier).toBe('high');
    expect(detectQuality({ ...PC, cores: null, memory: null }).tier).toBe('high');
  });

  it('Canvas 렌더러는 낮음', () => {
    expect(detectQuality({ ...PC, renderer: 'canvas' })).toEqual({ tier: 'low', source: 'auto' });
  });

  it('소프트웨어 WebGL(SwiftShader 등)은 낮음', () => {
    expect(detectQuality({ ...PC, softwareGl: true }).tier).toBe('low');
  });

  it('터치 기기는 중간', () => {
    expect(detectQuality({ ...PC, touch: true, cores: 8, memory: 6 }).tier).toBe('medium');
    expect(detectQuality({ ...PC, touch: true, cores: null, memory: null }).tier).toBe('medium');
  });

  it('터치 저사양(코어 4개 이하 또는 메모리 3GB 이하)은 낮음', () => {
    expect(detectQuality({ ...PC, touch: true, cores: 4, memory: 8 }).tier).toBe('low');
    expect(detectQuality({ ...PC, touch: true, cores: 8, memory: 3 }).tier).toBe('low');
    expect(detectQuality({ ...PC, touch: true, cores: 8, memory: 4 }).tier).toBe('medium');
  });

  it('우선순위: ?quality > 저장값 > 자동', () => {
    expect(detectQuality({ ...PC, url: 'low', saved: 'medium' })).toEqual({ tier: 'low', source: 'url' });
    expect(detectQuality({ ...PC, saved: 'medium' })).toEqual({ tier: 'medium', source: 'saved' });
    // Canvas에서도 사용자가 고른 값이 우선 (Canvas 전용 제한은 effectivePreset이 따로 건다)
    expect(detectQuality({ ...PC, renderer: 'canvas', url: 'high' })).toEqual({
      tier: 'high',
      source: 'url',
    });
    expect(detectQuality({ ...PC, renderer: 'canvas', saved: 'high' }).source).toBe('saved');
  });

  it('소프트웨어 GL 이름', () => {
    expect(
      isSoftwareGl(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      ),
    ).toBe(true);
    expect(isSoftwareGl('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareGl('Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftwareGl('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(
      false,
    );
    expect(isSoftwareGl('Apple M2')).toBe(false);
    expect(isSoftwareGl(null)).toBe(false);
  });

  it('터치 기기: 거친 포인터만 있고 정밀 포인터가 없을 때', () => {
    expect(isTouchDevice(true, false)).toBe(true);
    // 터치 화면 노트북 (마우스 · 트랙패드도 있음)
    expect(isTouchDevice(true, true)).toBe(false);
    expect(isTouchDevice(false, true)).toBe(false);
  });
});

describe('?quality · 저장값', () => {
  it('?quality 해석', () => {
    expect(parseQuality('high')).toBe('high');
    expect(parseQuality(' Medium ')).toBe('medium');
    expect(parseQuality('LOW')).toBe('low');
    expect(parseQuality('')).toBeNull();
    expect(parseQuality('ultra')).toBeNull();
    expect(parseQuality(null)).toBeNull();
    expect(parseQualityChoice('auto')).toBe('auto');
    expect(parseQualityChoice('low')).toBe('low');
    expect(parseQualityChoice('x')).toBeNull();
  });

  it("저장하고 읽는다. '자동'을 저장하면 저장값을 지운다", () => {
    const s = memStorage();
    expect(loadSavedQuality(s)).toBeNull();
    expect(saveQualityChoice('low', s)).toBe(true);
    expect(s.data.get(QUALITY_STORAGE_KEY)).toBe('low');
    expect(loadSavedQuality(s)).toBe('low');
    expect(saveQualityChoice('auto', s)).toBe(true);
    expect(s.data.has(QUALITY_STORAGE_KEY)).toBe(false);
    expect(loadSavedQuality(s)).toBeNull();
  });

  it('이상한 저장값은 무시한다', () => {
    const s = memStorage();
    s.data.set(QUALITY_STORAGE_KEY, 'ultra');
    expect(loadSavedQuality(s)).toBeNull();
  });

  it('저장소를 못 쓰면(사생활 보호 모드 · 차단) 예외 없이 저장값 없음', () => {
    expect(loadSavedQuality(brokenStorage)).toBeNull();
    expect(saveQualityChoice('low', brokenStorage)).toBe(false);
    expect(saveQualityChoice('auto', brokenStorage)).toBe(false);
    expect(loadSavedQuality(null)).toBeNull();
    expect(saveQualityChoice('low', null)).toBe(false);
  });
});

/** 로비에서 고른 뒤 main.ts가 하는 순서: 저장 → (저장 결과와 상관없이) 이번 세션 값 + 저장소 값으로 다시 정한다 */
function chooseInLobby(
  choice: QualityChoice,
  storage: StorageLike | null,
  env: QualityEnv = PC,
): { saved: boolean; tier: QualityTier; source: string } {
  const saved = saveQualityChoice(choice, storage);
  const q = detectQuality({ ...env, url: null, saved: savedForSession(choice, loadSavedQuality(storage)) });
  return { saved, ...q };
}

/** 쓰기는 실패하고(가득 참) 예전 값은 읽히는 저장소 */
function fullStorage(old: QualityTier): StorageLike {
  return {
    getItem: (k) => (k === QUALITY_STORAGE_KEY ? old : null),
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
}

describe('로비 선택은 저장에 실패해도 이번 세션에 적용된다', () => {
  it("저장소가 없을 때(차단) '낮음'을 고르면 낮음 (하드웨어 WebGL PC의 자동 = 높음이 아니라)", () => {
    expect(chooseInLobby('low', null)).toEqual({ saved: false, tier: 'low', source: 'saved' });
  });

  it("쓰기가 실패하고 예전 저장값이 '높음'일 때 '낮음'을 고르면 낮음", () => {
    expect(chooseInLobby('low', fullStorage('high'))).toEqual({ saved: false, tier: 'low', source: 'saved' });
  });

  it("쓰기가 실패한 저장소에서 '자동'을 고르면 남은 저장값 '높음'을 무시하고 자동", () => {
    // 소프트웨어 WebGL이라 자동 = 낮음: 저장값(높음)과 구별된다
    const env = { ...PC, softwareGl: true };
    expect(chooseInLobby('auto', fullStorage('high'), env)).toEqual({
      saved: false,
      tier: 'low',
      source: 'auto',
    });
  });

  it('고른 적이 없으면 저장소 값, 정상 저장소에서는 저장값과 같다', () => {
    expect(savedForSession(null, 'medium')).toBe('medium');
    expect(savedForSession(null, null)).toBeNull();
    const s = memStorage();
    expect(chooseInLobby('medium', s)).toEqual({ saved: true, tier: 'medium', source: 'saved' });
    expect(chooseInLobby('auto', s)).toEqual({ saved: true, tier: 'high', source: 'auto' });
  });
});

/** 60fps 간격으로 fps 값을 [from, to) 동안 넣는다. 처음으로 true가 나온 시각(없으면 null) */
function feed(w: FpsWatch, from: number, to: number, fps: (t: number) => number): number | null {
  let fired: number | null = null;
  for (let t = from; t < to; t += 1000 / 60) {
    if (w.sample(t, fps(t)) && fired === null) fired = t;
  }
  return fired;
}

describe('판 중 FPS 감시', () => {
  it('예열(5초) 동안의 느린 프레임은 세지 않는다', () => {
    const w = new FpsWatch(0);
    // 시작 5초는 10fps, 그 뒤 60fps
    expect(feed(w, 0, 30_000, (t) => (t < FPS_WATCH.warmupMs ? 10 : 60))).toBeNull();
    expect(w.fired).toBe(false);
  });

  it('예열 뒤 평균 40fps 미만이 10초 넘게 이어지면 한 번 알린다', () => {
    const w = new FpsWatch(0);
    const at = feed(w, 0, 30_000, () => 30);
    expect(at).not.toBeNull();
    // 예열 5초 + 10초를 넘긴 직후
    expect(at!).toBeGreaterThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs);
    expect(at!).toBeLessThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs + 100);
    expect(w.fired).toBe(true);
  });

  it('10초가 안 되어 회복하면 처음부터 다시 잰다', () => {
    const w = new FpsWatch(0);
    // 5~14초 느림(9초), 14~16초 정상, 16~25초 느림(9초) → 알리지 않음
    const fps = (t: number): number => (t >= 14_000 && t < 16_000 ? 60 : 25);
    expect(feed(w, 0, 25_000, fps)).toBeNull();
  });

  it('잠깐 튀는 프레임은 1초 평균으로 흡수한다 (평균이 40 이상이면 느린 상태가 아니다)', () => {
    const w = new FpsWatch(0);
    // 프레임 10개 중 1개만 5fps로 튐 → 평균 약 54.5
    let i = 0;
    expect(feed(w, 0, 30_000, () => (i++ % 10 === 0 ? 5 : 60))).toBeNull();
  });

  it('판당 한 번만 알린다', () => {
    const w = new FpsWatch(0);
    let count = 0;
    for (let t = 0; t < 60_000; t += 1000 / 60) if (w.sample(t, 20)) count += 1;
    expect(count).toBe(1);
  });

  it('샘플이 오래 끊기면(백그라운드 탭) 느린 시간을 이어 세지 않는다', () => {
    const w = new FpsWatch(0);
    expect(feed(w, 0, 12_000, () => 20)).toBeNull(); // 5~12초 느림 (7초)
    // 20초 동안 샘플 없음 → 처음부터
    expect(feed(w, 32_000, 40_000, () => 20)).toBeNull(); // 8초 느림
    expect(feed(w, 40_000, 44_000, () => 20)).not.toBeNull(); // 이어서 10초 넘음
  });

  it('덮어쓴 FPS(테스트 훅 injectFps) 값도 같은 규칙으로 판단한다', () => {
    // GameScene은 getFpsOverride() ?? game.loop.actualFps를 넣는다. 실제 60fps 중에 20을 넣으면
    const w = new FpsWatch(0);
    expect(feed(w, 0, 8_000, () => 60)).toBeNull();
    const at = feed(w, 8_000, 30_000, () => 20);
    expect(at).not.toBeNull();
    // 1초 평균이 40 아래로 내려간 뒤 10초
    expect(at! - 8_000).toBeGreaterThan(FPS_WATCH.sustainMs);
    expect(at! - 8_000).toBeLessThan(FPS_WATCH.sustainMs + FPS_WATCH.windowMs);
  });

  it('평균을 알려 준다', () => {
    const w = new FpsWatch(0);
    feed(w, 0, 7_000, () => 50);
    expect(w.average).toBeCloseTo(50, 5);
  });
});

describe('하향 효과 확인', () => {
  it('효과 기준: +15% 이상 또는 +5fps 이상이면 효과 있음', () => {
    expect(downgradeHelped(30, 30)).toBe(false);
    expect(downgradeHelped(30, 34)).toBe(false); // +13%, +4
    expect(downgradeHelped(30, 34.5)).toBe(true); // +15%
    expect(downgradeHelped(20, 23)).toBe(true); // +15% (+3)
    expect(downgradeHelped(38, 43)).toBe(true); // +5fps (+13%)
    expect(downgradeHelped(38, 42)).toBe(false);
    expect(downgradeHelped(30, 20)).toBe(false);
  });

  it('가라앉는 시간 뒤 정해진 시간 동안 잰 평균으로 판단한다', () => {
    const c = new DowngradeCheck(0, 30);
    let verdict: string | null = null;
    let at = -1;
    for (let t = 0; t < 30_000 && verdict === null; t += 1000 / 60) {
      // 가라앉는 동안의 느린 프레임(10fps)은 세지 않는다
      verdict = c.sample(t, t < DOWNGRADE_CHECK.settleMs ? 10 : 50);
      at = t;
    }
    expect(verdict).toBe('helped');
    expect(at).toBeGreaterThanOrEqual(DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs);
    expect(at).toBeLessThan(DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs + 100);
    expect(c.average).toBeCloseTo(50, 5);
  });

  it('샘플이 오래 끊기면(백그라운드 탭) 가라앉는 시간부터 다시 잰다', () => {
    const c = new DowngradeCheck(0, 30);
    for (let t = 0; t < 8_000; t += 1000 / 60) expect(c.sample(t, 30)).toBeNull();
    // 20초 끊김 뒤에는 60fps: 앞의 30fps는 버리고 다시 잰다
    let verdict: string | null = null;
    for (let t = 28_000; t < 60_000 && verdict === null; t += 1000 / 60) verdict = c.sample(t, 60);
    expect(verdict).toBe('helped');
    expect(c.average).toBeCloseTo(60, 5);
  });
});

/** 세션 하나: 판을 이어서 돌리며 자동 조정을 적용한다 (main.ts의 qualityHooks.auto와 같은 규칙) */
class Session {
  tier: QualityTier = 'high';
  downgrades = 0;
  readonly log: AutoQualityAction['kind'][] = [];
  readonly auto = new AutoDowngrade();
  private t = 0;

  /** 판 하나를 ms 동안 60Hz로 돈다. fps(판 안 경과 ms, 지금 단계) */
  play(ms: number, fps: (elapsed: number, tier: QualityTier) => number): AutoQualityAction['kind'][] {
    const start = this.t;
    const kinds: AutoQualityAction['kind'][] = [];
    this.auto.beginMatch(start);
    for (; this.t < start + ms; this.t += 1000 / 60) {
      const a = this.auto.sample(this.t, injected(fps(this.t - start, this.tier)), this.tier, AT_60);
      if (!a) continue;
      kinds.push(a.kind);
      this.log.push(a.kind);
      if (a.kind === 'downgrade' && this.tier === a.from) {
        this.tier = a.to;
        this.downgrades += 1;
      } else if (a.kind === 'revert' && this.tier === a.from) {
        this.tier = a.to;
      }
    }
    this.auto.endMatch();
    // 판 사이 (결과 화면 · 로비)
    this.t += 20_000;
    return kinds;
  }
}

describe('판 중 자동 하향 · 효과 확인 · 되돌리기 (세션)', () => {
  it('화면이 30Hz로 묶이면: 하향 1번 → 효과 없음 → 원래 단계로 → 이번 세션에서는 더 내리지 않는다', () => {
    const s = new Session();
    expect(s.play(60_000, () => 30)).toEqual(['downgrade', 'revert']);
    expect(s.tier).toBe('high');
    expect(s.downgrades).toBe(1);
    expect(s.auto.status).toBe('off');
    // 다음 판들: 계속 30이어도 하향 0번
    expect(s.play(60_000, () => 30)).toEqual([]);
    expect(s.play(60_000, () => 30)).toEqual([]);
    expect(s.tier).toBe('high');
    expect(s.downgrades).toBe(1);
  });

  it('되돌리기는 같은 판 안에서 일어난다 (하향 뒤 가라앉는 시간 + 측정 시간)', () => {
    const s = new Session();
    const auto = s.auto;
    auto.beginMatch(0);
    let downAt = -1;
    let revertAt = -1;
    for (let t = 0; t < 60_000; t += 1000 / 60) {
      const a = auto.sample(t, injected(30), 'high', AT_60);
      if (a?.kind === 'downgrade') downAt = t;
      if (a?.kind === 'revert') revertAt = t;
    }
    expect(downAt).toBeGreaterThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs);
    expect(revertAt - downAt).toBeGreaterThanOrEqual(DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs);
    expect(revertAt - downAt).toBeLessThan(DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs + 100);
  });

  it('하향 뒤 60fps로 오르면 유지하고, 다음 판도 느리면 한 단계 더 내린다', () => {
    const s = new Session();
    // 높음에서는 30, 내리면 60
    const gpuBound = (_e: number, tier: QualityTier): number => (tier === 'high' ? 30 : 60);
    expect(s.play(60_000, gpuBound)).toEqual(['downgrade', 'keep']);
    expect(s.tier).toBe('medium');
    expect(s.auto.status).toBe('on');
    // 다음 판: 중간에서도 25 → 한 단계 더(낮음), 낮음에서 45 → 유지
    expect(s.play(60_000, (_e, tier) => (tier === 'low' ? 45 : 25))).toEqual(['downgrade', 'keep']);
    expect(s.tier).toBe('low');
    expect(s.downgrades).toBe(2);
    // 이미 낮음: 느려도 더 내릴 단계가 없다
    expect(s.play(60_000, () => 20)).toEqual([]);
    expect(s.tier).toBe('low');
  });

  it('판당 하향은 한 번: 효과가 있어도 같은 판에서는 더 내리지 않는다', () => {
    const s = new Session();
    // 높음 20 → 중간 30 (+50%, 효과 있음). 중간에서도 40 미만이지만 이번 판에서는 그대로
    expect(s.play(120_000, (_e, tier) => (tier === 'high' ? 20 : 30))).toEqual(['downgrade', 'keep']);
    expect(s.tier).toBe('medium');
  });

  it('확인 전에 판이 끝나면 다음 판 예열 뒤 이어서 확인한다 (그동안 더 내리지 않는다)', () => {
    const s = new Session();
    // 하향(약 15초) 직후 판이 끝난다
    expect(s.play(16_000, () => 30)).toEqual(['downgrade']);
    expect(s.tier).toBe('medium');
    expect(s.auto.status).toBe('checking');
    // 다음 판: 계속 30 → 예열 뒤 확인해서 되돌린다
    expect(s.play(60_000, () => 30)).toEqual(['revert']);
    expect(s.tier).toBe('high');
    expect(s.auto.status).toBe('off');
  });

  it('사용자가 직접 고르면 확인 중이던 하향은 잊는다', () => {
    const s = new Session();
    expect(s.play(16_000, () => 30)).toEqual(['downgrade']);
    s.auto.cancelPending();
    s.tier = 'low';
    expect(s.auto.status).toBe('on');
    expect(s.play(60_000, () => 60)).toEqual([]);
    expect(s.tier).toBe('low');
  });

  it('하향 전 평균은 느린 상태 전체의 평균이다', () => {
    const w = new FpsWatch(0);
    let fired = false;
    for (let t = 0; t < 30_000 && !fired; t += 1000 / 60) fired = w.sample(t, t < 10_000 ? 20 : 30);
    expect(fired).toBe(true);
    // 5~10초 20, 10~15초 30
    expect(w.slowAverage).toBeGreaterThan(24);
    expect(w.slowAverage).toBeLessThan(26);
  });
});

// ───────────── 렌더링 최적화: 목표 FPS에 맞춘 적응형 품질 ─────────────

/** 60Hz PC: 처음 20초만 느려(잠깐 다른 부하) 높음 → 중간으로 내리고 유지한 뒤, 이어서 frame으로 70초 더 돈다 */
function afterKeptDowngrade(frame: FrameSample): AutoDowngrade {
  const auto = new AutoDowngrade();
  let tier: QualityTier = 'high';
  auto.beginMatch(0);
  for (let t = 0; t < 100_000; t += 1000 / 60) {
    const s = t < 20_000 ? injected(30) : t < 30_000 ? injected(60) : frame;
    const a = auto.sample(t, s, tier, AT_60);
    if (a?.kind === 'downgrade') tier = a.to;
  }
  return auto;
}

/** Array.prototype 메서드(늘리기 · 당기기 · 복사) 호출 수 (샘플마다 할당하지 않는지 보는 구조 검사) */
function countArrayCalls(run: () => void): number {
  const proto = Array.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const names = ['push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'map', 'filter'];
  const originals = names.map((n) => proto[n]);
  let calls = 0;
  names.forEach((n, i) => {
    const f = originals[i]!;
    proto[n] = function (this: unknown, ...args: unknown[]): unknown {
      calls += 1;
      return f.apply(this, args);
    };
  });
  try {
    run();
  } finally {
    names.forEach((n, i) => {
      proto[n] = originals[i]!;
    });
  }
  return calls;
}

describe('렌더링 최적화: 하향 기준은 목표 FPS에 비례한다', () => {
  it('기준 = 60Hz 값 × min(목표, 120) / 60: PC 2/3 · 터치 5/6, 144 · 165Hz도 기준 목표 120', () => {
    expect([BASE_TARGET_HZ, THRESHOLD_CAP_HZ, RATE_FALLBACK_HZ]).toEqual([60, 120, 60]);
    expect([60, 90, 120, 144, 165, 240].map((hz) => minFpsFor(FPS_WATCH, hz))).toEqual([
      40, 60, 80, 80, 80, 80,
    ]);
    expect([60, 90, 120, 144].map((hz) => minFpsFor(TOUCH_FPS_WATCH, hz))).toEqual([50, 75, 100, 100]);
    // 이상한 목표는 60으로 본다
    for (const hz of [Number.NaN, 0, -120, Number.POSITIVE_INFINITY])
      expect(minFpsFor(FPS_WATCH, hz)).toBe(40);
    expect(new AutoDowngrade().minFps).toBe(40);
  });

  it('고정 제한 120 · 120Hz 화면 PC: 평균 75fps면 품질을 한 단계(80 미만), 85fps면 그대로. 목표 FPS는 바꾸지 않는다', () => {
    const slow = new AdaptiveSession('high', new AutoDowngrade(), '120', 120);
    const down = slow.play(20_000, () => injected(75));
    expect(kinds(down)).toEqual(['downgrade']);
    expect(down[0]!.at).toBeGreaterThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs);
    expect(down[0]!.at).toBeLessThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs + 50);
    expect([slow.tier, slow.fallback, slow.targetHz]).toEqual(['medium', null, 120]);
    expect(slow.auto.minFps).toBe(80);

    const ok = new AdaptiveSession('high', new AutoDowngrade(), '120', 120);
    expect(ok.play(60_000, () => injected(85))).toEqual([]);
    expect(ok.tier).toBe('high');
  });

  it('144Hz 화면에서 90fps인 PC는 내려가지 않는다 (기준 80). 75fps면 먼저 목표 FPS를 60으로', () => {
    const fast = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 144);
    expect(fast.play(60_000, () => injected(90))).toEqual([]);
    expect([fast.tier, fast.targetHz]).toEqual(['high', 144]);

    const slow = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 144);
    const acts = slow.play(20_000, () => injected(75));
    expect(acts.map((l) => l.action)).toEqual([
      { kind: 'rateDown', mode: 'online', from: 144, to: 60, fpsBefore: 75 },
    ]);
    expect([slow.tier, slow.targetHz]).toEqual(['high', 60]);
  });

  it('120 제한이어도 60Hz 화면이면 목표 60 · 기준 40 (M10 그대로)', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), '120', 60);
    expect(s.targetHz).toBe(60);
    expect(s.play(60_000, () => injected(45))).toEqual([]);
    expect(kinds(s.play(20_000, () => injected(35)))).toEqual(['downgrade']);
  });
});

describe('렌더링 최적화: 자동 프레임 제한은 목표 FPS를 먼저 낮춘다', () => {
  it('자동 · 120Hz: 느리면 먼저 목표 60(품질 그대로, 확인 없음), 60에서도 느리면 같은 판에서 품질을 한 단계', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 120);
    const frame: FrameFn = (tier, hz) => (hz > 60 ? injected(70) : injected(tier === 'high' ? 35 : 55));
    const acts = s.play(60_000, frame);
    expect(kinds(acts)).toEqual(['rateDown', 'downgrade', 'keep']);
    const [rate, down, keep] = acts;
    expect(rate!.action).toEqual({ kind: 'rateDown', mode: 'online', from: 120, to: 60, fpsBefore: 70 });
    expect(rate!.at).toBeGreaterThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs);
    expect(rate!.at).toBeLessThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs + 50);
    // 목표 FPS 낮춤은 판당 품질 하향 한도에 세지 않는다: 새 목표에서 예열부터 다시 잰다
    expect(down!.action).toMatchObject({ kind: 'downgrade', from: 'high', to: 'medium', fpsBefore: 35 });
    expect(down!.at - rate!.at).toBeGreaterThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs);
    expect(down!.at - rate!.at).toBeLessThan(FPS_WATCH.warmupMs + FPS_WATCH.sustainMs + 50);
    expect(keep!.at - down!.at).toBeGreaterThanOrEqual(DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs);
    expect([s.tier, s.targetHz, s.auto.status]).toEqual(['medium', 60, 'on']);
    expect(s.auto.steps).toEqual([
      { kind: 'rate', from: 120, to: 60 },
      { kind: 'tier', from: 'high', to: 'medium' },
    ]);
  });

  it('목표 FPS 낮춤 뒤에는 확인이 없다 (상태 on, 다시 올리기 전까지 그대로)', () => {
    const auto = new AutoDowngrade();
    const ctx120: AdaptContext = { targetHz: 120, displayHz: 120, canRateFallback: true };
    auto.beginMatch(0);
    let at = -1;
    for (let t = 0; t < 30_000 && at < 0; t += 1000 / 120) {
      const a = auto.sample(t, injected(70), 'high', ctx120);
      if (a) {
        expect(a.kind).toBe('rateDown');
        at = t;
      }
    }
    expect(at).toBeGreaterThan(0);
    expect(auto.status).toBe('on');
  });

  it('고정 제한(60 · 120)은 목표 FPS를 바꾸지 않는다: 바로 품질을 내리고, 효과가 없으면 되돌린다', () => {
    const fixed60 = new AdaptiveSession('high', new AutoDowngrade(), '60', 120);
    expect(kinds(fixed60.play(60_000, () => injected(30)))).toEqual(['downgrade', 'revert']);
    expect([fixed60.fallback, fixed60.targetHz, fixed60.tier]).toEqual([null, 60, 'high']);

    const fixed120 = new AdaptiveSession('high', new AutoDowngrade(), '120', 120);
    expect(kinds(fixed120.play(60_000, () => injected(50)))).toEqual(['downgrade', 'revert']);
    expect([fixed120.fallback, fixed120.targetHz, fixed120.tier]).toEqual([null, 120, 'high']);
    expect(fixed120.auto.status).toBe('off');
  });

  it('60Hz 화면의 자동 제한은 목표를 바꿀 것이 없다 (M10 그대로 품질 하향)', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 60);
    expect(s.ctx().canRateFallback).toBe(false);
    expect(kinds(s.play(60_000, () => injected(30)))).toEqual(['downgrade', 'revert']);
    expect(s.fallback).toBeNull();
  });
});

describe('렌더링 최적화: 여유가 이어지면 자동으로 내린 단계를 되돌린다', () => {
  it('품질: 마지막 변경 20초 뒤부터 여유가 15초 넘게 이어지면 다음 판 시작 전에 한 단계 (판 중에는 올리지 않는다)', () => {
    const auto = new AutoDowngrade();
    let tier: QualityTier = 'high';
    const acts: { kind: AutoQualityAction['kind']; t: number }[] = [];
    let queuedAt = -1;
    auto.beginMatch(0);
    for (let t = 0; t < 120_000; t += 1000 / 60) {
      // 처음 20초만 느리다
      const a = auto.sample(t, t < 20_000 ? injected(30) : { fps: 60, workP95: 4 }, tier, AT_60);
      if (a) acts.push({ kind: a.kind, t });
      if (a?.kind === 'downgrade') tier = a.to;
      if (queuedAt < 0 && auto.queuedUpgrade) queuedAt = t;
    }
    auto.endMatch();
    // 판 중에는 내림 · 유지뿐
    expect(acts.map((a) => a.kind)).toEqual(['downgrade', 'keep']);
    const downAt = acts[0]!.t;
    expect(queuedAt - downAt).toBeGreaterThan(UP_WATCH.quietMs + UP_WATCH.sustainMs);
    expect(queuedAt - downAt).toBeLessThan(UP_WATCH.quietMs + UP_WATCH.sustainMs + 100);
    expect([tier, auto.status]).toEqual(['medium', 'on']);
    expect(auto.queuedUpgrade).toEqual({ from: 'medium', to: 'high' });

    // 다음 판 장면을 만들기 직전 (main.ts): 올리고, 그 판의 예열 뒤 확인한다
    const up = auto.takePendingUpgrade('online', tier);
    expect(up).toEqual({ kind: 'upgrade', mode: 'online', from: 'medium', to: 'high', fps: 60, workP95: 4 });
    expect(auto.takePendingUpgrade('online', tier)).toBeNull();
    tier = 'high';
    expect(auto.status).toBe('probation');
    const start = 200_000;
    auto.beginMatch(start);
    let keptAt = -1;
    for (let t = start; t < start + 30_000 && keptAt < 0; t += 1000 / 60) {
      const a = auto.sample(t, { fps: 60, workP95: 4 }, tier, AT_60);
      if (a) {
        expect(a).toEqual({ kind: 'upKeep', mode: 'online', step: 'tier', tier: 'high', fpsAfter: 60 });
        keptAt = t - start;
      }
    }
    expect(keptAt).toBeGreaterThanOrEqual(FPS_WATCH.warmupMs + UP_PROBATION.measureMs);
    expect(keptAt).toBeLessThan(FPS_WATCH.warmupMs + UP_PROBATION.measureMs + 100);
    expect([auto.status, auto.steps.length, auto.upgradesBlocked]).toEqual(['on', 0, false]);
  });

  it('여유 조건: FPS ≥ 목표 × 0.95 이고 작업 시간 p95 ≤ 예산(1000 / 목표)의 절반', () => {
    expect(UP_WATCH).toEqual({ quietMs: 20000, sustainMs: 15000, minFpsRatio: 0.95, maxWorkRatio: 0.5 });
    expect(UP_PROBATION).toEqual({ settleMs: 3000, measureMs: 10000 });
    // 목표 60: 예산 16.7ms → 8.33ms까지
    expect(afterKeptDowngrade({ fps: 60, workP95: 8.3 }).queuedUpgrade).toEqual({
      from: 'medium',
      to: 'high',
    });
    expect(afterKeptDowngrade({ fps: 60, workP95: 8.4 }).queuedUpgrade).toBeNull();
    expect(afterKeptDowngrade({ fps: 58, workP95: 2 }).queuedUpgrade).not.toBeNull();
    expect(afterKeptDowngrade({ fps: 56, workP95: 2 }).queuedUpgrade).toBeNull();
    // 작업 시간을 모르면(측정 전) 올리지 않는다
    expect(afterKeptDowngrade({ fps: 60, workP95: Number.NaN }).queuedUpgrade).toBeNull();
  });

  it('목표 FPS 올리기는 올린 뒤 목표의 예산으로 보고(120Hz: 4.17ms까지) 판 중에 바로 한다. 확인을 통과하면 유지', () => {
    const run = (work: number): AdaptiveSession => {
      const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 120);
      s.play(90_000, (_tier, hz, e) => (hz > 60 && e < 20_000 ? injected(70) : { fps: hz, workP95: work }));
      return s;
    };
    const tight = run(5);
    expect(kinds(tight.log)).toEqual(['rateDown']);
    expect(tight.targetHz).toBe(60);

    const s = run(4);
    expect(kinds(s.log)).toEqual(['rateDown', 'rateUp', 'upKeep']);
    const [down, up, kept] = s.log;
    expect(up!.action).toEqual({ kind: 'rateUp', mode: 'online', from: 60, to: 120, fps: 60, workP95: 4 });
    expect(up!.at - down!.at).toBeGreaterThan(UP_WATCH.quietMs + UP_WATCH.sustainMs);
    expect(up!.at - down!.at).toBeLessThan(UP_WATCH.quietMs + UP_WATCH.sustainMs + 100);
    expect(kept!.action).toEqual({ kind: 'upKeep', mode: 'online', step: 'rate', hz: 120, fpsAfter: 120 });
    expect(kept!.at - up!.at).toBeGreaterThanOrEqual(UP_PROBATION.settleMs + UP_PROBATION.measureMs);
    expect(kept!.at - up!.at).toBeLessThan(UP_PROBATION.settleMs + UP_PROBATION.measureMs + 50);
    expect([s.targetHz, s.auto.steps.length]).toEqual([120, 0]);
  });

  it('가장 최근에 내린 것부터 되돌리고, 자동으로 내리기 전 상태(시작 단계 · 시작 목표)보다 올리지 않는다', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 120);
    // 판 1: 45초까지 느리다(120에서 70, 60에서 높음 35 · 중간 55) → 목표 60 → 중간. 그 뒤 여유
    const first: FrameFn = (tier, hz, e) =>
      e < 45_000 ? (hz > 60 ? injected(70) : injected(tier === 'high' ? 35 : 55)) : roomy()(tier, hz, e);
    expect(kinds(s.play(70_000, first))).toEqual(['rateDown', 'downgrade', 'keep']);
    expect(s.auto.queuedUpgrade).toEqual({ from: 'medium', to: 'high' });
    // 판 2: 시작 전 품질(가장 최근 단계) → 확인 통과 → 목표 FPS → 확인 통과
    expect(kinds(s.play(60_000, roomy()))).toEqual(['upgrade', 'upKeep', 'rateUp', 'upKeep']);
    expect([s.tier, s.targetHz, s.auto.steps.length]).toEqual(['high', 120, 0]);
    // 판 3: 되돌릴 것이 없다
    expect(s.play(120_000, roomy())).toEqual([]);
    expect([s.tier, s.targetHz]).toEqual(['high', 120]);
  });

  it('?quality로 정한 단계도 천장: 내렸다 올려도 그 단계까지만', () => {
    // ?quality=medium으로 시작한 PC
    const s = new AdaptiveSession('medium', new AutoDowngrade(), 'auto', 60);
    const first: FrameFn = (tier, hz, e) => (e < 20_000 ? injected(30) : roomy()(tier, hz, e));
    expect(kinds(s.play(60_000, first))).toEqual(['downgrade', 'keep']);
    expect(kinds(s.play(60_000, roomy()))).toEqual(['upgrade', 'upKeep']);
    expect(s.tier).toBe('medium');
    expect(s.play(120_000, roomy())).toEqual([]);
    expect(s.tier).toBe('medium');
  });

  it('올린 뒤 확인에서 느리면 다시 내리고 이번 세션에서는 더 올리지 않는다 (내리기는 계속)', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 60);
    expect(kinds(s.play(60_000, (t, hz, e) => (e < 20_000 ? injected(30) : roomy()(t, hz, e))))).toEqual([
      'downgrade',
      'keep',
    ]);
    // 높음은 실제로 느린 기기: 올린 판이 확인 전에 끝나면 다음 판 예열 뒤 이어서 확인한다
    const highSlow: FrameFn = (tier, hz, e) => (tier === 'high' ? injected(35) : roomy()(tier, hz, e));
    expect(kinds(s.play(10_000, highSlow))).toEqual(['upgrade']);
    expect(s.auto.status).toBe('probation');
    const back = s.play(30_000, highSlow);
    expect(back.map((l) => l.action)).toEqual([
      { kind: 'upRevert', mode: 'online', step: 'tier', from: 'high', to: 'medium', fpsAfter: 35 },
    ]);
    expect(back[0]!.at).toBeGreaterThanOrEqual(FPS_WATCH.warmupMs + UP_PROBATION.measureMs);
    expect(back[0]!.at).toBeLessThan(FPS_WATCH.warmupMs + UP_PROBATION.measureMs + 100);
    expect([s.tier, s.auto.status, s.auto.upgradesBlocked]).toEqual(['medium', 'on', true]);
    expect(s.auto.steps).toEqual([{ kind: 'tier', from: 'high', to: 'medium' }]);
    // 여유가 있어도 더 올리지 않는다
    expect(s.play(120_000, roomy())).toEqual([]);
    expect(s.auto.queuedUpgrade).toBeNull();
    // 내리기는 그대로: 중간에서 느리면 낮음으로
    expect(kinds(s.play(20_000, () => injected(30)))).toEqual(['downgrade']);
  });

  it('목표 FPS를 올린 뒤 느리면 다시 60으로 내리고 막는다', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 120);
    // 120에서는 늘 70fps(기준 80 미만), 60에서는 여유
    s.play(100_000, (_tier, hz) => (hz > 60 ? injected(70) : { fps: 60, workP95: 3 }));
    expect(kinds(s.log)).toEqual(['rateDown', 'rateUp', 'upRevert']);
    expect(s.log[2]!.action).toEqual({
      kind: 'upRevert',
      mode: 'online',
      step: 'rate',
      from: 120,
      to: 60,
      fpsAfter: 70,
    });
    expect([s.targetHz, s.auto.upgradesBlocked, s.tier]).toEqual([60, true, 'high']);
  });

  it('30Hz로 묶인 화면(재면 60Hz): 효과 없는 하향을 되돌리고 끈 뒤에는 여유가 있어도 올리지 않는다', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 60);
    // 판 1: 잠깐 느려 높음 → 중간(유지). 판 2: 30Hz로 묶임(절전) → 중간 → 낮음 → 효과 없음 → 되돌리고 끔
    expect(kinds(s.play(30_000, (t, hz, e) => (e < 20_000 ? injected(30) : roomy()(t, hz, e))))).toEqual([
      'downgrade',
      'keep',
    ]);
    expect(kinds(s.play(60_000, () => injected(30)))).toEqual(['downgrade', 'revert']);
    expect([s.tier, s.auto.status]).toEqual(['medium', 'off']);
    expect(s.play(120_000, roomy())).toEqual([]);
    expect(s.auto.queuedUpgrade).toBeNull();
    expect(s.tier).toBe('medium');
  });

  it('다른 모드의 판 · 다른 품질이면 미룬 품질 올리기를 하지 않는다 (목표 FPS 단계는 남는다)', () => {
    const first: FrameFn = (tier, hz, e) =>
      e < 45_000 ? (hz > 60 ? injected(70) : injected(tier === 'high' ? 35 : 55)) : roomy()(tier, hz, e);
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 120);
    s.play(70_000, first);
    expect(s.auto.queuedUpgrade).not.toBeNull();
    // 연습 판: 부하가 다르다. 품질 단계는 잊고 목표 FPS 단계만 남는다
    expect(s.auto.takePendingUpgrade('practice', s.tier)).toBeNull();
    s.auto.beginMatch(s.t, 'practice');
    expect(s.auto.steps).toEqual([{ kind: 'rate', from: 120, to: 60 }]);
    s.auto.endMatch();

    const other = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 120);
    other.play(70_000, first);
    expect(other.auto.takePendingUpgrade('online', 'low')).toBeNull();
  });

  it('그사이 품질이 다른 이유로 바뀌면 그 단계는 되돌릴 대상이 아니다', () => {
    const auto = afterKeptDowngrade({ fps: 60, workP95: 12 });
    expect(auto.steps).toEqual([{ kind: 'tier', from: 'high', to: 'medium' }]);
    auto.beginMatch(200_000);
    // 예: 터치 기기가 모드 기억으로 품질을 다시 정했다
    for (let t = 200_000; t < 300_000; t += 1000 / 60) auto.sample(t, { fps: 60, workP95: 2 }, 'low', AT_60);
    expect(auto.steps).toEqual([]);
    expect(auto.queuedUpgrade).toBeNull();
  });

  it('사용자가 품질을 고르면 되돌릴 품질 단계 · 미룬 올리기를 잊는다 (목표 FPS 단계는 둔다)', () => {
    const first: FrameFn = (tier, hz, e) =>
      e < 45_000 ? (hz > 60 ? injected(70) : injected(tier === 'high' ? 35 : 55)) : roomy()(tier, hz, e);
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 120);
    s.play(70_000, first);
    s.auto.cancelPending();
    expect(s.auto.queuedUpgrade).toBeNull();
    expect(s.auto.steps).toEqual([{ kind: 'rate', from: 120, to: 60 }]);
    // 사용자가 프레임 제한을 바꾸면 목표 FPS 단계도 잊는다 (main.ts는 pacer.setFallback(null)도 한다)
    s.auto.resetRate();
    expect(s.auto.steps).toEqual([]);
  });

  it('프레임 제한을 바꿔 목표가 달라지면(자기 결정이 아님) 확인 중이던 하향을 판단 없이 끝내고 처음부터 잰다', () => {
    const s = new AdaptiveSession('high', new AutoDowngrade(), '60', 120);
    expect(kinds(s.play(16_000, () => injected(30)))).toEqual(['downgrade']);
    expect(s.auto.status).toBe('checking');
    // 다음 판 전에 사용자가 120으로: 60에서 잰 하향 전 평균과 견주지 않는다
    s.limit = '120';
    expect(s.play(60_000, () => injected(110))).toEqual([]);
    expect([s.auto.status, s.tier, s.auto.steps.length]).toEqual(['on', 'medium', 0]);
  });
});

describe('렌더링 최적화: injectFps(f) = FPS f · 작업 시간 1000/f', () => {
  it('목표 60에서 injectFps(60)은 내리지도 올리지도 않는다 (되돌릴 단계가 있어도)', () => {
    expect(afterKeptDowngrade(injected(60)).queuedUpgrade).toBeNull();
    const s = new AdaptiveSession('high', new AutoDowngrade(), 'auto', 60);
    expect(s.play(120_000, () => injected(60))).toEqual([]);
  });

  it('120Hz rAF에서 injectFps(120)은 아무것도 하지 않는다 (자동 · 고정 120)', () => {
    for (const limit of ['auto', '120'] as const) {
      const s = new AdaptiveSession('high', new AutoDowngrade(), limit, 120);
      expect(s.play(120_000, () => injected(120))).toEqual([]);
      expect([s.tier, s.targetHz]).toEqual(['high', 120]);
    }
  });

  it('목표 이하의 값으로는 올리지 않는다 (작업 시간 1000/f가 예산의 절반을 넘는다)', () => {
    for (const f of [57, 58, 60, 90]) expect(afterKeptDowngrade(injected(f)).queuedUpgrade).toBeNull();
  });
});

describe('렌더링 최적화: 샘플마다 할당하지 않는다', () => {
  it('고리 버퍼: 같은 typed array를 계속 쓰고, 가득 차면 오래된 것부터 버리며 구간 평균을 낸다', () => {
    expect(SAMPLE_RING_SIZE).toBeGreaterThanOrEqual(240);
    const ring = new SlidingAverage(1000, 64);
    const { times, values } = ring;
    expect(times).toBeInstanceOf(Float64Array);
    for (let i = 0; i < 10_000; i += 1) ring.push(i * 4, i < 9_990 ? 60 : 30);
    expect(ring.times).toBe(times);
    expect(ring.values).toBe(values);
    expect([ring.times.length, ring.count]).toEqual([64, 64]);
    // 마지막 64개 = 60 54개 + 30 10개
    expect(ring.average).toBeCloseTo((54 * 60 + 10 * 30) / 64, 9);
    // 구간: 가장 최근 샘플보다 1초를 넘게 오래된 것은 뺀다(경계 포함)
    const win = new SlidingAverage(1000);
    win.push(0, 10);
    win.push(1000, 20);
    expect(win.average).toBe(15);
    win.push(1000.5, 30);
    expect([win.count, win.average]).toEqual([2, 25]);
    win.clear();
    expect([win.count, win.average]).toEqual([0, 0]);
  });

  it('감시 · 여유 감시 · 올린 뒤 확인 중에 배열을 늘리거나 당기지 않는다 (같은 측정 · 맥락 객체를 다시 쓴다)', () => {
    const frame: FrameSample = { fps: 50, workP95: 12 };
    const ctx: AdaptContext = { ...AT_60 };
    // 하향 감시만 (되돌릴 단계 없음)
    const plain = new AutoDowngrade();
    plain.beginMatch(0);
    expect(
      countArrayCalls(() => {
        for (let t = 0; t < 20_000; t += 1000 / 60) plain.sample(t, frame, 'high', ctx);
      }),
    ).toBe(0);
    // 여유 감시 (되돌릴 단계가 있고 여유가 없다)
    const withStep = afterKeptDowngrade({ fps: 60, workP95: 12 });
    withStep.beginMatch(200_000);
    frame.fps = 60;
    expect(
      countArrayCalls(() => {
        for (let t = 200_000; t < 260_000; t += 1000 / 60) withStep.sample(t, frame, 'medium', ctx);
      }),
    ).toBe(0);
    expect(withStep.steps.length).toBe(1);
    // 올린 뒤 확인 (판단 전까지)
    const probing = afterKeptDowngrade({ fps: 60, workP95: 4 });
    expect(probing.takePendingUpgrade('online', 'medium')?.kind).toBe('upgrade');
    probing.beginMatch(300_000);
    frame.workP95 = 4;
    expect(
      countArrayCalls(() => {
        for (let t = 300_000; t < 314_000; t += 1000 / 60) probing.sample(t, frame, 'high', ctx);
      }),
    ).toBe(0);
    expect(probing.status).toBe('probation');
  });

  it('여유 감시 · 올린 뒤 확인 단위: 끊김은 처음부터, 판단은 평균으로', () => {
    const w = new UpWatch();
    let fired = -1;
    for (let t = 0; t < 30_000 && fired < 0; t += 1000 / 60) if (w.sample(t, 60, 4, 60, 60, 5_000)) fired = t;
    expect(fired).toBeGreaterThan(5_000 + UP_WATCH.sustainMs);
    expect(fired).toBeLessThan(5_000 + UP_WATCH.sustainMs + 50);
    // 끊기면(백그라운드 탭) 여유 시간을 이어 세지 않는다
    const g = new UpWatch();
    for (let t = 0; t < 10_000; t += 1000 / 60) expect(g.sample(t, 60, 4, 60, 60, 0)).toBe(false);
    let again = -1;
    for (let t = 20_000; t < 50_000 && again < 0; t += 1000 / 60)
      if (g.sample(t, 60, 4, 60, 60, 0)) again = t;
    expect(again - 20_000).toBeGreaterThan(UP_WATCH.sustainMs);

    const p = new UpProbation(0);
    let verdict: string | null = null;
    for (let t = 0; t < 20_000 && verdict === null; t += 1000 / 60)
      verdict = p.sample(t, t < UP_PROBATION.settleMs ? 10 : 45, 40);
    expect(verdict).toBe('pass');
    expect(p.average).toBeCloseTo(45, 5);
    const q = new UpProbation(0);
    verdict = null;
    for (let t = 0; t < 20_000 && verdict === null; t += 1000 / 60) verdict = q.sample(t, 39, 40);
    expect(verdict).toBe('fail');
  });
});
