// 실전 봇 두뇌 (M13b): 봇과 연습 · 빠른 매칭(M13c)의 빈자리. 모든 두뇌는 자기에게 온(정보 차단된) 스냅샷만 본다.
// 괴물: 순찰 → 보이면 추적 · 공격, 거점 알림이 오면 그쪽으로, 가끔 포효 · 돌진, 시야 전환
// 생존자: 점령 → 괴물이 보이면 도주 · 능력 → 동료가 갇히면 구조 → 두 거점 뒤 둘이 함께 탈출
import type { Role } from '../index';
import { devBotBrain, type BotBrain } from './botBrains';

/** 역할에 맞는 실전 봇 두뇌. seed는 같은 판을 다시 돌릴 때 같은 결정을 내리게 하는 값 */
export function practiceBrain(role: Role, seed = 1): BotBrain {
  void seed;
  // 계약 커밋: 자리만 잡는다 (실전 두뇌는 다음 커밋)
  return devBotBrain(role);
}
