// 실전 봇 두뇌 (M13b): 봇과 연습 · 빠른 매칭(M13c)의 빈자리.
// 두뇌는 decide()로 받은 것 — 자기에게 온(정보 차단된) 스냅샷 · MatchInfo · Balance — 과 공개 지도(map.ts: 타일 · 거점 ·
// 탈출구 · 감옥 · 구조 지점)만 본다. 게임 상태 · 다른 사람 스냅샷 · 전역 상태는 읽지 않는다.
// 결정적이다: 같은 seed + 같은 스냅샷이면 같은 입력 (시드 난수 Rng만, 괴물 화면 생존자 배열 순서 · 임시 ID에 기대지 않는다)
//
// 괴물: 순찰(탐색 시야) → 자유 생존자가 보이면 추적(추적 시야) · 사거리 안에서 공격, 중간 거리 직선이면 가끔 돌진.
//       거점 점령 알림 · 포효 핑 · 구조 알림 · 탈출구 열림 알림이 오면 그곳을 조사하고, 한동안 아무도 못 보면 포효.
//       동료가 갇혀 있으면 감옥 반경 밖 감시 자리에서 구조 지점을 지켜본다. 감옥 캠핑 감속 · 거점 지키기 유예를 넘기지 않게
//       잠깐 벗어났다 돌아온다
// 생존자: 거점 점령(둘이 함께 1.5배, 시드로 짝과 혼자 갈 거점을 정한다) → 괴물이 가까이 보이면 괴물보다 먼저 닿는 곳으로
//       도주 · 능력(러너 질주, 가드 밀치기, 스카우트 탐지) → 동료가 갇히면 구조 지점에 가장 가까운 사람이 구조 →
//       두 거점 뒤 모두가 같은 정보(괴물을 마지막으로 본 곳 · 메모 비밀번호)로 같은 탈출구를 골라 함께 연다
//
// 파일 구성 (플레이테스트 반영 c): 공용 지도 계산 practiceMap.ts · 괴물 practiceMonster.ts · 생존자 practiceSurvivor.ts.
// 이 파일은 진입점(역할에 맞는 두뇌)과 밖에서 쓰는 이름만 내보낸다
import type { Role } from '../index';
import type { BotBrain } from './botBrains';
import { preparePracticeMap } from './practiceMap';
import { PracticeMonsterBrain } from './practiceMonster';
import { PracticeSurvivorBrain } from './practiceSurvivor';

export {
  FLEE_SPOTS,
  MONSTER_CROSS,
  MONSTER_EXIT_LOOP,
  MONSTER_LOOP,
  WATCH_SPOTS,
  pointOpen,
  practiceMapReady,
  preparePracticeMap,
} from './practiceMap';
export { PracticeMonsterBrain, nextGuarded } from './practiceMonster';
export { PracticeSurvivorBrain, pickPoint, survivorPlan, teamPlan } from './practiceSurvivor';

/** 역할에 맞는 실전 봇 두뇌. seed는 같은 판을 다시 돌릴 때 같은 결정을 내리게 하는 값 (한 판의 봇은 같은 seed를 쓴다) */
export function practiceBrain(role: Role, seed = 1): BotBrain {
  preparePracticeMap();
  if (role === 'monster') return new PracticeMonsterBrain(seed);
  return new PracticeSurvivorBrain(role, seed);
}
