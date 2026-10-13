// 프레임 페이싱 (렌더링 최적화): 프레임 제한 설정(자동 · 60 · 120) · 화면 주사율 재기 · 제한기.
// 순수 로직은 Phaser를 import하지 않는다. main.ts가 Phaser 루프에 끼운다(patchTimeStep(Phaser.Core.TimeStep.prototype, pacer)).
// 아래 값은 판정과 무관한 그래픽 · 페이싱 값이라 balance.json이 아니라 여기 둔다(gfx/quality.ts와 같다).
//  - 목표 FPS = 제한이 자동이면 화면 주사율, 아니면 min(제한, 화면). 자동에서 적응형 품질이 60으로 내릴 수 있다(fallbackHz)
//  - 제한기는 Phaser의 fps.limit을 쓰지 않는다(생성 때 고정 · 허용 오차가 없어 흔들리는 120Hz에서 40fps가 된다).
//    rAF마다 '다음 차례 시각'과 견주어 Phaser 한 걸음(TimeStep.step)을 부르거나 건너뛴다. 건너뛰면 Phaser lastTime이
//    그대로라 다음 delta = 마지막으로 그린 프레임부터의 시간이다
//  - 판이 없을 때(로비 · 결과)는 제한 설정과 상관없이 30fps로 묶는다(Pacer.setIdle, main.ts가 판 시작 · 끝에 부른다)
//  - 매 프레임 메모리를 새로 잡지 않는다(고정 크기 typed array 고리, 백분위는 미리 잡은 배열을 정렬)
import { STORAGE_KEYS, readKey, removeKey, writeKey, type StorageLike } from '../storageKeys';

/** 프레임 제한 선택: 자동 = 화면 주사율을 따른다(제한 없음), 60 = 배터리 절약, 120 */
export type FrameLimit = 'auto' | '60' | '120';
export const FRAME_LIMITS: readonly FrameLimit[] = ['auto', '60', '120'];

export function isFrameLimit(v: unknown): v is FrameLimit {
  return v === 'auto' || v === '60' || v === '120';
}

/** 프레임 제한 글자 해석 (앞뒤 공백 · 대소문자 무시: 'auto' · '60' · '120'). 그 밖에는 null */
export function parseFrameLimit(raw: string | null): FrameLimit | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  return isFrameLimit(v) ? v : null;
}

/**
 * 런타임 연결 (main.ts가 채운다). 로비 · 설정의 프레임 제한 선택과 디버그 훅이 부른다.
 * quality.ts의 qualityHooks와 같은 방식: 이 파일은 순수 로직만 두고 실제 적용은 진입점이 한다
 */
export const pacingHooks: {
  /** 고른 제한을 바로 적용한다 (저장은 부르는 쪽이 먼저 한다) */
  setLimit: ((limit: FrameLimit) => void) | null;
} = { setLimit: null };

// ───────────── 저장 (로비에서 고른 값, 'decoy:frameLimit') ─────────────

export const FRAME_LIMIT_STORAGE_KEY = STORAGE_KEYS.frameLimit.key;

/** 저장된 프레임 제한 (없거나 읽을 수 없거나 모르는 값이면 null). storage를 주지 않으면 브라우저 저장소 */
export function loadFrameLimit(storage?: StorageLike | null): FrameLimit | null {
  return parseFrameLimit(readKey('frameLimit', '', storage));
}

/** 고른 제한을 저장한다. '자동'이면 저장값을 지운다. 저장소를 못 쓰면 false (이번 접속에는 부르는 쪽이 적용) */
export function saveFrameLimit(limit: FrameLimit, storage?: StorageLike | null): boolean {
  return limit === 'auto' ? removeKey('frameLimit', '', storage) : writeKey('frameLimit', limit, '', storage);
}

// ───────────── 화면 주사율 재기 ─────────────

/** 흔한 화면 주사율 (재 값이 ±REFRESH.snapTolerance 안이면 이 값으로 맞춘다) */
export const KNOWN_REFRESH_HZ: readonly number[] = [60, 72, 75, 90, 100, 120, 144, 165, 240];

export const REFRESH = {
  /** 간격 고리 크기 (최근 rAF 간격 수) */
  samples: 120,
  /** 이만큼 모이기 전에는 floorHz로 본다 */
  minSamples: 30,
  /** 다시 내는 최소 간격 (ms) */
  recomputeMs: 500,
  /**
   * 간격의 이 백분위로 잰다 (0.2 = 짧은 쪽 20%). 놓친 vsync는 간격을 늘리기만 하므로(바쁜 프레임은 다음 vsync로 밀린다)
   * 중앙값이면 120을 못 버티는 기기에서 화면을 60Hz로 잘못 잰다 — 짧은 쪽은 가벼운 프레임 · 건너뛴 rAF의 실제 화면 주기다
   */
  percentile: 0.2,
  /** 이보다 긴 간격(숨김 · 멈춤 · 긴 작업)은 세지 않는다 (ms) */
  maxIntervalMs: 100,
  /** 흔한 주사율에 맞추는 허용 비율 (±7%) */
  snapTolerance: 0.07,
  /** 이 아래로는 보지 않는다: 바쁜 기기의 rAF가 30으로 떨어져도 기준(목표 FPS)을 낮추지 않게 */
  floorHz: 60,
  /** 위 한계 */
  capHz: 240,
} as const;

/**
 * 잰 주사율(Hz)을 흔한 값으로 맞춘다: 가장 가까운 KNOWN_REFRESH_HZ와 상대 오차가 ±7% 안이면 그 값, 아니면 반올림.
 * 그 뒤 [60, 240]으로 자른다. 잘못된 값(0 · 음수 · NaN)은 60
 */
export function snapRefreshHz(rawHz: number): number {
  if (!Number.isFinite(rawHz) || rawHz <= 0) return REFRESH.floorHz;
  let best: number = REFRESH.floorHz;
  let bestErr = Infinity;
  for (const hz of KNOWN_REFRESH_HZ) {
    const err = Math.abs(rawHz - hz) / hz;
    if (err < bestErr) {
      best = hz;
      bestErr = err;
    }
  }
  const hz = bestErr <= REFRESH.snapTolerance ? best : Math.round(rawHz);
  return Math.min(REFRESH.capHz, Math.max(REFRESH.floorHz, hz));
}

/**
 * 화면 주사율 재기: rAF마다(그렸든 건너뛰었든) tick(t). 최근 120개 간격(0 이하 · 100ms 초과는 버림)의 짧은 쪽 20% 백분위로
 * 0.5초에 한 번까지만 다시 낸다. 30개가 모이기 전에는 60. 처음 잰 값은 바로 쓰고, 그 뒤 바뀐 값은 두 번 잇달아 같게
 * 나와야 바꾼다(흔들림 막기). 짧은 쪽 백분위라 놓친 vsync · 긴 프레임(간격을 늘리기만 한다)에 끌려가지 않는다
 */
export class RefreshEstimator {
  private readonly ring = new Float64Array(REFRESH.samples);
  private readonly scratch = new Float64Array(REFRESH.samples);
  /** 고리에 든 유효 간격 수 (≤ samples). 가득 차기 전에는 [0, count)에 들어 있다 */
  private count = 0;
  private head = 0;
  private prevT = Number.NaN;
  private lastComputeAt = -Infinity;
  private reported: number = REFRESH.floorHz;
  private measured = false;
  private pending: number | null = null;
  private raw: number | null = null;

  /** rAF 시각 (ms) */
  tick(t: number): void {
    const dt = t - this.prevT;
    this.prevT = t;
    // 첫 tick(NaN) · 시간이 거꾸로 · 긴 공백은 세지 않는다
    if (dt > 0 && dt <= REFRESH.maxIntervalMs) {
      this.ring[this.head] = dt;
      this.head = (this.head + 1) % REFRESH.samples;
      if (this.count < REFRESH.samples) this.count += 1;
    }
    if (this.count >= REFRESH.minSamples && t - this.lastComputeAt >= REFRESH.recomputeMs) {
      this.lastComputeAt = t;
      this.recompute();
    }
  }

  /** 맞춘 화면 주사율 (Hz, 60 ~ 240) */
  get hz(): number {
    return this.reported;
  }

  /** 마지막으로 잰 맞추기 전 값 (Hz, 아직 못 쟀으면 null) */
  get rawHz(): number | null {
    return this.raw;
  }

  /** 고리에 든 간격 수 */
  get sampleCount(): number {
    return this.count;
  }

  private recompute(): void {
    const n = this.count;
    const s = this.scratch;
    s.set(this.ring);
    // 빈 칸은 맨 뒤로 가게 (정렬 뒤 [0, n)만 본다) — subarray를 만들지 않으려고
    if (n < REFRESH.samples) s.fill(Infinity, n);
    s.sort();
    const low = s[Math.min(n - 1, Math.floor(n * REFRESH.percentile))]!;
    this.raw = 1000 / low;
    const next = snapRefreshHz(this.raw);
    if (!this.measured) {
      this.measured = true;
      this.reported = next;
      this.pending = null;
    } else if (next === this.reported) this.pending = null;
    else if (this.pending === next) {
      this.reported = next;
      this.pending = null;
    } else this.pending = next;
  }
}

// ───────────── 제한기 ─────────────

export const LIMITER = {
  /** 차례 시각보다 이만큼 이르면 그린다 (rAF 시각 흔들림 ±0.3ms를 넘게, ms) */
  toleranceMs: 1,
  /** 제한이 화면의 이 비율 이상이면 제한하지 않는다 (120 화면에 120 제한 = 모든 rAF) */
  nearDisplay: 0.97,
  /** rAF 사이가 이보다 길면(숨김 · 멈춤) 차례 시각을 지금으로 다시 맞춘다 (ms) */
  resyncGapMs: 250,
} as const;

/**
 * 프레임 제한기 (차례 시각 방식): rAF 시각 t마다 shouldRun(t, 화면Hz).
 * 제한이 없거나 화면의 97% 이상이면 늘 그린다. 아니면 t < next − 1ms면 건너뛰고, 그리면 next += 1000/제한
 * (그래도 next가 한 주기보다 더 뒤처졌으면 next = t + 1000/제한). 제한이 바뀌거나 250ms 넘게 rAF가 끊기면 그 tick에 그리고
 * 거기서 다시 센다. 예: 120Hz에 60 → 한 번 걸러 한 번, 90Hz에 60 → 세 번에 두 번, 144Hz에 120 → 여섯 번에 다섯 번꼴(평균 120)
 *
 * 화면 주사율로 나누어떨어지지 않는 제한(90 · 144Hz에 60, 144Hz에 120)은 일부러 정수 분주(90Hz → 45, 144Hz → 72 · 144)로
 * 반올림하지 않는다: 차례 시각을 1000/제한씩 쌓아 가므로 평균 FPS는 정확히 제한과 같고, 대신 프레임 간격이 고르지 않다
 * (90Hz에 60이면 11.1ms · 22.2ms가 섞인다). 사용자가 고른 숫자(60 · 120)와 적응형 품질의 목표 FPS가 실제 평균과 같아야
 * 기준(목표의 2/3 · 5/6)이 맞는다. 판 장면은 실제 간격(rawDelta)으로 적분하므로 고르지 않은 간격도 움직임은 맞다
 */
export class FrameLimiter {
  private cap: number | null = null;
  private next = Number.NaN;
  private lastTick = Number.NaN;
  private skips = 0;

  /** 지금 제한 (Hz, 없으면 null) */
  get capHz(): number | null {
    return this.cap;
  }

  /** 제한 때문에 건너뛴 rAF 수 (누계) */
  get skipped(): number {
    return this.skips;
  }

  /** 제한을 바꾼다 (null · 0 이하 · 유한하지 않은 값 = 제한 없음). 값이 바뀌면 차례 시각을 다시 센다 */
  setCap(hz: number | null): void {
    const cap = hz !== null && Number.isFinite(hz) && hz > 0 ? hz : null;
    if (cap === this.cap) return;
    this.cap = cap;
    this.next = Number.NaN;
  }

  /** 이 rAF에 Phaser 한 걸음을 부를까 */
  shouldRun(t: number, displayHz: number): boolean {
    const gap = t - this.lastTick;
    this.lastTick = t;
    const cap = this.cap;
    if (cap === null || cap >= displayHz * LIMITER.nearDisplay) {
      this.next = Number.NaN;
      return true;
    }
    const period = 1000 / cap;
    // 처음 · 제한이 막 바뀜 · 긴 공백 · 시간이 거꾸로: 지금 그리고 여기서 다시 센다
    if (Number.isNaN(this.next) || !(gap >= 0 && gap <= LIMITER.resyncGapMs)) {
      this.next = t + period;
      return true;
    }
    if (t < this.next - LIMITER.toleranceMs) {
      this.skips += 1;
      return false;
    }
    this.next += period;
    if (this.next < t - period) this.next = t + period;
    return true;
  }
}

// ───────────── 목표 FPS ─────────────

/**
 * 목표 FPS: 자동 = 화면 주사율(적응형 품질이 내린 fallbackHz가 있으면 그것과 화면 중 작은 값), 60 · 120 = min(제한, 화면).
 * fallbackHz는 자동에서만 쓴다 (고정 제한은 적응형 품질이 FPS를 바꾸지 않는다)
 */
export function targetHzFor(limit: FrameLimit, displayHz: number, fallbackHz: number | null): number {
  if (limit === 'auto') return fallbackHz !== null ? Math.min(displayHz, fallbackHz) : displayHz;
  return Math.min(Number(limit), displayHz);
}

/** 제한기에 줄 제한 (Hz). 목표가 화면의 97% 이상이면 제한할 것이 없어 null */
export function capHzFor(limit: FrameLimit, displayHz: number, fallbackHz: number | null): number | null {
  const target = targetHzFor(limit, displayHz, fallbackHz);
  return target < displayHz * LIMITER.nearDisplay ? target : null;
}

// ───────────── Phaser 루프에 끼우기 ─────────────

/**
 * 판이 없을 때(로비 · 결과 · 연습 고르기)의 그리기 제한 (Hz). 그때 Phaser는 빈 장면(IdleScene)만 그리는데도 rAF마다 한 걸음을
 * 돌아 120Hz 휴대폰에서 배터리를 쓴다 → 프레임 제한 설정과 상관없이 30으로 묶는다. 화면 주사율 재기는 그대로 모든 rAF를 본다
 */
export const IDLE_CAP_HZ = 30;

/** 프레임 제한 · 화면 주사율 · 제한기를 묶는다. main.ts가 하나 만들어 patchTimeStep으로 Phaser 루프에 끼운다 */
export class Pacer {
  readonly estimator = new RefreshEstimator();
  readonly limiter = new FrameLimiter();
  /** 건너뛴 rAF마다 불린다 (측정 모듈이 센다). 없으면 null */
  onSkip: ((t: number) => void) | null = null;
  private current: FrameLimit;
  private fallback: number | null = null;
  private idleOn = false;
  /** 판 중 붙잡은 화면 주사율 (판 중에는 낮아지지 않는다, 판 밖이면 null) */
  private heldHz: number | null = null;

  constructor(limit: FrameLimit = 'auto') {
    this.current = limit;
  }

  get limit(): FrameLimit {
    return this.current;
  }

  /** 적응형 품질이 자동 제한에서 내린 목표 (Hz, 없으면 null) */
  get fallbackHz(): number | null {
    return this.fallback;
  }

  setLimit(limit: FrameLimit): void {
    this.current = limit;
  }

  /** 자동 제한에서 목표를 내린다 / null이면 되돌린다 (0 이하 · 유한하지 않은 값은 null) */
  setFallback(hz: number | null): void {
    this.fallback = hz !== null && Number.isFinite(hz) && hz > 0 ? hz : null;
  }

  /** 판이 없는 중인가 (main.ts가 판 시작 · 끝에 setIdle) */
  get idle(): boolean {
    return this.idleOn;
  }

  /** 판이 없으면 true: 그리기를 IDLE_CAP_HZ로 묶는다(제한 설정과 상관없이). false면 제한 설정대로 */
  setIdle(idle: boolean): void {
    this.idleOn = idle;
    this.heldHz = idle ? null : this.estimator.hz;
  }

  /**
   * 화면 주사율. 판 중에는 판 시작(또는 그 뒤 더 높게 잰) 값을 붙잡고 낮추지 않는다: 판 중 rAF는 게임 작업에 밀려 간격이 늘 수 있고
   * (120을 못 버티는 기기), 그것을 화면이 느려진 것으로 보면 자동 제한의 목표 낮추기 · 60 제한이 꺼진다. 화면이 정말 느려졌으면
   * (절전) 목표를 못 버텨 적응형 품질이 목표를 낮춘다. 판 밖(가벼운 30fps)에서는 잰 값을 그대로 쓴다
   */
  get displayHz(): number {
    return this.heldHz ?? this.estimator.hz;
  }

  /**
   * 판의 목표 FPS (적응형 품질 기준 · 표시용). 판이 없을 때의 30fps 묶음(idle)은 넣지 않는다 — 그때는 적응형 품질이
   * 돌지 않고, 판이 시작하면 바로 이 값으로 그린다
   */
  get targetHz(): number {
    return targetHzFor(this.current, this.displayHz, this.fallback);
  }

  /** 지금 제한기 제한 (Hz, 없으면 null). 판이 없으면 IDLE_CAP_HZ */
  get capHz(): number | null {
    return this.idleOn ? IDLE_CAP_HZ : capHzFor(this.current, this.displayHz, this.fallback);
  }

  /** 제한 때문에 건너뛴 rAF 수 (누계) */
  get skipped(): number {
    return this.limiter.skipped;
  }

  /** rAF마다: 주사율을 재고 이번에 그릴지 정한다 (true = Phaser 한 걸음을 부른다) */
  onTick(t: number): boolean {
    // 주사율 재기는 건너뛸 tick도 본다 (제한 · 판 없음과 상관없이 실제 화면 주사율)
    this.estimator.tick(t);
    if (this.heldHz !== null && this.estimator.hz > this.heldHz) this.heldHz = this.estimator.hz;
    this.limiter.setCap(this.capHz);
    const run = this.limiter.shouldRun(t, this.displayHz);
    if (!run) this.onSkip?.(t);
    return run;
  }
}

/** 한 걸음 함수를 가진 것 (Phaser.Core.TimeStep.prototype) */
export interface SteppableProto {
  step(time: number): void;
}

/** 끼우기 전 원래 step (다시 끼워도 겹겹이 감싸지 않게, 되돌리기용) */
const ORIGINAL_STEP = new WeakMap<SteppableProto, (time: number) => void>();

/**
 * proto.step을 감싸 pacer.onTick(t)가 true일 때만 원래 step을 부른다 (this는 그대로 넘긴다).
 * main.ts가 new Phaser.Game 전에 patchTimeStep(Phaser.Core.TimeStep.prototype, pacer)로 부른다 — TimeStep.start가
 * this.step.bind(this)를 rAF에 넘기므로 그 전에 바꿔야 한다. 다시 부르면 원래 step을 새 pacer로 감싼다
 */
export function patchTimeStep(proto: SteppableProto, pacer: Pacer): void {
  const original = ORIGINAL_STEP.get(proto) ?? proto.step;
  ORIGINAL_STEP.set(proto, original);
  proto.step = function pacedStep(this: unknown, time: number): void {
    if (pacer.onTick(time)) original.call(this, time);
  };
}

/** patchTimeStep을 되돌린다 (시험용) */
export function unpatchTimeStep(proto: SteppableProto): void {
  const original = ORIGINAL_STEP.get(proto);
  if (!original) return;
  proto.step = original;
  ORIGINAL_STEP.delete(proto);
}
