// 새 캐릭터 그림 모음 (캐릭터 리디자인). 역할 · 공통 생존자 · 괴물 그림 모듈을 한곳에서 꺼낸다.
// 공통 생존자(괴물 화면)는 역할 그림 표(SURVIVOR_ART)에 넣지 않는다: 자세 타입(HiddenPose)이 달라
// `SURVIVOR_ART[role]`로 공통 그림을 꺼내거나 공통 그림에 역할 · 능력 값을 넘기는 길이 타입에서 막힌다.
//
// 따라가는 카메라 3단계: 위에서 본 게임 그림(top)은 여기서 반지름을 다듬어 내보낸다(kit.squeezeDrawing) — 확대 화면에서
// 그림이 판정 범위보다 눈에 띄게 커 보이지 않게 가장 먼 점을 1.15r 안으로(measure.SIZE_RULE). 몸(knee 안)은 그대로라 판정
// 원과 같은 크기로 보이고, 앞 돌출(후드 · 방패 · 망원경 · 필터 · 발톱 · 돌진 자락)만 몸 쪽으로 당겨져 머리 · 장비가 어깨에
// 더 붙은 굵은 실루엣이 된다. 정면 그림(front: 로비 · 결과)은 그대로다
import { COMMON_ART as COMMON_RAW } from './common';
import { GUARD_ART } from './guard';
import { squeezeDrawing, transformDrawing } from './kit';
import { MONSTER_ART as MONSTER_RAW } from './monster';
import { RUNNER_ART } from './runner';
import { SCOUT_ART } from './scout';
import type { Drawing } from './kit';
import type { CommonArt, MonsterArt, RoleCharId, SurvivorArt } from './types';

/** 반지름 다듬기 값 (판정 반지름 단위): 생존자는 몸 둘레(0.95r) 밖을, 괴물은 자락 끝(1.05r) 밖을 1.15r 안으로 */
export const TOP_SQUEEZE = {
  survivor: { knee: 0.95, limit: 1.15 },
  monster: { knee: 1.05, limit: 1.15 },
} as const;

/**
 * 다듬기 전 옆 폭 배율 (위 그림 y축): 앞 돌출을 당기면 실루엣이 둥글어져 서로 닮는다(VISUAL_SPEC 0장 ④ 겹침 기준) →
 * 러너는 조금, 괴물 화면 공통 생존자는 더 가늘게 해 가드(넓은 방패) · 스카우트와 갈리게 한다
 */
export const TOP_WIDTH = { runner: 0.94, guard: 1, scout: 1, common: 0.9 } as const;

function shaped(dr: Drawing, ky: number): Drawing {
  const { knee, limit } = TOP_SQUEEZE.survivor;
  return squeezeDrawing(ky === 1 ? dr : transformDrawing(dr, 1, 0, 0, ky), knee, limit);
}

function squeezedSurvivor(a: SurvivorArt, ky: number): SurvivorArt {
  return { ...a, top: (p, o) => shaped(a.top(p, o), ky) };
}

export const SURVIVOR_ART: Readonly<Record<RoleCharId, SurvivorArt>> = {
  runner: squeezedSurvivor(RUNNER_ART, TOP_WIDTH.runner),
  guard: squeezedSurvivor(GUARD_ART, TOP_WIDTH.guard),
  scout: squeezedSurvivor(SCOUT_ART, TOP_WIDTH.scout),
};

export const COMMON_ART: CommonArt = {
  ...COMMON_RAW,
  top: (p, o) => shaped(COMMON_RAW.top(p, o), TOP_WIDTH.common),
};

export const MONSTER_ART: MonsterArt = {
  ...MONSTER_RAW,
  top: (p, o) => squeezeDrawing(MONSTER_RAW.top(p, o), TOP_SQUEEZE.monster.knee, TOP_SQUEEZE.monster.limit),
};
export type { CommonArt, MonsterArt, SurvivorArt };

// 재질 색 (VISUAL_SPEC 4.5 '새 캐릭터 재질 색' 표의 `chars.…` 코드 열이 이 값과 대조된다)
export { MAT, DEAD_GRAY } from './survivorBase';
export { RUNNER_COLOR } from './runner';
export { GUARD_COLOR } from './guard';
export { SCOUT_COLOR } from './scout';
export { COMMON_COLOR } from './common';
export { MONSTER_COLOR } from './monster';
