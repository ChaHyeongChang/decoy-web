// 의상 '사슬' (괴물 의상 400 불씨, 판 밖 메타 c): 목에 채운 무거운 쇠고리, 왼어깨에서 등 · 가슴을 비스듬히 가로지르는 사슬과
// 그 끊긴 끝, 두 손목의 끊어진 족쇄. 사슬은 큰 고리 몇 개로 — 눕힌 고리(가운데 구멍이 보이는 둥근 고리)와 선 고리(옆에서 본
// 막대)가 번갈아 온다. 고리는 짙은 테 → 쇠 → 빛 줄 세 겹 선으로 그려 고리 수와 상관없이 명령 수가 일정하다.
// 위 그림 (topCloak — 두건 · 소매 밑): 가슴(두건 밑)에서 왼어깨 꼭대기(실루엣 안, 서기에는 소매 밑)를 넘어 굽은 등을
// 비스듬히 오른쪽 뒤 자락 골까지 가로지르고, 끊긴 끝 고리들이 골 밖으로 나와 뒤로 끌린다(1.12r 안). 소매가 비켜나는 동작에도
// 고리가 어깨 밖으로 뜨지 않는다. 목 쇠고리는 두건 밑동을 두른 굵은 고리라 두건이 앞쪽을 덮어 머리 뒤 C자만 보인다(사슬 위,
// 두건 밑 — 정면과 같은 앞뒤). 얼굴 그늘 · 눈 · 발톱 · 두건 가운데는 덮지 않는다.
// 정면 그림: 사슬이 화면 오른쪽 어깨(괴물 왼어깨) 위에서 두건 뒤를 지나 가슴 · 망토 앞 틈을 비스듬히 가로질러 반대쪽 엉덩이까지
// 내려오고, 전신에서는 끊긴 끝이 늘어진다(frontMantle — 두건이 위를 덮는다). 쇠고리는 두건 턱 밑으로 드러난 굵은 띠와 리벳.
// 두 손목에는 두꺼운 족쇄 띠와 바깥 끝에 매달린 끊긴 사슬(frontOver — 발톱 바깥으로 비켜 단다). 상반신은 족쇄 띠만 (작은
// 카드에서 발톱 둘레가 쇠 고리로 어지럽지 않게).
// 움직임: 위 그림 끊긴 끝은 걸음 · 망토 물결에 좌우로 흔들리고, 돌진 때 뒤로 곧게 펴지고, 기절 때 짧게 처진다. 정면의 늘어진
// 끝 · 족쇄 고리는 숨 · 바람(t)에 흔들린다.
// 색: 쇠 #4B5563, 짙은 쇠 #1F2937, 쇠 빛 #9CA3AF, 정면 반짝임 #E5E7EB, 사슬 밑 그늘 #3F0D12(짙은 진홍 #5A1219를 30% 더
// 어둡게), 정면 쇠고리 림 라이트 = 기본 괴물 림 색. 녹(주황) · 청록 없음. 뿔 · 가시 없이 둥근 고리뿐.
import { MONSTER_COLOR } from '../monster';
import {
  apply,
  linear,
  mix,
  mul,
  path,
  radial,
  shade,
  solid,
  tint,
  type Mat,
  type Paint,
  type Path,
  type Sketch,
  type Stop,
} from '../kit';
import type { Ink } from '../survivorBase';
import type { MonsterCostumeArt, MonsterFrontAnchor, MonsterTopAnchor, Pt } from './types';

/** 쇠 색 */
const IRON = 0x4b5563;
const IRON_DARK = 0x1f2937;
const IRON_HI = 0x9ca3af;
const IRON_SHINE = 0xe5e7eb;
/** 사슬 밑 그늘 (망토 위) */
const SHADOW = shade(MONSTER_COLOR.cloakDeep, 0.3);

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];

function unit(x: number, y: number): Pt {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** 역변환 (그림 좌표 → 몸 좌표) */
function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** 변환의 길이 배율 (선 두께용) */
function lenScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** 변환을 따르는 칠 (칠은 경로 변환을 따르지 않으므로 좌표를 옮긴다) */
function lin(m: Mat, x0: number, y0: number, x1: number, y1: number, stops: readonly Stop[]): Paint {
  const [a, b] = apply(m, x0, y0);
  const [c, d] = apply(m, x1, y1);
  return linear(a, b, c, d, stops);
}

function rad(m: Mat, cx: number, cy: number, r: number, stops: readonly Stop[]): Paint {
  const [a, b] = apply(m, cx, cy);
  return radial(a, b, r * lenScale(m), stops);
}

/** 2차 곡선 위 점들 (a → b, 조절점 c) */
function quad(a: Pt, c: Pt, b: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const v = 1 - t;
    out.push([
      v * v * a[0] + 2 * v * t * c[0] + t * t * b[0],
      v * v * a[1] + 2 * v * t * c[1] + t * t * b[1],
    ]);
  }
  return out;
}

// ───────────────────────── 사슬 고리 ─────────────────────────

/** 고리 크기: 가운데선 길이 · 가운데선 폭 · 쇠줄 굵기 (고리 간격 = 길이 − 굵기) */
interface LinkSize {
  readonly len: number;
  readonly wid: number;
  readonly wire: number;
}

/** 고리 하나: 가운데 · 방향(단위) · 눕힘(면이 보이는 고리, 아니면 옆에서 본 막대) · 끊김(벌어진 C자) */
interface Link {
  readonly c: Pt;
  readonly u: Pt;
  readonly flat: boolean;
  readonly broken: boolean;
}

/**
 * 등뼈(꺾은선)를 따라 고리 count개(홀수 — 눕힘 · 섬 · 눕힘 …, 끝 고리가 눕힌 고리)를 고리 간격마다 놓는다. 방향은 고리 양 끝을
 * 잇는 현. fromEnd = 등뼈 끝에서부터 (끝 고리가 등뼈 끝에 맞고, 시작은 두건 · 소매 밑에 숨는다). 개수를 정해 두어 걸음마다
 * 등뼈 길이가 조금 바뀌어도 고리 무늬가 뒤바뀌어 깜빡이지 않는다 (등뼈보다 길면 양 끝을 곧게 늘인다). broken = 끝 고리를
 * 벌어진 C자로 (끊긴 끝)
 */
function placeLinks(
  spine: readonly Pt[],
  s: LinkSize,
  count: number,
  fromEnd: boolean,
  broken: boolean,
): Link[] {
  const cum: number[] = [0];
  for (let i = 1; i < spine.length; i += 1) {
    const a = spine[i - 1] ?? [0, 0];
    const b = spine[i] ?? a;
    cum.push((cum[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1] ?? 0;
  const at = (d: number): Pt => {
    let i = 1;
    while (i < spine.length - 1 && (cum[i] ?? 0) < d) i += 1;
    const a = spine[i - 1] ?? [0, 0];
    const b = spine[i] ?? a;
    const c0 = cum[i - 1] ?? 0;
    const k = (d - c0) / ((cum[i] ?? c0) - c0 || 1);
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  };
  const pitch = s.len - s.wire;
  const d0 = fromEnd ? total - s.len / 2 - (count - 1) * pitch : s.len / 2;
  const out: Link[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = d0 + i * pitch;
    const p0 = at(d - s.len / 2);
    const p1 = at(d + s.len / 2);
    out.push({
      c: at(d),
      u: unit(p1[0] - p0[0], p1[1] - p0[1]),
      flat: i % 2 === 0,
      broken: broken && i === count - 1,
    });
  }
  return out;
}

/** 고리 가운데선 (눕힌 고리 = 경기장 모양 닫힌 선, 끊긴 고리 = 바깥 끝이 벌어진 C자, 선 고리 = 막대) */
function linkInto(p: Path, l: Link, s: LinkSize, off: Pt): void {
  const c = add(l.c, off);
  if (!l.flat) {
    const a = add(c, l.u, -s.len / 2);
    const b = add(c, l.u, s.len / 2);
    p.M(a[0], a[1]).L(b[0], b[1]);
    return;
  }
  const r = s.wid / 2;
  const h = s.len / 2 - r;
  const th = Math.atan2(l.u[1], l.u[0]);
  const F = add(c, l.u, h);
  const K = add(c, l.u, -h);
  const Q = Math.PI / 2;
  if (l.broken) {
    const g = 0.6;
    p.arc(F[0], F[1], r, th + g, th + Q);
    p.arc(K[0], K[1], r, th + Q, th + 3 * Q, false);
    p.arc(F[0], F[1], r, th - Q, th - g, false);
    return;
  }
  p.arc(F[0], F[1], r, th - Q, th + Q);
  p.arc(K[0], K[1], r, th + Q, th + 3 * Q, false);
  p.Z();
}

function linksPath(m: Mat, links: readonly Link[], s: LinkSize, off: Pt = [0, 0]): string {
  const p = path(m);
  for (const l of links) linkInto(p, l, s, off);
  return p.d;
}

/** 사슬 그리기 모양: 변환 · 테 두께(한쪽, 그림 단위) · 쇠 칠 · 빛 줄 옮김(변환 전 좌표) · 빛 줄 굵기 비율 · 진하기 */
interface ChainLook {
  readonly m: Mat;
  readonly edge: number;
  readonly paint: Paint;
  readonly hiOff: Pt;
  readonly hiK: number;
  readonly hiA: number;
}

/**
 * 사슬: 눕힌 고리 무리 → 선 고리 무리 (선 고리가 눕힌 고리 끝 위를 지나 구멍으로 들어간 것처럼). 무리마다 짙은 테 → 쇠 →
 * 빛 줄 (명령 셋)
 */
function drawChain(
  sk: Sketch,
  ink: Ink,
  outline: number,
  links: readonly Link[],
  s: LinkSize,
  look: ChainLook,
): void {
  const wire = s.wire * lenScale(look.m);
  for (const flat of [true, false]) {
    const g = links.filter((l) => l.flat === flat);
    if (g.length === 0) continue;
    const d = linksPath(look.m, g, s);
    sk.line(d, solid(outline), wire + look.edge * 2);
    sk.line(d, look.paint, wire);
    sk.line(linksPath(look.m, g, s, look.hiOff), solid(ink(IRON_HI)), wire * look.hiK, 'round', look.hiA);
  }
}

// ───────────────────────── 위 그림 ─────────────────────────

/** 위 사슬 고리 (몸 단위: 몸 반지름 1) · 테 두께 */
const TOP_LINK: LinkSize = { len: 0.3, wid: 0.18, wire: 0.092 };
const TOP_EDGE = 0.024;
/** 위 사슬 고리 수 (끊긴 끝부터 세어 시작 고리가 두건 밑 가슴에 숨는다) */
const TOP_COUNT = 13;
/**
 * 위 사슬이 지나는 곳: 가슴(두건 좌표 — 두건 밑에 숨는다) → 어깨 위 안쪽(몸 좌표 — 서기에는 소매 밑) → 어깨 꼭대기 → 등.
 * 어깨 꼭대기를 실루엣 안(0.8)에 두어 소매가 비켜나는 동작(준비 · 타격 · 포효 · 기절)에도 고리가 어깨 밖으로 뜨지 않는다
 */
const TOP_CHEST_H: Pt = [0.32, -0.2];
const TOP_SHOULDER_IN: Pt = [0.22, -0.72];
const TOP_SHOULDER: Pt = [0, -0.8];
const TOP_BACK_C: Pt = [-0.62, -0.58];
/** 끊긴 끝이 닿는 가장 먼 반지름 (다듬기 전 그림 좌표. 다듬은 뒤 1.12 안) · 돌진 (다듬은 뒤 1.15 안) */
const TOP_REACH = 1.13;
const TOP_REACH_DASH = 1.2;
/** 목 쇠고리 (두건 좌표): 가운데 x · 반지름 · 굵기. 두건이 앞쪽을 덮어 머리 뒤를 감싼 C자만 드러난다 */
const TOP_COLLAR = { cx: 0.3, rx: 0.39, ry: 0.43, wire: 0.08 } as const;

/** 위 그림 쇠 칠: 굽은 등 가운데가 밝고 자락 끝으로 짙어진다 (망토 돔 음영과 같은 결) */
function topIron(a: MonsterTopAnchor): Paint {
  return rad(a.body, 0.15, 0, 1.3, [
    [0, a.ink(mix(IRON, IRON_HI, 0.45))],
    [0.55, a.ink(mix(IRON, IRON_HI, 0.2))],
    [1, a.ink(mix(IRON, IRON_DARK, 0.3))],
  ]);
}

/** 오른쪽 뒤 자락 골 (뒤 자락 점의 80% 자리 근처에서 몸 중심에 가장 가까운 점 — 끝 5 · 골 4 톱니의 넷째 골) */
function rightNotch(tail: readonly Pt[]): Pt {
  const i0 = Math.round((tail.length - 1) * 0.8);
  let best: Pt = [-0.65, 0.53];
  let bestR = Infinity;
  for (const i of [i0 - 1, i0, i0 + 1]) {
    const p = tail[i];
    if (p && Math.hypot(p[0], p[1]) < bestR) {
      best = p;
      bestR = Math.hypot(p[0], p[1]);
    }
  }
  return best;
}

/**
 * 위 사슬 등뼈 (몸 좌표): 가슴(두건 밑) → 왼어깨 꼭대기(서기에는 소매 밑) → 굽은 등을 비스듬히 → 오른쪽 뒤 자락 골 안 →
 * 골 밖으로 끌리는 끊긴 끝. 끝은 뒤로 흐르며 망토 물결 · 걸음에 좌우로 흔들린다. 돌진 = 뒤로 곧게 펴지고, 기절 = 짧게
 * 처진다. 끝 길이는 크기 한도(TOP_REACH) 안으로 줄인다. onCloak = 끌리는 끝 전까지의 점 수 (그늘)
 */
function topSpine(a: MonsterTopAnchor): { spine: Pt[]; onCloak: number } {
  const notch = rightNotch(a.tail);
  const dash = a.dash * (1 - a.stun);
  // 가슴 쪽 시작은 두건을 따라 움직인다 (두건 좌표 → 그림 좌표 → 몸 좌표)
  const chest = apply(invert(a.body), ...apply(a.headM, ...TOP_CHEST_H));
  const S = TOP_SHOULDER;
  const E: Pt = [notch[0] * 0.9, notch[1] * 0.9];
  const swing = (0.24 * Math.sin(a.cloak + 1.1) + 0.28 * a.s) * (1 - 0.75 * dash) * (1 - 0.6 * a.stun);
  const ang = lerp(2.76, 3.08, dash) + swing;
  const dir: Pt = [Math.cos(ang), Math.sin(ang)];
  const reach = a.dash > 0 ? TOP_REACH_DASH : TOP_REACH;
  // 끝이 한도 밖이면 길이를 줄인다 (반 나누기)
  let len = lerp(0.4, 0.44, dash) * (1 - 0.35 * a.stun);
  const far = (l: number): number => Math.hypot(...apply(a.body, ...add(notch, dir, l)));
  if (far(len) > reach) {
    let lo = 0;
    let hi = len;
    for (let i = 0; i < 10; i += 1) {
      const mid = (lo + hi) / 2;
      if (far(mid) > reach) hi = mid;
      else lo = mid;
    }
    len = lo;
  }
  const T = add(notch, dir, len);
  const over = [...quad(chest, TOP_SHOULDER_IN, S, 8), ...quad(S, TOP_BACK_C, E, 16).slice(1)];
  return { spine: [...over, ...quad(E, notch, T, 6).slice(1)], onCloak: over.length };
}

function topCloak(sk: Sketch, a: MonsterTopAnchor): void {
  const B = a.body;
  const { spine, onCloak } = topSpine(a);
  // 끝에서부터 놓는다: 끊긴 끝 고리가 등뼈 끝에 맞고, 남는 시작은 두건 밑에 숨는다
  const links = placeLinks(spine, TOP_LINK, TOP_COUNT, true, true);
  // 사슬 밑 그늘 (위 빛이라 사슬 둘레로 고르게, 망토 위에만)
  sk.line(
    path(B).curve(spine.slice(0, onCloak)).d,
    solid(a.ink(SHADOW)),
    (TOP_LINK.wid + TOP_LINK.wire) * 1.05,
    'round',
    0.4,
  );
  // 어깨를 넘어 등을 가로지르는 사슬 + 끌리는 끊긴 끝
  drawChain(sk, a.ink, a.outline, links, TOP_LINK, {
    m: B,
    edge: TOP_EDGE,
    paint: topIron(a),
    hiOff: [0, 0],
    hiK: 0.42,
    hiA: 0.95,
  });
  // 목 쇠고리 (사슬 위 — 정면과 같은 앞뒤. 두건 · 두건 그늘이 위를 덮는다)
  const H = a.headM;
  const collar = path(H).ellipse(TOP_COLLAR.cx, 0, TOP_COLLAR.rx, TOP_COLLAR.ry).d;
  const cw = TOP_COLLAR.wire * lenScale(H);
  sk.line(collar, solid(a.outline), cw + TOP_EDGE * 2);
  sk.line(collar, topIron(a), cw);
  sk.line(collar, solid(a.ink(IRON_HI)), cw * 0.38, 'round', 0.9);
}

// ───────────────────────── 정면 그림 ─────────────────────────

/** 정면 가슴 사슬 · 족쇄 사슬 고리 (상자 단위, m 전) */
const FRONT_LINK: LinkSize = { len: 0.16, wid: 0.09, wire: 0.038 };
const CUFF_LINK: LinkSize = { len: 0.1, wid: 0.064, wire: 0.027 };
/** 가슴 사슬 고리 수 (전신. 상반신은 늘어진 끝 둘을 뺀다) */
const FRONT_COUNT = 11;
/** 목 쇠고리 (두건 높이 hy 기준): 가운데 y · 반지름 · 굵기 */
const FRONT_COLLAR = { dy: 0.36, rx: 0.37, ry: 0.1, wire: 0.085 } as const;

/** 정면 쇠 칠 (왼쪽 위 빛) */
function frontIron(a: MonsterFrontAnchor): Paint {
  return lin(a.m, -0.6, -0.3, 0.6, 0.9, [
    [0, a.ink(tint(IRON, 0.14))],
    [0.5, a.ink(IRON)],
    [1, a.ink(mix(IRON, IRON_DARK, 0.5))],
  ]);
}

function frontLook(a: MonsterFrontAnchor, s: LinkSize): ChainLook {
  return {
    m: a.m,
    edge: a.w * 0.55,
    paint: frontIron(a),
    hiOff: [-s.wire * 0.18, -s.wire * 0.22],
    hiK: 0.4,
    hiA: 0.95,
  };
}

/** 눕힌 고리 왼쪽 위 반짝임 점들 (한 명령) */
function shine(sk: Sketch, a: MonsterFrontAnchor, links: readonly Link[], s: LinkSize): void {
  const p = path(a.m);
  const dir = unit(-0.6, -0.8);
  for (const l of links) {
    if (!l.flat) continue;
    const r = s.wid / 2;
    const h = s.len / 2 - r;
    const along = l.u[0] * dir[0] + l.u[1] * dir[1] >= 0 ? h : -h;
    const q = add(add(l.c, l.u, along), dir, r);
    p.circle(q[0], q[1], s.wire * 0.2);
  }
  sk.fill(p.d, solid(a.ink(IRON_SHINE), 0.9));
}

/**
 * 가슴 사슬 등뼈: 화면 오른쪽 어깨 위 → 가슴 · 망토 앞 틈을 비스듬히 → 반대쪽 엉덩이 (전신: 끊긴 끝이 늘어져 흔들린다).
 * taut = 몸에 붙은 곳 (그림자)
 */
function frontSpine(a: MonsterFrontAnchor): { spine: Pt[]; taut: Pt[] } {
  const by = a.by;
  const S: Pt = [0.56, -0.12 + by];
  const C: Pt = [0.1, 0.34 + by * 0.5];
  const E: Pt = [-0.36, 0.5 + by * 0.2];
  const taut = quad(S, C, E, 16);
  if (a.bust) return { spine: taut, taut };
  const sway = Math.sin(a.t * 1.7 + 0.4) * 0.035 + Math.sin(a.t * 0.9) * 0.015;
  const loose = quad(E, [E[0] - 0.03, E[1] + 0.15], [E[0] + sway, E[1] + 0.3], 6);
  return { spine: [...taut, ...loose.slice(1)], taut };
}

/** 정면 그림자 (몸에 붙은 쇠 아래 오른쪽으로 떨어지는 짙은 그늘 — 왼쪽 위 빛) */
const FRONT_DROP: Pt = [0.012, 0.022];

function frontMantle(sk: Sketch, a: MonsterFrontAnchor): void {
  const M = a.m;
  const ls = a.ls;
  const shadow = solid(a.ink(MONSTER_COLOR.void), 0.4);
  // 가슴을 가로지르는 사슬 (두건이 어깨 쪽 위를 덮는다) + 망토에 떨어진 그림자
  const { spine, taut } = frontSpine(a);
  const links = placeLinks(spine, FRONT_LINK, a.bust ? FRONT_COUNT - 2 : FRONT_COUNT, true, !a.bust);
  // 그림자는 어깨 위(실루엣 밖으로 나가는 시작 고리)를 빼고
  sk.line(
    path(M).curve(taut.slice(3).map((p) => add(p, FRONT_DROP))).d,
    shadow,
    (FRONT_LINK.wid + FRONT_LINK.wire) * ls,
  );
  drawChain(sk, a.ink, a.outline, links, FRONT_LINK, frontLook(a, FRONT_LINK));
  shine(sk, a, links, FRONT_LINK);
  // 목 쇠고리: 두건 밑동을 두른 굵은 띠 (위 · 뒤는 두건이 덮어 턱 밑 앞쪽만 드러난다)
  const cy = a.hy + FRONT_COLLAR.dy;
  const ring = path(M).ellipse(0, cy, FRONT_COLLAR.rx, FRONT_COLLAR.ry).d;
  const cw = FRONT_COLLAR.wire * ls;
  sk.line(
    path(M).ellipse(FRONT_DROP[0], cy + FRONT_DROP[1] * 1.5, FRONT_COLLAR.rx, FRONT_COLLAR.ry).d,
    shadow,
    cw * 1.15,
  );
  sk.line(ring, solid(a.outline), cw + a.w * 1.1);
  sk.line(ring, frontIron(a), cw);
  sk.line(
    path(M).ellipse(0, cy - FRONT_COLLAR.wire * 0.22, FRONT_COLLAR.rx, FRONT_COLLAR.ry).d,
    solid(a.ink(IRON_HI)),
    cw * 0.32,
    'round',
    0.9,
  );
  // 림 라이트 (오른쪽 뒤 붉은 빛이 쇠고리 오른쪽 아래에 비친다)
  sk.line(
    path(M).arc(0, cy + FRONT_COLLAR.wire * 0.2, FRONT_COLLAR.rx, 0.15, 1.0, true, FRONT_COLLAR.ry).d,
    solid(a.rim, 0.7),
    cw * 0.22,
  );
  // 리벳 둘 (앞쪽 아래)
  const rivets = path(M);
  for (const ang of [1.05, 2.09]) {
    rivets.circle(
      Math.cos(ang) * FRONT_COLLAR.rx,
      cy + Math.sin(ang) * FRONT_COLLAR.ry,
      FRONT_COLLAR.wire * 0.2,
    );
  }
  sk.fill(rivets.d, solid(a.ink(IRON_SHINE), 0.85));
}

/**
 * 족쇄 하나: 손목(아래팔 끝)을 두른 두꺼운 쇠 띠 + 가운데 홈 + 위 가장자리 빛. 돌려준 값 = 끊긴 사슬이 매달리는 띠 바깥 끝.
 * 아래팔 방향은 정면 그림의 팔 자리(전신: 늘어뜨린 팔, 상반신: 망토를 쥔 팔)에서 온다
 */
function cuff(sk: Sketch, a: MonsterFrontAnchor, wr: Pt): Pt {
  const side = wr[0] < 0 ? -1 : 1;
  const u = a.bust ? unit(-side * 0.2, -0.15) : unit(-side * 0.1, 0.25);
  const n: Pt = [-u[1], u[0]];
  const out: Pt = n[0] * side > 0 ? n : [-n[0], -n[1]];
  const c = add(wr, u, -0.025);
  const F: Mat = mul(a.m, [u[0], u[1], out[0], out[1], c[0], c[1]]);
  const band = path(F).roundRect(-0.045, -0.115, 0.09, 0.23, 0.04).d;
  // 둥근 띠 음영: 화면 왼쪽(빛 쪽) 끝 → 오른쪽 끝으로 밝은 띠 · 쇠 · 짙은 쇠
  const g0 = add(c, out, -0.115 * side);
  const g1 = add(c, out, 0.115 * side);
  sk.part(
    band,
    lin(a.m, g0[0], g0[1], g1[0], g1[1], [
      [0, a.ink(IRON)],
      [0.3, a.ink(IRON_HI)],
      [0.65, a.ink(IRON)],
      [1, a.ink(IRON_DARK)],
    ]),
    a.outline,
    undefined,
    0.35,
  );
  sk.line(path(F).M(0, -0.1).L(0, 0.1).d, solid(a.ink(IRON_DARK), 0.85), 0.016 * a.ls);
  sk.line(path(F).M(-0.03, -0.085).L(-0.03, 0.085).d, solid(a.ink(IRON_HI), 0.6), 0.012 * a.ls);
  return add(c, out, 0.13);
}

function frontOver(sk: Sketch, a: MonsterFrontAnchor): void {
  // 족쇄는 맨 앞 부품: 새 층이라 외곽선이 팔 · 발톱 위에 그어진다
  sk.layer();
  const links: Link[] = [];
  a.wrists.forEach((wr, i) => {
    const side = i === 0 ? -1 : 1;
    const A = cuff(sk, a, wr);
    // 상반신은 족쇄 띠만 (작은 카드에서 발톱 둘레가 쇠 고리로 어지럽지 않게)
    if (a.bust) return;
    // 끊긴 사슬 세 고리: 띠 바깥 끝에서 아래로 늘어져 흔들린다 (발톱 바깥으로 조금 비킨다)
    const sw = Math.sin(a.t * 1.9 + side * 1.2) * 0.1 + side * 0.06;
    const tip: Pt = [A[0] + Math.sin(sw) * 0.25, A[1] + Math.cos(sw) * 0.25];
    const mid: Pt = [A[0] + Math.sin(sw * 0.4) * 0.125, A[1] + 0.125];
    links.push(...placeLinks(quad(A, mid, tip, 8), CUFF_LINK, 3, false, true));
  });
  if (links.length === 0) return;
  drawChain(sk, a.ink, a.outline, links, CUFF_LINK, frontLook(a, CUFF_LINK));
  shine(sk, a, links, CUFF_LINK);
}

export const CHAINS_ART: MonsterCostumeArt = {
  id: 'chains',
  topCloak,
  frontMantle,
  frontOver,
};
