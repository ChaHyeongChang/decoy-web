// VISUAL_SPEC 2장 색. 숫자형(0xRRGGBB)과 문자열을 함께 둔다.
export const COLOR = {
  background: 0x0b1622,
  fog: 0x000000,
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

export const ROLE_COLOR = {
  runner: COLOR.runner,
  guard: COLOR.guard,
  scout: COLOR.scout,
  monster: COLOR.monster,
} as const;

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
