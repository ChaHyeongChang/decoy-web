// M10b 캐릭터 · 효과 (Canvas 렌더러 · 소프트웨어 합성 · 1920×1080 배율 1). VISUAL_SPEC 0장 불변 항목을 픽셀로 지킨다:
//  - 괴물 화면 흰색 위장: 부채꼴 · 근접 원 · 공격 범위 안에서도 생존자 몸 원판은 무채색 · 밝음, 역할 4색과 멀다.
//    그림 키는 모두 'survivor-hidden'이고, 능력 노출 중인 한 명만 1초 동안 역할색 테두리 + 머리 위 문양
//  - 생존자 화면 역할색 유지: 빛 바닥 · 노랑 · 빨강 부채꼴 · 공격 범위 안에서 팀원 몸 평균색 ΔE ≤ 15, 몸/바깥 링 대비 3:1
//  - 범위 = 판정값: 공격 준비 범위 경계 반지름이 attack.range × 타일 화면 크기 ±2px
//  - 품질 높음 · 중간 · 낮음의 그린 엔티티 · 정보 레이어가 같고, 효과가 몸 · 링을 바꾸지 않으며, 후처리는 구조 레이어에만
// 픽셀은 Phaser가 그린 바로 그 프레임을 페이지 안에서 읽는다 (visualProbe.ts).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { validateBalance, type DrawnEntity, type InfoItem, type Role } from '@decoy/shared';
import { closeAll, lastSnapshot, sendTest, startFourPlayerMatch, type Player } from './helpers';
import { captureBodies, describe as describeCapture, type BodyProbe } from './visualProbe';

const ROLE_HEX = { runner: 0x3b82f6, guard: 0xa855f7, scout: 0x22c55e, monster: 0xef4444 } as const;

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

test('괴물 화면 흰색 위장: 부채꼴 · 근접 원 · 공격 범위 안에서도 흰 공통 실루엣, 능력 노출 1초만 역할색 테두리 + 문양', async ({
  browser,
}) => {
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

  // 1) 부채꼴 · 근접 원 안
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
  // 노출 창(abilityRevealDuration) 뒤에는 사라진다
  await host.waitForTimeout(balance.survivor.abilityRevealDuration * 1000 + 400);
  const after = await captureBodies(host, bodies, { refColors: ref });
  expect(after.info.filter((i) => i.kind === 'reveal')).toEqual([]);
  for (const s of after.stats) expect(s.ringRoleHits, `${s.name} 노출 끝`).toBeLessThanOrEqual(2);

  for (const pl of players) expect(pl.problems).toEqual([]);
  await closeAll(players);
});

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
  const check = async (label: string, waitEffect?: string): Promise<void> => {
    const drawn = await view.evaluate(() => window.__DECOY__?.getDrawn() ?? []);
    const bodies = teamBodies(drawn, p, sr);
    expect(bodies.length, label).toBe(2);
    const c = await captureBodies(view, bodies, {
      refColors: ref,
      ...(waitEffect ? { waitEffect } : {}),
    });
    console.log(`[m10-visual] 러너 화면 (${label}): ${describeCapture(c)}`);
    expect(c.ok, label).toBe(true);
    for (const s of c.stats) {
      expect(s.deltaE!, `${label} ${s.name} 역할색 ΔE`).toBeLessThanOrEqual(15);
      expect(s.contrast, `${label} ${s.name} 몸/링 대비`).toBeGreaterThanOrEqual(3);
    }
  };

  // 1) 빛 바닥 (괴물은 멀리)
  await place(host, {
    runner: [p.runner.id, 36, 11, 0],
    guard: [p.guard.id, 37.6, 11.6, 0.5],
    scout: [p.scout.id, 36.2, 12.7, 2.2],
    monster: [p.monster.id, 5, 28, 0],
  });
  await view.waitForTimeout(900);
  await check('빛 바닥');

  // 2) 빨강 부채꼴 (괴물이 가드 · 스카우트를 본다)
  await place(host, { monster: [p.monster.id, 41.5, 12, Math.PI] }, false);
  await aimAt(host, 36, 12);
  await view.waitForFunction(() => window.__DECOY__?.getEffects().coneRed === 1, null, { timeout: 10_000 });
  await view.waitForTimeout(300);
  await check('빨강 부채꼴');

  // 3) 공격 범위 안 (괴물 바로 앞, 누른 동안)
  await place(host, {
    guard: [p.guard.id, 39.05, 11.25, 0.4],
    scout: [p.scout.id, 39.05, 12.3, -0.4],
  });
  await place(host, { monster: [p.monster.id, 40.1, 11.8, Math.PI] }, false);
  await aimAt(host, 34, 11.8);
  await view.waitForTimeout(700);
  await host.mouse.down({ button: 'left' });
  await host.mouse.up({ button: 'left' });
  await check('공격 범위 안', 'attackRange');
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
  await place(host, { monster: [p.monster.id, 24, 20, -Math.PI / 2] }, false);
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
  await check('노랑 부채꼴');

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
  await aimAt(host, 36, 12);
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
    .map((d) => `${d.kind}:${d.tag ?? roleOf[d.id] ?? d.id}:${r3(d.x)},${r3(d.y)},${r3(d.face)}`)
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
  // 효과가 정보를 가리지 않음: 높음의 몸/링 대비 ≥ 낮음의 80%, 몸 안 평균색 차이 ΔE ≤ 10
  for (const s of high.stats) {
    const l = low.stats.find((x) => x.name === s.name)!;
    expect(s.contrast, `${s.name} 대비 높음/낮음`).toBeGreaterThanOrEqual(l.contrast * 0.8);
    const dl = Math.hypot(s.mean[0] - l.mean[0], s.mean[1] - l.mean[1], s.mean[2] - l.mean[2]);
    expect(dl, `${s.name} 몸 RGB 차이`).toBeLessThanOrEqual(25);
    expect(Math.abs(s.deltaE! - l.deltaE!), `${s.name} ΔE 차이`).toBeLessThanOrEqual(10);
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
  for (const run of [low, medium, high]) expect(run.problems).toEqual([]);
});
