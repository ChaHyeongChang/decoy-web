// 거점 게이지 부품 (플레이테스트 b — 거점 셋): hud.ts makeGauges가 만든 진짜 게이지(PC 막대 · 터치 줄)를 가짜 HUD 부품 키트로 돌려
// 실제로 건 프레임 · 자리를 본다.
//  - 괴물 화면에는 진행 숫자 그림을 걸지 않는다(PCT_FOR_MONSTER) — 받는 값과 무관하게, 나머지 그림은 생존자 화면과 같은 값
//  - 꺼진 거점(off): 회색 틀 · ⊘ 칩, 채움 · 숫자 없음
//  - PC 위 띠: 왼쪽부터 A · B · 타이머 · C, 괴물 화면은 막대가 칩 옆(빈 숫자 칸 없음), 막대 틀은 한 장(9조각 아님 — 일의 양)
//  - 터치 줄: 세로로 쌓인 줄은 기기 픽셀 정수 간격으로 맞닿고, 위 띠에 가로로 늘어놓은 줄은 같은 높이
// Phaser · 글자 객체는 흉내 낸다 (부품이 부르는 메서드만)
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PointView } from '../../shared/src/types';
import { GAUGE_ROW, HUD, applyLayout, layoutFor, pcLayout } from '../../client/src/ui/layout';
import type { HudKit } from '../../client/src/ui/hudKit';
import { hudSpecs } from '../../client/src/ui/hudArt';

vi.mock('phaser', () => ({ default: { Scenes: { Events: { SHUTDOWN: 'shutdown' } } } }));
vi.mock('../../client/src/ui/text', () => ({
  UI_FONT: 'test-font',
  makeText: (): never => {
    throw new Error('이 시험은 진짜 글자 객체를 만들지 않는다');
  },
}));

const { makeGauges } = await import('../../client/src/ui/hud');

afterEach(() => applyLayout(pcLayout()));

/** 가짜 그림 (hudKit Spr와 같은 규칙: 빈 이름이면 숨김, show(true)는 이름이 있을 때만) */
class FakeSpr {
  name = '';
  x = 0;
  y = 0;
  on = false;
  cut: [number, number] | null = null;
  /** 지금까지 건 프레임 이름 모두 */
  readonly history: string[] = [];
  readonly img = { setAlpha: (): void => {} };
  set(name: string, x: number, y: number): this {
    this.name = name;
    this.x = x;
    this.y = y;
    this.on = name !== '';
    this.cut = null;
    if (name !== '') this.history.push(name);
    return this;
  }
  crop(a: number, b: number): this {
    this.cut = [a, b];
    return this;
  }
  show(on: boolean): this {
    this.on = on && this.name !== '';
    return this;
  }
  get shown(): boolean {
    return this.on;
  }
  get frameName(): string {
    return this.name;
  }
}

/** 가짜 9조각 */
class FakeSlice {
  name = '';
  box: [number, number, number, number] = [0, 0, 0, 0];
  set(name: string, x: number, y: number, w: number, h: number): this {
    this.name = name;
    this.box = [x, y, w, h];
    return this;
  }
  setAlpha(): this {
    return this;
  }
}

/** 가짜 글자 (거점 글자 — 체인 메서드만) */
const fakeText = (): Record<string, () => unknown> => {
  const t: Record<string, () => unknown> = {};
  for (const k of ['setOrigin', 'setText', 'setAlpha', 'setPosition', 'setVisible']) t[k] = () => t;
  return t;
};

/** 가짜 HUD 부품 키트: 만든 그림 · 패널을 부품 이름별로 모은다 */
function fakeKit(dev = 1) {
  const sprs: { tag: string; s: FakeSpr }[] = [];
  const slices: { tag: string; s: FakeSlice }[] = [];
  const kit = {
    tag: '',
    zoom: dev,
    dev,
    named<T>(tag: string, fn: () => T): T {
      const prev = kit.tag;
      kit.tag = tag;
      try {
        return fn();
      } finally {
        kit.tag = prev;
      }
    },
    spr(): FakeSpr {
      const s = new FakeSpr();
      sprs.push({ tag: kit.tag, s });
      return s;
    },
    slice(): FakeSlice {
      const s = new FakeSlice();
      slices.push({ tag: kit.tag, s });
      return s;
    },
    text: fakeText,
  };
  // 시험용 가짜: hud.ts 게이지가 부르는 메서드 · 값만 가진다 (HudKit는 Phaser 장면 · 아틀라스가 있어야 만들어진다)
  return { kit: kit as unknown as HudKit, sprs, slices };
}

const POINTS: readonly (readonly PointView[])[] = [
  [
    { id: 'A', progress: 0, state: 'idle' },
    { id: 'B', progress: 0.37, state: 'idle' },
    { id: 'C', progress: 0.12, state: 'capturing' },
  ],
  [
    { id: 'A', progress: 0.63, state: 'blocked' },
    { id: 'B', progress: 1, state: 'done' },
    { id: 'C', progress: 0.5, state: 'capturing' },
  ],
  // 둘째 완료 틱: 남은 한 곳(A)은 진행이 멈춘 그대로 꺼진다
  [
    { id: 'C', progress: 1, state: 'done' },
    { id: 'A', progress: 0.63, state: 'off' },
    { id: 'B', progress: 1, state: 'done' },
  ],
];

/** 화면 하나: 게이지를 만들고 스냅샷 거점 목록을 차례로 그린다 (Hud.drawTop과 같이 id로 찾는다) */
function run(touch: boolean, monster: boolean, dev = 1) {
  if (touch) applyLayout(layoutFor(750, 369, true, { sysSlots: 3, team: monster ? 'monster' : 'survivor' }));
  const plan = HUD.touch ? (monster ? HUD.touch.monster : HUD.touch.survivor) : null;
  const f = fakeKit(dev);
  const gauges = makeGauges(f.kit, monster, plan);
  const frames: string[][] = [];
  for (const points of POINTS) {
    for (const g of gauges) {
      const p = points.find((q) => q.id === g.id);
      g.update(p, monster && p?.state === 'capturing');
      g.animate(false);
    }
    // 그 스냅샷에서 보이는 그림 (부품 이름 · 프레임 · 자르기 폭)
    frames.push([
      ...f.sprs
        .filter((x) => x.s.shown)
        .map((x) => `${x.tag} ${x.s.name}${x.s.cut ? ` ${(x.s.cut[1] - x.s.cut[0]).toFixed(3)}` : ''}`),
      ...f.slices.map((x) => `${x.tag} ${x.s.name} ${x.s.box[2]}`),
    ]);
  }
  return { gauges, frames, ...f };
}

describe('거점 게이지 부품 (makeGauges)', () => {
  it('괴물 화면에는 진행 숫자 그림을 한 번도 걸지 않는다 — 생존자 화면은 같은 값에서 숫자를 건다 (PC · 터치)', () => {
    for (const touch of [false, true]) {
      const mon = run(touch, true);
      const surv = run(touch, false);
      const pctOf = (r: ReturnType<typeof run>): string[] =>
        r.sprs.flatMap((x) => x.s.history).filter((n) => n.startsWith('pct:'));
      expect(pctOf(mon), `${touch} 괴물`).toEqual([]);
      for (const g of mon.gauges) expect([g.pct.value, g.pct.frame]).toEqual([null, '']);
      expect(pctOf(surv).length, `${touch} 생존자`).toBeGreaterThan(0);
      // 숫자를 빼면 두 화면이 건 그림 · 채움 폭이 같다 (받는 사람과 무관하게 같은 world.points 값만 그린다)
      const noPct = (fs: string[][]): string[][] => fs.map((f) => f.filter((n) => !/ pct:/.test(n)).sort());
      expect(noPct(mon.frames), `${touch} 괴물 = 생존자`).toEqual(noPct(surv.frames));
    }
  });

  it('꺼진 거점: 회색 틀 · ⊘ 칩, 진행이 멈춘 그대로 와도 채움 · 진행 숫자 없음 (PC · 터치, 생존자 화면)', () => {
    for (const touch of [false, true]) {
      const r = run(touch, false);
      const a = r.gauges.find((g) => g.id === 'A')!;
      expect(a.state).toBe('off');
      expect(a.chip.frameName).toBe(touch ? 'gicon:off' : 'chip:off');
      expect(a.pct.value).toBeNull();
      const last = r.frames.at(-1)!;
      const ofA = last.filter((n) => n.startsWith('gaugeA '));
      // 틀 · 칩 · 배지 · 글자는 있고, 채움 · 숫자는 없다
      expect(ofA.some((n) => n.includes(touch ? 'grow:off' : 'gbar:off'))).toBe(true);
      if (!touch) expect(ofA.some((n) => n.includes('dia:off'))).toBe(true);
      expect(ofA.filter((n) => /fill|pct:/.test(n))).toEqual([]);
      // 같은 스냅샷의 완료 거점은 채움 · 100%가 있다 (꺼짐만 숨긴다)
      const ofB = last.filter((n) => n.startsWith('gaugeB '));
      expect(ofB.some((n) => /fill/.test(n))).toBe(true);
      expect(ofB.some((n) => n.includes('pct:text:100'))).toBe(true);
    }
  });

  it('PC 위 띠: 왼쪽부터 A · B · 타이머 · C, 배지 · 칩 · 막대가 겹치지 않고 1490 앞, 괴물 화면은 막대가 칩 옆으로 (빈 숫자 칸 없음)', () => {
    const G = HUD.gauge;
    const bars = hudSpecs().filter((x) => x.name.startsWith('gbar:'));
    expect(bars.length).toBe(5);
    for (const b of bars)
      expect(b.kind === 'frame' && [b.x0, b.y0, b.x1, b.y1]).toEqual([0, 0, G.barW, G.barH]);
    const timerL = HUD.timer.x - HUD.timer.w / 2;
    const timerR = HUD.timer.x + HUD.timer.w / 2;
    for (const monster of [false, true]) {
      const r = run(false, monster);
      // 막대 틀은 9조각이 아니라 한 장 (폭이 늘 barW — 판 중 그리는 그림 3 → 1, 일의 양 예산)
      expect(r.slices).toEqual([]);
      const bars = r.sprs
        .filter((x) => x.s.name.startsWith('gbar:'))
        .map((x) => ({ tag: x.tag, x: x.s.x, w: G.barW }));
      expect(bars.map((b) => b.tag)).toEqual(['gaugeA', 'gaugeB', 'gaugeC']);
      const [a, b, c] = bars;
      expect(a!.x + a!.w).toBeLessThan(HUD.gaugeB.x);
      expect(b!.x + b!.w).toBeLessThan(timerL);
      expect(timerR).toBeLessThan(HUD.gaugeC.x - G.w);
      expect(HUD.gaugeC.x).toBeLessThan(1490);
      // 칩 가운데 (A · B는 배지 오른쪽, C는 배지 왼쪽)
      const chips = r.gauges.map((g) => (g.chip as unknown as FakeSpr).x);
      expect(chips).toEqual([
        HUD.gaugeA.x + G.dia + G.gap + G.chip / 2,
        HUD.gaugeB.x + G.dia + G.gap + G.chip / 2,
        HUD.gaugeC.x - G.dia - G.gap - G.chip / 2,
      ]);
      // 막대 안쪽 끝: 생존자 = 칩 · 숫자 칸 다음, 괴물 = 칩 바로 다음 (숫자 칸 폭만큼 당김)
      const cell = G.dia + G.gap + G.chip + G.pctGap;
      const pull = monster ? 0 : G.pctW + G.pctGap;
      expect(a!.x).toBe(HUD.gaugeA.x + cell + pull);
      expect(b!.x).toBe(HUD.gaugeB.x + cell + pull);
      expect(c!.x + c!.w).toBe(HUD.gaugeC.x - cell - pull);
    }
  });

  it('터치 줄: 세로로 쌓인 줄은 기기 픽셀 정수 간격으로 맞닿고(배율 1 · 1.5 · 2.625), 위 띠에 늘어놓은 줄(태블릿)은 같은 높이 · 틈', () => {
    for (const dev of [1, 1.5, 2.625]) {
      const r = run(true, false, dev);
      const plates = r.sprs.filter((x) => x.s.name.startsWith('grow:')).map((x) => x.s);
      expect(plates.length).toBe(3);
      const step = Math.round(HUD.touch!.survivor.gauges[0]!.h * dev);
      for (let i = 1; i < 3; i += 1) {
        expect(plates[i]!.x).toBe(plates[0]!.x);
        expect(Math.round((plates[i]!.y - plates[i - 1]!.y) * dev)).toBe(step);
        expect(Number.isInteger(Math.round(plates[i]!.y * dev * 1e6) / 1e6)).toBe(true);
      }
    }
    // 태블릿 4:3 위 띠: 가로 한 줄 (같은 y, 왼쪽부터 A · B · C)
    applyLayout(layoutFor(1024, 768, true, { sysSlots: 3, team: 'survivor' }));
    const plan = HUD.touch!.survivor;
    const f = fakeKit(2);
    const gauges = makeGauges(f.kit, false, plan);
    for (const g of gauges) g.update({ id: g.id as 'A', progress: 0.5, state: 'idle' }, false);
    const plates = f.sprs.filter((x) => x.s.name.startsWith('grow:')).map((x) => x.s);
    expect(new Set(plates.map((p) => p.y)).size).toBe(1);
    expect(plates[0]!.x).toBeLessThan(plates[1]!.x);
    expect(plates[1]!.x).toBeLessThan(plates[2]!.x);
    expect(GAUGE_ROW.inset).toBeGreaterThan(0);
  });
});
