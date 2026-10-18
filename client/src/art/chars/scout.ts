// 스카우트 새 캐릭터 (캐릭터 리디자인): 초록 야전 재킷 + 챙 달린 야전모 + 쌍안 렌즈 고글 + 접이식 망원경 + 안테나 달린 작은 배낭.
// 멀리 보는 정찰병이라는 인상. 위에서 보면 덩어리는 넷뿐이다: 초록 머리 · 몸, 머리 앞을 두른 밝은 고글 고리(옛 렌즈 모티프),
// 오른손에 짧게 접어 오른쪽 가슴 앞에 쥔 망원경(바라보는 축과 거의 나란히 앞을 겨눈다 — 한쪽 손만의 비대칭 돌출이 바라보는
// 방향 쪽에 있다, 가장 먼 점 1.4r 안), 등의 중간 초록 배낭. 몸통은 판정 원을 거의 채우되 어깨와 배낭 사이가 오목해(배낭이
// 어깨보다 좁은 덩어리로 등에 따로 붙어 읽힌다) 가드 · 공통 생존자의 둥근 몸과 실루엣이 갈린다.
// 크기 기준(measure.ts SIZE_RULE: 앞 ±60° 1.55r · 옆 1.05r · 뒤 1.0r)은 모든 자세에서 지킨다.
// 어두운 칠(끈 · 장갑 · 배낭)은 역할색의 중간 변형으로 밝혀 작은 크기(휴대폰 몸 반지름 6.7px)에서도 판정 원을 밝은 몸이 채운다.
// 망원경은 들어 올려 눈에 댈 때만 층을 나눠(sk.layer) 굵은 외곽선이 머리 위에 그어지게 한다.
// 위 그림의 네온 포인트는 고글 렌즈 빛 · 망원경 대물렌즈 빛 선 · 안테나 끝 점뿐이다(밝은 초록, 글자용 역할색). 정면 그림은
// 고글 렌즈 빛만 초록으로 두고, 시설과 같은 청록 네온(survivorBase frontNeon: #22D3EE 번짐 + #67E8F9 심)을 고글 렌즈 테 ·
// 망원경 대물렌즈 테와 대물 통 띠 · 목깃 파이핑 · 가슴 멜빵 클립 등 · 안테나 끝 LED에 가늘게 넣는다 — 어두운 시설 · 청록 네온
// 분위기에 맞추되 옷 · 모자는 역할색 초록이 주인공. 위 그림(게임 화면)에는 청록을 넣지 않는다(게임 화면에서 청록은 시설 · 목표 뜻).
// 색은 역할색 초록(#22C55E)과 그 짙은/밝은 변형, 어두운 남회색 바지 · 장화 · 끈, 초록 기운 도는 밝은 회색 금속(고글 · 망원경).
import { OUTLINE, ROLE, ROLE_TEXT } from '../palette';
import {
  Sketch,
  apply,
  linear,
  mix,
  mul,
  path,
  radial,
  rotate,
  rotateAbout,
  scale,
  shade,
  solid,
  tint,
  transformDrawing,
  translate,
  type Drawing,
  type Mat,
  type Paint,
} from './kit';
import {
  FRONT,
  MAT,
  domePaint,
  frontArm,
  frontBreath,
  frontClothPaint,
  frontHead,
  frontLegs,
  frontNeon,
  frontTorsoPath,
  inkFor,
  TOP,
  topRig,
  topShoe,
  type FrontNeon,
  type TopRig,
  type Ink,
} from './survivorBase';
import {
  cleanFrontPose,
  cleanSurvivorPose,
  type ArtOptions,
  type FrontPose,
  type SurvivorArt,
  type SurvivorPose,
} from './types';

/** 스카우트 색 */
export const SCOUT_COLOR = {
  jacket: ROLE.scout,
  /** 짙은 초록 (그늘 · 배낭 덮개 · 목깃) */
  deep: 0x14532d,
  /**
   * 초록 네온 (위 그림 렌즈 빛 · 대물렌즈 · 안테나 끝, 정면 고글 렌즈 빛 — 밝은 초록, 글자용 역할색).
   * 정면 그림의 다른 네온은 청록(frontNeon)
   */
  neon: ROLE_TEXT.scout,
  /** 정면 재킷 (역할색보다 한 단 낮게 — 원색 모자가 먼저 보이게) */
  coat: shade(ROLE.scout, 0.15),
  /** 망원경 통 · 고글 (밝은 회색 금속, 푸른 기운 없이 초록을 조금 섞음 — 청록 시설 색과 멀게) */
  steel: mix(0xa3a3a3, ROLE.scout, 0.12),
  /** 고글 테 · 망원경 접안부 (어두운 금속) */
  gunmetal: 0x2b3646,
  /** 정면 배낭 (짙은 초록 — 재킷보다 두 단 어둡게) */
  pack: shade(ROLE.scout, 0.45),
  /** 위 그림 배낭 (중간 초록 — 재킷보다 한 단 어둡게. 작은 크기에서도 밝은 몸 덩어리로 읽히고, 외곽선으로 재킷과 갈린다) */
  packTop: shade(ROLE.scout, 0.38),
  /** 위 그림 고글 뒤 끈 (짙은 초록 — 검은 띠가 머리 둘레에 어두운 고리를 내지 않게) */
  band: shade(ROLE.scout, 0.42),
  strap: 0x1b2430,
  pants: 0x253041,
  boot: 0x2b3646,
  sole: 0x0f151d,
  /** 장갑 (조금 짙은 초록 — 쥔 손이 망원경 막대에 검은 구멍을 내지 않게) */
  glove: shade(ROLE.scout, 0.32),
  /** 위 그림 장갑 (재킷보다 한 단 짙은 초록 — 몸 옆에 어두운 점 · 고리로 떨어져 보이지 않게) */
  gloveTop: shade(ROLE.scout, 0.15),
  hair: 0x1b2430,
} as const;

const C = SCOUT_COLOR;

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 부드러운 0 → 1 */
const ease = (t: number): number => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/** 망원경 자세: 접안부 끝 (ex, ey), 방향 ang, 늘임 k (0 = 접힘, 1 = 다 늘임) */
interface Scope {
  ex: number;
  ey: number;
  ang: number;
  k: number;
}

const lerpScope = (a: Scope, b: Scope, t: number): Scope => ({
  ex: lerp(a.ex, b.ex, t),
  ey: lerp(a.ey, b.ey, t),
  ang: lerp(a.ang, b.ang, t),
  k: lerp(a.k, b.k, t),
});

/** 망원경 전체 길이 (몸 반지름 배수) */
const scopeLen = (k: number): number => 0.66 + 0.3 * k;

/** 원통 칠: 통의 폭 방향(a → b)으로 가운데가 밝은 금속 띠 */
function tubePaint(ink: Ink, base: number, ax: number, ay: number, bx: number, by: number): Paint {
  return linear(ax, ay, bx, by, [
    [0, ink(shade(base, 0.3))],
    [0.38, ink(tint(base, 0.28))],
    [0.62, ink(base)],
    [1, ink(shade(base, 0.38))],
  ]);
}

/**
 * 망원경 (위 · 정면 공통). m = 망원경 좌표(원점 = 접안부 끝, +x = 대물 쪽), 폭 배수 wk.
 * 위 그림(view 'top'): 접안부와 가운데 통을 같은 밝은 금속으로 칠해 끊기지 않는 밝은 막대 하나로 읽히게 하고,
 * 짙은 띠는 넣지 않는다. 대물렌즈는 옆에서 본 네온 선(glow = false면 없음 — 접어서 꽂아 둘 때).
 * 정면 그림(view 'front'): 눈컵 · 접안부 · 가운데 통 · 대물 통의 단 차이와 마디 고리, 대물렌즈는 빛이 아니라 유리(청록 네온
 * 테), 대물 통에 청록 네온 띠 하나 (neon = 정면 네온 그리개, 위 그림은 넘기지 않는다).
 */
function drawScope(
  sk: Sketch,
  ink: Ink,
  m: Mat,
  k: number,
  wk: number,
  view: 'top' | 'front',
  glow = true,
  neon: FrontNeon | null = null,
): void {
  const L = scopeLen(k);
  const top = view === 'top';
  const segs: readonly (readonly [number, number, number, number])[] = top
    ? [
        [0, Math.max(0.22, L - 0.46), 0.09 * wk, C.steel],
        [L - 0.56, L - 0.2, 0.112 * wk, C.steel],
        [L - 0.32, L, 0.15 * wk, shade(C.jacket, 0.06)],
      ]
    : [
        [0.08, Math.max(0.3, L - 0.46), 0.065 * wk, C.gunmetal],
        [L - 0.56, L - 0.22, 0.1 * wk, C.steel],
        [L - 0.32, L, 0.16 * wk, shade(C.jacket, 0.06)],
        // 눈컵 (짧고 조금 굵은 고리)
        [0, 0.1, 0.085 * wk, C.gunmetal],
      ];
  for (const [x0, x1, hw, col] of segs) {
    const [ax, ay] = apply(m, 0, -hw);
    const [bx, by] = apply(m, 0, hw);
    sk.part(
      path(m).roundRect(x0, -hw, x1 - x0, hw * 2, 0.035 * wk).d,
      tubePaint(ink, col, ax, ay, bx, by),
      ink(OUTLINE),
    );
  }
  const hw = (top ? 0.15 : 0.16) * wk;
  if (top) {
    // 대물렌즈 빛 (네온): 은은한 빛 + 밝은 선
    if (!glow) return;
    const d = path(m)
      .M(L - 0.005, -hw * 0.72)
      .L(L - 0.005, hw * 0.72).d;
    sk.line(d, solid(ink(C.neon), 0.35), 0.12 * wk);
    sk.line(d, solid(ink(tint(C.neon, 0.45))), 0.045 * wk);
    return;
  }
  // 마디 고리 (밝은 금속 테): 접안부 → 가운데 통, 가운데 통 → 대물 통
  for (const [x, w] of [
    [L - 0.56, 0.1 * wk],
    [L - 0.32, 0.16 * wk],
  ] as const)
    sk.fill(path(m).roundRect(x, -w - 0.006, 0.03, (w + 0.006) * 2, 0.01).d, solid(ink(tint(C.steel, 0.2))));
  // 대물 통 띠 (청록 네온 고리)
  neon?.line(
    path(m)
      .M(L - 0.2, -hw * 0.92)
      .L(L - 0.2, hw * 0.92).d,
    0.011,
    0.7,
  );
  // 대물렌즈 (유리): 짙은 원판 + 가는 청록 네온 테 + 왼쪽 위 작은 반짝임
  const lens = path(m).ellipse(L - 0.005, 0, 0.055 * wk, hw * 0.86).d;
  sk.fill(lens, solid(ink(C.deep)));
  neon?.line(lens, 0.014, 0.85);
  sk.fill(path(m).ellipse(L - 0.005, -hw * 0.36, 0.022 * wk, hw * 0.3).d, solid(ink(0xffffff), 0.8));
}

/**
 * 위에서 본 팔: 어깨 → 손 소매 (손은 따로). 몸통 위 테두리는 검은 안쪽 선 대신 짙은 초록 선 —
 * 작은 크기에서 몸 가장자리에 어두운 띠가 겹쳐 밝은 몸 덩어리가 줄지 않게
 */
function topSleeve(
  sk: Sketch,
  ink: Ink,
  sh: readonly [number, number],
  hand: readonly [number, number],
  width = 0.3,
): void {
  const d = path().capsule(sh[0], sh[1], hand[0], hand[1], width, width * 0.86).d;
  sk.part(d, domePaint(C.jacket, ink, 1.5), ink(OUTLINE), undefined, 0);
  sk.line(d, solid(ink(shade(C.jacket, 0.34))), 0.045);
}

/** 위에서 본 손 (장갑). 안쪽 선은 가늘게 — 몸 위에서 어두운 고리(둥근 창 · 귀)로 읽히지 않게 */
function topHand(sk: Sketch, ink: Ink, hand: readonly [number, number], rad = 0.17): void {
  sk.part(
    path().circle(hand[0], hand[1], rad).d,
    radial(hand[0] - 0.04, hand[1] - 0.04, rad * 1.3, [
      [0, ink(tint(C.gloveTop, 0.25))],
      [1, ink(C.gloveTop)],
    ]),
    ink(OUTLINE),
    undefined,
    0.25,
  );
}

/**
 * 위에서 본 몸통 (야전 재킷) 윤곽: 몸 중심에서 잰 [각도(도, 0 = 앞 · 90 = 오른쪽 옆 · 180 = 뒤), 반지름] — 왼쪽은 좌우 대칭.
 * 앞 옆(56~80°)은 판정 원 끝까지 부풀려 작은 크기에서 밝은 몸이 판정 원을 채우게 하고(걷기 · 겨눔 비틀림까지 옆 1.05r 안),
 * 어깨와 배낭 사이(110~150°)는 오목하게 — 등에 붙은 배낭이 따로 읽히고, 가드(등 갑옷) · 공통 생존자(부푼 방호복)의 둥근 몸과
 * 실루엣이 갈린다(겹침 IoU). 뒤 끝은 배낭이 덮는다. 피격 젖힘(sx)까지 뒤 1.0r 안
 */
const TORSO_POLAR: readonly (readonly [number, number])[] = [
  [0, 0.75],
  [32.5, 0.882],
  [56, 1],
  [68, 1.025],
  [80, 0.985],
  [95, 0.97],
  [112, 0.81],
  [128, 0.68],
  [150, 0.77],
  [180, 0.78],
];

/** 몸통 윤곽 경로. 수감 중 움츠림은 옆 폭 배수(halfW)로 좁힌다 */
function scoutTorsoPath(r: TopRig, sx: number): string {
  const k = r.halfW / TOP.halfW;
  const at = ([deg, rad]: readonly [number, number], side: 1 | -1): [number, number] => {
    const t = (deg * Math.PI) / 180;
    return [Math.cos(t) * rad, side * Math.sin(t) * rad * k];
  };
  const pts = [
    ...TORSO_POLAR.map((p) => at(p, 1)),
    ...[...TORSO_POLAR]
      .reverse()
      .slice(1, -1)
      .map((p) => at(p, -1)),
  ];
  return path(rotateAbout(r.twist, 0, 0))
    .with(translate(sx, 0))
    .smooth(pts, 1).d;
}

/** 위 그림 배낭 반폭(어깨보다 좁게 — 어깨와 배낭 사이 오목한 홈) · 뒤 끝 반지름 */
const PACK_HY = 0.42;
const PACK_R = 0.97;

/**
 * 위 그림 배낭: 앞 끝(front)은 곧은 둥근 모서리, 뒤 끝은 몸 둘레를 따르는 호(반지름 PACK_R) — 등 뒤를 판정 원 끝까지 채우되
 * 뒤 1.0r 안. m = 몸통 비틀림
 */
function packPath(m: Mat, front: number): string {
  const hy = PACK_HY;
  const R = PACK_R;
  const pts: [number, number][] = [
    [front + 0.02, 0],
    [front, hy * 0.78],
    [front - 0.1, hy],
    [-0.62, hy * 1.04],
    [-R * 0.87, hy * 0.86],
    [-R * 0.98, hy * 0.42],
    [-R, 0],
    [-R * 0.98, -hy * 0.42],
    [-R * 0.87, -hy * 0.86],
    [-0.62, -hy * 1.04],
    [front - 0.1, -hy],
    [front, -hy * 0.78],
  ];
  return path(m).smooth(pts, 1).d;
}

/** 위 그림 고글 띠의 반각 (머리 앞 윤곽을 따라 ±GOG, 뒤는 끈) */
const GOG = 0.95;

/**
 * 위 그림 고글 띠: 안쪽은 머리 중심에서 R − 0.17인 호, 바깥은 가운데 R + 0.12(앞 가운데 두께 그대로)에서 양 끝 R + 0.02로
 * 매끈하게 가늘어지고, 양 끝은 반원으로 둥글게 닫는다 — 각진 부메랑이 아니라 모자를 감싼 끈처럼
 */
function goggleBandPath(hx: number, hy: number, R: number): string {
  const ri = R - 0.17;
  const ro = (t: number): number => R + 0.02 + 0.1 * Math.cos(((t / GOG) * Math.PI) / 2) ** 2;
  const outer: [number, number][] = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = -GOG + (GOG * i) / 6;
    outer.push([hx + Math.cos(t) * ro(t), hy + Math.sin(t) * ro(t)]);
  }
  // 끝 반원: 중심은 끝 두께의 가운데, 반지름은 끝 두께의 반
  const cr = (R + 0.02 - ri) / 2;
  const cm = ri + cr;
  return path()
    .curve(outer)
    .arc(hx + Math.cos(GOG) * cm, hy + Math.sin(GOG) * cm, cr, GOG, GOG + Math.PI, false)
    .arc(hx, hy, ri, GOG, -GOG, false)
    .arc(hx + Math.cos(-GOG) * cm, hy + Math.sin(-GOG) * cm, cr, Math.PI - GOG, Math.PI * 2 - GOG, false)
    .Z().d;
}

/**
 * 위 그림 들고 다니는 망원경 (서기 · 걷기): 오른손이 접은 망원경을 오른쪽 가슴 앞에 쥐고, 대물 끝을 조금 안으로 모아 앞을
 * 겨눈다 — 대물 끝 가운데는 극각 약 15°(몸 중심에서 (1.26, 0.33)), 몸 밖으로 나온 부분의 방향은 약 20°, 가장 먼 모서리
 * 1.37r(걷기 흔들림까지 1.39r). 비대칭 돌출이 바라보는 방향 쪽에 있어 작은 크기에서도 실루엣이 가리키는 방향이 몸 방향과
 * 같다. 폭은 겨눌 때보다 가늘게(w)
 */
const REST = { ex: 0.64, ey: 0.56, ang: -0.36, w: 0.8 } as const;
/** 위 그림 겨눌 때 망원경 폭 배수 */
const SCOPE_W = 1.2;

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const r = topRig(p);
  const free = p.mode === 'free';
  const a = free ? p.action : 0;
  // 능력: 0 → 0.5 망원경을 들어 올림, 0.5 → 1 눈에 대고 늘임
  const up = ease(a / 0.5);
  const ext = ease((a - 0.5) / 0.5);
  const hit = p.hit;
  const s = r.s;
  // 겨눌 때 오른어깨를 조금 앞으로 (몸통을 왼쪽으로 비튼다)
  r.twist -= 0.06 * ext;
  const m = rotateAbout(r.twist, 0, 0);
  const W = (x: number, y: number): [number, number] => apply(m, x + r.ox, y);
  // 피격 젖힘: 머리 · 어깨 · 손은 다 밀리고 몸통은 0.4배만, 발 · 배낭 뒤 끝은 제자리 (뒤로 판정 원 밖에 나가지 않게)
  const bodyX = r.ox * 0.4;
  const shoulders: readonly [[number, number], [number, number]] = [
    W(r.shoulders[0][0], r.shoulders[0][1]),
    W(r.shoulders[1][0], r.shoulders[1][1]),
  ];
  // 겨눌 때 머리를 조금 내밀고, 피격 때는 뒤 · 옆으로 조금 밀린다
  const hx = r.head[0] + 0.03 * ext - 0.06 * hit;
  const hy = r.head[1] + 0.05 * hit;
  const R = r.headR;

  // 망원경 자세와 두 손 (몸 기준 좌표)
  let scope: Scope;
  let hands: [[number, number], [number, number]];
  if (free) {
    // 들고 걷기: 오른손이 접은 망원경을 오른쪽 가슴 앞에 쥐고 앞을 겨눈다 (REST)
    const rest: Scope = { ex: REST.ex + 0.02 * s, ey: REST.ey, ang: REST.ang + 0.02 * s, k: 0 };
    const raised: Scope = { ex: 0.3, ey: 0.66, ang: -0.6, k: 0.6 };
    // 겨눔: 오른쪽 렌즈 앞에 대고 늘인다 (대물 끝이 앞 1.55r 안)
    const aimed: Scope = { ex: hx + 0.48, ey: 0.21, ang: 0, k: 0.9 };
    scope = a <= 0.5 ? lerpScope(rest, raised, up) : lerpScope(raised, aimed, ext);
    // 피격: 망원경이 뒤로 밀리며 조금 바깥으로 젖혀진다 (고글을 가로지르지 않고, 옆으로 커 보이지 않게)
    scope.ex += r.ox * 1.3 - 0.1 * hit;
    scope.ey -= 0.04 * hit;
    scope.ang += 0.1 * hit;
    const sm = mul(translate(scope.ex, scope.ey), rotate(scope.ang));
    const right = apply(sm, lerp(0.07, 0.12, a), lerp(0, 0.16, ext));
    // 왼손은 몸 쪽으로 조금 붙인다 (몸 옆에 따로 떨어진 둥근 점으로 읽히지 않게)
    const leftRest = W(r.hands[0][0], r.hands[0][1] * 0.92);
    // 왼손: 들어 올릴 때 몸 쪽으로 모으고, 겨눌 때 앞으로 (옆으로 커 보이지 않게)
    const left: [number, number] = [leftRest[0] + 0.14 * ext, leftRest[1] + 0.06 * up + 0.04 * ext];
    hands = [left, right];
  } else {
    // 수감 · 구조 중: 망원경은 접어서 배낭 오른쪽 옆을 따라 눕혀 꽂아 둔다 (대물 끝이 앞 — 바라보는 방향을 흐리지 않게)
    const [sx, sy] = W(-0.68, 0.52);
    scope = { ex: sx, ey: sy, ang: r.twist, k: 0 };
    // 구조 중에는 손을 고글 바깥 양옆으로 (고글을 가리지 않게)
    const rh: readonly [readonly [number, number], readonly [number, number]] =
      p.mode === 'reach'
        ? [
            [0.74, -0.44],
            [0.74, 0.44],
          ]
        : r.hands;
    hands = [W(rh[0][0], rh[0][1]), W(rh[1][0], rh[1][1])];
  }

  // 1) 장화
  for (const [fx, fy] of r.feet) topShoe(sk, fx, fy, C.boot, C.sole, ink, 0.26);
  // 2) 몸통 (야전 재킷). 안쪽 가는 선은 없다 — 소매 테두리와 겹쳐 몸 가장자리에 어두운 띠가 생기지 않게(밝은 몸 덩어리)
  sk.part(scoutTorsoPath(r, bodyX), domePaint(C.jacket, ink, 1.5), ink(OUTLINE), undefined, 0);
  // 3) 배낭 (등 뒤 중간 초록 둥근 판) + 안테나. 뒤 끝 · 모서리가 판정 원(뒤 1.0r) 안 — 피격 때는 앞쪽만 몸과 같이 밀려 눌린다
  sk.part(packPath(m, -0.36 + bodyX), domePaint(C.packTop, ink, 1.6), ink(OUTLINE), undefined, 0.3);
  // 안테나: 끝 빛 점까지 판정 원 안(반경 약 0.98)에 머물게 짧게
  const sway = 0.04 * Math.sin(p.walk * 2) * p.stride - 0.04 * hit;
  const [ax0, ay0] = apply(m, -0.66, -0.28);
  const [ax1, ay1] = apply(m, -0.74, -0.44 + sway);
  sk.line(path().M(ax0, ay0).L(ax1, ay1).d, solid(ink(C.steel)), 0.07);
  sk.fill(path().circle(ax1, ay1, 0.08).d, solid(ink(C.neon), 0.3));
  sk.fill(path().circle(ax1, ay1, 0.045).d, solid(ink(tint(C.neon, 0.4))));
  if (!free)
    drawScope(sk, ink, mul(translate(scope.ex, scope.ey), rotate(scope.ang)), scope.k, 1.0, 'top', false);
  // 4) 소매 (머리 밑). 수감 중에는 손도 머리 밑 (가슴 앞에 모은 손)
  topSleeve(sk, ink, shoulders[0], hands[0]);
  topSleeve(sk, ink, shoulders[1], hands[1]);
  // 왼손 (보통 · 수감)은 머리 밑 층, 망원경을 쥔 오른손 · 구조 중 두 손은 위 층
  if (p.mode !== 'reach') topHand(sk, ink, hands[0]);
  if (p.mode === 'captive') topHand(sk, ink, hands[1]);
  // 5) 머리: 둥근 초록 모자 + 머리를 한 바퀴 두른 고글 고리(앞 = 밝은 금속 띠, 뒤 = 어두운 끈) + 굵고 짧은 렌즈 둘.
  //    모자 테두리 안쪽 선은 조금 가늘게 (몸통과 갈릴 만큼만)
  sk.part(
    path().circle(hx, hy, R).d,
    domePaint(C.jacket, ink, R * 1.3, hx - 0.06, hy),
    ink(OUTLINE),
    undefined,
    0.3,
  );
  sk.line(path().arc(hx, hy, R * 0.94, GOG, Math.PI * 2 - GOG).d, solid(ink(C.band)), 0.08);
  // 고글 금속은 몸 초록보다 확실히 밝게 (흑백 · 작은 크기에서도 앞쪽 밝은 띠가 몸과 갈려 바라보는 방향이 읽히게)
  const gogPaint = radial(hx, hy, R + 0.14, [
    [0, ink(shade(C.steel, 0.1))],
    [0.72, ink(tint(C.steel, 0.4))],
    [0.9, ink(tint(C.steel, 0.5))],
    [1, ink(tint(C.steel, 0.15))],
  ]);
  for (const side of [-1, 1]) {
    const gy = hy + side * 0.21;
    sk.part(path().capsule(hx + 0.5, gy, hx + 0.68, gy, 0.34, 0.34).d, gogPaint, ink(OUTLINE));
  }
  // 코걸이 (두 렌즈 사이를 메워 렌즈 사이 외곽선 홈이 검은 구멍으로 남지 않게, 한 단 어둡게 — 렌즈 둘은 그대로 읽힌다)
  sk.fill(path().roundRect(hx + 0.48, hy - 0.12, 0.26, 0.24, 0.06).d, solid(ink(shade(C.steel, 0.22))));
  // 고글 띠: 머리 앞 윤곽을 따라 안쪽으로 넓게 (작은 크기에서 앞쪽 밝은 띠가 바라보는 방향 단서 — 실루엣은 그대로)
  sk.part(goggleBandPath(hx, hy, R), gogPaint, ink(OUTLINE));
  for (const side of [-1, 1]) {
    const gy = hy + side * 0.21;
    // 렌즈 면 (네온, 옆에서 본 테)
    sk.fill(path().ellipse(hx + 0.8, gy, 0.055, 0.11).d, solid(ink(C.neon), 0.5));
    sk.fill(path().ellipse(hx + 0.805, gy, 0.03, 0.075).d, solid(ink(tint(C.neon, 0.5))));
  }
  // 6) 망원경 · 손. 들어 올려 머리 · 고글 위로 지나갈 때(능력 0.3 넘게)와 구조 중 두 손은 층을 나눠 굵은 외곽선이 머리 위에 그어지게.
  // 들고 걷기 · 피격 때는 같은 층에 그린다 — 막대는 몸 밖에서만 굵은 외곽선이 생기고, 몸통 위에서는 가는 안쪽 선으로만 갈려
  // 망원경 외곽선이 몸통 옆구리를 검게 덮지 않는다 (작은 크기에서 밝은 몸 덩어리가 판정 원을 채우게)
  if ((free && a > 0.3) || p.mode === 'reach') sk.layer();
  // 쥔 손은 망원경 밑에 (밝은 막대가 손에 끊기지 않고, 손은 양옆으로 조금 보인다)
  if (free) topHand(sk, ink, hands[1], 0.15);
  if (free)
    drawScope(
      sk,
      ink,
      mul(translate(scope.ex, scope.ey), rotate(scope.ang)),
      scope.k,
      lerp(REST.w, SCOPE_W, up),
      'top',
    );
  if (p.mode === 'reach') for (const h of hands) topHand(sk, ink, h);
  return sk.drawing();
}

/** 정면 망원경 크기 배수 (위 그림의 짧게 접은 망원경 인상에 맞춰 조금 작게 — 얼굴 · 고글이 주인공) */
const FRONT_SCOPE = 0.82;

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const neon = frontNeon(sk, p.tone);
  const by = frontBreath(p.t);
  const sway = Math.sin(p.t * 2.2) * 0.035;
  const hy = FRONT.headY + by;
  // 정면은 위 그림과 같은 손: 망원경은 캐릭터 오른손(화면 왼쪽), 안테나는 왼쪽 어깨 뒤(화면 오른쪽)
  // 1) 안테나 (배낭에서 솟아 머리 오른쪽 위로) — 맨 뒤. 끝 빛 번짐까지 상반신(1.5배)에서도 상자 오른쪽 안(x ≤ 0.98)
  const tip: [number, number] = [0.53 - sway, -0.86 + by];
  sk.part(
    path().capsule(0.3, 0.02 + by, tip[0], tip[1], 0.045, 0.03).d,
    solid(ink(C.gunmetal)),
    ink(OUTLINE),
  );
  // 2) 배낭 (어깨 뒤로 양옆이 보인다)
  sk.part(
    path().roundRect(-0.38, -0.04 + by, 0.76, 0.42, 0.1).d,
    linear(-0.38, 0, 0.38, 0, [
      [0, ink(tint(C.pack, 0.12))],
      [1, ink(shade(C.pack, 0.3))],
    ]),
    ink(OUTLINE),
  );
  // 3) 다리 (어두운 카고 바지 + 장화)
  if (!p.bust) {
    frontLegs(sk, C.pants, C.boot, C.sole, ink, 0.03, 0.16);
    for (const s of [-1, 1]) {
      const x = s * (FRONT.legX + 0.03);
      // 허벅지 주머니
      sk.fill(
        path().roundRect(x - 0.06 + s * 0.02, FRONT.hipY + 0.08, 0.11, 0.12, 0.02).d,
        solid(ink(shade(C.pants, 0.3))),
      );
      // 장화 목 (짙은 초록 띠)
      sk.fill(path().roundRect(x - 0.09, FRONT.ankleY - 0.07, 0.18, 0.05, 0.02).d, solid(ink(C.deep)));
    }
  }
  // 4) 왼팔 (화면 오른쪽): 손을 허리께에 편히
  frontArm(sk, 1, C.coat, C.glove, ink, [0.45, 0.35 + by], by);
  // 5) 몸통 (야전 재킷) + 지퍼 · 가슴 주머니 · 배낭 멜빵 · 허리띠
  sk.part(frontTorsoPath(by), frontClothPaint(C.coat, ink), ink(OUTLINE));
  sk.line(
    path()
      .M(0, FRONT.neckY + 0.06 + by)
      .L(0, FRONT.hipY - 0.04).d,
    solid(ink(shade(C.coat, 0.4))),
    0.022,
  );
  for (const s of [-1, 1]) {
    // 멜빵 (어깨에서 배로)
    sk.line(
      path()
        .M(s * 0.17, FRONT.shoulderY - 0.01 + by)
        .Q(s * 0.19, 0.18 + by, s * 0.15, 0.32).d,
      solid(ink(C.strap)),
      0.06,
    );
    // 가슴 주머니 덮개
    sk.fill(
      path().roundRect(s * 0.09 - 0.045 + s * 0.04, 0.12 + by, 0.09, 0.07, 0.02).d,
      solid(ink(shade(C.coat, 0.22))),
    );
  }
  // 가슴 멜빵 클립 등 (청록 발광 점, 화면 오른쪽 멜빵 하나 — 반대쪽은 망원경 쥔 팔에 가린다)
  neon.dot(0.183, 0.15 + by, 0.016, 0.75);
  sk.fill(path().roundRect(-0.25, FRONT.hipY - 0.1, 0.5, 0.06, 0.02).d, solid(ink(C.strap)));
  sk.fill(path().roundRect(-0.04, FRONT.hipY - 0.105, 0.08, 0.07, 0.015).d, solid(ink(C.steel)));
  // 목깃 (짙은 초록 높은 깃)
  sk.part(
    path()
      .M(-0.18, FRONT.neckY + 0.02 + by)
      .Q(0, FRONT.neckY + 0.13 + by, 0.18, FRONT.neckY + 0.02 + by)
      .L(0.15, FRONT.neckY + 0.1 + by)
      .Q(0, FRONT.neckY + 0.18 + by, -0.15, FRONT.neckY + 0.1 + by)
      .Z().d,
    solid(ink(C.deep)),
    ink(OUTLINE),
    1,
    0.3,
  );
  // 목깃 파이핑 (청록 네온, 깃 아래 테 바로 안쪽)
  neon.line(
    path()
      .M(0.145, FRONT.neckY + 0.075 + by)
      .Q(0, FRONT.neckY + 0.155 + by, -0.145, FRONT.neckY + 0.075 + by).d,
    0.011,
    0.6,
  );
  // 6) 머리: 얼굴 + 둥근 초록 모자 + 쌍안 렌즈 고글
  frontHead(sk, ink, by);
  // 옆머리 (모자 밑으로 삐져나온 뾰족한 머리칼, 귀 앞)
  for (const s of [-1, 1])
    sk.fill(
      path()
        .M(s * 0.37, hy - 0.08)
        .L(s * 0.33, hy + 0.17)
        .L(s * 0.29, hy + 0.08)
        .L(s * 0.27, hy + 0.13)
        .L(s * 0.25, hy - 0.04)
        .Z().d,
      solid(ink(C.hair)),
    );
  // 모자 (둥근 정찰 모자, 이마를 덮는다)
  const capR = FRONT.headR * 1.07;
  sk.part(
    path()
      .arc(0, hy + 0.01, capR, Math.PI + 0.12, Math.PI * 2 - 0.12)
      .Q(0.2, hy - 0.04, 0, hy - 0.045)
      .Q(-0.2, hy - 0.04, -capR * Math.cos(0.12), hy + 0.01 - capR * Math.sin(0.12))
      .Z().d,
    radial(-0.12, hy - 0.26, 0.5, [
      [0, ink(tint(C.jacket, 0.22))],
      [0.5, ink(C.jacket)],
      [1, ink(shade(C.jacket, 0.3))],
    ]),
    ink(OUTLINE),
  );
  // 모자 솔기 · 꼭지 단추
  sk.line(
    path()
      .M(0, hy - 0.38)
      .Q(0.02, hy - 0.2, 0, hy - 0.06).d,
    solid(ink(shade(C.jacket, 0.28))),
    0.018,
  );
  sk.fill(path().circle(0, hy - 0.39, 0.035).d, solid(ink(C.deep)));
  // 모자 앞 렌즈 휘장 (옛 렌즈 모티프: 짙은 원 + 밝은 초록 테)
  sk.fill(path().circle(0, hy - 0.2, 0.065).d, solid(ink(C.deep)));
  sk.line(path().circle(0, hy - 0.2, 0.065).d, solid(ink(shade(C.jacket, 0.3))), 0.022);
  sk.fill(path().circle(-0.018, hy - 0.218, 0.017).d, solid(ink(0xffffff), 0.8));
  // 챙 (야전모 — 가로로 넓고 양끝이 조금 처진 챙: 가드의 헬멧과 머리 실루엣을 가른다)
  const brimY = hy - 0.05;
  sk.part(
    path()
      .M(-0.46, brimY + 0.03)
      .Q(0, brimY - 0.05, 0.46, brimY + 0.03)
      .L(0.45, brimY + 0.11)
      .Q(0, brimY + 0.03, -0.45, brimY + 0.11)
      .Z().d,
    linear(0, brimY - 0.04, 0, brimY + 0.1, [
      [0, ink(shade(C.jacket, 0.08))],
      [1, ink(shade(C.jacket, 0.3))],
    ]),
    ink(OUTLINE),
    1,
    0.3,
  );
  // 앞머리 한 다발 (챙 밑에서 화면 오른쪽 관자놀이로 휘어 내린 뾰족한 머리칼 — 고글 바깥이라 가리지 않는다)
  sk.fill(
    path()
      .M(0.22, brimY + 0.06)
      .Q(0.4, brimY + 0.08, 0.43, brimY + 0.3)
      .Q(0.37, brimY + 0.2, 0.33, brimY + 0.19)
      .Q(0.34, brimY + 0.24, 0.31, brimY + 0.28)
      .Q(0.29, brimY + 0.14, 0.2, brimY + 0.1)
      .Z().d,
    solid(ink(C.hair)),
  );
  // 고글 끈 (머리 옆으로)
  const gy = hy + 0.05;
  sk.fill(path().roundRect(-0.38, gy - 0.045, 0.76, 0.09, 0.03).d, solid(ink(C.strap)));
  // 렌즈 (큰 둥근 렌즈 둘: 어두운 금속 테 + 초록 렌즈 빛 + 렌즈 속 눈동자 + 반짝임)
  const glint = 0.75 + 0.25 * Math.sin(p.t * 1.7);
  for (const s of [-1, 1]) {
    const gx = s * 0.155;
    sk.part(
      path().circle(gx, gy, 0.155).d,
      radial(gx - 0.05, gy - 0.05, 0.2, [
        [0, ink(tint(C.gunmetal, 0.35))],
        [1, ink(shade(C.gunmetal, 0.2))],
      ]),
      ink(OUTLINE),
      1,
      0.3,
    );
    sk.fill(
      path().circle(gx, gy, 0.112).d,
      radial(gx, gy, 0.12, [
        [0, ink(tint(C.neon, 0.5))],
        [0.55, ink(C.neon)],
        [1, ink(C.deep)],
      ]),
    );
    sk.fill(path().ellipse(gx + s * 0.012, gy + 0.01, 0.04, 0.055).d, solid(ink(MAT.eye)));
    // 렌즈 테 (청록 네온 고리: 금속 테와 초록 렌즈 사이)
    neon.line(path().circle(gx, gy, 0.121).d, 0.011, 0.7);
    sk.fill(path().circle(gx - 0.045, gy - 0.045, 0.026).d, solid(ink(0xffffff), 0.9 * glint));
  }
  // 코걸이 (렌즈 사이)
  sk.fill(path().roundRect(-0.03, gy - 0.03, 0.06, 0.05, 0.02).d, solid(ink(C.gunmetal)));
  // 볼 · 입 (호기심 많은 웃음)
  for (const s of [-1, 1])
    sk.fill(path().ellipse(s * 0.23, hy + 0.255, 0.05, 0.028).d, solid(ink(MAT.skinShade)), 0.35);
  sk.fill(
    path()
      .M(-0.07, hy + 0.225)
      .Q(0.0, hy + 0.3, 0.08, hy + 0.215)
      .Q(0.0, hy + 0.25, -0.07, hy + 0.225)
      .Z().d,
    solid(ink(0x5b2a22)),
  );
  // 7) 오른팔(화면 왼쪽) + 접은 망원경 (층을 나눠 굵은 외곽선): 위 그림처럼 오른손에 짧게 접어 쥐고 대물 끝을 바깥 위로
  //    비스듬히 — 얼굴 · 고글이 주인공이고 망원경은 어깨 옆 곁들이. 자리는 화면 오른쪽 기준으로 잡고 좌우로 뒤집어 놓는다
  //    (금속 통 칠은 통 폭 방향이라 뒤집어도 빛이 같다). 상반신은 1.5배로 키워도 대물 끝이 상자 안에 들게 더 세우고 몸 가까이.
  //    크기는 FRONT_SCOPE배. 대물 끝(외곽선 제외)은 전신 x ≈ −0.76, 상반신(1.5배 뒤) x ≈ −0.73 — 상반신 상자(로비 역할 카드 ·
  //    결과 화면) 가장자리와 여유가 있다
  sk.layer();
  const hand: [number, number] = p.bust ? [0.24, 0.34 + by] : [0.42, 0.26 + by];
  frontArm(sk, -1, C.coat, C.glove, ink, [-hand[0], hand[1]], by);
  const ang = (p.bust ? -1.0 : -0.72) + sway * 0.4;
  const grip = 0.2 * FRONT_SCOPE;
  const sm = mul(
    scale(-1, 1),
    mul(
      translate(hand[0] - Math.cos(ang) * grip, hand[1] - Math.sin(ang) * grip),
      mul(rotate(ang), scale(FRONT_SCOPE, FRONT_SCOPE)),
    ),
  );
  drawScope(sk, ink, sm, 0, 0.66, 'front', true, neon);
  sk.part(path().circle(-hand[0], hand[1], 0.085).d, solid(ink(C.glove)), ink(OUTLINE));
  // 안테나 끝 (청록 LED: 번짐 반지름 0.06 — 상반신에서도 상자 오른쪽 안)
  neon.dot(tip[0], tip[1], 0.03, 1, 0.06);
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
  if (!p.bust) return frontBody(p, o);
  // 상반신: 머리 · 고글 · 망원경 · 어깨가 상자를 채우게 1.5배 (외곽선 굵기는 그대로)
  const k = 1.5;
  return transformDrawing(frontBody(p, { w: o.w / k }), k, 0.04, 0.42);
}

export const SCOUT_ART: SurvivorArt = {
  id: 'scout',
  top: (p, o) => top(cleanSurvivorPose(p), o),
  front: (p, o) => front(cleanFrontPose(p), o),
  topExtent: 1.53,
};
