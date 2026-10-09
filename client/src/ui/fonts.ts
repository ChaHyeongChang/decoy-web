// UI 폰트 (M10c, VISUAL_SPEC 10장): Noto Sans KR 서브셋 한 파일(가변 굵기 woff2, SIL OFL 1.1 — docs/CREDITS.md).
// CSS @font-face(style.css)와 Phaser 글자(text.ts makeText)가 같은 이름을 쓴다.
// 폰트를 못 받아도 게임은 대체 글꼴로 계속된다(콘솔 에러 없음).
// 파일 · 글자 목록 · 라이선스: client/public/fonts/ (다시 만들기: scripts/font-subset.mjs)

/** @font-face 이름 */
export const UI_FONT_FAMILY = 'Noto Sans KR';
/** 글꼴 스택 (Phaser 글자 · CSS 같은 순서. style.css --font와 같아야 한다 — fonts.test.ts) */
export const UI_FONT = `'${UI_FONT_FAMILY}', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`;
/** UI가 쓰는 굵기. 가변 폰트 한 파일이라 실제 내려받기는 한 번이다 */
export const UI_FONT_WEIGHTS = ['400', '500', '700', '800'] as const;
/** 불러오기 확인에 쓰는 글자 (한글 · 라틴 · 숫자) */
const SAMPLE = 'DECOY 생존자 괴물 0123';

let ready = false;

/** 판 장면을 시작할 때 폰트가 준비되어 있었는가 (디버그 · E2E. 아직 시작 전이면 null) */
export const fontState: { atSceneStart: boolean | null } = { atSceneStart: null };
let pending: Promise<boolean> | null = null;
const lateListeners: (() => void)[] = [];

/** UI 폰트를 다 받았는가 (판 장면은 시작 전에 이것을 확인한다) */
export function uiFontsReady(): boolean {
  return ready;
}

/**
 * 시간 제한 뒤에 늦게 다 받았을 때 한 번 부른다(이미 만든 Phaser 글자를 다시 그리는 데 쓴다).
 * 제한 안에 받았으면 부르지 않는다 — 그때는 loadUiFonts()가 true로 끝난다
 */
export function onUiFontsLate(cb: () => void): void {
  lateListeners.push(cb);
}

/**
 * UI가 쓰는 굵기를 미리 받는다. 여러 번 불러도 한 번만 받는다.
 * 시간 초과 · 실패면 false로 끝난다(대체 글꼴로 계속). 시간 초과 뒤 늦게 받으면 uiFontsReady()가 true가 되고
 * onUiFontsLate에 알린다
 */
export function loadUiFonts(timeoutMs = 3000): Promise<boolean> {
  if (pending) return pending;
  if (typeof document === 'undefined' || !('fonts' in document)) return (pending = Promise.resolve(false));
  const fonts = document.fonts;
  let settled = false;
  const load = Promise.all(
    UI_FONT_WEIGHTS.map((w) => fonts.load(`${w} 16px '${UI_FONT_FAMILY}'`, SAMPLE)),
  ).then(
    (faces) => faces.every((f) => f.length > 0) && fonts.check(`700 16px '${UI_FONT_FAMILY}'`, SAMPLE),
    () => false,
  );
  void load.then((ok) => {
    if (!ok || !settled || ready) return;
    // 시간 제한 뒤에 도착
    ready = true;
    for (const cb of lateListeners.splice(0)) cb();
  });
  const timeout = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), timeoutMs));
  pending = Promise.race([load, timeout]).then((ok) => {
    settled = true;
    if (ok) ready = true;
    return ok;
  });
  return pending;
}
