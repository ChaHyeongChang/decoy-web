// 화면 연출 (VISUAL_SPEC 4장) 중 화면 좌표로 그리는 것과 월드 후처리 (M10b)
//  - 피격: 화면 가장자리 붉은 플래시 0.2초 (맞은 생존자)
//  - 수감: 감옥으로 페이드 0.5초 (갇힌 생존자, 검정에서 밝아짐)
//  - 기절: 괴물 화면 채도 감소 (기절 동안)
//  - 후처리 (WorldPostFx): 비네트 · 색보정은 구조 레이어(fogRoot: 바닥 · 벽 · 시설 발광)에만 건다.
//    캐릭터 · 범위 · 마커 · 배지 · 글자 · HUD에는 어떤 후처리도 걸지 않는다(정보 우선 R2)
import Phaser from 'phaser';
import type { FxTarget } from '@decoy/shared';
import type { QualityPreset } from '../gfx/presets';
import { gfxState } from '../gfx/state';
import { MAP_RECT, VIEW_H, VIEW_W } from '../ui/layout';
import { POST, vignetteAt } from '../art/fx';
import { createCanvasTexture, removeCanvasTexture } from './fogPaint';

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

/** 돌진 잔상 기본 수명 (보이는 화면, balance monster.dash.duration = 0.25초를 setLife로 넣는다) */
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
  private lifeMs = DASH_GHOST_MS;

  /** 잔상 수명 = 돌진 시간 (balance) */
  setLife(ms: number): void {
    if (ms > 0) this.lifeMs = ms;
  }

  /** 돌진 중인 괴물이 보이는 프레임마다 부른다 */
  sample(x: number, y: number, aim: number, nowMs: number): void {
    if (nowMs - this.lastAt < GHOST_EVERY_MS) return;
    this.lastAt = nowMs;
    this.ghosts.push({ x, y, aim, at: nowMs });
  }

  /** 아직 남은 잔상과 알파 (0~1) */
  live(nowMs: number): { g: Ghost; alpha: number }[] {
    this.ghosts = this.ghosts.filter((g) => nowMs - g.at < this.lifeMs);
    return this.ghosts.map((g) => ({ g, alpha: 1 - (nowMs - g.at) / this.lifeMs }));
  }

  clear(): void {
    this.ghosts = [];
  }
}

// ───────────────────────── 월드 후처리 (비네트 · 색보정) ─────────────────────────

const WORLD_GRADE = 'DecoyWorldGrade';

const WORLD_GRADE_FRAG = `
#define SHADER_NAME DECOY_WORLD_GRADE_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 uHalf;
uniform float uVignette;
uniform float uGrade;
varying vec2 outTexCoord;
void main ()
{
    vec4 c = texture2D(uMainSampler, outTexCoord);
    vec3 rgb = c.rgb;
    float a = max(c.a, 0.0001);
    vec3 straight = rgb / a;
    float L = dot(straight, vec3(0.2126, 0.7152, 0.0722));
    straight = vec3(L) + (straight - vec3(L)) * (1.0 + ${POST.saturation.toFixed(3)} * uGrade);
    straight += vec3(${POST.shadowTone.map((v) => v.toFixed(4)).join(', ')}) * (1.0 - L) * uGrade;
    vec2 n = (outTexCoord - vec2(0.5)) / uHalf;
    float t = clamp((length(n) - ${POST.vignetteStart.toFixed(3)}) / ${(POST.vignetteEnd - POST.vignetteStart).toFixed(4)}, 0.0, 1.0);
    float v = uVignette * t * t * (3.0 - 2.0 * t);
    gl_FragColor = vec4(clamp(straight, 0.0, 1.0) * (1.0 - v) * c.a, c.a);
}
`;

/** 구조 레이어 후처리 파이프라인 (WebGL 전용): 색보정 + 비네트 한 번에 */
class WorldGradePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  vignette = 0;
  grade = 0;

  constructor(game: Phaser.Game) {
    super({ game, name: WORLD_GRADE, fragShader: WORLD_GRADE_FRAG });
  }

  override onDraw(target: Phaser.Renderer.WebGL.RenderTarget): void {
    // 컨테이너 마지막 그림(빛 지도)의 곱하기 섞기가 남아 있으면 결과가 화면 바탕에 곱해진다 → 보통 섞기로 되돌린다
    this.renderer.setBlendMode(Phaser.BlendModes.NORMAL, true);
    this.set2f('uHalf', MAP_RECT.w / 2 / VIEW_W, MAP_RECT.h / 2 / VIEW_H);
    this.set1f('uVignette', this.vignette);
    this.set1f('uGrade', this.grade);
    this.bindAndDraw(target);
  }
}

/**
 * 구조 레이어 후처리. 높음(WebGL) = 셰이더 비네트 + 색보정, 중간(WebGL) = 구운 비네트 오버레이 + 색보정,
 * Canvas 렌더러의 높음 · 중간 = 구운 오버레이만, 낮음 = 없음. 실제로 켠 것을 gfxState.features와 fxTargets에 남긴다
 */
export class WorldPostFx {
  private overlay: Phaser.GameObjects.Image | null = null;
  private overlayKey: string | null = null;
  private piped = false;
  targets: FxTarget[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
  ) {}

  /** 품질 · 렌더러에 맞춰 다시 건다 (안개 레이어를 다시 만든 뒤 부른다: 오버레이를 맨 위로) */
  apply(preset: QualityPreset, fogEdge: boolean): void {
    this.clear();
    const webgl = this.scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
    const effects: string[] = [];
    let vignette: 'postfx' | 'overlay' | 'none' = 'none';
    const grade = webgl && preset.colorGrade;
    const shaderVignette = webgl && preset.vignette === 'postfx';
    if (grade || shaderVignette) {
      const r = this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
      if (!r.pipelines.getPostPipeline(WORLD_GRADE))
        r.pipelines.addPostPipeline(WORLD_GRADE, WorldGradePipeline);
      this.root.setPostPipeline(WORLD_GRADE);
      const p = this.root.getPostPipeline(WORLD_GRADE);
      const pipe = (Array.isArray(p) ? p[0] : p) as WorldGradePipeline | undefined;
      if (pipe) {
        pipe.vignette = shaderVignette ? POST.vignetteMax : 0;
        pipe.grade = grade ? 1 : 0;
        this.piped = true;
        if (shaderVignette) {
          vignette = 'postfx';
          effects.push('vignette');
        }
        if (grade) effects.push('colorGrade');
      }
    }
    if (vignette === 'none' && preset.vignette !== 'none') {
      this.makeOverlay();
      vignette = 'overlay';
      effects.push('vignetteOverlay');
    }
    if (fogEdge) effects.push('fogEdge');
    gfxState.features.vignette = vignette;
    gfxState.features.colorGrade = effects.includes('colorGrade');
    this.targets = effects.length > 0 ? [{ layer: 'map', effects }] : [];
  }

  /** 안개 레이어를 다시 만들면 새 그림이 위에 쌓이므로 오버레이를 맨 위로 */
  raise(): void {
    if (this.overlay) this.root.bringToTop(this.overlay);
  }

  private makeOverlay(): void {
    // 맵 사각형 1/4 해상도 (부드러운 그라디언트라 늘려도 티가 안 난다)
    const w = Math.round(MAP_RECT.w / 4);
    const h = Math.round(MAP_RECT.h / 4);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const a = vignetteAt(((i + 0.5) / w) * 2 - 1, ((j + 0.5) / h) * 2 - 1);
        img.data[(j * w + i) * 4 + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    overlaySeq += 1;
    this.overlayKey = `decoy-vignette-${overlaySeq}`;
    createCanvasTexture(this.scene.textures, this.overlayKey, c);
    this.overlay = this.scene.make
      .image({ x: MAP_RECT.x, y: MAP_RECT.y, key: this.overlayKey }, false)
      .setOrigin(0, 0)
      .setDisplaySize(MAP_RECT.w, MAP_RECT.h);
    this.root.add(this.overlay);
  }

  clear(): void {
    if (this.piped) {
      this.root.resetPostPipeline();
      this.piped = false;
    }
    this.overlay?.destroy();
    this.overlay = null;
    if (this.overlayKey) removeCanvasTexture(this.scene.textures, this.overlayKey);
    this.overlayKey = null;
    this.targets = [];
  }
}

let overlaySeq = 0;
