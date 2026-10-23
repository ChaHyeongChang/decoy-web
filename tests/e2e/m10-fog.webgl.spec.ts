// M10a 안개 GPU 합성 (WebGL · SwiftShader · 탭 1개 · 봇 방): 품질 높음(경계 셰이더) · 중간의 GPU 합성이
// Canvas 한 장 합성과 같은 밝기를 내고(±3), 콘솔 에러 · 경고(셰이더 컴파일 경고 포함)가 0이다.
// SwiftShader는 GPU가 아니라서 FPS는 기록만 한다. 판 중 자동 하향(FPS 40 미만)은 SwiftShader에서 거의 반드시
// 일어나므로 페이지를 열자마자 FPS를 60으로 덮어써 막고, 고른 품질 그대로 쟀는지(하향 0회) 단언한다.
// 하향 자체는 m10-quality.spec.ts가 검사한다. 텍스처 메모리(안개 · 미니맵 텍스처 source 바이트)도 기록 · 단언한다.
// 따라가는 카메라: 밝기 비교 · 숨은 상대 픽셀 시험은 맵 곳곳의 고정 탐침을 한 화면에서 재므로 맵 전체 고정 화면(?cam=1)에서
// 돈다(카메라와 무관한 안개 · 그림 성질). 확대 화면의 숨은 상대 픽셀은 camera.webgl.spec.ts, 텍스처 예산은 기본 확대(②)로 잰다.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CAPTURE_POINTS, type TestCommand } from '@decoy/shared';
import { CAM1 } from './helpers';
import { pillarBlocks, pillarNeon } from '../../client/src/art/mapArtGeom';

interface Probe {
  rgb: [number, number, number];
  luma: number;
}

/** 스크린샷을 찍어 타일 좌표 주변 9×9 픽셀의 평균 색과 밝기를 잰다 */
async function probe(page: Page, tiles: Record<string, [number, number]>): Promise<Record<string, Probe>> {
  const shot = await page.screenshot();
  return page.evaluate(
    async ({ b64, tiles }) => {
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
      const out: Record<string, { rgb: [number, number, number]; luma: number }> = {};
      for (const [name, [tx, ty]] of Object.entries(tiles)) {
        const p = window.__DECOY__?.tileToClient(tx, ty);
        if (!p) throw new Error('tileToClient 없음');
        const cx = Math.round(p.x);
        const cy = Math.round(p.y);
        let r = 0;
        let g = 0;
        let bl = 0;
        let n = 0;
        for (let y = cy - 4; y <= cy + 4; y += 1) {
          for (let x = cx - 4; x <= cx + 4; x += 1) {
            const i = (y * c.width + x) * 4;
            r += data[i] ?? 0;
            g += data[i + 1] ?? 0;
            bl += data[i + 2] ?? 0;
            n += 1;
          }
        }
        const lum = 0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (bl / n);
        out[name] = {
          rgb: [Math.round(r / n), Math.round(g / n), Math.round(bl / n)],
          luma: Math.round(lum * 10) / 10,
        };
      }
      return out;
    },
    { b64: shot.toString('base64'), tiles },
  );
}

const P_FLOOR: [number, number] = [21.5, 27.5];
const P_WALL: [number, number] = [17.5, 27.5];
// 발광 탐침 (발광은 곱하기 앞: 어둠 속 약 30%, 빛 속 100%). Canvas 합성은 발광을 정적 맵에 구워 곱하므로 구조상 '곱하기 앞'이다.
// GPU 합성(발광 스프라이트)이 같은 자리에서 Canvas와 같은 밝기면 발광도 곱하기 앞에 있다
//  - 기둥(23~24 × 24~25) 앞면 네온 가운데: 기둥 칸은 판정 영역(시야 다각형) 밖이라 늘 어둠 속
//  - 거점 A 단말 화면 발광(mapArt bakeGlow: 중심 (8, 15.98)): 바닥 위라 시야 안 · 밖을 둘 다 잰다
const PILLAR = pillarBlocks().find((b) => b.x0 === 23 && b.y0 === 24)!;
const PILLAR_NEON = pillarNeon(PILLAR);
const P_NEON: [number, number] = [(PILLAR_NEON.x0 + PILLAR_NEON.x1) / 2, PILLAR_NEON.y0];
const P_HALO: [number, number] = [CAPTURE_POINTS.A.x, CAPTURE_POINTS.A.y - 0.02];
// 숨은 상대 자리 (m10-fog.spec.ts와 같은 배치): 괴물 (38.5, 29.5) 동쪽을 봄, 생존자 (31, 30)은 괴물 등 뒤 7.5타일
const M_SPOT: [number, number] = [38.5, 29.5];
/** 러너 (21.5, 25)의 시야 안 3.5타일, 사이에 막힘 없는 바닥 (괴물이 보이며 걷는 자리) */
const SEEN_SPOT: [number, number] = [22.5, 28.4];
const S_SPOT: [number, number] = [31, 30];
const MB = 1024 * 1024;
/** 텍스처 메모리 예산 (MOBILE_PLAN M10 검증: 높음 32MB · 낮음 8MB) */
const TEXTURE_BUDGET = { high: 32 * MB, medium: 32 * MB, low: 8 * MB } as const;

interface Run {
  renderer: string;
  fogMode: string;
  quality: string;
  fogShader: boolean | number | string | undefined;
  downgrades: number;
  textureBytes: number;
  lit: number;
  dark: number;
  wall: number;
  /** 어둠 속 기둥 앞면 네온 · 시야 안 · 밖 거점 단말 발광 (9×9 평균 밝기) */
  neonDark: number;
  haloLit: number;
  haloDark: number;
  fps: number;
  problems: string[];
}

interface Session {
  context: BrowserContext;
  page: Page;
  problems: string[];
  send(cmd: TestCommand): Promise<void>;
  id(role: string): string;
}

/** 봇 방을 열어 role(기본 러너)로 시작한다 (FPS는 60으로 덮어써 판 중 자동 하향을 막는다) */
async function startRunner(
  browser: Browser,
  query: string,
  deviceScaleFactor = 1,
  role = 'runner',
): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor });
  const page = await context.newPage();
  const problems: string[] = [];
  // 이 검사는 거르지 않는다: 셰이더 컴파일 경고 · GL 경고 · 텍스처 프레임 경고도 문제로 센다
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`/?bots=1&debug=hook${query}`);
  // 덮어쓴 FPS는 페이지 모듈 전역이라 판 장면이 다시 시작돼도 남는다. __DECOY__.fps(실측) 기록은 오염되지 않는다
  await page.waitForFunction(() => window.__DECOY__ !== undefined);
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await page.getByTestId('create-room').click();
  await page.getByTestId(`role-${role}`).click();
  await page.getByTestId('ready-button').click();
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 5, null, { timeout: 30_000 });
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  const truth = (await (await page.request.get(`/test/state?room=${room}`)).json()) as {
    players: { id: string; role: string }[];
  };
  const id = (role: string): string => truth.players.find((p) => p.role === role)?.id ?? '';
  const send = (cmd: TestCommand): Promise<void> => page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
  return { context, page, problems, send, id };
}

/** 지금 그래픽 상태 (품질 · 안개 · 하향 횟수 · 텍스처 바이트) */
async function gfxInfo(page: Page): Promise<{
  renderer: string;
  fogMode: string;
  quality: string;
  fogShader: boolean | number | string | undefined;
  downgrades: number;
  textureBytes: number;
}> {
  return page.evaluate(() => {
    const d = window.__DECOY__;
    return {
      renderer: d?.renderer ?? 'none',
      fogMode: d?.gfx.fogMode ?? '',
      quality: d?.gfx.quality ?? '',
      fogShader: d?.gfx.features.fogShader,
      downgrades: d?.gfx.downgrades ?? -1,
      textureBytes: Number(d?.gfx.features.textureBytes ?? 0),
    };
  });
}

/** 봇 방을 열어 러너로 시작하고, 같은 배치에서 시야 안 · 밖 밝기를 잰다 */
async function measure(browser: Browser, query: string): Promise<Run> {
  const { context, page, problems, send, id } = await startRunner(browser, query);
  // 봇은 멈추고, 괴물 봇은 생존자가 안 보이는 B 방 안쪽
  await send({ kind: 'teleport', target: id('scout'), x: 45, y: 2 });
  await send({ kind: 'teleport', target: id('guard'), x: 31, y: 30 });
  await send({ kind: 'teleport', target: id('monster'), x: 44.5, y: 12.5, face: 0 });
  await send({ kind: 'teleport', target: id('runner'), x: 21.5, y: 25 });
  for (const r of ['scout', 'guard', 'monster']) await send({ kind: 'freeze', target: id(r), frozen: true });
  await page.mouse.move(10, 10);
  await page.keyboard.press('KeyX');
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await page.waitForTimeout(800);
  const lit = await probe(page, { floor: P_FLOOR });
  // 거점 A 단말을 시야 안에 (판정 반경 밖에 서서 점령 연출 없이)
  await send({ kind: 'teleport', target: id('runner'), x: 8, y: 19 });
  await page.waitForTimeout(800);
  const litHalo = await probe(page, { halo: P_HALO });
  await send({ kind: 'teleport', target: id('runner'), x: 5, y: 2 });
  await page.waitForTimeout(800);
  const dark = await probe(page, { floor: P_FLOOR, wall: P_WALL, neon: P_NEON, halo: P_HALO });
  const info = await gfxInfo(page);
  // FPS 기록 (2초)
  await page.evaluate(() => window.__DECOY__?.freezeClock(null));
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(() => window.__DECOY__?.fps ?? 0);
  await context.close();
  return {
    ...info,
    lit: lit.floor!.luma,
    dark: dark.floor!.luma,
    wall: dark.wall!.luma,
    neonDark: dark.neon!.luma,
    haloLit: litHalo.halo!.luma,
    haloDark: dark.halo!.luma,
    fps: Math.round(fps * 10) / 10,
    problems,
  };
}

test('GPU 안개(품질 높음 · 중간)가 Canvas 합성과 같은 밝기를 내고 콘솔이 깨끗하다', async ({ browser }) => {
  // SwiftShader에서 1920×1080 봇 판 세 개(canvas 낮음 · webgl 높음 · 중간)를 연다 (CI 러너에서 판 하나 최대 약 50초)
  test.setTimeout(300_000);
  const canvas = await measure(browser, `&renderer=canvas&quality=low${CAM1}`);
  expect(canvas.renderer).toBe('canvas');
  expect(canvas.fogMode).toBe('canvas');
  expect(canvas.fogShader).toBe(false);
  expect(canvas.quality).toBe('low');
  expect(canvas.downgrades).toBe(0);
  expect(canvas.textureBytes).toBeGreaterThan(0);
  expect(canvas.textureBytes).toBeLessThanOrEqual(TEXTURE_BUDGET.low);
  // 빈 통과가 아님: 단말 발광 자리가 시야 안에서 실제로 밝고, 어둠 속 네온이 옆 벽보다 밝다(발광이 있다)
  expect(canvas.haloLit).toBeGreaterThanOrEqual(canvas.haloDark * 2);
  expect(canvas.neonDark).toBeGreaterThan(canvas.wall + 3);
  for (const q of ['high', 'medium'] as const) {
    const gl = await measure(browser, `&renderer=webgl&quality=${q}${CAM1}`);
    console.log(`[m10-fog.webgl] ${q}: ${JSON.stringify(gl)} / canvas: ${JSON.stringify(canvas)}`);
    expect(gl.renderer).toBe('webgl');
    expect(gl.fogMode).toBe('gpu');
    // 고른 품질 그대로 쟀다 (판 중 하향으로 '높음' 회차가 중간을 재고 통과하지 않게)
    expect(gl.quality).toBe(q);
    expect(gl.downgrades).toBe(0);
    // 경계 셰이더는 품질 높음에서만
    expect(gl.fogShader).toBe(q === 'high');
    expect(gl.textureBytes).toBeGreaterThan(0);
    expect(gl.textureBytes).toBeLessThanOrEqual(TEXTURE_BUDGET[q]);
    // 같은 장면에서 두 경로의 밝기 차 ±3
    expect(Math.abs(gl.lit - canvas.lit)).toBeLessThanOrEqual(3);
    expect(Math.abs(gl.dark - canvas.dark)).toBeLessThanOrEqual(3);
    expect(Math.abs(gl.wall - canvas.wall)).toBeLessThanOrEqual(3);
    // 발광은 곱하기 앞 (T6): 어둠 속 네온 · 시야 안 · 밖 단말 발광이 Canvas(발광을 구워 곱함)와 ±3,
    // 시야 밖/안 비율도 Canvas만큼 (곱하기 뒤로 가면 어둠 속 발광이 G×(1−하한)만큼 밝아져 여기서 걸린다)
    expect(Math.abs(gl.neonDark - canvas.neonDark)).toBeLessThanOrEqual(3);
    expect(Math.abs(gl.haloLit - canvas.haloLit)).toBeLessThanOrEqual(3);
    expect(Math.abs(gl.haloDark - canvas.haloDark)).toBeLessThanOrEqual(3);
    expect(gl.haloDark / gl.haloLit).toBeLessThanOrEqual(canvas.haloDark / canvas.haloLit + 0.05);
    // 구조가 보이고 시야 안이 충분히 밝다 (Canvas 검사와 같은 기준)
    expect(gl.dark).toBeGreaterThanOrEqual(6);
    expect(gl.lit).toBeGreaterThanOrEqual(gl.dark * 2.5);
    expect(gl.problems).toEqual([]);
  }
  expect(canvas.problems).toEqual([]);
});

test('품질 높음 1920×1080@2: 안개 · 미니맵 텍스처 메모리가 예산(32MB) 이하이고 콘솔이 깨끗하다', async ({
  browser,
}) => {
  const { context, page, problems } = await startRunner(browser, '&renderer=webgl&quality=high', 2);
  await page.waitForTimeout(1000);
  const info = await gfxInfo(page);
  const res = await page.evaluate(() => {
    const g = window.__DECOY__!.gfx;
    return {
      zoom: g.zoom,
      backingW: g.backingW,
      backingH: g.backingH,
      compositeScale: g.compositeScale,
      chunkAtlasBytes: Number(g.features.chunkAtlasBytes ?? 0),
    };
  });
  await context.close();
  console.log(
    `[m10-fog.webgl] 높음 1920×1080@2 텍스처 바이트 ${info.textureBytes} (${(info.textureBytes / MB).toFixed(2)}MiB), ${JSON.stringify(res)}`,
  );
  expect(info.renderer).toBe('webgl');
  expect(info.quality).toBe('high');
  expect(info.fogMode).toBe('gpu');
  expect(info.downgrades).toBe(0);
  expect({ zoom: res.zoom, backingW: res.backingW, backingH: res.backingH }).toEqual({
    zoom: 2,
    backingW: 3840,
    backingH: 2160,
  });
  // 따라가는 카메라: 정적 맵은 창 둘레 조각 아틀라스로 올리고, 합성 배율은 맵 그림 텍셀 상한(presets.mapTexels)이 자른다
  // (배율 2 그대로면 창 + 여유 조각만으로 예산을 넘는다)
  expect(res.compositeScale).toBeGreaterThan(1);
  expect(res.compositeScale).toBeLessThan(2);
  // 빈 통과가 아님: 조각 아틀라스(약 12.8MiB)가 실제로 들어 있다
  expect(res.chunkAtlasBytes).toBeGreaterThan(10 * MB);
  expect(info.textureBytes).toBeGreaterThan(20 * MB);
  expect(info.textureBytes).toBeLessThanOrEqual(TEXTURE_BUDGET.high);
  expect(problems).toEqual([]);
});

test('새 캐릭터 스타일 · 품질 높음 1920×1080@2: 자세별 캐릭터 아틀라스를 더해도 텍스처 메모리가 예산(32MB) 이하이고 콘솔이 깨끗하다', async ({
  browser,
}) => {
  const { context, page, problems } = await startRunner(browser, '&renderer=webgl&quality=high&chars=new', 2);
  await page.waitForTimeout(1000);
  const info = await gfxInfo(page);
  const extra = await page.evaluate(() => {
    const g = window.__DECOY__!.gfx;
    return {
      style: g.charStyle,
      baked: String(g.features.atlasStyle ?? ''),
      zoom: g.zoom,
      atlasBytes: Number(g.features.atlasBytes ?? 0),
    };
  });
  await context.close();
  console.log(
    `[m10-fog.webgl] 새 스타일 높음 1920×1080@2 텍스처 바이트 ${info.textureBytes} (${(info.textureBytes / MB).toFixed(2)}MiB), 캐릭터 아틀라스 ${(extra.atlasBytes / MB).toFixed(2)}MiB`,
  );
  expect(extra.style).toBe('new');
  // 실제로 구운 아틀라스도 새 스타일 (설정값이 아니라 굽기 기록)
  expect(extra.baked).toBe('new');
  expect(extra.zoom).toBe(2);
  expect(info.renderer).toBe('webgl');
  expect(info.quality).toBe('high');
  expect(info.downgrades).toBe(0);
  // 빈 통과가 아님: 새 스타일 아틀라스(자세 프레임 100여 장)는 기존보다 크다 — 확대 3 품질 높음(텍셀 상한 4)에서 새 약 7.3MiB,
  // 기존 약 3.9MiB (PERF 4.4)
  expect(extra.atlasBytes).toBeGreaterThan(5 * MB);
  expect(info.textureBytes).toBeGreaterThan(20 * MB);
  expect(info.textureBytes).toBeLessThanOrEqual(TEXTURE_BUDGET.high);
  expect(problems).toEqual([]);
});

/** 상대를 시야 밖에서 걷게(작은 순간이동을 잇달아) 하며 자리 픽셀을 여러 번 잰 뒤, 상대를 멀리 보낸 같은 자리 빈 바닥과 비교한다 */
async function hiddenVsEmpty(
  s: Session,
  target: string,
  spot: [number, number],
  away: { x: number; y: number },
): Promise<{ maxChannel: number; maxLumaDiff: number; samples: number; empty: Probe & { maxLuma: number } }> {
  const { page, send } = s;
  const look = (): Promise<Record<string, Probe & { maxLuma: number }>> => probeMax(page, { spot }, 12);
  const seen: (Probe & { maxLuma: number })[] = [];
  for (let n = 0; n < 8; n += 1) {
    // 0.3타일씩 오가며 걷는다 (발먼지 · 걸음 위상이 생길 거리). 순간이동은 멈춤을 풀므로 다시 멈춘다
    await send({ kind: 'teleport', target, x: spot[0] + (n % 2) * 0.3, y: spot[1], face: 0 });
    await send({ kind: 'freeze', target, frozen: true });
    await page.waitForTimeout(120);
    seen.push((await look()).spot!);
  }
  await send({ kind: 'teleport', target, x: away.x, y: away.y, face: 0 });
  await send({ kind: 'freeze', target, frozen: true });
  await page.waitForTimeout(800);
  const empty = (await look()).spot!;
  let maxChannel = 0;
  let maxLumaDiff = 0;
  for (const p of seen) {
    for (let k = 0; k < 3; k += 1) maxChannel = Math.max(maxChannel, Math.abs(p.rgb[k]! - empty.rgb[k]!));
    maxLumaDiff = Math.max(maxLumaDiff, Math.abs(p.maxLuma - empty.maxLuma));
  }
  return { maxChannel, maxLumaDiff, samples: seen.length, empty };
}

/** probe와 같고, 창 안 가장 밝은 픽셀 밝기도 잰다 */
async function probeMax(
  page: Page,
  tiles: Record<string, [number, number]>,
  half: number,
): Promise<Record<string, Probe & { maxLuma: number }>> {
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
        for (let y = cy - half; y <= cy + half; y += 1)
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
        out[name] = {
          rgb: [r / n, g / n, bl / n],
          luma: Math.round(luma(r / n, g / n, bl / n) * 10) / 10,
          maxLuma: Math.round(max * 10) / 10,
        };
      }
      return out;
    },
    { b64: shot.toString('base64'), tiles, half },
  );
}

for (const q of ['high', 'medium'] as const) {
  test(`품질 ${q}(WebGL): 시야 밖에서 걷는 상대 자리 픽셀 = 같은 자리 빈 바닥 (발먼지 · 빛 속 먼지 · 눈빛 · 발광 흔적 없음)`, async ({
    browser,
  }) => {
    // SwiftShader에서 판 두 개(러너 · 괴물 화면)를 연다. CI 러너에서 한 번에 2.7~4.2분이 들어 그 두 배 남짓
    test.setTimeout(600_000);
    const query = `&renderer=webgl&quality=${q}${CAM1}`;
    // 러너 화면: 괴물이 팀 시야 밖에서 걷는다
    const r = await startRunner(browser, query);
    await r.send({ kind: 'teleport', target: r.id('scout'), x: 45, y: 2 });
    await r.send({ kind: 'teleport', target: r.id('guard'), x: S_SPOT[0], y: S_SPOT[1] });
    await r.send({ kind: 'teleport', target: r.id('runner'), x: 21.5, y: 25 });
    for (const role of ['scout', 'guard', 'monster'])
      await r.send({ kind: 'freeze', target: r.id(role), frozen: true });
    await r.page.mouse.move(10, 10);
    await r.page.keyboard.press('KeyX');
    await r.page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
      timeout: 15_000,
    });
    await r.page.evaluate(() => window.__DECOY__?.freezeClock(1000));
    // 1) 괴물이 러너 시야 안(3.5타일)에서 걸어 발먼지 · 눈빛을 실제로 만든 뒤 시야 밖으로 나간다: 떠난 자리 = 빈 바닥
    //    (상대 잔여 효과는 출처가 스냅샷에서 사라지면 바로 0. 장식 시계가 멈춰 있어 시간으로는 사라지지 않는다)
    const departed = await probeMax(r.page, { spot: SEEN_SPOT }, 12);
    let sawMonster = false;
    for (let n = 0; n < 8; n += 1) {
      const x = SEEN_SPOT[0] + (n % 2) * 0.3;
      await r.send({ kind: 'teleport', target: r.id('monster'), x, y: SEEN_SPOT[1], face: 0 });
      await r.send({ kind: 'freeze', target: r.id('monster'), frozen: true });
      await r.page.waitForTimeout(150);
      const seen = await r.page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.monster ?? null);
      sawMonster ||= seen !== null;
    }
    // 2) 시야 밖에서 걷는 괴물 자리 = 같은 자리 빈 바닥
    const runnerView = await hiddenVsEmpty(r, r.id('monster'), M_SPOT, { x: 44.5, y: 12.5 });
    const afterLeave = await probeMax(r.page, { spot: SEEN_SPOT }, 12);
    const opp = await r.page.evaluate(() => window.__DECOY__?.getEffects().oppFx ?? -1);
    const snap = await r.page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.monster ?? null);
    const gfxR = await gfxInfo(r.page);
    await r.context.close();
    // 괴물 화면: 등 뒤 생존자(가드)가 부채꼴 · 근접 원 밖에서 걷는다
    const m = await startRunner(browser, query, 1, 'monster');
    await m.send({ kind: 'teleport', target: m.id('scout'), x: 45, y: 2 });
    await m.send({ kind: 'teleport', target: m.id('runner'), x: 3, y: 2 });
    await m.send({ kind: 'teleport', target: m.id('guard'), x: S_SPOT[0], y: S_SPOT[1] });
    await m.send({ kind: 'teleport', target: m.id('monster'), x: M_SPOT[0], y: M_SPOT[1], face: 0 });
    for (const role of ['scout', 'guard', 'runner'])
      await m.send({ kind: 'freeze', target: m.id(role), frozen: true });
    const east = await m.page.evaluate(
      ([x, y]) => window.__DECOY__?.tileToClient(x!, y!) ?? null,
      [M_SPOT[0] + 4, M_SPOT[1]],
    );
    await m.page.mouse.move(east!.x, east!.y);
    await m.page.keyboard.press('KeyX');
    await m.page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
      timeout: 15_000,
    });
    await m.page.evaluate(() => window.__DECOY__?.freezeClock(1000));
    const monsterView = await hiddenVsEmpty(m, m.id('guard'), S_SPOT, { x: 3, y: 28 });
    const survivorsSeen = await m.page.evaluate(
      () => window.__DECOY__?.getLastSnapshot()?.survivors.length ?? -1,
    );
    const gfxM = await gfxInfo(m.page);
    await m.context.close();
    console.log(
      `[m10-fog.webgl] ${q} 숨은 상대 자리: 러너 화면 ${JSON.stringify(runnerView)} / 괴물 화면 ${JSON.stringify(monsterView)} / 떠난 자리 ${JSON.stringify({ departed: departed.spot, afterLeave: afterLeave.spot, opp, sawMonster })}`,
    );
    for (const g of [gfxR, gfxM]) {
      expect(g.quality).toBe(q);
      expect(g.fogMode).toBe('gpu');
      expect(g.downgrades).toBe(0);
    }
    // 서버가 좌표를 보내지 않았다 (전제). 빈 통과가 아님: 시야 안에서 걷는 괴물은 실제로 보였다
    expect(snap).toBeNull();
    expect(sawMonster).toBe(true);
    expect(opp).toBe(0);
    for (let k = 0; k < 3; k += 1)
      expect(Math.abs(afterLeave.spot!.rgb[k]! - departed.spot!.rgb[k]!)).toBeLessThanOrEqual(4);
    expect(Math.abs(afterLeave.spot!.maxLuma - departed.spot!.maxLuma)).toBeLessThanOrEqual(4);
    expect(survivorsSeen).toBe(0);
    // 걷는 동안 여러 번 잰 자리 = 빈 바닥 (채널마다 ±4, 창 안 가장 밝은 픽셀도 ±4), 구조가 보이는 밝기
    for (const v of [runnerView, monsterView]) {
      expect(v.samples).toBe(8);
      expect(v.maxChannel).toBeLessThanOrEqual(4);
      expect(v.maxLumaDiff).toBeLessThanOrEqual(4);
      expect(v.empty.luma).toBeGreaterThanOrEqual(6);
    }
    expect(r.problems).toEqual([]);
    expect(m.problems).toEqual([]);
  });
}
