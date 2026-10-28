// 간단한 비율 제한 (docs/ACCOUNT_PLAN.md 4절): 열쇠(IP · 계정)마다 고정 창(1분)에 몇 번까지. 넘으면 429 rate.
// 프로세스 메모리에만 둔다(인스턴스 1개). 열쇠가 너무 많아지면 지난 창을 비운다

/** 열쇠 수 상한 (넘으면 끝난 창부터 지우고, 그래도 넘으면 모두 비운다 — 메모리를 묶어 둔다) */
const MAX_KEYS = 10_000;

export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** 한 번 쓴다. 이 창에서 limit 안이면 true */
  take(key: string): boolean {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || t - e.start >= this.windowMs) {
      e = { start: t, count: 0 };
      this.hits.set(key, e);
      if (this.hits.size > MAX_KEYS) this.sweep(t);
    }
    e.count += 1;
    return e.count <= this.limit;
  }

  get size(): number {
    return this.hits.size;
  }

  private sweep(t: number): void {
    for (const [k, e] of this.hits) if (t - e.start >= this.windowMs) this.hits.delete(k);
    if (this.hits.size > MAX_KEYS) this.hits.clear();
  }
}
