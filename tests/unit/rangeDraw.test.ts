// 범위 · 부채꼴 그리기 (M10b 검토 반영, render/vision.ts): 정보 레이어 항목에서 그리고, 그린 선이 판정값 위에 있다.
//  - 빨강 부채꼴 사선 해치 · 펄스는 coneRed > 0일 때만, 판정 다각형 안에만 (색만으로 구분하지 않기 R13)
//  - 범위 표시 반지름 = 판정값 (공격 1.2타일 · 90°, 밀치기 2, 구조 1.2, 캠핑 4, 포효 10 — R12)
//  - 가드 밀치기 사거리 'in'은 서버 판정과 같은 조건 (거리 + 철창 · 벽에 막히지 않음)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import { pointInPolygon } from '../../shared/src/geometry';
import { PRISON_RECT, RESCUE_POINT, TILE_PX, blocksStrike } from '../../shared/src/map';
import { monsterConePolygon } from '../../shared/src/visibility';
import type { InfoItem, Vec2 } from '../../shared/src';
import { ANIM } from '../../client/src/art/anim';
import {
  CONE_LOOK,
  drawAttackRange,
  drawCampZone,
  drawConeHatch,
  drawRescueZone,
  drawRoarWave,
  drawShoveRange,
  shoveBlockPoint,
  shoveState,
  type PathPen,
} from '../../client/src/render/vision';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const T = TILE_PX;

interface Stroke {
  kind: 'fill' | 'stroke';
  color: number;
  alpha: number;
  width: number;
  /** 하위 경로 (moveTo마다 새로) */
  subs: Vec2[][];
}

/** 기록 펜: 채우기 · 선 명령마다 그 경로의 점들(월드 px)과 스타일을 남긴다 */
function recorder(): PathPen & { out: Stroke[] } {
  const out: Stroke[] = [];
  let fill = { color: 0, alpha: 1 };
  let line = { color: 0, alpha: 1, width: 1 };
  let subs: Vec2[][] = [];
  return {
    out,
    fillStyle: (color: number, alpha = 1) => {
      fill = { color, alpha };
    },
    lineStyle: (width: number, color: number, alpha = 1) => {
      line = { color, alpha, width };
    },
    beginPath: () => {
      subs = [];
    },
    moveTo: (x: number, y: number) => {
      subs.push([{ x, y }]);
    },
    lineTo: (x: number, y: number) => {
      const cur = subs[subs.length - 1];
      if (cur) cur.push({ x, y });
      else subs.push([{ x, y }]);
    },
    closePath: () => undefined,
    fillPath: () => {
      out.push({ kind: 'fill', ...fill, width: 0, subs });
    },
    strokePath: () => {
      out.push({ kind: 'stroke', ...line, subs });
    },
  };
}

function item(tag: string, x: number, y: number, r: number, extra: Partial<InfoItem> = {}): InfoItem {
  return {
    kind: 'range',
    tag,
    x,
    y,
    r,
    dir: null,
    arc: null,
    value: null,
    color: 0xffffff,
    alpha: 1,
    ...extra,
  };
}

/** 점이 다각형 안이거나 경계에서 eps(타일) 이내인가 */
function insideOrOn(p: Vec2, poly: readonly Vec2[], eps = 1e-6): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[j]!;
    const b = poly[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    if (Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) <= eps) return true;
  }
  return false;
}

describe('빨강 부채꼴 사선 해치 · 펄스 (drawConeHatch)', () => {
  const eye = { x: 40, y: 12 };
  const cone = monsterConePolygon(balance, eye, Math.PI, 0);

  it('coneRed = 0(노랑)이면 한 줄도 긋지 않는다', () => {
    const pen = recorder();
    expect(drawConeHatch(pen, cone, eye, Math.PI, 0, 1.3, 0xef4444)).toBe(0);
    expect(pen.out).toEqual([]);
  });

  it('coneRed > 0이면 줄을 긋고, 모든 줄은 판정 다각형 안 (끝점은 경계 위, 가운데는 안)', () => {
    for (const red of [0.3, 1])
      for (const tS of [0, 0.17, 0.42, 1.9]) {
        const pen = recorder();
        const n = drawConeHatch(pen, cone, eye, Math.PI, red, tS, 0xef4444);
        expect(n).toBeGreaterThan(3);
        const strokes = pen.out.filter((s) => s.kind === 'stroke');
        expect(strokes.length).toBe(1);
        let segs = 0;
        for (const sub of strokes[0]!.subs) {
          expect(sub.length).toBe(2);
          const [a, b] = sub.map((p) => ({ x: p.x / T, y: p.y / T })) as [Vec2, Vec2];
          expect(insideOrOn(a, cone, 1e-6)).toBe(true);
          expect(insideOrOn(b, cone, 1e-6)).toBe(true);
          expect(pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cone)).toBe(true);
          segs += 1;
        }
        expect(segs).toBe(n);
      }
  });

  it('펄스: 0.6초 주기로 알파가 오르내리고(같은 위상이면 같은 값), 빨강 세기에 비례', () => {
    const alphaAt = (tS: number, red = 1): number => {
      const pen = recorder();
      drawConeHatch(pen, cone, eye, Math.PI, red, tS, 0xef4444);
      return pen.out[0]!.alpha;
    };
    const lo = alphaAt(0);
    const hi = alphaAt(ANIM.hatchPulseS / 2);
    expect(lo).toBeCloseTo(CONE_LOOK.hatchAlpha, 6);
    expect(hi).toBeCloseTo(CONE_LOOK.hatchAlpha + CONE_LOOK.hatchPulse, 6);
    expect(alphaAt(0.13)).toBeCloseTo(alphaAt(0.13 + ANIM.hatchPulseS), 6);
    expect(alphaAt(0.13, 0.5)).toBeCloseTo(alphaAt(0.13) * 0.5, 6);
  });

  it('줄이 흐른다: 같은 펄스 위상의 다른 시각이면 줄 자리가 다르다', () => {
    const first = (tS: number): Vec2 => {
      const pen = recorder();
      drawConeHatch(pen, cone, eye, Math.PI, 1, tS, 0xef4444);
      return pen.out[0]!.subs[0]![0]!;
    };
    expect(first(0.1)).not.toEqual(first(0.3));
  });
});

/** 기록 경로의 점들 중 원 중심에서 거리 (타일) */
function radii(strokes: Stroke[], cx: number, cy: number, pick: (s: Stroke) => boolean): number[] {
  const out: number[] = [];
  for (const s of strokes.filter(pick))
    for (const sub of s.subs) for (const p of sub) out.push(Math.hypot(p.x / T - cx, p.y / T - cy));
  return out;
}

describe('범위 표시 반지름 = 판정값 (정보 항목에서 그린다)', () => {
  it('공격 준비: 경계 호는 attack.range, 직선 변은 방향 ± arc/2 (앞머리 · 채움도 범위 안)', () => {
    const atk = balance.monster.attack;
    const dir = 0.7;
    const arc = (atk.arc * Math.PI) / 180;
    const it = item('attack', 30, 12, atk.range, { dir, arc });
    const fillPen = recorder();
    const linePen = recorder();
    drawAttackRange(fillPen, linePen, it, 0.6);
    const edges = linePen.out.filter((s) => s.kind === 'stroke' && s.color === 0xffffff && s.alpha === 0.85);
    expect(edges.length).toBe(1);
    const pts = edges[0]!.subs.flat().map((p) => ({ x: p.x / T - 30, y: p.y / T - 12 }));
    const arcPts = pts.filter((p) => Math.hypot(p.x, p.y) > 1e-9);
    for (const p of arcPts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(atk.range, 9);
      const a = Math.atan2(p.y, p.x) - dir;
      expect(Math.abs(a)).toBeLessThanOrEqual(arc / 2 + 1e-9);
    }
    // 호의 양 끝 = 방향 ± arc/2
    const angs = arcPts.map((p) => Math.atan2(p.y, p.x) - dir);
    expect(Math.min(...angs)).toBeCloseTo(-arc / 2, 9);
    expect(Math.max(...angs)).toBeCloseTo(arc / 2, 9);
    // 채움 · 앞머리는 범위 밖으로 나가지 않는다
    for (const r of radii([...fillPen.out, ...linePen.out], 30, 12, () => true))
      expect(r).toBeLessThanOrEqual(atk.range + 1e-9);
  });

  it('밀치기 2 · 구조 1.2 · 포효 10(끝) · 캠핑 4: 그린 점선 · 고리가 판정 반지름 위', () => {
    const g = balance.roles.guard.shoveRange;
    const shove = recorder();
    drawShoveRange(shove, item('shove', 20, 10, g, { value: 'in' }), null);
    for (const r of radii(shove.out, 20, 10, () => true)) expect(r).toBeCloseTo(g, 9);

    const rr = balance.prison.rescueRadius;
    const rescue = recorder();
    drawRescueZone(rescue, item('rescue', RESCUE_POINT.x, RESCUE_POINT.y, rr), 0.7);
    for (const r of radii(rescue.out, RESCUE_POINT.x, RESCUE_POINT.y, () => true))
      expect(r).toBeCloseTo(rr, 9);

    const roar = balance.monster.roar.radius;
    const wave = recorder();
    drawRoarWave(wave, item('roar', 24, 16, roar), 0.9999);
    const outer = radii(wave.out, 24, 16, (s) => s.width === 3);
    for (const r of outer) expect(r).toBeCloseTo(roar, 3);

    // 캠핑: 철창 사각형에서 campRadius 떨어진 둥근 사각형 (모든 점이 사각형까지 거리 = campRadius)
    const cr = balance.prison.campRadius;
    const camp = recorder();
    drawCampZone(camp, item('camp', 24, 16, cr, { value: 2 }), PRISON_RECT);
    const toRect = (p: Vec2): number => {
      const dx = Math.max(PRISON_RECT.x0 - p.x, 0, p.x - PRISON_RECT.x1);
      const dy = Math.max(PRISON_RECT.y0 - p.y, 0, p.y - PRISON_RECT.y1);
      return Math.hypot(dx, dy);
    };
    const campPts = camp.out.flatMap((s) => s.subs.flat()).map((p) => ({ x: p.x / T, y: p.y / T }));
    expect(campPts.length).toBeGreaterThan(20);
    for (const p of campPts) expect(toRect(p)).toBeCloseTo(cr, 9);
  });

  it('반지름은 정보 항목에서 온다: 항목 r을 바꾸면 그림도 바뀐다 (그림만 따로 어긋날 수 없음)', () => {
    const a = recorder();
    drawShoveRange(a, item('shove', 20, 10, 3, { value: 'out' }), null);
    for (const r of radii(a.out, 20, 10, () => true)) expect(r).toBeCloseTo(3, 9);
  });
});

describe('가드 밀치기 사거리 상태 = 서버 판정 조건', () => {
  const range = balance.roles.guard.shoveRange;
  it('거리 안이어도 철창(판정선)이 가로막으면 in이 아니라 blocked (검토 장면: 감옥 밖 가드 · 감옥 안 괴물)', () => {
    expect(shoveState({ x: 21.55, y: 14.5 }, { x: 23.5, y: 14.5 }, range)).toBe('blocked');
  });
  it('트인 바닥 거리 안 = in, 밖 = out', () => {
    expect(shoveState({ x: 38, y: 12 }, { x: 39.9, y: 12 }, range)).toBe('in');
    expect(shoveState({ x: 38, y: 12 }, { x: 40.5, y: 12 }, range)).toBe('out');
  });
  it('막힘은 × 표시를 더 긋는다 (색만으로 구분하지 않기)', () => {
    const me = { x: 21.55, y: 14.5 };
    const mark = shoveBlockPoint(me, { x: 23.5, y: 14.5 });
    const open = recorder();
    const blocked = recorder();
    drawShoveRange(open, item('shove', me.x, me.y, range, { value: 'in' }), null);
    drawShoveRange(blocked, item('shove', me.x, me.y, range, { value: 'blocked' }), mark);
    expect(blocked.out.length).toBeGreaterThan(open.out.length);
  });
  it('× 자리 = 가드 → 괴물 선분을 가로막은 구조물 칸 위 (괴물이 원 둘레에 있어도 몸에 가려지지 않는다)', () => {
    const me = { x: 21.55, y: 14.5 };
    const mon = { x: 23.5, y: 14.5 };
    const mark = shoveBlockPoint(me, mon)!;
    expect(mark).not.toBeNull();
    // 선분 위, 타격 차단 칸 안
    const t =
      ((mark.x - me.x) * (mon.x - me.x) + (mark.y - me.y) * (mon.y - me.y)) /
      ((mon.x - me.x) ** 2 + (mon.y - me.y) ** 2);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    expect(blocksStrike(Math.floor(mark.x), Math.floor(mark.y))).toBe(true);
    // 괴물 몸(반지름) · 가드 몸 밖
    expect(Math.hypot(mark.x - mon.x, mark.y - mon.y)).toBeGreaterThan(balance.monster.radius + 0.2);
    expect(Math.hypot(mark.x - me.x, mark.y - me.y)).toBeGreaterThan(balance.survivor.radius + 0.2);
    // × 선 두 개의 교차점 = mark
    const g = recorder();
    drawShoveRange(g, item('shove', me.x, me.y, range, { value: 'blocked' }), mark);
    const cross = g.out.filter((st) => st.subs.length === 2 && st.subs.every((sub) => sub.length === 2));
    expect(cross.length).toBe(2);
    for (const st of cross) {
      const [a, b] = st.subs;
      expect((a![0]!.x + a![1]!.x) / 2 / T).toBeCloseTo(mark.x, 9);
      expect((a![0]!.y + a![1]!.y) / 2 / T).toBeCloseTo(mark.y, 9);
      expect((b![0]!.x + b![1]!.x) / 2 / T).toBeCloseTo(mark.x, 9);
    }
    // 트인 바닥은 막힘 자리가 없다
    expect(shoveBlockPoint({ x: 38, y: 12 }, { x: 39.9, y: 12 })).toBeNull();
  });
});
