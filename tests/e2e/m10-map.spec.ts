// M10b 맵 · 오브젝트 (Canvas 렌더러 · 품질 낮음 · 1920×1080 배율 1, 봇 방 탭 하나):
//  - 시야 밖 벽 테두리 · 기둥 윗테두리와 인접 바닥의 화면 대비 ≥ 2.5:1, 시야 밖은 시간이 흘러도 그대로(발광 · 구조 정적)
//  - 시야 안 바닥은 역할색 몸과 3:1 이상(빛 속 바닥 상대휘도 상한)
//  - 배지는 캐릭터 아래: 실제 배지 자리(거점 A 글자 · 마름모 · 상태 칩 · 감옥 자물쇠)에 선 몸 원판(0.9r)이 배지 없는 바닥에
//    선 같은 몸과 같다 (평균 ΔE ≤ 2)
//  - 거점 정지: 정보 레이어 'blocked' + 주황, 상태 칩에 주황 일시정지 아이콘 픽셀
//  - 멈춘 시계에서 열린 탈출구는 다 열린 그림 (R6)
//  - 맵 쪽 레이어 · 배지에 프레임마다 다시 그리는 Graphics 없음
//  - 굽는 시간 · 텍스처 바이트 기록(낮음 예산 8MiB), 콘솔 에러 · 경고 0
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CAM1 } from './helpers';
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
  startBotRoom,
} from './m10-map.shared';

// 따라가는 카메라: 맵 곳곳의 고정 자리(배지 · 거점 · 탈출구 · 어둠 속 벽)를 한 화면에서 재는 그림 시험이라 맵 전체 고정 화면(?cam=1)
const QUERY = `&renderer=canvas&quality=low${CAM1}`;
const LOW_TEXTURE_BUDGET = 8 * 1024 * 1024;
const WARN = 0xf59e0b;
const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

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
  const counts = await mapGfxCounts(s.page);
  console.log(`[m10-map] 맵 쪽 Graphics 명령: ${JSON.stringify(counts)}`);
  expectNoMapGraphics(counts, 1);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('배지는 캐릭터를 덮지 않고, 거점 정지는 주황 + 일시정지 아이콘, 멈춘 시계 탈출구 열림 (Canvas 낮음)', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, QUERY);
  await s.page.mouse.move(10, 10);
  await s.page.keyboard.press('KeyX');
  await s.page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  const bodies = await bodiesOverBadges(s, balance.survivor.radius);
  console.log(`[m10-map] 배지 위 몸 (Canvas 낮음): ${JSON.stringify(bodies)}`);
  expectBodiesOverBadges(bodies);
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
  // 멈춘 시계에서 열린 탈출구 (R6): 문 칸 가운데가 열린 틈 초록, 활성(닫힘) 때와 다르다
  const door = await exitOpensWhileFrozen(s);
  console.log(`[m10-map] 멈춘 시계 탈출구: ${JSON.stringify(door)}`);
  expect(door.state).toBe('open');
  // 열린 틈(어두운 초록 + 초록 빛)이 문짝(청회색)을 덮었다: 초록 채널이 닫힌 문보다 1.5배 · 10 이상 밝다
  expect(door.after[1]).toBeGreaterThanOrEqual(door.before[1] + 10);
  expect(door.after[1]).toBeGreaterThanOrEqual(door.before[1] * 1.5);
  expect(s.problems).toEqual([]);
  await s.context.close();
});
