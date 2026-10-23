// 따라가는 카메라 최종 확인 GIF (휴대폰 가로 800×360): npx playwright test --config tests/camera/playwright.config.ts final-gif
//  - 장면 하나를 영상으로 찍어 ffmpeg로 GIF를 만든다: 러너가 거점 A 방에서 거점 B 쪽으로 걷는다(따라가기 · 화면 밖 화살표가
//    돌아간다 · 공유 시야로 괴물이 보인다) → 수감(감옥으로 잘라 옮기며 짧게 어두워짐) → 가드 카드를 탭해 가드 화면 관전
//  - 영상은 크롬 화면 송출(CDP Page.startScreencast)로 받은 프레임을 시각대로 이어 붙인다. Playwright recordVideo는 이 헤드리스
//    환경에서 페이지를 0.6배로 줄여 왼쪽 위에만 그리고 나머지를 회색으로 채웠다(최종 확인 중 찾음). 송출 프레임은 창 크기(800×600)라
//    위 800×360(뷰포트)만 자른다. 배율 1로 연다(백버퍼가 작아 SwiftShader에서 프레임이 덜 끊긴다 — 화면 배치는 같다)
//  - 결과: artifacts/camera/final/phone-800x360/walk-spectate.gif (+ manifest.json에 구간 기록)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { placeBots, placeSelf, players, press, send, settleHud } from './shotKit';
import { watchConsole } from '../e2e/helpers';

const OUT = 'artifacts/camera/final/phone-800x360';
const GIF = join(OUT, 'walk-spectate.gif');
const W = 800;
const H = 360;

test('휴대폰 800×360: 걷기 따라가기 · 화면 밖 화살표 → 수감 → 동료 관전 GIF', async ({ browser }) => {
  test.setTimeout(300_000);
  const frameDir = mkdtempSync(join(tmpdir(), 'decoy-gif-'));
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    screen: { width: W, height: H },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('decoy:touchTutorial', '1');
    } catch {
      // 저장소가 막혀도 촬영은 한다
    }
  });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  await page.goto('/?debug=hook&renderer=webgl&quality=medium&chars=new&bots=1');
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-state', 'connected');
  await press(page, 'create-room');
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.getByTestId('room-code').textContent()) ?? '';
  await press(page, 'role-runner');
  await press(page, 'ready-button');
  await press(page, 'start-button');
  await page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) >= 3, null, { timeout: 30_000 });
  await page.evaluate(() => window.__DECOY__?.injectFps(60));
  const you = await page.evaluate(() => window.__DECOY__?.you ?? '');
  // 가드는 거점 B를 점령 중, 괴물은 그 곁(가드 시야 = 공유 시야로 보인다), 스카우트는 북쪽
  await placeBots(page, code, [
    ['guard', 40.5, 15.2, Math.PI],
    ['monster', 37.6, 18.4, -0.6],
    ['scout', 25.5, 4.5, 0.3],
  ]);
  await placeSelf(page, code, you, 9.5, 17, 0);
  await send(page, { kind: 'setPoint', point: 'B', progress: 0.3 });
  await settleHud(page);
  await send(page, { kind: 'setTime', timeLeft: 522.4 });
  await page.waitForTimeout(800);
  // 화면 송출 시작: 프레임마다 (시각 초, PNG) — 그림이 바뀔 때만 오므로 길이는 다음 프레임 시각까지
  const cdp = await context.newCDPSession(page);
  const frames: { t: number; png: Buffer }[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, png: Buffer.from(f.data, 'base64') });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  // 걷기: 동쪽으로 방을 나가 복도 → 남동으로 비켜 감옥 철창 아래 → 동쪽
  const hold = async (keys: string[], ms: number): Promise<void> => {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    for (const k of keys) await page.keyboard.up(k);
  };
  await hold(['KeyD'], 2000);
  await hold(['KeyD', 'KeyS'], 500);
  await hold(['KeyD'], 2600);
  await page.waitForTimeout(500);
  // 수감: 감옥 안으로 순간 이동 (먼 점프 = 잘라 옮기기 + 짧은 어두워짐)
  await placeSelf(page, code, you, 23.5, 15.5, 0);
  await send(page, { kind: 'setSurvivor', target: you, status: 'imprisoned', imprisonCount: 1 });
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.getCamera()?.canSpectate)).toBe(true);
  await page.waitForTimeout(1500);
  // 가드 카드를 탭해 가드 화면으로
  const guard = (await players(page, code)).find((p) => p.role === 'guard')?.id ?? '';
  const card = (await page.evaluate(() => window.__DECOY__?.getSpectateCards() ?? [])).find(
    (c) => c.id === guard,
  );
  if (!card) throw new Error('가드 카드 없음');
  await page.touchscreen.tap(card.x + card.w / 2, card.y + card.h / 2);
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.getCamera()?.spectating)).toBe(guard);
  await page.waitForTimeout(2200);
  await cdp.send('Page.stopScreencast');
  await context.close();
  if (frames.length < 20) throw new Error(`송출 프레임이 너무 적다 (${frames.length})`);
  // 프레임을 파일로 쓰고 ffmpeg concat 목록에 길이를 적는다 (마지막 프레임은 0.1초)
  const list: string[] = [];
  frames.forEach((f, i) => {
    const file = join(frameDir, `f${String(i).padStart(4, '0')}.png`);
    writeFileSync(file, f.png);
    const next = frames[i + 1];
    list.push(`file '${file}'`, `duration ${(next ? Math.max(0.001, next.t - f.t) : 0.1).toFixed(3)}`);
  });
  const last = frames[frames.length - 1];
  if (last) list.push(`file '${join(frameDir, `f${String(frames.length - 1).padStart(4, '0')}.png`)}'`);
  const listFile = join(frameDir, 'list.txt');
  writeFileSync(listFile, `${list.join('\n')}\n`);
  mkdirSync(OUT, { recursive: true });
  // 뷰포트(위 800×360)만 · 12fps · 팔레트 128색
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-vf',
    `crop=${W}:${H}:0:0,fps=12,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    GIF,
  ]);
  rmSync(frameDir, { recursive: true, force: true });
  const manifestPath = 'artifacts/camera/final/manifest.json';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.gif = {
    file: 'phone-800x360/walk-spectate.gif',
    // GIF 길이 = 첫 프레임 ~ 마지막 프레임 시각 + 마지막 프레임 0.1초 (concat 목록의 길이 합과 같다)
    seconds: Math.round(((last?.t ?? 0) - (frames[0]?.t ?? 0) + 0.1) * 10) / 10,
    fps: 12,
    scene: '러너 걷기(따라가기 · 화면 밖 화살표 · 공유 시야 괴물) → 수감(잘라 옮기기) → 가드 카드 탭 관전',
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  expect(problems).toEqual([]);
});
