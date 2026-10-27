// '내 기록' 창 받기 (메타 b, DECISIONS 14절 '나눠 받기'): 창 코드(ui/hub.ts)는 첫 화면에 필요 없어 나눠 받는 조각이다.
// 칩을 누르면 받고 연다(누르기 전 쉬는 시간에 미리 받아 둔다). 받지 못하면 "새 버전이 있어요"
import type { MetaState } from '../meta/meta';
import type * as HubModuleNs from './hub';

type HubModule = typeof HubModuleNs;
type HubView = InstanceType<HubModule['HubPanel']>;

export class HubHost {
  private view: HubView | null = null;
  private loading: Promise<HubModule | null> | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly meta: MetaState,
    private readonly onLoadFailed: () => void,
  ) {}

  prefetch(): void {
    void this.load();
  }

  private load(): Promise<HubModule | null> {
    this.loading ??= import('./hub').catch(() => {
      this.loading = null;
      return null;
    });
    return this.loading;
  }

  open(): void {
    void this.load().then((mod) => {
      if (!mod) {
        this.onLoadFailed();
        return;
      }
      this.view ??= new mod.HubPanel(this.host, this.meta);
      this.view.open();
    });
  }

  close(): void {
    this.view?.close();
  }
}
