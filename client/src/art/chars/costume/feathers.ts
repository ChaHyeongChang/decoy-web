// 의상 '까마귀 깃' (괴물 의상 250 불씨, 판 밖 메타 c): 어깨 · 등 위로 뒤로 누운 검붉은 까마귀 깃 망토에 진홍 광택이 흐른다.
// 깃 끝은 둥글다 — 뾰족한 깃 · 가시 · 뿔은 없다(사용자 결정). 붉은 두건 · 톱니 자락 · 얼굴 · 눈 · 발톱은 덮지 않는다.
//
// 위 그림(topCloak — 망토 위, 두건 · 팔 밑): 두건 뒤를 둘러 어깨에서 어깨까지 깃 세 줄(바깥 22 · 가운데 20 · 목 쪽 17개, 바깥 줄부터
// 깐다). 깃은 하나하나 따로 그린 긴 깃(뿌리는 좁고 끝 쪽 2/5가 가장 넓은 둥근 끝)이고 끝이 뒤 가운데 쪽으로 0.36 ~ 0.44 rad 눕고
// 조금 휜다. 깃마다 길이 · 눕는 각이 들쭉날쭉하다(좌우 거울 대칭). 한 줄 안에서는 뒤 가운데부터 앞 끝으로 그려 앞쪽 깃이 뒤쪽 깃
// 위에 기와처럼 눕는다 — 둘레로 고르게 펴진 깃은 꽃잎 · 해바라기 · 톱니바퀴로 읽혀서(2판 검토) 등을 따라 빗어 넘긴 깃털 결로 둔다.
// 목 쪽 줄 뿌리는 망토에서 스며 나온다(뿌리 끝이 둥글게 보이면 목 둘레가 구슬 · 콩깍지 줄로 읽힌다).
// 깃 하나 = 깃 몸(한 도형, 뿌리 → 끝으로 짙어진다) + 광택(한 도형: 빛 쪽 날개를 덮고 그늘 쪽 날개로 조금 넘어가는 잎). 선 · 테 ·
// 틈 선은 쓰지 않는다: Canvas는 명령마다 따로 안티에일리어싱해, 두 반쪽으로 나눈 광택의 이음매나 밝은 선 밑 짙은 선 가장자리로 짙은
// 깃 몸이 비쳐 작은 크기에서 실제 화면이 2 ~ 4% 어두워졌다(2판 검증). 광택은 깃 몸 안쪽에서 끝나 두 도형이 가장자리를 나누지 않는다.
// 자리: 깃 뿌리는 자세 변환(돌진의 납작한 몸까지) 뒤 몸 중심에서 0.5r 밖(radiusFor) — 몸 가운데 0.45r 원판은 역할색 그대로
// (costume-parity-disc 0%). 바깥 끝은 망토 실루엣 안(rOut: 뒤 0.8 · 옆 0.92 · 앞 끝으로 줄어든다)이라 실루엣 · 면적이 기본과 같다.
//
// 보이는 정도 (사용자 결정: 꾸미기는 유불리가 없다 — 생존자 화면에서 기본 괴물만큼 보인다. tests/unit/costume-parity*.test.ts):
// 캐릭터는 안개 · 어둠 위에 그려지므로 그림 색 자체가 기본과 같은 밝기 · 대비여야 한다. 기본 망토는 위 빛을 받는 목 둘레가 가장 밝고
// (상대 휘도 0.15 ~ 0.2) 바깥으로 짙어진다(테두리 띠 0.05 ~ 0.07). 그래서 깃 몸은 바닥과 대비 1.5를 넘는 가장 짙은 쪽(상대 휘도
// 0.05 ~ 0.065 — 더 짙으면 '바닥 대비 면적'이 준다)에 두고, 모자란 밝기는 진홍 광택의 넓이로 채운다: 목 쪽 줄일수록 위 빛을 많이
// 받아 광택이 넓다(목 쪽 줄은 그늘 쪽 날개 0.7까지, 가운데 줄 0.3, 바깥 줄은 빛 쪽 날개 0.8만). 바깥 줄 끝은 실루엣 테두리 띠에
// 닿으므로 채도 있는 검붉은 색으로 둔다 — 채도를 죽이면 바닥 청회색과의 색 차이(조각 색조)가 기본 망토 자락보다 작아진다. 앞 끝
// (두건 옆 어깨, 뒤에서 잰 각 1.55 rad 넘게)은 위 빛을 받는 어깨라 광택을 끝까지 두고(타격 · 준비로 팔이 비키면 드러난다), 줄의 앞
// 끝은 두건 옆(뒤에서 잰 반각 2.1 rad 안)에서 멈춘다. 고운 명암 무늬는 작은 크기에서 sRGB로 섞여 조금 어두워지므로(휴대폰
// 크기 −2%) 큰 크기에서 기본보다 1 ~ 2% 밝게 맞췄다. 잰 값 (Node · 실제 Chromium Canvas, 의상 / 기본): 밝기 0.973 ~ 1.020, 외곽 대비 0.992 ~ 1.035,
// 조각 대비 ≥ 0.972 (16조각 · 제 띠 조각도 ≥ 0.956), 조각 색조 ≥ 0.975, 바닥 대비 면적 0.99 ~ 1.03, 면적 1.000.
//
// 움직임: 깃 끝이 망토 물결 · 걸음에 따라 조금씩 들썩이고 옆으로 쏠린다(겹침 순서는 흔들림 전 자리로 정해 프레임마다 뒤바뀌지
// 않는다). 포효 = 깃이 곤두서 길어지고(1.12배) 덜 눕는다 — 광택은 쉴 때 자리에 남고 늘어난 끝은 그늘(곤두선 끝이 테두리 띠를 밝히지
// 않게). 돌진 = 바람에 짧아지며 뒤로 더 눕고, 기절 = 축 처져 짧아진다 — 짧아져 누운 안쪽 두 줄은 위 빛을 더 넓게 받아 광택이 그늘 쪽
// 날개로 더 넘어간다(눕는 만큼 덮는 망토의 밝은 목 둘레 몫). 정면은 숨 · 시각에 따라 들썩인다.
//
// 정면 그림(frontMantle — 어깨 망토 위, 두건 밑, 로비 · 옷장): 승인된 모양 그대로 — 두건 밑동에서 어깨를 덮는 둥근 깃 세 줄(가슴은
// 두 줄이 두건 밑으로 보인다), 깃마다 깃대 · 빛 쪽(왼쪽) 날개를 넓게 덮고 깃대를 조금 넘는 진홍 광택(한 도형), 줄 밑 옅은 그늘,
// 어깨 위 붉은 림 라이트, 어깨 망토의 붉은 톱니 끝이 깃 아래로 조금 남는다. 상반신은 손이 깃 아래를 쥔다.
// 짙기 · 색은 위 그림에 맞춘다(옷장에서 두 그림이 한 의상으로 읽히게): 앞선 판은 깃 몸이 거의 검고 광택이 가는 잎이라 정면만 훨씬
// 짙었다 — 기본과 달라진 칸 평균(300px) 정면 #55242A 휘도 0.049(0.06 밑 77%) ↔ 위 #AD2D3C 0.127(15%). 지금은 깃 몸을 위 그림 바깥
// 줄처럼 채도 있는 검붉은 색으로 밝히고, 광택을 빛 쪽 날개 전체로 넓히고, 줄 가장자리 안쪽 선을 외곽선 검정 대신 짙은 검붉은
// 색으로, 그늘 · 틈을 옅게 해 정면 #902931 휘도 0.101 · 상반신 #9B2C34 0.111이다. 남은 차이는 정면에만 있는 실루엣 외곽선(정면 칸의
// 14%)이고, 그것을 빼면 0.116 · 0.120이다. 위 그림(게임 화면)은 바꾸지 않았다.
//
// 색: 위 그림 깃 몸 바깥 줄 #8A2430 → #80242C(뿌리 → 끝, 채도 있는 검붉은 색), 가운데 · 목 쪽 줄 #683A3E → #623438(채도를 죽인
// 검붉은 색 — 짙게 읽힌다), 광택 #FF2A48 → 끝 #E01E3C(망토 #EF4444보다 차고 진한 진홍이라 망토와 갈린다).
// 정면 깃 #A0363F(왼쪽 위) → #8E2C34 → #802A30, 날개 광택 #FF3D4A(빛 쪽) → #E8323F → #DC303F, 깃대 #5A1E26, 줄 가장자리 안쪽 선
// #4A161C, 틈 · 겹친 깃 그늘 #2A0E12(옅게), 림 라이트 = 기본 괴물 림 색(어깨 오른쪽 강하게 · 왼쪽 약하게). 모든 색은 ink()를 거친다.
// 보라 · 자홍 · 청록 없음.
import { apply, linear, path, solid, type Mat, type Paint, type Path, type Sketch, type Stop } from '../kit';
import type { MonsterCostumeArt, MonsterFrontAnchor, MonsterTopAnchor, Pt } from './types';

/**
 * 정면 깃 색 (로비 · 옷장): 위 그림과 같은 의상으로 읽히게 같은 짙기 · 같은 무늬 — 채도 있는 검붉은 깃 몸 + 빛 쪽 날개를
 * 넓게 덮는 진홍 광택 (위 그림 깃 몸 #8A2430 · #683A3E, 광택 #FF2A48 · #E01E3C와 같은 쪽)
 */
const F = {
  /** 깃 몸: 왼쪽 위(빛 쪽) → 가운데 → 오른쪽 아래 그늘 */
  base: 0xa0363f,
  deep: 0x8e2c34,
  far: 0x802a30,
  /** 날개 광택: 빛 쪽(왼쪽)이 가장 밝은 진홍 → 오른쪽으로 조금 짙은 진홍 */
  hot: 0xff3d4a,
  glint: 0xe8323f,
  sheen: 0xdc303f,
  /** 깃대 (광택 날개와 그늘 날개의 경계) · 깃 사이 틈 · 겹친 깃 그늘 · 줄 가장자리 안쪽 선 */
  shaft: 0x5a1e26,
  gap: 0x2a0e12,
  edge: 0x4a161c,
} as const;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const add = (p: Pt, q: Pt, k = 1): Pt => [p[0] + q[0] * k, p[1] + q[1] * k];

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

// ───────────────────────── 정면 깃 줄 ─────────────────────────

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
 * 골 점들 사이마다 깃 하나. from = 줄 안쪽 기준점 (끝이 from에서 멀어지는 쪽), h(j) = 끝 높이, lean(j) = 끝이 폭 방향으로
 * 쏠리는 비율 (숨 · 바람)
 */
function feathers(
  notches: readonly Pt[],
  from: Pt,
  h: (j: number) => number,
  lean: (j: number) => number,
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
    if (!away) o = [u[1], -u[0]];
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

/** 깃 줄 윤곽 (닫힌 경로): 첫 골 → 둥근 끝 · 골 … → 마지막 골 → 안쪽 테(back, 두건 밑으로 숨는 매끈한 곡선) → 첫 골 */
function rowPath(m: Mat, fs: readonly Feather[], back: readonly Pt[]): string {
  const first = fs[0];
  const last = fs[fs.length - 1];
  if (!first || !last) return '';
  const p = path(m).M(first.a[0], first.a[1]);
  tips(p, fs);
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

/**
 * 깃 한쪽 날개 광택 (빛 쪽 날개를 넓게 덮고 깃대를 조금 넘는 잎 — 한 경로에 깃마다 하위 경로). side = 빛 쪽 (−: u 반대).
 * 빛 쪽 옆선은 깃 옆선보다 0.1w쯤 안쪽에 머문다 (이웃 깃 · 실루엣 밖으로 넘지 않게)
 */
function vanePath(m: Mat, fs: readonly Feather[], side: number): string {
  const p = path(m);
  for (const f of fs) {
    const a0 = along(f, 0.22, 0);
    const a1 = along(f, 0.45, side * 0.62);
    const a2 = along(f, 0.86, side * 0.52);
    const a3 = along(f, 0.96, side * 0.02);
    const b1 = along(f, 0.8, -side * 0.2);
    const b2 = along(f, 0.45, -side * 0.18);
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

// ───────────────────────── 위 그림: 어깨 · 등 위로 누운 깃 망토 ─────────────────────────

/** 깃 하나 (목 좌표): 뿌리 가운데 root, 끝 쪽 단위 방향 o, 폭 방향 단위 u (빛 쪽 = 앞 · 두건 쪽), 길이 · 폭, 휨 (끝이 뒤로 휘는 몫) */
interface Plume {
  readonly root: Pt;
  readonly o: Pt;
  readonly u: Pt;
  readonly len: number;
  readonly w: number;
  readonly bow: number;
  /** 뒤에서 잰 뿌리 각 */
  readonly phi: number;
  /** 그리는 순서 (뒤 가운데 0 → 앞 끝 1, 걸음 흔들림 전 값 — 프레임마다 겹침 순서가 뒤바뀌지 않게) */
  readonly order: number;
}

/** 깃 끝이 뒤로 휘는 몫 (길이 비율, 끝에서) — 곧은 막대가 아니라 등을 따라 누운 깃 */
const BOW = -0.1;

/** 깃 안의 점: k = 뿌리 0 → 끝 1, s = 폭 비율 (+ = 빛 쪽) */
const at = (f: Plume, k: number, s: number): Pt =>
  add(add(f.root, f.o, f.len * k), f.u, f.w * s + f.bow * f.len * k * k);

/** 깃 윤곽 (k, s) 반쪽: 둥근 뿌리 → 옆선 → 둥근 끝. 끝 쪽 2/5가 가장 넓은 긴 깃 (끝은 둥글게 — 뾰족하지 않게) */
const PLUME_HALF: readonly Pt[] = [
  [0.04, 0.22],
  [0.3, 0.4],
  [0.6, 0.5],
  [0.84, 0.46],
  [0.96, 0.28],
];
const PLUME_EDGE: readonly Pt[] = [
  [-0.04, 0],
  ...PLUME_HALF,
  [1, 0],
  ...PLUME_HALF.map(([k, s]): Pt => [k, -s]).reverse(),
];

/**
 * 광택 (깃마다 한 도형): 깃대를 따라 빛 쪽 날개를 덮는 긴 잎 (빛 쪽 옆선 반쪽 — 줄마다 폭 배율 gw, 그늘 쪽 날개로 넘어가는 몫 gs).
 * 두 반쪽으로 나눠 칠하면 깃대 이음매에서 밑의 짙은 깃 몸이 비친다 (Canvas는 명령마다 따로 안티에일리어싱한다)
 */
const GLOSS_LIT: readonly Pt[] = [
  [0.12, 0.05],
  [0.3, 0.3],
  [0.58, 0.42],
  [0.8, 0.36],
  [0.93, 0.16],
];

function glossEdge(gw: number, gs: number): Pt[] {
  return [
    ...GLOSS_LIT.map(([k, s]): Pt => [k, s * gw]),
    [0.96, 0],
    ...GLOSS_LIT.map(([k, s]): Pt => [k, -s * gs]).reverse(),
  ];
}

function plumePath(m: Mat, f: Plume, edge: readonly Pt[]): string {
  return path(m).smooth(
    edge.map(([k, s]) => at(f, k, s)),
    1,
  ).d;
}

/** 바깥 테가 끝나는 각 (뒤에서 잰 반각, 라디안) — 앞 끝은 두건 옆 밑 */
const PHI_END = 2.25;

/** 바깥 테 반지름 (뒤에서 잰 각 φ): 뒤 0.8 → 옆 0.92 → 앞 끝으로 두건 옆까지 줄어든다 (망토 실루엣 · 옆 테두리 띠 안쪽) */
function rOut(phi: number): number {
  const p = Math.abs(phi);
  if (p <= Math.PI / 2) return 0.8 + 0.12 * Math.sin(p) ** 2;
  const k = Math.min(1, (p - Math.PI / 2) / (PHI_END - Math.PI / 2));
  return 0.92 - 0.3 * k * k;
}

/** 위 그림 깃 줄 하나 */
interface TopRowSpec {
  /** 깃 수 · 반각 */
  readonly n: number;
  readonly span: number;
  /** 뿌리 반지름 (몸 중심에서 잰 거리 — 자세 변환 뒤에도 몸 가운데 0.45r 원판 밖) · 바깥 테까지 닿는 몫 */
  readonly root: number;
  readonly reach: number;
  /** 끝이 뒤로 눕는 각 (라디안) · 폭 (이웃 간격 배) */
  readonly sweep: number;
  readonly wk: number;
  /** 광택 폭 배율 (빛 쪽 날개 · 그늘 쪽 날개로 넘어가는 몫) */
  readonly gw: number;
  readonly gs: number;
  /** 뿌리가 망토에서 스며 나오는 몫 (0 = 또렷한 뿌리 — 윗줄에 가려진다) */
  readonly fade: number;
  /** 깃 몸 색 (TF_BODY 번호) */
  readonly body: number;
}

/** 위 그림 깃 줄 (바깥 → 안, 그리는 순서). 목 쪽 줄일수록 위 빛을 많이 받아 광택이 넓다 */
const TOP_ROWS: readonly TopRowSpec[] = [
  { n: 22, span: 2.08, root: 0.6, reach: 1, sweep: 0.36, wk: 1.2, gw: 0.8, gs: 0, fade: 0, body: 0 },
  { n: 20, span: 2.04, root: 0.56, reach: 0.68, sweep: 0.4, wk: 1.2, gw: 1, gs: 0.3, fade: 0, body: 1 },
  { n: 17, span: 1.95, root: 0.5, reach: 0.45, sweep: 0.44, wk: 1.2, gw: 1, gs: 0.7, fade: 0.6, body: 1 },
];

/** 깃 간격 (−1~1 → −1~1): 뒤 가운데는 촘촘하고 옆으로 갈수록 넓다 (띠가 얇은 뒤에서 깃이 넓적해지지 않게) */
const SPREAD_BACK = 0.7;
const spread = (t: number): number => t * (SPREAD_BACK + (1 - SPREAD_BACK) * t * t);

/** 뒤에서 잰 각 φ · 반지름 → 목 좌표 점 (φ = 0 뒤, +φ = +y 쪽) */
const polar = (phi: number, r: number): Pt => [-Math.cos(phi) * r, Math.sin(phi) * r];

/** 깃마다 들쭉날쭉 (0~1, 좌우 거울 대칭 — 고른 톱니 · 꽃잎으로 보이지 않게) */
function jitter(c: number, k: number): number {
  const v = Math.sin(c * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * 목 좌표 각 φ 방향으로, 자세 변환(N) 뒤 몸 중심에서 rWorld 떨어진 점의 목 좌표 반지름 (돌진의 납작한 몸에서도 깃 뿌리가
 * 몸 가운데 원판 밖에 남는다)
 */
function radiusFor(N: Mat, phi: number, rWorld: number): number {
  const [ux, uy] = polar(phi, 1);
  const vx = N[0] * ux + N[2] * uy;
  const vy = N[1] * ux + N[3] * uy;
  const tx = N[4];
  const ty = N[5];
  const vv = vx * vx + vy * vy || 1e-9;
  const vt = vx * tx + vy * ty;
  const disc = vt * vt - vv * (tx * tx + ty * ty - rWorld * rWorld);
  return Math.max(rWorld * 0.5, (-vt + Math.sqrt(Math.max(0, disc))) / vv);
}

/** 깃 길이 배율: 포효 = 곤두세워 부풀고, 돌진 = 바람에 뒤로 눕고, 기절 = 축 처진다 */
function topGrow(a: MonsterTopAnchor): number {
  const dash = a.dash * (1 - a.stun);
  return 1 + 0.12 * a.roar - 0.12 * dash - 0.15 * a.stun;
}

/** 위 그림 깃 한 줄 (목 좌표), 그리는 순서로 */
function topRow(a: MonsterTopAnchor, k: number): Plume[] {
  const row = TOP_ROWS[k];
  if (!row) return [];
  const dash = a.dash * (1 - a.stun);
  // 들썩임 세기: 서 있어도 조금, 걸으면 더
  const ruffle = 0.05 + 0.08 * a.stride;
  const grow = topGrow(a);
  const lie = 1 - 0.3 * a.roar + 0.25 * dash;
  const phiAt = (t: number): number => row.span * spread(t) + 0.05 * a.s;
  const out: Plume[] = [];
  for (let j = 0; j < row.n; j += 1) {
    const t = -1 + (2 * j + 1) / row.n;
    const phi = phiAt(t);
    const step = Math.abs(phiAt(t + 1 / row.n) - phiAt(t - 1 / row.n));
    const rr = radiusFor(a.neck, phi, row.root);
    const root = polar(phi, rr);
    const side = Math.sign(phi) || 1;
    const c = Math.abs(j - (row.n - 1) / 2);
    const sw =
      (row.sweep + 0.08 * (jitter(c, k + 5) - 0.5)) * lie * Math.min(1, Math.abs(phi) / 0.9) +
      0.06 * a.s * side;
    const phiT = phi - side * sw;
    const v = 1 - 0.14 * jitter(c, k);
    const ruf = 1 + ruffle * Math.sin(a.cloak * 1.3 + j * 1.9 + k * 2.1);
    const lim = rOut(phiT) * (1 + 0.03 * a.roar);
    const rt = Math.min(lim, rr + (rOut(phiT) - rr) * row.reach * v * grow * ruf);
    const tip = polar(phiT, rt);
    const dx = tip[0] - root[0];
    const dy = tip[1] - root[1];
    const len = Math.hypot(dx, dy) || 1e-6;
    const o: Pt = [dx / len, dy / len];
    // 폭 = 이웃 깃 간격 중 깃 방향에 수직인 몫 (비스듬히 누운 깃은 좁고 길다)
    const rm = lerp(rr, rt, 0.5);
    const p0 = polar(phi - step / 2, rm);
    const p1 = polar(phi + step / 2, rm);
    const perp = Math.abs((p1[0] - p0[0]) * o[1] - (p1[1] - p0[1]) * o[0]);
    // 빛 쪽 = 앞(|φ|가 커지는 쪽)
    const tan: Pt = [Math.sin(phi) * side, Math.cos(phi) * side];
    let u: Pt = [-o[1], o[0]];
    if (u[0] * tan[0] + u[1] * tan[1] < 0) u = [o[1], -o[0]];
    out.push({ root, o, u, len, w: perp * row.wk * (1 + 0.1 * a.roar), bow: BOW, phi, order: Math.abs(t) });
  }
  // 뒤 가운데부터 앞 끝으로 (앞쪽 깃이 뒤쪽 깃 위에 눕는다 — 기와처럼)
  return out.sort((p, q) => p.order - q.order);
}

/** 누운 깃(돌진 · 기절)의 광택이 그늘 쪽 날개로 더 넘어가는 몫 */
const FLAT_GS = 0.25;

/** 앞 끝 깃 광택을 끝까지 두기 시작하는 각 (뒤에서 잰 각, 라디안) */
const FRONT_PHI = 1.55;

/**
 * 위 그림 깃 색 (게임 화면, 머리 주석 '색' 참고). 깃 몸 (뿌리 → 끝): 0 = 바깥 줄 (끝이 실루엣 테두리 띠에 닿는다 — 기본 망토 자락만큼 붉어야 바닥과 색이 갈린다),
 * 1 = 안쪽 줄 (채도를 죽인 검붉은 색 — 짙게 읽힌다). 모두 바닥과 대비 1.5 위
 */
const TF_BODY = [
  { lit: 0x8a2430, shade: 0x80242c },
  { lit: 0x683a3e, shade: 0x623438 },
] as const;

/** 광택 (채도 높은 진홍 — 망토 #EF4444보다 차갑고 진해 망토와 갈린다): 깃 대부분 · 끝 */
const TF = {
  glint: 0xff2a48,
  sheen: 0xe01e3c,
} as const;

function topCloak(sk: Sketch, a: MonsterTopAnchor): void {
  const N = a.neck;
  const ink = a.ink;
  // 포효로 늘어난 깃 끝은 그늘이다 (광택은 쉴 때 자리 — 곤두선 끝이 실루엣 테두리 띠를 밝히지 않게).
  // 짧아져 누운 깃(돌진 · 기절)은 위 빛을 더 넓게 받는다 — 광택이 그늘 쪽 날개로 더 넘어간다 (눕는 만큼 덮는 망토의 밝은 목 둘레 몫)
  const grow = topGrow(a);
  const flat = Math.min(1, Math.max(0, (1 - grow) / 0.15));
  for (let k = 0; k < TOP_ROWS.length; k += 1) {
    const row = TOP_ROWS[k];
    if (!row) continue;
    // 바깥 줄 끝은 실루엣 테두리 띠에 닿아 넓히지 않는다
    const gsFlat = Math.min(1, row.gs + (k > 0 ? FLAT_GS * flat : 0));
    for (const f of topRow(a, k)) {
      // 깃 몸: 뿌리 → 끝으로 짙어진다 (끝이 아래 줄 위에 그늘진 테로 읽힌다). 목 쪽 줄은 뿌리가 망토에서 스며 나온다 —
      // 뿌리 끝이 둥글게 보이면 목 둘레가 콩깍지 · 구슬 줄로 읽힌다
      const [b0x, b0y] = at(f, 0, 0);
      const [b1x, b1y] = at(f, 1, 0);
      const fade = row.fade;
      const body = TF_BODY[row.body] ?? TF_BODY[0];
      sk.fill(
        plumePath(N, f, PLUME_EDGE),
        lin(N, b0x, b0y, b1x, b1y, [
          [0, ink(body.lit), fade > 0 ? 0 : 1],
          [Math.max(0.05, fade), ink(body.lit)],
          [1, ink(body.shade)],
        ]),
      );
      // 광택: 앞 끝(두건 옆 어깨 앞)은 위 빛을 받는 어깨라 끝까지 밝다 (기본 망토도 거기서 짙어지지 않는다)
      const front = Math.min(1, Math.max(0, (Math.abs(f.phi) - FRONT_PHI) / 0.4));
      const gs = Math.max(gsFlat, lerp(gsFlat, 0.6, front));
      const [g0x, g0y] = at(f, 0.1, 0);
      const [g1x, g1y] = at(f, 0.95 / Math.max(1, grow), 0);
      sk.fill(
        plumePath(N, f, glossEdge(row.gw, gs)),
        lin(N, g0x, g0y, g1x, g1y, [
          [0, ink(TF.glint), 0],
          [0.12, ink(TF.glint)],
          [0.75, ink(TF.glint)],
          [1, ink(TF.sheen), lerp(0.5, 0.9, front)],
        ]),
      );
    }
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
    [1, a.ink(F.far)],
  ]);
}

/** 정면 깃 광택 칠 (왼쪽 빛 쪽이 밝은 진홍 → 오른쪽으로 조금 짙은 진홍, 끝까지 불투명) */
function frontSheen(a: MonsterFrontAnchor): Paint {
  return lin(a.m, -0.6, 0, 0.6, 0, [
    [0, a.ink(F.hot), 1],
    [0.5, a.ink(F.glint), 1],
    [1, a.ink(F.sheen)],
  ]);
}

function frontMantle(sk: Sketch, a: MonsterFrontAnchor): void {
  const M = a.m;
  const ink = a.ink;
  const ls = a.ls;
  const by = a.by;
  // 빛은 왼쪽 위: 왼쪽 위 깃이 조금 밝고 오른쪽 아래로 짙어진다 (위 그림 바깥 줄 같은 검붉은 색 — 빛 쪽 날개는 진홍 광택)
  const body = frontBody(a);
  const sheen = frontSheen(a);
  for (let k = 0; k < FRONT_ROWS.length; k += 1) {
    const { fs, back } = frontRow(a, k);
    // 깃 밑 그늘 (아래 줄 · 어깨 망토 위로 조금 아래에, 옅게). 줄 가장자리 안쪽 선은 외곽선 검정 대신 짙은 검붉은 색 —
    // 줄은 갈리되 정면이 위 그림보다 짙어지지 않게 (바깥 실루엣 외곽선은 그대로)
    sk.fill(rowPath(shifted(M, 0.01, 0.035), fs, back), solid(ink(F.gap), 0.25));
    const row = rowPath(M, fs, back);
    sk.part(row, body, a.outline, undefined, 0);
    sk.line(row, solid(ink(F.edge), 0.85), a.w * 0.5);
    sk.line(gapPath(M, fs, 0.07), solid(ink(F.gap), 0.5), 0.016 * ls);
    sk.fill(vanePath(M, fs, -1), sheen);
    sk.line(shaftPath(M, fs), solid(ink(F.shaft), 0.8), 0.014 * ls);
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
