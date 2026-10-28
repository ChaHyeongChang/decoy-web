// 배포 검증 (M9): 배포와 같은 방식으로 띄운 서버에 HTTP · WebSocket으로 접속해 본다.
//   node scripts/verify-deploy.mjs           → Docker 이미지를 빌드해 컨테이너로 띄운다 (Docker가 없으면 빌드 결과물로 직접)
//   node scripts/verify-deploy.mjs --no-docker → 빌드 결과물(server/dist, client/dist)을 PORT 환경 변수로 직접 띄운다
//   node scripts/verify-deploy.mjs --url=https://<배포 주소> → 이미 배포된 서버(Render 등)를 본다. 띄우지 않고, 가짜 환경 변수가
//     필요한 검사(assetlinks · 처리방침 문의처)는 건너뛴다. 잠든 무료 서버가 깨어날 때까지 3분 기다린다
//     (GitHub Actions '배포판 검증' 작업 — .github/workflows/verify-live.yml)
// 번들 줄이기: 첫 화면 JS와 앱 셸(sw.js)의 모든 JS 조각 · CSS · HTML이 brotli를 받는 쪽에는 br, gzip만 받는 쪽에는 gzip,
// 압축을 받지 않는 쪽에는 원본으로 오고, 풀면 원본과 같은지 · 빌드 헤더가 sw.js 빌드와 같은지 본다. 받은 바이트(압축된 채)를 적는다
// 환경 변수: NODE_IMAGE(베이스 이미지 바꾸기), HTTPS_PROXY · HTTP_PROXY(빌드 중 npm), NPM_CA(사설 인증서 파일)
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import WebSocket from 'ws';

const PORT_IN_CONTAINER = 3000;
/** assetlinks 확인용 가짜 값 (M14): 형식만 맞는 패키지 이름 · 지문 두 개 (실제 서명 키와 무관) */
const FAKE_PACKAGE = 'com.example.decoyverify';
const FAKE_FINGERPRINTS = [
  Array.from({ length: 32 }, (_, i) => ((i * 7 + 3) & 255).toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase(),
  Array.from({ length: 32 }, (_, i) => ((i * 13 + 1) & 255).toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase(),
];
/** 처리방침 문의처 (M15): 넣은 값이 /privacy에 그대로 나오는지 본다 */
const FAKE_CONTACT = 'privacy-check@example.com';
const TWA_ENV = {
  TWA_PACKAGE_NAME: FAKE_PACKAGE,
  TWA_SHA256_FINGERPRINTS: FAKE_FINGERPRINTS.join(','),
  PRIVACY_CONTACT: FAKE_CONTACT,
};
const IMAGE = 'decoy-web:verify';
const CONTAINER = 'decoy-web-verify';

function log(msg) {
  console.log(`[배포 검증] ${msg}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function hasDocker() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
  throw new Error('서버가 제시간에 뜨지 않았습니다');
}

function wsWelcome(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('WebSocket 응답 없음')), 5000);
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          t: 'join',
          room: null,
          create: true,
          name: '검사',
          token: null,
          altTokens: [],
          bots: false,
        }),
      ),
    );
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') {
        clearTimeout(timer);
        ws.close();
        resolve(m.room);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** 압축을 풀지 않고 받는다 (fetch는 저절로 풀어 받은 바이트를 알 수 없다). 상태 · 헤더 · 받은 본문 그대로 */
function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
      res.on('error', reject);
    });
    req.setTimeout(60_000, () => req.destroy(new Error(`시간 초과 ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

/** 받은 본문을 content-encoding대로 푼다 */
function decode(r) {
  const enc = r.headers['content-encoding'];
  if (enc === 'br') return brotliDecompressSync(r.body);
  if (enc === 'gzip') return gunzipSync(r.body);
  if (enc === undefined || enc === 'identity') return r.body;
  throw new Error(`모르는 content-encoding ${enc}`);
}

/**
 * 압축 전송 (번들 줄이기): 경로마다 br · gzip · 원본을 받아 본다. brotli를 받으면 br, gzip만 받으면 gzip, 압축을 받지 않으면 원본이고,
 * 풀면 셋이 같아야 한다. 빌드 헤더가 있으면 build와 같아야 한다. 경로별 받은 바이트 { path: { br, gzip, raw } }
 */
async function checkEncodings(base, paths, build) {
  const sizes = {};
  for (const path of paths) {
    const raw = await rawGet(`${base}${path}`, { 'accept-encoding': 'identity' });
    if (raw.status !== 200) throw new Error(`${path} HTTP ${raw.status}`);
    if (raw.headers['content-encoding'] && raw.headers['content-encoding'] !== 'identity')
      throw new Error(`${path}: 압축을 받지 않는 요청에 ${raw.headers['content-encoding']}`);
    const got = { raw: raw.body.length };
    for (const [ae, want] of [
      ['gzip, deflate, br, zstd', 'br'],
      ['gzip, deflate', 'gzip'],
    ]) {
      const r = await rawGet(`${base}${path}`, { 'accept-encoding': ae });
      if (r.status !== 200) throw new Error(`${path} (${ae}) HTTP ${r.status}`);
      const enc = r.headers['content-encoding'];
      if (enc !== want)
        throw new Error(`${path}: Accept-Encoding '${ae}'에 ${enc ?? '압축 없음'} (기대 ${want})`);
      if (!decode(r).equals(raw.body)) throw new Error(`${path}: ${want}를 풀면 원본과 다릅니다`);
      if (build && r.headers['x-decoy-build'] !== undefined && r.headers['x-decoy-build'] !== build)
        throw new Error(`${path}: 빌드 헤더 ${r.headers['x-decoy-build']} ≠ sw.js 빌드 ${build}`);
      got[want] = r.body.length;
    }
    sizes[path] = got;
  }
  return sizes;
}

/** sw.js의 빌드 ID · 앱 셸 목록 (빌드 때 넣은 두 줄) */
async function shellOf(base) {
  const r = await rawGet(`${base}/sw.js`, { 'accept-encoding': 'identity' });
  if (r.status !== 200) throw new Error(`sw.js HTTP ${r.status}`);
  const src = r.body.toString('utf8');
  const build = /^const BUILD = "([^"]+)";/m.exec(src)?.[1];
  const shell = /^const SHELL = (\[.*\]);/m.exec(src)?.[1];
  if (!build || !shell) throw new Error('sw.js에 빌드 ID · 셸 목록이 없습니다 (빌드하지 않은 원본?)');
  return { build, shell: JSON.parse(shell) };
}

/** 압축 전송 · 나눠 받는 조각: 첫 화면 JS와 셸의 모든 JS · CSS · index.html */
async function checkCompression(base, firstJs) {
  const { build, shell } = await shellOf(base);
  const js = shell.filter((f) => f.endsWith('.js')).map((f) => `/${f}`);
  if (!js.includes(firstJs)) throw new Error(`첫 화면 JS ${firstJs}가 sw.js 셸 목록에 없습니다`);
  const css = shell.filter((f) => f.endsWith('.css')).map((f) => `/${f}`);
  const sizes = await checkEncodings(base, ['/', ...css, ...js], build);
  const sum = (paths, k) => paths.reduce((a, p) => a + (sizes[p]?.[k] ?? 0), 0);
  const lazy = js.filter((p) => p !== firstJs);
  log(
    `압축 전송 통과 (빌드 ${build}): 첫 화면 JS br ${sizes[firstJs].br}B · gzip ${sizes[firstJs].gzip}B · 원본 ${sizes[firstJs].raw}B, ` +
      `JS 전체 ${js.length}개 br ${sum(js, 'br')}B · gzip ${sum(js, 'gzip')}B · 원본 ${sum(js, 'raw')}B, ` +
      `나눠 받는 조각 ${lazy.length}개 (${lazy.map((p) => p.replace(/^\/assets\//, '').replace(/-[\w-]+\.js$/, '')).join(' · ')})`,
  );
}

async function check(base, { remote = false } = {}) {
  await waitHealthy(base, remote ? 180_000 : 30_000);
  const index = await fetch(`${base}/`);
  if (index.status !== 200) throw new Error(`첫 화면 HTTP ${index.status}`);
  if (index.headers.get('x-decoy-server') !== '1')
    throw new Error('첫 화면에 x-decoy-server 표시가 없습니다');
  const html = await index.text();
  const asset = /src="\.?(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  if (!asset) throw new Error('첫 화면에 스크립트가 없습니다');
  const js = await fetch(`${base}${asset}`);
  if (js.status !== 200) throw new Error(`스크립트 HTTP ${js.status}`);
  log(`HTTP 200 (첫 화면, ${asset})`);
  await checkCompression(base, asset);
  const room = await wsWelcome(`${base.replace('http', 'ws')}/ws`);
  log(`WebSocket 접속 · 방 만들기 성공 (방 ${room})`);
  if (remote) {
    // 배포된 서버: manifest만 (assetlinks · 처리방침 문의처는 대시보드 환경 변수 값이라 가짜 값과 견주지 않는다)
    const mr = await fetch(`${base}/manifest.webmanifest`);
    if (mr.status !== 200) throw new Error(`manifest HTTP ${mr.status}`);
    log('manifest 200');
    return;
  }
  await checkPwa(base);
}

/** M14: manifest · 아이콘 · assetlinks.json (컨테이너에 가짜 TWA 환경 변수를 넣고 띄웠다) */
async function checkPwa(base) {
  const mr = await fetch(`${base}/manifest.webmanifest`);
  if (mr.status !== 200 || mr.headers.get('content-type') !== 'application/manifest+json')
    throw new Error(`manifest HTTP ${mr.status} ${mr.headers.get('content-type')}`);
  const manifest = await mr.json();
  for (const icon of manifest.icons ?? []) {
    const r = await fetch(new URL(icon.src, `${base}/manifest.webmanifest`));
    if (r.status !== 200 || r.headers.get('content-type') !== 'image/png')
      throw new Error(`아이콘 ${icon.src} HTTP ${r.status} ${r.headers.get('content-type')}`);
  }
  log(`manifest · 아이콘 ${manifest.icons?.length ?? 0}개 200`);
  const al = await fetch(`${base}/.well-known/assetlinks.json`, { redirect: 'manual' });
  if (al.status !== 200 || al.headers.get('content-type') !== 'application/json')
    throw new Error(`assetlinks HTTP ${al.status} ${al.headers.get('content-type')}`);
  const links = await al.json();
  const target = links?.[0]?.target;
  if (
    target?.package_name !== FAKE_PACKAGE ||
    JSON.stringify(target?.sha256_cert_fingerprints) !== JSON.stringify(FAKE_FINGERPRINTS)
  )
    throw new Error(`assetlinks 본문이 다릅니다: ${JSON.stringify(links)}`);
  log('assetlinks.json 200 (가짜 지문 두 개, 리다이렉트 없음)');
  // 개인정보 처리방침 (M15): 200 · HTML · 한국어 · 게임 HTML이 아님 · 넣은 문의처
  for (const path of ['/privacy', '/privacy.html']) {
    const pr = await fetch(`${base}${path}`, { redirect: 'manual' });
    const html = await pr.text();
    if (pr.status !== 200 || pr.headers.get('content-type') !== 'text/html; charset=utf-8')
      throw new Error(`${path} HTTP ${pr.status} ${pr.headers.get('content-type')}`);
    if (
      !html.includes('<html lang="ko">') ||
      !html.includes('개인정보 처리방침') ||
      html.includes('id="game-root"')
    )
      throw new Error(`${path} 본문이 처리방침이 아닙니다`);
    if (!html.includes(`mailto:${FAKE_CONTACT}`))
      throw new Error(`${path}에 문의처(PRIVACY_CONTACT)가 없습니다`);
  }
  log('처리방침 /privacy · /privacy.html 200 (문의처 환경 변수 반영)');
}

async function viaDocker() {
  const args = ['build', '-t', IMAGE];
  if (process.env.NODE_IMAGE) args.push('--build-arg', `NODE_IMAGE=${process.env.NODE_IMAGE}`);
  const proxies = ['HTTPS_PROXY', 'HTTP_PROXY'].filter((k) => process.env[k]);
  // 프록시가 이 컴퓨터(127.0.0.1)에 있을 수 있어 빌드도 호스트 네트워크로
  if (proxies.length > 0) args.push('--network', 'host');
  for (const k of proxies) args.push('--build-arg', `${k}=${process.env[k]}`);
  if (process.env.NPM_CA) {
    // 사설 인증서가 필요한 네트워크(회사 프록시 등): npm ci 단계에만 인증서를 빌드 비밀로 넘기는 임시 Dockerfile (BuildKit 필요)
    const original = readFileSync('Dockerfile', 'utf8');
    const line = 'RUN npm ci --no-audit --no-fund';
    if (!original.includes(line)) throw new Error('Dockerfile에서 npm ci 줄을 찾지 못했습니다');
    const derived = original.replace(
      line,
      'RUN --mount=type=secret,id=npm_ca NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm ci --no-audit --no-fund',
    );
    const file = join(mkdtempSync(join(tmpdir(), 'decoy-verify-')), 'Dockerfile');
    writeFileSync(file, derived);
    args.push('-f', file, '--secret', `id=npm_ca,src=${process.env.NPM_CA}`);
  }
  args.push('.');
  log(`docker ${args.join(' ')}`);
  execFileSync('docker', args, { stdio: 'inherit' });
  const hostPort = await freePort();
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  } catch {
    // 없으면 그만
  }
  execFileSync('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    `PORT=${PORT_IN_CONTAINER}`,
    ...Object.entries(TWA_ENV).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-p',
    `${hostPort}:${PORT_IN_CONTAINER}`,
    IMAGE,
  ]);
  try {
    await check(`http://127.0.0.1:${hostPort}`);
    // 종료 신호를 받으면 바로 끝나야 한다 (PID 1에서 SIGTERM을 무시하면 docker stop이 10초 기다린다)
    const stopAt = Date.now();
    execFileSync('docker', ['stop', '-t', '10', CONTAINER], { stdio: 'ignore' });
    const stopMs = Date.now() - stopAt;
    if (stopMs > 5000) throw new Error(`docker stop에 ${stopMs}ms 걸렸습니다 (SIGTERM 처리 안 됨)`);
    log(`docker stop ${stopMs}ms (SIGTERM 처리)`);
    log(
      `컨테이너 로그: ${execFileSync('docker', ['logs', CONTAINER]).toString().trim().replace(/\n/g, ' / ')}`,
    );
  } finally {
    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  }
}

async function viaNode() {
  log('npm run build');
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/dist/index.js'], {
    env: { ...process.env, ...TWA_ENV, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => log(`서버: ${d.toString().trim()}`));
  proc.stderr.on('data', (d) => log(`서버 오류: ${d.toString().trim()}`));
  try {
    await check(`http://127.0.0.1:${port}`);
  } finally {
    proc.kill('SIGTERM');
  }
}

const noDocker = process.argv.includes('--no-docker');
const remoteUrl = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length) ?? null;
try {
  if (remoteUrl) {
    const base = remoteUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) throw new Error(`--url은 http(s) 주소여야 합니다: ${remoteUrl}`);
    log(`배포된 서버 ${base}`);
    await check(base, { remote: true });
  } else if (!noDocker && hasDocker()) await viaDocker();
  else {
    if (!noDocker) log('Docker를 쓸 수 없어 빌드 결과물로 직접 띄웁니다');
    await viaNode();
  }
  log('통과');
} catch (e) {
  log(`실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
