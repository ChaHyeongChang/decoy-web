// M15 스토어 문서 검사 (MOBILE_PLAN M15 자동 검증)
//  - docs/STORE_LISTING.md: 앱 이름 30자 · 짧은 설명 80자 · 자세한 설명 4000자 이하(한글 1자 = 1자), 과장 표현 없음,
//    그림 표의 파일이 artifacts/store/에 있다
//  - docs/PLAY_STORE_GUIDE.md: 요청한 단계 제목이 모두 있고, 적힌 환경 변수 이름 · 경로가 서버 코드와 글자 그대로 같다
//  - render.yaml: 처리방침 문의처 환경 변수는 값 없이 키 자리만
//  - 선택형 구글 로그인: STORE_LISTING 4장(로그인을 켤 때 바꾸는 값)의 바꾼 설명도 4000자 이하 · ⚠ 자리, docs/LOGIN_GUIDE.md의
//    경로가 shared/src/account.ts와 같고 적힌 환경 변수 이름이 설계(docs/ACCOUNT_PLAN.md 3절) · 서버 코드에 있는 이름이다
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ACCOUNT_DATA, type AccountDataInfo } from '../../client/src/privacyData';
import { MAX_BOT_ROOMS_ENV } from '../../server/src/config';
import { PRIVACY_CONTACT_ENV, PRIVACY_PATHS } from '../../server/src/privacy';
import { ASSETLINKS_PATH, TWA_FINGERPRINTS_ENV, TWA_PACKAGE_ENV } from '../../server/src/wellKnown';
import {
  ACCOUNT_API,
  ACCOUNT_DELETE_PATH,
  AUTH_CALLBACK_PATH,
  AUTH_START_PATH,
} from '../../shared/src/account';

const LISTING = readFileSync('docs/STORE_LISTING.md', 'utf8');
const GUIDE = readFileSync('docs/PLAY_STORE_GUIDE.md', 'utf8');
const LOGIN_GUIDE = readFileSync('docs/LOGIN_GUIDE.md', 'utf8');
const LOGIN_HEAD = '## 4. 로그인을 켤 때 바꾸는 값';
/** 자세한 설명에서 로그인을 켤 때 바꾸는 줄 (STORE_LISTING 4.1) */
const NO_LOGIN_LINE = '· 광고 · 결제 · 채팅이 없고, 계정이나 로그인이 필요 없습니다';

/** '### 제목' 아래 첫 ```text 블록 */
function textBlock(heading: string): string {
  const at = LISTING.indexOf(`### ${heading}`);
  if (at < 0) throw new Error(`제목 없음: ${heading}`);
  const m = /```text\n([\s\S]*?)\n```/.exec(LISTING.slice(at));
  if (!m) throw new Error(`text 블록 없음: ${heading}`);
  return m[1] ?? '';
}

/** 마크다운 표 줄의 칸들 */
const cells = (line: string): string[] =>
  line
    .trim()
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

/** '### 제목' 절의 첫 표 (머리 줄 · 구분 줄을 뺀 행들) */
function firstTable(heading: string): string[][] {
  const at = LISTING.indexOf(`### ${heading}`);
  if (at < 0) throw new Error(`제목 없음: ${heading}`);
  const lines = LISTING.slice(at).split('\n');
  const from = lines.findIndex((l) => l.startsWith('|'));
  const rows: string[][] = [];
  for (const l of lines.slice(from + 2)) {
    if (!l.startsWith('|')) break;
    rows.push(cells(l));
  }
  return rows;
}

/** 답 칸의 첫 낱말 (예 · 아니요 · 없음 · 게임, 굵게 표시 무시) */
const lead = (answer: string): string | undefined => /^(?:\*\*)?(예|아니요|없음|게임)/.exec(answer)?.[1];

/** PLAY_STORE_GUIDE 7단계 Console 표에서 '접두사 질문 | 답' 행 */
function guideAnswers(prefix: string): Map<string, string> {
  const rows = GUIDE.split('\n')
    .filter((l) => l.trim().startsWith(`| ${prefix}`))
    .map(cells);
  return new Map(rows.map((c) => [(c[0] ?? '').slice(prefix.length), c[1] ?? '']));
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

  it('1~3장에 남은 ⚠ 확인 필요는 지연 측정값 · 태그 둘뿐 — 데이터 보안 · 콘텐츠 등급 · 타깃 연령은 2026-10-13 결정 반영', () => {
    const lines = LISTING.split('\n');
    const head = lines.indexOf('---');
    const login = lines.indexOf(`${LOGIN_HEAD} (선택형 구글 로그인)`);
    expect(login).toBeGreaterThan(head);
    const flagged = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.includes('⚠'));
    // 표 밖의 ⚠는 머리의 안내 줄(표시를 설명하는 줄)에만 (4장 포함)
    expect(flagged.filter(({ l, i }) => !l.startsWith('|') && i > head)).toEqual([]);
    const rowName = ({ l }: { l: string }): string => l.split('|')[1]?.trim() ?? '';
    const rows = flagged.filter(({ l, i }) => l.startsWith('|') && i < login).map(rowName);
    expect(rows.sort()).toEqual(['지연 측정값', '태그 (최대 5개, Console 목록에서 고름)']);
    // 4장(로그인을 켤 때)의 ⚠: 사람이 판단할 데이터 유형(ACCOUNT_DATA confirm) + 앱 액세스 선택
    const loginRows = flagged.filter(({ l, i }) => l.startsWith('|') && i > login).map(rowName);
    const confirmLabels = (Object.values(ACCOUNT_DATA) as AccountDataInfo[])
      .filter((d) => d.confirm)
      .map((d) => d.label);
    expect(loginRows.sort()).toEqual([...confirmLabels, '앱 액세스 Console 선택'].sort());
  });

  it('4장: 로그인을 켤 때 바꾼 자세한 설명도 4000자 이하 · 과장 없음, 앱 액세스 · 계정 만들기 · 계정 삭제 URL', () => {
    const full = textBlock('자세한 설명');
    expect(full.split('\n')).toContain(NO_LOGIN_LINE);
    const line = textBlock('4.1 자세한 설명에서 바꿀 한 줄');
    expect(line.includes('\n')).toBe(false);
    expect(LISTING.slice(LISTING.indexOf(LOGIN_HEAD))).toContain(`\`${NO_LOGIN_LINE}\``);
    const changed = full.replace(NO_LOGIN_LINE, line);
    expect(changed).not.toBe(full);
    expect(chars(changed)).toBeLessThanOrEqual(4000);
    expect(line).not.toMatch(/최고|1위|최초|무료 아이템|보상|이벤트|#1|best|top/i);
    if (/채팅|결제/.test(line)) expect(line).toMatch(/없/);
    expect(line).toContain('Google 계정');
    const access = textBlock('4.2 앱 액세스 (2.1 대신)');
    expect(access).toContain('로그인');
    expect(access).toContain('봇과 연습');
    expect(access).toContain('아무 Google 계정');
    const summary = firstTable('4.3 데이터 보안 양식 바뀐 답 (2.5 대신)');
    const answer = (q: string): string => summary.find((r) => r[0] === q)?.[1] ?? '';
    expect(answer('계정 만들기')).toContain('OAuth');
    expect(answer('계정 삭제 URL')).toContain(`\`https://<서비스 주소>${ACCOUNT_DELETE_PATH}\``);
    expect(lead(answer('데이터를 공유하나요(제3자 전송)?'))).toBe('아니요');
    expect(lead(answer('사용자가 데이터 삭제를 요청할 수 있나요?'))).toBe('예');
    // 지금(로그인 꺼짐) 값은 그대로
    expect(firstTable('2.5 데이터 보안 양식').find((r) => r[0] === '계정 만들기')?.[1]).toMatch(/^없음/);
  });

  it('콘텐츠 등급의 소통 문항 답이 결정 문구 그대로이고 안내서 Console 표와 같다', () => {
    const phrase = '채팅 · 음성 없음, 보이는 것은 친구 방 닉네임뿐, 빠른 매칭은 익명';
    const row = LISTING.split('\n').find((l) => l.startsWith('| 사용자 간 상호작용 |'));
    expect(row).toContain(phrase);
    const guideRow = GUIDE.split('\n').find((l) =>
      l.trim().startsWith('| 콘텐츠 등급 › 사용자 간 상호작용 |'),
    );
    expect(guideRow).toContain(phrase);
  });

  it('안내서 7단계 Console 표의 콘텐츠 등급 · 데이터 보안 요약 행이 STORE_LISTING 2.3 · 2.5 표와 같은 답 (빠진 행 · 남는 행 없음)', () => {
    const rating = firstTable('2.3 콘텐츠 등급 설문').filter((r) => r[0] !== '예상 등급');
    expect(rating.length).toBeGreaterThanOrEqual(8);
    const guideRating = guideAnswers('콘텐츠 등급 › ');
    for (const [area = '', answer = ''] of rating) {
      expect(lead(answer), `STORE_LISTING ${area}`).toBeDefined();
      expect(lead(guideRating.get(area) ?? ''), `안내서 ${area}`).toBe(lead(answer));
    }
    // 안내서에만 있는 행은 설문 진행용 두 줄뿐
    const extra = [...guideRating.keys()].filter((k) => !rating.some((r) => r[0] === k));
    expect(extra.sort()).toEqual(['위 표에 없는 문항', '이메일 주소']);

    const summary = firstTable('2.5 데이터 보안 양식');
    expect(summary.length).toBeGreaterThanOrEqual(6);
    const guideSafety = guideAnswers('데이터 보안 › ');
    for (const [q = '', answer = ''] of summary) {
      expect(lead(answer), `STORE_LISTING ${q}`).toBeDefined();
      expect(lead(guideSafety.get(q) ?? ''), `안내서 ${q}`).toBe(lead(answer));
    }
    expect(guideSafety.size).toBe(summary.length);
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

describe('LOGIN_GUIDE.md (선택형 구글 로그인 — 사람이 할 일)', () => {
  it('단계 제목이 순서대로 있다 (구글 클라우드 → 동의 화면 → 클라이언트 ID → DB → Render → Play 신고 → 켜기 → 확인 → 끄기 → 문제 해결)', () => {
    const heads = [...LOGIN_GUIDE.matchAll(/^## (\d+)\. (.+)$/gm)].map(
      (m) => [Number(m[1]), m[2] ?? ''] as const,
    );
    const want = [
      '구글 클라우드 프로젝트',
      'Google Auth Platform',
      'OAuth 클라이언트 ID',
      'DB',
      'Render 환경 변수',
      'Play Console 신고',
      '켜기',
      '확인',
      '끄기',
      '문제 해결',
    ];
    want.forEach((w, i) => {
      const h = heads.find(([n]) => n === i + 1);
      expect(h?.[1], `${i + 1}단계`).toContain(w);
    });
  });

  it('경로가 shared/src/account.ts와 같다 (리디렉션 URI · 시작 · 계정 삭제 · 상태)', () => {
    expect(LOGIN_GUIDE).toContain(`\`https://<서비스 주소>${AUTH_CALLBACK_PATH}\``);
    expect(LOGIN_GUIDE).toContain(`\`https://<서비스 주소>${AUTH_START_PATH}\``);
    expect(LOGIN_GUIDE).toContain(`\`https://<서비스 주소>${ACCOUNT_DELETE_PATH}\``);
    expect(LOGIN_GUIDE).toContain(`\`https://<서비스 주소>${ACCOUNT_API.status}\``);
  });

  it('적힌 환경 변수 이름이 설계(ACCOUNT_PLAN 3절) · 서버 코드에 있는 이름이고, 비밀값 경고가 있다', () => {
    const plan = readFileSync('docs/ACCOUNT_PLAN.md', 'utf8');
    const planEnv = new Set([...plan.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)].map((m) => m[1] ?? ''));
    for (const name of ['DECOY_LOGIN', 'GOOGLE_CLIENT_ID', 'DECOY_SESSION_SECRET', 'DECOY_ACCOUNT_TIMEZONE'])
      expect(planEnv.has(name), name).toBe(true);
    const known = new Set([...planEnv, PRIVACY_CONTACT_ENV]);
    const mentioned = [...LOGIN_GUIDE.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)].map((m) => m[1] ?? '');
    expect(mentioned.length).toBeGreaterThan(5);
    expect(mentioned.filter((n) => !known.has(n))).toEqual([]);
    expect(LOGIN_GUIDE).toMatch(/비밀값은 저장소\(GitHub\) · 메신저 · 이메일에 두지 않는다/);
    // 로고를 올리지 않고(브랜드 확인 심사), 범위를 더하지 않고, 프로덕션으로 게시
    expect(LOGIN_GUIDE).toMatch(/앱 로고: 올리지 않는다/);
    expect(LOGIN_GUIDE).toMatch(/아무 범위도 추가하지 않는다/);
    expect(LOGIN_GUIDE).toContain('프로덕션');
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
