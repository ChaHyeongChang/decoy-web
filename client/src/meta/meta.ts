// 내 성장 기록 상태 (GAME_DESIGN 12장): 저장소에서 한 번 읽어 메모리에 두고, 판 결과의 평가로 경험치를 적립해 저장한다.
// 적립 계산은 공용 순수 함수(shared/src/meta) — 계정 모드에서는 서버가 같은 계산을 한다.
// 저장이 안 되면 이번 접속 동안 메모리에만 두고(결과 화면에 한 줄 안내) 게임은 그대로 간다.
// 저장소는 바꿔 끼운다 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 7절): 게스트는 기기(`decoy:progress`), 로그인하면 계정(서버).
// 계정 모드에서는 기록을 서버만 쓴다 — 받기 · 해금 · 입기는 계정 API로(실패하면 기록을 바꾸지 않고 실패를 돌려준다. 기기 쪽으로
// 몰래 쓰지 않는다), 온라인 판 보상은 서버가 적립해 credit 메시지로 알린다(결과 화면은 같은 공용 함수의 미리보기 숫자 + 저장 상태).
// 봇과 연습은 서버가 판정하지 않아 계정에 적립하지 않는다(기기 기록에도 쓰지 않는다). 날짜 · 자정은 계정 시간대.
// 온라인 판은 그 자리에 서버가 받아들인 계정(welcome.account — 들어갈 때 화면이 밝힌 계정 = 쿠키 계정일 때만)으로 갈래를 정한다:
// 없음 → 기기 기록(계정 모드여도), 지금 계정 → credit을 기다림, 다른 계정(그사이 로그아웃 · 계정 바뀜) → 어디에도 적립하지 않음.
// 계정 모드의 일은 계정 저장소(AccountStore — account/serverStore.ts, 나눠 받는 조각 'account')가 맡고, 여기는 넘기기만 한다(첫 묶음을 작게)
import type { CostumeChoice, MatchRating, Team } from '@decoy/shared';
import {
  PROGRESSION,
  applyRating,
  buyCostume,
  claimLogin,
  dailyFor,
  dayKeyOf,
  emptyProfile,
  levelOf,
  loginAvailable,
  nextLoginStreak,
  wearCostume,
  type DailyState,
  type DayKey,
  type LevelInfo,
  type MatchGain,
  type Profile,
  type ProfileExtra,
  type Progression,
} from '@decoy/shared/meta';
import type { ProfileStore } from './profileStore';

/** 계정 모드 온라인 판 보상의 저장 상태: 기다림 → 저장함 · 못 함(서버가 알림) · 모름(20초 안에 알림이 없고 다시 읽어도 없음) */
export type AccountSaveState = 'pending' | 'saved' | 'failed' | 'unknown';

/** 판 하나의 계정 저장 상태 (결과 화면이 구독한다. 모름은 늦게 온 알림으로 바뀔 수 있다) — 만드는 쪽은 account/serverStore.ts */
export interface AccountCredit {
  readonly state: AccountSaveState;
  subscribe(fn: (s: AccountSaveState) => void): () => void;
}

export interface RatingApplied {
  rating: MatchRating;
  /** 새로 적립한 것 (이미 받은 판 · 계정 모드 연습 판이면 null). 계정 모드 온라인 판은 미리보기 */
  gain: MatchGain | null;
  /** 저장했는가 (false = 이번 접속 동안만, 기기 저장) */
  saved: boolean;
  /** 계정 모드 온라인 판: 서버 적립 상태 */
  account?: AccountCredit;
  /** 계정 모드 봇과 연습: 계정에 적립하지 않았다 */
  practice?: boolean;
  /** 계정 모드인데 게스트 자리였던 온라인 판: 이 기기 기록에 적립했다 */
  device?: boolean;
  /** 들어올 때의 계정 자리(지금 모드와 다름): 서버가 그 계정에 적립한다 — 화면은 어디에도 적립하지 않았다 */
  elsewhere?: boolean;
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
  /** 계정 API에 닿지 않았다 (기록은 그대로) */
  fail?: 'account';
}

/** 의상 해금 결과 (옷장). account = 계정 API에 닿지 않았다 (기록은 그대로) */
export type CostumeBought =
  | { ok: true; price: number; saved: boolean }
  | { ok: false; reason: 'unknown' | 'owned' | 'coins' | 'account' };

/** 의상 입기 결과 (못 입으면 null). account = 계정 API에 닿지 않았다 */
export interface CostumeWorn {
  saved: boolean;
  fail?: 'account';
}

/**
 * 계정 저장소 (선택형 구글 로그인 — 나눠 받는 조각의 account/serverStore.ts): 기록은 서버만 쓴다. 날짜 · 받기 · 해금 · 입기 ·
 * 판 보상 · credit을 맡고, 바뀐 기록은 MetaState.reload로 알린다 (첫 묶음에는 이 모양만)
 */
export interface AccountStore extends ProfileStore {
  readonly kind: 'server';
  /** 계정의 하루가 바뀌는 시간대 (IANA) */
  readonly timeZone: string;
  today(nowMs: number): DayKey;
  untilMidnight(nowMs: number): number;
  claimLogin(meta: MetaState): Promise<LoginClaimed | null>;
  buyCostume(meta: MetaState, team: Team, id: string): Promise<CostumeBought>;
  wearCostume(meta: MetaState, team: Team, id: string): Promise<CostumeWorn | null>;
  /** 이 계정 표시 (GET /api/account의 tag — join · quick에 밝힌다) */
  readonly tag: string;
  /**
   * 판 결과: 연습 판은 적립하지 않음. 온라인 판은 seat(그 자리에 서버가 받아들인 계정 tag, welcome.account)로 — 없음이면 기기 기록,
   * 이 계정이면 미리보기 + credit 기다리기, 다른 계정이면 적립하지 않음
   */
  rate(
    meta: MetaState,
    rating: MatchRating,
    practice: boolean,
    seat: string | null,
  ): RatingApplied | Promise<RatingApplied>;
  credit(meta: MetaState, matchId: string, ok: boolean, text: string | null): void;
  /** 앱으로 돌아옴 · 자정: 계정 기록을 다시 읽었으면 true */
  refresh(): Promise<boolean>;
  /** 이 저장소를 떠난다 (로그아웃 · 세션 끝 — 기다리던 판 보상은 '모름') */
  close(): void;
}

/** 기록 저장소: 기기 또는 계정 */
export type MetaStore = (ProfileStore & { readonly kind: 'device' }) | AccountStore;

export class MetaState {
  private profile: Profile;
  private extra: ProfileExtra = {};
  /** 더 높은 판의 기록: 보이기만 하고 저장하지 않는다 */
  private readOnly = false;
  /**
   * 메모리에만 있는 적립이 있다 (저장 실패 · 더 높은 판 기록). 이때는 저장소를 다시 읽어 메모리를 바꾸지 않는다 — 읽기는 되고
   * 쓰기만 막힌 저장소(가득 참 · 사생활 보호 창)에서 다시 읽으면 옛 기록으로 돌아가 적립과 받은 판 ID를 잃고, 같은 판 결과를
   * 다시 받으면(재접속) 또 적립했다
   */
  private unsaved = false;
  /** 계정 기록을 읽는 중 (레벨 칩 '…') */
  private wait = false;
  private readonly listeners = new Set<() => void>();
  readonly ready: Promise<void>;

  constructor(
    private store: MetaStore,
    /** 시계 (시험은 가짜 — 계정 저장소도 같은 시계로 미리보기를 계산한다) */
    readonly now: () => number = () => Date.now(),
    readonly prog: Progression = PROGRESSION,
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

  /** 기록을 어디에 두는가: 기기(게스트) · 계정(서버) */
  get mode(): 'device' | 'server' {
    return this.store.kind;
  }

  /** 계정 모드의 계정 표시 tag (게스트면 없음) — 판에 들어갈 때 join · quick에 밝힌다 */
  get tag(): string | undefined {
    return this.store.kind === 'server' ? this.store.tag : undefined;
  }

  /** 계정 모드의 시간대 (게스트면 null) */
  get timeZone(): string | null {
    return this.store.kind === 'server' ? this.store.timeZone : null;
  }

  /** 계정 기록을 읽는 중 (레벨 칩 '…') */
  get waiting(): boolean {
    return this.wait;
  }

  setWaiting(on: boolean): void {
    if (this.wait === on) return;
    this.wait = on;
    this.emit();
  }

  /** 저장소를 바꿔 끼운다 (로그인 · 로그아웃 · 계정 삭제 · 세션 끝): 새 저장소에서 다시 읽고 알린다 */
  async useStore(store: MetaStore): Promise<void> {
    if (store === this.store) return;
    await this.ready;
    const old = this.store;
    this.store = store;
    if (old.kind === 'server') old.close();
    this.unsaved = false;
    this.wait = false;
    const parsed = await store.load(this.now()).catch(() => null);
    if (this.store !== store) return;
    this.profile = parsed?.profile ?? emptyProfile(this.now());
    this.extra = parsed?.extra ?? {};
    this.readOnly = parsed?.status === 'newer';
    this.emit();
  }

  /** 계정 저장소가 기록을 바꿨다 (응답 · credit): 다시 읽고 알린다. 그사이 저장소가 바뀌었으면 하지 않는다 */
  async reload(from: MetaStore): Promise<void> {
    if (from !== this.store) return;
    await this.reread();
    if (from === this.store) this.emit();
  }

  level(): LevelInfo {
    return levelOf(this.profile.xp, this.prog);
  }

  /** 오늘 (게스트: 이 기기 날짜, 계정: 계정 시간대 날짜) */
  today(): DayKey {
    const s = this.store;
    return s.kind === 'server' ? s.today(this.now()) : localDay(this.now());
  }

  /** 다음 자정까지 ms (게스트: 이 기기 시간, 계정: 계정 시간대) — 칩 · 창을 다시 그리는 타이머 */
  untilMidnight(): number {
    const s = this.store;
    return s.kind === 'server' ? s.untilMidnight(this.now()) : msToMidnight(this.now());
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

  /**
   * 오늘 접속 보상 받기 (이미 받았으면 null). 게스트: 받기 직전에 저장소를 다시 읽는다(다른 탭에서 받았으면 두 번 주지 않게).
   * 계정: 서버가 계정 날짜로 계산한다 (닿지 않으면 fail — 기록은 그대로)
   */
  async claimLogin(): Promise<LoginClaimed | null> {
    await this.ready;
    const s = this.store;
    if (s.kind === 'server') return s.claimLogin(this);
    await this.reread();
    const r = claimLogin(this.profile, this.today(), this.now(), this.prog);
    if (!r) return null;
    this.profile = r.profile;
    this.emit();
    const saved = await this.persist();
    return { reward: r.reward, streak: r.streak, saved };
  }

  /** 입은 의상 (팀별, 가진 것만 — 판에 들어갈 때 서버로 보낸다) */
  costumes(): CostumeChoice {
    return { ...this.profile.wear };
  }

  /** 의상 해금 (불씨). 게스트: 해금 직전에 저장소를 다시 읽는다(다른 탭에서 불씨를 썼으면 그 위에서). 계정: 서버가 판단 */
  async buyCostume(team: Team, id: string): Promise<CostumeBought> {
    await this.ready;
    const s = this.store;
    if (s.kind === 'server') return s.buyCostume(this, team, id);
    await this.reread();
    const r = buyCostume(this.profile, team, id, this.now(), this.prog);
    if (!r.ok) {
      // 해금은 안 됐어도 다시 읽은 기록(다른 탭이 쓴 불씨 · 의상)을 보이는 쪽에 알린다
      this.emit();
      return r;
    }
    this.profile = r.profile;
    this.emit();
    const saved = await this.persist();
    return { ok: true, price: r.price, saved };
  }

  /** 의상 입기 (가진 것 · 기본만). 못 입으면 null, 입었으면 저장했는가 (게스트: 저장이 안 되면 이번 접속 동안만) */
  async wearCostume(team: Team, id: string): Promise<CostumeWorn | null> {
    await this.ready;
    const s = this.store;
    if (s.kind === 'server') return s.wearCostume(this, team, id);
    await this.reread();
    const next = wearCostume(this.profile, team, id, this.now());
    if (!next) {
      this.emit();
      return null;
    }
    // 이미 입은 의상(다른 탭이 그사이 같은 의상을 입었으면 다시 읽어 여기로 온다): 저장할 것은 없지만 다시 읽은 기록을
    // 알린다 — 앱이 내 역할 그림 · 방 자리 의상을 따라가게
    if (next === this.profile) {
      this.emit();
      return { saved: true };
    }
    this.profile = next;
    this.emit();
    return { saved: await this.persist() };
  }

  /**
   * 날이 바뀌었을 수 있다 (자정 · 앱으로 돌아옴): 보이는 것을 다시 그리게 알리고, 저장소를 다시 읽어 다른 탭(계정이면 다른
   * 기기)이 그사이 바꾼 기록(입은 의상 · 불씨 · 받은 보상)이 있으면 한 번 더 알린다
   */
  refresh(): void {
    this.emit();
    void this.ready
      .then(async () => {
        const s = this.store;
        const before = this.profile;
        if (s.kind === 'server' && !(await s.refresh())) return;
        await this.reread();
        if (this.profile !== before && s === this.store) this.emit();
      })
      .catch(() => undefined);
  }

  /**
   * 서버가 판 보상을 계정에 적립했다 (credit 메시지 — 같은 계정의 다른 탭 판도 온다). 지금 계정 tag 것만 받는다 — 게스트 · 다른
   * 계정 모드(그사이 계정이 바뀐 탭)는 무시한다
   */
  credit(tag: string, matchId: string, ok: boolean, text: string | null): void {
    const s = this.store;
    if (s.kind === 'server' && s.tag === tag) s.credit(this, matchId, ok, text);
  }

  private async reread(): Promise<void> {
    if (this.unsaved) return;
    const fresh = await this.store.load(this.now()).catch(() => null);
    if (fresh && (fresh.status === 'ok' || fresh.status === 'newer')) {
      this.profile = fresh.profile;
      this.extra = fresh.extra;
      this.readOnly = fresh.status === 'newer';
    }
  }

  private async persist(): Promise<boolean> {
    const saved = this.readOnly ? false : await this.store.save(this.profile, this.extra).catch(() => false);
    this.unsaved = !saved;
    return saved;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * 판 결과의 내 평가를 적립한다 (같은 판이면 gain null). practice = 기기 안 봇과 연습.
   * 게스트: 적립 직전에 저장소를 다시 읽는다 — 다른 탭이 그사이 적립했으면 그 위에 더한다(덮어써 잃지 않게, 같은 판 ID도
   * 거기서 걸러진다). 다시 읽지 못하면 메모리의 기록에 더한다.
   * 계정: 온라인 판은 같은 공용 함수로 미리보기만 하고 기록은 서버의 credit을 기다린다(계정 저장소가 곧바로 기다림을 건다 —
   * credit이 이 함수가 끝나기 전에 와도 놓치지 않게). 연습 판은 적립하지 않는다(기기 기록에도 쓰지 않는다).
   * seat = 그 자리에 서버가 받아들인 계정 tag (welcome.account, 게스트 자리 · 연습이면 null). 서버는 그 계정에만 적립하므로:
   * 계정 모드여도 null이면 기기 기록에, 게스트 모드인데 계정 자리(들어온 뒤 로그아웃 · 다른 탭에서 바뀜)면 어디에도 적립하지 않는다
   */
  async applyRating(
    rating: MatchRating,
    practice = false,
    seat: string | null = null,
  ): Promise<RatingApplied> {
    const s = this.store;
    if (s.kind === 'server') return s.rate(this, rating, practice, seat);
    if (seat !== null) return { rating, gain: null, saved: true, elsewhere: true };
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
