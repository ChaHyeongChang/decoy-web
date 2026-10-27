// 내 성장 기록 상태 (GAME_DESIGN 12장): 저장소에서 한 번 읽어 메모리에 두고, 판 결과의 평가로 경험치를 적립해 저장한다.
// 적립 계산은 공용 순수 함수(shared/src/meta) — 나중에 서버 저장으로 바꾸면 서버가 같은 계산을 한다.
// 저장이 안 되면 이번 접속 동안 메모리에만 두고(결과 화면에 한 줄 안내) 게임은 그대로 간다
import type { MatchRating } from '@decoy/shared';
import {
  PROGRESSION,
  applyRating,
  emptyProfile,
  levelOf,
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
    const fresh = await this.store.load(this.now()).catch(() => null);
    if (fresh && (fresh.status === 'ok' || fresh.status === 'newer')) {
      this.profile = fresh.profile;
      this.extra = fresh.extra;
      this.readOnly = fresh.status === 'newer';
    }
    const applied = applyRating(this.profile, rating, this.now(), this.prog);
    if (!applied) return { rating, gain: null, saved: true };
    this.profile = applied.profile;
    this.emit();
    const saved = this.readOnly ? false : await this.store.save(this.profile, this.extra).catch(() => false);
    return { rating, gain: applied.gain, saved };
  }
}
