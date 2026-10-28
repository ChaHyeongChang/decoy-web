// 계정 서비스 (docs/ACCOUNT_PLAN.md 4 · 5절): 서버 적립 = 공용 applyRating 결과 · 같은 판 한 번 · 지운 계정 다시 안 만듦 ·
// 동시 적립 둘 다 반영 · DB 실패 다시 시도 · 'newer' 기록 덮지 않음 · 계정 날짜(서울 자정) · 기기 기록 올리기 · 접속 보상 하루 한 번 ·
// 해금 불씨 · 입기 가진 것만 · 적립 결과는 그 계정 연결에만(그 계정 tag를 싣는다) · 삭제 페이지 찾기는 계정을 만들지 않음 ·
// 기기 글 null은 있는 계정 기록을 덮지 않음 · 비었다고 보고 올린 기록(ifBlank)은 그새 채워졌으면 덮지 않음(409) ·
// 조건부 쓰기(읽은 rev): 시간을 넘겨 버린 옛 쓰기 · 그새 바뀐 기록을 덮지 않음, 적립은 다시 읽고 다시 시도
import { describe, expect, it } from 'vitest';
import type { AccountImportRequest, MatchRating, ServerMessage } from '@decoy/shared';
import {
  PROGRESSION,
  applyRating,
  dayKeyInZone,
  emptyProfile,
  parseProfile,
  serializeProfile,
  type Profile,
} from '@decoy/shared/meta';
import {
  AccountBadRequest,
  AccountImportConflict,
  AccountService,
  AccountUnavailable,
  CREDIT_RETRY_MS,
  DB_TIMEOUT_MS,
  parseCostumeRequest,
  parseImportRequest,
  type AccountServiceOptions,
  type CreditMessage,
} from '../../server/src/account/service';
import { AccountConflict, MemoryAccountStore, type AccountRecord } from '../../server/src/account/store';
import { AccountConnections } from '../../server/src/account/system';
import { FakeConn } from '../helpers/fakeConn';

const SEOUL = 'Asia/Seoul';
/** 2026-10-28 12:00 KST */
const T = Date.UTC(2026, 9, 28, 3, 0, 0);

function rating(matchId: string, over: Partial<MatchRating> = {}): MatchRating {
  return {
    matchId,
    role: 'runner',
    outcome: 'win',
    durationSec: 300,
    emblems: [
      { id: 'capture', tier: 2, score: 30 },
      { id: 'rescue', tier: 1, score: 5 },
      { id: 'survive', tier: 3, score: 45 },
      { id: 'evade', tier: 0, score: 1 },
    ],
    stats: { captureSec: 30, escaped: 1 },
    ...over,
  };
}

/** 메모리 저장소 + 저장 횟수 · 지연 · 실패 횟수 조절 */
class TestStore extends MemoryAccountStore {
  saves = 0;
  gets = 0;
  delayMs = 0;
  /** 앞으로 이만큼의 호출을 실패시킨다 */
  failNext = 0;
  /** true면 get이 끝나지 않는다 (시간 넘김) */
  hang = false;

  private async gate(): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('db down');
    }
  }
  override async get(id: string): Promise<AccountRecord | null> {
    this.gets += 1;
    if (this.hang) return new Promise(() => undefined);
    await this.gate();
    return super.get(id);
  }
  override async saveProfile(
    id: string,
    profile: string,
    nowMs: number,
    expectRev?: number,
  ): Promise<boolean> {
    this.saves += 1;
    await this.gate();
    return super.saveProfile(id, profile, nowMs, expectRev);
  }
}

/** 다음 기록 쓰기 하나를 붙잡아 두었다가 놓는 저장소 (시간을 넘겨 버린 옛 쓰기가 늦게 도착하는 흉내) */
class HeldStore extends TestStore {
  private holdNext = false;
  private release: (() => void) | null = null;
  private held: Promise<boolean> | null = null;

  hold(): void {
    this.holdNext = true;
  }

  /** 붙잡은 쓰기를 놓고 끝나기를 기다린다 (썼으면 fulfilled, 그새 바뀌어 거절했으면 rejected) */
  async letGo(): Promise<PromiseSettledResult<boolean>> {
    const held = this.held;
    if (!held || !this.release) throw new Error('붙잡은 쓰기가 없다');
    this.release();
    const [settled] = await Promise.allSettled([held]);
    return settled;
  }

  override saveProfile(id: string, profile: string, nowMs: number, expectRev?: number): Promise<boolean> {
    if (!this.holdNext) return super.saveProfile(id, profile, nowMs, expectRev);
    this.holdNext = false;
    const gate = new Promise<void>((resolve) => (this.release = resolve));
    this.held = gate.then(() => super.saveProfile(id, profile, nowMs, expectRev));
    return this.held;
  }
}

/** 다음 읽기 바로 뒤(서비스가 쓰기 전)에 한 번: 조건 없이(rev 없이) 불씨 +7을 쓴다 — 다른 길의 쓰기가 끼어든 흉내 */
class SneakyStore extends TestStore {
  sneakNext = false;
  /** 끼어들어 쓴 글 */
  sneaked: string | null = null;

  override async get(id: string): Promise<AccountRecord | null> {
    const rec = await super.get(id);
    if (this.sneakNext && rec?.profile) {
      this.sneakNext = false;
      const p = parseProfile(rec.profile, T);
      this.sneaked = serializeProfile({ ...p.profile, coins: p.profile.coins + 7 }, p.extra);
      await super.saveProfile(id, this.sneaked, T);
    }
    return rec;
  }
}

interface Rig {
  store: TestStore;
  service: AccountService;
  pushed: { id: string; msg: CreditMessage }[];
  sleeps: number[];
  logs: string[];
  clock: { now: number };
}

/** 시험용 계정 표시 tag (시스템은 세션 비밀로 만든다 — system.ts) */
const tagOf = (id: string): string => `tag-${id.slice(0, 8)}`;

/** store를 주면 그 저장소로 (붙잡기 · 끼어들기 시험) */
function rig(over: Partial<AccountServiceOptions> = {}, store: TestStore = new TestStore()): Rig {
  const pushed: Rig['pushed'] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const clock = { now: T };
  const service = new AccountService({
    store,
    timeZone: SEOUL,
    now: () => clock.now,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    push: (id, msg) => pushed.push({ id, msg }),
    tag: tagOf,
    log: (m) => logs.push(m),
    ...over,
  });
  return { store, service, pushed, sleeps, logs, clock };
}

async function account(r: Rig, sub = 'sub-1'): Promise<string> {
  expect(await r.service.init()).toBe(true);
  return r.service.login(sub);
}

function profileOf(r: Rig, id: string): Profile {
  const rec = r.store.list().find((x) => x.id === id);
  return parseProfile(rec?.profile ?? null, T).profile;
}

describe('로그인 · 상태', () => {
  it('같은 sub는 같은 계정, 다른 sub는 다른 계정, 지운 뒤 다시 로그인하면 새 계정', async () => {
    const r = rig();
    const a = await account(r, 'sub-a');
    expect(await r.service.login('sub-a')).toBe(a);
    const b = await r.service.login('sub-b');
    expect(b).not.toBe(a);
    expect(await r.service.status(a)).toEqual({
      fresh: true,
      profile: null,
      day: '2026-10-28',
      timeZone: SEOUL,
    });
    expect(await r.service.delete(a)).toBe(true);
    expect(await r.service.status(a)).toBeNull();
    const again = await r.service.login('sub-a');
    expect(again).not.toBe(a);
    // 로그에 sub · 계정 ID가 없다 (수만)
    const all = r.logs.join('\n');
    for (const v of ['sub-a', 'sub-b', a, b, again]) expect(all).not.toContain(v);
    expect(all).toContain('계정 로그인 (누적 3)');
  });
});

describe('삭제 페이지 로그인: 찾기만 (find)', () => {
  it('sub의 계정이 없으면 null이고 계정을 만들지 않는다, 있으면 그 계정 ID (로그인 횟수에 세지 않는다)', async () => {
    const r = rig();
    expect(await r.service.init()).toBe(true);
    expect(await r.service.find('nobody')).toBeNull();
    expect(r.store.size).toBe(0);
    const id = await r.service.login('somebody');
    expect(await r.service.find('somebody')).toBe(id);
    expect(r.store.size).toBe(1);
    expect(r.logs.join('\n')).toContain('계정 로그인 (누적 1)');
    r.store.failing = true;
    await expect(r.service.find('somebody')).rejects.toBeInstanceOf(AccountUnavailable);
  });
});

describe('서버 적립', () => {
  it('결과는 공용 applyRating(빈 기록, 평가, 서버 시각, PROGRESSION, 계정 날짜)와 같다', async () => {
    const r = rig();
    const id = await account(r);
    const res = await r.service.credit(id, rating('ROOM.1.a'));
    const want = applyRating(emptyProfile(T), rating('ROOM.1.a'), T, PROGRESSION, dayKeyInZone(T, SEOUL));
    expect(want).not.toBeNull();
    const text = serializeProfile(want!.profile, {});
    expect(res).toEqual({ ok: true, profile: text });
    expect(r.store.list()[0]!.profile).toBe(text);
    // credit에는 그 계정의 표시 tag를 싣는다 (같은 사람의 다른 탭 · 다른 계정 모드 화면이 거른다)
    expect(r.pushed).toEqual([
      { id, msg: { t: 'credit', tag: tagOf(id), matchId: 'ROOM.1.a', ok: true, profile: text } },
    ]);
    // 적립 성공도 로그에 횟수만 (계정 ID · 판 ID 없이 — 문서: '로그인 · 적립 횟수와 실패 종류만')
    expect(r.logs).toContain('계정 적립 (누적 1)');
    for (const v of [id, 'ROOM.1.a']) expect(r.logs.join('\n')).not.toContain(v);
    // 이미 기록이 있으면 그 위에 (모르는 칸도 그대로 다시 적는다)
    const withExtra = JSON.stringify({ ...JSON.parse(text), futureField: { a: 1 } });
    await r.store.saveProfile(id, withExtra, T);
    const res2 = await r.service.credit(
      id,
      rating('ROOM.2.b', { role: 'monster', outcome: 'lose', emblems: [] }),
    );
    const base = parseProfile(withExtra, T);
    const want2 = applyRating(
      base.profile,
      rating('ROOM.2.b', { role: 'monster', outcome: 'lose', emblems: [] }),
      T,
      PROGRESSION,
      '2026-10-28',
    );
    expect(res2.profile).toBe(serializeProfile(want2!.profile, base.extra));
    expect(JSON.parse(res2.profile!).futureField).toEqual({ a: 1 });
  });

  it('같은 판 ID는 한 번만 (두 번째는 저장 없이 ok, 지금 기록)', async () => {
    const r = rig();
    const id = await account(r);
    const first = await r.service.credit(id, rating('ROOM.1.a'));
    const saves = r.store.saves;
    const second = await r.service.credit(id, rating('ROOM.1.a'));
    expect(second).toEqual(first);
    expect(r.store.saves).toBe(saves);
    expect(profileOf(r, id).played.survivor).toBe(1);
  });

  it('지운 계정은 다시 만들지 않는다 (ok:false, 행 없음, 다시 시도 없음)', async () => {
    const r = rig();
    const id = await account(r);
    await r.service.delete(id);
    const res = await r.service.credit(id, rating('ROOM.1.a'));
    expect(res).toEqual({ ok: false, profile: null });
    expect(r.store.size).toBe(0);
    expect(r.sleeps).toEqual([]);
    expect(r.pushed.at(-1)?.msg.ok).toBe(false);
  });

  it('줄 뒤에 선 삭제: 적립 중에 지우면 적립이 끝난 뒤 지우고, 그 뒤 적립은 계정을 다시 만들지 않는다', async () => {
    const r = rig();
    const id = await account(r);
    r.store.delayMs = 5;
    const credit = r.service.credit(id, rating('ROOM.1.a'));
    const del = r.service.delete(id);
    const late = r.service.credit(id, rating('ROOM.2.a'));
    expect((await credit).ok).toBe(true);
    expect(await del).toBe(true);
    expect((await late).ok).toBe(false);
    expect(r.store.size).toBe(0);
  });

  it('동시에 온 적립 두 개가 둘 다 반영된다 (계정마다 한 줄)', async () => {
    const r = rig();
    const id = await account(r);
    r.store.delayMs = 5;
    const [a, b] = await Promise.all([
      r.service.credit(id, rating('ROOM.1.a')),
      r.service.credit(id, rating('ROOM.2.b', { role: 'guard' })),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const p = profileOf(r, id);
    expect(p.played.survivor).toBe(2);
    expect(p.recent).toEqual(['ROOM.1.a', 'ROOM.2.b']);
  });

  it('DB 실패: 0.5 · 2 · 6초 뒤 다시 시도하고 그래도 안 되면 ok:false (판 결과와 무관)', async () => {
    const r = rig();
    const id = await account(r);
    r.store.failing = true;
    const res = await r.service.credit(id, rating('ROOM.1.a'));
    expect(res).toEqual({ ok: false, profile: null });
    expect(r.sleeps).toEqual([...CREDIT_RETRY_MS]);
    expect(CREDIT_RETRY_MS).toEqual([500, 2000, 6000]);
    expect(r.pushed).toEqual([
      { id, msg: { t: 'credit', tag: tagOf(id), matchId: 'ROOM.1.a', ok: false, profile: null } },
    ]);
    expect(r.logs.join('\n')).toContain('계정 적립 실패: error');
    // 두 번 실패하고 세 번째에 되면 ok
    r.store.failing = false;
    r.sleeps.length = 0;
    r.store.failNext = 2;
    const ok = await r.service.credit(id, rating('ROOM.2.a'));
    expect(ok.ok).toBe(true);
    expect(r.sleeps).toEqual([500, 2000]);
  });

  it('DB 호출 시간 넘김(제한 3초, 시험은 짧게)도 실패로 치고 다시 시도한다', async () => {
    expect(DB_TIMEOUT_MS).toBe(3000);
    const r = rig({ dbTimeoutMs: 20, settleMaxMs: 30 });
    const id = await account(r);
    r.store.hang = true;
    const res = await r.service.credit(id, rating('ROOM.1.a'));
    expect(res.ok).toBe(false);
    expect(r.sleeps).toHaveLength(3);
    expect(r.logs.join('\n')).toContain('계정 적립 실패: timeout');
  });

  it('시간 넘긴 쓰기가 끝날 때까지 같은 계정의 다음 일은 기다린다 (늦은 쓰기가 새 쓰기를 덮지 않게)', async () => {
    const r = rig({ dbTimeoutMs: 10, settleMaxMs: 2000 });
    const id = await account(r);
    r.store.delayMs = 60;
    const first = r.service.claimLogin(id);
    await expect(first).rejects.toBeInstanceOf(AccountUnavailable);
    r.store.delayMs = 0;
    const order: string[] = [];
    // 첫 일의 get(60ms)이 끝나기 전에는 다음 일이 시작하지 않는다
    const t0 = Date.now();
    const st = await r.service.status(id).then((s) => {
      order.push('status');
      return s;
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(30);
    expect(st).not.toBeNull();
    expect(order).toEqual(['status']);
  });

  it("계정 기록이 더 높은 판('newer')이면 적립 · 쓰기를 하지 않는다 (옛 서버가 새 기록을 덮지 않게)", async () => {
    const r = rig();
    const id = await account(r);
    const newer = JSON.stringify({ v: 99, xp: 5000, newThing: true });
    await r.store.saveProfile(id, newer, T);
    const saves = r.store.saves;
    const res = await r.service.credit(id, rating('ROOM.1.a'));
    expect(res).toEqual({ ok: false, profile: null });
    expect(r.sleeps).toEqual([]);
    expect(r.store.saves).toBe(saves);
    await expect(r.service.claimLogin(id)).rejects.toBeInstanceOf(AccountUnavailable);
    await expect(
      r.service.costume(id, { action: 'wear', team: 'survivor', id: 'basic' }),
    ).rejects.toBeInstanceOf(AccountUnavailable);
    await expect(
      r.service.importDevice(id, { choice: 'device', device: JSON.stringify({ v: 1, xp: 3 }) }),
    ).rejects.toBeInstanceOf(AccountUnavailable);
    // 비었다고 보고 올린 기록(ifBlank)도: 읽지 못하는 높은 판 기록을 '빈 기록'으로 보고 덮지 않는다
    await expect(
      r.service.importDevice(id, {
        choice: 'device',
        device: JSON.stringify({ v: 1, xp: 3 }),
        ifBlank: true,
      }),
    ).rejects.toBeInstanceOf(AccountUnavailable);
    // 상태 읽기 · 계정 기록 그대로 쓰기(choice account · 기기 글 null)는 된다
    expect((await r.service.status(id))?.profile).toBe(newer);
    expect((await r.service.importDevice(id, { choice: 'account', device: null }))?.profile).toBe(newer);
    expect((await r.service.importDevice(id, { choice: 'device', device: null }))?.profile).toBe(newer);
    expect(r.store.list()[0]!.profile).toBe(newer);
  });

  it('계정 날짜는 서울 자정에 바뀐다 (오늘의 도전 날짜 · 접속 보상)', async () => {
    // 2026-10-28 23:59:59 KST
    const r = rig();
    r.clock.now = Date.UTC(2026, 9, 28, 14, 59, 59);
    const id = await account(r);
    await r.service.credit(id, rating('ROOM.1.a'));
    expect(profileOf(r, id).daily?.day).toBe('2026-10-28');
    const c1 = await r.service.claimLogin(id);
    expect(c1).toMatchObject({ day: '2026-10-28', claimed: { streak: 1, reward: PROGRESSION.login.base } });
    expect((await r.service.claimLogin(id))?.claimed).toBeNull();
    r.clock.now += 2000; // 00:00:01 KST (UTC로는 아직 28일)
    expect(r.service.today()).toBe('2026-10-29');
    const c2 = await r.service.claimLogin(id);
    expect(c2).toMatchObject({
      day: '2026-10-29',
      claimed: { streak: 2, reward: PROGRESSION.login.base + PROGRESSION.login.step },
    });
    await r.service.credit(id, rating('ROOM.2.a'));
    expect(profileOf(r, id).daily?.day).toBe('2026-10-29');
    // 시간대가 UTC인 서버는 같은 순간에 아직 28일
    const utc = rig({ timeZone: 'UTC' });
    utc.clock.now = r.clock.now;
    expect(utc.service.today()).toBe('2026-10-28');
  });
});

describe('기기 기록 올리기 (첫 로그인)', () => {
  const device = (p: Partial<Profile> & Record<string, unknown>): string =>
    JSON.stringify({ ...emptyProfile(T - 86_400_000), ...p });

  it('계정이 비었으면 choice와 상관없이 기기 기록을 공용 parseProfile로 걸러 올린다', async () => {
    for (const choice of ['account', 'device'] as const) {
      const r = rig();
      const id = await account(r);
      const text = device({ xp: 300, coins: -50, owned: ['scarf', 'Bad Id!', 'scarf'], futureField: 7 });
      const out = await r.service.importDevice(id, { choice, device: text });
      expect(out?.day).toBe('2026-10-28');
      const p = profileOf(r, id);
      expect(p.xp).toBe(300);
      expect(p.coins).toBe(0);
      expect(p.owned).toEqual(['scarf']);
      expect(JSON.parse(out!.profile).futureField).toBe(7);
      const parsed = parseProfile(text, T);
      expect(out!.profile).toBe(serializeProfile(parsed.profile, parsed.extra));
      expect((await r.service.status(id))?.fresh).toBe(false);
    }
  });

  it('빈 · 깨진 기기 글이면 빈 기록으로 시작한다 (fresh 끝)', async () => {
    for (const dev of [null, '', '{not json', '[1,2]']) {
      const r = rig();
      const id = await account(r);
      const out = await r.service.importDevice(id, { choice: 'device', device: dev });
      expect(out?.profile).toBe(serializeProfile(emptyProfile(T), {}));
      expect((await r.service.status(id))?.fresh).toBe(false);
    }
  });

  it("계정 기록이 있으면 'account'는 그대로, 'device'는 기기 기록으로 바꾼다", async () => {
    const r = rig();
    const id = await account(r);
    await r.service.credit(id, rating('ROOM.1.a'));
    const before = r.store.list()[0]!.profile;
    const keep = await r.service.importDevice(id, { choice: 'account', device: device({ xp: 9999 }) });
    expect(keep?.profile).toBe(before);
    expect(r.store.list()[0]!.profile).toBe(before);
    const replace = await r.service.importDevice(id, { choice: 'device', device: device({ xp: 9999 }) });
    expect(profileOf(r, id).xp).toBe(9999);
    expect(profileOf(r, id).played.survivor).toBe(0);
    expect(replace?.profile).toBe(r.store.list()[0]!.profile);
  });

  it('기기 글 null은 비어 있지 않은 계정 기록을 절대 덮지 않는다 (choice와 상관없이), 빈 계정이면 빈 기록을 연다', async () => {
    // 화면이 '빈 계정'이라고 본 사이 다른 기기가 기록을 올렸어도 (그 화면이 늦게 보낸 {choice, device:null})
    for (const choice of ['device', 'account'] as const) {
      const r = rig();
      const id = await account(r);
      await r.service.importDevice(id, { choice: 'device', device: device({ xp: 777, coins: 40 }) });
      const before = r.store.list()[0]!.profile;
      const saves = r.store.saves;
      const out = await r.service.importDevice(id, { choice, device: null });
      expect(out?.profile, choice).toBe(before);
      expect(r.store.list()[0]!.profile, choice).toBe(before);
      expect(r.store.saves, choice).toBe(saves);
      expect(profileOf(r, id).xp).toBe(777);
    }
    // 빈 계정 + 빈 기기: {choice:'account', device:null}로 빈 기록 계정을 연다 (화면의 첫 로그인)
    const r = rig();
    const id = await account(r);
    const out = await r.service.importDevice(id, { choice: 'account', device: null });
    expect(out?.profile).toBe(serializeProfile(emptyProfile(T), {}));
    expect((await r.service.status(id))?.fresh).toBe(false);
  });

  it('기기 기록이 서버보다 높은 판이면 받지 않는다 (400) · 계정이 없으면 null', async () => {
    const r = rig();
    const id = await account(r);
    await expect(
      r.service.importDevice(id, { choice: 'device', device: JSON.stringify({ v: 9 }) }),
    ).rejects.toBeInstanceOf(AccountBadRequest);
    expect(await r.service.importDevice('f'.repeat(32), { choice: 'device', device: null })).toBeNull();
  });

  it('ifBlank(화면이 비었다고 보고 묻지 않고 올림): 계정 기록이 없거나(fresh) 아무것도 쌓지 않은 빈 기록이면 올린다', async () => {
    const text = device({ xp: 300, coins: 20 });
    const parsed = parseProfile(text, T);
    const want = serializeProfile(parsed.profile, parsed.extra);
    // 기록 없음 (첫 로그인)
    const r = rig();
    const id = await account(r);
    const out = await r.service.importDevice(id, { choice: 'device', device: text, ifBlank: true });
    expect(out).toEqual({ profile: want, day: '2026-10-28' });
    expect(r.store.list()[0]).toMatchObject({ profile: want, rev: 1 });
    // 빈 기록 (빈 기기로 처음 로그인해 연 계정 — null이 아니다)
    const b = rig();
    const bid = await account(b);
    await b.service.importDevice(bid, { choice: 'account', device: null });
    const blank = b.store.list()[0]!;
    expect(blank.profile).toBe(serializeProfile(emptyProfile(T), {}));
    const up = await b.service.importDevice(bid, { choice: 'device', device: text, ifBlank: true });
    expect(up?.profile).toBe(want);
    expect(b.store.list()[0]).toMatchObject({ profile: want, rev: blank.rev + 1 });
    expect(profileOf(b, bid).xp).toBe(300);
  });

  it('ifBlank: 그새 다른 기기가 채운 계정 기록은 덮지 않고 AccountImportConflict (기록 · rev 그대로, 쓰기 없음)', async () => {
    const r = rig();
    const id = await account(r);
    // 다른 기기가 먼저 첫 로그인해 올렸다
    await r.service.importDevice(id, { choice: 'device', device: device({ xp: 777, coins: 40 }) });
    const before = r.store.list()[0]!;
    const saves = r.store.saves;
    await expect(
      r.service.importDevice(id, { choice: 'device', device: device({ xp: 5, coins: 1 }), ifBlank: true }),
    ).rejects.toBeInstanceOf(AccountImportConflict);
    expect(r.store.list()[0]).toEqual(before);
    expect(r.store.saves).toBe(saves);
    expect(profileOf(r, id).xp).toBe(777);
    // 접속 보상만 받은 계정도 비어 있지 않다 (불씨 · 접속 기록)
    const c = rig();
    const cid = await account(c);
    await c.service.claimLogin(cid);
    const claimed = c.store.list()[0]!;
    await expect(
      c.service.importDevice(cid, { choice: 'device', device: device({ xp: 5 }), ifBlank: true }),
    ).rejects.toBeInstanceOf(AccountImportConflict);
    expect(c.store.list()[0]).toEqual(claimed);
    // 고르기 창에서 고른 뒤(ifBlank 없이)에는 고른 대로 바꾼다
    const replace = await r.service.importDevice(id, {
      choice: 'device',
      device: device({ xp: 5, coins: 1 }),
    });
    expect(profileOf(r, id).xp).toBe(5);
    expect(replace?.profile).toBe(r.store.list()[0]!.profile);
  });

  it("ifBlank여도 choice 'account' · 기기 글 null은 있는 계정 기록을 덮지 않는다 (충돌이 아니라 그 기록을 돌려준다)", async () => {
    const reqs: AccountImportRequest[] = [
      { choice: 'account', device: device({ xp: 5 }), ifBlank: true },
      { choice: 'device', device: null, ifBlank: true },
      { choice: 'account', device: null, ifBlank: true },
    ];
    for (const req of reqs) {
      const label = JSON.stringify({ ...req, device: req.device === null ? null : 'text' });
      const r = rig();
      const id = await account(r);
      await r.service.importDevice(id, { choice: 'device', device: device({ xp: 777 }) });
      const before = r.store.list()[0]!;
      const saves = r.store.saves;
      const out = await r.service.importDevice(id, req);
      expect(out?.profile, label).toBe(before.profile);
      expect(r.store.list()[0], label).toEqual(before);
      expect(r.store.saves, label).toBe(saves);
    }
  });

  it('요청 모양 검사 (기기 글 32KB 상한)', () => {
    expect(parseImportRequest({ choice: 'device', device: '{}' })).toEqual({
      choice: 'device',
      device: '{}',
    });
    expect(parseImportRequest({ choice: 'account', device: null })).toEqual({
      choice: 'account',
      device: null,
    });
    for (const bad of [
      null,
      [],
      {},
      { choice: 'merge', device: null },
      { choice: 'device' },
      { choice: 'device', device: 5 },
    ])
      expect(parseImportRequest(bad)).toBeNull();
    expect(parseImportRequest({ choice: 'device', device: 'x'.repeat(32 * 1024 + 1) })).toBeNull();
    // ifBlank는 true만 받는다 (싣지 않으면 요청에도 없다)
    expect(parseImportRequest({ choice: 'device', device: '{}', ifBlank: true })).toStrictEqual({
      choice: 'device',
      device: '{}',
      ifBlank: true,
    });
    expect(parseImportRequest({ choice: 'device', device: '{}' })).toStrictEqual({
      choice: 'device',
      device: '{}',
    });
    for (const ifBlank of [false, 1, 'yes', 'true', null, {}])
      expect(
        parseImportRequest({ choice: 'device', device: '{}', ifBlank }),
        JSON.stringify(ifBlank),
      ).toBeNull();
  });
});

describe('접속 보상 · 의상 (서버가 판단)', () => {
  it('접속 보상은 하루 한 번 (빈 계정도 받는다)', async () => {
    const r = rig();
    const id = await account(r);
    const c = await r.service.claimLogin(id);
    expect(c?.claimed).toEqual({ reward: PROGRESSION.login.base, streak: 1 });
    expect(profileOf(r, id).coins).toBe(PROGRESSION.login.base);
    const again = await r.service.claimLogin(id);
    expect(again?.claimed).toBeNull();
    expect(profileOf(r, id).coins).toBe(PROGRESSION.login.base);
    expect(await r.service.claimLogin('f'.repeat(32))).toBeNull();
  });

  it('해금은 불씨로 (모자라면 coins, 이미 가지면 owned, 모르는 · 다른 팀 의상은 unknown), 입기는 가진 것만', async () => {
    const r = rig();
    const id = await account(r);
    expect((await r.service.costume(id, { action: 'buy', team: 'survivor', id: 'scarf' }))?.result).toBe(
      'coins',
    );
    await r.service.importDevice(id, {
      choice: 'device',
      device: JSON.stringify({ ...emptyProfile(T), coins: 200 }),
    });
    const buy = await r.service.costume(id, { action: 'buy', team: 'survivor', id: 'scarf' });
    expect(buy).toMatchObject({ result: 'ok', price: PROGRESSION.costumes.survivor.scarf });
    expect(profileOf(r, id).coins).toBe(200 - PROGRESSION.costumes.survivor.scarf);
    expect(profileOf(r, id).owned).toEqual(['scarf']);
    expect((await r.service.costume(id, { action: 'buy', team: 'survivor', id: 'scarf' }))?.result).toBe(
      'owned',
    );
    expect((await r.service.costume(id, { action: 'buy', team: 'survivor', id: 'hood' }))?.result).toBe(
      'unknown',
    );
    expect((await r.service.costume(id, { action: 'buy', team: 'monster', id: 'dragon' }))?.result).toBe(
      'unknown',
    );
    expect((await r.service.costume(id, { action: 'wear', team: 'survivor', id: 'pack' }))?.result).toBe(
      'not-owned',
    );
    expect((await r.service.costume(id, { action: 'wear', team: 'monster', id: 'scarf' }))?.result).toBe(
      'unknown',
    );
    const wear = await r.service.costume(id, { action: 'wear', team: 'survivor', id: 'scarf' });
    expect(wear?.result).toBe('ok');
    expect(wear?.price).toBeUndefined();
    expect(profileOf(r, id).wear).toEqual({ survivor: 'scarf', monster: 'basic' });
    const saves = r.store.saves;
    expect((await r.service.costume(id, { action: 'wear', team: 'survivor', id: 'scarf' }))?.result).toBe(
      'ok',
    );
    expect(r.store.saves).toBe(saves);
    expect((await r.service.costume(id, { action: 'wear', team: 'survivor', id: 'basic' }))?.result).toBe(
      'ok',
    );
    expect(profileOf(r, id).wear.survivor).toBe('basic');
  });

  it('의상 요청 모양 검사', () => {
    expect(parseCostumeRequest({ action: 'buy', team: 'monster', id: 'hood' })).toEqual({
      action: 'buy',
      team: 'monster',
      id: 'hood',
    });
    for (const bad of [
      null,
      { action: 'sell', team: 'monster', id: 'hood' },
      { action: 'buy', team: 'runner', id: 'hood' },
      { action: 'buy', team: 'monster', id: '' },
      { action: 'buy', team: 'monster', id: 'x'.repeat(25) },
      { action: 'buy', team: 'monster' },
    ])
      expect(parseCostumeRequest(bad)).toBeNull();
  });
});

describe('조건부 쓰기 (읽은 rev): 옛 쓰기 · 그새 바뀐 기록을 덮지 않는다', () => {
  /** 시작 기록: 불씨 500 · 가방(pack)을 가졌다 (해금 · 입기 · 접속 보상이 모두 쓰기를 만든다) */
  const start = (): string => serializeProfile({ ...emptyProfile(T), coins: 500, owned: ['pack'] }, {});

  async function seeded(over: Partial<AccountServiceOptions>, store: TestStore): Promise<[Rig, string]> {
    const r = rig(over, store);
    const id = await account(r);
    await r.service.importDevice(id, { choice: 'device', device: start() });
    return [r, id];
  }

  function rejectedWith(s: PromiseSettledResult<boolean>): unknown {
    expect(s.status).toBe('rejected');
    return s.status === 'rejected' ? (s.reason as unknown) : null;
  }

  const staleJobs: [string, (s: AccountService, id: string) => Promise<unknown>][] = [
    [
      '기기 기록 올리기',
      (s, id) =>
        s.importDevice(id, {
          choice: 'device',
          device: serializeProfile({ ...emptyProfile(T), xp: 9999 }, {}),
        }),
    ],
    ['의상 해금', (s, id) => s.costume(id, { action: 'buy', team: 'survivor', id: 'scarf' })],
    ['의상 입기', (s, id) => s.costume(id, { action: 'wear', team: 'survivor', id: 'pack' })],
  ];

  it.each(staleJobs)(
    '%s: 쓰기가 시간을 넘겨(503) 뒤 일(접속 보상)이 쓴 다음에 늦게 도착해도 거절된다 — 기록 · rev는 뒤 일의 것',
    async (_, jobA) => {
      const held = new HeldStore();
      const [r, id] = await seeded({ dbTimeoutMs: 30, settleMaxMs: 30 }, held);
      // 일 A: 쓰기가 붙잡혀 시간을 넘긴다
      held.hold();
      await expect(jobA(r.service, id)).rejects.toMatchObject({ why: 'timeout' });
      // 일 B: 접속 보상 (줄은 A의 쓰기를 settleMaxMs만 기다리고 넘어간다)
      const b = await r.service.claimLogin(id);
      expect(b?.claimed).not.toBeNull();
      const afterB = r.store.list()[0]!;
      expect(afterB.profile).toBe(b?.profile);
      // A의 옛 쓰기가 이제 도착: 읽은 rev가 지나 쓰지 않는다
      expect(rejectedWith(await held.letGo())).toBeInstanceOf(AccountConflict);
      expect(r.store.list()[0]).toEqual(afterB);
      // A의 변화(기기 기록 · 해금 · 입기)는 없고 B의 불씨는 있다
      const p = profileOf(r, id);
      expect(p.xp).toBe(0);
      expect(p.owned).toEqual(['pack']);
      expect(p.wear.survivor).toBe('basic');
      expect(p.coins).toBe(500 + PROGRESSION.login.base);
    },
  );

  it('적립: 첫 쓰기가 시간을 넘기면 다시 읽고 다시 시도해 한 번 적립 — 늦게 도착한 첫 쓰기는 거절되어 그 뒤 일도 덮지 않는다', async () => {
    const held = new HeldStore();
    const clock = { now: T };
    const sleeps: number[] = [];
    const [r, id] = await seeded(
      {
        dbTimeoutMs: 30,
        settleMaxMs: 30,
        retryDelaysMs: [1, 1, 1],
        now: () => clock.now,
        // 다시 시도는 조금 뒤 (다시 쓴 글의 시각이 첫 시도와 다르다)
        sleep: (ms) => {
          sleeps.push(ms);
          clock.now += 1000;
          return Promise.resolve();
        },
      },
      held,
    );
    held.hold();
    const res = await r.service.credit(id, rating('ROOM.9.a'));
    expect(res.ok).toBe(true);
    expect(sleeps).toEqual([1]);
    const afterCredit = r.store.list()[0]!;
    expect(afterCredit.profile).toBe(res.profile);
    expect(r.pushed.map((x) => x.msg.ok)).toEqual([true]);
    // 그 뒤 일: 접속 보상
    const b = await r.service.claimLogin(id);
    const afterB = r.store.list()[0]!;
    expect(afterB.profile).toBe(b?.profile);
    expect(afterB.rev).toBe(afterCredit.rev + 1);
    // 첫 시도의 옛 쓰기가 이제 도착: 거절 (적립을 두 번 하지도, 접속 보상을 지우지도 않는다)
    expect(rejectedWith(await held.letGo())).toBeInstanceOf(AccountConflict);
    expect(r.store.list()[0]).toEqual(afterB);
    const p = profileOf(r, id);
    expect(p.played.survivor).toBe(1);
    expect(p.recent.filter((m) => m === 'ROOM.9.a')).toHaveLength(1);
    expect(p.coins).toBe(parseProfile(afterCredit.profile, T).profile.coins + PROGRESSION.login.base);
  });

  it('적립: 읽은 뒤 기록이 그새 바뀌면(조건 없는 쓰기가 끼어듦) AccountConflict → 다시 읽고 다시 시도해 한 번만 적립, 끼어든 변화도 남는다', async () => {
    const store = new SneakyStore();
    const [r, id] = await seeded({}, store);
    store.sneakNext = true;
    const res = await r.service.credit(id, rating('ROOM.7.a'));
    expect(res.ok).toBe(true);
    // 한 번 실패(그새 바뀜)하고 다시 읽어 성공
    expect(r.sleeps).toEqual([CREDIT_RETRY_MS[0]]);
    expect(store.sneaked).not.toBeNull();
    const base = parseProfile(store.sneaked, T);
    expect(base.profile.coins).toBe(507);
    // 끼어든 기록 위에 공용 applyRating 그대로
    const want = applyRating(base.profile, rating('ROOM.7.a'), T, PROGRESSION, '2026-10-28');
    expect(want).not.toBeNull();
    expect(res.profile).toBe(serializeProfile(want!.profile, base.extra));
    expect(r.store.list()[0]!.profile).toBe(res.profile);
    const p = profileOf(r, id);
    expect(p.played.survivor).toBe(1);
    expect(p.recent).toEqual(['ROOM.7.a']);
    expect(r.pushed).toEqual([
      { id, msg: { t: 'credit', tag: tagOf(id), matchId: 'ROOM.7.a', ok: true, profile: res.profile } },
    ]);
  });

  it('적립이 아닌 일(의상 해금)은 그새 바뀐 기록을 덮지 않고 503 (AccountUnavailable error) — 끼어든 변화 그대로', async () => {
    const store = new SneakyStore();
    const [r, id] = await seeded({}, store);
    store.sneakNext = true;
    const err = await r.service.costume(id, { action: 'buy', team: 'survivor', id: 'scarf' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AccountUnavailable);
    expect((err as AccountUnavailable).why).toBe('error');
    expect(r.store.list()[0]!.profile).toBe(store.sneaked);
    expect(profileOf(r, id).owned).toEqual(['pack']);
    expect(profileOf(r, id).coins).toBe(507);
    expect(r.sleeps).toEqual([]);
  });
});

describe('저장소 시작 · 장애', () => {
  it('시작에 실패해도 예외 없이 false, 30초 뒤에 다시 시작해 본다', async () => {
    const r = rig();
    r.store.failing = true;
    expect(await r.service.init()).toBe(false);
    expect(r.service.isReady).toBe(false);
    r.store.failing = false;
    expect(await r.service.ensureReady()).toBe(false);
    r.clock.now += 30_000;
    expect(await r.service.ensureReady()).toBe(true);
    expect(r.logs.join('\n')).toContain('계정 저장소 시작 실패');
  });

  it('저장소 장애 중 요청은 AccountUnavailable (라우트가 503으로)', async () => {
    const r = rig();
    const id = await account(r);
    r.store.failing = true;
    await expect(r.service.status(id)).rejects.toBeInstanceOf(AccountUnavailable);
    await expect(r.service.login('sub-x')).rejects.toBeInstanceOf(AccountUnavailable);
    r.store.failing = false;
    // 장애가 지나면 같은 줄이 다시 돈다
    expect(await r.service.status(id)).not.toBeNull();
  });
});

describe('적립 결과는 그 계정의 연결에만', () => {
  it('계정마다 연결 모음: 같은 계정의 탭 모두에, 다른 계정 · 게스트에는 보내지 않는다', () => {
    const conns = new AccountConnections();
    const a1 = new FakeConn('a'.repeat(32));
    const a2 = new FakeConn('a'.repeat(32));
    const b = new FakeConn('b'.repeat(32));
    const guest = new FakeConn(null);
    for (const c of [a1, a2, b, guest]) conns.add(c);
    const msg: ServerMessage = { t: 'credit', tag: 'tag-a', matchId: 'M', ok: true, profile: '{}' };
    expect(conns.send('a'.repeat(32), msg)).toBe(2);
    expect(a1.inbox).toEqual([msg]);
    expect(a2.inbox).toEqual([msg]);
    expect(b.inbox).toEqual([]);
    expect(guest.inbox).toEqual([]);
    conns.remove(a1);
    expect(conns.count('a'.repeat(32))).toBe(1);
    conns.remove(a2);
    expect(conns.count('a'.repeat(32))).toBe(0);
    expect(conns.send('a'.repeat(32), msg)).toBe(0);
  });
});
