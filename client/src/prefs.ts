// 설정 저장소 (설정 화면 통합): 화면 · 소리 · 조작 탭의 새 설정을 한 키('decoy:settings', JSON)에 둔다.
// 그래픽 탭(품질 · 프레임 제한 · 캐릭터 스타일)과 진동은 예전 키 · 동작을 그대로 쓴다(gfx/quality · gfx/framePacing ·
// gfx/charStyle · haptics) — 이 파일은 새 설정만 맡는다.
// 모든 설정은 화면 표시 · 소리 · 터치 화면만 바꾼다. 규칙 · 판정 · 서버로 보내는 값과 무관하다(서버로 보내지 않는다).
// 저장: 기본값이 아닌 값만 JSON으로 적고, 모두 기본값이면 키를 지운다. 저장이 막혀도(사생활 보호 · 가득 참) 이번 접속에는
// 고른 값이 적용된다(set이 false를 돌려준다 — 화면이 '저장되지 않아요' 안내를 띄운다). 저장소는 처음 한 번만 읽는다.
// Phaser · DOM을 import하지 않는다(단위 시험)
import { readKey, removeKey, writeKey, type StorageLike } from './storageKeys';

/** UI 크기: 보통 · 크게 · 아주 크게 (작게는 없다 — 터치 HUD 글자 하한 12 · 14px를 지킨다) */
export type UiSize = 'normal' | 'large' | 'xlarge';
export const UI_SIZES: readonly UiSize[] = ['normal', 'large', 'xlarge'];
/** UI 크기 배율 (DOM 화면 · 터치 판 HUD 그림과 글자) */
export const UI_SIZE_SCALE: Record<UiSize, number> = { normal: 1, large: 1.15, xlarge: 1.3 };

/** 조이스틱 크기 (%, 이동 · 조준 스틱 반지름 배율) */
export const STICK_SIZE = { min: 80, max: 130, step: 5, def: 100 } as const;
/** 조이스틱 투명도 (%, 0 = 지금 그대로 불투명도, 높을수록 비친다) */
export const STICK_CLEAR = { min: 0, max: 60, step: 10, def: 0 } as const;
/** 음량 (%) */
export const VOLUME = { min: 0, max: 100, step: 5 } as const;

export interface Prefs {
  /** 화면: UI 크기 */
  uiSize: UiSize;
  /** 화면: 화면 흔들림 줄이기 (켜면 카메라 흔들림 0 — OS '동작 줄이기'와 같은 값) */
  reduceShake: boolean;
  /** 화면: 번쩍임 줄이기 (피격 붉은 테두리를 옅게, 잘라 옮길 때 어두워짐 없음, 발각 테두리 맥동 없음) */
  reduceFlash: boolean;
  /** 화면: 판 중 FPS · 핑 작은 칩 (?debug=1 오버레이와 별개) */
  perfChip: boolean;
  /** 소리: 전체 · 효과음 · UI 음량 (%) */
  volMaster: number;
  volSfx: number;
  volUi: number;
  /** 소리: 음소거 */
  muted: boolean;
  /** 조작(터치): 조이스틱 크기 (%) */
  stickSize: number;
  /** 조작(터치): 조이스틱 투명도 (%) */
  stickClear: number;
}

export type PrefKey = keyof Prefs;

export const PREF_DEFAULTS: Readonly<Prefs> = Object.freeze({
  uiSize: 'normal',
  reduceShake: false,
  reduceFlash: false,
  perfChip: false,
  volMaster: 100,
  volSfx: 100,
  volUi: 60,
  muted: false,
  stickSize: STICK_SIZE.def,
  stickClear: STICK_CLEAR.def,
});

export const PREF_KEYS = Object.keys(PREF_DEFAULTS) as PrefKey[];

/** 저장 형식 판 (모양이 바뀌면 올린다. 다른 판은 읽지 않는다 → 기본값) */
export const PREFS_VERSION = 1;

/** 범위 안 정수로 (step 칸에 맞춘다). 수가 아니면 null */
function stepped(v: unknown, min: number, max: number, step: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const c = Math.max(min, Math.min(max, v));
  return Math.round((c - min) / step) * step + min;
}

/** 한 칸 검사: 맞으면 정리한 값, 아니면 null (그 칸은 기본값으로) */
export function cleanPref<K extends PrefKey>(key: K, v: unknown): Prefs[K] | null {
  const out = (x: unknown): Prefs[K] => x as Prefs[K];
  switch (key) {
    case 'uiSize':
      return typeof v === 'string' && (UI_SIZES as readonly string[]).includes(v) ? out(v) : null;
    case 'reduceShake':
    case 'reduceFlash':
    case 'perfChip':
    case 'muted':
      return typeof v === 'boolean' ? out(v) : null;
    case 'volMaster':
    case 'volSfx':
    case 'volUi': {
      const n = stepped(v, VOLUME.min, VOLUME.max, VOLUME.step);
      return n === null ? null : out(n);
    }
    case 'stickSize': {
      const n = stepped(v, STICK_SIZE.min, STICK_SIZE.max, STICK_SIZE.step);
      return n === null ? null : out(n);
    }
    case 'stickClear': {
      const n = stepped(v, STICK_CLEAR.min, STICK_CLEAR.max, STICK_CLEAR.step);
      return n === null ? null : out(n);
    }
    default:
      return null;
  }
}

/** 저장값 → 설정. 깨진 JSON · 다른 판 · 모르는 칸은 버리고, 칸마다 이상한 값이면 그 칸만 기본값 */
export function parsePrefs(raw: string | null): Prefs {
  const p: Prefs = { ...PREF_DEFAULTS };
  if (raw === null) return p;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return p;
  }
  if (!obj || typeof obj !== 'object' || (obj as { v?: unknown }).v !== PREFS_VERSION) return p;
  const rec = obj as Record<string, unknown>;
  const w = p as unknown as Record<PrefKey, unknown>;
  for (const k of PREF_KEYS) {
    if (!(k in rec)) continue;
    const c = cleanPref(k, rec[k]);
    if (c !== null) w[k] = c;
  }
  return p;
}

/** 설정 → 저장값 (기본값이 아닌 칸만). 모두 기본값이면 null (키를 지운다) */
export function serializePrefs(p: Readonly<Prefs>): string | null {
  const out: Record<string, unknown> = { v: PREFS_VERSION };
  let any = false;
  for (const k of PREF_KEYS) {
    if (p[k] === PREF_DEFAULTS[k]) continue;
    out[k] = p[k];
    any = true;
  }
  return any ? JSON.stringify(out) : null;
}

// ───────────── 지금 값 (앱 전체에서 하나) ─────────────

let current: Prefs | null = null;
/** 시험용 저장소 (null이면 브라우저 저장소) */
let store: StorageLike | null | undefined;

type Listener = (key: PrefKey | null) => void;
const listeners = new Set<Listener>();

function load(): Prefs {
  current ??= parsePrefs(readKey('settings', '', store));
  return current;
}

function persist(): boolean {
  const raw = serializePrefs(load());
  return raw === null ? removeKey('settings', '', store) : writeKey('settings', raw, '', store);
}

function notify(key: PrefKey | null): void {
  for (const fn of [...listeners]) fn(key);
}

/** 지금 설정 하나 */
export function pref<K extends PrefKey>(key: K): Prefs[K] {
  return load()[key];
}

/** 지금 설정 전부 (읽기 전용) */
export function allPrefs(): Readonly<Prefs> {
  return load();
}

/**
 * 설정 하나를 바꾸고 저장한다. 바로 적용(구독자에게 알림)되고, 저장하지 못하면 false (이번 접속에는 적용).
 * 이상한 값이면 아무것도 바꾸지 않고 true
 */
export function setPref<K extends PrefKey>(key: K, value: Prefs[K]): boolean {
  const c = cleanPref(key, value);
  if (c === null) return true;
  const p = load();
  const changed = p[key] !== c;
  p[key] = c;
  const ok = persist();
  if (changed) notify(key);
  return ok;
}

/** 설정 하나를 기본값으로 */
export function resetPref(key: PrefKey): boolean {
  return setPref(key, PREF_DEFAULTS[key]);
}

/** 여러 칸을 한 번에 기본값으로 (탭 · 전체 되돌리기). 바뀐 칸마다 알린다 */
export function resetPrefs(keys: readonly PrefKey[] = PREF_KEYS): boolean {
  const p = load();
  const changed: PrefKey[] = [];
  const w = p as unknown as Record<PrefKey, unknown>;
  for (const k of keys) {
    if (p[k] === PREF_DEFAULTS[k]) continue;
    w[k] = PREF_DEFAULTS[k];
    changed.push(k);
  }
  const ok = persist();
  for (const k of changed) notify(k);
  return ok;
}

/** 이 칸이 기본값인가 */
export function isDefaultPref(key: PrefKey): boolean {
  return load()[key] === PREF_DEFAULTS[key];
}

/** 설정이 바뀌면 불린다 (key = 바뀐 칸) */
export function onPrefsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ───────────── 적용 값 (순수, 각 모듈이 쓴다) ─────────────

/** UI 크기 배율 */
export function uiScaleOf(p: Readonly<Prefs> = load()): number {
  return UI_SIZE_SCALE[p.uiSize];
}

/** 카메라 흔들림 세기 배율 (camera.ts ScreenShake.scale): 흔들림 줄이기 또는 OS '동작 줄이기'면 0 */
export function shakeScaleOf(osReduceMotion: boolean, p: Readonly<Prefs> = load()): number {
  return p.reduceShake || osReduceMotion ? 0 : 1;
}

/** 소리 세기 (0~1): 음소거면 모두 0. 효과음 · UI 묶음은 전체 음량 아래에 이어진다(소리 = 전체 × 묶음) */
export function audioLevelsOf(p: Readonly<Prefs> = load()): { master: number; sfx: number; ui: number } {
  if (p.muted) return { master: 0, sfx: 0, ui: 0 };
  const m = p.volMaster / 100;
  return { master: m, sfx: p.volSfx / 100, ui: p.volUi / 100 };
}

/** 조이스틱 반지름 배율 */
export function stickScaleOf(p: Readonly<Prefs> = load()): number {
  return p.stickSize / 100;
}

/** 조이스틱 불투명도 배율 (1 = 지금 그대로) */
export function stickAlphaOf(p: Readonly<Prefs> = load()): number {
  return 1 - p.stickClear / 100;
}

// ───────────── 시험용 ─────────────

/** 시험용: 상태를 처음으로 (storage = 가짜 저장소, 없으면 브라우저 저장소) */
export function resetPrefsForTest(storage?: StorageLike | null): void {
  current = null;
  store = storage;
  listeners.clear();
}
