// M10b 맵 · 오브젝트 (WebGL · SwiftShader · 품질 높음 · 1920×1080 배율 1, 봇 방 탭 하나): Canvas 낮음과 같은 검사를
// GPU 합성 경로(발광 스프라이트 ADD · 빛 지도 MULTIPLY · 테두리 리프트 ADD · 경계 셰이더)에서 한다.
// 판 중 자동 하향은 injectFps(60)으로 막고 하향 0회를 단언한다. 텍스처 예산은 높음 32MiB.
import { expect, test } from '@playwright/test';
import { bodiesOverBadges, blockedPoint, darkAndLit, expectDarkAndLit, startBotRoom } from './m10-map.shared';

const QUERY = '&renderer=webgl&quality=high';
const HIGH_TEXTURE_BUDGET = 32 * 1024 * 1024;
const WARN = 0xf59e0b;

test('시야 밖 구조 대비 2.5:1 · 시간 불변 · 시야 안 바닥 밝기 상한 · 배지 아래 캐릭터 · 거점 정지 (WebGL 높음)', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY);
  const r = await darkAndLit(s);
  console.log(`[m10-map.webgl] WebGL 높음: ${JSON.stringify(r)}`);
  const g = await s.page.evaluate(() => window.__DECOY__!.gfx);
  expect(g.renderer).toBe('webgl');
  expect(g.quality).toBe('high');
  expect(g.fogMode).toBe('gpu');
  expect(g.downgrades).toBe(0);
  // 높음은 발광을 따로 더한다 (빛 지도 곱하기 앞)
  expect(r.glowLayer).toBe('sprite');
  expect(r.glowBakeMs).toBeGreaterThan(0);
  expectDarkAndLit(r);
  expect(r.textureBytes).toBeGreaterThan(0);
  expect(r.textureBytes).toBeLessThanOrEqual(HIGH_TEXTURE_BUDGET);

  const bodies = await bodiesOverBadges(s);
  console.log(`[m10-map.webgl] 몸 평균색 ΔE: ${JSON.stringify(bodies)}`);
  expect(bodies.runner).toBeLessThanOrEqual(15);
  expect(bodies.guard).toBeLessThanOrEqual(15);
  const blocked = await blockedPoint(s);
  console.log(`[m10-map.webgl] 거점 정지: ${JSON.stringify(blocked)}`);
  expect(blocked.badge?.value).toBe('blocked');
  expect(blocked.badge?.color).toBe(WARN);
  expect(blocked.orange).toBeGreaterThanOrEqual(8);
  expect((await s.page.evaluate(() => window.__DECOY__!.gfx)).downgrades).toBe(0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});
