// M12 휴대폰 성능: 그림 결과를 바꾸지 않는 계산 줄이기
//  - 빛 속 먼지: 우선값 순서로 재다 멈춰도 '시야 안 칸을 모두 재서 우선값 순 count개'와 같다 (옛 구현과 대조)
//  - 시야 다각형 캐시: 입력이 같으면 같은 다각형(같은 참조), 다르면 새로 계산한 것과 같다
//  - 빛 지도 기록: 같은 빛이면 다시 칠하지 않고, 다르면 바로 칠하던 때와 같은 명령을 같은 순서로 칠한다
import { describe, expect, it } from 'vitest';
import { Rng, pointInPolygon, survivorVisionPolygon, type Vec2 } from '@decoy/shared';
import { DUST, dustMotes, type DustEye, type DustMote } from '../../client/src/art/fx';
import { PolyCache } from '../../client/src/render/fogMath';
import {
  LightMap,
  LightRecord,
  PenRecord,
  samePoly,
  type LightCtx,
  type LightSurface,
  type SoftLight,
} from '../../client/src/render/fogPaint';

/** M12 전 구현 그대로 (fx.ts hash2와 같은 해시) */
function hash2(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function dustMotesBefore(tS: number, eyes: readonly DustEye[], count: number): DustMote[] {
  if (count <= 0 || eyes.length === 0) return [];
  const cell = DUST.cell;
  const seen = new Set<number>();
  const cand: { pri: number; m: DustMote }[] = [];
  for (const e of eyes) {
    const i0 = Math.floor((e.center.x - e.radius) / cell);
    const i1 = Math.floor((e.center.x + e.radius) / cell);
    const j0 = Math.floor((e.center.y - e.radius) / cell);
    const j1 = Math.floor((e.center.y + e.radius) / cell);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const key = j * 4096 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        const period = DUST.periodMinS + hash2(i, j, 3) * (DUST.periodMaxS - DUST.periodMinS);
        const ph = (tS / period + hash2(i, j, 4)) % 1;
        const wob = tS * 0.21 + hash2(i, j, 5) * 6.28;
        const x = (i + 0.2 + 0.6 * hash2(i, j, 1)) * cell + Math.sin(wob) * DUST.drift;
        const y = (j + 0.2 + 0.6 * hash2(i, j, 2)) * cell + Math.cos(wob * 0.8) * DUST.drift - ph * 0.3;
        const p = { x, y };
        let inside = false;
        for (const q of eyes) {
          if (Math.hypot(x - q.center.x, y - q.center.y) > q.radius) continue;
          if (pointInPolygon(p, q.poly)) {
            inside = true;
            break;
          }
        }
        if (!inside) continue;
        const a = DUST.alpha * Math.sin(Math.PI * ph);
        cand.push({
          pri: hash2(i, j, 7),
          m: { x, y, alpha: a, size: DUST.sizePx * (0.6 + 0.4 * hash2(i, j, 6)) },
        });
      }
    }
  }
  cand.sort((a, b) => a.pri - b.pri);
  return cand.slice(0, count).map((c) => c.m);
}

/** 맵 안 무작위 자리의 생존자 시야 (벽에 잘린 실제 다각형) */
function randomEyes(rng: Rng, n: number): DustEye[] {
  const eyes: DustEye[] = [];
  for (let k = 0; k < n; k += 1) {
    const center = { x: 2 + rng.next() * 44, y: 2 + rng.next() * 28 };
    const r = 4 + rng.next() * 2;
    eyes.push({ poly: survivorVisionPolygon(center, r), center, radius: r - 1.2 });
  }
  return eyes;
}

describe('빛 속 먼지: 우선값 순서로 재다 멈춰도 결과가 같다', () => {
  it('무작위 시야 · 시각 · 개수 300가지에서 옛 구현과 같다', () => {
    const rng = new Rng(20261009);
    let motes = 0;
    for (let n = 0; n < 300; n += 1) {
      const eyes = randomEyes(rng, 1 + (n % 3));
      const t = rng.next() * 1000;
      const count = [1, 15, 40, 400][n % 4] ?? 15;
      const now = dustMotes(t, eyes, count);
      expect(now).toEqual(dustMotesBefore(t, eyes, count));
      motes += now.length;
    }
    // 빈 결과끼리만 견준 것이 아니다
    expect(motes).toBeGreaterThan(3000);
  });

  it('괴물 시야처럼 겹친 눈 둘(부채꼴 + 근접 원 자리)도 같다', () => {
    const center = { x: 24, y: 16 };
    const big = survivorVisionPolygon(center, 9);
    const near = survivorVisionPolygon(center, 2.5);
    const eyes: DustEye[] = [
      { poly: big, center, radius: 9 },
      { poly: near, center, radius: 2.5 },
    ];
    for (let t = 0; t < 30; t += 0.37) expect(dustMotes(t, eyes, 40)).toEqual(dustMotesBefore(t, eyes, 40));
  });
});

describe('시야 다각형 캐시', () => {
  it('입력이 같으면 같은 참조, 자리 · 모양이 바뀌면 새로 계산한 것', () => {
    const c = new PolyCache();
    const make = (x: number, y: number, r: number) => () => survivorVisionPolygon({ x, y }, r);
    const a = c.get('runner', 10, 10, 5, 0, make(10, 10, 5));
    expect(c.get('runner', 10, 10, 5, 0, make(10, 10, 5))).toBe(a);
    expect(c.misses).toBe(1);
    const b = c.get('runner', 10.25, 10, 5, 0, make(10.25, 10, 5));
    expect(b).not.toBe(a);
    expect(b).toEqual(survivorVisionPolygon({ x: 10.25, y: 10 }, 5));
    // 모양 값(반경)만 바뀌어도 새로
    const r = c.get('runner', 10.25, 10, 6, 0, make(10.25, 10, 6));
    expect(r).toEqual(survivorVisionPolygon({ x: 10.25, y: 10 }, 6));
    // 눈마다 따로
    const g = c.get('guard', 10.25, 10, 6, 0, make(10.25, 10, 6));
    expect(g).not.toBe(r);
    expect(c.misses).toBe(4);
    // 두 번째 모양 값(괴물 부채꼴 blend)
    const k1 = c.get('cone', 1, 2, 0.5, 0.25, () => [{ x: 0, y: 0 }]);
    expect(c.get('cone', 1, 2, 0.5, 0.25, () => [])).toBe(k1);
    expect(c.get('cone', 1, 2, 0.5, 0.3, () => [])).toEqual([]);
  });
});

/** 칠하기 명령을 문자열로 남기는 가짜 2D 컨텍스트 */
class LogCtx implements LightCtx {
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  readonly log: string[] = [];
  private grads = 0;
  save(): void {
    this.log.push('save');
  }
  restore(): void {
    this.log.push('restore');
  }
  beginPath(): void {
    this.log.push('begin');
  }
  moveTo(x: number, y: number): void {
    this.log.push(`m ${x} ${y}`);
  }
  lineTo(x: number, y: number): void {
    this.log.push(`l ${x} ${y}`);
  }
  closePath(): void {
    this.log.push('close');
  }
  fill(): void {
    this.log.push(`fill ${this.globalCompositeOperation} ${this.style()}`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.log.push(`rect ${this.globalCompositeOperation} ${this.style()} ${x} ${y} ${w} ${h}`);
  }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient {
    this.grads += 1;
    const id = `grad${this.grads}(${x0},${y0},${r0},${x1},${y1},${r1})`;
    const g = {
      addColorStop: (o: number, c: string) => {
        this.log.push(`${id} stop ${o} ${c}`);
      },
      toString: () => id,
    };
    return g as unknown as CanvasGradient;
  }
  private style(): string {
    return String(this.fillStyle).replace(/^grad\d+/, 'grad');
  }
}

function logMap(): { map: LightMap<{ width: number; height: number }>; ctx: LogCtx } {
  const ctx = new LogCtx();
  const surface = (width: number, height: number): LightSurface<{ width: number; height: number }> => ({
    canvas: { width, height },
    ctx,
  });
  return { map: new LightMap(12, 'rgb(76, 88, 101)', surface), ctx };
}

/** 그라디언트 번호는 만든 순서라 지우고 견준다 */
const norm = (log: readonly string[]): string[] => log.map((l) => l.replace(/grad\d+/g, 'grad'));

describe('빛 지도 기록', () => {
  const sq = (x: number, y: number, s: number): Vec2[] => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  const soft = (x: number): SoftLight => ({
    poly: survivorVisionPolygon({ x, y: 10 }, 5),
    center: { x, y: 10 },
    radius: 5,
    soft: 1.2,
  });

  it('바뀌었으면 바로 칠하던 때와 같은 명령을 같은 순서로 칠한다', () => {
    const direct = logMap();
    const viaRec = logMap();
    direct.ctx.log.length = 0;
    viaRec.ctx.log.length = 0;
    const lights = [soft(8), soft(20)];
    const hard = sq(30, 5, 4);
    // 바로 칠하기 (M12 전): clear → addSoft · addHard
    direct.map.clear();
    for (const l of lights) direct.map.addSoft(l);
    direct.map.addHard(hard);
    // 기록 → paint
    const rec = new LightRecord();
    rec.reset();
    for (const l of lights) rec.addSoft(l);
    rec.addHard(hard);
    expect(rec.paint(viaRec.map)).toBe(true);
    expect(norm(viaRec.ctx.log)).toEqual(norm(direct.ctx.log));
  });

  it('같은 빛(같은 참조 또는 같은 꼭짓점)이면 다시 칠하지 않는다', () => {
    const { map, ctx } = logMap();
    const rec = new LightRecord();
    const a = soft(8);
    rec.reset();
    rec.addSoft(a);
    expect(rec.paint(map)).toBe(true);
    const n = ctx.log.length;
    // 같은 참조
    rec.reset();
    rec.addSoft(a);
    expect(rec.unchanged).toBe(true);
    expect(rec.paint(map)).toBe(false);
    // 다시 계산한 같은 다각형 · 새 중심 객체
    rec.reset();
    rec.addSoft({ ...soft(8), center: { x: 8, y: 10 } });
    expect(rec.paint(map)).toBe(false);
    expect(ctx.log.length).toBe(n);
  });

  it('자리 · 반경 · 흐림 띠 · 다각형 · 개수 · 종류 중 하나라도 다르면 다시 칠한다', () => {
    const { map } = logMap();
    const rec = new LightRecord();
    const base = soft(8);
    const variants: ((r: LightRecord) => void)[] = [
      (r) => r.addSoft({ ...base, center: { x: 8.01, y: 10 } }),
      (r) => r.addSoft({ ...base, radius: 5.5 }),
      (r) => r.addSoft({ ...base, soft: 1 }),
      (r) => r.addSoft({ ...base, poly: sq(1, 1, 3) }),
      (r) => {
        r.addSoft(base);
        r.addSoft(base);
      },
      (r) => r.addHard(base.poly),
      () => {},
    ];
    for (const v of variants) {
      rec.reset();
      rec.addSoft(base);
      rec.paint(map);
      rec.reset();
      v(rec);
      expect(rec.unchanged).toBe(false);
    }
  });

  it('첫 주기는 빛이 없어도 칠한다 (바탕 하한색)', () => {
    const { map, ctx } = logMap();
    ctx.log.length = 0;
    const rec = new LightRecord();
    rec.reset();
    expect(rec.paint(map)).toBe(true);
    expect(ctx.log.some((l) => l.startsWith('rect source-over rgb(76, 88, 101)'))).toBe(true);
    rec.reset();
    expect(rec.paint(map)).toBe(false);
  });

  it('samePoly', () => {
    const a = sq(0, 0, 1);
    expect(samePoly(a, a)).toBe(true);
    expect(samePoly(a, sq(0, 0, 1))).toBe(true);
    expect(samePoly(a, sq(0, 0, 2))).toBe(false);
    expect(samePoly(a, a.slice(0, 3))).toBe(false);
  });
});

describe('바닥 명령 기록 (Canvas 안개 · 미니맵 합성)', () => {
  it('기록을 다른 기록에 다시 그리면 같은 명령이 된다 (미니맵 기록에 조각을 덧붙이는 경로)', () => {
    const a = new PenRecord();
    a.fillCircle(1, 2, 3, 0xff0000, 0.5);
    a.strokeArc(1, 2, 3, 0.1, 0, 1, 2, 0x00ff00, 1);
    a.fillPoly(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      0x0000ff,
      0.25,
    );
    a.line(0, 0, 5, 5, 2, 0xffffff, 0.75);
    a.strokeCircle(4, 4, 2, 1, 0x123456, 0.5);
    const b = new PenRecord();
    a.replay(b);
    expect(b.ops).toEqual(a.ops);
    expect(b.sameAs(a.ops)).toBe(true);
  });
});
