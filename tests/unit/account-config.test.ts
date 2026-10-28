// 계정 설정 (docs/ACCOUNT_PLAN.md 3절): 기본 꺼짐 · 빠진 값은 이름만 · 배포 서버에서 메모리 저장소 · 가짜 구글 거절 ·
// DB 구현 대기 · 로그 문구에 값이 없다
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  describeAccountConfig,
  readAccountConfig,
  type AccountConfig,
} from '../../server/src/account/config';
import { ACCOUNT_ENV } from '../../server/src/account/env';
import { chooseAccountStore, createAccountStore } from '../../server/src/account/storeFactory';
import { MemoryAccountStore } from '../../server/src/account/store';
import { createAccountSystem } from '../../server/src/account/system';

const DEPLOY = { testHooks: false, dev: false };
const HOOKS = { testHooks: true, dev: false };
const DEV = { testHooks: false, dev: true };
const CLIENT = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const SECRET = 'S3cr3t-value-that-must-never-be-logged-0123456789';
// 가짜 접속 주소 (자격 증명 모양 없이 — 로그에 새지 않는지만 본다)
const DB = 'postgres://decoy-db.example.invalid:5432/decoy?marker=never-log-this';

function problems(cfg: AccountConfig): string[] {
  return cfg.problems.map((p) => `${p.name}:${p.kind}`).sort();
}

describe('계정 설정', () => {
  it('기본은 꺼짐 (DECOY_LOGIN이 없거나 1이 아니면) — 다른 값이 다 있어도', () => {
    const full = { GOOGLE_CLIENT_ID: CLIENT, DECOY_SESSION_SECRET: SECRET, DATABASE_URL: DB };
    for (const login of [undefined, '', '0', 'true', 'yes', 'on'])
      expect(readAccountConfig({ ...full, DECOY_LOGIN: login }, DEPLOY)).toEqual({
        enabled: false,
        requested: false,
        problems: [],
      });
    expect(describeAccountConfig(readAccountConfig({}, DEPLOY))).toBe('계정 로그인: 꺼짐 (DECOY_LOGIN)');
    // Render 대시보드에서 사용자가 넣는 기본 값(render.yaml)만으로는 켜지지 않는다
    expect(readAccountConfig({ NODE_ENV: 'production', PORT: '10000' }, DEPLOY).enabled).toBe(false);
  });

  it('켜려 했는데 빠지거나 틀린 값: 꺼진 채, 이름 · 종류만', () => {
    expect(problems(readAccountConfig({ DECOY_LOGIN: '1' }, DEPLOY))).toEqual([
      'DATABASE_URL:missing',
      'DECOY_SESSION_SECRET:missing',
      'GOOGLE_CLIENT_ID:missing',
    ]);
    const bad = readAccountConfig(
      {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: 'my-client-id',
        DECOY_SESSION_SECRET: 'short',
        DECOY_ACCOUNT_TIMEZONE: 'Mars/Olympus',
        DECOY_ACCOUNT_IDP: 'facebook',
      },
      DEPLOY,
    );
    expect(bad.enabled).toBe(false);
    expect(problems(bad)).toEqual([
      'DATABASE_URL:missing',
      'DECOY_ACCOUNT_IDP:invalid',
      'DECOY_ACCOUNT_TIMEZONE:invalid',
      'DECOY_SESSION_SECRET:invalid',
      'GOOGLE_CLIENT_ID:invalid',
    ]);
  });

  it('DB 구현 대기: DB 접속 값이 있어도 켜지 않는다 (로그에 이름만)', () => {
    const cfg = readAccountConfig(
      { DECOY_LOGIN: '1', GOOGLE_CLIENT_ID: CLIENT, DECOY_SESSION_SECRET: SECRET, DATABASE_URL: DB },
      DEPLOY,
    );
    expect(cfg.enabled).toBe(false);
    expect(problems(cfg)).toEqual(['DATABASE_URL:pending']);
    expect(describeAccountConfig(cfg)).toBe('계정 로그인: 꺼짐 (DATABASE_URL DB 구현 대기)');
  });

  it('배포 서버(시험 훅 · 개발 아님)는 메모리 저장소 · 가짜 구글을 거절한다', () => {
    const env = { DECOY_LOGIN: '1', GOOGLE_CLIENT_ID: CLIENT, DECOY_SESSION_SECRET: SECRET };
    expect(problems(readAccountConfig({ ...env, DECOY_ACCOUNT_STORE: 'memory' }, DEPLOY))).toEqual([
      'DECOY_ACCOUNT_STORE:not-allowed',
    ]);
    expect(
      problems(readAccountConfig({ ...env, DECOY_ACCOUNT_STORE: 'memory', DECOY_ACCOUNT_IDP: 'test' }, DEV)),
    ).toEqual(['DECOY_ACCOUNT_IDP:not-allowed']);
    expect(problems(readAccountConfig({ ...env, DECOY_ACCOUNT_STORE: 'sqlite' }, HOOKS))).toEqual([
      'DECOY_ACCOUNT_STORE:invalid',
    ]);
    expect(chooseAccountStore({ DECOY_ACCOUNT_STORE: 'memory' }, DEPLOY)).toEqual({
      ok: false,
      problems: [{ name: 'DECOY_ACCOUNT_STORE', kind: 'not-allowed' }],
    });
  });

  it('시험 훅 모드: 메모리 저장소 + 가짜 구글(기본), 클라이언트 ID는 비지 않은 아무 값', () => {
    const cfg = readAccountConfig(
      {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: 'test',
        DECOY_SESSION_SECRET: SECRET,
        DECOY_ACCOUNT_STORE: 'memory',
      },
      HOOKS,
    );
    expect(cfg).toMatchObject({
      enabled: true,
      clientId: 'test',
      timeZone: DEFAULT_ACCOUNT_TIMEZONE,
      store: { kind: 'memory' },
      testIdp: true,
    });
    expect(describeAccountConfig(cfg)).toBe('계정 로그인: 켜짐 (memory, 가짜 구글)');
    // 시험 훅이어도 진짜 구글을 고르면 클라이언트 ID 모양을 본다
    const real = readAccountConfig(
      {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: 'test',
        DECOY_SESSION_SECRET: SECRET,
        DECOY_ACCOUNT_STORE: 'memory',
        DECOY_ACCOUNT_IDP: 'google',
      },
      HOOKS,
    );
    expect(problems(real)).toEqual(['GOOGLE_CLIENT_ID:invalid']);
    // 개발 서버: 메모리 저장소 + 진짜 구글
    const dev = readAccountConfig(
      {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: CLIENT,
        DECOY_SESSION_SECRET: SECRET,
        DECOY_ACCOUNT_STORE: 'memory',
        DECOY_ACCOUNT_TIMEZONE: 'UTC',
      },
      DEV,
    );
    expect(dev).toMatchObject({ enabled: true, testIdp: false, timeZone: 'UTC' });
    expect(createAccountStore({ kind: 'memory' }, {})).toBeInstanceOf(MemoryAccountStore);
  });

  it('로그 문구 · 설정 문제에 값(클라이언트 ID · 비밀 · DB 주소)이 들어가지 않는다', () => {
    const logs: string[] = [];
    const envs = [
      { DECOY_LOGIN: '1', GOOGLE_CLIENT_ID: CLIENT, DECOY_SESSION_SECRET: SECRET, DATABASE_URL: DB },
      {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: 'leaky-client',
        DECOY_SESSION_SECRET: 'short-fake',
        DATABASE_URL: DB,
      },
      {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: CLIENT,
        DECOY_SESSION_SECRET: SECRET,
        DECOY_ACCOUNT_STORE: 'memory',
      },
    ];
    for (const env of envs)
      for (const mode of [DEPLOY, HOOKS, DEV]) {
        const cfg = readAccountConfig(env, mode);
        const sys = createAccountSystem({ env, ...mode, log: (m) => logs.push(m) });
        logs.push(describeAccountConfig(cfg), JSON.stringify(cfg.problems), sys.summary);
      }
    const all = logs.join('\n');
    for (const secretish of [
      CLIENT,
      SECRET,
      DB,
      'short-fake',
      'leaky-client',
      'decoy-db.example.invalid',
      'never-log-this',
    ])
      expect(all).not.toContain(secretish);
    // 이름은 보인다
    expect(all).toContain(ACCOUNT_ENV.dbUrl);
  });
});
