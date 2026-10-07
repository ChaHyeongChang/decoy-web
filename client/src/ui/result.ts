// 결과 화면 (HTML): 승리 팀, 결과 등급(생존자), 결말 문구, 플레이어별 기록, 다시 하기
import type { MatchResult, Role } from '@decoy/shared';
import logoUrl from '../../../docs/images/logo_decoy.png';
import { ROLE_CARDS, UI_TEXT, formatText } from '../data/storyText';

const STATUS_TEXT: Record<string, string> = {
  free: '생존',
  imprisoned: '수감',
  dead: '사망',
  escaped: '탈출',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export class ResultUI {
  private readonly root: HTMLDivElement;

  constructor(
    host: HTMLElement,
    private readonly onRematch: () => void,
  ) {
    this.root = el('div', 'result');
    this.root.dataset.testid = 'result';
    this.root.style.display = 'none';
    host.appendChild(this.root);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(r: MatchResult, myRole: Role | null): void {
    this.root.replaceChildren();
    const box = el('div', 'result-box');
    const head = el('div', 'brand');
    const img = el('img', 'brand-logo');
    img.src = logoUrl;
    img.alt = 'DECOY 로고';
    head.append(img, el('div', 'brand-title', UI_TEXT.title));
    const winnerText =
      r.winner === 'survivors'
        ? UI_TEXT.winSurvivors
        : r.winner === 'monster'
          ? UI_TEXT.winMonster
          : UI_TEXT.winVoid;
    const winner = el('div', `result-winner result-${r.winner}`, winnerText);
    winner.dataset.testid = 'result-winner';
    box.append(head, winner);
    if (r.grade && myRole !== 'monster') {
      const g =
        r.grade === 'full'
          ? UI_TEXT.gradeFull
          : r.grade === 'success'
            ? UI_TEXT.gradeSuccess
            : UI_TEXT.gradeFail;
      const grade = el('div', 'result-grade', `${g} · ${r.escaped}명 탈출`);
      grade.dataset.testid = 'result-grade';
      box.appendChild(grade);
    }
    const ending = el('div', 'result-ending', formatText(r.ending));
    ending.dataset.testid = 'result-ending';
    box.appendChild(ending);

    const table = el('table', 'result-table');
    const headRow = el('tr');
    for (const h of ['플레이어', '역할', '맞은 횟수', '맞힌 횟수', '구조', '점령 기여', '결과'])
      headRow.appendChild(el('th', '', h));
    table.appendChild(headRow);
    for (const p of r.players) {
      const tr = el('tr');
      const role = ROLE_CARDS[p.role];
      const roleCell = el('td', '', role.name);
      roleCell.style.color = role.color;
      tr.append(
        el('td', '', p.name),
        roleCell,
        el('td', '', p.role === 'monster' ? '—' : String(p.hitsTaken)),
        el('td', '', p.role === 'monster' ? String(p.hitsLanded) : '—'),
        el('td', '', p.role === 'monster' ? '—' : String(p.rescues)),
        el('td', '', p.role === 'monster' ? '—' : `${Math.round(p.captureSeconds)}초`),
        el('td', '', p.status ? (STATUS_TEXT[p.status] ?? p.status) : '—'),
      );
      table.appendChild(tr);
    }
    box.appendChild(table);
    const mm = Math.floor(r.durationSec / 60);
    const ss = String(r.durationSec % 60).padStart(2, '0');
    box.appendChild(el('div', 'result-duration', `판 길이 ${mm}:${ss}`));
    const again = el('button', 'btn btn-primary', UI_TEXT.rematch);
    again.dataset.testid = 'rematch';
    again.addEventListener('click', () => this.onRematch());
    box.appendChild(again);
    this.root.appendChild(box);
    this.root.style.display = '';
  }
}
