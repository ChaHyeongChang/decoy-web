// 탈출구 자물쇠 판 (플레이테스트 a-9, client/src/art/keypad.ts · render/keypad.ts): 두 사람이 탈출구에 함께 서 있는 3초 동안 모은
// 비밀번호 조각이 문 왼쪽 벽 판에 한 자리씩 들어가고(메모 배너의 숫자 그대로), 한 명이 나가면 지워지고, 열리면 열린 판이 된다.
// 같은 동안 괴물 화면은 숫자 없는 빈 판(화면 픽셀로도 켜진 획이 없다). 판 중 재접속으로 앞 조각 메모를 못 받으면 '••dd'.
// 기준 화면(아이폰 14 Chrome 가로 · 주소창 844×300 + 안전 영역)에서 판이 배너 · 메모 · 캐릭터와 겹치지 않는다(북 · 남).
// 판 값은 정보 레이어 'keypad' 항목(값 '모드:네 칸')을 프레임마다 모아 보고, 서버 상태는 스냅샷을 조건으로 기다린다(고정 대기 없음).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { ExitId, Role } from '@decoy/shared';
import { KEYPAD, digitAt, keypadAt } from '../../client/src/art/keypad';
import { dimmed } from '../../client/src/art/mapArtBadges';
import { OBJ_COLOR } from '../../client/src/art/mapArtGeom';
import {
  PHONE_BROWSER,
  closeAll,
  createRoom,
  dpr1,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  sendTest,
  startFourPlayerMatch,
  truth,
  waitForSnapshots,
  type DeviceOptions,
} from './helpers';
import { emulateSafeArea, waitForTouchTarget } from './touch';

const POLL = { intervals: [100, 150, 200], timeout: 20_000 };

/** 페이지 안 감시 기록: 판 값(바뀔 때만) · 본 배너 · 판과 HUD 배너 · 메모 · 캐릭터가 겹친 최대 넓이 */
interface KeypadWatch {
  values: Record<ExitId, string[]>;
  banners: string[];
  /** 판이 맵 창 안에 보인 프레임 수 (북 · 남) */
  shown: Record<ExitId, number>;
  /** 판이 보이는 동안 배너 · 메모도 떠 있던 프레임 수 (겹침 검사가 빈 통과가 아님) */
  withHud: Record<ExitId, number>;
  /** 판 ↔ 배너 · 메모 겹친 넓이 최대 (CSS px²)와 그때 부품 */
  hudOverlap: number;
  hudWith: string;
  /** 판 ↔ 캐릭터 몸(판정 반지름 원) 겹친 프레임 수 */
  bodyOverlap: number;
  /** 판 ↔ 보이는 터치 버튼 · 스틱 겹친 넓이 최대와 그 대상 */
  touchOverlap: number;
  touchWith: string;
}

/** 페이지에 감시를 건다: rAF마다 정보 레이어 · 배너 · HUD 배치 · 그린 캐릭터를 읽는다 */
async function watchKeypads(
  page: Page,
  rects: Record<ExitId, { x0: number; y0: number; x1: number; y1: number }>,
  bodyR: number,
): Promise<void> {
  await page.evaluate(
    ({ rects, bodyR }) => {
      const w: KeypadWatch = {
        values: { N: [], S: [] },
        banners: [],
        shown: { N: 0, S: 0 },
        withHud: { N: 0, S: 0 },
        hudOverlap: 0,
        hudWith: '',
        bodyOverlap: 0,
        touchOverlap: 0,
        touchWith: '',
      };
      (window as unknown as { __keypadWatch: KeypadWatch }).__keypadWatch = w;
      const area = (
        a: { x: number; y: number; w: number; h: number },
        b: { x: number; y: number; w: number; h: number },
      ): number =>
        Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const tick = (): void => {
        const d = window.__DECOY__;
        if (d) {
          for (const i of d.getInfoLayer()) {
            if (i.kind !== 'keypad') continue;
            const list = w.values[i.tag === 'keypad-N' ? 'N' : 'S'];
            if (list[list.length - 1] !== i.value) list.push(String(i.value));
          }
          for (const b of d.getBanners()) if (!w.banners.includes(b)) w.banners.push(b);
          const l = d.getHudLayout();
          const view = d.getCamera()?.view;
          if (l && view) {
            const drawn = d.getDrawn().filter((e) => e.kind !== 'mark' && e.layer !== 'minimap');
            for (const id of ['N', 'S'] as const) {
              const r = rects[id];
              // 맵 창(카메라) 안에 보이는 판만
              if (r.x1 < view.x || r.x0 > view.x + view.w || r.y1 < view.y || r.y0 > view.y + view.h)
                continue;
              const a = d.tileToClient(r.x0, r.y0);
              const b = d.tileToClient(r.x1, r.y1);
              if (!a || !b) continue;
              w.shown[id] += 1;
              const plate = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
              const hud = l.items.filter((it) => it.id === 'banner' || it.id === 'note');
              if (hud.length > 0) w.withHud[id] += 1;
              for (const it of hud) {
                const o = area(plate, it);
                if (o > w.hudOverlap) {
                  w.hudOverlap = o;
                  w.hudWith = `${it.id}:${it.text ?? ''}`;
                }
              }
              for (const e of drawn) {
                const nx = Math.max(r.x0, Math.min(e.x, r.x1));
                const ny = Math.max(r.y0, Math.min(e.y, r.y1));
                if (Math.hypot(e.x - nx, e.y - ny) < bodyR) w.bodyOverlap += 1;
              }
              for (const t of d.getTouchTargets()) {
                if (t.kind === 'zone') continue;
                const o = area(plate, t);
                if (o > w.touchOverlap) {
                  w.touchOverlap = o;
                  w.touchWith = t.id;
                }
              }
            }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { rects, bodyR },
  );
}

const watchOf = (page: Page): Promise<KeypadWatch> =>
  page.evaluate(() => (window as unknown as { __keypadWatch: KeypadWatch }).__keypadWatch);

/** 판 N · S 사각형 (타일) */
const RECTS = { N: keypadAt('N'), S: keypadAt('S') };
/** 캐릭터 몸 반지름 (타일, balance.json 생존자 0.3 · 괴물 0.35 중 큰 값) */
const BODY_R = 0.35;

/** 메모 배너에서 읽은 조각 (못 봤으면 null) */
function noteCode(banners: readonly string[], which: '앞자리' | '뒷자리'): string | null {
  for (const b of banners) {
    const m = new RegExp(`${which} (\\d\\d)`).exec(b);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** 서버 스냅샷에서 탈출구 상태가 될 때까지 */
async function waitExit(page: Page, id: ExitId, state: 'active' | 'open'): Promise<void> {
  await page.waitForFunction(
    ([e, s]) => window.__DECOY__?.getLastSnapshot()?.world.exits.find((x) => x.id === e)?.state === s,
    [id, state] as const,
    { polling: 100, timeout: 20_000 },
  );
}

/** 판 값이 조건(정규식)에 맞을 때까지 (프레임마다 모은 기록의 마지막 값) */
async function waitValue(page: Page, id: ExitId, re: RegExp): Promise<string> {
  await expect
    .poll(async () => (await watchOf(page)).values[id].at(-1) ?? '', { ...POLL, message: `${id} 판 ${re}` })
    .toMatch(re);
  return (await watchOf(page)).values[id].at(-1) ?? '';
}

/**
 * 판 숫자 칸 네 개 안에서 켜진 획 색(개방 게이지 색 · 탈출구 초록, 보이는 곳 1 · 안 보이는 곳 0.45 알파로 미리 섞은 색)에 가까운
 * 픽셀 수 (칸마다). 판이 카메라 창 밖이면 던진다(빈 통과 방지). 스크린샷을 페이지 안에서 디코드한다 (pixelSpot.ts와 같은 방식)
 */
async function litDigitPixels(page: Page, id: ExitId): Promise<number[]> {
  const shot = await page.screenshot();
  const r = RECTS[id];
  const boxes = [0, 1, 2, 3].map((i) => {
    const p = digitAt(i);
    return [r.x0 + p.x, r.y0 + p.y, r.x0 + p.x + KEYPAD.glyphW, r.y0 + p.y + KEYPAD.glyphH] as const;
  });
  const lit = [OBJ_COLOR.gauge, OBJ_COLOR.go].flatMap((c) => [dimmed(c, 1), dimmed(c, 0.45)]);
  return page.evaluate(
    async ({ b64, boxes, lit, rect }) => {
      const d = window.__DECOY__;
      const view = d?.getCamera()?.view;
      if (!d || !view) throw new Error('디버그 훅 · 카메라 없음');
      if (rect.x0 < view.x || rect.x1 > view.x + view.w || rect.y0 < view.y || rect.y1 > view.y + view.h)
        throw new Error('판이 카메라 창 밖이다');
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D 컨텍스트 없음');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const k = img.width / window.innerWidth;
      return boxes.map(([x0, y0, x1, y1]) => {
        const a = d.tileToClient(x0, y0);
        const b = d.tileToClient(x1, y1);
        if (!a || !b) throw new Error('tileToClient 없음');
        let n = 0;
        for (let y = Math.ceil(a.y * k); y < Math.floor(b.y * k); y += 1)
          for (let x = Math.ceil(a.x * k); x < Math.floor(b.x * k); x += 1) {
            const i = (y * c.width + x) * 4;
            const [pr, pg, pb] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
            if (
              lit.some((t) => Math.hypot(pr - ((t >> 16) & 255), pg - ((t >> 8) & 255), pb - (t & 255)) < 24)
            )
              n += 1;
          }
        return n;
      });
    },
    { b64: shot.toString('base64'), boxes, lit, rect: r },
  );
}

/** 입력이 n자리인 판 값들 (앞에서부터) */
const typingRun = (digits: string): string[] => [
  'idle:____',
  ...[1, 2, 3, 4].map((n) => `typing:${digits.slice(0, n).padEnd(4, '_')}`),
  `open:${digits}`,
];

test('러너 화면: 둘이 서면 자물쇠 판이 빈 판 → 한 자리씩(메모 숫자) → 열림, 한 명이 나가면 지워진다 — 같은 동안 괴물 화면은 숫자 없는 빈 판', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { players } = await startFourPlayerMatch(browser);
  const [monster, runner, guard] = players as [
    (typeof players)[0],
    (typeof players)[0],
    (typeof players)[0],
    (typeof players)[0],
  ];
  const host = monster.page;
  // 괴물은 북쪽 문 왼쪽 앞에서 북쪽을 본다 (판이 괴물 카메라 안)
  await sendTest(host, { kind: 'teleport', target: monster.id, x: 21, y: 4.5, face: -Math.PI / 2 });
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 8, y: 16 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 40, y: 16 });
  await watchKeypads(runner.page, RECTS, BODY_R);
  await watchKeypads(monster.page, RECTS, BODY_R);
  await sendTest(host, { kind: 'setPoint', point: 'A', progress: 0.99 });
  await sendTest(host, { kind: 'setPoint', point: 'B', progress: 0.99 });
  await waitExit(runner.page, 'N', 'active');
  await waitValue(runner.page, 'N', /^idle:____$/);
  await waitValue(monster.page, 'N', /^idle:____$/);

  // 북쪽 문 앞에 둘: 한 자리 이상 들어가면 가드가 나갔다(지워짐) 돌아온다
  await sendTest(host, { kind: 'teleport', target: runner.id, x: 23.5, y: 2.5 });
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 24.5, y: 2.5 });
  await waitValue(runner.page, 'N', /^typing:\d/);
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 24.5, y: 7 });
  await waitValue(runner.page, 'N', /^idle:____$/);
  await sendTest(host, { kind: 'teleport', target: guard.id, x: 24.5, y: 2.5 });
  await waitExit(runner.page, 'N', 'open');
  await waitValue(runner.page, 'N', /^open:\d{4}$/);
  await waitExit(host, 'N', 'open');
  await waitValue(monster.page, 'N', /^open:____$/);
  // 메모 두 개를 다 볼 때까지 (메모 상자는 한 번에 하나: 4초 뒤 다음)
  await expect
    .poll(async () => {
      const b = (await watchOf(runner.page)).banners;
      return [noteCode(b, '앞자리'), noteCode(b, '뒷자리')].every((c) => c !== null);
    }, POLL)
    .toBe(true);

  const rw = await watchOf(runner.page);
  const digits = `${noteCode(rw.banners, '앞자리')}${noteCode(rw.banners, '뒷자리')}`;
  const n = rw.values.N;
  // 처음 입력은 지워지기 전에 앞에서부터 몇 자리 (끝까지 가지 않았다), 그 뒤 처음부터 한 자리씩 다시 → 열림
  const cleared = n.lastIndexOf('idle:____');
  expect(cleared, n.join(' → ')).toBeGreaterThan(1);
  const first = n.slice(0, cleared);
  expect(first, n.join(' → ')).toEqual(typingRun(digits).slice(0, first.length));
  expect(first.length).toBeLessThan(5);
  expect(n.slice(cleared), n.join(' → ')).toEqual(typingRun(digits));
  // 남쪽 판은 켜진 빈 판 그대로
  expect(rw.values.S).toEqual(['idle:____']);

  // 괴물 화면: 같은 동안 빈 판 → 열린 빈 판뿐 (입력 자리 수 · 숫자 없음)
  const mw = await watchOf(monster.page);
  expect(mw.values).toEqual({ N: ['idle:____', 'open:____'], S: ['idle:____'] });
  expect(
    mw.banners.some((b) => /앞자리|뒷자리|\d\d · 문에/.test(b)),
    mw.banners.join(' / '),
  ).toBe(false);

  // 화면 픽셀: 러너 화면의 열린 판은 네 칸 모두 켜진 획이 있고, 괴물 화면의 열린 판에는 켜진 획이 하나도 없다
  const runnerLit = await litDigitPixels(runner.page, 'N');
  const monsterLit = await litDigitPixels(monster.page, 'N');
  console.log(
    `[keypad] 조각 ${digits} · 러너 판 ${n.join(' → ')} · 켜진 획 픽셀 러너 ${runnerLit} / 괴물 ${monsterLit}`,
  );
  for (const v of runnerLit) expect(v, `러너 ${runnerLit}`).toBeGreaterThan(4);
  expect(monsterLit).toEqual([0, 0, 0, 0]);
  expect(rw.bodyOverlap + mw.bodyOverlap).toBe(0);
  for (const p of players) expect(p.problems).toEqual([]);
  await closeAll(players);
});

/** 터치 기기 (기기 배율 1, 창 크기 지정) */
function touchDevice(width: number, height: number): DeviceOptions {
  return dpr1({ ...PHONE_BROWSER, viewport: { width, height }, screen: { width, height } });
}

/** 헤드리스 크롬의 진짜 전체 화면은 창 크기를 바꾼다: 아무것도 하지 않게 한다 (m12-hud와 같다) */
function stubFullscreen(): void {
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
}

/** 봇 방을 만들어 역할을 고르고 혼자 시작한다 (빈 역할은 서버 봇) */
async function soloMatch(
  browser: Browser,
  device: DeviceOptions,
  role: Role,
  safeArea: { left: number; right: number; bottom: number },
): Promise<{ context: BrowserContext; page: Page; problems: string[]; code: string; id: string }> {
  const { context, page, problems } = await newPlayerPage(browser, device);
  await context.addInitScript(stubFullscreen);
  await emulateSafeArea(page, safeArea);
  const code = await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, role);
  await press(page.getByTestId('start-button'));
  await waitForSnapshots(page, 3);
  await waitForTouchTarget(page, 'move-zone');
  return { context, page, problems, code, id: await myId(page) };
}

test('아이폰 14 가로 844×300: 재접속으로 앞 조각 메모를 못 받으면 판이 ••dd, 북 · 남 판이 배너 · 메모 · 캐릭터 · 터치 버튼과 겹치지 않는다', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await soloMatch(browser, touchDevice(844, 300), 'runner', { left: 47, right: 47, bottom: 21 });
  const { page } = s;
  const ids = (await truth(page, s.code)).players;
  const idOf = (role: string): string => ids.find((p) => p.role === role)?.id ?? '';
  /** 괴물 봇은 멀리 두고 봇을 세운다 (순간이동은 정지를 푼다 — 옮긴 뒤 세운다) */
  const freezeBots = async (): Promise<void> => {
    await sendTest(page, { kind: 'teleport', target: idOf('monster'), x: 45, y: 28 });
    for (const r of ['monster', 'guard', 'scout'])
      await sendTest(page, { kind: 'freeze', target: idOf(r), frozen: true });
  };
  /** 러너와 가드 봇을 탈출구 판정 원 안에 (가드는 옮긴 뒤 다시 세운다) */
  const standAt = async (y: number): Promise<void> => {
    await sendTest(page, { kind: 'teleport', target: s.id, x: 23.5, y });
    await sendTest(page, { kind: 'teleport', target: idOf('guard'), x: 24.5, y });
    await sendTest(page, { kind: 'freeze', target: idOf('guard'), frozen: true });
  };
  await freezeBots();
  const banners = (): Promise<string[]> => page.evaluate(() => window.__DECOY__?.getBanners() ?? []);
  // 거점 A 해독 → 앞자리 메모를 본 뒤 새로고침 (서버는 이미 보낸 메모를 다시 보내지 않는다)
  await sendTest(page, { kind: 'setPoint', point: 'A', progress: 1 });
  await sendTest(page, { kind: 'teleport', target: s.id, x: 8, y: 16 });
  await expect.poll(async () => (await banners()).some((b) => b.includes('앞자리')), POLL).toBe(true);
  await page.reload();
  await page.waitForFunction(
    (me) => {
      const d = window.__DECOY__;
      return !!d && d.you === me && d.snapCount >= 3;
    },
    s.id,
    { polling: 100, timeout: 20_000 },
  );
  await waitForTouchTarget(page, 'move-zone');
  await freezeBots();
  await watchKeypads(page, RECTS, BODY_R);
  // 거점 B 해독 → 뒷자리 메모 (다시 붙은 뒤라 받는다)
  await sendTest(page, { kind: 'setPoint', point: 'B', progress: 1 });
  await sendTest(page, { kind: 'teleport', target: s.id, x: 40, y: 16 });
  await waitExit(page, 'N', 'active');
  await expect.poll(async () => noteCode((await watchOf(page)).banners, '뒷자리'), POLL).not.toBeNull();
  const back = noteCode((await watchOf(page)).banners, '뒷자리') ?? '';
  // 북쪽 문: 러너 + 멈춘 가드 봇
  await standAt(2.5);
  await waitExit(page, 'N', 'open');
  await waitValue(page, 'N', /^open:/);
  // 열림 알림("북쪽 문이 열렸다.")이 떠 있는 동안도 겹침을 본다
  await expect.poll(async () => (await banners()).some((b) => b.startsWith('북쪽 문')), POLL).toBe(true);
  await expect.poll(async () => (await banners()).some((b) => b.startsWith('북쪽 문')), POLL).toBe(false);
  // 남쪽 문
  await standAt(29.5);
  await waitExit(page, 'S', 'open');
  await waitValue(page, 'S', /^open:/);
  await expect.poll(async () => (await banners()).some((b) => b.startsWith('남쪽 문')), POLL).toBe(true);
  await expect.poll(async () => (await banners()).some((b) => b.startsWith('남쪽 문')), POLL).toBe(false);

  const w = await watchOf(page);
  console.log(
    `[keypad] 844×300 재접속: 뒷자리 ${back} · 북 ${w.values.N.join(' → ')} · 남 ${w.values.S.join(' → ')} · 보인 프레임 ${JSON.stringify(w.shown)} (배너 · 메모와 함께 ${JSON.stringify(w.withHud)}) · 배너 겹침 ${w.hudOverlap}(${w.hudWith}) · 터치 버튼 겹침 ${w.touchOverlap}(${w.touchWith})`,
  );
  // 앞 조각은 모름(•), 뒤 조각은 메모 숫자 — 자리는 메모 id로 정한다
  expect(w.values.N).toEqual(typingRun(`••${back}`));
  expect(w.values.S).toEqual(typingRun(`••${back}`));
  // 두 판 모두 화면에 보였고, 그동안 배너 · 메모 · 캐릭터 몸과 겹치지 않았다
  expect(w.shown.N).toBeGreaterThan(10);
  expect(w.shown.S).toBeGreaterThan(10);
  expect(w.withHud.N, '북쪽 판이 보이는 동안 배너 · 메모가 뜬 적이 있다').toBeGreaterThan(10);
  expect(w.withHud.S, '남쪽 판이 보이는 동안 배너가 뜬 적이 있다').toBeGreaterThan(10);
  expect([w.hudOverlap, w.hudWith]).toEqual([0, '']);
  expect(w.bodyOverlap).toBe(0);
  expect([w.touchOverlap, w.touchWith]).toEqual([0, '']);
  expect(s.problems).toEqual([]);
  await s.context.close();
});
