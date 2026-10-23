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
import { MAP_H, MAP_W, TILE_PX, type Balance, type ExitView, type PointView, type Vec2 } from '@decoy/shared';
import { bakeStaticMapStep, getStaticMap, keepStaticMaps } from '../art/mapArt';
import { ChunkAtlas, chunkRange } from '../art/mapChunks';
import { effectivePreset, type RendererKind } from '../gfx/presets';
import { gfxState } from '../gfx/state';
import { CAM_ZOOM, MAP_X, MAP_Y, VIEW_TILES_H, VIEW_TILES_W, WORLD_LINE, WORLD_SCALE } from '../ui/layout';
import type { ViewRect } from './camera';
import { GpuFog, PREFETCH_MARGIN } from './fogGpu';
import { cameraCompositeScale, fogPathFor, snapToDevice, type FogMode } from './fogMath';
import { MiniComposite } from './fogMini';
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

/** Canvas 합성 영역의 여유 (타일): 보이는 창 둘레 이만큼을 같이 합성해, 다음 안개 주기 전까지 카메라가 움직여도 빈 곳이 없게 */
export const REGION_MARGIN = 1.5;

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
  /** 미리 구운 정적 맵 조각 아틀라스 (같은 배율 · 창일 때, prebakeFogArt) */
  chunks?: ChunkAtlas;
}

/** 안개 아래 바닥 레이어. 갱신 주기마다 begin → 채우기 · 빛 → commit */
export interface FogLayer {
  readonly mode: FogMode;
  readonly shader: boolean;
  /** 미니맵이 줄여 그릴 합성 캔버스 (맵 전체, 안개 포함) */
  readonly miniSource: HTMLCanvasElement;
  /** 측정: 마지막 합성(begin~commit)에 걸린 시간 (ms) */
  readonly lastCommitMs: number;
  /** 마지막 commit에서 그림이 바뀌었는가 (바뀌지 않았으면 미니맵도 다시 그릴 필요가 없다) */
  readonly changed: boolean;
  /**
   * 보이는 창 (타일, 프레임마다): GPU는 조각 그림을 놓고, Canvas는 다음 합성 영역을 정한다.
   * 창이 이미 합성한 영역 밖으로 나가면 true (그 프레임에 안개 주기를 앞당긴다)
   */
  setView(view: ViewRect): boolean;
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

/** 지금 그래픽 상태의 안개 레이어 값 (레이어를 만들 때와 로비 미리 굽기가 같이 쓴다) */
export function fogArtParams(renderer: RendererKind = gfxState.renderer): {
  mode: FogMode;
  shader: boolean;
  compositeScale: number;
  lightPxPerTile: number;
  /** 정적 맵 조각 px / 타일 */
  k: number;
  /** 조각 아틀라스 여유 (타일) */
  margin: number;
} {
  const preset = effectivePreset(gfxState.quality, renderer, gfxState.touch);
  const path = fogPathFor(preset, renderer);
  const margin = path.mode === 'gpu' ? PREFETCH_MARGIN : REGION_MARGIN;
  const s = cameraCompositeScale(
    gfxState.zoom,
    preset.compositeCap,
    WORLD_SCALE,
    CAM_ZOOM,
    { w: VIEW_TILES_W, h: VIEW_TILES_H },
    margin,
    preset.mapTexels,
  );
  return {
    mode: path.mode,
    shader: path.shader,
    compositeScale: s,
    lightPxPerTile: preset.lightPxPerTile,
    k: TILE_PX * WORLD_SCALE * s,
    margin,
  };
}

/** Canvas 합성 영역이 맵 전체인가 (확대 1: 창 + 여유가 맵보다 크다) */
function wholeRegion(): boolean {
  return (
    Math.ceil(VIEW_TILES_W + REGION_MARGIN * 2) >= MAP_W &&
    Math.ceil(VIEW_TILES_H + REGION_MARGIN * 2) >= MAP_H
  );
}

/** 미리 구운 조각 아틀라스 (판 장면의 안개 레이어가 같은 배율 · 창이면 그대로 쓴다) */
let prebaked: { atlas: ChunkAtlas; key: string } | null = null;

function atlasKey(k: number, margin: number): string {
  return `${k.toFixed(4)}|${VIEW_TILES_W.toFixed(3)}x${VIEW_TILES_H.toFixed(3)}|${margin}`;
}

/** 지금 배율 · 창의 조각 아틀라스 (미리 구운 것이 맞으면 그것, 아니면 새로) */
export function chunkAtlasFor(k: number, margin: number): ChunkAtlas {
  const key = atlasKey(k, margin);
  if (prebaked && prebaked.key === key) return prebaked.atlas;
  const atlas = new ChunkAtlas(k, VIEW_TILES_W, VIEW_TILES_H, margin, true);
  prebaked = { atlas, key };
  return atlas;
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
 * 지금 그래픽 상태(품질 · 렌더러 · 백버퍼 배율 · 확대 수준)로 안개 레이어가 쓸 맵 그림을 미리 굽는 한 걸음 (로비 대기 · 첫 화면의
 * 남는 시간에 budgetMs씩 여러 번 부른다 — 판 시작 때 굽지 않게, 판 중에는 부르지 않는다): 판 배율 맵 전체 그림(띠 몇 개씩) →
 * 미니맵 작은 맵 · 발광 → (GPU) 시작 자리(at) 둘레 창의 조각 아틀라스(맵 전체 그림에서 복사). 다 끝났으면 true
 */
export function prebakeFogStep(
  renderer: RendererKind = gfxState.renderer,
  at: Vec2 | null = null,
  budgetMs = 8,
): boolean {
  const p = fogArtParams(renderer);
  const big = p.k / TILE_PX;
  const mini = p.lightPxPerTile / TILE_PX;
  const whole = p.mode === 'canvas' && wholeRegion();
  // 판에 쓸 두 장만 남긴다 (옛 배율 · 다른 경로의 큰 캔버스를 붙잡지 않게). 발광은 맵 전체 그림이 다 구워질 때까지 쓴다
  keepStaticMaps(
    whole
      ? [{ scale: big, withGlow: true }]
      : [
          { scale: big, withGlow: true },
          { scale: mini, withGlow: true },
        ],
    true,
  );
  if (!bakeStaticMapStep(big, true, budgetMs)) return false;
  if (whole) return true;
  getStaticMap(mini, true);
  if (p.mode !== 'gpu' || !at) return true;
  const atlas = chunkAtlasFor(p.k, p.margin);
  const w = VIEW_TILES_W;
  const h = VIEW_TILES_H;
  const x = Math.max(0, Math.min(MAP_W - w, at.x - w / 2));
  const y = Math.max(0, Math.min(MAP_H - h, at.y - h / 2));
  const r = chunkRange({ x, y, w, h }, 0, atlas.tiles);
  for (let cy = r.cy0; cy <= r.cy1; cy += 1) for (let cx = r.cx0; cx <= r.cx1; cx += 1) atlas.ensure(cx, cy);
  return true;
}

/** 미리 굽기를 한 번에 끝까지 (시험 · 판 장면을 만들 때 아직 덜 구웠으면). 걸린 시간(ms) */
export function prebakeFogArt(renderer: RendererKind = gfxState.renderer, at: Vec2 | null = null): number {
  const t0 = performance.now();
  while (!prebakeFogStep(renderer, at, Infinity));
  return performance.now() - t0;
}

/**
 * Canvas2D 합성 (품질 낮음 · Canvas 렌더러). 보이는 창 + 여유(REGION_MARGIN)의 정수 타일 영역만 한 장에 합성하고 텍스처로
 * 올린다: 정적 맵 조각 → 기록한 바닥 명령 → 빛 곱하기 → 테두리 리프트. 영역 · 명령 · 빛이 지난번과 같으면 합성도 업로드도 하지 않는다
 */
export class CanvasFog implements FogLayer {
  readonly mode = 'canvas' as const;
  readonly shader = false;
  private readonly base: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /**
   * 판 배율 정적 맵 전체 그림 (판 전에 나눠 구운 것, mapArt.bakeStaticMapStep). 합성은 영역만큼 잘라 한 번에 복사한다.
   * 영역이 맵 전체(확대 1)면 미니맵도 합성 캔버스를 그대로 줄여 쓴다(따라가는 카메라 전과 같은 일의 양 — perf-budget 기준값)
   */
  private readonly staticMap: HTMLCanvasElement;
  private readonly whole: boolean;
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
  /** 테두리 리프트 (곱하기 뒤 더하기, 맵 전체 그림 px) */
  private readonly lift: Path2D;
  private readonly key: string;
  private readonly texture: Phaser.Textures.Texture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly mini: MiniComposite | null;
  /** px / 타일 (정적 맵 조각 · 합성) */
  private readonly k: number;
  private readonly s: number;
  private readonly ox: number;
  private readonly oy: number;
  /** 합성 영역 크기 (정수 타일) */
  private readonly rw: number;
  private readonly rh: number;
  /** 다음 합성 영역 왼쪽 위 (정수 타일) · 마지막으로 합성한 영역 */
  private rx = 0;
  private ry = 0;
  private doneX = -1;
  private doneY = -1;
  lastCommitMs = 0;
  changed = true;
  private t0 = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
    opts: FogLayerOptions,
  ) {
    const s = opts.compositeScale;
    this.s = s;
    const k = TILE_PX * WORLD_SCALE * s;
    this.k = k;
    this.rw = Math.min(MAP_W, Math.ceil(VIEW_TILES_W + REGION_MARGIN * 2));
    this.rh = Math.min(MAP_H, Math.ceil(VIEW_TILES_H + REGION_MARGIN * 2));
    const whole = this.rw === MAP_W && this.rh === MAP_H;
    this.whole = whole;
    this.lift = rimLiftPath(k);
    gfxState.features.glowLayer = 'static';
    resetExitTracking();
    this.base = document.createElement('canvas');
    // 판 배율 정적 맵 (발광 포함, 미리 구웠으면 캐시 · 덜 구웠으면 남은 띠를 지금)
    keepStaticMaps(
      whole
        ? [{ scale: k / TILE_PX, withGlow: true }]
        : [
            { scale: k / TILE_PX, withGlow: true },
            { scale: opts.lightPxPerTile / TILE_PX, withGlow: true },
          ],
      false,
    );
    this.staticMap = getStaticMap(k / TILE_PX, true);
    if (whole) {
      this.base.width = this.staticMap.width;
      this.base.height = this.staticMap.height;
    } else {
      this.base.width = Math.ceil(this.rw * k) + 1;
      this.base.height = Math.ceil(this.rh * k) + 1;
    }
    const ctx = this.base.getContext('2d');
    if (!ctx) throw new Error('바닥 합성 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    this.pen = new CanvasPen(ctx, k, s * WORLD_LINE);
    this.light = opts.fog ? new LightMap(opts.lightPxPerTile, opts.ambientCss, domLightSurface) : null;
    this.mini = whole ? null : new MiniComposite(opts.lightPxPerTile, this.light);
    this.key = nextFogKey('fog-base');
    // 안개 주기마다 다시 그리므로 addCanvas의 생성자 사본(getImageData)은 바로 쓸모없어진다 → 사본 없이 올린다
    this.texture = createCanvasTexture(scene.textures, this.key, this.base);
    // 합성 배율 = 백버퍼 배율이면 텍스처 1텍셀 = 기기 1px (위치도 기기 픽셀 정수로)
    this.ox = snapToDevice(MAP_X, opts.zoom);
    this.oy = snapToDevice(MAP_Y, opts.zoom);
    this.image = scene.make
      .image({ x: this.ox, y: this.oy, key: this.key }, false)
      .setOrigin(0, 0)
      .setScale(1 / s);
    root.add(this.image);
    this.begin();
    this.commit();
  }

  get miniSource(): HTMLCanvasElement {
    return this.mini ? this.mini.canvas : this.base;
  }

  setView(view: ViewRect): boolean {
    const m = REGION_MARGIN;
    const x = Math.max(0, Math.min(MAP_W - this.rw, Math.floor(view.x - m + 0.5)));
    const y = Math.max(0, Math.min(MAP_H - this.rh, Math.floor(view.y - m + 0.5)));
    this.rx = x;
    this.ry = y;
    // 합성한 영역이 창을 다 덮는가 (덮지 않으면 이번 프레임에 안개 주기를 앞당긴다)
    const covers =
      this.doneX >= 0 &&
      view.x >= this.doneX - 1e-6 &&
      view.y >= this.doneY - 1e-6 &&
      Math.min(view.x + view.w, MAP_W) <= this.doneX + this.rw + 1e-6 &&
      Math.min(view.y + view.h, MAP_H) <= this.doneY + this.rh + 1e-6;
    return !covers;
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
    const moved = this.rx !== this.doneX || this.ry !== this.doneY;
    const recChanged = last === null || !this.rec.same(last);
    this.changed = lightChanged || recChanged || moved;
    if (this.changed) {
      const c = this.ctx;
      const k = this.k;
      const x0 = Math.round(this.rx * k);
      const y0 = Math.round(this.ry * k);
      c.setTransform(1, 0, 0, 1, -x0, -y0);
      c.globalCompositeOperation = 'source-over';
      // 정적 맵: 영역만큼 잘라 한 번에 복사 (맵 전체면 통째로)
      const st = this.staticMap;
      if (this.whole) c.drawImage(st, 0, 0);
      else {
        const w = Math.min(this.base.width, st.width - x0);
        const h = Math.min(this.base.height, st.height - y0);
        if (w > 0 && h > 0) c.drawImage(st, x0, y0, w, h, x0, y0, w, h);
      }
      this.rec.replay(this.pen);
      if (this.light) {
        const l = this.light;
        const lk = l.k;
        c.save();
        c.globalCompositeOperation = 'multiply';
        c.imageSmoothingEnabled = true;
        if (this.whole) {
          c.drawImage(l.canvas, 0, 0, this.base.width, this.base.height);
        } else {
          c.drawImage(
            l.canvas,
            this.rx * lk,
            this.ry * lk,
            this.rw * lk,
            this.rh * lk,
            this.rx * k,
            this.ry * k,
            this.rw * k,
            this.rh * k,
          );
        }
        c.restore();
      }
      addRimLift(c, this.lift);
      c.setTransform(1, 0, 0, 1, 0, 0);
      uploadCanvasTexture(this.texture);
      this.image.setPosition(this.ox + x0 / this.s, this.oy + y0 / this.s);
      this.doneX = this.rx;
      this.doneY = this.ry;
      if (lightChanged || recChanged) {
        this.last = this.rec;
        this.rec = last ?? new PenRecord();
        this.mini?.take(this.last);
      }
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
