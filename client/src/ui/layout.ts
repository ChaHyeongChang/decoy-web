// 화면 배치. 논리 해상도 1920×1080. 월드 단위는 1타일 = 32px이고,
// 맵은 0.93배로 그려 위 · 아래에 HUD 띠(64px)를 만든다 (탈출구를 가리지 않게, DECISIONS D3).
import { MAP_H, MAP_W, TILE_PX } from '@decoy/shared';

export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const HUD_BAND = 64;
export const MAP_SCALE = (VIEW_H - HUD_BAND * 2) / (MAP_H * TILE_PX);
export const MAP_PX_W = MAP_W * TILE_PX;
export const MAP_PX_H = MAP_H * TILE_PX;
export const MAP_X = (VIEW_W - MAP_PX_W * MAP_SCALE) / 2;
export const MAP_Y = HUD_BAND;
/** 화면에 그려지는 맵 사각형 */
export const MAP_RECT = { x: MAP_X, y: MAP_Y, w: MAP_PX_W * MAP_SCALE, h: MAP_PX_H * MAP_SCALE };
/** 좌우 여백 폭 */
export const SIDE_W = MAP_X;

/** 타일 좌표 → 화면 좌표 */
export function tileToScreen(x: number, y: number): { x: number; y: number } {
  return { x: MAP_X + x * TILE_PX * MAP_SCALE, y: MAP_Y + y * TILE_PX * MAP_SCALE };
}

/** 화면 좌표 → 타일 좌표 */
export function screenToTile(x: number, y: number): { x: number; y: number } {
  return { x: (x - MAP_X) / (TILE_PX * MAP_SCALE), y: (y - MAP_Y) / (TILE_PX * MAP_SCALE) };
}

/** HUD 영역 (맵과 겹치지 않는다) */
export const HUD_RECTS = {
  topBand: { x: 0, y: 0, w: VIEW_W, h: HUD_BAND },
  bottomBand: { x: 0, y: VIEW_H - HUD_BAND, w: VIEW_W, h: HUD_BAND },
  leftSide: { x: 0, y: HUD_BAND, w: SIDE_W, h: VIEW_H - HUD_BAND * 2 },
  rightSide: { x: VIEW_W - SIDE_W, y: HUD_BAND, w: SIDE_W, h: VIEW_H - HUD_BAND * 2 },
} as const;

/** 내부 렌더 해상도 배율 (?scale=0.5 저사양 모드). main.ts가 시작할 때 정한다 */
export let RENDER_SCALE = 1;

export function setRenderScale(v: number): void {
  RENDER_SCALE = v;
}

/** 장면 카메라를 논리 해상도(1920×1080)에 맞춘다 */
export function fitCamera(camera: {
  setZoom(z: number): unknown;
  setOrigin(x: number, y: number): unknown;
}): void {
  camera.setOrigin(0, 0);
  camera.setZoom(RENDER_SCALE);
}

/** HUD 배치 (맵 사각형과 겹치지 않게 위 · 아래 띠와 좌우 여백에) */
export const HUD = {
  timer: { x: VIEW_W / 2, y: HUD_BAND / 2 },
  gaugeA: { x: VIEW_W / 2 - 330, y: HUD_BAND / 2, w: 260 },
  gaugeB: { x: VIEW_W / 2 + 70, y: HUD_BAND / 2, w: 260 },
  leftCards: { x: 14, y: HUD_BAND + 14, w: SIDE_W - 28, h: 150, gap: 12 },
  minimap: { x: VIEW_W - SIDE_W + 12, y: HUD_BAND + 14, w: SIDE_W - 24 },
  bottom: { y: VIEW_H - HUD_BAND / 2 },
  /** 배너는 북쪽 탈출구 판정 원(맵 y 3타일)보다 아래 */
  bannerY: MAP_Y + 4.2 * TILE_PX * MAP_SCALE,
  noteY: MAP_Y + 8 * TILE_PX * MAP_SCALE,
} as const;
