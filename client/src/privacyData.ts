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
}

export const SENT_DATA = {
  nickname: {
    label: '닉네임',
    fields: ['join.name', 'name.name', 'quick.name'],
    playType: '개인 정보 › 이름',
    purpose:
      '같은 방 사람들 화면에 표시 (빠른 매칭에서는 다른 사람에게 "플레이어 n"으로만 보임). 비워 두면 서버가 "플레이어 n"을 붙인다',
    confirm: false,
  },
  seatToken: {
    label: '자리 토큰',
    fields: ['join.token', 'join.altTokens'],
    playType: '해당 없음',
    purpose:
      '새로고침 · 끊김 뒤 같은 방의 같은 자리로 돌아가기. 서버가 방의 자리마다 무작위로 만들어 주는 값으로, 기기 · 계정과 묶이지 않고 방이 사라지면 쓸모가 없다',
    confirm: true,
  },
  roomChoice: {
    label: '방 · 역할 선택',
    fields: ['join.room', 'join.create', 'join.bots', 'role.role', 'ready.ready'],
    playType: '앱 활동 › 앱 상호작용',
    purpose:
      '방 만들기 · 입장 · 빈자리 봇 채우기 · 역할 고르기 · 준비 (시작 · 다시 하기 · 나가기는 내용 없는 신호)',
    confirm: false,
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

/** 메시지 종류 표시('t')는 보내는 데이터가 아니라 메시지 이름이라 대응표에 넣지 않는다 */
export const PROTOCOL_FIELDS = ['t'] as const;
