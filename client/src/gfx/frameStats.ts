// 프레임 측정 (렌더링 최적화): 렌더한 프레임의 간격 · 작업 시간 · 그리기 호출을 고정 크기 고리 버퍼에 모은다.
// ?fps=1 표시 · 적응형 품질 · 디버그 훅이 읽는다. Phaser를 import하지 않는다(main.ts가 Phaser 이벤트에 끼운다).
// 계약 커밋: 읽는 자리만. 구현은 같은 PR의 다음 커밋
import type { FrameStatsInfo } from '@decoy/shared';

/** 지금 측정 요약 (아직 재지 않았으면 null) */
export function frameStatsInfo(): FrameStatsInfo | null {
  return null;
}
