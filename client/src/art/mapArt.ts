// 정적 맵 굽기 (M10b): 강판 바닥 · 2.5D 벽 · 깎은 8각 기둥 · 감옥 철창 · 거점 단말 · 방폭문 · 청록 네온.
// 배율 scale(출력 px / 월드 px)로 직접 그리고(이중 리샘플 없음), 칸 채움은 기기 픽셀 정수 경계에 맞춘다.
// 시드 고정이라 같은 배율이면 언제나 같은 그림이다. 한 번 구워 캐시하고(getStaticMap), 판 시작 때 끊기지 않게
// 로비에서 미리 구울 수 있다(render/baseLayer.ts prebakeFogArt). 매 프레임에는 이 이미지만 그린다.
//
// 발광(네온 · 철창 · 단말 화면의 번짐)은 낮은 해상도 캔버스 하나(getGlowMap)에 굽고, 모든 경로(GPU 조각 · Canvas · 미니맵)에서
// 정적 맵에 구워 넣는다(따라가는 카메라: 발광을 따로 올리는 큰 텍스처를 없앴다 — DECISIONS 9절). 빛 지도에 곱해지므로 발광은
// 어둠 속에서 약 30%(하한), 빛 속에서 100%다. 시간 · 상대 위치와 무관한 정적 그림이다.
// 시야 밖 구조 대비(테두리 ↔ 바닥 2.5:1)는 곱하기 뒤에 더하는 테두리 리프트(render/fogPaint.ts)가 맡는다.
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_RECT,
  TILE_PX,
  tileAt,
  type ExitId,
  type Vec2,
} from '@decoy/shared';
import { gfxState } from '../gfx/state';
import { MAP_SCALE, WORLD_SCALE } from '../ui/layout';
import {
  FLOOR_JITTER,
  MAP_ART,
  MAP_COLOR,
  contactShadows,
  doorFaces,
  doorJambs,
  doorLamps,
  exitChevrons,
  floorDecals,
  neonRuns,
  openAt,
  pillarBlocks,
  pillarNeon,
  pillarShape,
  wallCells,
  wallFaces,
  type Decal,
  type NeonRun,
  type TileRect,
} from './mapArtGeom';
import { BADGE } from './mapArtBadges';
import { fbm, hash2, valueNoise } from './noise';

const MC = MAP_COLOR;

function rgba(c: number, a = 1): string {
  return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
}

/** 채널마다 d를 더한다 (0~255로 자름) */
function shade(c: number, d: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.max(0, Math.min(255, ((c >> s) & 255) + d)) << s;
  return out;
}

/** 정적 맵 기하 (맵이 고정이라 한 번만 계산한다: 조각 굽기가 조각마다 다시 세지 않게) */
let geomCache: {
  walls: { i: number; j: number }[];
  shadows: ReturnType<typeof contactShadows>;
  pillars: TileRect[];
  neon: NeonRun[];
} | null = null;

function geomOf(): NonNullable<typeof geomCache> {
  geomCache ??= { walls: wallCells(), shadows: contactShadows(), pillars: pillarBlocks(), neon: allNeon() };
  return geomCache;
}

const decalCache = new Map<number, Decal[]>();

function decalsOf(seed: number): Decal[] {
  let d = decalCache.get(seed);
  if (!d) {
    d = floorDecals(seed);
    decalCache.set(seed, d);
  }
  return d;
}

/** 배율 scale로 그린 정적 맵 캔버스 크기 (px) */
export function staticMapSize(scale: number): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(MAP_W * TILE_PX * scale)),
    h: Math.max(1, Math.round(MAP_H * TILE_PX * scale)),
  };
}

/** 맵 전체 그림 좌표(px)의 사각형 */
export interface PxBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 타일 좌표로 그리고 사각형은 기기 픽셀 정수 경계에 맞추는 붓. k = px / 타일.
 * cull이 있으면 그 사각형(맵 전체 그림 px, 바깥 몇 px 여유 포함)과 겹치지 않는 사각형 · 다각형 · 선은 그리지 않는다
 * (조각 굽기: 그리는 쪽이 정수 이동 + 자르기를 건 컨텍스트라 겹치는 것만 칠해도 같은 화소다)
 */
class Painter {
  /** 가는 선 한 줄 두께 (기기 px) */
  readonly d: number;
  /** 맵 전체 그림 크기 (px) */
  readonly W: number;
  readonly H: number;

  constructor(
    readonly c: CanvasRenderingContext2D,
    readonly k: number,
    readonly cull: PxBox | null = null,
  ) {
    this.d = Math.max(1, Math.round(k / 28));
    this.W = Math.max(1, Math.round(MAP_W * k));
    this.H = Math.max(1, Math.round(MAP_H * k));
  }

  X(t: number): number {
    return Math.round(t * this.k);
  }

  /** 타일 사각형(여유 1타일 — 그림자 · 테두리 · 선 굵기)이 그릴 범위와 겹치는가 (반복문을 칸 단위로 건너뛴다) */
  tileHits(x0: number, y0: number, x1: number, y1: number): boolean {
    if (this.cull === null) return true;
    const k = this.k;
    return this.hits((x0 - 1) * k, (y0 - 1) * k, (x1 + 1) * k, (y1 + 1) * k);
  }

  /** 맵 px 사각형이 그릴 범위와 겹치는가 */
  hits(x0: number, y0: number, x1: number, y1: number): boolean {
    const q = this.cull;
    return q === null || (x1 >= q.x0 && x0 <= q.x1 && y1 >= q.y0 && y0 <= q.y1);
  }

  /** 점 목록(타일)의 외접 사각형 + 두께 pad(px)가 그릴 범위와 겹치는가 */
  hitsPts(points: readonly Vec2[], pad: number): boolean {
    if (this.cull === null) return true;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const k = this.k;
    return this.hits(x0 * k - pad, y0 * k - pad, x1 * k + pad, y1 * k + pad);
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: number, alpha = 1): void {
    const a = this.X(x0);
    const b = this.X(y0);
    this.dev(a, b, this.X(x1) - a, this.X(y1) - b, color, alpha);
  }

  r(t: TileRect, color: number, alpha = 1): void {
    this.rect(t.x0, t.y0, t.x1, t.y1, color, alpha);
  }

  /** 기기 px 사각형 */
  dev(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    if (w <= 0 || h <= 0 || !this.hits(x, y, x + w, y + h)) return;
    this.c.fillStyle = rgba(color, alpha);
    this.c.fillRect(x, y, w, h);
  }

  path(points: readonly Vec2[], close = true): void {
    const c = this.c;
    c.beginPath();
    points.forEach((p, i) => {
      if (i === 0) c.moveTo(p.x * this.k, p.y * this.k);
      else c.lineTo(p.x * this.k, p.y * this.k);
    });
    if (close) c.closePath();
  }

  poly(points: readonly Vec2[], color: number | CanvasGradient, alpha = 1): void {
    if (points.length < 3 || !this.hitsPts(points, 2)) return;
    this.path(points);
    this.c.fillStyle = typeof color === 'number' ? rgba(color, alpha) : color;
    this.c.fill();
  }

  /** 선 (두께는 기기 px) */
  stroke(
    points: readonly Vec2[],
    close: boolean,
    width: number,
    color: number,
    alpha = 1,
    cap: CanvasLineCap = 'butt',
  ): void {
    if (points.length < 2 || !this.hitsPts(points, width + 2)) return;
    const c = this.c;
    this.path(points, close);
    c.lineWidth = width;
    c.lineCap = cap;
    c.lineJoin = 'miter';
    c.strokeStyle = rgba(color, alpha);
    c.stroke();
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha = 1): void {
    this.stroke(
      [
        { x: x0, y: y0 },
        { x: x1, y: y1 },
      ],
      false,
      width,
      color,
      alpha,
    );
  }
}

// ───────────────────────── 바닥 ─────────────────────────

function paintFloor(P: Painter, seed: number): void {
  const { c, d } = P;
  c.fillStyle = rgba(MC.floor);
  c.fillRect(0, 0, P.W, P.H);
  const tread: { i: number; j: number }[] = [];
  for (let j = 0; j < MAP_H; j += 1) {
    for (let i = 0; i < MAP_W; i += 1) {
      if (tileAt(i, j) !== 'floor') continue;
      // 줄무늬 강판 고르기(해시)는 그릴 범위 밖 칸도 같은 값이라 건너뛰어도 그림이 같다
      if (!P.tileHits(i, j, i + 1, j + 1)) continue;
      const x0 = P.X(i);
      const x1 = P.X(i + 1);
      const y0 = P.X(j);
      const y1 = P.X(j + 1);
      const tone = shade(MC.floor, Math.round((hash2(i, j, seed) - 0.5) * 2 * FLOOR_JITTER));
      P.dev(x0, y0, x1 - x0, y1 - y0, tone);
      // 1타일 강판: 위 · 왼쪽 옅은 하이라이트, 아래 · 오른쪽 이음선
      P.dev(x0, y0, x1 - x0, d, MC.floorHi, 0.5);
      P.dev(x0, y0 + d, d, y1 - y0 - d, MC.floorHi, 0.3);
      P.dev(x0, y1 - d, x1 - x0, d, MC.floorSeam);
      P.dev(x1 - d, y0, d, y1 - y0, MC.floorSeam);
      if (hash2(i, j, seed + 7) < 0.08) tread.push({ i, j });
    }
  }
  // 줄무늬 강판 (드물게): 엇갈린 짧은 사선 돌기
  c.beginPath();
  for (const { i, j } of tread) {
    for (let a = 0; a < 4; a += 1) {
      for (let b = 0; b < 4; b += 1) {
        const cx = i + (a + 0.5) / 4;
        const cy = j + (b + 0.5) / 4;
        const s = 0.065;
        const flip = (a + b) % 2 === 0 ? 1 : -1;
        c.moveTo((cx - s) * P.k, (cy - s * flip) * P.k);
        c.lineTo((cx + s) * P.k, (cy + s * flip) * P.k);
      }
    }
  }
  c.lineWidth = Math.max(1, d * 1.5);
  c.lineCap = 'round';
  c.strokeStyle = rgba(MC.tread);
  c.stroke();
  // 4타일 큰 패널: 굵은 이음선 + 그 아래 · 오른쪽 가장자리에 빛 받는 선 (바닥 칸끼리 맞닿은 곳만)
  for (let x = 4; x < MAP_W; x += 4) {
    for (let j = 0; j < MAP_H; j += 1) {
      if (tileAt(x - 1, j) !== 'floor' || tileAt(x, j) !== 'floor') continue;
      const X = P.X(x);
      const y0 = P.X(j);
      const h = P.X(j + 1) - y0;
      P.dev(X - d, y0, 2 * d, h, MC.panelSeam);
      P.dev(X + d, y0, d, h, MC.floorHi, 0.55);
    }
  }
  for (let y = 4; y < MAP_H; y += 4) {
    for (let i = 0; i < MAP_W; i += 1) {
      if (tileAt(i, y - 1) !== 'floor' || tileAt(i, y) !== 'floor') continue;
      const Y = P.X(y);
      const x0 = P.X(i);
      const w = P.X(i + 1) - x0;
      P.dev(x0, Y - d, w, 2 * d, MC.panelSeam);
      P.dev(x0, Y + d, w, d, MC.floorHi, 0.55);
    }
  }
  // 큰 패널 모서리 고정판 (어두운 작은 사각형: 밝은 둥근 장식은 쓰지 않는다)
  for (let y = 4; y < MAP_H; y += 4) {
    for (let x = 4; x < MAP_W; x += 4) {
      if (
        tileAt(x - 1, y - 1) !== 'floor' ||
        tileAt(x, y - 1) !== 'floor' ||
        tileAt(x - 1, y) !== 'floor' ||
        tileAt(x, y) !== 'floor'
      )
        continue;
      const s = Math.max(2, Math.round(0.11 * P.k));
      P.dev(P.X(x) - s, P.X(y) - s, 2 * s, 2 * s, MC.panelSeam);
      P.dev(P.X(x) - s + d, P.X(y) - s + d, 2 * s - 2 * d, 2 * s - 2 * d, MC.decalMid);
      P.dev(P.X(x) - d, P.X(y) - d, 2 * d, 2 * d, MC.panelSeam);
    }
  }
}

let noiseCanvas: HTMLCanvasElement | null = null;

/** 노이즈 판 (배율과 무관해서 한 번만 만든다) */
function noiseMap(seed: number): HTMLCanvasElement {
  if (noiseCanvas) return noiseCanvas;
  const N = 8;
  const w = MAP_W * N;
  const h = MAP_H * N;
  const { canvas, ctx } = newCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const ty = y / N;
    for (let x = 0; x < w; x += 1) {
      const tx = x / N;
      const grime = fbm(tx / 2.2, ty / 2.2, seed, 2);
      const horiz = (Math.floor(tx / 4) + Math.floor(ty / 4)) % 2 === 0;
      const hair = horiz ? valueNoise(tx * 0.35, ty * 9, seed + 5) : valueNoise(tx * 9, ty * 0.35, seed + 5);
      const v = Math.round(128 + (grime - 0.5) * 20 + (hair - 0.5) * 9);
      const o = (y * w + x) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  noiseCanvas = canvas;
  return canvas;
}

/**
 * 시드 고정 노이즈 (±3% 정도) + 큰 패널마다 방향이 바뀌는 헤어라인(브러시드 금속). 낮은 해상도 회색 판을
 * 'overlay'로 덮는다 (어두운 바탕에서 밝기 × (1 ± 2δ)): 어두운 바닥에서는 거의 사라진다
 */
function paintNoise(P: Painter, seed: number): void {
  const c = P.c;
  c.save();
  c.globalCompositeOperation = 'overlay';
  c.imageSmoothingEnabled = true;
  drawStretched(c, noiseMap(seed), P.W, P.H, P.cull);
  c.restore();
}

/**
 * 작은 그림(잡음 · 발광 지도)을 맵 전체 W × H에 늘려 그린다. 자르는 상자가 있으면 거기 드는 원본 조각만 (띠 · 조각 굽기마다
 * 큰 그림 전체를 늘려 그리지 않게). 둘레 2 원본 px를 더 읽어 선형 보간의 가장자리 처리가 자르기 밖에서 일어나게 한다:
 * 한 번에 그린 것과 같은 화소
 */
function drawStretched(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  W: number,
  H: number,
  cull: PxBox | null,
): void {
  if (!cull) {
    ctx.drawImage(img, 0, 0, W, H);
    return;
  }
  const fx = img.width / W;
  const fy = img.height / H;
  const sx0 = Math.max(0, Math.floor(cull.x0 * fx) - 2);
  const sy0 = Math.max(0, Math.floor(cull.y0 * fy) - 2);
  const sx1 = Math.min(img.width, Math.ceil(cull.x1 * fx) + 2);
  const sy1 = Math.min(img.height, Math.ceil(cull.y1 * fy) + 2);
  if (sx1 > sx0 && sy1 > sy0)
    ctx.drawImage(
      img,
      sx0,
      sy0,
      sx1 - sx0,
      sy1 - sy0,
      sx0 / fx,
      sy0 / fy,
      (sx1 - sx0) / fx,
      (sy1 - sy0) / fy,
    );
}

function paintDecal(P: Painter, dc: Decal): void {
  const { d } = P;
  const cx = (dc.x0 + dc.x1) / 2;
  const cy = (dc.y0 + dc.y1) / 2;
  switch (dc.kind) {
    case 'drain': {
      const s = 0.3;
      P.rect(cx - s, cy - s, cx + s, cy + s, MC.decalMid);
      const x0 = P.X(cx - s) + d;
      const x1 = P.X(cx + s) - d;
      P.dev(x0, P.X(cy - s) + d, x1 - x0, P.X(cy + s) - P.X(cy - s) - 2 * d, MC.decalDark);
      for (let n = 0; n < 4; n += 1) {
        const yy = cy - s + 0.1 + n * 0.13;
        P.rect(cx - s + 0.08, yy, cx + s - 0.08, yy + 0.05, MC.decalMid, 0.8);
      }
      break;
    }
    case 'vent': {
      P.rect(dc.x0 + 0.14, dc.y0 + 0.16, dc.x1 - 0.14, dc.y1 - 0.16, MC.decalDark, 0.9);
      for (let n = 0; n < 5; n += 1) {
        const yy = dc.y0 + 0.22 + n * 0.12;
        P.rect(dc.x0 + 0.2, yy, dc.x1 - 0.2, yy + 0.05, MC.floorSeam);
        P.rect(dc.x0 + 0.2, yy + 0.05, dc.x1 - 0.2, yy + 0.07, MC.decalMid, 0.7);
      }
      break;
    }
    case 'hatch': {
      const m = 0.12;
      const x0 = P.X(dc.x0 + m);
      const y0 = P.X(dc.y0 + m);
      const x1 = P.X(dc.x1 - m);
      const y1 = P.X(dc.y1 - m);
      P.dev(x0, y0, x1 - x0, d, MC.panelSeam);
      P.dev(x0, y0, d, y1 - y0, MC.panelSeam);
      P.dev(x0, y1 - d, x1 - x0, d, MC.floorHi);
      P.dev(x1 - d, y0, d, y1 - y0, MC.floorHi);
      const s = Math.max(1, Math.round(0.05 * P.k));
      for (const [px, py] of [
        [dc.x0 + 0.22, dc.y0 + 0.22],
        [dc.x1 - 0.22, dc.y0 + 0.22],
        [dc.x0 + 0.22, dc.y1 - 0.22],
        [dc.x1 - 0.22, dc.y1 - 0.22],
      ] as const)
        P.dev(P.X(px) - s, P.X(py) - s, 2 * s, 2 * s, MC.decalDark);
      P.rect(cx - 0.16, cy - 0.035, cx + 0.16, cy + 0.035, MC.decalDark);
      break;
    }
    case 'cable': {
      const vertical = dc.y1 - dc.y0 > dc.x1 - dc.x0;
      const w = Math.max(2, Math.round(0.07 * P.k));
      for (const off of [-0.07, 0.07]) {
        if (vertical) {
          const X = P.X(cx + off);
          P.dev(X - w / 2, P.X(dc.y0 + 0.2), w, P.X(dc.y1 - 0.2) - P.X(dc.y0 + 0.2), MC.cable);
          P.dev(X - w / 2 + 1, P.X(dc.y0 + 0.2), 1, P.X(dc.y1 - 0.2) - P.X(dc.y0 + 0.2), MC.cableSheen);
        } else {
          const Y = P.X(cy + off);
          P.dev(P.X(dc.x0 + 0.2), Y - w / 2, P.X(dc.x1 - 0.2) - P.X(dc.x0 + 0.2), w, MC.cable);
          P.dev(P.X(dc.x0 + 0.2), Y - w / 2 + 1, P.X(dc.x1 - 0.2) - P.X(dc.x0 + 0.2), 1, MC.cableSheen);
        }
      }
      const len = vertical ? dc.y1 - dc.y0 : dc.x1 - dc.x0;
      for (let t = 0.9; t < len - 0.5; t += 1.4) {
        if (vertical) P.rect(cx - 0.17, dc.y0 + t, cx + 0.17, dc.y0 + t + 0.1, MC.decalMid);
        else P.rect(dc.x0 + t, cy - 0.17, dc.x0 + t + 0.1, cy + 0.17, MC.decalMid);
      }
      break;
    }
  }
}

function paintShadows(P: Painter): void {
  const c = P.c;
  const a = MAP_ART.shadowAlpha;
  for (const s of geomOf().shadows) {
    const x0 = P.X(s.x0);
    const y0 = P.X(s.y0);
    const x1 = P.X(s.x1);
    const y1 = P.X(s.y1);
    if (!P.hits(x0, y0, x1, y1)) continue;
    let g: CanvasGradient;
    if (s.side === 'n') g = c.createLinearGradient(0, y0, 0, y1);
    else if (s.side === 's') g = c.createLinearGradient(0, y1, 0, y0);
    else if (s.side === 'w') g = c.createLinearGradient(x0, 0, x1, 0);
    else g = c.createLinearGradient(x1, 0, x0, 0);
    g.addColorStop(0, rgba(0x000205, a));
    g.addColorStop(0.35, rgba(0x000205, a * 0.45));
    g.addColorStop(1, rgba(0x000205, 0));
    c.fillStyle = g;
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

// ───────────────────────── 거점 · 감옥 · 탈출구 바닥 ─────────────────────────

function diamond(cx: number, cy: number, r: number): Vec2[] {
  return [
    { x: cx, y: cy - r },
    { x: cx + r, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r, y: cy },
  ];
}

/** 거점 정적 부분 (판정 반경과 무관한 장식만: 반경 원 · 눈금 · 패드는 fogPaint.paintPoints가 판정값으로 그린다) */
function paintPadsStatic(P: Painter): void {
  const { d } = P;
  for (const p of Object.values(CAPTURE_POINTS)) {
    const { x: cx, y: cy } = p;
    P.stroke(diamond(cx, cy, 1.1), true, Math.max(1, d * 2), MC.padDecor);
    P.stroke(diamond(cx, cy, 0.86), true, d, MC.padDecor, 0.8);
    // 대각 안내선
    for (let q = 0; q < 4; q += 1) {
      const a = Math.PI / 4 + (q * Math.PI) / 2;
      P.line(
        cx + Math.cos(a) * 0.95,
        cy + Math.sin(a) * 0.95,
        cx + Math.cos(a) * 1.45,
        cy + Math.sin(a) * 1.45,
        Math.max(1, d * 2),
        MC.padDecor,
      );
    }
    // 글자 배지 자리 (배지 마름모 아래 어두운 바닥 판: 글자가 늘 어두운 바탕 위에 오게)
    P.poly(diamond(cx, cy + BADGE.pointDy, BADGE.pointHalf - 0.03), MC.decalDark);
    // 중앙 해독 단말: 바닥에 묻힌 납작한 6각 판 + 화면 (그림자 · 높이 없음: 막힌 물체로 보이지 않게)
    const hex: Vec2[] = [];
    for (let q = 0; q < 6; q += 1) {
      const a = (q * Math.PI) / 3;
      hex.push({ x: cx + Math.cos(a) * 0.4, y: cy + Math.sin(a) * 0.4 });
    }
    P.poly(hex, MC.terminal);
    P.stroke(hex, true, d, MC.terminalEdge);
    P.rect(cx - 0.2, cy - 0.11, cx + 0.2, cy + 0.07, MC.screen, 0.85);
    P.rect(cx - 0.15, cy - 0.06, cx + 0.06, cy - 0.03, MC.neon, 0.6);
    P.rect(cx - 0.15, cy, cx + 0.12, cy + 0.03, MC.neon, 0.4);
  }
}

function paintPrison(P: Painter): void {
  const R = PRISON_RECT;
  const { d } = P;
  // 바닥 격자 (감옥 전체 4×4)
  P.rect(R.x0, R.y0, R.x1, R.y1, MC.grate);
  for (let t = R.x0 + 0.25; t < R.x1; t += 0.25)
    P.dev(P.X(t), P.X(R.y0), d, P.X(R.y1) - P.X(R.y0), MC.grateLine);
  for (let t = R.y0 + 0.25; t < R.y1; t += 0.25)
    P.dev(P.X(R.x0), P.X(t), P.X(R.x1) - P.X(R.x0), d, MC.grateLine);
  const railW = Math.max(2, Math.round(0.07 * P.k));
  const barW = Math.max(2, Math.round(0.09 * P.k));
  const core = Math.max(1, Math.round(barW / 3));
  const bars: [Vec2, Vec2][] = [];
  const posts: TileRect[] = [];
  for (let j = R.y0; j < R.y1; j += 1) {
    for (let i = R.x0; i < R.x1; i += 1) {
      if (tileAt(i, j) !== 'bars') continue;
      const horiz = j === R.y0 || j === R.y1 - 1;
      const vert = i === R.x0 || i === R.x1 - 1;
      // 철창 칸 받침 (칸 전체 = 판정)
      P.rect(i + 0.04, j + 0.04, i + 0.96, j + 0.96, MC.prisonDoor, 0.92);
      if (horiz && vert) {
        posts.push({ x0: i + 0.16, y0: j + 0.16, x1: i + 0.84, y1: j + 0.84 });
        continue;
      }
      for (let n = 0; n < 3; n += 1) {
        const t = (n + 0.5) / 3;
        if (horiz)
          bars.push([
            { x: i + t, y: j + 0.27 },
            { x: i + t, y: j + 0.73 },
          ]);
        else
          bars.push([
            { x: i + 0.27, y: j + t },
            { x: i + 0.73, y: j + t },
          ]);
      }
    }
  }
  // 레일 두 줄 (철창 띠 안쪽 · 바깥쪽 가장자리, 문 칸에서 끊김)
  const ring = prisonRing();
  const pcx = (R.x0 + R.x1) / 2;
  const pcy = (R.y0 + R.y1) / 2;
  for (const off of [-0.33, 0.33]) {
    const pts = ring.map((p, n) => {
      const end = n === 0 || n === ring.length - 1;
      return { x: end ? p.x : p.x + (p.x < pcx ? -off : off), y: p.y + (p.y < pcy ? -off : off) };
    });
    P.stroke(pts, false, railW, MC.barRail);
  }
  // 둥근 끝 창살 (빨강 발광하는 금속) + 밝은 심
  for (const [a, b] of bars) P.stroke([a, b], false, barW, MC.bar, 1, 'round');
  for (const [a, b] of bars) P.stroke([a, b], false, core, MC.barCore, 0.85, 'round');
  // 모서리 기둥
  for (const q of posts) {
    P.r(q, MC.barRail);
    P.rect(q.x0 + 0.08, q.y0 + 0.08, q.x1 - 0.08, q.y1 - 0.08, MC.bar);
    P.rect(q.x0 + 0.16, q.y0 + 0.16, q.x1 - 0.16, q.y1 - 0.16, MC.prisonDoor);
    P.rect(q.x0 + 0.23, q.y0 + 0.23, q.x1 - 0.23, q.y1 - 0.23, MC.barCore, 0.45);
  }
  // 남쪽 문 칸: 미닫이 격자문 + 자물쇠 장치 (정적. 자물쇠 표지는 배지가 위에 그린다)
  const dx0 = ring[0]?.x ?? 0;
  const dx1 = ring[ring.length - 1]?.x ?? 0;
  const dy = R.y1 - 1;
  if (dx1 > dx0) {
    P.rect(dx0, dy + 0.3, dx1, dy + 0.7, MC.prisonDoor);
    for (const yy of [dy + 0.36, dy + 0.5, dy + 0.64]) P.line(dx0, yy, dx1, yy, Math.max(1, d), MC.barRail);
    for (let xx = dx0 + 0.25; xx < dx1; xx += 0.25)
      P.line(xx, dy + 0.3, xx, dy + 0.7, Math.max(1, d), MC.barRail, 0.8);
    for (const xx of [dx0, dx1]) P.rect(xx - 0.08, dy + 0.14, xx + 0.08, dy + 0.86, MC.barRail);
    const cx = (dx0 + dx1) / 2;
    P.rect(cx - 0.24, dy + 0.24, cx + 0.24, dy + 0.76, MC.doorFrame);
    P.rect(cx - 0.18, dy + 0.3, cx + 0.18, dy + 0.7, MC.prisonDoor);
  }
}

/** 감옥 철창 띠가 지나는 고리 (칸 중심선, 문 칸에서 끊김). 발광 번짐이 같은 경로를 쓴다 */
export function prisonRing(): Vec2[] {
  const R = PRISON_RECT;
  let dx0 = Infinity;
  let dx1 = -Infinity;
  for (let i = R.x0; i < R.x1; i += 1)
    if (tileAt(i, R.y1 - 1) === 'prisonDoor') {
      dx0 = Math.min(dx0, i);
      dx1 = Math.max(dx1, i + 1);
    }
  const y = R.y1 - 0.5;
  return [
    { x: dx0, y },
    { x: R.x0 + 0.5, y },
    { x: R.x0 + 0.5, y: R.y0 + 0.5 },
    { x: R.x1 - 0.5, y: R.y0 + 0.5 },
    { x: R.x1 - 0.5, y },
    { x: dx1, y },
  ];
}

/** 탈출구: 2×1 방폭문 (닫힌 모습. 상태는 fogPaint.paintExits가 위에 그린다) + 문 앞 저채도 사선띠 + 꺼진 셰브론 */
function paintExitsStatic(P: Painter): void {
  const { d } = P;
  for (const id of Object.keys(EXITS) as ExitId[]) {
    const D = EXITS[id].door;
    const north = D.y0 === 0;
    const cx = (D.x0 + D.x1) / 2;
    // 문 앞 사선띠 (바닥, 저채도)
    const by0 = north ? D.y1 : D.y0 - 0.24;
    const by1 = north ? D.y1 + 0.24 : D.y0;
    hazard(P, D.x0 - 0.5, by0, D.x1 + 0.5, by1, 0.32);
    // 꺼진 셰브론
    for (const ch of exitChevrons(id)) P.poly(ch, MC.chevronOff);
    // 문: 벽과 같은 문법 (윗면 = 문짝, 앞면 = 문턱, 테두리)
    const f = doorFaces(id);
    const T = f.top;
    P.r(T, MC.doorFrame);
    const lx0 = T.x0 + 0.1;
    const lx1 = T.x1 - 0.1;
    const ly0 = T.y0 + (north ? 0.1 : 0.16);
    const ly1 = T.y1 - 0.1;
    P.rect(lx0 - 0.03, ly0 - 0.03, lx1 + 0.03, ly1 + 0.03, MC.doorRecess);
    for (const [x0, x1] of [
      [lx0, cx - 0.02],
      [cx + 0.02, lx1],
    ] as const) {
      P.rect(x0, ly0, x1, ly1, MC.doorLeaf);
      for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.22)
        P.dev(P.X(x), P.X(ly0 + 0.06), d, P.X(ly1 - 0.06) - P.X(ly0 + 0.06), MC.doorLeafHi);
    }
    // 가운데 맞물림 사선 (저채도 회색)
    hazard(P, cx - 0.26, ly0, cx + 0.26, ly1, 0.2);
    P.rect(cx - 0.02, ly0, cx + 0.02, ly1, MC.doorRecess);
    if (f.front) {
      P.r(f.front, MC.wallFront);
      P.dev(P.X(f.front.x0), P.X(f.front.y0), P.X(f.front.x1) - P.X(f.front.x0), d, 0x000000, 0.5);
      P.rect(f.front.x0, f.front.y1 - 0.05, f.front.x1, f.front.y1, 0x05080c);
    }
    for (const r of f.rims) P.r(r, MC.rim);
    // 양옆 문틀 (이웃 외벽 칸의 윗면 안): 회색 사선 + 상태등 홈
    for (const j of doorJambs(id)) {
      const jy0 = j.y0 + (north ? 0.08 : MAP_ART.rim + 0.04);
      const jy1 = j.y1 - (north ? MAP_ART.rim + 0.04 : 0.08);
      P.rect(j.x0 + 0.08, jy0, j.x1 - 0.08, jy1, MC.doorFrame);
      hazard(P, j.x0 + 0.12, jy0 + 0.04, j.x1 - 0.12, jy1 - 0.04, 0.24);
    }
    for (const l of doorLamps(id)) {
      P.rect(l.x0 - 0.03, l.y0 - 0.03, l.x1 + 0.03, l.y1 + 0.03, MC.doorRecess);
      P.r(l, MC.chevronOff);
    }
  }
}

/** 저채도 사선 줄무늬 띠 (경고색이 아님: 주황은 경고 전용) */
function hazard(P: Painter, x0: number, y0: number, x1: number, y1: number, step: number): void {
  const c = P.c;
  P.rect(x0, y0, x1, y1, MC.hazardB);
  c.save();
  c.beginPath();
  c.rect(P.X(x0), P.X(y0), P.X(x1) - P.X(x0), P.X(y1) - P.X(y0));
  c.clip();
  const h = y1 - y0;
  for (let x = x0 - h - step; x < x1 + step; x += step)
    P.poly(
      [
        { x, y: y1 },
        { x: x + step / 2, y: y1 },
        { x: x + step / 2 + h, y: y0 },
        { x: x + h, y: y0 },
      ],
      MC.hazardA,
    );
  c.restore();
}

// ───────────────────────── 벽 · 기둥 ─────────────────────────

function paintWalls(P: Painter): void {
  const { c, d } = P;
  const frontGrad = new Map<number, CanvasGradient>();
  const gradFor = (y0: number, y1: number): CanvasGradient => {
    let g = frontGrad.get(y0);
    if (!g) {
      g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, rgba(MC.wallFront));
      g.addColorStop(1, rgba(MC.wallFrontLow));
      frontGrad.set(y0, g);
    }
    return g;
  };
  const bev = MAP_ART.wallBevel;
  const cells = geomOf().walls.filter(({ i, j }) => P.tileHits(i, j, i + 1, j + 1));
  for (const { i, j } of cells) {
    const f = wallFaces(i, j);
    P.r(f.top, MC.wallTop);
    // 윗면 안쪽 덧선: 빛을 받는 북 · 서쪽은 밝게, 동 · 남쪽은 어둡게 (윗면이 솟은 판으로 읽히게)
    const open = new Set(f.rims.map((r) => r.side));
    const xa = open.has('w') ? i + bev : i;
    const xb = open.has('e') ? i + 1 - bev : i + 1;
    const ya = open.has('n') ? j + bev : j;
    const yb = open.has('s') ? f.top.y1 - bev : f.top.y1;
    if (open.has('n')) P.dev(P.X(xa), P.X(j + bev), P.X(xb) - P.X(xa), d, MC.wallTopBevel);
    if (open.has('w')) P.dev(P.X(i + bev), P.X(ya), d, P.X(yb) - P.X(ya), MC.wallTopBevel);
    if (open.has('s')) P.dev(P.X(xa), P.X(f.top.y1 - bev), P.X(xb) - P.X(xa), d, MC.wallTopShade);
    if (open.has('e')) P.dev(P.X(i + 1 - bev), P.X(ya), d, P.X(yb) - P.X(ya), MC.wallTopShade);
    if (f.front) {
      const y0 = P.X(f.front.y0);
      const y1 = P.X(f.front.y1);
      const x0 = P.X(i);
      const x1 = P.X(i + 1);
      if (P.hits(x0, y0, x1, y1)) {
        c.fillStyle = gradFor(y0, y1);
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      // 앞면: 세로 골 · 2칸마다 판 이음 · 입술 아래 그늘 · 밑둥
      for (const t of [0.25, 0.75]) P.dev(P.X(i + t), y0 + d, d, y1 - y0 - d, MC.wallRib);
      if (i % 2 === 0) P.dev(x0, y0, 2 * d, y1 - y0, 0x05080c, 0.8);
      P.dev(x0, y0, x1 - x0, d, 0x000000, 0.5);
      const base = Math.max(d, Math.round(0.05 * P.k));
      P.dev(x0, y1 - base, x1 - x0, base, 0x04070a);
      // 앞면 옆 끝이 바닥으로 드러나면 세로 모서리
      if (openAt(i - 1, j)) P.dev(x0, y0, d, y1 - y0, MC.wallTopBevel, 0.8);
      if (openAt(i + 1, j)) P.dev(x1 - d, y0, d, y1 - y0, MC.wallTopBevel, 0.6);
    }
  }
  // 윗면 빗금: 덧선 안쪽만 잘라 45° 가는 선 (바닥 강판과 다른 재질 = 막힌 곳)
  c.save();
  c.beginPath();
  for (const { i, j } of cells) {
    const f = wallFaces(i, j);
    const open = new Set(f.rims.map((r) => r.side));
    const x0 = P.X(open.has('w') ? i + bev : i);
    const x1 = P.X(open.has('e') ? i + 1 - bev : i + 1);
    const y0 = P.X(open.has('n') ? j + bev : j);
    const y1 = P.X(open.has('s') ? f.top.y1 - bev : f.top.y1);
    if (open.has('w')) c.rect(x0 + d, y0, x1 - x0 - d, y1 - y0);
    else c.rect(x0, y0 + (open.has('n') ? d : 0), x1 - x0, y1 - y0 - (open.has('n') ? d : 0));
  }
  c.clip();
  c.beginPath();
  const step = MAP_ART.wallHatch;
  for (let t = -MAP_H; t < MAP_W; t += step) {
    c.moveTo(t * P.k, MAP_H * P.k);
    c.lineTo((t + MAP_H) * P.k, 0);
  }
  c.lineWidth = d;
  c.strokeStyle = rgba(MC.wallHatch);
  c.stroke();
  c.restore();
  // 테두리는 모든 면 위에 (모서리에서 겹쳐도 같은 색). 빛이 왼쪽 위에서 오는 것처럼 동쪽은 조금 어둡게
  for (const { i, j } of cells)
    for (const r of wallFaces(i, j).rims) {
      P.r(r, r.side === 'e' ? MC.rimDim : MC.rim);
      // 빛을 받는 북 · 서쪽 테두리의 바깥 끝 1px 반사광
      if (r.side === 'n') P.dev(P.X(r.x0), P.X(r.y0), P.X(r.x1) - P.X(r.x0), d, MC.rimSpec);
      else if (r.side === 'w') P.dev(P.X(r.x0), P.X(r.y0), d, P.X(r.y1) - P.X(r.y0), MC.rimSpec);
    }
}

function paintPillars(P: Painter): void {
  const { c, d } = P;
  for (const b of geomOf().pillars) {
    if (!P.tileHits(b.x0, b.y0, b.x1, b.y1)) continue;
    const s = pillarShape(b);
    // 받침 = 판정 칸 전체
    P.r(s.base, MC.pillarBase);
    const x0 = P.X(b.x0);
    const y0 = P.X(b.y0);
    const x1 = P.X(b.x1);
    const y1 = P.X(b.y1);
    P.dev(x0, y0, x1 - x0, d, MC.pillarBaseEdge);
    P.dev(x0, y0, d, y1 - y0, MC.pillarBaseEdge);
    P.dev(x0, y1 - d, x1 - x0, d, MC.pillarBaseEdge, 0.6);
    P.dev(x1 - d, y0, d, y1 - y0, MC.pillarBaseEdge, 0.6);
    // 받침 모서리 고정 (깎인 자리에 보이는 어두운 볼트판)
    const bs = Math.max(2, Math.round(0.07 * P.k));
    for (const [px, py] of [
      [b.x0 + 0.17, b.y0 + 0.17],
      [b.x1 - 0.17, b.y0 + 0.17],
      [b.x0 + 0.17, b.y1 - 0.17],
      [b.x1 - 0.17, b.y1 - 0.17],
    ] as const)
      P.dev(P.X(px) - bs, P.X(py) - bs, 2 * bs, 2 * bs, MC.pillarBaseEdge);
    // 앞면 (세로 음영 + 골)
    const fy0 = Math.min(...s.front.map((p) => p.y));
    const fy1 = Math.max(...s.front.map((p) => p.y));
    const g = c.createLinearGradient(0, fy0 * P.k, 0, fy1 * P.k);
    g.addColorStop(0, rgba(MC.pillarFront));
    g.addColorStop(1, rgba(MC.pillarFrontLow));
    P.poly(s.front, g);
    const fxA = Math.min(...s.front.map((p) => p.x));
    const fxB = Math.max(...s.front.map((p) => p.x));
    const n = Math.max(4, Math.round((fxB - fxA) / 0.28));
    for (let q = 1; q < n; q += 1) {
      const x = fxA + ((fxB - fxA) * q) / n;
      P.dev(P.X(x), P.X(fy0 + 0.1), d, P.X(fy1 - 0.04) - P.X(fy0 + 0.1), MC.wallRib);
    }
    // 윗면: 왼쪽 위가 밝은 판 + 덧선 + 가운데 뚜껑 + 윗테두리
    const tg = c.createLinearGradient(b.x0 * P.k, b.y0 * P.k, b.x1 * P.k, b.y1 * P.k);
    tg.addColorStop(0, rgba(shade(MC.pillarTop, 6)));
    tg.addColorStop(1, rgba(shade(MC.pillarTop, -6)));
    P.poly(s.top, tg);
    P.stroke(s.inner, true, d, MC.pillarTopInner);
    P.poly(s.cap, MC.pillarCap);
    P.stroke(s.cap, true, d, MC.pillarBase, 0.8);
    for (const q of s.capBolts) P.dev(P.X(q.x) - d, P.X(q.y) - d, 2 * d, 2 * d, MC.pillarBase);
    s.rim.forEach((q, n2) => P.poly(q, s.rimLit[n2] ? MC.rim : MC.rimDim));
  }
}

function paintNeonCore(P: Painter, runs: readonly NeonRun[]): void {
  const w = Math.max(2, Math.round(MAP_ART.neonWidth * P.k));
  const core = Math.max(1, Math.round(w / 3));
  for (const n of runs) {
    P.stroke(
      [
        { x: n.x0, y: n.y0 },
        { x: n.x1, y: n.y1 },
      ],
      false,
      w,
      MC.neon,
      1,
      'round',
    );
  }
  for (const n of runs) P.line(n.x0, n.y0, n.x1, n.y1, core, MC.neonCore, 0.9);
}

/** 네온 전체: 벽 줄 + 기둥 앞면 표시등 */
export function allNeon(): NeonRun[] {
  return [...neonRuns(), ...pillarBlocks().map(pillarNeon)];
}

// ───────────────────────── 굽기 · 캐시 ─────────────────────────

/** 발광 캔버스 배율 (출력 px / 월드 px): 논리 0.5배. 번짐은 부드러워서 낮은 해상도면 충분하다 */
export const GLOW_SCALE = MAP_SCALE * 0.5;

/**
 * 지금 확대 수준의 발광 캔버스 배율: 따라가는 카메라는 맵을 크게 그리므로 2배까지 따라 키운다(번짐이 계단지지 않게).
 * 발광은 조각 굽기(art/mapChunks.ts)가 정적 맵에 구워 넣어 GPU에 따로 올리지 않는다
 */
export function glowScale(): number {
  return GLOW_SCALE * Math.min(2, Math.max(1, WORLD_SCALE / MAP_SCALE));
}

/** 굽는 시간을 그래픽 상태에 기록한다 (디버그 · 측정) */
function record(kind: 'static' | 'glow', scale: number, ms: number): void {
  const r = Math.round(ms * 10) / 10;
  // 측정 기록: 합성용(배율 ≥ 0.6) · 미니맵용(작은 배율) · 발광을 나눠 둔다
  if (kind === 'glow') gfxState.features.glowBakeMs = r;
  else if (scale >= 0.6) {
    gfxState.features.mapBakeMs = r;
    gfxState.features.mapBakeScale = Math.round(scale * 1000) / 1000;
  } else gfxState.features.miniBakeMs = r;
}

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('맵 캔버스를 만들 수 없습니다');
  return { canvas, ctx };
}

/** 발광 번짐 (투명 바탕, 더하기로 겹침). 네온 · 철창 창살 · 거점 단말 화면 */
export function bakeGlow(scale = GLOW_SCALE): HTMLCanvasElement {
  const t0 = performance.now();
  const size = staticMapSize(scale);
  const { canvas, ctx } = newCanvas(size.w, size.h);
  const P = new Painter(ctx, TILE_PX * scale);
  ctx.globalCompositeOperation = 'lighter';
  const halo = (pts: Vec2[], color: number, widths: readonly number[], alphas: readonly number[]): void => {
    widths.forEach((w, n) => P.stroke(pts, false, Math.max(1, w * P.k), color, alphas[n] ?? 0, 'round'));
  };
  for (const n of allNeon())
    halo(
      [
        { x: n.x0, y: n.y0 },
        { x: n.x1, y: n.y1 },
      ],
      MC.neon,
      [0.62, 0.36, 0.18],
      [0.06, 0.12, 0.26],
    );
  // 감옥 철창: 고리 경로 하나로 (칸마다 겹친 둥근 끝이 얼룩지지 않게)
  halo(prisonRing(), MC.bar, [0.95, 0.62], [0.07, 0.11]);
  for (const p of Object.values(CAPTURE_POINTS))
    halo(
      [
        { x: p.x - 0.12, y: p.y - 0.02 },
        { x: p.x + 0.12, y: p.y - 0.02 },
      ],
      MC.neon,
      [0.6, 0.34],
      [0.08, 0.14],
    );
  record('glow', scale, performance.now() - t0);
  return canvas;
}

/**
 * 정적 맵을 컨텍스트에 그린다 (맵 전체 그림 좌표, k = px / 타일). withGlow면 발광 번짐을 구워 넣는다.
 * cull이 있으면 그 사각형과 겹치는 것만 칠한다 — 부르는 쪽이 정수 이동 + 자르기를 건 조각 굽기(art/mapChunks.ts)
 */
export function paintStaticMap(
  ctx: CanvasRenderingContext2D,
  k: number,
  withGlow: boolean,
  cull: PxBox | null,
): void {
  const P = new Painter(ctx, k, cull);
  const seed = MAP_ART.seed;
  paintFloor(P, seed);
  paintNoise(P, seed);
  for (const dc of decalsOf(seed)) if (P.tileHits(dc.x0, dc.y0, dc.x1, dc.y1)) paintDecal(P, dc);
  paintPadsStatic(P);
  paintShadows(P);
  paintPrison(P);
  paintWalls(P);
  paintPillars(P);
  paintExitsStatic(P);
  paintNeonCore(P, geomOf().neon);
  if (withGlow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    drawStretched(ctx, getGlowMap(), P.W, P.H, cull);
    ctx.restore();
  }
}

/** 정적 맵을 굽는다. withGlow면 발광 번짐을 구워 넣는다 (Canvas 합성 · 미니맵) */
export function bakeStaticMap(scale: number, withGlow: boolean): HTMLCanvasElement {
  const t0 = performance.now();
  const size = staticMapSize(scale);
  const { canvas, ctx } = newCanvas(size.w, size.h);
  paintStaticMap(ctx, TILE_PX * scale, withGlow, null);
  record('static', scale, performance.now() - t0);
  return canvas;
}

/**
 * 굽은 캔버스 캐시 (배율 · 발광 포함 여부). 안개 레이어(또는 로비 미리 굽기)가 keepStaticMaps로 지금 쓰는 것만 남긴다:
 * GPU 합성 = 메인 + 미니맵 두 장 + 발광, Canvas 합성 = 메인 한 장(미니맵은 합성 캔버스를 줄여 쓴다). 창 크기 · 품질이
 * 바뀐 뒤 옛 배율의 큰 캔버스(배율 2에서 약 22MB)를 붙잡지 않는다. keepStaticMaps 전에도 두 장을 넘기지 않는다
 */
const cache = new Map<string, HTMLCanvasElement>();
/** 캐시 장 수: 따라가는 카메라는 판 배율 큰 맵 + 미니맵 작은 맵 두 장을 함께 쓴다 */
const CACHE_MAX = 2;
let glowCanvas: HTMLCanvasElement | null = null;
let glowCanvasScale = 0;

function cacheKey(scale: number, withGlow: boolean): string {
  return `${scale.toFixed(5)}|${withGlow ? 'g' : '-'}`;
}

/** 측정: 캐시가 붙잡은 캔버스 수 · 바이트 (gfx.features.mapCacheCount · mapCacheBytes) */
function recordCache(): void {
  let bytes = 0;
  for (const c of cache.values()) bytes += c.width * c.height * 4;
  if (glowCanvas) bytes += glowCanvas.width * glowCanvas.height * 4;
  gfxState.features.mapCacheBytes = bytes;
  gfxState.features.mapCacheCount = cache.size + (glowCanvas ? 1 : 0);
}

// ───────────── 나눠 굽기 (따라가는 카메라: 판 전에 큰 정적 맵을 여러 번에 걸쳐 굽는다) ─────────────

/** 나눠 굽는 띠 높이 (타일): 배율 3 PC(타일 89px)에서 띠 하나 약 4285 × 178px */
export const BAKE_BAND_TILES = 2;

/** 굽는 중인 정적 맵 (한 번에 하나: 판에 쓸 배율) */
interface StaticJob {
  key: string;
  scale: number;
  withGlow: boolean;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** 다음에 구울 띠 번호 */
  band: number;
  bands: number;
  /** 합계 · 가장 긴 띠 하나 (한 번에 막는 시간) */
  ms: number;
  maxBandMs: number;
  /** 띠를 굽기 전 공통 준비 중 마친 수 (도형 · 바닥 무늬 → 잡음 지도 → 발광 지도): 첫 띠에 몰리지 않게 한 걸음씩 */
  warm: number;
}

let job: StaticJob | null = null;

/** 띠 하나를 굽는다 (정수 px 띠에 자르기 + 겹치는 것만 칠하기: 한 번에 구운 것과 같은 화소) */
function bakeBand(j: StaticJob): void {
  const t0 = performance.now();
  const k = TILE_PX * j.scale;
  const H = j.canvas.height;
  const y0 = Math.min(H, Math.round(j.band * BAKE_BAND_TILES * k));
  const y1 = j.band === j.bands - 1 ? H : Math.min(H, Math.round((j.band + 1) * BAKE_BAND_TILES * k));
  const c = j.ctx;
  c.save();
  c.beginPath();
  c.rect(0, y0, j.canvas.width, y1 - y0);
  c.clip();
  paintStaticMap(c, k, j.withGlow, { x0: -4, y0: y0 - 4, x1: j.canvas.width + 4, y1: y1 + 4 });
  c.restore();
  j.band += 1;
  const ms = performance.now() - t0;
  j.ms += ms;
  j.maxBandMs = Math.max(j.maxBandMs, ms);
}

function finishJob(j: StaticJob): HTMLCanvasElement {
  job = null;
  cache.set(j.key, j.canvas);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === j.key) break;
    cache.delete(oldest);
  }
  // 굽는 시간 기록: 한 번에 막는 시간(가장 긴 띠)과 합계
  record('static', j.scale, j.maxBandMs);
  gfxState.features.mapBakeTotalMs = Math.round(j.ms * 10) / 10;
  recordCache();
  return j.canvas;
}

/**
 * 정적 맵을 budgetMs 안에서 띠 몇 개씩 굽는다 (로비 대기 · 첫 화면의 남는 시간에 여러 번 부른다 — 판 시작 전에 다 굽게).
 * 다 구웠거나 이미 캐시에 있으면 true. 다른 배율을 굽던 중이면 그 일은 버린다
 */
export function bakeStaticMapStep(scale: number, withGlow: boolean, budgetMs: number): boolean {
  const key = cacheKey(scale, withGlow);
  if (cache.has(key)) return true;
  if (!job || job.key !== key) {
    const size = staticMapSize(scale);
    const { canvas, ctx } = newCanvas(size.w, size.h);
    job = {
      key,
      scale,
      withGlow,
      canvas,
      ctx,
      band: 0,
      bands: Math.max(1, Math.ceil(MAP_H / BAKE_BAND_TILES)),
      ms: 0,
      maxBandMs: 0,
      warm: 0,
    };
  }
  const j = job;
  const t0 = performance.now();
  // 공통 준비: 하나씩 하고 예산을 넘으면 다음 걸음으로 (잡음 · 발광 지도는 각각 약 15~20ms)
  const warmups: (() => void)[] = [
    () => {
      geomOf();
      decalsOf(MAP_ART.seed);
    },
    () => noiseMap(MAP_ART.seed),
    () => {
      if (j.withGlow) getGlowMap();
    },
  ];
  while (j.warm < warmups.length) {
    warmups[j.warm]?.();
    j.warm += 1;
    const ms = performance.now() - t0;
    if (ms >= budgetMs) {
      j.ms += ms;
      return false;
    }
  }
  j.ms += performance.now() - t0;
  do {
    bakeBand(j);
  } while (j.band < j.bands && performance.now() - t0 < budgetMs);
  gfxState.features.mapBakeBands = j.band;
  if (j.band < j.bands) return false;
  finishJob(j);
  return true;
}

/**
 * 캐시에 넣지 않고 나눠 굽는 정적 맵 (지도 크게 보기: 그림이 화면에서 차지하는 해상도로 — 판 배율 · 미니맵 그림 캐시와 따로,
 * 열려 있는 동안만 쓰고 버린다). step(budgetMs)를 프레임마다 부르면 공통 준비(발광 지도가 없으면 그것부터) → 띠 몇 개씩 굽고,
 * 다 구웠으면 true. 띠마다 자르기 + 겹치는 것만 칠하기라 한 번에 구운 것과 같은 화소다(bakeBand)
 */
export class StaticMapBake {
  private readonly j: StaticJob;

  constructor(scale: number, withGlow: boolean) {
    const size = staticMapSize(scale);
    const { canvas, ctx } = newCanvas(size.w, size.h);
    this.j = {
      key: '',
      scale,
      withGlow,
      canvas,
      ctx,
      band: 0,
      bands: Math.max(1, Math.ceil(MAP_H / BAKE_BAND_TILES)),
      ms: 0,
      maxBandMs: 0,
      warm: 0,
    };
  }

  get canvas(): HTMLCanvasElement {
    return this.j.canvas;
  }

  get done(): boolean {
    return this.j.band >= this.j.bands;
  }

  /** budgetMs 안에서 굽는다 (적어도 한 걸음). 다 구웠으면 true */
  step(budgetMs: number): boolean {
    const j = this.j;
    if (this.done) return true;
    const t0 = performance.now();
    // 공통 준비 (판 전에 이미 했다 — Canvas 합성은 판 시작 때 발광 캔버스를 버리므로 그것만 다시)
    if (j.warm === 0) {
      geomOf();
      decalsOf(MAP_ART.seed);
      noiseMap(MAP_ART.seed);
      j.warm = 1;
      if (j.withGlow && performance.now() - t0 >= budgetMs) return false;
    }
    if (j.warm === 1) {
      if (j.withGlow) getGlowMap();
      j.warm = 2;
      if (performance.now() - t0 >= budgetMs) return false;
    }
    do bakeBand(j);
    while (j.band < j.bands && performance.now() - t0 < budgetMs);
    return this.done;
  }

  /** 캔버스를 놓는다 (0 × 0) */
  release(): void {
    this.j.canvas.width = 0;
    this.j.canvas.height = 0;
    this.j.band = this.j.bands;
  }
}

/** 다 구운 정적 맵 (없으면 null — 굽지 않는다) */
export function staticMapIfReady(scale: number, withGlow: boolean): HTMLCanvasElement | null {
  return cache.get(cacheKey(scale, withGlow)) ?? null;
}

/** 같은 배율이면 다시 굽지 않는다 (나눠 굽던 중이면 남은 띠를 마저 굽는다) */
export function getStaticMap(scale: number, withGlow: boolean): HTMLCanvasElement {
  const key = cacheKey(scale, withGlow);
  const hit = cache.get(key);
  if (hit) {
    // 최근 사용으로 옮긴다
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (job && job.key === key) {
    const j = job;
    while (j.band < j.bands) bakeBand(j);
    return finishJob(j);
  }
  const canvas = bakeStaticMap(scale, withGlow);
  cache.set(key, canvas);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  recordCache();
  return canvas;
}

/** 발광 번짐 (배율 고정이라 한 번만, 쓰지 않는 경로로 바뀌면 keepStaticMaps가 버린다) */
export function getGlowMap(): HTMLCanvasElement {
  const scale = glowScale();
  if (!glowCanvas || glowCanvasScale !== scale) {
    glowCanvas = bakeGlow(scale);
    glowCanvasScale = scale;
    recordCache();
  }
  return glowCanvas;
}

export interface StaticMapNeed {
  scale: number;
  withGlow: boolean;
}

/** 지금 쓰는 정적 맵만 캐시에 남기고 나머지(옛 배율 · 다른 경로)는 버린다. glow = 발광 캔버스를 따로 쓰는가 */
export function keepStaticMaps(needs: readonly StaticMapNeed[], glow: boolean): void {
  const keep = new Set(needs.map((n) => cacheKey(n.scale, n.withGlow)));
  for (const key of [...cache.keys()]) if (!keep.has(key)) cache.delete(key);
  if (job && !keep.has(job.key)) job = null;
  if (!glow) glowCanvas = null;
  recordCache();
}
