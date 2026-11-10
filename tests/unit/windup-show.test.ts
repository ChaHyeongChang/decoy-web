// 괴물 본인 화면의 공격 준비 표시 판단 (플레이테스트 반영 a-4, client/src/windupShow.ts): 상태 전이 전부.
// 예측 → 서버 확인(시작 시각 유지 · 소리 한 번) → 끝에서 대기 → 타격 결과에서 끝, 거절 · 기절이면 끔, 예측하지 못한 준비는 서버 값으로,
// 대기 상한을 넘기면 끝남(서버 준비가 끝날 때까지 다시 그리지 않는다). 지연 연결 위의 흐름은 windup-lag.test.ts가 본다
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@decoy/shared';
import { windupFill } from '../../client/src/art/anim';
import { WINDUP_SHOW, WindupShow, holdCapMs } from '../../client/src/windupShow';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
/** 준비 시간 · 틱 길이 (ms) */
const W = balance.monster.attack.windup * 1000;
const DT = 1000 / balance.network.serverTickHz;
/** 타격을 판정하는 입력: 누른 입력 + 11번째 (준비 12틱) */
const STRIKE_STEPS = Math.round(W / DT) - 1;
const RTT = 200;
const CAP = holdCapMs(RTT, DT);
/** 시각 1000에 시작한 준비가 다 차고(1400) 대기 상한까지 넘긴 시각 */
const OVER = 1400 + CAP + 1;

const START: GameEvent = { k: 'attackStart', x: 10, y: 10, dir: 0.5 };
const HIT: GameEvent = { k: 'attackHit', x: 10, y: 10, dir: 0.5, hits: 0 };
const STUNNED: GameEvent = { k: 'stunned' };
const OTHER: GameEvent = { k: 'shoveMiss' };

const make = (): WindupShow => new WindupShow(W, DT);
/** 입력 100을 시각 1000에 0.5rad로 예측한 표시 */
function predicted(): WindupShow {
  const s = make();
  s.press(100, 1000, 0.5, RTT);
  return s;
}
/** 예측한 뒤 서버가 확인한 표시 (입력 100을 처리한 스냅샷, 남은 준비 0.3초, 시각 1200) */
function confirmed(): WindupShow {
  const s = predicted();
  s.snapshot(100, 0.3, [START], 1200, RTT);
  return s;
}

describe('공격 준비 표시 (WindupShow)', () => {
  it('준비 12틱 · 타격은 누른 입력 + 11번째 입력 (balance: 준비 0.4초, 30Hz)', () => {
    expect([W, STRIKE_STEPS]).toEqual([400, 11]);
  });

  it('처음에는 아무것도 그리지 않는다. 준비 없는 스냅샷은 그대로 두고 소리도 내지 않는다', () => {
    const s = make();
    expect([s.phase, s.active, s.view(0)]).toEqual(['idle', false, null]);
    expect(s.snapshot(5, 0, [OTHER], 100, RTT)).toBe(false);
    expect([s.phase, s.view(100)]).toEqual(['idle', null]);
  });

  it('예측: 누른 입력 틱부터 채운다 — 채움 = (지금 − 시작) / 준비 시간, 방향은 누른 순간의 방향, 내 자리를 따라간다', () => {
    const s = predicted();
    expect([s.phase, s.active]).toEqual(['predicted', true]);
    for (const t of [1000, 1016.7, 1100, 1250, 1399.9]) {
      const v = s.view(t);
      expect(v, String(t)).not.toBeNull();
      // 그리는 쪽(worldRenderer)은 같은 시작 시각으로 windupFill을 부른다: 같은 값이다
      expect(v?.fill).toBeCloseTo(windupFill((t - 1000) / 1000, W / 1000), 12);
      expect([v?.dir, v?.startAt, v?.hold, v?.anchor]).toEqual([0.5, 1000, false, null]);
    }
    expect(s.view(1000)?.fill).toBe(0);
    // 시작 시각보다 앞선 프레임(입력 틱의 명목 시각이 프레임 시각보다 조금 뒤)은 0에서
    expect(s.view(999)?.fill).toBe(0);
  });

  it('view는 그릇 하나를 다시 쓴다 (프레임마다 새로 만들지 않는다)', () => {
    const s = predicted();
    expect(s.view(1100)).toBe(s.view(1200));
  });

  it('서버가 그 입력을 아직 처리하지 않았으면(ack < seq, 준비 0) 예측을 그대로 둔다', () => {
    const s = predicted();
    expect(s.snapshot(99, 0, [], 1100, RTT)).toBe(false);
    expect([s.phase, s.view(1100)?.startAt]).toEqual(['predicted', 1000]);
  });

  it('예측 → 서버 확인: 시작 시각을 그대로 두고 이어 그린다 (다시 시작하지 않는다) · 준비 소리를 다시 내지 않는다', () => {
    const s = predicted();
    const before = s.view(1199)?.fill ?? 0;
    // 서버 값으로 다시 시작했다면 시작 시각이 1200 − (400 − 300) = 1100이 되고 채움이 0.5 → 0.25로 줄어든다
    expect(s.snapshot(100, 0.3, [START], 1200, RTT)).toBe(false);
    const after = s.view(1200);
    expect([s.phase, after?.startAt, after?.dir]).toEqual(['confirmed', 1000, 0.5]);
    expect(after?.fill).toBeGreaterThanOrEqual(before);
    expect(after?.fill).toBe(0.5);
    // 그 뒤 스냅샷들(준비가 줄어드는 중)에도 그대로
    expect(s.snapshot(102, 0.233, [], 1270, RTT)).toBe(false);
    expect([s.phase, s.view(1270)?.startAt]).toEqual(['confirmed', 1000]);
  });

  it('서버 확인은 준비 값만으로도(이벤트가 빠진 스냅샷), 이벤트만으로도 된다', () => {
    const byValue = predicted();
    expect(byValue.snapshot(100, 0.3667, [], 1200, RTT)).toBe(false);
    expect(byValue.phase).toBe('confirmed');
    const byEvent = predicted();
    expect(byEvent.snapshot(100, 0, [START], 1200, RTT)).toBe(false);
    expect(byEvent.phase).toBe('confirmed');
  });

  it('바로 앞의 예측하지 못한 누름이 받아들여졌으면(ack < seq인데 서버가 준비 중) 그 준비를 내 예측으로 잇는다 — 소리는 누를 때 한 번', () => {
    const s = predicted();
    for (let q = 100; q <= 103; q += 1) s.noteStep(q, q, 0);
    const before = s.view(1150)?.fill ?? Number.NaN;
    expect(s.snapshot(98, 0.3667, [START], 1150, RTT)).toBe(false);
    expect(s.phase).toBe('confirmed');
    // 방향은 서버가 그 앞 누름에서 고정한 내 방향을 따른다 (내가 예측한 누름의 방향이 아니다)
    expect(s.view(1150)?.dir).toBeNull();
    // 채움은 줄지 않는다 (앞 누름 기준으로 당겨져 한 번 앞으로 뛴다 — 아래 시험)
    expect(s.view(1150)?.fill).toBeGreaterThanOrEqual(before);
    // 내 입력(100)은 준비 중이라 서버가 버린다: 표시는 그대로 타격 결과까지
    s.snapshot(100, 0.3, [], 1220, RTT);
    expect(s.phase).toBe('confirmed');
    s.snapshot(109, 0, [HIT], 1600, RTT);
    expect(s.phase).toBe('idle');
  });

  it('앞 누름 P0이 받아들여졌으면 채움 시작 · 세울 자리를 P0 기준으로 다시 잡는다 — P0 = ack + 남은 준비 틱 − 11, 서버는 P0 + 11번째 입력에서 타격한다 (검토)', () => {
    // 스냅샷이 P0을 처리한 바로 그 틱 (남은 준비 11틱): P0 = 98. 내 누름(100)보다 두 틱 앞
    const s = predicted();
    for (let q = 100; q <= 103; q += 1) s.noteStep(q, q, 0);
    s.snapshot(98, 0.3667, [START], 1150, RTT);
    const startAt = 1000 - 2 * DT;
    expect(s.view(1150)?.startAt).toBeCloseTo(startAt, 9);
    expect(s.view(1150)?.fill).toBeCloseTo((1150 - startAt) / W, 9);
    for (let q = 104; q <= 115; q += 1) s.noteStep(q, q, 0);
    // 다 차는 순간도 P0 기준 (내 누름 기준이면 두 틱 늦게 찼다)
    expect(s.view(startAt + W - 0.01)?.hold).toBe(false);
    const v = s.view(startAt + W + 1);
    // 대기 자리 = P0 + 11 = 109번째 입력의 자리 (내 누름 기준이면 111 — 베기 호보다 두 틱 앞에 섰다)
    expect([v?.hold, v?.fill, v?.anchor]).toEqual([true, 1, { x: 98 + STRIKE_STEPS, y: 0 }]);

    // 스냅샷이 P0을 처리하고 4틱 뒤 (남은 준비 7틱): P0 = 98 + 7 − 11 = 94. 타격 입력 105는 내 화면이 이미 지났다(106까지 적용) →
    // 그 자리를 모르니 세우지 않는다 (대기 중에도 나를 따라간다 — 뒤 입력의 자리를 잘못 세우지 않는다)
    const late = predicted();
    for (let q = 100; q <= 106; q += 1) late.noteStep(q, q, 0);
    late.snapshot(98, 0.2333, [], 1250, RTT);
    expect(late.phase).toBe('confirmed');
    expect(late.view(1250)?.startAt).toBeCloseTo(1000 - 6 * DT, 9);
    for (let q = 107; q <= 115; q += 1) late.noteStep(q, q, 0);
    expect([late.view(1400)?.hold, late.view(1400)?.anchor]).toEqual([true, null]);

    // 남은 준비를 모르면(준비 시작 이벤트만, 준비 값 0): 시작은 그대로, 자리는 세우지 않는다
    const unknown = predicted();
    unknown.snapshot(98, 0, [START], 1150, RTT);
    expect([unknown.phase, unknown.view(1150)?.startAt]).toEqual(['confirmed', 1000]);
    for (let q = 100; q <= 115; q += 1) unknown.noteStep(q, q, 0);
    expect([unknown.view(1400)?.hold, unknown.view(1400)?.anchor]).toEqual([true, null]);
  });

  it('거절: 서버가 그 입력을 처리했는데(ack ≥ seq) 준비 중이 아니면 끈다 — 새 누름은 다시 예측할 수 있다', () => {
    for (const ack of [100, 103]) {
      const s = predicted();
      expect(s.view(1150)).not.toBeNull();
      expect(s.snapshot(ack, 0, [], 1200, RTT)).toBe(false);
      expect([s.phase, s.active, s.view(1200)], String(ack)).toEqual(['idle', false, null]);
      s.press(110, 1400, 1, RTT);
      expect([s.phase, s.view(1500)?.startAt, s.view(1500)?.dir]).toEqual(['predicted', 1400, 1]);
    }
  });

  it('연타: 예측이 거절돼도 그 뒤에 누른 공격이 아직 서버로 가는 중이면 끄지 않고 그 누름으로 옮겨 잇는다 — 채움 그대로, 소리 한 번', () => {
    const s = predicted();
    s.noteStep(100 + STRIKE_STEPS, 20, 5);
    // 예측한 입력(100) 뒤에 한 번 더 눌렀다 (새로 예측하지 않는다)
    s.notePress(103);
    // 서버는 100을 버렸다(쿨타임이 한 틱 남았다). 103은 아직 가는 중: 끄지 않는다
    expect(s.snapshot(100, 0, [], 1250, RTT)).toBe(false);
    const v = s.view(1250);
    expect([s.phase, s.active, v?.startAt, v?.fill]).toEqual(['predicted', true, 1000, 0.625]);
    // 방향 · 타격 자리는 그 누름 것으로 다시 잡는다: 방향은 지금 내 방향, 자리는 103 + 11번째 입력
    expect(v?.dir).toBeNull();
    s.noteStep(103 + STRIKE_STEPS - 1, 21, 5);
    expect(s.view(1400)?.anchor).toBeNull();
    s.noteStep(103 + STRIKE_STEPS, 22, 5);
    expect(s.view(1400)?.anchor).toEqual({ x: 22, y: 5 });
    // 서버가 103을 받아들였다: 이어 그린다 (준비 소리는 처음 누를 때 한 번뿐)
    expect(s.snapshot(103, 0.3667, [START], 1350, RTT)).toBe(false);
    expect([s.phase, s.view(1450)?.startAt, s.view(1450)?.hold]).toEqual(['confirmed', 1000, true]);
    s.snapshot(115, 0, [HIT], 1750, RTT);
    expect(s.phase).toBe('idle');
  });

  it('연타: 옮겨 이은 누름도 거절되면 끈다. 뒤 누름을 이미 처리한 스냅샷이면(둘 다 거절) 바로 끈다', () => {
    const s = predicted();
    s.notePress(103);
    s.snapshot(100, 0, [], 1250, RTT);
    expect(s.phase).toBe('predicted');
    s.snapshot(102, 0, [], 1300, RTT);
    expect(s.phase).toBe('predicted');
    s.snapshot(103, 0, [], 1340, RTT);
    expect([s.phase, s.view(1340)]).toEqual(['idle', null]);
    const both = predicted();
    both.notePress(102);
    both.snapshot(104, 0, [], 1250, RTT);
    expect(both.phase).toBe('idle');
  });

  it('연타: 뒤 누름은 예측이 서버 확인을 기다리는 동안에만 적는다 — 확인된 뒤 · 준비가 없을 때의 누름, 지난 준비의 누름은 쓰지 않는다', () => {
    // 확인된 뒤의 누름: 서버가 준비 중이라 버린다. 타격 뒤 표시는 끝난다
    const s = confirmed();
    s.notePress(105);
    s.snapshot(112, 0, [HIT], 1600, RTT);
    expect(s.phase).toBe('idle');
    // 준비가 없을 때의 누름(쿨타임 중 연타)은 적지 않는다
    s.notePress(150);
    // 다음 예측: 지난 준비 때 적은 누름(105 · 150)으로 옮기지 않는다
    s.press(200, 3000, 0, RTT);
    s.snapshot(200, 0, [], 3250, RTT);
    expect(s.phase).toBe('idle');
    // 새 예측은 뒤 누름을 다시 센다
    const again = predicted();
    again.notePress(103);
    again.press(110, 2000, 0, RTT);
    again.snapshot(110, 0, [], 2250, RTT);
    expect(again.phase).toBe('idle');
  });

  it('끝에서 대기: 준비 시간이 지나면 다 찬 채(채움 1) 타격 결과가 올 때까지 남는다 — 정확히 준비 시간부터', () => {
    const s = confirmed();
    expect([s.view(1399.9)?.hold, s.view(1399.9)?.fill]).toEqual([false, (1399.9 - 1000) / W]);
    for (const t of [1400, 1450, 1565, 1400 + CAP - 0.1]) {
      const v = s.view(t);
      expect([v?.hold, v?.fill, v?.startAt, v?.dir], String(t)).toEqual([true, 1, 1000, 0.5]);
    }
    // 서버 준비가 줄어드는 스냅샷이 와도 그대로
    s.snapshot(110, 0.033, [], 1560, RTT);
    expect(s.view(1565)?.hold).toBe(true);
  });

  it('타격 결과(attackHit)가 오면 끝낸다 — 채우는 중이든 대기 중이든, 타격 표시는 이벤트가 그린다', () => {
    const holding = confirmed();
    expect(holding.view(1500)?.hold).toBe(true);
    expect(holding.snapshot(112, 0, [HIT], 1570, RTT)).toBe(false);
    expect([holding.phase, holding.active, holding.view(1570)]).toEqual(['idle', false, null]);
    // 예측이 늦게 시작해(앞의 누름이 받아들여짐) 다 차기 전에 결과가 온 경우
    const filling = confirmed();
    filling.snapshot(112, 0, [HIT], 1350, RTT);
    expect([filling.phase, filling.view(1350)]).toEqual(['idle', null]);
  });

  it('타격 이벤트를 놓쳐도(오래된 스냅샷은 연출을 건너뛴다) 서버 준비가 0이 된 스냅샷에서 끝낸다', () => {
    const s = confirmed();
    s.snapshot(112, 0, [], 1570, RTT);
    expect([s.phase, s.view(1570)]).toEqual(['idle', null]);
  });

  it('세워 둘 자리: 누른 입력 + 11번째 입력을 적용한 자리 — 채우는 동안은 따라가고(null) 대기 중에만 그 자리', () => {
    const s = predicted();
    // 그 앞 입력들은 적지 않는다
    for (let k = 0; k < STRIKE_STEPS; k += 1) s.noteStep(100 + k, 20 + k, 5);
    expect(s.view(1399)?.anchor).toBeNull();
    expect(s.view(1400)?.anchor).toBeNull();
    s.noteStep(100 + STRIKE_STEPS, 31.5, 5.25);
    // 다 차기 전에는 자리를 알아도 내 자리를 따라간다
    expect(s.view(1399)?.anchor).toBeNull();
    expect(s.view(1400)?.anchor).toEqual({ x: 31.5, y: 5.25 });
    // 그 뒤 입력은 덮어쓰지 않는다 (대기 중에는 나를 따라오지 않는다)
    s.noteStep(100 + STRIKE_STEPS + 1, 32, 6);
    s.snapshot(100, 0.1, [], 1300, RTT);
    expect(s.view(1500)?.anchor).toEqual({ x: 31.5, y: 5.25 });
    // 다음 예측은 자리를 다시 잡는다
    s.snapshot(112, 0, [HIT], 1570, RTT);
    s.press(200, 4000, 0, RTT);
    expect(s.view(4400)?.anchor).toBeNull();
    s.noteStep(200 + STRIKE_STEPS, 7, 8);
    expect(s.view(4400)?.anchor).toEqual({ x: 7, y: 8 });
  });

  it('세워 둘 자리: 입력 번호가 건너뛰면(끊겼다 이어짐) 그 뒤 첫 입력의 자리, 준비가 없을 때는 적지 않는다', () => {
    const s = predicted();
    s.noteStep(100 + STRIKE_STEPS + 3, 9, 9);
    expect(s.view(1400)?.anchor).toEqual({ x: 9, y: 9 });
    const idle = make();
    idle.noteStep(500, 1, 1);
    idle.press(600, 9000, 0, RTT);
    expect(idle.view(9400)?.anchor).toBeNull();
  });

  it('대기 상한 = 왕복 + 틱 2칸 + 300ms (최대 1초): 이벤트를 놓쳐도 다 찬 범위가 남지 않는다', () => {
    expect([WINDUP_SHOW.holdTicks, WINDUP_SHOW.holdSlackMs, WINDUP_SHOW.holdMaxMs]).toEqual([2, 300, 1000]);
    expect(holdCapMs(200, DT)).toBeCloseTo(200 + 2 * DT + 300, 9);
    expect(holdCapMs(0, DT)).toBeCloseTo(2 * DT + 300, 9);
    expect(holdCapMs(5000, DT)).toBe(1000);
    for (const bad of [-50, Number.NaN, Number.POSITIVE_INFINITY])
      expect(holdCapMs(bad, DT)).toBeCloseTo(2 * DT + 300, 9);
    const s = confirmed();
    expect(s.view(1400 + CAP - 0.1)).not.toBeNull();
    expect(s.view(1400 + CAP + 0.1)).toBeNull();
    expect([s.phase, s.active]).toEqual(['done', true]);
  });

  it('끝남(상한을 넘김): 서버의 그 준비가 끝날 때까지 다시 그리지 않고 새 예측도 막는다 — 준비 0 · 타격 결과에서 풀린다', () => {
    const s = confirmed();
    s.view(OVER);
    // 서버는 아직 준비 중: 서버 값으로 다시 그리지 않는다 (같은 준비를 두 번 채우지 않는다)
    expect(s.snapshot(111, 0.1, [], OVER + 10, RTT)).toBe(false);
    expect([s.phase, s.active, s.view(OVER + 10)]).toEqual(['done', true, null]);
    s.snapshot(114, 0, [], OVER + 110, RTT);
    expect([s.phase, s.active]).toEqual(['idle', false]);
    const byHit = confirmed();
    byHit.view(OVER);
    byHit.snapshot(114, 0, [HIT], OVER + 110, RTT);
    expect(byHit.phase).toBe('idle');
  });

  it('끝남: 예측한 입력을 서버가 아직 처리하지 않았으면(ack < seq) 준비 0이어도 기다렸다가 처리한 뒤에 푼다', () => {
    const s = predicted();
    expect(s.view(OVER)).toBeNull();
    s.snapshot(90, 0, [], OVER + 10, RTT);
    expect(s.phase).toBe('done');
    // 처리했는데 준비 중: 그 준비가 끝날 때까지
    s.snapshot(100, 0.3, [START], OVER + 110, RTT);
    expect([s.phase, s.view(OVER + 110)]).toEqual(['done', null]);
    s.snapshot(112, 0, [], OVER + 510, RTT);
    expect(s.phase).toBe('idle');
  });

  it('예측하지 못한 준비(서버가 받아들임): 스냅샷의 남은 시간에서 거꾸로 센 시각부터, 방향은 지금 내 방향(null), 소리는 이 이벤트에서', () => {
    const s = make();
    expect(s.snapshot(50, 0.3, [START], 2000, RTT)).toBe(true);
    const v = s.view(2000);
    expect([s.phase, s.active, v?.dir, v?.hold, v?.anchor]).toEqual(['server', true, null, false, null]);
    expect(v?.startAt).toBeCloseTo(2000 - (W - 300), 9);
    expect(v?.fill).toBeCloseTo(0.25, 9);
    // 그 뒤 스냅샷이 다시 시작하지 않는다 · 소리도 한 번
    expect(s.snapshot(52, 0.233, [], 2067, RTT)).toBe(false);
    expect(s.view(2067)?.startAt).toBeCloseTo(1900, 9);
    // 입력 자리는 적지 않는다 (서버가 시작한 준비는 누른 입력을 모른다): 대기 중에도 내 자리
    s.noteStep(61, 3, 3);
    expect([s.view(2300)?.hold, s.view(2300)?.anchor]).toEqual([true, null]);
    s.snapshot(60, 0, [HIT], 2310, RTT);
    expect([s.phase, s.view(2310)]).toEqual(['idle', null]);
  });

  it('예측하지 못한 준비: 이벤트가 빠진 스냅샷이면 소리 없이 그리기만, 준비 0이 되면 끝, 상한을 넘기면 끝남', () => {
    const s = make();
    expect(s.snapshot(50, 0.2, [], 2000, RTT)).toBe(false);
    expect(s.phase).toBe('server');
    s.snapshot(56, 0, [], 2200, RTT);
    expect(s.phase).toBe('idle');
    const late = make();
    late.snapshot(50, 0.2, [], 2000, RTT);
    expect(late.view(2200 + CAP + 1)).toBeNull();
    expect(late.phase).toBe('done');
    late.snapshot(51, 0, [], 2200 + CAP + 100, RTT);
    expect(late.phase).toBe('idle');
  });

  it('기절(stunned)을 받으면 어느 상태든 끈다 — 서버가 그 입력을 처리하기 전이어도', () => {
    const before = predicted();
    expect(before.snapshot(95, 0, [STUNNED], 1100, RTT)).toBe(false);
    expect([before.phase, before.active, before.view(1100)]).toEqual(['idle', false, null]);
    // 뒤늦게 그 입력을 처리했다는 스냅샷이 와도 그대로
    before.snapshot(100, 0, [], 1200, RTT);
    expect(before.phase).toBe('idle');
    const mid = confirmed();
    mid.snapshot(104, 0, [STUNNED], 1300, RTT);
    expect([mid.phase, mid.view(1300)]).toEqual(['idle', null]);
    const server = make();
    server.snapshot(50, 0.3, [START], 2000, RTT);
    server.snapshot(52, 0, [STUNNED], 2070, RTT);
    expect(server.phase).toBe('idle');
    const done = confirmed();
    done.view(OVER);
    done.snapshot(111, 0.05, [STUNNED], OVER + 10, RTT);
    expect(done.phase).toBe('idle');
  });

  it('준비 시작과 기절이 한 스냅샷에 실려 오면: 예측하지 못한 준비였을 때만 소리, 표시는 끈다', () => {
    const idle = make();
    expect(idle.snapshot(50, 0, [START, STUNNED], 2000, RTT)).toBe(true);
    expect(idle.phase).toBe('idle');
    const mine = predicted();
    expect(mine.snapshot(100, 0, [START, STUNNED], 1200, RTT)).toBe(false);
    expect(mine.phase).toBe('idle');
  });

  it('준비 소리는 준비 하나에 한 번: 예측한 준비의 attackStart는 조용하고, 거절된 뒤 서버가 받아들인 다른 누름은 이벤트에서 낸다', () => {
    const s = predicted();
    // 예측(누를 때 냄) → 확인: 조용
    expect(s.snapshot(100, 0.3667, [START], 1200, RTT)).toBe(false);
    expect(s.snapshot(112, 0, [HIT], 1600, RTT)).toBe(false);
    // 다음 누름은 예측했지만 서버가 거절, 그 뒤 예측하지 못한 누름을 서버가 받아들임
    s.press(200, 3000, 0, RTT);
    expect(s.snapshot(200, 0, [], 3200, RTT)).toBe(false);
    expect(s.snapshot(206, 0.3667, [START], 3400, RTT)).toBe(true);
    expect(s.phase).toBe('server');
  });
});
