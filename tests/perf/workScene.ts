// 일의 양 장면 (work-counts.spec.ts · tests/e2e/perf-budget.spec.ts가 같이 쓴다). 가상 시계 120Hz · 같은 시드 · 서버 소켓 막음 ·
// 오프라인 — 연습 판(기기 안 서버 · 봇 셋)이 비트까지 같게 돈다. 판을 시작하고 2초(장면 만들기 · 굽기) 뒤부터 10초 동안 정해진 조작을
// 하며 센다. 최적화 전 빌드에도 있는 디버그 훅(injectFps · transport · fonts)만 쓴다
import type { Browser, Page } from '@playwright/test';
import { installVirtualClock } from '../helpers/virtualClock';
import { watchConsole } from '../e2e/helpers';
import { installWorkCounts, perFrame, type WorkCounts } from './workCounts';

export interface WorkScene {
  name: string;
  project: 'webgl' | 'canvas';
  quality: 'high' | 'medium' | 'low';
  role: 'runner' | 'monster';
  /** ?scale (백버퍼 배율). GPU가 없는 컨테이너 · CI에서 SwiftShader 래스터가 1200프레임을 막지 않게 줄인다(셈은 이 배율 기준) */
  scale?: number;
  /** ?chars (캐릭터 스타일, 캐릭터 리디자인 2단계). 없으면 기본(기존) */
  chars?: 'new';
}

export const WORK_SCENES: WorkScene[] = [
  { name: 'canvas-high-runner', project: 'canvas', quality: 'high', role: 'runner' },
  { name: 'canvas-high-monster', project: 'canvas', quality: 'high', role: 'monster' },
  { name: 'canvas-low-runner', project: 'canvas', quality: 'low', role: 'runner' },
  { name: 'webgl-high-runner', project: 'webgl', quality: 'high', role: 'runner' },
  { name: 'webgl-high-monster', project: 'webgl', quality: 'high', role: 'monster' },
  // 일의 양 예산 게이트용 WebGL 장면 (tests/e2e/perf-budget.webgl.spec.ts): 백버퍼 1/4 — 원래 크기는 CI 러너에서 4분을 넘겼다
  { name: 'webgl-high-runner-s25', project: 'webgl', quality: 'high', role: 'runner', scale: 0.25 },
  // 새 캐릭터 스타일 (캐릭터 리디자인 2단계): 같은 조작 · 같은 시드. 예산은 기존 스타일 기준값을 그대로 건다(새 스타일도 그 안)
  { name: 'canvas-high-runner-new', project: 'canvas', quality: 'high', role: 'runner', chars: 'new' },
  { name: 'canvas-high-monster-new', project: 'canvas', quality: 'high', role: 'monster', chars: 'new' },
  {
    name: 'webgl-high-runner-s25-new',
    project: 'webgl',
    quality: 'high',
    role: 'runner',
    scale: 0.25,
    chars: 'new',
  },
];

const HZ = 120;
const SEED = 20_261_013;
/** 로딩이 끝난 뒤 멈추고 맞추는 가상 시각 */
const SYNC_AT = 30_000;
const CHUNK = 50;
/** 판 시작 뒤 세기 전까지 (장면 만들기 · 첫 굽기 · 시작 배너) */
const WARM_MS = 2000;
/** 세는 동안 */
const MEASURE_MS = 10_000;

type Step = (page: Page) => Promise<void>;

const down =
  (k: string): Step =>
  (page) =>
    page.keyboard.down(k);
const up =
  (k: string): Step =>
  (page) =>
    page.keyboard.up(k);
const press =
  (k: string): Step =>
  (page) =>
    page.keyboard.press(k);
const clickAt =
  (button: 'left' | 'right'): Step =>
  async (page) => {
    await page.mouse.down({ button });
    await page.mouse.up({ button });
  };

/** 세는 동안의 조작 (CHUNK 칸 번호 → 할 일): 네모를 그리며 걷고, 중간에 능력 · 공격 */
function stepsFor(role: WorkScene['role']): Map<number, Step[]> {
  const m = new Map<number, Step[]>();
  const at = (i: number, ...s: Step[]): void => {
    m.set(i, [...(m.get(i) ?? []), ...s]);
  };
  // 1.5초(30칸)마다 방향을 바꾼다: → ↓ ← ↑ → ↓
  const dirs = ['d', 's', 'a', 'w', 'd', 's'];
  dirs.forEach((k, n) => {
    if (n > 0) at(n * 30, up(dirs[n - 1] ?? 'd'));
    at(n * 30, down(k));
  });
  at(dirs.length * 30, up(dirs[dirs.length - 1] ?? 's'));
  if (role === 'runner') {
    at(60, press('Space'));
  } else {
    at(50, clickAt('left'));
    at(110, press('Shift'));
    at(150, clickAt('right'));
  }
  return m;
}

async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((d) => window.__VCLOCK__?.advance(d), ms);
}

async function counts(page: Page): Promise<{ c: WorkCounts; frames: number; t: number }> {
  return page.evaluate(() => {
    const c = window.__WORK__;
    const v = window.__VCLOCK__;
    if (!c || !v) throw new Error('세기 훅 · 가상 시계 없음');
    return { c: { ...c }, frames: v.frames, t: v.now() };
  });
}

/** 장면 하나의 결과: 프레임당 · 초당 일의 양(perFrame)과 콘솔 문제 */
export interface WorkResult {
  counts: Record<string, number>;
  problems: string[];
}

/** 장면 하나를 돌려 프레임당 · 초당 일의 양과 콘솔 문제를 돌려준다 */
export async function measureWork(browser: Browser, sc: WorkScene): Promise<WorkResult> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const problems: string[] = [];
  try {
    await context.addInitScript(installVirtualClock, { seed: SEED, hz: HZ });
    await context.addInitScript(installWorkCounts);
    const page = await context.newPage();
    // 앱 코드가 낸 콘솔 에러 · 경고 (브라우저 내부 GL 메시지는 빼고, tests/e2e/helpers.ts watchConsole과 같다)
    watchConsole(page, problems);
    await page.routeWebSocket(/\/ws$/, (ws) => ws.close({ code: 1011, reason: 'blocked' }));
    const renderer = sc.project === 'canvas' ? '&renderer=canvas' : '';
    const scale = sc.scale !== undefined ? `&scale=${sc.scale}` : '';
    const chars = sc.chars ? `&chars=${sc.chars}` : '';
    await page.goto(`/?debug=hook&quality=${sc.quality}${renderer}${scale}${chars}`);
    await page.getByTestId('practice').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__DECOY__?.fonts.ready === true, null, { timeout: 30_000 });
    await context.setOffline(true);
    await page.waitForTimeout(300);
    await page.evaluate(async (t) => {
      const v = window.__VCLOCK__;
      if (!v) throw new Error('가상 시계 없음');
      await v.pump(false);
      await v.advanceTo(t);
      // 품질 자동 조정을 멈춘다 (목표와 같은 fps)
      window.__DECOY__?.injectFps(v.hz);
    }, SYNC_AT);
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="practice"]')?.click());
    await advance(page, 500);
    await page.evaluate(
      ([seed, id]) => {
        window.__VCLOCK__?.reseed(seed);
        document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click();
      },
      [SEED, `practice-role-${sc.role}`] as const,
    );
    await advance(page, WARM_MS);
    if ((await page.evaluate(() => window.__DECOY__?.transport)) !== 'local')
      throw new Error('연습 판이 아니다');
    // 마우스를 화면 가운데 오른쪽 위로 (괴물 조준이 한쪽을 본다)
    await page.mouse.move(820, 300);
    const steps = stepsFor(sc.role);
    const a = await counts(page);
    for (let i = 0; i < MEASURE_MS / CHUNK; i += 1) {
      for (const s of steps.get(i) ?? []) await s(page);
      await advance(page, CHUNK);
    }
    const b = await counts(page);
    return { counts: perFrame(a.c, b.c, b.frames - a.frames, (b.t - a.t) / 1000), problems };
  } finally {
    await context.close();
  }
}
