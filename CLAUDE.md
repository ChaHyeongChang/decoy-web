# DECOY v2 (웹판) — 작업 규칙

생존자 3 vs 괴물 1 브라우저 온라인 비대칭 탈출 게임. TypeScript, Phaser 3, Node `ws` 권한 서버. 차형창 1인 개발, 팀원은 테스트 담당.

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
| `docs/BUILD_PLAN.md` | 마일스톤과 검증 |
| `docs/FEEDBACK_REVIEW.md` | 왜 이렇게 바뀌었는지 |
| `docs/reference/` | v1(Unity) 문서. 참고만. 어긋나면 v2 문서가 우선 |
| `docs/images/concept_*.png` | 생성형 AI로 만든 컨셉 이미지. 분위기 참고만. 괴물 여러 마리 · 거점 3개 · 감지 3단계 · 아이템 상자는 v1 초기 안이라 따르지 않는다 |
| `docs/images/logo_decoy.png` | **게임 로고 (실제 사용)**. 원형, 배경 투명 |

## 절대 규칙

- **서버만 판정한다.** 공격 타격, 피격, 수감, 구조, 점령, 탈출, 승패, 능력 효과는 서버가 계산한다. 클라이언트는 입력을 보내고 결과를 그린다
- **서버는 볼 수 있는 것만 보낸다.** 플레이어별로 스냅샷을 따로 만든다 (`server/interest.ts`). 괴물에게 시야 밖 생존자 좌표를, 생존자에게 시야 밖 괴물 좌표를 보내지 않는다. 이 규칙은 테스트로 보장한다
- **이동은 공유 코드로.** 서버와 클라이언트 예측이 같은 `shared/movement.ts`를 쓴다
- **지연 대응은 처음부터.** 내 캐릭터는 예측 + 보정, 다른 캐릭터는 100ms 보간
- **수치는 `config/balance.json`에서만.** 바꾸면 `GAME_DESIGN.md` 변경 이력에 적는다
- **그래픽은 코드로 그린 단색 도형.** 외부 이미지 에셋 없이 완성한다. 색은 VISUAL_SPEC 값. 예외는 로고(`docs/images/logo_decoy.png`) 하나뿐이다

## 진행 방식 (자율 진행)

- `docs/BUILD_PLAN.md` 순서대로 진행하고, 마일스톤마다 자동 검증이 통과해야 다음으로 간다
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

- 기본 브랜치에서 작업하고 마일스톤마다 커밋, 끝나면 push
- `git push --force` 금지
- `node_modules/`, `dist/`, `.env`, `artifacts/`는 커밋하지 않는다. 단, 최종 보고용 스크린샷이 든 `artifacts/final/`만 예외로 커밋한다
