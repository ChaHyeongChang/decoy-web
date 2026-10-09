// 지금의 그래픽 상태 (품질 · 렌더 해상도 · 안개 방식). 해상도 · 품질 · 안개 코드가 여기에 쓰고,
// 디버그 훅(window.__DECOY__.gfx)과 다른 렌더 모듈이 읽는다. Phaser를 import하지 않는다(단위 테스트용).
import type { GfxDebugInfo } from '@decoy/shared';
import { effectivePreset, type QualityPreset, type QualityTier, type RendererKind } from './presets';

export interface GfxState extends GfxDebugInfo {
  quality: QualityTier;
  renderer: RendererKind;
}

export const gfxState: GfxState = {
  quality: 'high',
  qualitySource: 'auto',
  renderer: 'webgl',
  touch: false,
  layout: 'pc',
  viewW: 1920,
  viewH: 1080,
  dpr: 1,
  cssW: 1920,
  cssH: 1080,
  backingW: 1920,
  backingH: 1080,
  zoom: 1,
  scaleOverride: null,
  textRes: 1,
  compositeScale: 1,
  minimapScale: 1,
  fogMode: 'canvas',
  ambient: 0,
  features: {},
  downgrades: 0,
  measuredFps: 0,
};

/** 지금 품질 · 렌더러 · 기기에 맞춘 설정 */
export function currentPreset(): QualityPreset {
  return effectivePreset(gfxState.quality, gfxState.renderer, gfxState.touch);
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** 품질이나 렌더 해상도가 바뀌면 불린다. 바닥 합성 · 미니맵 · 텍스처가 다시 만든다 */
export function onGfxChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyGfxChange(): void {
  for (const fn of [...listeners]) fn();
}

// ───────────── 테스트 · 스크린샷용 (디버그 훅에서만 바꾼다) ─────────────

let frozenClockMs: number | null = null;

/** 장식 애니메이션 · 입자의 시계. 디버그 훅으로 멈출 수 있다(스크린샷 · 픽셀 검사가 흔들리지 않게). 규칙 · 입력 타이머는 쓰지 않는다 */
export function gfxNow(): number {
  return frozenClockMs ?? performance.now();
}

export function freezeGfxClock(ms: number | null): void {
  frozenClockMs = ms;
}

let fpsOverride: number | null = null;

/** 품질 자동 하향 판단에 쓰는 FPS. 테스트가 낮은 값을 넣을 수 있다 */
export function setFpsOverride(fps: number | null): void {
  fpsOverride = fps;
}

export function getFpsOverride(): number | null {
  return fpsOverride;
}

/** 선명도 검사용 글자를 HUD에 그리는 함수. 해상도 작업이 장면을 만들 때 채운다 */
export const probeSlot: { draw: ((text: string, x: number, y: number, px: number) => void) | null } = {
  draw: null,
};
