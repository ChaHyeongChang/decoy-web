// 불씨 · 일일 도전 · 접속 보상 (GAME_DESIGN 12.4, 메타 b): 날짜 · 도전 고르기 · 진행 · 자정 넘김 · 연속 접속 · 재화
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EmblemResult, MatchRating } from '@decoy/shared';
import {
  CHALLENGE_TEAMS,
  PROGRESSION,
  applyRating,
  challengeById,
  challengeDelta,
  claimLogin,
  dailyFor,
  dayKeyOf,
  emptyProfile,
  isDayKey,
  loginAvailable,
  loginReward,
  matchCoins,
  mergeProfiles,
  nextLoginStreak,
  parseProfile,
  pickDaily,
  prevDay,
  serializeProfile,
  validateProgression,
} from '@decoy/shared/meta';
import { META_TEXT } from '../../client/src/data/storyText';

const NOW = 1_793_000_000_000;
const RAW: unknown = JSON.parse(readFileSync('config/progression.json', 'utf8'));

const SURV_EMBLEMS = (tiers: number[]): EmblemResult[] =>
  (['capture', 'rescue', 'survive', 'evade'] as const).map((id, i) => ({
    id,
    tier: (tiers[i] ?? 0) as 0,
    score: 0,
  }));

function rating(id: string, over: Partial<MatchRating> = {}): MatchRating {
  return {
    matchId: id,
    role: 'runner',
    outcome: 'lose',
    durationSec: 300,
    emblems: SURV_EMBLEMS([0, 0, 0, 0]),
    stats: {},
    ...over,
  };
}

describe('날짜 글', () => {
  it('모양 검사 · 만들기', () => {
    expect(isDayKey('2026-10-27')).toBe(true);
    for (const bad of ['2026-13-01', '2026-00-10', '26-10-27', '2026-10-27T00', 20261027, null]) {
      expect(isDayKey(bad), String(bad)).toBe(false);
    }
    expect(dayKeyOf(2026, 1, 5)).toBe('2026-01-05');
  });

  it('전날: 달 · 해 넘김 · 윤년', () => {
    expect(prevDay('2026-10-27')).toBe('2026-10-26');
    expect(prevDay('2026-11-01')).toBe('2026-10-31');
    expect(prevDay('2027-01-01')).toBe('2026-12-31');
    expect(prevDay('2028-03-01')).toBe('2028-02-29');
    expect(prevDay('2027-03-01')).toBe('2027-02-28');
  });
});

describe('일일 도전 고르기', () => {
  it('하루에 생존자 · 괴물 · 아무 역할 하나씩, 같은 날은 늘 같고 난수를 쓰지 않는다', () => {
    const a = pickDaily('2026-10-27', PROGRESSION);
    expect(a).toEqual(pickDaily('2026-10-27', PROGRESSION));
    expect(a.map((id) => challengeById(id, PROGRESSION)?.team)).toEqual([...CHALLENGE_TEAMS]);
  });

  it('날마다 바뀌고, 한 달이면 후보가 고루 나온다', () => {
    const seen = new Map<string, number>();
    const days: string[][] = [];
    for (let d = 1; d <= 30; d += 1) {
      const ids = pickDaily(dayKeyOf(2026, 11, d), PROGRESSION);
      days.push(ids);
      for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    expect(new Set(days.map((x) => x.join())).size).toBeGreaterThan(15);
    const all = CHALLENGE_TEAMS.flatMap((t) => PROGRESSION.daily[t].map((c) => c.id));
    expect([...seen.keys()].length).toBeGreaterThanOrEqual(all.length - 3);
  });

  it('도전마다 문구가 있다 ({n} = 목표)', () => {
    for (const t of CHALLENGE_TEAMS) {
      for (const c of PROGRESSION.daily[t]) {
        expect(META_TEXT.challenges[c.id], c.id).toMatch(/\{n\}/);
      }
    }
  });

  it('progression.json 도전 검사: 겹치는 id · any에 판 기록 수치 · 모르는 종류', () => {
    const clone = (): Record<string, Record<string, Record<string, unknown>[]>> =>
      JSON.parse(JSON.stringify(RAW)) as Record<string, Record<string, Record<string, unknown>[]>>;
    let c = clone();
    c.daily!.monster![0]!.id = c.daily!.survivor![0]!.id;
    expect(() => validateProgression(c)).toThrow(/겹치는 id/);
    c = clone();
    c.daily!.any!.push({ id: 'a-x', kind: 'stat', stat: 'hits', target: 1, reward: 1 });
    expect(() => validateProgression(c)).toThrow(/any/);
    c = clone();
    c.daily!.any![0]!.kind = 'nope';
    expect(() => validateProgression(c)).toThrow(/kind/);
    c = clone();
    c.daily!.survivor = [];
    expect(() => validateProgression(c)).toThrow(/daily.survivor/);
  });
});

describe('도전 진행 · 불씨', () => {
  it('판이 더하는 양: 팀 판의 수치 · 판 수 · 승리 · 높은 평가 수, 다른 팀 판은 0', () => {
    const capture = challengeById('s-capture', PROGRESSION)!;
    expect(challengeDelta(capture.def, capture.team, rating('x', { stats: { captureSec: 25.5 } }))).toBe(
      25.5,
    );
    expect(
      challengeDelta(capture.def, capture.team, rating('x', { role: 'monster', stats: { captureSec: 25 } })),
    ).toBe(0);
    const play = challengeById('a-play', PROGRESSION)!;
    expect(challengeDelta(play.def, play.team, rating('x', { role: 'monster' }))).toBe(1);
    const win = challengeById('a-win', PROGRESSION)!;
    expect(challengeDelta(win.def, win.team, rating('x'))).toBe(0);
    expect(challengeDelta(win.def, win.team, rating('x', { outcome: 'win' }))).toBe(1);
    const gold = challengeById('a-gold', PROGRESSION)!;
    expect(challengeDelta(gold.def, gold.team, rating('x', { emblems: SURV_EMBLEMS([3, 4, 2, 1]) }))).toBe(2);
  });

  it('판 불씨 = 기본 + 단계 합 × 단계당 + 승리, 무효는 승리 없이 절반', () => {
    const c = PROGRESSION.coins;
    expect(matchCoins({ outcome: 'win', emblems: SURV_EMBLEMS([1, 2, 3, 4]) }, PROGRESSION).sum).toBe(
      c.base + 10 * c.perTier + c.win,
    );
    expect(matchCoins({ outcome: 'void', emblems: SURV_EMBLEMS([2, 2, 0, 0]) }, PROGRESSION).sum).toBe(
      Math.round(c.base * c.voidScale) + Math.round(4 * c.perTier * c.voidScale),
    );
  });

  it('판을 적립하면 오늘의 도전이 오르고, 다 채우면 완료 + 보상 불씨 (한 번만)', () => {
    // 오늘 도전에 '판 끝까지 하기'가 있는 날을 찾는다
    let day = '';
    for (let d = 1; d <= 60 && !day; d += 1) {
      const k = dayKeyOf(2026, 11, ((d - 1) % 30) + 1);
      if (pickDaily(k, PROGRESSION).includes('a-play')) day = k;
    }
    expect(day).not.toBe('');
    const play = challengeById('a-play', PROGRESSION)!.def;
    let p = emptyProfile(NOW);
    let completedAt = -1;
    for (let i = 0; i < play.target + 1; i += 1) {
      const r = applyRating(p, rating(`M.${i}`), NOW, PROGRESSION, day)!;
      const step = r.gain.challenges.find((c) => c.id === 'a-play');
      if (step?.completed) completedAt = i;
      if (i === play.target) expect(step).toBeUndefined(); // 끝낸 뒤에는 더 움직이지 않는다
      p = r.profile;
    }
    expect(completedAt).toBe(play.target - 1);
    const idx = p.daily!.ids.indexOf('a-play');
    expect(p.daily!.done[idx]).toBe(true);
    const base = matchCoins({ outcome: 'lose', emblems: SURV_EMBLEMS([0, 0, 0, 0]) }, PROGRESSION).sum;
    expect(p.coins).toBe(base * (play.target + 1) + play.reward);
  });

  it('자정을 넘기면(다른 날) 새 도전 셋 · 진행 0, 어제 진행은 남지 않는다', () => {
    const today = '2026-10-27';
    const tomorrow = '2026-10-28';
    let p = applyRating(emptyProfile(NOW), rating('M.1'), NOW, PROGRESSION, today)!.profile;
    expect(p.daily!.day).toBe(today);
    const view = dailyFor(p, tomorrow, PROGRESSION);
    expect(view.day).toBe(tomorrow);
    expect(view.ids).toEqual(pickDaily(tomorrow, PROGRESSION));
    expect(view.progress.every((x) => x === 0)).toBe(true);
    p = applyRating(p, rating('M.2'), NOW, PROGRESSION, tomorrow)!.profile;
    expect(p.daily!.day).toBe(tomorrow);
  });

  it('저장 형식: 불씨 · 도전 · 접속을 쓰고 다시 읽으면 같고, 이상한 값은 버린다', () => {
    let p = applyRating(emptyProfile(NOW), rating('M.1'), NOW, PROGRESSION, '2026-10-27')!.profile;
    p = claimLogin(p, '2026-10-27', NOW, PROGRESSION)!.profile;
    expect(parseProfile(serializeProfile(p), NOW).profile).toEqual(p);
    const bad = parseProfile(
      JSON.stringify({
        ...p,
        coins: -3,
        daily: { day: 'x', ids: [], progress: [], done: [] },
        login: { last: 'no' },
      }),
      NOW,
    ).profile;
    expect(bad.coins).toBe(0);
    expect(bad.daily).toBeNull();
    expect(bad.login).toBeNull();
  });
});

describe('접속 보상', () => {
  it('하루 한 번: 받으면 그날은 다시 못 받고, 다음 날 다시', () => {
    const p0 = emptyProfile(NOW);
    expect(loginAvailable(p0, '2026-10-27')).toBe(true);
    const a = claimLogin(p0, '2026-10-27', NOW, PROGRESSION)!;
    expect(a.streak).toBe(1);
    expect(a.reward).toBe(loginReward(1, PROGRESSION));
    expect(a.profile.coins).toBe(PROGRESSION.login.base);
    expect(claimLogin(a.profile, '2026-10-27', NOW, PROGRESSION)).toBeNull();
    expect(loginAvailable(a.profile, '2026-10-28')).toBe(true);
  });

  it('연속 날: 어제 받았으면 +1 (maxStreak에서 멈춤), 하루 건너뛰면 1일부터', () => {
    let p = emptyProfile(NOW);
    const days = 10;
    for (let d = 1; d <= days; d += 1) {
      const day = dayKeyOf(2026, 11, d);
      expect(nextLoginStreak(p, day, PROGRESSION)).toBe(Math.min(d, PROGRESSION.login.maxStreak));
      const r = claimLogin(p, day, NOW, PROGRESSION)!;
      expect(r.streak).toBe(Math.min(d, PROGRESSION.login.maxStreak));
      p = r.profile;
    }
    expect(loginReward(99, PROGRESSION)).toBe(
      PROGRESSION.login.base + PROGRESSION.login.step * (PROGRESSION.login.maxStreak - 1),
    );
    // 이틀 건너뜀
    expect(claimLogin(p, dayKeyOf(2026, 11, days + 2), NOW, PROGRESSION)!.streak).toBe(1);
    // 달 넘김 연속
    const oct31 = claimLogin(emptyProfile(NOW), '2026-10-31', NOW, PROGRESSION)!.profile;
    expect(claimLogin(oct31, '2026-11-01', NOW, PROGRESSION)!.streak).toBe(2);
  });

  it('계정으로 합칠 때 불씨는 더하고, 접속 · 도전은 더 늦은 날 쪽 (같은 날이면 계정 쪽)', () => {
    const acc = claimLogin(emptyProfile(NOW), '2026-10-27', NOW, PROGRESSION)!.profile;
    const dev = claimLogin(emptyProfile(NOW), '2026-10-27', NOW, PROGRESSION)!.profile;
    const m = mergeProfiles(acc, { ...dev, coins: dev.coins + 100 }, NOW);
    expect(m.coins).toBe(acc.coins + dev.coins + 100);
    expect(m.login).toEqual(acc.login);
    const later = claimLogin(dev, '2026-10-28', NOW, PROGRESSION)!.profile;
    expect(mergeProfiles(acc, later, NOW).login?.last).toBe('2026-10-28');
  });
});
