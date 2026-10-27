// 굽기에 입힐 의상 (메타 c): 판 시작 명단(역할마다 의상)을 받아 두고, 의상 그림 묶음(나눠 받는 조각 costume/art.ts)이 왔으면
// 그 의상을, 아직이면 모두 기본을 굽기 값으로 낸다 — 조각이 늦게 오면 그때 그 역할 칸만 다시 굽는다(atlas.ts recostumeAtlas).
// 괴물 화면의 공통 생존자는 이 값과 상관없이 늘 기본이다(charFrames hiddenSpec). 첫 화면 묶음에 남는 작은 모듈이다
import type { MonsterCostumeId, RosterEntry, SurvivorCostumeId } from '@decoy/shared';
import { isMonsterCostume, isSurvivorCostume } from '@decoy/shared';
import { BASIC_COSTUME_SET, sameCostumeSet, type CostumeSet } from './charFrames';
import { costumeArtReady } from './chars/costume/registry';

let wanted: CostumeSet = { ...BASIC_COSTUME_SET };
let loading: Promise<boolean> | null = null;
const readyListeners = new Set<() => void>();

/** 의상 그림 조각을 받는다 (한 번만, 실패하면 다음에 다시). 받으면 등록하고 알린다 */
export function loadCostumeArt(): Promise<boolean> {
  if (costumeArtReady()) return Promise.resolve(true);
  loading ??= import('./chars/costume/art').then(
    (m) => {
      m.registerAllCostumeArt();
      for (const fn of readyListeners) fn();
      return true;
    },
    () => {
      loading = null;
      return false;
    },
  );
  return loading;
}

/** 의상 그림 조각이 왔을 때 (로비 카드 · 결과 그림을 다시 그린다) */
export function onCostumeArtReady(fn: () => void): () => void {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

export function isBasicSet(set: Readonly<CostumeSet>): boolean {
  return sameCostumeSet(set, BASIC_COSTUME_SET);
}

/** 이 판(또는 로비 미리 굽기)에 입힐 의상. 기본이 아닌 의상이 있으면 그림 조각을 받기 시작한다 */
export function setBakeCostumes(set: Readonly<CostumeSet>): void {
  wanted = { ...set };
  if (!isBasicSet(set)) void loadCostumeArt();
}

/** 굽기 값: 조각이 왔으면 입힐 의상, 아직이면 모두 기본 */
export function bakeCostumes(): CostumeSet {
  return costumeArtReady() ? { ...wanted } : { ...BASIC_COSTUME_SET };
}

/**
 * 판 시작 명단 → 역할마다 의상. 명단에 없는 역할(괴물 화면에서는 생존자 셋)은 기본 — 괴물은 생존자 의상을 받지 않는다.
 * 모르는 id는 기본(서버도 거르지만 한 번 더)
 */
export function costumeSetFromRoster(roster: readonly RosterEntry[]): CostumeSet {
  const set: CostumeSet = { ...BASIC_COSTUME_SET };
  for (const e of roster) {
    if (e.role === 'monster') set.monster = isMonsterCostume(e.costume) ? e.costume : 'basic';
    else set[e.role] = isSurvivorCostume(e.costume) ? e.costume : 'basic';
  }
  return set;
}

/** 로비 미리 굽기: 내가 고른 역할에만 내 의상 (다른 자리 의상은 판이 시작될 때 명단으로 안다) */
export function lobbyCostumeSet(
  role: RosterEntry['role'] | null,
  mine: { survivor: SurvivorCostumeId; monster: MonsterCostumeId },
): CostumeSet {
  const set: CostumeSet = { ...BASIC_COSTUME_SET };
  if (role === 'monster') set.monster = mine.monster;
  else if (role) set[role] = mine.survivor;
  return set;
}
