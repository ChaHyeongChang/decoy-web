// 입력 → 입력 프레임 (1/30초 고정 간격으로 샘플링). 키보드 · 마우스 소스와 터치 소스(touchInput.ts, 터치 모드에서만)를
// 합쳐 같은 InputFrame 하나를 만든다: 이동은 키보드가 있으면 키보드, 없으면 터치. held · pressed는 OR.
// 조준은 터치 모드 괴물이면 터치(정하지 않으면 마우스), 아니면 마우스. 서버는 어느 쪽에서 왔는지 모른다
import { BTN, type InputFrame, type InputLogEntry } from '@decoy/shared';
import type { TouchFrameCtx, TouchSource } from './touchInput';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const BUTTON_KEYS: Record<string, number> = {
  KeyE: BTN.RESCUE,
  Space: BTN.ABILITY,
  ShiftLeft: BTN.DASH,
  ShiftRight: BTN.DASH,
  KeyQ: BTN.ROAR,
};

/** 관전 고르기 (수감 · 사망 · 탈출 중 동료 화면 보기): 숫자 키 → 팀 카드 번호 (0부터, 카드 순서) */
export const SPECTATE_KEYS: Readonly<Record<string, number>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
};

/** 창 단위 이벤트를 받는 곳 (브라우저에서는 window · document · screen.orientation. 단위 테스트는 가짜 EventTarget) */
export interface InputEnv {
  /** keydown · keyup · pointerup · blur · orientationchange (터치 모드: pointerdown · pointermove 캡처) */
  win: EventTarget;
  /** visibilitychange */
  doc: EventTarget & { readonly visibilityState: DocumentVisibilityState };
  /** screen.orientation change (없으면 null) */
  orientation: EventTarget | null;
}

export interface AttachOptions {
  /** 터치 모드의 터치 소스. 없으면 PC 모드(키보드 · 마우스만) */
  touch?: TouchSource | null;
  /** 터치가 조준을 정하는가 (괴물). 생존자는 aim을 보내지 않는다(NaN) */
  touchAim?: boolean;
  /**
   * Phaser가 마우스 움직임을 받는 요소(캔버스). 주면 그 위 움직임만 PC 조준 준비로 센다 — 캔버스 둘레 레터박스 · 필러박스 위
   * 움직임은 Phaser 포인터를 옮기지 않아, 세면 로비에서 누른 자리를 향한 조준이 다시 나왔다 (출시 전 검토의 수정 검토).
   * 누르기는 어디서든 센다(창 단위 mousedown이 포인터를 그 자리로 옮긴다)
   */
  aimSurface?: EventTarget;
  env?: InputEnv;
}

function browserEnv(): InputEnv {
  return { win: window, doc: document, orientation: screen.orientation ?? null };
}

/** 이벤트 하나를 붙이고 떼는 함수를 돌려준다 (이벤트 종류는 type이 정한다) */
function listen<E extends Event>(
  target: EventTarget,
  type: string,
  fn: (e: E) => void,
  capture = false,
): () => void {
  const h = fn as (e: Event) => void;
  target.addEventListener(type, h, capture);
  return () => target.removeEventListener(type, h, capture);
}

export class InputSampler {
  private keys = new Set<string>();
  private held = 0;
  private pressed = 0;
  /** 마우스 버튼으로 누르고 있는 비트 (좌클릭 ATTACK · 우클릭 MODE) */
  private mouse = 0;
  private touch: TouchSource | null = null;
  private touchAim = false;
  /** 터치 모드에서 실제 마우스를 쓴 적이 있다 (그때만 마우스 커서로 조준한다) */
  private mouseSeen = false;
  /** PC 모드: 이 판(attach 뒤)에서 캔버스 위 마우스 · 펜 포인터가 움직이거나 누른 적이 있다 (그 전 포인터 자리는 로비의 것) */
  private canvasPointerSeen = false;
  /** Tab 누르고 있기 (점수판) */
  tabHeld = false;
  /** 아무 키나 눌림 (안내 오버레이 닫기용) */
  anyKeyPressed = false;
  /** 숫자 키로 고른 팀 카드 번호 (관전, 판 장면이 takeSpectatePick으로 꺼낸다). 입력 프레임에는 넣지 않는다 */
  private spectatePick: number | null = null;
  /** 판 중 메뉴(설정 화면)가 열려 있어 입력을 받지 않는다 (suspend) */
  private suspended = false;
  /**
   * 지금 실제로 누르고 있는 키 (판 중 메뉴가 열려 있어도 따라간다 — 닫을 때 이동 키를 이어받는다). 창 캡처 단계에서 받아 설정 화면이
   * 전파를 멈춘 키도 놓치지 않는다. 창 이탈 · 숨김이면 비운다
   */
  private readonly physical = new Set<string>();
  private readonly cleanup: Array<() => void> = [];

  /**
   * 판 중 메뉴(설정 화면)가 열려 있는 동안 (설정 화면 통합): 키 · 마우스 · 터치를 받지 않고(기본 동작도 막지 않는다 — 설정 화면의
   * Tab 이동 · 글자 입력), 누르고 있던 키 · 버튼 · 손가락은 모두 뗀 것으로 한다. 판은 멈추지 않으므로 입력 프레임은 계속 나가되
   * 이동 0 · 버튼 0이다. 다시 켜면(닫힘) 그 순간 실제로 누르고 있는 **이동 키만** 이어받는다(다시 누르지 않아도 걷는다). 버튼 키 ·
   * 마우스는 이어받지 않고 누른 신호(pressed)도 만들지 않는다 — 닫으려고 누른 Esc · 닫기 클릭이 공격 · 능력으로 새지 않는다.
   * 터치 이동 스틱은 터치 화면이 이어받는다(touchControls)
   */
  suspend(on: boolean): void {
    if (on === this.suspended) return;
    this.suspended = on;
    this.reset();
    if (on) return;
    for (const code of this.physical) if (MOVE_KEYS[code]) this.keys.add(code);
    this.recomputeHeld();
  }

  /** 입력을 멈췄는가 (디버그 · 시험) */
  get isSuspended(): boolean {
    return this.suspended;
  }

  /** 지금 입력 방식: 터치 소스가 붙어 있으면 'touch' */
  get mode(): 'keyboard' | 'touch' {
    return this.touch ? 'touch' : 'keyboard';
  }

  /** 숫자 키로 고른 팀 카드 번호를 꺼낸다 (없으면 null) */
  takeSpectatePick(): number | null {
    const p = this.spectatePick;
    this.spectatePick = null;
    return p;
  }

  /** 터치 모드에서 마우스 커서 조준을 쓸 수 있는가 (PC 모드는 늘 참) */
  get mouseAimUsable(): boolean {
    return !this.touch || this.mouseSeen;
  }

  /**
   * 마우스 커서 조준을 지금 쓸 수 있는가: 터치 모드는 실제 마우스를 쓴 뒤(mouseAimUsable), PC 모드는 이 판에서 캔버스 위
   * 마우스 · 펜이 움직이거나 누른 뒤. 그 전에는 포인터 자리가 로비에서 누른 버튼 자리라 판 시작 조준이 엉뚱한 곳을 향했다 (검토 반영)
   */
  get aimPointerReady(): boolean {
    return this.touch ? this.mouseSeen : this.canvasPointerSeen;
  }

  attach(canvasHost: EventTarget, opts: AttachOptions = {}): void {
    const env = opts.env ?? browserEnv();
    this.touch = opts.touch ?? null;
    this.touchAim = opts.touchAim ?? false;
    this.mouseSeen = false;
    this.canvasPointerSeen = false;
    const touchMode = this.touch !== null;
    const aimSurface = opts.aimSurface ?? null;
    /**
     * 캔버스 클릭을 공격 · 시야 전환으로 쓰는 포인터: 터치 모드는 마우스만(손가락은 터치 화면이 받는다),
     * PC 모드는 손가락만 뺀다(터치스크린 노트북에서 손바닥 · 손가락이 닿아 공격이 나가지 않게. 펜은 마우스처럼)
     */
    const clicks = (e: PointerEvent): boolean =>
      touchMode ? e.pointerType === 'mouse' : e.pointerType !== 'touch';

    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e) || this.suspended) return;
      // 떼어 둔 키의 자동 반복(판 중 메뉴 · 창 전환 전부터 누르고 있던 키)은 새로 누른 것으로 보지 않는다 — 다시 눌러야 받는다
      const stale = e.repeat && (e.code === 'Tab' ? !this.tabHeld : !this.keys.has(e.code));
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!stale) this.tabHeld = true;
        return;
      }
      if (stale) {
        if (MOVE_KEYS[e.code] || BUTTON_KEYS[e.code] !== undefined) e.preventDefault();
        return;
      }
      this.anyKeyPressed = true;
      const pick = SPECTATE_KEYS[e.code];
      if (pick !== undefined && !e.repeat) this.spectatePick = pick;
      if (MOVE_KEYS[e.code] || BUTTON_KEYS[e.code] !== undefined) e.preventDefault();
      // 키 자동 반복은 pressed를 다시 켜지 않는다 (이미 누르고 있는 키)
      if (!this.keys.has(e.code)) {
        const bit = BUTTON_KEYS[e.code];
        if (bit !== undefined) this.pressed |= bit;
      }
      this.keys.add(e.code);
      this.recomputeHeld();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (this.suspended) return;
      if (e.code === 'Tab') {
        this.tabHeld = false;
        e.preventDefault();
        return;
      }
      this.keys.delete(e.code);
      this.recomputeHeld();
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (this.suspended) return;
      if (e.pointerType !== 'touch') this.canvasPointerSeen = true;
      if (clicks(e)) {
        if (e.button === 0) {
          this.pressed |= BTN.ATTACK;
          this.mouse |= BTN.ATTACK;
        } else if (e.button === 2) {
          this.pressed |= BTN.MODE;
          this.mouse |= BTN.MODE;
        }
      }
      this.anyKeyPressed = true;
      this.recomputeHeld();
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (!clicks(e)) return;
      if (e.button === 0) this.mouse &= ~BTN.ATTACK;
      else if (e.button === 2) this.mouse &= ~BTN.MODE;
      this.recomputeHeld();
    };
    /** 캔버스 위 마우스 · 펜 움직임 (PC 조준을 쓸 수 있게 됨). 손가락과 캔버스 밖(레터박스) 움직임은 세지 않는다 */
    const onCanvasMove = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;
      if (aimSurface !== null && e.target !== aimSurface) return;
      this.canvasPointerSeen = true;
    };
    const onContext = (e: Event): void => e.preventDefault();
    const onBlur = (): void => {
      this.physical.clear();
      this.reset();
    };
    const onVisibility = (): void => {
      if (env.doc.visibilityState !== 'hidden') return;
      this.physical.clear();
      this.reset();
    };
    /** 실제 키 상태 (캡처 단계 — 메뉴가 열려 있어도, 설정 화면이 전파를 멈춰도) */
    const onPhysical = (e: KeyboardEvent): void => {
      if (e.type === 'keydown') this.physical.add(e.code);
      else this.physical.delete(e.code);
    };
    this.cleanup.push(
      listen(env.win, 'keydown', onPhysical, true),
      listen(env.win, 'keyup', onPhysical, true),
      listen(env.win, 'keydown', onKeyDown),
      listen(env.win, 'keyup', onKeyUp),
      listen(canvasHost, 'pointerdown', onPointerDown),
      listen(canvasHost, 'pointermove', onCanvasMove),
      listen(env.win, 'pointerup', onPointerUp),
      listen(canvasHost, 'contextmenu', onContext),
      listen(env.win, 'blur', onBlur),
      listen(env.doc, 'visibilitychange', onVisibility),
    );
    if (touchMode) {
      // 화면 회전: 손가락 자리가 모두 바뀐다. 터치 상태만 비운다 (손가락 하나씩 사라지는 것은 터치 화면이 stickCancel로 넣는다)
      const onRotate = (): void => this.touch?.reset();
      // 터치 화면(캔버스 밖 DOM)에 닿아도 조작 안내를 닫는다. 터치 화면이 전파를 막아도 받게 캡처 단계에서
      const onAnyPointer = (e: PointerEvent): void => {
        if (this.suspended) return;
        if (e.pointerType === 'mouse') this.mouseSeen = true;
        else if (e.type === 'pointerdown') this.anyKeyPressed = true;
      };
      this.cleanup.push(
        listen(env.win, 'orientationchange', onRotate),
        listen(env.win, 'pointerdown', onAnyPointer, true),
        listen(env.win, 'pointermove', onAnyPointer, true),
      );
      if (env.orientation) this.cleanup.push(listen(env.orientation, 'change', onRotate));
    }
  }

  detach(): void {
    for (const f of this.cleanup.splice(0)) f();
    this.suspended = false;
    this.physical.clear();
    this.reset();
    this.touch = null;
    this.touchAim = false;
  }

  /** 탭 전환 · 창 이탈 때 모든 키 · 손가락을 뗀 것으로 */
  reset(): void {
    this.keys.clear();
    this.mouse = 0;
    this.held = 0;
    this.pressed = 0;
    this.tabHeld = false;
    this.spectatePick = null;
    this.touch?.reset();
  }

  private recomputeHeld(): void {
    let h = this.mouse;
    for (const k of this.keys) h |= BUTTON_KEYS[k] ?? 0;
    this.held = h;
  }

  /** 키보드 이동 (8방향, 길이 0 또는 1) */
  private keyboardMove(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      const v = MOVE_KEYS[k];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    x = Math.sign(x);
    y = Math.sign(y);
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  /** 이동: 키보드가 있으면 키보드, 없으면 터치 스틱 */
  moveVector(): { x: number; y: number } {
    const k = this.keyboardMove();
    if (k.x !== 0 || k.y !== 0 || !this.touch) return k;
    return this.touch.moveVector();
  }

  /**
   * 보내지 않을 동안 눌린 버튼은 버린다 (판 정지 · 세로 화면 중 누른 능력이 재개 순간 나가지 않게).
   * 누르고 있는 키는 둔다. 터치는 그동안 터치 화면이 꺼져 있으므로 손가락 · 발사 대기까지 모두 비운다
   */
  clearPressed(): void {
    this.pressed = 0;
    this.touch?.reset();
  }

  /**
   * 입력 프레임 하나를 만든다. pressed는 한 번 보내면 비운다.
   * mouseAim은 마우스 커서 조준(괴물, 생존자는 NaN), ctx는 터치 모드에서 발사 대기를 진행할 상황
   */
  sample(seq: number, mouseAim: number, ctx?: TouchFrameCtx): InputFrame {
    // 판 중 메뉴가 열려 있다: 이동 · 버튼 없이 (조준은 판 장면이 지금 방향을 넘긴다)
    if (this.suspended) {
      this.pressed = 0;
      return { seq, mx: 0, my: 0, aim: mouseAim, held: 0, pressed: 0 };
    }
    const m = this.moveVector();
    let held = this.held;
    let pressed = this.pressed;
    let aim = mouseAim;
    const touch = this.touch;
    if (touch && ctx) {
      // 순서: takePressed 먼저 (발사 대기에서 공격을 낸 프레임까지 aim = θ)
      const tp = touch.takePressed(ctx);
      // 터치로 새로 눌린 비트는 그 프레임 held에도 켠다: 키를 한 프레임 누른 것과 같은 값
      held |= touch.heldBits() | tp;
      pressed |= tp;
      if (this.touchAim) aim = touch.aimAngle(ctx) ?? mouseAim;
    }
    const frame: InputFrame = { seq, mx: m.x, my: m.y, aim, held, pressed };
    this.pressed = 0;
    return frame;
  }
}

/** 최근 입력 프레임 기록 (디버그 · E2E: pressed는 한 프레임만 살아 마지막 프레임만으로는 놓친다) */
export class InputLog {
  private readonly buf: InputLogEntry[] = [];
  private head = 0;

  constructor(readonly capacity = 120) {}

  push(frame: InputFrame, t: number, mode: 'keyboard' | 'touch'): void {
    const e: InputLogEntry = { ...frame, t, mode };
    if (this.buf.length < this.capacity) this.buf.push(e);
    else this.buf[this.head] = e;
    this.head = (this.head + 1) % this.capacity;
  }

  /** 오래된 것부터 */
  entries(): InputLogEntry[] {
    if (this.buf.length < this.capacity) return this.buf.slice();
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  clear(): void {
    this.buf.length = 0;
    this.head = 0;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  // DOM이 없는 단위 테스트에서도 돌게 (HTMLInputElement가 없으면 입력칸도 없다)
  if (typeof HTMLElement === 'undefined') return false;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
