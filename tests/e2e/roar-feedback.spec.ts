// 포효 표시 강화 (플레이테스트 반영 a-3, Canvas · 품질 낮음): 드러나는 정보는 그대로이고 전달만 세다.
//  - 괴물 화면: (창 밖 화살표 + 창 안 핑) = 미니맵 핑 = 소리 핑 = 알림의 수 = 서버가 보낸 드러난 수. 포효 핑 화살표만 크게 +
//    흰 펄스 고리(미니맵 고리와 같은 값, 크게 본 지도도 같은 프레임 같은 값), 핑마다 같은 그림. 1.5초 뒤 아무것도 남지 않는다
//  - 0명: 화살표 · 핑 없이 빈 메아리 소리 한 번과 '근처에 아무도 없다.' — 쿨타임 중에 다시 눌러도 아무 일도 없다
//  - 번쩍임 줄이기: 고리가 퍼지지 않고 고정. 거점 화살표는 그대로(배율 1 · 고리 없음)
//  - 생존자 화면은 그대로: 핑 소리 · 결과 알림 · 큰 화살표 · 고리가 없고, 서버는 생존자에게 드러난 자리를 보내지 않는다
// 한 번의 포효를 페이지 안 프레임 기록기로 처음부터 끝까지 적어 본다(고정 대기 뒤 한 번 읽지 않는다)
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Balance, OffscreenMarkerDebug, PingRingDebug } from '@decoy/shared';
import { STORY_TEXT } from '../../client/src/data/storyText';
import { PING_PULSE } from '../../client/src/render/prefsFx';
import { roarResultText } from '../../client/src/roarFeedback';
import { EDGE_ART, MM_PING } from '../../client/src/ui/hudArt';
import { HUD, MAP_RECT } from '../../client/src/ui/layout';
import { collectFrames } from './frames';
import {
  createRoom,
  joinRoom,
  myId,
  newPlayerPage,
  pickRoleAndReady,
  press,
  truth,
  waitForSnapshots,
} from './helpers';
import { settle, startBotRoom, type Session } from './m10-map.shared';

const QUERY = '&renderer=canvas&quality=low';
const balance = JSON.parse(readFileSync('config/balance.json', 'utf8')) as Balance;
const REVEAL_MS = balance.monster.roar.revealDuration * 1000;
/** 포효와 얽힌 알림 글 전부 (기록기가 '끝났다'를 판단한다): 결과 0~3명 + 생존자 화면 경고 */
const ROAR_TEXTS = [0, 1, 2, 3].map(roarResultText).concat(STORY_TEXT.ALERT_ROAR.text);
const RESULT_TEXTS = [0, 1, 2, 3].map(roarResultText);
/** 고리 그림 배율의 끝 (구운 크기 = 커진 배지 둘레) */
const HALO_MAX = EDGE_ART.haloTo / EDGE_ART.pingScale;

interface RoarFrame {
  /** 기록을 켠 뒤 지난 ms */
  t: number;
  /** 메인 화면에 그린 포효 핑 자리 */
  pings: { x: number; y: number }[];
  /** 생존자 화면: 포효한 괴물 자리 표시 수 */
  marks: number;
  /** 미니맵 · 크게 본 지도에 찍은 포효 핑 수 */
  mini: number;
  big: number;
  markers: OffscreenMarkerDebug[];
  rings: { small: PingRingDebug[]; big: PingRingDebug[] };
  banners: string[];
  view: { x: number; y: number; w: number; h: number } | null;
}

interface RoarRecord {
  frames: RoarFrame[];
  /** 포효 전 · 끝난 뒤 소리 기록 */
  sounds0: string[];
  sounds1: string[];
  started: boolean;
  done: boolean;
}

/**
 * 페이지 안 프레임 기록기: rAF마다 포효 표시(핑 · 화살표 · 미니맵 · 고리 · 알림)를 적는다. 포효가 보이기 시작하면 started,
 * 모든 표시가 사라진 뒤 10프레임이 더 지나면 done (그 10프레임이 '잔상 없음'의 증거다)
 */
async function record(page: Page): Promise<void> {
  await page.evaluate((texts) => {
    const w = window as unknown as { __roar?: RoarRecord };
    const d = window.__DECOY__!;
    const rec: RoarRecord = { frames: [], sounds0: d.getSounds(), sounds1: [], started: false, done: false };
    w.__roar = rec;
    const t0 = performance.now();
    let quiet = 0;
    const step = (): void => {
      const c = d.getCamera();
      const drawn = d.getDrawn();
      const f: RoarFrame = {
        t: performance.now() - t0,
        pings: drawn.filter((e) => e.tag === 'roarPing').map((e) => ({ x: e.x, y: e.y })),
        marks: drawn.filter((e) => e.tag === 'roarSelf').length,
        mini: d.getDrawnMinimap().filter((e) => e.tag === 'roarPing').length,
        big: d.getDrawnMinimapBig().filter((e) => e.tag === 'roarPing').length,
        markers: c?.markers ?? [],
        rings: c?.pingRings ?? { small: [], big: [] },
        banners: d.getBanners(),
        view: c?.view ?? null,
      };
      rec.frames.push(f);
      const showing =
        f.pings.length > 0 ||
        f.marks > 0 ||
        f.mini > 0 ||
        f.big > 0 ||
        f.rings.small.length > 0 ||
        f.rings.big.length > 0 ||
        f.markers.some((m) => m.kind === 'roarPing' || m.halo !== null) ||
        f.banners.some((b) => texts.includes(b));
      if (showing) rec.started = true;
      quiet = showing ? 0 : quiet + 1;
      if (rec.started && quiet >= 10) {
        rec.sounds1 = d.getSounds();
        rec.done = true;
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, ROAR_TEXTS);
}

async function recorded(page: Page): Promise<RoarRecord> {
  await page.waitForFunction(
    () => (window as unknown as { __roar?: RoarRecord }).__roar?.done === true,
    null,
    {
      timeout: 20_000,
      polling: 100,
    },
  );
  return page.evaluate(() => (window as unknown as { __roar: RoarRecord }).__roar);
}

const count = (list: readonly string[], name: string): number => list.filter((x) => x === name).length;
/** 포효 뒤 새로 난 소리 수 (기록은 최근 50개라 포효 전 수를 뺀다) */
const added = (r: RoarRecord, name: string): number => count(r.sounds1, name) - count(r.sounds0, name);

/** 서버 정답: 괴물에서 포효 반경 안에 있는 자유 · 수감 생존자 수 (서버가 드러내는 기준과 같다) */
async function truthFound(page: Page): Promise<number> {
  const room = await page.evaluate(() => window.__DECOY__?.room ?? '');
  const t = await truth(page, room);
  const m = t.players.find((p) => p.role === 'monster');
  if (!m) throw new Error('서버 정답에 괴물 없음');
  return t.players.filter(
    (p) =>
      p.role !== 'monster' &&
      (p.status === 'free' || p.status === 'imprisoned') &&
      Math.hypot(p.x - m.x, p.y - m.y) <= balance.monster.roar.radius,
  ).length;
}

/**
 * 봇 방을 괴물로 열어 생존자를 놓고(place), 괴물을 (20.5, 24.5)에 세워 왼쪽 위를 조준한다. outside 자리들이 창 밖이 될 때까지
 * 기다린다 — 조준 방향에 따라 창이 앞당겨져 창 안팎이 갈린다(camera.spec 괴물 화살표 시험과 같은 장면 · 같은 경쟁 대책)
 */
async function monsterScene(
  browser: Browser,
  place: (s: Session) => Promise<void>,
  outside: readonly (readonly [number, number])[],
): Promise<{ s: Session; aim: () => Promise<void> }> {
  const s = await startBotRoom(browser, QUERY, 'monster');
  const { page } = s;
  const you = (await page.evaluate(() => window.__DECOY__!.you)) ?? '';
  await place(s);
  await s.send({ kind: 'freeze', target: you, frozen: false });
  await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
    timeout: 20_000,
  });
  await s.send({ kind: 'teleport', target: you, x: 20.5, y: 24.5, face: Math.PI / 2 });
  await s.send({ kind: 'freeze', target: you, frozen: false });
  await settle(page);
  const aim = async (): Promise<void> => {
    const at = await page.evaluate(() => window.__DECOY__!.tileToClient(16, 21));
    if (!at) throw new Error('타일 → 화면 좌표 없음');
    await page.mouse.move(at.x, at.y);
    await page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.face ?? 0) < -1.5, null, {
      timeout: 10_000,
    });
    await page.waitForFunction(
      (pts) => {
        const c = window.__DECOY__?.getCamera();
        const v = c?.view;
        if (!c || !v || c.shakes > 0) return false;
        const inside = (x: number, y: number): boolean =>
          x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;
        return pts.every(([x, y]) => !inside(x!, y!));
      },
      outside,
      { timeout: 10_000 },
    );
  };
  await aim();
  return { s, aim };
}

/** 창 안인가 (화살표가 창 밖을 가르는 기준과 같은 여유 0.15타일) */
function inView(v: NonNullable<RoarFrame['view']>, x: number, y: number): boolean {
  const m = 0.15;
  return x >= v.x + m && x <= v.x + v.w - m && y >= v.y + m && y <= v.y + v.h - m;
}

const pingMarkers = (f: RoarFrame): OffscreenMarkerDebug[] => f.markers.filter((m) => m.kind === 'roarPing');

/** 셰브론 끝 자리 (논리 px): 셰브론 그림은 기준점에서 dir 쪽으로 (r + chevGap + chevLen) × 배율까지 뻗는다 */
function chevTip(m: OffscreenMarkerDebug): { x: number; y: number } {
  const len = (EDGE_ART.r + EDGE_ART.chevGap + EDGE_ART.chevLen) * HUD.s * m.scale;
  return { x: m.chev.x + Math.cos(m.dir) * len, y: m.chev.y + Math.sin(m.dir) * len };
}

test('포효 (괴물): 화살표 + 창 안 핑 = 미니맵 = 소리 = 알림의 수 = 서버가 보낸 수, 창 밖 핑은 큰 화살표 + 펄스 고리, 1.5초 뒤 잔상 없음', async ({
  browser,
}) => {
  // 생존자 셋 모두 반경 안: 하나는 창 안(등 뒤), 둘은 창 밖
  const { s, aim } = await monsterScene(
    browser,
    async (x) => {
      await x.send({ kind: 'teleport', target: x.id('runner'), x: 24.5, y: 26.5, face: 0 });
      await x.send({ kind: 'teleport', target: x.id('scout'), x: 19.5, y: 16.5, face: -1.2 });
      await x.send({ kind: 'teleport', target: x.id('guard'), x: 29.5, y: 25.5, face: 0.4 });
    },
    [
      [19.5, 16.5],
      [29.5, 25.5],
    ],
  );
  const { page } = s;
  const survivors = ['runner', 'guard', 'scout'].map((r) => s.id(r));
  // 지도를 크게 열어 둔다 (작은 지도와 같은 값을 그리는지 본다). 누른 뒤 마우스가 지도 쪽이라 조준을 다시 잡는다
  const tap = (await page.evaluate(() => window.__DECOY__!.getMatchPrefs()!.minimapTap))!;
  await page.mouse.click(tap.x + tap.w / 2, tap.y + tap.h / 2);
  await expect.poll(() => page.evaluate(() => window.__DECOY__!.getMatchPrefs()!.minimapBig.open)).toBe(true);
  await aim();
  const found = await truthFound(page);
  expect(found, '서버 정답: 반경 안 생존자 셋').toBe(3);

  await record(page);
  await page.keyboard.press('KeyQ');
  const rec = await recorded(page);
  const live = rec.frames.filter((f) => f.pings.length > 0);
  expect(live.length, '핑이 보인 프레임').toBeGreaterThan(8);

  // ── 수: 그린 핑 = 미니맵 = 크게 본 지도 = 화살표 + 창 안 = 서버 정답 ──
  for (const f of live) {
    expect(f.pings.length).toBe(found);
    expect(f.mini).toBe(found);
    expect(f.big).toBe(found);
    const inside = f.pings.filter((p) => inView(f.view!, p.x, p.y));
    expect(inside).toEqual([{ x: 24.5, y: 26.5 }]);
    const pm = pingMarkers(f);
    expect(pm.map((m) => [m.tx, m.ty])).toEqual([
      [19.5, 16.5],
      [29.5, 25.5],
    ]);
    expect(pm.length + inside.length).toBe(found);
    // 화살표는 포효 핑뿐이고(점령 중 거점 없음), 생존자 id가 없다
    expect(f.markers.length).toBe(pm.length);
    for (const m of pm) expect(survivors).not.toContain(m.id);
  }
  // ── 소리: 포효 한 번 + 드러난 수만큼 핑 (빈 메아리 없음) ──
  expect(added(rec, 'roar')).toBe(1);
  expect(added(rec, 'roarFound')).toBe(found);
  expect(added(rec, 'roarEmpty')).toBe(0);
  // ── 알림: 핑이 보이는 프레임에만, 그 수 그대로 ──
  for (const f of rec.frames) {
    const shown = f.banners.filter((b) => RESULT_TEXTS.includes(b));
    expect(shown, `t=${Math.round(f.t)}`).toEqual(f.pings.length > 0 ? [roarResultText(found)] : []);
  }
  expect(roarResultText(found)).toContain('3명');

  // ── 큰 화살표 + 펄스 고리: 핑마다 같은 그림 · 같은 값, 미니맵 고리(작은 지도 · 크게 본 지도)와 같은 위상 ──
  const haloScales: number[] = [];
  for (const f of live) {
    const pm = pingMarkers(f);
    const first = pm[0]!;
    expect(first.scale).toBeCloseTo(EDGE_ART.pingScale, 6);
    expect(first.halo).not.toBeNull();
    const halo = first.halo!;
    for (const m of pm) {
      expect(m.scale).toBe(first.scale);
      expect(m.halo).toEqual(halo);
      // 커진 배지 · 셰브론 끝이 맵 창 안에 있다 (논리 px)
      const r = EDGE_ART.r * EDGE_ART.pingScale * HUD.s;
      expect(m.x - r).toBeGreaterThanOrEqual(MAP_RECT.x);
      expect(m.x + r).toBeLessThanOrEqual(MAP_RECT.x + MAP_RECT.w);
      expect(m.y - r).toBeGreaterThanOrEqual(MAP_RECT.y);
      expect(m.y + r).toBeLessThanOrEqual(MAP_RECT.y + MAP_RECT.h);
      const tip = chevTip(m);
      expect(tip.x).toBeGreaterThanOrEqual(MAP_RECT.x);
      expect(tip.x).toBeLessThanOrEqual(MAP_RECT.x + MAP_RECT.w);
      expect(tip.y).toBeGreaterThanOrEqual(MAP_RECT.y);
      expect(tip.y).toBeLessThanOrEqual(MAP_RECT.y + MAP_RECT.h);
      // 셰브론은 배지 밖 대상 쪽을 가리킨다: 끝이 커진 배지 테두리보다 멀고, 보통 화살표의 끝과 같은 거리다
      // (배지는 기기 픽셀에 맞춰 놓고 셰브론은 맞추지 않아 1px 안에서 어긋난다)
      const reach = Math.hypot(tip.x - m.x, tip.y - m.y);
      expect(reach).toBeGreaterThan(r);
      expect(Math.abs(reach - (EDGE_ART.r + EDGE_ART.chevGap + EDGE_ART.chevLen) * HUD.s)).toBeLessThan(1);
    }
    // 고리: 구운 크기(배지 둘레)에서 haloTo까지, 알파는 퍼질수록 옅게 — 같은 위상에서 나온 두 값이다
    expect(halo.scale).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(halo.scale).toBeLessThan(HALO_MAX);
    const phase = (halo.scale - 1) / (HALO_MAX - 1);
    expect(halo.alpha).toBeCloseTo(PING_PULSE.alpha * (1 - phase), 5);
    // 미니맵 고리: 핑마다 하나, 화살표 고리와 같은 위상 · 같은 알파. 크게 본 지도도 같은 값
    expect(f.rings.small).toHaveLength(found);
    for (const ring of f.rings.small) {
      expect((ring.scale - 1) / (MM_PING.ringTo - 1)).toBeCloseTo(phase, 5);
      expect(ring.alpha).toBeCloseTo(halo.alpha, 6);
    }
    expect(f.rings.big).toHaveLength(found);
    f.rings.big.forEach((ring, i) => {
      expect(ring.scale).toBeCloseTo(f.rings.small[i]!.scale, 6);
      expect(ring.alpha).toBeCloseTo(f.rings.small[i]!.alpha, 6);
    });
    haloScales.push(halo.scale);
  }
  // 퍼진다: 고리 크기가 프레임마다 달라지고, 처음 크기로 두 번 넘게 돌아온다(1.5초에 3번 — 2번 되돌아감)
  let wraps = 0;
  for (let i = 1; i < haloScales.length; i += 1) if (haloScales[i]! < haloScales[i - 1]! - 0.05) wraps += 1;
  expect(new Set(haloScales.map((v) => v.toFixed(3))).size).toBeGreaterThan(6);
  expect(wraps).toBe(2);
  expect(Math.max(...haloScales)).toBeGreaterThan(1 + (HALO_MAX - 1) * 0.6);

  // ── 수명: 1.5초(revealDuration) 그대로, 끝난 뒤 10프레임 동안 아무것도 없다 (잔상 없음) ──
  const span = live[live.length - 1]!.t - live[0]!.t;
  expect(span).toBeLessThanOrEqual(REVEAL_MS);
  expect(span).toBeGreaterThan(REVEAL_MS * 0.8);
  const tail = rec.frames.slice(rec.frames.indexOf(live[live.length - 1]!) + 1);
  expect(tail.length).toBeGreaterThanOrEqual(10);
  for (const f of tail) {
    expect(f.pings).toEqual([]);
    expect(f.mini + f.big).toBe(0);
    expect(f.markers.filter((m) => m.kind === 'roarPing' || m.halo !== null)).toEqual([]);
    expect(f.rings).toEqual({ small: [], big: [] });
    expect(f.banners.filter((b) => ROAR_TEXTS.includes(b))).toEqual([]);
  }
  console.log(
    `[roar-feedback] 3명: 프레임 ${live.length} · 수명 ${Math.round(span)}ms · 고리 ${Math.min(...haloScales).toFixed(2)}~${Math.max(...haloScales).toFixed(2)}배 · 화살표 ${JSON.stringify(pingMarkers(live[0]!).map((m) => [m.id, Math.round(m.x), Math.round(m.y), m.scale]))}`,
  );
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test("포효 (괴물, 0명): 화살표 · 핑 없이 빈 메아리 한 번과 '근처에 아무도 없다.' 1.5초, 쿨타임 중에는 다시 눌러도 아무 일도 없다", async ({
  browser,
}) => {
  const { s } = await monsterScene(
    browser,
    async (x) => {
      await x.send({ kind: 'teleport', target: x.id('runner'), x: 44.5, y: 2.5, face: 0 });
      await x.send({ kind: 'teleport', target: x.id('scout'), x: 40.5, y: 2.5, face: -1.2 });
      await x.send({ kind: 'teleport', target: x.id('guard'), x: 42.5, y: 12.5, face: 0.4 });
    },
    [],
  );
  const { page } = s;
  expect(await truthFound(page), '서버 정답: 반경 안에 아무도 없다').toBe(0);
  await record(page);
  await page.keyboard.press('KeyQ');
  const rec = await recorded(page);
  // 포효는 나갔다 (빈 통과가 아님): 포효 소리 한 번 + 빈 메아리 한 번, 핑 소리는 없다
  expect(added(rec, 'roar')).toBe(1);
  expect(added(rec, 'roarEmpty')).toBe(1);
  expect(added(rec, 'roarFound')).toBe(0);
  // 드러난 자리가 없으니 핑 · 화살표 · 미니맵 · 고리도 없다
  for (const f of rec.frames) {
    expect(f.pings).toEqual([]);
    expect(f.mini).toBe(0);
    expect(f.markers.filter((m) => m.kind === 'roarPing' || m.halo !== null)).toEqual([]);
    expect(f.rings.small).toEqual([]);
  }
  // 알림: '근처에 아무도 없다.' 하나만, 핑이 있었다면 보였을 시간(1.5초)만큼
  const withText = rec.frames.filter((f) => f.banners.some((b) => RESULT_TEXTS.includes(b)));
  expect(withText.length).toBeGreaterThan(8);
  for (const f of withText)
    expect(f.banners.filter((b) => RESULT_TEXTS.includes(b))).toEqual([roarResultText(0)]);
  expect(roarResultText(0)).toContain('아무도 없다');
  const span = withText[withText.length - 1]!.t - withText[0]!.t;
  expect(span).toBeLessThanOrEqual(REVEAL_MS);
  expect(span).toBeGreaterThan(REVEAL_MS * 0.8);

  // 쿨타임(30초) 중에 다시 누르면 포효가 나가지 않는다: 서버가 그 입력을 처리한 뒤에도 소리 · 알림이 그대로다
  expect((await page.evaluate(() => window.__DECOY__!.getLastSnapshot()!.you.mon!.roarCd)) > 20).toBe(true);
  const before = await page.evaluate(() => ({
    sounds: window.__DECOY__!.getSounds(),
    snaps: window.__DECOY__!.snapCount,
  }));
  await page.keyboard.press('KeyQ');
  await waitForSnapshots(page, before.snaps + 8);
  const after = await page.evaluate(() => ({
    sounds: window.__DECOY__!.getSounds(),
    banners: window.__DECOY__!.getBanners(),
  }));
  expect(after.sounds).toEqual(before.sounds);
  expect(after.banners.filter((b) => ROAR_TEXTS.includes(b))).toEqual([]);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('포효 (괴물, 번쩍임 줄이기): 화살표 · 미니맵 고리가 퍼지지 않고 고정, 거점 화살표는 그대로, 수 · 소리 · 알림은 같다', async ({
  browser,
}) => {
  // 러너는 거점 A를 점령 중(반경 밖), 둘은 반경 안 · 창 밖
  const { s } = await monsterScene(
    browser,
    async (x) => {
      await x.send({ kind: 'teleport', target: x.id('runner'), x: 8.4, y: 16.2, face: 0 });
      await x.send({ kind: 'teleport', target: x.id('scout'), x: 19.5, y: 16.5, face: -1.2 });
      await x.send({ kind: 'teleport', target: x.id('guard'), x: 29.5, y: 25.5, face: 0.4 });
    },
    [
      [19.5, 16.5],
      [29.5, 25.5],
    ],
  );
  const { page } = s;
  await expect
    .poll(() =>
      page.evaluate(() => window.__DECOY__?.getLastSnapshot()?.world.points.find((p) => p.id === 'A')?.state),
    )
    .toBe('capturing');
  // 점령 시작 알림(2초)이 지나간 뒤에 포효한다 (알림 줄 수와 무관하지만 장면을 같게)
  await page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__DECOY__!.setMatchPref('reduceFlash', true));
  expect(await page.evaluate(() => window.__DECOY__!.getMatchPrefs()!.reduceFlash)).toBe(true);
  const found = await truthFound(page);
  expect(found, '서버 정답: 반경 안 생존자 둘').toBe(2);

  await record(page);
  await page.keyboard.press('KeyQ');
  const rec = await recorded(page);
  const live = rec.frames.filter((f) => f.pings.length > 0);
  expect(live.length).toBeGreaterThan(8);
  const halos = new Set<string>();
  const rings = new Set<string>();
  for (const f of live) {
    expect(f.pings.length).toBe(found);
    expect(f.mini).toBe(found);
    const pm = pingMarkers(f);
    // 둘 다 창 밖: 화살표 둘 + 창 안 0 = 드러난 수
    expect(pm.length).toBe(found);
    for (const m of pm) {
      expect(m.scale).toBeCloseTo(EDGE_ART.pingScale, 6);
      halos.add(JSON.stringify(m.halo));
    }
    // 거점 화살표(점령 중 A)는 그대로: 배율 1 · 고리 없음
    const points = f.markers.filter((m) => m.kind === 'point');
    expect(points.map((m) => [m.id, m.scale, m.halo])).toEqual([['A', 1, null]]);
    expect(f.rings.small).toHaveLength(found);
    for (const r of f.rings.small) rings.add(JSON.stringify(r));
  }
  // 고정: 1.5초 내내 고리 값이 하나뿐이다 (배지 밖에 보이는 크기 · 알파)
  expect([...halos]).toHaveLength(1);
  const halo = JSON.parse([...halos][0]!) as { scale: number; alpha: number };
  expect(halo.scale).toBeCloseTo(1 + (HALO_MAX - 1) * PING_PULSE.steadyT, 5);
  expect(halo.alpha).toBeCloseTo(PING_PULSE.steadyAlpha, 5);
  expect([...rings]).toHaveLength(1);
  const ring = JSON.parse([...rings][0]!) as PingRingDebug;
  expect(ring.scale).toBeCloseTo(1 + (MM_PING.ringTo - 1) * PING_PULSE.steadyT, 5);
  expect(ring.alpha).toBeCloseTo(PING_PULSE.steadyAlpha, 5);
  // 수 · 소리 · 알림은 보통 때와 같다
  expect(added(rec, 'roarFound')).toBe(found);
  expect(added(rec, 'roarEmpty')).toBe(0);
  expect(live.every((f) => f.banners.includes(roarResultText(found)))).toBe(true);
  // 끝나면 고정 고리도 함께 사라진다
  const last = rec.frames[rec.frames.length - 1]!;
  expect(last.markers.filter((m) => m.kind === 'roarPing' || m.halo !== null)).toEqual([]);
  expect(last.rings.small).toEqual([]);
  // 포효 핑에 썼던 화살표 칸을 거점 화살표가 다시 써도 커진 채 남지 않는다
  expect(last.markers.map((m) => [m.kind, m.scale, m.halo])).toEqual([['point', 1, null]]);
  expect(s.problems).toEqual([]);
  await s.context.close();
});

test('포효 (생존자 화면은 그대로): 핑 소리 · 결과 알림 · 큰 화살표 · 고리가 없고, 서버는 드러난 자리를 괴물에게만 보낸다', async ({
  browser,
}) => {
  // 사람 둘(괴물 · 러너) + 봇 둘. 받은 WebSocket 프레임 원문을 모은다
  const m = await newPlayerPage(browser);
  const mFrames = collectFrames(m.page);
  const code = await createRoom(m.page, `&bots=1${QUERY}`);
  const r = await newPlayerPage(browser);
  const rFrames = collectFrames(r.page);
  await joinRoom(r.page, code, QUERY);
  await pickRoleAndReady(m.page, 'monster');
  await pickRoleAndReady(r.page, 'runner');
  await press(m.page.getByTestId('start-button'));
  await waitForSnapshots(m.page, 5);
  await waitForSnapshots(r.page, 5);
  const monsterId = await myId(m.page);
  const runnerId = await myId(r.page);
  const t0 = await truth(m.page, code);
  const botId = (role: string): string => t0.players.find((p) => p.role === role)?.id ?? '';
  // 봇은 멈춰 두고 자리를 놓는다: 러너(사람) · 가드는 반경 안, 스카우트는 멀리
  const put = (target: string, x: number, y: number, frozen: boolean): Promise<void> =>
    m.page.evaluate(
      ([id, px, py, fr]) => {
        const d = window.__DECOY__!;
        d.sendTest({ kind: 'teleport', target: id, x: px, y: py, face: 0 });
        d.sendTest({ kind: 'freeze', target: id, frozen: fr });
      },
      [target, x, y, frozen] as const,
    );
  await put(botId('guard'), 27.5, 25.5, true);
  await put(botId('scout'), 44.5, 2.5, true);
  await put(runnerId, 24.5, 26.5, false);
  await put(monsterId, 20.5, 24.5, false);
  await expect.poll(() => truthFound(m.page), { timeout: 15_000 }).toBe(2);
  await m.page.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.you.move.frozen ?? 1) <= 0, null, {
    timeout: 20_000,
  });
  // 시작 문구 · 조작 안내가 지나간 뒤 (알림 줄이 비어 있을 때)
  for (const p of [m.page, r.page]) {
    await p.keyboard.press('KeyX');
    await p.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
      timeout: 15_000,
    });
  }
  const pingFrames = (raw: readonly string[]): string[] => raw.filter((x) => x.includes('"roarPings"'));
  expect(pingFrames(mFrames.raw)).toEqual([]);

  await record(m.page);
  await record(r.page);
  await m.page.keyboard.press('KeyQ');
  const mon = await recorded(m.page);
  const sur = await recorded(r.page);

  // ── 서버가 보낸 것: 괴물에게 roarPings 한 번(자리 둘 — id · 역할 없음), 생존자에게는 한 번도 없다 ──
  const sent = pingFrames(mFrames.raw);
  expect(sent).toHaveLength(1);
  const events = (
    JSON.parse(sent[0]!) as { s: { events: { k: string; pts?: unknown[] }[] } }
  ).s.events.filter((e) => e.k === 'roarPings');
  expect(events).toHaveLength(1);
  const pts = events[0]!.pts as Record<string, unknown>[];
  expect(pts).toHaveLength(2);
  for (const p of pts) expect(Object.keys(p).sort()).toEqual(['x', 'y']);
  expect(pingFrames(rFrames.raw)).toEqual([]);

  // ── 괴물 화면: 그린 핑 = 미니맵 = 화살표 + 창 안 = 소리 = 알림 = 서버가 보낸 수 ──
  const live = mon.frames.filter((f) => f.pings.length > 0);
  expect(live.length).toBeGreaterThan(5);
  for (const f of live) {
    expect(f.pings.length).toBe(pts.length);
    expect(f.mini).toBe(pts.length);
    const inside = f.pings.filter((p) => inView(f.view!, p.x, p.y)).length;
    expect(pingMarkers(f).length + inside).toBe(pts.length);
    expect(f.banners.filter((b) => RESULT_TEXTS.includes(b))).toEqual([roarResultText(pts.length)]);
  }
  expect(added(mon, 'roarFound')).toBe(pts.length);
  expect(added(mon, 'roar')).toBe(1);

  // ── 생존자 화면: 예전 그대로 — 포효 소리 한 번 · '괴물이 포효했다.' · 괴물 자리 표시뿐 ──
  expect(added(sur, 'roar')).toBe(1);
  expect(added(sur, 'roarFound')).toBe(0);
  expect(added(sur, 'roarEmpty')).toBe(0);
  expect(sur.frames.some((f) => f.banners.includes(STORY_TEXT.ALERT_ROAR.text))).toBe(true);
  expect(
    sur.frames.some((f) => f.marks > 0),
    '생존자 화면에 포효한 괴물 자리 표시',
  ).toBe(true);
  for (const f of sur.frames) {
    expect(f.banners.filter((b) => RESULT_TEXTS.includes(b))).toEqual([]);
    expect(f.pings).toEqual([]);
    expect(f.mini).toBe(0);
    expect(f.rings).toEqual({ small: [], big: [] });
    // 생존자 화면의 화살표는 모두 보통 크기 · 고리 없음
    for (const mk of f.markers) {
      expect(mk.scale, mk.kind).toBe(1);
      expect(mk.halo, mk.kind).toBeNull();
    }
  }
  expect(m.problems).toEqual([]);
  expect(r.problems).toEqual([]);
  await m.context.close();
  await r.context.close();
});
