// 새 캐릭터 그림 모음 (캐릭터 리디자인). 역할 · 공통 생존자 · 괴물 그림 모듈을 한곳에서 꺼낸다.
// 공통 생존자(괴물 화면)는 역할 그림 표(SURVIVOR_ART)에 넣지 않는다: 자세 타입(HiddenPose)이 달라
// `SURVIVOR_ART[role]`로 공통 그림을 꺼내거나 공통 그림에 역할 · 능력 값을 넘기는 길이 타입에서 막힌다.
import { COMMON_ART } from './common';
import { GUARD_ART } from './guard';
import { MONSTER_ART } from './monster';
import { RUNNER_ART } from './runner';
import { SCOUT_ART } from './scout';
import type { CommonArt, MonsterArt, RoleCharId, SurvivorArt } from './types';

export const SURVIVOR_ART: Readonly<Record<RoleCharId, SurvivorArt>> = {
  runner: RUNNER_ART,
  guard: GUARD_ART,
  scout: SCOUT_ART,
};

export { COMMON_ART, MONSTER_ART };
export type { CommonArt, MonsterArt, SurvivorArt };

// 재질 색 (VISUAL_SPEC 4.5 '새 캐릭터 재질 색' 표의 `chars.…` 코드 열이 이 값과 대조된다)
export { MAT, DEAD_GRAY } from './survivorBase';
export { RUNNER_COLOR } from './runner';
export { GUARD_COLOR } from './guard';
export { SCOUT_COLOR } from './scout';
export { COMMON_COLOR } from './common';
export { MONSTER_COLOR } from './monster';
