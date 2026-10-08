// 배너와 스토리 텍스트 (VISUAL_SPEC 4 · 5장, STORY_TEXT 2장)
//  - 지속형 한 줄(위): 발각 > 최후의 30초. 조건이 끝나면 사라진다
//  - 일시형 큐(그 아래): 점령 · 문 · 구조 · 포효 등, 문구별 표시 시간, 최대 2개 동시
//  - 메모 상자: 거점 메모 · 시작 문구 (플레이를 멈추지 않는 반투명 상자)
import type Phaser from 'phaser';
import { COLOR, hex } from '../render/colors';
import { HUD, VIEW_W } from './layout';
import { UI_FONT, makeText } from './text';

/** 배경색이 바뀔 때만 다시 그린다 */
function setBg(t: Phaser.GameObjects.Text, color: string): void {
  if (t.style.backgroundColor !== color) t.setBackgroundColor(color);
}

interface Item {
  text: string;
  color: number;
  until: number;
  created: number;
}

/** 대기열에서 이보다 오래 기다린 알림은 버린다 (지난 일) */
const MAX_QUEUE_WAIT_MS = 6000;

export class Banners {
  private readonly persistent: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Text[];
  private readonly note: Phaser.GameObjects.Text;
  private queue: Item[] = [];
  private shown: Item[] = [];
  private notes: { text: string; ms: number }[] = [];
  private noteUntil = 0;
  /** 디버그 · 테스트: 지금 보이는 문구들 */
  visible: string[] = [];

  constructor(scene: Phaser.Scene) {
    const style = (bg: string): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: UI_FONT,
      fontSize: '30px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      backgroundColor: bg,
      padding: { x: 20, y: 6 },
    });
    this.persistent = makeText(scene, VIEW_W / 2, HUD.bannerY, '', style('#B91C1C'))
      .setOrigin(0.5)
      .setDepth(60)
      .setVisible(false);
    this.rows = [0, 1].map((i) =>
      makeText(scene, VIEW_W / 2, HUD.bannerY + 58 + i * 52, '', { ...style('#0F1B27'), fontSize: '24px' })
        .setOrigin(0.5)
        .setDepth(60)
        .setVisible(false),
    );
    this.note = makeText(scene, VIEW_W / 2, HUD.noteY, '', {
      fontFamily: UI_FONT,
      fontSize: '24px',
      color: '#E2E8F0',
      backgroundColor: 'rgba(15,27,39,0.85)',
      padding: { x: 24, y: 14 },
      align: 'center',
      wordWrap: { width: 900, useAdvancedWrap: true },
      lineSpacing: 8,
    })
      .setOrigin(0.5)
      .setDepth(60)
      .setVisible(false);
  }

  push(
    text: string,
    seconds: number,
    color: number = COLOR.pointRing,
    nowMs: number = performance.now(),
  ): void {
    this.queue.push({ text, color, until: nowMs + seconds * 1000, created: nowMs });
  }

  pushNote(text: string, seconds: number): void {
    this.notes.push({ text, ms: seconds * 1000 });
  }

  /** 지속형: 빈 문자열이면 숨김 */
  update(persistentText: string, persistentColor: number, nowMs: number): void {
    if (persistentText) {
      if (this.persistent.text !== persistentText) this.persistent.setText(persistentText);
      setBg(this.persistent, hex(persistentColor));
      this.persistent.setVisible(true);
    } else {
      this.persistent.setVisible(false);
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
    this.rows.forEach((row, i) => {
      const b = this.shown[i];
      if (!b) {
        row.setVisible(false);
        return;
      }
      if (row.text !== b.text) row.setText(b.text);
      setBg(row, hex(b.color === COLOR.pointRing ? 0x0e7490 : b.color));
      row.setVisible(true);
    });
    if (nowMs >= this.noteUntil) {
      const n = this.notes.shift();
      if (n) {
        this.note.setText(n.text).setVisible(true);
        this.noteUntil = nowMs + n.ms;
      } else {
        this.note.setVisible(false);
      }
    }
    this.visible = [
      ...(persistentText ? [persistentText] : []),
      ...this.shown.map((b) => b.text),
      ...(this.note.visible ? [this.note.text] : []),
    ];
  }

  destroy(): void {
    this.persistent.destroy();
    for (const r of this.rows) r.destroy();
    this.note.destroy();
  }
}
