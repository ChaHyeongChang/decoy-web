// 내 성장 기록 (GAME_DESIGN 12장 '저장'): 저장 형식 · 읽기 검사 · 판 보상 적립 · 계정으로 올릴 때 합치기.
// 순수 함수만 (저장소 · 시계 · 난수를 만지지 않는다 — 시각은 인자로 받는다). 지금은 클라이언트가 기기에 저장하고
// (client/src/meta/profileStore.ts), 나중에 로그인 + 서버 저장으로 바꾸면 서버가 같은 함수로 적립 · 합치기를 한다.
//
// 형식 판(v): 칸을 더하는 것은 같은 판에서 한다 — 읽을 때 모르는 칸은 그대로 두었다가 저장할 때 다시 적는다(새 빌드가 적은
// 칸을 옛 빌드가 지우지 않게). 칸의 뜻이 바뀌면 판을 올리고 옮기는 코드를 둔다. 더 높은 판은 읽기만 하고 저장하지 않는다
import {
  MONSTER_EMBLEMS,
  SURVIVOR_EMBLEMS,
  teamOf,
  type EmblemId,
  type EmblemTier,
  type MatchRating,
} from '../types';
import type { Progression } from './progression';
import { levelOf, matchXp, type LevelInfo, type XpGain } from './rating';

export const PROFILE_VERSION = 1;
/** 보상을 준 판 ID를 이만큼 기억한다 (같은 판 결과를 다시 받아도 한 번만) */
export const RECENT_MATCH_IDS = 20;
/** 판 ID 길이 상한 (이상한 값으로 저장소를 채우지 못하게) */
const MATCH_ID_MAX = 64;

export interface TeamCount {
  survivor: number;
  monster: number;
}

export interface Profile {
  v: number;
  /** 누적 경험치 (레벨은 여기서 계산한다 — progression.json 곡선을 바꿔도 경험치는 그대로) */
  xp: number;
  /** 끝까지 한 판 수 · 이긴 판 수 (팀별) */
  played: TeamCount;
  won: TeamCount;
  /** 평가 항목별 지금까지 가장 높은 단계 */
  best: Partial<Record<EmblemId, EmblemTier>>;
  /** 최근에 보상을 준 판 ID (오래된 것부터 지운다) */
  recent: string[];
  /** 처음 만든 · 마지막으로 바뀐 기기 시각 (ms) */
  created: number;
  updated: number;
}

/** 저장할 때 같이 다시 적는 모르는 칸 (새 빌드가 더한 칸) */
export type ProfileExtra = Record<string, unknown>;

export interface ParsedProfile {
  profile: Profile;
  extra: ProfileExtra;
  /**
   * empty: 저장된 것 없음 · ok · corrupt: 읽을 수 없어 새로 시작(저장하면 덮어쓴다) ·
   * newer: 이 빌드보다 높은 판 — 읽을 수 있는 칸만 보이고 저장하지 않는다
   */
  status: 'empty' | 'ok' | 'corrupt' | 'newer';
}

export function emptyProfile(nowMs: number): Profile {
  return {
    v: PROFILE_VERSION,
    xp: 0,
    played: { survivor: 0, monster: 0 },
    won: { survivor: 0, monster: 0 },
    best: {},
    recent: [],
    created: nowMs,
    updated: nowMs,
  };
}

const KNOWN = new Set(['v', 'xp', 'played', 'won', 'best', 'recent', 'created', 'updated']);

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e9) : 0;
}

function time(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function teamCount(v: unknown): TeamCount {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  return { survivor: count(o.survivor), monster: count(o.monster) };
}

function bestTiers(v: unknown): Partial<Record<EmblemId, EmblemTier>> {
  const out: Partial<Record<EmblemId, EmblemTier>> = {};
  if (typeof v !== 'object' || v === null) return out;
  const o = v as Record<string, unknown>;
  for (const id of [...SURVIVOR_EMBLEMS, ...MONSTER_EMBLEMS]) {
    const t = o[id];
    if (typeof t === 'number' && Number.isInteger(t) && t >= 1 && t <= 4) out[id] = t as EmblemTier;
  }
  return out;
}

function matchIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= MATCH_ID_MAX)
    .slice(-RECENT_MATCH_IDS);
}

/** 저장된 글을 읽는다. 무엇이 와도 예외 없이 쓸 수 있는 기록을 돌려준다 */
export function parseProfile(text: string | null, nowMs: number): ParsedProfile {
  if (text === null || text === '') return { profile: emptyProfile(nowMs), extra: {}, status: 'empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { profile: emptyProfile(nowMs), extra: {}, status: 'corrupt' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { profile: emptyProfile(nowMs), extra: {}, status: 'corrupt' };
  }
  const o = raw as Record<string, unknown>;
  const v = o.v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return { profile: emptyProfile(nowMs), extra: {}, status: 'corrupt' };
  }
  const extra: ProfileExtra = {};
  for (const [k, val] of Object.entries(o)) if (!KNOWN.has(k)) extra[k] = val;
  const created = time(o.created, nowMs);
  const profile: Profile = {
    v: PROFILE_VERSION,
    xp: count(o.xp),
    played: teamCount(o.played),
    won: teamCount(o.won),
    best: bestTiers(o.best),
    recent: matchIds(o.recent),
    created,
    updated: time(o.updated, created),
  };
  return { profile, extra, status: v > PROFILE_VERSION ? 'newer' : 'ok' };
}

/** 저장할 글 (모르는 칸을 먼저 깔고 아는 칸으로 덮는다) */
export function serializeProfile(p: Profile, extra: ProfileExtra = {}): string {
  return JSON.stringify({ ...extra, ...p, v: PROFILE_VERSION });
}

export interface MatchGain {
  matchId: string;
  xp: XpGain;
  before: LevelInfo;
  after: LevelInfo;
  /** 이 판에서 새로 오른 최고 단계 */
  newBest: EmblemId[];
}

/**
 * 판 하나의 보상을 적립한다 (같은 판 ID면 null — 이미 받았다). 받은 평가는 믿지 않고 모양을 다시 본다:
 * 팀 평가 항목이 아니거나 단계가 0~4 밖이면 그 칸을 0으로 친다
 */
export function applyRating(
  p: Profile,
  rating: MatchRating,
  nowMs: number,
  prog: Progression,
): { profile: Profile; gain: MatchGain } | null {
  const id = typeof rating.matchId === 'string' ? rating.matchId.slice(0, MATCH_ID_MAX) : '';
  if (id === '' || p.recent.includes(id)) return null;
  const team = teamOf(rating.role);
  const allowed = team === 'monster' ? MONSTER_EMBLEMS : SURVIVOR_EMBLEMS;
  const emblems = allowed.map((eid) => {
    const e = rating.emblems.find((x) => x.id === eid);
    const t = e && Number.isInteger(e.tier) && e.tier >= 0 && e.tier <= 4 ? e.tier : 0;
    return { id: eid, tier: t as EmblemTier, score: e?.score ?? 0 };
  });
  const outcome = rating.outcome === 'win' || rating.outcome === 'void' ? rating.outcome : 'lose';
  const xp = matchXp({ outcome, emblems }, prog);
  const before = levelOf(p.xp, prog);
  const best = { ...p.best };
  const newBest: EmblemId[] = [];
  for (const e of emblems) {
    if (e.tier > (best[e.id] ?? 0)) {
      best[e.id] = e.tier;
      newBest.push(e.id);
    }
  }
  const next: Profile = {
    ...p,
    xp: p.xp + xp.total,
    played: { ...p.played, [team]: p.played[team] + 1 },
    won: { ...p.won, [team]: p.won[team] + (outcome === 'win' ? 1 : 0) },
    best,
    recent: [...p.recent, id].slice(-RECENT_MATCH_IDS),
    updated: nowMs,
  };
  return { profile: next, gain: { matchId: id, xp, before, after: levelOf(next.xp, prog), newBest } };
}

/**
 * 계정으로 올릴 때 합치기 (다음 단계: 선택형 구글 로그인 + 서버 저장). 계정에 이미 기록이 있으면 기기 기록을 더한다:
 * 경험치 · 판 수는 더하고, 최고 단계는 큰 쪽, 받은 판 ID는 합친다(같은 판을 두 번 세지 않게). 같은 기기 기록을 두 번
 * 올리지 않는 것은 서버가 맡는다(올린 뒤 기기 기록을 비우거나 올린 표시를 남긴다)
 */
export function mergeProfiles(account: Profile, device: Profile, nowMs: number): Profile {
  const best = { ...account.best };
  for (const [k, t] of Object.entries(device.best) as [EmblemId, EmblemTier][]) {
    if (t > (best[k] ?? 0)) best[k] = t;
  }
  const recent = [...account.recent];
  for (const id of device.recent) if (!recent.includes(id)) recent.push(id);
  return {
    v: PROFILE_VERSION,
    xp: account.xp + device.xp,
    played: {
      survivor: account.played.survivor + device.played.survivor,
      monster: account.played.monster + device.played.monster,
    },
    won: {
      survivor: account.won.survivor + device.won.survivor,
      monster: account.won.monster + device.won.monster,
    },
    best,
    recent: recent.slice(-RECENT_MATCH_IDS),
    created: Math.min(account.created, device.created),
    updated: nowMs,
  };
}
