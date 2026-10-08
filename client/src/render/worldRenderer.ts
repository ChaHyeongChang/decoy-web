// 월드 렌더링 (TECH_SPEC 5장 순서). 맵 위 레이어를 컨테이너 하나에 담아 0.93배로 그린다.
//  1 배경 · 2 바닥 · 벽 → 3 거점 · 탈출구 영역 → 4 시야 원 / 근접 원 → 5 괴물 부채꼴(괴물 화면)
//  → 6 안개(시야 밖 = 어두운 구조) → (생존자 화면: 괴물 부채꼴, DECISIONS D4 / 괴물 화면: 자기 시야 테두리)
//  → 7 캐릭터 · 효과 → 8 항상 표시 배지
// 1~6은 안개 레이어(baseLayer.ts)가 품질 · 렌더러에 맞는 방식(Canvas 한 장 합성 / GPU 합성)으로 그린다.
import Phaser from 'phaser';
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
import { effectivePreset, type RendererKind } from '../gfx/presets';
import { gfxState, onGfxChange } from '../gfx/state';
import { MAP_SCALE, MAP_X, MAP_Y } from '../ui/layout';
import {
  drawAttackRange,
  drawMonster,
  drawRescueRing,
  drawRoarMark,
  drawRoarPing,
  drawStunStars,
  drawSurvivor,
  drawTrackMark,
} from './characters';
import { DashTrail } from './effects';
import { ALPHA, COLOR, FOG, ROLE_COLOR } from './colors';
import { createFogLayer, type FogLayer } from './baseLayer';
import {
  ambientRgb,
  compositeScaleFor,
  fogPathFor,
  nextConeRed,
  opponentFxAllowed,
  rgbCss,
  unionOutline,
} from './fogMath';
import { Badges, type BadgeAlpha } from './objects';
import { fillPolygon, mixColor, strokeSegments } from './vision';

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
  /** 괴물 화면: 서버 확인 전에 먼저 보여 주는 공격 준비 방향 (없으면 null) */
  localWindupDir: number | null;
  /** 괴물 화면: 서버의 준비 값이 이미 예측으로 보여 준 것과 같은 준비라 다시 그리지 않는다 */
  hideServerWindup: boolean;
  /** 괴물 화면: 내가 기절 중 / 돌진 중 */
  myStunned: boolean;
  myDashing: boolean;
}

/** 시야 원 · 안개 갱신 주기 (ms). 생존자 시야는 0.1초 이하, 괴물 부채꼴은 판정과 맞게 자주 */
const SURVIVOR_FOG_MS = 50;
const MONSTER_FOG_MS = 33;

export class WorldRenderer {
  readonly container: Phaser.GameObjects.Container;
  /** 안개 레이어(1~6)를 담는 컨테이너. 캐릭터 컨테이너보다 먼저 만들어 항상 아래에 그린다 */
  private readonly fogRoot: Phaser.GameObjects.Container;
  /** 바닥 · 영역 · 시야 · 안개 (레이어 1~6) */
  private fog: FogLayer;
  /** 품질 · 렌더 해상도가 바뀌어 다음 프레임에 안개 레이어를 다시 만든다 */
  private fogDirty = false;
  private readonly useFog: boolean;
  private readonly scene: Phaser.Scene;
  /** 괴물 화면: 자기 시야(부채꼴 ∪ 근접 원) 테두리 선분 (안개와 같은 주기로 계산) */
  private outline: [Vec2, Vec2][] = [];
  private readonly coneOver: Phaser.GameObjects.Graphics;
  private readonly entities: Phaser.GameObjects.Graphics;
  private readonly badges: Badges;
  private lastFogAt = -1e9;
  /** 부채꼴 색 (노랑 0 ↔ 빨강 1) 보간 상태 */
  private coneRed = 0;
  /** 생존자 화면: 지난 프레임에 괴물 부채꼴을 그렸는가 (괴물이 시야에 있었는가) */
  private coneShown = false;
  drawn: DrawnEntity[] = [];
  /** 이번 프레임에 바닥 합성을 다시 했는가 (미니맵 갱신용) */
  baseRefreshed = false;
  private readonly dashTrail = new DashTrail();
  /**
   * 디버그 · 테스트: 이번 프레임 연출. oppFx = 상대 출처 효과 수
   * (생존자 화면: 괴물의 잔상 · 공격 준비 범위 · 기절 별, 괴물 화면: 생존자의 구조 링),
   * cone = 생존자 화면에 괴물 부채꼴을 그렸는가, coneRed = 그 색 보간 상태 (노랑 0 ↔ 빨강 1)
   */
  fx = { stunStars: false, dashGhosts: 0, attackRange: false, oppFx: 0, cone: false, coneRed: 0 };

  /** 미니맵이 줄여 그릴 바닥 합성 (안개 포함) */
  get baseCanvas(): HTMLCanvasElement {
    return this.fog.miniSource;
  }

  constructor(scene: Phaser.Scene, useFog: boolean) {
    this.scene = scene;
    this.useFog = useFog;
    this.fogRoot = scene.add.container(0, 0);
    this.fog = this.buildFog();
    this.container = scene.add.container(MAP_X, MAP_Y).setScale(MAP_SCALE);
    this.coneOver = scene.add.graphics();
    this.entities = scene.add.graphics();
    this.container.add([this.coneOver, this.entities]);
    this.badges = new Badges(scene, this.container);
    const off = onGfxChange(() => {
      this.fogDirty = true;
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off();
      this.fog.destroy();
    });
  }

  /** 지금 품질 · 렌더러 · 해상도에 맞는 안개 레이어 (그래픽 상태에 기록한다) */
  private buildFog(): FogLayer {
    const renderer: RendererKind = this.scene.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas';
    // 품질 표는 실제 렌더러 기준으로 다시 고른다 (Canvas면 WebGL 전용 기능 0개, 합성 1배 이하)
    const preset = effectivePreset(gfxState.quality, renderer, gfxState.touch);
    const path = fogPathFor(preset, renderer);
    const compositeScale = compositeScaleFor(gfxState.zoom, preset.compositeCap);
    const fog = createFogLayer(this.scene, this.fogRoot, path.mode, {
      fog: this.useFog,
      compositeScale,
      lightPxPerTile: preset.lightPxPerTile,
      zoom: gfxState.zoom,
      ambientCss: rgbCss(ambientRgb(FOG.ambient, FOG.tint)),
      shader: path.shader,
    });
    gfxState.fogMode = fog.mode;
    gfxState.ambient = this.useFog ? FOG.ambient : 1;
    gfxState.compositeScale = compositeScale;
    gfxState.features.fogShader = fog.shader;
    return fog;
  }

  private rebuildFog(): void {
    this.fogDirty = false;
    this.fog.destroy();
    this.fog = this.buildFog();
    this.lastFogAt = -1e9;
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

    // 1~6. 바닥 · 거점 · 탈출구 영역 · 시야 원 · (괴물 화면) 부채꼴 · 안개 — 갱신 주기마다 합성
    if (this.fogDirty) this.rebuildFog();
    const fogDue = v.nowMs - this.lastFogAt >= (isMonster ? MONSTER_FOG_MS : SURVIVOR_FOG_MS);
    this.baseRefreshed = fogDue;
    const eyes = isMonster ? [] : this.survivorEyes(v);
    if (fogDue) {
      this.lastFogAt = v.nowMs;
      const b = this.fog;
      b.begin();
      b.drawPoints(snap.world.points, balance);
      b.drawExits(snap.world.exits, balance);
      this.outline = [];
      if (isMonster && v.me) {
        const near = monsterNearPolygon(balance, v.me);
        const cone = monsterConePolygon(balance, v.me, v.me.face, v.myBlend);
        b.fillPoly(near, COLOR.nearCircle, ALPHA.nearCircle);
        b.fillPoly(cone, COLOR.coneIdle, ALPHA.coneIdle);
        b.addHardLight(near);
        b.addHardLight(cone);
        // 딱 잘린 경계는 빛 지도 해상도(타일당 8~16px)에 기대지 않고 판정 다각형 그대로 선을 긋는다
        if (this.useFog) this.outline = unionOutline([cone, near]);
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
    if (isMonster && this.outline.length > 0)
      strokeSegments(
        this.coneOver,
        this.outline,
        COLOR.coneIdle,
        FOG.outlineAlpha,
        FOG.outlineWidth / MAP_SCALE,
      );
    const coneShown = !isMonster && v.monster !== null;
    if (!isMonster && v.monster) {
      const m = v.monster;
      // 시야에 다시 들어온 첫 프레임은 지금 상태 그대로, 보이는 동안에만 노랑 ↔ 빨강 보간 (fogMath.nextConeRed)
      this.coneRed = nextConeRed(this.coneRed, this.coneShown, m.seesSomeone, frameMs);
      const cone = monsterConePolygon(balance, m, m.aim, m.blend);
      const color = mixColor(COLOR.coneIdle, COLOR.coneSeen, this.coneRed);
      const alpha = ALPHA.coneIdle + (ALPHA.coneSeen - ALPHA.coneIdle) * this.coneRed;
      fillPolygon(this.coneOver, cone, color, alpha);
    } else {
      // 괴물이 안 보이는 동안(생존자 화면) 또는 괴물 화면: 부채꼴 색 상태를 남기지 않는다
      this.coneRed = 0;
    }
    this.coneShown = coneShown;

    // 7. 캐릭터 · 공격 범위 · 구조 게이지
    const g = this.entities;
    g.clear();
    const atk = balance.monster.attack;
    // 상대 쪽 잔여 효과 규칙: 생존자 화면에서 괴물이 나오는 효과는 이번 스냅샷에 괴물이 있을 때만.
    // 괴물이 시야를 벗어나면(서버가 좌표를 보내지 않으면) 잔상 · 범위 · 별을 바로 없앤다 (보간된 몸은 약 0.1초 더 남는다)
    const oppVisible = isMonster || opponentFxAllowed(snap.monster !== null);
    if (!oppVisible) this.dashTrail.clear();
    let oppFx = 0;
    // 돌진 잔상 (보이는 화면, 0.25초): 돌진 중 위치를 남기고 옅어진다
    const dashing = isMonster
      ? v.me && v.myDashing
        ? v.me
        : null
      : oppVisible && v.monster?.dashing
        ? v.monster
        : null;
    if (dashing) {
      const face = 'aim' in dashing ? dashing.aim : dashing.face;
      this.dashTrail.sample(dashing.x, dashing.y, face, v.nowMs);
    }
    const ghosts = this.dashTrail.live(v.nowMs);
    for (const { g: gh, alpha } of ghosts) drawMonster(g, gh.x, gh.y, gh.aim, 0.45 * alpha);
    if (!isMonster) oppFx += ghosts.length;
    // 공격 준비 범위 (양쪽 화면, 흰색 25%): 괴물을 따라가고 방향은 고정.
    // 괴물 화면은 누른 순간부터 (서버 확인 전 예측), 서버가 처리한 뒤에는 서버 값을 따른다
    let attackRange = false;
    const serverWindup = (snap.you.mon?.windup ?? 0) > 0 && !v.hideServerWindup;
    if (isMonster && v.me && (serverWindup || v.localWindupDir !== null)) {
      const dir = v.localWindupDir ?? v.me.face;
      drawAttackRange(g, v.me.x, v.me.y, dir, atk.range, atk.arc);
      attackRange = true;
    }
    if (!isMonster && oppVisible && v.monster && v.monster.windup > 0) {
      drawAttackRange(g, v.monster.x, v.monster.y, v.monster.aim, atk.range, atk.arc);
      attackRange = true;
      oppFx += 1;
    }
    const blinkFast = Math.floor(v.nowMs / 150) % 2 === 0;
    for (const [id, s] of v.survivors) {
      if (s.status === 'dead' || s.status === 'escaped') continue;
      const color = isMonster || !s.role ? COLOR.hiddenSurvivor : ROLE_COLOR[s.role];
      const revealColor =
        isMonster && s.role ? ROLE_COLOR[s.role] : s.protected && blinkFast ? COLOR.white : null;
      drawSurvivor(g, s.x, s.y, s.face, color, s.protected ? ALPHA.protected : 1, revealColor);
      if (s.rescue !== null && s.rescue > 0) {
        drawRescueRing(g, s.x, s.y, s.rescue);
        if (isMonster) oppFx += 1;
      }
      drawn.push({ id, kind: 'survivor', x: s.x, y: s.y, face: s.face, layer: 'main' });
    }
    let stunStars = false;
    if (!isMonster && v.monster) {
      const m = v.monster;
      drawMonster(g, m.x, m.y, m.aim);
      if (m.stunned && oppVisible) {
        drawStunStars(g, m.x, m.y, v.nowMs);
        stunStars = true;
        oppFx += 1;
      }
      drawn.push({ id: 'monster', kind: 'monster', x: m.x, y: m.y, face: m.aim, layer: 'main' });
    }
    if (v.me) {
      const st = snap.you.surv?.status;
      if (isMonster) {
        drawMonster(g, v.me.x, v.me.y, v.me.face);
        if (v.myStunned) {
          drawStunStars(g, v.me.x, v.me.y, v.nowMs);
          stunStars = true;
        }
      } else if (st !== 'dead' && st !== 'escaped') {
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
    this.fx = {
      stunStars,
      dashGhosts: ghosts.length,
      attackRange,
      oppFx,
      cone: coneShown,
      coneRed: this.coneRed,
    };
  }
}
