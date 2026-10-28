// 선택형 구글 로그인 · 계정 저장 — 클라이언트 (docs/ACCOUNT_PLAN.md 5 · 7절). fetch를 가짜로 바꿔 본다(서버 없음):
//  계정 API 요청 모양 · 5초 제한 · 실패 갈래 / 이 기기 표시 decoy:account / 부팅: 게스트는 요청 없음 · 표시 있음 → 계정 모드 ·
//  3초 칩 기다림 / 401 · 로그인 안 함 · 꺼짐 → 게스트 · 표시 지움, 503 · 시간 초과 → 이번 접속 게스트 + 안내 / ?login= 안내 /
//  첫 로그인 세 갈래(빈 기기 · 빈 계정 · 둘 다 → 고르기) / 계정 모드 받기 · 해금 · 입기는 API로, 실패하면 기록 그대로 /
//  온라인 판 credit 기다림 → 저장함 · 못 함 · 모름(20초 뒤 다시 읽기) / 연습 판은 계정 · 기기 모두 적립 안 함 / 계정 날짜 · 자정 /
//  로그아웃 · 삭제 · 세션 끝 → 기기 모드
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
import { CREDIT_WAIT_MS, ServerProfileStore } from '../../client/src/account/serverStore';
import { ACCOUNT_TEXT } from '../../client/src/data/storyText';
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
  boot(login: string | null): Promise<void> | null;
}

/** 클라이언트 한 벌: 기기 저장소(가짜) · 가짜 서버 · 기록 상태 · 계정 흐름 */
async function rig(o: {
  mark?: string | null;
  device?: Profile | string | null;
  route: Route;
  choose?: 'account' | 'device';
}): Promise<Rig> {
  const storage = mem();
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
  const ctl = new AccountController({
    api,
    meta,
    mark,
    device,
    deviceText: () => storage.getItem(PROGRESS),
    screens,
    left: () => (left += 1),
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
  it('401 · 로그인 안 함 · 꺼짐: 표시를 지우고 게스트(기기 기록), 표시가 있었으면 한 줄', async () => {
    for (const [res, view, note] of [
      [json(401, { error: 'auth' }), 'out', T.expired],
      [json(200, { on: true, signedIn: false }), 'out', T.expired],
      [json(200, { on: false }), 'off', T.results.off],
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

  it('빈 기기 + 빈 계정: 묻지 않고 빈 기록으로 계정을 연다 (import device:null), 올리기 안내 없음', async () => {
    const r = await rig({ route: importRoute(statusIn('T1', null), emptyProfile(clock)) });
    await r.boot('ok');
    const imp = r.calls.find((c) => c.path === '/api/account/import');
    expect(imp?.body).toEqual({ choice: 'device', device: null });
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
      expect(imp?.body).toEqual({ choice, device: serializeProfile(dev) });
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

  it('올리기가 실패하면(503) 게스트 그대로 · 표시를 적지 않고(다음에 다시) · 기기 기록 그대로 + 안내', async () => {
    const dev = profileWith({ xp: 130 });
    const r = await rig({
      device: dev,
      route: (c) =>
        c.path === '/api/account' ? json(200, statusIn('T1', null)) : json(503, { error: 'db' }),
    });
    await r.boot('ok');
    expect(r.meta.mode).toBe('device');
    expect(r.meta.current.xp).toBe(130);
    expect(r.storage.data.has(MARK)).toBe(false);
    expect(r.notes).toEqual([T.offline]);
    expect(r.ctl.view).toBe('unknown');
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
  const meta = new MetaState(new DeviceProfileStore(storage), now);
  await meta.ready;
  let lost = 0;
  const store = new ServerProfileStore(
    api,
    serializeProfile(account),
    timeZone,
    'T1',
    () => (lost += 1),
    now,
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
    const applied = await meta.applyRating(rating('M.1'));
    const expected = applyRating(acc, rating('M.1'), clock, PROGRESSION, dayKeyInZone(clock, TZ));
    expect(applied.gain).toEqual(expected?.gain);
    expect(applied.gain?.xp.total).toBe(XP);
    expect(applied.account?.state).toBe('pending');
    // 아직 적립하지 않았다 (서버가 한다)
    expect(meta.current.xp).toBe(40);
    const seen: string[] = [];
    applied.account?.subscribe((s) => seen.push(s));
    meta.credit('M.1', true, serializeProfile(expected?.profile ?? acc));
    expect(applied.account?.state).toBe('saved');
    expect(seen).toEqual(['saved']);
    await vi.waitFor(() => expect(meta.current.xp).toBe(40 + XP));
    expect(storage.writes).toEqual([]);
  });

  it('credit ok:false면 저장하지 못했어요 — 기록은 그대로. 같은 계정 다른 탭 판의 credit은 기록만 바꾼다', async () => {
    const { meta } = await accountMeta(profileWith({ xp: 40 }), () => json(503, {}));
    const applied = await meta.applyRating(rating('M.2'));
    meta.credit('M.2', false, null);
    expect(applied.account?.state).toBe('failed');
    expect(meta.current.xp).toBe(40);
    // 다른 탭 판 (기다리는 판이 아님)
    meta.credit('M.other', true, serializeProfile(profileWith({ xp: 777 })));
    await vi.waitFor(() => expect(meta.current.xp).toBe(777));
    expect(applied.account?.state).toBe('failed');
  });

  it('20초 안에 credit이 없으면 상태를 다시 읽어: 판 ID가 기록에 있으면 저장했어요, 없으면 모름(늦은 credit이 오면 저장했어요)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let serverProfile = profileWith({ xp: 40 });
    const { meta, calls } = await accountMeta(serverProfile, () => json(200, statusIn('T1', serverProfile)));
    const a = await meta.applyRating(rating('M.3'));
    const b = await meta.applyRating(rating('M.4'));
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
    meta.credit('M.4', true, serializeProfile(serverProfile));
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
    meta.credit('L.2', true, serializeProfile(profileWith({ xp: 99999 })));
    expect(meta.current.xp).toBe(XP);
    expect(parseProfile(storage.data.get(PROGRESS) ?? null, clock).profile.xp).toBe(XP);
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
