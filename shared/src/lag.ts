// 인위적 지연 큐. 각 메시지를 base ± jitter 뒤에 전달하되, 넣은 순서를 반드시 지킨다.
// 메시지마다 타이머를 따로 걸면 정수 ms 반올림 · 이벤트 루프 시각 차이로 순서가 뒤바뀔 수 있어서,
// FIFO 배열 하나와 타이머 하나로 앞에서부터 차례로 꺼낸다.
export class LagQueue<T> {
  private readonly queue: { at: number; item: T }[] = [];
  private timer: unknown = null;
  private lastAt = 0;

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
    return this.queue.length;
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
    this.queue.push({ at, item });
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const head = this.queue[0];
    if (!head) return;
    this.timer = setTimeout(() => this.flush(), Math.max(0, head.at - this.now()));
  }

  private flush(): void {
    this.timer = null;
    const t = this.now();
    // 1ms 여유: 타이머가 조금 일찍 깨어나도 다시 기다리지 않게
    while (this.queue.length > 0 && (this.queue[0]?.at ?? Infinity) <= t + 1) {
      const next = this.queue.shift();
      if (next) this.deliver(next.item);
    }
    this.schedule();
  }
}
