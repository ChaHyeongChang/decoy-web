// UI 폰트 (M10c, VISUAL_SPEC 10장): Noto Sans KR 서브셋 한 파일(가변 굵기 woff2, SIL OFL 1.1 — docs/CREDITS.md).
// CSS @font-face(style.css)와 Phaser 글자(text.ts makeText)가 같은 이름을 쓴다.
// 폰트를 못 받아도 게임은 대체 글꼴로 계속된다(콘솔 에러 없음).

/** @font-face 이름 */
export const UI_FONT_FAMILY = 'Noto Sans KR';
/** 글꼴 스택 (Phaser 글자 · CSS 같은 순서) */
export const UI_FONT = `'${UI_FONT_FAMILY}', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`;

let ready = false;

/** 판 장면을 시작할 때 폰트가 준비되어 있었는가 (디버그 · E2E. 아직 시작 전이면 null) */
export const fontState: { atSceneStart: boolean | null } = { atSceneStart: null };
let pending: Promise<boolean> | null = null;

/** UI 폰트를 다 받았는가 (판 장면은 시작 전에 이것을 확인한다) */
export function uiFontsReady(): boolean {
  return ready;
}

/**
 * UI가 쓰는 굵기를 미리 받는다. 여러 번 불러도 한 번만 받는다.
 * 시간 초과 · 실패면 false로 끝난다(대체 글꼴로 계속)
 */
export function loadUiFonts(timeoutMs = 3000): Promise<boolean> {
  if (pending) return pending;
  if (typeof document === 'undefined' || !('fonts' in document)) return (pending = Promise.resolve(false));
  const load = Promise.all(
    ['400', '700'].map((w) => document.fonts.load(`${w} 16px '${UI_FONT_FAMILY}'`)),
  ).then(
    (faces) => faces.every((f) => f.length > 0),
    () => false,
  );
  const timeout = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), timeoutMs));
  pending = Promise.race([load, timeout]).then((ok) => (ready = ok));
  return pending;
}
