// M10a 안개 GPU 합성 (WebGL · SwiftShader · 탭 1개 · 봇 방): 품질 높음(경계 셰이더) · 중간의 GPU 합성이
// Canvas 한 장 합성과 같은 밝기를 내고(±3), 콘솔 에러 · 경고(셰이더 컴파일 경고 포함)가 0이다.
// SwiftShader는 GPU가 아니라서 FPS는 기록만 한다.
import { expect, test, type Browser, type Page } from '@playwright/test';

interface Probe {
  rgb: [number, number, number];
  luma: number;
}

/** 스크린샷을 찍어 타일 좌표 주변 9×9 픽셀의 평균 색과 밝기를 잰다 */
async function probe(page: Page, tiles: Record<string, [number, number]>): Promise<Record<string, Probe>> {
  const shot = await page.screenshot();
  return page.evaluate(
    async ({ b64, tiles }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D 컨텍스트 없음');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const out: Record<string, { rgb: [number, number, number]; luma: number }> = {};
      for (const [name, [tx, ty]] of Object.entries(tiles)) {
        const p = window.__DECOY__?.tileToClient(tx, ty);
        if (!p) throw new Error('tileToClient 없음');
        const cx = Math.round(p.x);
        const cy = Math.round(p.y);
        let r = 0;
        let g = 0;
        let bl = 0;
        let n = 0;
        for (let y = cy - 4; y <= cy + 4; y += 1) {
          for (let x = cx - 4; x <= cx + 4; x += 1) {
            const i = (y * c.width + x) * 4;
            r += data[i] ?? 0;
            g += data[i + 1] ?? 0;
            bl += data[i + 2] ?? 0;
            n += 1;
          }
        }
        const lum = 0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (bl / n);
        out[name] = {
          rgb: [Math.round(r / n), Math.round(g / n), Math.round(bl / n)],
          luma: Math.round(lum * 10) / 10,
        };
      }
      return out;
    },
    { b64: shot.toString('base64'), tiles },
  );
}

const P_FLOOR: [number, number] = [21.5, 27.5];
const P_WALL: [number, number] = [17.5, 27.5];

interface Run {
  renderer: string;
  fogMode: string;
  quality: string;
  fogShader: boolean | number | string | undefined;
  lit: number;
  dark: number;
  wall: number;
  fps: number;
  problems: string[];
}

/** 봇 방을 열어 러너로 시작하고, 같은 배치에서 시야 안 · 밖 밝기를 잰다 */
async function measure(browser: Browser, query: string): Promise<Run> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems: string[] = [];
  // 이 검사는 거르지 않는다: 셰이더 컴파일 경고 · GL 경고도 문제로 센다
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`/?bots=1&debug=hook${query}`);
  await page.getByTestId('create-room').click();
  await page.getByTestId('role-runner').click();
  await page.getByTestId('ready-button').click();
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 5, null, { timeout: 30_000 });
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  const truth = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string; role: string }[];
  };
  const id = (role: string): string => truth.players.find((p) => p.role === role)?.id ?? '';
  const send = (cmd: Parameters<NonNullable<typeof window.__DECOY__>['sendTest']>[0]): Promise<void> =>
    page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
  // 봇은 멈추고, 괴물 봇은 생존자가 안 보이는 B 방 안쪽
  await send({ kind: 'teleport', target: id('scout'), x: 45, y: 2 });
  await send({ kind: 'teleport', target: id('guard'), x: 31, y: 30 });
  await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
  await send({ kind: 'teleport', target: id('runner'), x: 21.5, y: 25 });
  for (const r of ['scout', 'guard', 'monster']) await send({ kind: 'freeze', target: id(r), frozen: true });
  await page.mouse.move(10, 10);
  await page.keyboard.press('KeyX');
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForTimeout(800);
  const lit = await probe(page, { floor: P_FLOOR });
  await send({ kind: 'teleport', target: id('runner'), x: 5, y: 2 });
  await page.waitForTimeout(800);
  const dark = await probe(page, { floor: P_FLOOR, wall: P_WALL });
  const info = await page.evaluate(() => {
    const d = window.__DECOY__;
    return {
      renderer: d?.renderer ?? 'none',
      fogMode: d?.gfx.fogMode ?? '',
      quality: d?.gfx.quality ?? '',
      fogShader: d?.gfx.features.fogShader,
    };
  });
  // FPS 기록 (2초)
  await page.evaluate(() => window.__DECOY__?.freezeClock(null));
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(() => window.__DECOY__?.fps ?? 0);
  await context.close();
  return {
    ...info,
    lit: lit.floor!.luma,
    dark: dark.floor!.luma,
    wall: dark.wall!.luma,
    fps: Math.round(fps * 10) / 10,
    problems,
  };
}

test('GPU 안개(품질 높음 · 중간)가 Canvas 합성과 같은 밝기를 내고 콘솔이 깨끗하다', async ({ browser }) => {
  const canvas = await measure(browser, '&renderer=canvas&quality=low');
  expect(canvas.renderer).toBe('canvas');
  expect(canvas.fogMode).toBe('canvas');
  expect(canvas.fogShader).toBe(false);
  for (const q of ['high', 'medium'] as const) {
    const gl = await measure(browser, `&renderer=webgl&quality=${q}`);
    console.log(`[m10-fog.webgl] ${q}: ${JSON.stringify(gl)} / canvas: ${JSON.stringify(canvas)}`);
    expect(gl.renderer).toBe('webgl');
    expect(gl.fogMode).toBe('gpu');
    // 경계 셰이더는 품질 높음에서만 (실제로 적용된 품질 기준)
    expect(gl.fogShader).toBe(gl.quality === 'high');
    // 같은 장면에서 두 경로의 밝기 차 ±3
    expect(Math.abs(gl.lit - canvas.lit)).toBeLessThanOrEqual(3);
    expect(Math.abs(gl.dark - canvas.dark)).toBeLessThanOrEqual(3);
    expect(Math.abs(gl.wall - canvas.wall)).toBeLessThanOrEqual(3);
    // 구조가 보이고 시야 안이 충분히 밝다 (Canvas 검사와 같은 기준)
    expect(gl.dark).toBeGreaterThanOrEqual(6);
    expect(gl.lit).toBeGreaterThanOrEqual(gl.dark * 2.5);
    expect(gl.problems).toEqual([]);
  }
  expect(canvas.problems).toEqual([]);
});
