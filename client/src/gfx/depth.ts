// 입체감 설정 (VISUAL_SPEC 14장): 켜기/끄기 · 시안. 그림만 바꾼다 — 규칙 · 판정 · 서버로 보내는 값 · 스냅샷과 무관하다.
// 정하는 순서: 주소 ?depth=0|1(시험 · 촬영용, 저장하지 않음) > 설정 '입체감'(prefs depth3d, 기본 켬).
// 실제로 그리는가 = 켬 + WebGL + 품질 높음 · 중간 (낮음 · Canvas 렌더러는 늘 끔 — 가벼움 우선, 지금 그대로).
// 시안은 주소 ?depthLook=a|b|c(시안 비교 촬영용, 저장하지 않음) > 고른 시안(depthGeom DEFAULT_DEPTH_LOOK).
// Phaser · DOM을 import하지 않는다(단위 시험)
// 시안 값 표(art/depthGeom DEPTH_LOOKS)는 이 파일이 불러오지 않는다: 주소 해석은 첫 로딩 묶음(app.ts)에 들어가고, 맵 계산은
// 판 화면에서만 쓴다
import { pref } from '../prefs';
import type { QualityTier, RendererKind } from './presets';

/** 시안 이름 (A 낮게 · 옅게, B 중간, C 높게 · 진하게 — 값은 art/depthGeom DEPTH_LOOKS) */
export type DepthLookId = 'a' | 'b' | 'c';
export const DEPTH_LOOK_IDS: readonly DepthLookId[] = ['a', 'b', 'c'];
/** 고른 시안 (시안 비교 — VISUAL_SPEC 14장 · artifacts/depth) */
export const DEFAULT_DEPTH_LOOK: DepthLookId = 'b';

export function isDepthLookId(v: unknown): v is DepthLookId {
  return v === 'a' || v === 'b' || v === 'c';
}

/**
 * 후처리 가라앉히기 밝기 문턱 (sRGB 가중 합): lo 이하는 crush만큼 어둡게, hi 이상은 그대로. 셰이더(render/effects.ts)와
 * art/depthGeom gradePixel이 같이 쓴다 — 셰이더는 첫 묶음, 계산은 나눠 받는 조각이라 둘이 함께 쓰는 값을 여기 둔다
 */
export const DEPTH_SINK = { lo: 0.02, hi: 0.2 } as const;

let urlOn: boolean | null = null;
let urlLook: DepthLookId | null = null;

/** ?depth 값 해석: '1' · 'on' → 켬, '0' · 'off' → 끔, 그 밖에는 null */
export function parseDepthParam(raw: string | null): boolean | null {
  const v = raw?.trim().toLowerCase();
  if (v === '1' || v === 'on') return true;
  if (v === '0' || v === 'off') return false;
  return null;
}

/** ?depthLook 값 해석 (a · b · c, 대소문자 무관). 그 밖에는 null */
export function parseDepthLook(raw: string | null): DepthLookId | null {
  const v = raw?.trim().toLowerCase();
  return isDepthLookId(v) ? v : null;
}

/** 진입점이 한 번 부른다 (주소 값, 저장하지 않음) */
export function initDepthUrl(on: boolean | null, look: DepthLookId | null): void {
  urlOn = on;
  urlLook = look;
}

/** 주소 ?depth로 준 값 (설정 화면이 줄을 잠그고 알린다. 없으면 null) */
export function urlDepth(): boolean | null {
  return urlOn;
}

/** 입체감 설정이 켜져 있는가 (주소 > 설정) — 렌더러 · 품질과 무관한 사용자 선택 */
export function depthWanted(): boolean {
  return urlOn ?? pref('depth3d');
}

/** 이 렌더러 · 품질에서 입체감을 그릴 수 있는가 (WebGL + 높음 · 중간) */
export function depthSupported(tier: QualityTier, renderer: RendererKind): boolean {
  return renderer === 'webgl' && tier !== 'low';
}

/** 지금 그리는 입체감 시안 이름 (끄면 null) */
export function activeDepthLook(tier: QualityTier, renderer: RendererKind): DepthLookId | null {
  if (!depthWanted() || !depthSupported(tier, renderer)) return null;
  return urlLook ?? DEFAULT_DEPTH_LOOK;
}

/** 시험용: 상태를 처음으로 */
export function resetDepthForTest(): void {
  urlOn = null;
  urlLook = null;
}
