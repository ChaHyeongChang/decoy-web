// M15 스토어 문서 검사 (MOBILE_PLAN M15 자동 검증)
//  - docs/STORE_LISTING.md: 앱 이름 30자 · 짧은 설명 80자 · 자세한 설명 4000자 이하(한글 1자 = 1자), 과장 표현 없음,
//    그림 표의 파일이 artifacts/store/에 있다
//  - docs/PLAY_STORE_GUIDE.md: 요청한 단계 제목이 모두 있고, 적힌 환경 변수 이름 · 경로가 서버 코드와 글자 그대로 같다
//  - render.yaml: 처리방침 문의처 환경 변수는 값 없이 키 자리만
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { MAX_BOT_ROOMS_ENV } from '../../server/src/config';
import { PRIVACY_CONTACT_ENV, PRIVACY_PATHS } from '../../server/src/privacy';
import { ASSETLINKS_PATH, TWA_FINGERPRINTS_ENV, TWA_PACKAGE_ENV } from '../../server/src/wellKnown';

const LISTING = readFileSync('docs/STORE_LISTING.md', 'utf8');
const GUIDE = readFileSync('docs/PLAY_STORE_GUIDE.md', 'utf8');

/** '### 제목' 아래 첫 ```text 블록 */
function textBlock(heading: string): string {
  const at = LISTING.indexOf(`### ${heading}`);
  if (at < 0) throw new Error(`제목 없음: ${heading}`);
  const m = /```text\n([\s\S]*?)\n```/.exec(LISTING.slice(at));
  if (!m) throw new Error(`text 블록 없음: ${heading}`);
  return m[1] ?? '';
}

/** 플레이 콘솔이 세는 글자 수 (코드 포인트, 한글 1자 = 1자) */
const chars = (s: string): number => [...s].length;

describe('STORE_LISTING.md', () => {
  it('앱 이름 30자 · 짧은 설명 80자 · 자세한 설명 4000자 이하', () => {
    const name = textBlock('앱 이름');
    const short = textBlock('짧은 설명');
    const full = textBlock('자세한 설명');
    expect(name.includes('\n')).toBe(false);
    expect(short.includes('\n')).toBe(false);
    expect(chars(name)).toBeLessThanOrEqual(30);
    expect(chars(short)).toBeLessThanOrEqual(80);
    expect(chars(full)).toBeLessThanOrEqual(4000);
    expect(chars(full)).toBeGreaterThan(300);
    expect(name).toContain('DECOY');
  });

  it('과장 · 순위 표현과 없는 기능(채팅 · 결제 · 아이템)을 내세우지 않는다', () => {
    const text = [textBlock('짧은 설명'), textBlock('자세한 설명')].join('\n');
    expect(text).not.toMatch(/최고|1위|최초|무료 아이템|보상|이벤트|#1|best|top/i);
    // 채팅 · 결제는 "없다"고만 적는다
    for (const line of text.split('\n').filter((l) => /채팅|결제/.test(l))) expect(line).toMatch(/없/);
  });

  it('자세한 설명의 숫자가 규칙 원본과 같다 (판 길이 · 빠른 매칭 대기)', () => {
    const balance = JSON.parse(readFileSync('config/balance.json', 'utf8')) as {
      match: { timeLimit: number };
      matchmaking: { quickMatchWait: number };
    };
    const full = textBlock('자세한 설명');
    expect(full).toContain(`최대 ${balance.match.timeLimit / 60}분`);
    expect(full).toContain(`${balance.matchmaking.quickMatchWait}초 안에`);
  });

  it('앱 액세스 안내가 로그인 없음 · 봇과 연습을 말한다', () => {
    const access = textBlock('2.1 앱 액세스');
    expect(access).toContain('로그인');
    expect(access).toContain('봇과 연습');
  });

  it('그림 표의 파일이 artifacts/store/에 있다', () => {
    const files = [...LISTING.matchAll(/\| `([a-z0-9-]+\.png)` \|/g)].map((m) => m[1] ?? '');
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) expect(existsSync(`artifacts/store/${f}`), f).toBe(true);
  });
});

describe('PLAY_STORE_GUIDE.md', () => {
  it('요청한 단계 제목이 모두 있다 (1부 + 2부)', () => {
    const heads = [...GUIDE.matchAll(/^## (.+)$/gm)].map((m) => m[1] ?? '');
    for (const want of [
      '개발자 계정',
      '실기기 인증',
      '테스터',
      '패키지 이름 · 도메인',
      'PWABuilder',
      '서명 키 보관',
      '스토어 등록정보',
      '지문',
      '비공개 테스트',
      'Render 유료 플랜',
      '정식 출시',
      'target API',
      '운영을 그만둘 때',
      '진행 기록',
    ])
      expect(
        heads.some((h) => h.includes(want)),
        want,
      ).toBe(true);
  });

  it('적힌 환경 변수 이름 · 경로가 서버 코드와 같다', () => {
    for (const name of [TWA_PACKAGE_ENV, TWA_FINGERPRINTS_ENV, PRIVACY_CONTACT_ENV, MAX_BOT_ROOMS_ENV])
      expect(GUIDE, name).toContain(`\`${name}\``);
    expect(GUIDE).toContain(`\`${ASSETLINKS_PATH}\``);
    expect(GUIDE).toContain(`/privacy`);
    expect(PRIVACY_PATHS).toContain('/privacy');
    // 안내서에 적힌 대문자 환경 변수 이름은 모두 서버가 읽는 것이다 (오타 방지)
    const known = new Set([
      TWA_PACKAGE_ENV,
      TWA_FINGERPRINTS_ENV,
      PRIVACY_CONTACT_ENV,
      MAX_BOT_ROOMS_ENV,
      'PORT',
      'NODE_ENV',
    ]);
    const mentioned = [...GUIDE.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)].map((m) => m[1] ?? '');
    expect(mentioned.filter((n) => !known.has(n))).toEqual([]);
  });

  it('manifest와 같은 값을 PWABuilder에 넣으라고 적었다 (시작 주소 · 색 · 전체 화면 · 가로)', () => {
    const manifest = JSON.parse(readFileSync('client/public/manifest.webmanifest', 'utf8')) as {
      start_url: string;
      background_color: string;
      display: string;
      orientation: string;
    };
    expect(GUIDE).toContain(`\`${manifest.start_url}\``);
    expect(GUIDE.toLowerCase()).toContain(manifest.background_color.toLowerCase());
    expect(GUIDE.toLowerCase()).toContain(`**${manifest.display}**`);
    expect(GUIDE.toLowerCase()).toContain(`**${manifest.orientation}**`);
  });

  it('서명 키를 저장소에 넣지 말라는 경고와 두 곳 보관이 있다', () => {
    expect(GUIDE).toMatch(/저장소\(GitHub\)에 올리지 않는다/);
    expect(GUIDE).toMatch(/두 곳 이상/);
  });
});

describe('render.yaml', () => {
  it('처리방침 문의처 환경 변수는 값 없이 키 자리만 (sync: false), 플랜은 free 그대로', () => {
    const doc = parse(readFileSync('render.yaml', 'utf8')) as {
      services: { plan: string; envVars: { key: string; value?: string; sync?: boolean }[] }[];
    };
    const svc = doc.services[0];
    expect(svc?.plan).toBe('free');
    expect(svc?.envVars.find((e) => e.key === PRIVACY_CONTACT_ENV)).toEqual({
      key: PRIVACY_CONTACT_ENV,
      sync: false,
    });
  });
});
