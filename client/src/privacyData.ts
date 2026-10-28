// 서버로 보내는 항목 ↔ 구글 플레이 데이터 보안 유형 대응표 (MOBILE_PLAN M15 1번). 기기 저장 키 목록(storageKeys.ts)과 함께
// 개인정보 처리방침(client/public/privacy.html)과 docs/STORE_LISTING.md '데이터 보안' 절에 그대로 옮겨 적는다.
// ClientMessage(shared/src/types.ts)에 필드를 더하면 여기 대응을 적어야 tests/unit/privacy.test.ts가 통과하고,
// 표의 이름 · 유형이 두 문서에 없으면 같은 시험이 실패한다. 게임 코드는 이 파일을 쓰지 않는다(빌드에 들어가지 않음).
//
// '봇과 연습'은 기기 안에서 판정하므로 아래 어느 것도 서버로 가지 않는다 (M13b).
// 선택형 구글 로그인으로 로그인한 경우에만 처리하는 항목은 아래 ACCOUNT_DATA · ACCOUNT_COOKIES (HTTP · 쿠키, 그리고 로그인한 화면만
// 보내는 게임 메시지 칸 join.account · quick.account · rematch.account — 그 칸은 SENT_DATA가 아니라 ACCOUNT_DATA에 적는다)
import { DELETE_COOKIE, OAUTH_COOKIE, SESSION_COOKIE } from '@decoy/shared';

export interface SentDataInfo {
  /** 처리방침 · STORE_LISTING 표 첫 칸에 그대로 쓰는 이름 */
  label: string;
  /** 보내는 ClientMessage 필드: '메시지.필드' (조작 입력은 'input.frames.필드') */
  fields: readonly string[];
  /**
   * Play Console 데이터 보안 양식의 데이터 유형 (해당 없으면 '해당 없음'). 공개 처리방침에 그대로 나가므로 초안 표시
   * ('확인 필요' 등)를 넣지 않는다 — 사람이 확인할 판단은 confirm: true로 두고 STORE_LISTING 표의 4번째 칸에만 적는다
   */
  playType: string;
  /** 왜 보내는가 */
  purpose: string;
  /** 판단을 사람이 다시 확인해야 하는가 (docs/HUMAN_CHECKS.md M15). 바꾸면 이 파일 · privacy.html · STORE_LISTING.md를 같은 값으로 */
  confirm: boolean;
  /**
   * 데이터 보안 양식에 신고하는 유형의 답 (playType이 '해당 없음'이면 없음). 수집은 늘 '예' · 공유는 늘 '아니요' ·
   * 목적은 늘 '앱 기능'이라 칸으로 두지 않는다. STORE_LISTING 표 4번째 칸과 PLAY_STORE_GUIDE 7단계 표가 formAnswer 글자를 그대로 쓴다
   */
  form?: { required: boolean; ephemeral: boolean };
}

export const SENT_DATA = {
  nickname: {
    label: '닉네임',
    fields: ['join.name', 'name.name', 'quick.name'],
    playType: '개인 정보 › 이름',
    purpose:
      '같은 방 사람들 화면에 표시 (빠른 매칭에서는 다른 사람에게 "플레이어 n"으로만 보임). 비워 두면 서버가 "플레이어 n"을 붙인다',
    confirm: false,
    // 일시적 처리 아니요 (2026-10-13 사용자 결정): 방이 살아 있는 동안 내내 메모리에 두고 다른 사람 화면에 계속 보인다
    form: { required: false, ephemeral: false },
  },
  seatToken: {
    label: '자리 토큰',
    fields: ['join.token', 'join.altTokens'],
    // '기기 또는 기타 ID'로 신고 (2026-10-13 사용자 결정, 보수적인 쪽). 기기 · 설치 단위 ID는 아니지만 같은 자리를 다시 알아보는 값이다
    playType: '기기 또는 기타 ID',
    purpose:
      '새로고침 · 끊김 뒤 같은 방의 같은 자리로 돌아가기. 서버가 방의 자리마다 무작위로 만들어 주는 값으로, 기기 · 계정과 묶이지 않고 방이 사라지면 쓸모가 없다',
    confirm: false,
    form: { required: true, ephemeral: false },
  },
  roomChoice: {
    label: '방 · 역할 선택',
    fields: [
      'join.room',
      'join.create',
      'join.bots',
      'join.costume',
      'quick.costume',
      'costume.costume',
      'role.role',
      'ready.ready',
    ],
    playType: '앱 활동 › 앱 상호작용',
    purpose:
      '방 만들기 · 입장 · 빈자리 봇 채우기 · 역할 고르기 · 준비 · 입은 의상(꾸미기 — 판이 시작될 때 같은 생존자 팀에, 괴물 의상은 모두에게 보임, 빠른 매칭은 자기에게만) (시작 · 다시 하기 · 나가기는 내용 없는 신호)',
    confirm: false,
    // 일시적 처리 아니요: 고른 방 · 역할은 방이 살아 있는 동안 메모리에 남는다 (닉네임 · 자리 토큰과 같은 기준)
    form: { required: true, ephemeral: false },
  },
  controls: {
    label: '조작 입력',
    fields: [
      'input.frames.seq',
      'input.frames.mx',
      'input.frames.my',
      'input.frames.aim',
      'input.frames.held',
      'input.frames.pressed',
    ],
    playType: '앱 활동 › 앱 상호작용',
    purpose: '이동 방향 · 조준 각도 · 누른 버튼. 서버가 판정하고 결과를 같은 방 사람들에게 보낸다',
    confirm: false,
    // 방 · 역할 선택과 같은 데이터 유형(앱 상호작용)이라 양식의 답도 하나다
    form: { required: true, ephemeral: false },
  },
  pingClock: {
    label: '지연 측정값',
    fields: ['ping.c'],
    playType: '해당 없음',
    purpose:
      '페이지를 연 뒤 흐른 시간(ms, performance.now)을 보내 그대로 돌려받아 연결 지연을 잰다(지연 계산은 기기에서). 서버는 저장하지 않는다',
    confirm: true,
  },
  testCommand: {
    label: '시험 명령',
    fields: ['test.cmd'],
    playType: '해당 없음',
    purpose: '개발용 자동 시험에서만 쓴다. 배포 서버는 받지 않는다(--test-hooks 없이는 거절)',
    confirm: false,
  },
} as const satisfies Record<string, SentDataInfo>;

/**
 * 데이터 보안 양식 한 유형의 답 글자 (STORE_LISTING 표 4번째 칸 · PLAY_STORE_GUIDE 7단계 표가 이 글자를 그대로 쓴다).
 * 목적은 따로 적지 않으면 '앱 기능' 하나 (게임 메시지로 보내는 항목). 계정 항목은 '앱 기능 · 계정 관리'
 */
export function formAnswer(form: {
  required: boolean;
  ephemeral: boolean;
  purposes?: readonly string[];
}): string {
  const purposes = (form.purposes ?? ['앱 기능']).join(' · ');
  return `수집 예 · 공유 아니요 · ${form.required ? '필수' : '선택'} · 목적 ${purposes} · 일시적 처리 ${form.ephemeral ? '예' : '아니요'}`;
}

// ───────────────────────── 선택형 구글 로그인 (docs/ACCOUNT_PLAN.md) ─────────────────────────
// 로그인한 경우에만 처리하는 항목. 주로 구글 ID 토큰 · 세션 쿠키 · 계정 API(HTTP)로 오가고, 게임 메시지에는 계정 tag가 본인이 보내는
// join · quick · rematch의 account와 본인 welcome · result의 account에만, 계정 기록 글은 그 계정 연결의 credit에만 실린다 — 다른
// 참가자에게 가는 게임 메시지(로비 · 판 시작 명단 · 스냅샷 · 결과 · 남의 welcome)에는 계정 · 로그인 여부 · 레벨을 싣지 않는다.
// 처리방침 1번 '로그인한 경우에만' 표(data-testid="account-data") · 4번 쿠키 표(data-testid="cookies"), STORE_LISTING 4장
// '로그인을 켤 때 바꾸는 값', PLAY_STORE_GUIDE 7단계 '로그인을 켤 때' 표에 그대로 옮겨 적는다(tests/unit/privacy.test.ts).
// 로그인 기능은 기본 꺼짐(환경 변수 DECOY_LOGIN) — 켜기 전에 Play Console 신고를 이 표대로 고친다(docs/LOGIN_GUIDE.md)

export interface AccountDataInfo {
  /** 처리방침 · STORE_LISTING 표 첫 칸에 그대로 쓰는 이름 */
  label: string;
  /**
   * 어디서 오는가: 구글 ID 토큰 클레임('id_token.sub'), 쿠키('cookie.<이름>'), 계정 API 요청 본문 필드('<요청 타입>.<필드>' —
   * shared/src/types.ts '계정' 절의 Account…Request), 로그인한 화면만 보내는 게임 메시지 칸('<메시지>.<필드>' — ClientMessage).
   * 요청 타입에 필드를 더하면 여기 적어야 시험이 통과한다
   */
  sources: readonly string[];
  /** Play Console 데이터 보안 양식의 데이터 유형 (공개 처리방침에 그대로 나간다 — 초안 표시를 넣지 않는다) */
  playType: string;
  /** 무엇이고 왜 처리하는가 */
  purpose: string;
  /** 판단을 사람이 다시 확인해야 하는가 (STORE_LISTING 4장 표 4번째 칸에 ⚠ 확인 필요, docs/HUMAN_CHECKS.md '선택형 구글 로그인') */
  confirm: boolean;
  /** 데이터 보안 양식의 답. 로그인은 선택 기능이라 모두 '선택', 계정을 지울 때까지 두므로 일시적 처리 아니요 */
  form: { required: boolean; ephemeral: boolean; purposes: readonly string[] };
}

const ACCOUNT_FORM = { required: false, ephemeral: false, purposes: ['앱 기능', '계정 관리'] } as const;

export const ACCOUNT_DATA = {
  googleId: {
    label: '구글 고유 ID',
    sources: ['id_token.sub'],
    playType: '개인 정보 › 사용자 ID',
    purpose:
      '구글 계정마다 정해진 번호(로그인하면 구글이 알려 주는 값). 같은 사람의 계정을 다시 찾는 데만 쓴다. 요청 범위가 openid뿐이라 이메일 · 이름 · 사진은 받지 않는다. 화면 · 쿠키 · 게임 메시지에 싣지 않는다',
    confirm: false,
    form: ACCOUNT_FORM,
  },
  accountSession: {
    label: '계정 ID · 세션 쿠키',
    // 계정 표시 tag(join.account · quick.account · rematch.account)는 계정 ID에서 만든 불투명한 값으로, 같은 계정을 가리키는 값이라
    // 여기에 넣었다
    sources: [
      `cookie.${SESSION_COOKIE}`,
      `cookie.${DELETE_COOKIE}`,
      'join.account',
      'quick.account',
      'rematch.account',
    ],
    // 세션 쿠키는 계정 ID를 담은 인증 수단이라 따로 유형을 신고하지 않고 '사용자 ID'에 넣었다 (사람 확인)
    playType: '개인 정보 › 사용자 ID',
    purpose:
      '로그인 상태 유지. 서버가 무작위로 만든 계정 ID(구글 ID가 아니다)를 발급 · 로그인 시각과 함께 서명해 HttpOnly 쿠키에 둔다(계정 삭제 페이지에서 로그인하면 그 페이지에만 쓰는 10분 쿠키). 로그인한 화면은 온라인 판에 들어갈 때(다시 하기 포함) 계정 표시(계정 ID에서 만든 불투명한 값)를 함께 보내고, 서버는 그 표시가 쿠키의 계정과 같을 때만 그 판 보상을 그 계정에 적립한다',
    confirm: true,
    form: ACCOUNT_FORM,
  },
  accountProgress: {
    label: '계정 성장 기록',
    sources: [
      'AccountImportRequest.choice',
      'AccountImportRequest.device',
      'AccountCostumeRequest.action',
      'AccountCostumeRequest.team',
      'AccountCostumeRequest.id',
    ],
    // Google 정의의 '기타 작업'(게임 플레이 등 앱 안의 그 밖의 활동)으로 판단 (사람 확인)
    playType: '앱 활동 › 기타 작업',
    purpose:
      '레벨 · 경험치 · 판 수 · 평가 최고 단계 · 최근 받은 판 번호 · 불씨 · 오늘의 도전 진행 · 접속 보상 받은 날 · 해금한 의상 · 입은 의상. 첫 로그인 때 고른 대로 이 기기 기록을 올리고, 그 뒤 온라인 판 보상은 서버가 판 평가로 직접 적립한다(봇과 연습은 적립하지 않음). 접속 보상 받기 · 의상 해금 · 입기도 계정에서 한다',
    confirm: true,
    form: ACCOUNT_FORM,
  },
} as const satisfies Record<string, AccountDataInfo>;

/** 로그인할 때 · 로그인한 동안에만 서버가 두는 쿠키 (처리방침 4번 쿠키 표). 화면 스크립트는 쿠키를 읽거나 쓰지 않는다(HttpOnly) */
export const ACCOUNT_COOKIES = [
  {
    name: OAUTH_COOKIE,
    when: '구글 로그인을 시작할 때',
    what: '로그인 요청과 구글에서 돌아온 응답이 같은 요청인지 확인하는 무작위 값(state · nonce)',
    keep: '최대 10분',
  },
  {
    name: SESSION_COOKIE,
    when: '로그인한 동안',
    what: '로그인 상태(세션): 서버가 만든 무작위 계정 ID · 발급 시각 · 로그인 시각 · 서명. 구글 ID · 이메일이 아님',
    keep: '발급부터 180일(쓰는 동안 새로 발급), 로그아웃 · 계정 삭제 때 지움',
  },
  {
    name: DELETE_COOKIE,
    when: '계정 삭제 페이지에서 구글로 로그인했을 때',
    what: '계정 삭제 페이지(/account/delete)에만 쓰는 로그인 표시: 서버가 만든 무작위 계정 ID · 발급 시각 · 서명. 게임 · 계정 기록 요청에는 실리지 않음',
    keep: '최대 10분, 계정을 지우면 지움',
  },
] as const;

/**
 * 타깃 연령 (2026-10-13 사용자 결정). 처리방침 머리 · 2번 '대상 연령', STORE_LISTING 2.4, PLAY_STORE_GUIDE 7단계가 같은 값을 쓴다.
 * 만 13세 미만을 고르지 않으므로 가족 정책 대상이 아니고, 한국법상 아동(만 14세 미만)을 대상으로 하지 않는다.
 * 처리 근거(처리방침 2번, 동의 없이 처리)는 대상 연령과 별개다 — 동의를 받는 항목이 없어 법정대리인 동의 절차도 없다
 */
export const TARGET_AGE = {
  /** 처리방침의 '만 n세 이상' */
  minAge: 16,
  /** Play Console 타깃 연령층에서 고르는 칸 (이 밖의 칸은 고르지 않는다) */
  playGroups: ['16~17세', '18세 이상'],
  /** "앱이 아동의 관심을 끌 수 있나요?" */
  appealsToChildren: false,
} as const;

/** 메시지 종류 표시('t')는 보내는 데이터가 아니라 메시지 이름이라 대응표에 넣지 않는다 */
export const PROTOCOL_FIELDS = ['t'] as const;
