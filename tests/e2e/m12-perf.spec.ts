// M12 성능 (MOBILE_PLAN M12 6번 · 자동 검증 'E2E m12-lifecycle'의 성능 줄): 휴대폰 가로 컨텍스트(Canvas 렌더러 · 소프트웨어 합성)에서
//  - 판 중 하향: 터치 기준(50fps)으로 한 단계 내린다(PC 기준 40에서는 내리지 않을 45fps). 같은 연결 · 입력 seq 끊김 없음.
//    주소의 ?quality로 정한 단계는 다음 접속용으로 기억하지 않는다
//  - 터치 기기 자동 선택: Canvas 렌더러 → 낮음, 터치 낮음 해상도(1.25배 · 백버퍼 높이 하한 450)가 계산값과 같다. PC는 M10 그대로
//  - CPU 4배 느리게(CDP) 한 품질별 FPS: 기록만 (CI 러너 편차가 커서 게이트로 쓰지 않는다)
// WebGL(하드웨어 GPU로 보이게 한 휴대폰)의 자동 중간 → 기억 → 다음 접속은 m12-perf.webgl.spec.ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { GfxDebugInfo } from '@decoy/shared';
import { effectivePreset, type QualityTier } from '../../client/src/gfx/presets';
import { DOWNGRADE_CHECK, FPS_WATCH, TOUCH_FPS_WATCH } from '../../client/src/gfx/quality';
import { computeRenderSize } from '../../client/src/render/resolution';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import {
  PHONE_LANDSCAPE,
  createRoom,
  dpr1,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  recordInputs,
  waitForSnapshots,
  type DeviceOptions,
} from './helpers';

/** 간격 폴링 (느린 CI에서 rAF 폴링을 피한다) */
const POLL = { polling: 200 } as const;

/** 터치 기기에서 탭이 부르는 전체 화면을 흉내만 낸다 (헤드리스에서 창 크기가 바뀌지 않게) */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

async function gfx(page: Page): Promise<GfxDebugInfo> {
  return page.evaluate(() => {
    const g = window.__DECOY__?.gfx;
    if (!g) throw new Error('디버그 훅이 없다');
    return JSON.parse(JSON.stringify(g)) as GfxDebugInfo;
  });
}

/** 혼자 봇 방에서 러너로 판을 시작한다 (터치 기기는 탭으로) */
async function soloMatch(browser: Browser, device: DeviceOptions, query = '') {
  const p = await newPlayerPage(browser, device);
  await p.context.addInitScript(stubFullscreen);
  let sockets = 0;
  p.page.on('websocket', () => {
    sockets += 1;
  });
  await createRoom(p.page, `&bots=1${query}`);
  await pickRoleAndReady(p.page, 'runner');
  await press(p.page.getByTestId('start-button'));
  await waitForSnapshots(p.page, 3);
  // 판 배치를 적용한 뒤에 읽는다 (판 장면이 HUD 배치를 만든 뒤)
  await p.page.waitForFunction(() => (window.__DECOY__?.getHudLayout() ?? null) !== null, null, {
    polling: 100,
    timeout: 20_000,
  });
  return { ...p, sockets: () => sockets };
}

test('휴대폰: 판 중 평균 45fps면 터치 기준(50)으로 한 단계 내린다 — 같은 연결, 입력 seq 끊김 없음', async ({
  browser,
}) => {
  const s = await soloMatch(browser, dpr1(PHONE_LANDSCAPE), '&quality=medium');
  const { page } = s;
  let g = await gfx(page);
  expect(g.touch).toBe(true);
  expect([g.quality, g.qualitySource, g.downgrades]).toEqual(['medium', 'url', 0]);
  expect(g.features.autoMinFps).toBe(TOUCH_FPS_WATCH.minFps);
  expect(g.features.autoDowngrade).toBe('on');
  const you = await myId(page);
  const snapsBefore = await page.evaluate(() => window.__DECOY__?.snapCount ?? 0);
  const ackBefore = await page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.ack ?? -1);
  const rec = await recordInputs(page);

  // PC 기준(40)보다 높고 터치 기준(50)보다 낮다
  await page.evaluate(() => window.__DECOY__?.injectFps(45));
  const injectedAt = Date.now();
  await page.waitForFunction(() => (window.__DECOY__?.gfx.downgrades ?? 0) >= 1, null, {
    ...POLL,
    timeout: TOUCH_FPS_WATCH.warmupMs + TOUCH_FPS_WATCH.sustainMs + 15_000,
  });
  console.log(`[m12-perf] FPS 45 주입 뒤 ${((Date.now() - injectedAt) / 1000).toFixed(1)}초에 중간 → 낮음`);
  g = await gfx(page);
  expect([g.quality, g.qualitySource, g.downgrades]).toEqual(['low', 'url', 1]);
  expect(g.measuredFps).toBeLessThan(TOUCH_FPS_WATCH.minFps);
  expect(g.measuredFps).toBeGreaterThan(FPS_WATCH.minFps);
  expect(g.features.autoDowngrade).toBe('checking');
  // 터치 낮음: 백버퍼 높이 하한이 걸린 설정
  expect(g.features.dprCap).toBe(1.25);
  expect(g.features.minBackingH).toBe(450);

  // 내린 뒤 FPS가 오른다(60): 확인 뒤 낮음 유지. 주소의 ?quality로 정한 단계라 다음 접속용으로 기억하지 않는다
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await page.waitForFunction(() => window.__DECOY__?.gfx.features.autoDowngrade === 'on', null, {
    ...POLL,
    timeout: DOWNGRADE_CHECK.settleMs + DOWNGRADE_CHECK.measureMs + 15_000,
  });
  g = await gfx(page);
  expect([g.quality, g.downgrades]).toEqual(['low', 1]);
  expect(g.features.perfSaved).toBeUndefined();
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEYS.perf.key)).toBeNull();

  // 같은 사람 · 같은 연결 · 같은 판: 입력 프레임 seq가 하나도 빠지지 않고 이어지며 서버가 계속 확인한다
  const frames = await rec.stop();
  expect(frames.length).toBeGreaterThan(30 * 20);
  const gaps = frames.slice(1).filter((f, i) => f.seq !== (frames[i]?.seq ?? -1) + 1);
  expect(gaps, '입력 seq 끊김').toEqual([]);
  expect(await myId(page)).toBe(you);
  expect(await page.evaluate(() => window.__DECOY__?.phase ?? null)).toBe('playing');
  expect(await page.evaluate(() => window.__DECOY__?.snapCount ?? 0)).toBeGreaterThan(snapsBefore + 300);
  expect(await page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.ack ?? -1)).toBeGreaterThan(
    ackBefore + 300,
  );
  expect(s.sockets()).toBe(1);
  await page.evaluate(() => window.__DECOY__?.injectFps(null));
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('터치 기기 자동 선택: Canvas → 낮음, 터치 낮음 해상도(1.25배 · 높이 하한 450)가 계산값과 같다. PC는 M10 그대로', async ({
  browser,
}) => {
  const phone = await soloMatch(browser, PHONE_LANDSCAPE);
  const g = await gfx(phone.page);
  expect(g.touch).toBe(true);
  // 판 배치를 적용한 뒤 값이다 (PC 배치에서 읽으면 아래 해상도 대조가 다른 크기로 맞을 수 있다)
  expect(g.layout).toMatch(/^touch/);
  expect([g.renderer, g.quality, g.qualitySource]).toEqual(['canvas', 'low', 'auto']);
  expect(g.features.perfTier).toBe('none');
  expect(g.features.autoMinFps).toBe(TOUCH_FPS_WATCH.minFps);
  expect([g.features.dprCap, g.features.minBackingH, g.features.floorDprCap]).toEqual([1.25, 450, 1.5]);
  const root = await phone.page.evaluate(() => {
    const r = (document.getElementById('game-root') ?? document.body).getBoundingClientRect();
    return { w: r.width, h: r.height, dpr: window.devicePixelRatio };
  });
  const want = computeRenderSize({
    cssW: root.w,
    cssH: root.h,
    dpr: root.dpr,
    logicalW: g.viewW,
    logicalH: g.viewH,
    preset: effectivePreset('low', 'canvas', true),
    scaleOverride: null,
  });
  expect([g.backingW, g.backingH]).toEqual([want.backingW, want.backingH]);
  // 이 휴대폰(높이 412 @2.625)은 하한(450) 위라 1.25배
  expect(want.k).toBeCloseTo(1.25, 6);
  expect(g.backingH).toBeGreaterThanOrEqual(450);
  console.log(
    `[m12-perf] Pixel 7 915×412 @2.625 터치 낮음: 표시 ${g.cssW}×${g.cssH} → 백버퍼 ${g.backingW}×${g.backingH} (배율 ${want.k})`,
  );
  expect(phone.problems).toEqual([]);
  await phone.context.close();

  // PC: 기준 40fps, 낮음은 1배, 기억 없음
  const pc = await newPlayerPage(browser);
  await createRoom(pc.page);
  const p = await gfx(pc.page);
  expect(p.touch).toBe(false);
  expect([p.quality, p.qualitySource]).toEqual(['low', 'auto']);
  expect(p.features.autoMinFps).toBe(FPS_WATCH.minFps);
  expect([p.features.dprCap, p.features.minBackingH]).toEqual([1, 0]);
  expect(p.features.perfTier).toBe('none');
  expect(pc.problems).toEqual([]);
  await pc.context.close();
});

test('CPU 4배 느리게 한 휴대폰의 품질별 FPS (기록만)', async ({ browser }) => {
  const rows: string[] = [];
  for (const tier of ['high', 'medium', 'low'] as const satisfies readonly QualityTier[]) {
    const s = await soloMatch(browser, PHONE_LANDSCAPE, `&quality=${tier}`);
    const { page } = s;
    // 측정 중 자동 하향이 끼지 않게
    await page.evaluate(() => window.__DECOY__?.injectFps(60));
    await page.waitForTimeout(3000);
    const cdp = await s.context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const m = await page.evaluate(
      () =>
        new Promise<{ fps: number; p95: number }>((resolve) => {
          const gaps: number[] = [];
          let last = performance.now();
          const end = last + 4000;
          const step = (t: number): void => {
            gaps.push(t - last);
            last = t;
            if (t < end) requestAnimationFrame(step);
            else {
              gaps.sort((a, b) => a - b);
              const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
              resolve({ fps: 1000 / avg, p95: gaps[Math.floor(gaps.length * 0.95)] ?? 0 });
            }
          };
          requestAnimationFrame(step);
        }),
    );
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const g = await gfx(page);
    const mib = (n: unknown): string => (Number(n ?? 0) / 1048576).toFixed(2);
    rows.push(
      `${tier} | ${m.fps.toFixed(1)}fps | p95 ${m.p95.toFixed(0)}ms | 백버퍼 ${g.backingW}×${g.backingH} | 안개 ${g.fogMode} 합성 ${g.features.fogCommitMs}ms | 텍스처 ${mib(g.features.textureBytes)}MiB`,
    );
    expect(m.fps).toBeGreaterThan(0);
    expect(g.downgrades).toBe(0);
    expect(s.problems).toEqual([]);
    await s.context.close();
  }
  console.log(
    `[m12-perf] Pixel 7 915×412 @2.625 · Canvas 렌더러 · 소프트웨어 합성 · CPU 4배 (기록만)\n${rows.join('\n')}`,
  );
});
