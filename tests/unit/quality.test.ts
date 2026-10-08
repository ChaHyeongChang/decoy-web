// 그래픽 품질 자동 선택 · 저장 · 판 중 FPS 감시 (M10a)
import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../../client/src/gfx/presets';
import {
  AutoDowngrade,
  DOWNGRADE_CHECK,
  DowngradeCheck,
  FPS_WATCH,
  FpsWatch,
  QUALITY_STORAGE_KEY,
  detectQuality,
  downgradeHelped,
  isSoftwareGl,
  isTouchDevice,
  loadSavedQuality,
  parseQuality,
  parseQualityChoice,
  saveQualityChoice,
  savedForSession,
  type AutoQualityAction,
  type QualityChoice,
  type QualityEnv,
  type StorageLike,
} from '../../client/src/gfx/quality';

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
      const a = this.auto.sample(this.t, fps(this.t - start, this.tier), this.tier);
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
      const a = auto.sample(t, 30, 'high');
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
