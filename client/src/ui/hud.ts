// 역할별 HUD (VISUAL_SPEC 5장). 맵과 겹치지 않게 위 · 아래 띠와 좌우 여백에 둔다 (DECISIONS D3).
//  생존자: 위 가운데 거점 A · B 게이지와 남은 시간 / 왼쪽 팀 카드 3장 / 아래 가운데 내 능력 · 구조 게이지
//  괴물:   위 가운데 거점 게이지(점령 중 깜빡임)와 남은 시간 / 왼쪽 익명 생존자 상태 3칸 / 아래 가운데 공격 · 돌진 · 포효 쿨과 시야 모드
import type Phaser from 'phaser';
import type { AnonStatus, Balance, MatchInfo, Role, RoleId, Snapshot, SurvivorView } from '@decoy/shared';
import { HUD_TEXT, ROLE_CARDS, UI_TEXT } from '../data/storyText';
import { COLOR, ROLE_COLOR, hex } from '../render/colors';
import { HUD, VIEW_W } from './layout';

const FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  color = '#E2E8F0',
  bold = false,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, '', {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    fontStyle: bold ? 'bold' : 'normal',
  });
}

/** 같은 문자열이면 다시 그리지 않는다 (Text는 바뀔 때마다 캔버스를 새로 그린다) */
function setText(t: Phaser.GameObjects.Text, value: string): void {
  if (t.text !== value) t.setText(value);
}

function fmtTime(sec: number): string {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function statusKey(s: Pick<SurvivorView, 'status' | 'hp'>, maxHp: number): keyof typeof HUD_TEXT.status {
  if (s.status === 'dead') return 'dead';
  if (s.status === 'escaped') return 'escaped';
  if (s.status === 'imprisoned') return 'imprisoned';
  return (s.hp ?? maxHp) < maxHp ? 'injured' : 'normal';
}

interface TeamCard {
  g: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  prison: Phaser.GameObjects.Text;
}

export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly timer: Phaser.GameObjects.Text;
  private readonly gaugeLabels: Phaser.GameObjects.Text[];
  private readonly cards: TeamCard[] = [];
  private readonly bottomTexts: Phaser.GameObjects.Text[] = [];
  private readonly hint: Phaser.GameObjects.Text;
  private readonly isMonster: boolean;
  private toast: { text: string; until: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly info: MatchInfo,
    private readonly balance: Balance,
  ) {
    this.isMonster = info.role === 'monster';
    this.g = scene.add.graphics().setDepth(40);
    this.timer = txt(scene, HUD.timer.x, HUD.timer.y, 30, '#E2E8F0', true).setOrigin(0.5).setDepth(41);
    this.gaugeLabels = [HUD.gaugeA, HUD.gaugeB].map((p, i) =>
      txt(scene, p.x + 18, p.y, 20, '#E2E8F0', true)
        .setOrigin(0.5)
        .setDepth(41)
        .setText(i === 0 ? 'A' : 'B'),
    );
    const c = HUD.leftCards;
    for (let i = 0; i < 3; i += 1) {
      const y = c.y + i * (c.h + c.gap);
      this.cards.push({
        g: scene.add.graphics().setDepth(40),
        name: txt(scene, c.x + 46, y + 14, 18, '#E2E8F0', true).setDepth(41),
        status: txt(scene, c.x + 46, y + 42, 16).setDepth(41),
        prison: txt(scene, c.x + 46, y + 66, 15, '#94A3B8').setDepth(41),
      });
    }
    for (let i = 0; i < 4; i += 1)
      this.bottomTexts.push(txt(scene, 0, HUD.bottom.y, 17, '#E2E8F0').setOrigin(0.5).setDepth(41));
    this.hint = txt(scene, VIEW_W / 2, HUD.bottom.y - 46, 18, '#E2E8F0')
      .setOrigin(0.5)
      .setDepth(41);
  }

  /** 짧은 안내 (예: 밀치기 범위 밖) */
  flash(text: string, ms: number, nowMs: number): void {
    this.toast = { text, until: nowMs + ms };
  }

  update(snap: Snapshot, nowMs: number): void {
    const g = this.g;
    g.clear();
    this.drawTop(snap, nowMs);
    if (this.isMonster) {
      this.drawStatusList(snap.world.statusList ?? []);
      this.drawMonsterBottom(snap);
    } else {
      this.drawTeam(snap);
      this.drawSurvivorBottom(snap);
    }
    const toast = this.toast && nowMs < this.toast.until ? this.toast.text : '';
    setText(this.hint, toast || this.persistentHint(snap));
  }

  private persistentHint(snap: Snapshot): string {
    const st = snap.you.surv?.status;
    if (st === 'imprisoned') return HUD_TEXT.imprisonedHint;
    if (st === 'dead' || st === 'escaped') return HUD_TEXT.spectating;
    if (this.isMonster && snap.world.monsterWait > 0)
      return `${UI_TEXT.monsterWait} ${Math.ceil(snap.world.monsterWait)}초`;
    return '';
  }

  private drawTop(snap: Snapshot, nowMs: number): void {
    const g = this.g;
    const w = snap.world;
    if (w.grace !== null) setText(this.timer, `${HUD_TEXT.last30} ${fmtTime(w.grace)}`);
    else setText(this.timer, fmtTime(w.timeLeft));
    this.timer.setColor(w.grace !== null ? hex(COLOR.warn) : w.timeLeft < 60 ? '#F87171' : '#E2E8F0');
    const blinkOn = Math.floor(nowMs / 500) % 2 === 0;
    [HUD.gaugeA, HUD.gaugeB].forEach((pos, i) => {
      const p = w.points[i];
      if (!p) return;
      const done = p.state === 'done';
      const blink = this.isMonster && p.state === 'capturing' && !blinkOn;
      const a = blink ? 0.3 : 1;
      // 마름모 배지
      const cx = pos.x + 18;
      const cy = pos.y;
      g.lineStyle(2, done ? COLOR.pointRing : COLOR.pointLine, a);
      g.fillStyle(0x0b1622, 0.9);
      g.beginPath();
      g.moveTo(cx, cy - 16);
      g.lineTo(cx + 16, cy);
      g.lineTo(cx, cy + 16);
      g.lineTo(cx - 16, cy);
      g.closePath();
      g.fillPath();
      g.strokePath();
      this.gaugeLabels[i]?.setAlpha(a);
      // 게이지
      const bx = pos.x + 44;
      const bw = pos.w - 44;
      g.fillStyle(0x1e293b, 1);
      g.fillRoundedRect(bx, cy - 8, bw, 16, 6);
      g.fillStyle(p.state === 'blocked' ? COLOR.warn : COLOR.pointRing, done ? 1 : 0.9);
      if (p.progress > 0) g.fillRoundedRect(bx, cy - 8, Math.max(8, bw * p.progress), 16, 6);
      g.lineStyle(1, COLOR.pointLine, 0.4);
      g.strokeRoundedRect(bx, cy - 8, bw, 16, 6);
    });
  }

  private drawTeam(snap: Snapshot): void {
    const c = HUD.leftCards;
    const all: SurvivorView[] = [];
    const me = snap.you;
    const mine: SurvivorView = {
      id: me.id,
      x: me.move.x,
      y: me.move.y,
      face: me.move.face,
      role: me.role === 'monster' ? null : me.role,
      status: me.surv?.status ?? 'free',
      protected: (me.surv?.protectLeft ?? 0) > 0,
      hp: me.surv?.hp ?? null,
      imprisonCount: me.surv?.imprisonCount ?? null,
      abilityCd: me.surv?.abilityCd ?? null,
      rescue: me.surv?.rescue ?? null,
      spotted: me.surv?.spotted ?? null,
      connected: true,
    };
    all.push(mine, ...snap.survivors);
    const order: RoleId[] = ['runner', 'guard', 'scout'];
    all.sort((a, b) => order.indexOf(a.role ?? 'runner') - order.indexOf(b.role ?? 'runner'));
    all.forEach((s, i) => {
      const card = this.cards[i];
      if (!card || !s.role) return;
      const y = c.y + i * (c.h + c.gap);
      const role: RoleId = s.role;
      const color = ROLE_COLOR[role];
      const cg = card.g;
      cg.clear();
      cg.fillStyle(0x0f1b27, 0.92);
      cg.fillRoundedRect(c.x, y, c.w, c.h, 10);
      cg.lineStyle(2, s.id === me.id ? color : 0x334155, s.id === me.id ? 1 : 0.8);
      cg.strokeRoundedRect(c.x, y, c.w, c.h, 10);
      // 역할 아이콘 (원)
      cg.fillStyle(color, s.status === 'dead' ? 0.3 : 1);
      cg.fillCircle(c.x + 24, y + 26, 12);
      // 체력 칸 2개 (아이콘 아래)
      const maxHp = this.balance.survivor.maxHp;
      for (let k = 0; k < maxHp; k += 1) {
        const filled = s.status === 'free' && (s.hp ?? 0) > k;
        cg.fillStyle(filled ? color : 0x334155, 1);
        cg.fillRect(c.x + 46 + k * 22, y + 94, 18, 12);
      }
      // 능력 쿨타임 막대
      const cd = s.abilityCd ?? 0;
      const total = this.balance.roles[role].cooldown;
      cg.fillStyle(0x1e293b, 1);
      cg.fillRect(c.x + 12, y + c.h - 22, c.w - 24, 8);
      cg.fillStyle(cd > 0 ? 0x64748b : color, 1);
      cg.fillRect(c.x + 12, y + c.h - 22, (c.w - 24) * (cd > 0 ? 1 - cd / total : 1), 8);
      const info = this.info.roster.find((r) => r.id === s.id);
      card.name.setPosition(c.x + 46, y + 12);
      card.status.setPosition(c.x + 46, y + 40);
      card.prison.setPosition(c.x + 46, y + 64);
      setText(card.name, `${ROLE_CARDS[role].name}${s.id === me.id ? ' (나)' : ''}`);
      card.name.setColor(hex(color));
      const st = HUD_TEXT.status[statusKey(s, maxHp)];
      setText(
        card.status,
        `${info?.name ?? ''} · ${st}${s.connected === false ? ` · ${HUD_TEXT.offline}` : ''}`,
      );
      setText(
        card.prison,
        `수감 ${s.imprisonCount ?? 0}/${this.balance.survivor.maxImprisonments}${cd > 0 ? `  능력 ${Math.ceil(cd)}초` : '  능력 준비'}`,
      );
    });
  }

  private drawStatusList(list: readonly AnonStatus[]): void {
    const c = HUD.leftCards;
    const colors: Record<AnonStatus['state'], number> = {
      normal: 0xf8fafc,
      injured: COLOR.warn,
      imprisoned: COLOR.prison,
      dead: 0x64748b,
      escaped: COLOR.exitActive,
    };
    list.forEach((s, i) => {
      const card = this.cards[i];
      if (!card) return;
      const h = 92;
      const y = c.y + i * (h + c.gap);
      const cg = card.g;
      cg.clear();
      cg.fillStyle(0x0f1b27, 0.92);
      cg.fillRoundedRect(c.x, y, c.w, h, 10);
      cg.lineStyle(2, 0x334155, 0.8);
      cg.strokeRoundedRect(c.x, y, c.w, h, 10);
      // 정체를 숨긴 흰 원 (역할 · 위치 없음)
      cg.fillStyle(colors[s.state], s.state === 'dead' ? 0.4 : 1);
      cg.fillCircle(c.x + 24, y + 26, 12);
      card.name.setPosition(c.x + 46, y + 12);
      card.status.setPosition(c.x + 46, y + 38);
      card.prison.setPosition(c.x + 46, y + 62);
      setText(card.name, `생존자 ${i + 1}`);
      card.name.setColor('#F8FAFC');
      setText(card.status, HUD_TEXT.status[s.state]);
      setText(card.prison, `수감 ${s.imprisonCount}/${this.balance.survivor.maxImprisonments}`);
    });
  }

  /** 아래 가운데 아이콘: 둥근 사각 + 쿨타임 채움 + 글자 */
  private slot(
    i: number,
    count: number,
    label: string,
    key: string,
    cd: number,
    total: number,
    color: number,
    active = false,
  ): void {
    const g = this.g;
    const w = 150;
    const x = VIEW_W / 2 - (count * w) / 2 + i * w + 6;
    const y = HUD.bottom.y - 24;
    g.fillStyle(0x0f1b27, 0.95);
    g.fillRoundedRect(x, y, w - 12, 48, 8);
    if (cd > 0) {
      g.fillStyle(0x334155, 1);
      g.fillRoundedRect(x, y, (w - 12) * (1 - cd / Math.max(0.001, total)), 48, 8);
    } else {
      g.fillStyle(color, active ? 0.55 : 0.3);
      g.fillRoundedRect(x, y, w - 12, 48, 8);
    }
    g.lineStyle(2, cd > 0 ? 0x475569 : color, 1);
    g.strokeRoundedRect(x, y, w - 12, 48, 8);
    const t = this.bottomTexts[i];
    if (!t) return;
    t.setX(x + (w - 12) / 2);
    setText(t, cd > 0 ? `${label} ${Math.ceil(cd)}` : `${label} [${key}]`);
  }

  private drawMonsterBottom(snap: Snapshot): void {
    const mon = snap.you.mon;
    if (!mon) return;
    const m = this.balance.monster;
    this.slot(
      0,
      4,
      HUD_TEXT.attack,
      '좌클릭',
      mon.attackCd,
      m.attack.cooldown,
      COLOR.monster,
      mon.windup > 0,
    );
    this.slot(1, 4, HUD_TEXT.dash, 'Shift', mon.dashCd, m.dash.cooldown, COLOR.monster);
    this.slot(2, 4, HUD_TEXT.roar, 'Q', mon.roarCd, m.roar.cooldown, COLOR.warn);
    const modeName = mon.mode === 'hunt' ? UI_TEXT.modeHunt : UI_TEXT.modeSearch;
    this.slot(3, 4, modeName, '우클릭', 0, 1, COLOR.coneIdle, mon.mode === 'hunt');
  }

  private drawSurvivorBottom(snap: Snapshot): void {
    const s = snap.you.surv;
    const role = snap.you.role as Role;
    if (!s || role === 'monster') return;
    const cfg = this.balance.roles[role];
    const card = ROLE_CARDS[role];
    const name = card.ability.split(' — ')[0]?.replace('Space ', '') ?? '';
    this.slot(0, 2, name, 'Space', s.abilityCd, cfg.cooldown, ROLE_COLOR[role], s.abilityActive > 0);
    // 구조 게이지 (구조 중일 때)
    if (s.rescue > 0) {
      this.slot(
        1,
        2,
        `${HUD_TEXT.rescuing} ${Math.round(s.rescue * 100)}%`,
        'E',
        0,
        1,
        COLOR.pointRing,
        true,
      );
    } else {
      this.slot(1, 2, '구조', 'E', 0, 1, 0x475569);
    }
  }

  destroy(): void {
    this.g.destroy();
    this.timer.destroy();
    for (const t of this.gaugeLabels) t.destroy();
    for (const c of this.cards) {
      c.g.destroy();
      c.name.destroy();
      c.status.destroy();
      c.prison.destroy();
    }
    for (const t of this.bottomTexts) t.destroy();
    this.hint.destroy();
  }
}
