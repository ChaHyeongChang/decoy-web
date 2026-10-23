// 따라가는 카메라 3단계: 기존 · 새 캐릭터 스타일 확대 화면 비교 한 장 (node scripts/char-compare-zoom.mjs → artifacts/camera/chars/compare.png)
// tests/camera/char-compare.spec.ts가 찍은 자른 그림(같은 장면 · 같은 순간, 스타일만 다름)을 HTML 한 장에 놓고 설치된 Chromium으로 찍는다
/* global document */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const DIR = resolve('artifacts/camera/chars');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const DEVICES = [
  ['phone-medium', '휴대폰 800×360 · 품질 중간'],
  ['phone-low', '휴대폰 800×360 · 품질 낮음'],
  ['pc-high', 'PC 1920×1080 · 품질 높음'],
];
const SCENES = [
  ['survivor', '생존자 화면 (러너 · 가드 · 스카우트 · 괴물)'],
  ['monster', '괴물 화면 (생존자 = 흰 공통 그림)'],
];
const img = (dev, scene, style) => {
  const p = join(DIR, `${dev}-${scene}-${style}.png`);
  return existsSync(p) ? `<img src="${pathToFileURL(p).href}">` : '<div class="miss">없음</div>';
};
const mib = (dev, style) => {
  const r = manifest.records.find((x) => x.device === dev && x.style === style);
  return r ? `${(r.atlasBytes / 1048576).toFixed(2)}MiB · ${r.tpw} 텍셀/월드px` : '';
};

const body = DEVICES.map(
  ([dev, label]) => `
  <h2>${label}</h2>
  <div class="grid">
    <div></div><div class="colh">기존 <small>${mib(dev, 'classic')}</small></div><div class="colh">새 캐릭터 <small>${mib(dev, 'new')}</small></div>
    ${SCENES.map(([s, sl]) => `<div class="rowh">${sl}</div><div class="cell">${img(dev, s, 'classic')}</div><div class="cell">${img(dev, s, 'new')}</div>`).join('')}
  </div>`,
).join('');

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Noto Sans KR'; src: url('${pathToFileURL(resolve('client/public/fonts/noto-sans-kr-ui.woff2')).href}') format('woff2'); font-weight: 100 900; }
  body { margin: 0; padding: 28px 32px; background: #0b1622; color: #e2e8f0; font-family: 'Noto Sans KR', sans-serif; width: 1500px; }
  h1 { font-size: 30px; margin: 0 0 6px; } p { font-size: 17px; color: #9fb3c8; margin: 0 0 14px; line-height: 1.5; }
  h2 { font-size: 22px; margin: 22px 0 8px; color: #67e8f9; }
  .grid { display: grid; grid-template-columns: 170px 1fr 1fr; gap: 8px; align-items: center; }
  .colh { font-size: 19px; font-weight: 700; } .colh small { font-weight: 400; color: #9fb3c8; font-size: 14px; margin-left: 8px; }
  .rowh { font-size: 16px; color: #cbd5e1; } .cell img { width: 100%; display: block; border-radius: 6px; }
  .miss { color: #f87171; }
</style></head><body>
  <h1>확대 ② 중간에서 기존 · 새 캐릭터</h1>
  <p>같은 장면 · 같은 순간에 스타일만 바꿔 찍었다(봇 · 장식 시계 멈춤, 기기 px 그대로 자름). 새 캐릭터 위 그림은 판정 반지름의 1.15배를 넘지 않게 앞 돌출(후드 · 방패 · 망원경 · 필터 · 발톱 · 돌진 자락)을 몸 쪽으로 당겼다. 기존 그림은 그대로다.</p>
  ${body}
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), 'char-compare-'));
const file = join(tmp, 'index.html');
writeFileSync(file, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1564, height: 900 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(file).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const out = join(DIR, 'compare.png');
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`저장: ${out}`);
