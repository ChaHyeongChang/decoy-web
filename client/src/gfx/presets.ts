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
  /**
   * 백버퍼 높이 하한 (기기 px, 0이면 없음): 화면이 낮아도 백버퍼가 이 높이보다 작아지지 않게 배율을 dprCap 위로 올린다.
   * 올려도 floorDprCap · 기기 픽셀 배율 · maxPixels를 넘지 않는다 (render/resolution.ts computeRenderSize)
   */
  readonly minBackingH: number;
  /** 높이 하한이 올릴 수 있는 배율 상한 */
  readonly floorDprCap: number;
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
  /**
   * 따라가는 카메라: 보이는 창 + 여유를 담는 정적 맵 조각 · 바닥 합성의 텍셀 수 예산. 확대한 맵을 기기 픽셀 1:1로 굽다가
   * 넘으면 텍셀 / 월드 px를 낮춘다(조금 늘려 그린다). 텍스처 메모리 · Canvas 합성 비용이 텍셀 수에 비례한다 (PERF.md 5절)
   */
  readonly mapTexels: number;
  /** 캐릭터 그림 아틀라스의 텍셀 / 월드 px 상한 (따라가는 카메라로 캐릭터가 커져도 텍스처 예산 안에 두게) */
  readonly charTexelCap: number;
  /** 동시 파티클 상한 */
  readonly particleCap: number;
  /** 프레임 애니메이션을 절반 프레임으로 */
  readonly halfFrameAnims: boolean;
}

const MP = (w: number, h: number): number => w * h;

/**
 * 올린 캔버스 텍스처 바이트 예산 (gfx.features.textureBytes, MOBILE_PLAN M10 · PERF.md): 높음 · 중간 32MiB, 낮음 8MiB.
 * 시험(m10-fog · m10-map · camera)이 이 값을 넘지 않는지 보고, 지도 크게 보기는 남은 만큼만 해상도를 올린다
 */
export const TEXTURE_BUDGET: Readonly<Record<QualityTier, number>> = {
  high: 32 * 1024 * 1024,
  medium: 32 * 1024 * 1024,
  low: 8 * 1024 * 1024,
};

export const PRESETS: Readonly<Record<QualityTier, QualityPreset>> = {
  high: {
    tier: 'high',
    dprCap: 2,
    maxPixels: MP(3840, 2160),
    minBackingH: 0,
    floorDprCap: 2,
    compositeCap: 2,
    lightPxPerTile: 16,
    fog: 'gpu',
    fogShader: true,
    bloom: false,
    vignette: 'postfx',
    colorGrade: true,
    mapTexels: 3_000_000,
    charTexelCap: 4,
    particleCap: 400,
    halfFrameAnims: false,
  },
  medium: {
    tier: 'medium',
    dprCap: 1.5,
    maxPixels: MP(2560, 1440),
    minBackingH: 0,
    floorDprCap: 1.5,
    compositeCap: 1.5,
    lightPxPerTile: 12,
    fog: 'gpu',
    fogShader: false,
    bloom: false,
    vignette: 'overlay',
    colorGrade: true,
    mapTexels: 1_600_000,
    charTexelCap: 3,
    particleCap: 150,
    halfFrameAnims: false,
  },
  low: {
    tier: 'low',
    dprCap: 1,
    maxPixels: MP(1920, 1080),
    minBackingH: 0,
    floorDprCap: 1,
    compositeCap: 1,
    lightPxPerTile: 8,
    fog: 'canvas',
    fogShader: false,
    bloom: false,
    vignette: 'none',
    colorGrade: false,
    mapTexels: 800_000,
    charTexelCap: 2,
    particleCap: 40,
    halfFrameAnims: true,
  },
};

/**
 * 터치 기기의 낮음 (M12): 기기 픽셀 배율 1.25배, 단 백버퍼 높이 450px(높이 360 휴대폰의 1.25배) 아래로는 내리지 않고
 * 그 하한이 올리는 배율도 중간의 상한 1.5배를 넘지 않는다. PC 낮음(1배)을 DPR 2~3 휴대폰에 쓰면 HUD 글자가 뭉개진다.
 * M10의 1.5배 고정은 흔한 휴대폰(높이 360~412)에서 중간과 백버퍼가 같아 낮음으로 내려도 픽셀이 줄지 않았다:
 * 1.25배면 픽셀 수가 약 30% 줄고(바닥 합성 캔버스 · 올리는 텍스처도 같이 준다), 높이 293~320인 낮은 화면은
 * 하한 덕에 중간과 거의 같게 남는다. 픽셀 수 상한 1.2MP는 태블릿용 (2560×1600 태블릿 → 약 1.2MP)
 */
export const TOUCH_LOW_OVERRIDE = {
  dprCap: 1.25,
  maxPixels: 1_200_000,
  minBackingH: 450,
  floorDprCap: 1.5,
} as const;

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
      mapTexels: Math.min(p.mapTexels, PRESETS.low.mapTexels),
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
