// DECOY 서버 진입점: HTTP(정적 파일) + WebSocket + 30Hz 틱 루프
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { LagQueue, Rng, type ClientMessage } from '@decoy/shared';
import { HEALTH_PATH, MAX_STALL_MS, SERVER_MARK_HEADER, loadBalance, parseOptions } from './config';
import { RoomManager, type Conn, type Room, type Seat } from './room';
import { createSender } from './sendPolicy';
import { serveStatic } from './static';
import { TruthLog, truthOf } from './truth';
import { spawnLocalBot } from './bots';

const options = parseOptions(process.argv.slice(2), process.env);
const balance = loadBalance(options.balancePath);
const truthLog = options.truthLogPath ? new TruthLog(options.truthLogPath) : null;
const lagRng = new Rng(options.seed ^ 0x5bd1e995);

const manager = new RoomManager(
  { balance, seed: options.seed, testHooks: options.testHooks },
  {
    log: (m) => console.log(m),
    recordTruth: truthLog ? (room) => truthLog.record(room) : undefined,
    spawnBot: (room, seat) => spawnLocalBot(`ws://127.0.0.1:${actualPort()}/ws`, room.code, seat.token),
  },
);

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
  if (performance.now() >= unmarkUntil) res.setHeader(SERVER_MARK_HEADER, '1');
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
  let bound: { room: Room; seat: Seat } | null = null;
  let closed = false;

  const dispatch = (raw: string): void => {
    // 지연 큐 때문에 소켓이 닫힌 뒤에 도착한 메시지는 버린다 (유령 자리 방지)
    if (closed) return;
    try {
      handleMessage(raw);
    } catch (err) {
      // 메시지 하나의 오류가 서버 전체를 멈추지 않게: 그 연결만 닫는다
      console.error('메시지 처리 오류', err);
      socket.close();
    }
  };

  const handleMessage = (raw: string): void => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
    const now = performance.now();
    if (msg.t === 'join') {
      if (bound) return;
      const r = manager.join(conn, msg);
      if ('error' in r) {
        conn.send(r.error);
        return;
      }
      bound = r;
      r.room.welcome(r.seat);
      return;
    }
    if (msg.t === 'ping' && !bound) {
      conn.send({ t: 'pong', c: msg.c, s: now });
      return;
    }
    if (bound && bound.seat.conn?.id === conn.id) bound.room.handle(bound.seat, msg, now);
  };
  const inbound = new LagQueue<string>(half, jitter, dispatch, () => lagRng.next());

  socket.on('message', (data) => inbound.push(data.toString()));
  socket.on('close', () => {
    closed = true;
    if (bound && bound.seat.conn?.id === conn.id) bound.room.detach(bound.seat, performance.now());
  });
  socket.on('error', () => socket.close());
});

// 고정 틱 루프. 틱마다 명목 시각(시작 + n × 틱 길이)을 넘겨 스냅샷 시각 간격이 고르게 한다.
// 한 번에 최대 5틱까지 따라잡고, 그보다 밀리면 시간을 버린다
const tickMs = 1000 / balance.network.serverTickHz;
let nextTickAt = performance.now() + tickMs;
setInterval(() => {
  const now = performance.now();
  let n = 0;
  while (now >= nextTickAt && n < 5) {
    manager.tick(nextTickAt);
    nextTickAt += tickMs;
    n += 1;
  }
  if (now >= nextTickAt) nextTickAt = now + tickMs;
}, tickMs / 4);

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
