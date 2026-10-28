// 계정 저장소 PostgreSQL 구현을 실제 PostgreSQL에서 (DECOY_TEST_DATABASE_URL이 있을 때만 — CI 빠른 검사는 러너에 깔린
// PostgreSQL을 켜고 실행 때마다 만든 무작위 비밀번호로 이 값을 준다. CI에서 값이 없으면 실패한다). 시험은 표를 지우므로 이 컴퓨터의
// PostgreSQL(localhost · 127.0.0.1)만 받는다 — 실수로 배포 DB 주소를 넣어도 계정 기록을 지우지 않게. Neon 자체(잠들기 · 한도)는
// 여기서 볼 수 없어 HUMAN_CHECKS로 — 대신 서버가 연결을 끊는 경우(잠든 compute가 연결을 닫는 것과 같은 모양)를 흉내 낸다.
// - 저장소 약속: 만들기(같은 sub 동시 다섯 번 → 계정 하나) · 읽기 · 기록 쓰기 · 지우기 · 긴 글 · bigint 시각
// - 서버가 연결을 끊은 뒤 다음 요청이 저절로 다시 붙는다
// - 서비스: 로그인 → 기기 기록 올리기 → 서버 적립 → 삭제 (메모리 저장소와 같은 결과)
// - 계정 기능 전체(HTTP): DATABASE_URL로 켜진 서버에서 가짜 구글 로그인 → 상태 → 올리기 → 삭제
import { connect as netConnect, createServer, type AddressInfo, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountStatus, MatchRating } from '@decoy/shared';
import { emptyProfile, parseProfile, serializeProfile } from '@decoy/shared/meta';
import {
  PG_TABLE,
  PgAccountStore,
  createPostgresClient,
  parseDatabaseUrl,
  type PgConfig,
  type PgResult,
} from '../../server/src/account/pgStore';
import { AccountService } from '../../server/src/account/service';
import { AccountConflict } from '../../server/src/account/store';
import {
  CookieJar,
  TEST_CLIENT_ID,
  TEST_SECRET,
  apiPost,
  loginFlow,
  startAccountServer,
} from '../helpers/accountServer';

const RAW_URL = process.env.DECOY_TEST_DATABASE_URL ?? '';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
/** 이 컴퓨터의 PostgreSQL 주소일 때만 시험한다 (아니면 빈 값 — 아래 '준비' 시험이 실패시킨다) */
const URL_TEXT = LOCAL_HOSTS.includes(parseDatabaseUrl(RAW_URL)?.host ?? '') ? RAW_URL : '';

/** 시험이 직접 쓰는 관리 연결 (질의마다 10초) */
interface Admin {
  query(text: string, params?: readonly (string | number | null)[]): Promise<PgResult>;
  end(): Promise<void>;
}

function adminOf(conf: PgConfig): Admin {
  const c = createPostgresClient(conf);
  return { query: (text, params = []) => c.query(text, params, 10_000), end: () => c.end() };
}

describe('실제 PostgreSQL 시험 준비', () => {
  it.runIf(process.env.CI === 'true')(
    'CI에서는 DECOY_TEST_DATABASE_URL이 있어 실제 DB 시험을 건너뛰지 않는다',
    () => {
      expect(URL_TEXT).not.toBe('');
    },
  );
  it.runIf(RAW_URL !== '')(
    '시험 DB는 이 컴퓨터의 PostgreSQL만 (표를 지우므로 배포 DB 주소는 받지 않는다)',
    () => {
      expect(LOCAL_HOSTS).toContain(parseDatabaseUrl(RAW_URL)?.host);
    },
  );
  it.runIf(URL_TEXT !== '')('시험 DB 주소가 맞는 모양이다', () => {
    expect(parseDatabaseUrl(URL_TEXT)).not.toBeNull();
  });
});

function rating(matchId: string): MatchRating {
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
  };
}

describe.runIf(URL_TEXT !== '')('PgAccountStore (실제 PostgreSQL)', () => {
  const conf = parseDatabaseUrl(URL_TEXT)!;
  const table = `t_${process.pid}_${Date.now()}`;
  let admin: Admin;
  let store: PgAccountStore;
  const logs: string[] = [];

  beforeAll(async () => {
    admin = adminOf(conf);
    store = new PgAccountStore(createPostgresClient(conf), { table, log: (m) => logs.push(m) });
    await store.init();
  });

  afterAll(async () => {
    await store?.close();
    await admin?.query(`DROP TABLE IF EXISTS ${table}`, []);
    await admin?.end();
  });

  it('표 만들기는 여러 번 해도 된다 (서버를 다시 띄울 때마다)', async () => {
    await store.init();
    await store.init();
    const cols = await admin.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    expect(cols.rows).toEqual([
      { column_name: 'id', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'sub', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'profile', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'created', data_type: 'bigint', is_nullable: 'NO' },
      { column_name: 'updated', data_type: 'bigint', is_nullable: 'NO' },
      { column_name: 'rev', data_type: 'bigint', is_nullable: 'NO' },
    ]);
  });

  it('만들기 · 읽기 · 기록 쓰기 · 지우기 (없는 계정은 만들지 않는다)', async () => {
    const now = Date.UTC(2026, 9, 28, 3, 0, 0);
    const rec = await store.create('live-sub-1', now);
    expect(rec).toMatchObject({ sub: 'live-sub-1', profile: null, created: now, updated: now, rev: 0 });
    expect(rec.id).toMatch(/^[0-9a-f]{32}$/);
    expect(await store.findBySub('live-sub-1')).toEqual(rec);
    expect(await store.get(rec.id)).toEqual(rec);
    expect(await store.findBySub('nobody')).toBeNull();
    expect(await store.get('0'.repeat(32))).toBeNull();

    // 긴 글 · 한글 · 따옴표 (기기 기록 상한 32KB)
    const text = `{"v":1,"x":"${'가\'"\\'.repeat(8000)}"}`;
    expect(await store.saveProfile(rec.id, text, now + 5)).toBe(true);
    expect(await store.get(rec.id)).toMatchObject({ profile: text, updated: now + 5, created: now, rev: 1 });
    expect(await store.saveProfile('0'.repeat(32), text, now)).toBe(false);

    expect(await store.delete(rec.id)).toBe(true);
    expect(await store.get(rec.id)).toBeNull();
    expect(await store.delete(rec.id)).toBe(false);
    // 지운 뒤 기록 쓰기는 계정을 되살리지 않는다
    expect(await store.saveProfile(rec.id, text, now)).toBe(false);
    expect(await store.findBySub('live-sub-1')).toBeNull();
  });

  it('조건부 쓰기(rev): 읽은 rev일 때만 쓰고 rev+1 · 옛 rev의 다른 글은 충돌(새 기록 그대로) · 같은 글은 이미 쓴 것', async () => {
    const rec = await store.create('live-rev', 1);
    expect(rec.rev).toBe(0);
    expect(await store.saveProfile(rec.id, 'A', 2, 0)).toBe(true);
    expect(await store.get(rec.id)).toMatchObject({ profile: 'A', rev: 1, updated: 2 });
    expect(await store.saveProfile(rec.id, 'A', 3, 0)).toBe(true);
    await expect(store.saveProfile(rec.id, 'OLD', 3, 0)).rejects.toBeInstanceOf(AccountConflict);
    expect(await store.get(rec.id)).toMatchObject({ profile: 'A', rev: 1 });
    expect(await store.saveProfile('0'.repeat(32), 'A', 3, 0)).toBe(false);
  });

  it('같은 sub로 동시에 다섯 번 만들어도 계정은 하나', async () => {
    const made = await Promise.all(Array.from({ length: 5 }, (_, i) => store.create('live-same', 1000 + i)));
    expect(new Set(made.map((r) => r.id)).size).toBe(1);
    const n = await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE sub = $1`, ['live-same']);
    expect(n.rows[0]).toEqual({ n: 1 });
  });

  it('서버가 연결을 끊어도(잠든 compute가 연결을 닫는 것과 같은 모양) 다음 요청은 다시 붙어 된다', async () => {
    const rec = await store.create('live-reconnect', 1);
    // 저장소의 연결을 서버 쪽에서 끊는다 (같은 사용자의 연결은 끊을 수 있다)
    const killed = await admin.query(
      `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
       WHERE application_name = 'decoy' AND pid <> pg_backend_pid() AND datname = current_database()
         AND query NOT ILIKE '%pg_terminate_backend%'`,
      [],
    );
    expect(killed.rows.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 100));
    expect((await store.get(rec.id))?.sub).toBe('live-reconnect');
    expect(await store.saveProfile(rec.id, 'P', 2)).toBe(true);
    expect(logs.join('\n')).not.toContain(conf.password || '\u0000');
  });

  it('잠든 DB가 5초 뒤 깨는 동안 동시에 넷이 와도 모두 된다 — 한 요청의 시간 넘김이 묶음을 버려도 함께 끊긴 요청은 새 묶음으로 다시 한다', async () => {
    const rec = await store.create('live-wake', 1);
    const wakeAt = Date.now() + 5_000;
    const socks = new Set<Socket>();
    // TCP 중계: 깨기 전에 온 연결은 깰 때까지 붙잡았다가(잠든 compute) 실제 PostgreSQL로 잇는다
    const proxy = createServer((client) => {
      socks.add(client);
      client.on('error', () => undefined);
      client.pause();
      const link = (): void => {
        if (client.destroyed) return;
        const up = netConnect({ host: conf.host, port: conf.port });
        socks.add(up);
        up.on('error', () => client.destroy());
        client.on('close', () => up.destroy());
        up.on('close', () => client.destroy());
        client.pipe(up).pipe(client);
        client.resume();
      };
      setTimeout(link, Math.max(0, wakeAt - Date.now()));
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const port = (proxy.address() as AddressInfo).port;
    const sleepy = new PgAccountStore(createPostgresClient({ ...conf, host: '127.0.0.1', port }), { table });
    try {
      const t0 = Date.now();
      const got = await Promise.all(Array.from({ length: 4 }, () => sleepy.get(rec.id)));
      expect(got.map((r) => r?.sub)).toEqual(['live-wake', 'live-wake', 'live-wake', 'live-wake']);
      // 깬 뒤 곧바로 (예산 9초 안)
      expect(Date.now() - t0).toBeLessThan(9_000);
    } finally {
      await sleepy.close();
      for (const sock of socks) sock.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }, 30_000);

  it('서비스: 로그인 → 기기 기록 올리기 → 서버 적립(같은 판은 한 번) → 삭제', async () => {
    const t = Date.UTC(2026, 9, 28, 3, 0, 0);
    const svc = new AccountService({ store, timeZone: 'Asia/Seoul', now: () => t });
    expect(await svc.init()).toBe(true);
    const id = await svc.login('live-svc');
    expect(await svc.login('live-svc')).toBe(id);
    expect((await svc.status(id))?.fresh).toBe(true);
    const device = serializeProfile({ ...emptyProfile(t), coins: 7 }, {});
    const up = await svc.importDevice(id, { choice: 'device', device });
    expect(up && parseProfile(up.profile, t)).toMatchObject({ status: 'ok', profile: { coins: 7 } });
    const first = await svc.credit(id, rating('live-m1'));
    expect(first.ok).toBe(true);
    const again = await svc.credit(id, rating('live-m1'));
    expect(again).toEqual(first);
    const after = parseProfile((await svc.status(id))!.profile, t);
    expect(after.status === 'ok' && after.profile.xp).toBeGreaterThan(0);
    expect(await svc.delete(id)).toBe(true);
    expect(await svc.status(id)).toBeNull();
    // 지운 계정에는 적립하지 않고 다시 만들지 않는다
    expect((await svc.credit(id, rating('live-m2'))).ok).toBe(false);
    expect(await store.findBySub('live-svc')).toBeNull();
  });
});

describe.runIf(URL_TEXT !== '')('계정 기능 전체 (DATABASE_URL로 켠 서버, 실제 PostgreSQL)', () => {
  it('가짜 구글 로그인 → 상태(첫 로그인) → 기기 기록 올리기 → 다시 읽기 → 계정 삭제', async () => {
    const admin = adminOf(parseDatabaseUrl(URL_TEXT)!);
    // 기본 표 이름을 쓰므로 비우고 시작한다 (시험 DB 전용)
    await admin.query(`DROP TABLE IF EXISTS ${PG_TABLE}`, []);
    const srv = await startAccountServer({
      env: {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
        DECOY_SESSION_SECRET: TEST_SECRET,
        DATABASE_URL: URL_TEXT,
      },
    });
    try {
      expect(srv.system.summary).toBe('계정 로그인: 켜짐 (postgres, 가짜 구글)');
      expect(srv.system.service?.isReady).toBe(true);
      const jar = new CookieJar();
      const cb = await loginFlow(srv, jar, { sub: 'live-http' });
      expect(cb.headers.get('location')).toContain('login=ok');
      const st = (await (
        await fetch(`${srv.base}/api/account`, { headers: { cookie: jar.header() } })
      ).json()) as AccountStatus;
      expect(st).toMatchObject({ on: true, signedIn: true, fresh: true });
      const now = Date.now();
      const device = serializeProfile({ ...emptyProfile(now), coins: 11 }, {});
      const imp = await apiPost(srv, jar, '/api/account/import', { choice: 'device', device });
      expect(imp.status).toBe(200);
      const st2 = (await (
        await fetch(`${srv.base}/api/account`, { headers: { cookie: jar.header() } })
      ).json()) as AccountStatus;
      expect(st2.on && st2.signedIn && !st2.fresh && parseProfile(st2.profile, now)).toMatchObject({
        status: 'ok',
        profile: { coins: 11 },
      });
      const rows = await admin.query(`SELECT sub, profile FROM ${PG_TABLE}`, []);
      // DB에는 구글 고유 ID(sub)와 기록 글만 (그 밖의 열은 계정 ID · 시각 · rev)
      expect(rows.rows).toHaveLength(1);
      expect(Object.keys(rows.rows[0]!).sort()).toEqual(['profile', 'sub']);
      const del = await apiPost(srv, jar, '/api/account/delete', {});
      expect(del.status).toBe(200);
      expect((await admin.query(`SELECT count(*)::int AS n FROM ${PG_TABLE}`, [])).rows[0]).toEqual({ n: 0 });
    } finally {
      await srv.close();
      await srv.system.close();
      await admin.query(`DROP TABLE IF EXISTS ${PG_TABLE}`, []);
      await admin.end();
    }
  });
});
