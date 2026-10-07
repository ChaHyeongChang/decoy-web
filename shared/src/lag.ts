// 인위적 지연 큐. 순서를 보존하면서 각 메시지를 base ± jitter 뒤에 전달한다.
// deliverAt = max(직전 deliverAt, now + base ± jitter) 이라 흔들림이 있어도 순서가 바뀌지 않는다.
export class LagQueue<T> {
  private lastAt = 0;
  private pending = 0;

  constructor(
    private readonly baseMs: number,
    private readonly jitterMs: number,
    private readonly deliver: (item: T) => void,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get enabled(): boolean {
    return this.baseMs > 0;
  }

  get inFlight(): number {
    return this.pending;
  }

  push(item: T): void {
    if (this.baseMs <= 0) {
      this.deliver(item);
      return;
    }
    const t = this.now();
    const jitter = (this.random() * 2 - 1) * this.jitterMs;
    const at = Math.max(this.lastAt, t + Math.max(0, this.baseMs + jitter));
    this.lastAt = at;
    this.pending += 1;
    setTimeout(
      () => {
        this.pending -= 1;
        this.deliver(item);
      },
      Math.max(0, at - t),
    );
  }
}
