// 계정 기록 저장소 (선택형 구글 로그인, MetaState의 AccountStore — kind 'server'). 나눠 받는 조각 'account'에 든다.
// 기록은 서버만 쓴다: 이 저장소는 서버가 준 마지막 기록 글을 들고 있다가 읽어 주기만 하고(save는 늘 false — 기기가 보낸 기록은
// 믿지 않는다), 접속 보상 · 해금 · 입기는 계정 API로 요청해 응답의 기록 글로 바꾼다(닿지 않으면 기록을 그대로 두고 실패를 돌려준다 —
// 기기 쪽으로 몰래 쓰지 않는다). 온라인 판 보상은 서버가 판 평가로 적립해 credit 메시지로 기록 글을 보낸다: 결과 화면 숫자는 같은
// 공용 함수(applyRating)의 미리보기, 저장 상태는 credit을 기다린다(20초 안에 없으면 상태를 다시 읽어 그 판 ID가 있으면 저장됨,
// 없으면 모름). 봇과 연습은 적립하지 않는다. 이 계정으로 열지 않은 소켓(계정 모드가 되기 전 · 다른 계정)의 온라인 판은 서버가
// 소켓을 열 때의 쿠키로 계정을 정해 이 계정에 적립하지 않으니(app.ts) 기기 기록에 적립한다(보상을 잃지 않게). 날짜 · 자정은 계정 시간대(서버 설정). 세션이 끝났으면
// (401 · 로그인 안 함 · 다른 계정) · 꺼졌으면 lost를 불러 게스트로 돌아가게 한다
import type { MatchRating, Team } from '@decoy/shared';
import type { ProfileStore } from '../meta/profileStore';
import {
  applyRating,
  dayKeyInZone,
  msToMidnightInZone,
  parseProfile,
  type DayKey,
  type ParsedProfile,
} from '@decoy/shared/meta';
import {
  localDay,
  type AccountCredit,
  type AccountSaveState,
  type AccountStore,
  type CostumeBought,
  type CostumeWorn,
  type LoginClaimed,
  type MetaState,
  type RatingApplied,
} from '../meta/meta';
import type { AccountApi, AccountCall } from './api';
import { claimLogin, costume, getStatus } from './calls';

/** credit 메시지를 기다리는 시간 (ms). 넘으면 계정 상태를 다시 읽어 판 ID가 있으면 저장된 것으로 본다 */
export const CREDIT_WAIT_MS = 20_000;
/** 앱으로 돌아올 때 계정 기록을 다시 읽는 최소 간격 (ms) */
export const SYNC_GAP_MS = 15_000;

/** 판 하나의 계정 저장 상태. 저장함 · 못 함은 끝, 모름은 늦게 온 credit으로 바뀔 수 있다 */
export class CreditState implements AccountCredit {
  state: AccountSaveState = 'pending';
  private readonly fns = new Set<(s: AccountSaveState) => void>();

  set(s: AccountSaveState): void {
    if (s === this.state || this.state === 'saved' || this.state === 'failed') return;
    this.state = s;
    for (const fn of this.fns) fn(s);
  }

  subscribe(fn: (s: AccountSaveState) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}

export class ServerProfileStore implements AccountStore {
  readonly kind = 'server';
  /** credit을 기다리는 판 (판 ID → 상태) */
  private readonly credits = new Map<string, CreditState>();
  /** 계정 기록을 마지막으로 다시 읽은 시각 (시계 = MetaState와 같은 것) */
  private syncedAt: number;
  private closed = false;

  constructor(
    private readonly api: AccountApi,
    /** 계정 기록 글 (아직 없으면 null — 빈 기록) */
    private text: string | null,
    /** 계정의 하루가 바뀌는 시간대 (IANA) */
    readonly timeZone: string,
    /** 이 계정 표시 */
    readonly tag: string,
    /** 세션이 끝났다 · 꺼졌다(off) (게스트로 돌아간다) */
    private readonly lost: (off: boolean) => void = () => undefined,
    private readonly clock: () => number = () => Date.now(),
    /** 게스트 기록 저장소 (이 계정으로 열지 않은 소켓의 온라인 판을 적립한다) */
    private readonly device: ProfileStore | null = null,
  ) {
    this.syncedAt = clock();
  }

  load(nowMs: number): Promise<ParsedProfile> {
    return Promise.resolve(parseProfile(this.text, nowMs));
  }

  /** 계정 기록은 서버만 쓴다 (기기가 보낸 기록은 믿지 않는다) */
  save(): Promise<boolean> {
    return Promise.resolve(false);
  }

  today(nowMs: number): DayKey {
    return dayKeyInZone(nowMs, this.timeZone);
  }

  untilMidnight(nowMs: number): number {
    return msToMidnightInZone(nowMs, this.timeZone);
  }

  /** 계정 상태를 다시 읽는다. ok = 기록을 새로 받음, lost = 세션이 끝났다, fail = 닿지 않음 */
  async sync(): Promise<'ok' | 'lost' | 'fail'> {
    this.syncedAt = this.clock();
    const r = await getStatus(this.api);
    if (r.ok && r.body.on && r.body.signedIn && r.body.tag === this.tag) {
      this.text = r.body.profile;
      return 'ok';
    }
    if (r.ok || r.error === 'auth') {
      this.lost(r.ok && !r.body.on);
      return 'lost';
    }
    return 'fail';
  }

  /** 앱으로 돌아옴 · 자정: 15초에 한 번까지 다시 읽는다 */
  async refresh(): Promise<boolean> {
    if (this.clock() - this.syncedAt < SYNC_GAP_MS) return false;
    return (await this.sync()) === 'ok';
  }

  async claimLogin(meta: MetaState): Promise<LoginClaimed | null> {
    const r = await this.took(meta, claimLogin(this.api));
    if (!r.ok) return { reward: 0, streak: 0, saved: false, fail: 'account' };
    return r.body.claimed ? { ...r.body.claimed, saved: true } : null;
  }

  async buyCostume(meta: MetaState, team: Team, id: string): Promise<CostumeBought> {
    const r = await this.took(meta, costume(this.api, { action: 'buy', team, id }));
    if (!r.ok) return { ok: false, reason: 'account' };
    const res = r.body.result;
    if (res === 'ok') return { ok: true, price: r.body.price ?? 0, saved: true };
    return { ok: false, reason: res === 'owned' || res === 'coins' ? res : 'unknown' };
  }

  async wearCostume(meta: MetaState, team: Team, id: string): Promise<CostumeWorn | null> {
    const r = await this.took(meta, costume(this.api, { action: 'wear', team, id }));
    if (!r.ok) return { saved: false, fail: 'account' };
    return r.body.result === 'ok' ? { saved: true } : null;
  }

  rate(
    meta: MetaState,
    rating: MatchRating,
    practice: boolean,
    guest = false,
  ): RatingApplied | Promise<RatingApplied> {
    if (practice) return { rating, gain: null, saved: true, practice: true };
    if (guest) return this.rateDevice(meta, rating);
    const preview = applyRating(meta.current, rating, meta.now(), meta.prog, meta.today());
    if (!preview) return { rating, gain: null, saved: true };
    return { rating, gain: preview.gain, saved: true, account: this.wait(meta, rating.matchId) };
  }

  credit(meta: MetaState, matchId: string, ok: boolean, text: string | null): void {
    if (ok && text !== null) {
      const p = parseProfile(text, meta.now());
      if (p.status === 'ok' || p.status === 'newer') {
        this.text = text;
        void meta.reload(this);
      }
    }
    const c = this.credits.get(matchId);
    if (c) {
      this.credits.delete(matchId);
      c.set(ok ? 'saved' : 'failed');
    }
  }

  close(): void {
    this.closed = true;
    for (const c of this.credits.values()) c.set('unknown');
    this.credits.clear();
  }

  /**
   * 이 계정으로 열지 않은 소켓의 온라인 판: 서버가 이 계정에 적립하지 않으니 기기 기록에 적립한다 (게스트처럼 — 같은 판 ID는
   * 거기서 걸러지고, 날짜는 이 기기 날짜). 계정 기록 · 화면 기록은 그대로다
   */
  private async rateDevice(meta: MetaState, rating: MatchRating): Promise<RatingApplied> {
    const nowMs = meta.now();
    const dev = this.device;
    const p = await dev?.load(nowMs).catch(() => null);
    const a = p ? applyRating(p.profile, rating, nowMs, meta.prog, localDay(nowMs)) : null;
    if (!dev || !p || !a) return { rating, gain: null, saved: true };
    const saved = p.status !== 'newer' && (await dev.save(a.profile, p.extra).catch(() => false));
    return { rating, gain: a.gain, saved };
  }

  private wait(meta: MetaState, matchId: string): CreditState {
    const c = new CreditState();
    this.credits.set(matchId, c);
    // 늦은 알림을 기다리는 '모름'이 쌓이지 않게 오래된 것부터 놓는다
    for (const k of this.credits.keys()) if (this.credits.size > 8) this.credits.delete(k);
    setTimeout(() => void this.check(meta, matchId, c), CREDIT_WAIT_MS);
    return c;
  }

  /** 20초 안에 credit이 없었다: 계정 상태를 다시 읽어 그 판 ID가 기록에 있으면 저장됨, 아니면 모름 */
  private async check(meta: MetaState, matchId: string, c: CreditState): Promise<void> {
    if (c.state !== 'pending' || this.closed) return;
    const r = await this.sync();
    // 그사이 계정을 떠났으면 close가 이미 '모름'으로 끝냈다
    if (this.closed) return;
    if (r === 'ok') await meta.reload(this);
    const saved = r === 'ok' && parseProfile(this.text, meta.now()).profile.recent.includes(matchId);
    if (saved) this.credits.delete(matchId);
    c.set(saved ? 'saved' : 'unknown');
  }

  /** 응답의 기록 글로 바꾸고 알린다. 401이면 세션이 끝났다 */
  private async took<T extends { profile: string }>(
    meta: MetaState,
    p: Promise<AccountCall<T>>,
  ): Promise<AccountCall<T>> {
    const r = await p;
    if (r.ok) {
      this.text = r.body.profile;
      await meta.reload(this);
    } else if (r.error === 'auth') this.lost(false);
    return r;
  }
}
