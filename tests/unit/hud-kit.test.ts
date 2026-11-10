// HUD 아틀라스 굽기와 글꼴 (플레이테스트 a-7): 거점 진행 숫자를 글꼴로 그려 아틀라스에 미리 굽는다. 그래서
//  - 굽는 서명(specSig)에 글꼴 세대가 들어 있어 늦게 받은 글꼴이면 한 번만 다시 굽고,
//  - 로비 미리 굽기(prebakeHud)는 글꼴이 정해지기(받음 · 시간 초과) 전에는 굽지 않는다 → 로비에서 굽는 횟수는 1번 그대로,
//  - 구운 아틀라스에 숫자 프레임(pct:…)이 텍스처 프레임으로 들어 있다(판 중에는 프레임만 바꾼다 — 글자 그리기 · 텍스처 올리기 0).
// Phaser · 캔버스는 흉내 낸다(굽는 횟수 · 프레임 이름 · 글자 그리기 명령만 본다)
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as fontsModule from '../../client/src/ui/fonts';
import type * as hudKitModule from '../../client/src/ui/hudKit';
import type * as gfxStateModule from '../../client/src/gfx/state';

const h = vi.hoisted(() => ({
  /** 만든 캔버스 텍스처마다: 열쇠 · 붙인 프레임 이름 · 그 캔버스에 그린 글자(fillText) */
  textures: [] as { key: string; frames: string[]; texts: string[]; fonts: Set<string> }[],
  removed: [] as string[],
  seq: 0,
}));

vi.mock('phaser', () => ({ default: { Scenes: { Events: { SHUTDOWN: 'shutdown' } } } }));
vi.mock('../../client/src/ui/text', () => ({
  UI_FONT: 'test-font',
  makeText: (): never => {
    throw new Error('이 시험은 글자 객체를 만들지 않는다');
  },
}));
vi.mock('../../client/src/render/fogPaint', () => {
  interface FakeCanvas {
    width: number;
    height: number;
    texts: string[];
    fonts: Set<string>;
  }
  const makeCanvas = (width: number, height: number): { canvas: FakeCanvas; ctx: unknown } => {
    const canvas: FakeCanvas = { width, height, texts: [], fonts: new Set() };
    let font = '';
    const gradient = { addColorStop: (): void => {} };
    const ctx = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
          if (key === 'fillText')
            return (text: string): void => {
              canvas.texts.push(text);
              canvas.fonts.add(font);
            };
          return (): void => {};
        },
        set: (_t, key, value) => {
          if (key === 'font') font = String(value);
          return true;
        },
      },
    );
    return { canvas, ctx };
  };
  return {
    makeCanvas,
    nextFogKey: (prefix: string): string => `${prefix}-${(h.seq += 1)}`,
    createCanvasTexture: (_host: unknown, key: string, canvas: FakeCanvas) => {
      const rec = { key, frames: [] as string[], texts: canvas.texts, fonts: canvas.fonts };
      h.textures.push(rec);
      return { add: (name: string): void => void rec.frames.push(name) };
    },
    removeCanvasTexture: (_host: unknown, key: string): void => void h.removed.push(key),
  };
});

interface Loaded {
  fonts: typeof fontsModule;
  kit: typeof hudKitModule;
  gfx: typeof gfxStateModule;
}

/** 모듈을 새로 불러온다 (아틀라스 · 굽기 횟수 · 글꼴 상태는 모듈 전역). fakeFonts = document.fonts 흉내 (null이면 글꼴 API 없음) */
async function fresh(
  fakeFonts: { load: () => Promise<unknown[]>; check: () => boolean } | null,
): Promise<Loaded> {
  vi.resetModules();
  h.textures.length = 0;
  h.removed.length = 0;
  vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
  vi.stubGlobal('document', fakeFonts ? { fonts: fakeFonts } : {});
  vi.stubGlobal('Path2D', class {});
  const fonts = await import('../../client/src/ui/fonts');
  const kit = await import('../../client/src/ui/hudKit');
  const gfx = await import('../../client/src/gfx/state');
  return { fonts, kit, gfx };
}

/** 텍스처 관리자 흉내: 만든 열쇠는 지우기 전까지 있다 */
const textureHost = (): never =>
  ({ exists: (key: string) => h.textures.some((t) => t.key === key) && !h.removed.includes(key) }) as never;

const bakes = (m: Loaded): number => Number(m.gfx.gfxState.features.hudBakes ?? 0);

describe('HUD 아틀라스 굽기와 글꼴 (거점 진행 숫자를 아틀라스에 굽는다)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('미리 굽기는 글꼴이 정해지기 전에는 굽지 않고, 받은 뒤 한 번만 굽는다 (로비 굽기 1번)', async () => {
    let finish: (v: unknown[]) => void = () => undefined;
    const pending = new Promise<unknown[]>((r) => (finish = r));
    const m = await fresh({ load: () => pending, check: () => true });
    const host = textureHost();
    const loading = m.fonts.loadUiFonts();
    // 부팅 직후의 미리 굽기: 글꼴을 아직 받는 중이라 건너뛴다
    expect(m.fonts.uiFontsSettled()).toBe(false);
    m.kit.prebakeHud(host);
    m.kit.prebakeHud(host);
    expect(bakes(m)).toBe(0);
    expect(h.textures).toEqual([]);
    const sig0 = m.kit.specSig();
    finish([{}]);
    expect(await loading).toBe(true);
    expect(m.fonts.uiFontsSettled()).toBe(true);
    // 굽는 서명에 글꼴 세대가 들어 있다 (받기 전 · 뒤가 다르다)
    expect(m.fonts.fontGeneration()).toBe(1);
    expect(m.kit.specSig()).not.toBe(sig0);
    // 글꼴이 정해진 뒤 main.ts가 다시 부른다: 이때 한 번 굽고, 같은 배율 · 글꼴이면 다시 굽지 않는다
    m.kit.prebakeHud(host);
    expect(bakes(m)).toBe(1);
    m.kit.prebakeHud(host);
    m.kit.prebakeHud(host);
    expect(bakes(m)).toBe(1);
    expect(h.textures.length).toBe(1);
  });

  it('구운 아틀라스에 0~100%의 숫자 프레임이 들어 있고 글자는 굽는 동안에만 그린다 (UI 글꼴 굵게)', async () => {
    const m = await fresh({ load: () => Promise.resolve([{}]), check: () => true });
    await m.fonts.loadUiFonts();
    m.kit.prebakeHud(textureHost());
    const tex = h.textures[0]!;
    const pct = tex.frames.filter((f) => f.startsWith('pct:'));
    // 본문 20(십의 자리 9 + 일의 자리 10 + 100%) · 주황 19 · 흐림 1 (0%)
    expect(pct.length).toBe(40);
    for (const f of [
      'pct:text:t6',
      'pct:text:o3',
      'pct:text:100',
      'pct:warn:t9',
      'pct:warn:o0',
      'pct:dim:o0',
    ])
      expect(pct, f).toContain(f);
    // 그린 글자는 숫자와 '%'뿐이고(PC 배치 — 거점 글자는 글자 객체), 일의 자리 프레임마다 '%'가 하나씩
    expect(new Set(tex.texts)).toEqual(new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '%']));
    expect(tex.texts.filter((t) => t === '%').length).toBe(10 + 10 + 1 + 1);
    expect([...tex.fonts]).toEqual([expect.stringMatching(/^bold 17px .*Noto Sans KR/)]);
  });

  it('시간 초과로 대체 글꼴로 구운 뒤 글꼴이 늦게 오면 한 번만 다시 굽고 옛 아틀라스를 지운다', async () => {
    vi.useFakeTimers();
    let finish: (v: unknown[]) => void = () => undefined;
    const pending = new Promise<unknown[]>((r) => (finish = r));
    const m = await fresh({ load: () => pending, check: () => true });
    const host = textureHost();
    const loading = m.fonts.loadUiFonts(1000);
    m.kit.prebakeHud(host);
    expect(bakes(m)).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await loading).toBe(false);
    // 시간 초과도 '정해짐'이다: 대체 글꼴로 굽는다 (판이 대체 글꼴로 시작할 수 있다)
    expect(m.fonts.uiFontsSettled()).toBe(true);
    m.kit.prebakeHud(host);
    expect(bakes(m)).toBe(1);
    const first = h.textures[0]!.key;
    // 늦게 도착: 세대가 바뀌어 다음 미리 굽기(또는 판 중 HudKit.sync)가 한 번 다시 굽는다
    finish([{}]);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.fonts.fontGeneration()).toBe(1);
    m.kit.prebakeHud(host);
    expect(bakes(m)).toBe(2);
    m.kit.prebakeHud(host);
    expect(bakes(m)).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.removed).toEqual([first]);
  });

  it('글꼴 API가 없는 환경은 바로 정해진 것으로 보고 굽는다', async () => {
    const m = await fresh(null);
    expect(await m.fonts.loadUiFonts()).toBe(false);
    expect(m.fonts.uiFontsSettled()).toBe(true);
    m.kit.prebakeHud(textureHost());
    expect(bakes(m)).toBe(1);
  });
});
