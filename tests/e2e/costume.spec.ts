// 의상 (메타 c, GAME_DESIGN 12.5 · docs/META_PLAN.md 1절): 정보 숨김 · 옷장 해금 · 입기 · 의상 그림 조각을 못 받아도 판은 그대로.
//  - 괴물이 받은 모든 메시지에 생존자 의상 id가 없고(판 시작 명단은 자기 하나), 판 시작 명단 밖에는 의상 칸 자체가 없다
//  - 괴물 화면: 서로 다른 의상의 생존자 셋을 같은 자리 · 같은 방향에 차례로 세운 화면 조각이 같다(흰색 위장, 의상 단서 없음)
//  - 생존자 화면: 동료 셋 · 괴물 의상을 그 판에 굽는다(그 판 의상만, 같은 칸)
//  - 옷장: 해금(두 번 눌러 확인) · 입기 · 다시 열어도 그대로 · 불씨 모자람 · 판에 입고 들어간다
//  - 의상 그림 조각을 받지 못해도 해금 · 입기 · 판은 그대로(기본 그림), 오류 없음
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PRISON_CENTER, type Role, type ServerMessage } from '@decoy/shared';
import { collectFrames, type CollectedFrames } from './frames';
import {
  BASE_QUERY,
  aimMonsterAt,
  closeAll,
  createRoom,
  joinRoom,
  lastSnapshot,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  waitForSnapshots,
  type Player,
} from './helpers';

const KEY = 'decoy:progress';
interface Wear {
  survivor: string;
  monster: string;
}

/** 이 기기 기록에 의상을 가진 채 입혀 둔다 (첫 접속에만 — 시험 중 바꾼 기록은 덮어쓰지 않는다) */
async function dress(context: BrowserContext, wear: Wear, coins = 0, owned: string[] = []): Promise<void> {
  const all = [...new Set([...owned, wear.survivor, wear.monster].filter((c) => c !== 'basic'))];
  const text = JSON.stringify({ v: 1, coins, owned: all, wear });
  await context.addInitScript(
    ([k, v]) => {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    },
    [KEY, text] as const,
  );
}

function matchOf(f: CollectedFrames): Extract<ServerMessage, { t: 'match' }> {
  for (const t of f.raw) {
    const m = JSON.parse(t) as ServerMessage;
    if (m.t === 'match') return m;
  }
  throw new Error('판 시작 메시지 없음');
}

async function atlasDress(page: Page): Promise<string> {
  return page.evaluate(() => String(window.__DECOY__?.gfx.features.atlasCostumes ?? ''));
}

/** 화면 조각 셋을 페이지 안에서 디코드해 첫 조각과의 픽셀 차 (채널 최대 · 평균) */
async function cropDiffs(page: Page, crops: Buffer[]): Promise<{ max: number; mean: number }[]> {
  return page.evaluate(
    async (b64s) => {
      const read = async (b64: string): Promise<Uint8ClampedArray> => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('2D 컨텍스트 없음');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const all = await Promise.all(b64s.map(read));
      const base = all[0]!;
      return all.map((d) => {
        let max = 0;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4)
          for (let k = 0; k < 3; k += 1) {
            const v = Math.abs((d[i + k] ?? 0) - (base[i + k] ?? 0));
            max = Math.max(max, v);
            sum += v;
            n += 1;
          }
        return { max, mean: sum / n };
      });
    },
    crops.map((b) => b.toString('base64')),
  );
}

test(
  '정보 숨김 (의상): 괴물이 받은 메시지에 생존자 의상이 없고, 서로 다른 의상의 생존자 셋이 괴물 화면에서 같은 그림 · 생존자 화면은 그 판 의상을 굽는다',
  { tag: '@core' },
  async ({ browser }) => {
    test.setTimeout(240_000);
    // 괴물 자리도 생존자 의상(망토)을 골라 두었다 — 괴물 역할이면 어디에도 오지 않아야 한다
    const plan: [Role, Wear][] = [
      ['monster', { survivor: 'cape', monster: 'chains' }],
      ['runner', { survivor: 'scarf', monster: 'hood' }],
      ['guard', { survivor: 'pack', monster: 'basic' }],
      ['scout', { survivor: 'cape', monster: 'feathers' }],
    ];
    const q = '&quality=low';
    const players: Player[] = [];
    const frames: CollectedFrames[] = [];
    let code = '';
    for (const [i, [role, wear]] of plan.entries()) {
      const p = await newPlayerPage(browser);
      await dress(p.context, wear);
      frames.push(collectFrames(p.page));
      if (i === 0) code = await createRoom(p.page, q);
      else await joinRoom(p.page, code, q);
      players.push({ ...p, role, id: await myId(p.page) });
    }
    for (const p of players) await pickRoleAndReady(p.page, p.role);
    await press(players[0]!.page.getByTestId('start-button'));
    for (const p of players) await waitForSnapshots(p.page, 10);

    // 1) 메시지: 괴물 명단은 자기 하나(사슬), 받은 모든 메시지에 생존자 의상 id 없음, 명단 밖에는 의상 칸 없음
    const monsterRaw = frames[0]!.raw;
    expect(matchOf(frames[0]!).info.roster).toEqual([
      expect.objectContaining({ role: 'monster', costume: 'chains' }),
    ]);
    for (const t of monsterRaw) expect(t).not.toMatch(/"(scarf|pack|cape)"/);
    for (const t of monsterRaw.filter((x) => !x.includes('"t":"match"')))
      expect(t).not.toMatch(/"costume"\s*:/);
    for (const i of [1, 2, 3]) {
      const by = Object.fromEntries(
        matchOf(frames[i]!).info.roster.map((e) => [e.role, e.costume ?? 'basic']),
      );
      expect(by, plan[i]![0]).toEqual({ monster: 'chains', runner: 'scarf', guard: 'pack', scout: 'cape' });
      for (const t of frames[i]!.raw.filter((x) => !x.includes('"t":"match"')))
        expect(t).not.toMatch(/"costume"\s*:/);
    }

    // 2) 굽기: 생존자는 동료 셋 · 괴물 의상, 괴물은 자기 의상만(생존자 칸 기본)
    const host = players[0]!.page;
    await expect
      .poll(() => atlasDress(host), { timeout: 15_000 })
      .toBe('runner:basic,guard:basic,scout:basic,monster:chains');
    for (const p of players.slice(1))
      await expect
        .poll(() => atlasDress(p.page), { timeout: 15_000 })
        .toBe('runner:scarf,guard:pack,scout:cape,monster:chains');

    // 같은 칸 바꿔 굽기 비용 (기록용, docs/PERF.md 9.4): 판 시작 명단으로 그 판 의상 칸만 프레임마다 나눠 다시 그린 시간
    // (합 · 가장 긴 한 프레임 · 프레임 수) · 텍스처 크기(의상이 있어도 그대로)
    for (const p of players) {
      const f = await p.page.evaluate(() => {
        const g = window.__DECOY__!.gfx.features;
        return [
          g.atlasRecostumeMs,
          g.atlasRecostumeMaxStepMs,
          g.atlasRecostumeSteps,
          g.atlasBakeMs,
          g.atlasBytes,
        ];
      });
      console.log(
        `[costume] ${p.role}: 의상 칸 다시 굽기 합 ${String(f[0])}ms · 한 프레임 최대 ${String(f[1])}ms · ${String(f[2])}프레임 · 처음 굽기 ${String(f[3])}ms · 텍스처 ${String(f[4])}B`,
      );
      // 한 프레임에 그리는 일은 예산(4ms) + 칸 하나 몫 · 옮겨 올리기 정도 (한 번에 그리던 0.1~0.25초가 프레임 하나에 몰리지 않는다)
      // (판 중에 바꿔 굽지 않았으면 — 로비에서 내 의상을 미리 구웠고 명단에 다른 의상이 없으면 — 값이 없다)
      expect(Number(f[1] ?? 0), `${p.role} 한 프레임 최대`).toBeLessThan(40);
    }

    // 3) 괴물 화면: 셋을 차례로 같은 자리 · 같은 방향에 세우고 같은 그림 시계로 찍은 조각이 같다
    await host.keyboard.press('KeyX');
    await host.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
      timeout: 15_000,
    });
    const park = (i: number): [number, number] => [PRISON_CENTER.x - 1 + i, PRISON_CENTER.y];
    const survivors = players.slice(1);
    for (const [i, s] of survivors.entries()) {
      await sendTest(host, { kind: 'teleport', target: s.id, x: park(i)[0], y: park(i)[1], face: 0 });
      await sendTest(host, { kind: 'freeze', target: s.id, frozen: true });
    }
    await sendTest(host, { kind: 'teleport', target: players[0]!.id, x: 42, y: 11.4, face: Math.PI });
    await sendTest(host, { kind: 'freeze', target: players[0]!.id, frozen: true });
    await aimMonsterAt(host, 36, 11.4);
    const SPOT = { x: 39.6, y: 11.6, face: 0.3 };
    const shoot = async (): Promise<Buffer> => {
      await host.evaluate(() => window.__DECOY__?.freezeClock(1000));
      await host.waitForTimeout(400);
      const box = await host.evaluate(
        ({ x, y }) => {
          const d = window.__DECOY__!;
          const c = d.tileToClient(x, y)!;
          const e = d.tileToClient(x + 1, y)!;
          return { x: c.x, y: c.y, px: e.x - c.x };
        },
        { x: SPOT.x, y: SPOT.y },
      );
      const half = Math.round(box.px * 1.1);
      const shot = await host.screenshot({
        clip: { x: Math.round(box.x) - half, y: Math.round(box.y) - half, width: half * 2, height: half * 2 },
      });
      await host.evaluate(() => window.__DECOY__?.freezeClock(null));
      return shot;
    };
    // 빈 자리 (아무도 없음)
    await host.waitForTimeout(1500);
    expect((await lastSnapshot(host))!.survivors).toHaveLength(0);
    const empty = await shoot();
    const crops: Buffer[] = [];
    for (const [i, s] of survivors.entries()) {
      await sendTest(host, { kind: 'teleport', target: s.id, x: SPOT.x, y: SPOT.y, face: SPOT.face });
      // 보간 · 발견 효과가 끝날 때까지
      await host.waitForTimeout(2500);
      const snap = (await lastSnapshot(host))!;
      expect(snap.survivors, `${s.role}만 보인다`).toHaveLength(1);
      const drawn = await host.evaluate(() =>
        (window.__DECOY__?.getDrawn() ?? []).filter((d) => d.kind === 'survivor').map((d) => d.sprite),
      );
      expect(drawn, `${s.role} 괴물 화면 그림 키`).toEqual(['survivor-hidden']);
      crops.push(await shoot());
      await sendTest(host, { kind: 'teleport', target: s.id, x: park(i)[0], y: park(i)[1], face: 0 });
    }
    const diffs = await cropDiffs(host, [...crops, empty]);
    console.log(
      `[costume] 괴물 화면 조각 차 (러너 기준): ${diffs.map((d) => `max ${d.max} · 평균 ${d.mean.toFixed(3)}`).join(' | ')}`,
    );
    // 셋은 같다 (렌더러 반올림 몫 1까지), 빈 자리와는 다르다(정말 몸을 찍었다)
    for (const d of diffs.slice(1, 3)) {
      expect(d.max).toBeLessThanOrEqual(1);
      expect(d.mean).toBeLessThanOrEqual(0.05);
    }
    expect(diffs[3]!.mean).toBeGreaterThan(5);
    for (const pl of players) expect(pl.problems).toEqual([]);
    await closeAll(players);
  },
);

test('옷장: 망토 해금(두 번 눌러 확인) → 입기 → 다시 열어도 그대로, 불씨가 모자라면 해금 단추가 꺼지고, 그 의상으로 판에 들어간다', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser);
  await dress(context, { survivor: 'basic', monster: 'basic' }, 500);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await press(page.getByTestId('level-chip'));
  await press(page.getByTestId('hub-tab-wardrobe'));
  await expect(page.getByTestId('wardrobe')).toBeVisible();
  await expect(page.getByTestId('wd-tile-basic')).toContainText('입는 중');
  await expect(page.getByTestId('wd-tile-cape')).toContainText('400');
  await press(page.getByTestId('wd-tile-cape'));
  await expect(page.getByTestId('wd-preview')).toHaveAttribute('data-costume', 'cape');
  const action = page.getByTestId('wd-action');
  await expect(action).toHaveText('해금 · 불씨 400');
  // 두 번 누름(더블클릭)은 해금하지 않는다: 두 번째 누름이 막 그려진 확인 단추에 떨어지지 않는다 (F17과 같은 가드)
  await action.dblclick();
  await expect(action).toHaveText('한 번 더 누르면 해금 (불씨 400)');
  await expect(page.getByTestId('hub-coins')).toHaveText('500');
  // 탭을 바꾸면 확인이 풀린다
  await press(page.getByTestId('hub-tab-today'));
  await press(page.getByTestId('hub-tab-wardrobe'));
  await press(page.getByTestId('wd-tile-cape'));
  await expect(action).toHaveText('해금 · 불씨 400');
  await press(action);
  await expect(action).toHaveText('한 번 더 누르면 해금 (불씨 400)');
  // 확인 단추 가드(0.4초)가 풀린 뒤 누른다
  await expect(action).not.toHaveClass(/arming/);
  // 아직 불씨 그대로 (한 번 눌러서는 해금하지 않는다)
  await expect(page.getByTestId('hub-coins')).toHaveText('500');
  await press(action);
  await expect(page.getByTestId('wd-notice')).toContainText('망토 해금');
  await expect(page.getByTestId('hub-coins')).toHaveText('100');
  await expect(action).toHaveText('입기');
  await press(action);
  await expect(page.getByTestId('wd-tile-cape')).toContainText('입는 중');
  await expect(action).toHaveText('입는 중');
  await expect(action).toBeDisabled();
  // 불씨 모자람: 탈출 배낭(250)
  await press(page.getByTestId('wd-tile-pack'));
  await expect(action).toHaveText('불씨가 150 모자라요');
  await expect(action).toBeDisabled();
  // 괴물 탭: 괴물 의상만 (생존자 의상 칸 없음)
  await press(page.getByTestId('wd-team-monster'));
  await expect(page.getByTestId('wd-tile-chains')).toBeVisible();
  await expect(page.getByTestId('wd-tile-cape')).toHaveCount(0);
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as unknown, KEY);
  expect(stored).toMatchObject({ coins: 100, owned: ['cape'], wear: { survivor: 'cape', monster: 'basic' } });
  // 다시 열어도 그대로
  await page.reload();
  await press(page.getByTestId('level-chip'));
  await press(page.getByTestId('hub-tab-wardrobe'));
  await expect(page.getByTestId('wd-tile-cape')).toContainText('입는 중');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hub')).toBeHidden();
  // 그 의상으로 판에 들어간다 (봇과 연습: 내 역할 칸에 망토, 봇 자리는 기본)
  await page.getByTestId('practice').click();
  await page.getByTestId('practice-role-guard').click();
  await waitForSnapshots(page, 3);
  await expect
    .poll(() => atlasDress(page), { timeout: 15_000 })
    .toBe('runner:basic,guard:cape,scout:basic,monster:basic');
  expect(problems).toEqual([]);
  await context.close();
});

test('의상 그림 조각을 받지 못해도(배포 직후 옛 화면) 해금 · 입기 · 판은 그대로 — 기본 그림으로 굽고 오류 없음', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, problems } = await newPlayerPage(browser, { serviceWorkers: 'block' });
  await page.route(/\/assets\/art-[^/]*\.js$/, (route) => route.abort());
  await dress(context, { survivor: 'scarf', monster: 'basic' }, 300);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  await press(page.getByTestId('level-chip'));
  await press(page.getByTestId('hub-tab-wardrobe'));
  await expect(page.getByTestId('wd-tile-scarf')).toContainText('입는 중');
  await press(page.getByTestId('wd-tile-pack'));
  await press(page.getByTestId('wd-action'));
  await press(page.getByTestId('wd-action'));
  await expect(page.getByTestId('hub-coins')).toHaveText('50');
  await press(page.getByTestId('wd-action'));
  await expect(page.getByTestId('wd-tile-pack')).toContainText('입는 중');
  await page.keyboard.press('Escape');
  await page.getByTestId('practice').click();
  await page.getByTestId('practice-role-scout').click();
  await waitForSnapshots(page, 20);
  // 조각이 없으면 모두 기본으로 굽는다 (판 · 판정 · 크기는 같다 — 의상은 장식뿐)
  expect(await atlasDress(page)).toBe('runner:basic,guard:basic,scout:basic,monster:basic');
  // 막은 조각의 실패 기록 · 서비스 워커를 막은 경고(이 시험이 막았다)만 있다
  const expected =
    /Failed to load resource|dynamically imported module|art-|Service Worker registration blocked/;
  expect(problems.filter((p) => !expected.test(p))).toEqual([]);
  await context.close();
});
