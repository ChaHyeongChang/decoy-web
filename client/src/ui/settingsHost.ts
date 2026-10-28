// 설정 화면 받기 (번들 줄이기, DECISIONS 11절 '번들 줄이기'): 설정 화면 코드(ui/settingsPanel.ts)는 나눠 받는 조각 'settings'다.
// 첫 화면 · 방 화면의 '설정' 단추와 판 중 메뉴(main.ts matchMenu)는 이 껍데기만 안다.
//  - 판 밖 쉬는 시간에 조각을 받고 DOM까지 만들어 둔다(prefetch — main.ts schedulePrebake): 판 중에 처음 열 때 받거나 DOM을
//    만드느라 멈칫하지 않게. 판 중에는 받지 않는다
//  - 열기를 눌렀는데 아직이면 받은 뒤 연다. 그사이 닫거나 판이 시작하면(로비 설정 닫기) 열지 않는다. 받는 동안도 '열림'으로 친다
//    (판 장면이 그동안 입력을 받지 않게 — 연 사람의 뜻대로)
//  - 받지 못하면(새 배포로 옛 조각이 사라진 옛 화면, 서비스 워커 캐시도 없을 때) "새 버전이 있어요"
// CSS(settings.css · layoutEditor.css)는 여기서 불러 첫 CSS에 둔다 — 조각이 오기 전 · 온 뒤 스타일이 바뀌어 깜박이지 않게
import { APP_TEXT } from '../data/storyText';
import type { SettingsContext, TabId } from '../settingsModel';
import { loadLayoutEditor } from './layoutEditorLoader';
import type * as SettingsPanelNs from './settingsPanel';
import type { SettingsEnv, SettingsPanel } from './settingsPanel';
import { h, icon } from './uiArt';
import './settings.css';
import './layoutEditor.css';

type SettingsModule = typeof SettingsPanelNs;

export class SettingsHost {
  private panel: SettingsPanel | null = null;
  private loading: Promise<SettingsModule | null> | null = null;
  /** 받는 중에 연 요청 (받으면 연다). 닫으면 지운다 */
  private pending: { ctx: SettingsContext; tab?: TabId } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly env: SettingsEnv,
    private readonly onLoadFailed: () => void,
  ) {}

  /** 열려 있는가 (받는 중인 열기 포함) */
  get isOpen(): boolean {
    return this.panel?.isOpen === true || this.pending !== null;
  }

  /** 지금 연 곳 (판 · 로비). 열린 적이 없으면 'lobby' */
  get context(): SettingsContext {
    return this.pending?.ctx ?? this.panel?.context ?? 'lobby';
  }

  /** 조각을 받아 화면을 만들어 둔다 (판 밖 쉬는 시간) */
  prefetch(): void {
    void this.load().then((mod) => {
      if (mod) this.ensure(mod);
    });
  }

  /**
   * 로비 화면의 '설정' 단추 (화면을 다시 그릴 때마다 새로 만든다 — 방 화면은 로비 상태가 올 때마다 다시 그려진다).
   * 누르면 로비 설정을 연다
   */
  button(): HTMLButtonElement {
    const b = h(
      'button',
      {
        class: 'btn life-gear',
        type: 'button',
        'aria-haspopup': 'dialog',
        'data-testid': 'settings-button',
      },
      icon('sliders', 18),
      APP_TEXT.settings,
    );
    b.addEventListener('click', () => this.open('lobby'));
    return b;
  }

  /** 연다. ctx = 'match'면 그래픽 · 화면 · 소리 탭만 (settingsPanel.ts open) */
  open(ctx: SettingsContext, tab?: TabId): void {
    // 로비 설정의 조작 탭(터치)에서 여는 배치 편집 조각도 미리 받는다
    if (ctx === 'lobby' && this.env.touch) void loadLayoutEditor();
    if (this.panel) {
      this.panel.open(ctx, tab);
      return;
    }
    this.pending = tab === undefined ? { ctx } : { ctx, tab };
    void this.load().then((mod) => {
      const want = this.pending;
      if (!want) return;
      this.pending = null;
      if (!mod) {
        this.onLoadFailed();
        this.env.onClose?.();
        return;
      }
      this.ensure(mod).open(want.ctx, want.tab);
    });
  }

  close(): void {
    if (this.pending) {
      this.pending = null;
      this.env.onClose?.();
    }
    this.panel?.close();
  }

  private ensure(mod: SettingsModule): SettingsPanel {
    this.panel ??= new mod.SettingsPanel(this.host, this.env);
    return this.panel;
  }

  private load(): Promise<SettingsModule | null> {
    this.loading ??= import('./settingsPanel').catch(() => {
      this.loading = null;
      return null;
    });
    return this.loading;
  }
}
