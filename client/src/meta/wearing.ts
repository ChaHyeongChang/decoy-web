// 내가 입은 의상 (판 밖 화면 그림용, 메타 c): 로비 역할 카드 · 연습 역할 고르기 · 결과 화면 · 조작 안내는 내 역할 그림에만
// 내 의상을 입힌다 — 남의 의상은 판 밖 화면에 없다(DECISIONS 14절 c 행). 의상 그림 조각이 아직이면 기본을 낸다
import type { CostumeChoice, MonsterCostumeId, Role, SurvivorCostumeId } from '@decoy/shared';
import { BASIC_COSTUMES, costumeForRole } from '@decoy/shared';
import { onCostumeArtReady } from '../art/costumeBake';
import { costumeArtReady } from '../art/chars/costume/registry';

let mine: CostumeChoice = { ...BASIC_COSTUMES };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** 입은 의상을 바꾼다 (기록을 다시 읽었을 때 · 옷장에서 입었을 때). 바뀌었으면 true */
export function setWearing(c: CostumeChoice): boolean {
  if (c.survivor === mine.survivor && c.monster === mine.monster) return false;
  mine = { ...c };
  notify();
  return true;
}

/** 지금 입은 의상 (그림 조각과 무관하게 고른 값 — 서버에 보낼 때는 MetaState.costumes()) */
export function wearing(): CostumeChoice {
  return { ...mine };
}

/** 그 역할 그림에 입힐 내 의상. 그림 조각이 아직이면 기본 */
export function wearingFor(role: Role): SurvivorCostumeId | MonsterCostumeId {
  return costumeArtReady() ? costumeForRole(mine, role) : 'basic';
}

/** 입은 의상이 바뀌거나 그림 조각이 왔을 때 (그림을 다시 그린다) */
export function onWearingChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 그림 조각이 오면 wearingFor 값이 바뀐다
onCostumeArtReady(() => {
  if (mine.survivor !== 'basic' || mine.monster !== 'basic') notify();
});
