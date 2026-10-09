// 첫 실행 터치 안내 (M12 5번): 판 직전 안내 한 번 → 그 판에만 위치 표시, 다시 보기로 되돌림.
// 단위 테스트 환경(node)에는 저장소가 없다: 저장소가 막힌 브라우저처럼 이번 접속 기억만으로 동작해야 한다
import { describe, expect, it } from 'vitest';
import {
  TOUCH_HINT_MS,
  markTouchTutorialShown,
  resetTouchTutorial,
  takeTouchHints,
  touchTutorialNeeded,
} from '../../client/src/touchTutorial';

describe('터치 안내', () => {
  it('처음이면 보이고, 보인 뒤에는 그 판에만 위치 표시', () => {
    expect(TOUCH_HINT_MS).toBe(10_000);
    expect(touchTutorialNeeded()).toBe(true);
    expect(takeTouchHints()).toBe(false);
    markTouchTutorialShown();
    expect(touchTutorialNeeded()).toBe(false);
    expect(takeTouchHints()).toBe(true);
    expect(takeTouchHints()).toBe(false);
  });

  it('다시 보기를 누르면 다음 판 전에 다시 보인다', () => {
    markTouchTutorialShown();
    takeTouchHints();
    resetTouchTutorial();
    expect(touchTutorialNeeded()).toBe(true);
  });
});
