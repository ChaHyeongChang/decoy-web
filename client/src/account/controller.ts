// 계정 흐름 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 7절). 나눠 받는 조각 'account'에 든다(ui/account.ts가 내보낸다) — 첫 묶음은
// 부팅 판단(account/boot.ts) · 상태 읽기 · 계정 저장소만 가진다.
//  - 로그인함: 계정 모드(MetaState.useStore). 이 기기 표시 tag가 계정 tag와 다르면(로그인 시도 중 ''도) 첫 로그인: 기기 기록이
//    비었으면 묻지 않고(계정도 비었으면 {choice:'account', device:null}로 빈 기록 계정을 연다 — 서버는 null로 있는 기록을 덮지 않는다),
//    계정이 비었으면 기기 기록을 올리고, 둘 다 있으면 고르기 창 — 고른 대로 올린다('계정 기록'이면 기기 기록 글을 보내지 않는다).
//    고른 뒤 표시를 적는다. 서버는 기기 글을 구글 로그인 뒤 10분 안만 받는다 — 넘었으면(relogin) 표시를 지우고 게스트 + '다시 로그인'.
//    기기 기록(decoy:progress)은 지우지 않는다 — 로그아웃하면 다시 게스트 기록
//  - 로그인 안 함 · 401: 표시를 지우고 게스트. 꺼짐: 게스트로 하되 표시는 남기고 off를 적어 안내('지금은 로그인을 쓸 수 없어요')는
//    처음 알았을 때 한 번만 — 부팅 · 계정 모드 중 다시 읽기 · 설정을 열어 다시 읽기 어느 길이든(다시 켜져 같은 계정이면 off를 지우고
//    묻지 않고 계정 모드). 실패 · 503 · 시간 초과: 이번 접속은 게스트 + 한 줄 안내 (판은 그대로)
//  - 계정 삭제가 되면 그 tag를 앱에 알린다(removed): 방 안에서 지운 계정 자리의 판은 서버가 적립하지 않으니 앱이 기기 기록에
//  - 다른 탭이 다른 계정으로 로그인했으면(다시 읽은 tag가 다름) 세션 끝이 아니라 바뀜: 표시를 지우지 않고 상태를 다시 읽어 새 계정 모드로
//  - 설정을 열 때 상태를 모르면 그때 읽는다. 로그아웃 · 계정 삭제 · 세션 끝: 표시를 지우고 기기 기록으로 + 안내
//  - 서버는 화면이 join · quick에서 밝힌 계정 tag가 그 소켓의 세션 쿠키 계정과 같을 때만 그 자리를 계정에 적립한다: 부팅이 아닌 때
//    계정 모드가 바뀌면(들어감 entered · 나감 left) 앱이 소켓을 다시 연다 — 새 쿠키를 실은 소켓이어야 다음 판의 계정 적립이
//    받아들여진다 (방 · 판 중이면 첫 화면에 돌아올 때 — app.ts)
import { ACCOUNT_API, isLoginResult, type AccountImportRequest, type AccountStatus } from '@decoy/shared';
import { isBlankProfile, parseProfile, type Profile } from '@decoy/shared/meta';
import { ACCOUNT_TEXT } from '../data/accountText';
import type { MetaState, MetaStore } from '../meta/meta';
import type { AccountApi, AccountCall } from './api';
import { checkStatus, getStatus, importDevice, post } from './calls';
import type { AccountMark } from './mark';
import { ServerProfileStore, type LostReason } from './serverStore';

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
  /**
   * 이 화면에서 계정을 지웠다 (그 계정 tag): 앱이 기억해 그 계정 자리였던 판(방 안에서 지움)은 기기 기록에 적립한다 — 서버는 지운
   * 계정에 적립하지 않는다
   */
  removed?(tag: string): void;
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
    // 꺼짐을 이미 알린 표시 (다시 꺼져 있으면 안내하지 않는다)
    const wasOff = this.d.mark.off();
    const view = await this.read(notes, checkStatus(status));
    const res = isLoginResult(login) ? login : null;
    let first: string | null = null;
    if (res && res !== 'ok') first = T.results[res];
    else if (view === 'unknown') first = notes.length > 0 ? null : T.offline;
    else if (view === 'in') first = res ? T.results.ok : null;
    // 첫 로그인 올리기를 서버가 받지 않았다(relogin): 그 안내 하나
    else if (notes.length > 0) first = null;
    // ?login=ok인데 로그인되지 않았다 · 표시가 있었는데 세션이 끝났거나 기능이 꺼졌다(이미 알린 꺼짐은 다시 알리지 않는다)
    else if (res) first = T.results.fail;
    else if (hadMark) first = view !== 'off' ? T.expired : wasOff ? null : T.results.off;
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
    const tag = this.store?.tag ?? null;
    const r = await post(this.d.api, ACCOUNT_API.delete);
    if (!r.ok) {
      if (r.error === 'auth') this.lost(this.store);
      return false;
    }
    if (tag !== null) this.d.removed?.(tag);
    await this.leave(ACCOUNT_TEXT.removed);
    return true;
  }

  /** 다른 탭이 다른 계정으로 바꿨다: 상태를 다시 읽어 새 계정 모드로 (표시를 지우지 않는다) */
  private async switched(): Promise<void> {
    const notes: string[] = [];
    await this.read(notes);
    for (const text of notes) this.d.screens.notice(text);
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
      // 꺼짐은 표시를 남기고 알렸다고 적는다 (다시 켜지면 같은 계정으로 — 쿠키는 그대로다). 로그인 안 함 · 401은 지운다
      const off = st?.on === false;
      const tag = this.d.mark.read();
      const told = this.d.mark.off();
      if (!off) this.d.mark.clear();
      else if (tag !== null) this.d.mark.write(tag, true);
      this.store = null;
      if (this.d.meta.mode === 'server') {
        notes.push(off ? ACCOUNT_TEXT.results.off : ACCOUNT_TEXT.expired);
        await this.d.meta.useStore(this.d.device);
        this.d.left?.();
      } else if (off && !boot && tag !== null && !told) {
        // 부팅 읽기가 실패한 뒤 설정을 열어 꺼짐을 처음 알았다: 표시에 off를 적었으니 다음 부팅은 알리지 않는다 — 여기서 한 번
        notes.push(ACCOUNT_TEXT.results.off);
      }
      return this.set(off ? 'off' : 'out');
    }
    if (this.d.meta.mode !== 'server' || this.store?.tag !== st.tag) {
      const imported = await this.enter(st);
      if (imported === null || imported === 'relogin') {
        // 새 계정에 들어가지 못했다: 옛 계정 모드였으면(다른 탭이 계정을 바꿈) 게스트로 내린다 — 옛 계정 저장소가 새 쿠키로 요청하지 않게
        if (this.d.meta.mode === 'server') {
          this.store = null;
          await this.d.meta.useStore(this.d.device);
          this.d.left?.();
        }
        if (imported === null) {
          notes.push(ACCOUNT_TEXT.offline);
          return this.set('unknown');
        }
        // 로그인한 지 오래돼 기기 기록을 받지 않았다: 다시 로그인하게 (게스트, 설정에 로그인 단추)
        this.d.mark.clear();
        notes.push(ACCOUNT_TEXT.relogin);
        return this.set('out');
      }
      if (imported) notes.push(ACCOUNT_TEXT.imported);
      if (!boot) this.d.entered?.();
    }
    return this.set('in');
  }

  /**
   * 계정 모드로 (첫 로그인이면 기기 기록 올리기 · 고르기). 올렸으면 true, 실패면 null · 'relogin'(로그인 뒤 10분이 지나 서버가 기기
   * 기록을 받지 않음) — 게스트 그대로
   */
  private async enter(st: SignedIn, again = false): Promise<boolean | null | 'relogin'> {
    const { api, mark } = this.d;
    let text = st.profile;
    let imported = false;
    const first = mark.read() !== st.tag;
    if (first) {
      const raw = this.d.deviceText();
      const dev = parseProfile(raw, this.d.now());
      const blank = dev.status === 'empty' || dev.status === 'corrupt' || isBlankProfile(dev.profile);
      let req: AccountImportRequest | null = null;
      // 계정 기록이 아직 아무것도 쌓지 않았으면(빈 기기로 처음 로그인해 만든 빈 기록) 비어 있는 계정처럼 묻지 않고 올린다
      const accountBlank = st.fresh || isBlankProfile(parseProfile(text, this.d.now()).profile);
      // 빈 기기 + 빈 계정: 빈 기록으로 계정을 연다 (기기 글 없이 — 그사이 다른 기기가 올렸어도 서버가 덮지 않는다)
      if (blank) req = st.fresh ? { choice: 'account', device: null } : null;
      // 묻지 않고 올린다 — 서버에서 그새 다른 기기가 채웠으면 덮지 않고 409 conflict (아래에서 다시 읽어 고르게 한다)
      else if (accountBlank) req = { choice: 'device', device: raw, ifBlank: true };
      else {
        const choice = await this.d.screens.choose(parseProfile(text, this.d.now()).profile, dev.profile);
        // 고른 대로 올린다: '계정 기록'이면 이 기기 기록 글을 보내지 않는다
        req = { choice, device: choice === 'device' ? raw : null };
      }
      if (req) {
        const r = await importDevice(api, req);
        if (!r.ok && r.error === 'conflict' && !again) {
          // 비었던 계정이 그새 채워졌다 (다른 기기가 먼저 첫 로그인): 상태를 다시 읽어 고르기 창으로 (한 번만)
          const fresh = await getStatus(api);
          const now = fresh.ok && fresh.body.on && fresh.body.signedIn ? fresh.body : null;
          return now && now.tag === st.tag ? this.enter(now, true) : null;
        }
        if (!r.ok) return r.error === 'relogin' ? 'relogin' : null;
        text = r.body.profile;
        imported = req.choice === 'device' && req.device !== null;
      }
    }
    // 첫 로그인을 마쳤다 · 꺼짐 표시가 남았다(다시 켜짐): 이 계정 표시로
    if (first || mark.off()) mark.write(st.tag);
    const store: ServerProfileStore = new ServerProfileStore(
      api,
      text,
      st.timeZone,
      st.tag,
      (why) => this.lost(store, why),
      () => this.d.now(),
      this.d.device,
    );
    this.store = store;
    await this.d.meta.useStore(store);
    return imported;
  }

  /**
   * 세션이 끝났다 (계정 API 401 · 다른 기기에서 지움) · 꺼졌다(off): 지금 쓰는 계정이면 게스트로. 다른 탭이 다른 계정으로
   * 로그인했다(switched): 표시를 지우지 않고 새 계정 모드로
   */
  private lost(store: ServerProfileStore | null, why: LostReason = 'out'): void {
    if (!store || this.store !== store) return;
    if (why === 'switched') void this.switched();
    // 꺼짐은 '지금은 로그인을 쓸 수 없어요' (표시에 off를 적어 다음 부팅은 알리지 않으니 여기서 한 번)
    else if (why === 'off') void this.leave(ACCOUNT_TEXT.results.off, true);
    else void this.leave(ACCOUNT_TEXT.expired);
  }

  /** 게스트로 (기기 기록). 꺼짐(off)이면 표시를 남기고 알렸다고 적는다 */
  private async leave(text: string, off = false): Promise<void> {
    const tag = this.d.mark.read();
    if (!off) this.d.mark.clear();
    else if (tag !== null) this.d.mark.write(tag, true);
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
