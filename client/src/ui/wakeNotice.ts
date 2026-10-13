// '서버 깨우는 중' 안내 패널 (로비 · 판 화면 위). 상태는 ../wakeNotice.ts
// 모양(M10c): 깎은 모서리 유리 패널 + 진행 띠. 로고는 작은 크기라 원본 PNG, 기기 픽셀 배율 2 이상이면 SVG
import logoUrl from '../../../docs/images/logo_decoy.png';
import { UI_TEXT } from '../data/storyText';
import type { WakeView } from '../wakeNotice';
import { LOGO_SVG_URL } from './uiArt';

export class WakeNoticeUI {
  private readonly root: HTMLDivElement;
  private readonly logo: HTMLImageElement;
  private readonly title: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly elapsed: HTMLDivElement;
  /** '첫 화면으로' (방 경로로 부팅해 기다리는 중에만, 검토 반영 F23 — 오프라인 · 서버 꺼짐에서 갇히지 않게) */
  private readonly home: HTMLButtonElement;
  private lastKey = '';

  constructor(host: HTMLElement, onHome: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'wake-notice';
    this.root.setAttribute('data-testid', 'server-waking');
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.display = 'none';
    // 처음 접속할 때는 로비 대신 보이는 화면이라 로고를 같이 보여 준다
    this.logo = document.createElement('img');
    this.logo.src = logoUrl;
    this.logo.srcset = `${logoUrl} 1x, ${LOGO_SVG_URL} 2x`;
    this.logo.alt = 'DECOY 로고';
    this.logo.className = 'wake-logo';
    this.title = document.createElement('div');
    this.title.className = 'wake-title';
    const body = document.createElement('div');
    body.className = 'wake-body';
    body.textContent = UI_TEXT.wakingBody;
    this.body = body;
    const bar = document.createElement('div');
    bar.className = 'wake-bar';
    bar.setAttribute('aria-hidden', 'true');
    this.elapsed = document.createElement('div');
    this.elapsed.className = 'wake-elapsed';
    // 매초 바뀌는 숫자 때문에 스크린 리더가 안내 전체를 계속 다시 읽지 않게
    this.elapsed.setAttribute('aria-hidden', 'true');
    this.home = document.createElement('button');
    this.home.type = 'button';
    this.home.className = 'btn wake-home';
    this.home.setAttribute('data-testid', 'wake-home');
    this.home.textContent = UI_TEXT.wakeHome;
    this.home.hidden = true;
    this.home.addEventListener('click', onHome);
    this.root.append(this.logo, this.title, body, bar, this.elapsed, this.home);
    host.appendChild(this.root);
  }

  /** canGoHome: '첫 화면으로'를 보인다 (판단은 wakeOffersHome) */
  render(view: WakeView, canGoHome = false): void {
    const key = view.visible ? `${view.variant}:${view.seconds}:${view.offline}:${canGoHome}` : 'hidden';
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!view.visible) {
      this.root.style.display = 'none';
      return;
    }
    this.logo.style.display = view.variant === 'waking' ? '' : 'none';
    this.title.textContent = view.variant === 'waking' ? UI_TEXT.wakingTitle : UI_TEXT.reconnectingTitle;
    // 오프라인이면 서버가 잠든 것이 아니라 기기 연결 문제다 (wake.html과 같은 문구)
    this.body.textContent = view.offline ? UI_TEXT.offline : UI_TEXT.wakingBody;
    this.elapsed.textContent = UI_TEXT.wakingElapsed.replace('{n}', String(view.seconds));
    this.home.hidden = !canGoHome;
    this.root.style.display = '';
  }
}
