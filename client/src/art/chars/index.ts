// 새 캐릭터 그림 모음 (캐릭터 리디자인). 역할 · 공통 생존자 · 괴물 그림 모듈을 한곳에서 꺼낸다.
import { COMMON_ART } from './common';
import { GUARD_ART } from './guard';
import { MONSTER_ART } from './monster';
import { RUNNER_ART } from './runner';
import { SCOUT_ART } from './scout';
import type { MonsterArt, SurvivorArt, SurvivorCharId } from './types';

export const SURVIVOR_ART: Readonly<Record<SurvivorCharId, SurvivorArt>> = {
  runner: RUNNER_ART,
  guard: GUARD_ART,
  scout: SCOUT_ART,
  common: COMMON_ART,
};

export { MONSTER_ART };
export type { MonsterArt, SurvivorArt };
