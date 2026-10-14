// 캐릭터 리디자인 1단계: 지금 그림과 새 그림을 같은 장면에서 나란히 찍는다 (artifacts/characters/compare/).
//  - 게임 화면: 실제 게임(Canvas 렌더러 · 품질 높음)을 휴대폰 가로 800×360 · 기기 배율 3(2400×1080)으로 띄우고, 서버 봇 셋을
//    테스트 훅으로 놓은 뒤 서버 → 화면 웹소켓 메시지를 잠깐 막아 장면을 세운다. 그 상태에서 지금 그림을 찍고, 캐릭터 아틀라스
//    캔버스의 같은 칸에 새 그림을 덮어 그려(scripts/char-art/inject.ts) 다시 찍는다 → 같은 순간 · 같은 자리 · 같은 크기
//  - 로비: 방 화면 역할 카드 · 봇과 연습 역할 고르기의 그림(SVG)만 새 정면 그림으로 바꿔 찍는다 (PC 1440×900, 휴대폰 800×360 · 배율 3)
// 게임 코드는 바꾸지 않는다(덮어쓰기는 이 촬영 탭 안에서만). 그림을 바꿀 때만 사람이 돌리고 결과 PNG를 커밋한다
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import type { Role, TestCommand } from '@decoy/shared';
import { watchConsole } from '../e2e/helpers';
import { MultiTouch } from '../e2e/touch';

const OUT = 'artifacts/characters/compare';
const PHONE: BrowserContextOptions = {
  viewport: { width: 800, height: 360 },
  screen: { width: 800, height: 360 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const PC: BrowserContextOptions = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const QUERY = 'debug=hook&renderer=canvas&quality=high';
const CLOCK_MS = 12_000;
const problems: string[] = [];

let injectCode = '';
let fontB64 = '';

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const r = await build({
    entryPoints: ['scripts/char-art/inject.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'warning',
    define: { __DECOY_BUILD__: '"char-art"' },
  });
  injectCode = r.outputFiles[0]?.text ?? '';
  fontB64 = readFileSync('client/public/fonts/noto-sans-kr-ui.woff2').toString('base64');
});

test.afterAll(() => {
  writeFileSync(join(OUT, 'problems.json'), `${JSON.stringify(problems, null, 2)}\n`);
});

interface Tab {
  page: Page;
  freeze(on: boolean): void;
  close(): Promise<void>;
}

/** 탭 하나: 만든 canvas를 모아 두고(아틀라스 찾기), 서버 → 화면 메시지를 멈출 수 있게 웹소켓을 가운데서 잇는다 */
async function openTab(browser: Browser, device: BrowserContextOptions, label: string): Promise<Tab> {
  const context = await browser.newContext(device);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('decoy:touchTutorial', '1');
    } catch {
      // 저장소가 막혀도 촬영은 한다
    }
    const list: WeakRef<HTMLCanvasElement>[] = [];
    (window as unknown as { __charCanvases: WeakRef<HTMLCanvasElement>[] }).__charCanvases = list;
    const orig = Document.prototype.createElement;
    Document.prototype.createElement = function (this: Document, tag: string, opts?: ElementCreationOptions) {
      const el = orig.call(this, tag, opts);
      if (String(tag).toLowerCase() === 'canvas') list.push(new WeakRef(el as HTMLCanvasElement));
      return el;
    } as typeof Document.prototype.createElement;
  });
  const page = await context.newPage();
  let frozen = false;
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (!frozen) ws.send(m);
    });
  });
  const list: string[] = [];
  watchConsole(page, list);
  return {
    page,
    freeze: (on) => {
      frozen = on;
    },
    close: async () => {
      problems.push(...list.map((p) => `${label} ${p}`));
      await context.close();
    },
  };
}

async function send(page: Page, cmd: TestCommand): Promise<void> {
  await page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
}

async function press(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  await expect(el).toBeEnabled();
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await el.tap();
  else await el.click();
}

async function soloMatch(page: Page, role: Role): Promise<{ code: string; you: string }> {
  await page.goto(`/?${QUERY}&bots=1`);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(page, 'create-room');
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.getByTestId('room-code').textContent()) ?? '';
  await press(page, `role-${role}`);
  await press(page, 'ready-button');
  await press(page, 'start-button');
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) >= 3, null, { timeout: 30_000 });
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  return { code, you: await page.evaluate(() => window.__DECOY__?.you ?? '') };
}

interface TruthPlayer {
  id: string;
  role: string;
  x: number;
  y: number;
}

async function players(page: Page, code: string): Promise<TruthPlayer[]> {
  const r = await page.request.get(`/test/state?room=${code}`);
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { players: TruthPlayer[] }).players;
}

async function placeBots(
  page: Page,
  code: string,
  spots: readonly (readonly [Role, number, number, number])[],
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const all = await players(page, code);
    for (const [role, x, y, face] of spots) {
      const p = all.find((q) => q.role === role);
      if (!p) throw new Error(`봇 ${role} 없음`);
      await send(page, { kind: 'teleport', target: p.id, x, y, face });
      await send(page, { kind: 'freeze', target: p.id, frozen: true });
    }
    await page.waitForTimeout(200);
    const now = await players(page, code);
    const off = spots.some(([role, x, y]) => {
      const p = now.find((q) => q.role === role);
      return !p || Math.hypot(p.x - x, p.y - y) > 1e-3;
    });
    if (!off) return;
    if (attempt === 7)
      throw new Error(`봇을 자리에 놓지 못함: ${JSON.stringify(now.map((p) => [p.role, p.x, p.y]))}`);
  }
}

async function placeSelf(
  page: Page,
  code: string,
  you: string,
  x: number,
  y: number,
  face: number,
): Promise<void> {
  await send(page, { kind: 'teleport', target: you, x, y, face });
  await expect
    .poll(async () => {
      const me = (await players(page, code)).find((p) => p.id === you);
      return me !== undefined && Math.hypot(me.x - x, me.y - y) < 0.05;
    })
    .toBe(true);
}

/** 화면 기기 px 사각형 (타일 범위) */
async function tileRect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(
    ([a, b, c, d]) => {
      const p = window.__DECOY__?.tileToClient(a!, b!);
      const q = window.__DECOY__?.tileToClient(c!, d!);
      if (!p || !q) throw new Error('tileToClient 없음');
      const k = window.devicePixelRatio || 1;
      return {
        x: Math.round(p.x * k),
        y: Math.round(p.y * k),
        w: Math.round((q.x - p.x) * k),
        h: Math.round((q.y - p.y) * k),
      };
    },
    [x0, y0, x1, y1],
  );
}

async function inject(page: Page): Promise<void> {
  await page.addScriptTag({ content: injectCode });
}

/** 장면을 세운 채 지금 그림 → 새 그림을 찍는다 */
async function beforeAfter(tab: Tab): Promise<{ before: Buffer; after: Buffer; patch: unknown }> {
  const { page } = tab;
  await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
  tab.freeze(true);
  await page.waitForTimeout(500);
  const before = await page.screenshot();
  await inject(page);
  const patch = await page.evaluate(() =>
    (window as unknown as { CHAR_INJECT: { patchAtlas(): unknown } }).CHAR_INJECT.patchAtlas(),
  );
  await page.waitForTimeout(250);
  const after = await page.screenshot();
  tab.freeze(false);
  return { before, after, patch };
}

interface Panel {
  png: Buffer;
  label: string;
  /** 자를 영역 (기기 px, 없으면 전체) */
  crop?: { x: number; y: number; w: number; h: number };
  /** 확대 배율 (최근접) */
  scale?: number;
}

/** 패널들을 가로 또는 세로로 이어 붙이고 제목 · 이름표를 단다 (브라우저 canvas, 새 의존성 없음) */
async function compose(
  browser: Browser,
  title: string,
  panels: Panel[],
  dir: 'row' | 'col',
): Promise<Buffer> {
  const page = await browser.newPage();
  const data = await page.evaluate(
    async ({ title, panels, dir, font }) => {
      const f = new FontFace('Noto Sans KR', `url(data:font/woff2;base64,${font})`, { weight: '700' });
      await f.load();
      document.fonts.add(f);
      const imgs = await Promise.all(
        panels.map(async (p) => {
          const img = new Image();
          img.src = `data:image/png;base64,${p.b64}`;
          await img.decode();
          const crop = p.crop ?? { x: 0, y: 0, w: img.width, h: img.height };
          const s = p.scale ?? 1;
          return { img, crop, s, w: Math.round(crop.w * s), h: Math.round(crop.h * s), label: p.label };
        }),
      );
      const pad = 24;
      const head = 64;
      const lab = 48;
      const W =
        dir === 'row'
          ? imgs.reduce((a, i) => a + i.w, 0) + pad * (imgs.length + 1)
          : Math.max(...imgs.map((i) => i.w)) + pad * 2;
      const H =
        dir === 'row'
          ? head + lab + Math.max(...imgs.map((i) => i.h)) + pad
          : head + imgs.reduce((a, i) => a + i.h + lab, 0) + pad * imgs.length;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('2d');
      ctx.fillStyle = '#0b1622';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = "700 30px 'Noto Sans KR'";
      ctx.fillText(title, pad, 44);
      let x = pad;
      let y = head;
      for (const i of imgs) {
        ctx.fillStyle = i.label.startsWith('새') ? '#67e8f9' : '#94a3b8';
        ctx.font = "700 26px 'Noto Sans KR'";
        ctx.fillText(i.label, x, y + 34);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(i.img, i.crop.x, i.crop.y, i.crop.w, i.crop.h, x, y + lab, i.w, i.h);
        if (dir === 'row') x += i.w + pad;
        else y += i.h + lab + pad;
      }
      return c.toDataURL('image/png').split(',')[1] ?? '';
    },
    {
      title,
      panels: panels.map((p) => ({
        b64: p.png.toString('base64'),
        label: p.label,
        crop: p.crop,
        scale: p.scale,
      })),
      dir,
      font: fontB64,
    },
  );
  await page.close();
  return Buffer.from(data, 'base64');
}

function save(file: string, buf: Buffer): void {
  writeFileSync(join(OUT, file), buf);
}

test('생존자 화면 (러너): 거점 A에서 팀원 둘 · 괴물에게 발각', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '생존자');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'runner');
  await placeBots(page, code, [
    ['monster', 11.4, 17.3, Math.PI - 0.2],
    ['guard', 9.3, 15.1, 0.5],
    ['scout', 6.8, 17.5, -0.4],
  ]);
  await placeSelf(page, code, you, 8.2, 16.5, 0);
  await send(page, { kind: 'setPoint', point: 'A', progress: 0.42 });
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  await send(page, { kind: 'setTime', timeLeft: 548.4 });
  await placeBots(page, code, [['monster', 11.4, 17.3, Math.PI - 0.2]]);
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.monster ?? null) !== null, null, {
    timeout: 20_000,
  });
  const shot = await beforeAfter(tab);
  const crop = await tileRect(page, 5.2, 13.6, 13.2, 19.2);
  save(
    'ingame-survivor-view.png',
    await compose(
      browser,
      '생존자 화면 (러너) · 휴대폰 800×360 · 기기 배율 3 · 실제 화소',
      [
        { png: shot.before, label: '지금 그림' },
        { png: shot.after, label: '새 캐릭터' },
      ],
      'col',
    ),
  );
  save(
    'ingame-survivor-zoom.png',
    await compose(
      browser,
      '생존자 화면 확대 (기기 화소 3배 최근접) — 러너(나) · 가드 · 스카우트 · 괴물',
      [
        { png: shot.before, label: '지금 그림', crop, scale: 3 },
        { png: shot.after, label: '새 캐릭터', crop, scale: 3 },
      ],
      'row',
    ),
  );
  writeFileSync(join(OUT, 'ingame-survivor-patch.json'), JSON.stringify(shot.patch));
  await tab.close();
});

test('괴물 화면: 추적 시야 안의 흰 생존자 셋', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '괴물');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'monster');
  await placeBots(page, code, [
    ['guard', 9.4, 16.3, 0.2],
    ['runner', 8.1, 17.5, -0.4],
    ['scout', 10.6, 17.7, 2.6],
  ]);
  await send(page, { kind: 'setPoint', point: 'A', progress: 0.35 });
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
    timeout: 20_000,
  });
  // 터치 화면은 조준 스틱을 놓으면 마지막 이동 방향을 조준한다: 이동 스틱을 서쪽으로 잠깐 끌어 조준을 서쪽으로
  await placeSelf(page, code, you, 20, 16.9, Math.PI);
  const zone = await page.evaluate(
    () => window.__DECOY__?.getTouchTargets().find((t) => t.id === 'move-zone') ?? null,
  );
  if (!zone) throw new Error('이동 영역 없음');
  const touch = await MultiTouch.attach(page);
  const sx = zone.x + zone.w * 0.6;
  const sy = zone.y + zone.h * 0.6;
  await touch.down(1, sx, sy);
  await touch.move(1, sx - 60, sy, { steps: 6 });
  await page.waitForTimeout(600);
  await touch.up(1);
  await touch.detach();
  await placeSelf(page, code, you, 14.2, 16.9, Math.PI);
  await expect
    .poll(async () => {
      const r = await page.request.get(`/test/state?room=${code}`);
      const t = (await r.json()) as { monster: { aim: number } | null };
      return Math.abs(Math.abs(t.monster?.aim ?? 0) - Math.PI);
    })
    .toBeLessThan(0.2);
  // 추적 시야(50° · 9타일)로: 셋이 모두 들어온다
  const mode = await page.evaluate(
    () => window.__DECOY__?.getTouchTargets().find((t) => t.id === 'mode') ?? null,
  );
  if (!mode) throw new Error('시야 모드 버튼 없음');
  await page.touchscreen.tap(mode.x + mode.w / 2, mode.y + mode.h / 2);
  await expect
    .poll(() => page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.you.mon?.mode))
    .toBe('hunt');
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.survivors.length ?? 0) >= 3, null, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  await send(page, { kind: 'setTime', timeLeft: 522.4 });
  const shot = await beforeAfter(tab);
  const crop = await tileRect(page, 6.2, 14.0, 16.2, 19.6);
  save(
    'ingame-monster-view.png',
    await compose(
      browser,
      '괴물 화면 · 휴대폰 800×360 · 기기 배율 3 · 실제 화소 (생존자 셋은 같은 흰 그림)',
      [
        { png: shot.before, label: '지금 그림' },
        { png: shot.after, label: '새 캐릭터' },
      ],
      'col',
    ),
  );
  save(
    'ingame-monster-zoom.png',
    await compose(
      browser,
      '괴물 화면 확대 (기기 화소 3배 최근접) — 흰 생존자 셋 · 괴물(나)',
      [
        { png: shot.before, label: '지금 그림', crop, scale: 3 },
        { png: shot.after, label: '새 캐릭터', crop, scale: 3 },
      ],
      'row',
    ),
  );
  writeFileSync(join(OUT, 'ingame-monster-patch.json'), JSON.stringify(shot.patch));
  await tab.close();
});

/** 방 화면 역할 카드: 내가 러너, 다른 탭이 괴물을 고른 상태 */
async function lobbyCards(
  browser: Browser,
  device: BrowserContextOptions,
  label: string,
): Promise<{ before: Buffer; after: Buffer }> {
  const a = await openTab(browser, device, `${label} 방장`);
  const b = await openTab(browser, PC, `${label} 손님`);
  await a.page.goto(`/?${QUERY}`);
  await expect(a.page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(a.page, 'create-room');
  await expect(a.page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await a.page.getByTestId('room-code').textContent()) ?? '';
  await press(a.page, 'role-runner');
  await b.page.goto(`/?${QUERY}&room=${code}`);
  await expect(b.page.getByTestId('role-monster')).toBeVisible();
  await press(b.page, 'role-monster');
  await expect(a.page.getByTestId('role-monster')).toHaveClass(/taken/);
  await a.page.waitForTimeout(400);
  a.freeze(true);
  await a.page.waitForTimeout(300);
  const cards = a.page.locator('.role-cards').first();
  const before = await cards.screenshot();
  await inject(a.page);
  await a.page.evaluate(() => {
    const api = (window as unknown as { CHAR_INJECT: { newRoleFigureSvg(r: string): string } }).CHAR_INJECT;
    for (const role of ['monster', 'runner', 'guard', 'scout']) {
      const svg = document.querySelector(`[data-testid="role-${role}"] .rc-figure > svg`);
      if (svg) svg.outerHTML = api.newRoleFigureSvg(role);
    }
  });
  await a.page.waitForTimeout(200);
  const after = await cards.screenshot();
  a.freeze(false);
  await b.close();
  await a.close();
  return { before, after };
}

test('로비 역할 카드 (PC 1440×900)', async ({ browser }) => {
  const r = await lobbyCards(browser, PC, 'PC');
  save(
    'lobby-cards-pc.png',
    await compose(
      browser,
      '로비 역할 카드 · PC 1440×900 (내 역할 = 러너, 괴물은 다른 사람이 고름)',
      [
        { png: r.before, label: '지금 그림' },
        { png: r.after, label: '새 캐릭터' },
      ],
      'col',
    ),
  );
});

test('로비 역할 카드 (휴대폰 800×360 · 배율 3)', async ({ browser }) => {
  const r = await lobbyCards(browser, PHONE, '휴대폰');
  save(
    'lobby-cards-phone.png',
    await compose(
      browser,
      '로비 역할 카드 · 휴대폰 800×360 · 기기 배율 3 (실제 화소)',
      [
        { png: r.before, label: '지금 그림' },
        { png: r.after, label: '새 캐릭터' },
      ],
      'col',
    ),
  );
});

test('봇과 연습 역할 고르기 (휴대폰 800×360 · 배율 3)', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '연습');
  const { page } = tab;
  await page.goto(`/?${QUERY}`);
  await press(page, 'practice');
  await expect(page.getByTestId('practice-picker')).toBeVisible();
  await page.waitForTimeout(400);
  const grid = page.locator('.practice-roles').first();
  const before = await grid.screenshot();
  await inject(page);
  await page.evaluate(() => {
    const api = (window as unknown as { CHAR_INJECT: { newRoleFigureSvg(r: string): string } }).CHAR_INJECT;
    for (const role of ['monster', 'runner', 'guard', 'scout']) {
      const svg = document.querySelector(`[data-testid="practice-role-${role}"] .pr-figure > svg`);
      if (svg) svg.outerHTML = api.newRoleFigureSvg(role);
    }
  });
  await page.waitForTimeout(200);
  const after = await grid.screenshot();
  save(
    'lobby-practice-phone.png',
    await compose(
      browser,
      '봇과 연습 역할 고르기 · 휴대폰 800×360 · 기기 배율 3',
      [
        { png: before, label: '지금 그림' },
        { png: after, label: '새 캐릭터' },
      ],
      'col',
    ),
  );
  await tab.close();
});
