// 괴물 새 캐릭터 (캐릭터 리디자인 2차 시안): 붉은 두건을 깊게 쓴 구부정한 사냥꾼. 옛 그림의 정체성(붉은 두건 · 톱니 자락 망토 ·
// 어둠 속 빛나는 눈 · 앞 발톱)을 잇는다. 위협감은 뿔 · 이빨 대신 눈빛과 그림자로 낸다(사용자 결정 2): 깊은 두건 속 거의 검은
// 얼굴 공간에 가늘게 빛나는 두 눈, 아래로 갈수록 짙어지는 망토, 어깨 · 두건 가장자리의 붉은 림 라이트. 발톱은 작게 줄였다.
// 위에서 보면 둥근 생존자와 달리 옆(어깨 가시) · 뒤(톱니 자락)가 뾰족하고, 앞은 두건 챙 아래 그늘진 얼굴 속 빛나는 두 눈과
// 양옆 앞으로 내민 흰 발톱 손 둘이 바라보는 방향을 알린다 (위 그림에도 뿔이 없다).
// 크기: 모든 자세가 판정 반지름 1.12배 안, 돌진만 1.35배 안 (measure.ts SIZE_RULE, 사용자 결정 4 — 발톱 · 팔 · 자락 모두).
// 색: 두건 = 괴물 역할색 원색(몸 가운데), 망토 = 짙은 진홍(두건과 명암 차를 크게), 얼굴 = 아주 어두운 #1A0B0E (두건 속은 더 어둡게),
// 눈 = 흰 분홍 + 분홍 빛, 발톱 = 뼈 색. 네온 포인트는 눈 빛 · 림 라이트 · 등뼈 마디 사이와 망토 틈의 희미한 불씨뿐이다.
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
  sleeve: shade(ROLE.monster, 0.2),
  /** 등뼈 돌기 밑동 (어두운 뼈) */
  spine: 0x4a141a,
  bone: 0xf1e6e8,
  boneShade: 0xb59ea3,
  hand: 0x2a0e12,
  face: 0x1a0b0e,
  /** 정면 두건 속 가장 깊은 그늘 (얼굴색보다 어둡게) */
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
 * bend > 0이면 진행 방향 기준 왼쪽 법선 (−sin, cos) 쪽으로 휜다
 */
function hook(m: Mat, bx: number, by: number, ang: number, len: number, w: number, bend: number): string {
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
    const hw = (w / 2) * (1 - t) ** 0.8;
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
 * 위 그림 발톱 길이 (가운데 · 양옆) · 굵기 · 끝 굽음 · 손 반지름 — 몸 원 1.12배 안 (1차 시안 0.5 · 0.42 · 0.42).
 * 곧고 짧은 손가락 셋을 벌려 '앞으로 할퀴는 손'으로 읽히게 한다 (굵게 모은 초승달 쐐기는 머리 옆 뿔 · 귀처럼 읽혀 뺐다)
 */
const CLAW_LEN = 0.28;
const CLAW_SIDE_LEN = 0.24;
const CLAW_W = 0.2;
const CLAW_BEND = 0.08;
const PALM_R = 0.12;

/**
 * 위 그림 발톱 셋 + 손. ang = 가운데 발톱 방향, spread = 발톱 사이 각, k = 크기(들어 올리면 카메라에 가까워 커짐).
 * 갈고리는 끝만 몸 가운데 쪽으로 살짝 굽는다 (휜 초승달이 아니라 곧은 손가락). 손 = 발톱 밑동을 덮는 소매 색 주먹
 */
function clawHand(
  sk: Sketch,
  m: Mat,
  hx: number,
  hy: number,
  ang: number,
  spread: number,
  k: number,
  ink: Ink,
  palm: number,
  alpha?: number,
): void {
  for (const i of [-1, 0, 1]) {
    const a = ang + i * spread;
    const len = (i === 0 ? CLAW_LEN : CLAW_SIDE_LEN) * k;
    const bx = hx + Math.cos(a) * PALM_R * 0.6;
    const by = hy + Math.sin(a) * PALM_R * 0.6;
    // 왼쪽 법선이 몸 가운데(원점)를 보면 그쪽으로 굽는다
    const inward = -Math.sin(a) * -bx + Math.cos(a) * -by >= 0 ? 1 : -1;
    sk.part(
      hook(m, bx, by, a, len, CLAW_W * k, CLAW_BEND * inward),
      bonePaint(m, bx, by, a, len, ink, false),
      ink(OUTLINE),
      alpha,
      0.2,
    );
  }
  sk.part(
    path(m).circle(hx, hy, PALM_R * k).d,
    rad(m, hx - 0.04, hy - 0.04, PALM_R * k * 1.3, [
      [0, ink(tint(palm, 0.15))],
      [1, ink(shade(palm, 0.3))],
    ]),
    ink(OUTLINE),
    alpha,
  );
}

/**
 * 위 그림 빛나는 눈 하나: 가늘게 치켜 올라간 칼날 눈 (정면 눈과 같은 말투). tilt만큼 기울여 바깥 끝이 뒤(두건 쪽)로 간다 —
 * 두 눈이 앞을 향한 V. 빛 번짐은 눈 둘레에만 작게 (얼굴 그늘이 분홍으로 뜨지 않게). eyes: blink = 가는 선, stun = ×
 */
function glowEye(
  sk: Sketch,
  m: Mat,
  x: number,
  y: number,
  len: number,
  eyes: MonsterPose['eyes'],
  ink: Ink,
  glow: number,
  tilt: number,
): void {
  const C = MONSTER_COLOR;
  const ls = lenScale(m);
  // 긴 축 방향 (y축을 tilt만큼 돌림) · 짧은 축 방향
  const ax = -Math.sin(tilt);
  const ay = Math.cos(tilt);
  const bx = ay;
  const by = -ax;
  // 빛: 넓고 옅은 번짐 + 좁고 밝은 심 (작은 크기에서 밝은 점으로 남는다)
  bloom(sk, m, x, y, len * 1.6, ink(C.eyeGlow), 0.5 * glow);
  bloom(sk, m, x, y, len * 0.9, ink(tint(C.eyeGlow, 0.6)), Math.min(1, 0.95 * glow));
  if (eyes === 'stun') {
    const d = len * 0.6;
    sk.line(
      path(m)
        .M(x - d, y - d)
        .L(x + d, y + d)
        .M(x - d, y + d)
        .L(x + d, y - d).d,
      solid(ink(C.eye)),
      len * 0.32 * ls,
    );
  } else if (eyes === 'blink') {
    sk.line(
      path(m)
        .M(x - ax * len * 0.8, y - ay * len * 0.8)
        .L(x + ax * len * 0.8, y + ay * len * 0.8).d,
      solid(ink(C.eye)),
      len * 0.18 * ls,
    );
  } else {
    // 가는 칼날 (양 끝 뾰족한 아몬드) + 그 둘레로 번지는 분홍 빛 (작은 크기에서 밝은 점으로 남는 몫)
    const almond = (l: number, w: number): string =>
      path(m)
        .M(x - ax * l, y - ay * l)
        .Q(x + bx * w, y + by * w, x + ax * l, y + ay * l)
        .Q(x - bx * w, y - by * w, x - ax * l, y - ay * l)
        .Z().d;
    sk.fill(almond(len * 1.25, len * 1.1), solid(ink(tint(C.eyeGlow, 0.45))), 0.7 * Math.min(1, glow));
    sk.fill(almond(len, len * 0.62), solid(ink(C.eye)));
  }
}

// ───────────────────────── 위에서 본 그림 ─────────────────────────

/** 자세 → 몸 배치 */
interface MonsterRig {
  /** 몸 전체 변환 (돌진 늘어남 · 기절 기울어짐) */
  body: Mat;
  /** 윗몸 변환 (팔: 걷기 어깨 흔들림 · 공격 준비 비틀림 · 타격 튕김) */
  upper: Mat;
  /** 목 변환 (두건 · 얼굴 · 등뼈: 비틀림을 조금만 따라 눈은 앞을 본다) */
  neck: Mat;
  /** 두건 중심 · 크기 배율 */
  head: Pt;
  headK: number;
  /** 얼굴 (두건 앞 어두운 구멍) 중심 x · 반지름 (두건 좌표) */
  faceX: number;
  faceRx: number;
  faceRy: number;
  /** 입 벌림 (포효) */
  mouth: number;
  /** 눈빛 세기 (공격 준비 때 타오른다) */
  glow: number;
  /** 팔: 어깨 · 팔꿈치 · 손 · 발톱 방향 (0 = 왼쪽 y < 0, 1 = 오른쪽) */
  elbows: [Pt, Pt];
  hands: [Pt, Pt];
  clawAng: [number, number];
  clawK: number;
  spread: number;
  /**
   * 팔 층 (0 = 망토 아래, 1 = 망토 위 · 두건 아래: 든 팔 · 처진 팔은 위에서 보면 망토보다 카메라 쪽).
   * 사이 값은 망토 위 팔을 그만큼 비치게 겹쳐 굽기 프레임 사이에서 팔이 갑자기 생기지 않게 한다
   */
  armsOver: number;
  /** 자락: 끝 · 골 반지름 (앞뒤 x, 옆 y), 물결 세기, 흔들림 각 */
  tipRx: number;
  tipRy: number;
  valRx: number;
  valRy: number;
  wave: number;
  sway: number;
}

const SHOULDER: Pt = [0.0, 0.62];

function monsterRig(p: MonsterPose): MonsterRig {
  const s = Math.sin(p.walk) * p.stride;
  // 기본 (서기 + 걷기): 어깨 앞, 머리에서 떨어진 양옆으로 내민 손이 발톱을 앞으로 편다 (머리 옆에 붙으면 뿔 · 귀처럼
  // 읽힌다). 걸을 때 팔은 엇갈려 흔들린다
  let el: [Pt, Pt] = [
    [0.14 + 0.04 * s, -0.78],
    [0.14 - 0.04 * s, 0.78],
  ];
  let ha: [Pt, Pt] = [
    [0.46 + 0.04 * s, -0.57],
    [0.46 - 0.04 * s, 0.57],
  ];
  let ang: [number, number] = [-0.04, 0.04];
  let clawK = 1;
  let spread = 0.32;
  let headX = 0.04 + 0.03 * Math.abs(s);
  let headK = 1;
  let faceX = 0.55;
  let faceRx = 0.2;
  let faceRy = 0.33;
  let glow = 0.85;
  // 비틀림 (윗몸 회전, 라디안): 몸 중심을 도는 회전이라 크기 기준에 영향이 없다
  let twist = 0;
  // 자락: 끝 1.07 + 물결 0.035 ≤ 1.12. 골은 얕게(0.92) 해 판정 원 가장자리까지 밝은 망토가 채운다 (작은 화면 덩어리)
  let tipRx = 1.07;
  let tipRy = 1.05;
  let valRx = 0.92;
  let valRy = 0.94;
  let wave = 0.035;
  let body: Mat = translate(0, 0);

  const toward = (k: number, e: [Pt, Pt], h: [Pt, Pt], a: [number, number]): void => {
    el = [lerpPt(el[0], e[0], k), lerpPt(el[1], e[1], k)];
    ha = [lerpPt(ha[0], h[0], k), lerpPt(ha[1], h[1], k)];
    ang = [lerp(ang[0], a[0], k), lerp(ang[1], a[1], k)];
  };

  // 공격 준비: 팔꿈치를 옆으로 들고 발톱을 어깨 뒤로 당긴다 (몸 가까이, 망토 위). 윗몸을 한쪽으로 비틀어 힘을 모으고
  // 눈빛이 타오른다 (발톱이 뒤로 가도 앞 단서는 눈이 맡는다), 자락이 조금 부푼다
  if (p.windup > 0) {
    const k = p.windup;
    toward(
      k,
      [
        [0.2, -0.84],
        [0.2, 0.84],
      ],
      [
        [-0.12, -0.76],
        [-0.12, 0.76],
      ],
      [-2.55, 2.55],
    );
    clawK = lerp(clawK, 1.05, k);
    spread = lerp(spread, 0.34, k);
    headX -= 0.06 * k;
    twist -= 0.35 * k;
    glow = lerp(glow, 1.25, k);
    tipRx = lerp(tipRx, 1.07, k);
    tipRy = lerp(tipRy, 1.06, k);
    valRy = lerp(valRy, 0.9, k);
  }
  // 타격: 두 발톱을 앞으로 휘둘러 얼굴 앞에서 엇갈린다 (X자, 앞 1.12 안). 윗몸은 준비와 반대쪽으로 튕기고,
  // 머리는 물려 X가 얼굴과 떨어져 보이게
  if (p.strike > 0) {
    const k = p.strike;
    toward(
      k,
      [
        [0.42, -0.58],
        [0.42, 0.58],
      ],
      [
        [0.66, -0.24],
        [0.66, 0.24],
      ],
      [0.78, -0.78],
    );
    clawK = lerp(clawK, 1.12, k);
    spread = lerp(spread, 0.24, k);
    headX -= 0.12 * k;
    twist += 0.25 * k;
  }
  // 돌진: 몸을 낮추고 앞으로 늘어남, 발톱은 앞으로 모으고 자락이 뒤로 길게 흐른다 (1.35 안).
  // 기절은 돌진을 끊는다 (시뮬레이션과 같게: 둘이 겹친 자세 값이 와도 늘어나지 않는다)
  if (p.dash > 0) {
    const k = p.dash * (1 - p.stun);
    toward(
      k,
      [
        [0.3, -0.64],
        [0.3, 0.64],
      ],
      [
        [0.62, -0.34],
        [0.62, 0.34],
      ],
      [-0.06, 0.06],
    );
    spread = lerp(spread, 0.24, k);
    headX += 0.08 * k;
    tipRx = lerp(tipRx, 1.2, k);
    tipRy = lerp(tipRy, 0.92, k);
    valRx = lerp(valRx, 0.96, k);
    valRy = lerp(valRy, 0.8, k);
    wave *= 1 - 0.5 * k;
    body = mul(translate(0.07 * k, 0), scale(1 + 0.08 * k, 1 - 0.12 * k));
  }
  // 포효: 고개를 젖혀 얼굴이 위를 본다 (위에서 얼굴 · 빛나는 목구멍이 크게 보임). 팔은 벌리지 않고 머리 양옆으로 들어
  // 올린다 — 위로 세운 발톱은 위에서 보면 짧게 줄어 보인다
  if (p.roar > 0) {
    const k = p.roar;
    toward(
      k,
      [
        [0.0, -0.84],
        [0.0, 0.84],
      ],
      [
        [0.16, -0.64],
        [0.16, 0.64],
      ],
      [-1.2, 1.2],
    );
    clawK = lerp(clawK, 0.8, k);
    spread = lerp(spread, 0.4, k);
    headX -= 0.1 * k;
    headK = lerp(headK, 1.1, k);
    faceX = lerp(faceX, 0.36, k);
    faceRx = lerp(faceRx, 0.24, k);
    faceRy = lerp(faceRy, 0.3, k);
    tipRx = lerp(tipRx, 1.07, k);
    tipRy = lerp(tipRy, 1.06, k);
  }
  // 기절: 축 처짐 — 고개가 앞으로 떨어지고, 팔이 몸 옆에 늘어져 발톱이 뒤로 흐르며 자락이 가라앉는다. 눈빛이 꺼진다
  if (p.stun > 0) {
    const k = p.stun;
    toward(
      k,
      [
        [0.06, -0.84],
        [0.06, 0.84],
      ],
      [
        [-0.1, -0.84],
        [-0.1, 0.84],
      ],
      [-2.5, 2.5],
    );
    clawK = lerp(clawK, 0.8, k);
    spread = lerp(spread, 0.22, k);
    headX += 0.12 * k;
    headK = lerp(headK, 0.88, k);
    glow = lerp(glow, 0.45, k);
    tipRx = lerp(tipRx, 1.0, k);
    tipRy = lerp(tipRy, 1.0, k);
    valRx = lerp(valRx, 0.86, k);
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
    head: [headX, 0],
    headK,
    faceX,
    faceRx,
    faceRy,
    mouth: p.roar,
    glow,
    elbows: el,
    hands: ha,
    clawAng: ang,
    clawK,
    spread,
    armsOver: Math.min(1, Math.max(0, (Math.max(p.windup, p.roar, p.stun) - 0.15) / 0.3)),
    tipRx,
    tipRy,
    valRx,
    valRy,
    wave,
    sway: 0.08 * s,
  };
}

/** 망토: 어깨는 둥글고, 뒤 자락은 톱니 (끝 5개). 물결 위상 cloak */
function cloakPath(m: Mat, r: MonsterRig, cloak: number): string {
  const pts: Pt[] = [];
  const a0 = Math.PI * 0.58;
  const n = 10;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const a = -a0 - t * (2 * Math.PI - 2 * a0) + r.sway;
    const tip = i % 2 === 1;
    const w = tip ? Math.sin(cloak + i * 0.95) * r.wave : 0;
    const da = tip ? Math.cos(cloak + i * 0.95) * r.wave * 0.8 : 0;
    const rx = (tip ? r.tipRx : r.valRx) + w;
    const ry = (tip ? r.tipRy : r.valRy) + w * 0.6;
    pts.push([Math.cos(a + da) * rx, Math.sin(a + da) * ry]);
  }
  // 앞쪽 가슴 · 어깨: 두건 아래로 숨는 가슴(두 팔 사이를 채워 판정 원 앞이 비어 보이지 않게), 옆으로 어깨 가시 하나씩
  // (앞 반쪽도 둥글지 않게). 가시 끝에서 곡선을 끊어 모서리를 뾰족하게 남긴다
  const spike: Pt = [-0.12, 1.08];
  const first = pts[0] ?? [0, 0];
  return path(m)
    .curve([
      [0.46, 0],
      [0.44, -0.26],
      [0.38, -0.5],
      [0.3, -0.74],
      [0.08, -0.96],
      [spike[0], -spike[1]],
    ])
    .curve([[spike[0], -spike[1]], [-0.24, -0.98], [-0.36, -1.0], first], 1, false)
    .curve(pts, 0.2, false)
    .curve([[-0.36, 1.0], [-0.24, 0.98], spike], 1, false)
    .curve([spike, [0.08, 0.96], [0.3, 0.74], [0.38, 0.5], [0.44, 0.26]], 1, false)
    .Z().d;
}

/**
 * 위 그림 팔 둘 (어깨 → 팔꿈치 → 손 + 발톱). over = 망토 위에 든 팔 (카메라에 가까워 밝은 소매로 망토와 갈린다),
 * alpha = 그 비침 (층이 바뀌는 사이 값). what: sleeves = 소매만, hands = 손 · 발톱만, all = 모두
 */
function topArms(
  sk: Sketch,
  r: MonsterRig,
  ink: Ink,
  over: boolean,
  what: 'sleeves' | 'hands' | 'all',
  alpha?: number,
): void {
  const C = MONSTER_COLOR;
  const U = r.upper;
  const sleeve = over ? shade(C.hood, 0.06) : C.sleeve;
  for (const i of [0, 1] as const) {
    const side = i === 0 ? -1 : 1;
    const sh: Pt = [SHOULDER[0], SHOULDER[1] * side];
    const e = r.elbows[i];
    const h = r.hands[i];
    if (what !== 'hands') {
      const arm = path(U).capsule(sh[0], sh[1], e[0], e[1], 0.32, 0.28).d;
      sk.part(arm, dome(U, sleeve, ink, 0, 0, 1.2), ink(OUTLINE), alpha);
      const fore = path(U).capsule(e[0], e[1], h[0], h[1], 0.28, 0.2).d;
      sk.part(fore, dome(U, sleeve, ink, 0, 0, 1.2), ink(OUTLINE), alpha);
    }
    if (what !== 'sleeves')
      clawHand(sk, U, h[0], h[1], r.clawAng[i], r.spread * side, r.clawK, ink, sleeve, alpha);
  }
}

function top(p: MonsterPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = MONSTER_COLOR;
  const sk = new Sketch(o.w);
  const r = monsterRig(p);
  const B = r.body;
  const N = r.neck;

  // ── 층 1: 앞으로 내민 팔 소매 (망토 아래에서 나옴 — 망토 외곽선이 어깨를 덮는다).
  // 타격의 발톱 자국은 게임의 베기 호 효과가 그리므로 그림에 넣지 않는다 ──
  if (r.armsOver < 1) {
    topArms(sk, r, ink, false, 'sleeves');
    sk.layer();
  }
  // ── 층 2: 망토 · 등뼈 · (든 팔) · 두건 · 얼굴. 든 팔은 망토와 같은 층이라 망토 밖으로 나온 곳에만 굵은 외곽선이 생긴다 ──
  sk.part(cloakPath(B, r, p.cloak), dome(B, C.cloak, ink, 0, 0, 1.1), ink(OUTLINE));
  // 등뼈: 어두운 둥근 마디 셋 사이로 희미한 불씨 (화살촉 꼴이면 뒤를 가리켜 보이고, 뒤쪽이 밝으면 앞 단서와 헷갈린다)
  sk.line(path(N).M(-0.5, 0).L(-0.88, 0).d, solid(ink(C.eyeGlow)), 0.05, 'round', 0.4);
  for (const [x, k] of [
    [-0.6, 1],
    [-0.74, 0.85],
    [-0.86, 0.7],
  ] as const) {
    sk.part(
      path(N).circle(x, 0, 0.065 * k).d,
      rad(N, x - 0.02, -0.02, 0.08 * k, [
        [0, ink(mix(C.spine, C.boneShade, 0.55))],
        [1, ink(C.spine)],
      ]),
      ink(OUTLINE),
      undefined,
      0.3,
    );
  }
  // 손 · 발톱은 망토 위에 그린다: 굵은 망토 외곽선에 손이 묻히면 흰 발톱 끝만 남아 머리 옆 귀 · 뿔처럼 읽힌다
  if (r.armsOver < 1) topArms(sk, r, ink, false, 'hands');
  if (r.armsOver > 0) topArms(sk, r, ink, true, 'all', r.armsOver < 1 ? r.armsOver : undefined);
  const [hx, hy] = r.head;
  const H = mul(N, mul(translate(hx, hy), scale(r.headK)));
  // 얼굴 (두건 속 어두운 얼굴) — 두건보다 먼저 그려 두건 챙이 뒤쪽을 덮는다. 챙 그늘 쪽(뒤)이 가장 어둡다
  const face = path(H).ellipse(r.faceX, 0, r.faceRx, r.faceRy).d;
  sk.part(
    face,
    lin(H, r.faceX - r.faceRx, 0, r.faceX + r.faceRx, 0, [
      [0, ink(C.void)],
      [0.55, ink(C.void)],
      [1, ink(C.face)],
    ]),
    ink(OUTLINE),
  );
  // 얼굴 앞 테: 두건 안감(짙은 진홍)이 얼굴을 감싸 어두운 얼굴이 외곽선과 갈린다 (눈이 머리 밖에 떠 보이지 않게)
  sk.line(
    path(H).arc(r.faceX, 0, r.faceRx - 0.018, -1.25, 1.25, true, r.faceRy - 0.018).d,
    solid(ink(C.cloakDeep)),
    0.035,
    'round',
    0.9,
  );
  // 두건: 앞으로 내민 머리를 덮은 깊은 두건 (몸 가운데를 덮는 역할색). 챙이 앞으로 둥글게 튀어나와 그 앞으로 그늘진 얼굴이
  // 초승달만큼 보인다 (머리를 앞으로 숙여 위에서도 얼굴 아래쪽이 보임). 뒤는 둥글게 (뿔 없음)
  const hf = 0.62 - 0.3 * r.mouth;
  const hood = path(H).smooth(
    [
      [hf, 0],
      [hf - 0.03, 0.16],
      [hf - 0.1, 0.3],
      [0.36, 0.45],
      [0.1, 0.52],
      [-0.28, 0.48],
      [-0.54, 0],
      [-0.28, -0.48],
      [0.1, -0.52],
      [0.36, -0.45],
      [hf - 0.1, -0.3],
      [hf - 0.03, -0.16],
    ],
    0.55,
  ).d;
  sk.part(hood, dome(H, C.hood, ink, -0.06, 0, 0.78, 0.04), ink(OUTLINE), undefined, 0.3);
  // 챙 끝 (두건 천의 두께: 짙은 진홍 안감)
  sk.line(
    path(H).curve([
      [hf - 0.1, -0.28],
      [hf - 0.035, -0.15],
      [hf - 0.012, 0],
      [hf - 0.035, 0.15],
      [hf - 0.1, 0.28],
    ]).d,
    solid(ink(C.cloakDeep)),
    0.035,
    'round',
    0.85,
  );
  // 두건 등 테 (위 빛을 받는 밝은 주름)
  sk.line(
    path(H).curve([
      [0.24, -0.4],
      [hf - 0.06, -0.27],
    ]).d,
    solid(ink(tint(C.hood, 0.3))),
    0.03,
    'round',
    0.4,
  );
  sk.line(
    path(H).curve([
      [0.24, 0.4],
      [hf - 0.06, 0.27],
    ]).d,
    solid(ink(tint(C.hood, 0.3))),
    0.03,
    'round',
    0.4,
  );
  // 입 (포효: 이빨 없이 빛나는 목구멍 — 빛 번짐 → 어둠 → 가운데 붉은 빛)
  if (r.mouth > 0.05) {
    const mx = r.faceX + 0.15 * r.mouth;
    const mr = 0.08 * r.mouth + 0.02;
    bloom(sk, H, mx, 0, mr * 2.6, ink(C.eyeGlow), 0.95 * r.mouth);
    sk.fill(path(H).ellipse(mx, 0, mr * 0.7, mr * 1.6).d, solid(ink(C.void)));
    sk.fill(
      path(H).ellipse(mx, 0, mr * 0.7, mr * 1.6).d,
      rad(H, mx, 0, mr * 1.1, [
        [0, ink(tint(C.eyeGlow, 0.6)), 0.95],
        [0.5, ink(C.eyeGlow), 0.6],
        [1, ink(C.eyeGlow), 0],
      ]),
    );
  }
  // 눈 (얼굴이 위를 볼수록 눈은 뒤로): 챙 그늘 속에서 앞을 향한 V
  const eyeX = r.faceX + 0.115 - 0.1 * r.mouth;
  for (const side of [-1, 1]) glowEye(sk, H, eyeX, side * 0.125, 0.1, p.eyes, ink, r.glow, side * 0.5);
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
  // 가장 먼 반쪽 크기: 돌진 자락 1.245 (다른 동작과 겹쳐도 그 안 — 기절은 돌진을 끊는다) + 여유 (1차 시안 1.5)
  topExtent: 1.28,
};
