// 그래픽 품질: 자동 선택 · 저장 · 판 중 FPS 감시 (순수 로직, Phaser를 import하지 않는다).
// 우선순위: ?quality > 로비에서 고른 값(이번 세션에서 고른 값 > localStorage 'decoy:quality') > 자동
// (MOBILE_PLAN M10 '그래픽 품질 단계'). 아래 FPS · 기기 기준값은 판정과 무관한 그래픽 값이라 balance.json이 아니라 여기 둔다.
import { isQualityTier, lowerTier, type QualityTier, type RendererKind } from './presets';

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

/**
 * 하향 효과 확인: 판 중 자동 하향 뒤 FPS가 실제로 올랐는지 같은 판에서 다시 잰다.
 * 화면 갱신이 30Hz로 묶인 기기(에너지 절약 · 저전력 모드, 30Hz 모니터)는 렌더 부하와 상관없이 rAF 빈도가 30이라
 * 내려도 오르지 않는다 → 원래 단계로 되돌리고 이번 세션에서는 자동 하향을 끈다.
 */
export const DOWNGRADE_CHECK = {
  /**
   * 하향 직후 이 시간 동안은 재지 않는다: 백버퍼 · 안개 재구성 비용, 그리고 Phaser actualFps가
   * 1초마다 0.25씩만 따라가는 지수평균이라 바뀐 값에 다가갈 시간
   */
  settleMs: 3000,
  /** 그 뒤 이 시간 동안 평균을 낸다 */
  measureMs: 10000,
  /** 하향 전 평균보다 이 비율 이상 오르거나 */
  minGainRatio: 0.15,
  /** 이 FPS 이상 오르면 효과 있음. 둘 다 못 미치면 효과 없음 */
  minGainFps: 5,
} as const;

export type DowngradeCheckConfig = { readonly [K in keyof typeof DOWNGRADE_CHECK]: number };

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
 * detectQuality의 saved 자리에 넣을 값. 이번 세션에서 로비로 고른 값(chosen)이 있으면 저장 성공 여부와 상관없이 그 값을 쓴다
 * (저장소가 막히거나 가득 차도 고른 값이 적용되게): 단계면 그 단계, '자동'이면 남아 있는 저장값도 건너뛰고 자동.
 * 고른 적이 없으면 저장소 값. 출처는 그대로 'saved' · 'auto'로 남는다
 */
export function savedForSession(
  chosen: QualityChoice | null,
  stored: QualityTier | null,
): QualityTier | null {
  if (chosen === null) return stored;
  return chosen === 'auto' ? null : chosen;
}

/**
 * 판 중 FPS 감시: 예열 뒤 최근 1초 평균이 기준 미만인 상태가 정해진 시간을 넘게 이어지면 한 번 알린다.
 * 판마다 새로 만든다(판당 최대 1번). 평균이 기준 이상으로 돌아오면 느린 상태를 처음부터 다시 잰다.
 */
export class FpsWatch {
  private readonly samples: { t: number; fps: number }[] = [];
  private sum = 0;
  private lowSince: number | null = null;
  /** 느린 상태가 이어지는 동안의 샘플 합 · 개수 (하향 전 평균) */
  private lowSum = 0;
  private lowCount = 0;
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

  /** 지금 이어지는 느린 상태 전체의 평균 FPS (느린 상태가 아니면 최근 구간 평균). 하향 효과를 견줄 기준 */
  get slowAverage(): number {
    return this.lowCount > 0 ? this.lowSum / this.lowCount : this.average;
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
      this.clearLow();
      return false;
    }
    this.lowSince ??= nowMs;
    this.lowSum += fps;
    this.lowCount += 1;
    if (nowMs - this.lowSince > this.cfg.sustainMs) {
      this.done = true;
      return true;
    }
    return false;
  }

  private clearLow(): void {
    this.lowSince = null;
    this.lowSum = 0;
    this.lowCount = 0;
  }

  private reset(): void {
    this.samples.length = 0;
    this.sum = 0;
    this.clearLow();
  }
}

/** 하향 뒤 평균(after)이 하향 전(before)보다 의미 있게 올랐는가: +15% 이상 또는 +5fps 이상 */
export function downgradeHelped(
  before: number,
  after: number,
  cfg: DowngradeCheckConfig = DOWNGRADE_CHECK,
): boolean {
  const gain = after - before;
  return gain >= before * cfg.minGainRatio || gain >= cfg.minGainFps;
}

export type DowngradeVerdict = 'helped' | 'noEffect';

/** 하향 한 번의 효과 확인: 가라앉을 시간을 기다린 뒤 정해진 시간 동안 평균을 내서 하향 전 평균과 견준다 */
export class DowngradeCheck {
  private sum = 0;
  private count = 0;
  private measureFrom: number;
  private lastAt: number | null = null;

  constructor(
    startMs: number,
    readonly fpsBefore: number,
    private readonly settleMs: number = DOWNGRADE_CHECK.settleMs,
    private readonly cfg: DowngradeCheckConfig = DOWNGRADE_CHECK,
    private readonly gapMs: number = FPS_WATCH.gapMs,
  ) {
    this.measureFrom = startMs + settleMs;
  }

  /** 지금까지 잰 평균 (아직 없으면 0) */
  get average(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  /** 프레임마다 부른다. 판단이 나면 결과, 아직이면 null */
  sample(nowMs: number, fps: number): DowngradeVerdict | null {
    // 샘플이 오래 끊기면(백그라운드 탭 · 결과 화면) 가라앉는 시간부터 다시
    if (this.lastAt !== null && nowMs - this.lastAt > this.gapMs) {
      this.sum = 0;
      this.count = 0;
      this.measureFrom = nowMs + this.settleMs;
    }
    this.lastAt = nowMs;
    if (nowMs < this.measureFrom) return null;
    if (!Number.isFinite(fps) || fps < 0) return null;
    this.sum += fps;
    this.count += 1;
    if (nowMs - this.measureFrom < this.cfg.measureMs) return null;
    return downgradeHelped(this.fpsBefore, this.average, this.cfg) ? 'helped' : 'noEffect';
  }
}

/** 판 중 자동 조정이 내린 결정 (main.ts가 적용한다) */
export type AutoQualityAction =
  | { kind: 'downgrade'; from: QualityTier; to: QualityTier; fpsBefore: number }
  | { kind: 'keep'; tier: QualityTier; fpsBefore: number; fpsAfter: number }
  | { kind: 'revert'; from: QualityTier; to: QualityTier; fpsBefore: number; fpsAfter: number };

/** on = 감시 중, checking = 하향 효과 확인 중, off = 효과가 없어 되돌린 뒤 이번 세션에서 끔 */
export type AutoDowngradeStatus = 'on' | 'checking' | 'off';

/**
 * 판 중 자동 하향 (세션 단위 상태, 저장하지 않는다).
 *  - 판마다 FpsWatch로 잰다: 예열 5초 뒤 평균 40fps 미만이 10초를 넘으면 한 단계 내린다 (판당 최대 1번)
 *  - 내린 뒤 같은 판에서 DowngradeCheck로 효과를 본다 (판이 먼저 끝나면 다음 판 예열 뒤 이어서)
 *  - 효과 없음 → 원래 단계로 되돌리고 이번 세션에서는 자동 하향을 끈다
 *  - 효과 있음 → 그 단계를 유지하고, 다음 판에서도 느리면 한 단계 더 내릴 수 있다
 * 확인이 끝나기 전에는 더 내리지 않는다.
 */
export class AutoDowngrade {
  private watch: FpsWatch | null = null;
  private check: DowngradeCheck | null = null;
  /** 효과 확인을 기다리는 하향 (판이 끝나도 남는다) */
  private pending: { from: QualityTier; to: QualityTier; fpsBefore: number } | null = null;
  private disabled = false;
  private lastAverage = 0;

  constructor(
    private readonly watchCfg: FpsWatchConfig = FPS_WATCH,
    private readonly checkCfg: DowngradeCheckConfig = DOWNGRADE_CHECK,
  ) {}

  get status(): AutoDowngradeStatus {
    return this.disabled ? 'off' : this.pending ? 'checking' : 'on';
  }

  /** 디버그 표시용 최근 평균 FPS (감시 · 확인이 아직 잰 값이 없으면 마지막 값) */
  get average(): number {
    const now = this.check && this.check.average > 0 ? this.check.average : (this.watch?.average ?? 0);
    return now > 0 ? now : this.lastAverage;
  }

  /** 판 시작 */
  beginMatch(nowMs: number): void {
    this.watch = null;
    this.check = null;
    if (this.disabled) return;
    if (this.pending) {
      // 지난 판이 확인 전에 끝났다: 이번 판 시작 비용이 가라앉은 뒤(예열) 이어서 잰다
      this.check = new DowngradeCheck(
        nowMs,
        this.pending.fpsBefore,
        this.watchCfg.warmupMs,
        this.checkCfg,
        this.watchCfg.gapMs,
      );
    } else {
      this.watch = new FpsWatch(nowMs, this.watchCfg);
    }
  }

  /** 판 끝 (확인 중이던 하향은 다음 판으로 넘어간다) */
  endMatch(): void {
    this.watch = null;
    this.check = null;
  }

  /** 사용자가 품질을 직접 고르면 확인 중이던 하향은 잊는다(되돌릴 대상이 바뀜). 꺼진 상태는 그대로 */
  cancelPending(): void {
    this.pending = null;
    this.check = null;
  }

  /** 판 중 보이는 탭에서 프레임마다 부른다. tier = 지금 품질 */
  sample(nowMs: number, fps: number, tier: QualityTier): AutoQualityAction | null {
    if (this.disabled) return null;
    this.lastAverage = this.average;
    const p = this.pending;
    if (p) {
      const verdict = this.check?.sample(nowMs, fps) ?? null;
      if (verdict === null || !this.check) return null;
      const fpsAfter = this.check.average;
      this.pending = null;
      this.check = null;
      if (verdict === 'helped') return { kind: 'keep', tier: p.to, fpsBefore: p.fpsBefore, fpsAfter };
      this.disabled = true;
      return { kind: 'revert', from: p.to, to: p.from, fpsBefore: p.fpsBefore, fpsAfter };
    }
    const watch = this.watch;
    if (!watch || !watch.sample(nowMs, fps)) return null;
    this.watch = null;
    const lower = lowerTier(tier);
    if (!lower) return null;
    const fpsBefore = watch.slowAverage;
    this.pending = { from: tier, to: lower, fpsBefore };
    this.check = new DowngradeCheck(
      nowMs,
      fpsBefore,
      this.checkCfg.settleMs,
      this.checkCfg,
      this.watchCfg.gapMs,
    );
    return { kind: 'downgrade', from: tier, to: lower, fpsBefore };
  }
}

/** 이번 세션(페이지)의 자동 하향 상태. 새로고침하면 처음부터 (저장하지 않는다) */
export const sessionAutoDowngrade = new AutoDowngrade();

/**
 * 런타임 연결 (main.ts가 채운다). 로비의 품질 선택과 판 중 자동 조정이 부른다.
 * gfx/state.ts의 probeSlot과 같은 방식: 이 파일은 순수 로직만 두고 실제 적용은 진입점이 한다.
 */
export const qualityHooks: {
  /** 로비에서 고른 값을 바로 적용 (저장은 부르는 쪽이 saveQualityChoice로 먼저 한다. 저장에 실패해도 이번 세션에는 적용) */
  choose: ((choice: QualityChoice) => void) | null;
  /** 판 중 자동 조정(한 단계 내림 · 효과 없던 하향 되돌림 · 유지)을 적용한다 */
  auto: ((action: AutoQualityAction) => void) | null;
} = { choose: null, auto: null };
