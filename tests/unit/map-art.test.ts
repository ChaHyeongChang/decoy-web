// 맵 그림의 순수 부분 (M10b, art/mapArtGeom.ts): 칸 분류, 2.5D 면이 칸 밖으로 나가지 않음, 기둥 8각, 접촉 그림자,
// 데칼 · 네온 배치와 시드 결정성, 테두리 리프트, 구조 색의 대비(빛 속 바닥 휘도 상한 · 어둠 속 테두리 2.5:1), 예약 색.
// 그리고 동적 오브젝트(fogPaint.paintPoints · paintExits)가 판정 반경을 그대로 그리는지 기록용 펜으로 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_RECT,
  tileAt,
  type ExitId,
  type ExitView,
  type PointView,
  type TileKind,
  type Vec2,
} from '@decoy/shared';
import {
  FLOOR_COLORS,
  FLOOR_JITTER,
  MAP_ART,
  MAP_COLOR,
  OBJ,
  OBJ_COLOR,
  addRgb,
  contactShadows,
  darkOf,
  darkRim,
  darkRimContrast,
  doorFaces,
  doorJambs,
  doorLamps,
  exitChevrons,
  floorDecals,
  insetConvex,
  isSolidKind,
  maxLitFloorLuminance,
  mergeRects,
  neonRuns,
  openAt,
  pillarBlocks,
  pillarNeon,
  pillarShape,
  rimLiftPolys,
  rimLiftRects,
  solidAt,
  wallCells,
  wallFaces,
  type TileRect,
} from '../../client/src/art/mapArtGeom';
import {
  GLOW_SCALE,
  bakeGlow,
  bakeStaticMap,
  getGlowMap,
  getStaticMap,
  keepStaticMaps,
  staticMapSize,
} from '../../client/src/art/mapArt';
import { fbm, hash2, valueNoise } from '../../client/src/art/noise';
import { gfxState } from '../../client/src/gfx/state';
import { HIDDEN_SURVIVOR, ROLE, WARN, contrastRatio, relativeLuminance } from '../../client/src/art/palette';
import { FOG } from '../../client/src/render/colors';
import { ambientRgb } from '../../client/src/render/fogMath';
import {
  doorSlide,
  exitArcRange,
  exitSlide,
  litTicks,
  paintExits,
  paintPoints,
  paintedRadii,
  resetExitTracking,
  trackExit,
  type FogPen,
} from '../../client/src/render/fogPaint';
import { loadTestBalance } from '../helpers/fixtures';

const EPS = 1e-9;
const [AR, AG, AB] = ambientRgb(FOG.ambient, FOG.tint);
const AMBIENT_RGB = (AR << 16) | (AG << 8) | AB;
const SOLID: readonly TileKind[] = ['wall', 'pillar', 'exitN', 'exitS'];
const DIR: Record<'n' | 's' | 'e' | 'w', readonly [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

/** 점이 막힌 칸(닫힌 칸 경계 포함) 안에 있는가: 경계 위 점은 이웃 칸 중 하나라도 막혀 있으면 참 */
function inSolid(p: Vec2): boolean {
  const xs =
    Math.abs(p.x - Math.round(p.x)) < EPS ? [Math.round(p.x) - 1, Math.round(p.x)] : [Math.floor(p.x)];
  const ys =
    Math.abs(p.y - Math.round(p.y)) < EPS ? [Math.round(p.y) - 1, Math.round(p.y)] : [Math.floor(p.y)];
  return xs.some((i) => ys.some((j) => solidAt(i, j)));
}

/** 사각형 전체가 막힌 칸 안: 꼭짓점 · 변 중점 · 가운데와 칸 격자를 촘촘히 확인 */
function rectInSolid(r: TileRect): boolean {
  for (let fx = 0; fx <= 1 + EPS; fx += 0.125)
    for (let fy = 0; fy <= 1 + EPS; fy += 0.125)
      if (!inSolid({ x: r.x0 + (r.x1 - r.x0) * fx, y: r.y0 + (r.y1 - r.y0) * fy })) return false;
  return true;
}

function polyInRect(poly: readonly Vec2[], r: TileRect): boolean {
  return poly.every((p) => p.x >= r.x0 - EPS && p.x <= r.x1 + EPS && p.y >= r.y0 - EPS && p.y <= r.y1 + EPS);
}

describe('칸 분류', () => {
  it('벽 · 기둥 · 외벽 탈출구 문만 막힌 칸, 맵 밖도 막힘, 철창 · 감옥 문은 열린 쪽', () => {
    for (const k of ['floor', 'wall', 'pillar', 'bars', 'prisonDoor', 'exitN', 'exitS'] as const)
      expect(isSolidKind(k)).toBe(SOLID.includes(k));
    expect(solidAt(-1, 5)).toBe(true);
    expect(solidAt(MAP_W, 5)).toBe(true);
    expect(openAt(-1, 5)).toBe(false);
    expect(openAt(PRISON_RECT.x0, PRISON_RECT.y0)).toBe(true);
  });
});

describe('벽 2.5D 면 — 칸 밖으로 나가지 않는다 (그림 경계 = 판정 경계)', () => {
  it('모든 벽 칸: 윗면 · 앞면 · 테두리가 그 칸 안이고, 앞면은 남쪽이 열린 칸에만, 테두리는 열린 쪽에만', () => {
    const cells = wallCells();
    expect(cells.length).toBeGreaterThan(300);
    let fronts = 0;
    for (const { i, j } of cells) {
      const cell = { x0: i, y0: j, x1: i + 1, y1: j + 1 };
      const f = wallFaces(i, j);
      expect(polyInRect(rectPoly(f.top), cell)).toBe(true);
      expect(f.top.y1).toBeGreaterThan(f.top.y0);
      if (f.front) {
        fronts += 1;
        expect(openAt(i, j + 1)).toBe(true);
        expect(polyInRect(rectPoly(f.front), cell)).toBe(true);
        // 앞면 아래 끝 = 칸 경계 (바닥과 맞닿는 곳이 판정 경계)
        expect(f.front.y1).toBe(j + 1);
        expect(f.front.y0).toBeCloseTo(f.top.y1, 9);
      } else expect(openAt(i, j + 1)).toBe(false);
      for (const r of f.rims) {
        expect(polyInRect(rectPoly(r), cell)).toBe(true);
        const [di, dj] = DIR[r.side];
        expect(openAt(i + di, j + dj)).toBe(true);
      }
      const sides = new Set(f.rims.map((r) => r.side));
      if (openAt(i, j - 1)) expect(sides.has('n')).toBe(true);
      if (openAt(i - 1, j)) expect(sides.has('w')).toBe(true);
      if (openAt(i + 1, j)) expect(sides.has('e')).toBe(true);
    }
    expect(fronts).toBeGreaterThan(30);
  });

  it('탈출구 문 · 양옆 문틀 · 상태등도 막힌 칸 안', () => {
    for (const id of ['N', 'S'] as ExitId[]) {
      const f = doorFaces(id);
      const d = EXITS[id].door;
      for (const r of [f.top, ...(f.front ? [f.front] : []), ...f.rims])
        expect(polyInRect(rectPoly(r), d)).toBe(true);
      const jambs = doorJambs(id);
      expect(jambs.length).toBe(2);
      for (const j of [...jambs, ...doorLamps(id)]) expect(rectInSolid(j)).toBe(true);
    }
  });

  it('기둥: 이 맵의 기둥 덩어리는 모두 꽉 찬 사각형(2~4칸)이고, 8각 윗면 · 앞면 · 테두리 · 뚜껑이 받침(판정 칸) 안', () => {
    const blocks = pillarBlocks();
    let tiles = 0;
    for (const b of blocks) {
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      expect([2, 3, 4]).toContain(w);
      expect([2, 3, 4]).toContain(h);
      for (let j = b.y0; j < b.y1; j += 1)
        for (let i = b.x0; i < b.x1; i += 1) expect(tileAt(i, j)).toBe('pillar');
      tiles += w * h;
      const s = pillarShape(b);
      expect(s.base).toEqual(b);
      for (const poly of [s.top, s.front, s.inner, s.cap, s.capBolts, ...s.rim])
        expect(polyInRect(poly, b)).toBe(true);
      // 앞면 아래 끝은 받침 안쪽 (칸 밖으로 그림자 · 입체가 나가지 않음)
      expect(Math.max(...s.front.map((p) => p.y))).toBeLessThanOrEqual(b.y1);
      expect(s.rim.length).toBe(8);
      // 빛(왼쪽 위)을 받는 테두리 변이 있고 안 받는 변도 있다 (입체감)
      expect(s.rimLit.some(Boolean)).toBe(true);
      expect(s.rimLit.some((v) => !v)).toBe(true);
    }
    let count = 0;
    for (let j = 0; j < MAP_H; j += 1)
      for (let i = 0; i < MAP_W; i += 1) if (tileAt(i, j) === 'pillar') count += 1;
    expect(tiles).toBe(count);
  });

  it('볼록 다각형 안쪽 들이기: 정사각형을 d만큼 들이면 한 변이 2d 줄어든다', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const inner = insetConvex(sq, 0.25);
    expect(inner.map((p) => [round(p.x), round(p.y)])).toEqual([
      [0.25, 0.25],
      [1.75, 0.25],
      [1.75, 1.75],
      [0.25, 1.75],
    ]);
  });

  it('네온은 모두 벽 · 기둥 칸 안의 직선이다 (시드 고정)', () => {
    const runs = [...neonRuns(), ...pillarBlocks().map(pillarNeon)];
    expect(runs.length).toBeGreaterThan(10);
    for (const n of runs) {
      expect(n.x0 === n.x1 || n.y0 === n.y1).toBe(true);
      for (let t = 0; t <= 1; t += 0.1)
        expect(inSolid({ x: n.x0 + (n.x1 - n.x0) * t, y: n.y0 + (n.y1 - n.y0) * t })).toBe(true);
    }
    expect(neonRuns()).toEqual(neonRuns());
    expect(neonRuns(1)).not.toEqual(neonRuns(2));
  });
});

describe('바닥 쪽: 접촉 그림자 · 데칼', () => {
  it('접촉 그림자는 바닥 칸 안, 막힌 이웃 쪽 가장자리를 따라 깊이 ≤0.25타일', () => {
    const strips = contactShadows();
    expect(strips.length).toBeGreaterThan(200);
    for (const s of strips) {
      const i = Math.floor(s.x0 + EPS);
      const j = Math.floor(s.y0 + EPS);
      expect(tileAt(i, j)).toBe('floor');
      expect(s.depth).toBeLessThanOrEqual(0.25);
      expect(polyInRect(rectPoly(s), { x0: i, y0: j, x1: i + 1, y1: j + 1 })).toBe(true);
      const [di, dj] = DIR[s.side];
      expect(solidAt(i + di, j + dj)).toBe(true);
    }
    // 바닥보다 어둡게만: 그림자 색은 검정 계열이고 알파만 쓴다
    expect(MAP_ART.shadowAlpha).toBeGreaterThan(0);
    expect(MAP_ART.shadowAlpha).toBeLessThanOrEqual(1);
  });

  it('데칼은 바닥 칸에만, 벽 · 철창 · 감옥 문 칸에 걸리지 않고 거점 · 탈출구 · 감옥 근처를 비운다. 시드가 같으면 같다', () => {
    const decals = floorDecals();
    expect(decals.length).toBeGreaterThanOrEqual(20);
    for (const d of decals) {
      for (let j = Math.floor(d.y0); j < Math.ceil(d.y1); j += 1)
        for (let i = Math.floor(d.x0); i < Math.ceil(d.x1); i += 1) expect(tileAt(i, j)).toBe('floor');
      const cx = (d.x0 + d.x1) / 2;
      const cy = (d.y0 + d.y1) / 2;
      for (const p of Object.values(CAPTURE_POINTS))
        expect(Math.hypot(p.x - cx, p.y - cy)).toBeGreaterThanOrEqual(MAP_ART.decalClearPoint);
      for (const e of Object.values(EXITS))
        expect(Math.hypot(e.center.x - cx, e.center.y - cy)).toBeGreaterThanOrEqual(MAP_ART.decalClearExit);
    }
    expect(floorDecals()).toEqual(floorDecals());
    expect(floorDecals(7)).not.toEqual(floorDecals(8));
  });

  it('셰브론은 탈출구 판정 원 안의 바닥 위에 있다', () => {
    const b = loadTestBalance();
    for (const id of ['N', 'S'] as ExitId[]) {
      const c = EXITS[id].center;
      const ch = exitChevrons(id);
      expect(ch.length).toBe(3);
      for (const poly of ch)
        for (const p of poly) {
          expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThan(b.exit.radius);
          expect(solidAt(Math.floor(p.x), Math.floor(p.y))).toBe(false);
        }
    }
  });
});

describe('시드 고정 노이즈', () => {
  it('같은 입력은 같은 값, 범위 [0, 1)', () => {
    for (let k = 0; k < 200; k += 1) {
      const x = k * 0.37;
      const y = k * 0.11;
      expect(hash2(k, k * 3, 9)).toBe(hash2(k, k * 3, 9));
      const v = valueNoise(x, y, 4);
      expect(v).toBe(valueNoise(x, y, 4));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const f = fbm(x, y, 4, 3);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 2, 4));
  });
});

describe('테두리 리프트 (곱하기 뒤에 더하는 정적 구조 색)', () => {
  it('리프트 사각형은 모두 벽 · 문 테두리 위(막힌 칸 안)이고, 바닥 칸에는 닿지 않는다', () => {
    const rects = rimLiftRects();
    expect(rects.length).toBeGreaterThan(50);
    for (const r of rects) expect(rectInSolid(r)).toBe(true);
    // 합친 사각형 넓이 = 원래 테두리 넓이 (합치기가 넓히지 않음)
    const rims = [
      ...wallCells().flatMap(({ i, j }) => wallFaces(i, j).rims),
      ...(['N', 'S'] as ExitId[]).flatMap((id) => doorFaces(id).rims),
    ];
    const area = (rs: readonly TileRect[]): number =>
      rs.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    expect(area(rects)).toBeLessThanOrEqual(area(rims) + 1e-6);
  });

  it('리프트 사각형끼리 겹치지 않고(더하기가 두 번 겹치지 않음), 원래 테두리를 모두 덮는다', () => {
    const rects = rimLiftRects();
    for (let i = 0; i < rects.length; i += 1)
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!;
        const c = rects[j]!;
        const ox = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0);
        const oy = Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0);
        expect(ox > EPS && oy > EPS).toBe(false);
      }
    const rims = [
      ...wallCells().flatMap(({ i, j }) => wallFaces(i, j).rims),
      ...(['N', 'S'] as ExitId[]).flatMap((id) => doorFaces(id).rims),
    ];
    // 원래 테두리 안 격자 점이 모두 합친 사각형 안 (합집합이 줄지 않음)
    for (const r of rims)
      for (let u = 0.05; u < 1; u += 0.15)
        for (let v = 0.05; v < 1; v += 0.15) {
          const x = r.x0 + (r.x1 - r.x0) * u;
          const y = r.y0 + (r.y1 - r.y0) * v;
          expect(rects.some((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1)).toBe(true);
        }
  });

  it('기둥 리프트는 기둥 받침 안', () => {
    const blocks = pillarBlocks();
    for (const q of rimLiftPolys()) expect(blocks.some((b) => polyInRect(q, b))).toBe(true);
  });

  it('같은 줄 · 같은 높이로 맞닿은 사각형만 합친다', () => {
    expect(
      mergeRects([
        { x0: 0, y0: 0, x1: 1, y1: 0.1 },
        { x0: 1, y0: 0, x1: 2, y1: 0.1 },
        { x0: 3, y0: 0, x1: 4, y1: 0.1 },
        { x0: 5, y0: 0, x1: 5.1, y1: 1 },
        { x0: 5, y0: 1, x1: 5.1, y1: 2 },
      ]),
    ).toEqual([
      { x0: 0, y0: 0, x1: 2, y1: 0.1 },
      { x0: 3, y0: 0, x1: 4, y1: 0.1 },
      { x0: 5, y0: 0, x1: 5.1, y1: 2 },
    ]);
  });
});

describe('구조 색과 대비 (빛 지도 하한을 곱한 상태 포함)', () => {
  it('빛 속 바닥: 가장 밝은 바닥 색(흔들림 · 노이즈 최대치 포함) 상대휘도 ≤ 0.04 → 역할색 몸과 3:1 이상', () => {
    // 노이즈 overlay(강판 · 이음선 · 줄무늬 위)는 최대 2 × (128 + 10 + 4.5) / 255 ≈ 1.12배, 강판 톤 흔들림 +FLOOR_JITTER
    const underNoise: number[] = [
      MAP_COLOR.floor,
      MAP_COLOR.floorHi,
      MAP_COLOR.floorSeam,
      MAP_COLOR.panelSeam,
      MAP_COLOR.tread,
    ];
    const j = (FLOOR_JITTER << 16) | (FLOOR_JITTER << 8) | FLOOR_JITTER;
    let max = 0;
    for (const c of FLOOR_COLORS) {
      const bright = underNoise.includes(c) ? boost(addRgb(c, j), 1.12) : c;
      max = Math.max(max, relativeLuminance(bright));
    }
    expect(maxLitFloorLuminance()).toBeLessThanOrEqual(0.04);
    expect(max).toBeLessThanOrEqual(0.04);
    for (const role of [ROLE.runner, ROLE.guard, ROLE.scout, ROLE.monster])
      for (const c of FLOOR_COLORS) expect(contrastRatio(role, c)).toBeGreaterThanOrEqual(3);
  });

  it('어둠 속(하한 곱하기 + 리프트): 벽 · 기둥 테두리와 인접 바닥 대비 ≥ 2.5:1 (어두운 쪽 테두리 포함)', () => {
    expect(darkRimContrast(AMBIENT_RGB)).toBeGreaterThanOrEqual(2.5);
    const dimRim = addRgb(darkOf(MAP_COLOR.rimDim, AMBIENT_RGB), MAP_COLOR.rimLift);
    for (const f of [MAP_COLOR.floor, MAP_COLOR.floorHi, boost(MAP_COLOR.floorHi, 1.12)])
      expect(contrastRatio(dimRim, darkOf(f, AMBIENT_RGB))).toBeGreaterThanOrEqual(2.5);
    // 빈 통과가 아님: 리프트 없이 곱하기만 하면 2.5:1에 못 미친다 (그래서 리프트를 둔다)
    expect(
      contrastRatio(darkOf(MAP_COLOR.rimDim, AMBIENT_RGB), darkOf(MAP_COLOR.floor, AMBIENT_RGB)),
    ).toBeLessThan(2.5);
    // 시야 안 테두리는 시야 밖보다 확실히 밝다 (시야 경계가 벽선 밝기로도 갈린다)
    const lit = addRgb(MAP_COLOR.rim, MAP_COLOR.rimLift);
    expect(contrastRatio(lit, darkRim(AMBIENT_RGB))).toBeGreaterThanOrEqual(3);
  });

  it('어둠 속에서도 벽 윗면과 바닥이 구분되고, 시야 밖 바닥은 구조가 보이는 밝기(sRGB 밝기 ≥ 6)', () => {
    const luma = (c: number): number =>
      0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
    const floorDark = darkOf(MAP_COLOR.floor, AMBIENT_RGB);
    expect(luma(floorDark)).toBeGreaterThanOrEqual(6);
    expect(luma(darkOf(MAP_COLOR.wallTop, AMBIENT_RGB)) - luma(floorDark)).toBeGreaterThanOrEqual(5);
  });

  it('시설 발광(네온 · 철창)은 어둠 속에서 약 30%: 곱하기 하한이 채널마다 25~45%', () => {
    for (const ch of [AR, AG, AB]) {
      expect(ch / 255).toBeGreaterThan(0.25);
      expect(ch / 255).toBeLessThan(0.45);
    }
  });

  it('예약 색: 맵 · 오브젝트 색에 역할 4색 · #F8FAFC가 없고, 빨강 계열은 감옥 · 주황은 경고에만', () => {
    const reserved = [ROLE.runner, ROLE.guard, ROLE.scout, ROLE.monster, HIDDEN_SURVIVOR];
    const all = [...Object.entries(MAP_COLOR), ...Object.entries(OBJ_COLOR)];
    for (const [name, c] of all) {
      expect(reserved.includes(c), name).toBe(false);
      // 흰색에 가까운 밝은 색은 맵에 없다 (괴물 화면 '흰 원 = 생존자')
      expect(relativeLuminance(c), name).toBeLessThan(0.75);
      const red = isReddish(c);
      if (red) expect(['bar', 'barCore', 'barRail', 'prisonDoor'], name).toContain(name);
    }
    expect(OBJ_COLOR.warn).toBe(WARN);
    expect(isReddish(MAP_COLOR.bar)).toBe(true);
    expect(all.filter(([, c]) => c === WARN).map(([n]) => n)).toEqual(['warn']);
  });
});

describe('동적 오브젝트 (fogPaint): 판정 반경을 그대로 그린다', () => {
  const b = loadTestBalance();

  it('거점: 바깥 판정 원 반지름 = capturePoint.radius, 눈금 24칸 · 진행만큼 켜짐, 정지는 주황, 완료는 전부', () => {
    const pts: PointView[] = [
      { id: 'A', progress: 0.5, state: 'blocked' },
      { id: 'B', progress: 1, state: 'done' },
    ];
    const pen = new RecPen();
    paintPoints(pen, pts, b, 1000);
    expect(paintedRadii.point).toBe(b.capturePoint.radius);
    const rings = pen.calls.filter((c) => c.op === 'strokeCircle' && c.alpha >= 0.9);
    expect(rings.map((c) => c.r)).toEqual([b.capturePoint.radius, b.capturePoint.radius]);
    expect(rings.map((c) => [c.x, c.y])).toEqual([
      [CAPTURE_POINTS.A.x, CAPTURE_POINTS.A.y],
      [CAPTURE_POINTS.B.x, CAPTURE_POINTS.B.y],
    ]);
    const ticks = (color: number): number =>
      pen.calls.filter((c) => c.op === 'fillPoly' && c.color === color).length;
    expect(ticks(OBJ_COLOR.tickOff)).toBe(OBJ.ticks * 2);
    expect(ticks(WARN)).toBe(OBJ.ticks / 2);
    expect(ticks(OBJ_COLOR.neon)).toBe(OBJ.ticks);
    // 눈금은 판정 원 안쪽
    for (const c of pen.calls.filter((k) => k.op === 'fillPoly' && k.color === OBJ_COLOR.tickOff))
      for (const p of c.poly ?? [])
        expect(Math.min(dist(p, CAPTURE_POINTS.A), dist(p, CAPTURE_POINTS.B))).toBeLessThan(
          b.capturePoint.radius,
        );
    expect(litTicks(0.5, false)).toBe(12);
    expect(litTicks(0.3, true)).toBe(OBJ.ticks);
  });

  it('점령 중에만 스캔선이 돌고, 같은 시각이면 같은 그림 (결정성)', () => {
    const idle = new RecPen();
    paintPoints(idle, [{ id: 'A', progress: 0.2, state: 'idle' }], b, 500);
    const cap1 = new RecPen();
    const cap2 = new RecPen();
    paintPoints(cap1, [{ id: 'A', progress: 0.2, state: 'capturing' }], b, 500);
    paintPoints(cap2, [{ id: 'A', progress: 0.2, state: 'capturing' }], b, 500);
    expect(cap1.calls).toEqual(cap2.calls);
    expect(idle.calls.some((c) => c.op === 'line')).toBe(false);
    expect(cap1.calls.some((c) => c.op === 'line')).toBe(true);
    const later = new RecPen();
    paintPoints(later, [{ id: 'A', progress: 0.2, state: 'capturing' }], b, 1100);
    expect(later.calls).not.toEqual(cap1.calls);
  });

  it('탈출구: 판정 원 반지름 = exit.radius, 바닥 쪽 원호만 (끝점이 문 칸 경계), 괴물 화면(progress null)은 개방 게이지 없음', () => {
    const exits: ExitView[] = [
      { id: 'N', state: 'active', progress: 0.5 },
      { id: 'S', state: 'active', progress: null },
    ];
    const pen = new RecPen();
    paintExits(pen, exits, b, 2000);
    expect(paintedRadii.exit).toBe(b.exit.radius);
    const arcs = pen.calls.filter((c) => c.op === 'strokeArc' && c.inset === 0);
    expect(arcs.length).toBe(2);
    for (const [k, id] of (['N', 'S'] as ExitId[]).entries()) {
      const a = arcs[k]!;
      const c = EXITS[id].center;
      expect([a.x, a.y, a.r]).toEqual([c.x, c.y, b.exit.radius]);
      const [from, to] = exitArcRange(id, b.exit.radius);
      const lim = id === 'N' ? EXITS[id].door.y1 : EXITS[id].door.y0;
      for (const ang of [from, to]) expect(c.y + Math.sin(ang) * b.exit.radius).toBeCloseTo(lim, 9);
    }
    const gauge = pen.calls.filter((c) => c.color === OBJ_COLOR.gauge);
    // 북문(생존자 화면 진행 0.5)만 게이지 · 진행 호
    expect(gauge.length).toBeGreaterThan(0);
    for (const g of gauge) expect(g.y ?? centroid(g.poly ?? []).y).toBeLessThan(MAP_H / 2);
  });

  it('문 열림 미닫이: open이 된 순간부터 0 → 1 (장식 시간), 처음 본 것이 이미 open이면 바로 다 열림', () => {
    trackExit('N', 'active', 0);
    const at = trackExit('N', 'open', 1000);
    expect(at).toBe(1000);
    expect(trackExit('N', 'open', 1300)).toBe(1000);
    expect(doorSlide(at, 1000)).toBe(0);
    expect(doorSlide(at, 1000 + OBJ.doorSlideMs / 2)).toBeGreaterThan(0.5);
    expect(doorSlide(at, 1000 + OBJ.doorSlideMs)).toBe(1);
    // 다른 판(비활성으로 돌아감) 뒤 다시 열리면 다시 연출
    trackExit('N', 'inactive', 5000);
    expect(trackExit('N', 'open', 6000)).toBe(6000);
    // 처음 보는데 이미 열림 (재접속 · 새 레이어)
    resetExitTracking();
    const s = trackExit('S', 'open', 9000);
    expect(doorSlide(s, 9000)).toBe(1);
  });

  it('장식 시계가 멈춘 채(freezeClock) 문이 열려도, 실제 시간이 미닫이 시간만큼 지나면 다 열린 그림이다', () => {
    resetExitTracking();
    const openVoid = (pen: RecPen): Call[] =>
      pen.calls.filter((c) => c.op === 'fillPoly' && c.color === OBJ_COLOR.openVoid);
    const draw = (state: ExitView['state'], now: number, real: number): RecPen => {
      const pen = new RecPen();
      paintExits(pen, [{ id: 'N', state, progress: null }], b, now, real);
      return pen;
    };
    // 시계는 1000에 멈춰 있다. 활성으로 본 뒤 실제 시각 10ms에 열림
    draw('active', 1000, 0);
    expect(openVoid(draw('open', 1000, 10)).length).toBe(0);
    expect(exitSlide('N', 1000, 10 + OBJ.doorSlideMs / 2)).toBe(0);
    // 실제로 미닫이 시간이 지났다 → 다 열림 (문 칸 가운데가 열린 틈 색)
    const done = openVoid(draw('open', 1000, 10 + OBJ.doorSlideMs + 1));
    expect(done.length).toBe(1);
    const xs = done[0]!.poly!.map((p) => p.x);
    const d = EXITS.N.door;
    expect(Math.min(...xs)).toBeLessThan((d.x0 + d.x1) / 2 - 0.5);
    expect(Math.max(...xs)).toBeGreaterThan((d.x0 + d.x1) / 2 + 0.5);
    expect(exitSlide('N', 1000, 10 + OBJ.doorSlideMs)).toBe(1);
    // 시계가 흐르면 장식 시계대로 (실제 시계와 같이 흐름): 중간이면 중간
    resetExitTracking();
    trackExit('S', 'active', 0, 0);
    trackExit('S', 'open', 2000, 2000);
    expect(exitSlide('S', 2000 + OBJ.doorSlideMs / 2, 2000 + OBJ.doorSlideMs / 2)).toBeCloseTo(
      doorSlide(2000, 2000 + OBJ.doorSlideMs / 2),
      9,
    );
    expect(exitSlide('S', 2000 + OBJ.doorSlideMs / 2, 2000 + OBJ.doorSlideMs / 2)).toBeLessThan(1);
    // 기록이 없는 문은 다 열린 것으로
    expect(exitSlide('N', 0, 0)).toBe(1);
  });
});

// ───────────── 굽기: 정적 맵 캐시 (R4) · 시드 결정성 (T7) ─────────────

/** 모든 그리기 호출 · 속성 설정을 글자로 받아 적는 가짜 캔버스 문서 (log = null이면 적지 않는다) */
function fakeCanvasDoc(log: string[] | null): { createElement: () => unknown } {
  const fmt = (v: unknown): string => {
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && 'width' in v && 'height' in v)
      return `canvas${String((v as { width: number }).width)}x${String((v as { height: number }).height)}`;
    return typeof v;
  };
  const gradient = {
    addColorStop: (o: number, c: string): void => {
      log?.push(`stop(${o},${c})`);
    },
  };
  return {
    createElement: () => {
      const canvas: { width: number; height: number; getContext?: () => unknown } = { width: 0, height: 0 };
      const state: Record<string | symbol, unknown> = {};
      const ctx = new Proxy(state, {
        get(t, name) {
          if (name === 'canvas') return canvas;
          if (name in t) return t[name];
          // 픽셀 노이즈: 빈 이미지 데이터를 주고, 올릴 때 내용 해시를 적는다
          if (name === 'createImageData')
            return (w: number, h: number) => ({
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4),
            });
          if (name === 'putImageData')
            return (img: { data: Uint8ClampedArray }, x: number, y: number) => {
              let hsh = 2166136261;
              for (const v of img.data) hsh = Math.imul(hsh ^ v, 16777619) >>> 0;
              log?.push(`putImageData(${img.data.length},${hsh},${x},${y})`);
            };
          return (...args: unknown[]) => {
            log?.push(`${String(name)}(${args.map(fmt).join(',')})`);
            return gradient;
          };
        },
        set(t, name, v) {
          t[name] = v;
          log?.push(`${String(name)}=${fmt(v)}`);
          return true;
        },
      });
      canvas.getContext = () => ctx;
      return canvas;
    },
  };
}

describe('정적 맵 캐시: 지금 쓰는 것만 남긴다 (R4)', () => {
  beforeEach(() => {
    vi.stubGlobal('document', fakeCanvasDoc(null));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('같은 배율은 다시 굽지 않고, keepStaticMaps 전에도 두 장을 넘기지 않으며, keep 뒤에는 필요한 것만 남는다', () => {
    const count = (): number => Number(gfxState.features.mapCacheCount);
    const cacheBytes = (): number => Number(gfxState.features.mapCacheBytes);
    const a = getStaticMap(0.93, true);
    expect(getStaticMap(0.93, true)).toBe(a);
    // 옛 배율 · 다른 경로가 쌓여도 두 장 + 발광
    getStaticMap(1.86, false);
    getStaticMap(0.5, true);
    getStaticMap(1.395, false);
    expect(count()).toBeLessThanOrEqual(3);
    // GPU 합성: 메인(발광 따로) + 미니맵 + 발광
    keepStaticMaps(
      [
        { scale: 1.86, withGlow: false },
        { scale: 0.5, withGlow: true },
      ],
      true,
    );
    getStaticMap(1.86, false);
    getStaticMap(0.5, true);
    getGlowMap();
    const size = (s: number): number => staticMapSize(s).w * staticMapSize(s).h * 4;
    const glow = staticMapSize(GLOW_SCALE).w * staticMapSize(GLOW_SCALE).h * 4;
    expect(count()).toBe(3);
    expect(cacheBytes()).toBe(size(1.86) + size(0.5) + glow);
    // Canvas 합성(품질 낮춤): 메인 한 장만, 발광 캔버스도 버린다 (옛 배율 2 메인을 붙잡지 않는다)
    getStaticMap(0.93, true);
    keepStaticMaps([{ scale: 0.93, withGlow: true }], false);
    expect(count()).toBe(1);
    expect(cacheBytes()).toBe(size(0.93));
    // 버린 배율은 다시 구우면 새 캔버스
    expect(getStaticMap(1.86, false)).not.toBe(undefined);
  });
});

describe('굽기 결정성 (T7): 같은 배율이면 언제나 같은 그림 (시드 고정, Math.random 없음)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const [scale, withGlow] of [
    [0.93, true],
    [1.86, false],
  ] as const) {
    it(`정적 맵 배율 ${scale}${withGlow ? ' (발광 포함)' : ''}: 두 번 구운 그리기 명령이 같다`, () => {
      const bake = (): string[] => {
        // 발광 캐시는 미리 채워 둔다 (두 번째 굽기만 캐시를 쓰는 차이를 빼고 그림만 비교)
        vi.stubGlobal('document', fakeCanvasDoc(null));
        getGlowMap();
        const log: string[] = [];
        vi.stubGlobal('document', fakeCanvasDoc(log));
        bakeStaticMap(scale, withGlow);
        bakeGlow();
        return log;
      };
      const a = bake();
      const c = bake();
      // 빈 통과가 아님: 바닥 칸 톤이 시드 노이즈로 여러 가지이고 명령이 많다
      expect(a.length).toBeGreaterThan(5000);
      expect(new Set(a.filter((l) => l.startsWith('fillStyle='))).size).toBeGreaterThan(20);
      expect(c).toEqual(a);
    });
  }
});

// ───────────── 도우미 ─────────────

interface Call {
  op: string;
  x?: number;
  y?: number;
  r?: number;
  inset?: number;
  color: number;
  alpha: number;
  poly?: Vec2[];
}

class RecPen implements FogPen {
  readonly calls: Call[] = [];
  fillCircle(x: number, y: number, r: number, color: number, alpha: number): void {
    this.calls.push({ op: 'fillCircle', x, y, r, color, alpha });
  }
  strokeCircle(x: number, y: number, r: number, _w: number, color: number, alpha: number): void {
    this.calls.push({ op: 'strokeCircle', x, y, r, color, alpha });
  }
  strokeArc(
    x: number,
    y: number,
    r: number,
    inset: number,
    _f: number,
    _t: number,
    _w: number,
    color: number,
    alpha: number,
  ): void {
    this.calls.push({ op: 'strokeArc', x, y, r, inset, color, alpha });
  }
  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    this.calls.push({ op: 'fillPoly', color, alpha, poly: poly.map((p) => ({ ...p })) });
  }
  fillPolyFlat(xy: readonly number[], start: number, n: number, color: number, alpha: number): void {
    const poly: Vec2[] = [];
    for (let i = 0; i < n; i += 1)
      poly.push({ x: xy[start + i * 2] ?? NaN, y: xy[start + i * 2 + 1] ?? NaN });
    this.fillPoly(poly, color, alpha);
  }
  line(x0: number, y0: number, _x1: number, _y1: number, _w: number, color: number, alpha: number): void {
    this.calls.push({ op: 'line', x: x0, y: y0, color, alpha });
  }
}

function rectPoly(r: TileRect): Vec2[] {
  return [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, poly.length), y: y / Math.max(1, poly.length) };
}

/** 채널마다 배율 (노이즈 최대치 어림) */
function boost(c: number, k: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.min(255, Math.round(((c >> s) & 255) * k)) << s;
  return out;
}

/** 빨강 계열: 빨강이 초록 · 파랑의 1.6배 넘게 크다 (주황 #F59E0B는 아님) */
function isReddish(c: number): boolean {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return r > g * 1.6 && r > b * 1.6 && r > 40;
}

// 사용하지 않는 import 경고 방지용이 아니라, 정적 맵이 감옥 칸을 실제로 가진다는 전제 확인
it('감옥 칸 전제: 철창 고리 + 남쪽 문 2칸', () => {
  let bars = 0;
  let doors = 0;
  for (let j = PRISON_RECT.y0; j < PRISON_RECT.y1; j += 1)
    for (let i = PRISON_RECT.x0; i < PRISON_RECT.x1; i += 1) {
      if (tileAt(i, j) === 'bars') bars += 1;
      if (tileAt(i, j) === 'prisonDoor') doors += 1;
    }
  expect([bars, doors]).toEqual([10, 2]);
});
