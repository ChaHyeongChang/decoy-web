// 기기 저장소 · 성장 기록 상태 (GAME_DESIGN 12장 '저장'): 저장 · 불러오기 · 저장 실패에도 게임은 그대로 · 다른 탭과 겹쳐도 잃지 않음
import { describe, expect, it } from 'vitest';
import type { MatchRating } from '@decoy/shared';
import { PROFILE_VERSION, PROGRESSION, emptyProfile, serializeProfile } from '@decoy/shared/meta';
import { MetaState, localDay, msToMidnight } from '../../client/src/meta/meta';
import { DeviceProfileStore } from '../../client/src/meta/profileStore';
import type { StorageLike } from '../../client/src/storageKeys';

const KEY = 'decoy:progress';
let clock = 1_793_000_000_000;
const now = (): number => clock;

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const blocked: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

/** 읽기는 되고 쓰기만 막힌 저장소 (가득 참) */
function full(seed: string | null): StorageLike {
  return {
    getItem: () => seed,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => undefined,
  };
}

function rating(id: string): MatchRating {
  return {
    matchId: id,
    role: 'guard',
    outcome: 'win',
    durationSec: 300,
    emblems: [
      { id: 'capture', tier: 1, score: 10 },
      { id: 'rescue', tier: 3, score: 30 },
      { id: 'survive', tier: 2, score: 25 },
      { id: 'evade', tier: 0, score: 0 },
    ],
    stats: {},
  };
}

const XP = PROGRESSION.xp.base + 6 * PROGRESSION.xp.perTier + PROGRESSION.xp.win;

describe('기기 저장소 (decoy:progress)', () => {
  it('저장 · 불러오기: 적립하면 저장하고, 새로 연 앱이 같은 기록을 읽는다', async () => {
    const s = mem();
    const a = new MetaState(new DeviceProfileStore(s), now);
    await a.ready;
    expect(a.level().level).toBe(1);
    const r = await a.applyRating(rating('M.1'));
    expect(r.saved).toBe(true);
    expect(r.gain?.xp.total).toBe(XP);
    const stored = JSON.parse(s.data.get(KEY) ?? 'null') as { v: number; xp: number };
    expect(stored).toMatchObject({ v: PROFILE_VERSION, xp: XP });
    const b = new MetaState(new DeviceProfileStore(s), now);
    await b.ready;
    expect(b.current.xp).toBe(XP);
    expect(b.current.played.survivor).toBe(1);
  });

  it('저장소가 막혀도(사생활 보호 등) 예외 없이 이번 접속 동안 메모리에 쌓고 saved=false', async () => {
    const m = new MetaState(new DeviceProfileStore(blocked), now);
    await m.ready;
    const r = await m.applyRating(rating('M.1'));
    expect(r.saved).toBe(false);
    expect(r.gain?.xp.total).toBe(XP);
    expect(m.current.xp).toBe(XP);
    // 같은 접속 안에서는 같은 판을 다시 주지 않는다
    const again = await m.applyRating(rating('M.1'));
    expect(again.gain).toBeNull();
    const next = await m.applyRating(rating('M.2'));
    expect(m.current.xp).toBe(2 * XP);
    expect(next.saved).toBe(false);
  });

  it('저장소가 가득 차면 saved=false, 읽은 기록 위에 메모리로 쌓는다', async () => {
    const seed = serializeProfile({ ...emptyProfile(1), xp: 500 });
    const m = new MetaState(new DeviceProfileStore(full(seed)), now);
    await m.ready;
    expect(m.current.xp).toBe(500);
    const r = await m.applyRating(rating('M.9'));
    expect(r.saved).toBe(false);
    expect(m.current.xp).toBe(500 + XP);
  });

  it('읽기는 되고 쓰기만 막히면: 다음 적립이 저장소의 옛 기록으로 돌아가지 않고 메모리 위에 쌓인다 (같은 판은 한 번)', async () => {
    const seed = serializeProfile({ ...emptyProfile(1), xp: 500 });
    const m = new MetaState(new DeviceProfileStore(full(seed)), now);
    await m.ready;
    expect((await m.applyRating(rating('M.1'))).saved).toBe(false);
    const second = await m.applyRating(rating('M.2'));
    expect(second.saved).toBe(false);
    expect(m.current.xp).toBe(500 + 2 * XP);
    // 재접속으로 같은 판 결과를 다시 받아도 두 번 주지 않는다
    expect((await m.applyRating(rating('M.1'))).gain).toBeNull();
    expect(m.current.xp).toBe(500 + 2 * XP);
  });

  it('쓰기가 막힌 채 접속 보상을 받고 판을 끝내도 불씨가 둘 다 남는다', async () => {
    const t = new Date(2026, 9, 27, 12, 0, 0).getTime();
    const m = new MetaState(new DeviceProfileStore(full(serializeProfile(emptyProfile(1)))), () => t);
    await m.ready;
    const claimed = await m.claimLogin();
    expect(claimed?.saved).toBe(false);
    const r = await m.applyRating(rating('M.1'));
    expect(m.current.coins).toBe((claimed?.reward ?? 0) + (r.gain?.coins.total ?? 0));
    // 받은 날도 메모리에 남아 두 번 받지 않는다
    expect(await m.claimLogin()).toBeNull();
  });

  it('지워지면(브라우저 데이터 삭제) 레벨 1부터 다시 — 게임은 그대로', async () => {
    const s = mem();
    const a = new MetaState(new DeviceProfileStore(s), now);
    await a.applyRating(rating('M.1'));
    s.data.clear();
    const b = new MetaState(new DeviceProfileStore(s), now);
    await b.ready;
    expect(b.level().level).toBe(1);
    expect((await b.applyRating(rating('M.2'))).saved).toBe(true);
  });

  it('깨진 글은 새 기록으로 시작하고 적립하면 덮어쓴다', async () => {
    const s = mem();
    s.data.set(KEY, '{not json');
    const m = new MetaState(new DeviceProfileStore(s), now);
    await m.ready;
    expect(m.current.xp).toBe(0);
    await m.applyRating(rating('M.1'));
    expect(JSON.parse(s.data.get(KEY) ?? '{}')).toMatchObject({ xp: XP });
  });

  it('더 높은 판의 기록(새 빌드가 쓴 것)은 보이기만 하고 저장하지 않는다', async () => {
    const s = mem();
    const newer = JSON.stringify({ ...emptyProfile(1), v: PROFILE_VERSION + 1, xp: 700, future: true });
    s.data.set(KEY, newer);
    const m = new MetaState(new DeviceProfileStore(s), now);
    await m.ready;
    expect(m.current.xp).toBe(700);
    const r = await m.applyRating(rating('M.1'));
    expect(r.saved).toBe(false);
    expect(s.data.get(KEY)).toBe(newer);
  });

  it('다른 탭이 그사이 적립했으면 그 위에 더한다 (덮어써 잃지 않고, 같은 판은 한 번)', async () => {
    const s = mem();
    const tabA = new MetaState(new DeviceProfileStore(s), now);
    const tabB = new MetaState(new DeviceProfileStore(s), now);
    await Promise.all([tabA.ready, tabB.ready]);
    await tabA.applyRating(rating('A.1'));
    clock += 1000;
    const r = await tabB.applyRating(rating('B.1'));
    expect(r.gain).not.toBeNull();
    expect(tabB.current.xp).toBe(2 * XP);
    expect(JSON.parse(s.data.get(KEY) ?? '{}')).toMatchObject({ xp: 2 * XP, recent: ['A.1', 'B.1'] });
    // 탭 A가 받은 판을 탭 B가 다시 받아도 한 번
    expect((await tabB.applyRating(rating('A.1'))).gain).toBeNull();
  });

  it('바뀌면 알린다 (레벨 칩이 다시 그린다)', async () => {
    const m = new MetaState(new DeviceProfileStore(mem()), now);
    let n = 0;
    m.onChange(() => (n += 1));
    await m.ready;
    const before = n;
    await m.applyRating(rating('M.1'));
    expect(n).toBeGreaterThan(before);
  });

  it('모르는 칸(다음 빌드가 더할 칸)은 적립 · 저장 뒤에도 남는다', async () => {
    const s = mem();
    s.data.set(KEY, JSON.stringify({ ...emptyProfile(1), coins: 120, titles: ['x'] }));
    const m = new MetaState(new DeviceProfileStore(s), now);
    const r = await m.applyRating(rating('M.1'));
    expect(JSON.parse(s.data.get(KEY) ?? '{}')).toMatchObject({
      coins: 120 + (r.gain?.coins.total ?? 0),
      titles: ['x'],
      xp: XP,
    });
  });
});

describe('자정 넘김 (가짜 시계, 이 기기 시간)', () => {
  it('23:59에 접속 보상을 받고, 자정이 지나면 다시 받을 수 있고 연속 2일, 오늘의 도전도 바뀐다', async () => {
    // 시간대와 무관하게: 이 기기의 지역 시각으로 만든다
    let t = new Date(2026, 9, 27, 23, 59, 0).getTime();
    const s = mem();
    const m = new MetaState(new DeviceProfileStore(s), () => t);
    await m.ready;
    expect(localDay(t)).toBe('2026-10-27');
    expect(m.login()).toEqual({ available: true, streak: 1 });
    const first = await m.claimLogin();
    expect(first).toMatchObject({ streak: 1, saved: true });
    expect(m.login().available).toBe(false);
    expect(await m.claimLogin()).toBeNull();
    const before = m.daily();
    expect(msToMidnight(t)).toBe(60_000);
    t += 61_000; // 00:00:01
    expect(localDay(t)).toBe('2026-10-28');
    expect(m.login()).toEqual({ available: true, streak: 2 });
    const second = await m.claimLogin();
    expect(second?.streak).toBe(2);
    expect(m.current.coins).toBe((first?.reward ?? 0) + (second?.reward ?? 0));
    const after = m.daily();
    expect(after.day).toBe('2026-10-28');
    expect(before.day).toBe('2026-10-27');
  });

  it('다른 탭이 이미 받았으면 두 번 주지 않는다 (받기 직전에 다시 읽기)', async () => {
    const t = new Date(2026, 9, 27, 12, 0, 0).getTime();
    const s = mem();
    const a = new MetaState(new DeviceProfileStore(s), () => t);
    const b = new MetaState(new DeviceProfileStore(s), () => t);
    await Promise.all([a.ready, b.ready]);
    expect(await a.claimLogin()).not.toBeNull();
    expect(await b.claimLogin()).toBeNull();
  });
});

describe('의상 해금 · 입기 (옷장, 메타 c)', () => {
  it('불씨로 해금하면 저장되고, 입으면 다음 접속에도 입은 채 (판에 들어갈 때 보내는 값)', async () => {
    const s = mem();
    s.data.set(KEY, serializeProfile({ ...emptyProfile(1), coins: 300 }));
    const m = new MetaState(new DeviceProfileStore(s), now);
    await m.ready;
    expect(m.costumes()).toEqual({ survivor: 'basic', monster: 'basic' });
    expect(await m.wearCostume('survivor', 'pack')).toBe(false);
    expect(await m.buyCostume('survivor', 'pack')).toEqual({ ok: true, price: 250, saved: true });
    expect(await m.buyCostume('monster', 'chains')).toEqual({ ok: false, reason: 'coins' });
    expect(await m.wearCostume('survivor', 'pack')).toBe(true);
    const again = new MetaState(new DeviceProfileStore(s), now);
    await again.ready;
    expect(again.current.coins).toBe(50);
    expect(again.costumes()).toEqual({ survivor: 'pack', monster: 'basic' });
  });

  it('다른 탭이 그사이 불씨를 썼으면 그 위에서 센다 (같은 불씨로 두 번 해금하지 않는다)', async () => {
    const s = mem();
    s.data.set(KEY, serializeProfile({ ...emptyProfile(1), coins: 300 }));
    const a = new MetaState(new DeviceProfileStore(s), now);
    const b = new MetaState(new DeviceProfileStore(s), now);
    await Promise.all([a.ready, b.ready]);
    expect((await a.buyCostume('survivor', 'pack')).ok).toBe(true);
    expect(await b.buyCostume('monster', 'feathers')).toEqual({ ok: false, reason: 'coins' });
    expect(await b.buyCostume('survivor', 'pack')).toEqual({ ok: false, reason: 'owned' });
  });

  it('저장소가 막혀도 이번 접속 동안은 해금 · 입기가 된다 (saved=false)', async () => {
    const m = new MetaState(
      new DeviceProfileStore(full(serializeProfile({ ...emptyProfile(1), coins: 200 }))),
      now,
    );
    await m.ready;
    expect(await m.buyCostume('monster', 'hood')).toEqual({ ok: true, price: 150, saved: false });
    expect(await m.wearCostume('monster', 'hood')).toBe(true);
    expect(m.costumes().monster).toBe('hood');
    expect(m.current.coins).toBe(50);
  });
});
