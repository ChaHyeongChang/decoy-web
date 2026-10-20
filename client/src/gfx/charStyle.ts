// 캐릭터 스타일 설정 (캐릭터 리디자인 2단계): 기존(도형 실루엣) / 새 캐릭터. 기본값은 기존.
// 그림만 바꾼다 — 규칙 · 판정 · 서버로 보내는 값 · 스냅샷과 무관하다(서버로 보내지 않는다).
// 게임 속 위 그림(아틀라스), 로비 역할 카드 · 연습 역할 고르기 · 결과 화면 · 조작 안내의 정면 그림이 이 값을 따른다.
// 정하는 순서: 이번 접속에서 고른 값 > 주소 ?chars=new|classic(시험 · 촬영용, 저장하지 않음) > 저장값('decoy:charStyle') > 기존.
// 저장소는 처음 한 번만 읽는다(아틀라스가 매 프레임 묻는다). Phaser · DOM을 import하지 않는다(단위 시험 · node에서 로비를 불러온다)
import { gfxState } from './state';
import { readKey, removeKey, writeKey, type StorageLike } from '../storageKeys';

export type CharStyle = 'classic' | 'new';

export const CHAR_STYLES: readonly CharStyle[] = ['classic', 'new'];
export const DEFAULT_CHAR_STYLE: CharStyle = 'classic';

/** 저장값 · 주소 값 → 스타일 (모르는 값 · 없음이면 null). 앞뒤 공백 · 대소문자는 가리지 않는다 */
export function parseCharStyle(raw: string | null | undefined): CharStyle | null {
  const v = raw?.trim().toLowerCase();
  return v === 'classic' || v === 'new' ? v : null;
}

/** 스타일을 정한 곳 (디버그 · 시험) */
export type CharStyleSource = 'choice' | 'url' | 'saved' | 'default';

let choice: CharStyle | null = null;
let urlStyle: CharStyle | null = null;
/** 저장값 (처음 물을 때 한 번 읽는다. undefined = 아직 안 읽음) */
let saved: CharStyle | null | undefined;

type Listener = (style: CharStyle) => void;
const listeners = new Set<Listener>();

function resolve(storage?: StorageLike | null): CharStyle {
  if (choice) return choice;
  if (urlStyle) return urlStyle;
  if (saved === undefined) saved = parseCharStyle(readKey('charStyle', '', storage));
  return saved ?? DEFAULT_CHAR_STYLE;
}

/** 주소 ?chars로 준 값 (진입점이 한 번 부른다). 저장하지 않는다 (storage = 시험용 저장소, 없으면 브라우저 저장소) */
export function initCharStyle(url: CharStyle | null, storage?: StorageLike | null): void {
  urlStyle = url;
  if (saved === undefined) saved = parseCharStyle(readKey('charStyle', '', storage));
  gfxState.charStyle = resolve(storage);
}

/** 지금 스타일 */
export function currentCharStyle(): CharStyle {
  return resolve();
}

/** 지금 스타일을 정한 곳 */
export function charStyleSource(): CharStyleSource {
  if (choice) return 'choice';
  if (urlStyle) return 'url';
  if (saved === undefined) resolve();
  return saved ? 'saved' : 'default';
}

/**
 * 스타일을 고른다 (로비 · 설정 판 · 디버그 훅). 바로 적용하고 저장한다 — 기존이면 저장값을 지운다.
 * 저장하지 못하면 false (이번 접속에는 적용된다). persist = false면 저장소를 건드리지 않는다(디버그 훅)
 */
export function setCharStyle(style: CharStyle, persist = true, storage?: StorageLike | null): boolean {
  const before = resolve(storage);
  choice = style;
  let ok = true;
  if (persist) {
    ok =
      style === DEFAULT_CHAR_STYLE
        ? removeKey('charStyle', '', storage)
        : writeKey('charStyle', style, '', storage);
    if (ok) saved = style === DEFAULT_CHAR_STYLE ? null : style;
  }
  gfxState.charStyle = style;
  if (before !== style) for (const fn of [...listeners]) fn(style);
  return ok;
}

/** 스타일이 바뀌면 불린다 (미리 굽기 · 로비 카드 다시 그리기) */
export function onCharStyleChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 시험용: 상태를 처음으로 되돌린다 */
export function resetCharStyleForTest(): void {
  choice = null;
  urlStyle = null;
  saved = undefined;
  listeners.clear();
  gfxState.charStyle = DEFAULT_CHAR_STYLE;
}
