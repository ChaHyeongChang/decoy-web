// 월드 렌더링 (TECH_SPEC 5장 순서). 맵 위 레이어를 컨테이너 하나에 담아 0.93배로 그린다.
//  1 배경 · 2 바닥 · 벽 → 3 거점 · 탈출구 영역 → 4 시야 원 / 근접 원 → 5 괴물 부채꼴(괴물 화면)
//  → 6 안개 → (생존자 화면: 괴물 부채꼴, DECISIONS D4) → 7 캐릭터 · 효과 → 8 항상 표시 배지
import type Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  PRISON_CENTER,
  inCircleVision,
  monsterConePolygon,
  monsterNearPolygon,
  monsterSees,
  survivorVisionPolygon,
  survivorVisionRadius,
  type Balance,
  type DrawnEntity,
  type MonsterView,
  type Role,
  type RoleId,
  type Snapshot,
  type SurvivorView,
  type Vec2,
} from '@decoy/shared';
import { MAP_SCALE, MAP_X, MAP_Y } from '../ui/layout';
import {
  drawAttackRange,
  drawMonster,
  drawRescueRing,
  drawRoarMark,
  drawRoarPing,
  drawSurvivor,
  drawTrackMark,
} from './characters';
import { ALPHA, COLOR, ROLE_COLOR } from './colors';
import { BaseLayer } from './baseLayer';
import { Badges, type BadgeAlpha } from './objects';
import { fillPolygon, mixColor } from './vision';

export interface FrameView {
  balance: Balance;
  snap: Snapshot;
  role: Role;
  selfId: string;
  /** 예측한 내 위치 */
  me: { x: number; y: number; face: number } | null;
  /** 보간한 다른 생존자들 (괴물 화면: 시야 안 생존자만, 임시 ID) */
  survivors: Map<string, SurvivorView>;
  /** 보간한 괴물 (생존자 화면: 보일 때만) */
  monster: MonsterView | null;
  /** 괴물 화면: 내 부채꼴 모양 보간값 */
  myBlend: number;
  nowMs: number;
  /** 괴물 화면: 포효로 드러난 생존자 위치 (발동 순간 고정, 1.5초) */
  roarPings: { x: number; y: number; until: number; start: number }[];
}

/** 시야 원 · 안개 갱신 주기 (ms). 생존자 시야는 0.1초 이하, 괴물 부채꼴은 판정과 맞게 자주 */
const SURVIVOR_FOG_MS = 50;
const MONSTER_FOG_MS = 33;

export class WorldRenderer {
  readonly container: Phaser.GameObjects.Container;
  /** 바닥 · 영역 · 시야 · 안개 합성 한 장 (레이어 1~6) */
  private readonly base: BaseLayer;
  private readonly useFog: boolean;
  private readonly coneOver: Phaser.GameObjects.Graphics;
  private readonly entities: Phaser.GameObjects.Graphics;
  private readonly badges: Badges;
  private lastFogAt = -1e9;
  /** 부채꼴 색 (노랑 0 ↔ 빨강 1) 보간 상태 */
  private coneRed = 0;
  drawn: DrawnEntity[] = [];

  constructor(scene: Phaser.Scene, useFog: boolean) {
    this.useFog = useFog;
    this.base = new BaseLayer(scene, useFog);
    this.container = scene.add.container(MAP_X, MAP_Y).setScale(MAP_SCALE);
    this.coneOver = scene.add.graphics();
    this.entities = scene.add.graphics();
    this.container.add([this.coneOver, this.entities]);
    this.badges = new Badges(scene, this.container);
  }

  /** 생존자 팀 시야의 눈들 (자기 + 팀원, 사망 · 탈출 제외) */
  private survivorEyes(v: FrameView): { pos: Vec2; role: RoleId }[] {
    const eyes: { pos: Vec2; role: RoleId }[] = [];
    const st = v.snap.you.surv?.status;
    if (v.me && v.role !== 'monster' && st !== 'dead' && st !== 'escaped')
      eyes.push({ pos: v.me, role: v.role });
    for (const s of v.survivors.values()) {
      if (s.status === 'dead' || s.status === 'escaped' || !s.role) continue;
      eyes.push({ pos: s, role: s.role });
    }
    return eyes;
  }

  draw(v: FrameView, frameMs: number): void {
    const { balance, snap } = v;
    const isMonster = v.role === 'monster';
    const drawn: DrawnEntity[] = [];

    // 1~6. 바닥 · 거점 · 탈출구 영역 · 시야 원 · (괴물 화면) 부채꼴 · 안개 — 갱신 주기마다 한 장으로 합성
    const fogDue = v.nowMs - this.lastFogAt >= (isMonster ? MONSTER_FOG_MS : SURVIVOR_FOG_MS);
    const eyes = isMonster ? [] : this.survivorEyes(v);
    if (fogDue) {
      this.lastFogAt = v.nowMs;
      const b = this.base;
      b.begin();
      b.drawPoints(snap.world.points, balance);
      b.drawExits(snap.world.exits, balance);
      if (isMonster && v.me) {
        const near = monsterNearPolygon(balance, v.me);
        const cone = monsterConePolygon(balance, v.me, v.me.face, v.myBlend);
        b.fillPoly(near, COLOR.nearCircle, ALPHA.nearCircle);
        b.fillPoly(cone, COLOR.coneIdle, ALPHA.coneIdle);
        b.addHardLight(near);
        b.addHardLight(cone);
      } else {
        for (const e of eyes) {
          const r = survivorVisionRadius(balance, e.role);
          const poly = survivorVisionPolygon(e.pos, r);
          b.fillPoly(poly, ROLE_COLOR[e.role], ALPHA.visionCircle);
          b.addSoftLight({ poly, center: e.pos, radius: r, soft: balance.survivor.visionSoftEdge });
        }
      }
      b.commit();
    }

    // 생존자 화면: 괴물 부채꼴 (보일 때만, 안개 위에 전체 모양)
    this.coneOver.clear();
    if (!isMonster && v.monster) {
      const m = v.monster;
      const target = m.seesSomeone ? 1 : 0;
      // 노랑 → 빨강 0.1초, 빨강 → 노랑 0.4초 (VISUAL_SPEC 4장)
      const rate = target > this.coneRed ? frameMs / 100 : frameMs / 400;
      this.coneRed =
        target > this.coneRed ? Math.min(1, this.coneRed + rate) : Math.max(0, this.coneRed - rate);
      const cone = monsterConePolygon(balance, m, m.aim, m.blend);
      const color = mixColor(COLOR.coneIdle, COLOR.coneSeen, this.coneRed);
      const alpha = ALPHA.coneIdle + (ALPHA.coneSeen - ALPHA.coneIdle) * this.coneRed;
      fillPolygon(this.coneOver, cone, color, alpha);
    }

    // 7. 캐릭터 · 공격 범위 · 구조 게이지
    const g = this.entities;
    g.clear();
    const atk = balance.monster.attack;
    // 공격 준비 범위 (양쪽 화면, 흰색 25%): 괴물을 따라가고 방향은 고정
    if (isMonster && v.me && (snap.you.mon?.windup ?? 0) > 0)
      drawAttackRange(g, v.me.x, v.me.y, v.me.face, atk.range, atk.arc);
    if (!isMonster && v.monster && v.monster.windup > 0)
      drawAttackRange(g, v.monster.x, v.monster.y, v.monster.aim, atk.range, atk.arc);
    const blinkFast = Math.floor(v.nowMs / 150) % 2 === 0;
    for (const [id, s] of v.survivors) {
      if (s.status === 'dead' || s.status === 'escaped') continue;
      const color = isMonster || !s.role ? COLOR.hiddenSurvivor : ROLE_COLOR[s.role];
      const revealColor =
        isMonster && s.role ? ROLE_COLOR[s.role] : s.protected && blinkFast ? COLOR.white : null;
      drawSurvivor(g, s.x, s.y, s.face, color, s.protected ? ALPHA.protected : 1, revealColor);
      if (s.rescue !== null && s.rescue > 0) drawRescueRing(g, s.x, s.y, s.rescue);
      drawn.push({ id, kind: 'survivor', x: s.x, y: s.y, face: s.face, layer: 'main' });
    }
    if (!isMonster && v.monster) {
      const m = v.monster;
      drawMonster(g, m.x, m.y, m.aim);
      drawn.push({ id: 'monster', kind: 'monster', x: m.x, y: m.y, face: m.aim, layer: 'main' });
    }
    if (v.me) {
      const st = snap.you.surv?.status;
      if (isMonster) drawMonster(g, v.me.x, v.me.y, v.me.face);
      else if (st !== 'dead' && st !== 'escaped') {
        const prot = (snap.you.surv?.protectLeft ?? 0) > 0;
        drawSurvivor(
          g,
          v.me.x,
          v.me.y,
          v.me.face,
          ROLE_COLOR[v.role],
          prot ? ALPHA.protected : 1,
          prot && blinkFast ? COLOR.white : null,
        );
        const rescue = snap.you.surv?.rescue ?? 0;
        if (rescue > 0) drawRescueRing(g, v.me.x, v.me.y, rescue);
      }
      drawn.push({ id: v.selfId, kind: 'self', x: v.me.x, y: v.me.y, face: v.me.face, layer: 'main' });
    }

    // 7-2. 안개 위 마커: 탐지(초록 다이아, 실시간), 포효한 괴물 위치(주황), 포효 핑(흰 원 펄스)
    for (const mk of snap.marks) {
      if (mk.kind === 'track') drawTrackMark(g, mk.x, mk.y, v.nowMs);
      else if (mk.kind === 'roarSelf') drawRoarMark(g, mk.x, mk.y, v.nowMs);
      drawn.push({
        id: `mark-${mk.kind}`,
        kind: 'mark',
        tag: mk.kind,
        x: mk.x,
        y: mk.y,
        face: 0,
        layer: 'main',
      });
    }
    for (const p of v.roarPings) {
      if (v.nowMs > p.until) continue;
      drawRoarPing(g, p.x, p.y, (v.nowMs - p.start) / (p.until - p.start));
      drawn.push({
        id: 'mark-roarPing',
        kind: 'mark',
        tag: 'roarPing',
        x: p.x,
        y: p.y,
        face: 0,
        layer: 'main',
      });
    }

    // 8. 항상 표시 배지 (지금 안 보이는 곳이면 45%)
    const seen = (p: Vec2): number => {
      if (!this.useFog) return 1;
      if (isMonster)
        return v.me && monsterSees(balance, v.me, v.me.face, v.myBlend, p) ? 1 : ALPHA.badgeUnseen;
      for (const e of eyes) if (inCircleVision(e.pos, survivorVisionRadius(balance, e.role), p)) return 1;
      return ALPHA.badgeUnseen;
    };
    const alpha: BadgeAlpha = {
      points: { A: seen(CAPTURE_POINTS.A), B: seen(CAPTURE_POINTS.B) },
      exits: { N: seen(EXITS.N.center), S: seen(EXITS.S.center) },
      prison: seen(PRISON_CENTER),
    };
    const blinkOn = Math.floor(v.nowMs / 500) % 2 === 0;
    const blink = {
      A: isMonster && blinkOn && snap.world.points.some((p) => p.id === 'A' && p.state === 'capturing'),
      B: isMonster && blinkOn && snap.world.points.some((p) => p.id === 'B' && p.state === 'capturing'),
    };
    this.badges.draw(snap.world.points, snap.world.exits, alpha, blink);
    this.drawn = drawn;
  }
}
