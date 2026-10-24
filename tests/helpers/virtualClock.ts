// 가상 시계 (렌더링 최적화: 프레임 독립성 E2E). 페이지보다 먼저 도는 초기화 스크립트로 시간 · 난수를 모두 가상으로 바꾼다.
//  - performance.now · Date.now · new Date() · setTimeout/clearTimeout · setInterval/clearInterval ·
//    requestAnimationFrame/cancelAnimationFrame · requestIdleCallback/cancelIdleCallback · Math.random(시드) ·
//    crypto.getRandomValues · crypto.randomUUID(시드)
//  - 가상 시간은 __VCLOCK__.advance(ms)로만 흐른다. 프레임은 정확히 k × 1000 / hz 시각(더해 가지 않고 곱해서 구한다:
//    60Hz의 k번째와 120Hz의 2k번째 프레임 시각이 비트까지 같다)이고, 그 사이 가상 타이머를 시각 순서대로 돌린다
//    (같은 시각이면 타이머가 프레임보다 먼저, 타이머끼리는 만든 순서). 콜백마다 진짜 이벤트 루프로 한 번 양보(진짜 MessageChannel)해서
//    마이크로태스크 · 입출력이 돈다
//  - 페이지를 여는 동안은 진짜 시간을 따라가는 펌프(pump(true), 처음에 켜져 있음): 로비가 그려지고 폰트를 받는다.
//    시험은 pump(false)로 멈춘 뒤 advanceTo로 두 페이지를 같은 가상 시각에 맞추고 reseed로 난수를 같게 한다
//  - 멈춘 동안의 조작은 Playwright 동작성 검사(진짜 rAF를 기다린다) 대신 page.evaluate 안의 element.click() · dispatchEvent로 한다
// 이 함수는 context.addInitScript(installVirtualClock, cfg)로 페이지 안에서 돈다: 바깥 변수를 쓰지 않는다.

/** 페이지 안 가상 시계 조작 (window.__VCLOCK__) */
export interface VirtualClockApi {
  readonly hz: number;
  /** 지금 가상 시각 (performance.now와 같다) */
  now(): number;
  /** 지금까지 돌린 프레임 수 */
  readonly frames: number;
  /** 진짜 시간을 따라가는 펌프를 켜고 끈다 (끄면 돌던 펌프가 멈출 때까지 기다린다) */
  pump(on: boolean): Promise<void>;
  /** 가상 시간을 ms만큼 흘린다 (그 사이 프레임 · 타이머를 시각 순서대로 돌린다) */
  advance(ms: number): Promise<void>;
  /** 가상 시각 t까지 흘린다 */
  advanceTo(t: number): Promise<void>;
  /** Math.random · crypto 난수를 이 시드로 다시 시작한다 */
  reseed(seed: number): void;
  /** 작업 시간 모형이 적은 그린 프레임 (work를 켰을 때만, clearLog로 비운다) */
  readonly frameLog: VirtualFrameLog[];
  clearLog(): void;
}

declare global {
  interface Window {
    __VCLOCK__?: VirtualClockApi;
  }
}

export interface VirtualClockConfig {
  seed: number;
  hz: number;
  /**
   * 바쁜 기기 흉내 (내 움직임 고르기 시험, 없으면 0): 타이머가 정한 시각보다 0 ~ 이 값(ms)만큼 늦게 깬다(시드 난수, 게임 난수와
   * 따로 흐른다). 120Hz에서 프레임 작업이 입력 타이머 · 기기 안 서버 틱을 막는 것
   */
  timerLateMs?: number;
  /** 이 확률로 프레임(vsync)을 건너뛴다 (없으면 0): 120Hz를 고르게 못 버텨 8.3 · 16.7ms가 섞이는 기기 */
  dropFrames?: number;
  /**
   * 작업 시간 모형 (잔렉 고치기, 없으면 끔 — 기존 시험 그대로). 판 장면이 그린 프레임마다 작업 시간 W(vsync 주기 배수)를 정해
   * 메인 스레드를 그만큼 막는다. 규칙은 이 컨테이너 크롬 실험(docs/PERF.md 6절)과 같다:
   *  - 메인이 바쁜 동안 온 vsync의 rAF는 메인이 풀린 뒤 늦게 시작하고, 시각은 '풀린 시각 이하의 마지막 vsync'(지난 rAF + 한 주기 이상)
   *    — 늦음이 한 주기보다 짧으면 같은 격자 칸(늦게 시작), 넘으면 칸을 건너뛴다
   *  - 그동안 깰 타이머는 메인이 풀린 뒤에 돈다
   *  - 그린 프레임의 화면 표시 = (시작 + W + 마감 여유) 다음 vsync. 같은 vsync에 둘이면 나중 것이 보인다(frameLog로 시험이 계산)
   * 프레임 제한기가 건너뛴 rAF(그리지 않음)는 작업 0.02 주기
   */
  work?: VirtualWorkModel;
}

/** 작업 시간 모형 (VirtualClockConfig.work). 값은 vsync 주기 배수 */
export interface VirtualWorkModel {
  /** 그린 프레임의 기본 작업 */
  frame: number;
  /** 기본 작업에 0 ~ 이 값을 고르게 더한다 */
  jitter?: number;
  /** 안개를 다시 그린 프레임(getAnimState().fogAt가 바뀜)의 작업 (기본 작업보다 크면 그것으로) */
  fog?: number;
  /** 이 확률로 튀는 프레임 */
  spikeProb?: number;
  /** 튀는 프레임의 작업 */
  spike?: number;
  /** 화면 표시 마감 여유 (ms, 기본 1): 끝난 뒤 이만큼 안에 vsync가 오면 그다음 vsync에 보인다 */
  deadlineMs?: number;
}

/** 작업 시간 모형이 적는 그린 프레임 하나 (window.__VCLOCK__.frameLog) */
export interface VirtualFrameLog {
  /** rAF 시각 (vsync 격자) */
  ts: number;
  /** 콜백을 시작한 시각 (메인이 바빴으면 ts보다 늦다) */
  start: number;
  /** 작업 시간 (ms) */
  work: number;
  /** 화면에 보이기 시작하는 vsync 시각 */
  disp: number;
  /** 안개를 다시 그린 프레임인가 */
  fog: boolean;
}

export function installVirtualClock(cfg: VirtualClockConfig): void {
  type Cb = (...args: unknown[]) => void;
  interface Timer {
    id: number;
    due: number;
    seq: number;
    cb: Cb;
    args: unknown[];
    interval: number | null;
  }
  const w = window;
  const realPerfNow = performance.now.bind(performance);
  const realSetTimeout = w.setTimeout.bind(w);
  const RealDate = Date;
  const RealMessageChannel = w.MessageChannel;
  /** 가상 Date의 0 시각 (고정: 두 페이지가 같은 날짜를 본다) */
  const EPOCH = 1_760_000_000_000;
  /** 같은 가상 시각에 이보다 많은 타이머가 돌면 무한 반복으로 본다 */
  const MAX_SAME_TIME = 5000;

  let now = 0;
  let frameIndex = 1;
  let frames = 0;
  let seq = 0;
  let nextId = 1;
  const timers = new Map<number, Timer>();
  let rafs = new Map<number, FrameRequestCallback>();
  let busy: Promise<void> = Promise.resolve();
  let pumping = false;
  let pumpLoop: Promise<void> | null = null;

  // ───── 시드 난수 (mulberry32). Math.random과 crypto는 따로 흐른다: Phaser 글자 객체(UUID)처럼 그리는 쪽이
  // Math.random을 쓰는 횟수가 달라도 기기 안 판의 임시 ID · 토큰(crypto)은 같다 ─────
  const mulberry = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  let randMath = mulberry(cfg.seed);
  let randCrypto = mulberry(cfg.seed ^ 0x9e3779b9);
  /** 바쁜 기기 흉내 난수 (타이머 늦음 · 프레임 건너뛰기, reseed와 상관없다) */
  const randBusy = mulberry(cfg.seed ^ 0x51ed270b);
  const timerLateMs = Math.max(0, cfg.timerLateMs ?? 0);
  const dropFrames = Math.max(0, Math.min(0.9, cfg.dropFrames ?? 0));
  // ───── 작업 시간 모형 (cfg.work) ─────
  const work = cfg.work ?? null;
  const period = 1000 / cfg.hz;
  /** 메인 스레드가 풀리는 시각 (작업 시간 모형) */
  let mainFreeAt = -Infinity;
  const frameLog: VirtualFrameLog[] = [];
  let lastAnimFrames = -1;
  let lastFogAt: number | null = null;
  interface AnimProbe {
    getAnimState?(): { frames: number; fogAt: number | null } | null;
  }
  /** 이 콜백에서 판 장면이 그렸는가 · 안개를 다시 그렸는가 (디버그 훅 getAnimState, 없으면 그리지 않은 것으로) */
  const probeDrawn = (): { drawn: boolean; fog: boolean } => {
    const a = (w as unknown as { __DECOY__?: AnimProbe }).__DECOY__?.getAnimState?.() ?? null;
    if (!a) {
      lastAnimFrames = -1;
      return { drawn: false, fog: false };
    }
    const drawn = a.frames !== lastAnimFrames;
    const fog = drawn && a.fogAt !== lastFogAt;
    lastAnimFrames = a.frames;
    lastFogAt = a.fogAt;
    return { drawn, fog };
  };
  /** 작업 시간 (ms) */
  const workMs = (drawn: boolean, fog: boolean): number => {
    if (!work) return 0;
    if (!drawn) return 0.02 * period;
    let k = work.frame + (work.jitter ? randBusy() * work.jitter : 0);
    if (fog && work.fog !== undefined && work.fog > k) k = work.fog;
    if (work.spikeProb && work.spike !== undefined && randBusy() < work.spikeProb)
      k = Math.max(k, work.spike);
    return k * period;
  };
  Math.random = () => randMath();
  const fillRandom = <T extends ArrayBufferView | null>(arr: T): T => {
    if (arr) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(randCrypto() * 256);
    }
    return arr;
  };
  const cryptoObj = w.crypto;
  Object.defineProperty(cryptoObj, 'getRandomValues', { configurable: true, value: fillRandom });
  Object.defineProperty(cryptoObj, 'randomUUID', {
    configurable: true,
    value: (): string => {
      const b = fillRandom(new Uint8Array(16));
      b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
      b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
      const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  });

  // ───── 시간 ─────
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  function VirtualDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) return new RealDate(EPOCH + now).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [EPOCH + now] : args, new.target) as unknown;
  }
  VirtualDate.prototype = RealDate.prototype;
  VirtualDate.now = (): number => EPOCH + now;
  VirtualDate.parse = RealDate.parse;
  VirtualDate.UTC = RealDate.UTC;
  w.Date = VirtualDate as unknown as DateConstructor;

  // ───── 타이머 ─────
  const addTimer = (cb: unknown, ms: unknown, args: unknown[], repeat: boolean): number => {
    const id = nextId;
    nextId += 1;
    if (typeof cb !== 'function') return id;
    const delay = Math.max(0, Number(ms) || 0);
    seq += 1;
    timers.set(id, {
      id,
      due: now + delay + (timerLateMs > 0 ? randBusy() * timerLateMs : 0),
      seq,
      cb: cb as Cb,
      args,
      interval: repeat ? Math.max(1, delay) : null,
    });
    return id;
  };
  const clearTimer = (id: unknown): void => {
    if (typeof id === 'number') timers.delete(id);
  };
  // 브라우저 타이머 ID는 숫자다 (Node 타입의 Timeout과 다르다): 페이지 코드가 쓰는 모양 그대로
  w.setTimeout = ((cb: unknown, ms?: unknown, ...args: unknown[]) =>
    addTimer(cb, ms, args, false)) as unknown as typeof w.setTimeout;
  w.setInterval = ((cb: unknown, ms?: unknown, ...args: unknown[]) =>
    addTimer(cb, ms, args, true)) as unknown as typeof w.setInterval;
  w.clearTimeout = clearTimer as typeof w.clearTimeout;
  w.clearInterval = clearTimer as typeof w.clearInterval;
  w.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId;
    nextId += 1;
    rafs.set(id, cb);
    return id;
  };
  w.cancelAnimationFrame = (id: number): void => {
    rafs.delete(id);
  };
  // 유휴 콜백은 1ms 뒤 타이머로 (남은 시간은 프레임 길이와 무관한 고정값: fps에 따라 일을 나누는 양이 달라지지 않게)
  w.requestIdleCallback = (cb: IdleRequestCallback): number =>
    addTimer(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1, [], false);
  w.cancelIdleCallback = (id: number): void => clearTimer(id);

  // ───── 진행 ─────
  const frameTime = (k: number): number => (k * 1000) / cfg.hz;
  const report = (err: unknown): void => {
    if (typeof w.reportError === 'function') w.reportError(err);
    else
      realSetTimeout(() => {
        throw err;
      }, 0);
  };
  /** 진짜 이벤트 루프에 한 번 양보 (마이크로태스크 · 입출력이 돈다) */
  const yieldReal = (): Promise<void> =>
    new Promise((resolve) => {
      const ch = new RealMessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  const earliestTimer = (): Timer | null => {
    let best: Timer | null = null;
    for (const t of timers.values())
      if (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq)) best = t;
    return best;
  };
  const runTo = async (target: number): Promise<void> => {
    let sameTime = 0;
    let lastAt = -1;
    for (;;) {
      // 작업 시간 모형: 메인이 바쁜 동안 온 vsync는 풀린 시각 이하의 마지막 vsync로(늦게 시작, 늦음이 한 주기를 넘으면 칸 건너뜀)
      let fi = frameIndex;
      if (work && mainFreeAt > frameTime(fi))
        fi = Math.max(fi, Math.floor((mainFreeAt * cfg.hz) / 1000 + 1e-9));
      const ft = frameTime(fi);
      const fStart = work ? Math.max(ft, mainFreeAt) : ft;
      const t = earliestTimer();
      // 메인이 바쁜 동안 깰 타이머는 풀린 뒤에 돈다
      const tDue = t ? (work ? Math.max(t.due, mainFreeAt) : t.due) : Infinity;
      if (t && tDue <= fStart && tDue <= target) {
        if (tDue > now) now = tDue;
        sameTime = now === lastAt ? sameTime + 1 : 0;
        lastAt = now;
        if (sameTime > MAX_SAME_TIME) throw new Error(`가상 시계: ${now}ms에 타이머가 끝없이 돈다`);
        if (t.interval !== null) {
          seq += 1;
          t.due += t.interval;
          t.seq = seq;
        } else timers.delete(t.id);
        try {
          t.cb(...t.args);
        } catch (err) {
          report(err);
        }
        await yieldReal();
        continue;
      }
      if (fStart <= target) {
        now = fStart;
        frameIndex = fi + 1;
        // 건너뛴 vsync: 콜백은 다음 프레임까지 기다린다
        if (dropFrames > 0 && randBusy() < dropFrames) continue;
        frames += 1;
        const list = rafs;
        rafs = new Map();
        for (const cb of list.values()) {
          try {
            cb(ft);
          } catch (err) {
            report(err);
          }
        }
        if (work) {
          const { drawn, fog } = probeDrawn();
          const ms = workMs(drawn, fog);
          mainFreeAt = fStart + ms;
          if (drawn) {
            const di = Math.ceil(((mainFreeAt + (work.deadlineMs ?? 1)) * cfg.hz) / 1000 - 1e-9);
            frameLog.push({ ts: ft, start: fStart, work: ms, disp: frameTime(di), fog });
          }
        }
        await yieldReal();
        continue;
      }
      break;
    }
    if (target > now) now = target;
  };
  /** 진행은 한 번에 하나씩 (펌프 · 시험 호출이 겹치지 않게) */
  const serial = (fn: () => Promise<void>): Promise<void> => {
    const next = busy.then(fn, fn);
    busy = next.catch(() => undefined);
    return next;
  };
  const startPump = (): void => {
    if (pumping) return;
    pumping = true;
    // 진짜 시간과 가상 시간의 차이 (펌프를 다시 켜면 그 순간부터 이어 간다)
    const base = now - realPerfNow();
    pumpLoop = (async () => {
      while (pumping) {
        const target = realPerfNow() + base;
        await serial(() => runTo(target));
        await new Promise<void>((resolve) => realSetTimeout(resolve, 4));
      }
    })();
  };

  const api: VirtualClockApi = {
    hz: cfg.hz,
    now: () => now,
    get frames() {
      return frames;
    },
    pump: async (on) => {
      if (on) startPump();
      else {
        pumping = false;
        await pumpLoop;
        pumpLoop = null;
        await busy;
      }
    },
    advance: (ms) => serial(() => runTo(now + Math.max(0, ms))),
    advanceTo: (t) => serial(() => runTo(Math.max(now, t))),
    reseed: (seed) => {
      randMath = mulberry(seed);
      randCrypto = mulberry(seed ^ 0x9e3779b9);
    },
    frameLog,
    clearLog: () => {
      frameLog.length = 0;
    },
  };
  w.__VCLOCK__ = api;
  startPump();
}
