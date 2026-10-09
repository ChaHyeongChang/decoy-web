// 배너와 스토리 텍스트 (VISUAL_SPEC 8장, STORY_TEXT 2장)
//  - 지속형 한 줄(위): 발각 > 최후의 30초 (괴물 재접속 대기). 조건이 끝나면 사라진다
//  - 괴물 경고 한 줄(같은 자리, 지속형이 없을 때): 감옥 캠핑 · 거점 지키기. 배너 목록(visible)에는 넣지 않는다
//  - 일시형 큐(그 아래): 점령 · 문 · 구조 · 포효 등, 문구별 표시 시간, 최대 2개 동시
//  - 메모 상자: 거점 메모 · 시작 문구 (벽 글씨 느낌, 알림 줄 아래 · 감옥 위, 알파 0.85)
// 배너는 아이콘 + 리본(양 끝 제비꼬리) + 톤 색: 발각 = 눈 + 빨강(#B91C1C), 경고 = 아이콘 + 주황(글자 #0B1622, 8.49:1),
// 정보 = 아이콘 + 청록(#0E7490). 색만으로 구분하지 않는다. 그림은 HUD 아틀라스 9조각이라 글이 바뀌어도 다시 굽지 않는다.
// M12 터치 배치: 그림 HUD.s배 · 글자 CSS 14px(넘치면 12px까지 줄인다), 맵 안 가로 범위(좌우 칸 HUD · 오른쪽 위 버튼을 비킨
// HUD.touch.overlay)에 두고 보이는 것만 위에서부터 쌓는다(지속 → 알림 → 메모). 낮은 화면에서 감옥을 덜 가린다
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

/** 가로 가운데 · 최대 폭: PC는 화면 가운데, 터치는 맵 안 범위 (HUD.touch.overlay) */
function span(): { cx: number; max: number } {
  const o = HUD.touch?.overlay;
  return o ? { cx: (o.x0 + o.x1) / 2, max: o.x1 - o.x0 } : { cx: VIEW_W / 2, max: Infinity };
}

/** 글자 크기 (같으면 다시 그리지 않는다) */
function fontSize(t: CrispText, px: number): void {
  if (t.style.fontSize !== `${px}px`) t.setFontSize(px);
}

/** 리본 한 줄: 9조각 리본 + 아이콘 + 글자 */
class Ribbon {
  private readonly plate: Slice;
  private readonly icon: Spr;
  readonly text: CrispText;
  private sig = '';

  constructor(
    kit: HudKit,
    /** 리본 높이 (그림 단위, 아틀라스 프레임 이름) */
    private readonly h: number,
    private readonly size: number,
  ) {
    this.plate = kit.slice(DEPTH);
    this.icon = kit.spr(DEPTH + 1);
    this.text = kit
      .text(0, 0, size, UI.white, DEPTH + 2, true)
      .setOrigin(0, 0.5)
      .setVisible(false);
  }

  /** 리본 높이 (논리 px) */
  get height(): number {
    return this.h * HUD.s;
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
    const k = HUD.s;
    const notch = Math.round(this.h * 0.28) * k;
    const h = this.h * k;
    const pad = notch + (3 + this.h + 10) * k;
    const sp = span();
    // 맵 안 범위를 넘으면 글자를 보조 글자 크기까지 줄인다 (터치)
    let size = this.size;
    fontSize(this.text, size);
    setText(this.text, line.text, t.text);
    const extra = pad + notch + 22 * k;
    while (Math.ceil(this.text.width) + extra > sp.max && size > HUD.font.small) {
      size = Math.max(HUD.font.small, size - 1);
      fontSize(this.text, size);
    }
    const w = extra + Math.ceil(this.text.width);
    const x0 = Math.round(sp.cx - w / 2);
    this.plate.set(`rb:${line.tone}:${this.h}`, x0, cy - h / 2, w, h);
    this.icon.set(FR.icon(line.icon, t.text, 24), x0 + notch + (3 + this.h / 2) * k, cy);
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
  /** 메모 상자 위 끝: PC 고정(HUD.noteY), 터치는 보이는 배너 아래 · 지금 놓인 자리 */
  private noteY = HUD.noteY;
  private noteAt = HUD.noteY;
  /** 디버그 · 테스트: 지금 보이는 문구들 (지속형 · 알림 · 메모. 괴물 경고 줄은 넣지 않는다) */
  visible: string[] = [];

  constructor(kit: HudKit) {
    const B = HUD.banner;
    const F = HUD.font;
    [this.persistent, this.rows] = kit.named('banner', () => [
      new Ribbon(kit, B.h, F.banner),
      [0, 1].map(() => new Ribbon(kit, B.rowH, F.bannerRow)),
    ]);
    this.note = kit.named('note', () => ({
      plate: kit.slice(DEPTH),
      icon: kit.spr(DEPTH + 1),
      text: makeText(kit.scene, 0, 0, '', {
        fontFamily: UI_FONT,
        fontSize: `${F.note}px`,
        color: hexColor(UI.text),
        align: 'center',
        wordWrap: { width: HUD.noteW, useAdvancedWrap: true },
        lineSpacing: F.noteLine,
      })
        .setOrigin(0.5, 0)
        .setDepth(DEPTH + 2)
        .setName('note'),
    }));
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
    const touch = HUD.touch;
    const gap = touch ? 6 * HUD.s : 0;
    // 터치: 보이는 것만 위에서부터 쌓는다 (PC는 고정 자리)
    let y = touch ? touch.overlay.top : 0;
    const top = persistent ?? warn;
    if (touch) {
      this.persistent.show(top, y + this.persistent.height / 2);
      if (top) y += this.persistent.height + gap;
    } else {
      this.persistent.show(top, HUD.bannerY);
    }
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
    this.rows.forEach((row, i) => {
      const line = this.shown[i] ?? null;
      if (!touch) {
        row.show(line, HUD.bannerY + B.rowGap * (i + 1));
        return;
      }
      row.show(line, y + row.height / 2);
      if (line) y += row.height + gap;
    });
    if (touch) this.noteY = y;
    if (nowMs >= this.noteUntil) {
      const n = this.notes.shift();
      if (n) {
        this.showNote(n.text);
        this.noteUntil = nowMs + n.ms;
      } else {
        this.showNote('');
      }
    } else if (
      this.note.text.visible &&
      (this.noteGen !== fontGeneration() || (touch !== null && this.noteAt !== this.noteY))
    ) {
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
    const k = HUD.s;
    const padX = (HUD.touch ? 16 : 30) * k;
    const padY = (HUD.touch ? 8 : 14) * k;
    const icon = 26 * k;
    const w = Math.ceil(N.text.width) + padX * 2 + icon;
    const h = Math.ceil(N.text.height) + padY * 2;
    const x0 = Math.round(span().cx - w / 2);
    const y = this.noteY;
    this.noteAt = y;
    N.plate.set('note', x0, y, w, h);
    N.icon.set(FR.icon('note', NEON_DIM, 20), x0 + padX * 0.8, y + padY + 14 * k);
    N.text.setPosition(x0 + padX + icon + Math.ceil(N.text.width) / 2, y + padY);
  }
}
