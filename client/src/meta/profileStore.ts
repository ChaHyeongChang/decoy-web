// 성장 기록 저장소 (GAME_DESIGN 12장 '저장'): 저장 부분만 떼어 둔다. 게스트는 기기 저장(여기), 로그인하면 같은 모양의 계정 저장소
// (account/serverStore.ts — 서버만 쓴다)로 바꿔 끼운다(MetaState.useStore). 기록 형식 · 읽기 검사는 공용(shared/src/meta/profile.ts)이라
// 서버도 같은 글을 읽는다.
// 저장이 막혀도(사생활 보호 · 가득 참 · 저장소 없음) 예외를 내지 않고 실패를 돌려준다 — 게임은 그대로 간다. 콘솔에도 쓰지 않는다
import {
  parseProfile,
  serializeProfile,
  type ParsedProfile,
  type Profile,
  type ProfileExtra,
} from '@decoy/shared/meta';
import { readKey, writeKey, type StorageLike } from '../storageKeys';

export interface ProfileStore {
  /** 어디에 두는가 (화면 안내 · 시험용) */
  readonly kind: 'device' | 'server';
  /** 읽기: 없거나 읽을 수 없어도 쓸 수 있는 기록을 돌려준다 */
  load(nowMs: number): Promise<ParsedProfile>;
  /** 쓰기: 됐으면 true */
  save(profile: Profile, extra: ProfileExtra): Promise<boolean>;
}

/** 기기 저장소(`decoy:progress`) */
export class DeviceProfileStore implements ProfileStore {
  readonly kind = 'device';

  /** storage를 주지 않으면 브라우저 저장소 (시험은 가짜를 넣는다) */
  constructor(private readonly storage?: StorageLike | null) {}

  load(nowMs: number): Promise<ParsedProfile> {
    const text = this.storage === undefined ? readKey('progress') : readKey('progress', '', this.storage);
    return Promise.resolve(parseProfile(text, nowMs));
  }

  save(profile: Profile, extra: ProfileExtra): Promise<boolean> {
    const text = serializeProfile(profile, extra);
    const ok =
      this.storage === undefined ? writeKey('progress', text) : writeKey('progress', text, '', this.storage);
    return Promise.resolve(ok);
  }
}
