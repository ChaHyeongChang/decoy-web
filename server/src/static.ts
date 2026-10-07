// 빌드된 클라이언트(client/dist)를 서빙한다
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export function serveStatic(root: string, url: URL, res: ServerResponse): void {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(normalize(root + sep)) && filePath !== normalize(root)) {
    res.writeHead(403).end();
    return;
  }
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(root, 'index.html');
  if (!existsSync(target)) {
    res
      .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      .end('클라이언트 빌드가 없습니다. npm run build를 먼저 실행하세요.');
    return;
  }
  const type = MIME[extname(target)] ?? 'application/octet-stream';
  const cache = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  const stream = createReadStream(target);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.destroy();
  });
  stream.pipe(res);
}
