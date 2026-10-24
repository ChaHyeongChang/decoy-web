// 설정 화면의 값 다루기 (설정 화면 통합, 순수 — DOM · Phaser를 import하지 않는다, 단위 시험 tests/unit/settings-model.test.ts).
// 그래픽 탭은 예전 키 · 동작을 그대로 쓴다: 품질 'decoy:quality'(gfx/quality, 자동이면 지움) · 프레임 제한 'decoy:frameLimit'
// (gfx/framePacing, 자동이면 지움) · 캐릭터 스타일 'decoy:charStyle'(gfx/charStyle). 고르면 바로 적용한다(qualityHooks · pacingHooks
// — main.ts가 채운다). 화면 · 소리 · 조작 탭은 prefs.ts('decoy:settings'), 진동은 haptics('decoy:haptics'), 조작 배치는
// 'decoy:controlLayout'.
// 주소 옵션(?quality · ?fpsLimit · ?chars)이 있으면 그 값이 이번 접속에 우선한다: 설정 화면은 그 줄을 잠그고 알린다
// (urlLock). 잠긴 줄을 '기본값으로' 되돌리면 저장값만 지우고 이번 접속에는 주소 값이 남는다
import type { QualityTier } from './gfx/presets';
import { loadSavedQuality, qualityHooks, saveQualityChoice, type QualityChoice } from './gfx/quality';
import { loadFrameLimit, pacingHooks, saveFrameLimit, type FrameLimit } from './gfx/framePacing';
import {
  DEFAULT_CHAR_STYLE,
  charStyleSource,
  currentCharStyle,
  resetCharStyle,
  setCharStyle,
  urlCharStyle,
  type CharStyle,
} from './gfx/charStyle';
import { isDefaultLayout, loadControlLayouts, saveControlLayouts } from './controlLayout';
import { haptics } from './haptics';
import { resetPrefs } from './prefs';
import { readKey } from './storageKeys';

export type TabId = 'graphics' | 'screen' | 'sound' | 'controls';
/** 판 중 탭 (온라인 판이라 멈추지 않는다 — 조작 탭 · 배치 편집은 로비에서만) */
export const MATCH_TABS: readonly TabId[] = ['graphics', 'screen', 'sound'];
export const LOBBY_TABS: readonly TabId[] = ['graphics', 'screen', 'sound', 'controls'];

export type SettingsContext = 'lobby' | 'match';

export function tabsFor(ctx: SettingsContext): readonly TabId[] {
  return ctx === 'match' ? MATCH_TABS : LOBBY_TABS;
}

/** 주소 옵션 (main.ts readParams — 이번 접속에만, 저장하지 않는다) */
export interface UrlOptions {
  quality: QualityTier | null;
  fpsLimit: FrameLimit | null;
  chars: CharStyle | null;
}

let url: UrlOptions = { quality: null, fpsLimit: null, chars: null };
/** 이번 접속에서 고른 값 (저장이 막혀도 다시 그릴 때 이 값) */
let qualityChoice: QualityChoice | null = null;
let frameChoice: FrameLimit | null = null;

/** 진입점이 한 번 부른다 (캐릭터 스타일 주소 값은 gfx/charStyle이 따로 들고 있다) */
export function initSettingsUrl(u: Omit<UrlOptions, 'chars'>): void {
  url = { ...u, chars: null };
}

/** 잠긴 줄의 주소 옵션 글자 (예: '?quality=low'). 없으면 null */
export function urlLock(id: 'quality' | 'frameLimit' | 'charStyle'): string | null {
  switch (id) {
    case 'quality':
      return url.quality ? `?quality=${url.quality}` : null;
    case 'frameLimit':
      return url.fpsLimit ? `?fpsLimit=${url.fpsLimit}` : null;
    case 'charStyle': {
      const c = urlCharStyle();
      return c ? `?chars=${c}` : null;
    }
  }
}

// ───────────── 품질 ─────────────

/** 보이는 품질 선택: 주소 값 > 이번 접속 선택 > 저장값 > 자동 */
export function qualityNow(): QualityChoice {
  return url.quality ?? qualityChoice ?? loadSavedQuality() ?? 'auto';
}

/** 품질을 고른다: 저장(자동이면 지움) 뒤 바로 적용. 저장하지 못하면 false. 주소 값이 있으면 아무것도 하지 않는다(true) */
export function chooseQuality(choice: QualityChoice): boolean {
  if (url.quality) return true;
  qualityChoice = choice;
  const ok = saveQualityChoice(choice);
  qualityHooks.choose?.(choice);
  return ok;
}

/** 기본값(자동)인가. 주소 값으로 잠겨 있으면 저장값이 없는가 */
export function qualityIsDefault(): boolean {
  return url.quality ? loadSavedQuality() === null : qualityNow() === 'auto';
}

/** 기본값(자동)으로. 주소 값이 있으면 저장값만 지운다 */
export function resetQuality(): boolean {
  // 이미 자동이면 아무것도 하지 않는다 ('모두 기본값으로'가 판 중 측정 기억 · 자동 하향을 지우지 않게 — 줄의 '자동' 다시 누르기는 따로)
  if (qualityIsDefault()) return true;
  if (url.quality) return saveQualityChoice('auto');
  return chooseQuality('auto');
}

// ───────────── 프레임 제한 ─────────────

/** 보이는 프레임 제한: 주소 값 > 이번 접속 선택 > 저장값 > 자동 */
export function frameLimitNow(): FrameLimit {
  return url.fpsLimit ?? frameChoice ?? loadFrameLimit() ?? 'auto';
}

/** 프레임 제한을 고른다: 저장(자동이면 지움) 뒤 바로 적용. 주소 값이 있으면 아무것도 하지 않는다(true) */
export function chooseFrameLimit(limit: FrameLimit): boolean {
  if (url.fpsLimit) return true;
  frameChoice = limit;
  const ok = saveFrameLimit(limit);
  pacingHooks.setLimit?.(limit);
  return ok;
}

/** 기본값(자동)인가. 주소 값으로 잠겨 있으면 저장값이 없는가 */
export function frameLimitIsDefault(): boolean {
  return url.fpsLimit ? loadFrameLimit() === null : frameLimitNow() === 'auto';
}

export function resetFrameLimit(): boolean {
  if (frameLimitIsDefault()) return true;
  if (url.fpsLimit) return saveFrameLimit('auto');
  return chooseFrameLimit('auto');
}

// ───────────── 캐릭터 스타일 ─────────────

export function charStyleNow(): CharStyle {
  return currentCharStyle();
}

/** 캐릭터 스타일을 고른다 (바로 적용 · 저장). 주소 값이 있으면 아무것도 하지 않는다(true) */
export function chooseCharStyle(style: CharStyle): boolean {
  if (urlCharStyle()) return true;
  return setCharStyle(style);
}

export function charStyleIsDefault(): boolean {
  return urlCharStyle() ? readKey('charStyle') === null : charStyleSource() === 'default';
}

export function resetCharStyleSetting(): boolean {
  return resetCharStyle();
}

/** 캐릭터 스타일 기본값 (설정 화면 표시용) */
export const CHAR_STYLE_DEFAULT: CharStyle = DEFAULT_CHAR_STYLE;

// ───────────── 진동 · 조작 배치 ─────────────

/** 진동 기본값은 켜짐 */
export function hapticsIsDefault(): boolean {
  return haptics.enabled;
}

/** 진동을 기본값(켜짐)으로: 저장값을 지운다 */
export function resetHaptics(): boolean {
  return haptics.resetSetting();
}

/** 조작 배치를 바꿔 둔 팀이 있는가 */
export function controlLayoutCustomized(): boolean {
  const l = loadControlLayouts();
  return !isDefaultLayout(l.survivor) || !isDefaultLayout(l.monster);
}

/** 조작 배치를 두 팀 모두 기본값으로 (저장값을 지운다) */
export function resetControlLayout(): boolean {
  // 저장하지 못해 이번 접속에만 쓰던 배치도 비운다 (saveControlLayouts가 둘 다 기본이면 키를 지운다)
  return saveControlLayouts({ survivor: null, monster: null });
}

/**
 * 모두 기본값으로 (설정 화면 '모두 기본값으로'): 그래픽 · 화면 · 소리 · 조작(진동 · 조이스틱 · 조작 배치)까지.
 * 주소 옵션으로 잠긴 줄은 저장값만 지운다. 하나라도 저장하지 못하면 false (이번 접속에는 적용된다)
 */
export function resetAllSettings(): boolean {
  const results = [
    resetQuality(),
    resetFrameLimit(),
    resetCharStyleSetting(),
    resetPrefs(),
    resetHaptics(),
    resetControlLayout(),
  ];
  return results.every(Boolean);
}

/** 시험용 */
export function resetSettingsModelForTest(): void {
  url = { quality: null, fpsLimit: null, chars: null };
  qualityChoice = null;
  frameChoice = null;
}
