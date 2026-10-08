// 안개 수식 (순수 함수: DOM · Phaser 없음). 단위 테스트가 여기서 '밝게 그린 곳 ⊆ 판정 영역'을 확인한다.
//
// 빛 지도 한 칸의 값 L은 0~1이고 화면 색 = 바닥 색 × L(곱하기)이다.
//  - 시야 밖: L = 하한(ambient). 맵 구조가 어둡게 보인다
//  - 생존자 시야: 판정 반경 r 안쪽 soft 타일에서 1 → 하한으로 흐려진다 (r 밖은 정확히 하한)
//  - 괴물 부채꼴 · 근접 원: 판정과 같은 모양으로 딱 잘린다 (안은 1, 밖은 하한)
import { pointInPolygon, type Vec2 } from '@decoy/shared';
import type { QualityPreset, RendererKind } from '../gfx/presets';

/** 합성 배율 하한 (?scale 0.25와 같다) */
export const MIN_COMPOSITE_SCALE = 0.25;
/** 미니맵 캔버스 배율 상한 (작은 캔버스라 품질 상한 대신 고정 상한) */
export const MAX_MINIMAP_SCALE = 3;

/**
 * 생존자 시야 원의 밝기. 캔버스 방사형 그라디언트(안쪽 원 r − soft에서 흰색 → 바깥 원 r에서 하한)와 같은 값.
 * r 밖(r 포함)은 정확히 ambient, r − soft 안쪽은 1, 사이는 선형으로 줄어든다.
 */
export function lightAt(dist: number, r: number, soft: number, ambient: number): number {
  if (!(dist < r)) return ambient;
  const inner = Math.max(0, r - Math.max(0, soft));
  if (dist <= inner) return 1;
  const t = (dist - inner) / (r - inner);
  return 1 + (ambient - 1) * t;
}

/** 생존자 한 명의 시야가 점 p에 주는 밝기 (시야 다각형 = 벽에 잘린 원 안에서만 밝다) */
export function survivorLight(
  eye: Vec2,
  r: number,
  soft: number,
  ambient: number,
  poly: readonly Vec2[],
  p: Vec2,
): number {
  if (poly.length < 3 || !pointInPolygon(p, poly)) return ambient;
  return lightAt(Math.hypot(p.x - eye.x, p.y - eye.y), r, soft, ambient);
}

/** 딱 잘린 시야(괴물 부채꼴 · 근접 원)가 점 p에 주는 밝기 */
export function hardLight(polys: readonly (readonly Vec2[])[], ambient: number, p: Vec2): number {
  for (const poly of polys) if (poly.length >= 3 && pointInPolygon(p, poly)) return 1;
  return ambient;
}

/** 여러 시야를 합친 밝기: 빛 지도는 'lighten'(최댓값)으로 그려서 겹쳐도 더 밝아지지 않는다 */
export function combineLights(values: readonly number[], ambient: number): number {
  let v = ambient;
  for (const x of values) if (x > v) v = x;
  return v;
}

function finitePositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 바닥 합성 배율 (논리 px 대비). 백버퍼 배율(zoom)과 1:1로 맞추되 품질 상한(compositeCap)을 넘지 않는다.
 * Canvas2D 합성 비용이 픽셀 수에 비례하기 때문이다(1배 7ms, 2배 29ms).
 */
export function compositeScaleFor(zoom: number, cap: number): number {
  const z = finitePositive(zoom, 1);
  const c = finitePositive(cap, 1);
  return Math.max(MIN_COMPOSITE_SCALE, Math.min(z, c));
}

/** 미니맵 캔버스 배율: 백버퍼 배율과 1:1 (작아서 품질 상한 없이 고정 상한만) */
export function minimapScaleFor(zoom: number): number {
  return Math.max(MIN_COMPOSITE_SCALE, Math.min(finitePositive(zoom, 1), MAX_MINIMAP_SCALE));
}

/** 논리 좌표 v를 백버퍼 배율 zoom에서 기기 픽셀 정수에 맞춘다 (텍스처를 1:1로 찍어 재샘플이 없게) */
export function snapToDevice(v: number, zoom: number): number {
  const z = finitePositive(zoom, 1);
  return Math.round(v * z) / z;
}

export type FogMode = 'gpu' | 'canvas';

/**
 * 실제 안개 방식. GPU 합성과 경계 셰이더는 WebGL에서만 (Canvas 렌더러에서 셰이더 객체를 만들면 예외가 난다).
 * 렌더러는 품질 표가 아니라 실제 렌더러 종류를 넣는다.
 */
export function fogPathFor(
  preset: Pick<QualityPreset, 'fog' | 'fogShader'>,
  renderer: RendererKind,
): { mode: FogMode; shader: boolean } {
  const gpu = renderer === 'webgl' && preset.fog === 'gpu';
  return { mode: gpu ? 'gpu' : 'canvas', shader: gpu && preset.fogShader };
}

/**
 * 품질 높음 경계 셰이더의 계산 (GLSL과 같은 식). 빛 값 L(하한~1)의 중간 띠만 노이즈만큼 하한 쪽으로 끌어내린다.
 * 결과는 항상 [하한, L] 안이다: 어둡게만 하고, 시야 밖(L = 하한)과 완전히 밝은 곳(L = 1)은 그대로다.
 */
export function edgeDarken(light: number, ambient: number, strength: number, noise: number): number {
  const span = Math.max(1e-3, 1 - ambient);
  const w = Math.max(0, Math.min(1, (light - ambient) / span));
  const band = 4 * w * (1 - w);
  const k = Math.max(0, Math.min(1, strength * band * Math.max(0, Math.min(1, noise))));
  return light - (light - ambient) * k;
}

/** 하한 × 틴트 → 빛 지도 바탕 RGB (0~255 정수) */
export function ambientRgb(ambient: number, tint: number): [number, number, number] {
  const a = Math.max(0, Math.min(1, ambient));
  return [
    Math.round(((tint >> 16) & 255) * a),
    Math.round(((tint >> 8) & 255) * a),
    Math.round((tint & 255) * a),
  ];
}

export function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * 다각형들의 합집합 테두리를 선분으로 (괴물 화면: 부채꼴 ∪ 근접 원). 각 변을 step 타일 이하 조각으로 나눠
 * 다른 다각형 안에 들어간 조각을 뺀다. 판정 다각형 그대로라 빛 지도 해상도와 상관없이 경계가 딱 맞다.
 */
export function unionOutline(polys: readonly (readonly Vec2[])[], step = 0.1): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (let pi = 0; pi < polys.length; pi += 1) {
    const poly = polys[pi];
    if (!poly || poly.length < 3) continue;
    const others = polys.filter((q, qi) => qi !== pi && q.length >= 3);
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / step));
      let runStart: Vec2 | null = null;
      for (let k = 0; k < n; k += 1) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        const mid = { x: a.x + (b.x - a.x) * ((t0 + t1) / 2), y: a.y + (b.y - a.y) * ((t0 + t1) / 2) };
        const hidden = others.some((q) => pointInPolygon(mid, q));
        const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
        if (!hidden && runStart === null) runStart = p0;
        if (hidden && runStart !== null) {
          out.push([runStart, p0]);
          runStart = null;
        }
      }
      if (runStart !== null) out.push([runStart, { x: b.x, y: b.y }]);
    }
  }
  return out;
}

/**
 * 상대 쪽 잔여 효과 규칙: 상대에게서 나오는 효과(돌진 잔상 · 공격 준비 범위 · 기절 별 · 파티클)는
 * 이번 프레임 스냅샷에 그 출처가 있을 때만 그린다. 출처가 시야에서 사라지면 바로 없앤다.
 */
export function opponentFxAllowed(sourceInSnapshot: boolean): boolean {
  return sourceInSnapshot;
}
