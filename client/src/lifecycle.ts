// 앱 생명주기 · 재접속 (MOBILE_PLAN M12 8 · 9번): 수신 감시 · 재연결 간격 · 마지막 방 복귀 · 화면 꺼짐 방지 · 뒤로 가기.
// 판단하는 부품은 시계 · 타이머 · 브라우저 API를 주입받아 단위 테스트로 확인한다(tests/unit/lifecycle.test.ts).
// 브라우저 이벤트를 듣는 것은 listenLifecycle 하나이고, 무엇을 할지는 App(app.ts)이 정한다.
// 숨겨진 동안 소켓을 일부러 끊지 않는다: OS가 끊으면 서버 하트비트로 잡히고 서버의 30초 유예가 적용된다(DECISIONS M12)

/** 수신 감시: 화면이 보이는 동안 이만큼 서버 메시지가 하나도 없으면 끊고 바로 다시 연결한다 (서버 pong은 1초마다) */
export const RECV_TIMEOUT_MS = 4000;
/** 수신 감시를 확인하는 간격 */
export const WATCH_TICK_MS = 500;
/** 확인 타이머가 이보다 늦게 돌았으면 페이지가 멈췄던 것이다(정지 · 긴 버벅임): 끊지 않고 기한을 다시 잡는다 */
export const WATCH_STALL_MS = 2000;
/** 재연결 간격: 1 → 2 → 4초, 최대 5초 */
export const RECONNECT_FIRST_MS = 1000;
export const RECONNECT_MAX_MS = 5000;
/** 마지막 방 복귀 창 (서버 재접속 유예 balance.match.reconnectGrace와 같은 30초 — 단위 테스트가 대조) */
export const LAST_ROOM_MS = 30_000;
/** 마지막 방 복귀 중 옛 소켓이 아직 붙어 있어(in-progress · room-full) 거절되면 다시 시도하는 간격 */
export const REJOIN_RETRY_MS = 2000;

/** 시계와 타이머 (브라우저: performance.now · window.setTimeout, 시험: 가짜 시계) */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

/** n번째(0부터) 재연결을 기다리는 시간: 1 → 2 → 4 → 5 → 5 … 초 */
export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_FIRST_MS * 2 ** Math.max(0, attempt), RECONNECT_MAX_MS);
}

/** 연결 하나를 다루는 쪽 (NetClient) */
export interface LinkIo {
  /** 새 소켓을 연다 (열리면 opened, 실패 · 끊김이면 closed를 부른다) */
  connect(): void;
  /** 지금 소켓을 버린다 (closed를 바로 부른다) */
  drop(): void;
  /** 즉시 ping + 빠른 ping 5번으로 시계를 다시 맞춘다 */
  resync(): void;
}

export interface LinkEnv {
  /** 화면이 보이는가 (document.visibilityState) */
  visible(): boolean;
  /** 온라인인가 (navigator.onLine — 모르면 참) */
  online(): boolean;
}

type LinkState = 'idle' | 'connecting' | 'open' | 'waiting' | 'stopped';

/**
 * 연결 유지 (MOBILE_PLAN M12 8번).
 *  - 재연결: 끊기면 1 → 2 → 4 → 5초 간격. 숨겨졌거나 오프라인이면 타이머를 걸지 않고(시도 0회) 기다리다가,
 *    보이게 되거나 online · pageshow가 오면(kick) 바로 연결한다. 열리면 간격을 처음으로 돌린다
 *  - 수신 감시: 열려 있고 화면이 보이는 동안 RECV_TIMEOUT_MS 동안 아무것도 못 받으면 버리고 바로 다시 연결한다(반쯤 열린 소켓).
 *    숨김 이벤트에서 감시를 멈추고, 보임 이벤트에서 기한을 지금 + 4초로 잡고 즉시 ping을 보낸다(숨김 중 멈춘 타이머로
 *    멀쩡한 소켓을 끊는 오판 방지). 확인 타이머가 크게 늦었으면(정지 · 버벅임) 끊지 않고 기한을 다시 잡는다
 */
export class LinkKeeper {
  private state: LinkState = 'idle';
  private attempt = 0;
  private retryTimer: number | null = null;
  private watchTimer: number | null = null;
  private deadline = Infinity;
  private lastTick = 0;
  /** 숨김 이벤트를 받았고 아직 보임 이벤트가 오지 않았다 (감시 멈춤) */
  private hidden: boolean;
  /** 다음 closed는 감시 · 나가기로 일부러 버린 것: 기다리지 않고 바로 다시 연결 */
  private immediate = false;
  /** 연결 시도 수 · 감시로 버린 수 (디버그 · 시험) */
  connects = 0;
  watchdogDrops = 0;

  constructor(
    private readonly io: LinkIo,
    private readonly env: LinkEnv,
    private readonly clock: Clock,
  ) {
    this.hidden = !env.visible();
  }

  get status(): LinkState {
    return this.state;
  }

  /** 첫 연결 (부팅). 오프라인이면 기다린다 — 숨겨진 채 열린 탭은 연결해 둔다(보일 때 바로 쓰게) */
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'waiting';
    if (this.env.online()) this.connectNow();
  }

  /** 소켓이 열렸다 */
  opened(): void {
    if (this.state === 'stopped') return;
    this.state = 'open';
    this.attempt = 0;
    this.clearRetry();
    this.heard();
    this.lastTick = this.clock.now();
    this.scheduleWatch();
  }

  /** 서버 메시지를 받았다 (무엇이든) */
  heard(): void {
    this.deadline = this.clock.now() + RECV_TIMEOUT_MS;
  }

  /** 소켓이 닫혔다 (연결 실패 포함) */
  closed(): void {
    this.clearWatch();
    if (this.state === 'stopped') return;
    this.state = 'waiting';
    const immediate = this.immediate;
    this.immediate = false;
    if (!this.canConnect()) return;
    const ms = immediate ? 0 : reconnectDelay(this.attempt++);
    this.clearRetry();
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      if (this.state === 'waiting' && this.canConnect()) this.connectNow();
    }, ms);
  }

  /** 지금 소켓을 버리고 바로 새로 연결한다 (나가기 · 감시) */
  restart(): void {
    if (this.state === 'stopped') return;
    if (this.state === 'open' || this.state === 'connecting') {
      this.immediate = true;
      this.io.drop();
    } else this.kick();
  }

  /** 기다리던 재연결을 바로 (보이게 됨 · online · pageshow) */
  kick(): void {
    if (this.state !== 'waiting' || !this.canConnect()) return;
    this.connectNow();
  }

  /** 화면이 숨겨짐 · 보임 (visibilitychange) */
  visibility(visible: boolean): void {
    this.hidden = !visible;
    if (!visible) {
      // 기다리던 재연결은 멈춘다 (보이면 바로 다시)
      this.clearRetry();
      return;
    }
    if (this.state === 'open') {
      this.heard();
      this.lastTick = this.clock.now();
      this.io.resync();
    } else this.kick();
  }

  /** 오프라인이 됐다: 기다리던 재연결을 멈춘다 (열린 소켓은 그대로 — 조용해지면 감시가 버린다) */
  offline(): void {
    this.clearRetry();
  }

  /** 다시 연결하지 않는다 (다른 탭이 이 자리를 가져감) */
  stop(): void {
    this.state = 'stopped';
    this.clearRetry();
    this.clearWatch();
  }

  /** stop 뒤 다시 연결한다 ("여기서 계속하기") */
  resume(): void {
    if (this.state !== 'stopped') return;
    this.state = 'waiting';
    this.attempt = 0;
    if (this.canConnect()) this.connectNow();
  }

  private canConnect(): boolean {
    return this.env.visible() && this.env.online();
  }

  private connectNow(): void {
    this.clearRetry();
    this.state = 'connecting';
    this.connects += 1;
    this.io.connect();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearWatch(): void {
    if (this.watchTimer !== null) this.clock.clearTimeout(this.watchTimer);
    this.watchTimer = null;
  }

  private scheduleWatch(): void {
    this.clearWatch();
    this.watchTimer = this.clock.setTimeout(() => {
      this.watchTimer = null;
      this.watch();
    }, WATCH_TICK_MS);
  }

  private watch(): void {
    if (this.state !== 'open') return;
    const now = this.clock.now();
    const late = now - this.lastTick > WATCH_STALL_MS;
    this.lastTick = now;
    if (late && !this.hidden) {
      // 페이지가 멈췄다 돌아왔다: 받아 둔 메시지가 아직 처리되지 않았을 수 있다. 기한을 다시 잡고 확인 ping
      this.deadline = Math.max(this.deadline, now + RECV_TIMEOUT_MS);
      this.io.resync();
    } else if (!this.hidden && now > this.deadline) {
      this.watchdogDrops += 1;
      this.immediate = true;
      this.io.drop();
      return;
    }
    this.scheduleWatch();
  }
}

// ───────────── 마지막 방 복귀 (터치 · 설치 앱) ─────────────

export interface LastRoom {
  room: string;
  /** 저장한 시각 (Date.now, ms) */
  at: number;
}

export function encodeLastRoom(room: string, at: number): string {
  return JSON.stringify({ room, at });
}

/** 저장된 값이 LAST_ROOM_MS 안이면 그 방 (아니면 · 깨졌으면 null). now = Date.now */
export function freshLastRoom(raw: string | null, now: number): LastRoom | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { room, at } = v as Partial<LastRoom>;
    if (typeof room !== 'string' || !/^[A-Z]{4}$/.test(room) || typeof at !== 'number') return null;
    const age = now - at;
    return age >= 0 && age <= LAST_ROOM_MS ? { room, at } : null;
  } catch {
    return null;
  }
}

/**
 * 마지막 방 복귀 중 거절(옛 소켓이 아직 붙어 있어 in-progress · room-full)을 받았다: 다시 시도할 때까지 ms,
 * 다음 시도가 저장 시각 + LAST_ROOM_MS를 넘으면 null(그만둔다)
 */
export function rejoinRetryDelay(last: LastRoom, now: number): number | null {
  return now + REJOIN_RETRY_MS - last.at <= LAST_ROOM_MS ? REJOIN_RETRY_MS : null;
}

// ───────────── 화면 꺼짐 방지 (Wake Lock) ─────────────

/** navigator.wakeLock의 쓰는 부분 */
export interface WakeLockLike {
  request(type: 'screen'): Promise<{ released: boolean; release(): Promise<void> }>;
}

/**
 * 판 중 화면 꺼짐 방지 (MOBILE_PLAN M12 9번): 판 시작 때 요청, 결과 · 로비에서 해제, 판 중 다시 보이면 재요청
 * (브라우저는 숨겨질 때 스스로 풀어 버린다). 지원하지 않거나 거부되면 조용히 넘긴다(콘솔 0)
 */
export class ScreenAwake {
  private want = false;
  private pending = false;
  private sentinel: { released: boolean; release(): Promise<void> } | null = null;

  constructor(
    private readonly api: () => WakeLockLike | null,
    private readonly visible: () => boolean,
  ) {}

  /** 켜 두기를 원하는가 (판 중) */
  set(on: boolean): void {
    this.want = on;
    if (on) this.acquire();
    else this.release();
  }

  /** 다시 보이게 됐다: 판 중이면 다시 요청 */
  shown(): void {
    if (this.want) this.acquire();
  }

  private acquire(): void {
    if (this.pending || (this.sentinel && !this.sentinel.released) || !this.visible()) return;
    const api = this.api();
    if (!api) return;
    this.pending = true;
    let req: Promise<{ released: boolean; release(): Promise<void> }>;
    try {
      req = api.request('screen');
    } catch {
      this.pending = false;
      return;
    }
    req.then(
      (s) => {
        this.pending = false;
        this.sentinel = s;
        // 기다리는 사이 판이 끝났으면 바로 놓는다
        if (!this.want) this.release();
      },
      () => {
        this.pending = false;
      },
    );
  }

  private release(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) s.release().catch(() => undefined);
  }
}

/** 브라우저의 navigator.wakeLock (없으면 null) */
export function browserWakeLock(): WakeLockLike | null {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator ? navigator.wakeLock : null;
}

// ───────────── 뒤로 가기 (터치 · 설치 앱) ─────────────

/** 뒤로 가기를 막는 기록 항목 표시 */
const GUARD_STATE = { decoyGuard: 1 } as const;

/**
 * 판 중 뒤로 가기 확인 (MOBILE_PLAN M12 8번, 터치 · 설치 앱만). 크롬은 사용자 활성화 없이 넣은 기록 항목을 뒤로 가기에서
 * 건너뛰므로 판 안 첫 사용자 탭 핸들러(gesture)에서 넣는다. 뒤로 가기(popstate)로 그 항목이 빠지면 확인 창을 띄우고,
 * "계속"을 누를 때 그 핸들러에서 다시 넣는다. 판이 끝나면 남은 항목을 걷어 낸다(그 popstate는 무시)
 */
export class BackGuard {
  private armed = false;
  private pushed = false;
  private ignorePops = 0;

  constructor(
    private readonly history: Pick<History, 'pushState' | 'back'>,
    private readonly onBack: () => void,
  ) {}

  /** 기록 항목이 들어 있다 (시험 · 디버그) */
  get guarding(): boolean {
    return this.pushed;
  }

  /** 판 시작 (첫 사용자 탭을 기다린다) */
  arm(): void {
    this.armed = true;
  }

  /** 판이 끝났다: 넣어 둔 항목을 걷어 낸다 */
  disarm(): void {
    this.armed = false;
    if (!this.pushed) return;
    this.pushed = false;
    this.ignorePops += 1;
    this.history.back();
  }

  /** 사용자 활성화가 있는 핸들러 안 (판 안 탭 · "계속" 버튼) */
  gesture(): void {
    if (!this.armed || this.pushed) return;
    this.history.pushState(GUARD_STATE, '');
    this.pushed = true;
  }

  /** popstate: 내 항목이 빠졌으면 확인 창을 띄우고 true. 아니면 false (브라우저 동작 그대로) */
  popped(): boolean {
    if (this.ignorePops > 0) {
      this.ignorePops -= 1;
      return true;
    }
    if (!this.pushed) return false;
    this.pushed = false;
    if (this.armed) this.onBack();
    return true;
  }
}

// ───────────── 시험 훅 ─────────────

/** 생명주기 시험 훅 window.__DECOY_LIFE__ (?debug · 개발 서버에서만, M12 E2E): 연결 수 · 감시 · 뒤로 가기 항목 · 진동 직접 부르기 */
export interface LifecycleDebug {
  /** LinkKeeper 상태 (idle · connecting · open · waiting · stopped) */
  readonly link: string;
  /** 연결 시도 수 */
  readonly connects: number;
  /** 수신 감시로 버린 소켓 수 */
  readonly watchdogDrops: number;
  /** 뒤로 가기 기록 항목이 들어 있다 */
  readonly guarding: boolean;
  /** 터치 모드 또는 설치 앱 (마지막 방 · 뒤로 가기) */
  readonly lifeApp: boolean;
  /** 서버 시계를 믿을 수 있다 (숨김에서 돌아와 다시 맞추기 전이면 false) */
  readonly clockFresh: boolean;
  hapticHit(ageMs: number): void;
  hapticSpotted(on: boolean, ageMs: number): void;
  /** 실제로 부른 진동 패턴 */
  hapticLog(): number[][];
}

// ───────────── 브라우저 이벤트 ─────────────

export interface LifecycleHandlers {
  visibility(visible: boolean): void;
  online(on: boolean): void;
  /** pageshow (뒤로 · 앞으로 캐시에서 돌아옴 포함) */
  pageshow(): void;
  /** pagehide (탭을 닫거나 다른 곳으로 감) */
  pagehide(): void;
  /** 사용자 활성화가 있는 입력 (터치 · 펜 pointerup, click, keydown) — 캡처 단계 */
  gesture(e: Event): void;
  popstate(): void;
}

/** 사용자 활성화가 생기는 입력인가 (HTML 명세: keydown, 마우스 pointerdown, 마우스가 아닌 pointerup, click은 그 뒤) */
export function isActivationEvent(type: string, pointerType: string | undefined): boolean {
  if (type === 'keydown' || type === 'click') return true;
  if (type === 'pointerup') return pointerType !== undefined && pointerType !== 'mouse';
  return false;
}

/** 브라우저 이벤트를 듣는다 (부팅 때 한 번). 반환값을 부르면 그만 듣는다 */
export function listenLifecycle(
  h: LifecycleHandlers,
  win: Window = window,
  doc: Document = document,
): () => void {
  const offs: (() => void)[] = [];
  const on = (t: EventTarget, type: string, fn: (e: Event) => void, capture = false): void => {
    t.addEventListener(type, fn, { capture, passive: true });
    offs.push(() => t.removeEventListener(type, fn, { capture }));
  };
  on(doc, 'visibilitychange', () => h.visibility(doc.visibilityState === 'visible'));
  on(win, 'online', () => h.online(true));
  on(win, 'offline', () => h.online(false));
  on(win, 'pageshow', () => h.pageshow());
  on(win, 'pagehide', () => h.pagehide());
  on(win, 'popstate', () => h.popstate());
  for (const type of ['pointerup', 'click', 'keydown'])
    on(
      win,
      type,
      (e) => {
        if (isActivationEvent(e.type, (e as Partial<PointerEvent>).pointerType)) h.gesture(e);
      },
      true,
    );
  return () => {
    for (const off of offs) off();
  };
}
