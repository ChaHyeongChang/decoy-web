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
