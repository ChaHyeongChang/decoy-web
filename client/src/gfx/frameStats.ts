// 프레임 측정 (렌더링 최적화): 렌더한 프레임의 간격 · 작업 시간 · 그리기 호출을 고정 크기 고리 버퍼에 모은다.
// ?debug=1 오버레이 · 적응형 품질 · 디버그 훅이 읽는다. Phaser를 import하지 않는다(main.ts가 Phaser 루프에 끼운다).
//  - 프레임마다 부르는 begin · end · noteSkipped는 할당하지 않는다(타입 배열 고리에 쓰기만 한다)
//  - 요약(summary · window)은 부를 때 계산한다: 표시는 4Hz, 적응형 품질은 판단할 때. 백분위는 미리 만든 작업용 배열에
//    복사해 그 안에서 고른다(새 배열을 만들지 않는다)
import type { FrameStatsInfo } from '@decoy/shared';
import { getFpsOverride } from './state';

/** 고리 버퍼 크기 = 최근 몇 프레임을 요약하는가 (240Hz 1초, 120Hz 2초, 60Hz 4초) */
export const FRAME_STATS_CAPACITY = 240;
/** fps를 세는 구간 (ms, 최근 1초) */
export const FPS_WINDOW_MS = 1000;
/**
 * 이보다 긴 프레임 간격은 끊김으로 보고 간격 통계에 넣지 않는다 (ms). 탭을 숨겼다 돌아오면 rAF가 멈췄던 몇 초가
 * 한 간격으로 들어와 평균 · p95를 몇 초 동안 망가뜨린다. 그 프레임의 작업 시간은 그대로 센다
 */
export const FRAME_GAP_MS = 1000;
/** 요약에 쓰는 백분위 */
const P95 = 0.95;

/** 적응형 품질이 보는 최근 구간 요약 */
export interface FrameWindow {
  /** 구간 안 렌더 프레임 간격으로 낸 FPS (간격 수 × 1000 / 간격 합, 간격이 없으면 0) */
  fps: number;
  /** 구간 안 프레임 간격 평균 (ms, 없으면 0) */
  intervalAvg: number;
  /** 구간 안 작업 시간 p95 (ms, 없으면 0) */
  workP95: number;
  /** 구간 안 렌더 프레임 수 */
  frames: number;
  /**
   * 구간 안 늦은 프레임 비율 (0~1, 내 움직임 고르기 · 잔렉 고치기): 간격이 목표 주기 + slackMs(반 vsync) 이상인 간격 수 ÷ 간격 수.
   * 목표 주기를 주지 않았거나 FPS를 덮어썼으면 0
   */
  late: number;
}

/** 덮어쓴 FPS로 쓸 수 있는 값인가 (유한한 양수) */
function validFps(f: number | null): f is number {
  return f !== null && Number.isFinite(f) && f > 0;
}

/**
 * 가까운 순위 백분위 (tests/perf/perfHooks.ts percentile과 같은 정의: 정렬했을 때 ceil(p·n)번째).
 * a[0..n)을 제자리에서 부분 정렬해 고른다(quickselect, 할당 없음). n이 0이면 0
 */
export function percentileInPlace(a: Float32Array, n: number, p: number): number {
  if (n <= 0) return 0;
  const k = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    // 가운데 값을 기준으로 나눈다 (Hoare 분할)
    const pivot = a[(lo + hi) >>> 1] ?? 0;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((a[i] ?? 0) < pivot) i++;
      while ((a[j] ?? 0) > pivot) j--;
      if (i <= j) {
        const t = a[i] ?? 0;
        a[i] = a[j] ?? 0;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k] ?? 0;
}

/**
 * 렌더한 프레임의 측정 고리 버퍼. Phaser 한 걸음(TimeStep.step)마다:
 *   begin(rAF 시각, performance.now()) → Phaser 갱신 + 그리기 → end(performance.now())
 * 프레임 제한으로 건너뛴 rAF는 noteSkipped(). 그리기 호출 수는 setDrawCalls(그 프레임 값)
 */
export class FrameStats {
  readonly capacity: number;
  /** 렌더 프레임의 rAF 시각 (ms) */
  private readonly times: Float64Array;
  /** 앞 렌더 프레임과의 간격 (ms). 첫 프레임 · 끊김 뒤 첫 프레임은 NaN(간격 통계에서 뺀다) */
  private readonly intervals: Float32Array;
  /** 메인 스레드 작업 시간 (ms) */
  private readonly works: Float32Array;
  /** rAF 시각(vsync)부터 그리기를 마칠 때까지 (ms): 콜백이 늦게 시작한 시간 + 작업 시간. 한 vsync를 넘으면 그 프레임은 늦게 보인다 */
  private readonly spans: Float32Array;
  /** 안개 주기(빛 지도를 다시 칠한) 프레임이면 1 */
  private readonly fogs: Uint8Array;
  /** 백분위 계산용 (요약할 때만 쓴다) */
  private readonly scratch: Float32Array;
  /** 다음에 쓸 칸 */
  private head = 0;
  /** 들어 있는 프레임 수 (≤ capacity) */
  private count = 0;
  /** 지금까지 렌더한 프레임 수 (누계) */
  private totalFrames = 0;
  private skippedTicks = 0;
  private drawCalls: number | null = null;
  /** 앞 렌더 프레임의 rAF 시각 (아직 없으면 NaN) */
  private lastT = Number.NaN;
  /** begin을 불렀고 end를 기다리는가 */
  private open = false;
  private beginT = 0;
  private beginWall = 0;
  /** 지금 열린 프레임이 안개 주기 프레임인가 (markFog) */
  private fogOpen = false;
  private override: number | null = null;

  /**
   * @param overrideSource 덮어쓴 FPS를 읽는 곳 (세션 인스턴스는 gfx/state.ts getFpsOverride — 디버그 injectFps).
   *   setOverrideFps로 정한 값이 있으면 그것이 먼저다
   */
  constructor(
    capacity: number = FRAME_STATS_CAPACITY,
    private readonly overrideSource: (() => number | null) | null = null,
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.times = new Float64Array(this.capacity);
    this.intervals = new Float32Array(this.capacity);
    this.works = new Float32Array(this.capacity);
    this.spans = new Float32Array(this.capacity);
    this.fogs = new Uint8Array(this.capacity);
    this.scratch = new Float32Array(this.capacity);
  }

  /**
   * Phaser 한 걸음을 시작한다. t = rAF 타임스탬프(프레임 간격은 이것끼리 잰다), wallNow = 지금 performance.now()
   * (작업 시간의 시작. 주지 않으면 t)
   */
  begin(t: number, wallNow: number = t): void {
    this.beginT = t;
    this.beginWall = wallNow;
    this.open = true;
    this.fogOpen = false;
  }

  /** 지금 그리는 프레임이 안개 주기 프레임이다 (worldRenderer가 빛 지도를 다시 칠할 때). begin과 end 사이에만 뜻이 있다 */
  markFog(): void {
    if (this.open) this.fogOpen = true;
  }

  /** 그리기까지 끝났다 (now = performance.now()). begin 없이 부르면 무시한다 */
  end(now: number): void {
    if (!this.open) return;
    this.open = false;
    const t = this.beginT;
    const dt = t - this.lastT;
    // 첫 프레임(lastT NaN) · 시각이 뒤로 간 경우 · 끊김은 간격 없음
    const interval = dt > 0 && dt <= FRAME_GAP_MS ? dt : Number.NaN;
    const work = now - this.beginWall;
    const i = this.head;
    this.times[i] = t;
    this.intervals[i] = interval;
    // 음수 · NaN(시계가 섞인 잘못된 호출)은 0
    this.works[i] = work > 0 ? work : 0;
    const span = now - t;
    this.spans[i] = span > 0 ? span : 0;
    this.fogs[i] = this.fogOpen ? 1 : 0;
    this.fogOpen = false;
    this.head = i + 1 === this.capacity ? 0 : i + 1;
    if (this.count < this.capacity) this.count++;
    this.totalFrames++;
    this.lastT = t;
  }

  /** 프레임 제한으로 rAF 하나를 건너뛰었다 */
  noteSkipped(n = 1): void {
    this.skippedTicks += n;
  }

  /** 지난 프레임의 그리기 호출 수 (WebGL) 또는 그린 객체 수 (Canvas). null = 재지 않음 */
  setDrawCalls(n: number | null): void {
    this.drawCalls = n;
  }

  /**
   * FPS 덮어쓰기 (디버그 injectFps): 정하면 요약 · 구간이 fps = f, 간격 = 작업 시간 = 1000/f로 보고한다.
   * 0 이하 · 무한 · NaN은 덮어쓰지 않음과 같다. 프레임 수 · 그리기 · 건너뜀은 실제 값 그대로
   */
  setOverrideFps(f: number | null): void {
    this.override = validFps(f) ? f : null;
  }

  /** 지금 덮어쓴 FPS (없으면 null) */
  get overrideFps(): number | null {
    if (this.override !== null) return this.override;
    const src = this.overrideSource?.() ?? null;
    return validFps(src) ? src : null;
  }

  /** 버퍼에 든 프레임 수 */
  get recorded(): number {
    return this.count;
  }

  /** 지금까지 렌더한 프레임 수 (누계, 버퍼 크기와 상관없음) */
  get total(): number {
    return this.totalFrames;
  }

  /** 프레임 제한으로 건너뛴 rAF 수 (누계) */
  get skipped(): number {
    return this.skippedTicks;
  }

  /** 측정을 비운다 (누계 · 덮어쓰기는 그대로). 다음 프레임은 간격 없이 시작한다 */
  reset(): void {
    this.head = 0;
    this.count = 0;
    this.lastT = Number.NaN;
    this.open = false;
    this.drawCalls = null;
  }

  /**
   * 고리 버퍼와 작업용 배열 (단위 시험이 같은 배열을 계속 쓰는지 본다). 읽기만 할 것
   * @internal
   */
  get buffers(): readonly [Float64Array, Float32Array, Float32Array, Float32Array] {
    return [this.times, this.intervals, this.works, this.scratch];
  }

  /** 새 것부터 k번째(0 = 가장 최근) 프레임의 버퍼 칸 */
  private slot(k: number): number {
    const i = this.head - 1 - k;
    return i < 0 ? i + this.capacity : i;
  }

  /**
   * 최근 ms 구간 요약: rAF 시각이 (가장 최근 − ms, 가장 최근]인 렌더 프레임들. out을 주면 거기에 채워 돌려준다
   * (적응형 품질이 프레임마다 불러도 할당하지 않게)
   */
  window(
    ms: number,
    out: FrameWindow = { fps: 0, intervalAvg: 0, workP95: 0, frames: 0, late: 0 },
    late?: { periodMs: number; slackMs: number },
  ): FrameWindow {
    let frames = 0;
    let nInt = 0;
    let sumInt = 0;
    let nLate = 0;
    const lateMs = late && late.periodMs > 0 ? late.periodMs + late.slackMs : Infinity;
    if (this.count > 0) {
      const newest = this.times[this.slot(0)] ?? 0;
      const from = newest - ms;
      for (let k = 0; k < this.count; k++) {
        const i = this.slot(k);
        if ((this.times[i] ?? 0) <= from) break;
        this.scratch[frames] = this.works[i] ?? 0;
        frames++;
        const iv = this.intervals[i] ?? Number.NaN;
        if (!Number.isNaN(iv)) {
          nInt++;
          sumInt += iv;
          if (iv >= lateMs) nLate++;
        }
      }
    }
    out.frames = frames;
    const f = this.overrideFps;
    if (f !== null) {
      out.fps = f;
      out.intervalAvg = 1000 / f;
      out.workP95 = 1000 / f;
      out.late = 0;
      return out;
    }
    out.late = nInt > 0 ? nLate / nInt : 0;
    out.fps = sumInt > 0 ? (nInt * 1000) / sumInt : 0;
    out.intervalAvg = nInt > 0 ? sumInt / nInt : 0;
    out.workP95 = percentileInPlace(this.scratch, frames, P95);
    return out;
  }

  /**
   * 최근 ms 구간에서 vsync를 넘긴 프레임 비율 (0~1, 잔렉 고치기): rAF 시각부터 그리기를 마칠 때까지가 vsyncMs보다 긴 프레임 수 ÷
   * 프레임 수. 그런 프레임은 다음 vsync로 밀려 늦게 보인다(크롬은 다음 rAF에 같은 격자 시각을 주므로 FPS · 늦음에는 안 나온다).
   * 0이나 1에 가까우면 고르고(모두 같은 칸에 보인다), 그 사이면 몇 프레임만 늦게 보인다. 프레임이 없거나 FPS를 덮어썼으면 0
   */
  overrun(ms: number, vsyncMs: number): number {
    if (this.count === 0 || !(vsyncMs > 0) || this.overrideFps !== null) return 0;
    const from = (this.times[this.slot(0)] ?? 0) - ms;
    let n = 0;
    let over = 0;
    for (let k = 0; k < this.count; k++) {
      const i = this.slot(k);
      if ((this.times[i] ?? 0) <= from) break;
      n++;
      if ((this.spans[i] ?? 0) > vsyncMs) over++;
    }
    return n > 0 ? over / n : 0;
  }

  /**
   * 버퍼 전체에서 안개 주기 프레임 · 그 밖 프레임의 작업 시간 p95 (ms, 잔렉 고치기). 안개 프레임이 하나도 없으면 fog = null.
   * out을 주면 거기에 채운다(할당 없음)
   */
  fogWork(out: { fog: number | null; other: number } = { fog: null, other: 0 }): {
    fog: number | null;
    other: number;
  } {
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const i = this.slot(k);
      if (this.fogs[i] === 1) this.scratch[n++] = this.works[i] ?? 0;
    }
    out.fog = n > 0 ? percentileInPlace(this.scratch, n, P95) : null;
    let m = 0;
    for (let k = 0; k < this.count; k++) {
      const i = this.slot(k);
      if (this.fogs[i] !== 1) this.scratch[m++] = this.works[i] ?? 0;
    }
    out.other = percentileInPlace(this.scratch, m, P95);
    return out;
  }

  /** 버퍼 전체(최근 capacity 프레임) 요약. fps는 최근 1초 */
  summary(): FrameStatsInfo {
    const fps = this.window(FPS_WINDOW_MS).fps;
    const base = { frames: this.count, drawCalls: this.drawCalls, skipped: this.skippedTicks };
    const f = this.overrideFps;
    if (f !== null) {
      const ms = 1000 / f;
      return { ...base, fps: f, intervalAvg: ms, intervalP95: ms, workAvg: ms, workP95: ms };
    }
    // 간격: NaN(첫 프레임 · 끊김)을 뺀다
    let n = 0;
    let sum = 0;
    for (let k = 0; k < this.count; k++) {
      const iv = this.intervals[this.slot(k)] ?? Number.NaN;
      if (Number.isNaN(iv)) continue;
      this.scratch[n] = iv;
      sum += iv;
      n++;
    }
    const intervalAvg = n > 0 ? sum / n : 0;
    const intervalP95 = percentileInPlace(this.scratch, n, P95);
    let wsum = 0;
    for (let k = 0; k < this.count; k++) {
      const w = this.works[this.slot(k)] ?? 0;
      this.scratch[k] = w;
      wsum += w;
    }
    const workAvg = this.count > 0 ? wsum / this.count : 0;
    const workP95 = percentileInPlace(this.scratch, this.count, P95);
    return { ...base, fps, intervalAvg, intervalP95, workAvg, workP95 };
  }
}

/** 이 세션의 측정 (main.ts가 Phaser 루프에 끼운다). 덮어쓰기는 디버그 injectFps(gfx/state.ts)를 따른다 */
export const sessionFrameStats = new FrameStats(FRAME_STATS_CAPACITY, getFpsOverride);

/** 판 장면이 지금 그리는 프레임이 안개 주기 프레임이다 (worldRenderer) */
export function noteFogFrame(): void {
  sessionFrameStats.markFog();
}

/** 지금 측정 요약 (아직 렌더한 프레임이 없으면 null) */
export function frameStatsInfo(): FrameStatsInfo | null {
  return sessionFrameStats.recorded > 0 ? sessionFrameStats.summary() : null;
}

// ───────────── 그리기 호출 세기 (WebGL) ─────────────

/** 세는 WebGL 그리기 메서드. 인스턴스 · 범위 판은 WebGL2에만 있다 */
export const GL_DRAW_METHODS = [
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
] as const;

export interface DrawCounter {
  /** 프레임 시작 (Phaser PRE_RENDER): 이번 프레임 수를 0으로 */
  beginCount(): void;
  /** 프레임 끝 (Phaser POST_RENDER): 이번 프레임의 그리기 호출 수. onFrame에도 넘긴다 */
  endCount(): number;
  /** 감싼 뒤 모든 그리기 호출 수 (누계) */
  readonly total: number;
  /** 감싼 메서드 이름 (컨텍스트에 있는 것만) */
  readonly methods: readonly string[];
  /** 감싼 것을 되돌린다 */
  uninstall(): void;
}

/** 그리기 메서드 (인자는 최대 6개: drawRangeElements) */
type DrawFn = (a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown, f?: unknown) => unknown;

/**
 * WebGL 그리기 호출을 센다 (?debug=1 오버레이를 켰을 때만 debug.ts watchDrawCalls가 건다). 컨텍스트 *인스턴스*의
 * 메서드를 감싸므로 다른 컨텍스트(안개 GPU 시험 등)와 프로토타입은 건드리지 않는다. 감싼 함수는 고정 인자로 넘겨 호출마다
 * 배열을 만들지 않는다 (WebIDL은 남는 인자를 버린다)
 */
export function installDrawCounter(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  onFrame?: (calls: number) => void,
): DrawCounter {
  // 메서드 이름으로 읽고 쓰려고 레코드로 본다 (WebGL 타입에는 문자열 색인이 없다)
  const target = gl as unknown as Record<string, unknown>;
  let frame = 0;
  let total = 0;
  const restore: (() => void)[] = [];
  const methods: string[] = [];
  for (const name of GL_DRAW_METHODS) {
    const orig = target[name];
    if (typeof orig !== 'function') continue;
    const fn = orig as DrawFn;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
    target[name] = function countedDraw(
      a?: unknown,
      b?: unknown,
      c?: unknown,
      d?: unknown,
      e?: unknown,
      f?: unknown,
    ) {
      frame++;
      total++;
      return fn.call(gl, a, b, c, d, e, f);
    };
    methods.push(name);
    restore.push(() => {
      if (hadOwn) target[name] = orig;
      else delete target[name];
    });
  }
  return {
    beginCount() {
      frame = 0;
    },
    endCount() {
      const n = frame;
      onFrame?.(n);
      return n;
    },
    get total() {
      return total;
    },
    methods,
    uninstall() {
      for (const r of restore) r();
      restore.length = 0;
    },
  };
}
