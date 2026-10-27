// 판 평가 계산 · 경험치 · 레벨 곡선 · progression.json 검증 (GAME_DESIGN 12장)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MONSTER_EMBLEMS, SURVIVOR_EMBLEMS, type MatchRating } from '@decoy/shared';
import {
  PROGRESSION,
  emblemScore,
  levelOf,
  matchXp,
  outcomeFor,
  rateMatch,
  tierOf,
  validateProgression,
  xpToNext,
} from '@decoy/shared/meta';

const RAW: unknown = JSON.parse(readFileSync('config/progression.json', 'utf8'));

describe('config/progression.json', () => {
  it('모양이 맞고, 빌드에 넣은 값(PROGRESSION)과 같다', () => {
    const v = validateProgression(RAW);
    expect(v.emblems).toEqual(PROGRESSION.emblems);
    expect(v.xp).toEqual(PROGRESSION.xp);
    expect(v.level).toEqual(PROGRESSION.level);
  });

  it('틀린 모양은 어디가 틀렸는지 알린다: 모르는 수치 · 내림차순 기준 · 0점 기준 · 팀 · 빠진 항목', () => {
    const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(RAW)) as Record<string, unknown>;
    const emb = (c: Record<string, unknown>): Record<string, Record<string, unknown>> =>
      c.emblems as Record<string, Record<string, unknown>>;
    let c = clone();
    emb(c).capture!.weights = { nope: 1 };
    expect(() => validateProgression(c)).toThrow(/emblems.capture.weights.nope/);
    c = clone();
    emb(c).hunt!.tiers = [10, 5, 20, 30];
    expect(() => validateProgression(c)).toThrow(/emblems.hunt.tiers.*오름차순/);
    c = clone();
    emb(c).hunt!.tiers = [0, 5, 20, 30];
    expect(() => validateProgression(c)).toThrow(/tiers\[0\]/);
    c = clone();
    emb(c).rescue!.team = 'monster';
    expect(() => validateProgression(c)).toThrow(/emblems.rescue.team/);
    c = clone();
    delete emb(c).gate;
    expect(() => validateProgression(c)).toThrow(/emblems.gate/);
    c = clone();
    (c.xp as Record<string, unknown>).voidScale = 2;
    expect(() => validateProgression(c)).toThrow(/voidScale/);
  });

  it('생존자 넷 · 괴물 넷, 팀이 맞다', () => {
    for (const id of SURVIVOR_EMBLEMS) expect(PROGRESSION.emblems[id].team).toBe('survivor');
    for (const id of MONSTER_EMBLEMS) expect(PROGRESSION.emblems[id].team).toBe('monster');
  });
});

describe('평가 단계', () => {
  it('넘은 기준 수가 단계다 (경계값 포함, 0점은 없음)', () => {
    const t = [10, 24, 38, 52] as const;
    expect(tierOf(0, t)).toBe(0);
    expect(tierOf(9.9, t)).toBe(0);
    expect(tierOf(10, t)).toBe(1);
    expect(tierOf(23.99, t)).toBe(1);
    expect(tierOf(24, t)).toBe(2);
    expect(tierOf(52, t)).toBe(4);
    expect(tierOf(1e6, t)).toBe(4);
  });

  it('점수는 가중치 × 판 기록 수치의 합 (없는 수치는 0)', () => {
    const w = PROGRESSION.emblems.capture.weights;
    expect(emblemScore('capture', { captureSec: 20, exitSec: 3 }, PROGRESSION)).toBeCloseTo(
      20 * (w.captureSec ?? 0) + 3 * (w.exitSec ?? 0),
      6,
    );
    expect(emblemScore('capture', {}, PROGRESSION)).toBe(0);
    // 생존: 갇힘은 감점
    const s = emblemScore(
      'survive',
      { escaped: 1, surviveRatio: 1, cleanEscape: 0, imprisons: 2 },
      PROGRESSION,
    );
    const sw = PROGRESSION.emblems.survive.weights;
    expect(s).toBeCloseTo((sw.escaped ?? 0) + (sw.surviveRatio ?? 0) + 2 * (sw.imprisons ?? 0), 6);
  });

  it('판 하나의 평가: 역할 팀의 항목 넷(순서 고정) · 승패 · 기록 그대로', () => {
    const r = rateMatch(
      {
        matchId: 'X.1.a',
        role: 'guard',
        winner: 'survivors',
        durationSec: 400,
        stats: { rescues: 2, freed: 3 },
      },
      PROGRESSION,
    );
    expect(r.emblems.map((e) => e.id)).toEqual([...SURVIVOR_EMBLEMS]);
    expect(r.outcome).toBe('win');
    expect(r.stats).toEqual({ rescues: 2, freed: 3 });
    expect(r.emblems.find((e) => e.id === 'rescue')!.tier).toBeGreaterThan(0);
    const m = rateMatch(
      { matchId: 'X.1.a', role: 'monster', winner: 'survivors', durationSec: 400, stats: {} },
      PROGRESSION,
    );
    expect(m.emblems.map((e) => e.id)).toEqual([...MONSTER_EMBLEMS]);
    expect(m.outcome).toBe('lose');
    expect(outcomeFor('monster', 'monster')).toBe('win');
    expect(outcomeFor('runner', 'void')).toBe('void');
  });
});

describe('경험치 · 레벨', () => {
  const rating = (
    outcome: MatchRating['outcome'],
    tiers: number[],
  ): Pick<MatchRating, 'outcome' | 'emblems'> => ({
    outcome,
    emblems: SURVIVOR_EMBLEMS.map((id, i) => ({ id, tier: (tiers[i] ?? 0) as 0, score: 0 })),
  });

  it('판 경험치 = 기본 + 단계 합 × 단계당 + 승리, 무효는 승리 없이 절반', () => {
    const x = PROGRESSION.xp;
    expect(matchXp(rating('win', [1, 2, 3, 4]), PROGRESSION)).toEqual({
      base: x.base,
      tiers: 10 * x.perTier,
      win: x.win,
      total: x.base + 10 * x.perTier + x.win,
    });
    expect(matchXp(rating('lose', [0, 0, 0, 0]), PROGRESSION).total).toBe(x.base);
    const v = matchXp(rating('void', [2, 2, 0, 0]), PROGRESSION);
    expect(v.win).toBe(0);
    expect(v.total).toBe(Math.round(x.base * x.voidScale) + Math.round(4 * x.perTier * x.voidScale));
  });

  it('받은 평가의 이상한 단계(음수 · 4 초과 · 소수)는 0~4로 자른다', () => {
    const bad = { outcome: 'lose' as const, emblems: [{ id: 'capture' as const, tier: 99 as 4, score: 0 }] };
    expect(matchXp(bad, PROGRESSION).tiers).toBe(4 * PROGRESSION.xp.perTier);
    const neg = { outcome: 'lose' as const, emblems: [{ id: 'capture' as const, tier: -3 as 0, score: 0 }] };
    expect(matchXp(neg, PROGRESSION).tiers).toBe(0);
  });

  it('레벨 곡선: L → L+1 = min(first + step × (L-1), cap), 최대 레벨에서 멈춘다', () => {
    const l = PROGRESSION.level;
    expect(xpToNext(1, PROGRESSION)).toBe(l.first);
    expect(xpToNext(2, PROGRESSION)).toBe(l.first + l.step);
    expect(xpToNext(1000, PROGRESSION)).toBe(l.cap);
    expect(levelOf(0, PROGRESSION)).toEqual({ level: 1, into: 0, need: l.first, max: false });
    expect(levelOf(l.first - 1, PROGRESSION).level).toBe(1);
    expect(levelOf(l.first, PROGRESSION)).toEqual({ level: 2, into: 0, need: l.first + l.step, max: false });
    expect(levelOf(l.first + 5, PROGRESSION).into).toBe(5);
    const huge = levelOf(1e9, PROGRESSION);
    expect(huge).toEqual({ level: l.max, into: 0, need: 0, max: true });
    // 이상한 값은 0으로
    expect(levelOf(Number.NaN, PROGRESSION).level).toBe(1);
    expect(levelOf(-50, PROGRESSION).level).toBe(1);
  });
});
