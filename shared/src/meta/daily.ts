// 불씨 · 일일 도전 · 접속 보상 (GAME_DESIGN 12.4, 메타 b). 순수 함수만 — 날짜는 'YYYY-MM-DD' 글(기기 날짜, 자정 기준)로 받는다.
// 날짜를 만드는 일(기기 시계 → 그 기기의 날짜)은 클라이언트가 하고, 여기서는 그 글로 계산만 한다(서버가 나중에 그대로 쓴다).
// 시계 조작은 막지 않는다(꾸미기 보상뿐 — 사용자 결정)
import { teamOf, type EmblemResult, type MatchRating, type Team } from '../types';
import type { ChallengeDef, ChallengeTeam, Progression } from './progression';

/** 기기 날짜 글 (자정 기준) */
export type DayKey = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayKey(v: unknown): v is DayKey {
  if (typeof v !== 'string') return false;
  const m = DAY_RE.exec(v);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 연 · 월(1~12) · 일 → 날짜 글 */
export function dayKeyOf(year: number, month: number, day: number): DayKey {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/** 바로 전날 (달 · 해 넘김 · 윤년 — 날짜 계산만, 시간대와 무관) */
export function prevDay(day: DayKey): DayKey {
  const m = DAY_RE.exec(day);
  if (!m) return day;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86_400_000;
  const d = new Date(t);
  return dayKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 날짜 글의 해시 (FNV-1a 32비트): 도전 고르기를 기기 · 서버가 같게 (난수를 쓰지 않는다) */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const CHALLENGE_TEAMS: readonly ChallengeTeam[] = ['survivor', 'monster', 'any'];

/** 그날의 도전 셋 (생존자 · 괴물 · 아무 역할 하나씩) — 같은 날이면 늘 같다 */
export function pickDaily(day: DayKey, prog: Progression): string[] {
  return CHALLENGE_TEAMS.map((team) => {
    const list = prog.daily[team];
    return list[hash(`${day}|${team}`) % list.length]?.id ?? '';
  });
}

export function challengeById(
  id: string,
  prog: Progression,
): { def: ChallengeDef; team: ChallengeTeam } | null {
  for (const team of CHALLENGE_TEAMS) {
    const def = prog.daily[team].find((c) => c.id === id);
    if (def) return { def, team };
  }
  return null;
}

/** 판 하나가 이 도전에 더하는 양 (그 팀 판이 아니면 0) */
export function challengeDelta(
  def: ChallengeDef,
  team: ChallengeTeam,
  rating: Pick<MatchRating, 'role' | 'outcome' | 'emblems' | 'stats'>,
): number {
  const mine: Team = teamOf(rating.role);
  if (team !== 'any' && team !== mine) return 0;
  switch (def.kind) {
    case 'stat': {
      const v = rating.stats[def.stat];
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    }
    case 'play':
      return 1;
    case 'win':
      return rating.outcome === 'win' ? 1 : 0;
    case 'tier':
      return rating.emblems.filter((e: EmblemResult) => e.tier >= def.minTier).length;
    default:
      return 0;
  }
}

export interface CoinGain {
  base: number;
  tiers: number;
  win: number;
  /** 이 판에 끝낸 도전 보상 합 */
  challenges: number;
  total: number;
}

/** 판 하나의 불씨 (도전 보상 빼고) — 경험치와 같은 꼴, 무효 판은 승리 없이 voidScale 배 */
export function matchCoins(
  rating: Pick<MatchRating, 'outcome' | 'emblems'>,
  prog: Progression,
): Omit<CoinGain, 'challenges' | 'total'> & { sum: number } {
  const tierSum = rating.emblems.reduce((a, e) => a + Math.max(0, Math.min(4, Math.floor(e.tier))), 0);
  const scale = rating.outcome === 'void' ? prog.coins.voidScale : 1;
  const base = Math.round(prog.coins.base * scale);
  const tiers = Math.round(tierSum * prog.coins.perTier * scale);
  const win = rating.outcome === 'win' ? prog.coins.win : 0;
  return { base, tiers, win, sum: base + tiers + win };
}

/** 그날 접속 보상 (연속 날 streak는 1부터) */
export function loginReward(streak: number, prog: Progression): number {
  const s = Math.max(1, Math.min(prog.login.maxStreak, Math.floor(streak)));
  return prog.login.base + prog.login.step * (s - 1);
}
