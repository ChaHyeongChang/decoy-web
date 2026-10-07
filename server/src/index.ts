// DECOY 서버 진입점: HTTP(정적 파일) + WebSocket + 30Hz 틱 루프
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { LagQueue, Rng, type ClientMessage, type ServerMessage } from '@decoy/shared';
import { loadBalance, parseOptions } from './config';
import { RoomManager, type Conn, type Room, type Seat } from './room';
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

const httpServer = createServer((req, res) => {
  // 요청 하나의 오류(잘못된 URL 등)가 서버 전체를 멈추지 않게
  try {
    handleHttp(req, res);
  } catch (err) {
    console.error('HTTP 처리 오류', err);
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
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
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });
/** 송신 버퍼 상한 (바이트) */
const MAX_BUFFERED = 1024 * 1024;
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
  // null = 닫기 표식. 앞서 보낸 메시지(예: 'replaced' 알림)를 모두 보낸 뒤 닫는다
  const outbound = new LagQueue<string | null>(
    half,
    jitter,
    (text) => {
      if (socket.readyState !== socket.OPEN) return;
      if (text === null) {
        socket.close();
        return;
      }
      // 받는 쪽이 못 따라오면(반쯤 끊긴 연결) 버퍼가 무한히 쌓이지 않게 끊는다
      if (socket.bufferedAmount > MAX_BUFFERED) {
        socket.terminate();
        return;
      }
      socket.send(text);
    },
    () => lagRng.next(),
  );
  const conn: Conn = {
    id: connCounter,
    send: (msg: ServerMessage) => outbound.push(JSON.stringify(msg)),
    close: () => outbound.push(null),
  };
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
