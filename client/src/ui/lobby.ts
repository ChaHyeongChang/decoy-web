// 로비 화면 (HTML). 방 만들기 · 코드 입장 · 링크 복사 · 역할 카드 · 준비 · 시작
import type { LobbyState, Role } from '@decoy/shared';
import logoUrl from '../../../docs/images/logo_decoy.png';
import { ROLE_CARDS, UI_TEXT } from '../data/storyText';

export interface LobbyActions {
  create(name: string): void;
  join(code: string, name: string): void;
  pickRole(role: Role | null): void;
  setReady(ready: boolean): void;
  setName(name: string): void;
  start(): void;
}

const ROLE_ORDER: Role[] = ['monster', 'runner', 'guard', 'scout'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export class LobbyUI {
  private root: HTMLDivElement;
  private errorBox: HTMLDivElement;
  private you: string | null = null;
  private lastRoom: string | null = null;

  constructor(
    host: HTMLElement,
    private readonly actions: LobbyActions,
    private readonly defaultName: string,
  ) {
    this.root = el('div', { class: 'lobby', 'data-testid': 'lobby' });
    this.errorBox = el('div', { class: 'lobby-error', 'data-testid': 'lobby-error' });
    host.appendChild(this.root);
  }

  setYou(id: string): void {
    this.you = id;
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  showError(message: string): void {
    this.errorBox.textContent = message;
  }

  private header(large: boolean): HTMLElement {
    const head = el('div', { class: large ? 'brand brand-large' : 'brand' });
    const img = el('img', { src: logoUrl, alt: 'DECOY 로고', class: 'brand-logo' });
    const title = el('div', { class: 'brand-title' }, UI_TEXT.title);
    head.append(img, title);
    if (large) head.appendChild(el('div', { class: 'brand-sub' }, UI_TEXT.subtitle));
    return head;
  }

  /** 첫 화면: 방 만들기 / 코드로 입장 */
  renderHome(prefillCode = ''): void {
    this.root.replaceChildren();
    const box = el('div', { class: 'lobby-home' });
    const name = el('input', {
      class: 'input',
      'data-testid': 'name-input',
      placeholder: UI_TEXT.namePlaceholder,
      maxlength: '12',
    });
    name.value = this.defaultName;
    const create = el(
      'button',
      { class: 'btn btn-primary', 'data-testid': 'create-room' },
      UI_TEXT.createRoom,
    );
    create.addEventListener('click', () => {
      this.errorBox.textContent = '';
      this.actions.create(name.value);
    });
    const code = el('input', {
      class: 'input input-code',
      'data-testid': 'room-code-input',
      placeholder: UI_TEXT.roomCodePlaceholder,
      maxlength: '4',
    });
    code.value = prefillCode;
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase();
    });
    const join = el('button', { class: 'btn', 'data-testid': 'join-room' }, UI_TEXT.joinRoom);
    const doJoin = (): void => {
      if (code.value.trim().length === 0) return;
      this.errorBox.textContent = '';
      this.actions.join(code.value.trim(), name.value);
    };
    join.addEventListener('click', doJoin);
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    const joinRow = el('div', { class: 'row' });
    joinRow.append(code, join);
    box.append(name, create, joinRow, this.errorBox);
    this.root.append(this.header(true), box);
    this.show();
  }

  /** 방 로비 */
  renderRoom(lobby: LobbyState): void {
    this.root.replaceChildren();
    if (this.lastRoom !== lobby.room) this.errorBox.textContent = '';
    this.lastRoom = lobby.room;
    const me = lobby.players.find((p) => p.id === this.you);
    const isHost = me?.host ?? false;

    const codeBox = el('div', { class: 'room-code-box' });
    codeBox.append(
      el('div', { class: 'room-code-label' }, '방 코드'),
      el('div', { class: 'room-code', 'data-testid': 'room-code' }, lobby.room),
    );
    const link = `${window.location.origin}${window.location.pathname}?room=${lobby.room}`;
    const linkRow = el('div', { class: 'row link-row' });
    const linkText = el('input', { class: 'input link-text', readonly: 'true', 'data-testid': 'room-link' });
    linkText.value = link;
    const copy = el('button', { class: 'btn', 'data-testid': 'copy-link' }, UI_TEXT.copyLink);
    copy.addEventListener('click', () => void copyText(link, linkText, copy));
    linkRow.append(linkText, copy);

    const cards = el('div', { class: 'role-cards' });
    for (const role of ROLE_ORDER) {
      const info = ROLE_CARDS[role];
      const owner = lobby.players.find((p) => p.role === role);
      const mine = owner?.id === this.you;
      const card = el('button', {
        class: `role-card${mine ? ' mine' : ''}${owner && !mine ? ' taken' : ''}`,
        'data-testid': `role-${role}`,
        style: `--role-color:${info.color}`,
      });
      const shape = el('div', {
        class: `role-shape role-shape-${role === 'monster' ? 'monster' : 'survivor'}`,
      });
      card.append(
        shape,
        el('div', { class: 'role-name' }, info.name),
        el('div', { class: 'role-intro' }, info.intro),
        el('div', { class: 'role-ability' }, info.ability),
        el('div', { class: 'role-owner' }, owner ? `${owner.name}${owner.ready ? ' ✓' : ''}` : '비어 있음'),
      );
      card.addEventListener('click', () => {
        if (mine) this.actions.pickRole(null);
        else if (!owner) this.actions.pickRole(role);
      });
      cards.appendChild(card);
    }

    const list = el('div', { class: 'player-list', 'data-testid': 'player-list' });
    for (const p of lobby.players) {
      const row = el('div', { class: `player${p.connected ? '' : ' offline'}` });
      const roleName = p.role ? ROLE_CARDS[p.role].name : '—';
      row.append(
        el(
          'span',
          { class: 'player-name' },
          `${p.host ? '★ ' : ''}${p.name}${p.id === this.you ? ' (나)' : ''}${p.bot ? ' [봇]' : ''}`,
        ),
        el('span', { class: 'player-role' }, roleName),
        el('span', { class: `player-ready${p.ready ? ' on' : ''}` }, p.ready ? '준비' : '대기'),
      );
      list.appendChild(row);
    }

    const controls = el('div', { class: 'row controls' });
    const ready = el(
      'button',
      { class: `btn${me?.ready ? '' : ' btn-primary'}`, 'data-testid': 'ready-button' },
      me?.ready ? UI_TEXT.notReady : UI_TEXT.ready,
    );
    if (!me?.role) ready.setAttribute('disabled', 'true');
    ready.addEventListener('click', () => this.actions.setReady(!(me?.ready ?? false)));
    controls.appendChild(ready);
    if (isHost) {
      const start = el('button', { class: 'btn btn-primary', 'data-testid': 'start-button' }, UI_TEXT.start);
      if (!lobby.canStart) start.setAttribute('disabled', 'true');
      start.addEventListener('click', () => this.actions.start());
      controls.appendChild(start);
    }
    const hint = el(
      'div',
      { class: 'lobby-hint', 'data-testid': 'lobby-hint' },
      !me?.role ? UI_TEXT.chooseRole : (lobby.waitingFor ?? (isHost ? '' : UI_TEXT.waitingHost)),
    );
    if (lobby.bots) hint.textContent = `${hint.textContent ?? ''} · 빈자리는 봇이 채웁니다`;

    const body = el('div', { class: 'lobby-room' });
    body.append(codeBox, linkRow, cards, list, controls, hint, this.errorBox);
    this.root.append(this.header(false), body);
    this.show();
  }
}

/** 링크 복사: clipboard API → execCommand → 직접 복사 안내 (http 같은 와이파이 접속 대비) */
async function copyText(text: string, input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
  const done = (label: string): void => {
    button.textContent = label;
    window.setTimeout(() => {
      button.textContent = UI_TEXT.copyLink;
    }, 1500);
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      done(UI_TEXT.copied);
      return;
    }
  } catch {
    // 아래 방법으로
  }
  input.focus();
  input.select();
  try {
    // 보안 컨텍스트가 아닐 때(같은 와이파이 http 접속)의 대체 수단
    if (document.execCommand('copy')) {
      done(UI_TEXT.copied);
      return;
    }
  } catch {
    // 아래 안내로
  }
  done(UI_TEXT.copyManual);
}
