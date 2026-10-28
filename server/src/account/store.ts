// 계정 저장소 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md): 저장 부분만 떼어 둔다. 계정 하나 = 구글 고유 ID(sub) + 성장 기록 글 하나.
// 이메일 · 이름 · 사진은 받지도 저장하지도 않는다(로그인 범위 openid). 실제 DB 구현은 이 모양을 따른다(DB는 사용자가 고른다).
// 서버 인스턴스는 1개라(방이 메모리에 있다, DEPLOY) 같은 계정의 읽기-고치기-쓰기 순서는 AccountService가 프로세스 안에서 줄 세운다.
// 저장소는 그 위에서 행 하나의 읽기 · 쓰기만 맡는다
import { randomBytes } from 'node:crypto';

export interface AccountRecord {
  /** 내부 계정 ID (무작위 32자 16진수). 세션 쿠키에 든다 — 구글 sub가 쿠키 · 화면에 가지 않게 */
  id: string;
  /** 구글 고유 ID (ID 토큰의 sub, 255자 이하) */
  sub: string;
  /** 성장 기록 글 (serializeProfile). 아직 없으면 null — 첫 로그인에서 기기 기록을 올리기 전 */
  profile: string | null;
  /** 만든 · 마지막으로 바꾼 서버 시각 (ms) */
  created: number;
  updated: number;
}

export interface AccountStore {
  /** 어떤 저장소인가 (서버 시작 로그 · 시험용, 예: 'memory') */
  readonly kind: string;
  /** 시작할 때 한 번 (표 만들기 · 연결 확인). 실패하면 예외 — 서버는 그래도 뜨고 계정 요청만 503 */
  init(): Promise<void>;
  findBySub(sub: string): Promise<AccountRecord | null>;
  get(id: string): Promise<AccountRecord | null>;
  /** 새 계정 (기록 없음). 같은 sub가 이미 있으면 새로 만들지 않고 그 계정을 돌려준다(동시에 두 번 첫 로그인) */
  create(sub: string, nowMs: number): Promise<AccountRecord>;
  /** 기록 글을 바꾼다. 계정이 없으면(지워짐) 만들지 않고 false */
  saveProfile(id: string, profile: string, nowMs: number): Promise<boolean>;
  /** 계정과 기록을 바로 지운다. 있었으면 true */
  delete(id: string): Promise<boolean>;
  /** 연결 정리 (서버 종료) */
  close(): Promise<void>;
}

/** 내부 계정 ID (무작위 128비트) */
export function newAccountId(): string {
  return randomBytes(16).toString('hex');
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;

export function isAccountId(v: unknown): v is string {
  return typeof v === 'string' && ACCOUNT_ID.test(v);
}

/**
 * 메모리 저장소: 단위 · E2E 시험과 개발 서버 전용(서버를 다시 띄우면 사라진다). 배포 서버는 쓰지 않는다 — 계정 설정
 * (account/config.ts)이 --test-hooks · --dev 없이 메모리 저장소를 고르면 로그인을 켜지 않는다.
 * failing을 true로 두면 모든 요청이 실패한다(DB 장애 흉내, 시험 훅)
 */
export class MemoryAccountStore implements AccountStore {
  readonly kind = 'memory';
  failing = false;
  private readonly byId = new Map<string, AccountRecord>();
  private readonly bySub = new Map<string, string>();

  private check(): void {
    if (this.failing) throw new Error('메모리 계정 저장소: 장애 흉내');
  }

  init(): Promise<void> {
    return this.run(() => undefined);
  }

  findBySub(sub: string): Promise<AccountRecord | null> {
    return this.run(() => {
      const id = this.bySub.get(sub);
      return id ? this.copy(this.byId.get(id)) : null;
    });
  }

  get(id: string): Promise<AccountRecord | null> {
    return this.run(() => this.copy(this.byId.get(id)));
  }

  create(sub: string, nowMs: number): Promise<AccountRecord> {
    return this.run(() => {
      const have = this.bySub.get(sub);
      if (have) {
        const rec = this.copy(this.byId.get(have));
        if (rec) return rec;
      }
      const rec: AccountRecord = { id: newAccountId(), sub, profile: null, created: nowMs, updated: nowMs };
      this.byId.set(rec.id, rec);
      this.bySub.set(sub, rec.id);
      return { ...rec };
    });
  }

  saveProfile(id: string, profile: string, nowMs: number): Promise<boolean> {
    return this.run(() => {
      const rec = this.byId.get(id);
      if (!rec) return false;
      rec.profile = profile;
      rec.updated = nowMs;
      return true;
    });
  }

  delete(id: string): Promise<boolean> {
    return this.run(() => {
      const rec = this.byId.get(id);
      if (!rec) return false;
      this.byId.delete(id);
      this.bySub.delete(rec.sub);
      return true;
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  /** 계정 수 (시험용) */
  get size(): number {
    return this.byId.size;
  }

  /** 모든 계정 사본 (시험 훅 /test/accounts · 단위 시험 확인용) */
  list(): AccountRecord[] {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }

  private copy(rec: AccountRecord | undefined): AccountRecord | null {
    return rec ? { ...rec } : null;
  }

  /** DB처럼 비동기로 (같은 틱에 끝나지 않게) */
  private run<T>(fn: () => T): Promise<T> {
    return Promise.resolve().then(() => {
      this.check();
      return fn();
    });
  }
}
