// 빠른 매칭 봇 방 비용 재기 (M13c, DECISIONS "동시 봇 방 상한"): 서버와 같은 ServerCore · BotDriver · 실전 봇으로
// 봇 방 N개(사람 1 + 실전 봇 3, 사람은 가만히)를 판 시간 S초만큼 최대 속도로 돌려, 방 하나가 판 1초에 쓰는 CPU 시간(ms)을 잰다.
// 사람 자리는 가짜 연결: 받은 메시지를 서버처럼 JSON으로 직렬화하고 버린다(스냅샷 만들기 · 직렬화 비용 포함), 1초마다 ping.
//   npx tsx scripts/measure-bot-rooms.ts [방 수=6] [판 초=180]
import { readFileSync } from 'node:fs';
import { cpuUsage } from 'node:process';
import { validateBalance, type ClientMessage, type ServerMessage } from '@decoy/shared';
import { BotDriver, ServerCore, practiceBrain, type Conn, type CoreLink } from '@decoy/shared/sim';

const ROOMS = Number(process.argv[2] ?? 6);
const SECONDS = Number(process.argv[3] ?? 180);
const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
const clock = { t: 1000 };
const driver = new BotDriver(
  (info, _seat, room) => practiceBrain(info.role, room.code.length * 7 + room.matchCount),
  balance,
);
// devBots: 아래에서 봇 채우기 방(join.bots)으로 방을 만든다 — 배포 서버는 이것을 꺼 두므로 측정에서는 분명히 켠다
const core = new ServerCore(
  { balance, seed: 7, testHooks: false, devBots: true },
  { spawnBot: (room, seat) => driver.attach(room, seat), beforeStep: (room) => driver.beforeStep(room) },
  () => clock.t,
);

let bytes = 0;
let messages = 0;
let nextId = 1;
function human(): CoreLink {
  const conn: Conn = {
    id: nextId++,
    send: (msg: ServerMessage) => {
      bytes += JSON.stringify(msg).length;
      messages += 1;
    },
    close: () => undefined,
  };
  return core.connect(conn, (err) => {
    throw err;
  });
}
const raw = (m: ClientMessage): string => JSON.stringify(m);

// 방 N개를 한꺼번에 시작한다: 사람 한 명이 봇 채우기 방을 만들고(역할 러너) 바로 시작 → 빈 세 자리는 실전 봇.
// 빠른 매칭 방도 시작한 뒤에는 같은 판 · 같은 봇이라 비용이 같다(빠른 매칭 대기 20초를 방마다 기다리지 않으려고)
const links: CoreLink[] = [];
for (let i = 0; i < ROOMS; i += 1) {
  const l = human();
  l.receive(
    raw({ t: 'join', room: null, create: true, name: `p${i}`, token: null, altTokens: [], bots: true }),
  );
  l.receive(raw({ t: 'role', role: 'runner' }));
  l.receive(raw({ t: 'ready', ready: true }));
  l.receive(raw({ t: 'start' }));
  links.push(l);
}
/** 판이 끝난 방은 다시 하기 → 같은 역할로 준비 · 시작 (재는 동안 방 N개가 늘 판 중이게) */
function restartEnded(): void {
  for (const l of links) {
    l.receive(raw({ t: 'rematch' }));
    l.receive(raw({ t: 'role', role: 'runner' }));
    l.receive(raw({ t: 'ready', ready: true }));
    l.receive(raw({ t: 'start' }));
  }
}
/** 판 시간 ms만큼 흘린다 (1초마다 ping과 끝난 방 다시 시작). 판 중인 방 × 틱을 돌려준다 */
function run(ms: number): { ticks: number; roomTicks: number } {
  const until = clock.t + ms;
  let nextSecond = clock.t;
  let ticks = 0;
  let roomTicks = 0;
  while (clock.t < until) {
    clock.t += core.tickMs;
    if (clock.t >= nextSecond) {
      for (const x of links) x.receive(raw({ t: 'ping', c: clock.t }));
      restartEnded();
      nextSecond += 1000;
    }
    let live = 0;
    for (const r of core.manager.rooms.values()) if (r.phase === 'playing') live += 1;
    const n = core.advance(clock.t);
    ticks += n;
    roomTicks += live * n;
  }
  return { ticks, roomTicks };
}
// 데우기: JIT · 메모리가 자리 잡게 판 시간 30초
run(30_000);
const playing = [...core.manager.rooms.values()].filter((r) => r.phase === 'playing');
if (playing.length !== ROOMS) throw new Error(`판 중인 방 ${playing.length}개 (기대 ${ROOMS})`);

bytes = 0;
messages = 0;
const startCpu = cpuUsage();
const startWall = performance.now();
const { ticks, roomTicks } = run(SECONDS * 1000);
const cpu = cpuUsage(startCpu);
const wallMs = performance.now() - startWall;
const cpuMs = (cpu.user + cpu.system) / 1000;
const stillPlaying = [...core.manager.rooms.values()].filter((r) => r.phase === 'playing').length;
const roomSeconds = (roomTicks * core.tickMs) / 1000;
const perRoomSecond = cpuMs / roomSeconds;
console.log(
  JSON.stringify(
    {
      rooms: ROOMS,
      gameSeconds: SECONDS,
      ticks,
      stillPlayingAtEnd: stillPlaying,
      roomSeconds: Math.round(roomSeconds),
      cpuMs: Math.round(cpuMs),
      wallMs: Math.round(wallMs),
      /** 방 하나가 판 1초에 쓰는 CPU (ms). Render 무료 0.1 CPU = 초당 100ms */
      cpuMsPerRoomSecond: Number(perRoomSecond.toFixed(3)),
      messagesPerRoomSecond: Math.round(messages / roomSeconds),
      kbPerRoomSecond: Number((bytes / 1024 / roomSeconds).toFixed(1)),
    },
    null,
    2,
  ),
);
