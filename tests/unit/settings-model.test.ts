// 설정 화면의 값 다루기 (설정 화면 통합, client/src/settingsModel.ts): 저장 · 복원 · 주소 옵션 우선 · 항목별 · 모두 되돌리기.
// 브라우저 저장소 대신 메모리 저장소를 globalThis.localStorage로 넣는다 (storageKeys가 읽는 곳)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../client/src/storageKeys';
import type * as SettingsModel from '../../client/src/settingsModel';
import type * as Quality from '../../client/src/gfx/quality';
import type * as FramePacing from '../../client/src/gfx/framePacing';
import type * as CharStyle from '../../client/src/gfx/charStyle';
import type * as Prefs from '../../client/src/prefs';

/** 메모리 localStorage (broken이면 쓰기가 예외) */
function memoryStorage(broken = false): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (broken) throw new Error('가득 참');
      data.set(k, v);
    },
    removeItem: (k: string) => {
      if (broken) throw new Error('막힘');
      data.delete(k);
    },
  };
}

let store: ReturnType<typeof memoryStorage>;

/** 새 접속처럼 모듈을 처음부터 불러온다 (모듈 안 상태 · 한 번 읽은 저장값을 비운다) */
async function fresh(): Promise<{
  model: typeof SettingsModel;
  quality: typeof Quality;
  pacing: typeof FramePacing;
  chars: typeof CharStyle;
  prefs: typeof Prefs;
}> {
  vi.resetModules();
  const model = await import('../../client/src/settingsModel');
  const quality = await import('../../client/src/gfx/quality');
  const pacing = await import('../../client/src/gfx/framePacing');
  const chars = await import('../../client/src/gfx/charStyle');
  const prefs = await import('../../client/src/prefs');
  return { model, quality, pacing, chars, prefs };
}

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('설정 화면 값', () => {
  it('고른 값은 저장되고 새 접속에서 복원된다 (그래픽 · 화면 · 소리)', async () => {
    let m = await fresh();
    const applied: string[] = [];
    m.quality.qualityHooks.choose = (c) => applied.push(`q:${c}`);
    m.pacing.pacingHooks.setLimit = (l) => applied.push(`f:${l}`);
    m.chars.initCharStyle(null);
    expect(m.model.chooseQuality('low')).toBe(true);
    expect(m.model.chooseFrameLimit('60')).toBe(true);
    expect(m.model.chooseCharStyle('classic')).toBe(true);
    expect(m.prefs.setPref('reduceFlash', true)).toBe(true);
    expect(m.prefs.setPref('volSfx', 35)).toBe(true);
    expect(applied).toEqual(['q:low', 'f:60']);
    expect(store.data.get(STORAGE_KEYS.quality.key)).toBe('low');
    expect(store.data.get(STORAGE_KEYS.frameLimit.key)).toBe('60');
    expect(store.data.get(STORAGE_KEYS.charStyle.key)).toBe('classic');

    m = await fresh();
    m.chars.initCharStyle(null);
    expect(m.model.qualityNow()).toBe('low');
    expect(m.model.frameLimitNow()).toBe('60');
    expect(m.model.charStyleNow()).toBe('classic');
    expect(m.prefs.pref('reduceFlash')).toBe(true);
    expect(m.prefs.pref('volSfx')).toBe(35);
    expect(m.model.qualityIsDefault()).toBe(false);
    expect(m.model.frameLimitIsDefault()).toBe(false);
    expect(m.model.charStyleIsDefault()).toBe(false);
  });

  it('주소 옵션이 우선: 보이는 값은 주소 값이고, 고르기는 무시되며 줄이 잠긴다', async () => {
    store.data.set(STORAGE_KEYS.quality.key, 'high');
    store.data.set(STORAGE_KEYS.charStyle.key, 'new');
    const m = await fresh();
    const applied: string[] = [];
    m.quality.qualityHooks.choose = (c) => applied.push(`q:${c}`);
    m.pacing.pacingHooks.setLimit = (l) => applied.push(`f:${l}`);
    m.model.initSettingsUrl({ quality: 'low', fpsLimit: '120' });
    m.chars.initCharStyle('classic');
    expect(m.model.qualityNow()).toBe('low');
    expect(m.model.frameLimitNow()).toBe('120');
    expect(m.model.charStyleNow()).toBe('classic');
    expect(m.model.urlLock('quality')).toBe('?quality=low');
    expect(m.model.urlLock('frameLimit')).toBe('?fpsLimit=120');
    expect(m.model.urlLock('charStyle')).toBe('?chars=classic');
    m.model.chooseQuality('medium');
    m.model.chooseFrameLimit('60');
    m.model.chooseCharStyle('new');
    expect(applied).toEqual([]);
    expect(m.model.qualityNow()).toBe('low');
    expect(m.model.charStyleNow()).toBe('classic');
    // 저장값은 그대로 (주소 값은 저장하지 않는다)
    expect(store.data.get(STORAGE_KEYS.quality.key)).toBe('high');
    expect(store.data.get(STORAGE_KEYS.charStyle.key)).toBe('new');
  });

  it('잠긴 줄을 되돌리면 저장값만 지우고 이번 접속에는 주소 값이 남는다', async () => {
    store.data.set(STORAGE_KEYS.quality.key, 'high');
    const m = await fresh();
    const applied: string[] = [];
    m.quality.qualityHooks.choose = (c) => applied.push(`q:${c}`);
    m.model.initSettingsUrl({ quality: 'low', fpsLimit: null });
    expect(m.model.qualityIsDefault()).toBe(false);
    expect(m.model.resetQuality()).toBe(true);
    expect(store.data.has(STORAGE_KEYS.quality.key)).toBe(false);
    expect(applied).toEqual([]);
    expect(m.model.qualityNow()).toBe('low');
    expect(m.model.qualityIsDefault()).toBe(true);
  });

  it('항목별 되돌리기: 품질 · 프레임 제한은 자동, 캐릭터는 새 캐릭터, 진동은 켜짐', async () => {
    const m = await fresh();
    const applied: string[] = [];
    m.quality.qualityHooks.choose = (c) => applied.push(`q:${c}`);
    m.pacing.pacingHooks.setLimit = (l) => applied.push(`f:${l}`);
    m.chars.initCharStyle(null);
    m.model.chooseQuality('medium');
    m.model.chooseFrameLimit('120');
    m.model.chooseCharStyle('classic');
    const { haptics } = await import('../../client/src/haptics');
    haptics.setEnabled(false);
    expect(m.model.hapticsIsDefault()).toBe(false);
    m.model.resetQuality();
    m.model.resetFrameLimit();
    m.model.resetCharStyleSetting();
    m.model.resetHaptics();
    expect(m.model.qualityNow()).toBe('auto');
    expect(m.model.frameLimitNow()).toBe('auto');
    expect(m.model.charStyleNow()).toBe('new');
    expect(m.model.hapticsIsDefault()).toBe(true);
    expect(applied.slice(-2)).toEqual(['q:auto', 'f:auto']);
    for (const k of ['quality', 'frameLimit', 'charStyle', 'haptics'] as const)
      expect(store.data.has(STORAGE_KEYS[k].key), k).toBe(false);
  });

  it('모두 기본값으로: 그래픽 · 화면 · 소리 · 진동 · 조작 배치 저장값이 모두 사라진다', async () => {
    const m = await fresh();
    m.chars.initCharStyle(null);
    m.model.chooseQuality('high');
    m.model.chooseFrameLimit('60');
    m.model.chooseCharStyle('classic');
    m.prefs.setPref('uiSize', 'xlarge');
    m.prefs.setPref('muted', true);
    m.prefs.setPref('stickSize', 120);
    store.data.set(STORAGE_KEYS.haptics.key, '0');
    store.data.set(STORAGE_KEYS.controlLayout.key, '{"v":1}');
    expect(m.model.controlLayoutCustomized()).toBe(true);
    expect(m.model.resetAllSettings()).toBe(true);
    for (const k of ['quality', 'frameLimit', 'charStyle', 'settings', 'haptics', 'controlLayout'] as const)
      expect(store.data.has(STORAGE_KEYS[k].key), k).toBe(false);
    expect(m.prefs.pref('uiSize')).toBe('normal');
    expect(m.model.charStyleNow()).toBe('new');
    expect(m.model.controlLayoutCustomized()).toBe(false);
  });

  it('저장소가 막혀도 고른 값은 이번 접속에 적용되고 false를 돌려준다', async () => {
    store = memoryStorage(true);
    vi.stubGlobal('localStorage', store);
    const m = await fresh();
    const applied: string[] = [];
    m.quality.qualityHooks.choose = (c) => applied.push(`q:${c}`);
    expect(m.model.chooseQuality('low')).toBe(false);
    expect(m.model.qualityNow()).toBe('low');
    expect(applied).toEqual(['q:low']);
    expect(m.prefs.setPref('perfChip', true)).toBe(false);
    expect(m.prefs.pref('perfChip')).toBe(true);
    expect(m.model.resetAllSettings()).toBe(false);
  });

  it('판 중에는 그래픽 · 화면 · 소리 탭만 (조작 탭 · 배치 편집은 로비에서만)', async () => {
    const m = await fresh();
    expect(m.model.tabsFor('match')).toEqual(['graphics', 'screen', 'sound']);
    expect(m.model.tabsFor('lobby')).toEqual(['graphics', 'screen', 'sound', 'controls']);
  });
});
