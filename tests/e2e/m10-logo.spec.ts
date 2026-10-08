// M10 로고 SVG: 다시 그린 벡터 로고가 원본 PNG(213px)와 같은 모양인지 실제 브라우저 렌더로 확인한다.
// 서버의 정적 경로에는 docs/가 없으므로 원본 PNG와 SVG는 파일에서 읽어 data URL로 넣는다 (경로는 저장소 루트 기준).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const PNG_URL = `data:image/png;base64,${readFileSync('docs/images/logo_decoy.png').toString('base64')}`;
const SVG_TEXT = readFileSync('docs/images/logo_decoy.svg', 'utf8');
const SVG_URL = `data:image/svg+xml;base64,${Buffer.from(SVG_TEXT).toString('base64')}`;

interface LogoStats {
  alphaIoU: number;
  neonIoU: number;
  opaqueRatio: number;
  neonPixels: number;
}

/** 두 이미지를 size px로 그려 알파 실루엣 IoU와 네온 선(청록 코어) IoU를 잰다. b만의 불투명 · 네온 비율도 돌려준다 */
async function compareAt(page: Page, aUrl: string, bUrl: string, size: number): Promise<LogoStats> {
  return page.evaluate(
    async ({ aUrl, bUrl, size }) => {
      const draw = async (src: string): Promise<Uint8ClampedArray> => {
        const im = new Image();
        im.src = src;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im, 0, 0, size, size);
        return ctx.getImageData(0, 0, size, size).data;
      };
      const a = await draw(aUrl);
      const b = await draw(bUrl);
      let inter = 0;
      let union = 0;
      let nInter = 0;
      let nUnion = 0;
      let opaque = 0;
      let neon = 0;
      for (let i = 0; i < size * size; i++) {
        const p = i * 4;
        const sa = a[p + 3]! >= 128;
        const sb = b[p + 3]! >= 128;
        if (sa && sb) inter++;
        if (sa || sb) union++;
        const na = a[p + 1]! - a[p]! > 100 && a[p + 1]! > 150;
        const nb = b[p + 1]! - b[p]! > 100 && b[p + 1]! > 150;
        if (na && nb) nInter++;
        if (na || nb) nUnion++;
        if (b[p + 3]! >= 250) opaque++;
        if (nb) neon++;
      }
      return {
        alphaIoU: inter / union,
        neonIoU: nUnion > 0 ? nInter / nUnion : 0,
        opaqueRatio: opaque / (size * size),
        neonPixels: neon,
      };
    },
    { aUrl, bUrl, size },
  );
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

test('SVG를 213px로 그리면 원본 PNG와 실루엣 IoU 0.9 이상, 네온 선도 겹친다', async ({ page }) => {
  const problems = watchConsole(page);
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  const s = await compareAt(page, PNG_URL, SVG_URL, 213);
  console.log(`[로고] 213px 알파 IoU ${s.alphaIoU.toFixed(4)} · 네온 선 IoU ${s.neonIoU.toFixed(4)}`);
  expect(s.alphaIoU).toBeGreaterThanOrEqual(0.9);
  // 원판만 맞고 새 · X 선이 어긋나면 잡히도록 네온 선 겹침도 본다 (측정 0.93)
  expect(s.neonIoU).toBeGreaterThanOrEqual(0.8);
  expect(problems).toEqual([]);
});

test('SVG를 512px로 그리면 빈 그림이 아니다 (원판 + 네온 선)', async ({ page }) => {
  const problems = watchConsole(page);
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  const s = await compareAt(page, PNG_URL, SVG_URL, 512);
  // 원판 넓이 π·249²/512² ≈ 0.74
  expect(s.opaqueRatio).toBeGreaterThan(0.6);
  expect(s.opaqueRatio).toBeLessThan(0.8);
  expect(s.neonPixels).toBeGreaterThan(5000);
  expect(problems).toEqual([]);
});

test('빌드에 client/public/logo.svg가 그대로 실린다 (/logo.svg)', async ({ request }) => {
  const res = await request.get('/logo.svg');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/svg+xml');
  expect(await res.text()).toBe(SVG_TEXT);
});
