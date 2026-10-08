// 미니맵 (우측 상단). 메인 화면과 같은 정보 규칙: 바닥은 메인 화면의 바닥 합성(안개 포함 — 시야 밖은 어두운
// 구조, 시야 안은 밝게)을 줄여 쓰고, 엔티티는 메인 화면에 실제로 그린 목록만 다시 찍는다. 그래서 메인 화면보다
// 많은 정보가 나올 수 없다. 캔버스는 백버퍼 배율로 그리고 이미지는 1/배율로 표시해 화면에 1:1로 찍힌다.
import Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_CENTER,
  type DrawnEntity,
  type Role,
} from '@decoy/shared';
import { gfxState, onGfxChange } from '../gfx/state';
import { COLOR, ROLE_COLOR } from '../render/colors';
import { minimapScaleFor } from '../render/fogMath';
import { createCanvasTexture, resizeCanvasTexture, uploadCanvasTexture } from '../render/fogPaint';
import { HUD } from './layout';

const MINIMAP_KEY = 'minimap';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.Texture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly frame: Phaser.GameObjects.Graphics;
  readonly w: number;
  readonly h: number;
  drawn: DrawnEntity[] = [];
  /** 캔버스 배율 (백버퍼 px / 논리 px) */
  private scale: number;
  /** 백버퍼 배율이 바뀌어 다음 갱신 때 캔버스 크기를 다시 잡는다 */
  private resizePending = false;

  constructor(scene: Phaser.Scene) {
    this.w = HUD.minimap.w;
    this.h = Math.round((this.w * MAP_H) / MAP_W);
    this.scale = minimapScaleFor(gfxState.zoom);
    gfxState.minimapScale = this.scale;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.w * this.scale);
    this.canvas.height = Math.round(this.h * this.scale);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('미니맵 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    // 이전 판의 같은 키는 지우고, getImageData 사본을 만드는 addCanvas 대신 사본 없이 올린다
    this.texture = createCanvasTexture(scene.textures, MINIMAP_KEY, this.canvas);
    this.frame = scene.add.graphics().setDepth(39);
    this.frame.fillStyle(0x0f1b27, 0.95);
    this.frame.fillRoundedRect(HUD.minimap.x - 6, HUD.minimap.y - 6, this.w + 12, this.h + 12, 8);
    this.frame.lineStyle(2, 0x334155, 1);
    this.frame.strokeRoundedRect(HUD.minimap.x - 6, HUD.minimap.y - 6, this.w + 12, this.h + 12, 8);
    this.image = scene.add
      .image(HUD.minimap.x, HUD.minimap.y, MINIMAP_KEY)
      .setOrigin(0, 0)
      .setDepth(40)
      .setScale(this.w / this.canvas.width, this.h / this.canvas.height);
    this.g = scene.add.graphics().setDepth(41);
    const off = onGfxChange(() => {
      this.resizePending = true;
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }

  /** 백버퍼 배율이 바뀌었으면 캔버스를 그 배율로 다시 잡는다 (다음 바닥 갱신 때 다시 그려진다) */
  private applyScale(): void {
    this.resizePending = false;
    const s = minimapScaleFor(gfxState.zoom);
    gfxState.minimapScale = s;
    if (s === this.scale) return;
    this.scale = s;
    resizeCanvasTexture(
      MINIMAP_KEY,
      this.texture,
      this.canvas,
      Math.round(this.w * s),
      Math.round(this.h * s),
    );
    this.image.setSizeToFrame(this.texture.get());
    this.image.setScale(this.w / this.canvas.width, this.h / this.canvas.height);
  }

  /** 메인 바닥 합성이 갱신될 때 함께 줄여 그린다 */
  refreshBase(base: HTMLCanvasElement): void {
    if (this.resizePending) this.applyScale();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(base, 0, 0, this.canvas.width, this.canvas.height);
    uploadCanvasTexture(this.texture);
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
