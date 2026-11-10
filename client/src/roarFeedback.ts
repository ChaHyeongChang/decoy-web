// 포효 결과 알림 (괴물 화면, 순수): 서버가 보낸 roarPings 이벤트의 자리 수 하나로 글을 고른다. 이 수는 화면에 그리는 핑 수와
// 같은 값이다(창 안 핑 + 창 밖 화살표 = 미니맵 핑 = 소리 핑). 누가 드러났는지 · 역할 · 상태는 받지 않는다(서버도 보내지 않는다)
import { UI_TEXT } from './data/storyText';

/** 포효 결과 한 줄: found = 드러난 자리 수 (pts.length). 0이면 '근처에 아무도 없다.' */
export function roarResultText(found: number): string {
  return found > 0 ? UI_TEXT.roarFound.replace('{n}', String(found)) : UI_TEXT.roarNone;
}
