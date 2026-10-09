// 효과음 열기 (M11, MOBILE_PLAN M11 9번): 마우스는 pointerdown, 터치 · 펜은 pointerup, 키는 keydown에서 AudioContext를 만든다.
// 터치 pointerdown은 브라우저의 사용자 활성화가 아니라 그때 만들면 크롬이 경고하고 소리가 막힌다
import { describe, expect, it } from 'vitest';
import { Sfx, unlocksAudio } from '../../client/src/audio';

/** 효과음이 쓰는 만큼만 흉내 낸 AudioContext */
function fakeContext(): AudioContext {
  const node = { connect: (): void => undefined, gain: { value: 1 } };
  const ctx = {
    state: 'running',
    sampleRate: 8000,
    destination: {},
    createGain: () => node,
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve(),
  };
  return ctx as unknown as AudioContext;
}

function pointer(type: string, pointerType: string): Event {
  return Object.assign(new Event(type), { pointerType });
}

function setup(): { sfx: Sfx; target: EventTarget; made: () => number } {
  let n = 0;
  const sfx = new Sfx(() => {
    n += 1;
    return fakeContext();
  });
  const target = new EventTarget();
  sfx.attachUnlock(target);
  return { sfx, target, made: () => n };
}

describe('오디오 열기 규칙 unlocksAudio', () => {
  it('키 · 마우스 pointerdown · 터치와 펜의 pointerup만', () => {
    expect(unlocksAudio('keydown', undefined)).toBe(true);
    expect(unlocksAudio('pointerdown', 'mouse')).toBe(true);
    expect(unlocksAudio('pointerdown', 'touch')).toBe(false);
    expect(unlocksAudio('pointerdown', 'pen')).toBe(false);
    expect(unlocksAudio('pointerup', 'touch')).toBe(true);
    expect(unlocksAudio('pointerup', 'pen')).toBe(true);
    expect(unlocksAudio('pointerup', 'mouse')).toBe(false);
    expect(unlocksAudio('pointermove', 'touch')).toBe(false);
  });
});

describe('Sfx.attachUnlock', () => {
  it('터치 pointerdown에서는 AudioContext를 만들지 않고, 손을 뗄 때(pointerup) 만든다', () => {
    const { sfx, target, made } = setup();
    target.dispatchEvent(pointer('pointerdown', 'touch'));
    expect(made()).toBe(0);
    expect(sfx.ready).toBe(false);
    target.dispatchEvent(pointer('pointerup', 'touch'));
    expect(made()).toBe(1);
    expect(sfx.ready).toBe(true);
    // 한 번 만들면 다시 만들지 않는다
    target.dispatchEvent(pointer('pointerup', 'touch'));
    expect(made()).toBe(1);
  });

  it('마우스는 누르는 순간(pointerdown), 키는 keydown에서 만든다 (PC 그대로)', () => {
    const a = setup();
    a.target.dispatchEvent(pointer('pointerdown', 'mouse'));
    expect(a.made()).toBe(1);
    const b = setup();
    b.target.dispatchEvent(new Event('keydown'));
    expect(b.made()).toBe(1);
    const c = setup();
    c.target.dispatchEvent(pointer('pointerup', 'mouse'));
    expect(c.made()).toBe(0);
  });
});
