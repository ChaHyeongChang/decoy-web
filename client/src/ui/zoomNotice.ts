// 확대 안내 (플레이테스트 반영 a-1, zoomGuard.ts의 ③): 화면이 확대된 동안 보이는 화면에 맞춰 뜨는 한 줄 + '새로고침'.
// 세로 안내(index.html .rotate-notice)와 같은 규칙이다 — 조작은 멈추고(device.zoomed → 터치 화면 · 판 장면이 세로 화면과 같은
// 길로 손가락 · 입력을 비운다) 판은 흐른다. 모양은 생명주기 화면과 같은 깎은 패널 · 버튼(lifecycle.css), 문구는 storyText.ts.
// 세로 안내(z 80)보다 위다: 세로 안내는 touch-action: none이라 그 위에서는 오므릴 수 없다. 처음 확대될 때 한 번 만든다
import { TOUCH_TEXT, UI_TEXT } from '../data/storyText';
import { setZoomed } from '../device';
import { installZoomGuard, noticeBox } from '../zoomGuard';
import { h, icon } from './uiArt';
import './lifecycle.css';

function buildNotice(): HTMLDivElement {
  const reload = h(
    'button',
    { class: 'btn', type: 'button', 'data-testid': 'zoom-reload' },
    icon('replay', 18),
    UI_TEXT.updateReload,
  );
  // 오므려도 그대로일 때의 길: 같은 주소를 새로 연다 (온라인 판은 재접속 유예 안에 같은 자리로 돌아온다).
  // location.reload()가 아니다 — 크롬은 다시 불러올 때 확대 배율까지 되살린다(실측: 3.7배 → reload 뒤에도 3.7배, replace 뒤 1배)
  reload.addEventListener('click', () =>
    window.location.replace(window.location.pathname + window.location.search),
  );
  return h(
    'div',
    { class: 'zoom-notice', role: 'alert', 'data-testid': 'zoom-notice' },
    h('div', { class: 'panel zoom-card' }, h('p', { class: 'zoom-text' }, TOUCH_TEXT.zoomNotice), reload),
  );
}

/**
 * 확대 막기 · 감지를 켠다 (main.ts, 터치 모드에서만 부팅 때 한 번).
 * ?zoomguard=0은 진단용이다: 막기(CSS 뿌리 규칙 · 문서 리스너)만 끄고 감지 · 안내는 그대로 둔다 — 막기가 잘 되면 사람이 확대
 * 상태를 만들 수 없어서, 실기기에서 안내 · 복구를 확인할 때 쓴다 (docs/HUMAN_CHECKS.md). 판정 · 정보와 무관해 배포 주소에서도 받는다
 */
export function startZoomGuard(): void {
  const root = document.documentElement;
  const guard = new URLSearchParams(window.location.search).get('zoomguard') !== '0';
  if (!guard) {
    root.style.touchAction = 'auto';
    document.body.style.touchAction = 'auto';
  }
  let el: HTMLDivElement | null = null;
  installZoomGuard({
    doc: guard ? document : null,
    view: window.visualViewport ?? null,
    onChange(zoomed) {
      // html.zoomed: style.css의 뿌리 touch-action: none이 풀린다 (오므려 되돌릴 수 있게)
      root.classList.toggle('zoomed', zoomed);
      setZoomed(zoomed);
      if (zoomed) {
        el ??= buildNotice();
        document.body.append(el);
      } else {
        el?.remove();
        // 확대된 동안 창 크기 값이 달랐을 수 있다(iOS): 터치 배치 · 캔버스 자리 · 세로 판정을 지금 크기로 다시 맞춘다
        window.dispatchEvent(new Event('resize'));
      }
    },
    onView(view) {
      if (!el) return;
      const box = noticeBox(view);
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.style.transform = box.transform;
    },
    later(fn, ms) {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
  });
}
