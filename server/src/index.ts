// DECOY 서버 진입점: HTTP(정적 파일) + WebSocket + 30Hz 틱 루프
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { LagQueue, Rng } from '@decoy/shared';
import { BotDriver, ServerCore, practiceBrain, truthOf, type Conn, type Room } from '@decoy/shared/sim';
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
import { serveStatic } from './static';
import { TruthLog } from './truthLog';
import { spawnLocalBot } from './bots';

const options = parseOptions(process.argv.slice(2), process.env);
const balance = loadBalance(options.balancePath);
/** 함께 빌드한 화면의 빌드 ID (M13d). 없으면 null(비교 안 함) */
const buildId = readBuildId(options.staticDir);
const truthLog = options.truthLogPath ? new TruthLog(options.truthLogPath) : null;
const lagRng = new Rng(options.seed ^ 0x5bd1e995);

/** 방 코드 → 정수 (한 방의 봇이 같은 시드를 쓰게) */
function codeSeed(code: string): number {
  let h = options.seed | 0;
  for (let i = 0; i < code.length; i += 1) h = (Math.imul(h, 31) + code.charCodeAt(i)) | 0;
  return h;
}

// 빠른 매칭 빈자리 봇 (M13c): 같은 프로세스 실전 봇 (기기 안 연습과 같은 두뇌 · 드라이버, 소켓 없음).
// 한 방의 봇은 같은 시드 (생존자 봇의 점령 계획이 서로 맞물린다), 판마다 다르게 판 수를 섞는다
const quickBots = new BotDriver(
  (info, _seat, room) => practiceBrain(info.role, (codeSeed(room.code) + room.matchCount * 7919) | 0),
  balance,
);

/** 지금 봇을 채워 판을 하는 빠른 매칭 방 수 (동시 봇 방 상한, DECISIONS M13c) */
function botRoomsPlaying(except: Room): number {
  let n = 0;
  for (const r of core.manager.rooms.values())
    if (r !== except && r.kind === 'quick' && r.phase === 'playing' && r.seats.some((s) => s.bot)) n += 1;
  return n;
}

// 방 · 연결 처리 · 틱 스케줄러는 기기 안 연습과 같은 코드 (shared/src/sim/core.ts). 여기는 HTTP · ws 소켓 · setInterval만
const core = new ServerCore(
  { balance, seed: options.seed, testHooks: options.testHooks, buildId },
  {
    log: (m) => console.log(m),
    recordTruth: truthLog ? (room) => truthLog.record(room) : undefined,
    // ?bots=1 개발용 방은 WebSocket 봇, 빠른 매칭은 같은 프로세스 실전 봇
    spawnBot: (room, seat) => {
      if (room.kind === 'quick') quickBots.attach(room, seat);
      else spawnLocalBot(`ws://127.0.0.1:${actualPort()}/ws`, room.code, seat.token);
    },
    beforeStep: (room) => quickBots.beforeStep(room),
    canFillBots: (room) => botRoomsPlaying(room) < options.maxBotRooms,
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

wss.on('connection', (socket: WebSocket) => {
  connCounter += 1;
  const half = options.lag / 2;
  const jitter = options.lag > 0 ? balance.network.lagJitterMs : 0;
  // 송신: 받는 쪽이 못 따라오면 오래된 스냅샷은 건너뛰고(거점 메모가 든 것은 보냄), 그래도 크게 쌓이면 끊는다 (sendPolicy.ts)
  const conn: Conn = { id: connCounter, ...createSender(socket, half, jitter, () => lagRng.next()) };
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
  socket.on('close', () => link.close());
  socket.on('error', () => socket.close());
});

// 고정 틱 루프: 틱 길이의 1/4마다 깨어 와야 했던 틱을 명목 시각으로 돌린다 (ServerCore.advance)
setInterval(() => core.advance(performance.now()), core.tickMs / 4);

httpServer.listen(options.port, options.host, () => {
  const lag = options.lag > 0 ? ` (지연 ${options.lag}ms)` : '';
  const hooks = options.testHooks ? ' [테스트 훅]' : '';
  console.log(`DECOY 서버 시작: http://localhost:${actualPort()}${lag}${hooks}`);
});

// 종료 신호: 컨테이너에서 PID 1로 돌면 Node가 SIGTERM · SIGINT를 기본 처리하지 않으므로 직접 끝낸다
// (docker stop이 10초를 기다렸다 강제 종료하거나, Ctrl+C로 멈추지 않는 문제)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`DECOY 서버 종료 (${signal})`);
    for (const client of wss.clients) client.terminate();
    httpServer.close();
    process.exit(0);
  });
}
