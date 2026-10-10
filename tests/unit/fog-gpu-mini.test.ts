// GPU 안개의 미니맵 합성 (M12 검토 #14): commit은 기록만 하고, 합성은 miniSource를 읽을 때 한 번만 한다.
// 터치 배치에서 미니맵을 숨기면(읽지 않으면) 안개 주기마다 돌던 미니맵 캔버스 합성(정적 맵 · 채움 재생 · 빛 곱하기 ·
// 테두리 리프트)이 없다. 읽으면 마지막 commit 그림과 같다. GpuFog는 Phaser 객체 · DOM 캔버스를 쓰므로 Phaser · 정적 맵 ·
// 캔버스를 가짜로 바꿔, 캔버스마다 받은 그리기 호출(그때의 합성 방식 포함)을 기록해 본다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILE_PX, type Vec2 } from '@decoy/shared';

interface Call {
  fn: string;
  /** 호출 때의 globalCompositeOperation */
  op: string;
  args: unknown[];
}

/** 그리기 호출을 기록하는 가짜 캔버스 (getContext는 모든 메서드를 받아 적는 프록시) */
class FakeCanvas {
  width = 1;
  height = 1;
  readonly calls: Call[] = [];
  private readonly ctx: unknown;

  constructor() {
    const state: Record<string, unknown> = { canvas: this, globalCompositeOperation: 'source-over' };
    const calls = this.calls;
    const stack: unknown[] = [];
    this.ctx = new Proxy(state, {
      get: (t, k) => {
        if (typeof k !== 'string') return undefined;
        if (k in t) return t[k];
        return (...args: unknown[]) => {
          calls.push({ fn: k, op: String(t.globalCompositeOperation), args });
          // 합성 방식만 save · restore로 쌓는다
          if (k === 'save') stack.push(t.globalCompositeOperation);
          if (k === 'restore') t.globalCompositeOperation = stack.pop();
          return k === 'createRadialGradient' ? { addColorStop: () => undefined } : undefined;
        };
      },
      set: (t, k, v) => {
        t[String(k)] = v;
        return true;
      },
    });
  }

  getContext(): unknown {
    return this.ctx;
  }
}

const h = vi.hoisted(() => ({
  canvases: [] as { calls: { fn: string; op: string; args: unknown[] }[] }[],
  statics: [] as { scale: number; canvas: unknown }[],
}));

vi.mock('phaser', () => {
  class Base {}
  return {
    default: {
      Renderer: { WebGL: { Pipelines: { SinglePipeline: Base }, WebGLRenderer: Base } },
      BlendModes: { ADD: 1, MULTIPLY: 2, SKIP_CHECK: -1 },
    },
  };
});

// 정적 맵 · 발광은 배율만 기억한 빈 캔버스 (굽는 그림은 이 시험과 무관)
vi.mock('../../client/src/art/mapArt', () => ({
  GLOW_SCALE: 1,
  getStaticMap: (scale: number): unknown => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 40;
    h.statics.push({ scale, canvas });
    return canvas;
  },
  getGlowMap: (): unknown => document.createElement('canvas'),
  keepStaticMaps: () => undefined,
}));

/** 어떤 메서드를 불러도 자신을 돌려주는 가짜 Phaser 객체 (extra의 값은 그대로) */
function chain(extra: Record<string, unknown> = {}): unknown {
  const p: unknown = new Proxy(extra, {
    get: (t, k) => (typeof k !== 'string' ? undefined : k in t ? t[k] : () => p),
  });
  return p;
}

const LPT = 12;

async function makeFog() {
  h.canvases.length = 0;
  h.statics.length = 0;
  vi.stubGlobal('document', {
    createElement: () => {
      const c = new FakeCanvas();
      h.canvases.push(c);
      return c;
    },
  });
  vi.stubGlobal(
    'Path2D',
    class {
      rect(): void {}
      moveTo(): void {}
      lineTo(): void {}
      closePath(): void {}
    },
  );
  const { GpuFog } = await import('../../client/src/render/fogGpu');
  const scene = chain({ make: chain(), textures: chain(), game: { renderer: {} } });
  const fog = new GpuFog(scene as never, chain({ list: [] }) as never, {
    fog: true,
    compositeScale: 1,
    lightPxPerTile: LPT,
    zoom: 1,
    ambientCss: '#101010',
    shader: false,
    glow: 'static',
  });
  const miniStatic = h.statics.find((s) => s.scale === LPT / TILE_PX)?.canvas;
  expect(miniStatic).toBeDefined();
  /** 미니맵 합성 횟수 (미니맵 정적 맵을 그린 횟수) */
  const composites = (): number =>
    h.canvases.flatMap((c) => c.calls).filter((c) => c.fn === 'drawImage' && c.args[0] === miniStatic).length;
  /** 미니맵 캔버스의 마지막 합성 호출 */
  const lastComposite = (): Call[] => {
    const mini = h.canvases.find((c) =>
      c.calls.some((k) => k.fn === 'drawImage' && k.args[0] === miniStatic),
    );
    const calls = mini?.calls ?? [];
    const at = calls.map((k) => k.fn === 'drawImage' && k.args[0] === miniStatic).lastIndexOf(true);
    return calls.slice(at);
  };
  /** 안개 주기 한 번: 다각형 하나를 채우고 빛으로 연다 */
  const cycle = (poly: Vec2[], commit = true): void => {
    fog.begin();
    fog.fillPoly(poly, 0xff0000, 0.5);
    fog.addHardLight(poly);
    if (commit) fog.commit();
  };
  return { fog, composites, lastComposite, cycle };
}

const tri = (x: number, y: number): Vec2[] => [
  { x, y },
  { x: x + 4, y },
  { x, y: y + 3 },
];

/** 합성에서 다각형 채움이 시작한 자리 (빛 지도 px) */
const firstMove = (calls: Call[]): unknown[] | undefined => calls.find((c) => c.fn === 'moveTo')?.args;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GPU 안개 미니맵 합성 (읽을 때만)', () => {
  it('commit은 미니맵을 합성하지 않는다: 읽지 않으면(숨긴 미니맵) 안개 주기를 여러 번 돌아도 0번, 캔버스도 만들지 않는다', async () => {
    const { fog, composites, cycle } = await makeFog();
    cycle(tri(9, 10));
    // 시야 채움 조각 캔버스는 첫 주기에 생긴다. 그 뒤로는 미니맵 캔버스만 셈에 남는다
    const made = h.canvases.length;
    for (let i = 0; i < 5; i += 1) {
      cycle(tri(10 + i, 10));
      expect(fog.changed).toBe(true);
    }
    expect(composites()).toBe(0);
    expect(h.canvases.length).toBe(made);
    // 처음 읽으면 그때 만들고 한 번 합성한다
    expect(fog.miniSource).toBeDefined();
    expect(composites()).toBe(1);
    expect(h.canvases.length).toBe(made + 1);
  });

  it('읽으면 마지막 commit 그림을 한 번만 합성한다: 정적 맵 → 채움 → 빛 곱하기 → 테두리 리프트', async () => {
    const { fog, composites, lastComposite, cycle } = await makeFog();
    cycle(tri(10, 10));
    const a = fog.miniSource;
    expect(composites()).toBe(1);
    const calls = lastComposite();
    expect(calls.map((c) => `${c.fn}@${c.op}`)).toEqual([
      'drawImage@source-over',
      'beginPath@source-over',
      'moveTo@source-over',
      'lineTo@source-over',
      'lineTo@source-over',
      'closePath@source-over',
      'fill@source-over',
      'save@source-over',
      'drawImage@multiply',
      'restore@multiply',
      'save@source-over',
      'fill@lighter',
      'restore@lighter',
    ]);
    expect(firstMove(calls)).toEqual([10 * LPT, 10 * LPT]);
    // 다시 읽어도 · 그림이 그대로인 주기 뒤에 읽어도 다시 합성하지 않는다 (같은 캔버스)
    expect(fog.miniSource).toBe(a);
    cycle(tri(10, 10));
    expect(fog.changed).toBe(false);
    expect(fog.miniSource).toBe(a);
    expect(composites()).toBe(1);
  });

  it('읽기 전에 여러 번 바뀌면 마지막 commit 그림으로 한 번만 합성한다', async () => {
    const { fog, composites, lastComposite, cycle } = await makeFog();
    cycle(tri(10, 10));
    expect(fog.miniSource).toBeDefined();
    cycle(tri(20, 10));
    cycle(tri(30, 12));
    expect(composites()).toBe(1);
    expect(fog.miniSource).toBeDefined();
    expect(composites()).toBe(2);
    expect(firstMove(lastComposite())).toEqual([30 * LPT, 12 * LPT]);
  });

  it('다음 주기를 기록하는 중(begin ~ commit 사이)에 읽어도 마지막 commit 그림이다', async () => {
    const { fog, lastComposite, cycle } = await makeFog();
    cycle(tri(10, 10));
    cycle(tri(40, 20), false);
    expect(fog.miniSource).toBeDefined();
    expect(firstMove(lastComposite())).toEqual([10 * LPT, 10 * LPT]);
  });
});
