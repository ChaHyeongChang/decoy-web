// 결과 화면 받기 (GAME_DESIGN 12장 · DECISIONS 14절 '나눠 받기'): 결과 화면 코드(ui/result.ts + 내 평가 resultRating.ts)는
// 첫 화면에 필요 없어 첫 묶음에서 뺀 조각이다. 첫 화면을 그린 뒤 쉬는 시간에 미리 받아 두고(prefetch — 판 중에는 받지 않는다),
// 결과가 왔는데 아직이면 그때 받는다. 받지 못하면(배포 직후 옛 화면이 사라진 조각을 찾는 경우 등) 승리 팀 · 버튼만 있는 작은
// 결과를 그리고 "새 버전이 있어요"를 띄운다 — 결과 화면에서 갇히지 않게
import type { MatchResult, Role } from '@decoy/shared';
import { UI_TEXT } from '../data/storyText';
import type { RatingApplied } from '../meta/meta';
import type * as ResultModuleNs from './result';
import { h, icon } from './uiArt';

type ResultModule = typeof ResultModuleNs;
type ResultView = InstanceType<ResultModule['ResultUI']>;

export class ResultHost {
  private view: ResultView | null = null;
  private loading: Promise<ResultModule | null> | null = null;
  /** show · hide마다 올린다: 받는 동안 숨겼거나 다른 결과가 오면 늦게 끝난 받기는 버린다 */
  private turn = 0;
  private fallback: HTMLElement | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly onRematch: () => void,
    private readonly onHome: () => void,
    /** 조각을 받지 못했다 ("새 버전이 있어요") */
    private readonly onLoadFailed: () => void,
  ) {}

  /** 미리 받기 (첫 화면을 그린 뒤 쉬는 시간) */
  prefetch(): void {
    void this.load();
  }

  private load(): Promise<ResultModule | null> {
    this.loading ??= import('./result').catch(() => {
      // 다음에 다시 시도할 수 있게 비운다
      this.loading = null;
      return null;
    });
    return this.loading;
  }

  show(r: MatchResult, myRole: Role | null, rated: Promise<RatingApplied> | null): void {
    const turn = ++this.turn;
    void this.load().then((mod) => {
      if (turn !== this.turn) return;
      if (!mod) {
        this.onLoadFailed();
        this.showFallback(r);
        return;
      }
      this.view ??= new mod.ResultUI(this.host, this.onRematch, this.onHome);
      this.view.show(r, myRole, rated);
    });
  }

  hide(): void {
    this.turn += 1;
    this.view?.hide();
    this.fallback?.remove();
    this.fallback = null;
  }

  /** 조각 없이 그리는 작은 결과: 승리 팀 + 홈으로 · 다시 하기 (한 번만 눌린다) */
  private showFallback(r: MatchResult): void {
    this.fallback?.remove();
    const winner =
      r.winner === 'survivors'
        ? UI_TEXT.winSurvivors
        : r.winner === 'monster'
          ? UI_TEXT.winMonster
          : UI_TEXT.winVoid;
    const again = h(
      'button',
      { class: 'btn btn-primary', 'data-testid': 'rematch' },
      icon('replay', 20),
      UI_TEXT.rematch,
    );
    const home = h('button', { class: 'btn', 'data-testid': 'result-home' }, icon('back', 20), UI_TEXT.home);
    const once = (b: HTMLButtonElement, action: () => void): void => {
      b.addEventListener('click', () => {
        if (again.disabled) return;
        again.disabled = true;
        home.disabled = true;
        action();
      });
    };
    once(again, this.onRematch);
    once(home, this.onHome);
    this.fallback = h(
      'div',
      { class: 'result', 'data-testid': 'result' },
      h(
        'div',
        { class: 'panel result-box' },
        h('div', { class: `result-winner result-${r.winner}`, 'data-testid': 'result-winner' }, winner),
        h('div', { class: 'result-foot' }, home, again),
      ),
    );
    this.host.appendChild(this.fallback);
  }
}
