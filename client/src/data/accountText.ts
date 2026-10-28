// 선택형 구글 로그인 · 계정 문구 (docs/STORY_TEXT.md 9절). 설정 '계정' 탭 · 고르기 창 · 안내 · 결과 화면 · '내 기록' 창 · 옷장처럼 나눠 받는
// 조각에서만 쓰므로 storyText.ts(첫 묶음)와 따로 둔다 — 첫 묶음을 작게(DECISIONS 15절 '번들'). 레벨 칩의 기다림 표시는 META_TEXT.waiting

/**
 * 선택형 구글 로그인 · 계정 저장 (docs/ACCOUNT_PLAN.md, STORY_TEXT 9절): 설정 '계정' 탭 · 첫 로그인 고르기 · 안내 · 결과 화면 저장 상태.
 * 구글 'G' 로고는 넣지 않는다(상표 — 승인 전, HUMAN_CHECKS). 글자 버튼만
 */
export const ACCOUNT_TEXT = {
  tab: '계정',
  intro:
    'Google 계정으로 로그인하면 레벨 · 불씨 · 도전 · 의상이 계정에 저장돼 PC · 휴대폰 · 앱에서 이어서 할 수 있어요. 구글 고유 ID만 저장하고 이메일 · 이름 · 사진은 받지 않아요',
  login: 'Google 계정으로 로그인',
  signedIn: 'Google 계정으로 로그인됨',
  logout: '로그아웃',
  remove: '계정 삭제',
  removeSure:
    '서버의 계정 기록(레벨 · 불씨 · 도전 · 의상)을 바로 지워요. 되돌릴 수 없어요. 이 기기 기록은 그대로 남아요',
  removeYes: '삭제',
  removeNo: '취소',
  removePage: '웹에서 계정 삭제',
  /** 로그인하고 돌아온 첫 화면 (?login=) */
  results: {
    ok: '로그인했어요',
    cancel: '로그인을 취소했어요',
    fail: '로그인하지 못했어요',
    off: '지금은 로그인을 쓸 수 없어요',
    db: '계정 서버에 연결하지 못했어요. 게스트로 계속해요',
  },
  offline: '계정에 연결하지 못해 이 기기 기록으로 해요',
  expired: '로그인이 끝나 이 기기 기록으로 해요',
  imported: '이 기기 기록을 계정에 올렸어요',
  loggedOut: '로그아웃했어요 — 이 기기 기록으로 해요',
  removed: '계정을 지웠어요 — 이 기기 기록으로 해요',
  callFailed: '계정에 연결하지 못했어요',
  chooseTitle: '어느 기록으로 할까요?',
  chooseHint: '이 기기 기록을 고르면 계정 기록을 덮어써요. 이 기기 기록은 어느 쪽이든 그대로 남아요',
  chooseAccount: '계정 기록',
  chooseDevice: '이 기기 기록',
  chooseSummary: 'Lv {level} · 불씨 {coins} · 의상 {costumes}벌 · {played}판',
  saving: '계정에 저장하는 중…',
  saved: '계정에 저장했어요',
  failed: '계정에 저장하지 못했어요 — 이번 판 보상은 적립되지 않았어요',
  unknown: '저장을 확인하지 못했어요',
  practice: '연습 판은 계정에 적립되지 않아요 — 온라인 판(빠른 매칭 · 방)만',
  /** 결과: 계정 모드인데 계정 모드가 되기 전에 들어온(게스트 자리) 온라인 판 · 이 화면에서 지운 계정 자리의 판 */
  deviceMatch: '이 판은 이 기기 기록에 적립했어요',
  /** 결과: 들어온 뒤 로그아웃 · 계정이 바뀐 온라인 판 (서버가 들어올 때의 계정에 적립한다) */
  elsewhere: '이 판은 들어올 때의 계정에 적립돼요',
  /** 첫 로그인: 로그인한 지 10분이 지나 서버가 이 기기 기록을 받지 않았다 */
  relogin: '이 기기 기록을 올리려면 다시 로그인해 주세요',
  dailyReset: '계정 시간대({zone}) 자정에 새 도전이 나와요. 봇과 연습은 세지 않아요',
} as const;
