// GPU 안개 합성 (품질 높음 · 중간, WebGL에서만).
//
// Canvas 합성은 바닥 전체(배율 2에서 2856×1904)를 안개 주기(20~30Hz)마다 CPU로 다시 그리고 GPU에 통째로 올린다.
// 여기서는 정적 맵을 합성 배율로 한 번만 텍스처로 올리고, 매 안개 주기에는
//   1) 공개 동적 레이어: 거점 · 탈출구마다 작은 조각 캔버스(합성 배율)에 그린 명령을 기록해 지난번과 다를 때만 다시 그려 올리고,
//      시야 원 채움(시야 틴트 · 괴물 부채꼴 채움)은 다각형마다 빛 지도 격자의 외접 사각형 캔버스에 같은 방식으로 그려 올린다
//   2) 작은 빛 지도(타일당 12~16px)만 올려 MULTIPLY로 곱한다.
// WebGL MULTIPLY = [DST_COLOR, ONE_MINUS_SRC_ALPHA]라 불투명한 빛 지도에서는 Canvas 'multiply'와 같은 값이다.
// 프레임마다 다시 테셀레이션하는 Phaser Graphics는 하나도 없다 (매 프레임에는 이미지 · 블리터만 그린다, gfx.features.mapGfxCmds = 0).
//
// 품질 높음은 빛 지도 이미지에 경계 셰이더(FogEdgePipeline)를 건다. 경계 안쪽 띠만 노이즈로 '어둡게만' 하고
// 시야 밖(하한)과 완전히 밝은 곳은 바꾸지 않는다(fogMath.edgeDarken과 같은 식, GLSL은 fogMath.FOG_EDGE_FRAG).
// 빛 지도 이미지 하나에만 걸리므로 캐릭터 · 범위 · 마커 · HUD에는 닿지 않는다.
// 같은 셰이더가 안개 주기 사이 내 빛을 지금 자리까지 옮긴다(내 빛 따라가기, fogMath followTexel): 높음 · 중간 모두(중간은 세기 0인
// 두 번째 파이프라인 — 경계 노이즈 없음). 내 시야 틴트 조각도 같은 Δ만큼 옮긴다(follow).
//
// 텍스처는 getImageData 사본을 만드는 addCanvas(CanvasTexture) 대신 fogPaint.createCanvasTexture로 올린다.
//
// 레이어 순서 (fogRoot 안): 정적 맵 조각(발광 번짐을 구워 넣음) → 공개 동적 레이어(조각 → 시야 채움)
// → 빛 지도(MULTIPLY) → 테두리 리프트(ADD, 정적 아틀라스 + 블리터). 발광은 곱하기 앞이라 어둠 속 약 30%,
// 테두리 리프트는 곱하기 뒤라 시야 밖에서도 구조가 보인다.
import Phaser from 'phaser';
import {
  MAP_H,
  MAP_W,
  TILE_PX,
  type Balance,
  type ExitId,
  type ExitView,
  type PointId,
  type PointView,
  type Vec2,
} from '@decoy/shared';
import { getStaticMap, keepStaticMaps } from '../art/mapArt';
import { ChunkAtlas, chunkBox, chunkRange } from '../art/mapChunks';
import type { ViewRect } from './camera';
import { MiniComposite } from './fogMini';
import type { TileRect } from '../art/mapArtGeom';
import { gfxNow, gfxState } from '../gfx/state';
import { MAP_X, MAP_Y, VIEW_TILES_H, VIEW_TILES_W, WORLD_LINE, WORLD_SCALE } from '../ui/layout';
import { FOG } from './colors';
import type { FogLayer, FogLayerOptions } from './baseLayer';
import { FOG_EDGE_FRAG, SELF_MARK, ambientRgb, snapToDevice } from './fogMath';
import {
  CanvasPen,
  LightMap,
  LightRecord,
  PenRecord,
  countGraphicsCmds,
  createCanvasTexture,
  domLightSurface,
  exitPaintBounds,
  layoutRimLift,
  makeCanvas,
  nextFogKey,
  paintExits,
  paintPoints,
  paintRimLiftAtlas,
  pointPaintBounds,
  recordFogCommit,
  removeCanvasTexture,
  resetExitTracking,
  resizeCanvasTexture,
  uploadCanvasSubTexture,
  uploadCanvasTexture,
  type SoftLight,
} from './fogPaint';

export const FOG_EDGE_PIPELINE = 'DecoyFogEdge';
/** 품질 중간: 같은 셰이더 · 세기 0 (경계 노이즈 없이 내 빛 따라가기만) */
export const FOG_FOLLOW_PIPELINE = 'DecoyFogFollow';

/**
 * 셰이더 내 빛 따라가기 값 (fogMath FollowUniforms와 같은 뜻, 타일). GpuFog가 프레임마다 쓰고 빛 지도 이미지를 그릴 때(onBind —
 * 프로그램이 이미 묶인 뒤라 프로그램 바꾸기가 늘지 않는다) 올린다
 */
export interface FogFollowState {
  selfOn: boolean;
  eyeFogX: number;
  eyeFogY: number;
  eyeNowX: number;
  eyeNowY: number;
  r: number;
  soft: number;
  shiftOn: boolean;
  shiftX: number;
  shiftY: number;
}

export function resetFollowState(f: FogFollowState): void {
  f.selfOn = false;
  f.shiftOn = false;
  f.eyeFogX = 0;
  f.eyeFogY = 0;
  f.eyeNowX = 0;
  f.eyeNowY = 0;
  f.r = 1;
  f.soft = 1;
  f.shiftX = 0;
  f.shiftY = 0;
}

/** 경계 셰이더 파이프라인 (빛 지도 이미지 전용). 사전 파이프라인이라 그리는 횟수가 늘지 않는다 */
export class FogEdgePipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  readonly follow: FogFollowState = {
    selfOn: false,
    eyeFogX: 0,
    eyeFogY: 0,
    eyeNowX: 0,
    eyeNowY: 0,
    r: 1,
    soft: 1,
    shiftOn: false,
    shiftX: 0,
    shiftY: 0,
  };

  constructor(
    game: Phaser.Game,
    /** 경계 어둡게 세기 (높음 FOG.edgeDarken, 중간 0) */
    private readonly strength: number = FOG.edgeDarken,
  ) {
    super({ game, fragShader: FOG_EDGE_FRAG });
  }

  override onBoot(): void {
    const amb = FOG.ambient;
    const t = FOG.tint;
    this.set3f(
      'uAmbient',
      (((t >> 16) & 255) / 255) * amb,
      (((t >> 8) & 255) / 255) * amb,
      ((t & 255) / 255) * amb,
    );
    this.set2f('uMapSize', MAP_W, MAP_H);
    this.set1f('uStrength', this.strength);
    this.set1f('uNoiseScale', FOG.edgeNoiseScale);
    this.set1f('uNoiseSpeed', FOG.edgeNoiseSpeed);
    this.set1f('uTime', 0);
    // 빛 지도 바탕 (캔버스에 칠한 반올림 값 그대로: 내 덮임 표시를 읽는 기준)
    const lit = ambientRgb(FOG.ambient, FOG.tint);
    this.set3f('uLightAmb', lit[0] / 255, lit[1] / 255, lit[2] / 255);
    this.set1f('uMark', SELF_MARK / 255);
    this.applyFollow();
  }

  /**
   * 빛 지도 이미지를 그리려고 이 파이프라인을 묶은 뒤 (프로그램이 이미 쓰이는 중): 장식 시계 · 따라가기 값을 올린다.
   * 예전에는 시계를 onPreRender(프레임 시작)에서 올렸다 — 바뀐 uniform을 올리면 그 프로그램으로 바꾸므로(useProgram) 프레임마다
   * 프로그램 바꾸기가 둘(이 파이프라인 → 기본) 늘었고, 등록만 되고 쓰이지 않는 파이프라인(품질을 바꾼 뒤)도 그랬다
   */
  override onBind(): void {
    // 장식 시계 (테스트에서 멈출 수 있다). 큰 값에서 float 정밀도가 떨어지지 않게 한 시간 주기로 접는다
    this.set1f('uTime', (gfxNow() / 1000) % 3600);
    this.applyFollow();
  }

  /** 따라가기 값을 셰이더에 올린다 (바뀐 값만 GL 호출 — WebGLShader가 지난 값과 견준다) */
  private applyFollow(): void {
    const f = this.follow;
    this.set1f('uSelfOn', f.selfOn ? 1 : 0);
    this.set1f('uShiftOn', f.shiftOn ? 1 : 0);
    this.set2f('uEyeFog', f.eyeFogX, f.eyeFogY);
    this.set2f('uEyeNow', f.eyeNowX, f.eyeNowY);
    this.set1f('uR', f.r);
    this.set1f('uSoft', f.soft);
    this.set2f('uShift', f.shiftX, f.shiftY);
  }
}

/** WebGL 렌더러에 안개 셰이더 둘(높음 경계 · 중간 따라가기)을 한 번만 등록한다. Canvas 렌더러면 아무것도 만들지 않고 false */
export function ensureFogEdgePipeline(game: Phaser.Game): boolean {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!r.pipelines.has(FOG_EDGE_PIPELINE)) r.pipelines.add(FOG_EDGE_PIPELINE, new FogEdgePipeline(game));
  if (!r.pipelines.has(FOG_FOLLOW_PIPELINE))
    r.pipelines.add(FOG_FOLLOW_PIPELINE, new FogEdgePipeline(game, 0));
  return true;
}

/** 등록한 안개 셰이더 (없으면 null) */
function fogPipeline(game: Phaser.Game, name: string): FogEdgePipeline | null {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return null;
  const p = r.pipelines.get(name);
  return p instanceof FogEdgePipeline ? p : null;
}

/** 텍스처로 올린 캔버스 한 장과 그 이미지 */
class CanvasLayer {
  readonly key: string;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: Phaser.Textures.Texture;
  readonly image: Phaser.GameObjects.Image;

  constructor(
    private readonly scene: Phaser.Scene,
    prefix: string,
    w: number,
    h: number,
    x: number,
    y: number,
  ) {
    const { canvas, ctx } = makeCanvas(w, h);
    this.canvas = canvas;
    this.ctx = ctx;
    this.key = nextFogKey(prefix);
    this.texture = createCanvasTexture(scene.textures, this.key, canvas);
    this.image = scene.make.image({ x, y, key: this.key }, false).setOrigin(0, 0);
  }

  /** 캔버스를 비운다 (변환은 기본값으로 되돌린다) */
  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  upload(): void {
    uploadCanvasTexture(this.texture);
    gfxState.features.fogDynUploads = Number(gfxState.features.fogDynUploads ?? 0) + 1;
  }

  destroy(): void {
    this.image.destroy();
    removeCanvasTexture(this.scene.textures, this.key);
  }
}

/**
 * 공개 동적 레이어 한 조각 (거점 · 탈출구 하나, 합성 배율 · 정적 맵 텍셀 경계). 그린 명령이 바뀔 때만 다시 그려 올린다.
 * 기록은 두 장을 맞바꿔 쓴다(이번 주기 rec · 마지막으로 그린 last): 주기마다 기록을 복사하지 않는다 (렌더링 최적화 2)
 */
class DynPatch {
  private readonly layer: CanvasLayer;
  private readonly pen: CanvasPen;
  private readonly x0: number;
  private readonly y0: number;
  /** 이번 주기에 기록할 곳 */
  rec = new PenRecord();
  /** 마지막으로 그린 기록 (null = 아직 그리지 않음) */
  private last: PenRecord | null = null;

  constructor(
    scene: Phaser.Scene,
    box: Phaser.GameObjects.Container,
    readonly bounds: TileRect,
    s: number,
    ox: number,
    oy: number,
  ) {
    const k = TILE_PX * WORLD_SCALE * s;
    this.x0 = Math.floor(bounds.x0 * k);
    this.y0 = Math.floor(bounds.y0 * k);
    const w = Math.ceil(bounds.x1 * k) - this.x0;
    const h = Math.ceil(bounds.y1 * k) - this.y0;
    this.layer = new CanvasLayer(scene, 'fog-dyn', w, h, ox + this.x0 / s, oy + this.y0 / s);
    this.layer.image.setScale(1 / s);
    box.add(this.layer.image);
    this.pen = new CanvasPen(this.layer.ctx, k, s * WORLD_LINE);
  }

  /** 이번 기록이 마지막으로 그린 것과 다르면 다시 그려 올린다 (기록은 맞바꾼다: 다음 주기에 rec을 다시 비워 쓴다) */
  update(): void {
    const rec = this.rec;
    const last = this.last;
    if (last && rec.same(last)) return;
    this.layer.clear();
    this.layer.ctx.setTransform(1, 0, 0, 1, -this.x0, -this.y0);
    rec.replay(this.pen);
    this.layer.upload();
    this.last = rec;
    this.rec = last ?? new PenRecord();
  }

  destroy(): void {
    this.layer.destroy();
  }
}

/** 시야 채움 다각형이 없을 때 */
const NO_POLY: readonly Vec2[] = [];

/**
 * 시야 채움 한 장 (fillPoly 하나: 생존자 시야 원 · 괴물 부채꼴 · 근접 원). 빛 지도와 같은 격자(타일당 lpt px)에 그 다각형의
 * 외접 사각형만큼만 그린다: 맵 전체 크기 투명 사각형을 매 프레임 섞으면 채우기 비용(소프트웨어 래스터 · 모바일 GPU)이 크다.
 * 캔버스는 커지기만 하고(다시 만들지 않게), 그릴 것이 지난번과 다를 때만 다시 그려 올린다.
 * 다각형은 받은 것을 그대로 그린다(기록을 꼭짓점 객체로 되살리지 않는다). 지난번과 견주는 수(색 · 알파 · 꼭짓점)는
 * 한 배열에 고쳐 써 둔다 — 다각형 참조를 붙잡지 않으므로 그 뒤에 다각형이 바뀌어도 비교가 틀리지 않는다 (렌더링 최적화 2)
 */
class TintPatch {
  private readonly layer: CanvasLayer;
  private readonly pen: CanvasPen;
  /** 이번 주기에 그릴 것 */
  private poly: readonly Vec2[] = NO_POLY;
  private color = 0;
  private alpha = 0;
  /** 이번 주기 다각형의 외접 사각형 (타일) */
  private bx0 = 0;
  private by0 = 0;
  private bx1 = 0;
  private by1 = 0;
  /**
   * 마지막으로 그린 것: 앞의 lastN개 = [색, 알파, 꼭짓점 수, x0, y0, x1, y1, …] (0이면 아직 없음). 배열 길이는 줄이지 않는다
   * (길이를 줄이면 V8이 버퍼를 놓아 다음에 다시 할당한다)
   */
  private readonly last: number[] = [];
  private lastN = 0;
  /** 내 시야 조각인가 (이번 주기, 내 빛 따라가기: 프레임마다 Δ만큼 옮긴다) */
  self = false;
  /** 마지막으로 그린 자리 (논리 px, Δ = 0일 때) */
  private baseX = MAP_X;
  private baseY = MAP_Y;

  constructor(
    scene: Phaser.Scene,
    box: Phaser.GameObjects.Container,
    private readonly lpt: number,
  ) {
    this.layer = new CanvasLayer(scene, 'fog-tint', 64, 64, MAP_X, MAP_Y);
    this.layer.image.setScale((TILE_PX * WORLD_SCALE) / lpt);
    box.add(this.layer.image);
    this.pen = new CanvasPen(this.layer.ctx, lpt, (lpt / (TILE_PX * WORLD_SCALE)) * WORLD_LINE);
  }

  /** 이번 주기에 그릴 다각형 (꼭짓점 3개 이상) */
  set(poly: readonly Vec2[], color: number, alpha: number): void {
    this.poly = poly;
    this.color = color;
    this.alpha = alpha;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    this.bx0 = x0;
    this.by0 = y0;
    this.bx1 = x1;
    this.by1 = y1;
  }

  /** 마지막으로 그린 것과 같은 그림인가 */
  private same(): boolean {
    const l = this.last;
    const poly = this.poly;
    if (this.lastN !== 3 + poly.length * 2 || l[0] !== this.color || l[1] !== this.alpha) return false;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      if (!p || l[3 + i * 2] !== p.x || l[4 + i * 2] !== p.y) return false;
    }
    return true;
  }

  /** 다각형을 그 외접 사각형(빛 지도 격자, 테 1px)에 그린다 */
  update(): void {
    const img = this.layer.image;
    img.setVisible(true);
    if (this.same()) return;
    const k = this.lpt;
    const x0 = Math.floor(this.bx0 * k) - 1;
    const y0 = Math.floor(this.by0 * k) - 1;
    const w = Math.ceil(this.bx1 * k) + 1 - x0;
    const h = Math.ceil(this.by1 * k) + 1 - y0;
    const c = this.layer.canvas;
    if (w > c.width || h > c.height) {
      resizeCanvasTexture(
        this.layer.key,
        this.layer.texture,
        c,
        Math.ceil(Math.max(w, c.width) / 64) * 64,
        Math.ceil(Math.max(h, c.height) / 64) * 64,
      );
      img.setSizeToFrame();
    }
    this.layer.clear();
    this.layer.ctx.setTransform(1, 0, 0, 1, -x0, -y0);
    this.pen.fillPoly(this.poly, this.color, this.alpha);
    this.layer.upload();
    const s = (TILE_PX * WORLD_SCALE) / k;
    this.baseX = MAP_X + x0 * s;
    this.baseY = MAP_Y + y0 * s;
    img.setPosition(this.baseX, this.baseY);
    const l = this.last;
    const poly = this.poly;
    this.lastN = 3 + poly.length * 2;
    l[0] = this.color;
    l[1] = this.alpha;
    l[2] = poly.length;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      l[3 + i * 2] = p ? p.x : NaN;
      l[4 + i * 2] = p ? p.y : NaN;
    }
  }

  /** 그린 자리에서 (dx, dy) 타일만큼 옮겨 놓는다 (내 시야 조각이 아니면 0) */
  shift(dx: number, dy: number): void {
    const k = TILE_PX * WORLD_SCALE;
    const x = this.baseX + dx * k;
    const y = this.baseY + dy * k;
    const img = this.layer.image;
    if (img.x !== x || img.y !== y) img.setPosition(x, y);
  }

  hide(): void {
    this.layer.image.setVisible(false);
    this.lastN = 0;
    this.poly = NO_POLY;
    this.self = false;
  }

  destroy(): void {
    this.layer.destroy();
  }
}

function sameRect(a: TileRect, b: TileRect): boolean {
  return a === b || (a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
}

/** 조각 열쇠 (안개 주기마다 문자열을 만들지 않게 미리) */
const POINT_KEY: Readonly<Record<PointId, string>> = { A: 'point-A', B: 'point-B' };
const EXIT_KEY: Readonly<Record<ExitId, string>> = { N: 'exit-N', S: 'exit-S' };

/** 조각 그리기에 넘기는 한 개짜리 목록 (paintPoints · paintExits는 목록을 받는다. 붙잡지 않으므로 고쳐 쓴다) */
const ONE_POINT: PointView[] = [];
const ONE_EXIT: ExitView[] = [];

/** 조각을 미리 옮겨 두는 여유 (타일): 창 둘레 이만큼 안의 조각은 프레임마다 PREFETCH_BUDGET_MS 안에서 미리 옮긴다 */
export const PREFETCH_MARGIN = 2;
/** 프레임마다 둘레 조각을 미리 옮기는 시간 (ms). 조각 하나 = 맵 전체 그림에서 복사 + 일부 업로드 (약 0.1~0.3ms) */
const PREFETCH_BUDGET_MS = 1.5;

export class GpuFog implements FogLayer {
  readonly mode = 'gpu' as const;
  readonly shader: boolean;
  /** 내 빛 따라가기를 셰이더로 한다 (빛 지도가 있고 WebGL: 높음 · 중간) */
  readonly selfFollow: boolean;
  /** 빛 지도 셰이더 (높음 경계 · 중간 따라가기, Canvas · 안개 끔이면 null) */
  private readonly pipe: FogEdgePipeline | null = null;
  /**
   * 이번 주기 빛: 내 덮임 표시가 있는 내 시야(중심 · 판정 반경 · 흐림 띠, 없으면 selfR = 0)와 '모든 빛이 내 딱 잘린 시야'(괴물)인가.
   * 빛 지도에 칠린 그림과 같은 주기의 값이다 (기록이 지난번과 같아 다시 칠하지 않았어도 그림은 이 기록 그대로)
   */
  private selfX = 0;
  private selfY = 0;
  private selfR = 0;
  private selfSoft = 0;
  private hardSelf = 0;
  private hardOther = 0;
  private softOther = 0;
  /** 정적 맵 조각 (보이는 창 근처만, 원환 칸 아틀라스 텍스처 한 장 — 그리기 한 번에 묶인다) */
  private readonly chunks: ChunkAtlas;
  private readonly chunkKey: string;
  private readonly chunkTex: Phaser.Textures.Texture;
  private readonly chunkBox: Phaser.GameObjects.Container;
  private readonly chunkImgs: Phaser.GameObjects.Image[] = [];
  /** 칸 일부 올리기를 못 해(컨텍스트 · Canvas) 다음 setView에서 통째로 올린다 */
  private chunkFull = false;
  /** 공개 동적 레이어: 거점 · 탈출구 조각 (빛 지도 · 시야 채움보다 아래) */
  private readonly dynBox: Phaser.GameObjects.Container;
  private readonly patches = new Map<string, DynPatch>();
  /** 시야 채움 (빛 지도 격자, 다각형마다 한 장): 안개 주기마다 견줘 바뀐 장만 다시 그려 올린다 */
  private readonly tintBox: Phaser.GameObjects.Container;
  private readonly tints: TintPatch[] = [];
  private tintN = 0;
  private readonly lpt: number;
  private readonly light: LightMap | null;
  /** 이번 주기의 빛 명령 (지난번과 같으면 빛 지도를 다시 칠하지도 올리지도 않는다) */
  private readonly lightRec = new LightRecord();
  /** 이번 주기의 미니맵 합성 명령 (시야 채움 · 조각, 그린 순서대로) */
  private miniRec = new PenRecord();
  /** 마지막으로 바뀐 주기의 미니맵 명령 (null = 아직 없음 — 첫 주기는 늘 바뀐 것으로 본다) */
  private miniLast: PenRecord | null = null;
  private readonly mini: MiniComposite;
  /** 마지막 commit에서 화면 · 미니맵 그림이 바뀌었는가 (안 바뀌었으면 미니맵도 다시 그릴 필요가 없다) */
  changed = true;
  private readonly lightKey: string | null = null;
  private readonly lightTexture: Phaser.Textures.Texture | null = null;
  private readonly lightImage: Phaser.GameObjects.Image | null = null;
  /** 테두리 리프트 (ADD, 곱하기 뒤): 작은 아틀라스 + 블리터 (합성 배율 px 좌표라 1/s 컨테이너에 담는다) */
  private readonly liftKey: string;
  private readonly liftBox: Phaser.GameObjects.Container;
  /**
   * 테두리 리프트 조각과 그 합성 px 사각형: 창 밖 조각은 그리지 않는다(블리터는 창 거르기를 하지 않아 맵 전체 조각을 매 프레임
   * 싣는다 — 확대 3에서 버퍼의 약 20%). 창이 움직일 때만 다시 고른다
   */
  private readonly liftBobs: {
    bob: Phaser.GameObjects.Bob;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }[] = [];
  private readonly liftAt = { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN };
  /** 합성 px / 타일 */
  private readonly k: number;
  private readonly s: number;
  private readonly ox: number;
  private readonly oy: number;
  /** 측정: 마지막 commit까지 걸린 시간 (ms) */
  lastCommitMs = 0;
  private t0 = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
    opts: FogLayerOptions,
  ) {
    const s = opts.compositeScale;
    this.s = s;
    const ox = snapToDevice(MAP_X, opts.zoom);
    const oy = snapToDevice(MAP_Y, opts.zoom);
    this.ox = ox;
    this.oy = oy;
    const lpt = opts.lightPxPerTile;
    const k = TILE_PX * WORLD_SCALE * s;
    this.k = k;
    // 정적 맵: 조각 아틀라스 (발광을 구워 넣는다 — 따라가는 카메라에서는 발광을 따로 올리지 않는다). 조각은 판 전에 구운
    // 맵 전체 그림에서 복사만 한다: 로비에서 덜 구웠으면(연습 바로 시작) 여기서 끝까지 굽는다 — 판 중에는 칠하지 않는다
    getStaticMap(k / TILE_PX, true);
    this.chunks = opts.chunks ?? new ChunkAtlas(k, VIEW_TILES_W, VIEW_TILES_H, PREFETCH_MARGIN, true);
    this.chunkKey = nextFogKey('fog-chunks');
    this.chunkTex = createCanvasTexture(scene.textures, this.chunkKey, this.chunks.canvas);
    this.chunks.onBaked = (src, x, y) => {
      if (!this.chunkFull && !uploadCanvasSubTexture(scene.game.renderer, this.chunkTex.source[0], src, x, y))
        this.chunkFull = true;
      gfxState.features.chunkUploadPx = Number(gfxState.features.chunkUploadPx ?? 0) + src.width * src.height;
    };
    this.chunkBox = scene.make.container({ x: 0, y: 0 }, false);
    root.add(this.chunkBox);
    gfxState.features.glowLayer = 'static';
    resetExitTracking();
    // make로 만든 컨테이너는 혼합 모드가 NORMAL로 잡혀 자식의 혼합 모드(ADD 등)를 덮는다 → SKIP_CHECK로 자식 것을 쓴다
    this.dynBox = scene.make.container({ x: 0, y: 0 }, false).setBlendMode(Phaser.BlendModes.SKIP_CHECK);
    root.add(this.dynBox);
    // 시야 채움: 빛 지도와 같은 격자 (채움 경계는 곱해지는 빛의 경계와 같은 부드러움)
    this.lpt = lpt;
    this.tintBox = scene.make.container({ x: 0, y: 0 }, false).setBlendMode(Phaser.BlendModes.SKIP_CHECK);
    root.add(this.tintBox);
    const mapW = MAP_W * TILE_PX * WORLD_SCALE;
    const mapH = MAP_H * TILE_PX * WORLD_SCALE;
    this.light = opts.fog
      ? new LightMap(lpt, opts.ambientCss, domLightSurface, ambientRgb(FOG.ambient, FOG.tint))
      : null;
    if (this.light) {
      this.lightKey = nextFogKey('fog-light');
      this.lightTexture = createCanvasTexture(scene.textures, this.lightKey, this.light.canvas);
      this.lightImage = scene.make
        .image({ x: MAP_X, y: MAP_Y, key: this.lightKey }, false)
        .setOrigin(0, 0)
        .setScale(mapW / this.light.canvas.width, mapH / this.light.canvas.height)
        .setBlendMode(Phaser.BlendModes.MULTIPLY);
      root.add(this.lightImage);
    }
    // 빛 지도 셰이더: 높음은 경계 노이즈 + 따라가기, 중간은 따라가기만 (세기 0). Canvas 렌더러 · 안개 끔이면 없다
    const piped = this.lightImage !== null && ensureFogEdgePipeline(scene.game);
    this.shader = opts.shader && piped;
    const pipeName = this.shader ? FOG_EDGE_PIPELINE : FOG_FOLLOW_PIPELINE;
    this.pipe = piped ? fogPipeline(scene.game, pipeName) : null;
    if (this.pipe) {
      resetFollowState(this.pipe.follow);
      this.lightImage?.setPipeline(pipeName);
    }
    this.selfFollow = this.pipe !== null;
    // 테두리 리프트: 정적 조각을 한 번 구운 아틀라스를 블리터로 찍는다 (정적 맵 텍셀 경계에 맞춤)
    const atlas = layoutRimLift(k);
    const lift = makeCanvas(atlas.width, atlas.height);
    paintRimLiftAtlas(lift.ctx, atlas);
    this.liftKey = nextFogKey('fog-lift');
    const liftTex = createCanvasTexture(scene.textures, this.liftKey, lift.canvas);
    for (const f of atlas.frames) liftTex.add(f.name, 0, f.ax, f.ay, f.w, f.h);
    const blit = scene.make.blitter({ key: this.liftKey }, false).setBlendMode(Phaser.BlendModes.ADD);
    const frameOf = new Map(atlas.frames.map((f) => [f.name, f]));
    for (const b of atlas.bobs) {
      const f = frameOf.get(b.frame);
      const bob = blit.create(b.x, b.y, b.frame);
      this.liftBobs.push({ bob, x0: b.x, y0: b.y, x1: b.x + (f?.w ?? 0), y1: b.y + (f?.h ?? 0) });
    }
    this.liftBox = scene.make
      .container({ x: ox, y: oy }, false)
      .setScale(1 / s)
      .setBlendMode(Phaser.BlendModes.SKIP_CHECK);
    this.liftBox.add(blit);
    root.add(this.liftBox);
    gfxState.features.liftPieces = atlas.bobs.length;

    this.mini = new MiniComposite(lpt, this.light);
    // 정적 맵 캐시는 조각을 복사할 맵 전체 그림과 미니맵 두 장만 남긴다 (옛 배율 · 다른 경로의 큰 캔버스를 붙잡지 않게)
    keepStaticMaps(
      [
        { scale: k / TILE_PX, withGlow: true },
        { scale: lpt / TILE_PX, withGlow: true },
      ],
      true,
    );
    this.begin();
    this.commit();
  }

  /** 미니맵 합성 (마지막 commit 뒤 처음 읽을 때만 합성한다) */
  get miniSource(): HTMLCanvasElement {
    return this.mini.canvas;
  }

  /**
   * 창 밖 테두리 리프트 조각을 숨긴다 (창이 움직였을 때만): 조각 사각형(합성 px)이 창(합성 px ± 2)과 겹치지 않으면 그리지
   * 않는다. 창 밖은 가리개 밑이라 같은 화소다. 흔들림은 창 자리에 이미 들어 있다
   */
  private cullLift(view: ViewRect): void {
    const at = this.liftAt;
    if (view.x === at.x && view.y === at.y && view.w === at.w && view.h === at.h) return;
    at.x = view.x;
    at.y = view.y;
    at.w = view.w;
    at.h = view.h;
    const k = this.k;
    const m = 2;
    const x0 = view.x * k - m;
    const y0 = view.y * k - m;
    const x1 = (view.x + view.w) * k + m;
    const y1 = (view.y + view.h) * k + m;
    let shown = 0;
    for (const b of this.liftBobs) {
      const on = b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1;
      if (b.bob.visible !== on) b.bob.setVisible(on);
      if (on) shown += 1;
    }
    gfxState.features.liftShown = shown;
  }

  /**
   * 보이는 창(타일)에 맞춰 조각 그림을 놓는다. 창 안 조각은 없으면 바로 옮기고(맵 전체 그림에서 복사), 둘레 여유 안 조각은
   * 프레임마다 시간 예산 안에서 미리 옮긴다. 프레임마다 부른다(그림 자리만 바꾼다). 늘 false (화면 합성이 따로 없어 안개 주기를 앞당길 일이 없다)
   */
  setView(view: ViewRect): boolean {
    const a = this.chunks;
    const r = chunkRange(view, 0, a.tiles);
    const tex = this.chunkTex;
    let n = 0;
    for (let cy = r.cy0; cy <= r.cy1; cy += 1) {
      for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
        a.ensure(cx, cy);
        const slot = a.slot(cx, cy);
        if (slot.w <= 0 || slot.h <= 0) continue;
        const name = `c${a.slotIndex(cx, cy)}`;
        if (tex.has(name)) tex.get(name).setSize(slot.w, slot.h, slot.x, slot.y);
        else tex.add(name, 0, slot.x, slot.y, slot.w, slot.h);
        let img = this.chunkImgs[n];
        if (!img) {
          img = this.scene.make.image({ x: 0, y: 0, key: this.chunkKey, frame: name }, false).setOrigin(0, 0);
          this.chunkBox.add(img);
          this.chunkImgs.push(img);
        }
        const b = chunkBox(cx, cy, a.tiles, a.k);
        img
          .setFrame(name)
          .setPosition(this.ox + b.x0 / this.s, this.oy + b.y0 / this.s)
          .setScale(1 / this.s)
          .setVisible(true);
        n += 1;
      }
    }
    for (let i = n; i < this.chunkImgs.length; i += 1) this.chunkImgs[i]?.setVisible(false);
    // 둘레 미리 옮기기 (창 안은 위에서 다 옮겼다): 시간 예산 안에서만
    const p = chunkRange(view, PREFETCH_MARGIN, a.tiles);
    const until = performance.now() + PREFETCH_BUDGET_MS;
    let over = false;
    for (let cy = p.cy0; cy <= p.cy1 && !over; cy += 1)
      for (let cx = p.cx0; cx <= p.cx1 && !over; cx += 1)
        if (a.ensure(cx, cy)) over = performance.now() > until;
    if (this.chunkFull) {
      this.chunkFull = false;
      uploadCanvasTexture(tex);
    }
    gfxState.features.chunkImages = n;
    this.cullLift(view);
    return false;
  }

  /**
   * 안개 주기 시작. 빛 · 미니맵은 바로 칠하지 않고 기록만 한다: commit에서 지난번과 견줘 바뀐 것만 다시 칠하고 올린다
   * (미니맵은 읽을 때 합성. M12 휴대폰 성능: 다 같이 서 있는 동안 빛 지도 업로드 · 미니맵 합성이 없다). 그림 결과는 바로 칠하던 때와 같다
   */
  begin(): void {
    this.t0 = performance.now();
    this.tintN = 0;
    this.lightRec.reset();
    this.miniRec.reset();
    this.selfR = 0;
    this.hardSelf = 0;
    this.hardOther = 0;
    this.softOther = 0;
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number, self = false): void {
    if (poly.length < 3) return;
    let t = this.tints[this.tintN];
    if (!t) {
      t = new TintPatch(this.scene, this.tintBox, this.lpt);
      this.tints.push(t);
    }
    t.set(poly, color, alpha);
    t.self = self;
    this.tintN += 1;
    this.miniRec.fillPoly(poly, color, alpha);
  }

  /** 조각 하나 (범위가 바뀌었으면 새로 만든다). 이번 주기 기록을 비워 돌려준다 */
  private patchFor(key: string, bounds: TileRect): DynPatch {
    let patch = this.patches.get(key);
    if (patch && !sameRect(patch.bounds, bounds)) {
      patch.destroy();
      patch = undefined;
    }
    if (!patch) {
      patch = new DynPatch(this.scene, this.dynBox, bounds, this.s, this.ox, this.oy);
      this.patches.set(key, patch);
    }
    patch.rec.reset();
    return patch;
  }

  /** 조각 기록을 미니맵 기록에 늘 넣고, (바뀌었으면) 조각 캔버스에 다시 그려 올린다 */
  private finishPatch(patch: DynPatch): void {
    this.miniRec.append(patch.rec);
    patch.update();
  }

  drawPoints(points: readonly PointView[], balance: Balance): void {
    const now = gfxNow();
    const r = balance.capturePoint.radius;
    for (const p of points) {
      const patch = this.patchFor(POINT_KEY[p.id], pointPaintBounds(p.id, r));
      ONE_POINT[0] = p;
      paintPoints(patch.rec, ONE_POINT, balance, now);
      this.finishPatch(patch);
    }
    ONE_POINT.length = 0;
  }

  drawExits(exits: readonly ExitView[], balance: Balance): void {
    const now = gfxNow();
    const real = performance.now();
    const r = balance.exit.radius;
    for (const e of exits) {
      const patch = this.patchFor(EXIT_KEY[e.id], exitPaintBounds(e.id, r));
      ONE_EXIT[0] = e;
      paintExits(patch.rec, ONE_EXIT, balance, now, real);
      this.finishPatch(patch);
    }
    ONE_EXIT.length = 0;
  }

  addSoftLight(light: SoftLight): void {
    if (!this.light) return;
    this.lightRec.addSoft(light);
    if (light.poly.length < 3) return;
    if ((light.reach ?? 0) > 0 && this.selfR === 0) {
      this.selfX = light.center.x;
      this.selfY = light.center.y;
      this.selfR = light.radius;
      this.selfSoft = light.soft;
    } else this.softOther += 1;
  }

  addHardLight(poly: readonly Vec2[], self = false): void {
    if (!this.light) return;
    this.lightRec.addHard(poly);
    if (poly.length < 3) return;
    if (self) this.hardSelf += 1;
    else this.hardOther += 1;
  }

  /**
   * 내 빛 따라가기 (프레임마다, 안개 주기 뒤): 이번 주기에 칠한 내 시야를 (dx, dy) 타일만큼 옮겨 그린다. 생존자는 빛 지도의 내 덮임
   * 표시 안에서 내 빛만 지금 자리로(셰이더 followLight), 괴물은 빛 지도가 모두 자기 시야라 통째로 옮겨 읽는다. 내 시야 틴트 조각도
   * 같이 옮긴다. Δ = 0이면 예전과 같은 그림
   */
  follow(dx: number, dy: number): void {
    for (let i = 0; i < this.tintN; i += 1) {
      const t = this.tints[i];
      if (t) t.shift(t.self ? dx : 0, t.self ? dy : 0);
    }
    const f = this.pipe?.follow;
    if (!f) return;
    f.selfOn = this.selfR > 0;
    f.eyeFogX = this.selfX;
    f.eyeFogY = this.selfY;
    f.eyeNowX = this.selfX + dx;
    f.eyeNowY = this.selfY + dy;
    f.r = this.selfR > 0 ? this.selfR : 1;
    f.soft = this.selfR > 0 ? this.selfSoft : 1;
    f.shiftOn = this.hardSelf > 0 && this.hardOther === 0 && this.softOther === 0 && this.selfR === 0;
    f.shiftX = f.shiftOn ? dx : 0;
    f.shiftY = f.shiftOn ? dy : 0;
  }

  commit(): void {
    for (let i = 0; i < this.tints.length; i += 1) {
      const t = this.tints[i];
      if (!t) continue;
      if (i < this.tintN) t.update();
      else t.hide();
    }
    const lightChanged = this.light !== null && this.lightRec.paint(this.light);
    if (lightChanged && this.lightTexture) uploadCanvasTexture(this.lightTexture);
    // 미니맵: 빛과 명령이 지난번과 같으면 그대로 둔다. 바뀌었으면 이번 기록을 남기고(맞바꿔 다음 주기에 다시 쓴다) 읽을 때 합성
    const last = this.miniLast;
    const miniChanged = lightChanged || last === null || !this.miniRec.same(last);
    if (miniChanged) {
      this.miniLast = this.miniRec;
      this.miniRec = last ?? new PenRecord();
      this.mini.take(this.miniLast);
    }
    // 화면 쪽 시야 채움 · 조각 · 빛은 모두 미니맵 기록에도 들어가므로, 미니맵이 그대로면 화면도 그대로다
    this.changed = miniChanged;
    gfxState.features.fogSkips = Number(gfxState.features.fogSkips ?? 0) + (miniChanged ? 0 : 1);
    const n = countGraphicsCmds(this.root.list);
    gfxState.features.mapGfxCmds = n.cmds;
    gfxState.features.mapLayerObjects = n.objects;
    this.lastCommitMs = performance.now() - this.t0;
    recordFogCommit(this.lastCommitMs);
  }

  destroy(): void {
    this.chunks.onBaked = null;
    this.chunkBox.destroy();
    this.chunkImgs.length = 0;
    for (const p of this.patches.values()) p.destroy();
    this.patches.clear();
    this.dynBox.destroy();
    for (const t of this.tints) t.destroy();
    this.tintBox.destroy();
    this.lightImage?.destroy();
    this.liftBox.destroy();
    removeCanvasTexture(this.scene.textures, this.chunkKey);
    if (this.lightKey) removeCanvasTexture(this.scene.textures, this.lightKey);
    removeCanvasTexture(this.scene.textures, this.liftKey);
  }
}
