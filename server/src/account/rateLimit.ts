// 간단한 비율 제한 (docs/ACCOUNT_PLAN.md 4절): 열쇠(IP · 계정)마다 고정 창(1분)에 몇 번까지. 넘으면 429 rate.
// 프로세스 메모리에만 둔다(인스턴스 1개). 열쇠(IP)를 오래 두지 않는다(처리방침 3번 '최대 2분'): 창이 끝난 열쇠는
// 창마다 한 번 지운다 — 요청이 올 때(take 머리) · 요청이 없어도 열쇠가 남아 있는 동안 창마다 도는 타이머로

/** 열쇠 수 상한 (넘으면 끝난 창부터 지우고, 그래도 넘으면 모두 비운다 — 메모리를 묶어 둔다) */
const MAX_KEYS = 10_000;

export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();
  /** 마지막으로 끝난 창의 열쇠를 지운 시각 */
  private sweptAt: number;
  /** 열쇠가 남아 있는 동안만 도는 지우기 타이머 (서버를 붙잡지 않게 unref) */
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.sweptAt = now();
  }

  /** 한 번 쓴다. 이 창에서 limit 안이면 true */
  take(key: string): boolean {
    const t = this.now();
    // 창마다 한 번: 창이 끝난 열쇠를 지운다 (열쇠는 늦어도 다음 창에 사라진다)
    if (t - this.sweptAt >= this.windowMs) this.sweep(t);
    let e = this.hits.get(key);
    if (!e || t - e.start >= this.windowMs) {
      e = { start: t, count: 0 };
      this.hits.set(key, e);
      if (this.hits.size > MAX_KEYS) this.sweep(t);
      this.arm();
    }
    e.count += 1;
    return e.count <= this.limit;
  }

  get size(): number {
    return this.hits.size;
  }

  /** 요청이 더 오지 않아도 창마다 지운다. 열쇠가 다 사라지면 멈춘다 */
  private arm(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sweep(this.now());
      if (this.hits.size > 0) this.arm();
    }, this.windowMs);
    this.timer.unref();
  }

  private sweep(t: number): void {
    this.sweptAt = t;
    for (const [k, e] of this.hits) if (t - e.start >= this.windowMs) this.hits.delete(k);
    if (this.hits.size > MAX_KEYS) this.hits.clear();
  }
}
