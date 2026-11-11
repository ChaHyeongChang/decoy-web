# b1 — "거점은 2개(A · B)" 가정이 든 코드 전수 조사 (마일스톤 b: 3곳 중 2곳)

조사 기준 커밋 `da628d7` (작업 트리 깨끗함, 조사 뒤에도 `git status` 변화 없음). 리포는 읽기만 했고, 실험은 모두 사본
(`/tmp/claude-0/-home-user-decoy-web/6751cf0a-610a-5fe5-9da6-2668943efcba/scratchpad/understand/b1/probe/`)에서 했다.

## 0. 한눈에

1. **`capturePoint.count`는 지금 어디서도 읽지 않는다.** `shared/src/balance.ts:273`의 구조 검사(`=== 2`)에만 쓰이고, 실제 거점 수는
   `shared/src/map.ts:63`(`PointId = 'A' | 'B'`) · `map.ts:96-99`(`CAPTURE_POINTS`) · `shared/src/sim/game.ts:76-95`(배열 리터럴 2개)에 따로 박혀 있다.
   즉 balance.json만 3으로 바꾸면 서버가 시작 검증에서 죽고, 검사만 고치면 거점은 여전히 2개다. **네 곳(수치 · 검사 · 타입/좌표 · 상태 배열)을 한 커밋에서 같이** 바꿔야 한다.
2. **탈출구 활성 조건은 `exit.ts`가 아니라 `shared/src/sim/systems/capture.ts:61`** (`game.points.every((q) => q.done)`)에 있다. 여기를 "끝난 수 ≥ required"로 바꾸고
   같은 자리에서 남은 거점을 끄는 것이 규칙 변경의 전부다(서버 쪽 핵심 변경은 15줄 안쪽).
3. **컴파일러가 잡아 주는 곳은 적다.** 사본에서 `PointId`에 `'C'`, `PointState`에 `'off'`를 더해 `tsc`를 돌리면 오류는 **10곳뿐**이다(4절).
   나머지(HUD가 배열 순서로 게이지 2개만 그림, 미니맵이 C를 B 자리에 그림, 꺼진 거점에 화살표가 나옴, 꺼진 거점이 청록으로 칠해짐, 봇이 C를 계획에 넣지 않음,
   판 기록 `pointsLeft` · `pointStops`가 틀려짐)는 **조용히 틀린다**. 이 문서의 표에서 "조용함"으로 표시했다.
4. **'꺼진 거점' 그림은 지금 없다.** `PointState`는 `idle | capturing | blocked | done` 넷뿐이고(`shared/src/types.ts:169`), HUD 아틀라스 · 미니맵 · 맵 배지 · 바닥 링
   어디에도 꺼진 모양이 없다. 탈출구의 `inactive`(회색 `OBJ_COLOR.off` · 미니맵 `exit:off`)가 가장 가까운 선례다.
5. **괴물 화면에 생존자 구분 단서는 새로 생기지 않는다**(9절) — 거점 목록은 지금도 양쪽에 같은 값으로 가고(`interest.ts:211-215`), 꺼짐은 완료 배너 2번으로
   누구나 추론하는 공개 정보다. 단, 9절의 조건 다섯을 지켜야 한다(꺼진 곳에서 capturing/blocked/알림을 내지 않기, PointView에 사람 정보 넣지 않기, 봇의 거점 배정을 역할에 고정하지 않기, 메모는 생존자에게만, 배열 순서는 id 고정).
6. 사본에 최소 설계를 넣고 단위 · 봇 시험 전체(124파일)를 돌린 결과, 규칙 변경 때문에 깨진 것은 **3개뿐**이다: `rules-golden`(해시), `balance.test`(count 3이면 실패해야 한다는 시험),
   `bots/fullmatch`(`g.points.every(done)`). 클라이언트의 조용한 가정은 **기존 단위 시험이 하나도 잡지 못한다**(E2E는 돌리지 않았다) → 새 시험이 필요하다(8절).

## 1. 조사 방법

- grep: `CAPTURE_POINTS|PointId|\.points\b|capturedCount|allPointsDone|pointCamp|blockWarn|PointView|PointState|CapturePointState`,
  `'A'|'B'|['A', 'B']|point-A|point-B|gaugeA|gaugeB|pointA|pointB`, `count|both|allCaptured|every(|length === 2|[0]|[1]|west|east`, `거점|두 거점|두 곳|A · B` —
  범위 `shared/ server/ client/ scripts/`(+ 영향 파악용 `tests/ docs/`). 걸린 파일은 모두 해당 구간을 열어 읽었다.
- 실험(사본, 모두 `…/understand/b1/` 아래):

| # | 실험 | 결과 파일 | 결과 |
|---|---|---|---|
| 1 | 사본에서 `PointId`에 `'C'`만 더하고 `tsc -p shared/server/client` | `b1/step1-*.txt` | 오류 7곳 (4절) |
| 2 | 사본에서 `PointState`에 `'off'`만 더하고 `tsc` | `b1/step2-*.txt` | 오류 3곳 (4절) |
| 3 | 최소 설계(6절)를 shared에 적용(`b1/patch-shared.py`) 뒤 `tsc` + `vitest run --maxWorkers=2` | `b1/step3-*.txt`, `b1/probe-vitest.txt` | shared · server 타입 통과, 시험 3개만 규칙 때문에 실패 |
| 4 | 규칙 동작 시험 6개(4가지 순서 · 같은 틱 동시 완료 · 판 기록) | `b1/probe/tests/unit/zz-b1-rule-probe.test.ts` | 6/6 통과 |
| 5 | `record.ts`를 안 고치면? | (위 시험의 판 기록 항목) | `pointsLeft` 1(기대 0), `pointStops` 1(기대 0) — 실제로 틀려짐 |
| 6 | 클라이언트를 안 고치면? | `b1/probe/tests/unit/zz-b1-client-silent.test.ts` | 꺼진 거점 화살표 생성 · 꺼짐 색 = 청록 · C 배지 알파 `undefined` 확인 |

탐침의 거점 C 좌표 (25,10)은 **컴파일 · 시험용 임시값**이다(반경 2.5 안이 모두 바닥인 자리 중 하나, `b1/c-spots.mts`가 후보 121곳을 냈다). 자리 결정은 맵 담당 몫이다.

## 2. 지금 구조 요약

- 거점은 **타일이 아니다.** `MAP_ROWS`(`shared/src/map.ts:15-48`)에는 거점 문자가 없고, 좌표 표 `CAPTURE_POINTS: Record<PointId, Vec2>`(`map.ts:96-99`, A (8,16) · B (40,16))와
  반경 `balance.capturePoint.radius`(2.5)로만 정해진다. C를 더하는 일은 좌표 한 줄 + 그 반경 안이 바닥인지(`tests/unit/map.test.ts:87-94`가 `Object.values(CAPTURE_POINTS)`로 검사 — 자동 적용)다.
- 서버 상태: `Game.points: CapturePointState[]`(`game.ts:76-95`, `{id, progress, done, capturing, blocked, lastAlertAt, wasCapturing}`), `Game.capturedCount`(`game.ts:109`),
  `Game.codes: [string, string]`(`game.ts:108,122` — 생성자에서 난수 2번), 괴물의 `pointCamp: Record<PointId, number>`(`state.ts:87`, `game.ts:161`).
- 틱: `captureTick`(`capture.ts:10-43`)이 `game.points`를 배열 순서(A → B)로 돈다. 완료는 `complete()`(`capture.ts:45-65`).
- 스냅샷: `worldView()`(`interest.ts:210-232`)가 `points: PointView[]`(`{id, progress 0~1, state}`)를 **받는 사람과 무관하게 같은 값**으로 만든다(`forMonster`는 탈출구 진행 · 익명 목록에만 쓰인다).
- 클라이언트는 `snap.world.points`를 ① HUD 게이지 ② 미니맵 ③ 화면 밖 화살표 ④ 맵 배지 ⑤ 바닥 링(안개 레이어) 다섯 곳에서 그린다.

## 3. 발견 표

위험도: **높음** = 안 고치면 규칙 · 화면이 틀리거나 죽음 / **중간** = 보이는 결함 · 수치 왜곡 / **낮음** = 주석 · 이름 · 자동으로 따라옴.
"컴파일" = 타입을 바꾸면 `tsc`가 알려 줌, "조용함" = 알려 주지 않음.

### 3.1 수치 · 검증 · 맵 · 타입 (shared)

| 파일:줄 | 지금 가정 | 3곳 중 2곳에서 바꿀 내용 | 위험도 |
|---|---|---|---|
| `config/balance.json:59` | `"capturePoint": { "count": 2, … }` | `count: 3`, 새 키 `"required": 2` 추가. `_comment`(2줄)의 "count 값은 맵 구조에 묶여 바꾸지 않는다"에 required도 적기 | 높음 (검사와 같이 안 바꾸면 서버 · 연습 · 클라이언트 첫 묶음이 시작에서 `BalanceError`) |
| `shared/src/balance.ts:88-96` | `Balance.capturePoint`에 `required` 없음 | `required: number` 추가 (주석: 탈출구를 켜는 데 필요한 점령 수) | 높음 |
| `shared/src/balance.ts:201-209` | `SCHEMA.capturePoint`에 `required` 없음 | `required: 'int'` | 높음 |
| `shared/src/balance.ts:273` | `['capturePoint.count는 2여야 합니다 (맵 구조)', b.capturePoint.count === 2]` | `=== 3`으로. 그리고 `required` 구조 검사 추가 — **`required === 2`를 권한다**(비밀번호가 두 조각 · 메모 ID가 `NOTE_FIRST/SECOND` 둘 · `codes`가 2칸이라 1이나 3이면 메모가 모자라거나 `codes[2]`가 없다). 느슨하게 하려면 최소 `required <= count` | 높음 |
| `shared/src/balance.ts:300-308` `balanceHash` | 수치 전체 JSON 해시 | 자동으로 바뀜(디버그 오버레이 표시용). 조치 없음 | 낮음 |
| `shared/src/map.ts:63` | `export type PointId = 'A' \| 'B'` | `'A' \| 'B' \| 'C'`. **`export const POINT_IDS: readonly PointId[] = ['A','B','C']`를 여기에 새로 두기를 권한다**(지금은 `practiceBrains.ts:51`에 비공개로 `['A','B']`가 따로 있다) | 높음 |
| `shared/src/map.ts:96-99` | `CAPTURE_POINTS = { A: (8,16), B: (40,16) }` | `C` 좌표 추가(자리는 맵 담당). 반경 2.5 안이 모두 바닥이어야 함(`map.test.ts:87-94`) | 높음 |
| `shared/src/map.ts:1` (주석), `map.ts:115-122` `ZONES` | 구역 left/right/north/south/center, 거점은 left · right에 하나씩 | C가 놓일 구역에 따라 주석만. `ZONES` 자체는 거점 수 가정 없음 | 낮음 |
| `shared/src/types.ts:169` | `PointState = 'idle' \| 'capturing' \| 'blocked' \| 'done'` | `\| 'off'` 추가 (꺼진 거점) | 높음 |
| `shared/src/types.ts:171-175` `PointView` | `{id, progress, state}` | 필드 추가 없음(상태값만 늘림). **사람 수 · 누가 안에 있는지 같은 필드는 넣지 않는다**(9절) | — |
| `shared/src/types.ts:201` `WorldView.points` | `PointView[]` (길이 2가 옴) | 길이 3. 타입은 그대로 | 중간 (받는 쪽이 길이 · 순서에 기대는 곳: 3.7~3.9) |
| `shared/src/types.ts:115` `MonsterSelf.blockWarn: PointId \| null` | 하나만 | 그대로(괴물은 한 번에 한 곳에만 있다) | 낮음 |
| `shared/src/types.ts:213-217,230` `TextId` · `GameEvent.text` | `NOTE_FIRST` · `NOTE_SECOND` · `ALERT_CAPTURE_*` · `ALERT_EXITS_ON`, `point?: PointId` | **새 TextId 없음**("알림 방식은 그대로"). `point`에 `'C'`가 실릴 뿐 | 낮음 |
| `shared/src/types.ts:329-330,357` | `pointsLeft` = "끝까지 남은 거점" | 뜻을 "필요한 수에서 못 끝낸 수(0~2)"로 주석 수정 (3.4) | 중간 |
| `shared/src/types.ts:409` `TestCommand.setPoint` | `point: PointId` | 자동으로 C 허용. 꺼진 거점에 써도 진행 숫자만 바뀜 | 낮음 |
| `shared/src/notes.ts:8-9` `isKeptNote` | `NOTE_FIRST \|\| NOTE_SECOND` | 그대로(조각은 둘 그대로) | — |
| `shared/src/debugTypes.ts:51,125` | 주석 "'point-A'", "거점 A/B" | 주석만 (`tag`는 string) | 낮음 |

### 3.2 서버 규칙 (shared/src/sim)

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `sim/state.ts:92-102` `CapturePointState` | 꺼짐 상태 없음 | `off: boolean` 추가 (이름 제안, 6절) | 높음 |
| `sim/state.ts:87` · `sim/game.ts:161` | `pointCamp: Record<PointId, number>` = `{ A: 0, B: 0 }` | `{ A: 0, B: 0, C: 0 }` 또는 `POINT_IDS`로 생성 | 높음 (**컴파일**) |
| `sim/game.ts:76-95` | `points` 배열 리터럴 A · B 두 개 | `POINT_IDS.map(...)`으로 (+ `off: false`) | 높음 (조용함 — 타입은 통과하고 거점이 2개로 남는다) |
| `sim/game.ts:107-109,122` | `codes: [string, string]`, 난수 2번 | **그대로**(두 조각). 난수 소비가 그대로라 그 뒤 난수열도 그대로다 | — |
| `sim/systems/capture.ts:17-21` | `if (p.done) { capturing = blocked = false; continue }` | `if (p.done \|\| p.off)` — 꺼진 곳은 게이지 · 기여 초 · 알림 모두 멈춤 | 높음 |
| `sim/systems/capture.ts:16` | `m.pointCamp[p.id]` 누적은 `done` 검사 앞 | 그대로 둬도 됨(경고는 `interest.ts`에서 걸러야 함) | 낮음 |
| `sim/systems/capture.ts:49-58` | `order = capturedCount`, `order === 1 ? NOTE_FIRST : NOTE_SECOND`, `codes[order === 1 ? 0 : 1]` | 그대로 두되 "끝나는 거점은 최대 required(2)개"가 보장돼야 한다. 꺼진 거점이 완료되면 `order 3`이 `NOTE_SECOND`를 한 번 더 보낸다 → 17줄 가드가 이를 막는다. 주석 53줄 "A/B와 무관하게" 수정 | 높음 |
| `sim/systems/capture.ts:61-64` | `if (game.points.every((q) => q.done))` → 탈출구 `inactive → active` + `ALERT_EXITS_ON` | `if (game.capturedCount === required)` (또는 끝난 수 ≥ required이고 아직 안 켰을 때) → **같은 블록에서 `!done`인 거점을 `off = true; capturing = blocked = false`** → 탈출구 켜기 | 높음 |
| `sim/systems/capture.ts:13` 반복 순서 | A → B | A → B → C. **같은 틱에 여럿이 끝나면 배열 순서가 앞선 쪽이 이긴다**(탐침 4: A · B · C가 같은 틱에 40초를 채우면 A · B 완료, C 꺼짐, 메모 2 · 완료 배너 2 · `ALERT_EXITS_ON` 1) | 중간 (결정적이지만 문서에 한 줄 적을 것) |
| `sim/systems/capture.ts:1-5`, `sim/systems/exit.ts:2` | 주석 "두 거점을 모두 점령하면" | "세 곳 중 두 곳" | 낮음 |
| `sim/systems/exit.ts:49-51` `allPointsDone` | `points.length === Object.keys(CAPTURE_POINTS).length && every(done)` | **지금 아무도 부르지 않는다**(리포 전체 grep 결과 정의뿐). 지우거나 `capturedCount >= required`로 뜻을 바꾸고 이름을 고친다(예: `pointsCleared`). 그대로 두면 3곳 규칙에서 영원히 false | 중간 (지금은 죽은 코드라 실해 없음, 나중에 봇 · 시험이 쓰면 함정) |
| `sim/systems/exit.ts:10-39` `exitTick` | 탈출구 state만 봄 | 변경 없음 | — |
| `sim/systems/match.ts` | 거점 가정 없음(`requiredSurvivors`만) | 변경 없음 | — |
| `sim/room.ts:862-865` `setPoint` | `game.points.find(id)` | 변경 없음 | — |
| `sim/core.ts`, `sim/truth.ts`, `sim/simMatch.ts`, `sim/botDriver.ts`, `sim/predict.ts`, `sim/pathfind.ts` | 거점 언급 없음 | 변경 없음 (`TruthFrame`에는 거점이 없다) | — |

### 3.3 스냅샷 · 이벤트 (shared/src/sim/interest.ts)

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `interest.ts:211-215` | `state: p.done ? 'done' : p.blocked ? 'blocked' : p.capturing ? 'capturing' : 'idle'` | `p.done ? 'done' : p.off ? 'off' : …`. 양쪽에 같은 값(탐침 4에서 `ms.world.points`와 `ss.world.points`가 같음을 확인) | 높음 |
| `interest.ts:105-108` | `blockWarn`: `!p.done && reached(pointCamp, campWarnAt)` | `!p.done && !p.off && …` — 안 고치면 **꺼진 거점에 3초 서 있는 괴물에게 "거점을 너무 오래 지키고 있다" 경고가 뜬다** | 중간 (조용함) |
| `interest.ts:213` `progress` | `progress / captureTime` | 꺼진 곳도 멈춘 값 그대로 보낸다(공개 정보). 클라이언트는 꺼짐이면 흐리게만 | 낮음 |

### 3.4 판 기록 · 메타

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `sim/record.ts:329` | `pointsLeft: game.points.filter((p) => !p.done).length` (0~2) | `Math.max(0, required − 끝난 수)`. 안 고치면 생존자가 다 끝낸 판에도 괴물이 1을 받고(탐침 5), 하나도 못 끝내면 3 → **저지 평가 +10~+30점**(`config/progression.json:57` 가중치 10, 단계 기준 `[6,16,28,42]`) | 중간 (조용함, 보상 왜곡) |
| `sim/record.ts:166-182` `pointStops` | 점령이 1초 넘게 이어지다 `capturing`이 꺼지고 `!p.done`이며 괴물이 8타일 안이면 "괴물이 끊은 점령" | `&& !p.off` — 안 고치면 **둘째 거점이 끝나 셋째가 꺼지는 순간이 끊긴 점령 1회로 세어진다**(탐침 5에서 재현) | 중간 (조용함) |
| `sim/record.ts:167` `blockSec` | `p.blocked`면 누적 | 꺼질 때 `blocked = false`로 두면 조치 없음 | 낮음 |
| `sim/record.ts:346-352` `inObjectiveZone` | `p.done`이 아닌 거점 안에서 맞으면 "저지 타격" | `p.done \|\| p.off`는 건너뜀 | 낮음 (조용함) |
| `sim/record.ts:98` `capturingFor: Map<string, number>` | id 키 | 자동 | — |
| `shared/src/meta/rating.ts`, `daily.ts`, `progressionCheck.ts:15,36-39` | 수치 이름만 씀(`captureSec` · `blockSec` · `pointStops` · `pointsLeft` · `zoneHits`) | 코드 변경 없음. `pointsLeft` 뜻을 지키면 기준값도 그대로 | — |
| `config/progression.json:5-12,51-60,110-115` | 점령 평가 `captureSec×1 + exitSec×3`, 저지 `pointsLeft×10`, 도전 `captureSec 60` | 값 변경은 필요 없지만 **3곳이면 버려지는 점령 초(꺼진 거점)도 `captureSec`에 들어간다** → 분포가 조금 오른다. `scripts/meta-calibrate.ts`로 다시 재 보는 것은 HUMAN_CHECKS 거리 | 낮음 |

### 3.5 봇 (배열 길이 가정만 — 고르는 로직은 다른 담당)

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `sim/practiceBrains.ts:51` | `const POINT_IDS: readonly PointId[] = ['A', 'B']` (비공개) | `map.ts`의 공용 `POINT_IDS`로. 269 · 635 · 774줄 반복이 따라옴 | 중간 (조용함 — 괴물 봇이 C 안 머문 시간을 세지 않아 지키기 유예를 못 피함) |
| `sim/practiceBrains.ts:505` | `pointTicks: Record<PointId, number> = { A: 0, B: 0 }` | C 추가 | **컴파일** |
| `sim/practiceBrains.ts:776` | 유예 걸음: `state === 'done'`이면 건너뜀 | `'off'`도 건너뜀 | 낮음 (조용함) |
| `sim/practiceBrains.ts:801-809` | 괴물: `capturing \|\| blocked`인 거점 중 진행 큰 쪽 | 길이 무관, 변경 없음 | — |
| `sim/practiceBrains.ts:818-822` | `undone = points.filter(state !== 'done')`, `undone.find(id !== lastGuarded) ?? undone[0] ?? 'A'` | `'off'` 제외. 3곳이면 "번갈아"가 A ↔ B만 오갈 수 있음(`find`가 첫 다른 것) — 순환으로 | 중간 (조용함. `!exitsOn` 조건 덕에 꺼진 뒤에는 안 탐) |
| `sim/practiceBrains.ts:1047-1053` `teamPlan` | `pair: r.next() < 0.5 ? 'A' : 'B'`, `solo` 한 명은 "다른 쪽" | 세 곳 중 두 곳을 고르는 계획으로. **역할을 거점에 고정하지 말 것**(9절) | 높음 (조용함 — 안 고쳐도 판은 끝나지만(A · B만 점령, 봇 시험 통과) C는 계획에 없고, 위험할 때 `other`로만 우연히 간다) |
| `sim/practiceBrains.ts:1084` | `home = solo ? (pair === 'A' ? 'B' : 'A') : pair` | "다른 쪽"이 둘이 됨 | 높음 (조용함) |
| `sim/practiceBrains.ts:1206-1223` | `undone = state !== 'done'`, `other = undone.find(p !== goal)` — 지금은 탈출구가 켜지면 `undone`이 늘 비어 있다 | `'off'` 제외. 코드 추적: 꺼짐은 탈출구가 켜진 뒤에만 있고, 그때는 자유 동료가 있으면 탈출(1199-1202줄), 없으면 구조(1207-1211줄, `freeMates.length === 0`이라 바로 반환)가 먼저다. 그래서 1212줄(꺼진 거점으로 점령하러 감)에 닿는 길은 아래 `finishing` 하나뿐이다. 그래도 `undone`의 뜻("아직 할 거점")이 틀려지므로 고친다 | 낮음~중간 (조용함) |
| `sim/practiceBrains.ts:1242-1249` `pointHere` | `state === 'done'`만 건너뜀 | `'off'`도 | 중간 (조용함 — 코드 추적: 진행 0.8 이상에서 꺼진 거점 안에 서 있으면 `finishing`(1205줄)이 참이라 **구조를 건너뛰고 꺼진 거점에 계속 선다**. 동료가 모두 갇힌 뒤에만 드러나는 드문 경로, 실험으로 재현하지는 않았다) |
| `sim/practiceBrains.ts:1140-1142,1175` | 메모 `code`를 모아 마지막 숫자로 탈출구 고름 | 그대로(조각 둘) | — |
| `sim/botBrains.ts:265-266` `SPOTS.pointA/pointB` | 시험용 자리 둘 | `pointC` 추가(선택) | 낮음 |
| `sim/botBrains.ts:93-103` `DEV_PATROLS.monster` | (40,16) · (8,16)을 도는 순찰 | 개발용 봇. C를 넣을지는 선택 | 낮음 |
| `server/src/bots.ts`, `server/src/quickBots.ts` | 거점 언급 없음 | 변경 없음 | — |

### 3.6 server/ · scripts/

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `server/src/config.ts:87` | `validateBalance(JSON.parse(text))` | 코드 변경 없음(수치 · 검사가 같이 바뀌면 됨) | — |
| `server/src/sendPolicy.ts:4,27`, `server/src/index.ts:255` | 거점 메모가 든 스냅샷은 건너뛰지 않음 | 변경 없음 | — |
| `scripts/remaster-shots.mjs:28-29,36,55,240-241,331,339-340` | 촬영 장면이 A (8,16.5) · B 0.45 고정 | 그대로 돈다(`setPoint` A · B 유효). 다시 찍으면 그림에 C가 생김 | 낮음 |
| `scripts/meta-calibrate.ts`, `measure-bot-rooms.ts`, `pacing-table.mjs`, `camera-*.{ts,mjs}`, `perf-*.mjs` | 거점 직접 참조 없음 | 변경 없음(결과 수치는 달라질 수 있음) | — |

### 3.7 클라이언트 HUD · 배치

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `client/src/ui/hud.ts:322-331` | `gauges = [gaugeA, gaugeB]` 딱 둘 (터치 `RingGauge`, PC `Gauge(…, 'A', 1)` · `Gauge(…, 'B', -1)`) | 셋째 게이지 추가 | 높음 (조용함 — C가 HUD에 아예 안 보임) |
| `client/src/ui/hud.ts:445-449` `drawTop` | `this.gauges.forEach((g, i) => g.update(w.points[i], …))` — **배열 순서**로 짝지음 | id로 찾기(`points.find(p => p.id === g.id)`) | 높음 (조용함) |
| `client/src/ui/hud.ts:116-149` `Gauge` | `id: 'A' \| 'B'`, `side: 1 \| -1`(A는 타이머 왼쪽 · B는 오른쪽, 배지가 바깥), `o = id === 'A' ? HUD.gaugeA : HUD.gaugeB`, 164줄 `y = HUD.gaugeA.y` | 셋째 자리 · 방향 규칙 새로. 좌우 대칭 한 쌍 구조라 **셋은 대칭이 안 됨** — 배치 결정 필요 | 높음 |
| `client/src/ui/hud.ts:207-231` `RingGauge` | `id: 'A' \| 'B'`, 자리 `plan.gaugeA/gaugeB` | `plan.gaugeC` | 높음 |
| `client/src/ui/hud.ts:158-185,237-249` `update` | `gaugeState(p.state)` 4가지 | 꺼짐 모양(프레임 `gbar:off` · `dia:off`, 채움 숨김, 칩) | 중간 |
| `client/src/ui/hud.ts:765-772` `debug()` | `pointA/pointB/pointAChip/pointBChip` | `pointC*` 추가 (`tests/e2e/m10-hud.spec.ts:148-189`가 A · B 키를 읽음 — 유지) | 낮음 |
| `client/src/ui/hudArt.ts:147-165` | `GaugeState = idle\|capturing\|paused\|done`, `gaugeState(s)`는 `blocked → paused`, 나머지 그대로 | `'off'` 추가 (`GAUGE_STATES` · `GAUGE_ICON` · `gaugeColor`) | **컴파일**(152줄) + 조용함(`gaugeColor('off')`는 else 갈래로 청록) |
| `client/src/ui/hudArt.ts:1014-1020,1071-1072` | 아틀라스 프레임 `gbar:${s}` · `dia:${s}` · `chip:${s}` (`GAUGE_STATES` 4개) | `off` 프레임. 꺼짐 칩 아이콘이 필요하면 `client/src/art/icons.ts`에 새 아이콘(지금 35개에 끄기 · 금지 모양 없음) — "색만으로 구분하지 않기" | 중간 |
| `client/src/ui/layout.ts:1005-1007,1027-1031` (PC) | `GAUGE.barW 212` → `GAUGE_W 288`, `gaugeA.x = viewW/2 − 78 − 14 − 288 = 580`, `gaugeB.x = 1340`; 위 띠 x ≥ 1490은 선명도 탐침 자리로 비움(1001줄) | 셋이 들어가게 막대 폭 · 자리 재설계. 왼쪽은 판 중 메뉴 버튼이 `gaugeLeft`까지 쓴다(`GameScene.ts:1061`, `ui/matchMenuButton.ts:26-27,56`) | 높음 |
| `client/src/ui/layout.ts:215-217` `TOUCH_PART.gauge 52 · gaugeGap 6` | "두 칸 사이" | 세 칸 폭 = 3×52 + 2×6 = 168 (지금 110) | 높음 |
| `client/src/ui/layout.ts:528-529,588-589` | `TouchHudPlan.gaugeA/gaugeB`, `planCss` 반환 `gaugeA/gaugeB` | `gaugeC` 또는 배열로 | 높음 |
| `client/src/ui/layout.ts:602-612,615-625,657-688` | `pairW = g*2 + gap`, `pairAt()`가 두 칸, 후보 셋(타이머 옆 한 줄 · 왼쪽 칸 · 오른쪽 칸)이 `pairW` 기준 | `tripleW`로. **좁은 화면에서 안 들어가는 후보가 늘어난다** — `tests/unit/touch-hud.test.ts`의 겹침 검사가 판정 | 높음 |
| `client/src/ui/layout.ts:711-712,779-785,868,880-881,888,899-900` | `planBoxes`가 `gaugeA · gaugeB` 둘, 좌우 반전은 "둘의 자리를 맞바꾼다" | 셋의 반전 규칙(순서 유지: A가 왼쪽) | 중간 |
| `client/src/ui/layoutEditor.ts:91-94`, `client/src/data/storyText.ts:440-441`, `client/src/ui/touchControls.ts:332` | HUD 미리보기 이름표 `gaugeA: '거점 A'` · `gaugeB: '거점 B'` | `gaugeC` 이름표 + `docs/STORY_TEXT.md:269` (문구 동기화 시험 `tests/unit/story-text-sync.test.ts`) | 낮음 |
| `client/src/ui/hudKit.ts:10,60-61` | 주석 · 아틀라스 열쇠에 게이지 크기 | 주석만 | 낮음 |
| `client/src/scenes/GameScene.ts:1772-1781` | `mon.blockWarn ? LINE.pointWarn : null` | 변경 없음(서버가 꺼진 곳을 거르면) | — |

### 3.8 클라이언트 맵 그림 · 배지 · 안개 레이어

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `client/src/render/objects.ts:258-268` | `BadgeId = 'point-A' \| 'point-B' \| …`, `BADGE_IDS` 5장, `BADGE_KIND`, `POINT_BADGE: Record<'A'\|'B', BadgeId>` | `'point-C'` 추가(6장). 7 · 258 · 369줄 주석 "배지 다섯 장" | 높음 (**컴파일**: 559줄) |
| `client/src/render/objects.ts:272-275` `badgeAnchor` | `id === 'point-A' \|\| id === 'point-B'`, `CAPTURE_POINTS[id === 'point-A' ? 'A' : 'B']` | 표로 바꾸기 | 높음 (조용함 — `'point-C'`를 넣고 여기를 놓치면 **자물쇠 자리(감옥)에 그려진다**) |
| `client/src/render/objects.ts:283-289,470` | `BADGE_AT` · `sigs`가 5개 키 리터럴 | 6개 (Record라 `BadgeId`를 늘리면 **컴파일**) | 중간 |
| `client/src/render/objects.ts:356` `POINT_CODE` | `{ idle: 0, capturing: 1, blocked: 2, done: 3 }` | `off: 4` | **컴파일** |
| `client/src/render/objects.ts:358,519` | `POINT_STATES = [idle, capturing, blocked, done]`, `POINT_STATES[code] ?? 'idle'` | 배열에 `'off'` — 안 넣으면 **꺼짐(코드 4)이 `?? 'idle'`로 대기 모양이 된다** | 높음 (조용함) |
| `client/src/render/objects.ts:458,473-484` | 글자 라벨 `for (const id of ['A', 'B'] as const)` | C 글자 | 높음 (조용함 — C 배지에 글자 없음) |
| `client/src/render/objects.ts:544-548,557-561` `draw` | `blink: Record<'A'\|'B', boolean>`, `pointBadgeAlpha(p.id, …)` | 타입을 `Record<PointId, …>`로 | **컴파일** (558 · 559 · 560줄) |
| `client/src/art/mapArtBadges.ts:18-22,82-84,112,118` | `BadgeAlpha.points: Record<'A'\|'B', number>`, `pointBadgeAlpha(id: 'A'\|'B', …)` | `Record<PointId, …>` | **컴파일**(118줄). 타입만 넓히고 값을 안 채우면 알파 `undefined`(탐침 6) |
| `client/src/art/mapArtBadges.ts:63-67` `pointColor` | `blocked → WARN`, `idle → 흐림`, **그 밖 전부 청록** | `off → 회색`(탈출구 `OBJ_COLOR.off 0x56657a`가 선례) | 높음 (조용함 — 탐침 6: `pointColor('off') === NEON`) |
| `client/src/art/mapArtBadges.ts:69-75` `pointIcon` | `play · pause · check`, 그 밖 `null` | 꺼짐 아이콘(모양으로도 구분) | 중간 (조용함) |
| `client/src/art/mapArtBadges.ts:105` | 주석 "거점 배지 2 … 진행(거점 2…)" | 3 | 낮음 |
| `client/src/render/worldRenderer.ts:458-459` | `badgeAlpha.points: { A: 1, B: 1 }`, `badgeBlink: { A: false, B: false }` | C 추가 | 높음 (조용함 — 지금 타입이 `'A'\|'B'` 리터럴이라 타입을 넓힐 때 같이 잡힘) |
| `client/src/render/worldRenderer.ts:1485-1486,1492-1493,263-266` | `alpha.points.A/B = seenAlpha(…)`, `blink.A/B = … capturing(points, 'A'/'B')` | `POINT_IDS` 반복 | 높음 (조용함 — C는 시야 알파 · 깜빡임이 안 걸림) |
| `client/src/render/fogGpu.ts:468` | `POINT_KEY: Record<PointId, string> = { A: 'point-A', B: 'point-B' }` | C | **컴파일** |
| `client/src/render/fogGpu.ts:805-815` `drawPoints` | 거점마다 동적 조각(`DynPatch`: 캔버스 + 텍스처) 하나 | 코드 변경 없음. 조각이 2 → 3(그리기 · 텍스처 +1) — 성능 예산 시험(`tests/perf`) 확인 | 낮음 |
| `client/src/render/fogPaint.ts:526-582` `paintPoints` | 상태 갈래: `done` · `blocked` · `capturing`만. 나머지는 대기 모양(청록 링) | `'off'` 갈래: 링 · 눈금을 회색으로, 스캔선 없음, 진행 눈금 숨김/흐림. **바닥 그림이 정보 레이어**(VISUAL_SPEC 5.1)라 모양 차이 필요 | 높음 (조용함 — 꺼졌는데 살아 있는 거점처럼 보임) |
| `client/src/render/fogPaint.ts:492-513,838-851` | `Map<PointId, …>` 메모 | 자동 | — |
| `client/src/render/baseLayer.ts:107,415-417` | `drawPoints(points)` 그대로 넘김 | 자동 | — |
| `client/src/art/mapArt.ts:490-492,911`, `client/src/art/mapArtGeom.ts:608-613`, `client/src/ui/uiArt.ts:364-378` | `Object.values(CAPTURE_POINTS)` 반복(패드 장식 · 발광 · 데칼 비우기 · 로비 지도 SVG) | **자동으로 C가 그려진다.** 단 C 둘레 3.3타일(`MAP_ART.decalClearPoint`, `mapArtGeom.ts:64`)의 데칼이 사라져 정적 맵 그림이 바뀜 → 그림 비교 시험 · `artifacts/` 기준 그림 갱신 | 중간 |

### 3.9 미니맵 · 화면 밖 화살표

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `client/src/ui/minimap.ts:224-225` | `for (const id of ['A', 'B'] as const) pointMarks.push(…)` | `POINT_IDS` | 높음 (조용함) |
| `client/src/ui/minimap.ts:488-494` `setWorld` | `pointMarks[p.id === 'A' ? 0 : 1]`, `c = p.id === 'A' ? CAPTURE_POINTS.A : CAPTURE_POINTS.B` | id → 표시로 찾기 | **높음 (조용함 — C가 오면 B의 표시가 B 자리에서 C의 상태로 덮인다. B 상태가 미니맵에서 틀려짐)** |
| `client/src/ui/minimap.ts:98-103` `MM_POINT` | 상태 4개 → 프레임 | `off: FR.mm('point:off')` | **컴파일** |
| `client/src/ui/hudArt.ts:1324-1328` | 미니맵 프레임 `point` · `point:capturing` · `point:blocked` · `point:done` | `point:off`(예: 속 빈 회색 마름모 + 사선) | 중간 |
| `client/src/render/offscreen.ts:143-147` | 생존자 화면: `state === 'done'`이 아니면 거점 화살표 | `'off'`도 제외 | 높음 (조용함 — 탐침 6: 꺼진 거점으로 가라는 화살표가 나옴) |
| `client/src/render/offscreen.ts:103-107` | 괴물 화면: `capturing`만 | 변경 없음 | — |
| `client/src/render/offscreen.ts:60` `EDGE_MAX = 8` | 생존자 최악: 괴물 · 탐지 · 포효 · 감옥 · 팀원 2 · 거점 2 = 8 (탈출구는 거점이 다 끝난 뒤라 겹치지 않음) | 거점 3이면 9 → **우선순위 꼴찌(`point` 7)인 거점 화살표 하나가 잘릴 수 있다.** 상한을 9로 올리거나 그대로 둘지 결정 | 중간 |
| `client/src/render/offscreen.ts:5-7` | 주석 "끝나지 않은 거점(상태별)" | "끝나지 않았고 꺼지지 않은" | 낮음 |
| `client/src/ui/edgeMarkers.ts:98-111` | 글자 라벨 `Record<'A'\|'B', CrispText>` — 주석 "거점 화살표는 둘뿐이라" | C 라벨 | 중간 |
| `client/src/ui/edgeMarkers.ts:133-134,148-158,175-176` | `look.label === 'A' \|\| look.label === 'B'`, `showA/showB` | 일반화 | 중간 (조용함 — C 화살표에 글자가 안 붙어 어느 거점인지 모름) |
| `client/src/ui/edgeMarkers.ts:76-88` `edgeLook` | 상태색 `blocked · capturing · 그 밖 흐림` | 꺼짐은 화살표 자체가 없으니 변경 없음 | — |
| `client/src/scenes/GameScene.ts:1031,1629,1759` | `snap.world.points`를 그대로 넘김 | 변경 없음 | — |

### 3.10 문구 · 안내 · 결과 · 소리

| 파일:줄 | 지금 가정 | 바꿀 내용 | 위험도 |
|---|---|---|---|
| `client/src/data/storyText.ts:204,222` | 조작 안내 "거점 A · B를 점령하고, 두 사람이 함께 탈출구에…" | "거점 A · B · C 중 두 곳을…" (+ `docs/STORY_TEXT.md:175` — 동기화 시험) | 중간 |
| `client/src/data/storyText.ts:12` `INTRO_WALL` | "탈출구의 비밀번호는 두 장소에 나뉘어 있다." | 세 곳 중 두 곳 규칙과 어긋나는지 스토리 판단 필요(조각은 둘 그대로) — `docs/STORY_TEXT.md:9,23` | 중간 (사람 판단) |
| `client/src/data/storyText.ts:22-24` | `거점 {point}에서 무언가 움직인다` · `거점 {point} 해독 완료` · `탈출구가 깨어났다…` | `{point}`에 C가 들어갈 뿐. 그대로 | — |
| `client/src/data/storyText.ts:14-21` `NOTE_FIRST/SECOND` | 앞자리 · 뒷자리 | 그대로 | — |
| `client/src/data/storyText.ts:156,407-411,465,470` | 거점 지키기 경고 · 화살표 설명 · 평가 설명 | 수 가정 없음. "끝나지 않은 거점" 설명만 필요하면 손봄 | 낮음 |
| `client/src/scenes/GameScene.ts:99-103,1224-1235` | 알림 모양 · 소리 · `{point}` 채우기 | 변경 없음 | — |
| `client/src/ui/banners.ts`, `client/src/ui/overlays.ts:406,532`, `client/src/touchTutorial.ts` | 거점 수 가정 없음(안내 문구는 `CONTROLS*`에서 옴) | 변경 없음 | — |
| `client/src/ui/result.ts:49-51`, `client/src/ui/resultRating.ts:20-24` | 점령 기여 초 · 평가 아이콘 | 변경 없음 | — |
| `client/src/audio.ts:8,235-240` | `captureStart` · `captureDone` 소리 | 변경 없음(꺼짐 소리는 "알림 그대로"라 없음) | — |
| `client/src/app.ts:1100`, `client/src/practiceBalance.ts:7` | `validateBalance(…)` | 코드 변경 없음(7절 호환 참고) | — |

### 3.11 문서 (참고 — 고칠 곳)

`docs/GAME_DESIGN.md:13,23,25,55,59,131-135,139,174,178-179,230` + 13장 변경 이력, `docs/STORY_TEXT.md:3,9,23,27-29,175,269`,
`docs/VISUAL_SPEC.md:105,175,483~,697,709,711`(711줄 `gaugeA.x 580 · gaugeB.x 1340`은 `tests/unit/visual-spec.test.ts` "표의 코드 열 값" 시험이 코드와 대조),
`docs/TECH_SPEC.md:96`, `README.md:7,108-109`, `docs/STORE_LISTING.md:37`.

## 4. 컴파일러가 잡아 주는 곳 (탐침 1 · 2 · 3)

`PointId += 'C'`, `PointState += 'off'` 뒤 `tsc` 오류 전체:

| 파일:줄 | 오류 | 원인 |
|---|---|---|
| `shared/src/sim/game.ts:161` | `Property 'C' is missing` | `pointCamp: { A: 0, B: 0 }` |
| `shared/src/sim/practiceBrains.ts:505` | 같음 | `pointTicks` |
| `client/src/render/fogGpu.ts:468` | 같음 | `POINT_KEY` |
| `client/src/art/mapArtBadges.ts:118` | `PointId`를 `'A'\|'B'` 자리에 못 넣음 | `pointBadgeAlpha(p.id, …)` |
| `client/src/render/objects.ts:558,559,560` | 같음 / `POINT_BADGE[p.id]` | `draw()` |
| `client/src/render/objects.ts:356` | `Property 'off' is missing` | `POINT_CODE` |
| `client/src/ui/hudArt.ts:152` | `'off'`는 `GaugeState`가 아님 | `gaugeState()` |
| `client/src/ui/minimap.ts:98` | `Property 'off' is missing` | `MM_POINT` |
| (시험) `tests/unit/objects.test.ts:498` | `Record<'A'\|'B', …>` 색인 | 시험 도우미 |

이 10곳 밖은 전부 조용하다. 특히 위험한 조용한 곳: `game.ts:76-95`, `capture.ts:61`, `record.ts:176,329`, `interest.ts:107`, `practiceBrains.ts:51,1047-1084,1206-1214`,
`hud.ts:322-331,447`, `minimap.ts:224,489-492`, `offscreen.ts:144`, `objects.ts:274,358,473`, `worldRenderer.ts:1485-1493`, `mapArtBadges.ts:63-75`, `fogPaint.ts:526-582`, `edgeMarkers.ts:148`.

**권고**: 리터럴 `'A' | 'B'` 타입(`hud.ts:131,220`, `edgeMarkers.ts:102`, `worldRenderer.ts:263,459`, `objects.ts:268,458,547`, `mapArtBadges.ts:19,82,112`)을 모두 `PointId`로 바꾸고,
`Record<PointId, …>`와 `POINT_IDS` 반복으로 통일하면 다음부터는 컴파일러가 대부분 잡는다.

## 5. '꺼진 거점' 상태가 필요한 곳

| 층 | 무엇 | 지금 | 필요한 것 |
|---|---|---|---|
| 서버 상태 | `CapturePointState` | 없음 | `off` — 점령 불가(`capture.ts:17`) · 게이지 정지 · `captureSeconds` 미적립 · `ALERT_CAPTURE_START` 없음 · `capturing/blocked = false` |
| 서버 → 괴물 | `blockWarn`(`interest.ts:107`) | `!done`이면 경고 | `off` 제외 |
| 스냅샷 | `PointView.state` | 4가지 | `'off'` (양쪽 같은 값) |
| 판 기록 | `record.ts:176,329,349` | `!done` 기준 | `off` 제외 · `pointsLeft`는 required 기준 |
| 봇 | `practiceBrains.ts:776,818,1206,1244` | `state !== 'done'` = 할 일 | `'off'`도 "할 일 아님"(봇은 자기 스냅샷의 `world.points`만 본다 — 원칙 유지). 꺼짐은 탈출구가 켜지는 순간에만 생기므로 대부분 탈출 · 구조 갈래에 가려지지만, 가려지지 않는 경로가 있다(3.5) |
| HUD 게이지 | `hudArt.ts:147-165`, `hud.ts` | 4가지 | `off` 프레임(틀 · 배지 · 칩), 깜빡임 없음 |
| 맵 배지 | `mapArtBadges.ts:63-75`, `objects.ts:356-358` | 색 3 · 아이콘 3 | 회색 + 꺼짐 아이콘 |
| 바닥 링 | `fogPaint.ts:526-582` | 대기 = 청록 링 | 회색 링 · 눈금 꺼짐 · 스캔 없음 |
| 미니맵 | `minimap.ts:98-103`, `hudArt.ts:1324-1328` | 4가지 | `point:off` |
| 화살표 | `offscreen.ts:143-147` | `done`만 제외 | `off` 제외 |
| 문구 | — | — | 새 알림 없음(규칙: 알림 방식 그대로). 조작 안내 한 줄만 |

꺼진 거점의 진행 값은 서버가 멈춘 값 그대로 보낸다(지우지 않는다): 꺼지기 전에도 공개였고, 지우면 판 기록 · 골든 직렬화에서 "언제 꺼졌는지"가 흐려진다. 화면은 꺼짐이면 진행을 흐리게/숨겨 그린다.

## 6. 최소 변경 설계안

### 6.1 수치

```jsonc
"capturePoint": { "count": 3, "required": 2, "radius": 2.5, "captureTime": 40, "groupMultiplier": 1.5,
                  "pausedWhenMonsterInside": true, "monsterBlockGrace": 5.0, "alertCooldown": 8.0 }
```

- 새 키 이름: **`capturePoint.required`** (탈출구 쪽 `exit.requiredSurvivors`와 말이 맞는다).
- `balance.ts`: 인터페이스 · `SCHEMA`(`'int'`) · `STRUCTURAL`: `count === 3 (맵 구조)`, `required === 2 (비밀번호 두 조각)`.
- 새 단위 시험(권고): `POINT_IDS.length === balance.capturePoint.count`, `Object.keys(CAPTURE_POINTS)`와 `POINT_IDS`가 같다 — 지금은 count와 맵을 잇는 검사가 "2" 상수뿐이다.

### 6.2 서버 (탐침 3 · 4에서 그대로 돌려 본 내용, `b1/patch-shared.py`)

```ts
// map.ts
export type PointId = 'A' | 'B' | 'C';
export const POINT_IDS: readonly PointId[] = ['A', 'B', 'C'];
// state.ts — CapturePointState
/** 필요한 수(capturePoint.required)가 다 끝나 꺼졌다: 점령 불가 · 게이지 정지 · 알림 없음 */
off: boolean;
// game.ts
readonly points = POINT_IDS.map((id) => ({ id, progress: 0, done: false, off: false, capturing: false, blocked: false, lastAlertAt: -1e9, wasCapturing: false }));
pointCamp: { A: 0, B: 0, C: 0 }
// capture.ts captureTick
if (p.done || p.off) { p.capturing = false; p.blocked = false; continue; }
// capture.ts complete()
if (game.capturedCount === game.balance.capturePoint.required) {
  for (const q of game.points) if (!q.done) { q.off = true; q.capturing = false; q.blocked = false; }
  for (const e of game.exits) if (e.state === 'inactive') e.state = 'active';
  for (const pl of game.players.values()) game.emitTo(pl, { k: 'text', id: 'ALERT_EXITS_ON' });
}
// interest.ts
state: p.done ? 'done' : p.off ? 'off' : p.blocked ? 'blocked' : p.capturing ? 'capturing' : 'idle'
if (!p.done && !p.off && reached(m.pointCamp[p.id], b.prison.campWarnAt)) blockWarn = p.id;
// record.ts
pointsLeft: Math.max(0, required - game.points.filter((p) => p.done).length)   // 0~2 유지
… !p.done && !p.off && ran >= POINT_STOP_MIN_SEC …                              // 꺼짐은 끊긴 점령이 아니다
if (p.done || p.off) continue;                                                  // inObjectiveZone
```

- 상태 필드 이름: **`off`** (스냅샷 상태 `'off'`, 색 상수 `OBJ_COLOR.off`, 미니맵 프레임 `exit:off`와 같은 말). 대안은 필드 없이 `!p.done && capturedCount >= required`를 그때그때 계산하는 것 —
  읽는 곳이 6군데라 빠뜨리기 쉬워 저장 필드 쪽을 권한다(끄는 곳은 `complete()` 한 곳).
- `pointsLeft`는 `capturedCount`가 아니라 `done` 수로 세는 편이 안전하다(`tests/unit/meta-record.test.ts:237`처럼 시험이 `p.done = true`를 직접 쓰는 곳이 있다). 탐침은 `capturedCount`로 돌렸다 — 정상 진행에서는 같은 값이다.
- 완료 순서 · 메모 · 알림 · 점령 시간 · 2명 배율 · 지키기 방지 5초 · 알림 쿨다운 8초 코드는 손대지 않는다.
- 탐침 4 결과: A→B / A→C / B→C / C→A 네 순서 모두 둘째 완료 틱에 탈출구 2곳 `active`, 남은 곳 `off`, 메모는 `NOTE_FIRST(codes[0])` → `NOTE_SECOND(codes[1])`,
  꺼진 곳에 생존자 9초 + 괴물이 같이 있어도 진행 · `captureSeconds` · `ALERT_CAPTURE_START` · `blockWarn` 모두 없음.

### 6.3 스냅샷

- `PointState`에 `'off'` 한 값, `world.points` 길이 3(순서 A · B · C 고정 = `POINT_IDS` 순서, 점령 순서가 아님). 새 필드 없음.
- 클라이언트는 필요한 수를 `balance.capturePoint.required`(welcome으로 이미 받는 값)에서 읽는다 — `WorldView`에 "필요 수"를 따로 싣지 않는다.

### 6.4 클라이언트 (순서 제안)

1. 타입 통일: `'A' | 'B'` 리터럴 → `PointId`, 반복 → `POINT_IDS`, `Record<PointId, …>`.
2. 꺼짐 그림: `hudArt`(게이지 틀 · 배지 · 칩 · 미니맵 프레임) → `mapArtBadges`(색 · 아이콘) → `fogPaint.paintPoints`(바닥 링) → `objects`(상태 코드표).
3. 셋째 게이지 배치: `layout.ts`(PC 위 띠, 터치 `planCss`) → `hud.ts`. 이것이 클라이언트에서 가장 큰 일이다.
4. 화살표(`offscreen.ts:144`) · 미니맵(`minimap.ts:224,489-492`) · 글자 라벨(`objects.ts:473`, `edgeMarkers.ts:102-158`).
5. 문구(`storyText.ts:204,222` + `docs/STORY_TEXT.md`).

## 7. 스냅샷 호환 (옛 화면 ↔ 새 서버)

호환 코드는 지금도 없고, 이번에도 따로 넣을 필요는 없다고 본다. 다만 **옛 화면은 새 서버에서 제대로 돌지 않는다**는 점은 알고 있어야 한다.

- 옛 화면(캐시된 앱 셸)이 새 서버에 붙으면 `welcome`에서 `buildMismatch` → "새 버전이 있어요" 띠가 먼저 뜨고(`client/src/app.ts:1099`),
  바로 다음 줄 `validateBalance(msg.balance)`(`app.ts:1100`)가 **옛 구조 검사(`count === 2`)로 `BalanceError`를 던진다**(메시지 처리기 하나가 중단될 뿐, 연결은 살아 있다).
  - 새로 연 옛 화면: `this.balance`가 `null`로 남아 `match` 메시지를 버린다(`app.ts:1138`) → 판 화면이 안 뜨고 멈춘다. 띠의 새로고침이 유일한 길.
  - 배포 전부터 열려 있던 탭이 재접속한 경우: `this.balance`에 옛 값이 남아 있어 판이 시작될 수 있고, 그러면 옛 코드가 거점 3개 스냅샷을 그리다
    `objects.ts:559`(`POINT_BADGE['C']` = `undefined` → `sigs[undefined]`)에서 프레임마다 예외를 낸다. 미니맵은 B 표시를 C 상태로 덮는다(`minimap.ts:489-492`).
  - 어느 쪽이든 "새 버전이 있어요" 띠는 떠 있다. 구조 수치(`count`)를 바꾸는 변경이면 늘 생기는 일이고, 이번 변경만의 문제는 아니다. 배포 메모 · HUMAN_CHECKS에 "배포 뒤 열려 있던 탭은 새로고침" 한 줄을 권한다.
- 새 화면 ↔ 옛 서버는 같은 서버가 정적 파일도 주므로 생기지 않는다.
- 서버 봇 클라이언트(`server/src/bots.ts:69`)와 기기 안 연습(`client/src/practiceBalance.ts:7`, `client/src/localServer.ts`)은 같은 빌드의 shared를 쓰므로 어긋나지 않는다.
- 스냅샷 크기: `PointView` 하나(JSON 약 40바이트) × 20Hz × 4명 — 무시할 만하다. `server/src/sendPolicy.ts`의 건너뛰기 기준과 무관.
- 재접속: 꺼짐은 일회성 이벤트가 아니라 매 스냅샷의 상태값이라 끊겼다 돌아와도 맞는다(메모만 이벤트 — `shared/src/notes.ts`가 지킨다).
- 새 필드가 없으므로(상태값 하나 + 배열 길이) 직렬화 형식 · 메시지 타입은 그대로다.

## 8. 골든 · 시험 영향

### 8.1 골든 (`tests/unit/rules-golden.test.ts`)

- **해시는 반드시 바뀐다.** 이유 셋: ① `JSON.stringify(judged)`에 balance 전체가 들어간다(`rules-golden.test.ts:433-434` — count · required), ② 직렬화의 `points`가 3개가 된다(354-360줄),
  ③ `pointCamp: [A, B]`(328줄)를 `[A, B, C]`로, `points`에 `off`를 넣어야 꺼짐이 해시에 잡힌다(시험 쪽 수정).
- 시나리오 자체는 그대로 통과한다(탐침 3: "빈 시나리오 방지" 항목 통과, "같은 입력 같은 해시" 통과, 해시 항목만 실패). 시나리오는 A · B만 쓰고 913틱쯤 3명 수감으로 끝나
  **꺼짐 상태를 한 번도 지나지 않는다** → 골든만으로는 새 규칙이 보호되지 않는다. 꺼짐 전용 단위 시험이 따로 필요하다(탐침 4를 옮기면 된다).
- C 자리가 시나리오 경로(괴물이 지나는 (25.8, 25.5) → (25.8, 21.6) → (26.6, 19.5) 등)와 겹치면 `pointCamp.C`가 쌓여 해시에 들어갈 뿐 흐름은 안 바뀐다.
- 규칙 변경이므로 `docs/GAME_DESIGN.md` 13장 변경 이력 + `GOLDEN_HASH` 갱신(시험 머리말 5-6줄의 절차).

### 8.2 단위 · 봇 시험 (탐침 3: 사본에서 `vitest run`, 124파일)

| 시험 | 결과 | 이유 |
|---|---|---|
| `tests/unit/rules-golden.test.ts` "게임 상태 해시가 기대값과 같다" | 실패 | 위 |
| `tests/unit/balance.test.ts:36-37` "구조에 묶인 값(거점 수)을 바꾸면 실패한다" | 실패 | `count = 3`이면 던져야 한다는 시험 → 다른 값(예: 2 · 4)으로 |
| `tests/bots/fullmatch.test.ts:63` | 실패 | `expect(g.points.every((p) => p.done))` → "끝난 수 = required, 남은 곳 off" |
| 그 밖 117파일 | 통과 | (사본에 없는 `artifacts/store` · git을 읽는 3건은 탐침 환경 탓이라 제외) |

- 주의: **클라이언트를 하나도 안 고친 상태로도 클라이언트 시험이 전부 통과했다.** 시험들이 A · B 두 개짜리 목록을 직접 만들어 넣기 때문이다
  (`tests/unit/objects.test.ts:80-141,582,680-716`, `hud.test.ts:390-409`, `offscreen.test.ts`, `touch-hud.test.ts:163`, `touch-tuning.test.ts:310-319`). 3.7~3.9의 조용한 결함은 새 시험 없이는 CI가 못 잡는다.
- 고쳐야 할(값이 박힌) 시험: `objects.test.ts`(배지 5장 목록 · `Record<'A'|'B'>` 498줄 타입 오류), `hud.test.ts:390-409`(게이지 사각형 · `gaugeB.x < 1490`),
  `touch-hud.test.ts:163,233`, `touch-tuning.test.ts:310-319`(반전 = A · B 맞바꿈), `map-art.test.ts`(데칼 · 패드 수), `capture-exit.test.ts:87-106`(도우미 이름 `bothDone` — 동작은 통과).
- 안 돌린 것: E2E(`tests/e2e/*` — `m10-hud.spec.ts:148-189` `pointA/pointB` 디버그 키, `m10-map.spec.ts:67-68` · `m10-map.shared.ts` `point-A` 정보 레이어 목록,
  `m12-hud.spec.ts:36` · `layout-editor.spec.ts:18,179` `gaugeA|gaugeB` 정규식, `minimap-sharp.spec.ts`), `tests/lag`, `tests/perf`, `tests/camera`, `tests/store`(스크린샷 기준 그림).

## 9. 괴물 화면에 생존자 구분 단서가 생기는가 — 판단

**결론: 규칙 · 스냅샷 변경 자체로는 새 단서가 생기지 않는다.** 근거와 지켜야 할 조건:

| 항목 | 판단 |
|---|---|
| `world.points` (3개 · `'off'`) | 받는 사람과 무관하게 같은 값(`interest.ts:211-215`, 탐침 4로 확인). 거점 id · 진행 · 상태뿐, 사람 정보 없음 |
| 꺼짐 시점 | `ALERT_CAPTURE_DONE` 2번 + `ALERT_EXITS_ON`이 이미 양쪽에 가므로(`capture.ts:52,60,63`) "남은 한 곳이 꺼졌다"는 누구나 아는 공개 정보 |
| 진행 속도(1배 / 1.5배) | 괴물이 진행 값으로 "그 거점에 1명인지 2명 이상인지"를 읽을 수 있는 것은 **지금도 같다**. 3곳이면 한 번에 볼 수 있는 거점이 하나 늘 뿐, 누가(어느 역할이) 있는지는 여전히 모른다 |
| 꺼진 거점 안의 생존자 | 설계대로 `capturing/blocked = false` · 알림 없음이면 **들어가도 아무 신호가 안 나간다.** 반대로 꺼진 뒤에도 `capturing`을 계산해 보내면 "쓸모없는 곳에 누가 서 있다"가 새어 나간다 → 조건 ① |
| 괴물용 이벤트 | `ALERT_CAPTURE_START(point)` · `ALERT_CAPTURE_DONE(point)` · `ALERT_EXITS_ON`뿐. 메모(`NOTE_*`, 비밀번호)는 지금처럼 생존자에게만(`capture.ts:51-59`) → 조건 ④ |
| `blockWarn` | 괴물 자기 위치 정보. 꺼진 곳 제외만 하면 됨 |
| HUD · 미니맵 · 화살표 · 배지 | 모두 `world.points`만 그린다. 괴물 화면 화살표는 `capturing`만(`offscreen.ts:103-107`), 익명 카드(`statusList`)는 무관 |
| 판 결과 · 평가 | 판이 끝난 뒤, 본인 것만(`pointsLeft` 등) — 판 중 정보 아님 |
| **봇 행동** | 지금도 봇에는 역할 냄새가 있다: `POINT_OFFSET`(`practiceBrains.ts:1007-1011`, 러너는 거점 왼쪽 · 가드는 오른쪽 · 스카우트는 아래에 선다), `teamPlan`의 `solo`는 러너 · 스카우트만(`1051줄` — 가드는 혼자 안 감). 새 3곳 계획을 "가드는 늘 C" 식으로 짜면 **새 단서가 된다** → 조건 ③ |

조건: ① 꺼진 거점은 `capturing · blocked · ALERT_CAPTURE_START`를 내지 않는다. ② `PointView`에 안에 있는 사람 수 · id · 역할을 넣지 않는다.
③ 봇의 거점 배정은 시드 난수로만 하고 역할에 고정하지 않는다(기존 `POINT_OFFSET` · `solo` 편향은 이번 변경과 무관한 기존 사항 — 봇 담당에게 알림).
④ 메모 · 비밀번호는 생존자에게만. ⑤ `world.points` 배열 순서는 id 고정(점령 순서 · 사람 순서가 아님).

## 10. 남은 결정 · 다른 담당에게 넘길 것

1. 거점 C 좌표(맵 담당). 반경 2.5 안이 모두 바닥이어야 하고 `MAP_ART.decalClearPoint`(3.3) 안 데칼이 지워진다.
2. HUD 셋째 게이지 배치(PC 위 띠 580~1340 · 터치 `pairW` 110 → 168) — 대칭 한 쌍 구조를 어떻게 바꿀지.
3. 꺼짐의 모양(아이콘 추가 여부, `VISUAL_SPEC` 0장 "색만으로 구분하지 않기").
4. `EDGE_MAX` 8 유지 여부(거점 화살표 하나가 잘릴 수 있음).
5. `INTRO_WALL` "두 장소에 나뉘어 있다" 문구(스토리).
6. 같은 틱 동시 완료 시 "배열 순서 앞이 이긴다"를 GAME_DESIGN에 적을지.
7. 봇: `teamPlan` · `home` · `undone`에서 `'off'` 제외 · 괴물 순찰(`lastGuarded`) 순환.
8. `scripts/meta-calibrate.ts` 재측정(버려지는 점령 초가 `captureSec`에 들어감) — HUMAN_CHECKS.

## 부록: 실험 파일

- `…/understand/b1/patch-shared.py` — 사본에 넣은 최소 변경(위 6.2)
- `…/understand/b1/step1-*.txt · step2-*.txt · step3-*.txt` — `tsc` 오류 원문
- `…/understand/b1/probe-vitest.txt` — 사본 전체 시험 결과
- `…/understand/b1/probe/tests/unit/zz-b1-rule-probe.test.ts` — 규칙 동작 시험 6개 (실제 작업에 옮겨 쓸 수 있음)
- `…/understand/b1/probe/tests/unit/zz-b1-client-silent.test.ts` — 조용한 클라이언트 결함 확인 3개
- `…/understand/b1/c-spots.mts` — 탐침용 C 후보 계산

(`…` = `/tmp/claude-0/-home-user-decoy-web/6751cf0a-610a-5fe5-9da6-2668943efcba/scratchpad`)
