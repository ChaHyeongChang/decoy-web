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
//
// 텍스처는 getImageData 사본을 만드는 addCanvas(CanvasTexture) 대신 fogPaint.createCanvasTexture로 올린다.
//
// 레이어 순서 (fogRoot 안): 정적 맵 → 발광 번짐(ADD, presets glow = 'sprite') → 공개 동적 레이어(조각 → 시야 채움)
// → 빛 지도(MULTIPLY) → 테두리 리프트(ADD, 정적 아틀라스 + 블리터). 발광은 곱하기 앞이라 어둠 속 약 30%,
// 테두리 리프트는 곱하기 뒤라 시야 밖에서도 구조가 보인다.
import Phaser from 'phaser';
import { MAP_H, MAP_W, TILE_PX, type Balance, type ExitView, type PointView, type Vec2 } from '@decoy/shared';
import { getGlowMap, getStaticMap, GLOW_SCALE, keepStaticMaps } from '../art/mapArt';
import type { TileRect } from '../art/mapArtGeom';
import { currentPreset, gfxNow, gfxState } from '../gfx/state';
import { MAP_SCALE, MAP_X, MAP_Y } from '../ui/layout';
import { FOG } from './colors';
import type { FogLayer, FogLayerOptions } from './baseLayer';
import { FOG_EDGE_FRAG, snapToDevice } from './fogMath';
import {
  CanvasPen,
  LightMap,
  LightRecord,
  PenRecord,
  addRimLift,
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
  rimLiftPath,
  uploadCanvasTexture,
  type SoftLight,
} from './fogPaint';

export const FOG_EDGE_PIPELINE = 'DecoyFogEdge';

/** 경계 셰이더 파이프라인 (빛 지도 이미지 전용). 사전 파이프라인이라 그리는 횟수가 늘지 않는다 */
export class FogEdgePipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
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
    this.set1f('uStrength', FOG.edgeDarken);
    this.set1f('uNoiseScale', FOG.edgeNoiseScale);
    this.set1f('uNoiseSpeed', FOG.edgeNoiseSpeed);
    this.set1f('uTime', 0);
  }

  override onPreRender(): void {
    // 장식 시계 (테스트에서 멈출 수 있다). 큰 값에서 float 정밀도가 떨어지지 않게 한 시간 주기로 접는다
    this.set1f('uTime', (gfxNow() / 1000) % 3600);
  }
}

/** WebGL 렌더러에 경계 셰이더를 한 번만 등록한다. Canvas 렌더러면 아무것도 만들지 않고 false */
export function ensureFogEdgePipeline(game: Phaser.Game): boolean {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!r.pipelines.has(FOG_EDGE_PIPELINE)) r.pipelines.add(FOG_EDGE_PIPELINE, new FogEdgePipeline(game));
  return true;
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

/** 공개 동적 레이어 한 조각 (거점 · 탈출구 하나, 합성 배율 · 정적 맵 텍셀 경계). 그린 명령이 바뀔 때만 다시 그려 올린다 */
class DynPatch {
  private readonly layer: CanvasLayer;
  private readonly pen: CanvasPen;
  private readonly x0: number;
  private readonly y0: number;
  private last: number[] = [];

  constructor(
    scene: Phaser.Scene,
    box: Phaser.GameObjects.Container,
    readonly bounds: TileRect,
    s: number,
    ox: number,
    oy: number,
  ) {
    const k = TILE_PX * MAP_SCALE * s;
    this.x0 = Math.floor(bounds.x0 * k);
    this.y0 = Math.floor(bounds.y0 * k);
    const w = Math.ceil(bounds.x1 * k) - this.x0;
    const h = Math.ceil(bounds.y1 * k) - this.y0;
    this.layer = new CanvasLayer(scene, 'fog-dyn', w, h, ox + this.x0 / s, oy + this.y0 / s);
    this.layer.image.setScale(1 / s);
    box.add(this.layer.image);
    this.pen = new CanvasPen(this.layer.ctx, k, s);
  }

  update(rec: PenRecord): void {
    if (rec.sameAs(this.last)) return;
    this.layer.clear();
    this.layer.ctx.setTransform(1, 0, 0, 1, -this.x0, -this.y0);
    rec.replay(this.pen);
    this.layer.upload();
    this.last = rec.ops.slice();
  }

  destroy(): void {
    this.layer.destroy();
  }
}

/**
 * 시야 채움 한 장 (fillPoly 하나: 생존자 시야 원 · 괴물 부채꼴 · 근접 원). 빛 지도와 같은 격자(타일당 lpt px)에 그 다각형의
 * 외접 사각형만큼만 그린다: 맵 전체 크기 투명 사각형을 매 프레임 섞으면 채우기 비용(소프트웨어 래스터 · 모바일 GPU)이 크다.
 * 캔버스는 커지기만 하고(다시 만들지 않게), 기록이 지난번과 다를 때만 다시 그려 올린다
 */
class TintPatch {
  readonly rec = new PenRecord();
  private readonly layer: CanvasLayer;
  private readonly pen: CanvasPen;
  private last: number[] = [];

  constructor(
    scene: Phaser.Scene,
    box: Phaser.GameObjects.Container,
    private readonly lpt: number,
  ) {
    this.layer = new CanvasLayer(scene, 'fog-tint', 64, 64, MAP_X, MAP_Y);
    this.layer.image.setScale((TILE_PX * MAP_SCALE) / lpt);
    box.add(this.layer.image);
    this.pen = new CanvasPen(this.layer.ctx, lpt, lpt / (TILE_PX * MAP_SCALE));
  }

  /** 기록(다각형 하나)을 그 외접 사각형(빛 지도 격자, 테 1px)에 그린다 */
  update(b: TileRect): void {
    const img = this.layer.image;
    img.setVisible(true);
    if (this.rec.sameAs(this.last)) return;
    const k = this.lpt;
    const x0 = Math.floor(b.x0 * k) - 1;
    const y0 = Math.floor(b.y0 * k) - 1;
    const w = Math.ceil(b.x1 * k) + 1 - x0;
    const h = Math.ceil(b.y1 * k) + 1 - y0;
    const c = this.layer.canvas;
    if (w > c.width || h > c.height) {
      const up = (v: number): number => Math.ceil(v / 64) * 64;
      resizeCanvasTexture(
        this.layer.key,
        this.layer.texture,
        c,
        up(Math.max(w, c.width)),
        up(Math.max(h, c.height)),
      );
      img.setSizeToFrame();
    }
    this.layer.clear();
    this.layer.ctx.setTransform(1, 0, 0, 1, -x0, -y0);
    this.rec.replay(this.pen);
    this.layer.upload();
    const s = (TILE_PX * MAP_SCALE) / k;
    img.setPosition(MAP_X + x0 * s, MAP_Y + y0 * s);
    this.last = this.rec.ops.slice();
  }

  hide(): void {
    this.layer.image.setVisible(false);
    this.last = [];
  }

  destroy(): void {
    this.layer.destroy();
  }
}

function polyBounds(poly: readonly Vec2[]): TileRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function sameRect(a: TileRect, b: TileRect): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

export class GpuFog implements FogLayer {
  readonly mode = 'gpu' as const;
  readonly shader: boolean;
  private readonly staticKey: string;
  private readonly staticImage: Phaser.GameObjects.Image;
  /** 발광 번짐 (ADD, 곱하기 앞). glow = 'static'이면 정적 맵에 구워 없음 */
  private readonly glowKey: string | null = null;
  private readonly glowImage: Phaser.GameObjects.Image | null = null;
  /** 공개 동적 레이어: 거점 · 탈출구 조각 (빛 지도 · 시야 채움보다 아래) */
  private readonly dynBox: Phaser.GameObjects.Container;
  private readonly patches = new Map<string, DynPatch>();
  private readonly rec = new PenRecord();
  /** 시야 채움 (빛 지도 격자, 다각형마다 한 장): 안개 주기마다 기록해 바뀐 장만 다시 그려 올린다 */
  private readonly tintBox: Phaser.GameObjects.Container;
  private readonly tints: TintPatch[] = [];
  private readonly tintBounds: TileRect[] = [];
  private tintN = 0;
  private readonly lpt: number;
  private readonly light: LightMap | null;
  /** 이번 주기의 빛 명령 (지난번과 같으면 빛 지도를 다시 칠하지도 올리지도 않는다) */
  private readonly lightRec = new LightRecord();
  /** 이번 주기의 미니맵 합성 명령 (시야 채움 · 조각, 그린 순서대로) */
  private readonly miniRec = new PenRecord();
  /** 마지막으로 미니맵에 합성한 명령 (null = 아직 없음 — 첫 주기는 늘 합성한다) */
  private miniLast: number[] | null = null;
  /** 마지막 commit에서 화면 · 미니맵 그림이 바뀌었는가 (안 바뀌었으면 미니맵도 다시 그릴 필요가 없다) */
  changed = true;
  private readonly lightKey: string | null = null;
  private readonly lightTexture: Phaser.Textures.Texture | null = null;
  private readonly lightImage: Phaser.GameObjects.Image | null = null;
  /** 테두리 리프트 (ADD, 곱하기 뒤): 작은 아틀라스 + 블리터 (합성 배율 px 좌표라 1/s 컨테이너에 담는다) */
  private readonly liftKey: string;
  private readonly liftBox: Phaser.GameObjects.Container;
  private readonly miniLift: Path2D;
  /** 미니맵용 작은 합성 (빛 지도와 같은 해상도) */
  private readonly mini: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D;
  private readonly miniStatic: HTMLCanvasElement;
  private readonly miniPen: CanvasPen;
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
    const sprite = (opts.glow ?? currentPreset().glow) === 'sprite';
    const ox = snapToDevice(MAP_X, opts.zoom);
    const oy = snapToDevice(MAP_Y, opts.zoom);
    this.ox = ox;
    this.oy = oy;
    const lpt = opts.lightPxPerTile;
    const mainScale = MAP_SCALE * s;
    const miniScale = lpt / TILE_PX;
    this.staticKey = nextFogKey('fog-static');
    // 정적 맵은 한 번만 올린다 (사본 없이, 같은 배율이면 캐시한 그림)
    createCanvasTexture(scene.textures, this.staticKey, getStaticMap(mainScale, !sprite));
    this.staticImage = scene.make
      .image({ x: ox, y: oy, key: this.staticKey }, false)
      .setOrigin(0, 0)
      .setScale(1 / s);
    root.add(this.staticImage);
    if (sprite) {
      this.glowKey = nextFogKey('fog-glow');
      createCanvasTexture(scene.textures, this.glowKey, getGlowMap());
      this.glowImage = scene.make
        .image({ x: ox, y: oy, key: this.glowKey }, false)
        .setOrigin(0, 0)
        .setScale(MAP_SCALE / GLOW_SCALE)
        .setBlendMode(Phaser.BlendModes.ADD);
      root.add(this.glowImage);
    }
    gfxState.features.glowLayer = sprite ? 'sprite' : 'static';
    resetExitTracking();
    // make로 만든 컨테이너는 혼합 모드가 NORMAL로 잡혀 자식의 혼합 모드(ADD 등)를 덮는다 → SKIP_CHECK로 자식 것을 쓴다
    this.dynBox = scene.make.container({ x: 0, y: 0 }, false).setBlendMode(Phaser.BlendModes.SKIP_CHECK);
    root.add(this.dynBox);
    // 시야 채움: 빛 지도와 같은 격자 (채움 경계는 곱해지는 빛의 경계와 같은 부드러움)
    this.lpt = lpt;
    this.tintBox = scene.make.container({ x: 0, y: 0 }, false).setBlendMode(Phaser.BlendModes.SKIP_CHECK);
    root.add(this.tintBox);
    const mapW = MAP_W * TILE_PX * MAP_SCALE;
    const mapH = MAP_H * TILE_PX * MAP_SCALE;
    this.light = opts.fog ? new LightMap(lpt, opts.ambientCss, domLightSurface) : null;
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
    this.shader = opts.shader && this.lightImage !== null && ensureFogEdgePipeline(scene.game);
    if (this.shader) this.lightImage?.setPipeline(FOG_EDGE_PIPELINE);
    // 테두리 리프트: 정적 조각을 한 번 구운 아틀라스를 블리터로 찍는다 (정적 맵 텍셀 경계에 맞춤)
    const atlas = layoutRimLift(TILE_PX * MAP_SCALE * s);
    const lift = makeCanvas(atlas.width, atlas.height);
    paintRimLiftAtlas(lift.ctx, atlas);
    this.liftKey = nextFogKey('fog-lift');
    const liftTex = createCanvasTexture(scene.textures, this.liftKey, lift.canvas);
    for (const f of atlas.frames) liftTex.add(f.name, 0, f.ax, f.ay, f.w, f.h);
    const blit = scene.make.blitter({ key: this.liftKey }, false).setBlendMode(Phaser.BlendModes.ADD);
    for (const b of atlas.bobs) blit.create(b.x, b.y, b.frame);
    this.liftBox = scene.make
      .container({ x: ox, y: oy }, false)
      .setScale(1 / s)
      .setBlendMode(Phaser.BlendModes.SKIP_CHECK);
    this.liftBox.add(blit);
    root.add(this.liftBox);
    gfxState.features.liftPieces = atlas.bobs.length;

    this.miniStatic = getStaticMap(miniScale, true);
    // 정적 맵 캐시는 이 레이어가 쓰는 두 장(메인 · 미니맵)만 남긴다 (옛 배율 · 다른 경로의 큰 캔버스를 붙잡지 않게)
    keepStaticMaps(
      [
        { scale: mainScale, withGlow: !sprite },
        { scale: miniScale, withGlow: true },
      ],
      sprite,
    );
    this.miniLift = rimLiftPath(lpt);
    const mini = makeCanvas(this.miniStatic.width, this.miniStatic.height);
    this.mini = mini.canvas;
    this.miniCtx = mini.ctx;
    this.miniPen = new CanvasPen(this.miniCtx, lpt, lpt / (TILE_PX * MAP_SCALE));
    this.begin();
    this.commit();
  }

  get miniSource(): HTMLCanvasElement {
    return this.mini;
  }

  /**
   * 안개 주기 시작. 빛 · 미니맵은 바로 칠하지 않고 기록만 한다: commit에서 지난번과 견줘 바뀐 것만 다시 칠하고 올린다
   * (M12 휴대폰 성능: 다 같이 서 있는 동안 빛 지도 업로드 · 미니맵 합성이 없다). 그림 결과는 바로 칠하던 때와 같다
   */
  begin(): void {
    this.t0 = performance.now();
    this.tintN = 0;
    this.lightRec.reset();
    this.miniRec.reset();
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    if (poly.length < 3) return;
    let t = this.tints[this.tintN];
    if (!t) {
      t = new TintPatch(this.scene, this.tintBox, this.lpt);
      this.tints.push(t);
    }
    t.rec.reset();
    t.rec.fillPoly(poly, color, alpha);
    this.tintBounds[this.tintN] = polyBounds(poly);
    this.tintN += 1;
    this.miniRec.fillPoly(poly, color, alpha);
  }

  /** 조각 하나를 기록 → (바뀌었으면) 조각 캔버스에 다시 그리고, 미니맵 기록에는 늘 넣는다 */
  private paintPatch(key: string, bounds: TileRect, paint: (pen: PenRecord) => void): void {
    this.rec.reset();
    paint(this.rec);
    let patch = this.patches.get(key);
    if (patch && !sameRect(patch.bounds, bounds)) {
      patch.destroy();
      patch = undefined;
    }
    if (!patch) {
      patch = new DynPatch(this.scene, this.dynBox, bounds, this.s, this.ox, this.oy);
      this.patches.set(key, patch);
    }
    patch.update(this.rec);
    this.rec.replay(this.miniRec);
  }

  drawPoints(points: readonly PointView[], balance: Balance): void {
    const now = gfxNow();
    const r = balance.capturePoint.radius;
    for (const p of points)
      this.paintPatch(`point-${p.id}`, pointPaintBounds(p.id, r), (pen) =>
        paintPoints(pen, [p], balance, now),
      );
  }

  drawExits(exits: readonly ExitView[], balance: Balance): void {
    const now = gfxNow();
    const real = performance.now();
    const r = balance.exit.radius;
    for (const e of exits)
      this.paintPatch(`exit-${e.id}`, exitPaintBounds(e.id, r), (pen) =>
        paintExits(pen, [e], balance, now, real),
      );
  }

  addSoftLight(light: SoftLight): void {
    if (this.light) this.lightRec.addSoft(light);
  }

  addHardLight(poly: readonly Vec2[]): void {
    if (this.light) this.lightRec.addHard(poly);
  }

  commit(): void {
    this.tints.forEach((t, i) => {
      const b = this.tintBounds[i];
      if (i < this.tintN && b) t.update(b);
      else t.hide();
    });
    const lightChanged = this.light !== null && this.lightRec.paint(this.light);
    if (lightChanged && this.lightTexture) uploadCanvasTexture(this.lightTexture);
    // 미니맵 합성: 정적 맵 → 채움 · 조각 → 빛 곱하기 → 테두리 리프트. 빛과 명령이 지난번과 같으면 그대로 둔다
    const miniChanged = lightChanged || this.miniLast === null || !this.miniRec.sameAs(this.miniLast);
    if (miniChanged) {
      const c = this.miniCtx;
      c.globalCompositeOperation = 'source-over';
      c.drawImage(this.miniStatic, 0, 0);
      this.miniRec.replay(this.miniPen);
      if (this.light) {
        c.save();
        c.globalCompositeOperation = 'multiply';
        c.drawImage(this.light.canvas, 0, 0, this.mini.width, this.mini.height);
        c.restore();
      }
      addRimLift(c, this.miniLift);
      this.miniLast = this.miniRec.ops.slice();
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
    this.staticImage.destroy();
    this.glowImage?.destroy();
    for (const p of this.patches.values()) p.destroy();
    this.patches.clear();
    this.dynBox.destroy();
    for (const t of this.tints) t.destroy();
    this.tintBox.destroy();
    this.lightImage?.destroy();
    this.liftBox.destroy();
    removeCanvasTexture(this.scene.textures, this.staticKey);
    if (this.glowKey) removeCanvasTexture(this.scene.textures, this.glowKey);
    if (this.lightKey) removeCanvasTexture(this.scene.textures, this.lightKey);
    removeCanvasTexture(this.scene.textures, this.liftKey);
  }
}
