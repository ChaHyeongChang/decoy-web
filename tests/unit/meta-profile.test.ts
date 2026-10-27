// 성장 기록 형식 (GAME_DESIGN 12장 '저장'): 읽기 검사 · 모르는 칸 보존 · 높은 판 읽기만 · 판 적립 · 같은 판 한 번 · 합치기
import { describe, expect, it } from 'vitest';
import type { MatchRating } from '@decoy/shared';
import {
  PROFILE_VERSION,
  PROGRESSION,
  RECENT_MATCH_IDS,
  applyRating,
  emptyProfile,
  levelOf,
  mergeProfiles,
  parseProfile,
  serializeProfile,
} from '@decoy/shared/meta';

const NOW = 1_793_000_000_000;
const DAY = '2026-10-27';

function rating(id: string, over: Partial<MatchRating> = {}): MatchRating {
  return {
    matchId: id,
    role: 'runner',
    outcome: 'win',
    durationSec: 400,
    emblems: [
      { id: 'capture', tier: 2, score: 25 },
      { id: 'rescue', tier: 0, score: 0 },
      { id: 'survive', tier: 4, score: 80 },
      { id: 'evade', tier: 1, score: 9 },
    ],
    stats: { captureSec: 25 },
    ...over,
  };
}

describe('기록 읽기', () => {
  it('없음 · 빈 글 → 새 기록 (empty)', () => {
    expect(parseProfile(null, NOW).status).toBe('empty');
    expect(parseProfile('', NOW)).toMatchObject({ status: 'empty', profile: emptyProfile(NOW) });
  });

  it('깨진 글 · 배열 · 판 없음 → 새 기록 (corrupt)', () => {
    for (const t of ['{', '[]', '42', '"x"', '{"xp":5}', '{"v":0}', '{"v":"1"}']) {
      const p = parseProfile(t, NOW);
      expect(p.status, t).toBe('corrupt');
      expect(p.profile.xp).toBe(0);
    }
  });

  it('칸마다 검사: 음수 · 수 아님 · 이상한 단계 · 너무 긴 판 ID는 버리고 나머지는 살린다', () => {
    const p = parseProfile(
      JSON.stringify({
        v: 1,
        xp: -5,
        played: { survivor: 3, monster: 'x' },
        won: { survivor: 1.7 },
        best: { capture: 3, rescue: 9, hunt: 0, nope: 2 },
        recent: ['a', 5, 'x'.repeat(65), 'b'],
        created: 'yesterday',
        updated: 100,
      }),
      NOW,
    );
    expect(p.status).toBe('ok');
    expect(p.profile).toEqual({
      v: PROFILE_VERSION,
      xp: 0,
      played: { survivor: 3, monster: 0 },
      won: { survivor: 1, monster: 0 },
      best: { capture: 3 },
      recent: ['a', 'b'],
      created: NOW,
      updated: 100,
      coins: 0,
      daily: null,
      login: null,
      owned: [],
      wear: { survivor: 'basic', monster: 'basic' },
    });
  });

  it('모르는 칸(새 빌드가 더한 칸)은 그대로 두었다가 저장할 때 다시 적는다', () => {
    const text = JSON.stringify({ ...emptyProfile(1), xp: 50, coins: 340, titles: { now: 't-first' } });
    const p = parseProfile(text, NOW);
    expect(p.extra).toEqual({ titles: { now: 't-first' } });
    expect(p.profile.coins).toBe(340);
    const again = JSON.parse(serializeProfile({ ...p.profile, xp: 60 }, p.extra)) as Record<string, unknown>;
    expect(again).toMatchObject({ v: PROFILE_VERSION, xp: 60, coins: 340, titles: { now: 't-first' } });
  });

  it('더 높은 판은 읽을 수 있는 칸만 보이고 newer로 알린다 (저장하지 않게)', () => {
    const p = parseProfile(JSON.stringify({ ...emptyProfile(1), v: PROFILE_VERSION + 1, xp: 999 }), NOW);
    expect(p.status).toBe('newer');
    expect(p.profile.xp).toBe(999);
  });

  it('쓰고 다시 읽으면 같다', () => {
    const a = applyRating(emptyProfile(NOW), rating('M.1'), NOW + 5, PROGRESSION, DAY)!.profile;
    const b = parseProfile(serializeProfile(a), NOW + 10);
    expect(b.status).toBe('ok');
    expect(b.profile).toEqual(a);
  });
});

describe('판 적립', () => {
  it('경험치 · 판 수 · 이긴 판 · 최고 단계 · 받은 판 ID, 레벨 전후', () => {
    const r = applyRating(emptyProfile(NOW), rating('M.1'), NOW + 5, PROGRESSION, DAY)!;
    const xp = PROGRESSION.xp.base + 7 * PROGRESSION.xp.perTier + PROGRESSION.xp.win;
    expect(r.profile.xp).toBe(xp);
    expect(r.profile.played).toEqual({ survivor: 1, monster: 0 });
    expect(r.profile.won).toEqual({ survivor: 1, monster: 0 });
    expect(r.profile.best).toEqual({ capture: 2, survive: 4, evade: 1 });
    expect(r.profile.recent).toEqual(['M.1']);
    expect(r.profile.updated).toBe(NOW + 5);
    expect(r.gain.xp.total).toBe(xp);
    expect(r.gain.before.level).toBe(1);
    expect(r.gain.after).toEqual(levelOf(xp, PROGRESSION));
    expect(r.gain.newBest).toEqual(['capture', 'survive', 'evade']);
  });

  it('같은 판 ID는 한 번만 (재접속해 결과를 다시 받아도)', () => {
    const first = applyRating(emptyProfile(NOW), rating('M.1'), NOW, PROGRESSION, DAY)!;
    expect(applyRating(first.profile, rating('M.1'), NOW, PROGRESSION, DAY)).toBeNull();
    expect(applyRating(first.profile, rating(''), NOW, PROGRESSION, DAY)).toBeNull();
  });

  it(`받은 판 ID는 최근 ${RECENT_MATCH_IDS}개만 기억한다`, () => {
    let p = emptyProfile(NOW);
    for (let i = 0; i < RECENT_MATCH_IDS + 5; i += 1)
      p = applyRating(p, rating(`M.${i}`), NOW, PROGRESSION, DAY)!.profile;
    expect(p.recent).toHaveLength(RECENT_MATCH_IDS);
    expect(p.recent[0]).toBe('M.5');
  });

  it('괴물 판 · 진 판 · 무효 판', () => {
    const m = applyRating(
      emptyProfile(NOW),
      rating('M.2', {
        role: 'monster',
        outcome: 'lose',
        emblems: [
          { id: 'hunt', tier: 3, score: 50 },
          { id: 'deny', tier: 0, score: 0 },
          { id: 'track', tier: 2, score: 40 },
          { id: 'gate', tier: 1, score: 12 },
        ],
      }),
      NOW,
      PROGRESSION,
      DAY,
    )!;
    expect(m.profile.played).toEqual({ survivor: 0, monster: 1 });
    expect(m.profile.won).toEqual({ survivor: 0, monster: 0 });
    expect(m.profile.best).toEqual({ hunt: 3, track: 2, gate: 1 });
    const v = applyRating(emptyProfile(NOW), rating('M.3', { outcome: 'void' }), NOW, PROGRESSION, DAY)!;
    expect(v.gain.xp.win).toBe(0);
    expect(v.profile.won.survivor).toBe(0);
  });

  it('받은 평가를 믿지 않는다: 남의 팀 항목 · 범위 밖 단계는 0으로', () => {
    const r = applyRating(
      emptyProfile(NOW),
      rating('M.4', {
        role: 'scout',
        emblems: [
          { id: 'hunt', tier: 4, score: 999 },
          { id: 'capture', tier: 7 as 4, score: 1 },
        ],
      }),
      NOW,
      PROGRESSION,
      DAY,
    )!;
    expect(r.gain.xp.tiers).toBe(0);
    expect(r.profile.best).toEqual({});
  });
});

describe('계정으로 올릴 때 합치기 (다음 단계 서버 저장)', () => {
  it('경험치 · 판 수는 더하고, 최고 단계는 큰 쪽, 받은 판 ID는 합친다', () => {
    let acc = emptyProfile(NOW - 1000);
    acc = applyRating(acc, rating('A.1'), NOW, PROGRESSION, DAY)!.profile;
    let dev = emptyProfile(NOW - 5000);
    dev = applyRating(
      dev,
      rating('D.1', { emblems: [{ id: 'capture', tier: 4, score: 60 }] }),
      NOW,
      PROGRESSION,
      DAY,
    )!.profile;
    dev = applyRating(dev, rating('A.1'), NOW, PROGRESSION, DAY)!.profile;
    const m = mergeProfiles(acc, dev, NOW + 1);
    expect(m.xp).toBe(acc.xp + dev.xp);
    expect(m.played.survivor).toBe(3);
    expect(m.best.capture).toBe(4);
    expect(m.best.survive).toBe(4);
    expect(m.recent).toEqual(['A.1', 'D.1']);
    expect(m.created).toBe(NOW - 5000);
    expect(m.updated).toBe(NOW + 1);
  });
});
