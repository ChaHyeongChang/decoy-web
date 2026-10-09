// 기기 감지 (M11, MOBILE_PLAN M11 3 · 6번): 터치 모드 · 세로 화면 · 브라우저 안인지, 그리고 전체 화면 + 가로 고정.
// 터치 모드 = ?touch=1|0이 있으면 그 값, 없으면 (pointer: coarse) 그리고 (hover: none).
// 헤드리스 에뮬레이션은 navigator.maxTouchPoints가 1이라 그 값은 쓰지 않는다.
// 판단은 순수 함수(detectTouchMode · detectInBrowser)이고, 창 · 문서는 initDevice와 enterFullscreen만 만진다.

export interface DeviceEnv {
  /** ?touch 값 ('1' · '0', 없으면 null) */
  touchParam: string | null;
  /** matchMedia('(pointer: coarse)') */
  coarse: boolean;
  /** matchMedia('(hover: none)') */
  hoverNone: boolean;
}

/** 터치 모드인가 */
export function detectTouchMode(env: DeviceEnv): boolean {
  if (env.touchParam === '1') return true;
  if (env.touchParam === '0') return false;
  return env.coarse && env.hoverNone;
}

/**
 * 브라우저 탭 안인가 (설치 앱 · TWA가 아님): display-mode standalone · fullscreen이면 앱이다(iOS 홈 화면 앱은
 * navigator.standalone). 부팅 때 한 번 정한다 — 전체 화면 API로 들어간 탭도 display-mode fullscreen이 되기 때문
 */
export function detectInBrowser(m: {
  standalone: boolean;
  fullscreen: boolean;
  iosStandalone: boolean;
}): boolean {
  return !(m.standalone || m.fullscreen || m.iosStandalone);
}

/**
 * 세로 안내를 띄우고 입력을 막는 조건. style.css의 세로 안내(.rotate-notice)와 같은 미디어 쿼리다
 * (터치 화면이면 태블릿도 포함, PC 좁은 창에서는 아님)
 */
export const PORTRAIT_QUERY = '(orientation: portrait) and (pointer: coarse)';

/** 부팅 때 정하고(main.ts initDevice) 판 중 읽는 기기 상태 */
export const device = {
  /** 터치 화면을 만든다 */
  touch: false,
  /** 세로 화면 (터치 모드에서 입력을 보내지 않는다) */
  portrait: false,
  /** 브라우저 안 (설치 앱 · TWA가 아님): "전체 화면" 버튼을 보인다 */
  inBrowser: true,
};

const listeners = new Set<() => void>();

/** 세로 ↔ 가로가 바뀌면 부른다. 반환값을 부르면 구독을 끝낸다 */
export function onDeviceChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function media(query: string): MediaQueryList | null {
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/**
 * 부팅 때 한 번 (main.ts): device 값을 정하고 세로 여부 변화를 구독한다.
 * 문서 루트에 touch 클래스(터치 모드, 확인용) · fs 클래스(전체 화면 중 — CSS가 전체 화면 버튼을 숨긴다)를 단다
 */
export function initDevice(touchParam: string | null): void {
  const on = (q: string): boolean => media(q)?.matches === true;
  device.touch = detectTouchMode({
    touchParam,
    coarse: on('(pointer: coarse)'),
    hoverNone: on('(hover: none)'),
  });
  device.inBrowser = detectInBrowser({
    standalone: on('(display-mode: standalone)'),
    fullscreen: on('(display-mode: fullscreen)'),
    iosStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
  const root = document.documentElement;
  root.classList.toggle('touch', device.touch);
  const portrait = media(PORTRAIT_QUERY);
  const sync = (): void => {
    const next = portrait?.matches === true;
    if (next === device.portrait) return;
    device.portrait = next;
    for (const fn of listeners) fn();
  };
  device.portrait = portrait?.matches === true;
  // 오래된 사파리(13 이하)에는 addEventListener가 없다. 그때는 창 크기 변화로 따라간다
  if (portrait && typeof portrait.addEventListener === 'function') portrait.addEventListener('change', sync);
  window.addEventListener('resize', sync);
  document.addEventListener('fullscreenchange', () =>
    root.classList.toggle('fs', Boolean(document.fullscreenElement)),
  );
}

/** "전체 화면" 버튼을 보일까: 터치 모드 · 브라우저 안 · 전체 화면 API가 있음 (아이폰 사파리는 없다) */
export function canOfferFullscreen(): boolean {
  return device.touch && device.inBrowser && document.fullscreenEnabled === true;
}

type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

/**
 * 전체 화면 + 가로 고정. **사용자 탭 핸들러 안에서만** 부른다(로비의 준비 · 코드 입장, 판 안 터치 레이어의 첫 탭,
 * "전체 화면" 버튼). 서버 메시지(판 시작)에서 부르면 브라우저가 거부한다. 이미 전체 화면이거나 터치 모드 · 브라우저 안이
 * 아니면 아무것도 하지 않는다. 실패는 조용히 넘긴다(방향 고정은 전체 화면에서만 되는 브라우저가 많다)
 */
export function enterFullscreen(): void {
  if (!device.touch || !device.inBrowser || document.fullscreenElement) return;
  const el = document.documentElement;
  if (typeof el.requestFullscreen !== 'function') return;
  try {
    void Promise.resolve(el.requestFullscreen({ navigationUI: 'hide' }))
      .then(() => (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape'))
      .catch(() => undefined);
  } catch {
    // 동기 예외(권한 정책 등)도 조용히
  }
}
