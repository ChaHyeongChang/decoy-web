// M10b 캐릭터 · 효과 (Canvas 렌더러 · 소프트웨어 합성 · 1920×1080 배율 1). VISUAL_SPEC 0장 불변 항목을 픽셀로 지킨다:
//  - 괴물 화면 흰색 위장: 부채꼴 · 근접 원 · 공격 범위 안에서도 생존자 몸 원판은 무채색 · 밝음, 역할 4색과 멀다.
//    그림 키는 모두 'survivor-hidden'이고 세 몸의 흰 폭 · 그림자 폭 · 평균색이 같다(±1px · ΔE ≤ 1).
//    능력 노출 중인 한 명만 1초 동안(0.8초 시점에도) 역할색 테두리 + 머리 위 문양
//  - 노출 문양 · 기절 별 · 기절 채도 감소가 다른 캐릭터 몸 · 노출 링을 덮지 않는다
//  - 생존자 화면 역할색 유지: 빛 바닥 · 노랑 · 빨강 부채꼴 · 공격 범위 안(정보 항목으로 포함관계 확인)에서 팀원 몸 평균색 ΔE ≤ 15,
//    몸/바깥 링 대비 3:1. 부채꼴 가장자리 선은 팀원 접지 그림자 둘레에서도 끊기지 않는다
//  - 범위 = 판정값: 공격 준비 범위 경계 반지름이 attack.range × 타일 화면 크기 ±2px. 가드 밀치기 사거리는 철창에 막히면 'blocked'
//  - 품질 높음 · 중간 · 낮음의 그린 엔티티 · 정보 레이어가 같고, 효과가 몸 · 링을 바꾸지 않으며(몸 평균색 Lab ΔE ≤ 10),
//    후처리는 구조 레이어에만
// 픽셀은 Phaser가 그린 바로 그 프레임을 페이지 안에서 읽는다 (visualProbe.ts).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  blocksStrike,
  monsterConePolygon,
  pointInPolygon,
  validateBalance,
  type DrawnEntity,
  type InfoItem,
  type Role,
} from '@decoy/shared';
import { closeAll, lastSnapshot, sendTest, startFourPlayerMatch, type Player } from './helpers';
import {
  captureBodies,
  captureSweep,
  deltaE,
  describe as describeCapture,
  type BodyProbe,
  type Capture,
} from './visualProbe';

const ROLE_HEX = { runner: 0x3b82f6, guard: 0xa855f7, scout: 0x22c55e, monster: 0xef4444 } as const;
/** 기절 별 색 (부채꼴 노랑) */
const STAR_HEX = 0xeab308;

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

async function settle(p: Player): Promise<void> {
  await p.page.setViewportSize({ width: 1920, height: 1080 });
  await p.page.keyboard.press('KeyX');
  await p.page.waitForFunction(() => (window.__DECOY__?.getBanners() ?? []).length === 0, null, {
    timeout: 15_000,
  });
}

async function aimAt(page: Page, x: number, y: number): Promise<void> {
  const c = await page.evaluate(([tx, ty]) => window.__DECOY__?.tileToClient(tx!, ty!) ?? null, [x, y]);
  await page.mouse.move(c!.x, c!.y);
}

async function place(
  host: Page,
  who: Record<string, [string, number, number, number?]>,
  freeze = true,
): Promise<void> {
  for (const [, [id, x, y, face]] of Object.entries(who))
    await sendTest(host, { kind: 'teleport', target: id, x, y, face });
  if (freeze)
    for (const [, [id]] of Object.entries(who))
      await sendTest(host, { kind: 'freeze', target: id, frozen: true });
}

function roles(players: Player[]): Record<Role, Player> {
  return Object.fromEntries(players.map((p) => [p.role, p])) as Record<Role, Player>;
}

/** 괴물 화면에 그려진 생존자 → 탐침 (이름 = 실제 역할: 서버 정답으로 맞춘다) */
async function hiddenBodies(monster: Page, r: number): Promise<BodyProbe[]> {
  const drawn = await monster.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const room = await monster.evaluate(() => window.__DECOY__?.room ?? '');
  const truthRes = await monster.request.get(`/test/state?room=${room}`);
  const truth = (await truthRes.json()) as { players: { id: string; role: string; x: number; y: number }[] };
  return drawn
    .filter((d) => d.kind === 'survivor')
    .map((d) => {
      const near = truth.players
        .filter((t) => t.role !== 'monster')
        .sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y))[0];
      return { name: near?.role ?? '?', x: d.x, y: d.y, face: d.face, r };
    });
}

/** 생존자 화면의 팀원 (가드 · 스카우트) 탐침 */
function teamBodies(drawn: DrawnEntity[], players: Record<Role, Player>, r: number): BodyProbe[] {
  const out: BodyProbe[] = [];
  for (const role of ['guard', 'scout'] as const) {
    const d = drawn.find((e) => e.id === players[role].id);
    if (d) out.push({ name: role, x: d.x, y: d.y, face: d.face, r });
  }
  return out;
}

/** 몸 원판(0.45r) 둘레 점들 (포함관계 확인용, 타일) */
function diskPoints(b: { x: number; y: number }, rad: number): { x: number; y: number }[] {
  const out = [{ x: b.x, y: b.y }];
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    out.push({ x: b.x + Math.cos(a) * rad, y: b.y + Math.sin(a) * rad });
  }
  return out;
}

/** 정보 항목의 부채꼴(r · dir · arc) 안인가 (벽 무시) */
function inSector(it: InfoItem, p: { x: number; y: number }): boolean {
  const d = Math.hypot(p.x - it.x, p.y - it.y);
  let a = Math.atan2(p.y - it.y, p.x - it.x) - (it.dir ?? 0);
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return d <= (it.r ?? 0) && Math.abs(a) <= (it.arc ?? 0) / 2;
}

/** 세 숨은 몸이 같은 크기 · 같은 그림자 · 같은 색인가 (흰색 위장 '같은 실루엣') */
function expectSameHidden(c: Capture, label: string): void {
  const [a, ...rest] = c.stats;
  expect(a, label).toBeDefined();
  console.log(
    `[m10-visual] ${label} 흰 폭 ${c.stats.map((s) => s.widths.map((w) => w.toFixed(1)).join('/')).join(' | ')} · 그림자 ${c.stats.map((s) => s.shadowW?.toFixed(1)).join(' | ')} · 평균색 ${c.stats.map((s) => s.mean.map((v) => v.toFixed(0)).join(',')).join(' | ')}`,
  );
  for (const s of rest) {
    s.widths.forEach((w, i) =>
      expect(Math.abs(w - a!.widths[i]!), `${label} ${s.name} 흰 폭 ${i}`).toBeLessThanOrEqual(1),
    );
    expect(s.shadowW, `${label} ${s.name} 그림자`).not.toBeNull();
    expect(Math.abs(s.shadowW! - a!.shadowW!), `${label} ${s.name} 그림자 폭`).toBeLessThanOrEqual(1);
    expect(deltaE(s.mean, a!.mean), `${label} ${s.name} 몸 평균색`).toBeLessThanOrEqual(1);
  }
}

test(
  '괴물 화면 흰색 위장: 부채꼴 · 근접 원 · 공격 범위 안에서도 흰 공통 실루엣, 능력 노출 1초만 역할색 테두리 + 문양',
  { tag: '@core' },
  async ({ browser }) => {
    const q = '&quality=low';
    const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
    const p = roles(players);
    const host = p.monster.page;
    const sr = balance.survivor.radius;
    await settle(p.monster);
    // B방 북쪽: 러너는 근접 원 · 공격 범위 안, 가드 · 스카우트는 부채꼴 안
    await place(host, {
      runner: [p.runner.id, 41, 11, 0.3],
      guard: [p.guard.id, 39.6, 12, -2.6],
      scout: [p.scout.id, 38, 10.6, 1.2],
    });
    await place(host, { monster: [p.monster.id, 42, 11.4, Math.PI] }, false);
    await aimAt(host, 36, 11.4);
    await host.evaluate(() => window.__DECOY__?.freezeClock(1000));
    await host.waitForTimeout(900);
    expect((await lastSnapshot(host))!.survivors.length).toBe(3);

    // 1) 부채꼴 · 근접 원 안 (그림자 폭은 몸의 옆 축으로 잰다: 세 몸 모두 그 축 위에 다른 캐릭터가 없다)
    const bodies = await hiddenBodies(host, sr);
    expect(bodies.length).toBe(3);
    const ref = { runner: ROLE_HEX.runner, guard: ROLE_HEX.guard, scout: ROLE_HEX.scout };
    const still = await captureBodies(host, bodies, { refColors: ref });
    console.log(`[m10-visual] 괴물 화면 (부채꼴 · 근접 원): ${describeCapture(still)}`);
    expect(still.ok).toBe(true);
    const sprites = still.drawn.filter((d) => d.kind === 'survivor').map((d) => d.sprite);
    expect(sprites).toEqual(['survivor-hidden', 'survivor-hidden', 'survivor-hidden']);
    for (const s of still.stats) {
      expect(s.whiteFrac, `${s.name} 흰 비율`).toBeGreaterThanOrEqual(0.9);
      expect(s.minRoleDeltaE, `${s.name} 역할색 ΔE`).toBeGreaterThanOrEqual(40);
      // 역할색 테두리 · 문양 없음
      expect(s.ringRoleHits, `${s.name} 링 역할색`).toBeLessThanOrEqual(2);
    }
    expect(still.info.filter((i) => i.kind === 'reveal')).toEqual([]);
    // 같은 실루엣: 세 몸의 흰 폭(바라보는 방향 기준 여러 방향) · 그림자 폭 ±1px, 평균색 ΔE ≤ 1
    expectSameHidden(still, '괴물 화면 세 몸');

    // 2) 공격 준비 범위 안 (누른 순간부터 예측) + 범위 경계 = 판정값
    const me = (await host.evaluate(() => window.__DECOY__?.getRenderPos()))!;
    await host.mouse.down({ button: 'left' });
    await host.mouse.up({ button: 'left' });
    const atk = await captureBodies(host, bodies, {
      waitEffect: 'attackRange',
      refColors: ref,
      range: { x: me.x, y: me.y, dir: me.face, tiles: balance.monster.attack.range },
    });
    console.log(
      `[m10-visual] 괴물 화면 (공격 준비): ${describeCapture(atk)} / 범위 경계 ${atk.rangePx?.toFixed(2)}px (판정 ${atk.rangeExpectPx?.toFixed(2)}px)`,
    );
    expect(atk.ok).toBe(true);
    expect(atk.effects.attackRange).toBe(true);
    for (const s of atk.stats) {
      expect(s.whiteFrac, `${s.name} 흰 비율 (공격 범위)`).toBeGreaterThanOrEqual(0.9);
      expect(s.minRoleDeltaE).toBeGreaterThanOrEqual(40);
    }
    expect(Math.abs(atk.rangePx! - atk.rangeExpectPx!)).toBeLessThanOrEqual(2);
    const atkInfo = atk.info.find((i) => i.kind === 'range' && i.tag === 'attack');
    expect(atkInfo?.r).toBe(balance.monster.attack.range);
    expect(atkInfo?.arc).toBeCloseTo((balance.monster.attack.arc * Math.PI) / 180, 3);
    await host.waitForTimeout(1600);

    // 3) 스카우트 능력 노출: 그 한 명만 1초 동안 역할색 테두리 + 머리 위 문양. 몸은 흰색 그대로
    await p.scout.page.keyboard.press('Space');
    const rev = await captureBodies(host, bodies, { waitEffect: 'reveal', refColors: ref });
    console.log(`[m10-visual] 괴물 화면 (스카우트 노출): ${describeCapture(rev)}`);
    expect(rev.ok).toBe(true);
    const reveals = rev.info.filter((i) => i.kind === 'reveal');
    expect(reveals.map((i) => i.tag)).toEqual(['scout']);
    expect(reveals[0]!.color).toBe(ROLE_HEX.scout);
    expect(rev.drawn.filter((d) => d.kind === 'survivor').every((d) => d.sprite === 'survivor-hidden')).toBe(
      true,
    );
    for (const s of rev.stats) {
      expect(s.whiteFrac, `${s.name} 흰 비율 (노출 중)`).toBeGreaterThanOrEqual(0.9);
      if (s.name === 'scout') {
        expect(s.ringRoleHits, '스카우트 역할색 테두리').toBeGreaterThan(20);
        expect(s.glyphRoleHits, '스카우트 머리 위 문양').toBeGreaterThan(8);
      } else {
        expect(s.ringRoleHits, `${s.name} 테두리 없음`).toBeLessThanOrEqual(2);
        expect(s.glyphRoleHits, `${s.name} 문양 없음`).toBeLessThanOrEqual(2);
      }
    }
    // 노출 '1초 동안': 처음 보인 프레임에서 0.8초 뒤에도 테두리 · 문양이 그대로
    const held = await captureBodies(host, bodies, {
      waitEffect: 'reveal',
      refColors: ref,
      notBefore: rev.tMet + 800,
    });
    console.log(
      `[m10-visual] 괴물 화면 (노출 ${(held.tCapture - rev.tMet).toFixed(0)}ms 뒤): ${describeCapture(held)}`,
    );
    expect(held.ok, '노출 0.8초 시점에도 reveal').toBe(true);
    expect(held.tCapture - rev.tMet).toBeGreaterThanOrEqual(800);
    const heldScout = held.stats.find((s) => s.name === 'scout')!;
    expect(heldScout.ringRoleHits, '0.8초 시점 스카우트 테두리').toBeGreaterThan(20);
    expect(heldScout.glyphRoleHits, '0.8초 시점 스카우트 문양').toBeGreaterThan(8);
    // 노출 창(abilityRevealDuration) 뒤에는 사라진다
    await host.waitForTimeout(balance.survivor.abilityRevealDuration * 1000 + 400);
    const after = await captureBodies(host, bodies, { refColors: ref });
    expect(after.info.filter((i) => i.kind === 'reveal')).toEqual([]);
    for (const s of after.stats) expect(s.ringRoleHits, `${s.name} 노출 끝`).toBeLessThanOrEqual(2);

    for (const pl of players) expect(pl.problems).toEqual([]);
    await closeAll(players);
  },
);

test('생존자 화면 역할색 유지: 빛 바닥 · 빨강 · 노랑 부채꼴 · 공격 범위 안에서 팀원 몸 ΔE ≤ 15, 몸/바깥 링 대비 3:1', async ({
  browser,
}) => {
  const q = '&quality=low';
  const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
  const p = roles(players);
  const host = p.monster.page;
  const view = p.runner.page;
  const sr = balance.survivor.radius;
  await settle(p.runner);
  await settle(p.monster);
  await view.evaluate(() => window.__DECOY__?.freezeClock(1000));
  const ref = { guard: ROLE_HEX.guard, scout: ROLE_HEX.scout };
  /** 잰다. inside가 있으면 재기 전에 팀원 원판이 그 정보 항목(부채꼴 · 범위) 안인지 먼저 확인한다 */
  const check = async (
    label: string,
    waitEffect?: string,
    inside?: (info: InfoItem[]) => InfoItem | undefined,
  ): Promise<void> => {
    const drawn = await view.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
    const bodies = teamBodies(drawn, p, sr);
    expect(bodies.length, label).toBe(2);
    const c = await captureBodies(view, bodies, {
      refColors: ref,
      ...(waitEffect ? { waitEffect } : {}),
    });
    console.log(`[m10-visual] 러너 화면 (${label}): ${describeCapture(c)}`);
    expect(c.ok, label).toBe(true);
    if (inside) {
      const it = inside(c.info);
      expect(it, `${label} 정보 항목`).toBeDefined();
      // 그 프레임에 그린 팀원 자리의 몸 원판(0.45r)이 정보 항목의 부채꼴 · 범위 안 (부채꼴은 벽에 잘린 판정 다각형도)
      const poly =
        it!.kind === 'cone'
          ? monsterConePolygon(
              balance,
              { x: it!.x, y: it!.y },
              it!.dir!,
              (it!.r! - balance.monster.visionModes.search.range) /
                (balance.monster.visionModes.hunt.range - balance.monster.visionModes.search.range),
            )
          : null;
      for (const b of teamBodies(c.drawn, p, sr))
        for (const pt of diskPoints(b, 0.45 * sr)) {
          expect(inSector(it!, pt), `${label} ${b.name} 원판이 ${it!.tag} 안`).toBe(true);
          if (poly) expect(pointInPolygon(pt, poly), `${label} ${b.name} 원판이 판정 다각형 안`).toBe(true);
        }
    }
    for (const s of c.stats) {
      expect(s.deltaE!, `${label} ${s.name} 역할색 ΔE`).toBeLessThanOrEqual(15);
      expect(s.contrast, `${label} ${s.name} 몸/링 대비`).toBeGreaterThanOrEqual(3);
    }
  };

  // 1) 빛 바닥 (괴물은 멀리)
  await place(host, {
    runner: [p.runner.id, 36, 11, 0],
    guard: [p.guard.id, 37.6, 11.6, 0.5],
    scout: [p.scout.id, 37.2, 12.8, 2.2],
    monster: [p.monster.id, 5, 28, 0],
  });
  await view.waitForTimeout(900);
  await check('빛 바닥');

  // 2) 빨강 부채꼴 (괴물이 가드 · 스카우트를 본다: 두 원판 모두 부채꼴(탐색 5타일 · 110°) 안)
  await place(host, { monster: [p.monster.id, 41.5, 12, Math.PI] }, false);
  await aimAt(host, 36, 12);
  await view.waitForFunction(() => window.__DECOY__?.getEffects().coneRed === 1, null, { timeout: 10_000 });
  await view.waitForTimeout(300);
  await check('빨강 부채꼴', undefined, (info) =>
    info.find((i) => i.kind === 'cone' && i.tag === 'monster' && i.value === 'seen'),
  );

  // 3) 공격 범위 안 (괴물 바로 앞, 누른 동안: 두 원판 모두 1.2타일 · 90° 안). 괴물에서 1.05타일 · 조준 ±33°에 괴물을 보고 선다:
  //    등 쪽 링(r+3~r+8px)이 범위 경계 선(호 · 직선 변) · 서로의 몸과 거의 겹치지 않는다(겹침 4% 남짓)
  await place(host, {
    guard: [p.guard.id, 40.1 - 0.881, 11.8 - 0.572, 0.576],
    scout: [p.scout.id, 40.1 - 0.881, 11.8 + 0.572, -0.576],
  });
  await place(host, { monster: [p.monster.id, 40.1, 11.8, Math.PI] }, false);
  await aimAt(host, 34, 11.8);
  await view.waitForTimeout(700);
  await host.mouse.down({ button: 'left' });
  await host.mouse.up({ button: 'left' });
  await check('공격 범위 안', 'attackRange', (info) =>
    info.find((i) => i.kind === 'range' && i.tag === 'attack'),
  );
  await view.waitForTimeout(1800);
  // 생존자 화면 범위 경계 = 판정값 (팀원이 없는 쪽으로 친다)
  await place(host, { guard: [p.guard.id, 37.6, 11.6, 0.5], scout: [p.scout.id, 36.2, 12.7, 2.2] });
  await place(host, { monster: [p.monster.id, 38.5, 10.6, -Math.PI / 2] }, false);
  await aimAt(host, 38.5, 4);
  await view.waitForTimeout(700);
  const mon = (await lastSnapshot(view))!.monster!;
  await host.mouse.down({ button: 'left' });
  await host.mouse.up({ button: 'left' });
  const rc = await captureBodies(view, [], {
    waitEffect: 'attackRange',
    range: { x: mon.x, y: mon.y, dir: mon.aim, tiles: balance.monster.attack.range },
  });
  console.log(
    `[m10-visual] 러너 화면 범위 경계 ${rc.rangePx?.toFixed(2)}px (판정 ${rc.rangeExpectPx?.toFixed(2)}px)`,
  );
  expect(rc.ok).toBe(true);
  expect(Math.abs(rc.rangePx! - rc.rangeExpectPx!)).toBeLessThanOrEqual(2);
  await view.waitForTimeout(1800);

  // 4) 노랑 부채꼴 (감옥 안 팀원: 갇힌 사람은 발각되지 않는다 → 괴물이 보고 있어도 노랑)
  await sendTest(host, { kind: 'setSurvivor', target: p.guard.id, status: 'imprisoned', hp: 2 });
  await sendTest(host, { kind: 'setSurvivor', target: p.scout.id, status: 'imprisoned', hp: 2 });
  await place(host, {
    guard: [p.guard.id, 23.5, 15.5, 0.6],
    scout: [p.scout.id, 24.5, 16.4, -2.4],
    runner: [p.runner.id, 24, 23.6, -Math.PI / 2],
  });
  // 괴물은 (24,19.6): 두 팀원이 부채꼴 호(5타일)에서 0.8타일 넘게 안쪽이라 경계 선이 바깥 링을 지나지 않는다
  await place(host, { monster: [p.monster.id, 24, 19.6, -Math.PI / 2] }, false);
  await aimAt(host, 24, 14);
  await view.waitForFunction(
    () => {
      const d = window.__DECOY__;
      const m = d?.getLastSnapshot()?.monster;
      return d?.getEffects().cone === true && m?.seesSomeone === false && d.getEffects().coneRed === 0;
    },
    null,
    { timeout: 10_000 },
  );
  await view.waitForTimeout(400);
  const cones = (await view.evaluate(() => window.__DECOY__?.getInfoLayer() ?? [])).filter(
    (i) => i.kind === 'cone',
  );
  expect(cones.map((c) => c.value)).toEqual(['idle']);
  await check('노랑 부채꼴', undefined, (info) => info.find((i) => i.kind === 'cone' && i.tag === 'monster'));

  for (const pl of players) expect(pl.problems).toEqual([]);
  await closeAll(players);
});

/** 품질마다 같은 장면을 열어 러너 화면을 잰다 */
async function qualityRun(
  browser: Parameters<typeof startFourPlayerMatch>[0],
  quality: 'high' | 'medium' | 'low',
): Promise<{
  drawn: string[];
  info: InfoItem[];
  stats: Awaited<ReturnType<typeof captureBodies>>['stats'];
  fxTargets: { layer: string; effects: string[] }[];
  features: Record<string, unknown>;
  problems: string[];
}> {
  const q = `&quality=${quality}`;
  const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
  const p = roles(players);
  const host = p.monster.page;
  const view = p.runner.page;
  await settle(p.runner);
  await settle(p.monster);
  await place(host, {
    runner: [p.runner.id, 36, 11, 0],
    guard: [p.guard.id, 37.6, 11.6, 0.5],
    scout: [p.scout.id, 36.2, 12.7, 2.2],
  });
  await place(host, { monster: [p.monster.id, 41.5, 12, Math.PI] }, false);
  // 괴물 조준이 정확히 서쪽(π)으로 모일 때까지 (창 크기를 바꾼 직후의 커서 좌표가 어긋나지 않게 다시 겨눈다)
  await host.waitForTimeout(400);
  await aimAt(host, 36, 12);
  await view.waitForFunction(
    () => {
      const a = window.__DECOY__?.getLastSnapshot()?.monster?.aim;
      return a !== undefined && Math.abs(Math.abs(a) - Math.PI) < 0.005;
    },
    null,
    { timeout: 10_000 },
  );
  await view.waitForFunction(() => window.__DECOY__?.getEffects().coneRed === 1, null, { timeout: 10_000 });
  // 스카우트 탐지 마커 (안개 위 정보)
  await p.scout.page.keyboard.press('Space');
  await view.waitForFunction(
    () => (window.__DECOY__?.getDrawn() ?? []).some((d) => d.tag === 'track'),
    null,
    {
      timeout: 10_000,
    },
  );
  await view.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await view.waitForTimeout(500);
  const drawnNow = await view.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
  const bodies = teamBodies(drawnNow, p, balance.survivor.radius);
  const c = await captureBodies(view, bodies, {
    refColors: { guard: ROLE_HEX.guard, scout: ROLE_HEX.scout },
  });
  const roleOf: Record<string, string> = Object.fromEntries(players.map((pl) => [pl.id, pl.role]));
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  const drawn = c.drawn
    .map(
      (d) =>
        `${d.kind}:${d.tag ?? roleOf[d.id] ?? d.id}:${r3(d.x)},${r3(d.y)},${r3(Math.cos(d.face))},${r3(Math.sin(d.face))}`,
    )
    .sort();
  const fxTargets = await view.evaluate(() => window.__DECOY__?.getFxTargets() ?? []);
  const features = await view.evaluate(() => ({ ...window.__DECOY__!.gfx.features }));
  console.log(
    `[m10-visual] ${quality}: ${describeCapture(c)} / 후처리 ${JSON.stringify(fxTargets)} / 입자 ${c.effects.particles} · 먼지 ${c.effects.dust}`,
  );
  const problems = players.flatMap((pl) => pl.problems);
  await closeAll(players);
  return { drawn, info: c.info, stats: c.stats, fxTargets, features, problems };
}

test('품질 높음 · 중간 · 낮음: 정보 레이어 · 그린 엔티티가 같고, 효과가 몸 · 링을 바꾸지 않으며, 후처리는 구조 레이어에만', async ({
  browser,
}) => {
  const low = await qualityRun(browser, 'low');
  const medium = await qualityRun(browser, 'medium');
  const high = await qualityRun(browser, 'high');
  // 정보 동일성 (장식 시간 · 펄스 값이 들어가지 않는다)
  expect(medium.drawn).toEqual(low.drawn);
  expect(high.drawn).toEqual(low.drawn);
  expect(medium.info).toEqual(low.info);
  expect(high.info).toEqual(low.info);
  expect(low.info.some((i) => i.kind === 'cone' && i.value === 'seen')).toBe(true);
  expect(low.info.some((i) => i.kind === 'marker' && i.tag === 'track')).toBe(true);
  // 효과가 정보를 가리지 않음: 높음의 몸/링 대비 ≥ 낮음의 80%, 몸 안 평균색 Lab ΔE(높음, 낮음) ≤ 10
  for (const s of high.stats) {
    const l = low.stats.find((x) => x.name === s.name)!;
    expect(s.contrast, `${s.name} 대비 높음/낮음`).toBeGreaterThanOrEqual(l.contrast * 0.8);
    const dl = Math.hypot(s.mean[0] - l.mean[0], s.mean[1] - l.mean[1], s.mean[2] - l.mean[2]);
    expect(dl, `${s.name} 몸 RGB 차이`).toBeLessThanOrEqual(25);
    expect(deltaE(s.mean, l.mean), `${s.name} 몸 평균색 Lab ΔE(높음, 낮음)`).toBeLessThanOrEqual(10);
  }
  for (const s of medium.stats) {
    const l = low.stats.find((x) => x.name === s.name)!;
    expect(deltaE(s.mean, l.mean), `${s.name} 몸 평균색 Lab ΔE(중간, 낮음)`).toBeLessThanOrEqual(10);
  }
  // 후처리는 구조 레이어(map · glow)에만: 캐릭터 · 마커 · HUD · 화면 효과 레이어에는 없다
  for (const run of [low, medium, high])
    for (const t of run.fxTargets) expect(['map', 'glow']).toContain(t.layer);
  expect(low.fxTargets).toEqual([]);
  // Canvas 렌더러의 높음 · 중간은 구운 비네트 오버레이 (WebGL 전용 postFX · 색보정 없음)
  expect(high.fxTargets).toEqual([{ layer: 'map', effects: ['vignetteOverlay'] }]);
  expect(high.features.vignette).toBe('overlay');
  expect(high.features.colorGrade).toBe(false);
  expect(low.features.vignette).toBe('none');
  expect(high.features.postFxBytes).toBe(0);
  for (const run of [low, medium, high]) expect(run.problems).toEqual([]);
});

test('노출 문양 · 기절 별 · 기절 채도 감소는 다른 캐릭터 몸 · 노출 링을 덮지 않는다 (괴물 화면 · 생존자 화면)', async ({
  browser,
}) => {
  const q = '&quality=low';
  const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
  const p = roles(players);
  const host = p.monster.page;
  const sv = p.scout.page;
  const sr = balance.survivor.radius;
  await settle(p.monster);
  await settle(p.scout);

  // 1) 노출 문양: 스카우트 A가 노출할 때 0.7타일 북쪽 러너 B의 흰 몸에 초록이 없다 (문양은 비어 있는 쪽에서 보인다)
  const A: [number, number] = [39.5, 11.9];
  const B: [number, number] = [39.5, 11.2];
  await place(host, {
    scout: [p.scout.id, A[0], A[1], Math.PI / 2],
    runner: [p.runner.id, B[0], B[1], Math.PI / 2],
    guard: [p.guard.id, 38.2, 12.8, Math.PI / 2],
  });
  await place(host, { monster: [p.monster.id, 42.5, 11.6, Math.PI] }, false);
  await aimAt(host, 36, 11.6);
  await host.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await host.waitForTimeout(900);
  expect((await lastSnapshot(host))!.survivors.length).toBe(3);
  const probes: BodyProbe[] = [
    { name: 'scout', x: A[0], y: A[1], face: Math.PI / 2, r: sr },
    { name: 'runner', x: B[0], y: B[1], face: Math.PI / 2, r: sr },
  ];
  const glyphRef = { scout: ROLE_HEX.scout, runner: ROLE_HEX.runner };
  await sv.keyboard.press('Space');
  const rev = await captureBodies(host, probes, {
    waitEffect: 'reveal',
    refColors: glyphRef,
    markColors: [ROLE_HEX.scout],
  });
  console.log(
    `[m10-visual] 문양 (스카우트 노출, 북쪽 러너): ${describeCapture(rev)} · 러너 몸 안 초록 ${rev.stats[1]?.bodyMarkHits} · 스카우트 둘레 문양 ${rev.stats[0]?.annulusRoleHits}`,
  );
  expect(rev.ok).toBe(true);
  expect(rev.info.filter((i) => i.kind === 'reveal').map((i) => i.tag)).toEqual(['scout']);
  const rB = rev.stats.find((s) => s.name === 'runner')!;
  const rA = rev.stats.find((s) => s.name === 'scout')!;
  expect(rB.whiteFrac, '북쪽 러너 흰 비율').toBeGreaterThanOrEqual(0.9);
  expect(rB.bodyMarkHits, '북쪽 러너 몸 안 스카우트 초록').toBeLessThanOrEqual(2);
  expect(rA.ringRoleHits, '스카우트 테두리').toBeGreaterThan(20);
  expect(rA.annulusRoleHits, '스카우트 문양 (옆 몸과 겹치지 않는 자리)').toBeGreaterThan(8);
  await host.waitForTimeout(balance.survivor.abilityRevealDuration * 1000 + 600);

  // 2) 기절: 괴물 북쪽 0.7타일 러너 B. 밀치기 직후 채도 감소 · 별 위상 여러 개에서 B 몸 · 다른 몸 · 가드 노출 링이 그대로
  const M: [number, number] = [42, 12];
  const NB: [number, number] = [42, 11.3];
  const G: [number, number] = [40.6, 12.3];
  const S: [number, number] = [40.5, 13.6];
  await place(host, {
    runner: [p.runner.id, NB[0], NB[1], Math.PI / 2],
    guard: [p.guard.id, G[0], G[1], 0],
    scout: [p.scout.id, S[0], S[1], Math.PI / 2],
  });
  await place(host, { monster: [p.monster.id, M[0], M[1], Math.PI] }, false);
  await aimAt(host, 36, M[1]);
  // 1)의 스카우트 탐지 표시(괴물 자리 초록 마름모 · 펄스 원, 안개 위 마커)가 끝난 뒤에 잰다.
  // 기준과 훑기 사이에 표시가 꺼지면 북쪽 러너 몸 평균색이 마커만큼 달라진다
  await sv.waitForFunction(
    () => !(window.__DECOY__?.getInfoLayer() ?? []).some((i) => i.kind === 'marker' && i.tag === 'track'),
    null,
    { timeout: (balance.roles.scout.trackDuration + 3) * 1000 },
  );
  // 별 하나가 머리 위 정북에 오는 시각부터 1/3바퀴를 네 위상으로 (spin = tS × 3.85)
  const clocks = [0, 1, 2, 3].map((j) => (((3 * Math.PI) / 2 + (j * 2 * Math.PI) / 9) / 3.85) * 1000);
  for (const pg of [host, sv]) await pg.evaluate((ms) => window.__DECOY__?.freezeClock(ms), clocks[0]!);
  await host.waitForTimeout(1000);
  expect((await lastSnapshot(host))!.survivors.length).toBe(3);
  const mProbes: BodyProbe[] = [
    { name: 'runner', x: NB[0], y: NB[1], face: Math.PI / 2, r: sr },
    { name: 'guard', x: G[0], y: G[1], face: 0, r: sr },
    { name: 'scout', x: S[0], y: S[1], face: Math.PI / 2, r: sr },
  ];
  const sProbes: BodyProbe[] = [{ name: 'runner', x: NB[0], y: NB[1], face: Math.PI / 2, r: sr }];
  const mRef = { runner: ROLE_HEX.runner, guard: ROLE_HEX.guard, scout: ROLE_HEX.scout };
  const sRef = { runner: ROLE_HEX.runner };
  // 기절 전: 같은 별 위상(같은 장식 시계 = 같은 숨쉬기)으로 훑어 위상마다 기준을 둔다
  const mBefore = await captureSweep(host, mProbes, clocks, { refColors: mRef, markColors: [STAR_HEX] });
  const sBefore = await captureSweep(sv, sProbes, clocks, { refColors: sRef, markColors: [STAR_HEX] });
  console.log(`[m10-visual] 기절 전 괴물 화면: ${describeCapture(mBefore[0]!)}`);
  console.log(`[m10-visual] 기절 전 스카우트 화면: ${describeCapture(sBefore[0]!)}`);
  expect(mBefore.every((c) => c.ok) && sBefore.every((c) => c.ok)).toBe(true);
  await host.evaluate((ms) => window.__DECOY__?.freezeClock(ms), clocks[0]!);
  await p.guard.page.keyboard.press('Space');
  // 밀치기 직후(채도 감소 + 별 + 가드 노출)부터 별 위상을 잇달아 훑는다
  const mSweep = await captureSweep(host, mProbes, clocks, {
    waitEffects: ['desaturate', 'stunStars', 'reveal'],
    refColors: mRef,
    markColors: [STAR_HEX],
    firstClockSet: true,
  });
  // 채도 감소 막: 숨은 몸 흰색 · 평균색 그대로, 스카우트 몸/링 대비 ≥ 기절 전 80%, 가드 노출 링 그대로
  const dsat = mSweep[0]!;
  console.log(
    `[m10-visual] 밀치기 직후 괴물 화면 (채도 감소 ${String(dsat.effects.desaturate)}): ${describeCapture(dsat)} · 가드 링 ${dsat.stats[1]?.ringRoleHits}`,
  );
  expect(dsat.ok).toBe(true);
  expect(dsat.effects.desaturate).toBe(true);
  for (const b of dsat.stats) {
    const b0 = mBefore[0]!.stats.find((x) => x.name === b.name)!;
    expect(b.whiteFrac, `${b.name} 흰 비율 (채도 감소 중)`).toBeGreaterThanOrEqual(0.9);
    expect(deltaE(b.mean, b0.mean), `${b.name} 몸 평균색 그대로 (채도 감소 중)`).toBeLessThanOrEqual(3);
    if (b.name === 'guard') expect(b.ringRoleHits, '가드 노출 링 (채도 감소 중)').toBeGreaterThan(20);
    else
      expect(b.contrast, `${b.name} 몸/링 대비 ≥ 기절 전 80% (채도 감소 중)`).toBeGreaterThanOrEqual(
        b0.contrast * 0.8,
      );
  }
  const sSweep = await captureSweep(sv, sProbes, clocks, {
    waitEffect: 'stunStars',
    refColors: sRef,
    markColors: [STAR_HEX],
  });
  const judge = (label: string, sweep: Capture[], before: Capture[]): void => {
    let n = 0;
    sweep.forEach((c, i) => {
      console.log(
        `[m10-visual] 기절 중 ${label} (위상 ${i}, 별 ${String(c.effects.stunStars)}): ${describeCapture(c)} · 러너 몸 안 별색 ${c.stats[0]?.bodyMarkHits}`,
      );
      if (!c.ok || c.effects.stunStars !== true) return;
      n += 1;
      const b = c.stats.find((x) => x.name === 'runner')!;
      const b0 = before[i]!.stats.find((x) => x.name === 'runner')!;
      expect(deltaE(b.mean, b0.mean), `${label} 위상 ${i} 북쪽 러너 몸 평균색 그대로`).toBeLessThanOrEqual(2);
      expect(
        Math.abs(b.whiteFrac - b0.whiteFrac),
        `${label} 위상 ${i} 북쪽 러너 흰 비율 그대로`,
      ).toBeLessThanOrEqual(0.05);
      expect(b.bodyMarkHits, `${label} 위상 ${i} 북쪽 러너 몸 안 별색`).toBeLessThanOrEqual(2);
      // 별이 몸 둘레에 붙어도 몸/링 대비는 R3 하한(3:1) 위
      expect(b.contrast, `${label} 위상 ${i} 북쪽 러너 몸/링 대비`).toBeGreaterThanOrEqual(3);
    });
    expect(n, `${label} 별이 보이는 위상 수`).toBeGreaterThanOrEqual(2);
  };
  judge('괴물 화면', mSweep, mBefore);
  judge('스카우트 화면', sSweep, sBefore);
  for (const pl of players) expect(pl.problems).toEqual([]);
  await closeAll(players);
});

test('부채꼴 가장자리 선 · 괴물 화면 자기 시야 테두리는 캐릭터 접지 그림자 둘레에서도 끊기지 않는다', async ({
  browser,
}) => {
  const q = '&quality=low';
  const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
  const p = roles(players);
  const host = p.monster.page;
  const view = p.runner.page;
  await settle(p.runner);
  await settle(p.monster);
  const M = { x: 42.5, y: 11.6 };
  await place(host, {
    scout: [p.scout.id, 5, 2, 0],
    runner: [p.runner.id, 39.6, 11.6, 0],
    guard: [p.guard.id, 45, 20, 0],
  });
  await place(host, { monster: [p.monster.id, M.x, M.y, Math.PI] }, false);
  await host.waitForTimeout(300);
  await aimAt(host, 36, M.y);
  // 조준이 서쪽(π)으로 자리 잡은 뒤에 가장자리를 잡는다 (순간이동 직후 예측 위치가 늦으면 잠깐 다른 쪽을 본다)
  const AIM = Math.PI;
  const aimed = (dir: number | null | undefined): boolean =>
    dir !== null &&
    dir !== undefined &&
    Math.abs(Math.atan2(Math.sin(dir - AIM), Math.cos(dir - AIM))) < 0.01;
  await view.waitForFunction(
    (aim) => {
      const d = window.__DECOY__;
      const c = d?.getInfoLayer().find((i) => i.kind === 'cone' && i.tag === 'monster');
      if (!d || !c || c.dir === null || d.getEffects().coneRed !== 1) return false;
      return Math.abs(Math.atan2(Math.sin(c.dir - aim), Math.cos(c.dir - aim))) < 0.01;
    },
    AIM,
    { timeout: 10_000 },
  );
  for (const pg of [view, host]) await pg.evaluate(() => window.__DECOY__?.freezeClock(1000));
  await view.waitForTimeout(400);
  const cone = (await view.evaluate(() => window.__DECOY__?.getInfoLayer() ?? [])).find(
    (i) => i.kind === 'cone',
  )!;
  expect(aimed(cone.dir), `괴물 조준 ${cone.dir}`).toBe(true);
  // 남서쪽 가장자리 (트인 바닥): 조준 − arc/2
  const dir = cone.dir! - cone.arc! / 2;
  const u = { x: Math.cos(dir), y: Math.sin(dir) };
  // 부채꼴 밖 법선 (조준 방향과 반대쪽)
  let nrm = { x: -u.y, y: u.x };
  if (nrm.x * Math.cos(cone.dir!) + nrm.y * Math.sin(cone.dir!) > 0) nrm = { x: -nrm.x, y: -nrm.y };
  const D = 2.5;
  const foot = { x: cone.x + u.x * D, y: cone.y + u.y * D };
  const edgeLine = {
    ax: cone.x + u.x * 1.6,
    ay: cone.y + u.y * 1.6,
    bx: cone.x + u.x * 3.4,
    by: cone.y + u.y * 3.4,
    stepTiles: 0.02,
    perpPx: 2,
  };
  const judge = (label: string, c: Capture): void => {
    const s = c.lines[0]!.samples.map((q) => ({ d: q.d + 1.6, v: q.v }));
    const far = s
      .filter((q) => Math.abs(q.d - D) > 0.8)
      .map((q) => q.v)
      .sort((a, b) => a - b);
    const farMed = far[Math.floor(far.length / 2)]!;
    const near = s
      .filter((q) => Math.abs(q.d - D) <= 0.5)
      .map((q) => q.v)
      .sort((a, b) => a - b);
    // 캐릭터 ±0.5타일 안 하위 10% (한두 표본 잡음은 빼고, 그림자에 묻힌 구간이 있으면 잡힌다)
    const nearLow = near[Math.floor(near.length * 0.1)]!;
    console.log(
      `[m10-visual] ${label}: 먼 곳 중앙값 ${farMed} · 캐릭터 ±0.5타일 안 하위 10% ${nearLow} · 최소 ${near[0]}`,
    );
    expect(farMed, `${label} 먼 곳 선`).toBeGreaterThan(40);
    expect(nearLow, `${label} 캐릭터 둘레 선`).toBeGreaterThanOrEqual(farMed * 0.8);
  };
  // 1) 생존자 화면: 가장자리 바깥 0.45타일 팀원 (가드)
  await sendTest(host, {
    kind: 'teleport',
    target: p.guard.id,
    x: foot.x + nrm.x * 0.45,
    y: foot.y + nrm.y * 0.45,
    face: 0,
  });
  await view.waitForTimeout(600);
  const c1 = await captureBodies(view, [], { lines: [{ name: 'edge', ...edgeLine, metric: 'red' }] });
  expect(c1.ok).toBe(true);
  const c1Cone = c1.info.find((i) => i.kind === 'cone');
  expect(c1Cone?.value).toBe('seen');
  // 잰 프레임의 부채꼴이 선을 정한 부채꼴과 같다 (꼭짓점 · 방향 · 폭)
  expect([c1Cone?.x, c1Cone?.y, c1Cone?.arc]).toEqual([cone.x, cone.y, cone.arc]);
  expect(aimed(c1Cone?.dir), `잰 프레임 괴물 조준 ${c1Cone?.dir}`).toBe(true);
  judge('러너 화면 빨강 부채꼴 가장자리 (바깥 0.45타일 팀원)', c1);
  // 2) 괴물 화면: 가장자리 안쪽 0.45타일 생존자 (보인다)의 그림자 위로 자기 시야 테두리 (노랑)
  await sendTest(host, {
    kind: 'teleport',
    target: p.guard.id,
    x: foot.x - nrm.x * 0.45,
    y: foot.y - nrm.y * 0.45,
    face: 0,
  });
  await host.waitForTimeout(600);
  const c2 = await captureBodies(host, [], { lines: [{ name: 'outline', ...edgeLine, metric: 'warm' }] });
  expect(c2.ok).toBe(true);
  expect(c2.drawn.filter((d) => d.kind === 'survivor').length).toBe(2);
  const c2Cone = c2.info.find((i) => i.kind === 'cone' && i.tag === 'self');
  expect([c2Cone?.x, c2Cone?.y]).toEqual([cone.x, cone.y]);
  expect(aimed(c2Cone?.dir), `괴물 화면 조준 ${c2Cone?.dir}`).toBe(true);
  judge('괴물 화면 자기 시야 테두리 (안쪽 0.45타일 생존자)', c2);
  for (const pl of players) expect(pl.problems).toEqual([]);
  await closeAll(players);
});

test('가드 밀치기 사거리: 거리 안이어도 철창이 가로막으면 in이 아니라 blocked (서버는 빗나감)', async ({
  browser,
}) => {
  const q = '&quality=low';
  const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
  const p = roles(players);
  const host = p.monster.page;
  const view = p.guard.page;
  await settle(p.guard);
  await place(host, {
    runner: [p.runner.id, 5, 2, 0],
    scout: [p.scout.id, 45, 2, 0],
    guard: [p.guard.id, 21.55, 14.5, 0],
    monster: [p.monster.id, 23.5, 14.5, Math.PI],
  });
  await view.waitForTimeout(1200);
  const shove = async (): Promise<InfoItem | undefined> =>
    (await view.evaluate(() => window.__DECOY__?.getInfoLayer() ?? [])).find(
      (i) => i.kind === 'range' && i.tag === 'shove',
    );
  const blocked = await shove();
  console.log(`[m10-visual] 철창 너머 괴물 (거리 1.95): ${JSON.stringify(blocked)}`);
  expect(blocked?.value).toBe('blocked');
  // 막힘 × 표시는 가로막은 철창 칸 위에 보인다 (괴물이 원 둘레에 있어도 몸에 가려지지 않는다):
  // 가드 → 괴물 선분이 처음 지나는 타격 차단 칸 구간의 가운데 둘레에 가드 보라 픽셀
  const G = { x: 21.55, y: 14.5 };
  const MON = { x: 23.5, y: 14.5 };
  const run: number[] = [];
  for (let t = 0; t <= 1; t += 0.005) {
    const x = G.x + (MON.x - G.x) * t;
    const y = G.y + (MON.y - G.y) * t;
    if (blocksStrike(Math.floor(x), Math.floor(y))) run.push(t);
    else if (run.length > 0) break;
  }
  expect(run.length, '가드 → 괴물 선분 위 철창').toBeGreaterThan(0);
  const tm = (run[0]! + run[run.length - 1]!) / 2;
  const at = { x: G.x + (MON.x - G.x) * tm, y: G.y + (MON.y - G.y) * tm };
  const xMark = await captureBodies(
    view,
    [{ name: 'mark', x: at.x, y: at.y, face: 0, r: balance.survivor.radius }],
    {
      markColors: [ROLE_HEX.guard],
    },
  );
  console.log(
    `[m10-visual] 막힘 × (${at.x.toFixed(2)}, ${at.y.toFixed(2)}) 둘레 가드 보라 ${xMark.stats[0]?.bodyMarkHits}`,
  );
  expect(xMark.stats[0]!.bodyMarkHits, '철창 위 × 표시').toBeGreaterThanOrEqual(8);
  await view.keyboard.press('Space');
  await view.waitForTimeout(400);
  expect((await lastSnapshot(view))!.monster?.stunned).toBe(false);
  // 트인 바닥 거리 안 = in
  await place(host, { guard: [p.guard.id, 38, 12, 0], monster: [p.monster.id, 39.9, 12, Math.PI] });
  await view.waitForTimeout(800);
  expect((await shove())?.value).toBe('in');
  for (const pl of players) expect(pl.problems).toEqual([]);
  await closeAll(players);
});

test('프레임이 공격 준비 시간(0.4초)보다 느려도 생존자 화면에 괴물 공격 예고가 한 번은 그려진다', async ({
  browser,
}) => {
  const q = '&quality=low';
  const { players } = await startFourPlayerMatch(browser, undefined, [q, q, q, q]);
  const p = roles(players);
  const host = p.monster.page;
  const view = p.guard.page;
  await settle(p.guard);
  await place(host, {
    runner: [p.runner.id, 5, 2, 0],
    scout: [p.scout.id, 45, 2, 0],
    guard: [p.guard.id, 30, 19.5, 0],
  });
  await sendTest(host, { kind: 'teleport', target: p.monster.id, x: 32, y: 19.5, face: Math.PI / 2 });
  await aimAt(host, 32, 26);
  await view.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.monster ?? null) !== null, null, {
    timeout: 10_000,
  });
  // 괴물 시작 대기(5초)가 끝나야 공격할 수 있다
  await host.waitForFunction(() => (window.__DECOY__?.getLastSnapshot()?.world.monsterWait ?? 1) <= 0, null, {
    timeout: 15_000,
  });
  // 느린 기기 흉내: 가드 화면의 프레임마다 600ms를 쓴다 (준비 0.4초가 프레임 사이로 빠질 수 있다)
  await view.evaluate(() => {
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      orig((t) => {
        const end = performance.now() + 600;
        while (performance.now() < end) {
          // 바쁜 대기
        }
        cb(t);
      });
  });
  let seen = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await host.mouse.down({ button: 'left' });
    await host.mouse.up({ button: 'left' });
    // 프레임마다 그린 정보 레이어를 본다 (느린 프레임 4개 ≈ 2.4초)
    const hit = await view.evaluate(async () => {
      for (let i = 0; i < 4; i += 1) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if ((window.__DECOY__?.getInfoLayer() ?? []).some((it) => it.tag === 'attack')) return true;
      }
      return false;
    });
    if (hit) seen += 1;
    await host.waitForTimeout(1700);
  }
  console.log(`[m10-visual] 느린 프레임(600ms)에서 공격 예고를 본 횟수 ${seen}/3`);
  expect(seen, '공격 준비 3번을 모두 한 번 이상 그림').toBe(3);
  for (const pl of players) expect(pl.problems).toEqual([]);
  await closeAll(players);
});
