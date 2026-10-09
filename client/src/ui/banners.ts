// 배너와 스토리 텍스트 (VISUAL_SPEC 8장, STORY_TEXT 2장)
//  - 지속형 한 줄(위): 발각 > 최후의 30초 (괴물 재접속 대기). 조건이 끝나면 사라진다
//  - 괴물 경고 한 줄(같은 자리, 지속형이 없을 때): 감옥 캠핑 · 거점 지키기. 배너 목록(visible)에는 넣지 않는다
//  - 일시형 큐(그 아래): 점령 · 문 · 구조 · 포효 등, 문구별 표시 시간, 최대 2개 동시
//  - 메모 상자: 거점 메모 · 시작 문구 (벽 글씨 느낌, 알림 줄 아래 · 감옥 위, 알파 0.85)
// 배너는 아이콘 + 리본(양 끝 제비꼬리) + 톤 색: 발각 = 눈 + 빨강(#B91C1C), 경고 = 아이콘 + 주황(글자 #0B1622, 8.49:1),
// 정보 = 아이콘 + 청록(#0E7490). 색만으로 구분하지 않는다. 그림은 HUD 아틀라스 9조각이라 글이 바뀌어도 다시 굽지 않는다
import type { IconId } from '../art/icons';
import { NEON_DIM, UI } from '../art/palette';
import { fontGeneration } from './fonts';
import { FR, TONE, type Tone } from './hudArt';
import { hexColor, setText, type HudKit, type Slice, type Spr } from './hudKit';
import { HUD, VIEW_W } from './layout';
import { UI_FONT, makeText, type CrispText } from './text';

export interface BannerLine {
  text: string;
  tone: Tone;
  icon: IconId;
}

interface Item extends BannerLine {
  until: number;
  created: number;
}

/** 대기열에서 이보다 오래 기다린 알림은 버린다 (지난 일) */
const MAX_QUEUE_WAIT_MS = 6000;
const DEPTH = 60;

/** 리본 한 줄: 9조각 리본 + 아이콘 + 글자 */
class Ribbon {
  private readonly plate: Slice;
  private readonly icon: Spr;
  readonly text: CrispText;
  private sig = '';

  constructor(
    kit: HudKit,
    private readonly h: number,
    size: number,
  ) {
    this.plate = kit.slice(DEPTH);
    this.icon = kit.spr(DEPTH + 1);
    this.text = kit.text(0, 0, size, UI.white, DEPTH + 2, true).setOrigin(0, 0.5);
  }

  show(line: BannerLine | null, cy: number): void {
    if (!line) {
      if (this.sig === '') return;
      this.sig = '';
      this.plate.show(false);
      this.icon.show(false);
      this.text.setVisible(false);
      return;
    }
    // 폰트 세대도 넣는다: 늦게 받은 폰트로 글자 폭이 바뀌면 리본 폭을 다시 잰다
    const sig = `${fontGeneration()}|${line.tone}|${line.icon}|${line.text}|${cy}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const t = TONE[line.tone];
    setText(this.text, line.text, t.text);
    const notch = Math.round(this.h * 0.28);
    const pad = notch + 3 + this.h + 10;
    const w = pad + Math.ceil(this.text.width) + notch + 22;
    const x0 = Math.round(VIEW_W / 2 - w / 2);
    this.plate.set(`rb:${line.tone}:${this.h}`, x0, cy - this.h / 2, w, this.h);
    this.icon.set(FR.icon(line.icon, t.text, 24), x0 + notch + 3 + this.h / 2, cy);
    this.text.setPosition(x0 + pad, cy).setVisible(true);
  }
}

export class Banners {
  private readonly persistent: Ribbon;
  private readonly rows: Ribbon[];
  private readonly note: { plate: Slice; icon: Spr; text: CrispText };
  private queue: Item[] = [];
  private shown: Item[] = [];
  private notes: { text: string; ms: number }[] = [];
  private noteUntil = 0;
  /** 메모 상자 폭을 잰 폰트 세대 */
  private noteGen = 0;
  /** 디버그 · 테스트: 지금 보이는 문구들 (지속형 · 알림 · 메모. 괴물 경고 줄은 넣지 않는다) */
  visible: string[] = [];

  constructor(kit: HudKit) {
    const B = HUD.banner;
    this.persistent = new Ribbon(kit, B.h, 26);
    this.rows = [0, 1].map(() => new Ribbon(kit, B.rowH, 21));
    this.note = {
      plate: kit.slice(DEPTH),
      icon: kit.spr(DEPTH + 1),
      text: makeText(kit.scene, 0, 0, '', {
        fontFamily: UI_FONT,
        fontSize: '23px',
        color: hexColor(UI.text),
        align: 'center',
        wordWrap: { width: HUD.noteW, useAdvancedWrap: true },
        lineSpacing: 8,
      })
        .setOrigin(0.5, 0)
        .setDepth(DEPTH + 2),
    };
    this.note.text.setVisible(false);
  }

  push(text: string, seconds: number, tone: Tone, icon: IconId, nowMs: number = performance.now()): void {
    this.queue.push({ text, tone, icon, until: nowMs + seconds * 1000, created: nowMs });
  }

  pushNote(text: string, seconds: number): void {
    this.notes.push({ text, ms: seconds * 1000 });
  }

  /** 지속형(null이면 숨김)과 괴물 경고 줄(지속형이 없을 때 같은 자리) */
  update(persistent: BannerLine | null, warn: BannerLine | null, nowMs: number): void {
    this.persistent.show(persistent ?? warn, HUD.bannerY);
    this.shown = this.shown.filter((b) => b.until > nowMs);
    this.queue = this.queue.filter((b) => nowMs - b.created <= MAX_QUEUE_WAIT_MS);
    while (this.shown.length < this.rows.length && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      // 큐에서 기다린 만큼 늦게 시작하므로 표시 시간을 다시 잡는다
      const dur = next.until - nowMs;
      this.shown.push({ ...next, until: nowMs + Math.max(800, dur) });
    }
    const B = HUD.banner;
    this.rows.forEach((row, i) => row.show(this.shown[i] ?? null, HUD.bannerY + B.rowGap * (i + 1)));
    if (nowMs >= this.noteUntil) {
      const n = this.notes.shift();
      if (n) {
        this.showNote(n.text);
        this.noteUntil = nowMs + n.ms;
      } else {
        this.showNote('');
      }
    } else if (this.noteGen !== fontGeneration() && this.note.text.visible) {
      this.showNote(this.note.text.text);
    }
    this.visible = [
      ...(persistent ? [persistent.text] : []),
      ...this.shown.map((b) => b.text),
      ...(this.note.text.visible ? [this.note.text.text] : []),
    ];
  }

  /** 메모 상자: 가운데 위, 글자에 맞춘 판 + 왼쪽 연필 아이콘 (벽에 새긴 글) */
  private showNote(text: string): void {
    const N = this.note;
    this.noteGen = fontGeneration();
    if (!text) {
      N.plate.show(false);
      N.icon.show(false);
      N.text.setVisible(false);
      return;
    }
    N.text.setText(text).setVisible(true);
    const padX = 30;
    const padY = 14;
    const w = Math.ceil(N.text.width) + padX * 2 + 26;
    const h = Math.ceil(N.text.height) + padY * 2;
    const x0 = Math.round(VIEW_W / 2 - w / 2);
    N.plate.set('note', x0, HUD.noteY, w, h);
    N.icon.set(FR.icon('note', NEON_DIM, 20), x0 + 24, HUD.noteY + padY + 14);
    N.text.setPosition(x0 + padX + 26 + Math.ceil(N.text.width) / 2, HUD.noteY + padY);
  }
}
