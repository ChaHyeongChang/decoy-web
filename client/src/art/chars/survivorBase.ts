// 생존자 공통 체형 (캐릭터 리디자인): 위에서 본 몸 · 정면 몸의 뼈대와 부품. 역할 그림(runner · guard · scout)과
// 괴물 화면 공통 생존자(common)가 같은 체형 위에 옷 · 소품을 얹는다 → 네 그림의 몸 크기 · 비율이 같다
// (역할마다 '커 보이는' 차이가 없게, VISUAL_SPEC 4.1 앞 돌출 1.55r 한도 그대로).
//
// 위에서 본 그림: 단위 = 몸 반지름 1, +x = 바라보는 방향. 빛은 위에서 (돔 음영, 회전과 무관) — 왼쪽 위 반사광은 굽기 쪽의
// 돌지 않는 'gloss' 그림이 따로 맡는다. 정면 그림: 상자 [−1, 1]², 빛은 왼쪽 위.
import { OUTLINE } from '../palette';
import {
  linear,
  mix,
  path,
  radial,
  rotateAbout,
  shade,
  solid,
  tint,
  translate,
  type Paint,
  type Sketch,
} from './kit';
import type { SurvivorPose, Tone } from './types';

/** 사망 회색 (VISUAL_SPEC 4.2, 옛 그림과 같은 값) */
export const DEAD_GRAY = 0x6b7280;

/** 톤에 맞춰 색을 바꾸는 함수: 보통 = 그대로, 회색 = 밝기만 남겨 회색 쪽으로, 번쩍 = 흰색 */
export type Ink = (c: number) => number;

export function inkFor(tone: Tone): Ink {
  if (tone === 'flash') return () => 0xffffff;
  if (tone === 'gray')
    return (c) => {
      const r = (c >> 16) & 255;
      const g = (c >> 8) & 255;
      const b = c & 255;
      const y = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
      const grey = (y << 16) | (y << 8) | y;
      return c === OUTLINE ? OUTLINE : mix(grey, DEAD_GRAY, 0.55);
    };
  return (c) => c;
}

/** 칠을 톤에 맞춘다 */
export function inked(p: Paint, ink: Ink): Paint {
  if (p.kind === 'solid') return { ...p, color: ink(p.color) };
  return { ...p, stops: p.stops.map(([o, c, a]) => [o, ink(c), a] as const) };
}

/** 피부 · 머리 · 신발 같은 공통 재질 색 */
export const MAT = {
  skin: 0xd9a27e,
  skinShade: 0xa8725a,
  boot: 0x253041,
  bootSole: 0x0f151d,
  glove: 0x2b3646,
  strap: 0x1b2430,
  /** 정면 눈 (어두운 점) */
  eye: 0x101820,
} as const;

/** 위에서 본 몸 배치 (자세에서 계산, 부품이 같이 쓴다) */
export interface TopRig {
  /** 걷기 흔들림 −1~1 (sin(walk) × stride) */
  s: number;
  /** 몸통 비틀림 (라디안) */
  twist: number;
  /** 몸 전체 이동 (피격 젖힘) */
  ox: number;
  /** 두 발 자리 (몸 기준) */
  feet: readonly [[number, number], [number, number]];
  /** 두 손 자리 (위쪽 = 왼손 y < 0, 아래쪽 = 오른손 y > 0) */
  hands: [[number, number], [number, number]];
  /** 어깨 자리 */
  shoulders: readonly [[number, number], [number, number]];
  /** 어깨 반폭 · 몸통 앞뒤 반폭 */
  halfW: number;
  halfD: number;
  /** 머리 중심 · 반지름 */
  head: [number, number];
  headR: number;
}

/**
 * 공통 치수 (몸 반지름 배수). 위에서 본 덩어리(머리 + 어깨 판 + 손)가 판정 원(반지름 1)을 대부분 채우게 잡았다 —
 * 실제 크기(휴대폰 몸 반지름 7~11 기기 px)에서 옛 그림(판정 원을 꽉 채운 몸)보다 작아 보이지 않게, 판정보다 커 보이지도 않게
 */
export const TOP = {
  halfW: 0.95,
  halfD: 0.6,
  headR: 0.62,
  headX: 0.04,
  footX: 0.58,
  footY: 0.34,
  handX: 0.18,
  handY: 0.93,
  handSwing: 0.34,
  handR: 0.19,
  twist: 0.16,
} as const;

/** 자세 → 몸 배치. halfW · halfD를 역할이 조금 바꿀 수 있다(가드는 어깨가 넓다) */
export function topRig(p: SurvivorPose, halfW: number = TOP.halfW, halfD: number = TOP.halfD): TopRig {
  const s = Math.sin(p.walk) * p.stride;
  const ox = -0.12 * p.hit;
  let hands: [[number, number], [number, number]] = [
    [TOP.handX - TOP.handSwing * s, -TOP.handY * (halfW / TOP.halfW)],
    [TOP.handX + TOP.handSwing * s, TOP.handY * (halfW / TOP.halfW)],
  ];
  let headX = TOP.headX;
  let w = halfW;
  if (p.mode === 'captive') {
    hands = [
      [0.36, -0.2],
      [0.36, 0.2],
    ];
    headX += 0.06;
    w *= 0.9;
  } else if (p.mode === 'reach') {
    hands = [
      [0.66, -0.26],
      [0.66, 0.26],
    ];
    headX += 0.08;
  }
  return {
    s,
    twist: -TOP.twist * s,
    ox,
    feet: [
      [TOP.footX * s, -TOP.footY],
      [-TOP.footX * s, TOP.footY],
    ],
    hands,
    shoulders: [
      [-0.02, -w * 0.84],
      [-0.02, w * 0.84],
    ],
    halfW: w,
    halfD,
    head: [headX + ox, 0],
    headR: TOP.headR * (p.mode === 'captive' ? 0.96 : 1),
  };
}

/** 위에서 본 신발 하나 (앞이 둥근 타원). sole = 밑창 색(앞코), upper = 위 */
export function topShoe(
  sk: Sketch,
  x: number,
  y: number,
  upper: number,
  sole: number,
  ink: Ink,
  len = 0.25,
): void {
  const d = path().ellipse(x, y, len, 0.135).d;
  sk.part(d, solid(ink(upper)), ink(OUTLINE));
  // 앞코 (밑창이 보이는 앞쪽 테)
  sk.fill(
    path()
      .arc(x, y, len - 0.03, -1.0, 1.0)
      .Z().d,
    solid(ink(sole)),
    0.9,
  );
}

/** 위에서 본 몸통 (어깨 판): 바라보는 쪽이 조금 볼록한 둥근 판. rig 비틀림 · 젖힘 반영 */
export function topTorsoPath(r: TopRig, bulge = 0.06): string {
  const w = r.halfW;
  const d = r.halfD;
  const pts: [number, number][] = [
    [d + bulge, 0],
    [d * 0.86, -w * 0.62],
    [d * 0.3, -w * 0.98],
    [-d * 0.52, -w * 0.94],
    [-d * 0.95, -w * 0.5],
    [-d, 0],
    [-d * 0.95, w * 0.5],
    [-d * 0.52, w * 0.94],
    [d * 0.3, w * 0.98],
    [d * 0.86, w * 0.62],
  ];
  return path(rotateAbout(r.twist, 0, 0))
    .with(translate(r.ox, 0))
    .smooth(pts, 1).d;
}

/** 위에서 본 돔 음영 (가운데 밝고 가장자리 어둡게, 회전과 무관) */
export function domePaint(base: number, ink: Ink, reach = 1.05, cx = 0, cy = 0): Paint {
  return radial(cx, cy, reach, [
    [0, ink(tint(base, 0.12))],
    [0.45, ink(base)],
    [0.85, ink(shade(base, 0.22))],
    [1, ink(shade(base, 0.4))],
  ]);
}

/** 팔 (어깨 → 손, 캡슐) + 손 (원) */
export function topArm(
  sk: Sketch,
  r: TopRig,
  side: 0 | 1,
  sleeve: number,
  glove: number,
  ink: Ink,
  width = 0.3,
): void {
  const [sx, sy] = r.shoulders[side];
  const [hx, hy] = r.hands[side];
  const m = rotateAbout(r.twist, 0, 0);
  const arm = path(m)
    .with(translate(r.ox, 0))
    .capsule(sx, sy, hx, hy, width, width * 0.86).d;
  sk.part(arm, domePaint(sleeve, ink, 1.05), ink(OUTLINE));
  const hand = path(m).with(translate(r.ox, 0)).circle(hx, hy, TOP.handR).d;
  sk.part(hand, solid(ink(glove)), ink(OUTLINE));
}

/** 정면 몸 치수 (상자 [−1, 1]², 2.6등신) */
export const FRONT = {
  headY: -0.4,
  headR: 0.37,
  neckY: -0.06,
  shoulderY: 0.02,
  shoulderX: 0.3,
  hipY: 0.44,
  hipX: 0.25,
  ankleY: 0.82,
  footY: 0.88,
  legX: 0.13,
  handY: 0.42,
  handX: 0.4,
} as const;

/** 숨쉬기 (정면): 어깨 · 머리가 조금 오르내림 */
export function frontBreath(t: number): number {
  return Math.sin((t / 2.6) * Math.PI * 2) * 0.012;
}

/** 정면 다리 + 신발 */
export function frontLegs(
  sk: Sketch,
  pants: number,
  shoe: number,
  sole: number,
  ink: Ink,
  spread = 0,
  shoeLen = 0.15,
): void {
  for (const s of [-1, 1]) {
    const x = s * (FRONT.legX + spread);
    const leg = path().capsule(s * FRONT.legX * 0.9, FRONT.hipY - 0.04, x, FRONT.ankleY, 0.19, 0.16).d;
    sk.part(
      leg,
      linear(x - 0.1, 0, x + 0.1, 0, [
        [0, ink(tint(pants, 0.1))],
        [1, ink(shade(pants, 0.3))],
      ]),
      ink(OUTLINE),
    );
    const shoeD = path().ellipse(x + s * 0.03, FRONT.footY, shoeLen, 0.085).d;
    sk.part(
      shoeD,
      linear(0, FRONT.footY - 0.08, 0, FRONT.footY + 0.08, [
        [0, ink(tint(shoe, 0.15))],
        [1, ink(shade(shoe, 0.2))],
      ]),
      ink(OUTLINE),
    );
    sk.fill(
      path().roundRect(x + s * 0.03 - shoeLen * 0.95, FRONT.footY + 0.025, shoeLen * 1.9, 0.055, 0.025).d,
      solid(ink(sole)),
    );
  }
}

/** 정면 머리 (얼굴 피부 원). 머리카락 · 모자는 역할이 위에 얹는다 */
export function frontHead(sk: Sketch, ink: Ink, by = 0): void {
  const d = path().circle(0, FRONT.headY + by, FRONT.headR).d;
  sk.part(
    d,
    radial(-0.1, FRONT.headY + by - 0.12, FRONT.headR * 1.25, [
      [0, ink(tint(MAT.skin, 0.12))],
      [0.7, ink(MAT.skin)],
      [1, ink(MAT.skinShade)],
    ]),
    ink(OUTLINE),
  );
}

/** 정면 눈 둘 (작은 세로 타원 + 반짝임). y = 눈 높이 */
export function frontEyes(sk: Sketch, ink: Ink, y: number, gap = 0.13, r = 0.05): void {
  for (const s of [-1, 1]) {
    sk.fill(path().ellipse(s * gap, y, r * 0.8, r * 1.15).d, solid(ink(MAT.eye)));
    sk.fill(path().circle(s * gap - r * 0.25, y - r * 0.45, r * 0.32).d, solid(ink(0xffffff), 0.9));
  }
}

/** 정면 팔 (어깨 → 손) + 손. side −1 = 화면 왼쪽 */
export function frontArm(
  sk: Sketch,
  side: -1 | 1,
  sleeve: number,
  glove: number,
  ink: Ink,
  hand: readonly [number, number] = [side * FRONT.handX, FRONT.handY],
  by = 0,
  width = 0.17,
): void {
  const sx = side * (FRONT.shoulderX - 0.03);
  const sy = FRONT.shoulderY + 0.06 + by;
  const d = path().capsule(sx, sy, hand[0], hand[1], width, width * 0.85).d;
  sk.part(
    d,
    linear(sx - 0.1, 0, sx + 0.1, 0, [
      [0, ink(tint(sleeve, 0.12))],
      [1, ink(shade(sleeve, 0.28))],
    ]),
    ink(OUTLINE),
  );
  sk.part(path().circle(hand[0], hand[1], 0.085).d, solid(ink(glove)), ink(OUTLINE));
}

/** 정면 몸통 (어깨 → 엉덩이, 아래가 조금 좁은 사다리꼴 곡선) */
export function frontTorsoPath(
  by = 0,
  shoulderX: number = FRONT.shoulderX,
  hipX: number = FRONT.hipX,
): string {
  const top = FRONT.shoulderY + by;
  return path().smooth(
    [
      [0, FRONT.neckY + by],
      [shoulderX * 0.7, top - 0.03],
      [shoulderX, top + 0.08],
      [hipX + 0.02, FRONT.hipY - 0.12],
      [hipX, FRONT.hipY],
      [0, FRONT.hipY + 0.03],
      [-hipX, FRONT.hipY],
      [-hipX - 0.02, FRONT.hipY - 0.12],
      [-shoulderX, top + 0.08],
      [-shoulderX * 0.7, top - 0.03],
    ],
    0.9,
  ).d;
}

/** 정면 몸통 칠 (왼쪽 위 빛) */
export function frontClothPaint(base: number, ink: Ink): Paint {
  return linear(-0.35, -0.1, 0.35, 0.5, [
    [0, ink(tint(base, 0.18))],
    [0.55, ink(base)],
    [1, ink(shade(base, 0.32))],
  ]);
}
