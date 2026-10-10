// 첫 실행 터치 안내 (MOBILE_PLAN M12 5번). 이 기기에서 처음이면 판 직전(준비 후 대기 · 빠른 매칭 대기 · 연습 시작 전)에
// 안내 본문을 보여 주고(로비 — 갈래 B), 그 판에서는 처음 10초 동안 스틱 · 버튼 위치를 반투명 도형으로 보여 준다(터치 화면 — 갈래 A).
// '다시 보기'(로비 설정)는 본 기록을 지운다. PC는 지금 안내(첫 판 조작 안내 오버레이) 그대로라 여기를 쓰지 않는다.
import { readKey, removeKey, writeKey } from './storageKeys';

/** 판 중 위치 표시 시간 (ms) */
export const TOUCH_HINT_MS = 10_000;

/** 이번 접속에서 판 직전 안내를 보였고, 아직 그 판의 위치 표시를 시작하지 않았다 */
let hintsPending = false;
/** 저장소가 막혀 있어도 이번 접속에서는 한 번만 보이게 */
let shownThisSession = false;

/** 판 직전 안내를 보여야 하는가 (이 기기에서 본 적 없음) */
export function touchTutorialNeeded(): boolean {
  return !shownThisSession && readKey('touchTutorial') === null;
}

/** 판 직전 안내를 보였다: 본 것으로 저장하고, 다음 판 장면이 위치 표시를 하게 한다 */
export function markTouchTutorialShown(): void {
  shownThisSession = true;
  hintsPending = true;
  writeKey('touchTutorial', '1');
}

/**
 * 봇과 연습(M13b): 역할을 고르면 바로 시작하므로 판 직전 안내 카드는 띄우지 않고(탭 2번 안에 판 시작), 아직 안내를 보지
 * 않은 기기면 그 판의 처음 10초 위치 표시만 한다. 본 기록은 남기지 않는다(방 · 빠른 매칭에서 안내 카드를 그대로 본다)
 */
export function requestTouchHints(): void {
  hintsPending = true;
}

/** 판 장면이 시작할 때 한 번 부른다: 이번 판에 위치 표시를 할지 (읽으면 꺼진다) */
export function takeTouchHints(): boolean {
  const v = hintsPending;
  hintsPending = false;
  return v;
}

/** 로비 설정의 '조작 안내 다시 보기': 다음 판 직전에 다시 보인다 */
export function resetTouchTutorial(): void {
  shownThisSession = false;
  removeKey('touchTutorial');
}
