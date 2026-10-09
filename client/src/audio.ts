// 최소 효과음 (BUILD_PLAN M8): 외부 음원 없이 WebAudio로 합성한다.
// 브라우저 자동 재생 규칙 때문에 AudioContext는 첫 사용자 입력(클릭 · 키 · 탭)에서 만든다.
// 터치 · 펜의 pointerdown은 사용자 활성화가 아니다(크롬이 경고를 낸다): 마우스는 pointerdown, 터치 · 펜은 pointerup에서 연다 (M11)

export type SfxName = 'windup' | 'hit' | 'captureStart' | 'captureDone' | 'doorOpen' | 'roar';

const MASTER_GAIN = 0.32;
/** 같은 소리가 너무 촘촘히 겹치지 않게 (ms) */
const MIN_GAP_MS = 60;

/**
 * 이 입력 이벤트에서 오디오를 열어도 되는가 (브라우저의 사용자 활성화 규칙): 키, 마우스 pointerdown,
 * 마우스가 아닌(터치 · 펜) pointerup
 */
export function unlocksAudio(type: string, pointerType: string | undefined): boolean {
  if (type === 'keydown') return true;
  if (type === 'pointerdown') return pointerType === 'mouse';
  if (type === 'pointerup') return pointerType !== undefined && pointerType !== 'mouse';
  return false;
}

/** 기본 AudioContext 만들기 (없는 환경이면 null) */
function newAudioContext(): AudioContext | null {
  const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
  return typeof Ctor === 'function' ? new Ctor() : null;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastAt = new Map<SfxName, number>();
  /** 디버그 · 테스트: 재생 요청 기록 (최근 50개) */
  readonly log: { name: SfxName; at: number }[] = [];
  muted = false;

  /** createContext: 테스트에서 바꿔 끼운다 */
  constructor(private readonly createContext: () => AudioContext | null = newAudioContext) {}

  /** 첫 사용자 입력에서 AudioContext를 만들거나 다시 켠다 (그 전의 재생 요청은 기록만 남는다) */
  attachUnlock(target: EventTarget): void {
    const unlock = (e: Event): void => {
      if (!unlocksAudio(e.type, (e as Partial<PointerEvent>).pointerType)) return;
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    };
    for (const type of ['pointerdown', 'pointerup', 'keydown'])
      target.addEventListener(type, unlock, { capture: true });
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private ensure(): void {
    if (this.ctx) return;
    try {
      const ctx = this.createContext();
      if (!ctx) return;
      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.6);
      const noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      // 고정 씨앗 의사 난수 (소리 모양을 매번 같게)
      let seed = 12345;
      for (let i = 0; i < len; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (seed / 0x7fffffff) * 2 - 1;
      }
      this.ctx = ctx;
      this.master = master;
      this.noise = noise;
    } catch {
      this.ctx = null;
    }
  }

  /** volume: 0~1 (남의 일은 작게) */
  play(name: SfxName, volume = 1): void {
    const now = performance.now();
    const last = this.lastAt.get(name) ?? -1e9;
    if (now - last < MIN_GAP_MS) return;
    this.lastAt.set(name, now);
    this.log.push({ name, at: now });
    if (this.log.length > 50) this.log.shift();
    if (this.muted) return;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running') return;
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume));
    out.connect(master);
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'windup':
        // 낮게 으르렁거리며 올라가는 톱니파 0.4초 (공격 준비 시간과 같다)
        this.tone(out, 'sawtooth', t, 0.4, 90, 210, 0.28, 900);
        this.tone(out, 'square', t, 0.4, 45, 105, 0.12, 400);
        break;
      case 'hit':
        // 짧은 타격: 잡음 + 낮은 쿵
        this.burst(out, t, 0.14, 0.6, 1800);
        this.tone(out, 'sine', t, 0.18, 140, 55, 0.7);
        break;
      case 'captureStart':
        // 경고 두 음
        this.tone(out, 'square', t, 0.12, 660, 660, 0.18, 2400);
        this.tone(out, 'square', t + 0.16, 0.16, 520, 520, 0.18, 2400);
        break;
      case 'captureDone':
        // 올라가는 세 음
        this.tone(out, 'triangle', t, 0.14, 523, 523, 0.35);
        this.tone(out, 'triangle', t + 0.12, 0.14, 659, 659, 0.35);
        this.tone(out, 'triangle', t + 0.24, 0.3, 784, 784, 0.35);
        break;
      case 'doorOpen':
        // 묵직하게 열리는 소리: 낮은 화음이 위로 미끄러짐 + 바람 잡음
        this.tone(out, 'sawtooth', t, 0.7, 110, 220, 0.18, 700);
        this.tone(out, 'sawtooth', t, 0.7, 165, 330, 0.12, 700);
        this.burst(out, t + 0.05, 0.6, 0.12, 500);
        break;
      case 'roar':
        // 포효: 떨리는 낮은 톱니파 + 거친 잡음
        this.tone(out, 'sawtooth', t, 0.85, 75, 55, 0.4, 600, 18);
        this.burst(out, t, 0.7, 0.3, 350);
        break;
      default:
        break;
    }
    window.setTimeout(() => out.disconnect(), 1500);
  }

  /** 주파수가 f0 → f1로 미끄러지는 음 하나 (선택: 저역 통과 · 떨림) */
  private tone(
    out: AudioNode,
    type: OscillatorType,
    t: number,
    dur: number,
    f0: number,
    f1: number,
    peak: number,
    lowpass?: number,
    vibratoHz?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f1, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.03, dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node.connect(f);
      node = f;
    }
    if (vibratoHz) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = vibratoHz;
      depth.gain.value = f0 * 0.08;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    node.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** 잡음 한 번 (저역 통과) */
  private burst(out: AudioNode, t: number, dur: number, peak: number, lowpass: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}

/** 앱 전체에서 하나 */
export const sfx = new Sfx();
