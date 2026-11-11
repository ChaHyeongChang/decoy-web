// 화면 연출 (VISUAL_SPEC 6.2 · 7.2) 중 화면 좌표로 그리는 것과 월드 후처리 (M10b)
//  - 피격: 화면 가장자리 붉은 플래시 0.2초 (맞은 생존자). 번쩍임 줄이기(설정)면 옅게 · 서서히 (prefsFx.hitFlashLevel)
//  - 수감: 감옥으로 페이드 0.5초 (갇힌 생존자, 검정에서 밝아짐). 검정은 IMPRISON_RISE_MS에 걸쳐 오른다 — 같은 스냅샷 피격의 붉은
//    가장자리(깊이 52)가 암전(55)에 덮이기 전에 먼저 읽히게 (플레이테스트 반영 c 손맛)
//  - 구조 완료: 화면 가장자리 안쪽 가는 청록 선 0.3초 (생존자 화면). 번쩍임 줄이기면 피격 가장자리와 같은 방식(0.35배 · 60ms 상승)
//  - 기절: 괴물 화면 채도 감소 (기절 동안). 맵(구조 레이어) 바로 위 · 배지와 캐릭터 아래의 막(WorldRenderer.stunVeil)이라
//    캐릭터 · 노출 링 · 범위 · 마커를 덮지 않는다. 두 렌더러가 같은 방식(보통 섞기 회색 막)이다
//  - 후처리 (WorldPostFx): 비네트 · 색보정은 구조 레이어(fogRoot: 바닥 · 벽 · 시설 발광)에만 건다.
//    캐릭터 · 범위 · 마커 · 배지 · 글자 · HUD에는 어떤 후처리도 걸지 않는다(정보 우선 R2)
//  - 후처리가 실제로 어디에 걸렸는지(collectFxTargets)는 자기 신고가 아니라 장면 표시 목록 · 카메라에서 모은다
import Phaser from 'phaser';
import type { FxTarget, LayerName } from '@decoy/shared';
import type { QualityPreset } from '../gfx/presets';
import { gfxState } from '../gfx/state';
import { MAP_RECT, VIEW_H, VIEW_W } from '../ui/layout';
import { POST, vignetteAt } from '../art/fx';
import { DEPTH_SINK } from '../gfx/depth';
import { createCanvasTexture, removeCanvasTexture } from './fogPaint';
import { FOG_EDGE_PIPELINE, FOG_FOLLOW_PIPELINE } from './fogGpu';
import { RESCUE_RIM, hitFlashLevel, imprisonFadeLevel } from './prefsFx';

export const HIT_FLASH_MS = 200;
const EDGE_RED = 0xdc2626;
const EDGE_BANDS = 7;
const EDGE_BAND_PX = 11;

export interface ScreenEffectState {
  /** 피격 플래시 세기 0~1 */
  hitFlash: number;
  /** 수감 페이드 검정 알파 0~1 */
  fade: number;
  /** 구조 완료 청록 가장자리 세기 0~1 */
  rescueRim: number;
  /** 채도 감소 중 */
  desaturate: boolean;
}

/**
 * 기절 채도 감소 막 (괴물 화면, 기절 동안): 맵 위를 반투명 회색으로 덮어 채도 · 밝기를 낮춘다. 두 렌더러가 같은 값이다
 * (Canvas의 'saturation' 합성은 Phaser가 부팅 때 지원 여부를 보고 'source-over'로 떨어뜨려 85% 회색 막이 됐다)
 */
export const STUN_VEIL = { color: 0x4b5563, alpha: 0.38 } as const;

/** 채도 감소 막 (WorldRenderer.stunVeil: 월드 컨테이너 맨 아래) */
export interface VeilLike {
  setVisible(on: boolean): unknown;
}

export class ScreenEffects {
  private readonly edge: Phaser.GameObjects.Graphics;
  private readonly rim: Phaser.GameObjects.Graphics;
  private readonly fadeRect: Phaser.GameObjects.Rectangle;
  private hitAt = -1e9;
  private fadeAt = -1e9;
  private rescueAt = -1e9;
  private lastEdgeAlpha = -1;
  private lastRimAlpha = 0;
  /** 번쩍임 줄이기 (설정 화면 '화면' 탭): 피격 가장자리를 옅게 · 서서히 (판 장면이 설정을 따라 바꾼다) */
  reduceFlash = false;
  state: ScreenEffectState = { hitFlash: 0, fade: 0, rescueRim: 0, desaturate: false };

  /** veil = 맵 바로 위 · 배지와 캐릭터 아래의 채도 감소 막 */
  constructor(
    scene: Phaser.Scene,
    private readonly veil: VeilLike,
  ) {
    this.edge = scene.add.graphics().setDepth(52);
    // 비워 둔다: 새 Graphics는 기본 스타일 명령을 들고 있어 비어 있어도 프레임마다 그린다
    this.rim = scene.add.graphics().setDepth(52).clear();
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

  rescue(nowMs: number): void {
    this.rescueAt = nowMs;
  }

  update(nowMs: number, desaturate: boolean): void {
    // 피격: 0.2초 동안 선형으로 사라진다 (번쩍임 줄이기: 0.35배까지 서서히 올랐다가 같은 0.2초에 사라진다)
    const hk = hitFlashLevel(nowMs - this.hitAt, HIT_FLASH_MS, this.reduceFlash);
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
    // 구조 완료: 가장자리 안쪽 가는 청록 선 (세기가 바뀐 프레임에만 다시 그린다)
    const rk = hitFlashLevel(nowMs - this.rescueAt, RESCUE_RIM.ms, this.reduceFlash);
    const rimAlpha = Math.round(rk * 50) / 50;
    if (rimAlpha !== this.lastRimAlpha) {
      this.lastRimAlpha = rimAlpha;
      this.rim.clear();
      if (rimAlpha > 0) {
        const R = RESCUE_RIM;
        this.rim.lineStyle(R.width, R.color, R.alpha * rimAlpha);
        this.rim.strokeRect(R.inset, R.inset, VIEW_W - R.inset * 2, VIEW_H - R.inset * 2);
      }
    }
    // 수감: 검정이 IMPRISON_RISE_MS에 오른 뒤 0.5초에 걸쳐 밝아진다 (서버가 위치를 감옥으로 옮긴 바로 그 화면부터)
    const fk = imprisonFadeLevel(nowMs - this.fadeAt);
    this.fadeRect.setVisible(fk > 0).setAlpha(fk);
    this.veil.setVisible(desaturate);
    this.state = { hitFlash: hk, fade: fk, rescueRim: rk, desaturate };
  }

  /** 화면 효과 레이어의 표시 객체 (후처리 검사의 레이어 이름 'screen') */
  owns(obj: Phaser.GameObjects.GameObject): boolean {
    return obj === this.edge || obj === this.rim || obj === this.fadeRect;
  }
}

// ───────────────────────── 월드 후처리 (비네트 · 색보정) ─────────────────────────

const WORLD_GRADE = 'DecoyWorldGrade';

/**
 * 구조 레이어 후처리 셰이더: 색보정(채도 · 그늘 색) + 비네트 + 입체감(uDepth > 0일 때만, VISUAL_SPEC 14장).
 * 입체감: 내 캐릭터 화면 자리(uLantern.xy, 논리 px)에서 멀수록 어둡게(등불 감쇠, 시야 반경 안쪽 uLantern.z → 바깥 uLantern.w에서
 * uLanternMin), 가운데 따뜻한 빛(uWarm), 어두운 화소를 더 가라앉히기(uCrush — 밝은 화소 · 테두리는 그대로라 어둠 속 구조 대비는
 * 오른다), 괴물 화면 붉은 기운(uRed). 모두 '어둡게 · 색을 기울이게'만 해서 시야 밖을 밝히지 않는다. 캐릭터 · 정보에는 걸리지 않는다(R2)
 */
const WORLD_GRADE_FRAG = `
#define SHADER_NAME DECOY_WORLD_GRADE_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 uHalf;
uniform float uVignette;
uniform float uGrade;
uniform float uDepth;
uniform vec2 uView;
uniform vec4 uLantern;
uniform float uLanternMin;
uniform vec3 uWarm;
uniform float uCrush;
uniform float uRed;
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
    if (uDepth > 0.5)
    {
        // 거리는 바깥 반경(uLantern.w)으로 나눈 비율로 잰다: 논리 px 그대로 제곱하면 mediump가 fp16인 GPU에서 약 256px부터 넘친다
        vec2 dn = (vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uView - uLantern.xy) / uLantern.w;
        float lt = smoothstep(uLantern.z / uLantern.w, 1.0, length(dn));
        float sink = 1.0 - uCrush * (1.0 - smoothstep(${DEPTH_SINK.lo.toFixed(3)}, ${DEPTH_SINK.hi.toFixed(3)}, L));
        straight *= mix(1.0, uLanternMin, lt) * sink;
        straight *= mix(vec3(1.0), uWarm, 1.0 - lt);
        float redK = uRed * (1.0 - smoothstep(0.0, ${DEPTH_SINK.redHi.toFixed(3)}, L));
        straight *= vec3(1.0, 1.0 - ${DEPTH_SINK.redG.toFixed(3)} * redK, 1.0 - ${DEPTH_SINK.redB.toFixed(3)} * redK);
        straight = mix(straight, straight * vec3(1.0, 0.55, 0.55), v * uRed * 2.0);
    }
    gl_FragColor = vec4(clamp(straight, 0.0, 1.0) * (1.0 - v) * c.a, c.a);
}
`;

/** 입체감 후처리 값 (WorldPostFx.setDepth — 프레임마다). on = 거짓이면 셰이더가 입체감 줄을 건너뛴다 */
export interface DepthGrade {
  on: boolean;
  /** 내 캐릭터 화면 자리 (논리 px, 화면 VIEW 좌표) · 등불 감쇠 시작 · 끝 반경 (논리 px) */
  x: number;
  y: number;
  r0: number;
  r1: number;
  lanternMin: number;
  /** 등불 가운데 색 배율 (1, 1, 1 = 없음, 1 이하 — 밝히지 않는다) */
  warm: readonly [number, number, number];
  crush: number;
  /** 괴물 화면 붉은 기운 (생존자 화면 0) */
  red: number;
  /** 품질 높음 셰이더 비네트 세기 (입체감이 켜져 있으면 이 값, 꺼져 있으면 POST.vignetteMax) */
  vignette: number;
}

/** 구조 레이어 후처리 파이프라인 (WebGL 전용): 색보정 + 비네트 (+ 입체감) 한 번에 */
class WorldGradePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  vignette = 0;
  grade = 0;
  /** 셰이더 비네트를 켰는가 (품질 높음) — 입체감 비네트 세기는 이때만 쓴다 */
  shaderVignette = false;
  readonly depth: DepthGrade = {
    on: false,
    x: 0,
    y: 0,
    r0: 1,
    r1: 2,
    lanternMin: 1,
    warm: [1, 1, 1],
    crush: 0,
    red: 0,
    vignette: 0,
  };

  constructor(game: Phaser.Game) {
    super({ game, name: WORLD_GRADE, fragShader: WORLD_GRADE_FRAG });
  }

  override onDraw(target: Phaser.Renderer.WebGL.RenderTarget): void {
    // 컨테이너 마지막 그림(빛 지도)의 곱하기 섞기가 남아 있으면 결과가 화면 바탕에 곱해진다 → 보통 섞기로 되돌린다
    this.renderer.setBlendMode(Phaser.BlendModes.NORMAL, true);
    this.set2f('uHalf', MAP_RECT.w / 2 / VIEW_W, MAP_RECT.h / 2 / VIEW_H);
    const d = this.depth;
    const vig = this.shaderVignette ? (d.on ? d.vignette : this.vignette) : 0;
    this.set1f('uVignette', vig);
    this.set1f('uGrade', this.grade);
    this.set1f('uDepth', d.on ? 1 : 0);
    this.set2f('uView', VIEW_W, VIEW_H);
    this.set4f('uLantern', d.x, d.y, d.r0, d.r1);
    this.set1f('uLanternMin', d.lanternMin);
    this.set3f('uWarm', d.warm[0], d.warm[1], d.warm[2]);
    this.set1f('uCrush', d.crush);
    this.set1f('uRed', d.red);
    this.bindAndDraw(target);
  }
}

/**
 * 구조 레이어 후처리. 높음(WebGL) = 셰이더 비네트 + 색보정, 중간(WebGL) = 구운 비네트 오버레이 + 색보정,
 * Canvas 렌더러의 높음 · 중간 = 구운 오버레이만, 낮음 = 없음. 켠 것을 gfxState.features에 남기고(어디에 걸렸는지는
 * collectFxTargets가 표시 목록에서 직접 모은다), 파이프라인 렌더 타깃 바이트를 features.postFxBytes에 기록한다
 */
export class WorldPostFx {
  private overlay: Phaser.GameObjects.Image | null = null;
  private overlayKey: string | null = null;
  private piped = false;
  /** 걸린 후처리 파이프라인 (입체감 값을 프레임마다 쓴다, 없으면 null — Canvas · 낮음) */
  private pipe: WorldGradePipeline | null = null;
  /** 입체감 값 (파이프라인이 없을 때도 마지막 값을 들고 있다: 디버그) */
  private depthOn = false;

  /**
   * 입체감 후처리 값 (프레임마다, 바뀐 값만 셰이더에 올라간다 — WebGLShader가 지난 값과 견준다). 파이프라인이 없으면(Canvas ·
   * 낮음) 아무것도 하지 않는다. 걸린 곳은 구조 레이어뿐이다(collectFxTargets가 'depth'로 센다)
   */
  setDepth(g: DepthGrade | null): void {
    const p = this.pipe;
    this.depthOn = g !== null && g.on && p !== null;
    if (!p) return;
    const d = p.depth;
    if (!g || !g.on) {
      d.on = false;
      return;
    }
    d.on = true;
    d.x = g.x;
    d.y = g.y;
    d.r0 = g.r0;
    d.r1 = g.r1;
    d.lanternMin = g.lanternMin;
    d.warm = g.warm;
    d.crush = g.crush;
    d.red = g.red;
    d.vignette = g.vignette;
  }

  /** 입체감 후처리가 지금 걸려 있는가 */
  get depth(): boolean {
    return this.depthOn;
  }

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
        pipe.shaderVignette = shaderVignette;
        pipe.grade = grade ? 1 : 0;
        this.pipe = pipe;
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
    this.measure();
  }

  /**
   * 후처리 파이프라인이 붙잡은 렌더 타깃 바이트 (백버퍼 크기 RGBA: 1080p 8.3MB · 4K 33.2MB). 창 크기가 바뀌면 렌더 타깃도
   * 따라 커지므로 매 프레임 다시 잰다(곱셈 몇 번). Canvas · 낮음은 0.
   * 걸린 파이프라인 목록을 그대로 훑는다(getPostPipeline은 부를 때마다 이름으로 걸러 새 배열을 만든다 — 렌더링 최적화 2).
   * 이 파이프라인은 모두 이름이 WORLD_GRADE라 '이름으로 거른 뒤 WorldGradePipeline인 것'과 같은 것을 센다
   */
  measure(): void {
    let bytes = 0;
    if (this.piped) {
      const pipes = this.root.postPipelines;
      for (let i = 0; i < pipes.length; i += 1) {
        const pipe = pipes[i];
        if (!(pipe instanceof WorldGradePipeline)) continue;
        const rts = pipe.renderTargets;
        for (let k = 0; k < rts.length; k += 1) {
          const rt = rts[k];
          if (rt) bytes += rt.width * rt.height * 4;
        }
      }
    }
    gfxState.features.postFxBytes = bytes;
  }

  /** 안개 레이어를 다시 만들면 새 그림이 위에 쌓이므로 오버레이를 맨 위로 */
  raise(): void {
    if (this.overlay) this.root.bringToTop(this.overlay);
  }

  /** 구조 레이어가 카메라 창만큼 옮겨졌을 때(dx, dy 논리 px): 구운 비네트는 화면의 맵 사각형에 그대로 둔다 */
  private dx = 0;
  private dy = 0;

  follow(dx: number, dy: number): void {
    this.dx = dx;
    this.dy = dy;
    this.overlay?.setPosition(MAP_RECT.x - dx, MAP_RECT.y - dy);
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
      .image({ x: MAP_RECT.x - this.dx, y: MAP_RECT.y - this.dy, key: this.overlayKey }, false)
      .setOrigin(0, 0)
      .setDisplaySize(MAP_RECT.w, MAP_RECT.h)
      .setName(`${FX_TAG}vignetteOverlay`);
    this.root.add(this.overlay);
  }

  clear(): void {
    if (this.piped) {
      this.root.resetPostPipeline();
      this.piped = false;
    }
    this.pipe = null;
    this.depthOn = false;
    this.overlay?.destroy();
    this.overlay = null;
    if (this.overlayKey) removeCanvasTexture(this.scene.textures, this.overlayKey);
    this.overlayKey = null;
    gfxState.features.postFxBytes = 0;
  }
}

let overlaySeq = 0;

// ───────────────────────── 후처리가 실제로 걸린 곳 (디버그 getFxTargets) ─────────────────────────

/** 후처리 역할을 하는 보통 표시 객체(구운 비네트 오버레이 등)의 이름 머리 */
export const FX_TAG = 'fx:';

/** Phaser 기본 파이프라인 (효과가 아니다) */
const BASE_PIPELINES = new Set([
  'MultiPipeline',
  'MobilePipeline',
  'SinglePipeline',
  'RopePipeline',
  'GraphicsPipeline',
  'BitmapMaskPipeline',
  'UtilityPipeline',
  'Light2D',
  'PointLightPipeline',
  'PostFXPipeline',
  'FxPipeline',
]);

/** 모든 레이어 이름 (카메라 후처리는 모든 레이어에 걸린다) */
const ALL_LAYERS: readonly LayerName[] = [
  'map',
  'glow',
  'floorInfo',
  'particles',
  'cone',
  'entities',
  'markers',
  'screen',
  'hud',
];

/** 파이프라인 이름 (없으면 '?') */
function pipeName(p: unknown): string {
  if (p && typeof p === 'object' && 'name' in p && typeof p.name === 'string') return p.name;
  return '?';
}

/** FX 컨트롤러 목록 (preFX · postFX)의 켜진 효과 이름 */
function fxList(kind: 'preFX' | 'postFX', ctl: unknown): string[] {
  if (!ctl || typeof ctl !== 'object' || !('list' in ctl) || !Array.isArray(ctl.list)) return [];
  const out: string[] = [];
  for (const fx of ctl.list as unknown[]) {
    if (fx && typeof fx === 'object' && 'active' in fx && fx.active === false) continue;
    const type = fx && typeof fx === 'object' && 'type' in fx ? String(fx.type) : '?';
    out.push(`${kind}:${type}`);
  }
  return out;
}

/** 표시 객체 하나에 걸린 후처리 · 효과 셰이더 */
function fxOf(o: object): string[] {
  const out: string[] = [];
  if ('name' in o && typeof o.name === 'string' && o.name.startsWith(FX_TAG))
    out.push(o.name.slice(FX_TAG.length));
  if ('postPipelines' in o && Array.isArray(o.postPipelines))
    for (const p of o.postPipelines as unknown[]) {
      if (p instanceof WorldGradePipeline) {
        if (p.vignette > 0) out.push('vignette');
        if (p.grade > 0) out.push('colorGrade');
        if (p.depth.on) out.push('depth');
      } else if (pipeName(p) !== 'FxPipeline') out.push(pipeName(p));
    }
  if ('pipeline' in o && o.pipeline) {
    const name = pipeName(o.pipeline);
    if (name === FOG_EDGE_PIPELINE) out.push('fogEdge');
    // 품질 중간 빛 지도 셰이더: 경계 노이즈 없이 내 빛 따라가기만 (구조 레이어)
    else if (name === FOG_FOLLOW_PIPELINE) out.push('fogFollow');
    else if (!BASE_PIPELINES.has(name)) out.push(name);
  }
  if ('preFX' in o) out.push(...fxList('preFX', o.preFX));
  if ('postFX' in o) out.push(...fxList('postFX', o.postFX));
  return out;
}

/**
 * 장면에서 후처리(post 파이프라인 · preFX/postFX · 효과 셰이더 · 'fx:' 이름의 오버레이)가 실제로 걸린 곳을 모은다.
 * layerOf가 표시 객체 → 레이어 이름을 알려 주고(모르면 부모의 레이어, 맨 위는 'hud'), 카메라에 걸린 후처리는 모든 레이어에 걸린 것으로 센다.
 * 자기 신고가 아니라 표시 목록에서 직접 읽으므로, 후처리를 캐릭터 컨테이너 · 카메라에 걸면 그 레이어가 나온다
 */
export function collectFxTargets(
  scene: Phaser.Scene,
  layerOf: (obj: Phaser.GameObjects.GameObject) => LayerName | null,
): FxTarget[] {
  const found = new Map<LayerName, string[]>();
  const add = (layer: LayerName, names: readonly string[]): void => {
    const list = found.get(layer) ?? [];
    for (const n of names) if (!list.includes(n)) list.push(n);
    found.set(layer, list);
  };
  const walk = (list: readonly Phaser.GameObjects.GameObject[], inherited: LayerName): void => {
    for (const o of list) {
      const layer = layerOf(o) ?? inherited;
      const fx = fxOf(o);
      if (fx.length > 0) add(layer, fx);
      if (o instanceof Phaser.GameObjects.Container || o instanceof Phaser.GameObjects.Layer)
        walk(o.list, layer);
    }
  };
  walk(scene.children.list, 'hud');
  for (const cam of scene.cameras.cameras) {
    const names = fxOf(cam).map((n) => `camera:${n}`);
    if (names.length > 0) for (const l of ALL_LAYERS) add(l, names);
  }
  return [...found].map(([layer, effects]) => ({ layer, effects }));
}
