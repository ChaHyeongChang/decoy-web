// 출시 전 검토: 동시 봇 방 상한의 서버 배선(server/src/index.ts botRoomsPlaying · canFillBots)을 실제 서버 프로세스로 지킨다.
// --max-bot-rooms=1, 빠른 매칭 대기 1초: A가 봇과 판 중이면 B는 봇을 채우지 못하고 "사람만 기다리는 중",
// A의 판이 끝나면(결과 단계 방은 세지 않는다) 다음 틱에 B가 봇과 시작한다
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@decoy/shared';
import { WAITING_HUMANS_ONLY } from '@decoy/shared/sim';
import { startServer, type RunningServer } from '../helpers/serverProcess';

let server: RunningServer;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'decoy-bot-cap-'));
  const balance = JSON.parse(readFileSync('config/balance.json', 'utf8')) as {
    matchmaking: { quickMatchWait: number };
  };
  balance.matchmaking.quickMatchWait = 1;
  const path = join(dir, 'balance.json');
  writeFileSync(path, JSON.stringify(balance));
  server = await startServer([`--balance=${path}`, '--max-bot-rooms=1', '--test-hooks', '--seed=5']);
});
afterAll(async () => {
  await server.stop();
});

/** 빠른 매칭 사람 한 명: 받은 메시지를 모으고, 화면처럼 1초마다 ping한다 (대기열에서 빠지지 않게) */
interface Player {
  inbox: ServerMessage[];
  send(msg: ClientMessage): void;
  close(): void;
}

async function quickPlayer(name: string): Promise<Player> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const inbox: ServerMessage[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
  await new Promise((r) => ws.on('open', r));
  const send = (msg: ClientMessage): void => ws.send(JSON.stringify(msg));
  const pinger = setInterval(() => send({ t: 'ping', c: Date.now() }), 1000);
  send({ t: 'quick', name });
  return {
    inbox,
    send,
    close: () => {
      clearInterval(pinger);
      ws.close();
    },
  };
}

async function waitFor(what: string, ok: () => boolean, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`시간 초과: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const has = (p: Player, t: ServerMessage['t']): boolean => p.inbox.some((m) => m.t === t);

function lastLobby(p: Player): Extract<ServerMessage, { t: 'lobby' }>['lobby'] | undefined {
  return [...p.inbox].reverse().find((m): m is Extract<ServerMessage, { t: 'lobby' }> => m.t === 'lobby')
    ?.lobby;
}

const botStarts = (): number =>
  (server.output.join('').match(/판 시작 \(quick, 사람 1 · 봇 3\)/g) ?? []).length;

describe('동시 봇 방 상한 (실제 서버, --max-bot-rooms=1)', () => {
  it('봇 방이 하나 판 중이면 다음 사람은 "사람만 기다리는 중", 그 판이 끝나면 봇과 시작한다', async () => {
    const a = await quickPlayer('가나');
    let b: Player | null = null;
    try {
      await waitFor('A가 봇과 시작', () => has(a, 'match'), 5000);
      // 서버 로그는 표준 출력으로 따로 오므로 WebSocket 메시지보다 늦을 수 있다
      await waitFor('A 판 시작 로그', () => botStarts() === 1, 2000);
      const second = await quickPlayer('다라');
      b = second;
      // 대기 1초가 지나도 봇을 채우지 못한다
      await new Promise((r) => setTimeout(r, 2500));
      expect(has(second, 'match')).toBe(false);
      expect(lastLobby(second)).toMatchObject({
        kind: 'quick',
        phase: 'lobby',
        waitingFor: WAITING_HUMANS_ONLY,
        autoStartAt: null,
      });
      expect(lastLobby(second)?.players).toHaveLength(1);
      expect(botStarts()).toBe(1);
      // A의 판을 끝낸다 → 결과 단계 방은 세지 않으므로 B가 봇과 시작
      a.send({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } });
      await waitFor('A 결과', () => has(a, 'result'), 3000);
      await waitFor('B가 봇과 시작', () => has(second, 'match'), 3000);
      await waitFor('B 판 시작 로그', () => botStarts() === 2, 2000);
      expect(lastLobby(second)?.waitingFor).not.toBe(WAITING_HUMANS_ONLY);
    } finally {
      a.close();
      b?.close();
    }
  });
});
