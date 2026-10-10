// 렌더 해상도 계산 (순수 함수, Phaser를 import하지 않는다).
// 캔버스 표시 크기(CSS px) × 기기 픽셀 배율로 백버퍼를 정하고, 카메라 zoom으로 논리 해상도(PC 1920×1080)를 유지한다.
// 논리 폭은 입력으로 받는다: 나중에 터치 레이아웃(논리 폭 1920~2400)도 같은 함수를 쓴다 (MOBILE_PLAN M10a · M12).

/** ?scale로 줄 수 있는 해상도 배율 범위 */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 1;

export interface RenderSizeInput {
  /** 게임 영역(부모 요소)의 CSS 크기 */
  cssW: number;
  cssH: number;
  /** window.devicePixelRatio */
  dpr: number;
  /** 논리 해상도 (게임 좌표) */
  logicalW: number;
  logicalH: number;
  /** 품질 단계의 해상도 상한 (높이 하한은 터치 낮음만, 없으면 0) */
  preset: {
    readonly dprCap: number;
    readonly maxPixels: number;
    readonly minBackingH?: number;
    readonly floorDprCap?: number;
  };
  /** ?scale로 준 배율 (없으면 null) */
  scaleOverride: number | null;
  /** 부모 요소의 화면 위치 (CSS px). 캔버스의 화면 절대 위치를 기기 픽셀에 맞출 때 쓴다 */
  originX?: number;
  originY?: number;
}

export interface RenderSize {
  /** 백버퍼 (캔버스 실제 픽셀) */
  backingW: number;
  backingH: number;
  /** 카메라 zoom = 백버퍼 px / 논리 px (1보다 클 수 있다) */
  zoom: number;
  /** 백버퍼 px / 표시 CSS px */
  k: number;
  /** 캔버스 표시 크기 (CSS px) = 백버퍼 / k (배치 단위 1/64px로 맞춤) */
  dispW: number;
  dispH: number;
  /** 부모 요소 안에서 캔버스의 왼쪽 위 (CSS px). 화면 절대 위치 × dpr이 정수가 되게 맞춘 값 */
  left: number;
  top: number;
}

function positive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 브라우저 배치 단위 (CSS px). 크로미움은 CSS 위치 · 크기를 1/64px 단위로 내림해서 쓴다.
 * 예: 배율 1.25에서 119.2px(기기 149px)를 주면 119.1875px(기기 148.98px)가 된다 → 이 단위로 나타낼 수 있는 값만 쓴다
 */
export const LAYOUT_UNIT = 1 / 64;
/** 위치를 기기 픽셀 격자에 맞출 때 가운데에서 비켜 갈 수 있는 거리 (기기 px) */
const SNAP_SEARCH_PX = 6;

/** CSS 값을 배치 단위(1/64px)로 */
export function toLayoutUnit(v: number): number {
  return Math.round(v / LAYOUT_UNIT) * LAYOUT_UNIT;
}

/**
 * CSS 좌표를 기기 픽셀 격자에 맞춘다: 결과 × dpr이 정수이고 결과가 배치 단위로 정확히 나타나는 값.
 * 그런 값이 가까이 없는 배율(1.25면 기기 5px마다)에서는 가장 가까운 후보를 고른다 (최대 SNAP_SEARCH_PX 비켜 감)
 */
export function snapToDevice(v: number, dpr: number): number {
  const center = Math.round(v * dpr);
  let best = toLayoutUnit(center / dpr);
  let bestErr = Math.abs(best * dpr - center);
  for (let d = 1; d <= SNAP_SEARCH_PX && bestErr > 1e-9; d += 1) {
    for (const n of [center - d, center + d]) {
      const css = toLayoutUnit(n / dpr);
      const err = Math.abs(css * dpr - n);
      if (err < bestErr - 1e-9) {
        best = css;
        bestErr = err;
      }
    }
  }
  return best;
}

/**
 * 품질 배율 상한 (scaleOverride 전). 기본은 dprCap이고, 높이 하한(minBackingH)이 있으면
 * 표시 높이 × 배율이 하한 이상이 되도록 floorDprCap까지 올린다: max(dprCap, min(minBackingH / 표시 높이, floorDprCap))
 */
export function presetScaleCap(preset: RenderSizeInput['preset'], dispH: number): number {
  const cap = positive(preset.dprCap, 1);
  const minH = preset.minBackingH ?? 0;
  if (!(minH > 0) || !(dispH > 0)) return cap;
  const floorCap = positive(preset.floorDprCap ?? cap, cap);
  return Math.max(cap, Math.min(minH / dispH, floorCap));
}

/**
 * 렌더 해상도를 정한다.
 *  fit = min(cssW / logicalW, cssH / logicalH)
 *  k = min(dpr, 배율 상한(presetScaleCap: dprCap, 높이 하한), √(maxPixels / (logicalW·fit × logicalH·fit))) × (scaleOverride ?? 1)
 *  백버퍼 = round(논리 × fit × k), zoom = 백버퍼 폭 / 논리 폭, 표시 크기 = 백버퍼 / k
 *  위치는 가운데에 두고 기기 픽셀 격자에 맞춘다 (반 픽셀 어긋나면 합성기가 화면 전체를 다시 샘플한다)
 */
export function computeRenderSize(i: RenderSizeInput): RenderSize {
  const logicalW = positive(i.logicalW, 1);
  const logicalH = positive(i.logicalH, 1);
  const cssW = Math.max(1, positive(i.cssW, 1));
  const cssH = Math.max(1, positive(i.cssH, 1));
  const dpr = positive(i.dpr, 1);
  const fit = Math.min(cssW / logicalW, cssH / logicalH);
  const fitPixels = logicalW * fit * (logicalH * fit);
  const pixelCap = Math.sqrt(positive(i.preset.maxPixels, fitPixels) / fitPixels);
  const scale = i.scaleOverride === null ? 1 : positive(i.scaleOverride, 1);
  const k = Math.min(dpr, presetScaleCap(i.preset, logicalH * fit), pixelCap) * scale;
  const backingW = Math.max(1, Math.round(logicalW * fit * k));
  const backingH = Math.max(1, Math.round(logicalH * fit * k));
  const dispW = toLayoutUnit(backingW / k);
  const dispH = toLayoutUnit(backingH / k);
  const originX = i.originX ?? 0;
  const originY = i.originY ?? 0;
  const left = snapToDevice(originX + (cssW - dispW) / 2, dpr) - originX;
  const top = snapToDevice(originY + (cssH - dispH) / 2, dpr) - originY;
  return { backingW, backingH, zoom: backingW / logicalW, k, dispW, dispH, left, top };
}

/**
 * ?scale 값 해석. 값이 없거나 비었거나 0 · 음수 · 숫자가 아니면 null(지정 없음),
 * 있으면 [SCALE_MIN, SCALE_MAX]로 자른다. 예전에는 빈 값이 0 → 0.25배가 되는 버그가 있었다.
 */
export function parseScale(raw: string | null): number | null {
  if (raw === null) return null;
  const s = raw.trim();
  if (s === '') return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, v));
}
