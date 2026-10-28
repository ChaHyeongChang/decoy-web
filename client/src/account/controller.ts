// 계정 흐름 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 7절). 나눠 받는 조각 'account'에 든다(ui/account.ts가 내보낸다) — 첫 묶음은
// 부팅 판단(account/boot.ts) · 상태 읽기 · 계정 저장소만 가진다.
//  - 로그인함: 계정 모드(MetaState.useStore). 이 기기 표시 tag가 계정 tag와 다르면(로그인 시도 중 ''도) 첫 로그인: 기기 기록이
//    비었으면 묻지 않고(계정도 비었으면 빈 기록으로 계정을 연다), 계정이 비었으면 기기 기록을 올리고, 둘 다 있으면 고르기 창 —
//    고른 대로 올린다('계정 기록'이면 기기 기록 글을 보내지 않는다). 고른 뒤 표시를 적는다.
//    기기 기록(decoy:progress)은 지우지 않는다 — 로그아웃하면 다시 게스트 기록
//  - 로그인 안 함 · 401: 표시를 지우고 게스트. 꺼짐: 게스트로 하되 표시는 남긴다(쿠키가 남아 다시 켜지면 서버는 그 계정에 적립한다 —
//    다음 부팅이 읽어 같은 계정으로). 실패 · 503 · 시간 초과: 이번 접속은 게스트 + 한 줄 안내 (판은 그대로)
//  - 설정을 열 때 상태를 모르면 그때 읽는다. 로그아웃 · 계정 삭제 · 세션 끝: 표시를 지우고 기기 기록으로 + 안내
//  - 서버는 소켓을 열 때의 세션 쿠키로 계정을 정한다(Conn.account): 부팅이 아닌 때 계정 모드가 바뀌면(들어감 entered · 나감 left)
//    앱이 소켓을 다시 연다 (방 · 판 중이면 첫 화면에 돌아올 때 — app.ts)
import { ACCOUNT_API, isLoginResult, type AccountImportRequest, type AccountStatus } from '@decoy/shared';
import { isBlankProfile, parseProfile, type Profile } from '@decoy/shared/meta';
import { ACCOUNT_TEXT } from '../data/storyText';
import type { MetaState, MetaStore } from '../meta/meta';
import type { AccountApi, AccountCall } from './api';
import { checkStatus, getStatus, importDevice, post } from './calls';
import type { AccountMark } from './mark';
import { ServerProfileStore } from './serverStore';

/** 모름(아직 · 실패) · 꺼짐 · 로그인 안 함 · 로그인함 */
export type AccountView = 'unknown' | 'off' | 'out' | 'in';

type SignedIn = Extract<AccountStatus, { signedIn: true }>;

/** 계정 화면 (ui/account.ts — 시험은 가짜를 넣는다) */
export interface AccountScreens {
  notice(text: string): void;
  /** 첫 로그인: 계정 · 이 기기 기록이 둘 다 있다 — 어느 쪽을 쓸지 */
  choose(account: Profile, device: Profile): Promise<'account' | 'device'>;
}

export interface AccountDeps {
  api: AccountApi;
  meta: MetaState;
  mark: AccountMark;
  /** 게스트 기록 저장소 (decoy:progress) */
  device: MetaStore;
  /** 이 기기 기록 글 그대로 (올리기) */
  deviceText(): string | null;
  screens: AccountScreens;
  /** 로그아웃 · 삭제 · 세션 끝 · 꺼짐으로 게스트가 됐다 */
  left?(): void;
  /**
   * 부팅이 아닌 때(설정을 열어 읽음 — 다른 탭이 로그인) 계정 모드로 들어갔다: 지금 소켓은 그 전에 열려 계정이 없다(게스트).
   * 부팅 때는 부르지 않는다 — 소켓이 이미 쿠키를 싣고 열렸다
   */
  entered?(): void;
  now(): number;
}

export class AccountController {
  private state: AccountView = 'unknown';
  private reading: Promise<AccountView> | null = null;
  private store: ServerProfileStore | null = null;
  private readonly fns = new Set<() => void>();

  constructor(private readonly d: AccountDeps) {}

  get view(): AccountView {
    return this.state;
  }

  onChange(fn: () => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  /**
   * 부팅 (account/boot.ts가 표시나 ?login=이 있을 때만 부른다): status = 이미 시작한 상태 요청, login = ?login= 값,
   * hadMark = 이 기기 표시가 있었다. 안내는 로그인 결과(ok는 실제 상태로 고친다) → 올리기 순서
   */
  async boot(login: string | null, status: Promise<AccountCall<unknown>>, hadMark: boolean): Promise<void> {
    const T = ACCOUNT_TEXT;
    const notes: string[] = [];
    const view = await this.read(notes, checkStatus(status));
    const res = isLoginResult(login) ? login : null;
    let first: string | null = null;
    if (res && res !== 'ok') first = T.results[res];
    else if (view === 'unknown') first = notes.length > 0 ? null : T.offline;
    else if (view === 'in') first = res ? T.results.ok : null;
    // ?login=ok인데 로그인되지 않았다 · 표시가 있었는데 세션이 끝났거나 기능이 꺼졌다
    else if (res) first = T.results.fail;
    else if (hadMark) first = view === 'off' ? T.results.off : T.expired;
    for (const text of first ? [first, ...notes] : notes) this.d.screens.notice(text);
  }

  /** 설정을 열 때: 상태를 모르면(아직 · 지난번 실패) 그때 읽는다 */
  async ensure(): Promise<AccountView> {
    if (this.state !== 'unknown') return this.state;
    const notes: string[] = [];
    const view = await this.read(notes);
    for (const text of notes) this.d.screens.notice(text);
    return view;
  }

  /** 로그아웃 (서버 쿠키 지우기). 닿지 않으면 false */
  async logout(): Promise<boolean> {
    const r = await post(this.d.api, ACCOUNT_API.logout);
    if (!r.ok && r.error !== 'auth') return false;
    await this.leave(ACCOUNT_TEXT.loggedOut);
    return true;
  }

  /** 계정 삭제 (서버 기록을 바로 지운다). 닿지 않으면 false */
  async remove(): Promise<boolean> {
    const r = await post(this.d.api, ACCOUNT_API.delete);
    if (!r.ok) {
      if (r.error === 'auth') this.lost(this.store);
      return false;
    }
    await this.leave(ACCOUNT_TEXT.removed);
    return true;
  }

  /** 상태를 읽어 맞춘다. status를 주면 부팅 (부팅이 먼저 보낸 요청) */
  private read(notes: string[], status?: Promise<AccountCall<AccountStatus>>): Promise<AccountView> {
    this.reading ??= (status ?? getStatus(this.d.api))
      .then((r) => this.apply(r, notes, status !== undefined))
      .finally(() => (this.reading = null));
    return this.reading;
  }

  private async apply(r: AccountCall<AccountStatus>, notes: string[], boot: boolean): Promise<AccountView> {
    if (!r.ok && r.error !== 'auth') return this.set('unknown');
    const st = r.ok ? r.body : null;
    if (!st?.on || !st.signedIn) {
      // 꺼짐은 표시를 남긴다 (다시 켜지면 같은 계정으로 — 쿠키는 그대로다)
      if (st?.on !== false) this.d.mark.clear();
      this.store = null;
      if (this.d.meta.mode === 'server') {
        notes.push(ACCOUNT_TEXT.expired);
        await this.d.meta.useStore(this.d.device);
        this.d.left?.();
      }
      return this.set(st?.on === false ? 'off' : 'out');
    }
    if (this.d.meta.mode !== 'server' || this.store?.tag !== st.tag) {
      const imported = await this.enter(st);
      if (imported === null) {
        notes.push(ACCOUNT_TEXT.offline);
        return this.set('unknown');
      }
      if (imported) notes.push(ACCOUNT_TEXT.imported);
      if (!boot) this.d.entered?.();
    }
    return this.set('in');
  }

  /** 계정 모드로 (첫 로그인이면 기기 기록 올리기 · 고르기). 올렸으면 true, 실패면 null (게스트 그대로) */
  private async enter(st: SignedIn): Promise<boolean | null> {
    const { api, mark } = this.d;
    let text = st.profile;
    let imported = false;
    if (mark.read() !== st.tag) {
      const raw = this.d.deviceText();
      const dev = parseProfile(raw, this.d.now());
      const blank = dev.status === 'empty' || dev.status === 'corrupt' || isBlankProfile(dev.profile);
      let req: AccountImportRequest | null = null;
      // 계정 기록이 아직 아무것도 쌓지 않았으면(빈 기기로 처음 로그인해 만든 빈 기록) 비어 있는 계정처럼 묻지 않고 올린다
      const accountBlank = st.fresh || isBlankProfile(parseProfile(text, this.d.now()).profile);
      if (blank) req = st.fresh ? { choice: 'device', device: null } : null;
      else if (accountBlank) req = { choice: 'device', device: raw };
      else {
        const choice = await this.d.screens.choose(parseProfile(text, this.d.now()).profile, dev.profile);
        // 고른 대로 올린다: '계정 기록'이면 이 기기 기록 글을 보내지 않는다
        req = { choice, device: choice === 'device' ? raw : null };
      }
      if (req) {
        const r = await importDevice(api, req);
        if (!r.ok) return null;
        text = r.body.profile;
        imported = req.choice === 'device' && req.device !== null;
      }
      mark.write(st.tag);
    }
    const store: ServerProfileStore = new ServerProfileStore(
      api,
      text,
      st.timeZone,
      st.tag,
      (off) => this.lost(store, off),
      () => this.d.now(),
      this.d.device,
    );
    this.store = store;
    await this.d.meta.useStore(store);
    return imported;
  }

  /** 세션이 끝났다 (계정 API 401 · 다른 기기에서 지움) · 꺼졌다(off): 지금 쓰는 계정이면 게스트로 */
  private lost(store: ServerProfileStore | null, off = false): void {
    if (store && this.store === store) void this.leave(ACCOUNT_TEXT.expired, off);
  }

  /** 게스트로 (기기 기록). 꺼짐(off)이면 표시를 남긴다 */
  private async leave(text: string, off = false): Promise<void> {
    if (!off) this.d.mark.clear();
    this.store = null;
    this.set(off ? 'off' : 'out');
    await this.d.meta.useStore(this.d.device);
    this.d.screens.notice(text);
    this.d.left?.();
  }

  private set(view: AccountView): AccountView {
    if (this.state !== view) {
      this.state = view;
      for (const fn of this.fns) fn();
    }
    return view;
  }
}
