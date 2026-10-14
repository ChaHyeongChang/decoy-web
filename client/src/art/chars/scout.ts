// 스카우트 새 캐릭터 (캐릭터 리디자인): 초록 야전 재킷 + 챙 달린 야전모 + 쌍안 렌즈 고글 + 접이식 망원경 + 안테나 달린 작은 배낭.
// 멀리 보는 정찰병이라는 인상. 위에서 보면 덩어리는 넷뿐이다: 초록 머리 · 몸, 머리 앞을 두른 밝은 고글 고리(옛 렌즈 모티프),
// 몸 오른쪽에서 앞으로 길게 뻗은 밝은 망원경 막대(비대칭 — 걸을 때도 늘 몸 앞으로 나온다), 등의 중간 초록 배낭.
// 몸통 · 배낭은 판정 원을 거의 채우는 둥근 덩어리로, 어두운 칠(끈 · 장갑 · 배낭)은 역할색의 중간 변형으로 밝혀
// 작은 크기(휴대폰 몸 반지름 6.7px)에서도 판정 원을 밝은 몸이 채운다.
// 망원경은 들어 올려 눈에 댈 때만 층을 나눠(sk.layer) 굵은 외곽선이 머리 위에 그어지게 한다.
// 네온 포인트는 고글 렌즈 빛 · 망원경 대물렌즈(위 = 빛 선, 정면 = 유리 테) · 안테나 끝 점뿐이다(밝은 초록, 글자용 역할색).
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
  frontLegs,
  frontTorsoPath,
  inkFor,
  topRig,
  topShoe,
  type TopRig,
  type Ink,
} from './survivorBase';
import type { ArtOptions, FrontPose, SurvivorArt, SurvivorPose } from './types';

/** 스카우트 색 */
export const SCOUT_COLOR = {
  jacket: ROLE.scout,
  /** 짙은 초록 (그늘 · 배낭 덮개 · 목깃) */
  deep: 0x14532d,
  /** 네온 (밝은 초록, 글자용 역할색) */
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
  /** 위 그림 장갑 (한 단 밝게 — 작은 크기에서 몸 둘레가 어둡게 얼룩지지 않게) */
  gloveTop: shade(ROLE.scout, 0.22),
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
 * 정면 그림(view 'front'): 눈컵 · 접안부 · 가운데 통 · 대물 통의 단 차이와 마디 고리, 대물렌즈는 빛이 아니라 유리.
 */
function drawScope(
  sk: Sketch,
  ink: Ink,
  m: Mat,
  k: number,
  wk: number,
  view: 'top' | 'front',
  glow = true,
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
  // 대물렌즈 (유리): 짙은 원판 + 가는 네온 테 + 왼쪽 위 작은 반짝임
  const lens = path(m).ellipse(L - 0.005, 0, 0.055 * wk, hw * 0.86).d;
  sk.fill(lens, solid(ink(C.deep)));
  sk.line(lens, solid(ink(C.neon)), 0.02);
  sk.fill(path(m).ellipse(L - 0.005, -hw * 0.36, 0.022 * wk, hw * 0.3).d, solid(ink(0xffffff), 0.8));
}

/** 위에서 본 팔: 어깨 → 손 소매 (손은 따로) */
function topSleeve(
  sk: Sketch,
  ink: Ink,
  sh: readonly [number, number],
  hand: readonly [number, number],
  width = 0.3,
): void {
  sk.part(
    path().capsule(sh[0], sh[1], hand[0], hand[1], width, width * 0.86).d,
    domePaint(C.jacket, ink, 1.5),
    ink(OUTLINE),
    undefined,
    0.2,
  );
}

function topHand(sk: Sketch, ink: Ink, hand: readonly [number, number], rad = 0.17): void {
  sk.part(
    path().circle(hand[0], hand[1], rad).d,
    radial(hand[0] - 0.04, hand[1] - 0.04, rad * 1.3, [
      [0, ink(tint(C.gloveTop, 0.25))],
      [1, ink(C.gloveTop)],
    ]),
    ink(OUTLINE),
  );
}

/**
 * 위에서 본 몸통 (야전 재킷): 공통 어깨 판보다 앞뒤 · 어깨 모서리를 채운 둥근 판.
 * 작은 크기(몸 반지름 6~11px)에서 판정 원을 밝은 몸이 채우게 — 외곽선 밖 빈 테두리를 줄인다
 */
function scoutTorsoPath(r: TopRig): string {
  const w = r.halfW;
  const d = r.halfD;
  const pts: [number, number][] = [
    [d * 1.25, 0],
    [d * 1.24, -w * 0.5],
    [d * 0.86, -w * 0.86],
    [0, -w * 1.03],
    [-d * 0.78, -w * 0.92],
    [-d * 1.25, -w * 0.52],
    [-d * 1.33, 0],
    [-d * 1.25, w * 0.52],
    [-d * 0.78, w * 0.92],
    [0, w * 1.03],
    [d * 0.86, w * 0.86],
    [d * 1.24, w * 0.5],
  ];
  return path(rotateAbout(r.twist, 0, 0))
    .with(translate(r.ox, 0))
    .smooth(pts, 1).d;
}

/** 위 그림 고글 띠의 반각 (머리 앞 윤곽을 따라 ±GOG, 뒤는 끈) */
const GOG = 0.95;

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const r = topRig(p);
  const free = p.mode === 'free';
  const a = free ? p.action : 0;
  // 능력: 0 → 0.5 망원경을 들어 올림, 0.5 → 1 눈에 대고 쭉 늘임
  const up = ease(a / 0.5);
  const ext = ease((a - 0.5) / 0.5);
  const hit = p.hit;
  const s = r.s;
  // 겨눌 때 오른어깨를 조금 앞으로 (몸통을 왼쪽으로 비튼다)
  r.twist -= 0.14 * ext;
  const m = rotateAbout(r.twist, 0, 0);
  const W = (x: number, y: number): [number, number] => apply(m, x + r.ox, y);
  const shoulders = r.shoulders.map(([x, y]) => W(x, y));
  // 겨눌 때 머리를 조금 내밀고, 피격 때는 뒤 · 옆으로 조금 밀린다
  const hx = r.head[0] + 0.03 * ext - 0.06 * hit;
  const hy = r.head[1] + 0.05 * hit;
  const R = r.headR;

  // 망원경 자세와 두 손 (몸 기준 좌표)
  let scope: Scope;
  let hands: [[number, number], [number, number]];
  if (free) {
    // 들고 걷기: 오른손이 망원경 끝을 쥐고 앞을 겨눈다 (팔 흔들림은 조금 작게)
    // 걷기 흔들림은 작게 (막대가 늘 몸 앞으로 0.3r 넘게 나오도록)
    // 쥔 손 · 막대를 몸 옆으로 조금 내어(ey 0.92) 망원경 외곽선이 몸통을 덜 덮게 한다
    const rest: Scope = { ex: 0.4 + 0.06 * s, ey: 0.92, ang: -0.06 + 0.04 * s, k: 0.8 };
    const raised: Scope = { ex: 0.3, ey: 0.7, ang: -0.6, k: 0.8 };
    const aimed: Scope = { ex: hx + 0.48, ey: 0.24, ang: 0, k: 1 };
    scope = a <= 0.5 ? lerpScope(rest, raised, up) : lerpScope(raised, aimed, ext);
    // 피격: 망원경이 뒤로 밀리며 안쪽으로 꺾인다 (옆으로 커 보이지 않게)
    scope.ex += r.ox * 1.3 - 0.1 * hit;
    scope.ey -= 0.04 * hit;
    scope.ang -= 0.3 * hit;
    const sm = mul(translate(scope.ex, scope.ey), rotate(scope.ang));
    const right = apply(sm, lerp(0.07, 0.12, a), lerp(0, 0.16, ext));
    const leftRest = W(r.hands[0][0], r.hands[0][1]);
    const left: [number, number] = [leftRest[0] + 0.16 * ext + 0.06 * up, leftRest[1] + 0.08 * ext];
    hands = [left, right];
  } else {
    // 수감 · 구조 중: 망원경은 접어서 배낭 오른쪽 옆면을 따라 눕혀 꽂아 둔다 (대물 끝이 앞 — 바라보는 방향을 흐리지 않게)
    const [sx, sy] = W(-0.9, 0.5);
    scope = { ex: sx, ey: sy, ang: r.twist, k: 0 };
    // 구조 중에는 손을 고글 바깥 양옆으로 (고글을 가리지 않게)
    const rh: readonly (readonly [number, number])[] =
      p.mode === 'reach'
        ? [
            [0.74, -0.44],
            [0.74, 0.44],
          ]
        : r.hands;
    hands = [W(rh[0]![0], rh[0]![1]), W(rh[1]![0], rh[1]![1])];
  }

  // 1) 장화
  for (const [fx, fy] of r.feet) topShoe(sk, fx + r.ox, fy, C.boot, C.sole, ink, 0.26);
  // 2) 몸통 (야전 재킷)
  sk.part(scoutTorsoPath(r), domePaint(C.jacket, ink, 1.5), ink(OUTLINE));
  // 3) 배낭 (등 뒤, 어두운 남회색 + 짙은 초록 덮개) + 안테나
  const pm = mul(m, translate(r.ox, 0));
  sk.part(
    path(pm).roundRect(-0.98, -0.56, 0.6, 1.12, 0.26).d,
    domePaint(C.packTop, ink, 1.6),
    ink(OUTLINE),
    undefined,
    0.3,
  );
  // 안테나: 끝이 판정 원 안(반경 약 0.97)에 머물게 짧게
  const sway = 0.05 * Math.sin(p.walk * 2) * p.stride - 0.06 * hit;
  const [ax0, ay0] = apply(pm, -0.74, -0.3);
  const [ax1, ay1] = apply(pm, -0.84, -0.5 + sway);
  sk.line(path().M(ax0, ay0).L(ax1, ay1).d, solid(ink(C.steel)), 0.07);
  sk.fill(path().circle(ax1, ay1, 0.08).d, solid(ink(C.neon), 0.3));
  sk.fill(path().circle(ax1, ay1, 0.045).d, solid(ink(tint(C.neon, 0.4))));
  if (!free)
    drawScope(sk, ink, mul(translate(scope.ex, scope.ey), rotate(scope.ang)), scope.k, 1.1, 'top', false);
  // 4) 소매 (머리 밑). 수감 중에는 손도 머리 밑 (가슴 앞에 모은 손)
  topSleeve(sk, ink, shoulders[0] as [number, number], hands[0]);
  topSleeve(sk, ink, shoulders[1] as [number, number], hands[1]);
  // 왼손 (보통 · 수감)은 머리 밑 층, 망원경을 쥔 오른손 · 구조 중 두 손은 위 층
  if (p.mode !== 'reach') topHand(sk, ink, hands[0]);
  if (p.mode === 'captive') topHand(sk, ink, hands[1]);
  // 5) 머리: 둥근 초록 모자 + 머리를 한 바퀴 두른 고글 고리(앞 = 밝은 금속 띠, 뒤 = 어두운 끈) + 굵고 짧은 렌즈 둘
  sk.part(path().circle(hx, hy, R).d, domePaint(C.jacket, ink, R * 1.3, hx - 0.06, hy), ink(OUTLINE));
  sk.line(path().arc(hx, hy, R * 0.94, GOG, Math.PI * 2 - GOG).d, solid(ink(C.band)), 0.08);
  const gogPaint = radial(hx, hy, R + 0.14, [
    [0, ink(shade(C.steel, 0.3))],
    [0.8, ink(tint(C.steel, 0.15))],
    [1, ink(shade(C.steel, 0.15))],
  ]);
  for (const side of [-1, 1]) {
    const gy = hy + side * 0.21;
    sk.part(path().capsule(hx + 0.5, gy, hx + 0.68, gy, 0.34, 0.34).d, gogPaint, ink(OUTLINE));
  }
  // 코걸이 (두 렌즈 사이를 메워 렌즈 사이 외곽선 홈이 검은 구멍으로 남지 않게, 한 단 어둡게 — 렌즈 둘은 그대로 읽힌다)
  sk.fill(path().roundRect(hx + 0.48, hy - 0.12, 0.26, 0.24, 0.06).d, solid(ink(shade(C.steel, 0.22))));
  sk.part(
    path()
      .arc(hx, hy, R + 0.12, -GOG, GOG)
      .arc(hx, hy, R - 0.12, GOG, -GOG, false)
      .Z().d,
    gogPaint,
    ink(OUTLINE),
  );
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
  if (free) drawScope(sk, ink, mul(translate(scope.ex, scope.ey), rotate(scope.ang)), scope.k, 1.35, 'top');
  if (p.mode === 'reach') for (const h of hands) topHand(sk, ink, h);
  return sk.drawing();
}

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const by = frontBreath(p.t);
  const sway = Math.sin(p.t * 2.2) * 0.035;
  const hy = FRONT.headY + by;
  // 1) 안테나 (배낭에서 솟아 머리 왼쪽 위로) — 맨 뒤
  const tip: [number, number] = [-0.56 + sway, -0.86 + by];
  sk.part(
    path().capsule(-0.3, 0.02 + by, tip[0], tip[1], 0.045, 0.03).d,
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
  // 4) 왼팔 (화면 왼쪽): 손을 허리께에 편히
  frontArm(sk, -1, C.coat, C.glove, ink, [-0.45, 0.35 + by], by);
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
  // 6) 머리: 얼굴 + 둥근 초록 모자 + 쌍안 렌즈 고글
  sk.part(
    path().circle(0, hy, FRONT.headR).d,
    radial(-0.1, hy - 0.12, FRONT.headR * 1.25, [
      [0, ink(tint(MAT.skin, 0.12))],
      [0.7, ink(MAT.skin)],
      [1, ink(MAT.skinShade)],
    ]),
    ink(OUTLINE),
  );
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
  // 7) 오른팔 + 망원경 (층을 나눠 굵은 외곽선): 오른손에 늘인 망원경을 비스듬히 든다
  sk.layer();
  // 대물 끝(외곽선 포함)이 아이콘 상자 안에 들게: 전신은 x ≤ 0.97, 상반신은 1.5배로 키운 뒤 x ≤ 0.95.
  // 상반신은 망원경을 더 세우고 짧게 접어 쥔 손 위로 올린다 (작은 아이콘에서 렌즈가 잘리지 않게)
  const hand: [number, number] = p.bust ? [0.2, 0.36 + by] : [0.42, 0.16 + by];
  frontArm(sk, 1, C.coat, C.glove, ink, hand, by);
  const ang = (p.bust ? -0.86 : -0.95) + sway * 0.4;
  const sm = mul(translate(hand[0] - Math.cos(ang) * 0.24, hand[1] - Math.sin(ang) * 0.24), rotate(ang));
  drawScope(sk, ink, sm, p.bust ? 0.45 : 1, 0.7, 'front');
  sk.part(path().circle(hand[0], hand[1], 0.085).d, solid(ink(C.glove)), ink(OUTLINE));
  // 안테나 끝 (네온 점)
  sk.fill(path().circle(tip[0], tip[1], 0.06).d, solid(ink(C.neon), 0.35));
  sk.fill(path().circle(tip[0], tip[1], 0.032).d, solid(ink(tint(C.neon, 0.45))));
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
  if (!p.bust) return frontBody(p, o);
  // 상반신: 머리 · 고글 · 망원경 · 어깨가 상자를 채우게 1.5배 (외곽선 굵기는 그대로)
  const k = 1.5;
  return transformDrawing(frontBody(p, { w: o.w / k }), k, -0.04, 0.42);
}

export const SCOUT_ART: SurvivorArt = { id: 'scout', top, front, topExtent: 1.56 };
