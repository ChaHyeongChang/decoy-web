// M10a 안개 방식 (Canvas 렌더러 · 품질 낮음 · 1920×1080 배율 1): 맵 구조는 시야 밖에서도 어둡게 보이고,
// 시야 안은 2.5배 이상 밝다. 시야 밖 상대는 픽셀로도 없고(서버가 안 보냄), 상대가 사라지면 상대 효과도 바로 없어진다.
// 화면 픽셀은 스크린샷을 페이지 안에서 디코드해 tileToClient 좌표 주변 9×9 평균으로 잰다.
import { expect, test, type Page } from '@playwright/test';
import { closeAll, lastSnapshot, sendTest, startFourPlayerMatch, type Player } from './helpers';

const QUALITY = '&quality=low';

interface Probe {
  rgb: [number, number, number];
  luma: number;
  /** 창 안 가장 밝은 픽셀 밝기 */
  maxLuma: number;
}

/** 스크린샷을 찍어 타일 좌표 주변 (2·half+1)² 픽셀의 평균 색과 밝기를 잰다 */
async function probe(
  page: Page,
  tiles: Record<string, [number, number]>,
  half = 4,
): Promise<Record<string, Probe>> {
  const shot = await page.screenshot();
  return page.evaluate(
    async ({ b64, tiles, half }) => {
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
      const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const out: Record<string, { rgb: [number, number, number]; luma: number; maxLuma: number }> = {};
      for (const [name, [tx, ty]] of Object.entries(tiles)) {
        const p = window.__DECOY__?.tileToClient(tx, ty);
        if (!p) throw new Error('tileToClient 없음');
        const cx = Math.round(p.x);
        const cy = Math.round(p.y);
        let r = 0;
        let g = 0;
        let bl = 0;
        let n = 0;
        let max = 0;
        for (let y = cy - half; y <= cy + half; y += 1) {
          for (let x = cx - half; x <= cx + half; x += 1) {
            const i = (y * c.width + x) * 4;
            const pr = data[i] ?? 0;
            const pg = data[i + 1] ?? 0;
            const pb = data[i + 2] ?? 0;
            r += pr;
            g += pg;
            bl += pb;
            n += 1;
            max = Math.max(max, luma(pr, pg, pb));
          }
        }
        out[name] = {
          rgb: [Math.round(r / n), Math.round(g / n), Math.round(bl / n)],
          luma: Math.round(luma(r / n, g / n, bl / n) * 10) / 10,
          maxLuma: Math.round(max),
        };
      }
      return out;
    },
    { b64: shot.toString('base64'), tiles, half },
  );
}

/** 조작 안내 · 시작 문구가 사라지고 장식 시계를 멈춘다 */
async function settle(p: Player): Promise<void> {
  await p.page.setViewportSize({ width: 1920, height: 1080 });
  await p.page.keyboard.press('KeyX');
  await p.page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await p.page.evaluate(() => window.__DECOY__?.freezeClock(1000));
}

/** 괴물 조준을 타일 좌표 쪽으로 (괴물 화면은 커서 방향을 본다) */
async function aimAt(page: Page, x: number, y: number): Promise<void> {
  const c = await page.evaluate(([tx, ty]) => window.__DECOY__?.tileToClient(tx!, ty!) ?? null, [x, y]);
  await page.mouse.move(c!.x, c!.y);
}

// 탐침 위치 (shared/src/map.ts MAP_ROWS 기준, 거점 · 탈출구 · 배지 · 배너에서 떨어진 곳)
const P_FLOOR: [number, number] = [21.5, 27.5]; // 바닥 칸
const P_WALL: [number, number] = [17.5, 27.5]; // 벽 덩어리 한가운데 (16~19 × 26~28)
const M_SPOT: [number, number] = [38.5, 29.5]; // 숨은 괴물 자리 (바닥)
const S_SPOT: [number, number] = [31, 30]; // 괴물 등 뒤 생존자 자리 (바닥)

test('맵 구조는 시야 밖에서도 어둡게 보이고 시야 안은 2.5배 이상 밝다, 숨은 상대는 픽셀로도 없다', async ({
  browser,
}) => {
  const { players } = await startFourPlayerMatch(browser, undefined, [QUALITY, QUALITY, QUALITY, QUALITY]);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  const host = monster.page;
  // 배치: 스카우트 북동쪽 끝, 가드는 괴물 등 뒤 7.5타일(가드 시야 6 밖, 괴물 부채꼴 밖), 괴물은 동쪽을 봄
  await sendTest(host, { kind: 'teleport', target: scout.id, x: 45, y: 2 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: S_SPOT[0], y: S_SPOT[1] });
  await sendTest(host, { kind: 'teleport', target: monster.id, x: M_SPOT[0], y: M_SPOT[1], face: 0 });
  // 러너는 탐침 바닥 칸에서 2.5타일 (시야 6 − 흐림 1.2 안쪽 = 완전히 밝음)
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 21.5, y: 25 });
  for (const p of [scout, guard, monster, runner])
    await sendTest(host, { kind: 'freeze', target: p.id, frozen: true });
  await settle(runner);
  await settle(monster);
  await aimAt(host, M_SPOT[0] + 4, M_SPOT[1]);
  await runner.page.waitForTimeout(800);

  // 1) 같은 바닥 칸을 시야 안에서
  const lit = await probe(runner.page, { floor: P_FLOOR });
  // 2) 러너를 멀리 보내 같은 칸을 시야 밖에서 + 시야 밖 벽 · 숨은 괴물 자리
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 5, y: 2 });
  await runner.page.waitForTimeout(800);
  expect((await lastSnapshot(runner.page))!.monster).toBeNull();
  expect(
    (await runner.page.evaluate(() => window.__DECOY__?.getDrawn() ?? [])).some((d) => d.kind === 'monster'),
  ).toBe(false);
  const dark = await probe(runner.page, { floor: P_FLOOR, wall: P_WALL, hidden: M_SPOT });
  console.log(
    `[m10-fog] 러너 화면 밝기: 시야 안 바닥 ${lit.floor!.luma}, 시야 밖 바닥 ${dark.floor!.luma} · 벽 ${dark.wall!.luma} · 숨은 괴물 자리 ${dark.hidden!.luma} rgb ${dark.hidden!.rgb.join(',')}`,
  );
  // 구조가 보인다 (지금까지는 0 = 완전한 검정)
  expect(dark.floor!.luma).toBeGreaterThanOrEqual(6);
  // 시야 안은 시야 밖의 2.5배 이상
  expect(lit.floor!.luma).toBeGreaterThanOrEqual(dark.floor!.luma * 2.5);
  // 시야 밖에서도 벽과 바닥이 구분된다
  expect(Math.abs(dark.wall!.luma - dark.floor!.luma)).toBeGreaterThanOrEqual(5);

  // 3) 숨은 괴물 자리 = 같은 자리 빈 바닥 (괴물을 멀리 보낸 장면)과 채널마다 ±4, 그리고 구조가 보이는 밝기
  expect(dark.hidden!.luma).toBeGreaterThanOrEqual(6);
  // 괴물 화면: 등 뒤 생존자(가드) 자리에 흰 픽셀 없음, 메인 · 미니맵 목록에도 없음
  const mon = await probe(host, { behind: S_SPOT }, 12);
  console.log(`[m10-fog] 괴물 화면 등 뒤 생존자 자리 평균 ${mon.behind!.luma}, 최대 ${mon.behind!.maxLuma}`);
  expect(mon.behind!.maxLuma).toBeLessThanOrEqual(200);
  expect(mon.behind!.luma).toBeGreaterThanOrEqual(6);
  expect((await lastSnapshot(host))!.survivors.length).toBe(0);
  const monDrawn = await host.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const monMini = await host.evaluate(() => window.__DECOY__?.getDrawnMinimap() ?? []);
  expect(monDrawn.some((d) => d.kind === 'survivor')).toBe(false);
  expect(monMini.some((d) => d.kind === 'survivor')).toBe(false);

  await sendTest(host, { kind: 'teleport', target: monster.id, x: 44.5, y: 12.5, face: 0 });
  await runner.page.waitForTimeout(800);
  const empty = await probe(runner.page, { hidden: M_SPOT });
  for (let ch = 0; ch < 3; ch += 1)
    expect(Math.abs(empty.hidden!.rgb[ch]! - dark.hidden!.rgb[ch]!)).toBeLessThanOrEqual(4);

  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

test('생존자 시야 안에서 괴물이 돌진해 시야 밖으로 나가면 다음 프레임에 상대 효과(돌진 잔상)가 0', async ({
  browser,
}) => {
  const { players } = await startFourPlayerMatch(browser, undefined, [QUALITY, QUALITY, QUALITY, QUALITY]);
  const monster = players.find((p) => p.role === 'monster')!;
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  const host = monster.page;
  for (const p of players) await p.page.keyboard.press('KeyX');
  // 러너 (16.9, 2), 괴물은 동쪽으로 2.5타일 → 돌진 4타일이면 6.5타일(러너 시야 6 밖). 다른 생존자는 멀리
  await sendTest(host, { kind: 'teleport', target: scout.id, x: 45, y: 2 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 31, y: 30 });
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 16.9, y: 2 });
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 19.4, y: 2, face: 0 });
  await aimAt(host, 30, 2);
  await runner.page.waitForFunction(
    () => (window.__DECOY__?.getLastSnapshot()?.monster ?? null) !== null,
    null,
    {
      timeout: 10_000,
    },
  );
  await host.waitForTimeout(600);

  // 러너 화면에서 프레임마다: 괴물이 보이는 동안 잔상을 보고, 스냅샷에서 괴물이 빠진 뒤 다음 프레임 효과를 읽는다
  const watch = runner.page.evaluate(
    () =>
      new Promise<{ sawGhosts: boolean; fx: Record<string, number | boolean> | null; timedOut: boolean }>(
        (resolve) => {
          const start = performance.now();
          let sawGhosts = false;
          let goneFrames = -1;
          const loop = (): void => {
            const d = window.__DECOY__;
            const snap = d?.getLastSnapshot();
            const fx = d?.getEffects() ?? {};
            if (snap?.monster && typeof fx.dashGhosts === 'number' && fx.dashGhosts > 0) sawGhosts = true;
            if (goneFrames < 0 && sawGhosts && snap && snap.monster === null) goneFrames = 0;
            else if (goneFrames >= 0) goneFrames += 1;
            // 스냅샷이 바뀐 프레임에 그림이 이미 그려졌는지 모르므로 그다음 프레임에 읽는다
            if (goneFrames >= 2) {
              resolve({ sawGhosts, fx, timedOut: false });
              return;
            }
            if (performance.now() - start > 8000) {
              resolve({ sawGhosts, fx: null, timedOut: true });
              return;
            }
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        },
      ),
  );
  await host.keyboard.press('Shift');
  const res = await watch;
  console.log(`[m10-fog] 돌진 뒤: ${JSON.stringify(res)}`);
  expect(res.timedOut).toBe(false);
  // 빈 통과가 아님: 괴물이 보이는 동안에는 잔상이 실제로 그려졌다
  expect(res.sawGhosts).toBe(true);
  expect(res.fx!.dashGhosts).toBe(0);
  expect(res.fx!.oppFx).toBe(0);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});
