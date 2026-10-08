import { describe, expect, it } from 'vitest';
import {
  MAP_H,
  MAP_W,
  blocksVision,
  inCircleVision,
  monsterConePolygon,
  monsterConeShape,
  monsterNearPolygon,
  monsterSees,
  pointInPolygon,
  survivorVisionPolygon,
  survivorVisionRadius,
  type RoleId,
  type Vec2,
} from '@decoy/shared';
import { PRESETS, effectivePreset } from '../../client/src/gfx/presets';
import { FOG } from '../../client/src/render/colors';
import {
  FOG_EDGE_FRAG,
  MAX_MINIMAP_SCALE,
  MIN_COMPOSITE_SCALE,
  ambientRgb,
  combineLights,
  compositeScaleFor,
  edgeDarken,
  fogPathFor,
  hardLight,
  lightAt,
  minimapScaleFor,
  nextConeRed,
  opponentFxAllowed,
  snapToDevice,
  softLightGeometry,
  survivorLight,
  unionOutline,
} from '../../client/src/render/fogMath';
import { loadTestBalance } from '../helpers/fixtures';

const b = loadTestBalance();
const AMB = FOG.ambient;

/** 재현 가능한 의사 난수 */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** 벽 · 기둥이 아닌 무작위 위치 (눈은 벽 안에 있을 수 없다) */
function openPoint(rnd: () => number): Vec2 {
  for (;;) {
    const p = { x: 1 + rnd() * (MAP_W - 2), y: 1 + rnd() * (MAP_H - 2) };
    if (!blocksVision(Math.floor(p.x), Math.floor(p.y))) return p;
  }
}

describe('안개 밝기 함수 lightAt (시야 밖 = 정확히 하한)', () => {
  const r = b.survivor.visionRadius;
  const soft = b.survivor.visionSoftEdge;

  it('판정 반경 r 밖(r 포함)은 정확히 하한', () => {
    for (const d of [r, r + 1e-9, r + 0.01, r + 3, 1000, Number.POSITIVE_INFINITY, Number.NaN])
      expect(lightAt(d, r, soft, AMB)).toBe(AMB);
  });

  it('r − soft 안쪽은 1 (원래 색)', () => {
    for (const d of [0, 1, r - soft - 0.5, r - soft]) expect(lightAt(d, r, soft, AMB)).toBe(1);
  });

  it('r − soft ~ r 사이는 하한과 1 사이에서 단조롭게 줄고 양 끝에서 이어진다', () => {
    let prev = lightAt(0, r, soft, AMB);
    for (let d = 0; d <= r + 1; d += 0.001) {
      const v = lightAt(d, r, soft, AMB);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(v).toBeGreaterThanOrEqual(AMB);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(lightAt(r - soft + 1e-6, r, soft, AMB)).toBeCloseTo(1, 4);
    expect(lightAt(r - 1e-6, r, soft, AMB)).toBeCloseTo(AMB, 4);
    expect(lightAt(r - soft / 2, r, soft, AMB)).toBeCloseTo((1 + AMB) / 2, 6);
  });

  it('soft가 0이면 딱 자르고, r보다 크면 중심부터 흐려진다', () => {
    expect(lightAt(r - 1e-6, r, 0, AMB)).toBe(1);
    expect(lightAt(r, r, 0, AMB)).toBe(AMB);
    expect(lightAt(0, 2, 5, AMB)).toBe(1);
    expect(lightAt(1, 2, 5, AMB)).toBeCloseTo((1 + AMB) / 2, 6);
  });

  it('흐림 띠 모양: 바깥 반지름 = 판정 반경, 안쪽 = r − soft (빛 지도 그라디언트와 lightAt이 같이 쓴다)', () => {
    expect(softLightGeometry(r, soft)).toEqual({ inner: r - soft, outer: r });
    expect(softLightGeometry(7.5, 1.2).outer).toBe(7.5);
    expect(softLightGeometry(2, 5)).toEqual({ inner: 0, outer: 2 });
    expect(softLightGeometry(6, 0)).toEqual({ inner: 6, outer: 6 });
    expect(softLightGeometry(6, -1)).toEqual({ inner: 6, outer: 6 });
    // lightAt은 이 띠 그대로: 안쪽 원 = 1, 바깥 원 = 하한
    const g = softLightGeometry(r, soft);
    expect(lightAt(g.inner, r, soft, AMB)).toBe(1);
    expect(lightAt(g.outer, r, soft, AMB)).toBe(AMB);
  });

  it('여러 시야는 최댓값으로 합친다 (겹쳐도 더 밝아지지 않음)', () => {
    expect(combineLights([], AMB)).toBe(AMB);
    expect(combineLights([0.7, 1, 0.5], AMB)).toBe(1);
    expect(combineLights([AMB, AMB], AMB)).toBe(AMB);
  });
});

// 수식(모델) 쪽. 렌더러가 실제로 칠한 값으로 같은 성질을 보는 테스트는 fog-paint.test.ts
describe('밝게 그린 곳 ⊆ 판정 영역 — 수식 (무작위 점 1만 개, shared 판정 함수 그대로)', () => {
  it('생존자: 밝기가 하한보다 높으면 inCircleVision이 참', () => {
    const rnd = rng(20261008);
    const roles: RoleId[] = ['runner', 'guard', 'scout'];
    let checked = 0;
    let lit = 0;
    let violations = 0;
    for (let e = 0; e < 200; e += 1) {
      const eye = openPoint(rnd);
      const role = roles[e % 3] ?? 'runner';
      const r = survivorVisionRadius(b, role);
      const poly = survivorVisionPolygon(eye, r);
      for (let i = 0; i < 50; i += 1) {
        const p = { x: eye.x + (rnd() * 2 - 1) * (r + 1), y: eye.y + (rnd() * 2 - 1) * (r + 1) };
        checked += 1;
        const v = survivorLight(eye, r, b.survivor.visionSoftEdge, AMB, poly, p);
        if (v > AMB) {
          lit += 1;
          if (!inCircleVision(eye, r, p)) violations += 1;
        } else {
          expect(v).toBe(AMB);
        }
      }
    }
    expect(checked).toBe(10_000);
    // 빈 통과가 아님: 상당수가 실제로 밝다
    expect(lit).toBeGreaterThan(2_000);
    expect(violations).toBe(0);
  });

  it('괴물: 부채꼴 ∪ 근접 원이 밝으면 monsterSees가 참 (탐색 · 추적 · 전환 중)', () => {
    const rnd = rng(77);
    let checked = 0;
    let lit = 0;
    let violations = 0;
    for (let e = 0; e < 200; e += 1) {
      const eye = openPoint(rnd);
      const aim = (rnd() * 2 - 1) * Math.PI;
      const blend = [0, 1, 0.5, rnd()][e % 4] ?? 0;
      const polys = [monsterConePolygon(b, eye, aim, blend), monsterNearPolygon(b, eye)];
      const shape = monsterConeShape(b, blend);
      for (let i = 0; i < 50; i += 1) {
        // 절반은 부채꼴 근처(경계 바깥 10°, 1타일까지), 절반은 주변 전체
        let p: Vec2;
        if (i % 2 === 0) {
          const a = aim + (rnd() * 2 - 1) * (shape.arc / 2 + 0.17);
          const d = rnd() * (shape.range + 1);
          p = { x: eye.x + Math.cos(a) * d, y: eye.y + Math.sin(a) * d };
        } else {
          p = { x: eye.x + (rnd() * 2 - 1) * 10, y: eye.y + (rnd() * 2 - 1) * 10 };
        }
        checked += 1;
        const v = hardLight(polys, AMB, p);
        if (v > AMB) {
          lit += 1;
          if (!monsterSees(b, eye, aim, blend, p)) violations += 1;
        } else {
          expect(v).toBe(AMB);
        }
      }
    }
    expect(checked).toBe(10_000);
    expect(lit).toBeGreaterThan(2_000);
    expect(violations).toBe(0);
  });
});

describe('합성 배율 · 미니맵 배율', () => {
  it('합성 배율 = min(백버퍼 배율, 품질 상한)', () => {
    const table: [zoom: number, cap: number, expected: number][] = [
      [1, 1, 1],
      [1, 2, 1],
      [2, 1, 1],
      [2, 2, 2],
      [3, 2, 2],
      [1.5, 2, 1.5],
      [2, 1.5, 1.5],
      [1.25, 2, 1.25],
      [0.5, 2, 0.5],
      [0.5, 1, 0.5],
      [0.1, 1, MIN_COMPOSITE_SCALE],
      [0, 2, 1],
      [Number.NaN, 2, 1],
      [-1, 2, 1],
      [2, Number.NaN, 1],
    ];
    for (const [zoom, cap, expected] of table) expect(compositeScaleFor(zoom, cap)).toBe(expected);
  });

  it('품질 표의 상한을 따른다 (Canvas 렌더러는 1배 이하)', () => {
    expect(compositeScaleFor(2, PRESETS.high.compositeCap)).toBe(2);
    expect(compositeScaleFor(2, PRESETS.medium.compositeCap)).toBe(1.5);
    expect(compositeScaleFor(2, PRESETS.low.compositeCap)).toBe(1);
    expect(compositeScaleFor(2, effectivePreset('high', 'canvas').compositeCap)).toBe(1);
  });

  it('미니맵 배율 = 백버퍼 배율 (고정 상한)', () => {
    const table: [number, number][] = [
      [1, 1],
      [1.5, 1.5],
      [2, 2],
      [0.5, 0.5],
      [5, MAX_MINIMAP_SCALE],
      [0, 1],
      [Number.NaN, 1],
    ];
    for (const [zoom, expected] of table) expect(minimapScaleFor(zoom)).toBe(expected);
  });

  it('이미지 위치를 기기 픽셀 정수에 맞춘다', () => {
    for (const z of [1, 1.25, 1.5, 2, 0.5]) {
      for (const v of [246, 64, 307.3]) {
        const s = snapToDevice(v, z);
        expect(Math.abs(s * z - Math.round(s * z))).toBeLessThan(1e-9);
        expect(Math.abs(s - v)).toBeLessThanOrEqual(0.5 / z + 1e-9);
      }
    }
  });
});

describe('안개 방식 선택', () => {
  it('GPU 합성 · 경계 셰이더는 WebGL에서만', () => {
    expect(fogPathFor(PRESETS.high, 'webgl')).toEqual({ mode: 'gpu', shader: true });
    expect(fogPathFor(PRESETS.medium, 'webgl')).toEqual({ mode: 'gpu', shader: false });
    expect(fogPathFor(PRESETS.low, 'webgl')).toEqual({ mode: 'canvas', shader: false });
    for (const t of ['high', 'medium', 'low'] as const) {
      // 품질 표가 GPU라고 해도 실제 렌더러가 Canvas면 Canvas 합성 · 셰이더 없음
      expect(fogPathFor(PRESETS[t], 'canvas')).toEqual({ mode: 'canvas', shader: false });
      expect(fogPathFor(effectivePreset(t, 'canvas'), 'canvas')).toEqual({ mode: 'canvas', shader: false });
    }
  });
});

describe('경계 셰이더 식 (어둡게만)', () => {
  it('결과는 항상 [하한, L] 안이고, 시야 밖(하한) · 완전히 밝은 곳(1)은 그대로', () => {
    const rnd = rng(5);
    for (let i = 0; i < 10_000; i += 1) {
      const light = AMB + rnd() * (1 - AMB);
      const v = edgeDarken(light, AMB, FOG.edgeDarken, rnd());
      expect(v).toBeGreaterThanOrEqual(AMB - 1e-12);
      expect(v).toBeLessThanOrEqual(light + 1e-12);
    }
    for (const n of [0, 0.5, 1]) {
      expect(edgeDarken(AMB, AMB, FOG.edgeDarken, n)).toBe(AMB);
      expect(edgeDarken(1, AMB, FOG.edgeDarken, n)).toBe(1);
    }
    // 띠 가운데는 노이즈만큼 어두워진다
    const mid = (1 + AMB) / 2;
    expect(edgeDarken(mid, AMB, FOG.edgeDarken, 1)).toBeLessThan(mid);
  });
});

describe('경계 셰이더 GLSL 소스 (fogGpu.ts가 그대로 쓰는 FOG_EDGE_FRAG)', () => {
  const src = FOG_EDGE_FRAG.replace(/\s+/g, ' ');
  const has = (line: string): boolean => src.includes(line.replace(/\s+/g, ' '));

  it('핵심 식이 edgeDarken과 같다: 띠 = 4w(1 − w), k = clamp(세기 × 띠 × 노이즈, 0, 1)', () => {
    expect(has('float span = max(0.001, 1.0 - amb.g);')).toBe(true);
    expect(has('float w = clamp((light.g - amb.g) / span, 0.0, 1.0);')).toBe(true);
    expect(has('float band = 4.0 * w * (1.0 - w);')).toBe(true);
    expect(has('float k = clamp(uStrength * band * n, 0.0, 1.0);')).toBe(true);
    // 노이즈는 [0, 1) 값 두 개의 가중 평균(0.6 + 0.4 = 1)이라 [0, 1)
    expect(has('float n = 0.6 * noise(')).toBe(true);
    expect(has('+ 0.4 * noise(')).toBe(true);
    expect(has('return fract(')).toBe(true);
  });

  it('어둡게만: 결과 = L − max(L − 하한, 0) × k (k ∈ [0, 1]이라 [하한, L] 안), 다른 곳에서 색을 바꾸지 않는다', () => {
    expect(has('vec3 rgb = light.rgb - max(light.rgb - amb, vec3(0.0)) * k;')).toBe(true);
    expect(has('gl_FragColor = vec4(rgb, light.a) * texel;')).toBe(true);
    // rgb · gl_FragColor는 한 번씩만 쓴다 (뒤에서 더하거나 곱하면 하한 · L 범위가 깨질 수 있다)
    expect(src.match(/\brgb\s*[-+*/]?=/g)).toHaveLength(1);
    expect(src.match(/gl_FragColor\s*[-+*/]?=/g)).toHaveLength(1);
    // 하한 = Phaser 기본 셰이더와 같은 틴트 처리 (틴트가 흰색이면 그대로)
    expect(has('vec4 texel = vec4(outTint.bgr * outTint.a, outTint.a);')).toBe(true);
  });
});

describe('하한 색', () => {
  it('0.45 × #A8C4E0 = rgb(76, 88, 101): 빨강을 더 줄여 차갑다', () => {
    expect(ambientRgb(0.45, 0xa8c4e0)).toEqual([76, 88, 101]);
    expect(ambientRgb(FOG.ambient, FOG.tint)).toEqual([76, 88, 101]);
    expect(ambientRgb(0, 0xffffff)).toEqual([0, 0, 0]);
    expect(ambientRgb(2, 0x808080)).toEqual([128, 128, 128]);
  });
});

describe('괴물 화면 자기 시야 테두리 (부채꼴 ∪ 근접 원)', () => {
  const sq = (x: number, y: number, s: number): Vec2[] => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  const length = (segs: [Vec2, Vec2][]): number =>
    segs.reduce((a, [p, q]) => a + Math.hypot(q.x - p.x, q.y - p.y), 0);

  it('떨어진 두 도형은 둘레를 모두 긋는다', () => {
    expect(length(unionOutline([sq(0, 0, 1), sq(5, 5, 2)]))).toBeCloseTo(12, 6);
  });

  it('안에 들어간 도형의 선은 빼고, 겹친 부분은 합집합 경계만 남는다', () => {
    expect(length(unionOutline([sq(0, 0, 4), sq(1, 1, 1)]))).toBeCloseTo(16, 6);
    // 2×2 두 개가 1만큼 겹침 → 합집합 둘레 = 2 × (3 + 2) = 10 (조각 0.1 단위 근사)
    expect(length(unionOutline([sq(0, 0, 2), sq(1, 0, 2)], 0.05))).toBeCloseTo(10, 1);
  });

  it('실제 판정 다각형: 테두리 위 점은 다른 다각형 안에 있지 않다', () => {
    const eye = { x: 24, y: 20.5 };
    const cone = monsterConePolygon(b, eye, -Math.PI / 2, 0);
    const near = monsterNearPolygon(b, eye);
    const segs = unionOutline([cone, near]);
    expect(segs.length).toBeGreaterThan(10);
    for (const [p, q] of segs) {
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const inCone = pointInPolygon(mid, cone);
      const inNear = pointInPolygon(mid, near);
      expect(inCone && inNear).toBe(false);
    }
  });
});

describe('상대 쪽 잔여 효과 규칙', () => {
  it('출처(상대)가 이번 스냅샷에 없으면 상대 효과를 그리지 않는다', () => {
    expect(opponentFxAllowed(false)).toBe(false);
    expect(opponentFxAllowed(true)).toBe(true);
  });

  it('괴물 부채꼴 색: 시야에 다시 들어온 첫 프레임은 지금 상태(seesSomeone) 그대로', () => {
    // 사라지기 전 빨강(1)이었어도, 아무도 안 보며 다시 나타나면 첫 프레임부터 노랑(0)
    expect(nextConeRed(1, false, false, 16)).toBe(0);
    expect(nextConeRed(0, false, true, 16)).toBe(1);
    expect(nextConeRed(0.5, false, false, 0)).toBe(0);
  });

  it('괴물 부채꼴 색: 보이는 동안에는 노랑 → 빨강 0.1초, 빨강 → 노랑 0.4초', () => {
    expect(nextConeRed(0, true, true, 50)).toBeCloseTo(0.5, 9);
    expect(nextConeRed(0.5, true, true, 60)).toBe(1);
    expect(nextConeRed(1, true, false, 100)).toBeCloseTo(0.75, 9);
    expect(nextConeRed(0.1, true, false, 100)).toBe(0);
    expect(nextConeRed(0, true, false, 16)).toBe(0);
    expect(nextConeRed(1, true, true, 16)).toBe(1);
    // 시간이 거꾸로 가도 범위를 벗어나지 않는다
    expect(nextConeRed(0.5, true, true, -100)).toBe(0.5);
    // 0.4초 동안 프레임마다 내려가면 끝에 정확히 0
    let v = 1;
    for (let i = 0; i < 25; i += 1) v = nextConeRed(v, true, false, 16);
    expect(v).toBe(0);
  });
});
