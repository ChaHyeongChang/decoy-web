// 입체감 (VISUAL_SPEC 14장): 순수 계산(art/depthGeom.ts) · 설정(gfx/depth.ts)의 규칙
//  - 판정은 바닥 모양 그대로 (띄우는 칸 · 받침은 판정 칸, 윗면만 그림에서 옮긴다)
//  - 정보가 묻히지 않게: 그린 캐릭터 · 거점 · 탈출구 판정 원과 겹치는 윗면 조각은 반투명
//  - 빛 · 그림자는 받은 시야로만, 벽 그림자 = 시야 다각형 경계, 어둠 속 구조는 시간에 따라 변하지 않는다(R9)
//  - 괴물 화면 생존자 셋이 똑같다 (비스듬 그림자는 위치 · 몸 반지름만의 함수)
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  POINT_IDS,
  survivorVisionPolygon,
  tileAt,
  type Vec2,
} from '@decoy/shared';
import {
  DEPTH,
  DEPTH_COLOR,
  DEPTH_LOOKS,
  DEPTH_NEON,
  PILLAR_PRISMS,
  WALL_LAMPS,
  castOffset,
  cellHull,
  clipConvex,
  diskHitsRect,
  edgeSample,
  fadedRect,
  faceVisible,
  gradePixel,
  lanternWarm,
  lampLevel,
  lightAt,
  litColor,
  objectiveDisks,
  prismFaceVisible,
  projectTop,
  raisedAt,
  rimColor,
  splitByRect,
  topRect,
  wallFootprint,
  type Cam,
  type DepthLook,
  type LightEye,
} from '../../client/src/art/depthGeom';
import { MAP_COLOR, darkOf, darkRim } from '../../client/src/art/mapArtGeom';
import { ROLE, HIDDEN_SURVIVOR, contrastRatio } from '../../client/src/art/palette';
import { FOG } from '../../client/src/render/colors';
import { ambientRgb } from '../../client/src/render/fogMath';
import {
  DEFAULT_DEPTH_LOOK,
  activeDepthLook,
  depthSupported,
  initDepthUrl,
  parseDepthLook,
  parseDepthParam,
  resetDepthForTest,
} from '../../client/src/gfx/depth';
import { PREF_DEFAULTS, resetPrefsForTest, setPref } from '../../client/src/prefs';

const LOOKS: readonly DepthLook[] = Object.values(DEPTH_LOOKS);
const AMB = ambientRgb(FOG.ambient, FOG.tint);
const AMB_RGB = (AMB[0] << 16) | (AMB[1] << 8) | AMB[2];
/** 따라가는 카메라 확대 3의 보이는 창 (타일) — layout VIEW_TILES 근사 */
const VIEW = { w: 16, h: 10.7 };

/** 창이 맵 안에 있는 카메라 중심 표본 */
function cams(): Cam[] {
  const out: Cam[] = [];
  for (let y = VIEW.h / 2; y <= MAP_H - VIEW.h / 2 + 1e-9; y += 1.3)
    for (let x = VIEW.w / 2; x <= MAP_W - VIEW.w / 2 + 1e-9; x += 1.7) out.push({ x, y });
  return out;
}

function polyArea(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 1) {
    const u = p[i];
    const v = p[(i + 1) % p.length];
    if (u && v) a += u.x * v.y - v.x * u.y;
  }
  return Math.abs(a) / 2;
}

function rectPoly(r: { x0: number; y0: number; x1: number; y1: number }): Vec2[] {
  return [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
}

describe('입체감: 띄우는 칸 · 투영 (판정은 바닥 모양 그대로)', () => {
  it('띄우는 칸은 벽 · 기둥뿐이고 탈출구 문 · 문틀 · 철창 · 감옥 문 · 바닥 · 맵 밖은 띄우지 않는다', () => {
    for (let j = 0; j < MAP_H; j += 1)
      for (let i = 0; i < MAP_W; i += 1) {
        const k = tileAt(i, j);
        const r = raisedAt(i, j);
        if (k === 'pillar') expect(r).toBe(2);
        else if (k === 'wall') {
          const jamb = (['N', 'S'] as const).some((id) => {
            const d = EXITS[id].door;
            return j >= d.y0 && j < d.y1 && (i === d.x0 - 1 || i === d.x1);
          });
          expect(r, `(${i}, ${j})`).toBe(jamb ? 0 : 1);
        } else expect(r, `${k} (${i}, ${j})`).toBe(0);
      }
    expect(raisedAt(-1, 3)).toBe(0);
    expect(raisedAt(3, MAP_H)).toBe(0);
  });

  it('시안 값: 창 안 어디서나 남쪽 면이 보이고(lift > 시차 × 반높이), 윗면이 칸 밖으로 나가는 거리 < 1타일', () => {
    for (const look of LOOKS) {
      expect(look.lift, look.id).toBeGreaterThan(look.parallax * (VIEW.h / 2 + 2));
      expect(look.lift + look.parallax * (VIEW.h / 2 + 2), look.id).toBeLessThan(1);
      expect(look.parallax * (VIEW.w / 2 + 2), look.id).toBeLessThan(1);
    }
    expect(Object.keys(DEPTH_LOOKS).sort()).toEqual(['a', 'b', 'c']);
    expect(DEFAULT_DEPTH_LOOK).toBe('b');
  });

  it('투영: 카메라 중심의 윗면은 lift만큼 북쪽, 중심에서 멀수록 바깥으로 (시차) — 남쪽 면은 늘, 북쪽 면은 없고, 동 · 서는 카메라 쪽만', () => {
    const look = DEPTH_LOOKS.b;
    const cam = { x: 20, y: 12 };
    const p = { x: 0, y: 0 };
    projectTop(20, 12, cam, look, p);
    expect(p.x).toBeCloseTo(20, 9);
    expect(p.y).toBeCloseTo(12 - look.lift, 9);
    projectTop(30, 12, cam, look, p);
    expect(p.x).toBeGreaterThan(30);
    projectTop(10, 12, cam, look, p);
    expect(p.x).toBeLessThan(10);
    for (const c of cams())
      for (let j = Math.floor(c.y - VIEW.h / 2) - 1; j <= Math.ceil(c.y + VIEW.h / 2) + 1; j += 1) {
        expect(faceVisible('s', 0, j, c, look)).toBe(true);
        for (let i = Math.floor(c.x - VIEW.w / 2); i <= Math.ceil(c.x + VIEW.w / 2); i += 1) {
          expect(faceVisible('e', i, j, c, look)).toBe(i + 1 < c.x - 1e-9);
          expect(faceVisible('w', i, j, c, look)).toBe(i > c.x + 1e-9);
          // 칸 하나가 화면에서 차지하는 범위 = 받침 ∪ 윗면: 받침(판정 칸)을 늘 담는다
          const h = cellHull(i, j, c, look);
          expect(h.x0 <= i && h.y0 <= j && h.x1 >= i + 1 && h.y1 >= j + 1).toBe(true);
        }
      }
  });

  it('기둥 8각 프리즘: 보이는 옆면은 카메라 쪽(남쪽 변은 늘 보이고 북쪽 변은 늘 숨는다)', () => {
    const look = DEPTH_LOOKS.b;
    expect(PILLAR_PRISMS.length).toBeGreaterThan(0);
    for (const prism of PILLAR_PRISMS) {
      const c = { x: (prism.block.x0 + prism.block.x1) / 2, y: (prism.block.y0 + prism.block.y1) / 2 + 3 };
      const top = prism.base.map((v) => {
        const p = { x: 0, y: 0 };
        projectTop(v.x, v.y, c, look, p);
        return p;
      });
      // 시계 방향 8각: 0→1 북쪽 변, 4→5 남쪽 변
      const vis = (k: number): boolean =>
        prismFaceVisible(prism.base[k]!, prism.base[(k + 1) % 8]!, top[k]!, top[(k + 1) % 8]!);
      expect(vis(4), '남쪽 변').toBe(true);
      expect(vis(0), '북쪽 변').toBe(false);
    }
  });
});

describe('입체감: 정보가 묻히지 않게 (반투명)', () => {
  it('그린 캐릭터 몸이 띄운 윗면 아래(받침 북쪽 바로 밖)에 오면 반투명, 멀어지면 불투명 — 받은 몸 원만 본다', () => {
    const look = DEPTH_LOOKS.b;
    // 벽 덩어리 (28–29, 8–11)의 북쪽 칸 (28, 8)
    expect(raisedAt(28, 8)).toBe(1);
    const cam = { x: 26, y: 12 };
    const hull = topRect(28, 8, cam, look);
    expect(fadedRect(hull, [{ x: 28.6, y: 7.62, r: 0.3 }], [])).toBe(true);
    expect(fadedRect(hull, [{ x: 28.6, y: 6.2, r: 0.3 }], [])).toBe(false);
    // 남쪽(앞) · 옆에 바짝 선 캐릭터는 윗면 아래가 아니다 (옆면 · 받침은 판정 칸 안)
    expect(fadedRect(topRect(28, 11, cam, look), [{ x: 28.6, y: 12.31, r: 0.3 }], [])).toBe(false);
    // 동쪽에 선 캐릭터: 카메라가 더 동쪽이면 윗면이 서쪽으로 물러나 아래가 아니고, 카메라가 서쪽이면 시차로 뻗은 윗면 아래다
    expect(fadedRect(topRect(29, 10, { x: 34, y: 12 }, look), [{ x: 30.5, y: 10.5, r: 0.3 }], [])).toBe(
      false,
    );
    expect(fadedRect(topRect(29, 10, { x: 22, y: 12 }, look), [{ x: 30.5, y: 10.5, r: 0.3 }], [])).toBe(true);
    expect(fadedRect(hull, [], [])).toBe(false);
  });

  it('거점 · 탈출구 판정 원 위로 뻗은 윗면 조각은 모두 반투명이다 (모든 시안 · 카메라 자리 표본, 벽 칸 · 기둥)', () => {
    const objectives = objectiveDisks(2.5, 1.5);
    expect(objectives).toHaveLength(POINT_IDS.length + 2);
    for (const look of LOOKS)
      for (const c of cams()) {
        for (let j = 0; j < MAP_H; j += 1)
          for (let i = 0; i < MAP_W; i += 1) {
            if (raisedAt(i, j) !== 1) continue;
            const parts = splitByRect(rectPoly(topRect(i, j, c, look)), wallFootprint(i, j));
            const hits = parts.outside.some((p) => {
              const xs = p.map((v) => v.x);
              const ys = p.map((v) => v.y);
              const box = {
                x0: Math.min(...xs),
                y0: Math.min(...ys),
                x1: Math.max(...xs),
                y1: Math.max(...ys),
              };
              return objectives.some((o) => diskHitsRect(o, box));
            });
            if (hits)
              expect(fadedRect(topRect(i, j, c, look), [], objectives), `${look.id} (${i}, ${j})`).toBe(true);
          }
        for (const prism of PILLAR_PRISMS) {
          const top = prism.base.map((v) => {
            const p = { x: 0, y: 0 };
            projectTop(v.x, v.y, c, look, p);
            return p;
          });
          const parts = splitByRect(top, prism.block);
          const hits = parts.outside.some((p) =>
            objectives.some((o) => p.some((v) => Math.hypot(v.x - o.x, v.y - o.y) < o.r)),
          );
          const xs = top.map((v) => v.x);
          const ys = top.map((v) => v.y);
          const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
          if (hits)
            expect(
              fadedRect(box, [], objectives),
              `${look.id} 기둥 (${prism.block.x0}, ${prism.block.y0})`,
            ).toBe(true);
        }
      }
  });

  it('거점 C 남쪽 기둥은 거점 판정 원 쪽으로 뻗을 수 있어 반투명 대상이다 (판정 원 = 거점 · 탈출구 셋 + 둘)', () => {
    const objectives = objectiveDisks(2.5, 1.5);
    const c = CAPTURE_POINTS.C;
    expect(objectives.some((o) => o.x === c.x && o.y === c.y && o.r > 2.5)).toBe(true);
    const near = PILLAR_PRISMS.find((p) => p.block.y0 > c.y && p.block.x0 <= c.x && p.block.x1 >= c.x);
    expect(near).toBeDefined();
  });

  it('윗면 나누기: 받침 안 + 바깥 조각 넓이 = 원래 넓이, 볼록 자르기는 넓이를 보존한다', () => {
    const look = DEPTH_LOOKS.c;
    const cam = { x: 30, y: 16 };
    for (const [i, j] of [
      [28, 8],
      [20, 9],
      [12, 26],
    ] as const) {
      const top = rectPoly(topRect(i, j, cam, look));
      const parts = splitByRect(top, wallFootprint(i, j));
      const sum = polyArea(parts.inside) + parts.outside.reduce((s, p) => s + polyArea(p), 0);
      expect(sum).toBeCloseTo(polyArea(top), 9);
    }
    const sq = rectPoly({ x0: 0, y0: 0, x1: 2, y1: 2 });
    expect(polyArea(clipConvex(sq, 'x', 0.5, true))).toBeCloseTo(1, 9);
    expect(polyArea(clipConvex(sq, 'y', 1.5, false))).toBeCloseTo(1, 9);
  });
});

describe('입체감: 빛 · 그림자는 받은 시야로만', () => {
  it('lightAt: 시야가 없으면 0, 다각형 밖 0, 부드러운 가장자리 = clamp((r − d) / (r − inner)) (빛 지도와 같은 식), 딱 자른 시야는 1', () => {
    const poly = survivorVisionPolygon({ x: 9, y: 2 }, 6);
    const soft: LightEye = { poly, x: 9, y: 2, r: 6, inner: 4.8, hard: false };
    expect(lightAt(9.5, 2, [])).toBe(0);
    expect(lightAt(9.5, 2, [soft])).toBe(1);
    expect(lightAt(9 + 5.4, 2, [soft])).toBeCloseTo((6 - 5.4) / 1.2, 9);
    expect(lightAt(9 + 6.2, 2, [soft])).toBe(0);
    const hard: LightEye = { ...soft, hard: true };
    expect(lightAt(9 + 5.4, 2, [hard])).toBe(1);
    // 여러 시야는 최댓값 (겹쳐도 더 밝아지지 않는다)
    expect(lightAt(9 + 5.4, 2, [soft, hard])).toBe(1);
  });

  it('벽 그림자 = 시야 다각형 경계: 벽 남쪽 면 표본은 내 눈이 그 면을 볼 때만 빛을 받고, 벽 너머(북쪽 면) 표본은 0', () => {
    // 벽 덩어리 (20–21, 8–11) 남쪽 (20.5, 13)에 선 눈
    const eye = { x: 20.5, y: 13 };
    const poly = survivorVisionPolygon(eye, 6);
    const e: LightEye = { poly, x: eye.x, y: eye.y, r: 6, inner: 4.8, hard: false };
    const s = { x: 0, y: 0 };
    edgeSample('s', 20, 11, s);
    expect(lightAt(s.x, s.y, [e])).toBeGreaterThan(0.5);
    edgeSample('n', 20, 8, s);
    expect(lightAt(s.x, s.y, [e])).toBe(0);
  });

  it('색: 빛 0 = 원래 색 × 하한 색 (빛 지도 곱하기와 같은 값), 빛 1 = 원래 색, 어둠 속 테두리 = 맵 그림 테두리 (시야 밖 2.5:1)', () => {
    const base = DEPTH_COLOR.wallFace;
    const dark = litColor(base, AMB_RGB, 0);
    expect(litColor(base, AMB_RGB, 1)).toBe(base);
    expect((dark >> 16) & 255).toBe(Math.round((((base >> 16) & 255) * AMB[0]) / 255));
    expect(rimColor(AMB_RGB, 0)).toBe(darkRim(AMB_RGB));
    expect(
      contrastRatio(rimColor(AMB_RGB, 0), litColor(DEPTH_COLOR.wallTop, AMB_RGB, DEPTH.topLight)),
    ).toBeGreaterThanOrEqual(2.5);
  });

  it('예약 색: 입체 색에 역할 4색 · #F8FAFC가 없다 (벽 등은 청록)', () => {
    const reserved = new Set<number>([...Object.values(ROLE), HIDDEN_SURVIVOR]);
    for (const [k, v] of Object.entries(DEPTH_COLOR)) expect(reserved.has(v), k).toBe(false);
  });

  it('벽 등: 빛 0(내 시야 밖)이면 시간에 따라 변하지 않고(R9), 빛이 있으면 깜빡임이 있다 — 시드 · 시계만의 결정적 값', () => {
    expect(WALL_LAMPS.length).toBeGreaterThan(4);
    for (const lamp of WALL_LAMPS.slice(0, 6)) {
      const dark = new Set<number>();
      const lit = new Set<number>();
      for (let t = 0; t < 30; t += 0.05) {
        dark.add(lampLevel(t, lamp.seed, 0));
        lit.add(Math.round(lampLevel(t, lamp.seed, 1) * 1e6));
      }
      expect([...dark]).toEqual([1]);
      expect(lit.size).toBeGreaterThan(5);
      expect(lampLevel(12.34, lamp.seed, 0.7)).toBe(lampLevel(12.34, lamp.seed, 0.7));
    }
    // 벽 등은 남쪽 면이 있는 띄운 벽 칸에만
    for (const l of WALL_LAMPS) {
      expect(raisedAt(l.i, l.j)).toBe(1);
      expect(raisedAt(l.i, l.j + 1)).toBe(0);
    }
  });

  it('네온은 맵 그림 네온 자리 중 띄운 벽 위의 것뿐이다', () => {
    expect(DEPTH_NEON.length).toBeGreaterThan(0);
    for (const n of DEPTH_NEON) {
      const j = Math.floor(n.face === 'front' ? n.y0 : (n.y0 + n.y1) / 2);
      expect(raisedAt(Math.floor(n.x0), j)).toBe(1);
    }
  });
});

describe('입체감 후처리 (등불 · 가라앉히기)는 어둡게만 하고 시야 밖 구조 2.5:1을 남긴다', () => {
  it('gradePixel · 등불 색은 화소를 밝히지 않는다 (시야 밖을 밝히지 않음)', () => {
    for (const look of LOOKS) {
      for (const m of [false, true]) for (const v of lanternWarm(look, m)) expect(v).toBeLessThanOrEqual(1);
      for (const c of [0x000000, 0x0b1117, 0x17212b, 0x8ba3ba, 0xffffff, 0x3b4e64])
        for (const k of [1, look.lanternMin]) {
          const g = gradePixel(c, k, look.crush);
          for (const sft of [16, 8, 0]) expect((g >> sft) & 255).toBeLessThanOrEqual((c >> sft) & 255);
        }
    }
  });

  it('R14: 등불이 가장 어둡게 한 자리(시야 반경 밖)에서도 어둠 속 테두리 / 바닥 대비 ≥ 2.5 (모든 시안, 비네트 밖)', () => {
    const rim = darkRim(AMB_RGB);
    for (const look of LOOKS)
      for (const k of [1, look.lanternMin])
        for (const f of [MAP_COLOR.floor, MAP_COLOR.floorHi]) {
          const ratio = contrastRatio(
            gradePixel(rim, k, look.crush),
            gradePixel(darkOf(f, AMB_RGB), k, look.crush),
          );
          expect(ratio, `${look.id} k=${k}`).toBeGreaterThanOrEqual(2.5);
        }
  });
});

describe('입체감: 괴물 화면 생존자 셋이 똑같다', () => {
  it('비스듬 그림자 오프셋은 시안 · 몸 반지름 두 인자만 받는다 — 역할 · 체력 · 능력 자리가 없다 (인자 수 · 같은 반지름이면 같은 값)', () => {
    expect(castOffset.length).toBe(2);
    for (const look of LOOKS) {
      const a = castOffset(look, 0.3);
      const b = castOffset(look, 0.3);
      expect(a).toEqual(b);
      expect(a.dx).toBeGreaterThan(0);
      expect(a.dy).toBeGreaterThan(0);
    }
  });
});

describe('입체감 설정 (gfx/depth)', () => {
  beforeEach(() => {
    resetDepthForTest();
    resetPrefsForTest();
  });

  it('기본 켬, 품질 높음 · 중간의 WebGL에서만 — 낮음 · Canvas 렌더러는 늘 끔 (지금 그대로)', () => {
    expect(PREF_DEFAULTS.depth3d).toBe(true);
    expect(activeDepthLook('high', 'webgl')).toBe('b');
    expect(activeDepthLook('medium', 'webgl')).toBe('b');
    expect(activeDepthLook('low', 'webgl')).toBeNull();
    expect(activeDepthLook('high', 'canvas')).toBeNull();
    expect(depthSupported('low', 'webgl')).toBe(false);
    setPref('depth3d', false);
    expect(activeDepthLook('high', 'webgl')).toBeNull();
  });

  it('주소 ?depth · ?depthLook가 설정보다 우선한다 (저장하지 않음), 모르는 값은 무시', () => {
    expect(parseDepthParam('0')).toBe(false);
    expect(parseDepthParam(' On ')).toBe(true);
    expect(parseDepthParam('2')).toBeNull();
    expect(parseDepthLook('C')).toBe('c');
    expect(parseDepthLook('d')).toBeNull();
    setPref('depth3d', false);
    initDepthUrl(true, 'a');
    expect(activeDepthLook('high', 'webgl')).toBe('a');
    initDepthUrl(false, null);
    setPref('depth3d', true);
    expect(activeDepthLook('high', 'webgl')).toBeNull();
    expect(activeDepthLook('low', 'webgl')).toBeNull();
  });
});
