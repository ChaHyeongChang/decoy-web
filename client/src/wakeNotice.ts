// 서버 깨우기 안내 상태 (렌더링과 분리된 순수 로직).
// 무료 호스팅(Render 무료 플랜)은 15분 동안 아무도 접속하지 않으면 서버가 잠들고, 다시 깨어나는 데 1분쯤 걸린다.
// 연결을 기다린 지 WAKE_NOTICE_DELAY_MS가 지나면 '서버 깨우는 중' 안내를 띄운다 (빠른 재연결에는 깜빡이지 않게)

export const WAKE_NOTICE_DELAY_MS = 2500;

/** 처음 연결을 기다리는 중이면 'waking', 연결됐다가 끊긴 뒤면 'reconnecting' */
export type WakeVariant = 'waking' | 'reconnecting';

export interface WakeView {
  visible: boolean;
  variant: WakeVariant;
  /** 기다린 시간 (초, 내림) */
  seconds: number;
}

export class WakeNoticeState {
  private everOpened = false;
  private waitingSince: number | null = null;
  private stopped = false;

  /** 연결을 시도하기 시작했다 (이미 기다리는 중이면 처음 시각을 유지한다) */
  connecting(nowMs: number): void {
    if (this.stopped) return;
    this.waitingSince ??= nowMs;
  }

  /** 연결됐다 */
  opened(): void {
    this.everOpened = true;
    this.waitingSince = null;
  }

  /** 연결이 끊겼다 (다시 연결을 시도한다) */
  closed(nowMs: number): void {
    if (this.stopped) return;
    this.waitingSince ??= nowMs;
  }

  /** 다시 연결하지 않는다 (다른 탭이 자리를 가져감) */
  stop(): void {
    this.stopped = true;
    this.waitingSince = null;
  }

  view(nowMs: number): WakeView {
    const variant: WakeVariant = this.everOpened ? 'reconnecting' : 'waking';
    if (this.stopped || this.waitingSince === null) return { visible: false, variant, seconds: 0 };
    const waited = Math.max(0, nowMs - this.waitingSince);
    return { visible: waited >= WAKE_NOTICE_DELAY_MS, variant, seconds: Math.floor(waited / 1000) };
  }
}
