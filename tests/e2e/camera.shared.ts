// 따라가는 카메라 시험 공통 (camera.spec.ts Canvas · camera.webgl.spec.ts WebGL)
import { expect } from '@playwright/test';
import { waitCamera } from './helpers';
import { settle, type Session } from './m10-map.shared';
import { spotDiff, spotStats } from './pixelSpot';

/** 러너 (21.5, 25)의 창 안 · 시야(6타일) 밖 자리: 7타일 동쪽 바닥 */
export const HIDDEN_SPOT: [number, number] = [28.5, 25];
/** 같은 창 안 · 시야 안 자리 (3타일 남쪽 바닥, 사이에 벽 없음): 빈 통과가 아님을 보인다 */
export const SEEN_SPOT: [number, number] = [21.5, 28];

/**
 * 확대 화면에서 숨은 상대는 픽셀로도 없다 (VISUAL_SPEC 0장 ①): 러너 창 안이지만 팀 시야 밖에서 괴물이 걸어도 그 자리 픽셀이
 * 괴물을 멀리 보낸 같은 자리 빈 바닥과 채널마다 ±4 · 가장 밝은 픽셀 ±4. 시야 안으로 오면 실제로 보인다(빈 통과 아님)
 */
export async function expectHiddenOpponentHasNoPixels(s: Session, label: string): Promise<void> {
  const { page, send, id } = s;
  const monster = id('monster');
  await send({ kind: 'teleport', target: id('scout'), x: 45, y: 2, face: 0 });
  await send({ kind: 'teleport', target: id('guard'), x: 3, y: 2, face: 0 });
  await send({ kind: 'teleport', target: monster, x: 44.5, y: 12.5, face: 0 });
  await send({ kind: 'teleport', target: id('runner'), x: 21.5, y: 25, face: 0 });
  await settle(page);
  await page.evaluate(() => window.__DECOY__?.setCameraShake(0));
  await waitCamera(page);
  const view = (await page.evaluate(() => window.__DECOY__!.getCamera()))!.view;
  // 전제: 자리가 창 안이고 시야 밖이다 (확대 화면이라 창이 시야보다 넓은 쪽)
  expect(HIDDEN_SPOT[0]).toBeLessThan(view.x + view.w - 0.5);
  expect(Math.hypot(HIDDEN_SPOT[0] - 21.5, HIDDEN_SPOT[1] - 25)).toBeGreaterThan(6.5);
  const seen: Awaited<ReturnType<typeof spotStats>>[string][] = [];
  for (let n = 0; n < 6; n += 1) {
    await send({
      kind: 'teleport',
      target: monster,
      x: HIDDEN_SPOT[0] + (n % 2) * 0.3,
      y: HIDDEN_SPOT[1],
      face: Math.PI,
    });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.monster ?? null)).toBeNull();
    expect(
      (await page.evaluate(() => window.__DECOY__?.getDrawn() ?? [])).some((d) => d.kind === 'monster'),
    ).toBe(false);
    seen.push((await spotStats(page, { spot: HIDDEN_SPOT })).spot!);
  }
  await send({ kind: 'teleport', target: monster, x: 44.5, y: 12.5, face: 0 });
  await page.waitForTimeout(800);
  const empty = await spotStats(page, { spot: HIDDEN_SPOT, near: SEEN_SPOT });
  let worst = { channel: 0, maxLuma: 0 };
  for (const p of seen) {
    const d = spotDiff(p, empty.spot!);
    worst = { channel: Math.max(worst.channel, d.channel), maxLuma: Math.max(worst.maxLuma, d.maxLuma) };
  }
  // 빈 통과가 아님: 시야 안(3타일)에 오면 보이고 픽셀이 바뀐다
  await send({ kind: 'teleport', target: monster, x: SEEN_SPOT[0], y: SEEN_SPOT[1], face: Math.PI / 2 });
  await expect
    .poll(() => page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.monster ?? null))
    .not.toBeNull();
  await page.waitForTimeout(400);
  const visible = (await spotStats(page, { near: SEEN_SPOT })).near!;
  const shown = spotDiff(visible, empty.near!);
  console.log(
    `[camera] ${label} 숨은 상대 자리: 채널 차 최대 ${worst.channel.toFixed(1)} · 가장 밝은 픽셀 차 ${worst.maxLuma.toFixed(1)}, 빈 바닥 밝기 ${empty.spot!.luma} / 시야 안 괴물 채널 차 ${shown.channel.toFixed(1)}`,
  );
  expect(worst.channel).toBeLessThanOrEqual(4);
  expect(worst.maxLuma).toBeLessThanOrEqual(4);
  expect(empty.spot!.luma).toBeGreaterThanOrEqual(6);
  expect(shown.channel).toBeGreaterThan(20);
}
