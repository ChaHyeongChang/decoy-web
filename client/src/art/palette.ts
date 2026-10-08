// 팔레트 (M10 VISUAL_SPEC 2장): 캐릭터 · 정보 · UI 공통 색과 대비 계산. 판정과 무관한 그래픽 값이다.
//
// 예약 색 (VISUAL_SPEC 0장 · R6):
//  - 역할 4색과 HIDDEN_SURVIVOR(#F8FAFC)는 캐릭터 · 역할 UI 전용. 맵 장식에 쓰지 않는다
//    (괴물 화면에서 "흰 원 = 생존자"라서 맵에 흰색 · 밝은 둥근 장식을 두지 않는다)
//  - 빨강 계열은 괴물 · 빨강 부채꼴 · 감옥 · 피해 전용, 주황은 경고 전용, 청록은 시설 · 목표
// 구조(바닥 · 벽 · 기둥) 색은 맵 그림(art/mapArt.ts), 실루엣 세부 색은 캐릭터 그림(art/shapes.ts)이 가진다.

/** 역할색 (규칙 색, GAME_DESIGN · balance.json roles.color와 같은 값). 몸 채움 · 링 · 역할 UI */
export const ROLE = {
  runner: 0x3b82f6,
  guard: 0xa855f7,
  scout: 0x22c55e,
  monster: 0xef4444,
} as const;

/** 글자용 밝은 역할색 (패널 #0F1B27 위 6.3~10:1). 이름 · 라벨처럼 글자에만 */
export const ROLE_TEXT = {
  runner: 0x60a5fa,
  guard: 0xc084fc,
  scout: 0x4ade80,
  monster: 0xf87171,
} as const;

/** 괴물 화면의 생존자 (공통 실루엣 · 역할 없음) */
export const HIDDEN_SURVIVOR = 0xf8fafc;
/** 캐릭터 외곽선 (역할색 대비 5.07~8.81:1) */
export const OUTLINE = 0x05080c;
/** 부채꼴 (규칙 색 GAME_DESIGN 3.2: 노랑 = 아무도 못 봄, 빨강 = 누군가 보임) */
export const CONE = { idle: 0xeab308, seen: 0xef4444 } as const;
/** 시설 네온 (청록: 시설 · 목표) */
export const NEON = 0x22d3ee;
export const NEON_DIM = 0x0e7490;
/** 경고 (주황 전용)와 그 위 글자 (8.49:1) */
export const WARN = 0xf59e0b;
export const WARN_TEXT = 0x0b1622;
/** 위험 · 피해 (빨강 전용)와 발각 배너 바탕 (흰 글자 6.47:1) */
export const DANGER = 0xef4444;
export const DANGER_BANNER = 0xb91c1c;
/** 정보 배너 바탕 (흰 글자 5.36:1) */
export const INFO_BANNER = 0x0e7490;
/** 탈출구 활성 (초록: 탈출 · 문) */
export const EXIT_GO = 0x22c55e;

/** UI 공통 */
export const UI = {
  /** 화면 바탕 · HUD 띠 */
  background: 0x0b1622,
  /** 맵 밖 */
  mapOutside: 0x05080c,
  /** 패널 (어두운 유리) */
  panel: 0x0f1b27,
  panelAlpha: 0.92,
  panelBorder: 0x1e3a4a,
  /** 강조 테두리 (청록 35%) */
  panelAccent: NEON,
  panelAccentAlpha: 0.35,
  text: 0xe2e8f0,
  textDim: 0x94a3b8,
  white: 0xffffff,
} as const;

// ───────────────────────── 대비 계산 (WCAG 2.x) ─────────────────────────

function channelToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 상대 휘도 (0~1) */
export function relativeLuminance(rgb: number): number {
  return (
    0.2126 * channelToLinear((rgb >> 16) & 255) +
    0.7152 * channelToLinear((rgb >> 8) & 255) +
    0.0722 * channelToLinear(rgb & 255)
  );
}

/** 대비 (1~21) */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** fg를 알파 a로 bg 위에 합성한 색 */
export function blendOver(fg: number, bg: number, a: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) {
    const v = Math.round(((fg >> s) & 255) * a + ((bg >> s) & 255) * (1 - a));
    out |= Math.max(0, Math.min(255, v)) << s;
  }
  return out;
}

/** 곱하기 (안개: 구조색 × 빛 지도 색) */
export function multiplyRgb(a: number, b: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255) << s;
  return out;
}

export interface ContrastPair {
  readonly name: string;
  readonly fg: number;
  readonly bg: number;
  /** 최소 대비 (글자 4.5, 큰 글자 3, 그래픽 3, 어둠 속 구조 2.5) */
  readonly min: number;
}

/** 글자 쌍 (palette.test.ts가 고정한다) */
export const TEXT_PAIRS: readonly ContrastPair[] = [
  { name: '러너 글자 / 패널', fg: ROLE_TEXT.runner, bg: UI.panel, min: 4.5 },
  { name: '가드 글자 / 패널', fg: ROLE_TEXT.guard, bg: UI.panel, min: 4.5 },
  { name: '스카우트 글자 / 패널', fg: ROLE_TEXT.scout, bg: UI.panel, min: 4.5 },
  { name: '괴물 글자 / 패널', fg: ROLE_TEXT.monster, bg: UI.panel, min: 4.5 },
  { name: '본문 / 패널', fg: UI.text, bg: UI.panel, min: 4.5 },
  { name: '흐린 글자 / 패널', fg: UI.textDim, bg: UI.panel, min: 4.5 },
  { name: '경고 배너 글자', fg: WARN_TEXT, bg: WARN, min: 4.5 },
  { name: '발각 배너 글자', fg: UI.white, bg: DANGER_BANNER, min: 4.5 },
  { name: '정보 배너 글자', fg: UI.white, bg: INFO_BANNER, min: 4.5 },
];

/** 그래픽 쌍: 캐릭터 몸과 외곽선 (palette.test.ts가 고정한다) */
export const GRAPHIC_PAIRS: readonly ContrastPair[] = [
  { name: '러너 몸 / 외곽선', fg: ROLE.runner, bg: OUTLINE, min: 3 },
  { name: '가드 몸 / 외곽선', fg: ROLE.guard, bg: OUTLINE, min: 3 },
  { name: '스카우트 몸 / 외곽선', fg: ROLE.scout, bg: OUTLINE, min: 3 },
  { name: '괴물 몸 / 외곽선', fg: ROLE.monster, bg: OUTLINE, min: 3 },
  { name: '숨은 생존자 / 외곽선', fg: HIDDEN_SURVIVOR, bg: OUTLINE, min: 3 },
];

export function hexCss(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}
