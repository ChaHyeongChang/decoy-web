# DECOY v2 (웹판) — 작업 규칙

생존자 3 vs 괴물 1 브라우저 온라인 비대칭 탈출 게임. TypeScript, Phaser 3, Node `ws` 권한 서버. 1인 개발, 팀원은 테스트만 한다.

**이 문서의 규칙은 요청에 따로 적혀 있지 않아도 모든 작업에 적용된다.**

답변, 주석, 커밋 메시지, 문서는 한국어로 쓴다. 코드 식별자는 영어.

## 기준 문서

| 문서 | 용도 |
|---|---|
| `docs/GAME_DESIGN.md` | **규칙의 원본** |
| `config/balance.json` | **수치의 원본.** 코드에 숫자를 박지 않고 여기서 읽는다 |
| `docs/TECH_SPEC.md` | 구조, 네트워크, 정보 차단, 테스트 |
| `docs/VISUAL_SPEC.md` | 색, 형태, 연출, HUD |
| `docs/STORY_TEXT.md` | 게임 내 문구 |
| `docs/BUILD_PLAN.md` | 마일스톤과 검증 (M1~M9) |
| `docs/MOBILE_PLAN.md` | M10~M15 계획: 비주얼 리마스터 · 터치 · 모바일 · 봇과 연습 · PWA/TWA · 스토어 |
| `docs/META_PLAN.md` | 판 밖 성장 · 보상(메타) 설계 · 저장 형식 · 마일스톤(a 평가 · 레벨, b 재화 · 도전, c 의상). 메타 수치는 `config/progression.json` |
| `docs/ACCOUNT_PLAN.md` | 선택형 구글 로그인 · 계정 저장 설계 (기본 꺼짐) |
| `docs/LOGIN_GUIDE.md` | 로그인을 켜기 위해 사람이 할 일 (구글 클라우드 · DB · Render · Play 신고) |
| `docs/FEEDBACK_REVIEW.md` | 왜 이렇게 바뀌었는지 |
| `docs/reference/` | v1(Unity) 문서. 참고만. 어긋나면 v2 문서가 우선 |
| `docs/images/concept_*.png` | 생성형 AI로 만든 컨셉 이미지. 분위기 참고만. 괴물 여러 마리 · 거점 3개 · 감지 3단계 · 아이템 상자는 v1 초기 안이라 따르지 않는다 |
| `docs/images/logo_decoy.png` | **게임 로고 원본** (213×213, 원형, 배경 투명). 지우지 않고 파비콘 · 작은 크기에 쓴다. 고해상도 화면 · 앱 아이콘에는 이 원본과 같은 디자인으로 다시 그린 SVG(`docs/images/logo_decoy.svg`)를 쓴다 |

## 절대 규칙

- **서버만 판정한다.** 공격 타격, 피격, 수감, 구조, 점령, 탈출, 승패, 능력 효과는 서버가 계산한다. 클라이언트는 입력을 보내고 결과를 그린다
- **서버는 볼 수 있는 것만 보낸다.** 플레이어별로 스냅샷을 따로 만든다 (`shared/src/sim/interest.ts`). 괴물에게 시야 밖 생존자 좌표를, 생존자에게 시야 밖 괴물 좌표를 보내지 않는다. 이 규칙은 테스트로 보장한다
- **이동은 공유 코드로.** 서버와 클라이언트 예측이 같은 `shared/movement.ts`를 쓴다
- **지연 대응은 처음부터.** 내 캐릭터는 예측 + 보정, 다른 캐릭터는 100ms 보간
- **수치는 `config/balance.json`에서만.** 바꾸면 `GAME_DESIGN.md` 변경 이력에 적는다
- **그래픽은 코드로 그린다.** 질감 · 그라디언트 · 셰이더 · 애니메이션을 쓸 수 있고, 그래픽 품질은 높음 · 중간 · 낮음이 있다(품질은 장식만 바꾼다). 색은 VISUAL_SPEC 값. 외부 에셋은 CC0 또는 계획에서 승인한 라이선스(UI 폰트 Noto Sans KR, SIL OFL 1.1)만 쓰고, `docs/CREDITS.md`에 출처 · 라이선스를 적는다. 바꾸면 안 되는 것은 VISUAL_SPEC 0장이다: 역할 색, 괴물 화면의 생존자 흰색 위장, 색만으로 구분하지 않기(형태도 다르게), 게임 정보가 효과에 묻히지 않기 (0장은 M10c의 VISUAL_SPEC 새 판에서 생긴다. 그 전에는 `docs/MOBILE_PLAN.md` 머리의 '바꾸지 않는 것'). 로고는 `docs/images/logo_decoy.png` 원본과 같은 디자인으로 다시 그린 SVG를 쓴다

## 진행 방식 (자율 진행)

- `docs/BUILD_PLAN.md` 순서대로 진행하고(M10~M15는 `docs/MOBILE_PLAN.md`), 마일스톤마다 자동 검증이 통과해야 다음으로 간다
- **사람에게 묻지 않고 계속 진행한다.** 다음 경우에만 멈춘다
  - 계정 · 비밀번호 · 결제가 필요한 일 (배포, 유료 API)
  - 설계 문서끼리 정면으로 모순되어 어느 쪽도 고를 수 없을 때
  - 모든 마일스톤이 끝났을 때 (최종 보고)
- 같은 문제로 세 번 넘게 막히면 `docs/PROGRESS.md`에 기록하고 `> 보류:` 표시 후 다음으로 넘어간다
- 설계와 다르게 만든 것은 `docs/DECISIONS.md`에 이유와 함께 남긴다
- 손맛 · 재미 · 밸런스처럼 사람이 판단할 것은 `docs/HUMAN_CHECKS.md`에 적고 넘어간다
- 마일스톤마다 `docs/PROGRESS.md` 갱신 + 커밋. 커밋 메시지는 한글 한 줄 (예: `M3 시야 다각형과 정보 차단 구현`)

## 코드 규칙

- TypeScript strict, `any` 금지 (불가피하면 이유 주석)
- 클래스 · 타입 PascalCase, 함수 · 변수 camelCase, 상수 UPPER_SNAKE
- 메시지 타입은 `shared/src/types.ts` 한 곳에서 정의한다
- 시뮬레이션 코드는 렌더링과 분리한다 (shared · server에 Phaser import 금지)
- 테스트 없이 규칙 코드를 추가하지 않는다. 규칙 하나에 단위 테스트 하나 이상
- 콘솔 에러 · 경고를 남긴 채 마일스톤을 끝내지 않는다

## 환경

- Node 20 이상. 패키지 설치는 npm
- Playwright는 환경에 이미 설치된 Chromium이 있으면 그것을 쓴다 (`playwright install`로 다시 받지 않는다). 없을 때만 설치한다
- 배포는 하지 않는다. Dockerfile과 `docs/DEPLOY.md`까지만 만든다

## Git

- 마일스톤(PR)마다 `origin/main`에서 브랜치를 만들어 PR로 병합한다(`docs/MOBILE_PLAN.md` 3절). 로컬 `main`은 쓰지 않고, push는 작업 단위를 마쳤을 때만 한다
- `git push --force` 금지
- `node_modules/`, `dist/`, `.env`, `artifacts/`는 커밋하지 않는다. 단, 다음은 예외로 커밋한다: 최종 보고용 스크린샷이 든 `artifacts/final/`, 리마스터 전후 비교 `artifacts/remaster/`, 스토어 이미지 `artifacts/store/`, 렌더링 최적화 전후 수치 · 스크린샷 `artifacts/perf/`, 캐릭터 리디자인 시안 · 비교 그림 · 동작 GIF `artifacts/characters/`, 따라가는 카메라 확대 후보 비교 · 최종 확인 화면 `artifacts/camera/`
