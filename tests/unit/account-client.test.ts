// 선택형 구글 로그인 · 계정 저장 — 클라이언트 (docs/ACCOUNT_PLAN.md 5 · 7절). fetch를 가짜로 바꿔 본다(서버 없음):
//  계정 API 요청 모양 · 5초 제한 · 실패 갈래 / 이 기기 표시 decoy:account / 부팅: 게스트는 요청 없음 · 표시 있음 → 계정 모드 ·
//  3초 칩 기다림 / 401 · 로그인 안 함 · 꺼짐 → 게스트 · 표시 지움, 503 · 시간 초과 → 이번 접속 게스트 + 안내 / ?login= 안내 /
//  첫 로그인 세 갈래(빈 기기 · 빈 계정 · 둘 다 → 고르기) / 계정 모드 받기 · 해금 · 입기는 API로, 실패하면 기록 그대로 /
//  온라인 판 결과 세 갈래(자리 계정 welcome.account: 없음 → 기기 · 지금 계정 → credit 기다림 → 저장함 · 못 함 · 모름(20초 뒤 다시
//  읽기) · 다른 계정 → 적립 안 함) / credit은 지금 계정 tag 것만 / 판에 밝히는 계정 tag(join · quick) / 연습 판은 계정 · 기기 모두 적립
//  안 함 / 계정 날짜 · 자정 / 로그아웃 · 삭제 · 세션 끝 → 기기 모드 / 다른 탭이 다른 계정으로 바꿈(switched) / 꺼짐 안내는 한 번 ·
//  다시 켜짐 / 첫 로그인 빈 기기 + 빈 계정 · 로그인 뒤 10분이 지나 올리기 거절(relogin)
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchRating } from '@decoy/shared';
import {
  PROGRESSION,
  applyRating,
  dayKeyInZone,
  emptyProfile,
  parseProfile,
  serializeProfile,
  type Profile,
} from '@decoy/shared/meta';
import { ACCOUNT_TIMEOUT_MS, AccountApi, type FetchLike } from '../../client/src/account/api';
import { BOOT_WAIT_MS, bootAccount } from '../../client/src/account/boot';
import { readStatus } from '../../client/src/account/calls';
import { AccountController, type AccountScreens } from '../../client/src/account/controller';
import { accountMark } from '../../client/src/account/mark';
import { reopenForAccount } from '../../client/src/lifecycle';
import { CREDIT_WAIT_MS, ServerProfileStore } from '../../client/src/account/serverStore';
import { ACCOUNT_TEXT } from '../../client/src/data/accountText';
import { MetaState } from '../../client/src/meta/meta';
import { DeviceProfileStore } from '../../client/src/meta/profileStore';
import type { StorageLike } from '../../client/src/storageKeys';

const PROGRESS = 'decoy:progress';
const MARK = 'decoy:account';
const TZ = 'Asia/Seoul';
const T = ACCOUNT_TEXT;
let clock = Date.UTC(2026, 9, 28, 3, 0, 0);
const now = (): number => clock;

afterEach(() => {
  vi.useRealTimers();
  clock = Date.UTC(2026, 9, 28, 3, 0, 0);
});

function mem(): StorageLike & { data: Map<string, string>; writes: string[] } {
  const data = new Map<string, string>();
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k);
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  init: RequestInit;
}

type Route = (c: Call) => Response | Promise<Response>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 가짜 서버 (fetch 대신): 요청을 적어 두고 route가 답한다 */
function fakeServer(route: Route): { api: AccountApi; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (path, init) => {
    const c: Call = {
      method: init.method ?? 'GET',
      path,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      headers: (init.headers ?? {}) as Record<string, string>,
      init,
    };
    calls.push(c);
    return route(c);
  };
  return { api: new AccountApi(fetcher), calls };
}

/** 끝나지 않는 요청 (5초 제한이 끊는다) */
const hang: Route = (c) =>
  new Promise<Response>((_, reject) =>
    c.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
  );

function profileWith(over: Partial<Profile>): Profile {
  return { ...emptyProfile(1), ...over };
}

function statusIn(tag: string, profile: Profile | null, timeZone = TZ): unknown {
  return {
    on: true,
    signedIn: true,
    tag,
    fresh: profile === null,
    profile: profile ? serializeProfile(profile) : null,
    day: dayKeyInZone(clock, timeZone),
    timeZone,
  };
}

const body = (p: Profile, extra: Record<string, unknown> = {}): unknown => ({
  profile: serializeProfile(p),
  day: dayKeyInZone(clock, TZ),
  ...extra,
});

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

interface Rig {
  storage: ReturnType<typeof mem>;
  calls: Call[];
  api: AccountApi;
  meta: MetaState;
  ctl: AccountController;
  notes: string[];
  chosen: { account: Profile; device: Profile }[];
  left: () => number;
  /** 부팅이 아닌 때 계정 모드로 들어간 횟수 (앱이 소켓을 다시 연다) */
  entered: () => number;
  boot(login: string | null): Promise<void> | null;
}

/** 클라이언트 한 벌: 기기 저장소(가짜) · 가짜 서버 · 기록 상태 · 계정 흐름. storage를 주면 그 기기 저장소로 (다음 부팅) */
async function rig(o: {
  mark?: string | null;
  device?: Profile | string | null;
  route: Route;
  choose?: 'account' | 'device';
  storage?: ReturnType<typeof mem>;
}): Promise<Rig> {
  const storage = o.storage ?? mem();
  if (o.mark) storage.data.set(MARK, JSON.stringify({ v: 1, tag: o.mark }));
  if (o.device)
    storage.data.set(PROGRESS, typeof o.device === 'string' ? o.device : serializeProfile(o.device));
  const { api, calls } = fakeServer(o.route);
  const device = new DeviceProfileStore(storage);
  const meta = new MetaState(device, now);
  await meta.ready;
  const notes: string[] = [];
  const chosen: { account: Profile; device: Profile }[] = [];
  const screens: AccountScreens = {
    notice: (t) => notes.push(t),
    choose: (account, dev) => {
      chosen.push({ account, device: dev });
      return Promise.resolve(o.choose ?? 'account');
    },
  };
  const mark = accountMark(storage);
  let left = 0;
  let entered = 0;
  const ctl = new AccountController({
    api,
    meta,
    mark,
    device,
    deviceText: () => storage.getItem(PROGRESS),
    screens,
    left: () => (left += 1),
    entered: () => (entered += 1),
    now,
  });
  let loads = 0;
  return {
    storage,
    calls,
    api,
    meta,
    ctl,
    notes,
    chosen,
    left: () => left,
    entered: () => entered,
    boot: (login) =>
      bootAccount(
        {
          api,
          mark,
          meta,
          controller: () => {
            loads += 1;
            return Promise.resolve(ctl);
          },
        },
        login,
      ),
    get loads() {
      return loads;
    },
  } as Rig & { loads: number };
}

const markOf = (r: Rig): unknown => JSON.parse(r.storage.data.get(MARK) ?? 'null');

describe('계정 API 요청 (account/api.ts)', () => {
  it('GET은 같은 출처 쿠키 · 캐시 없음 · 표시 헤더 없음, POST는 x-decoy-account: 1 + JSON 본문', async () => {
    const { api, calls } = fakeServer(() => json(200, { ok: true }));
    await api.request('/api/account', null, (b) => b);
    await api.request('/api/account/costume', { action: 'buy', team: 'survivor', id: 'pack' }, (b) => b);
    const [get, post] = calls;
    expect(get).toMatchObject({ method: 'GET', path: '/api/account', body: null });
    expect(get?.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    expect(get?.headers['x-decoy-account']).toBeUndefined();
    expect(post).toMatchObject({
      method: 'POST',
      body: { action: 'buy', team: 'survivor', id: 'pack' },
      headers: { 'content-type': 'application/json', 'x-decoy-account': '1' },
    });
    expect(post?.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  });

  it('실패도 예외 없이: 5초 넘으면 timeout · 네트워크 net · 401 auth · 503 {error:db} db · 모양이 틀린 200 bad', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const slow = fakeServer(hang).api.request('/api/account', null, (b) => b);
    await vi.advanceTimersByTimeAsync(ACCOUNT_TIMEOUT_MS - 1);
    let settled = false;
    void slow.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await slow).toEqual({ ok: false, status: 0, error: 'timeout' });
    vi.useRealTimers();
    const call = (route: Route) => fakeServer(route).api.request('/api/account', null, (b) => b);
    expect(await call(() => Promise.reject(new TypeError('Failed to fetch')))).toMatchObject({
      error: 'net',
    });
    expect(await call(() => json(401, { error: 'auth' }))).toEqual({ ok: false, status: 401, error: 'auth' });
    expect(await call(() => new Response('', { status: 401 }))).toMatchObject({ error: 'auth' });
    expect(await call(() => json(503, { error: 'db' }))).toEqual({ ok: false, status: 503, error: 'db' });
    expect(await call(() => new Response('<html>', { status: 200 }))).toMatchObject({
      ok: false,
      error: 'bad',
    });
    expect(await call(() => json(200, { on: 'yes' }))).toMatchObject({ ok: true });
  });

  it('상태 응답은 모양을 본다: tag · 시간대 · 기록 글이 틀리면 null', () => {
    expect(readStatus({ on: false })).toEqual({ on: false });
    expect(readStatus({ on: true, signedIn: false })).toEqual({ on: true, signedIn: false });
    const ok = statusIn('t1', null);
    expect(readStatus(ok)).toEqual(ok);
    for (const bad of [
      null,
      'x',
      { on: 'true' },
      { ...(ok as object), tag: '<script>' },
      { ...(ok as object), timeZone: 'Mars/Base' },
      { ...(ok as object), profile: 3 },
      { ...(ok as object), fresh: 'no' },
    ])
      expect(readStatus(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('이 기기 표시 decoy:account', () => {
  it('JSON {v:1, tag}로 쓰고 읽고 지운다. 깨졌거나 다른 판 · 이상한 tag면 없음', () => {
    const s = mem();
    const m = accountMark(s);
    expect(m.read()).toBeNull();
    expect(m.write('abc_123-Z')).toBe(true);
    expect(JSON.parse(s.data.get(MARK) ?? '')).toEqual({ v: 1, tag: 'abc_123-Z' });
    expect(m.read()).toBe('abc_123-Z');
    expect(m.clear()).toBe(true);
    expect(m.read()).toBeNull();
    for (const raw of ['{', '{"v":2,"tag":"a"}', '{"v":1,"tag":"a b"}', '{"v":1}', '5'])
      expect(accountMark({ ...s, getItem: () => raw }).read(), raw).toBeNull();
    // 저장소가 막혀도 예외 없이
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(accountMark(blocked).read()).toBeNull();
    expect(accountMark(blocked).write('a')).toBe(false);
  });
});

describe('부팅 (account/boot.ts): 게스트는 요청 없음', () => {
  it('표시도 ?login=도 없으면(게스트 · 기능 꺼짐) 계정 요청도 조각 받기도 없다', async () => {
    const r = (await rig({ route: () => json(200, { on: false }) })) as Rig & { loads: number };
    expect(r.boot(null)).toBeNull();
    expect(r.calls).toEqual([]);
    expect(r.loads).toBe(0);
    expect(r.meta.mode).toBe('device');
    expect(r.meta.waiting).toBe(false);
  });

  it('표시가 있으면 상태를 읽어 계정 모드 (같은 tag — 묻지 않음, 올리기 없음). 읽는 동안 칩은 기다림', async () => {
    const account = profileWith({ xp: 500, coins: 70 });
    const r = await rig({
      mark: 'T1',
      device: profileWith({ xp: 9, coins: 1 }),
      route: () => json(200, statusIn('T1', account)),
    });
    const done = r.boot(null);
    expect(r.meta.waiting).toBe(true);
    await done;
    expect(r.meta.waiting).toBe(false);
    expect(r.meta.mode).toBe('server');
    expect(r.meta.current.xp).toBe(500);
    expect(r.meta.current.coins).toBe(70);
    expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/account']);
    expect(r.notes).toEqual([]);
    expect(r.ctl.view).toBe('in');
  });

  it('계정 읽기가 3초를 넘으면 칩은 기기 기록으로, 늦게 오면 그때 계정으로', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let answer = (): void => undefined;
    const r = await rig({
      mark: 'T1',
      device: profileWith({ xp: 9 }),
      route: () =>
        new Promise<Response>(
          (res) => (answer = () => res(json(200, statusIn('T1', profileWith({ xp: 700 }))))),
        ),
    });
    const done = r.boot(null);
    await vi.advanceTimersByTimeAsync(BOOT_WAIT_MS - 10);
    expect(r.meta.waiting).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(r.meta.waiting).toBe(false);
    expect(r.meta.mode).toBe('device');
    expect(r.meta.current.xp).toBe(9);
    answer();
    await done;
    expect(r.meta.mode).toBe('server');
    expect(r.meta.current.xp).toBe(700);
  });

  it('?login=만 있어도(표시 없음) 읽는다 — 칩은 기다리지 않는다', async () => {
    const r = await rig({ route: () => json(200, statusIn('T1', profileWith({ xp: 5 }))) });
    const done = r.boot('ok');
    expect(r.meta.waiting).toBe(false);
    await done;
    expect(r.calls).toHaveLength(1);
    expect(r.meta.mode).toBe('server');
    expect(markOf(r)).toEqual({ v: 1, tag: 'T1' });
    expect(r.notes).toEqual([T.results.ok]);
  });
});

describe('부팅 결과 갈래', () => {
  it('401 · 로그인 안 함: 표시를 지우고 게스트(기기 기록), 표시가 있었으면 한 줄', async () => {
    for (const [res, view, note] of [
      [json(401, { error: 'auth' }), 'out', T.expired],
      [json(200, { on: true, signedIn: false }), 'out', T.expired],
    ] as const) {
      const r = await rig({ mark: 'T1', device: profileWith({ xp: 9 }), route: () => res.clone() });
      await r.boot(null);
      expect(r.storage.data.has(MARK), view).toBe(false);
      expect(r.meta.mode).toBe('device');
      expect(r.meta.current.xp).toBe(9);
      expect(r.ctl.view).toBe(view);
      expect(r.notes).toEqual([note]);
    }
  });

  it('503 · 시간 초과: 이번 접속은 게스트 + "계정에 연결하지 못해 이 기기 기록으로 해요", 표시는 남기고 설정을 열 때 다시 읽는다', async () => {
    let route: Route = () => json(503, { error: 'db' });
    const r = await rig({ mark: 'T1', device: profileWith({ xp: 9 }), route: (c) => route(c) });
    await r.boot(null);
    expect(r.meta.mode).toBe('device');
    expect(r.meta.current.xp).toBe(9);
    expect(markOf(r)).toEqual({ v: 1, tag: 'T1' });
    expect(r.notes).toEqual([T.offline]);
    expect(r.ctl.view).toBe('unknown');
    // 설정을 열면 다시 읽는다 (이번엔 닿는다)
    route = () => json(200, statusIn('T1', profileWith({ xp: 300 })));
    expect(await r.ctl.ensure()).toBe('in');
    expect(r.meta.mode).toBe('server');
    expect(r.meta.current.xp).toBe(300);
    // 알고 나면 다시 묻지 않는다
    const n = r.calls.length;
    expect(await r.ctl.ensure()).toBe('in');
    expect(r.calls.length).toBe(n);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const slow = await rig({ mark: 'T1', device: profileWith({ xp: 9 }), route: hang });
    const done = slow.boot(null);
    await vi.advanceTimersByTimeAsync(ACCOUNT_TIMEOUT_MS + 10);
    await done;
    expect(slow.meta.mode).toBe('device');
    expect(slow.notes).toEqual([T.offline]);
  });

  it('?login= 결과 안내: ok는 실제로 로그인됐을 때만 "로그인했어요", 취소 · 실패 · 꺼짐 · DB는 그 문구 하나', async () => {
    const out = await rig({ route: () => json(200, { on: true, signedIn: false }) });
    await out.boot('ok');
    expect(out.notes).toEqual([T.results.fail]);
    const cancel = await rig({ route: () => json(200, { on: true, signedIn: false }) });
    await cancel.boot('cancel');
    expect(cancel.notes).toEqual([T.results.cancel]);
    const db = await rig({ route: () => json(503, { error: 'db' }) });
    await db.boot('db');
    expect(db.notes).toEqual([T.results.db]);
    const off = await rig({ route: () => json(200, { on: false }) });
    await off.boot('off');
    expect(off.notes).toEqual([T.results.off]);
    // 모르는 값은 안내 없이 상태만
    const odd = await rig({ route: () => json(200, { on: true, signedIn: false }) });
    await odd.boot('<b>');
    expect(odd.notes).toEqual([]);
  });
});

describe('첫 로그인 (이 기기 표시 tag ≠ 계정 tag)', () => {
  const importRoute =
    (statusBody: unknown, imported: Profile): Route =>
    (c) =>
      c.path === '/api/account' ? json(200, statusBody) : json(200, body(imported));

  it("빈 기기 + 빈 계정: 묻지 않고 빈 기록으로 계정을 연다 ({choice:'account', device:null} — 그사이 다른 기기가 올린 기록을 덮지 않게), 올리기 안내 없음", async () => {
    const r = await rig({ route: importRoute(statusIn('T1', null), emptyProfile(clock)) });
    await r.boot('ok');
    const imp = r.calls.find((c) => c.path === '/api/account/import');
    expect(imp?.body).toEqual({ choice: 'account', device: null });
    expect(imp?.headers['x-decoy-account']).toBe('1');
    expect(r.chosen).toEqual([]);
    expect(markOf(r)).toEqual({ v: 1, tag: 'T1' });
    expect(r.meta.mode).toBe('server');
    expect(r.notes).toEqual([T.results.ok]);
  });

  it('빈 기기(저장 없음 · 깨짐 · 아무것도 안 쌓음) + 계정 기록 있음: 묻지도 올리지도 않고 계정 기록', async () => {
    for (const dev of [null, '{broken', profileWith({ created: 5 })]) {
      const r = await rig({ device: dev, route: () => json(200, statusIn('T2', profileWith({ xp: 420 }))) });
      await r.boot('ok');
      expect(r.calls.map((c) => c.path)).toEqual(['/api/account']);
      expect(r.chosen).toEqual([]);
      expect(r.meta.current.xp).toBe(420);
      expect(markOf(r)).toEqual({ v: 1, tag: 'T2' });
    }
  });

  it('기기 기록 + 빈 계정: 이 기기 기록 글 그대로 올리고 "이 기기 기록을 계정에 올렸어요". 기기 기록은 지우지 않는다', async () => {
    const dev = profileWith({ xp: 130, coins: 40, played: { survivor: 2, monster: 0 } });
    const text = serializeProfile(dev);
    const r = await rig({ device: text, route: importRoute(statusIn('T1', null), { ...dev, updated: 9 }) });
    await r.boot('ok');
    const imp = r.calls.find((c) => c.path === '/api/account/import');
    expect(imp?.body).toEqual({ choice: 'device', device: text });
    expect(r.chosen).toEqual([]);
    expect(r.meta.mode).toBe('server');
    expect(r.meta.current.xp).toBe(130);
    expect(r.notes).toEqual([T.results.ok, T.imported]);
    expect(r.storage.data.get(PROGRESS)).toBe(text);
  });

  it('기기 기록 + 아무것도 쌓지 않은 계정 기록(빈 기기로 처음 로그인해 만든 것): 묻지 않고 이 기기 기록을 올린다', async () => {
    const dev = profileWith({ xp: 130, coins: 40, played: { survivor: 2, monster: 0 } });
    const text = serializeProfile(dev);
    const r = await rig({
      device: text,
      route: importRoute(statusIn('T5', profileWith({})), { ...dev, updated: 9 }),
    });
    await r.boot('ok');
    expect(r.chosen).toEqual([]);
    const imp = r.calls.find((c) => c.path === '/api/account/import');
    expect(imp?.body).toEqual({ choice: 'device', device: text });
    expect(r.meta.current.xp).toBe(130);
    expect(r.notes).toEqual([T.results.ok, T.imported]);
    expect(markOf(r)).toEqual({ v: 1, tag: 'T5' });
  });

  it('둘 다 있으면 고르기 창(계정 · 이 기기 기록) → 고른 쪽으로 import, 고른 뒤 표시를 적는다', async () => {
    const dev = profileWith({ xp: 130, coins: 40 });
    const acc = profileWith({ xp: 900, coins: 5, owned: ['pack'] });
    for (const choice of ['account', 'device'] as const) {
      const after = choice === 'account' ? acc : dev;
      const r = await rig({ device: dev, choose: choice, route: importRoute(statusIn('T3', acc), after) });
      await r.boot('ok');
      expect(r.chosen).toHaveLength(1);
      expect(r.chosen[0]?.account.xp).toBe(900);
      expect(r.chosen[0]?.account.owned).toEqual(['pack']);
      expect(r.chosen[0]?.device.xp).toBe(130);
      const imp = r.calls.find((c) => c.path === '/api/account/import');
      // 고른 대로 올린다: '계정 기록'이면 이 기기 기록 글을 보내지 않는다 (처리방침)
      expect(imp?.body).toEqual({ choice, device: choice === 'device' ? serializeProfile(dev) : null });
      expect(r.meta.current.xp).toBe(after.xp);
      expect(markOf(r)).toEqual({ v: 1, tag: 'T3' });
      expect(r.notes).toEqual(choice === 'device' ? [T.results.ok, T.imported] : [T.results.ok]);
    }
  });

  it('같은 계정에 두 번 묻지 않는다: 표시 tag가 같으면 둘 다 있어도 고르기 · 올리기 없음', async () => {
    const r = await rig({
      mark: 'T3',
      device: profileWith({ xp: 130 }),
      route: () => json(200, statusIn('T3', profileWith({ xp: 900 }))),
    });
    await r.boot(null);
    expect(r.chosen).toEqual([]);
    expect(r.calls.map((c) => c.path)).toEqual(['/api/account']);
    expect(r.meta.current.xp).toBe(900);
  });

  it('올리기가 실패하면(503) 게스트 그대로 · 표시는 시도 중으로 남기고(다음 부팅이 다시) · 기기 기록 그대로 + 안내', async () => {
    const dev = profileWith({ xp: 130 });
    let importRes = (): Response => json(503, { error: 'db' });
    const route: Route = (c) => (c.path === '/api/account' ? json(200, statusIn('T1', null)) : importRes());
    const r = await rig({ device: dev, route });
    await r.boot('ok');
    expect(r.meta.mode).toBe('device');
    expect(r.meta.current.xp).toBe(130);
    expect(markOf(r)).toEqual({ v: 1, tag: '' });
    expect(r.notes).toEqual([T.offline]);
    expect(r.ctl.view).toBe('unknown');
    // 다음 부팅(?login= 없음): 시도 중 표시가 있으니 상태를 읽고 첫 로그인(올리기)을 다시 한다
    importRes = () => json(200, body(dev));
    const next = await rig({ storage: r.storage, route });
    await next.boot(null);
    expect(next.calls.map((c) => c.path)).toEqual(['/api/account', '/api/account/import']);
    expect(next.calls[1]?.body).toEqual({ choice: 'device', device: serializeProfile(dev) });
    expect(next.meta.mode).toBe('server');
    expect(markOf(next)).toEqual({ v: 1, tag: 'T1' });
    expect(next.notes).toEqual([T.imported]);
  });
});

/** 계정 모드 기록 상태 (부팅 흐름 없이 계정 저장소를 바로 끼운다) */
async function accountMeta(
  account: Profile,
  route: Route,
  timeZone = TZ,
): Promise<{
  meta: MetaState;
  store: ServerProfileStore;
  storage: ReturnType<typeof mem>;
  calls: Call[];
  lost: () => number;
}> {
  const storage = mem();
  storage.data.set(PROGRESS, serializeProfile(profileWith({ xp: 11, coins: 3 })));
  const { api, calls } = fakeServer(route);
  const device = new DeviceProfileStore(storage);
  const meta = new MetaState(device, now);
  await meta.ready;
  let lost = 0;
  const store = new ServerProfileStore(
    api,
    serializeProfile(account),
    timeZone,
    'T1',
    () => (lost += 1),
    now,
    device,
  );
  await meta.useStore(store);
  storage.writes.length = 0;
  return { meta, store, storage, calls, lost: () => lost };
}

describe('계정 모드: 받기 · 해금 · 입기는 계정 API로', () => {
  it('성공하면 응답의 기록으로 바꾼다 — 기기 기록에는 쓰지 않는다', async () => {
    const start = profileWith({ coins: 300 });
    let server = start;
    const { meta, storage, calls } = await accountMeta(start, (c) => {
      if (c.path === '/api/account/claim-login') {
        server = { ...server, coins: server.coins + 50, login: { last: dayKeyInZone(clock, TZ), streak: 1 } };
        return json(200, body(server, { claimed: { reward: 50, streak: 1 } }));
      }
      const b = c.body as { action: string; id: string };
      if (b.action === 'buy') {
        server = { ...server, coins: server.coins - 250, owned: [b.id] };
        return json(200, body(server, { result: 'ok', price: 250 }));
      }
      server = { ...server, wear: { ...server.wear, survivor: 'pack' } };
      return json(200, body(server, { result: 'ok' }));
    });
    expect(await meta.claimLogin()).toEqual({ reward: 50, streak: 1, saved: true });
    expect(meta.current.coins).toBe(350);
    expect(meta.login().available).toBe(false);
    expect(await meta.buyCostume('survivor', 'pack')).toEqual({ ok: true, price: 250, saved: true });
    expect(meta.current.coins).toBe(100);
    expect(await meta.wearCostume('survivor', 'pack')).toEqual({ saved: true });
    expect(meta.costumes().survivor).toBe('pack');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/account/claim-login',
      'POST /api/account/costume',
      'POST /api/account/costume',
    ]);
    expect(calls[1]?.body).toEqual({ action: 'buy', team: 'survivor', id: 'pack' });
    expect(calls[2]?.body).toEqual({ action: 'wear', team: 'survivor', id: 'pack' });
    expect(storage.writes).toEqual([]);
  });

  it('서버가 거절하면(이미 받음 · 불씨 모자람 · 못 입음) 그 결과, 기록은 서버 것', async () => {
    const acc = profileWith({ coins: 10 });
    const { meta } = await accountMeta(acc, (c) =>
      c.path === '/api/account/claim-login'
        ? json(200, body(acc, { claimed: null }))
        : json(
            200,
            body(acc, { result: (c.body as { action: string }).action === 'buy' ? 'coins' : 'not-owned' }),
          ),
    );
    expect(await meta.claimLogin()).toBeNull();
    expect(await meta.buyCostume('monster', 'chains')).toEqual({ ok: false, reason: 'coins' });
    expect(await meta.wearCostume('monster', 'chains')).toBeNull();
  });

  it('계정에 닿지 않으면(503 · 네트워크) 기록을 바꾸지 않고 실패를 돌려준다 — 기기 쪽으로 몰래 쓰지 않는다', async () => {
    for (const fail of [() => json(503, { error: 'db' }), () => Promise.reject(new TypeError('offline'))]) {
      const { meta, storage } = await accountMeta(profileWith({ coins: 300 }), fail);
      const before = serializeProfile(meta.current);
      expect(await meta.claimLogin()).toMatchObject({ saved: false, fail: 'account' });
      expect(await meta.buyCostume('survivor', 'pack')).toEqual({ ok: false, reason: 'account' });
      expect(await meta.wearCostume('survivor', 'basic')).toEqual({ saved: false, fail: 'account' });
      expect(serializeProfile(meta.current)).toBe(before);
      expect(meta.mode).toBe('server');
      expect(storage.writes).toEqual([]);
    }
  });
});

describe('계정 날짜 · 자정 (계정 시간대)', () => {
  it('오늘 · 접속 보상 · 도전은 계정 시간대 자정에 바뀐다 (이 기기 시간대와 무관)', async () => {
    // 키리티마티(UTC+14): 10월 27일 09:59Z = 그곳 23:59 — 이 기기 시간대가 무엇이든 다른 날짜가 된다
    const zone = 'Pacific/Kiritimati';
    clock = Date.UTC(2026, 9, 27, 9, 59, 0);
    const { meta } = await accountMeta(
      profileWith({ login: { last: '2026-10-27', streak: 1 } }),
      () => json(503, {}),
      zone,
    );
    expect(meta.timeZone).toBe(zone);
    expect(meta.today()).toBe('2026-10-27');
    expect(meta.login()).toEqual({ available: false, streak: 1 });
    expect(meta.untilMidnight()).toBe(60_000);
    const before = meta.daily();
    clock += 2 * 60_000; // 그곳 00:01
    expect(meta.today()).toBe('2026-10-28');
    expect(meta.login()).toEqual({ available: true, streak: 2 });
    expect(meta.daily().day).toBe('2026-10-28');
    expect(before.day).toBe('2026-10-27');
    expect(meta.untilMidnight()).toBe(86_400_000 - 60_000);
  });
});

describe('계정 모드 판 결과: 서버 적립 (credit)', () => {
  const XP = PROGRESSION.xp.base + 6 * PROGRESSION.xp.perTier + PROGRESSION.xp.win;

  it('온라인 판: 숫자는 같은 공용 함수의 미리보기, 기록은 credit을 기다린다 → 저장했어요', async () => {
    const acc = profileWith({ xp: 40 });
    const { meta, storage } = await accountMeta(acc, () => json(503, {}));
    // 이 자리에 서버가 받아들인 계정 = 지금 계정 (welcome.account)
    const applied = await meta.applyRating(rating('M.1'), false, 'T1');
    const expected = applyRating(acc, rating('M.1'), clock, PROGRESSION, dayKeyInZone(clock, TZ));
    expect(applied.gain).toEqual(expected?.gain);
    expect(applied.gain?.xp.total).toBe(XP);
    expect(applied.account?.state).toBe('pending');
    // 아직 적립하지 않았다 (서버가 한다)
    expect(meta.current.xp).toBe(40);
    const seen: string[] = [];
    applied.account?.subscribe((s) => seen.push(s));
    meta.credit('T1', 'M.1', true, serializeProfile(expected?.profile ?? acc));
    expect(applied.account?.state).toBe('saved');
    expect(seen).toEqual(['saved']);
    await vi.waitFor(() => expect(meta.current.xp).toBe(40 + XP));
    expect(storage.writes).toEqual([]);
  });

  it('credit ok:false면 저장하지 못했어요 — 기록은 그대로. 같은 계정 다른 탭 판의 credit은 기록만 바꾼다', async () => {
    const { meta } = await accountMeta(profileWith({ xp: 40 }), () => json(503, {}));
    const applied = await meta.applyRating(rating('M.2'), false, 'T1');
    meta.credit('T1', 'M.2', false, null);
    expect(applied.account?.state).toBe('failed');
    expect(meta.current.xp).toBe(40);
    // 다른 탭 판 (기다리는 판이 아님)
    meta.credit('T1', 'M.other', true, serializeProfile(profileWith({ xp: 777 })));
    await vi.waitFor(() => expect(meta.current.xp).toBe(777));
    expect(applied.account?.state).toBe('failed');
  });

  it('20초 안에 credit이 없으면 상태를 다시 읽어: 판 ID가 기록에 있으면 저장했어요, 없으면 모름(늦은 credit이 오면 저장했어요)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let serverProfile = profileWith({ xp: 40 });
    const { meta, calls } = await accountMeta(serverProfile, () => json(200, statusIn('T1', serverProfile)));
    const a = await meta.applyRating(rating('M.3'), false, 'T1');
    const b = await meta.applyRating(rating('M.4'), false, 'T1');
    // 서버가 M.3만 적립해 두었다 (credit은 잃음)
    serverProfile =
      applyRating(serverProfile, rating('M.3'), clock, PROGRESSION, dayKeyInZone(clock, TZ))?.profile ??
      serverProfile;
    await vi.advanceTimersByTimeAsync(CREDIT_WAIT_MS - 100);
    expect(a.account?.state).toBe('pending');
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.map((c) => c.path)).toEqual(['/api/account', '/api/account']);
    expect(a.account?.state).toBe('saved');
    expect(b.account?.state).toBe('unknown');
    expect(meta.current.recent).toContain('M.3');
    meta.credit('T1', 'M.4', true, serializeProfile(serverProfile));
    expect(b.account?.state).toBe('saved');
  });

  it('연습 판(기기 안 서버)은 계정에 적립하지 않고 기기 기록에도 쓰지 않는다 — 요청도 없다', async () => {
    const { meta, storage, calls } = await accountMeta(profileWith({ xp: 40 }), () => json(200, {}));
    const r = await meta.applyRating(rating('L.1'), true);
    expect(r).toMatchObject({ gain: null, practice: true, saved: true });
    expect(r.account).toBeUndefined();
    expect(meta.current.xp).toBe(40);
    expect(storage.writes).toEqual([]);
    expect(storage.data.get(PROGRESS)).toBe(serializeProfile(profileWith({ xp: 11, coins: 3 })));
    expect(calls).toEqual([]);
  });

  it('게스트는 지금 그대로: 연습 판도 기기 기록에 적립하고, credit은 무시한다', async () => {
    const storage = mem();
    const meta = new MetaState(new DeviceProfileStore(storage), now);
    await meta.ready;
    const r = await meta.applyRating(rating('L.2'), true);
    expect(r.gain?.xp.total).toBe(XP);
    expect(r.saved).toBe(true);
    expect(r.practice).toBeUndefined();
    meta.credit('T1', 'L.2', true, serializeProfile(profileWith({ xp: 99999 })));
    expect(meta.current.xp).toBe(XP);
    expect(parseProfile(storage.data.get(PROGRESS) ?? null, clock).profile.xp).toBe(XP);
  });

  it('계정 모드인데 게스트 자리(welcome.account 없음 — 계정 모드가 되기 전에 들어온 판): 서버가 적립하지 않으니 기기 기록에 적립하고 한 줄', async () => {
    const { meta, storage, calls } = await accountMeta(profileWith({ xp: 40 }), () => json(503, {}));
    const r = await meta.applyRating(rating('M.9'), false, null);
    expect(r.account).toBeUndefined();
    expect(r.device).toBe(true);
    expect(r.gain?.xp.total).toBe(XP);
    expect(r.saved).toBe(true);
    // 기기 기록(경험치 11)에 더했다. 계정 기록은 그대로 · 계정 요청 없음
    expect(parseProfile(storage.data.get(PROGRESS) ?? null, clock).profile.xp).toBe(11 + XP);
    expect(meta.current.xp).toBe(40);
    expect(meta.mode).toBe('server');
    expect(calls).toEqual([]);
    // 같은 판 결과를 다시 받아도(재접속) 두 번 적립하지 않는다
    expect((await meta.applyRating(rating('M.9'), false, null)).gain).toBeNull();
    expect(parseProfile(storage.data.get(PROGRESS) ?? null, clock).profile.xp).toBe(11 + XP);
    // 연습 판은 그대로 어디에도 적립하지 않는다
    expect(await meta.applyRating(rating('L.9'), true, null)).toMatchObject({ practice: true, gain: null });
  });

  it('들어올 때의 계정 자리인데 지금 모드가 다르다(그사이 로그아웃 · 다른 계정): 서버가 그 계정에 적립하므로 화면은 어디에도 적립하지 않고 한 줄', async () => {
    // 지금은 다른 계정 모드 (T1) — 자리는 T0 계정
    const { meta, storage, calls } = await accountMeta(profileWith({ xp: 40 }), () => json(503, {}));
    const other = await meta.applyRating(rating('M.7'), false, 'T0');
    expect(other).toMatchObject({ gain: null, saved: true, elsewhere: true });
    expect(other.account).toBeUndefined();
    expect(meta.current.xp).toBe(40);
    expect(storage.writes).toEqual([]);
    expect(calls).toEqual([]);
    // 지금은 게스트 모드 (그사이 로그아웃) — 자리는 계정
    const guestStorage = mem();
    const guest = new MetaState(new DeviceProfileStore(guestStorage), now);
    await guest.ready;
    const out = await guest.applyRating(rating('M.8'), false, 'T1');
    expect(out).toMatchObject({ gain: null, saved: true, elsewhere: true });
    expect(guestStorage.writes).toEqual([]);
    expect(guest.current.xp).toBe(0);
    // 게스트 모드 · 게스트 자리는 지금처럼 기기 기록 (한 줄 없음)
    const plain = await guest.applyRating(rating('M.6'), false, null);
    expect(plain.gain?.xp.total).toBe(XP);
    expect(plain.device).toBeUndefined();
    expect(plain.elsewhere).toBeUndefined();
    expect(parseProfile(guestStorage.data.get(PROGRESS) ?? null, clock).profile.xp).toBe(XP);
  });

  it('credit은 지금 계정 tag 것만 받는다 (다른 계정 tag는 무시 — 다른 계정 기록으로 화면을 바꾸지 않는다)', async () => {
    const { meta } = await accountMeta(profileWith({ xp: 40 }), () => json(503, {}));
    const applied = await meta.applyRating(rating('M.5'), false, 'T1');
    meta.credit('T9', 'M.5', true, serializeProfile(profileWith({ xp: 5000 })));
    await new Promise((r) => setTimeout(r, 5));
    expect(meta.current.xp).toBe(40);
    expect(applied.account?.state).toBe('pending');
    meta.credit('T1', 'M.5', true, serializeProfile(profileWith({ xp: 90 })));
    expect(applied.account?.state).toBe('saved');
    await vi.waitFor(() => expect(meta.current.xp).toBe(90));
  });

  it('판에 들어갈 때 밝히는 계정 tag (join · quick의 account): 계정 모드면 그 계정 tag, 게스트면 없음(칸이 빠져 메시지가 전과 같다)', async () => {
    const { meta } = await accountMeta(profileWith({ xp: 40 }), () => json(503, {}));
    expect(meta.tag).toBe('T1');
    expect(JSON.stringify({ t: 'quick', name: 'a', account: meta.tag })).toBe(
      '{"t":"quick","name":"a","account":"T1"}',
    );
    const guest = new MetaState(new DeviceProfileStore(mem()), now);
    await guest.ready;
    expect(guest.tag).toBeUndefined();
    expect(JSON.stringify({ t: 'quick', name: 'a', account: guest.tag })).toBe('{"t":"quick","name":"a"}');
    // 로그아웃하면 다시 없음
    await meta.useStore(new DeviceProfileStore(mem()));
    expect(meta.tag).toBeUndefined();
  });

  it('앱으로 돌아오면(refresh) 계정 기록을 다시 읽는다 — 15초에 한 번까지', async () => {
    let serverProfile = profileWith({ xp: 40 });
    const { meta, calls } = await accountMeta(serverProfile, () => json(200, statusIn('T1', serverProfile)));
    serverProfile = profileWith({ xp: 600 });
    meta.refresh();
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toHaveLength(0);
    clock += 16_000;
    meta.refresh();
    await vi.waitFor(() => expect(meta.current.xp).toBe(600));
    expect(calls).toHaveLength(1);
  });
});

describe('로그아웃 · 계정 삭제 · 세션 끝 → 기기 모드', () => {
  async function signedIn(route: Route): Promise<Rig> {
    const r = await rig({
      mark: 'T1',
      device: profileWith({ xp: 9 }),
      route: (c) =>
        c.path === '/api/account' ? json(200, statusIn('T1', profileWith({ xp: 500 }))) : route(c),
    });
    await r.boot(null);
    expect(r.meta.mode).toBe('server');
    return r;
  }

  it('로그아웃: POST 뒤 표시를 지우고 이 기기 기록으로 + 안내 (연결을 새로 열게 알림)', async () => {
    const r = await signedIn(() => json(200, { ok: true }));
    expect(await r.ctl.logout()).toBe(true);
    const post = r.calls.at(-1);
    expect(post).toMatchObject({ method: 'POST', path: '/api/account/logout' });
    expect(post?.headers['x-decoy-account']).toBe('1');
    expect(r.meta.mode).toBe('device');
    expect(r.meta.current.xp).toBe(9);
    expect(r.storage.data.has(MARK)).toBe(false);
    expect(r.notes).toEqual([T.loggedOut]);
    expect(r.ctl.view).toBe('out');
    expect(r.left()).toBe(1);
  });

  it('계정 삭제: 서버 기록을 지우면 기기 모드 + 안내. 닿지 않으면 false · 계정 모드 그대로', async () => {
    let route: Route = () => json(503, { error: 'db' });
    const r = await signedIn((c) => route(c));
    expect(await r.ctl.remove()).toBe(false);
    expect(r.meta.mode).toBe('server');
    expect(markOf(r)).toEqual({ v: 1, tag: 'T1' });
    route = () => json(200, { deleted: true });
    expect(await r.ctl.remove()).toBe(true);
    expect(r.calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/account/delete' });
    expect(r.meta.mode).toBe('device');
    expect(r.storage.data.has(MARK)).toBe(false);
    expect(r.notes).toEqual([T.removed]);
    // 기기 기록은 그대로
    expect(r.meta.current.xp).toBe(9);
  });

  it('계정 API가 401이면(다른 기기에서 지움 · 세션 끝) 게스트로 + "로그인이 끝나 이 기기 기록으로 해요"', async () => {
    const r = await signedIn(() => json(401, { error: 'auth' }));
    expect(await r.meta.claimLogin()).toMatchObject({ fail: 'account' });
    await vi.waitFor(() => expect(r.meta.mode).toBe('device'));
    expect(r.storage.data.has(MARK)).toBe(false);
    expect(r.notes).toEqual([T.expired]);
    expect(r.ctl.view).toBe('out');
  });
});

describe('로그인 꺼짐(on:false)은 표시를 지우지 않는다 — 안내는 처음 한 번만', () => {
  it('부팅 때 꺼짐: 이번 접속은 게스트 + 한 줄, 표시는 남기고 off를 적는다. 다음 부팅부터는 안내 · 칩 기다림 없이 상태만 읽고, 다시 켜지면 같은 계정으로 바로(고르기 · 올리기 없음, off 지움)', async () => {
    let route: Route = () => json(200, { on: false });
    const r = await rig({ mark: 'T1', device: profileWith({ xp: 130 }), route: (c) => route(c) });
    const first = r.boot(null);
    expect(r.meta.waiting).toBe(true);
    await first;
    expect(r.meta.mode).toBe('device');
    expect(r.meta.current.xp).toBe(130);
    expect(r.ctl.view).toBe('off');
    expect(r.notes).toEqual([T.results.off]);
    expect(markOf(r)).toEqual({ v: 1, tag: 'T1', off: true });
    // 꺼진 채 다음 부팅: 상태 요청은 하되(다시 켜졌는지) 안내 없음 · 칩 기다림 없음, 표시 그대로
    const again = await rig({ storage: r.storage, route: (c) => route(c) });
    const second = again.boot(null);
    expect(second).not.toBeNull();
    expect(again.meta.waiting).toBe(false);
    await second;
    expect(again.calls.map((c) => c.path)).toEqual(['/api/account']);
    expect(again.notes).toEqual([]);
    expect(again.meta.mode).toBe('device');
    expect(markOf(again)).toEqual({ v: 1, tag: 'T1', off: true });
    // 다시 켜짐 (쿠키는 그대로): 다음 부팅이 읽어 같은 계정 모드, off를 지운다. 칩은 기다리지 않는다(꺼짐을 알린 표시)
    route = () => json(200, statusIn('T1', profileWith({ xp: 900 })));
    const next = await rig({ storage: r.storage, route: (c) => route(c) });
    const third = next.boot(null);
    expect(next.meta.waiting).toBe(false);
    await third;
    expect(next.meta.mode).toBe('server');
    expect(next.meta.current.xp).toBe(900);
    expect(next.chosen).toEqual([]);
    expect(next.notes).toEqual([]);
    expect(next.calls.map((c) => c.path)).toEqual(['/api/account']);
    expect(markOf(next)).toEqual({ v: 1, tag: 'T1' });
    // 다시 꺼지면 다시 한 번 알린다
    route = () => json(200, { on: false });
    const off2 = await rig({ storage: r.storage, route: (c) => route(c) });
    await off2.boot(null);
    expect(off2.notes).toEqual([T.results.off]);
  });

  it('꺼짐을 알린 표시인데 다시 켜져 세션이 끝났으면(로그인 안 함) 표시를 지우고 한 줄 (다른 계정이면 첫 로그인)', async () => {
    const storage = mem();
    storage.data.set(MARK, JSON.stringify({ v: 1, tag: 'T1', off: true }));
    const out = await rig({ storage, route: () => json(200, { on: true, signedIn: false }) });
    await out.boot(null);
    expect(out.storage.data.has(MARK)).toBe(false);
    expect(out.notes).toEqual([T.expired]);
    const other = mem();
    other.data.set(MARK, JSON.stringify({ v: 1, tag: 'T1', off: true }));
    const dev = profileWith({ xp: 130 });
    const r = await rig({
      storage: other,
      device: dev,
      route: (c) => (c.path === '/api/account' ? json(200, statusIn('T2', null)) : json(200, body(dev))),
    });
    await r.boot(null);
    expect(r.calls.map((c) => c.path)).toEqual(['/api/account', '/api/account/import']);
    expect(markOf(r)).toEqual({ v: 1, tag: 'T2' });
  });

  it('계정 모드 중 꺼짐(다시 읽기에서 on:false): 게스트로 돌아가되 표시는 남긴다. 세션 끝(로그인 안 함)은 지운다', async () => {
    for (const [after, view, kept] of [
      [{ on: false }, 'off', true],
      [{ on: true, signedIn: false }, 'out', false],
    ] as const) {
      let status: unknown = statusIn('T1', profileWith({ xp: 500 }));
      const r = await rig({ mark: 'T1', device: profileWith({ xp: 9 }), route: () => json(200, status) });
      await r.boot(null);
      expect(r.meta.mode).toBe('server');
      status = after;
      clock += 16_000;
      r.meta.refresh();
      await vi.waitFor(() => expect(r.meta.mode).toBe('device'));
      expect(r.meta.current.xp).toBe(9);
      expect(r.ctl.view, view).toBe(view);
      expect(r.storage.data.has(MARK), view).toBe(kept);
      if (kept) expect(markOf(r)).toEqual({ v: 1, tag: 'T1', off: true });
      expect(r.left()).toBe(1);
    }
  });
});

describe('로그인 시도 중 표시 (첫 로그인을 마치기 전)', () => {
  it('tag ""는 로그인 시도 중: 읽으면 "" (표시 없음 null과 다르다)', () => {
    const s = mem();
    const m = accountMark(s);
    expect(m.write('')).toBe(true);
    expect(JSON.parse(s.data.get(MARK) ?? '')).toEqual({ v: 1, tag: '' });
    expect(m.read()).toBe('');
  });

  it('?login=ok인데 상태 읽기가 실패하면(503) 시도 중 표시가 남아 다음 부팅이 상태를 읽어 첫 로그인을 잇는다', async () => {
    const dev = profileWith({ xp: 130, coins: 4 });
    const acc = profileWith({ xp: 900 });
    let route: Route = () => json(503, { error: 'db' });
    const r = await rig({ device: dev, choose: 'device', route: (c) => route(c) });
    await r.boot('ok');
    expect(r.meta.mode).toBe('device');
    expect(markOf(r)).toEqual({ v: 1, tag: '' });
    // 다음 부팅: 둘 다 있으니 고르기 창이 뜬다 (시도 중 표시는 첫 로그인으로 본다)
    route = (c) => (c.path === '/api/account' ? json(200, statusIn('T1', acc)) : json(200, body(dev)));
    const next = await rig({ storage: r.storage, choose: 'device', route: (c) => route(c) });
    const done = next.boot(null);
    expect(done).not.toBeNull();
    // 시도 중 표시도 표시다: 칩은 계정을 읽을 때까지 기다린다
    expect(next.meta.waiting).toBe(true);
    await done;
    expect(next.chosen).toHaveLength(1);
    expect(next.meta.mode).toBe('server');
    expect(markOf(next)).toEqual({ v: 1, tag: 'T1' });
  });

  it('계정 조각을 받지 못해도 시도 중 표시는 요청 전에 적는다 (첫 묶음)', async () => {
    const storage = mem();
    const { api, calls } = fakeServer(() => json(200, statusIn('T1', null)));
    const meta = new MetaState(new DeviceProfileStore(storage), now);
    await meta.ready;
    await bootAccount(
      { api, mark: accountMark(storage), meta, controller: () => Promise.resolve(null) },
      'ok',
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(storage.data.get(MARK) ?? 'null')).toEqual({ v: 1, tag: '' });
  });

  it('로그인 안 됨이면 지운다 · ?login=ok가 아니면 적지 않는다 · 이미 다른 계정 표시가 있으면 그대로 둔다', async () => {
    const out = await rig({ route: () => json(200, { on: true, signedIn: false }) });
    await out.boot('ok');
    expect(out.storage.data.has(MARK)).toBe(false);
    const cancel = await rig({ route: () => json(200, { on: true, signedIn: false }) });
    await cancel.boot('cancel');
    expect(cancel.storage.writes).not.toContain(MARK);
    const other = await rig({ mark: 'T0', route: () => json(503, { error: 'db' }) });
    await other.boot('ok');
    expect(markOf(other)).toEqual({ v: 1, tag: 'T0' });
  });
});

describe('다른 탭이 다른 계정으로 로그인함 (switched — 세션 끝이 아니다)', () => {
  it('다시 읽은 tag가 다르면 표시를 지우지 않고 상태를 다시 읽어 새 계정 모드로 (표시가 이미 새 tag면 묻지 않음), 소켓을 다시 열게 entered', async () => {
    let status: unknown = statusIn('T1', profileWith({ xp: 500 }));
    const r = await rig({ mark: 'T1', device: profileWith({ xp: 9 }), route: () => json(200, status) });
    await r.boot(null);
    expect(r.meta.mode).toBe('server');
    expect(r.meta.tag).toBe('T1');
    // 다른 탭이 T2로 로그인해 첫 로그인을 마치고 표시를 적었다
    status = statusIn('T2', profileWith({ xp: 1200 }));
    r.storage.data.set(MARK, JSON.stringify({ v: 1, tag: 'T2' }));
    clock += 16_000;
    r.meta.refresh();
    await vi.waitFor(() => expect(r.meta.tag).toBe('T2'));
    await vi.waitFor(() => expect(r.meta.current.xp).toBe(1200));
    expect(r.meta.mode).toBe('server');
    expect(markOf(r)).toEqual({ v: 1, tag: 'T2' });
    expect(r.chosen).toEqual([]);
    expect(r.calls.filter((c) => c.path !== '/api/account')).toEqual([]);
    // 세션 끝 안내 · 게스트로 내려가기가 없었다
    expect(r.notes).toEqual([]);
    expect(r.left()).toBe(0);
    expect(r.entered()).toBe(1);
    expect(r.ctl.view).toBe('in');
    // 옛 계정의 credit은 이제 받지 않는다
    r.meta.credit('T1', 'M.1', true, serializeProfile(profileWith({ xp: 3 })));
    await new Promise((res) => setTimeout(res, 5));
    expect(r.meta.current.xp).toBe(1200);
  });

  it('다른 계정으로 바뀌었는데 새 계정에 들어가지 못하면(첫 로그인 올리기 503) 옛 계정 모드에 남지 않고 게스트로', async () => {
    let status: unknown = statusIn('T1', profileWith({ xp: 500 }));
    let importRes = (): Response => json(503, { error: 'db' });
    const r = await rig({
      mark: 'T1',
      device: profileWith({ xp: 9, coins: 2 }),
      route: (c) => (c.path === '/api/account' ? json(200, status) : importRes()),
    });
    await r.boot(null);
    expect(r.meta.tag).toBe('T1');
    // 다른 탭이 새 계정 T2로 로그인했지만 첫 로그인을 아직 마치지 못했다 (표시는 로그인 시도 중)
    status = statusIn('T2', null);
    r.storage.data.set(MARK, JSON.stringify({ v: 1, tag: '' }));
    clock += 16_000;
    r.meta.refresh();
    await vi.waitFor(() => expect(r.meta.mode).toBe('device'));
    expect(r.meta.tag).toBeUndefined();
    expect(r.meta.current.xp).toBe(9);
    expect(r.left()).toBe(1);
    expect(r.notes).toEqual([T.offline]);
    expect(r.ctl.view).toBe('unknown');
    // 다음에 닿으면 새 계정으로
    importRes = () => json(200, body(profileWith({ xp: 9, coins: 2 })));
    expect(await r.ctl.ensure()).toBe('in');
    expect(r.meta.tag).toBe('T2');
  });

  it('credit을 기다리다(20초) 다시 읽었더니 다른 계정이면: 그 판은 모름, 새 계정 모드로', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let status: unknown = statusIn('T1', profileWith({ xp: 500 }));
    const r = await rig({ mark: 'T1', device: profileWith({ xp: 9 }), route: () => json(200, status) });
    await r.boot(null);
    const applied = await r.meta.applyRating(rating('M.2'), false, 'T1');
    expect(applied.account?.state).toBe('pending');
    status = statusIn('T2', profileWith({ xp: 1200 }));
    r.storage.data.set(MARK, JSON.stringify({ v: 1, tag: 'T2' }));
    await vi.advanceTimersByTimeAsync(CREDIT_WAIT_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(() => expect(r.meta.tag).toBe('T2'));
    expect(applied.account?.state).toBe('unknown');
    expect(markOf(r)).toEqual({ v: 1, tag: 'T2' });
    expect(r.left()).toBe(0);
  });
});

describe('기기 기록 올리기는 로그인 직후에만 (서버 403 relogin)', () => {
  it('첫 로그인 올리기가 relogin이면 표시를 지우고 게스트 + "다시 로그인해 주세요", 기기 기록 그대로 (다음 부팅은 요청 없음)', async () => {
    const dev = profileWith({ xp: 130 });
    // 로그인 시도 중 표시(앞 접속의 첫 로그인이 실패해 남음) — 이번 부팅은 로그인한 지 10분이 지난 뒤
    const storage = mem();
    storage.data.set(MARK, JSON.stringify({ v: 1, tag: '' }));
    const r = await rig({
      storage,
      device: dev,
      route: (c) =>
        c.path === '/api/account' ? json(200, statusIn('T1', null)) : json(403, { error: 'relogin' }),
    });
    await r.boot(null);
    expect(r.calls.map((c) => c.path)).toEqual(['/api/account', '/api/account/import']);
    expect(r.meta.mode).toBe('device');
    expect(r.meta.current.xp).toBe(130);
    expect(r.notes).toEqual([T.relogin]);
    expect(r.ctl.view).toBe('out');
    expect(r.storage.data.has(MARK)).toBe(false);
    expect(r.storage.data.get(PROGRESS)).toBe(serializeProfile(dev));
    const next = (await rig({ storage: r.storage, route: () => json(200, statusIn('T1', null)) })) as Rig & {
      loads: number;
    };
    expect(next.boot(null)).toBeNull();
    expect(next.calls).toEqual([]);
  });
});

describe('계정 모드가 바뀐 소켓 (새 쿠키를 싣게 첫 화면에서 다시 연다)', () => {
  it('어긋난 소켓은 방 · 판 밖(첫 화면)에서 다시 연다 — 방 · 판 중이면 첫 화면에 돌아올 때까지 미룬다', () => {
    expect(reopenForAccount(true, false)).toBe(true);
    expect(reopenForAccount(true, true)).toBe(false);
    expect(reopenForAccount(false, false)).toBe(false);
    expect(reopenForAccount(false, true)).toBe(false);
  });

  it('부팅이 아닌 때 계정 모드로 들어가면 entered (게스트로 연 탭 — 다른 탭이 로그인). 부팅 때 · 실패면 부르지 않는다', async () => {
    let route: Route = () => json(200, statusIn('T1', profileWith({ xp: 500 })));
    const r = await rig({ device: profileWith({ xp: 9 }), route: (c) => route(c) });
    expect(r.boot(null)).toBeNull();
    // 다른 탭이 로그인해 표시를 적었다. 이 탭은 게스트 소켓 그대로 — 설정을 열면 계정 모드로
    r.storage.data.set(MARK, JSON.stringify({ v: 1, tag: 'T1' }));
    route = () => json(503, { error: 'db' });
    expect(await r.ctl.ensure()).toBe('unknown');
    expect(r.entered()).toBe(0);
    route = () => json(200, statusIn('T1', profileWith({ xp: 500 })));
    expect(await r.ctl.ensure()).toBe('in');
    expect(r.meta.mode).toBe('server');
    expect(r.entered()).toBe(1);
    expect(r.left()).toBe(0);
    // 부팅 경로: 소켓은 이미 쿠키를 싣고 열렸다
    const b = await rig({ mark: 'T1', route: () => json(200, statusIn('T1', profileWith({ xp: 500 }))) });
    await b.boot(null);
    expect(b.meta.mode).toBe('server');
    expect(b.entered()).toBe(0);
    // 첫 로그인(빈 계정 → import)도 부팅 경로
    const first = await rig({
      route: (c) =>
        c.path === '/api/account' ? json(200, statusIn('T2', null)) : json(200, body(emptyProfile(clock))),
    });
    await first.boot('ok');
    expect(first.meta.mode).toBe('server');
    expect(first.entered()).toBe(0);
  });
});
