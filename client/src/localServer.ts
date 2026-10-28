// 기기 안 연습 서버 (M13b, 봇과 연습): 브라우저 안에서 서버와 같은 ServerCore · Room을 30Hz로 돌린다.
// 서버에 가지 않는다(오프라인 · 서버가 잠들어도 된다). 판정은 이 기기 안 Room이 한다 — CLAUDE.md '서버만 판정한다'의 예외로,
// 온라인 판 · 기록과 섞이지 않는다(DECISIONS M13b). 수치는 빌드에 넣은 config/balance.json(빌드 시점 수치).
// 메시지는 서버와 똑같이 JSON 문자열로 왕복하고, 받는 쪽은 다음 마이크로태스크에 받는다(같은 호출 안에서 되돌아오지 않게).
// 이 파일과 공유 시뮬레이션(@decoy/shared/sim · 봇 두뇌)은 나눠 받는 조각 'practice'다: 첫 화면에 필요 없고, 판 밖 쉬는 시간에
// 미리 받는다(app.ts prefetchPractice — 연습 역할을 누르면 바로 시작). 수치는 practiceBalance.ts (첫 묶음)
import type { ClientMessage, ServerMessage } from '@decoy/shared';
import {
  BotDriver,
  ServerCore,
  practiceBrain,
  truthOf,
  type CoreLink,
  type Room,
  type TruthFrame,
} from '@decoy/shared/sim';
import { PRACTICE_BALANCE } from './practiceBalance';
import type { Transport } from './transport';

export interface LocalOptions {
  /** 테스트 명령(위치 지정 · 시간 등)을 받는다 (?debug 또는 개발 서버) */
  testHooks: boolean;
  /** 판 시드 (없으면 무작위) */
  seed?: number;
}

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  readonly synced = true;
  readonly rtt = 0;
  readonly offset = 0;
  private readonly core: ServerCore;
  private readonly link: CoreLink;
  private readonly listeners = new Set<(msg: ServerMessage) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private closed = false;
  /** 돌린 틱 수 (시험 · 측정) */
  ticks = 0;

  constructor(options: LocalOptions) {
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    // 한 방의 봇은 같은 시드를 쓴다 (생존자 봇의 계획 — 어느 거점을 혼자 · 함께 — 이 시드에서 나와 서로 맞물린다)
    const driver = new BotDriver((info) => practiceBrain(info.role, seed), PRACTICE_BALANCE);
    this.core = new ServerCore(
      { balance: PRACTICE_BALANCE, seed, testHooks: options.testHooks, practice: true },
      driver.hooks(),
      () => performance.now(),
    );
    this.link = this.core.connect(
      {
        id: 1,
        send: (msg) => {
          const text = JSON.stringify(msg);
          queueMicrotask(() => this.deliver(text));
        },
        close: () => {},
      },
      (err) => console.error('연습 서버 처리 오류', err),
    );
    this.resume();
  }

  send(msg: ClientMessage): void {
    if (this.closed) return;
    const text = JSON.stringify(msg);
    queueMicrotask(() => {
      if (!this.closed) this.link.receive(text);
    });
  }

  subscribe(listener: (msg: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  serverNow(): number {
    return performance.now();
  }

  /** 화면이 숨겨짐: 루프만 멈춘다 (자리를 끊지 않는다 — 판이 그대로 멈춰 있다) */
  pause(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 다시 보임: 시계를 지금으로 맞춰 따라잡지 않고 이어 간다 */
  resume(): void {
    if (this.closed || this.running) return;
    this.running = true;
    this.core.resync(performance.now());
    this.schedule();
  }

  close(): void {
    if (this.closed) return;
    this.pause();
    this.link.close();
    this.closed = true;
    this.listeners.clear();
  }

  /** 지금 연습 방 (디버그 · 시험) */
  get room(): Room | null {
    return [...this.core.manager.rooms.values()][0] ?? null;
  }

  /** 기기 안 정답 상태 (디버그 모드 시험 전용) */
  truth(): TruthFrame | null {
    const room = this.room;
    return room ? truthOf(room) : null;
  }

  /** 다음 틱 시각에 맞춰 깨어난다 (초당 30번, 입력 타이머와 같은 방식) */
  private schedule(): void {
    if (!this.running) return;
    const wait = Math.max(0, this.core.nextTickDue - performance.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.running) return;
      this.ticks += this.core.advance(performance.now());
      this.schedule();
    }, wait);
  }

  private deliver(text: string): void {
    if (this.closed) return;
    const msg = JSON.parse(text) as ServerMessage;
    for (const l of this.listeners) l(msg);
  }
}
