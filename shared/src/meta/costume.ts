// 의상 해금 · 입기 (판 밖 메타 c, GAME_DESIGN 12.5). 순수 함수: 불씨로 해금하고 가진 의상만 입는다. 값은 config/progression.json
// costumes (기본은 늘 가져 값이 없다). 결제 · 뽑기 · 광고 없음 — 불씨는 판 · 도전 · 접속으로만 모은다
import { isMonsterCostume, isSurvivorCostume } from '../costume';
import type { Team } from '../types';
import type { Profile } from './profile';
import type { Progression } from './progression';

/** 그 팀의 의상인가 (생존자 의상 id를 괴물 칸에 입히지 못하게) */
export function isTeamCostume(team: Team, id: unknown): boolean {
  return team === 'monster' ? isMonsterCostume(id) : isSurvivorCostume(id);
}

/** 해금 값 (기본 = 0, 모르는 의상 = null) */
export function costumePrice(team: Team, id: string, prog: Progression): number | null {
  if (!isTeamCostume(team, id)) return null;
  if (id === 'basic') return 0;
  const table: Record<string, number> = prog.costumes[team];
  return table[id] ?? null;
}

/** 가졌는가 (기본은 늘 가진다) */
export function ownsCostume(p: Profile, id: string): boolean {
  return id === 'basic' || p.owned.includes(id);
}

export type BuyCostume =
  { ok: true; profile: Profile; price: number } | { ok: false; reason: 'unknown' | 'owned' | 'coins' };

/** 불씨로 해금한다 (입지는 않는다 — 옷장에서 고른다). 이미 가졌거나 불씨가 모자라면 이유를 돌려준다 */
export function buyCostume(p: Profile, team: Team, id: string, nowMs: number, prog: Progression): BuyCostume {
  const price = costumePrice(team, id, prog);
  if (price === null) return { ok: false, reason: 'unknown' };
  if (ownsCostume(p, id)) return { ok: false, reason: 'owned' };
  if (p.coins < price) return { ok: false, reason: 'coins' };
  return {
    ok: true,
    price,
    profile: { ...p, coins: p.coins - price, owned: [...p.owned, id], updated: nowMs },
  };
}

/** 입는다 (가진 그 팀 의상 · 기본만, 아니면 null) */
export function wearCostume(p: Profile, team: Team, id: string, nowMs: number): Profile | null {
  if (!isTeamCostume(team, id) || !ownsCostume(p, id)) return null;
  if (p.wear[team] === id) return p;
  return { ...p, wear: { ...p.wear, [team]: id }, updated: nowMs };
}
