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
  private lastKey = '';

  constructor(host: HTMLElement) {
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
    this.root.append(this.logo, this.title, body, bar, this.elapsed);
    host.appendChild(this.root);
  }

  render(view: WakeView): void {
    const key = view.visible ? `${view.variant}:${view.seconds}:${view.offline}` : 'hidden';
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
    this.root.style.display = '';
  }
}
