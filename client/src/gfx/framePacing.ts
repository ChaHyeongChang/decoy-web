// 프레임 페이싱 (렌더링 최적화): 프레임 제한 설정(자동 · 60 · 120) · 화면 주사율 재기 · 제한기.
// 순수 로직은 Phaser를 import하지 않는다. main.ts가 Phaser 루프에 끼운다(installPacer).
// 계약 커밋: 타입과 런타임 연결 자리만. 구현은 같은 PR의 다음 커밋

/** 프레임 제한 선택: 자동 = 화면 주사율을 따른다(제한 없음), 60 = 배터리 절약, 120 */
export type FrameLimit = 'auto' | '60' | '120';
export const FRAME_LIMITS: readonly FrameLimit[] = ['auto', '60', '120'];

export function isFrameLimit(v: unknown): v is FrameLimit {
  return v === 'auto' || v === '60' || v === '120';
}

/**
 * 런타임 연결 (main.ts가 채운다). 로비 · 설정의 프레임 제한 선택과 디버그 훅이 부른다.
 * quality.ts의 qualityHooks와 같은 방식: 이 파일은 순수 로직만 두고 실제 적용은 진입점이 한다
 */
export const pacingHooks: {
  /** 고른 제한을 바로 적용한다 (저장은 부르는 쪽이 먼저 한다) */
  setLimit: ((limit: FrameLimit) => void) | null;
} = { setLimit: null };
