// 의상 '까마귀 깃' (괴물 의상 250 불씨, 판 밖 메타 c): 어깨를 덮는 검은 까마귀 깃 목도리 망토. 깃은 끝이 둥글고 지붕 기와처럼
// 줄지어 겹친다 — 뾰족한 깃 · 가시는 없다(사용자 결정: 뿔 · 가시 없음). 붉은 두건 · 망토 자락은 그대로 보인다.
// 위 그림(topCloak — 망토 위, 두건 · 팔 밑): 두건 밑동을 둘러 어깨에서 어깨까지, 등 위쪽으로 넘어가는 말굽 모양 깃 두 줄.
// 바깥 줄을 먼저 깔고 목 쪽 줄을 얹어 둥근 깃 끝이 바깥을 향한다. 깃은 좁고 길게(바깥 17 · 목 쪽 15개) 놓고 쉴 때도 끝이 뒤
// 가운데 쪽으로 눕는다 — 두건 둘레로 고르게 퍼지면 꽃잎 · 톱니로 읽힌다. 목 둘레(안쪽 테)는 안으로 둥글게 솟은 작은 깃 끝이라
// 붉은 등이 구멍처럼 파여 보이지 않는다 — 끝도 몸 가운데 0.45r 원판 밖(역할색 그대로). 앞 끝은 두건 옆 · 소매 밑으로 숨는다.
// 어깨에서는 깃 끝이 망토 밖으로 살짝 나와 어깨선이 부드러운 물결이 되고, 뒤는 망토 위쪽만 덮어 톱니 자락 끝이 깃 밖으로 남는다.
// 위 그림은 정면과 같은 검은 깃이 위 빛을 받은 모습이다: 깃 몸은 검붉은 색, 깃마다 깃대를 따라 갈라진 두 날개 중 빛 쪽(앞 ·
// 두건 쪽, 좌우 거울 대칭) 날개에 진홍 광택 띠, 그늘 쪽 날개에 옅은 광택, 띠 한가운데 짧은 깃대 빛줄. 목 쪽 줄 뿌리(두건 그늘
// 속)와 바깥 줄 끝(어깨 비탈)은 검붉게 남아 휴대폰 크기에서는 두건 둘레의 짙은 얼룩 고리로 읽힌다 (기본 괴물은 매끈한 붉은 돔).
// 위 그림은 생존자 화면에도 보이므로 보이는 정도(밝기 · 외곽 대비 · 조각별 대비 · 바닥 대비 면적 · 면적)를 기본과 같게 둔다
// (사용자 결정: 꾸미기는 유불리가 없다 — tests/unit/costume-parity.test.ts). 그래서 정면처럼 거의 검게 칠하지 못한다: 거의 검은
// 칠은 바닥(#0F1A24쯤)과 대비 1.5가 안 되어 '바닥 대비 면적'을 깎고 밝기를 떨어뜨린다 → 깃 몸은 바닥과 대비 1.5를 넘는 가장
// 짙은 쪽(채도를 죽인 검붉은 색)이고, 덮은 망토(목 둘레가 가장 밝다)보다 짙어진 몫은 채도 높은 진홍 광택이 되돌린다. 분홍 ·
// 연어색(옅은 칠을 넓게)은 쓰지 않는다. 휴대폰 크기에서 테두리 띠(실루엣 안쪽)는 기본과 같은 밝기로 둔다.
// 정면 그림(frontMantle — 어깨 망토 위, 두건 밑, 로비 · 옷장): 두건 밑동에서 어깨를 덮는 길쭉한 둥근 검은 깃 세 줄 (가슴은 두
// 줄이 두건 밑으로 보인다). 깃마다 깃대와 빛 쪽(왼쪽) 날개의 진홍 광택, 줄 밑 그늘. 어깨 위는 깃이 부풀어 둥글고 오른쪽 어깨
// 테에 붉은 림 라이트, 어깨 망토의 붉은 톱니 끝이 깃 아래로 조금 남는다. 상반신은 손이 깃 아래를 쥔다. 얼굴 · 눈 · 발톱은
// 덮지 않는다. 날개 광택은 왼쪽(빛 쪽)일수록 위 그림 광택 쪽 진홍으로 밝아 옷장에서 두 그림이 한 의상으로 읽힌다.
// 움직임: 깃 끝이 망토 물결 · 걸음에 따라 조금씩 들썩이고 옆으로 쏠린다. 포효 = 깃을 곤두세워 부풀고(광택 띠는 쉴 때 자리,
// 늘어난 끝은 그늘), 돌진 = 바람에 뒤로 더 눕고, 기절 = 축 처진다(짧아져 누운 깃은 광택 띠가 넓어진다). 정면은 숨 · 시각에
// 따라 들썩인다. 깃 길이는 줄마다 좌우 대칭으로 조금씩 다르다.
// 색: 위 그림 깃 몸 #702A2E(채도를 죽인 검붉은 색 — 휘도 0.053, 바닥 대비 1.5 위), 광택 띠 #FF3D4A → #E8323F(채도 높은 진홍,
// 빛 쪽 날개 100% · 그늘 쪽 60%), 깃대 빛줄 #FF5A64 90%, 깃 사이 틈 · 깃 끝 가는 선 · 목 쪽 줄 그늘 #12050A(옅게, 칸보다 가늘게).
// 정면 깃 #2A1416(왼쪽 위) → #1A0B0E → #110709 (거의 검게), 날개 광택 #C8283A(빛 쪽) → #9B2C2C → #7F1D1D, 깃대 #5A2A30,
// 겹친 깃 그늘 #0B0405, 정면 림 라이트 = 기본 괴물 림 색(어깨 오른쪽 강하게 · 왼쪽 약하게). 보라 · 자홍 · 청록 없음.
import { MONSTER_COLOR } from '../monster';
import {
  apply,
  linear,
  path,
  shade,
  solid,
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
  /** 빛 쪽 가장 밝은 광택 (위 그림 광택 띠와 같은 진홍 쪽 — 두 그림이 한 의상으로 읽히게) */
  hot: 0xc8283a,
  shaft: 0x5a2a30,
  gap: 0x0b0405,
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
  /** 끝 둥근 정도 (없으면 K_TIP) */
  readonly kt?: number;
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
  kt?: number,
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
    const f: Feather = { a, t: add(add(mid, o, hh), u, lean(j) * w), b, o, u, w, h: hh };
    out.push(kt === undefined ? f : { ...f, kt });
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
  const kt = f.kt ?? K_TIP;
  return [
    add(f.a, f.o, f.h * K_OUT),
    add(f.t, f.u, -f.w * kt),
    add(f.t, f.u, f.w * kt),
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
  { n: 17, span: 2.2, f: 0.97, h: 0.62 },
  { n: 15, span: 2.02, f: 0.6, h: 0.6 },
];

/** 위 그림 깃이 쉴 때도 뒤 가운데 쪽으로 눕는 비율 (깃 폭 기준) — 둘레로 퍼진 꽃잎이 아니라 등을 따라 누운 깃털 */
const LEAN_REST = 0.6;
/** 위 그림 깃 끝 둥근 정도 (정면보다 조금 좁은 둥근 끝 — 뾰족하지 않게) */
const TOP_TIP = 0.2;

/**
 * 깃 간격 (−1~1 → −1~1): 뒤 가운데는 촘촘하고 옆으로 갈수록 넓다. 띠가 얇은 뒤에서도 깃이 넓적한 기와가 되지 않고 띠가
 * 넓은 옆과 비슷한 길쭉한 비율이 된다
 */
const SPREAD_BACK = 0.62;
const spread = (t: number): number => t * (SPREAD_BACK + (1 - SPREAD_BACK) * t * t);

/** 뒤에서 잰 각 φ · 반지름 → 목 좌표 점 (φ = 0 뒤, +φ = +y 쪽) */
const polar = (phi: number, r: number): Pt => [-Math.cos(phi) * r, Math.sin(phi) * r];

/** 깃 길이 배율: 포효 = 곤두세워 부풀고, 돌진 = 바람에 눕고, 기절 = 축 처진다 */
function topPuff(a: MonsterTopAnchor): number {
  const dash = a.dash * (1 - a.stun);
  return 1 + 0.25 * a.roar - 0.25 * dash - 0.3 * a.stun;
}

/** 위 그림 깃 한 줄 (목 좌표). grow = 그늘용으로 바깥으로 키우기 */
function topRow(a: MonsterTopAnchor, k: number, grow = 0): { fs: Feather[]; inner: Feather[] } {
  const row = TOP_ROWS[k] ?? { n: 10, span: 2, f: 1, h: 0.34 };
  const dash = a.dash * (1 - a.stun);
  // 들썩임 세기: 서 있어도 조금, 걸으면 더
  const ruffle = 0.1 + 0.14 * a.stride;
  const puff = topPuff(a);
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
      return -Math.sign(phiAt(j + 0.5)) * (LEAN_REST + 0.25 * dash) + 0.1 * a.s;
    },
    false,
    TOP_TIP,
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
 * 위 그림 깃 색 (게임 화면) — 머리 주석 '색' 참고. 깃 몸은 바닥과 대비 1.5를 넘는 가장 짙은 검붉은 색, 밝기는 광택 띠 ·
 * 깃대 빛줄이 되돌린다 (거의 검은 색은 칸보다 가는 선 · 옅은 그늘에만)
 */
const TF = {
  /** 깃 몸 (검붉은 색 — 바닥과 대비 1.5를 넘는 가장 짙은 쪽, 채도를 조금 죽여 검게 읽힌다) */
  body: 0x702a2e,
  /** 광택 (채도 높은 진홍 — 분홍 · 연어색으로 바래지 않게) · 가장 밝은 곳 */
  sheen: 0xe8323f,
  glint: 0xff3d4a,
  /** 깃대 (빛을 받은 가는 줄) */
  quill: 0xff5a64,
  /** 깃 사이 틈 · 깃 끝 가는 선 · 윗줄 그늘 */
  gap: 0x12050a,
} as const;

/**
 * 줄마다 광택 띠 (바깥 줄 → 목 쪽 줄): 깃 하나를 골 줄 → 끝으로 잰 [위치, 색, 진하기]. 빛 쪽 날개에 그대로, 그늘 쪽 날개에
 * SHADE_VANE배로 칠해 깃마다 깃대를 따라 길쭉한 광택 줄이 된다. 목 쪽 줄 뿌리는 두건 그늘 속이라 검붉게 남고, 바깥 줄 끝(어깨
 * 비탈 · 실루엣 테두리 띠)도 검붉게 남는다 — 테두리 띠는 기본 망토 자락만큼 짙어야 조각별 대비가 기본과 같다
 */
const TOP_BAND: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0.28, TF.sheen, 0],
    [0.4, TF.glint, 1],
    [0.7, TF.sheen, 1],
    [0.82, TF.sheen, 0],
  ],
  [
    [0.1, TF.sheen, 0],
    [0.3, TF.glint, 1],
    [0.86, TF.sheen, 1],
    [0.96, TF.sheen, 0],
  ],
];

/**
 * 자세에 맞춘 광택 띠: 포효로 부푼 깃은 띠를 늘어난 만큼 다 따라가지 않고(길이 배율의 제곱근만큼) 늘어난 끝을 그늘로 둔다
 * (곤두선 깃 끝이 실루엣 테두리 띠를 밝히지 않게). 돌진 · 기절로 짧아져 누운 깃은 위 빛을 더 넓게 받아 띠가 넓어진다(눕는
 * 만큼 덮는 망토의 밝은 목 둘레 몫)
 */
function poseBand(
  band: readonly (readonly [number, number, number])[],
  a: MonsterTopAnchor,
): (readonly [number, number, number])[] {
  const puff = topPuff(a);
  const at = 1 / Math.sqrt(Math.max(1, puff));
  const widen = 1 + BAND_WIDEN * Math.max(0, 1 - puff);
  const lit = band.filter(([, , al]) => al > 0);
  const c = lit.reduce((sum, [t]) => sum + t, 0) / Math.max(1, lit.length);
  return band.map(([t, col, al]) => [Math.min(1, Math.max(0, c + (t - c) * widen)) * at, col, al] as const);
}

/** 짧아진 깃(돌진 · 기절)의 광택 띠 넓히기 (짧아진 비율당) */
const BAND_WIDEN = 3;

/** 앞 끝 깃에 광택을 고르게 두기 시작하는 각 (뒤에서 잰 각, 라디안) · 그 진하기 */
const FRONT_PHI = 1.75;
const FRONT_A = 0.8;

/** 깃대 광택 (along 범위: 바깥 줄 · 목 쪽 줄) · 진하기 · 굵기 */
const GLINT_OUT: readonly [number, number] = [0.5, 0.66];
const GLINT_IN: readonly [number, number] = [0.5, 0.78];
const GLINT_A = 0.9;
const GLINT_W = 0.032;

/** 깃대 일부 (along k0 → k1). 한 경로에 깃마다 하위 경로 */
function quillPath(m: Mat, fs: readonly Feather[], k0: number, k1: number): string {
  const p = path(m);
  for (const f of fs) {
    const r = along(f, k0);
    const e = along(f, k1);
    p.M(r[0], r[1]).L(e[0], e[1]);
  }
  return p.d;
}

/** 그늘 쪽 날개 광택 비율 (빛 쪽 = 1) */
const SHADE_VANE = 0.6;

/** 깃마다 빛 쪽 날개 (앞 · 두건 쪽): u는 오른쪽(+y)에서 앞, 왼쪽에서 뒤를 향한다 → 좌우 거울 대칭 */
const litSide = (f: Feather): number => (f.t[1] >= 0 ? 1 : -1);

/** 깃 반쪽 (깃대 = 골 가운데 → 끝, 그 옆 날개): side = +1이면 골 b 쪽, −1이면 골 a 쪽 */
function halfPath(p: Path, f: Feather, side: number): void {
  const [c1, c2, c3, c4] = tipCtrl(f);
  const mid: Pt = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
  p.M(mid[0], mid[1]).L(f.t[0], f.t[1]);
  if (side > 0) p.C(c3[0], c3[1], c4[0], c4[1], f.b[0], f.b[1]);
  else p.C(c2[0], c2[1], c1[0], c1[1], f.a[0], f.a[1]);
  p.Z();
}

/** 윗줄 깃이 아랫줄에 드리운 그늘 진하기 */
const CAST_A = 0.2;

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
  // 바깥 테 밑 그늘은 두지 않는다 — 앞 끝(두건 옆 어깨)에서 망토 테두리 띠에 드리워 그쪽 실루엣을 바닥 쪽으로 꺼뜨린다
  for (let k = 0; k < TOP_ROWS.length; k += 1) {
    const { fs, inner } = topRow(a, k);
    const top = k === TOP_ROWS.length - 1;
    const band = poseBand(TOP_BAND[k] ?? [], a);
    // 윗줄 깃이 드리운 그늘 (아랫줄 위로)
    if (k > 0) {
      const g = topRow(a, k, 0.03);
      sk.fill(rowPath(N, g.fs, [], g.inner), solid(ink(TF.gap), CAST_A));
    }
    // 줄 바탕 = 깃 몸
    sk.part(rowPath(N, fs, [], inner), solid(ink(TF.body)), a.outline, undefined, 0);
    // 광택: 깃마다 골 줄 → 끝으로 흐르는 띠를 빛 쪽 날개에 진하게, 그늘 쪽 날개에 옅게 (깃대를 따라 갈라진 결 — 깃마다
    // 길쭉한 광택 줄이 되어 둥근 구슬 · 톱니로 읽히지 않는다). 앞 끝(두건 옆 어깨)은 뿌리부터 끝까지 광택을 둔다 — 망토
    // 자락이 아니라 위 빛을 받는 어깨 앞이라 기본 망토도 거기서 짙어지지 않는다
    for (const f of fs) {
      const r0 = along(f, 0.375);
      const front = Math.min(1, Math.max(0, (Math.abs(Math.atan2(f.t[1], -f.t[0])) - FRONT_PHI) / 0.4));
      const lit = litSide(f);
      for (const [side, gain] of [
        [lit, 1],
        [-lit, SHADE_VANE],
      ] as const) {
        const p = path(N);
        halfPath(p, f, side);
        sk.fill(
          p.d,
          lin(
            N,
            r0[0],
            r0[1],
            f.t[0],
            f.t[1],
            band.map(([t, c, al]): Stop => [t, ink(c), Math.max(al, front * FRONT_A) * gain]),
          ),
        );
      }
    }
    // 깃 사이 틈 · 깃 끝 가는 선 (칸보다 가늘게)
    sk.line(gapPath(N, fs, top ? 0.05 : 0.09), solid(ink(TF.gap), 0.3), 0.014 * ls);
    sk.line(tipLine(N, fs), solid(ink(TF.gap), 0.3), 0.014 * ls);
    // 깃대 광택: 광택 띠 한가운데의 짧은 빛줄 (뿌리 · 끝의 짙은 곳까지 그으면 흰 가시처럼 읽힌다)
    const [q0, q1] = top ? GLINT_IN : GLINT_OUT;
    sk.line(quillPath(N, fs, q0, q1), solid(ink(TF.quill), GLINT_A), GLINT_W * ls);
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
    [0, a.ink(F.hot), 0.9],
    [0.5, a.ink(F.glint), 0.75],
    [1, a.ink(F.sheen), 0.5],
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
