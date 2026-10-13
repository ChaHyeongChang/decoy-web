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
  /** 기기가 오프라인이다 (M12: 본문을 서버 잠듦 대신 인터넷 연결 안내로) */
  offline: boolean;
}

/** 깨우기 패널에 '첫 화면으로'를 보일지 정하는 상황 (검토 반영 F23) */
export interface WakeHomeCtx {
  /** 들어가려는 방 코드 (?room= 링크 · 마지막 방 복귀 · 입력한 코드). 없으면 null */
  roomCode: string | null;
  /** 방 상태(lobby)나 판(match)을 받았다 — 이미 방 · 판 안이다 */
  inRoom: boolean;
  /** 기기 안 연습 중 */
  practicing: boolean;
}

/**
 * 방 경로로 부팅해 아직 방에 들어가지 못한 채 기다리는 중이면(방 링크 · 마지막 방 복귀 · 옛 연결이 남아 다시 시도) 가운데
 * 패널에 '첫 화면으로'를 보인다. 오프라인 · 서버 꺼짐이면 연결이 열리지 않아 이 패널에 갇히므로 첫 화면(봇과 연습)으로 갈
 * 길이 필요하다. 판 중 재연결(방 · 판 안)은 지금처럼 버튼 없이 기다린다
 */
export function wakeOffersHome(ctx: WakeHomeCtx): boolean {
  return ctx.roomCode !== null && !ctx.inRoom && !ctx.practicing;
}

export class WakeNoticeState {
  private everOpened = false;
  private waitStart: number | null = null;
  private stopped = false;
  private isOffline = false;

  /** 연결을 시도하기 시작했다 (이미 기다리는 중이면 처음 시각을 유지한다) */
  connecting(nowMs: number): void {
    if (this.stopped) return;
    this.waitStart ??= nowMs;
  }

  /** 연결됐다 */
  opened(): void {
    this.everOpened = true;
    this.waitStart = null;
  }

  /** 연결이 끊겼다 (다시 연결을 시도한다) */
  closed(nowMs: number): void {
    if (this.stopped) return;
    this.waitStart ??= nowMs;
  }

  /**
   * 연결은 됐지만 아직 자리로 돌아가지 못했다 (M12 마지막 방 복귀: 옛 연결이 남아 거절되어 2초마다 다시 시도하는 중).
   * 끊겼을 때처럼 '다시 연결하는 중'으로 보이고, 자리로 돌아가면(opened) 사라진다
   */
  rejoining(nowMs: number): void {
    if (this.stopped) return;
    this.waitStart ??= nowMs;
  }

  /** 기기 온라인 상태 (online · offline 이벤트, 처음에는 navigator.onLine) */
  setOffline(offline: boolean): void {
    this.isOffline = offline;
  }

  /** 다시 연결하지 않는다 (다른 탭이 자리를 가져감) */
  stop(): void {
    this.stopped = true;
    this.waitStart = null;
  }

  /** stop 뒤 다시 연결한다 ("여기서 계속하기") */
  resume(): void {
    this.stopped = false;
  }

  /** 연결을 기다리기 시작한 시각 (ms). 기다리는 중이 아니거나 멈췄으면 null (첫 화면 상태 줄, M13b) */
  get waitingSince(): number | null {
    return this.stopped ? null : this.waitStart;
  }

  /** 기기가 오프라인이다 */
  get offline(): boolean {
    return this.isOffline;
  }

  view(nowMs: number): WakeView {
    const variant: WakeVariant = this.everOpened ? 'reconnecting' : 'waking';
    const offline = this.isOffline;
    if (this.stopped || this.waitStart === null) return { visible: false, variant, seconds: 0, offline };
    const waited = Math.max(0, nowMs - this.waitStart);
    return { visible: waited >= WAKE_NOTICE_DELAY_MS, variant, seconds: Math.floor(waited / 1000), offline };
  }
}
