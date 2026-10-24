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
 * 빨라질 때 내려오는 시간 상수 (ms). 예전에는 프레임마다 10%씩 내려왔다(60fps에서 시간 상수 −16.67 / ln 0.9 ≈ 158ms).
 * 프레임 수가 아니라 시간으로 내려와야 120fps에서도 같은 빠르기다 (렌더링 최적화: 프레임 독립성)
 */
export const FRAME_MS_TAU = -(1000 / 60) / Math.log(0.9);

/**
 * 최근 프레임 간격을 갱신한다. 느려지면 바로 따라가고(느려진 직후 첫 이벤트부터 버리지 않게) 빨라지면 천천히 내려온다.
 * 내려오는 빠르기는 시간 상수 FRAME_MS_TAU의 지수 감쇠(1 − e^(−delta/τ)): 60fps에서는 예전과 같은 프레임당 10%다.
 * 멈춤 · 잘못된 값은 넣지 않는다. delta는 실제 간격(Phaser rawDelta — delta는 200ms를 넘으면 이전 값으로 바뀐다)
 */
export function trackFrameMs(recent: number, delta: number): number {
  if (!(delta > 0) || delta > STALL_FRAME_MS) return recent;
  if (delta >= recent) return delta;
  return recent + (delta - recent) * (1 - Math.exp(-delta / FRAME_MS_TAU));
}

/** 이보다 오래된(서버 시각 기준) 스냅샷의 일회성 이벤트는 지난 일로 거른다 (ms) */
export function staleEventLimitMs(frameMs: number): number {
  return Math.max(STALE_EVENT_MS, STALE_EVENT_FRAMES * frameMs);
}

/** 한 프레임에 쌓는 시간의 상한 (ms): 멈췄다 돌아온 프레임에 보간 · 연출이 한꺼번에 뛰지 않게 */
export const MAX_FRAME_DELTA_MS = 250;

/**
 * 시간으로 쌓는 연출(보정 어긋남 · 걷기 · 부채꼴 색)에 쓰는 프레임 간격: 실제 간격(Phaser rawDelta)을 [0, 250]ms로.
 * Phaser의 delta(smoothStep)는 최근 10프레임 평균이고 시작 · 복귀 뒤 120프레임은 16.67ms로 막혀 실제 시간과 다르다
 */
export function frameDeltaMs(rawDelta: number): number {
  if (!(rawDelta > 0)) return 0;
  return Math.min(MAX_FRAME_DELTA_MS, rawDelta);
}

/** 이 프레임 rAF 시각이 지금보다 이만큼 넘게 지났으면 쓰지 않는다 (ms): 아주 늦게 시작한 콜백은 화면에 나가는 시각도 늦다 */
export const FRAME_TIME_MAX_LAG_MS = 50;

/**
 * 내 캐릭터 · 카메라를 잴 이 프레임 시각 (내 움직임 고르기): rAF 시각(vsync — 화면에 나가는 간격과 같은 격자). 콜백 안의
 * performance.now는 콜백이 늦게 시작한 만큼(입력 이벤트 · 다른 콜백) 프레임마다 흔들린다. 값이 이상하거나 지금보다 뒤거나
 * FRAME_TIME_MAX_LAG_MS 넘게 지났으면 지금 시각
 */
export function frameTimeOf(rafTime: number, nowMs: number): number {
  if (!Number.isFinite(rafTime) || nowMs - rafTime > FRAME_TIME_MAX_LAG_MS) return nowMs;
  return Math.min(rafTime, nowMs);
}
