// 소리 묶음 (설정 화면 통합, 설정 '소리' 탭): 전체 이득(MASTER_GAIN × 전체 음량) 아래 효과음 묶음 · UI 묶음. 판 효과음(play)은 효과음
// 묶음, UI 소리(ui)는 UI 묶음으로 간다. setLevels는 AudioContext를 만들기 전에도 받고(만들 때 건다), 만든 뒤에는 바로 건다
// (setTargetAtTime). 음소거 = 모두 0이고 그동안 소리 노드를 만들지 않는다. 기본값은 예전 소리 그대로(전체 0.32 · 묶음 1)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVEL_TAU_S, Sfx, busGains } from '../../client/src/audio';
import { PREF_DEFAULTS, audioLevelsOf } from '../../client/src/prefs';

/** 이득 노드 · 소리 노드 하나 (연결 · 이득 · 예약 기록) */
class FakeNode {
  readonly out: FakeNode[] = [];
  readonly targets: { v: number; t: number; tau: number }[] = [];
  readonly gain: {
    value: number;
    setTargetAtTime: (v: number, t: number, tau: number) => void;
    setValueAtTime: () => void;
    exponentialRampToValueAtTime: () => void;
    linearRampToValueAtTime: () => void;
  };
  readonly frequency = {
    value: 0,
    setValueAtTime: (): void => undefined,
    linearRampToValueAtTime: (): void => undefined,
  };
  type = '';
  buffer: unknown = null;
  constructor(
    readonly kind: string,
    readonly ctx: FakeCtx,
  ) {
    const targets = this.targets;
    this.gain = {
      value: 1,
      setTargetAtTime: (v, t, tau) => {
        targets.push({ v, t, tau });
      },
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
    };
  }
  connect(n: FakeNode): FakeNode {
    this.out.push(n);
    return n;
  }
  disconnect(): void {
    this.out.length = 0;
  }
  start(): void {
    this.ctx.started.push(this);
  }
  stop(): void {
    return undefined;
  }
}

class FakeCtx {
  state: 'running' | 'suspended' = 'running';
  sampleRate = 8000;
  currentTime = 1.25;
  readonly destination = new FakeNode('destination', this);
  readonly gains: FakeNode[] = [];
  readonly started: FakeNode[] = [];
  createGain(): FakeNode {
    const g = new FakeNode('gain', this);
    this.gains.push(g);
    return g;
  }
  createOscillator(): FakeNode {
    return new FakeNode('osc', this);
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode('filter', this);
  }
  createBufferSource(): FakeNode {
    return new FakeNode('buffer', this);
  }
  createBuffer(_c: number, len: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

function setup(): { sfx: Sfx; ctx: () => FakeCtx | null; unlock: () => void } {
  let made: FakeCtx | null = null;
  const sfx = new Sfx(() => {
    made = new FakeCtx();
    return made as unknown as AudioContext;
  });
  const target = new EventTarget();
  sfx.attachUnlock(target);
  return { sfx, ctx: () => made, unlock: () => target.dispatchEvent(new Event('keydown')) };
}

/** 묶음 노드: [전체, 효과음, UI] (ensure가 만든 순서) */
function buses(ctx: FakeCtx): [FakeNode, FakeNode, FakeNode] {
  const [m, s, u] = ctx.gains;
  if (!m || !s || !u) throw new Error('묶음 노드 없음');
  return [m, s, u];
}

/** 노드에서 출력 쪽으로 따라가 닿는 묶음 (효과음 · UI) */
function reaches(n: FakeNode, target: FakeNode): boolean {
  if (n === target) return true;
  return n.out.some((o) => reaches(o, target));
}

let now = 0;
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', { setTimeout: () => 0 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('소리 묶음 이득', () => {
  it('busGains: 전체 = 0.32 × 전체 음량, 묶음 = 그 음량, 0~1로 자른다', () => {
    expect(busGains({ master: 1, sfx: 1, ui: 1 })).toEqual({ master: 0.32, sfx: 1, ui: 1 });
    expect(busGains({ master: 0.5, sfx: 0.25, ui: 2 })).toEqual({ master: 0.16, sfx: 0.25, ui: 1 });
    expect(busGains({ master: -1, sfx: Number.NaN, ui: 0 })).toEqual({ master: 0, sfx: 1, ui: 0 });
  });

  it('기본(설정 전): 전체 → 출력, 효과음 · UI 묶음 → 전체, 예전과 같은 0.32 · 1', () => {
    const { ctx, unlock } = setup();
    unlock();
    const c = ctx()!;
    const [m, s, u] = buses(c);
    expect(m.gain.value).toBeCloseTo(0.32, 9);
    expect(s.gain.value).toBe(1);
    expect(u.gain.value).toBe(1);
    expect(m.out).toEqual([c.destination]);
    expect(s.out).toEqual([m]);
    expect(u.out).toEqual([m]);
  });

  it('AudioContext를 만들기 전에 받은 음량은 만들 때 건다', () => {
    const { sfx, ctx, unlock } = setup();
    sfx.setLevels(audioLevelsOf({ ...PREF_DEFAULTS, volMaster: 50, volSfx: 80, volUi: 40 }));
    expect(ctx()).toBeNull();
    unlock();
    const [m, s, u] = buses(ctx()!);
    expect(m.gain.value).toBeCloseTo(0.16, 9);
    expect(s.gain.value).toBeCloseTo(0.8, 9);
    expect(u.gain.value).toBeCloseTo(0.4, 9);
  });

  it('만든 뒤에는 바로 건다 (지금 시각부터 LEVEL_TAU_S로 따라감)', () => {
    const { sfx, ctx, unlock } = setup();
    unlock();
    const c = ctx()!;
    const [m, s, u] = buses(c);
    sfx.setLevels({ master: 0.25, sfx: 0.5, ui: 0.75 });
    expect(m.targets.at(-1)).toEqual({ v: 0.08, t: c.currentTime, tau: LEVEL_TAU_S });
    expect(s.targets.at(-1)).toEqual({ v: 0.5, t: c.currentTime, tau: LEVEL_TAU_S });
    expect(u.targets.at(-1)).toEqual({ v: 0.75, t: c.currentTime, tau: LEVEL_TAU_S });
    expect(LEVEL_TAU_S).toBeLessThanOrEqual(0.03);
  });

  it('효과음은 효과음 묶음으로, UI 소리는 UI 묶음으로 간다', () => {
    const { sfx, ctx, unlock } = setup();
    unlock();
    const c = ctx()!;
    const [, s, u] = buses(c);
    sfx.play('hit');
    const fx = c.gains.slice(3);
    expect(fx.length).toBeGreaterThan(0);
    const out = fx[0]!;
    expect(out.out).toEqual([s]);
    expect(c.started.every((n) => !reaches(n, u))).toBe(true);
    const before = c.gains.length;
    sfx.ui('tap');
    const uiOut = c.gains[before]!;
    expect(uiOut.out).toEqual([u]);
    expect(reaches(uiOut, s)).toBe(false);
    expect(sfx.uiLog.map((e) => e.name)).toEqual(['tap']);
    // 판 효과음 기록(getSounds)과 섞이지 않는다
    expect(sfx.log.map((e) => e.name)).toEqual(['hit']);
  });

  it('UI 소리 네 가지 모두 짧은 합성음 (소리 노드 시작), 같은 소리는 60ms 안에 한 번', () => {
    const { sfx, ctx, unlock } = setup();
    unlock();
    const c = ctx()!;
    for (const name of ['tap', 'toggle', 'open', 'close'] as const) {
      const n = c.started.length;
      sfx.ui(name);
      expect(c.started.length, name).toBeGreaterThan(n);
    }
    const n = c.started.length;
    now += 30;
    sfx.ui('open');
    expect(c.started.length).toBe(n);
    now += 40;
    sfx.ui('open');
    expect(c.started.length).toBeGreaterThan(n);
  });

  it('음소거 = 모두 0: 이득 0, 재생 요청은 기록만 하고 소리 노드를 만들지 않는다. 풀면 다시', () => {
    const { sfx, ctx, unlock } = setup();
    unlock();
    const c = ctx()!;
    const [m, s, u] = buses(c);
    sfx.setLevels(audioLevelsOf({ ...PREF_DEFAULTS, muted: true }));
    expect(sfx.muted).toBe(true);
    expect([m.targets.at(-1)?.v, s.targets.at(-1)?.v, u.targets.at(-1)?.v]).toEqual([0, 0, 0]);
    const g = c.gains.length;
    sfx.play('roar');
    sfx.ui('toggle');
    expect(c.gains.length).toBe(g);
    expect(c.started.length).toBe(0);
    expect(sfx.log.map((e) => e.name)).toEqual(['roar']);
    sfx.setLevels(audioLevelsOf(PREF_DEFAULTS));
    expect(sfx.muted).toBe(false);
    expect(m.targets.at(-1)?.v).toBeCloseTo(0.32, 9);
    expect(u.targets.at(-1)?.v).toBeCloseTo(0.6, 9);
    now += 100;
    sfx.play('roar');
    expect(c.started.length).toBeGreaterThan(0);
  });

  it('효과음 묶음만 0이면 판 효과음은 노드를 만들지 않고 UI 소리는 난다', () => {
    const { sfx, ctx, unlock } = setup();
    unlock();
    const c = ctx()!;
    sfx.setLevels({ master: 1, sfx: 0, ui: 1 });
    sfx.play('hit');
    expect(c.started.length).toBe(0);
    sfx.ui('tap');
    expect(c.started.length).toBeGreaterThan(0);
  });

  it('오디오가 열리기 전(첫 입력 전) UI 소리는 기록만 남는다', () => {
    const { sfx, ctx } = setup();
    sfx.ui('open');
    expect(ctx()).toBeNull();
    expect(sfx.uiLog.map((e) => e.name)).toEqual(['open']);
  });
});
