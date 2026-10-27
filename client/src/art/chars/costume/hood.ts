// 의상 '긴 고깔' (괴물 의상 150 불씨, 판 밖 메타 c): 기본 붉은 두건의 꼭대기가 길게 자라 한쪽으로 꺾여 늘어진 고깔 두건.
// 뿔이 아니라 천이다 — 끝은 둥글고, 꺾인 곳에 접힌 주름이 지며, 걸으면 끝이 흔들린다(사용자 결정: 뿔 · 가시 없음).
// 정면 그림: 두건 윤곽(frontHood)의 꼭대기를 위로 올려 괴물 오른쪽(화면 왼쪽)으로 꺾고, 끝이 어깨 위로 처져 늘어진다.
// 오른쪽 가장자리는 기본 두건 그대로라 림 라이트가 맞고, 꺾인 끝 위쪽은 림 라이트를 이어 긋는다(frontOver — 얼굴보다
// 한참 위라 얼굴 · 눈 · 발톱을 덮지 않는다). 상반신은 상자 위 끝이 가까워 고깔을 조금 낮춘다.
// 위 그림: 두건 뒤 끝에서 이어진 긴 천 꼬리가 등 가운데 망토 위로 흘러내리다 끝이 괴물 오른쪽(+y)으로 굽는다(topHead).
// 꼬리 밑 그늘은 망토 위에만(topCloak — 두건이 덮는다). 얼굴 그늘 · 눈 · 발톱 · 몸 가운데 역할색은 그대로다.
// 꼬리 끝은 어느 자세 · 물결에서도 톱니 자락의 골 안쪽에 머문다(tailSpine — 자락까지 거리로 부드럽게 줄인다).
// 휴대폰 크기에서는 '두건에서 뒤로 뻗은 밝은 붉은 줄기 + 끝의 갈고리'로 읽힌다.
// 움직임: 꼬리 끝은 망토 물결 · 걸음에 좌우로 흔들리고, 돌진 때 뒤로 곧게 펴지고, 기절 때 축 처진다. 정면 끝은 숨 · 바람에 흔들린다.
// 색 (모두 괴물 역할색 #EF4444에서): 고깔 · 꼬리 = 기본 두건 칠 그대로, 꼬리 윗면 #F26969(20% 밝힘) · #F16060 → 끝 #E54141,
// 꼬리 테 #5B1A1A(62% 그늘), 주름 #8B2727(위) · #782222(정면 꺾인 곳), 정면 끝 아랫면 #832525, 빛 #F47C7C · #F36D6D,
// 꼬리 밑 그늘 #3F0D12(짙은 진홍 #5A1219를 30% 더 어둡게), 정면 림 라이트 = 기본 괴물 림 색. 청록 없음.
import { MONSTER_COLOR } from '../monster';
import {
  apply,
  linear,
  path,
  radial,
  shade,
  solid,
  tint,
  type Mat,
  type Paint,
  type Sketch,
  type Stop,
} from '../kit';
import type { MonsterCostumeArt, MonsterFrontAnchor, MonsterTopAnchor, Pt } from './types';

const HOOD = MONSTER_COLOR.hood;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 변환의 길이 배율 */
function lenScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

// ───────────────────────── 위 그림: 등 위로 흐르는 꼬리 ─────────────────────────

/** 3차 곡선 등뼈 (그림 좌표) */
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

/** 등뼈 t에서 법선 쪽으로 w 떨어진 점 */
function edge(s: Spine, t: number, w: number): Pt {
  const { p, u } = spineAt(s, t);
  return [p[0] - u[1] * w, p[1] + u[0] * w];
}

/** 꼬리 마디 수 · 뿌리 반폭 (두건 좌표) · 끝으로 가늘어지는 지수 */
const TAIL_N = 8;
const TAIL_W = 0.25;
const TAIL_TAPER = 0.52;

/** 원점에서 (ux, uy) 방향 반직선이 뒤 자락 꺾은선(몸 좌표)과 처음 만나는 거리 (못 만나면 Infinity) */
function hemReach(hem: readonly Pt[], ux: number, uy: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < hem.length; i += 1) {
    const p = hem[i];
    const q = hem[i + 1];
    if (!p || !q) continue;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (p[0] * ey - p[1] * ex) / den;
    const k = (p[0] * uy - p[1] * ux) / den;
    if (t > 0 && k >= 0 && k <= 1) best = Math.min(best, t);
  }
  return best;
}

/** 꼬리 끝(둥근 끝 0.035 · 망토 외곽선 안쪽 반)이 자락 골 밖으로 나가지 않게 남기는 거리 · 부드럽게 줄이기 시작하는 폭 */
const HEM_MARGIN = 0.1;
const HEM_KNEE = 0.06;

/**
 * 꼬리 등뼈: 뿌리는 두건 뒤쪽 안(두건 좌표 — 고개를 따라 움직인다), 끝은 몸 좌표 (망토 위에 놓인다). 끝은 등 가운데로
 * 곧게 흐르다 괴물 오른쪽(+y)으로 굽고, 망토 물결 · 걸음에 좌우로 흔들린다. 돌진 = 뒤로 곧게, 기절 = 짧게 처진다.
 * 끝이 톱니 자락의 골(반지름 약 0.84)에 걸리면 망토 밖으로 삐져나오므로, 끝 방향의 자락까지 거리에서 HEM_MARGIN을 뺀
 * 길이 안으로 부드럽게 줄인다 (걸으며 골을 지날 때 끝이 튀지 않게 tanh로 눌러 담는다)
 */
function tailSpine(a: MonsterTopAnchor): Spine {
  const dash = a.dash * (1 - a.stun);
  const loose = 1 - 0.6 * dash;
  const lat = (0.055 * Math.sin(a.cloak + 0.7) + 0.07 * a.s) * loose;
  const c: Pt = [lerp(-0.6, -0.64, dash) + 0.04 * a.stun, lerp(0.03, 0.0, dash) + lat * 0.45];
  const d0: Pt = [lerp(-0.72, -0.88, dash) + 0.08 * a.stun, lerp(0.35, 0.1, dash) + lat];
  const len = Math.hypot(d0[0], d0[1]);
  const room = hemReach(a.tail, d0[0] / len, d0[1] / len) - HEM_MARGIN;
  const knee = room - HEM_KNEE;
  const fit = len > knee ? knee + HEM_KNEE * Math.tanh((len - knee) / HEM_KNEE) : len;
  const d: Pt = [(d0[0] * fit) / len, (d0[1] * fit) / len];
  return {
    a: apply(a.headM, 0.1, 0),
    b: apply(a.headM, -0.24, 0),
    c: apply(a.body, c[0], c[1]),
    d: apply(a.body, d[0], d[1]),
  };
}

/** 꼬리 윤곽 점 (닫힌 매끄러운 곡선용): 한쪽 변 → 둥근 끝 → 다른 변 → 두건 속 뿌리. grow = 반폭 더하기 (그늘) */
function tailOutline(s: Spine, w0: number, grow = 0): Pt[] {
  const L: Pt[] = [];
  const R: Pt[] = [];
  for (let i = 0; i < TAIL_N; i += 1) {
    const t = i / TAIL_N;
    const w = w0 * (1 - t) ** TAIL_TAPER + grow;
    L.push(edge(s, t, w));
    R.push(edge(s, t, -w));
  }
  const end = spineAt(s, 1);
  const tip: Pt = [end.p[0] + end.u[0] * (0.035 + grow), end.p[1] + end.u[1] * (0.035 + grow)];
  const root = spineAt(s, 0);
  const back: Pt = [root.p[0] - root.u[0] * w0 * 0.8, root.p[1] - root.u[1] * w0 * 0.8];
  return [...L, tip, ...R.reverse(), back];
}

/** 꼬리 한쪽 변 (열린 선, 뿌리 t0 → 끝 근처) */
function tailSide(s: Spine, w0: number, side: 1 | -1, t0: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 6; i += 1) {
    const t = lerp(t0, 0.9, i / 6);
    out.push(edge(s, t, side * w0 * (1 - t) ** TAIL_TAPER));
  }
  return out;
}

/** 등뼈 방향 선형 칠 (뿌리 → 끝) */
function along(s: Spine, stops: readonly Stop[]): Paint {
  return linear(s.a[0], s.a[1], s.d[0], s.d[1], stops);
}

/**
 * 꼬리 밑 그늘 · 테 진하기. 생존자 화면에서 괴물이 보이는 정도를 기본과 같게 둔다(사용자 결정: 꾸미기는 유불리가 없다 —
 * tests/unit/costume-parity.test.ts): 꼬리는 망토 가장 밝은 등 가운데에 얹히므로, 그늘 · 짙은 테가 넓으면 밝은 등이 어둡게
 * 꺼진다 — 그늘은 꼬리 둘레 좁게 한 겹, 테는 얇고 옅게 둔다 (꼬리 칠의 밝은 빛이 그만큼을 되돌린다)
 */
const SHADOW_GROW = 0.035;
const SHADOW_A = 0.35;
const EDGE_A = 0.6;

function topCloak(sk: Sketch, a: MonsterTopAnchor): void {
  // 꼬리 밑 그늘: 위에서 비춘 빛이라 꼬리 둘레로 고르게 번진다 (뿌리 쪽은 두건이 덮는다)
  const s = tailSpine(a);
  const w0 = TAIL_W * lenScale(a.headM);
  const dark = a.ink(shade(MONSTER_COLOR.cloakDeep, 0.3));
  sk.fill(path().smooth(tailOutline(s, w0, SHADOW_GROW), 0.8).d, solid(dark, SHADOW_A));
}

function topHead(sk: Sketch, a: MonsterTopAnchor): void {
  const s = tailSpine(a);
  const H = a.headM;
  const kH = lenScale(H);
  const w0 = TAIL_W * kH;
  const d = path().smooth(tailOutline(s, w0), 0.8).d;
  // 두건과 같은 칠 (같은 자리 같은 색이라 뿌리 이음매가 없다)
  const [hx, hy] = apply(H, 0.42, 0);
  sk.fill(
    d,
    radial(hx, hy, 0.56 * kH, [
      [0, a.ink(tint(HOOD, 0.16))],
      [0.55, a.ink(tint(HOOD, 0.04))],
      [1, a.ink(shade(HOOD, 0.1))],
    ]),
  );
  // 등 위에 얹힌 천은 망토보다 높아 빛을 받는다: 뿌리에서 멀어질수록 두건 정수리 밝기로 (짙어지는 망토와 명암으로 갈린다)
  sk.fill(
    d,
    along(s, [
      [0, a.ink(tint(HOOD, 0.2)), 0],
      [0.28, a.ink(tint(HOOD, 0.2)), 0.75],
      [0.85, a.ink(tint(HOOD, 0.15)), 0.7],
      [1, a.ink(shade(HOOD, 0.04)), 0.5],
    ]),
  );
  // 둥근 천의 등 (위 빛을 받는 가운데 줄, 광택 없이 흐리게)
  const ridge: Pt[] = [];
  for (let i = 0; i <= 5; i += 1) ridge.push(spineAt(s, lerp(0.2, 0.8, i / 5)).p);
  sk.line(
    path().curve(ridge).d,
    along(s, [
      [0, a.ink(tint(HOOD, 0.3)), 0],
      [0.3, a.ink(tint(HOOD, 0.3)), 0.35],
      [0.85, a.ink(tint(HOOD, 0.3)), 0],
    ]),
    0.06 * kH,
  );
  // 접힌 주름: 뒤통수에서 등으로 넘어가는 곳 · 등 가운데 (꼬리를 가로지르는 얕은 호 둘 — 혀 · 촉수가 아니라 천으로 읽힌다)
  const fold = (t: number, bow: number, k: number): string => {
    const w = w0 * (1 - t) ** TAIL_TAPER * k;
    const mid = spineAt(s, t + bow);
    return path().curve([edge(s, t, w), mid.p, edge(s, t, -w)]).d;
  };
  const crease = solid(a.ink(shade(HOOD, 0.42)), 0.55);
  sk.line(fold(0.33, 0.05, 0.78), crease, 0.026 * kH);
  sk.line(fold(0.53, -0.035, 0.72), crease, 0.024 * kH);
  // 굽은 끝 안쪽 접힌 주름
  sk.line(
    path().curve([edge(s, 0.62, -w0 * 0.1), edge(s, 0.74, -w0 * 0.25), edge(s, 0.84, -w0 * 0.12)]).d,
    solid(a.ink(shade(HOOD, 0.5)), 0.7),
    0.028 * kH,
  );
  // 두 변: 두건 밖으로 나온 곳부터 짙은 진홍 테 (천 가장자리. 뿌리 쪽은 흐려져 두건 위에 선이 남지 않는다)
  const edgeC = a.ink(shade(HOOD, 0.62));
  const rim = along(s, [
    [0, edgeC, 0],
    [0.25, edgeC, 0],
    [0.45, edgeC, EDGE_A],
    [1, edgeC, EDGE_A],
  ]);
  for (const side of [1, -1] as const) sk.line(path().curve(tailSide(s, w0, side, 0.12)).d, rim, a.w * 0.4);
}

// ───────────────────────── 정면 그림: 꺾여 늘어진 고깔 ─────────────────────────

/**
 * 고깔 윤곽 (두건 기준 dx, dy — y = hy + dy). 기본 두건의 오른쪽 위(R1, 0.26 · −0.31)에서 위로 올라 꼭대기(−0.18 · −0.66)에서
 * 화면 왼쪽으로 꺾이고, 끝(−0.69 · −0.14)이 어깨 위로 처진다. 끝의 안쪽 변은 두건 왼쪽 옆으로 돌아와 이어진다.
 * k = 끝으로 가는 정도 (0 = 두건 몸, 1 = 끝 — 흔들림 크기)
 */
const CONE_UP: readonly { p: Pt; k: number }[] = [
  { p: [0.09, -0.47], k: 0 },
  { p: [-0.02, -0.59], k: 0.1 },
  { p: [-0.18, -0.66], k: 0.25 },
  { p: [-0.38, -0.645], k: 0.45 },
  { p: [-0.55, -0.56], k: 0.65 },
  { p: [-0.66, -0.42], k: 0.82 },
  { p: [-0.71, -0.27], k: 0.95 },
  { p: [-0.69, -0.14], k: 1 },
  { p: [-0.6, -0.2], k: 0.95 },
  { p: [-0.55, -0.33], k: 0.8 },
  { p: [-0.46, -0.43], k: 0.6 },
  { p: [-0.34, -0.48], k: 0.4 },
  { p: [-0.26, -0.45], k: 0.2 },
  { p: [-0.37, -0.27], k: 0 },
];

/** 상반신에서 고깔 높이 · 옆 배율 (상자 위 끝 y ≥ −1 · |x| ≤ 1: 상반신 배율이 커 꼭대기를 낮추고 끝을 조금 모은다) */
const BUST_RISE = 0.82;
const BUST_SIDE = 0.9;
/** 고깔이 두건 몸에서 솟기 시작하는 dy (이보다 위만 낮춘다) */
const RISE_FROM = -0.31;

/** 고깔 점 하나 (두건 좌표 → m 전 좌표): 상반신은 낮추고, 끝은 숨 · 바람에 흔들린다 */
function conePt(p: Pt, k: number, a: MonsterFrontAnchor): Pt {
  const up = a.bust && p[1] < RISE_FROM;
  const dy = up ? RISE_FROM + (p[1] - RISE_FROM) * BUST_RISE : p[1];
  const dx = a.bust ? p[0] * lerp(1, BUST_SIDE, Math.min(1, k * 2)) : p[0];
  const sway = Math.sin(a.t * 1.6) * 0.022 + Math.sin(a.t * 0.7 + 1) * 0.01;
  return [dx + sway * k, a.hy + dy + Math.abs(sway) * 0.4 * k * k];
}

function frontHood(hood: readonly Pt[], a: MonsterFrontAnchor): readonly Pt[] {
  // 기본 두건: 0 = 꼭대기, 1 = 오른쪽 위 … 9 = 왼쪽 위. 꼭대기 · 왼쪽 위를 빼고 고깔 점들로 바꾼다
  const body = hood.slice(1, 9);
  return [
    ...body,
    ...CONE_UP.slice()
      .reverse()
      .map((c) => conePt(c.p, c.k, a)),
  ];
}

/** 정면 고깔 주름 · 빛 (두건 위, 얼굴보다 한참 위) */
function frontOver(sk: Sketch, a: MonsterFrontAnchor): void {
  const M = a.m;
  const ls = a.ls;
  const at = (x: number, y: number, k: number): Pt => conePt([x, y], k, a);
  // 끝 아랫면 그늘 (빛을 등진 안쪽 변을 따라 — 둥근 천 대롱으로 읽힌다)
  sk.line(
    path(M).curve([
      at(-0.62, -0.21, 0.95),
      at(-0.575, -0.33, 0.8),
      at(-0.48, -0.415, 0.6),
      at(-0.36, -0.46, 0.4),
    ]).d,
    solid(a.ink(shade(HOOD, 0.45)), 0.45),
    0.045 * ls,
  );
  // 꺾인 곳 주름: 안쪽 오목한 곳에서 고깔 몸으로 들어가는 짙은 골 + 그 위 빛을 받는 접힌 턱
  sk.line(
    path(M).curve([at(-0.27, -0.47, 0.25), at(-0.17, -0.535, 0.15), at(-0.05, -0.565, 0.08)]).d,
    solid(a.ink(shade(HOOD, 0.5)), 0.8),
    0.03 * ls,
  );
  sk.line(
    path(M).curve([at(-0.23, -0.515, 0.25), at(-0.14, -0.565, 0.15), at(-0.05, -0.59, 0.1)]).d,
    solid(a.ink(tint(HOOD, 0.22)), 0.5),
    0.022 * ls,
  );
  // 끝 윗면 빛 (왼쪽 위에서 오는 빛)
  sk.line(
    path(M).curve([
      at(-0.2, -0.61, 0.27),
      at(-0.37, -0.585, 0.45),
      at(-0.52, -0.49, 0.65),
      at(-0.6, -0.37, 0.85),
    ]).d,
    solid(a.ink(tint(HOOD, 0.3)), 0.6),
    0.03 * ls,
  );
  // 오른쪽 림 라이트 이어 긋기 (기본 두건의 림이 끝나는 곳에서 꼭대기까지, 위로 흐려진다)
  sk.line(
    path(M).curve([at(0.06, -0.455, 0), at(-0.03, -0.565, 0.1), at(-0.15, -0.625, 0.25)]).d,
    linear(...apply(M, 0, a.hy - 0.45), ...apply(M, 0, a.hy - 0.63), [
      [0, a.rim, 0.9],
      [1, a.rim, 0],
    ]),
    0.032 * ls,
  );
}

export const HOOD_ART: MonsterCostumeArt = {
  id: 'hood',
  topCloak,
  topHead,
  frontHood,
  frontOver,
};
