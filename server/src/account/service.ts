// 계정 서비스 (docs/ACCOUNT_PLAN.md 4 · 5절): 로그인한 사람의 성장 기록을 서버가 공용 함수로 고친다.
// - 판 보상은 서버가 판 평가(rateMatch)로 applyRating을 그대로 불러 적립한다. 기기에서 보낸 보상 값을 받는 길은 없다
//   (기기 기록은 첫 로그인 올리기 importDevice로만 — 사용자가 고른 경우)
// - 접속 보상 · 해금 · 입기도 공용 claimLogin · buyCostume · wearCostume. 날짜는 서버 시계 + 계정 시간대(dayKeyInZone)
// - 계정마다 프로세스 안에서 한 줄로 세운다(읽기 → 고치기 → 쓰기가 섞이지 않게, 인스턴스 1개). 쓰기는 읽은 rev일 때만(조건부 —
//   시간을 넘겨 버린 옛 쓰기가 늦게 도착해도 새 기록을 덮지 않는다, 어긋나면 503 · 적립은 다시 읽고 다시 시도). 지운 계정은 다시 만들지 않는다
// - 저장소 호출은 3초 제한(DB 저장소는 저장소가 정한 값 — Neon이 깨는 시간을 담아 10초). 계정 기록이 이 서버보다 높은 판('newer')이면 쓰지 않는다(옛 서버가 새 기록을 덮지 않게 — 공용 규칙)
// - 로그에는 수만 (sub · 계정 ID · 토큰을 찍지 않는다)
import {
  PROGRESSION,
  applyRating,
  buyCostume,
  claimLogin,
  dayKeyInZone,
  emptyProfile,
  isTeamCostume,
  parseProfile,
  serializeProfile,
  wearCostume,
  type DayKey,
  type Profile,
  type ProfileExtra,
  type Progression,
} from '@decoy/shared/meta';
import type {
  AccountClaimResponse,
  AccountCostumeRequest,
  AccountCostumeResponse,
  AccountImportRequest,
  AccountProfileBody,
  MatchRating,
  ServerMessage,
} from '@decoy/shared';
import type { AccountStore } from './store';

/** 저장소 호출 제한 기본값 (ms). 저장소가 callTimeoutMs를 밝히면 그 값 */
export const DB_TIMEOUT_MS = 3000;
/** 적립 실패 뒤 다시 시도하는 간격 (ms) */
export const CREDIT_RETRY_MS: readonly number[] = [500, 2000, 6000];
/** 기기 기록 글 상한 (import) */
export const DEVICE_PROFILE_MAX = 32 * 1024;
/** 시간 넘긴 저장소 호출이 끝나기를 줄에서 기다리는 최대 시간 (늦게 끝난 쓰기가 다음 쓰기를 덮지 않게, 무한정은 아니게) */
export const SETTLE_MAX_MS = 10_000;
/** 시작에 실패한 저장소를 다시 시작해 보는 최소 간격 */
const INIT_RETRY_MS = 30_000;
const COSTUME_ID_MAX = 24;

export type CreditMessage = Extract<ServerMessage, { t: 'credit' }>;

/** 저장소에 닿지 않는다 · 시간 넘김 · 계정 기록이 더 높은 판이라 쓸 수 없다 → 503 db */
export class AccountUnavailable extends Error {
  constructor(readonly why: 'error' | 'timeout' | 'newer' | 'init') {
    super(`계정 저장소 사용 불가 (${why})`);
  }
}

/** 요청 본문이 틀렸다 → 400 */
export class AccountBadRequest extends Error {}

export interface AccountServiceOptions {
  store: AccountStore;
  /** 계정 하루가 바뀌는 시간대 */
  timeZone: string;
  prog?: Progression;
  /** 서버 시계 (ms, 기본 Date.now) */
  now?: () => number;
  dbTimeoutMs?: number;
  /** 시간 넘긴 호출을 줄에서 기다리는 최대 시간 (기본 SETTLE_MAX_MS) */
  settleMaxMs?: number;
  retryDelaysMs?: readonly number[];
  /** 다시 시도 전 기다리기 (시험이 바꿔 끼운다) */
  sleep?: (ms: number) => Promise<void>;
  /** 적립 결과를 그 계정의 연결들에 보낸다 */
  push?: (accountId: string, msg: CreditMessage) => void;
  /** 계정 ID → 표시 tag (credit에 싣는다 — 화면이 자기 계정 것만 받게). 시스템이 세션 비밀로 만든다(session.ts accountTag) */
  tag?: (accountId: string) => string;
  log?: (msg: string) => void;
}

export interface AccountState {
  /** 기록이 아직 없다 (첫 로그인 — 기기 기록을 올리기 전) */
  fresh: boolean;
  profile: string | null;
  day: DayKey;
  timeZone: string;
}

export interface CreditResult {
  ok: boolean;
  profile: string | null;
}

interface Job {
  /** 이 일에서 부른 저장소 호출 (시간을 넘겨도 끝날 때까지 줄을 잡아 둔다) */
  pending: Promise<void>[];
}

const noop = (): void => undefined;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** import 본문 → 요청 (모양이 틀리면 null) */
export function parseImportRequest(raw: unknown): AccountImportRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.choice !== 'device' && o.choice !== 'account') return null;
  if (o.device !== null && typeof o.device !== 'string') return null;
  if (typeof o.device === 'string' && o.device.length > DEVICE_PROFILE_MAX) return null;
  return { choice: o.choice, device: o.device };
}

/** costume 본문 → 요청 (모양이 틀리면 null) */
export function parseCostumeRequest(raw: unknown): AccountCostumeRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.action !== 'buy' && o.action !== 'wear') return null;
  if (o.team !== 'survivor' && o.team !== 'monster') return null;
  if (typeof o.id !== 'string' || o.id === '' || o.id.length > COSTUME_ID_MAX) return null;
  return { action: o.action, team: o.team, id: o.id };
}

interface Readable {
  profile: Profile;
  extra: ProfileExtra;
}

export class AccountService {
  readonly store: AccountStore;
  readonly timeZone: string;
  /** 누적 수 (로그용 — 누구인지는 남기지 않는다) */
  readonly counts = { logins: 0, credits: 0, creditFails: 0 };
  private readonly prog: Progression;
  private readonly now: () => number;
  private readonly dbTimeoutMs: number;
  private readonly settleMaxMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly push: ((accountId: string, msg: CreditMessage) => void) | null;
  private readonly tagOf: (accountId: string) => string;
  private readonly log: (msg: string) => void;
  private readonly lanes = new Map<string, Promise<void>>();
  private ready = false;
  private initAt = Number.NEGATIVE_INFINITY;
  private initRun: Promise<boolean> | null = null;

  constructor(opts: AccountServiceOptions) {
    this.store = opts.store;
    this.timeZone = opts.timeZone;
    this.prog = opts.prog ?? PROGRESSION;
    this.now = opts.now ?? Date.now;
    this.dbTimeoutMs = opts.dbTimeoutMs ?? opts.store.callTimeoutMs ?? DB_TIMEOUT_MS;
    this.settleMaxMs = opts.settleMaxMs ?? SETTLE_MAX_MS;
    this.retryDelaysMs = opts.retryDelaysMs ?? CREDIT_RETRY_MS;
    this.sleep = opts.sleep ?? delay;
    this.push = opts.push ?? null;
    this.tagOf = opts.tag ?? (() => '');
    this.log = opts.log ?? noop;
  }

  /** 계정의 오늘 (서버 시계 + 계정 시간대 자정) */
  today(nowMs: number = this.now()): DayKey {
    return dayKeyInZone(nowMs, this.timeZone);
  }

  /** 저장소 시작 (표 만들기 · 연결 확인). 실패해도 예외 없이 false — 서버는 뜨고 계정 요청만 503 */
  init(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    if (!this.initRun) {
      this.initAt = this.now();
      this.initRun = this.db({ pending: [] }, () => this.store.init())
        .then(() => {
          this.ready = true;
          return true;
        })
        .catch(() => {
          this.log('계정 저장소 시작 실패 (계정 요청은 503, 판은 그대로)');
          return false;
        })
        .finally(() => {
          this.initRun = null;
        });
    }
    return this.initRun;
  }

  /** 요청 전에: 시작했는가 (실패했으면 30초에 한 번 다시 시작해 본다) */
  async ensureReady(): Promise<boolean> {
    if (this.ready) return true;
    if (!this.initRun && this.now() - this.initAt < INIT_RETRY_MS) return false;
    return this.init();
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** 구글 sub → 계정 ID (없으면 새로 만든다 — 지운 뒤 다시 로그인하면 새 계정) */
  async login(sub: string): Promise<string> {
    const job: Job = { pending: [] };
    const found = await this.db(job, () => this.store.findBySub(sub));
    const id = found ? found.id : (await this.db(job, () => this.store.create(sub, this.now()))).id;
    this.counts.logins += 1;
    this.log(`계정 로그인 (누적 ${this.counts.logins})`);
    return id;
  }

  /**
   * 구글 sub의 계정 ID — 없으면 null이고 만들지 않는다 (계정 삭제 페이지에서 시작한 로그인: 지울 계정을 찾기만 한다)
   */
  async find(sub: string): Promise<string | null> {
    const rec = await this.db({ pending: [] }, () => this.store.findBySub(sub));
    return rec ? rec.id : null;
  }

  /** 계정 상태 (없으면 null — 지워졌다) */
  status(id: string): Promise<AccountState | null> {
    return this.lane(id, async (job) => {
      const rec = await this.db(job, () => this.store.get(id));
      if (!rec) return null;
      return {
        fresh: rec.profile === null,
        profile: rec.profile,
        day: this.today(),
        timeZone: this.timeZone,
      };
    });
  }

  /**
   * 첫 로그인 때 기기 기록 올리기: 계정 기록이 없으면 기기 글을 공용 parseProfile로 걸러 저장한다(choice 무관, 빈 · 깨진 글 · null이면
   * 빈 기록). 계정 기록이 있으면 choice가 'device'이고 기기 글이 있을 때만 바꾼다 — 기기 글 null은 있는 계정 기록을 절대 덮지 않는다
   * (화면이 '빈 기기'라고 본 사이 다른 기기가 올렸어도). 계정이 없으면 null. 로그인 뒤 10분 확인은 라우트(routes.ts)가 한다
   */
  importDevice(id: string, req: AccountImportRequest): Promise<AccountProfileBody | null> {
    return this.lane(id, async (job) => {
      const rec = await this.db(job, () => this.store.get(id));
      if (!rec) return null;
      const now = this.now();
      if (rec.profile !== null && (req.choice === 'account' || req.device === null))
        return { profile: rec.profile, day: this.today(now) };
      // 계정 기록이 더 높은 판이면 덮지 않는다
      if (rec.profile !== null) this.readable(rec.profile, now);
      const dev = parseProfile(req.device, now);
      if (dev.status === 'newer') throw new AccountBadRequest('기기 기록이 서버보다 높은 판');
      const base: Readable = dev.status === 'ok' ? dev : { profile: emptyProfile(now), extra: {} };
      const text = serializeProfile(base.profile, base.extra);
      const saved = await this.db(job, () => this.store.saveProfile(id, text, now, rec.rev));
      return saved ? { profile: text, day: this.today(now) } : null;
    });
  }

  /** 오늘 접속 보상 (계정 날짜, 하루 한 번). 날짜를 기기에서 받지 않는다 */
  claimLogin(id: string): Promise<AccountClaimResponse | null> {
    return this.lane(id, async (job) => {
      const rec = await this.db(job, () => this.store.get(id));
      if (!rec) return null;
      const now = this.now();
      const day = this.today(now);
      const cur = this.readable(rec.profile, now);
      const r = claimLogin(cur.profile, day, now, this.prog);
      if (!r) return { profile: rec.profile ?? serializeProfile(cur.profile, cur.extra), day, claimed: null };
      const text = serializeProfile(r.profile, cur.extra);
      const saved = await this.db(job, () => this.store.saveProfile(id, text, now, rec.rev));
      return saved ? { profile: text, day, claimed: { reward: r.reward, streak: r.streak } } : null;
    });
  }

  /** 의상 해금(불씨) · 입기(가진 것만) */
  costume(id: string, req: AccountCostumeRequest): Promise<AccountCostumeResponse | null> {
    return this.lane(id, async (job) => {
      const rec = await this.db(job, () => this.store.get(id));
      if (!rec) return null;
      const now = this.now();
      const day = this.today(now);
      const cur = this.readable(rec.profile, now);
      const curText = (): string => rec.profile ?? serializeProfile(cur.profile, cur.extra);
      let next: Profile;
      let price: number | undefined;
      if (req.action === 'buy') {
        const b = buyCostume(cur.profile, req.team, req.id, now, this.prog);
        if (!b.ok) return { profile: curText(), day, result: b.reason };
        next = b.profile;
        price = b.price;
      } else {
        if (!isTeamCostume(req.team, req.id)) return { profile: curText(), day, result: 'unknown' };
        const w = wearCostume(cur.profile, req.team, req.id, now);
        if (!w) return { profile: curText(), day, result: 'not-owned' };
        // 이미 입었다: 저장 없이
        if (w === cur.profile) return { profile: curText(), day, result: 'ok' };
        next = w;
      }
      const text = serializeProfile(next, cur.extra);
      const saved = await this.db(job, () => this.store.saveProfile(id, text, now, rec.rev));
      if (!saved) return null;
      return price === undefined
        ? { profile: text, day, result: 'ok' }
        : { profile: text, day, result: 'ok', price };
    });
  }

  /** 계정과 기록을 바로 지운다 (있었으면 true). 줄 뒤에 선 적립은 계정이 없어 다시 만들지 않는다 */
  delete(id: string): Promise<boolean> {
    return this.lane(id, (job) => this.db(job, () => this.store.delete(id)));
  }

  /**
   * 판 보상 적립 (서버만): 공용 applyRating(기록, 평가, 서버 시각, PROGRESSION, 계정 날짜). 같은 판 ID면 저장 없이 성공(재접속).
   * 저장소 실패는 0.5 · 2 · 6초 뒤 다시 시도하고 그래도 안 되면 ok:false. 결과는 push로 그 계정의 연결들에
   */
  async credit(id: string, rating: MatchRating): Promise<CreditResult> {
    let result: CreditResult = { ok: false, profile: null };
    let why = '';
    for (let attempt = 0; ; attempt += 1) {
      try {
        result = await this.lane(id, (job) => this.creditOnce(job, id, rating));
        why = result.ok ? '' : 'gone';
        break;
      } catch (err) {
        const retryable = err instanceof AccountUnavailable && err.why !== 'newer';
        why = err instanceof AccountUnavailable ? err.why : 'error';
        const wait = this.retryDelaysMs[attempt];
        if (!retryable || wait === undefined) break;
        await this.sleep(wait);
      }
    }
    if (result.ok) {
      this.counts.credits += 1;
      this.log(`계정 적립 (누적 ${this.counts.credits})`);
    } else {
      this.counts.creditFails += 1;
      this.log(`계정 적립 실패: ${why} (누적 실패 ${this.counts.creditFails})`);
    }
    this.push?.(id, {
      t: 'credit',
      tag: this.tagOf(id),
      matchId: rating.matchId,
      ok: result.ok,
      profile: result.profile,
    });
    return result;
  }

  private async creditOnce(job: Job, id: string, rating: MatchRating): Promise<CreditResult> {
    const rec = await this.db(job, () => this.store.get(id));
    // 지운 계정: 다시 만들지 않는다
    if (!rec) return { ok: false, profile: null };
    const now = this.now();
    const cur = this.readable(rec.profile, now);
    const r = applyRating(cur.profile, rating, now, this.prog, this.today(now));
    // 같은 판 (이미 적립했다): 저장 없이 지금 기록
    if (!r) return rec.profile !== null ? { ok: true, profile: rec.profile } : { ok: false, profile: null };
    const text = serializeProfile(r.profile, cur.extra);
    const saved = await this.db(job, () => this.store.saveProfile(id, text, now, rec.rev));
    return saved ? { ok: true, profile: text } : { ok: false, profile: null };
  }

  /** 계정 기록 → 고칠 수 있는 기록. 없으면 빈 기록, 더 높은 판이면 쓰지 않는다(예외) */
  private readable(text: string | null, now: number): Readable {
    if (text === null) return { profile: emptyProfile(now), extra: {} };
    const parsed = parseProfile(text, now);
    if (parsed.status === 'newer') throw new AccountUnavailable('newer');
    return parsed;
  }

  /** 계정마다 한 줄: 앞 일이 끝나고(시간 넘긴 저장소 호출도 끝나거나 10초) 다음 일을 한다 */
  private lane<T>(id: string, fn: (job: Job) => Promise<T>): Promise<T> {
    const prev = this.lanes.get(id) ?? Promise.resolve();
    const job: Job = { pending: [] };
    const run = prev.then(() => fn(job));
    const tail = run.then(noop, noop).then(() => settle(job.pending, this.settleMaxMs));
    this.lanes.set(id, tail);
    void tail.then(() => {
      if (this.lanes.get(id) === tail) this.lanes.delete(id);
    });
    return run;
  }

  /** 저장소 호출 하나 (제한 dbTimeoutMs). 실패 · 시간 넘김은 AccountUnavailable */
  private async db<T>(job: Job, fn: () => Promise<T>): Promise<T> {
    let raw: Promise<T>;
    try {
      raw = fn();
    } catch {
      throw new AccountUnavailable('error');
    }
    job.pending.push(raw.then(noop, noop));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AccountUnavailable('timeout')), this.dbTimeoutMs);
    });
    try {
      return await Promise.race([raw, timeout]);
    } catch (err) {
      throw err instanceof AccountUnavailable ? err : new AccountUnavailable('error');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 남은 저장소 호출이 끝나기를 기다린다 (최대 maxMs) */
function settle(pending: Promise<void>[], maxMs: number): Promise<void> {
  if (pending.length === 0) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxMs);
  });
  return Promise.race([Promise.all(pending).then(noop), cap]).finally(() => clearTimeout(timer));
}
