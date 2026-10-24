// 안개 수식 (순수 함수: DOM · Phaser 없음).
//
// 빛 지도 한 칸의 값 L은 0~1이고 화면 색 = 바닥 색 × L(곱하기)이다.
//  - 시야 밖: L = 하한(ambient). 맵 구조가 어둡게 보인다
//  - 생존자 시야: 판정 반경 r 안쪽 soft 타일에서 1 → 하한으로 흐려진다 (r 밖은 정확히 하한)
//  - 괴물 부채꼴 · 근접 원: 판정과 같은 모양으로 딱 잘린다 (안은 1, 밖은 하한)
//
// 렌더러(fogPaint.ts LightMap)는 그라디언트 반지름을 softLightGeometry에서 받고, 경계 셰이더(fogGpu.ts)는
// FOG_EDGE_FRAG를 그대로 쓴다. 그래서 여기서 테스트한 식이 실제로 칠하는 식이다. 실제로 칠한 값(경로 · 반지름 ·
// 색 정지점 · 합성 모드)으로 '밝게 그린 곳 ⊆ 판정 영역'을 확인하는 테스트는 tests/unit/fog-paint.test.ts.
import { pointInPolygon, type Vec2 } from '@decoy/shared';
import type { QualityPreset, RendererKind } from '../gfx/presets';

/** 합성 배율 하한 (?scale 0.25와 같다) */
export const MIN_COMPOSITE_SCALE = 0.25;
/** 미니맵 캔버스 배율 상한 (작은 캔버스라 품질 상한 대신 고정 상한) */
export const MAX_MINIMAP_SCALE = 3;

/**
 * 생존자 시야 원의 흐림 띠 (타일). 안쪽 원 inner = r − soft에서 흰색, 바깥 원 outer = r에서 하한.
 * 빛 지도 그라디언트(fogPaint.ts LightMap.addSoft)와 lightAt이 같이 쓴다. outer는 판정 반경을 넘지 않는다.
 */
export function softLightGeometry(r: number, soft: number): { inner: number; outer: number } {
  return { inner: Math.max(0, r - Math.max(0, soft)), outer: r };
}

/**
 * 생존자 시야 원의 밝기. 캔버스 방사형 그라디언트(softLightGeometry: 안쪽 원에서 흰색 → 바깥 원에서 하한)와 같은 값.
 * r 밖(r 포함)은 정확히 ambient, r − soft 안쪽은 1, 사이는 선형으로 줄어든다.
 */
export function lightAt(dist: number, r: number, soft: number, ambient: number): number {
  const { inner, outer } = softLightGeometry(r, soft);
  if (!(dist < outer)) return ambient;
  if (dist <= inner) return 1;
  const t = (dist - inner) / (outer - inner);
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

/**
 * 따라가는 카메라의 바닥 합성 배율 (텍셀 / 논리 px). compositeScaleFor에 더해, 보이는 창 + 여유 + 조각 경계 한 줄(타일)을
 * 담는 텍셀 수가 품질 예산(texels)을 넘지 않게 자른다. worldScale = 논리 px / 월드 px, camZoom ≤ 1(맵 전체)이면 예산 없음
 */
export function cameraCompositeScale(
  zoom: number,
  cap: number,
  worldScale: number,
  camZoom: number,
  view: { w: number; h: number },
  margin: number,
  texels: number,
): number {
  const base = compositeScaleFor(zoom, cap);
  if (!(camZoom > 1)) return base;
  const area = (view.w + margin * 2 + 2) * (view.h + margin * 2 + 2);
  const perWorldPx = Math.sqrt(finitePositive(texels, 1) / area) / 32;
  return Math.max(MIN_COMPOSITE_SCALE, Math.min(base, perWorldPx / finitePositive(worldScale, 1)));
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

// ───────────── 내 빛 따라가기 (안개 주기 사이 내 시야를 지금 자리까지 옮겨 그린다) ─────────────
// 시야 빛 지도 · 틴트 · 테두리 · 먼지 잘라내기는 안개 주기(생존자 50ms · 괴물 1/30초)에만 다시 계산한다. 카메라가 따라가는 내 몸은
// 매 프레임 움직이므로, 그 사이 월드에 붙어 있던 내 둘레 빛 · 테두리가 화면에서 주기마다 톱니로 흔들렸다(걷기 5타일/초 × 50ms =
// 0.25타일, 1080p 확대 3에서 22px). 이제 안개 주기에 쓴 내 눈 자리(fogEye)와 지금 내 자리의 차이 Δ만큼 내 시야 그림만 옮긴다.
// 판정 · 정보(서버가 보내는 것)는 그대로다: 바뀌는 것은 맵 바닥을 얼마나 밝게 그리는가뿐이다.

/** Δ를 이보다 크게 옮기지 않는다 (타일). 걷기 0.25 · 질주 0.36 · 괴물 0.18보다 크고, 넘으면(순간이동 · 수감) 옮기지 않는다 */
export const FOLLOW_MAX = 0.5;

/** 빛 지도의 '내 덮임' 표시: 내 시야를 칠한 곳(반경 r + FOLLOW_MAX 다각형 전체)의 B 채널을 이만큼(0~255) 낮춰 칠한다 */
export const SELF_MARK = 8;

/** 셰이더가 '관측 밝기가 칠할 때의 내 빛으로 설명된다'고 보는 여유 (밝기 0~1: 빛 지도 쌍선형 보간 · 8비트 반올림) */
export const FOLLOW_EPS = 0.04;

/**
 * 이번 프레임 Δ (타일): 지금 내 자리 − 안개 주기에 쓴 내 눈 자리. 내 눈이 이번 주기에 없었으면(사망 · 탈출 · 관전 · 아직 없음),
 * 역할 · 상태가 주기 뒤 바뀌었으면(same = false), |Δ| > max면 0 (지금과 같은 그림). out에 써서 돌려준다.
 * 지금 자리 · 눈 자리가 모두 프레임 시각의 함수라 60 · 120Hz 같은 시각에 같은 값이다. Δ가 커도 안개 주기를 앞당기지 않는다
 */
export function followShift(
  now: Vec2 | null,
  eye: Vec2 | null,
  same: boolean,
  out: { x: number; y: number },
  max = FOLLOW_MAX,
): { x: number; y: number } {
  out.x = 0;
  out.y = 0;
  if (!now || !eye || !same) return out;
  const dx = now.x - eye.x;
  const dy = now.y - eye.y;
  if (!(Math.hypot(dx, dy) <= max)) return out;
  out.x = dx;
  out.y = dy;
  return out;
}

/**
 * 내 시야를 '내 덮임' 표시와 함께 칠하는 그라디언트 (빛 지도, GPU 경로만): 다각형은 반경 r + reach로 레이캐스트한 것이고,
 * 안쪽 원 r − soft에서 흰색, r(정지점 soft / (soft + reach))에서 하한, r + reach까지 하한. B 채널만 전체에서 mark만큼 낮다.
 * R · G는 예전 그라디언트(r − soft → r)와 같은 값이다(r 밖은 하한 그대로)
 */
export function selfMarkGradient(
  r: number,
  soft: number,
  reach: number,
  ambient: readonly [number, number, number],
  mark = SELF_MARK,
): { inner: number; outer: number; stops: [offset: number, css: string][] } {
  const { inner } = softLightGeometry(r, soft);
  const outer = r + Math.max(0, reach);
  const knee = outer > inner ? (r - inner) / (outer - inner) : 0;
  const lo = rgbCss([ambient[0], ambient[1], Math.max(0, ambient[2] - mark)]);
  return {
    inner,
    outer,
    stops: [
      [0, rgbCss([255, 255, 255 - mark])],
      [knee, lo],
      [1, lo],
    ],
  };
}

/** GLSL smoothstep과 같은 식 */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 셰이더 내 빛 따라가기 값 (fogGpu.ts FogEdgePipeline.follow와 같은 이름) */
export interface FollowUniforms {
  /** 빛 지도 바탕 (하한 × 틴트를 0~255로 반올림한 값 / 255) */
  lightAmb: readonly [number, number, number];
  /** 표시 크기 (B, 0~1) */
  mark: number;
  /** 빛 지도에 내 덮임 표시가 있다 (생존자 GPU) */
  selfOn: boolean;
  /** 칠할 때 내 눈 · 지금 내 눈 (= fogEye + Δ, 타일) · 판정 반경 · 흐림 띠 */
  eyeFog: Vec2;
  eyeNow: Vec2;
  r: number;
  soft: number;
  /** 괴물: 빛 지도 전체를 Δ만큼 옮겨 읽는다 */
  shiftOn: boolean;
  shift: Vec2;
}

/** 내 시야 밝기 곡선 (0~1): r − soft 안 1, r 밖 0, 사이 선형 (lightAt을 0~1로 편 것) */
function glow(p: Vec2, eye: Vec2, r: number, soft: number): number {
  return Math.max(0, Math.min(1, (r - Math.hypot(p.x - eye.x, p.y - eye.y)) / Math.max(soft, 1e-4)));
}

/**
 * 셰이더 followLight의 생존자 부분 (GLSL과 같은 식, 단위 시험용). tex = 점 p(타일)에서 읽은 빛 지도 rgb(0~1).
 * t_obs = G로 잰 관측 밝기, 기대 B = 하한B + (1 − 하한B)·t_obs, c = smoothstep(0.25, 0.75, (기대 B − B) / 표시) — 내 덮임 정도.
 * c = 0(표시 없음)이면 텍스처 그대로이되 B만 G가 말하는 값까지 올린다 — 팀원 빛 B가 내 표시를 일부 가린 칸(팀원 빛이 내 빛보다 조금
 * 어두운 겹친 곳)의 B를 되살린다(표시 없는 칸은 반올림 차이 ±1 안). 아니면 g(d) = clamp((r − d)/soft, 0, 1)로
 *   관측이 칠할 때의 내 빛으로 설명되면(t_obs ≤ g_fog + ε): t = clamp(t_obs + c·(g_now − g_fog), 0, 1) — Δ = 0이면 t = t_obs
 *   아니면(팀원 빛이 더 밝다): t = max(t_obs, c·g_now)
 * 그리고 rgb = 하한 + (1 − 하한)·t (채널마다). 밝아지는 곳은 c > 0(칠할 때 내 다각형 P(r + reach) 안)이고 g_now > 0(지금 자리 반경 r 안)뿐이다
 */
export function followTexel(
  tex: readonly [number, number, number],
  p: Vec2,
  u: FollowUniforms,
): [number, number, number] {
  if (!u.selfOn) return [tex[0], tex[1], tex[2]];
  const a = u.lightAmb;
  const tObs = Math.max(0, Math.min(1, (tex[1] - a[1]) / Math.max(0.001, 1 - a[1])));
  const expB = a[2] + (1 - a[2]) * tObs;
  const c = smoothstep(0.25, 0.75, (expB - tex[2]) / u.mark);
  if (c <= 0) return [tex[0], tex[1], Math.max(tex[2], expB)];
  const gFog = glow(p, u.eyeFog, u.r, u.soft);
  const gNow = glow(p, u.eyeNow, u.r, u.soft);
  const t =
    tObs <= gFog + FOLLOW_EPS ? Math.max(0, Math.min(1, tObs + c * (gNow - gFog))) : Math.max(tObs, c * gNow);
  return [a[0] + (1 - a[0]) * t, a[1] + (1 - a[1]) * t, a[2] + (1 - a[2]) * t];
}

/**
 * 셰이더 followLight의 괴물 부분: 점 p(타일)를 그릴 때 읽는 빛 지도 자리 (p − Δ). 맵 밖이면 null (하한)
 */
export function followSamplePoint(p: Vec2, u: FollowUniforms, mapW: number, mapH: number): Vec2 | null {
  if (!u.shiftOn) return p;
  const x = p.x - u.shift.x;
  const y = p.y - u.shift.y;
  if (x < 0 || y < 0 || x > mapW || y > mapH) return null;
  return { x, y };
}

/**
 * 경계 셰이더 GLSL (fogGpu.ts FogEdgePipeline이 그대로 쓴다. 여기 두는 것은 node 단위 테스트가 핵심 식을 확인하려고).
 * 빛 값 L(하한~1)에서 w = (L − 하한) / (1 − 하한), 띠 = 4w(1 − w)(경계 중간에서 최대, 양 끝 0).
 * 결과 = L − max(L − 하한, 0) × k, k = clamp(세기 × 띠 × 노이즈, 0, 1) → 항상 [하한, L] (edgeDarken과 같은 식).
 * 틴트 처리는 Phaser 기본 셰이더와 같다.
 * L은 텍스처 값이 아니라 followLight가 내 빛을 지금 자리까지 옮긴 값이다 (followTexel · followSamplePoint와 같은 식, uSelfOn ·
 * uShiftOn이 0이면 텍스처 그대로). 품질 중간은 같은 셰이더를 세기 0으로 쓴다(경계 노이즈 없음, 따라가기만)
 */
export const FOG_EDGE_FRAG = `
#define SHADER_NAME DECOY_FOG_EDGE_FS
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uTime;
uniform vec3 uAmbient;
uniform vec2 uMapSize;
uniform float uStrength;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform vec3 uLightAmb;
uniform float uMark;
uniform float uSelfOn;
uniform vec2 uEyeFog;
uniform vec2 uEyeNow;
uniform float uR;
uniform float uSoft;
uniform float uShiftOn;
uniform vec2 uShift;

varying vec2 outTexCoord;
varying float outTintEffect;
varying vec4 outTint;

float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float glow(vec2 p, vec2 eye)
{
    return clamp((uR - distance(p, eye)) / max(uSoft, 0.0001), 0.0, 1.0);
}

vec4 followLight(vec2 uv)
{
    if (uShiftOn > 0.5)
    {
        vec2 s = uv - uShift / uMapSize;
        if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) return vec4(uLightAmb, 1.0);
        return texture2D(uMainSampler, s);
    }
    vec4 tex = texture2D(uMainSampler, uv);
    if (uSelfOn < 0.5) return tex;
    vec3 a = uLightAmb;
    float tObs = clamp((tex.g - a.g) / max(0.001, 1.0 - a.g), 0.0, 1.0);
    float expB = a.b + (1.0 - a.b) * tObs;
    float c = smoothstep(0.25, 0.75, (expB - tex.b) / uMark);
    if (c <= 0.0) return vec4(tex.r, tex.g, max(tex.b, expB), tex.a);
    vec2 p = uv * uMapSize;
    float gFog = glow(p, uEyeFog);
    float gNow = glow(p, uEyeNow);
    float t = tObs <= gFog + ${FOLLOW_EPS.toFixed(4)} ? clamp(tObs + c * (gNow - gFog), 0.0, 1.0) : max(tObs, c * gNow);
    return vec4(a + (1.0 - a) * t, tex.a);
}

void main ()
{
    vec4 light = followLight(outTexCoord);
    vec3 amb = uAmbient;
    float span = max(0.001, 1.0 - amb.g);
    float w = clamp((light.g - amb.g) / span, 0.0, 1.0);
    float band = 4.0 * w * (1.0 - w);
    vec2 p = outTexCoord * uMapSize * uNoiseScale;
    float t = uTime * uNoiseSpeed;
    float n = 0.6 * noise(p + vec2(t, -0.7 * t)) + 0.4 * noise(p * 2.3 + vec2(-0.5 * t, t) + 7.0);
    float k = clamp(uStrength * band * n, 0.0, 1.0);
    vec3 rgb = light.rgb - max(light.rgb - amb, vec3(0.0)) * k;
    vec4 texel = vec4(outTint.bgr * outTint.a, outTint.a);
    gl_FragColor = vec4(rgb, light.a) * texel;
}
`;

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
 * 점 (px, py)가 다각형 안인가: @decoy/shared pointInPolygon과 같은 식 · 같은 순서(짝홀 규칙)를 좌표 숫자로 (임시 객체 없음).
 * 결과가 비트 단위로 같다 (tests/unit/render-alloc.test.ts)
 */
function insidePolyXY(px: number, py: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 경계 상자 밖 판정의 여유 (타일): 교차 x 계산의 반올림(몇 ulp)보다 훨씬 크고 조각 간격(0.1)보다 훨씬 작다 */
const BOX_EPS = 1e-9;

/**
 * 다각형들의 합집합 테두리를 선분으로 (괴물 화면: 부채꼴 ∪ 근접 원). 각 변을 step 타일 이하 조각으로 나눠
 * 다른 다각형 안에 들어간 조각을 뺀다. 판정 다각형 그대로라 빛 지도 해상도와 상관없이 경계가 딱 맞다.
 * 렌더링 최적화 2: 조각 가운데가 다른 다각형의 경계 상자(+ BOX_EPS) 밖이면 점-다각형 검사를 건너뛴다 — 상자 밖 점은 짝홀
 * 검사가 항상 '밖'이다(가로선이 닫힌 다각형을 짝수 번 가로지르고, 상자 왼쪽 밖이면 그 교차가 모두 오른쪽이다). 임시 객체 없이
 * 숫자로 재고, 끝점은 조각이 시작 · 끝나는 곳에서만 만든다. 결과는 예전 구현과 같다 (옛 구현과 대조하는 단위 테스트)
 */
export function unionOutline(polys: readonly (readonly Vec2[])[], step = 0.1): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  // 다각형마다 경계 상자 (꼭짓점 3개 미만은 '다른 다각형'에서 빠진다: 예전 filter와 같다)
  const m = polys.length;
  const box = new Float64Array(m * 4);
  for (let qi = 0; qi < m; qi += 1) {
    const q = polys[qi];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    if (q && q.length >= 3)
      for (const p of q) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
    box[qi * 4] = x0 - BOX_EPS;
    box[qi * 4 + 1] = y0 - BOX_EPS;
    box[qi * 4 + 2] = x1 + BOX_EPS;
    box[qi * 4 + 3] = y1 + BOX_EPS;
  }
  for (let pi = 0; pi < m; pi += 1) {
    const poly = polys[pi];
    if (!poly || poly.length < 3) continue;
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
        const mx = a.x + (b.x - a.x) * ((t0 + t1) / 2);
        const my = a.y + (b.y - a.y) * ((t0 + t1) / 2);
        let hidden = false;
        for (let qi = 0; qi < m && !hidden; qi += 1) {
          if (qi === pi) continue;
          const q = polys[qi];
          if (!q || q.length < 3) continue;
          const o = qi * 4;
          if (
            mx < (box[o] ?? 0) ||
            my < (box[o + 1] ?? 0) ||
            mx > (box[o + 2] ?? 0) ||
            my > (box[o + 3] ?? 0)
          )
            continue;
          hidden = insidePolyXY(mx, my, q);
        }
        if (!hidden && runStart === null) runStart = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
        if (hidden && runStart !== null) {
          out.push([runStart, { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }]);
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

/**
 * 생존자 화면 괴물 부채꼴 색 (노랑 0 ↔ 빨강 1)의 다음 값. 보이는 동안에는 노랑 → 빨강 0.1초, 빨강 → 노랑 0.4초로
 * 보간한다(VISUAL_SPEC 0장 ⑥ · 6.2). 괴물이 시야에 다시 들어온 첫 프레임(wasShown = false)은 지금 상태(seesSomeone)
 * 그대로다: 사라지기 전 색을 이어 가면 아무도 안 보는 괴물을 '발각 중'(빨강)으로 잘못 보여 준다(잔여 효과 규칙).
 */
export function nextConeRed(prev: number, wasShown: boolean, seesSomeone: boolean, frameMs: number): number {
  const target = seesSomeone ? 1 : 0;
  if (!wasShown) return target;
  const ms = Math.max(0, frameMs);
  if (target > prev) return Math.min(1, prev + ms / 100);
  // 목표와 같으면 그대로 (예전 식은 빨강 유지 중에도 1 → 0.96 → 1로 프레임마다 흔들렸다)
  if (target < prev) return Math.max(0, prev - ms / 400);
  return prev;
}

/**
 * 부채꼴 색을 바뀐 순간부터 잰다 (렌더링 최적화: 프레임 독립성). 예전에는 프레임마다 nextConeRed(prev, …, frameMs)를 더해
 * 상태가 바뀐 프레임 전체(바뀌기 전 시간까지)를 보간했다 → 60 · 120fps에서 바뀐 뒤 같은 시각의 색이 달랐다.
 * 이제 값 = nextConeRed(바뀐 순간 값, 보이는 중, 지금 상태, 바뀐 순간부터 지난 시간): 같은 보간 시간(0.1초 · 0.4초)의 닫힌 식이다
 */
export class ConeRedTrack {
  private from = 0;
  private at = 0;
  private sees = false;
  private shown = false;

  /**
   * 이번 프레임 값. shown = 괴물 부채꼴이 보이는가, flipAt = seesSomeone이 이번 프레임 사이에 바뀌었으면 그 순간(모르면 nowMs).
   * 다시 보인 첫 프레임은 지금 상태 그대로(잔여 효과 규칙), 안 보이면 0
   */
  update(shown: boolean, sees: boolean, nowMs: number, flipAt: number): number {
    if (!shown) {
      this.shown = false;
      return 0;
    }
    if (!this.shown) {
      this.shown = true;
      this.sees = sees;
      this.from = nextConeRed(0, false, sees, 0);
      this.at = nowMs;
      return this.from;
    }
    if (sees !== this.sees) {
      const t = Math.min(nowMs, Math.max(this.at, flipAt));
      this.from = nextConeRed(this.from, true, this.sees, t - this.at);
      this.at = t;
      this.sees = sees;
    }
    return nextConeRed(this.from, true, sees, nowMs - this.at);
  }
}

/** 갱신 주기 시계의 허용 오차 (ms): 프레임 시각이 정해진 시각보다 이만큼 이르면 그 프레임에 갱신한다 */
export const PHASE_TOLERANCE_MS = 1;

/**
 * 이보다 짧은 프레임(약 58fps 이상)이면 정해진 시각에 위상을 고정한다. 더 긴 프레임은 예전 판단(지난 갱신 프레임부터 한 주기)
 * 그대로다: 느린 기기에서 위상을 고정하면 프레임 배수로 맞추느라 예전보다 자주 다시 합성했다(45fps 생존자 화면 15Hz → 20Hz)
 */
export const PHASE_LOCK_FRAME_MS = 1000 / 58;

/**
 * 주기 갱신 시계 (안개 · 시야 갱신). 빠른 프레임(PHASE_LOCK_FRAME_MS 이하)에서는 정해진 시각(시작 + k × 주기)에 위상을 고정한다:
 * 프레임 시각이 다음 정해진 시각 − 1ms에 닿은 첫 프레임에 갱신하고, 마지막 갱신 시각은 프레임 시각이 아니라 정해진 시각으로
 * 둔다. 그래서 60 · 120 · 144fps 모두 같은 정해진 시각에 갱신한다(예전 '지난 갱신부터 50ms' 판단은 120fps에서 6 × 8.33 =
 * 49.99ms라 7프레임마다 = 58ms였다). 한 주기 넘게 밀렸으면(멈춤) 따라잡지 않고 지금으로 다시 맞춘다.
 * 느린 프레임에서는 예전처럼 지난 갱신 프레임부터 한 주기가 지났을 때 갱신하고 지금으로 다시 맞춘다 (비용이 예전보다 늘지 않게)
 */
export class PhaseClock {
  /** 마지막 갱신의 정해진 시각 (없으면 null) */
  last: number | null = null;
  /** 마지막으로 갱신한 프레임 시각 */
  private lastFrame = 0;
  /** 정해진 시각의 기준 (anchor, 없으면 첫 갱신 프레임) */
  private origin: number | null = null;

  /**
   * 정해진 시각의 기준을 정한다 (판 장면을 만든 순간 등 프레임과 무관한 시각). 첫 갱신은 그 뒤 첫 프레임에 하되 기준 + k × 주기
   * 격자에 둔다: 첫 프레임 시각이 fps마다 달라도 같은 시각에 갱신한다
   */
  anchor(t: number): void {
    this.origin = t;
  }

  /** 이 프레임에 갱신하는가 (갱신하면 last를 옮긴다). frameMs = 이번 프레임 간격 (모르면 0: 빠른 프레임으로 본다) */
  due(nowMs: number, periodMs: number, frameMs = 0): boolean {
    if (this.last === null) {
      const o = this.origin;
      this.last =
        o === null || nowMs < o
          ? nowMs
          : o + Math.floor((nowMs + PHASE_TOLERANCE_MS - o) / periodMs) * periodMs;
      this.lastFrame = nowMs;
      return true;
    }
    if (frameMs > PHASE_LOCK_FRAME_MS) {
      if (nowMs - this.lastFrame < periodMs) return false;
      this.last = nowMs;
      this.lastFrame = nowMs;
      return true;
    }
    const next = this.last + periodMs;
    if (nowMs < next - PHASE_TOLERANCE_MS) return false;
    this.last = nowMs - next >= periodMs - PHASE_TOLERANCE_MS ? nowMs : next;
    this.lastFrame = nowMs;
    return true;
  }

  reset(): void {
    this.last = null;
  }
}

/**
 * 시야 다각형 캐시 (M12 휴대폰 성능). 눈 이름(역할 · 'cone' · 'near')마다 마지막 입력(자리 x · y와 모양 값 a · b)과
 * 결과를 하나씩 둔다. 입력이 정확히 같으면 같은 다각형(같은 참조)을 돌려준다 — 결과는 계산한 것과 같고, 같은 참조라서
 * 안개 레이어가 빛 지도를 다시 칠하지 않아도 되는지 바로 안다. 다각형은 만든 뒤 바꾸지 않는다
 */
export class PolyCache {
  private readonly map = new Map<string, { x: number; y: number; a: number; b: number; poly: Vec2[] }>();
  /** 계산 횟수 (테스트 · 진단) */
  misses = 0;

  get(id: string, x: number, y: number, a: number, b: number, make: () => Vec2[]): Vec2[] {
    return this.peek(id, x, y, a, b) ?? this.put(id, x, y, a, b, make());
  }

  /** 입력이 정확히 같으면 지난 다각형, 아니면 null (프레임마다 부르는 쪽이 만들기 함수를 만들지 않게: peek ?? put) */
  peek(id: string, x: number, y: number, a: number, b: number): Vec2[] | null {
    const e = this.map.get(id);
    return e && e.x === x && e.y === y && e.a === a && e.b === b ? e.poly : null;
  }

  /** 새로 계산한 다각형을 넣고 그대로 돌려준다 (항목 객체는 다시 쓴다) */
  put(id: string, x: number, y: number, a: number, b: number, poly: Vec2[]): Vec2[] {
    this.misses += 1;
    const e = this.map.get(id);
    if (e) {
      e.x = x;
      e.y = y;
      e.a = a;
      e.b = b;
      e.poly = poly;
    } else this.map.set(id, { x, y, a, b, poly });
    return poly;
  }
}
