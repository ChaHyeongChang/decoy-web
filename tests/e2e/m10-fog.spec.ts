// M10a 안개 방식 (Canvas 렌더러 · 품질 낮음 · 1920×1080 배율 1): 맵 구조는 시야 밖에서도 어둡게 보이고,
// 시야 안은 2.5배 이상 밝다. 시야 반경 바로 밖은 시야 밖과 같은 밝기다. 시야 밖 상대는 픽셀로도 없고(서버가 안 보냄),
// 상대가 사라지면 상대 효과도 바로 없어지고 부채꼴 색 상태도 남지 않는다.
// 화면 픽셀은 스크린샷을 페이지 안에서 디코드해 tileToClient 좌표 주변 9×9 평균으로 잰다.
// 따라가는 카메라: 맵 곳곳의 고정 탐침을 한 화면에서 재므로 맵 전체 고정 화면(?cam=1)에서 돈다(안개 · 정보 차단은 카메라와
// 무관하다 — 서버가 보내지 않고, 그림은 같은 코드). 확대 화면의 숨은 상대 픽셀 · 텍스처 예산은 camera.spec.ts
import { expect, test, type Page } from '@playwright/test';
import {
  aimMonsterAt,
  CAM1,
  closeAll,
  lastSnapshot,
  sendTest,
  startFourPlayerMatch,
  type Player,
} from './helpers';

const QUALITY = `&quality=low${CAM1}`;

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

/** 괴물 조준을 타일 좌표 쪽으로 (괴물 화면은 커서 방향을 본다 — 서버 조준까지 확인, helpers.aimMonsterAt) */
const aimAt = aimMonsterAt;

// 탐침 위치 (shared/src/map.ts MAP_ROWS 기준, 거점 · 탈출구 · 배지 · 배너에서 떨어진 곳)
const P_FLOOR: [number, number] = [21.5, 27.5]; // 바닥 칸
const P_WALL: [number, number] = [17.5, 27.5]; // 벽 덩어리 한가운데 (16~19 × 26~28)
const M_SPOT: [number, number] = [38.5, 29.5]; // 숨은 괴물 자리 (바닥)
const S_SPOT: [number, number] = [31, 30]; // 괴물 등 뒤 생존자 자리 (바닥)
// 러너 (21.5, 25) 서쪽, 벽 없는 줄(25행 14~22 바닥): 시야 반경 6 바로 밖(r + 0.3)과 완전히 밝은 안쪽(r − 1.5)
const P_EDGE_OUT: [number, number] = [21.5 - 6.3, 25];
const P_EDGE_IN: [number, number] = [21.5 - 4.5, 25];
/** 텍스처 메모리 예산 (MOBILE_PLAN M10 검증: 낮음 8MB) */
const LOW_TEXTURE_BUDGET = 8 * 1024 * 1024;

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

  // 1) 같은 바닥 칸을 시야 안에서 (+ 시야 반경 바로 밖과 그 안쪽)
  const lit = await probe(runner.page, { floor: P_FLOOR, edgeOut: P_EDGE_OUT, edgeIn: P_EDGE_IN });
  // 2) 러너를 멀리 보내 같은 칸을 시야 밖에서 + 시야 밖 벽 · 숨은 괴물 자리
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 5, y: 2 });
  await runner.page.waitForTimeout(800);
  expect((await lastSnapshot(runner.page))!.monster).toBeNull();
  expect(
    (await runner.page.evaluate(() => window.__DECOY__?.getDrawn() ?? [])).some((d) => d.kind === 'monster'),
  ).toBe(false);
  const dark = await probe(runner.page, {
    floor: P_FLOOR,
    wall: P_WALL,
    hidden: M_SPOT,
    edgeOut: P_EDGE_OUT,
    edgeIn: P_EDGE_IN,
  });
  console.log(
    `[m10-fog] 러너 화면 밝기: 시야 안 바닥 ${lit.floor!.luma}, 시야 밖 바닥 ${dark.floor!.luma} · 벽 ${dark.wall!.luma} · 숨은 괴물 자리 ${dark.hidden!.luma} rgb ${dark.hidden!.rgb.join(',')}`,
  );
  // 구조가 보인다 (지금까지는 0 = 완전한 검정)
  expect(dark.floor!.luma).toBeGreaterThanOrEqual(6);
  // 시야 안은 시야 밖의 2.5배 이상
  expect(lit.floor!.luma).toBeGreaterThanOrEqual(dark.floor!.luma * 2.5);
  // 시야 밖에서도 벽과 바닥이 구분된다
  expect(Math.abs(dark.wall!.luma - dark.floor!.luma)).toBeGreaterThanOrEqual(5);
  // 밝게 그린 곳 ⊆ 판정 영역 (화면): 시야 반경 바로 밖(r + 0.3, 벽 없는 쪽)은 시야 밖에서 잰 같은 자리와 채널마다 ±4.
  // 빈 통과가 아님: 같은 방향 안쪽(r − 1.5)은 실제로 밝다 (그 방향이 벽에 막히지 않았다)
  console.log(
    `[m10-fog] 시야 경계: 반경 밖 ${lit.edgeOut!.luma} (시야 밖 ${dark.edgeOut!.luma}), 반경 안 ${lit.edgeIn!.luma} (시야 밖 ${dark.edgeIn!.luma})`,
  );
  for (let ch = 0; ch < 3; ch += 1)
    expect(Math.abs(lit.edgeOut!.rgb[ch]! - dark.edgeOut!.rgb[ch]!)).toBeLessThanOrEqual(4);
  expect(lit.edgeIn!.luma).toBeGreaterThanOrEqual(dark.edgeIn!.luma * 2);
  // 텍스처 메모리 (바닥 합성 + 미니맵, getImageData 사본 없음): 낮음 예산 이하
  const gfx = await runner.page.evaluate(() => window.__DECOY__!.gfx);
  const texBytes = Number(gfx.features.textureBytes ?? 0);
  console.log(`[m10-fog] 텍스처 바이트 (낮음 · Canvas · 1920×1080@1): ${texBytes}`);
  expect(gfx.quality).toBe('low');
  expect(texBytes).toBeGreaterThan(0);
  expect(texBytes).toBeLessThanOrEqual(LOW_TEXTURE_BUDGET);

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

test('생존자 시야 안에서 괴물이 돌진해 시야 밖으로 나가면 다음 프레임에 상대 효과(돌진 잔상)가 0, 부채꼴 색도 남지 않는다', async ({
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

  // 부채꼴 색 잔여 상태: 러너를 보는 괴물(빨강) → 팀 시야 밖 → 아무도 안 보며 다시 나타난 첫 프레임은 노랑(지금 상태)
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 20.4, y: 2, face: Math.PI });
  await aimAt(host, 10, 2);
  await runner.page.waitForFunction(
    () => {
      const fx = window.__DECOY__?.getEffects() ?? {};
      return (
        fx.cone === true && fx.coneRed === 1 && window.__DECOY__?.getLastSnapshot()?.monster?.seesSomeone
      );
    },
    null,
    { timeout: 10_000 },
  );
  const watchCone = runner.page.evaluate(
    () =>
      new Promise<{
        hiddenFrames: number;
        hiddenMaxRed: number;
        firstRed: number | null;
        sees: boolean | null;
        timedOut: boolean;
      }>((resolve) => {
        const start = performance.now();
        let hidden = false;
        let hiddenFrames = 0;
        let hiddenMaxRed = 0;
        const loop = (): void => {
          const d = window.__DECOY__;
          const fx = d?.getEffects() ?? {};
          if (fx.cone === false) {
            hidden = true;
            hiddenFrames += 1;
            hiddenMaxRed = Math.max(hiddenMaxRed, Number(fx.coneRed));
          } else if (hidden && fx.cone === true) {
            // 다시 나타난 첫 프레임
            resolve({
              hiddenFrames,
              hiddenMaxRed,
              firstRed: Number(fx.coneRed),
              sees: d?.getLastSnapshot()?.monster?.seesSomeone ?? null,
              timedOut: false,
            });
            return;
          }
          if (performance.now() - start > 15_000) {
            resolve({ hiddenFrames, hiddenMaxRed, firstRed: null, sees: null, timedOut: true });
            return;
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }),
  );
  // 팀 시야 밖 (러너 · 가드 · 스카우트 모두에서 멀다)
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 5.5, y: 12, face: 0 });
  await runner.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.monster === null, null, {
    timeout: 10_000,
  });
  // 다시 나타날 때는 러너 반대쪽(동쪽)을 본다: 커서를 동쪽에 두고 러너 앞 2.5타일로
  await aimAt(host, 30, 2);
  await runner.page.waitForTimeout(500);
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 19.4, y: 2, face: 0 });
  const cone = await watchCone;
  console.log(`[m10-fog] 부채꼴 다시 나타남: ${JSON.stringify(cone)}`);
  expect(cone.timedOut).toBe(false);
  expect(cone.hiddenFrames).toBeGreaterThan(0);
  // 사라진 동안 색 상태가 남지 않고, 다시 나타난 첫 프레임 색 = 지금 상태 (아무도 안 봄 → 노랑 0)
  expect(cone.hiddenMaxRed).toBe(0);
  expect(cone.sees).toBe(false);
  expect(cone.firstRed).toBe(0);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});
