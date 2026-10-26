// 지도 크게 보기 선명도 (남은 문제 정리): 크게 본 지도의 바닥을 그림이 화면에서 차지하는 기기 px에 맞춰 따로 합성한다(같은 기록 ·
// 같은 빛 — 정보는 작은 미니맵과 같다). 예전에는 작은 미니맵 합성(가로 384~768px)을 늘려 그려 품질 낮음 · 높은 기기 배율에서 흐렸다.
//  - 같은 빌드 · 같은 장면에서 예전 방식(디버그 setMinimapBigSharp(false))과 스크린샷을 견준다: 선명도(밝기 기울기 평균)가 오르고,
//    칸 평균 색은 같다(같은 그림을 더 촘촘히 그렸을 뿐)
//  - 바닥 텍스처 ≥ 화면 기기 px, 열린 동안 텍스처 예산(낮음 8MiB) 안, 닫으면 놓는다(텍스처 바이트가 닫기 전 값으로)
//  - 괴물 화면: 큰 지도의 생존자는 흰 공통 실루엣만(선명해져도 같은 그림)
// Canvas 렌더러 (multi). WebGL 높음 · 배율 2의 텍스처 예산은 minimap-sharp.webgl.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { CAPTURE_POINTS, EXITS, MAP_H, MAP_W, PRISON_CENTER, type MatchPrefsDebug } from '@decoy/shared';
import { TABLET_LANDSCAPE, newPlayerPage, press, waitCamera, waitForSnapshots } from './helpers';
import { settle, startBotRoom } from './m10-map.shared';
import { waitForTouchTarget } from './touch';

const MiB = 1024 * 1024;
const LOW_BUDGET = 8 * MiB;

async function prefs(page: Page): Promise<MatchPrefsDebug> {
  const p = await page.evaluate(() => window.__DECOY__?.getMatchPrefs() ?? null);
  if (!p) throw new Error('판 장면 없음');
  return p;
}

const textureBytes = (page: Page): Promise<number> =>
  page.evaluate(() => Number(window.__DECOY__!.gfx.features.textureBytes ?? 0));

interface Shot {
  /**
   * 밝기 기울기 RMS (0~255, 가로 · 세로 이웃 차의 제곱 평균의 제곱근). 늘려 그리면 경계가 여러 화소로 퍼져 작아진다 — 절댓값 평균은
   * 퍼져도 합이 같아(계단 높이 그대로) 흐림을 못 잰다
   */
  sharp: number;
  /**
   * 작은 미니맵 합성 폭(smallW)보다 고운 세부 (0~255): 그림을 그 폭으로 줄였다 다시 늘린 것과의 밝기 차 평균. 예전 그림은 그 폭을
   * 늘린 것이라 거의 0이고, 화면 해상도로 합성한 그림만 크다 — 선명해졌다는 직접 증거
   */
  detail: number;
  /** 잰 바닥 화소 비율 (표시 둘레를 뺀 나머지) */
  floorFrac: number;
  /** 12 × 8 칸 평균 색 (같은 그림인지 견준다) */
  cells: number[];
  /** 잰 화소 사각형 (백버퍼 px) */
  px: { x: number; y: number; w: number; h: number };
}

/**
 * 크게 본 지도 그림 사각형(틀 · 제목 안쪽, 가장자리 6px 안쪽)을 게임 캔버스(백버퍼 화소 그대로 — Canvas 렌더러)에서 잰다.
 * 화면 스크린샷은 백버퍼를 기기 배율까지 늘린 것이라(품질 낮음 휴대폰 · 태블릿은 1.25배 백버퍼를 2.5배 화면으로) 그 늘림이
 * 지도 바닥의 차이를 덮는다. 게임이 그린 화소 = 이번 고침이 바꾸는 것
 */
async function shotBig(page: Page): Promise<Shot> {
  const p = await prefs(page);
  const img = p.minimapBig.image;
  if (!img) throw new Error('크게 본 지도가 닫혀 있다');
  const smallW = p.minimapBig.smallTexW;
  // 바닥 위에 또렷하게 그리는 표시(엔티티 · 거점 · 탈출구 · 감옥 · 보이는 창 선)는 두 방식이 같다: 그 둘레는 빼고 바닥만 잰다 (논리 px)
  const drawn = await page.evaluate(() => window.__DECOY__!.getDrawnMinimapBig());
  const view = (await page.evaluate(() => window.__DECOY__!.getCamera()))?.view ?? null;
  const at = (x: number, y: number): [number, number] => [
    img.x + (x / MAP_W) * img.w,
    img.y + (y / MAP_H) * img.h,
  ];
  const marks = [
    ...drawn.map((d) => at(d.x, d.y)),
    at(CAPTURE_POINTS.A.x, CAPTURE_POINTS.A.y),
    at(CAPTURE_POINTS.B.x, CAPTURE_POINTS.B.y),
    at(EXITS.N.center.x, EXITS.N.center.y),
    at(EXITS.S.center.x, EXITS.S.center.y),
    at(PRISON_CENTER.x, PRISON_CENTER.y),
  ];
  const box = view ? [...at(view.x, view.y), ...at(view.x + view.w, view.y + view.h)] : null;
  const mask = { marks, r: img.w * 0.035, box, band: 6 };
  return page.evaluate(
    ([img, smallW, mask]) => {
      const gc = document.querySelector('canvas')!;
      const viewW = window.__DECOY__!.getHudLayout()!.viewW;
      const s = gc.width / viewW;
      const c = document.createElement('canvas');
      c.width = gc.width;
      c.height = gc.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(gc, 0, 0);
      const inset = 6;
      const x = Math.ceil(img.x * s + inset);
      const y = Math.ceil(img.y * s + inset);
      const w = Math.floor(img.w * s - inset * 2);
      const h = Math.floor(img.h * s - inset * 2);
      const d = ctx.getImageData(x, y, w, h).data;
      // 바닥 화소만 (표시 둘레 · 보이는 창 선 띠는 뺀다)
      const floor = new Uint8Array(w * h);
      for (let j = 0; j < h; j += 1)
        for (let i = 0; i < w; i += 1) {
          const lx = (x + i) / s;
          const ly = (y + j) / s;
          let ok = true;
          for (const [mx, my] of mask.marks)
            if ((lx - mx) ** 2 + (ly - my) ** 2 < mask.r ** 2) {
              ok = false;
              break;
            }
          const b = mask.box;
          if (ok && b) {
            const [x0, y0, x1, y1] = b as [number, number, number, number];
            const nearX = Math.abs(lx - x0) < mask.band || Math.abs(lx - x1) < mask.band;
            const nearY = Math.abs(ly - y0) < mask.band || Math.abs(ly - y1) < mask.band;
            if (
              (nearX && ly > y0 - mask.band && ly < y1 + mask.band) ||
              (nearY && lx > x0 - mask.band && lx < x1 + mask.band)
            )
              ok = false;
          }
          floor[j * w + i] = ok ? 1 : 0;
        }
      const lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i += 1)
        lum[i] = 0.2126 * (d[i * 4] ?? 0) + 0.7152 * (d[i * 4 + 1] ?? 0) + 0.0722 * (d[i * 4 + 2] ?? 0);
      let g = 0;
      let n = 0;
      for (let j = 0; j < h - 1; j += 1)
        for (let i = 0; i < w - 1; i += 1) {
          if (!floor[j * w + i] || !floor[j * w + i + 1] || !floor[(j + 1) * w + i]) continue;
          const v = lum[j * w + i] ?? 0;
          const dx = (lum[j * w + i + 1] ?? 0) - v;
          const dy = (lum[(j + 1) * w + i] ?? 0) - v;
          g += dx * dx + dy * dy;
          n += 1;
        }
      const CX = 12;
      const CY = 8;
      const cells: number[] = [];
      for (let cy = 0; cy < CY; cy += 1)
        for (let cx = 0; cx < CX; cx += 1) {
          const x0 = Math.floor((cx * w) / CX);
          const x1 = Math.floor(((cx + 1) * w) / CX);
          const y0 = Math.floor((cy * h) / CY);
          const y1 = Math.floor(((cy + 1) * h) / CY);
          const sum = [0, 0, 0];
          let m = 0;
          for (let j = y0; j < y1; j += 1)
            for (let i = x0; i < x1; i += 1) {
              const o = (j * w + i) * 4;
              sum[0]! += d[o] ?? 0;
              sum[1]! += d[o + 1] ?? 0;
              sum[2]! += d[o + 2] ?? 0;
              m += 1;
            }
          cells.push(...sum.map((v) => v / Math.max(1, m)));
        }
      // 작은 합성 폭으로 줄였다 늘리기 (브라우저 고품질 재표본)
      const cut = document.createElement('canvas');
      cut.width = w;
      cut.height = h;
      cut.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(d), w, h), 0, 0);
      const sw = Math.max(1, Math.round((w * smallW) / (img.w * s)));
      const sh = Math.max(1, Math.round((h * sw) / w));
      const small = document.createElement('canvas');
      small.width = sw;
      small.height = sh;
      const sc = small.getContext('2d')!;
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(cut, 0, 0, sw, sh);
      const back = document.createElement('canvas');
      back.width = w;
      back.height = h;
      const bc = back.getContext('2d', { willReadFrequently: true })!;
      bc.imageSmoothingQuality = 'high';
      bc.drawImage(small, 0, 0, w, h);
      const r = bc.getImageData(0, 0, w, h).data;
      let detail = 0;
      let fn = 0;
      for (let i = 0; i < w * h; i += 1) {
        if (!floor[i]) continue;
        const l = 0.2126 * (r[i * 4] ?? 0) + 0.7152 * (r[i * 4 + 1] ?? 0) + 0.0722 * (r[i * 4 + 2] ?? 0);
        detail += Math.abs(l - (lum[i] ?? 0));
        fn += 1;
      }
      return {
        sharp: Math.sqrt(g / Math.max(1, n)),
        detail: detail / Math.max(1, fn),
        floorFrac: fn / (w * h),
        cells,
        px: { x, y, w, h },
      };
    },
    [img, smallW, mask] as const,
  );
}

/** 크게 본 지도를 연다 (지도를 누른다) — 연 뒤 엔티티를 한 번 그릴 때까지 */
async function openBig(page: Page, touch: boolean): Promise<void> {
  const tap = (await prefs(page)).minimapTap!;
  const x = tap.x + tap.w / 2;
  const y = tap.y + tap.h / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(true);
  await expect
    .poll(async () => (await page.evaluate(() => window.__DECOY__!.getDrawnMinimapBig().length)) > 0)
    .toBe(true);
  // 바닥 · 엔티티를 그린 프레임이 화면에 나갈 때까지
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

async function closeBig(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(false);
}

/** 예전 방식(작은 지도 합성을 늘림)과 새 방식으로 같은 장면을 찍어 견준다 */
async function compare(
  page: Page,
  label: string,
  touch: boolean,
): Promise<{ before: Shot; after: Shot; p: MatchPrefsDebug; closedBytes: number; openBytes: number }> {
  const closedBytes = await textureBytes(page);
  await page.evaluate(() => window.__DECOY__!.setMinimapBigSharp(false));
  await openBig(page, touch);
  const old = await prefs(page);
  expect(old.minimapBig.tex.w, `${label} 예전 방식 = 작은 지도 합성 폭`).toBe(old.minimapBig.smallTexW);
  const before = await shotBig(page);
  if (touch) await page.touchscreen.tap(5, 5);
  else await closeBig(page);
  await expect.poll(async () => (await prefs(page)).minimapBig.open).toBe(false);
  await page.evaluate(() => window.__DECOY__!.setMinimapBigSharp(true));
  await openBig(page, touch);
  // 화면 해상도 정적 맵은 연 뒤 몇 프레임에 나눠 굽는다 (그동안은 예전 바닥)
  await expect.poll(async () => (await prefs(page)).minimapBig.sharpReady).toBe(true);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  const p = await prefs(page);
  const openBytes = await textureBytes(page);
  const after = await shotBig(page);
  const bake = await page.evaluate(() => window.__DECOY__!.gfx.features);
  console.log(
    `[minimap-sharp] ${label}: 바닥 ${old.minimapBig.tex.w} → ${p.minimapBig.tex.w}×${p.minimapBig.tex.h} (화면 ${p.minimapBig.needW.toFixed(0)}px), 고운 세부 ${before.detail.toFixed(2)} → ${after.detail.toFixed(2)} (×${(after.detail / before.detail).toFixed(2)}), 기울기 RMS ${before.sharp.toFixed(2)} → ${after.sharp.toFixed(2)} (바닥 화소 ${(after.floorFrac * 100).toFixed(0)}%), 텍스처 ${(closedBytes / MiB).toFixed(2)} → ${(openBytes / MiB).toFixed(2)}MiB, 잰 화소 ${JSON.stringify(after.px)}, 굽기 ${String(bake.minimapBigSteps)}걸음 · 한 걸음 최대 ${String(bake.minimapBigStepMaxMs)}ms · 합계 ${String(bake.minimapBigBakeMs)}ms`,
  );
  // 판 중 나눠 굽기: 한 걸음(한 프레임)이 예산(4ms)을 크게 넘지 않는다 — 띠 하나 · 발광 줄 하나 단위라
  // (예전에는 Canvas 경로에서 버린 맵 전체 발광을 첫 걸음에 다시 구워 한 프레임에 수십 ms였다)
  expect(Number(bake.minimapBigStepMaxMs), `${label} 굽기 한 걸음 최대 (ms)`).toBeLessThan(25);
  return { before, after, p, closedBytes, openBytes };
}

/** 칸 평균 색 차이 (0~255): 같은 그림이면 작다 */
function cellDiff(a: Shot, b: Shot): number {
  let s = 0;
  for (let i = 0; i < a.cells.length; i += 1) s += Math.abs((a.cells[i] ?? 0) - (b.cells[i] ?? 0));
  return s / a.cells.length;
}

test('지도 크게 보기 선명도 (PC 1920×1080 품질 낮음): 바닥이 화면 기기 px 이상 · 예전보다 선명 · 같은 그림, 예산 안, 닫으면 놓음', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, '&renderer=canvas&quality=low', 'runner');
  const { page } = s;
  await settle(page);
  await waitCamera(page);
  const r = await compare(page, 'PC 1920×1080 낮음', false);
  const big = r.p.minimapBig;
  expect(big.tex.w).toBeGreaterThanOrEqual(Math.floor(big.needW));
  expect(big.tex.w).toBeGreaterThan(big.smallTexW);
  expect(r.after.detail / r.before.detail).toBeGreaterThan(1.4);
  expect(r.after.sharp / r.before.sharp).toBeGreaterThan(1.5);
  expect(cellDiff(r.before, r.after)).toBeLessThan(6);
  expect(r.openBytes).toBeLessThanOrEqual(LOW_BUDGET);
  // 닫으면 바닥 텍스처를 놓는다 (1 × 1)
  await closeBig(page);
  expect((await prefs(page)).minimapBig.tex).toEqual({ w: 1, h: 1 });
  expect(await textureBytes(page)).toBeLessThanOrEqual(r.closedBytes + 4);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('지도 크게 보기 선명도 (괴물 화면 PC 낮음): 선명해져도 생존자는 흰 공통 실루엣만', async ({
  browser,
}) => {
  const s = await startBotRoom(browser, '&renderer=canvas&quality=low', 'monster');
  const { page } = s;
  const me = s.id('monster');
  await s.send({ kind: 'teleport', target: me, x: 18, y: 16, face: 0 });
  // 근접 원(1.5타일) 안: 조준 방향과 상관없이 괴물에게 보인다
  await s.send({ kind: 'teleport', target: s.id('runner'), x: 19.1, y: 16 });
  await s.send({ kind: 'teleport', target: s.id('scout'), x: 18, y: 17.1 });
  await settle(page);
  await waitCamera(page);
  await openBig(page, false);
  // 화면 해상도 바닥은 연 뒤 몇 프레임에 나눠 굽는다 — 다 구운 뒤의 그림을 본다
  await expect.poll(async () => (await prefs(page)).minimapBig.sharpReady).toBe(true);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  const p = await prefs(page);
  expect(p.minimapBig.tex.w).toBeGreaterThan(p.minimapBig.smallTexW);
  const big = await page.evaluate(() => window.__DECOY__!.getDrawnMinimapBig());
  const survivors = big
    .map((d, i) => ({ d, f: p.minimapBig.frames[i] }))
    .filter((x) => x.d.kind === 'survivor');
  expect(survivors.length).toBeGreaterThanOrEqual(1);
  for (const x of survivors) expect(x.f).toBe('m:hidden');
  for (const f of p.minimapBig.frames) expect(['m:runner', 'm:guard', 'm:scout']).not.toContain(f);
  await closeBig(page);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('지도 크게 보기 선명도 (태블릿 1024×640 배율 2.5 · 터치 품질 낮음): 바닥이 화면 기기 px 이상 · 예전보다 선명 · 같은 그림, 예산 안', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser, TABLET_LANDSCAPE);
  await page.goto('/?bots=1&debug=hook&renderer=canvas&quality=low');
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await press(page.getByTestId('create-room'));
  await press(page.getByTestId('role-runner'));
  await press(page.getByTestId('ready-button'));
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 5);
  await waitForTouchTarget(page, 'move-zone');
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  const truth = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string }[];
  };
  for (const pl of truth.players)
    await page.evaluate(
      (id) => window.__DECOY__?.sendTest({ kind: 'freeze', target: id, frozen: true }),
      pl.id,
    );
  // 판 직전 위치 표시 · 시작 문구가 지나가고 장식 시계를 멈춘다
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await waitCamera(page);
  const r = await compare(page, '태블릿 1024×640@2.5 낮음', true);
  const big = r.p.minimapBig;
  expect(big.tex.w).toBeGreaterThanOrEqual(Math.floor(big.needW));
  expect(big.tex.w).toBeGreaterThan(big.smallTexW);
  expect(r.after.detail / r.before.detail).toBeGreaterThan(1.25);
  expect(r.after.sharp / r.before.sharp).toBeGreaterThan(1.15);
  expect(cellDiff(r.before, r.after)).toBeLessThan(6);
  expect(r.openBytes).toBeLessThanOrEqual(LOW_BUDGET);
  expect(problems).toEqual([]);
  await context.close();
});
