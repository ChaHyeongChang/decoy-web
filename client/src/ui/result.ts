// 결과 화면 (HTML, M10c 리디자인 · VISUAL_SPEC 9장): 승리 팀 + 팀 문장(생존자 셋 실루엣 / 괴물 후드),
// 결과 등급 배지(문 아이콘 3/2/1개 + 글자, 생존자 화면만), 내 평가 · 경험치(GAME_DESIGN 12장, VISUAL_SPEC 9.6),
// 결말 문구는 "기록자 메모", 플레이어별 기록, 다시 하기. 화면이 낮으면 위에서부터 스크롤한다(960×540에서 위가 잘리지 않게).
// 이 파일(과 resultRating.ts)은 나눠 받는 묶음이다 — 첫 화면에 필요 없어서 첫 묶음에서 뺐다(ui/resultHost.ts가 받는다)
import type { MatchResult, PlayerRecord, Role, SurvivorStatus } from '@decoy/shared';
import type { IconId } from '../art/icons';
import { HUD_TEXT, ROLE_CARDS, UI_TEXT, formatText } from '../data/storyText';
import { currentCharStyle, onCharStyleChange } from '../gfx/charStyle';
import type { RatingApplied } from '../meta/meta';
import { ratingPanel } from './resultRating';
import {
  characterFigureSvg,
  frontFigureSvg,
  glyphSvg,
  h,
  icon,
  logoImg,
  roleVars,
  svgSpan,
  type FigureCostume,
} from './uiArt';
import { onWearingChange, wearingFor } from '../meta/wearing';

const STATUS: Record<SurvivorStatus, { text: string; icon: IconId }> = {
  free: { text: UI_TEXT.resultFree, icon: 'heart' },
  imprisoned: { text: HUD_TEXT.status.imprisoned, icon: 'prison' },
  dead: { text: HUD_TEXT.status.dead, icon: 'dead' },
  escaped: { text: HUD_TEXT.status.escaped, icon: 'escaped' },
};

/** 표 열: 머리 아이콘 · 글자 · 값 (괴물 행이면 생존자 기록은 —, 반대도 같다) */
const COLUMNS: readonly { icon: IconId; label: string; value: (p: PlayerRecord) => string | null }[] = [
  {
    icon: 'injured',
    label: UI_TEXT.colHitsTaken,
    value: (p) => (p.role === 'monster' ? null : String(p.hitsTaken)),
  },
  {
    icon: 'attack',
    label: UI_TEXT.colHitsLanded,
    value: (p) => (p.role === 'monster' ? String(p.hitsLanded) : null),
  },
  {
    icon: 'rescue',
    label: UI_TEXT.colRescues,
    value: (p) => (p.role === 'monster' ? null : String(p.rescues)),
  },
  {
    icon: 'point',
    label: UI_TEXT.colCapture,
    value: (p) => (p.role === 'monster' ? null : `${Math.round(p.captureSeconds)}초`),
  },
];

const DOORS: Record<NonNullable<MatchResult['grade']>, { n: number; text: string }> = {
  full: { n: 3, text: UI_TEXT.gradeFull },
  success: { n: 2, text: UI_TEXT.gradeSuccess },
  fail: { n: 1, text: UI_TEXT.gradeFail },
};

const nil = (): HTMLElement => h('span', { class: 'nil' }, '—');

/**
 * 팀 문장 (캐릭터 스타일을 따른다): 생존자 승리 = 셋의 그림(겹쳐 놓아 무대 빛은 뺀다), 괴물 승리 = 기존이면 괴물 문양 ·
 * 새 캐릭터면 괴물 정면 그림, 무효 = 끊김 아이콘. 새 캐릭터면 'front' 클래스(정면 그림 크기 · 겹침은 style.css).
 * 그림 하나 = svg 하나
 */
function emblemFor(winner: MatchResult['winner'], myRole: Role | null): HTMLElement {
  const front = currentCharStyle() === 'new';
  const cls = (team: string): string => (front ? `emblem ${team} front` : `emblem ${team}`);
  // 내 역할 그림만 내 의상 (남의 의상은 판 밖 화면에 없다 — 결과 메시지에도 의상 칸이 없다)
  const dress = (role: Role): FigureCostume => (role === myRole ? wearingFor(role) : 'basic');
  if (winner === 'survivors')
    return h(
      'div',
      { class: cls('survivors') },
      ...(['runner', 'guard', 'scout'] as const).map((role) =>
        svgSpan('fig', characterFigureSvg(role, false, dress(role))),
      ),
    );
  if (winner === 'monster')
    return h(
      'div',
      { class: cls('monster') },
      svgSpan('fig', front ? frontFigureSvg('monster', false, dress('monster')) : glyphSvg('monster')),
    );
  return h('div', { class: 'emblem void' }, icon('disconnected', 64));
}

/** 누르면 꺼지는 버튼 (HTMLButtonElement의 필요한 부분만) */
export type OneShotButton = EventTarget & { disabled: boolean };

/**
 * 결과 화면 버튼은 한 번만 (출시 전 검토의 수정 검토): 하나를 누르면 둘 다 끈다. 빠른 매칭 '다시 하기' 직후(왕복 안에)
 * '홈으로'를 누르면, 서버가 먼저 보낸 새 대기열 방의 welcome · lobby가 첫 화면 위에 떠난 방의 대기 화면을 되살렸다.
 * 다음 결과 표시(재접속 뒤 다시 받은 결과 포함)는 버튼을 새로 그리므로 다시 켜진다
 */
export function oneShotButtons(pairs: readonly (readonly [OneShotButton, () => void])[]): void {
  for (const [button, action] of pairs) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      for (const [b] of pairs) b.disabled = true;
      action();
    });
  }
}

export class ResultUI {
  private readonly root: HTMLDivElement;
  /** 지금 보이는 팀 문장과 승리 팀 (캐릭터 스타일이 바뀌면 이것만 다시 그린다 — 버튼은 그대로) */
  private emblem: { el: HTMLElement; winner: MatchResult['winner']; myRole: Role | null } | null = null;

  constructor(
    host: HTMLElement,
    private readonly onRematch: () => void,
    /** "홈으로" (M13b): 방에서 나가 첫 화면으로 */
    private readonly onHome: () => void,
  ) {
    this.root = h('div', { class: 'result', 'data-testid': 'result' });
    this.root.style.display = 'none';
    host.appendChild(this.root);
    // 결과 화면이 떠 있는 동안 캐릭터 스타일이 바뀌거나(디버그 훅) 의상 그림 조각이 오면 팀 문장만 바꾼다. ResultUI는 앱과 수명이 같다
    const redraw = (): void => {
      const e = this.emblem;
      if (!e || this.root.style.display === 'none') return;
      const next = emblemFor(e.winner, e.myRole);
      e.el.replaceWith(next);
      this.emblem = { ...e, el: next };
    };
    onCharStyleChange(redraw);
    onWearingChange(redraw);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** rated: 내 평가 적립 결과 (평가가 없는 판 · 봇 자리 · 옛 서버면 null). 오면 기록자 메모 위에 '내 평가'를 붙인다 */
  show(r: MatchResult, myRole: Role | null, rated: Promise<RatingApplied> | null = null): void {
    const mm = Math.floor(r.durationSec / 60);
    const ss = String(r.durationSec % 60).padStart(2, '0');
    const head = h(
      'div',
      { class: 'result-head' },
      h('div', { class: 'brand' }, logoImg('brand-logo'), h('div', { class: 'wordmark' }, UI_TEXT.title)),
      h(
        'span',
        { class: 'chip result-duration' },
        icon('timer', 18),
        `${UI_TEXT.matchLength} `,
        h('span', { class: 'num' }, `${mm}:${ss}`),
      ),
    );

    // 승리 팀 + 팀 문장
    const winnerText =
      r.winner === 'survivors'
        ? UI_TEXT.winSurvivors
        : r.winner === 'monster'
          ? UI_TEXT.winMonster
          : UI_TEXT.winVoid;
    const emblem = emblemFor(r.winner, myRole);
    this.emblem = { el: emblem, winner: r.winner, myRole };
    const title = h(
      'div',
      { class: 'result-title' },
      h('div', { class: `result-winner result-${r.winner}`, 'data-testid': 'result-winner' }, winnerText),
    );
    if (r.grade && myRole !== 'monster') {
      const g = DOORS[r.grade];
      const doors = h('span', { class: 'doors' });
      for (let i = 0; i < g.n; i += 1) doors.append(icon('exit', 22));
      title.append(
        h(
          'div',
          { class: 'chip result-grade', 'data-testid': 'result-grade' },
          doors,
          `${g.text} · ${r.escaped}명 탈출`,
        ),
      );
    }
    const hero = h('div', { class: 'result-hero' }, emblem, title);

    // 결말: 기록자 메모
    const memo = h(
      'figure',
      { class: 'memo cut' },
      h('span', { class: 'label' }, UI_TEXT.recorderMemo),
      h('p', { class: 'result-ending', 'data-testid': 'result-ending' }, formatText(r.ending)),
    );

    // 플레이어별 기록
    const headRow = h('tr', {}, h('th', { scope: 'col' }, UI_TEXT.colPlayer));
    for (const c of COLUMNS) headRow.append(h('th', { scope: 'col' }, icon(c.icon, 18), c.label));
    headRow.append(h('th', { scope: 'col' }, icon('ready', 18), UI_TEXT.colResult));
    const table = h('table', { class: 'result-table' }, h('thead', {}, headRow));
    const body = h('tbody');
    for (const p of r.players) {
      const st = p.status ? STATUS[p.status] : null;
      const who = h(
        'span',
        { class: 'who' },
        svgSpan('avatar', glyphSvg(p.role)),
        h(
          'span',
          { class: 'who-text' },
          h(
            'span',
            {},
            p.name,
            // 봇 표시는 결과 화면에서만 (빠른 매칭은 대기 · 판 중 봇 여부를 알리지 않는다, M13c)
            ...(p.bot ? [h('span', { class: 'tag tag-bot', 'data-testid': 'result-bot' }, UI_TEXT.bot)] : []),
          ),
          h('span', { class: 'who-role' }, ROLE_CARDS[p.role].name),
        ),
      );
      const row = h(
        'tr',
        { class: p.role === myRole ? 'me' : undefined, style: roleVars(p.role) },
        h('td', {}, who),
      );
      for (const c of COLUMNS) {
        const v = c.value(p);
        row.append(h('td', {}, v === null ? nil() : v));
      }
      row.append(
        h(
          'td',
          {},
          st ? h('span', { class: `status status-${p.status ?? ''}` }, icon(st.icon, 18), st.text) : nil(),
        ),
      );
      body.append(row);
    }
    table.append(body);

    const again = h(
      'button',
      { class: 'btn btn-primary', 'data-testid': 'rematch' },
      icon('replay', 20),
      UI_TEXT.rematch,
    );
    const home = h('button', { class: 'btn', 'data-testid': 'result-home' }, icon('back', 20), UI_TEXT.home);
    oneShotButtons([
      [again, () => this.onRematch()],
      [home, () => this.onHome()],
    ]);
    // 내 평가: 적립(보통 바로 끝난다)이 끝나면 자리에 채운다. 그사이 다른 결과가 오면(재접속) 옛 것은 버린다
    const slot = h('div', { class: 'rating-slot' });
    if (rated) {
      void rated.then(
        (applied) => {
          if (slot.isConnected) slot.replaceWith(ratingPanel(applied));
        },
        () => undefined,
      );
    }
    // 넓은 화면은 '내 평가'를 승리 팀 옆 칸에, 좁은 화면은 기록자 메모 아래에 둔다 (style.css .has-rating 격자)
    const box = h(
      'div',
      { class: rated ? 'panel result-box has-rating' : 'panel result-box' },
      head,
      hero,
      memo,
      slot,
      // 좁은 화면(휴대폰)에서는 표만 가로로 스크롤한다 (M11)
      h('div', { class: 'table-wrap' }, table),
      h('div', { class: 'result-foot' }, home, again),
    );
    this.root.replaceChildren(box);
    this.root.style.display = '';
  }
}
