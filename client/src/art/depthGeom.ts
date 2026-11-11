// 입체감 (깊이가 느껴지는 2D)의 순수 계산 (DOM · Phaser 없음, 단위 테스트 대상). 그리는 코드는 render/depthLayer.ts,
// 후처리 값은 render/effects.ts WorldGradePipeline. 규칙 원본은 VISUAL_SPEC 14장 '입체감'.
//
//  - 판정은 바닥 모양 그대로다(충돌 · 시야 다각형 · 공격 판정은 이 파일을 읽지 않는다). 그림만 바꾼다
//  - 투영: 벽 · 기둥의 윗면 = 맵을 카메라 중심 기준 (1 + parallax)배로 늘린 뒤 lift타일 위(화면 북쪽)로 올린 자리.
//    바닥(받침)과 윗면 사이에서 카메라 쪽을 보는 옆면(남쪽은 늘, 동 · 서는 카메라 중심 쪽)을 잇는다
//  - 입체 레이어는 구조 레이어(fogRoot) 안에 그린다: 캐릭터 · 부채꼴 · 범위 · 마커 · 배지 · 화면 밖 화살표는 늘 그 위다(가려지지 않음).
//    그래도 그려진 캐릭터 몸이 띄운 윗면 아래에 들어오거나, 거점 · 탈출구 판정 원과 겹치는 칸은 반투명(DEPTH.fadeAlpha)으로 한다
//  - 빛은 받은 정보로만 잰다: 칸 가장자리 바로 바깥 바닥 점에서 내 화면의 시야(생존자 = 팀 시야 다각형 · 부드러운 가장자리,
//    괴물 = 자기 부채꼴 · 근접 원)를 빛 지도와 같은 식으로. 그래서 벽이 받는 빛 · 벽 뒤 그림자가 시야 다각형 경계와 어긋나지 않는다
//  - 캐릭터 비스듬 그림자는 위치 · 몸 반지름만의 함수(역할 · 체력 · 능력 인자 없음 — 괴물 화면 생존자 셋이 똑같다)
//  - 예약 색: 역할 4색 · #F8FAFC를 쓰지 않는다. 벽 등은 청록 막대(둥근 밝은 장식이 아니다)
import { CAPTURE_POINTS, EXITS, MAP_H, MAP_W, POINT_IDS, tileAt, type Vec2 } from '@decoy/shared';
import { hash2, valueNoise } from './noise';
import {
  MAP_ART,
  MAP_COLOR,
  OBJ_COLOR,
  darkOf,
  neonRuns,
  octagon,
  pillarBlocks,
  type NeonRun,
  type TileRect,
} from './mapArtGeom';
import { EXIT_GO, NEON, PRISON_RED } from './palette';
import { DEPTH_SINK, type DepthLookId } from '../gfx/depth';

export type { DepthLookId } from '../gfx/depth';

/** 입체감 시안 하나의 값 (판정과 무관한 그래픽 값) */
export interface DepthLook {
  readonly id: DepthLookId;
  /** 벽 · 기둥 윗면을 띄우는 높이 (타일, 화면 북쪽) */
  readonly lift: number;
  /** 시차: 윗면을 카메라 중심 기준으로 늘리는 비율 (가장자리 벽일수록 바깥으로) */
  readonly parallax: number;
  /** 캐릭터 비스듬 그림자: 몸 반지름 배 오프셋(동 · 남) · 알파 */
  readonly castDx: number;
  readonly castDy: number;
  readonly castAlpha: number;
  /** 후처리: 어두운 화소를 더 가라앉히는 세기 (0 = 없음) */
  readonly crush: number;
  /**
   * 후처리: 등불 감쇠 — 시야 반경 밖 밝기 배율 (1 = 감쇠 없음). 모든 화소에 곱해져 어둠 속 구조 대비를 낮추므로 가라앉히기(crush)와
   * 함께 시야 밖 테두리 / 바닥 2.5:1(R14)이 남는 값까지만 (depth 단위 테스트가 gradePixel로 본다)
   */
  readonly lanternMin: number;
  /** 후처리: 등불 가운데 따뜻한 빛 세기 */
  readonly lanternWarm: number;
  /** 후처리: 비네트 최대 어둡게 (품질 높음 셰이더 비네트) */
  readonly vignette: number;
  /** 후처리: 괴물 화면 붉은 기운 */
  readonly monsterRed: number;
  /** 거점 · 감옥 · 탈출구 자기 빛 알파 (빛 지도 곱하기 앞 — 어둠 속에서는 하한만큼 약해지고 시간에 따라 변하지 않는다) */
  readonly halo: number;
}

export const DEPTH_LOOKS: Readonly<Record<DepthLookId, DepthLook>> = {
  a: {
    id: 'a',
    lift: 0.3,
    parallax: 0.025,
    castDx: 0.3,
    castDy: 0.45,
    castAlpha: 0.22,
    crush: 0.2,
    lanternMin: 0.92,
    lanternWarm: 0.07,
    vignette: 0.32,
    monsterRed: 0.16,
    halo: 0.1,
  },
  b: {
    id: 'b',
    lift: 0.46,
    parallax: 0.035,
    castDx: 0.38,
    castDy: 0.58,
    castAlpha: 0.32,
    crush: 0.3,
    lanternMin: 0.88,
    lanternWarm: 0.12,
    vignette: 0.36,
    monsterRed: 0.26,
    halo: 0.14,
  },
  c: {
    id: 'c',
    lift: 0.62,
    parallax: 0.045,
    castDx: 0.46,
    castDy: 0.7,
    castAlpha: 0.42,
    crush: 0.42,
    lanternMin: 0.86,
    lanternWarm: 0.16,
    vignette: 0.42,
    monsterRed: 0.36,
    halo: 0.18,
  },
};

/** 시안과 무관한 입체감 상수 */
export const DEPTH = {
  /** 캐릭터 · 판정 원과 겹친 칸의 알파 */
  fadeAlpha: 0.35,
  /** 캐릭터 몸 원에 더하는 여유 (타일): 몸 둘레 링 · 그림자까지 비친다 */
  fadePad: 0.18,
  /** 판정 원에 더하는 여유 (타일): 판정 원 선 두께 · 눈금 */
  objectivePad: 0.12,
  /** 빛 표본: 칸 가장자리에서 바깥 바닥으로 들어간 거리 (타일) */
  sampleOut: 0.08,
  /** 윗면 빛 (고정 — 손전등은 옆면을 비춘다. 윗면은 칸마다 얼룩지지 않게 한 색) */
  topLight: 0.5,
  /** 네온: 빛 0에서의 밝기 (발광이라 어둠 속에서도 이만큼 — 맵 그림 네온과 같이 어둠 속에서 보인다) · 선 두께 (타일) */
  neonFloor: 0.5,
  neonWidth: 0.05,
  /** 옆면 아래쪽(바닥에 닿는 쪽) 어둡게 (접촉 그림자) */
  faceFoot: 0.55,
  /** 동 · 서 옆면은 남쪽 면보다 이만큼 어둡게 (빛 방향) */
  sideShade: 0.82,
  /** 윗면 가장자리 테두리 두께 (타일) */
  rim: 0.06,
  /** 벽 등: 남쪽 면이 이 칸 수 이상 이어진 줄에, 이 간격으로 */
  lampMinRun: 4,
  lampEvery: 6,
  /** 벽 등 막대 폭 · 두께 (타일), 남쪽 면 위에서 아래로 놓인 높이 비율 */
  lampW: 0.34,
  lampH: 0.07,
  lampAt: 0.3,
  /** 벽 등이 깜빡일 때 가장 어두운 배율 · 깜빡이는 빈도 (1초당 판정 칸) · 깜빡일 확률 */
  lampDip: 0.35,
  lampRate: 9,
  lampChance: 0.09,
  /** 빛 단계 (윗면 색 · 테두리를 이 단계로 끊어 같은 단계 칸을 한 번에 그린다) */
  levels: 8,
  /** 거점 · 감옥 · 탈출구 자기 빛 반경 (타일) */
  haloPoint: 3.1,
  haloPrison: 3.4,
  haloExit: 2.4,
  /** 등불 감쇠 시작 · 끝 반경 (내 시야 반경 배) */
  lanternIn: 0.35,
  lanternOut: 1.25,
  /** 시드 */
  seed: 20261111,
} as const;

/** 입체 색 (빛 속 원래 색. 어둠 속은 × 빛 지도 하한 색). 역할 4색 · #F8FAFC 없음 */
export const DEPTH_COLOR = {
  /** 벽 윗면 · 기둥 윗면 */
  wallTop: MAP_COLOR.wallTop,
  pillarTop: MAP_COLOR.pillarTop,
  /** 옆면 (손전등 빛을 받으면 이 색까지 밝아진다 — 바닥보다 밝아 솟은 면이 읽힌다. 캐릭터는 늘 위 · 접지 그림자 링, R3) */
  wallFace: 0x3b4e64,
  pillarFace: 0x3a4c60,
  /** 네온 (맵 그림 네온과 같은 청록) */
  neon: MAP_COLOR.neon,
  /** 테두리 (윗면 가장자리): 맵 테두리와 같은 색 · 같은 어둠 속 리프트 */
  rim: MAP_COLOR.rim,
  rimLift: MAP_COLOR.rimLift,
  /** 벽 등 (시설 청록) */
  lamp: MAP_COLOR.neonCore,
  /** 자기 빛 */
  haloPoint: NEON,
  haloPointOff: OBJ_COLOR.off,
  haloPrison: PRISON_RED,
  haloExitOff: OBJ_COLOR.off,
  haloExitGo: EXIT_GO,
} as const;

// ───────────────────────── 띄우는 칸 ─────────────────────────

/** 0 = 띄우지 않음 · 1 = 벽 · 2 = 기둥 */
export type RaisedKind = 0 | 1 | 2;

/** 탈출구 문 양옆 문틀 칸 (상태등 · 표지판이 있어 띄우지 않는다) */
function isJamb(i: number, j: number): boolean {
  for (const id of ['N', 'S'] as const) {
    const d = EXITS[id].door;
    if (j >= d.y0 && j < d.y1 && (i === d.x0 - 1 || i === d.x1)) return true;
  }
  return false;
}

const RAISED: Uint8Array = (() => {
  const a = new Uint8Array(MAP_W * MAP_H);
  for (let j = 0; j < MAP_H; j += 1)
    for (let i = 0; i < MAP_W; i += 1) {
      const k = tileAt(i, j);
      if (k === 'wall' && !isJamb(i, j)) a[j * MAP_W + i] = 1;
      else if (k === 'pillar') a[j * MAP_W + i] = 2;
    }
  return a;
})();

/** 띄우는 칸인가: 벽(탈출구 문 · 문틀 빼고) 1, 기둥 2, 그 밖(바닥 · 철창 · 감옥 문 · 탈출구 문 · 맵 밖) 0 */
export function raisedAt(i: number, j: number): RaisedKind {
  if (i < 0 || j < 0 || i >= MAP_W || j >= MAP_H) return 0;
  return (RAISED[j * MAP_W + i] ?? 0) as RaisedKind;
}

/** 띄운 벽 칸 (기둥은 덩어리 pillarPrisms로 따로) */
export function raisedWall(i: number, j: number): boolean {
  return raisedAt(i, j) === 1;
}

// ───────────────────────── 투영 ─────────────────────────

/** 카메라 중심 (타일) */
export interface Cam {
  readonly x: number;
  readonly y: number;
}

/** 윗면 높이의 점 (x, y)가 화면(월드 타일 좌표)에 놓이는 자리 */
export function projectTop(
  x: number,
  y: number,
  cam: Cam,
  look: DepthLook,
  out: { x: number; y: number },
): void {
  const s = 1 + look.parallax;
  out.x = cam.x + (x - cam.x) * s;
  out.y = cam.y + (y - cam.y) * s - look.lift;
}

/** 윗면 높이의 x만 */
export function projX(x: number, cam: Cam, look: DepthLook): number {
  return cam.x + (x - cam.x) * (1 + look.parallax);
}

/** 윗면 높이의 y만 */
export function projY(y: number, cam: Cam, look: DepthLook): number {
  return cam.y + (y - cam.y) * (1 + look.parallax) - look.lift;
}

/**
 * 한 칸의 옆면이 보이는가 (그 쪽 이웃이 띄운 칸이 아니고, 윗면이 받침보다 카메라 쪽으로 물러난 면).
 * 남쪽: 윗면 남쪽 변이 받침 남쪽 변보다 위(북)에 있으면 — lift가 시차(보이는 창 반높이 × parallax)보다 커서 화면 안에서는 늘 보인다.
 * 동쪽: 윗면 동쪽 변이 받침보다 서쪽(카메라 중심이 동쪽), 서쪽: 그 반대. 북쪽 면은 그리지 않는다(윗면 뒤)
 */
export function faceVisible(side: 's' | 'e' | 'w', i: number, j: number, cam: Cam, look: DepthLook): boolean {
  switch (side) {
    case 's':
      return projY(j + 1, cam, look) < j + 1;
    case 'e':
      return projX(i + 1, cam, look) < i + 1 - 1e-9;
    case 'w':
      return projX(i, cam, look) > i + 1e-9;
  }
}

/** 한 칸 윗면의 투영 사각형 (늘린 뒤 올린 칸 = 축에 나란한 사각형). out을 주면 거기에 쓴다(프레임마다 객체를 만들지 않게) */
export function topRect(
  i: number,
  j: number,
  cam: Cam,
  look: DepthLook,
  out: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: 0, y1: 0 },
): TileRect {
  out.x0 = projX(i, cam, look);
  out.y0 = projY(j, cam, look);
  out.x1 = projX(i + 1, cam, look);
  out.y1 = projY(j + 1, cam, look);
  return out;
}

/** 한 칸이 화면에서 차지하는 범위 (받침 ∪ 윗면 ∪ 옆면 = 둘의 외접 사각형) */
export function cellHull(i: number, j: number, cam: Cam, look: DepthLook): TileRect {
  const t = topRect(i, j, cam, look);
  return {
    x0: Math.min(i, t.x0),
    y0: Math.min(j, t.y0),
    x1: Math.max(i + 1, t.x1),
    y1: Math.max(j + 1, t.y1),
  };
}

// ───────────────────────── 기둥 (8각 프리즘) ─────────────────────────

/** 기둥 덩어리 하나: 받침 8각 (시계 방향) */
export interface PillarPrism {
  readonly block: TileRect;
  readonly base: readonly Vec2[];
}

/** 모든 기둥 덩어리의 받침 8각 (맵 그림 pillarShape와 같은 안쪽 들임 · 모서리 깎기) */
export const PILLAR_PRISMS: readonly PillarPrism[] = pillarBlocks().map((b) => {
  const m = MAP_ART.pillarInset;
  const c = MAP_ART.pillarChamfer * Math.min(b.x1 - b.x0, b.y1 - b.y0);
  return { block: b, base: octagon(b.x0 + m, b.y0 + m, b.x1 - m, b.y1 - m, c) };
});

/**
 * 프리즘 옆면 k(받침 변 k → k+1)가 보이는가: 시계 방향 변의 바깥 법선 (v.y, −v.x)과 윗면이 밀린 방향(윗면 변 가운데 − 받침 변 가운데)이
 * 반대 쪽이면(윗면이 그 면 안쪽으로 물러났으면) 카메라가 그 면을 본다
 */
export function prismFaceVisible(a: Vec2, b: Vec2, ta: Vec2, tb: Vec2): boolean {
  const nx = b.y - a.y;
  const ny = -(b.x - a.x);
  const mx = (ta.x + tb.x - a.x - b.x) / 2;
  const my = (ta.y + tb.y - a.y - b.y) / 2;
  return nx * mx + ny * my < -1e-9;
}

// ───────────────────────── 반투명 (정보가 묻히지 않게) ─────────────────────────

/** 원 (타일) */
export interface Disk {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * 볼록 다각형을 축에 나란한 선으로 자른 한쪽 (Sutherland–Hodgman 한 변). keepLess = 좌표 ≤ value 쪽을 남긴다. 결과도 볼록
 */
export function clipConvex(poly: readonly Vec2[], axis: 'x' | 'y', value: number, keepLess: boolean): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  const inside = (p: Vec2): boolean => (keepLess ? p[axis] <= value : p[axis] >= value);
  for (let k = 0; k < n; k += 1) {
    const a = poly[k];
    const b = poly[(k + 1) % n];
    if (!a || !b) continue;
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/**
 * 띄운 윗면(볼록 다각형)을 받침 사각형 안쪽과 바깥쪽 조각들로 나눈다. 반투명 칸은 바깥쪽(바닥 위로 뻗은 부분)만 비치게 그린다 —
 * 받침 안쪽까지 비치면 맵 그림의 옛 벽 그림이 겹쳐 보인다. 조각은 모두 볼록이고 합치면 원래 다각형이다
 */
export function splitByRect(poly: readonly Vec2[], r: TileRect): { inside: Vec2[]; outside: Vec2[][] } {
  const outside: Vec2[][] = [];
  const push = (p: Vec2[]): void => {
    if (p.length >= 3) outside.push(p);
  };
  push(clipConvex(poly, 'y', r.y0, true));
  let rest = clipConvex(poly, 'y', r.y0, false);
  push(clipConvex(rest, 'y', r.y1, false));
  rest = clipConvex(rest, 'y', r.y1, true);
  push(clipConvex(rest, 'x', r.x0, true));
  rest = clipConvex(rest, 'x', r.x0, false);
  push(clipConvex(rest, 'x', r.x1, false));
  rest = clipConvex(rest, 'x', r.x1, true);
  return { inside: rest.length >= 3 ? rest : [], outside };
}

/**
 * 벽 칸 (i, j)의 받침 범위: 그 칸을 띄운 이웃 벽 칸 쪽으로 한 칸씩 넓힌 사각형 (이웃 벽 위로 뻗은 윗면은 바닥이 아니라 벽 위라
 * 비치지 않는다). 윗면이 칸 밖으로 나가는 거리(lift + 시차)는 1타일보다 작다
 */
export function wallFootprint(i: number, j: number): TileRect {
  return {
    x0: raisedAt(i - 1, j) !== 0 ? i - 1 : i,
    y0: raisedAt(i, j - 1) !== 0 ? j - 1 : j,
    x1: raisedAt(i + 1, j) !== 0 ? i + 2 : i + 1,
    y1: raisedAt(i, j + 1) !== 0 ? j + 2 : j + 1,
  };
}

/** 원이 사각형과 겹치는가 */
export function diskHitsRect(d: Disk, r: TileRect): boolean {
  const qx = Math.max(r.x0, Math.min(d.x, r.x1));
  const qy = Math.max(r.y0, Math.min(d.y, r.y1));
  const dx = d.x - qx;
  const dy = d.y - qy;
  return dx * dx + dy * dy < d.r * d.r;
}

/** 원 둘이 겹치는가 */
export function diskHitsDisk(a: Disk, b: Disk): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.r + b.r;
  return dx * dx + dy * dy < r * r;
}

/** 판정 원 목록 (거점 셋 · 탈출구 둘). 반지름은 balance 값 + 여유 */
export function objectiveDisks(pointR: number, exitR: number): Disk[] {
  const out: Disk[] = [];
  for (const id of POINT_IDS) {
    const p = CAPTURE_POINTS[id];
    out.push({ x: p.x, y: p.y, r: pointR + DEPTH.objectivePad });
  }
  for (const id of ['N', 'S'] as const) {
    const c = EXITS[id].center;
    out.push({ x: c.x, y: c.y, r: exitR + DEPTH.objectivePad });
  }
  return out;
}

/**
 * 이 범위(띄운 윗면의 외접 사각형 — 칸이면 topRect, 기둥이면 투영한 8각의 외접 사각형)를 반투명으로 그리는가: 그려진 캐릭터 몸
 * 원(+ 여유)이 겹치거나 판정 원과 겹친다. 옆면은 받침(판정 칸) 안이라 몸이 들어올 수 없고, 앞(남쪽)에 선 캐릭터는 윗면 아래가 아니다.
 * 캐릭터 몸 원은 이번 프레임에 그린 것만(받은 정보) — 안 보이는 상대는 원래 목록에 없다
 */
export function fadedRect(hull: TileRect, bodies: readonly Disk[], objectives: readonly Disk[]): boolean {
  for (let i = 0; i < bodies.length; i += 1) {
    const b = bodies[i];
    if (b && diskHitsRectXY(b.x, b.y, b.r + DEPTH.fadePad, hull)) return true;
  }
  for (let i = 0; i < objectives.length; i += 1) {
    const o = objectives[i];
    if (o && diskHitsRectXY(o.x, o.y, o.r, hull)) return true;
  }
  return false;
}

/** 원 (x, y, r)이 사각형과 겹치는가 (객체 없이) */
function diskHitsRectXY(x: number, y: number, r: number, rect: TileRect): boolean {
  const qx = Math.max(rect.x0, Math.min(x, rect.x1));
  const qy = Math.max(rect.y0, Math.min(y, rect.y1));
  const dx = x - qx;
  const dy = y - qy;
  return dx * dx + dy * dy < r * r;
}

// ───────────────────────── 빛 (받은 정보로만) ─────────────────────────

/**
 * 내 화면 시야 하나 (worldRenderer 안개 주기의 눈과 같은 값): 다각형 · 중심 · 판정 반경 r · 부드러운 가장자리 시작 반경 inner.
 * hard = 괴물 부채꼴 · 근접 원(딱 자른 빛, 다각형 안 = 1)
 */
export interface LightEye {
  readonly poly: readonly Vec2[];
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly inner: number;
  readonly hard: boolean;
}

/** 점이 다각형 안인가 (짝홀 규칙) */
export function insidePoly(px: number, py: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * 바닥 점 (x, y)의 빛 0~1 = 빛 지도와 같은 식: 부드러운 시야는 clamp((r − d) / (r − inner)), 딱 자른 시야는 1 — 다각형 안에서만.
 * 여러 시야는 최댓값(겹쳐도 더 밝아지지 않는다)
 */
export function lightAt(x: number, y: number, eyes: readonly LightEye[]): number {
  let best = 0;
  for (let k = 0; k < eyes.length; k += 1) {
    const e = eyes[k];
    if (!e) continue;
    const dx = x - e.x;
    const dy = y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= e.r * e.r) continue;
    let g = 1;
    if (!e.hard) {
      const soft = Math.max(1e-6, e.r - e.inner);
      g = Math.max(0, Math.min(1, (e.r - Math.sqrt(d2)) / soft));
    }
    if (g <= best) continue;
    if (insidePoly(x, y, e.poly)) best = g;
  }
  return best;
}

/** 빛 단계로 끊기 (윗면 · 테두리를 같은 단계끼리 묶어 그린다) */
export function lightLevel(l: number): number {
  return Math.round(Math.max(0, Math.min(1, l)) * DEPTH.levels) / DEPTH.levels;
}

/** 칸 가장자리 빛 표본 자리 (가장자리 가운데에서 바깥 바닥으로 sampleOut) */
export function edgeSample(
  side: 'n' | 's' | 'e' | 'w',
  i: number,
  j: number,
  out: { x: number; y: number },
): void {
  const o = DEPTH.sampleOut;
  switch (side) {
    case 'n':
      out.x = i + 0.5;
      out.y = j - o;
      return;
    case 's':
      out.x = i + 0.5;
      out.y = j + 1 + o;
      return;
    case 'e':
      out.x = i + 1 + o;
      out.y = j + 0.5;
      return;
    case 'w':
      out.x = i - o;
      out.y = j + 0.5;
      return;
  }
}

/** 두 색을 t(0~1)로 섞는다 (채널마다 반올림) */
function mixRgb(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (r << 16) | (g << 8) | bl;
}

/** 빛 0~1에서 화면 색: 어둠 = 원래 색 × 하한 색(빛 지도 곱하기와 같은 값), 빛 = 원래 색 */
export function litColor(base: number, ambientRgb: number, light: number): number {
  const dark = darkOf(base, ambientRgb);
  if (light <= 0) return dark;
  if (light >= 1) return base;
  return mixRgb(dark, base, light);
}

/** 채널마다 더하고 255에서 자른다 */
function addRgb(a: number, b: number): number {
  const r = Math.min(255, ((a >> 16) & 255) + ((b >> 16) & 255));
  const g = Math.min(255, ((a >> 8) & 255) + ((b >> 8) & 255));
  const bl = Math.min(255, (a & 255) + (b & 255));
  return (r << 16) | (g << 8) | bl;
}

/** 하한 색마다 어둠 속 테두리 색 (맵 그림 darkRim과 같은 값 — 프레임마다 다시 곱하지 않게 하나만 기억) */
let darkRimFor = -1;
let darkRimColor = 0;

/**
 * 테두리 색: 빛 속 = 테두리 원래 색, 어둠 속 = 테두리 × 하한 + 리프트 (맵 그림 darkRim과 같은 값 — 시야 밖 구조 2.5:1, R14)
 */
export function rimColor(ambientRgb: number, light: number): number {
  if (darkRimFor !== ambientRgb) {
    darkRimFor = ambientRgb;
    darkRimColor = addRgb(darkOf(DEPTH_COLOR.rim, ambientRgb), DEPTH_COLOR.rimLift);
  }
  if (light <= 0) return darkRimColor;
  return mixRgb(darkRimColor, DEPTH_COLOR.rim, Math.min(1, light));
}

/**
 * 등불 가운데 색 배율 (화소를 밝히지 않게 1 이하 — 초록 · 파랑을 줄여 따뜻하게, 괴물 화면은 더 붉게). 셰이더 uWarm
 */
export function lanternWarm(look: DepthLook, monster: boolean): [number, number, number] {
  const w = look.lanternWarm;
  return monster ? [1, 1 - 0.9 * w, 1 - w] : [1, 1 - 0.45 * w, 1 - 0.9 * w];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * 후처리 입체감 줄을 화소 하나에 (render/effects.ts WORLD_GRADE_FRAG의 uDepth 줄과 같은 식 — 색보정 · 비네트 · 붉은 기운 · 따뜻한 빛
 * 제외): 등불 배율 k(1 ~ lanternMin) × 가라앉히기. 어둡게만 한다(결과 ≤ 입력). 단위 테스트가 R14(시야 밖 구조 2.5:1)를 이 식으로 본다
 */
export function gradePixel(color: number, k: number, crush: number): number {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sink = 1 - crush * (1 - smoothstep(DEPTH_SINK.lo, DEPTH_SINK.hi, L));
  const m = k * sink;
  const c = (v: number): number => Math.round(Math.max(0, Math.min(1, v * m)) * 255);
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/** 색에 배율 (0~1) — palette.multiplyRgb에 회색을 곱한 것과 같은 값 */
export function shade(color: number, k: number): number {
  const v = Math.max(0, Math.min(255, Math.round(k * 255)));
  const r = Math.round((((color >> 16) & 255) * v) / 255);
  const g = Math.round((((color >> 8) & 255) * v) / 255);
  const b = Math.round(((color & 255) * v) / 255);
  return (r << 16) | (g << 8) | b;
}

// ───────────────────────── 벽 등 (깜빡임은 내 시야 안에서만) ─────────────────────────

/** 벽 등 하나: 남쪽 면이 있는 벽 칸 (i, j) 가운데 */
export interface WallLamp {
  readonly i: number;
  readonly j: number;
  readonly seed: number;
}

/** 남쪽 면이 lampMinRun칸 이상 이어진 벽 줄에 lampEvery칸 간격 (시드 고정). 탈출구 판정 원 근처는 뺀다 */
export const WALL_LAMPS: readonly WallLamp[] = (() => {
  const out: WallLamp[] = [];
  for (let j = 0; j < MAP_H; j += 1) {
    let i = 0;
    while (i < MAP_W) {
      if (!(raisedWall(i, j) && raisedAt(i, j + 1) === 0 && j + 1 < MAP_H)) {
        i += 1;
        continue;
      }
      let e = i;
      while (e < MAP_W && raisedWall(e, j) && raisedAt(e, j + 1) === 0) e += 1;
      if (e - i >= DEPTH.lampMinRun) {
        const start = i + 1 + Math.floor(hash2(i, j, DEPTH.seed) * 2);
        for (let k = start; k < e - 1; k += DEPTH.lampEvery) {
          const nearExit = (['N', 'S'] as const).some((id) => {
            const c = EXITS[id].center;
            return Math.abs(k + 0.5 - c.x) < 3 && Math.abs(j + 1 - c.y) < 3;
          });
          if (!nearExit) out.push({ i: k, j, seed: Math.floor(hash2(k, j, DEPTH.seed ^ 0x1a) * 1e6) });
        }
      }
      i = e;
    }
  }
  return out;
})();

/**
 * 벽 등 밝기 배율 (장식 시계 tS초 · 등 시드): 대개 1, 가끔 짧게 lampDip까지 떨어진다. 결정적(시드 · 시계만).
 * 그리는 쪽이 빛 0(내 시야 밖)이면 이 값을 쓰지 않는다 — 어둠 속 구조는 시간에 따라 변하지 않는다(R9)
 */
export function lampFlicker(tS: number, seed: number): number {
  const slot = Math.floor(tS * DEPTH.lampRate);
  if (hash2(slot, seed, DEPTH.seed) < DEPTH.lampChance) return DEPTH.lampDip;
  return 1 - 0.06 * valueNoise(tS * 2.3, seed * 0.001, DEPTH.seed);
}

/** 내 시야 빛 light(0~1)에서 등 밝기 배율: 빛 0이면 1(정지), 빛이 있으면 깜빡임을 빛만큼 섞는다 */
export function lampLevel(tS: number, seed: number, light: number): number {
  if (light <= 0) return 1;
  return 1 + (lampFlicker(tS, seed) - 1) * Math.min(1, light);
}

// ───────────────────────── 네온 (맵 그림 네온 자리를 띄운 벽에) ─────────────────────────

/**
 * 띄운 벽에 다시 그리는 네온 (맵 그림 neonRuns와 같은 줄 · 시드): 앞면 네온은 남쪽 면의 같은 높이 비율에, 윗면 가장자리 네온은
 * 투영한 윗면에. 띄우지 않는 칸(탈출구 문틀)에 걸친 줄은 뺀다
 */
export const DEPTH_NEON: readonly NeonRun[] = neonRuns().filter((n) => {
  const j = Math.floor(n.face === 'front' ? n.y0 : (n.y0 + n.y1) / 2);
  for (let x = Math.floor(n.x0); x <= Math.floor(n.x1); x += 1) if (!raisedWall(x, j)) return false;
  return true;
});

/** 앞면 네온의 남쪽 면 위 높이 비율 (윗면 쪽 0 → 바닥 1) — 맵 그림 앞면(0.34타일) 안 자리와 같은 비율 */
export const NEON_FRONT_AT = MAP_ART.neonFrontAt;

// ───────────────────────── 자기 빛 (거점 · 감옥 · 탈출구) ─────────────────────────

/** 캐릭터 비스듬 그림자 오프셋 (타일): 몸 반지름 r의 함수뿐 — 역할 · 체력 · 능력과 무관 */
export function castOffset(look: DepthLook, r: number): { dx: number; dy: number } {
  return { dx: look.castDx * r, dy: look.castDy * r };
}
