// DECOY 서버 진입점: HTTP(정적 파일) + WebSocket + 30Hz 틱 루프
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { LagQueue, Rng } from '@decoy/shared';
import { PROGRESSION, validateProgression } from '@decoy/shared/meta';
import { ServerCore, truthOf, type Conn, type Room } from '@decoy/shared/sim';
import {
  BUILD_HEADER,
  HEALTH_PATH,
  MAX_STALL_MS,
  SERVER_MARK_HEADER,
  loadBalance,
  parseOptions,
  readBuildId,
} from './config';
import { createSender } from './sendPolicy';
import { PRIVACY_CONTACT_ENV, PRIVACY_PATHS, contactHtml, privacyHandler } from './privacy';
import { serveStatic } from './static';
import { TruthLog } from './truthLog';
import { ASSETLINKS_PATH, assetLinksFromEnv } from './wellKnown';
import { spawnLocalBot } from './bots';
import { createQuickBots } from './quickBots';
import { createAccountSystem } from './account/system';

const options = parseOptions(process.argv.slice(2), process.env);
const balance = loadBalance(options.balancePath);
// 판 밖 성장 수치(빌드에 넣은 config/progression.json): 평가 계산 전에 모양을 본다 — 틀리면 시작하지 않는다
validateProgression(PROGRESSION);
/** 함께 빌드한 화면의 빌드 ID (M13d). 없으면 null(비교 안 함) */
const buildId = readBuildId(options.staticDir);
/** 안드로이드 앱 도메인 연결 (M14): 환경 변수가 맞으면 본문, 아니면 null → 404 */
const assetLinks = assetLinksFromEnv(process.env);
if (assetLinks.problem) console.warn(assetLinks.problem);
/** 개인정보 처리방침 (M15): 문의처는 환경 변수 PRIVACY_CONTACT */
const servePrivacy = privacyHandler(options.staticDir, process.env);
const truthLog = options.truthLogPath ? new TruthLog(options.truthLogPath) : null;
/**
 * 선택형 구글 로그인 · 계정 저장 (docs/ACCOUNT_PLAN.md): 환경 변수 DECOY_LOGIN=1 등으로 켠다(기본 꺼짐 — 꺼지면 판은 지금과 같다).
 * 켜졌는데 저장소가 시작하지 못해도 서버는 뜨고 계정 요청만 503 (판은 게스트로 그대로)
 */
const accounts = createAccountSystem({
  env: process.env,
  testHooks: options.testHooks,
  dev: options.dev,
  contact: contactHtml(process.env[PRIVACY_CONTACT_ENV]),
});
if (accounts.config.requested && !accounts.on) console.warn(accounts.summary);
else console.log(accounts.summary);
void accounts.start();
const lagRng = new Rng(options.seed ^ 0x5bd1e995);

// 빠른 매칭 빈자리 봇 (M13c): 같은 프로세스 실전 봇 (quickBots.ts). 실전 봇 지도를 여기서(listen 전) 미리 계산한다 —
// 서버 시작 뒤 첫 봇 판의 시작 틱 안에서 계산하지 않게 (출시 전 검토)
const quickBots = createQuickBots(balance, options.seed);

/**
 * 지금 봇을 채워 판을 하는 빠른 매칭 방 수 (동시 봇 방 상한, DECISIONS M13c). 개발용 봇 방(?bots=1)은 세지 않는다 —
 * 배포 서버에서는 꺼져 있다(options.devBots)
 */
function botRoomsPlaying(except: Room): number {
  let n = 0;
  for (const r of core.manager.rooms.values())
    if (r !== except && r.kind === 'quick' && r.phase === 'playing' && r.seats.some((s) => s.bot)) n += 1;
  return n;
}

// 방 · 연결 처리 · 틱 스케줄러는 기기 안 연습과 같은 코드 (shared/src/sim/core.ts). 여기는 HTTP · ws 소켓 · setInterval만
const core = new ServerCore(
  { balance, seed: options.seed, testHooks: options.testHooks, buildId, devBots: options.devBots },
  {
    log: (m) => console.log(m),
    recordTruth: truthLog ? (room) => truthLog.record(room) : undefined,
    // ?bots=1 개발용 방(개발 서버에서만)은 WebSocket 봇, 빠른 매칭은 같은 프로세스 실전 봇
    spawnBot: (room, seat) => {
      if (room.kind === 'quick') quickBots.attach(room, seat);
      else spawnLocalBot(`ws://127.0.0.1:${actualPort()}/ws`, room.code, seat.token);
    },
    beforeStep: (room) => quickBots.beforeStep(room),
    canFillBots: (room) => botRoomsPlaying(room) < options.maxBotRooms,
    // 판 보상 계정 적립 (로그인이 켜졌을 때만): 결과를 보낸 뒤 그 자리의 계정에 서버가 적립한다
    rated: accounts.on ? (_room, seat, rating) => accounts.rated(seat.account, rating) : undefined,
  },
  () => performance.now(),
);
const manager = core.manager;

/**
 * 테스트 전용(--test-hooks): 이 시각(performance.now)까지 HTTP 요청과 새 WebSocket 연결을 붙잡아 둔다.
 * Render 무료 플랜처럼 잠든 서버가 깨어나는 동안을 흉내 내 '서버 깨우는 중' 안내를 E2E로 확인한다
 */
let stallUntil = 0;
/** false면 HTTP는 그대로 두고 새 WebSocket 연결만 붙잡는다 */
let stallHttp = true;
/** 테스트 전용: 이 시각까지 응답에 표시 헤더를 붙이지 않는다 (표시를 모르는 예전 버전 서버 흉내) */
let unmarkUntil = 0;

function stallLeft(pathname: string, kind: 'http' | 'ws'): number {
  if (pathname.startsWith('/test/')) return 0;
  if (kind === 'http' && !stallHttp) return 0;
  return Math.max(0, stallUntil - performance.now());
}

function safePathname(raw: string | undefined): string | null {
  try {
    return new URL(raw ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}

const httpServer = createServer((req, res) => {
  // 모든 응답(오류 포함)에 표시를 붙인다. 표시가 없으면 호스팅 서비스(깨우는 중 화면 등)가 대신 답한 것
  if (performance.now() >= unmarkUntil) {
    res.setHeader(SERVER_MARK_HEADER, '1');
    if (buildId) res.setHeader(BUILD_HEADER, buildId);
  }
  const wait = stallLeft(safePathname(req.url) ?? '/', 'http');
  if (wait > 0) {
    setTimeout(() => safeHandleHttp(req, res), wait);
    return;
  }
  safeHandleHttp(req, res);
});

function safeHandleHttp(req: IncomingMessage, res: ServerResponse): void {
  // 요청 하나의 오류(잘못된 URL 등)가 서버 전체를 멈추지 않게
  try {
    handleHttp(req, res);
  } catch (err) {
    console.error('HTTP 처리 오류', err);
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url.pathname === ASSETLINKS_PATH) {
    // 리다이렉트 없이 200 JSON (구글 확인 도구 조건). 값이 없으면 404 — 게임 HTML을 주지 않는다
    if (assetLinks.body)
      res
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' })
        .end(assetLinks.body);
    else
      res
        .writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        .end('not found');
    return;
  }
  if (url.pathname === HEALTH_PATH) {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('ok');
    return;
  }
  if (url.pathname === '/test/stall') {
    // 테스트 전용: ms 동안 요청을 붙잡는다. drop=1이면 지금 열린 WebSocket을 모두 끊고(잠들 때처럼),
    // http=0이면 HTTP는 두고 새 WebSocket 연결만 붙잡는다
    if (!options.testHooks) {
      res.writeHead(404).end();
      return;
    }
    const ms = Math.min(MAX_STALL_MS, Math.max(0, Number(url.searchParams.get('ms') ?? 0) || 0));
    stallUntil = performance.now() + ms;
    stallHttp = url.searchParams.get('http') !== '0';
    if (url.searchParams.get('drop') === '1') for (const client of wss.clients) client.terminate();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ stallMs: ms }));
    return;
  }
  if (url.pathname === '/test/unmark') {
    // 테스트 전용: ms 동안 표시 헤더 없이 답한다 (깨우기 화면의 탈출구 확인용)
    if (!options.testHooks) {
      res.writeHead(404).end();
      return;
    }
    const ms = Math.min(MAX_STALL_MS, Math.max(0, Number(url.searchParams.get('ms') ?? 0) || 0));
    unmarkUntil = performance.now() + ms;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ unmarkMs: ms }));
    return;
  }
  if (url.pathname === '/test/state') {
    // 테스트 전용 정답 상태. --test-hooks 없이는 존재하지 않는다
    if (!options.testHooks) {
      res.writeHead(404).end();
      return;
    }
    const room = manager.rooms.get((url.searchParams.get('room') ?? '').toUpperCase());
    res.writeHead(room ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(room ? truthOf(room) : null));
    return;
  }
  // 계정 경로 (/api/account · /auth/* · /account/* · 계정 시험 훅): 정적 파일보다 먼저. 꺼져 있으면 '꺼짐'으로만 답한다
  if (accounts.handle(req, res, url)) return;
  if (PRIVACY_PATHS.includes(url.pathname)) {
    // 개인정보 처리방침: 문의처를 환경 변수로 바꿔 넣는다. 파일이 없으면 404 (게임 HTML을 주지 않는다)
    servePrivacy(res, req.headers['accept-encoding']);
    return;
  }
  serveStatic(options.staticDir, url, res);
}

function actualPort(): number {
  const addr = httpServer.address();
  return typeof addr === 'object' && addr ? addr.port : options.port;
}

let connCounter = 0;
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  socket.on('error', () => socket.destroy());
  const pathname = safePathname(req.url);
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const accept = (): void => {
    if (socket.destroyed) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  const wait = stallLeft(pathname, 'ws');
  if (wait > 0) setTimeout(accept, wait);
  else accept();
});
/** 하트비트: 10초마다 ping, 그사이 pong이 없으면 끊는다 (절전 · 와이파이 끊김 같은 반쯤 열린 연결) */
const alive = new WeakMap<WebSocket, boolean>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 10_000);

wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
  connCounter += 1;
  const half = options.lag / 2;
  const jitter = options.lag > 0 ? balance.network.lagJitterMs : 0;
  // 로그인한 계정 (세션 쿠키 서명만 확인 — DB 조회 없음, 꺼짐 · 게스트는 null). 방은 자리에만 들고 어떤 메시지에도 싣지 않는다
  const account = accounts.accountOf(req);
  // 송신: 받는 쪽이 못 따라오면 오래된 스냅샷은 건너뛰고(거점 메모가 든 것은 보냄), 그래도 크게 쌓이면 끊는다 (sendPolicy.ts)
  const conn: Conn = { id: connCounter, account, ...createSender(socket, half, jitter, () => lagRng.next()) };
  accounts.conns.add(conn);
  alive.set(socket, true);
  socket.on('pong', () => alive.set(socket, true));
  const link = core.connect(conn, (err) => {
    // 메시지 하나의 오류가 서버 전체를 멈추지 않게: 그 연결만 닫는다
    console.error('메시지 처리 오류', err);
    socket.close();
  });
  const inbound = new LagQueue<string>(
    half,
    jitter,
    (raw) => link.receive(raw),
    () => lagRng.next(),
  );

  socket.on('message', (data) => inbound.push(data.toString()));
  socket.on('close', () => {
    accounts.conns.remove(conn);
    link.close();
  });
  socket.on('error', () => socket.close());
});

// 고정 틱 루프: 틱 길이의 1/4마다 깨어 와야 했던 틱을 명목 시각으로 돌린다 (ServerCore.advance)
setInterval(() => core.advance(performance.now()), core.tickMs / 4);

httpServer.listen(options.port, options.host, () => {
  const lag = options.lag > 0 ? ` (지연 ${options.lag}ms)` : '';
  const hooks = (options.testHooks ? ' [테스트 훅]' : '') + (options.devBots ? ' [개발용 봇 방]' : '');
  // 봇 방 상한은 Render 로그에서 환경 변수(DECOY_MAX_BOT_ROOMS)가 들어갔는지 확인하라고 같이 찍는다
  console.log(
    `DECOY 서버 시작: http://localhost:${actualPort()}${lag}${hooks} (빠른 매칭 봇 방 상한 ${options.maxBotRooms})`,
  );
});

// 종료 신호: 컨테이너에서 PID 1로 돌면 Node가 SIGTERM · SIGINT를 기본 처리하지 않으므로 직접 끝낸다
// (docker stop이 10초를 기다렸다 강제 종료하거나, Ctrl+C로 멈추지 않는 문제)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`DECOY 서버 종료 (${signal})`);
    for (const client of wss.clients) client.terminate();
    httpServer.close();
    // 계정 저장소 연결 정리 (꺼져 있으면 바로). 오래 걸려도 2초 뒤에는 끝낸다
    const exit = (): never => process.exit(0);
    setTimeout(exit, 2000).unref();
    void accounts.close().finally(exit);
  });
}
