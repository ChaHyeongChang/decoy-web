// 의상 '사슬' (괴물 의상 400 불씨, 판 밖 메타 c): 목에 채운 무거운 쇠고리, 왼어깨에서 등 · 가슴을 비스듬히 가로지르는 사슬과
// 그 끊긴 끝, 두 손목의 끊어진 족쇄. 사슬은 큰 고리 몇 개로 — 눕힌 고리(가운데 구멍이 보이는 둥근 고리)와 선 고리(옆에서 본
// 막대)가 번갈아 온다. 고리 무리마다 명령 수가 일정하다(고리 수와 상관없이).
// 위 그림 (topCloak — 망토 · 주름 위, 두건 그늘 · 소매 · 발톱 · 두건 밑이라 얼굴 그늘 · 눈 · 발톱을 덮지 못한다): 가슴(두건 밑)에서
// 어깨 위 안쪽 · 왼어깨를 넘어 굽은 등을 둥글게 감아(자락 골 반지름 × 0.71 ≈ 0.6r) 오른쪽 뒤 자락 골 안쪽까지 오고, 끊긴 끝
// 고리들이 그 골로 빠져 뒤로 끌린다(1.12r 안). 등을 감는 자리는 몸 가운데 0.45r 원판(VISUAL_SPEC 0장 ② 역할색)과 망토 테두리 띠
// (외곽선 안쪽 몸 지름 8% — 생존자 화면에서 실루엣을 가르는 곳, 안쪽 끝 0.71 ~ 0.86r) 사이 빈 띠라 둘 다 거의 건드리지 않는다.
// 가슴 쪽은 두건 옆(0.5r 안팎)으로 두건 밑에 들어간다 — 공격 준비 · 타격 · 포효에 소매가 비켜나도 앞왼쪽 테두리 띠(0.6r까지
// 들어온다)에 닿지 않게. 돌진 · 기절로 망토가 눌리거나 가라앉아 빈 띠가 좁아지면 고리도 12% 가늘어진다(사슬 폭 0.185 → 0.163).
// 목 쇠고리는 위 그림에 그리지 않는다: 위에서 보면 두건 밑동 둘레가 몸 가운데 원판 안이라(옛 그림은 원판의 20 ~ 25%를 바꿨다)
// 두건이 덮은 것으로 둔다 — 정면 그림에만 보인다. 손목 족쇄도 정면에만(위 그림 발톱 둘레를 어지럽히지 않게).
// 정면 그림: 사슬이 화면 오른쪽 어깨(괴물 왼어깨) 위에서 두건 뒤를 지나 가슴 · 망토 앞 틈을 비스듬히 가로질러 반대쪽 엉덩이까지
// 내려오고, 전신에서는 끊긴 끝이 늘어진다(frontMantle — 두건이 위를 덮는다). 쇠고리는 두건 턱 밑으로 드러난 굵은 띠와 리벳.
// 두 손목에는 두꺼운 족쇄 띠와 바깥 끝에 매달린 끊긴 사슬(frontOver — 발톱 바깥으로 비켜 단다). 상반신은 족쇄 띠만 (작은
// 카드에서 발톱 둘레가 쇠 고리로 어지럽지 않게). 정면(로비 · 결과 · 옷장)은 검은 테 → 쇠 → 빛 줄 · 왼쪽 위 빛 · 반짝임 점.
// 움직임: 위 그림 사슬은 자락 골 자리를 따라 망토 물결 · 흔들림 · 돌진 · 기절을 같이 따르고, 끊긴 끝은 걸음 · 망토 물결에 좌우로
// 흔들리고, 돌진 때 뒤로 곧게 펴지고, 기절 때 짧게 처진다. 정면의 늘어진 끝 · 족쇄 고리는 숨 · 바람(t)에 흔들린다.
// 색: 정면 쇠 #4B5563, 짙은 쇠 #1F2937, 쇠 빛 #9CA3AF, 반짝임 #E5E7EB, 정면 쇠고리 림 라이트 = 기본 괴물 림 색. 위 그림 쇠는
// 붉은 빛을 받은 쇠(아래). 녹(주황) · 청록 없음. 뿔 · 가시 없이 둥근 고리뿐.
// 위 그림은 생존자 화면에도 보이므로 보이는 정도(밝기 · 외곽 대비 · 조각 대비 · 바닥 대비 면적 · 띠 조각 색조 · 몸 색조 · 몸 가운데
// 원판)를 게임이 굽는 모든 크기(몸 지름 21 ~ 90px) · 21프레임 · 방향 · 위상에서 기본과 같게 둔다(사용자 결정: 꾸미기는 유불리가
// 없다 — tests/unit/costume-parity*.test.ts). 그래서 위 그림 쇠는 (4판)
//  - 빛깔 = 붉은 빛을 받은 쇠: 회색 쇠에 따뜻한 쇠(#9A6A30)를 20%, 그 자리 망토 진홍을 55% 섞는다 (등의 고리 #C05F5C → #85423E,
//    빛 줄 #DD9795 → #B47B78). 몸 색조 점검은 망토 휘도에 맞춘 쇠가 바닥 청회색과 색으로 얼마나 갈리는지(바닥 톤까지 ΔE76)를
//    몸 전체 · 몸 조각마다 보는데, 옛 회색 쇠(#82868B → #5A5D63)는 그 자리 망토의 0.3 ~ 0.4배라 등 조각이 0.79배였다. 지금 쇠는
//    0.64 ~ 0.66배, 빛 줄은 0.67 ~ 0.73배이고 망토와는 ΔE76 24 ~ 33 갈린다 — 진홍을 더 섞으면 사슬이 망토에 묻히고, 갈색을 더
//    섞으면 황동 · 주황(주황은 경고 전용 색)으로 읽힌다
//  - 휘도 = 같은 자리 망토 × 0.88 (ironStops: 망토 돔 음영과 같은 중심 · 반지름 · 정지점에 쇠 색을 휘도로 맞춘다) + 그보다 밝은
//    빛 줄(쇠줄 굵기 40%, 붉은 반짝임 #FBD0D0 쪽 65%): 고리 몸이 조금 짙고 등이 빛나 쇠로 읽히고, 고리 하나의 평균은 망토와
//    거의 같다 (몸 밝기 1.008 ~ 1.025배). 반짝임을 흰색으로 두면 색이 빠져 몸 색조가 깎인다
//  - 짙은 테 · 밑 그늘을 두르지 않는다: Canvas는 명령마다 따로 안티에일리어싱하므로 짙은 테 위에 쇠 · 빛 줄을 겹치면 작은
//    크기에서 가장자리 칸에 짙은 테가 비쳐 사슬이 어두워졌고(옛 그림: 21px 0.91배 · 90px 1.01배), 옛 진홍 그늘(#3F0D12, 20%)은
//    사슬 폭보다 넓게 망토를 짙게 해 몸 색조를 깎았다. 지금은 쇠 → 그보다 밝은 빛 줄 한 도형뿐이다
//  - 고리가 가늘다(폭 0.185, 옛 0.22): 휴대폰 크기(21 ~ 30px)에서 굵은 고리는 안티에일리어싱 · 쌍선형이 몸 가운데 원판 맨 바깥
//    칸까지 번져 돌진 · 기절에 원판을 8%까지 바꿨고(지금 1.4% 이하), 몸 조각을 덮는 몫도 크다
//  - 끊긴 끝 고리(END_DOME — 바깥 끝이 골 안쪽 E를 지난 고리)는 골 안쪽에서 등 사슬과 같은 쇠로 이어 나와 테두리 띠에서 그
//    자리 망토 진홍을 70 ~ 75% 섞은 짙은 쇠(휘도는 망토 × 0.7): 테두리 띠를 지나므로 바닥 청회색과 색으로도 갈려야 하고(옛 끝
//    #1F2937은 바닥 #17212B와 ΔE76 4.8, 그 자리 망토는 36.9 — 지금 끝은 33 ~ 44), 외곽선 위에 얹혀 테두리 띠를 밝히지 않게
//    휘도 · 빛 줄을 낮춘다. 정면 그림의 쇠는 회색 쇠 그대로다(정면은 바닥 위에 서지 않는다)
import { relativeLuminance } from '../../palette';
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
/** 위 그림 쇠에 섞는 따뜻한 쇠 (청동빛 갈색) */
const IRON_WARM = 0x9a6a30;
/** 위 그림 쇠 반짝임: 붉은 빛을 받은 쇠 (두건 색을 75% 밝게 — 흰 반짝임은 색을 빼 바닥 청회색 쪽으로 간다) */
const TOP_SHINE = tint(MONSTER_COLOR.hood, 0.75);

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

/** 고리 하나: 가운데 · 방향(단위) · 눕힘(면이 보이는 고리, 아니면 옆에서 본 막대) · 끊김(벌어진 C자) · 등뼈 위 거리 */
interface Link {
  readonly c: Pt;
  readonly u: Pt;
  readonly flat: boolean;
  readonly broken: boolean;
  readonly d: number;
}

/** 꺾은선 길이 */
function polyLength(pts: readonly Pt[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] ?? [0, 0];
    const b = pts[i] ?? a;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
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
      d,
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

/** 정면 사슬 그리기 모양: 변환 · 검은 테 두께(한쪽, 그림 단위) · 쇠 칠 · 빛 줄 옮김(변환 전 좌표) · 빛 줄 굵기 비율 · 진하기 */
interface ChainLook {
  readonly m: Mat;
  readonly edge: number;
  readonly paint: Paint;
  readonly hiOff: Pt;
  readonly hiK: number;
  readonly hiA: number;
}

/**
 * 정면 사슬: 눕힌 고리 무리 → 선 고리 무리 (선 고리가 눕힌 고리 끝 위를 지나 구멍으로 들어간 것처럼). 무리마다 검은 테 → 쇠 →
 * 빛 줄 (명령 셋). 정면 그림은 생존자 게임 화면에 나오지 않는다(로비 · 결과 · 옷장)
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

/**
 * 위 사슬 고리 (몸 단위: 몸 반지름 1). 사슬 폭(wid + wire 0.185)이 원판 · 테두리 띠 사이 빈 띠(폭 약 0.26 ~ 0.3)에 넉넉히 든다
 * (옛 0.22는 휴대폰 크기에서 안티에일리어싱이 원판 맨 바깥 칸까지 번졌고, 몸 조각 색조에서 덮는 몫이 컸다)
 */
const TOP_LINK: LinkSize = { len: 0.24, wid: 0.12, wire: 0.065 };
/**
 * 그 자세의 위 사슬 고리: 돌진 때 몸이 옆으로 눌리면(몸 변환 y 0.88배 — 선 굵기는 눌린 쪽으로 줄지 않는다) 옆 · 왼쪽 뒤 테두리
 * 띠가 0.68r까지, 기절 때 자락이 가라앉으면 뒤 테두리 띠가 0.71r까지 들어와 원판과의 빈 띠가 좁아지므로 고리도 TOP_THIN만큼
 * 가늘게
 */
function topLink(a: MonsterTopAnchor): LinkSize {
  const k = 1 - TOP_THIN * Math.max(a.dash * (1 - a.stun), a.stun);
  return { len: TOP_LINK.len * k, wid: TOP_LINK.wid * k, wire: TOP_LINK.wire * k };
}
const TOP_THIN = 0.12;
/** 위 사슬 고리 수 (끊긴 끝부터 세어 시작 고리가 두건 밑 가슴에 숨는다) */
const TOP_COUNT = 13;
/**
 * 위 사슬이 지나는 곳: 가슴(두건 좌표 — 두건 밑에 숨는다) → 어깨 위 안쪽(그림 좌표) → 왼어깨(몸 좌표) → 등을 둥글게 감아
 * 오른쪽 뒤 자락 골 안쪽 (자락 골 × TOP_BACK_K). 어깨 위 안쪽은 두건 옆 0.55r 무렵: 더 바깥이면 소매가 비켜나는 동작에서
 * 앞왼쪽 테두리 띠에 닿고, 더 안쪽이면 몸 가운데 원판에 든다
 */
const TOP_CHEST_H: Pt = [0.45, -0.2];
const TOP_SHOULDER_IN: Pt = [0.16, -0.53];
const TOP_SHOULDER: Pt = [-0.1, -0.63];
/** 등을 감는 반지름: 자락 골(0.84) × 0.71 ≈ 0.6 — 몸 가운데 원판(0.45)과 테두리 띠 안쪽 끝(기절 0.71 ~ 서기 0.79) 사이 */
const TOP_BACK_K = 0.71;
/** 끊긴 끝이 닿는 가장 먼 반지름 (다듬기 전 그림 좌표. 다듬은 뒤 1.12 안) · 돌진 (다듬은 뒤 1.15 안) */
const TOP_REACH = 1.13;
const TOP_REACH_DASH = 1.2;

/** 위 망토 칠 정지점 (monster.ts 위 그림 망토와 같은 중심 (0.15, 0) · 반지름 1.45 · 정지점) — 쇠 휘도를 여기에 맞춘다 */
const CLOAK_DOME: readonly (readonly [number, number])[] = [
  [0, tint(MONSTER_COLOR.hood, 0.06)],
  [0.34, MONSTER_COLOR.hood],
  [0.55, shade(MONSTER_COLOR.hood, 0.3)],
  [0.78, shade(MONSTER_COLOR.hood, 0.56)],
  [1, shade(MONSTER_COLOR.hood, 0.66)],
];

/**
 * 상대 휘도 y의 쇠 색: 짙은 쇠 → 반짝임 사이 회색을 TOP_WARM만큼 따뜻한 쇠(IRON_WARM) 쪽으로, 다시 red만큼 partner(그 자리
 * 망토 색) 쪽으로 섞고, 섞은 뒤 휘도가 y가 되게 회색 몫을 반 나누기로 찾는다
 */
function ironAt(y: number, red: number, partner: number): number {
  const at = (k: number): number =>
    mix(mix(mix(shade(IRON_DARK, 0.5), IRON_SHINE, k), IRON_WARM, TOP_WARM), partner, red);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const k = (lo + hi) / 2;
    if (relativeLuminance(at(k)) < y) lo = k;
    else hi = k;
  }
  return at((lo + hi) / 2);
}

/** 망토 돔 음영의 그 자리 색 (정지점 사이는 sRGB로 섞는다 — Canvas 그라디언트와 같게) */
function cloakAt(t: number): number {
  let prev = CLOAK_DOME[0] ?? [0, MONSTER_COLOR.hood];
  for (const stop of CLOAK_DOME) {
    if (t <= stop[0]) return mix(prev[1], stop[1], (t - prev[0]) / (stop[0] - prev[0] || 1));
    prev = stop;
  }
  return prev[1];
}

/**
 * 위 그림 쇠 빛깔 (4판): 회색 쇠에 따뜻한 쇠를 TOP_WARM, 그 자리 망토 진홍을 TOP_RED만큼 섞은 '붉은 빛을 받은 쇠'. 몸 색조
 * 점검(몸 전체 · 몸 조각마다 바닥 톤까지 ΔE76 ≥ 기본 × 0.9)은 망토 휘도에 맞춘 쇠가 바닥 청회색과 색으로 얼마나 갈리는지를
 * 본다 — 회색 쇠(옛 그림)는 그 자리 망토의 0.3 ~ 0.4배라 등 조각이 0.79배였다. 진홍 몫이 이보다 크면 사슬이 망토에 묻히고,
 * 갈색 몫이 크면 주황 · 황동(주황은 경고 전용 색)으로 읽힌다
 */
const TOP_WARM = 0.2;
const TOP_RED = 0.55;
/**
 * 위 그림 쇠 돔 음영 [정지점, 진홍 몫] — 휘도는 같은 자리 망토 × TOP_GAIN · END_GAIN.
 *  등에 눕은 사슬: 어디서나 TOP_RED
 *  END_DOME: 자락 골로 빠져 테두리 띠를 지나는 끊긴 끝 고리 — 골 안쪽(돔 0.5까지)은 등 사슬과 같은 쇠, 테두리 띠(돔 0.58 ~)는
 *    망토 진홍을 더 비춘 짙은 쇠. 바닥 청회색과 갈리게(테두리 띠 색조: 회색 쇠는 바닥과 ΔE76 17 ~ 18, 그 자리 망토는 44 ~ 62,
 *    끝 고리는 33 ~ 44)
 */
const IRON_DOME: readonly (readonly [number, number])[] = [[0, TOP_RED]];
const END_DOME: readonly (readonly [number, number])[] = [
  [0, TOP_RED],
  [0.5, TOP_RED + 0.05],
  [0.58, 0.7],
  [1, 0.75],
];
/**
 * 위 그림 빛 줄 (위 빛을 받는 고리 등): 같은 돔 음영을 TOP_SHINE 쪽으로 TOP_HI_SHINE만큼 (자락 끝으로 TOP_HI_FADE만큼 옅게),
 * 쇠줄 굵기의 TOP_HI_K. 고리 몸(TOP_GAIN 0.88)은 망토보다 조금 짙고 빛 줄은 밝아, 고리 하나의 평균 휘도가 망토와 거의 같다 —
 * 같은 휘도 한 빛깔보다 쇠로 읽힌다
 */
const TOP_HI_SHINE = 0.65;
const TOP_HI_FADE = 0.7;
const TOP_HI_K = 0.4;
/** 끊긴 끝 고리의 빛 줄 (짙은 진홍 쇠라 반짝임을 줄인다 — 테두리 띠를 밝히지 않게) */
const TOP_END_SHINE = 0.2;
/** 쇠 휘도 / 같은 자리 망토 휘도: 등의 고리 · 끊긴 끝 고리 (끝은 외곽선 위에 얹혀 테두리 띠를 밝히지 않게 낮춘다) */
const TOP_GAIN = 0.88;
const END_GAIN = 0.7;

/** 돔 음영 dome의 그 자리 진홍 몫 (정지점 사이는 선형) */
function redAt(dome: readonly (readonly [number, number])[], t: number): number {
  let prev = dome[0] ?? [0, 0];
  for (const stop of dome) {
    if (t <= stop[0]) return lerp(prev[1], stop[1], (t - prev[0]) / (stop[0] - prev[0] || 1));
    prev = stop;
  }
  return prev[1];
}

/**
 * 쇠 돔 음영 정지점 [돔 위치, 쇠 색] (불러올 때 한 번): 정지점은 망토 정지점 + dome 정지점 (망토 정지점 사이를 쇠도 같이 섞어야
 * 휘도가 어디서나 같다). 휘도 = 그 자리 망토 × TOP_GAIN, 진홍 몫 = dome
 */
function ironStops(
  dome: readonly (readonly [number, number])[],
  gain: number,
): readonly (readonly [number, number])[] {
  const ts = [...new Set([...CLOAK_DOME.map(([t]) => t), ...dome.map(([t]) => t)])].sort((x, y) => x - y);
  return ts.map((t) => {
    const cloak = cloakAt(t);
    return [t, ironAt(relativeLuminance(cloak) * gain, redAt(dome, t), cloak)] as const;
  });
}
const IRON_STOPS = ironStops(IRON_DOME, TOP_GAIN);
const END_STOPS = ironStops(END_DOME, END_GAIN);

/**
 * 위 그림 쇠 칠: 망토와 같은 중심 · 반지름의 돔 음영 (stops = ironStops). shine = 반짝임 쪽으로 섞는 몫 (자락 끝으로
 * TOP_HI_FADE만큼 옅어진다)
 */
function topIron(a: MonsterTopAnchor, stops: readonly (readonly [number, number])[], shine = 0): Paint {
  return rad(
    a.body,
    0.15,
    0,
    1.45,
    stops.map(([t, iron]): Stop => [t, a.ink(mix(iron, TOP_SHINE, shine * (1 - TOP_HI_FADE * t)))]),
  );
}

/** 열린 Catmull-Rom 곡선 위 점들 (path().curve와 같은 곡선, 마디마다 n개) */
function spline(pts: readonly Pt[], n: number): Pt[] {
  const k = pts.length;
  const at = (i: number): Pt => pts[Math.max(0, Math.min(k - 1, i))] ?? [0, 0];
  const out: Pt[] = [at(0)];
  for (let i = 0; i + 1 < k; i += 1) {
    const b = at(i);
    const c = at(i + 1);
    const p1: Pt = add(b, add(c, at(i - 1), -1), 1 / 6);
    const p2: Pt = add(c, add(at(i + 2), b, -1), -1 / 6);
    for (let j = 1; j <= n; j += 1) {
      const t = j / n;
      const v = 1 - t;
      out.push([
        v * v * v * b[0] + 3 * v * v * t * p1[0] + 3 * v * t * t * p2[0] + t * t * t * c[0],
        v * v * v * b[1] + 3 * v * v * t * p1[1] + 3 * v * t * t * p2[1] + t * t * t * c[1],
      ]);
    }
  }
  return out;
}

/**
 * 위 사슬 등뼈 (몸 좌표): 가슴(두건 밑) → 어깨 위 안쪽(서기에는 소매 밑) → 왼어깨 → 자락 골들 안쪽(TOP_BACK_K)을 따라 등을
 * 둥글게 감아 → 오른쪽 뒤 자락 골 안쪽 → 그 골로 빠져 끌리는 끊긴 끝. 골 자리를 따르므로 망토 물결 · 흔들림 · 돌진 · 기절을
 * 같이 따른다. 끝은 걸음 · 망토 물결에 좌우로 흔들리고, 돌진 = 뒤로 곧게 펴지고, 기절 = 짧게 처진다. 끝 길이는 크기
 * 한도(TOP_REACH) 안으로 줄인다. endAt = 끌리는 끝 전까지의 등뼈 길이 (그 뒤 고리는 끊긴 끝 쇠)
 */
function topSpine(a: MonsterTopAnchor): { spine: Pt[]; endAt: number } {
  const tail = a.tail;
  const valley = (i: number): Pt => {
    const p = tail[i] ?? [-0.84, 0];
    return [p[0] * TOP_BACK_K, p[1] * TOP_BACK_K];
  };
  // 골: 뒤 자락 점의 짝수 번째 (2 = 왼쪽 뒤 · 4 · 6 · 8 = 오른쪽 뒤)
  const notch = tail[8] ?? [-0.65, 0.53];
  const dash = a.dash * (1 - a.stun);
  // 가슴 쪽 시작은 두건을 따라 움직인다 (두건 좌표 → 그림 좌표 → 몸 좌표)
  const toBody = invert(a.body);
  const chest = apply(toBody, ...apply(a.headM, ...TOP_CHEST_H));
  // 어깨 위 안쪽은 그림 좌표 (돌진에 몸이 옆으로 눌려도 원판 쪽으로 들어오지 않게)
  const shoulderIn = apply(toBody, ...TOP_SHOULDER_IN);
  const E = valley(8);
  const swing = (0.24 * Math.sin(a.cloak + 1.1) + 0.28 * a.s) * (1 - 0.75 * dash) * (1 - 0.6 * a.stun);
  const ang = lerp(2.62, 2.95, dash) + swing;
  const dir: Pt = [Math.cos(ang), Math.sin(ang)];
  const reach = a.dash > 0 ? TOP_REACH_DASH : TOP_REACH;
  // 끝이 한도 밖이면 길이를 줄인다 (반 나누기)
  let len = lerp(0.3, 0.34, dash) * (1 - 0.35 * a.stun);
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
  const over = spline([chest, shoulderIn, TOP_SHOULDER, valley(2), valley(4), valley(6), E], 5);
  return {
    spine: [...over, ...quad(E, notch, T, 6).slice(1)],
    endAt: polyLength(over),
  };
}

function topCloak(sk: Sketch, a: MonsterTopAnchor): void {
  const { spine, endAt } = topSpine(a);
  // 끝에서부터 놓는다: 끊긴 끝 고리가 등뼈 끝에 맞고, 남는 시작은 두건 밑에 숨는다
  const size = topLink(a);
  const links = placeLinks(spine, size, TOP_COUNT, true, true);
  // 어깨를 넘어 등을 감는 사슬 + 끌리는 끊긴 끝. 짙은 테 · 밑 그늘 없이 쇠 · 빛 줄 두 겹 (빛 줄은 쇠보다 밝은 한 도형)
  drawTopChain(sk, links, size, a, endAt);
}

/**
 * 위 사슬: 등의 고리 → 끊긴 끝 고리(바깥 끝이 골 안쪽 E를 지난 고리 — END_DOME), 무리마다 눕힌 고리 → 선 고리, 쇠 → 빛 줄
 * (같은 가운데선 — 밝은 층이 위라 이음매에 짙은 색이 비치지 않는다)
 */
function drawTopChain(
  sk: Sketch,
  links: readonly Link[],
  s: LinkSize,
  a: MonsterTopAnchor,
  endAt: number,
): void {
  const wire = s.wire * lenScale(a.body);
  for (const end of [false, true]) {
    const stops = end ? END_STOPS : IRON_STOPS;
    for (const flat of [true, false]) {
      const g = links.filter((l) => l.flat === flat && l.d + s.len * 0.5 >= endAt === end);
      if (g.length === 0) continue;
      const d = linksPath(a.body, g, s);
      sk.line(d, topIron(a, stops), wire);
      sk.line(d, topIron(a, stops, end ? TOP_END_SHINE : TOP_HI_SHINE), wire * TOP_HI_K, 'round', 0.9);
    }
  }
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
