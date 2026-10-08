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
