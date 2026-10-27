// 기기 저장소 · 성장 기록 상태 (GAME_DESIGN 12장 '저장'): 저장 · 불러오기 · 저장 실패에도 게임은 그대로 · 다른 탭과 겹쳐도 잃지 않음
import { describe, expect, it } from 'vitest';
import type { MatchRating } from '@decoy/shared';
import { PROFILE_VERSION, PROGRESSION, emptyProfile, serializeProfile } from '@decoy/shared/meta';
import { MetaState } from '../../client/src/meta/meta';
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

  it('모르는 칸(다음 마일스톤이 더할 재화 등)은 적립 · 저장 뒤에도 남는다', async () => {
    const s = mem();
    s.data.set(KEY, JSON.stringify({ ...emptyProfile(1), coins: 120, owned: ['x'] }));
    const m = new MetaState(new DeviceProfileStore(s), now);
    await m.applyRating(rating('M.1'));
    expect(JSON.parse(s.data.get(KEY) ?? '{}')).toMatchObject({ coins: 120, owned: ['x'], xp: XP });
  });
});
