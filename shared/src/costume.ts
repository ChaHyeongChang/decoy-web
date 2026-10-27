// 의상 id 검사 · 고른 의상 (판 밖 메타 c, GAME_DESIGN 12.5). 서버 · 클라이언트 공용 순수 함수.
// 의상은 새 캐릭터 그림에 얹는 모양 장식뿐이다 — 판정 원 · 크기 · 속도 · 소리와 무관하다. 서버는 고른 의상을 믿지 않고 id만
// 거른다(가졌는지는 기기 기록이라 서버가 확인하지 않는다 — 꾸미기라 판에 이득이 없다, DECISIONS 14절 c 행)
import {
  MONSTER_COSTUMES,
  SURVIVOR_COSTUMES,
  type CostumeChoice,
  type MonsterCostumeId,
  type Role,
  type SurvivorCostumeId,
} from './types';

export const BASIC_COSTUMES: Readonly<CostumeChoice> = { survivor: 'basic', monster: 'basic' };

export function isSurvivorCostume(v: unknown): v is SurvivorCostumeId {
  return typeof v === 'string' && (SURVIVOR_COSTUMES as readonly string[]).includes(v);
}

export function isMonsterCostume(v: unknown): v is MonsterCostumeId {
  return typeof v === 'string' && (MONSTER_COSTUMES as readonly string[]).includes(v);
}

/** 받은 값을 믿지 않는다: 모르는 의상 · 이상한 값은 기본 */
export function sanitizeCostumeChoice(v: unknown): CostumeChoice {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  return {
    survivor: isSurvivorCostume(o.survivor) ? o.survivor : 'basic',
    monster: isMonsterCostume(o.monster) ? o.monster : 'basic',
  };
}

/** 그 역할로 판에 들어갈 때 입는 의상 id (생존자 역할 = 생존자 의상, 괴물 = 괴물 의상) */
export function costumeForRole(choice: CostumeChoice, role: Role): SurvivorCostumeId | MonsterCostumeId {
  return role === 'monster' ? choice.monster : choice.survivor;
}
