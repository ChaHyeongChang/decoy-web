// v1 색 (VISUAL_SPEC 2.6 쓰지 않는 옛 값 — 지금은 background만 쓴다). 숫자형(0xRRGGBB)과 문자열을 함께 둔다.
export const COLOR = {
  background: 0x0b1622,
  floor: 0x1b2733,
  wallLine: 0xc8d2dc,
  obstacle: 0x3a4552,
  runner: 0x3b82f6,
  guard: 0xa855f7,
  scout: 0x22c55e,
  hiddenSurvivor: 0xf8fafc,
  monster: 0xef4444,
  coneIdle: 0xeab308,
  coneSeen: 0xef4444,
  nearCircle: 0xef4444,
  pointLine: 0xe2e8f0,
  pointRing: 0x22d3ee,
  prison: 0xef4444,
  exitInactive: 0x475569,
  exitActive: 0x22c55e,
  warn: 0xf59e0b,
  white: 0xffffff,
  /** 기절 별 (부채꼴 노랑과 같은 값) */
  stunStar: 0xeab308,
} as const;

export const ALPHA = {
  coneIdle: 0.3,
  coneSeen: 0.45,
  nearCircle: 0.1,
  visionCircle: 0.12,
  badgeUnseen: 0.45,
  attackRange: 0.25,
  protected: 0.5,
} as const;

/**
 * 안개 (M10: 맵 구조는 항상 어둡게 보인다). 빛 지도 바탕이 검정이 아니라 '하한 × 청회색 틴트'라서
 * 시야 밖은 구조가 어둡고 차갑게 보이고, 시야 안은 원래 색(빛 1)이다. 판정과 무관한 그래픽 값이다.
 */
export const FOG = {
  /** 시야 밖 밝기 하한 (0~1). 0.45면 바닥 약 13 · 벽 약 23 · 시야 안 바닥 약 47 (sRGB 밝기) */
  ambient: 0.45,
  /** 시야 밖 틴트 (어두운 청회색: 빨강을 더 줄여 차갑게) */
  tint: 0xa8c4e0,
  /** 품질 높음 경계 셰이더: 경계 띠를 최대 이만큼 어둡게 한다 (밝게 하지 않음) */
  edgeDarken: 0.35,
  /** 경계 노이즈 크기 (타일당 주기 수) */
  edgeNoiseScale: 1.6,
  /** 경계 노이즈 흐름 속도 (주기 / 초) */
  edgeNoiseSpeed: 0.25,
  /** 괴물 화면 자기 시야(부채꼴 ∪ 근접 원) 테두리: 빛 지도 해상도와 상관없이 판정 경계에 딱 맞춘 선 */
  outlineAlpha: 0.6,
  /** 테두리 두께 (논리 px) */
  outlineWidth: 2,
} as const;

export const ROLE_COLOR = {
  runner: COLOR.runner,
  guard: COLOR.guard,
  scout: COLOR.scout,
  monster: COLOR.monster,
} as const;

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
