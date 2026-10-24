// 그래픽 품질: 자동 선택 · 저장 · 판 중 FPS 감시 (순수 로직, Phaser를 import하지 않는다).
// 우선순위: ?quality > 로비에서 고른 값(이번 세션에서 고른 값 > 저장값 'decoy:quality') > 자동
// (MOBILE_PLAN M10 '그래픽 품질 단계'). 아래 FPS · 기기 기준값은 판정과 무관한 그래픽 값이라 balance.json이 아니라 여기 둔다.
// M12: 터치 기기는 판 중 하향 기준이 높고(TOUCH_FPS_WATCH), 판 중 하향으로 확인한 단계를
// 다음 접속에도 쓴다(자동일 때, 온라인 · 연습 따로 'decoy:perf'). PC는 세션 단위(저장하지 않음).
// 렌더링 최적화: 하향 기준은 목표 FPS에 비례하고(60Hz 기준값 × 기준 목표 / 60, 기준 목표는 120까지), 자동 프레임 제한에서는
// 품질보다 목표 FPS(60)를 먼저 낮추며, 자동으로 내린 단계는 여유가 이어지면 하나씩 되돌린다(AutoDowngrade).
import { STORAGE_KEYS, browserStorage, readKey, removeKey, writeKey, type StorageLike } from '../storageKeys';
import { lowerRate } from './framePacing';
import { QUALITY_TIERS, isQualityTier, lowerTier, type QualityTier, type RendererKind } from './presets';

// 저장소 접근은 storageKeys.ts에서만 (M12). 기존 import 경로를 지키려고 다시 내보낸다
export { browserStorage, type StorageLike };

/** 로비 선택지: 자동 또는 단계 하나 */
export type QualityChoice = 'auto' | QualityTier;
export type QualitySource = 'url' | 'saved' | 'auto';

export const QUALITY_STORAGE_KEY = STORAGE_KEYS.quality.key;

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
 * 터치 기기의 판 중 자동 하향 기준 (M12 6번, 60Hz 목표 기준 값). 목표(사용자 2026-10-13)는 120Hz 고사양 120fps ·
 * 중급 휴대폰 60fps 안정 · 저사양 30fps 이상이고, 기준은 기준 목표의 5/6이다(60Hz에서 50, 120Hz에서 100, minFpsFor):
 * 높음 · 중간에서 1초 평균이 기준 미만인 상태가 10초 넘게 이어지면 한 단계 내린다.
 * PC의 2/3(60Hz에서 40)은 터치에서 너무 낮다(중간 45fps 휴대폰이 그대로 남는다). 낮음은 더 내릴 단계가 없다 — 낮음의 30fps는
 * 낮음 구성(Canvas 안개 · 효과 없음 · 프레임 절반)과 터치 낮음의 해상도(presets TOUCH_LOW_OVERRIDE)로 맞춘다.
 * 예열 · 지속 · 평균 구간 · 끊김은 PC와 같고, 효과 확인(DOWNGRADE_CHECK)도 같다(30Hz로 묶인 휴대폰은 되돌린다)
 */
export const TOUCH_FPS_WATCH: FpsWatchConfig = { ...FPS_WATCH, minFps: 50 };

/** 기기에 맞는 판 중 하향 기준 */
export function fpsWatchFor(touch: boolean): FpsWatchConfig {
  return touch ? TOUCH_FPS_WATCH : FPS_WATCH;
}

// ───────────── 목표 FPS (렌더링 최적화) ─────────────

/** 하향 기준 FPS(FPS_WATCH.minFps · TOUCH_FPS_WATCH.minFps)를 정한 목표 FPS. 다른 목표에서는 비례해서 쓴다 */
export const BASE_TARGET_HZ = 60;

/**
 * 하향 기준을 비례시키는 목표의 상한: 기준 목표 = min(목표, 120). 144 · 165Hz PC 모니터가 144를 못 채웠다는 이유만으로
 * 내려가지 않게 한다(144Hz 화면에서 90fps인 PC는 기준 80 위라 그대로)
 */
export const THRESHOLD_CAP_HZ = 120;

/**
 * 고르지 않은 프레임 (내 움직임 고르기 2026-10-24 DECISIONS 10절, 잔렉 고치기 2026-10-25 DECISIONS 12절). 늦은 프레임 = 간격이
 * 목표 주기 + lateSlack vsync 이상(그리기로 한 vsync를 놓쳐 한 번 더 보인 프레임 — 목표가 화면 / n이면 (n + 0.5) vsync).
 * 자동 프레임 제한에서 지금 목표보다 낮은 약수 사다리 칸(framePacing.rateLadder)이 있을 때, 평균 FPS가 하향 기준 위여도 최근 1초의
 * 늦은 프레임 비율 평균이 maxLateRatio 이상인 상태가 하향과 같은 시간(예열 5초 · 지속 10초)을 넘게 이어지면 목표를 사다리 아래 칸
 * (화면 주사율의 약수: 144 → 72, 165 → 82.5, 120 → 60)으로 낮춘다(rateDown, 품질 그대로). 되돌려 올린 뒤 확인(UpProbation)에서
 * 이 비율이 넘어도 다시 내리고 이번 세션에서는 올리지 않는다.
 * 비율 0.05: 144Hz에서 약 137fps(초당 늦은 프레임 7개) 아래면 내린다. 예전 0.15는 144Hz 125fps · 165Hz 143.5fps 이상을 그대로 두어
 * 초당 20개 넘는 늦은 프레임이 섞였고, 100~130fps를 오가면 1초 평균이 0.15를 넘나들어 10초 지속이 계속 처음부터 다시 시작했다.
 * 품질 하향 · 고정 제한(60 · 120 · 절반)에는 쓰지 않는다
 */
export const PACING_WATCH = {
  lateSlack: 0.5,
  maxLateRatio: 0.05,
} as const;

/** 이 목표 · 제한에서 고르지 않은 프레임을 목표 FPS 낮춤 이유로 보는가 (아니면 Infinity — 보지 않음) */
export function maxLateFor(ctx: { targetHz: number; displayHz: number; canRateFallback: boolean }): number {
  return ctx.canRateFallback && lowerRate(ctx.displayHz, ctx.targetHz) !== null
    ? PACING_WATCH.maxLateRatio
    : Infinity;
}

/** 늦은 프레임 기준 (frameStats.window의 late): 목표 주기 + lateSlack vsync */
export function lateWindowFor(
  targetHz: number,
  displayHz: number,
  out: { periodMs: number; slackMs: number },
): void {
  out.periodMs = 1000 / Math.max(1, targetHz);
  out.slackMs = (PACING_WATCH.lateSlack * 1000) / Math.max(1, displayHz);
}

/**
 * 목표 FPS에 맞춘 하향 기준: 60Hz 기준값 × min(목표, 120) / 60.
 * PC 40 → 기준 목표의 2/3(120Hz 80), 터치 50 → 5/6(120Hz 100). 목표가 이상한 값이면 60으로 본다
 */
export function minFpsFor(cfg: FpsWatchConfig, targetHz: number): number {
  const hz = Number.isFinite(targetHz) && targetHz > 0 ? targetHz : BASE_TARGET_HZ;
  return (cfg.minFps * Math.min(hz, THRESHOLD_CAP_HZ)) / BASE_TARGET_HZ;
}

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
  /** 판 중 측정으로 기억한 단계 (터치 기기 · 이번 모드, 없으면 null). 자동일 때만 쓴다 */
  perf?: PerfRecord | null;
  /**
   * 시작 목표 FPS (프레임 제한과 화면 주사율로 정한 값, 자동 목표 낮춤 전 — framePacing targetHzFor(limit, displayHz, null)).
   * 기억은 이 값이 기억을 만든 판의 시작 목표(PerfRecord.hz)와 같을 때만 쓴다. 없으면 60
   */
  targetHz?: number;
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

/**
 * 시작 단계. 자동이면 기억한 단계(판 중 측정)가 자동보다 낮을 때 그것을 쓴다(출처는 그대로 'auto').
 * 기억은 그때의 자동 단계(base)와 시작 목표 FPS(hz)가 지금과 같을 때만 쓴다: 렌더러 · 기기 판단이나 프레임 제한 · 화면
 * 주사율이 바뀌었으면 옛 측정이다(120fps를 버티지 못해 내린 단계는 60fps 목표에서는 맞지 않는다)
 */
export function detectQuality(env: QualityEnv): { tier: QualityTier; source: QualitySource } {
  if (env.url) return { tier: env.url, source: 'url' };
  if (env.saved) return { tier: env.saved, source: 'saved' };
  const auto = autoQuality(env);
  const perf = env.perf;
  if (perf && perf.base === auto && perf.hz === (env.targetHz ?? BASE_TARGET_HZ))
    return { tier: lowestTier(auto, perf.tier), source: 'auto' };
  return { tier: auto, source: 'auto' };
}

/** 두 단계 중 낮은 쪽 */
export function lowestTier(a: QualityTier, b: QualityTier): QualityTier {
  return QUALITY_TIERS.indexOf(a) >= QUALITY_TIERS.indexOf(b) ? a : b;
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

// ───────────── 판 중 측정 기억 (터치 기기, M12) ─────────────

/**
 * 판 중 측정을 따로 기억하는 모드: 온라인(서버 판) · 연습(기기 안 시뮬레이션이 CPU를 더 쓴다, M13b). 둘 다 쓴다 — 판 장면은
 * app.practicing으로 모드를 골라 beginMatch에 넘기고, main.ts는 판 장면을 만들기 전에 같은 모드의 기억으로 시작 품질을 정한다
 * (enterPerfMode, 검토 반영 F11)
 */
export type PerfMode = 'online' | 'practice';
export const PERF_MODES: readonly PerfMode[] = ['online', 'practice'];

/** 한 모드의 기억: 판 중 조정으로 확인한 단계와 그때의 자동 단계(기기 기준) · 시작 목표 FPS */
export interface PerfRecord {
  tier: QualityTier;
  base: QualityTier;
  /** 기억을 만든 판의 시작 목표 FPS (자동 목표 낮춤 전). 저장할 때 60이면 적지 않는다(M12 모양 그대로) */
  hz: number;
}

export type PerfMemory = Partial<Record<PerfMode, PerfRecord>>;

/**
 * 저장 형식 판 (모양이 바뀌면 올리고 옛 값은 버린다). 2: 시작 목표 FPS(hz)를 함께 둔다.
 * 1판 값은 버린다: 어느 목표에서 잰 것인지 모른다(120Hz 휴대폰도 60Hz 기준값 · Phaser actualFps로 쟀다)
 */
export const PERF_MEMORY_VERSION = 2;

/** 저장한 한 줄의 모양 (hz는 60이 아닐 때만) */
interface StoredPerfRecord {
  tier: QualityTier;
  base: QualityTier;
  hz?: number;
}

/** 기억 한 줄의 시작 목표 FPS 해석: 없으면 60, 양의 유한수가 아니면 깨진 값(null) */
function parsePerfHz(raw: unknown): number | null {
  if (raw === undefined) return BASE_TARGET_HZ;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** 'decoy:perf' 값 해석. 모르는 판 · 깨진 값 · 이상한 단계 · 이상한 목표 FPS는 버린다 */
export function parsePerfMemory(raw: string | null): PerfMemory {
  if (raw === null) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== 'object' || v === null) return {};
  const o = v as Record<string, unknown>;
  if (o.v !== PERF_MEMORY_VERSION) return {};
  const out: PerfMemory = {};
  for (const mode of PERF_MODES) {
    const r = o[mode];
    if (typeof r !== 'object' || r === null) continue;
    const { tier, base, hz } = r as Record<string, unknown>;
    const startHz = parsePerfHz(hz);
    if (isQualityTier(tier) && isQualityTier(base) && startHz !== null)
      out[mode] = { tier, base, hz: startHz };
  }
  return out;
}

/** 기억 읽기 (없거나 읽을 수 없으면 빈 기억) */
export function loadPerfMemory(storage: StorageLike | null = browserStorage()): PerfMemory {
  return parsePerfMemory(readKey('perf', '', storage));
}

/** 저장 모양: 시작 목표가 60이면 hz를 적지 않는다 */
function storedPerfRecord(rec: PerfRecord): StoredPerfRecord {
  return rec.hz === BASE_TARGET_HZ
    ? { tier: rec.tier, base: rec.base }
    : { tier: rec.tier, base: rec.base, hz: rec.hz };
}

/** 한 모드의 기억을 쓴다 (다른 모드 기억은 그대로). 못 쓰면 false */
export function rememberPerf(
  mode: PerfMode,
  rec: PerfRecord,
  storage: StorageLike | null = browserStorage(),
): boolean {
  const old = loadPerfMemory(storage);
  const next: Partial<Record<PerfMode, StoredPerfRecord>> = {};
  for (const m of PERF_MODES) {
    const r = m === mode ? rec : old[m];
    if (r) next[m] = storedPerfRecord(r);
  }
  return writeKey('perf', JSON.stringify({ v: PERF_MEMORY_VERSION, ...next }), '', storage);
}

/** 기억을 모두 지운다 (사용자가 로비에서 품질을 직접 고를 때) */
export function forgetPerfMemory(storage: StorageLike | null = browserStorage()): boolean {
  return removeKey('perf', '', storage);
}

/**
 * 판 중 자동 조정 결과를 기억할지: 터치 기기에서 출처가 자동이고, 확인을 마친 단계만 — 효과가 있어 유지한 하향(keep)과
 * 올린 뒤 확인을 통과한 품질 올리기(upKeep tier, 기억을 그 단계로 고친다). 효과가 없어 되돌린 하향(30Hz로 묶인 화면 등)은
 * 기억하지 않는다 — 다음 접속에서 다시 잰다. 시작 단계는 여전히 min(자동, 기억)이라 기억은 자동보다 올리지 못한다.
 * startHz = 이 판의 시작 목표 FPS(자동 목표 낮춤 전, detectQuality의 env.targetHz와 같은 값). 목표 FPS 낮춤 · 올리기는
 * 기억하지 않는다(다음 접속에서 다시 잰다)
 */
export function perfToRemember(
  action: AutoQualityAction,
  touch: boolean,
  source: QualitySource,
  base: QualityTier,
  startHz: number = BASE_TARGET_HZ,
): { mode: PerfMode; rec: PerfRecord } | null {
  if (!touch || source !== 'auto') return null;
  if (action.kind === 'keep' || (action.kind === 'upKeep' && action.step === 'tier'))
    return { mode: action.mode, rec: { tier: action.tier, base, hz: startHz } };
  return null;
}

// ───────────── 판 중 측정 (할당 없는 고리 버퍼) ─────────────

/** 평균 구간 고리 버퍼 크기: 1초 구간에 240Hz 화면의 프레임이 다 들어가고 남는다. 넘치면 가장 오래된 샘플부터 버린다 */
export const SAMPLE_RING_SIZE = 512;

/**
 * 최근 구간(windowMs) 샘플 평균. 고정 크기 typed array 고리 버퍼라 샘플마다 할당하지 않는다
 * (예전 { t, fps } 객체 push + shift는 120Hz에서 초당 객체 120개와 배열 앞당기기를 만들었다)
 */
export class SlidingAverage {
  /** 샘플 시각 · 값 (처음 만든 버퍼를 계속 쓴다) */
  readonly times: Float64Array;
  readonly values: Float64Array;
  private head = 0;
  private size = 0;
  private sum = 0;

  constructor(
    /** 가장 최근 샘플보다 이 시간을 넘게 오래된 샘플은 뺀다 */
    public windowMs: number,
    capacity: number = SAMPLE_RING_SIZE,
  ) {
    this.times = new Float64Array(Math.max(1, Math.floor(capacity)));
    this.values = new Float64Array(this.times.length);
  }

  get count(): number {
    return this.size;
  }

  /** 구간 평균 (샘플이 없으면 0) */
  get average(): number {
    return this.size > 0 ? this.sum / this.size : 0;
  }

  push(t: number, v: number): void {
    const cap = this.times.length;
    if (this.size === cap) this.dropOldest();
    const i = (this.head + this.size) % cap;
    this.times[i] = t;
    this.values[i] = v;
    this.size += 1;
    this.sum += v;
    while (this.size > 0 && t - (this.times[this.head] ?? t) > this.windowMs) this.dropOldest();
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
    this.sum = 0;
  }

  private dropOldest(): void {
    this.sum -= this.values[this.head] ?? 0;
    this.head = (this.head + 1) % this.times.length;
    this.size -= 1;
    // 더하고 빼며 쌓인 부동소수 오차는 다 비울 때 털어 낸다
    if (this.size === 0) this.sum = 0;
  }
}

/**
 * 판 중 FPS 감시: 예열 뒤 최근 1초 평균이 기준 미만인 상태가 정해진 시간을 넘게 이어지면 한 번 알린다.
 * 판마다 다시 잰다(restart, 같은 버퍼). 평균이 기준 이상으로 돌아오면 느린 상태를 처음부터 다시 잰다.
 */
export class FpsWatch {
  private readonly win: SlidingAverage;
  /** 최근 1초 늦은 프레임 비율 (PACING_WATCH, 고르지 않은 프레임) */
  private readonly lateWin: SlidingAverage;
  private lowSince: number | null = null;
  /** 느린 상태가 이어지는 동안의 샘플 합 · 개수 (하향 전 평균) */
  private lowSum = 0;
  private lowCount = 0;
  private lastAt: number | null = null;
  private done = false;

  constructor(
    private startMs: number,
    private cfg: FpsWatchConfig = FPS_WATCH,
  ) {
    this.win = new SlidingAverage(cfg.windowMs);
    this.lateWin = new SlidingAverage(cfg.windowMs);
  }

  /** 이미 알렸는가 (판당 1번) */
  get fired(): boolean {
    return this.done;
  }

  /** 최근 구간 평균 FPS (샘플이 없으면 0) */
  get average(): number {
    return this.win.average;
  }

  /** 지금 이어지는 느린 상태 전체의 평균 FPS (느린 상태가 아니면 최근 구간 평균). 하향 효과를 견줄 기준 */
  get slowAverage(): number {
    return this.lowCount > 0 ? this.lowSum / this.lowCount : this.average;
  }

  /** 처음부터 다시 잰다 (판 시작 · 목표 FPS 변경, 예열부터). 같은 버퍼를 쓴다 */
  restart(startMs: number, cfg: FpsWatchConfig = this.cfg): void {
    this.startMs = startMs;
    this.cfg = cfg;
    this.win.windowMs = cfg.windowMs;
    this.lateWin.windowMs = cfg.windowMs;
    this.lastAt = null;
    this.done = false;
    this.reset();
  }

  /**
   * 프레임마다 부른다. minFps = 지금 목표의 하향 기준(minFpsFor). late = 최근 1초 늦은 프레임 비율, maxLate = 그 기준
   * (maxLateFor — 보지 않으면 Infinity): 1초 평균이 하향 기준 미만이거나 늦은 비율 평균이 기준 이상이면 느린 상태.
   * 지금 한 단계 내려야 하면 true (판당 한 번만)
   */
  sample(
    nowMs: number,
    fps: number,
    minFps: number = this.cfg.minFps,
    late = 0,
    maxLate: number = Infinity,
  ): boolean {
    if (this.done) return false;
    if (this.lastAt !== null && nowMs - this.lastAt > this.cfg.gapMs) this.reset();
    this.lastAt = nowMs;
    if (nowMs - this.startMs < this.cfg.warmupMs) return false;
    if (!Number.isFinite(fps) || fps < 0) return false;
    this.win.push(nowMs, fps);
    this.lateWin.push(nowMs, Number.isFinite(late) && late > 0 ? late : 0);
    if (this.win.average >= minFps && !(this.lateWin.average >= maxLate)) {
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
    this.win.clear();
    this.lateWin.clear();
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

/** 가라앉을 시간 뒤 정해진 시간 동안의 평균. 샘플이 오래 끊기면(백그라운드 탭 · 결과 화면) 가라앉는 시간부터 다시 */
class SettledMean {
  private sum = 0;
  private count = 0;
  private measureFrom: number;
  private lastAt: number | null = null;

  constructor(
    startMs: number,
    private readonly settleMs: number,
    private readonly measureMs: number,
    private readonly gapMs: number,
  ) {
    this.measureFrom = startMs + settleMs;
  }

  get average(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  /** 샘플을 넣는다. 측정 시간을 다 채웠으면 true */
  add(nowMs: number, v: number): boolean {
    if (this.lastAt !== null && nowMs - this.lastAt > this.gapMs) {
      this.sum = 0;
      this.count = 0;
      this.measureFrom = nowMs + this.settleMs;
    }
    this.lastAt = nowMs;
    if (nowMs < this.measureFrom) return false;
    if (!Number.isFinite(v) || v < 0) return false;
    this.sum += v;
    this.count += 1;
    return nowMs - this.measureFrom >= this.measureMs;
  }
}

/** 하향 한 번의 효과 확인: 가라앉을 시간을 기다린 뒤 정해진 시간 동안 평균을 내서 하향 전 평균과 견준다 */
export class DowngradeCheck {
  private readonly mean: SettledMean;

  constructor(
    startMs: number,
    readonly fpsBefore: number,
    settleMs: number = DOWNGRADE_CHECK.settleMs,
    private readonly cfg: DowngradeCheckConfig = DOWNGRADE_CHECK,
    gapMs: number = FPS_WATCH.gapMs,
  ) {
    this.mean = new SettledMean(startMs, settleMs, cfg.measureMs, gapMs);
  }

  /** 지금까지 잰 평균 (아직 없으면 0) */
  get average(): number {
    return this.mean.average;
  }

  /** 프레임마다 부른다. 판단이 나면 결과, 아직이면 null */
  sample(nowMs: number, fps: number): DowngradeVerdict | null {
    if (!this.mean.add(nowMs, fps)) return null;
    return downgradeHelped(this.fpsBefore, this.average, this.cfg) ? 'helped' : 'noEffect';
  }
}

// ───────────── 되돌려 올리기 (렌더링 최적화) ─────────────

/**
 * 판 중 자동 올리기: 자동으로 내린 단계(품질 · 목표 FPS)를 가장 최근 것부터 하나씩 되돌린다. 자동으로 내리기 전 상태
 * (시작 단계 · 로비에서 고른 값 · ?quality, 시작 목표 FPS)보다 올리지 않는다.
 * 여유 = 최근 1초 평균 FPS ≥ 지금 목표 × 0.95 이고 작업 시간 p95 ≤ 예산 × 0.5. 예산 = 1000 / 지금 목표(품질 올리기) 또는
 * 1000 / 올린 뒤 목표(목표 FPS 올리기). 예열 뒤 · 마지막 변경 20초 뒤부터 여유가 15초 넘게 이어지면 올린다
 */
export const UP_WATCH = {
  /** 마지막 변경(내림 · 올림 · 품질 · 목표 FPS가 바뀜) 뒤 이 시간 동안은 여유를 세지 않는다 */
  quietMs: 20000,
  /** 여유 상태가 이 시간을 넘게 이어지면 한 단계 올린다 */
  sustainMs: 15000,
  /** 여유: 최근 1초 평균 FPS가 지금 목표의 이 비율 이상 */
  minFpsRatio: 0.95,
  /** 여유: 작업 시간 p95가 프레임 예산의 이 비율 이하 */
  maxWorkRatio: 0.5,
} as const;

export type UpWatchConfig = { readonly [K in keyof typeof UP_WATCH]: number };

/**
 * 올린 뒤 확인: 가라앉을 시간 뒤 정해진 시간 동안의 평균이 지금 목표의 하향 기준(minFpsFor) 미만이면 다시 내리고 이번 세션에서는
 * 더 올리지 않는다. 다음 판으로 미룬 품질 올리기 · 판이 끝나 끊긴 확인은 그 판의 예열(FPS_WATCH.warmupMs)을 가라앉는 시간으로 쓴다
 */
export const UP_PROBATION = {
  settleMs: 3000,
  measureMs: 10000,
} as const;

export type UpProbationConfig = { readonly [K in keyof typeof UP_PROBATION]: number };

/** 여유 감시: 여유 조건이 정해진 시간을 넘게 이어지면 알린다 (고리 버퍼 1초 평균, 할당 없음) */
export class UpWatch {
  private readonly win: SlidingAverage;
  private since: number | null = null;
  private lastAt: number | null = null;

  constructor(
    private readonly cfg: UpWatchConfig = UP_WATCH,
    windowMs: number = FPS_WATCH.windowMs,
    private readonly gapMs: number = FPS_WATCH.gapMs,
  ) {
    this.win = new SlidingAverage(windowMs);
  }

  /** 최근 1초 평균 FPS (샘플이 없으면 0) */
  get average(): number {
    return this.win.average;
  }

  reset(): void {
    this.win.clear();
    this.since = null;
    this.lastAt = null;
  }

  /**
   * 프레임마다 부른다. targetHz = 지금 목표, budgetHz = 작업 예산을 정하는 목표(목표 FPS를 올릴 때는 올린 뒤 목표),
   * openAt = 이 시각 전에는 여유를 세지 않는다(예열 끝 · 마지막 변경 + quietMs). 여유가 sustainMs를 넘게 이어지면 true
   */
  sample(
    nowMs: number,
    fps: number,
    workP95: number,
    targetHz: number,
    budgetHz: number,
    openAt: number,
  ): boolean {
    if (this.lastAt !== null && nowMs - this.lastAt > this.gapMs) {
      this.win.clear();
      this.since = null;
    }
    this.lastAt = nowMs;
    if (!Number.isFinite(fps) || fps < 0) return false;
    this.win.push(nowMs, fps);
    const roomy =
      nowMs >= openAt &&
      this.win.average >= this.cfg.minFpsRatio * targetHz &&
      Number.isFinite(workP95) &&
      workP95 >= 0 &&
      workP95 <= (this.cfg.maxWorkRatio * 1000) / budgetHz;
    if (!roomy) {
      this.since = null;
      return false;
    }
    this.since ??= nowMs;
    return nowMs - this.since > this.cfg.sustainMs;
  }
}

export type UpProbationVerdict = 'pass' | 'fail';

/** 올린 뒤 확인 한 번: 가라앉을 시간 뒤 정해진 시간 동안 평균을 내서 하향 기준과 견준다 */
export class UpProbation {
  private readonly mean: SettledMean;
  /** 같은 구간의 늦은 프레임 비율 평균 (PACING_WATCH) */
  private readonly lateMean: SettledMean;

  constructor(
    startMs: number,
    settleMs: number = UP_PROBATION.settleMs,
    measureMs: number = UP_PROBATION.measureMs,
    gapMs: number = FPS_WATCH.gapMs,
  ) {
    this.mean = new SettledMean(startMs, settleMs, measureMs, gapMs);
    this.lateMean = new SettledMean(startMs, settleMs, measureMs, gapMs);
  }

  get average(): number {
    return this.mean.average;
  }

  /** 늦은 프레임 비율 평균 (디버그 · 시험) */
  get lateAverage(): number {
    return this.lateMean.average;
  }

  /**
   * 프레임마다 부른다. minFps = 지금 목표의 하향 기준, maxLate = 늦은 프레임 비율 기준(보지 않으면 Infinity).
   * 판단이 나면 결과(평균 < 기준이거나 늦은 비율 ≥ 기준이면 fail), 아직이면 null
   */
  sample(
    nowMs: number,
    fps: number,
    minFps: number,
    late = 0,
    maxLate: number = Infinity,
  ): UpProbationVerdict | null {
    this.lateMean.add(nowMs, Number.isFinite(late) && late > 0 ? late : 0);
    if (!this.mean.add(nowMs, fps)) return null;
    return this.mean.average < minFps || this.lateMean.average >= maxLate ? 'fail' : 'pass';
  }
}

// ───────────── 판 중 적응형 품질 (세션) ─────────────

/**
 * 프레임 측정 한 번 (frameStats 최근 1초): 렌더 FPS와 작업 시간 p95(ms), 늦은 프레임 비율(PACING_WATCH, 없으면 0).
 * injectFps(f)면 fps = f, workP95 = 1000 / f, late = 0
 */
export interface FrameSample {
  fps: number;
  workP95: number;
  late?: number;
}

/** 프레임 페이싱 상태 (framePacing Pacer에서) */
export interface AdaptContext {
  /** 지금 목표 FPS (프레임 제한 · 화면 주사율 · 자동 목표 낮춤을 반영한 값) */
  targetHz: number;
  /** 잰 화면 주사율 (60 아래로는 보지 않는다) */
  displayHz: number;
  /** 목표 FPS를 낮출 수 있는가: 프레임 제한이 '자동'이고 화면이 60Hz보다 빠를 때. 고정 제한(60 · 120)은 목표를 바꾸지 않는다 */
  canRateFallback: boolean;
}

/** 자동으로 내린 단계 하나 (되돌려 올릴 때 가장 최근 것부터). rate = 목표 FPS(from → to) */
export type AutoStep =
  { kind: 'tier'; from: QualityTier; to: QualityTier } | { kind: 'rate'; from: number; to: number };

type TierStep = Extract<AutoStep, { kind: 'tier' }>;

/** 판 중 자동 조정이 내린 결정 (main.ts가 적용한다) */
export type AutoQualityAction =
  | { kind: 'downgrade'; mode: PerfMode; from: QualityTier; to: QualityTier; fpsBefore: number }
  | { kind: 'keep'; mode: PerfMode; tier: QualityTier; fpsBefore: number; fpsAfter: number }
  | {
      kind: 'revert';
      mode: PerfMode;
      from: QualityTier;
      to: QualityTier;
      fpsBefore: number;
      fpsAfter: number;
    }
  /** 자동 프레임 제한에서 느림: 품질은 그대로 두고 목표 FPS를 화면 주사율의 약수로 낮춘다(pacer.setFallback(to)). 효과 확인 없음 */
  | { kind: 'rateDown'; mode: PerfMode; from: number; to: number; fpsBefore: number }
  /**
   * 낮춘 목표 FPS를 사다리 한 칸 되돌린다(to = 그 칸, 화면 주사율이면 pacer.setFallback(null) — 아니면 setFallback(to)). 판 중에도 한다
   */
  | { kind: 'rateUp'; mode: PerfMode; from: number; to: number; fps: number; workP95: number }
  /** 자동으로 내린 품질 단계 하나를 되돌린다. 판 중에는 내지 않고 다음 판 시작 전에 takePendingUpgrade가 준다 */
  | { kind: 'upgrade'; mode: PerfMode; from: QualityTier; to: QualityTier; fps: number; workP95: number }
  /** 올린 뒤 확인 통과: 올린 상태를 유지한다 (터치 · 자동이면 품질 기억을 그 단계로 고친다, perfToRemember) */
  | { kind: 'upKeep'; mode: PerfMode; step: 'tier'; tier: QualityTier; fpsAfter: number }
  | { kind: 'upKeep'; mode: PerfMode; step: 'rate'; hz: number; fpsAfter: number }
  /** 올린 뒤 확인에서 느렸다: 다시 내리고(품질 또는 목표 FPS) 이번 세션에서는 더 올리지 않는다 */
  | { kind: 'upRevert'; mode: PerfMode; step: 'tier'; from: QualityTier; to: QualityTier; fpsAfter: number }
  | { kind: 'upRevert'; mode: PerfMode; step: 'rate'; from: number; to: number; fpsAfter: number };

/**
 * on = 감시 중(내림 · 올림), checking = 하향 효과 확인 중, probation = 올린 뒤 확인 중,
 * off = 효과가 없는 하향을 되돌린 뒤 이번 세션에서 끔(올리기도 하지 않는다)
 */
export type AutoDowngradeStatus = 'on' | 'checking' | 'probation' | 'off';

/**
 * 판 중 적응형 품질 (세션 단위 상태. 기억할 결과는 main.ts가 perfToRemember로 골라 저장한다).
 * 내리기 (판 중):
 *  - 판마다 FpsWatch로 잰다: 예열 5초 뒤 1초 평균이 하향 기준(minFpsFor: PC는 기준 목표의 2/3 · 터치 5/6, 60Hz에서 40 · 50)
 *    미만인 상태가 10초를 넘으면 내린다
 *  - 자동 프레임 제한이고 지금 목표보다 낮은 약수 사다리 칸이 있으면(rateLadder: 120 → 60, 144 → 72, 240 → 120 → 80 → 60) 먼저
 *    목표 FPS를 그 칸으로(rateDown, 품질 그대로, 확인 없음 — 프레임 예산만 는다). 느린 평균 FPS 이하인 가장 높은 칸까지 한 번에
 *    내려가되 되돌릴 단계는 칸마다 쌓는다(올릴 때 한 칸씩). 판당 품질 하향 한도에 세지 않고, 새 목표에서 예열부터 다시 잰다.
 *    고정 제한(60 · 120 · 절반)은 목표를 바꾸지 않는다
 *  - 품질은 한 단계(판당 최대 1번). 내린 뒤 같은 판에서 DowngradeCheck로 효과를 본다(판이 먼저 끝나면 같은 모드의 다음 판 예열 뒤)
 *  - 효과 없음 → 원래 단계로 되돌리고 이번 세션에서는 자동 조정을 끈다(30Hz로 묶인 화면) / 효과 있음 → 유지(되돌릴 단계로 쌓는다)
 * 올리기 (UP_WATCH · UP_PROBATION):
 *  - 쌓인 단계를 가장 최근 것부터 하나씩, 한 번에 하나. 예열 뒤 · 마지막 변경 20초 뒤부터 여유가 15초 넘게 이어지면
 *  - 목표 FPS 올리기(rateUp)는 판 중에 바로(다시 굽기가 없다). 품질 올리기는 판 중 백버퍼 · 글자 · 안개 다시 굽기(배율 2에서
 *    50~80ms 끊김)와 오르내림을 피해 다음 판 시작 전에 한다(takePendingUpgrade)
 *  - 올린 뒤 확인: 평균이 하향 기준 미만이면 다시 내리고(upRevert) 이번 세션에서는 더 올리지 않는다. 통과하면 upKeep
 * 확인이 끝나기 전에는 더 내리거나 올리지 않는다. 판마다 모드(온라인 · 연습)를 받아 결정에 실어 보내고, 다른 모드의 판으로
 * 넘어가면 확인 중이던 하향 · 되돌릴 품질 단계는 이어 가지 않는다(부하가 다른 판끼리 FPS를 견주지 않게).
 * 프레임 제한 · 화면 주사율(판 중에는 오르기만 한다)이 바뀌어 목표가 달라지면(자기 결정이 아닌 변경) 확인 중이던 것을
 * 판단 없이 끝내고(이미 내린 품질은 되돌릴 단계로 쌓는다) 하향 감시를 예열부터 다시 켠다.
 * 샘플마다 할당하지 않는다(고리 버퍼 · 미리 만든 감시기. 결정을 낼 때만 객체를 만든다)
 */
export class AutoDowngrade {
  private readonly watch: FpsWatch;
  /** 이번 판에 하향 감시가 켜져 있는가 (판에서 품질을 한 번 내리면 꺼진다) */
  private watchOn = false;
  private check: DowngradeCheck | null = null;
  /** 효과 확인을 기다리는 하향 (판이 끝나도 남는다) */
  private pending: { from: QualityTier; to: QualityTier; fpsBefore: number } | null = null;
  private disabled = false;
  private lastAverage = 0;
  private mode: PerfMode = 'online';
  private inMatch = false;
  private matchStartMs = 0;
  /** 자동으로 내린 단계 (마지막이 가장 최근) */
  private readonly stack: AutoStep[] = [];
  private readonly up: UpWatch;
  /** 다음 판 시작 전에 할 품질 올리기 (판 중에 여유를 확인했다) */
  private queued: { step: TierStep; fps: number; workP95: number } | null = null;
  /** 올린 뒤 확인 중인 단계 (판이 끝나도 남는다) */
  private probing: AutoStep | null = null;
  private probation: UpProbation | null = null;
  private upBlocked = false;
  private lastChangeAt = Number.NEGATIVE_INFINITY;
  private lastTier: QualityTier | null = null;
  private lastTargetHz: number | null = null;
  /** 자기 결정(목표 FPS 낮춤 · 올림 · 되돌림)으로 바뀔 목표. 다른 이유로 바뀐 목표와 구별한다 */
  private expectTargetHz: number | null = null;

  constructor(
    private watchCfg: FpsWatchConfig = FPS_WATCH,
    private readonly checkCfg: DowngradeCheckConfig = DOWNGRADE_CHECK,
    private readonly upCfg: UpWatchConfig = UP_WATCH,
    private readonly probationCfg: UpProbationConfig = UP_PROBATION,
  ) {
    this.watch = new FpsWatch(0, watchCfg);
    this.up = new UpWatch(upCfg, watchCfg.windowMs, watchCfg.gapMs);
  }

  get status(): AutoDowngradeStatus {
    if (this.disabled) return 'off';
    if (this.pending) return 'checking';
    return this.probing ? 'probation' : 'on';
  }

  /** 지금 쓰는 하향 기준 (60Hz 목표 기준 값) */
  get config(): FpsWatchConfig {
    return this.watchCfg;
  }

  /** 마지막으로 받은 목표 FPS의 하향 기준 (아직 받지 않았으면 60Hz 값, 디버그 표시) */
  get minFps(): number {
    return minFpsFor(this.watchCfg, this.lastTargetHz ?? BASE_TARGET_HZ);
  }

  /** 올린 뒤 확인에서 느려 이번 세션에서는 올리지 않는가 */
  get upgradesBlocked(): boolean {
    return this.upBlocked;
  }

  /** 되돌릴 수 있는 자동 하향 단계 (마지막이 가장 최근, 디버그 · 테스트) */
  get steps(): readonly AutoStep[] {
    return this.stack;
  }

  /** 다음 판 시작 전에 할 품질 올리기 (없으면 null) */
  get queuedUpgrade(): { from: QualityTier; to: QualityTier } | null {
    return this.queued ? { from: this.queued.step.to, to: this.queued.step.from } : null;
  }

  /** 하향 기준을 바꾼다 (부팅 때 기기에 맞춰 한 번: fpsWatchFor(touch)). 다음 판부터 쓴다 */
  setWatchConfig(cfg: FpsWatchConfig): void {
    this.watchCfg = cfg;
  }

  /** 디버그 표시용 최근 평균 FPS (감시 · 확인이 아직 잰 값이 없으면 마지막 값) */
  get average(): number {
    let now: number;
    if (this.check && this.check.average > 0) now = this.check.average;
    else if (this.probation && this.probation.average > 0) now = this.probation.average;
    else now = this.watchOn ? this.watch.average : this.up.average;
    return now > 0 ? now : this.lastAverage;
  }

  /** 판 시작. mode = 이 판의 모드 (온라인 판 'online', 봇과 연습 판 'practice' — GameScene이 app.practicing으로 고른다) */
  beginMatch(nowMs: number, mode: PerfMode = 'online'): void {
    this.inMatch = true;
    this.matchStartMs = nowMs;
    this.watchOn = false;
    this.check = null;
    this.probation = null;
    this.up.reset();
    if (mode !== this.mode) {
      this.mode = mode;
      this.pending = null;
      this.forgetTierSteps();
    }
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
      return;
    }
    this.watch.restart(nowMs, this.watchCfg);
    this.watchOn = true;
    // 올린 뒤 확인(다음 판으로 미룬 품질 올리기 · 판이 끝나 끊긴 확인): 이번 판 예열 뒤 잰다. 그동안 하향 감시는 쉰다
    if (this.probing)
      this.probation = new UpProbation(
        nowMs,
        this.watchCfg.warmupMs,
        this.probationCfg.measureMs,
        this.watchCfg.gapMs,
      );
  }

  /** 판 끝 (확인 중이던 하향 · 올린 뒤 확인 · 미룬 품질 올리기는 다음 판으로 넘어간다) */
  endMatch(): void {
    this.inMatch = false;
    this.watchOn = false;
    this.check = null;
    this.probation = null;
    this.up.reset();
  }

  /**
   * 다음 판 시작 전(판 장면을 만들기 직전, 이번 판 모드의 시작 품질을 정한 뒤 · beginMatch 전)에 부른다. 판 중에 여유를 확인해
   * 미뤄 둔 품질 올리기가 있으면 결정을 주고, 그 판의 예열 뒤 올린 뒤 확인을 한다. mode · tier = 이번 판 모드 · 지금 품질:
   * 다른 모드의 판이거나 그사이 품질이 바뀌었으면 올리지 않고 잊는다
   */
  takePendingUpgrade(mode: PerfMode, tier: QualityTier): AutoQualityAction | null {
    const q = this.queued;
    if (!q) return null;
    this.queued = null;
    if (this.disabled || mode !== this.mode || tier !== q.step.to) return null;
    this.probing = q.step;
    return { kind: 'upgrade', mode, from: q.step.to, to: q.step.from, fps: q.fps, workP95: q.workP95 };
  }

  /**
   * 사용자가 품질을 직접 고르면 확인 중이던 하향 · 품질 올린 뒤 확인 · 미룬 품질 올리기는 잊고, 되돌릴 품질 단계도 지운다
   * (고른 단계가 새 시작). 꺼진 상태 · 목표 FPS 낮춤은 그대로
   */
  cancelPending(): void {
    this.pending = null;
    this.check = null;
    this.forgetTierSteps();
  }

  /** 사용자가 프레임 제한을 바꾸면 자동으로 낮춘 목표 FPS는 잊는다 (main.ts가 pacer.setFallback(null)과 함께 부른다) */
  resetRate(): void {
    for (let i = this.stack.length - 1; i >= 0; i -= 1)
      if (this.stack[i]?.kind === 'rate') this.stack.splice(i, 1);
    if (this.probing?.kind === 'rate') {
      this.probing = null;
      this.probation = null;
    }
    this.expectTargetHz = null;
  }

  /**
   * 판 중 보이는 탭에서 프레임마다 부른다. s = 프레임 측정(최근 1초 FPS · 작업 시간 p95, injectFps(f)면 f · 1000/f),
   * tier = 지금 품질, ctx = 지금 프레임 페이싱. 할 일이 있으면 결정, 없으면 null
   */
  sample(nowMs: number, s: FrameSample, tier: QualityTier, ctx: AdaptContext): AutoQualityAction | null {
    if (this.disabled || !this.inMatch) return null;
    this.lastAverage = this.average;
    this.observe(nowMs, tier, ctx);
    const minFps = minFpsFor(this.watchCfg, ctx.targetHz);
    if (this.pending) return this.samplePending(nowMs, s.fps);
    if (this.probation) return this.sampleProbation(nowMs, s, minFps, tier, ctx);
    if (this.watchOn && this.watch.sample(nowMs, s.fps, minFps, s.late ?? 0, maxLateFor(ctx)))
      return this.stepDown(nowMs, tier, ctx);
    return this.sampleUp(nowMs, s, tier, ctx);
  }

  /** 품질 · 목표가 바뀌었는지 본다. 자기 결정이 아닌 목표 변경이면 확인 중이던 것을 판단 없이 끝내고 처음부터 잰다 */
  private observe(nowMs: number, tier: QualityTier, ctx: AdaptContext): void {
    const prevHz = this.lastTargetHz;
    this.lastTargetHz = ctx.targetHz;
    if (prevHz !== null && ctx.targetHz !== prevHz) {
      if (ctx.targetHz === this.expectTargetHz) {
        this.expectTargetHz = null;
      } else {
        // 다른 목표에서 잰 값끼리 견주지 않는다 (지금 품질 · 목표는 그대로 둔다). 판단 없이 끝낸 하향도 이미 내린
        // 단계라 되돌릴 단계로 쌓는다: 버리면 자동으로 낮춘 단계가 천장이 된다. 올리기는 여유 · 올린 뒤 확인을 거치므로
        // 효과가 없던 하향(30Hz로 묶인 화면)이어도 FPS가 목표에 닿지 않으면 올라가지 않는다
        const p = this.pending;
        if (p) this.stack.push({ kind: 'tier', from: p.from, to: p.to });
        this.pending = null;
        this.check = null;
        this.probing = null;
        this.probation = null;
        // 하향 감시는 새 목표에서 예열부터 다시 (이 판에서 이미 품질을 내렸거나 이어 온 확인으로 꺼져 있었어도)
        this.watch.restart(nowMs, this.watchCfg);
        this.watchOn = true;
      }
      this.changed(nowMs);
    }
    if (this.lastTier !== null && tier !== this.lastTier) this.changed(nowMs);
    this.lastTier = tier;
  }

  /** 변경 시각을 적는다: 이 뒤 quietMs 동안은 여유를 세지 않고, 미룬 품질 올리기는 거둔다(상황이 바뀌었다) */
  private changed(nowMs: number): void {
    this.lastChangeAt = nowMs;
    this.up.reset();
    if (this.queued) {
      this.stack.push(this.queued.step);
      this.queued = null;
    }
  }

  private samplePending(nowMs: number, fps: number): AutoQualityAction | null {
    const p = this.pending;
    const check = this.check;
    if (!p || !check) return null;
    const verdict = check.sample(nowMs, fps);
    if (verdict === null) return null;
    const fpsAfter = check.average;
    this.pending = null;
    this.check = null;
    const mode = this.mode;
    if (verdict === 'helped') {
      this.stack.push({ kind: 'tier', from: p.from, to: p.to });
      return { kind: 'keep', mode, tier: p.to, fpsBefore: p.fpsBefore, fpsAfter };
    }
    this.disabled = true;
    this.changed(nowMs);
    return { kind: 'revert', mode, from: p.to, to: p.from, fpsBefore: p.fpsBefore, fpsAfter };
  }

  private stepDown(nowMs: number, tier: QualityTier, ctx: AdaptContext): AutoQualityAction | null {
    const fpsBefore = this.watch.slowAverage;
    const mode = this.mode;
    this.changed(nowMs);
    const to = ctx.canRateFallback ? lowerRate(ctx.displayHz, ctx.targetHz, fpsBefore) : null;
    if (to !== null) {
      // 품질은 그대로 두고 목표만 화면 주사율의 약수로 낮춘다. 새 목표에서 예열부터 다시 잰다(판당 품질 하향 한도와 따로).
      // 되돌릴 단계는 사다리 칸마다 쌓는다(올릴 때 한 칸씩 — 맨 위로 한 번에 올리면 그 예산의 절반을 거의 못 맞춘다)
      let from = ctx.targetHz;
      while (from > to * (1 + 1e-9)) {
        const next = lowerRate(ctx.displayHz, from) ?? to;
        this.stack.push({ kind: 'rate', from, to: next });
        from = next;
      }
      this.expectTargetHz = to;
      this.watch.restart(nowMs, this.watchCfg);
      return { kind: 'rateDown', mode, from: ctx.targetHz, to, fpsBefore };
    }
    this.watchOn = false;
    const lower = lowerTier(tier);
    if (!lower) return null;
    this.pending = { from: tier, to: lower, fpsBefore };
    this.check = new DowngradeCheck(
      nowMs,
      fpsBefore,
      this.checkCfg.settleMs,
      this.checkCfg,
      this.watchCfg.gapMs,
    );
    return { kind: 'downgrade', mode, from: tier, to: lower, fpsBefore };
  }

  private sampleProbation(
    nowMs: number,
    s: FrameSample,
    minFps: number,
    tier: QualityTier,
    ctx: AdaptContext,
  ): AutoQualityAction | null {
    const probation = this.probation;
    const step = this.probing;
    if (!probation || !step) return null;
    if (step.kind === 'tier' ? tier !== step.from : ctx.targetHz <= step.to) {
      // 올리기가 적용되지 않았다(그사이 품질 · 목표가 다른 이유로 정해짐): 확인할 것이 없다
      this.probation = null;
      this.probing = null;
      return null;
    }
    // 목표 FPS를 되돌린 확인은 고르지 않은 프레임도 본다 (품질 확인은 보지 않는다: 60에서는 maxLateFor가 Infinity)
    const maxLate = step.kind === 'rate' ? maxLateFor(ctx) : Infinity;
    const verdict = probation.sample(nowMs, s.fps, minFps, s.late ?? 0, maxLate);
    if (verdict === null) return null;
    const fpsAfter = probation.average;
    this.probation = null;
    this.probing = null;
    const mode = this.mode;
    if (verdict === 'pass') {
      this.up.reset();
      return step.kind === 'tier'
        ? { kind: 'upKeep', mode, step: 'tier', tier: step.from, fpsAfter }
        : { kind: 'upKeep', mode, step: 'rate', hz: ctx.targetHz, fpsAfter };
    }
    this.upBlocked = true;
    this.changed(nowMs);
    this.stack.push(step);
    if (step.kind === 'rate') {
      // 목표만 되돌린다: 새 목표에서 예열부터 다시 잰다
      this.expectTargetHz = step.to;
      if (this.watchOn) this.watch.restart(nowMs, this.watchCfg);
      return { kind: 'upRevert', mode, step: 'rate', from: ctx.targetHz, to: step.to, fpsAfter };
    }
    // 품질을 다시 내렸다: 이 판의 품질 하향 한 번
    this.watchOn = false;
    return { kind: 'upRevert', mode, step: 'tier', from: tier, to: step.to, fpsAfter };
  }

  private sampleUp(
    nowMs: number,
    s: FrameSample,
    tier: QualityTier,
    ctx: AdaptContext,
  ): AutoQualityAction | null {
    const top = this.stack[this.stack.length - 1];
    if (this.upBlocked || this.queued || !top) return null;
    let budgetHz: number;
    if (top.kind === 'tier') {
      if (top.to !== tier) {
        // 그사이 품질이 다른 이유로 바뀌었다: 이 단계는 되돌릴 대상이 아니다
        this.stack.pop();
        this.up.reset();
        return null;
      }
      budgetHz = ctx.targetHz;
    } else {
      // 목표 FPS는 자동 제한이고 화면이 지금 목표보다 빠를 때만 되돌릴 수 있다. 그사이 목표가 다른 이유로 바뀌었으면(화면 주사율이
      // 오름 등) 이 칸은 되돌릴 대상이 아니다. 한 칸씩 올린다(예산도 그 칸)
      if (!ctx.canRateFallback || ctx.displayHz <= ctx.targetHz) return null;
      if (Math.abs(top.to - ctx.targetHz) > 1e-6) {
        this.stack.pop();
        this.up.reset();
        return null;
      }
      budgetHz = Math.min(ctx.displayHz, top.from);
    }
    const openAt = Math.max(
      this.matchStartMs + this.watchCfg.warmupMs,
      this.lastChangeAt + this.upCfg.quietMs,
    );
    if (!this.up.sample(nowMs, s.fps, s.workP95, ctx.targetHz, budgetHz, openAt)) return null;
    const fps = this.up.average;
    this.stack.pop();
    this.up.reset();
    if (top.kind === 'tier') {
      // 판 중에는 다시 굽지 않는다: 다음 판 시작 전에 올린다(takePendingUpgrade). 그때까지 더 올리지 않는다
      this.queued = { step: top, fps, workP95: s.workP95 };
      return null;
    }
    this.probing = top;
    this.probation = new UpProbation(
      nowMs,
      this.probationCfg.settleMs,
      this.probationCfg.measureMs,
      this.watchCfg.gapMs,
    );
    this.lastChangeAt = nowMs;
    this.expectTargetHz = budgetHz;
    return {
      kind: 'rateUp',
      mode: this.mode,
      from: ctx.targetHz,
      to: budgetHz,
      fps,
      workP95: s.workP95,
    };
  }

  /** 되돌릴 품질 단계 · 미룬 품질 올리기 · 품질 올린 뒤 확인을 잊는다 (목표 FPS 단계는 둔다) */
  private forgetTierSteps(): void {
    for (let i = this.stack.length - 1; i >= 0; i -= 1)
      if (this.stack[i]?.kind === 'tier') this.stack.splice(i, 1);
    this.queued = null;
    if (this.probing?.kind === 'tier') {
      this.probing = null;
      this.probation = null;
    }
  }
}

/** 이번 세션(페이지)의 자동 조정 상태. 새로고침하면 처음부터 (터치 기기의 확인한 단계만 'decoy:perf'로 남는다) */
export const sessionAutoDowngrade = new AutoDowngrade();

/**
 * 런타임 연결 (main.ts가 채운다). 로비의 품질 선택과 판 중 자동 조정이 부른다.
 * gfx/state.ts의 probeSlot과 같은 방식: 이 파일은 순수 로직만 두고 실제 적용은 진입점이 한다.
 */
export const qualityHooks: {
  /** 로비에서 고른 값을 바로 적용 (저장은 부르는 쪽이 saveQualityChoice로 먼저 한다. 저장에 실패해도 이번 세션에는 적용) */
  choose: ((choice: QualityChoice) => void) | null;
  /** 판 중 자동 조정(내림 · 되돌림 · 유지 · 목표 FPS 낮춤 · 올림 · 올린 뒤 유지 · 되돌림)을 적용한다 */
  auto: ((action: AutoQualityAction) => void) | null;
} = { choose: null, auto: null };
