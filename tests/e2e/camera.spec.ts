// 따라가는 카메라 (Canvas · 품질 낮음 · 1920×1080, 봇 방 탭 하나, 기본 확대 = ② 중간 3)
//  - 조준 안정: 괴물이 마우스를 가만히 둔 채 걸으면 카메라가 따라가고 앞당겨져도 보내는 조준 각도가 그대로다
import { expect, test } from '@playwright/test';
import { startBotRoom, settle } from './m10-map.shared';

const QUERY = '&renderer=canvas&quality=low';

test('괴물: 마우스를 가만히 두고 걸으면 화면이 움직여도 조준이 흔들리지 않는다', async ({ browser }) => {
  const s = await startBotRoom(browser, QUERY, 'monster');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  // 맵 가운데 근처 넓은 복도에서 동쪽을 본다
  await s.send({ kind: 'teleport', target: you, x: 18, y: 16, face: 0 });
  await s.send({ kind: 'freeze', target: you, frozen: false });
  await settle(page);
  await page.evaluate(() => window.__DECOY__?.freezeClock(null));
  // 커서를 괴물 오른쪽 위에 두고 한 번 움직여 조준을 정한다
  // 보이는 창(맵 사각형)의 브라우저 좌표와 괴물 자리
  const { rect, at } = await page.evaluate(() => {
    const d = window.__DECOY__!;
    const v = d.getCamera()!.view;
    const tl = d.tileToClient(v.x, v.y)!;
    const br = d.tileToClient(v.x + v.w, v.y + v.h)!;
    const st = d.getLocalState()!;
    return { rect: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }, at: d.tileToClient(st.x, st.y)! };
  });
  const cx = Math.min(rect.x + rect.w - 20, at.x + 260);
  const cy = Math.max(rect.y + 20, at.y - 140);
  await page.mouse.move(cx - 10, cy);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(400);
  const aim0 = await page.evaluate(() => window.__DECOY__!.getLastInput()?.aim ?? Number.NaN);
  expect(Number.isFinite(aim0)).toBe(true);
  const view0 = await page.evaluate(() => window.__DECOY__!.getCamera()!.view);
  // 마우스는 그대로, 아래(남쪽)로 1.5초 걷는다: 카메라가 따라 내려간다
  const aims: number[] = [];
  await page.keyboard.down('KeyS');
  for (let i = 0; i < 15; i += 1) {
    await page.waitForTimeout(100);
    aims.push(await page.evaluate(() => window.__DECOY__!.getLastInput()?.aim ?? Number.NaN));
  }
  await page.keyboard.up('KeyS');
  const view1 = await page.evaluate(() => window.__DECOY__!.getCamera()!.view);
  console.log(
    `[camera] 조준 ${aim0.toFixed(4)} → ${JSON.stringify(aims.map((a) => Number(a.toFixed(4))))}, 창 y ${view0.y} → ${view1.y}`,
  );
  // 카메라는 움직였다 (빈 통과가 아님)
  expect(Math.abs(view1.y - view0.y)).toBeGreaterThan(1);
  for (const a of aims) expect(a).toBe(aim0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});
