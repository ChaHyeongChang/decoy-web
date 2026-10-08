// 잠든 서버 깨우기 지원: 이 서버가 보낸 응답 표시(x-decoy-server)와, 깨어나는 동안을 흉내 내는 테스트 훅 /test/stall
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { HEALTH_PATH, SERVER_MARK_HEADER } from '../../server/src/config';
import { startServer, type RunningServer } from '../helpers/serverProcess';

let server: RunningServer;

beforeAll(async () => {
  server = await startServer(['--test-hooks']);
});
afterAll(async () => {
  await server.stop();
});

function base(): string {
  return `http://127.0.0.1:${server.port}`;
}

function raw(port: number, request: string): Promise<string> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1', () => sock.write(request));
    let out = '';
    sock.on('data', (d) => (out += d.toString()));
    sock.on('close', () => resolve(out));
    sock.on('error', () => resolve(out));
    setTimeout(() => sock.destroy(), 1500);
  });
}

/** WebSocket이 열리기까지 걸린 시간 (ms) */
function wsOpenMs(): Promise<{ ms: number; ws: WebSocket }> {
  const t0 = performance.now();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ms: performance.now() - t0, ws }));
    ws.on('error', reject);
  });
}

async function stall(query: string): Promise<void> {
  const res = await fetch(`${base()}/test/stall?${query}`);
  expect(res.status).toBe(200);
}

describe('이 서버가 보낸 응답 표시', () => {
  it('헬스 체크는 표시와 함께 ok, 캐시하지 않는다', async () => {
    const res = await fetch(`${base()}${HEALTH_PATH}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get(SERVER_MARK_HEADER)).toBe('1');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('첫 화면과 오류 응답에도 표시가 붙는다 (표시가 없으면 호스팅 서비스가 답한 것)', async () => {
    const index = await fetch(`${base()}/`);
    expect(index.headers.get(SERVER_MARK_HEADER)).toBe('1');
    const bad = await raw(server.port, 'GET /% HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    expect(bad).toMatch(/^HTTP\/1\.1 400/);
    expect(bad.toLowerCase()).toContain(`${SERVER_MARK_HEADER}: 1`);
  });
});

describe('테스트 훅 /test/stall (깨어나는 동안 흉내)', () => {
  it('정한 시간 동안 HTTP 요청과 새 WebSocket 연결을 붙잡는다', async () => {
    await stall('ms=1200');
    const t0 = performance.now();
    const res = await fetch(`${base()}${HEALTH_PATH}`);
    expect(res.ok).toBe(true);
    expect(performance.now() - t0).toBeGreaterThan(900);
    // 붙잡는 시간이 지나면 바로 답한다
    const t1 = performance.now();
    await fetch(`${base()}${HEALTH_PATH}`);
    expect(performance.now() - t1).toBeLessThan(500);
    await stall('ms=1200');
    const { ms, ws } = await wsOpenMs();
    expect(ms).toBeGreaterThan(900);
    ws.close();
  });

  it('http=0이면 HTTP는 그대로 두고 WebSocket만 붙잡는다', async () => {
    await stall('ms=1200&http=0');
    const t0 = performance.now();
    await fetch(`${base()}${HEALTH_PATH}`);
    expect(performance.now() - t0).toBeLessThan(500);
    const { ms, ws } = await wsOpenMs();
    expect(ms).toBeGreaterThan(900);
    ws.close();
  });

  it('drop=1이면 지금 열린 WebSocket을 끊는다 (잠들 때처럼)', async () => {
    const { ws } = await wsOpenMs();
    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));
    await stall('ms=0&drop=1');
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('/ws가 아닌 경로의 WebSocket 업그레이드는 받지 않는다', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/other`);
    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('error'));
    });
    expect(result).toBe('error');
  });

  it('붙잡는 시간은 최대 60초로 자른다', async () => {
    const res = await fetch(`${base()}/test/stall?ms=999999`);
    expect(((await res.json()) as { stallMs: number }).stallMs).toBe(60_000);
    await stall('ms=0');
  });
});

describe('테스트 훅이 꺼진 서버 (프로덕션)', () => {
  it('/test/stall이 없다', async () => {
    const prod = await startServer();
    try {
      const res = await fetch(`http://127.0.0.1:${prod.port}/test/stall?ms=5000`);
      expect(res.status).toBe(404);
      const t0 = performance.now();
      await fetch(`http://127.0.0.1:${prod.port}${HEALTH_PATH}`);
      expect(performance.now() - t0).toBeLessThan(500);
    } finally {
      await prod.stop();
    }
  });
});
