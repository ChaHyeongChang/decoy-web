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
  /** 능력 한 줄 설명 */
  ability: string;
  color: string;
}

export const ROLE_CARDS: Record<Role, RoleCard> = {
  monster: {
    name: '괴물',
    intro: '수용소의 사냥꾼. 도망친 자들을 다시 가둔다.',
    ability: '좌클릭 공격 · 우클릭 시야 전환 · Shift 돌진 · Q 포효',
    color: '#EF4444',
  },
  runner: {
    name: '러너',
    intro: '배달 일을 하던 사람. 누구보다 빨리 달린다. 미끼가 되는 건 언제나 이 사람이다.',
    ability: 'Space 질주 — 3초간 빠르게 달린다',
    color: '#3B82F6',
  },
  guard: {
    name: '가드',
    intro: '건물 경비원. 겁이 없다. 괴물 앞을 막아서는 유일한 사람.',
    ability: 'Space 밀치기 — 가까운 괴물을 잠깐 기절시킨다',
    color: '#A855F7',
  },
  scout: {
    name: '스카우트',
    intro: '사진가. 남들이 못 보는 것을 먼저 본다. 괴물이 어디 있는지 가장 먼저 안다.',
    ability: 'Space 탐지 — 4초간 괴물 위치를 팀 전원에게 보여 준다',
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

export const HUD_TEXT = {
  status: { normal: '정상', injured: '부상', imprisoned: '수감', dead: '사망', escaped: '탈출' },
  offline: '연결 끊김',
  ready: '준비됨',
  rescuing: '구조 중',
  imprisonedHint: '수감 중 — 동료가 감옥 문 앞에서 E로 구조하면 풀려난다',
  spectating: '관전 중',
  last30: '최후',
  attack: '공격',
  dash: '돌진',
  roar: '포효',
  mode: '시야',
  monsterWaking: '괴물이 깨어나는 중',
  scoreboard: '점수판',
  closeHint: '아무 키나 누르면 닫힘 · Tab으로 다시 보기',
} as const;
