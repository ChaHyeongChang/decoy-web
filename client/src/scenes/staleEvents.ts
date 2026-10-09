// 오래된 이벤트 거르기 (M8, M10b에서 고침): 백그라운드에서 멈췄다 돌아온 탭이 밀린 스냅샷의 지난 일(타격음 · 플래시)을
// 뒤늦게 울리지 않게 한다. 느린 기기에서는 메시지 처리 자체가 프레임 한두 개만큼 늦어서, 고정 2초로 거르면 멀쩡한
// 이벤트까지 버렸다(CI 러너에서 생존자 화면이 괴물 공격 예고를 놓침). 그래서 한도를 최근 프레임 간격에 맞춰 늘린다.
// 한 번에 오래 멈춘 프레임(백그라운드 복귀 등)은 프레임 속도로 치지 않는다

/** 프레임이 빠를 때의 한도 (ms) */
export const STALE_EVENT_MS = 2000;
/** 느린 기기: 최근 프레임 간격의 이 배수까지는 지난 일이 아니다 */
export const STALE_EVENT_FRAMES = 3;
/** 이보다 긴 프레임 간격은 프레임 속도가 아니라 멈춤으로 본다 (ms) */
export const STALL_FRAME_MS = 2500;

/**
 * 최근 프레임 간격을 갱신한다. 느려지면 바로 따라가고(느려진 직후 첫 이벤트부터 버리지 않게) 빨라지면 천천히 내려온다.
 * 멈춤 · 잘못된 값은 넣지 않는다. delta는 실제 간격(Phaser rawDelta — delta는 200ms를 넘으면 이전 값으로 바뀐다)
 */
export function trackFrameMs(recent: number, delta: number): number {
  if (!(delta > 0) || delta > STALL_FRAME_MS) return recent;
  return delta >= recent ? delta : recent + (delta - recent) * 0.1;
}

/** 이보다 오래된(서버 시각 기준) 스냅샷의 일회성 이벤트는 지난 일로 거른다 (ms) */
export function staleEventLimitMs(frameMs: number): number {
  return Math.max(STALE_EVENT_MS, STALE_EVENT_FRAMES * frameMs);
}
