// '내 기록' 창 받기 (메타 b, DECISIONS 14절 '나눠 받기'): 창 코드(ui/hub.ts)는 첫 화면에 필요 없어 나눠 받는 조각이다.
// 칩을 누르면 받고 연다(누르기 전 쉬는 시간에 미리 받아 둔다). 받지 못하면 "새 버전이 있어요"
import type { MetaState } from '../meta/meta';
import type * as HubModuleNs from './hub';

type HubModule = typeof HubModuleNs;
type HubView = InstanceType<HubModule['HubPanel']>;

export class HubHost {
  private view: HubView | null = null;
  private loading: Promise<HubModule | null> | null = null;
  /** 연 요청 번호: 조각을 받는 사이 닫으면(판 시작) 받은 뒤에 열지 않는다 */
  private openReq = 0;

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
    const req = ++this.openReq;
    void this.load().then((mod) => {
      if (req !== this.openReq) return;
      if (!mod) {
        this.onLoadFailed();
        return;
      }
      this.view ??= new mod.HubPanel(this.host, this.meta);
      this.view.open();
    });
  }

  /** 닫는다 (받는 중인 열기도 취소 — 판이 시작되면 창이 판을 가리지 않게) */
  close(): void {
    this.openReq += 1;
    this.view?.close();
  }
}
