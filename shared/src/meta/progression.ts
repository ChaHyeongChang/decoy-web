// 판 밖 성장 · 보상 수치 (config/progression.json, 수치만 — 이름 · 설명 문구는 client/src/data/storyText.ts META_TEXT)의 타입. 규칙 · 판정 수치(balance.json)와 따로 둔다:
// 꾸미기 보상뿐이라 판 안에는 영향이 없다(GAME_DESIGN 12장). 서버(평가)와 클라이언트(보상 · 저장)가 빌드에 넣은 같은 파일을 쓴다
import type { EmblemId, RatingStatId, Team } from '../types';
import progressionJson from '../../../config/progression.json';

export interface EmblemDef {
  team: Team;
  /** 점수 = Σ 가중치 × 판 기록 수치 */
  weights: Partial<Record<RatingStatId, number>>;
  /** 단계 1~4의 최소 점수 (오름차순 넷) */
  tiers: [number, number, number, number];
}

export interface Progression {
  version: number;
  emblems: Record<EmblemId, EmblemDef>;
  xp: {
    /** 판을 끝까지 하면 */
    base: number;
    /** 평가 등급 1마다 */
    perTier: number;
    /** 이긴 팀 */
    win: number;
    /** 무효 판은 이 배율 (승리 보너스 없음) */
    voidScale: number;
  };
  /** 레벨 L → L+1 필요 경험치 = min(first + step × (L-1), cap). max 레벨에서 멈춘다 */
  level: { first: number; step: number; cap: number; max: number };
}

/**
 * 빌드에 넣은 수치 (서버 · 클라이언트 같은 파일). 모양 검사(progressionCheck.ts)는 단위 시험과 서버 시작 때 한다 —
 * 클라이언트 첫 묶음을 가볍게(DECISIONS 14절 '번들 예산')
 */
export const PROGRESSION = progressionJson as unknown as Progression;
