// 러너 새 캐릭터 (캐릭터 리디자인): 깊게 눌러쓴 파랑 후드티 + 큰 운동화. 가볍고 빠른 인상.
// 위에서 보면 바라보는 방향과 직각으로 넓은 어깨(몸통 + 양옆 팔) 앞으로 둥근 후드 머리가 나와 있다 — 위에서 본 사람처럼
// '넓은 몸 + 앞으로 나온 머리'라 실루엣만으로 '머리 쪽 = 앞'이 읽힌다(옛 그림의 앞 돌출과 같은 언어). 후드는 뒤가 어깨 위로
// 길게 얹힌 달걀꼴이라 목 위의 공이 아니라 어깨에 걸친 후드로 보이고, 등은 판정 원보다 납작하고 뒤로 갈수록 좁다. 바로 위에서
// 내려다보므로 얼굴은 후드 챙 밑 그늘에 숨는다: 앞 끝은 짙은 남색 구멍 초승달, 그 뒤에 밝은 네온 챙 띠(살색 · 눈은 그리지
// 않는다 — 작은 크기에서 '밝은 테 + 짙은 앞 끝'이 흑백에서도 앞을 가리킨다). 후드 끝은 머리 뒤에서 오른쪽 어깨뼈 위로 흐르는
// 가늘어지는 끈이다(몸판 안이라 실루엣을 뒤로 뾰족하게 만들지 않는다. 걸음마다 S자로 출렁이고 질주 때 곧게 뒤로 편다).
// 서 있을 때도 걸음 직전 자세(오른손 앞 · 왼손 뒤)라 좌우 대칭이 아니다. 팔은 걸음에 맞춰 앞뒤로 흔들고(앞으로 간 주먹이 머리
// 옆으로, 뒤로 간 팔은 팔꿈치가 어깨 뒤로), 질주 때 몸을 숙여 머리가 더 나오고 팔을 크게 흔든다.
// 정면 그림(로비 역할 카드 · 결과 화면)은 3/4 시점: 몸 · 얼굴이 화면 오른쪽(달리는 쪽)을 비스듬히 보고, 후드 끝은 왼쪽 뒤로
// 흐른다. 위 그림의 네온 포인트는 후드 챙의 밝은 파랑 띠(글자용 역할색)뿐이다. 정면 그림은 시설과 같은 청록 네온(survivorBase
// frontNeon: #22D3EE 번짐 + #67E8F9 심)을 후드 테두리 · 후드 끈과 빛나는 끈 끝 · 가슴 » 갈매기 무늬 · 소매 끝 띠 · 바지 옆줄 ·
// 운동화 밑창 줄에 넣는다 — 어두운 시설 · 청록 네온 분위기에 맞추되 몸(후드티)은 역할색 파랑이 주인공(네온은 테 · 띠 · 줄에만).
// 위 그림(게임 화면)에는 청록을 넣지 않는다(게임 화면에서 청록은 시설 · 목표 뜻).
// 색은 역할색 파랑(#3B82F6)과 그 짙은/밝은 변형, 어두운 남회색 바지 · 신발, 밝은 회색 밑창, 얼굴 피부색(정면).
import { OUTLINE, ROLE } from '../palette';
import {
  IDENTITY,
  Sketch,
  apply,
  linear,
  path,
  radial,
  rotateAbout,
  shade,
  solid,
  tint,
  transformDrawing,
  type Drawing,
  type Mat,
  type Paint,
  type Path,
} from './kit';
import {
  FRONT,
  MAT,
  TOP,
  frontBreath,
  frontClothPaint,
  frontNeon,
  inkFor,
  topRig,
  type FrontNeon,
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
  /** 위 그림 후드 챙 띠 (밝은 파랑, 글자용 역할색). 정면 그림 네온은 청록(frontNeon) */
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
 * 위 그림 몸판 (후드티 몸통 · 등): 등 둘레 기준 반지름(뒤 1.0r 안), 어깨 반폭, 가장 넓은 어깨 x, 가슴 선 x, 등 둘레 배율
 * (각 0.62π · 0.74π · 0.86π · π — 등을 판정 원보다 납작하게, 뒤로 갈수록 좁게 해 바라보는 방향과 직각으로 넓은 어깨로
 * 읽힌다. 둥근 등껍질이 아니라 어깨가 넓고 허리 쪽이 좁은 달리는 몸. 둥근 가드와 실루엣이 덜 겹친다)
 */
const PLATE = {
  back: 0.995,
  // 어깨 반폭: 가볍고 빠른 인상이 나게 좁게 (사용자 결정 — 2차 시안의 0.92에서 줄임)
  w: 0.86,
  shoulderX: -0.05,
  chest: 0.42,
  rim: [0.97, 0.88, 0.76, 0.72],
} as const;

/**
 * 위 그림 후드 머리 (어깨선 앞으로 나온 둥근 머리 — '머리 쪽 = 앞'): 반지름, 중심 x(서기), 질주 때 더 내미는 거리,
 * 앞 끝 한도(앞 ±60° 1.55r 안), 뒤쪽 x 반지름 배수(후드 천이 머리 뒤로 부풀어 어깨 위에 얹힌다 — 앞은 반원, 뒤는 긴 반타원)
 */
const HEAD = { r: 0.58, x: 0.92, sprint: 0.06, front: 1.53, back: 1.22 } as const;

/**
 * 후드 끝 천 (머리 뒤에서 어깨 · 등 위로 흐르는 끈, 몸판 안): 끝 자리(서기, 몸 중심 기준 — 오른쪽 어깨뼈 위), 뿌리 · 끝
 * 반폭, 가늘어지는 빠르기(클수록 뿌리 가까이에서 좁아진다)
 */
const TAIL = { tipX: -0.6, tipY: 0.42, rootW: 0.22, tipW: 0.06, taper: 1.3 } as const;

/**
 * 위 그림 후드 앞 (머리 반지름 배수): 바로 위에서 보면 얼굴은 후드 챙 밑 그늘에 숨는다. 앞 끝 짙은 구멍(챙 밑 그늘) 초승달의
 * 반각(라디안) · 가운데 두께, 그 뒤 챙 고무단(밝은 네온 띠)의 가운데 두께. 휴대폰 크기(몸 반지름 약 7px)에서 짙은 초승달
 * 가운데가 2화소쯤 된다(0.5 × 0.58r ≈ 0.29r)
 */
const HOOD_FRONT = { half: 1.45, open: 0.5, brim: 0.36 } as const;

/**
 * 위 그림 팔 (몸 반지름 배수): 어깨 관절 자리(x · |y|), 서 있을 때 손(소매 끝) x, 앞 · 뒤 흔들림 폭, 손 옆 자리(|y|) · 앞으로
 * 간 손이 안으로 드는 정도, 뒤로 간 손 · 주먹이 닿는 몸 중심 거리 한도(주먹 끝까지 뒤 1.0r 안), 주먹 반지름, 서 있을 때의
 * 흔들림(걸음 직전 자세: 오른손 앞 · 왼손 뒤 — 좌우 대칭이 아니라 달리려는 사람으로 읽힌다), 뒤로 흔든 팔의 어깨 관절이 앞으로
 * 오는 거리(소매가 어깨 뒤로 길게 뻗어 팔꿈치로 읽힌다 — 혹처럼 짧은 덩어리가 아니다).
 * 팔은 몸통 옆에 붙어 어깨 너비를 이루고, 앞으로 흔든 팔은 머리 옆까지 나온다
 */
const ARM = {
  jointX: -0.22,
  jointY: 0.74,
  x: 0.12,
  fore: 0.48,
  aft: 0.5,
  y: 0.75,
  tuck: 0.12,
  reach: 0.8,
  fist: 0.17,
  ready: 0.8,
  lift: 0.2,
} as const;

/** 위 그림 소매 굵기 (어깨 쪽 · 소매 끝): 가늘게 해 가볍고 빠른 인상 (2차 시안 0.34 · 0.27에서 줄임) */
const SLEEVE = { root: 0.28, end: 0.22 } as const;

/** 위 그림 후드 머리 칠 (머리 위에서 받는 빛) */
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
 * 위 그림 후드 앞 (얼굴 자리): 바로 위에서 보면 얼굴은 후드 챙 밑 그늘에 숨는다 — 후드 앞 끝은 짙은 남색 구멍(챙 밑
 * 그늘) 초승달로 끝나고, 그 뒤 챙 테두리에 밝은 네온 고무단이 둘린다. 살색 · 눈은 그리지 않아 실루엣의 앞 끝은 늘
 * 어둡다. 휴대폰 크기(몸 반지름 약 7px)에서는 '밝은 테 + 짙은 앞 끝'이 흑백에서도 바라보는 방향 단서다 (가드 방패 호 ·
 * 공통 생존자 가리개처럼 명도 대비로 앞을 표시). bow = 고개 숙임(질주 · 수감: 정수리가 앞으로 와 구멍이 얇아진다),
 * glow = 네온 밝기(질주)
 */
function topHoodFront(
  sk: Sketch,
  ink: Ink,
  hx: number,
  hy: number,
  R: number,
  bow: number,
  glow: number,
  m: Mat,
): void {
  const F = HOOD_FRONT;
  const t = R * F.open * (1 - 0.3 * bow);
  // 챙 곡선 (머리 앞 끝에서 d 뒤): 머리 원 앞쪽 반각 half의 두 점을 잇는 반타원. d가 작으면 앞으로 볼록, 커서 x 반지름이
  // 0 아래로 가면 뒤로 볼록해진다 (두 곡선 사이 띠는 양 끝이 머리 원에서 0으로 가늘어져 외곽선 밖으로 나가지 않는다)
  const cx = hx + R * Math.cos(F.half);
  const ry = R * Math.sin(F.half);
  const rxAt = (d: number): number => R * (1 - Math.cos(F.half)) - d;
  const brimEdge = (p: Path, d: number, fwd: boolean, move: boolean): Path =>
    fwd
      ? p.arc(cx, hy, rxAt(d), Math.PI / 2, -Math.PI / 2, move, ry)
      : p.arc(cx, hy, rxAt(d), -Math.PI / 2, Math.PI / 2, move, ry);
  // 1) 짙은 구멍 (챙 밑 그늘: 머리 원 앞 호 + 챙 앞 곡선). 가운데 앞(그늘 속 얼굴 자리)이 조금 덜 어둡고 양옆 구석이 가장
  //    어둡다 — 살색은 쓰지 않는다(앞 끝이 살색이면 작은 크기에서 어색한 모양으로 읽힐 수 있다)
  const [ox, oy] = apply(m, hx + R - t * 0.5, hy);
  sk.fill(
    brimEdge(path(m).arc(hx, hy, R, -F.half, F.half), t, true, false).Z().d,
    radial(ox, oy, R * 0.9, [
      [0, ink(shade(C.deep, 0.1))],
      [1, ink(shade(C.deep, 0.55))],
    ]),
  );
  // 2) 챙 고무단 (네온 띠 + 가운데 밝은 결, 뒤 가장자리에 가는 짙은 선). 띠는 선이 아니라 칠이라 양 끝이 머리 원 안에서
  //    가늘어진다. 질주 때 밝아진다
  const w = R * F.brim;
  const band = (d0: number, d1: number): string =>
    brimEdge(brimEdge(path(m), d0, true, true), d1, false, false).Z().d;
  sk.fill(band(t, t + w), solid(ink(tint(C.neon, 0.1))), 0.9 + 0.1 * glow);
  sk.fill(band(t + w * 0.25, t + w * 0.6), solid(ink(tint(C.neon, 0.55))), 0.8 + 0.2 * glow);
  sk.line(brimEdge(path(m), t + w, true, true).d, solid(ink(shade(C.hoodie, 0.3))), 0.025);
}

// ───────────────────────── 위 그림 ─────────────────────────

/**
 * 몸판 윤곽 점 (위쪽 반을 그려 아래로 접는다): 머리 밑 → 머리 옆에 붙는 목(neck, 머리 원 위 점) → 바라보는 방향과 직각으로
 * 곧게 뻗은 가슴 · 어깨 선(x = chest, 머리와 어깨 사이 오목한 홈은 거의 직각 — 비스듬히 처진 병 어깨가 아니다) → 둥근 어깨
 * 모서리 → 가장 넓은 어깨(sx, w) → 둥근 등(각 0.62π · 0.74π · 0.86π · π에서 몸 중심 거리 back × rim).
 * k = 크기 배율 (수감 · 피격 때 움츠림)
 */
function platePts(
  back: number,
  w: number,
  sx: number,
  chest: number,
  neck: Pt,
  rim: readonly number[],
  k: number,
): Pt[] {
  const arc = [0.62, 0.74, 0.86].map((t, i): Pt => [
    back * (rim[i] ?? 1) * Math.cos(Math.PI * t),
    back * (rim[i] ?? 1) * Math.sin(Math.PI * t),
  ]);
  const half: Pt[] = [
    [neck[0] + 0.1, 0],
    neck,
    [chest, neck[1] + 0.06],
    [chest - 0.02, w * 0.72],
    [chest - 0.14, w * 0.93],
    [sx, w],
    ...arc,
    [-back * (rim[3] ?? 1), 0],
  ];
  const all = [
    ...half,
    ...half
      .slice(1, -1)
      .reverse()
      .map(([x, y]): Pt => [x, -y]),
  ];
  return all.map(([x, y]): Pt => [x * k, y * k]);
}

/**
 * 위 그림 팔 하나 (몸판 위에 얹어 가는 안쪽 선으로만 갈린다): 어깨 관절 → 손(소매 끝) 캡슐 + 소매 끝 밑의 주먹. 흔들지
 * 않으면 몸통 옆에 붙은 팔 윗부분(어깨 너비를 이룬다), 흔들면 앞뒤로 늘어나 팔치기가 보인다. v = 주먹이 드러나는 정도
 * (0 = 작아져 소매 끝에 숨는다 — 내린 손은 위에서 보이지 않는다), back = 뒤로 흔든 정도(0~1). 주먹 중심은 뒤쪽이면 몸
 * 중심 reach 안으로 당긴다
 */
function topArm(
  sk: Sketch,
  r: TopRig,
  side: 0 | 1,
  v: number,
  back: number,
  sleeve: number,
  glove: number,
  ink: Ink,
  T: Mat,
): void {
  const sign = side === 0 ? -1 : 1;
  // 뒤로 흔든 팔(back > 0)은 어깨 관절이 앞으로 와 소매가 어깨 뒤로 길게 뻗는다 (팔꿈치가 등 옆으로 나온 팔치기)
  const jx = ARM.jointX + ARM.lift * back;
  const jy = sign * ARM.jointY * (r.halfW / PLATE.w);
  const [hx, hy] = r.hands[side];
  const d = Math.hypot(hx - jx, hy - jy) || 1;
  const off = 0.03 + 0.07 * v;
  let fx = hx + ((hx - jx) / d) * off;
  let fy = hy + ((hy - jy) / d) * off;
  const fd = Math.hypot(fx, fy);
  if (fx < 0 && fd > ARM.reach) {
    fx = (fx * ARM.reach) / fd;
    fy = (fy * ARM.reach) / fd;
  }
  sk.part(path(T).circle(fx, fy, ARM.fist * (0.6 + 0.4 * v)).d, solid(ink(glove)), ink(OUTLINE), 1, 0.3);
  // 소매 칠: 팔 가운데가 밝은 둥근 덩어리 (몸판과 같은 색이라도 팔로 읽힌다)
  const [mx, my] = apply(T, (jx + hx) / 2, (jy + hy) / 2);
  sk.part(
    path(T).capsule(jx, jy, hx, hy, SLEEVE.root, SLEEVE.end).d,
    radial(mx, my, Math.max(0.3, d * 0.6), [
      [0, ink(tint(sleeve, 0.14))],
      [0.6, ink(sleeve)],
      [1, ink(shade(sleeve, 0.14))],
    ]),
    ink(OUTLINE),
    1,
    0.3,
  );
}

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  // 질주 자세는 보통(free)일 때만: 구조 중 · 수감 중에는 질주 효과가 남아 있어도 제자리 자세다
  const a = p.mode === 'free' ? p.action : 0;
  const hit = p.hit;
  const captive = p.mode === 'captive' ? 1 : 0;
  const reach = p.mode === 'reach' ? 1 : 0;
  const r = topRig(p, PLATE.w);
  // 서 있을 때(걸음 0)의 흔들림: 걸음 직전 자세(ready), 질주면 끝까지 (+ = 오른손 앞 · 왼손 뒤). 걸을수록 걸음 흔들림으로 넘어간다
  const bias = p.mode === 'free' ? (1 - p.stride) * (ARM.ready + (1 - ARM.ready) * a) : 0;
  // 몸판 · 팔: 걸음 비틀림 + 걸음 직전 자세의 반만큼 (앞으로 든 손 쪽 어깨가 조금 앞으로). 피격 젖힘으로는 옮기지 않는다(어깨
  // 옆 · 팔 끝이 뒤 1.0r에 거의 닿아 옮기면 넘는다 — 피격은 젖히는 머리와 움츠린 몸판이 보인다). 머리는 비틀지 않는다(달릴 때
  // 고개는 앞을 본다)
  const P = rotateAbout(r.twist - 0.5 * TOP.twist * bias, 0, 0);
  // 후드 머리: 어깨선 앞으로 나온 둥근 머리. 질주 때 몸을 숙여 더 앞으로, 구조 중 자물쇠 쪽으로 조금, 수감 때 움츠러들고,
  // 피격 때 뒤로 밀리며 옆으로 꺾인다(몸 중심 기준 회전 — 거리는 그대로라 크기 기준에 걸리지 않는다). 앞 끝은 늘 front 안
  const R = HEAD.r * (1 - 0.04 * a) * (1 - 0.06 * captive);
  const hx = Math.min(HEAD.front - R, HEAD.x + HEAD.sprint * a + 0.02 * reach - 0.22 * captive - 0.16 * hit);
  const hy = 0;
  const E = rotateAbout(0.22 * hit, 0, 0);
  // 주먹이 드러나는 정도 (팔마다): 앞으로 흔든 만큼, 구조 · 수감 중에는 다 드러난다
  const fist: [number, number] = p.mode === 'free' ? [0, 0] : [1, 1];
  // 뒤로 흔든 정도 (팔마다, 0~1)
  const aft: [number, number] = [0, 0];
  if (p.mode === 'free') {
    // 팔치기: 흔들림 sw (+ = 오른손 앞 · 왼손 뒤, 공통 뼈대처럼 같은 쪽 발과 엇갈린다). 질주는 크게 흔들고, 서 있어도
    // (걸음 0) 오른손 앞 · 왼손 뒤로 든다(bias). 피격 때 줄어든다
    const sw = (r.s + bias) * (1 + 0.3 * a) * (1 - 0.6 * hit);
    for (const side of [0, 1] as const) {
      const sign = side === 0 ? -1 : 1;
      const f = sign * sw;
      fist[side] = Math.min(1, Math.max(0, f) * 1.5);
      aft[side] = Math.min(1, Math.max(0, -f));
      const hand: Pt = [
        ARM.x + (f > 0 ? ARM.fore : ARM.aft) * f,
        sign * (ARM.y - ARM.tuck * Math.max(0, f) - 0.04 * Math.max(0, -f)),
      ];
      // 뒤로 간 손은 몸 중심에서 reach 안으로 당긴다 (주먹 끝 · 소매 끝이 뒤 1.0r 안)
      const d = Math.hypot(hand[0], hand[1]);
      r.hands[side] =
        hand[0] < 0 && d > ARM.reach ? [(hand[0] * ARM.reach) / d, (hand[1] * ARM.reach) / d] : hand;
    }
  }
  // 구조 중: 두 손이 머리 양옆으로 나와 자물쇠를 만진다 (손 끝은 앞 ±60° 안 · 1.55r 안)
  if (p.mode === 'reach')
    r.hands = [
      [hx + R * 0.25, -(R + 0.12)],
      [hx + R * 0.25, R + 0.12],
    ];
  const body = shade(C.hoodie, 0.06);
  // 위 그림의 주먹은 짙은 파랑 (남회색이면 작은 크기에서 몸 옆에 바닥색 혹이 붙는다)
  const topGlove = shade(C.hoodie, 0.32);
  // 1) 몸판 (후드티 몸통 · 등). 앞 가운데는 짧은 목으로 머리 밑에 이어진다. 수감 · 피격 때 조금 움츠린다
  const pk = 1 - 0.08 * captive - 0.04 * hit;
  // 목: 머리 원 뒤쪽 옆(±125°)에 붙는다
  const neck: Pt = [(hx - 0.57 * R) / pk, (0.82 * R) / pk];
  // 몸판은 역할색보다 한 단 밝게(tint 0.06, 팔 · 주먹은 shade 0.06 그대로): 실제 크기에서 둘레 음영이 번져도 몸 가운데
  // 원판(0.45r)이 역할색만큼 밝다 (VISUAL_SPEC 0장 ② 몸/바깥 링 대비 3:1 — 공격 범위 · 빛 바닥 위에서도)
  sk.part(
    path(P).smooth(platePts(PLATE.back, r.halfW, PLATE.shoulderX, PLATE.chest, neck, PLATE.rim, pk), 1).d,
    brightDome(tint(C.hoodie, 0.06), ink, 1.1),
    ink(OUTLINE),
    1,
    0.2,
  );
  // 2) 팔 (몸판 위): 서 있을 때 걸음 직전 자세, 걸으면 팔치기. 앞으로 간 손 · 구조 · 수감 때 주먹이 드러난다
  for (const side of [0, 1] as const) topArm(sk, r, side, fist[side], aft[side], body, topGlove, ink, P);
  // 3) 후드 끝 천: 머리 뒤에서 어깨 · 등 위로 흐르는 가늘어지는 끈. 가운데가 아니라 한쪽(오른쪽)으로 휘고 걸음마다
  //    출렁인다(뿌리 → 끝으로 갈수록 크고 늦게 — S자). 질주 때 곧게 뒤로 편다. 끝은 둥글고 몸판 안이라 실루엣은
  //    뒤로 뾰족해지지 않는다. 피격 때 몸 쪽으로 눌리고 수감 때 움츠러든다
  const tipX = TAIL.tipX - 0.08 * a + 0.1 * hit + 0.1 * captive;
  const tipY = TAIL.tipY * (1 - 0.55 * a);
  const wave = p.stride * (1 - 0.7 * a);
  const ph = p.walk + 0.9;
  const sway = (k: number, amp: number): number => amp * wave * Math.sin(ph - 2.2 * k);
  const root: Pt = [hx - 0.35 * R, hy + 0.06];
  const sp: Spine = {
    a: root,
    b: [root[0] + (tipX - root[0]) * 0.3, root[1] + (tipY - root[1]) * 0.62 + sway(1 / 3, 0.04)],
    c: [root[0] + (tipX - root[0]) * 0.66, tipY * 1.08 + sway(2 / 3, 0.09)],
    d: [tipX, tipY + sway(1, 0.13)],
  };
  const w0 = TAIL.rootW * (1 - 0.2 * a);
  const w1 = TAIL.tipW * (1 - 0.2 * a);
  // 끈은 외곽선 없이 칠 · 가는 테두리만: 작은 크기에서 몸판을 둘로 가르는 검은 선이 생기지 않는다(판 하나로 읽힌다).
  // hoodPath의 원은 여기서 끈 뿌리의 둥근 끝(반지름 = 뿌리 반폭)이고, 뿌리는 머리 밑에 숨긴다
  const tail = (grow: number, dx: number): string =>
    hoodPath(root[0] + dx, root[1], w0 + grow, sp, w0 + grow, w1 + grow, E, TAIL.taper);
  sk.fill(tail(0.03, -0.04), solid(ink(shade(C.deep, 0.4))), 0.18);
  // 칠 좌표도 경로와 같이 E로 옮긴다 (피격 때 칠이 끈에서 어긋나지 않게)
  const [l0x, l0y] = apply(E, root[0], 0);
  const [l1x, l1y] = apply(E, tipX, 0);
  sk.fill(
    tail(0, 0),
    linear(l0x, l0y, l1x, l1y, [
      [0, ink(tint(C.hoodie, 0.1))],
      [1, ink(C.hoodie)],
    ]),
  );
  sk.line(tail(0, 0), solid(ink(shade(C.hoodie, 0.3))), 0.025);
  // 천 끝 등줄 (끈 가운데 밝은 접힌 결: 위에서 빛을 받아 바람에 날리는 천으로 읽힌다)
  sk.line(
    path(E).curve(
      [0.3, 0.5, 0.7, 0.88].map((t): Pt => {
        const q = spineAt(sp, t);
        return [q.x, q.y];
      }),
    ).d,
    solid(ink(tint(C.hoodie, 0.28))),
    0.035,
  );
  // 4) 후드 머리: 어깨 위에 드리운 그늘(칠만) 위에 얹는다. 후드는 어깨보다 한 단 밝다(흑백에서도 머리가 어깨보다 밝다).
  //    윤곽은 앞이 반원, 뒤가 어깨 위로 길게 얹힌 반타원 (머리가 목 위의 공이 아니라 어깨에 걸친 후드로 읽힌다)
  const hood = (dx: number, grow: number): string =>
    path(E)
      .arc(hx + dx, hy, R + grow, -Math.PI / 2, Math.PI / 2)
      .arc(hx + dx, hy, (R + grow) * HEAD.back, Math.PI / 2, Math.PI * 1.5, false, R + grow)
      .Z().d;
  sk.fill(hood(-0.04, 0.03), solid(ink(shade(C.deep, 0.4))), 0.12);
  // 칠 중심도 경로와 같이 E로 옮긴다 (피격 때 하이라이트가 머리에서 어긋나지 않게)
  // (빛 중심은 앞뒤로 긴 후드 가운데 쪽으로 조금 뒤: 어깨 위에 얹힌 뒤쪽이 너무 어두워지지 않게 — 몸 가운데 역할색)
  const [gx, gy] = apply(E, hx - R * 0.25, hy - R * 0.1);
  sk.part(hood(0, 0), hoodPaint(ink, gx, gy, R * 1.45), ink(OUTLINE), 1, 0.3);
  // 정수리 솔기 (후드 가운데 접힌 선: 챙에서 어깨 위에 얹힌 후드 뒤 끝 가까이까지)
  sk.line(
    path(E).curve([
      [hx + R * 0.2, hy],
      [hx - R * 0.45, hy + 0.01],
      [hx - R * 1.1, hy + 0.04],
    ]).d,
    solid(ink(shade(C.hoodie, 0.16))),
    0.03,
  );
  // 5) 후드 앞 (짙은 구멍 + 챙). 질주 · 수감 때 고개를 숙여 구멍이 얇아지고, 질주 때 네온이 밝아진다
  topHoodFront(sk, ink, hx, hy, R, Math.max(a, captive), a, E);
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

/**
 * 정면 팔 (어깨 → 팔꿈치 → 주먹, 두 마디 캡슐) + 소매 끝 청록 네온 띠. far = 먼 쪽 팔 (몸 뒤, 한 단 어둡게 · 네온도 약하게)
 */
function bentArm(sk: Sketch, ink: Ink, neon: FrontNeon, sh: Pt, elbow: Pt, hand: Pt, far: boolean): void {
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
  // 소매 끝 띠 (청록 네온: 고무단을 가로지르는 짧은 고리 — 손목을 감싸게 손 쪽으로 조금 휜다)
  const nx = -Math.sin(ang) * 0.062;
  const ny = Math.cos(ang) * 0.062;
  neon.line(
    path()
      .M(cx - nx, cy - ny)
      .Q(cx + Math.cos(ang) * 0.025, cy + Math.sin(ang) * 0.025, cx + nx, cy + ny).d,
    0.02,
    far ? 0.6 : 0.95,
  );
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
function sideSneaker(
  sk: Sketch,
  ink: Ink,
  neon: FrontNeon,
  x: number,
  y: number,
  tilt: number,
  far: boolean,
): void {
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
  // 밑창 줄 (청록 네온): 갑피와 밝은 밑창 사이 이음매를 따라 뒤꿈치 → 앞코
  neon.line(
    path(m).curve([
      [x - len * 0.8, y + 0.035],
      [x, y + 0.066],
      [x + len * 0.8, y + 0.035],
    ]).d,
    0.019,
    far ? 0.55 : 1,
  );
}

/**
 * 3/4 다리 하나 (엉덩이 → 무릎 → 발목, 어두운 조거 바지 + 화면 쪽 청록 네온 옆줄 + 발목 고무단). far = 먼 쪽 (한 단 어둡게 ·
 * 네온도 약하게)
 */
function leg(sk: Sketch, ink: Ink, neon: FrontNeon, hip: Pt, knee: Pt, ankle: Pt, far: boolean): void {
  const base = far ? shade(C.pants, 0.2) : C.pants;
  const paint = linear(knee[0] - 0.12, 0, knee[0] + 0.12, 0, [
    [0, ink(tint(base, 0.1))],
    [1, ink(shade(base, 0.3))],
  ]);
  sk.part(path().capsule(hip[0], hip[1], knee[0], knee[1], 0.19, 0.175).d, paint, ink(OUTLINE));
  sk.part(path().capsule(knee[0], knee[1], ankle[0], ankle[1], 0.175, 0.15).d, paint, ink(OUTLINE));
  // 옆줄 (청록 네온 파이핑: 어두운 바지 위라 작은 카드에서도 선으로 남는다)
  neon.line(
    path().curve([
      [hip[0] - 0.07, hip[1] + 0.05],
      [knee[0] - 0.075, knee[1]],
      [ankle[0] - 0.06, ankle[1] - 0.04],
    ]).d,
    0.019,
    far ? 0.55 : 0.95,
  );
  const shin = Math.atan2(ankle[1] - knee[1], ankle[0] - knee[0]);
  sk.fill(path().ellipse(ankle[0], ankle[1], 0.03, 0.085, shin).d, solid(ink(shade(C.pants, 0.3))));
}

/**
 * 3/4 다리 (달리기 한가운데, 체공 순간): 먼 다리는 뒤로 차고 나가며 앞코로 땅을 밀고, 가까운 다리는 무릎을 앞(오른쪽)으로
 * 높이 들어 발이 땅에서 떠 있다(앞코를 살짝 든다) — 그림만 봐도 오른쪽으로 달린다
 */
function frontRunnerLegs(sk: Sketch, ink: Ink, neon: FrontNeon): void {
  const hipY = FRONT.hipY - 0.05;
  leg(sk, ink, neon, [0.1, hipY], [-0.02, 0.66], [-0.27, 0.8], true);
  sideSneaker(sk, ink, neon, -0.24, 0.82, 0.6, true);
  leg(sk, ink, neon, [-0.04, hipY], [0.3, 0.5], [0.27, 0.68], false);
  sideSneaker(sk, ink, neon, 0.34, 0.73, -0.12, false);
}

/**
 * 3/4 얼굴 (후드 구멍 안): 얼굴이 달리는 쪽(오른쪽)을 비스듬히 본다. 가까운 왼쪽 볼은 둥글고 넓게, 먼 오른쪽은 납작하게
 * 줄고 코가 윤곽 밖으로 살짝 나온다. 가운데 선(눈 · 입 자리)이 오른쪽으로 치우치고, 먼 쪽 눈은 좁고 얼굴 가장자리 가까이
 */
function frontFace(sk: Sketch, ink: Ink, neon: FrontNeon, hcx: number, hy: number, sway: number): void {
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
  // 후드 테두리 (두꺼운 고무단 + 청록 네온 선). 네온은 고무단 바깥쪽 반에 둬 번짐이 얼굴(살색)보다 후드 천 쪽으로 퍼진다
  const rim = path().ellipse(ox, fy, 0.27, 0.3).d;
  sk.line(rim, solid(ink(shade(C.hoodie, 0.1))), 0.07);
  neon.line(path().ellipse(ox, fy, 0.283, 0.313).d, 0.024, 0.95);
  // 후드 끈 (목에서 늘어진 두 줄, 달리는 바람에 뒤로 날린다 — 청록 네온 끈 + 빛나는 끈 끝)
  for (const s of [-1, 1]) {
    const x0 = cl + s * 0.06;
    const x1 = x0 - 0.05 + sway * 0.4;
    neon.line(
      path()
        .M(x0, fy + 0.29)
        .Q(x0 - 0.01, fy + 0.34, x1, fy + 0.39).d,
      0.016,
      0.75,
    );
    sk.fill(path().roundRect(x1 - 0.015, fy + 0.38, 0.03, 0.05, 0.012).d, solid(ink(C.sole)));
    neon.dot(x1, fy + 0.405, 0.016, 1);
  }
}

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const neon = frontNeon(sk, p.tone);
  const by = frontBreath(p.t);
  const sway = Math.sin(p.t * 2.4) * 0.05;
  const mid = QUARTER.mid;
  // 1) 먼 팔 (앞으로 치는 팔, 몸 뒤): 어깨 → 아래 앞 팔꿈치 → 가슴 앞 주먹. 먼 어깨는 몸 안쪽(3/4 원근으로 좁다)
  bentArm(
    sk,
    ink,
    neon,
    apply(LEAN, 0.17, FRONT.shoulderY + 0.08 + by),
    [0.4, 0.3 + by],
    [0.5, 0.12 + by],
    true,
  );
  // 2) 다리 (어두운 조거 바지) + 큰 운동화
  if (!p.bust) frontRunnerLegs(sk, ink, neon);
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
  // 가슴 » 갈매기 무늬 (청록 네온: 넓은 은은한 빛 + 밝은 선)
  const chev = path(LEAN)
    .M(mid - 0.11, 0.11 + by)
    .L(mid - 0.04, 0.17 + by)
    .L(mid - 0.11, 0.23 + by)
    .M(mid - 0.02, 0.11 + by)
    .L(mid + 0.05, 0.17 + by)
    .L(mid - 0.02, 0.23 + by).d;
  neon.line(chev, 0.03, 1);
  // 4) 가까운 팔 (뒤로 젖힌 팔, 몸 앞): 어깨 → 뒤로 뺀 팔꿈치 → 허리 뒤 주먹. 가까운 어깨는 바깥쪽(넓게 보인다)
  bentArm(
    sk,
    ink,
    neon,
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
  frontFace(sk, ink, neon, hcx, hy, sway);
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
