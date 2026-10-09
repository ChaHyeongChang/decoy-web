// 비주얼 리마스터 전후 비교 그림 (M10c). docs/MOBILE_PLAN.md M10c 6번
//   npm run shots:compare
// artifacts/remaster/before/ 와 after/high/ · after/low/ 에 같은 이름으로 있는 PNG를 나란히 붙여
// artifacts/remaster/compare/<이름>.png 로 저장한다: 왼쪽부터 전(M10 이전) | 후 높음(WebGL) | 후 낮음(Canvas).
// 칸마다 너비 960px로 줄이고(비율 유지) 위에 이름표를 단다. 확대 그림(zoom-*)은 줄이지 않고 원래 크기로 붙인다.
// 이미 설치된 Playwright Chromium의 페이지 canvas로 합성하므로 새 의존성이 없다.
/* global document, Image */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'artifacts/remaster');
const COLUMNS = [
  { dir: 'before', label: '전 (M10 이전)' },
  { dir: 'after/high', label: '후 · 높음 (WebGL)' },
  { dir: 'after/low', label: '후 · 낮음 (Canvas)' },
];
const CELL_W = 960;
const LABEL_H = 44;
const GAP = 8;
/** 비교 그림 배경 (VISUAL_SPEC 배경색) */
const BG = '#0B1622';

const names = readdirSync(join(BASE, COLUMNS[0].dir))
  .filter((f) => f.endsWith('.png'))
  .sort();
if (names.length === 0) throw new Error(`${COLUMNS[0].dir}에 PNG가 없습니다`);

const outDir = join(BASE, 'compare');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const written = [];
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  for (const name of names) {
    const cells = COLUMNS.map((c) => {
      const p = join(BASE, c.dir, name);
      return { label: c.label, b64: existsSync(p) ? readFileSync(p).toString('base64') : null };
    });
    if (cells.slice(1).every((c) => c.b64 === null)) continue;
    const keepSize = name.startsWith('zoom-');
    const png = await page.evaluate(
      async ({ cells, cellW, labelH, gap, bg, keepSize }) => {
        const load = (b64) =>
          new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = `data:image/png;base64,${b64}`;
          });
        const imgs = await Promise.all(cells.map((c) => (c.b64 ? load(c.b64) : null)));
        const ref = imgs.find((i) => i !== null);
        const w = keepSize ? ref.width : cellW;
        const h = Math.round((ref.height * w) / ref.width);
        const canvas = document.createElement('canvas');
        canvas.width = cells.length * w + (cells.length - 1) * gap;
        canvas.height = labelH + h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = 'high';
        cells.forEach((c, i) => {
          const x = i * (w + gap);
          ctx.fillStyle = '#E2E8F0';
          ctx.font = 'bold 22px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(c.label, x + 12, labelH / 2);
          const img = imgs[i];
          if (img) ctx.drawImage(img, x, labelH, w, Math.round((img.height * w) / img.width));
          else {
            ctx.fillStyle = '#94A3B8';
            ctx.font = '20px sans-serif';
            ctx.fillText('(없음)', x + 12, labelH + h / 2);
          }
        });
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { cells, cellW: CELL_W, labelH: LABEL_H, gap: GAP, bg: BG, keepSize },
    );
    writeFileSync(join(outDir, name), Buffer.from(png, 'base64'));
    written.push(name);
  }
} finally {
  await browser.close();
}
console.log(`전후 비교 ${written.length}장 → ${outDir}`);
