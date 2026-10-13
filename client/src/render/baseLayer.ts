// 바닥 합성 레이어: 정적 맵 + 거점 · 탈출구 영역 + 시야 원/부채꼴 채움 + 안개(빛 지도 곱하기).
// 안개 갱신 주기(20~30Hz)에만 다시 그리고, 매 프레임에는 결과만 그린다 (헤드리스 · 저사양 성능).
//
// 정적 맵은 art/mapArt.ts가 굽는다(강판 바닥 · 2.5D 벽 · 기둥 · 감옥 · 거점 단말 · 방폭문 · 네온, 배율별 캐시).
// 합성 순서: 정적 맵 (+ 발광 번짐) → 공개 동적 레이어(거점 · 탈출구 상태, 시야 채움) → 빛 지도 곱하기 → 테두리 리프트 더하기.
// 발광은 곱하기 앞이라 어둠 속 약 30% · 빛 속 100%, 테두리 리프트는 곱하기 뒤라 시야 밖에서도 구조 테두리가 2.5:1 이상 보인다.
//
// 안개 원리 (M10): 빛 지도 바탕이 '하한 × 청회색 틴트'(colors.ts FOG)라서 시야 밖은 맵 구조가 어둡게 보이고,
// 시야 다각형은 'lighten'(최댓값)으로 흰색을 그려 원래 색이 된다. 세 생존자의 시야가 겹쳐도 더 밝아지지 않는다.
// 생존자 시야는 판정 반경 안쪽 1.2타일에서 하한으로 흐려지고(밝게 그린 곳 ⊆ 판정 영역), 괴물 부채꼴은 판정과
// 같은 모양으로 딱 자른다. 캐릭터는 이 레이어 위에 그리므로 곱해지지 않는다. 시야 밖 상대가 안 보이는 것은
// 서버가 좌표를 보내지 않아서다(shared/src/sim/interest.ts).
//
// 두 구현:
//  - CanvasFog (품질 낮음 · Canvas 렌더러): Canvas2D 한 장에 합성하고 텍스처로 올린다
//  - GpuFog (품질 높음 · 중간 + WebGL, fogGpu.ts): 정적 맵 텍스처 한 번 + 작은 빛 지도만 갱신해 MULTIPLY
import type Phaser from 'phaser';
import { TILE_PX, type Balance, type ExitView, type PointView, type Vec2 } from '@decoy/shared';
import { getGlowMap, getStaticMap, keepStaticMaps } from '../art/mapArt';
import { effectivePreset, type RendererKind } from '../gfx/presets';
import { gfxState } from '../gfx/state';
import { MAP_SCALE, MAP_X, MAP_Y } from '../ui/layout';
import { GpuFog } from './fogGpu';
import { compositeScaleFor, fogPathFor, snapToDevice, type FogMode } from './fogMath';
import {
  CanvasPen,
  LightMap,
  LightRecord,
  PenRecord,
  addRimLift,
  countGraphicsCmds,
  createCanvasTexture,
  domLightSurface,
  nextFogKey,
  paintExits,
  paintPoints,
  recordFogCommit,
  removeCanvasTexture,
  resetExitTracking,
  rimLiftPath,
  uploadCanvasTexture,
  type SoftLight,
} from './fogPaint';

export type { SoftLight } from './fogPaint';

export interface FogLayerOptions {
  /** 안개 사용 (끄면 빛 지도를 곱하지 않는다) */
  fog: boolean;
  /** 바닥 합성 배율 (논리 px 대비) */
  compositeScale: number;
  /** 빛 지도 해상도 (타일당 px) */
  lightPxPerTile: number;
  /** 백버퍼 배율 (이미지 위치를 기기 픽셀에 맞춘다) */
  zoom: number;
  /** 빛 지도 바탕색 (하한 × 틴트) */
  ambientCss: string;
  /** 경계 셰이더 (GPU 경로에서만) */
  shader: boolean;
  /** 발광: sprite = 따로 ADD 이미지(GPU 경로), static = 정적 맵에 구움. 없으면 지금 품질 표를 따른다 (Canvas 경로는 늘 static) */
  glow?: 'sprite' | 'static';
}

/** 안개 아래 바닥 레이어. 갱신 주기마다 begin → 채우기 · 빛 → commit */
export interface FogLayer {
  readonly mode: FogMode;
  readonly shader: boolean;
  /** 미니맵이 줄여 그릴 합성 캔버스 (안개 포함) */
  readonly miniSource: HTMLCanvasElement;
  /** 측정: 마지막 합성(begin~commit)에 걸린 시간 (ms) */
  readonly lastCommitMs: number;
  /** 마지막 commit에서 그림이 바뀌었는가 (바뀌지 않았으면 미니맵도 다시 그릴 필요가 없다) */
  readonly changed: boolean;
  begin(): void;
  /** 바닥 위 다각형 채우기 (시야 원 역할색 12%, 괴물 자기 부채꼴 등) */
  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void;
  drawPoints(points: readonly PointView[], balance: Balance): void;
  drawExits(exits: readonly ExitView[], balance: Balance): void;
  /** 경계가 부드러운 원형 시야 (반경 안쪽 soft 타일에 걸쳐 하한으로 흐려진다) */
  addSoftLight(light: SoftLight): void;
  /** 경계가 딱 잘린 시야 (괴물 부채꼴 · 근접 원) */
  addHardLight(poly: readonly Vec2[]): void;
  /** 안개를 곱하고 화면에 반영 */
  commit(): void;
  destroy(): void;
}

/** 안개 방식에 맞는 레이어를 만든다. 그림은 root 컨테이너 안에 넣어 캐릭터 컨테이너보다 항상 아래에 둔다 */
export function createFogLayer(
  scene: Phaser.Scene,
  root: Phaser.GameObjects.Container,
  mode: FogMode,
  opts: FogLayerOptions,
): FogLayer {
  return mode === 'gpu' ? new GpuFog(scene, root, opts) : new CanvasFog(scene, root, opts);
}

/**
 * 지금 그래픽 상태(품질 · 렌더러 · 백버퍼 배율)로 안개 레이어가 쓸 맵 그림을 미리 굽는다 (로비 대기 중에 부르면 판 시작 때
 * 굽지 않는다). 안개 레이어를 만들 때와 같은 배율 · 발광 방식을 고른다. 걸린 시간(ms)을 돌려준다
 */
export function prebakeFogArt(renderer: RendererKind = gfxState.renderer): number {
  const t0 = performance.now();
  const preset = effectivePreset(gfxState.quality, renderer, gfxState.touch);
  const path = fogPathFor(preset, renderer);
  const s = compositeScaleFor(gfxState.zoom, preset.compositeCap);
  if (path.mode === 'gpu') {
    const sprite = preset.glow === 'sprite';
    const need = [
      { scale: MAP_SCALE * s, withGlow: !sprite },
      { scale: preset.lightPxPerTile / TILE_PX, withGlow: true },
    ];
    for (const n of need) getStaticMap(n.scale, n.withGlow);
    if (sprite) getGlowMap();
    keepStaticMaps(need, sprite);
  } else {
    getStaticMap(MAP_SCALE * s, true);
    keepStaticMaps([{ scale: MAP_SCALE * s, withGlow: true }], false);
  }
  return performance.now() - t0;
}

/** Canvas2D 한 장 합성 (품질 낮음 · Canvas 렌더러) */
export class CanvasFog implements FogLayer {
  readonly mode = 'canvas' as const;
  readonly shader = false;
  private readonly base: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** 합성 배율로 직접 그린 정적 맵 (1:1로 복사한다) */
  private readonly staticMap: HTMLCanvasElement;
  private readonly light: LightMap | null;
  private readonly pen: CanvasPen;
  /** 이번 주기의 바닥 명령 (거점 · 탈출구 · 시야 채움, 그린 순서대로)과 빛 명령 */
  private rec = new PenRecord();
  private readonly lightRec = new LightRecord();
  /**
   * 마지막으로 합성한 바닥 명령 (null = 아직 없음 — 첫 주기는 늘 합성한다). 합성하면 rec과 맞바꾼다:
   * 주기마다 기록을 복사하지 않는다 (렌더링 최적화 2)
   */
  private last: PenRecord | null = null;
  /** 테두리 리프트 (곱하기 뒤 더하기) */
  private readonly lift: Path2D;
  private readonly key: string;
  private readonly texture: Phaser.Textures.Texture;
  private readonly image: Phaser.GameObjects.Image;
  lastCommitMs = 0;
  changed = true;
  private t0 = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
    opts: FogLayerOptions,
  ) {
    const s = opts.compositeScale;
    // 합성 배율로 직접 구운 정적 맵 (발광 번짐 포함, 같은 배율이면 캐시). 1:1로 복사한다.
    // 캐시는 이 한 장만 남긴다 (미니맵은 합성 캔버스를 줄여 쓰고, 발광은 구워 넣었으니 따로 들고 있지 않는다)
    this.staticMap = getStaticMap(MAP_SCALE * s, true);
    keepStaticMaps([{ scale: MAP_SCALE * s, withGlow: true }], false);
    this.lift = rimLiftPath(TILE_PX * MAP_SCALE * s);
    gfxState.features.glowLayer = 'static';
    resetExitTracking();
    this.base = document.createElement('canvas');
    this.base.width = this.staticMap.width;
    this.base.height = this.staticMap.height;
    const ctx = this.base.getContext('2d');
    if (!ctx) throw new Error('바닥 합성 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    this.pen = new CanvasPen(ctx, TILE_PX * MAP_SCALE * s, s);
    this.light = opts.fog ? new LightMap(opts.lightPxPerTile, opts.ambientCss, domLightSurface) : null;
    this.key = nextFogKey('fog-base');
    // 안개 주기마다 다시 그리므로 addCanvas의 생성자 사본(getImageData)은 바로 쓸모없어진다 → 사본 없이 올린다
    this.texture = createCanvasTexture(scene.textures, this.key, this.base);
    // 합성 배율 = 백버퍼 배율이면 텍스처 1텍셀 = 기기 1px (위치도 기기 픽셀 정수로)
    this.image = scene.make
      .image({ x: snapToDevice(MAP_X, opts.zoom), y: snapToDevice(MAP_Y, opts.zoom), key: this.key }, false)
      .setOrigin(0, 0)
      .setScale(1 / s);
    root.add(this.image);
    this.begin();
    this.commit();
  }

  get miniSource(): HTMLCanvasElement {
    return this.base;
  }

  /**
   * 안개 주기 시작. 바닥 · 빛 명령은 기록만 하고 commit에서 지난번과 견줘, 같으면 합성도 업로드도 하지 않는다
   * (M12 휴대폰 성능: 품질 낮음 = 저사양 휴대폰의 가장 비싼 일이 이 전체 합성 + 통째 업로드다). 바뀌었으면 정적 맵 →
   * 기록한 명령 → 빛 곱하기 → 테두리 리프트로 바로 칠하던 때와 같은 그림을 만든다
   */
  begin(): void {
    this.t0 = performance.now();
    this.rec.reset();
    this.lightRec.reset();
  }

  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    this.rec.fillPoly(poly, color, alpha);
  }

  drawPoints(points: readonly PointView[], balance: Balance): void {
    paintPoints(this.rec, points, balance);
  }

  drawExits(exits: readonly ExitView[], balance: Balance): void {
    paintExits(this.rec, exits, balance);
  }

  addSoftLight(light: SoftLight): void {
    if (this.light) this.lightRec.addSoft(light);
  }

  addHardLight(poly: readonly Vec2[]): void {
    if (this.light) this.lightRec.addHard(poly);
  }

  commit(): void {
    const lightChanged = this.light !== null && this.lightRec.paint(this.light);
    const last = this.last;
    this.changed = lightChanged || last === null || !this.rec.sameAs(last.ops);
    if (this.changed) {
      const c = this.ctx;
      c.globalCompositeOperation = 'source-over';
      c.drawImage(this.staticMap, 0, 0);
      this.rec.replay(this.pen);
      if (this.light) {
        c.save();
        c.globalCompositeOperation = 'multiply';
        c.imageSmoothingEnabled = true;
        c.drawImage(this.light.canvas, 0, 0, this.base.width, this.base.height);
        c.restore();
      }
      addRimLift(c, this.lift);
      uploadCanvasTexture(this.texture);
      this.last = this.rec;
      this.rec = last ?? new PenRecord();
    } else {
      gfxState.features.fogSkips = Number(gfxState.features.fogSkips ?? 0) + 1;
    }
    const n = countGraphicsCmds(this.root.list);
    gfxState.features.mapGfxCmds = n.cmds;
    gfxState.features.mapLayerObjects = n.objects;
    this.lastCommitMs = performance.now() - this.t0;
    recordFogCommit(this.lastCommitMs);
  }

  destroy(): void {
    this.image.destroy();
    removeCanvasTexture(this.scene.textures, this.key);
  }
}
