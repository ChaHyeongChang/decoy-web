// 판 화면 HUD (M10c, VISUAL_SPEC 8장). 맵과 겹치지 않게 위 · 아래 띠와 왼쪽 여백에 둔다 (DECISIONS D3). 위치는 layout.ts HUD.
//  위 띠: 거점 A · B 게이지(깎은 육각 막대 · 점령 중 흐르는 사선 · 정지 주황 + ‖ 칩 · 완료 ✓ 칩)와 타이머 틀(고정폭 숫자,
//         1분 미만 = 빨강 + 경고 아이콘, 최후의 30초 = 주황 + 문 아이콘). 괴물 화면은 점령 중 게이지가 깜빡인다
//  왼쪽: 생존자 화면 = 팀 카드(역할 실루엣 + 능력 쿨타임 눈금 링, 역할 이름, '나', 플레이어 이름, 상태 아이콘 + 글자, 체력 칸, 수감 눈금)
//        괴물 화면 = 익명 카드(공통 흰 토큰 + 상태 아이콘 + 글자 + 수감 눈금. 순서 · 역할 · 이름 없음 — 지금 규칙 그대로)
//  아래 띠: 행동 칸(아이콘 타일 + 쿨타임 눈금 링 + 가운데 남은 초 + 이름 + 키캡). 수감 · 관전 · 괴물 대기 중에는 안내 줄
// 그림은 HUD 아틀라스 프레임(hudKit.ts)이라 상태가 바뀌어도 다시 굽지 않는다. 글자는 바뀔 때만 다시 그린다.
import type { AnonStatus, Balance, MatchInfo, PointView, Snapshot } from '@decoy/shared';
import { gfxNow } from '../gfx/state';
import { HUD_TEXT, ROLE_CARDS, UI_TEXT } from '../data/storyText';
import { UI, WARN } from '../art/palette';
import {
  ABILITY_ICON,
  ACCENT,
  FR,
  GAUGE_ICON,
  HC,
  STATUS_LOOK,
  STRIPE_P,
  TICKS,
  TIMER_LOOK,
  actionSlots,
  slotIconFrame,
  gaugeState,
  litTicks,
  teamCards,
  timerView,
  type Accent,
  type ActionSlot,
  type GaugeState,
  type TimerMode,
} from './hudArt';
import { Digits, fitText, setText, type HudKit, type Slice, type Spr } from './hudKit';
import { HUD, VIEW_W } from './layout';
import type { CrispText } from './text';

/** HUD 깊이: 패널 40 · 그림 41 · 글자 42 */
const D_PANEL = 40;
const D_ART = 41;
const D_TEXT = 42;
/** 점령 중 사선 흐름 속도 (논리 px / 초) */
const STRIPE_SPEED = 26;

/** 쿨타임 눈금 링: 꺼진 링 위에 켜진 눈금, 또는 다 켜진 링 한 장 */
class Ring {
  private readonly base: Spr;
  private readonly ticks: Spr[] = [];

  constructor(private readonly kit: HudKit) {
    this.base = kit.spr(D_ART);
  }

  /** lit = 켜진 눈금 수 (TICKS면 다 켜진 링, −1이면 숨김) */
  set(accent: Accent, lit: number, x: number, y: number): void {
    if (lit < 0) {
      this.base.show(false);
      for (const t of this.ticks) t.show(false);
      return;
    }
    const full = lit >= TICKS;
    this.base.set(FR.ring(full ? accent : 'off'), x, y).show(true);
    for (let i = 0; i < TICKS; i += 1) {
      const on = !full && i < lit;
      let t = this.ticks[i];
      if (!on) {
        t?.show(false);
        continue;
      }
      if (!t) {
        t = this.kit.spr(D_ART + 0.5);
        this.ticks[i] = t;
      }
      t.set(FR.tick(accent, i), x, y).show(true);
    }
  }

  show(on: boolean): void {
    this.base.show(on);
    if (!on) for (const t of this.ticks) t.show(false);
  }
}

/** 거점 게이지: ◇ 배지 + 상태 칩 + 육각 막대 (side 1 = 배지가 왼쪽(A), −1 = 오른쪽(B), 채움은 배지 쪽에서) */
class Gauge {
  private readonly frame: Slice;
  private readonly dia: Spr;
  readonly chip: Spr;
  private readonly fill: Spr;
  private readonly stripe: Spr;
  private readonly letter: CrispText;
  private readonly bar: { x: number; y: number };
  private readonly diaX: number;
  private readonly chipX: number;
  state: GaugeState = 'idle';

  constructor(
    private readonly kit: HudKit,
    id: 'A' | 'B',
    private readonly side: 1 | -1,
  ) {
    const G = HUD.gauge;
    const o = id === 'A' ? HUD.gaugeA : HUD.gaugeB;
    this.diaX = o.x + side * (G.dia / 2);
    this.chipX = o.x + side * (G.dia + G.gap + G.chip / 2);
    const inner = o.x + side * (G.dia + G.gap + G.chip + 8);
    this.bar = { x: side === 1 ? inner : inner - G.barW, y: o.y - G.barH / 2 };
    this.frame = kit.slice(D_PANEL);
    this.fill = kit.spr(D_ART);
    this.stripe = kit.spr(D_ART + 0.2);
    this.dia = kit.spr(D_ART);
    this.chip = kit.spr(D_ART);
    this.letter = kit.text(this.diaX, o.y, 20, UI.text, D_TEXT, true).setOrigin(0.5, 0.5).setText(id);
  }

  update(p: PointView | undefined, blinkOff: boolean): void {
    if (!p) return;
    const G = HUD.gauge;
    const s = gaugeState(p.state);
    this.state = s;
    const y = HUD.gaugeA.y;
    this.frame.set(`gbar:${s}`, this.bar.x, this.bar.y, G.barW, G.barH);
    this.dia.set(`dia:${s}`, this.diaX, y);
    this.chip.set(GAUGE_ICON[s] ? `chip:${s}` : '', this.chipX, y);
    // 채움: 안쪽 3px, 배지 쪽에서 진행만큼
    const fw = G.barW - 6;
    const fx = this.bar.x + 3;
    const fy = this.bar.y + 3;
    const prog = Math.max(0, Math.min(1, p.progress));
    const a = this.side === 1 ? 0 : fw * (1 - prog);
    const b = this.side === 1 ? fw * prog : fw;
    if (prog > 0) this.fill.set(s === 'paused' ? 'gfill:warn' : 'gfill:neon', fx, fy).crop(a, b);
    else this.fill.show(false);
    // 점령 중: 끝 뾰족한 곳을 뺀 직사각 부분에만 흐르는 사선 (기기 픽셀 단위로 흘러 선명하다)
    const tip = (G.barH - 6) / 2;
    const sa = Math.max(a, tip);
    const sb = Math.min(b, fw - tip);
    if (s === 'capturing' && sb > sa) {
      const z = this.kit.zoom;
      const period = Math.round(STRIPE_P * z);
      const n = Math.floor((gfxNow() / 1000) * STRIPE_SPEED * z) % period;
      this.stripe.set('gstripe', fx, fy).crop(sa, sb, this.side === 1 ? period - n : n);
    } else {
      this.stripe.show(false);
    }
    const alpha = blinkOff ? 0.3 : 1;
    this.frame.setAlpha(alpha);
    for (const sp of [this.fill, this.stripe, this.dia, this.chip]) sp.img.setAlpha(alpha);
    this.letter.setAlpha(alpha);
  }
}

interface CardParts {
  panel: Slice;
  well: Spr;
  sil: Spr;
  ring: Ring;
  name: CrispText;
  tag: Slice;
  tagText: CrispText;
  sub: CrispText;
  stIcon: Spr;
  stText: CrispText;
  hp: Spr[];
  hr: Slice;
  abIcon: Spr;
  abText: CrispText;
  jailText: CrispText;
  jail: Spr[];
}

export class Hud {
  private readonly isMonster: boolean;
  private readonly gauges: Gauge[];
  private readonly timerFrame: Slice;
  private readonly timerIcon: Spr;
  private readonly timerLabel: CrispText;
  private readonly digits: Digits;
  private timerMode: TimerMode = 'normal';
  private readonly cards: CardParts[] = [];
  private readonly slots: {
    tile: Slice;
    ring: Ring;
    icon: Spr;
    secs: CrispText;
    label: CrispText;
    keycap: Slice;
    key: CrispText;
  }[] = [];
  private slotState: ActionSlot[] = [];
  private readonly hint: { panel: Slice; icon: Spr; text: CrispText };
  private hintText = '';
  private toast: { text: string; until: number } | null = null;

  constructor(
    private readonly kit: HudKit,
    private readonly info: MatchInfo,
    private readonly balance: Balance,
    /** 터치 모드: 아래 띠 행동 칸(키캡)은 그리지 않는다 — 터치 버튼이 같은 상태를 보인다 (M11) */
    private readonly touchMode = false,
  ) {
    this.isMonster = info.role === 'monster';
    this.gauges = [new Gauge(kit, 'A', 1), new Gauge(kit, 'B', -1)];
    this.timerFrame = kit.slice(D_PANEL);
    this.timerIcon = kit.spr(D_ART);
    this.timerLabel = kit.text(0, HUD.timer.y, 15, WARN, D_TEXT, true).setOrigin(0, 0.5);
    this.digits = new Digits(kit, 28, D_TEXT);
    const c = HUD.leftCards;
    for (let i = 0; i < 3; i += 1) {
      this.cards.push({
        panel: kit.slice(D_PANEL),
        well: kit.spr(D_ART),
        sil: kit.spr(D_ART + 0.2),
        ring: new Ring(kit),
        name: kit.text(c.x + 68, 0, 18, UI.text, D_TEXT, true),
        tag: kit.slice(D_ART),
        tagText: kit.text(0, 0, 15, UI.background, D_TEXT, true).setOrigin(0.5, 0.5),
        sub: kit.text(c.x + 68, 0, 15, UI.text, D_TEXT),
        stIcon: kit.spr(D_ART),
        stText: kit.text(c.x + 86, 0, 15, UI.text, D_TEXT, true),
        hp: [kit.spr(D_ART), kit.spr(D_ART)],
        hr: kit.slice(D_ART),
        abIcon: kit.spr(D_ART),
        abText: kit.text(c.x + 30, 0, 15, UI.textDim, D_TEXT),
        jailText: kit.text(0, 0, 15, UI.textDim, D_TEXT).setOrigin(this.isMonster ? 0 : 1, 0),
        jail: [kit.spr(D_ART), kit.spr(D_ART)],
      });
    }
    for (let i = 0; i < 4; i += 1)
      this.slots.push({
        tile: kit.slice(D_PANEL),
        ring: new Ring(kit),
        icon: kit.spr(D_ART + 0.2),
        secs: kit.text(0, 0, 22, UI.white, D_TEXT + 0.5, true).setOrigin(0.5, 0.5),
        label: kit.text(0, 0, 17, UI.text, D_TEXT, true),
        keycap: kit.slice(D_ART),
        key: kit.text(0, 0, 15, UI.text, D_TEXT, true).setOrigin(0.5, 0.5),
      });
    this.hint = {
      panel: kit.slice(D_PANEL),
      icon: kit.spr(D_ART),
      text: kit.text(0, HUD.bottom.y, 17, UI.text, D_TEXT, true).setOrigin(0, 0.5),
    };
  }

  /** 짧은 안내 (예: 밀치기 범위 밖): 능력 칸 이름 자리에 잠깐 */
  flash(text: string, ms: number, nowMs: number): void {
    this.toast = { text, until: nowMs + ms };
  }

  update(snap: Snapshot, nowMs: number): void {
    this.drawTop(snap, nowMs);
    if (this.isMonster) this.drawAnon(snap.world.statusList ?? []);
    else this.drawTeam(snap);
    const hint = this.persistentHint(snap);
    this.drawHint(hint);
    const slots = hint ? [] : actionSlots(snap, this.balance, snap.you.role);
    this.drawSlots(this.touchMode ? [] : slots, nowMs);
    this.slotState = slots;
  }

  private persistentHint(snap: Snapshot): { text: string; icon: string } | null {
    const st = snap.you.surv?.status;
    if (st === 'imprisoned') return { text: HUD_TEXT.imprisonedHint, icon: FR.icon('prison', HC.red, 20) };
    if (st === 'dead' || st === 'escaped')
      return { text: HUD_TEXT.spectating, icon: FR.icon('eye', UI.textDim, 20) };
    if (this.isMonster && snap.world.monsterWait > 0)
      return {
        text: `${UI_TEXT.monsterWait} ${Math.ceil(snap.world.monsterWait)}초`,
        icon: FR.icon('timer', WARN, 20),
      };
    return null;
  }

  private drawTop(snap: Snapshot, nowMs: number): void {
    const w = snap.world;
    const blinkOff = Math.floor(nowMs / 500) % 2 === 1;
    this.gauges.forEach((g, i) => {
      const p = w.points[i];
      g.update(p, this.isMonster && p?.state === 'capturing' && blinkOff);
    });
    // 타이머: [아이콘] [최후] 0:00 — 가운데 정렬
    const T = HUD.timer;
    const v = timerView(w);
    this.timerMode = v.mode;
    const look = TIMER_LOOK[v.mode];
    this.timerFrame.set(`timer:${v.mode}`, T.x - T.w / 2, T.y - T.h / 2, T.w, T.h);
    setText(this.timerLabel, v.mode === 'grace' ? HUD_TEXT.last30 : '');
    this.timerLabel.setVisible(v.mode === 'grace');
    const labelW = v.mode === 'grace' ? this.timerLabel.width + 6 : 0;
    const total = 20 + 7 + labelW + this.digits.measure(v.text);
    const x0 = T.x - total / 2;
    this.timerIcon.set(FR.icon(look.icon, look.color, 20), x0 + 10, T.y);
    if (v.mode === 'grace') this.timerLabel.setPosition(x0 + 27, T.y);
    this.digits.set(v.text, x0 + 27 + labelW, T.y, look.text);
  }

  private drawTeam(snap: Snapshot): void {
    const c = HUD.leftCards;
    const list = teamCards(snap, this.info.roster, this.balance);
    const maxJail = this.balance.survivor.maxImprisonments;
    this.cards.forEach((p, i) => {
      const s = list[i];
      if (!s) {
        this.hideCard(p);
        return;
      }
      const x = c.x;
      const y = c.y + i * (c.h + c.gap);
      const alive = s.status === 'normal' || s.status === 'injured' || s.status === 'imprisoned';
      p.panel.set(s.me ? `card:${s.role}` : 'card', x, y, c.w, c.h);
      const dx = x + 34;
      const dy = y + 44;
      p.well.set('well', dx, dy);
      p.sil.set(FR.sil(s.role, alive), dx, dy);
      // 능력 쿨타임 링: 자유 상태에서만 채운다 (수감 · 사망 · 탈출이면 꺼진 링)
      const total = this.balance.roles[s.role].cooldown;
      const free = s.status === 'normal' || s.status === 'injured';
      p.ring.set(s.role, !free ? 0 : s.cd > 0 ? litTicks(1 - s.cd / total) : TICKS, dx, dy);
      setText(p.name, ROLE_CARDS[s.role].name, ACCENT[s.role].text);
      p.name.setPosition(x + 68, y + 11);
      if (s.me) {
        setText(p.tagText, HUD_TEXT.me);
        const tw = Math.ceil(p.tagText.width) + 12;
        p.tag.set('tag', x + c.w - 10 - tw, y + 12, tw, 20);
        p.tagText.setPosition(x + c.w - 10 - tw / 2, y + 22).setVisible(true);
      } else {
        p.tag.show(false);
        p.tagText.setVisible(false);
      }
      // 플레이어 이름 · 상태 (연결이 끊긴 팀원은 끊김 아이콘 + 글자)
      fitText(p.sub, s.name, c.w - 68 - 10);
      p.sub.setPosition(x + 68, y + 35).setVisible(true);
      const look = STATUS_LOOK[s.status];
      const off = !s.connected;
      p.stIcon.set(
        off ? FR.icon('disconnected', UI.textDim, 16) : FR.icon(look.icon, look.color, 16),
        x + 76,
        y + 70,
      );
      setText(
        p.stText,
        `${HUD_TEXT.status[s.status]}${off ? ` · ${HUD_TEXT.offline}` : ''}`,
        off ? UI.textDim : look.color,
      );
      p.stText.setPosition(x + 88, y + 60).setVisible(true);
      // 체력 칸 (연결이 끊긴 팀원은 상태 글자가 길어 숨긴다. 부상 여부는 상태 글자에 있다)
      const maxHp = this.balance.survivor.maxHp;
      p.hp.forEach((h, k) => {
        if (off || k >= maxHp) h.show(false);
        else h.set(k < s.hp ? `hp:${s.role}` : 'hp:off', x + c.w - 22 - (maxHp - 1 - k) * 20, y + 70);
      });
      p.hr.set('hr', x + 10, y + 89, c.w - 20, 2);
      // 아래 줄: 능력 준비 / 남은 초 · 수감 눈금
      const ready = free && s.cd <= 0;
      p.abIcon.set(FR.icon(ABILITY_ICON[s.role], ready ? ACCENT[s.role].text : HC.off, 16), x + 22, y + 107);
      setText(
        p.abText,
        `능력 ${s.cd > 0 ? `${Math.ceil(s.cd)}초` : '준비'}`,
        ready ? ACCENT[s.role].text : UI.textDim,
      );
      p.abText.setPosition(x + 34, y + 97).setVisible(true);
      this.drawJail(p, x, y + 107, s.jail, maxJail);
    });
  }

  /** 수감 눈금: 팀 카드는 오른쪽 끝에 맞추고, 익명 카드는 글자 줄(left)에서 시작한다 */
  private drawJail(p: CardParts, x: number, y: number, n: number, max: number, left?: number): void {
    const c = HUD.leftCards;
    setText(p.jailText, `수감 ${n}/${max}`, n > 0 ? HC.red : UI.textDim);
    const cx0 = left !== undefined ? left + Math.ceil(p.jailText.width) + 14 : x + c.w - 18 - (max - 1) * 13;
    p.jail.forEach((j, k) => j.set(k < n ? 'jail:on' : 'jail:off', cx0 + k * 13, y).show(k < max));
    // 원점은 만들 때 정한다 (팀 카드 = 오른쪽 끝 기준, 익명 카드 = 왼쪽)
    p.jailText.setPosition(left ?? cx0 - 12, y - 10).setVisible(true);
  }

  private hideCard(p: CardParts): void {
    p.panel.show(false);
    p.tag.show(false);
    p.hr.show(false);
    p.ring.show(false);
    for (const s of [p.well, p.sil, p.stIcon, p.abIcon, ...p.hp, ...p.jail]) s.show(false);
    for (const t of [p.name, p.tagText, p.sub, p.stText, p.abText, p.jailText]) t.setVisible(false);
  }

  /** 괴물 화면: 익명 상태 목록 (서버가 정렬해 보낸 순서 그대로, 역할 · 이름 · 체력 없음) */
  private drawAnon(list: readonly AnonStatus[]): void {
    const c = HUD.leftCards;
    const maxJail = this.balance.survivor.maxImprisonments;
    this.cards.forEach((p, i) => {
      const s = list[i];
      if (!s) {
        this.hideCard(p);
        return;
      }
      const x = c.x;
      const y = c.y + i * (c.hAnon + c.gap);
      p.panel.set('card', x, y, c.w, c.hAnon);
      const dx = x + 34;
      const dy = y + 40;
      p.well.set('well', dx, dy);
      p.sil.set(FR.sil('hidden', s.state !== 'dead' && s.state !== 'escaped'), dx, dy);
      p.ring.show(false);
      setText(p.name, `생존자 ${i + 1}`, UI.text);
      p.name.setPosition(x + 68, y + 12);
      p.tag.show(false);
      p.tagText.setVisible(false);
      p.sub.setVisible(false);
      const look = STATUS_LOOK[s.state];
      p.stIcon.set(FR.icon(look.icon, look.color, 16), x + 76, y + 50);
      setText(p.stText, HUD_TEXT.status[s.state], look.color);
      p.stText.setPosition(x + 88, y + 40).setVisible(true);
      for (const h of p.hp) h.show(false);
      p.hr.show(false);
      p.abIcon.show(false);
      p.abText.setVisible(false);
      this.drawJail(p, x, y + 74, s.imprisonCount, maxJail, x + 68);
    });
  }

  private drawHint(h: { text: string; icon: string } | null): void {
    const H = this.hint;
    if (!h) {
      H.panel.show(false);
      H.icon.show(false);
      H.text.setVisible(false);
      this.hintText = '';
      return;
    }
    setText(H.text, h.text);
    const w = 18 + 22 + 10 + Math.ceil(H.text.width) + 22;
    const x0 = VIEW_W / 2 - w / 2;
    const hh = HUD.hint.h;
    H.panel.set('hint', x0, HUD.bottom.y - hh / 2, w, hh);
    H.icon.set(h.icon, x0 + 18 + 11, HUD.bottom.y);
    H.text.setPosition(x0 + 18 + 22 + 10, HUD.bottom.y).setVisible(true);
    this.hintText = h.text;
  }

  private drawSlots(list: readonly ActionSlot[], nowMs: number): void {
    this.slotState = list.slice();
    const S = HUD.slot;
    const total = list.length * S.w + Math.max(0, list.length - 1) * S.gap;
    const x0 = VIEW_W / 2 - total / 2;
    const cy = HUD.bottom.y;
    const toast = this.toast && nowMs < this.toast.until ? this.toast.text : '';
    this.slots.forEach((p, i) => {
      const s = list[i];
      if (!s) {
        p.tile.show(false);
        p.keycap.show(false);
        p.ring.show(false);
        p.icon.show(false);
        for (const t of [p.secs, p.label, p.key]) t.setVisible(false);
        return;
      }
      const left = x0 + i * (S.w + S.gap);
      const tx = left + S.tile / 2;
      const on = s.state === 'ready' || s.state === 'active';
      const acc = ACCENT[s.accent];
      p.tile.set(
        s.state === 'active' ? `tile:${s.accent}:a` : s.state === 'ready' ? `tile:${s.accent}` : 'tile:off',
        left,
        cy - S.tile / 2,
        S.tile,
        S.tile,
      );
      const lit = s.state === 'blocked' ? 0 : s.fill >= 1 ? TICKS : litTicks(s.fill);
      p.ring.set(s.accent, lit, tx, cy);
      p.icon.set(slotIconFrame(s), tx, cy);
      const secs = s.state === 'cooldown' ? String(Math.ceil(s.cd)) : '';
      setText(p.secs, secs);
      p.secs.setPosition(tx, cy).setVisible(secs !== '');
      // 이름 (토스트가 있으면 능력 칸 이름 자리에 주황으로) + 키캡
      const showToast = i === 0 && toast !== '';
      setText(p.label, showToast ? toast : s.label, showToast ? WARN : on ? acc.text : UI.textDim);
      p.label.setPosition(left + S.tile + 10, cy - 25).setVisible(true);
      setText(p.key, s.key);
      const kw = Math.max(28, Math.ceil(p.key.width) + 16);
      p.keycap.set('kc', left + S.tile + 10, cy + 1, kw, 24);
      p.key.setPosition(left + S.tile + 10 + kw / 2, cy + 12.5).setVisible(true);
    });
  }

  /** 디버그 · 테스트 값 (hudDebug) */
  debug(): Record<string, number | boolean | string> {
    const [a, b] = this.gauges;
    return {
      pointA: a?.state ?? 'idle',
      pointB: b?.state ?? 'idle',
      // 상태에서 다시 계산하지 않고 칩에 실제로 건 프레임 (보이지 않으면 '')
      pointAChip: a?.chip.shown ? a.chip.frameName : '',
      pointBChip: b?.chip.shown ? b.chip.frameName : '',
      timer: this.timerMode,
      timerText: this.digits.text,
      timerFontGen: this.digits.measuredGen,
      slots: this.slotState.map((s) => `${s.id}:${s.state}`).join(','),
      hint: this.hintText,
      cardText: this.cards
        .filter((p) => p.panel.shown)
        .map((p) =>
          [p.name, p.tagText, p.sub, p.stText, p.abText, p.jailText]
            .filter((t) => t.visible)
            .map((t) => t.text)
            .join(' '),
        )
        .join(' | '),
    };
  }
}
