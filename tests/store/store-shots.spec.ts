// 스토어 그림 촬영 (M15, docs/MOBILE_PLAN.md M15 3번 · docs/STORE_LISTING.md 3장). npm run shots:store
//  - 휴대폰 가로 스크린샷 5장: 640×360 휴대폰(터치 · 기기 배율 3 → 1920×1080 PNG), 품질 높음 · WebGL, 터치 조작 UI가 보이게
//      phone-1-lobby (로비: 봇과 연습 역할 고르기 — 정면 캐릭터 넷) · phone-2-monster (괴물 화면) · phone-3-survivor (생존자: 점령 중 발각) ·
//      phone-4-rescue (감옥 구조) · phone-5-result (결과: 생존자 승리)
//  - 그래픽 이미지 feature-graphic.png 1024×500: 생존자 화면(PC, 배율 2)의 가운데를 잘라 왼쪽에 로고 + DECOY,
//    오른쪽에 같은 게임의 로비 역할 카드 정면 캐릭터 넷(그 화면의 SVG 그대로)을 얹는다
//  - 캐릭터 스타일은 '새 캐릭터'(?chars=new — 설정 화면 통합부터 게임 기본값도 새 캐릭터다. 기기에 남은 저장값과 상관없이 같게 찍으려고 주소에 적는다)
//  - artifacts/store/manifest.json: 장면 · 크기 · 찍는 순간의 터치 대상 · 그래픽 상태 · 콘솔 문제 (tests/unit/store-images.test.ts가 읽는다)
//  - 모든 그림은 알파 없는 24비트 RGB PNG(색 형식 2)로 저장한다: 플레이 그래픽 이미지 · 스크린샷 조건 (canvas는 RGBA로 내보낸다)
// 장면은 사람 탭 하나 + 서버 봇 셋(테스트 훅으로 자리 · 멈춤)으로 만든다. 판정은 서버가 하고, 화면은 실제 게임 그대로다
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { RESCUE_POINT, type Role, type TestCommand } from '@decoy/shared';
import { watchConsole } from '../e2e/helpers';
import { MultiTouch } from '../e2e/touch';
import { toRgbPng } from '../helpers/png';

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
const QUERY = 'debug=hook&renderer=webgl&quality=high&chars=new';
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
  /** 캐릭터 스타일 (새 캐릭터로 찍는다) */
  charStyle: string | null;
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

/** 방을 만들고 role을 고른다 (방장 = 나, 시작 전 방 화면) */
async function openRoom(page: Page, role: Role): Promise<string> {
  await page.goto(`/?${QUERY}&bots=1`);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(page, 'create-room');
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.getByTestId('room-code').textContent()) ?? '';
  await press(page, `role-${role}`);
  await expect(page.getByTestId(`role-${role}`)).toHaveClass(/mine/);
  return code;
}

/** 방 화면 역할 카드의 그림 SVG (역할 → outerHTML, 그 화면에 그려진 그대로) */
async function roleFigures(page: Page): Promise<Record<Role, string>> {
  const out = await page.evaluate(() => {
    const r: Record<string, string> = {};
    for (const role of ['monster', 'runner', 'guard', 'scout'])
      r[role] = document.querySelector(`[data-testid="role-${role}"] .rc-figure > svg`)?.outerHTML ?? '';
    return r;
  });
  for (const [role, svg] of Object.entries(out)) if (!svg) throw new Error(`역할 카드 그림 없음: ${role}`);
  return out as Record<Role, string>;
}

/** 봇 셋과 방을 만들어 role로 시작한다 (방장 = 나). inRoom = 시작 전 방 화면에서 할 일 */
async function soloMatch(
  page: Page,
  role: Role,
  inRoom?: (page: Page) => Promise<void>,
): Promise<{ code: string; you: string }> {
  const code = await openRoom(page, role);
  if (inRoom) await inRoom(page);
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
      charStyle: d?.gfx.charStyle ?? null,
    };
  });
  // 알파 없는 RGB로 (이미 RGB면 그대로, 투명한 화소가 있으면 멈춘다)
  const png = toRgbPng(buf ?? (await page.screenshot()));
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

test('로비 봇과 연습 역할 고르기: 새 캐릭터 정면 넷', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '로비');
  const { page } = tab;
  // 방 화면은 초대 링크에 서버 주소(촬영 서버 localhost)가 찍히므로, 주소가 없는 연습 역할 고르기를 찍는다
  await page.goto(`/?${QUERY}`);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(page, 'practice');
  await expect(page.locator('.pr-figure > svg')).toHaveCount(4);
  await page.waitForTimeout(800);
  await save(page, 'phone-1-lobby.png', 'lobby');
  await tab.close();
});

test('괴물 화면: 추적 시야에 흰 생존자 둘, 포효 표시', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '괴물');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'monster');
  // 괴물은 거점 A 방 입구 동쪽에서 서쪽(방 안)을 추적 시야로 본다. 생존자 둘은 거점 A를 점령하는 중, 스카우트는 멀리.
  // 16:9 휴대폰에서는 엄지 버튼이 맵 오른쪽 아래를 덮으므로 장면을 왼쪽 방에 둔다
  await placeBots(page, code, [
    ['guard', 9.4, 16.3, 0.2],
    ['runner', 8.1, 17.5, -0.4],
    ['scout', 40, 16, 0],
  ]);
  await send(page, { kind: 'setPoint', point: 'A', progress: 0.35 });
  // 괴물 시작 지연(5초) 뒤에 움직일 수 있다
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
    timeout: 20_000,
  });
  // 터치 화면은 조준 스틱을 놓고 있으면 마지막 이동 스틱 방향을 조준한다(키보드 이동은 반영하지 않는다):
  // 이동 스틱을 서쪽으로 잠깐 끌어 조준을 서쪽으로 정하고 자리로 돌아온다
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
  await placeSelf(page, code, you, 14.6, 16.9, Math.PI);
  await expect
    .poll(async () => {
      const r = await page.request.get(`/test/state?room=${code}`);
      const t = (await r.json()) as { monster: { aim: number } | null };
      return Math.abs(Math.abs(t.monster?.aim ?? 0) - Math.PI);
    })
    // 추적 시야 반각(25°) 안: 아래에서 생존자 둘이 실제로 보이는지 다시 확인한다
    .toBeLessThan(0.2);
  await tapTarget(page, 'mode');
  await expect
    .poll(() => page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.you.mon?.mode))
    .toBe('hunt');
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.survivors.length ?? 0) >= 2, null, {
    timeout: 20_000,
  });
  // 처음 10초 위치 표시 · 시작 알림이 사라질 때까지
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  // 판 중간처럼: 남은 시간 8:42
  await send(page, { kind: 'setTime', timeLeft: 522.4 });
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(120);
  await page.keyboard.up('KeyQ');
  await steady(page);
  await save(page, 'phone-2-monster.png', 'monster');
  await tab.close();
});

test('생존자 화면: 거점 A 점령 중 괴물에게 발각', async ({ browser }) => {
  const tab = await openTab(browser, PHONE, '생존자');
  const { page } = tab;
  const { code, you } = await soloMatch(page, 'runner');
  // 괴물은 처음엔 등을 돌리고 있다가(발각 없음), 판 시작 안내 메모가 걷힌 뒤 러너 쪽으로 돌아선다 → 발각 배너가 막 뜬 순간을 찍는다
  await placeBots(page, code, [
    ['monster', 11.6, 17.2, 0],
    ['guard', 9.2, 14.6, 0.6],
    ['scout', 40, 16, 0],
  ]);
  await placeSelf(page, code, you, 8, 16.4, 0);
  await send(page, { kind: 'setPoint', point: 'A', progress: 0.42 });
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  await send(page, { kind: 'setTime', timeLeft: 548.4 });
  await page.evaluate((ms) => window.__DECOY__?.freezeClock(ms), CLOCK_MS);
  // 개발용 괴물 봇은 멈춰도 제자리에서 조준을 돌린다: 발각과 배너가 함께 보이는 순간 바로 찍는다
  await placeBots(page, code, [['monster', 11.6, 17.2, Math.PI - 0.15]]);
  await page.waitForFunction(
    () =>
      window.__DECOY__?.getLastSnapshot()?.you.surv?.spotted === true &&
      (window.__DECOY__?.getBanners() ?? []).some((t) => t.includes('발각')),
    null,
    { timeout: 20_000, polling: 'raf' },
  );
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
    // 괴물이 가드 시야 안에서 감옥 쪽으로 다가오는 중 (긴장감)
    ['monster', 26.3, 21.4, -2.3],
  ]);
  await placeSelf(page, code, you, RESCUE_POINT.x, RESCUE_POINT.y + 0.4, -Math.PI / 2);
  await send(page, { kind: 'setTime', timeLeft: 455.4 });
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
  // 결과: 생존자 셋 모두 탈출로 끝낸다 (생존자 승리 · 완전 탈출 — 결과 화면에 정면 캐릭터 셋).
  // 판 길이는 실제 판처럼 (시험 전용 elapsed)
  await send(page, { kind: 'setTime', timeLeft: 66.4, elapsed: 534 });
  for (const id of [runner.id, scout.id, you])
    await send(page, { kind: 'setSurvivor', target: id, status: 'escaped' });
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.emblem.survivors svg')).toHaveCount(3);
  await page.waitForTimeout(800);
  await save(page, 'phone-5-result.png', 'result');
  await tab.close();
});

test('그래픽 이미지 1024×500: 생존자 화면 + 새 캐릭터 정면 넷 + 로고 + DECOY', async ({ browser }) => {
  const tab = await openTab(browser, WIDE, '그래픽');
  const { page } = tab;
  let figs: Record<Role, string> | null = null;
  const { code, you } = await soloMatch(page, 'runner', async (p) => {
    figs = await roleFigures(p);
  });
  if (!figs) throw new Error('역할 카드 그림을 읽지 못함');
  // 거점 B 방 입구(맵 가운데 높이 — 카메라가 위아래로 막히지 않아 HUD가 잘라 낸 그림에 들어오지 않는다).
  // 러너가 동쪽을 보고, 가드 · 스카우트가 곁에, 괴물이 방 안에서 다가온다
  await placeBots(page, code, [
    ['guard', 36.3, 15.1, 0.5],
    ['scout', 34.1, 17.3, -0.3],
    ['monster', 39.4, 16.6, Math.PI],
  ]);
  const ME = { x: 35, y: 16.2 };
  await placeSelf(page, code, you, ME.x, ME.y, 0);
  await page.waitForTimeout(1000);
  const aim = await page.evaluate(() => window.__DECOY__?.tileToClient(41, 16.2) ?? null);
  if (!aim) throw new Error('tileToClient 없음');
  await page.mouse.move(aim.x, aim.y);
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.monster ?? null) !== null, null, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 30_000,
  });
  await send(page, { kind: 'setTime', timeLeft: 431.4 });
  await steady(page);
  // 내 캐릭터(화면 가운데)를 왼쪽 30%쯤에 두고 자른다 (오른쪽에 정면 캐릭터를 얹는다)
  const me = await page.evaluate(([x, y]) => window.__DECOY__?.tileToClient(x!, y!) ?? null, [ME.x, ME.y]);
  if (!me) throw new Error('tileToClient 없음');
  const crop = { w: 1024, h: 500 };
  const cx = Math.max(0, Math.min(WIDE.viewport!.width - crop.w, Math.round(me.x - crop.w * 0.42)));
  const cy = Math.max(0, Math.min(WIDE.viewport!.height - crop.h, Math.round(me.y - crop.h * 0.5)));
  const shot = await page.screenshot({ clip: { x: cx, y: cy, width: crop.w, height: crop.h } });
  const logo = readFileSync('client/public/logo.svg', 'utf8');
  // 합성: 2048×1000 잘라 낸 그림을 1024×500으로 줄이고 왼쪽을 어둡게 해 로고 · 글자를 얹고, 오른쪽에 정면 캐릭터 넷
  // (괴물은 뒤 · 크게, 생존자 셋은 앞)을 얹는다 (브라우저 canvas, 새 의존성 없음)
  const composer = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const cp = await composer.newPage();
  await cp.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0"></body>');
  const fontFile = readFileSync('client/public/fonts/noto-sans-kr-ui.woff2').toString('base64');
  const b64 = await cp.evaluate(
    async ({ src, svg, font, figures }) => {
      const face = new FontFace('UI', `url(data:font/woff2;base64,${font})`, { weight: '100 900' });
      await face.load();
      document.fonts.add(face);
      const load = async (url: string): Promise<HTMLImageElement> => {
        const im = new Image();
        im.src = url;
        await im.decode();
        return im;
      };
      const svgUrl = (text: string): string =>
        `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
      // 역할 카드 SVG는 viewBox만 있어 크기를 정해 그린다
      const sized = (text: string, px: number): string =>
        text.replace(/^<svg /, `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" `);
      const img = await load(`data:image/png;base64,${src}`);
      const lg = await load(svgUrl(svg));
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 500;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, 1024, 500);
      // 왼쪽 어둡게 (바탕색 #0B1622로), 오른쪽 캐릭터 뒤도 조금 어둡게
      const fade = g.createLinearGradient(0, 0, 1024, 0);
      fade.addColorStop(0, 'rgba(11, 22, 34, 0.94)');
      fade.addColorStop(0.36, 'rgba(11, 22, 34, 0.66)');
      fade.addColorStop(0.5, 'rgba(11, 22, 34, 0.18)');
      fade.addColorStop(0.62, 'rgba(11, 22, 34, 0.36)');
      fade.addColorStop(1, 'rgba(11, 22, 34, 0.62)');
      g.fillStyle = fade;
      g.fillRect(0, 0, 1024, 500);
      // 정면 캐릭터: 괴물(뒤, 크게) → 생존자 셋(앞)
      const place: [string, number, number, number][] = [
        ['monster', 838, 228, 330],
        ['scout', 600, 296, 236],
        ['guard', 718, 304, 246],
        ['runner', 842, 310, 236],
      ];
      for (const [role, x, y, size] of place) {
        const fig = await load(svgUrl(sized(figures[role] ?? '', size)));
        g.drawImage(fig, x - size / 2, y - size / 2, size, size);
      }
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
      // 모든 화소 불투명 (canvas는 RGBA PNG로 내보내므로 save가 알파를 버린 RGB로 다시 쓴다)
      const d = g.getImageData(0, 0, 1024, 500);
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png').slice('data:image/png;base64,'.length);
    },
    { src: shot.toString('base64'), svg: logo, font: fontFile, figures: figs as Record<string, string> },
  );
  await composer.close();
  await save(page, 'feature-graphic.png', 'feature', Buffer.from(b64, 'base64'));
  await tab.close();
});

test('콘솔 문제 없음', () => {
  expect(problems).toEqual([]);
});
