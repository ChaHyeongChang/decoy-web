// 서버로 보내는 항목 ↔ 구글 플레이 데이터 보안 유형 대응표 (MOBILE_PLAN M15 1번). 기기 저장 키 목록(storageKeys.ts)과 함께
// 개인정보 처리방침(client/public/privacy.html)과 docs/STORE_LISTING.md '데이터 보안' 절에 그대로 옮겨 적는다.
// ClientMessage(shared/src/types.ts)에 필드를 더하면 여기 대응을 적어야 tests/unit/privacy.test.ts가 통과하고,
// 표의 이름 · 유형이 두 문서에 없으면 같은 시험이 실패한다. 게임 코드는 이 파일을 쓰지 않는다(빌드에 들어가지 않음).
//
// '봇과 연습'은 기기 안에서 판정하므로 아래 어느 것도 서버로 가지 않는다 (M13b).

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

/** 데이터 보안 양식 한 유형의 답 글자 (STORE_LISTING 표 4번째 칸 · PLAY_STORE_GUIDE 7단계 표가 이 글자를 그대로 쓴다) */
export function formAnswer(form: { required: boolean; ephemeral: boolean }): string {
  return `수집 예 · 공유 아니요 · ${form.required ? '필수' : '선택'} · 목적 앱 기능 · 일시적 처리 ${form.ephemeral ? '예' : '아니요'}`;
}

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
