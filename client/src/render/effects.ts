// 화면 연출 (VISUAL_SPEC 4장) 중 화면 좌표로 그리는 것
//  - 피격: 화면 가장자리 붉은 플래시 0.2초 (맞은 생존자)
//  - 수감: 감옥으로 페이드 0.5초 (갇힌 생존자, 검정에서 밝아짐)
//  - 기절: 괴물 화면 채도 감소 (기절 동안)
import Phaser from 'phaser';
import { MAP_RECT, VIEW_H, VIEW_W } from '../ui/layout';

export const HIT_FLASH_MS = 200;
export const IMPRISON_FADE_MS = 500;
const EDGE_RED = 0xdc2626;
const EDGE_BANDS = 7;
const EDGE_BAND_PX = 11;

export interface ScreenEffectState {
  /** 피격 플래시 세기 0~1 */
  hitFlash: number;
  /** 수감 페이드 검정 알파 0~1 */
  fade: number;
  /** 채도 감소 중 */
  desaturate: boolean;
}

export class ScreenEffects {
  private readonly edge: Phaser.GameObjects.Graphics;
  private readonly fadeRect: Phaser.GameObjects.Rectangle;
  private readonly desat: Phaser.GameObjects.Rectangle;
  private hitAt = -1e9;
  private fadeAt = -1e9;
  private lastEdgeAlpha = -1;
  state: ScreenEffectState = { hitFlash: 0, fade: 0, desaturate: false };

  constructor(scene: Phaser.Scene, canvasRenderer: boolean) {
    // 채도 감소: Canvas는 'saturation' 합성(회색을 덮으면 색조 · 밝기는 두고 채도만 뺀다),
    // WebGL은 그 합성이 없어 반투명 회색을 덮는다. 맵 영역만 (HUD는 그대로 읽히게)
    this.desat = scene.add
      .rectangle(MAP_RECT.x, MAP_RECT.y, MAP_RECT.w, MAP_RECT.h, canvasRenderer ? 0x808080 : 0x4b5563)
      .setOrigin(0, 0)
      .setDepth(30)
      .setAlpha(canvasRenderer ? 0.85 : 0.38)
      .setVisible(false);
    if (canvasRenderer) this.desat.setBlendMode(Phaser.BlendModes.SATURATION);
    this.edge = scene.add.graphics().setDepth(52);
    this.fadeRect = scene.add
      .rectangle(0, 0, VIEW_W, VIEW_H, 0x000000)
      .setOrigin(0, 0)
      .setDepth(55)
      .setAlpha(0)
      .setVisible(false);
  }

  hit(nowMs: number): void {
    this.hitAt = nowMs;
  }

  imprison(nowMs: number): void {
    this.fadeAt = nowMs;
  }

  update(nowMs: number, desaturate: boolean): void {
    // 피격: 0.2초 동안 선형으로 사라진다
    const hk = Math.max(0, 1 - (nowMs - this.hitAt) / HIT_FLASH_MS);
    const edgeAlpha = Math.round(hk * 50) / 50;
    if (edgeAlpha !== this.lastEdgeAlpha) {
      this.lastEdgeAlpha = edgeAlpha;
      this.edge.clear();
      if (edgeAlpha > 0) {
        // 바깥이 진하고 안쪽으로 옅어지는 띠 여러 겹
        for (let i = 0; i < EDGE_BANDS; i += 1) {
          const a = edgeAlpha * 0.85 * (1 - i / EDGE_BANDS);
          const inset = i * EDGE_BAND_PX + EDGE_BAND_PX / 2;
          this.edge.lineStyle(EDGE_BAND_PX, EDGE_RED, a);
          this.edge.strokeRect(inset, inset, VIEW_W - inset * 2, VIEW_H - inset * 2);
        }
      }
    }
    // 수감: 검정에서 0.5초에 걸쳐 밝아진다 (서버가 위치를 감옥으로 옮긴 바로 그 화면부터)
    const fk = Math.max(0, 1 - (nowMs - this.fadeAt) / IMPRISON_FADE_MS);
    this.fadeRect.setVisible(fk > 0).setAlpha(fk);
    this.desat.setVisible(desaturate);
    this.state = { hitFlash: hk, fade: fk, desaturate };
  }
}

/** 돌진 잔상 (보이는 화면에서 0.25초) */
export const DASH_GHOST_MS = 250;
const GHOST_EVERY_MS = 28;

export interface Ghost {
  x: number;
  y: number;
  aim: number;
  at: number;
}

export class DashTrail {
  private ghosts: Ghost[] = [];
  private lastAt = -1e9;

  /** 돌진 중인 괴물이 보이는 프레임마다 부른다 */
  sample(x: number, y: number, aim: number, nowMs: number): void {
    if (nowMs - this.lastAt < GHOST_EVERY_MS) return;
    this.lastAt = nowMs;
    this.ghosts.push({ x, y, aim, at: nowMs });
  }

  /** 아직 남은 잔상과 알파 (0~1) */
  live(nowMs: number): { g: Ghost; alpha: number }[] {
    this.ghosts = this.ghosts.filter((g) => nowMs - g.at < DASH_GHOST_MS);
    return this.ghosts.map((g) => ({ g, alpha: 1 - (nowMs - g.at) / DASH_GHOST_MS }));
  }

  clear(): void {
    this.ghosts = [];
  }
}
