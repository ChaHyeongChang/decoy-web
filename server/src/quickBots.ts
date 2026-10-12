// 빠른 매칭 빈자리 봇 (M13c): 같은 프로세스 실전 봇 (기기 안 연습과 같은 두뇌 · 드라이버, 소켓 없음)
import type { Balance } from '@decoy/shared';
import { BotDriver, practiceBrain, preparePracticeMap } from '@decoy/shared/sim';

/** 방 코드 → 정수 (한 방의 봇이 같은 시드를 쓰게) */
export function codeSeed(seed: number, code: string): number {
  let h = seed | 0;
  for (let i = 0; i < code.length; i += 1) h = (Math.imul(h, 31) + code.charCodeAt(i)) | 0;
  return h;
}

/**
 * 빠른 매칭 봇 드라이버. 한 방의 봇은 같은 시드(생존자 봇의 점령 계획이 서로 맞물린다), 판마다 다르게 판 수를 섞는다.
 * 만들 때 실전 봇 지도(preparePracticeMap: 고정 지점 길 거리 필드 · 열린 정도, 약 25~45ms)를 미리 계산한다. 서버는 listen
 * 전에 이것을 만들므로, 서버 시작 뒤 첫 봇 판이 시작 틱 안에서 계산해 그 틱과 다른 방 스냅샷이 밀리지 않는다 (출시 전 검토)
 */
export function createQuickBots(balance: Balance, seed: number): BotDriver {
  preparePracticeMap();
  return new BotDriver(
    (info, _seat, room) => practiceBrain(info.role, (codeSeed(seed, room.code) + room.matchCount * 7919) | 0),
    balance,
  );
}
