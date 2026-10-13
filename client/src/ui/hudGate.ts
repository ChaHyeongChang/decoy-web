// HUD · 미니맵을 언제 다시 계산하는가 (렌더링 최적화 2). DOM · Phaser를 쓰지 않는 순수 상태 기계 (tests/unit/hud-gate.test.ts).
//  - HudGate: HUD 값은 서버 스냅샷(20Hz)으로만 바뀐다. 짧은 안내(밀치기 범위 밖) · 글꼴 세대(늦게 받은 폰트로 글자 폭이 바뀜) ·
//    HUD 아틀라스(백버퍼 배율이 바뀌어 다시 구움) · 글자 해상도(글자 폭이 텍셀 단위로 바뀜)도 결과를 바꾼다. 이 중 하나라도 바뀐
//    프레임에만 다시 계산한다. 60 · 120fps에서 스냅샷 사이 프레임은 같은 입력이라 같은 결과였다
//  - BaseRefreshPacer: 미니맵 바닥(안개 합성 축소)은 안개 그림이 바뀐 프레임 다음 프레임에 그린다 — 안개 합성 · 업로드와
//    미니맵 합성 · 축소 · 업로드가 한 프레임에 겹쳐 120Hz 예산을 넘던 것(PERF 4.1 안개 갱신 프레임). 바로 앞 프레임도 안개가
//    바뀐 프레임이면(프레임이 안개 주기보다 느림 — 빈 프레임이 없다) 미루지 않고 그 프레임에 그린다(예전과 같은 갱신 빈도)
//  - dropEnded · dropStale: 배너 알림 목록을 제자리에서 거른다 (filter와 같은 결과, 새 배열 없음)

/** 다시 계산할 프레임인가: 입력 중 하나라도 지난번과 다르면 true (처음에는 늘 true) */
export class HudGate {
  private snap: object | null = null;
  private toast = '';
  private gen = Number.NaN;
  private kit = '';
  private res = Number.NaN;

  fresh(snap: object, toast: string, fontGen: number, kitKey: string, resolution: number): boolean {
    if (
      snap === this.snap &&
      toast === this.toast &&
      fontGen === this.gen &&
      kitKey === this.kit &&
      resolution === this.res
    )
      return false;
    this.snap = snap;
    this.toast = toast;
    this.gen = fontGen;
    this.kit = kitKey;
    this.res = resolution;
    return true;
  }

  /** 다음 프레임에 꼭 다시 계산한다 */
  reset(): void {
    this.snap = null;
  }
}

/** 미니맵 바닥을 이번 프레임에 그릴까 (프레임마다 한 번 부른다) */
export class BaseRefreshPacer {
  /** 안개 그림이 바뀌었는데 아직 그리지 않았다 */
  private pending = false;
  /** 지난 프레임에 안개 그림이 바뀌었다 */
  private prevChanged = false;

  /**
   * changed = 이번 프레임에 안개 그림이 바뀌었다(WorldRenderer.baseRefreshed), now = 기다리지 않고 지금 그린다(숨겼다가 다시
   * 보임). true면 이번 프레임에 그린다
   */
  frame(changed: boolean, now: boolean): boolean {
    const prev = this.prevChanged;
    this.prevChanged = changed;
    let draw: boolean;
    if (now) draw = true;
    else if (changed) {
      draw = prev;
      if (!prev) this.pending = true;
    } else draw = this.pending;
    if (draw) this.pending = false;
    return draw;
  }

  get waiting(): boolean {
    return this.pending;
  }
}

/**
 * 끝난 알림(until ≤ nowMs)을 제자리에서 뺀다. 순서를 지키고 결과는 filter((b) => b.until > nowMs)와 같다.
 * 매 프레임 새 배열 · 닫힘 함수를 만들지 않는다 (렌더링 최적화 2)
 */
export function dropEnded<T extends { until: number }>(list: T[], nowMs: number): void {
  let j = 0;
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i] as T;
    if (!(v.until > nowMs)) continue;
    if (i !== j) list[j] = v;
    j += 1;
  }
  if (j !== list.length) list.length = j;
}

/** 대기열에서 maxWait보다 오래 기다린 알림을 제자리에서 뺀다 (filter((b) => nowMs - b.created <= maxWait)와 같다) */
export function dropStale<T extends { created: number }>(list: T[], nowMs: number, maxWait: number): void {
  let j = 0;
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i] as T;
    if (!(nowMs - v.created <= maxWait)) continue;
    if (i !== j) list[j] = v;
    j += 1;
  }
  if (j !== list.length) list.length = j;
}
