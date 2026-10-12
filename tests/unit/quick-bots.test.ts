// 출시 전 검토: 서버 빠른 매칭 봇(server/src/quickBots.ts)은 만들 때 실전 봇 지도를 미리 계산한다. 서버(index.ts)는
// listen 전에 만들므로, 서버 시작 뒤 첫 봇 판이 시작 틱 안에서 지도를 계산해 그 틱(과 다른 방 스냅샷)이 밀리지 않는다.
// 지도 준비 상태는 모듈 상태라, 이 파일은 그것을 처음 건드리는 것이 createQuickBots여야 한다(시험 파일마다 모듈을 새로 읽는다)
import { describe, expect, it } from 'vitest';
import { practiceMapReady } from '@decoy/shared/sim';
import { codeSeed, createQuickBots } from '../../server/src/quickBots';
import { loadTestBalance } from '../helpers/fixtures';

describe('빠른 매칭 봇 드라이버 (서버)', () => {
  it('만들 때 실전 봇 지도를 미리 계산한다 (그 전에는 준비되지 않은 상태)', () => {
    expect(practiceMapReady()).toBe(false);
    createQuickBots(loadTestBalance(), 5);
    expect(practiceMapReady()).toBe(true);
  });

  it('방 시드는 서버 시드와 방 코드로 정해진다 (한 방의 봇은 같은 시드, 방마다 다르다)', () => {
    expect(codeSeed(5, 'ABCD')).toBe(codeSeed(5, 'ABCD'));
    expect(codeSeed(5, 'ABCD')).not.toBe(codeSeed(5, 'ABCE'));
    expect(codeSeed(5, 'ABCD')).not.toBe(codeSeed(6, 'ABCD'));
  });
});
