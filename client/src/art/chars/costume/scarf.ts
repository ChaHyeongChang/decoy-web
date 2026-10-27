// 의상 '목도리' (생존자 의상 150 불씨, 판 밖 메타 c): 목을 두 번 감은 두툼한 크림색 뜨개 목도리 + 등 뒤로 날리는 긴 꼬리 하나.
// 위 그림: 머리 뒤를 감싼 크림 깃(아래 단, 머리 밑에서 비어져 나온다) + 깃 위에 겹쳐 감은 위 단(가드 · 스카우트) + 옆 매듭 +
// 등 위로 흐르는 꼬리. 꼬리 끝에 역할색 줄 둘 · 술. 가드 · 스카우트 깃은 한쪽으로 감아 묶은 모양(매듭 쪽이 굵고 반대쪽은
// 가늘게 머리 밑으로 — 좌우 같은 말굽은 웃는 입 · 앞 단서와 이어진 고리로 읽힌다). 매듭 쪽: 러너 왼쪽(후드 끝 천이 오른쪽),
// 가드 오른쪽(정면 그림과 같은 쪽), 스카우트 오른쪽(왼쪽 등의 안테나를 덮지 않게).
// 머리 앞(챙 · 고글 · 헬멧 앞)은 덮지 않고, 몸 가운데 0.45r 원판(역할색)에서는 0.57r 둘레(KEEP_R)까지 떨어진다 — 가장 작은
// 화면(생존자 18.4px)에서도 원판 칸이 기본 그림 그대로다(1텍셀 넘는 틈: 안티에일리어싱 · 쌍선형 번짐이 원판에 닿지 않는다).
// 비켜 갈 때 꼬리 · 매듭 · 위 단은 두께 그대로 바깥으로 물러나고(경계에 눌려 얇아지지 않게), 깃은 경계에서 잘린 몫을 바깥
// 두께로 되찾아 크림 면적이 0.47r 때와 같다. 러너는 후드 뒤 끝이 그 둘레 안이라 깃이 후드 옆 두 조각으로만 보이고(앞으로
// 흔든 주먹 뒤), 가드 · 스카우트 위 단은 머리 밖 깃 위에 얹힌다. 휴대폰 크기에서는 '머리 뒤 크림 초승달 + 옆 꼬리 줄기'로
// 읽힌다.
// 정면 그림: 턱 밑 목에 두 번 감은 두 단(턱 끝만 조금 덮는다) + 한쪽 매듭 + 긴 꼬리 · 짧은 끝(끝마다 역할색 줄 둘 · 술).
// 러너(3/4)는 꼬리가 등 쪽(화면 왼쪽)으로 날리고, 가드는 방패를 피해 화면 왼쪽, 스카우트는 망원경 팔을 피해 화면 오른쪽 어깨
// 위로 늘어진다. 청록 네온은 긴 꼬리 끝단 실 한 줄뿐(정면만, 위 그림에는 청록 없음).
// 움직임: 위 그림 꼬리는 걸음마다 S자로 출렁이고(sway = amp × stride × sin(walk + 0.9 − 2.2k)), 러너 질주 때 곧게 뒤로 편다.
// 피격 · 수감 때 몸 쪽으로 움츠린다. 정면 꼬리 · 술은 바람(sway · t)에 흔들린다.
// 색: 크림 뜨개 #EDE0C8(밝은 면 · 그늘은 tint · shade), 줄 = 역할색을 38% 어둡게(러너 #255199 · 가드 #683599 · 스카우트 #157A3A).
import { ROLE } from '../../palette';
import {
  IDENTITY,
  apply,
  linear,
  path,
  radial,
  rotateAbout,
  shade,
  solid,
  tint,
  type Mat,
  type Sketch,
} from '../kit';
import type { RoleCharId } from '../types';
import type { Pt, SurvivorCostumeArt, SurvivorFrontAnchor, SurvivorTopAnchor } from './types';

/** 크림 뜨개 */
const KNIT = 0xede0c8;

/** 줄 색: 입은 역할색의 짙은 그늘 */
const stripeOf = (role: RoleCharId): number => shade(ROLE[role], 0.38);

// ───────────────────────── 띠 (꼬리 · 감은 단) ─────────────────────────

/** 3차 곡선 등뼈 (a → b · c → d) */
interface Spine {
  readonly a: Pt;
  readonly b: Pt;
  readonly c: Pt;
  readonly d: Pt;
}

/** 등뼈 위 점 · 단위 접선 */
function spineAt(s: Spine, t: number): { p: Pt; u: Pt } {
  const v = 1 - t;
  const k = [v * v * v, 3 * v * v * t, 3 * v * t * t, t * t * t] as const;
  const x = k[0] * s.a[0] + k[1] * s.b[0] + k[2] * s.c[0] + k[3] * s.d[0];
  const y = k[0] * s.a[1] + k[1] * s.b[1] + k[2] * s.c[1] + k[3] * s.d[1];
  const ex = 3 * v * v * (s.b[0] - s.a[0]) + 6 * v * t * (s.c[0] - s.b[0]) + 3 * t * t * (s.d[0] - s.c[0]);
  const ey = 3 * v * v * (s.b[1] - s.a[1]) + 6 * v * t * (s.c[1] - s.b[1]) + 3 * t * t * (s.d[1] - s.c[1]);
  const l = Math.hypot(ex, ey) || 1;
  return { p: [x, y], u: [ex / l, ey / l] };
}

/** 띠 한 변의 점: 등뼈 t에서 법선 쪽으로 w */
function edge(s: Spine, t: number, w: number): Pt {
  const { p, u } = spineAt(s, t);
  return [p[0] - u[1] * w, p[1] + u[0] * w];
}

/**
 * 띠 윤곽 (닫힌 매끄러운 곡선 점): 반폭 w0(뿌리) → w1(끝). 끝은 납작하게(뜨개 끝단), 뿌리는 둥글게
 */
function ribbonPts(s: Spine, w0: number, w1: number, n = 9, map: (p: Pt) => Pt = (p) => p): Pt[] {
  const wAt = (t: number): number => w0 + (w1 - w0) * t;
  const A: Pt[] = [];
  const B: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    A.push(edge(s, t, wAt(t)));
    B.push(edge(s, t, -wAt(t)));
  }
  const end = spineAt(s, 1);
  const start = spineAt(s, 0);
  const pts: Pt[] = [
    ...A,
    [end.p[0] + end.u[0] * w1 * 0.25, end.p[1] + end.u[1] * w1 * 0.25],
    ...B.reverse(),
    [start.p[0] - start.u[0] * w0 * 0.7, start.p[1] - start.u[1] * w0 * 0.7],
  ];
  return pts.map(map);
}

/** 띠를 가로지르는 줄 (t0 ~ t1 사이 사각 조각, 변 안쪽 inset) */
function bandPiece(
  s: Spine,
  w0: number,
  w1: number,
  t0: number,
  t1: number,
  inset = 0,
  map: (p: Pt) => Pt = (p) => p,
): string {
  const wAt = (t: number): number => w0 + (w1 - w0) * t - inset;
  const tm = (t0 + t1) / 2;
  return path().poly(
    [
      edge(s, t0, wAt(t0)),
      edge(s, tm, wAt(tm)),
      edge(s, t1, wAt(t1)),
      edge(s, t1, -wAt(t1)),
      edge(s, tm, -wAt(tm)),
      edge(s, t0, -wAt(t0)),
    ].map(map),
  ).d;
}

/** 띠를 가로지르는 뜨개 골 (짧은 선 여러 개를 한 경로로) */
function ribLines(
  s: Spine,
  w0: number,
  w1: number,
  t0: number,
  t1: number,
  count: number,
  map: (p: Pt) => Pt,
): string {
  const p = path();
  for (let i = 0; i < count; i += 1) {
    const t = t0 + ((t1 - t0) * (i + 0.5)) / count;
    const w = (w0 + (w1 - w0) * t) * 0.72;
    const a = map(edge(s, t, w));
    const b = map(edge(s, t, -w));
    const m = spineAt(s, t);
    // 골은 가운데가 끝 쪽으로 조금 휜다 (둥근 뜨개 결)
    const c = map([m.p[0] + m.u[0] * 0.025, m.p[1] + m.u[1] * 0.025]);
    p.M(a[0], a[1]).Q(c[0], c[1], b[0], b[1]);
  }
  return p.d;
}

/** 끝 술 (끝단에서 접선 방향으로 짧은 선 몇 가닥, 바람에 조금 휜다) */
function fringe(s: Spine, w1: number, len: number, bend: number, map: (p: Pt) => Pt, count = 4): string {
  const end = spineAt(s, 1);
  const nx = -end.u[1];
  const ny = end.u[0];
  const p = path();
  for (let i = 0; i < count; i += 1) {
    const k = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const [x, y] = edge(s, 1, w1 * 0.78 * k);
    const q = map([x + end.u[0] * len * 0.6 + nx * bend * 0.4, y + end.u[1] * len * 0.6 + ny * bend * 0.4]);
    const e = map([x + end.u[0] * len + nx * bend, y + end.u[1] * len + ny * bend]);
    const o = map([x, y]);
    p.M(o[0], o[1]).Q(q[0], q[1], e[0], e[1]);
  }
  return p.d;
}

/**
 * 꼬리 하나 그리기 (위 · 정면 같이): 크림 띠 + 뜨개 골 + 역할색 줄 둘 + 술. light = 칠 빛 방향 (위 그림 = 매듭 쪽 밝게, 정면 =
 * 왼쪽 위 밝게). 부품 7개(띠 외곽선 · 칠 · 안쪽 선, 골, 줄 둘, 술)
 */
function drawTail(
  sk: Sketch,
  ink: (c: number) => number,
  outline: number,
  s: Spine,
  w0: number,
  w1: number,
  stripe: number,
  o: {
    fringeLen: number;
    bend: number;
    ribs: number;
    light: readonly [Pt, Pt];
    /** 골 · 술 선 굵기 기준 (위 그림은 몸 반지름 단위라 굵게, 정면은 가늘게) */
    lw: number;
    /** 위 그림: 띠 점 다듬기 (몸 가운데 원판 밖 · 뒤 크기 한도 안) */
    map?: (p: Pt) => Pt;
  },
): void {
  const [l0, l1] = o.light;
  const map = o.map ?? ((p: Pt): Pt => p);
  sk.part(
    path().smooth(ribbonPts(s, w0, w1, 9, map), 1).d,
    linear(l0[0], l0[1], l1[0], l1[1], [
      [0, ink(tint(KNIT, 0.16))],
      [0.5, ink(KNIT)],
      [1, ink(shade(KNIT, 0.2))],
    ]),
    outline,
    1,
    0.45,
  );
  sk.line(
    ribLines(s, w0, w1, 0.08, 0.62, o.ribs, map),
    solid(ink(shade(KNIT, 0.22))),
    o.lw * 0.11,
    'round',
    0.8,
  );
  // 역할색 줄 둘 (끝 가까이)
  sk.fill(bandPiece(s, w0, w1, 0.68, 0.76, 0.004, map), solid(ink(stripe)));
  sk.fill(bandPiece(s, w0, w1, 0.82, 0.9, 0.004, map), solid(ink(stripe)));
  if (o.fringeLen > 0)
    sk.line(fringe(s, w1, o.fringeLen, o.bend, map), solid(ink(shade(KNIT, 0.12))), o.lw * 0.16, 'round');
}

// ───────────────────────── 위 그림 ─────────────────────────

/**
 * 목도리가 비켜 가는 몸 가운데 둘레 (몸 반지름 배수): 역할색 원판 0.45r + 가장 작은 화면에서 1텍셀 넘는 틈. 생존자 18.4px
 * (배율 1.25 휴대폰 터치 낮음)에서 1텍셀 = 0.11r — 띠 가장자리(안쪽 테 선 포함)가 이보다 가까우면 안티에일리어싱 · 쌍선형
 * 찍기로 원판 맨 바깥 칸에 크림 · 외곽선 색이 번진다 (tests/unit/costume-parity-disc*.test.ts). 0.47r이던 때 러너 · 가드
 * 휴대폰 크기에서 원판 칸 최대 8.6%가 달랐다 (0.54r부터 기준 안, 0.57r에서 모든 크기 · 화면 0%)
 */
const KEEP_R = 0.57;

/**
 * 위 단 (가드 · 스카우트): 머리 둘레 밖으로 덧댄 두께 · 몸 가운데 둘레에서 더 떼는 몫. 머리 뒤 끝이 둘레 안이라 위 단은
 * 머리 밖 깃 위로 물러나 얹힌다 — 안쪽 테를 아래 단(깃) 안쪽 테와 같은 경계에 두지 않는다(맞닿은 테는 칸마다 안티에일리어싱이
 * 겹쳐 밑의 짙은 외곽선이 비친다)
 */
const OVER_OUT = 0.11;
const OVER_IN = 0.02;

/** 위 그림 옆 폭 배율 (index.ts TOP_WIDTH와 같은 값 — 러너는 내보낼 때 y를 0.94배로 줄이므로 그만큼 y를 크게 비켜 간다) */
const TOP_SQUASH: Readonly<Record<RoleCharId, number>> = { runner: 0.94, guard: 1, scout: 1 };

/** 뒤쪽 크기 한도 (measure.SIZE_RULE 뒤 1.0r — 다듬기 전 점 기준, 여유 조금) */
const BACK_MAX = 0.985;

/**
 * 몸 가운데 둘레 밖으로 미는 함수 (역할마다): 점이 둘레(+ margin) 타원 안이면 몸 중심에서 바깥으로 민다. margin = 그 점에서
 * 안쪽으로 뻗는 두께(띠 등뼈면 반폭, 깃 바깥 테면 깃 두께) — 경계에 눌려 얇아지지 않고 두께 그대로 바깥으로 비켜 간다
 */
function keeper(role: RoleCharId): (p: Pt, margin?: number) => Pt {
  const ky = 1 / TOP_SQUASH[role];
  return (p, margin = 0) => {
    const q = Math.hypot(p[0] / (KEEP_R + margin), p[1] / (KEEP_R * ky + margin));
    return q < 1 && q > 1e-6 ? [p[0] / q, p[1] / q] : p;
  };
}

/** 뒤쪽(x < 0) 점은 크기 한도 안으로 당긴다 (걸음 출렁임 끝에서도) */
function backLimit(p: Pt): Pt {
  const r = Math.hypot(p[0], p[1]);
  return p[0] < 0 && r > BACK_MAX ? [(p[0] * BACK_MAX) / r, (p[1] * BACK_MAX) / r] : p;
}

/**
 * 위 그림 역할별 자리 (몸 반지름 배수, 각은 머리 중심 기준 뒤 가운데에서 잰 각 — 양수 = 매듭 쪽):
 *  side = 매듭 · 꼬리 쪽(−1 = 왼쪽 −y, 1 = 오른쪽 +y) · span · far = 깃이 매듭 쪽 · 반대쪽으로 뻗는 각 · gap = 뒤 가운데
 *  비우는 반각(러너: 후드 뒤 끝이 몸 가운데 원판 안이라 깃이 옆 두 조각으로만 보인다) · 깃 두께 옆 · 뒤 · 머리 밑으로 숨는
 *  안쪽(음수) · 위 단(머리 뒤 끝에 얹힌 두 번째 감김) 매듭 쪽 · 반대쪽 끝 각, over 0이면 없음 · 매듭 각 · 매듭 반지름 · 꼬리
 *  가운데 · 끝(몸 기준, 왼쪽 매듭 기준 — 오른쪽이면 y를 뒤집는다) · 꼬리 반폭(뿌리 · 끝).
 *  가드 · 스카우트 깃은 한쪽으로 감아 묶은 모양(매듭 쪽이 굵고 반대쪽은 가늘게 머리 밑으로) — 좌우 같은 굵은 말굽이면 큰
 *  그림에서 웃는 입처럼, 휴대폰 크기에서 앞 단서(가드 챙 · 스카우트 고글 띠)와 이어진 고리처럼 읽혀 바라보는 쪽이 흐려진다.
 *  깃 두께 · 꼬리 반폭은 몸 가운데 둘레(KEEP_R)를 비켜 가며 잃은 크림 면적을 바깥으로 되찾은 값 (0.57r로 옮기기 전과 크림 칸 수가
 *  같은 정도 — 러너 0.17 · 0.15/0.12, 가드 · 스카우트 옆 0.14 · 뒤 0.24이던 것)
 */
interface TopFit {
  readonly side: -1 | 1;
  readonly span: number;
  readonly far: number;
  readonly gap: number;
  readonly tSide: number;
  readonly tBack: number;
  readonly tIn: number;
  readonly over: number;
  readonly overFar: number;
  readonly knot: number;
  readonly knotR: number;
  readonly mid: Pt;
  readonly tip: Pt;
  readonly w0: number;
  readonly w1: number;
}

const TOP_FIT: Readonly<Record<RoleCharId, TopFit>> = {
  // 러너: 머리(후드)가 앞으로 나와 목이 후드 뒤에 숨는다 — 깃은 후드 옆 · 뒤 어깨 위로 비어져 나온 두 조각(앞으로 흔든 주먹
  // 뒤, 몸 가운데 원판 밖) + 왼쪽 매듭. 꼬리는 왼쪽 몸판 가장자리를 따라 뒤로 (후드 끝 천은 오른쪽)
  runner: {
    side: -1,
    span: 1.38,
    far: 1.38,
    gap: 0.6,
    tSide: 0.18,
    tBack: 0.18,
    tIn: -0.1,
    over: 0,
    overFar: 0,
    knot: 0.95,
    knotR: 0.15,
    mid: [-0.15, -0.66],
    tip: [-0.57, -0.5],
    w0: 0.16,
    w1: 0.13,
  },
  // 가드: 오른쪽 매듭 (정면 그림도 매듭이 가드 오른쪽 어깨 — 화면 왼쪽). 꼬리는 등 판 위로
  guard: {
    side: 1,
    span: 1.42,
    far: 0.95,
    gap: 0,
    tSide: 0.17,
    tBack: 0.29,
    tIn: -0.08,
    over: 1.05,
    overFar: 0.4,
    knot: 1.2,
    knotR: 0.16,
    mid: [-0.56, -0.56],
    tip: [-0.79, -0.25],
    w0: 0.15,
    w1: 0.13,
  },
  // 스카우트: 오른쪽 매듭 — 왼쪽 등의 안테나를 덮지 않고, 반대쪽(왼쪽) 깃이 가늘어 안테나가 깃 밑에서 비어져 나온다.
  // 꼬리는 배낭 위로
  scout: {
    side: 1,
    span: 1.38,
    far: 0.9,
    gap: 0,
    tSide: 0.17,
    tBack: 0.29,
    tIn: -0.08,
    over: 1.05,
    overFar: 0.4,
    knot: 1.2,
    knotR: 0.16,
    mid: [-0.5, -0.6],
    tip: [-0.76, -0.32],
    w0: 0.15,
    w1: 0.12,
  },
};

/** 머리 기준 둘레 점: 각 th(0 = 앞), 앞쪽은 원, 뒤쪽은 뒤 x 반지름 rb의 반타원. off = 바깥으로 더한 두께 */
function ringPt(cx: number, cy: number, rb: number, ry: number, th: number, off: number): Pt {
  const c = Math.cos(th);
  return [cx + (c < 0 ? rb + off : ry + off) * c, cy + (ry + off) * Math.sin(th)];
}

/** 러너 후드는 피격 때 몸 중심을 축으로 돈다 (runner.ts E) — 깃 · 매듭을 같이 돌린다 */
function headMat(a: SurvivorTopAnchor): Mat {
  return a.role === 'runner' ? rotateAbout(0.22 * a.hit, 0, 0) : IDENTITY;
}

/** 0~1 부드러운 계단 */
function smooth01(v: number): number {
  const t = Math.min(1, Math.max(0, v));
  return t * t * (3 - 2 * t);
}

function topBack(sk: Sketch, a: SurvivorTopAnchor): void {
  const f = TOP_FIT[a.role];
  const ink = a.ink;
  const H = headMat(a);
  const { x: hx, y: hy, r: R } = a.head;
  const rb = hx - a.head.backX;
  const shrink = 1 - 0.08 * a.captive;
  const keep = keeper(a.role);
  // u = 뒤 가운데에서 매듭 쪽으로 잰 각 → 머리 둘레 각. m = 그 점에서 안쪽으로 뻗는 두께 (몸 가운데 둘레를 비켜 갈 때 지킨다)
  const at = (u: number): number => Math.PI - f.side * u;
  const ring = (u: number, off: number, m = 0): Pt =>
    backLimit(keep(apply(H, ...ringPt(hx, hy, rb, R, at(u), off)), m));
  // 깃 두께: 옆 → 뒤, 조각 양 끝은 머리 윤곽으로 가늘어진다 (러너 조각은 렌즈꼴). 한 조각 깃은 매듭 반대쪽 끝이 가늘다
  const tOut = (u: number, lo: number, hi: number): number => {
    const c = Math.cos(u);
    const base = f.tSide + (f.tBack - f.tSide) * c * c;
    const ends = f.gap > 0 ? smooth01((u - lo) / 0.28) * smooth01((hi - u) / 0.28) : 1;
    const wrap = f.gap > 0 ? 1 : 0.3 + 0.7 * smooth01((u + f.far) / (f.far + 0.55));
    return base * shrink * (0.15 + 0.85 * ends) * wrap;
  };
  const pieces: [number, number][] =
    f.gap > 0
      ? [
          [-f.far, -f.gap],
          [f.gap, f.span],
        ]
      : [[-f.far, f.span]];
  // 1) 목에 감은 아래 단 (머리 밑): 안쪽은 머리 밑으로 숨고 바깥만 보인다. 가운데 볼록한 관 음영
  const collar = path();
  const ribs = path();
  for (const [lo, hi] of pieces) {
    const n = f.gap > 0 ? 6 : 12;
    const outer: Pt[] = [];
    const inner: Pt[] = [];
    for (let i = 0; i <= n; i += 1) {
      const u = lo + ((hi - lo) * i) / n;
      outer.push(ring(u, tOut(u, lo, hi)));
      inner.push(ring(u, f.tIn));
      // 뜨개 골 (깃을 가로지르는 짧은 선, 칸 사이마다)
      if (i > 0) {
        const um = u - (hi - lo) / n / 2;
        const p0 = ring(um, 0.02);
        const p1 = ring(um, tOut(um, lo, hi) * 0.62);
        ribs.M(p0[0], p0[1]).L(p1[0], p1[1]);
      }
    }
    const capA = ring(lo - 0.1, (tOut(lo, lo, hi) + f.tIn) / 2);
    const capB = ring(hi + 0.1, (tOut(hi, lo, hi) + f.tIn) / 2);
    collar.smooth([capA, ...outer, capB, ...inner.reverse()], 1);
  }
  const ringR = Math.max(rb, R);
  const top = (ringR + f.tBack * 0.45) / (ringR + f.tBack);
  const [gx, gy] = apply(H, hx, hy);
  sk.part(
    collar.d,
    radial(gx, gy, ringR + f.tBack, [
      [0, ink(shade(KNIT, 0.22))],
      [Math.max(0, top - 0.25), ink(shade(KNIT, 0.06))],
      [top, ink(tint(KNIT, 0.28))],
      [1, ink(shade(KNIT, 0.16))],
    ]),
    a.outline,
    1,
    0.45,
  );
  sk.line(ribs.d, solid(ink(shade(KNIT, 0.24))), 0.02, 'round', 0.7);
  // 2) 꼬리 (매듭에서 나와 어깨뼈 위로 등 끝 쪽으로). 걸음마다 S자로 출렁이고(뿌리 → 끝으로 갈수록 크고 늦게),
  //    러너 질주 때 곧게 뒤로 편다. 피격 · 수감 때 몸 쪽으로 움츠린다
  const run = a.role === 'runner' ? a.action : 0;
  const wave = a.stride * (1 - 0.7 * run);
  const sway = (k: number, amp: number): number => amp * wave * Math.sin(a.walk + 0.9 - 2.2 * k);
  const pull = 0.1 * a.hit + 0.08 * a.captive;
  const thK = at(f.knot);
  const kr = f.knotR * shrink;
  // 매듭은 반지름 절반만큼 더 비켜 간다 (안쪽 반은 머리 · 후드 밑에 숨는다 — 다 비키면 수감 때 몸판 밖으로 튀어나온다)
  const knot = ring(f.knot, tOut(f.knot, f.gap, f.span) * 0.5, kr * 0.5);
  // 꼬리 자리는 왼쪽 매듭 기준 — 오른쪽 매듭이면 y를 뒤집는다 (출렁임도 거울로)
  const my = -f.side;
  // 스카우트는 수감 · 구조 중 망원경을 배낭 오른쪽 옆에 꽂아 둔다 — 꼬리를 등 가운데 쪽으로 붙여 겹치지 않게
  const tuck = a.role === 'scout' ? Math.max(a.captive, a.reach) : 0;
  const mid = apply(
    a.body,
    f.mid[0] + 0.05 * run + pull * 0.5 + 0.06 * tuck,
    my * ((f.mid[1] + 0.04 * run) * (1 - 0.22 * tuck) + sway(0.45, 0.05)),
  );
  const tip = apply(
    a.body,
    f.tip[0] - 0.12 * run + pull - 0.08 * tuck,
    my * (f.tip[1] * (1 - 0.25 * run) * (1 - 0.65 * tuck) + sway(1, 0.08)),
  );
  // 등뼈 조절점은 반폭만큼 몸 가운데 둘레를 비켜 간다 (띠가 경계에 눌려 얇아지지 않고 폭 그대로 바깥으로). 띠 점은 한 번 더
  // 둘레 밖 · 뒤 크기 한도 안으로 다듬는다
  const w0 = f.w0 * shrink;
  const w1 = f.w1 * shrink;
  const wm = (w0 + w1) / 2;
  const sp: Spine = {
    a: knot,
    b: keep([knot[0] + (mid[0] - knot[0]) * 0.55, knot[1] + (mid[1] - knot[1]) * 0.95], w0),
    c: keep(mid, wm),
    d: keep(tip, w1),
  };
  drawTail(sk, ink, a.outline, sp, w0, w1, stripeOf(a.role), {
    fringeLen: 0.06,
    bend: sway(1.2, 0.04),
    ribs: 4,
    light: [knot, tip],
    lw: 0.19,
    map: (p) => backLimit(keep(p)),
  });
  // 3) 매듭 (꼬리 뿌리 위 둥근 덩이 + 접힌 주름)
  sk.part(
    path().ellipse(knot[0], knot[1], kr, kr * 0.86, thK).d,
    radial(knot[0] + 0.02, knot[1], kr * 1.25, [
      [0, ink(tint(KNIT, 0.22))],
      [0.6, ink(KNIT)],
      [1, ink(shade(KNIT, 0.26))],
    ]),
    a.outline,
    1,
    0.45,
  );
  const kc = Math.cos(thK);
  const ks = Math.sin(thK);
  sk.line(
    path()
      .M(knot[0] - ks * kr * 0.55, knot[1] + kc * kr * 0.55)
      .Q(
        knot[0] + kc * kr * 0.25,
        knot[1] + ks * kr * 0.25,
        knot[0] + ks * kr * 0.55,
        knot[1] - kc * kr * 0.55,
      ).d,
    solid(ink(shade(KNIT, 0.3))),
    0.022,
  );
}

function topOver(sk: Sketch, a: SurvivorTopAnchor): void {
  const f = TOP_FIT[a.role];
  if (f.over <= 0) return;
  const ink = a.ink;
  const H = headMat(a);
  const { x: hx, y: hy, r: R } = a.head;
  const rb = hx - a.head.backX;
  // 위 단: 머리 뒤에 감은 두 번째 감김 (머리 뒤쪽 반에만 — 앞 단서는 그대로, 매듭 쪽으로 치우친다). 안쪽 테는 몸 가운데
  // 둘레(KEEP_R) + OVER_IN 밖 — 가드 · 스카우트는 머리 뒤 끝이 그 둘레 안이라 머리 밖 깃 위에 얹힌다
  const u0 = -f.overFar;
  const u1 = f.over;
  const depth = 0.12 * (1 - 0.1 * a.captive);
  const keep = keeper(a.role);
  const n = 8;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const th = Math.PI - f.side * (u0 + ((u1 - u0) * i) / n);
    // 가운데가 가장 두껍고 양 끝은 머리 윤곽으로 가늘어진다
    const k = Math.sin((Math.PI * i) / n);
    // 바깥 테는 단 두께만큼 비켜 간다 (머리 뒤 끝이 몸 가운데 둘레 안이면 단이 두께 그대로 머리 밖 깃 위로 물러난다)
    outer.push(
      backLimit(keep(apply(H, ...ringPt(hx, hy, rb, R, th, OVER_OUT * k)), OVER_IN + (OVER_OUT + depth) * k)),
    );
    inner.push(keep(apply(H, ...ringPt(hx, hy, rb, R, th, -depth * k)), OVER_IN));
  }
  // 칠은 단의 실제 자리(비켜 간 뒤)를 따른다: 가운데 단면의 안 · 바깥 테 거리로 안쪽 그늘 → 가운데 밝은 결 → 바깥 그늘
  const [gx, gy] = apply(H, hx, hy);
  const mid = n / 2;
  const dist = (p: Pt | undefined): number => (p ? Math.hypot(p[0] - gx, p[1] - gy) : R);
  const dOut = dist(outer[mid]);
  const dIn = Math.min(dist(inner[mid]), dOut - 0.01);
  sk.part(
    path().smooth([...outer, ...inner.slice(1, -1).reverse()], 1).d,
    radial(gx, gy, dOut, [
      [0, ink(shade(KNIT, 0.2))],
      [dIn / dOut, ink(shade(KNIT, 0.06))],
      [(dIn + 0.5 * (dOut - dIn)) / dOut, ink(tint(KNIT, 0.22))],
      [1, ink(shade(KNIT, 0.14))],
    ]),
    a.outline,
    1,
    0.45,
  );
}

// ───────────────────────── 정면 ─────────────────────────

/**
 * 정면 역할별 자리 (torso 변환 전 몸통 좌표, 목 기준 dx · dy): 감은 단 반폭 · 위 단 · 아래 단 가운데 높이(목 기준) · 매듭
 * 쪽(−1 = 화면 왼쪽) · 매듭 자리 · 긴 꼬리 끝(전신 · 상반신, 그림 좌표 매듭 기준) · 짧은 끝 · 꼬리가 옆으로 날리는가(러너)
 */
interface FrontFit {
  readonly hw: number;
  readonly up: number;
  readonly low: number;
  readonly sag: number;
  /** 앞 가운데 (러너 3/4는 가슴 쪽으로 치우친다) */
  readonly cx: number;
  readonly side: -1 | 1;
  readonly knot: Pt;
  readonly tip: Pt;
  readonly tipBust: Pt;
  readonly short: Pt;
  readonly fly: boolean;
}

const FRONT_FIT: Readonly<Record<RoleCharId, FrontFit>> = {
  runner: {
    hw: 0.25,
    up: -0.005,
    low: 0.06,
    sag: 0.04,
    cx: 0.08,
    side: -1,
    knot: [-0.17, 0.06],
    tip: [-0.66, -0.06],
    tipBust: [-0.46, -0.04],
    short: [-0.06, 0.16],
    fly: true,
  },
  // 가드: 방패(화면 오른쪽 몸 앞, 위 끝 y ≈ 0)를 피해 높게 감고 꼬리는 화면 왼쪽 어깨 위로
  guard: {
    hw: 0.25,
    up: -0.015,
    low: 0.05,
    sag: 0.035,
    cx: 0,
    side: -1,
    knot: [-0.27, 0.06],
    tip: [-0.1, 0.4],
    tipBust: [-0.08, 0.32],
    short: [0.05, 0.15],
    fly: false,
  },
  // 스카우트: 망원경 팔(화면 왼쪽)을 피해 매듭 · 꼬리를 화면 오른쪽에
  scout: {
    hw: 0.24,
    up: -0.005,
    low: 0.06,
    sag: 0.035,
    cx: 0,
    side: 1,
    knot: [0.24, 0.07],
    tip: [0.08, 0.38],
    tipBust: [0.07, 0.3],
    short: [-0.05, 0.15],
    fly: false,
  },
};

/** 감은 단 하나 (목을 두르는 굵은 관): 가운데 높이 y, 반폭 hw, 앞 처짐 sag, 두께 반 th */
function wrapSpine(cx: number, y: number, hw: number, sag: number): Spine {
  return {
    a: [cx - hw, y - sag * 0.6],
    b: [cx - hw * 0.4, y + sag * 1.25],
    c: [cx + hw * 0.4, y + sag * 1.25],
    d: [cx + hw, y - sag * 0.6],
  };
}

function frontNeck(sk: Sketch, a: SurvivorFrontAnchor): void {
  const f = FRONT_FIT[a.role];
  const ink = a.ink;
  const T = a.torso;
  const [nx, ny] = a.neck;
  const cx = nx + f.cx;
  const stripe = stripeOf(a.role);
  const toDraw = (p: Pt): Pt => apply(T, p[0], p[1]);
  // 1) 목도리 밑 그늘 (몸통 위에 진 그늘)
  const low = wrapSpine(cx, ny + f.low, f.hw + 0.02, f.sag);
  sk.fill(
    path(T).smooth(ribbonPts(wrapSpine(cx, ny + f.low + 0.05, f.hw, f.sag), 0.06, 0.06), 1).d,
    solid(ink(shade(stripe, 0.6))),
    0.28,
  );
  // 2) 아래 단 · 위 단 (위 단이 턱 밑을 조금 덮는다). 위가 밝고 아래가 그늘진 관
  const up = wrapSpine(cx + f.side * -0.01, ny + f.up, f.hw - 0.02, f.sag);
  for (const [s, th] of [
    [low, 0.068],
    [up, 0.062],
  ] as const) {
    const [x0, y0] = toDraw([cx, s.a[1] - th]);
    const [x1, y1] = toDraw([cx + 0.06, s.b[1] + th]);
    sk.part(
      path(T).smooth(ribbonPts(s, th, th), 1).d,
      linear(x0 - 0.1, y0, x1, y1, [
        [0, ink(tint(KNIT, 0.22))],
        [0.45, ink(KNIT)],
        [1, ink(shade(KNIT, 0.3))],
      ]),
      a.outline,
      1,
      0.5,
    );
    sk.line(ribPath(T, s, th, 9), solid(ink(shade(KNIT, 0.22))), 0.011, 'round', 0.85);
  }
  // 3) 매듭 + 두 끝: 긴 꼬리 (러너는 등 쪽으로 날리고, 가드 · 스카우트는 어깨 위로 늘어져 바람에 흔들린다) · 짧은 끝
  const knot = toDraw([nx + f.knot[0], ny + f.knot[1]]);
  const sw = a.sway;
  const flutter = Math.sin(a.t * 3.1 + 0.7);
  const tipBase = a.bust ? f.tipBust : f.tip;
  const tip: Pt = f.fly
    ? [knot[0] + tipBase[0] + 0.02 * sw, knot[1] + tipBase[1] + 0.05 * sw]
    : [knot[0] + tipBase[0] + f.side * 0.035 * sw, knot[1] + tipBase[1] - 0.01 * Math.abs(sw)];
  const long: Spine = f.fly
    ? {
        a: knot,
        b: [knot[0] + tipBase[0] * 0.28, knot[1] - 0.1 + 0.02 * flutter],
        c: [knot[0] + tipBase[0] * 0.64, knot[1] + 0.09 + 0.05 * flutter],
        d: tip,
      }
    : {
        a: knot,
        b: [knot[0] + f.side * 0.03, knot[1] + 0.12],
        c: [knot[0] + tipBase[0] * 0.5 + f.side * 0.03 * sw, knot[1] + tipBase[1] * 0.62],
        d: tip,
      };
  const shortTip: Pt = [knot[0] + f.short[0] + 0.015 * sw, knot[1] + f.short[1]];
  const short: Spine = {
    a: knot,
    b: [knot[0] + f.short[0] * 0.2, knot[1] + f.short[1] * 0.4],
    c: [knot[0] + f.short[0] * 0.7, knot[1] + f.short[1] * 0.75],
    d: shortTip,
  };
  const light: readonly [Pt, Pt] = [
    [knot[0] - 0.15, knot[1] - 0.1],
    [knot[0] + 0.2, knot[1] + 0.35],
  ];
  const tw = f.fly ? 0.085 : 0.078;
  drawTail(sk, ink, a.outline, short, 0.065, 0.06, stripe, {
    fringeLen: 0.045,
    bend: 0.01 * sw,
    ribs: 2,
    light,
    lw: 0.1,
  });
  drawTail(sk, ink, a.outline, long, tw, tw * 0.9, stripe, {
    fringeLen: 0.055,
    bend: f.fly ? 0.02 * flutter : 0.015 * sw,
    ribs: 4,
    light,
    lw: 0.1,
  });
  // 꼬리 끝단 실 (청록 네온 한 줄: 줄 둘 아래 끝단 가까이)
  const e0 = edge(long, 0.955, tw * 0.9 * 0.8);
  const e1 = edge(long, 0.955, -tw * 0.9 * 0.8);
  a.neon.line(path().M(e0[0], e0[1]).L(e1[0], e1[1]).d, 0.012, 0.75);
  // 매듭 (감은 단 위 둥근 덩어리 + 가운데 접힌 주름)
  sk.part(
    path().ellipse(knot[0], knot[1], 0.075, 0.068, f.side * 0.4).d,
    radial(knot[0] - 0.03, knot[1] - 0.03, 0.1, [
      [0, ink(tint(KNIT, 0.22))],
      [0.6, ink(KNIT)],
      [1, ink(shade(KNIT, 0.28))],
    ]),
    a.outline,
    1,
    0.5,
  );
  sk.line(
    path()
      .M(knot[0] - 0.035, knot[1] - 0.02)
      .Q(knot[0], knot[1] + 0.015, knot[0] + 0.035, knot[1] - 0.015).d,
    solid(ink(shade(KNIT, 0.3))),
    0.012,
  );
}

/** 감은 단을 가로지르는 뜨개 골 (torso 변환 적용) */
function ribPath(T: Mat, s: Spine, th: number, count: number): string {
  const p = path(T);
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const a = edge(s, t, th * 0.75);
    const b = edge(s, t, -th * 0.75);
    p.M(a[0], a[1]).L(b[0], b[1]);
  }
  return p.d;
}

export const SCARF_ART: SurvivorCostumeArt = {
  id: 'scarf',
  topBack,
  topOver,
  frontNeck,
};
