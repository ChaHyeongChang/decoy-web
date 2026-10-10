// 터치 판 시작 전 화면 크기 자리 잡기 (MOBILE_PLAN M12 1번, 순수 로직: 크기 · 세로 여부 · 시계 · 타이머는 주입받는다).
// 가로 고정 · 전체 화면 전환 · 주소창 변화가 끝난 뒤의 크기로 판 배치를 정한다. 세로 안내가 덮고 있는 동안은 세지 않고
// 가로가 되기를 기다린다: 휴대폰의 세로 크기는 가로 크기를 뒤집은 값이 아니라(주소창 · 안전 영역이 다르게 빠진다)
// 세로 크기로 정하면 돌린 뒤 화면비가 달라 판 내내 작게 그려지고 HUD 글자가 12px 아래로 내려간다

/** 가로가 된 뒤 크기 변화를 기다리는 최대 시간 */
export const SETTLE_MAX_MS = 300;
/** 이 시간 동안 크기가 그대로면 전환이 끝난 것으로 본다 */
export const SETTLE_QUIET_MS = 100;

export interface SettleEnv {
  /** 판 영역 크기 (CSS px) */
  size(): { width: number; height: number };
  /** 세로 안내가 덮고 있는가 (device.portrait: 터치 화면 · 세로) */
  portrait(): boolean;
  /** 세로 ↔ 가로가 바뀌면 fn을 부른다. 반환값은 구독 끝 */
  onTurn(fn: () => void): () => void;
  now(): number;
  /** ms 뒤 fn. 반환값은 취소 */
  later(fn: () => void, ms: number): () => void;
}

/**
 * 크기가 SETTLE_QUIET_MS 동안 그대로이고 가로면(아니어도 SETTLE_MAX_MS가 지나면) done. 세로 안내가 덮고 있으면 가로가 될
 * 때까지 세지 않고, 가로가 된 때부터 다시 센다(세는 중에 세로가 되어도). 반환값을 부르면 done 없이 멈춘다 (로비 복귀 · 새 판)
 */
export function settleSize(env: SettleEnv, done: () => void): () => void {
  let stop = (): void => undefined;
  const begin = (): void => {
    if (env.portrait()) {
      stop = env.onTurn(() => {
        if (env.portrait()) return;
        stop();
        begin();
      });
      return;
    }
    const start = env.now();
    let last = '';
    let quietSince = start;
    const tick = (): void => {
      if (env.portrait()) return begin();
      const now = env.now();
      const s = env.size();
      const key = `${Math.round(s.width)}x${Math.round(s.height)}`;
      if (key !== last) {
        last = key;
        quietSince = now;
      }
      if (now - start >= SETTLE_MAX_MS || (s.width >= s.height && now - quietSince >= SETTLE_QUIET_MS))
        done();
      else stop = env.later(tick, 16);
    };
    tick();
  };
  begin();
  return () => stop();
}
