// 첫 판 조작 안내 오버레이(5초, 아무 키나 누르면 닫힘, 입력을 막지 않음)와 Tab 점수판 (M10c: 깎은 모서리 패널 + 키캡).
// Tab 점수판이 열리면 조작 안내는 닫힌다(GameScene, 겹침 버그). 점수판의 괴물 쪽은 익명 규칙 그대로(생존자 N · 상태 · 수감만).
// M12 터치: 점수판(점수판 버튼으로 켜고 끔)은 그림 HUD.s배 · 글자 CSS 12px 이상, 조작 안내는 터치 문구(controlsText 'touch'),
// 아래에 닫기 안내(화면을 누르면 닫힘). 낮은 화면에서 다 들어가지 않으면 조작 안내 줄을 빼고 상태 표만 보인다.
// 캐릭터 리디자인 2단계: 캐릭터 스타일이 새 캐릭터면 첫 판 조작 안내의 역할 문양 자리에 내 역할 정면 그림(상반신)을 둔다
// 설정 화면 통합: 따라가는 카메라(확대 화면)면 첫 판 조작 안내 아래에 화면 밖 화살표 한 줄(팀별) · 지도 누르기 한 줄을 더한다.
// 이 두 줄은 키 열 맞춤에 끼지 않는다(긴 '가장자리 화살표' 키캡이 위 줄들의 둘째 열을 밀지 않게)
import Phaser from 'phaser';
import type { AnonStatus, Balance, MatchInfo, Role, Snapshot } from '@decoy/shared';
import { CONTROLS, HELP_TEXT, HUD_TEXT, ROLE_CARDS, controlsText } from '../data/storyText';
import { MONSTER_ART, SURVIVOR_ART } from '../art/chars/index';
import { clearPathCache, drawToCanvas, type Drawing } from '../art/chars/kit';
import { FRONT_REST } from '../art/chars/types';
import { NEON, ROLE, UI } from '../art/palette';
import { currentCharStyle } from '../gfx/charStyle';
import { createCanvasTexture, makeCanvas, nextFogKey, removeCanvasTexture, rgba } from '../render/fogPaint';
import { ABILITY_ICON, ACCENT, FR, HC, STATUS_LOOK, parseControl, teamCards } from './hudArt';
import { fontGeneration } from './fonts';
import { Slice, Spr, fitText, setText, type HudKit } from './hudKit';
import { CAM_ZOOM, HUD, MAP_RECT, VIEW_W } from './layout';
import type { CrispText } from './text';

const DEPTH = 70;
const PAD = 32;
const ROW = 36;
/** 터치 점수판: 여백 · 조작 안내 줄 · 상태 행 높이 (그림 단위) */
const TOUCH_BOARD = { pad: 20, row: 30, line: 34 } as const;

/** 조작 안내 한 줄 높이 (논리 px) */
function rowH(): number {
  return (HUD.touch ? TOUCH_BOARD.row : ROW) * HUD.s;
}

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

/**
 * 조작 안내 한 줄. free = 키 열 맞춤에 끼지 않는 덧붙인 줄(첫 판 안내의 화면 밖 화살표 · 지도 줄): 제 폭으로만 놓는다.
 * icon = 목표 줄 아이콘 (없으면 블록 기본 goalIcon)
 */
type ControlLine =
  { k: 'goal'; spr: Spr; text: CrispText; icon?: string } | { k: 'pairs'; pairs: KeyPair[]; free?: boolean };

/** 덧붙이는 줄 (CONTROLS와 같은 형식의 글, 목표 줄 아이콘) */
interface ExtraLine {
  line: string;
  icon?: string;
}

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
    extra: readonly ExtraLine[] = [],
  ) {
    const text = (size: number, color: number, value: string, bold = false): CrispText =>
      kit.text(0, 0, size, color, DEPTH + 2, bold).setText(value);
    const F = HUD.font;
    const all: { line: string; free: boolean; icon?: string }[] = [
      ...lines.map((line) => ({ line, free: false })),
      ...extra.map((e) => ({ line: e.line, free: true, icon: e.icon })),
    ];
    for (const { line, free, icon } of all) {
      const r = parseControl(line);
      if (r.kind === 'goal') {
        this.lines.push({
          k: 'goal',
          spr: kit.spr(DEPTH + 1),
          text: text(F.ctrlGoal, UI.textDim, r.text),
          ...(icon ? { icon } : {}),
        });
        continue;
      }
      this.lines.push({
        k: 'pairs',
        free,
        pairs: r.pairs.map((p) => ({
          kc: kit.slice(DEPTH + 1),
          key: text(F.ctrlKey, UI.text, p.key, true).setOrigin(0.5, 0.5),
          note: p.note ? text(F.ctrlNote, UI.textDim, p.note) : null,
          desc: text(F.ctrlDesc, UI.text, p.desc),
          x: 0,
          kw: 0,
        })),
      });
    }
    this.layout();
  }

  /** 폰트 세대가 바뀌어 다시 재야 하는가 */
  get stale(): boolean {
    return this.gen !== fontGeneration();
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
    const k = HUD.s;
    let maxW = 0;
    const colW: number[] = [];
    /** 키 조각 하나의 폭 (키캡 + 덧말 + 설명) */
    const pairW = (p: KeyPair): number => {
      p.kw = Math.max(30 * k, Math.ceil(p.key.width) + 18 * k);
      let x = p.kw + 10 * k;
      if (p.note) x += Math.ceil(p.note.width) + 8 * k;
      return x + Math.ceil(p.desc.width);
    };
    for (const line of this.lines) {
      if (line.k === 'goal') {
        maxW = Math.max(maxW, 28 * k + line.text.width);
        continue;
      }
      if (line.free) {
        // 덧붙인 줄: 제 폭으로만 (조각마다 앞 조각 바로 뒤)
        let x = 0;
        line.pairs.forEach((p, i) => {
          if (i > 0) x += 34 * k;
          p.x = x;
          x += pairW(p);
        });
        maxW = Math.max(maxW, x);
        continue;
      }
      line.pairs.forEach((p, i) => {
        colW[i] = Math.max(colW[i] ?? 0, pairW(p));
      });
    }
    const start = colW.map((_, i) => colW.slice(0, i).reduce((a, w) => a + w + 34 * k, 0));
    for (const line of this.lines)
      if (line.k === 'pairs' && !line.free) line.pairs.forEach((p, i) => (p.x = start[i] ?? 0));
    const last = colW.length - 1;
    this.width = Math.max(maxW, (start[last] ?? 0) + (colW[last] ?? 0));
    this.height = this.lines.length * rowH() - 8 * k;
  }

  place(x: number, y: number): void {
    const k = HUD.s;
    // 터치: 키캡(24) 가운데에 글자 가운데를 맞춘다 (PC는 M10c 값 그대로)
    const mid = (t: CrispText, pc: number): number => (HUD.touch ? 13 * k - t.height / 2 : pc);
    this.lines.forEach((line, row) => {
      const dy = y + row * rowH();
      if (line.k === 'goal') {
        line.spr.set(line.icon ?? this.goalIcon, x + 9 * k, dy + 13 * k);
        line.text.setPosition(x + 28 * k, dy + mid(line.text, 2));
        return;
      }
      for (const p of line.pairs) {
        const px = x + p.x;
        p.kc.set('kc', px, dy + 1 * k, p.kw, 24 * k);
        p.key.setPosition(px + p.kw / 2, dy + 13.5 * k);
        let tx = px + p.kw + 10 * k;
        if (p.note) {
          p.note.setPosition(tx, dy + mid(p.note, 4));
          tx += Math.ceil(p.note.width) + 8 * k;
        }
        p.desc.setPosition(tx, dy + mid(p.desc, 2));
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
  /** 부품 이름 (만들 때의 kit.tag, 나중에 만드는 가로줄에도) */
  private readonly tag: string;

  constructor(private readonly kit: HudKit) {
    this.plate = kit.slice(DEPTH);
    this.tag = kit.tag;
  }

  rule(i: number, x: number, y: number, w: number): void {
    let s = this.lines[i];
    if (!s) {
      s = this.kit.named(this.tag, () => this.kit.slice(DEPTH + 1));
      this.lines[i] = s;
    }
    s.set('hr', x, y, w, 2);
  }

  show(on: boolean): void {
    this.plate.show(on);
    for (const l of this.lines) l.show(on);
  }
}

/** 첫 판 조작 안내 정면 그림 (새 캐릭터 스타일): 크기 · 머리줄 위 여백 (논리 px). 기존 스타일은 문양 32px · 머리줄 40 · 위 22 */
const FIGURE = { size: 64, top: 16, gap: 14 } as const;
/** 정면 그림 외곽선 (그림 단위: 반쪽 크기 = 1). 64px에서 약 1.5px */
const FIGURE_OUTLINE = 0.046;
/** 정면 그림 원판 바탕 (역할 문양 배지와 같은 어두운 남색) */
const FIGURE_DISC = 0x0b1622;

/** 내 역할 정면 그림 (상반신). 괴물이면 괴물, 생존자면 자기 역할 — 남의 역할은 그리지 않는다 */
function figureDrawing(role: Role): Drawing {
  const pose = { ...FRONT_REST, bust: true };
  const o = { w: FIGURE_OUTLINE };
  return role === 'monster' ? MONSTER_ART.front(pose, o) : SURVIVOR_ART[role].front(pose, o);
}

/**
 * 정면 그림 원판 캔버스 (px × px 기기 픽셀): 어두운 원판 + 아래에서 비치는 역할색 빛 + 원 안으로 자른 상반신 + 역할색 테두리.
 * 문양 배지(원판 + 역할색 테두리)와 같은 언어다
 */
function paintFigure(role: Role, px: number, dev: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(px, px);
  const r = px / 2;
  const ring = Math.max(1, Math.round(2 * dev));
  const inner = r - ring;
  const col = ROLE[role];
  ctx.beginPath();
  ctx.arc(r, r, r - ring / 2, 0, Math.PI * 2);
  ctx.fillStyle = rgba(FIGURE_DISC, 1);
  ctx.fill();
  const glow = ctx.createRadialGradient(r, px * 0.95, 0, r, px * 0.95, px * 0.75);
  glow.addColorStop(0, rgba(col, 0.42));
  glow.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, inner, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(r, r + inner * 0.06);
  drawToCanvas(ctx, figureDrawing(role), inner);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(r, r, r - ring / 2, 0, Math.PI * 2);
  ctx.lineWidth = ring;
  ctx.strokeStyle = rgba(col, 1);
  ctx.stroke();
  // 굽기 한 번이 끝났다: 해석해 둔 경로를 비운다 (판 동안 다시 쓰지 않는다)
  clearPathCache();
  return canvas;
}

/**
 * 첫 판 조작 안내의 내 역할 정면 그림 (새 캐릭터 스타일): 보일 때 작은 캔버스에 기기 픽셀 1:1로 한 번 그려 텍스처로 올리고
 * (텍스처 바이트 집계에 든다), 닫히면 · 장면이 끝나면 지운다. 기기 배율이 바뀌면 다시 그린다(1텍셀 = 기기 1px로 선명하게)
 */
class HelpFigure {
  private img: Phaser.GameObjects.Image | null = null;
  private key = '';
  private dev = 0;
  private x = 0;
  private y = 0;

  constructor(
    private readonly kit: HudKit,
    private readonly role: Role,
  ) {
    kit.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
  }

  /** 보이는데 기기 배율이 바뀌었다 (다시 그려야 한다) */
  get stale(): boolean {
    return this.img !== null && this.dev !== this.kit.dev;
  }

  /** 왼쪽 위 자리 (논리 px) */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.position();
  }

  show(on: boolean): void {
    if (!on) this.dispose();
    else if (!this.img || this.stale) this.paint();
  }

  private paint(): void {
    const dev = this.kit.dev;
    const scene = this.kit.scene;
    const key = nextFogKey('help-figure');
    createCanvasTexture(
      scene.textures,
      key,
      paintFigure(this.role, Math.max(8, Math.round(FIGURE.size * dev)), dev),
    );
    if (this.img) this.img.setTexture(key);
    else
      this.img = scene.add
        .image(0, 0, key)
        .setOrigin(0, 0)
        .setDepth(DEPTH + 1)
        .setName('helpFigure');
    if (this.key) removeCanvasTexture(scene.textures, this.key);
    this.key = key;
    this.dev = dev;
    this.img.setScale(1 / dev).setVisible(true);
    this.position();
  }

  /** 기준점을 기기 픽셀 격자에 맞춘다 (Spr와 같다) */
  private position(): void {
    if (!this.img) return;
    const z = this.dev;
    this.img.setPosition(Math.round(this.x * z) / z, Math.round(this.y * z) / z);
  }

  private dispose(): void {
    this.img?.destroy();
    this.img = null;
    if (this.key) removeCanvasTexture(this.kit.scene.textures, this.key);
    this.key = '';
  }
}

/** 첫 판 조작 안내가 맵 아래 끝에서 띄우는 최소 거리 (논리 px) */
const TUTORIAL_BOTTOM_GAP = 8;

/**
 * 첫 판 조작 안내에 덧붙이는 줄 (따라가는 카메라 확대 화면만): 화면 밖 화살표(생존자 · 괴물 따로) · 지도를 누르면 크게.
 * 확대 1(맵 전체가 보임)이면 화살표 · 크게 보기가 필요 없어 없다
 */
function tutorialExtraLines(team: 'monster' | 'survivor'): ExtraLine[] {
  if (CAM_ZOOM <= 1) return [];
  return [
    { line: team === 'monster' ? HELP_TEXT.edgeLineMonster : HELP_TEXT.edgeLineSurvivor },
    { line: HELP_TEXT.minimapTap, icon: FR.icon('map', NEON, 18) },
  ];
}

export class TutorialOverlay {
  private readonly panel: Panel;
  private readonly parts: Part[] = [];
  private readonly controls: ControlsBlock;
  /** 기존 스타일: 역할 문양 (새 캐릭터 스타일이면 숨기고 figure를 쓴다) */
  private readonly glyph: Spr;
  /** 새 캐릭터 스타일: 내 역할 정면 그림 (기존 스타일이면 null) */
  private readonly figure: HelpFigure | null;
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
    const prev = kit.tag;
    kit.tag = 'help';
    this.panel = new Panel(kit);
    this.glyph = kit.spr(DEPTH + 1);
    this.name = kit.text(0, 0, 24, ACCENT[info.role].text, DEPTH + 2, true).setText(card.name);
    this.ability = kit.text(0, 0, 18, UI.text, DEPTH + 2).setText(card.ability);
    this.close = kit.text(0, 0, 15, UI.textDim, DEPTH + 2).setText(HUD_TEXT.closeHint);
    this.controls = new ControlsBlock(
      kit,
      CONTROLS[team],
      team === 'monster' ? FR.icon('attack', HC.red, 18) : FR.icon('point', 0x22d3ee, 18),
      tutorialExtraLines(team),
    );
    kit.tag = prev;
    // 판 동안 바뀌지 않는다 (판 시작 때 스타일)
    this.figure = currentCharStyle() === 'new' ? new HelpFigure(kit, info.role) : null;
    this.layout();
    this.parts.push(this.glyph, this.name, this.ability, this.close);
    this.apply(false);
  }

  /** 글자 폭으로 패널 크기 · 자리를 정한다 (폰트가 늦게 오면 다시) */
  private layout(): void {
    this.gen = fontGeneration();
    this.controls.relayoutIfStale();
    const { glyph, figure, name, ability, close, info } = this;
    // 머리줄: 기존 = 문양 32px(글자는 44px 오른쪽), 새 캐릭터 = 정면 그림 64px(글자는 그림 가운데 높이)
    const top = figure ? FIGURE.top : 22;
    const headH = figure ? FIGURE.size : 40;
    const textX = figure ? FIGURE.size + FIGURE.gap : 44;
    const headW = textX + Math.ceil(name.width) + 16 + Math.ceil(ability.width);
    const w = Math.max(headW, this.controls.width, close.width) + PAD * 2;
    const h = top + headH + 18 + this.controls.height + 22 + 24 + 22;
    const x = Math.round(VIEW_W / 2 - w / 2);
    // 맵 아래쪽 1/3 가운데. 줄이 늘어 맵 아래 끝을 넘으면 그만큼 올린다 (아래 HUD 띠 · 행동 칸을 덮지 않게)
    const y = Math.round(Math.min(HUD.tutorialY - h / 2, MAP_RECT.y + MAP_RECT.h - TUTORIAL_BOTTOM_GAP - h));
    this.panel.plate.set('ov', x, y, w, h);
    if (figure) {
      glyph.set('', 0, 0);
      figure.place(x + PAD, y + top);
      const ny = Math.round(y + top + headH / 2 - name.height / 2);
      name.setPosition(x + PAD + textX, ny);
      ability.setPosition(x + PAD + textX + Math.ceil(name.width) + 16, ny + 5);
    } else {
      glyph.set(FR.glyph(info.role === 'monster' ? 'monster' : info.role, 32), x + PAD + 16, y + 22 + 18);
      name.setPosition(x + PAD + 44, y + 24);
      ability.setPosition(x + PAD + 44 + Math.ceil(name.width) + 16, y + 29);
    }
    this.panel.rule(0, x + PAD - 8, y + top + headH + 6, w - PAD * 2 + 16);
    this.controls.place(x + PAD, y + top + headH + 18);
    this.panel.rule(1, x + PAD - 8, y + h - 22 - 24 - 10, w - PAD * 2 + 16);
    close.setPosition(x + PAD, y + h - 22 - 20);
  }

  private apply(on: boolean): void {
    this.on = on;
    this.panel.show(on);
    this.controls.show(on);
    for (const p of this.parts) showPart(p, on);
    // 정면 그림은 보일 때 그리고 닫히면 텍스처까지 지운다
    this.figure?.show(on);
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
    else if (this.figure?.stale) this.figure.show(true);
  }

  get visible(): boolean {
    return this.on;
  }
}

/** 점수판 열 (패널 안쪽 왼쪽에서 그림 단위): 생존자 화면 = 역할 · 이름 · 상태 · 수감 · 능력, 괴물 화면 = 익명 · 상태 · 수감 */
const COLS_TEAM = { name: 150, st: 340, jail: 470, ab: 580, w: 690 };
const COLS_ANON = { name: 0, st: 170, jail: 310, ab: 0, w: 420 };
/** 터치 (글자가 그림보다 조금 커서 열 사이를 넓힌다) */
const COLS_TEAM_TOUCH = { name: 130, st: 290, jail: 460, ab: 560, w: 670 };
const COLS_ANON_TOUCH = { name: 0, st: 150, jail: 290, ab: 0, w: 400 };

/** 점수판 세로 치수 (그림 단위): 제목 y · 첫 가로줄 y · 첫 행 y · 행 간격 · 조작 안내 앞뒤 · 아래 여백 */
const BOARD_PC = { title: 20, rule: 60, top: 72, row: 40, ctrlGap: 16, after: 26 };
const BOARD_TOUCH = { title: 12, rule: 42, top: 52, row: TOUCH_BOARD.line, ctrlGap: 12, after: 12 };

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

/** Tab 점수판 · 상태 (+ 조작 안내 다시 보기). 터치는 점수판 버튼으로 켜고 끄며 아래에 닫기 안내 */
export class Scoreboard {
  private readonly panel: Panel;
  private readonly title: CrispText;
  private readonly rows: Row[] = [];
  private readonly controls: ControlsBlock;
  /** 터치: 닫기 안내 (PC는 null — Tab을 누르고 있는 동안만 보인다) */
  private readonly closeHint: CrispText | null;
  private w: number;
  private readonly cols: typeof COLS_TEAM;
  private on = false;
  private last = '';
  /** 마지막으로 그린 스냅샷 (열려 있는 동안 같은 스냅샷 · 같은 폰트 세대면 행을 다시 만들지 않는다) */
  private seen: Snapshot | null = null;
  /** 터치: 낮은 화면이라 조작 안내 줄을 뺐다 */
  private ctrlShown = true;

  constructor(
    private readonly kit: HudKit,
    private readonly info: MatchInfo,
    private readonly balance: Balance,
    /** 터치 모드 (M12): 조작 안내 터치 문구 + 닫기 안내 */
    touchMode = false,
  ) {
    const F = HUD.font;
    const prev = kit.tag;
    kit.tag = 'score';
    this.panel = new Panel(kit);
    this.title = kit.text(0, 0, F.boardTitle, UI.text, DEPTH + 2, true).setText(HUD_TEXT.scoreboard);
    const team = info.role === 'monster' ? 'monster' : 'survivor';
    this.controls = new ControlsBlock(
      kit,
      controlsText(team, touchMode ? 'touch' : 'keyboard'),
      team === 'monster' ? FR.icon('attack', HC.red, 18) : FR.icon('point', 0x22d3ee, 18),
    );
    this.closeHint = touchMode
      ? kit.text(0, 0, F.small, UI.textDim, DEPTH + 2).setText(HUD_TEXT.closeHintTouch)
      : null;
    for (let i = 0; i < 4; i += 1)
      this.rows.push({
        glyph: kit.spr(DEPTH + 1),
        role: kit.text(0, 0, F.boardRow, UI.text, DEPTH + 2, true),
        name: kit.text(0, 0, F.boardRow, UI.text, DEPTH + 2),
        stIcon: kit.spr(DEPTH + 1),
        st: kit.text(0, 0, F.boardCell, UI.text, DEPTH + 2, true),
        jail: kit.text(0, 0, F.boardCell, UI.textDim, DEPTH + 2),
        abIcon: kit.spr(DEPTH + 1),
        ab: kit.text(0, 0, F.boardCell, UI.textDim, DEPTH + 2),
      });
    kit.tag = prev;
    const t = HUD.touch !== null;
    this.cols = info.role === 'monster' ? (t ? COLS_ANON_TOUCH : COLS_ANON) : t ? COLS_TEAM_TOUCH : COLS_TEAM;
    this.w = this.width();
    this.apply(false);
  }

  /** 패널 폭 (논리 px) */
  private width(): number {
    const k = HUD.s;
    const pad = (HUD.touch ? TOUCH_BOARD.pad : PAD) * k;
    return Math.max(this.cols.w * k, this.controls.width, this.closeHint?.width ?? 0) + pad * 2;
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
    this.controls.show(on && this.ctrlShown);
    this.closeHint?.setVisible(on);
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
    // 열려 있고 스냅샷 · 폰트 세대가 그대로면 행 값도 그대로다 (렌더링 최적화 2: 프레임마다 행 · JSON 서명을 만들지 않는다)
    if (this.on && snap === this.seen && !this.controls.stale) return;
    this.seen = snap;
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
      this.w = this.width();
      this.last = '';
    }
    const sig = JSON.stringify(rows);
    if (sig === this.last && this.on) return;
    this.last = sig;
    const k = HUD.s;
    const touch = HUD.touch;
    const B = touch ? BOARD_TOUCH : BOARD_PC;
    const pad = (touch ? TOUCH_BOARD.pad : PAD) * k;
    const closeH = this.closeHint ? this.closeHint.height + 8 * k : 0;
    const height = (ctrl: boolean): number =>
      B.top * k +
      rows.length * B.row * k +
      (ctrl ? 14 * k + this.controls.height : 2 * k) +
      closeH +
      B.after * k;
    const x = Math.round(VIEW_W / 2 - this.w / 2);
    let h = height(true);
    let y = Math.round(HUD.scoreY - h / 2);
    if (touch) {
      // 오른쪽 위 시스템 버튼과 가로로 걸치면 그 아래부터. 다 들어가지 않으면 조작 안내 줄을 뺀다
      const S = touch.score;
      const top = x + this.w > S.sysLeft ? S.sysBottom : S.top;
      this.ctrlShown = h <= S.bottom - top;
      if (!this.ctrlShown) h = height(false);
      y = Math.round(Math.max(top, Math.min((top + S.bottom) / 2 - h / 2, S.bottom - h)));
    }
    this.panel.plate.set('ov', x, y, this.w, h);
    this.title.setPosition(x + pad, y + B.title * k).setVisible(true);
    this.panel.rule(0, x + pad - 8 * k, y + B.rule * k, this.w - pad * 2 + 16 * k);
    const top = y + B.top * k;
    // 터치: 글자를 행 가운데(문양 가운데)에 맞춘다 (PC는 M10c 값 그대로)
    const mid = (t: CrispText, pc: number): number => (touch ? 14 * k - t.height / 2 : pc);
    this.rows.forEach((r, i) => {
      const d = rows[i];
      if (!d) {
        this.showRow(r, false);
        return;
      }
      const ry = top + i * B.row * k;
      const cy = ry + 14 * k;
      r.glyph.set(d.glyph, x + pad + 12 * k, cy).show(true);
      setText(r.role, d.role, d.roleColor);
      r.role.setPosition(x + pad + 34 * k, ry + mid(r.role, 2)).setVisible(true);
      // 긴 이름(최대 12자)이 상태 아이콘을 덮지 않게 끝을 줄인다
      fitText(r.name, d.name, (this.cols.st - this.cols.name - 14) * k);
      r.name.setPosition(x + pad + this.cols.name * k, ry + mid(r.name, 2)).setVisible(d.name !== '');
      const look = d.st ? STATUS_LOOK[d.st] : null;
      r.stIcon
        .set(
          d.off ? FR.icon('disconnected', UI.textDim, 16) : look ? FR.icon(look.icon, look.color, 16) : '',
          x + pad + this.cols.st * k,
          cy,
        )
        .show(look !== null);
      setText(
        r.st,
        d.st ? `${HUD_TEXT.status[d.st]}${d.off ? ` · ${HUD_TEXT.offline}` : ''}` : '',
        d.off ? UI.textDim : (look?.color ?? UI.text),
      );
      r.st.setPosition(x + pad + (this.cols.st + 14) * k, ry + mid(r.st, 3)).setVisible(d.st !== null);
      setText(r.jail, d.jail);
      r.jail.setPosition(x + pad + this.cols.jail * k, ry + mid(r.jail, 3)).setVisible(d.jail !== '');
      r.abIcon.set(d.abIcon, x + pad + this.cols.ab * k, cy).show(d.abIcon !== '');
      setText(r.ab, d.ab);
      r.ab.setPosition(x + pad + (this.cols.ab + 14) * k, ry + mid(r.ab, 3)).setVisible(d.ab !== '');
    });
    const below = top + rows.length * B.row * k;
    this.panel.rule(1, x + pad - 8 * k, below + 2 * k, this.w - pad * 2 + 16 * k);
    if (this.ctrlShown) this.controls.place(x + pad, below + B.ctrlGap * k);
    const ctrlEnd = this.ctrlShown ? below + 14 * k + this.controls.height : below + 2 * k;
    this.closeHint?.setPosition(x + pad, ctrlEnd + 8 * k);
    if (!this.on) {
      this.on = true;
      this.panel.show(true);
      this.closeHint?.setVisible(true);
    }
    this.controls.show(this.ctrlShown);
  }
}
