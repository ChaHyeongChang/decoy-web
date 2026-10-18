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
  cloakFrame,
  dashStretch,
  eyeBlink,
  fadeOut,
  frameCount,
  quantizePhase,
  seedOf,
  stepGait,
  windupFill,
  writePiece,
  type TravelPiece,
} from '../art/anim';
import { MOTE_R, cloakFrameName, ensureAtlas, type AtlasBuild } from '../art/atlas';
import { NEW_POSE_MS, monsterFrameNew, type MonsterFrameInput } from '../art/charFrames';
import { starSlot } from '../art/shapes';
import {
  DashTrail,
  DustField,
  FX_LIMITS,
  FxSystem,
  pickDissolveTarget,
  type DustEye,
  type DustMote,
  type LiveGhost,
  type StrikeHit,
} from '../art/fx';
import { CONE, DANGER, NEON, ROLE, WARN } from '../art/palette';
import { effectivePreset, type QualityPreset, type RendererKind } from '../gfx/presets';
import { currentCharStyle } from '../gfx/charStyle';
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
  type MonsterPose,
  type TeamSurvivorPose,
} from './characters';
import { STUN_VEIL, WorldPostFx } from './effects';
import { ALPHA, FOG } from './colors';
import { createFogLayer, type FogLayer } from './baseLayer';
import {
  ConeRedTrack,
  PhaseClock,
  PolyCache,
  ambientRgb,
  compositeScaleFor,
  fogPathFor,
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
  fillFanPolygon,
  fillPolygon,
  mixColor,
  shoveBlockPoint,
  shoveState,
  strokeSegments,
  traceRim,
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
  /** 마지막 스냅샷을 받은 시각 (performance.now): 스냅샷으로 바뀐 상태가 시작된 순간 */
  snapAt: number;
  /** 괴물 화면: 예측한 공격 준비 · 돌진을 누른 시각 (입력 틱, 없으면 null) */
  localWindupAt: number | null;
  localDashAt: number | null;
  /** 보간 엔티티의 프레임 사이 경로 · 상태 경계 (없으면 프레임 사이 직선 · 프레임 시각을 쓴다) */
  motion: MotionSource | null;
}

/**
 * 보간 엔티티(다른 생존자 · 생존자 화면의 괴물)의 지난 프레임 → 이번 프레임 사이 (렌더링 최적화: 프레임 독립성).
 * 걷기는 보간 경로를 표본 시각에서 나눈 조각으로 재고, 상태(준비 · 돌진 · 수감 · 발각)가 바뀐 프레임은 바뀐 경계 시각부터 잰다
 */
export interface MotionSource {
  /** 보간 경로 조각들 (시간 순서, out 앞에서부터 쓴 수). 보간 엔티티가 아니면 −1 */
  travel(kind: 'survivor' | 'monster', id: string, out: TravelPiece[]): number;
  /** 이번 프레임 사이에 보간 상태가 바뀔 수 있었던 경계의 이 기기 시각 (ms, 없으면 null) */
  edgeAt(kind: 'survivor' | 'monster', id: string): number | null;
  /**
   * 내 캐릭터의 조각들 (anim selfPieces): 걷는 중인지는 입력 틱마다 예측 상태가 움직였는가로, 거리는 예측 보간(직전 틱 상태 →
   * 지금 틱 상태)의 빠르기로 잰다. 입력 틱 · 스냅샷 보정 · 보간이 다 간 순간에서 나눈다. 쓴 조각 수, 기록이 없으면 −1
   */
  selfTravel(out: TravelPiece[]): number;
}

/** 프레임 독립성 시험용 월드 연출 상태 (AnimDebug의 월드 부분) */
export interface WorldAnimDebug {
  gait: Record<string, { phase: number; stepping: number }>;
  fogAt: number | null;
  coneRed: number;
  dashGhosts: number;
  ghosts: { at: number; alpha: number }[];
  particles: number;
}

/**
 * 시야 원 · 안개 갱신 주기 (ms). 생존자 시야는 0.1초 이하, 괴물 부채꼴은 판정과 맞게 자주(1/30초).
 * 정해진 시각에 위상을 고정해 갱신한다(fogMath PhaseClock): 60fps에서는 예전처럼 3 · 2프레임마다, 120fps는 6 · 4프레임마다.
 * 괴물 주기는 예전 '33ms 넘게 지나면'이 60fps에서 실제로 두 프레임(33.3ms)마다였던 것을 그대로 1/30초로 적는다
 */
const SURVIVOR_FOG_MS = 50;
const MONSTER_FOG_MS = 1000 / 30;

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
  /** 이번 프레임에 발이 닿은 순간 (performance.now 기준 ms, 발먼지 입자의 태어난 시각) */
  footAt: number;
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

/** 정보 항목 중 한 종류의 수 */
function countKind(items: readonly InfoItem[], kind: InfoItem['kind']): number {
  let n = 0;
  for (const i of items) if (i.kind === kind) n += 1;
  return n;
}

/** 거점 id가 점령 중인가 (프레임마다 조건 함수를 만들지 않게) */
function capturing(points: readonly { id: string; state: string }[], id: 'A' | 'B'): boolean {
  for (const p of points) if (p.id === id && p.state === 'capturing') return true;
  return false;
}

// ── 렌더링 최적화 2: 프레임마다 새로 만들던 배열 · 객체 · 문자열을 다시 쓰는 그릇으로 (그림 · 정보 값은 같다) ──

/** 망토 물결 프레임 이름 (cloakFrameName 결과를 미리: 프레임마다 문자열을 만들지 않게) */
const CLOAK_NAMES: Readonly<Record<'idle' | 'move', readonly string[]>> = {
  idle: Array.from({ length: ANIM.cloakFrames }, (_, i) => cloakFrameName('idle', i)),
  move: Array.from({ length: ANIM.cloakFrames }, (_, i) => cloakFrameName('move', i)),
};

function cloakName(kind: 'idle' | 'move', i: number): string {
  return CLOAK_NAMES[kind][i] ?? cloakFrameName(kind, i);
}

const NO_MOTES: readonly DustMote[] = [];

/** 이번 안개 주기의 자기 팀 시야 하나 (먼지 · 림) */
type Eye = DustEye & { role: RoleId | null; r: number };

/** 생존자 팀 시야의 눈 (자기 + 팀원) */
interface TeamEye {
  pos: Vec2;
  role: RoleId;
}

/** 몸 원 + 누구의 몸인가 */
type IdDisk = BodyDisk & { id: string };

/**
 * 부채꼴 · 테두리 Graphics에 마지막으로 그린 것 (같으면 명령을 다시 만들지 않는다). key = 그린 다각형(시야 다각형 캐시의 같은 참조)
 * 또는 괴물 화면 테두리 선분 목록, null = 비어 있음, DIRTY = 다음 프레임에 반드시 다시 (시계로 흐르는 해치를 그렸다)
 */
interface ConeDrawn {
  key: object | null;
  color: number;
  fill: number;
}

const DIRTY: object = {};

const NO_TEAM: readonly TeamEye[] = [];

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
  /** outline을 만든 다각형 (부채꼴 · 근접 원). 같은 참조면 다시 계산하지 않는다 */
  private outlineOf: [readonly Vec2[] | null, readonly Vec2[] | null] = [null, null];
  /** 시야 다각형 캐시: 같은 눈이 같은 자리 · 같은 모양이면 같은 다각형 (가만히 선 동안 가시 다각형 계산을 건너뛴다) */
  private readonly polys = new PolyCache();
  /** 이번 프레임에 화면에 있는 효과 출처 (프레임마다 비워 다시 쓴다) */
  private readonly present = new Set<string>();
  /** 림을 그린 눈들 (다각형 참조 · 역할) */
  private rimsOf: { poly: readonly Vec2[]; role: RoleId | null }[] = [];
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
  /** 안개 · 시야 갱신 시계 (정해진 시각에 위상 고정) */
  private readonly fogClock = new PhaseClock();
  private coneRed = 0;
  private readonly coneTrack = new ConeRedTrack();
  /** 지난 프레임 시각 (스냅샷 · 입력 틱으로 바뀐 상태가 이번 프레임 사이에 바뀌었는지 가린다) */
  private lastDrawAt: number | null = null;
  /** 걷기 조각 (프레임마다 다시 쓴다) */
  private readonly pieces: TravelPiece[] = [];
  /** 이번 프레임에 걷기를 진행한 엔티티 (디버그 animDebug) */
  private readonly gaitDrawn = new Set<string>();
  /** 이번 프레임의 돌진 잔상 (디버그 animDebug) */
  private lastGhosts: readonly LiveGhost[] = [];
  /** 돌진 잔상에 넘기는 자리 (프레임마다 새로 만들지 않는다. DashTrail은 값만 복사한다) */
  private readonly dashAt = { x: 0, y: 0, aim: 0 };
  /** 이번 프레임 (dashOnset이 읽는다) */
  private dashView: FrameView | null = null;
  /** 새 돌진이 시작된 순간: 내 돌진은 누른 입력 틱(이번 프레임 사이면), 아니면 받은 스냅샷 · 상대는 보간 표본 경계 */
  private readonly dashOnset = (): number => {
    const v = this.dashView;
    if (!v) return 0;
    if (v.role !== 'monster') return this.flipAt(v, 'monster', 'monster');
    const pressed = v.localDashAt;
    const prev = this.lastDrawAt;
    return pressed !== null && prev !== null && pressed > prev && pressed <= v.nowMs
      ? pressed
      : this.snapEdge(v);
  };
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
  /** 이번 안개 주기의 자기 팀 시야 (먼지 · 림). 항목은 eyePool에서 다시 쓴다 */
  private readonly eyes: Eye[] = [];
  private readonly eyePool: Eye[] = [];
  /** 빛 속 먼지 (칸 목록은 눈마다의 칸 범위가 바뀔 때만 다시 만든다) */
  private readonly dustField = new DustField();
  /** WebGL 렌더러인가 (부채 삼각형 채우기: Canvas는 fillPath 그대로) */
  private readonly webgl: boolean;
  /** 이번 프레임의 생존자 팀 시야 눈들 (survivorEyes, 항목은 teamEyePool에서) */
  private readonly teamEyes: TeamEye[] = [];
  private readonly teamEyePool: TeamEye[] = [];
  /** 이번 프레임의 범위 · 부채꼴 · 캐릭터 정보 항목 (배지 정보 앞에 붙여 info로) */
  private readonly infoLocal: InfoItem[] = [];
  /** 노출 문양 · 기절 별 자리를 고를 몸 원 (diskPool에서) · 그중 자기를 뺀 것 */
  private readonly disks: IdDisk[] = [];
  private readonly diskPool: IdDisk[] = [];
  private readonly others: BodyDisk[] = [];
  /** 괴물 화면: 흩어짐 후보 */
  private readonly dissolveCands: { id: string; x: number; y: number }[] = [];
  /** 그리기 값 그릇 (그리기 함수는 동기라 하나를 다시 쓴다) */
  private readonly teamPose: TeamSurvivorPose = {
    role: 'runner',
    x: 0,
    y: 0,
    face: 0,
    walkPhase: 0,
    stepping: 0,
    protectedFlag: false,
    self: false,
    hitMs: null,
    seed: 0,
    clockMs: 0,
    fade: 1,
    gray: false,
    action: 0,
    captive: false,
    reach: false,
  };
  private readonly monPose: MonsterPose = {
    x: 0,
    y: 0,
    aim: 0,
    frame: '',
    raise: 0,
    stretch: 0,
    eyes: 'open',
    glow: false,
    scale: 1,
    alpha: 1,
  };
  private readonly badgeAlpha: BadgeAlpha = { points: { A: 1, B: 1 }, exits: { N: 1, S: 1 }, prison: 1 };
  private readonly badgeBlink: Record<'A' | 'B', boolean> = { A: false, B: false };
  /** 부채꼴 채움 · 해치(coneOver)와 가장자리 · 테두리(coneEdge)에 마지막으로 그린 것 */
  private readonly overDrawn: ConeDrawn = { key: null, color: -1, fill: -1 };
  private readonly edgeDrawn: ConeDrawn = { key: null, color: -1, fill: -1 };
  /** 기절 별 자리 고르기에 넘기는 중심 (값만 읽힌다) */
  private readonly starAt = { x: 0, y: 0 };
  /** 이번 프레임 기절 별 (drawCharacters) */
  private stunAny = false;
  private stunOpp = false;
  private gaits = new Map<string, Gait>();
  private lastStatus = new Map<string, { status: SurvivorStatus; x: number; y: number; face: number }>();
  private fades = new Map<string, Fade>();
  /** 생존자 화면: 최근 피격 (이벤트 좌표) */
  /** 생존자 화면 피격 (id = 맞은 팀원: 받은 뒤 첫 프레임에 이벤트 자리에서 가장 가까운 한 명. undefined = 아직 안 정함) */
  private hits: { x: number; y: number; you: boolean; t0: number; id?: string | null }[] = [];
  /** 생존자 화면: 팀원 질주 끝 시각 (performance.now, 규칙 시간 sprintDuration) */
  private sprintUntil = 0;
  /** 새 스타일 자세: 가드 밀치기 · 스카우트 탐지 · 괴물 타격 · 포효 이벤트를 받은 시각 (ms) */
  private shoveAt = -1e9;
  private scanAt = -1e9;
  private strikeAt = -1e9;
  private roarAt = -1e9;
  /** 이번 프레임 시각 (monsterPose가 읽는다) */
  private poseNowMs = 0;
  /**
   * 괴물 화면: 포효 충격파 시작(포효 핑을 받은 시각) · 자리 · 한 번이라도 그렸는가. 처음 그리는 프레임이 이미 끝난 뒤면
   * (프레임이 0.6초보다 느린 기기) 그 프레임부터 시작해 최소 한 번은 보인다
   */
  private roarWave: { t0: number; x: number; y: number; drawn: boolean } | null = null;
  /** 괴물 화면: 잡힘 알림 (보이던 자리에서 흩어짐) */
  private captureAt = -1e9;
  /** 기절 별 자리 (괴물 몸 중심에서 본 방향, 기절 중이 아니면 null) */
  private starDir: number | null = null;
  /** 괴물 화면: 마지막 타격 (attackHit 이벤트, 흩어짐 자리를 타격 부채꼴 안으로 좁힌다) */
  private lastStrike: (StrikeHit & { at: number }) | null = null;
  /** 괴물 화면: 기절 알림 (가드가 안 보이면 괴물 몸 중심에서 방향 없이) · 받은 시각 */
  private stunnedPending = false;
  private stunnedAt = 0;
  private shoveSeen = false;
  /** 공격 준비 채움 시작 (performance.now) */
  private windupStart: number | null = null;
  /** 새 스타일 괴물 프레임 고르기 입력 (그릇 하나를 다시 쓴다) */
  private readonly monFrameIn: MonsterFrameInput = {
    stunned: false,
    dashing: false,
    windup: false,
    strike: false,
    roar: false,
    moving: false,
    cloak: 0,
  };
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
    /** 공격 준비 채움 (0~1, 범위가 없으면 0). E2E가 차오르는 앞머리 호와 판정 경계를 구별할 때 쓴다 */
    attackFill: 0,
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
    this.webgl = scene.game.renderer.type === Phaser.WEBGL;
    this.fogRoot = scene.add.container(0, 0);
    this.preset = this.currentPreset();
    this.fog = this.buildFog();
    // 안개 갱신 격자의 기준 = 시계 0 (주기의 배수 시각). 첫 프레임 · 판 장면을 만든 순간은 fps · 판마다 다르지만
    // 시계의 배수는 같다: 60 · 120fps가 같은 시각에 갱신한다
    this.fogClock.anchor(0);
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
        this.strikeAt = nowMs;
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
        // 새 스타일 팀원 자세 (생존자 화면만. 괴물 화면 생존자 프레임은 능력과 무관하다)
        if (!isMonster && ev.role === 'guard') this.shoveAt = nowMs;
        if (!isMonster && ev.role === 'scout') this.scanAt = nowMs;
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
        this.stunnedAt = nowMs;
        return;
      case 'imprisoned':
        if (isMonster) this.captureAt = nowMs;
        return;
      case 'roarPings':
        // 시작은 받은 시각 (프레임 수와 무관). 프레임이 느린 기기에서도 충격파 · 범위가 최소 한 번은 보인다(draw)
        if (isMonster && this.lastMe)
          this.roarWave = { t0: nowMs, x: this.lastMe.x, y: this.lastMe.y, drawn: false };
        if (isMonster) this.roarAt = nowMs;
        return;
      case 'roar':
        // 생존자 화면: 괴물이 포효했다 (보일 때 새 스타일 포효 자세)
        if (!isMonster) this.roarAt = nowMs;
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
    this.fogClock.reset();
  }

  /** 그림 텍스처 (zoom · 반지름 · 캐릭터 스타일이 바뀌면 다시 굽고 그림 묶음을 새로 만든다) */
  private ensureArt(balance: Balance): AtlasBuild {
    const a = ensureAtlas(this.scene.textures, {
      zoom: gfxState.zoom,
      survivorR: balance.survivor.radius,
      monsterR: balance.monster.radius,
      style: currentCharStyle(),
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
      r = new SurvivorRig(
        this.scene,
        this.atlasKey,
        this.layers,
        this.atlas?.texPerWorld ?? 1,
        this.atlas?.params.style ?? 'classic',
      );
      this.survivorRigs.set(id, r);
    }
    r.used = true;
    return r;
  }

  private monsterRig(id: string): MonsterRig {
    let r = this.monsterRigs.get(id);
    if (!r) {
      r = new MonsterRig(
        this.scene,
        this.atlasKey,
        this.layers,
        this.atlas?.texPerWorld ?? 1,
        this.atlas?.params.style ?? 'classic',
      );
      this.monsterRigs.set(id, r);
    }
    r.used = true;
    return r;
  }

  /**
   * 이동 거리로 걷기 위상을 진행 (멈추면 그 자세로 정지). 순간이동(60fps 한 프레임에 1타일 넘는 빠르기)은 위상을 잇지 않는다.
   * 보간 엔티티(kind)는 보간 경로를 표본 시각에서 나눈 조각으로 재고(모퉁이를 현으로 깎지 않게), 내 캐릭터(kind = null)는
   * 입력 틱 · 보정 기록으로 잰다(selfTravel). 둘 다 없으면 프레임 사이 직선 하나.
   * 걷기 판단 · 자세 섞기는 시간으로 잰다(anim stepGait): 60 · 120fps에서 같은 시각에 같은 위상 · 자세 (렌더링 최적화)
   */
  private gait(
    v: FrameView,
    id: string,
    x: number,
    y: number,
    frameMs: number,
    kind: 'survivor' | 'monster' | null,
  ): Gait {
    let g = this.gaits.get(id);
    if (!g) {
      g = { phase: 0, x, y, stepping: 0, footfall: false, footAt: v.nowMs };
      this.gaits.set(id, g);
    }
    const pieces = this.pieces;
    const chord = Math.hypot(x - g.x, y - g.y);
    let n =
      v.motion === null
        ? -1
        : kind === null
          ? v.motion.selfTravel(pieces)
          : v.motion.travel(kind, id, pieces);
    if (n < 0) {
      writePiece(pieces, 0, frameMs, chord);
      n = 1;
    }
    const fall = stepGait(g, pieces, n);
    let total = 0;
    for (let i = 0; i < n; i += 1) total += pieces[i]?.ms ?? 0;
    g.footfall = fall !== null;
    g.footAt = fall === null ? v.nowMs : v.nowMs - (total - fall);
    g.x = x;
    g.y = y;
    this.gaitDrawn.add(id);
    return g;
  }

  /** 스냅샷으로 바뀐 상태가 시작된 순간: 지난 프레임 뒤에 받은 스냅샷이면 받은 시각, 아니면 지금 */
  private snapEdge(v: FrameView): number {
    const prev = this.lastDrawAt;
    return prev !== null && v.snapAt > prev && v.snapAt <= v.nowMs ? v.snapAt : v.nowMs;
  }

  /** 보간 엔티티의 상태가 이번 프레임에 바뀌었으면 그 순간 (표본 경계, 아니면 받은 스냅샷 · 지금) */
  private flipAt(v: FrameView, kind: 'survivor' | 'monster', id: string): number {
    const t = v.motion?.edgeAt(kind, id) ?? null;
    return t !== null && t <= v.nowMs ? t : this.snapEdge(v);
  }

  /** 프레임 독립성 시험용: 이번 프레임의 걷기 · 안개 갱신 · 부채꼴 색 · 잔상 · 입자 */
  animDebug(): WorldAnimDebug {
    const gait: Record<string, { phase: number; stepping: number }> = {};
    for (const id of this.gaitDrawn) {
      const g = this.gaits.get(id);
      if (g) gait[id] = { phase: g.phase, stepping: g.stepping };
    }
    return {
      gait,
      fogAt: this.fogClock.last,
      coneRed: this.coneRed,
      dashGhosts: this.fx.dashGhosts,
      ghosts: this.lastGhosts.map(({ g, alpha }) => ({ at: g.at, alpha })),
      particles: this.fxs.count,
    };
  }

  /**
   * 생존자 팀 시야의 눈들 (자기 + 팀원, 사망 · 탈출 제외). 프레임마다 한 번 teamEyes에 다시 쓴다 (안개 주기 · 배지 알파가 같이 쓴다)
   */
  private survivorEyes(v: FrameView): readonly TeamEye[] {
    const eyes = this.teamEyes;
    eyes.length = 0;
    const st = v.snap.you.surv?.status;
    if (v.me && v.role !== 'monster' && st !== 'dead' && st !== 'escaped') this.putTeamEye(v.me, v.role);
    for (const s of v.survivors.values()) {
      if (s.status === 'dead' || s.status === 'escaped' || !s.role) continue;
      this.putTeamEye(s, s.role);
    }
    return eyes;
  }

  private putTeamEye(pos: Vec2, role: RoleId): void {
    const eyes = this.teamEyes;
    let e = this.teamEyePool[eyes.length];
    if (!e) {
      e = { pos, role };
      this.teamEyePool.push(e);
    }
    e.pos = pos;
    e.role = role;
    eyes.push(e);
  }

  /** 이번 안개 주기의 눈 하나를 eyes에 넣는다 (항목은 eyePool에서 다시 쓴다) */
  private pushEye(poly: readonly Vec2[], center: Vec2, radius: number, role: RoleId | null, r: number): void {
    let e = this.eyePool[this.eyes.length];
    if (!e) {
      e = { poly, center, radius, role, r };
      this.eyePool.push(e);
    }
    e.poly = poly;
    e.center = center;
    e.radius = radius;
    e.role = role;
    e.r = r;
    this.eyes.push(e);
  }

  draw(v: FrameView, frameMs: number): void {
    const { balance, snap } = v;
    const isMonster = v.role === 'monster';
    this.lastBalance = balance;
    this.lastRole = v.role;
    this.lastMe = v.me;
    // 이번 프레임 목록은 지난 프레임 배열을 비워 다시 쓴다 (GameScene · 미니맵 · 디버그는 그 프레임 안에서 읽거나 복사한다)
    const drawn = this.drawn;
    drawn.length = 0;
    const info = this.infoLocal;
    info.length = 0;
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
    // 생존자 팀 시야의 눈들 (안개 주기 · 배지 알파가 같이 쓴다: 한 프레임에 한 번). 괴물 화면은 내 자리가 있으면 쓰지 않는다
    // (배지 알파는 괴물이면 부채꼴로 잰다 — 예전과 같은 갈래)
    const team = isMonster && v.me ? NO_TEAM : this.survivorEyes(v);
    const myShape = isMonster ? monsterConeShape(balance, v.myBlend) : null;

    // 1~6. 바닥 · 거점 · 탈출구 영역 · 시야 채움 · 안개 — 갱신 주기마다 합성
    // (그림이 지난 주기와 같으면 안개 레이어가 합성 · 업로드를 건너뛰고, 미니맵도 다시 그리지 않는다)
    const fogDue = this.fogClock.due(v.nowMs, isMonster ? MONSTER_FOG_MS : SURVIVOR_FOG_MS, frameMs);
    this.baseRefreshed = false;
    this.gaitDrawn.clear();
    if (fogDue) {
      const b = this.fog;
      b.begin();
      b.drawPoints(snap.world.points, balance);
      b.drawExits(snap.world.exits, balance);
      this.eyes.length = 0;
      if (isMonster && v.me && myShape) {
        const me = v.me;
        const near =
          this.polys.peek('near', me.x, me.y, 0, 0) ??
          this.polys.put('near', me.x, me.y, 0, 0, monsterNearPolygon(balance, me));
        const cone =
          this.polys.peek('cone', me.x, me.y, me.face, v.myBlend) ??
          this.polys.put(
            'cone',
            me.x,
            me.y,
            me.face,
            v.myBlend,
            monsterConePolygon(balance, me, me.face, v.myBlend),
          );
        b.fillPoly(near, DANGER, CONE_LOOK.nearFill);
        b.fillPoly(cone, CONE.idle, CONE_LOOK.selfFill);
        b.addHardLight(near);
        b.addHardLight(cone);
        // 테두리는 두 다각형이 그대로면 지난 값 (다각형 캐시가 같은 참조를 돌려준다)
        if (!this.useFog) this.setOutline([], null, null);
        else if (this.outlineOf[0] !== cone || this.outlineOf[1] !== near) {
          this.setOutline(unionOutline([cone, near]), cone, near);
        }
        this.pushEye(cone, v.me, myShape.range, null, myShape.range);
        const nr = balance.monster.nearVisionRadius;
        this.pushEye(near, v.me, nr, null, nr);
      } else {
        this.setOutline([], null, null);
        for (const e of team) {
          const r = survivorVisionRadius(balance, e.role);
          const pos = e.pos;
          const poly =
            this.polys.peek(e.role, pos.x, pos.y, r, 0) ??
            this.polys.put(e.role, pos.x, pos.y, r, 0, survivorVisionPolygon(pos, r));
          b.fillPoly(poly, CONE_LOOK.visionTint, CONE_LOOK.visionTintAlpha);
          b.addSoftLight({ poly, center: e.pos, radius: r, soft: balance.survivor.visionSoftEdge });
          this.pushEye(poly, e.pos, r - balance.survivor.visionSoftEdge, e.role, r);
        }
      }
      b.commit();
      this.baseRefreshed = b.changed;
      this.drawRims();
    }

    // 빛 속 먼지 (장식: 자기 팀 시야 안에서만, 시계와 시드만의 함수). 그림 묶음 'mote' 이미지 (원호 테셀레이션 없음)
    const dustN = FX_LIMITS.dust[this.preset.tier];
    const motes = this.useFog ? this.dustField.motes(tS, this.eyes, dustN) : NO_MOTES;
    this.drawDust(motes, balance.survivor.radius);

    // 부채꼴: 그린 것이 지난 프레임과 같으면(같은 다각형 캐시 참조 · 같은 색) Graphics 명령을 다시 만들지 않는다
    if (isMonster) this.drawOutline();
    if (isMonster && v.me && myShape) {
      const shape = myShape;
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
    // 부채꼴 색은 seesSomeone이 바뀐 순간(보간 표본 경계)부터 잰다 (프레임 수와 무관)
    this.coneRed = this.coneTrack.update(
      coneShown,
      v.monster?.seesSomeone === true,
      v.nowMs,
      coneShown ? this.flipAt(v, 'monster', 'monster') : v.nowMs,
    );
    if (!isMonster && !v.monster) this.clearMonsterCone();
    if (!isMonster && v.monster) {
      const m = v.monster;
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
    }

    // 상대 쪽 잔여 효과 규칙: 생존자 화면에서 괴물이 나오는 효과는 이번 스냅샷에 괴물이 있을 때만
    const oppVisible = isMonster || opponentFxAllowed(snap.monster !== null);
    const present = this.present;
    present.clear();
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
    let attackFill = 0;
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
        // 예측한 준비는 누른 순간(입력 틱)부터, 서버 값만 있으면 그 스냅샷을 받은 순간의 남은 시간에서
        if (this.windupStart === null)
          this.windupStart =
            v.localWindupDir !== null
              ? (v.localWindupAt ?? v.nowMs)
              : Math.min(v.nowMs, v.snapAt) - (atk.windup - left) * 1000;
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
      // 보간된 준비는 보간 상태가 바뀐 순간(표본 경계)부터, 늦게 한 번 그리는 준비는 다 찬 모습으로
      if (this.windupStart === null)
        this.windupStart =
          v.monster.windup > 0
            ? this.flipAt(v, 'monster', 'monster') - (atk.windup - v.monster.windup) * 1000
            : v.nowMs - atk.windup * 1000;
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
      attackFill = r3(fill);
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
      const wave = this.roarWave;
      if (!wave.drawn && v.nowMs - wave.t0 >= ROAR_WAVE_MS) wave.t0 = v.nowMs;
      wave.drawn = true;
      const k = (v.nowMs - wave.t0) / ROAR_WAVE_MS;
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
      let anyPrisoner = false;
      for (const s of v.survivors.values()) if (s.status === 'imprisoned') anyPrisoner = true;
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

    // 돌진 잔상 (보이는 화면, dash.duration): 돌진 중 위치를 남기고 옅어진다 + 붉은 줄.
    // 잔상은 돌진이 시작된 순간(내 돌진: 누른 입력 틱, 상대: 보간 표본 경계)부터 1/30초 격자 (프레임 수와 무관)
    this.dashTrail.setLife(balance.monster.dash.duration * 1000);
    const dashing = isMonster
      ? v.me && v.myDashing
        ? v.me
        : null
      : oppVisible && v.monster?.dashing
        ? v.monster
        : null;
    const at = this.dashAt;
    if (dashing) {
      at.x = dashing.x;
      at.y = dashing.y;
      at.aim = 'aim' in dashing ? dashing.aim : dashing.face;
    }
    this.dashView = v;
    // 그리지 않은 틈(숨김 · 루프 멈춤)이 길면 DashTrail이 지난 돌진을 잇지 않는다
    this.dashTrail.update(dashing ? at : null, v.nowMs, this.dashOnset);
    const ghosts = this.dashTrail.live(v.nowMs);
    this.lastGhosts = ghosts;
    this.drawGhosts(ghosts, mR);
    if (ghosts.length > 0) drawDashStreak(this.fxUnder, ghosts);
    if (!isMonster) oppFx += ghosts.length;

    // 캐릭터
    for (const r of this.survivorRigs.values()) r.used = false;
    for (const r of this.monsterRigs.values()) r.used = false;
    this.drawCharacters(v, drawn, info, tS, animMs, clockMs, frameMs, footDust, oppVisible, sR, mR);
    if (this.stunOpp) oppFx += 1;

    // 이벤트 효과 갱신 · 그리기 (WebGL은 채운 점을 삼각형 부채로: Earcut 없음)
    this.fxs.update(clockMs / 1000, present);
    this.fxs.draw(this.fxUnder, clockMs / 1000, 32, this.webgl);
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
        // 걷기도 생존자처럼 지운다: 시야에서 사라진 프레임이 fps마다 다르면(120fps는 사라지기 직전 프레임을 하나 더 그린다)
        // 남은 위상이 달라져 다시 나타난 뒤에도 이어졌다 (렌더링 최적화)
        this.gaits.delete(id);
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
    const alpha = this.badgeAlpha;
    alpha.points.A = this.seenAlpha(v, team, CAPTURE_POINTS.A);
    alpha.points.B = this.seenAlpha(v, team, CAPTURE_POINTS.B);
    alpha.exits.N = this.seenAlpha(v, team, EXITS.N.center);
    alpha.exits.S = this.seenAlpha(v, team, EXITS.S.center);
    alpha.prison = this.seenAlpha(v, team, PRISON_CENTER);
    const blinkOn = Math.floor(v.nowMs / 500) % 2 === 0;
    const blink = this.badgeBlink;
    blink.A = isMonster && blinkOn && capturing(snap.world.points, 'A');
    blink.B = isMonster && blinkOn && capturing(snap.world.points, 'B');
    this.badges.draw(snap.world.points, snap.world.exits, alpha, blink);
    const all = this.info;
    all.length = 0;
    for (const item of this.badges.info()) all.push(item);
    for (const item of info) all.push(item);
    this.post.measure();
    gfxState.features.charGfxArcs = this.gfxCount.arcs;
    gfxState.features.charGfxFills = this.gfxCount.fills;
    this.lastDrawAt = v.nowMs;
    const fx = this.fx;
    fx.stunStars = this.stunAny;
    fx.dashGhosts = ghosts.length;
    fx.attackRange = attackRange;
    fx.attackFill = attackFill;
    fx.oppFx = oppFx;
    fx.cone = coneShown;
    fx.coneRed = this.coneRed;
    fx.particles = this.fxs.count;
    fx.dust = motes.length;
    fx.reveal = countKind(info, 'reveal');
  }

  /** 배지 자리 p가 지금 보이면 1, 아니면 ALPHA.badgeUnseen (괴물: 부채꼴 ∪ 근접 원, 생존자: 팀 시야 원) */
  private seenAlpha(v: FrameView, team: readonly TeamEye[], p: Vec2): number {
    if (!this.useFog) return 1;
    const balance = v.balance;
    if (v.role === 'monster')
      return v.me && monsterSees(balance, v.me, v.me.face, v.myBlend, p) ? 1 : ALPHA.badgeUnseen;
    for (const e of team) if (inCircleVision(e.pos, survivorVisionRadius(balance, e.role), p)) return 1;
    return ALPHA.badgeUnseen;
  }

  private setOutline(seg: [Vec2, Vec2][], cone: readonly Vec2[] | null, near: readonly Vec2[] | null): void {
    this.outline = seg;
    this.outlineOf = [cone, near];
  }

  /**
   * 생존자 시야 경계 림 (그 사람의 역할색, 원호 부분만 — 벽 그림자 선은 긋지 않는다).
   * WebGL은 이어진 변들을 한 줄(moveTo 한 번 + lineTo 여럿)로 긋는다 (렌더링 최적화 2): 선 두께 1.72px ≤ 2라 이음매 사각형을
   * 넣지 않아 변마다 같은 사각형 · 같은 순서다(같은 화소). 매 프레임 그리는 Graphics 명령 · 경로 객체가 변 수 × 2 → 변 수 + 줄 수로 준다.
   * Canvas는 이어 그으면 마이터 이음이 생겨 화소가 달라지므로 예전처럼 변마다 (vision.ts traceRim)
   */
  private drawRims(): void {
    // 눈들의 다각형 · 역할이 지난 주기와 같으면(다각형 캐시의 같은 참조) 이미 그린 선 그대로
    const sig = this.rimsOf;
    const eyes = this.eyes;
    let same = sig.length === eyes.length;
    for (let i = 0; same && i < eyes.length; i += 1)
      same = sig[i]?.poly === eyes[i]?.poly && sig[i]?.role === eyes[i]?.role;
    if (same) return;
    this.rimsOf = eyes.map((e) => ({ poly: e.poly, role: e.role }));
    const g = this.rims;
    g.clear();
    for (const e of eyes) {
      if (!e.role) continue;
      const color = ROLE[e.role];
      g.lineStyle(CONE_LOOK.rimWidth / MAP_SCALE, color, CONE_LOOK.rimAlpha);
      g.beginPath();
      traceRim(g, e.poly, e.center, e.r, this.webgl);
      g.strokePath();
    }
  }

  /**
   * 괴물 화면 자기 시야 테두리 (coneEdge). 테두리 선분이 지난 프레임과 같으면(안개 주기에 다시 만들지 않았으면) 명령을 다시 만들지
   * 않는다. 선 두께 2.15px > 2라 WebGL은 이어진 선에 이음매 사각형을 넣으므로 선분마다 따로 긋는 것은 그대로다
   */
  private drawOutline(): void {
    const d = this.edgeDrawn;
    if (d.key === this.outline) return;
    this.coneEdge.clear();
    if (this.outline.length > 0)
      strokeSegments(this.coneEdge, this.outline, CONE.idle, FOG.outlineAlpha, FOG.outlineWidth / MAP_SCALE);
    d.key = this.outline;
  }

  /** 생존자 화면에 괴물이 안 보이면 부채꼴을 지운다 (이미 비었으면 그대로) */
  private clearMonsterCone(): void {
    if (this.overDrawn.key !== null) {
      this.coneOver.clear();
      this.overDrawn.key = null;
    }
    if (this.edgeDrawn.key !== null) {
      this.coneEdge.clear();
      this.edgeDrawn.key = null;
    }
  }

  /**
   * 생존자 화면 괴물 부채꼴: 채움 + (빨강) 꼭짓점에서 퍼지는 사선 해치 · 펄스는 그림자 아래(coneOver),
   * 가장자리 선은 그림자 위(coneEdge)에 그려 팀원 몸 둘레에서도 끊기지 않는다.
   * 렌더링 최적화 2: 다각형은 시야 다각형 캐시(괴물이 그대로면 같은 참조), 채움은 WebGL에서 꼭짓점(다각형 첫 점)에서 퍼지는 삼각형
   * 부채(Earcut 없음, 같은 화소 — vision.ts fillFanPolygon). 다각형 · 색 · 채움이 지난 프레임과 같고 해치가 없으면 명령을 다시 만들지 않는다
   */
  private drawMonsterCone(balance: Balance, m: MonsterView, tS: number): void {
    const cone =
      this.polys.peek('monsterCone', m.x, m.y, m.aim, m.blend) ??
      this.polys.put('monsterCone', m.x, m.y, m.aim, m.blend, monsterConePolygon(balance, m, m.aim, m.blend));
    const color = mixColor(CONE.idle, CONE.seen, this.coneRed);
    const fill = CONE_LOOK.fillIdle + (CONE_LOOK.fillSeen - CONE_LOOK.fillIdle) * this.coneRed;
    const over = this.overDrawn;
    if (over.key !== cone || over.color !== color || over.fill !== fill) {
      this.coneOver.clear();
      if (this.webgl) fillFanPolygon(this.coneOver, cone, color, fill);
      else fillPolygon(this.coneOver, cone, color, fill);
      // 해치는 시계로 흐른다: 그었으면 다음 프레임에 다시 그린다
      const hatched = drawConeHatch(this.coneOver, cone, m, m.aim, this.coneRed, tS, color) > 0;
      over.key = hatched || this.coneRed > 0.01 ? DIRTY : cone;
      over.color = color;
      over.fill = fill;
    }
    const edge = this.edgeDrawn;
    if (edge.key !== cone || edge.color !== color) {
      this.coneEdge.clear();
      drawConeEdge(this.coneEdge, cone, color);
      edge.key = cone;
      edge.color = color;
    }
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
    const imgs = this.dustImgs;
    for (let i = 0; i < imgs.length; i += 1) {
      const img = imgs[i];
      if (!img) continue;
      const m = motes[i];
      if (!m) {
        img.setVisible(false);
        continue;
      }
      // 장식 입자 상한: 알파 0.2 · 반지름 2 논리 px
      const r = Math.min(FX_LIMITS.decorSizeMaxPx, m.size) / MAP_SCALE;
      const k = r / baked / tpw;
      img
        .setPosition(m.x * TILE_PX, m.y * TILE_PX)
        .setScale(k)
        .setAlpha(Math.min(FX_LIMITS.decorAlphaMax, m.alpha))
        .setVisible(true);
    }
  }

  /** 돌진 잔상 이미지 (망토 늘어난 프레임) */
  private drawGhosts(ghosts: readonly LiveGhost[], mR: number): void {
    void mR;
    while (this.ghostImgs.length < ghosts.length) {
      const img = this.scene.make.image({ key: this.atlasKey, frame: 'monster-dash' }, false);
      this.ghosts.add(img);
      this.ghostImgs.push(img);
    }
    const s = 1 / (this.atlas?.texPerWorld ?? 1);
    const imgs = this.ghostImgs;
    for (let i = 0; i < imgs.length; i += 1) {
      const img = imgs[i];
      if (!img) continue;
      const gh = ghosts[i];
      if (!gh) {
        img.setVisible(false);
        continue;
      }
      img
        .setPosition(gh.g.x * 32, gh.g.y * 32)
        .setRotation(gh.g.aim)
        .setScale(s * 1.12, s * 0.92)
        .setAlpha(0.42 * gh.alpha)
        .setVisible(true);
    }
  }

  /**
   * 상태 변화 (수감 · 탈출 · 사망)를 보고 효과를 만든다. 페이드 · 흩어짐은 상태가 바뀐 순간(flip: 보간 표본 경계 · 받은
   * 스냅샷, 렌더링 최적화)부터 잰다 — 바뀐 것을 처음 본 프레임 시각은 fps마다 다르다
   */
  /** 상태가 바뀐 순간: 내 상태는 받은 스냅샷, 다른 생존자는 보간 표본 경계 (바뀐 프레임에만 잰다) */
  private statusFlip(v: FrameView, id: string, self: boolean): number {
    return self ? this.snapEdge(v) : this.flipAt(v, 'survivor', id);
  }

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
    v: FrameView,
    self: boolean,
  ): void {
    const prev = this.lastStatus.get(id);
    if (prev && prev.status === 'free' && status === 'imprisoned') {
      const t0 = this.statusFlip(v, id, self);
      this.fxs.dissolve(prev.x, prev.y, sR, (clockMs - (realMs - t0)) / 1000, null, isMonster);
      this.fades.set(id, { kind: 'appear', t0, x, y, face });
    } else if (prev && prev.status === 'free' && status === 'escaped' && !isMonster) {
      this.fades.set(id, {
        kind: 'escape',
        t0: this.statusFlip(v, id, self),
        x: prev.x,
        y: prev.y,
        face: prev.face,
      });
    } else if (prev && prev.status !== 'dead' && status === 'dead' && !isMonster) {
      this.fades.set(id, {
        kind: 'death',
        t0: this.statusFlip(v, id, self),
        x: prev.x,
        y: prev.y,
        face: prev.face,
      });
    }
    // 지난 상태는 제자리에서 고친다 (프레임마다 새 객체를 만들지 않게. 자유가 아니면 마지막 자유 자리 · 방향을 둔다)
    if (!prev) this.lastStatus.set(id, { status, x, y, face });
    else {
      prev.status = status;
      if (status === 'free') {
        prev.x = x;
        prev.y = y;
        prev.face = face;
      }
    }
  }

  /** 걷기 위상 (품질 낮음은 4단계로 끊는다) */
  private phaseOf(g: Gait): number {
    return this.preset.halfFrameAnims ? quantizePhase(g.phase, 4) : g.phase;
  }

  /**
   * 기절 별 자리 (shapes.ts starSlot). 자기(self)를 뺀 몸 원은 others에 다시 쓴다 (프레임마다 걸러 새 배열을 만들지 않게)
   */
  private pickStarDir(cx: number, cy: number, mR: number, self: string): number {
    const others = this.others;
    others.length = 0;
    for (const d of this.disks) if (d.id !== self) others.push(d);
    const at = this.starAt;
    at.x = cx;
    at.y = cy;
    this.starDir = starSlot(at, mR, TILE_PX, others, this.starDir);
    return this.starDir;
  }

  /** 몸 원 하나를 disks에 넣는다 (diskPool에서 다시 쓴다) */
  private pushDisk(id: string, x: number, y: number, r: number): void {
    let d = this.diskPool[this.disks.length];
    if (!d) {
      d = { id, x, y, r };
      this.diskPool.push(d);
    }
    d.id = id;
    d.x = x;
    d.y = y;
    d.r = r;
    this.disks.push(d);
  }

  /** 생존자 화면 팀원 · 나의 그리기 값 (teamPose에 써서 돌려준다) */
  private teamPoseOf(
    role: RoleId,
    x: number,
    y: number,
    face: number,
    walkPhase: number,
    stepping: number,
    protectedFlag: boolean,
    self: boolean,
    hitMs: number | null,
    seed: number,
    clockMs: number,
    fade: number,
    gray: boolean,
  ): TeamSurvivorPose {
    const p = this.teamPose;
    p.role = role;
    p.x = x;
    p.y = y;
    p.face = face;
    p.walkPhase = walkPhase;
    p.stepping = stepping;
    p.protectedFlag = protectedFlag;
    p.self = self;
    p.hitMs = hitMs;
    p.seed = seed;
    p.clockMs = clockMs;
    p.fade = fade;
    p.gray = gray;
    // 새 스타일 자세 입력은 부르는 쪽이 이어서 쓴다 (기본: 능력 · 수감 · 구조 없음)
    p.action = 0;
    p.captive = false;
    p.reach = false;
    return p;
  }

  /** 새 스타일 팀원 능력 동작 0~1 (러너 질주 중 · 가드 밀치기 · 스카우트 탐지 직후). 생존자 화면에서만 부른다 */
  private teamAction(role: RoleId, self: boolean, abilityActive: number, nowMs: number): number {
    if (role === 'runner') return (self ? abilityActive > 0 : nowMs < this.sprintUntil) ? 1 : 0;
    const at = role === 'guard' ? this.shoveAt : this.scanAt;
    const t = nowMs - at;
    const dur = role === 'guard' ? NEW_POSE_MS.shove : NEW_POSE_MS.scan;
    if (t < 0 || t >= dur) return 0;
    // 가드: 앞 30%는 밀기 시작(0.5), 그 뒤는 끝까지 민 자세(1)
    return role === 'guard' && t < dur * 0.3 ? 0.5 : 1;
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
  ): void {
    const { snap, balance } = v;
    const isMonster = v.role === 'monster';
    const half = this.preset.halfFrameAnims;
    let stunAny = false;
    let stunOpp = false;
    const realMs = v.nowMs;
    this.poseNowMs = realMs;
    // 입자의 태어난 시각 = 바뀐 순간: 이 기기 시각 t(ms) → 장식 시계(초) (clockMs − (realMs − t)) / 1000
    // 지난 피격 정리 (제자리에서, 같은 순서)
    const hits = this.hits;
    let kept = 0;
    for (const h of hits) if (realMs - h.t0 < 400) hits[kept++] = h;
    hits.length = kept;

    if (isMonster) {
      // 괴물 화면: 잡힘 알림 직후 사라진(또는 수감된) 생존자는 보이던 자리에서 흩어진다. 후보는 같은 순간 타격 부채꼴 안에
      // 있던 생존자뿐이다(같은 순간 시야를 벗어난 다른 생존자 자리에서 흩어지지 않게). 맞는 후보가 없으면 연출을 생략한다
      if (realMs - this.captureAt < 400 && v.me) {
        const cands = this.dissolveCands;
        cands.length = 0;
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
          // 보이던 생존자가 사라진(수감된) 순간부터
          const t = this.flipAt(v, 'survivor', best.id);
          this.fxs.dissolve(best.x, best.y, sR, (clockMs - (realMs - t)) / 1000, null, true);
          this.lastStatus.delete(best.id);
          this.captureAt = -1e9;
        }
      }
      // 시야에서 사라진 별칭 정리 (Map을 돌며 지워도 된다: 아직 안 본 항목만 남는다)
      for (const id of this.lastStatus.keys()) if (!v.survivors.has(id)) this.lastStatus.delete(id);
    }

    // 노출 문양 · 기절 별 자리를 고를 몸 원 (이 화면에 그리는 생존자 · 괴물 화면은 괴물 자신, 생존자 화면은 나)
    const disks = this.disks;
    disks.length = 0;
    for (const [id, s] of v.survivors)
      if (s.status !== 'dead' && s.status !== 'escaped') this.pushDisk(id, s.x, s.y, sR);
    const myStatus = snap.you.surv?.status;
    if (v.me && myStatus !== 'dead' && myStatus !== 'escaped')
      this.pushDisk(v.selfId, v.me.x, v.me.y, isMonster ? mR : sR);
    let starsDrawn = false;

    // 피격은 이벤트 자리(0.8타일 이내)에서 가장 가까운 팀원 한 명에게만 붙인다 (붙어 선 다른 팀원은 젖히지 않는다)
    if (!isMonster)
      for (const h of this.hits) if (!h.you && h.id === undefined) h.id = this.nearestTeammate(v, h.x, h.y);

    // 다른 생존자
    for (const [id, s] of v.survivors) {
      this.transition(id, s.status, s.x, s.y, s.face, clockMs, realMs, isMonster, sR, v, false);
      const fade = this.fades.get(id);
      if (s.status === 'dead' || s.status === 'escaped') {
        if (!isMonster && s.role && fade) this.drawFade(id, s.role, fade, realMs, sR);
        continue;
      }
      const g = this.gait(v, id, s.x, s.y, frameMs, 'survivor');
      const rig = this.survivorRig(id);
      if (isMonster) {
        // 흰색 위장: 역할 · 체력 · 능력 인자 없이 (reveal은 서버가 노출 창에 보낸 역할뿐)
        const others = this.others;
        others.length = 0;
        if (s.role) for (const d of disks) if (d.id !== id) others.push(d);
        drawHiddenSurvivor(
          rig,
          s.x,
          s.y,
          s.face,
          this.phaseOf(g),
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
        if (footDust && g.footfall)
          this.fxs.footDust(s.x, s.y, (clockMs - (realMs - g.footAt)) / 1000, id, true);
      } else {
        const role = s.role ?? 'runner';
        const appear = fade?.kind === 'appear' ? 1 - fadeOut(realMs - fade.t0, ANIM.imprisonAppearMs) : 1;
        const tp = this.teamPoseOf(
          role,
          s.x,
          s.y,
          s.face,
          this.phaseOf(g),
          g.stepping,
          s.protected,
          false,
          this.hitFor(id, false, realMs),
          seedOf(id),
          animMs,
          appear,
          false,
        );
        tp.action = this.teamAction(role, false, 0, v.nowMs);
        tp.captive = s.status === 'imprisoned';
        tp.reach = s.rescue !== null && s.rescue > 0;
        drawTeamSurvivor(rig, tp, sR);
        if (s.hp !== null && s.hp < balance.survivor.maxHp && s.status === 'free')
          drawInjury(this.attachG, s.x, s.y, s.face, sR);
        if (role === 'runner' && v.nowMs < this.sprintUntil && g.stepping > 0.3)
          drawSpeedLines(this.fxUnder, s.x, s.y, s.face, sR, tS);
        if (footDust && g.footfall)
          this.fxs.footDust(s.x, s.y, (clockMs - (realMs - g.footAt)) / 1000, null, false);
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
      const g = this.gait(v, 'monster', m.x, m.y, frameMs, 'monster');
      const pose = this.monsterPose(m.x, m.y, m.aim, m.stunned, m.dashing, m.windup > 0 ? 1 : 0, g, tS, half);
      drawMonsterRig(rig, pose, mR);
      if (m.stunned && oppVisible) {
        drawStunStars(this.starsG, m.x, m.y, tS, mR, this.pickStarDir(m.x, m.y, mR, 'monster'));
        starsDrawn = true;
        stunAny = true;
        stunOpp = true;
      }
      if (this.stunnedPending && oppVisible)
        this.fxs.ring(
          'impact',
          m.x,
          m.y,
          mR * 2.4,
          (clockMs - (realMs - this.stunnedAt)) / 1000,
          'monster',
          true,
        );
      if (footDust && g.footfall && oppVisible)
        this.fxs.footDust(m.x, m.y, (clockMs - (realMs - g.footAt)) / 1000, 'monster', true);
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
        const g = this.gait(v, v.selfId, v.me.x, v.me.y, frameMs, null);
        // 새 스타일: 예측한 준비 표시가 다 찬 뒤에도 서버가 아직 준비 중(왕복 지연만큼 늦게 끝남)이면 준비 자세를 잇는다.
        // 서버 준비가 0이 되는 스냅샷이 타격(attackHit)을 싣고 와서 타격 자세로 빈틈 없이 넘어간다 (기존 스타일 · 범위 표시는 그대로)
        const hold = this.atlas?.params.style === 'new' && (snap.you.mon?.windup ?? 0) > 0;
        const raise = this.windupStart !== null || hold ? 1 : 0;
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
          drawStunStars(this.starsG, v.me.x, v.me.y, tS, mR, this.pickStarDir(v.me.x, v.me.y, mR, v.selfId));
          starsDrawn = true;
          stunAny = true;
        }
        if (this.stunnedPending) {
          // 가드가 보였으면 그 자리에서 충격파가 이미 났다. 안 보였으면 몸 중심에서 방향 없이
          if (!this.shoveSeen)
            this.fxs.ring(
              'impact',
              v.me.x,
              v.me.y,
              mR * 2.4,
              (clockMs - (realMs - this.stunnedAt)) / 1000,
              null,
              false,
            );
          this.stunnedPending = false;
          this.shoveSeen = false;
        }
        if (footDust && g.footfall)
          this.fxs.footDust(v.me.x, v.me.y, (clockMs - (realMs - g.footAt)) / 1000, null, false);
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
        // 내 상태는 스냅샷으로 바뀐다: 그 스냅샷을 받은 순간부터
        this.transition(
          v.selfId,
          st ?? 'free',
          v.me.x,
          v.me.y,
          v.me.face,
          clockMs,
          realMs,
          false,
          sR,
          v,
          true,
        );
        const fade = this.fades.get(v.selfId);
        if (st !== 'dead' && st !== 'escaped') {
          const g = this.gait(v, v.selfId, v.me.x, v.me.y, frameMs, null);
          const rig = this.survivorRig(v.selfId);
          const prot = (snap.you.surv?.protectLeft ?? 0) > 0;
          const appear = fade?.kind === 'appear' ? 1 - fadeOut(realMs - fade.t0, ANIM.imprisonAppearMs) : 1;
          const tp = this.teamPoseOf(
            role,
            v.me.x,
            v.me.y,
            v.me.face,
            this.phaseOf(g),
            g.stepping,
            prot,
            true,
            this.hitFor(v.selfId, true, realMs),
            seedOf(v.selfId),
            animMs,
            appear,
            false,
          );
          const mine = snap.you.surv;
          tp.action = this.teamAction(role, true, mine?.abilityActive ?? 0, v.nowMs);
          tp.captive = st === 'imprisoned';
          tp.reach = (mine?.rescue ?? 0) > 0;
          drawTeamSurvivor(rig, tp, sR);
          const s = snap.you.surv;
          if (s && s.hp < balance.survivor.maxHp && s.status === 'free')
            drawInjury(this.attachG, v.me.x, v.me.y, v.me.face, sR);
          if (role === 'runner' && s && s.abilityActive > 0 && g.stepping > 0.3)
            drawSpeedLines(this.fxUnder, v.me.x, v.me.y, v.me.face, sR, tS);
          if (footDust && g.footfall)
            this.fxs.footDust(v.me.x, v.me.y, (clockMs - (realMs - g.footAt)) / 1000, null, false);
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
    this.stunAny = stunAny;
    this.stunOpp = stunOpp;
  }

  /** 이 생존자가 최근에 맞았으면 지난 시간 (ms). 나는 you 피격, 팀원은 그 피격에 정한 한 명(nearestTeammate) */
  private hitFor(id: string, self: boolean, realMs: number): number | null {
    for (let i = this.hits.length - 1; i >= 0; i -= 1) {
      const h = this.hits[i];
      if (!h) continue;
      if (self ? h.you : !h.you && h.id === id) return realMs - h.t0;
    }
    return null;
  }

  /** 피격 자리에서 0.8타일 이내의 가장 가까운 팀원 (없으면 null) */
  private nearestTeammate(v: FrameView, x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = 0.8;
    for (const [id, s] of v.survivors) {
      if (s.status === 'dead' || s.status === 'escaped') continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
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
      this.teamPoseOf(role, f.x, f.y, f.face, 0, 0, false, false, null, 0, 0, alpha, gray),
      sR,
    );
    if (!gray)
      rig.body.setScale(
        rig.body.scaleX * (1 + 0.25 * (1 - alpha)),
        rig.body.scaleY * (1 + 0.25 * (1 - alpha)),
      );
  }

  /** 새 스타일 괴물 프레임 입력 (그릇에 값만 쓴다) */
  private monsterFrameInput(
    stunned: boolean,
    dashing: boolean,
    windup: boolean,
    moving: boolean,
    cloak: number,
    now: number,
  ): MonsterFrameInput {
    const f = this.monFrameIn;
    f.stunned = stunned;
    f.dashing = dashing;
    f.windup = windup;
    f.strike = now - this.strikeAt >= 0 && now - this.strikeAt < NEW_POSE_MS.strike;
    f.roar = now - this.roarAt >= 0 && now - this.roarAt < NEW_POSE_MS.roar;
    f.moving = moving;
    f.cloak = cloak;
    return f;
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
  ): MonsterPose {
    const frames = frameCount(ANIM.cloakFrames, half);
    const moving = g.stepping > 0.3;
    const i = cloakFrame(tS, moving, frames) * (ANIM.cloakFrames / frames);
    const isNew = this.atlas?.params.style === 'new';
    const now = this.poseNowMs;
    const frame = isNew
      ? monsterFrameNew(this.monsterFrameInput(stunned, dashing, raise > 0, moving, i, now))
      : stunned
        ? 'monster-stun'
        : dashing
          ? 'monster-dash'
          : cloakName(moving ? 'move' : 'idle', i);
    const blink = eyeBlink(tS, 0.7);
    // 그릇 하나를 다시 쓴다 (drawMonsterRig가 바로 읽는다)
    const p = this.monPose;
    p.x = x;
    p.y = y;
    p.aim = aim;
    p.frame = frame;
    p.raise = stunned ? 0 : raise;
    // 새 스타일 돌진 그림은 이미 늘어난 자세라 더 늘이지 않는다 (크기 기준 1.35r, art/chars/measure.ts)
    p.stretch = dashing && !isNew ? dashStretch(0, 1) * 0.6 : 0;
    p.eyes = stunned ? 'stun' : blink ? 'blink' : 'open';
    p.glow = this.preset.tier !== 'low';
    p.scale = 1 + 0.012 * Math.sin(tS * 2.4);
    p.alpha = 1;
    return p;
  }
}
