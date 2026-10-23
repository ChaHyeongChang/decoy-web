// 따라가는 카메라 (WebGL · SwiftShader · 1920×1080, 봇 방 탭 하나, 기본 확대 = ② 중간 3):
//  - 맵 조각: 정적 맵은 로비에서 나눠 굽고, 판 중에는 맵 전체 그림에서 조각을 복사만 한다(칠하기 0 — 끊김 없음)
//  - 따라가기: 창이 내 캐릭터를 따라가고 맵 밖을 보이지 않는다, 먼 순간 이동은 잘라 옮긴다
import { expect, test } from '@playwright/test';
import { MAP_H, MAP_W } from '@decoy/shared';
import { startBotRoom } from './m10-map.shared';

const QUERY = '&renderer=webgl&quality=high';

test('맵 조각은 판 중에 칠하지 않는다: 로비에서 나눠 구운 맵 전체 그림에서 복사만 한다 (WebGL 높음)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const s = await startBotRoom(browser, QUERY);
  const f0 = await s.page.evaluate(() => window.__DECOY__!.gfx.features);
  const g = await s.page.evaluate(() => window.__DECOY__!.gfx);
  expect(g.fogMode).toBe('gpu');
  expect(g.camZoom).toBe(3);
  // 로비 · 판 장면 생성 때 맵 전체 그림을 띠로 나눠 구웠다
  expect(Number(f0.mapBakeBands ?? 0)).toBeGreaterThan(1);
  expect(Number(f0.mapBakeTotalMs ?? 0)).toBeGreaterThan(0);
  // 맵을 가로지르며 여러 번 순간 이동한다 (매번 창의 조각이 전부 새로 든다)
  const you = (await s.page.evaluate(() => window.__DECOY__!.you)) ?? '';
  const spots: [number, number][] = [
    [6, 6],
    [42, 6],
    [42, 26],
    [6, 26],
    [24, 16],
  ];
  for (const [x, y] of spots) {
    await s.send({ kind: 'teleport', target: you, x, y, face: 0 });
    await s.page.waitForFunction(
      ([tx, ty]) => {
        const c = window.__DECOY__?.getCamera();
        if (!c) return false;
        return Math.abs(c.view.x + c.view.w / 2 - tx!) < 4 && Math.abs(c.view.y + c.view.h / 2 - ty!) < 4;
      },
      [x, y],
      { timeout: 20_000 },
    );
    await s.page.waitForTimeout(300);
  }
  const f = await s.page.evaluate(() => window.__DECOY__!.gfx.features);
  console.log(
    `[camera.webgl] 조각: ${JSON.stringify({
      bakes: f.chunkBakes,
      paints: f.chunkPaints ?? 0,
      maxMs: f.chunkBakeMsMax,
      uploadPx: f.chunkUploadPx,
      bands: f.mapBakeBands,
      bandMaxMs: f.mapBakeMs,
      totalMs: f.mapBakeTotalMs,
    })}`,
  );
  expect(Number(f.chunkBakes ?? 0)).toBeGreaterThan(Number(f0.chunkBakes ?? 0));
  expect(Number(f.chunkPaints ?? 0)).toBe(0);
  const cam = (await s.page.evaluate(() => window.__DECOY__!.getCamera()))!;
  // 먼 순간 이동은 미끄러지지 않고 잘라 옮긴다
  expect(cam.cuts).toBeGreaterThanOrEqual(spots.length - 1);
  // 창은 맵 안
  expect(cam.view.x).toBeGreaterThanOrEqual(0);
  expect(cam.view.y).toBeGreaterThanOrEqual(0);
  expect(cam.view.x + cam.view.w).toBeLessThanOrEqual(MAP_W + 1e-6);
  expect(cam.view.y + cam.view.h).toBeLessThanOrEqual(MAP_H + 1e-6);
  expect(s.problems).toEqual([]);
  await s.context.close();
});
