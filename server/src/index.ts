// DECOY 서버 진입점: HTTP(정적 파일) + WebSocket + 30Hz 틱 루프
import { createServer } from 'node:http';
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
  const url = new URL(req.url ?? '/', 'http://localhost');
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
  serveStatic(options.staticDir, req, res);
});

function actualPort(): number {
  const addr = httpServer.address();
  return typeof addr === 'object' && addr ? addr.port : options.port;
}

let connCounter = 0;
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (socket: WebSocket) => {
  connCounter += 1;
  const half = options.lag / 2;
  const jitter = options.lag > 0 ? balance.network.lagJitterMs : 0;
  const outbound = new LagQueue<string>(
    half,
    jitter,
    (text) => {
      if (socket.readyState === socket.OPEN) socket.send(text);
    },
    () => lagRng.next(),
  );
  const conn: Conn = {
    id: connCounter,
    send: (msg: ServerMessage) => outbound.push(JSON.stringify(msg)),
    close: () => socket.close(),
  };
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

// 고정 틱 루프 (누적 시간 방식, 한 번에 최대 5틱까지 따라잡는다)
const tickMs = 1000 / balance.network.serverTickHz;
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  let n = 0;
  while (acc >= tickMs && n < 5) {
    manager.tick(performance.now());
    acc -= tickMs;
    n += 1;
  }
  if (n === 5) acc = 0;
}, tickMs / 2);

httpServer.listen(options.port, options.host, () => {
  const lag = options.lag > 0 ? ` (지연 ${options.lag}ms)` : '';
  const hooks = options.testHooks ? ' [테스트 훅]' : '';
  console.log(`DECOY 서버 시작: http://localhost:${actualPort()}${lag}${hooks}`);
});
