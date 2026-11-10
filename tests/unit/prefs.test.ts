// 설정 저장소 (설정 화면 통합, client/src/prefs.ts): 저장 · 복원 · 칸별 검사 · 되돌리기 · 막힌 저장소
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ATTACK_BUTTONS,
  PREFS_VERSION,
  PREF_DEFAULTS,
  PREF_KEYS,
  allPrefs,
  attackButtonOf,
  audioLevelsOf,
  isDefaultPref,
  onPrefsChange,
  parsePrefs,
  pref,
  resetPref,
  resetPrefs,
  resetPrefsForTest,
  serializePrefs,
  setPref,
  shakeScaleOf,
  stickAlphaOf,
  stickScaleOf,
  uiScaleOf,
} from '../../client/src/prefs';
import type { StorageLike } from '../../client/src/storageKeys';

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('설정 저장 형식', () => {
  it('기본값은 저장하지 않고(null), 바꾼 칸만 판 번호와 함께 적는다', () => {
    expect(serializePrefs(PREF_DEFAULTS)).toBeNull();
    const raw = serializePrefs({ ...PREF_DEFAULTS, uiSize: 'large', volSfx: 40, muted: true });
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ v: 1, uiSize: 'large', volSfx: 40, muted: true });
  });

  it('저장한 값을 그대로 읽는다 (왕복)', () => {
    const p = {
      ...PREF_DEFAULTS,
      uiSize: 'xlarge' as const,
      reduceShake: true,
      reduceFlash: true,
      perfChip: true,
      volMaster: 55,
      volSfx: 0,
      volUi: 100,
      muted: true,
      stickSize: 125,
      stickClear: 40,
      attackButton: 'instant' as const,
    };
    expect(parsePrefs(serializePrefs(p))).toEqual(p);
  });

  it("공격 버튼 방식: 기본 '끌어서 조준'(저장하지 않음), '누르면 바로'만 적는다 · 이상한 값은 그 칸만 기본값 · 저장 형식 판은 그대로 1", () => {
    expect(PREF_DEFAULTS.attackButton).toBe('drag');
    expect(ATTACK_BUTTONS).toEqual(['drag', 'instant']);
    expect(serializePrefs({ ...PREF_DEFAULTS, attackButton: 'drag' })).toBeNull();
    expect(JSON.parse(serializePrefs({ ...PREF_DEFAULTS, attackButton: 'instant' })!)).toEqual({
      v: 1,
      attackButton: 'instant',
    });
    // 칸을 더해도 판 번호를 올리지 않는다: 이 칸이 없는 예전 저장값을 그대로 읽는다 (올리면 모두의 설정이 지워진다)
    expect(PREFS_VERSION).toBe(1);
    const old = parsePrefs(JSON.stringify({ v: 1, uiSize: 'large', stickSize: 120 }));
    expect(old).toEqual({ ...PREF_DEFAULTS, uiSize: 'large', stickSize: 120 });
    for (const bad of ['tap', 'INSTANT', '', 1, true, null, ['instant']]) {
      const p = parsePrefs(JSON.stringify({ v: 1, attackButton: bad, muted: true }));
      expect(p.attackButton, String(bad)).toBe('drag');
      expect(p.muted).toBe(true);
    }
    expect(attackButtonOf(PREF_DEFAULTS)).toBe('drag');
    expect(attackButtonOf({ ...PREF_DEFAULTS, attackButton: 'instant' })).toBe('instant');
  });

  it('깨진 JSON · 다른 판 · 객체가 아님 → 모두 기본값', () => {
    for (const raw of [
      '{',
      '[]',
      '"x"',
      '1',
      JSON.stringify({ v: 2, uiSize: 'large' }),
      JSON.stringify({ uiSize: 'large' }),
    ])
      expect(parsePrefs(raw)).toEqual(PREF_DEFAULTS);
  });

  it('칸마다 따로 검사: 이상한 칸만 기본값, 범위 밖 수는 잘라 칸에 맞춘다', () => {
    const p = parsePrefs(
      JSON.stringify({
        v: 1,
        uiSize: 'huge',
        reduceShake: 'yes',
        perfChip: true,
        volMaster: 250,
        volSfx: -3,
        volUi: 42,
        stickSize: 200,
        stickClear: 33,
        extra: 1,
      }),
    );
    expect(p.uiSize).toBe('normal');
    expect(p.reduceShake).toBe(false);
    expect(p.perfChip).toBe(true);
    expect(p.volMaster).toBe(100);
    expect(p.volSfx).toBe(0);
    expect(p.volUi).toBe(40);
    expect(p.stickSize).toBe(130);
    expect(p.stickClear).toBe(30);
    expect(Object.keys(p).sort()).toEqual([...PREF_KEYS].sort());
  });
});

describe('설정 저장소', () => {
  let s: ReturnType<typeof mem>;
  beforeEach(() => {
    s = mem();
    resetPrefsForTest(s);
  });

  it('저장 → 새로 읽기(새 접속)에서 복원', () => {
    expect(setPref('reduceShake', true)).toBe(true);
    expect(setPref('volUi', 20)).toBe(true);
    expect(s.data.has('decoy:settings')).toBe(true);
    resetPrefsForTest(s);
    expect(pref('reduceShake')).toBe(true);
    expect(pref('volUi')).toBe(20);
    expect(pref('uiSize')).toBe('normal');
  });

  it('공격 버튼 방식: 고르면 저장되고 새 접속에서 복원, 이상한 값은 바꾸지 않는다, 항목별 · 모두 되돌리기에 든다', () => {
    const seen: (string | null)[] = [];
    onPrefsChange((k) => seen.push(k));
    expect(pref('attackButton')).toBe('drag');
    expect(setPref('attackButton', 'instant')).toBe(true);
    expect(JSON.parse(s.data.get('decoy:settings')!)).toEqual({ v: 1, attackButton: 'instant' });
    resetPrefsForTest(s);
    expect(pref('attackButton')).toBe('instant');
    expect(attackButtonOf()).toBe('instant');
    setPref('attackButton', 'hold' as never);
    expect(pref('attackButton')).toBe('instant');
    expect(isDefaultPref('attackButton')).toBe(false);
    resetPref('attackButton');
    expect(pref('attackButton')).toBe('drag');
    expect(s.data.has('decoy:settings')).toBe(false);
    setPref('attackButton', 'instant');
    setPref('muted', true);
    resetPrefs();
    expect(attackButtonOf()).toBe('drag');
    expect(s.data.has('decoy:settings')).toBe(false);
    expect(seen).toEqual(['attackButton']);
  });

  it('항목별 되돌리기 · 모두 되돌리기: 모두 기본값이면 키를 지운다', () => {
    setPref('perfChip', true);
    setPref('stickSize', 115);
    expect(isDefaultPref('perfChip')).toBe(false);
    resetPref('perfChip');
    expect(isDefaultPref('perfChip')).toBe(true);
    expect(s.data.has('decoy:settings')).toBe(true);
    resetPrefs();
    expect(allPrefs()).toEqual(PREF_DEFAULTS);
    expect(s.data.has('decoy:settings')).toBe(false);
  });

  it('바뀐 칸만 알린다 (같은 값 · 이상한 값은 알리지 않음)', () => {
    const seen: (string | null)[] = [];
    onPrefsChange((k) => seen.push(k));
    setPref('muted', true);
    setPref('muted', true);
    setPref('volMaster', Number.NaN);
    resetPrefs(['muted', 'volSfx']);
    expect(seen).toEqual(['muted', 'muted']);
  });

  it('막힌 저장소: 저장 실패(false)지만 이번 접속에는 적용', () => {
    resetPrefsForTest(broken);
    expect(setPref('uiSize', 'large')).toBe(false);
    expect(pref('uiSize')).toBe('large');
    resetPrefsForTest(null);
    expect(setPref('muted', true)).toBe(false);
    expect(pref('muted')).toBe(true);
  });
});

describe('적용 값', () => {
  it('흔들림: 줄이기나 OS 동작 줄이기면 0', () => {
    expect(shakeScaleOf(false, PREF_DEFAULTS)).toBe(1);
    expect(shakeScaleOf(true, PREF_DEFAULTS)).toBe(0);
    expect(shakeScaleOf(false, { ...PREF_DEFAULTS, reduceShake: true })).toBe(0);
  });

  it('소리: 음소거면 모두 0, 아니면 % → 0~1', () => {
    expect(audioLevelsOf({ ...PREF_DEFAULTS, volMaster: 50, volSfx: 80, volUi: 30 })).toEqual({
      master: 0.5,
      sfx: 0.8,
      ui: 0.3,
    });
    expect(audioLevelsOf({ ...PREF_DEFAULTS, muted: true })).toEqual({ master: 0, sfx: 0, ui: 0 });
  });

  it('UI 크기 · 조이스틱 배율: 기본값은 지금 그대로(1)이고 작게는 없다', () => {
    expect(uiScaleOf(PREF_DEFAULTS)).toBe(1);
    expect(uiScaleOf({ ...PREF_DEFAULTS, uiSize: 'large' })).toBeGreaterThan(1);
    expect(stickScaleOf(PREF_DEFAULTS)).toBe(1);
    expect(stickAlphaOf(PREF_DEFAULTS)).toBe(1);
    expect(stickAlphaOf({ ...PREF_DEFAULTS, stickClear: 60 })).toBeCloseTo(0.4);
  });
});
