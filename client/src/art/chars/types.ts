// 새 캐릭터 그림의 자세 · 모듈 형식 (캐릭터 리디자인). 순수 타입 + 기본값. 판정과 무관한 장식 값이다.
import type { Drawing } from './kit';

/** 새 캐릭터 그림 id. common = 괴물 화면의 공통 생존자 (역할 단서 없음) */
export type CharId = 'runner' | 'guard' | 'scout' | 'common' | 'monster';
export type SurvivorCharId = 'runner' | 'guard' | 'scout' | 'common';
/** 역할 그림 id (생존자 화면) */
export type RoleCharId = 'runner' | 'guard' | 'scout';

/** 몸 톤: 보통 · 사망 회색 · 피격 흰 번쩍 실루엣 */
export type Tone = 'normal' | 'gray' | 'flash';

/**
 * 생존자 자세 (위에서 본 그림). 굽기는 이 값을 몇 단계로 끊어 프레임으로 만든다(걷기 8 · 능력 4 등).
 * mode: free = 보통, captive = 수감 중(어깨를 움츠리고 손을 모음), reach = 구조 중(두 손을 앞으로 뻗어 자물쇠를 만짐)
 */
export interface SurvivorPose {
  /** 걷기 위상 0~2π (π/2 · 3π/2에 발이 가장 멀리 나감) */
  walk: number;
  /** 걷기 세기 0~1 (0 = 서 있음) */
  stride: number;
  /** 능력 동작 0~1 (러너 질주 · 가드 밀치기 · 스카우트 탐지. 0 = 안 씀) */
  action: number;
  /** 피격 젖힘 0~1 */
  hit: number;
  mode: 'free' | 'captive' | 'reach';
  tone: Tone;
}

export const SURVIVOR_REST: SurvivorPose = {
  walk: 0,
  stride: 0,
  action: 0,
  hit: 0,
  mode: 'free',
  tone: 'normal',
};

/**
 * 공통 생존자 자세 (괴물 화면). 서버가 괴물에게 보내는 것(위치 · 바라봄 · 상태)으로 정할 수 있는 값만 있다 —
 * 역할 · 체력 · 능력 · 구조 중 여부가 없다(interest.ts hiddenSurvivorView: hp · rescue · abilityCd = null, VISUAL_SPEC 0장 ③).
 * captive = 수감 상태(status, 괴물도 받는다)
 */
export interface HiddenPose {
  walk: number;
  stride: number;
  captive: boolean;
  tone: Tone;
}

export const HIDDEN_REST: HiddenPose = { walk: 0, stride: 0, captive: false, tone: 'normal' };

/** 괴물 자세 (위에서 본 그림) */
export interface MonsterPose {
  walk: number;
  stride: number;
  /** 망토 자락 물결 위상 0~2π */
  cloak: number;
  /** 공격 준비 0~1 (팔을 뒤로 젖혀 발톱을 든다, attack.windup 0.4초) */
  windup: number;
  /** 타격 0~1 (발톱을 앞으로 휘두름, 120ms) */
  strike: number;
  /** 돌진 0~1 (앞으로 몸을 낮추고 늘어남) */
  dash: number;
  /** 포효 0~1 (고개를 젖히고 팔을 머리 양옆으로 들어 올림 — 위에서 보면 몸 가까이) */
  roar: number;
  /** 기절 0~1 (처짐) */
  stun: number;
  eyes: 'open' | 'blink' | 'stun';
  tone: Tone;
}

export const MONSTER_REST: MonsterPose = {
  walk: 0,
  stride: 0,
  cloak: 0,
  windup: 0,
  strike: 0,
  dash: 0,
  roar: 0,
  stun: 0,
  eyes: 'open',
  tone: 'normal',
};

/** 정면 그림 자세 (로비 역할 카드 · 결과 화면). t = 장식 시각 (초, 숨쉬기 · 망토), bust = 머리 · 어깨만 (상반신, 64~160px) */
export interface FrontPose {
  t: number;
  bust: boolean;
  tone: Tone;
}

export const FRONT_REST: FrontPose = { t: 0, bust: false, tone: 'normal' };

/** 그리는 값: w = 외곽선 두께 (그림 단위) */
export interface ArtOptions {
  w: number;
}

/** 역할 생존자 그림 모듈 (생존자 화면) */
export interface SurvivorArt {
  readonly id: RoleCharId;
  /** 위에서 본 그림 (단위 = 몸 반지름 1, +x = 바라보는 방향) */
  top(p: SurvivorPose, o: ArtOptions): Drawing;
  /** 정면 그림 (상자 [−1, 1]²) */
  front(p: FrontPose, o: ArtOptions): Drawing;
  /** 위에서 본 그림이 차지하는 반쪽 크기 (몸 반지름 배수, 외곽선 제외, 모든 자세). 굽기 프레임 크기 */
  readonly topExtent: number;
}

/** 공통 생존자 그림 모듈 (괴물 화면). 자세는 HiddenPose뿐이라 역할 · 체력 · 능력 · 구조 값을 넣을 수 없다 */
export interface CommonArt {
  readonly id: 'common';
  top(p: HiddenPose, o: ArtOptions): Drawing;
  front(p: FrontPose, o: ArtOptions): Drawing;
  readonly topExtent: number;
}

/** 괴물 그림 모듈 */
export interface MonsterArt {
  readonly id: 'monster';
  top(p: MonsterPose, o: ArtOptions): Drawing;
  front(p: FrontPose, o: ArtOptions): Drawing;
  readonly topExtent: number;
}

// ───────────────────────── 자세 값 다듬기 ─────────────────────────
// 그림 함수 들머리에서 부른다: 세기 값은 0~1로 자르고, 위상(walk · cloak) · 시각이 유한값이 아니면 0으로 둔다
// (범위 밖 값이 그림을 판정보다 크게 늘이거나 경로에 NaN이 들어가지 않게).

function unit(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

export function cleanSurvivorPose(p: SurvivorPose): SurvivorPose {
  return {
    ...p,
    walk: finite(p.walk),
    stride: unit(p.stride),
    action: unit(p.action),
    hit: unit(p.hit),
  };
}

export function cleanHiddenPose(p: HiddenPose): HiddenPose {
  return { ...p, walk: finite(p.walk), stride: unit(p.stride) };
}

export function cleanMonsterPose(p: MonsterPose): MonsterPose {
  return {
    ...p,
    walk: finite(p.walk),
    stride: unit(p.stride),
    cloak: finite(p.cloak),
    windup: unit(p.windup),
    strike: unit(p.strike),
    dash: unit(p.dash),
    roar: unit(p.roar),
    stun: unit(p.stun),
  };
}

export function cleanFrontPose(p: FrontPose): FrontPose {
  return { ...p, t: finite(p.t) };
}
