// M3: 정보 차단. 각 클라이언트가 받은 모든 스냅샷 원문을 서버 정답 기록과 대조한다.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { expect, test, type Browser } from '@playwright/test';
import { validateBalance, type Balance, type Role, type Snapshot } from '@decoy/shared';
import { anyVisible, circleVerdict, monsterVerdict, type Verdict } from './infoCheck';
import { collectFrames, type CollectedFrames } from './frames';
import {
  closeAll,
  createRoom,
  joinRoom,
  myId,
  pickRoleAndReady,
  sendTest,
  startFourPlayerMatch,
  waitForSnapshots,
  watchConsole,
  type Player,
} from './helpers';

const balance: Balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

interface TruthPlayer {
  id: string;
  role: string;
  x: number;
  y: number;
  face: number;
  status: string;
}
interface TruthFrame {
  room: string;
  tick: number;
  players: TruthPlayer[];
  monster: { aim: number; blend: number; mode: string; windup: number } | null;
  reveal: { id: string; left: number }[];
  tracked: number;
  roarReveal: number;
}

function loadTruth(room: string): Map<number, TruthFrame> {
  const map = new Map<number, TruthFrame>();
  const text = readFileSync('tests/e2e/.results/truth.jsonl', 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes(`"room":"${room}"`)) continue;
    const f = JSON.parse(line) as TruthFrame;
    map.set(f.tick, f);
  }
  return map;
}

function monsterVerdictFor(f: TruthFrame, s: TruthPlayer): Verdict {
  const m = f.players.find((p) => p.role === 'monster')!;
  return monsterVerdict(balance, m.x, m.y, f.monster!.aim, f.monster!.blend, s.x, s.y);
}

function survivorsSeeMonster(f: TruthFrame): Verdict {
  const m = f.players.find((p) => p.role === 'monster')!;
  const v: Verdict[] = [];
  for (const s of f.players) {
    if (s.role === 'monster' || s.status === 'dead' || s.status === 'escaped') continue;
    const r = s.role === 'scout' ? balance.roles.scout.visionRadius : balance.survivor.visionRadius;
    v.push(circleVerdict(s.x, s.y, r, m.x, m.y));
  }
  return anyVisible(v);
}

async function scenario(players: Player[]): Promise<void> {
  const monster = players.find((p) => p.role === 'monster')!;
  const page = monster.page;
  // 괴물을 감옥 남쪽으로 옮겨 감옥 쪽을 보게 한다. 생존자는 흩어진다
  await sendTest(page, { kind: 'teleport', target: monster.id, x: 24, y: 23, face: -Math.PI / 2 });
  await page.waitForTimeout(300);
  const runner = players.find((p) => p.role === 'runner')!;
  const guard = players.find((p) => p.role === 'guard')!;
  const scout = players.find((p) => p.role === 'scout')!;
  await sendTest(page, { kind: 'teleport', target: runner.id, x: 8, y: 16 });
  await sendTest(page, { kind: 'teleport', target: guard.id, x: 24, y: 19.5 });
  await sendTest(page, { kind: 'teleport', target: scout.id, x: 36, y: 16 });
  // 괴물은 조준을 돌리며 시야 모드를 바꾼다, 생존자는 움직인다
  const aims = [
    { x: 24, y: 10 },
    { x: 34, y: 18 },
    { x: 14, y: 22 },
    { x: 24, y: 28 },
  ];
  await runner.page.keyboard.down('KeyD');
  await scout.page.keyboard.down('KeyA');
  // 능력 노출 · 탐지 · 포효 예외 구간도 함께 검사한다
  await scout.page.keyboard.press('Space');
  await runner.page.keyboard.press('Space');
  for (let i = 0; i < aims.length; i += 1) {
    const a = aims[i]!;
    const c = await page.evaluate((t) => window.__DECOY__?.tileToClient(t.x, t.y) ?? null, a);
    await page.mouse.move(c!.x, c!.y, { steps: 8 });
    if (i === 1) {
      await page.mouse.down({ button: 'right' });
      await page.mouse.up({ button: 'right' });
    }
    if (i === 2) await page.keyboard.press('KeyQ');
    await guard.page.keyboard.down(i % 2 === 0 ? 'KeyA' : 'KeyD');
    await page.waitForTimeout(900);
    await guard.page.keyboard.up(i % 2 === 0 ? 'KeyA' : 'KeyD');
  }
  await runner.page.keyboard.up('KeyD');
  await scout.page.keyboard.up('KeyA');
  await page.waitForTimeout(300);
}

test(
  '괴물 · 생존자가 받은 스냅샷 전체에 시야 밖 상대 좌표가 한 번도 없다',
  { tag: '@core' },
  async ({ browser }) => {
    const { code, players } = await startFourPlayerMatch(browser);
    const frames = new Map<string, CollectedFrames>();
    // 이미 열린 소켓은 잡을 수 없으므로 새로고침해서 같은 자리로 다시 들어온다
    for (const p of players) {
      frames.set(p.id, collectFrames(p.page));
      await p.page.reload();
      await p.page.waitForFunction(() => (window.__DECOY__?.snapCount ?? 0) > 3);
    }
    await scenario(players);
    const truth = loadTruth(code);
    const survivorIds = players.filter((p) => p.role !== 'monster').map((p) => p.id);

    // ── 괴물이 받은 것 ──
    const monster = players.find((p) => p.role === 'monster')!;
    const mFrames = frames.get(monster.id)!;
    let hiddenFrames = 0;
    let visibleFrames = 0;
    let checked = 0;
    for (const { raw, snap } of mFrames.snaps) {
      const f = truth.get(snap.tick);
      if (!f || !f.monster) continue;
      checked += 1;
      const verdicts = new Map<string, Verdict>();
      for (const s of f.players) {
        if (s.role === 'monster' || s.status === 'dead' || s.status === 'escaped') continue;
        verdicts.set(s.id, monsterVerdictFor(f, s));
      }
      if ([...verdicts.values()].includes('hidden')) hiddenFrames += 1;
      if ([...verdicts.values()].includes('visible')) visibleFrames += 1;
      // 받은 생존자는 모두 실제로 보이는(또는 경계의) 생존자와 위치가 맞아야 한다
      for (const e of snap.survivors) {
        const match = f.players.find((p) => p.role !== 'monster' && Math.hypot(p.x - e.x, p.y - e.y) < 0.01);
        expect(match, `틱 ${snap.tick}: 정답에 없는 위치`).toBeTruthy();
        expect(
          verdicts.get(match!.id),
          `틱 ${snap.tick}: 시야 밖 생존자 ${match!.id} 좌표가 괴물에게 갔다`,
        ).not.toBe('hidden');
        // 역할 · 실제 ID 노출 금지 (능력 노출 창 제외)
        const revealed = (f.reveal.find((r) => r.id === match!.id)?.left ?? 0) > 0;
        if (!revealed) expect(e.role).toBeNull();
        expect(survivorIds).not.toContain(e.id);
      }
      // 보이는 생존자는 빠짐없이 받는다
      const visibleCount = [...verdicts.values()].filter((v) => v === 'visible').length;
      expect(snap.survivors.length).toBeGreaterThanOrEqual(visibleCount);
      // 원문에도 생존자 실제 ID가 없다
      for (const id of survivorIds) expect(raw.includes(`"${id}"`), `원문에 ${id}`).toBe(false);
      expect(snap.monster).toBeNull();
      expect(snap.world.exits.every((x) => x.progress === null)).toBe(true);
    }
    expect(checked).toBeGreaterThan(60);
    // 빈 통과 방지: 숨은 생존자가 있는 프레임과 보이는 생존자가 있는 프레임이 충분히 있었다
    expect(hiddenFrames / checked).toBeGreaterThan(0.3);
    expect(visibleFrames / checked).toBeGreaterThan(0.1);

    // ── 생존자가 받은 것 ──
    let monsterHidden = 0;
    let monsterSeen = 0;
    for (const p of players.filter((q) => q.role !== 'monster')) {
      for (const { snap } of frames.get(p.id)!.snaps) {
        const f = truth.get(snap.tick);
        if (!f) continue;
        const v = survivorsSeeMonster(f);
        if (v === 'hidden') {
          monsterHidden += 1;
          expect(snap.monster, `틱 ${snap.tick}: 시야 밖 괴물 좌표가 ${p.role}에게 갔다`).toBeNull();
          // 마커는 탐지 · 포효 노출 창에서만 허용
          if (f.tracked <= 0 && f.roarReveal <= 0) expect(snap.marks.length).toBe(0);
        }
        if (v === 'visible') {
          monsterSeen += 1;
          expect(snap.monster).not.toBeNull();
        }
        // 팀원은 항상 보인다
        expect(snap.survivors.length).toBe(2);
      }
    }
    expect(monsterHidden).toBeGreaterThan(20);
    expect(monsterSeen).toBeGreaterThan(20);
    for (const p of players) expect(p.problems).toEqual([]);
    await closeAll(players);
  },
);

async function measureFps(players: Player[]): Promise<number[]> {
  await players[0]!.page.waitForTimeout(3000);
  const samples: number[][] = players.map(() => []);
  for (let i = 0; i < 10; i += 1) {
    await players[0]!.page.waitForTimeout(1000);
    for (let k = 0; k < players.length; k += 1) {
      samples[k]!.push(await players[k]!.page.evaluate(() => window.__DECOY__?.fps ?? 0));
    }
  }
  return samples.map((s) => s.reduce((a, b) => a + b, 0) / s.length);
}

interface FpsCase {
  name: string;
  viewport: { width: number; height: number };
  query: string;
  backing: [number, number];
  /** 평균 FPS 하한 */
  min: number;
}

/**
 * FPS 측정 조건 (Canvas 렌더러, 소프트웨어 합성, 4탭 + 서버).
 *  - 게이트(55, 코어 2개 이하 50): 옛 scale=0.5와 화소 단위로 같은 조건. 960×540 창 · 배율 1 · 품질 낮음 → 백버퍼 960×540을
 *    CSS 960×540에 1:1로 합성하고 카메라 zoom 0.5 (M10a 전 기준값 60.4와 견줄 수 있다). 소프트웨어 합성기(VizCompositorThread)는
 *    탭 4개 몫을 한 스레드에서 하므로 창을 키워 늘려 보여 주면 백버퍼가 같아도 느려진다(2코어 실측 53~55) → 창 크기를 고정한다.
 *    GitHub Actions 러너(private 저장소 = 2코어)는 호스트마다 52.2 ~ 58.9로 흔들려(M11 전체 검사: 같은 코드가 이 컨테이너
 *    4코어에서 60.0, CPU를 2 · 4배 느리게 한 main 대 M11 비교에서도 차이 없음) 2코어 이하에서는 하한을 50으로 둔다
 *    (그래도 1할 넘는 회귀는 잡는다. DECISIONS M11 행)
 *  - 기록(하한 12): 1920×1080 창 · 배율 1 · scale=1 → 백버퍼 1920×1080 1:1. 옛 scale=1(1920×1080을 960×540으로 줄여 표시)은
 *    새 코드로 재현할 수 없어 옛 값(41.9)과 비교하지 않는다. 큰 회귀(GPU 프로세스 병목 때의 1~10FPS 같은)만 잡는다.
 *    GitHub Actions 러너는 호스트마다 19~28로 흔들려(하한 20일 때 19.0으로 실패) 하한을 낮췄다. 성능 관문은 위의 게이트다
 */
const FPS_CASES: readonly FpsCase[] = [
  {
    name: '게이트: 품질 낮음 · 백버퍼 960×540 (창 960×540 배율 1)',
    viewport: { width: 960, height: 540 },
    query: '&quality=low',
    backing: [960, 540],
    min: availableParallelism() <= 2 ? 50 : 55,
  },
  {
    name: '기록: 1920×1080 배율 1 · scale=1 (옛 값과 비교하지 않음)',
    viewport: { width: 1920, height: 1080 },
    query: '&scale=1',
    backing: [1920, 1080],
    min: 12,
  },
];

async function startFpsMatch(browser: Browser, c: FpsCase): Promise<Player[]> {
  const roles: Role[] = ['monster', 'runner', 'guard', 'scout'];
  const players: Player[] = [];
  let code = '';
  for (const role of roles) {
    const context = await browser.newContext({ viewport: c.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const problems: string[] = [];
    watchConsole(page, problems);
    if (players.length === 0) code = await createRoom(page, c.query);
    else await joinRoom(page, code, c.query);
    players.push({ context, page, problems, role, id: await myId(page) });
  }
  for (const p of players) await pickRoleAndReady(p.page, p.role);
  const host = players[0]!;
  await expect(host.page.getByTestId('start-button')).toBeEnabled();
  await host.page.getByTestId('start-button').click();
  for (const p of players) await waitForSnapshots(p.page, 3);
  return players;
}

for (const c of FPS_CASES) {
  test(`브라우저 4개 동시 실행 FPS (Canvas 렌더러, 헤드리스) ${c.name}`, async ({ browser }) => {
    const players = await startFpsMatch(browser, c);
    for (const p of players) {
      const backing = await p.page.evaluate(() => {
        const g = window.__DECOY__?.gfx;
        return g ? [g.backingW, g.backingH] : null;
      });
      expect(backing, `${p.role} 백버퍼`).toEqual(c.backing);
    }
    // 괴물을 생존자 근처로 옮겨 서로 보이는 상태(가장 많이 그리는 상태)에서 잰다
    const monster = players.find((p) => p.role === 'monster')!;
    await sendTest(monster.page, { kind: 'teleport', target: monster.id, x: 24, y: 21, face: -Math.PI / 2 });
    const avgs = await measureFps(players);
    const avg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    console.log(
      `FPS ${c.name} 탭별 평균: ${avgs.map((v) => v.toFixed(1)).join(', ')} / 전체 ${avg.toFixed(1)}`,
    );
    test.info().annotations.push({ type: `fps ${c.name}`, description: avg.toFixed(1) });
    // (CPU 래스터 4탭 + 서버가 4코어를 나눠 쓴다: 기록 조건은 개발 컨테이너 약 40, GitHub Actions 러너 19~28)
    expect(avg).toBeGreaterThanOrEqual(c.min);
    // 재는 동안 조건이 바뀌지 않았다 (두 조건 모두 품질 낮음이라 더 내릴 단계가 없다. 조건을 바꾸면 여기서 드러난다)
    for (const p of players) {
      expect(await p.page.evaluate(() => window.__DECOY__?.gfx.downgrades ?? -1), `${p.role} 하향`).toBe(0);
    }
    for (const p of players) expect(p.problems).toEqual([]);
    await closeAll(players);
  });
}

void (null as unknown as Snapshot);
