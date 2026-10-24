// 캐릭터 스타일 설정 (캐릭터 리디자인 2단계, client/src/gfx/charStyle.ts): 기본값 새 캐릭터(설정 화면 통합) · 정하는 순서 · 저장 · 알림
import { afterEach, describe, expect, it } from 'vitest';
import {
  charStyleSource,
  currentCharStyle,
  initCharStyle,
  onCharStyleChange,
  parseCharStyle,
  resetCharStyle,
  resetCharStyleForTest,
  setCharStyle,
  urlCharStyle,
} from '../../client/src/gfx/charStyle';
import { gfxState } from '../../client/src/gfx/state';
import { STORAGE_KEYS, type StorageLike } from '../../client/src/storageKeys';

const KEY = STORAGE_KEYS.charStyle.key;

/** 메모리 저장소 (broken = 쓰기 · 지우기가 예외) */
function memory(
  init: Record<string, string> = {},
  broken = false,
): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (broken) throw new Error('가득 참');
      data.set(k, v);
    },
    removeItem: (k) => {
      if (broken) throw new Error('막힘');
      data.delete(k);
    },
  };
}

afterEach(() => resetCharStyleForTest());

describe('캐릭터 스타일 설정', () => {
  it('저장값 해석: new · classic만 (앞뒤 공백 · 대소문자 무시), 그 밖에는 null', () => {
    expect(parseCharStyle('new')).toBe('new');
    expect(parseCharStyle(' Classic ')).toBe('classic');
    for (const bad of [null, undefined, '', 'old', 'NEW1', '1'])
      expect(parseCharStyle(bad), String(bad)).toBeNull();
  });

  it('기본값은 새 캐릭터 (저장값 · 주소 값 없음)', () => {
    initCharStyle(null, memory());
    expect(currentCharStyle()).toBe('new');
    expect(charStyleSource()).toBe('default');
    expect(gfxState.charStyle).toBe('new');
  });

  it("이미 '기존'을 저장한 기기는 기본값이 바뀌어도 기존 그대로", () => {
    initCharStyle(null, memory({ [KEY]: 'classic' }));
    expect(currentCharStyle()).toBe('classic');
    expect(charStyleSource()).toBe('saved');
    expect(gfxState.charStyle).toBe('classic');
  });

  it('고르면 바로 적용 · 저장한다 — 기본값(새 캐릭터)을 골라도 적어 둔다', () => {
    const st = memory();
    expect(setCharStyle('classic', true, st)).toBe(true);
    expect(st.data.get(KEY)).toBe('classic');
    expect(currentCharStyle()).toBe('classic');
    expect(gfxState.charStyle).toBe('classic');
    expect(setCharStyle('new', true, st)).toBe(true);
    expect(st.data.get(KEY)).toBe('new');
    expect(currentCharStyle()).toBe('new');
  });

  it('기본값으로 되돌리기: 저장값을 지우고 새 캐릭터로 (바뀌면 알림)', () => {
    const st = memory({ [KEY]: 'classic' });
    initCharStyle(null, st);
    const seen: string[] = [];
    onCharStyleChange((x) => seen.push(x));
    expect(resetCharStyle(st)).toBe(true);
    expect(st.data.has(KEY)).toBe(false);
    expect(currentCharStyle()).toBe('new');
    expect(charStyleSource()).toBe('default');
    expect(seen).toEqual(['new']);
  });

  it('주소 값이 있으면 되돌려도 주소 값이 남고, 주소 값을 알려 준다', () => {
    const st = memory({ [KEY]: 'new' });
    initCharStyle('classic', st);
    expect(urlCharStyle()).toBe('classic');
    resetCharStyle(st);
    expect(currentCharStyle()).toBe('classic');
    expect(charStyleSource()).toBe('url');
    expect(st.data.has(KEY)).toBe(false);
  });

  it('저장하지 못해도 이번 접속에는 적용되고 false를 돌려준다', () => {
    const st = memory({}, true);
    expect(setCharStyle('classic', true, st)).toBe(false);
    expect(currentCharStyle()).toBe('classic');
  });

  it('디버그 훅 경로(persist = false)는 저장소를 건드리지 않는다', () => {
    const st = memory({ [KEY]: 'new' });
    setCharStyle('classic', false, st);
    expect(st.data.get(KEY)).toBe('new');
    expect(currentCharStyle()).toBe('classic');
  });

  it('정하는 순서: 이번 접속 선택 > 주소 ?chars > 저장값 > 새 캐릭터', () => {
    initCharStyle('new');
    expect(currentCharStyle()).toBe('new');
    expect(charStyleSource()).toBe('url');
    setCharStyle('classic', false);
    expect(currentCharStyle()).toBe('classic');
    expect(charStyleSource()).toBe('choice');
  });

  it('주소 ?chars가 저장값보다 먼저이고, 주소 값은 저장하지 않는다', () => {
    const st = memory({ [KEY]: 'new' });
    initCharStyle('classic', st);
    expect(currentCharStyle()).toBe('classic');
    expect(charStyleSource()).toBe('url');
    expect(st.data.get(KEY)).toBe('new');
    resetCharStyleForTest();
    const empty = memory();
    initCharStyle('new', empty);
    expect(currentCharStyle()).toBe('new');
    expect(empty.data.has(KEY)).toBe(false);
  });

  it('주소 값이 없으면 저장값을 쓴다 (저장 new → 새 캐릭터)', () => {
    initCharStyle(null, memory({ [KEY]: 'new' }));
    expect(currentCharStyle()).toBe('new');
    expect(charStyleSource()).toBe('saved');
    expect(gfxState.charStyle).toBe('new');
  });

  it('바뀔 때만 알리고, 해제하면 더 부르지 않는다', () => {
    const seen: string[] = [];
    const off = onCharStyleChange((s) => seen.push(s));
    setCharStyle('new', false);
    setCharStyle('classic', false);
    setCharStyle('classic', false);
    off();
    setCharStyle('new', false);
    expect(seen).toEqual(['classic']);
  });
});
