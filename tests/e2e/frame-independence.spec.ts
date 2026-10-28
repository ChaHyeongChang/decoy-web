// 렌더링 최적화: 프레임 독립성. 120fps에서도 보간 · 애니메이션 · 효과 시간이 60fps와 같아야 한다.
//  - 가상 시계(tests/helpers/virtualClock.ts)로 같은 시드의 '봇과 연습'을 60Hz · 120Hz 두 번 돌린다 (Canvas 렌더러, 품질 높음).
//    시간 · 난수 · 타이머가 모두 가상이라 기기 안 판(시뮬레이션)은 두 번이 비트까지 같다 — 이것을 먼저 확인한다(getTruth)
//  - 50ms(60Hz 3프레임 = 120Hz 6프레임)마다 같은 가상 시각에서 그림 상태를 모아 비교한다: 그린 엔티티 · 정보 레이어 · 연출 ·
//    내 그린 자리 · 연출 상태(getAnimState: 시야 모드 보간 · 걷기 위상 · 자세 섞기 · 안개 갱신 시각 · 부채꼴 색 · 잔상 격자 시각과
//    알파 · 입자) · 배너 글. 허용 오차는 위치 · 알파 · 보간 값 1e-3(r3 반올림 한 칸), 글 · 수 · 그림 이름은 정확히 같아야 한다.
//    두 번이 각자 hz대로 그렸는지(그린 프레임 수 = hz × 시간, 120Hz = 60Hz × 2)도 본다
//  - 판 시작(역할을 누른 순간 = 판 장면을 만든 순간)의 60Hz 프레임 안 위치를 두 가지로 한다. 기기 안 서버 틱 · 스냅샷 · 보간 경계 ·
//    입력 틱이 모두 그 위치에 온다. 10ms 자리면 120Hz도 같은 프레임에 보지만 '바뀐 프레임 전체를 쌓는' 종류의 차이(부채꼴 색 ·
//    시야 모드 보간 · 걷기)가, 4ms 자리면 120Hz가 한 프레임(8.33ms) 먼저 보므로 '처음 본 프레임 시각을 잡는' 종류의 차이(공격 준비
//    채움 · 돌진 잔상 시작 · 페이드 · 입자 태어난 시각 · 첫 프레임에 정하던 안개 격자)가 드러난다
//  - 괴물(생존자 화면) · 생존자(괴물 화면) 두 경우 × 두 위치. 콘솔 에러 · 경고 0
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { AnimDebug, DrawnEntity, InfoItem } from '@decoy/shared';
import type { TruthFrame } from '@decoy/shared/sim';
import { installVirtualClock } from '../helpers/virtualClock';
import { newPlayerPage, waitPrefetched } from './helpers';

/** 품질 높음: 장식(발먼지 · 빛 속 먼지 · 걷기 위상 끊지 않음)까지 비교한다 */
// 따라가는 카메라: 마우스 조준은 커서가 움직인 순간의 화면(창 자리)에 달려 있어 확대 화면에서는 프레임 속도마다 조금 다를 수
// 있다(따라가기 감쇠의 프레임 시각). 이 시험은 같은 입력이면 시뮬레이션 · 연출이 같은지를 보므로 맵 전체 고정 화면(?cam=1)
const QUERY = '/?debug=hook&renderer=canvas&quality=high&cam=1';
const SEED = 20_261_013;
/** 두 페이지를 맞추는 가상 시각 (50ms 배수 = 60 · 120Hz 공통 프레임). 로딩(펌프)이 이보다 먼저 끝나야 한다 */
const SYNC_AT = 30_000;
const CHUNK = 50;
/** 위치 · 알파 · 보간 값 허용 오차 (r3 반올림 경계 한 칸 포함) */
const TOL = 1e-3 + 1e-9;

interface Sample {
  t: number;
  truth: TruthFrame | null;
  drawn: DrawnEntity[];
  info: InfoItem[];
  fx: Record<string, number | boolean>;
  me: { x: number; y: number; face: number } | null;
  anim: AnimDebug | null;
  banners: string[];
}

interface Run {
  context: BrowserContext;
  page: Page;
  problems: string[];
}

async function openRun(browser: Browser, hz: number): Promise<Run> {
  const { context, page, problems } = await newPlayerPage(browser);
  await context.addInitScript(installVirtualClock, { seed: SEED, hz });
  // 서버 소켓은 막는다 (진짜 입출력이 가상 시각 어디에 끼는지 두 번이 달라지지 않게, 연습은 서버를 쓰지 않는다)
  await page.routeWebSocket(/\/ws$/, (ws) => ws.close({ code: 1011, reason: 'blocked' }));
  await page.goto(QUERY);
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.fonts.ready === true)).toBe(true);
  await waitPrefetched(page);
  // 오프라인으로 두면 다시 연결하지 않는다: 멈춘 뒤 진짜 입출력(소켓 닫힘)이 가상 시각 어디에도 끼지 않는다
  await context.setOffline(true);
  await page.waitForTimeout(300);
  const at = await page.evaluate(async (t) => {
    const c = window.__VCLOCK__;
    if (!c) throw new Error('가상 시계 없음');
    await c.pump(false);
    const before = c.now();
    await c.advanceTo(t);
    // 품질 자동 하향을 멈춘다 (목표와 같은 fps)
    window.__DECOY__?.injectFps(c.hz);
    return before;
  }, SYNC_AT);
  expect(at, '로딩이 맞추는 시각 전에 끝나야 한다').toBeLessThan(SYNC_AT);
  return { context, page, problems };
}

async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((d) => window.__VCLOCK__?.advance(d), ms);
}

/** 멈춘 동안 DOM 클릭 (Playwright 동작성 검사 없이) */
async function domClick(page: Page, testId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`없음: ${id}`);
    el.click();
  }, testId);
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const d = window.__DECOY__;
    if (!d) throw new Error('디버그 훅 없음');
    return {
      t: performance.now(),
      truth: d.getTruth(),
      drawn: d.getDrawn().map((e) => ({ ...e })),
      info: d.getInfoLayer(),
      fx: d.getEffects(),
      me: d.getRenderPos(),
      anim: d.getAnimState(),
      banners: d.getBanners(),
    };
  });
}

/** 50ms 경계에서 하는 조작 (두 번 똑같이) */
type Action = (page: Page, truth: TruthFrame | null) => Promise<void>;

const keyDown =
  (...keys: string[]): Action =>
  async (page) => {
    for (const k of keys) await page.keyboard.down(k);
  };
const keyUp =
  (...keys: string[]): Action =>
  async (page) => {
    for (const k of keys) await page.keyboard.up(k);
  };
const keyPress =
  (key: string): Action =>
  async (page) => {
    await page.keyboard.press(key);
  };
const click =
  (button: 'left' | 'right' = 'left'): Action =>
  async (page) => {
    await page.mouse.down({ button });
    await page.mouse.up({ button });
  };
const all =
  (...list: Action[]): Action =>
  async (page, truth) => {
    for (const a of list) await a(page, truth);
  };

/** 판 시작(역할을 누르는 순간)의 60Hz 프레임 안 위치. 연출마다 두 위치 모두에서 비교한다 */
const PHASES = [
  { name: '판 시작이 60Hz 프레임 안 10ms 자리', offset: 10 },
  { name: '판 시작이 60Hz 프레임 안 4ms 자리', offset: 4 },
] as const;

async function teleport(page: Page, target: string, x: number, y: number, face: number): Promise<void> {
  await page.evaluate(
    ([id, tx, ty, f]) => window.__DECOY__?.sendTest({ kind: 'teleport', target: id, x: tx, y: ty, face: f }),
    [target, x, y, face] as const,
  );
}

function playerOf(truth: TruthFrame | null, pred: (p: TruthFrame['players'][number]) => boolean) {
  const p = truth?.players.find(pred);
  if (!p) throw new Error('플레이어 없음');
  return p;
}

/** 마우스를 타일 위로 (Phaser 포인터 · 괴물 조준) */
async function mouseTo(page: Page, x: number, y: number): Promise<void> {
  const c = await page.evaluate(([tx, ty]) => window.__DECOY__?.tileToClient(tx, ty) ?? null, [
    x,
    y,
  ] as const);
  if (!c) throw new Error('tileToClient 없음');
  await page.mouse.move(c.x, c.y);
}

/** 한 번 돌리기: 역할을 골라 판을 시작하고 chunks칸 동안 50ms마다 모은다 */
async function runScenario(
  browser: Browser,
  hz: number,
  role: 'runner' | 'monster',
  chunks: number,
  makeActions: () => ReadonlyMap<number, Action>,
  phaseOffset: number,
): Promise<Sample[]> {
  const actions = makeActions();
  const run = await openRun(browser, hz);
  const { page } = run;
  await domClick(page, 'practice');
  await advance(page, 500);
  // 60Hz 한 프레임 안 phaseOffset ms 자리에서 누른다 (판 장면은 판 시작 메시지를 받은 그 순간에 생긴다).
  // 누르기 바로 전에 난수를 다시 시작한다 (연습 판 시드 = Math.random)
  await advance(page, phaseOffset);
  await page.evaluate(
    ([seed, id]) => {
      window.__VCLOCK__?.reseed(seed);
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click();
    },
    [SEED, `practice-role-${role}`] as const,
  );
  await advance(page, CHUNK - phaseOffset);
  expect(await page.evaluate(() => window.__DECOY__?.transport)).toBe('local');
  const out: Sample[] = [];
  for (let i = 0; i < chunks; i += 1) {
    const s = await sample(page);
    out.push(s);
    const act = actions.get(i);
    if (act) await act(page, s.truth);
    await advance(page, CHUNK);
  }
  expect(run.problems, `${hz}Hz 콘솔 에러 · 경고`).toEqual([]);
  // 이 빠르기로 정말 그렸다: 판 중 그린 프레임 수 = hz × 지난 가상 시간 (제한기 · 판 밖 30fps가 120Hz를 60 · 30으로 묶으면
  // 같은 시각 비교는 그대로 통과하므로 따로 본다. injectFps는 측정 fps를 덮어써 getFrameStats로는 알 수 없다)
  const first = out[0];
  const last = out[out.length - 1];
  if (!first?.anim || !last?.anim) throw new Error('연출 상태 없음');
  const expected = (hz * (last.t - first.t)) / 1000;
  expect(
    Math.abs(last.anim.frames - first.anim.frames - expected),
    `${hz}Hz 그린 프레임 수`,
  ).toBeLessThanOrEqual(1);
  await run.context.close();
  return out;
}

// ───────────── 비교 ─────────────

/** 각도 차이 (−π, π] */
function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** 값 둘을 비교해 다른 곳을 problems에 적는다 (숫자는 tol, 각도 이름이면 감싼 차이, 나머지는 정확히) */
function diff(path: string, a: unknown, b: unknown, problems: string[], tol: (path: string) => number): void {
  if (problems.length > 40) return;
  if (typeof a === 'number' && typeof b === 'number') {
    const t = tol(path);
    const d = /(face|dir|aim|phase)$/.test(path) ? angDiff(a, b) : a - b;
    if (!(Math.abs(d) <= t) && !(Number.isNaN(a) && Number.isNaN(b)))
      problems.push(`${path}: 60Hz ${a} · 120Hz ${b} (차이 ${d})`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      problems.push(
        `${path}: 길이 60Hz ${a.length} · 120Hz ${b.length} ${JSON.stringify(a).slice(0, 300)} | ${JSON.stringify(b).slice(0, 300)}`,
      );
      return;
    }
    a.forEach((x, i) => diff(`${path}[${i}]`, x, b[i], problems, tol));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) {
      problems.push(`${path}: 키 60Hz [${ka.join()}] · 120Hz [${kb.join()}]`);
      return;
    }
    for (const k of ka)
      diff(
        `${path}.${k}`,
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        problems,
        tol,
      );
    return;
  }
  if (a !== b) problems.push(`${path}: 60Hz ${JSON.stringify(a)} · 120Hz ${JSON.stringify(b)}`);
}

/** 기기 안 판(정답)이 두 번 모두 같다: 이것이 성립해야 그림 비교가 뜻이 있다 */
function compareTruth(a: Sample[], b: Sample[]): void {
  const problems: string[] = [];
  a.forEach((s, i) => diff(`[${i}] t=${s.t} truth`, s.truth, b[i]?.truth, problems, () => 0));
  expect(problems, '두 번 돌린 판이 같아야 한다 (가상 시계 · 시드)').toEqual([]);
}

/** 그림 상태 비교 */
function compareRender(a: Sample[], b: Sample[]): string[] {
  const problems: string[] = [];
  const tol = (): number => TOL;
  a.forEach((s, i) => {
    const o = b[i];
    if (!o) return;
    if (s.t !== o.t) problems.push(`[${i}] 시각 60Hz ${s.t} · 120Hz ${o.t}`);
    const at = `[${i}] t=${(s.t - SYNC_AT).toFixed(1)}`;
    diff(`${at} drawn`, s.drawn, o.drawn, problems, tol);
    diff(`${at} info`, s.info, o.info, problems, tol);
    diff(`${at} fx`, s.fx, o.fx, problems, tol);
    diff(`${at} me`, s.me, o.me, problems, tol);
    // 그린 프레임 수는 빠르기마다 다르다 (runScenario가 hz에 맞는지 따로 본다)
    diff(`${at} anim`, s.anim && { ...s.anim, frames: 0 }, o.anim && { ...o.anim, frames: 0 }, problems, tol);
    diff(`${at} banners`, s.banners, o.banners, problems, tol);
  });
  return problems;
}

/** 두 번 돌려 비교. 뒤 시험이 연출이 실제로 일어났는지 보도록 60Hz 표본을 돌려준다 */
async function bothRates(
  browser: Browser,
  role: 'runner' | 'monster',
  chunks: number,
  makeActions: () => ReadonlyMap<number, Action>,
  phaseOffset: number,
): Promise<Sample[]> {
  const at60 = await runScenario(browser, 60, role, chunks, makeActions, phaseOffset);
  const at120 = await runScenario(browser, 120, role, chunks, makeActions, phaseOffset);
  expect(at120.length).toBe(at60.length);
  // 120Hz는 같은 시간에 60Hz의 두 배를 그렸다
  const drawn = (r: Sample[]): number => (r[r.length - 1]?.anim?.frames ?? 0) - (r[0]?.anim?.frames ?? 0);
  expect(drawn(at120)).toBe(drawn(at60) * 2);
  compareTruth(at60, at120);
  expect(compareRender(at60, at120), '60Hz · 120Hz 같은 시각의 그림 상태').toEqual([]);
  return at60;
}

const count = (samples: Sample[], pred: (s: Sample) => boolean): number => samples.filter(pred).length;
const num = (v: number | boolean | undefined): number => (typeof v === 'number' ? v : 0);

/** 넓게 트인 곳 (오른쪽 방, 타일 좌표): 질주자를 여기 두고 괴물을 남쪽에 놓는다 (돌진 길이 벽에 막히지 않게) */
const OPEN_SPOT = { x: 40.5, y: 12.5 };

/**
 * 생존자(질주자): 걷기 · 팀원 보간 · 질주. 괴물 대기(5초)가 끝나면 나를 트인 곳으로 옮기고 괴물 봇을 3타일 남쪽에 묶어 두고
 * 나를 보게 · 등지게 번갈아 돌려 부채꼴 색이 노랑 ↔ 빨강으로 몇 번 바뀌게 한 뒤, 4.3타일 남쪽에 풀어 놓는다
 * (돌진 거리 안: 봇이 돌진 · 공격 → 피격 · 수감)
 */
function runnerScript(): () => ReadonlyMap<number, Action> {
  return () => {
    const place =
      (dist: number, facing: 'me' | 'away', frozen: boolean): Action =>
      async (page, truth) => {
        const mon = playerOf(truth, (p) => p.role === 'monster');
        await teleport(
          page,
          mon.id,
          OPEN_SPOT.x,
          OPEN_SPOT.y + dist,
          facing === 'me' ? -Math.PI / 2 : Math.PI / 2,
        );
        if (frozen)
          await page.evaluate(
            (id) => window.__DECOY__?.sendTest({ kind: 'freeze', target: id, frozen: true }),
            mon.id,
          );
      };
    const a = new Map<number, Action>();
    a.set(0, keyDown('KeyD'));
    a.set(12, keyDown('KeyS'));
    a.set(26, keyUp('KeyD'));
    a.set(40, all(keyUp('KeyS'), keyDown('KeyA')));
    a.set(62, all(keyUp('KeyA'), keyDown('KeyW')));
    a.set(84, keyPress('Space'));
    a.set(
      104,
      all(keyUp('KeyW'), async (page, truth) => {
        const me = playerOf(truth, (p) => p.role === 'runner');
        await teleport(page, me.id, OPEN_SPOT.x, OPEN_SPOT.y, -Math.PI / 2);
      }),
    );
    a.set(108, place(3, 'me', true));
    a.set(114, place(3, 'away', true));
    a.set(124, place(3, 'me', true));
    a.set(128, place(3, 'away', true));
    a.set(136, place(4.3, 'me', false));
    return a;
  };
}

/** 괴물: 대기(5초) 뒤 포효 · 시야 모드 전환 · 돌진, 질주자 봇을 앞에 옮겨 공격 두 번, 모드 되돌리기 · 걷기 */
function monsterScript(): () => ReadonlyMap<number, Action> {
  return () => {
    const a = new Map<number, Action>();
    a.set(102, keyPress('KeyQ'));
    a.set(106, click('right'));
    a.set(110, keyPress('ShiftLeft'));
    a.set(124, async (page, truth) => {
      // 질주자 봇을 내 앞 1.5타일로 옮기고 마우스로 겨눈다
      const me = playerOf(truth, (p) => p.role === 'monster');
      const target = playerOf(truth, (p) => p.role === 'runner');
      const tx = me.x + Math.cos(me.face) * 1.5;
      const ty = me.y + Math.sin(me.face) * 1.5;
      await teleport(page, target.id, tx, ty, me.face + Math.PI);
      await mouseTo(page, tx, ty);
    });
    a.set(126, click());
    a.set(146, click());
    a.set(160, click('right'));
    a.set(164, keyDown('KeyW'));
    a.set(180, keyUp('KeyW'));
    return a;
  };
}

/** 서로 다른 안개 · 시야 갱신 시각 수 (갱신 시계가 실제로 돌았다) */
const fogTimes = (samples: Sample[]): number => new Set(samples.map((x) => x.anim?.fogAt ?? null)).size;

for (const phase of PHASES) {
  test(`생존자(질주자) · ${phase.name}: 60Hz · 120Hz 같은 시각의 보간 · 걷기 · 안개 갱신 · 부채꼴 색 · 공격 준비 · 피격 · 수감 연출이 같다`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = await bothRates(browser, 'runner', 220, runnerScript(), phase.offset);
    // 비교한 연출이 실제로 일어났다 (아무 일 없는 화면을 비교하지 않게): 걷기 · 안개 갱신 · 부채꼴 색 바뀜 · 공격 준비 · 피격 · 수감
    expect(count(s, (x) => x.anim !== null && Object.keys(x.anim.gait).length >= 3)).toBeGreaterThan(150);
    expect(fogTimes(s)).toBeGreaterThan(200);
    expect(count(s, (x) => x.fx.cone === true)).toBeGreaterThan(5);
    expect(count(s, (x) => num(x.fx.coneRed) > 0 && num(x.fx.coneRed) < 1)).toBeGreaterThanOrEqual(8);
    expect(count(s, (x) => x.fx.attackRange === true && num(x.fx.attackFill) < 1)).toBeGreaterThan(2);
    expect(count(s, (x) => num(x.fx.hitFlash) > 0)).toBeGreaterThan(0);
    const imprisoned = (x: Sample): boolean =>
      x.truth?.players.some((p) => p.role === 'runner' && p.status === 'imprisoned') === true;
    expect(count(s, (x) => imprisoned(x) && num(x.fx.fade) > 0 && num(x.fx.fade) < 1)).toBeGreaterThan(3);
    expect(count(s, (x) => num(x.fx.particles) > 0)).toBeGreaterThan(20);
    expect(count(s, (x) => num(x.fx.dust) > 0)).toBeGreaterThan(100);
  });

  test(`괴물 · ${phase.name}: 60Hz · 120Hz 같은 시각의 시야 모드 보간 · 공격 준비 · 돌진 잔상 · 포효 충격파 · 흩어짐이 같다`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = await bothRates(browser, 'monster', 190, monsterScript(), phase.offset);
    expect(fogTimes(s)).toBeGreaterThan(170);
    expect(count(s, (x) => x.fx.attackRange === true && num(x.fx.attackFill) < 1)).toBeGreaterThan(2);
    expect(count(s, (x) => (x.anim?.myBlend ?? 0) > 0 && (x.anim?.myBlend ?? 1) < 1)).toBeGreaterThan(2);
    expect(count(s, (x) => (x.anim?.ghosts.length ?? 0) > 0)).toBeGreaterThan(1);
    expect(count(s, (x) => x.info.some((i) => i.tag === 'roar'))).toBeGreaterThan(2);
  });
}
