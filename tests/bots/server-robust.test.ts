// 서버 견고성: 이상한 요청 · 메시지 하나로 프로세스가 죽지 않는다 (M1 검토 반영)
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@decoy/shared';
import { startServer, type RunningServer } from '../helpers/serverProcess';

let server: RunningServer;

beforeAll(async () => {
  server = await startServer(['--test-hooks']);
});
afterAll(async () => {
  await server.stop();
});

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

async function healthy(): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
  return res.ok;
}

describe('서버 견고성', () => {
  it('잘못된 퍼센트 인코딩 · absolute-form URL 요청에도 살아 있다', async () => {
    await raw(server.port, 'GET /%E0%A4%A HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    await raw(server.port, 'GET /% HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    await raw(server.port, 'GET http://[x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    expect(server.proc.exitCode).toBeNull();
    expect(await healthy()).toBe(true);
  });

  it('경로 탈출 요청은 막힌다', async () => {
    const out = await raw(
      server.port,
      'GET /../../config/balance.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    );
    expect(out).not.toContain('"survivor"');
  });

  it('깨진 WebSocket 메시지 · null 프레임 · cmd 없는 test에도 살아 있다', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const inbox: ServerMessage[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise((r) => ws.on('open', r));
    ws.send('{not json');
    ws.send(
      JSON.stringify({
        t: 'join',
        room: null,
        create: true,
        name: 'x',
        token: null,
        altTokens: [],
        bots: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    ws.send(JSON.stringify({ t: 'role', role: 'monster' }));
    ws.send(JSON.stringify({ t: 'ready', ready: true }));
    ws.send(JSON.stringify({ t: 'start' }));
    await new Promise((r) => setTimeout(r, 500));
    ws.send(JSON.stringify({ t: 'input', frames: [null, 3, { seq: 'x' }] }));
    ws.send(JSON.stringify({ t: 'test' }));
    ws.send(JSON.stringify({ t: 'role', role: 'zebra' }));
    await new Promise((r) => setTimeout(r, 300));
    expect(server.proc.exitCode).toBeNull();
    expect(inbox.some((m) => m.t === 'snap')).toBe(true);
    ws.close();
    expect(await healthy()).toBe(true);
  });
});
