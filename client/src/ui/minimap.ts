// 미니맵 (우측 상단). 메인 화면과 같은 정보 규칙: 바닥은 메인 화면의 합성 캔버스(안개 포함)를 줄여 쓰고,
// 엔티티는 메인 화면에 실제로 그린 목록만 다시 찍는다. 그래서 메인 화면보다 많은 정보가 나올 수 없다.
import type Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_CENTER,
  type DrawnEntity,
  type Role,
} from '@decoy/shared';
import { COLOR, ROLE_COLOR } from '../render/colors';
import { HUD } from './layout';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly frame: Phaser.GameObjects.Graphics;
  readonly w: number;
  readonly h: number;
  drawn: DrawnEntity[] = [];

  constructor(scene: Phaser.Scene) {
    this.w = HUD.minimap.w;
    this.h = Math.round((this.w * MAP_H) / MAP_W);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('미니맵 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    if (scene.textures.exists('minimap')) scene.textures.remove('minimap');
    const tex = scene.textures.addCanvas('minimap', this.canvas);
    if (!tex) throw new Error('미니맵 텍스처를 만들 수 없습니다');
    this.texture = tex;
    this.frame = scene.add.graphics().setDepth(39);
    this.frame.fillStyle(0x0f1b27, 0.95);
    this.frame.fillRoundedRect(HUD.minimap.x - 6, HUD.minimap.y - 6, this.w + 12, this.h + 12, 8);
    this.frame.lineStyle(2, 0x334155, 1);
    this.frame.strokeRoundedRect(HUD.minimap.x - 6, HUD.minimap.y - 6, this.w + 12, this.h + 12, 8);
    this.image = scene.add.image(HUD.minimap.x, HUD.minimap.y, 'minimap').setOrigin(0, 0).setDepth(40);
    this.g = scene.add.graphics().setDepth(41);
  }

  /** 메인 바닥 합성이 갱신될 때 함께 줄여 그린다 */
  refreshBase(base: HTMLCanvasElement): void {
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(base, 0, 0, this.w, this.h);
    this.texture.refresh();
  }

  private px(x: number): number {
    return HUD.minimap.x + (x / MAP_W) * this.w;
  }

  private py(y: number): number {
    return HUD.minimap.y + (y / MAP_H) * this.h;
  }

  /** 메인 화면에 그린 엔티티만 다시 찍는다 */
  update(mainDrawn: readonly DrawnEntity[], myRole: Role, roleOf: (id: string) => Role | null): void {
    const g = this.g;
    g.clear();
    // 항상 표시 위치: 거점 · 감옥 · 탈출구
    g.lineStyle(1, COLOR.pointLine, 0.9);
    for (const p of Object.values(CAPTURE_POINTS)) g.strokeCircle(this.px(p.x), this.py(p.y), 4);
    g.fillStyle(COLOR.prison, 0.9);
    g.fillRect(this.px(PRISON_CENTER.x) - 3, this.py(PRISON_CENTER.y) - 3, 6, 6);
    g.fillStyle(COLOR.exitActive, 0.9);
    for (const e of Object.values(EXITS)) g.fillRect(this.px(e.center.x) - 4, this.py(e.center.y) - 2, 8, 4);
    const out: DrawnEntity[] = [];
    for (const d of mainDrawn) {
      if (d.layer === 'minimap') continue;
      let color: number = COLOR.hiddenSurvivor;
      if (d.kind === 'monster') color = COLOR.monster;
      else if (d.kind === 'self') color = ROLE_COLOR[myRole];
      else if (d.kind === 'mark')
        color = d.tag === 'track' ? COLOR.scout : d.tag === 'roarSelf' ? COLOR.warn : COLOR.white;
      else if (myRole !== 'monster') {
        const r = roleOf(d.id);
        if (r) color = ROLE_COLOR[r];
      }
      g.fillStyle(color, 1);
      if (d.kind === 'monster' || (d.kind === 'self' && myRole === 'monster'))
        g.fillTriangle(
          this.px(d.x),
          this.py(d.y) - 4,
          this.px(d.x) - 4,
          this.py(d.y) + 3,
          this.px(d.x) + 4,
          this.py(d.y) + 3,
        );
      else g.fillCircle(this.px(d.x), this.py(d.y), d.kind === 'mark' ? 2.5 : 3);
      out.push({ ...d, layer: 'minimap' });
    }
    this.drawn = out;
  }

  destroy(): void {
    this.image.destroy();
    this.g.destroy();
    this.frame.destroy();
  }
}
