// 키보드 · 마우스 → 입력 프레임 (1/30초 고정 간격으로 샘플링)
import { BTN, type InputFrame } from '@decoy/shared';

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

export class InputSampler {
  private keys = new Set<string>();
  private held = 0;
  private pressed = 0;
  /** Tab 누르고 있기 (점수판) */
  tabHeld = false;
  /** 아무 키나 눌림 (안내 오버레이 닫기용) */
  anyKeyPressed = false;
  private readonly cleanup: Array<() => void> = [];

  attach(canvasHost: HTMLElement): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e)) return;
      if (e.code === 'Tab') {
        this.tabHeld = true;
        e.preventDefault();
        return;
      }
      this.anyKeyPressed = true;
      if (MOVE_KEYS[e.code] || BUTTON_KEYS[e.code] !== undefined) e.preventDefault();
      if (!this.keys.has(e.code)) {
        const bit = BUTTON_KEYS[e.code];
        if (bit !== undefined) this.pressed |= bit;
      }
      this.keys.add(e.code);
      this.recomputeHeld();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Tab') {
        this.tabHeld = false;
        e.preventDefault();
        return;
      }
      this.keys.delete(e.code);
      this.recomputeHeld();
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button === 0) {
        this.pressed |= BTN.ATTACK;
        this.mouse |= BTN.ATTACK;
      } else if (e.button === 2) {
        this.pressed |= BTN.MODE;
        this.mouse |= BTN.MODE;
      }
      this.anyKeyPressed = true;
      this.recomputeHeld();
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (e.button === 0) this.mouse &= ~BTN.ATTACK;
      else if (e.button === 2) this.mouse &= ~BTN.MODE;
      this.recomputeHeld();
    };
    const onContext = (e: Event): void => e.preventDefault();
    const onBlur = (): void => this.reset();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') this.reset();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvasHost.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvasHost.addEventListener('contextmenu', onContext);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanup.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => canvasHost.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => canvasHost.removeEventListener('contextmenu', onContext),
      () => window.removeEventListener('blur', onBlur),
      () => document.removeEventListener('visibilitychange', onVisibility),
    );
  }

  private mouse = 0;

  detach(): void {
    for (const f of this.cleanup.splice(0)) f();
    this.reset();
  }

  /** 탭 전환 · 창 이탈 때 모든 키를 뗀 것으로 */
  reset(): void {
    this.keys.clear();
    this.mouse = 0;
    this.held = 0;
    this.pressed = 0;
    this.tabHeld = false;
  }

  private recomputeHeld(): void {
    let h = this.mouse;
    for (const k of this.keys) h |= BUTTON_KEYS[k] ?? 0;
    this.held = h;
  }

  moveVector(): { x: number; y: number } {
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

  /** 입력 프레임 하나를 만든다. pressed는 한 번 보내면 비운다 */
  sample(seq: number, aim: number): InputFrame {
    const m = this.moveVector();
    const frame: InputFrame = { seq, mx: m.x, my: m.y, aim, held: this.held, pressed: this.pressed };
    this.pressed = 0;
    return frame;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
