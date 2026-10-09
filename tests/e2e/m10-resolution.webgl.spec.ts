// M10a 선명도 (WebGL 1탭, SwiftShader): 백버퍼 = 표시 CSS × min(DPR, 상한), 캔버스 위치가 기기 픽셀 정수,
// 글자 해상도 = zoom(실제 글자 객체를 잰다: textAudit), 선명도 탐침(캔버스 글자 / 같은 글꼴 DOM 글자 ≥ 0.9),
// 창 크기 변경 뒤 백버퍼 · 기존 글자 다시 그리기 · 조준, 자동 품질(소프트웨어 GL = 낮음, 하드웨어 GPU PC = 높음)
// 판 중 자동 하향은 FPS 60을 넣어 막는다 (SwiftShader는 큰 백버퍼에서 40fps 아래라 타이밍에 따라 결과가 달라진다).
// 하향 자체는 m10-quality · m10-quality.webgl에서 본다
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { GfxDebugInfo, Role, TextAudit } from '@decoy/shared';
import { PRESETS } from '../../client/src/gfx/presets';
import { pickRoleAndReady, truth, waitForSnapshots, watchConsole } from './helpers';

const QUERY = '?bots=1&debug=hook&renderer=webgl';
const HIGH = PRESETS.high;
const UI_FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

const SCREENS = [
  { name: '맥북 1440×900 @2', viewport: { width: 1440, height: 900 }, dsf: 2 },
  { name: 'QHD 2560×1440 @1', viewport: { width: 2560, height: 1440 }, dsf: 1 },
  { name: 'FHD 1920×1080 @1.25', viewport: { width: 1920, height: 1080 }, dsf: 1.25 },
  { name: '윈도 노트북 창 1536×730 @1.25', viewport: { width: 1536, height: 730 }, dsf: 1.25 },
  { name: '1080p 브라우저 창 1920×969 @1', viewport: { width: 1920, height: 969 }, dsf: 1 },
] as const;

interface CanvasInfo {
  backingW: number;
  backingH: number;
  left: number;
  top: number;
  cssW: number;
  cssH: number;
  dpr: number;
  gfx: GfxDebugInfo;
}

async function canvasInfo(page: Page): Promise<CanvasInfo> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#game-root canvas');
    if (!c || !window.__DECOY__) throw new Error('캔버스 · 디버그 훅이 없다');
    const r = c.getBoundingClientRect();
    return {
      backingW: c.width,
      backingH: c.height,
      left: r.left,
      top: r.top,
      cssW: r.width,
      cssH: r.height,
      dpr: window.devicePixelRatio,
      gfx: window.__DECOY__.gfx,
    };
  });
}

/** 혼자(봇과) 방을 만들고 판을 시작한다. 방 코드를 돌려준다 */
async function startSolo(page: Page, extra: string, role: Role): Promise<string> {
  await page.goto(`/${QUERY}${extra}`);
  // 판 중 자동 하향을 막는다 (덮어쓴 FPS는 페이지 전역이라 판 시작 전에 넣어도 된다. 기록용 __DECOY__.fps는 그대로)
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  await page.getByTestId('create-room').click();
  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z]{4}$/);
  await pickRoleAndReady(page, role);
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 3);
  return (await code.textContent()) ?? '';
}

function expectBacking(i: CanvasInfo, label: string): void {
  // 이 다섯 화면에서는 픽셀 상한(8.3MP)이 걸리지 않는다
  const k = Math.min(i.dpr, HIGH.dprCap);
  expect(Math.abs(i.backingW - Math.round(i.cssW * k)), `${label} 백버퍼 폭`).toBeLessThanOrEqual(1);
  expect(Math.abs(i.backingH - Math.round(i.cssH * k)), `${label} 백버퍼 높이`).toBeLessThanOrEqual(1);
}

async function textAudit(page: Page): Promise<TextAudit> {
  return page.evaluate(() => {
    const h = window.__DECOY__;
    if (!h) throw new Error('디버그 훅이 없다');
    return h.textAudit();
  });
}

/** 장면의 모든 글자(숨긴 글자 · 탐침 포함)가 해상도 = zoom이고 왼쪽 위가 백버퍼 픽셀 격자에 있다 */
function expectTexts(a: TextAudit, zoom: number, label: string): void {
  expect(a.count, `${label} 글자 수`).toBeGreaterThan(0);
  expect([a.styleResMin, a.styleResMax], `${label} 글자 해상도`).toEqual([zoom, zoom]);
  expect([a.sourceResMin, a.sourceResMax], `${label} 텍스처 해상도`).toEqual([zoom, zoom]);
  expect(a.gridErrMax, `${label} 격자 어긋남`).toBeLessThan(1e-3);
}

function expectAligned(i: CanvasInfo, label: string): void {
  const lx = i.left * i.dpr;
  const ty = i.top * i.dpr;
  expect(Math.abs(lx - Math.round(lx)), `${label} 왼쪽 ${i.left} × ${i.dpr}`).toBeLessThanOrEqual(0.01);
  expect(Math.abs(ty - Math.round(ty)), `${label} 위 ${i.top} × ${i.dpr}`).toBeLessThanOrEqual(0.01);
}

/** 렌더 프레임이 몇 번 지나가게 (SwiftShader는 큰 백버퍼에서 느리다) */
async function settleFrames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let left = frames;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

interface EdgeStats {
  /** 경계 선명도(acutance): 강한 경계 상위 0.5%의 한 기기 픽셀 밝기 변화 / 전체 대비. 선명 ≈ 1, 두 픽셀에 번지면 ≈ 0.5 */
  acutance: number;
  /** 중간 밝기(대비의 15~85%) 픽셀 비율. 번지면 늘고, 계단처럼 깨지면 준다 */
  mid: number;
}

/** 스크린샷 PNG를 페이지 안에서 풀어(createImageBitmap → getImageData) 경계 통계를 낸다 (새 의존성 없음) */
async function edgeStats(page: Page, png: Buffer): Promise<EdgeStats> {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d 없음');
    ctx.drawImage(bmp, 0, 0);
    const { data, width: w, height: h } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const gray = new Float64Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
      gray[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000;
    }
    const sorted = Float64Array.from(gray).sort();
    const pct = (p: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
    const lo = pct(0.5);
    const hi = pct(99.5);
    const contrast = Math.max(hi - lo, 1);
    let midCount = 0;
    for (const v of gray) if (v > lo + 0.15 * contrast && v < hi - 0.15 * contrast) midCount += 1;
    const grads: number[] = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = gray[y * w + x]!;
        if (x + 1 < w) grads.push(Math.abs(gray[y * w + x + 1]! - v));
        if (y + 1 < h) grads.push(Math.abs(gray[(y + 1) * w + x]! - v));
      }
    }
    grads.sort((a, b) => a - b);
    const n = Math.max(1, Math.floor(grads.length * 0.005));
    let sum = 0;
    for (let i = grads.length - n; i < grads.length; i += 1) sum += grads[i]!;
    return { acutance: sum / n / contrast, mid: midCount / gray.length };
  }, png.toString('base64'));
}

/**
 * 선명도 탐침: HUD(위 띠 오른쪽)에 알려진 글자를 Phaser로, 아래 띠 오른쪽에 같은 글꼴 · 같은 CSS 크기의 DOM 글자를 그리고
 * 두 영역의 경계 통계를 비교한다. 위치는 일부러 소수로 준다(격자 맞춤 확인)
 */
async function sharpness(
  page: Page,
): Promise<{ canvas: EdgeStats; dom: EdgeStats; ratio: number; midRatio: number }> {
  const TEXT = '가드 11:55 ABC';
  const PX = 28;
  await page.evaluate(({ text, px }) => window.__DECOY__?.probeText(text, 1500.37, 18.41, px), {
    text: TEXT,
    px: PX,
  });
  const rect = await page.evaluate(
    ({ text, px, font }) => {
      const c = document.querySelector<HTMLCanvasElement>('#game-root canvas');
      if (!c) throw new Error('캔버스 없음');
      const r = c.getBoundingClientRect();
      const s = r.width / 1920;
      const div = document.createElement('div');
      div.id = 'sharp-probe-dom';
      div.textContent = text;
      Object.assign(div.style, {
        position: 'fixed',
        left: `${r.left + 1500 * s}px`,
        top: `${r.top + 1022 * s}px`,
        font: `bold ${px * s}px ${font}`,
        color: '#E2E8F0',
        lineHeight: '1.2',
        whiteSpace: 'pre',
        zIndex: '999',
        pointerEvents: 'none',
      });
      document.body.appendChild(div);
      return { left: r.left, top: r.top, s };
    },
    { text: TEXT, px: PX, font: UI_FONT },
  );
  await settleFrames(page, 3);
  await page.waitForTimeout(200);
  const clip = (y: number): { x: number; y: number; width: number; height: number } => ({
    x: rect.left + 1490 * rect.s,
    y: rect.top + y * rect.s,
    width: 400 * rect.s,
    height: 44 * rect.s,
  });
  const canvasPng = await page.screenshot({ clip: clip(16) });
  const domPng = await page.screenshot({ clip: clip(1020) });
  await page.evaluate(() => {
    document.getElementById('sharp-probe-dom')?.remove();
    window.__DECOY__?.probeText('', 0, 0, 10);
  });
  const canvas = await edgeStats(page, canvasPng);
  const dom = await edgeStats(page, domPng);
  return {
    canvas,
    dom,
    ratio: canvas.acutance / dom.acutance,
    midRatio: canvas.mid / Math.max(dom.mid, 1e-6),
  };
}

async function newScreen(
  browser: Browser,
  viewport: { width: number; height: number },
  dsf: number,
): Promise<{ page: Page; problems: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dsf });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  return { page, problems, close: () => context.close() };
}

for (const screen of SCREENS) {
  test(`선명도: ${screen.name}`, async ({ browser }) => {
    const { page, problems, close } = await newScreen(browser, screen.viewport, screen.dsf);
    await startSolo(page, '&quality=high', 'runner');
    const info = await canvasInfo(page);
    expectBacking(info, screen.name);
    expectAligned(info, screen.name);
    expect(info.gfx.quality).toBe('high');
    expect(info.gfx.qualitySource).toBe('url');
    expect(info.gfx.scaleOverride).toBeNull();
    expect(info.gfx.zoom).toBeCloseTo(info.backingW / 1920, 10);
    expectTexts(await textAudit(page), info.gfx.zoom, screen.name);
    expect([info.gfx.backingW, info.gfx.backingH]).toEqual([info.backingW, info.backingH]);
    expect(info.gfx.dpr).toBe(screen.dsf);
    // 백버퍼가 기기 픽셀과 1:1이면 캔버스 CSS는 최근접 (main.ts placeCanvas)
    expect(await imageRendering(page)).toBe('pixelated');
    // 고해상도로 시작하면 WebGL MSAA를 켜지 않는다 (배율 2 4K에서 약 250MiB)
    if (info.gfx.zoom >= 1.25) expect(info.gfx.features.msaaBytes).toBe(0);
    expect(Number(info.gfx.features.msaaBytes)).toBeLessThanOrEqual(1920 * 1080 * 4 * 8);

    const sharp = await sharpness(page);
    console.log(
      `${screen.name}: 백버퍼 ${info.backingW}×${info.backingH}, zoom ${info.gfx.zoom.toFixed(4)}, ` +
        `위치 ${info.left},${info.top}, 선명도 캔버스 ${sharp.canvas.acutance.toFixed(3)} / DOM ${sharp.dom.acutance.toFixed(3)} ` +
        `= ${sharp.ratio.toFixed(2)}, 중간 밝기 비 ${sharp.midRatio.toFixed(2)}`,
    );
    test.info().annotations.push({ type: `sharpness ${screen.name}`, description: sharp.ratio.toFixed(2) });
    expect(sharp.ratio, `${screen.name} 선명도 비`).toBeGreaterThanOrEqual(0.9);
    // 경계 선명도는 가장 강한 경계만 봐서 1.5배 확대처럼 일부 경계가 격자에 맞는 경우를 놓친다(글자 해상도 1로 되돌려 실측:
    // 맥북 0.97, FHD@1.25 0.99). 중간 밝기 픽셀 비율이 DOM과 같은지도 본다(실측: 고친 뒤 0.96~1.04, 해상도 1이면 0.81~2.13)
    expect(sharp.midRatio, `${screen.name} 중간 밝기 비`).toBeGreaterThanOrEqual(0.83);
    expect(sharp.midRatio, `${screen.name} 중간 밝기 비`).toBeLessThanOrEqual(1.2);
    expect(problems).toEqual([]);
    await close();
  });
}

async function imageRendering(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#game-root canvas');
    return c ? getComputedStyle(c).imageRendering : '';
  });
}

// 백버퍼가 기기 픽셀보다 작아 브라우저가 늘려 그리는 경우(품질 해상도 상한 · ?scale): 최근접이면 1.25 · 1.33배에서
// 4~5칸마다 줄이 복제되어 획 두께가 들쭉날쭉해진다 → 부드럽게 늘린다
for (const c of [
  {
    name: '배율 1.25 · 품질 낮음(상한 1배)',
    viewport: { width: 1920, height: 1080 },
    dsf: 1.25,
    extra: '&quality=low',
  },
  {
    name: '배율 2 · 품질 중간(상한 1.5배)',
    viewport: { width: 1440, height: 900 },
    dsf: 2,
    extra: '&quality=medium',
  },
  { name: '배율 1 · ?scale=0.5', viewport: { width: 1280, height: 720 }, dsf: 1, extra: '&scale=0.5' },
] as const) {
  test(`늘려 그릴 때는 부드럽게: ${c.name}`, async ({ browser }) => {
    const { page, problems, close } = await newScreen(browser, c.viewport, c.dsf);
    await startSolo(page, c.extra, 'runner');
    const info = await canvasInfo(page);
    expect(info.backingW).toBeLessThan(Math.round(info.cssW * info.dpr) - 1);
    expect(await imageRendering(page)).toBe('auto');
    expect(problems).toEqual([]);
    await close();
  });
}

/** 하드웨어 GPU PC로 보이게: WebGL 렌더러 이름(RENDERER · UNMASKED_RENDERER_WEBGL)만 바꾼다 */
const FAKE_GPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';

test('자동 품질: 하드웨어 GPU PC로 보이면 기본 주소에서 높음 (로비까지)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript((name: string) => {
    const RENDERER = 0x1f01;
    const UNMASKED_RENDERER_WEBGL = 0x9246;
    const wrap = (proto: WebGLRenderingContext | WebGL2RenderingContext): void => {
      const orig = proto.getParameter;
      proto.getParameter = function (this: WebGLRenderingContext, pname: number): unknown {
        if (pname === RENDERER || pname === UNMASKED_RENDERER_WEBGL) return name;
        return orig.call(this, pname) as unknown;
      };
    };
    wrap(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') wrap(WebGL2RenderingContext.prototype);
  }, FAKE_GPU);
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  // 기본 주소: ?quality 없음, 저장값 없음(새 컨텍스트)
  await page.goto('/?debug=hook');
  await expect(page.getByTestId('create-room')).toBeVisible();
  const glName = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    return gl ? String(gl.getParameter(gl.RENDERER)) : '';
  });
  expect(glName).toBe(FAKE_GPU);
  expect(await page.evaluate((k) => localStorage.getItem(k), 'decoy:quality')).toBeNull();
  const info = await canvasInfo(page);
  expect(info.gfx.renderer).toBe('webgl');
  expect([info.gfx.quality, info.gfx.qualitySource]).toEqual(['high', 'auto']);
  expect(info.gfx.touch).toBe(false);
  expect(info.gfx.scaleOverride).toBeNull();
  // 높음 상한(배율 2): 1440×810 × 2
  expectBacking(info, '맥북 1440×900 @2 자동');
  expect([info.backingW, info.backingH]).toEqual([2880, 1620]);
  expect(problems).toEqual([]);
  await context.close();
});

test('자동 품질(소프트웨어 WebGL = 낮음) · ?scale 빈 값', async ({ browser }) => {
  const { page, problems, close } = await newScreen(browser, { width: 1920, height: 969 }, 1);
  // 위장 없음: webgl 프로젝트는 GPU 없는 SwiftShader로 돈다(playwright.config.ts) → 자동 = 낮음
  await page.goto(`/${QUERY}`);
  await expect(page.getByTestId('create-room')).toBeVisible();
  const auto = await canvasInfo(page);
  expect(auto.gfx.renderer).toBe('webgl');
  expect([auto.gfx.quality, auto.gfx.qualitySource]).toEqual(['low', 'auto']);
  expect(auto.gfx.touch).toBe(false);
  expect(auto.gfx.scaleOverride).toBeNull();
  expect([auto.backingW, auto.backingH]).toEqual([1723, 969]);

  // ?scale=(빈 값)은 지정 없음과 같다 (예전에는 0.25배 → 480×270)
  await page.goto(`/${QUERY}&quality=high`);
  await expect(page.getByTestId('create-room')).toBeVisible();
  const base = await canvasInfo(page);
  for (const empty of ['&scale=', '&scale=0', '&scale=%20']) {
    await page.goto(`/${QUERY}&quality=high${empty}`);
    await expect(page.getByTestId('create-room')).toBeVisible();
    const i = await canvasInfo(page);
    expect(i.gfx.scaleOverride, empty).toBeNull();
    expect(i.gfx.zoom, empty).toBe(base.gfx.zoom);
    expect([i.backingW, i.backingH], empty).toEqual([base.backingW, base.backingH]);
  }
  // 옛 &scale=0.5 링크: 해상도 절반 (표시 크기는 같다)
  await page.goto(`/${QUERY}&quality=high&scale=0.5`);
  await expect(page.getByTestId('create-room')).toBeVisible();
  const half = await canvasInfo(page);
  expect(half.gfx.scaleOverride).toBe(0.5);
  expect(Math.abs(half.backingW - base.backingW / 2)).toBeLessThanOrEqual(1);
  // 백버퍼를 정수로 반올림하므로 표시 크기는 백버퍼 1px(= CSS 2px)만큼 다를 수 있다
  expect(Math.abs(half.cssW - base.cssW)).toBeLessThanOrEqual(2);
  expect(problems).toEqual([]);
  await close();
});

function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

test('창 크기 · DPR 변경 뒤 백버퍼가 따라가고 괴물 조준이 맞다', async ({ browser }) => {
  // 4K 높음 단계가 CI 러너(SwiftShader)에서 느리다
  test.setTimeout(480_000);
  const { page, problems, close } = await newScreen(browser, { width: 1440, height: 900 }, 2);
  const code = await startSolo(page, '&quality=high', 'monster');
  const me = await page.evaluate(() => window.__DECOY__?.you ?? '');
  // 괴물 대기 시간에도 조준(목표 각도)은 서버가 받는다
  await page.evaluate(
    (id) => window.__DECOY__?.sendTest({ kind: 'teleport', target: id, x: 24, y: 21, face: 0 }),
    me,
  );
  await page.waitForTimeout(400);

  const checkAim = async (label: string): Promise<void> => {
    for (const target of [
      { x: 30, y: 21 },
      { x: 24, y: 27 },
      { x: 18, y: 25 },
    ]) {
      const c = await page.evaluate((t) => window.__DECOY__?.tileToClient(t.x, t.y) ?? null, target);
      expect(c).not.toBeNull();
      await page.mouse.move(c!.x, c!.y);
      // 회전 시간 + 보간 + 스냅샷 (SwiftShader 큰 백버퍼에서는 프레임이 느려 넉넉히)
      await page.waitForTimeout(900);
      const t = await truth(page, code);
      const expected = Math.atan2(target.y - 21, target.x - 24);
      const errDeg = (angDiff(t.monster!.aim, expected) * 180) / Math.PI;
      console.log(`${label} 목표 (${target.x},${target.y}) 조준 오차 ${errDeg.toFixed(2)}°`);
      expect(errDeg, `${label} 조준 오차`).toBeLessThan(2);
    }
  };

  // 백버퍼가 바뀔 때까지. 시간을 넘기면 그때 상태(창 DPR · 캔버스 · 그래픽 상태)를 오류에 담는다 (부하가 큰 러너에서 원인 구분용)
  // 폴링은 rAF가 아니라 시간 간격으로: 4K(3840×2160) 높음은 GitHub Actions 러너의 SwiftShader에서 한 프레임이 수 초라
  // rAF 폴링이면 확인 자체가 프레임만큼 늦는다(CI에서 바뀐 직후 시간 초과가 난 적이 있다)
  const waitBacking = async (w: number, h: number, timeout = 60_000): Promise<CanvasInfo> => {
    const t0 = Date.now();
    try {
      await page.waitForFunction(
        ([bw, bh]) => {
          const c = document.querySelector<HTMLCanvasElement>('#game-root canvas');
          return c?.width === bw && c.height === bh;
        },
        [w, h] as const,
        { timeout, polling: 200 },
      );
    } catch (e) {
      const now = await canvasInfo(page);
      // 큰 백버퍼 프레임이 수 초씩 걸리면 페이지 안 폴링 자체가 밀려 시간 초과가 날 수 있다: 그 뒤에 이미 바뀌어 있으면 따라간 것이다
      if (now.backingW === w && now.backingH === h) {
        console.log(
          `백버퍼 ${w}×${h}: 폴링이 ${timeout}ms 안에 확인하지 못했지만 그 뒤 바뀌어 있음 (느린 러너)`,
        );
        await settleFrames(page, 2);
        return canvasInfo(page);
      }
      throw new Error(
        `백버퍼 ${w}×${h}을 ${timeout}ms 동안 기다렸다: 지금 ${now.backingW}×${now.backingH}, ` +
          `창 DPR ${now.dpr}, gfx.dpr ${now.gfx.dpr}, 품질 ${now.gfx.quality}, 하향 ${now.gfx.downgrades} (${String(e)})`,
      );
    }
    console.log(`백버퍼 ${w}×${h}: ${Date.now() - t0}ms`);
    await settleFrames(page, 2);
    return canvasInfo(page);
  };

  // 마우스를 움직이지 않은 채 백버퍼가 바뀌어도 조준이 그대로여야 한다 (Phaser는 포인터를 백버퍼 px로 기억한다)
  const aimHeld = async (label: string): Promise<void> => {
    await page.waitForTimeout(700);
    const t = await truth(page, code);
    const errDeg = (angDiff(t.monster!.aim, Math.atan2(25 - 21, 18 - 24)) * 180) / Math.PI;
    console.log(`${label} 마우스를 움직이지 않음: 조준 오차 ${errDeg.toFixed(2)}°`);
    expect(errDeg, `${label} 크기 변경 뒤 조준 유지`).toBeLessThan(2);
  };

  // 느린 러너(2코어 SwiftShader)에서 4K 프레임이 CPU를 다 쓰면 연결이 끊겼다 다시 붙을 수 있다(하트비트 응답 지연으로 본다 —
  // JS 정지만으로는 재현되지 않음, DECISIONS M12 송신 밀림). 그러면 판 장면을 새로 만들어 앞서 만든 탐침 글자가 사라진다
  // (M11 전체 검사에서 probeRes null). 그런 단계는 원인을 적고 탐침을 다시 만든다(새 장면의 글자도 새 해상도인지는 그대로 본다)
  let sockets = 0;
  page.on('websocket', () => {
    sockets += 1;
  });
  let seenSockets = 0;
  const drawProbe = async (): Promise<void> => {
    await page.evaluate(() => window.__DECOY__?.probeText('가드 11:55 ABC', 1500.37, 18.41, 28));
  };
  const reprobeIfReconnected = async (label: string): Promise<void> => {
    if (sockets === seenSockets) return;
    seenSockets = sockets;
    console.log(`${label}: 연결이 다시 맺어졌다(느린 러너) → 새 판 장면에 탐침을 다시 만든다`);
    await drawProbe();
    await settleFrames(page, 2);
  };

  const first = await canvasInfo(page);
  expect([first.backingW, first.backingH]).toEqual([2880, 1620]);
  // 선명도 탐침 글자를 첫 크기 변경 전에 만들어 둔다: 크기가 바뀔 때마다 이 글자도 새 해상도로 다시 그려져야 한다
  await drawProbe();
  await settleFrames(page, 2);
  const firstTexts = await textAudit(page);
  expectTexts(firstTexts, 1.5, '1440×900 @2');
  expect(firstTexts.probeRes).toBe(1.5);
  await checkAim('1440×900 @2');

  await page.setViewportSize({ width: 1000, height: 700 });
  // fit = 1000/1920 → 표시 1000×562.5, ×2
  const small = await waitBacking(2000, 1125);
  await aimHeld('→ 1000×700 @2');
  expectBacking(small, '1000×700 @2');
  expectAligned(small, '1000×700 @2');
  await reprobeIfReconnected('→ 1000×700 @2');
  const smallTexts = await textAudit(page);
  expectTexts(smallTexts, small.gfx.zoom, '→ 1000×700 @2');
  expect(smallTexts.probeRes).toBe(small.gfx.zoom);
  expect(small.gfx.zoom).toBeCloseTo(2000 / 1920, 10);
  await checkAim('→ 1000×700 @2');

  await page.setViewportSize({ width: 1920, height: 1080 });
  const big = await waitBacking(3840, 2160);
  await aimHeld('→ 1920×1080 @2');
  expectBacking(big, '1920×1080 @2');
  expect(big.gfx.zoom).toBe(2);
  await reprobeIfReconnected('→ 1920×1080 @2');
  const bigTexts = await textAudit(page);
  expectTexts(bigTexts, 2, '→ 1920×1080 @2');
  expect(bigTexts.probeRes).toBe(2);
  await checkAim('→ 1920×1080 @2');

  // DPR만 바뀜(다른 모니터로 옮김): resize 없이 matchMedia로 잡는다
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // 창 DPR이 먼저 바뀌었는지 따로 본다: 에뮬레이션이 늦은 것과 앱이 변경을 놓친 것을 가른다
  // (부하가 큰 컨테이너에서 이 단계가 한 번 10초를 넘긴 적이 있다. 판 중 하향을 막기 전에는 하향이 백버퍼를 대신 맞춰 가려졌다)
  await page.waitForFunction(() => window.devicePixelRatio === 1, null, { timeout: 20_000, polling: 200 });
  const moved = await waitBacking(1920, 1080);
  await aimHeld('→ DPR 1');
  expect(moved.dpr).toBe(1);
  expect(moved.gfx.zoom).toBe(1);
  expectAligned(moved, 'DPR 2 → 1');
  await reprobeIfReconnected('→ DPR 1');
  const movedTexts = await textAudit(page);
  expectTexts(movedTexts, 1, '→ DPR 1');
  expect(movedTexts.probeRes).toBe(1);
  await checkAim('→ DPR 1');
  await page.evaluate(() => window.__DECOY__?.probeText('', 0, 0, 10));
  // 판 중 자동 하향이 끼어들지 않았다 (startSolo의 FPS 60). 빠지면 시간 초과 대신 여기서 원인이 드러난다
  const end = await canvasInfo(page);
  expect(end.gfx.downgrades).toBe(0);
  expect(end.gfx.quality).toBe('high');
  expect(problems).toEqual([]);
  await close();
});
