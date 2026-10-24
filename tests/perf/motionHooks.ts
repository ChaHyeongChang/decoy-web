// 내 캐릭터 움직임 고르기 측정 도우미 (docs/PERF.md 5절). 화면 코드와 상관없이 브라우저 API와 두 빌드에 다 있는 디버그 훅
// (getRenderPos · getLocalState · tileToClient · pendingInputs · snapCount)만 써서, 고치기 전 빌드(origin/main)와 후 빌드를
// 같은 방법으로 잰다.
//  - 프레임마다(그 rAF 시각의 마지막 콜백 뒤) 내 그린 자리(타일) · 예측 상태 · 화면 위 타일 (0,0) 자리(= 카메라) · 내 화면 자리
//    (CSS px) · 그 프레임 작업 시간을 적는다
//  - 키 눌림 · 뗌 시각(페이지 시계)을 적는다 (입력 → 화면 첫 움직임 지연)
//  - hz가 있으면 rAF를 그 주기로 직접 돌린다(헤드리스는 60Hz 고정 — perfHooks.ts와 같은 방식). 콜백에는 실제 기기처럼 그 프레임의
//    vsync 시각(주기 격자 위, 지금 이하의 마지막 칸)을 준다
//  - heavy가 있으면 그 확률로 프레임 끝에 바쁜 기다림을 넣는다: 120Hz를 고르게 못 버티는 기기처럼 vsync를 놓쳐 간격이
//    8.3 · 16.7ms로 섞이고(약 90fps), 그동안 입력 타이머 · 기기 안 서버 틱도 늦게 깬다
//  - Math.random을 시드 난수로 (연습 판 봇 시드가 두 빌드에서 같게). 무거운 프레임 고르기는 따로 흐르는 난수

export interface MotionFrame {
  /** rAF 시각 (vsync) */
  t: number;
  /** 기록 시각 (이 프레임 콜백이 끝난 뒤 performance.now) */
  at: number;
  /** 이 프레임 콜백 작업 시간 (ms, 넣은 바쁜 기다림 제외) */
  work: number;
  /** 그린 내 자리 (타일) */
  mx: number;
  my: number;
  /** 예측 상태 (타일) */
  sx: number;
  sy: number;
  /** 화면 위 타일 (0,0) (CSS px) — 카메라가 움직이면 반대로 움직인다 */
  cx: number;
  cy: number;
  /** 내 그린 엔티티의 화면 위치 (CSS px) */
  px: number;
  py: number;
  /** CSS px / 타일 */
  k: number;
  pend: number;
  snaps: number;
  /** 맵 조각 옮기기 누계 · 누계 ms (GPU 경로, gfx.features — 없으면 0) */
  chunks: number;
  chunkMs: number;
  /** WebGL 텍스처 올리기 누계 (texImage2D · texSubImage2D 횟수 · 화소) */
  uploads: number;
  uploadPx: number;
}

export interface MotionKey {
  t: number;
  type: 'down' | 'up';
  code: string;
}

export interface MotionStore {
  on: boolean;
  frames: MotionFrame[];
  keys: MotionKey[];
  heavyFrames: number;
  /** 메인 스레드 긴 작업 (50ms 넘게, PerformanceObserver longtask): 시작 시각 · 길이 */
  longTasks: { t: number; ms: number }[];
  start(): void;
  stop(): {
    frames: MotionFrame[];
    keys: MotionKey[];
    heavyFrames: number;
    dpr: number;
    longTasks: { t: number; ms: number }[];
  };
}

export interface MotionHookConfig {
  seed: number;
  hz: number | null;
  heavy: { prob: number; ms: number } | null;
}

/** addInitScript로 페이지보다 먼저 심는다 (직렬화되어 페이지 안에서 돈다 — 바깥 변수를 쓰지 않는다) */
export function installMotionHooks(cfg: MotionHookConfig): void {
  const mulberry = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let x = s;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };
  Math.random = mulberry(cfg.seed);
  const heavyRand = mulberry(cfg.seed ^ 0x5bd1e995);
  const now = performance.now.bind(performance);

  interface Hook {
    getRenderPos(): { x: number; y: number } | null;
    getDrawn(): { kind: string; x: number; y: number }[];
    getAnimState(): { frames: number } | null;
    readonly gfx: { features: Record<string, unknown> };
    getLocalState(): { x: number; y: number } | null;
    tileToClient(x: number, y: number): { x: number; y: number } | null;
    readonly pendingInputs: number;
    readonly snapCount: number;
  }
  const store: MotionStore = {
    on: false,
    frames: [],
    keys: [],
    heavyFrames: 0,
    longTasks: [],
    start() {
      this.frames = [];
      this.keys = [];
      this.heavyFrames = 0;
      this.longTasks = [];
      this.on = true;
    },
    stop() {
      this.on = false;
      return {
        frames: this.frames,
        keys: this.keys,
        heavyFrames: this.heavyFrames,
        dpr: window.devicePixelRatio,
        longTasks: this.longTasks,
      };
    },
  };
  try {
    new PerformanceObserver((list) => {
      if (!store.on) return;
      for (const e of list.getEntries()) store.longTasks.push({ t: e.startTime, ms: e.duration });
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // longtask를 모르는 브라우저
  }
  (window as unknown as { __MOTION__: MotionStore }).__MOTION__ = store;

  const onKey = (type: 'down' | 'up') => (e: KeyboardEvent) => {
    if (store.on && !e.repeat) store.keys.push({ t: now(), type, code: e.code });
  };
  window.addEventListener('keydown', onKey('down'), true);
  window.addEventListener('keyup', onKey('up'), true);

  // 텍스처 올리기 세기 (WebGL): 인자 끝의 화소 원본(캔버스 · 이미지 · 배열)의 크기
  const up = { n: 0, px: 0 };
  const sizeOf = (args: unknown[]): number => {
    const src = args[args.length - 1] as { width?: number; height?: number } | null;
    if (src && typeof src.width === 'number' && typeof src.height === 'number') return src.width * src.height;
    const w = args.find((a, i) => i >= 3 && typeof a === 'number' && i <= 4);
    return typeof w === 'number' ? 0 : 0;
  };
  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    for (const name of ['texImage2D', 'texSubImage2D'] as const) {
      const orig = proto[name] as (...a: unknown[]) => void;
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: function (this: unknown, ...args: unknown[]) {
          up.n += 1;
          up.px += sizeOf(args);
          return orig.apply(this, args);
        },
      });
    }
  }

  /** 이 rAF 시각의 기록 (같은 시각의 다음 콜백이 덮어쓴다: 프레임의 마지막 상태) */
  let lastT = Number.NaN;
  let workT = 0;
  /** 판 장면이 그린 프레임 수 (프레임 제한이 건너뛴 rAF는 적지 않는다) */
  let lastDrawn = -1;
  const record = (t: number, work: number): void => {
    if (!store.on) return;
    const d = (window as unknown as { __DECOY__?: Hook }).__DECOY__;
    const me = d?.getRenderPos();
    if (!d || !me) return;
    const drawnFrames = d.getAnimState()?.frames ?? -1;
    if (drawnFrames >= 0 && drawnFrames === lastDrawn) return;
    lastDrawn = drawnFrames;
    const st = d.getLocalState();
    const c0 = d.tileToClient(0, 0);
    const c1 = d.tileToClient(1, 0);
    // 화면 위 내 자리는 실제로 그린 내 엔티티 자리로 잰다 (고친 뒤에는 카메라 격자 나머지만큼 옮겨 그린다, 전에는 me와 같다)
    const self = d.getDrawn().find((e) => e.kind === 'self') ?? me;
    const p = d.tileToClient(self.x, self.y);
    if (!c0 || !c1 || !p) return;
    const f: MotionFrame = {
      t,
      at: now(),
      work,
      mx: me.x,
      my: me.y,
      sx: st?.x ?? Number.NaN,
      sy: st?.y ?? Number.NaN,
      cx: c0.x,
      cy: c0.y,
      px: p.x,
      py: p.y,
      k: c1.x - c0.x,
      pend: d.pendingInputs,
      snaps: d.snapCount,
      chunks: Number(d.gfx.features.chunkBakes ?? 0),
      chunkMs: Number(d.gfx.features.chunkBakeMs ?? 0),
      uploads: up.n,
      uploadPx: up.px,
    };
    const last = store.frames[store.frames.length - 1];
    if (last && last.t === t) store.frames[store.frames.length - 1] = f;
    else store.frames.push(f);
  };

  if (cfg.hz !== null && cfg.hz > 0) {
    const period = 1000 / cfg.hz;
    const queue: FrameRequestCallback[] = [];
    const mc = new MessageChannel();
    let scheduled = false;
    let next = now() + period;
    let id = 0;
    const fire = (): void => {
      scheduled = false;
      const real = now();
      next += period;
      while (next <= real) next += period;
      // 이 프레임의 vsync 시각: 지금 이하의 마지막 격자 칸
      const vs = next - period;
      const cbs = queue.splice(0);
      for (const cb of cbs) cb(vs);
      if (cfg.heavy && heavyRand() < cfg.heavy.prob) {
        store.heavyFrames += store.on ? 1 : 0;
        const until = now() + cfg.heavy.ms;
        while (now() < until) {
          // 바쁜 기다림 (무거운 프레임 흉내)
        }
      }
    };
    const spin = (): void => {
      if (now() >= next) fire();
      else mc.port2.postMessage(0);
    };
    mc.port1.onmessage = spin;
    const schedule = (): void => {
      if (scheduled) return;
      scheduled = true;
      const wait = next - now();
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
      // 게임은 판 중에 rAF를 끊지 않는다
    };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    raf((t: number) => {
      if (t !== lastT) {
        lastT = t;
        workT = 0;
      }
      const t0 = now();
      try {
        cb(t);
      } finally {
        workT += now() - t0;
        record(t, workT);
      }
    });
}
