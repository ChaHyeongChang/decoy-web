// 첫 판 조작 안내 오버레이(5초, 아무 키나 누르면 닫힘, 입력을 막지 않음)와 Tab 점수판
import type Phaser from 'phaser';
import type { AnonStatus, Balance, MatchInfo, Snapshot } from '@decoy/shared';
import { CONTROLS, HUD_TEXT, ROLE_CARDS } from '../data/storyText';
import { VIEW_H, VIEW_W } from './layout';

const FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

function panelText(scene: Phaser.Scene, y: number, size: number): Phaser.GameObjects.Text {
  return scene.add
    .text(VIEW_W / 2, y, '', {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color: '#E2E8F0',
      backgroundColor: 'rgba(11,22,34,0.86)',
      padding: { x: 28, y: 18 },
      align: 'left',
      lineSpacing: 10,
    })
    .setOrigin(0.5)
    .setDepth(70)
    .setVisible(false);
}

export class TutorialOverlay {
  private readonly text: Phaser.GameObjects.Text;
  private until = 0;

  constructor(scene: Phaser.Scene, info: MatchInfo) {
    // 맵 아래쪽 1/3에, 입력을 막지 않는 반투명 상자로
    this.text = panelText(scene, VIEW_H * 0.76, 19);
    this.text.setAlpha(0.92);
    const team = info.role === 'monster' ? 'monster' : 'survivor';
    const card = ROLE_CARDS[info.role];
    this.text.setText(
      [`${card.name} — ${card.ability}`, '', ...CONTROLS[team], '', HUD_TEXT.closeHint].join('\n'),
    );
  }

  show(nowMs: number, seconds: number): void {
    this.until = nowMs + seconds * 1000;
    this.text.setVisible(true);
  }

  update(nowMs: number, anyKey: boolean): void {
    if (!this.text.visible) return;
    if (anyKey || nowMs >= this.until) this.text.setVisible(false);
  }

  get visible(): boolean {
    return this.text.visible;
  }

  destroy(): void {
    this.text.destroy();
  }
}

/** Tab 점수판 · 상태 (+ 조작 안내 다시 보기) */
export class Scoreboard {
  private readonly text: Phaser.GameObjects.Text;
  private last = '';

  constructor(
    scene: Phaser.Scene,
    private readonly info: MatchInfo,
    private readonly balance: Balance,
  ) {
    this.text = panelText(scene, VIEW_H / 2, 22);
  }

  update(show: boolean, snap: Snapshot | null): void {
    if (!show || !snap) {
      this.text.setVisible(false);
      return;
    }
    const lines: string[] = [HUD_TEXT.scoreboard, ''];
    const max = this.balance.survivor.maxImprisonments;
    if (this.info.role === 'monster') {
      // 괴물: 이름 · 역할 없는 익명 상태 목록
      (snap.world.statusList ?? []).forEach((s: AnonStatus, i) => {
        lines.push(`생존자 ${i + 1}   ${HUD_TEXT.status[s.state]}   수감 ${s.imprisonCount}/${max}`);
      });
    } else {
      const me = snap.you;
      const rows = [
        {
          id: me.id,
          role: me.role,
          st: me.surv?.status ?? 'free',
          hp: me.surv?.hp ?? 0,
          ic: me.surv?.imprisonCount ?? 0,
          cd: me.surv?.abilityCd ?? 0,
        },
        ...snap.survivors.map((s) => ({
          id: s.id,
          role: s.role ?? 'runner',
          st: s.status,
          hp: s.hp ?? 0,
          ic: s.imprisonCount ?? 0,
          cd: s.abilityCd ?? 0,
        })),
      ];
      for (const r of rows) {
        const name = this.info.roster.find((p) => p.id === r.id)?.name ?? '';
        const card = ROLE_CARDS[r.role];
        const st =
          r.st === 'free'
            ? r.hp < this.balance.survivor.maxHp
              ? HUD_TEXT.status.injured
              : HUD_TEXT.status.normal
            : HUD_TEXT.status[r.st === 'imprisoned' ? 'imprisoned' : r.st === 'dead' ? 'dead' : 'escaped'];
        lines.push(
          `${card.name.padEnd(5)} ${name}   ${st}   수감 ${r.ic}/${max}   능력 ${r.cd > 0 ? `${Math.ceil(r.cd)}초` : '준비'}`,
        );
      }
      const monster = this.info.roster.find((p) => p.role === 'monster');
      if (monster) lines.push(`괴물  ${monster.name}`);
    }
    lines.push('', ...CONTROLS[this.info.role === 'monster' ? 'monster' : 'survivor']);
    const text = lines.join('\n');
    if (text !== this.last) {
      this.text.setText(text);
      this.last = text;
    }
    this.text.setVisible(true);
  }

  destroy(): void {
    this.text.destroy();
  }
}
