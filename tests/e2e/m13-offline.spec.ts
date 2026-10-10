// M13d 앱 셸 캐시 · 오프라인 진입 (MOBILE_PLAN M13d 검증). 전용 서버를 고정 포트로 띄워(같은 출처) 서버를 끄거나 바꾼다
//  - 네트워크를 끊고 서버 프로세스도 끈 채 새로고침 → 캐시한 앱 셸 → 오프라인 안내 + 탭 두 번에 봇과 연습 → 결과 → 다시 하기
//    (휴대폰 · PC 각각). `setOffline`만으로는 서비스 워커 요청이 살아 있는 서버에 닿아 가짜로 통과하므로 서버를 끈다
//  - 서버만 꺼짐(온라인): 새로 열기 → 상태 줄 안내 + 봇과 연습
//  - Render 정지 흉내: 표시 헤더 없이 503을 주는 가짜 서버 → 깨우기 화면의 "기다리는 동안 봇과 연습"으로 판 시작
//  - 서비스 워커 업데이트: 빌드 ID만 다른 두 빌드를 차례로 서빙하면 새 워커로 바뀌고 옛 셸 캐시가 지워지고,
//    화면은 "새 버전이 있어요"를 띄운다
// 서버를 일부러 끄는 시험이라 브라우저가 스스로 찍는 연결 실패 로그만 허용한다(MOBILE_PLAN 3절 콘솔 규칙의 예외)
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { freePort, startServer, type RunningServer } from '../helpers/serverProcess';
import { PHONE_LANDSCAPE, dpr1, newPlayerPage, press, watchConsole, type DeviceOptions } from './helpers';

/** 서버를 끈 시험에서만 허용하는 브라우저 자체 로그 (앱 코드가 낸 것은 아니다) */
const ALLOWED = [/WebSocket connection to .* failed/, /Failed to load resource/];

function unexpected(problems: string[]): string[] {
  return problems.filter((p) => !ALLOWED.some((re) => re.test(p)));
}

async function cacheKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await caches.keys()).sort());
}

/** 서비스 워커가 이 화면을 맡고 앱 셸 캐시가 다 찼다 (index.html까지 들어 있음) */
async function shellReady(page: Page): Promise<string[]> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const shell = (await caches.keys()).find((k) => k.startsWith('decoy-shell-'));
          if (!shell) return false;
          return (
            (await (await caches.open(shell)).match(new URL('index.html', location.href).href)) !== undefined
          );
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
  return cacheKeys(page);
}

async function phase(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__DECOY__?.phase ?? null);
}

/** 연습 판을 끝까지: 봇이 움직이고 → 기기 안 테스트 훅으로 끝 → 결과 → 다시 하기 → 두 번째 판 */
async function playPracticeToRematch(page: Page): Promise<void> {
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('playing');
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
  const t1 = await page.evaluate(() => window.__DECOY__?.getTruth() ?? null);
  await page.waitForTimeout(6500);
  const t2 = await page.evaluate(() => window.__DECOY__?.getTruth() ?? null);
  const me = await page.evaluate(() => window.__DECOY__?.you ?? '');
  const moved = (t2?.players ?? []).filter((p) => {
    const q = t1?.players.find((x) => x.id === p.id);
    return p.id !== me && q !== undefined && Math.hypot(p.x - q.x, p.y - q.y) > 1;
  });
  expect(moved.length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.__DECOY__?.sendTest({ kind: 'setTime', timeLeft: 0.1 }));
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await press(page.getByTestId('rematch'));
  await expect(page.getByTestId('result')).toBeHidden();
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe('playing');
}

const DEVICES: { name: string; device: DeviceOptions | undefined }[] = [
  { name: '휴대폰', device: dpr1(PHONE_LANDSCAPE) },
  { name: 'PC', device: undefined },
];

for (const d of DEVICES) {
  test(`네트워크를 끊고 서버도 끈 채 새로고침해도 앱 셸이 뜨고, 탭 두 번에 봇과 연습을 끝까지 (${d.name})`, async ({
    browser,
  }) => {
    const port = await freePort();
    const server = await startServer(['--test-hooks'], { port });
    const base = `http://127.0.0.1:${port}`;
    const { context, page, problems } = await newPlayerPage(browser, d.device);
    try {
      await page.goto(`${base}/?debug=hook&renderer=canvas`);
      await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
      const keys = await shellReady(page);
      expect(keys.filter((k) => k.startsWith('decoy-shell-'))).toHaveLength(1);
      await context.setOffline(true);
      await server.stop();
      let sockets = 0;
      page.on('websocket', () => {
        sockets += 1;
      });
      await page.reload();
      const status = page.getByTestId('server-status');
      await expect(status).toHaveAttribute('data-state', 'offline');
      await expect(status).toContainText('인터넷 연결이 없어요 — 봇과 연습만 할 수 있어요');
      await expect(page.getByTestId('create-room')).toBeDisabled();
      // 탭 두 번: 봇과 연습 → 역할
      await press(page.getByTestId('practice'));
      await press(page.getByTestId('practice-role-scout'));
      await playPracticeToRematch(page);
      expect(sockets).toBe(0);
      expect(problems).toEqual([]);
    } finally {
      await context.close();
      await server.stop();
    }
  });
}

test('서버만 꺼짐(온라인): 새로 열면 앱 셸 첫 화면이 상태 줄 안내 · 봇과 연습을 보이고 판이 시작된다', async ({
  browser,
}) => {
  const port = await freePort();
  const server = await startServer(['--test-hooks'], { port });
  const base = `http://127.0.0.1:${port}`;
  const { context, page, problems } = await newPlayerPage(browser);
  try {
    await page.goto(`${base}/?debug=hook&renderer=canvas`);
    await shellReady(page);
    await server.stop();
    const second = await context.newPage();
    const secondProblems: string[] = [];
    watchConsole(second, secondProblems);
    await second.goto(`${base}/?debug=hook&renderer=canvas`);
    const status = second.getByTestId('server-status');
    await expect(status).toBeVisible({ timeout: 5000 });
    await expect(status).toHaveAttribute('data-state', 'waking');
    await expect(status).toContainText('봇과 연습을 할 수 있어요');
    await second.getByTestId('practice').click();
    await second.getByTestId('practice-role-monster').click();
    await expect.poll(() => phase(second), { timeout: 15_000 }).toBe('playing');
    // 연결 실패 로그(브라우저 자체)만 있고, 재연결 간격(1 · 2 · 4초, 연습 중 멈춤) 이하
    expect(unexpected(secondProblems)).toEqual([]);
    expect(secondProblems.length).toBeLessThanOrEqual(6);
    expect(unexpected(problems)).toEqual([]);
  } finally {
    await context.close();
    await server.stop();
  }
});

test('Render 정지 흉내(표시 없이 503): 깨우기 화면의 "기다리는 동안 봇과 연습"으로 판이 시작된다', async ({
  browser,
}) => {
  const port = await freePort();
  const server = await startServer(['--test-hooks'], { port });
  const base = `http://127.0.0.1:${port}`;
  const { context, page, problems } = await newPlayerPage(browser);
  let fake: Server | null = null;
  try {
    await page.goto(`${base}/?debug=hook&renderer=canvas`);
    await shellReady(page);
    await server.stop();
    // 같은 포트에 표시 헤더 없이 503만 주는 서버 (잠든 Render 앞단 흉내)
    fake = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/html' }).end('<h1>Service is waking up</h1>');
    });
    await new Promise<void>((r) => fake?.listen(port, '127.0.0.1', r));
    await page.goto(`${base}/?debug=hook&renderer=canvas&room=ABCD`);
    const wake = page.getByTestId('wake-page');
    await expect(wake).toBeVisible({ timeout: 10_000 });
    const practice = page.getByTestId('wake-practice');
    await expect(practice).toBeVisible();
    await practice.click();
    // ?practice=1은 서비스 워커가 캐시에서 준다 → 역할 고르기가 바로 열린다
    await expect(page.getByTestId('practice-picker')).toBeVisible({ timeout: 5000 });
    // 원래 주소의 설정은 남고 방 코드는 빠진다
    expect(page.url()).toContain('practice=1');
    expect(page.url()).toContain('debug=hook');
    expect(page.url()).not.toContain('room=');
    await page.getByTestId('practice-role-runner').click();
    await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('playing');
    expect(unexpected(problems)).toEqual([]);
  } finally {
    await context.close();
    await new Promise<void>((r) => (fake ? fake.close(() => r()) : r()));
    await server.stop();
  }
});

test('서비스 워커 업데이트: 빌드 ID만 다른 새 빌드를 서빙하면 새 워커로 바뀌고 옛 셸 캐시가 지워지며 "새 버전이 있어요"', async ({
  browser,
}) => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // 빌드 B: 지금 빌드를 복사해 빌드 ID만 바꾼다 (index.html에 표시를 남겨 셸이 B로 바뀐 것을 본다)
  const distB = mkdtempSync(join(tmpdir(), 'decoy-dist-b-'));
  cpSync('client/dist', distB, { recursive: true });
  const idA = (JSON.parse(readFileSync('client/dist/build-id.json', 'utf8')) as { id: string }).id;
  const idB = `${idA.slice(0, -4)}beef`;
  writeFileSync(join(distB, 'build-id.json'), JSON.stringify({ id: idB }));
  writeFileSync(
    join(distB, 'sw.js'),
    readFileSync(join(distB, 'sw.js'), 'utf8').replace(`"${idA}"`, `"${idB}"`),
  );
  writeFileSync(
    join(distB, 'index.html'),
    readFileSync(join(distB, 'index.html'), 'utf8').replace('</head>', `<!-- build ${idB} --></head>`),
  );
  let server: RunningServer = await startServer(['--test-hooks'], { port });
  let context: BrowserContext | null = null;
  try {
    const p = await newPlayerPage(browser);
    context = p.context;
    const page = p.page;
    await page.goto(`${base}/?debug=hook&renderer=canvas`);
    expect(await shellReady(page)).toContain(`decoy-shell-${idA}`);
    await server.stop();
    server = await startServer(['--test-hooks', `--static=${distB}`], { port });
    await page.reload();
    // 페이지 이동이 업데이트 확인을 부른다. 시험에서는 바로 확인시킨다 → 새 워커가 B 셸을 받고 켜지면 A 셸을 지운다
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    await expect
      .poll(() => cacheKeys(page), { timeout: 20_000 })
      .toEqual(['decoy-shell-' + idB, 'decoy-wake-v2'].sort());
    console.log(
      '[m13-offline] 업데이트 뒤 캐시',
      await page.evaluate(async () => {
        const out: Record<string, number> = {};
        for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).length;
        return out;
      }),
    );
    const cached = await page.evaluate(async (b) => {
      const cache = await caches.open(`decoy-shell-${b}`);
      const reqs = await cache.keys();
      const builds = await Promise.all(
        reqs.map(async (r) => (await cache.match(r))?.headers.get('x-decoy-build') ?? null),
      );
      const index = await (await cache.match(new URL('index.html', location.href).href))?.text();
      return { builds, index: index ?? '' };
    }, idB);
    expect(new Set(cached.builds)).toEqual(new Set([idB]));
    expect(cached.index).toContain(`build ${idB}`);
    // 이 화면(빌드 A)은 서버(빌드 B)와 다르다 → 새 버전 안내
    await expect(page.getByTestId('update-available')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('update-available')).toContainText('새 버전이 있어요');
    expect(unexpected(p.problems)).toEqual([]);
  } finally {
    await context?.close();
    await server.stop();
    rmSync(distB, { recursive: true, force: true });
  }
});
