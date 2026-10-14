// 러너 새 캐릭터 (캐릭터 리디자인): 깊게 눌러쓴 파랑 후드티 + 큰 운동화. 가볍고 빠른 인상.
// 위에서 보면 어깨 판과 앞으로 나온 둥근 후드 머리가 한 볼록 덩어리로 이어진다(목 잘록함 · 평행한 옆선 · 몸 옆 둥근 혹 없이
// 어깨에서 얼굴까지 계속 좁아지는 달걀꼴). 후드 앞 구멍 안에 살색 얼굴과 눈 둘이 보이고, 얼굴은 짙은 안감 테와 네온 챙
// 선이 사방에서 둘러싼다('후드 속 얼굴' — 살색이 머리 끝 전체를 덮지 않는다). '얼굴 쪽 = 앞'이 바라보는 방향 단서다.
// 후드 끝은 등 위로 늘어진 천처럼 뒤로 흐른다: 끝이 둥글고 가늘며 한쪽으로 휘고 걸음마다 출렁여 뒤를 가리키는 화살촉으로
// 읽히지 않는다(뒤 1.0r 안이라 실루엣 밖으로는 거의 나오지 않는다).
// 정면 그림(로비 역할 카드 · 결과 화면)은 3/4 시점: 몸 · 얼굴이 화면 오른쪽(달리는 쪽)을 비스듬히 보고, 후드 끝은 왼쪽 뒤로
// 흐른다. 네온 포인트는 후드 테두리의 밝은 파랑 선(위 · 정면)과 가슴의 » 갈매기 무늬 · 후드 끈(정면)뿐이다.
// 색은 역할색 파랑(#3B82F6)과 그 짙은/밝은 변형, 어두운 남회색 바지 · 신발, 밝은 회색 밑창, 얼굴 피부색.
import { OUTLINE, ROLE } from '../palette';
import {
  IDENTITY,
  Sketch,
  apply,
  linear,
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
  type Mat,
  type Paint,
} from './kit';
import {
  FRONT,
  MAT,
  TOP,
  frontBreath,
  frontClothPaint,
  inkFor,
  topRig,
  type Ink,
  type TopRig,
} from './survivorBase';
import {
  cleanFrontPose,
  cleanSurvivorPose,
  type ArtOptions,
  type FrontPose,
  type SurvivorArt,
  type SurvivorPose,
} from './types';

/** 러너 색 */
export const RUNNER_COLOR = {
  hoodie: ROLE.runner,
  /** 후드 안 그늘 · 짙은 파랑 */
  deep: 0x1e3a8a,
  /** 네온 테두리 (밝은 파랑, 글자용 역할색) */
  neon: 0x60a5fa,
  pants: 0x253041,
  shoe: 0x2b3646,
  /** 밝은 밑창 (작은 면적이라 순백 대신 밝은 회색) */
  sole: 0xcbd5e1,
  glove: 0x334155,
  hair: 0x1b2430,
} as const;

const C = RUNNER_COLOR;

type Pt = [number, number];

/**
 * 위 그림 후드 (몸 반지름 배수): 머리 앞뒤 반지름 = 공통 머리 × k, 옆 반지름 = 앞뒤 × ky (조금 앞뒤로 긴 둥근 머리),
 * 머리 중심을 앞으로 내미는 정도 dx, 머리 앞 끝 한도 front(그늘 몫까지 앞 1.55r 안).
 * 꼬리(후드 끝 천): 끝 x(서기, 몸 중심 기준 — 둥근 끝까지 뒤 1.0r 안), 뿌리 · 끝 반폭, 가늘어지는 빠르기(뿌리가 머리 뒤에
 * 매끈하게 이어지는 물방울꼴), 한쪽으로 휜 정도
 */
const HOOD = {
  k: 1.2,
  ky: 0.85,
  dx: 0.69,
  front: 1.48,
  tipX: -0.88,
  rootW: 0.6,
  tipW: 0.055,
  taper: 1.6,
  curl: 0.22,
} as const;

/** 위 그림 어깨 (몸 실루엣 뒤쪽의 둥근 판): 중심 x · 앞뒤 반지름 (옆 반지름 = 어깨 반폭). 등 끝 −0.93 */
const BACK = { cx: -0.07, rx: 0.86 } as const;

/**
 * 위 그림 얼굴 (후드 앞 구멍, 머리 반지름 배수 · 머리 중심 기준): 살색 얼굴 타원의 중심 x · 앞뒤 · 옆 반지름, 그 둘레 짙은
 * 안감 테 두께(얼굴을 사방에서 둘러싸 '후드 속 얼굴'로 읽힌다), 앞머리 술 깊이, 눈 자리(x · 옆) · 크기
 */
const FACE = {
  cx: 0.42,
  rx: 0.33,
  ry: 0.52,
  rim: 0.1,
  bang: 0.1,
  eyeX: 0.45,
  eyeY: 0.21,
  eye: 0.065,
} as const;

/** 후드 칠 (머리 중심에서 꼬리 끝까지 닿는 위 조명, 회전과 무관) */
function hoodPaint(ink: Ink, cx: number, cy: number, reach: number): Paint {
  return radial(cx, cy, reach, [
    [0, ink(tint(C.hoodie, 0.14))],
    [0.45, ink(C.hoodie)],
    [0.82, ink(shade(C.hoodie, 0.1))],
    [1, ink(shade(C.hoodie, 0.22))],
  ]);
}

/**
 * 위 그림 몸 · 소매 칠: 공통 돔 음영보다 가장자리를 덜 어둡게 (실제 크기에서 몸 테두리가 외곽선과 붙어 어두운 띠로
 * 읽히지 않게 — 판정 원을 밝은 몸이 채운다)
 */
function brightDome(base: number, ink: Ink, reach: number): Paint {
  return radial(0, 0, reach, [
    [0, ink(tint(base, 0.12))],
    [0.5, ink(base)],
    [0.85, ink(shade(base, 0.1))],
    [1, ink(shade(base, 0.2))],
  ]);
}

// ───────────────────────── 후드 (둥근 머리 + 흐르는 천 끝) ─────────────────────────

/** 후드 끝 등뼈: 3차 곡선 (뿌리 a → 조절점 b · c → 끝 d). 뿌리는 머리 원 안에 둔다 */
interface Spine {
  a: Pt;
  b: Pt;
  c: Pt;
  d: Pt;
}

/** 등뼈 위 점 · 단위 접선 */
function spineAt(s: Spine, t: number): { x: number; y: number; dx: number; dy: number } {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  const ex = 3 * u * u * (s.b[0] - s.a[0]) + 6 * u * t * (s.c[0] - s.b[0]) + 3 * t * t * (s.d[0] - s.c[0]);
  const ey = 3 * u * u * (s.b[1] - s.a[1]) + 6 * u * t * (s.c[1] - s.b[1]) + 3 * t * t * (s.d[1] - s.c[1]);
  const l = Math.hypot(ex, ey) || 1;
  return {
    x: k0 * s.a[0] + k1 * s.b[0] + k2 * s.c[0] + k3 * s.d[0],
    y: k0 * s.a[1] + k1 * s.b[1] + k2 * s.c[1] + k3 * s.d[1],
    dx: ex / l,
    dy: ey / l,
  };
}

/** 각을 (−π, π]로 */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * 후드 윤곽 (한 경로): 머리 원 (hx, hy, R)에 등뼈 s를 따라 반폭 w0(뿌리) → w1(끝)로 가늘어지는 천 띠를 붙인다(taper =
 * 가늘어지는 빠르기, 클수록 뿌리 가까이에서 좁아진다). 끝은 둥글다(뾰족한 화살촉 X). 머리 원은 꼬리 반대쪽(얼굴 쪽)을
 * 호로 돌고, 띠의 두 변은 원 밖으로 나온 부분만 잇는다
 */
function hoodPath(
  hx: number,
  hy: number,
  R: number,
  s: Spine,
  w0: number,
  w1: number,
  m: Mat = IDENTITY,
  taper = 2.2,
  n = 12,
): string {
  const sideA: Pt[] = [];
  const sideB: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const q = spineAt(s, t);
    const w = w1 + (w0 - w1) * (1 - t) ** taper;
    sideA.push([q.x + q.dy * w, q.y - q.dx * w]);
    sideB.push([q.x - q.dy * w, q.y + q.dx * w]);
  }
  // 변마다 원을 나서는 곳: 처음으로 원 밖에 있는 표본 번호 + 원 위 각 (앞 표본과 사이를 거리로 보간)
  const exit = (pts: readonly Pt[]): { i: number; ang: number } => {
    let prev: Pt = pts[0] ?? s.a;
    for (let i = 0; i < pts.length; i += 1) {
      const cur = pts[i] ?? prev;
      const r1 = Math.hypot(cur[0] - hx, cur[1] - hy);
      if (r1 > R) {
        const r0 = Math.hypot(prev[0] - hx, prev[1] - hy);
        const k = r1 > r0 ? Math.min(1, Math.max(0, (R - r0) / (r1 - r0))) : 0;
        const jx = prev[0] + (cur[0] - prev[0]) * k;
        const jy = prev[1] + (cur[1] - prev[1]) * k;
        return { i, ang: Math.atan2(jy - hy, jx - hx) };
      }
      prev = cur;
    }
    return { i: pts.length - 1, ang: Math.atan2(prev[1] - hy, prev[0] - hx) };
  };
  const phi = Math.atan2(s.d[1] - hy, s.d[0] - hx);
  const ea = exit(sideA);
  const eb = exit(sideB);
  // 꼬리 방향에서 +쪽 변(plus)에서 호를 시작해 얼굴 쪽을 돌아 −쪽 변(minus)에서 끝낸다
  const aPlus = wrap(ea.ang - phi) > wrap(eb.ang - phi);
  const plus = aPlus ? { e: ea, pts: sideA } : { e: eb, pts: sideB };
  const minus = aPlus ? { e: eb, pts: sideB } : { e: ea, pts: sideA };
  const a0 = phi + wrap(plus.e.ang - phi);
  const a1 = phi + wrap(minus.e.ang - phi) + Math.PI * 2;
  // 둥근 끝: −쪽 변 → 끝 → +쪽 변 (끝 접선 기준 ±45°)
  const e = spineAt(s, 1);
  const nm: Pt = minus.pts === sideA ? [e.dy, -e.dx] : [-e.dy, e.dx];
  const cap: Pt[] = [Math.PI / 4, 0, -Math.PI / 4].map((th): Pt => [
    e.x + w1 * (Math.cos(th) * e.dx + Math.sin(th) * nm[0]),
    e.y + w1 * (Math.cos(th) * e.dy + Math.sin(th) * nm[1]),
  ]);
  const chain: Pt[] = [...minus.pts.slice(minus.e.i), ...cap, ...plus.pts.slice(plus.e.i).reverse()];
  return path(m).arc(hx, hy, R, a0, a1).curve(chain, 1, false).Z().d;
}

/**
 * 위 그림 얼굴: 후드 앞 구멍(짙은 안감)이 살색 얼굴을 사방에서 둘러싼다 — 살색이 머리 끝 전체를 덮지 않고 짙은 테 안에 든
 * '후드 속 얼굴'로 읽힌다. 휴대폰 크기(몸 반지름 약 7px)에서 '앞 끝에 짙은 테로 둘러싼 밝은 살색'이 바라보는 방향 단서다.
 * 얼굴 뒤쪽은 앞머리 술 둘이 부드러운 물결로 내려오고, 구멍 테두리(후드 챙)에 네온 선. bow = 고개 숙임 (질주 · 수감: 위에서
 * 얼굴이 조금 덜 보인다), glow = 네온 밝기 (질주)
 */
function topFace(
  sk: Sketch,
  ink: Ink,
  hx: number,
  hy: number,
  R: number,
  bow: number,
  glow: number,
  m: Mat,
): void {
  const k = 1 - 0.12 * bow;
  // 숙이면 얼굴이 앞쪽으로 좁아진다 (앞 끝은 그대로)
  const rx = R * FACE.rx * k;
  const cx = hx + R * (FACE.cx + FACE.rx * (1 - k));
  const ry = R * FACE.ry;
  const rim = R * FACE.rim;
  // 1) 구멍 (후드 안감 · 챙 그늘: 짙은 남색 — 머리카락보다 후드 그늘로 읽힌다)
  const hole = path(m).ellipse(cx, hy, rx + rim, ry + rim).d;
  sk.fill(hole, solid(ink(shade(C.deep, 0.5))));
  // 2) 살색 얼굴. 빛은 위에서: 가장자리 쪽이 조금 어둡다
  sk.fill(
    path(m).ellipse(cx, hy, rx, ry).d,
    radial(cx + rx * 0.15, hy, Math.max(rx, ry) * 1.05, [
      [0, ink(tint(MAT.skin, 0.12))],
      [0.6, ink(MAT.skin)],
      [1, ink(MAT.skinShade)],
    ]),
  );
  // 3) 앞머리: 얼굴 뒤 가장자리(뒤 호)에서 술 둘이 앞으로 부드럽게 내려온 물결 (안감과 같은 짙은 남색이라 챙 그늘과 한
  //    덩어리 — 머리카락보다 후드 챙 그늘로 읽힌다)
  const side = Math.PI * 0.42;
  const sy = ry * Math.sin(side);
  const wave: Pt[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const y = -sy + 2 * sy * t;
    const back = cx - rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
    const dip = R * FACE.bang * (0.75 + 0.25 * Math.sin(2 * Math.PI * t) ** 2) * Math.sin(Math.PI * t) ** 0.7;
    wave.push([back + dip, hy + y]);
  }
  sk.fill(
    path(m)
      .arc(cx, hy, rx, Math.PI - side, Math.PI + side, true, ry)
      .curve(wave, 1, false)
      .Z().d,
    solid(ink(shade(C.deep, 0.5))),
  );
  // 4) 눈 둘
  for (const s of [-1, 1])
    sk.fill(
      path(m).ellipse(hx + R * FACE.eyeX, hy + s * R * FACE.eyeY, R * FACE.eye * 0.8, R * FACE.eye).d,
      solid(ink(MAT.eye)),
    );
  // 5) 후드 챙 네온 선 (구멍 테두리). 질주 때 밝아진다
  sk.line(hole, solid(ink(tint(C.neon, 0.25))), 0.06, 'round', 0.85 + 0.15 * glow);
}

// ───────────────────────── 위 그림 ─────────────────────────

/** 타원 위 점 n개 (변환 m) */
function ovalPts(cx: number, cy: number, rx: number, ry: number, m: Mat, n = 48): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return apply(m, cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  });
}

/** 점들의 볼록 껍질 (단조 사슬, 한 바퀴 순서) */
function convexHull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: readonly Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2] ?? q, out[out.length - 1] ?? q, q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
}

/** 닫힌 다각형을 둘레 길이로 고르게 n점 다시 뽑기 (긴 접선 변도 점이 고르게 놓여 매끄러운 곡선이 넘치지 않는다) */
function resample(poly: readonly Pt[], n: number): Pt[] {
  const m = poly.length;
  const at = (i: number): Pt => poly[i % m] ?? [0, 0];
  const lens = poly.map((a, i) => Math.hypot(at(i + 1)[0] - a[0], at(i + 1)[1] - a[1]));
  const total = lens.reduce((s, v) => s + v, 0);
  const out: Pt[] = [];
  let seg = 0;
  let acc = 0;
  for (let k = 0; k < n; k += 1) {
    const want = (k / n) * total;
    while (seg < m - 1 && acc + (lens[seg] ?? 0) < want) {
      acc += lens[seg] ?? 0;
      seg += 1;
    }
    const l = lens[seg] || 1;
    const u = Math.min(1, Math.max(0, (want - acc) / l));
    const a = at(seg);
    const b = at(seg + 1);
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

/** 위 그림 팔 (어깨 → 손 캡슐 + 손): 공통 topArm과 같은 자리, 칠만 밝은 돔 */
function topSleeve(sk: Sketch, r: TopRig, side: 0 | 1, sleeve: number, glove: number, ink: Ink): void {
  const [sx, sy] = r.shoulders[side];
  const [hx, hy] = r.hands[side];
  const m = rotateAbout(r.twist, 0, 0);
  const arm = path(m).with(translate(r.ox, 0)).capsule(sx, sy, hx, hy, 0.32, 0.28).d;
  sk.part(arm, brightDome(sleeve, ink, 1.1), ink(OUTLINE));
  const hand = path(m).with(translate(r.ox, 0)).circle(hx, hy, TOP.handR).d;
  sk.part(hand, solid(ink(glove)), ink(OUTLINE));
}

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  // 질주 자세는 보통(free)일 때만: 구조 중 · 수감 중에는 질주 효과가 남아 있어도 제자리 자세다
  const a = p.mode === 'free' ? p.action : 0;
  const hit = p.hit;
  const captive = p.mode === 'captive' ? 1 : 0;
  // 어깨: 공통 체형보다 조금 좁다(옆으로 넓은 공통 생존자와 실루엣이 갈리게). 질주 때 어깨를 움츠린다
  const r = topRig(p, TOP.halfW * (0.85 - 0.06 * a));
  const s = r.s;
  // 후드 머리: 어깨 앞으로 나온 둥근 머리. 질주 때 고개를 숙이고(조금 작아지고 앞으로) 수감 때 움츠러든다.
  // 피격 때 고개가 뒤로 밀리며 옆으로 꺾인다(몸 중심 기준 회전 — 거리는 그대로라 크기 기준에 걸리지 않는다).
  // 앞 끝은 늘 front 안 (수감 · 구조 중 자세가 머리를 앞으로 내밀어도)
  const R = r.headR * HOOD.k * (1 - 0.05 * a) * (1 - 0.08 * captive);
  const hx = Math.min(HOOD.front - R, r.head[0] + HOOD.dx + 0.05 * a - 0.04 * hit);
  const hy = r.head[1];
  const H = rotateAbout(0.22 * hit, 0, 0);
  // 머리 · 얼굴 · 꼬리는 원으로 그려 옆(y)만 ky배로 줄이고(조금 앞뒤로 긴 머리) 피격 회전을 곱한다
  const E: Mat = mul(H, [1, 0, 0, HOOD.ky, 0, hy * (1 - HOOD.ky)]);
  if (p.mode === 'free') {
    for (const side of [0, 1] as const) {
      const sign = side === 0 ? -1 : 1;
      // 서기 · 걷기: 손은 몸판 안에 묻힌다 (몸 옆에 둥근 혹이 생기지 않는다). 걸을 때 앞으로 흔든 손만 머리 옆으로 살짝
      // 나와 걸음이 보인다 (앞 ±60° · 옆 1.05r 안)
      const fw = Math.max(0, sign * s);
      const walkHand: Pt = [0.1 + 0.34 * sign * s, sign * (0.58 + 0.14 * fw)];
      // 질주: 팔을 접어 앞뒤로 엇갈리게 든다 (걸음 위상과 상관없이 왼손 앞 · 오른손 뒤, 걸음에 따라 조금 흔든다).
      // 앞으로 든 주먹은 머리 옆으로 나오고(몸통 비틀림을 빼 옆 1.05r 안), 뒤로 간 손은 피격 젖힘까지 뒤 1.0r 안
      const sprint: Pt =
        side === 0 ? [0.44 - 0.07 * s, -0.95 * r.halfW] : [-0.26 - 0.08 * s - r.ox, 0.84 * r.halfW];
      r.hands[side] = [
        walkHand[0] + (sprint[0] - walkHand[0]) * a,
        walkHand[1] + (sprint[1] - walkHand[1]) * a,
      ];
    }
  }
  // 구조 중: 두 손이 얼굴 양옆으로 나와 자물쇠를 만진다 (손 끝은 앞 ±60° 안 · 1.55r 안)
  if (p.mode === 'reach') {
    const reachX = hx + R * 0.55;
    const reachY = R * HOOD.ky + 0.02;
    r.hands = [
      [reachX, -reachY],
      [reachX, reachY],
    ];
  }
  // 발은 그리지 않는다: 위에서 보면 몸판(어깨 · 후드 밑자락)에 모두 가려진다
  // 1) 팔 (소매 + 장갑): 몸판 밑에 깔아 몸 밖으로 나온 부분(앞으로 든 손 · 구조 중 손)만 보인다.
  //    위 그림의 장갑은 짙은 파랑: 남회색이면 몸 옆에 바닥색 혹이 붙어 작은 크기에서 뾰족한 점이 된다.
  //    어깨 · 소매는 후드보다 한 단 짙게: 밝은 후드 머리가 어깨 위에 떠 보여 '머리 + 어깨'로 읽힌다(흑백에서도 앞이 밝다)
  const body = shade(C.hoodie, 0.14);
  const topGlove = shade(C.hoodie, 0.3);
  topSleeve(sk, r, 0, body, topGlove, ink);
  topSleeve(sk, r, 1, body, topGlove, ink);
  // 2) 몸판 (후드티 어깨 + 후드 밑자락): 어깨 판과 후드 머리를 한 볼록 껍질로 잇는다 — 목 잘록함 · 평행한 옆선 없이
  //    어깨에서 얼굴까지 계속 좁아지는 둥근 달걀꼴. 피격 젖힘(ox, 음수)만큼 등을 줄여 젖혀도 뒤 1.0r 안에 든다
  const T = mul(rotateAbout(r.twist, 0, 0), translate(r.ox, 0));
  const hull = convexHull([
    ...ovalPts(BACK.cx, 0, BACK.rx + r.ox, r.halfW, T),
    ...ovalPts(hx, hy, R * 0.97, R * 0.97, E),
  ]);
  sk.part(path().smooth(resample(hull, 40), 1).d, brightDome(body, ink, r.halfW * 1.15), ink(OUTLINE));
  // 3) 후드: 둥근 머리 + 등 위로 흐르는 천 끝. 끝 x는 서기 −0.88, 피격 때 몸 쪽으로 눌려 짧아지고 수감 때 움츠러든다.
  //    서 있을 때도 한쪽으로 살짝 휘고, 걸음마다 출렁인다(뿌리 → 끝으로 갈수록 크고 늦게). 질주 때 곧고 가늘게 편다
  const tipX = HOOD.tipX + 0.16 * hit + 0.14 * captive;
  const wave = p.stride * (1 - 0.75 * a);
  const curl = HOOD.curl * (1 - a);
  const ph = p.walk + 0.9;
  const lat = (k: number, amp: number): number =>
    hy + curl * Math.sin(Math.PI * 0.8 * k) + amp * wave * Math.sin(ph - 2.2 * k);
  const root: Pt = [hx - 0.3 * R, hy];
  const sp: Spine = {
    a: root,
    b: [root[0] + (tipX - root[0]) / 3, lat(1 / 3, 0.04)],
    c: [root[0] + ((tipX - root[0]) * 2) / 3, lat(2 / 3, 0.08)],
    d: [tipX, lat(1, 0.11)],
  };
  const w0 = HOOD.rootW * (1 - 0.25 * a);
  const w1 = HOOD.tipW * (1 - 0.2 * a) + 0.03 * hit;
  // 어깨 위에 드리운 그늘(칠만) 위에 얹어 작은 크기에서도 후드가 어깨와 갈린다
  sk.fill(
    hoodPath(hx, hy, R + 0.025, sp, w0 + 0.025, w1 + 0.025, E, HOOD.taper),
    solid(ink(shade(C.deep, 0.4))),
    0.15,
  );
  sk.part(
    hoodPath(hx, hy, R, sp, w0, w1, E, HOOD.taper),
    hoodPaint(ink, hx - 0.06, hy, hx - tipX + 0.05),
    ink(OUTLINE),
    1,
    0.2,
  );
  // 천 끝 등줄 (머리 뒤에서 끝으로 흐르는 밝은 접힌 등: 위에서 빛을 받아 천이 바람에 날리는 결로 읽힌다)
  sk.line(
    path(E).curve(
      [0.3, 0.5, 0.7, 0.88].map((t): Pt => {
        const q = spineAt(sp, t);
        return [q.x, q.y];
      }),
    ).d,
    solid(ink(tint(C.hoodie, 0.15))),
    0.045,
  );
  // 4) 얼굴 (후드 앞 구멍). 질주 · 수감 때 고개를 숙여 얼굴이 조금 덜 보이고, 질주 때 네온이 밝아진다
  topFace(sk, ink, hx, hy, R, Math.max(a, captive), a, E);
  return sk.drawing();
}

// ───────────────────────── 정면 (3/4 시점) ─────────────────────────

/**
 * 정면 3/4 시점: 몸이 화면 오른쪽(달리는 쪽)을 비스듬히 본다. 몸통 가로 줄임 · 앞으로 기울기(엉덩이 높이 축, 위가 오른쪽) ·
 * 가슴 가운데 선 x(기울이기 전) · 머리 중심 x
 */
const QUARTER = { squash: 0.88, lean: 0.14, mid: 0.1, headX: 0.09 } as const;

/** 몸통 변환 (기울이기 전 좌표 → 그림 좌표) */
const LEAN: Mat = [QUARTER.squash, 0, -QUARTER.lean, 1, QUARTER.lean * FRONT.hipY, 0];

/** 3/4 몸통 (가슴 쪽 = 오른쪽이 볼록, 등 쪽 = 왼쪽은 곧게) */
function torsoPath(by: number): string {
  const top = FRONT.shoulderY + by;
  const sx = FRONT.shoulderX;
  const hx = FRONT.hipX;
  return path(LEAN).smooth(
    [
      [0.06, FRONT.neckY + by],
      [sx * 0.75, top - 0.025],
      [sx + 0.01, top + 0.08],
      [hx + 0.06, FRONT.hipY - 0.17],
      [hx + 0.01, FRONT.hipY],
      [0.02, FRONT.hipY + 0.03],
      [-hx + 0.02, FRONT.hipY],
      [-hx - 0.01, FRONT.hipY - 0.13],
      [-sx + 0.02, top + 0.08],
      [-sx * 0.65, top - 0.03],
    ],
    0.9,
  ).d;
}

/** 정면 팔 (어깨 → 팔꿈치 → 주먹, 두 마디 캡슐). far = 먼 쪽 팔 (몸 뒤, 한 단 어둡게) */
function bentArm(sk: Sketch, ink: Ink, sh: Pt, elbow: Pt, hand: Pt, far: boolean): void {
  const base = far ? shade(C.hoodie, 0.14) : C.hoodie;
  const sleeve = linear(sh[0] - 0.12, 0, sh[0] + 0.12, 0, [
    [0, ink(tint(base, 0.14))],
    [1, ink(shade(base, 0.28))],
  ]);
  sk.part(path().capsule(sh[0], sh[1], elbow[0], elbow[1], 0.17, 0.15).d, sleeve, ink(OUTLINE));
  sk.part(path().capsule(elbow[0], elbow[1], hand[0], hand[1], 0.15, 0.14).d, sleeve, ink(OUTLINE));
  // 소매 끝 (짙은 파랑 고무단)
  const ang = Math.atan2(hand[1] - elbow[1], hand[0] - elbow[0]);
  const cx = hand[0] - Math.cos(ang) * 0.07;
  const cy = hand[1] - Math.sin(ang) * 0.07;
  sk.fill(path().ellipse(cx, cy, 0.035, 0.075, ang).d, solid(ink(shade(base, 0.35))));
  // 주먹 (손가락 없는 어두운 장갑) + 손등 파랑 줄
  sk.part(
    path().circle(hand[0], hand[1], 0.075).d,
    radial(hand[0] - 0.03, hand[1] - 0.03, 0.11, [
      [0, ink(tint(C.glove, 0.28))],
      [1, ink(C.glove)],
    ]),
    ink(OUTLINE),
  );
  sk.line(
    path()
      .M(hand[0] - 0.035, hand[1] - 0.03)
      .L(hand[0] + 0.035, hand[1] - 0.03).d,
    solid(ink(C.hoodie)),
    0.02,
  );
}

/**
 * 3/4 운동화 (옆에서 본 긴 신발, 앞코 = 오른쪽): 밝은 밑창(외곽선 있는 부품)을 먼저 깔고 어두운 갑피를 얹는다 — 밑창이
 * 외곽선 안의 밝은 띠로 보인다. 뒤꿈치 → 앞코로 쓸어 올린 파랑 줄. tilt = 앞코를 내린 각
 */
function sideSneaker(sk: Sketch, ink: Ink, x: number, y: number, tilt: number, far: boolean): void {
  const len = 0.17;
  const m = rotateAbout(tilt, x, y);
  const upper = far ? shade(C.shoe, 0.15) : C.shoe;
  sk.part(path(m).roundRect(x - len, y + 0.005, len * 2, 0.08, 0.04).d, solid(ink(C.sole)), ink(OUTLINE));
  sk.part(
    path(m).ellipse(x, y - 0.01, len, 0.075).d,
    linear(0, y - 0.085, 0, y + 0.065, [
      [0, ink(tint(upper, 0.15))],
      [1, ink(shade(upper, 0.2))],
    ]),
    ink(OUTLINE),
  );
  sk.line(
    path(m).curve([
      [x - 0.12, y + 0.01],
      [x, y - 0.01],
      [x + 0.09, y - 0.045],
    ]).d,
    solid(ink(C.hoodie)),
    0.028,
  );
}

/** 3/4 다리 하나 (엉덩이 → 무릎 → 발목, 어두운 조거 바지 + 화면 쪽 파랑 옆줄 + 발목 고무단). far = 먼 쪽 (한 단 어둡게) */
function leg(sk: Sketch, ink: Ink, hip: Pt, knee: Pt, ankle: Pt, far: boolean): void {
  const base = far ? shade(C.pants, 0.2) : C.pants;
  const paint = linear(knee[0] - 0.12, 0, knee[0] + 0.12, 0, [
    [0, ink(tint(base, 0.1))],
    [1, ink(shade(base, 0.3))],
  ]);
  sk.part(path().capsule(hip[0], hip[1], knee[0], knee[1], 0.19, 0.175).d, paint, ink(OUTLINE));
  sk.part(path().capsule(knee[0], knee[1], ankle[0], ankle[1], 0.175, 0.15).d, paint, ink(OUTLINE));
  sk.line(
    path().curve([
      [hip[0] - 0.07, hip[1] + 0.05],
      [knee[0] - 0.075, knee[1]],
      [ankle[0] - 0.06, ankle[1] - 0.04],
    ]).d,
    solid(ink(far ? shade(C.hoodie, 0.2) : C.hoodie)),
    0.025,
  );
  const shin = Math.atan2(ankle[1] - knee[1], ankle[0] - knee[0]);
  sk.fill(path().ellipse(ankle[0], ankle[1], 0.03, 0.085, shin).d, solid(ink(shade(C.pants, 0.3))));
}

/**
 * 3/4 다리 (달리기 한가운데, 체공 순간): 먼 다리는 뒤로 차고 나가며 앞코로 땅을 밀고, 가까운 다리는 무릎을 앞(오른쪽)으로
 * 높이 들어 발이 땅에서 떠 있다(앞코를 살짝 든다) — 그림만 봐도 오른쪽으로 달린다
 */
function frontRunnerLegs(sk: Sketch, ink: Ink): void {
  const hipY = FRONT.hipY - 0.05;
  leg(sk, ink, [0.1, hipY], [-0.02, 0.66], [-0.27, 0.8], true);
  sideSneaker(sk, ink, -0.24, 0.82, 0.6, true);
  leg(sk, ink, [-0.04, hipY], [0.3, 0.5], [0.27, 0.68], false);
  sideSneaker(sk, ink, 0.34, 0.73, -0.12, false);
}

/**
 * 3/4 얼굴 (후드 구멍 안): 얼굴이 달리는 쪽(오른쪽)을 비스듬히 본다. 가까운 왼쪽 볼은 둥글고 넓게, 먼 오른쪽은 납작하게
 * 줄고 코가 윤곽 밖으로 살짝 나온다. 가운데 선(눈 · 입 자리)이 오른쪽으로 치우치고, 먼 쪽 눈은 좁고 얼굴 가장자리 가까이
 */
function frontFace(sk: Sketch, ink: Ink, hcx: number, hy: number, sway: number): void {
  const fy = hy + 0.06;
  // 후드 구멍: 달리는 쪽(오른쪽)으로 치우친다 (머리 뒤쪽 = 왼쪽 후드 천이 넓고, 먼 쪽 테는 얇다)
  const ox = hcx + 0.11;
  // 후드 안 그늘 (얼굴 둘레)
  sk.fill(path().ellipse(ox, fy, 0.27, 0.3).d, solid(ink(shade(C.deep, 0.35))));
  const fx = hcx + 0.1;
  const skin = radial(fx - 0.08, fy - 0.06, 0.4, [
    [0, ink(tint(MAT.skin, 0.12))],
    [0.7, ink(MAT.skin)],
    [1, ink(MAT.skinShade)],
  ]);
  // 얼굴 윤곽 (정수리 → 먼 쪽 이마 → 코 → 먼 쪽 턱 → 턱 끝 → 가까운 볼): 먼 쪽 x 최대 fx + 0.2, 코 끝 fx + 0.215
  sk.fill(
    path().smooth([
      [fx, fy - 0.225],
      [fx + 0.15, fy - 0.19],
      [fx + 0.2, fy - 0.05],
      [fx + 0.185, fy + 0.04],
      [fx + 0.215, fy + 0.1],
      [fx + 0.175, fy + 0.145],
      [fx + 0.16, fy + 0.21],
      [fx + 0.09, fy + 0.28],
      [fx - 0.06, fy + 0.255],
      [fx - 0.17, fy + 0.17],
      [fx - 0.225, fy + 0.03],
      [fx - 0.2, fy - 0.13],
    ]).d,
    skin,
  );
  // 얼굴 가운데 선 (눈 · 입 자리, 달리는 쪽으로 치우친다)
  const cl = fx + 0.105;
  // 앞머리 (후드 밑으로 삐져나온 뾰족한 머리칼, 바람에 뒤로 쓸린다)
  sk.fill(
    path()
      .M(fx - 0.25, fy)
      .Q(fx - 0.23, fy - 0.24, fx + 0.02, fy - 0.26)
      .Q(fx + 0.23, fy - 0.24, fx + 0.255, fy - 0.03)
      .L(fx + 0.2, fy - 0.08)
      .L(fx + 0.13, fy)
      .L(fx + 0.07, fy - 0.1)
      .L(fx - 0.03, fy - 0.02)
      .L(fx - 0.08, fy - 0.11)
      .L(fx - 0.17, fy - 0.02)
      .L(fx - 0.21, fy - 0.09)
      .Z().d,
    solid(ink(C.hair)),
  );
  // 눈 (가까운 쪽 눈은 크게, 먼 쪽 눈은 좁게) + 반짝임
  const ey = fy + 0.07;
  for (const [x, rx] of [
    [cl - 0.12, 0.045],
    [cl + 0.052, 0.026],
  ] as const) {
    sk.fill(path().ellipse(x, ey, rx, 0.06).d, solid(ink(MAT.eye)));
    sk.fill(path().circle(x - rx * 0.3, ey - 0.025, 0.016).d, solid(ink(0xffffff), 0.9));
  }
  // 눈썹 (자신 있는 표정, 먼 쪽은 짧게)
  for (const [x0, y0, x1, y1] of [
    [cl - 0.185, fy - 0.005, cl - 0.07, fy + 0.008],
    [cl + 0.03, fy + 0.008, cl + 0.09, fy - 0.002],
  ] as const)
    sk.line(path().M(x0, y0).L(x1, y1).d, solid(ink(C.hair)), 0.024);
  // 코 밑 그늘 (코 혹 바로 아래) · 입 (가운데 선 기준, 한쪽 입꼬리를 올린 웃음 — 먼 쪽은 짧다)
  sk.line(
    path()
      .M(fx + 0.165, fy + 0.128)
      .Q(fx + 0.18, fy + 0.142, fx + 0.2, fy + 0.13).d,
    solid(ink(MAT.skinShade)),
    0.016,
  );
  sk.line(
    path()
      .M(cl - 0.075, fy + 0.18)
      .Q(cl - 0.02, fy + 0.205, cl + 0.04, fy + 0.165).d,
    solid(ink(MAT.skinShade)),
    0.02,
  );
  // 후드 테두리 (두꺼운 고무단 + 네온 선)
  const rim = path().ellipse(ox, fy, 0.27, 0.3).d;
  sk.line(rim, solid(ink(shade(C.hoodie, 0.1))), 0.07);
  sk.line(rim, solid(ink(C.neon), 0.35), 0.05);
  sk.line(rim, solid(ink(tint(C.neon, 0.3))), 0.016);
  // 후드 끈 (목에서 늘어진 두 줄, 달리는 바람에 뒤로 날린다 + 밝은 끈 끝)
  for (const s of [-1, 1]) {
    const x0 = cl + s * 0.06;
    const x1 = x0 - 0.05 + sway * 0.4;
    sk.line(
      path()
        .M(x0, fy + 0.29)
        .Q(x0 - 0.01, fy + 0.34, x1, fy + 0.39).d,
      solid(ink(tint(C.neon, 0.5))),
      0.018,
    );
    sk.fill(path().roundRect(x1 - 0.015, fy + 0.38, 0.03, 0.05, 0.012).d, solid(ink(C.sole)));
  }
}

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const by = frontBreath(p.t);
  const sway = Math.sin(p.t * 2.4) * 0.05;
  const mid = QUARTER.mid;
  // 1) 먼 팔 (앞으로 치는 팔, 몸 뒤): 어깨 → 아래 앞 팔꿈치 → 가슴 앞 주먹. 먼 어깨는 몸 안쪽(3/4 원근으로 좁다)
  bentArm(sk, ink, apply(LEAN, 0.17, FRONT.shoulderY + 0.08 + by), [0.4, 0.3 + by], [0.5, 0.12 + by], true);
  // 2) 다리 (어두운 조거 바지) + 큰 운동화
  if (!p.bust) frontRunnerLegs(sk, ink);
  // 3) 몸통 (후드티) + 밑단 · 캥거루 주머니 · 옆 솔기(3/4 부피)
  sk.part(torsoPath(by), frontClothPaint(C.hoodie, ink), ink(OUTLINE));
  sk.fill(
    path(LEAN)
      .M(-0.22, FRONT.hipY - 0.06)
      .L(0.26, FRONT.hipY - 0.06)
      .L(0.27, FRONT.hipY - 0.005)
      .Q(0.02, FRONT.hipY + 0.035, -0.23, FRONT.hipY - 0.005)
      .Z().d,
    solid(ink(shade(C.hoodie, 0.32))),
  );
  sk.part(
    path(LEAN)
      .M(mid - 0.14, 0.25)
      .L(mid + 0.15, 0.25)
      .L(mid + 0.19, 0.36)
      .L(mid - 0.17, 0.36)
      .Z().d,
    solid(ink(shade(C.hoodie, 0.12))),
    ink(OUTLINE),
    1,
    0.3,
  );
  sk.line(
    path(LEAN).curve([
      [mid - 0.2, FRONT.shoulderY + 0.14 + by],
      [mid - 0.24, 0.24],
      [mid - 0.21, FRONT.hipY - 0.07],
    ]).d,
    solid(ink(shade(C.hoodie, 0.22))),
    0.018,
  );
  // 가슴 » 갈매기 무늬 (네온: 넓은 은은한 빛 + 밝은 선)
  const chev = path(LEAN)
    .M(mid - 0.11, 0.11 + by)
    .L(mid - 0.04, 0.17 + by)
    .L(mid - 0.11, 0.23 + by)
    .M(mid - 0.02, 0.11 + by)
    .L(mid + 0.05, 0.17 + by)
    .L(mid - 0.02, 0.23 + by).d;
  sk.line(chev, solid(ink(C.neon), 0.3), 0.075);
  sk.line(chev, solid(ink(tint(C.neon, 0.35))), 0.032);
  // 4) 가까운 팔 (뒤로 젖힌 팔, 몸 앞): 어깨 → 뒤로 뺀 팔꿈치 → 허리 뒤 주먹. 가까운 어깨는 바깥쪽(넓게 보인다)
  bentArm(
    sk,
    ink,
    apply(LEAN, -0.28, FRONT.shoulderY + 0.08 + by),
    [-0.43, 0.23 + by],
    [-0.34, 0.42 + by],
    false,
  );
  // 5) 후드: 둥근 머리 덮개 + 왼쪽 뒤로 흐르는 천 끝 (S자로 출렁인다). 상반신은 끝을 짧게 해 얼굴을 크게 담는다
  const hcx = QUARTER.headX;
  const hy = FRONT.headY + by + 0.02;
  const hoodR = FRONT.headR * 1.16;
  const sp: Spine = {
    a: [hcx - 0.14, hy - 0.1],
    b: [hcx - 0.38, hy - 0.32],
    c: [p.bust ? -0.4 : -0.5, hy - 0.04 + sway * 0.6],
    d: [p.bust ? -0.5 : -0.68, hy - 0.2 + sway],
  };
  sk.part(
    hoodPath(hcx, hy, hoodR, sp, 0.27, 0.035),
    radial(hcx - 0.18, hy - 0.2, 0.95, [
      [0, ink(tint(C.hoodie, 0.22))],
      [0.4, ink(C.hoodie)],
      [0.8, ink(shade(C.hoodie, 0.2))],
      [1, ink(shade(C.hoodie, 0.35))],
    ]),
    ink(OUTLINE),
  );
  // 후드 솔기 (정수리에서 천 끝으로 흐르는 그늘 선)
  sk.line(
    path().curve(
      [0.12, 0.35, 0.6, 0.82].map((t): Pt => {
        const q = spineAt(sp, t);
        return [q.x, q.y];
      }),
    ).d,
    solid(ink(shade(C.hoodie, 0.25))),
    0.018,
  );
  // 6) 얼굴 (3/4)
  frontFace(sk, ink, hcx, hy, sway);
  return sk.drawing();
}

/**
 * 정면 상반신 (로비 역할 카드 · 결과 화면, 64~160px): 머리 · 후드 끝 · 어깨 · 앞 주먹이 상자를 채우게 1.65배 (외곽선 굵기는
 * 그대로). 후드 끝은 상반신에서 짧게 그리고(얼굴이 가드 · 스카우트와 비슷한 크기로 보이게), 왼쪽 끝까지 상자 안에 들게
 * 조금 오른쪽으로 옮긴다
 */
const BUST = { k: 1.65, tx: 0.03, ty: 0.42 } as const;

function front(p: FrontPose, o: ArtOptions): Drawing {
  if (!p.bust) return frontBody(p, o);
  return transformDrawing(frontBody(p, { w: o.w / BUST.k }), BUST.k, BUST.tx, BUST.ty);
}

export const RUNNER_ART: SurvivorArt = {
  id: 'runner',
  top: (p, o) => top(cleanSurvivorPose(p), o),
  front: (p, o) => front(cleanFrontPose(p), o),
  /** 크기 기준 앞 한도와 같다 (머리 앞 끝 · 구조 중 손이 1.55r 안, 옆은 1.05r · 뒤는 1.0r 안) */
  topExtent: 1.55,
};
