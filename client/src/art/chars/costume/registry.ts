// 의상 그림 등록부 (판 밖 메타 c). 역할 그림은 여기서 의상 그림을 찾는다. 의상 그림 모듈(costume/art.ts)은 나눠 받는
// 묶음이라 처음 불러올 때 등록한다 — 등록 전이거나 모르는 의상이면 기본 그림이다(의상은 장식뿐이라 늦게 와도 판은 같다).
// 이 파일은 작게 둔다 (첫 화면 묶음에 들어간다).
import type { MonsterCostumeId, SurvivorCostumeId } from '@decoy/shared';
import type { MonsterCostumeArt, SurvivorCostumeArt } from './types';

const survivors = new Map<string, SurvivorCostumeArt>();
const monsters = new Map<string, MonsterCostumeArt>();

export function registerCostumeArt(s: readonly SurvivorCostumeArt[], m: readonly MonsterCostumeArt[]): void {
  for (const a of s) survivors.set(a.id, a);
  for (const a of m) monsters.set(a.id, a);
}

/** 생존자 의상 그림 (기본 · 등록 전 · 모르는 의상 = null → 역할 기본 그림) */
export function survivorCostumeArt(id: SurvivorCostumeId | undefined): SurvivorCostumeArt | null {
  return id && id !== 'basic' ? (survivors.get(id) ?? null) : null;
}

export function monsterCostumeArt(id: MonsterCostumeId | undefined): MonsterCostumeArt | null {
  return id && id !== 'basic' ? (monsters.get(id) ?? null) : null;
}

/** 등록됐는지 (굽기 전에 의상 묶음을 기다릴지) */
export function costumeArtReady(): boolean {
  return survivors.size > 0 || monsters.size > 0;
}
