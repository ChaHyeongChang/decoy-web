// 판 시작 카운트다운 표시 (플레이테스트 a-8, GAME_DESIGN 1장): 스냅샷의 남은 초(world.countdown) → 화면 글자 3 · 2 · 1 → "시작!"과
// 소리 낼 순간. 순수 계산이라 Phaser · DOM을 쓰지 않는다(단위 시험 tests/unit/countdown-view.test.ts). 판정은 서버가 한다 —
// 여기서는 받은 값을 보여 주기만 하고, "시작!"은 서버가 0을 보낸 뒤에만 띄운다(스냅샷이 늦어도 화면이 먼저 시작하지 않는다)
import { UI_TEXT } from '../data/storyText';

/** "시작!"을 띄워 두는 시간 (ms). 그 뒤에 시작 문구(메모 상자)가 같은 자리에 뜬다 */
export const GO_SHOW_MS = 700;

/** 카운트다운 소리: 숫자가 바뀔 때마다 'count', "시작!"이 뜨는 순간 'go' */
export type CountSound = 'count' | 'go';

/**
 * 남은 초 → 보이는 숫자. 스냅샷 사이(20Hz)는 받은 뒤 지난 시간으로 잇고, 1 아래로는 내리지 않는다
 * (3.00~2.01초 = 3, 2.00~1.01초 = 2, 그 아래는 서버가 0을 보낼 때까지 1)
 */
export function countdownDigit(left: number, ageMs: number): number {
  return Math.max(1, Math.ceil(left - Math.max(0, ageMs) / 1000));
}

/** 한 판의 카운트다운 표시 상태. 카운트다운을 본 판에서만 만든다 (프레임마다 새 객체를 만들지 않게 결과를 필드에 쓴다) */
export class CountdownTracker {
  /** 지금 띄울 글자. '' = 카운트다운 중이지만 숨김(판 정지 — 메모 상자 자리는 계속 비워 둔다), null = 카운트다운 표시 없음 */
  label: string | null = null;
  /** 이번 update에서 새로 낼 소리 (없으면 null) */
  sound: CountSound | null = null;
  /** 마지막으로 소리를 낸 숫자 (0 = 아직 없음) */
  private digit = 0;
  /** 0보다 큰 값을 본 뒤 아직 "시작!"을 띄우지 않았다 */
  private armed = false;
  private goUntil = 0;

  /**
   * left = 마지막 스냅샷의 world.countdown, ageMs = 그 스냅샷을 받은 뒤 지난 시간, paused = 판 정지(괴물 재접속 대기) 중.
   * 판 정지 중에는 숫자를 숨기고(서버 카운트다운도 멈춰 있다 — 같은 자리 위에 재접속 대기 줄이 뜬다) 풀리면 남은 숫자부터 잇는다.
   * 재접속으로 중간에 들어오면 남은 숫자부터, 이미 0이면 아무것도 띄우지 않는다
   */
  update(left: number, ageMs: number, paused: boolean, nowMs: number): void {
    this.sound = null;
    if (left > 0) {
      this.armed = true;
      this.goUntil = 0;
      if (paused) {
        this.label = '';
        return;
      }
      const d = countdownDigit(left, ageMs);
      if (d !== this.digit) {
        this.digit = d;
        this.sound = 'count';
        this.label = String(d);
      } else if (!this.label) this.label = String(d);
      return;
    }
    if (this.armed) {
      this.armed = false;
      this.digit = 0;
      this.goUntil = nowMs + GO_SHOW_MS;
      this.sound = 'go';
      this.label = UI_TEXT.countdownGo;
      return;
    }
    if (this.label !== null && nowMs >= this.goUntil) this.label = null;
  }
}
