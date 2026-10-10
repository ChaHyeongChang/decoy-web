// 스토어 그림 촬영 (M15, docs/MOBILE_PLAN.md M15 3번 · docs/STORE_LISTING.md 3장). npm run shots:store
//  - 휴대폰 가로 스크린샷 5장: 640×360 휴대폰(터치 · 기기 배율 3 → 1920×1080 PNG), 품질 높음 · WebGL, 터치 조작 UI가 보이게
//      phone-1-lobby (로비 첫 화면) · phone-2-monster (괴물 화면) · phone-3-survivor (생존자: 점령 중 발각) ·
//      phone-4-rescue (감옥 구조) · phone-5-result (결과)
//  - 그래픽 이미지 feature-graphic.png 1024×500: 괴물 화면(PC, 배율 2)의 가운데를 잘라 왼쪽에 로고 + DECOY를 얹는다
//  - artifacts/store/manifest.json: 장면 · 크기 · 찍는 순간의 터치 대상 · 그래픽 상태 · 콘솔 문제 (tests/unit/store-images.test.ts가 읽는다)
// 장면은 사람 탭 하나 + 서버 봇 셋(테스트 훅으로 자리 · 멈춤)으로 만든다. 판정은 서버가 하고, 화면은 실제 게임 그대로다
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { RESCUE_POINT, type Role, type TestCommand } from '@decoy/shared';
import { watchConsole } from '../e2e/helpers';

const OUT = 'artifacts/store';
/** 640×360 휴대폰 가로, 기기 배율 3 (16:9 → 1920×1080). 플레이 스크린샷은 긴 변 ≤ 짧은 변 × 2 */
const PHONE: BrowserContextOptions = {
  viewport: { width: 640, height: 360 },
  screen: { width: 640, height: 360 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
/** 그래픽 이미지 원본: PC 1600×900 배율 2에서 가운데 1024×500(CSS px)을 잘라 2:1로 줄인다 */
const WIDE: BrowserContextOptions = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 };
const QUERY = 'debug=hook&renderer=webgl&quality=high';
/** 장식 시계 고정 (ms): 망토 · 빛 위상이 늘 같게 */
const CLOCK_MS = 12_000;

interface Shot {
  file: string;
  scene: string;
  width: number;
  height: number;
  bytes: number;
  touchTargets: string[];
  renderer: string | null;
  quality: string | null;
}
const shots: Shot[] = [];
const problems: string[] = [];

interface Tab {
  page: Page;
  close(): Promise<void>;
}

async function openTab(browser: Browser, device: BrowserContextOptions, label: string): Promise<Tab> {
  const context = await browser.newContext(device);
  // 터치 조작 안내 카드는 본 것으로 (그 판 처음 10초 위치 표시만 남는다 — 장면은 10초 뒤에 찍는다)
  await context.addInitScript(() => {
    try {
      localStorage.setItem('decoy:touchTutorial', '1');
    } catch {
      // 저장소가 막혀도 촬영은 한다
    }
  });
  const page = await context.newPage();
  const list: string[] = [];
  watchConsole(page, list);
  return {
    page,
    close: async () => {
      problems.push(...list.map((p) => `${label} ${p}`));
      await context.close();
    },
  };
}

async function send(page: Page, cmd: TestCommand): Promise<void> {
  await page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
}

/** 터치 기기면 탭, 아니면 클릭 */
async function press(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  await expect(el).toBeEnabled();
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await el.tap();
  else await el.click();
}

/** 봇 셋과 방을 만들어 role로 시작한다 (방장 = 나) */
async function soloMatch(page: Page, role: Role): Promise<{ code: string; you: string }> {
  await page.goto(`/?${QUERY}&bots=1`);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(page, 'create-room');
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.getByTestId('room-code').textContent()) ?? '';
  await press(page, `role-${role}`);
  await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
  await press(page, 'ready-button');
  await press(page, 'start-button');
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) >= 3, null, { timeout: 30_000 });
  // SwiftShader는 40fps 아래라 판 중 자동 하향이 걸린다: 찍는 동안 품질 높음을 지킨다
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

/** 봇을 자리에 놓고 멈춘다 (봇이 그 틱에 움직였으면 다시) */
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
  }
  throw new Error('봇을 자리에 놓지 못함');
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
  await page.waitForFunction(
    ([tx, ty]) => {
      const st = window.__DECOY__?.getLocalState();
      return st !== null && st !== undefined && Math.hypot(st.x - tx!, st.y - ty!) < 0.05;
    },
    [x, y],
  );
}

/** 터치 대상(id) 가운데를 탭한다 */
async function tapTarget(page: Page, id: string): Promise<void> {
  const t = await page.evaluate(
    (want) => window.__DECOY__?.getTouchTargets().find((x) => x.id === want) ?? null,
    id,
  );
  if (!t) throw new Error(`터치 대상 ${id} 없음`);
  await page.touchscreen.tap(t.x + t.w / 2, t.y + t.h / 2);
}

async function save(page: Page, file: string, scene: string, buf?: Buffer): Promise<void> {
  const meta = await page.evaluate(() => {
    const d = window.__DECOY__;
    return {
      touchTargets: (d?.getTouchTargets() ?? []).map((t) => t.id),
      renderer: d?.renderer ?? null,
      quality: d?.gfx.quality ?? null,
    };
  });
  const png = buf ?? (await page.screenshot());
  writeFileSync(join(OUT, file), png);
  shots.push({
    file,
    scene,
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bytes: png.length,
    ...meta,
  });
}

/** 장식 시계를 고정하고 화면이 따라올 때까지 */
async function steady(page: Page): Promise<void> {
  await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
  await page.waitForTimeout(600);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
  shots.sort((a, b) => (a.file < b.file ? -1 : 1));
  const old = (() => {
    try {
      return JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as { shots?: Shot[] };
    } catch {
      return {};
    }
  })();
  // 아이콘(npm run icons)처럼 이 촬영이 만들지 않는 파일의 기록은 남긴다
  const keep = (old.shots ?? []).filter((s) => !shots.some((n) => n.file === s.file));
  writeFileSync(
    join(OUT, 'manifest.json'),
    `${JSON.stringify({ createdAt: new Date().toISOString(), shots: [...keep, ...shots].sort((a, b) => (a.file < b.file ? -1 : 1)), problems }, null, 2)}\n`,
  );
});

test('로비 첫 화면 (빠른 매칭 · 봇과 연습)', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '로비');
  const { page } = tab;
  await page.goto(`/?${QUERY}`);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('quick-match')).toBeEnabled();
  await page.getByTestId('name-input').fill('');
  await page.waitForTimeout(800);
  await save(page, 'phone-1-lobby.png', 'lobby');
  await tab.close();
});

test('괴물 화면: 추적 시야에 흰 생존자 둘, 포효 표시', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '괴물');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'monster');
  // 괴물은 감옥 남쪽에서 북쪽(감옥 문)을 본다. 생존자는 감옥 앞 · 왼쪽 기둥 옆, 스카우트는 멀리
  await placeBots(page, code, [
    ['guard', 24.6, 20.2, 2.4],
    ['runner', 21.2, 21.6, -2.2],
    ['scout', 40, 16, 0],
  ]);
  // 괴물 시작 지연(5초) 뒤에 움직일 수 있다
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
    timeout: 20_000,
  });
  await placeSelf(page, code, you, 25.2, 24.6, -1.75);
  await tapTarget(page, 'mode');
  await expect
    .poll(() => page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.monster?.mode))
    .toBe('hunt');
  // 처음 10초 위치 표시 · 시작 알림이 사라질 때까지
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(120);
  await page.keyboard.up('KeyQ');
  await steady(page);
  await save(page, 'phone-2-monster.png', 'monster');
  // 그래픽 이미지 원본: 같은 장면을 PC 넓은 화면으로 (터치 UI 없이)
  await tab.close();
});

test('생존자 화면: 거점 A 점령 중 괴물에게 발각', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '생존자');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'runner');
  await placeBots(page, code, [
    ['monster', 11.6, 17.2, Math.PI - 0.15],
    ['guard', 9.2, 14.6, 0.6],
    ['scout', 40, 16, 0],
  ]);
  await placeSelf(page, code, you, 8, 16.4, 0);
  await send(page, { kind: 'setPoint', point: 'A', progress: 0.42 });
  await page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.spotted === true, null, {
    timeout: 20_000,
  });
  await page.waitForFunction(
    () => (window.__DECOY__?.getBanners() ?? []).some((t) => t.includes('발각')),
    null,
    { timeout: 20_000 },
  );
  await steady(page);
  await save(page, 'phone-3-survivor.png', 'survivor');
  await tab.close();
});

test('감옥 구조 장면 → 결과 화면', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '구조');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'guard');
  const all = await players(page, code);
  const runner = all.find((p) => p.role === 'runner');
  const scout = all.find((p) => p.role === 'scout');
  if (!runner || !scout) throw new Error('봇 생존자 없음');
  await send(page, { kind: 'setSurvivor', target: runner.id, status: 'imprisoned', hp: 2, imprisonCount: 1 });
  await send(page, { kind: 'setSurvivor', target: scout.id, status: 'imprisoned', hp: 2, imprisonCount: 1 });
  // 갇힌 둘은 감옥 안 자리로 (setSurvivor는 상태만 바꾼다)
  await placeBots(page, code, [
    ['runner', 23.5, 15.5, 0.4],
    ['scout', 24.5, 15.6, 2.6],
    ['monster', 29.5, 22.5, -2.6],
  ]);
  await placeSelf(page, code, you, RESCUE_POINT.x, RESCUE_POINT.y + 0.4, -Math.PI / 2);
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  // 구조 버튼을 누르고 있다 (키 E — 터치 모드에서도 키보드는 받는다). 구조는 3초, 절반쯤에서 찍는다
  await page.keyboard.down('KeyE');
  await page.waitForFunction(
    () => (window.__DECOY__?.getLastSnapshot()?.you.surv?.rescue ?? 0) >= 0.45,
    null,
    {
      timeout: 20_000,
      polling: 50,
    },
  );
  await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
  await save(page, 'phone-4-rescue.png', 'rescue');
  await page.keyboard.up('KeyE');
  // 결과: 시간 초과로 끝낸다 (탈출 0명 → 괴물 승리)
  await send(page, { kind: 'setTime', timeLeft: 0.1 });
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await save(page, 'phone-5-result.png', 'result');
  await tab.close();
});

test('그래픽 이미지 1024×500: 괴물 화면 가운데 + 로고 + DECOY', async ({ browser }) => {
  const tab = await openTab(browser, WIDE, '그래픽');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'monster');
  await placeBots(page, code, [
    ['guard', 27.6, 21.4, 2.6],
    ['runner', 30.4, 23.6, 2.9],
    ['scout', 40, 16, 0],
  ]);
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
    timeout: 20_000,
  });
  await placeSelf(page, code, you, 24.6, 23.2, 0.1);
  const aim = await page.evaluate(() => window.__DECOY__?.tileToClient(29, 22.8) ?? null);
  if (!aim) throw new Error('tileToClient 없음');
  await page.mouse.move(aim.x, aim.y);
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  await steady(page);
  // 내 캐릭터(화면 가운데)를 왼쪽 40%쯤에 두고 오른쪽으로 부채꼴이 뻗게 자른다
  const me = await page.evaluate(() => window.__DECOY__?.tileToClient(24.6, 23.2) ?? null);
  if (!me) throw new Error('tileToClient 없음');
  const crop = { w: 1024, h: 500 };
  const cx = Math.max(0, Math.min(WIDE.viewport!.width - crop.w, Math.round(me.x - crop.w * 0.42)));
  const cy = Math.max(0, Math.min(WIDE.viewport!.height - crop.h, Math.round(me.y - crop.h * 0.5)));
  const shot = await page.screenshot({ clip: { x: cx, y: cy, width: crop.w, height: crop.h } });
  const logo = readFileSync('client/public/logo.svg', 'utf8');
  // 합성: 2048×1000 잘라 낸 그림을 1024×500으로 줄이고 왼쪽을 어둡게 해 로고 · 글자를 얹는다 (브라우저 canvas, 새 의존성 없음)
  const composer = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const cp = await composer.newPage();
  await cp.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0"></body>');
  const fontFile = readFileSync('client/public/fonts/noto-sans-kr-ui.woff2').toString('base64');
  const b64 = await cp.evaluate(
    async ({ src, svg, font }) => {
      const face = new FontFace('UI', `url(data:font/woff2;base64,${font})`, { weight: '100 900' });
      await face.load();
      document.fonts.add(face);
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const lg = new Image();
      lg.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      await lg.decode();
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 500;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, 1024, 500);
      // 왼쪽 어둡게 (바탕색 #0B1622로)
      const fade = g.createLinearGradient(0, 0, 560, 0);
      fade.addColorStop(0, 'rgba(11, 22, 34, 0.94)');
      fade.addColorStop(0.55, 'rgba(11, 22, 34, 0.7)');
      fade.addColorStop(1, 'rgba(11, 22, 34, 0)');
      g.fillStyle = fade;
      g.fillRect(0, 0, 1024, 500);
      // 로고 (지름 190) + 글자
      g.drawImage(lg, 54, 70, 190, 190);
      g.shadowColor = 'rgba(34, 211, 238, 0.6)';
      g.shadowBlur = 18;
      g.fillStyle = '#ecfeff';
      g.font = '800 92px UI';
      g.textBaseline = 'alphabetic';
      if ('letterSpacing' in g)
        (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '22px';
      g.fillText('DECOY', 54, 368);
      g.shadowBlur = 0;
      g.fillStyle = '#94a3b8';
      g.font = '500 26px UI';
      if ('letterSpacing' in g)
        (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '2px';
      g.fillText('생존자 3 vs 괴물 1 · 비대칭 탈출', 58, 418);
      // 알파 없는 PNG가 되게 (모든 화소 불투명)
      const d = g.getImageData(0, 0, 1024, 500);
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png').slice('data:image/png;base64,'.length);
    },
    { src: shot.toString('base64'), svg: logo, font: fontFile },
  );
  await composer.close();
  await save(page, 'feature-graphic.png', 'feature', Buffer.from(b64, 'base64'));
  await tab.close();
});

test('콘솔 문제 없음', () => {
  expect(problems).toEqual([]);
});
