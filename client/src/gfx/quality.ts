// 그래픽 품질: 자동 선택 · 저장 · 판 중 FPS 감시 (순수 로직, Phaser를 import하지 않는다).
// 우선순위: ?quality > 로비에서 고른 값(localStorage 'decoy:quality') > 자동 (MOBILE_PLAN M10 '그래픽 품질 단계').
// 아래 FPS · 기기 기준값은 판정과 무관한 그래픽 값이라 balance.json이 아니라 여기 둔다.
import { isQualityTier, type QualityTier, type RendererKind } from './presets';

/** 로비 선택지: 자동 또는 단계 하나 */
export type QualityChoice = 'auto' | QualityTier;
export type QualitySource = 'url' | 'saved' | 'auto';

export const QUALITY_STORAGE_KEY = 'decoy:quality';

/** 터치 기기에서 낮음으로 시작하는 기준 (이하이면 낮음) */
export const LOW_END_CORES = 4;
export const LOW_END_MEMORY_GB = 3;

/** 소프트웨어 WebGL(GPU 없음)로 보이는 RENDERER 문자열 */
export const SOFTWARE_GL_PATTERN = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** 판 중 자동 하향 기준 */
export const FPS_WATCH = {
  /** 판 시작 뒤 이 시간 동안은 재지 않는다 (텍스처 생성 · 첫 합성 같은 시작 비용) */
  warmupMs: 5000,
  /** 평균이 이 값 미만이면 느린 상태 */
  minFps: 40,
  /** 느린 상태가 이 시간을 넘게 이어지면 한 단계 내린다 */
  sustainMs: 10000,
  /** 평균을 내는 구간 */
  windowMs: 1000,
  /** 샘플이 이보다 오래 끊기면(백그라운드 탭 등) 처음부터 다시 잰다 */
  gapMs: 1000,
} as const;

export type FpsWatchConfig = { readonly [K in keyof typeof FPS_WATCH]: number };

/** ?quality 값 해석 (high · medium · low, 대소문자 · 공백 무시). 그 밖에는 null */
export function parseQuality(raw: string | null): QualityTier | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  return isQualityTier(v) ? v : null;
}

/** 로비 선택지 해석 */
export function parseQualityChoice(raw: string): QualityChoice | null {
  return raw === 'auto' ? 'auto' : parseQuality(raw);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 브라우저 localStorage (사생활 보호 모드 · 차단된 저장소에서는 접근만으로 예외가 날 수 있다) */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 저장된 품질 (없거나 읽을 수 없으면 null) */
export function loadSavedQuality(storage: StorageLike | null = browserStorage()): QualityTier | null {
  if (!storage) return null;
  try {
    return parseQuality(storage.getItem(QUALITY_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** 로비에서 고른 값을 저장한다. '자동'이면 저장값을 지운다. 저장소를 못 쓰면 false */
export function saveQualityChoice(
  choice: QualityChoice,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    if (choice === 'auto') storage.removeItem(QUALITY_STORAGE_KEY);
    else storage.setItem(QUALITY_STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

export function isSoftwareGl(rendererName: string | null | undefined): boolean {
  return typeof rendererName === 'string' && SOFTWARE_GL_PATTERN.test(rendererName);
}

/** 터치 위주 기기: 거친 포인터가 주 입력이고 정밀 포인터(마우스 · 트랙패드)가 하나도 없다 */
export function isTouchDevice(coarsePointer: boolean, anyFinePointer: boolean): boolean {
  return coarsePointer && !anyFinePointer;
}

export interface QualityEnv {
  /** ?quality */
  url: QualityTier | null;
  /** 로비에서 고른 값 */
  saved: QualityTier | null;
  renderer: RendererKind;
  /** 소프트웨어 WebGL (SwiftShader · llvmpipe 등) */
  softwareGl: boolean;
  touch: boolean;
  /** navigator.hardwareConcurrency (모르면 null) */
  cores: number | null;
  /** navigator.deviceMemory GB (모르면 null) */
  memory: number | null;
}

/**
 * 자동 규칙: Canvas 렌더러 · 소프트웨어 WebGL → 낮음, 터치 기기 → 중간(코어 4개 이하 또는 메모리 3GB 이하면 낮음),
 * 하드웨어 WebGL PC → 높음. PC는 코어 수 · 메모리로 내리지 않는다(사무용 노트북 다수가 4코어/8GB라 잘못 켜진다).
 * 느린 PC는 판 중 FPS 감시가 내린다.
 */
export function autoQuality(env: QualityEnv): QualityTier {
  if (env.renderer === 'canvas' || env.softwareGl) return 'low';
  if (env.touch) {
    const fewCores = env.cores !== null && env.cores > 0 && env.cores <= LOW_END_CORES;
    const littleMemory = env.memory !== null && env.memory > 0 && env.memory <= LOW_END_MEMORY_GB;
    return fewCores || littleMemory ? 'low' : 'medium';
  }
  return 'high';
}

export function detectQuality(env: QualityEnv): { tier: QualityTier; source: QualitySource } {
  if (env.url) return { tier: env.url, source: 'url' };
  if (env.saved) return { tier: env.saved, source: 'saved' };
  return { tier: autoQuality(env), source: 'auto' };
}

/**
 * 판 중 FPS 감시: 예열 뒤 최근 1초 평균이 기준 미만인 상태가 정해진 시간을 넘게 이어지면 한 번 알린다.
 * 판마다 새로 만든다(판당 최대 1번). 평균이 기준 이상으로 돌아오면 느린 상태를 처음부터 다시 잰다.
 */
export class FpsWatch {
  private readonly samples: { t: number; fps: number }[] = [];
  private sum = 0;
  private lowSince: number | null = null;
  private lastAt: number | null = null;
  private done = false;

  constructor(
    private readonly startMs: number,
    private readonly cfg: FpsWatchConfig = FPS_WATCH,
  ) {}

  /** 이미 알렸는가 (판당 1번) */
  get fired(): boolean {
    return this.done;
  }

  /** 최근 구간 평균 FPS (샘플이 없으면 0) */
  get average(): number {
    return this.samples.length > 0 ? this.sum / this.samples.length : 0;
  }

  /** 프레임마다 부른다. 지금 한 단계 내려야 하면 true (판당 한 번만) */
  sample(nowMs: number, fps: number): boolean {
    if (this.done) return false;
    if (this.lastAt !== null && nowMs - this.lastAt > this.cfg.gapMs) this.reset();
    this.lastAt = nowMs;
    if (nowMs - this.startMs < this.cfg.warmupMs) return false;
    if (!Number.isFinite(fps) || fps < 0) return false;
    this.samples.push({ t: nowMs, fps });
    this.sum += fps;
    while (this.samples.length > 0 && nowMs - (this.samples[0]?.t ?? nowMs) > this.cfg.windowMs) {
      const old = this.samples.shift();
      if (old) this.sum -= old.fps;
    }
    if (this.average >= this.cfg.minFps) {
      this.lowSince = null;
      return false;
    }
    this.lowSince ??= nowMs;
    if (nowMs - this.lowSince > this.cfg.sustainMs) {
      this.done = true;
      return true;
    }
    return false;
  }

  private reset(): void {
    this.samples.length = 0;
    this.sum = 0;
    this.lowSince = null;
  }
}

/**
 * 런타임 연결 (main.ts가 채운다). 로비의 품질 선택과 판 중 자동 하향이 부른다.
 * gfx/state.ts의 probeSlot과 같은 방식: 이 파일은 순수 로직만 두고 실제 적용은 진입점이 한다.
 */
export const qualityHooks: {
  /** 로비에서 고른 값을 바로 적용 (저장은 부르는 쪽이 saveQualityChoice로 먼저 한다) */
  choose: ((choice: QualityChoice) => void) | null;
  /** 판 중 한 단계 내린다 (이미 낮음이면 false) */
  downgrade: ((measuredFps: number) => boolean) | null;
} = { choose: null, downgrade: null };
