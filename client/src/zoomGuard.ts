// 화면 확대 막기 · 감지 · 복구 (플레이테스트 반영 a-1, docs/PLAYTEST_PLAN.md a절 1번).
// 아이폰은 viewport의 user-scalable=no를 무시한다. 그래서 세 겹으로 막는다
//  ① CSS(style.css): 터치 모드의 html · body가 touch-action: none, 스크롤 컨테이너만 pan-y
//  ② 이 파일의 문서 리스너: 손가락 2개 이상의 touchstart · touchmove, 사파리 gesture*, 버튼류 밖 빠른 두 번째 탭의 touchend를 막는다
//  ③ 그래도 확대됐으면(visualViewport.scale): ① · ②를 풀어 오므릴 수 있게 하고(html.zoomed), 조작을 멈추고, 보이는 화면에 맞춘
//     안내를 띄운다(ui/zoomNotice.ts). 배율이 돌아와 ZOOM_RELEASE_MS 동안 그대로면 닫고 다시 막는다
// 판단은 순수 함수이고, 리스너는 주입받은 문서 · visualViewport에만 단다 (tests/unit/zoom-guard.test.ts). 판정 · 서버와 무관하다

/** 배율 허용 오차: 1에서 이만큼까지는 확대가 아니다 (오므린 뒤 남는 값 · 부동소수) */
export const ZOOM_EPS = 0.02;
/** 두 번 탭으로 보는 간격 (ms) */
export const DOUBLE_TAP_MS = 300;
/** 두 번 탭으로 보는 거리 (CSS px) */
export const DOUBLE_TAP_PX = 30;
/** 배율이 돌아온 뒤 이만큼 그대로여야 푼다 (ms): 오므리는 도중 1 근처를 오가며 안내가 깜박이지 않게 */
export const ZOOM_RELEASE_MS = 150;
/**
 * 두 번째 탭을 막지 않는 대상(누르는 것). touchend를 막으면 그 탭의 click도 사라지므로, 빠르게 두 번 누르는 버튼(옷장 해금 확인 ·
 * 고르는 칸)은 그대로 둔다 — 이 대상의 두 번 탭 확대는 CSS touch-action(manipulation · 뿌리 none)이 막는다
 */
export const TAP_KEEP = 'button, a, input, select, textarea, label';

/**
 * 확대됐는가. 1보다 클 때만이다: 1보다 작은 배율은 손가락 확대가 아니라 넓은 배치 뷰포트를 화면에 맞춰 줄여 보이는 것이다
 * (Chromium 실측: 배치 폭 980 · 화면 폭 844면 쉬는 배율 0.861 — 브라우저의 '데스크톱 사이트' 보기가 그런 경우로 보인다).
 * 그때는 화면이 잘리지 않아 조작할 수 있고, 안내를 띄우면 오므려도 1이 되지 않아 닫을 길이 없다
 */
export function isZoomed(scale: number): boolean {
  return scale > 1 + ZOOM_EPS;
}

/** 이 touchstart · touchmove를 막을까: 손가락 2개 이상(핀치). 확대된 동안에는 막지 않는다 — 오므려 되돌려야 한다 */
export function blocksTouches(count: number, zoomed: boolean): boolean {
  return !zoomed && count > 1;
}

/** 손가락이 모두 떨어진 순간 (ms · 창 CSS px) */
export interface Tap {
  t: number;
  x: number;
  y: number;
}

/** 앞 탭에 이은 두 번째 탭인가 (DOUBLE_TAP_MS 안 · DOUBLE_TAP_PX 안) */
export function isDoubleTap(prev: Tap | null, cur: Tap): boolean {
  return (
    prev !== null &&
    cur.t - prev.t < DOUBLE_TAP_MS &&
    Math.hypot(cur.x - prev.x, cur.y - prev.y) < DOUBLE_TAP_PX
  );
}

/** 이 touchend를 막을까 (두 번 탭 확대): 두 번째 탭이고, 누르는 것(TAP_KEEP) 위가 아니고, 확대된 동안이 아니다 */
export function blocksTap(prev: Tap | null, cur: Tap, onControl: boolean, zoomed: boolean): boolean {
  return !zoomed && !onControl && isDoubleTap(prev, cur);
}

/** 보이는 화면 (window.visualViewport에서 쓰는 값. 길이는 배치 CSS px) */
export interface ViewBox {
  scale: number;
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

/**
 * 안내 층(position: fixed · left 0 · top 0 · transform-origin 0 0)을 보이는 화면에 꼭 맞게 놓는 값. fixed는 배치 뷰포트 기준이라
 * 그대로 두면 확대된 화면 밖에 걸친다. 상자 크기는 보이는 크기 × 배율(= 확대 전 화면 크기)로 잡고 1/배율로 줄여 보이는 자리로 옮긴다
 * → 화면에는 확대 전과 같은 크기로 보인다
 */
export function noticeBox(v: ViewBox): { width: number; height: number; transform: string } {
  return {
    width: v.width * v.scale,
    height: v.height * v.scale,
    transform: `translate(${v.offsetLeft}px,${v.offsetTop}px) scale(${1 / v.scale})`,
  };
}

/** 리스너를 다는 곳 (document · visualViewport. 단위 시험은 EventTarget을 넘긴다) */
export interface ZoomListens {
  addEventListener(type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void;
}

export interface ZoomGuardEnv {
  /** 터치 · 제스처를 막는 리스너를 다는 곳 (document). null이면 막지 않고 감지만 한다 (?zoomguard=0) */
  doc: ZoomListens | null;
  /** window.visualViewport. 없으면 감지하지 않는다 (막기만) */
  view: (ViewBox & ZoomListens) | null;
  /** 확대 상태가 바뀌었다 */
  onChange(zoomed: boolean): void;
  /** 확대된 동안 보이는 화면이 정해졌다 · 바뀌었다 (안내를 그 자리에 놓는다) */
  onView(view: ViewBox): void;
  /** ms 뒤 fn. 반환값은 취소 */
  later(fn: () => void, ms: number): () => void;
}

/** 누르는 것(TAP_KEEP) 위인가. 터치 대상이 글자 노드일 수 있어(옛 WebKit) 부모 요소에서 찾는다 */
function onControl(target: EventTarget | null): boolean {
  const n = target as Partial<Element> | null;
  const el = typeof n?.closest === 'function' ? n : n?.parentElement;
  return (el?.closest?.(TAP_KEEP) ?? null) !== null;
}

/**
 * 막기 리스너(②)와 확대 감지(③)를 건다. 부팅 때 한 번, 터치 모드에서만 (ui/zoomNotice.ts startZoomGuard).
 * 리스너는 캡처 단계 · passive: false다 — 문서 수준 터치 리스너는 기본이 passive라 적지 않으면 preventDefault가 무시된다
 */
export function installZoomGuard(env: ZoomGuardEnv): { readonly zoomed: boolean } {
  let zoomed = false;
  let lastTap: Tap | null = null;
  /** 풀기를 기다리는 타이머의 취소 (없으면 null) */
  let pending: (() => void) | null = null;

  const set = (on: boolean): void => {
    zoomed = on;
    env.onChange(on);
  };
  const view = env.view;
  const sync = (): void => {
    if (!view) return;
    if (isZoomed(view.scale)) {
      pending?.();
      pending = null;
      if (!zoomed) set(true);
    } else if (zoomed && !pending) {
      pending = env.later(() => {
        pending = null;
        if (!isZoomed(view.scale)) set(false);
      }, ZOOM_RELEASE_MS);
    }
    if (zoomed) env.onView(view);
  };
  view?.addEventListener('resize', sync);
  view?.addEventListener('scroll', sync);

  const doc = env.doc;
  if (doc) {
    const opts: AddEventListenerOptions = { capture: true, passive: false };
    const multi = (e: Event): void => {
      if (e.cancelable && blocksTouches((e as TouchEvent).touches.length, zoomed)) e.preventDefault();
    };
    doc.addEventListener('touchstart', multi, opts);
    doc.addEventListener('touchmove', multi, opts);
    // WebKit에만 있는 핀치 이벤트
    const gesture = (e: Event): void => {
      if (e.cancelable && !zoomed) e.preventDefault();
    };
    for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
      doc.addEventListener(type, gesture, opts);
    doc.addEventListener(
      'touchend',
      (ev) => {
        const e = ev as TouchEvent;
        const c = e.changedTouches[0];
        if (e.touches.length > 0 || !c) return;
        const tap: Tap = { t: e.timeStamp, x: c.clientX, y: c.clientY };
        if (e.cancelable && blocksTap(lastTap, tap, onControl(e.target), zoomed)) e.preventDefault();
        lastTap = tap;
      },
      opts,
    );
  }
  // 불러오는 동안(스크립트가 돌기 전) 이미 확대됐을 수 있다
  sync();
  return {
    get zoomed() {
      return zoomed;
    },
  };
}
