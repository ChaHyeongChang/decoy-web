// 적응형 품질의 목표 FPS 낮추기 · 되돌리기 (렌더링 최적화, gfx/quality.ts AutoDowngrade · gfx/framePacing.ts Pacer · main.ts):
// 헤드리스 크롬은 화면 갱신이 60Hz로 묶여 있어 rAF를 120Hz로 직접 돌려 120Hz 화면을 흉내 낸다(주사율 재기가 120을 본다).
//  - 프레임 제한 '자동' · 120Hz 화면에서 판 중 FPS가 PC 기준(목표 120의 2/3 = 80) 아래로 이어지면 품질은 그대로 두고 목표를 60으로
//    낮춘다(rateDown, downgrades +1). 제한기가 실제로 그리는 프레임을 초당 약 60으로 줄이고 건너뛴 rAF를 센다
//  - 여유(FPS ≥ 목표의 95% · 작업 p95 ≤ 120Hz 예산의 절반)가 이어지면 목표를 화면 주사율로 되돌린다(rateUp, upgrades +1).
//    되돌린 뒤 확인(10초)을 통과하면 감시(on)로 돌아가고 목표는 그대로, 그 사이 건너뛰는 rAF가 없다
//  - 고정 제한 120은 목표를 바꾸지 않는다(품질만 내린다 — 품질 낮음이라 더 내릴 단계가 없다)
// 품질은 ?quality=low로 고정해(가장 낮은 단계) 품질 단계 변화 없이 목표 FPS만 본다
import { expect, test, type Page } from '@playwright/test';
import { BASE_QUERY, newPlayerPage, press } from './helpers';

/**
 * 페이지 안: rAF를 120Hz로 돌린다 (setTimeout으로 마감 1.5ms 앞까지, 그다음 MessageChannel로 마감을 맞춘다).
 * 콜백 시각은 실제 브라우저처럼 그 프레임의 vsync 시각(격자 위, 지금 이하의 마지막 칸)이다 — 깨어난 실제 시각을 주면 늦게 깬
 * 프레임 다음의 간격이 8.33ms보다 짧아져(바쁜 CI 러너에서 7.5ms) 화면 주사율을 133Hz로 잘못 잰다
 */
function pump120(): void {
  const period = 1000 / 120;
  const queue: FrameRequestCallback[] = [];
  const mc = new MessageChannel();
  let scheduled = false;
  let next = performance.now() + period;
  let id = 0;
  const fire = (): void => {
    scheduled = false;
    const t = performance.now();
    // 실제 화면처럼 vsync 격자에 맞춘다: 이 프레임의 시각은 지금 이하의 마지막 칸, 다음 마감은 그다음 칸 (늦은 만큼 밀지 않는다)
    let due = next;
    while (due + period <= t) due += period;
    next = due + period;
    for (const cb of queue.splice(0)) cb(due);
  };
  const spin = (): void => {
    if (performance.now() >= next) fire();
    else mc.port2.postMessage(0);
  };
  mc.port1.onmessage = spin;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queue.push(cb);
    if (!scheduled) {
      scheduled = true;
      const wait = next - performance.now();
      if (wait > 2) window.setTimeout(spin, wait - 1.5);
      else spin();
    }
    id += 1;
    return id;
  };
  window.cancelAnimationFrame = (): void => undefined;
}

type Gfx = {
  targetHz: number;
  displayHz: number;
  downgrades: number;
  upgrades: number;
  quality: string;
  frameLimit: string;
  adapt: string;
};

async function gfx(page: Page): Promise<Gfx> {
  return page.evaluate(() => {
    const g = window.__DECOY__?.gfx;
    if (!g) throw new Error('디버그 훅이 없다');
    return {
      targetHz: g.targetHz,
      displayHz: g.displayHz,
      downgrades: g.downgrades,
      upgrades: g.upgrades,
      quality: g.quality,
      frameLimit: g.frameLimit,
      adapt: String(g.features.autoDowngrade ?? '-'),
    };
  });
}

/** 판에서 1초 동안 그린 프레임 수 · 건너뛴 rAF 수 (injectFps를 끈 실제 측정) */
async function oneSecond(page: Page): Promise<{ fps: number; skippedPerSec: number }> {
  const a = await page.evaluate(() => ({
    s: window.__DECOY__?.getFrameStats()?.skipped ?? 0,
    t: performance.now(),
  }));
  await page.waitForTimeout(1000);
  const b = await page.evaluate(() => ({
    s: window.__DECOY__?.getFrameStats()?.skipped ?? 0,
    fps: window.__DECOY__?.getFrameStats()?.fps ?? 0,
    t: performance.now(),
  }));
  return { fps: b.fps, skippedPerSec: ((b.s - a.s) * 1000) / (b.t - a.t) };
}

async function startPractice(page: Page, query: string): Promise<void> {
  await page.goto(`/?${BASE_QUERY.slice(1)}&quality=low${query}`);
  await press(page.getByTestId('practice'));
  await press(page.getByTestId('practice-role-runner'));
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot() ?? null) !== null, null, {
    timeout: 30_000,
  });
  // 봇을 모두 묶는다(기기 안 테스트 훅 freeze — 묶인 봇은 움직이지 못하고 괴물 봇은 공격 · 돌진 · 포효를 하지 않는다):
  // 사람(러너)이 가만히 있으면 연습 괴물 봇이 1분 안팎에 이겨 판이 끝나고, 판이 끝나면 판 중 측정이 멈춘다. 첫 시험은 판
  // 시작부터 약 70초가 필요하다(하향 16초 · 조용한 20초 · 여유 15초 · 올린 뒤 확인 13초). 묶어도 그리기 · 측정 경로는 같다
  // (FPS는 injectFps로 준다)
  await expect
    .poll(() => page.evaluate(() => (window.__DECOY__?.getTruth()?.players ?? []).length), { timeout: 5_000 })
    .toBe(4);
  const bots = (): Promise<string> =>
    page.evaluate(() => {
      const d = window.__DECOY__;
      return (d?.getTruth()?.players ?? [])
        .filter((p) => p.id !== d?.you)
        .map((p) => `${p.id}:${p.x.toFixed(3)},${p.y.toFixed(3)}`)
        .join(' ');
    });
  await page.evaluate(() => {
    const d = window.__DECOY__;
    for (const p of d?.getTruth()?.players ?? [])
      if (p.id !== d?.you) d?.sendTest({ kind: 'freeze', target: p.id, frozen: true });
  });
  // 묶였는지: 봇 자리가 1초 동안 그대로다
  await page.waitForTimeout(200);
  const held = await bots();
  await page.waitForTimeout(1000);
  expect(await bots()).toBe(held);
}

test('자동 제한 · 120Hz 화면: 느리면 목표를 60으로(제한기가 실제로 반만 그림), 여유가 이어지면 120으로 되돌린다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { context, page, problems } = await newPlayerPage(browser);
  await context.addInitScript(pump120);
  await startPractice(page, '');
  await expect.poll(async () => (await gfx(page)).displayHz, { timeout: 10_000 }).toBe(120);
  expect(await gfx(page)).toMatchObject({ targetHz: 120, frameLimit: 'auto', downgrades: 0, upgrades: 0 });

  // 느림: 70fps(< 80)가 예열 5초 + 10초 넘게 이어진다
  await page.evaluate(() => window.__DECOY__?.injectFps(70));
  await expect.poll(async () => (await gfx(page)).targetHz, { timeout: 30_000, intervals: [500] }).toBe(60);
  const down = await gfx(page);
  expect(down).toMatchObject({ quality: 'low', downgrades: 1, upgrades: 0, displayHz: 120 });

  // 제한기: 120Hz rAF 중 그리는 것은 초당 약 60, 나머지는 건너뛴다 (실제 측정 — 덮어쓰기를 끈다)
  await page.evaluate(() => window.__DECOY__?.injectFps(null));
  await page.waitForTimeout(1200);
  const capped = await oneSecond(page);
  expect(capped.fps).toBeGreaterThan(40);
  expect(capped.fps).toBeLessThan(66);
  expect(capped.skippedPerSec).toBeGreaterThan(30);

  // 여유: 250fps · 작업 4ms(≤ 120Hz 예산 8.33ms의 절반)가 마지막 변경 20초 뒤부터 15초 넘게 → 목표를 되돌린다
  await page.evaluate(() => window.__DECOY__?.injectFps(250));
  await expect.poll(async () => (await gfx(page)).targetHz, { timeout: 60_000, intervals: [1000] }).toBe(120);
  expect(await gfx(page)).toMatchObject({ quality: 'low', downgrades: 1, upgrades: 1, adapt: 'probation' });
  // 되돌린 뒤 확인(설정 3초 + 10초)을 통과하면(upKeep) 감시로 돌아가고 목표는 그대로
  await expect.poll(async () => (await gfx(page)).adapt, { timeout: 20_000, intervals: [1000] }).toBe('on');
  expect(await gfx(page)).toMatchObject({ targetHz: 120, downgrades: 1, upgrades: 1 });
  await page.evaluate(() => window.__DECOY__?.injectFps(null));
  await page.waitForTimeout(1200);
  const free = await oneSecond(page);
  // 목표 = 화면 주사율이면 제한기는 건너뛰지 않는다
  expect(free.skippedPerSec).toBeLessThan(5);
  expect(problems).toEqual([]);
  await context.close();
});

test('고정 제한 120: 느려도 목표 FPS는 그대로다 (품질만 조정 — 낮음이라 더 내릴 단계가 없다)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page, problems } = await newPlayerPage(browser);
  await context.addInitScript(pump120);
  await startPractice(page, '&fpsLimit=120');
  await expect.poll(async () => (await gfx(page)).displayHz, { timeout: 10_000 }).toBe(120);
  expect(await gfx(page)).toMatchObject({ targetHz: 120, frameLimit: '120' });
  await page.evaluate(() => window.__DECOY__?.injectFps(70));
  // 자동 제한이었다면 15초 남짓에 60으로 낮췄을 시간을 넉넉히 기다린다
  await page.waitForTimeout(20_000);
  expect(await gfx(page)).toMatchObject({ targetHz: 120, frameLimit: '120', downgrades: 0, quality: 'low' });
  expect(problems).toEqual([]);
  await context.close();
});
