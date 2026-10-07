// DECOY 서버 진입점: HTTP(정적 파일) + WebSocket
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { loadBalance, parseOptions } from './config';
import { serveStatic } from './static';

const options = parseOptions(process.argv.slice(2), process.env);
const balance = loadBalance(options.balancePath);

const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  serveStatic(options.staticDir, req, res);
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ t: 'hello', tickHz: balance.network.serverTickHz }));
});

httpServer.listen(options.port, options.host, () => {
  console.log(`DECOY 서버 시작: http://localhost:${options.port}`);
});
