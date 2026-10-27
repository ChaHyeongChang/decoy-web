// 판 평가 → 보상 계산 (GAME_DESIGN 12장). 순수 함수만: 서버(평가)와 클라이언트(지금은 기기에서 보상 적립)가 같은 코드를 쓰고,
// 나중에 서버 저장으로 바꾸면 서버가 그대로 쓴다. 시계 · 난수 · 저장소를 만지지 않는다
import {
  MONSTER_EMBLEMS,
  SURVIVOR_EMBLEMS,
  teamOf,
  type EmblemId,
  type EmblemResult,
  type EmblemTier,
  type MatchRating,
  type RatingStats,
  type Role,
} from '../types';
import type { Progression } from './progression';

/** 팀의 평가 항목 넷 (순서 고정) */
export function emblemsFor(role: Role): readonly EmblemId[] {
  return teamOf(role) === 'monster' ? MONSTER_EMBLEMS : SURVIVOR_EMBLEMS;
}

/** 점수 → 등급 (넘은 기준 수, 0~4) */
export function tierOf(score: number, tiers: readonly number[]): EmblemTier {
  let t = 0;
  for (const min of tiers) if (score >= min - 1e-9) t += 1;
  return Math.min(4, t) as EmblemTier;
}

/** 한 평가 항목의 점수 (가중합, 소수 첫째 자리) */
export function emblemScore(id: EmblemId, stats: RatingStats, prog: Progression): number {
  let s = 0;
  for (const [k, w] of Object.entries(prog.emblems[id].weights)) {
    const v = stats[k as keyof RatingStats];
    if (typeof v === 'number' && Number.isFinite(v)) s += w * v;
  }
  return Math.round(s * 10) / 10;
}

export function rateEmblems(role: Role, stats: RatingStats, prog: Progression): EmblemResult[] {
  return emblemsFor(role).map((id) => {
    const score = emblemScore(id, stats, prog);
    return { id, tier: tierOf(score, prog.emblems[id].tiers), score };
  });
}

export type MatchOutcome = MatchRating['outcome'];

export function outcomeFor(role: Role, winner: 'survivors' | 'monster' | 'void'): MatchOutcome {
  if (winner === 'void') return 'void';
  return (winner === 'monster') === (role === 'monster') ? 'win' : 'lose';
}

/** 판 기록의 한 사람 → 그 사람 평가 */
export function rateMatch(
  input: {
    matchId: string;
    role: Role;
    winner: 'survivors' | 'monster' | 'void';
    durationSec: number;
    stats: RatingStats;
  },
  prog: Progression,
): MatchRating {
  return {
    matchId: input.matchId,
    role: input.role,
    outcome: outcomeFor(input.role, input.winner),
    durationSec: input.durationSec,
    emblems: rateEmblems(input.role, input.stats, prog),
    stats: { ...input.stats },
  };
}

// ───────────────────────── 경험치 · 레벨 ─────────────────────────

export interface XpGain {
  base: number;
  tiers: number;
  win: number;
  total: number;
}

/**
 * 판 하나의 경험치: (기본 + 등급 합 × 등급당 + 승리) — 무효 판은 승리 없이 voidScale 배.
 * 받은 평가를 믿지 않고 등급을 0~4로 자른다(나중에 서버가 그대로 쓴다)
 */
export function matchXp(rating: Pick<MatchRating, 'outcome' | 'emblems'>, prog: Progression): XpGain {
  const tierSum = rating.emblems.reduce((a, e) => a + Math.max(0, Math.min(4, Math.floor(e.tier))), 0);
  const scale = rating.outcome === 'void' ? prog.xp.voidScale : 1;
  const base = Math.round(prog.xp.base * scale);
  const tiers = Math.round(tierSum * prog.xp.perTier * scale);
  const win = rating.outcome === 'win' ? prog.xp.win : 0;
  return { base, tiers, win, total: base + tiers + win };
}

/** 레벨 L에서 L+1로 가는 데 필요한 경험치 */
export function xpToNext(level: number, prog: Progression): number {
  const { first, step, cap } = prog.level;
  return Math.min(cap, first + step * Math.max(0, level - 1));
}

export interface LevelInfo {
  level: number;
  /** 이번 레벨에서 쌓은 경험치 */
  into: number;
  /** 다음 레벨까지 필요한 양 (최대 레벨이면 0) */
  need: number;
  max: boolean;
}

/** 누적 경험치 → 레벨 (1부터) */
export function levelOf(totalXp: number, prog: Progression): LevelInfo {
  let xp = Math.max(0, Math.floor(Number.isFinite(totalXp) ? totalXp : 0));
  let level = 1;
  while (level < prog.level.max) {
    const need = xpToNext(level, prog);
    if (xp < need) return { level, into: xp, need, max: false };
    xp -= need;
    level += 1;
  }
  return { level: prog.level.max, into: 0, need: 0, max: true };
}
