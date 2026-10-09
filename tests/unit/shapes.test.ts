// 캐릭터 실루엣 (M10b, VISUAL_SPEC 0장 '색만으로 구분하지 않기' · 4장): 역할 모양이 색 없이도 갈리고,
// 같은 몸 원을 공유하며 앞 돌출이 1.55r 이내이고, 괴물 화면 공통 실루엣과도 다르다.
// 마스크 = 몸색으로 칠해지는 곳(실루엣 − 어두운 문양): 흑백 화면에서 사람이 보는 밝은 모양 (DECISIONS M10b)
import { describe, expect, it } from 'vitest';
import {
  BODY_R,
  CLOAK_REST,
  FRONT_REACH_MAX,
  GLYPHS,
  GLYPH_PLACE,
  GLYPH_SLOTS,
  RING_PAD,
  STUN_STARS,
  SURVIVOR_SHAPES,
  arcSteps,
  cloakOutline,
  glyphSlot,
  penArc,
  starSlot,
  stunOrbitDist,
  frontReach,
  inFill,
  inOutline,
  maskIoU,
  shapeMask,
  svgPath,
  type SurvivorShapeId,
} from '../../client/src/art/shapes';

const ROLES = ['runner', 'guard', 'scout'] as const;
const SIZES = [12.7, 18, 36];

function iou(a: SurvivorShapeId, b: SurvivorShapeId, d: number, rot = 0): number {
  return maskIoU(
    shapeMask(SURVIVOR_SHAPES[a], d, { rot }).data,
    shapeMask(SURVIVOR_SHAPES[b], d, { rot }).data,
  );
}

describe('역할 실루엣', () => {
  it('역할끼리 겹침(IoU) 0.8 이하 — 12.7 · 18 · 36px, 두 방향', () => {
    for (const d of SIZES)
      for (const rot of [0, 0.6])
        for (let i = 0; i < ROLES.length; i += 1)
          for (let j = i + 1; j < ROLES.length; j += 1) {
            const a = ROLES[i]!;
            const b = ROLES[j]!;
            expect(iou(a, b, d, rot), `${a}-${b} ${d}px`).toBeLessThanOrEqual(0.8);
          }
  });

  it('괴물 화면 공통 실루엣과 각 역할의 겹침 0.85 이하', () => {
    for (const d of SIZES)
      for (const rot of [0, 0.6])
        for (const r of ROLES)
          expect(iou('hidden', r, d, rot), `hidden-${r} ${d}px`).toBeLessThanOrEqual(0.85);
  });

  it('앞 돌출은 1.55r 이내 (역할마다 커 보이지 않게)', () => {
    for (const id of [...ROLES, 'hidden'] as const)
      expect(frontReach(SURVIVOR_SHAPES[id]), id).toBeLessThanOrEqual(FRONT_REACH_MAX + 1e-9);
    // 옆 · 뒤로는 몸 원 밖으로 나가지 않는다 (뒤쪽 반원 점이 모두 반지름 1.001 이내)
    for (const id of [...ROLES, 'hidden'] as const)
      for (const poly of SURVIVOR_SHAPES[id].outline)
        for (const p of poly)
          if (p.x < 0) expect(Math.hypot(p.x, p.y), id).toBeLessThanOrEqual(BODY_R + 1e-3);
  });

  it('생존자 넷은 같은 몸 원을 공유한다 (몸 원 안 면적이 모두 π)', () => {
    const areas = ([...ROLES, 'hidden'] as const).map((id) => {
      let n = 0;
      const step = 0.01;
      for (let y = -1; y <= 1; y += step)
        for (let x = -1; x <= 1; x += step)
          if (x * x + y * y <= 1 && inOutline(SURVIVOR_SHAPES[id], x, y)) n += 1;
      return n * step * step;
    });
    for (const a of areas) expect(a).toBeCloseTo(Math.PI, 1);
    expect(Math.max(...areas) - Math.min(...areas)).toBeLessThan(0.01);
  });

  it('몸 가운데 0.45r 원판은 85% 이상 몸색 (생존자 화면 역할색 · 괴물 화면 흰색이 문양에 묻히지 않음)', () => {
    for (const id of [...ROLES, 'hidden'] as const) {
      let n = 0;
      let f = 0;
      for (let y = -0.45; y <= 0.45; y += 0.01)
        for (let x = -0.45; x <= 0.45; x += 0.01) {
          if (x * x + y * y > 0.45 * 0.45) continue;
          n += 1;
          if (inFill(SURVIVOR_SHAPES[id], x, y)) f += 1;
        }
      expect(f / n, id).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('괴물 화면 공통 실루엣에는 문양이 없다 (흰색 위장)', () => {
    expect(SURVIVOR_SHAPES.hidden.marks).toEqual([]);
  });

  it('괴물 망토: 판정 반지름(1)에 맞는 크기, 돌진 때만 1.35까지', () => {
    const rest = cloakOutline(CLOAK_REST);
    const reach = (pts: readonly { x: number; y: number }[]): number =>
      Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
    expect(reach(rest)).toBeGreaterThanOrEqual(0.95);
    expect(reach(rest)).toBeLessThanOrEqual(1.12);
    expect(reach(cloakOutline({ ...CLOAK_REST, stretch: 1 }))).toBeLessThanOrEqual(1.35);
    for (const p of rest) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('같은 점 목록에서 SVG 경로를 만든다 (HUD · 로비 인라인 SVG)', () => {
    for (const g of Object.values(GLYPHS)) {
      const d = svgPath(g.outline, 12, 12, 12);
      expect(d).toMatch(/^M[-\d.]+ [-\d.]+(L[-\d.]+ [-\d.]+)+Z/);
      expect(d).not.toContain('NaN');
    }
    // 역할 아이콘끼리 모양이 다르다
    const masks = (['runner', 'guard', 'scout'] as const).map((id) => shapeMask(GLYPHS[id], 24).data);
    for (let i = 0; i < masks.length; i += 1)
      for (let j = i + 1; j < masks.length; j += 1)
        expect(maskIoU(masks[i]!, masks[j]!)).toBeLessThanOrEqual(0.8);
  });
});

describe('노출 문양 자리 (괴물 화면: 옆 캐릭터 몸을 덮지 않는 쪽)', () => {
  const r = 0.3;
  const clear = (
    self: { x: number; y: number },
    dir: number,
    o: { x: number; y: number; r: number },
  ): number =>
    Math.hypot(
      self.x + Math.cos(dir) * GLYPH_PLACE.dist * r - o.x,
      self.y + Math.sin(dir) * GLYPH_PLACE.dist * r - o.y,
    ) -
    (GLYPH_PLACE.r * r + o.r + RING_PAD);

  it('옆에 아무도 없으면 머리 위', () => {
    expect(glyphSlot({ x: 10, y: 10 }, r, [], null)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('0.7타일 북쪽에 다른 생존자가 서 있으면 그 몸과 겹치지 않는 자리 (검토 장면)', () => {
    const self = { x: 39.5, y: 11.9 };
    const north = { x: 39.5, y: 11.2, r };
    const monster = { x: 42.5, y: 11.6, r: 0.35 };
    const dir = glyphSlot(self, r, [north, monster], null);
    expect(dir).not.toBeCloseTo(-Math.PI / 2, 3);
    // 문양 배지 원과 다른 몸 원 사이에 틈이 있다
    expect(clear(self, dir, north)).toBeGreaterThan(0);
    expect(clear(self, dir, monster)).toBeGreaterThan(0);
  });

  it('지난 자리가 아직 비어 있으면 그대로 (깜빡이지 않음), 다 막히면 위', () => {
    const self = { x: 10, y: 10 };
    expect(glyphSlot(self, r, [], 0)).toBe(0);
    const ring = GLYPH_SLOTS.map((a) => ({
      x: self.x + Math.cos(a) * GLYPH_PLACE.dist * r,
      y: self.y + Math.sin(a) * GLYPH_PLACE.dist * r,
      r,
    }));
    expect(glyphSlot(self, r, ring, 0)).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe('매 프레임 그리는 원호는 선분으로 (Phaser 원호 100분할 대신)', () => {
  it('온원은 12각 이상, 현 ≈ 4px, 많아야 96', () => {
    expect(arcSteps(1, Math.PI * 2)).toBe(12);
    expect(arcSteps(2.5, Math.PI * 2)).toBe(12);
    expect(arcSteps(40, Math.PI * 2)).toBe(Math.ceil((Math.PI * 2 * 40) / 4));
    expect(arcSteps(320, Math.PI * 2)).toBe(96);
    expect(arcSteps(64, 0.1)).toBeGreaterThanOrEqual(1);
  });

  it('편 점들은 모두 반지름 위, 양 끝 각도 그대로', () => {
    const pts: { x: number; y: number }[] = [];
    const pen = {
      moveTo: (x: number, y: number) => pts.push({ x, y }),
      lineTo: (x: number, y: number) => pts.push({ x, y }),
    };
    penArc(pen, 5, 7, 40, -0.4, 1.3);
    for (const p of pts) expect(Math.hypot(p.x - 5, p.y - 7)).toBeCloseTo(40, 9);
    expect(Math.atan2(pts[0]!.y - 7, pts[0]!.x - 5)).toBeCloseTo(-0.4, 9);
    expect(Math.atan2(pts[pts.length - 1]!.y - 7, pts[pts.length - 1]!.x - 5)).toBeCloseTo(1.3, 9);
  });
});

describe('기절 별 자리 (옆 몸 · 바깥 링을 비켜 간다)', () => {
  const mR = 0.35;
  const T = 32;
  /** 궤도 위 별이 차지하는 원과 다른 몸 + 링 사이 최소 틈 (타일) */
  const gap = (c: { x: number; y: number }, dir: number, o: { x: number; y: number; r: number }): number => {
    const d = stunOrbitDist(mR, T, dir);
    const cx = c.x + Math.cos(dir) * d;
    const cy = c.y + Math.sin(dir) * d;
    let g = Infinity;
    for (let i = 0; i < 48; i += 1) {
      const t = (i / 48) * Math.PI * 2;
      const sx = cx + (Math.cos(t) * STUN_STARS.orbitX) / T;
      const sy = cy + (Math.sin(t) * STUN_STARS.orbitY) / T;
      g = Math.min(
        g,
        Math.hypot(sx - o.x, sy - o.y) - ((STUN_STARS.outer + STUN_STARS.edge) / T + o.r + RING_PAD),
      );
    }
    return g;
  };

  it('옆에 아무도 없으면 머리 위, 궤도는 괴물 망토 밖', () => {
    expect(starSlot({ x: 42, y: 12 }, mR, T, [], null)).toBeCloseTo(-Math.PI / 2, 9);
    expect(
      stunOrbitDist(mR, T) - (STUN_STARS.orbitY + STUN_STARS.outer + STUN_STARS.edge) / T,
    ).toBeGreaterThanOrEqual(mR * 1.1);
  });

  it('0.7타일 북쪽에 생존자가 있으면 그 몸 · 링과 겹치지 않는 쪽 (검토 장면)', () => {
    const north = { x: 42, y: 11.3, r: 0.3 };
    const dir = starSlot({ x: 42, y: 12 }, mR, T, [north], null);
    expect(dir).not.toBeCloseTo(-Math.PI / 2, 3);
    expect(gap({ x: 42, y: 12 }, dir, north)).toBeGreaterThanOrEqual(-1e-9);
  });
});
