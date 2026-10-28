// 옷장 ('내 기록' 창의 옷장 탭, 메타 c, GAME_DESIGN 12.5 · VISUAL_SPEC 9.8): 생존자 · 괴물 의상 넷씩(기본 + 셋). 칸을 누르면
// 미리보기(정면 · 게임 화면 위 그림)가 바뀌고, 가진 의상은 '입기', 잠긴 의상은 불씨로 '해금'(두 번 눌러 확인). 결제 · 뽑기 · 광고 없음.
// 나눠 받는 조각(`wardrobe`) — 옷장 탭을 열 때 받는다. 의상 그림 조각(costume/art)도 그때 받아 미리보기를 다시 그린다
// 로그인했으면(선택형 구글 로그인) 해금 · 입기는 계정 API로 — 닿지 않으면 기록은 그대로 두고 "계정에 연결하지 못했어요" 한 줄
import {
  MONSTER_COSTUMES,
  SURVIVOR_COSTUMES,
  isMonsterCostume,
  isSurvivorCostume,
  type Role,
  type Team,
} from '@decoy/shared';
import { PROGRESSION, costumePrice, ownsCostume } from '@decoy/shared/meta';
import { MONSTER_ART, SURVIVOR_ART } from '../art/chars/index';
import { toSvg } from '../art/chars/kit';
import { MONSTER_REST, SURVIVOR_REST, type RoleCharId } from '../art/chars/types';
import { costumeArtReady } from '../art/chars/costume/registry';
import { loadCostumeArt } from '../art/costumeBake';
import { sfx } from '../audio';
import { ACCOUNT_TEXT } from '../data/accountText';
import { META_TEXT, ROLE_CARDS } from '../data/storyText';
import type { MetaState } from '../meta/meta';
import { EMBER_SVG, fillText } from './levelChip';
import { armAgainstDoubleTap } from './lobby';
import { frontFigureSvg, h, icon, roleVars, svgSpan, type FigureCostume } from './uiArt';

const ROLES: readonly RoleCharId[] = ['runner', 'guard', 'scout'];
const W = META_TEXT.wardrobe;

/** 게임 화면 위 그림 (앞이 위, 쉬는 자세). 판에서 보이는 모습 그대로 — 동료 화면도 같다 */
function topSvg(role: Role, costume: FigureCostume): string {
  const w = 0.07;
  const d =
    role === 'monster'
      ? MONSTER_ART.top(MONSTER_REST, { w, costume: isMonsterCostume(costume) ? costume : 'basic' })
      : SURVIVOR_ART[role].top(SURVIVOR_REST, { w, costume: isSurvivorCostume(costume) ? costume : 'basic' });
  return toSvg(d, { viewBox: [-1.3, -1.3, 2.6, 2.6], transform: [0, -1, 1, 0, 0, 0] });
}

function ember(): HTMLElement {
  const e = h('span', { class: 'lv-ember', 'aria-hidden': 'true' });
  e.innerHTML = EMBER_SVG;
  return e;
}

export class Wardrobe {
  readonly el = h('div', { class: 'wd', 'data-testid': 'wardrobe' });
  private team: Team = 'survivor';
  private role: RoleCharId = 'runner';
  /** 미리보는 의상 (처음엔 입은 것) */
  private pick: string | null = null;
  /** 해금 확인을 기다리는 의상 (한 번 누름) */
  private confirm: string | null = null;
  private notice = '';
  private busy = false;
  /** 해금 · 입기가 막 끝났다: 같은 자리에 새로 그린 단추(해금 뒤 '입기')도 잠깐 포인터를 막는다 */
  private armNext = false;

  constructor(private readonly meta: MetaState) {
    // 의상 그림 조각이 오면 미리보기를 다시 그린다 (못 받으면 기본 그림 — 해금 · 입기는 된다)
    if (!costumeArtReady()) void loadCostumeArt().then((ok) => ok && this.render());
  }

  render(): void {
    // 다시 그려도 키보드 포커스를 같은 단추(data-testid)에 둔다 (Enter로 해금 → Enter로 확인)
    const active = document.activeElement;
    const focusId =
      active instanceof HTMLElement && this.el.contains(active) ? active.getAttribute('data-testid') : null;
    const team = this.team;
    const p = this.meta.current;
    const worn = p.wear[team];
    const pick = this.pick ?? worn;
    const role: Role = team === 'monster' ? 'monster' : this.role;
    const ids = team === 'monster' ? MONSTER_COSTUMES : SURVIVOR_COSTUMES;

    const seg = (label: string, on: boolean, id: string, act: () => void): HTMLButtonElement => {
      const b = h(
        'button',
        { class: 'wd-seg', type: 'button', 'aria-pressed': String(on), 'data-testid': id },
        label,
      );
      b.addEventListener('click', () => {
        if (on) return;
        sfx.ui('tap');
        act();
        this.render();
      });
      return b;
    };
    const teams = h(
      'div',
      { class: 'wd-segs' },
      ...(['survivor', 'monster'] as const).map((t) =>
        seg(
          t === 'monster' ? META_TEXT.teamMonster : META_TEXT.teamSurvivor,
          t === team,
          `wd-team-${t}`,
          () => {
            this.team = t;
            this.pick = null;
            this.confirm = null;
            this.notice = '';
          },
        ),
      ),
      h('span', { class: 'hub-coins num', 'data-testid': 'hub-coins' }, ember(), String(p.coins)),
    );

    // 미리보기: 정면 + 게임 화면(위). 생존자는 역할을 바꿔 볼 수 있다
    const dress = pick as FigureCostume;
    const preview = h(
      'div',
      { class: 'wd-preview', style: roleVars(role), 'data-testid': 'wd-preview', 'data-costume': pick },
      svgSpan('wd-front', frontFigureSvg(role, true, dress)),
      h('span', { class: 'wd-top' }, svgSpan('wd-top-fig', topSvg(role, dress)), h('small', {}, W.inGame)),
    );
    const side = h('div', { class: 'wd-side' }, teams);
    if (team === 'survivor')
      preview.append(
        h(
          'div',
          { class: 'wd-segs wd-roles' },
          ...ROLES.map((r) =>
            seg(ROLE_CARDS[r].name, r === this.role, `wd-role-${r}`, () => {
              this.role = r;
            }),
          ),
        ),
      );

    // 의상 칸: 이름 + 상태(입는 중 ✓ · 가짐 · 잠김 자물쇠 + 불씨 값) — 색만으로 구분하지 않는다
    const grid = h('div', { class: 'wd-grid' });
    for (const id of ids) {
      const owned = ownsCostume(p, id);
      const price = costumePrice(team, id, PROGRESSION) ?? 0;
      const state =
        id === worn
          ? h('span', { class: 'wd-state on' }, icon('check', 14), W.wearing)
          : owned
            ? h('span', { class: 'wd-state' }, W.owned)
            : h(
                'span',
                { class: 'wd-state lock' },
                icon('prison', 14),
                ember(),
                h('span', { class: 'num' }, String(price)),
              );
      const tile = h(
        'button',
        {
          class: `wd-tile${id === pick ? ' sel' : ''}${owned ? '' : ' locked'}`,
          type: 'button',
          'aria-pressed': String(id === pick),
          'data-testid': `wd-tile-${id}`,
        },
        h('span', { class: 'wd-name' }, W.names[id] ?? id),
        state,
      );
      tile.addEventListener('click', () => {
        if (this.pick === id) return;
        sfx.ui('tap');
        this.pick = id;
        this.confirm = null;
        this.notice = '';
        this.render();
      });
      grid.append(tile);
    }

    // 행동 단추: 입는 중 / 입기 / 해금(두 번) / 불씨 모자람
    const owned = ownsCostume(p, pick);
    const price = costumePrice(team, pick, PROGRESSION) ?? 0;
    const lack = price - p.coins;
    let label: string;
    let act: (() => void) | null = null;
    if (pick === worn) label = W.wearing;
    else if (owned) {
      label = W.wear;
      act = () =>
        this.run(
          this.meta
            .wearCostume(team, pick)
            .then((r) =>
              r
                ? r.fail
                  ? ACCOUNT_TEXT.callFailed
                  : r.saved
                    ? fillText(W.worn, { name: W.names[pick] ?? pick })
                    : META_TEXT.notSaved
                : '',
            ),
        );
    } else if (lack > 0) label = fillText(W.lack, { n: lack });
    else if (this.confirm !== pick) {
      label = fillText(W.unlock, { n: price });
      act = () => {
        this.confirm = pick;
        this.render();
      };
    } else {
      label = fillText(W.unlockSure, { n: price });
      act = () =>
        this.run(
          this.meta
            .buyCostume(team, pick)
            .then((r) =>
              r.ok
                ? r.saved
                  ? fillText(W.unlocked, { name: W.names[pick] ?? pick })
                  : META_TEXT.notSaved
                : r.reason === 'account'
                  ? ACCOUNT_TEXT.callFailed
                  : '',
            ),
        );
    }
    const action = h(
      'button',
      {
        class: `btn${act ? ' btn-primary' : ''}${this.confirm === pick && act ? ' wd-sure' : ''}`,
        type: 'button',
        'data-testid': 'wd-action',
      },
      label,
    );
    action.disabled = !act || this.busy;
    // 확인 단추는 그려진 뒤 잠깐 포인터를 막는다: 첫 단추를 두 번 누른(두 번 탭) 두 번째가 같은 자리의 확인 단추에 떨어져
    // 바로 해금되지 않게 (연습 역할 고르기와 같은 가드, 검토 반영 F17 — 키보드는 막지 않는다)
    if (act && (this.confirm === pick || this.armNext)) armAgainstDoubleTap(action);
    this.armNext = false;
    if (act) {
      const run = act;
      action.addEventListener('click', () => {
        if (action.disabled) return;
        sfx.ui('tap');
        run();
      });
    }
    const notice = h('div', { class: 'hub-notice', role: 'status', 'data-testid': 'wd-notice' }, this.notice);
    notice.hidden = this.notice === '';
    side.append(grid, action, notice);
    this.el.replaceChildren(
      h('div', { class: 'wd-left' }, preview, h('p', { class: 'hub-note' }, W.note)),
      side,
    );
    if (focusId)
      this.el.querySelector<HTMLElement>(`[data-testid="${focusId}"]`)?.focus({ preventScroll: true });
  }

  /** 창을 다시 열거나 탭을 바꿀 때: 미리보기 · 해금 확인 · 알림을 푼다 (하던 해금 · 입기는 그대로 끝난다) */
  reset(): void {
    this.pick = null;
    this.confirm = null;
    this.notice = '';
  }

  /** 해금 · 입기 (기다리는 동안 단추를 끈다). 끝나면 확인을 풀고 알림을 띄운다 */
  private run(job: Promise<string>): void {
    this.busy = true;
    this.render();
    void job.then((text) => {
      this.busy = false;
      this.confirm = null;
      this.notice = text;
      // 해금 확인을 두 번 누른 두 번째가 같은 자리의 '입기'에 떨어져 바로 입지 않게 (해금만으로 입지 않는다)
      this.armNext = true;
      this.render();
    });
  }
}
