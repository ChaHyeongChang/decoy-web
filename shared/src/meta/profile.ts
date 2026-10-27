// 내 성장 기록 (GAME_DESIGN 12장 '저장'): 저장 형식 · 읽기 검사 · 판 보상 적립 · 계정으로 올릴 때 합치기.
// 순수 함수만 (저장소 · 시계 · 난수를 만지지 않는다 — 시각은 인자로 받는다). 지금은 클라이언트가 기기에 저장하고
// (client/src/meta/profileStore.ts), 나중에 로그인 + 서버 저장으로 바꾸면 서버가 같은 함수로 적립 · 합치기를 한다.
//
// 형식 판(v): 칸을 더하는 것은 같은 판에서 한다 — 읽을 때 모르는 칸은 그대로 두었다가 저장할 때 다시 적는다(새 빌드가 적은
// 칸을 옛 빌드가 지우지 않게). 칸의 뜻이 바뀌면 판을 올리고 옮기는 코드를 둔다. 더 높은 판은 읽기만 하고 저장하지 않는다
import { isMonsterCostume, isSurvivorCostume } from '../costume';
import {
  MONSTER_EMBLEMS,
  SURVIVOR_EMBLEMS,
  teamOf,
  type CostumeChoice,
  type EmblemId,
  type EmblemTier,
  type MatchRating,
} from '../types';
import {
  challengeById,
  challengeDelta,
  isDayKey,
  loginReward,
  matchCoins,
  pickDaily,
  prevDay,
  type CoinGain,
  type DayKey,
} from './daily';
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
  /** 불씨 (판 밖 재화, 메타 b) */
  coins: number;
  /** 그날의 도전 진행 (다른 날이면 새로 고른다) */
  daily: DailyState | null;
  /** 접속 보상: 마지막으로 받은 날 · 연속 날 */
  login: { last: DayKey; streak: number } | null;
  /** 해금한 의상 id (메타 c, 생존자 · 괴물 id는 겹치지 않는다). 기본(basic)은 늘 가져 적지 않는다 */
  owned: string[];
  /** 입은 의상 (팀별 — 가진 것 · 기본만) */
  wear: CostumeChoice;
}

export interface DailyState {
  day: DayKey;
  /** 도전 id 셋 (생존자 · 괴물 · 아무 역할) */
  ids: string[];
  progress: number[];
  done: boolean[];
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
    coins: 0,
    daily: null,
    login: null,
    owned: [],
    wear: { survivor: 'basic', monster: 'basic' },
  };
}

const KNOWN = new Set([
  'v',
  'xp',
  'played',
  'won',
  'best',
  'recent',
  'created',
  'updated',
  'coins',
  'daily',
  'login',
  'owned',
  'wear',
]);
/** 해금할 수 있는 의상 id (기본 제외) */
/**
 * 가진 의상 id 모양 (길이 · 수 상한). 이 빌드가 모르는 id(다음 빌드가 더한 의상)도 모양만 맞으면 남긴다 — 옛 빌드 탭이
 * 새 빌드에서 불씨로 산 의상을 지우지 않게(같은 판 안에서 칸을 더하는 규칙, 이 파일 머리). 보이기 · 입기는 아는 id만
 * (옷장은 이 빌드의 의상 표만 보이고, 입은 의상은 wearOf가 아는 id만 남긴다)
 */
const COSTUME_ID_MAX = 24;
const OWNED_MAX = 64;
const CHALLENGE_ID_MAX = 24;

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

function dailyState(v: unknown): DailyState | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isDayKey(o.day) || !Array.isArray(o.ids) || !Array.isArray(o.progress) || !Array.isArray(o.done))
    return null;
  const n = o.ids.length;
  if (n === 0 || n > 6 || o.progress.length !== n || o.done.length !== n) return null;
  if (!o.ids.every((x) => typeof x === 'string' && x.length > 0 && x.length <= CHALLENGE_ID_MAX)) return null;
  return {
    day: o.day,
    ids: o.ids as string[],
    progress: o.progress.map((x) =>
      typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(x, 1e9) : 0,
    ),
    done: o.done.map((x) => x === true),
  };
}

function loginState(v: unknown): Profile['login'] {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isDayKey(o.last)) return null;
  return { last: o.last, streak: Math.max(1, count(o.streak)) };
}

/** 가진 의상: 겹침 없이, 모양이 맞는 id면 모르는 것(다음 빌드 의상)도 남긴다 (위 COSTUME_ID_MAX) */
function ownedIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v)
    if (
      typeof x === 'string' &&
      x !== 'basic' &&
      /^[a-z][a-z0-9-]*$/.test(x) &&
      x.length <= COSTUME_ID_MAX &&
      !out.includes(x) &&
      out.length < OWNED_MAX
    )
      out.push(x);
  return out;
}

/** 입은 의상: 가진 것만 (아니면 기본) */
function wearOf(v: unknown, owned: readonly string[]): CostumeChoice {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const ok = (id: string): boolean => id === 'basic' || owned.includes(id);
  return {
    survivor: isSurvivorCostume(o.survivor) && ok(o.survivor) ? o.survivor : 'basic',
    monster: isMonsterCostume(o.monster) && ok(o.monster) ? o.monster : 'basic',
  };
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
  const owned = ownedIds(o.owned);
  const profile: Profile = {
    v: PROFILE_VERSION,
    xp: count(o.xp),
    played: teamCount(o.played),
    won: teamCount(o.won),
    best: bestTiers(o.best),
    recent: matchIds(o.recent),
    created,
    updated: time(o.updated, created),
    coins: count(o.coins),
    daily: dailyState(o.daily),
    login: loginState(o.login),
    owned,
    wear: wearOf(o.wear, owned),
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
  coins: CoinGain;
  /** 이 판이 움직인 오늘의 도전 (끝낸 것은 completed) */
  challenges: ChallengeStep[];
}

export interface ChallengeStep {
  id: string;
  before: number;
  after: number;
  target: number;
  completed: boolean;
  reward: number;
}

/**
 * 오늘의 도전 (보이기 · 적립 공용): 저장된 것이 오늘 것이고 아는 도전이면 그대로, 아니면 오늘 날짜로 새로 고른다(진행 0).
 * 수치 파일이 바뀌어 모르는 id가 섞였으면 새로 고른다
 */
export function dailyFor(p: Profile, day: DayKey, prog: Progression): DailyState {
  const d = p.daily;
  if (d && d.day === day && d.ids.every((id) => challengeById(id, prog) !== null)) {
    return { day, ids: [...d.ids], progress: [...d.progress], done: [...d.done] };
  }
  const ids = pickDaily(day, prog);
  return { day, ids, progress: ids.map(() => 0), done: ids.map(() => false) };
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
  /** 적립하는 날 (기기 날짜, 일일 도전) */
  day: DayKey,
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
  // 불씨 · 오늘의 도전 (판이 끝난 날에 센다 — 자정을 넘겨 끝난 판은 새 날 도전에)
  const coinBase = matchCoins({ outcome, emblems }, prog);
  const daily = dailyFor(p, day, prog);
  const steps: ChallengeStep[] = [];
  let challengeCoins = 0;
  daily.ids.forEach((cid, i) => {
    const found = challengeById(cid, prog);
    if (!found || daily.done[i]) return;
    const delta = challengeDelta(found.def, found.team, {
      role: rating.role,
      outcome,
      emblems,
      stats: rating.stats ?? {},
    });
    if (delta <= 0) return;
    const before = daily.progress[i] ?? 0;
    const after = Math.min(found.def.target, before + delta);
    const completed = after >= found.def.target - 1e-9;
    daily.progress[i] = after;
    daily.done[i] = completed;
    if (completed) challengeCoins += found.def.reward;
    steps.push({
      id: cid,
      before,
      after,
      target: found.def.target,
      completed,
      reward: completed ? found.def.reward : 0,
    });
  });
  const coins: CoinGain = {
    base: coinBase.base,
    tiers: coinBase.tiers,
    win: coinBase.win,
    challenges: challengeCoins,
    total: coinBase.sum + challengeCoins,
  };
  const next: Profile = {
    ...p,
    xp: p.xp + xp.total,
    coins: p.coins + coins.total,
    daily,
    played: { ...p.played, [team]: p.played[team] + 1 },
    won: { ...p.won, [team]: p.won[team] + (outcome === 'win' ? 1 : 0) },
    best,
    recent: [...p.recent, id].slice(-RECENT_MATCH_IDS),
    updated: nowMs,
  };
  return {
    profile: next,
    gain: { matchId: id, xp, before, after: levelOf(next.xp, prog), newBest, coins, challenges: steps },
  };
}

/** 오늘 접속 보상을 아직 받지 않았는가 */
export function loginAvailable(p: Profile, day: DayKey): boolean {
  return p.login?.last !== day;
}

/**
 * 오늘 접속 보상 받기 (하루 한 번): 어제 받았으면 연속 +1(maxStreak에서 멈춤), 아니면 1일부터. 이미 받았으면 null.
 * 시계를 되돌려도 막지 않는다(꾸미기 보상뿐)
 */
export function claimLogin(
  p: Profile,
  day: DayKey,
  nowMs: number,
  prog: Progression,
): { profile: Profile; reward: number; streak: number } | null {
  if (!isDayKey(day) || !loginAvailable(p, day)) return null;
  const streak =
    p.login && p.login.last === prevDay(day) ? Math.min(prog.login.maxStreak, p.login.streak + 1) : 1;
  const reward = loginReward(streak, prog);
  return {
    profile: { ...p, coins: p.coins + reward, login: { last: day, streak }, updated: nowMs },
    reward,
    streak,
  };
}

/** 오늘 받을 접속 보상이 몇 일째 연속인가 (보이기용 — 받기 전에) */
export function nextLoginStreak(p: Profile, day: DayKey, prog: Progression): number {
  if (p.login?.last === day) return p.login.streak;
  return p.login && p.login.last === prevDay(day) ? Math.min(prog.login.maxStreak, p.login.streak + 1) : 1;
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
    coins: account.coins + device.coins,
    // 오늘의 도전 · 접속 보상은 더 늦은 날 쪽 (같은 날이면 계정 쪽 — 하루 보상을 두 번 받지 않게)
    daily:
      account.daily && device.daily
        ? device.daily.day > account.daily.day
          ? device.daily
          : account.daily
        : (account.daily ?? device.daily),
    login:
      account.login && device.login
        ? device.login.last > account.login.last
          ? device.login
          : account.login
        : (account.login ?? device.login),
    // 가진 의상은 합치고, 입은 의상은 계정 쪽 (계정 쪽이 기본이면 기기 쪽)
    owned: [...account.owned, ...device.owned.filter((id) => !account.owned.includes(id))],
    wear: {
      survivor: account.wear.survivor !== 'basic' ? account.wear.survivor : device.wear.survivor,
      monster: account.wear.monster !== 'basic' ? account.wear.monster : device.wear.monster,
    },
  };
}
