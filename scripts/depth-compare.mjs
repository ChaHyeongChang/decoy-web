// 입체감 시안 비교 · 전후 그림 (VISUAL_SPEC 14장, DECISIONS 17절)
//   npx playwright test --config tests/depth/playwright.config.ts   ← artifacts/depth/shots/<기기>/<시안>-<장면>.png
//   node scripts/depth-compare.mjs
// 만드는 것:
//   artifacts/depth/compare-<기기>.png       줄 = 장면(생존자 · 괴물), 칸 = 시안(끔 · A · B · C)
//   artifacts/depth/before-after-<기기>-<장면>.png   전(입체감 끔) | 후(고른 시안) 큰 그림
// 이미 설치된 Playwright Chromium의 페이지 canvas로 합성하므로 새 의존성이 없다 (scripts/remaster-compare.mjs와 같은 방법)
/* global document, Image */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'artifacts/depth');
const SHOTS = join(BASE, 'shots');
/** 고른 시안 (client/src/gfx/depth.ts DEFAULT_DEPTH_LOOK) */
const CHOSEN = 'b';
const VARIANTS = [
  { id: 'off', label: '전 (입체감 끔)' },
  { id: 'a', label: '시안 A 낮게 · 옅게' },
  { id: 'b', label: '시안 B 중간 (고름)' },
  { id: 'c', label: '시안 C 높게 · 진하게' },
];
const SCENES = [
  { id: 'survivor', label: '생존자 화면' },
  { id: 'monster', label: '괴물 화면' },
];
const LABEL_H = 40;
const GAP = 8;
const BG = '#0B1622';

if (!existsSync(SHOTS)) throw new Error(`${SHOTS}가 없습니다 — 먼저 tests/depth 촬영을 돌린다`);
const devices = readdirSync(SHOTS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
mkdirSync(BASE, { recursive: true });

const b64 = (p) => (existsSync(p) ? readFileSync(p).toString('base64') : null);

/** 칸 그림들을 격자로: rows[r][c] = { label, b64 }, 칸 폭 cellW */
async function grid(page, rows, cellW) {
  return page.evaluate(
    async ({ rows, cellW, labelH, gap, bg }) => {
      const load = (s) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = `data:image/png;base64,${s}`;
        });
      const imgs = await Promise.all(
        rows.map((r) => Promise.all(r.map((c) => (c.b64 ? load(c.b64) : null)))),
      );
      const ref = imgs.flat().find((i) => i !== null);
      const h = Math.round((ref.height * cellW) / ref.width);
      const cols = Math.max(...rows.map((r) => r.length));
      const canvas = document.createElement('canvas');
      canvas.width = cols * cellW + (cols - 1) * gap;
      canvas.height = rows.length * (labelH + h) + (rows.length - 1) * gap;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      rows.forEach((r, ri) => {
        const y = ri * (labelH + h + gap);
        r.forEach((c, ci) => {
          const x = ci * (cellW + gap);
          ctx.fillStyle = '#E2E8F0';
          ctx.font = 'bold 20px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(c.label, x + 10, y + labelH / 2);
          const img = imgs[ri][ci];
          if (img) ctx.drawImage(img, x, y + labelH, cellW, h);
          else {
            ctx.fillStyle = '#94A3B8';
            ctx.fillText('(없음)', x + 10, y + labelH + h / 2);
          }
        });
      });
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { rows, cellW, labelH: LABEL_H, gap: GAP, bg: BG },
  );
}

const browser = await chromium.launch();
const written = [];
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  for (const dev of devices) {
    const rows = SCENES.map((s) =>
      VARIANTS.map((v) => ({
        label: `${s.label} · ${v.label}`,
        b64: b64(join(SHOTS, dev, `${v.id}-${s.id}.png`)),
      })),
    );
    if (rows.flat().every((c) => c.b64 === null)) continue;
    const out = join(BASE, `compare-${dev}.png`);
    writeFileSync(out, Buffer.from(await grid(page, rows, 640), 'base64'));
    written.push(out);
    for (const s of SCENES) {
      const pair = [
        { label: `전 · ${s.label} (입체감 끔)`, b64: b64(join(SHOTS, dev, `off-${s.id}.png`)) },
        {
          label: `후 · ${s.label} (시안 ${CHOSEN.toUpperCase()})`,
          b64: b64(join(SHOTS, dev, `${CHOSEN}-${s.id}.png`)),
        },
      ];
      if (pair.some((c) => c.b64 === null)) continue;
      const o = join(BASE, `before-after-${dev}-${s.id}.png`);
      writeFileSync(o, Buffer.from(await grid(page, [pair], 960), 'base64'));
      written.push(o);
    }
  }
} finally {
  await browser.close();
}
console.log(`입체감 비교 ${written.length}장 → ${BASE}`);
