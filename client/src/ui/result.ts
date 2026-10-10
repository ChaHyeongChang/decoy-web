// 결과 화면 (HTML, M10c 리디자인 · VISUAL_SPEC 9장): 승리 팀 + 팀 문장(생존자 셋 실루엣 / 괴물 후드),
// 결과 등급 배지(문 아이콘 3/2/1개 + 글자, 생존자 화면만), 결말 문구는 "기록자 메모", 플레이어별 기록, 다시 하기.
// 화면이 낮으면 위에서부터 스크롤한다(960×540에서 위가 잘리지 않게)
import type { MatchResult, PlayerRecord, Role, SurvivorStatus } from '@decoy/shared';
import type { IconId } from '../art/icons';
import { HUD_TEXT, ROLE_CARDS, UI_TEXT, formatText } from '../data/storyText';
import { glyphSvg, h, icon, logoImg, roleFigureSvg, roleVars, svgSpan } from './uiArt';

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

export class ResultUI {
  private readonly root: HTMLDivElement;

  constructor(
    host: HTMLElement,
    private readonly onRematch: () => void,
    /** "홈으로" (M13b): 방에서 나가 첫 화면으로 */
    private readonly onHome: () => void,
  ) {
    this.root = h('div', { class: 'result', 'data-testid': 'result' });
    this.root.style.display = 'none';
    host.appendChild(this.root);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(r: MatchResult, myRole: Role | null): void {
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
    const emblem =
      r.winner === 'survivors'
        ? h(
            'div',
            { class: 'emblem survivors' },
            ...(['runner', 'guard', 'scout'] as const).map((role) =>
              svgSpan('fig', roleFigureSvg(role, false)),
            ),
          )
        : r.winner === 'monster'
          ? h('div', { class: 'emblem monster' }, svgSpan('fig', glyphSvg('monster')))
          : h('div', { class: 'emblem void' }, icon('disconnected', 64));
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
          h('span', {}, p.name),
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
    again.addEventListener('click', () => this.onRematch());
    const home = h('button', { class: 'btn', 'data-testid': 'result-home' }, icon('back', 20), UI_TEXT.home);
    home.addEventListener('click', () => this.onHome());
    const box = h(
      'div',
      { class: 'panel result-box' },
      head,
      hero,
      memo,
      // 좁은 화면(휴대폰)에서는 표만 가로로 스크롤한다 (M11)
      h('div', { class: 'table-wrap' }, table),
      h('div', { class: 'result-foot' }, home, again),
    );
    this.root.replaceChildren(box);
    this.root.style.display = '';
  }
}
