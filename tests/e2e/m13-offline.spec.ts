// M13d 앱 셸 캐시 · 오프라인 진입 (MOBILE_PLAN M13d 검증). 전용 서버를 고정 포트로 띄워(같은 출처) 서버를 끄거나 바꾼다
//  - 네트워크를 끊고 서버 프로세스도 끈 채 새로고침 → 캐시한 앱 셸 → 오프라인 안내 + 탭 두 번에 봇과 연습 → 결과 → 다시 하기
//    (휴대폰 · PC 각각). `setOffline`만으로는 서비스 워커 요청이 살아 있는 서버에 닿아 가짜로 통과하므로 서버를 끈다
//  - 서버만 꺼짐(온라인): 새로 열기 → 상태 줄 안내 + 봇과 연습
//  - Render 정지 흉내: 표시 헤더 없이 503을 주는 가짜 서버 → 깨우기 화면의 "기다리는 동안 봇과 연습"으로 판 시작
//  - (검토 반영) 오프라인 + 서버 꺼짐에서 방 주소(?room=)로 열면 깨우기 패널의 "첫 화면으로" → 봇과 연습
//  - (수정 검토) 뒤로 가기 항목이 남은 채 다시 열려도 "첫 화면으로" 뒤 주소에 room이 돌아오지 않는다
//  - 서비스 워커 업데이트: 빌드 ID가 다른 두 빌드를 차례로 서빙하면 새 워커로 바뀌고 바로 앞 빌드 셸만 남으며(옛 화면이
//    새 서버에 없는 옛 조각을 그 셸에서 연다), 화면은 "새 버전이 있어요"를 띄운다
//  - 앱 셸: 나눠 받는 조각도 모두 셸 캐시에 있고, 서버를 끄고 오프라인으로 다시 열어도 설정 · 배치 편집 · 봇과 연습이 열린다
// 서버를 일부러 끄는 시험이라 브라우저가 스스로 찍는 연결 실패 로그만 허용한다(MOBILE_PLAN 3절 콘솔 규칙의 예외)
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('앱 셸: 나눠 받는 조각도 모두 셸 캐시에 있고(미리 압축한 사본은 없다), 서버를 끄고 오프라인으로 다시 열어도 설정 · 배치 편집 · 봇과 연습이 캐시 조각으로 열린다 (휴대폰)', async ({
  browser,
}) => {
  const port = await freePort();
  const server = await startServer(['--test-hooks'], { port });
  const base = `http://127.0.0.1:${port}`;
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  try {
    await page.goto(`${base}/?debug=hook&renderer=canvas`);
    await shellReady(page);
    const cached = await page.evaluate(async () => {
      const key = (await caches.keys()).find((k) => k.startsWith('decoy-shell-'));
      if (!key) return [];
      return (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname);
    });
    const lazy = readdirSync('client/dist/assets').filter(
      (f) => f.endsWith('.js') && !f.startsWith('index-'),
    );
    expect(lazy.length).toBeGreaterThanOrEqual(8);
    for (const f of lazy) expect(cached).toContain(`/assets/${f}`);
    expect(cached.filter((p) => /\.(br|gz)$/.test(p))).toEqual([]);
    await context.setOffline(true);
    await server.stop();
    await page.reload();
    await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'offline');
    // 설정 → 조작 탭 → 배치 편집: 조각을 셸 캐시에서
    await press(page.getByTestId('settings-button').first());
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await press(page.getByTestId('settings-tab-controls'));
    await press(page.getByTestId('layout-edit'));
    await expect(page.getByTestId('layout-editor')).toBeVisible();
    await press(page.getByTestId('le-cancel'));
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await press(page.getByTestId('settings-close'));
    await expect(page.getByTestId('settings-panel')).toBeHidden();
    // 봇과 연습: 연습 조각도 셸 캐시에서
    await press(page.getByTestId('practice'));
    await press(page.getByTestId('practice-role-guard'));
    await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('playing');
    await expect(page.getByTestId('update-available')).toHaveCount(0);
    expect(unexpected(problems)).toEqual([]);
  } finally {
    await context.close();
    await server.stop();
  }
});

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
    // 원래 주소의 설정은 남고 방 코드는 빠진다. practice는 읽은 뒤 앱이 주소에서 지운다(새로고침 · '홈으로' 뒤 다시 열리지 않게)
    expect(page.url()).not.toContain('practice=');
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

test('오프라인 + 서버 꺼짐에서 방 주소(?room=)로 열면 깨우기 패널의 "첫 화면으로"로 코드를 남긴 채 첫 화면 → 봇과 연습 (휴대폰)', async ({
  browser,
}) => {
  const port = await freePort();
  const server = await startServer(['--test-hooks'], { port });
  const base = `http://127.0.0.1:${port}`;
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  try {
    await page.goto(`${base}/?debug=hook&renderer=canvas`);
    await shellReady(page);
    await context.setOffline(true);
    await server.stop();
    let sockets = 0;
    page.on('websocket', () => {
      sockets += 1;
    });
    // 방 초대 링크 · welcome이 넣은 주소로 다시 엶 (캐시한 앱 셸)
    await page.goto(`${base}/?debug=hook&renderer=canvas&room=ABCD`);
    const wake = page.getByTestId('server-waking');
    await expect(wake).toBeVisible({ timeout: 10_000 });
    await expect(wake).toContainText('인터넷 연결이 끊겨 있어요');
    const home = page.getByTestId('wake-home');
    await expect(home).toBeVisible();
    expect((await home.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await press(home);
    await expect(wake).toBeHidden();
    const status = page.getByTestId('server-status');
    await expect(status).toHaveAttribute('data-state', 'offline');
    await expect(page.getByTestId('room-code-input')).toHaveValue('ABCD');
    expect(page.url()).not.toContain('room=');
    expect(await page.evaluate(() => localStorage.getItem('decoy:lastRoom'))).toBeNull();
    await press(page.getByTestId('practice'));
    await press(page.getByTestId('practice-role-scout'));
    await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('playing');
    expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
    expect(sockets).toBe(0);
    expect(unexpected(problems)).toEqual([]);
  } finally {
    await context.close();
    await server.stop();
  }
});

// 수정 검토: 판 중 새로고침 · 탭 복원이면 지금 기록 항목이 뒤로 가기 항목이다. '첫 화면으로'가 그 항목을 걷어 내는 순회(비동기)
// 전에 주소를 고치면, 순회 뒤 아래 항목의 ?room=이 돌아와 다음 새로고침이 다시 방 경로로 부팅했다
test('뒤로 가기 항목이 남은 채 방 주소로 다시 열려도 "첫 화면으로" 뒤 주소에 room이 남지 않는다 (휴대폰)', async ({
  browser,
}) => {
  const port = await freePort();
  const server = await startServer(['--test-hooks'], { port });
  const base = `http://127.0.0.1:${port}`;
  const { context, page, problems } = await newPlayerPage(browser, dpr1(PHONE_LANDSCAPE));
  try {
    await page.goto(`${base}/?debug=hook&renderer=canvas`);
    await shellReady(page);
    await context.setOffline(true);
    await server.stop();
    await page.goto(`${base}/?debug=hook&renderer=canvas&room=ABCD`);
    await expect(page.getByTestId('server-waking')).toBeVisible({ timeout: 10_000 });
    // 판 안 탭이 넣는 뒤로 가기 항목(주소는 그대로) → 새로고침: 그 항목에서 다시 열린다
    await page.evaluate(() => window.history.pushState({ decoyGuard: 1 }, ''));
    await page.reload();
    expect(await page.evaluate(() => JSON.stringify(window.history.state))).toBe('{"decoyGuard":1}');
    const wake = page.getByTestId('server-waking');
    await expect(wake).toBeVisible({ timeout: 10_000 });
    await press(page.getByTestId('wake-home'));
    await expect(wake).toBeHidden();
    await expect(page.getByTestId('room-code-input')).toHaveValue('ABCD');
    // 순회가 끝나 아래 항목에 와 있고, 그 주소에도 room이 없다 (잠시 뒤에도)
    await expect.poll(() => page.evaluate(() => window.history.state)).toBeNull();
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain('room=');
    expect(page.url()).toContain('debug=hook');
    // 오프라인에서 깨우기 패널을 띄운 방 주소를 새로고침하면 크롬이 글꼴 미리 받기(preload)를 '쓰지 않음'으로 찍는다(뒤로 가기
    // 항목 없이 새로고침만 해도 같다 — 이 수정과 무관한 브라우저 경고, PROGRESS 알려진 문제). 이 시험에서만 그 한 줄을 허용한다
    const fontPreload = /noto-sans-kr-ui\.woff2 was preloaded using link preload but not used/;
    expect(unexpected(problems).filter((p) => !fontPreload.test(p))).toEqual([]);
  } finally {
    await context.close();
    await server.stop();
  }
});

test('서비스 워커 업데이트: 새 빌드를 서빙하면 새 워커로 바뀌고 바로 앞 빌드 셸만 남아, 옛 화면이 새 서버에 없는 옛 조각을 그 셸에서 열며 "새 버전이 있어요"', async ({
  browser,
}) => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // 빌드 B: 지금 빌드를 복사해 빌드 ID만 바꾸고(index.html에 표시를 남겨 셸이 B로 바뀐 것을 본다), 옛 화면이 아직 받지 않은
  // 조각 하나(배치 편집 — PC에서는 미리 받지 않는다)를 B에서 지운다: 새 배포에서 이름(해시)이 바뀐 조각과 같다.
  // 미리 압축한 사본(.br · .gz)은 옛 원본 것이 남는다 — 서버가 풀어 보고 다르면 쓰지 않는다(static.ts)
  const distB = mkdtempSync(join(tmpdir(), 'decoy-dist-b-'));
  cpSync('client/dist', distB, { recursive: true });
  const idA = (JSON.parse(readFileSync('client/dist/build-id.json', 'utf8')) as { id: string }).id;
  const idB = `${idA.slice(0, -4)}beef`;
  const editorChunk = readdirSync(join(distB, 'assets')).find((f) => /^layoutEditor-[\w-]+\.js$/.test(f));
  if (!editorChunk) throw new Error('배치 편집 조각이 없다');
  for (const f of [editorChunk, `${editorChunk}.br`, `${editorChunk}.gz`])
    rmSync(join(distB, 'assets', f), { force: true });
  writeFileSync(join(distB, 'build-id.json'), JSON.stringify({ id: idB }));
  writeFileSync(
    join(distB, 'sw.js'),
    readFileSync(join(distB, 'sw.js'), 'utf8')
      .replace(`"${idA}"`, `"${idB}"`)
      .replace(`"assets/${editorChunk}",`, ''),
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
      .toEqual(['decoy-shell-' + idA, 'decoy-shell-' + idB, 'decoy-wake-v2'].sort());
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
    // 옛 화면(빌드 A)이 아직 받지 않은 옛 조각: 새 서버에는 없고(404), 새 워커가 앞 빌드 셸에서 준다 → 실제로 열린다
    expect((await page.request.get(`${base}/assets/${editorChunk}`)).status()).toBe(404);
    expect(
      await page.evaluate(async (u) => {
        const r = await fetch(u);
        return [r.status, r.headers.get('x-decoy-build')];
      }, `/assets/${editorChunk}`),
    ).toEqual([200, idA]);
    await page.evaluate(() => window.__DECOY__?.openLayoutEditor('survivor'));
    await expect(page.getByTestId('layout-editor')).toBeVisible();
    await press(page.getByTestId('le-cancel'));
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
