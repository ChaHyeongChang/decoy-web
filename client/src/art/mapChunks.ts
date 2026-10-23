// 정적 맵 조각 아틀라스 (따라가는 카메라). 확대한 맵 전체를 한 장으로 구우면 너무 크다(배율 4에서 6144 × 4096 = 100MB) →
// 보이는 창 근처 조각(CHUNK 타일 정사각)만 한 캔버스의 칸에 굽는다. 칸은 원환으로 배정한다: 조각 (cx, cy)는 늘
// 칸 (cx mod nx, cy mod ny)이라, 창 + 여유가 nx × ny 조각보다 작으면 서로 다른 조각이 같은 칸을 다투지 않는다.
// 조각 = 맵 전체 그림(k px / 타일)의 정수 px 사각형이고, 칸에는 그 둘레 GUTTER px까지 같이 굽는다: 확대해 그릴 때 선형
// 보간이 이웃 칸 화소를 끌어오지 않고 실제 이웃 그림을 읽는다(조각 사이 이음매 없음). 굽기는 정수 이동 + 자르기를 건
// 컨텍스트에 맵 전체 그림을 겹치는 것만 칠하므로(mapArt.paintStaticMap cull) 한 장으로 구운 것과 같은 화소다.
// 텍스처로 올리는 일은 쓰는 쪽(render/fogGpu.ts · baseLayer.ts)이 한다: 새로 구운 칸만 일부 올린다.
import { MAP_H, MAP_W, TILE_PX } from '@decoy/shared';
import { gfxState } from '../gfx/state';
import { paintStaticMap } from './mapArt';

/** 칸 둘레에 같이 굽는 이웃 그림 (px) */
export const CHUNK_GUTTER = 1;
/** 조각 한 변 목표 (px): 조각 타일 수 = 이 길이에 가까운 정수 (1~8) */
export const CHUNK_TARGET_PX = 192;

/** 맵 전체 그림 px 사각형 */
export interface ChunkBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 배율 k(px / 타일)의 조각 한 변 타일 수 */
export function chunkTilesFor(k: number): number {
  return Math.max(1, Math.min(8, Math.round(CHUNK_TARGET_PX / Math.max(1, k))));
}

/** 조각 (cx, cy)의 맵 전체 그림 px 사각형 (맵 끝에서 잘림) */
export function chunkBox(cx: number, cy: number, tiles: number, k: number): ChunkBox {
  const W = Math.max(1, Math.round(MAP_W * k));
  const H = Math.max(1, Math.round(MAP_H * k));
  return {
    x0: Math.min(W, Math.round(cx * tiles * k)),
    y0: Math.min(H, Math.round(cy * tiles * k)),
    x1: Math.min(W, Math.round((cx + 1) * tiles * k)),
    y1: Math.min(H, Math.round((cy + 1) * tiles * k)),
  };
}

/** 창(타일) + 여유를 덮는 조각 범위 (끝 포함, 맵 안) */
export function chunkRange(
  view: { x: number; y: number; w: number; h: number },
  margin: number,
  tiles: number,
): { cx0: number; cy0: number; cx1: number; cy1: number } {
  const cols = Math.ceil(MAP_W / tiles);
  const rows = Math.ceil(MAP_H / tiles);
  const c = (v: number, n: number): number => Math.max(0, Math.min(n - 1, v));
  return {
    cx0: c(Math.floor((view.x - margin) / tiles), cols),
    cy0: c(Math.floor((view.y - margin) / tiles), rows),
    cx1: c(Math.floor((view.x + view.w + margin - 1e-9) / tiles), cols),
    cy1: c(Math.floor((view.y + view.h + margin - 1e-9) / tiles), rows),
  };
}

/** 창 + 여유를 겹침 없이 담는 칸 수 (한 축): 창이 조각 경계에 걸쳐도 되게 하나 더, 맵 조각 수 이하 */
export function slotsFor(viewTiles: number, margin: number, tiles: number, mapTiles: number): number {
  return Math.min(Math.ceil(mapTiles / tiles), Math.ceil((viewTiles + margin * 2) / tiles) + 1);
}

export interface ChunkSlot {
  /** 칸 안 조각 그림의 자리 (아틀라스 px, 테 제외) */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 조각 아틀라스. ensure(cx, cy)가 그 조각이 칸에 있게 하고(없으면 굽는다), 새로 구운 칸은 onBaked로 알린다.
 * 배율 · 크기는 만들 때 정하고 바뀌면 새로 만든다(쓰는 쪽이 안개 레이어를 다시 만들 때)
 */
export class ChunkAtlas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly tiles: number;
  readonly cols: number;
  readonly rows: number;
  readonly nx: number;
  readonly ny: number;
  readonly slotW: number;
  readonly slotH: number;
  /** 칸마다 지금 든 조각 번호 (cy × cols + cx, 없으면 −1) */
  private readonly held: Int32Array;
  /** 누적 굽기 수 · 시간 (측정) */
  bakes = 0;
  bakeMs = 0;

  constructor(
    /** px / 타일 (맵 전체 그림) */
    readonly k: number,
    viewW: number,
    viewH: number,
    margin: number,
    readonly withGlow: boolean,
  ) {
    this.tiles = chunkTilesFor(k);
    this.cols = Math.ceil(MAP_W / this.tiles);
    this.rows = Math.ceil(MAP_H / this.tiles);
    this.nx = slotsFor(viewW, margin, this.tiles, MAP_W);
    this.ny = slotsFor(viewH, margin, this.tiles, MAP_H);
    const side = Math.ceil(this.tiles * k) + 1 + CHUNK_GUTTER * 2;
    this.slotW = side;
    this.slotH = side;
    this.held = new Int32Array(this.nx * this.ny).fill(-1);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.nx * this.slotW;
    this.canvas.height = this.ny * this.slotH;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('맵 조각 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    gfxState.features.chunkAtlasBytes = this.canvas.width * this.canvas.height * 4;
    gfxState.features.chunkTiles = this.tiles;
  }

  /** 조각 (cx, cy)가 드는 칸 번호 */
  slotIndex(cx: number, cy: number): number {
    return (cx % this.nx) + (cy % this.ny) * this.nx;
  }

  /** 조각이 칸에 들어 있는가 */
  has(cx: number, cy: number): boolean {
    return this.held[this.slotIndex(cx, cy)] === cy * this.cols + cx;
  }

  /** 조각 그림 자리 (아틀라스 px, 테 제외) */
  slot(cx: number, cy: number): ChunkSlot {
    const i = this.slotIndex(cx, cy);
    const b = chunkBox(cx, cy, this.tiles, this.k);
    return {
      x: (i % this.nx) * this.slotW + CHUNK_GUTTER,
      y: Math.floor(i / this.nx) * this.slotH + CHUNK_GUTTER,
      w: b.x1 - b.x0,
      h: b.y1 - b.y0,
    };
  }

  /**
   * 조각이 칸에 없으면 굽는다. 구웠으면 true. 작업 캔버스(칸 크기)에 그린 뒤 아틀라스 칸에 1:1로 복사하고, onBaked로
   * 작업 캔버스와 칸 자리를 알린다(GPU 쪽이 그 칸만 올린다 — 큰 캔버스의 일부를 바로 올리는 길은 WebGL1에 없다)
   */
  ensure(cx: number, cy: number): boolean {
    if (this.has(cx, cy)) return false;
    const t0 = performance.now();
    const i = this.slotIndex(cx, cy);
    const b = chunkBox(cx, cy, this.tiles, this.k);
    const sx = (i % this.nx) * this.slotW;
    const sy = Math.floor(i / this.nx) * this.slotH;
    const g = CHUNK_GUTTER;
    const w = this.work();
    const c = w.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.slotW, this.slotH);
    c.save();
    c.beginPath();
    c.rect(0, 0, b.x1 - b.x0 + g * 2, b.y1 - b.y0 + g * 2);
    c.clip();
    c.translate(g - b.x0, g - b.y0);
    // 겹치는 것만 칠한다 (선 굵기 · 안티에일리어싱 여유 4px)
    paintStaticMap(c, this.k, this.withGlow, {
      x0: b.x0 - g - 4,
      y0: b.y0 - g - 4,
      x1: b.x1 + g + 4,
      y1: b.y1 + g + 4,
    });
    c.restore();
    const a = this.ctx;
    a.clearRect(sx, sy, this.slotW, this.slotH);
    a.drawImage(w.canvas, sx, sy);
    this.held[i] = cy * this.cols + cx;
    this.onBaked?.(w.canvas, sx, sy);
    const ms = performance.now() - t0;
    this.bakes += 1;
    this.bakeMs += ms;
    gfxState.features.chunkBakes = Number(gfxState.features.chunkBakes ?? 0) + 1;
    gfxState.features.chunkBakeMs = Math.round((Number(gfxState.features.chunkBakeMs ?? 0) + ms) * 10) / 10;
    // 정적 맵 굽기 시간 (측정 · 시험): 따라가는 카메라에서는 조각 하나를 굽는 가장 긴 시간
    gfxState.features.mapBakeMs = Math.max(
      Number(gfxState.features.mapBakeMs ?? 0),
      Math.round(ms * 10) / 10,
    );
    gfxState.features.mapBakeScale = Math.round((this.k / TILE_PX) * 1000) / 1000;
    return true;
  }

  /** 새로 구운 칸 알림 (작업 캔버스 = 그 칸 화소, 아틀라스 px 자리). GPU 쪽이 그 칸만 올린다 */
  onBaked: ((src: HTMLCanvasElement, x: number, y: number) => void) | null = null;

  private scratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

  private work(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (this.scratch) return this.scratch;
    const canvas = document.createElement('canvas');
    canvas.width = this.slotW;
    canvas.height = this.slotH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('맵 조각 작업 캔버스를 만들 수 없습니다');
    this.scratch = { canvas, ctx };
    return this.scratch;
  }

  /** 칸 그림을 컨텍스트의 맵 전체 그림 좌표에 복사한다 (Canvas 합성: 이미 이동한 컨텍스트) */
  drawChunk(c: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = this.slot(cx, cy);
    const b = chunkBox(cx, cy, this.tiles, this.k);
    if (s.w > 0 && s.h > 0) c.drawImage(this.canvas, s.x, s.y, s.w, s.h, b.x0, b.y0, s.w, s.h);
  }

  get bytes(): number {
    return this.canvas.width * this.canvas.height * 4;
  }
}
