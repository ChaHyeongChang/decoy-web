// M10b 맵 · 오브젝트 (WebGL · SwiftShader · 품질 높음 · 1920×1080 배율 1, 봇 방 탭 하나): Canvas 낮음과 같은 검사를
// GPU 합성 경로(발광 스프라이트 ADD · 빛 지도 MULTIPLY · 테두리 리프트 ADD · 경계 셰이더)에서 한다.
// 판 중 자동 하향은 injectFps(60)으로 막고 하향 0회를 단언한다. 텍스처 예산은 높음 32MiB.
// 더해서: 맵 쪽 정적 · 동적 레이어 · 배지에 프레임마다 다시 테셀레이션하는 Graphics가 없다(R3), 멈춘 시계에서 열린 탈출구가
// 다 열린 그림이다(R6), 페이지를 다시 열어도 맵 그림이 같다(T7 시드 결정성).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { validateBalance } from '@decoy/shared';
import {
  bodiesOverBadges,
  blockedPoint,
  darkAndLit,
  exitOpensWhileFrozen,
  expectBodiesOverBadges,
  expectDarkAndLit,
  expectNoMapGraphics,
  mapGfxCounts,
  diffMapScenes,
  mapSceneShot,
  startBotRoom,
} from './m10-map.shared';

const QUERY = '&renderer=webgl&quality=high';
const HIGH_TEXTURE_BUDGET = 32 * 1024 * 1024;
const WARN = 0xf59e0b;
const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

test('시야 밖 구조 대비 2.5:1 · 시간 불변 · 시야 안 바닥 밝기 상한 · 배지 아래 캐릭터 · 거점 정지 (WebGL 높음)', async ({
  browser,
}) => {
  // 장면 다섯 개를 WebGL 높음(1920×1080)에서 찍는다: GitHub Actions 러너의 SwiftShader에서는 3분을 넘긴 적이 있다
  test.setTimeout(480_000);
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
  // 맵 쪽 정적 · 동적 레이어 · 배지에 프레임마다 다시 테셀레이션하는 Graphics가 없다 (R3)
  const counts = await mapGfxCounts(s.page);
  console.log(`[m10-map.webgl] 맵 쪽 Graphics 명령: ${JSON.stringify(counts)}`);
  expectNoMapGraphics(counts, 6);
  // 동적 레이어는 그린 명령이 바뀔 때만 다시 올린다: 모두 멈춘 장면에서 안개 주기가 여러 번 돌아도 올리기 0
  const uploads = (): Promise<number> =>
    s.page.evaluate(() => Number(window.__DECOY__!.gfx.features.fogDynUploads ?? -1));
  const u0 = await uploads();
  await s.page.waitForTimeout(1000);
  expect(u0).toBeGreaterThan(0);
  expect(await uploads()).toBe(u0);

  const bodies = await bodiesOverBadges(s, balance.survivor.radius);
  console.log(`[m10-map.webgl] 배지 위 몸: ${JSON.stringify(bodies)}`);
  expectBodiesOverBadges(bodies);
  const blocked = await blockedPoint(s);
  console.log(`[m10-map.webgl] 거점 정지: ${JSON.stringify(blocked)}`);
  expect(blocked.badge?.value).toBe('blocked');
  expect(blocked.badge?.color).toBe(WARN);
  expect(blocked.orange).toBeGreaterThanOrEqual(8);
  // 멈춘 시계에서 열린 탈출구 (R6): 문 칸 가운데가 열린 틈 초록, 활성(닫힘) 때와 다르다
  const door = await exitOpensWhileFrozen(s);
  console.log(`[m10-map.webgl] 멈춘 시계 탈출구: ${JSON.stringify(door)}`);
  expect(door.state).toBe('open');
  // 열린 틈(어두운 초록 + 초록 빛)이 문짝(청회색)을 덮었다: 초록 채널이 닫힌 문보다 1.5배 · 10 이상 밝다
  expect(door.after[1]).toBeGreaterThanOrEqual(door.before[1] + 10);
  expect(door.after[1]).toBeGreaterThanOrEqual(door.before[1] * 1.5);
  expect((await s.page.evaluate(() => window.__DECOY__!.gfx)).downgrades).toBe(0);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('정적 맵 · 발광은 페이지를 새로 열어도 같은 그림이다 (시드 결정성, WebGL 높음)', async ({ browser }) => {
  const a = await mapSceneShot(browser, QUERY);
  const b = await mapSceneShot(browser, QUERY);
  expect(a.rect).toEqual(b.rect);
  // 빈 통과가 아님: 맵 사각형 전체 (1428×952 안팎)
  expect(a.rect.w * a.rect.h).toBeGreaterThan(1_000_000);
  // 같은 PNG면 같은 그림. 다르면 캐릭터 자리(자세는 맵 그림이 아님)를 빼고 픽셀을 센다
  if (!a.png.equals(b.png)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const tile = (a.rect.w / 48) * 1.2;
    const d = await diffMapScenes(page, a, b, tile);
    await ctx.close();
    console.log(`[m10-map.webgl] 두 번 연 맵 (캐릭터 자리 뺌): ${JSON.stringify(d)}`);
    expect(d.diff).toBe(0);
  } else console.log('[m10-map.webgl] 두 번 연 맵: PNG가 같다');
  expect(a.problems).toEqual([]);
  expect(b.problems).toEqual([]);
});
