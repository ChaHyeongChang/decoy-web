// 괴물 새 캐릭터 (캐릭터 리디자인 2차 시안): 붉은 두건을 깊게 쓴 구부정한 사냥꾼. 옛 그림의 정체성(붉은 두건 · 톱니 자락 망토 ·
// 어둠 속 빛나는 눈 · 앞 발톱)을 잇는다. 위협감은 뿔 · 이빨 대신 눈빛과 그림자로 낸다(사용자 결정 2): 깊은 두건 속 거의 검은
// 얼굴 공간에 가늘게 빛나는 두 눈, 아래로 갈수록 짙어지는 망토, 어깨 · 두건 가장자리의 붉은 림 라이트. 정면 그림의 발톱은
// 작게 줄였다 (위 그림 발톱은 휴대폰 크기에서 바라보는 방향의 단서라 길고 거의 곧게 둔다).
// 위에서 보면 지금 게임 괴물의 원칙(VISUAL_SPEC 4.3)대로 앞은 매끈한 두건 · 어깨가 가장 넓고 뒤 자락은 톱니 5갈래라
// 실루엣만으로 앞뒤가 갈린다. 두건은 위에서 본 물방울(앞이 뭉툭한 머리, 끝은 등 위로 흘러 망토로 이어짐)이고, 머리 앞쪽 폭을
// 덮어 앞 외곽선까지 닿는 짙은 얼굴 그늘 속 가늘게 빛나는 실눈 둘과, 두건 양옆 어깨 앞 짙은 손등에서 앞으로 뻗은 흰 발톱(손마다
// 셋, 가운데가 길다)이 바라보는 방향을 알린다. 휴대폰 크기(괴물 반지름 약 8.5px)에서는 앞 두 모서리의 흰 막대 둘과 그 사이
// 짙은 홈 속 분홍 눈 점 둘이 앞을 알린다 (짙은 얼굴 그늘은 외곽선 · 바닥과 이어져 띠보다 발톱 사이의 파인 홈으로 보인다).
// 공격 준비 · 타격 · 기절에서도 발톱은 몸 앞쪽 반에 둔다. 위 그림에도 뿔 · 이빨 · 어깨 가시 · 등뼈 돌기가 없다.
// 크기: 모든 자세가 판정 반지름 1.12배 안, 돌진만 1.35배 안 (measure.ts SIZE_RULE, 사용자 결정 4 — 발톱 · 팔 · 자락 모두).
// 색: 두건 = 괴물 역할색 원색, 망토 = 정면은 짙은 진홍(두건과 명암 차를 크게) · 위 그림은 가장 높은 어깨 · 굽은 등이 역할색
// (몸 가운데)이고 뒤 자락 끝으로 갈수록 짙어진다, 얼굴 = 아주 어두운 #1A0B0E (두건 속은 더 어둡게), 눈 = 흰 분홍 + 분홍 빛,
// 발톱 = 뼈 색. 네온 포인트는 눈 빛 · 림 라이트 · 망토 틈의 희미한 불씨뿐이다.
// 청록 · 초록 · 파랑은 쓰지 않는다.
//
// 위에서 본 그림: 단위 = 몸 반지름 1(판정 반지름 0.35타일), +x = 바라보는 방향. 빛은 위에서 (돔 음영, 회전과 무관).
// 정면 그림: 상자 [−1, 1]², 빛은 왼쪽 위 (림 라이트는 오른쪽 뒤에서).
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
  translate,
  type Drawing,
  type Mat,
  type Paint,
  type Stop,
} from './kit';
import { frontBreath, inkFor, type Ink } from './survivorBase';
import {
  cleanFrontPose,
  cleanMonsterPose,
  type ArtOptions,
  type FrontPose,
  type MonsterArt,
  type MonsterPose,
} from './types';

type Pt = readonly [number, number];

/** 괴물 색 */
export const MONSTER_COLOR = {
  hood: ROLE.monster,
  cloak: shade(ROLE.monster, 0.34),
  cloakDeep: 0x5a1219,
  /** 위 그림 소매 (역할색 망토와 갈리는 짙은 진홍) */
  sleeve: shade(ROLE.monster, 0.52),
  bone: 0xf1e6e8,
  boneShade: 0xb59ea3,
  hand: 0x2a0e12,
  face: 0x1a0b0e,
  /** 정면 · 위 그림 두건 속 가장 깊은 그늘 (얼굴색보다 어둡게) */
  void: 0x070203,
  eye: 0xfff1f2,
  eyeGlow: 0xfb7185,
  /** 림 라이트 바탕 (흰 분홍을 조금 섞어 쓴다) */
  neon: ROLE_TEXT.monster,
} as const;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const lerpPt = (a: Pt, b: Pt, k: number): Pt => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];

/** 변환의 길이 배율 (그라디언트 반지름 · 선 두께용) */
function lenScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** 변환을 따르는 칠 (kit의 칠은 경로 변환을 따르지 않으므로 좌표를 직접 옮긴다) */
function lin(m: Mat, x0: number, y0: number, x1: number, y1: number, stops: readonly Stop[]): Paint {
  const [a, b] = apply(m, x0, y0);
  const [c, d] = apply(m, x1, y1);
  return linear(a, b, c, d, stops);
}

function rad(m: Mat, cx: number, cy: number, r: number, stops: readonly Stop[]): Paint {
  const [a, b] = apply(m, cx, cy);
  return radial(a, b, r * lenScale(m), stops);
}

/** 위에서 비춘 돔 음영 (가운데 밝고 가장자리 어둡게) */
function dome(m: Mat, base: number, ink: Ink, cx: number, cy: number, reach: number, hi = 0.14): Paint {
  return rad(m, cx, cy, reach, [
    [0, ink(tint(base, hi))],
    [0.5, ink(base)],
    [0.85, ink(shade(base, 0.25))],
    [1, ink(shade(base, 0.45))],
  ]);
}

/** 원형 빛 번짐 (가운데 a0 → 가장자리 0) */
function bloom(sk: Sketch, m: Mat, x: number, y: number, r: number, color: number, a0: number): void {
  sk.fill(
    path(m).circle(x, y, r).d,
    rad(m, x, y, r, [
      [0, color, a0],
      [0.4, color, a0 * 0.45],
      [1, color, 0],
    ]),
  );
}

/**
 * 갈고리 (발톱): 밑동 (bx, by)에서 ang 방향으로 len만큼, bend만큼 옆으로 휘며 끝이 뾰족해진다.
 * bend > 0이면 진행 방향 기준 왼쪽 법선 (−sin, cos) 쪽으로 휜다. taper = 굵기가 끝으로 줄어드는 지수 (작을수록 끝까지 굵다)
 */
function hook(
  m: Mat,
  bx: number,
  by: number,
  ang: number,
  len: number,
  w: number,
  bend: number,
  taper = 0.8,
): string {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const vx = -uy;
  const vy = ux;
  const n = 6;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const px = bx + ux * len * t + vx * bend * len * t * t;
    const py = by + uy * len * t + vy * bend * len * t * t;
    const dx = ux * len + vx * bend * len * 2 * t;
    const dy = uy * len + vy * bend * len * 2 * t;
    const l = Math.hypot(dx, dy) || 1;
    const hw = (w / 2) * (1 - t) ** taper;
    left.push([px - (dy / l) * hw, py + (dx / l) * hw]);
    if (i < n) right.unshift([px + (dy / l) * hw, py - (dx / l) * hw]);
  }
  return path(m).curve(left).curve(right, 1, false).Z().d;
}

/** 뼈 갈고리 칠 (끝으로 갈수록 밝게). shaded = 밑동 그늘 (정면 큰 그림용 — 위 그림은 작은 크기에서 밝은 점으로 읽히게 뺀다) */
function bonePaint(m: Mat, bx: number, by: number, ang: number, len: number, ink: Ink, shaded = true): Paint {
  const stops: Stop[] = shaded
    ? [
        [0, ink(mix(MONSTER_COLOR.boneShade, MONSTER_COLOR.bone, 0.6))],
        [0.4, ink(MONSTER_COLOR.bone)],
        [1, ink(0xffffff)],
      ]
    : [
        [0, ink(MONSTER_COLOR.bone)],
        [1, ink(0xffffff)],
      ];
  return lin(m, bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len, stops);
}

/**
 * 위 그림 발톱 (짙은 손등에서 발톱 셋이 앞으로 뻗는다. 가운데가 길고 양옆은 짧게 조금 벌어진다): 가운데 길이 · 굵기, 양옆
 * 길이 · 굵기, 끝 굽음, 밑동이 손끝에서 나오는 거리, 발톱 사이 옆 간격. 몸 원 1.12배 안 (1차 시안 길이 0.5 · 0.42 · 0.42,
 * 2차 시안 1회차 손가락 부채 0.45 · 0.36 · 굽음 0.2, 2회차 나란히 모은 칼날 0.54 · 0.36 · 굽음 0.1).
 * 휴대폰 크기(괴물 반지름 약 8.5px)에서 셋이 한 덩어리로 붙어 앞 모서리의 흰 막대로 읽히고, 큰 그림에서는 손가락 셋 손으로
 * 읽힌다. 끝은 거의 곧다 (안쪽으로 크게 굽히면 얼굴을 감싼 엄니 · 집게, 길이가 같은 칼날을 나란히 모으면 잇몸에 박힌 이빨처럼
 * 보이고, 넓게 벌린 손가락은 작은 크기에서 흰 점으로 뭉친다)
 */
const CLAW_LEN = 0.54;
const CLAW_SIDE_LEN = 0.3;
const CLAW_W = 0.2;
const CLAW_SIDE_W = 0.17;
const CLAW_BEND = 0.03;
const CLAW_ROOT = 0.05;
const CLAW_GAP = 0.085;
/** 발톱 굵기가 끝으로 줄어드는 지수: 끝 가까이까지 굵게 두어 작은 크기에서 굵은 외곽선에 먹히지 않고 흰 막대로 남는다 */
const CLAW_TAPER = 0.5;
/** 어깨 · 망토 위 발톱 테 두께 (바깥 외곽선 두께 w의 배수) */
const CLAW_RIM = 0.5;
/** 손등 반지름: 소매 끝의 짙은 덩어리. 발톱 밑동이 여기서 나와 큰 그림에서 엄니가 아니라 손으로 읽힌다 */
const HAND_R = 0.12;

/**
 * 위 그림 손 하나: 짙은 손등 + 발톱 셋. (hx, hy) = 손 (소매 끝), ang = 가운데 발톱 방향, spread = 발톱 사이 각(양옆 발톱이
 * 벌어지는 각), k = 발톱 크기 배율 (자세마다 정한다), dim = 발톱을 뼈 그늘 색으로 흐리는 정도 (기절: 힘이 빠짐),
 * alpha = 불투명도 (타격 때 얼굴 위에 겹쳐 그리는 사본). 양옆 발톱 밑동은 가운데에서 옆으로 CLAW_GAP씩 떨어져 손가락처럼
 * 나란히 선다. 끝은 몸 가운데 쪽으로 조금 굽는다
 */
function claws(
  sk: Sketch,
  m: Mat,
  hx: number,
  hy: number,
  ang: number,
  spread: number,
  k: number,
  ink: Ink,
  dim: number,
  alpha: number,
): void {
  const C = MONSTER_COLOR;
  // 각이 커지는 쪽 = 왼쪽 법선 쪽: 양옆 발톱 밑동을 그 발톱이 벌어지는 쪽으로 옮겨 서로 엇갈리지 않게 한다
  const sgn = spread < 0 ? -1 : 1;
  const talons: { d: string; paint: Paint }[] = [];
  // 양옆 손가락을 먼저, 가운데 발톱을 위에 그린다
  for (const i of [-1, 1, 0]) {
    const a = ang + i * spread;
    const len = (i === 0 ? CLAW_LEN : CLAW_SIDE_LEN) * k;
    const w = (i === 0 ? CLAW_W : CLAW_SIDE_W) * k;
    // 밑동: 손끝에서 발톱 방향으로 CLAW_ROOT, 가운데 발톱 방향의 옆(벌어지는 쪽)으로 CLAW_GAP
    const off = i * sgn * CLAW_GAP * k;
    const bx = hx + Math.cos(a) * CLAW_ROOT - Math.sin(ang) * off;
    const by = hy + Math.sin(a) * CLAW_ROOT + Math.cos(ang) * off;
    // 왼쪽 법선이 몸 가운데(원점)를 보면 그쪽으로 굽는다
    const inward = -Math.sin(a) * -bx + Math.cos(a) * -by >= 0 ? 1 : -1;
    talons.push({
      d: hook(m, bx, by, a, len, w, CLAW_BEND * inward, CLAW_TAPER),
      paint: bonePaint(m, bx, by, a, len, ink, false),
    });
  }
  // 손등 (위에서 비춘 짙은 덩어리): 발톱 테와 이어져 '짙은 손 + 흰 발톱'으로 읽힌다
  sk.fill(path(m).circle(hx, hy, HAND_R).d, dome(m, C.hand, ink, hx, hy, HAND_R * 1.4, 0.2), alpha);
  // 테두리: 셋을 한데 두른 손등 색 테를 칠보다 먼저 긋는다. 같은 층의 외곽선 패스는 망토 칠 아래에 깔려 어깨 위에서는 보이지
  // 않으므로, 이 테가 붉은 어깨 위에서 흰 발톱을 갈라 휴대폰 크기에서도 흰 막대로 남게 한다 (발톱끼리는 붙어 보인다).
  // 외곽선 색(거의 검정)으로 두껍게 두르면 셋이 검은 소켓에 박힌 이빨처럼 보여 손등 색으로 얇게 둔다
  for (const t of talons) sk.line(t.d, solid(ink(C.hand)), sk.w * CLAW_RIM * 2, 'round', alpha);
  for (const t of talons) {
    sk.part(t.d, t.paint, ink(OUTLINE), alpha, 0.2);
    if (dim > 0) sk.fill(t.d, solid(ink(C.boneShade)), alpha * dim);
  }
}

/**
 * 위 그림 눈 크기 (두건 좌표): 실눈 반폭 · 반길이, 실눈 둘레 빛 반폭 · 반길이, 번짐 반지름, 눈 사이 (y), 기울기 (긴 축이 y축에서
 * 돈 각, 바깥 끝이 뒤로). 휴대폰 크기(괴물 반지름 약 8.5px)에서 짙은 얼굴 그늘 속 분홍 점 둘로 남고, 그 둘레 · 앞의 그늘은
 * 덮지 않는 크기 (2차 시안 1회차 타원 0.034 · 0.125 · 번짐 0.13, 2회차 렌즈 0.045 · 0.165 · 둘레 빛 두 겹 0.1 · 0.215 · 번짐
 * 0.15 · 기울기 0.75). 실눈은 양 끝이 뾰족한 렌즈 모양이고 둘레 빛은 테두리 없이 번진다: 둥근 타원이나 또렷한 테를 두른 큰
 * 아몬드 눈은 큰 그림에서 만화 눈처럼 귀여워 보인다. 기울기는 작게 둔다: 위 그림은 바라보는 방향대로 돌기 때문에 크게 기울이면
 * 위를 볼 때든 아래를 볼 때든 한쪽에서 안쪽 끝이 올라간 걱정하는 눈이 된다
 */
const EYE_W = 0.04;
const EYE_L = 0.13;
const EYE_HALO_W = 0.065;
const EYE_HALO_L = 0.19;
const EYE_BLOOM = 0.09;
const EYE_Y = 0.19;
const EYE_TILT = 0.18;

/** 양 끝이 뾰족한 렌즈 (가운데 (x, y), 반폭 hw, 반길이 hl, 긴 축 = 기울기 tilt만큼 돌린 y축) */
function lens(m: Mat, x: number, y: number, hw: number, hl: number, tilt: number): string {
  return path(mul(m, mul(translate(x, y), rotate(tilt))))
    .M(0, -hl)
    .Q(2 * hw, 0, 0, hl)
    .Q(-2 * hw, 0, 0, -hl)
    .Z().d;
}

/**
 * 위 그림 빛나는 눈 하나: 짙은 얼굴 그늘 속에 떠 있는 빛 (흰 분홍 실눈 + 실눈을 따라 번지는 분홍 빛 + 분홍 번짐). 실눈을
 * tilt만큼 기울인다. 둘레 빛은 실눈 긴 축을 따라 놓은 작은 번짐 셋이라 테두리 없이 실눈 모양으로 번지고, 작은 크기에서는
 * 짙은 바탕 위 밝은 점 한 쌍으로 읽힌다. 번짐은 눈 둘레에만 두어 그늘이 짙게 남는다.
 * eyes: blink = 가는 선, stun = 빛이 꺼진 흐린 실눈 (눈꼬리가 앞으로 처진다. ×표는 우스꽝스러워 쓰지 않는다)
 */
function topEye(
  sk: Sketch,
  m: Mat,
  x: number,
  y: number,
  tilt: number,
  eyes: MonsterPose['eyes'],
  ink: Ink,
  glow: number,
): void {
  const C = MONSTER_COLOR;
  const ls = lenScale(m);
  if (eyes === 'stun') {
    bloom(sk, m, x, y, EYE_BLOOM * 0.75, ink(C.eyeGlow), Math.min(1, 0.5 * glow));
    sk.fill(
      lens(m, x, y, EYE_W * 0.55, EYE_L * 0.5, -tilt * 1.2),
      solid(ink(mix(C.eyeGlow, C.face, 0.35)), 0.85),
    );
    return;
  }
  bloom(sk, m, x, y, EYE_BLOOM, ink(C.eyeGlow), Math.min(1, 0.6 * glow));
  // 눈 둘레 빛: 실눈 가운데와 긴 축 ±EYE_HALO_L/2 자리에 놓은 작은 번짐 셋 (반지름 = 둘레 빛 반폭의 1.2배). 감은 눈은 가늘게
  const thin = eyes === 'blink' ? 0.5 : 1;
  const ax = -Math.sin(tilt) * EYE_HALO_L * 0.5;
  const ay = Math.cos(tilt) * EYE_HALO_L * 0.5;
  for (const t of [-1, 0, 1])
    bloom(
      sk,
      m,
      x + ax * t,
      y + ay * t,
      EYE_HALO_W * 1.2 * thin,
      ink(tint(C.eyeGlow, 0.15)),
      Math.min(1, 0.75 * glow),
    );
  if (eyes === 'blink') {
    const dx = Math.sin(tilt) * EYE_L * 0.55;
    const dy = Math.cos(tilt) * EYE_L * 0.55;
    sk.line(
      path(m)
        .M(x + dx, y - dy)
        .L(x - dx, y + dy).d,
      solid(ink(C.eye)),
      0.03 * ls,
    );
  } else sk.fill(lens(m, x, y, EYE_W, EYE_L, tilt), solid(ink(C.eye)));
}

// ───────────────────────── 위에서 본 그림 ─────────────────────────

/** 자세 → 몸 배치 */
interface MonsterRig {
  /** 몸 전체 변환 (돌진 늘어남 · 기절 기울어짐) */
  body: Mat;
  /** 윗몸 변환 (팔: 걷기 어깨 흔들림 · 공격 준비 비틀림 · 타격 튕김) */
  upper: Mat;
  /** 목 변환 (두건 · 얼굴: 비틀림을 조금만 따라 눈은 앞을 본다) */
  neck: Mat;
  /** 두건 밑동(목) x · 크기 배율 */
  headX: number;
  headK: number;
  /** 얼굴 그늘 (두건 앞, 두건 좌표): 챙(뒤 끝) 가운데 x · 양 끝이 두건 옆 테두리에 닿는 x */
  brim: number;
  faceSide: number;
  /** 입 벌림 (포효) */
  mouth: number;
  /** 눈빛 세기 (공격 준비 때 타오른다) */
  glow: number;
  /** 팔: 팔꿈치 · 손 · 발톱 방향 (0 = 왼쪽 y < 0, 1 = 오른쪽) */
  elbows: [Pt, Pt];
  hands: [Pt, Pt];
  clawAng: [number, number];
  clawK: number;
  spread: number;
  /** 발톱 흐림 (기절: 뼈 그늘 색으로) */
  clawDim: number;
  /** 휘두르는 손(왼쪽, 0번)을 두건 · 얼굴 위에 겹쳐 그리는 불투명도 (타격: 얼굴 앞을 가로지르는 발톱이 보이게) */
  slash: number;
  /** 자락: 끝 · 골 반지름 (앞뒤 x, 옆 y), 물결 세기, 흔들림 각 */
  tipRx: number;
  tipRy: number;
  valRx: number;
  valRy: number;
  wave: number;
  sway: number;
}

/** 0 → 1 부드러운 계단 (a 이하 0, b 이상 1) */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function monsterRig(p: MonsterPose): MonsterRig {
  const s = Math.sin(p.walk) * p.stride;
  // 기본 (서기 + 걷기): 어깨 위 짙은 소매(팔꿈치 → 손)가 앞으로 뻗고, 두건 양옆 어깨 앞 손(|y| 0.58 — 얼굴과 발톱 사이에
  // 붉은 틈이 남는다)에서 발톱이 앞으로 뻗는다 (가운데 발톱 끝 x 약 0.93 · |y| 약 0.53, 몸 중심에서 1.07 — 두건 앞 끝 0.92와
  // 함께 몸 앞을 평평한 앞면으로 만든다). 걸을 때 팔은 엇갈려 흔들린다
  let el: [Pt, Pt] = [
    [-0.08 + 0.03 * s, -0.78],
    [-0.08 - 0.03 * s, 0.78],
  ];
  let ha: [Pt, Pt] = [
    [0.34 + 0.04 * s, -0.58],
    [0.34 - 0.04 * s, 0.58],
  ];
  let ang: [number, number] = [0.05, -0.05];
  let clawK = 1;
  let spread = 0.16;
  let clawDim = 0;
  let headX = 0.02 * Math.abs(s);
  let headK = 1;
  let brim = 0.33;
  let faceSide = 0.5;
  let glow = 0.9;
  // 비틀림 (윗몸 회전, 라디안): 몸 중심을 도는 회전이라 크기 기준에 영향이 없다
  let twist = 0;
  // 자락: 끝 1.07 + 물결 0.035 ≤ 1.12. 골을 파 뒤 실루엣이 톱니로 갈린다 (앞은 매끈한 두건 · 어깨)
  let tipRx = 1.07;
  let tipRy = 1.05;
  let valRx = 0.84;
  let valRy = 0.84;
  let wave = 0.035;
  let body: Mat = translate(0, 0);

  const toward = (k: number, e: [Pt, Pt], h: [Pt, Pt], a: [number, number]): void => {
    el = [lerpPt(el[0], e[0], k), lerpPt(el[1], e[1], k)];
    ha = [lerpPt(ha[0], h[0], k), lerpPt(ha[1], h[1], k)];
    ang = [lerp(ang[0], a[0], k), lerp(ang[1], a[1], k)];
  };

  // 공격 준비: 두 팔을 앞 · 바깥으로 벌려 발톱을 펼쳐 든다 (위로 든 발톱은 위에서 보면 짧다 — 크기 0.8배). 윗몸을 왼쪽으로
  // 조금 비틀어 휘두를 왼팔을 당기고, 눈빛이 타오르며 자락이 조금 부푼다. 비튼 뒤에도 손은 몸 중심 앞(x ≥ 0)에 두고 발톱은
  // 앞 · 바깥을 향한다 — 휴대폰 크기에서 앞을 가장 많이 알리는 흰 발톱이 어깨 뒤로 가면 바라보는 방향이 거꾸로 읽힌다
  // (공격 방향을 읽어야 하는 바로 그때)
  if (p.windup > 0) {
    const k = p.windup;
    toward(
      k,
      [
        [0.2, -0.82],
        [0.2, 0.82],
      ],
      [
        [0.18, -0.64],
        [0.18, 0.64],
      ],
      [-0.8, 0.8],
    );
    clawK = lerp(clawK, 0.8, k);
    spread = lerp(spread, 0.22, k);
    headX -= 0.06 * k;
    twist -= 0.25 * k;
    glow = lerp(glow, 1.25, k);
    tipRy = lerp(tipRy, 1.06, k);
    valRy = lerp(valRy, 0.88, k);
  }
  // 타격: 당겼던 왼팔 하나로 얼굴 앞을 대각선으로 베어 오른쪽 앞까지 휘두른다 (휘두른 발톱은 얼굴 위에 겹쳐 그린다 — slash).
  // 오른팔은 서기 자리 가까이 남는다. 윗몸은 준비와 반대쪽으로 튕기고 머리는 조금 물린다. 두 팔을 얼굴 앞에서 엇갈리면
  // 큰 그림에서 이빨 가득한 입이 무는 모양으로 읽혀 한 팔로 벤다
  if (p.strike > 0) {
    const k = p.strike;
    toward(
      k,
      [
        [0.3, -0.45],
        [-0.1, 0.8],
      ],
      [
        [0.56, -0.18],
        [0.28, 0.62],
      ],
      [0.5, -0.05],
    );
    clawK = lerp(clawK, 0.95, k);
    spread = lerp(spread, 0.1, k);
    headX -= 0.1 * k;
    twist += 0.25 * k;
  }
  // 돌진: 몸을 낮추고 앞으로 늘어남, 발톱은 두건 양옆에서 앞으로 모으고 자락이 뒤로 길게 흐른다 (1.35 안).
  // 기절은 돌진을 끊는다 (시뮬레이션과 같게: 둘이 겹친 자세 값이 와도 늘어나지 않는다)
  if (p.dash > 0) {
    const k = p.dash * (1 - p.stun);
    toward(
      k,
      [
        [0.24, -0.7],
        [0.24, 0.7],
      ],
      [
        [0.42, -0.56],
        [0.42, 0.56],
      ],
      [0.25, -0.25],
    );
    // 공격 준비 · 타격과 겹쳐도 돌진 자세가 이긴다 (발톱 크기 · 비틀림을 되돌려 늘어난 몸에서 1.35 안)
    clawK = lerp(clawK, 1, k);
    twist *= 1 - k;
    spread = lerp(spread, 0.1, k);
    headX += 0.06 * k;
    tipRx = lerp(tipRx, 1.2, k);
    tipRy = lerp(tipRy, 0.92, k);
    valRx = lerp(valRx, 0.92, k);
    valRy = lerp(valRy, 0.74, k);
    wave *= 1 - 0.5 * k;
    body = mul(translate(0.07 * k, 0), scale(1 + 0.08 * k, 1 - 0.12 * k));
  }
  // 포효: 고개를 젖혀 얼굴이 위를 본다 (챙이 뒤로 물러나 얼굴 그늘 · 빛나는 목구멍이 크게 보임). 팔은 벌리지 않고 머리
  // 양옆으로 들어 올린다 — 위로 세운 발톱은 위에서 보면 짧게 줄어 보인다
  if (p.roar > 0) {
    const k = p.roar;
    toward(
      k,
      [
        [0.0, -0.82],
        [0.0, 0.82],
      ],
      [
        [0.16, -0.64],
        [0.16, 0.64],
      ],
      [-1.2, 1.2],
    );
    clawK = lerp(clawK, 0.66, k);
    spread = lerp(spread, 0.24, k);
    headX -= 0.1 * k;
    headK = lerp(headK, 1.1, k);
    brim = lerp(brim, 0.3, k);
    faceSide = lerp(faceSide, 0.42, k);
    tipRy = lerp(tipRy, 1.06, k);
  }
  // 기절: 축 처짐 — 고개가 앞으로 떨어지고, 팔이 몸 앞에 늘어져 발톱이 안쪽 아래로 처지며(위에서 보면 짧다 — 크기 0.66배)
  // 뼈 그늘 색으로 조금(35%) 흐려지고, 자락이 가라앉는다. 눈빛이 꺼진다. 발톱은 몸 앞쪽 반에 둔다 (뒤로 흐르면 바라보는 방향이
  // 거꾸로 읽힌다. 기절에는 방향을 알려 주는 범위 표시도 없다)
  if (p.stun > 0) {
    const k = p.stun;
    toward(
      k,
      [
        [0.06, -0.82],
        [0.06, 0.82],
      ],
      [
        [0.22, -0.66],
        [0.22, 0.66],
      ],
      [0.35, -0.35],
    );
    clawK = lerp(clawK, 0.66, k);
    clawDim = 0.35 * k;
    spread = lerp(spread, 0.14, k);
    headX += 0.1 * k;
    headK = lerp(headK, 0.9, k);
    glow = lerp(glow, 0.45, k);
    tipRx = lerp(tipRx, 1.0, k);
    tipRy = lerp(tipRy, 1.0, k);
    valRx = lerp(valRx, 0.8, k);
    wave *= 1 - 0.7 * k;
    body = mul(body, rotateAbout(0.12 * k, 0, 0));
  }
  // 걷기 상체 흔들림: 공격 준비 · 포효로 팔을 들었을 때는 줄인다
  const calm = 1 - Math.max(p.windup, p.roar);
  const swing = -0.1 * s * calm;
  return {
    body,
    upper: mul(body, rotateAbout(swing + twist, 0, 0)),
    neck: mul(body, rotateAbout(swing + twist * 0.3, 0, 0)),
    headX,
    headK,
    brim,
    faceSide,
    mouth: p.roar,
    glow,
    elbows: el,
    hands: ha,
    clawAng: ang,
    clawK,
    spread,
    clawDim,
    // 타격 중간(0.35 → 0.65)에 얼굴 위 사본이 서서히 나타난다 (그리는 순서가 한 프레임에 바뀌어 튀지 않게). 돌진이 이긴다
    slash: smoothstep(0.35, 0.65, p.strike) * (1 - p.dash),
    tipRx,
    tipRy,
    valRx,
    valRy,
    wave,
    sway: 0.08 * s,
  };
}

/** 자락이 시작하는 각 (어깨 뒤, 라디안). 끝 5개 · 골 4개가 뒤 ±65° 안에 놓이고 그 앞 어깨 옆은 매끈하다 */
const TAIL_A0 = Math.PI * 0.64;
/** 자락 끝이 뒤 가운데 쪽으로 쏠리는 비율 (0 = 방사): 끝이 뒤로 흘러 펼친 부채 · 꽃잎이 아니라 뒤로 끌리는 천으로 읽힌다 */
const TAIL_SWEEP = 0.16;
/** 자락 양 끝 골 반지름 (어깨 곡선이 첫 끝으로 넘어가는 자리) */
const TAIL_END_R = 0.95;
/**
 * 망토 앞섶 · 어깨 (y < 0 쪽, 앞 가운데 → 어깨). 두건 아래 가슴에서 각진 어깨 앞을 지나 어깨가 가장 넓다(|y| 1.03).
 * 가시 없이 매끈하게 — 앞쪽 반의 실루엣은 두건 앞 테두리, 어깨와 그 앞으로 뻗은 발톱뿐이다. 어깨 앞 모서리를 앞으로 내밀어
 * (x 0.56 · |y| 0.62) 위에서 본 몸이 둥근 공이 아니라 앞이 넓은 둥근 사다리꼴로 읽힌다
 */
const CLOAK_FRONT: readonly Pt[] = [
  [0.62, 0],
  [0.62, -0.34],
  [0.56, -0.62],
  [0.38, -0.86],
  [0.1, -1.01],
  [-0.14, -1.03],
];

/**
 * 뒤 자락 점 (위쪽 어깨 뒤 → 뒤 → 아래쪽 어깨 뒤, 홀수 번째가 끝). 끝은 가운데로 갈수록 조금 길고(바깥 0.95배) 뒤 가운데 쪽으로
 * 쏠린다(TAIL_SWEEP). 물결 위상 cloak
 */
function tailPoints(r: MonsterRig, cloak: number): Pt[] {
  const pts: Pt[] = [];
  const n = 10;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const a0 = -TAIL_A0 - t * (2 * Math.PI - 2 * TAIL_A0);
    if (i === 0 || i === n) {
      const a = a0 + r.sway;
      pts.push([Math.cos(a) * TAIL_END_R, Math.sin(a) * TAIL_END_R]);
      continue;
    }
    const tip = i % 2 === 1;
    const a = (tip ? a0 - TAIL_SWEEP * (a0 + Math.PI) : a0) + r.sway;
    const w = tip ? Math.sin(cloak + i * 0.95) * r.wave : 0;
    const da = tip ? Math.cos(cloak + i * 0.95) * r.wave * 0.8 : 0;
    const len = tip ? 1 - 0.0125 * Math.abs(i - n / 2) : 1;
    const rx = (tip ? r.tipRx * len : r.valRx) + w;
    const ry = (tip ? r.tipRy * len : r.valRy) + w * 0.6;
    pts.push([Math.cos(a + da) * rx, Math.sin(a + da) * ry]);
  }
  return pts;
}

/** 망토: 앞은 매끈한 앞섶 · 둥근 어깨, 뒤 자락은 톱니 (끝 5개) */
function cloakPath(m: Mat, tail: readonly Pt[]): string {
  const first = tail[0] ?? [0, 0];
  const last = tail[tail.length - 1] ?? [0, 0];
  const mirror = CLOAK_FRONT.map(([x, y]): Pt => [x, -y]).reverse();
  return path(m)
    .curve([...CLOAK_FRONT, first])
    .curve(tail, 0.2, false)
    .curve([last, ...mirror.slice(0, -1)], 1, false)
    .Z().d;
}

/**
 * 위 그림 소매 둘 (팔꿈치 → 손), 망토 위 · 두건 아래. 소매는 짙은 진홍이라 역할색 망토와 색으로 갈려 팔로 읽힌다 (안쪽 선 없이,
 * 망토 밖으로 나온 곳에만 바깥 외곽선이 생긴다)
 */
function topSleeves(sk: Sketch, r: MonsterRig, ink: Ink): void {
  const C = MONSTER_COLOR;
  const U = r.upper;
  const paint = dome(U, C.sleeve, ink, 0, 0, 1.6);
  for (const i of [0, 1] as const) {
    const e = r.elbows[i];
    const h = r.hands[i];
    // 팔꿈치 → 손: 손 쪽으로 가늘어지는 소매 하나 (어깨 쪽 윗팔은 망토 속). 끝(손)에 발톱이 붙는다
    sk.part(path(U).capsule(e[0], e[1], h[0], h[1], 0.24, 0.16).d, paint, ink(OUTLINE), undefined, 0);
  }
}

/**
 * 위 그림 손 (소매 끝에서). over = false: 두 손 (두건 아래), over = true: 휘두르는 왼손(0번)만 r.slash 불투명도로 두건 · 얼굴
 * 위에 다시 그린다 (아래 그림과 겹치는 곳은 같은 그림이라 달라지지 않고, 두건에 가려졌던 곳만 서서히 드러난다)
 */
function topClaws(sk: Sketch, r: MonsterRig, ink: Ink, over: boolean): void {
  for (const i of over ? ([0] as const) : ([0, 1] as const)) {
    const side = i === 0 ? -1 : 1;
    const h = r.hands[i];
    const alpha = over ? r.slash : 1;
    claws(sk, r.upper, h[0], h[1], r.clawAng[i], r.spread * side, r.clawK, ink, r.clawDim, alpha);
  }
}

/**
 * 위 그림 두건 (두건 좌표: 원점 = 목, +x 앞, y ≥ 0 반쪽 — 앞 끝 → 뒤 끝). 위에서 본 물방울: 머리가 몸 앞쪽에 있고,
 * 정면 그림의 뾰족한 두건 끝이 등 위로 넘어가 뒤로 가늘게 흐른다 (폭 ±0.44, 앞 끝 0.92, 뒤 끝 −0.1). 앞은 뭉툭하고 평평하게
 * (|y| 0.17까지 x 0.91) 두어 양옆 발톱 끝과 함께 몸 앞면이 평평한 선으로 읽힌다
 */
const HOOD_HALF: readonly Pt[] = [
  [0.92, 0],
  [0.91, 0.17],
  [0.85, 0.3],
  [0.73, 0.39],
  [0.52, 0.44],
  [0.3, 0.41],
  [0.12, 0.3],
  [-0.02, 0.14],
  [-0.1, 0],
];

/**
 * 두건 그늘 원 (두건 좌표 중심 x · 반지름): 둥근 머리 옆 테두리 밖 0.07까지 번지고, 뒤로 흐르는 끝은 덮지 않는다 (뒤에 짙은
 * 호가 생기면 작은 크기에서 몸 가운데 둘째 짙은 무늬가 되어 앞 얼굴 그늘과 다툰다). 앞은 두건 앞 끝 조금 밖까지
 */
const HOOD_AO: Pt = [0.43, 0.51];

/** 두건 외곽 (앞 끝 → y > 0 쪽 → 뒤 끝 → y < 0 쪽, 닫힌 매끈한 곡선). 뒤 끝은 좁고 둥글게 (뾰족하게 꺾으면 둥근 옆과 함께 하트 · 방패로 읽힌다) */
function hoodPath(m: Mat): string {
  const lower = HOOD_HALF.slice(1, -1)
    .map(([x, y]): Pt => [x, -y])
    .reverse();
  return path(m).smooth([...HOOD_HALF, ...lower], 0.8).d;
}

/**
 * 얼굴 그늘 앞 테가 두건 앞 외곽에서 들어온 비율 · 그늘 앞 끝 x. 1 = 그늘이 두건 앞 외곽선까지 닿는다: 앞 가장자리에 붉은
 * 안감 테가 남으면 작은 크기에서 짙은 그늘이 몸 안쪽의 흐린 호로 줄어든다. 닿게 두면 휴대폰 크기에서 그늘(밝기 L 15~30)이
 * 앞 외곽선 · 바닥과 이어져, 양옆 흰 발톱 사이가 짙게 파인 홈으로 보인다
 */
const FACE_INSET = 1;
const FACE_FRONT = 0.45 + ((HOOD_HALF[0]?.[0] ?? 0.9) - 0.45) * FACE_INSET;

/** 두건 앞 외곽 (y ≥ 0 반쪽, 앞 끝 → x = side까지. 끝점은 외곽선 위를 이어 끊김 없이 움직인다) */
function hoodFront(side: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < HOOD_HALF.length; i += 1) {
    const a = HOOD_HALF[i] ?? [0, 0];
    const b = HOOD_HALF[i + 1] ?? a;
    out.push(a);
    if (b[0] < side) {
      out.push(lerpPt(a, b, (a[0] - side) / (a[0] - b[0] || 1)));
      break;
    }
  }
  return out;
}

/**
 * 얼굴 그늘: 두건 앞쪽 머리 폭 전체를 덮는 깊은 그늘 (앞 = 두건 앞 외곽(FACE_INSET), 뒤 = 위 빛을 받는 챙 끝). 머리 폭을 다 덮어
 * 양 끝이 두건 옆 테두리에 닿으므로 두건 속에 떠 있는 눈동자 · 입 모양으로 읽히지 않는다. part: all = 닫힌 그늘, brim = 챙 끝 선만
 */
function faceShape(m: Mat, r: MonsterRig, part: 'all' | 'brim'): string {
  const b = r.brim;
  // 앞 테: 두건 앞 외곽을 점 (0.45, 0) 쪽으로 FACE_INSET배 (1 = 외곽 그대로). 챙이 뒤로 물러나면(포효) 옆 끝도 같이 물러난다
  const rim = hoodFront(r.faceSide).map(([x, y]): Pt => [0.45 + (x - 0.45) * FACE_INSET, y * FACE_INSET]);
  const end = rim[rim.length - 1] ?? [b, 0];
  const brimLine: Pt[] = [
    end,
    [lerp(b, end[0], 0.45), end[1] * 0.62],
    [b, 0],
    [lerp(b, end[0], 0.45), -end[1] * 0.62],
    [end[0], -end[1]],
  ];
  if (part === 'brim') return path(m).curve(brimLine).d;
  const front = rim
    .slice(1, -1)
    .reverse()
    .map(([x, y]): Pt => [x, -y]);
  return path(m)
    .curve([...brimLine, ...front, ...rim.slice(0, -1)], 0.9)
    .Z().d;
}

function top(p: MonsterPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = MONSTER_COLOR;
  const sk = new Sketch(o.w);
  const r = monsterRig(p);
  const B = r.body;
  const N = r.neck;
  const H = mul(N, mul(translate(r.headX, 0), scale(r.headK)));

  // 한 층: 망토 · 팔 · 발톱 · 두건 · 얼굴. 같은 층이라 망토 밖으로 나온 곳에만 굵은 외곽선이 생긴다.
  // 타격의 발톱 자국은 게임의 베기 호 효과가 그리므로 그림에 넣지 않는다
  // 망토: 가장 높은 곳(굽은 등 · 어깨 위)이 역할색으로 밝고, 뒤 자락 끝으로 갈수록 짙어진다 (몸 가운데 = 역할색)
  const tail = tailPoints(r, p.cloak);
  sk.part(
    cloakPath(B, tail),
    rad(B, 0.15, 0, 1.45, [
      [0, ink(tint(C.hood, 0.06))],
      [0.34, ink(C.hood)],
      [0.55, ink(shade(C.hood, 0.3))],
      [0.78, ink(shade(C.hood, 0.56))],
      [1, ink(shade(C.hood, 0.66))],
    ]),
    ink(OUTLINE),
    undefined,
    0.3,
  );
  // 자락 주름: 골마다 자락 끝 쪽에서만 뒤로 흐르는 짙은 주름 (등 가운데까지 이어 모으면 펼친 부채 · 가리비처럼 읽힌다.
  // 둥근 마디 줄은 단추처럼 읽혀 쓰지 않는다)
  for (let i = 2; i < tail.length - 1; i += 2) {
    const [vx, vy] = tail[i] ?? [0, 0];
    const sx = vx * 0.55;
    const sy = vy * 0.62;
    sk.line(
      path(B)
        .M(sx, sy)
        .L(vx * 0.97, vy * 0.97).d,
      lin(B, sx, sy, vx, vy, [
        [0, ink(C.cloakDeep), 0],
        [0.45, ink(C.cloakDeep), 0.65],
        [1, ink(shade(C.cloakDeep, 0.4)), 1],
      ]),
      0.05,
    );
  }
  // 두건: 둘레에 닫힌 짙은 선 대신 둥근 머리 양옆에서 어깨에 드리운 부드러운 원형 그늘로 갈라 망토에서 솟은 머리로 읽히게
  // 하고, 뒤로 흐르는 끝은 그늘 없이 망토로 이어진다 (뒤 끝에 날카로운 그늘 선을 두르면 작은 크기에서 뒤를 가리키는 V로 읽힌다)
  const hood = hoodPath(H);
  sk.fill(
    path(H).circle(HOOD_AO[0], 0, HOOD_AO[1]).d,
    rad(H, HOOD_AO[0], 0, HOOD_AO[1], [
      [0, ink(C.cloakDeep), 0.55],
      [0.76, ink(C.cloakDeep), 0.5],
      [1, ink(C.cloakDeep), 0],
    ]),
  );
  // 소매 · 손은 망토 · 두건 그늘 위, 두건 아래에 그린다 (위에서 보면 앞으로 내민 팔이 어깨 망토보다 카메라 쪽. 망토 아래에
  // 두면 굵은 망토 외곽선에 소매가 묻히고, 그늘 아래에 두면 발톱 끝이 흐려진다. 손은 얼굴에서 떨어뜨려(|y| 0.58) 얼굴과 발톱
  // 사이에 두건 가장자리 · 붉은 틈이 남는다 — 발톱이 짙은 얼굴에 바로 닿으면 입가의 송곳니처럼 보인다)
  topSleeves(sk, r, ink);
  topClaws(sk, r, ink, false);
  // 위 빛을 받는 정수리(앞쪽 둥근 머리)가 가장 밝고 가장자리로 갈수록 조금 짙어진다 (둥근 머리)
  sk.part(
    hood,
    rad(H, 0.42, 0, 0.56, [
      [0, ink(tint(C.hood, 0.16))],
      [0.55, ink(tint(C.hood, 0.04))],
      [1, ink(shade(C.hood, 0.1))],
    ]),
    ink(OUTLINE),
    undefined,
    0,
  );
  // 얼굴 그늘: 두건 앞쪽 머리 폭을 덮는 짙은 그늘 (챙 바로 밑은 더 깊은 그늘, 나머지는 얼굴색 #1A0B0E — VISUAL_SPEC 4.3)
  sk.fill(
    faceShape(H, r, 'all'),
    lin(H, r.brim, 0, FACE_FRONT, 0, [
      [0, ink(C.void)],
      [0.35, ink(C.face)],
      [1, ink(C.face)],
    ]),
  );
  // 챙 끝 (위 빛을 받는 천의 두께)
  sk.line(faceShape(H, r, 'brim'), solid(ink(tint(C.hood, 0.2))), 0.03, 'round', 0.45);
  // 입 (포효: 이빨 없이 옆으로 길게 벌린 빛나는 목구멍 — 둥근 O는 놀란 얼굴로 읽혀 쓰지 않는다). 눈보다 앞(턱 쪽)
  if (r.mouth > 0.05) {
    const mx = FACE_FRONT - 0.13;
    const mw = 0.04 * r.mouth + 0.01;
    const mh = 0.16 * r.mouth + 0.03;
    bloom(sk, H, mx, 0, mh * 1.15, ink(C.eyeGlow), 0.55 * r.mouth);
    const maw = path(H).ellipse(mx, 0, mw, mh).d;
    sk.fill(maw, solid(ink(C.void)));
    sk.fill(
      maw,
      rad(H, mx, 0, mh, [
        [0, ink(tint(C.eyeGlow, 0.6)), 0.95],
        [0.45, ink(C.eyeGlow), 0.7],
        [1, ink(C.eyeGlow), 0],
      ]),
    );
  }
  // 눈: 그늘 가운데의 가늘게 노려보는 실눈 둘. 챙 가까이(챙 + 0.19) 두어 그 앞 그늘이 짙게 남는다 (그늘 양 끝에서 떨어뜨린다.
  // 얼굴이 위를 볼수록 챙 쪽으로 물러난다)
  const eyeX = r.brim + lerp(0.19, 0.15, r.mouth);
  for (const side of [-1, 1]) topEye(sk, H, eyeX, side * EYE_Y, side * EYE_TILT, p.eyes, ink, r.glow);
  // 타격: 휘두른 발톱이 얼굴 앞을 가로지른다 (두건 아래에만 두면 얼굴 밑에서 삐져나온 집게처럼 보인다)
  if (r.slash > 0.01) topClaws(sk, r, ink, true);
  return sk.drawing();
}

// ───────────────────────── 정면 그림 ─────────────────────────

/** 정면 팔 하나: 어깨(망토 아래) → 팔꿈치 → 해진 소맷부리 → 뼈 손 + 작은 갈고리 발톱 셋 */
function frontArm(sk: Sketch, M: Mat, side: number, sh: Pt, el: Pt, wr: Pt, clawDir: number, ink: Ink): void {
  const C = MONSTER_COLOR;
  const sleeve = shade(C.hood, 0.55);
  const sleevePaint = lin(M, el[0] - side * 0.12, el[1] - 0.1, el[0] + side * 0.12, el[1] + 0.3, [
    [0, ink(tint(sleeve, 0.1))],
    [0.6, ink(sleeve)],
    [1, ink(shade(sleeve, 0.35))],
  ]);
  // 윗팔 (가는 캡슐)
  sk.part(path(M).capsule(sh[0], sh[1], el[0], el[1], 0.16, 0.14).d, sleevePaint, ink(OUTLINE));
  // 아래팔 소매: 팔꿈치에서 손목으로 넓어지고 끝이 톱니로 해졌다
  const dx = wr[0] - el[0];
  const dy = wr[1] - el[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const ux = dx / l;
  const uy = dy / l;
  const w0 = 0.05;
  const w1 = 0.08;
  const cuff: Pt[] = [];
  for (let i = 0; i <= 4; i += 1) {
    const k = i / 4;
    const off = lerp(w1, -w1, k);
    const len = i % 2 === 0 ? 0.05 : -0.01;
    cuff.push([wr[0] + nx * off + ux * len, wr[1] + ny * off + uy * len]);
  }
  sk.part(
    path(M).poly([[el[0] + nx * w0, el[1] + ny * w0], ...cuff, [el[0] - nx * w0, el[1] - ny * w0]]).d,
    sleevePaint,
    ink(OUTLINE),
  );
  // 작은 갈고리 발톱 셋 (1차 시안보다 짧고 가늘게: 과장하지 않는다)
  for (const i of [-1, 0, 1]) {
    const a = clawDir + i * 0.36;
    const len = i === 0 ? 0.24 : 0.19;
    const bx = wr[0] + Math.cos(a) * 0.05;
    const by = wr[1] + Math.sin(a) * 0.05;
    // 갈고리는 몸 안쪽으로 휜다 (좌우 거울 대칭 — 아래로 늘어뜨리든 위로 들든)
    sk.part(
      hook(M, bx, by, a, len, 0.075, 0.34 * side * Math.sign(Math.sin(clawDir) || 1)),
      bonePaint(M, bx, by, a, len, ink),
      ink(OUTLINE),
      undefined,
      0.3,
    );
  }
  // 뼈 손 (어두운 손등)
  sk.part(
    path(M).ellipse(wr[0] + ux * 0.03, wr[1] + uy * 0.03, 0.06, 0.05, Math.atan2(uy, ux)).d,
    solid(ink(C.hand)),
    ink(OUTLINE),
  );
}

/** 전신 배치: 뿔이 빠져 위가 비므로 조금 키우고 내린다 (두건 끝 · 자락 · 발톱이 외곽선까지 ±1 상자 안) */
const FULL_K = 1.04;
const FULL_DY = 0.05;
/**
 * 상반신 배치 (로비 역할 카드 · 결과 화면, 64~160px): 배율 · 아래로 내림. 두건 속 눈빛이 상자 가운데 조금 위에 오게 키운다.
 * 두 손은 가슴 앞 어깨 망토 아랫단을 움켜쥐고 발톱을 아래 안쪽으로 굽힌다 — 두건 옆에 뿔처럼 솟는 돌기가 없게
 * (소매 · 자락이 |x| ≤ 0.98 안, 선 두께 제외)
 */
const BUST_K = 1.42;
const BUST_DY = 0.36;
const BUST_EL: Pt = [0.6, 0.45];
const BUST_WR: Pt = [0.4, 0.3];
const BUST_CLAW = 0.9;

function front(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = MONSTER_COLOR;
  const sk = new Sketch(o.w);
  const M: Mat = p.bust
    ? mul(translate(0, BUST_DY), scale(BUST_K))
    : mul(translate(0, FULL_DY), scale(FULL_K));
  const by = frontBreath(p.t) * 1.6;
  const t = p.t;
  const ls = lenScale(M);
  // 수그린 자세: 머리를 어깨 사이로 낮춘다
  const hy = -0.3 + by;
  // 림 라이트 (오른쪽 뒤에서 오는 붉은 빛) · 숨쉬기에 맞춘 눈빛 세기
  const rim = ink(mix(C.neon, C.eye, 0.3));
  const glowA = 0.85 + 0.1 * Math.sin(t * 3.1);

  // ── 층 1: 망토 (뒤, 땅까지 늘어진 톱니 자락. 아래로 갈수록 짙은 그림자).
  // 상반신은 크게 키우므로 자락을 좁혀 좌우 상자 안에 둔다 (아래는 로비 역할 카드 · 결과 화면 상자가 자른다) ──
  const hemW = p.bust ? 0.62 : 0.72;
  const hem: Pt[] = [];
  const n = 9;
  for (let i = 0; i <= n; i += 1) {
    const x = lerp(-hemW, hemW, i / n);
    const tip = i % 2 === 0;
    const wv = Math.sin(t * 1.7 + i * 1.1) * 0.018;
    hem.push([x + wv, (tip ? 0.86 : 0.7) - Math.abs(x) * 0.05 + wv]);
  }
  const cloak = path(M)
    .curve([
      [0, -0.14 + by],
      [0.44, -0.08 + by],
      [0.64, 0.2],
      [hemW, 0.84],
    ])
    .curve([...hem].reverse(), 0.15, false)
    .curve(
      [
        [-0.64, 0.2],
        [-0.44, -0.08 + by],
      ],
      1,
      false,
    )
    .Z().d;
  sk.part(
    cloak,
    lin(M, -0.2, -0.1, 0.1, 0.9, [
      [0, ink(tint(C.cloak, 0.08))],
      [0.35, ink(C.cloak)],
      [0.72, ink(shade(C.cloak, 0.5))],
      [1, ink(shade(C.cloak, 0.74))],
    ]),
    ink(OUTLINE),
  );
  // 망토 오른쪽 가장자리 림 라이트 (아래로 갈수록 그림자에 묻힌다)
  sk.line(
    path(M).curve([
      [0.46, -0.05 + by],
      [0.6, 0.18],
      [0.67, 0.56],
    ]).d,
    lin(M, 0, -0.05, 0, 0.6, [
      [0, rim, 0.85],
      [1, rim, 0],
    ]),
    0.028 * ls,
  );
  // 망토 앞 틈 (깊은 어둠)
  const gap = path(M).smooth(
    [
      [0, 0.02 + by],
      [0.18, 0.2],
      [0.28, 0.84],
      [0, 0.76],
      [-0.28, 0.84],
      [-0.18, 0.2],
    ],
    0.8,
  ).d;
  sk.fill(
    gap,
    lin(M, 0, 0, 0, 0.9, [
      [0, ink(C.void)],
      [1, ink(shade(C.cloakDeep, 0.45))],
    ]),
  );
  // 틈 안쪽의 희미한 붉은 불씨 (어둠 속에 무언가 있다는 느낌만)
  sk.fill(
    gap,
    rad(M, 0, 0.44, 0.32, [
      [0, ink(C.eyeGlow), 0.16],
      [1, ink(C.eyeGlow), 0],
    ]),
  );

  // ── 층 2 (전신): 길게 늘어뜨린 팔 · 자락 쪽으로 처진 작은 발톱 (어깨 망토 아래에서 나온다. 구부정한 사냥꾼) ──
  const arms = (): void => {
    for (const side of [-1, 1]) {
      const sway = Math.sin(t * 1.3 + side) * 0.012;
      if (p.bust)
        // 두 손이 어깨 망토 아랫단을 움켜쥔다 (발톱은 아래 안쪽으로)
        frontArm(
          sk,
          M,
          side,
          [side * 0.46, 0.2 + by],
          [side * BUST_EL[0], BUST_EL[1] + by],
          [side * BUST_WR[0], BUST_WR[1] + by],
          Math.PI / 2 + side * BUST_CLAW,
          ink,
        );
      else
        frontArm(
          sk,
          M,
          side,
          [side * 0.42, 0.04 + by],
          [side * 0.7, 0.33 + sway],
          [side * 0.6, 0.58 + sway],
          Math.PI / 2 - side * 0.08,
          ink,
        );
    }
  };
  if (!p.bust) {
    sk.layer();
    arms();
  }

  // ── 층 3: 어깨 망토 (구부정하게 솟은 어깨 + 톱니 아래 가장자리) + 두건이 드리운 그림자 ──
  sk.layer();
  const mantle: Pt[] = [
    [0, -0.2 + by],
    [0.36, -0.16 + by],
    [0.6, -0.12 + by],
    [0.66, 0.06 + by],
    [0.48, 0.12 + by],
    [0.42, 0.27 + by],
    [0.28, 0.17 + by],
    [0.15, 0.32 + by],
    [0.0, 0.2 + by],
  ];
  const mantleAll: Pt[] = [
    ...mantle,
    ...mantle
      .slice(1, -1)
      .reverse()
      .map(([x, y]): Pt => [-x, y]),
  ];
  const mantleD = path(M).poly(mantleAll).d;
  sk.part(
    mantleD,
    lin(M, -0.4, -0.15, 0.4, 0.3, [
      [0, ink(tint(C.hood, 0.06))],
      [0.6, ink(shade(C.hood, 0.18))],
      [1, ink(shade(C.hood, 0.45))],
    ]),
    ink(OUTLINE),
  );
  sk.fill(
    mantleD,
    rad(M, 0, hy + 0.36, 0.42, [
      [0, ink(C.void), 0.6],
      [1, ink(C.void), 0],
    ]),
  );
  // 어깨 림 라이트 (오른쪽 강하게, 왼쪽 약하게)
  for (const side of [-1, 1])
    sk.line(
      path(M).curve([
        [side * 0.4, -0.145 + by],
        [side * 0.58, -0.105 + by],
        [side * 0.635, 0.04 + by],
      ]).d,
      solid(rim, side > 0 ? 0.95 : 0.35),
      0.03 * ls,
    );

  // ── 층 4 (상반신): 망토 아랫단을 움켜쥔 손 · 작은 발톱 (어깨 망토 위) ──
  if (p.bust) {
    sk.layer();
    arms();
  }

  // ── 층 5: 두건 · 얼굴 ──
  sk.layer();
  // 두건 (뾰족한 꼭대기 하나 — 뿔 대신 두건 끝만 작게 솟는다)
  const hood = path(M).smooth(
    [
      [0, hy - 0.5],
      [0.26, hy - 0.31],
      [0.45, hy - 0.03],
      [0.47, hy + 0.2],
      [0.32, hy + 0.37],
      [0, hy + 0.39],
      [-0.32, hy + 0.37],
      [-0.47, hy + 0.2],
      [-0.45, hy - 0.03],
      [-0.26, hy - 0.31],
    ],
    0.7,
  ).d;
  sk.part(
    hood,
    rad(M, -0.16, hy - 0.24, 0.72, [
      [0, ink(tint(C.hood, 0.16))],
      [0.45, ink(C.hood)],
      [1, ink(shade(C.hood, 0.5))],
    ]),
    ink(OUTLINE),
  );
  // 두건 접힘 (왼쪽 위 빛을 받는 밝은 주름)
  sk.line(
    path(M).curve([
      [-0.3, hy - 0.2],
      [-0.38, hy + 0.02],
      [-0.37, hy + 0.2],
    ]).d,
    solid(ink(tint(C.hood, 0.3))),
    0.03 * ls,
    'round',
    0.6,
  );
  // 두건 오른쪽 가장자리 림 라이트 (외곽선 안쪽으로 조금 들여)
  sk.line(
    path(M).curve([
      [0.05, hy - 0.45],
      [0.24, hy - 0.3],
      [0.42, hy - 0.03],
      [0.44, hy + 0.19],
      [0.32, hy + 0.33],
    ]).d,
    lin(M, 0, hy - 0.45, 0, hy + 0.33, [
      [0, rim, 1],
      [0.7, rim, 0.75],
      [1, rim, 0],
    ]),
    0.032 * ls,
  );
  // 얼굴 구멍: 위가 뾰족한 아치. 두건 안감(짙은 진홍) → 안쪽은 거의 검은 깊은 그늘 (위는 챙 그늘로 가장 어둡다)
  const arch = (top: number, w: number, mid: number, bot: number): string =>
    path(M)
      .curve(
        [
          [0, hy + top],
          [w * 0.62, hy + top + 0.09],
          [w, hy + mid],
          [w * 0.7, hy + bot - 0.05],
          [0, hy + bot],
          [-w * 0.7, hy + bot - 0.05],
          [-w, hy + mid],
          [-w * 0.62, hy + top + 0.09],
          [0, hy + top],
        ],
        0.9,
      )
      .Z().d;
  const opening = arch(-0.24, 0.32, 0.1, 0.33);
  sk.fill(
    opening,
    lin(M, 0, hy - 0.24, 0, hy + 0.33, [
      [0, ink(shade(C.hood, 0.66))],
      [1, ink(shade(C.hood, 0.8))],
    ]),
  );
  const faceD = arch(-0.16, 0.27, 0.11, 0.3);
  sk.fill(
    faceD,
    lin(M, 0, hy - 0.16, 0, hy + 0.3, [
      [0, ink(C.void)],
      [0.55, ink(C.void)],
      [1, ink(C.face)],
    ]),
  );
  sk.line(opening, solid(ink(shade(C.hood, 0.3))), 0.03 * ls, 'round', 0.9);
  // 눈: 깊은 그늘 속 가늘게 치켜 올라간 칼날 같은 두 눈. 분홍 번짐 → 밝은 심 → 흰 분홍 눈 (번짐은 눈 둘레에만 — 그늘을 덮지 않게)
  for (const side of [-1, 1]) {
    const ex = side * 0.125;
    const ey = hy + 0.05;
    bloom(sk, M, ex + side * 0.01, ey - 0.025, 0.13, ink(C.eyeGlow), 0.62 * glowA);
    bloom(sk, M, ex + side * 0.01, ey - 0.028, 0.06, ink(tint(C.eyeGlow, 0.5)), 0.95 * glowA);
    // 눈 (안쪽 끝 → 위 가장자리 → 바깥 끝 → 아래 가장자리)
    sk.fill(
      path(M)
        .M(side * 0.04, ey + 0.014)
        .Q(side * 0.11, ey - 0.022, side * 0.215, ey - 0.072)
        .Q(side * 0.16, ey + 0.018, side * 0.04, ey + 0.014)
        .Z().d,
      solid(ink(C.eye)),
    );
  }
  // 눈빛이 비친 얼굴 아래 (턱 그늘에 희미한 붉은 반사)
  sk.fill(
    faceD,
    rad(M, 0, hy + 0.24, 0.18, [
      [0, ink(C.eyeGlow), 0.1],
      [1, ink(C.eyeGlow), 0],
    ]),
  );
  return sk.drawing();
}

export const MONSTER_ART: MonsterArt = {
  id: 'monster',
  top: (p, o) => top(cleanMonsterPose(p), o),
  front: (p, o) => front(cleanFrontPose(p), o),
  // 가장 먼 반쪽 크기: 돌진 자락 1.245 (발톱도 그 안. 다른 동작과 겹쳐도 그 안 — 기절은 돌진을 끊는다) + 여유 (1차 시안 1.5)
  topExtent: 1.28,
};
