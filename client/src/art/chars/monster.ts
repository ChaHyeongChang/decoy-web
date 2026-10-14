// 괴물 새 캐릭터 (캐릭터 리디자인): 붉은 두건을 깊게 쓴 구부정한 사냥꾼. 옛 그림의 정체성(붉은 두건 · 톱니 자락 망토 ·
// 어둠 속 빛나는 눈 · 앞 발톱)을 잇고, 두건 위로 뒤로 휜 뿔 둘 · 긴 팔과 뼈 갈고리 발톱 셋 · 등뼈 돌기를 더했다.
// 위에서 보면 둥근 생존자와 달리 앞(흰 발톱 쐐기 둘) · 옆(어깨 가시) · 뒤(갈라진 두건 뿔 · 톱니 자락 + 등뼈)가 모두 뾰족하다.
// 색: 두건 = 괴물 역할색 원색(몸 가운데), 망토 = 짙은 진홍, 얼굴 = 아주 어두운 #1A0B0E, 눈 = 흰 분홍 + 분홍 빛,
// 발톱 · 뿔 끝 = 뼈 색. 네온 포인트는 눈 빛 · 등뼈 틈 · (정면) 이빨 빛, 망토 틈에 희미한 불씨뿐이다. 청록은 쓰지 않는다.
//
// 위에서 본 그림: 단위 = 몸 반지름 1(판정 반지름 0.35타일), +x = 바라보는 방향. 빛은 위에서 (돔 음영, 회전과 무관).
// 정면 그림: 상자 [−1, 1]², 빛은 왼쪽 위.
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
import type { ArtOptions, FrontPose, MonsterArt, MonsterPose } from './types';

type Pt = readonly [number, number];

/** 괴물 색 */
export const MONSTER_COLOR = {
  hood: ROLE.monster,
  cloak: shade(ROLE.monster, 0.24),
  cloakDeep: 0x5a1219,
  sleeve: shade(ROLE.monster, 0.2),
  horn: 0x4a141a,
  bone: 0xf1e6e8,
  boneShade: 0xb59ea3,
  hand: 0x2a0e12,
  face: 0x1a0b0e,
  eye: 0xfff1f2,
  eyeGlow: 0xfb7185,
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

/**
 * 갈고리 (발톱 · 뿔): 밑동 (bx, by)에서 ang 방향으로 len만큼, bend만큼 옆으로 휘며 끝이 뾰족해진다.
 * bend > 0이면 진행 방향 기준 +y 쪽(오른쪽)으로 휜다
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

/** 뼈 갈고리 칠 (끝으로 갈수록 밝게). shaded = 밑동 그늘 (정면 큰 그림용 — 위 그림은 작은 크기에서 밝은 쐐기로 읽히게 뺀다) */
function bonePaint(m: Mat, bx: number, by: number, ang: number, len: number, ink: Ink, shaded = true): Paint {
  const stops: Stop[] = shaded
    ? [
        [0, ink(mix(MONSTER_COLOR.boneShade, MONSTER_COLOR.bone, 0.7))],
        [0.35, ink(MONSTER_COLOR.bone)],
        [1, ink(0xffffff)],
      ]
    : [
        [0, ink(MONSTER_COLOR.bone)],
        [1, ink(0xffffff)],
      ];
  return lin(m, bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len, stops);
}

/**
 * 위 그림 발톱 셋 + 손. ang = 가운데 발톱 방향, spread = 발톱 사이 각, k = 크기(들어 올리면 카메라에 가까워 커짐).
 * 발톱은 굵고 촘촘하게 모아, 작은 크기에서 외곽선에 묻히지 않고 하나의 흰 쐐기로 읽히게 한다
 */
function clawHand(
  sk: Sketch,
  m: Mat,
  hx: number,
  hy: number,
  ang: number,
  side: number,
  spread: number,
  k: number,
  ink: Ink,
  palmR = 0.11,
  palm: number = MONSTER_COLOR.boneShade,
): void {
  for (const i of [-1, 0, 1]) {
    const a = ang + i * spread;
    const len = (i === 0 ? 0.5 : 0.42) * k;
    const bx = hx + Math.cos(a) * palmR * 0.55;
    const by = hy + Math.sin(a) * palmR * 0.55;
    // 갈고리는 몸 안쪽(−side)으로 휜다
    sk.part(
      hook(m, bx, by, a, len, 0.42 * k, -0.3 * side),
      bonePaint(m, bx, by, a, len, ink, false),
      ink(OUTLINE),
      undefined,
      0.2,
    );
  }
  sk.part(
    path(m).circle(hx, hy, palmR * k).d,
    rad(m, hx - 0.04, hy - 0.04, palmR * k * 1.3, [
      [0, ink(tint(palm, 0.15))],
      [1, ink(shade(palm, 0.3))],
    ]),
    ink(OUTLINE),
  );
}

/** 빛나는 눈 하나 (빛 번짐 + 흰 분홍 눈). eyes: open = 타원, blink = 가는 선, stun = × */
function glowEye(
  sk: Sketch,
  m: Mat,
  x: number,
  y: number,
  r: number,
  eyes: MonsterPose['eyes'],
  ink: Ink,
  glow = 0.75,
  tilt = 0,
): void {
  const C = MONSTER_COLOR;
  const ls = lenScale(m);
  sk.fill(
    path(m).circle(x, y, r * 2.6).d,
    rad(m, x, y, r * 2.6, [
      [0, ink(C.eyeGlow), glow],
      [0.45, ink(C.eyeGlow), glow * 0.45],
      [1, ink(C.eyeGlow), 0],
    ]),
  );
  if (eyes === 'stun') {
    const d = r * 0.95;
    sk.line(
      path(m)
        .M(x - d, y - d)
        .L(x + d, y + d)
        .M(x - d, y + d)
        .L(x + d, y - d).d,
      solid(ink(C.eye)),
      r * 0.55 * ls,
    );
  } else if (eyes === 'blink') {
    sk.line(
      path(m)
        .M(x - r * 0.4, y - r * 1.1)
        .L(x + r * 0.4, y + r * 1.1).d,
      solid(ink(C.eye)),
      r * 0.5 * ls,
    );
  } else {
    sk.fill(path(m).ellipse(x, y, r * 0.8, r * 1.15, tilt).d, solid(ink(C.eye)));
  }
}

// ───────────────────────── 위에서 본 그림 ─────────────────────────

/** 자세 → 몸 배치 */
interface MonsterRig {
  /** 몸 전체 변환 (돌진 늘어남 · 기절 기울어짐) */
  body: Mat;
  /** 윗몸 변환 (걷기 어깨 흔들림) */
  upper: Mat;
  /** 두건 중심 · 크기 배율 */
  head: Pt;
  headK: number;
  /** 얼굴 (두건 앞 어두운 구멍) 중심 x · 반지름 */
  faceX: number;
  faceRx: number;
  faceRy: number;
  /** 입 벌림 (포효) */
  mouth: number;
  /** 팔: 어깨 · 팔꿈치 · 손 · 발톱 방향 (0 = 왼쪽 y < 0, 1 = 오른쪽) */
  elbows: [Pt, Pt];
  hands: [Pt, Pt];
  clawAng: [number, number];
  clawK: number;
  spread: number;
  /** 자락: 끝 · 골 반지름 (앞뒤 x, 옆 y), 물결 세기, 흔들림 각 */
  tipRx: number;
  tipRy: number;
  valRx: number;
  valRy: number;
  wave: number;
  sway: number;
}

const SHOULDER: Pt = [0.0, 0.64];

function monsterRig(p: MonsterPose): MonsterRig {
  const s = Math.sin(p.walk) * p.stride;
  // 기본 (서기 + 걷기): 앞으로 뻗은 긴 팔, 발톱은 조금 바깥을 향함. 걸을 때 팔은 엇갈려 흔들린다
  let el: [Pt, Pt] = [
    [0.2 + 0.08 * s, -0.86],
    [0.2 - 0.08 * s, 0.86],
  ];
  let ha: [Pt, Pt] = [
    [0.56 + 0.12 * s, -0.58],
    [0.56 - 0.12 * s, 0.58],
  ];
  let ang: [number, number] = [-0.1, 0.1];
  let clawK = 1;
  let spread = 0.2;
  let headX = 0.04 + 0.03 * Math.abs(s);
  let headK = 1;
  let faceX = 0.46;
  let faceRx = 0.18;
  let faceRy = 0.25;
  let tipRx = 1.1;
  let tipRy = 1.04;
  let valRx = 0.8;
  let valRy = 0.86;
  let wave = 0.055;
  let body: Mat = translate(0, 0);

  const toward = (k: number, e: [Pt, Pt], h: [Pt, Pt], a: [number, number]): void => {
    el = [lerpPt(el[0], e[0], k), lerpPt(el[1], e[1], k)];
    ha = [lerpPt(ha[0], h[0], k), lerpPt(ha[1], h[1], k)];
    ang = [lerp(ang[0], a[0], k), lerp(ang[1], a[1], k)];
  };

  // 공격 준비: 팔을 뒤 · 바깥으로 젖혀 발톱이 어깨선 뒤로 넘어간다 (높이 들어 카메라에 가까워 커 보임), 자락이 부푼다
  if (p.windup > 0) {
    const k = p.windup;
    toward(
      k,
      [
        [0.04, -0.96],
        [0.04, 0.96],
      ],
      [
        [-0.26, -0.85],
        [-0.26, 0.85],
      ],
      [-2.45, 2.45],
    );
    clawK = lerp(clawK, 1.18, k);
    spread = lerp(spread, 0.5, k);
    headX -= 0.06 * k;
    tipRx = lerp(tipRx, 1.16, k);
    tipRy = lerp(tipRy, 1.12, k);
    valRy = lerp(valRy, 0.98, k);
  }
  // 타격: 두 발톱을 앞으로 휘둘러 엇갈린다 (X자)
  if (p.strike > 0) {
    const k = p.strike;
    toward(
      k,
      [
        [0.55, -0.58],
        [0.55, 0.58],
      ],
      [
        [0.9, 0.2],
        [0.9, -0.2],
      ],
      [0.75, -0.75],
    );
    clawK = lerp(clawK, 1.08, k);
    spread = lerp(spread, 0.36, k);
    headX += 0.08 * k;
  }
  // 돌진: 몸을 낮추고 앞으로 늘어남, 발톱은 앞으로 모으고 자락이 뒤로 길게 흐른다
  if (p.dash > 0) {
    const k = p.dash;
    toward(
      k,
      [
        [0.3, -0.74],
        [0.3, 0.74],
      ],
      [
        [0.66, -0.4],
        [0.66, 0.4],
      ],
      [0.12, -0.12],
    );
    spread = lerp(spread, 0.3, k);
    headX += 0.08 * k;
    tipRx = lerp(tipRx, 1.3, k);
    tipRy = lerp(tipRy, 0.86, k);
    valRx = lerp(valRx, 0.92, k);
    valRy = lerp(valRy, 0.8, k);
    wave *= 1 - 0.5 * k;
    body = mul(translate(0.07 * k, 0), scale(1 + 0.08 * k, 1 - 0.12 * k));
  }
  // 포효: 고개를 젖혀 얼굴이 위를 본다 (위에서 얼굴 · 벌린 입이 보임), 팔을 넓게 벌린다
  if (p.roar > 0) {
    const k = p.roar;
    toward(
      k,
      [
        [0.12, -1.04],
        [0.12, 1.04],
      ],
      [
        [0.46, -0.96],
        [0.46, 0.96],
      ],
      [-0.95, 0.95],
    );
    spread = lerp(spread, 0.5, k);
    headX -= 0.1 * k;
    headK = lerp(headK, 1.08, k);
    faceX = lerp(faceX, 0.36, k);
    faceRx = lerp(faceRx, 0.29, k);
    faceRy = lerp(faceRy, 0.33, k);
    tipRx = lerp(tipRx, 1.14, k);
    tipRy = lerp(tipRy, 1.1, k);
  }
  // 기절: 축 처짐 — 고개가 앞으로 떨어지고, 팔이 늘어져 발톱이 몸 옆 뒤로 흐르며 자락이 가라앉는다
  if (p.stun > 0) {
    const k = p.stun;
    toward(
      k,
      [
        [0.02, -0.9],
        [0.02, 0.9],
      ],
      [
        [0.14, -0.88],
        [0.14, 0.88],
      ],
      [-2.2, 2.35],
    );
    clawK = lerp(clawK, 0.86, k);
    spread = lerp(spread, 0.24, k);
    headX += 0.12 * k;
    headK = lerp(headK, 0.88, k);
    tipRx = lerp(tipRx, 0.94, k);
    tipRy = lerp(tipRy, 0.96, k);
    valRx = lerp(valRx, 0.9, k);
    wave *= 1 - 0.7 * k;
    body = mul(body, rotateAbout(0.12 * k, 0, 0));
  }
  return {
    body,
    upper: mul(body, rotateAbout(-0.1 * s, 0, 0)),
    head: [headX, 0],
    headK,
    faceX: faceX + headX - 0.04,
    faceRx,
    faceRy,
    mouth: p.roar,
    elbows: el,
    hands: ha,
    clawAng: ang,
    clawK,
    spread,
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
  // 앞쪽 어깨 (오른쪽 → 앞 → 왼쪽): 두건 아래로 숨는 어깨, 옆으로 가시 하나씩 (앞 반쪽도 둥글지 않게)
  // 가시 끝에서 곡선을 끊어 모서리를 뾰족하게 남긴다
  const spike: Pt = [-0.1, 1.1];
  const first = pts[0] ?? [0, 0];
  return path(m)
    .curve([
      [0.38, 0],
      [0.36, -0.3],
      [0.3, -0.72],
      [0.06, -0.95],
      [spike[0], -spike[1]],
    ])
    .curve([[spike[0], -spike[1]], [-0.2, -0.95], [-0.36, -0.96], first], 1, false)
    .curve(pts, 0.2, false)
    .curve([[-0.36, 0.96], [-0.2, 0.95], spike], 1, false)
    .curve([spike, [0.06, 0.95], [0.3, 0.72], [0.36, 0.3]], 1, false)
    .Z().d;
}

function top(p: MonsterPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = MONSTER_COLOR;
  const sk = new Sketch(o.w);
  const r = monsterRig(p);
  const B = r.body;
  const U = r.upper;

  // ── 층 1: 긴 팔과 뼈 발톱 (망토 아래에서 앞으로 뻗어 나옴 — 망토 외곽선이 어깨를 덮는다).
  // 타격의 발톱 자국은 게임의 베기 호 효과가 그리므로 그림에 넣지 않는다 ──
  for (const i of [0, 1] as const) {
    const side = i === 0 ? -1 : 1;
    const sh: Pt = [SHOULDER[0], SHOULDER[1] * side];
    const e = r.elbows[i];
    const h = r.hands[i];
    const arm = path(U).capsule(sh[0], sh[1], e[0], e[1], 0.36, 0.3).d;
    sk.part(arm, dome(U, C.sleeve, ink, 0, 0, 1.25), ink(OUTLINE));
    const fore = path(U).capsule(e[0], e[1], h[0], h[1], 0.3, 0.2).d;
    sk.part(fore, dome(U, C.sleeve, ink, 0, 0, 1.25), ink(OUTLINE));
    clawHand(sk, U, h[0], h[1], r.clawAng[i], side, r.spread * side, r.clawK, ink, 0.14, shade(C.hood, 0.45));
  }
  // ── 층 2: 망토 · 등뼈 · 뿔 · 두건 · 얼굴 ──
  sk.layer();
  sk.part(cloakPath(B, r, p.cloak), dome(B, C.cloak, ink, 0, 0, 1.15), ink(OUTLINE));
  // 등뼈: 빛나는 틈(네온) 위에 뼈 돌기 셋
  sk.line(path(U).M(-0.5, 0).L(-1.0, 0).d, solid(ink(C.neon)), 0.07, 'round', 0.85);
  for (const [x, k] of [
    [-0.62, 1],
    [-0.8, 0.86],
    [-0.96, 0.7],
  ] as const) {
    const d = path(U).poly([
      [x + 0.1 * k, -0.11 * k],
      [x - 0.14 * k, 0],
      [x + 0.1 * k, 0.11 * k],
      [x + 0.04 * k, 0],
    ]).d;
    sk.part(
      d,
      lin(U, x + 0.1, 0, x - 0.14, 0, [
        [0, ink(C.horn)],
        [1, ink(C.boneShade)],
      ]),
      ink(OUTLINE),
      undefined,
      0.3,
    );
  }
  const [hx, hy] = r.head;
  const hk = r.headK;
  const H = mul(U, mul(translate(hx, hy), scale(hk)));
  // 얼굴 (두건 앞의 어두운 구멍) — 두건보다 먼저 그려 두건 앞 테가 덮는다
  const face = path(U).ellipse(r.faceX, 0, r.faceRx, r.faceRy).d;
  sk.part(face, solid(ink(C.face)), ink(OUTLINE));
  // 두건: 앞이 오목하게 열린 깊은 두건 (몸 가운데를 덮는 역할색)
  const hoodFront = 0.47 - 0.16 * r.mouth;
  const hood = path(H).smooth(
    [
      [hoodFront, -0.3],
      [hoodFront - 0.11, 0],
      [hoodFront, 0.3],
      [0.12, 0.52],
      [-0.3, 0.47],
      [-0.54, 0],
      [-0.3, -0.47],
      [0.12, -0.52],
    ],
    0.55,
  ).d;
  sk.part(hood, dome(H, C.hood, ink, -0.04, 0, 0.78, 0.08), ink(OUTLINE), undefined, 0.3);
  // 두건 앞 테 (밝은 가장자리)
  sk.line(
    path(H).curve([
      [0.24, -0.44],
      [hoodFront - 0.04, -0.26],
      [hoodFront - 0.12, 0],
      [hoodFront - 0.04, 0.26],
      [0.24, 0.44],
    ]).d,
    solid(ink(tint(C.hood, 0.35))),
    0.035,
    'round',
    0.45,
  );
  // 뿔 둘: 두건 뒤 모서리가 갈라져 뒤 · 바깥으로 솟은 짧고 굵은 뿔 (위에서 보면 두건이 뒤로 갈라진 붉은 V).
  // 뼈 색은 끝에만 — 뒤쪽에 밝은 점이 생기면 앞 발톱(바라보는 방향 단서)과 헷갈린다
  for (const side of [-1, 1]) {
    const bx = -0.2;
    const by = 0.36 * side;
    const a = (Math.PI - 1.0) * side;
    const len = 0.45;
    sk.part(
      hook(H, bx, by, a, len, 0.36, 0.3 * side),
      lin(H, bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len, [
        [0, ink(shade(C.hood, 0.1))],
        [0.88, ink(shade(C.hood, 0.3))],
        [0.9, ink(C.boneShade)],
        [1, ink(C.bone)],
      ]),
      ink(OUTLINE),
      undefined,
      0.35,
    );
  }
  // 눈 · 입 (얼굴이 위를 볼수록 눈은 뒤, 입은 앞에)
  const fx = r.faceX;
  const eyeX = fx + 0.13 - 0.23 * r.mouth;
  if (r.mouth > 0.05) {
    const mx = fx + 0.1 * r.mouth;
    const mr = 0.13 * r.mouth + 0.02;
    // 벌린 입: 빛 번짐 → 뼈 색 고리 → 안쪽 어둠이 별 모양으로 파여 이빨이 안쪽을 향한다
    sk.fill(
      path(U).ellipse(mx, 0, mr * 1.5, mr * 1.9).d,
      rad(U, mx, 0, mr * 1.9, [
        [0, ink(C.eyeGlow), 0.7],
        [1, ink(C.eyeGlow), 0],
      ]),
    );
    sk.fill(path(U).ellipse(mx, 0, mr * 0.85, mr * 1.25).d, solid(ink(C.bone)));
    const teeth: Pt[] = [];
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 2 === 0 ? 0.92 : 0.5;
      teeth.push([mx + Math.cos(a) * mr * 0.8 * rr, Math.sin(a) * mr * 1.2 * rr]);
    }
    sk.fill(path(U).poly(teeth).d, solid(ink(0x3a0a12)));
  }
  for (const side of [-1, 1]) glowEye(sk, U, eyeX, side * 0.125, 0.07, p.eyes, ink, 0.85, side * 0.3);

  return sk.drawing();
}

// ───────────────────────── 정면 그림 ─────────────────────────

/** 정면 팔 하나: 어깨(망토 아래) → 팔꿈치 → 해진 소맷부리 → 뼈 손 + 벌린 갈고리 발톱 셋 */
function frontArm(sk: Sketch, M: Mat, side: number, sh: Pt, el: Pt, wr: Pt, clawDir: number, ink: Ink): void {
  const C = MONSTER_COLOR;
  const sleeve = shade(C.hood, 0.55);
  const sleevePaint = lin(M, el[0] - side * 0.12, el[1] - 0.1, el[0] + side * 0.12, el[1] + 0.3, [
    [0, ink(tint(sleeve, 0.1))],
    [0.6, ink(sleeve)],
    [1, ink(shade(sleeve, 0.35))],
  ]);
  // 윗팔 (가는 캡슐)
  sk.part(path(M).capsule(sh[0], sh[1], el[0], el[1], 0.17, 0.15).d, sleevePaint, ink(OUTLINE));
  // 아래팔 소매: 팔꿈치에서 손목으로 넓어지고 끝이 톱니로 해졌다
  const dx = wr[0] - el[0];
  const dy = wr[1] - el[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const ux = dx / l;
  const uy = dy / l;
  const w0 = 0.065;
  const w1 = 0.115;
  const cuff: Pt[] = [];
  for (let i = 0; i <= 4; i += 1) {
    const k = i / 4;
    const off = lerp(w1, -w1, k);
    const len = i % 2 === 0 ? 0.06 : -0.01;
    cuff.push([wr[0] + nx * off + ux * len, wr[1] + ny * off + uy * len]);
  }
  sk.part(
    path(M).poly([[el[0] + nx * w0, el[1] + ny * w0], ...cuff, [el[0] - nx * w0, el[1] - ny * w0]]).d,
    sleevePaint,
    ink(OUTLINE),
  );
  // 벌린 갈고리 발톱 셋
  for (const i of [-1, 0, 1]) {
    const a = clawDir + i * 0.42;
    const len = i === 0 ? 0.42 : 0.34;
    const bx = wr[0] + Math.cos(a) * 0.06;
    const by = wr[1] + Math.sin(a) * 0.06;
    // 갈고리는 몸 안쪽으로 휜다 (좌우 거울 대칭 — 아래로 늘어뜨리든 위로 들든)
    sk.part(
      hook(M, bx, by, a, len, 0.1, 0.38 * side * Math.sign(Math.sin(clawDir) || 1)),
      bonePaint(M, bx, by, a, len, ink),
      ink(OUTLINE),
      undefined,
      0.3,
    );
  }
  // 뼈 손 (어두운 손등)
  sk.part(
    path(M).ellipse(wr[0] + ux * 0.04, wr[1] + uy * 0.04, 0.07, 0.06, Math.atan2(uy, ux)).d,
    solid(ink(C.hand)),
    ink(OUTLINE),
  );
}

const BUST_K = 1.2;
const BUST_DY = 0.43;
const BUST_EL: Pt = [0.7, 0.1];
const BUST_WR: Pt = [0.58, -0.3];
const BUST_CLAW = 0.16;

function front(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = MONSTER_COLOR;
  const sk = new Sketch(o.w);
  // 상반신은 머리 · 어깨 · 두건 양옆으로 든 발톱이 상자를 채우게 키운다.
  // 전신은 뿔 끝 · 발톱 끝 · 자락이 외곽선까지 ±1 상자 안에 들게 조금 줄인다
  const M: Mat = p.bust ? mul(translate(0, BUST_DY), scale(BUST_K)) : scale(0.95);
  const by = frontBreath(p.t) * 1.6;
  const t = p.t;
  const ls = lenScale(M);
  // 수그린 자세: 머리를 어깨 사이로 낮춘다
  const hy = -0.3 + by;

  // ── 층 1: 망토 (뒤, 땅까지 늘어진 톱니 자락) ──
  const hem: Pt[] = [];
  const n = 9;
  for (let i = 0; i <= n; i += 1) {
    const x = lerp(-0.72, 0.72, i / n);
    const tip = i % 2 === 0;
    const wv = Math.sin(t * 1.7 + i * 1.1) * 0.018;
    hem.push([x + wv, (tip ? 0.86 : 0.7) - Math.abs(x) * 0.05 + wv]);
  }
  const cloak = path(M)
    .curve([
      [0, -0.14 + by],
      [0.44, -0.08 + by],
      [0.64, 0.2],
      [0.72, 0.84],
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
    lin(M, -0.5, -0.1, 0.6, 0.9, [
      [0, ink(tint(C.cloak, 0.1))],
      [0.5, ink(C.cloak)],
      [1, ink(shade(C.cloak, 0.42))],
    ]),
    ink(OUTLINE),
  );
  // 망토 앞 틈 (어둠)
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
      [0, ink(C.face)],
      [1, ink(C.cloakDeep)],
    ]),
  );
  // 틈 안쪽의 희미한 붉은 불씨 (어둠 속에 무언가 있다는 느낌만)
  sk.fill(
    gap,
    rad(M, 0, 0.42, 0.34, [
      [0, ink(C.eyeGlow), 0.22],
      [1, ink(C.eyeGlow), 0],
    ]),
  );

  // ── 층 2: 긴 팔 · 벌린 발톱 ──
  sk.layer();
  for (const side of [-1, 1]) {
    const sway = Math.sin(t * 1.3 + side) * 0.012;
    if (p.bust)
      // 두 손을 두건 양옆으로 올려 발톱을 위로 세운다 (작은 아이콘에서 뿔 두건 + 두 발톱이 대칭으로 다 보이게)
      frontArm(
        sk,
        M,
        side,
        [side * 0.4, 0.06 + by],
        [side * BUST_EL[0], BUST_EL[1]],
        [side * BUST_WR[0], BUST_WR[1] + by],
        -Math.PI / 2 + side * BUST_CLAW,
        ink,
      );
    else
      frontArm(
        sk,
        M,
        side,
        [side * 0.42, 0.04 + by],
        [side * 0.86, 0.3 + sway],
        [side * 0.68, 0.5 + sway],
        Math.PI / 2 - side * 0.4,
        ink,
      );
  }

  // ── 층 3: 어깨 망토 · 뿔 · 두건 · 얼굴 ──
  sk.layer();
  // 어깨 망토 (구부정하게 솟은 어깨 + 톱니 아래 가장자리)
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
  sk.part(
    path(M).poly(mantleAll).d,
    lin(M, -0.4, -0.15, 0.4, 0.3, [
      [0, ink(tint(C.hood, 0.08))],
      [0.6, ink(shade(C.hood, 0.12))],
      [1, ink(shade(C.hood, 0.4))],
    ]),
    ink(OUTLINE),
  );
  // 뿔 (두건 위에서 바깥 · 위로 휘어 솟음)
  for (const side of [-1, 1]) {
    const bx = side * 0.26;
    const b2 = hy - 0.2;
    const a = -Math.PI / 2 + side * 0.85;
    sk.part(
      hook(M, bx, b2, a, 0.44, 0.18, -0.6 * side),
      lin(M, bx, b2, bx + side * 0.32, b2 - 0.4, [
        [0, ink(shade(C.hood, 0.5))],
        [0.45, ink(C.horn)],
        [0.75, ink(C.boneShade)],
        [1, ink(C.bone)],
      ]),
      ink(OUTLINE),
    );
  }
  // 두건 (넓은 챙 · 뾰족한 꼭대기, 각진 형태)
  const hood = path(M).smooth(
    [
      [0, hy - 0.48],
      [0.26, hy - 0.3],
      [0.44, hy - 0.02],
      [0.46, hy + 0.2],
      [0.3, hy + 0.34],
      [0, hy + 0.28],
      [-0.3, hy + 0.34],
      [-0.46, hy + 0.2],
      [-0.44, hy - 0.02],
      [-0.26, hy - 0.3],
    ],
    0.7,
  ).d;
  sk.part(
    hood,
    rad(M, -0.14, hy - 0.22, 0.66, [
      [0, ink(tint(C.hood, 0.2))],
      [0.5, ink(C.hood)],
      [1, ink(shade(C.hood, 0.4))],
    ]),
    ink(OUTLINE),
  );
  // 두건 접힘 (왼쪽 위 빛을 받는 밝은 주름)
  sk.line(
    path(M).curve([
      [-0.3, hy - 0.2],
      [-0.38, hy + 0.02],
      [-0.36, hy + 0.2],
    ]).d,
    solid(ink(tint(C.hood, 0.3))),
    0.03 * ls,
    'round',
    0.7,
  );
  // 얼굴 구멍 (어둠, 위는 챙 그늘로 더 어둡게)
  const faceD = path(M).smooth(
    [
      [0, hy - 0.17],
      [0.24, hy - 0.06],
      [0.28, hy + 0.12],
      [0.15, hy + 0.27],
      [0, hy + 0.23],
      [-0.15, hy + 0.27],
      [-0.28, hy + 0.12],
      [-0.24, hy - 0.06],
    ],
    0.8,
  ).d;
  sk.fill(
    faceD,
    lin(M, 0, hy - 0.17, 0, hy + 0.27, [
      [0, ink(C.face)],
      [0.6, ink(0x2a0c12)],
      [1, ink(0x3a0f16)],
    ]),
  );
  sk.line(faceD, solid(ink(shade(C.hood, 0.55))), 0.035 * ls, 'round', 0.95);
  // 눈 (치켜 올라간 가는 눈 + 빛 번짐)
  const glowA = 0.6 + 0.08 * Math.sin(t * 3.1);
  for (const side of [-1, 1]) {
    const ex = side * 0.115;
    const ey = hy + 0.0;
    sk.fill(
      path(M).ellipse(ex, ey, 0.15, 0.1).d,
      rad(M, ex, ey, 0.15, [
        [0, ink(C.eyeGlow), glowA],
        [0.5, ink(C.eyeGlow), glowA * 0.35],
        [1, ink(C.eyeGlow), 0],
      ]),
    );
    sk.fill(
      path(M).poly([
        [side * 0.035, ey + 0.005],
        [side * 0.19, ey - 0.055],
        [side * 0.16, ey + 0.03],
        [side * 0.07, ey + 0.035],
      ]).d,
      solid(ink(C.eye)),
    );
  }
  // 톱니 이빨 (빛나는 입): 위아래 어긋나 맞물린 삼각 이빨 + 분홍 빛
  const my = hy + 0.15;
  sk.fill(
    path(M).ellipse(0, my, 0.18, 0.08).d,
    rad(M, 0, my, 0.2, [
      [0, ink(C.eyeGlow), 0.45],
      [1, ink(C.eyeGlow), 0],
    ]),
  );
  const nT = 6;
  const topY = (x: number): number => my - 0.035 + x * x * 1.1;
  const lowY = (x: number): number => my + 0.06 - x * x * 0.5;
  for (let i = 0; i < nT; i += 1) {
    const x0 = lerp(-0.15, 0.15, i / nT);
    const x1 = lerp(-0.15, 0.15, (i + 1) / nT);
    const xm = (x0 + x1) / 2;
    const long = i === 1 || i === nT - 2 ? 0.075 : 0.055;
    sk.fill(
      path(M).poly([
        [x0, topY(x0)],
        [x1, topY(x1)],
        [xm, topY(xm) + long],
      ]).d,
      solid(ink(C.eye)),
    );
    if (i < nT - 1) {
      const xb = xm + (x1 - x0);
      const xc = (xm + xb) / 2;
      sk.fill(
        path(M).poly([
          [xm, lowY(xm)],
          [xb, lowY(xb)],
          [xc, lowY(xc) - 0.045],
        ]).d,
        solid(ink(C.bone)),
      );
    }
  }
  return sk.drawing();
}

export const MONSTER_ART: MonsterArt = { id: 'monster', top, front, topExtent: 1.45 };
