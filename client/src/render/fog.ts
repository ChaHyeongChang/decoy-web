// 안개: Canvas2D로 "빛 지도"를 그리고 곱하기(MULTIPLY) 블렌드로 월드 위에 덮는다.
// 빛 지도는 검정 바탕에 시야 다각형을 흰색으로 'lighten'(최댓값) 합성한다.
// 그래서 세 생존자의 시야가 겹쳐도 밝기가 누적되지 않는다. 생존자 시야는 반경 안쪽 1.2타일을
// 부드럽게 흐리고(밝게 그린 곳 ⊆ 판정 영역), 괴물 부채꼴은 판정과 같은 모양으로 딱 자른다.
import Phaser from 'phaser';
import { MAP_H, MAP_W, TILE_PX, type Vec2 } from '@decoy/shared';

/** 빛 지도 해상도 (타일당 픽셀) */
const FOG_PX_PER_TILE = 16;

export interface SoftLight {
  poly: readonly Vec2[];
  center: Vec2;
  radius: number;
  soft: number;
}

export class FogLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.CanvasTexture;
  readonly image: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, key = 'fog') {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_W * FOG_PX_PER_TILE;
    this.canvas.height = MAP_H * FOG_PX_PER_TILE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.addCanvas(key, this.canvas);
    if (!tex) throw new Error('안개 텍스처를 만들 수 없습니다');
    this.texture = tex;
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0);
    this.image.setScale(TILE_PX / FOG_PX_PER_TILE);
    this.image.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.clear();
    this.commit();
  }

  /** 전부 어둡게 */
  clear(): void {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private path(poly: readonly Vec2[]): void {
    const c = this.ctx;
    const k = FOG_PX_PER_TILE;
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

  /** 경계가 부드러운 원형 시야 (반경 안쪽 soft 타일에 걸쳐 흐려진다) */
  addSoft(light: SoftLight): void {
    if (light.poly.length < 3) return;
    const c = this.ctx;
    const k = FOG_PX_PER_TILE;
    const inner = Math.max(0, light.radius - light.soft) * k;
    const outer = light.radius * k;
    const grad = c.createRadialGradient(
      light.center.x * k,
      light.center.y * k,
      inner,
      light.center.x * k,
      light.center.y * k,
      outer,
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#000000');
    c.save();
    c.globalCompositeOperation = 'lighten';
    this.path(light.poly);
    c.fillStyle = grad;
    c.fill();
    c.restore();
  }

  /** 경계가 딱 잘린 시야 (괴물 부채꼴 · 근접 원) */
  addHard(poly: readonly Vec2[]): void {
    if (poly.length < 3) return;
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'lighten';
    this.path(poly);
    c.fillStyle = '#ffffff';
    c.fill();
    c.restore();
  }

  /** 다 그렸으면 텍스처에 반영 */
  commit(): void {
    this.texture.refresh();
  }

  destroy(): void {
    this.image.destroy();
  }
}
