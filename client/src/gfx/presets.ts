// 그래픽 품질 단계 (VISUAL_SPEC 7장 표, MOBILE_PLAN M10). 판정과 무관한 그래픽 값이라 balance.json이 아니라 여기 둔다.
// 품질은 장식만 바꾼다. 캐릭터 · 범위 · 마커 · 배지 · HUD 같은 정보 요소는 모든 단계에서 같다.

export type QualityTier = 'high' | 'medium' | 'low';
export const QUALITY_TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

export type RendererKind = 'webgl' | 'canvas';

export interface QualityPreset {
  readonly tier: QualityTier;
  /** 기기 픽셀 배율(devicePixelRatio) 상한 */
  readonly dprCap: number;
  /** 백버퍼 픽셀 수 상한 */
  readonly maxPixels: number;
  /** 바닥 합성 캔버스 배율 상한 (Canvas2D 합성 비용이 픽셀 수에 비례한다) */
  readonly compositeCap: number;
  /** 빛 지도 해상도 (타일당 px) */
  readonly lightPxPerTile: number;
  /** 안개 합성 방식. gpu = 정적 맵 한 번 업로드 + 빛 텍스처만 갱신, canvas = Canvas2D 한 장 합성 */
  readonly fog: 'gpu' | 'canvas';
  /** 안개 가장자리 셰이더 (어둡게만, 판정 밖을 밝히지 않음). WebGL 전용 */
  readonly fogShader: boolean;
  /** 진짜 Bloom postFX (비싸서 기본 끔. 실측으로 감당될 때만 켠다). WebGL 전용 */
  readonly bloom: boolean;
  /** 비네트: postfx(WebGL 전용) · overlay(구운 이미지) · none */
  readonly vignette: 'postfx' | 'overlay' | 'none';
  /** 색보정 ColorMatrix (WebGL 전용) */
  readonly colorGrade: boolean;
  /** 동시 파티클 상한 */
  readonly particleCap: number;
  /** 프레임 애니메이션을 절반 프레임으로 */
  readonly halfFrameAnims: boolean;
}

const MP = (w: number, h: number): number => w * h;

export const PRESETS: Readonly<Record<QualityTier, QualityPreset>> = {
  high: {
    tier: 'high',
    dprCap: 2,
    maxPixels: MP(3840, 2160),
    compositeCap: 2,
    lightPxPerTile: 16,
    fog: 'gpu',
    fogShader: true,
    bloom: false,
    vignette: 'postfx',
    colorGrade: true,
    particleCap: 400,
    halfFrameAnims: false,
  },
  medium: {
    tier: 'medium',
    dprCap: 1.5,
    maxPixels: MP(2560, 1440),
    compositeCap: 1.5,
    lightPxPerTile: 12,
    fog: 'gpu',
    fogShader: false,
    bloom: false,
    vignette: 'overlay',
    colorGrade: true,
    particleCap: 150,
    halfFrameAnims: false,
  },
  low: {
    tier: 'low',
    dprCap: 1,
    maxPixels: MP(1920, 1080),
    compositeCap: 1,
    lightPxPerTile: 8,
    fog: 'canvas',
    fogShader: false,
    bloom: false,
    vignette: 'none',
    colorGrade: false,
    particleCap: 40,
    halfFrameAnims: true,
  },
};

/** 터치 기기의 낮음: DPR 3 휴대폰에서 1배로 내리면 HUD 글자가 뭉개져서 해상도 하한을 따로 둔다 */
export const TOUCH_LOW_OVERRIDE = { dprCap: 1.5, maxPixels: 1_200_000 } as const;

/**
 * 렌더러 · 기기에 맞춘 실제 설정. Canvas 렌더러에서는 WebGL 전용 기능이 0개가 되고,
 * 바닥 합성은 CPU 비용 때문에 1배를 넘지 않는다.
 */
export function effectivePreset(tier: QualityTier, renderer: RendererKind, touch = false): QualityPreset {
  let p: QualityPreset = PRESETS[tier];
  if (touch && tier === 'low') p = { ...p, ...TOUCH_LOW_OVERRIDE };
  if (renderer === 'canvas') {
    p = {
      ...p,
      compositeCap: Math.min(p.compositeCap, 1),
      fog: 'canvas',
      fogShader: false,
      bloom: false,
      vignette: p.vignette === 'postfx' ? 'overlay' : p.vignette,
      colorGrade: false,
    };
  }
  return p;
}

/** 한 단계 낮은 품질 (이미 낮음이면 null) */
export function lowerTier(tier: QualityTier): QualityTier | null {
  return tier === 'high' ? 'medium' : tier === 'medium' ? 'low' : null;
}

export function isQualityTier(v: unknown): v is QualityTier {
  return v === 'high' || v === 'medium' || v === 'low';
}
