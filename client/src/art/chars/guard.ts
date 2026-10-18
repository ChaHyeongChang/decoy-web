// 가드 새 캐릭터 (캐릭터 리디자인): 볏 달린 보라 헬멧 + 큰 어깨 갑옷 + 몸 앞을 가리는 큰 방패. 단단하고 든든한 인상.
// 위에서 보면 판정 원을 꽉 채운 둥근 몸(헬멧 · 옆으로 넓은 어깨 판 · 몸 뒤를 감싸는 큰 등판) + 몸 앞을 넓게 감싼 초승달 방패(옛 초승달
// 방패)가 실루엣의 핵심이다. 크기 기준(measure.ts SIZE_RULE): 방패는 앞 ±60° 안(1.55r까지), 어깨 판 · 등판은 옆 1.05r · 뒤 1.0r 안.
// 방패는 층을 나눠(sk.layer) 굵은 외곽선이 몸 위에 그어지게 해서 작은 크기에서도 몸과 갈린다. 두 손은(보통 · 능력) 방패 안쪽 손잡이를
// 쥐고 방패와 같은 층에 그려, 헬멧과 방패 사이 틈에 주먹이 보인다(방패가 몸에서 떠 보이지 않게).
// 위 그림의 네온 포인트는 방패 테두리의 밝은 보라 선(글자용 역할색)뿐이다. 정면 그림은 방패 문장(십자)만 밝은 보라 네온으로 두고,
// 시설과 같은 청록 네온(survivorBase frontNeon: #22D3EE 번짐 + #67E8F9 심)을 방패 안선 · 헬멧 챙 바이저 선 · 어깨 판 아래 테 ·
// 문장 가운데 징(발광)에 가늘게 넣는다 — 어두운 시설 · 청록 네온 분위기에 맞추되 갑옷 · 문장은 역할색 보라가 주인공. 위 그림(게임
// 화면)에는 청록을 넣지 않는다(게임 화면에서 청록은 시설 · 목표 뜻).
// 색은 역할색 보라(#A855F7)와 그 짙은/밝은 변형, 어두운 남회색 바지 · 장갑 · 장화 · 방패 테.
import { NEON, NEON_DIM, NEON_TEXT, OUTLINE, ROLE, ROLE_TEXT } from '../palette';
import { SIZE_RULE } from './measure';
import {
  Sketch,
  apply,
  linear,
  mix,
  mul,
  path,
  radial,
  rotateAbout,
  shade,
  solid,
  tint,
  transformDrawing,
  translate,
  type Drawing,
  type Paint,
} from './kit';
import {
  FRONT,
  MAT,
  TOP,
  domePaint,
  frontArm,
  frontBreath,
  frontClothPaint,
  frontLegs,
  frontNeon,
  frontTorsoPath,
  inkFor,
  topRig,
  topShoe,
  topTorsoPath,
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

/** 가드 색 */
export const GUARD_COLOR = {
  armor: ROLE.guard,
  /** 짙은 보라 (갑옷 그늘 · 방패 안쪽) */
  deep: 0x581c87,
  /** 보라 네온 (위 그림 방패 테 · 정면 방패 문장 — 밝은 보라, 글자용 역할색). 정면의 다른 네온은 청록(frontNeon) */
  neon: ROLE_TEXT.guard,
  /** 방패 테 · 장갑 · 끈 (어두운 남회색 금속) */
  steel: 0x2b3646,
  pants: 0x253041,
  boot: 0x1b2430,
  sole: 0x0f151d,
  /** 장갑: 방패 테(steel)와 갈리게 한 단 밝게 (방패를 쥔 주먹이 헬멧 · 방패 사이 짙은 틈에서 보이게) */
  glove: tint(0x2b3646, 0.12),
} as const;

const C = GUARD_COLOR;

/** 가드 어깨 반폭: 공통 체형 그대로 (넓은 어깨는 어깨 판이 말한다 — 옆으로 커 보이지 않게) */
const HALF_W = TOP.halfW;

/**
 * 위에서 본 방패 모양 (호 중심 = 몸 중심에서 앞으로 dx): 바깥 · 안 반지름(가운데 · 끝), 반각, 방향.
 * 가운데가 두툼하고 끝으로 갈수록 얇은 초승달, 끝은 조금 바깥으로 젖힌 날개 — 끝 둥근 캡이 작아 앞 ±60° 안에서 몸 앞을
 * 넓게 감싼다
 */
interface ShieldShape {
  dx: number;
  ro: number;
  roEnd: number;
  ri: number;
  riEnd: number;
  half: number;
  rot: number;
}

/** 각 a(−half~half)에서 가운데 값 → 끝 값 (제곱으로 이어 가운데는 둥근 호에 가깝다) */
function shieldR(s: ShieldShape, a: number, mid: number, end: number): number {
  const u = a / s.half;
  return mid + (end - mid) * u * u;
}

const shieldOuter = (s: ShieldShape, a: number): number => shieldR(s, a, s.ro, s.roEnd);
const shieldInner = (s: ShieldShape, a: number): number => shieldR(s, a, s.ri, s.riEnd);

/** 끝이 둥근 초승달 띠 (방패 위 테). outer · inner = 각 → 반지름. 방향 rot = 0이면 앞(+x)을 향한다 */
function bandPath(s: ShieldShape, outer: (a: number) => number, inner: (a: number) => number): string {
  const h = s.half;
  const at = (a: number, rr: number): [number, number] => [Math.cos(a) * rr, Math.sin(a) * rr];
  const edge = (f: (a: number) => number, a0: number, a1: number): [number, number][] =>
    Array.from({ length: 13 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / 12;
      return at(a, f(a));
    });
  // 끝 캡: 그 각의 바깥 · 안 반지름 가운데에 놓인 반원
  const cap = (a: number): { c: [number, number]; t: number } => ({
    c: at(a, (outer(a) + inner(a)) / 2),
    t: (outer(a) - inner(a)) / 2,
  });
  const c1 = cap(h);
  const c0 = cap(-h);
  return path(rotateAbout(s.rot, 0, 0))
    .with(translate(s.dx, 0))
    .curve(edge(outer, -h, h))
    .arc(c1.c[0], c1.c[1], c1.t, h, h + Math.PI, false)
    .curve(edge(inner, h, -h), 1, false)
    .arc(c0.c[0], c0.c[1], c0.t, -h + Math.PI, -h + Math.PI * 2, false)
    .Z().d;
}

/** 위에서 본 방패: 짙은 보라 안쪽 + 밝은 위 테 + 바깥 네온 선. glow = 네온 세기 0~1 */
function topShield(sk: Sketch, s: ShieldShape, ink: Ink, glow: number): void {
  const d = bandPath(
    s,
    (a) => shieldOuter(s, a),
    (a) => shieldInner(s, a),
  );
  sk.part(
    d,
    radial(s.dx, 0, s.ro, [
      [0, ink(C.deep)],
      [(s.ri - 0.02) / s.ro, ink(shade(C.armor, 0.3))],
      [(s.ri + s.ro) / 2 / s.ro, ink(mix(tint(C.armor, 0.12), C.neon, 0.6 * glow))],
      [1, ink(mix(C.armor, C.neon, 0.7 * glow))],
    ]),
    ink(OUTLINE),
  );
  // 안쪽 그늘 띠 (방패 뒷면이 보이는 쪽)
  sk.fill(
    bandPath(
      s,
      (a) => shieldInner(s, a) + 0.04,
      (a) => shieldInner(s, a),
    ),
    solid(ink(shade(C.deep, 0.2))),
    0.85,
  );
  // 바깥 네온 선 (방패 테 · 바깥 끝을 넘지 않게 안쪽에)
  const rimR = (a: number): number => shieldOuter(s, a) - 0.075 - 0.05 * glow;
  const rim = path(rotateAbout(s.rot, 0, 0))
    .with(translate(s.dx, 0))
    .curve(
      Array.from({ length: 11 }, (_, i): [number, number] => {
        const a = s.half * 0.9 * (i / 5 - 1);
        return [Math.cos(a) * rimR(a), Math.sin(a) * rimR(a)];
      }),
    ).d;
  sk.line(rim, solid(ink(C.neon), 0.3 + 0.5 * glow), 0.1 + 0.12 * glow);
  sk.line(rim, solid(ink(tint(C.neon, 0.35 + 0.45 * glow))), 0.045);
}

/** 갑옷 돔 음영: 공통 domePaint보다 가장자리를 덜 어둡게 (작은 크기에서 몸 덩어리가 밝게 꽉 차 보이게) */
function armorDome(base: number, ink: Ink, reach: number, cx = 0, cy = 0): Paint {
  return radial(cx, cy, reach, [
    [0, ink(tint(base, 0.14))],
    [0.5, ink(base)],
    [0.88, ink(shade(base, 0.16))],
    [1, ink(shade(base, 0.28))],
  ]);
}

/** 위에서 본 방패 치수 (가운데 · 끝 반지름, 반각): 보통 · 수감(끌어안은 작은 호) · 구조 중(왼쪽으로 비킨 좁은 호) */
const SHIELD_FREE = { ro: 1.36, roEnd: 1.44, ri: 0.8, riEnd: 1.08, half: 0.86 } as const;
const SHIELD_CAPTIVE = { ro: 1.1, roEnd: 1.1, ri: 0.76, riEnd: 0.88, half: 0.74 } as const;
const SHIELD_REACH = { ro: 1.3, roEnd: 1.3, ri: 0.84, riEnd: 1.0, half: 0.52 } as const;

type ShieldSize = Omit<ShieldShape, 'dx' | 'rot'>;

/** 방패 끝 캡이 머물 앞 부채꼴 반각: 크기 기준 앞 ±60°(그 밖은 옆 1.05r · 뒤 1.0r)에서 곡선 샘플 · 캡 근사 여유 0.012rad를 뺐다 */
const SHIELD_CONE = SIZE_RULE.survivor.sector - 0.012;

/**
 * 방패를 앞으로 off만큼 민다(+, 앞으로 옮김) · 당긴다(−, 몸 중심 쪽으로 줄이는 배율). 앞으로 옮기거나 배율을 바꾸면
 * 몸 중심에서 본 각이 넓어지지 않아 방패 끝이 앞 ±60° 밖으로 나가지 않는다
 */
function shieldAt(b: ShieldSize, off: number, rot: number): ShieldShape {
  const k = off < 0 ? 1 + off / ((b.ro + b.ri) / 2) : 1;
  return {
    dx: Math.max(0, off),
    ro: b.ro * k,
    roEnd: b.roEnd * k,
    ri: b.ri * k,
    riEnd: b.riEnd * k,
    half: b.half,
    rot,
  };
}

/** 방패 돌림을 잘라 끝 둥근 캡까지 앞 부채꼴 안에 둔다 (캡 끝 각 = 반각 + 돌림 + asin(캡 / 캡 중심 거리), 앞으로 옮김은 각을 줄인다) */
function clampShieldRot(sh: ShieldShape): ShieldShape {
  const rm = (sh.roEnd + sh.riEnd) / 2;
  const t = (sh.roEnd - sh.riEnd) / 2;
  const max = Math.max(0, SHIELD_CONE - sh.half - Math.asin(Math.min(1, t / rm)));
  return { ...sh, rot: Math.max(-max, Math.min(max, sh.rot)) };
}

/** 능력 중 버팀 자세 발 자리 (왼발 앞 · 오른발 뒤) */
const BRACE_FEET: readonly [readonly [number, number], readonly [number, number]] = [
  [0.3, -0.34],
  [-0.34, 0.34],
];

/** 걸음 비틀림 · 피격 젖힘 배율 (공통 체형 대비) */
const STIFF = { twist: 0.6, recoil: 0.5 } as const;

/**
 * 등 갑옷 판 (몸 뒤 타원): 가운데 x · 앞뒤 반폭 · 옆 반폭. 뒤 끝 −0.97, 몸 중심에서 가장 먼 점 약 0.99r (젖혀도 1.0r 안).
 * seam = 등 이음 선 (뒤 끝에서 안쪽으로 · 판 가운데에서 뒤로 떨어진 거리, 앞쪽은 몸통이 덮는다)
 */
const BACK_PLATE = { cx: -0.27, rx: 0.7, ry: 0.88, seam: [0.1, 0.15] } as const;

/** 안쪽 가는 선 굵기 (외곽선 배수): 판끼리 갈리는 선을 옅게 — 큰 그림에서 판이 겹겹이 복잡해 보이지 않게 */
const INNER = 0.2;

/** 방패 손잡이 자리: 방패 안쪽 테에서 몸 쪽으로 (손 반지름 0.19의 바깥 반을 방패가 덮는다), 손잡이 각 */
const GRIP = { inset: 0.06, angle: 0.36 } as const;

/**
 * 어깨 갑옷 판: 어깨 자리에서 앞으로 dx, 옆 자리 배율 ky, 앞뒤 · 옆 반폭. 몸 테를 따라 앞뒤로 긴 판이라 옆으로 넓다
 * (러너와 실루엣이 갈린다). 가장 먼 점(약 1.0r)은 앞쪽 옆(1.05r 기준)이고, 비틀고 젖혀도 뒤쪽 반은 1.0r 안
 */
const PAD = { dx: 0.08, ky: 0.977, rx: 0.46, ry: 0.2 } as const;

/** 능력 동작 → 방패 앞뒤 이동: 0.5 = 뒤로 당겨 힘을 모음, 1 = 앞으로 쭉 */
function shoveOffset(a: number): number {
  if (a <= 0.5) return -0.2 * (a / 0.5);
  const k = (a - 0.5) / 0.5;
  return -0.2 + 0.31 * (1 - (1 - k) * (1 - k));
}

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const a = p.action;
  const free = p.mode === 'free';
  const captive = p.mode === 'captive';
  const r = topRig(p, captive ? HALF_W * 0.94 : HALF_W);
  const s = r.s;
  // 무거운 갑옷: 걸음 비틀림 · 피격 젖힘을 공통 체형보다 작게 (단단한 인상, 넓은 어깨 판이 옆 · 뒤 기준 안에 머문다)
  const ox = r.ox * STIFF.recoil;
  r.head = [r.head[0] + ox - r.ox, r.head[1]];
  r.ox = ox;
  r.twist *= STIFF.twist;
  const push = free ? shoveOffset(a) : 0;
  // 힘을 모을 때 방패를 조금 비스듬히 + 몸통을 비튼다 (왼쪽 어깨를 앞으로), 내지르면 다시 정면
  const load = free ? Math.sin(Math.PI * Math.min(1, a / 0.75)) : 0;
  const coil = -0.08 * load;
  r.twist += -0.12 * load;
  // 몸 기울임: 당길 때 머리가 뒤로, 내지를 때 앞으로 (몸이 방패 쪽으로 쏠린다)
  r.head = [r.head[0] + push * 0.9, r.head[1]];
  const tw = rotateAbout(r.twist, 0, 0);
  // 1) 장화: 걸음 자리에서 능력 중엔 버팀 자세(왼발 앞 · 오른발 뒤)로 옮긴다. 젖혀도 뒤 1.0r 안에 들게 걸음 폭을 조금 좁힌다
  const brace = free ? Math.min(1, a * 2) : 0;
  const feet = r.feet.map(([fx, fy], i): [number, number] => {
    const [bx, by] = BRACE_FEET[i === 0 ? 0 : 1];
    return [fx * 0.9 + (bx - fx * 0.9) * brace, fy + (by - fy) * brace];
  });
  for (const [fx, fy] of feet) topShoe(sk, fx + r.ox, fy, C.boot, C.sole, ink, 0.26);
  // 몸 변환 (비틀림 · 젖힘): 어깨 판 · 팔이 같이 쓴다
  const body = mul(tw, translate(r.ox, 0));
  // 방패 자리: 보통 = 몸 앞 두꺼운 호, 구조 = 앞에 둔 채 왼쪽으로 비킴(오른손이 자물쇠로), 수감 = 앞에 끌어안은 작은 호.
  // 어느 때든 방패는 앞쪽에 있다 → 바라보는 방향 단서가 뒤집히지 않는다. 당기기 · 젖힘은 몸 중심 쪽으로 줄이는 배율,
  // 내지르기는 앞으로 옮김으로 그리고(둘 다 몸 중심에서 본 각을 넓히지 않는다), 돌림은 끝 캡이 앞 ±60° 안에 들게 자른다
  const shield = clampShieldRot(
    p.mode === 'reach'
      ? shieldAt(SHIELD_REACH, r.ox, -0.33 + r.twist * 0.25)
      : captive
        ? shieldAt(SHIELD_CAPTIVE, r.ox, 0)
        : shieldAt(SHIELD_FREE, r.ox - 0.05 * p.hit + push, 0.05 * s + 0.08 * p.hit + coil),
  );
  // 2) 등 갑옷 판: 몸 뒤 · 옆을 둥글게 감싸는 큰 판 — 위에서 판정 원을 꽉 채운 '단단한 체격'.
  // 젖힐 때는 앞 끝만 몸을 따라가고 뒤 끝은 제자리다 (뒤로 판정보다 커 보이지 않게). 수감 중엔 어깨와 함께 움츠린다
  const bcx = BACK_PLATE.cx + r.ox / 2;
  const brx = BACK_PLATE.rx + r.ox / 2;
  sk.part(
    path(tw).ellipse(bcx, 0, brx, BACK_PLATE.ry * (r.halfW / HALF_W)).d,
    armorDome(shade(C.armor, 0.1), ink, 0.95, bcx, 0),
    ink(OUTLINE),
    undefined,
    INNER,
  );
  sk.line(
    path(tw)
      .M(bcx - brx + BACK_PLATE.seam[0], 0)
      .L(bcx - BACK_PLATE.seam[1], 0).d,
    solid(ink(shade(C.armor, 0.32))),
    0.035,
  );
  // 3) 몸통 (보라 갑옷)
  sk.part(
    topTorsoPath(r),
    armorDome(shade(C.armor, 0.1), ink, r.halfW * 1.1),
    ink(OUTLINE),
    undefined,
    INNER,
  );
  // 4) 팔 (소매만, 손은 방패 층에): 보통 · 능력 = 두 손이 방패 안쪽 손잡이를 쥔다(걸으면 방패와 함께 흔들린다).
  //    손 자리는 그림 좌표 그대로(몸 변환 없이) 방패 위에 둔다
  const gripAt = (ang: number): [number, number] => {
    const g = shieldInner(shield, ang) - GRIP.inset;
    const c = Math.cos(shield.rot);
    const sn = Math.sin(shield.rot);
    const [x, y] = [shield.dx + Math.cos(ang) * g, Math.sin(ang) * g];
    return [x * c - y * sn, x * sn + y * c];
  };
  const hands: [[number, number], [number, number]] = free
    ? [gripAt(-GRIP.angle), gripAt(GRIP.angle)]
    : p.mode === 'reach'
      ? // 구조 중: 왼손은 방패 손잡이, 오른손만 헬멧 앞 오른쪽으로 쭉 뻗어 자물쇠를 만진다 (방패 끝 옆으로 보이게)
        [gripAt(-0.1), apply(body, r.head[0] + r.headR + 0.14, 0.5)]
      : // 수감: 방패를 끌어안고 두 손을 그 안쪽에 모은다 (헬멧 밖으로 보이게)
        [apply(body, 0.56, -0.46), apply(body, 0.56, 0.46)];
  for (const side of [0, 1] as const) {
    const [sx, sy] = apply(body, ...r.shoulders[side]);
    const [hx, hy] = hands[side];
    sk.part(
      path().capsule(sx, sy, hx, hy, 0.3, 0.26).d,
      domePaint(C.armor, ink, 1.05),
      ink(OUTLINE),
      undefined,
      INNER,
    );
  }
  // 5) 큰 어깨 갑옷 (두 겹 판, 헬멧보다 한 단 어둡게 — 헬멧이 가장 밝은 중심)
  for (const side of [0, 1] as const) {
    // 판 가운데는 어깨보다 조금 앞 · 안쪽 (젖혀도 바깥 끝이 뒤 1.0r 안에 들게), 앞뒤로 긴 타원
    const [sx, sy] = r.shoulders[side];
    const px = sx + PAD.dx;
    const py = sy * PAD.ky;
    const pd = path(body).ellipse(px, py, PAD.rx, PAD.ry).d;
    sk.part(
      pd,
      armorDome(shade(C.armor, 0.08), ink, PAD.rx * 1.1, px - 0.02 + r.ox, py * 0.95),
      ink(OUTLINE),
      undefined,
      INNER,
    );
    // 두 겹 판 이음 (옅은 호)
    const sgn = side === 0 ? -1 : 1;
    sk.line(
      path(body).arc(
        px,
        py,
        PAD.rx * 0.66,
        (sgn * Math.PI) / 2 - 1.1,
        (sgn * Math.PI) / 2 + 1.1,
        true,
        PAD.ry * 0.58,
      ).d,
      solid(ink(shade(C.armor, 0.18))),
      0.03,
    );
  }
  // 6) 헬멧: 보라 돔 + 가운데 볏 + 앞 챙
  const [hx, hy] = r.head;
  const R = r.headR * 1.02;
  sk.part(path().circle(hx, hy, R).d, domePaint(C.armor, ink, R * 1.2, hx - 0.04, hy), ink(OUTLINE));
  // 앞 챙 (어두운 보라 띠)
  sk.fill(
    path()
      .arc(hx, hy, R * 0.97, -1.05, 1.05)
      .arc(hx, hy, R * 0.66, 0.9, -0.9, false)
      .Z().d,
    solid(ink(C.deep)),
  );
  // 볏 (뒤 → 앞 가운데 솟은 판, 앞이 뾰족): 빛 받는 위쪽 반은 밝게, 아래쪽 반은 그늘 (역할색에 가까운 두 단)
  const crestHalf = (side: -1 | 1, w: number): string =>
    path()
      .M(hx - R * 0.95, hy)
      .Q(hx - R * 0.2, hy + side * w, hx + R * 0.75, hy)
      .Z().d;
  sk.fill(crestHalf(-1, 0.2), solid(ink(tint(C.armor, 0.2))));
  sk.fill(crestHalf(1, 0.12), solid(ink(shade(C.armor, 0.16))));
  // 7) 손 + 방패 (몸 앞, 따로 층): 방패 외곽선이 헬멧 · 몸 위에 굵게. 손은 방패보다 먼저 칠해 바깥 반을 방패가 덮고,
  //    굵은 외곽선 대신 가는 테만 둘러 헬멧 · 방패 사이 짙은 틈에 주먹이 보인다(굵은 외곽선은 헬멧을 깨문 듯 파고든다)
  sk.layer();
  for (const [hx2, hy2] of hands) {
    const fist = path().circle(hx2, hy2, TOP.handR).d;
    sk.fill(
      fist,
      radial(hx2 - 0.04, hy2 - 0.04, TOP.handR * 1.3, [
        [0, ink(tint(C.glove, 0.18))],
        [1, ink(shade(C.glove, 0.2))],
      ]),
    );
    sk.line(fist, solid(ink(OUTLINE)), sk.w * 0.6);
  }
  topShield(sk, shield, ink, free ? Math.max(0, (a - 0.5) / 0.5) : 0);
  return sk.drawing();
}

/** 정면 방패 (위 평평 · 아래 뾰족한 옛 방패 문양): 중심 x, 위 y, 반폭, 높이 */
function frontShieldPath(cx: number, y0: number, hw: number, h: number): string {
  const yb = y0 + h * 0.5;
  return path()
    .M(cx - hw, y0 + 0.04)
    .Q(cx, y0 - 0.04, cx + hw, y0 + 0.04)
    .L(cx + hw, yb)
    .C(cx + hw, yb + h * 0.28, cx + hw * 0.45, y0 + h * 0.9, cx, y0 + h)
    .C(cx - hw * 0.45, y0 + h * 0.9, cx - hw, yb + h * 0.28, cx - hw, yb)
    .Z().d;
}

/** 정면 다리 벌림 (버티고 선 자세) */
const LEG_SPREAD = 0.08;

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const neon = frontNeon(sk, p.tone);
  const by = frontBreath(p.t);
  const sb = Math.sin(p.t * 1.6) * 0.008;
  const SX = 0.36;
  // 1) 다리 (어두운 바지) + 무릎 보호대 + 무거운 장화
  if (!p.bust) {
    frontLegs(sk, C.pants, C.boot, C.sole, ink, LEG_SPREAD, 0.17);
    for (const s of [-1, 1]) {
      const x = s * (FRONT.legX + LEG_SPREAD);
      sk.part(
        path().roundRect(x - 0.085, 0.62, 0.17, 0.12, 0.05).d,
        frontClothPaint(C.armor, ink),
        ink(OUTLINE),
        1,
        0.3,
      );
    }
  }
  // 방패 자리 (몸 가운데 쪽으로, 몸통의 약 65%를 가린다)
  const cx = 0.11;
  const y0 = 0.0 + by + sb;
  const hw = 0.39;
  const h = 0.84;
  // 2) 팔 (화면 왼쪽 = 빈 주먹, 화면 오른쪽 = 방패 손잡이를 쥔 팔 — 주먹이 방패 가장자리 밖으로 반쯤 보인다)
  frontArm(sk, 1, C.armor, C.glove, ink, [cx + hw + 0.05, y0 + 0.32], by, 0.19);
  frontArm(sk, -1, C.armor, C.glove, ink, [-0.47, 0.38 + by], by, 0.19);
  // 3) 몸통 (보라 갑옷 조끼) + 허리띠
  sk.part(frontTorsoPath(by, SX, 0.28), frontClothPaint(C.armor, ink), ink(OUTLINE));
  sk.fill(path().roundRect(-0.27, FRONT.hipY - 0.1, 0.54, 0.07, 0.02).d, solid(ink(C.steel)));
  sk.fill(path().roundRect(-0.05, FRONT.hipY - 0.105, 0.1, 0.08, 0.02).d, solid(ink(shade(C.armor, 0.2))));
  // 가슴판 갈래 (가운데 이음)
  sk.line(
    path()
      .M(0, FRONT.neckY + 0.06 + by)
      .L(0, FRONT.hipY - 0.12).d,
    solid(ink(shade(C.armor, 0.3))),
    0.025,
  );
  // 4) 어깨 갑옷 (두 겹 둥근 판)
  for (const s of [-1, 1]) {
    const px = s * (SX - 0.02);
    const py = FRONT.shoulderY + 0.06 + by;
    const pad = radial(px - 0.06, py - 0.08, 0.26, [
      [0, ink(tint(C.armor, 0.28))],
      [0.6, ink(C.armor)],
      [1, ink(shade(C.armor, 0.35))],
    ]);
    sk.part(
      path()
        .M(px - 0.18, py + 0.07)
        .Q(px - 0.17, py - 0.15, px, py - 0.15)
        .Q(px + 0.17, py - 0.15, px + 0.18, py + 0.07)
        .Q(px, py + 0.03, px - 0.18, py + 0.07)
        .Z().d,
      pad,
      ink(OUTLINE),
    );
    sk.line(
      path()
        .M(px - 0.15, py + 0.0)
        .Q(px, py - 0.06, px + 0.15, py + 0.0).d,
      solid(ink(shade(C.armor, 0.35))),
      0.02,
    );
    // 어깨 판 아래 테 (청록 네온 솔기)
    neon.line(
      path()
        .M(px - 0.14, py + 0.05)
        .Q(px, py + 0.015, px + 0.14, py + 0.05).d,
      0.011,
      0.55,
    );
  }
  // 5) 머리 + 헬멧
  const hy = FRONT.headY + by;
  const hr = FRONT.headR;
  // 얼굴
  sk.part(
    path().circle(0, hy + 0.02, hr * 0.96).d,
    radial(-0.1, hy - 0.08, hr * 1.25, [
      [0, ink(tint(MAT.skin, 0.12))],
      [0.7, ink(MAT.skin)],
      [1, ink(MAT.skinShade)],
    ]),
    ink(OUTLINE),
  );
  // 눈 (굳은 눈매: 짧고 굵은 눈썹이 아래로)
  for (const s of [-1, 1]) {
    sk.fill(path().ellipse(s * 0.12, hy + 0.1, 0.042, 0.055).d, solid(ink(MAT.eye)));
    sk.fill(path().circle(s * 0.12 - 0.012, hy + 0.08, 0.015).d, solid(ink(0xffffff), 0.9));
    sk.line(
      path()
        .M(s * 0.2, hy + 0.0)
        .L(s * 0.06, hy + 0.035).d,
      solid(ink(MAT.eye)),
      0.035,
    );
  }
  sk.line(
    path()
      .M(-0.05, hy + 0.21)
      .L(0.05, hy + 0.21).d,
    solid(ink(MAT.skinShade)),
    0.022,
  );
  // 헬멧 (돔 + 볼 가리개). 얼굴 위쪽 · 옆을 덮는다
  const helm = path()
    .M(-hr * 1.08, hy + 0.2)
    .L(-hr * 1.1, hy - 0.05)
    .C(-hr * 1.1, hy - hr * 1.2, hr * 1.1, hy - hr * 1.2, hr * 1.1, hy - 0.05)
    .L(hr * 1.08, hy + 0.2)
    .Q(hr * 0.9, hy + 0.24, hr * 0.78, hy + 0.17)
    .L(hr * 0.74, hy - 0.02)
    .Q(0, hy - 0.08, -hr * 0.74, hy - 0.02)
    .L(-hr * 0.78, hy + 0.17)
    .Q(-hr * 0.9, hy + 0.24, -hr * 1.08, hy + 0.2)
    .Z().d;
  sk.part(
    helm,
    radial(-0.14, hy - 0.26, 0.62, [
      [0, ink(tint(C.armor, 0.3))],
      [0.45, ink(C.armor)],
      [0.85, ink(shade(C.armor, 0.28))],
      [1, ink(shade(C.armor, 0.45))],
    ]),
    ink(OUTLINE),
  );
  // 챙 (어두운 띠 + 청록 네온 바이저 선)
  const brim = path()
    .M(-hr * 0.98, hy - 0.04)
    .Q(0, hy - 0.13, hr * 0.98, hy - 0.04).d;
  sk.line(brim, solid(ink(C.deep)), 0.06);
  neon.line(brim, 0.014, 0.75);
  // 챙 위 가로 홈 (시설 경비대 헬멧 느낌)
  sk.line(
    path()
      .M(-hr * 0.8, hy - 0.13)
      .Q(0, hy - 0.21, hr * 0.8, hy - 0.13).d,
    solid(ink(C.deep)),
    0.03,
  );
  // 볏 (가운데 솟은 판, 실루엣에 보인다)
  sk.part(
    path()
      .M(-0.07, hy - hr * 0.88)
      .Q(-0.06, hy - hr * 1.1, 0.03, hy - hr * 1.12)
      .Q(0.08, hy - hr * 1.02, 0.07, hy - hr * 0.88)
      .Z().d,
    linear(-0.06, 0, 0.06, 0, [
      [0, ink(tint(C.armor, 0.35))],
      [1, ink(shade(C.armor, 0.2))],
    ]),
    ink(OUTLINE),
  );
  // 6) 큰 방패 (따로 층: 몸 앞에 떠 있다)
  sk.layer();
  const sh = frontShieldPath(cx, y0, hw, h);
  sk.part(
    sh,
    linear(cx - hw, y0, cx + hw, y0 + h * 0.7, [
      [0, ink(shade(C.armor, 0.05))],
      [0.5, ink(shade(C.armor, 0.3))],
      [0.5, ink(C.deep)],
      [1, ink(shade(C.deep, 0.35))],
    ]),
    ink(OUTLINE),
  );
  // 테 (어두운 금속) + 청록 네온 안선
  sk.line(sh, solid(ink(C.steel)), 0.07);
  const inner = frontShieldPath(cx, y0 + 0.055, hw - 0.055, h - 0.11);
  neon.line(inner, 0.013, 0.7);
  // 문장: 십자 (밝은 보라 네온 — 역할색 문장) + 가운데 둥근 징 (청록 발광)
  const ey = y0 + h * 0.4;
  const cross = path()
    .M(cx, y0 + 0.13)
    .L(cx, y0 + h - 0.2)
    .M(cx - 0.19, ey)
    .L(cx + 0.19, ey).d;
  sk.line(cross, solid(ink(C.deep)), 0.11);
  sk.line(cross, solid(ink(C.neon), 0.45), 0.075);
  sk.line(cross, solid(ink(tint(C.neon, 0.5))), 0.03);
  sk.part(
    path().circle(cx, ey, 0.055).d,
    radial(cx - 0.015, ey - 0.02, 0.07, [
      [0, ink(NEON_TEXT)],
      [0.55, ink(NEON)],
      [1, ink(NEON_DIM)],
    ]),
    ink(OUTLINE),
    1,
    0.3,
  );
  // 방패 위 반사 (왼쪽 위 빛)
  sk.line(
    path()
      .M(cx - hw + 0.1, y0 + 0.12)
      .L(cx - hw + 0.1, y0 + 0.36).d,
    solid(ink(0xffffff), 0.35),
    0.025,
  );
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
  if (!p.bust) return frontBody(p, o);
  // 상반신: 헬멧 · 어깨 · 방패 윗부분(문장)이 상자를 채우게 1.45배 (외곽선 굵기는 그대로)
  const k = 1.45;
  return transformDrawing(frontBody(p, { w: o.w / k }), k, -0.05, 0.36);
}

export const GUARD_ART: SurvivorArt = {
  id: 'guard',
  top: (p, o) => top(cleanSurvivorPose(p), o),
  front: (p, o) => front(cleanFrontPose(p), o),
  /** 실제 최대 반쪽 크기 1.47 (밀치기 절정 방패 앞 끝, 가장 먼 점 반지름 1.51) + 여유 */
  topExtent: 1.52,
};
