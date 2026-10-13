// 프레임 성능 측정 도우미 (렌더링 최적화, docs/PERF.md). 화면 코드와 상관없이 브라우저 API에 끼워 넣어 재므로
// 최적화 전 빌드(origin/main)와 후 빌드를 같은 방법으로 잰다.
//  - requestAnimationFrame 콜백: 같은 rAF 시각(타임스탬프)끼리 묶어 한 프레임으로 본다. 프레임 간격 = 타임스탬프 차이,
//    작업 시간 = 그 프레임의 콜백들이 메인 스레드에서 쓴 시간(JS + 그리기 명령 제출. GPU 래스터는 들어가지 않는다)
//  - WebGL 그리기 호출(drawArrays · drawElements · 인스턴스판) · 텍스처 올리기(texImage2D · texSubImage2D) 횟수
//  - Canvas 2D 칠하기 명령(drawImage · fill · stroke · fillRect · putImageData …) 횟수: 화면 캔버스와 그 밖(안개 · 미니맵 등) 따로
//  - JS 힙: performance.memory(--enable-precise-memory-info)를 프레임마다 읽어 늘어난 양의 합 = 할당량 어림, 줄어든 횟수 = GC 어림
//  - Math.random을 시드 난수로 바꿔 연습 판 봇 시드 · 장면이 두 빌드에서 같게 한다(시계는 실제 시계라 완전히 같지는 않다)

/**
 * addInitScript로 페이지보다 먼저 심는다 (직렬화되어 페이지 안에서 돈다 — 바깥 변수를 쓰지 않는다).
 * hz가 있으면 rAF를 그 주기로 직접 돌린다: 헤드리스 크롬은 화면 갱신이 60Hz로 묶여 있어서(플래그로도 안 풀림)
 * 120Hz 화면을 흉내 내려면 setTimeout으로 마감 1.5ms 앞까지 기다린 뒤 MessageChannel로 마감을 맞춘다.
 * 합성기는 여전히 60Hz로 내보내지만 게임은 120번 걷는다 — 프레임마다 8.33ms 안에 끝나는지를 메인 스레드에서 잰다
 */
export function installPerfHooks(cfg: { seed: number; hz: number | null }): void {
  const { seed, hz } = cfg;
  type Frame = {
    t: number;
    work: number;
    draws: number;
    uploads: number;
    ops2d: number;
    opsMain: number;
    heap: number;
  };
  interface PerfStore {
    recording: boolean;
    frames: Frame[];
    longTasks: number;
    start(): void;
    stop(): Frame[];
  }
  // 시드 난수 (mulberry32)
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const counters = { draws: 0, uploads: 0, ops2d: 0, opsMain: 0 };
  const now = performance.now.bind(performance);
  const mem = (): number =>
    (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  let cur: Frame | null = null;
  const store: PerfStore = {
    recording: false,
    frames: [],
    longTasks: 0,
    start() {
      this.frames = [];
      this.longTasks = 0;
      cur = null;
      this.recording = true;
    },
    stop() {
      this.recording = false;
      return this.frames;
    },
  };
  (window as unknown as { __PERF__: PerfStore }).__PERF__ = store;

  if (hz !== null && hz > 0) {
    const period = 1000 / hz;
    const queue: FrameRequestCallback[] = [];
    const mc = new MessageChannel();
    let scheduled = false;
    let next = performance.now() + period;
    let id = 0;
    const fire = (): void => {
      scheduled = false;
      const t = performance.now();
      // 늦어진 프레임은 따라잡지 않는다: 실제 화면처럼 vsync 격자 위의 다음 칸으로 (늦은 만큼 밀지 않는다 —
      // 그래야 간격이 주기의 배수가 되어 후 빌드의 화면 주사율 재기가 실제 기기와 같게 본다)
      next += period;
      while (next <= t) next += period;
      const cbs = queue.splice(0);
      for (const cb of cbs) cb(t);
    };
    const spin = (): void => {
      if (performance.now() >= next) fire();
      else mc.port2.postMessage(0);
    };
    mc.port1.onmessage = spin;
    const schedule = (): void => {
      if (scheduled) return;
      scheduled = true;
      const wait = next - performance.now();
      if (wait > 2) window.setTimeout(spin, wait - 1.5);
      else spin();
    };
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queue.push(cb);
      schedule();
      id += 1;
      return id;
    };
    window.cancelAnimationFrame = (): void => {
      // 게임은 rAF를 끊지 않는다 (탭을 숨길 때만) — 측정 중에는 무시해도 된다
    };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    raf((t: number) => {
      if (!cur || cur.t !== t) {
        if (cur && store.recording) store.frames.push(cur);
        // 횟수 칸은 프레임을 열 때의 누계다 — 프레임별 횟수는 summarize가 다음 프레임 누계와 빼서 낸다
        cur = {
          t,
          work: 0,
          draws: counters.draws,
          uploads: counters.uploads,
          ops2d: counters.ops2d,
          opsMain: counters.opsMain,
          heap: mem(),
        };
      }
      const frame = cur;
      const t0 = now();
      try {
        cb(t);
      } finally {
        frame.work += now() - t0;
      }
    });

  const wrap = <T extends object>(
    proto: T | undefined,
    names: string[],
    bump: (self: unknown) => void,
  ): void => {
    if (!proto) return;
    for (const name of names) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      const orig = desc?.value as ((...a: unknown[]) => unknown) | undefined;
      if (typeof orig !== 'function') continue;
      Object.defineProperty(proto, name, {
        ...desc,
        value: function (this: unknown, ...args: unknown[]) {
          bump(this);
          return orig.apply(this, args);
        },
      });
    }
  };
  const glDraw = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'];
  const glUpload = ['texImage2D', 'texSubImage2D'];
  wrap(window.WebGLRenderingContext?.prototype, glDraw, () => (counters.draws += 1));
  wrap(window.WebGL2RenderingContext?.prototype, glDraw, () => (counters.draws += 1));
  wrap(window.WebGLRenderingContext?.prototype, glUpload, () => (counters.uploads += 1));
  wrap(window.WebGL2RenderingContext?.prototype, glUpload, () => (counters.uploads += 1));
  const ops2d = [
    'drawImage',
    'fill',
    'stroke',
    'fillRect',
    'strokeRect',
    'fillText',
    'putImageData',
    'clearRect',
  ];
  wrap(window.CanvasRenderingContext2D?.prototype, ops2d, (self) => {
    const c = (self as CanvasRenderingContext2D).canvas;
    // 화면에 붙은 캔버스(Phaser 캔버스 렌더러의 화면)인가, 안 보이는 캔버스(안개 · 바닥 합성 · 미니맵 · 글자)인가
    if (c && c.isConnected) counters.opsMain += 1;
    else counters.ops2d += 1;
  });
  try {
    new PerformanceObserver((list) => {
      if (store.recording) store.longTasks += list.getEntries().length;
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // longtask를 모르는 브라우저
  }
}

export interface FrameStats {
  frames: number;
  seconds: number;
  fps: number;
  intervalAvg: number;
  intervalP50: number;
  intervalP95: number;
  intervalP99: number;
  workAvg: number;
  workP50: number;
  workP95: number;
  workP99: number;
  /** 작업 시간이 8.33ms(120Hz) · 16.7ms(60Hz)를 넘은 프레임 비율 */
  over120: number;
  over60: number;
  drawsAvg: number;
  drawsMax: number;
  uploadsPerSec: number;
  ops2dPerFrame: number;
  opsMainPerFrame: number;
  allocMBps: number;
  gcPerSec: number;
  longTasks: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

/** 기록한 프레임(열 때 누계 포함) → 요약 */
export function summarize(
  raw: {
    t: number;
    work: number;
    draws: number;
    uploads: number;
    ops2d: number;
    opsMain: number;
    heap: number;
  }[],
  longTasks: number,
): FrameStats {
  // 누계 차이: i번째 프레임의 횟수 = (i+1)번째를 열 때 누계 − i번째를 열 때 누계 (마지막 프레임은 버린다)
  const frames = raw.slice(0, -1).map((f, i) => {
    const next = raw[i + 1] ?? f;
    return {
      ...f,
      interval: next.t - f.t,
      dDraws: next.draws - f.draws,
      dUploads: next.uploads - f.uploads,
      dOps2d: next.ops2d - f.ops2d,
      dOpsMain: next.opsMain - f.opsMain,
      dHeap: next.heap - f.heap,
    };
  });
  const n = frames.length;
  const seconds = n > 0 ? ((raw[n]?.t ?? 0) - (raw[0]?.t ?? 0)) / 1000 : 0;
  const sortedI = frames.map((f) => f.interval).sort((a, b) => a - b);
  const sortedW = frames.map((f) => f.work).sort((a, b) => a - b);
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  const alloc = sum(frames.map((f) => Math.max(0, f.dHeap)));
  const gcs = frames.filter((f) => f.dHeap < -64 * 1024).length;
  return {
    frames: n,
    seconds: round(seconds),
    fps: round(seconds > 0 ? n / seconds : 0, 1),
    intervalAvg: round(sum(sortedI) / Math.max(1, n)),
    intervalP50: round(percentile(sortedI, 50)),
    intervalP95: round(percentile(sortedI, 95)),
    intervalP99: round(percentile(sortedI, 99)),
    workAvg: round(sum(sortedW) / Math.max(1, n)),
    workP50: round(percentile(sortedW, 50)),
    workP95: round(percentile(sortedW, 95)),
    workP99: round(percentile(sortedW, 99)),
    over120: round(frames.filter((f) => f.work > 1000 / 120).length / Math.max(1, n), 3),
    over60: round(frames.filter((f) => f.work > 1000 / 60).length / Math.max(1, n), 3),
    drawsAvg: round(sum(frames.map((f) => f.dDraws)) / Math.max(1, n), 1),
    drawsMax: Math.max(0, ...frames.map((f) => f.dDraws)),
    uploadsPerSec: round(sum(frames.map((f) => f.dUploads)) / Math.max(0.001, seconds), 1),
    ops2dPerFrame: round(sum(frames.map((f) => f.dOps2d)) / Math.max(1, n), 1),
    opsMainPerFrame: round(sum(frames.map((f) => f.dOpsMain)) / Math.max(1, n), 1),
    allocMBps: round(alloc / 1024 / 1024 / Math.max(0.001, seconds), 2),
    gcPerSec: round(gcs / Math.max(0.001, seconds), 2),
    longTasks,
  };
}
