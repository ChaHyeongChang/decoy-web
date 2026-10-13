// 캐릭터 실루엣 · 문양의 원본 (M10b, VISUAL_SPEC 4장). 월드 · HUD · 로비 · 미니맵이 함께 쓴다.
//
// 모든 모양은 다각형 점 목록이다(호는 잘게 편다). 단위는 몸 반지름 1(생존자 = balance survivor.radius,
// 괴물 = monster.radius), 원점 = 몸 중심, +x = 바라보는 방향, +y = 화면 아래. 같은 점 목록에서
// Canvas2D 경로(traceShape) · SVG path 문자열(svgPath)을 만들고, 노드 단위 테스트는 점-다각형 판정으로
// 래스터화해 겹침(IoU)을 잰다(shapeMask). DOM · Phaser를 쓰지 않는다.
//
// 형태 문법: 생존자 = 둥근 형태(같은 몸 원 + 역할 소품), 괴물 = 뾰족한 형태(톱니 망토 · 발톱).
// 생존자 셋은 같은 몸 원(반지름 1)을 공유하고 앞 돌출은 FRONT_REACH_MAX(1.55) 이내라서 역할마다 '커 보이는' 차이가 없다.
// 괴물 화면의 생존자는 하나의 공통 실루엣(원 + 노치)이고 문양이 없다(흰색 위장, R7).
import { pointInPolygon, type Vec2 } from '@decoy/shared';

export type Poly = readonly Vec2[];

/** 모양 = 바깥 실루엣(다각형 합집합) + 몸 위 어두운 문양(실루엣 안) */
export interface Shape {
  readonly outline: readonly Poly[];
  readonly marks: readonly Poly[];
}

export type SurvivorShapeId = 'runner' | 'guard' | 'scout' | 'hidden';

/** 앞 돌출 한도 (몸 반지름 배수, 지금 노치 범위) */
export const FRONT_REACH_MAX = 1.55;
/** 몸 원 반지름 (모든 생존자 공통, 판정 반지름) */
export const BODY_R = 1;

const TAU = Math.PI * 2;

function pt(x: number, y: number): Vec2 {
  return { x, y };
}

/** 원호 점들 (a0 → a1, 양 끝 포함). 기본 분할은 호 길이 기준 */
export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n?: number): Vec2[] {
  const steps = n ?? Math.max(4, Math.ceil((Math.abs(a1 - a0) / TAU) * 64));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push(pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

export function circlePoly(cx: number, cy: number, r: number, n = 48): Vec2[] {
  return arcPts(cx, cy, r, 0, TAU, n).slice(0, n);
}

/** 3차 베지어 점들 (p0 제외, p3 포함) */
function bezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    out.push(
      pt(
        u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      ),
    );
  }
  return out;
}

/** 굵은 선 한 토막 → 사각형 다각형 (끝을 반 두께만큼 늘려 이음매가 비지 않게) */
export function strokeSeg(a: Vec2, b: Vec2, width: number): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const h = width / 2;
  const ax = a.x - ux * h * 0.5;
  const ay = a.y - uy * h * 0.5;
  const bx = b.x + ux * h * 0.5;
  const by = b.y + uy * h * 0.5;
  return [
    pt(ax - uy * h, ay + ux * h),
    pt(bx - uy * h, by + ux * h),
    pt(bx + uy * h, by - ux * h),
    pt(ax + uy * h, ay - ux * h),
  ];
}

/** 굵은 꺾은선 (각 토막 사각형 + 꺾인 곳 둥근 이음) */
export function strokePolyline(pts: readonly Vec2[], width: number): Vec2[][] {
  const out: Vec2[][] = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a && b) out.push(strokeSeg(a, b, width));
  }
  for (let i = 1; i + 1 < pts.length; i += 1) {
    const p = pts[i];
    if (p) out.push(circlePoly(p.x, p.y, width / 2, 12));
  }
  return out;
}

/** 고리 (두 원 사이) → 바깥 · 안쪽 경계를 이은 한 다각형 (짝홀 규칙에서 구멍이 된다) */
function ringPoly(cx: number, cy: number, r0: number, r1: number, n = 48): Vec2[] {
  const outer = arcPts(cx, cy, r1, 0, TAU, n);
  const inner = arcPts(cx, cy, r0, TAU, 0, n);
  return [...outer, ...inner];
}

// ───────────────────────── 생존자 ─────────────────────────

/** 러너: 앞이 뾰족한 물방울(뒤는 몸 원) + 등의 » 두 줄 */
function runnerShape(): Shape {
  const tip = pt(1.55, 0);
  const top = pt(0, -1);
  const bottom = pt(0, 1);
  const outline: Vec2[] = [
    ...arcPts(0, 0, 1, Math.PI / 2, (Math.PI * 3) / 2, 32),
    ...bezier(top, pt(0.62, -1.0), pt(1.05, -0.5), tip, 14),
    ...bezier(tip, pt(1.05, 0.5), pt(0.62, 1.0), bottom, 14).slice(0, -1),
  ];
  // » 두 줄: 앞쪽을 가리키는 갈매기 (몸 중심 0.45 원판은 거의 비운다 — 생존자 화면 역할색 유지)
  const w = 0.22;
  const chevron = (ax: number, reach: number, half: number): Vec2[][] =>
    strokePolyline([pt(ax - reach, -half), pt(ax, 0), pt(ax - reach, half)], w);
  return { outline: [outline], marks: [...chevron(-0.34, 0.34, 0.56), ...chevron(-0.7, 0.26, 0.42)] };
}

/** 가드: 몸 원 + 앞쪽 초승달 방패 + 등의 십자 표식 */
function guardShape(): Shape {
  const half = 1.08; // 방패 반각 (라디안)
  const outer = arcPts(0, 0, 1.5, -half, half, 24);
  const inner = arcPts(0.06, 0, 1.12, half - 0.08, -(half - 0.08), 24);
  const shield = [...outer, ...inner];
  const cross = [
    ...strokePolyline([pt(-0.84, 0), pt(-0.4, 0)], 0.2),
    ...strokePolyline([pt(-0.62, -0.24), pt(-0.62, 0.24)], 0.2),
  ];
  return { outline: [circlePoly(0, 0, 1), shield], marks: cross };
}

/** 스카우트: 원 + 렌즈 고리(몸 둘레 안쪽 고리) + 앞쪽 사각 렌즈(어두운 유리) */
function scoutShape(): Shape {
  const housing = [pt(0.6, -0.42), pt(1.44, -0.42), pt(1.44, 0.42), pt(0.6, 0.42)];
  return {
    outline: [circlePoly(0, 0, 1), housing],
    marks: [ringPoly(0, 0, 0.6, 0.76), circlePoly(1.1, 0, 0.2, 20)],
  };
}

/** 괴물 화면 공통 생존자: 원 + 앞 노치 (지금 모양). 문양 없음 */
function hiddenShape(): Shape {
  return { outline: [circlePoly(0, 0, 1), [pt(1.5, 0), pt(0.86, 0.44), pt(0.86, -0.44)]], marks: [] };
}

export const SURVIVOR_SHAPES: Readonly<Record<SurvivorShapeId, Shape>> = {
  runner: runnerShape(),
  guard: guardShape(),
  scout: scoutShape(),
  hidden: hiddenShape(),
};

// ───────────────────────── 괴물 ─────────────────────────

/** 괴물 망토 자세 (장식 애니메이션 값, 판정과 무관) */
export interface CloakPose {
  /** 자락 물결 위상 (라디안) */
  phase: number;
  /** 물결 크기 0~1 (대기 0.35, 걷기 1) */
  sway: number;
  /** 뒤로 늘어남 0~1 (돌진) */
  stretch: number;
  /** 처짐 0~1 (기절) */
  droop: number;
}

export const CLOAK_REST: CloakPose = { phase: 0, sway: 0.35, stretch: 0, droop: 0 };

/** 자락 톱니 수 */
export const CLOAK_TAILS = 5;

/**
 * 위에서 본 망토: 앞은 둥근 후드, 어깨가 가장 넓고, 뒤 자락은 5갈래 톱니. 반지름 ≈ 1(괴물 판정 반지름),
 * 자락 끝은 1.1 이내(돌진 때만 1.3까지 늘어난다). 촉수 없음
 */
export function cloakOutline(p: CloakPose): Vec2[] {
  const out: Vec2[] = [];
  const back = Math.PI;
  // 앞 후드 (−95° ~ 95°): 앞이 살짝 납작한 둥근 모양
  for (let i = 0; i <= 20; i += 1) {
    const a = -1.66 + (3.32 * i) / 20;
    const r = 0.86 + 0.08 * Math.cos(a) ** 2 - 0.04 * p.droop;
    out.push(pt(Math.cos(a) * r, Math.sin(a) * r * (1 - 0.04 * p.stretch)));
  }
  // 뒤 자락: 어깨(±100°)에서 톱니 5개
  const span = 2.4 - 0.5 * p.stretch; // 자락이 펼쳐진 각도 (돌진하면 모인다)
  const start = back - span / 2;
  const teeth = CLOAK_TAILS;
  const pts: Vec2[] = [];
  for (let k = 0; k <= teeth * 2; k += 1) {
    const t = k / (teeth * 2);
    let a = start + span * t;
    const isTip = k % 2 === 1;
    const idx = (k - 1) / 2;
    let r: number;
    if (isTip) {
      const wave = Math.sin(p.phase + idx * 1.25);
      const centre = 1 - Math.abs(idx - (teeth - 1) / 2) / teeth;
      a += 0.07 * p.sway * wave;
      r =
        1.03 +
        0.05 * centre +
        0.04 * p.sway * Math.cos(p.phase + idx * 1.25) +
        0.25 * p.stretch -
        0.1 * p.droop;
    } else {
      r = k === 0 || k === teeth * 2 ? 0.95 : 0.85 + 0.03 * Math.sin(p.phase + k) * p.sway - 0.05 * p.droop;
    }
    pts.push(pt(Math.cos(a) * r, Math.sin(a) * r * (1 - 0.12 * p.stretch)));
  }
  // 어깨 → 자락 (위쪽 어깨에서 시작해 아래쪽 어깨로)
  const shoulderA = pt(Math.cos(1.66) * 0.92, Math.sin(1.66) * 0.92);
  out.push(shoulderA);
  for (const q of pts) out.push(q);
  return out;
}

/** cloakOutline 점 목록에서 뒤 자락(어깨 → 톱니 → 어깨)이 시작하는 번호 */
export const CLOAK_TAIL_START = 22;

/**
 * 앞 발톱 하나 (아래쪽 side = 1, 위쪽은 y를 뒤집어 쓴다): 원점 = 발톱 뿌리(망토 앞 가장자리), +x = 앞.
 * 끝이 안쪽으로 휘는 갈고리. 뿌리는 CLAW_ANCHOR, 바깥으로 CLAW_SPREAD만큼 벌어져 망토 위에 얹힌다
 */
export function clawPoly(): Vec2[] {
  return [
    pt(-0.05, -0.1),
    pt(0.18, -0.12),
    pt(0.33, -0.09),
    pt(0.43, -0.02),
    pt(0.29, -0.01),
    pt(0.14, 0.06),
    pt(-0.05, 0.1),
  ];
}

/** 발톱 뿌리 (몸 기준, 아래쪽) · 바깥으로 벌어진 각도 (라디안) */
export const CLAW_ANCHOR = { x: 0.64, y: 0.44 } as const;
export const CLAW_SPREAD = 0.38;

/** 얼굴 (어두운 타원)과 눈 위치 */
export const MONSTER_FACE = {
  cx: 0.6,
  cy: 0,
  rx: 0.17,
  ry: 0.3,
  eyeX: 0.665,
  eyeY: 0.12,
  eyeR: 0.064,
} as const;

// ───────────────────────── 아이콘 (HUD · 로비 · 머리 위 노출 표시) ─────────────────────────
// 단위 상자 [−1, 1]², +y 아래. 정면에서 본 그림이라 방향이 없다

export type GlyphId = 'runner' | 'guard' | 'scout' | 'monster';

function runnerGlyph(): Shape {
  const w = 0.34;
  return {
    outline: [
      ...strokePolyline([pt(-0.78, -0.7), pt(-0.08, 0), pt(-0.78, 0.7)], w),
      ...strokePolyline([pt(0.08, -0.7), pt(0.78, 0), pt(0.08, 0.7)], w),
    ],
    marks: [],
  };
}

function guardGlyph(): Shape {
  // 방패 (위는 평평, 아래는 뾰족) + 십자
  const shield: Vec2[] = [
    pt(-0.78, -0.86),
    pt(0.78, -0.86),
    pt(0.78, -0.1),
    ...bezier(pt(0.78, -0.1), pt(0.72, 0.42), pt(0.3, 0.74), pt(0, 0.92), 10),
    ...bezier(pt(0, 0.92), pt(-0.3, 0.74), pt(-0.72, 0.42), pt(-0.78, -0.1), 10),
  ];
  return {
    outline: [shield],
    marks: [
      ...strokePolyline([pt(-0.42, -0.2), pt(0.42, -0.2)], 0.24),
      ...strokePolyline([pt(0, -0.62), pt(0, 0.46)], 0.24),
    ],
  };
}

function scoutGlyph(): Shape {
  return {
    outline: [
      circlePoly(-0.12, 0.08, 0.82, 40),
      [pt(0.48, -0.94), pt(0.96, -0.94), pt(0.96, -0.46), pt(0.48, -0.46)],
    ],
    marks: [ringPoly(-0.12, 0.08, 0.36, 0.56), circlePoly(-0.12, 0.08, 0.14, 16)],
  };
}

function monsterGlyph(): Shape {
  // 정면 후드 (둥근 삼각형) + 어두운 얼굴 + 두 눈 (눈은 문양 안의 빈칸이 아니라 따로 그린다)
  const hood: Vec2[] = [
    ...bezier(pt(0, -0.95), pt(0.35, -0.7), pt(0.9, 0.3), pt(0.92, 0.9), 12),
    pt(-0.92, 0.9),
    ...bezier(pt(-0.92, 0.9), pt(-0.9, 0.3), pt(-0.35, -0.7), pt(0, -0.95), 12).slice(0, -1),
  ];
  const face: Vec2[] = [];
  for (let i = 0; i < 28; i += 1) {
    const a = (i / 28) * TAU;
    face.push(pt(Math.cos(a) * 0.46, 0.34 + Math.sin(a) * 0.4));
  }
  return { outline: [hood], marks: [face] };
}

export const GLYPHS: Readonly<Record<GlyphId, Shape>> = {
  runner: runnerGlyph(),
  guard: guardGlyph(),
  scout: scoutGlyph(),
  monster: monsterGlyph(),
};

/** 괴물 아이콘의 눈 (얼굴 안, 흰 분홍 발광) */
export const MONSTER_GLYPH_EYES: readonly Vec2[] = [pt(-0.2, 0.32), pt(0.2, 0.32)];

// ───────────────────────── 판정 · 변환 ─────────────────────────

/** 모양 안인가 (바깥 실루엣 합집합 안). 고리 다각형은 짝홀 규칙으로 구멍 */
export function inOutline(s: Shape, x: number, y: number): boolean {
  const p = { x, y };
  return s.outline.some((poly) => pointInPolygon(p, poly));
}

/** 몸색으로 칠해지는 곳인가 (실루엣 안 − 어두운 문양). 흑백 화면에서 사람이 보는 밝은 모양 */
export function inFill(s: Shape, x: number, y: number): boolean {
  if (!inOutline(s, x, y)) return false;
  const p = { x, y };
  return !s.marks.some((poly) => pointInPolygon(p, poly));
}

/**
 * 모양 마스크 래스터화 (픽셀 중심 표본). diameterPx = 몸 지름(px). 반환: 크기 size × size의 0/1 배열.
 * fill = true면 몸색 영역(실루엣 − 문양), false면 실루엣 전체
 */
export function shapeMask(
  s: Shape,
  diameterPx: number,
  opts: { fill?: boolean; extent?: number; rot?: number } = {},
): { size: number; data: Uint8Array } {
  const r = diameterPx / 2;
  const extent = opts.extent ?? 1.7;
  const size = Math.ceil(r * extent * 2);
  const c = size / 2;
  const cos = Math.cos(-(opts.rot ?? 0));
  const sin = Math.sin(-(opts.rot ?? 0));
  const data = new Uint8Array(size * size);
  const test = opts.fill === false ? inOutline : inFill;
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const px = (i + 0.5 - c) / r;
      const py = (j + 0.5 - c) / r;
      const x = px * cos - py * sin;
      const y = px * sin + py * cos;
      data[j * size + i] = test(s, x, y) ? 1 : 0;
    }
  }
  return { size, data };
}

/** 두 마스크(같은 크기)의 겹침 IoU */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x && y) inter += 1;
    if (x || y) union += 1;
  }
  return union === 0 ? 1 : inter / union;
}

/** 앞 돌출 (+x 방향 최대값) */
export function frontReach(s: Shape): number {
  let m = -Infinity;
  for (const poly of s.outline) for (const p of poly) m = Math.max(m, p.x);
  return m;
}

/** 다각형 넓이 (부호 없음, 신발끈 공식) */
export function polyArea(poly: Poly): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const p = poly[i];
    const q = poly[j];
    if (p && q) a += (q.x + p.x) * (q.y - p.y);
  }
  return Math.abs(a / 2);
}

/** Canvas2D · Path2D 경로 만들기에 쓰는 부분 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/** 다각형들을 경로에 넣는다: 중심 (cx, cy), 배율 k(px / 단위), 회전 rot */
export function tracePolys(sink: PathSink, polys: readonly Poly[], k: number, cx = 0, cy = 0, rot = 0): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const poly of polys) {
    const first = poly[0];
    if (!first) continue;
    sink.moveTo(cx + (first.x * c - first.y * s) * k, cy + (first.x * s + first.y * c) * k);
    for (let i = 1; i < poly.length; i += 1) {
      const p = poly[i];
      if (p) sink.lineTo(cx + (p.x * c - p.y * s) * k, cy + (p.x * s + p.y * c) * k);
    }
    sink.closePath();
  }
}

/** SVG path 문자열 (HUD · 로비 인라인 SVG, M10c). 짝홀 규칙(fill-rule="evenodd")으로 고리가 구멍이 된다 */
export function svgPath(polys: readonly Poly[], k = 1, cx = 0, cy = 0, digits = 2): string {
  const f = (v: number): string => String(Math.round(v * 10 ** digits) / 10 ** digits);
  const parts: string[] = [];
  for (const poly of polys) {
    poly.forEach((p, i) => parts.push(`${i === 0 ? 'M' : 'L'}${f(cx + p.x * k)} ${f(cy + p.y * k)}`));
    if (poly.length > 0) parts.push('Z');
  }
  return parts.join('');
}

// ───────────────────────── 매 프레임 그리는 원 · 호 (Graphics 펜) ─────────────────────────
// Phaser Graphics의 원호 명령(arc · fillCircle · strokeCircle · slice · 둥근 사각형)은 WebGL에서 크기와 상관없이
// 매번 100분할로 다시 펴지고, 채우기(fillPath)는 매번 Earcut이다. 매 프레임 다시 그리는 원 · 호는 여기서 반지름에 맞춰
// 선분으로 편다(현 ≈ 4 월드 px, 온원은 12각 이상): 작은 점은 12각, 범위 원은 판정 반지름 ±0.1px 안이다.

/** 선 그리기 펜 (Phaser Graphics · Canvas2D 경로의 부분 집합) */
export interface LinePen {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
}

/** 채우기 · 선 펜 (Phaser Graphics의 부분 집합: 단위 테스트는 기록 펜을 넘긴다) */
export interface PathPen extends LinePen {
  fillStyle(color: number, alpha?: number): unknown;
  lineStyle(width: number, color: number, alpha?: number): unknown;
  beginPath(): unknown;
  closePath(): unknown;
  fillPath(): unknown;
  strokePath(): unknown;
}

/** 현 길이 (월드 px) */
export const ARC_CHORD = 4;

/** 원호 분할 수: 현 ≈ ARC_CHORD, 온원은 12각 이상, 많아야 96 */
export function arcSteps(r: number, span: number): number {
  const s = Math.abs(span);
  const n = Math.ceil((s * Math.abs(r)) / ARC_CHORD);
  const min = s >= TAU - 1e-9 ? 12 : 1;
  return Math.max(min, Math.min(96, n));
}

/** 원호를 선분으로 편다 (a0 → a1). move = true면 시작점으로 moveTo, 아니면 지금 경로에 lineTo로 잇는다 */
export function penArc(
  pen: LinePen,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  move = true,
): void {
  const n = arcSteps(r, a1 - a0);
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0 && move) pen.moveTo(x, y);
    else pen.lineTo(x, y);
  }
}

/** 원 경로 (beginPath ~ closePath). 부르는 쪽이 fillPath · strokePath */
export function circlePath(pen: PathPen, cx: number, cy: number, r: number): void {
  pen.beginPath();
  penArc(pen, cx, cy, r, 0, TAU);
  pen.closePath();
}

/** 채운 원 */
export function fillCirclePen(pen: PathPen, cx: number, cy: number, r: number): void {
  circlePath(pen, cx, cy, r);
  pen.fillPath();
}

/** 삼각형을 바로 채우는 펜 (Phaser Graphics fillTriangle: WebGL은 Earcut 없이 삼각형 하나) */
export interface FanPen extends PathPen {
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): unknown;
}

/**
 * 채운 원을 첫 꼭짓점에서 퍼지는 삼각형 부채로 (WebGL 전용). fillCirclePen과 같은 꼭짓점(penArc의 점 0 ~ n)이고, 볼록 다각형이라
 * 부채 삼각형들이 Earcut 삼각형들과 같은 영역을 겹침 없이 덮는다 → 같은 화소(공유 변은 GPU 채우기 규칙으로 한 번만).
 * WebGL fillPath는 칠할 때마다 Earcut + 점 객체를 만든다. Canvas는 삼각형마다 따로 칠하면 경계 안티앨리어싱이 겹쳐 이음매가
 * 보이므로 fillCirclePen을 쓴다
 */
export function fillCircleFan(pen: FanPen, cx: number, cy: number, r: number): void {
  const n = arcSteps(r, TAU);
  const x0 = cx + Math.cos(0) * r;
  const y0 = cy + Math.sin(0) * r;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i += 1) {
    const a = 0 + ((TAU - 0) * i) / n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i >= 2) pen.fillTriangle(x0, y0, px, py, x, y);
    px = x;
    py = y;
  }
}

/** 원 테두리 */
export function strokeCirclePen(pen: PathPen, cx: number, cy: number, r: number): void {
  circlePath(pen, cx, cy, r);
  pen.strokePath();
}

/** 모서리가 둥근 사각형 경로 (모서리 반지름 rad) */
export function roundRectPath(pen: PathPen, x: number, y: number, w: number, h: number, rad: number): void {
  const r = Math.max(0, Math.min(rad, w / 2, h / 2));
  pen.beginPath();
  penArc(pen, x + w - r, y + r, r, -Math.PI / 2, 0);
  penArc(pen, x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  penArc(pen, x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  penArc(pen, x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  pen.closePath();
}

// ───────────────────────── 몸에 붙는 표시의 자리 (노출 문양 · 기절 별) ─────────────────────────
// 머리 위로 떠 있는 표시는 옆 캐릭터 몸과 그 바깥 링(몸/링 대비 3:1을 재는 r + 8 논리 px)을 비켜 둔다(정보 우선 R3 · R7 · R15:
// 남의 몸을 덮어 그 사람 역할 · 상태로 잘못 읽히거나 몸 윤곽 대비를 깎지 않게). 표시는 몸 아래 레이어라 다 막혀도 몸을 덮지는 않는다.

/** 원 (중심 · 반지름, 타일) */
export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** 옆 몸의 바깥 링까지 비워 둘 여유 (타일): 8 논리 px / (32 × 맵 배율 0.93) */
export const RING_PAD = 0.27;

/**
 * 표시를 둘 방향 (라디안): 후보 방향 순서대로, 표시가 차지하는 원들(footprint)이 다른 몸 원 + 바깥 링(RING_PAD)과 겹치지 않는 첫 방향.
 * 지난 방향이 아직 비어 있으면 그대로 둔다(자리가 깜빡이지 않게). 다 막히면 첫 후보
 */
export function pickSlot(
  slots: readonly number[],
  footprint: (dir: number) => readonly Disc[],
  others: readonly Disc[],
  prev: number | null,
): number {
  const free = (a: number): boolean =>
    footprint(a).every((f) => others.every((o) => Math.hypot(f.x - o.x, f.y - o.y) >= f.r + o.r + RING_PAD));
  if (prev !== null && free(prev)) return prev;
  for (const a of slots) if (free(a)) return a;
  return slots[0] ?? -Math.PI / 2;
}

/** 괴물 화면 능력 노출 문양 배지 (몸 반지름 배수): 몸 중심에서의 거리 · 배지 반지름 */
export const GLYPH_PLACE = { dist: 2.35, r: 0.86 } as const;

/** 표시 자리 후보 방향 (위 → 비스듬히 위 → 옆 → 비스듬히 아래 → 아래) */
export const GLYPH_SLOTS: readonly number[] = [-90, -45, -135, 0, 180, 45, 135, 90].map(
  (d) => (d * Math.PI) / 180,
);

/** 원 (x, y, r)이 다른 몸 원 + 바깥 링(RING_PAD) 모두와 겹치지 않는가 (pickSlot의 free와 같은 비교 · 같은 덧셈 순서) */
function discFree(x: number, y: number, r: number, others: readonly Disc[]): boolean {
  for (let k = 0; k < others.length; k += 1) {
    const o = others[k];
    if (o && !(Math.hypot(x - o.x, y - o.y) >= r + o.r + RING_PAD)) return false;
  }
  return true;
}

/**
 * 노출 문양을 둘 방향 (기본 머리 위). others = 이 화면에 그린 다른 캐릭터 몸 원.
 * pickSlot(GLYPH_SLOTS, 원 하나)과 같은 결과를 후보마다 배열 · 객체를 만들지 않고 낸다 (렌더링 최적화 2, 옛 구현과 대조하는 단위 테스트)
 */
export function glyphSlot(self: Vec2, bodyR: number, others: readonly Disc[], prev: number | null): number {
  const d = GLYPH_PLACE.dist * bodyR;
  const r = GLYPH_PLACE.r * bodyR;
  const free = (a: number): boolean =>
    discFree(self.x + Math.cos(a) * d, self.y + Math.sin(a) * d, r, others);
  if (prev !== null && free(prev)) return prev;
  for (let k = 0; k < GLYPH_SLOTS.length; k += 1) {
    const a = GLYPH_SLOTS[k];
    if (a !== undefined && free(a)) return a;
  }
  return GLYPH_SLOTS[0] ?? -Math.PI / 2;
}

/** 기절 별 배치 (그래픽 값, 월드 px): 궤도 반지름 가로 · 세로, 별 바깥 · 안 반지름, 외곽선 반폭, 회전 속도 (라디안/초) */
export const STUN_STARS = { orbitX: 13, orbitY: 5, outer: 6, inner: 2.6, edge: 1.25, spin: 3.85 } as const;

/**
 * 별 궤도 가운데의 몸 중심에서 거리 (타일, dir 방향): 궤도 타원(orbitX × orbitY)의 그 방향 폭 + 별 반지름만큼 괴물 망토(판정 반지름
 * × 1.12) 밖에 띄워 자기 몸에도 가리지 않는다 (위 · 아래는 가깝게, 옆은 멀리)
 */
export function stunOrbitDist(bodyR: number, tilePx: number, dir = -Math.PI / 2): number {
  const S = STUN_STARS;
  const reach = Math.hypot(S.orbitX * Math.cos(dir), S.orbitY * Math.sin(dir));
  return bodyR * 1.12 + (reach + S.outer + S.edge) / tilePx;
}

/**
 * 기절 별을 둘 방향 (기본 머리 위, 옆 몸 · 링이 있으면 비어 있는 쪽). 궤도 위 별 자리 12곳이 차지하는 원으로 판단.
 * pickSlot(GLYPH_SLOTS, 별 자리 원 12개)과 같은 결과를 후보마다 원 12개를 만들지 않고 낸다 (렌더링 최적화 2, 옛 구현과 대조하는 단위 테스트)
 */
export function starSlot(
  center: Vec2,
  bodyR: number,
  tilePx: number,
  others: readonly Disc[],
  prev: number | null,
): number {
  const S = STUN_STARS;
  const sr = (S.outer + S.edge) / tilePx;
  const free = (a: number): boolean => {
    const d = stunOrbitDist(bodyR, tilePx, a);
    const cx = center.x + Math.cos(a) * d;
    const cy = center.y + Math.sin(a) * d;
    for (let i = 0; i < 12; i += 1) {
      const t = (i / 12) * TAU;
      if (
        !discFree(cx + (Math.cos(t) * S.orbitX) / tilePx, cy + (Math.sin(t) * S.orbitY) / tilePx, sr, others)
      )
        return false;
    }
    return true;
  };
  if (prev !== null && free(prev)) return prev;
  for (let k = 0; k < GLYPH_SLOTS.length; k += 1) {
    const a = GLYPH_SLOTS[k];
    if (a !== undefined && free(a)) return a;
  }
  return GLYPH_SLOTS[0] ?? -Math.PI / 2;
}
