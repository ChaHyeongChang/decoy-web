// 월드 렌더링 (TECH_SPEC 5장 · VISUAL_SPEC 정보 우선 규칙 R1 순서). 맵 위 레이어를 컨테이너 하나에 담아 0.93배로 그린다.
//  map · glow (fogRoot: 바닥 · 벽 · 시설 발광 · 거점 · 탈출구 영역 · 시야 채움 · 안개 — baseLayer.ts)
//  → floorInfo (배지 · 바닥 문양 — objects.ts) → 시야 경계 림 → particles (빛 속 먼지)
//  → cone (생존자 화면: 괴물 부채꼴 D4 / 괴물 화면: 자기 시야 테두리) → 범위 (공격 준비 · 캠핑 · 구조 구역 · 밀치기 · 포효)
//  → 이벤트 효과 (불꽃 · 흩어짐 · 발먼지 · 충격파 · 베기 호 · 속도선 · 돌진 줄) → 돌진 잔상
//  → entities (그림자 → 바닥 링 → 발 · 몸 → 부착 표시) → markers (탐지 · 포효 · 포효 핑)
// 후처리(비네트 · 색보정)는 fogRoot에만 건다(effects.ts WorldPostFx). 캐릭터 · 범위 · 마커 · 배지에는 걸지 않는다.
// 품질은 장식(먼지 · 발먼지 · 눈빛 · 애니메이션 프레임)만 바꾸고, 정보(info · drawn)는 모든 품질에서 같다.
import Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  PRISON_CENTER,
  PRISON_RECT,
  RESCUE_POINT,
  inCircleVision,
  monsterConePolygon,
  monsterConeShape,
  monsterNearPolygon,
  monsterSees,
  survivorVisionPolygon,
  survivorVisionRadius,
  type Balance,
  type DrawnEntity,
  type FxTarget,
  type GameEvent,
  type InfoItem,
  type MonsterView,
  type Role,
  type RoleId,
  type Snapshot,
  type SurvivorStatus,
  type SurvivorView,
  type Vec2,
} from '@decoy/shared';
import {
  ANIM,
  advanceWalk,
  cloakFrame,
  dashStretch,
  eyeBlink,
  fadeOut,
  footfall,
  frameCount,
  hatchPulse,
  quantizePhase,
  seedOf,
  windupFill,
} from '../art/anim';
import { cloakFrameName, ensureAtlas, type AtlasBuild } from '../art/atlas';
import { FX_LIMITS, FxSystem, dustMotes, type DustEye } from '../art/fx';
import { CONE, DANGER, NEON, ROLE, WARN } from '../art/palette';
import { effectivePreset, type QualityPreset, type RendererKind } from '../gfx/presets';
import { gfxNow, gfxState, onGfxChange } from '../gfx/state';
import { MAP_SCALE, MAP_X, MAP_Y } from '../ui/layout';
import {
  ATTACK_RANGE,
  MonsterRig,
  SurvivorRig,
  drawAttackRange,
  drawCampZone,
  drawDashStreak,
  drawHiddenSurvivor,
  drawInjury,
  drawMonsterRig,
  drawRescueRing,
  drawRescueZone,
  drawRoarMark,
  drawRoarPing,
  drawRoarWave,
  drawShoveRange,
  drawSpeedLines,
  drawStunStars,
  drawTeamSurvivor,
  drawTrackMark,
  type CharacterLayers,
} from './characters';
import { DashTrail, WorldPostFx } from './effects';
import { ALPHA, FOG } from './colors';
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

/**
 * 부채꼴 · 시야 채움 (그래픽 값). 생존자 화면 괴물 부채꼴 채움 0.20(노랑) / 0.28(빨강) + 가장자리 선 2px 85%,
 * 빨강 상태는 사선 해치 + 0.6초 펄스(색약 대비). 괴물 화면 자기 부채꼴은 낮은 채움 + 판정 경계 선, 근접 원 빨강 8%.
 * 생존자 시야는 따뜻한 중성 틴트 5% + 경계에 그 사람의 역할색 림
 */
export const CONE_LOOK = {
  fillIdle: 0.2,
  fillSeen: 0.28,
  edgeAlpha: 0.85,
  edgeWidth: 2,
  hatchSpacing: 0.42,
  hatchAlpha: 0.2,
  hatchPulse: 0.16,
  hatchWidth: 2,
  selfFill: 0.11,
  nearFill: 0.08,
  visionTint: 0xffe2b8,
  visionTintAlpha: 0.05,
  rimAlpha: 0.24,
  rimWidth: 1.6,
} as const;

/** 포효 충격파 (괴물 화면, 범위 표시라 이벤트 효과 0.4초 한도 밖) */
export const ROAR_WAVE_MS = 600;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

interface Gait {
  phase: number;
  x: number;
  y: number;
  stepping: number;
  footfall: boolean;
}

interface Fade {
  kind: 'appear' | 'escape' | 'death';
  t0: number;
  x: number;
  y: number;
  face: number;
}

/** 선분과 다각형 경계의 교차 구간 (짝홀): 직선 p + t·d 위에서 다각형 안인 [t0, t1] 목록 */
function clipLine(p: Vec2, d: Vec2, poly: readonly Vec2[]): [number, number][] {
  const ts: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[j];
    const b = poly[i];
    if (!a || !b) continue;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
    if (u >= 0 && u < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const a = ts[i];
    const b = ts[i + 1];
    if (a !== undefined && b !== undefined) out.push([a, b]);
  }
  return out;
}

export class WorldRenderer {
  readonly container: Phaser.GameObjects.Container;
  /** 안개 레이어(구조 · 발광)를 담는 컨테이너. 캐릭터 컨테이너보다 먼저 만들어 항상 아래에 그린다. 후처리는 여기에만 */
  private readonly fogRoot: Phaser.GameObjects.Container;
  private fog: FogLayer;
  private fogDirty = false;
  private readonly useFog: boolean;
  private readonly scene: Phaser.Scene;
  private preset: QualityPreset;
  private readonly post: WorldPostFx;
  /** 괴물 화면: 자기 시야(부채꼴 ∪ 근접 원) 테두리 선분 (안개와 같은 주기로 계산) */
  private outline: [Vec2, Vec2][] = [];
  private readonly rims: Phaser.GameObjects.Graphics;
  private readonly dust: Phaser.GameObjects.Graphics;
  private readonly coneOver: Phaser.GameObjects.Graphics;
  private readonly ranges: Phaser.GameObjects.Graphics;
  /** 공격 준비 채움 (캐릭터 그림자 아래) — 경계 선 · 다른 범위는 ranges (그림자 위, 몸 아래) */
  private readonly rangeFill: Phaser.GameObjects.Graphics;
  private readonly fxUnder: Phaser.GameObjects.Graphics;
  private readonly ghosts: Phaser.GameObjects.Container;
  private readonly layers: CharacterLayers;
  private readonly attachG: Phaser.GameObjects.Graphics;
  private readonly markers: Phaser.GameObjects.Graphics;
  private readonly badges: Badges;
  private lastFogAt = -1e9;
  private coneRed = 0;
  private coneShown = false;
  drawn: DrawnEntity[] = [];
  baseRefreshed = false;
  private readonly dashTrail = new DashTrail();
  private ghostImgs: Phaser.GameObjects.Image[] = [];
  /** 그림 텍스처 */
  private atlasKey = '';
  private atlas: AtlasBuild | null = null;
  private survivorRigs = new Map<string, SurvivorRig>();
  private monsterRigs = new Map<string, MonsterRig>();
  private readonly fxs = new FxSystem(0x5eed, 400);
  /** 이번 안개 주기의 자기 팀 시야 (먼지 · 림) */
  private eyes: (DustEye & { role: RoleId | null; r: number })[] = [];
  private gaits = new Map<string, Gait>();
  private lastStatus = new Map<string, { status: SurvivorStatus; x: number; y: number; face: number }>();
  private fades = new Map<string, Fade>();
  /** 생존자 화면: 최근 피격 (이벤트 좌표) */
  private hits: { x: number; y: number; you: boolean; t0: number }[] = [];
  /** 생존자 화면: 팀원 질주 끝 시각 (performance.now, 규칙 시간 sprintDuration) */
  private sprintUntil = 0;
  /** 괴물 화면: 포효 충격파 시작 (장식 시계) · 자리 */
  private roarWave: { t0: number; x: number; y: number } | null = null;
  /** 괴물 화면: 잡힘 알림 (보이던 자리에서 흩어짐) */
  private captureAt = -1e9;
  /** 괴물 화면: 기절 알림 (가드가 안 보이면 괴물 몸 중심에서 방향 없이) */
  private stunnedPending = false;
  private shoveSeen = false;
  /** 공격 준비 채움 시작 (performance.now) */
  private windupStart: number | null = null;
  fx = {
    stunStars: false,
    dashGhosts: 0,
    attackRange: false,
    oppFx: 0,
    cone: false,
    coneRed: 0,
    particles: 0,
    dust: 0,
    reveal: 0,
  };
  info: InfoItem[] = [];
  fxTargets: FxTarget[] = [];

  get baseCanvas(): HTMLCanvasElement {
    return this.fog.miniSource;
  }

  constructor(scene: Phaser.Scene, useFog: boolean) {
    this.scene = scene;
    this.useFog = useFog;
    this.fogRoot = scene.add.container(0, 0);
    this.preset = this.currentPreset();
    this.fog = this.buildFog();
    this.post = new WorldPostFx(scene, this.fogRoot);
    this.post.apply(this.preset, this.fog.shader);
    this.fxTargets = this.post.targets;
    this.container = scene.add.container(MAP_X, MAP_Y).setScale(MAP_SCALE);
    // 배지(바닥 문양 · 라벨)는 캐릭터보다 먼저 넣어 아래에 그린다 (정보 우선 R15: 배지가 캐릭터를 덮지 않음)
    this.badges = new Badges(scene, this.container);
    const gfx = (): Phaser.GameObjects.Graphics => scene.make.graphics({}, false);
    const box = (): Phaser.GameObjects.Container => scene.make.container({}, false);
    this.rims = gfx();
    this.dust = gfx();
    this.coneOver = gfx();
    this.ranges = gfx();
    this.rangeFill = gfx();
    this.fxUnder = gfx();
    this.ghosts = box();
    this.layers = { shadows: box(), ground: box(), bodies: box(), attach: box() };
    this.attachG = gfx();
    this.markers = gfx();
    this.container.add([
      this.rims,
      this.dust,
      this.coneOver,
      this.rangeFill,
      this.fxUnder,
      this.ghosts,
      this.layers.shadows,
      this.ranges,
      this.layers.ground,
      this.layers.bodies,
      this.layers.attach,
      this.attachG,
      this.markers,
    ]);
    const off = onGfxChange(() => {
      this.fogDirty = true;
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off();
      this.post.clear();
      this.fog.destroy();
      this.resetRigs();
    });
  }

  private currentPreset(): QualityPreset {
    const renderer: RendererKind = this.scene.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas';
    return effectivePreset(gfxState.quality, renderer, gfxState.touch);
  }

  /** 서버 이벤트 (GameScene이 오래된 스냅샷의 일회성 이벤트를 걸러서 넘긴다). 월드 연출은 이벤트 좌표에서만 생긴다 */
  onEvent(ev: GameEvent, nowMs: number): void {
    const tS = gfxNow() / 1000;
    const balance = this.lastBalance;
    const isMonster = this.lastRole === 'monster';
    switch (ev.k) {
      case 'hit':
        // 생존자 화면만 받는다: 맞은 팀원 자리에서 불꽃 + 몸 흰 번쩍 · 찌그러짐
        this.hits.push({ x: ev.x, y: ev.y, you: ev.you, t0: nowMs });
        this.fxs.sparks(ev.x, ev.y, balance ? balance.survivor.radius : 0.3, tS, null, false);
        return;
      case 'attackHit':
        if (balance)
          this.fxs.slash(
            ev.x,
            ev.y,
            ev.dir,
            (balance.monster.attack.arc * Math.PI) / 180,
            balance.monster.attack.range,
            tS,
            isMonster ? null : 'monster',
            !isMonster,
          );
        return;
      case 'ability': {
        if (!balance || ev.x === null || ev.y === null) return;
        if (ev.role === 'runner' && !isMonster && !ev.you)
          this.sprintUntil = nowMs + balance.roles.runner.sprintDuration * 1000;
        if (ev.role === 'guard') {
          // 괴물 화면은 가드가 보일 때만 이 이벤트를 받는다 (안 보이면 기절 충격만 몸 중심에서)
          this.fxs.ring('shockwave', ev.x, ev.y, balance.roles.guard.shoveRange, tS, null, isMonster);
          if (isMonster) this.shoveSeen = true;
        }
        if (ev.role === 'scout' && !isMonster) this.fxs.ring('shutter', ev.x, ev.y, 1.1, tS, null, false);
        return;
      }
      case 'stunned':
        this.stunnedPending = true;
        return;
      case 'imprisoned':
        if (isMonster) this.captureAt = nowMs;
        return;
      case 'roarPings':
        if (isMonster && this.lastMe) this.roarWave = { t0: nowMs, x: this.lastMe.x, y: this.lastMe.y };
        return;
      default:
        return;
    }
  }

  private lastBalance: Balance | null = null;
  private lastRole: Role | null = null;
  private lastMe: Vec2 | null = null;

  private buildFog(): FogLayer {
    const renderer: RendererKind = this.scene.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas';
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
    this.post.clear();
    this.fog.destroy();
    this.preset = this.currentPreset();
    this.fog = this.buildFog();
    this.post.apply(this.preset, this.fog.shader);
    this.post.raise();
    this.fxTargets = this.post.targets;
    this.lastFogAt = -1e9;
  }

  /** 그림 텍스처 (zoom · 반지름이 바뀌면 다시 굽고 그림 묶음을 새로 만든다) */
  private ensureArt(balance: Balance): AtlasBuild {
    const a = ensureAtlas(this.scene.textures, {
      zoom: gfxState.zoom,
      survivorR: balance.survivor.radius,
      monsterR: balance.monster.radius,
    });
    if (a.key !== this.atlasKey) {
      this.resetRigs();
      this.atlasKey = a.key;
      this.atlas = a.build;
    }
    this.fxs.setCap(this.preset.particleCap);
    gfxState.features.particles = this.preset.particleCap;
    gfxState.features.dust = FX_LIMITS.dust[this.preset.tier];
    return a.build;
  }

  private resetRigs(): void {
    for (const r of this.survivorRigs.values()) r.destroy();
    for (const r of this.monsterRigs.values()) r.destroy();
    for (const g of this.ghostImgs) g.destroy();
    this.survivorRigs.clear();
    this.monsterRigs.clear();
    this.ghostImgs = [];
  }

  private survivorRig(id: string): SurvivorRig {
    let r = this.survivorRigs.get(id);
    if (!r) {
      r = new SurvivorRig(this.scene, this.atlasKey, this.layers, this.atlas?.texPerWorld ?? 1);
      this.survivorRigs.set(id, r);
    }
    r.used = true;
    return r;
  }

  private monsterRig(id: string): MonsterRig {
    let r = this.monsterRigs.get(id);
    if (!r) {
      r = new MonsterRig(this.scene, this.atlasKey, this.layers, this.atlas?.texPerWorld ?? 1);
      this.monsterRigs.set(id, r);
    }
    r.used = true;
    return r;
  }

  /** 이동 거리로 걷기 위상을 진행 (멈추면 그 자세로 정지). 순간이동(1타일 넘게)은 위상을 잇지 않는다 */
  private gait(id: string, x: number, y: number, frameMs: number): Gait {
    let g = this.gaits.get(id);
    if (!g) {
      g = { phase: 0, x, y, stepping: 0, footfall: false };
      this.gaits.set(id, g);
    }
    const d = Math.hypot(x - g.x, y - g.y);
    const prev = g.phase;
    const moving = d > ANIM.walkEpsilon && d < 1;
    if (moving) g.phase = advanceWalk(g.phase, d);
    g.stepping = moving ? Math.min(1, g.stepping + frameMs / 120) : Math.max(0, g.stepping - frameMs / 160);
    g.footfall = moving && footfall(prev, g.phase);
    g.x = x;
    g.y = y;
    return g;
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
    this.lastBalance = balance;
    this.lastRole = v.role;
    this.lastMe = v.me;
    const drawn: DrawnEntity[] = [];
    const info: InfoItem[] = [];
    const clockMs = gfxNow();
    if (this.fogDirty) this.rebuildFog();
    const half = this.preset.halfFrameAnims;
    // 장식 시계 (품질 낮음은 프레임 절반 = 15Hz로 끊는다)
    const animMs = half ? Math.floor(clockMs / 66.667) * 66.667 : clockMs;
    const tS = animMs / 1000;
    const atlas = this.ensureArt(balance);
    void atlas;
    const sR = balance.survivor.radius;
    const mR = balance.monster.radius;

    // 1~6. 바닥 · 거점 · 탈출구 영역 · 시야 채움 · 안개 — 갱신 주기마다 합성
    const fogDue = v.nowMs - this.lastFogAt >= (isMonster ? MONSTER_FOG_MS : SURVIVOR_FOG_MS);
    this.baseRefreshed = fogDue;
    if (fogDue) {
      this.lastFogAt = v.nowMs;
      const b = this.fog;
      b.begin();
      b.drawPoints(snap.world.points, balance);
      b.drawExits(snap.world.exits, balance);
      this.outline = [];
      this.eyes = [];
      if (isMonster && v.me) {
        const near = monsterNearPolygon(balance, v.me);
        const cone = monsterConePolygon(balance, v.me, v.me.face, v.myBlend);
        b.fillPoly(near, DANGER, CONE_LOOK.nearFill);
        b.fillPoly(cone, CONE.idle, CONE_LOOK.selfFill);
        b.addHardLight(near);
        b.addHardLight(cone);
        if (this.useFog) this.outline = unionOutline([cone, near]);
        const shape = monsterConeShape(balance, v.myBlend);
        this.eyes.push({ poly: cone, center: v.me, radius: shape.range, role: null, r: shape.range });
        this.eyes.push({
          poly: near,
          center: v.me,
          radius: balance.monster.nearVisionRadius,
          role: null,
          r: balance.monster.nearVisionRadius,
        });
      } else {
        for (const e of this.survivorEyes(v)) {
          const r = survivorVisionRadius(balance, e.role);
          const poly = survivorVisionPolygon(e.pos, r);
          b.fillPoly(poly, CONE_LOOK.visionTint, CONE_LOOK.visionTintAlpha);
          b.addSoftLight({ poly, center: e.pos, radius: r, soft: balance.survivor.visionSoftEdge });
          this.eyes.push({
            poly,
            center: e.pos,
            radius: r - balance.survivor.visionSoftEdge,
            role: e.role,
            r,
          });
        }
      }
      b.commit();
      this.drawRims();
    }

    // 빛 속 먼지 (장식: 자기 팀 시야 안에서만, 시계와 시드만의 함수)
    this.dust.clear();
    const dustN = FX_LIMITS.dust[this.preset.tier];
    const motes = this.useFog ? dustMotes(tS, this.eyes, dustN) : [];
    for (const m of motes) {
      this.dust.fillStyle(0xd6dde6, Math.min(FX_LIMITS.decorAlphaMax, m.alpha));
      this.dust.fillCircle(m.x * 32, m.y * 32, Math.min(FX_LIMITS.decorSizeMaxPx, m.size) / MAP_SCALE);
    }

    // 부채꼴
    this.coneOver.clear();
    if (isMonster && this.outline.length > 0)
      strokeSegments(this.coneOver, this.outline, CONE.idle, FOG.outlineAlpha, FOG.outlineWidth / MAP_SCALE);
    if (isMonster && v.me) {
      const shape = monsterConeShape(balance, v.myBlend);
      info.push({
        kind: 'cone',
        tag: 'self',
        x: r3(v.me.x),
        y: r3(v.me.y),
        r: r3(shape.range),
        dir: r3(v.me.face),
        arc: r3(shape.arc),
        value: v.survivors.size > 0 ? 'seen' : 'idle',
        color: CONE.idle,
        alpha: CONE_LOOK.selfFill,
      });
      info.push({
        kind: 'range',
        tag: 'near',
        x: r3(v.me.x),
        y: r3(v.me.y),
        r: balance.monster.nearVisionRadius,
        dir: null,
        arc: null,
        value: null,
        color: DANGER,
        alpha: CONE_LOOK.nearFill,
      });
    }
    const coneShown = !isMonster && v.monster !== null;
    if (!isMonster && v.monster) {
      const m = v.monster;
      this.coneRed = nextConeRed(this.coneRed, this.coneShown, m.seesSomeone, frameMs);
      this.drawMonsterCone(balance, m, tS);
      const shape = monsterConeShape(balance, m.blend);
      const state = m.seesSomeone ? 'seen' : 'idle';
      info.push({
        kind: 'cone',
        tag: 'monster',
        x: r3(m.x),
        y: r3(m.y),
        r: r3(shape.range),
        dir: r3(m.aim),
        arc: r3(shape.arc),
        value: state,
        color: CONE[state],
        alpha: state === 'seen' ? CONE_LOOK.fillSeen : CONE_LOOK.fillIdle,
      });
    } else {
      this.coneRed = 0;
    }
    this.coneShown = coneShown;

    // 상대 쪽 잔여 효과 규칙: 생존자 화면에서 괴물이 나오는 효과는 이번 스냅샷에 괴물이 있을 때만
    const oppVisible = isMonster || opponentFxAllowed(snap.monster !== null);
    const present = new Set<string>();
    if (isMonster) for (const s of snap.survivors) present.add(s.id);
    else if (snap.monster) present.add('monster');
    this.fxs.pruneSources(present);
    if (!oppVisible) this.dashTrail.clear();
    let oppFx = 0;

    // 범위
    this.ranges.clear();
    this.rangeFill.clear();
    const atk = balance.monster.attack;
    let attackRange = false;
    let windupDir: number | null = null;
    let windupAt: Vec2 | null = null;
    if (isMonster && v.me) {
      const serverWindup = (snap.you.mon?.windup ?? 0) > 0 && !v.hideServerWindup;
      if (serverWindup || v.localWindupDir !== null) {
        windupDir = v.localWindupDir ?? v.me.face;
        windupAt = v.me;
        // 예측한 준비는 누른 순간부터, 서버 값만 있으면 남은 시간에서
        if (this.windupStart === null)
          this.windupStart =
            v.localWindupDir !== null ? v.nowMs : v.nowMs - (atk.windup - (snap.you.mon?.windup ?? 0)) * 1000;
      }
    } else if (!isMonster && oppVisible && v.monster && v.monster.windup > 0) {
      windupDir = v.monster.aim;
      windupAt = v.monster;
      if (this.windupStart === null) this.windupStart = v.nowMs - (atk.windup - v.monster.windup) * 1000;
      oppFx += 1;
    }
    if (windupDir === null || !windupAt) this.windupStart = null;
    else {
      const fill = windupFill((v.nowMs - (this.windupStart ?? v.nowMs)) / 1000, atk.windup);
      drawAttackRange(
        this.rangeFill,
        this.ranges,
        windupAt.x,
        windupAt.y,
        windupDir,
        atk.range,
        atk.arc,
        fill,
      );
      attackRange = true;
      info.push({
        kind: 'range',
        tag: 'attack',
        x: r3(windupAt.x),
        y: r3(windupAt.y),
        r: atk.range,
        dir: r3(windupDir),
        arc: r3((atk.arc * Math.PI) / 180),
        value: null,
        color: ATTACK_RANGE.color,
        alpha: ATTACK_RANGE.edge,
      });
    }
    const mon = snap.you.mon;
    if (isMonster && mon && mon.camp > 0) {
      drawCampZone(this.ranges, PRISON_RECT, balance.prison.campRadius, mon.camp);
      info.push({
        kind: 'range',
        tag: 'camp',
        x: PRISON_CENTER.x,
        y: PRISON_CENTER.y,
        r: balance.prison.campRadius,
        dir: null,
        arc: null,
        value: mon.camp,
        color: WARN,
        alpha: 0.9,
      });
    }
    if (isMonster && this.roarWave) {
      const k = (v.nowMs - this.roarWave.t0) / ROAR_WAVE_MS;
      if (k >= 1 || k < 0) this.roarWave = null;
      else {
        drawRoarWave(this.ranges, this.roarWave.x, this.roarWave.y, balance.monster.roar.radius, k);
        info.push({
          kind: 'range',
          tag: 'roar',
          x: r3(this.roarWave.x),
          y: r3(this.roarWave.y),
          r: balance.monster.roar.radius,
          dir: null,
          arc: null,
          value: null,
          color: WARN,
          alpha: 0.22,
        });
      }
    }
    const surv = snap.you.surv;
    if (!isMonster && surv?.status === 'free') {
      const anyPrisoner = [...v.survivors.values()].some((s) => s.status === 'imprisoned');
      if (anyPrisoner) {
        drawRescueZone(this.ranges, RESCUE_POINT.x, RESCUE_POINT.y, balance.prison.rescueRadius, tS * 0.4);
        info.push({
          kind: 'range',
          tag: 'rescue',
          x: RESCUE_POINT.x,
          y: RESCUE_POINT.y,
          r: balance.prison.rescueRadius,
          dir: null,
          arc: null,
          value: null,
          color: NEON,
          alpha: 0.75,
        });
      }
      // 가드: 능력 준비 · 괴물이 보이고 가까우면 밀치기 사거리
      if (v.role === 'guard' && v.me && surv.abilityCd <= 0 && v.monster && snap.monster) {
        const d = Math.hypot(v.monster.x - v.me.x, v.monster.y - v.me.y);
        const range = balance.roles.guard.shoveRange;
        if (d <= range * 2) {
          drawShoveRange(this.ranges, v.me.x, v.me.y, range, d <= range);
          info.push({
            kind: 'range',
            tag: 'shove',
            x: r3(v.me.x),
            y: r3(v.me.y),
            r: range,
            dir: null,
            arc: null,
            value: d <= range ? 'in' : 'out',
            color: ROLE.guard,
            alpha: 0.95,
          });
        }
      }
    }

    // 이벤트 효과 · 장식 입자 (캐릭터 아래)
    this.fxUnder.clear();
    this.attachG.clear();
    const footDust = FX_LIMITS.footDust[this.preset.tier];

    // 돌진 잔상 (보이는 화면, dash.duration): 돌진 중 위치를 남기고 옅어진다 + 붉은 줄
    this.dashTrail.setLife(balance.monster.dash.duration * 1000);
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
    this.drawGhosts(ghosts, mR);
    if (ghosts.length > 0)
      drawDashStreak(
        this.fxUnder,
        ghosts.map(({ g, alpha }) => ({ x: g.x, y: g.y, a: alpha })),
      );
    if (!isMonster) oppFx += ghosts.length;

    // 캐릭터
    for (const r of this.survivorRigs.values()) r.used = false;
    for (const r of this.monsterRigs.values()) r.used = false;
    const stunStars = this.drawCharacters(
      v,
      drawn,
      info,
      tS,
      animMs,
      clockMs,
      frameMs,
      footDust,
      oppVisible,
      sR,
      mR,
    );
    if (stunStars.opp) oppFx += 1;

    // 이벤트 효과 갱신 · 그리기
    this.fxs.update(clockMs / 1000, present);
    this.fxs.draw(this.fxUnder, clockMs / 1000, 32);
    oppFx += this.fxs.oppCount;
    for (const [id, r] of this.survivorRigs)
      if (!r.used) {
        r.destroy();
        this.survivorRigs.delete(id);
      }
    for (const [id, r] of this.monsterRigs)
      if (!r.used) {
        r.destroy();
        this.monsterRigs.delete(id);
      }

    // 안개 위 마커: 탐지(초록 다이아, 실시간), 포효한 괴물 위치(주황), 포효 핑(흰 원 펄스)
    this.markers.clear();
    for (const mk of snap.marks) {
      if (mk.kind === 'track') drawTrackMark(this.markers, mk.x, mk.y, tS);
      else if (mk.kind === 'roarSelf') drawRoarMark(this.markers, mk.x, mk.y, tS);
      drawn.push({
        id: `mark-${mk.kind}`,
        kind: 'mark',
        tag: mk.kind,
        x: mk.x,
        y: mk.y,
        face: 0,
        layer: 'main',
      });
      info.push({
        kind: 'marker',
        tag: mk.kind,
        x: r3(mk.x),
        y: r3(mk.y),
        r: null,
        dir: null,
        arc: null,
        value: null,
        color: mk.kind === 'track' ? ROLE.scout : WARN,
        alpha: 1,
      });
    }
    for (const p of v.roarPings) {
      if (v.nowMs > p.until) continue;
      drawRoarPing(this.markers, p.x, p.y, (v.nowMs - p.start) / (p.until - p.start));
      drawn.push({
        id: 'mark-roarPing',
        kind: 'mark',
        tag: 'roarPing',
        x: p.x,
        y: p.y,
        face: 0,
        layer: 'main',
      });
      info.push({
        kind: 'marker',
        tag: 'roarPing',
        x: r3(p.x),
        y: r3(p.y),
        r: null,
        dir: null,
        arc: null,
        value: null,
        color: 0xffffff,
        alpha: 1,
      });
    }

    // 항상 표시 배지 (지금 안 보이는 곳이면 45%)
    const eyes = isMonster ? [] : this.survivorEyes(v);
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
    this.info = [...this.badges.info(), ...info];
    this.drawn = drawn;
    this.fx = {
      stunStars: stunStars.any,
      dashGhosts: ghosts.length,
      attackRange,
      oppFx,
      cone: coneShown,
      coneRed: this.coneRed,
      particles: this.fxs.count,
      dust: motes.length,
      reveal: info.filter((i) => i.kind === 'reveal').length,
    };
  }

  /** 생존자 시야 경계 림 (그 사람의 역할색, 원호 부분만 — 벽 그림자 선은 긋지 않는다) */
  private drawRims(): void {
    const g = this.rims;
    g.clear();
    for (const e of this.eyes) {
      if (!e.role) continue;
      const color = ROLE[e.role];
      g.lineStyle(CONE_LOOK.rimWidth / MAP_SCALE, color, CONE_LOOK.rimAlpha);
      g.beginPath();
      const poly = e.poly;
      for (let i = 0; i < poly.length; i += 1) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (!a || !b) continue;
        const da = Math.hypot(a.x - e.center.x, a.y - e.center.y);
        const db = Math.hypot(b.x - e.center.x, b.y - e.center.y);
        if (da < e.r - 0.06 || db < e.r - 0.06) continue;
        g.moveTo(a.x * 32, a.y * 32);
        g.lineTo(b.x * 32, b.y * 32);
      }
      g.strokePath();
    }
  }

  /** 생존자 화면 괴물 부채꼴: 채움 + 가장자리 선 + (빨강) 꼭짓점에서 퍼지는 사선 해치 · 펄스 */
  private drawMonsterCone(balance: Balance, m: MonsterView, tS: number): void {
    const g = this.coneOver;
    const cone = monsterConePolygon(balance, m, m.aim, m.blend);
    const color = mixColor(CONE.idle, CONE.seen, this.coneRed);
    const fill = CONE_LOOK.fillIdle + (CONE_LOOK.fillSeen - CONE_LOOK.fillIdle) * this.coneRed;
    fillPolygon(g, cone, color, fill);
    if (this.coneRed > 0.01) {
      const pulse = hatchPulse(tS);
      const a = (CONE_LOOK.hatchAlpha + CONE_LOOK.hatchPulse * pulse) * this.coneRed;
      // 조준 방향에서 45° 기운 줄들을 꼭짓점에서 바깥으로 흘려 보낸다 (0.6초에 한 칸)
      const dir = { x: Math.cos(m.aim + Math.PI / 4), y: Math.sin(m.aim + Math.PI / 4) };
      const n = { x: -dir.y, y: dir.x };
      const sp = CONE_LOOK.hatchSpacing;
      const shift = ((tS / ANIM.hatchPulseS) % 1) * sp;
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of cone) {
        const c = (p.x - m.x) * n.x + (p.y - m.y) * n.y;
        lo = Math.min(lo, c);
        hi = Math.max(hi, c);
      }
      g.lineStyle(CONE_LOOK.hatchWidth / MAP_SCALE, color, a);
      g.beginPath();
      // 흐름 방향: n이 조준 방향과 같은 쪽을 향하면 +, 아니면 −
      const sign = n.x * Math.cos(m.aim) + n.y * Math.sin(m.aim) >= 0 ? 1 : -1;
      for (let c = Math.floor(lo / sp) * sp; c <= hi + sp; c += sp) {
        const off = c + sign * shift;
        const o = { x: m.x + n.x * off, y: m.y + n.y * off };
        for (const [t0, t1] of clipLine(o, dir, cone)) {
          g.moveTo((o.x + dir.x * t0) * 32, (o.y + dir.y * t0) * 32);
          g.lineTo((o.x + dir.x * t1) * 32, (o.y + dir.y * t1) * 32);
        }
      }
      g.strokePath();
    }
    // 가장자리 선 (판정 경계 그대로)
    g.lineStyle(CONE_LOOK.edgeWidth / MAP_SCALE, color, CONE_LOOK.edgeAlpha);
    g.beginPath();
    cone.forEach((p, i) => (i === 0 ? g.moveTo(p.x * 32, p.y * 32) : g.lineTo(p.x * 32, p.y * 32)));
    g.closePath();
    g.strokePath();
  }

  /** 돌진 잔상 이미지 (망토 늘어난 프레임) */
  private drawGhosts(
    ghosts: { g: { x: number; y: number; aim: number }; alpha: number }[],
    mR: number,
  ): void {
    void mR;
    while (this.ghostImgs.length < ghosts.length) {
      const img = this.scene.make.image({ key: this.atlasKey, frame: 'monster-dash' }, false);
      this.ghosts.add(img);
      this.ghostImgs.push(img);
    }
    const s = 1 / (this.atlas?.texPerWorld ?? 1);
    this.ghostImgs.forEach((img, i) => {
      const gh = ghosts[i];
      if (!gh) {
        img.setVisible(false);
        return;
      }
      img
        .setPosition(gh.g.x * 32, gh.g.y * 32)
        .setRotation(gh.g.aim)
        .setScale(s * 1.12, s * 0.92)
        .setAlpha(0.42 * gh.alpha)
        .setVisible(true);
    });
  }

  /** 상태 변화 (수감 · 탈출 · 사망)를 보고 효과를 만든다. 반환: 지금 그릴 페이드 */
  private transition(
    id: string,
    status: SurvivorStatus,
    x: number,
    y: number,
    face: number,
    clockMs: number,
    realMs: number,
    isMonster: boolean,
    sR: number,
  ): void {
    const prev = this.lastStatus.get(id);
    if (prev && prev.status === 'free' && status === 'imprisoned') {
      this.fxs.dissolve(prev.x, prev.y, sR, clockMs / 1000, null, isMonster);
      this.fades.set(id, { kind: 'appear', t0: realMs, x, y, face });
    } else if (prev && prev.status === 'free' && status === 'escaped' && !isMonster) {
      this.fades.set(id, { kind: 'escape', t0: realMs, x: prev.x, y: prev.y, face: prev.face });
    } else if (prev && prev.status !== 'dead' && status === 'dead' && !isMonster) {
      this.fades.set(id, { kind: 'death', t0: realMs, x: prev.x, y: prev.y, face: prev.face });
    }
    if (status === 'free' || !prev) this.lastStatus.set(id, { status, x, y, face });
    else this.lastStatus.set(id, { ...prev, status });
  }

  private drawCharacters(
    v: FrameView,
    drawn: DrawnEntity[],
    info: InfoItem[],
    tS: number,
    animMs: number,
    clockMs: number,
    frameMs: number,
    footDust: boolean,
    oppVisible: boolean,
    sR: number,
    mR: number,
  ): { any: boolean; opp: boolean } {
    const { snap, balance } = v;
    const isMonster = v.role === 'monster';
    const half = this.preset.halfFrameAnims;
    const nowS = clockMs / 1000;
    const phaseOf = (g: Gait): number => (half ? quantizePhase(g.phase, 4) : g.phase);
    let stunAny = false;
    let stunOpp = false;
    const realMs = v.nowMs;
    this.hits = this.hits.filter((h) => realMs - h.t0 < 400);

    if (isMonster) {
      // 괴물 화면: 잡힘 알림 직후 사라진(또는 수감된) 생존자는 보이던 자리에서 흩어진다
      if (realMs - this.captureAt < 400 && v.me) {
        let best: { id: string; x: number; y: number; d: number } | null = null;
        for (const [id, st] of this.lastStatus) {
          if (st.status !== 'free') continue;
          const now = v.survivors.get(id);
          if (now && now.status === 'free') continue;
          const d = Math.hypot(st.x - v.me.x, st.y - v.me.y);
          if (!best || d < best.d) best = { id, x: st.x, y: st.y, d };
        }
        if (best) {
          this.fxs.dissolve(best.x, best.y, sR, nowS, null, true);
          this.lastStatus.delete(best.id);
          this.captureAt = -1e9;
        }
      }
      for (const id of [...this.lastStatus.keys()]) if (!v.survivors.has(id)) this.lastStatus.delete(id);
    }

    // 다른 생존자
    for (const [id, s] of v.survivors) {
      this.transition(id, s.status, s.x, s.y, s.face, clockMs, realMs, isMonster, sR);
      const fade = this.fades.get(id);
      if (s.status === 'dead' || s.status === 'escaped') {
        if (!isMonster && s.role && fade) this.drawFade(id, s.role, fade, realMs, sR);
        continue;
      }
      const g = this.gait(id, s.x, s.y, frameMs);
      const rig = this.survivorRig(id);
      if (isMonster) {
        // 흰색 위장: 역할 · 체력 · 능력 인자 없이 (reveal은 서버가 노출 창에 보낸 역할뿐)
        drawHiddenSurvivor(rig, s.x, s.y, s.face, phaseOf(g), g.stepping, s.protected, s.role, animMs, sR);
        if (s.role) {
          info.push({
            kind: 'reveal',
            tag: s.role,
            x: r3(s.x),
            y: r3(s.y),
            r: null,
            dir: null,
            arc: null,
            value: null,
            color: ROLE[s.role],
            alpha: 1,
          });
        }
        if (footDust && g.footfall) this.fxs.footDust(s.x, s.y, nowS, id, true);
      } else {
        const role = s.role ?? 'runner';
        const appear = fade?.kind === 'appear' ? 1 - fadeOut(realMs - fade.t0, ANIM.imprisonAppearMs) : 1;
        drawTeamSurvivor(
          rig,
          {
            role,
            x: s.x,
            y: s.y,
            face: s.face,
            walkPhase: phaseOf(g),
            stepping: g.stepping,
            protectedFlag: s.protected,
            self: false,
            hitMs: this.hitFor(s.x, s.y, false, realMs),
            seed: seedOf(id),
            clockMs: animMs,
            fade: appear,
            gray: false,
          },
          sR,
        );
        if (s.hp !== null && s.hp < balance.survivor.maxHp && s.status === 'free')
          drawInjury(this.attachG, s.x, s.y, s.face, sR);
        if (role === 'runner' && v.nowMs < this.sprintUntil && g.stepping > 0.3)
          drawSpeedLines(this.fxUnder, s.x, s.y, s.face, sR, tS);
        if (footDust && g.footfall) this.fxs.footDust(s.x, s.y, nowS, null, false);
        if (s.rescue !== null && s.rescue > 0) {
          drawRescueRing(this.attachG, s.x, s.y, s.rescue);
          info.push({
            kind: 'progress',
            tag: 'rescue',
            x: r3(s.x),
            y: r3(s.y),
            r: null,
            dir: null,
            arc: null,
            value: r3(s.rescue),
            color: NEON,
            alpha: 1,
          });
        }
      }
      drawn.push({ id, kind: 'survivor', x: s.x, y: s.y, face: s.face, layer: 'main', sprite: rig.sprite });
    }

    // 괴물 (생존자 화면: 보일 때만)
    if (!isMonster && v.monster) {
      const m = v.monster;
      const rig = this.monsterRig('monster');
      const g = this.gait('monster', m.x, m.y, frameMs);
      const pose = this.monsterPose(m.x, m.y, m.aim, m.stunned, m.dashing, m.windup > 0 ? 1 : 0, g, tS, half);
      drawMonsterRig(rig, pose, mR);
      if (m.stunned && oppVisible) {
        drawStunStars(this.attachG, m.x, m.y, tS);
        stunAny = true;
        stunOpp = true;
      }
      if (this.stunnedPending && oppVisible)
        this.fxs.ring('impact', m.x, m.y, mR * 2.4, nowS, 'monster', true);
      if (footDust && g.footfall && oppVisible) this.fxs.footDust(m.x, m.y, nowS, 'monster', true);
      drawn.push({
        id: 'monster',
        kind: 'monster',
        x: m.x,
        y: m.y,
        face: m.aim,
        layer: 'main',
        sprite: rig.sprite,
      });
    }
    this.stunnedPending = isMonster ? this.stunnedPending : false;

    // 나
    if (v.me) {
      const st = snap.you.surv?.status;
      if (isMonster) {
        const rig = this.monsterRig(v.selfId);
        const g = this.gait(v.selfId, v.me.x, v.me.y, frameMs);
        const raise = this.windupStart !== null ? 1 : 0;
        const pose = this.monsterPose(
          v.me.x,
          v.me.y,
          v.me.face,
          v.myStunned,
          v.myDashing,
          raise,
          g,
          tS,
          half,
        );
        drawMonsterRig(rig, pose, mR);
        if (v.myStunned) {
          drawStunStars(this.attachG, v.me.x, v.me.y, tS);
          stunAny = true;
        }
        if (this.stunnedPending) {
          // 가드가 보였으면 그 자리에서 충격파가 이미 났다. 안 보였으면 몸 중심에서 방향 없이
          if (!this.shoveSeen) this.fxs.ring('impact', v.me.x, v.me.y, mR * 2.4, nowS, null, false);
          this.stunnedPending = false;
          this.shoveSeen = false;
        }
        if (footDust && g.footfall) this.fxs.footDust(v.me.x, v.me.y, nowS, null, false);
        drawn.push({
          id: v.selfId,
          kind: 'self',
          x: v.me.x,
          y: v.me.y,
          face: v.me.face,
          layer: 'main',
          sprite: rig.sprite,
        });
      } else {
        const role = v.role as RoleId;
        this.transition(v.selfId, st ?? 'free', v.me.x, v.me.y, v.me.face, clockMs, realMs, false, sR);
        const fade = this.fades.get(v.selfId);
        if (st !== 'dead' && st !== 'escaped') {
          const g = this.gait(v.selfId, v.me.x, v.me.y, frameMs);
          const rig = this.survivorRig(v.selfId);
          const prot = (snap.you.surv?.protectLeft ?? 0) > 0;
          const appear = fade?.kind === 'appear' ? 1 - fadeOut(realMs - fade.t0, ANIM.imprisonAppearMs) : 1;
          drawTeamSurvivor(
            rig,
            {
              role,
              x: v.me.x,
              y: v.me.y,
              face: v.me.face,
              walkPhase: phaseOf(g),
              stepping: g.stepping,
              protectedFlag: prot,
              self: true,
              hitMs: this.hitFor(v.me.x, v.me.y, true, realMs),
              seed: seedOf(v.selfId),
              clockMs: animMs,
              fade: appear,
              gray: false,
            },
            sR,
          );
          const s = snap.you.surv;
          if (s && s.hp < balance.survivor.maxHp && s.status === 'free')
            drawInjury(this.attachG, v.me.x, v.me.y, v.me.face, sR);
          if (role === 'runner' && s && s.abilityActive > 0 && g.stepping > 0.3)
            drawSpeedLines(this.fxUnder, v.me.x, v.me.y, v.me.face, sR, tS);
          if (footDust && g.footfall) this.fxs.footDust(v.me.x, v.me.y, nowS, null, false);
          const rescue = s?.rescue ?? 0;
          if (rescue > 0) {
            drawRescueRing(this.attachG, v.me.x, v.me.y, rescue);
            info.push({
              kind: 'progress',
              tag: 'rescue',
              x: r3(v.me.x),
              y: r3(v.me.y),
              r: null,
              dir: null,
              arc: null,
              value: r3(rescue),
              color: NEON,
              alpha: 1,
            });
          }
          drawn.push({
            id: v.selfId,
            kind: 'self',
            x: v.me.x,
            y: v.me.y,
            face: v.me.face,
            layer: 'main',
            sprite: rig.sprite,
          });
        } else {
          if (fade) this.drawFade(v.selfId, role, fade, realMs, sR);
          drawn.push({ id: v.selfId, kind: 'self', x: v.me.x, y: v.me.y, face: v.me.face, layer: 'main' });
        }
      }
    }
    // 끝난 페이드 정리
    for (const [id, f] of this.fades) {
      const dur =
        f.kind === 'appear'
          ? ANIM.imprisonAppearMs
          : f.kind === 'escape'
            ? ANIM.escapeFadeMs
            : ANIM.deathGrayMs + ANIM.deathFadeMs;
      if (realMs - f.t0 > dur || realMs < f.t0) this.fades.delete(id);
    }
    return { any: stunAny, opp: stunOpp };
  }

  /** 최근 피격이 이 자리(이벤트 좌표 0.8타일 이내)에 있었으면 지난 시간 (ms) */
  private hitFor(x: number, y: number, self: boolean, realMs: number): number | null {
    for (let i = this.hits.length - 1; i >= 0; i -= 1) {
      const h = this.hits[i];
      if (!h) continue;
      if (h.you === self && (self || Math.hypot(h.x - x, h.y - y) < 0.8)) return realMs - h.t0;
    }
    return null;
  }

  /** 탈출 (빛 속으로 0.4초 페이드) · 사망 (회색 → 페이드). 정보가 아니라 drawn에 넣지 않는다 */
  private drawFade(id: string, role: RoleId, f: Fade, realMs: number, sR: number): void {
    if (f.kind === 'appear') return;
    const t = realMs - f.t0;
    const gray = f.kind === 'death';
    const alpha = gray
      ? t < ANIM.deathGrayMs
        ? 1
        : fadeOut(t - ANIM.deathGrayMs, ANIM.deathFadeMs)
      : fadeOut(t, ANIM.escapeFadeMs);
    if (alpha <= 0) return;
    const rig = this.survivorRig(id);
    drawTeamSurvivor(
      rig,
      {
        role,
        x: f.x,
        y: f.y,
        face: f.face,
        walkPhase: 0,
        stepping: 0,
        protectedFlag: false,
        self: false,
        hitMs: null,
        seed: 0,
        clockMs: 0,
        fade: alpha,
        gray,
      },
      sR,
    );
    if (!gray)
      rig.body.setScale(
        rig.body.scaleX * (1 + 0.25 * (1 - alpha)),
        rig.body.scaleY * (1 + 0.25 * (1 - alpha)),
      );
  }

  private monsterPose(
    x: number,
    y: number,
    aim: number,
    stunned: boolean,
    dashing: boolean,
    raise: number,
    g: Gait,
    tS: number,
    half: boolean,
  ): Parameters<typeof drawMonsterRig>[1] {
    const frames = frameCount(ANIM.cloakFrames, half);
    const moving = g.stepping > 0.3;
    const i = cloakFrame(tS, moving, frames) * (ANIM.cloakFrames / frames);
    const frame = stunned
      ? 'monster-stun'
      : dashing
        ? 'monster-dash'
        : cloakFrameName(moving ? 'move' : 'idle', i);
    const blink = eyeBlink(tS, 0.7);
    return {
      x,
      y,
      aim,
      frame,
      raise: stunned ? 0 : raise,
      stretch: dashing ? dashStretch(0, 1) * 0.6 : 0,
      eyes: stunned ? 'stun' : blink ? 'blink' : 'open',
      glow: this.preset.tier !== 'low',
      scale: 1 + 0.012 * Math.sin(tS * 2.4),
      alpha: 1,
    };
  }
}
