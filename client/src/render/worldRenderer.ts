// 월드 렌더링 (TECH_SPEC 5장 · VISUAL_SPEC 정보 우선 규칙 R1 순서). 맵 위 레이어를 컨테이너 하나에 담아 0.93배로 그린다.
//  map · glow (fogRoot: 바닥 · 벽 · 시설 발광 · 거점 · 탈출구 영역 · 시야 채움 · 안개 — baseLayer.ts)
//  → 기절 채도 감소 막 (괴물 화면 기절 중) → floorInfo (배지 · 바닥 문양 — objects.ts) → 시야 경계 림
//  → particles (빛 속 먼지: 그림 묶음 'mote' 이미지) → cone 채움 · 해치 (생존자 화면: 괴물 부채꼴 D4) → 공격 준비 채움
//  → entities: 캐릭터 그림자 → 돌진 잔상 → 이벤트 효과 (불꽃 · 흩어짐 · 발먼지 · 충격파 · 베기 호 · 속도선 · 돌진 줄)
//    → 부채꼴 가장자리 선 · 괴물 화면 자기 시야 테두리 → 범위 선 (공격 준비 경계 · 앞머리 · 캠핑 · 구조 구역 · 밀치기 · 포효)
//    → 바닥 링 → 몸 아래 표시 (노출 문양 · 기절 별) → markers (탐지 · 포효 · 포효 핑) → 발 · 몸
//    → 부착 표시 (거품 · 진행 링 · 부상)
// 그림자(접지 그림자)가 범위 채움 · 부채꼴 채움 위에 깔려 몸과 바깥 링 대비 3:1을 지키고, 경계 선은 그림자 위에 그려 끊기지 않는다.
// 머리 위로 떠 옆 캐릭터에 걸칠 수 있는 표시(노출 문양 · 기절 별)와 괴물 자리 마커는 모든 몸 아래에 그린다(남의 몸을 덮지 않게, R7 · R15).
// 후처리(비네트 · 색보정)는 fogRoot에만 건다(effects.ts WorldPostFx). 캐릭터 · 범위 · 마커 · 배지에는 걸지 않는다.
// 품질은 장식(먼지 · 발먼지 · 눈빛 · 애니메이션 프레임)만 바꾸고, 정보(info · drawn)는 모든 품질에서 같다.
// 범위 · 부채꼴 정보 항목(info)을 먼저 만들고 그 항목에서 그린다(render/vision.ts): 그림과 정보의 출처가 하나다.
// 매 프레임 그리는 Graphics는 원호 명령(100분할)을 쓰지 않고 선분으로 편다. 프레임당 원호 · 채우기 수를 features에 남긴다.
import Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  PRISON_CENTER,
  PRISON_RECT,
  RESCUE_POINT,
  TILE_PX,
  inCircleVision,
  monsterConePolygon,
  monsterConeShape,
  monsterNearPolygon,
  monsterSees,
  survivorVisionPolygon,
  survivorVisionRadius,
  type Balance,
  type DrawnEntity,
  type GameEvent,
  type InfoItem,
  type LayerName,
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
  quantizePhase,
  seedOf,
  windupFill,
} from '../art/anim';
import { MOTE_R, cloakFrameName, ensureAtlas, type AtlasBuild } from '../art/atlas';
import { starSlot } from '../art/shapes';
import { FX_LIMITS, FxSystem, dustMotes, pickDissolveTarget, type DustEye, type StrikeHit } from '../art/fx';
import { CONE, DANGER, NEON, ROLE, WARN } from '../art/palette';
import { effectivePreset, type QualityPreset, type RendererKind } from '../gfx/presets';
import { gfxNow, gfxState, onGfxChange } from '../gfx/state';
import { MAP_PX_H, MAP_PX_W, MAP_SCALE, MAP_X, MAP_Y } from '../ui/layout';
import {
  MonsterRig,
  SurvivorRig,
  drawDashStreak,
  drawHiddenSurvivor,
  drawInjury,
  drawMonsterRig,
  drawRescueRing,
  drawRoarMark,
  drawRoarPing,
  drawSpeedLines,
  drawStunStars,
  drawTeamSurvivor,
  drawTrackMark,
  type BodyDisk,
  type CharacterLayers,
} from './characters';
import { DashTrail, STUN_VEIL, WorldPostFx } from './effects';
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
import {
  ATTACK_RANGE,
  CONE_LOOK,
  drawAttackRange,
  drawCampZone,
  drawConeEdge,
  drawConeHatch,
  drawRescueZone,
  drawRoarWave,
  drawShoveRange,
  fillPolygon,
  mixColor,
  shoveBlockPoint,
  shoveState,
  strokeSegments,
} from './vision';

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

/** 포효 충격파 (괴물 화면, 범위 표시라 이벤트 효과 0.4초 한도 밖) */
export const ROAR_WAVE_MS = 600;
/**
 * 늦게 한 번 그리는 공격 준비를 기다리는 최대 시간 (ms): 이보다 오래되면 지난 일이라 그리지 않는다.
 * 늦게 그릴 수 있는 창(준비 + 보간 지연 ~ 이 값)이 느린 프레임 간격보다 넓어야 한 번은 그린다:
 * 1.5초였을 때 프레임이 1.5초를 넘는 느린 기기(CI 러너)에서 그리기 전에 버려졌다. 받은(처리한) 시각부터 잰다.
 * 멈춤으로 보는 프레임 간격(staleEvents STALL_FRAME_MS 2.5초)보다 길게
 */
const OPP_WINDUP_LATCH_MAX_MS = 3000;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** 방향을 (−π, π]로 접어 반올림 (−π와 π가 같은 값이 되게) */
const ang3 = (a: number): number => {
  let v = a % (Math.PI * 2);
  if (v <= -Math.PI) v += Math.PI * 2;
  if (v > Math.PI) v -= Math.PI * 2;
  return r3(v);
};

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

/** 프레임당 Graphics 원호 · 채우기(Earcut) 명령 수 (R3: 매 프레임 다시 펴는 원호를 쓰지 않는다) */
interface GfxCount {
  arcs: number;
  fills: number;
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
  /** 빛 속 먼지 (그림 묶음 'mote' 이미지 풀) */
  private readonly dust: Phaser.GameObjects.Container;
  private dustImgs: Phaser.GameObjects.Image[] = [];
  /** 부채꼴 채움 · 해치 (캐릭터 그림자 아래) */
  private readonly coneOver: Phaser.GameObjects.Graphics;
  /** 부채꼴 가장자리 선 · 괴물 화면 자기 시야 테두리 (그림자 위, 몸 아래) */
  private readonly coneEdge: Phaser.GameObjects.Graphics;
  private readonly ranges: Phaser.GameObjects.Graphics;
  /** 공격 준비 채움 (캐릭터 그림자 아래) — 경계 선 · 다른 범위는 ranges (그림자 위, 몸 아래) */
  private readonly rangeFill: Phaser.GameObjects.Graphics;
  private readonly fxUnder: Phaser.GameObjects.Graphics;
  private readonly ghosts: Phaser.GameObjects.Container;
  private readonly layers: CharacterLayers;
  /** 기절 별 (몸 아래 표시 레이어 layers.marks 안) */
  private readonly starsG: Phaser.GameObjects.Graphics;
  private readonly attachG: Phaser.GameObjects.Graphics;
  private readonly markers: Phaser.GameObjects.Graphics;
  private readonly badges: Badges;
  /** 기절 채도 감소 막 (괴물 화면): 맵 바로 위 · 배지와 캐릭터 아래. ScreenEffects가 켜고 끈다 */
  readonly stunVeil: Phaser.GameObjects.Rectangle;
  private readonly gfxCount: GfxCount = { arcs: 0, fills: 0 };
  /** 레이어 이름별 표시 객체 (후처리 검사 layerOf) */
  private readonly layerNames = new Map<Phaser.GameObjects.GameObject, LayerName>();
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
  /** 괴물 화면: 포효 충격파 시작(처음 그린 프레임에 정함, null = 아직 안 그림) · 자리 */
  private roarWave: { t0: number | null; x: number; y: number } | null = null;
  /** 괴물 화면: 잡힘 알림 (보이던 자리에서 흩어짐) */
  private captureAt = -1e9;
  /** 기절 별 자리 (괴물 몸 중심에서 본 방향, 기절 중이 아니면 null) */
  private starDir: number | null = null;
  /** 괴물 화면: 마지막 타격 (attackHit 이벤트, 흩어짐 자리를 타격 부채꼴 안으로 좁힌다) */
  private lastStrike: (StrikeHit & { at: number }) | null = null;
  /** 괴물 화면: 기절 알림 (가드가 안 보이면 괴물 몸 중심에서 방향 없이) */
  private stunnedPending = false;
  private shoveSeen = false;
  /** 공격 준비 채움 시작 (performance.now) */
  private windupStart: number | null = null;
  /** 괴물 화면: 이미 windup만큼 그린 준비의 서버 값 꼬리 (서버 준비가 끝날 때까지 다시 그리지 않는다) */
  private windupTail = false;
  /**
   * 생존자 화면: 받은 공격 준비 이벤트 중 아직 한 프레임도 그리지 못한 것(받은 시각 · 방향). 프레임이 준비 시간(0.4초)보다
   * 느린 기기에서도 예고가 한 번은 보이게, 보간된 준비를 한 번도 못 그린 채 준비 시간이 지나면 다음 프레임에 한 번 그린다
   */
  private oppWindupPending: { at: number; dir: number } | null = null;
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
    this.container = scene.add.container(MAP_X, MAP_Y).setScale(MAP_SCALE);
    // 배지(바닥 문양 · 라벨)는 캐릭터보다 먼저 넣어 아래에 그린다 (정보 우선 R15: 배지가 캐릭터를 덮지 않음)
    this.badges = new Badges(scene, this.container);
    // 기절 채도 감소 막: 맵 바로 위, 배지 · 캐릭터 · 범위 · 마커 아래 (맨 앞에 끼운다)
    this.stunVeil = new Phaser.GameObjects.Rectangle(scene, 0, 0, MAP_PX_W, MAP_PX_H, STUN_VEIL.color)
      .setOrigin(0, 0)
      .setAlpha(STUN_VEIL.alpha)
      .setVisible(false);
    this.container.addAt(this.stunVeil, 0);
    const gfx = (): Phaser.GameObjects.Graphics => this.counted(scene.make.graphics({}, false));
    const box = (): Phaser.GameObjects.Container => scene.make.container({}, false);
    this.rims = gfx();
    this.dust = box();
    this.coneOver = gfx();
    this.coneEdge = gfx();
    this.ranges = gfx();
    this.rangeFill = gfx();
    this.fxUnder = gfx();
    this.ghosts = box();
    this.layers = { shadows: box(), ground: box(), marks: box(), bodies: box(), attach: box() };
    this.starsG = gfx();
    this.layers.marks.add(this.starsG);
    this.attachG = gfx();
    this.markers = gfx();
    this.container.add([
      this.rims,
      this.dust,
      this.coneOver,
      this.rangeFill,
      this.layers.shadows,
      this.ghosts,
      this.fxUnder,
      this.coneEdge,
      this.ranges,
      this.layers.ground,
      this.layers.marks,
      // 안개 위 정보 마커(탐지 · 포효)는 몸 바로 아래: 괴물 자리에 그린 탐지 마름모가 0.7타일 안 팀원 몸을 덮지 않게 (R15).
      // 마커는 몸보다 크고 굵은 외곽선이라 몸에 일부 가려도 읽힌다
      this.markers,
      this.layers.bodies,
      this.layers.attach,
      this.attachG,
    ]);
    const named: [LayerName, Phaser.GameObjects.GameObject[]][] = [
      ['map', [this.fogRoot, this.rims]],
      ['entities', [this.container, this.rangeFill, this.ghosts, this.fxUnder, this.ranges, this.attachG]],
      ['entities', Object.values(this.layers)],
      ['particles', [this.dust]],
      ['cone', [this.coneOver, this.coneEdge]],
      ['markers', [this.markers]],
      ['screen', [this.stunVeil]],
    ];
    for (const [name, objs] of named) for (const o of objs) this.layerNames.set(o, name);
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

  /**
   * 후처리 검사(effects.ts collectFxTargets): 이 렌더러의 표시 객체가 속한 레이어 이름. 월드 컨테이너 바로 아래의
   * 모르는 객체는 배지(objects.ts) → floorInfo. 나머지는 null (부모의 레이어를 따른다)
   */
  layerOf(obj: Phaser.GameObjects.GameObject): LayerName | null {
    const name = this.layerNames.get(obj);
    if (name) return name;
    if (obj.parentContainer === this.container) return 'floorInfo';
    return null;
  }

  /** Graphics의 원호 · 채우기 명령을 센다 (fillCircle · strokeCircle · slice · 둥근 사각형도 안에서 arc를 부른다) */
  private counted(g: Phaser.GameObjects.Graphics): Phaser.GameObjects.Graphics {
    const c = this.gfxCount;
    const arc = g.arc.bind(g);
    const fillPath = g.fillPath.bind(g);
    g.arc = (...args: Parameters<typeof arc>) => {
      c.arcs += 1;
      return arc(...args);
    };
    g.fillPath = () => {
      c.fills += 1;
      return fillPath();
    };
    return g;
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
      case 'attackStart':
        if (!isMonster) this.oppWindupPending = { at: nowMs, dir: ev.dir };
        return;
      case 'attackHit':
        if (isMonster) this.lastStrike = { x: ev.x, y: ev.y, dir: ev.dir, hits: ev.hits, at: nowMs };
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
        // 시작 시각은 처음 그리는 프레임에서 정한다: 프레임이 느린 기기에서도 충격파 · 범위가 최소 한 번은 보인다
        if (isMonster && this.lastMe) this.roarWave = { t0: null, x: this.lastMe.x, y: this.lastMe.y };
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
    for (const d of this.dustImgs) d.destroy();
    this.survivorRigs.clear();
    this.monsterRigs.clear();
    this.ghostImgs = [];
    this.dustImgs = [];
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
    this.gfxCount.arcs = 0;
    this.gfxCount.fills = 0;
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

    // 빛 속 먼지 (장식: 자기 팀 시야 안에서만, 시계와 시드만의 함수). 그림 묶음 'mote' 이미지 (원호 테셀레이션 없음)
    const dustN = FX_LIMITS.dust[this.preset.tier];
    const motes = this.useFog ? dustMotes(tS, this.eyes, dustN) : [];
    this.drawDust(motes, balance.survivor.radius);

    // 부채꼴
    this.coneOver.clear();
    this.coneEdge.clear();
    if (isMonster && this.outline.length > 0)
      strokeSegments(this.coneEdge, this.outline, CONE.idle, FOG.outlineAlpha, FOG.outlineWidth / MAP_SCALE);
    if (isMonster && v.me) {
      const shape = monsterConeShape(balance, v.myBlend);
      info.push({
        kind: 'cone',
        tag: 'self',
        x: r3(v.me.x),
        y: r3(v.me.y),
        r: r3(shape.range),
        dir: ang3(v.me.face),
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
        dir: ang3(m.aim),
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
      // 예측한 준비는 누른 순간부터 windup 동안. 서버가 그 입력을 확인하면(hideServerWindup) 예측 표시가 꺼지므로, 이미 그리기 시작한
      // 준비는 같은 시작 시각으로 windup이 다 찰 때까지 이어 그린다(확인이 첫 프레임보다 먼저 와도 서버 값으로 그린다).
      // 다 찬 뒤 서버 값의 꼬리(왕복 지연만큼 늦게 끝남)는 다시 그리지 않는다
      const left = snap.you.mon?.windup ?? 0;
      if (left <= 0) this.windupTail = false;
      const shownMs = this.windupStart === null ? null : v.nowMs - this.windupStart;
      if (v.hideServerWindup && left > 0 && shownMs !== null && shownMs >= atk.windup * 1000)
        this.windupTail = true;
      const serverWindup =
        left > 0 &&
        (!v.hideServerWindup || (!this.windupTail && (shownMs === null || shownMs < atk.windup * 1000)));
      if (serverWindup || v.localWindupDir !== null) {
        windupDir = v.localWindupDir ?? v.me.face;
        windupAt = v.me;
        // 예측한 준비는 누른 순간부터, 서버 값만 있으면 남은 시간에서
        if (this.windupStart === null)
          this.windupStart = v.localWindupDir !== null ? v.nowMs : v.nowMs - (atk.windup - left) * 1000;
      }
    }
    // 생존자 화면: 준비 이벤트를 받았는데 보간된 준비(100ms 늦음)를 준비 시간 안에 한 번도 못 그렸으면 늦게라도 한 번
    const pend = this.oppWindupPending;
    if (pend && (!oppVisible || v.nowMs - pend.at > OPP_WINDUP_LATCH_MAX_MS)) this.oppWindupPending = null;
    const latched =
      this.oppWindupPending !== null &&
      v.nowMs - this.oppWindupPending.at > atk.windup * 1000 + balance.network.interpolationDelayMs;
    if (!isMonster && oppVisible && v.monster && (v.monster.windup > 0 || latched)) {
      windupDir = v.monster.windup > 0 ? v.monster.aim : (this.oppWindupPending?.dir ?? v.monster.aim);
      windupAt = v.monster;
      // 늦게 한 번 그리는 준비는 다 찬 모습으로
      if (this.windupStart === null)
        this.windupStart = v.nowMs - (atk.windup - (v.monster.windup > 0 ? v.monster.windup : 0)) * 1000;
      this.oppWindupPending = null;
      oppFx += 1;
    }
    if (windupDir === null || !windupAt) this.windupStart = null;
    else {
      const fill = windupFill((v.nowMs - (this.windupStart ?? v.nowMs)) / 1000, atk.windup);
      const item: InfoItem = {
        kind: 'range',
        tag: 'attack',
        x: r3(windupAt.x),
        y: r3(windupAt.y),
        r: atk.range,
        dir: ang3(windupDir),
        arc: r3((atk.arc * Math.PI) / 180),
        value: null,
        color: ATTACK_RANGE.color,
        alpha: ATTACK_RANGE.edge,
      };
      info.push(item);
      drawAttackRange(this.rangeFill, this.ranges, item, fill);
      attackRange = true;
    }
    const mon = snap.you.mon;
    if (isMonster && mon && mon.camp > 0) {
      const item: InfoItem = {
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
      };
      info.push(item);
      drawCampZone(this.ranges, item, PRISON_RECT);
    }
    if (isMonster && this.roarWave) {
      this.roarWave.t0 ??= v.nowMs;
      const k = (v.nowMs - this.roarWave.t0) / ROAR_WAVE_MS;
      if (k >= 1 || k < 0) this.roarWave = null;
      else {
        const item: InfoItem = {
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
        };
        info.push(item);
        drawRoarWave(this.ranges, item, k);
      }
    }
    const surv = snap.you.surv;
    if (!isMonster && surv?.status === 'free') {
      const anyPrisoner = [...v.survivors.values()].some((s) => s.status === 'imprisoned');
      if (anyPrisoner) {
        const item: InfoItem = {
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
        };
        info.push(item);
        drawRescueZone(this.ranges, item, tS * 0.4);
      }
      // 가드: 능력 준비 · 괴물이 보이고 가까우면 밀치기 사거리 (in = 서버 판정처럼 거리 안 + 철창 · 벽에 막히지 않음)
      if (v.role === 'guard' && v.me && surv.abilityCd <= 0 && v.monster && snap.monster) {
        const d = Math.hypot(v.monster.x - v.me.x, v.monster.y - v.me.y);
        const range = balance.roles.guard.shoveRange;
        if (d <= range * 2) {
          const item: InfoItem = {
            kind: 'range',
            tag: 'shove',
            x: r3(v.me.x),
            y: r3(v.me.y),
            r: range,
            dir: null,
            arc: null,
            value: shoveState(v.me, v.monster, range),
            color: ROLE.guard,
            alpha: 0.95,
          };
          info.push(item);
          drawShoveRange(this.ranges, item, shoveBlockPoint(v.me, v.monster));
        }
      }
    }

    // 이벤트 효과 · 장식 입자 (캐릭터 아래)
    this.fxUnder.clear();
    this.attachG.clear();
    this.starsG.clear();
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
        this.gaits.delete(id);
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
    this.post.measure();
    gfxState.features.charGfxArcs = this.gfxCount.arcs;
    gfxState.features.charGfxFills = this.gfxCount.fills;
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

  /**
   * 생존자 화면 괴물 부채꼴: 채움 + (빨강) 꼭짓점에서 퍼지는 사선 해치 · 펄스는 그림자 아래(coneOver),
   * 가장자리 선은 그림자 위(coneEdge)에 그려 팀원 몸 둘레에서도 끊기지 않는다
   */
  private drawMonsterCone(balance: Balance, m: MonsterView, tS: number): void {
    const cone = monsterConePolygon(balance, m, m.aim, m.blend);
    const color = mixColor(CONE.idle, CONE.seen, this.coneRed);
    const fill = CONE_LOOK.fillIdle + (CONE_LOOK.fillSeen - CONE_LOOK.fillIdle) * this.coneRed;
    fillPolygon(this.coneOver, cone, color, fill);
    drawConeHatch(this.coneOver, cone, m, m.aim, this.coneRed, tS, color);
    drawConeEdge(this.coneEdge, cone, color);
  }

  /** 빛 속 먼지 이미지 (그림 묶음 'mote': 반지름 MOTE_R × 생존자 반지름으로 구운 둥근 점) */
  private drawDust(
    motes: readonly { x: number; y: number; alpha: number; size: number }[],
    sR: number,
  ): void {
    while (this.dustImgs.length < motes.length) {
      const img = this.scene.make.image({ key: this.atlasKey, frame: 'mote' }, false).setVisible(false);
      this.dust.add(img);
      this.dustImgs.push(img);
    }
    const tpw = this.atlas?.texPerWorld ?? 1;
    const baked = MOTE_R * sR * TILE_PX;
    this.dustImgs.forEach((img, i) => {
      const m = motes[i];
      if (!m) {
        img.setVisible(false);
        return;
      }
      // 장식 입자 상한: 알파 0.2 · 반지름 2 논리 px
      const r = Math.min(FX_LIMITS.decorSizeMaxPx, m.size) / MAP_SCALE;
      const k = r / baked / tpw;
      img
        .setPosition(m.x * TILE_PX, m.y * TILE_PX)
        .setScale(k)
        .setAlpha(Math.min(FX_LIMITS.decorAlphaMax, m.alpha))
        .setVisible(true);
    });
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
      // 괴물 화면: 잡힘 알림 직후 사라진(또는 수감된) 생존자는 보이던 자리에서 흩어진다. 후보는 같은 순간 타격 부채꼴 안에
      // 있던 생존자뿐이다(같은 순간 시야를 벗어난 다른 생존자 자리에서 흩어지지 않게). 맞는 후보가 없으면 연출을 생략한다
      if (realMs - this.captureAt < 400 && v.me) {
        const cands: { id: string; x: number; y: number }[] = [];
        for (const [id, st] of this.lastStatus) {
          if (st.status !== 'free') continue;
          const now = v.survivors.get(id);
          if (now && now.status === 'free') continue;
          cands.push({ id, x: st.x, y: st.y });
        }
        const strike =
          this.lastStrike && Math.abs(this.lastStrike.at - this.captureAt) < 400 ? this.lastStrike : null;
        const atk = balance.monster.attack;
        const best = pickDissolveTarget(
          cands,
          strike,
          { range: atk.range, arc: (atk.arc * Math.PI) / 180 },
          sR,
        );
        if (best) {
          this.fxs.dissolve(best.x, best.y, sR, nowS, null, true);
          this.lastStatus.delete(best.id);
          this.captureAt = -1e9;
        }
      }
      for (const id of [...this.lastStatus.keys()]) if (!v.survivors.has(id)) this.lastStatus.delete(id);
    }

    // 노출 문양 · 기절 별 자리를 고를 몸 원 (이 화면에 그리는 생존자 · 괴물 화면은 괴물 자신, 생존자 화면은 나)
    const disks: (BodyDisk & { id: string })[] = [];
    for (const [id, s] of v.survivors)
      if (s.status !== 'dead' && s.status !== 'escaped') disks.push({ id, x: s.x, y: s.y, r: sR });
    const myStatus = snap.you.surv?.status;
    if (v.me && myStatus !== 'dead' && myStatus !== 'escaped')
      disks.push({ id: v.selfId, x: v.me.x, y: v.me.y, r: isMonster ? mR : sR });
    const starDir = (cx: number, cy: number, self: string): number => {
      this.starDir = starSlot(
        { x: cx, y: cy },
        mR,
        TILE_PX,
        disks.filter((d) => d.id !== self),
        this.starDir,
      );
      return this.starDir;
    };
    let starsDrawn = false;

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
        const others = s.role ? disks.filter((d) => d.id !== id) : [];
        drawHiddenSurvivor(
          rig,
          s.x,
          s.y,
          s.face,
          phaseOf(g),
          g.stepping,
          s.protected,
          s.role,
          animMs,
          sR,
          others,
        );
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
        drawStunStars(this.starsG, m.x, m.y, tS, mR, starDir(m.x, m.y, 'monster'));
        starsDrawn = true;
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
          drawStunStars(this.starsG, v.me.x, v.me.y, tS, mR, starDir(v.me.x, v.me.y, v.selfId));
          starsDrawn = true;
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
    if (!starsDrawn) this.starDir = null;
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
