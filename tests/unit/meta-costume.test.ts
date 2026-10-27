// 의상 (GAME_DESIGN 12.5, 메타 c): 값은 수치 파일 · 해금은 불씨로만 · 가진 것만 입기 · 기록 읽기 검사 · 합치기 · 서버가 받은 의상 거르기
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASIC_COSTUMES,
  MONSTER_COSTUMES,
  SURVIVOR_COSTUMES,
  costumeForRole,
  sanitizeCostumeChoice,
} from '@decoy/shared';
import {
  PROGRESSION,
  buyCostume,
  costumePrice,
  emptyProfile,
  mergeProfiles,
  ownsCostume,
  parseProfile,
  serializeProfile,
  validateProgression,
  wearCostume,
  type Profile,
} from '@decoy/shared/meta';

const NOW = 1_793_000_000_000;
const RAW: unknown = JSON.parse(readFileSync('config/progression.json', 'utf8'));

function rich(coins: number): Profile {
  return { ...emptyProfile(NOW), coins };
}

describe('의상 값 (config/progression.json costumes)', () => {
  it('기본을 뺀 모든 의상에 값이 있고 수치 파일 그대로다 (150 · 250 · 400)', () => {
    const prog = validateProgression(RAW);
    for (const id of SURVIVOR_COSTUMES.filter((c) => c !== 'basic'))
      expect(costumePrice('survivor', id, prog), id).toBeGreaterThan(0);
    for (const id of MONSTER_COSTUMES.filter((c) => c !== 'basic'))
      expect(costumePrice('monster', id, prog), id).toBeGreaterThan(0);
    expect(costumePrice('survivor', 'basic', prog)).toBe(0);
    expect(prog.costumes).toEqual({
      survivor: { scarf: 150, pack: 250, cape: 400 },
      monster: { hood: 150, feathers: 250, chains: 400 },
    });
  });

  it('값은 수치 파일에서만 온다: 바꾸면 그 값으로 해금한다', () => {
    const prog = validateProgression(RAW);
    const cheap = {
      ...prog,
      costumes: { ...prog.costumes, survivor: { ...prog.costumes.survivor, cape: 10 } },
    };
    const r = buyCostume(rich(10), 'survivor', 'cape', NOW, cheap);
    expect(r.ok && r.price).toBe(10);
  });

  it('수치 파일 검사: 빠진 의상 · 모르는 의상 · 기본에 값 · 정수 아님 · 1 미만은 틀림', () => {
    const clone = (): { costumes: Record<string, Record<string, unknown>> } =>
      JSON.parse(JSON.stringify(RAW)) as { costumes: Record<string, Record<string, unknown>> };
    let c = clone();
    delete c.costumes.survivor!.cape;
    expect(() => validateProgression(c)).toThrow(/costumes.survivor.cape/);
    c = clone();
    c.costumes.monster!.horns = 100;
    expect(() => validateProgression(c)).toThrow(/모르는 의상/);
    c = clone();
    c.costumes.survivor!.basic = 0;
    expect(() => validateProgression(c)).toThrow(/모르는 의상/);
    c = clone();
    c.costumes.survivor!.scarf = 1.5;
    expect(() => validateProgression(c)).toThrow(/정수/);
    c = clone();
    c.costumes.monster!.hood = 0;
    expect(() => validateProgression(c)).toThrow(/costumes.monster.hood/);
    c = clone();
    c.costumes.any = {};
    expect(() => validateProgression(c)).toThrow(/모르는 팀/);
  });
});

describe('해금 · 입기', () => {
  it('불씨가 넉넉하면 값만큼 빼고 가진 의상에 더한다 (입지는 않는다)', () => {
    const r = buyCostume(rich(500), 'survivor', 'pack', NOW + 1, PROGRESSION);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.price).toBe(250);
    expect(r.profile.coins).toBe(250);
    expect(r.profile.owned).toEqual(['pack']);
    expect(r.profile.wear).toEqual(BASIC_COSTUMES);
    expect(r.profile.updated).toBe(NOW + 1);
  });

  it('불씨가 모자라면 · 이미 가졌으면 · 기본이면 해금하지 않는다 (불씨 그대로)', () => {
    expect(buyCostume(rich(149), 'survivor', 'scarf', NOW, PROGRESSION)).toEqual({
      ok: false,
      reason: 'coins',
    });
    const owned = { ...rich(1000), owned: ['scarf'] };
    expect(buyCostume(owned, 'survivor', 'scarf', NOW, PROGRESSION)).toEqual({ ok: false, reason: 'owned' });
    expect(buyCostume(rich(1000), 'survivor', 'basic', NOW, PROGRESSION)).toEqual({
      ok: false,
      reason: 'owned',
    });
  });

  it('다른 팀 의상 · 모르는 의상은 해금 · 입기가 안 된다', () => {
    expect(buyCostume(rich(1000), 'survivor', 'chains', NOW, PROGRESSION)).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(buyCostume(rich(1000), 'monster', 'horns', NOW, PROGRESSION)).toEqual({
      ok: false,
      reason: 'unknown',
    });
    const p = { ...rich(0), owned: ['chains'] };
    expect(wearCostume(p, 'survivor', 'chains', NOW)).toBeNull();
  });

  it('가진 의상 · 기본만 입는다', () => {
    const p = { ...rich(0), owned: ['cape', 'hood'] };
    expect(wearCostume(p, 'survivor', 'scarf', NOW)).toBeNull();
    const worn = wearCostume(p, 'survivor', 'cape', NOW);
    expect(worn?.wear).toEqual({ survivor: 'cape', monster: 'basic' });
    const both = worn && wearCostume(worn, 'monster', 'hood', NOW);
    expect(both?.wear).toEqual({ survivor: 'cape', monster: 'hood' });
    expect(both && wearCostume(both, 'survivor', 'basic', NOW)?.wear.survivor).toBe('basic');
    expect(ownsCostume(p, 'basic')).toBe(true);
    expect(ownsCostume(p, 'scarf')).toBe(false);
  });
});

describe('기록 형식 (decoy:progress owned · wear)', () => {
  it('저장 · 읽기: 가진 의상과 입은 의상이 그대로 돌아온다', () => {
    const p: Profile = {
      ...rich(5),
      owned: ['scarf', 'chains'],
      wear: { survivor: 'scarf', monster: 'chains' },
    };
    const back = parseProfile(serializeProfile(p), NOW).profile;
    expect(back.owned).toEqual(['scarf', 'chains']);
    expect(back.wear).toEqual({ survivor: 'scarf', monster: 'chains' });
  });

  it('옛 기록(칸 없음)은 기본 · 아무것도 없음으로 읽는다', () => {
    const old = JSON.stringify({ v: 1, xp: 10, coins: 3 });
    const p = parseProfile(old, NOW).profile;
    expect(p.owned).toEqual([]);
    expect(p.wear).toEqual(BASIC_COSTUMES);
  });

  it('믿지 않는다: 모르는 · 겹친 의상은 버리고, 가지지 않은 · 다른 팀 의상을 입었으면 기본', () => {
    const text = JSON.stringify({
      v: 1,
      owned: ['scarf', 'scarf', 'crown', 7, 'hood'],
      wear: { survivor: 'cape', monster: 'scarf' },
    });
    const p = parseProfile(text, NOW).profile;
    expect(p.owned).toEqual(['scarf', 'hood']);
    expect(p.wear).toEqual(BASIC_COSTUMES);
    const p2 = parseProfile(
      JSON.stringify({ v: 1, owned: ['hood'], wear: { monster: 'hood' } }),
      NOW,
    ).profile;
    expect(p2.wear).toEqual({ survivor: 'basic', monster: 'hood' });
  });

  it('합치기 (계정으로 올릴 때): 가진 의상은 합치고, 입은 의상은 계정 쪽 (계정이 기본이면 기기 쪽)', () => {
    const account: Profile = { ...rich(0), owned: ['scarf'], wear: { survivor: 'scarf', monster: 'basic' } };
    const device: Profile = {
      ...rich(0),
      owned: ['scarf', 'cape', 'feathers'],
      wear: { survivor: 'cape', monster: 'feathers' },
    };
    const m = mergeProfiles(account, device, NOW);
    expect(m.owned).toEqual(['scarf', 'cape', 'feathers']);
    expect(m.wear).toEqual({ survivor: 'scarf', monster: 'feathers' });
  });
});

describe('서버가 받은 의상 (join · quick)', () => {
  it('모르는 값 · 다른 팀 id · 이상한 모양은 기본으로', () => {
    expect(sanitizeCostumeChoice(undefined)).toEqual(BASIC_COSTUMES);
    expect(sanitizeCostumeChoice('cape')).toEqual(BASIC_COSTUMES);
    expect(sanitizeCostumeChoice({ survivor: 'chains', monster: 'cape' })).toEqual(BASIC_COSTUMES);
    expect(sanitizeCostumeChoice({ survivor: 'pack', monster: 'hood', extra: 1 })).toEqual({
      survivor: 'pack',
      monster: 'hood',
    });
  });

  it('역할에 맞는 의상: 생존자 역할은 생존자 의상, 괴물은 괴물 의상', () => {
    const c = { survivor: 'scarf', monster: 'chains' } as const;
    expect(costumeForRole(c, 'guard')).toBe('scarf');
    expect(costumeForRole(c, 'monster')).toBe('chains');
  });
});
