// 진동 (MOBILE_PLAN M12 10번): 내가 맞았을 때 한 번, 발각이 꺼짐 → 켜짐으로 바뀔 때 짧게 두 번(이어지는 동안은 0번).
// 2초 넘게 지난 일에는 울리지 않는다. 사용자가 아직 화면을 누르지 않았으면(navigator.userActivation) 부르지 않는다
// (크롬이 막고 콘솔에 개입 경고를 낸다). 숨겨져 있거나, 숨김에서 돌아와 서버 시계를 다시 맞추기 전에도 울리지 않는다
// (기기가 잠들면 performance.now가 멈춰 '지난 시간'을 믿을 수 없다). 로비 설정에서 끌 수 있다(STORAGE_KEYS.haptics).
// 판 장면(GameScene)은 hit · spotted만 부른다. 판단은 순수 함수 hapticAllowed(tests/unit/haptics.test.ts)
import { readKey, removeKey, writeKey } from './storageKeys';

/** 이보다 오래된 일(서버 시각 기준)에는 울리지 않는다 (ms) */
export const HAPTIC_MAX_AGE_MS = 2000;
/** 진동 패턴 (ms): 맞음 = 한 번, 발각 = 짧게 두 번 */
export const HIT_PATTERN: readonly number[] = [70];
export const SPOTTED_PATTERN: readonly number[] = [35, 80, 35];

export interface HapticEnv {
  /** 진동 설정이 켜져 있다 */
  enabled: boolean;
  /** 사용자가 이 페이지를 눌러 본 적 있다 (navigator.userActivation.hasBeenActive) */
  activated: boolean;
  /** 화면이 보인다 */
  visible: boolean;
  /** 서버 시계를 믿을 수 있다 (숨김 · 잠자기에서 돌아와 다시 맞추기 전이면 false) */
  clockOk: boolean;
}

/** 진동해도 되는가. ageMs = 그 일이 일어난 뒤 지난 시간 (모르면 0, 시계 오차로 음수일 수 있다 · NaN이면 울리지 않음) */
export function hapticAllowed(ageMs: number, env: HapticEnv): boolean {
  return env.enabled && env.activated && env.visible && env.clockOk && ageMs <= HAPTIC_MAX_AGE_MS;
}

/** 발각 전환: 꺼짐 → 켜짐일 때만 참 */
export function spottedRose(prev: boolean, on: boolean): boolean {
  return !prev && on;
}

/** 진동 설정 저장값 → 켜짐 (저장 안 됨 · 이상한 값이면 켜짐) */
export function parseHapticsSetting(raw: string | null): boolean {
  return raw !== '0';
}

/** 브라우저 환경에서 읽는 것 (시험에서 바꿔 끼운다) */
export interface HapticDevice {
  vibrate: ((pattern: number[]) => boolean) | null;
  activated(): boolean;
  visible(): boolean;
}

function browserDevice(): HapticDevice {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    vibrate: nav && typeof nav.vibrate === 'function' ? (p) => nav.vibrate(p) : null,
    activated: () => nav?.userActivation?.hasBeenActive === true,
    visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  };
}

export class Haptics {
  private prevSpotted = false;
  private clockOk = true;
  /** 이번 접속에서 고른 값 (저장이 막혀도 적용) */
  private choice: boolean | null = null;
  /** 실제로 부른 진동 (최근 20개, 시험 · 디버그) */
  readonly log: { pattern: number[]; at: number }[] = [];

  constructor(private readonly device: HapticDevice = browserDevice()) {}

  /** 이 기기에서 진동을 쓸 수 있는가 (아이폰 사파리 등은 없다) */
  get supported(): boolean {
    return this.device.vibrate !== null;
  }

  /** 진동 설정 */
  get enabled(): boolean {
    return this.choice ?? parseHapticsSetting(readKey('haptics'));
  }

  /** 설정을 바꾼다. 저장하지 못하면 false (이번 접속에는 적용) */
  setEnabled(on: boolean): boolean {
    this.choice = on;
    return writeKey('haptics', on ? '1' : '0');
  }

  /** 설정을 기본값(켜짐)으로: 저장값을 지운다 (설정 화면 '기본값'). 지우지 못하면 false (이번 접속에는 켜짐) */
  resetSetting(): boolean {
    this.choice = null;
    const ok = removeKey('haptics');
    if (!ok) this.choice = true;
    return ok;
  }

  /** 내가 맞았다. ageMs = 그 일이 일어난 뒤 지난 시간(서버 시각 기준, 모르면 0) */
  hit(ageMs = 0): void {
    if (this.allowed(ageMs)) this.buzz(HIT_PATTERN);
  }

  /** 발각 상태 (스냅샷마다 불러도 된다: 꺼짐 → 켜짐으로 바뀔 때만 울린다). ageMs는 hit과 같다 */
  spotted(on: boolean, ageMs = 0): void {
    const rose = spottedRose(this.prevSpotted, on);
    this.prevSpotted = on;
    if (rose && this.allowed(ageMs)) this.buzz(SPOTTED_PATTERN);
  }

  /** 새 판: 발각 상태를 처음으로 */
  reset(): void {
    this.prevSpotted = false;
  }

  /** 숨겨졌다: 돌아와 서버 시계를 다시 맞출 때까지(clockSynced) 울리지 않는다 */
  holdClock(): void {
    this.clockOk = false;
  }

  /** 서버 시계를 다시 맞췄다 */
  clockSynced(): void {
    this.clockOk = true;
  }

  private allowed(ageMs: number): boolean {
    if (!this.device.vibrate) return false;
    return hapticAllowed(ageMs, {
      enabled: this.enabled,
      activated: this.device.activated(),
      visible: this.device.visible(),
      clockOk: this.clockOk,
    });
  }

  private buzz(pattern: readonly number[]): void {
    const p = pattern.slice();
    try {
      this.device.vibrate?.(p);
    } catch {
      // 막힌 환경 (권한 정책 등)
    }
    this.log.push({ pattern: p, at: Date.now() });
    if (this.log.length > 20) this.log.shift();
  }
}

/** 앱 전체에서 하나. 판 장면은 haptics.hit() · haptics.spotted(bool)만 부른다 */
export const haptics = new Haptics();
