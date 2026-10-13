// 시야 · 범위 도형 그리기 (부채꼴, 근접 원, 생존자 시야 원, 공격 준비 · 밀치기 · 구조 · 캠핑 · 포효 범위). 좌표는 월드 픽셀.
// Phaser를 import하지 않는다(펜 = Graphics의 부분 집합): 단위 테스트가 기록 펜으로 그린 선을 검사한다.
// 범위는 정보 레이어 항목(InfoItem)에서 그린다: 그림과 정보의 출처가 하나라 품질 · 그림만 따로 어긋나지 않는다(정보 우선 R10 · R12).
// 원 · 호는 shapes.ts penArc로 편다(Phaser 원호 명령은 매번 100분할).
import { TILE_PX, blocksStrike, raycast, segmentBlocked, type InfoItem, type Vec2 } from '@decoy/shared';
import { ANIM, hatchPulse } from '../art/anim';
import { OUTLINE, ROLE, WARN } from '../art/palette';
import { penArc, roundRectPath, type FanPen, type LinePen, type PathPen } from '../art/shapes';
import { MAP_SCALE } from '../ui/layout';

export type { FanPen, PathPen } from '../art/shapes';

const T = TILE_PX;

/**
 * 부채꼴 · 시야 채움 (그래픽 값). 생존자 화면 괴물 부채꼴 채움 0.20(노랑) / 0.28(빨강) + 가장자리 선 2px 85%,
 * 빨강 상태는 사선 해치 + 0.6초 펄스(색약 대비). 괴물 화면 자기 부채꼴은 낮은 채움 + 판정 경계 선, 근접 원 빨강 8%.
 * 생존자 시야는 따뜻한 중성 틴트 5% + 경계에 그 사람의 역할색 림
 */
export const CONE_LOOK = {
  fillIdle: 0.2,
  fillSeen: 0.28,
  edgeAlpha: 0.85,
  edgeWidth: 2,
  hatchSpacing: 0.42,
  hatchAlpha: 0.2,
  hatchPulse: 0.16,
  hatchWidth: 2,
  selfFill: 0.11,
  nearFill: 0.08,
  visionTint: 0xffe2b8,
  visionTintAlpha: 0.05,
  rimAlpha: 0.24,
  rimWidth: 1.6,
} as const;

/** 공격 준비 범위 색 (흰색: 지금 규칙) */
export const ATTACK_RANGE = { color: 0xffffff, fill: 0.2, sweep: 0.16, edge: 0.85, width: 2 } as const;

/** 선 두 번 긋기 (두께 · 색 · 알파): 어두운 받침 → 색 선. 부를 때마다 배열을 만들지 않게 모듈에 둔다 */
type StrokePass = readonly [number, number, number];
const ATTACK_EDGE_PASSES: readonly StrokePass[] = [
  [ATTACK_RANGE.width + 2.5, OUTLINE, 0.55],
  [ATTACK_RANGE.width, ATTACK_RANGE.color, ATTACK_RANGE.edge],
];
const SHOVE_MARK_PASSES: readonly StrokePass[] = [
  [5, OUTLINE, 0.85],
  [2.5, ROLE.guard, 1],
];

/** 다각형 경로 (점들은 타일 좌표) */
function polyPath(g: PathPen, pts: readonly Vec2[]): boolean {
  const first = pts[0];
  if (!first) return false;
  g.beginPath();
  g.moveTo(first.x * T, first.y * T);
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    if (p) g.lineTo(p.x * T, p.y * T);
  }
  g.closePath();
  return true;
}

/** 다각형 채우기 (점들은 타일 좌표) */
export function fillPolygon(g: PathPen, pts: readonly Vec2[], color: number, alpha: number): void {
  if (pts.length < 3) return;
  g.fillStyle(color, alpha);
  if (polyPath(g, pts)) g.fillPath();
}

/**
 * 첫 꼭짓점에서 본 별 모양 다각형(시야 부채꼴: [꼭짓점, 각도 순서의 호 점들…])을 삼각형 부채로 채운다 (WebGL 전용, 점들은 타일 좌표).
 * 부채꼴 다각형은 꼭짓점에서 쏜 광선으로 만들어 각도 순서라, 부채 삼각형 (0, i, i+1)의 합이 다각형과 같고 서로 겹치지 않는다 →
 * Earcut(fillPath)과 같은 화소. WebGL fillPath는 칠할 때마다 Earcut + 점 객체를 만든다. Canvas는 fillPolygon 그대로
 * (삼각형마다 따로 칠하면 안티앨리어싱 이음매가 보인다)
 */
export function fillFanPolygon(g: FanPen, pts: readonly Vec2[], color: number, alpha: number): void {
  if (pts.length < 3) return;
  const first = pts[0];
  if (!first) return;
  g.fillStyle(color, alpha);
  const x0 = first.x * T;
  const y0 = first.y * T;
  for (let i = 1; i + 1 < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p && q) g.fillTriangle(x0, y0, p.x * T, p.y * T, q.x * T, q.y * T);
  }
}

/** 다각형 외곽선 */
export function strokePolygon(
  g: PathPen,
  pts: readonly Vec2[],
  color: number,
  alpha: number,
  width = 2,
): void {
  if (pts.length < 2) return;
  g.lineStyle(width, color, alpha);
  if (polyPath(g, pts)) g.strokePath();
}

/** 선분 여러 개 (점들은 타일 좌표). 괴물 화면 자기 시야 테두리처럼 판정 경계를 그대로 긋는다 */
export function strokeSegments(
  g: PathPen,
  segs: readonly (readonly [Vec2, Vec2])[],
  color: number,
  alpha: number,
  width = 2,
): void {
  if (segs.length === 0) return;
  g.lineStyle(width, color, alpha);
  g.beginPath();
  for (const [a, b] of segs) {
    g.moveTo(a.x * T, a.y * T);
    g.lineTo(b.x * T, b.y * T);
  }
  g.strokePath();
}

/** 시야 다각형 꼭짓점이 원호 위(판정 반경 r에서 이만큼 안까지)인가 — 림은 원호 부분만 긋는다 (벽 그림자 선은 긋지 않는다) */
const RIM_EPS = 0.06;

/**
 * 생존자 시야 경계 림 경로 (점들은 타일 좌표, 펜은 월드 px). 두 끝이 모두 원호 위인 변만 긋는다.
 * join = true면 이어진 변들을 한 줄(moveTo 한 번 + lineTo 여럿)로 낸다 (렌더링 최적화 2, WebGL): 림 선 두께(1.72px)는 2 이하라
 * WebGL이 이음매 사각형을 넣지 않아 변마다 같은 사각형이 같은 순서로 나온다(같은 화소). 경로 객체 · 점 객체가 변 수 × 2 → 변 수 + 줄 수.
 * join = false는 예전처럼 변마다 moveTo + lineTo (Canvas: 이어 그으면 꺾인 곳에 마이터 이음이 생겨 안티앨리어싱이 최대 12 달라진다).
 * 부르는 쪽이 lineStyle · beginPath · strokePath
 */
export function traceRim(g: LinePen, poly: readonly Vec2[], center: Vec2, r: number, join = true): void {
  // 앞 변을 그었으면 그 끝(= 이 변의 시작)에서 이어 긋는다
  let open = false;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) {
      open = false;
      continue;
    }
    const da = Math.hypot(a.x - center.x, a.y - center.y);
    const db = Math.hypot(b.x - center.x, b.y - center.y);
    if (da < r - RIM_EPS || db < r - RIM_EPS) {
      open = false;
      continue;
    }
    if (!open) g.moveTo(a.x * T, a.y * T);
    g.lineTo(b.x * T, b.y * T);
    open = join;
  }
}

/** 두 색 사이 보간 (0xRRGGBB) */
export function mixColor(a: number, b: number, k: number): number {
  const t = Math.max(0, Math.min(1, k));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}

/**
 * 직선 (px, py) + t·(dx, dy)와 다각형 변의 교차 t들을 ts에 오름차순으로 쓴다 (clipLine과 같은 식 · 같은 순서. ts는 비우고 쓴다)
 */
function crossings(
  px: number,
  py: number,
  dx: number,
  dy: number,
  poly: readonly Vec2[],
  ts: number[],
): void {
  ts.length = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[j];
    const b = poly[i];
    if (!a || !b) continue;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - px) * ey - (a.y - py) * ex) / den;
    const u = ((a.x - px) * dy - (a.y - py) * dx) / den;
    if (u >= 0 && u < 1) ts.push(t);
  }
  ts.sort(ascending);
}

function ascending(x: number, y: number): number {
  return x - y;
}

/** 해치 줄마다 다시 쓰는 교차 목록 (drawConeHatch) */
const hatchTs: number[] = [];

/** 직선 p + t·d와 다각형의 교차 구간 (짝홀): 다각형 안인 [t0, t1] 목록 */
export function clipLine(p: Vec2, d: Vec2, poly: readonly Vec2[]): [number, number][] {
  const ts: number[] = [];
  crossings(p.x, p.y, d.x, d.y, poly, ts);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const a = ts[i];
    const b = ts[i + 1];
    if (a !== undefined && b !== undefined) out.push([a, b]);
  }
  return out;
}

/**
 * 생존자 화면 빨강 부채꼴의 사선 해치 + 0.6초 펄스 (색만으로 구분하지 않기 R13). 조준 방향에서 45° 기운 줄들을
 * 꼭짓점에서 바깥으로 흘려 보낸다(0.6초에 한 칸). 줄은 판정 다각형 안으로만 자른다. coneRed(빨강 보간 0~1)가 0이면 긋지 않는다.
 * 반환: 그은 선분 수
 */
export function drawConeHatch(
  g: PathPen,
  cone: readonly Vec2[],
  apex: Vec2,
  aim: number,
  coneRed: number,
  tS: number,
  color: number,
): number {
  if (!(coneRed > 0.01) || cone.length < 3) return 0;
  const pulse = hatchPulse(tS);
  const a = (CONE_LOOK.hatchAlpha + CONE_LOOK.hatchPulse * pulse) * Math.min(1, coneRed);
  // 줄 방향 (dx, dy) · 법선 (nx, ny): 예전 dir · n 객체와 같은 값 (렌더링 최적화 2: 줄마다 객체 · 배열을 만들지 않는다)
  const dx = Math.cos(aim + Math.PI / 4);
  const dy = Math.sin(aim + Math.PI / 4);
  const nx = -dy;
  const ny = dx;
  const sp = CONE_LOOK.hatchSpacing;
  const shift = ((((tS / ANIM.hatchPulseS) % 1) + 1) % 1) * sp;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of cone) {
    const c = (p.x - apex.x) * nx + (p.y - apex.y) * ny;
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  }
  g.lineStyle(CONE_LOOK.hatchWidth / MAP_SCALE, color, a);
  g.beginPath();
  // 흐름 방향: n이 조준 방향과 같은 쪽을 향하면 +, 아니면 −
  const sign = nx * Math.cos(aim) + ny * Math.sin(aim) >= 0 ? 1 : -1;
  let segs = 0;
  const ts = hatchTs;
  for (let c = Math.floor(lo / sp) * sp - sp; c <= hi + sp; c += sp) {
    const off = c + sign * shift;
    const ox = apex.x + nx * off;
    const oy = apex.y + ny * off;
    crossings(ox, oy, dx, dy, cone, ts);
    // 짝홀: 안인 구간 [ts[0], ts[1]], [ts[2], ts[3]], … (clipLine과 같다)
    for (let k = 0; k + 1 < ts.length; k += 2) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t0 === undefined || t1 === undefined) continue;
      g.moveTo((ox + dx * t0) * T, (oy + dy * t0) * T);
      g.lineTo((ox + dx * t1) * T, (oy + dy * t1) * T);
      segs += 1;
    }
  }
  g.strokePath();
  return segs;
}

/** 부채꼴 가장자리 선 (판정 경계 그대로). 캐릭터 그림자 위 레이어에 그려 몸 둘레에서 끊기지 않는다 */
export function drawConeEdge(g: PathPen, cone: readonly Vec2[], color: number): void {
  strokePolygon(g, cone, color, CONE_LOOK.edgeAlpha, CONE_LOOK.edgeWidth / MAP_SCALE);
}

/** 부채꼴 경로 (꼭짓점 → 호 → 꼭짓점) */
function sectorPath(g: PathPen, cx: number, cy: number, r: number, a0: number, a1: number): void {
  g.beginPath();
  g.moveTo(cx, cy);
  penArc(g, cx, cy, r, a0, a1, false);
  g.closePath();
}

/**
 * 공격 준비 범위 (정보 항목 'attack': x · y · r = attack.range · dir · arc = 라디안). 바깥 경계(판정값)는 처음부터 다 보이고,
 * 채움은 준비 시간에 맞춰 꼭짓점에서 바깥으로 0 → 100% 쓸려 차오른다(fill = 0~1, 정확히 attack.windup에 1).
 * 밑판 · 채움은 fillPen(캐릭터 그림자 아래), 차오르는 앞머리 · 판정 경계는 linePen(그림자 위, 몸 아래)
 */
export function drawAttackRange(fillPen: PathPen, linePen: PathPen, item: InfoItem, fill: number): void {
  const half = (item.arc ?? 0) / 2;
  const dir = item.dir ?? 0;
  const cx = item.x * T;
  const cy = item.y * T;
  const R = (item.r ?? 0) * T;
  const k = Math.max(0, Math.min(1, fill));
  // 밑판 (옅게) + 차오르는 채움
  fillPen.fillStyle(ATTACK_RANGE.color, 0.08);
  sectorPath(fillPen, cx, cy, R, dir - half, dir + half);
  fillPen.fillPath();
  if (k > 0) {
    fillPen.fillStyle(ATTACK_RANGE.color, ATTACK_RANGE.fill);
    sectorPath(fillPen, cx, cy, R * k, dir - half, dir + half);
    fillPen.fillPath();
    // 차오르는 앞머리 (밝은 호): 그림자에 묻히지 않게 경계와 같은 층
    linePen.lineStyle(2.5, ATTACK_RANGE.color, 0.5 + 0.4 * k);
    linePen.beginPath();
    penArc(linePen, cx, cy, R * k, dir - half, dir + half);
    linePen.strokePath();
  }
  // 판정 경계 (어두운 받침 + 흰 선)
  for (const [w, color, a] of ATTACK_EDGE_PASSES) {
    linePen.lineStyle(w, color, a);
    sectorPath(linePen, cx, cy, R, dir - half, dir + half);
    linePen.strokePath();
  }
}

/** 원 둘레 점선 (범위 표시): 점 dashes개, 한 칸의 55%가 선 */
export function dashedCircle(
  g: PathPen,
  cx: number,
  cy: number,
  r: number,
  width: number,
  color: number,
  alpha: number,
  dashes: number,
  offset = 0,
): void {
  g.lineStyle(width, color, alpha);
  const step = (Math.PI * 2) / dashes;
  g.beginPath();
  for (let i = 0; i < dashes; i += 1) {
    const a0 = offset + i * step;
    penArc(g, cx, cy, r, a0, a0 + step * 0.55);
  }
  g.strokePath();
}

/** 구조 구역 (정보 항목 'rescue': 감옥 문 앞 rescueRadius). 수감자가 있을 때 생존자 화면에. spin = 점선 회전 (장식) */
export function drawRescueZone(g: PathPen, item: InfoItem, spin: number): void {
  const r = (item.r ?? 0) * T;
  dashedCircle(g, item.x * T, item.y * T, r, 4, OUTLINE, 0.45, 18, spin);
  dashedCircle(g, item.x * T, item.y * T, r, 2, item.color, 0.75, 18, spin);
}

/** 가드 밀치기 사거리 상태: 안(쓰면 맞는다) · 밖 · 막힘(거리 안이지만 철창 · 벽이 가로막아 서버가 빗나감 처리) */
export type ShoveState = 'in' | 'out' | 'blocked';

/**
 * 밀치기 사거리 상태 (표시용). 서버 판정(systems/abilities.ts)과 같은 조건: 거리 ≤ shoveRange이고
 * 가드 → 괴물 선분이 타격 차단 칸(blocksStrike)에 막히지 않아야 맞는다
 */
export function shoveState(me: Vec2, monster: Vec2, range: number): ShoveState {
  const d = Math.hypot(monster.x - me.x, monster.y - me.y);
  if (d > range) return 'out';
  return segmentBlocked(me, monster, blocksStrike) ? 'blocked' : 'in';
}

/**
 * 가드 → 괴물 선분을 처음 가로막는 타격 차단 칸(철창 · 벽) 구간의 가운데 (막히지 않으면 null).
 * 막힘 × 표시를 이 자리(가로막은 구조물 위)에 그린다: 원 위 괴물 쪽에 두면 괴물이 원 둘레에 있을 때 몸에 가려진다
 */
export function shoveBlockPoint(me: Vec2, monster: Vec2): Vec2 | null {
  if (!segmentBlocked(me, monster, blocksStrike)) return null;
  const dx = monster.x - me.x;
  const dy = monster.y - me.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: me.x, y: me.y };
  const ux = dx / len;
  const uy = dy / len;
  const enter = raycast(me.x, me.y, ux, uy, len, blocksStrike);
  // 들어간 칸에서 다시 트인 칸이 나올 때까지 (선분 끝까지 막혀 있으면 끝에서 멈춘다)
  const eps = 1e-6;
  const inside = raycast(
    me.x + ux * (enter + eps),
    me.y + uy * (enter + eps),
    ux,
    uy,
    len - enter - eps,
    (i, j) => !blocksStrike(i, j),
  );
  const mid = enter + eps + inside / 2;
  return { x: me.x + ux * mid, y: me.y + uy * mid };
}

/**
 * 가드 밀치기 사거리 (정보 항목 'shove': value = in · out · blocked). 안이면 진한 점선, 밖 · 막힘이면 옅은 점선.
 * 막힘은 가로막은 구조물 위(mark = shoveBlockPoint)에 × 표시(색만으로 구분하지 않기)
 */
export function drawShoveRange(g: PathPen, item: InfoItem, mark: Vec2 | null): void {
  const cx = item.x * T;
  const cy = item.y * T;
  const r = (item.r ?? 0) * T;
  const inRange = item.value === 'in';
  dashedCircle(g, cx, cy, r, 4, OUTLINE, 0.4, 24);
  dashedCircle(g, cx, cy, r, 2, ROLE.guard, inRange ? 0.95 : 0.55, 24);
  if (item.value !== 'blocked' || !mark) return;
  const mx = mark.x * T;
  const my = mark.y * T;
  const s = 6;
  for (const [w, color, a] of SHOVE_MARK_PASSES) {
    g.lineStyle(w, color, a);
    g.beginPath();
    g.moveTo(mx - s, my - s);
    g.lineTo(mx + s, my + s);
    g.moveTo(mx + s, my - s);
    g.lineTo(mx - s, my + s);
    g.strokePath();
  }
}

/**
 * 감옥 캠핑 경고 구역 (정보 항목 'camp': r = campRadius, value = 단계 1 · 2): 철창 사각형에서 campRadius 이내 = 둥근 사각형, 주황
 */
export function drawCampZone(
  g: PathPen,
  item: InfoItem,
  rect: { x0: number; y0: number; x1: number; y1: number },
): void {
  const r = item.r ?? 0;
  const x0 = (rect.x0 - r) * T;
  const y0 = (rect.y0 - r) * T;
  const w = (rect.x1 - rect.x0 + 2 * r) * T;
  const h = (rect.y1 - rect.y0 + 2 * r) * T;
  const level = typeof item.value === 'number' ? item.value : 1;
  g.fillStyle(WARN, level >= 2 ? 0.1 : 0.06);
  roundRectPath(g, x0, y0, w, h, r * T);
  g.fillPath();
  g.lineStyle(4.5, OUTLINE, 0.5);
  roundRectPath(g, x0, y0, w, h, r * T);
  g.strokePath();
  g.lineStyle(2.5, WARN, 0.9);
  roundRectPath(g, x0, y0, w, h, r * T);
  g.strokePath();
}

/** 포효 충격파 (괴물 화면, 정보 항목 'roar': r = roar.radius까지 1회, 알파 0.25 이하). k = 0~1 (k → 1이면 반지름 = r) */
export function drawRoarWave(g: PathPen, item: InfoItem, k: number): void {
  const e = 1 - (1 - k) ** 2;
  const r = (item.r ?? 0) * T * e;
  const a = 0.22 * (1 - k);
  const cx = item.x * T;
  const cy = item.y * T;
  g.lineStyle(10, WARN, a * 0.5);
  g.beginPath();
  penArc(g, cx, cy, Math.max(1, r - 6), 0, Math.PI * 2);
  g.closePath();
  g.strokePath();
  g.lineStyle(3, WARN, a);
  g.beginPath();
  penArc(g, cx, cy, Math.max(1, r), 0, Math.PI * 2);
  g.closePath();
  g.strokePath();
}
