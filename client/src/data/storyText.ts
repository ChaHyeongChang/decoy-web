// 게임 내 문구는 이 파일 한 곳에 모은다 (docs/STORY_TEXT.md).
import type { Role, TextId } from '@decoy/shared';

export interface TextEntry {
  text: string;
  /** 표시 시간 (초). null = 계속 (조건이 끝날 때까지) */
  seconds: number | null;
}

export const STORY_TEXT: Record<TextId, TextEntry> = {
  INTRO_WALL: { text: '탈출구의 비밀번호는 두 장소에 나뉘어 있다. 문은 혼자서는 열리지 않는다.', seconds: 4 },
  INTRO_MONSTER: { text: '감옥을 빠져나간 자들을 다시 가둬라.', seconds: 3 },
  NOTE_FIRST: {
    text: '숫자를 새겼다. 저것은 앞만 본다. 등 뒤로 돌아라. — 비밀번호 앞자리 {code}',
    seconds: 4,
  },
  NOTE_SECOND: {
    text: '혼자서는 안 된다. 누군가는 저것의 눈을 끌어야 한다. — 비밀번호 뒷자리 {code}',
    seconds: 5,
  },
  ALERT_CAPTURE_START: { text: '거점 {point}에서 무언가 움직인다.', seconds: 2 },
  ALERT_CAPTURE_DONE: { text: '거점 {point} 해독 완료', seconds: 1.5 },
  ALERT_EXITS_ON: { text: '탈출구가 깨어났다. 두 사람이 함께 열어야 한다.', seconds: 2 },
  ALERT_EXIT_OPEN: { text: '{exit}쪽 문이 열렸다.', seconds: 1.5 },
  ALERT_RESCUED: { text: '감옥 문이 열렸다.', seconds: 1.5 },
  ALERT_ROAR: { text: '괴물이 포효했다.', seconds: 1 },
  ALERT_LAST_30: { text: '30초. 마지막으로 나갈 수 있다.', seconds: null },
  END_ALL: { text: '셋 모두 빛을 봤다. 기록자가 끝내 하지 못한 일이다.', seconds: null },
  END_TWO: { text: '두 사람이 빠져나갔다. 한 사람은 어둠 속에 남아 괴물의 눈을 끌었다.', seconds: null },
  END_MONSTER: { text: '수용소는 다시 조용해졌다. 벽에 새 글씨가 늘었다.', seconds: null },
  END_TIMEOUT: { text: '불이 완전히 꺼졌다. 아무도 문을 찾지 못했다.', seconds: null },
  END_VOID: { text: '괴물이 사라졌다. 이번 판은 무효다.', seconds: null },
};

/** {point} {exit} {code} 자리 채우기 */
export function formatText(id: TextId, params: Record<string, string | undefined> = {}): string {
  return STORY_TEXT[id].text.replace(/\{(\w+)\}/g, (_m, key: string) => params[key] ?? '');
}

export interface RoleCard {
  name: string;
  /** 로비 카드 한 줄 소개 */
  intro: string;
  /** 능력 한 줄 설명 (키보드 · 마우스: "키 이름 · 키 이름 — 설명") */
  ability: string;
  /** 능력 한 줄 설명 (터치, M12: 키 없이 "이름 · 이름 — 설명". 버튼 이름은 터치 화면과 같다) */
  abilityTouch: string;
  color: string;
}

/** 입력 방식 (M12 문구 고르기). 터치 모드(device.touch)면 'touch' */
export type InputMode = 'keyboard' | 'touch';

export const ROLE_CARDS: Record<Role, RoleCard> = {
  monster: {
    name: '괴물',
    intro: '수용소의 사냥꾼. 도망친 자들을 다시 가둔다.',
    ability: '좌클릭 공격 · 우클릭 시야 전환 · Shift 돌진 · Q 포효',
    abilityTouch: '공격 · 시야 전환 · 돌진 · 포효',
    color: '#EF4444',
  },
  runner: {
    name: '러너',
    intro: '배달 일을 하던 사람. 누구보다 빨리 달린다. 미끼가 되는 건 언제나 이 사람이다.',
    ability: 'Space 질주 — 3초간 빠르게 달린다',
    abilityTouch: '질주 — 3초간 빠르게 달린다',
    color: '#3B82F6',
  },
  guard: {
    name: '가드',
    intro: '건물 경비원. 겁이 없다. 괴물 앞을 막아서는 유일한 사람.',
    ability: 'Space 밀치기 — 가까운 괴물을 잠깐 기절시킨다',
    abilityTouch: '밀치기 — 가까운 괴물을 잠깐 기절시킨다',
    color: '#A855F7',
  },
  scout: {
    name: '스카우트',
    intro: '사진가. 남들이 못 보는 것을 먼저 본다. 괴물이 어디 있는지 가장 먼저 안다.',
    ability: 'Space 탐지 — 4초간 괴물 위치를 팀 전원에게 보여 준다',
    abilityTouch: '탐지 — 4초간 괴물 위치를 팀 전원에게 보여 준다',
    color: '#22C55E',
  },
};

/** 화면 UI 문구 */
export const UI_TEXT = {
  title: 'DECOY',
  subtitle: '생존자 3 vs 괴물 1 · 비대칭 탈출',
  createRoom: '방 만들기',
  joinRoom: '입장',
  roomCodePlaceholder: '방 코드 4글자',
  namePlaceholder: '이름 (선택)',
  copyLink: '링크 복사',
  copied: '복사됨',
  copyManual: '직접 복사하세요',
  ready: '준비',
  notReady: '준비 취소',
  start: '시작',
  waitingHost: '방장이 시작합니다',
  chooseRole: '역할을 고르세요',
  // ── 로비 · 결과 화면 (M10c) ──
  roomCodeLabel: '방 코드',
  myRole: '내 역할',
  emptySlot: '비어 있음',
  me: '나',
  bot: '봇',
  host: '방장',
  inviteLink: '초대 링크',
  waiting: '대기',
  botsFill: '빈자리는 봇이 채웁니다',
  graphics: '그래픽',
  qualityAuto: '자동',
  qualityHigh: '높음',
  qualityMedium: '중간',
  qualityLow: '낮음',
  qualityNotSaved: '이 브라우저에서는 설정이 저장되지 않아요(이번 접속에만 적용)',
  recorderMemo: '기록자 메모',
  matchLength: '판 길이',
  colPlayer: '플레이어',
  colHitsTaken: '맞은 횟수',
  colHitsLanded: '맞힌 횟수',
  colRescues: '구조',
  colCapture: '점령 기여',
  colResult: '결과',
  resultFree: '생존',
  rematch: '다시 하기',
  spotted: '발각',
  outOfRange: '범위 밖',
  monsterWait: '괴물이 깨어나기까지',
  monsterReconnect: '괴물 재접속 대기',
  disconnected: '연결이 끊겼습니다. 다시 연결하는 중…',
  wakingTitle: '서버를 깨우는 중…',
  reconnectingTitle: '서버에 다시 연결하는 중…',
  wakingBody:
    '무료 서버는 15분 동안 아무도 접속하지 않으면 잠들어요. 깨어나는 데 1분쯤 걸릴 수 있어요. 이 화면을 그대로 두면 자동으로 연결돼요.',
  wakingElapsed: '{n}초째 기다리는 중',
  /** 오프라인일 때 연결 안내 본문 (M12, wake.html과 같은 문구) */
  offline: '인터넷 연결이 끊겨 있어요. 와이파이나 데이터를 확인해 주세요.',
  roomGoneHint:
    '서버가 잠들었다 깨어나거나 다시 시작하면 방이 사라져요. 새 방을 만들어 링크를 다시 보내 주세요.',
  campWarn: '감옥 근처에 너무 오래 있다 — 곧 느려진다',
  campSlow: '감옥 캠핑 — 이동 속도 감소',
  pointWarn: '거점을 너무 오래 지키고 있다 — 곧 점령이 진행된다',
  gradeFull: '완전 탈출',
  gradeSuccess: '탈출 성공',
  gradeFail: '탈출 실패',
  winSurvivors: '생존자 승리',
  winMonster: '괴물 승리',
  winVoid: '무효',
  modeSearch: '탐색',
  modeHunt: '추적',
} as const;

/** 조작 안내 (첫 판 오버레이 · Tab 화면) */
export const CONTROLS: Record<'monster' | 'survivor', string[]> = {
  survivor: [
    'WASD  이동 (바라보는 방향 = 이동 방향)',
    'Space  고유 능력',
    'E (누르고 있기)  감옥 문 앞에서 구조',
    'Tab (누르고 있기)  점수판 · 상태',
    '거점 A · B를 점령하고, 두 사람이 함께 탈출구에 3초 서 있으면 문이 열린다',
  ],
  monster: [
    'WASD  이동 · 마우스  조준',
    '좌클릭  공격 · 우클릭  시야 모드 (탐색 ↔ 추적)',
    'Shift  돌진 · Q  포효',
    'Tab (누르고 있기)  점수판 · 상태',
    '생존자를 두 번 때리면 감옥으로. 두 명을 죽이거나 셋 모두 가두면 승리',
  ],
};

/** 조작 안내 (터치, M12): 첫 판 오버레이 대신 쓰지 않고 점수판 화면 · 판 직전 안내와 같은 내용. 형식은 CONTROLS와 같다 */
export const CONTROLS_TOUCH: Record<'monster' | 'survivor', string[]> = {
  survivor: [
    '왼쪽 스틱  이동 (바라보는 방향 = 이동 방향)',
    '능력 버튼  고유 능력',
    '구조 버튼 (누르고 있기)  감옥 문 앞에서 구조',
    '점수판 버튼  점수판 · 상태',
    '거점 A · B를 점령하고, 두 사람이 함께 탈출구에 3초 서 있으면 문이 열린다',
  ],
  monster: [
    '왼쪽 스틱  이동 · 오른쪽 스틱  조준',
    '오른쪽 스틱을 놓으면  공격 (가운데로 되돌리면 취소)',
    '돌진 버튼 (끌어서 방향)  돌진 · 포효 · 시야 버튼',
    '점수판 버튼  점수판 · 상태',
    '생존자를 두 번 때리면 감옥으로. 두 명을 죽이거나 셋 모두 가두면 승리',
  ],
};

/** 입력 방식에 맞는 역할 능력 줄 (로비 역할 카드) */
export function roleAbility(role: Role, mode: InputMode): string {
  return mode === 'touch' ? ROLE_CARDS[role].abilityTouch : ROLE_CARDS[role].ability;
}

/** 입력 방식에 맞는 조작 안내 */
export function controlsText(team: 'monster' | 'survivor', mode: InputMode): string[] {
  return mode === 'touch' ? CONTROLS_TOUCH[team] : CONTROLS[team];
}

export const HUD_TEXT = {
  status: { normal: '정상', injured: '부상', imprisoned: '수감', dead: '사망', escaped: '탈출' },
  offline: '연결 끊김',
  ready: '준비됨',
  rescuing: '구조 중',
  imprisonedHint: '수감 중 — 동료가 감옥 문 앞에서 E로 구조하면 풀려난다',
  /** 터치 (M12) */
  imprisonedHintTouch: '수감 중 — 동료가 감옥 문 앞에서 구조 버튼을 누르고 있으면 풀려난다',
  spectating: '관전 중',
  last30: '최후',
  attack: '공격',
  dash: '돌진',
  roar: '포효',
  mode: '시야',
  monsterWaking: '괴물이 깨어나는 중',
  scoreboard: '점수판',
  closeHint: '아무 키나 누르면 닫힘 · Tab으로 다시 보기',
  /** 터치 (M12) */
  closeHintTouch: '화면을 누르면 닫힘 · 점수판 버튼으로 다시 보기',
  /** 내 카드 태그 · 미니맵 제목 (M10c) */
  me: '나',
  minimap: '지도',
} as const;

/**
 * 터치 화면 (M11, docs/STORY_TEXT.md 5절). 행동 버튼 이름(공격 · 돌진 · 포효 · 시야 모드 · 능력 · 구조)은 HUD 행동 칸과 같은
 * 글자(actionSlots의 label)를 쓰고, 여기에는 터치 화면에만 있는 것을 둔다.
 * 세로 안내는 JS 없이도 떠야 해서 client/index.html에 같은 문구를 직접 적는다 (바꾸면 둘 다, tests/unit/device.test.ts가 대조)
 */
export const TOUCH_TEXT = {
  move: '이동',
  rescue: '구조',
  fullscreen: '전체 화면',
  rotateTitle: '가로로 돌려 주세요',
  rotateBody: 'DECOY는 가로 화면에서 합니다. 세로로 두는 동안에는 조작할 수 없고, 판은 계속 흘러가요.',
  // ── 첫 실행 터치 안내 (M12): 판 직전 본문 · 판 중 처음 10초 위치 표시 ──
  tutorialTitle: '터치 조작',
  tutorialSurvivor: [
    '왼쪽 아래를 누르고 끌면 이동 — 누른 자리가 스틱 가운데',
    '오른쪽 아래 능력 버튼 · 감옥 문 앞에서는 구조 버튼을 누르고 있기',
    '오른쪽 위 점수판 버튼으로 팀 상태 보기',
  ],
  tutorialMonster: [
    '왼쪽 아래를 누르고 끌면 이동 — 누른 자리가 스틱 가운데',
    '오른쪽 조준 스틱을 끌어 조준하고, 놓으면 공격 · 가운데로 되돌리면 취소',
    '돌진 버튼은 끌어서 방향을 정하고, 짧게 탭하면 지금 방향으로',
    '포효 · 시야 버튼은 탭 · 오른쪽 위 점수판 버튼',
  ],
  tutorialOk: '알겠어요',
  /** 판 중 위치 표시의 이동 영역 이름 */
  hintMove: '여기를 누르고 끌어 이동',
} as const;

/** 앱 생명주기 · 설정 문구 (M12): 로비 설정 · 다른 탭 안내 · 뒤로 가기 확인 */
export const APP_TEXT = {
  settings: '설정',
  haptics: '진동',
  hapticsOn: '켜기',
  hapticsOff: '끄기',
  tutorialReplay: '터치 조작 안내 다시 보기',
  tutorialReplayDone: '다음 판 전에 다시 보여 드려요',
  continueHere: '여기서 계속하기',
  leaveTitle: '판에서 나가시겠어요?',
  leaveBody:
    '30초 안에 돌아오면 같은 자리에서 이어서 할 수 있어요. 그 뒤에는 생존자는 사망 처리되고, 괴물이면 판이 무효가 돼요.',
  leaveStay: '계속',
  leaveGo: '나가기',
} as const;
