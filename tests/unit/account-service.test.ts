// 계정 서비스 (docs/ACCOUNT_PLAN.md 4 · 5절): 서버 적립 = 공용 applyRating 결과 · 같은 판 한 번 · 지운 계정 다시 안 만듦 ·
// 동시 적립 둘 다 반영 · DB 실패 다시 시도 · 'newer' 기록 덮지 않음 · 계정 날짜(서울 자정) · 기기 기록 올리기 · 접속 보상 하루 한 번 ·
// 해금 불씨 · 입기 가진 것만 · 적립 결과는 그 계정 연결에만
import { describe, expect, it } from 'vitest';
import type { MatchRating, ServerMessage } from '@decoy/shared';
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
  AccountService,
  AccountUnavailable,
  CREDIT_RETRY_MS,
  DB_TIMEOUT_MS,
  parseCostumeRequest,
  parseImportRequest,
  type AccountServiceOptions,
  type CreditMessage,
} from '../../server/src/account/service';
import { MemoryAccountStore, type AccountRecord } from '../../server/src/account/store';
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
  override async saveProfile(id: string, profile: string, nowMs: number): Promise<boolean> {
    this.saves += 1;
    await this.gate();
    return super.saveProfile(id, profile, nowMs);
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

function rig(over: Partial<AccountServiceOptions> = {}): Rig {
  const store = new TestStore();
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
    expect(r.pushed).toEqual([{ id, msg: { t: 'credit', matchId: 'ROOM.1.a', ok: true, profile: text } }]);
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
    expect(r.pushed).toEqual([{ id, msg: { t: 'credit', matchId: 'ROOM.1.a', ok: false, profile: null } }]);
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
    await expect(r.service.importDevice(id, { choice: 'device', device: null })).rejects.toBeInstanceOf(
      AccountUnavailable,
    );
    // 상태 읽기 · 계정 기록 그대로 쓰기(choice account)는 된다
    expect((await r.service.status(id))?.profile).toBe(newer);
    expect((await r.service.importDevice(id, { choice: 'account', device: null }))?.profile).toBe(newer);
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

  it('기기 기록이 서버보다 높은 판이면 받지 않는다 (400) · 계정이 없으면 null', async () => {
    const r = rig();
    const id = await account(r);
    await expect(
      r.service.importDevice(id, { choice: 'device', device: JSON.stringify({ v: 9 }) }),
    ).rejects.toBeInstanceOf(AccountBadRequest);
    expect(await r.service.importDevice('f'.repeat(32), { choice: 'device', device: null })).toBeNull();
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
    const msg: ServerMessage = { t: 'credit', matchId: 'M', ok: true, profile: '{}' };
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
