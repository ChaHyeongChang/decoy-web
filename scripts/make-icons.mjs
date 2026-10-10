// 앱 아이콘 만들기 (M14): 로고 SVG(client/public/logo.svg)를 M10 배경(VISUAL_SPEC 바탕 #0B1622 + 청록 빛) 위에 놓아
// PWA manifest 아이콘과 스토어 아이콘 PNG를 만든다. 이미 설치된 Playwright Chromium의 canvas로 그려 새 의존성이 없다.
//   node scripts/make-icons.mjs        (npm run icons)
// 결과 (커밋한다 — Docker 빌드에 영향 없음):
//   client/public/icons/icon-192.png · icon-512.png          purpose any: 로고 원판 지름 = 변의 90%
//   client/public/icons/maskable-192.png · maskable-512.png  purpose maskable: 로고 원판이 가운데 80% 안전 원 안(지름 76%)
//   artifacts/store/app-icon-512.png                          구글 플레이 스토어 아이콘 512×512 (32비트 RGBA, 완전 불투명)
// 모두 정사각형 전체를 바탕색으로 칠해 불투명하다 (원형 · 둥근 사각 마스크에서 모서리가 비지 않게)
/* global document, Image */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = readFileSync(join(ROOT, 'client/public/logo.svg'), 'utf8');
/** VISUAL_SPEC 바탕색 · 시설 청록 */
const BG = '#0B1622';
const NEON = '34, 211, 238';

/** 로고 원판(viewBox 512에서 중심 255,255 반지름 249.3)을 지름 비율 ratio로 놓는다 */
const ICONS = [
  { out: 'client/public/icons/icon-192.png', size: 192, ratio: 0.9 },
  { out: 'client/public/icons/icon-512.png', size: 512, ratio: 0.9 },
  { out: 'client/public/icons/maskable-192.png', size: 192, ratio: 0.76 },
  { out: 'client/public/icons/maskable-512.png', size: 512, ratio: 0.76 },
  { out: 'artifacts/store/app-icon-512.png', size: 512, ratio: 0.9 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  for (const icon of ICONS) {
    const dataUrl = await page.evaluate(
      async ({ svg, size, ratio, bg, neon }) => {
        const img = new Image();
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const g = c.getContext('2d');
        if (!g) throw new Error('canvas 2d 없음');
        // 바탕: 정사각형 전체를 칠한다 (불투명) + 가운데 은은한 청록 빛 + 가장자리 어둡게
        g.fillStyle = bg;
        g.fillRect(0, 0, size, size);
        const glow = g.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.62);
        glow.addColorStop(0, `rgba(${neon}, 0.16)`);
        glow.addColorStop(1, 'rgba(5, 8, 12, 0.35)');
        g.fillStyle = glow;
        g.fillRect(0, 0, size, size);
        // 로고: 원판 지름 = ratio × 변, 원판 중심을 그림 중심에
        const disc = 249.3 * 2;
        const scale = (ratio * size) / disc;
        const drawn = 512 * scale;
        const x = size / 2 - 255 * scale;
        const y = size / 2 - 255 * scale;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, x, y, drawn, drawn);
        return c.toDataURL('image/png');
      },
      { svg: SVG, size: icon.size, ratio: icon.ratio, bg: BG, neon: NEON },
    );
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const path = join(ROOT, icon.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
    console.log(`${icon.out} ${icon.size}×${icon.size} ${buf.length}B`);
  }
} finally {
  await browser.close();
}
