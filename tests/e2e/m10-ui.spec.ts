// M10c 로비 · 결과 · 폰트 · 로고 (갈래 B): UI 폰트가 장면보다 먼저 준비되는지, 로비 · 결과 DOM 글자의 실효 대비,
// 고른 카드와 남이 고른 카드가 색 말고도 구분되는지, 큰 로고가 SVG로 배율 2에서 선명한지, 결과 화면 위가 잘리지 않는지
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  BASE_QUERY,
  createRoom,
  joinRoom,
  newPlayerPage,
  pickRoleAndReady,
  sendTest,
  truth,
  waitForSnapshots,
  watchConsole,
} from './helpers';

const FONT_FILE = 'client/public/fonts/noto-sans-kr-ui.woff2';
const CHARS = readFileSync('client/public/fonts/noto-sans-kr-ui.txt', 'utf8').replace(/\n$/, '');
const PNG_URL = `data:image/png;base64,${readFileSync('docs/images/logo_decoy.png').toString('base64')}`;

interface Low {
  text: string;
  ratio: number;
  need: number;
  fg: string;
  bg: string;
}
interface Audit {
  checked: number;
  min: number;
  /** 대비가 가장 낮은 글자 */
  minText: string;
  low: Low[];
  /** 글자 목록(폰트 서브셋) 밖이라 대체 글꼴로 그려지는 글자 */
  fallback: string;
}

/**
 * root 안의 보이는 모든 글자 요소(직접 글자를 가진 요소 · 입력 값 · 자리 표시 글자)에 대해 계산된 글자색과
 * 조상 배경색을 알파 합성한 실효 배경의 대비를 잰다. 큰 글자(24px 이상, 굵게 18.66px 이상)는 3:1, 나머지 4.5:1
 */
async function contrastAudit(page: Page, rootSel: string): Promise<Audit> {
  return page.evaluate(
    ({ sel, chars }) => {
      type C = [number, number, number, number];
      const parse = (s: string): C => {
        const m = /rgba?\(([^)]+)\)/.exec(s);
        if (!m) throw new Error(`색을 읽지 못함: ${s}`);
        const p = m[1]!
          .split(/[\s,/]+/)
          .filter((x) => x.length > 0)
          .map(Number);
        return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
      };
      const over = (top: C, under: C): C => {
        const a = top[3];
        return [
          top[0] * a + under[0] * (1 - a),
          top[1] * a + under[1] * (1 - a),
          top[2] * a + under[2] * (1 - a),
          1,
        ];
      };
      const lin = (v: number): number => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const lum = (c: C): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const ratio = (a: C, b: C): number => {
        const x = lum(a);
        const y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const hex = (c: C): string => `rgb(${c.slice(0, 3).map(Math.round).join(',')})`;
      // 실효 바탕 후보: 조상 배경색을 합성하고, background-image(그라디언트 · 해치)의 색 정지점마다
      // 그 색이 깔린 자리도 후보로 둔다(글자가 해치 줄 위에 올 수 있다). 대비는 후보 중 가장 나쁜 값으로 잰다.
      // 왼쪽 가장자리 띠(linear-gradient(90deg, 색 0 Npx, transparent Npx))는 글자가 그 띠에 걸칠 때만 센다
      const gradients = (img: string): string[] =>
        img === 'none'
          ? []
          : (img.match(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/g) ?? []);
      const colorsOf = (g: string): C[] =>
        (g.match(/rgba?\([^)]+\)/g) ?? []).map(parse).filter((c) => c[3] > 0);
      /** 왼쪽 가장자리 띠의 폭 (px). 띠가 아니면 null */
      const edgeBand = (g: string): number | null => {
        if (!g.startsWith('linear-gradient(90deg,') || g.includes('%')) return null;
        let band = 0;
        for (const m of g.matchAll(/(rgba?\([^)]+\))\s+(-?[\d.]+)px/g))
          if (parse(m[1]!)[3] > 0) band = Math.max(band, Number(m[2]));
        return band;
      };
      const stopsUnder = (layer: Element, text: Element): C[] => {
        const out: C[] = [];
        for (const g of gradients(getComputedStyle(layer).backgroundImage)) {
          const band = edgeBand(g);
          if (band !== null && text.getBoundingClientRect().left >= layer.getBoundingClientRect().left + band)
            continue;
          out.push(...colorsOf(g));
        }
        return out;
      };
      const bgUnder = (el: Element): C[] => {
        const layers: { c: C; stops: C[] }[] = [];
        for (let n: Element | null = el; n; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          const stops = stopsUnder(n, el);
          if (c[3] > 0 || stops.length > 0) layers.push({ c, stops });
          if (c[3] >= 1) break;
        }
        let cands: C[] = [[11, 22, 34, 1]];
        for (const l of layers.reverse()) {
          const next = new Map<string, C>();
          for (const acc of cands) {
            const base = l.c[3] > 0 ? over(l.c, acc) : acc;
            for (const v of [base, ...l.stops.map((st) => over(st, base))]) next.set(hex(v), v);
          }
          cands = [...next.values()].slice(0, 64);
        }
        return cands;
      };
      const opacityOf = (el: Element): number => {
        let o = 1;
        for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
        return o;
      };
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width >= 2 && r.height >= 2 && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
      };
      const root = document.querySelector(sel);
      if (!root) throw new Error(`${sel} 없음`);
      const low: Low[] = [];
      let checked = 0;
      let min = Infinity;
      let minText = '';
      const have = new Set(chars);
      const fallback = new Set<string>();
      const check = (el: Element, text: string, color: string): void => {
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        const fgRaw = parse(color);
        const fgA = fgRaw[3] * opacityOf(el);
        let bg: C = [0, 0, 0, 1];
        let fg: C = bg;
        let r = Infinity;
        for (const b of bgUnder(el)) {
          const f = over([fgRaw[0], fgRaw[1], fgRaw[2], fgA], b);
          const v = ratio(f, b);
          if (v < r) [r, bg, fg] = [v, b, f];
        }
        checked += 1;
        if (r < min) {
          min = r;
          minText = `${text.slice(0, 20)} ${hex(fg)}/${hex(bg)}`;
        }
        if (r < need) low.push({ text: text.slice(0, 40), ratio: r, need, fg: hex(fg), bg: hex(bg) });
        for (const ch of text) if (ch.trim() && !have.has(ch)) fallback.add(ch);
      };
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (!visible(el)) continue;
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
          const v = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text ?? '') : el.value;
          if (v) check(el, v, getComputedStyle(el).color);
          else if (el instanceof HTMLInputElement && el.placeholder)
            check(el, el.placeholder, getComputedStyle(el, '::placeholder').color);
          continue;
        }
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();
        if (own) check(el, own, getComputedStyle(el).color);
      }
      return { checked, min, minText, low, fallback: [...fallback].join('') };
    },
    { sel: rootSel, chars: CHARS },
  );
}

function expectAudit(a: Audit, label: string): void {
  console.log(`[대비] ${label}: 글자 ${a.checked}개, 최저 ${a.min.toFixed(2)}:1 (${a.minText})`);
  expect(a.checked, label).toBeGreaterThan(5);
  expect(a.low, `${label} 대비 미달`).toEqual([]);
  expect(a.fallback, `${label} 폰트 목록 밖 글자`).toBe('');
}

async function startSolo(page: Page, role: 'runner' | 'monster'): Promise<string> {
  const code = await createRoom(page, '&bots=1');
  await pickRoleAndReady(page, role);
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 3);
  return code;
}

test('폰트: 로비 화면에서 Noto Sans KR이 이미 준비되어 있고, 판 장면은 폰트를 받은 뒤 시작한다', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  const fontRes = page.waitForResponse((r) => r.url().endsWith('/fonts/noto-sans-kr-ui.woff2'));
  await page.goto(`/?bots=1${BASE_QUERY}`);
  await expect(page.getByTestId('create-room')).toBeVisible();
  // 미리 받기(preload)와 @font-face가 같은 요청을 쓴다 (한 번만 받는다)
  const res = await fontRes;
  expect(res.status()).toBe(200);
  expect((await res.body()).equals(readFileSync(FONT_FILE))).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fonts.check("700 24px 'Noto Sans KR'", 'DECOY 방 만들기 생존자 괴물 0123'),
      ),
    )
    .toBe(true);
  const state = await page.evaluate(() => ({
    hook: window.__DECOY__?.fonts ?? null,
    faces: [...document.fonts]
      .filter((f) => f.family.replace(/"/g, '') === 'Noto Sans KR')
      .map((f) => f.status),
    family: getComputedStyle(document.querySelector('[data-testid="create-room"]')!).fontFamily,
  }));
  expect(state.hook).toEqual({ ready: true, atSceneStart: null });
  expect(state.faces).toEqual(['loaded']);
  expect(state.family.startsWith('"Noto Sans KR"')).toBe(true);

  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  await pickRoleAndReady(page, 'runner');
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 3);
  expect(await page.evaluate(() => window.__DECOY__?.fonts ?? null)).toEqual({
    ready: true,
    atSceneStart: true,
  });
  expect(problems).toEqual([]);
  await context.close();
});

test('진행 중인 판에 새로고침으로 다시 들어오면 폰트를 기다리지 않고 판 화면을 띄우고, 늦게 온 폰트로 다시 그린다', async ({
  browser,
}) => {
  // 서비스 워커(M13d 앱 셸)가 있으면 새로고침 때 폰트가 캐시에서 바로 와 '느린 회선'이 생기지 않는다(route도 워커가 받은
  // 요청은 가로채지 못한다). 이 시험은 앱 셸이 아직 없는 기기 — 첫 방문 · 워커를 못 쓰는 브라우저 — 를 흉내 낸다
  const { context, page, problems } = await newPlayerPage(browser, { serviceWorkers: 'block' });
  await page.goto(`/?bots=1${BASE_QUERY}`);
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z]{4}$/);
  await pickRoleAndReady(page, 'runner');
  await page.getByTestId('start-button').click();
  await waitForSnapshots(page, 3);

  // 느린 회선: 폰트 응답을 판 화면이 뜬 것을 본 뒤까지 붙잡아 둔다
  let release = (): void => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/fonts/noto-sans-kr-ui.woff2', async (route) => {
    await gate;
    await route.continue();
  });
  // 폰트 미리 받기를 붙잡아 두면 load 이벤트가 오지 않는다
  await page.reload({ waitUntil: 'domcontentloaded' });
  // 판 장면을 시작한 시각 (페이지 시작 기준). 로비에서 시작한 판처럼 폰트를 기다렸다면
  // 부팅 때 건 폰트 시간 제한(3초)이 지나야 장면이 생긴다
  const startedAt = (await (
    await page.waitForFunction(
      () => ((window.__DECOY__?.fonts.atSceneStart ?? null) !== null ? performance.now() : 0),
      undefined,
      { timeout: 20_000 },
    )
  ).jsonValue()) as number;
  expect(await page.evaluate(() => window.__DECOY__?.fonts ?? null)).toEqual({
    ready: false,
    atSceneStart: false,
  });
  expect(startedAt).toBeLessThan(3000);

  // 대체 글꼴로 잰 타이머 숫자 칸 (폰트 세대 0)
  expect((await page.evaluate(() => window.__DECOY__?.getHud() ?? {})).timerFontGen).toBe(0);
  release();
  await expect.poll(() => page.evaluate(() => window.__DECOY__?.fonts.ready ?? false)).toBe(true);
  // 늦게 받은 폰트로 글자를 다시 그리고, 글자 폭으로 정한 배치(타이머 숫자 칸)도 다시 잰다
  await expect
    .poll(() => page.evaluate(() => window.__DECOY__?.getHud().timerFontGen ?? -1), { intervals: [100] })
    .toBe(1);
  await waitForSnapshots(page, 5);
  // 워커를 막으면 Playwright가 스스로 경고를 남긴다(앱 코드가 낸 것이 아니다)
  expect(problems.filter((p) => !p.includes('Service Worker registration blocked by Playwright'))).toEqual(
    [],
  );
  await context.close();
});

test('빌드 결과에 폰트 · 글자 목록 · 라이선스(OFL.txt)가 있고 서버가 내준다', async ({ request }) => {
  const ofl = readFileSync('client/dist/fonts/OFL.txt', 'utf8');
  expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
  expect(ofl).toBe(readFileSync('client/public/fonts/OFL.txt', 'utf8'));
  for (const f of ['OFL.txt', 'noto-sans-kr-ui.txt', 'noto-sans-kr-ui.woff2']) {
    const res = await request.get(`/fonts/${f}`);
    expect(res.status(), f).toBe(200);
    expect((await res.body()).equals(readFileSync(`client/public/fonts/${f}`)), f).toBe(true);
  }
});

test('로비: 보이는 모든 글자 대비 4.5:1(큰 글자 3:1), 고른 카드와 남이 고른 카드는 색 말고도 구분된다', async ({
  browser,
}) => {
  const host = await newPlayerPage(browser);
  // 첫 화면 (+ 잘못된 방 코드 오류 문구)
  await host.page.goto(`/?${BASE_QUERY.slice(1)}`);
  await expect(host.page.getByTestId('create-room')).toBeVisible();
  await host.page.getByTestId('room-code-input').fill('ZZZY');
  await host.page.getByTestId('join-room').click();
  await expect(host.page.getByTestId('lobby-error')).toContainText('찾을 수 없습니다');
  expectAudit(await contrastAudit(host.page, '[data-testid="lobby"]'), '로비 첫 화면');

  const code = await createRoom(host.page);
  const p2 = await newPlayerPage(browser);
  const p3 = await newPlayerPage(browser);
  await joinRoom(p2.page, code);
  await joinRoom(p3.page, code);
  await pickRoleAndReady(p2.page, 'runner');
  await host.page.getByTestId('role-monster').click();
  await expect(host.page.getByTestId('role-monster')).toHaveClass(/mine/);
  await expect(host.page.getByTestId('player-list').locator('.player')).toHaveCount(3);
  const p2Name = (await p2.page.locator('.player:has(.tag) .nm').first().textContent()) ?? '';
  expect(p2Name.length).toBeGreaterThan(0);

  const mine = host.page.getByTestId('role-monster');
  const taken = host.page.getByTestId('role-runner');
  const free = host.page.getByTestId('role-guard');
  // 고른 카드: ✓ 아이콘 + "내 역할" 글자 (+ 역할색 테두리)
  await expect(mine.locator('.rc-tag')).toBeVisible();
  await expect(mine.locator('.rc-tag')).toHaveText('내 역할');
  await expect(mine.locator('.rc-tag svg.icon-check')).toBeVisible();
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  // 남이 고른 카드: 사선 해치 + 주인 이름, ✓ · "내 역할" 없음
  await expect(taken).toHaveClass(/taken/);
  await expect(taken.locator('.role-owner')).toContainText(p2Name);
  await expect(taken.locator('.rc-tag')).toHaveCount(0);
  // 빈 카드: 해치 없음 + "비어 있음"
  await expect(free.locator('.role-owner')).toHaveText('비어 있음');
  const look = async (id: string): Promise<{ hatch: string; ring: string }> =>
    host.page.evaluate((sel) => {
      const body = document.querySelector(`[data-testid="${sel}"] .rc-body`)!;
      return {
        hatch: getComputedStyle(body).backgroundImage,
        ring: getComputedStyle(body, '::after').backgroundColor,
      };
    }, id);
  const [lm, lt, lf] = [await look('role-monster'), await look('role-runner'), await look('role-guard')];
  expect(lt.hatch).toContain('repeating-linear-gradient');
  expect(lf.hatch).not.toContain('repeating-linear-gradient');
  expect(lm.hatch).not.toContain('repeating-linear-gradient');
  // 고른 카드의 테두리 = 괴물 역할색
  expect(lm.ring).toBe('rgb(239, 68, 68)');
  expect(lf.ring).not.toBe(lm.ring);
  // 남의 카드를 눌러도 아무 일 없다. 같은 연결로 왕복(준비)을 하나 끝낸 뒤에 본다
  // (서버는 한 연결의 메시지를 순서대로 처리하므로, 잘못 보낸 역할 변경이 있었다면 이미 반영되어 있다)
  await taken.click({ force: true });
  await host.page.getByTestId('ready-button').click();
  await expect(host.page.getByTestId('ready-button')).toHaveText('준비 취소');
  await expect(mine).toHaveClass(/mine/);
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  await expect(taken).toHaveClass(/taken/);
  await expect(taken.locator('.role-owner')).toContainText(p2Name);

  // 키보드: 고른 카드에 포커스가 오면 테두리가 밝아지고(mine 표시와 달라야 한다), 남이 역할을 골라
  // 방 화면이 다시 그려져도 포커스가 같은 카드에 남는다
  await mine.focus();
  await host.page.keyboard.press('Shift+Tab');
  await host.page.keyboard.press('Tab');
  await expect(mine).toBeFocused();
  expect((await look('role-monster')).ring).toBe('rgb(226, 232, 240)');
  await p3.page.getByTestId('role-guard').click();
  await expect(host.page.getByTestId('role-guard')).toHaveClass(/taken/);
  await expect(host.page.getByTestId('role-monster')).toBeFocused();
  await host.page.keyboard.press('Tab');
  await expect(host.page.getByTestId('role-runner')).toBeFocused();
  // 낭독기 이름: 초대 주소 칸은 '초대 링크'(옆 버튼 '링크 복사'와 다르게), 방장 왕관은 '방장'
  await expect(host.page.getByTestId('room-link')).toHaveAttribute('aria-label', '초대 링크');
  await expect(host.page.getByTestId('copy-link')).toHaveText('링크 복사');
  await expect(host.page.getByTestId('player-list').getByRole('img', { name: '방장' })).toHaveCount(1);

  expectAudit(await contrastAudit(host.page, '[data-testid="lobby"]'), '방 화면 (방장)');
  expectAudit(await contrastAudit(p3.page, '[data-testid="lobby"]'), '방 화면 (역할 없음)');
  for (const p of [host, p2, p3]) expect(p.problems).toEqual([]);
  for (const p of [host, p2, p3]) await p.context.close();
});

test('결과 화면: 글자 대비, 960×540 · 1366×768 · 더 낮은 창에서도 위가 잘리지 않고, 생존자 승리는 문 아이콘 등급', async ({
  browser,
}) => {
  const { context, page, problems } = await newPlayerPage(browser);
  const code = await startSolo(page, 'runner');
  // 시간 초과 → 괴물 승리 (생존자 화면: 탈출 실패 등급 = 문 1개)
  await sendTest(page, { kind: 'setTime', timeLeft: 0.1 });
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('result-winner')).toHaveText('괴물 승리');
  await expect(page.getByTestId('result-grade')).toContainText('탈출 실패');
  await expect(page.getByTestId('result-grade').locator('svg.icon-exit')).toHaveCount(1);
  await expect(page.locator('.memo .label')).toHaveText('기록자 메모');
  expectAudit(await contrastAudit(page, '[data-testid="result"]'), '결과 (괴물 승리)');

  for (const [w, h] of [
    [960, 540],
    [1366, 768],
    [960, 400],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="result"]')!;
      root.scrollTop = 0;
      const box = root.querySelector('.result-box')!.getBoundingClientRect();
      const logo = root.querySelector('.brand-logo')!.getBoundingClientRect();
      const again = root.querySelector('[data-testid="rematch"]')!;
      return {
        top: box.top,
        bottom: box.bottom,
        logoTop: logo.top,
        scrollable: root.scrollHeight - root.clientHeight,
        againBottom: again.getBoundingClientRect().bottom + root.scrollHeight - root.clientHeight,
      };
    });
    console.log(
      `[결과] ${w}×${h}: 상자 ${m.top.toFixed(0)}~${m.bottom.toFixed(0)}, 스크롤 ${m.scrollable}px`,
    );
    expect(m.top, `${w}×${h} 위`).toBeGreaterThanOrEqual(0);
    expect(m.logoTop, `${w}×${h} 로고`).toBeGreaterThanOrEqual(0);
    // 960×540 이상은 스크롤 없이 한 화면, 더 낮으면 위에서부터 스크롤해 '다시 하기'까지 닿는다
    if (h >= 540) expect(m.bottom, `${w}×${h} 아래`).toBeLessThanOrEqual(h);
    else {
      expect(m.scrollable).toBeGreaterThan(0);
      await page.getByTestId('rematch').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('rematch')).toBeInViewport();
    }
  }
  await page.setViewportSize({ width: 960, height: 540 });

  // 다시 하기 → 둘이 탈출 · 하나 사망 → 생존자 승리 (탈출 성공 = 문 2개)
  await page.getByTestId('rematch').click();
  await expect(page.getByTestId('role-runner')).toHaveClass(/mine/);
  await page.getByTestId('ready-button').click();
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('result')).toBeHidden();
  await page.waitForFunction(() => window.__DECOY__?.phase === 'playing');
  await waitForSnapshots(page, 3);
  const t = await truth(page, code);
  const id = (r: string): string => t.players.find((p) => p.role === r)!.id;
  await sendTest(page, { kind: 'setSurvivor', target: id('scout'), status: 'dead' });
  await sendTest(page, { kind: 'setSurvivor', target: id('runner'), status: 'escaped' });
  await sendTest(page, { kind: 'setSurvivor', target: id('guard'), status: 'escaped' });
  await expect(page.getByTestId('result-winner')).toHaveText('생존자 승리', { timeout: 10_000 });
  await expect(page.getByTestId('result-grade')).toContainText('탈출 성공');
  await expect(page.getByTestId('result-grade').locator('svg.icon-exit')).toHaveCount(2);
  await expect(page.locator('.emblem.survivors svg')).toHaveCount(3);
  expectAudit(await contrastAudit(page, '[data-testid="result"]'), '결과 (생존자 승리)');
  expect(problems).toEqual([]);
  await context.close();
});

test('큰 로고는 SVG이고 기기 픽셀 배율 2에서 원본 PNG 확대보다 선명하다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const problems: string[] = [];
  watchConsole(page, problems);
  await page.goto(`/?${BASE_QUERY.slice(1)}`);
  const logo = page.locator('.brand-hero .brand-logo');
  await expect(logo).toBeVisible();
  await page.waitForFunction(() => {
    const im = document.querySelector<HTMLImageElement>('.brand-hero .brand-logo');
    return im !== null && im.complete && im.naturalWidth > 0;
  });
  const info = await logo.evaluate((im: HTMLImageElement) => ({
    src: im.currentSrc,
    css: im.getBoundingClientRect().width,
  }));
  expect(info.src).toMatch(/\/logo\.svg$/);
  // 배율 2에서 원본 PNG(213px)를 쓰면 확대된다
  expect(info.css * 2).toBeGreaterThan(213 * 1.4);
  const shot = (await logo.screenshot()).toString('base64');
  // 선명도: 원판 안쪽(네온 선)의 밝기 기울기 상위 1% 값. 같은 기기 픽셀 크기로 그린 SVG · PNG 확대본과 비교한다
  const s = await page.evaluate(
    async ({ shot, png }) => {
      const load = async (src: string): Promise<HTMLImageElement> => {
        const im = new Image();
        im.src = src;
        await im.decode();
        return im;
      };
      const shotIm = await load(`data:image/png;base64,${shot}`);
      const n = shotIm.naturalWidth;
      const sharp = (im: HTMLImageElement): number => {
        const c = document.createElement('canvas');
        c.width = n;
        c.height = n;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = '#0b1622';
        ctx.fillRect(0, 0, n, n);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im, 0, 0, n, n);
        const d = ctx.getImageData(0, 0, n, n).data;
        const L = (x: number, y: number): number => {
          const i = (y * n + x) * 4;
          return 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
        };
        const mags: number[] = [];
        const a = Math.round(n * 0.2);
        const b = Math.round(n * 0.8);
        for (let y = a; y < b; y += 1)
          for (let x = a; x < b; x += 1) {
            const gx = L(x + 1, y) - L(x - 1, y);
            const gy = L(x, y + 1) - L(x, y - 1);
            mags.push(Math.hypot(gx, gy));
          }
        mags.sort((p, q) => p - q);
        return mags[Math.floor(mags.length * 0.99)]!;
      };
      return {
        n,
        page: sharp(shotIm),
        svg: sharp(await load('logo.svg')),
        png: sharp(await load(png)),
      };
    },
    { shot, png: PNG_URL },
  );
  console.log(
    `[로고] 배율 2 ${s.n}px: 화면 ${s.page.toFixed(1)} · SVG ${s.svg.toFixed(1)} · PNG 확대 ${s.png.toFixed(1)}`,
  );
  expect(s.page).toBeGreaterThan(s.png * 1.15);
  expect(s.page).toBeGreaterThan(s.svg * 0.85);
  expect(problems).toEqual([]);
  await context.close();
});
