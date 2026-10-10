// M14 PWA: 브라우저가 manifest를 오류 없이 읽고(CDP Page.getAppManifest), 가로 · 전체 화면 · 아이콘이 기대대로 풀리며,
// 아이콘 · manifest 요청이 200(맞는 MIME)이고 콘솔이 깨끗하다. 설치 가능 판정 API는 manifest가 없어도 빈 값을 돌려줘서 쓰지 않는다
import { expect, test } from '@playwright/test';
import { newPlayerPage } from './helpers';

interface Manifest {
  display: string;
  orientation: string;
  start_url: string;
  scope: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

test('manifest를 오류 없이 읽고 가로 · 전체 화면 · 아이콘 넷이 풀리며, 아이콘 · manifest 요청이 200', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  const responses = new Map<string, { status: number; type: string }>();
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    responses.set(path, { status: r.status(), type: r.headers()['content-type'] ?? '' });
  });
  await page.goto('/?debug=hook&renderer=canvas');
  await expect(page.getByTestId('practice')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  const got = (await cdp.send('Page.getAppManifest')) as { url: string; errors: unknown[]; data?: string };
  expect(new URL(got.url).pathname).toBe('/manifest.webmanifest');
  expect(got.errors).toEqual([]);
  const m = JSON.parse(got.data ?? '{}') as Manifest;
  expect(m.display).toBe('fullscreen');
  expect(m.orientation).toBe('landscape');
  expect(m.start_url).toBe('/?source=pwa');
  expect(m.scope).toBe('/');
  expect(m.icons.map((i) => `${i.purpose}:${i.sizes}`).sort()).toEqual(
    ['any:192x192', 'any:512x512', 'maskable:192x192', 'maskable:512x512'].sort(),
  );
  // 아이콘을 manifest 기준 주소로 받아 본다
  for (const icon of m.icons) {
    const url = new URL(icon.src, got.url).href;
    const r = await page.request.get(url);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type'], icon.src).toBe('image/png');
  }
  const mr = await page.request.get('/manifest.webmanifest');
  expect(mr.headers()['content-type']).toBe('application/manifest+json');
  // 페이지가 manifest를 실제로 받았다 (link rel=manifest)
  await expect.poll(() => responses.get('/manifest.webmanifest')?.status ?? 0).toBe(200);
  // start_url로 열어도 첫 화면 (설치 앱이 여는 주소)
  await page.goto('/?source=pwa&debug=hook&renderer=canvas');
  await expect(page.getByTestId('practice')).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();
});
