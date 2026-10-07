// M9 검증: 실제 서버 프로세스(--lag 100 · 200)에 WebSocket 봇 4명이 붙어 실시간으로 판을 끝까지 한다.
// 봇은 자기에게 온(걸러진) 스냅샷만 보고 움직인다. 생존자 승리 1판 + 괴물 승리 1판을 지연별로 동시에 돌린다
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { MatchResult, Role, ServerMessage, Snapshot } from '@decoy/shared';
import {
  GoAndHoldBrain,
  HunterBrain,
  PatrolMonsterBrain,
  PhasedBrain,
  SPOTS,
  type BotBrain,
} from '../../server/src/botBrains';
import { BotClient } from '../../server/src/bots';
import { startServer, type RunningServer } from '../helpers/serverProcess';

const ROLES: Role[] = ['monster', 'runner', 'guard', 'scout'];
const servers: RunningServer[] = [];

afterAll(async () => {
  for (const s of servers) await s.stop();
});

const pointDone =
  (id: 'A' | 'B') =>
  (s: Snapshot): boolean =>
    s.world.points.some((p) => p.id === id && p.state === 'done');
const exitOpen = (s: Snapshot): boolean => s.world.exits.some((e) => e.id === 'N' && e.state === 'open');

function escaper(offset: number): BotBrain {
  return new PhasedBrain([
    { brain: new GoAndHoldBrain({ x: SPOTS.pointA.x + offset, y: SPOTS.pointA.y }), until: pointDone('A') },
    { brain: new GoAndHoldBrain({ x: SPOTS.pointB.x + offset, y: SPOTS.pointB.y }), until: pointDone('B') },
    { brain: new GoAndHoldBrain({ x: 24 + offset, y: 2.3 }), until: exitOpen },
    { brain: new GoAndHoldBrain(SPOTS.exitNDoor, 0, 0.05) },
  ]);
}

const SCENARIOS: Record<'survivors' | 'monster', () => BotBrain[]> = {
  survivors: () => [
    new PatrolMonsterBrain([
      { x: 44, y: 29 },
      { x: 37, y: 29 },
      { x: 44, y: 25 },
    ]),
    escaper(-0.6),
    escaper(0.6),
    new PhasedBrain([
      { brain: new GoAndHoldBrain({ x: 30, y: 12 }), until: exitOpen },
      { brain: new GoAndHoldBrain(SPOTS.exitNDoor, 0, 0.05) },
    ]),
  ],
  monster: () => [
    new HunterBrain({ patrol: [{ x: 30, y: 22 }] }),
    new GoAndHoldBrain({ x: 38, y: 25 }),
    new GoAndHoldBrain({ x: 39, y: 26 }),
    new GoAndHoldBrain({ x: 37, y: 26 }),
  ],
};

function waitFor<T>(f: () => T | null, timeoutMs: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const v = f();
      if (v !== null) {
        clearInterval(timer);
        resolve(v);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`시간 초과: ${what}`));
      }
    }, 50);
  });
}

/** 봇 4명으로 방을 만들고 역할 · 준비 · 시작 → 결과까지 */
async function playMatch(port: number, scenario: keyof typeof SCENARIOS): Promise<{ result: MatchResult }> {
  const url = `ws://127.0.0.1:${port}/ws`;
  const brains = SCENARIOS[scenario]();
  let result: MatchResult | null = null;
  let room: string | null = null;
  const onMessage = (msg: ServerMessage): void => {
    if (msg.t === 'result') result = msg.result;
    if (msg.t === 'welcome' && room === null) room = msg.room;
  };
  const host = new BotClient({
    url,
    room: '',
    token: null,
    create: true,
    name: '봇1',
    brain: () => brains[0]!,
    onMessage,
  });
  const code = await waitFor(() => room, 10_000, '방 만들기');
  const bots = [host];
  for (let i = 1; i < 4; i += 1) {
    bots.push(
      new BotClient({ url, room: code, token: null, name: `봇${i + 1}`, brain: () => brains[i]!, onMessage }),
    );
  }
  await waitFor(() => (bots.every((b) => b.you !== null) ? true : null), 10_000, '입장');
  bots.forEach((b, i) => b.send({ t: 'role', role: ROLES[i]! }));
  await new Promise((r) => setTimeout(r, 500));
  for (const b of bots) b.send({ t: 'ready', ready: true });
  await new Promise((r) => setTimeout(r, 500));
  host.send({ t: 'start' });
  // 진행 기록 (실패 원인 파악용): 5초마다 거점 · 탈출구 · 생존자 상태
  mkdirSync('artifacts/lag', { recursive: true });
  const logPath = `artifacts/lag/${port}-${scenario}.log`;
  writeFileSync(logPath, '');
  const started = Date.now();
  const progress = setInterval(() => {
    const w = host.lastSnap?.world;
    const line = [
      `${Math.round((Date.now() - started) / 1000)}s`,
      `거점 ${JSON.stringify(w?.points.map((p) => [p.id, p.state, Math.round(p.progress * 100)]))}`,
      `탈출구 ${JSON.stringify(w?.exits.map((e) => [e.id, e.state]))}`,
      ...bots.slice(1).map((b) => {
        const m = b.lastSnap?.you;
        return `${m?.role}(${m?.move.x.toFixed(1)},${m?.move.y.toFixed(1)} ${m?.surv?.status} hp${m?.surv?.hp})`;
      }),
      `괴물(${host.lastSnap?.you.move.x.toFixed(1)},${host.lastSnap?.you.move.y.toFixed(1)})`,
    ].join(' ');
    appendFileSync(logPath, `${line}\n`);
  }, 5000);
  const res = await waitFor(() => result, 300_000, `${scenario} 판 끝 (기록: ${logPath})`).finally(() =>
    clearInterval(progress),
  );
  for (const b of bots) b.stop();
  return { result: res };
}

describe('지연 환경 봇 전체 판 (실시간, WebSocket)', () => {
  it('lag 100 · 200에서 생존자 승리 판과 괴물 승리 판이 모두 끝까지 진행된다', async () => {
    const lags = [100, 200];
    for (const lag of lags) servers.push(await startServer([`--lag=${lag}`, '--seed=7']));
    const runs = await Promise.all(
      servers.flatMap((s, i) =>
        (['survivors', 'monster'] as const).map(async (scenario) => ({
          lag: lags[i]!,
          scenario,
          ...(await playMatch(s.port, scenario)),
        })),
      ),
    );
    for (const r of runs) {
      appendFileSync(
        'artifacts/lag/summary.txt',
        `${new Date().toISOString()} lag ${r.lag} ${r.scenario}: 승자 ${r.result.winner}, 탈출 ${r.result.escaped}, ${r.result.durationSec}초, 결말 ${r.result.ending}\n`,
      );
      console.log(
        `lag ${r.lag} ${r.scenario}: 승자 ${r.result.winner}, 탈출 ${r.result.escaped}, ${r.result.durationSec}초, 결말 ${r.result.ending}`,
      );
      expect(r.result.winner).toBe(r.scenario);
      if (r.scenario === 'survivors') expect(r.result.escaped).toBeGreaterThanOrEqual(2);
      else expect(r.result.players.find((p) => p.role === 'monster')!.hitsLanded).toBeGreaterThanOrEqual(6);
    }
  });
});
