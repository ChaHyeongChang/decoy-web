// 봇의 내 위치 예측 (지연 환경에서 목표를 지나쳐 흔들리지 않게): 사람 클라이언트 예측과 같은 이동 코드
import { describe, expect, it } from 'vitest';
import { predictSelf } from '../../server/src/bots';
import { AliasBook, buildSnapshot, computeVisibility } from '../../server/src/interest';
import { Driver, frame, loadTestBalance, place, readyGame } from '../helpers/fixtures';

const balance = loadTestBalance();

describe('봇 예측', () => {
  it('서버가 아직 처리하지 않은 입력만큼 앞으로 그린 위치가, 그 입력을 서버가 처리한 결과와 같다', () => {
    const game = readyGame();
    place(game, 'p2', 30, 20);
    const d = new Driver(game);
    d.run(3);
    const snap = buildSnapshot(game, 'p2', 0, computeVisibility(game), new AliasBook())!;
    const ack = snap.ack;
    const pending = [1, 2, 3, 4, 5].map((k) => frame(ack + k, 1, 0));
    const predicted = predictSelf(snap, pending, balance);
    // 이미 처리된 입력(ack 이하)은 다시 적용하지 않는다
    expect(predictSelf(snap, [frame(ack, 1, 0)], balance)).toBe(snap);
    game.queueInput('p2', pending);
    for (let k = 0; k < 5; k += 1) game.step();
    const s = game.survivorById('p2')!;
    expect(predicted.you.move.x).toBeCloseTo(s.move.x, 6);
    expect(predicted.you.move.x - snap.you.move.x).toBeCloseTo(5 * balance.survivor.moveSpeed * game.dt, 6);
  });
});
