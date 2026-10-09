// 기기 감지 (M11, MOBILE_PLAN M11 3번): 터치 모드 · 세로 화면 · 브라우저 안인지.
// 터치 모드 = ?touch=1|0이 있으면 그 값, 없으면 (pointer: coarse) 그리고 (hover: none).
// 헤드리스 에뮬레이션은 navigator.maxTouchPoints가 1이라 그 값은 쓰지 않는다.

export interface DeviceEnv {
  /** ?touch 값 ('1' · '0', 없으면 null) */
  touchParam: string | null;
  /** matchMedia('(pointer: coarse)') */
  coarse: boolean;
  /** matchMedia('(hover: none)') */
  hoverNone: boolean;
}

/** 터치 모드인가 (구현: M11 갈래 B) */
export function detectTouchMode(env: DeviceEnv): boolean {
  if (env.touchParam === '1') return true;
  if (env.touchParam === '0') return false;
  return env.coarse && env.hoverNone;
}

/** 부팅 때 정하고(main.ts) 판 중 읽는 기기 상태 */
export const device = {
  /** 터치 화면을 만든다 */
  touch: false,
  /** 세로 화면 (터치 모드에서 입력을 보내지 않는다) */
  portrait: false,
  /** 브라우저 안 (설치 앱 · TWA가 아님): "전체 화면" 버튼을 보인다 */
  inBrowser: true,
};
