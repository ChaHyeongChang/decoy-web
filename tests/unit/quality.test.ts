// 그래픽 품질 자동 선택 · 저장 · 판 중 FPS 감시 (M10a)
import { describe, expect, it } from 'vitest';
import {
  FPS_WATCH,
  FpsWatch,
  QUALITY_STORAGE_KEY,
  detectQuality,
  isSoftwareGl,
  isTouchDevice,
  loadSavedQuality,
  parseQuality,
  parseQualityChoice,
  saveQualityChoice,
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
