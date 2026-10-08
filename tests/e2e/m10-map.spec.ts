// M10b 맵 · 오브젝트 (Canvas 렌더러 · 품질 낮음 · 1920×1080 배율 1, 봇 방 탭 하나):
//  - 시야 밖 벽 테두리 · 기둥 윗테두리와 인접 바닥의 화면 대비 ≥ 2.5:1, 시야 밖은 시간이 흘러도 그대로(발광 · 구조 정적)
//  - 시야 안 바닥은 역할색 몸과 3:1 이상(빛 속 바닥 상대휘도 상한)
//  - 배지는 캐릭터 아래: 거점 A 중심의 러너 · 감옥 중심의 수감자 몸 평균색이 역할색과 ΔE ≤ 15
//  - 거점 정지: 정보 레이어 'blocked' + 주황, 상태 칩에 주황 일시정지 아이콘 픽셀
//  - 굽는 시간 · 텍스처 바이트 기록(낮음 예산 8MiB), 콘솔 에러 · 경고 0
import { expect, test } from '@playwright/test';
import { bodiesOverBadges, blockedPoint, darkAndLit, expectDarkAndLit, startBotRoom } from './m10-map.shared';

const QUERY = '&renderer=canvas&quality=low';
const LOW_TEXTURE_BUDGET = 8 * 1024 * 1024;
const WARN = 0xf59e0b;

test('시야 밖 구조 대비 2.5:1 · 시간 불변 · 시야 안 바닥 밝기 상한 · 굽는 시간 (Canvas 낮음)', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY);
  const r = await darkAndLit(s);
  console.log(`[m10-map] Canvas 낮음: ${JSON.stringify(r)}`);
  const g = await s.page.evaluate(() => window.__DECOY__!.gfx);
  expect(g.renderer).toBe('canvas');
  expect(g.quality).toBe('low');
  expect(g.fogMode).toBe('canvas');
  // 낮음(Canvas)은 발광을 정적 맵에 구워 넣는다
  expect(r.glowLayer).toBe('static');
  expectDarkAndLit(r);
  expect(r.textureBytes).toBeGreaterThan(0);
  expect(r.textureBytes).toBeLessThanOrEqual(LOW_TEXTURE_BUDGET);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('배지는 캐릭터를 덮지 않고, 거점 정지는 주황 + 일시정지 아이콘 (Canvas 낮음)', async ({ browser }) => {
  const s = await startBotRoom(browser, QUERY);
  await s.page.mouse.move(10, 10);
  await s.page.keyboard.press('KeyX');
  await s.page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  const bodies = await bodiesOverBadges(s);
  console.log(`[m10-map] 몸 평균색 ΔE (Canvas 낮음): ${JSON.stringify(bodies)}`);
  expect(bodies.runner).toBeLessThanOrEqual(15);
  expect(bodies.guard).toBeLessThanOrEqual(15);
  // 거점 · 탈출구 · 감옥 배지와 진행이 정보 레이어에 있다
  const info = await s.page.evaluate(() => window.__DECOY__?.getInfoLayer() ?? []);
  expect(info.filter((i) => i.kind === 'badge').map((i) => i.tag)).toEqual([
    'point-A',
    'point-B',
    'exit-N',
    'exit-S',
    'prison',
  ]);
  const blocked = await blockedPoint(s);
  console.log(`[m10-map] 거점 정지: ${JSON.stringify(blocked)}`);
  expect(blocked.badge?.value).toBe('blocked');
  expect(blocked.badge?.color).toBe(WARN);
  expect(blocked.badge?.r).toBe(2.5);
  expect(blocked.orange).toBeGreaterThanOrEqual(8);
  expect(s.problems).toEqual([]);
  await s.context.close();
});
