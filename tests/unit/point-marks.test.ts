// 거점 표시 — 미니맵 · 화면 밖 화살표 글자 (플레이테스트 반영 b — 거점 A · B · C 세 곳, 꺼진 거점).
// 미니맵 표시는 거점 id로 찾아 제 자리에 그린다. 예전에는 거점이 둘이라 'A가 아니면 두 번째 표시'로 골라, C가 오면 B 표시를
// C 자리 · C 상태로 덮었다(B 상태가 미니맵에서 틀림). 화면 밖 화살표의 거점 글자도 A · B 둘만 만들어 C 화살표에 글자가 없었다.
// Minimap · EdgeMarkers는 Phaser 객체 · DOM 캔버스를 쓰므로 장면 · HUD 부품 · 캔버스를 가짜로 바꿔, 그림(프레임 · 자리 · 글자)을 본다.
//  - 미니맵 표시는 POINT_IDS 순서로 셋, 스냅샷 배열 순서와 무관하게 id의 자리 · 상태
//  - 꺼진 거점 = 'point:off' 그림(회색 빈 마름모 + 사선): 대기와 다른 프레임이고 HUD 아틀라스에 있다
//  - 괴물 화면 미니맵도 같은 세계 상태면 같은 그림 (꺼짐은 받는 사람과 무관한 공개 정보)
//  - 화면 밖 거점 화살표마다 그 거점 글자(A · B · C)가 화살표 자리에 하나씩, 화살표가 없는 거점 글자는 숨긴다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_POINTS, MAP_H, MAP_W, POINT_IDS, type ExitView, type PointView } from '@decoy/shared';
import type { EdgeMarker } from '../../client/src/render/offscreen';
import { FR, hudSpecs } from '../../client/src/ui/hudArt';
import { HUD } from '../../client/src/ui/layout';

vi.mock('phaser', () => ({ default: { Scenes: { Events: { SHUTDOWN: 'shutdown' } } } }));
// 글자는 가짜 HUD 부품(fakeKit text)이 만든다: 글자 모듈(Phaser Text를 이어받는 CrispText)은 불러오지 않는다
vi.mock('../../client/src/ui/text', () => ({
  UI_FONT: 'test-font',
  makeText: (): never => {
    throw new Error('이 시험은 글자 객체를 만들지 않는다');
  },
}));

/** 어떤 메서드를 불러도 자신을 돌려주는 가짜 Phaser 객체 */
function chain(extra: Record<string, unknown> = {}): unknown {
  const p: unknown = new Proxy(extra, {
    get: (t, k) => (typeof k !== 'string' ? undefined : k in t ? t[k] : () => p),
  });
  return p;
}

/** 가짜 HUD 그림 (hudKit Spr): 마지막으로 놓은 프레임 · 자리 */
interface FakeSpr {
  frame: string;
  x: number;
  y: number;
  on: boolean;
  img: unknown;
  set(f: string, x: number, y: number): FakeSpr;
  show(on: boolean): FakeSpr;
}

let sprs: FakeSpr[] = [];

function fakeKit(): unknown {
  const spr = (): FakeSpr => {
    const s: FakeSpr = {
      frame: '',
      x: NaN,
      y: NaN,
      on: false,
      img: chain({ visible: false, scaleX: 1, alpha: 1 }),
      set(f, x, y) {
        s.frame = f;
        s.x = x;
        s.y = y;
        s.on = f !== '';
        return s;
      },
      show(on) {
        s.on = on;
        return s;
      },
    };
    sprs.push(s);
    return s;
  };
  const text = (): FakeText => {
    const t: FakeText = {
      text: '',
      x: NaN,
      y: NaN,
      visible: true,
      setOrigin: () => t,
      setDepth: () => t,
      setName: () => t,
      setColor: () => t,
      setText: (v) => {
        t.text = v;
        return t;
      },
      setPosition: (x, y) => {
        t.x = x;
        t.y = y;
        return t;
      },
      setAlpha: () => t,
      setVisible: (v) => {
        t.visible = v;
        return t;
      },
    };
    texts.push(t);
    return t;
  };
  return {
    dev: 1,
    tag: '',
    named: <T>(_tag: string, fn: () => T): T => fn(),
    spr,
    slice: () => chain(),
    text,
  };
}

/** 가짜 글자 (CrispText 중 쓰는 부분) */
interface FakeText {
  text: string;
  x: number;
  y: number;
  visible: boolean;
  setOrigin(): FakeText;
  setDepth(): FakeText;
  setName(): FakeText;
  setColor(): FakeText;
  setText(v: string): FakeText;
  setPosition(x: number, y: number): FakeText;
  setAlpha(): FakeText;
  setVisible(v: boolean): FakeText;
}

let texts: FakeText[] = [];

const EXITS_OFF: ExitView[] = [
  { id: 'N', state: 'inactive', progress: null },
  { id: 'S', state: 'inactive', progress: null },
];

/** 미니맵 그림 자리 (논리 px): 판 배치(PC)의 미니맵 왼쪽 위 · 폭 */
function at(x: number, y: number): [number, number] {
  const M = HUD.minimap;
  const h = Math.round((M.w * MAP_H) / MAP_W);
  return [M.x + (x / MAP_W) * M.w, M.y + (y / MAP_H) * h];
}

/** 거점 표시 (프레임이 'm:point'로 시작하는 그림) */
const pointSprs = (): FakeSpr[] => sprs.filter((s) => s.frame.startsWith(FR.mm('point')));

async function makeMinimap(monster = false) {
  const { Minimap } = await import('../../client/src/ui/minimap');
  const scene = chain({ textures: chain(), add: chain(), events: chain() });
  return new Minimap(scene as never, fakeKit() as never, monster);
}

beforeEach(() => {
  sprs = [];
  texts = [];
  vi.stubGlobal('document', {
    createElement: () => ({ width: 1, height: 1, getContext: () => chain() }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('미니맵 거점 표시 (거점 세 곳 · 꺼짐)', () => {
  it('표시는 거점마다 하나(POINT_IDS 순서)이고 처음에는 각자 자리의 대기 그림이다', async () => {
    await makeMinimap();
    const marks = pointSprs();
    expect(marks).toHaveLength(POINT_IDS.length);
    expect(marks.map((s) => [s.x, s.y])).toEqual(
      POINT_IDS.map((id) => at(CAPTURE_POINTS[id].x, CAPTURE_POINTS[id].y)),
    );
    for (const s of marks) expect(s.frame).toBe(FR.mm('point'));
  });

  it('C는 C 자리에 C 상태로 그리고, B 표시를 덮지 않는다 (스냅샷 배열 순서와 무관)', async () => {
    const mm = await makeMinimap();
    const world: PointView[] = [
      { id: 'A', progress: 0.1, state: 'idle' },
      { id: 'B', progress: 0.5, state: 'blocked' },
      { id: 'C', progress: 0.3, state: 'capturing' },
    ];
    for (const order of [world, [world[2]!, world[0]!, world[1]!], [world[1]!, world[2]!, world[0]!]]) {
      mm.setWorld(order, EXITS_OFF, null, null, false);
      const marks = pointSprs();
      expect(marks).toHaveLength(3);
      const byPlace = (id: 'A' | 'B' | 'C'): FakeSpr | undefined => {
        const [x, y] = at(CAPTURE_POINTS[id].x, CAPTURE_POINTS[id].y);
        return marks.find((s) => s.x === x && s.y === y);
      };
      expect(byPlace('A')?.frame).toBe(FR.mm('point'));
      expect(byPlace('B')?.frame).toBe(FR.mm('point:blocked'));
      expect(byPlace('C')?.frame).toBe(FR.mm('point:capturing'));
    }
    // 점령 중 깜빡임 꺼진 위상: C만 대기 그림, B 정지는 그대로
    mm.setWorld(world, EXITS_OFF, null, null, true);
    const [, b, c] = pointSprs();
    expect(b?.frame).toBe(FR.mm('point:blocked'));
    expect(c?.frame).toBe(FR.mm('point'));
  });

  it('꺼진 거점은 회색 빈 마름모 + 사선(point:off) — 대기와 다른 그림이고 HUD 아틀라스에 있다, 깜빡이지 않는다', async () => {
    const mm = await makeMinimap();
    for (const offId of POINT_IDS) {
      const world: PointView[] = POINT_IDS.map((id) => ({
        id,
        progress: id === offId ? 0.4 : 1,
        state: id === offId ? 'off' : 'done',
      }));
      for (const blinkOff of [false, true]) {
        mm.setWorld(world, EXITS_OFF, null, null, blinkOff);
        const marks = pointSprs();
        POINT_IDS.forEach((id, i) =>
          expect(marks[i]?.frame, `${offId} 꺼짐: ${id}`).toBe(
            FR.mm(id === offId ? 'point:off' : 'point:done'),
          ),
        );
      }
    }
    expect(FR.mm('point:off')).not.toBe(FR.mm('point'));
    // 상태마다 쓰는 그림이 모두 HUD 아틀라스에 있다 (없으면 조용히 숨겨진다)
    const names = new Set(hudSpecs().map((s) => s.name));
    const states: PointView['state'][] = ['idle', 'capturing', 'blocked', 'done', 'off'];
    for (const state of states) {
      mm.setWorld(
        POINT_IDS.map((id) => ({ id, progress: 0.5, state })),
        EXITS_OFF,
        null,
        null,
        false,
      );
      for (const s of pointSprs()) expect(names.has(s.frame), `${state}: ${s.frame}`).toBe(true);
    }
    const off = hudSpecs().find((s) => s.name === FR.mm('point:off'));
    const idle = hudSpecs().find((s) => s.name === FR.mm('point'));
    expect(off?.kind).toBe('frame');
    expect(idle?.kind).toBe('frame');
  });

  it('꺼진 거점 그림(point:off)의 사선은 마름모 안에서 끝난다 — 두 끝이 마름모 변 위(맵 배지 · 게이지 ⊘처럼 테두리에서 멈춤), 밖으로 삐져나오지 않는다', () => {
    const spec = hudSpecs().find((s) => s.name === FR.mm('point:off'));
    if (spec?.kind !== 'frame') throw new Error('point:off 그림 없음');
    // 기록 펜 (경로 부분만): moveTo마다 새 조각
    const subs: { x: number; y: number }[][] = [];
    let lineWidth = 0;
    const pen = {
      set lineWidth(w: number) {
        lineWidth = w;
      },
      strokeStyle: '',
      beginPath: (): void => undefined,
      closePath: (): void => undefined,
      moveTo: (x: number, y: number): void => {
        subs.push([{ x, y }]);
      },
      lineTo: (x: number, y: number): void => {
        subs[subs.length - 1]?.push({ x, y });
      },
      stroke: (): void => undefined,
    };
    spec.paint(pen as unknown as CanvasRenderingContext2D, 1);
    expect(subs).toHaveLength(2);
    const [outline, slash] = subs as [{ x: number; y: number }[], { x: number; y: number }[]];
    // 테두리: 꼭짓점이 축 위에 있는 마름모 |x| + |y| = R
    const taxi = (p: { x: number; y: number }): number => Math.abs(p.x) + Math.abs(p.y);
    expect(outline).toHaveLength(4);
    const R = Math.max(...outline.map(taxi));
    for (const p of outline) {
      expect(taxi(p)).toBeCloseTo(R, 9);
      expect(p.x === 0 || p.y === 0).toBe(true);
    }
    // 사선: 가운데를 지나는 왼위 → 오른아래 대각선, 두 끝이 마름모 안(변 위)
    expect(slash).toHaveLength(2);
    for (const p of slash) {
      expect(taxi(p), `사선 끝 (${p.x}, ${p.y})가 마름모 |x| + |y| ≤ ${R} 밖`).toBeLessThanOrEqual(R + 1e-9);
      expect(taxi(p)).toBeCloseTo(R, 9);
      expect(p.x).toBeCloseTo(p.y, 9);
    }
    expect(slash[0]!.x).toBeLessThan(0);
    expect(slash[1]!.x).toBeGreaterThan(0);
    // 선 굵기까지 그림 칸 안
    expect(R + lineWidth / 2).toBeLessThanOrEqual(spec.x1);
  });

  it('괴물 화면 미니맵도 같은 세계 상태면 같은 거점 그림 · 자리다 (꺼짐 · 점령 상태는 받는 사람과 무관한 공개 정보)', async () => {
    const world: PointView[] = [
      { id: 'A', progress: 1, state: 'done' },
      { id: 'B', progress: 0.62, state: 'capturing' },
      { id: 'C', progress: 0.2, state: 'off' },
    ];
    const surv = await makeMinimap(false);
    surv.setWorld(world, EXITS_OFF, null, null, false);
    const a = pointSprs().map((s) => s.frame);
    sprs = [];
    const mon = await makeMinimap(true);
    mon.setWorld(world, EXITS_OFF, null, null, false);
    expect(pointSprs().map((s) => s.frame)).toEqual(a);
    expect(a).toEqual([FR.mm('point:done'), FR.mm('point:capturing'), FR.mm('point:off')]);
  });
});

describe('화면 밖 거점 화살표 글자 (EdgeMarkers)', () => {
  const NO_PULSE = { t: 0, alpha: 0 };
  const marker = (id: 'A' | 'B' | 'C', x: number, y: number): EdgeMarker => ({
    kind: 'point',
    id,
    tx: CAPTURE_POINTS[id].x,
    ty: CAPTURE_POINTS[id].y,
    prio: 7,
    role: null,
    state: 'idle',
    scale: 1,
    x,
    y,
    dir: 0,
    faded: false,
  });

  it('거점 화살표마다 그 거점 글자를 화살표 자리에 (C 포함), 화살표가 없는 거점 글자는 숨긴다 — 글자는 만들 때 한 번만', async () => {
    const { EdgeMarkers } = await import('../../client/src/ui/edgeMarkers');
    const em = new EdgeMarkers(fakeKit() as never);
    // 거점마다 글자 하나를 미리 만들어 둔다 (프레임마다 글자를 만들거나 바꿔 쓰지 않는다)
    expect(texts.map((t) => t.text)).toEqual([...POINT_IDS]);
    const label = (id: string): FakeText | undefined => texts.find((t) => t.text === id);
    const shown = (): string[] => texts.filter((t) => t.visible).map((t) => t.text);
    expect(shown()).toEqual([]);
    em.update([marker('A', 100, 50), marker('C', 300, 60)], false, 0, NO_PULSE);
    expect(shown()).toEqual(['A', 'C']);
    expect([label('C')?.x, label('C')?.y]).toEqual([300, 60 + 0.5 * HUD.s]);
    expect([label('A')?.x, label('A')?.y]).toEqual([100, 50 + 0.5 * HUD.s]);
    em.update([marker('C', 320, 70), marker('B', 10, 20)], false, 0, NO_PULSE);
    expect(shown()).toEqual(['B', 'C']);
    expect([label('C')?.x, label('C')?.y]).toEqual([320, 70 + 0.5 * HUD.s]);
    em.update([], false, 0, NO_PULSE);
    expect(shown()).toEqual([]);
    em.update([marker('C', 1, 2)], true, 0, NO_PULSE);
    expect(shown()).toEqual(['C']);
    em.hide();
    expect(shown()).toEqual([]);
    expect(texts).toHaveLength(POINT_IDS.length);
  });
});
