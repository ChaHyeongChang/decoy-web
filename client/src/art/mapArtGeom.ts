// 맵 그림의 순수 부분 (DOM · Phaser 없음, 단위 테스트 대상): 칸 분류, 벽 2.5D 면, 기둥 8각, 접촉 그림자,
// 데칼 · 네온 배치, 테두리 리프트 도형, 구조 색과 그 대비. 실제로 칠하는 코드는 mapArt.ts.
//
// 규칙 (VISUAL_SPEC 새 판 3장 · 정보 우선 R11):
//  - 입체 표현(윗면 · 앞면 · 테두리 · 기둥 8각)은 벽 · 기둥 칸 밖으로 나가지 않는다. 그림 경계 = 판정 경계
//  - 칸 밖으로 나가는 것은 바닥 쪽 접촉 그림자뿐이다(≤0.25타일, 바닥보다 어둡게만)
//  - 예약 색: 역할 4색 · #F8FAFC · 0.4~0.8타일 흰색/밝은 둥근 장식은 맵에 쓰지 않는다. 빨강은 감옥, 주황은 경고, 청록은 시설 · 목표
//  - 빛 속 바닥 상대휘도 ≤ 0.04 (역할색 몸과 바닥 대비 3:1), 어둠 속(하한을 곱한 상태) 구조 테두리와 바닥 대비 ≥ 2.5:1
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_RECT,
  Rng,
  tileAt,
  type ExitId,
  type TileKind,
  type Vec2,
} from '@decoy/shared';
import { NEON, NEON_DIM, UI, WARN, contrastRatio, multiplyRgb, relativeLuminance } from './palette';

export interface TileRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** 그래픽 상수 (판정과 무관). 길이는 타일 */
export const MAP_ART = {
  seed: 20261008,
  /** 벽 남쪽 앞면 높이 */
  wallFront: 0.34,
  /** 구조 테두리(윗면 가장자리 하이라이트) 두께 */
  rim: 0.075,
  /** 윗면 안쪽 덧선이 테두리에서 들어간 거리 */
  wallBevel: 0.2,
  /** 윗면 빗금 간격 */
  wallHatch: 0.2,
  /** 접촉 그림자 깊이: 벽 앞면 아래(남쪽 바닥) / 다른 쪽 (≤ 0.25) */
  shadowSouth: 0.24,
  shadowSide: 0.13,
  shadowAlpha: 0.62,
  /** 기둥: 받침에서 들어간 거리, 모서리 깎기(짧은 변 대비), 앞면 높이 */
  pillarInset: 0.07,
  pillarChamfer: 0.24,
  pillarFront: 0.3,
  /** 네온: 선 두께, 앞면 네온 높이(앞면 위에서부터 비율), 이 길이 이상인 벽 줄에만 */
  neonWidth: 0.05,
  neonFrontAt: 0.42,
  neonMinRun: 3,
  /** 데칼을 두지 않는 거리: 거점 중심 · 탈출구 중심 */
  decalClearPoint: 3.3,
  decalClearExit: 2.6,
} as const;

/**
 * 구조 색 (빛 속 원래 색). 시야 밖은 이 색 × 빛 지도 하한(colors.ts FOG)이고, 테두리에만 곱하기 뒤 리프트(rimLift)를 더한다.
 * 역할 4색 · #F8FAFC는 쓰지 않는다 (palette.ts 예약 색)
 */
export const MAP_COLOR = {
  outside: UI.mapOutside,
  floor: 0x17212b,
  /** 강판 윗면 하이라이트 (위 · 왼쪽 1px) */
  floorHi: 0x1f2b38,
  /** 강판 이음선 (아래 · 오른쪽 1px) */
  floorSeam: 0x0e151c,
  /** 4타일 큰 패널 이음선 */
  panelSeam: 0x0b1117,
  /** 줄무늬 강판 돌기 */
  tread: 0x1e2a37,
  decalDark: 0x0e151c,
  decalMid: 0x1a2430,
  cable: 0x0d141a,
  cableSheen: 0x1b2632,
  hazardA: 0x2a3540,
  hazardB: 0x111920,
  wallTop: 0x283646,
  wallTopBevel: 0x32445a,
  wallTopShade: 0x1f2b39,
  wallHatch: 0x324458,
  wallFront: 0x19232f,
  wallFrontLow: 0x0d141c,
  wallRib: 0x0f161e,
  /** 구조 테두리 (윗면 열린 가장자리). 빛이 왼쪽 위에서 오는 것처럼 동쪽 테두리는 조금 어둡게 */
  rim: 0x8ba3ba,
  rimDim: 0x6d8399,
  rimSpec: 0xb4c6d8,
  /** 곱하기 뒤에 더하는 테두리 리프트: 시야 밖에서도 테두리가 바닥과 2.5:1 이상 (시야와 무관한 정적 색) */
  rimLift: 0x222c35,
  pillarBase: 0x0b1117,
  pillarBaseEdge: 0x1d2834,
  pillarTop: 0x2b3a4b,
  pillarTopInner: 0x37495d,
  pillarCap: 0x223040,
  pillarFront: 0x141d27,
  pillarFrontLow: 0x0c121a,
  neon: NEON,
  neonCore: 0x7ee8fa,
  neonDim: NEON_DIM,
  grate: 0x0d141b,
  grateLine: 0x1a2430,
  barRail: 0x7a2027,
  /** 철창 (감옥 전용 빨강. 괴물 몸 #EF4444와 같은 값은 쓰지 않는다) */
  bar: 0xdc2626,
  barCore: 0xfca5a5,
  prisonDoor: 0x2a1418,
  doorRecess: 0x05090d,
  doorFrame: 0x2a3644,
  doorLeaf: 0x1c2631,
  doorLeafHi: 0x2a3644,
  chevronOff: 0x243140,
  padDecor: 0x1d2b39,
  terminal: 0x142029,
  terminalEdge: 0x3a5064,
  screen: NEON_DIM,
} as const;

/** 동적 오브젝트(거점 · 탈출구 상태) 그래픽 상수. 시간은 장식 연출 시간 (규칙 시간은 balance.json) */
export const OBJ = {
  /** 거점 바깥 눈금 수 */
  ticks: 24,
  /** 눈금 안쪽 · 바깥쪽 끝이 판정 반경에서 들어간 거리 (타일) */
  tickIn: 0.46,
  tickOut: 0.16,
  /** 눈금 한 칸에서 눈금이 차지하는 비율 */
  tickArc: 0.56,
  /** 스캔선 한 바퀴 (ms) */
  scanMs: 2400,
  /** 스캔선 꼬리 조각 알파 */
  scanTrail: [0.3, 0.2, 0.13, 0.08, 0.05, 0.03],
  /** 탈출구 활성 맥동 주기 (ms) */
  exitPulseMs: 1400,
  /** 셰브론 차례 점등 주기 (ms) */
  chaseMs: 900,
  /** 문 열림 미닫이 (ms, 장식) */
  doorSlideMs: 600,
  /** 개방 게이지 칸 수 */
  doorSegments: 8,
} as const;

/** 동적 오브젝트 색 (청록 = 시설 · 목표, 주황 = 경고, 초록 = 탈출구) */
export const OBJ_COLOR = {
  neon: NEON,
  neonDim: NEON_DIM,
  ring: 0x2fa3b8,
  pad: 0x0b4a5a,
  tickOff: 0x1b3240,
  warn: WARN,
  /** 탈출구 초록 (스카우트 역할색 #22C55E와 같은 값은 맵에 쓰지 않는다: 예약 색) */
  go: 0x10b981,
  off: 0x56657a,
  gauge: 0x34d399,
  gaugeOff: 0x12301f,
  openVoid: 0x03140b,
} as const;

/** 바닥에 쓰는 색 (빛 속 상대휘도 상한 검사 대상) */
export const FLOOR_COLORS: readonly number[] = [
  MAP_COLOR.floor,
  MAP_COLOR.floorHi,
  MAP_COLOR.floorSeam,
  MAP_COLOR.panelSeam,
  MAP_COLOR.tread,
  MAP_COLOR.decalDark,
  MAP_COLOR.decalMid,
  MAP_COLOR.cable,
  MAP_COLOR.cableSheen,
  MAP_COLOR.hazardA,
  MAP_COLOR.hazardB,
  MAP_COLOR.grate,
  MAP_COLOR.grateLine,
  MAP_COLOR.chevronOff,
  MAP_COLOR.padDecor,
];

/** 바닥 강판 톤 흔들림 (± 단계) */
export const FLOOR_JITTER = 3;

// ───────────────────────── 칸 분류 ─────────────────────────

/** 이동 · 시야를 막는 구조 칸 (벽 · 기둥 · 외벽 탈출구 문) */
export function isSolidKind(k: TileKind): boolean {
  return k === 'wall' || k === 'pillar' || k === 'exitN' || k === 'exitS';
}

/** 맵 밖은 벽으로 본다 */
export function solidAt(i: number, j: number): boolean {
  return isSolidKind(tileAt(i, j));
}

/** 벽 면이 드러나는 쪽: 맵 안이고 막히지 않은 칸 (바닥 · 철창 · 감옥 문) */
export function openAt(i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < MAP_W && j < MAP_H && !solidAt(i, j);
}

// ───────────────────────── 벽 2.5D ─────────────────────────

export type Side = 'n' | 's' | 'e' | 'w';

export interface Rim extends TileRect {
  readonly side: Side;
}

/** 벽 칸 하나의 면: 윗면 · (남쪽이 열려 있으면) 앞면 · 열린 쪽 테두리. 모두 칸 [i, i+1) × [j, j+1) 안 */
export interface WallFaces {
  readonly top: TileRect;
  readonly front: TileRect | null;
  readonly rims: readonly Rim[];
}

export function wallFaces(i: number, j: number): WallFaces {
  const f = openAt(i, j + 1) ? MAP_ART.wallFront : 0;
  const top: TileRect = { x0: i, y0: j, x1: i + 1, y1: j + 1 - f };
  const front: TileRect | null = f > 0 ? { x0: i, y0: j + 1 - f, x1: i + 1, y1: j + 1 } : null;
  const r = MAP_ART.rim;
  const rims: Rim[] = [];
  if (openAt(i, j - 1)) rims.push({ side: 'n', x0: i, y0: j, x1: i + 1, y1: j + r });
  // 남쪽: 앞면이 있으면 윗면과 앞면 사이 입술, 없으면(남쪽이 막힘) 테두리 없음
  if (f > 0) rims.push({ side: 's', x0: i, y0: top.y1 - r, x1: i + 1, y1: top.y1 });
  if (openAt(i - 1, j)) rims.push({ side: 'w', x0: i, y0: j, x1: i + r, y1: top.y1 });
  if (openAt(i + 1, j)) rims.push({ side: 'e', x0: i + 1 - r, y0: j, x1: i + 1, y1: top.y1 });
  return { top, front, rims };
}

/** 탈출구 문(2×1 외벽 칸)의 면: 벽과 같은 문법 (바닥 쪽이 남쪽이면 앞면 + 입술 테두리, 북쪽이면 윗 테두리) */
export function doorFaces(id: ExitId): WallFaces {
  const d = EXITS[id].door;
  const f = openAt(d.x0, d.y1) ? MAP_ART.wallFront : 0;
  const top: TileRect = { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 - f };
  const front: TileRect | null = f > 0 ? { x0: d.x0, y0: d.y1 - f, x1: d.x1, y1: d.y1 } : null;
  const r = MAP_ART.rim;
  const rims: Rim[] = [];
  if (openAt(d.x0, d.y0 - 1)) rims.push({ side: 'n', x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y0 + r });
  if (f > 0) rims.push({ side: 's', x0: d.x0, y0: top.y1 - r, x1: d.x1, y1: top.y1 });
  return { top, front, rims };
}

/** 탈출구 문 양옆의 문틀 칸 (이웃 외벽 칸, 윗면 안쪽). 오른쪽 문틀에 표지판(배지), 양쪽에 상태등 */
export function doorJambs(id: ExitId): TileRect[] {
  const d = EXITS[id].door;
  const f = doorFaces(id).top;
  return [
    { x0: d.x0 - 1, y0: f.y0, x1: d.x0, y1: f.y1 },
    { x0: d.x1, y0: f.y0, x1: d.x1 + 1, y1: f.y1 },
  ].filter((r) => tileAt(r.x0, d.y0) === 'wall');
}

/** 상태등 자리 (문틀 안쪽 세로 띠) */
export function doorLamps(id: ExitId): TileRect[] {
  const d = EXITS[id].door;
  return doorJambs(id).map((j) => {
    const north = d.y0 === 0;
    const inner = j.x0 < d.x0 ? j.x1 - 0.26 : j.x0 + 0.12;
    return {
      x0: inner,
      y0: j.y0 + (north ? 0.16 : MAP_ART.rim + 0.12),
      x1: inner + 0.14,
      y1: j.y1 - (north ? MAP_ART.rim + 0.12 : 0.16),
    };
  });
}

/** 모든 벽 칸 (탈출구 문 칸은 따로 그린다) */
export function wallCells(): { i: number; j: number }[] {
  const out: { i: number; j: number }[] = [];
  for (let j = 0; j < MAP_H; j += 1)
    for (let i = 0; i < MAP_W; i += 1) if (tileAt(i, j) === 'wall') out.push({ i, j });
  return out;
}

/** 같은 줄 · 같은 높이로 맞닿은 사각형을 합친다 (가로 먼저, 그다음 세로) */
export function mergeRects<T extends TileRect>(rects: readonly T[]): TileRect[] {
  const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  const byRow = [...rects].sort((a, b) => a.y0 - b.y0 || a.y1 - b.y1 || a.x0 - b.x0);
  const rows: TileRect[] = [];
  for (const r of byRow) {
    const last = rows[rows.length - 1];
    if (last && eq(last.y0, r.y0) && eq(last.y1, r.y1) && eq(last.x1, r.x0))
      rows[rows.length - 1] = { ...last, x1: r.x1 };
    else rows.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
  }
  const byCol = rows.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || a.y0 - b.y0);
  const out: TileRect[] = [];
  for (const r of byCol) {
    const last = out[out.length - 1];
    if (last && eq(last.x0, r.x0) && eq(last.x1, r.x1) && eq(last.y1, r.y0))
      out[out.length - 1] = { ...last, y1: r.y1 };
    else out.push(r);
  }
  return out;
}

// ───────────────────────── 기둥 ─────────────────────────

/** 기둥 칸 덩어리 (4방향으로 이어진 칸의 외접 사각형). 이 맵의 기둥은 모두 2×2 · 4×4 사각형이다 */
export function pillarBlocks(): TileRect[] {
  const seen = new Set<number>();
  const out: TileRect[] = [];
  for (let j = 0; j < MAP_H; j += 1) {
    for (let i = 0; i < MAP_W; i += 1) {
      if (tileAt(i, j) !== 'pillar' || seen.has(j * MAP_W + i)) continue;
      let x0 = i;
      let y0 = j;
      let x1 = i + 1;
      let y1 = j + 1;
      const stack: [number, number][] = [[i, j]];
      seen.add(j * MAP_W + i);
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) break;
        const [a, b] = cur;
        x0 = Math.min(x0, a);
        y0 = Math.min(y0, b);
        x1 = Math.max(x1, a + 1);
        y1 = Math.max(y1, b + 1);
        for (const [da, db] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const na = a + da;
          const nb = b + db;
          const key = nb * MAP_W + na;
          if (tileAt(na, nb) === 'pillar' && !seen.has(key) && na >= 0 && nb >= 0 && na < MAP_W) {
            seen.add(key);
            stack.push([na, nb]);
          }
        }
      }
      out.push({ x0, y0, x1, y1 });
    }
  }
  return out;
}

/** 볼록 다각형을 안쪽으로 d만큼 (시계 방향 · 화면 좌표, 이웃 변을 평행 이동한 교점) */
export function insetConvex(poly: readonly Vec2[], d: number): Vec2[] {
  const n = poly.length;
  const lines: { p: Vec2; v: Vec2 }[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const v = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // 화면 좌표(y 아래)에서 시계 방향 다각형의 안쪽 법선 = (−v.y, v.x)
    const nx = -v.y;
    const ny = v.x;
    lines.push({ p: { x: a.x + nx * d, y: a.y + ny * d }, v });
  }
  const out: Vec2[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l1 = lines[(i + lines.length - 1) % lines.length];
    const l2 = lines[i];
    if (!l1 || !l2) continue;
    const den = l1.v.x * l2.v.y - l1.v.y * l2.v.x;
    if (Math.abs(den) < 1e-12) {
      out.push(l2.p);
      continue;
    }
    const t = ((l2.p.x - l1.p.x) * l2.v.y - (l2.p.y - l1.p.y) * l2.v.x) / den;
    out.push({ x: l1.p.x + l1.v.x * t, y: l1.p.y + l1.v.y * t });
  }
  return out;
}

/** 깎은 8각 (시계 방향) */
export function octagon(x0: number, y0: number, x1: number, y1: number, c: number): Vec2[] {
  return [
    { x: x0 + c, y: y0 },
    { x: x1 - c, y: y0 },
    { x: x1, y: y0 + c },
    { x: x1, y: y1 - c },
    { x: x1 - c, y: y1 },
    { x: x0 + c, y: y1 },
    { x: x0, y: y1 - c },
    { x: x0, y: y0 + c },
  ];
}

export interface PillarShape {
  /** 받침 = 판정 칸 전체 (깎인 모서리 자리에도 받침이 보여 칸 전체가 막힌 것이 보인다) */
  readonly base: TileRect;
  /** 윗면 8각 */
  readonly top: Vec2[];
  /** 윗면 안쪽 덧선 8각 */
  readonly inner: Vec2[];
  /** 앞면 (8각 아래쪽 절반을 앞면 높이만큼 내린 띠) */
  readonly front: Vec2[];
  /** 윗테두리 띠 (사각형 8개) */
  readonly rim: Vec2[][];
  /** 테두리 변이 빛(왼쪽 위)을 받는가 (바깥 법선이 북 · 서쪽) */
  readonly rimLit: boolean[];
  /** 가운데 뚜껑 8각과 볼트 자리 */
  readonly cap: Vec2[];
  readonly capBolts: Vec2[];
}

export function pillarShape(b: TileRect): PillarShape {
  const m = MAP_ART.pillarInset;
  const f = MAP_ART.pillarFront;
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const c = MAP_ART.pillarChamfer * Math.min(w, h);
  const xa = b.x0 + m;
  const xb = b.x1 - m;
  const ya = b.y0 + m;
  const yb = b.y1 - m - f;
  const top = octagon(xa, ya, xb, yb, c);
  const front: Vec2[] = [
    { x: xb, y: yb - c },
    { x: xb, y: yb - c + f },
    { x: xb - c, y: yb + f },
    { x: xa + c, y: yb + f },
    { x: xa, y: yb - c + f },
    { x: xa, y: yb - c },
    { x: xa + c, y: yb },
    { x: xb - c, y: yb },
  ];
  const rimIn = insetConvex(top, MAP_ART.rim);
  const rim: Vec2[][] = [];
  const rimLit: boolean[] = [];
  for (let i = 0; i < top.length; i += 1) {
    const a = top[i];
    const bb = top[(i + 1) % top.length];
    const ib = rimIn[(i + 1) % rimIn.length];
    const ia = rimIn[i];
    if (!a || !bb || !ia || !ib) continue;
    rim.push([a, bb, ib, ia]);
    // 시계 방향 변의 바깥 법선 = (v.y, −v.x)
    const nx = bb.y - a.y;
    const ny = -(bb.x - a.x);
    rimLit.push(nx + ny < -1e-9 || (Math.abs(nx + ny) < 1e-9 && ny < 0));
  }
  const cap = insetConvex(top, Math.min(w, h) * 0.24);
  const capBolts = insetConvex(top, Math.min(w, h) * 0.24 + 0.1).filter((_, i) => i % 2 === 1);
  return { base: b, top, inner: insetConvex(top, 0.17), front, rim, rimLit, cap, capBolts };
}

// ───────────────────────── 접촉 그림자 ─────────────────────────

export interface ShadowStrip extends TileRect {
  /** 그림자가 시작하는 쪽 (막힌 이웃 쪽 가장자리) */
  readonly side: Side;
  readonly depth: number;
}

/** 바닥 칸 안에서 막힌 이웃 쪽 가장자리를 따라 깊이 ≤0.25타일 띠 (바닥보다 어둡게만 칠한다) */
export function contactShadows(): ShadowStrip[] {
  const out: ShadowStrip[] = [];
  for (let j = 0; j < MAP_H; j += 1) {
    for (let i = 0; i < MAP_W; i += 1) {
      if (tileAt(i, j) !== 'floor') continue;
      if (solidAt(i, j - 1)) {
        const d = MAP_ART.shadowSouth;
        out.push({ side: 'n', depth: d, x0: i, y0: j, x1: i + 1, y1: j + d });
      }
      if (solidAt(i, j + 1)) {
        const d = MAP_ART.shadowSide;
        out.push({ side: 's', depth: d, x0: i, y0: j + 1 - d, x1: i + 1, y1: j + 1 });
      }
      if (solidAt(i - 1, j)) {
        const d = MAP_ART.shadowSide;
        out.push({ side: 'w', depth: d, x0: i, y0: j, x1: i + d, y1: j + 1 });
      }
      if (solidAt(i + 1, j)) {
        const d = MAP_ART.shadowSide;
        out.push({ side: 'e', depth: d, x0: i + 1 - d, y0: j, x1: i + 1, y1: j + 1 });
      }
    }
  }
  return out;
}

// ───────────────────────── 네온 ─────────────────────────

/** 네온 선 (타일 좌표 선분). front = 벽 앞면 가로 띠, side = 윗면 가장자리 안쪽 세로 띠 */
export interface NeonRun {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly face: 'front' | 'side';
}

/** 벽을 따라 가는 가는 청록 네온 (직선). 시드 고정으로 일부 벽 줄에만 */
export function neonRuns(seed: number = MAP_ART.seed): NeonRun[] {
  const rng = new Rng(seed ^ 0x4e45);
  const out: NeonRun[] = [];
  // 앞면(남쪽이 열린 벽 칸)이 가로로 이어진 줄
  for (let j = 0; j < MAP_H; j += 1) {
    let i = 0;
    while (i < MAP_W) {
      if (!(tileAt(i, j) === 'wall' && openAt(i, j + 1))) {
        i += 1;
        continue;
      }
      let e = i;
      while (e < MAP_W && tileAt(e, j) === 'wall' && openAt(e, j + 1)) e += 1;
      const len = e - i;
      if (len >= MAP_ART.neonMinRun && rng.next() < 0.75) {
        const y = j + 1 - MAP_ART.wallFront + MAP_ART.wallFront * MAP_ART.neonFrontAt;
        out.push({ face: 'front', x0: i + 0.45, y0: y, x1: e - 0.45, y1: y });
      }
      i = e;
    }
  }
  // 동 · 서로 열린 세로 벽 줄: 윗면 가장자리 안쪽
  for (const side of ['w', 'e'] as const) {
    const di = side === 'w' ? -1 : 1;
    for (let i = 0; i < MAP_W; i += 1) {
      let j = 0;
      while (j < MAP_H) {
        if (!(tileAt(i, j) === 'wall' && openAt(i + di, j))) {
          j += 1;
          continue;
        }
        let e = j;
        while (e < MAP_H && tileAt(i, e) === 'wall' && openAt(i + di, e)) e += 1;
        const len = e - j;
        // 두께 1칸짜리 벽은 한쪽에만 (양쪽에 그리면 칸 안에 선 두 줄)
        const thin = openAt(i - di, Math.floor((j + e) / 2));
        if (len >= MAP_ART.neonMinRun + 1 && rng.next() < (thin ? 0.3 : 0.6)) {
          const x = side === 'w' ? i + MAP_ART.rim + 0.12 : i + 1 - MAP_ART.rim - 0.12;
          out.push({ face: 'side', x0: x, y0: j + 0.5, x1: x, y1: e - 0.5 - (openAt(i, e) ? 0.34 : 0) });
        }
        j = e;
      }
    }
  }
  return out;
}

/** 기둥 앞면 가운데의 짧은 표시등 (네온). 8각 아래 평평한 변 안쪽 */
export function pillarNeon(b: TileRect): NeonRun {
  const w = b.x1 - b.x0;
  const cx = (b.x0 + b.x1) / 2;
  const yb = b.y1 - MAP_ART.pillarInset - MAP_ART.pillarFront;
  const y = yb + MAP_ART.pillarFront * 0.45;
  return { face: 'front', x0: cx - 0.2 * w, y0: y, x1: cx + 0.2 * w, y1: y };
}

// ───────────────────────── 탈출구 바닥 ─────────────────────────

/** 탈출구 앞 바닥 셰브론 3개 (문을 가리킴, 판정 원 안). 꺼진 모양은 정적 맵, 켜진 모양은 fogPaint가 같은 도형으로 */
export function exitChevrons(id: ExitId): Vec2[][] {
  const e = EXITS[id];
  const north = e.door.y0 === 0;
  const cx = (e.door.x0 + e.door.x1) / 2;
  const hw = 0.42;
  const h = 0.22;
  const t = 0.13;
  const out: Vec2[][] = [];
  for (let n = 0; n < 3; n += 1) {
    if (north) {
      const y = e.door.y1 + 0.42 + n * 0.5;
      out.push([
        { x: cx - hw, y: y + h },
        { x: cx, y },
        { x: cx + hw, y: y + h },
        { x: cx + hw, y: y + h + t },
        { x: cx, y: y + t },
        { x: cx - hw, y: y + h + t },
      ]);
    } else {
      const y = e.door.y0 - 0.42 - n * 0.5;
      out.push([
        { x: cx - hw, y: y - h },
        { x: cx, y },
        { x: cx + hw, y: y - h },
        { x: cx + hw, y: y - h - t },
        { x: cx, y: y - t },
        { x: cx - hw, y: y - h - t },
      ]);
    }
  }
  return out;
}

// ───────────────────────── 데칼 ─────────────────────────

export type DecalKind = 'drain' | 'vent' | 'hatch' | 'cable';

export interface Decal extends TileRect {
  readonly kind: DecalKind;
}

function cellsOf(r: TileRect): { i: number; j: number }[] {
  const out: { i: number; j: number }[] = [];
  for (let j = Math.floor(r.y0); j < Math.ceil(r.y1); j += 1)
    for (let i = Math.floor(r.x0); i < Math.ceil(r.x1); i += 1) out.push({ i, j });
  return out;
}

function clearOfObjectives(r: TileRect): boolean {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const reach = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) / 2;
  for (const p of Object.values(CAPTURE_POINTS))
    if (Math.hypot(p.x - cx, p.y - cy) < MAP_ART.decalClearPoint + reach) return false;
  for (const e of Object.values(EXITS))
    if (Math.hypot(e.center.x - cx, e.center.y - cy) < MAP_ART.decalClearExit + reach) return false;
  const P = PRISON_RECT;
  if (r.x1 > P.x0 - 1 && r.x0 < P.x1 + 1 && r.y1 > P.y0 - 1 && r.y0 < P.y1 + 2) return false;
  return true;
}

/** 드문 바닥 데칼 (시드 고정). 모두 바닥 칸 위에만, 거점 · 탈출구 · 감옥 근처는 비운다 */
export function floorDecals(seed: number = MAP_ART.seed): Decal[] {
  const rng = new Rng(seed ^ 0xdeca1);
  const out: Decal[] = [];
  const taken = new Set<number>();
  const fits = (r: TileRect): boolean => {
    if (!clearOfObjectives(r)) return false;
    for (const { i, j } of cellsOf(r)) {
      if (tileAt(i, j) !== 'floor' || taken.has(j * MAP_W + i)) return false;
    }
    return true;
  };
  const take = (d: Decal): void => {
    out.push(d);
    // 이웃 칸까지 잡아 데칼끼리 붙지 않게
    for (const { i, j } of cellsOf({ x0: d.x0 - 1, y0: d.y0 - 1, x1: d.x1 + 1, y1: d.y1 + 1 }))
      taken.add(j * MAP_W + i);
  };
  const want: [DecalKind, number][] = [
    ['drain', 9],
    ['vent', 7],
    ['hatch', 8],
    ['cable', 6],
  ];
  for (const [kind, count] of want) {
    let made = 0;
    for (let tries = 0; tries < 400 && made < count; tries += 1) {
      const i = 1 + rng.int(MAP_W - 2);
      const j = 1 + rng.int(MAP_H - 2);
      let r: TileRect;
      if (kind === 'cable') {
        const len = 3 + rng.int(5);
        const vertical = rng.next() < 0.5;
        r = vertical ? { x0: i, y0: j, x1: i + 1, y1: j + len } : { x0: i, y0: j, x1: i + len, y1: j + 1 };
      } else if (kind === 'hatch') {
        r = { x0: i, y0: j, x1: i + 1, y1: j + 1 };
      } else {
        r = { x0: i, y0: j, x1: i + 1, y1: j + 1 };
      }
      if (!fits(r)) continue;
      take({ kind, ...r });
      made += 1;
    }
  }
  return out;
}

// ───────────────────────── 테두리 리프트 · 대비 ─────────────────────────

/** 곱하기 뒤에 더하는 테두리 리프트 도형 (타일 좌표 볼록 다각형): 벽 윗면 테두리 + 기둥 윗테두리 + 탈출구 문틀 */
export function rimLiftRects(): TileRect[] {
  const rects: TileRect[] = [];
  for (const { i, j } of wallCells()) for (const r of wallFaces(i, j).rims) rects.push(r);
  for (const id of Object.keys(EXITS) as ExitId[]) for (const r of doorFaces(id).rims) rects.push(r);
  return mergeRects(rects);
}

export function rimLiftPolys(): Vec2[][] {
  const out: Vec2[][] = [];
  for (const b of pillarBlocks()) for (const q of pillarShape(b).rim) out.push(q);
  return out;
}

/** 빛 지도 하한색을 곱한 시야 밖 색 */
export function darkOf(color: number, ambient: number): number {
  return multiplyRgb(color, ambient);
}

/** 채널마다 더하고 255에서 자른다 (Canvas 'lighter' · WebGL ADD) */
export function addRgb(a: number, b: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.min(255, ((a >> s) & 255) + ((b >> s) & 255)) << s;
  return out;
}

/** 시야 밖 테두리 화면 색 = 테두리 × 하한 + 리프트 */
export function darkRim(ambient: number): number {
  return addRgb(darkOf(MAP_COLOR.rim, ambient), MAP_COLOR.rimLift);
}

/** 시야 밖에서 테두리와 인접 바닥(가장 밝은 바닥 색 기준)의 대비 */
export function darkRimContrast(ambient: number): number {
  let worst = Infinity;
  for (const f of [MAP_COLOR.floor, MAP_COLOR.floorHi])
    worst = Math.min(worst, contrastRatio(darkRim(ambient), darkOf(f, ambient)));
  return worst;
}

/** 빛 속 바닥 색 중 가장 밝은 상대휘도 */
export function maxLitFloorLuminance(): number {
  let max = 0;
  for (const c of FLOOR_COLORS) max = Math.max(max, relativeLuminance(c));
  return max;
}
