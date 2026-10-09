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

/**
 * 카메라 zoom = 백버퍼 px / 논리 px (M10a). 표시 CSS 크기 × 기기 픽셀 배율(품질 단계 상한 · ?scale 적용)로 정해져
 * 1보다 클 수 있다(맥북 배율 2 → 1.5). main.ts가 시작할 때와 창 크기 · DPR · 품질이 바뀔 때 정한다 (render/resolution.ts)
 */
export let RENDER_SCALE = 1;

export function setRenderScale(v: number): void {
  RENDER_SCALE = v;
}

/** 장면 카메라를 논리 해상도(1920×1080)에 맞춘다: 백버퍼 전체에 논리 화면이 꽉 차게 zoom */
export function fitCamera(camera: {
  setZoom(z: number): unknown;
  setOrigin(x: number, y: number): unknown;
}): void {
  camera.setOrigin(0, 0);
  camera.setZoom(RENDER_SCALE);
}

/**
 * HUD 배치 (M10c, VISUAL_SPEC 8장). 부품의 위치 · 크기는 여기서만 읽는다(M12 모바일 배치가 같은 부품을 다시 배치한다).
 * 판에 늘 떠 있는 부품(위 띠 · 팀 카드 · 행동 칸 · 미니맵)은 맵 사각형과 겹치지 않게 위 · 아래 띠와 좌우 여백에 둔다.
 * 배너 · 메모 · 조작 안내 · 점수판은 잠깐 뜨는 덮개라 맵 위에 둔다(탈출구 · 감옥을 비킨 자리).
 * 위 띠 오른쪽(x 1490 이후)과 아래 띠 오른쪽은 비워 둔다(선명도 탐침 자리, m10-resolution).
 */
const GAUGE = { dia: 38, chip: 24, barW: 212, barH: 22, gap: 6 } as const;
const GAUGE_W = GAUGE.dia + GAUGE.gap + GAUGE.chip + 8 + GAUGE.barW;
const TIMER_W = 156;

export const HUD = {
  /** 위 띠 가운데 타이머 틀 (가운데 x, y) */
  timer: { x: VIEW_W / 2, y: HUD_BAND / 2, w: TIMER_W, h: 44 },
  /** 거점 게이지: 배지 ◇ · 상태 칩 · 막대. A는 타이머 왼쪽, B는 오른쪽에 좌우 대칭(배지가 바깥) */
  gauge: { ...GAUGE, w: GAUGE_W },
  /** 배지 쪽 바깥 끝 x (A = 왼쪽 끝, B = 오른쪽 끝) */
  gaugeA: { x: VIEW_W / 2 - TIMER_W / 2 - 14 - GAUGE_W, y: HUD_BAND / 2 },
  gaugeB: { x: VIEW_W / 2 + TIMER_W / 2 + 14 + GAUGE_W, y: HUD_BAND / 2 },
  /** 왼쪽 팀 카드 (생존자 화면 h, 괴물 화면 익명 카드 hAnon) */
  leftCards: { x: 14, y: HUD_BAND + 14, w: SIDE_W - 28, h: 124, hAnon: 96, gap: 10 },
  /** 미니맵 그림 자리 (틀은 바깥으로 pad, 위로 제목 줄 title) */
  minimap: { x: VIEW_W - SIDE_W + 12, y: HUD_BAND + 38, w: SIDE_W - 24, pad: 6, title: 30 },
  /** 아래 띠 가운데 y */
  bottom: { y: VIEW_H - HUD_BAND / 2 },
  /** 행동 칸: 아이콘 타일 + 이름 + 키캡 한 칸의 폭 · 간격 · 타일 한 변 */
  slot: { w: 176, gap: 12, tile: 56 },
  /** 아래 띠 안내 줄 (수감 · 관전 · 괴물 대기: 행동 칸 대신) 높이 */
  hint: { h: 42 },
  /** 배너는 북쪽 탈출구 판정 원(맵 y 3타일)보다 아래. 지속 배너 · 알림 두 줄의 가운데 y와 높이 */
  bannerY: MAP_Y + 4.2 * TILE_PX * MAP_SCALE,
  banner: { h: 46, rowH: 40, rowGap: 50 },
  /** 메모 상자 위쪽 y (알림 두 줄 아래, 감옥(맵 y 14타일)보다 위) · 글자 폭 */
  noteY: MAP_Y + 8.7 * TILE_PX * MAP_SCALE,
  noteW: 900,
  /** 첫 판 조작 안내 (맵 아래쪽 1/3 가운데) · Tab 점수판 (화면 가운데) */
  tutorialY: VIEW_H * 0.76,
  scoreY: VIEW_H / 2,
} as const;
