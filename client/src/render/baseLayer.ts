// 바닥 합성 레이어: 정적 맵 + 거점 · 탈출구 영역 + 시야 원/부채꼴 + 안개를 Canvas2D 한 장에 합성한다.
// 안개 갱신 주기(20~30Hz)에만 다시 그리고, 매 프레임에는 이 한 장만 그린다 (헤드리스 · 저사양 성능).
//
// 안개 원리: 검정 바탕의 "빛 지도"에 시야 다각형을 'lighten'(최댓값)으로 그린 뒤, 바닥 위에
// 'multiply'로 곱한다. 세 생존자의 시야가 겹쳐도 밝기가 누적되지 않는다. 생존자 시야는 반경 안쪽
// 1.2타일을 부드럽게 흐리고(밝게 그린 곳 ⊆ 판정 영역), 괴물 부채꼴은 판정과 같은 모양으로 딱 자른다.
import type Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  TILE_PX,
  type Balance,
  type ExitView,
  type PointView,
  type Vec2,
} from '@decoy/shared';
import { MAP_SCALE, MAP_X, MAP_Y, RENDER_SCALE } from '../ui/layout';
import { COLOR, hex } from './colors';
import { drawStaticMap } from './mapCanvas';

/** 빛 지도 해상도 (타일당 픽셀) */
const LIGHT_PX_PER_TILE = 12;

export interface SoftLight {
  poly: readonly Vec2[];
  center: Vec2;
  radius: number;
  soft: number;
}

function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}

export class BaseLayer {
  private readonly base: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mapScaled: HTMLCanvasElement;
  private readonly light: HTMLCanvasElement;
  private readonly lctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.CanvasTexture;
  readonly image: Phaser.GameObjects.Image;
  /** 화면 픽셀 / 타일 */
  private readonly k: number;

  constructor(
    scene: Phaser.Scene,
    private readonly fog: boolean,
    key = 'base-layer',
  ) {
    // 저사양 모드(RENDER_SCALE < 1)면 합성 캔버스도 그만큼 작게 만든다 (카메라 확대와 상쇄되어 1:1로 그려진다)
    this.k = TILE_PX * MAP_SCALE * RENDER_SCALE;
    const w = Math.round(MAP_W * this.k);
    const h = Math.round(MAP_H * this.k);
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    this.ctx = need2d(this.base);
    // 정적 맵을 화면 크기로 한 번만 축소해 둔다
    this.mapScaled = document.createElement('canvas');
    this.mapScaled.width = w;
    this.mapScaled.height = h;
    const mctx = need2d(this.mapScaled);
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(drawStaticMap(), 0, 0, w, h);
    this.light = document.createElement('canvas');
    this.light.width = MAP_W * LIGHT_PX_PER_TILE;
    this.light.height = MAP_H * LIGHT_PX_PER_TILE;
    this.lctx = need2d(this.light);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.addCanvas(key, this.base);
    if (!tex) throw new Error('바닥 텍스처를 만들 수 없습니다');
    this.texture = tex;
    this.image = scene.add
      .image(MAP_X, MAP_Y, key)
      .setOrigin(0, 0)
      .setScale(1 / RENDER_SCALE);
    this.begin();
    this.commit();
  }

  /** 새 프레임 합성 시작: 바닥을 깔고 빛 지도를 비운다 */
  begin(): void {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(this.mapScaled, 0, 0);
    const l = this.lctx;
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = '#000000';
    l.fillRect(0, 0, this.light.width, this.light.height);
  }

  private polyPath(c: CanvasRenderingContext2D, poly: readonly Vec2[], k: number): void {
    c.beginPath();
    const first = poly[0];
    if (!first) return;
    c.moveTo(first.x * k, first.y * k);
    for (let i = 1; i < poly.length; i += 1) {
      const p = poly[i];
      if (p) c.lineTo(p.x * k, p.y * k);
    }
    c.closePath();
  }

  /** 바닥 위 다각형 채우기 (시야 원 역할색 12%, 부채꼴 등) */
  fillPoly(poly: readonly Vec2[], color: number, alpha: number): void {
    if (poly.length < 3) return;
    this.polyPath(this.ctx, poly, this.k);
    this.ctx.fillStyle = rgba(color, alpha);
    this.ctx.fill();
  }

  /** 거점 영역 + 진행 링 */
  drawPoints(points: readonly PointView[], balance: Balance): void {
    const c = this.ctx;
    const k = this.k;
    const r = balance.capturePoint.radius * k;
    for (const p of points) {
      const pos = CAPTURE_POINTS[p.id];
      c.beginPath();
      c.arc(pos.x * k, pos.y * k, r, 0, Math.PI * 2);
      c.fillStyle = rgba(COLOR.pointRing, p.state === 'done' ? 0.12 : 0.05);
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = rgba(COLOR.pointLine, 0.55);
      c.stroke();
      if (p.progress > 0) {
        c.beginPath();
        c.arc(
          pos.x * k,
          pos.y * k,
          r - 4,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * Math.min(1, p.progress),
        );
        c.lineWidth = 5;
        c.strokeStyle = rgba(COLOR.pointRing, 0.95);
        c.stroke();
      }
    }
  }

  /** 탈출구 영역 (+ 생존자에게는 개방 진행 링) */
  drawExits(exits: readonly ExitView[], balance: Balance): void {
    const c = this.ctx;
    const k = this.k;
    for (const e of exits) {
      const def = EXITS[e.id];
      const color = e.state === 'inactive' ? COLOR.exitInactive : COLOR.exitActive;
      c.beginPath();
      c.arc(def.center.x * k, def.center.y * k, balance.exit.radius * k, 0, Math.PI * 2);
      c.fillStyle = rgba(color, e.state === 'inactive' ? 0.06 : 0.14);
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = rgba(color, 0.5);
      c.stroke();
      if (e.progress !== null && e.progress > 0) {
        c.beginPath();
        c.arc(
          def.center.x * k,
          def.center.y * k,
          balance.exit.radius * k - 3,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * e.progress,
        );
        c.lineWidth = 4;
        c.strokeStyle = hex(COLOR.exitActive);
        c.stroke();
      }
    }
  }

  /** 경계가 부드러운 원형 시야 (반경 안쪽 soft 타일에 걸쳐 흐려진다) */
  addSoftLight(light: SoftLight): void {
    if (!this.fog || light.poly.length < 3) return;
    const l = this.lctx;
    const k = LIGHT_PX_PER_TILE;
    const inner = Math.max(0, light.radius - light.soft) * k;
    const outer = light.radius * k;
    const grad = l.createRadialGradient(
      light.center.x * k,
      light.center.y * k,
      inner,
      light.center.x * k,
      light.center.y * k,
      outer,
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#000000');
    l.save();
    l.globalCompositeOperation = 'lighten';
    this.polyPath(l, light.poly, k);
    l.fillStyle = grad;
    l.fill();
    l.restore();
  }

  /** 경계가 딱 잘린 시야 (괴물 부채꼴 · 근접 원) */
  addHardLight(poly: readonly Vec2[]): void {
    if (!this.fog || poly.length < 3) return;
    const l = this.lctx;
    l.save();
    l.globalCompositeOperation = 'lighten';
    this.polyPath(l, poly, LIGHT_PX_PER_TILE);
    l.fillStyle = '#ffffff';
    l.fill();
    l.restore();
  }

  /** 합성된 바닥 캔버스 (미니맵이 같은 정보로 줄여 그린다) */
  get canvas(): HTMLCanvasElement {
    return this.base;
  }

  /** 안개를 곱하고 텍스처에 반영 */
  commit(): void {
    if (this.fog) {
      const c = this.ctx;
      c.save();
      c.globalCompositeOperation = 'multiply';
      c.imageSmoothingEnabled = true;
      c.drawImage(this.light, 0, 0, this.base.width, this.base.height);
      c.restore();
    }
    this.texture.refresh();
  }

  destroy(): void {
    this.image.destroy();
  }
}

function need2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다');
  return ctx;
}
