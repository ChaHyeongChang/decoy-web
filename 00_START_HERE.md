# DECOY v2 웹판 키트 — 시작하기

DECOY를 브라우저 4인 게임으로 다시 만드는 키트다. 사람이 조작하는 괴물 기준으로 규칙을 다시 짰고, 수업 피드백을 반영했다. Claude Code 클라우드 세션에 프롬프트 하나를 넣으면 M0~M9까지 스스로 진행하도록 구성했다.

## 키트 구성

```
decoy_web_kit/
├─ 00_START_HERE.md         ← 지금 이 문서
├─ KICKOFF_PROMPT.md        ← 클라우드 세션에 붙여넣을 프롬프트
├─ CLAUDE.md                ← 작업 규칙 (Claude가 자동으로 읽음)
├─ config/balance.json      ← 모든 수치 (팀원이 고쳐서 밸런스 조정)
└─ docs/
   ├─ GAME_DESIGN.md        ← v2 규칙 원본
   ├─ FEEDBACK_REVIEW.md    ← 피드백 항목별 반영 결정
   ├─ TECH_SPEC.md          ← 구조, 네트워크, 정보 차단, 테스트
   ├─ VISUAL_SPEC.md        ← 색, 형태, 연출, HUD
   ├─ STORY_TEXT.md         ← 게임 내 문구
   ├─ BUILD_PLAN.md         ← 마일스톤 M0~M9와 자동 검증
   ├─ PLAYTEST_GUIDE.md     ← 테스터용 테스트 방법과 기록 양식
   ├─ images/               ← 컨셉 이미지 5장 + 로고
   └─ reference/            ← v1(Unity) 기획서 · 비주얼스펙 (참고용)
```

## 시작 순서

PC와 태블릿 어느 쪽이든 아래 **zip 업로드 방식**이 가장 간단하다. 압축은 Claude가 세션 안에서 푼다.

1. **GitHub에 비공개 리포지토리를 새로 만든다.** 이름 예: `decoy-web`, "Add a README file" 체크. 팀 Unity 리포지토리와는 별개로 만든다
2. **`decoy_web_kit.zip` 파일 하나만 올린다.** 리포지토리 화면 → `Add file → Upload files` → zip 선택 → Commit changes. 압축은 풀지 않는다
3. **클라우드 세션을 연다.** claude.ai/code에서 새 세션 → `decoy-web` 리포지토리 선택 → 모델 Opus (effort 설정이 보이면 high)
4. **`KICKOFF_PROMPT.md`의 ① 시작 프롬프트를 붙여넣는다.** 첫 단계에서 Claude가 zip을 풀어 커밋하고, 문서를 읽은 뒤 한 번 정리해서 보여준다. 확인하고 "진행해"라고 답하면 M9까지 묻지 않고 진행한다
5. 중간에 끊기면 **② 이어서 하기** 프롬프트로 재개한다. 진행 상황은 `docs/PROGRESS.md`에 남는다

태블릿에서 `KICKOFF_PROMPT.md`를 열기 어려우면, 이 문서 맨 아래 **부록: 시작 프롬프트 사본**을 복사해서 쓴다.

### (참고) 압축을 풀어서 올리는 방식

PC에서는 zip을 풀어 내용물(`00_START_HERE.md`, `CLAUDE.md`, `KICKOFF_PROMPT.md`, `config`, `docs`)을 리포지토리 루트에 직접 올려도 된다. 이 경우 ① 프롬프트의 0단계는 자동으로 건너뛴다.

## 끝나고 사람이 할 일

- **로컬에서 실행해 보기**: 리포지토리를 받아 `npm install` → `npm run build` → `npm start` → 브라우저 탭 4개로 `http://localhost:8080`
- **같은 와이파이에서 팀원과**: 내 PC IP로 접속 (`docs/DEPLOY.md`)
- **인터넷 배포**: `docs/DEPLOY.md` 절차대로. 계정이 필요해 Claude는 배포하지 않는다. 한국 · 일본 리전을 고르면 핑 30~60ms 수준을 기대할 수 있다
- **`docs/HUMAN_CHECKS.md` 확인**: 손맛 · 재미 · 밸런스처럼 직접 해 봐야 아는 항목
- **팀원에게 `docs/PLAYTEST_GUIDE.md` 공유**

## 확인이 필요한 것

- **피드백 9번 항목**("○○ 얻으면 생존 / 괴물에게 보이게")은 손글씨 판독이 불확실해 보류했다. 원래 뜻을 알려주면 반영한다
- **v2는 v1에서 규칙이 꽤 바뀌었다** (감지 단계 삭제, 거점 2개, 탈출구 2곳, 생존자 고유 능력, 괴물 능력, 수감 2회, 12분 제한). 팀원과 공유하고, 노션 · 프로젝트 문서도 v2로 바꿀지 정한다
- **컨셉 이미지는 생성형 AI로 만든 것**이라 발표 자료에 쓸 때는 출처를 밝힌다

## 무엇이 Claude가 직접 확인하고, 무엇이 사람 몫인가

| Claude가 자동으로 확인 | 사람이 확인 |
|---|---|
| 규칙과 수치 (단위 테스트) | 손맛, 재미 |
| 브라우저 4개 동기화, 정보 차단 (E2E) | 밸런스 (판마다 승률) |
| 지연 100 · 200ms 동작 | 실제 인터넷 핑 체감 |
| 봇으로 한 판 끝까지 | 처음 하는 사람이 이해하는가 |
| FPS | 발표장 네트워크 |

---

## 부록: 시작 프롬프트 사본

아래 코드 블록 안의 내용을 그대로 붙여넣는다.

```
0. 리포지토리 루트에 decoy_web_kit.zip이 있으면 먼저 루트에 압축을 풀고(이미 있는 README.md는 덮어써도 돼), zip 파일은 지운 뒤 "키트 파일 추가"로 커밋해줘. zip이 없으면 이 단계는 건너뛰어.

이 리포지토리에서 DECOY v2를 처음부터 끝까지 만들어줘. 생존자 3 vs 괴물 1, 브라우저로 4명이 접속하는 온라인 비대칭 탈출 게임이야.

먼저 아래 문서를 순서대로 끝까지 읽어. CLAUDE.md의 규칙은 모든 작업에 적용돼.
1. CLAUDE.md
2. docs/GAME_DESIGN.md      (규칙의 원본)
3. config/balance.json      (수치의 원본)
4. docs/TECH_SPEC.md
5. docs/VISUAL_SPEC.md
6. docs/STORY_TEXT.md
7. docs/BUILD_PLAN.md       (마일스톤과 검증)
8. docs/FEEDBACK_REVIEW.md  (왜 이렇게 설계했는지)
9. docs/images/ 의 이미지   (concept_*.png는 생성형 AI 컨셉 이미지라 분위기만 참고해. 괴물 여러 마리, 거점 3개, 감지 3단계, 아이템 상자는 v1 초기 안이라 따르지 마. logo_decoy.png는 실제로 쓰는 로고야)
docs/reference/ 는 v1(Unity) 문서라 참고만 해.

다 읽었으면 시작 전에 딱 한 번만 정리해서 보여줘.
- 설계 문서끼리 어긋나거나 빠진 부분, 네가 정한 해결 방법
- M0~M9 진행 순서와 각 마일스톤의 자동 검증 방법
- 내가 나중에 직접 해야 하는 일 (배포 등)

정리를 보여준 뒤 내가 "진행해"라고 하면 시작해. 그다음부터는 나한테 묻지 말고 BUILD_PLAN.md 순서대로 M9까지 계속 진행해.
마일스톤마다 자동 검증을 통과시키고, PROGRESS.md 갱신하고, 커밋하고, push해.
같은 문제로 세 번 넘게 막히면 보류로 기록하고 다음으로 넘어가.
손맛이나 재미처럼 사람이 판단해야 하는 건 HUMAN_CHECKS.md에 적고 넘어가.
계정이나 결제가 필요한 일, 문서끼리 정면으로 모순되는 경우에만 멈춰.

전부 끝나면 BUILD_PLAN.md의 "최종 보고" 형식으로 정리해줘.
```
