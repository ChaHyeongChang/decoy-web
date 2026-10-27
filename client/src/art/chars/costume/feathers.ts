// 의상 '까마귀 깃' (괴물 의상 250 불씨, 판 밖 메타 c): 어깨를 덮는 깃털 목도리 망토. 깃은 끝이 둥글고 지붕 기와처럼
// 줄지어 겹친다 — 뾰족한 깃 · 가시는 없다(사용자 결정: 뿔 · 가시 없음). 붉은 두건 · 망토 자락은 그대로 보인다.
// 위 그림(topCloak — 망토 위, 두건 · 팔 밑): 두건 밑동을 둘러 어깨에서 어깨까지, 등 위쪽으로 넘어가는 말굽 모양 깃 두 줄.
// 바깥 줄을 먼저 깔고 목 쪽 줄을 얹어 둥근 깃 끝이 바깥을 향한다(띠가 얇은 뒤쪽은 깃을 촘촘히 놓아 넓적한 기와 · 구슬이 아닌
// 길쭉한 깃으로 읽힌다. 깃 사이 짙은 테는 깃 끝에만 얇게). 목 둘레(안쪽 테)는 안으로 둥글게 솟은 작은 깃 끝이라 붉은 등이
// 구멍처럼 파여 보이지 않는다 — 끝도 몸 가운데 0.45r 원판 밖(역할색 그대로). 앞 끝은 두건 옆 · 소매 밑으로 숨는다. 어깨에서는
// 깃 끝이 망토 밖으로 살짝 나와 어깨선이 부드러운 물결이 되고, 뒤는 망토 위쪽만 덮어 톱니 자락 끝이 깃 밖으로 붉게 남는다.
// 위 그림은 생존자 화면에도 보이므로 보이는 정도(밝기 · 외곽 대비 · 면적)를 기본과 같게 둔다(사용자 결정: 꾸미기는 유불리가
// 없다 — tests/unit/costume-parity.test.ts). 그래서 위 그림 깃은 검지 않고 덮는 망토와 같은 돔 음영의 진홍이며, 아랫줄 깃
// 뿌리 그늘 · 위 빛을 받은 깃 끝 광택 · 밝은 깃대로 층진 깃의 결을 낸다. 휴대폰 크기에서는 붉은 몸 둘레의 잔 비늘 결로 읽히고
// 몸이 어두운 띠로 꺼지지 않는다 (앞은 열려 있어 짙은 얼굴 그늘 · 흰 발톱이 그대로 앞을 알린다).
// 정면 그림(frontMantle — 어깨 망토 위, 두건 밑, 로비 · 옷장): 두건 밑동에서 어깨를 덮는 길쭉한 둥근 검은 깃 세 줄 (가슴은 두
// 줄이 두건 밑으로 보인다). 깃마다 깃대와 빛 쪽(왼쪽) 날개의 진홍 광택, 줄 밑 그늘. 어깨 위는 깃이 부풀어 둥글고 오른쪽 어깨
// 테에 붉은 림 라이트, 어깨 망토의 붉은 톱니 끝이 깃 아래로 조금 남는다. 상반신은 손이 깃 아래를 쥔다. 얼굴 · 눈 · 발톱은
// 덮지 않는다.
// 움직임: 깃 끝이 망토 물결 · 걸음에 따라 조금씩 들썩이고 옆으로 쏠린다. 포효 = 깃을 곤두세워 부풀고, 돌진 = 바람에
// 뒤로 눕고, 기절 = 축 처진다. 정면은 숨 · 시각에 따라 들썩인다. 깃 길이는 줄마다 좌우 대칭으로 조금씩 다르다.
// 색: 위 그림 깃 바탕 #F34C5E(조금 푸른 쪽 진홍)를 망토와 같은 돔 음영 정지점으로(목 쪽 6% 밝게 → 자락 끝 66% 어둡게), 아랫줄
// 뿌리 그늘 #2A080E 42% · 끝 광택 #FFB3BA(목 쪽 줄 50% · 바깥 줄 30%) · 깃대 #FFC2C8 45%, 윗줄 그늘 · 틈 #2A080E,
// 깃 밑 그늘 #3F0D12(짙은 진홍 #5A1219를 30% 어둡게). 정면 깃 #2A1416(왼쪽 위) → #1A0B0E → #110709 (거의 검게), 광택 진홍
// #7F1D1D · 빛 쪽 #9B2C2C, 깃대 #5A2A30, 겹친 깃 그늘 #0B0405, 정면 림 라이트 = 기본 괴물 림 색(어깨 오른쪽 강하게 · 왼쪽
// 약하게). 청록 없음.
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
  type Path,
  type Sketch,
  type Stop,
} from '../kit';
import type { MonsterCostumeArt, MonsterFrontAnchor, MonsterTopAnchor, Pt } from './types';

/** 깃 색 (정면 그림 · 깃 밑 그늘) */
const F = {
  base: 0x2a1416,
  deep: MONSTER_COLOR.face,
  sheen: 0x7f1d1d,
  glint: 0x9b2c2c,
  shaft: 0x5a2a30,
  gap: 0x0b0405,
  under: shade(MONSTER_COLOR.cloakDeep, 0.3),
} as const;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const add = (p: Pt, q: Pt, k = 1): Pt => [p[0] + q[0] * k, p[1] + q[1] * k];

/** 변환의 길이 배율 */
function lenScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** 변환을 따르는 칠 (kit 칠은 경로 변환을 따르지 않는다) */
function lin(m: Mat, x0: number, y0: number, x1: number, y1: number, stops: readonly Stop[]): Paint {
  const [a, b] = apply(m, x0, y0);
  const [c, d] = apply(m, x1, y1);
  return linear(a, b, c, d, stops);
}

function rad(m: Mat, cx: number, cy: number, r: number, stops: readonly Stop[]): Paint {
  const [a, b] = apply(m, cx, cy);
  return radial(a, b, r * lenScale(m), stops);
}

/** 변환 m 뒤에 (dx, dy) 옮기기 (그늘) */
function shifted(m: Mat, dx: number, dy: number): Mat {
  return [m[0], m[1], m[2], m[3], m[4] + m[0] * dx + m[2] * dy, m[5] + m[1] * dx + m[3] * dy];
}

// ───────────────────────── 깃 줄 (위 · 정면 같이 쓴다) ─────────────────────────

/** 깃 하나: 골 a → 둥근 끝 t → 골 b. o = 바깥(끝 쪽) 단위 방향, u = a → b 단위 방향, w = 폭, h = 끝 높이 */
interface Feather {
  readonly a: Pt;
  readonly t: Pt;
  readonly b: Pt;
  readonly o: Pt;
  readonly u: Pt;
  readonly w: number;
  readonly h: number;
}

/**
 * 골 점들 사이마다 깃 하나. from = 줄 안쪽 기준점 (끝이 from에서 멀어지는 쪽, toward = true면 from 쪽), h(j) = 끝 높이,
 * lean(j) = 끝이 폭 방향으로 쏠리는 비율 (걸음 · 돌진 바람)
 */
function feathers(
  notches: readonly Pt[],
  from: Pt,
  h: (j: number) => number,
  lean: (j: number) => number,
  toward = false,
): Feather[] {
  const out: Feather[] = [];
  for (let j = 0; j + 1 < notches.length; j += 1) {
    const a = notches[j] ?? [0, 0];
    const b = notches[j + 1] ?? a;
    const w = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    const u: Pt = [(b[0] - a[0]) / w, (b[1] - a[1]) / w];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let o: Pt = [-u[1], u[0]];
    const away = (mid[0] - from[0]) * o[0] + (mid[1] - from[1]) * o[1] >= 0;
    if (away === toward) o = [u[1], -u[0]];
    const hh = h(j);
    out.push({ a, t: add(add(mid, o, hh), u, lean(j) * w), b, o, u, w, h: hh });
  }
  return out;
}

/** 깃마다 길이 차이 (가운데 기준 좌우 대칭 — 줄마다 고른 톱니로 보이지 않게). j = 깃 번호, n = 깃 수, k = 줄 */
function vary(j: number, n: number, k: number): number {
  const c = Math.abs(j - (n - 1) / 2);
  return 1 + 0.11 * Math.cos(c * 2.3 + k * 1.7);
}

/** 둥근 끝 손잡이: 골에서 바깥으로 (h 배 — 클수록 옆선이 곧은 긴 깃) · 끝에서 폭 방향으로 (w 배 — 끝의 둥근 정도) */
const K_OUT = 0.85;
const K_TIP = 0.27;

/** 깃 하나의 두 3차 곡선 조절점 */
function tipCtrl(f: Feather): [Pt, Pt, Pt, Pt] {
  return [
    add(f.a, f.o, f.h * K_OUT),
    add(f.t, f.u, -f.w * K_TIP),
    add(f.t, f.u, f.w * K_TIP),
    add(f.b, f.o, f.h * K_OUT),
  ];
}

/** 깃들의 둥근 끝 곡선을 경로에 잇는다 (지금 점 = 첫 깃의 골) */
function tips(p: Path, fs: readonly Feather[]): void {
  for (const f of fs) {
    const [c1, c2, c3, c4] = tipCtrl(f);
    p.C(c1[0], c1[1], c2[0], c2[1], f.t[0], f.t[1]).C(c3[0], c3[1], c4[0], c4[1], f.b[0], f.b[1]);
  }
}

/**
 * 깃 줄 윤곽 (닫힌 경로): 첫 골 → 둥근 끝 · 골 … → 마지막 골 → 안쪽 테 → 첫 골. 안쪽 테는 back(숨는 테를 지나는 매끈한
 * 곡선) 또는 inner(목 쪽 작은 깃 끝들 — 마지막 골 쪽에서 시작)
 */
function rowPath(m: Mat, fs: readonly Feather[], back: readonly Pt[], inner?: readonly Feather[]): string {
  const first = fs[0];
  const last = fs[fs.length - 1];
  if (!first || !last) return '';
  const p = path(m).M(first.a[0], first.a[1]);
  tips(p, fs);
  const in0 = inner?.[0];
  if (inner && in0) {
    p.L(in0.a[0], in0.a[1]);
    tips(p, inner);
    return p.Z().d;
  }
  return p.curve([last.b, ...back, first.a], 1, false).Z().d;
}

/** 깃 가운데 점 (뿌리 쪽 k = 0 → 끝 k = 1, 끝 높이 기준. 0 아래는 윗줄 깃 밑) */
function along(f: Feather, k: number, side = 0): Pt {
  return add(add(f.t, f.o, -f.h * (1 - k) * 1.6), f.u, side * f.w);
}

/** 깃대 (깃 가운데 줄, 뿌리 root → 끝 조금 안). 한 경로에 깃마다 하위 경로 */
function shaftPath(m: Mat, fs: readonly Feather[], root = 0.1): string {
  const p = path(m);
  for (const f of fs) {
    const r = along(f, root);
    const e = along(f, 0.82);
    p.M(r[0], r[1]).L(e[0], e[1]);
  }
  return p.d;
}

/** 깃 한쪽 날개 광택 (깃대 옆 가는 잎 모양 — 한 경로에 깃마다 하위 경로). side = 빛 쪽 (−: u 반대) */
function vanePath(m: Mat, fs: readonly Feather[], side: number): string {
  const p = path(m);
  for (const f of fs) {
    const a0 = along(f, 0.3, side * 0.03);
    const a1 = along(f, 0.5, side * 0.3);
    const a2 = along(f, 0.84, side * 0.24);
    const a3 = along(f, 0.93, side * 0.04);
    const b1 = along(f, 0.78, side * 0.07);
    const b2 = along(f, 0.5, side * 0.06);
    p.M(a0[0], a0[1])
      .C(a1[0], a1[1], a2[0], a2[1], a3[0], a3[1])
      .C(b1[0], b1[1], b2[0], b2[1], a0[0], a0[1])
      .Z();
  }
  return p.d;
}

/** 이웃 깃 사이 골에서 뿌리 쪽으로 짧은 틈 (윗줄 깃 밑으로 들어간다) */
function gapPath(m: Mat, fs: readonly Feather[], len: number): string {
  const p = path(m);
  for (let j = 1; j < fs.length; j += 1) {
    const f0 = fs[j - 1];
    const f1 = fs[j];
    if (!f0 || !f1) continue;
    const o: Pt = [(f0.o[0] + f1.o[0]) / 2, (f0.o[1] + f1.o[1]) / 2];
    const end = add(f1.a, o, -len);
    p.M(f1.a[0], f1.a[1]).L(end[0], end[1]);
  }
  return p.d;
}

// ───────────────────────── 위 그림: 두건 밑동을 두른 말굽 깃 ─────────────────────────

/** 안쪽 테 (목 둘레) 반지름 · 그 안쪽으로 둥글게 솟은 작은 깃 끝 높이 (끝이 몸 가운데 0.45r 원판 밖에 머문다) */
const R_IN = 0.5;
const NECK_H = 0.032;
/** 바깥 테가 끝나는 각 (뒤에서 잰 반각, 라디안) — 앞 끝은 두건 옆 밑 */
const PHI_END = 2.25;

/** 바깥 테 반지름 (뒤에서 잰 각 φ): 뒤 0.72 → 옆 0.97 → 앞 끝으로 두건 옆까지 줄어든다 */
function rOut(phi: number): number {
  const p = Math.abs(phi);
  if (p <= Math.PI / 2) return 0.72 + 0.25 * Math.sin(p) ** 2;
  const k = Math.min(1, (p - Math.PI / 2) / (PHI_END - Math.PI / 2));
  return 0.97 - 0.37 * k * k;
}

/** 위 그림 깃 줄 (바깥 → 안): 깃 수 · 반각 · 끝이 띠 안에서 놓이는 비율 · 띠 폭에 대한 끝 높이 */
const TOP_ROWS: readonly { n: number; span: number; f: number; h: number }[] = [
  { n: 13, span: 2.2, f: 0.97, h: 0.5 },
  { n: 12, span: 2.02, f: 0.55, h: 0.5 },
];

/**
 * 깃 간격 (−1~1 → −1~1): 뒤 가운데는 촘촘하고 옆으로 갈수록 넓다. 띠가 얇은 뒤에서도 깃이 넓적한 기와가 되지 않고 띠가
 * 넓은 옆과 비슷한 길쭉한 비율이 된다
 */
const SPREAD_BACK = 0.62;
const spread = (t: number): number => t * (SPREAD_BACK + (1 - SPREAD_BACK) * t * t);

/** 뒤에서 잰 각 φ · 반지름 → 목 좌표 점 (φ = 0 뒤, +φ = +y 쪽) */
const polar = (phi: number, r: number): Pt => [-Math.cos(phi) * r, Math.sin(phi) * r];

/** 위 그림 깃 한 줄 (목 좌표). grow = 그늘용으로 바깥으로 키우기 */
function topRow(a: MonsterTopAnchor, k: number, grow = 0): { fs: Feather[]; inner: Feather[] } {
  const row = TOP_ROWS[k] ?? { n: 10, span: 2, f: 1, h: 0.34 };
  const dash = a.dash * (1 - a.stun);
  // 들썩임 세기: 서 있어도 조금, 걸으면 더
  const ruffle = 0.1 + 0.14 * a.stride;
  const puff = 1 + 0.25 * a.roar - 0.25 * dash - 0.3 * a.stun;
  const push = 0.02 * a.roar - 0.02 * a.stun;
  const phiAt = (j: number): number => row.span * spread(-1 + (2 * j) / row.n) + 0.05 * a.s * (1 - k * 0.3);
  const notches: Pt[] = [];
  for (let j = 0; j <= row.n; j += 1) {
    const phi = phiAt(j);
    const band = rOut(phi) - R_IN;
    notches.push(polar(phi, R_IN + band * (row.f - row.h) + push + grow));
  }
  const fs = feathers(
    notches,
    [0, 0],
    (j) => {
      const band = rOut(phiAt(j + 0.5)) - R_IN;
      const ruf = 1 + ruffle * Math.sin(a.cloak * 1.3 + j * 1.9 + k * 2.1);
      return (band * row.h * puff * vary(j, row.n, k) + grow) * ruf;
    },
    (j) => {
      // 돌진: 끝이 뒤 가운데(φ = 0) 쪽으로 눕는다. 걸음: 옆으로 쏠린다
      return -Math.sign(phiAt(j + 0.5)) * 0.25 * dash + 0.1 * a.s;
    },
  );
  // 목 둘레: 안쪽으로 둥글게 솟은 작은 깃 끝 (뒤 끝 → 앞 끝 거꾸로, 원판 쪽을 향한다)
  const span = row.span + 0.02;
  const nIn = Math.round(span * 4.4);
  const ring: Pt[] = [];
  for (let i = 0; i <= nIn; i += 1) ring.push(polar(span - (2 * span * i) / nIn, R_IN));
  const inner = feathers(
    ring,
    [0, 0],
    () => NECK_H,
    () => 0,
    true,
  );
  return { fs, inner };
}

/**
 * 위 그림 깃 색 (게임 화면). 생존자 화면에서 괴물이 보이는 정도(밝기 · 외곽 대비)를 기본과 같게 둔다(사용자 결정: 꾸미기는
 * 유불리가 없다 — tests/unit/costume-parity.test.ts). 깃 줄 바탕은 덮는 망토와 같은 돔 음영(monster.ts 위 망토: 몸 좌표
 * (0.15, 0) 중심 · 같은 정지점 — 목 쪽이 밝고 자락 끝으로 짙다)을 망토보다 조금 푸른 쪽 진홍으로 칠하고, 깃마다 뿌리(윗줄 밑)는
 * 짙게 · 끝은 위 빛을 받아 번들거리게 얹는다. 짙은 뿌리가 낮춘 밝기를 밝은 끝이 되돌리고, 겹친 줄마다 밝은 끝이 아랫줄 짙은
 * 뿌리 위에 놓여 층진 깃으로 읽힌다. 바깥 줄 밝은 끝이 어깨 실루엣 가장자리에 오므로 안개 · 어둠 속에서도 붉은 테두리가
 * 바닥과 갈린다. 정면 그림(로비 · 옷장)은 검은 까마귀 깃 그대로다
 */
const TF = {
  /** 깃 바탕 (괴물 역할색 #EF4444와 밝기가 비슷한, 조금 푸른 쪽 진홍) */
  body: 0xf34c5e,
  /** 깃 뿌리 그늘 · 끝 광택 · 깃대 */
  root: 0x2a080e,
  gloss: 0xffb3ba,
  shaft: 0xffc2c8,
  /** 윗줄 그늘 · 틈 */
  gap: 0x2a080e,
} as const;

/** 깃 뿌리 그늘 · 끝 광택 진하기 */
const ROOT_A = 0.42;
/** 끝 광택 진하기: 맨 윗줄(목 쪽, 가장 높은 곳) · 바깥 줄 */
const GLOSS_TOP = 0.55;
const GLOSS_OUT = 0.28;

/** 망토 돔 음영 정지점 (monster.ts 위 망토와 같다): [거리 / 1.45, 어둡게 할 비율 (음수 = 밝게)] */
const DOME: readonly (readonly [number, number])[] = [
  [0, -0.06],
  [0.34, 0],
  [0.55, 0.3],
  [0.78, 0.56],
  [1, 0.66],
];

const domed = (c: number, k: number): number => (k < 0 ? tint(c, -k) : shade(c, k));

/** 깃 하나 (닫힌 경로: 골 a → 둥근 끝 → 골 b → a) */
function featherPath(m: Mat, f: Feather): string {
  const p = path(m).M(f.a[0], f.a[1]);
  tips(p, [f]);
  return p.Z().d;
}

/** 깃 끝 곡선만 (열린 경로: 첫 골 → 둥근 끝 · 골 … → 마지막 골) */
function tipLine(m: Mat, fs: readonly Feather[]): string {
  const first = fs[0];
  if (!first) return '';
  const p = path(m).M(first.a[0], first.a[1]);
  tips(p, fs);
  return p.d;
}

function topCloak(sk: Sketch, a: MonsterTopAnchor): void {
  const N = a.neck;
  const ink = a.ink;
  const ls = lenScale(N);
  // 깃 밑 그늘 (위 빛: 바깥 테 둘레로 고르게 번진다 — 안쪽 테는 원판 밖 그대로)
  const shadow = topRow(a, 0, 0.025);
  sk.fill(rowPath(N, shadow.fs, [], shadow.inner), solid(ink(F.under), 0.3));
  // 줄 바탕: 망토와 같은 돔 음영
  const base = rad(
    a.body,
    0.15,
    0,
    1.45,
    DOME.map(([t, k]): Stop => [t, ink(domed(TF.body, k))]),
  );
  for (let k = 0; k < TOP_ROWS.length; k += 1) {
    const { fs, inner } = topRow(a, k);
    // 윗줄 깃이 드리운 그늘 (아랫줄 위로)
    if (k > 0) {
      const g = topRow(a, k, 0.03);
      sk.fill(rowPath(N, g.fs, [], g.inner), solid(ink(TF.gap), 0.3));
    }
    // 안쪽 가는 선은 깃 끝에만 얇게 (굵으면 깃마다 짙은 테가 둘려 구슬 · 기와처럼 읽힌다. 목 둘레 작은 깃 끝에 그으면 가장
    // 밝은 목 둘레가 짙은 고리로 꺼진다)
    sk.part(rowPath(N, fs, [], inner), base, a.outline, undefined, 0);
    sk.line(tipLine(N, fs), solid(a.outline, 0.6), a.w * 0.1);
    // 깃마다 뿌리 그늘 → 끝 광택 (골 줄 ≈ along 0.375에서 끝까지). 뿌리 그늘은 윗줄 밑에 든 아랫줄만 — 맨 윗줄 뿌리는 목
    // 둘레 가장 높은 곳이라 위 빛을 받는다
    const top = k === TOP_ROWS.length - 1;
    for (const f of fs) {
      const r0 = along(f, 0.35);
      sk.fill(
        featherPath(N, f),
        lin(N, r0[0], r0[1], f.t[0], f.t[1], [
          [0, ink(TF.root), top ? 0 : ROOT_A],
          [0.45, ink(TF.root), 0],
          [0.6, ink(TF.gloss), 0],
          [1, ink(TF.gloss), top ? GLOSS_TOP : GLOSS_OUT],
        ]),
      );
    }
    // 맨 윗줄(목 쪽)은 틈을 긋지 않고 깃대 뿌리를 골 줄에서 시작한다 (안쪽 테 밖 붉은 망토에 금이 생기지 않게)
    if (!top) sk.line(gapPath(N, fs, 0.08), solid(ink(TF.gap), 0.6), 0.018 * ls);
    // 깃대: 끝 쪽으로 밝은 가는 줄
    sk.line(shaftPath(N, fs, top ? 0.42 : 0.3), solid(ink(TF.shaft), 0.45), 0.014 * ls);
  }
}

// ───────────────────────── 정면 그림: 어깨를 덮는 깃 목도리 ─────────────────────────

/** 정면 깃 줄 (바깥 · 아래 → 위): 골 줄 반폭 xe · 가운데 높이 yc · 어깨 쪽 올림 dy · 깃 수 · 끝 높이 */
const FRONT_ROWS: readonly { xe: number; yc: number; dy: number; n: number; h: number }[] = [
  { xe: 0.63, yc: 0.06, dy: 0.14, n: 7, h: 0.24 },
  { xe: 0.6, yc: -0.05, dy: 0.14, n: 6, h: 0.2 },
  { xe: 0.55, yc: -0.16, dy: 0.12, n: 5, h: 0.17 },
];

/** 목도리 위 테 (오른쪽 어깨 바깥 → 가운데, 숨쉬기 by 전). 어깨 망토 위로 조금 부푼다 */
const FRONT_TOP: readonly Pt[] = [
  [0.68, -0.11],
  [0.62, -0.215],
  [0.48, -0.28],
  [0.24, -0.31],
];

/** 림 라이트 선 (오른쪽, 숨쉬기 by 전): 바깥 줄 위 테(FRONT_TOP 1~3 · 어깨 끝 골)에서 안으로 0.02쯤 들인 곡선 */
const FRONT_RIM: readonly Pt[] = [
  [0.3, -0.288],
  [0.475, -0.262],
  [0.598, -0.2],
  [0.61, -0.118],
];

function frontRow(a: MonsterFrontAnchor, k: number): { fs: Feather[]; back: Pt[] } {
  const row = FRONT_ROWS[k] ?? { xe: 0.6, yc: 0, dy: 0.15, n: 6, h: 0.16 };
  const by = a.by;
  const notches: Pt[] = [];
  for (let j = 0; j <= row.n; j += 1) {
    const x = lerp(-row.xe, row.xe, j / row.n);
    notches.push([x, row.yc - row.dy * (x / row.xe) ** 2 + by]);
  }
  const fs = feathers(
    notches,
    [0, -0.6 + by],
    (j) => row.h * vary(j, row.n, k) * (1 + 0.06 * Math.sin(a.t * 1.9 + j * 1.7 + k * 2.3)),
    (j) => 0.04 * Math.sin(a.t * 1.3 + j * 0.6 + k),
  );
  const endY = row.yc - row.dy + by;
  const right = FRONT_TOP.map(([x, y]): Pt => [x, y + by]).filter(([, y]) => y < endY - 0.03);
  const left = right.map(([x, y]): Pt => [-x, y]).reverse();
  return { fs, back: [...right, [0, -0.315 + by], ...left] };
}

/** 정면 깃 칠 (왼쪽 위 빛) */
function frontBody(a: MonsterFrontAnchor): Paint {
  return lin(a.m, -0.55, -0.3 + a.by, 0.5, 0.35 + a.by, [
    [0, a.ink(F.base)],
    [0.45, a.ink(F.deep)],
    [1, a.ink(shade(F.deep, 0.35))],
  ]);
}

/** 정면 깃 광택 칠 (왼쪽 빛 쪽이 밝은 진홍) */
function frontSheen(a: MonsterFrontAnchor): Paint {
  return lin(a.m, -0.6, 0, 0.6, 0, [
    [0, a.ink(F.glint), 0.85],
    [0.5, a.ink(F.sheen), 0.65],
    [1, a.ink(F.sheen), 0.4],
  ]);
}

function frontMantle(sk: Sketch, a: MonsterFrontAnchor): void {
  const M = a.m;
  const ink = a.ink;
  const ls = a.ls;
  const by = a.by;
  // 빛은 왼쪽 위: 왼쪽 위 깃이 조금 밝고 오른쪽 아래로 짙어진다 (거의 검게 — 광택만 진홍)
  const body = frontBody(a);
  const sheen = frontSheen(a);
  for (let k = 0; k < FRONT_ROWS.length; k += 1) {
    const { fs, back } = frontRow(a, k);
    // 깃 밑 그늘 (아래 줄 · 어깨 망토 위로 조금 아래에)
    sk.fill(rowPath(shifted(M, 0.01, 0.035), fs, back), solid(ink(F.gap), 0.5));
    sk.part(rowPath(M, fs, back), body, a.outline, undefined, 0.5);
    sk.line(gapPath(M, fs, 0.07), solid(ink(F.gap), 0.7), 0.016 * ls);
    sk.fill(vanePath(M, fs, -1), sheen);
    sk.line(shaftPath(M, fs), solid(ink(F.shaft), 0.9), 0.014 * ls);
  }
  // 림 라이트: 목도리 위 테 안쪽을 따라 (오른쪽 강하게, 왼쪽 약하게). 바깥 줄 위 테보다 안으로 들여 실루엣 밖에 뜨지 않는다
  for (const side of [-1, 1]) {
    const pts = FRONT_RIM.map(([x, y]): Pt => [side * x, y + by]);
    sk.line(
      path(M).curve(pts).d,
      lin(M, side * 0.3, -0.28 + by, side * 0.6, -0.12 + by, [
        [0, a.rim, 0],
        [0.45, a.rim, side > 0 ? 0.9 : 0.3],
        [1, a.rim, side > 0 ? 0.65 : 0.2],
      ]),
      0.026 * ls,
    );
  }
}

export const FEATHERS_ART: MonsterCostumeArt = {
  id: 'feathers',
  topCloak,
  frontMantle,
};
