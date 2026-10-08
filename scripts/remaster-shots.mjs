// 비주얼 리마스터 전후 비교 촬영 (M10a: 바꾸기 전, M10c: 바꾼 뒤). docs/MOBILE_PLAN.md M10 절
//
// 같은 배치 · 같은 순서로 판 화면을 찍어 <out>/<label>[/<quality>]/ 에 PNG와 manifest.json을 남긴다.
// 테스트 훅이 켜진 서버(--test-hooks)가 필요하다. --base-url을 주지 않으면 --server-dir의 빌드 결과를 직접 띄운다.
//
// 사용법
//   바꾸기 전 (origin/main을 따로 빌드해 띄운 서버에 붙는다)
//     git worktree add <임시 경로>/before-main origin/main && (cd <임시 경로>/before-main && npm ci && npm run build)
//     node <임시 경로>/before-main/server/dist/index.js --port=8194 --test-hooks --seed=12345 &   ← PID를 적어 둔다
//     npm run shots:remaster -- before --base-url=http://localhost:8194
//   바꾼 뒤 (지금 checkout을 빌드해 둔 상태에서. 서버는 스크립트가 띄우고 끈다)
//     npm run build
//     npm run shots:remaster -- after --quality high --renderer webgl
//     npm run shots:remaster -- after --quality low --renderer canvas
//
// 인자
//   before | after | --label=<이름>   저장할 하위 폴더 (기본 before)
//   --base-url=<주소>                  이미 떠 있는 서버. 없으면 --server-dir에서 server/dist/index.js를 띄운다
//   --server-dir=<경로>                서버를 띄울 checkout (기본 현재 폴더), --port=<포트> (기본 8193)
//   --out=<폴더>                       기본 artifacts/remaster
//   --quality=high|medium|low          주소에 &quality=를 붙이고, 하위 폴더를 <label>/<quality>로 (옛 빌드는 무시)
//   --renderer=canvas|webgl            찍는 탭의 렌더러 (기본 canvas). webgl이면 찍을 역할 탭만 WebGL(SwiftShader)
//                                      브라우저로 열고 나머지 탭은 Canvas로 판을 진행한다(헤드리스 WebGL 4탭은 1~3fps)
//
// 장면 (tests/e2e/m7-hud.spec.ts와 같은 배치. 생존자는 'freeze' 테스트 훅으로 멈춤)
//   러너 거점 A (8,16.5) 점령 중 · 가드 감옥 앞 (24,20) 괴물에게 발각 · 스카우트 B 쪽 (37,14) ·
//   괴물 (26,25) 추적 모드로 감옥 (24,19)을 봄 · 거점 B 0.45. 찍기 직전마다 A 0.15 · B 0.45 · 남은 시간 9:00으로 맞춘다
//   괴물은 멈추지 않는다: 멈추면 괴물 화면에 '괴물이 깨어나기까지 999999999초'가 뜬다. 이동 입력이 없어 제자리다
// 결과 파일
//   role-{monster,runner,guard,scout}@1x.png   1920×1080, 기기 픽셀 배율 1
//   role-{monster,runner,guard,scout}@2x.png   1440×900, 기기 픽셀 배율 2 (PNG는 2880×1800)
//   lobby.png (방 화면, 역할을 고른 상태) · result.png (시간 초과 결과 화면) · tab-runner.png (Tab 점수판)
//   runner-1366x768.png (1366×768 배율 1)
//   zoom-{prison,pointA}-{runner,monster}.png   @2x 화면에서 감옥 (24,16) · 거점 A (8,16) 주변 기기 픽셀 480×270을
//                                               3배 최근접 확대 (1440×810). 브라우저 canvas로 합성(새 의존성 없음)
//   manifest.json   파일별 크기 · 뷰포트 · 렌더러 · 그래픽 상태(__DECOY__.gfx가 있으면) · 콘솔 문제
//
// 시계: 디버그 훅에 freezeClock이 있으면(M10~) 장식 시계를 고정하고 찍는다. 옛 빌드에는 없어서 건너뛴다.
// 품질: WebGL 탭은 injectFps(60)이 있으면(M10~) 판 중 자동 하향을 막고 찍는다 (manifest의 gfx.downgrades = 0).
// 끝나면 띄운 브라우저와 (직접 띄웠다면) 서버를 그 핸들로만 끈다.
/* global window, document, Image, HTMLButtonElement */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROLES = ['monster', 'runner', 'guard', 'scout'];
const FULL = { viewport: { width: 1920, height: 1080 }, dsf: 1, tag: '1x' };
const HIDPI = { viewport: { width: 1440, height: 900 }, dsf: 2, tag: '2x' };
const SMALL_VIEWPORT = { width: 1366, height: 768 };
/** 확대 비교: 자를 크기(기기 픽셀)와 배율, 중심(타일 좌표) */
const ZOOM = { w: 480, h: 270, k: 3 };
const ZOOM_SPOTS = { prison: { x: 24, y: 16 }, pointA: { x: 8, y: 16 } };
/** 장식 시계를 고정할 값 (ms) */
const FROZEN_CLOCK_MS = 12_000;

const COMMON_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];
/** tests/e2e/playwright.config.ts와 같은 실행 옵션 */
const CANVAS_ARGS = [
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-accelerated-2d-canvas',
  ...COMMON_ARGS,
];
const WEBGL_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...COMMON_ARGS];

function parseArgs(argv) {
  const opts = {
    label: 'before',
    baseUrl: null,
    serverDir: '.',
    port: 8193,
    out: 'artifacts/remaster',
    quality: null,
    renderer: 'canvas',
  };
  const keys = {
    '--label': 'label',
    '--base-url': 'baseUrl',
    '--server-dir': 'serverDir',
    '--port': 'port',
    '--out': 'out',
    '--quality': 'quality',
    '--renderer': 'renderer',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === 'before' || a === 'after') {
      opts.label = a;
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(0, eq) : a;
    const key = keys[name];
    if (!key) throw new Error(`알 수 없는 인자: ${a}`);
    const value = eq >= 0 ? a.slice(eq + 1) : argv[(i += 1)];
    if (value === undefined) throw new Error(`${name}에 값이 없습니다`);
    opts[key] = value;
  }
  opts.port = Number(opts.port);
  if (opts.quality !== null && !['high', 'medium', 'low'].includes(opts.quality))
    throw new Error(`--quality는 high · medium · low: ${opts.quality}`);
  if (!['canvas', 'webgl'].includes(opts.renderer))
    throw new Error(`--renderer는 canvas · webgl: ${opts.renderer}`);
  if (!/^[a-z0-9-]+$/i.test(opts.label)) throw new Error(`--label에 쓸 수 없는 글자: ${opts.label}`);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const outDir = resolve(opts.out, opts.label, opts.quality ?? '');
const manifest = {
  label: opts.label,
  quality: opts.quality,
  renderer: opts.renderer,
  baseUrl: '',
  createdAt: new Date().toISOString(),
  shots: [],
  problems: [],
};

function log(msg) {
  console.log(`[촬영] ${msg}`);
}

async function waitHealthy(base, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch {
      // 아직 뜨는 중
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`서버가 제시간에 뜨지 않았습니다: ${base}`);
}

/** --base-url이 없으면 서버를 직접 띄운다 (끌 때는 이 핸들로만) */
async function ensureServer() {
  if (opts.baseUrl) {
    const base = opts.baseUrl.replace(/\/$/, '');
    await waitHealthy(base, 10_000);
    return { base, child: null };
  }
  const dir = resolve(opts.serverDir);
  const child = spawn(
    process.execPath,
    ['server/dist/index.js', `--port=${opts.port}`, '--test-hooks', '--seed=12345'],
    { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  log(`서버를 띄움 (PID ${child.pid}, ${dir}, 포트 ${opts.port})`);
  const base = `http://localhost:${opts.port}`;
  await waitHealthy(base, 30_000);
  return { base, child };
}

/** 앱 코드가 낸 콘솔 에러 · 경고 (브라우저 내부 GL 메시지는 제외, tests/e2e/helpers.ts와 같은 기준) */
function watchConsole(page, label) {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    if (text.includes('[.WebGL-') || text.includes('GL Driver Message') || text.includes('GroupMarkerNotSet'))
      return;
    manifest.problems.push(`${label} ${type}: ${text}`);
  });
  page.on('pageerror', (err) => manifest.problems.push(`${label} pageerror: ${err.message}`));
}

function query(renderer) {
  return `debug=hook&renderer=${renderer}${opts.quality ? `&quality=${opts.quality}` : ''}`;
}

async function sendTest(page, cmd) {
  await page.evaluate((c) => window.__DECOY__?.sendTest(c), cmd);
}

async function clickWhenEnabled(page, testId) {
  await page.waitForFunction((id) => {
    const b = document.querySelector(`[data-testid="${id}"]`);
    return b instanceof HTMLButtonElement && !b.disabled;
  }, testId);
  await page.getByTestId(testId).click();
}

async function pickRole(page, role, ready) {
  await page.getByTestId(`role-${role}`).click();
  await page.waitForFunction(
    (r) => document.querySelector(`[data-testid="role-${r}"]`)?.classList.contains('mine') === true,
    role,
  );
  if (!ready) return;
  await page.getByTestId('ready-button').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="ready-button"]')?.textContent === '준비 취소',
  );
}

/** PNG 머리에서 가로 · 세로 */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function save(file, buf, meta) {
  writeFileSync(join(outDir, file), buf);
  const size = pngSize(buf);
  manifest.shots.push({ file, ...size, bytes: buf.length, ...meta });
  log(`${file} ${size.width}×${size.height} ${(buf.length / 1024).toFixed(0)}KB`);
}

/** 찍는 순간의 탭 상태 (렌더러 · 그래픽 상태는 새 빌드에만 있다) */
async function pageMeta(page) {
  return page.evaluate(() => {
    const h = window.__DECOY__;
    return {
      cssViewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      hookRenderer: h?.renderer ?? null,
      gfx: h && 'gfx' in h ? h.gfx : null,
    };
  });
}

/** 찍기 직전: 점령 · 시간을 같은 값으로, 장식 시계 고정(있으면) */
async function steady(host, pages) {
  await sendTest(host, { kind: 'setPoint', point: 'A', progress: 0.15 });
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.45 });
  // 화면은 남은 초를 올림해서 보여 준다: 539.9초는 찍는 동안(0.4~0.9초 뒤) 9:00
  await sendTest(host, { kind: 'setTime', timeLeft: 539.9 });
  // 스냅샷(50ms) + 보간(100ms)이 지나 화면에 반영될 때까지
  await host.waitForTimeout(400);
  for (const page of pages) {
    await page.evaluate((ms) => {
      const h = window.__DECOY__;
      if (h && typeof h.freezeClock === 'function') h.freezeClock(ms);
    }, FROZEN_CLOCK_MS);
  }
}

async function unfreezeClocks(pages) {
  for (const page of pages) {
    await page.evaluate(() => {
      const h = window.__DECOY__;
      if (h && typeof h.freezeClock === 'function') h.freezeClock(null);
    });
  }
}

/**
 * 4명이 방에 들어가 역할을 고르고 시작한다(첫 번째 = 괴물 = 방장).
 * glRoles의 역할만 WebGL 브라우저로 연다. lobbyShot이면 시작 전에 방장 화면을 찍는다(m9-screens와 같은 상태)
 */
async function startMatch(browsers, base, res, glRoles, lobbyShot) {
  const players = [];
  let code = '';
  for (const role of ROLES) {
    const gl = glRoles.includes(role);
    const browser = gl ? browsers.gl : browsers.canvas;
    const context = await browser.newContext({ viewport: res.viewport, deviceScaleFactor: res.dsf });
    const page = await context.newPage();
    watchConsole(page, `${role}@${res.tag}`);
    const q = query(gl ? 'webgl' : 'canvas');
    if (players.length === 0) {
      await page.goto(`${base}/?${q}`);
      await page.getByTestId('create-room').click();
      await page.waitForFunction(() =>
        /^[A-Z]{4}$/.test(document.querySelector('[data-testid="room-code"]')?.textContent ?? ''),
      );
      code = (await page.getByTestId('room-code').textContent()) ?? '';
    } else {
      await page.goto(`${base}/?room=${code}&${q}`);
      await page.waitForFunction(
        (c) => document.querySelector('[data-testid="room-code"]')?.textContent === c,
        code,
      );
    }
    const id = await page.evaluate(() => window.__DECOY__?.you ?? '');
    players.push({ role, gl, context, page, id });
  }
  const [host, ...others] = players;
  for (const p of others) await pickRole(p.page, p.role, true);
  await pickRole(host.page, host.role, false);
  await host.page.waitForFunction(() =>
    (document.querySelector('[data-testid="player-list"]')?.textContent ?? '').includes('스카우트'),
  );
  if (lobbyShot) {
    await host.page.waitForTimeout(300);
    save('lobby.png', await host.page.screenshot(), {
      scene: 'lobby',
      ...res,
      ...(await pageMeta(host.page)),
    });
  }
  await host.page.getByTestId('ready-button').click();
  await clickWhenEnabled(host.page, 'start-button');
  for (const p of players) {
    await p.page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) >= 3, undefined, {
      timeout: 20_000,
    });
  }
  // 판 중 자동 품질 하향을 막는다: SwiftShader WebGL 탭은 40fps 아래라 판 시작 약 15초 뒤 한 단계 내려가
  // 뒤쪽 장면(Tab · 1366 · 결과)이 다른 품질로 찍힌다. 훅이 있을 때만 (옛 빌드에는 injectFps가 없다)
  for (const p of players) {
    if (!p.gl) continue;
    await p.page.evaluate(() => {
      const h = window.__DECOY__;
      if (h && typeof h.injectFps === 'function') h.injectFps(60);
    });
  }
  return players;
}

/** m7-hud.spec.ts의 장면을 만들고 모두 멈춘다 */
async function setupScene(players) {
  const by = Object.fromEntries(players.map((p) => [p.role, p]));
  const host = by.monster.page;
  await sendTest(host, { kind: 'teleport', target: by.runner.id, x: 8, y: 16.5 });
  await sendTest(host, { kind: 'teleport', target: by.guard.id, x: 24, y: 20 });
  await sendTest(host, { kind: 'teleport', target: by.scout.id, x: 37, y: 14 });
  await sendTest(host, { kind: 'teleport', target: by.monster.id, x: 26, y: 25, face: -1.9 });
  // teleport가 frozen을 0으로 되돌리므로 그 뒤에 멈춘다 (괴물은 위 머리 주석 참고)
  for (const p of players) {
    if (p.role !== 'monster') await sendTest(host, { kind: 'freeze', target: p.id, frozen: true });
  }
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.45 });
  const aim = await host.evaluate(() => window.__DECOY__?.tileToClient(24, 19) ?? null);
  if (!aim) throw new Error('tileToClient가 없습니다');
  await host.mouse.move(aim.x, aim.y);
  await host.mouse.down({ button: 'right' });
  await host.mouse.up({ button: 'right' });
  await host.waitForFunction(
    () => (window.__DECOY__?.getBanners() ?? []).some((t) => t.includes('무언가 움직인다')),
    undefined,
    { timeout: 10_000 },
  );
  await by.guard.page.waitForFunction(() => window.__DECOY__?.getLastSnapshot()?.you.surv?.spotted === true);
  await host.waitForTimeout(600);
  return by;
}

/** 확대 비교: 스크린샷 버퍼에서 기기 픽셀 영역을 잘라 최근접으로 k배 (브라우저 canvas로 합성) */
async function cropZoom(composer, buf, cx, cy) {
  const { width, height } = pngSize(buf);
  const sx = Math.max(0, Math.min(width - ZOOM.w, Math.round(cx - ZOOM.w / 2)));
  const sy = Math.max(0, Math.min(height - ZOOM.h, Math.round(cy - ZOOM.h / 2)));
  const b64 = await composer.evaluate(
    async ({ src, sx, sy, w, h, k }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w * k;
      c.height = h * k;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, sx, sy, w, h, 0, 0, w * k, h * k);
      return c.toDataURL('image/png').slice('data:image/png;base64,'.length);
    },
    { src: buf.toString('base64'), sx, sy, ...ZOOM },
  );
  return { png: Buffer.from(b64, 'base64'), crop: { x: sx, y: sy, w: ZOOM.w, h: ZOOM.h, k: ZOOM.k } };
}

/**
 * 한 판에서 찍을 것: roles(역할 화면), zoomRoles(확대 비교), extras(Tab · 1366 · 결과 — 러너 탭)
 */
async function shootMatch(browsers, composer, base, res, plan) {
  log(
    `판 시작: ${res.viewport.width}×${res.viewport.height} @${res.dsf}, WebGL 탭 [${plan.glRoles.join(', ')}]`,
  );
  const players = await startMatch(browsers, base, res, plan.glRoles, plan.lobby);
  try {
    const by = await setupScene(players);
    const host = by.monster.page;
    const pages = players.map((p) => p.page);
    for (const role of plan.roles) {
      const page = by[role].page;
      await steady(host, pages);
      const meta = { scene: `role-${role}`, ...res, ...(await pageMeta(page)) };
      const spots = {};
      for (const [name, t] of Object.entries(ZOOM_SPOTS)) {
        spots[name] = await page.evaluate(
          ([x, y]) => window.__DECOY__?.tileToClient(x, y) ?? null,
          [t.x, t.y],
        );
      }
      const buf = await page.screenshot();
      save(`role-${role}@${res.tag}.png`, buf, meta);
      if (plan.zoomRoles.includes(role)) {
        for (const [name, p] of Object.entries(spots)) {
          if (!p) throw new Error('tileToClient가 없습니다');
          const z = await cropZoom(composer, buf, p.x * res.dsf, p.y * res.dsf);
          save(`zoom-${name}-${role}.png`, z.png, {
            scene: `zoom-${name}`,
            from: `role-${role}@${res.tag}.png`,
            ...z.crop,
          });
        }
      }
    }
    if (plan.extras) {
      const runner = by.runner.page;
      // Tab 점수판 (누르고 있는 동안)
      await steady(host, pages);
      await runner.keyboard.down('Tab');
      await runner.waitForTimeout(200);
      save('tab-runner.png', await runner.screenshot(), {
        scene: 'tab',
        ...res,
        ...(await pageMeta(runner)),
      });
      await runner.keyboard.up('Tab');
      // 1366×768 배율 1
      await unfreezeClocks(pages);
      await runner.setViewportSize(SMALL_VIEWPORT);
      await runner.waitForTimeout(800);
      await steady(host, pages);
      save('runner-1366x768.png', await runner.screenshot(), {
        scene: 'small',
        viewport: SMALL_VIEWPORT,
        dsf: 1,
        ...(await pageMeta(runner)),
      });
      await unfreezeClocks(pages);
      await runner.setViewportSize(res.viewport);
      await runner.waitForTimeout(800);
      // 결과 화면: 시간 초과로 끝낸다 (탈출 0명 → 괴물 승리, m9-screens와 같음)
      await sendTest(runner, { kind: 'setTime', timeLeft: 0.1 });
      await runner.getByTestId('result').waitFor({ state: 'visible', timeout: 10_000 });
      await runner.waitForTimeout(500);
      save('result.png', await runner.screenshot(), { scene: 'result', ...res, ...(await pageMeta(runner)) });
    }
  } finally {
    for (const p of players) await p.context.close();
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = await ensureServer();
  manifest.baseUrl = server.base;
  const browsers = { canvas: null, gl: null };
  try {
    browsers.canvas = await chromium.launch({ args: CANVAS_ARGS });
    browsers.gl = opts.renderer === 'webgl' ? await chromium.launch({ args: WEBGL_ARGS }) : browsers.canvas;
    const composerContext = await browsers.canvas.newContext({ viewport: { width: 800, height: 600 } });
    const composer = await composerContext.newPage();
    await composer.setContent('<!doctype html><html><body style="margin:0"></body></html>');
    if (opts.renderer === 'canvas') {
      // Canvas: 해상도마다 한 판에서 네 역할을 다 찍는다
      await shootMatch(browsers, composer, server.base, FULL, {
        glRoles: [],
        roles: ROLES,
        zoomRoles: [],
        lobby: true,
        extras: true,
      });
      await shootMatch(browsers, composer, server.base, HIDPI, {
        glRoles: [],
        roles: ROLES,
        zoomRoles: ['runner', 'monster'],
        lobby: false,
        extras: false,
      });
    } else {
      // WebGL: 찍을 역할 탭만 WebGL로 연 판을 역할 · 해상도마다 따로 (나머지 탭은 Canvas)
      for (const role of ROLES) {
        await shootMatch(browsers, composer, server.base, FULL, {
          glRoles: [role],
          roles: [role],
          zoomRoles: [],
          lobby: role === 'monster',
          extras: role === 'runner',
        });
        await shootMatch(browsers, composer, server.base, HIDPI, {
          glRoles: [role],
          roles: [role],
          zoomRoles: role === 'runner' || role === 'monster' ? [role] : [],
          lobby: false,
          extras: false,
        });
      }
    }
    await composerContext.close();
  } finally {
    if (browsers.gl && browsers.gl !== browsers.canvas) await browsers.gl.close();
    if (browsers.canvas) await browsers.canvas.close();
    if (server.child) {
      server.child.kill('SIGTERM');
      log(`서버를 끔 (PID ${server.child.pid})`);
    }
  }
  manifest.shots.sort((a, b) => (a.file < b.file ? -1 : 1));
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${manifest.shots.length}장 → ${outDir}`);
  if (manifest.problems.length > 0) {
    console.error(`[촬영] 콘솔 에러 · 경고 ${manifest.problems.length}개:`);
    for (const p of manifest.problems) console.error(`  ${p}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
