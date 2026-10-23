// 따라가는 카메라 1단계: 확대 수준 후보 한 장 비교 그림 (node scripts/camera-compare.mjs → artifacts/camera/compare.png)
// tests/camera 촬영(artifacts/camera/shots)과 scripts/camera-table.ts 수치(artifacts/camera/table.json)를 HTML 한 장에 놓고
// 설치된 Chromium으로 찍는다. 팀원과 같이 보는 그림이라 글자는 크게, 숫자는 표 하나로
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const SHOTS = resolve('artifacts/camera/shots');
const table = JSON.parse(readFileSync('artifacts/camera/table.json', 'utf8'));
const ZOOMS = [1, 4, 3, 2];
const NAME = {
  1: '지금 (맵 전체 고정)',
  4: '① 가깝게 — 가로 1/4',
  3: '② 중간 — 가로 1/3',
  2: '③ 넓게 — 가로 1/2',
};
const SCENES = [
  ['survivor', '생존자 화면'],
  ['monster-search', '괴물 · 탐색 시야'],
  ['monster-hunt', '괴물 · 추적 시야 (북쪽 조준)'],
];
const img = (dev, z, scene) => {
  const p = resolve(SHOTS, dev, `z${z}-${scene}.png`);
  return existsSync(p) ? `<img src="${pathToFileURL(p).href}">` : '<div class="miss">없음</div>';
};
const pct = (v) => `${Math.round(v * 100)}%`;
const row = (z) => table.find((r) => r.zoom === z);

const grid = (dev, title, scenes) => `
  <h2>${title}</h2>
  <div class="grid" style="grid-template-columns: 150px repeat(4, 1fr)">
    <div></div>${ZOOMS.map((z) => `<div class="colh${z === 1 ? ' now' : ''}">${NAME[z]}</div>`).join('')}
    ${scenes
      .map(
        ([key, label]) =>
          `<div class="rowh">${label}</div>${ZOOMS.map((z) => `<div class="cell">${img(dev, z, key)}</div>`).join('')}`,
      )
      .join('')}
  </div>`;

const tableHtml = `
  <table>
    <tr><th></th>${ZOOMS.map((z) => `<th${z === 1 ? ' class="now"' : ''}>${NAME[z]}</th>`).join('')}</tr>
    <tr><td>보이는 범위 (모든 기기 같음)</td>${ZOOMS.map((z) => `<td>${row(z).viewW} × ${row(z).viewH} 타일</td>`).join('')}</tr>
    <tr><td>생존자 시야 원(반지름 6)이 화면에 든 비율</td>${ZOOMS.map((z) => `<td>${pct(row(z).survivorCircle)}</td>`).join('')}</tr>
    <tr><td>스카우트 시야 원(7.5)</td>${ZOOMS.map((z) => `<td>${pct(row(z).scoutCircle)}</td>`).join('')}</tr>
    <tr><td>괴물 탐색 시야(110° · 5타일) 가로 · 대각 · 세로 조준</td>${ZOOMS.map((z) => `<td>${pct(row(z)['search-side'])} · ${pct(row(z)['search-diag'])} · ${pct(row(z)['search-up'])}</td>`).join('')}</tr>
    <tr><td>괴물 추적 시야(50° · 9타일) 가로 · 대각 · 세로 조준</td>${ZOOMS.map((z) => `<td>${pct(row(z)['hunt-side'])} · ${pct(row(z)['hunt-diag'])} · <b>${pct(row(z)['hunt-up'])}</b></td>`).join('')}</tr>
    <tr><td>추적 시야 세로 조준 때 화면에 보이는 거리</td>${ZOOMS.map((z) => `<td>${row(z)['hunt-up-ahead']} / 9 타일</td>`).join('')}</tr>
    <tr><td>생존자 몸 지름 (휴대폰 800×360)</td>${ZOOMS.map((z) => `<td>${row(z)['휴대폰 800×360 생존자']} px</td>`).join('')}</tr>
    <tr><td>생존자 몸 지름 (휴대폰 915×412)</td>${ZOOMS.map((z) => `<td>${row(z)['휴대폰 915×412 생존자']} px</td>`).join('')}</tr>
    <tr><td>생존자 몸 지름 (PC 1920×1080)</td>${ZOOMS.map((z) => `<td>${row(z)['PC 1920×1080 생존자']} px</td>`).join('')}</tr>
    <tr><td>괴물 몸 지름 (휴대폰 800×360 · PC)</td>${ZOOMS.map((z) => `<td>${row(z)['휴대폰 800×360 괴물']} · ${row(z)['PC 1920×1080 괴물']} px</td>`).join('')}</tr>
  </table>`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Noto Sans KR'; src: url('${pathToFileURL(resolve('client/public/fonts/noto-sans-kr-ui.woff2')).href}') format('woff2'); font-weight: 100 900; }
  body { margin: 0; padding: 28px 32px; background: #0B1622; color: #E2E8F0; font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; width: 2200px; }
  h1 { font-size: 34px; margin: 0 0 6px; color: #67E8F9; }
  p.sub { margin: 0 0 18px; color: #94A3B8; font-size: 18px; line-height: 1.5; }
  h2 { font-size: 22px; margin: 22px 0 8px; color: #E2E8F0; }
  .grid { display: grid; gap: 8px; align-items: center; }
  .colh { font-size: 19px; font-weight: 700; color: #67E8F9; text-align: center; }
  .colh.now, th.now { color: #94A3B8; }
  .rowh { font-size: 17px; color: #CBD5E1; }
  .cell img { width: 100%; display: block; border: 1px solid #1E3A4A; }
  .miss { color: #F87171; }
  table { border-collapse: collapse; margin-top: 22px; font-size: 18px; width: 100%; }
  th, td { border: 1px solid #1E3A4A; padding: 7px 10px; text-align: center; }
  th { color: #67E8F9; background: #0F1B27; }
  td:first-child { text-align: left; color: #CBD5E1; background: #0F1B27; }
  b { color: #FCD34D; }
</style></head><body>
  <h1>DECOY 따라가는 카메라 — 확대 수준 후보</h1>
  <p class="sub">보이는 창은 지금 맵이 그려지던 사각형(3:2) 그대로이고 그 안에 맵 일부를 확대해 보여 준다 → 모든 기기에서 보이는 타일 수가 같다(넓은 화면 이득 없음).
  괴물은 조준 방향으로 화면을 앞당긴다. 캐릭터는 새 캐릭터 스타일. 화면 밖 화살표 · 미니맵 개선 · 캐릭터 다듬기는 아직 넣지 않은 1단계 시제품이다.</p>
  ${grid('phone-800x360', '휴대폰 가로 800×360', SCENES)}
  ${grid('pc-1920x1080', 'PC 1920×1080', [SCENES[0], SCENES[2]])}
  ${tableHtml}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2264, height: 1000 }, deviceScaleFactor: 1 });
const file = join(mkdtempSync(join(tmpdir(), 'decoy-camera-')), 'compare.html');
writeFileSync(file, html);
await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
// eslint-disable-next-line no-undef -- 브라우저 안에서 도는 함수
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/camera/compare.png', fullPage: true });
await browser.close();
console.log('artifacts/camera/compare.png');
