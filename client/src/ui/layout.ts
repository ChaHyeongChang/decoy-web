// 화면 배치. PC 논리 해상도 1920×1080. 월드 단위는 1타일 = 32px이고,
// 맵은 0.93배로 그려 위 · 아래에 HUD 띠(64px)를 만든다 (탈출구를 가리지 않게, DECISIONS D3).
// M12: 터치 모드는 판 시작 직전 configureLayout으로 화면비에 맞는 논리 크기 · 맵 자리 · HUD 배치를 고른다.
// 맵 배율(MAP_SCALE)은 모든 배치에서 같다(맵 · 캐릭터 그림 · 안개가 배율에 묶여 있다). 화면에 맞추는 것은 카메라 zoom이다.
// 아래 `export let` 값은 ES 모듈 라이브 바인딩이라 다른 모듈은 읽는 순간의 값을 본다. 판 중에는 바뀌지 않는다
// (판 중 창 크기가 바뀌면 논리 크기는 그대로 두고 zoom만 다시 맞춘다).
import { MAP_H, MAP_W, TILE_PX } from '@decoy/shared';

/** PC 논리 해상도 (PC는 언제나 이 크기) */
export const PC_VIEW_W = 1920;
export const PC_VIEW_H = 1080;
/** PC 위 · 아래 HUD 띠 높이 */
export const PC_HUD_BAND = 64;
/** 맵 배율: PC 기준(1080 − 띠 2개)으로 정하고 모든 배치에서 같다 */
export const MAP_SCALE = (PC_VIEW_H - PC_HUD_BAND * 2) / (MAP_H * TILE_PX);
export const MAP_PX_W = MAP_W * TILE_PX;
export const MAP_PX_H = MAP_H * TILE_PX;
/** 화면에 그려지는 맵 크기 (논리 px, 모든 배치에서 같다) */
export const MAP_DRAW_W = MAP_PX_W * MAP_SCALE;
export const MAP_DRAW_H = MAP_PX_H * MAP_SCALE;

/**
 * 배치 종류.
 * - pc: 1920×1080, 위 · 아래 띠 + 좌우 여백
 * - touchWide: 터치, 화면비 2:1 이상. 맵이 화면 높이 가득, HUD는 좌우 칸 위쪽, 아래쪽 좌우는 엄지 영역
 * - touchNarrow: 터치, 2:1보다 좁은 화면(16:9 등). 위 · 아래 띠를 남기고 엄지 영역이 맵 아래 구석에 겹친다
 */
export type LayoutKind = 'pc' | 'touchWide' | 'touchNarrow';

/** 한 배치의 기하 (논리 px) */
export interface LayoutInfo {
  kind: LayoutKind;
  /** 논리 해상도 */
  viewW: number;
  viewH: number;
  /** 맵 왼쪽 위 */
  mapX: number;
  mapY: number;
  /** 위 · 아래 띠 높이 (touchWide는 0) */
  hudBand: number;
  /** HUD 부품 배율 (PC 1). 터치는 글자 · 아이콘이 CSS 12px 이상이 되게 키운다 */
  uiScale: number;
}

/** PC 배치 */
export function pcLayout(): LayoutInfo {
  return {
    kind: 'pc',
    viewW: PC_VIEW_W,
    viewH: PC_VIEW_H,
    mapX: (PC_VIEW_W - MAP_DRAW_W) / 2,
    mapY: PC_HUD_BAND,
    hudBand: PC_HUD_BAND,
    uiScale: 1,
  };
}

/**
 * 화면(CSS px)과 입력 방식에 맞는 배치 (순수 함수). PC(touch=false)는 화면과 상관없이 언제나 pcLayout().
 * 터치는 가로 기준으로 정한다(세로로 받은 크기는 긴 변을 폭으로 본다: 세로로 열었다가 돌려 판을 시작하는 경우).
 * 구현: M12 갈래 A (지금은 모두 PC 배치)
 */
export function layoutFor(screenW: number, screenH: number, touch: boolean): LayoutInfo {
  void screenW;
  void screenH;
  void touch;
  return pcLayout();
}

let current: LayoutInfo = pcLayout();

/** 논리 해상도 */
export let VIEW_W = current.viewW;
export let VIEW_H = current.viewH;
/** 위 · 아래 HUD 띠 높이 (touchWide는 0) */
export let HUD_BAND = current.hudBand;
export let MAP_X = current.mapX;
export let MAP_Y = current.mapY;
/** 화면에 그려지는 맵 사각형 */
export let MAP_RECT = { x: MAP_X, y: MAP_Y, w: MAP_DRAW_W, h: MAP_DRAW_H };
/** 좌우 여백 폭 */
export let SIDE_W = MAP_X;

/** 지금 배치 */
export function layout(): Readonly<LayoutInfo> {
  return current;
}

/** 타일 좌표 → 화면 좌표 */
export function tileToScreen(x: number, y: number): { x: number; y: number } {
  return { x: MAP_X + x * TILE_PX * MAP_SCALE, y: MAP_Y + y * TILE_PX * MAP_SCALE };
}

/** 화면 좌표 → 타일 좌표 */
export function screenToTile(x: number, y: number): { x: number; y: number } {
  return { x: (x - MAP_X) / (TILE_PX * MAP_SCALE), y: (y - MAP_Y) / (TILE_PX * MAP_SCALE) };
}

/** HUD 영역 (맵과 겹치지 않는다. touchWide는 위 · 아래 띠가 0 높이) */
function hudRects(l: LayoutInfo) {
  const side = l.mapX;
  return {
    topBand: { x: 0, y: 0, w: l.viewW, h: l.hudBand },
    bottomBand: { x: 0, y: l.viewH - l.hudBand, w: l.viewW, h: l.hudBand },
    leftSide: { x: 0, y: l.hudBand, w: side, h: l.viewH - l.hudBand * 2 },
    rightSide: { x: l.viewW - side, y: l.hudBand, w: side, h: l.viewH - l.hudBand * 2 },
  } as const;
}

export let HUD_RECTS = hudRects(current);

/**
 * 카메라 zoom = 백버퍼 px / 논리 px (M10a). 표시 CSS 크기 × 기기 픽셀 배율(품질 단계 상한 · ?scale 적용)로 정해져
 * 1보다 클 수 있다(맥북 배율 2 → 1.5). main.ts가 시작할 때와 창 크기 · DPR · 품질 · 배치가 바뀔 때 정한다 (render/resolution.ts)
 */
export let RENDER_SCALE = 1;

export function setRenderScale(v: number): void {
  RENDER_SCALE = v;
}

/** 장면 카메라를 논리 해상도에 맞춘다: 백버퍼 전체에 논리 화면이 꽉 차게 zoom */
export function fitCamera(camera: {
  setZoom(z: number): unknown;
  setOrigin(x: number, y: number): unknown;
}): void {
  camera.setOrigin(0, 0);
  camera.setZoom(RENDER_SCALE);
}

/**
 * HUD 배치 (M10c, VISUAL_SPEC 8장). 부품의 위치 · 크기는 여기서만 읽는다(M12 터치 배치가 같은 부품을 다시 배치한다).
 * 판에 늘 떠 있는 부품(위 띠 · 팀 카드 · 행동 칸 · 미니맵)은 맵 사각형과 겹치지 않게 위 · 아래 띠와 좌우 여백에 둔다.
 * 배너 · 메모 · 조작 안내 · 점수판은 잠깐 뜨는 덮개라 맵 위에 둔다(탈출구 · 감옥을 비킨 자리).
 * PC: 위 띠 오른쪽(x 1490 이후)과 아래 띠 오른쪽은 비워 둔다(선명도 탐침 자리, m10-resolution).
 * 터치 배치(touchWide · touchNarrow)의 값은 M12 갈래 A가 정한다 (지금은 PC 값)
 */
const GAUGE = { dia: 38, chip: 24, barW: 212, barH: 22, gap: 6 } as const;
const GAUGE_W = GAUGE.dia + GAUGE.gap + GAUGE.chip + 8 + GAUGE.barW;
const TIMER_W = 156;

function hudFor(l: LayoutInfo) {
  const side = l.mapX;
  const band = l.hudBand;
  return {
    /** 위 띠 가운데 타이머 틀 (가운데 x, y) */
    timer: { x: l.viewW / 2, y: band / 2, w: TIMER_W, h: 44 },
    /** 거점 게이지: 배지 ◇ · 상태 칩 · 막대. A는 타이머 왼쪽, B는 오른쪽에 좌우 대칭(배지가 바깥) */
    gauge: { ...GAUGE, w: GAUGE_W },
    /** 배지 쪽 바깥 끝 x (A = 왼쪽 끝, B = 오른쪽 끝) */
    gaugeA: { x: l.viewW / 2 - TIMER_W / 2 - 14 - GAUGE_W, y: band / 2 },
    gaugeB: { x: l.viewW / 2 + TIMER_W / 2 + 14 + GAUGE_W, y: band / 2 },
    /** 왼쪽 팀 카드 (생존자 화면 h, 괴물 화면 익명 카드 hAnon) */
    leftCards: { x: 14, y: band + 14, w: side - 28, h: 124, hAnon: 96, gap: 10 },
    /** 미니맵 그림 자리 (틀은 바깥으로 pad, 위로 제목 줄 title) */
    minimap: { x: l.viewW - side + 12, y: band + 38, w: side - 24, pad: 6, title: 30 },
    /** 아래 띠 가운데 y */
    bottom: { y: l.viewH - band / 2 },
    /** 행동 칸: 아이콘 타일 + 이름 + 키캡 한 칸의 폭 · 간격 · 타일 한 변 */
    slot: { w: 176, gap: 12, tile: 56 },
    /** 아래 띠 안내 줄 (수감 · 관전 · 괴물 대기: 행동 칸 대신) 높이 */
    hint: { h: 42 },
    /** 배너는 북쪽 탈출구 판정 원(맵 y 3타일)보다 아래. 지속 배너 · 알림 두 줄의 가운데 y와 높이 */
    bannerY: l.mapY + 4.2 * TILE_PX * MAP_SCALE,
    banner: { h: 46, rowH: 40, rowGap: 50 },
    /** 메모 상자 위쪽 y (알림 두 줄 아래, 감옥(맵 y 14타일)보다 위) · 글자 폭 */
    noteY: l.mapY + 8.7 * TILE_PX * MAP_SCALE,
    noteW: 900,
    /** 첫 판 조작 안내 (맵 아래쪽 1/3 가운데) · Tab 점수판 (화면 가운데) */
    tutorialY: l.viewH * 0.76,
    scoreY: l.viewH / 2,
  } as const;
}

export type HudLayoutSpec = ReturnType<typeof hudFor>;

export let HUD: HudLayoutSpec = hudFor(current);

/**
 * 배치를 적용한다 (main.ts가 판 장면을 만들기 직전에 부른다). 위 값들(VIEW_W · MAP_X · HUD …)이 모두 바뀐다.
 * 판 장면 · HUD는 만들 때 읽으므로 판 중에는 부르지 않는다
 */
export function configureLayout(screenW: number, screenH: number, touch: boolean): Readonly<LayoutInfo> {
  applyLayout(layoutFor(screenW, screenH, touch));
  return current;
}

/** 배치 값을 그대로 적용한다 (configureLayout · 단위 테스트) */
export function applyLayout(l: LayoutInfo): void {
  current = { ...l };
  VIEW_W = l.viewW;
  VIEW_H = l.viewH;
  HUD_BAND = l.hudBand;
  MAP_X = l.mapX;
  MAP_Y = l.mapY;
  MAP_RECT = { x: l.mapX, y: l.mapY, w: MAP_DRAW_W, h: MAP_DRAW_H };
  SIDE_W = l.mapX;
  HUD_RECTS = hudRects(current);
  HUD = hudFor(current);
}
