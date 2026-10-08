// '서버 깨우는 중' 안내 패널 (로비 · 판 화면 위). 상태는 ../wakeNotice.ts
import logoUrl from '../../../docs/images/logo_decoy.png';
import { UI_TEXT } from '../data/storyText';
import type { WakeView } from '../wakeNotice';

export class WakeNoticeUI {
  private readonly root: HTMLDivElement;
  private readonly logo: HTMLImageElement;
  private readonly title: HTMLDivElement;
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
    this.logo.alt = 'DECOY 로고';
    this.logo.className = 'wake-logo';
    this.title = document.createElement('div');
    this.title.className = 'wake-title';
    const body = document.createElement('div');
    body.className = 'wake-body';
    body.textContent = UI_TEXT.wakingBody;
    this.elapsed = document.createElement('div');
    this.elapsed.className = 'wake-elapsed';
    this.root.append(this.logo, this.title, body, this.elapsed);
    host.appendChild(this.root);
  }

  render(view: WakeView): void {
    const key = view.visible ? `${view.variant}:${view.seconds}` : 'hidden';
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!view.visible) {
      this.root.style.display = 'none';
      return;
    }
    this.logo.style.display = view.variant === 'waking' ? '' : 'none';
    this.title.textContent = view.variant === 'waking' ? UI_TEXT.wakingTitle : UI_TEXT.reconnectingTitle;
    this.elapsed.textContent = UI_TEXT.wakingElapsed.replace('{n}', String(view.seconds));
    this.root.style.display = '';
  }
}
