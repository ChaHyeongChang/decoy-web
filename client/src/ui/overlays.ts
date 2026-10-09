// 첫 판 조작 안내 오버레이(5초, 아무 키나 누르면 닫힘, 입력을 막지 않음)와 Tab 점수판 (M10c: 깎은 모서리 패널 + 키캡).
// Tab 점수판이 열리면 조작 안내는 닫힌다(GameScene, 겹침 버그). 점수판의 괴물 쪽은 익명 규칙 그대로(생존자 N · 상태 · 수감만).
import type { AnonStatus, Balance, MatchInfo, Snapshot } from '@decoy/shared';
import { CONTROLS, HUD_TEXT, ROLE_CARDS } from '../data/storyText';
import { UI } from '../art/palette';
import { ABILITY_ICON, ACCENT, FR, HC, STATUS_LOOK, parseControl, teamCards } from './hudArt';
import { fontGeneration } from './fonts';
import { Slice, Spr, fitText, setText, type HudKit } from './hudKit';
import { HUD, VIEW_W } from './layout';
import type { CrispText } from './text';

const DEPTH = 70;
const PAD = 32;
const ROW = 36;

type Part = Spr | Slice | CrispText;

function showPart(p: Part, on: boolean): void {
  if (p instanceof Spr || p instanceof Slice) p.show(on);
  else p.setVisible(on);
}

/** 키 조각 하나: 키캡 + 키 글자 + (덧말) + 설명 */
interface KeyPair {
  kc: Slice;
  key: CrispText;
  note: CrispText | null;
  desc: CrispText;
  /** 배치 결과 (블록 왼쪽 위 기준 논리 px) */
  x: number;
  kw: number;
}

type ControlLine = { k: 'goal'; spr: Spr; text: CrispText } | { k: 'pairs'; pairs: KeyPair[] };

/**
 * 조작 안내 줄들 (키캡 + 덧말 + 설명, 목표 문장은 아이콘 + 글자). 글자 폭으로 열을 맞추고 place로 옮긴다.
 * 폰트가 늦게 오면(세대가 바뀌면) layout()으로 다시 잰다
 */
class ControlsBlock {
  private readonly lines: ControlLine[] = [];
  private gen = -1;
  width = 0;
  height = 0;

  constructor(
    kit: HudKit,
    lines: readonly string[],
    private readonly goalIcon: string,
  ) {
    const text = (size: number, color: number, value: string, bold = false): CrispText =>
      kit.text(0, 0, size, color, DEPTH + 2, bold).setText(value);
    for (const line of lines) {
      const r = parseControl(line);
      if (r.kind === 'goal') {
        this.lines.push({ k: 'goal', spr: kit.spr(DEPTH + 1), text: text(17, UI.textDim, r.text) });
        continue;
      }
      this.lines.push({
        k: 'pairs',
        pairs: r.pairs.map((p) => ({
          kc: kit.slice(DEPTH + 1),
          key: text(15, UI.text, p.key, true).setOrigin(0.5, 0.5),
          note: p.note ? text(15, UI.textDim, p.note) : null,
          desc: text(18, UI.text, p.desc),
          x: 0,
          kw: 0,
        })),
      });
    }
    this.layout();
  }

  /** 폰트 세대가 바뀌었으면 다시 잰다 (true = 다시 쟀다) */
  relayoutIfStale(): boolean {
    if (this.gen === fontGeneration()) return false;
    this.layout();
    return true;
  }

  /** 줄마다 키 조각 k의 폭 → 열 k의 시작은 모든 줄의 앞 조각이 끝난 뒤 (키캡이 세로로 맞는다) */
  private layout(): void {
    this.gen = fontGeneration();
    let maxW = 0;
    const colW: number[] = [];
    for (const line of this.lines) {
      if (line.k === 'goal') {
        maxW = Math.max(maxW, 28 + line.text.width);
        continue;
      }
      line.pairs.forEach((p, k) => {
        p.kw = Math.max(30, Math.ceil(p.key.width) + 18);
        let x = p.kw + 10;
        if (p.note) x += Math.ceil(p.note.width) + 8;
        x += Math.ceil(p.desc.width);
        colW[k] = Math.max(colW[k] ?? 0, x);
      });
    }
    const start = colW.map((_, k) => colW.slice(0, k).reduce((a, w) => a + w + 34, 0));
    for (const line of this.lines)
      if (line.k === 'pairs') line.pairs.forEach((p, k) => (p.x = start[k] ?? 0));
    const last = colW.length - 1;
    this.width = Math.max(maxW, (start[last] ?? 0) + (colW[last] ?? 0));
    this.height = this.lines.length * ROW - 8;
  }

  place(x: number, y: number): void {
    this.lines.forEach((line, row) => {
      const dy = y + row * ROW;
      if (line.k === 'goal') {
        line.spr.set(this.goalIcon, x + 9, dy + 13);
        line.text.setPosition(x + 28, dy + 2);
        return;
      }
      for (const p of line.pairs) {
        const px = x + p.x;
        p.kc.set('kc', px, dy + 1, p.kw, 24);
        p.key.setPosition(px + p.kw / 2, dy + 13.5);
        let tx = px + p.kw + 10;
        if (p.note) {
          p.note.setPosition(tx, dy + 4);
          tx += Math.ceil(p.note.width) + 8;
        }
        p.desc.setPosition(tx, dy + 2);
      }
    });
  }

  show(on: boolean): void {
    for (const line of this.lines) {
      if (line.k === 'goal') {
        line.spr.show(on);
        line.text.setVisible(on);
        continue;
      }
      for (const p of line.pairs) {
        p.kc.show(on);
        p.key.setVisible(on);
        p.note?.setVisible(on);
        p.desc.setVisible(on);
      }
    }
  }
}

/** 패널 + 머리줄 + 가로줄 */
class Panel {
  readonly plate: Slice;
  readonly lines: Slice[] = [];

  constructor(private readonly kit: HudKit) {
    this.plate = kit.slice(DEPTH);
  }

  rule(i: number, x: number, y: number, w: number): void {
    let s = this.lines[i];
    if (!s) {
      s = this.kit.slice(DEPTH + 1);
      this.lines[i] = s;
    }
    s.set('hr', x, y, w, 2);
  }

  show(on: boolean): void {
    this.plate.show(on);
    for (const l of this.lines) l.show(on);
  }
}

export class TutorialOverlay {
  private readonly panel: Panel;
  private readonly parts: Part[] = [];
  private readonly controls: ControlsBlock;
  private readonly glyph: Spr;
  private readonly name: CrispText;
  private readonly ability: CrispText;
  private readonly close: CrispText;
  private gen = -1;
  private until = 0;
  private on = false;

  constructor(
    kit: HudKit,
    private readonly info: MatchInfo,
  ) {
    const team = info.role === 'monster' ? 'monster' : 'survivor';
    const card = ROLE_CARDS[info.role];
    this.panel = new Panel(kit);
    this.glyph = kit.spr(DEPTH + 1);
    this.name = kit.text(0, 0, 24, ACCENT[info.role].text, DEPTH + 2, true).setText(card.name);
    this.ability = kit.text(0, 0, 18, UI.text, DEPTH + 2).setText(card.ability);
    this.close = kit.text(0, 0, 15, UI.textDim, DEPTH + 2).setText(HUD_TEXT.closeHint);
    this.controls = new ControlsBlock(
      kit,
      CONTROLS[team],
      team === 'monster' ? FR.icon('attack', HC.red, 18) : FR.icon('point', 0x22d3ee, 18),
    );
    this.layout();
    this.parts.push(this.glyph, this.name, this.ability, this.close);
    this.apply(false);
  }

  /** 글자 폭으로 패널 크기 · 자리를 정한다 (폰트가 늦게 오면 다시) */
  private layout(): void {
    this.gen = fontGeneration();
    this.controls.relayoutIfStale();
    const { glyph, name, ability, close, info } = this;
    const headW = 44 + Math.ceil(name.width) + 16 + Math.ceil(ability.width);
    const w = Math.max(headW, this.controls.width, close.width) + PAD * 2;
    const h = 22 + 40 + 18 + this.controls.height + 22 + 24 + 22;
    const x = Math.round(VIEW_W / 2 - w / 2);
    const y = Math.round(HUD.tutorialY - h / 2);
    this.panel.plate.set('ov', x, y, w, h);
    glyph.set(FR.glyph(info.role === 'monster' ? 'monster' : info.role, 32), x + PAD + 16, y + 22 + 18);
    name.setPosition(x + PAD + 44, y + 24);
    ability.setPosition(x + PAD + 44 + Math.ceil(name.width) + 16, y + 29);
    this.panel.rule(0, x + PAD - 8, y + 22 + 40 + 6, w - PAD * 2 + 16);
    this.controls.place(x + PAD, y + 22 + 40 + 18);
    this.panel.rule(1, x + PAD - 8, y + h - 22 - 24 - 10, w - PAD * 2 + 16);
    close.setPosition(x + PAD, y + h - 22 - 20);
  }

  private apply(on: boolean): void {
    this.on = on;
    this.panel.show(on);
    this.controls.show(on);
    for (const p of this.parts) showPart(p, on);
  }

  show(nowMs: number, seconds: number): void {
    this.until = nowMs + seconds * 1000;
    this.apply(true);
  }

  /** close = 아무 키나 눌림 또는 Tab 점수판이 열림 */
  update(nowMs: number, close: boolean): void {
    if (!this.on) return;
    if (close || nowMs >= this.until) this.apply(false);
    else if (this.gen !== fontGeneration()) this.layout();
  }

  get visible(): boolean {
    return this.on;
  }
}

/** 점수판 열 (패널 안쪽 왼쪽에서 논리 px): 생존자 화면 = 역할 · 이름 · 상태 · 수감 · 능력, 괴물 화면 = 익명 · 상태 · 수감 */
const COLS_TEAM = { name: 150, st: 340, jail: 470, ab: 580, w: 690 };
const COLS_ANON = { name: 0, st: 170, jail: 310, ab: 0, w: 420 };

interface Row {
  glyph: Spr;
  role: CrispText;
  name: CrispText;
  stIcon: Spr;
  st: CrispText;
  jail: CrispText;
  abIcon: Spr;
  ab: CrispText;
}

/** Tab 점수판 · 상태 (+ 조작 안내 다시 보기) */
export class Scoreboard {
  private readonly panel: Panel;
  private readonly title: CrispText;
  private readonly rows: Row[] = [];
  private readonly controls: ControlsBlock;
  private w: number;
  private readonly cols: typeof COLS_TEAM;
  private on = false;
  private last = '';

  constructor(
    private readonly kit: HudKit,
    private readonly info: MatchInfo,
    private readonly balance: Balance,
  ) {
    this.panel = new Panel(kit);
    this.title = kit.text(0, 0, 22, UI.text, DEPTH + 2, true).setText(HUD_TEXT.scoreboard);
    const team = info.role === 'monster' ? 'monster' : 'survivor';
    this.controls = new ControlsBlock(
      kit,
      CONTROLS[team],
      team === 'monster' ? FR.icon('attack', HC.red, 18) : FR.icon('point', 0x22d3ee, 18),
    );
    for (let i = 0; i < 4; i += 1)
      this.rows.push({
        glyph: kit.spr(DEPTH + 1),
        role: kit.text(0, 0, 18, UI.text, DEPTH + 2, true),
        name: kit.text(0, 0, 18, UI.text, DEPTH + 2),
        stIcon: kit.spr(DEPTH + 1),
        st: kit.text(0, 0, 17, UI.text, DEPTH + 2, true),
        jail: kit.text(0, 0, 17, UI.textDim, DEPTH + 2),
        abIcon: kit.spr(DEPTH + 1),
        ab: kit.text(0, 0, 17, UI.textDim, DEPTH + 2),
      });
    this.cols = info.role === 'monster' ? COLS_ANON : COLS_TEAM;
    this.w = Math.max(this.cols.w, this.controls.width) + PAD * 2;
    this.apply(false);
  }

  /** 디버그 · 테스트: 보이는 행 글자 (괴물 화면에 이름 · 역할이 없는지) */
  get text(): string {
    if (!this.on) return '';
    return this.rows
      .map((r) =>
        [r.role, r.name, r.st, r.jail, r.ab]
          .filter((t) => t.visible)
          .map((t) => t.text)
          .join(' '),
      )
      .filter((t) => t !== '')
      .join(' | ');
  }

  get visible(): boolean {
    return this.on;
  }

  private apply(on: boolean): void {
    this.on = on;
    this.panel.show(on);
    this.title.setVisible(on);
    this.controls.show(on);
    if (!on) for (const r of this.rows) this.showRow(r, false);
  }

  private showRow(r: Row, on: boolean): void {
    for (const p of [r.glyph, r.role, r.name, r.stIcon, r.st, r.jail, r.abIcon, r.ab]) showPart(p, on);
  }

  update(show: boolean, snap: Snapshot | null): void {
    if (!show || !snap) {
      if (this.on) this.apply(false);
      return;
    }
    const max = this.balance.survivor.maxImprisonments;
    // 행: 생존자 화면 = 역할 문양 · 역할 · 이름 · 상태 · 수감 · 능력 (+ 괴물 이름), 괴물 화면 = 익명 상태 목록
    type R = {
      glyph: string;
      role: string;
      roleColor: number;
      name: string;
      st: keyof typeof STATUS_LOOK | null;
      off: boolean;
      jail: string;
      ab: string;
      abIcon: string;
    };
    const rows: R[] = [];
    if (this.info.role === 'monster') {
      (snap.world.statusList ?? []).forEach((s: AnonStatus, i) =>
        rows.push({
          glyph: FR.glyph('hidden', 22),
          role: `생존자 ${i + 1}`,
          roleColor: UI.text,
          name: '',
          st: s.state,
          off: false,
          jail: `수감 ${s.imprisonCount}/${max}`,
          ab: '',
          abIcon: '',
        }),
      );
    } else {
      for (const c of teamCards(snap, this.info.roster, this.balance)) {
        const free = c.status === 'normal' || c.status === 'injured';
        rows.push({
          glyph: FR.glyph(c.role, 22),
          role: ROLE_CARDS[c.role].name,
          roleColor: ACCENT[c.role].text,
          name: c.name,
          st: c.status,
          off: !c.connected,
          jail: `수감 ${c.jail}/${max}`,
          ab: `능력 ${c.cd > 0 ? `${Math.ceil(c.cd)}초` : '준비'}`,
          abIcon: FR.icon(ABILITY_ICON[c.role], free && c.cd <= 0 ? ACCENT[c.role].text : HC.off, 16),
        });
      }
      const m = this.info.roster.find((p) => p.role === 'monster');
      if (m)
        rows.push({
          glyph: FR.glyph('monster', 22),
          role: ROLE_CARDS.monster.name,
          roleColor: ACCENT.monster.text,
          name: m.name,
          st: null,
          off: false,
          jail: '',
          ab: '',
          abIcon: '',
        });
    }
    // 폰트가 늦게 왔으면 조작 안내 열 · 패널 폭을 다시 재고 전부 다시 놓는다
    if (this.controls.relayoutIfStale()) {
      this.w = Math.max(this.cols.w, this.controls.width) + PAD * 2;
      this.last = '';
    }
    const sig = JSON.stringify(rows);
    if (sig === this.last && this.on) return;
    this.last = sig;
    const h = 22 + 34 + 16 + rows.length * 40 + 14 + this.controls.height + 26;
    const x = Math.round(VIEW_W / 2 - this.w / 2);
    const y = Math.round(HUD.scoreY - h / 2);
    this.panel.plate.set('ov', x, y, this.w, h);
    this.title.setPosition(x + PAD, y + 20).setVisible(true);
    this.panel.rule(0, x + PAD - 8, y + 22 + 34 + 4, this.w - PAD * 2 + 16);
    const top = y + 22 + 34 + 16;
    this.rows.forEach((r, i) => {
      const d = rows[i];
      if (!d) {
        this.showRow(r, false);
        return;
      }
      const ry = top + i * 40;
      const cy = ry + 14;
      r.glyph.set(d.glyph, x + PAD + 12, cy).show(true);
      setText(r.role, d.role, d.roleColor);
      r.role.setPosition(x + PAD + 34, ry + 2).setVisible(true);
      // 긴 이름(최대 12자)이 상태 아이콘을 덮지 않게 끝을 줄인다
      fitText(r.name, d.name, this.cols.st - this.cols.name - 14);
      r.name.setPosition(x + PAD + this.cols.name, ry + 2).setVisible(d.name !== '');
      const look = d.st ? STATUS_LOOK[d.st] : null;
      r.stIcon
        .set(
          d.off ? FR.icon('disconnected', UI.textDim, 16) : look ? FR.icon(look.icon, look.color, 16) : '',
          x + PAD + this.cols.st,
          cy,
        )
        .show(look !== null);
      setText(
        r.st,
        d.st ? `${HUD_TEXT.status[d.st]}${d.off ? ` · ${HUD_TEXT.offline}` : ''}` : '',
        d.off ? UI.textDim : (look?.color ?? UI.text),
      );
      r.st.setPosition(x + PAD + this.cols.st + 14, ry + 3).setVisible(d.st !== null);
      setText(r.jail, d.jail);
      r.jail.setPosition(x + PAD + this.cols.jail, ry + 3).setVisible(d.jail !== '');
      r.abIcon.set(d.abIcon, x + PAD + this.cols.ab, cy).show(d.abIcon !== '');
      setText(r.ab, d.ab);
      r.ab.setPosition(x + PAD + this.cols.ab + 14, ry + 3).setVisible(d.ab !== '');
    });
    this.panel.rule(1, x + PAD - 8, top + rows.length * 40 + 2, this.w - PAD * 2 + 16);
    this.controls.place(x + PAD, top + rows.length * 40 + 16);
    if (!this.on) {
      this.on = true;
      this.panel.show(true);
      this.controls.show(true);
    }
  }
}
