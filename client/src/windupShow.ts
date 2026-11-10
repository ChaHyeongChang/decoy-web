// 괴물 본인 화면의 공격 준비 표시 판단 (플레이테스트 반영 a-4). 순수 로직 — Phaser를 import하지 않는다.
// 판정은 서버가 한다. 여기서 정하는 것은 "내 화면에 준비 범위 · 든 자세를 언제부터 언제까지 어디에 그리는가"뿐이고, 판 장면이
// 입력 틱(press · noteStep) · 스냅샷(snapshot) · 프레임(view)에서 부른다. 그리기는 view()가 준 값만 쓴다(render/worldRenderer).
//  - 예측(predicted): 누른 입력 틱부터 채운다 (서버 확인 전)
//  - 확인(confirmed): 서버가 준비 중이라고 알려 왔다 → 시작 시각을 그대로 두고 이어 그린다 (다시 시작하지 않고 소리도 다시 내지 않는다)
//  - 거절: 서버가 그 입력을 처리했는데(ack ≥ seq) 준비 중이 아니다 → 끈다. 기절(stunned)을 받아도 끈다.
//    다만 그 뒤에 누른 공격이 아직 서버로 가는 중이면(연타) 끄지 않고 그 누름으로 옮겨 잇는다 — 서버는 대개 그 누름을 받아들인다
//  - 서버(server): 예측하지 못한 준비 → 스냅샷의 남은 시간에서 거꾸로 센 시각부터 그린다 (소리는 attackStart 이벤트에서)
//  - 끝에서 대기(hold): 준비 시간이 지나 다 찬 뒤 타격 결과(attackHit)가 올 때까지 다 찬 범위 · 든 자세를 타격 자리에 둔다.
//    타격 결과는 왕복 지연만큼 늦게 온다(lag 200에서 평균 165ms) — 그동안 범위가 사라졌다가 베기 호가 뜨던 빈 구간을 없앤다.
//    채움 속도는 규칙(준비 시간)과 같고, 다 찬 순간의 내 자리 · 방향이 서버가 판정하는 자리 · 방향이다(누른 입력 + 11번째 입력)
//  - 끝남(done): 대기 상한을 넘겼다 — 서버의 그 준비가 끝날 때까지 다시 그리지 않는다
import type { GameEvent } from '@decoy/shared';

/** 표시 값 (판정 수치가 아니라 내 화면 연출의 안전망이라 balance.json이 아니라 여기 둔다 — touchInput.ts의 TOUCH와 같다) */
export const WINDUP_SHOW = {
  /**
   * 끝에서 대기 상한 = 왕복 지연 + 입력 틱 holdTicks칸 + holdSlackMs. 타격 결과는 다 찬 뒤 '왕복 − 한 틱 ~ 왕복 + 한 틱'(± 지터)에
   * 온다(서버 틱 대기 0~1틱 + 스냅샷 대기 0~1틱 − 준비 12틱 중 마지막 한 틱). 여유 300ms는 지연이 잠깐 튀어도(와이파이 ·
   * 이동통신에서 흔한 100~300ms) 결과가 올 때까지 범위가 남게 하려는 것이다 — 평소에는 결과(또는 서버 준비 0인 스냅샷)가 먼저
   * 끝내고, 이 상한은 스냅샷이 아예 끊겼을 때만 닿는다
   */
  holdTicks: 2,
  holdSlackMs: 300,
  /** 대기 상한의 상한 (ms): 왕복이 아주 길거나 연결이 끊겨도 다 찬 범위가 이보다 오래 남지 않는다 */
  holdMaxMs: 1000,
} as const;

/** 준비 표시 상태 */
export type WindupPhase = 'idle' | 'predicted' | 'confirmed' | 'server' | 'done';

/** 이번 프레임에 그릴 내 공격 준비 (view가 돌려준다 — 그릇 하나를 다시 쓴다) */
export interface WindupShown {
  /** 범위 방향 (null = 지금 내 방향: 예측하지 못한 준비는 조준이 고정된 내 방향을 따른다) */
  dir: number | null;
  /** 채움 시작 시각 (performance.now): 채움 = (지금 − startAt) / 준비 시간 */
  startAt: number;
  /** 채움 0~1 (정확히 준비 시간에 1) */
  fill: number;
  /** 다 찬 뒤 타격 결과를 기다리는 중 (끝에서 대기) */
  hold: boolean;
  /** 범위를 세워 둘 자리 (타일, 대기 중이고 타격 자리를 알 때만). null이면 지금 내 자리를 따라간다 */
  anchor: { x: number; y: number } | null;
}

/** 끝에서 대기 상한 (ms) */
export function holdCapMs(rttMs: number, dtMs: number): number {
  const rtt = Number.isFinite(rttMs) ? Math.max(0, rttMs) : 0;
  return Math.min(WINDUP_SHOW.holdMaxMs, rtt + WINDUP_SHOW.holdTicks * dtMs + WINDUP_SHOW.holdSlackMs);
}

export class WindupShow {
  private state: WindupPhase = 'idle';
  /** 예측한 입력 (서버가 시작한 준비는 0 — 늘 처리된 것으로 본다) */
  private seq = 0;
  /** 예측한 뒤에 또 누른 공격 입력 가운데 가장 늦은 것 (연타, 없으면 0): 예측이 거절되면 이 누름으로 옮겨 잇는다 */
  private later = 0;
  private startAt = 0;
  private dir: number | null = null;
  private capMs = 0;
  private anchored = false;
  private readonly anchor = { x: 0, y: 0 };
  private readonly out: WindupShown = { dir: null, startAt: 0, fill: 0, hold: false, anchor: null };
  /** 서버가 타격을 판정하는 입력: 누른 입력 + 이만큼 (준비 12틱이면 11번째 입력을 처리한 틱에 타격) */
  private readonly strikeSteps: number;

  /** windupMs = 준비 시간(balance.monster.attack.windup), dtMs = 입력 틱 길이 */
  constructor(
    private readonly windupMs: number,
    private readonly dtMs: number,
  ) {
    this.strikeSteps = Math.max(0, Math.round(windupMs / dtMs) - 1);
  }

  get phase(): WindupPhase {
    return this.state;
  }

  /** 준비를 보여 주는 중이거나 서버의 그 준비가 아직 끝나지 않았다: 새 공격을 예측하지 않는다 */
  get active(): boolean {
    return this.state !== 'idle';
  }

  /** 예측 시작: 입력 seq(명목 시각 atMs)에서 dir 방향으로 준비를 시작했다고 본다. rttMs = 지금 왕복 지연 */
  press(seq: number, atMs: number, dir: number, rttMs: number): void {
    this.state = 'predicted';
    this.seq = seq;
    this.later = 0;
    this.startAt = atMs;
    this.dir = dir;
    this.capMs = holdCapMs(rttMs, this.dtMs);
    this.anchored = false;
  }

  /** 예측한 준비를 서버가 아직 확인하지 않았는데 공격을 또 눌렀다 (입력 seq — 새로 예측하지는 않는다) */
  notePress(seq: number): void {
    if (this.state === 'predicted') this.later = seq;
  }

  /**
   * 입력 틱마다: 입력 seq를 적용한 뒤의 예측 자리. 누른 입력 + strikeSteps번째 입력을 적용한 자리가 서버가 타격을 판정하는
   * 자리다(그린 자리는 그 틱 길이 뒤 = 채움이 다 차는 순간에 거기 닿는다) — 대기 중 범위를 그 자리에 세워 둔다
   */
  noteStep(seq: number, x: number, y: number): void {
    if (this.anchored || (this.state !== 'predicted' && this.state !== 'confirmed')) return;
    if (seq < this.seq + this.strikeSteps) return;
    this.anchor.x = x;
    this.anchor.y = y;
    this.anchored = true;
  }

  /**
   * 스냅샷을 받을 때마다 (오래된 스냅샷도): ack = 서버가 처리한 내 마지막 입력, windup = 준비 남은 시간(초), events = 실린 이벤트,
   * nowMs = 받은 시각. 돌려주는 값 = 이 스냅샷의 attackStart가 예측하지 못한 준비라 준비 소리를 지금 내야 하는가
   */
  snapshot(ack: number, windup: number, events: readonly GameEvent[], nowMs: number, rttMs: number): boolean {
    let start = false;
    let hit = false;
    let stunned = false;
    for (const ev of events) {
      if (ev.k === 'attackStart') start = true;
      else if (ev.k === 'attackHit') hit = true;
      else if (ev.k === 'stunned') stunned = true;
    }
    // 소리: 누른 순간 이미 낸 준비(예측 → 확인)가 아니면 attackStart에서 낸다
    const sound = start && this.state === 'idle';
    const winding = windup > 0;
    switch (this.state) {
      case 'idle':
        if (winding) {
          this.state = 'server';
          this.seq = 0;
          this.startAt = nowMs - (this.windupMs - windup * 1000);
          this.dir = null;
          this.capMs = holdCapMs(rttMs, this.dtMs);
          this.anchored = false;
        }
        break;
      case 'predicted':
        if (winding || (start && !hit)) {
          // 서버가 준비 중이면 내 누름(이 입력이든, 예측하지 못한 바로 앞 누름이든)이 받아들여진 것이다: 시작 시각 그대로 잇는다.
          // 예측한 입력을 처리하기 전이면 앞 누름의 준비다 — 방향은 서버가 고정한 내 방향을 따른다
          if (ack < this.seq) this.dir = null;
          this.state = 'confirmed';
        } else if (ack >= this.seq) {
          // 이 입력을 처리했는데 준비 중이 아니다: 거절 (쿨타임 · 대기 · 기절 — 어림이 틀렸다)
          if (this.later > ack) {
            // 그 뒤에 누른 공격이 아직 가는 중이다 (연타): 끄지 않고 그 누름을 기다린다. 채움은 그대로 가고(다 차면 대기),
            // 타격 자리 · 방향은 그 누름 것으로 다시 잡는다
            this.seq = this.later;
            this.later = 0;
            this.dir = null;
            this.anchored = false;
          } else this.state = 'idle';
        }
        break;
      case 'confirmed':
      case 'server':
        // 타격 결과가 왔다. 이벤트를 놓쳤어도(오래된 스냅샷은 연출을 건너뛴다) 서버 준비가 끝났으면 끝낸다
        if (hit || !winding) this.state = 'idle';
        break;
      case 'done':
        if (hit || (!winding && ack >= this.seq)) this.state = 'idle';
        break;
    }
    // 기절: 서버가 준비를 취소했다 (입력을 아직 처리하지 않았어도 그 입력은 기절 중이라 거절된다)
    if (stunned) this.state = 'idle';
    return sound;
  }

  /** 이번 프레임(시각 nowMs)에 그릴 준비. 없으면 null. 돌려준 객체는 다음 호출 때 다시 쓴다 */
  view(nowMs: number): WindupShown | null {
    if (this.state === 'idle' || this.state === 'done') return null;
    const elapsed = nowMs - this.startAt;
    const hold = elapsed >= this.windupMs;
    if (hold && elapsed - this.windupMs > this.capMs) {
      this.state = 'done';
      return null;
    }
    const out = this.out;
    out.dir = this.dir;
    out.startAt = this.startAt;
    out.fill = this.windupMs > 0 ? Math.max(0, Math.min(1, elapsed / this.windupMs)) : 1;
    out.hold = hold;
    out.anchor = hold && this.anchored ? this.anchor : null;
    return out;
  }
}
