// 내 성장 기록 상태 (GAME_DESIGN 12장): 저장소에서 한 번 읽어 메모리에 두고, 판 결과의 평가로 경험치를 적립해 저장한다.
// 적립 계산은 공용 순수 함수(shared/src/meta) — 나중에 서버 저장으로 바꾸면 서버가 같은 계산을 한다.
// 저장이 안 되면 이번 접속 동안 메모리에만 두고(결과 화면에 한 줄 안내) 게임은 그대로 간다
import type { MatchRating } from '@decoy/shared';
import {
  PROGRESSION,
  applyRating,
  claimLogin,
  dailyFor,
  dayKeyOf,
  emptyProfile,
  levelOf,
  loginAvailable,
  nextLoginStreak,
  type DailyState,
  type DayKey,
  type LevelInfo,
  type MatchGain,
  type Profile,
  type ProfileExtra,
  type Progression,
} from '@decoy/shared/meta';
import type { ProfileStore } from './profileStore';

export interface RatingApplied {
  rating: MatchRating;
  /** 새로 적립한 것 (이미 받은 판이면 null) */
  gain: MatchGain | null;
  /** 저장했는가 (false = 이번 접속 동안만) */
  saved: boolean;
}

/** 기기 시계 → 이 기기의 날짜 글 (자정 기준, 일일 도전 · 접속 보상) */
export function localDay(nowMs: number): DayKey {
  const d = new Date(nowMs);
  return dayKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** 다음 자정(이 기기 시간)까지 ms */
export function msToMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
  return Math.max(1, next - nowMs);
}

export interface LoginClaimed {
  reward: number;
  streak: number;
  saved: boolean;
}

export class MetaState {
  private profile: Profile;
  private extra: ProfileExtra = {};
  /** 더 높은 판의 기록: 보이기만 하고 저장하지 않는다 */
  private readOnly = false;
  private readonly listeners = new Set<() => void>();
  readonly ready: Promise<void>;

  constructor(
    private readonly store: ProfileStore,
    private readonly now: () => number = () => Date.now(),
    private readonly prog: Progression = PROGRESSION,
  ) {
    this.profile = emptyProfile(now());
    this.ready = store.load(now()).then(
      (parsed) => {
        this.profile = parsed.profile;
        this.extra = parsed.extra;
        this.readOnly = parsed.status === 'newer';
        this.emit();
      },
      () => undefined,
    );
  }

  get current(): Readonly<Profile> {
    return this.profile;
  }

  level(): LevelInfo {
    return levelOf(this.profile.xp, this.prog);
  }

  /** 오늘 (이 기기 날짜) */
  today(): DayKey {
    return localDay(this.now());
  }

  /** 오늘의 도전 (보이기용 — 다른 날 기록이면 오늘 것을 새로) */
  daily(): DailyState {
    return dailyFor(this.profile, this.today(), this.prog);
  }

  /** 오늘 접속 보상을 아직 받지 않았는가 · 받으면 몇 일째 연속인가 */
  login(): { available: boolean; streak: number } {
    const day = this.today();
    return {
      available: loginAvailable(this.profile, day),
      streak: nextLoginStreak(this.profile, day, this.prog),
    };
  }

  /** 오늘 접속 보상 받기 (이미 받았으면 null). 받기 직전에 저장소를 다시 읽는다(다른 탭에서 받았으면 두 번 주지 않게) */
  async claimLogin(): Promise<LoginClaimed | null> {
    await this.ready;
    await this.reread();
    const r = claimLogin(this.profile, this.today(), this.now(), this.prog);
    if (!r) return null;
    this.profile = r.profile;
    this.emit();
    const saved = await this.persist();
    return { reward: r.reward, streak: r.streak, saved };
  }

  /** 날이 바뀌었을 수 있다 (자정 · 앱으로 돌아옴): 보이는 것을 다시 그리게 알린다 */
  refresh(): void {
    this.emit();
  }

  private async reread(): Promise<void> {
    const fresh = await this.store.load(this.now()).catch(() => null);
    if (fresh && (fresh.status === 'ok' || fresh.status === 'newer')) {
      this.profile = fresh.profile;
      this.extra = fresh.extra;
      this.readOnly = fresh.status === 'newer';
    }
  }

  private async persist(): Promise<boolean> {
    if (this.readOnly) return false;
    return this.store.save(this.profile, this.extra).catch(() => false);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * 판 결과의 내 평가를 적립한다 (같은 판이면 gain null). 적립 직전에 저장소를 다시 읽는다: 다른 탭이 그사이 적립했으면 그 위에
   * 더한다(덮어써 잃지 않게, 같은 판 ID도 거기서 걸러진다). 다시 읽지 못하면 메모리의 기록에 더한다
   */
  async applyRating(rating: MatchRating): Promise<RatingApplied> {
    await this.ready;
    await this.reread();
    const applied = applyRating(this.profile, rating, this.now(), this.prog, this.today());
    if (!applied) return { rating, gain: null, saved: true };
    this.profile = applied.profile;
    this.emit();
    const saved = await this.persist();
    return { rating, gain: applied.gain, saved };
  }
}
