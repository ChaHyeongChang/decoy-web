// 의상 '망토' (생존자 의상 400 불씨, 판 밖 메타 c): 어깨를 덮고 등 가운데까지 내려오는 짧은 망토 + 목 앞 쇠 걸쇠.
// 위 그림 (게임 화면): 휴대폰 크기(몸 반지름 약 7px)에서도 등 뒤 반이 '짙은 천 + 넓고 밝은 안감 아랫단' 두 톤으로 읽히게
// 실루엣(크기)이 아니라 밝기 · 대비로 기본과 가른다 — 몸판(역할색)보다 확실히 어두운 천이 머리 뒤 윗등 · 어깨를 덮고,
// 아랫단은 접어 올린 밝은 안감 띠(바깥 테 안쪽에만 — 윤곽은 그대로. 뒤 가운데에서 가장 넓고 옆으로 가늘어진다)와 물결 셋.
// 안감 띠는 접힌 곳(천 쪽)이 가장 밝고 아랫단 끝으로 한 단 내려가며, 접힌 곳 위에 천 그늘 선이 있어 짙은 천과 갈린다.
// 머리 바로 뒤 목둘레를 따라 어깨를 가로지르는 어깨 망토 띠(아랫단 밝은 결 · 밑 그늘) + 띠 양 끝 쇠 걸쇠를 잇는 사슬,
// 띠 밑에서 나와 아랫단 물결 배로 퍼지는 넓은 주름 결 셋(어깨 둘 · 목덜미 하나, 빛 받는 쪽)과 그 사이 골 둘.
// 팔은 망토 위에 남는다: 러너는 팔 안쪽 폭으로 지나 등 뒤로 흐르고(목둘레는 몸 가운데 0.45r 원판 둘레를 따라 돈다),
// 가드는 어깨 갑옷 뒤 반을 덮고(정면 그림의 어깨 망토처럼 — 갑옷 앞 반 · 방패 · 헬멧은 그대로), 스카우트는 소매 밑에서
// 시작한다(스카우트 배낭 · 안테나는 망토가 대신한다 — hidesPack).
// 역할 실루엣은 지킨다(VISUAL_SPEC 0장 ④ — 역할끼리 겹침 0.8 이하): 러너는 허리 쪽이 좁은 등 윤곽 안에, 스카우트는 어깨와
// 등 사이 오목한 허리를 남기고 아랫단에서 퍼진다(둥근 가드 원판과 갈린다).
// 정면 그림: 몸 뒤로 양옆에 펼쳐진 망토 자락(안감이 보이고, 바깥으로 젖힌 끝은 겉감 · 아랫단 테두리) +
// 어깨를 덮는 짧은 어깨 망토(겉감, 아랫단 테두리 · 청록 네온 솔기) + 목 앞 둥근 쇠 걸쇠(가운데 청록 네온 보석).
// 러너(3/4)는 자락이 등 쪽(화면 왼쪽)으로 물결치며 날린다. 상반신은 자락을 짧게 해 상자 안에 둔다.
// 움직임: 위 그림 아랫단은 걸음마다 옆으로 흔들리고(목둘레는 제자리, 아랫단일수록 크게) 물결이 흐른다. 러너 질주 때 뒤로
// 길게 모여 펄럭이고, 수감 때 몸에 붙고, 피격 때 눌린다(러너는 옆으로 꺾이는 후드를 같이 따라 돈다). 정면 자락 ·
// 아랫단은 바람(sway)에 흔들린다.
// 정면 색: 겉감 = 역할색 45% 어둡게(러너 #204887 · 가드 #5C2F88 · 스카우트 #136C34), 안감 = 65% 어둡게(#152E56 · #3B1E56 ·
// #0C4521), 테두리 = 역할색 15% 밝게(#5895F7 · #B56FF8 · #43CE76), 걸쇠 쇠 #CBD5E1.
// 위 그림 색(topColors): 천 = 역할색 64% 어둡게(#152F59 · #3C1F59 · #0C4722), 아랫단 쪽 74%(#0F2240 · #2C1640 · #093318),
// 어깨 망토 띠 60%(#183462 · #432263 · #0E4F26), 주름 결 40%(#234E94 · #653394 · #147638), 골 84%(#091527 · #1B0E28 ·
// #05200F — 안감 접힌 곳 그늘 선도 이 색), 안감 띠 = 역할색을 밝게 — 접힌 곳 66%(#BCD5FC · #E1C5FC · #B4EBC8) → 가운데
// 55%(#A7C7FB · #D8B3FB · #9CE5B7) → 아랫단 끝 45%(#93BAFA · #CFA2FB · #85DFA6). 안감은 역할색 계열로만 밝힌다(다른 역할색 ·
// 빨강 · 주황 · 청록 · 흰색 위장과 겹치지 않게, 66% 넘게 밝히지 않는다). 걸쇠 · 사슬 = 쇠 #CBD5E1 그늘. 위 그림에는 청록을
// 쓰지 않는다.
import { ROLE } from '../../palette';
import {
  apply,
  linear,
  mul,
  path,
  radial,
  rotate,
  shade,
  solid,
  tint,
  type Mat,
  type Path,
  type Sketch,
} from '../kit';
import type { RoleCharId } from '../types';
import type { Pt, SurvivorCostumeArt, SurvivorFrontAnchor, SurvivorTopAnchor } from './types';

/** 걸쇠 쇠 */
const STEEL = 0xcbd5e1;

/** 망토 색 (입은 역할색에서): 겉감 · 안감 · 테두리 */
function capeColors(role: RoleCharId): { outer: number; lining: number; trim: number } {
  const c = ROLE[role];
  return { outer: shade(c, 0.45), lining: shade(c, 0.65), trim: tint(c, 0.15) };
}

/**
 * 위 그림 망토 색 (입은 역할색에서): 휴대폰 크기에서 등 뒤 반이 '짙은 천 + 밝은 안감 아랫단' 두 톤으로 읽히게 천은
 * 몸판(역할색)보다 확실히 어둡게 — 천 64% · 아랫단 쪽 74% 어둡게, 어깨 망토 띠는 빛을 받아 한 단 밝게(60%), 주름 결 40% ·
 * 골 84%, 띠 아랫단 결 32%. 안감 띠는 몸판보다 확실히 밝게 — 접힌 곳 66% · 가운데 55% · 아랫단 끝 45% 밝게. 띠 · 결은
 * 작은 크기에서 천의 어둠을 깨지 않게 가늘거나 천과 가깝게 둔다
 */
function topColors(role: RoleCharId): {
  cloth: number;
  deep: number;
  mantle: number;
  ridge: number;
  valley: number;
  lip: number;
  lining: number;
  liningHi: number;
  liningLo: number;
} {
  const c = ROLE[role];
  return {
    cloth: shade(c, 0.64),
    deep: shade(c, 0.74),
    mantle: shade(c, 0.6),
    ridge: shade(c, 0.4),
    valley: shade(c, 0.84),
    lip: shade(c, 0.32),
    lining: tint(c, 0.55),
    liningHi: tint(c, 0.66),
    liningLo: tint(c, 0.45),
  };
}

const DEG = Math.PI / 180;

/** 0~1 부드러운 계단 */
function smooth01(v: number): number {
  const t = Math.min(1, Math.max(0, v));
  return t * t * (3 - 2 * t);
}

// ───────────────────────── 위 그림 ─────────────────────────

/** 극좌표 표 [각(도, 0 = 앞 · 180 = 바로 뒤), 반지름] */
type Polar = readonly (readonly [number, number])[];

/**
 * 위 그림 역할별 망토 자리 (몸 기준, 오른쪽 반 — 왼쪽은 대칭):
 *  outer = 바깥 테(앞 끝 → 뒤 가운데), inner = 목둘레 안 테(앞 끝 → 뒤 가운데), hem = 아랫단 물결이 시작되는 각,
 *  trim = 안감 띠가 시작되는 각(가드 · 스카우트는 갑옷 · 소매 밑에서), mantle = 어깨 망토 띠 아랫단 반지름(뒤 가운데),
 *  mantleFrom = 어깨 망토 띠가 시작되는 각(가드는 어깨 갑옷 뒤 끝 밖에서), clasp = 걸쇠 각(머리 · 갑옷 · 소매에 가리지 않는 곳)
 */
interface TopFit {
  readonly outer: Polar;
  readonly inner: Polar;
  readonly hem: number;
  readonly trim: number;
  readonly mantle: number;
  readonly mantleFrom: number;
  readonly clasp: number;
  /** 아랫단 안감 띠 두께 (뒤 가운데, 옆으로 가늘어진다). 띠 안쪽 끝은 어깨 망토 띠 · 머리 뒤보다 밖 — 짙은 천이 남는다 */
  readonly band: number;
}

const TOP_FIT: Readonly<Record<RoleCharId, TopFit>> = {
  // 러너: 앞 끝은 후드 밑(목), 어깨에서는 몸 가운데 원판(0.45r)과 팔 사이로 좁게 지나 등 뒤로 흐른다 (팔치기를 덮지 않게).
  // 아랫단은 몸판의 좁은 허리 윤곽 근처에서 끝난다 — 더 길면 등이 둥글게 차서 가드 원판과 실루엣이 겹친다
  runner: {
    outer: [
      [40, 0.7],
      [60, 0.63],
      [90, 0.56],
      [112, 0.6],
      [128, 0.7],
      [145, 0.79],
      [162, 0.85],
      [180, 0.87],
    ],
    inner: [
      [40, 0.6],
      [55, 0.52],
      [75, 0.48],
      [180, 0.47],
    ],
    hem: 126,
    trim: 118,
    mantle: 0.555,
    mantleFrom: 44,
    clasp: 80,
    band: 0.24,
  },
  // 가드: 어깨 갑옷 뒤 반을 덮고(어깨 망토 — 정면 그림처럼 어깨를 덮는다) 등판을 덮는다. 바깥 테는 갑옷 · 등판 윤곽 바로
  // 안쪽을 따른다 (실루엣 그대로 — 둥근 원판). 갑옷 앞 반 · 방패 · 헬멧은 그대로 보인다
  guard: {
    outer: [
      [86, 0.965],
      [96, 0.955],
      [106, 0.94],
      [114, 0.935],
      [124, 0.96],
      [134, 0.965],
      [180, 0.965],
    ],
    inner: [
      [86, 0.6],
      [106, 0.56],
      [180, 0.5],
    ],
    hem: 120,
    trim: 90,
    mantle: 0.69,
    mantleFrom: 89,
    clasp: 100,
    band: 0.25,
  },
  // 스카우트: 앞 끝은 소매 어깨 밑, 어깨와 등 사이는 오목하게 좁히고(허리) 등 뒤 배낭 자리에서 퍼진다 — 다 채우면 둥근
  // 가드와 실루엣이 겹친다
  scout: {
    outer: [
      [96, 0.85],
      [112, 0.81],
      [132, 0.8],
      [156, 0.92],
      [180, 0.96],
    ],
    inner: [
      [96, 0.55],
      [180, 0.5],
    ],
    hem: 120,
    trim: 100,
    mantle: 0.69,
    mantleFrom: 99,
    clasp: 116,
    band: 0.27,
  },
};

/** 표 사이 부드러운 보간 */
function polarAt(t: Polar, deg: number): number {
  const first = t[0] ?? [0, 0];
  if (deg <= first[0]) return first[1];
  for (let i = 1; i < t.length; i += 1) {
    const a = t[i - 1] ?? first;
    const b = t[i] ?? first;
    if (deg <= b[0]) return a[1] + (b[1] - a[1]) * smooth01((deg - a[0]) / (b[0] - a[0] || 1));
  }
  return (t[t.length - 1] ?? first)[1];
}

/** 아랫단 물결 수(주름 결 셋과 맞춘다) · 깊이 · 안감 띠를 바깥 테에서 들인 거리 */
const HEM = { n: 3, depth: 0.03, trimIn: 0.006 } as const;

/** 뒤쪽 크기 한도 (SIZE_RULE 뒤 1.0r, 곡선 · 반올림 여유) · 옆 한도 */
const BACK_MAX = 0.975;
const SIDE_MAX = 1.02;

/** 그림 좌표 점 다듬기: 뒤(x < 0)는 BACK_MAX, 앞은 SIDE_MAX 안으로 */
function clampTop(p: Pt): Pt {
  const r = Math.hypot(p[0], p[1]);
  const lim = p[0] < 0 ? BACK_MAX : SIDE_MAX;
  return r > lim ? [(p[0] * lim) / r, (p[1] * lim) / r] : p;
}

/** 망토 위 그림 상태 (자세에서 한 번 계산) */
interface TopState {
  readonly f: TopFit;
  readonly M: Mat;
  readonly a: SurvivorTopAnchor;
  /** 앞 끝 각 (도) */
  readonly tip: number;
  /** 질주 펴짐 0~1 · 수감 움츠림 0/1 */
  readonly fly: number;
  readonly tuck: number;
}

/** 각 → 앞 끝에서 아랫단까지 깊이 0~1 */
function depthOf(st: TopState, deg: number): number {
  return Math.min(1, Math.max(0, (deg - st.tip) / (180 - st.tip)));
}

/** 아랫단 자리 u (0 = 왼쪽 끝 · 0.5 = 뒤 가운데 · 1 = 오른쪽 끝), 아랫단 밖이면 −1 */
function hemU(f: TopFit, deg: number, side: 1 | -1): number {
  if (deg < f.hem) return -1;
  const span = 180 - f.hem;
  return (side * (180 - deg) + span) / (2 * span);
}

/** u → 각 · 쪽 */
function hemDeg(f: TopFit, u: number): { deg: number; side: 1 | -1 } {
  const span = 180 - f.hem;
  const psi = u * 2 * span - span;
  return { deg: 180 - Math.abs(psi), side: psi < 0 ? -1 : 1 };
}

/** 바깥 테 반지름 (물결 · 펴짐 · 움츠림 반영) */
function outerR(st: TopState, deg: number, side: 1 | -1): number {
  const { f, a } = st;
  const inner = polarAt(f.inner, deg);
  const k = depthOf(st, deg);
  let r = polarAt(f.outer, deg) + 0.04 * st.fly * k * k;
  const u = hemU(f, deg, side);
  if (u >= 0) {
    // 물결: 홈(u = j/n)과 둥근 배(그 사이)가 번갈아, 양 끝은 옆 테로 이어진다
    const env = Math.sqrt(Math.sin(Math.PI * u));
    r -= (HEM.depth * env * (1 + Math.cos(2 * Math.PI * HEM.n * u))) / 2;
    // 걸음 · 질주 펄럭임: 아랫단을 따라 흐른다 (양 끝은 옆 테로 이어지게 0)
    const flap = 0.02 * a.stride * (1 - st.tuck) + 0.02 * st.fly;
    r += flap * env * Math.sin(a.walk * (1 + st.fly) - u * 7) * k * k;
  }
  // 수감 · 피격: 목둘레 쪽으로 눌린다
  const press = 0.14 * st.tuck + 0.08 * a.hit;
  return inner + (r - inner) * (1 - press);
}

/** 극좌표 → 그림 좌표 (질주 · 수감 때 아랫단을 뒤로 모으고, 걸음 옆 흔들림을 더한다) */
function topPt(st: TopState, deg: number, r: number, side: 1 | -1): Pt {
  const k = depthOf(st, deg);
  const gather = 0.12 * st.fly * k * k + 0.05 * st.tuck;
  const th = (180 - (180 - deg) * (1 - gather)) * DEG;
  // 걸음 옆 흔들림: 아랫단일수록 크게 (몸 비틀림보다 늦게 따라온다). 목둘레(안 테)는 제자리 — 몸 가운데 원판(0.45r)을
  // 덮지 않고, 목에 매인 천의 아랫단만 흔들린다
  const ri = polarAt(st.f.inner, deg);
  const hang = Math.min(1, Math.max(0, (r - ri) / (polarAt(st.f.outer, deg) - ri || 1)));
  const y = side * r * Math.sin(th) - 0.09 * st.a.s * (1 - st.tuck) * k * k * hang;
  return clampTop(apply(st.M, r * Math.cos(th), y));
}

/** 앞 끝 테 점들 (바깥 → 안): 둥근 끝 */
function tipEdge(st: TopState, side: 1 | -1): Pt[] {
  const ro = outerR(st, st.tip, side);
  const ri = polarAt(st.f.inner, st.tip);
  return [
    topPt(st, st.tip, ro, side),
    topPt(st, st.tip - 4, (ro + ri) / 2, side),
    topPt(st, st.tip, ri, side),
  ];
}

function topBack(sk: Sketch, a: SurvivorTopAnchor): void {
  const { ink } = a;
  const f = TOP_FIT[a.role];
  const col = topColors(a.role);
  // 몸 비틀림보다 조금 늦게 돈다 (몸 중심 기준 회전 — 크기 그대로). 러너 피격 때는 옆으로 꺾이는 후드(runner.ts E =
  // 0.22 × hit 회전)를 같이 따라 돈다 — 안 돌면 후드가 비켜난 쪽(왼쪽) 앞 끝이 어깨 위에 끈 끝처럼 드러난다
  const turn = -0.05 * a.s * (1 - a.captive) + (a.role === 'runner' ? 0.22 * a.hit : 0);
  const st: TopState = {
    f,
    M: mul(a.body, rotate(turn)),
    a,
    // 러너: 수감 때는 두 팔이 어깨에서 가슴 앞으로 모여 어깨 띠를 가로지른다 — 앞 끝을 팔 관절 뒤로 물린다 (피격 때는
    // 후드와 같이 돌아 앞 끝이 뒤로 밀린 후드 밑에 그대로 숨는다)
    tip: (f.outer[0] ?? [90, 0])[0] + (a.role === 'runner' ? 78 * a.captive : 0),
    fly: a.role === 'runner' ? a.action : 0,
    tuck: a.captive,
  };
  /** 안 테와 바깥 테 사이 자리 (0 = 목둘레, 1 = 바깥 테) */
  const at = (deg: number, side: 1 | -1, k: number): number => {
    const ri = polarAt(f.inner, deg);
    return ri + (outerR(st, deg, side) - ri) * k;
  };
  // 1) 망토 천: 오른쪽 앞 끝(안 → 바깥) → 바깥 테 → 왼쪽 앞 끝(바깥 → 안) → 목둘레. 몸판보다 확실히 어둡고 아랫단 쪽이 더 깊다
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let d = st.tip + 4; d <= 180; d += 4) {
    right.push(topPt(st, d, outerR(st, d, 1), 1));
    if (d < 180) left.unshift(topPt(st, d, outerR(st, d, -1), -1));
  }
  const neck: Pt[] = [];
  for (let d = -180 + 8; d < 180; d += 8) {
    const deg = 180 - Math.abs(d);
    if (deg >= st.tip + 4) neck.push(topPt(st, deg, polarAt(f.inner, deg), d < 0 ? -1 : 1));
  }
  const outline: Pt[] = [...tipEdge(st, 1).reverse(), ...right, ...left, ...tipEdge(st, -1)];
  const [cx, cy] = apply(a.body, 0, 0);
  const rIn = polarAt(f.inner, 180);
  const rOut = polarAt(f.outer, 180);
  sk.part(
    path().curve(outline).curve(neck, 1, false).Z().d,
    radial(cx, cy, rOut, [
      [rIn / rOut, ink(col.cloth)],
      [0.8, ink(col.cloth)],
      [1, ink(col.deep)],
    ]),
    a.outline,
    1,
    0.4,
  );
  // 2) 주름: 어깨 망토 밑에서 나와 아랫단 물결 배로 퍼지는 넓은 결 셋(빛 받는 등 · 어깨 쪽) + 그 사이 물결 홈으로 가는 골 둘.
  //    결은 어깨(옆 결) · 목덜미(가운데 결)에서 시작해 아랫단까지 — 작은 크기에서도 짙은 천 위에 밝은 결이 남는다
  for (let j = 1; j < HEM.n * 2; j += 1) {
    const u = j / (HEM.n * 2);
    const ridge = j % 2 === 1;
    const { deg, side } = hemDeg(f, u);
    // 뒤 가운데에서 끝까지 0~1: 옆 결은 어깨(앞 끝 가까이)에서, 골은 그 사이에서, 가운데 결은 목덜미에서 시작한다
    const off = Math.abs(u - 0.5) * 2;
    const deg0 = deg - (deg - st.tip - 8) * (ridge ? 1 : 0.6) * Math.min(1, off * 1.5);
    const k0 = ridge && off > 0 ? 0.45 : 0.3;
    const ri1 = polarAt(f.inner, deg);
    const ro1 = outerR(st, deg, side);
    const k1 = (ro1 - f.band - 0.02 - ri1) / (ro1 - ri1);
    const pts: Pt[] = [];
    for (let i = 0; i <= 4; i += 1) {
      const t = i / 4;
      const dg = deg0 + (deg - deg0) * t;
      pts.push(topPt(st, dg, at(dg, side, k0 + (k1 - k0) * t), side));
    }
    const p0 = pts[0] ?? [0, 0];
    const p2 = pts[4] ?? p0;
    const c = ink(ridge ? col.ridge : col.valley);
    sk.line(
      path().curve(pts).d,
      linear(p0[0], p0[1], p2[0], p2[1], [
        [0, c, 0],
        [0.18, c, 0.85],
        [1, c, ridge ? 0.7 : 0.85],
      ]),
      ridge ? 0.08 : 0.05,
    );
  }
  // 3) 어깨 망토 띠: 목둘레를 따라 어깨를 가로지르는 짧은 겹 (빛을 받아 한 단 밝다). 아랫단 밑 그늘 · 아랫단 밝은 결
  const mw = f.mantle - rIn;
  const from = Math.max(f.mantleFrom, st.tip + 3);
  const m0: Pt[] = [];
  const m1: Pt[] = [];
  const mShadow: Pt[] = [];
  for (let d = -(180 - from); d <= 180 - from + 1e-6; d += 4) {
    const deg = 180 - Math.abs(d);
    const side: 1 | -1 = d < 0 ? -1 : 1;
    const ri = polarAt(f.inner, deg);
    const ends = smooth01((deg - from) / 12);
    const ro = Math.min(ri + mw * (0.35 + 0.65 * ends), at(deg, side, 0.6));
    m0.push(topPt(st, deg, ri, side));
    m1.push(topPt(st, deg, ro, side));
    mShadow.push(topPt(st, deg, ro + 0.02, side));
  }
  sk.line(path().curve(mShadow).d, solid(ink(col.valley)), 0.05, 'round', 0.7);
  sk.fill(
    path().curve(m0).curve(m1.slice().reverse(), 1, false).Z().d,
    radial(cx, cy, f.mantle, [
      [rIn / f.mantle, ink(tint(col.mantle, 0.06))],
      [1, ink(col.mantle)],
    ]),
  );
  sk.line(path().curve(m1).d, solid(ink(col.lip)), 0.018);
  // 4) 아랫단 안감 띠 (접어 올린 안감, 바깥 테 안쪽을 따라 — 윤곽은 그대로, 끝은 가늘어진다): 몸판보다 확실히 밝은 역할색.
  //    휴대폰 크기에서 짙은 천과 함께 등 뒤 반이 두 톤(짙은 윗등 · 밝은 아랫단)으로 읽힌다
  const band0: Pt[] = [];
  const band1: Pt[] = [];
  const t0 = Math.max(f.trim, st.tip + 2);
  for (let d = -(180 - t0); d <= 180 - t0 + 1e-6; d += 3) {
    const deg = 180 - Math.abs(d);
    const side: 1 | -1 = d < 0 ? -1 : 1;
    const ends = smooth01((deg - t0) / 10);
    // 옆은 가늘게, 아랫단(뒤)에서 가장 넓게 — 작은 크기에서 둥근 고리가 아니라 등 끝의 밝은 아랫단으로 읽힌다
    const hemK = smooth01((deg - f.hem + 16) / 24);
    const r = outerR(st, deg, side) - HEM.trimIn;
    band0.push(topPt(st, deg, r, side));
    // 안쪽 끝은 목둘레(안 테)보다 밖 — 수감 · 피격으로 아랫단이 눌려도 몸 가운데 0.45r 원판 쪽으로 들어가지 않는다
    const w = f.band * (0.15 + 0.85 * ends) * (0.55 + 0.45 * hemK);
    band1.push(topPt(st, deg, Math.max(r - w, polarAt(f.inner, deg) + 0.03), side));
  }
  const bandOut = rOut - HEM.trimIn;
  const bandIn = bandOut - f.band;
  sk.fill(
    path().curve(band0).curve(band1.slice().reverse(), 1, false).Z().d,
    radial(cx, cy, bandOut, [
      [bandIn / bandOut, ink(col.liningHi)],
      [(bandIn + f.band * 0.5) / bandOut, ink(col.lining)],
      [1, ink(col.liningLo)],
    ]),
  );
  // 접힌 곳 그늘 (천 밑으로 들어가는 안감 윗선) — 큰 크기에서 짙은 천과 밝은 안감 두 겹이 또렷하게. 밝기 띠(radial)는
  // 몸 중심 기준이라 뒤 가운데에서 접힌 곳 66% → 끝 45%로 맞고, 바깥 테가 안으로 들어간 옆은 접힌 곳 색으로 남는다
  sk.line(path().curve(band1).d, solid(ink(col.valley)), 0.03, 'round', 0.9);
  // 5) 걸쇠 사슬: 어깨 망토 띠 양 끝의 둥근 쇠 걸쇠 둘을 머리 뒤로 잇는 사슬 (가운데는 머리 밑에 숨는다)
  const chain: Pt[] = [];
  for (let d = -(180 - f.clasp); d <= 180 - f.clasp + 1e-6; d += 3) {
    const deg = 180 - Math.abs(d);
    const side: 1 | -1 = d < 0 ? -1 : 1;
    const ri = polarAt(f.inner, deg);
    chain.push(topPt(st, deg, ri + mw * 0.55, side));
  }
  sk.line(path().curve(chain).d, solid(ink(shade(STEEL, 0.62))), 0.028);
  // 고리 (밝은 점, 하나 걸러) — 한 경로로
  const links = path();
  for (let i = 1; i < chain.length - 1; i += 2) {
    const [x, y] = chain[i] ?? [0, 0];
    links.circle(x, y, 0.01);
  }
  sk.fill(links.d, solid(ink(shade(STEEL, 0.35))));
  for (const p of [chain[0], chain[chain.length - 1]]) {
    if (!p) continue;
    const [x, y] = p;
    sk.part(
      path().circle(x, y, 0.045).d,
      radial(x - 0.015, y - 0.015, 0.065, [
        [0, ink(tint(STEEL, 0.4))],
        [1, ink(shade(STEEL, 0.4))],
      ]),
      a.outline,
      1,
      0.35,
    );
  }
}

// ───────────────────────── 정면 ─────────────────────────

/** 자락 바깥 테 (그림 좌표): 어깨 위 시작 + 3차 곡선 조각들 [조절점 1 · 조절점 2 · 끝] (마지막 끝 = 아랫단 끝) */
interface Flap {
  readonly top: Pt;
  readonly segs: readonly (readonly [Pt, Pt, Pt])[];
}

const flapEnd = (fl: Flap): Pt => fl.segs[fl.segs.length - 1]?.[2] ?? fl.top;

/** 바깥 테를 지금 점(어깨 위)에서 이어 그린다 */
function flapPath(p: Path, fl: Flap): Path {
  for (const [c1, c2, e] of fl.segs) p.C(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  return p;
}

/** 바깥 테를 거꾸로 (아랫단 끝 → 어깨 위). shift = 조각 자리 0~1 → 안쪽으로 옮길 x */
function flapPathBack(p: Path, fl: Flap, shift: (t: number) => number = () => 0): Path {
  const n = fl.segs.length;
  for (let i = n - 1; i >= 0; i -= 1) {
    const [c1, c2] = fl.segs[i] ?? [fl.top, fl.top];
    const start = i === 0 ? fl.top : (fl.segs[i - 1]?.[2] ?? fl.top);
    p.C(
      c2[0] + shift((i + 2 / 3) / n),
      c2[1],
      c1[0] + shift((i + 1 / 3) / n),
      c1[1],
      start[0] + shift(i / n),
      start[1],
    );
  }
  return p;
}

/** 젖힌 끝 (겉감 띠: 어깨에서 0 → 아랫단 끝에서 넓게) */
function flapEdge(sk: Sketch, a: SurvivorFrontAnchor, fl: Flap, wide: number): void {
  const { ink } = a;
  const col = capeColors(a.role);
  const end = flapEnd(fl);
  const inward = end[0] < fl.top[0] ? 1 : -1;
  const shift = (t: number): number => inward * wide * t ** 1.3;
  sk.fill(
    flapPathBack(
      flapPath(path().M(fl.top[0], fl.top[1]), fl).L(end[0] + shift(1), end[1] + 0.012),
      fl,
      shift,
    ).Z().d,
    linear(fl.top[0], fl.top[1], end[0], end[1], [
      [0, ink(tint(col.outer, 0.2))],
      [1, ink(col.outer)],
    ]),
  );
}

/** 정면 자락 (몸 뒤): 안감 + 젖힌 끝 + 주름 + 아랫단 테두리 */
function frontBehind(sk: Sketch, a: SurvivorFrontAnchor): void {
  const { ink } = a;
  const col = capeColors(a.role);
  const sw = 0.035 * a.sway;
  const sy = a.shoulderY;
  const ny = a.neck[1];
  let outline: string;
  let hemLine: string;
  let flaps: Flap[];
  let folds: [Pt, Pt, Pt][];
  let shadeBox: [number, number, number, number];
  if (a.facing === 1) {
    // 3/4 (러너): 등 쪽(화면 왼쪽)으로 물결치며 날린다. 가슴 쪽 끝은 몸 뒤에 숨는다
    const T = a.torso;
    const near = apply(T, -0.28, sy - 0.05);
    const far = apply(T, 0.22, sy - 0.02);
    const nape = apply(T, -0.02, ny - 0.08);
    const farLow = apply(T, 0.2, a.hipY - 0.04);
    // 바깥 테는 두 물결 (어깨 → 마루 → 아랫단 끝), 바람에 마루 · 끝이 오르내린다
    const end: Pt = a.bust ? [-0.58 + sw * 0.3, 0.24 + sw * 0.4] : [-0.9 + sw * 0.6, 0.36 + sw];
    const crest: Pt = a.bust ? [-0.42 + sw * 0.2, 0.03 + sw * 0.5] : [-0.58 + sw * 0.4, 0.05 + sw * 0.8];
    const fl: Flap = {
      top: near,
      segs: [
        [[near[0] - 0.1, near[1] - 0.06], [crest[0] + 0.14, crest[1] - 0.07], crest],
        [[crest[0] - 0.12, crest[1] + 0.06], [end[0] + 0.1, end[1] - 0.14], end],
      ],
    };
    const hy = a.bust ? 0.4 : 0.56;
    const h1: Pt = [end[0] * 0.64 + sw * 0.4, hy - 0.03 + sw * 0.4];
    const h2: Pt = [end[0] * 0.28, hy + 0.03];
    const h3: Pt = [0.08, hy - 0.04];
    const outlineP = path()
      .M(nape[0], nape[1])
      .Q(near[0] + 0.06, near[1] - 0.06, near[0], near[1]);
    outline = flapPath(outlineP, fl)
      .Q(end[0] + 0.1, h1[1] + 0.07, h1[0], h1[1])
      .Q((h1[0] + h2[0]) / 2, h2[1] - 0.06, h2[0], h2[1])
      .Q((h2[0] + h3[0]) / 2, h3[1] + 0.05, h3[0], h3[1])
      .Q(farLow[0] + 0.02, farLow[1] + 0.06, farLow[0], farLow[1])
      .L(far[0], far[1])
      .Q(nape[0] + 0.1, nape[1] - 0.02, nape[0], nape[1])
      .Z().d;
    hemLine = path()
      .M(end[0], end[1])
      .Q(end[0] + 0.1, h1[1] + 0.07, h1[0], h1[1])
      .Q((h1[0] + h2[0]) / 2, h2[1] - 0.06, h2[0], h2[1])
      .Q((h2[0] + h3[0]) / 2, h3[1] + 0.05, h3[0], h3[1]).d;
    flaps = [fl];
    folds = [
      [
        [near[0] - 0.06, near[1] + 0.1],
        [end[0] * 0.55, near[1] + 0.2 + sw * 0.5],
        [h1[0] + 0.02, h1[1] - 0.04],
      ],
      [
        [near[0] + 0.02, near[1] + 0.16],
        [end[0] * 0.3, hy - 0.16],
        [h2[0] + 0.03, h2[1] - 0.05],
      ],
    ];
    shadeBox = [end[0], near[1], 0.2, hy];
  } else {
    const hw = a.halfW;
    // 상반신 끝 반폭: 바람에 흔들려도 상반신 배율(가드 1.45 · 스카우트 1.5)에서 상자 좌우 안 (|x| ≤ 0.97)
    const hem = a.bust ? { y: a.hipY, w: 0.58 } : { y: a.hipY + 0.24, w: 0.64 };
    // 한쪽 (sgn = −1 왼쪽 · 1 오른쪽): 어깨 · 아랫단 끝. 바람은 두 끝을 같은 쪽으로 민다
    const side = (sgn: -1 | 1): { sh: Pt; fl: Flap; h1: Pt } => {
      const sh: Pt = [sgn * (hw + 0.05), sy - 0.02];
      const end: Pt = [sgn * hem.w + sw, hem.y - sgn * sw * 0.4];
      return {
        sh,
        fl: {
          top: sh,
          segs: [
            [[sh[0] + sgn * 0.1, sh[1] + 0.16], [end[0] - sgn * 0.05, end[1] - (a.bust ? 0.16 : 0.3)], end],
          ],
        },
        h1: [sgn * hem.w * 0.5 + sw * 0.5, hem.y + 0.035],
      };
    };
    const L = side(-1);
    const R = side(1);
    const mid: Pt = [sw * 0.3, hem.y - 0.005];
    const rEnd = flapEnd(R.fl);
    const lEnd = flapEnd(L.fl);
    const hemPath = (q: Path): Path =>
      q
        .Q(rEnd[0] - 0.08, R.h1[1] + 0.02, R.h1[0], R.h1[1])
        .Q(R.h1[0] * 0.5, mid[1] - 0.03, mid[0], mid[1])
        .Q(L.h1[0] * 0.5, mid[1] - 0.03, L.h1[0], L.h1[1])
        .Q(lEnd[0] + 0.08, L.h1[1] + 0.02, lEnd[0], lEnd[1]);
    outline = flapPathBack(
      hemPath(
        flapPath(
          path()
            .M(0, ny - 0.05)
            .Q(R.sh[0] - 0.1, ny - 0.05, R.sh[0], R.sh[1]),
          R.fl,
        ),
      ),
      L.fl,
    )
      .Q(L.sh[0] + 0.1, ny - 0.05, 0, ny - 0.05)
      .Z().d;
    hemLine = hemPath(path().M(rEnd[0], rEnd[1])).d;
    flaps = [L.fl, R.fl];
    folds = [L, R].map(({ sh, fl, h1 }): [Pt, Pt, Pt] => {
      const sgn = Math.sign(sh[0]);
      const c2 = fl.segs[0]?.[1] ?? sh;
      return [
        [sh[0] - sgn * 0.06, sh[1] + 0.14],
        [(c2[0] + h1[0]) / 2 - sgn * 0.02, (sh[1] + hem.y) / 2 + 0.04],
        [h1[0] + sgn * 0.03, h1[1] - 0.04],
      ];
    });
    shadeBox = [-hem.w, sy, hem.w, hem.y];
  }
  // 1) 자락 (안감, 빛은 왼쪽 위)
  const [bx0, by0, bx1, by1] = shadeBox;
  sk.part(
    outline,
    linear(bx0, by0, bx1, by1, [
      [0, ink(tint(col.lining, 0.16))],
      [0.6, ink(col.lining)],
      [1, ink(shade(col.lining, 0.3))],
    ]),
    a.outline,
  );
  // 2) 바깥으로 젖힌 끝 (겉감)
  for (const fl of flaps) flapEdge(sk, a, fl, a.bust ? 0.07 : 0.1);
  // 3) 안감 주름
  for (const [p0, p1, p2] of folds)
    sk.line(path().curve([p0, p1, p2]).d, solid(ink(shade(col.lining, 0.5))), 0.024, 'round', 0.85);
  // 4) 아랫단 테두리
  sk.line(hemLine, solid(ink(col.trim)), 0.034);
}

/** 어깨 망토 윤곽 점 (몸통 좌표 → torso) · 아랫단 두 날개 (바깥 → 안) */
function mantle(a: SurvivorFrontAnchor): { pts: Pt[]; wings: Pt[][]; clasp: Pt } {
  const sy = a.shoulderY;
  const ny = a.neck[1];
  if (a.facing === 1) {
    // 3/4 (러너): 후드 밑 목둘레를 감싼 띠 — 가슴 갈매기 무늬(» 네온) 위에서 끝난다. 여밈은 가슴 쪽 목 아래
    const clasp: Pt = [0.13, ny + 0.08];
    const near: Pt[] = [
      [-0.37, sy + 0.08],
      [-0.2, sy + 0.1],
      [0.02, sy + 0.085],
    ];
    const far: Pt[] = [
      [0.33, sy + 0.07],
      [0.22, sy + 0.09],
    ];
    const pts: Pt[] = [
      [-0.12, ny - 0.02],
      [-0.33, sy - 0.03],
      ...near,
      clasp,
      ...far.slice().reverse(),
      [0.31, sy - 0.02],
      [0.14, ny - 0.0],
    ];
    return { pts, wings: [near, far], clasp };
  }
  const hw = a.halfW;
  const clasp: Pt = [0, ny + 0.075];
  const right: Pt[] = [
    [hw + 0.07, sy + 0.14],
    [hw * 0.55, sy + 0.17],
    [0.08, sy + 0.12],
  ];
  const left = right.map(([x, y]): Pt => [-x, y]);
  const pts: Pt[] = [
    [0, ny - 0.02],
    [0.14, ny - 0.0],
    [hw - 0.02, sy - 0.02],
    [hw + 0.06, sy + 0.06],
    ...right,
    clasp,
    ...left.slice().reverse(),
    [-hw - 0.06, sy + 0.06],
    [-hw + 0.02, sy - 0.02],
    [-0.14, ny - 0.0],
  ];
  return { pts, wings: [left, right], clasp };
}

/** 정면 어깨 망토 (겉감, 몸통 위 · 팔 밑): 아랫단 테두리 + 청록 네온 솔기 */
function frontTorso(sk: Sketch, a: SurvivorFrontAnchor): void {
  const { ink } = a;
  const col = capeColors(a.role);
  const T = a.torso;
  const { pts, wings } = mantle(a);
  const [gx0, gy0] = apply(T, -0.3, a.shoulderY - 0.1);
  const [gx1, gy1] = apply(T, 0.3, a.shoulderY + 0.22);
  sk.part(
    path(T).smooth(pts, 0.75).d,
    linear(gx0, gy0, gx1, gy1, [
      [0, ink(tint(col.outer, 0.32))],
      [0.5, ink(col.outer)],
      [1, ink(shade(col.outer, 0.25))],
    ]),
    a.outline,
  );
  for (const w of wings) {
    sk.line(path(T).curve(w).d, solid(ink(col.trim)), 0.028);
    // 솔기 (테두리 바로 안쪽, 은은하게)
    a.neon.line(path(T).curve(w.map(([x, y]): Pt => [x * 0.97, y - 0.03])).d, 0.011, 0.45);
  }
}

/** 목 앞 걸쇠: 둥근 쇠 + 양옆 고리 판 + 청록 네온 보석 */
function frontNeck(sk: Sketch, a: SurvivorFrontAnchor): void {
  const { ink } = a;
  const { clasp } = mantle(a);
  // 가드: 방패 위 끝에 가리지 않게 턱 바로 밑으로 조금 올린다
  const lift = a.role === 'guard' ? 0.045 : 0;
  const [x, y] = apply(a.torso, clasp[0], clasp[1] - lift);
  const r = 0.046;
  for (const s of [-1, 1]) {
    sk.part(
      path().roundRect(x + s * r - 0.026, y - 0.02, 0.052, 0.04, 0.014).d,
      linear(0, y - 0.02, 0, y + 0.02, [
        [0, ink(tint(STEEL, 0.2))],
        [1, ink(shade(STEEL, 0.35))],
      ]),
      a.outline,
      1,
      0.3,
    );
  }
  sk.part(
    path().circle(x, y, r).d,
    radial(x - r * 0.35, y - r * 0.35, r * 1.4, [
      [0, ink(tint(STEEL, 0.5))],
      [0.6, ink(STEEL)],
      [1, ink(shade(STEEL, 0.35))],
    ]),
    a.outline,
    1,
    0.35,
  );
  // 보석 자리 (어두운 홈) + 청록 네온 보석
  sk.fill(path().circle(x, y, r * 0.5).d, solid(ink(shade(STEEL, 0.6))));
  a.neon.dot(x, y, 0.016, 1, 0.042);
}

export const CAPE_ART: SurvivorCostumeArt = {
  id: 'cape',
  hidesPack: true,
  topBack,
  frontBehind,
  frontTorso,
  frontNeck,
};
