# b3 — 마일스톤 b(거점 A · B · C 세 곳 중 두 곳)로 깨지거나 고쳐야 할 시험 · 판 평가 · 일일 도전

조사 기준 커밋 `da628d7` (작업 트리 깨끗함 — 조사 뒤에도 `git status` 변화 없음). 리포는 읽기만 했고, 실험은 모두 사본에서 했다
(`…/understand/b3/` — 부록). `…` = `/tmp/claude-0/-home-user-decoy-web/6751cf0a-610a-5fe5-9da6-2668943efcba/scratchpad`.
규칙 코드 쪽 전수 조사는 `…/understand/b1-rule-code.md`(b1), 거점 C 자리 · 맵은 b2 담당이라 겹치는 곳은 그쪽을 가리키고, 이 문서는 **시험 · 판 평가 · 일일 도전 · 그림**만 다룬다.

근거 표시: **실행** = 사본에서 실제로 돌려 확인 / **정적** = 코드를 읽고 추론(E2E는 빌드가 필요해 돌리지 않았다 — 2.3 · 2.4절 전체) / **b1 · b2** = 다른 담당의 실험.

## 0. 한눈에

1. **규칙만 바꿔도 바로 깨지는 단위 · 봇 시험은 3개**(실행): `tests/unit/balance.test.ts:34-38`(count 3이면 던져야 한다는 시험), `tests/unit/rules-golden.test.ts:31,504-507`(골든 해시), `tests/bots/fullmatch.test.ts:63`(`g.points.every(done)`).
   b2가 미는 C 자리 **C1 (24,7) + 기둥 옮기기**((23-24,6-7) → (23-24,10-11))까지 넣으면 `tests/bots/practice.test.ts:320`("봇이 움직인다" 3타일)이 하나 더 깨진다 — 규칙이 아니라 맵 때문(b2도 같은 값 1.118로 확인).
   사본 전체 실행: 124파일 중 규칙 · 맵 탓 4건 + 사본 환경 탓 4건(`.git` · `.github` 없음)만 실패.
2. **E2E는 정적으로 확실한 실패가 3곳**: `tests/e2e/m5-match.spec.ts:24`(@core, `points.every(done)`), `tests/e2e/camera.spec.ts:161-167,237-240`(고정 자리 표 `FIXED`에 C 없음 → 생존자 화살표 시험에서 `toBeDefined` 실패), `tests/e2e/m10-map.spec.ts:66-72`(배지 목록 5개 고정). 그 밖은 "클라이언트를 어떻게 고치느냐"에 달린 값 박힌 시험(2.3 · 2.5절).
3. **번들 예산이 사실상 0이다.** `tests/e2e/bundle-size.spec.ts:76-81`(@core)의 마일스톤 예산은 "PR #31 병합 + 첫 로딩 3KiB"인데 PR #32가 이미 +2.7KiB를 썼다(`docs/PROGRESS.md:595` — 남은 것 약 0.3KiB). 셋째 게이지 · 꺼짐 그림은 첫 묶음에 들어가므로 **기준을 PR #32 병합 값으로 옮기고 이번 예산을 정하는 일**이 이 작업에 꼭 들어간다(거점 규칙만의 문제는 아니지만 시험이 막는다).
4. **판 평가에서 꼭 고칠 수치는 `pointsLeft` 하나 + 가드 둘.** 정의를 `max(0, 필요한 수 − 끝난 수)`(0~2 그대로)로 두면 저지 기준 `[6,16,28,42]`를 그대로 쓸 수 있다. 단순히 "안 끝난 거점 수"(1~3)로 두면 모든 괴물이 +10점을 거저 받아 **저지 단계 분포가 0·33·50·17·0% → 0·0·34·57·8%**로 한 단계씩 밀린다(실행, 300판).
   가드: `record.ts:176`(꺼짐을 끊긴 점령으로 세지 않기) · `record.ts:349`(꺼진 거점 안 타격을 저지 타격으로 세지 않기).
5. **`progression.json`은 지금 값 그대로 가도 된다(권고).** 기준을 다시 맞출 후보는 `emblems.capture.tiers` 하나뿐: 셋째 거점에서 버려지는 점령 초가 `captureSec`에 들어가 생존자 '점령' 중앙값이 은(35.6) → 금(38~41)으로 오른다(빛 6% → 12~19%). 그래도 "봇 판 중앙값 은~금"(GAME_DESIGN 12.1) 안이다. 최종 봇이 정해진 뒤 `scripts/meta-calibrate.ts`로 한 번 다시 재고 정한다(3.5절 후보 값).
6. **일일 도전에는 '거점 N곳 점령' 같은 도전이 없다.** 거점과 닿는 것은 `s-capture`(점령 초 60) · `m-stops`(점령 끊기 8) 둘이고, 문구 · 목표를 바꿀 필요가 없다(4절). `m-stops`는 4번의 `!p.off` 가드가 있어야 뜻이 지켜진다.
7. **스토어 그림 3장 + 최종 스크린샷 대부분을 다시 찍어야 한다.** `artifacts/store/phone-2-monster.png` · `phone-3-survivor.png` · `phone-4-rescue.png`와 `artifacts/final/`의 판 화면 8장 + 조작 배치 편집 화면이 거점 게이지 2개(A · B) HUD를 담고 있다(6절, 그림을 열어 확인).
8. 덤으로 찾은 것(7절): 실전 봇 판이 같은 시드에서 완전히 재현되지는 않는다(300판 중 2판 — 시드 84 · 227이 실행마다 둘 중 하나로 갈린다). 기준 맞추기 수치가 실행마다 조금 흔들리는 이유다. 이번 변경과 무관한 기존 사항.

## 1. 조사 방법 · 실험

- grep(범위 `tests/` 전체 + `scripts/`): `CAPTURE_POINTS|PointId|\.points\b|capturedCount|pointCamp|blockWarn|PointView|setPoint|pointsLeft|pointStops|captureSec|capturePoint`,
  `gaugeA|gaugeB|pointA|pointB|point-A|point-B|bothDone`, `'A'|'B'`, `거점|점령`, 좌표(아래 실험 2). 걸린 파일은 모두 그 구간을 열어 읽었다.
- `tests/e2e/helpers.ts`에는 **거점 전용 도우미가 없다**(grep `point|capture|거점` 결과 0 — `pointerCounts`만 걸림). 거점은 시험마다 `sendTest(page, { kind: 'setPoint', point, progress })` + `teleport`로 직접 다룬다(`shared/src/types.ts:409`, 서버 처리 `shared/src/sim/room.ts:862-865` — 진행 숫자만 바꾸고 **완료 판정은 안에 생존자가 있어 점령이 도는 틱에** 난다, `capture.ts:31-39`). `setTime`(`types.ts:411`)은 거점과 무관.

| # | 실험 | 파일 | 결과 |
|---|---|---|---|
| 1 | 사본(b3/probe)에 b1의 최소 규칙 변경(`b1/patch-shared.py`) + C = (24,7) + b2의 기둥 옮기기를 넣고 `vitest run --maxWorkers=2` (단위 + 봇 124파일) | `b3/probe-vitest.txt` | 규칙 탓 3 + 맵 탓 1 + 환경 탓 4 실패, 나머지 통과 (2.1절) |
| 2 | 시험 · 촬영 스크립트의 고정 좌표 가운데 C 후보(C1 (24,7) · C2 (24,25) · C3 (19,4.5)) 둘레 3.3타일 · 옮기는 기둥 칸에 드는 것 | `b3/coord-scan.py` → `b3/coord-scan.txt` | 54건 (2.7절) |
| 3 | `scripts/meta-calibrate.ts` 그대로 60판 · 300판 | `b3/calib-base-60.txt` · `calib-base-300.txt` | 60판 = `docs/META_PLAN.md` 5절 표와 같은 값 (3.4절) |
| 4 | 같은 판을 세 가지로(지금 / 규칙 + 맵만 바꾸고 봇 그대로 / 봇이 C도 쓰게 한 빠른 가정) 300판씩, `pointsLeft` 두 정의를 같이 셈 | `b3/calib-*-300.txt`, `b3/dump-*.json`, `b3/compare-dumps.out.txt` | 3.4절 표 |
| 5 | 판 기록 수치가 새 규칙에서 어떻게 나오는지 단위 탐침 3개 | `b3/probe/tests/unit/zz-b3-meta-probe.test.ts` | 3/3 통과 (3.2 · 3.3절) |
| 6 | 같은 시드 300판을 두 번 돌려 판마다 지문 비교, 갈린 시드를 6번씩 다시 | `b3/seedprint-a.txt` · `-b.txt` | 시드 84 · 227이 실행마다 두 결과 중 하나 (7절) |

C1은 **b2가 지금 미는 후보**일 뿐 확정이 아니다(`…/understand/b2/verify.out.txt`). 실험 1 · 4의 숫자는 C 자리가 바뀌면 조금 달라진다.
실험 4의 "빠른 C 봇"은 내가 사본(b3/probe2)에만 넣은 **12줄짜리 가정**이다(`teamPlan`이 셋 중 하나를 먼저 고르고 혼자 가는 사람은 남은 둘 중 하나, 꺼진 거점은 할 일에서 뺌, 괴물 순찰은 남은 곳 중 무작위). 실제 봇 설계(봇 담당)와 다르므로 **방향과 크기만** 본다.

## 2. 시험

### 2.1 실제로 돌려 깨진 것 (실험 1: C1 + 기둥 옮기기 + 최소 규칙 변경)

| 파일:줄 | 무엇을 가정 | 왜 깨지나 | 바꿀 내용 |
|---|---|---|---|
| `tests/unit/balance.test.ts:34-38` | "구조에 묶인 값(거점 수)을 바꾸면 실패한다": `count = 3`으로 바꾸면 `validateBalance`가 던진다 | 3이 이제 맞는 값 | 깨뜨리는 값을 2 · 4로. 새 키 시험 추가: `required`가 빠지면 실패(`/capturePoint\.required/`), `required`가 구조 값(2)이 아니면 실패. 검사식은 `shared/src/balance.ts:273` (b1 3.1) |
| `tests/unit/rules-golden.test.ts:31` (`GOLDEN_HASH`), `:504-507` | 고정 시나리오의 상태 해시 `619cc26c…` | 수치 JSON(count · 새 키)과 `points` 3개가 해시에 들어간다 | 2.9절 |
| `tests/bots/fullmatch.test.ts:63` | `expect(g.points.every((p) => p.done)).toBe(true)` — 주석 62줄 "두 거점 모두 2명이 함께 점령" | C는 꺼짐(`off`)이지 완료가 아니다 | "끝난 수 = required(2) · A와 B가 끝남 · C는 꺼짐"으로. 시나리오(A → B → 북문, 17-31줄)는 그대로 통과한다. `pointDone`의 타입 `'A' \| 'B'`(18줄)는 `PointId`로 |
| `tests/bots/practice.test.ts:320` | 기기 안 연습 20초 뒤 봇마다 시작 자리에서 3타일 넘게 떨어져 있다 | **맵(기둥 옮기기) 탓**: 가드 봇이 꼭 20초에 수감돼 감옥 자리(시작 자리에서 1.118타일)로 돌아온다. b2의 맵만 바꾼 실행(`b2/patched-full.log`)도 같은 값 | 끝 순간 변위 대신 20초 동안의 최대 변위(또는 이동 거리)로 잰다. b2 담당 |

환경 탓이라 뺀 것(사본에 `.git` · `.github`가 없어서): `ci-config.test.ts`, `pwa-twa.test.ts` 2건, `store-images.test.ts:167-171`.

규칙 변경만으로는 **안 깨지지만 뜻이 틀려지는** 단위 · 봇 시험(같은 실행에서 통과):

| 파일:줄 | 무엇을 가정 | 바꿀 내용 |
|---|---|---|
| `tests/unit/capture-exit.test.ts:87-99` `bothDone()` | 모든 거점 진행을 `captureTime − dt`로 두고 p2를 A, p3을 B에 세워 "둘 다 완료" | 그대로 통과한다(배열 순서 A → B가 먼저 끝나고 C는 꺼짐). 이름을 `exitsOn()` 같은 것으로, C가 꺼졌는지 단언 추가. 101줄 제목 "두 거점을 모두 점령하기 전에는 비활성" → "세 곳 중 두 곳" |
| `tests/unit/capture-exit.test.ts:13-15,24-26,36-39,52,55,64,72,74` | 거점 밖 주차 자리 (30,18.5) · (30,19.5) · (20,18.5) · (30,16), `points[0]` = A | C 후보 셋 어느 것과도 2.5타일 안에 들지 않는다(실험 2). `points[0]`은 `POINT_IDS` 순서가 A 먼저면 그대로 |
| `tests/unit/capture-exit.test.ts:114` | `place(game, 'p3', 24.5, 6)` — 탈출구 밖으로 한 명을 뺀 자리 | 지금은 **기둥 칸**(23-24, 6-7)이고, C1이면 C 원 안(1.12타일)이 된다. 이 시점에 C는 꺼져 있어 결과는 같다(실행 통과). 헷갈리지 않게 (24.5, 4.5) 같은 원 밖 바닥으로 옮기기를 권함 |
| `tests/unit/capture-exit.test.ts:60-83` | 메모는 점령 순서대로(`NOTE_FIRST` = `codes[0]`) | 그대로. **셋째로 끝나는 거점이 없다**(메모 2장뿐)는 새 시험이 필요(2.8) |
| `tests/unit/meta-record.test.ts:126` | 점령을 하나도 못 끝낸 판의 `pointsLeft`가 **2** | 제안 정의(3.2)면 그대로 2. 단순 정의면 3이 되어 실패한다 → **이 줄이 정의를 고정하는 시험**이다. 그대로 둔다 |
| `tests/unit/meta-record.test.ts:237` | `for (const p of game.points) p.done = true` 뒤 탈출구를 손으로 켠다 | 셋 다 완료는 새 규칙에 없는 상태. `pointsLeft`를 `capturedCount`로 세면 이 상태에서 2가 나온다(실험 5) → `done` 수로 세든지, 시험을 "둘 완료 + 하나 꺼짐"으로 고친다 |
| `tests/unit/meta-record.test.ts:80-84,112-116,134-137,147-150,191-194,215-218` | 주차 자리 (8,10) · (8,22) · (40,10) · (40,22) · (30,25) | C 후보와 안 겹침 |
| `tests/unit/meta-record.test.ts:43-72` | 기록기를 켜고 끈 실전 봇 판(시드 4)의 상태가 같다(`points: g.points` 통째 비교) | 자동(필드가 늘어도 양쪽 같음) |
| `tests/unit/send-path.test.ts:113-119` | `game.points[0]`을 한 틱 남기고 완료 → `NOTE_FIRST` | 그대로 |
| `tests/unit/map.test.ts:87-94` | `Object.values(CAPTURE_POINTS)` 반경 안이 모두 바닥 | 자동으로 C까지 검사(C1 + 기둥 옮기기에서 통과). **`count`와 맵을 잇는 시험이 없다** → 새 시험(2.8) |
| `tests/unit/map.test.ts:119-` | 구역마다 한 바퀴 돌 기둥 1개 이상 | 기둥을 옮겨도 통과(실행). b2 |
| `tests/unit/interest.test.ts` 전체 | `world.points`를 보는 시험이 **하나도 없다**(grep `points` 0건, `exits` 진행만 160-162줄) | 깨지지 않는다. 새 정보 차단 시험 필요(2.8) |
| `tests/unit/visibility.test.ts:21`, `interest.test.ts:46`, `abilities.test.ts:58` | C1 둘레의 시야 시험 자리 (22.5,9.5) · (22,9.5) | 기둥을 (23-24,10-11)로 옮겨도 통과(실행 · b2) |
| `tests/bots/practice.test.ts:198-201` | 생존자가 이긴 판은 `captures`(괴물이 받은 `ALERT_CAPTURE_DONE` 수)가 **정확히 2** | 새 규칙에서도 정확히 2(셋째는 꺼짐) → 통과. 주석 "두 거점을 모두" 수정. 이 단언이 "셋째가 끝나지 않는다"를 봇 판에서 지켜 준다 |
| `tests/bots/practice.test.ts:212-219` | 괴물 봇 스냅샷에 시야 밖 생존자 0 | 그대로 |
| `tests/lag/lag-fullmatch.test.ts:24-37,118` | `fullmatch`와 같은 A → B 시나리오, `every(done)` 단언은 없음 | 논리상 통과(돌리지 않음 — 서버 프로세스를 띄운다). 타입만 |

### 2.2 클라이언트를 고치면 값이 박혀 있어 손봐야 하는 단위 시험

b1 탐침 결과대로, 클라이언트를 **하나도 안 고쳐도 이 시험들은 전부 통과한다**(시험이 A · B 두 개짜리 목록을 직접 만들어 넣는다). 즉 C를 빼먹은 화면을 지금 시험은 못 잡는다. 클라이언트를 고친 뒤에는 아래가 값 때문에 깨진다.

| 파일:줄 | 무엇을 가정 | 바뀔 내용 |
|---|---|---|
| `tests/unit/objects.test.ts:63-64` | `ALL_SEEN.points = { A: 1, B: 1 }`, `NO_BLINK = { A: false, B: false }` | C 추가 |
| `tests/unit/objects.test.ts:73-128` | 제목 "거점 배지 2 · 탈출구 배지 2 · 감옥 배지 1", 배지 tag 목록 `['point-A','point-B','exit-N','exit-S','prison']`, 진행 항목 2개(128줄), 129줄 `badge 수 5` | 배지 6 · 진행 3. 꺼짐 배지의 `value: 'off'` · 색(회색) 단언 추가 |
| `tests/unit/objects.test.ts:484-498` `oldBadges` | "예전 배지 다섯 장", `blink: Record<'A' \| 'B', boolean>` — **타입 오류**(b1 4절, `tsc -p tests`) | `Record<PointId, …>` |
| `tests/unit/objects.test.ts:557-587` | "배지 5개를 아틀라스 한 장에": `ctxs.length 6`(576줄), `images.length 5`(579줄), `atlas.copies 5`(587줄), 프레임 목록 5개(582줄) | 6장 기준으로(7 · 6 · 6) |
| `tests/unit/objects.test.ts:669-716,734-744` | 다시 굽는 프레임 목록 `['point-A', …, 'prison']`, `['point-A']` | `'point-C'` 포함. 상태가 `off`로 바뀔 때 그 칸만 다시 굽는 경우 추가 |
| `tests/unit/offscreen.test.ts:37-40` `POINTS_IDLE` | 거점 2개 | 3개. 66-91줄 "끝나지 않은 거점"에 **꺼진 거점은 화살표 없음** 경우 추가(`client/src/render/offscreen.ts:143-147`) |
| `tests/unit/offscreen.test.ts:230-236` | 상한 `EDGE_MAX`(8)를 넘으면 낮은 우선순위부터 빠진다 | 상수를 그대로 가져다 써서 자동. 다만 생존자 화면 최악이 9개(괴물 · 탐지 · 포효 · 감옥 · 팀원 2 · 거점 3)가 되어 **거점 화살표 하나가 잘릴 수 있다**(b1 3.9) — 상한을 올릴지 결정한 뒤 그 경우를 시험으로 |
| `tests/unit/hud.test.ts:264-270` | `gaugeState('blocked') = 'paused'` 등, 칩 아이콘 `play · pause · check`, `GAUGE_ICON.idle = null` | `off` 상태 · 아이콘 단언 추가("색만으로 구분하지 않기") |
| `tests/unit/hud.test.ts:387-409` | "늘 떠 있는 HUD는 맵과 겹치지 않는다": 사각형 목록에 게이지 A · B만, `HUD.gaugeB.x < 1490` | 게이지 C 사각형 추가. 1490(선명도 탐침 자리) 제약은 그대로 지켜야 함 |
| `tests/unit/touch-hud.test.ts:163` | 부품 id에 `timer, gaugeA, gaugeB, card0~2`가 있다(`arrayContaining`) | `gaugeC` 추가. 같은 시험의 겹침 검사가 **좁은 화면에서 세 칸(168px)이 들어가는지 판정**한다(b1 3.7) |
| `tests/unit/touch-hud.test.ts:232-233` | 658×320 괴물: 게이지가 화면 오른쪽 절반(`s9.gaugeA.x`) | 세 칸 배치 뒤 다시 확인 |
| `tests/unit/touch-tuning.test.ts:299-322` | 좌우 반전 = A · B 자리 맞바꿈(`q.gaugeA.x = W − p.gaugeB.x`), `gaugeA.x < gaugeB.x` | 셋의 반전 규칙(A ↔ C 맞바꿈, B 제자리, 왼쪽부터 A · B · C)으로 다시 씀 |
| `tests/unit/match-prefs.test.ts:232` | PC 메뉴 버튼이 피할 자리 `gaugeLeft = HUD.gaugeA.x − dia/2` | 상수를 따라가 자동. PC 위 띠에서 A가 왼쪽으로 가면 버튼 자리 시험(창 크기별)이 좁아져 실패할 수 있음 |
| `tests/unit/map-art.test.ts:425-451` | `paintPoints` 그림: 고리 2개의 중심이 A · B, 눈금 수 `OBJ.ticks * 2` 등 | 2개짜리 목록을 직접 넣어 그대로 통과. `off` 그림(회색 고리 · 스캔 없음) 시험 추가 |
| `tests/unit/map-art.test.ts:244-259` | 데칼 20개 이상, 모든 거점 둘레 `decalClearPoint`(3.3) 밖 | 자동으로 C 둘레도 비움. 개수는 b2 확인(`b2/decals-*.json`) |
| `tests/unit/fog-cycle.test.ts:493,506,530-531` | `STATES = ['idle','capturing','blocked','done']`, id는 `['A','B']` | 옛 그리기와 견주는 회귀 시험이라 그대로 통과. `off`는 옛 구현에 없으므로 새 시험으로 따로 |
| `tests/unit/fog-paint.test.ts:598-601` | 기록 펜 시험의 거점 2개 | 그대로 통과. 3개 + `off` 경우 추가 |
| `tests/unit/hud-gate.test.ts:84-100` | 미니맵 프레임 키 목록(`'point'` …)이 옛 함수와 같다 | `point:off`를 더해도 그대로(목록에 없는 키) |
| `tests/unit/story-text-sync.test.ts:84-89` | `storyText.ts`의 모든 문구가 `docs/STORY_TEXT.md` 표 · 목록에 있다 | 문구를 고치면(조작 안내 "거점 A · B를 점령하고…" `storyText.ts:204,222`, 이름표 `gaugeA/gaugeB` `:440-441` + 새 `gaugeC`) **문서도 같은 커밋에서** 고쳐야 통과 |
| `tests/unit/visual-spec.test.ts:272-289` | VISUAL_SPEC 표의 코드 열 값 = 코드 상수 — `docs/VISUAL_SPEC.md:711` `580 · 1340` = `HUD.gaugeA.x · gaugeB.x` | PC 게이지 자리를 옮기면 문서 값도 |
| `tests/unit/visual-spec.test.ts:304-` | VISUAL_SPEC 10장 아이콘 목록 = `icons.ts ICONS` | 꺼짐 아이콘을 새로 만들면 문서 목록에도 |
| `tests/unit/visual-spec.test.ts:226-249` | 0장 ①~⑦ 항목마다 지키는 시험(파일 + 「제목」)이 실제로 있다 | 지금 0장이 인용한 제목에 거점 · 배지 · 게이지가 든 것은 없다(grep). 시험 제목을 바꿔도 안전 |
| `tests/unit/fonts.test.ts:42-53` | 게임 문구의 모든 글자가 폰트 서브셋에 있다(ASCII + KS X 1001 한글 2,350자 + 기호 몇 개) | 'C' · "꺼짐" 같은 글자는 이미 있다. 꺼짐 표시에 **새 기호 글자**(⊘ 등)를 문구로 쓰면 실패 → `npm run font:subset` + `docs/CREDITS.md` sha(`credits.test.ts:105-108`) |
| `tests/unit/store-listing.test.ts:75-103` | 스토어 문구 글자 수 · 숫자(판 길이 · 매칭 대기) | 거점 수는 검사하지 않는다. `docs/STORE_LISTING.md:37` "거점 A · B를 점령하면…" 문장은 사람이 고친다(문서 담당) |

### 2.3 E2E (돌리지 않음 — 정적)

| 파일:줄 | 무엇을 가정 | 판정 | 바뀔 내용 |
|---|---|---|---|
| `tests/e2e/m5-match.spec.ts:15-24` (@core) | A · B를 0.99로 두고 한 명씩 세워 탈출구를 켠 뒤 `ms!.world.points.every((p) => p.state === 'done')` | **깨짐(확실)** — C는 `'off'` | "A · B는 done, C는 off"로. 22줄 주석 "괴물 화면에도 거점 완료가 보인다"는 그대로 — 괴물 스냅샷에도 `off`가 같은 값으로 가는지 여기서 같이 본다 |
| `tests/e2e/camera.spec.ts:161-167` `FIXED`, `:237-240` | 고정 맵 자리 표에 `A: [8,16]`, `B: [40,16]`만. 거점 · 탈출구 · 감옥 화살표의 `[tx,ty]`가 이 표와 같아야 하고 `expect(f).toBeDefined()` | **깨짐(확실에 가까움)** — 213-262줄 생존자 화살표 시험에서 러너 (9.5,17)의 창 밖에 대기 중인 C가 있어 `point:C` 화살표가 생긴다 | 표를 `CAPTURE_POINTS`에서 만들거나 C 추가 |
| `tests/e2e/camera.spec.ts:222` | 스카우트를 "북쪽" (25.5, 4.5)에 둔다 | C1이면 C 중심에서 2.92타일 — 원(2.5) 밖 0.42. 안 깨지지만 아슬아슬 | (30, 4.5)처럼 멀리 |
| `tests/e2e/camera.spec.ts:264-303` | 괴물 화면 화살표가 정확히 `['point']`(점령 중인 A 하나) | 통과 — 괴물은 점령 중인 거점만 본다. 가드 (29.5,25.5) · 괴물 (20.5,24.5)는 C2 원 밖 | — |
| `tests/e2e/m10-map.spec.ts:66-72` | 정보 레이어 배지 tag가 정확히 `['point-A','point-B','exit-N','exit-S','prison']` | **깨짐(확실)** — 배지가 6장이 되면 | `'point-C'` 추가 |
| `tests/e2e/m10-map.shared.ts:493-499` `exitOpensWhileFrozen` | 스카우트 봇을 A · B에 차례로 세워 "두 거점 완료 → 탈출구 활성" | 통과 | 주석만 |
| `tests/e2e/m10-map.shared.ts:336-345,420-421,459,596-630` | 배지 · 정지 탐침이 모두 A 기준 | 통과 | — |
| `tests/e2e/m10-map.shared.ts:224-234,272,538` | 탐침: 기둥 (23-24, 24-25) 테두리, 러너 (22.5,25.5) | C1이면 무관. **C2(남쪽, 기둥 없앰)면 깨짐** | — |
| `tests/e2e/minimap-sharp.spec.ts:62-69` | 크게 본 지도의 "바닥만" 재려고 가리는 표시 목록에 A · B · 탈출구 · 감옥만 | **조용한 왜곡** — C 표시가 바닥 화소로 세어져 선명도 비교가 흔들린다(실패할 수도) | `Object.values(CAPTURE_POINTS)`로 |
| `tests/e2e/m10-hud.spec.ts:144-189` | 디버그 `getHud().pointA/pointB · pointAChip/pointBChip`, 칩 화소 자리를 `HUD.gaugeA.x + G.dia + G.gap` / `HUD.gaugeB.x − G.dia − G.gap − G.chip`로 계산(A는 배지 오른쪽에 칩, B는 왼쪽) | 디버그 키를 지키면 통과. **PC 게이지 구조(방향 · 칩 자리)를 바꾸면 화소 세기가 깨진다** | 칩 자리를 디버그 훅이 주는 사각형으로 읽게 바꾸기를 권함. `pointC` 상태 단언 추가 |
| `tests/e2e/m12-hud.spec.ts:36`, `debug-overlay.spec.ts:29`, `layout-editor.spec.ts:18`, `m12-screen.spec.ts:44` | `PERSISTENT = /^(timer\|gaugeA\|gaugeB\|card\d\|minimap…)$/` — 늘 떠 있는 HUD 부품 | **조용한 구멍** — `gaugeC`는 정규식에 안 걸려 겹침 검사에서 빠진다(`m12-hud.spec.ts:107` `continue`) | `gauge[A-C]` |
| `tests/e2e/m12-screen.spec.ts:232`, `layout-editor.spec.ts:179` | 부품 목록 `['timer','gaugeA','gaugeB','card0','card1','card2']`가 있다 | 통과(있는지만 본다) | `gaugeC` 추가 |
| `tests/e2e/play-settings.spec.ts:154-158` | PC 메뉴 버튼 오른쪽 끝 ≤ `292`(= 거점 A 게이지 왼쪽 580 − 288) | PC 위 띠에서 A를 왼쪽으로 옮기면 깨짐 | 상수를 `HUD`에서 계산 |
| `tests/e2e/hud-fit.spec.ts` (7크기 × 2역할) | 늘 떠 있는 HUD 부품이 서로 · 버튼과 안 겹친다 | 셋째 게이지가 좁은 화면에서 안 들어가면 깨짐(HUD 담당의 판정 시험) | — |
| `tests/e2e/m12-hud.spec.ts:398-404` | A 완료 → 메모 1, B 완료 → 알림 두 줄(해독 완료 · 탈출구) + 메모 2 | 통과(둘째 완료에 탈출구가 켜지는 것은 그대로) | — |
| `tests/e2e/m12-lifecycle.spec.ts:404-406`, `m8-effects.spec.ts:134-147`, `m11-mixed.spec.ts:283-292` | A(· B)를 `setPoint` + `teleport`로 끝낸다 | 통과 | 주석 "두 거점이 모두 끝나" |
| `tests/e2e/m11-mixed.spec.ts:295` | 러너 · 가드를 "북문 반경 밖 바로 아래" (23.5,5) · (24.5,5)에 둔다 | C1이면 **꺼진 C 원 안**(2.06타일). 규칙 영향은 없다(꺼짐). 화면에 꺼진 고리가 깔릴 뿐 | 그대로 둬도 됨 |
| `tests/e2e/m7-hud.spec.ts:53-57` | 역할별 스크린샷 장면: 러너 A 점령 중, B 0.45, 괴물 (26,25) | 통과. C2면 괴물이 C 원 안(2.0타일) | — |
| `tests/e2e/m3-info.spec.ts:72,82,85` | 괴물 조준점 (24,10) · (24,28), 괴물 자리 (24,23) | 조준점은 화면 좌표로만 쓰여 기둥이 생겨도 무관. C2면 괴물이 C 원 안 | — |
| `tests/e2e/m10-fog.webgl.spec.ts:70-73` | 기둥 (23, 24) 덩어리를 `find(…)!`로 찾는다, 발광 탐침 = 거점 A | C1이면 무관. **C2면 `undefined`로 깨짐** | — |
| `tests/e2e/m10-fog.spec.ts:101,121` 등 | 러너 (21.5,25) 탐침 줄 | C1이면 무관. C2면 원 가장자리(2.50타일) | — |
| `tests/e2e/perf-budget.spec.ts` · `perf-budget.webgl.spec.ts` + `perf-budget.json` | 같은 시드 봇 연습 판의 프레임당 일의 양 ≤ 기준 × 1.05 (예: `drawsPerFrame 8`, `pathOffPerFrame 279.15`) | **다시 재야 할 가능성 높음** — 거점 조각이 2 → 3(`client/src/render/fogGpu.ts:805-815`), 봇 · 맵이 바뀌어 같은 시드 판이 달라진다 | `tests/e2e/perfBudget.ts:1-8`의 절차: `DECOY_PERF_LABEL=<이름> npx playwright test --config tests/perf/playwright.config.ts work-counts` → `node scripts/perf-budget.mjs artifacts/perf/<이름>/work-counts.json` + DECISIONS에 이유 |
| `tests/e2e/bundle-size.spec.ts:76-81,112-116` (@core) | 첫 로딩 JS ≤ PR #31 병합 317,761B + 3KiB, 전체 ≤ 379,219B + 12KiB | **깨질 가능성 높음** — PR #32 뒤 값이 약 320,510B · 387,580B(`docs/PROGRESS.md:595`)라 첫 로딩 여유가 약 0.3KiB | `MILESTONE`의 기준을 PR #32 병합 값으로 옮기고 이번 작업 예산을 정한다(DECISIONS '번들 예산' 줄). 상한(346,679B · 436,791B)까지는 약 26,000B · 49,000B 남아 있다 |
| `tests/e2e/meta.spec.ts:41-52,276-302` | 판 평가 · 도전 E2E: 생존자 승리를 `setSurvivor escaped`로 만든다. 도전은 `s-escape` · `a-win`인 날을 찾아 쓴다 | 통과(거점과 무관, 도전 후보 수가 바뀌어도 날을 다시 찾는다) | — |

### 2.4 촬영 스펙 (시험이 아니라 그림을 만든다 — 6절)

| 파일:줄 | 장면 | 영향 |
|---|---|---|
| `tests/store/store-shots.spec.ts:263-322` | 괴물 화면: 거점 A 0.35(274줄), 생존자 둘 점령 중 | 단언에 거점 수 가정 없음. 그림은 달라진다 |
| `tests/store/store-shots.spec.ts:324-352` | 생존자 화면: A 0.42(335줄) 점령 중 발각 | 같음 |
| `tests/store/store-shots.spec.ts:354-399` | 감옥 구조 → 결과 | 같음 |
| `tests/camera/final-shots.spec.ts:103-125,127-170`, `camera-shots.spec.ts:103`, `final-gif.spec.ts:59` | B 0.42 / A 점령 중 장면. 122줄 화살표 `arrayContaining(['monster','point','teammate','teammate'])` | 통과. 스카우트 (25.5,4.5)는 2.3절과 같은 자리 |
| `tests/char-art/compare.spec.ts:335,383` | A 0.42 · 0.35 | 통과 |
| `scripts/remaster-shots.mjs:28-36,240-241,331-340` | A (8,16.5) · B 0.45 · 괴물 (26,25) | 그대로 돈다(b1 3.6). C2면 괴물이 C 원 안 |

### 2.5 C 후보 자리별 좌표 충돌 (실험 2 요약, 전체는 `b3/coord-scan.txt`)

| 후보 | 시험 좌표가 원(2.5) 안에 드는 곳 | 평가 |
|---|---|---|
| **C1 (24,7)** + 기둥 (23-24,6-7) → (23-24,10-11) | `capture-exit.test.ts:114` (24.5,6) · `m11-mixed.spec.ts:295` (23.5,5) · (24.5,5) — 셋 다 **C가 꺼진 뒤** 자리. 둘레(3.3) 안: `camera.spec.ts:222` · `final-shots.spec.ts:111` (25.5,4.5), `visibility.test.ts:21`, `interest.test.ts:46`, `abilities.test.ts:58`, `m3-info.spec.ts:82`(조준점) | **충돌이 가장 적다.** 고칠 시험 0(권고 2건) |
| C2 (24,25) (남쪽, 기둥 (23-24,24-25) 없앰) | 안개 탐침의 기준 자리 러너 (21.5,25)(`m10-fog.spec.ts` · `m10-fog.webgl.spec.ts` · `camera.shared.ts:22` · `fog-paint.test.ts:237,261` · `fog-follow.test.ts:610`), 기둥 (23,24)를 찾는 `m10-fog.webgl.spec.ts:70` · `m10-map.shared.ts:227-228` · `pathfind.test.ts:152`, 괴물 자리 `m7-hud.spec.ts:56` · `m3-info.spec.ts:72` · `m13-practice.spec.ts:316`, `rescue.test.ts:43` (24,26.5), `m2-controls.spec.ts:21` · `m10-resolution.webgl.spec.ts:414` (24,27), 골든 시나리오 괴물 경유점 (25.8,25.5)(`rules-golden.test.ts:122` — `pointCamp.C`만 쌓이고 흐름은 그대로) | 살펴야 할 곳이 10곳 넘는다(생존자가 그 자리에 서면 C 점령이 시작돼 괴물 알림 · 배지 깜빡임이 탐침에 끼고, 기둥을 없애면 기둥을 찾는 시험이 깨진다) |
| C3 (19,4.5) | `m10-map.shared.ts:483` 러너 (21,3.5)(탈출구 열림 장면 — C가 꺼진 뒤), 둘레: `m10-fog.spec.ts:206-207,258,318`의 돌진 탐침 (16.9,2) · (19.4,2) | 적은 편 |

### 2.6 새로 필요한 시험 (지금 시험으로는 새 규칙이 하나도 보호되지 않는다)

"테스트 없이 규칙 코드를 추가하지 않는다"(CLAUDE.md). 골든 시나리오는 거점을 하나도 끝내지 않고 913틱쯤 괴물 승리로 끝나 **꺼짐을 지나지 않는다**(`rules-golden.test.ts:34,475-498`).

| 무엇 | 넣을 곳 | 비고 |
|---|---|---|
| 세 곳 중 아무 두 곳(AB · AC · BC, 순서 6가지)이 끝나면 그 틱에 탈출구 2곳 활성 + 남은 한 곳 꺼짐 | `capture-exit.test.ts` | b1 탐침 `…/b1/probe/tests/unit/zz-b1-rule-probe.test.ts`를 옮겨 쓰면 된다 |
| 꺼진 거점: 생존자가 서 있어도 진행 · `captureSeconds` · `ALERT_CAPTURE_START` 없음, 괴물이 3초 서 있어도 `blockWarn` 없음 | `capture-exit.test.ts`, `interest.test.ts` | |
| 같은 틱에 셋이 다 차면 배열 순서 앞 둘이 끝난다, 메모는 `NOTE_FIRST` · `NOTE_SECOND` 한 번씩, 완료 알림 2 · `ALERT_EXITS_ON` 1 | `capture-exit.test.ts` | |
| **정보 차단**: `world.points`(3개, `'off'` 포함)가 괴물 · 생존자 스냅샷에서 같은 값이고 id 순서 고정, `PointView`에 id · 진행 · 상태 말고 다른 키가 없다. 꺼진 거점 안에 선 생존자가 괴물 시야 밖이면 괴물 스냅샷 JSON에 그 자리 · 상태 변화가 없다 | `interest.test.ts` | 지금 이 파일은 거점을 전혀 보지 않는다 |
| `POINT_IDS.length === balance.capturePoint.count`, `Object.keys(CAPTURE_POINTS)` = `POINT_IDS`, `required ≤ count` | `map.test.ts` 또는 `balance.test.ts` | 지금 count와 맵을 잇는 것은 `balance.ts:273`의 상수뿐 |
| 판 기록: `pointsLeft` 2 → 1 → 0, 꺼짐은 `pointStops`가 아니다, 꺼진 거점 안 타격은 `zoneHits`가 아니다, 꺼진 뒤 `captureSec`가 안 오른다 | `meta-record.test.ts` | 실험 5(`b3/probe/tests/unit/zz-b3-meta-probe.test.ts`)를 옮겨 쓰면 된다 |
| 클라이언트: 꺼진 거점의 게이지 · 배지 · 바닥 고리 · 미니맵 · 화살표(없음), C가 HUD · 미니맵 · 화살표 글자에 나온다 | `hud.test.ts` · `objects.test.ts` · `offscreen.test.ts` · `map-art.test.ts` · `fog-paint.test.ts` | b1 탐침 `zz-b1-client-silent.test.ts`가 지금 틀린 값 셋을 재현한다 |
| 봇: 생존자가 이긴 판의 끝난 거점 조합이 AB에 고정되지 않는다(시드 여럿), 봇이 꺼진 거점에 머물지 않는다 | `tests/bots/practice.test.ts` | 봇 담당. 빠른 C 봇 300판에서 조합은 AB 101 · AC 92 · BC 32 |
| E2E 한 줄: A · C로 탈출구를 켠다(B 꺼짐), HUD에 꺼짐이 보인다 | `m5-match.spec.ts` 또는 `m10-hud.spec.ts` | `setPoint point: 'C'`는 타입만 넓히면 된다 |

### 2.7 골든 (`tests/unit/rules-golden.test.ts`)

- **무엇으로 만드나**: 시드 `20261008`(32줄) · 자리 p1 괴물 / p2 러너 / p3 가드 / p4 스카우트(`tests/helpers/fixtures.ts:10-18`)로 `newGame`, 상태를 보고 입력을 정하는 스크립트(`Script`, 105줄~)로 960틱. sha256에 넣는 것은 ① `matchmaking`을 뺀 **balance 전체 JSON**(433-435줄) ② 0틱 + 60틱마다의 상태 직렬화 17줄(`serialize`, 288-364줄: 틱 · 시간 · `codes` · `capturedCount` · `points[{id, progress, done, capturing, blocked}]` · 탈출구 · 감옥 · 플레이어 전 필드(괴물의 `pointCamp: [A, B]` 328줄 포함) · 시야 판정 · 끝났으면 `buildResult`).
- **왜 바뀌나**: ① balance에 `count: 3` + 새 키 ② `points`가 3개. 기둥을 옮기는 것만으로는 **안 바뀐다**(b2의 맵만 바꾼 실행에서 통과 — 시나리오 경로 · 시야가 그 칸을 안 지난다).
- **갱신 절차**(머리말 4-6줄, 39-40줄): ① `docs/GAME_DESIGN.md` 13장 변경 이력에 규칙 변경을 적는다 ② `npx vitest run tests/unit/rules-golden.test.ts` → 실패 메시지의 `(새 해시 …)`를 `GOLDEN_HASH`(31줄)에 넣는다. **이 해시는 만든 뒤(커밋 `c8dd0c9`) 한 번도 바뀐 적이 없다** — 처음 있는 의도한 갱신이므로 DECISIONS에도 한 줄.
- **같이 고칠 것**(해시가 새 규칙을 실제로 잡게): 직렬화에 `off`를 넣고(354-360줄), `pointCamp`를 `POINT_IDS` 순서 3칸으로(328줄). 안 넣으면 꺼짐 상태가 바뀌어도 해시가 그대로다.
- 참고: 사본(C1 + 기둥 + 최소 변경, 직렬화는 안 고침)의 새 해시는 `e5f1a56d…895a8`이었다 — 실제 작업의 값은 직렬화 · 키 이름에 따라 다르다.
- "빈 시나리오 방지" 단언(457-498줄: `capturing:A/B`, `blocked:A`, A 진행 > 5 등)은 그대로 통과한다(실행). 시나리오를 늘려 꺼짐까지 지나게 할 수도 있지만 32초 시나리오로는 무리 — 2.6의 전용 시험으로 지키는 편이 낫다.

## 3. 판 평가

### 3.1 지금 정의

- 수치는 `shared/src/sim/record.ts`의 `MatchRecorder`가 틱마다 판정 상태를 **읽기만** 하며 센다(쓰지 않음 · 난수 없음, 1-4줄). 수치 이름은 `shared/src/types.ts:320-357` `RatingStatId`.
- 점수 = Σ 가중치 × 수치(`shared/src/meta/rating.ts:29-36` `emblemScore`, 소수 첫째 자리 반올림), 단계 = 넘은 기준 수 0~4(`rating.ts:22-26` `tierOf`). 수치는 `config/progression.json`.

| 항목 | 가중치 (`progression.json`) | 단계 기준 1~4 | 거점과 닿는 수치의 정의 (`record.ts`) |
|---|---|---|---|
| 생존자 **점령** `capture` (5-12줄) | `captureSec` ×1 · `exitSec` ×3 | 10 · 24 · 38 · 52 | `captureSec` = `s.stats.captureSeconds`(296줄) — **점령이 도는 거점 안에 서 있던 초**(`capture.ts:38`, 인원 배율과 무관하게 한 사람당 1초/초, 정지 중에는 안 오름) |
| 괴물 **저지** `deny` (51-60줄) | `pointStops` ×2 · `blockSec` ×0.5 · `zoneHits` ×4 · **`pointsLeft` ×10** | 6 · 16 · 28 · 42 | `pointsLeft` = `game.points.filter((p) => !p.done).length`(329줄, 0~2) · `pointStops` = 1초(`POINT_STOP_MIN_SEC`) 넘게 이어지던 점령이 꺼졌고 `!p.done`이며 괴물이 8타일(`PRESSURE_TILES`) 안(166-182줄) · `blockSec` = `p.blocked`인 초(167줄) · `zoneHits` = 안 끝난 거점 안 · 켜진 탈출구 근처에서 맞힌 수(228, 346-359줄) |
| 괴물 문지기 `gate` (70-78줄) | `kept` ×10 · `exitStops` ×8 · `exitHoldSec` ×0.2 | 10 · 20 · 30 · 42 | 간접: 탈출구가 켜진 뒤부터 센다(197-199줄) |

`rating.ts` · `daily.ts` · `progressionCheck.ts`는 수치 이름만 쓰므로 **코드 변경이 없다**. `progressionCheck.ts:15-44`의 수치 목록도 그대로.

### 3.2 `pointsLeft` — 정의 제안: `max(0, 필요한 수 − 끝난 수)`

| 정의 | 값의 범위 | 하나도 못 끝냄 / 하나 / 둘(탈출구 켜짐) | 평가 |
|---|---|---|---|
| 지금 코드 그대로("안 끝난 거점 수", 꺼진 곳 포함) | 1~3 | 3 / 2 / **1** | 다 끝낸 판에도 괴물이 +10, 못 끝내면 +30(= 금 기준 28을 혼자 넘는다). 300판 실행: 저지 p50 18 → 30.4, 단계 비율 0·33·50·17·0% → **0·0·34·57·8%** |
| 꺼진 곳만 빼고 셈(`!done && !off`) | 0, 2, 3 | 3 / 2 / 0 | 탈출구가 안 켜진 판만 +10씩 부풀어 값이 끊긴다 |
| **제안: `Math.max(0, required − 끝난 수)`** | 0~2 (지금과 같음) | **2 / 1 / 0** | 뜻이 "탈출구를 켜는 데 모자랐던 점령 수"로 이어지고 가중치 10 · 기준 `[6,16,28,42]`를 그대로 쓴다. 300판 실행: 저지 p50 18 → 20.2~20.4(은 그대로), 단계 비율 0·21~24·55~59·19~21·0~1% |

- 질문("세 곳 중 두 곳이면 '남은 거점'은 꺼진 한 곳을 빼고 세야 하는가")의 답: **그렇다 — 다만 "꺼진 곳을 뺀다"가 아니라 "필요한 수에서 끝난 수를 뺀다"로 적어야** 탈출구가 안 켜진 판(꺼진 곳이 아직 없다)까지 0~2로 맞는다.
- **끝난 수는 `capturedCount`가 아니라 `points.filter(done).length`로** 세기를 권한다: `tests/unit/meta-record.test.ts:237`처럼 시험이 `p.done = true`를 직접 켜는 곳이 있어 `capturedCount` 기준이면 그 상태에서 2가 나온다(실험 5의 셋째 항목으로 재현). 정상 진행에서는 두 값이 같다.
- 지켜 주는 시험: `tests/unit/meta-record.test.ts:126`(`pointsLeft` 2)이 이미 있다 — 정의를 안 고치면 3이 되어 실패한다.
- 주석 · 문서: `shared/src/types.ts:329-330` "pointsLeft 끝까지 남은 거점" → "탈출구를 켜는 데 모자란 점령 수(0~2, 꺼진 거점은 세지 않는다)". 문서 문장은 5절.

### 3.3 그 밖의 수치

| 수치 | 3곳 중 2곳에서 | 조치 |
|---|---|---|
| `pointStops` (`record.ts:175-181`) | 둘째 거점이 끝나는 틱에 셋째가 꺼지면 "1초 넘게 이어지던 점령이 멈춤 + `!done` + 괴물 8타일 안"이 성립해 **끊긴 점령 1회로 세어진다**(b1 탐침 5로 재현) | `&& !p.off`. 실험 5에서 가드를 넣은 사본은 0으로 확인(괴물을 6타일에 두고 재현 조건을 맞춤) |
| `zoneHits` (`record.ts:348-352`) | 꺼진 거점 안에서 맞혀도 "저지 타격"으로 센다 | `if (p.done \|\| p.off) continue`. 꺼진 곳은 더 이상 목표가 아니다 |
| `blockSec` (`record.ts:167`) | 꺼질 때 `blocked = false`면 자동 | 없음 |
| `captureSec` (`record.ts:296`) | **버려진 점령 초도 들어간다**: 나중에 꺼진 거점에서 쌓은 초가 그대로 남고(실험 5: 가드 약 4.5초), 꺼진 뒤에는 서 있어도 안 오른다. 필요한 점령량(2곳 × 40초)은 그대로인데 버려지는 몫이 얹혀 분포가 오른다(3.4) | **그대로 센다**를 권한다 — "점령하며 머문 초"라는 지금 뜻 그대로이고, 결과 화면 '점령 기여' 칸(`client/src/ui/result.ts:49-51`, 같은 `captureSeconds`) · `buildResult`(골든)와 같은 값이 유지된다. 빼려면 거점별 · 사람별 장부가 새로 필요하다. 문서에 한 줄 적는다(5절) |
| `exitSec` · `exitHoldSec` · `kept` · `exitStops` | 정의 그대로. 값은 생존자 승률을 따라 움직인다 | 없음 |

### 3.4 `scripts/meta-calibrate.ts` — 무엇을 하고 어떻게 돌리나, 지금 분포

- **하는 일**(51줄짜리 기록용 스크립트): `config/balance.json`을 읽어 검증 → `preparePracticeMap()` → 시드 1~N마다 실전 봇 넷(`practiceBrain(role, seed)`)의 `SimMatch`에 `MatchRecorder`를 붙여 판이 끝나거나 12분이 될 때까지 돌린다 → 자리마다 `rateMatch` · `matchXp` → 항목별 점수 p10 · p50 · p90, 단계 0~4 개수, 지금 기준, 수치별 p10 · p50 · p90, 경험치를 찍는다. **아무것도 쓰지 않는다**(화면 출력뿐, `progression.json`은 사람이 고친다).
- **실행**: `npx tsx scripts/meta-calibrate.ts [판 수=60]` (리포 루트에서). 이 컨테이너에서 60판 14초, 300판 65~105초. 판단 기준은 머리말 3줄 "봇 판 중앙값이 은(2) 안팎이면 알맞다", 기록은 `docs/META_PLAN.md:83-94`(5절 표의 마지막 열) · `docs/DECISIONS.md:635`.
- **지금 값 60판**(`b3/calib-base-60.txt`) — META_PLAN 5절 표와 같다(반올림): 생존자 승 30/60

| 평가 | 점수 p10 · p50 · p90 | 단계 0·1·2·3·4 (자리 수) | 기준 |
|---|---|---|---|
| capture | 20.9 · 34.5 · 49.5 | 1·29·70·73·7 | 10 24 38 52 |
| rescue | 0 · 17.5 · 50.9 | 47·0·70·32·31 | 3 14 24 38 |
| survive | 8.5 · 21.2 · 62.9 | 29·65·14·46·26 | 10 22 40 62 |
| evade | 10.1 · 26.9 · 49.5 | 11·36·55·49·29 | 8 18 30 45 |
| hunt | 36 · 76 · 104 | 1·7·14·30·8 | 15 40 70 100 |
| deny | 12.4 · 18 · 30.4 | 0·17·32·11·0 | 6 16 28 42 |
| track | 37.6 · 59 · 83.5 | 0·5·26·25·4 | 15 35 60 90 |
| gate | 1.9 · 23 · 32.6 | 9·17·5·28·1 | 10 20 30 42 |

  수치(60판 p10 · p50 · p90): `captureSec` 19.9 · 33.7 · 42.4, `pointStops` 5 · 8 · 10, `blockSec` 0 · 0.2 · 1.7, `zoneHits` 0 · 0 · 0, `pointsLeft` 0 · 0 · 1, 경험치 80 · 140 · 190.

- **세 실행 비교 300판**(실험 4, `b3/compare-dumps.out.txt`). 단계 비율은 0 · 1 · 2 · 3 · 4 순.

| 평가 | 지금(2곳) | 규칙 + 맵만(봇 그대로, C1) | 빠른 C 봇(가정) |
|---|---|---|---|
| 생존자 승 | 163/300 | 154/300 | 180/300 |
| 끝난 거점 조합 | AB 211 · A 32 · B 31 · 없음 26 | AB 211 · A 40 · B 30 · 없음 19 | AB 101 · AC 92 · BC 32 · A 20 · B 21 · C 23 · 없음 11 |
| **capture** 점수 p10 · p50 · p90 | 19 · 35.6 · 49.5 | 19.6 · 38.2 · 52.9 | 21.2 · 40.7 · 56.6 |
| capture 단계 비율 | 1 · 18 · 38 · 36 · **6**% | 1 · 15 · 33 · 39 · **12**% | 1 · 13 · 29 · 38 · **19**% |
| **deny** 점수 (제안 정의) | 12.1 · 18 · 30.7 | 12.1 · 20.4 · 30.6 | 12 · 20.2 · 31.1 |
| deny 단계 비율 (제안 정의) | 0 · 33 · 50 · 17 · 0% | 0 · 21 · 59 · 19 · 1% | 0 · 24 · 55 · 21 · 0% |
| deny (단순 정의) 점수 · 비율 | (같음) | 22.1 · 30.4 · 40.6 / 0 · 0 · 34 · 57 · 8% | 22 · 30.2 · 41.1 / 0 · 0 · 36 · 55 · 9% |
| gate p50 · 중앙 단계 | 21.5 · 은 | 23 · 은 | 14.6 · **동** |
| hunt p50 · 중앙 단계 | 72 · 금 | 72 · 금 | 64 · **은** |
| survive p50 | 20.8 | 17.5 | 22.6 |
| `captureSec` p10 · p50 · p90 · 평균 | 18.2 · 32.1 · 42.9 · 31.3 | 19.3 · 34 · 46.7 · 33.7 | 20.7 · 36.3 · 49.8 · 35.7 |
| 팀 점령 초 합 평균 | 93.9 | 101.0 | 107.1 |
| `pointStops` p50 · p90 · 평균 | 8 · 10 · 7.7 | 8 · 12 · 8.2 | 8 · 12 · 8.6 |
| `pointsLeft` 0 · 1 · 2인 판 수 (제안 정의) | 211 · 63 · 26 | 211 · 70 · 19 | 225 · 64 · 11 |

  읽는 법: ① **저지**는 제안 정의면 분포가 거의 그대로다(중앙 은). ② **점령**은 봇을 안 고쳐도 +2~3점 오른다 — 봇이 위험할 때 "다른 거점"으로 C에 가서 버려지는 초를 쌓기 때문이다(조합에 C가 없는데 `captureSec`만 오름). C를 제대로 쓰면 +5점. ③ 문지기 · 사냥이 내려가는 것은 정의가 아니라 **생존자 승률**(54% → 60%) 때문이다 — 봇 · 밸런스가 정해지면 같이 정해진다.

### 3.5 `progression.json`에서 바꿀 것 — 후보만 (메타 수치라 바꿀 수 있지만 최소로)

| 후보 | 지금 → 바꾼다면 | 근거 | 권고 |
|---|---|---|---|
| (가) 아무것도 안 바꾼다 | — | `pointsLeft` 정의(3.2)와 가드 둘(3.3)을 코드에서 지키면 저지 기준이 그대로 맞고, 점령 중앙값도 "은~금"(GAME_DESIGN 12.1 · `meta-calibrate.ts` 머리말) 안 | **1순위** |
| (나) `emblems.capture.tiers` | `[10, 24, 38, 52]` → `[12, 28, 44, 60]` | 빠른 C 봇 분포에서 지금과 같은 단계 비율이 되는 점수가 11.9 · 27.8 · 43.8 · 59.3(봇 그대로면 10.2 · 25.2 · 40.7 · 55). 빛이 6% → 19%로 느는 것을 되돌린다 | 최종 봇으로 다시 잰 뒤 빛 비율이 눈에 띄게 늘었을 때만. 바꾸면 GAME_DESIGN 12장 표 · 변경 이력 + META_PLAN 5절 표 |
| (다) `emblems.deny.tiers` | 그대로 | 제안 정의면 불필요. **단순 정의로 가면** `[16, 26, 38, 52]`(+10)로 올려야 같은 분포 — 권하지 않는다(가중치의 뜻이 흐려진다) | 그대로 |
| (라) `emblems.gate` · `hunt` · `survive` | 그대로 | 승률을 따라 움직인 것. 밸런스(HUMAN_CHECKS) 뒤 | 그대로 |
| (마) `daily` 목표 | 그대로 | 4절 | 그대로 |

**다시 재는 순서**(실제 작업에서): 규칙 · 맵 · 봇을 다 고친 뒤 `npx tsx scripts/meta-calibrate.ts 60`(문서 기록과 같은 판 수) → `docs/META_PLAN.md` 5절 표의 "봇 판 점수" 열과 `docs/DECISIONS.md` 14절에 새 값 → 사람 판은 `docs/HUMAN_CHECKS.md:323`의 기존 항목 그대로. 값이 실행마다 조금 흔들릴 수 있다(7절).

## 4. 일일 도전 (`shared/src/meta/daily.ts` · `progression.json` `daily`)

- 고르기: `pickDaily(day, prog)`(`daily.ts:50-55`)가 팀마다 `hash('날짜|팀') % 후보 수`로 하나씩. 진행: `challengeDelta`(`daily.ts:69-90`) — `kind: 'stat'`이면 그 팀 판의 `rating.stats[def.stat]`을 그대로 더한다(판을 넘겨 쌓인다). 완료는 `profile.ts`가 목표 이상일 때.
- **후보 14개 가운데 "거점 N곳 점령" 같은 도전은 없다.** 거점과 닿는 것은 아래 셋.

| id (`progression.json`) | 원문 (`client/src/data/storyText.ts`, `docs/STORY_TEXT.md:316-317`) | 수치 · 목표 · 보상 | 3곳 중 2곳에서의 뜻 | 조치 |
|---|---|---|---|---|
| `s-capture` (109-115줄) | `'거점 점령에 {n}초 머물기'` (505줄) | `captureSec` ≥ 60 · 50 | 뜻 그대로("점령이 도는 거점 안에 머문 초"). **버려진 셋째 거점의 초도 센다**, 꺼진 거점에 서 있는 것은 안 센다. 조금 쉬워진다: 평균 31.3 → 35.7초/판(1.9 → 1.7판에 달성), 한 판 달성 0% → 1% | 문구 · 목표 그대로 |
| `m-stops` (181-187줄) | `'점령을 {n}번 끊기'` (515줄) | `pointStops` ≥ 8 · 40 | 뜻 그대로. 거점이 늘어 점령 시도가 늘면서 조금 쉬워진다: 한 판 달성 54% → 60~63%, 평균 7.7 → 8.6번. **`record.ts:176`에 `!p.off`가 없으면 "꺼짐"이 끊기로 세어져 뜻이 깨진다** | 문구 · 목표 그대로 + 가드 |
| `s-exit` (144-150줄) | `'탈출구 열기에 {n}초 머물기'` (510줄) | `exitSec` ≥ 6 · 40 | 간접(탈출구가 켜지는 판이 늘면 쉬워짐): 평균 4.9 → 4.3판 | 그대로 |
| `a-gold` (202-208줄) | `'평가에서 금 이상 {n}개 받기'` | 단계 ≥ 3인 항목 2개 | 간접: 생존자 '점령' 금 이상이 42% → 51~57% | (나)를 안 하면 조금 쉬워진다. 그대로 |

- 후보를 더하거나 빼지 않는 한 `pickDaily` 결과(날짜별 도전)는 그대로다. **후보 수를 바꾸면 그날 고른 도전이 바뀐다**(`% list.length`) — 배포한 날 진행 중이던 도전이 다른 것으로 바뀌므로 이번에는 건드리지 않기를 권한다. 시험은 견딘다: `tests/unit/meta-daily.test.ts:76-87`(한 달에 고루), `tests/e2e/meta.spec.ts:280-286`(맞는 날을 찾아 씀).
- 도전 문구 시험: `tests/unit/meta-daily.test.ts:89-95`(도전마다 `{n}`이 든 문구), `:116-123`(`s-capture`에 `captureSec` 25.5 → 25.5) — 그대로 통과.
- 나중에 "거점 2곳 점령" 같은 도전을 넣는다면: 개인 수치에 "끝낸 거점 수"가 없어 새 `RatingStatId`가 필요하고(`progressionCheck.ts:15-44` 목록 · `types.ts:330-357`), 한 판에 팀이 끝낼 수 있는 수는 최대 2(셋째는 꺼짐)임을 문구에 맞춰야 한다. 이번 범위 밖.

## 5. 문서 문장 — 고칠 것

`docs/GAME_DESIGN.md` 12.1 표(223-232줄)와 그 아래:

| 줄 | 지금 | 바꿀 문장(제안) |
|---|---|---|
| 225 | `\| 생존자 \| 점령 \| 거점 점령 기여 초 · 탈출구 열기에 머문 초 \|` | `거점 점령 기여 초(점령이 도는 거점 안에 머문 초 — 다른 두 곳이 먼저 끝나 꺼진 거점에서 쌓은 초도 센다) · 탈출구 열기에 머문 초` |
| 230 | `\| 괴물 \| 저지 \| 끊은 점령(1초 넘게 이어지던 점령이 괴물 8타일 안에서 멈춤) · 거점 진행을 멈춘 초 · 거점 · 켜진 탈출구 안 타격 · 끝까지 남은 거점 \|` | `끊은 점령(1초 넘게 이어지던 점령이 괴물 8타일 안에서 멈춤 — 거점이 꺼져서 멈춘 것은 세지 않는다) · 거점 진행을 멈춘 초 · 끝나지도 꺼지지도 않은 거점 · 켜진 탈출구 안 타격 · 끝까지 모자란 점령 수(탈출구를 켜는 데 필요한 두 곳 중 생존자가 끝내지 못한 수, 0~2 — 꺼진 한 곳은 세지 않는다)` |
| 234 | `가중치 · 기준은 config/progression.json(처음 값은 실전 봇 판 60개에서 중앙값이 은~금이 되게, scripts/meta-calibrate.ts).` | 기준을 안 바꾸면: 끝에 `거점 세 곳 중 두 곳 규칙에서 다시 쟀고 기준은 그대로다(<날짜>, META_PLAN 5절).` / (나)를 하면 바뀐 기준과 이유 |
| 13장 변경 이력(281-) | — | 규칙 변경 한 줄(문서 담당)에 `판 평가 '끝까지 남은 거점' = 필요한 수 − 끝난 수(0~2 그대로), progression.json 수치 변경 없음(또는 capture 기준 변경)`을 같이 적는다. `balance.json`을 바꾸므로 "수치 변경 없음" 꼬리말은 이번에는 쓰지 못한다 |

12.4(249-254줄) 일일 도전 문장은 거점을 말하지 않아 그대로. 12.1 밖에서 같이 맞출 곳(문서 담당 몫, 참고): `docs/META_PLAN.md:87`(점령), `:92`("남은 거점" · 봇 판 점수 12 · 18 · 30), `:101`(도전 후보 목록 — 그대로), `shared/src/types.ts:323-331` 주석, `docs/GAME_DESIGN.md:23,25,131-135,139`(규칙 본문 — b1 3.11). `docs/STORY_TEXT.md:288,293`와 `storyText.ts:465,470`의 평가 설명("거점 점령 · 탈출구 열기에 머문 시간", "점령 끊기 · 거점 지키기 · 거점 안 타격")은 그대로 맞는다.

## 6. 스토어 그림 · 최종 스크린샷

그림을 직접 열어 확인했다(스토어: `phone-1`~`phone-5` · `feature-graphic` 6장 모두 / 최종: `role-runner` · `match-pc-monster` · `match-phone-survivor` · `layout-editor-phone` 4장 — 나머지 판 화면은 같은 촬영 · 같은 HUD라 같다고 본다).

| 파일 | 지금 담긴 것 | 다시 찍나 |
|---|---|---|
| `artifacts/store/phone-2-monster.png` | 터치 HUD 왼쪽 위 **고리 게이지 A · B 둘**, 미니맵에 거점 표시 둘, B 화살표 | **예** |
| `artifacts/store/phone-3-survivor.png` | 같은 게이지 둘 + 미니맵 + B 화살표, 거점 A 점령 중 | **예** |
| `artifacts/store/phone-4-rescue.png` | 게이지 둘, 미니맵 거점 둘, A · B 화살표(감옥 앞이라 C1도 창 밖 → 화살표가 하나 더 생긴다) | **예** |
| `artifacts/store/feature-graphic.png` | 거점 B 방 배경 + 캐릭터 넷, **HUD 없음** | 꼭은 아니다(같은 명령이 함께 다시 만든다) |
| `artifacts/store/phone-1-lobby.png` | 연습 역할 고르기. 배경에 희미한 맵 도면 선 | 꼭은 아니다(도면에 C · 옮긴 기둥이 비칠 수 있다 — `client/src/ui/uiArt.ts:364-378`) |
| `artifacts/store/phone-5-result.png` | 결과 표('점령 기여' 칸 0초) | 아니오 |
| `artifacts/store/app-icon-512.png` | 로고 | 아니오 (`npm run icons` 것) |

- 만드는 법: `npm run shots:store`(= `npm run build` + `playwright test --config tests/store/playwright.config.ts`, `tests/store/store-shots.spec.ts`). 6장과 `manifest.json`을 같이 다시 쓴다(`:233-248`). 스펙 코드에는 거점 2개 단언이 없어 **고칠 필요 없이 다시 돌리기만** 하면 된다.
- 뒤따르는 시험: `tests/unit/store-images.test.ts:107-136`(manifest의 크기 · 바이트 = 지금 파일, 터치 대상, WebGL · 높음 · 새 캐릭터), `:83-105`(장면이 서로 다름), `:167-171`(git에 있음) — 그림과 manifest를 **같이 커밋**해야 통과.
- 문서: `docs/STORE_LISTING.md:178-182` 그림 표의 장면 설명은 거점 수를 말하지 않아 그대로 쓸 수 있다. 다만 182줄 "구조 51%"는 지금 그림(47%)과 이미 다르다 — 스펙이 45% 이상에서 찍어 값이 흔들린다(`store-shots.spec.ts:376-383`). 다시 찍을 때 표도 맞춘다. 37줄 "거점 A · B를 점령하면 탈출구 두 곳이 켜집니다"는 문서 담당.

`artifacts/final/`(README · 최종 보고용, `README.md:17-19,66`):

| 파일 | 지금 담긴 것 | 다시 찍나 |
|---|---|---|
| `role-monster.png` · `role-runner.png` · `role-guard.png` · `role-scout.png` · `tab-runner.png` | PC 위 띠: 타이머 왼쪽 A 게이지 · 오른쪽 B 게이지, 미니맵 거점 둘 | **예** — `scripts/remaster-shots.mjs`(`docs/PROGRESS.md:413`, 장면은 머리말 28-29줄) |
| `match-pc-monster.png` · `match-phone-survivor.png` · `match-phone-walk.gif` | PC 위 띠 게이지 둘 / 터치 고리 게이지 둘 | **예** — `tests/camera` 촬영(`docs/PROGRESS.md:522`) |
| `layout-editor-phone.png` | HUD 미리보기 이름표 "거점 A" · "거점 B" | **예** |
| `settings-phone.png` · `lobby.png` · `result.png` | 판 HUD 없음 | 아니오(`lobby.png`는 방 화면 지도 그림에 C가 생기면 다시) |

`artifacts/camera/` · `artifacts/remaster/` · `artifacts/perf/` · `artifacts/characters/`도 판 화면(게이지 둘)을 담고 있지만 **지난 결정의 전후 비교 기록**이다(카메라 확대 후보 · 리마스터 전후 등). 선례: README 그림을 바꿀 때 "`artifacts/camera/final/`의 확인 그림은 그대로 둔다"(`docs/PROGRESS.md:522`). 이번에도 그대로 두고 DECISIONS에 한 줄 남기기를 권한다. 일의 양 기준을 다시 재면 `artifacts/perf/<새 이름>/`만 새로 생긴다(2.3절).

## 7. 덤으로 찾은 것 (이번 변경과 무관한 기존 사항)

1. **실전 봇 판이 같은 시드에서 완전히 재현되지는 않는다.** 같은 스크립트를 두 번 돌리면 300판 중 2판(시드 84 · 227)이 달랐고, 그 두 시드를 6번씩 다시 돌리니 각각 두 결과 중 하나로 갈렸다(84: 5875틱 / 6704틱, 227: 4164틱 / 5540틱 — `b3/seedprint-*.txt`). 60판(시드 1~60)은 두 번 같았다.
   원인 후보: 괴물 스냅샷의 생존자 목록이 임시 ID(암호 난수, `shared/src/sim/random.ts:43-46` `newAliasId`) 순으로 정렬되어(`interest.test.ts:99-118`이 지키는 정보 차단 규칙) 괴물 봇이 **동률일 때 목록 순서로** 고르는 곳이 있는 듯하다(원인 줄까지는 쫓지 않았다).
   `tests/bots/practice.test.ts:225-230` "같은 시드는 같은 판 (임시 ID · 배열 순서가 달라도 결정이 같다)"는 시드 7 한 판만 다시 돌려 이 경우를 못 잡는다. 영향: 기준 맞추기 수치가 실행마다 단계 개수 한두 자리씩 흔들린다(300판 capture 344·327·56 ↔ 343·329·55), 봇 시험이 드물게 흔들릴 수 있다. 봇 담당에게 알릴 것.
2. **번들 첫 로딩 예산 여유 약 0.3KiB**(2.3절) — 이번 작업의 어느 마일스톤이든 클라이언트 코드를 더하면 `bundle-size`(@core)가 먼저 막는다.
3. `docs/STORE_LISTING.md:182` "구조 51%" ↔ 그림 47%(6절).

## 부록: 실험 파일 (`…/understand/b3/`)

| 파일 | 내용 |
|---|---|
| `probe/` | 리포 사본(`node_modules`는 링크) + b1 최소 규칙 변경 + C = (24,7) + 기둥 옮기기. `probe/scripts/b3-calibrate.ts`(두 정의를 같이 세는 기준 맞추기), `probe/tests/unit/zz-b3-meta-probe.test.ts`(판 기록 탐침 3개 — 실제 작업에 옮겨 쓸 수 있음) |
| `probe2/` | `probe`의 shared + 빠른 C 봇 가정(`shared/src/sim/practiceBrains.ts` 12줄) |
| `base/` | 리포 코드 그대로를 가리키는 실행 자리(같은 확장 스크립트 · `b3-seedprint.ts`) |
| `probe-vitest.txt` | 실험 1 전체 출력 |
| `coord-scan.py` · `coord-scan.txt` | 실험 2 |
| `calib-base-60.txt` · `calib-base-60-b.txt` · `calib-base-300.txt` · `calib-base-300-b.txt` | `scripts/meta-calibrate.ts` 그대로(두 번씩) |
| `calib-base-ext-300.txt` · `calib-probe-naivebots-300.txt` · `calib-probe-cbots-300.txt` · `dump-*.json` | 실험 4 출력 · 원자료 |
| `compare-dumps.mjs` · `compare-dumps.out.txt` | 세 실행 비교 표(단계 비율 · 같은 비율이 되는 기준 · 도전 달성률) |
| `seedprint-a.txt` · `seedprint-b.txt` | 실험 6 |

돌리지 않은 것: E2E 전체(`npm run build`가 필요), `npm run test:lag`, `tests/perf`, 촬영 스펙. 2.3 · 2.4절은 코드를 읽은 판단이다.
