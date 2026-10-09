// 로비 화면 (HTML). 방 만들기 · 코드 입장 · 링크 복사 · 역할 카드 · 준비 · 시작 (M10c 리디자인, VISUAL_SPEC 9장)
// 배경은 실제 맵 설계도, 역할 카드는 게임과 같은 실루엣 · 문양. 고른 카드 = 역할색 테두리 + ✓ + "내 역할",
// 남이 고른 카드 = 사선 해치 + 주인 이름 — 색만으로 구분하지 않는다
import type { LobbyPlayer, LobbyState, Role } from '@decoy/shared';
import type { IconId } from '../art/icons';
import { HUD_TEXT, ROLE_CARDS, UI_TEXT } from '../data/storyText';
import {
  loadSavedQuality,
  parseQualityChoice,
  qualityHooks,
  saveQualityChoice,
  type QualityChoice,
} from '../gfx/quality';
import { blueprintSvg, glyphSvg, h, icon, keycap, logoImg, roleFigureSvg, roleVars, svgSpan } from './uiArt';

export interface LobbyActions {
  create(name: string): void;
  join(code: string, name: string): void;
  pickRole(role: Role | null): void;
  setReady(ready: boolean): void;
  setName(name: string): void;
  start(): void;
}

const ROLE_ORDER: Role[] = ['monster', 'runner', 'guard', 'scout'];

/** 능력 줄(ROLE_CARDS.ability)의 항목마다 붙는 아이콘 — 문구의 순서와 같다 */
const ABILITY_ICONS: Record<Role, IconId[]> = {
  monster: ['attack', 'visionSearch', 'dash', 'roar'],
  runner: ['sprint'],
  guard: ['shove'],
  scout: ['track'],
};

/** 그래픽 품질 선택지 */
const QUALITY_OPTIONS: readonly { value: QualityChoice; label: string }[] = [
  { value: 'auto', label: UI_TEXT.qualityAuto },
  { value: 'high', label: UI_TEXT.qualityHigh },
  { value: 'medium', label: UI_TEXT.qualityMedium },
  { value: 'low', label: UI_TEXT.qualityLow },
];

/** "Space 질주 — 3초간 …" · "좌클릭 공격 · 우클릭 시야 전환 · …" → 키캡 · 이름 · 설명 */
function abilityList(role: Role): HTMLElement {
  const [head = '', desc] = ROLE_CARDS[role].ability.split(' — ');
  const items = head.split(' · ');
  const list = h('span', { class: 'role-ability' });
  items.forEach((item, i) => {
    const at = item.indexOf(' ');
    const id = ABILITY_ICONS[role][i];
    list.append(
      h(
        'span',
        {},
        ...(id ? [icon(id, 18)] : []),
        keycap(item.slice(0, at)),
        h('span', {}, item.slice(at + 1)),
      ),
    );
  });
  if (desc) list.append(h('span', { class: 'ability-desc' }, desc));
  return list;
}

/** 준비 상태: 아이콘 + 글자 (+ 색) */
function readyState(p: LobbyPlayer): HTMLElement {
  const [cls, id, text]: [string, IconId, string] = !p.connected
    ? ['state off', 'disconnected', HUD_TEXT.offline]
    : p.ready
      ? ['state on', 'ready', UI_TEXT.ready]
      : ['state', 'waiting', UI_TEXT.waiting];
  // 좁은 칩 모양에서는 글자를 숨기고 아이콘만 (스크린 리더용 이름은 남긴다)
  return h('span', { class: cls, title: text }, icon(id, 18), h('span', { class: 'st-text' }, text));
}

export class LobbyUI {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  private errorBox: HTMLDivElement;
  private errorText: HTMLSpanElement;
  private you: string | null = null;
  private lastRoom: string | null = null;
  /** 이번 접속에서 고른 품질 (저장하지 못했어도 선택 상자를 다시 그릴 때 이 값을 보여 준다) */
  private qualityChoice: QualityChoice | null = null;

  constructor(
    host: HTMLElement,
    private readonly actions: LobbyActions,
    private readonly defaultName: string,
  ) {
    this.root = h('div', { class: 'lobby', 'data-testid': 'lobby' });
    // 배경 레이어는 한 번만 만든다 (방 상태가 바뀔 때마다 다시 그리는 것은 내용뿐)
    const bg = h('div', { class: 'lobby-bg', 'aria-hidden': 'true' });
    bg.innerHTML = blueprintSvg();
    bg.append(h('div', { class: 'lobby-scan' }), h('div', { class: 'lobby-vignette' }));
    this.content = h('div', { class: 'lobby-content' });
    this.errorText = h('span', { 'data-testid': 'lobby-error' });
    this.errorBox = h('div', { class: 'lobby-error', role: 'alert' }, icon('warn', 18), this.errorText);
    this.showError('');
    this.root.append(bg, this.content);
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

  /** 오류 문구 (빈 문자열이면 숨김) */
  showError(message: string): void {
    this.errorText.textContent = message;
    this.errorBox.hidden = message === '';
  }

  private brand(hero: boolean): HTMLElement {
    const text = h('div', { class: 'brand-text' }, h('div', { class: 'wordmark' }, UI_TEXT.title));
    if (hero) text.append(h('div', { class: 'brand-sub' }, UI_TEXT.subtitle));
    return h('div', { class: hero ? 'brand brand-hero' : 'brand' }, logoImg('brand-logo'), text);
  }

  /** 첫 화면: 방 만들기 / 코드로 입장 */
  renderHome(prefillCode = ''): void {
    const name = h('input', {
      'data-testid': 'name-input',
      placeholder: UI_TEXT.namePlaceholder,
      maxlength: '12',
      'aria-label': UI_TEXT.namePlaceholder,
    });
    name.value = this.defaultName;
    const create = h(
      'button',
      { class: 'btn btn-primary btn-wide', 'data-testid': 'create-room' },
      UI_TEXT.createRoom,
    );
    create.addEventListener('click', () => {
      this.showError('');
      this.actions.create(name.value);
    });
    const code = h('input', {
      'data-testid': 'room-code-input',
      placeholder: UI_TEXT.roomCodePlaceholder,
      maxlength: '4',
      'aria-label': UI_TEXT.roomCodePlaceholder,
    });
    code.value = prefillCode;
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase();
    });
    const join = h('button', { class: 'btn', 'data-testid': 'join-room' }, UI_TEXT.joinRoom);
    const doJoin = (): void => {
      if (code.value.trim().length === 0) return;
      this.showError('');
      this.actions.join(code.value.trim(), name.value);
    };
    join.addEventListener('click', doJoin);
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    const panel = h(
      'div',
      { class: 'panel home-panel' },
      h('label', { class: 'field' }, name),
      create,
      h('div', { class: 'divider' }),
      h('div', { class: 'row' }, h('label', { class: 'field field-code' }, code), join),
      ...this.qualityRow(),
      this.errorBox,
    );
    this.content.replaceChildren(this.brand(true), panel);
    this.show();
  }

  /**
   * 그래픽: 자동 / 높음 / 중간 / 낮음. 고르면 저장하고 바로 적용한다 (gfx/quality.ts, main.ts).
   * 저장하지 못해도 이번 접속에는 고른 값이 적용되고, 저장되지 않는다는 안내를 짧게 띄운다
   */
  private qualityRow(): HTMLElement[] {
    const select = h('select', { 'data-testid': 'quality-select' });
    const current: QualityChoice = this.qualityChoice ?? loadSavedQuality() ?? 'auto';
    for (const o of QUALITY_OPTIONS) {
      const opt = h('option', { value: o.value }, o.label);
      if (o.value === current) opt.selected = true;
      select.appendChild(opt);
    }
    const note = h(
      'div',
      { class: 'lobby-hint quality-note', 'data-testid': 'quality-note' },
      UI_TEXT.qualityNotSaved,
    );
    note.hidden = true;
    select.addEventListener('change', () => {
      const choice = parseQualityChoice(select.value);
      if (!choice) return;
      this.qualityChoice = choice;
      note.hidden = saveQualityChoice(choice);
      qualityHooks.choose?.(choice);
    });
    const row = h(
      'label',
      { class: 'field field-select' },
      icon('sliders', 18),
      h('span', { class: 'field-label' }, UI_TEXT.graphics),
      select,
    );
    return [row, note];
  }

  /** 방 로비 */
  renderRoom(lobby: LobbyState): void {
    if (this.lastRoom !== lobby.room) this.showError('');
    this.lastRoom = lobby.room;
    const me = lobby.players.find((p) => p.id === this.you);
    const isHost = me?.host ?? false;

    // 초대: 방 코드 4칸 키캡 + 링크 복사
    const link = `${window.location.origin}${window.location.pathname}?room=${lobby.room}`;
    const linkText = h('input', {
      readonly: 'true',
      'data-testid': 'room-link',
      'aria-label': UI_TEXT.inviteLink,
    });
    linkText.value = link;
    const copyLabel = h('span', {}, UI_TEXT.copyLink);
    const copy = h('button', { class: 'btn', 'data-testid': 'copy-link' }, icon('link', 18), copyLabel);
    copy.addEventListener('click', () => void copyText(link, linkText, copyLabel));
    const code = h('div', {
      class: 'room-code',
      'data-testid': 'room-code',
      'aria-label': `${UI_TEXT.roomCodeLabel} ${lobby.room}`,
    });
    for (const ch of lobby.room) code.append(h('span', { class: 'keytile' }, ch));
    const invite = h(
      'div',
      { class: 'panel invite' },
      h('div', { class: 'invite-code' }, h('span', { class: 'label' }, UI_TEXT.roomCodeLabel), code),
      h('div', { class: 'invite-link' }, h('label', { class: 'field' }, linkText), copy),
    );

    const cards = h('div', { class: 'role-cards' });
    for (const role of ROLE_ORDER) cards.appendChild(this.roleCard(role, lobby));

    const list = h('div', { class: 'panel player-list', 'data-testid': 'player-list' });
    for (const p of lobby.players) {
      const name = h('span', { class: 'player-name' });
      // 왕관은 그림이라 낭독기에 이름을 따로 준다 (아이콘 span은 aria-hidden)
      if (p.host)
        name.append(h('span', { role: 'img', 'aria-label': UI_TEXT.host }, icon('crown', 16, 'host')));
      name.append(h('span', { class: 'nm' }, p.name));
      if (p.id === this.you) name.append(h('span', { class: 'tag' }, UI_TEXT.me));
      if (p.bot) name.append(h('span', { class: 'tag tag-bot' }, UI_TEXT.bot));
      const avatar = p.role ? svgSpan('avatar', glyphSvg(p.role)) : h('span', { class: 'avatar none' });
      list.append(
        h(
          'div',
          { class: `player${p.connected ? '' : ' offline'}`, style: p.role ? roleVars(p.role) : undefined },
          avatar,
          name,
          h('span', { class: 'player-role' }, p.role ? ROLE_CARDS[p.role].name : '—'),
          readyState(p),
        ),
      );
    }

    // 빈자리 (역할 수만큼 자리가 있다)
    for (let i = lobby.players.length; i < ROLE_ORDER.length; i += 1)
      list.append(h('div', { class: 'player-slot' }, h('span', { class: 'avatar none' }), UI_TEXT.emptySlot));

    const ready = h(
      'button',
      { class: `btn${me?.ready ? '' : ' btn-primary'}`, 'data-testid': 'ready-button' },
      icon(me?.ready ? 'waiting' : 'ready', 20),
      me?.ready ? UI_TEXT.notReady : UI_TEXT.ready,
    );
    if (!me?.role) ready.setAttribute('disabled', 'true');
    ready.addEventListener('click', () => this.actions.setReady(!(me?.ready ?? false)));
    const buttons = h('div', { class: 'action-row' }, ready);
    if (isHost) {
      const start = h(
        'button',
        { class: 'btn btn-primary', 'data-testid': 'start-button' },
        icon('play', 18),
        UI_TEXT.start,
      );
      if (!lobby.canStart) start.setAttribute('disabled', 'true');
      start.addEventListener('click', () => this.actions.start());
      buttons.appendChild(start);
    }
    let hintText = !me?.role ? UI_TEXT.chooseRole : (lobby.waitingFor ?? (isHost ? '' : UI_TEXT.waitingHost));
    if (lobby.bots) hintText = `${hintText} · ${UI_TEXT.botsFill}`;
    // 준비 · 시작: 가운데 명령 줄 (안내 · 오류는 그 아래)
    const actions = h(
      'div',
      { class: 'lobby-actions' },
      buttons,
      h('div', { class: 'lobby-hint', 'data-testid': 'lobby-hint' }, hintText),
      this.errorBox,
    );

    // 로비 상태가 올 때마다 방 화면을 새로 만든다. 키보드 포커스가 body로 날아가지 않게 같은 요소(data-testid)로 돌려준다
    const active = document.activeElement;
    const focusId =
      active instanceof HTMLElement && this.content.contains(active) ? active.dataset.testid : undefined;
    this.content.replaceChildren(
      h('div', { class: 'lobby-top' }, this.brand(false), invite),
      cards,
      list,
      actions,
    );
    this.show();
    if (focusId)
      this.content.querySelector<HTMLElement>(`[data-testid="${focusId}"]`)?.focus({ preventScroll: true });
  }

  /** 역할 카드: 큰 실루엣 + 문양 + 이름 + 소개 + 능력(키캡) + 주인 */
  private roleCard(role: Role, lobby: LobbyState): HTMLElement {
    const info = ROLE_CARDS[role];
    const owner = lobby.players.find((p) => p.role === role);
    const mine = owner !== undefined && owner.id === this.you;
    const taken = owner !== undefined && !mine;
    const figure = svgSpan('rc-figure', roleFigureSvg(role));
    if (mine) {
      figure.removeAttribute('aria-hidden');
      figure.append(h('span', { class: 'rc-tag' }, icon('check', 15), UI_TEXT.myRole));
    }
    const ownerRow = owner
      ? h(
          'span',
          { class: 'role-owner' },
          h('span', { class: 'owner-name' }, owner.name),
          ...(owner.id === this.you ? [h('span', { class: 'tag' }, UI_TEXT.me)] : []),
          readyState(owner),
        )
      : h('span', { class: 'role-owner empty' }, h('span', { class: 'avatar none' }), UI_TEXT.emptySlot);
    const body = h(
      'span',
      { class: 'rc-body cut' },
      figure,
      h(
        'span',
        { class: 'rc-head' },
        svgSpan('glyph', glyphSvg(role)),
        h('span', { class: 'role-name' }, info.name),
      ),
      h('span', { class: 'role-intro' }, info.intro),
      abilityList(role),
      ownerRow,
    );
    const card = h(
      'button',
      {
        class: `role-card${mine ? ' mine' : ''}${taken ? ' taken' : ''}`,
        'data-testid': `role-${role}`,
        style: roleVars(role),
        'aria-pressed': mine ? 'true' : 'false',
        'aria-disabled': taken ? 'true' : undefined,
      },
      body,
    );
    card.addEventListener('click', () => {
      if (mine) this.actions.pickRole(null);
      else if (!owner) this.actions.pickRole(role);
    });
    return card;
  }
}

/** 링크 복사: clipboard API → execCommand → 직접 복사 안내 (http 같은 와이파이 접속 대비) */
async function copyText(text: string, input: HTMLInputElement, label: HTMLElement): Promise<void> {
  const done = (msg: string): void => {
    label.textContent = msg;
    window.setTimeout(() => {
      label.textContent = UI_TEXT.copyLink;
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
