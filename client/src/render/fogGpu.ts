// GPU 안개 합성 (품질 높음 · 중간, WebGL에서만).
//
// Canvas 합성은 바닥 전체(배율 2에서 2856×1904)를 안개 주기(20~30Hz)마다 CPU로 다시 그리고 GPU에 통째로 올린다.
// 여기서는 정적 맵을 합성 배율로 한 번만 텍스처로 올리고, 매 안개 주기에는
//   1) 공개 동적 레이어(거점 · 탈출구 링, 시야 원 채움)를 Graphics로 다시 그리고
//   2) 작은 빛 지도(타일당 12~16px)만 올려 MULTIPLY로 곱한다.
// WebGL MULTIPLY = [DST_COLOR, ONE_MINUS_SRC_ALPHA]라 불투명한 빛 지도에서는 Canvas 'multiply'와 같은 값이다.
//
// 품질 높음은 빛 지도 이미지에 경계 셰이더(FogEdgePipeline)를 건다. 경계 안쪽 띠만 노이즈로 '어둡게만' 하고
// 시야 밖(하한)과 완전히 밝은 곳은 바꾸지 않는다(fogMath.edgeDarken과 같은 식, GLSL은 fogMath.FOG_EDGE_FRAG).
// 빛 지도 이미지 하나에만 걸리므로 캐릭터 · 범위 · 마커 · HUD에는 닿지 않는다.
//
// 텍스처는 getImageData 사본을 만드는 addCanvas(CanvasTexture) 대신 fogPaint.createCanvasTexture로 올린다.
import Phaser from 'phaser';
import { MAP_H, MAP_W, TILE_PX, type Balance, type ExitView, type PointView, type Vec2 } from '@decoy/shared';
import { gfxNow } from '../gfx/state';
import { MAP_SCALE, MAP_X, MAP_Y } from '../ui/layout';
import { FOG } from './colors';
import type { FogLayer, FogLayerOptions } from './baseLayer';
import { FOG_EDGE_FRAG, snapToDevice } from './fogMath';
import {
  CanvasPen,
  GraphicsPen,
  LightMap,
  createCanvasTexture,
  domLightSurface,
  nextFogKey,
  paintExits,
  paintPoints,
  removeCanvasTexture,
  uploadCanvasTexture,
  type SoftLight,
} from './fogPaint';
import { drawStaticMap } from './mapCanvas';

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

export class GpuFog implements FogLayer {
  readonly mode = 'gpu' as const;
  readonly shader: boolean;
  private readonly staticKey: string;
  private readonly staticImage: Phaser.GameObjects.Image;
  private readonly dyn: Phaser.GameObjects.Graphics;
  private readonly pen: GraphicsPen;
  private readonly light: LightMap | null;
  private readonly lightKey: string | null = null;
  private readonly lightTexture: Phaser.Textures.Texture | null = null;
  private readonly lightImage: Phaser.GameObjects.Image | null = null;
  /** 미니맵용 작은 합성 (빛 지도와 같은 해상도) */
  private readonly mini: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D;
  private readonly miniStatic: HTMLCanvasElement;
  private readonly miniPen: CanvasPen;
  /** 측정: 마지막 commit까지 걸린 시간 (ms) */
  lastCommitMs = 0;
  private t0 = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    root: Phaser.GameObjects.Container,
    opts: FogLayerOptions,
  ) {
    const s = opts.compositeScale;
    this.staticKey = nextFogKey('fog-static');
    // 정적 맵은 한 번만 올린다 (사본 없이)
    createCanvasTexture(scene.textures, this.staticKey, drawStaticMap(MAP_SCALE * s));
    this.staticImage = scene.make
      .image(
        { x: snapToDevice(MAP_X, opts.zoom), y: snapToDevice(MAP_Y, opts.zoom), key: this.staticKey },
        false,
      )
      .setOrigin(0, 0)
      .setScale(1 / s);
    this.dyn = scene.make.graphics({ x: MAP_X, y: MAP_Y }, false);
    this.pen = new GraphicsPen(this.dyn, TILE_PX * MAP_SCALE);
    const lpt = opts.lightPxPerTile;
    this.light = opts.fog ? new LightMap(lpt, opts.ambientCss, domLightSurface) : null;
    root.add([this.staticImage, this.dyn]);
    if (this.light) {
      this.lightKey = nextFogKey('fog-light');
      this.lightTexture = createCanvasTexture(scene.textures, this.lightKey, this.light.canvas);
      this.lightImage = scene.make
        .image({ x: MAP_X, y: MAP_Y, key: this.lightKey }, false)
        .setOrigin(0, 0)
        .setScale(
          (MAP_W * TILE_PX * MAP_SCALE) / this.light.canvas.width,
          (MAP_H * TILE_PX * MAP_SCALE) / this.light.canvas.height,
        )
        .setBlendMode(Phaser.BlendModes.MULTIPLY);
      root.add(this.lightImage);
    }
    this.shader = opts.shader && this.lightImage !== null && ensureFogEdgePipeline(scene.game);
    if (this.shader) this.lightImage?.setPipeline(FOG_EDGE_PIPELINE);

    this.miniStatic = drawStaticMap(lpt / TILE_PX);
    this.mini = document.createElement('canvas');
    this.mini.width = this.miniStatic.width;
    this.mini.height = this.miniStatic.height;
    const mctx = this.mini.getContext('2d');
    if (!mctx) throw new Error('미니맵 합성 캔버스를 만들 수 없습니다');
    this.miniCtx = mctx;
    this.miniPen = new CanvasPen(mctx, lpt, lpt / (TILE_PX * MAP_SCALE));
    this.begin();
    this.commit();
  }

  get miniSource(): HTMLCanvasElement {
    return this.mini;
  }

  begin(): void {
    this.t0 = performance.now();
    this.dyn.clear();
    this.light?.clear();
    this.miniCtx.globalCompositeOperation = 'source-over';
    this.miniCtx.drawImage(this.miniStatic, 0, 0);
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    this.pen.fillPoly(poly, color, alpha);
    this.miniPen.fillPoly(poly, color, alpha);
  }

  drawPoints(points: readonly PointView[], balance: Balance): void {
    paintPoints(this.pen, points, balance);
    paintPoints(this.miniPen, points, balance);
  }

  drawExits(exits: readonly ExitView[], balance: Balance): void {
    paintExits(this.pen, exits, balance);
    paintExits(this.miniPen, exits, balance);
  }

  addSoftLight(light: SoftLight): void {
    this.light?.addSoft(light);
  }

  addHardLight(poly: readonly Vec2[]): void {
    this.light?.addHard(poly);
  }

  commit(): void {
    if (this.light) {
      if (this.lightTexture) uploadCanvasTexture(this.lightTexture);
      const c = this.miniCtx;
      c.save();
      c.globalCompositeOperation = 'multiply';
      c.drawImage(this.light.canvas, 0, 0, this.mini.width, this.mini.height);
      c.restore();
    }
    this.lastCommitMs = performance.now() - this.t0;
  }

  destroy(): void {
    this.staticImage.destroy();
    this.dyn.destroy();
    this.lightImage?.destroy();
    removeCanvasTexture(this.scene.textures, this.staticKey);
    if (this.lightKey) removeCanvasTexture(this.scene.textures, this.lightKey);
  }
}
