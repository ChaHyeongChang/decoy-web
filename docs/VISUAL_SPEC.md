# DECOY v2 비주얼 스펙 (웹판, M10 새 판)

M10 비주얼 리마스터(어두운 시설 · 청록 네온 · 붉은 괴물) 기준의 그래픽 · UI 규칙이다. 옛 판(단색 도형, M1~M9)은 git 기록에 있고, 장 번호가 바뀐 곳은 맨 끝 "옛 판 장 번호"에 적었다. 계획과 이유는 `docs/MOBILE_PLAN.md` M10, `docs/DECISIONS.md` 4절.

- **기준은 코드다.** 이 문서의 수치는 코드 · `config/balance.json`에서 옮겼다. 다르면 코드가 맞고 이 문서를 고친다. 규칙 시간 · 거리(공격 준비 0.4초, 거점 반경 2.5타일 등)는 `config/balance.json`에만 있고, 여기 있는 그래픽 상수는 판정과 무관한 장식 값이다
- 표의 마지막 열 `코드`(예: `palette.ROLE.runner`)는 그 값이 있는 상수다. `tests/unit/visual-spec.test.ts`가 그 열이 있는 모든 줄의 값을 코드와 대조하고, 이 문서에 적은 테스트 경로 · 제목이 실제로 있는지 확인한다

| 별칭 | 파일 |
|---|---|
| `palette` | `client/src/art/palette.ts` |
| `colors` | `client/src/render/colors.ts` |
| `mapArtGeom` | `client/src/art/mapArtGeom.ts` |
| `mapArtBadges` | `client/src/art/mapArtBadges.ts` |
| `shapes` | `client/src/art/shapes.ts` |
| `charFrames` | `client/src/art/charFrames.ts` |
| `chars` | `client/src/art/chars/index.ts` (새 캐릭터 그림 모음 · 재질 색) |
| `anim` | `client/src/art/anim.ts` |
| `fx` | `client/src/art/fx.ts` |
| `icons` | `client/src/art/icons.ts` |
| `vision` | `client/src/render/vision.ts` |
| `camera` | `client/src/render/camera.ts` (따라가는 카메라, 12장) |
| `presets` | `client/src/gfx/presets.ts` |
| `quality` | `client/src/gfx/quality.ts` |
| `framePacing` | `client/src/gfx/framePacing.ts` (프레임 제한 · 고른 목표 사다리, 7.3) |
| `hudArt` | `client/src/ui/hudArt.ts` |
| `layout` | `client/src/ui/layout.ts` |
| `fonts` | `client/src/ui/fonts.ts` |
| `prefs` | `client/src/prefs.ts` (설정 저장소, 9.5) |
| `prefsFx` | `client/src/render/prefsFx.ts` (번쩍임 줄이기 · 지도 크게 보기, 7.2 · 12.6) |
| `perfChip` | `client/src/ui/perfChip.ts` (FPS · 핑 칩, 12.8) |
| `matchMenuButton` | `client/src/ui/matchMenuButton.ts` (PC 판 중 메뉴 버튼, 12.8) |
| `controlLayout` | `client/src/controlLayout.ts` (조작 배치, 13장) |
| `style.css --이름` | `client/src/style.css`의 `:root` 변수 |

---

## 0. 바꾸면 안 되는 것

그래픽 · UI 작업(M10~M15)은 아래 일곱 가지를 바꾸지 못한다. 바꾸려면 사용자 결정이 필요하고 `GAME_DESIGN.md` 변경 이력에 적는다. 항목마다 지키는 테스트를 파일 경로와 낫표로 감싼 테스트 제목으로 적었다(E2E는 `npm run build` 뒤 Playwright, 단위는 `npm test`).

### 0.1 고정 값

| 항목 | 값 | 출처 규칙 | 코드 |
|---|---|---|---|
| 러너 역할색 | `#3B82F6` | `balance.json` roles.runner.color | `palette.ROLE.runner` |
| 가드 역할색 | `#A855F7` | roles.guard.color | `palette.ROLE.guard` |
| 스카우트 역할색 | `#22C55E` | roles.scout.color | `palette.ROLE.scout` |
| 괴물 역할색 | `#EF4444` | GAME_DESIGN · CLAUDE.md | `palette.ROLE.monster` |
| 러너 글자색 | `#60A5FA` | 글자용 밝은 변형 (패널 위 6.85:1) | `palette.ROLE_TEXT.runner` |
| 가드 글자색 | `#C084FC` | 글자용 밝은 변형 (6.59:1) | `palette.ROLE_TEXT.guard` |
| 스카우트 글자색 | `#4ADE80` | 글자용 밝은 변형 (9.99:1) | `palette.ROLE_TEXT.scout` |
| 괴물 글자색 | `#F87171` | 글자용 밝은 변형 (6.29:1) | `palette.ROLE_TEXT.monster` |
| 괴물 화면의 생존자 | `#F8FAFC` | GAME_DESIGN 3.3 (세 명 모두 같은 흰색) | `palette.HIDDEN_SURVIVOR` |
| 부채꼴 — 아무도 안 보임 | `#EAB308` | GAME_DESIGN 3.2 | `palette.CONE.idle` |
| 부채꼴 — 누군가 보이는 중 | `#EF4444` | GAME_DESIGN 3.2 | `palette.CONE.seen` |
| 부채꼴 채움 (생존자 화면, 노랑 · 빨강) | `0.20` · `0.28` | M10 결정 (옛 0.30 · 0.45) | `vision.CONE_LOOK.fillIdle` `vision.CONE_LOOK.fillSeen` |
| 시야 밖 밝기 하한 | `0.45` | M10 안개 결정 | `colors.FOG.ambient` |
| 시야 밖 틴트 | `#A8C4E0` | M10 안개 결정 | `colors.FOG.tint` |

하한 색 = 0.45 × `#A8C4E0` = **rgb(76, 88, 101)** (`render/fogMath.ts` ambientRgb). 부채꼴 노랑 → 빨강은 0.1초, 빨강 → 노랑은 0.4초에 걸쳐 바뀐다(`render/fogMath.ts` nextConeRed, 옛 판부터 같은 값).

### ① 규칙 · 판정 · 정보 차단은 그래픽이 바꾸지 않는다

그래픽 PR은 `server/` · `shared/` · `config/balance.json`의 판정을 바꾸지 않는다. 숨은 상대가 안 보이는 것은 안개가 아니라 서버가 보내지 않아서다. HUD가 보여 주는 정보의 양 · 종류도 같다(괴물 화면 카드는 익명). 판 밖 성장(9.6)의 레벨 · 평가는 판 HUD · 점수판 · 미니맵에 넣지 않고, 판이 끝나기 전에는 누구에게도 가지 않는다(결과에 자기 평가만).

- `tests/unit/rules-golden.test.ts` 「시나리오가 피격 · 수감 · 구조 · 점령 진행 · 능력 · 시야 전환을 실제로 거친다 (빈 시나리오 방지)」 · 「게임 상태 해시가 기대값과 같다」
- `tests/e2e/m3-info.spec.ts` 「괴물 · 생존자가 받은 스냅샷 전체에 시야 밖 상대 좌표가 한 번도 없다」
- `tests/unit/interest.test.ts` 「괴물에게는 부채꼴 · 근접 원 안 생존자만, 임시 ID로, 역할 없이 간다」 · 「생존자에게는 시야 합집합 밖 괴물이 가지 않고, 안이면 부채꼴 정보와 함께 간다」 · 「괴물 상태 목록은 익명이고 심각도 순, 탈출구 진행도는 괴물에게 null」
- `tests/e2e/m10-fog.spec.ts` 「맵 구조는 시야 밖에서도 어둡게 보이고 시야 안은 2.5배 이상 밝다, 숨은 상대는 픽셀로도 없다」
- `tests/e2e/m10-hud.spec.ts` 「괴물 HUD는 익명 · 거점 정지 · 완료 상태 칩 (디버그 값 + 픽셀) · 상태가 바뀌어도 다시 굽지 않음」
- `tests/e2e/meta.spec.ts` 「정보 숨김: 판 중 괴물이 받은 모든 메시지(로비 · 판 시작 · 스냅샷)에 평가 · 레벨 칸이 없고, 결과에는 받는 사람 자기 평가만」 · `tests/unit/meta-room.test.ts` 「판이 끝나면 사람마다 자기 평가만 (역할 · 팀 항목 넷 · 같은 판 ID), 판 중에는 평가 · 레벨 칸이 하나도 없다」
- 자동 검사 없음: M10 PR에서 `server/` · `shared/src/visibility.ts` · `shared/src/geometry.ts` 변경 0은 PR 검토에서 `git diff --stat origin/main -- server shared/src/visibility.ts shared/src/geometry.ts`로 본다

### ② 역할색 4개 원값 + 글자용 밝은 변형

몸 채움 · 링 · 역할 UI는 원값(0.1 표), 이름 · 라벨 같은 글자는 밝은 변형(`ROLE_TEXT`)을 쓴다. 원값 가드 `#A855F7`은 패널 위 4.40:1이라 글자에 쓰지 않는다.

- `tests/unit/palette.test.ts` 「역할색은 규칙 색(balance.json roles.color)과 같고, 괴물 화면 생존자는 #F8FAFC」 · 「글자 쌍은 모두 4.5:1 이상」 · 「캐릭터 몸과 외곽선은 3:1 이상」
- `tests/unit/hud.test.ts` 「HUD 글자 쌍은 모두 기준 이상 (글자 4.5:1, 아이콘 3:1)」
- `tests/e2e/m10-visual.spec.ts` 「생존자 화면 역할색 유지: 빛 바닥 · 빨강 · 노랑 부채꼴 · 공격 범위 안에서 팀원 몸 ΔE ≤ 15, 몸/바깥 링 대비 3:1 — 기존 · 새 캐릭터 두 스타일」
- `tests/unit/visual-spec.test.ts` 「표의 코드 열 값이 코드 상수와 같다」

### ③ 괴물 화면의 생존자 흰색 위장

괴물 화면의 생존자는 하나의 공통 실루엣(원 + 노치, `#F8FAFC`) · 같은 크기 · 같은 숨쉬기 위상 · 같은 걸음 · 같은 그림자 · 발먼지이고 부상 · 질주 속도선 · 피격 불꽃을 그리지 않는다. 그리기 함수(`render/characters.ts` drawHiddenSurvivor, `art/anim.ts` hiddenSurvivorPose)는 역할 · 체력 · 능력 인자를 **받지 않는다**. 능력 노출 1초(`survivor.abilityRevealDuration`)에만 역할색 링 + 머리 위 역할 문양이 붙고, 몸 그림 키는 그대로 `survivor-hidden`이다.

- `tests/e2e/m10-visual.spec.ts` 「괴물 화면 흰색 위장: 부채꼴 · 근접 원 · 공격 범위 안에서도 흰 공통 실루엣, 능력 노출 1초만 역할색 테두리 + 문양」
- `tests/e2e/m10-visual.webgl.spec.ts` 「괴물 화면 흰색 위장 (WebGL 높음: 셰이더 비네트 · 색보정 · 눈빛 켬) + 공격 범위 = 판정값 + 후처리는 구조 레이어에만」 · 「기절 채도 감소 (WebGL 높음): 맵 위 · 캐릭터 아래라 숨은 생존자 흰색 · 몸/링 대비 · 가드 노출 링이 그대로, 별도 몸을 덮지 않는다」
- `tests/unit/anim.test.ts` 「그리기 값은 역할과 무관하게 같은 그림 · 크기 · 그림자 · 걷기 곡선」 · 「그리기 함수는 역할 · 체력 · 능력 인자를 받지 않는다 (타입 검사)」
- `tests/unit/shapes.test.ts` 「괴물 화면 공통 실루엣에는 문양이 없다 (흰색 위장)」
- `tests/unit/interest.test.ts` 「능력 노출 창에만 괴물에게 역할이 간다」

캐릭터 스타일(4.5, 기존 / 새 캐릭터)과 무관하다. 새 캐릭터 스타일에서도 괴물 화면 생존자는 공통 생존자 그림(`art/chars/common.ts`, 무채색만) 하나이고, 자세 프레임은 걷기 위상 · 걷기 세기만으로 고른다(`art/charFrames.ts` hiddenFrameNew — 역할 · 체력 · 능력 · 구조 · 수감 인자가 없다). 수감 자세도 쓰지 않는다: 기존 스타일은 수감자와 자유 생존자를 같은 흰 몸으로 그리므로(감옥 문은 수감자만 막아 자유 생존자도 감옥 안에 설 수 있다) 새 스타일도 같은 정보량이다. 멈춰 있으면 그림 키는 두 스타일 모두 `survivor-hidden`이다. 스타일은 기기에만 저장하고 서버로 보내지 않는다. 괴물 화면은 괴물 자신의 설정만 따른다.

- `tests/e2e/m10-visual.spec.ts` 「캐릭터 스타일과 무관한 흰색 위장: 괴물 화면 세 생존자는 새 캐릭터 · 기존 어느 스타일이든 같은 공통 그림, 생존자 쪽 스타일과도 무관」
- `tests/unit/char-frames.test.ts` 「프레임 고르기는 걷기 위상 · 걷기 세기 2개만 받는다 — 역할 · 체력 · 능력 · 구조 · 수감 자리가 없다 (타입 검사)」 · 「결정적: 같은 걷기 값이면 같은 프레임 이름이고(입력은 걷기 값 둘뿐), 이름은 공통 생존자 쉬기 · 걷기 표 안에 있다」 · 「'survivor-hidden*' 프레임은 공통 생존자 그림뿐이고 무채색이다 (역할색 · 괴물 빨강 없음)」
- `tests/unit/char-art.test.ts` 「자세 타입에 역할 · 능력 · 피격 · 구조 값이 없다 (타입 검사)」 · 「칠하는 색은 무채색 계열뿐 (색 폭 20/255 이하: 옛 숨은 생존자와 같은 차가운 회색까지) — 역할색 · 괴물 빨강이 없다」

### ④ 색만으로 구분하지 않기

| 구분 | 색 말고 다른 단서 |
|---|---|
| 역할 | 실루엣(러너 물방울 + », 가드 방패, 스카우트 렌즈) + 문양 |
| 부채꼴 빨강 | 사선 해치 + 0.6초 펄스 |
| 거점 상태 | 칩 아이콘 (점령 중 ▶ · 정지 ‖ · 완료 ✓) |
| 생존자 상태 · 타이머 | 아이콘 + 글자 |
| 배너 | 아이콘 + 리본 (`BannerLine.icon`이 필수 타입이라 아이콘 없는 배너는 `npm run check`에서 막힌다) |
| 밀치기 사거리 막힘 | 가로막은 칸 위 × |
| 로비 고른 카드 · 남이 고른 카드 | 테두리 + ✓ "내 역할" / 사선 해치 + 주인 이름 |
| 결과 등급 | 문 아이콘 3 · 2 · 1개 + 글자 |
| 역할 (새 캐릭터 스타일, 4.5) | 실루엣(러너 넓은 어깨 + 앞 후드 머리, 가드 앞 방패 호, 스카우트 고글 고리 + 짧은 망원경, 공통 생존자 흰 둥근 몸 + 짙은 가리개) + 같은 문양 |

- `tests/unit/shapes.test.ts` 「역할끼리 겹침(IoU) 0.8 이하 — 12.7 · 18 · 36px, 두 방향」 · 「괴물 화면 공통 실루엣과 각 역할의 겹침 0.85 이하」 · 「앞 돌출은 1.55r 이내 (역할마다 커 보이지 않게)」
- `tests/unit/char-art.test.ts` (새 캐릭터 스타일, 같은 기준) 「역할끼리 겹침(IoU) 0.8 이하 — 12.7 · 18 · 36px, 두 방향」 · 「괴물 화면 공통 생존자와 각 역할의 겹침 0.85 이하」 — 실측 역할끼리 0.64~0.72, 공통과 0.69~0.79
- `tests/unit/rangeDraw.test.ts` 「coneRed > 0이면 줄을 긋고, 모든 줄은 판정 다각형 안 (끝점은 경계 위, 가운데는 안)」 · 「펄스: 0.6초 주기로 알파가 오르내리고(같은 위상이면 같은 값), 빨강 세기에 비례」 · 「막힘은 × 표시를 더 긋는다 (색만으로 구분하지 않기)」
- `tests/unit/objects.test.ts` 「상태는 색만이 아니라 아이콘으로도 갈린다 (점령 중 ▶ · 정지 ‖ · 완료 ✓), 경고 주황은 정지에만」
- `tests/unit/hud.test.ts` 「거점 상태: 서버 blocked = 정지, 점령 중 · 정지 · 완료는 서로 다른 칩 아이콘 (색만으로 구분하지 않기)」 · 「타이머: 최후의 30초 > 1분 미만 > 보통, 모드마다 아이콘도 다르다」 · 「생존자 상태는 아이콘이 모두 다르고, 상태 이름은 지금 문구 그대로」
- `tests/e2e/m10-map.spec.ts` 「배지는 캐릭터를 덮지 않고, 거점 정지는 주황 + 일시정지 아이콘, 멈춘 시계 탈출구 열림 (Canvas 낮음)」
- `tests/e2e/m10-ui.spec.ts` 「로비: 보이는 모든 글자 대비 4.5:1(큰 글자 3:1), 고른 카드와 남이 고른 카드는 색 말고도 구분된다」 · 「결과 화면: 글자 대비, 960×540 · 1366×768 · 더 낮은 창에서도 위가 잘리지 않고, 생존자 승리는 문 아이콘 등급」

### ⑤ 게임 정보가 효과에 묻히지 않기 (정보 우선 R1~R15)

규칙 전체와 규칙별 테스트는 1.3절. 대표 테스트:

- `tests/e2e/m10-visual.spec.ts` 「노출 문양 · 기절 별 · 기절 채도 감소는 다른 캐릭터 몸 · 노출 링을 덮지 않는다 (괴물 화면 · 생존자 화면)」 · 「부채꼴 가장자리 선 · 괴물 화면 자기 시야 테두리는 캐릭터 접지 그림자 둘레에서도 끊기지 않는다」
- `tests/e2e/m10-visual.webgl.spec.ts` 「생존자 화면: WebGL 높음(후처리 · 먼지 켬)과 Canvas 낮음의 팀원 몸 역할색 · 몸/링 대비가 같은 수준, 먼지는 원호 없이」
- `tests/e2e/m10-map.spec.ts` 「시야 밖 구조 대비 2.5:1 · 시간 불변 · 시야 안 바닥 밝기 상한 · 굽는 시간 (Canvas 낮음)」
- `tests/unit/fx.test.ts` 「장식 입자는 알파 0.2 이하 · 크기 2px 이하, 이벤트 효과는 0.4초 이하」
- `tests/unit/map-art.test.ts` 「예약 색: 맵 · 오브젝트 색에 역할 4색 · #F8FAFC가 없고, 빨강 계열은 감옥 · 주황은 경고에만」
- `tests/unit/rangeDraw.test.ts` 「밀치기 2 · 구조 1.2 · 포효 10(끝) · 캠핑 4: 그린 점선 · 고리가 판정 반지름 위」

### ⑥ 부채꼴 색 2단계와 보간 시간

노랑(아무도 안 보임) / 빨강(누군가 보이는 중) 두 단계뿐이다(컨셉 이미지의 노랑 · 주황 · 빨강 3단계는 쓰지 않는다). 노랑 → 빨강 0.1초, 빨강 → 노랑 0.4초. 괴물이 시야에 다시 들어온 첫 프레임은 지금 상태 그대로(사라지기 전 색을 이어 가지 않는다).

- `tests/unit/fog-math.test.ts` 「괴물 부채꼴 색: 보이는 동안에는 노랑 → 빨강 0.1초, 빨강 → 노랑 0.4초」 · 「괴물 부채꼴 색: 시야에 다시 들어온 첫 프레임은 지금 상태(seesSomeone) 그대로」
- `tests/unit/rangeDraw.test.ts` 「coneRed = 0(노랑)이면 한 줄도 긋지 않는다」
- `tests/unit/interest.test.ts` 「발각: 괴물에게 보이는 생존자는 본인 스냅샷에 spotted, 부채꼴은 빨강(seesSomeone)」
- `tests/unit/visibility.test.ts` 「부채꼴 경계: 탐색 110° · 5타일 / 추적 50° · 9타일」 · 「모드 전환 중에는 보간된 각도 · 거리로 판정한다 (0.2초 = 절반: 80°, 7타일)」
- `tests/unit/visual-spec.test.ts` 「부채꼴 색은 GAME_DESIGN 3.2 규칙 색과 같다」

### ⑦ 품질은 장식만 바꾼다

품질 높음 · 중간 · 낮음은 해상도 상한 · 안개 합성 방식 · 발광 · 후처리 · 입자 수 · 애니메이션 프레임만 바꾼다. 캐릭터 · 범위 · 마커 · 배지 · HUD(정보 레이어 `getInfoLayer` · 그린 엔티티 `getDrawn`)는 세 단계에서 같다.

- `tests/e2e/m10-visual.spec.ts` 「품질 높음 · 중간 · 낮음: 정보 레이어 · 그린 엔티티가 같고, 효과가 몸 · 링을 바꾸지 않으며, 후처리는 구조 레이어에만」
- `tests/e2e/m10-visual.webgl.spec.ts` 「품질 WebGL 높음 · 중간 · Canvas 낮음: 범위가 있는 장면의 정보 레이어 · 그린 엔티티가 같고 범위 반지름 · 각도 = 판정값 ±2px」
- `tests/e2e/m10-quality.spec.ts` 「Canvas 렌더러는 ?quality=high여도 WebGL 전용 기능이 꺼진다」
- `tests/e2e/m10-fog.webgl.spec.ts` 「GPU 안개(품질 높음 · 중간)가 Canvas 합성과 같은 밝기를 내고 콘솔이 깨끗하다」
- `tests/unit/fx.test.ts` 「품질별 개수: 먼지 높음 40 · 중간 15 · 낮음 0, 모두 particleCap 이하. 발먼지는 높음 · 중간만」
- `tests/unit/anim.test.ts` 「품질 낮음은 프레임 절반」

캐릭터 스타일(4.5)도 품질과 무관하다: 새 캐릭터 아틀라스는 세 단계에서 같은 그림이고, 품질 낮음은 걷기 위상을 4단계로 끊어 짝수 칸만 쓴다.

- `tests/unit/char-frames.test.ts` 「걷기 위상 → 칸 번호: 가장 가까운 칸, 음수 · 큰 위상 · NaN도 0..n−1」

---

## 1. 원칙 · 형태 문법

### 1.1 화면

- 정직교 탑다운, **따라가는 카메라**(12장): 맵 사각형(논리 1428 × 952, 모든 배치에서 3:2)에 맵 전체가 아니라 내 캐릭터 둘레 16 × 10.7타일(확대 3, `layout.DEFAULT_CAM_ZOOM`)을 그린다. 1타일 = 32 월드 px, 맵 48 × 32타일(1536 × 1024). 논리 해상도 1920 × 1080에서 맵 사각형은 위 · 아래 HUD 띠 64px, 좌우 여백 246px를 남긴 자리다(DECISIONS D3). 월드 배율 = 0.9297(`layout.MAP_SCALE` = 952 / 1024) × 확대 수준. 옛 고정 화면(맵 전체)은 확대 1이고 시험 · 촬영에서만 쓴다(`?cam=1`, 로컬 주소만)
- 렌더 해상도 = 표시 CSS 크기 × min(기기 픽셀 배율, 품질 상한, 픽셀 수 상한), 카메라 zoom으로 논리 좌표를 유지하고 캔버스를 기기 픽셀 격자에 맞춘다(`client/src/render/resolution.ts`). Phaser 글자는 모두 `client/src/ui/text.ts` makeText(글자 해상도 = zoom)
- 그래픽은 코드로 그린다(질감 · 그라디언트 · 셰이더 · 애니메이션 허용). 외부 파일은 로고와 UI 폰트뿐이다(11장, `docs/CREDITS.md`)
- 결정성: `client/src/art` · `client/src/render`에서 `Math.random` · `Date.now`는 ESLint 오류다. 난수는 시드 고정, 장식 시간은 `gfxNow`(테스트에서 `freezeClock`으로 멈춤)

### 1.2 형태 문법과 색의 역할

| 대상 | 형태 | 색 |
|---|---|---|
| 시설 (벽 · 기둥 · 바닥) | 직각 모듈 판, 가는 청록 네온(직선), 깎은 8각 기둥 | 어두운 청회색 + 청록 |
| 생존자 | 둥근 형태: 같은 몸 원 + 역할 소품 (4장). 새 캐릭터 스타일은 위에서 본 사람 + 역할 소품(4.5) | 역할색 / 괴물 화면은 흰색 |
| 괴물 | 뾰족한 형태: 톱니 망토 + 앞 발톱 2개 (촉수 없음). 새 캐릭터 스타일은 매끈한 두건 앞 · 톱니 자락 뒤 + 흰 발톱(4.5) | 빨강 |
| 거점 | 원형 패드 + 24칸 눈금 링 + 마름모 A/B 배지 | 청록 (정지 = 주황) |
| 탈출구 | 사각 방폭문 + 바닥 셰브론 + 문틀 표지판 | 회색 → 초록 `#10B981` |
| 감옥 | 격자 철창 + 남쪽 문 자물쇠 | 감옥 빨강 `#DC2626` |
| 정보 마커 (탐지 · 포효) | 굵은 외곽선 + 펄스 | 탐지 초록 · 포효 주황 |
| UI | 모서리를 깎은 어두운 유리 패널 + 얇은 청록 테두리, 24 격자 선 아이콘 | 10장 |

**예약 색**(R6): 역할 4색과 `#F8FAFC`는 캐릭터 · 역할 UI 전용이고 맵 장식에 쓰지 않는다(괴물 화면에서 "흰 원 = 생존자"라 맵에 흰색 · 밝은 둥근 장식도 두지 않는다). 빨강 계열은 괴물 · 빨강 부채꼴 · 감옥 · 피해 전용, 주황은 경고 전용, 청록은 시설 · 목표. 그래서 맵의 탈출구 초록은 스카우트 `#22C55E`가 아닌 `#10B981`, 감옥 빨강은 괴물 `#EF4444`가 아닌 `#DC2626`이다. 예외 하나(사용자 결정 2026-10-18, 캐릭터 리디자인): 새 캐릭터 스타일의 **정면 그림**(로비 역할 카드 · 연습 역할 고르기 · 결과 화면 · 조작 안내, 4.5) 생존자 셋의 옷 · 장비에는 청록 네온 선 · 발광 점(`#22D3EE` · `#0E7490` · `#67E8F9`)을 은은하게 쓴다. 게임 화면의 위 그림 · 괴물 · 공통 생존자에는 쓰지 않는다(게임 화면에서 청록은 시설 · 목표).

### 1.3 정보 우선 규칙 R1~R15

| 규칙 | 내용 | 구현 | 지키는 테스트 |
|---|---|---|---|
| R1 레이어 순서 | 구조 · 시야 빛(안개) → 배지 · 바닥 문양 → 장식 입자 → 부채꼴 · 공격 준비 채움 → 캐릭터 그림자 → 범위 선 → 바닥 링 → 몸 아래 표시 → 마커 → 몸 → 부착 표시 → 화면 효과 → 배너 · HUD (자세히는 7.4) | `render/worldRenderer.ts` 머리 | `tests/unit/objects.test.ts` 「배지 상자를 맵 컨테이너에 넣고(캐릭터보다 먼저), A · B 글자를 맵 컨테이너 바로 아래로 내린다」 |
| R2 후처리 대상 | 블룸 · 비네트 · 색보정은 구조 레이어(`fogRoot`)에만. 캐릭터 · 범위 · 마커 · 글자 · HUD에는 걸지 않는다 | `render/effects.ts` WorldPostFx, `getFxTargets()`는 표시 목록에서 직접 모음 | `tests/e2e/m10-visual.spec.ts` 「품질 높음 · 중간 · 낮음: 정보 레이어 · 그린 엔티티가 같고, 효과가 몸 · 링을 바꾸지 않으며, 후처리는 구조 레이어에만」 |
| R3 몸 대비 | 캐릭터 몸과 바로 바깥 링 3:1 이상, 효과를 켜도 끈 상태의 80% 이상 | 외곽선 `#05080C` + 접지 그림자 2.15r · 알파 0.82 | `tests/e2e/m10-visual.webgl.spec.ts` 「생존자 화면: WebGL 높음(후처리 · 먼지 켬)과 Canvas 낮음의 팀원 몸 역할색 · 몸/링 대비가 같은 수준, 먼지는 원호 없이」 |
| R4 장식 입자 | 알파 0.2 이하 · 크기 2px 이하, 몸 위에 그리지 않음 | `fx.FX_LIMITS` | `tests/unit/fx.test.ts` 「입자 시스템은 상한을 넘지 않고, 그린 장식 입자 알파도 0.2 이하」 |
| R5 이벤트 효과 수명 | 0.4초 이하 (규칙 상태 표시는 그 규칙 시간, 포효 충격파 0.6초는 범위 표시 예외) | `fx.FX_PRESETS` | `tests/unit/anim.test.ts` 「장식 연출 시간은 이벤트 효과 한도(0.4초) 안」 |
| R6 예약 색 | 1.2절 | `palette.ts` · `mapArtGeom.ts` | `tests/unit/map-art.test.ts` 「예약 색: 맵 · 오브젝트 색에 역할 4색 · #F8FAFC가 없고, 빨강 계열은 감옥 · 주황은 경고에만」 |
| R7 위장 보호 | 0장 ③ | `drawHiddenSurvivor` | 0장 ③ |
| R8 상대 광원 · 잔여 효과 | 상대 팀 광원으로 환경을 비추지 않는다. 상대에게서 나온 효과는 출처가 이번 스냅샷에서 사라지면 그 프레임에 없앤다 | `fx.ts` pruneSources, `fogMath.opponentFxAllowed` | `tests/e2e/m10-fog.spec.ts` 「생존자 시야 안에서 괴물이 돌진해 시야 밖으로 나가면 다음 프레임에 상대 효과(돌진 잔상)가 0, 부채꼴 색도 남지 않는다」 · `tests/unit/fx.test.ts` 「수명이 끝나면 사라지고, 출처가 스냅샷에서 사라진 상대 효과는 그 프레임에 0」 |
| R9 어둠 속 움직임 | 시야 밖 구조 · 발광은 시간에 따라 변하지 않는다. 어둠 속에서 움직이는 것은 정보 표시(점령 스캔선 · 탈출구 맥동 — 양쪽이 받는 공개 정보)뿐 | 정적 굽기 + 빛 지도 곱하기 | `tests/e2e/m10-map.spec.ts` 「시야 밖 구조 대비 2.5:1 · 시간 불변 · 시야 안 바닥 밝기 상한 · 굽는 시간 (Canvas 낮음)」 |
| R10 품질은 장식만 | 0장 ⑦ | `presets.ts` | 0장 ⑦ |
| R11 입체는 칸 안 | 벽 · 기둥의 윗면 · 앞면 · 테두리는 그 칸 밖으로 나가지 않는다(그림 경계 = 판정 경계). 칸 밖은 바닥보다 어두운 접촉 그림자(≤0.25타일)뿐 | `mapArtGeom.ts` wallFaces · pillarShape | `tests/unit/map-art.test.ts` 「모든 벽 칸: 윗면 · 앞면 · 테두리가 그 칸 안이고, 앞면은 남쪽이 열린 칸에만, 테두리는 열린 쪽에만」 |
| R12 범위 = 판정값 | 공격 1.2타일 90°, 밀치기 2, 포효 10, 구조 1.2, 캠핑 4, 거점 2.5, 탈출구 1.5 — 모두 `balance.json`에서 읽은 정보 항목(`InfoItem`)에서 그린다 | `render/vision.ts` | `tests/unit/rangeDraw.test.ts` 「공격 준비: 경계 호는 attack.range, 직선 변은 방향 ± arc/2 (앞머리 · 채움도 범위 안)」 · 「반지름은 정보 항목에서 온다: 항목 r을 바꾸면 그림도 바뀐다 (그림만 따로 어긋날 수 없음)」 |
| R13 색만으로 구분하지 않기 | 0장 ④ | | 0장 ④ |
| R14 글자 대비 | 글자 4.5:1(큰 글자 3:1), 그래픽 3:1, 어둠 속 구조 2.5:1 | `palette.TEXT_PAIRS` · `hudArt.HUD_TEXT_PAIRS` | `tests/unit/palette.test.ts` 「글자 쌍은 모두 4.5:1 이상」 · `tests/unit/map-art.test.ts` 「어둠 속(하한 곱하기 + 리프트): 벽 · 기둥 테두리와 인접 바닥 대비 ≥ 2.5:1 (어두운 쪽 테두리 포함)」 |
| R15 배지 · 라벨 · HUD가 캐릭터를 덮지 않음 | 배지는 캐릭터 아래 레이어, 노출 문양 · 기절 별은 옆 몸을 비킨 자리, 늘 떠 있는 HUD는 맵 사각형 밖. 예외 둘(따라가는 카메라, 12장): 화면 밖 화살표는 창 가장자리 안쪽에 두되 캐릭터 몸과 겹치면 흐리게(알파 0.35), 옆 칸에 자리가 없는 터치 배치의 미니맵은 맵 창 안 오른쪽 위 구석(엄지 · 시스템 버튼을 피한 자리) | `mapArtBadges.ts`, `shapes.glyphSlot` · `starSlot`, `layout.HUD` | `tests/unit/shapes.test.ts` 「0.7타일 북쪽에 다른 생존자가 서 있으면 그 몸과 겹치지 않는 자리 (검토 장면)」 · `tests/unit/hud.test.ts` 「늘 떠 있는 HUD 자리는 맵 사각형과 겹치지 않는다 (위 띠 · 왼쪽 카드 · 아래 띠 · 미니맵)」 |

---

## 2. 팔레트

### 2.1 캐릭터 · 정보 · 경고 (`palette.ts`)

| 이름 | 값 | 쓰는 곳 | 코드 |
|---|---|---|---|
| 캐릭터 외곽선 | `#05080C` | 모든 캐릭터 몸 가장자리 (역할색 대비 5.07~8.81:1) | `palette.OUTLINE` |
| 시설 네온 | `#22D3EE` | 벽 네온 · 거점 · 진행 · 패널 강조 | `palette.NEON` |
| 어두운 청록 | `#0E7490` | 단말 화면 · 정보 배너 · 주 버튼 | `palette.NEON_DIM` |
| 경고 주황 | `#F59E0B` | 경고 배너 · 거점 정지 · 부상 글자 | `palette.WARN` |
| 경고 위 글자 | `#0B1622` | 경고 배너 글자 (8.49:1) | `palette.WARN_TEXT` |
| 위험 빨강 | `#EF4444` | 피해 · 근접 원 | `palette.DANGER` |
| 발각 배너 바탕 | `#B91C1C` | 흰 글자 6.47:1 | `palette.DANGER_BANNER` |
| 정보 배너 바탕 | `#0E7490` | 흰 글자 5.36:1 | `palette.INFO_BANNER` |
| 탈출구 초록 | `#10B981` | 활성 · 열린 탈출구 (스카우트색 아님) | `palette.EXIT_GO` |
| 감옥 빨강 | `#DC2626` | 철창 · 자물쇠 배지 (괴물색 아님) | `palette.PRISON_RED` |

역할색 · 글자용 역할색 · `#F8FAFC` · 부채꼴 색은 0.1 표.

### 2.2 UI 바탕 (`palette.UI`, HUD 전용 `hudArt.HC`)

| 이름 | 값 | 쓰는 곳 | 코드 |
|---|---|---|---|
| 화면 바탕 · HUD 띠 | `#0B1622` | 카메라 배경 · 위아래 띠 · 로비 바탕 | `palette.UI.background` |
| 맵 밖 | `#05080C` | 맵 사각형 바깥 | `palette.UI.mapOutside` |
| 패널 | `#0F1B27` | HUD 카드 · 오버레이 (Phaser 패널 알파 0.92, DOM 0.94) | `palette.UI.panel` |
| 패널 알파 (HUD) | `0.92` | HUD 아틀라스 패널 | `palette.UI.panelAlpha` |
| 패널 테두리 | `#1E3A4A` | 1px 테두리 | `palette.UI.panelBorder` |
| 강조 테두리 알파 | `0.35` | 깎은 왼위 모서리의 청록 강조 선 | `palette.UI.panelAccentAlpha` |
| 본문 | `#E2E8F0` | 글자 (패널 위 14.12:1) | `palette.UI.text` |
| 흐린 글자 | `#94A3B8` | 보조 글자 (6.79:1) | `palette.UI.textDim` |
| 아이콘 우물 | `#060C13` | 카드 실루엣 · 행동 칸 원판 | `hudArt.HC.well` |
| 꺼진 아이콘 | `#3B4B5C` | 못 쓰는 칸 (그래픽, 글자 아님) | `hudArt.HC.off` |
| 키캡 (HUD) | `#172736` | 키캡 바탕, 테두리 `#3D566B` | `hudArt.HC.keycap` |
| 밝은 빨강 (글자) | `#F87171` | 수감 · 1분 미만 · 괴물 행동 | `hudArt.HC.red` |
| 탈출 초록 (글자) | `#34D399` | 탈출 상태 · 생존자 승리 제목 | `hudArt.HC.green` |
| 메모 상자 | `#0C1620` | 벽 글씨 상자, 알파 0.85 | `hudArt.HC.note` |

### 2.3 맵 구조 (`mapArtGeom.MAP_COLOR`, 빛 속 원래 색)

시야 밖에서는 이 색 × 하한 색(rgb(76, 88, 101))이고, 테두리에만 곱하기 뒤 리프트를 더한다(3장).

| 이름 | 값 | 코드 |
|---|---|---|
| 바닥 강판 | `#17212B` | `mapArtGeom.MAP_COLOR.floor` |
| 강판 윗면 하이라이트 | `#1F2B38` | `mapArtGeom.MAP_COLOR.floorHi` |
| 강판 이음선 | `#0E151C` | `mapArtGeom.MAP_COLOR.floorSeam` |
| 4타일 큰 패널 이음선 | `#0B1117` | `mapArtGeom.MAP_COLOR.panelSeam` |
| 벽 윗면 | `#283646` | `mapArtGeom.MAP_COLOR.wallTop` |
| 벽 앞면 | `#19232F` | `mapArtGeom.MAP_COLOR.wallFront` |
| 구조 테두리 (윗면 열린 가장자리) | `#8BA3BA` | `mapArtGeom.MAP_COLOR.rim` |
| 구조 테두리 (동쪽, 어둡게) | `#6D8399` | `mapArtGeom.MAP_COLOR.rimDim` |
| 테두리 리프트 (곱하기 뒤 더함) | `#222C35` | `mapArtGeom.MAP_COLOR.rimLift` |
| 기둥 윗면 | `#2B3A4B` | `mapArtGeom.MAP_COLOR.pillarTop` |
| 기둥 받침 | `#0B1117` | `mapArtGeom.MAP_COLOR.pillarBase` |
| 네온 심 | `#7EE8FA` | `mapArtGeom.MAP_COLOR.neonCore` |
| 감옥 바닥 격자 | `#0D141B` | `mapArtGeom.MAP_COLOR.grate` |
| 철창 | `#DC2626` | `mapArtGeom.MAP_COLOR.bar` |
| 철창 심 | `#FCA5A5` | `mapArtGeom.MAP_COLOR.barCore` |
| 방폭문 문짝 | `#1C2631` | `mapArtGeom.MAP_COLOR.doorLeaf` |

빛 속 바닥은 상대휘도 0.04 이하(역할색 몸과 바닥 대비 3:1 이상: 러너 4.43 · 가드 4.12 · 스카우트 7.15 · 괴물 4.33, 흰 생존자 15.57). 바닥 톤 흔들림 ±3단계(`FLOOR_JITTER`), 시드 20261008.

### 2.4 오브젝트 (`mapArtGeom.OBJ_COLOR`)

| 이름 | 값 | 코드 |
|---|---|---|
| 거점 판정 링 | `#2FA3B8` | `mapArtGeom.OBJ_COLOR.ring` |
| 거점 패드 | `#0B4A5A` | `mapArtGeom.OBJ_COLOR.pad` |
| 꺼진 눈금 | `#1B3240` | `mapArtGeom.OBJ_COLOR.tickOff` |
| 탈출구 비활성 | `#56657A` | `mapArtGeom.OBJ_COLOR.off` |
| 탈출구 활성 · 열림 | `#10B981` | `mapArtGeom.OBJ_COLOR.go` |
| 개방 게이지 | `#34D399` | `mapArtGeom.OBJ_COLOR.gauge` |

### 2.5 대비 쌍

`palette.TEXT_PAIRS` · `GRAPHIC_PAIRS`, `hudArt.HUD_TEXT_PAIRS`가 목록이고 단위 테스트가 기준을 고정한다(R14). 계산값:

| 쌍 | 대비 | 기준 |
|---|---|---|
| 글자용 역할색 / 패널 `#0F1B27` | 러너 6.85 · 가드 6.59 · 스카우트 9.99 · 괴물 6.29 | 4.5 |
| 글자용 역할색 / 띠 `#0B1622` | 7.17 · 6.90 · 10.46 · 6.59 | 4.5 |
| 본문 · 흐린 글자 / 패널 | 14.12 · 6.79 | 4.5 |
| 경고 배너 `#0B1622` / `#F59E0B` | 8.49 (테스트가 값 고정) | 4.5 |
| 발각 배너 흰 / `#B91C1C`, 정보 배너 흰 / `#0E7490` | 6.47 · 5.36 | 4.5 |
| 부상 · 경고 주황 / 패널, 탈출 초록 / 패널, 청록 / 패널 | 8.11 · 9.05 · 9.63 | 4.5 |
| 시야 모드 노랑 / 띠, 키캡 글자 / 키캡, 쿨타임 초(흰) / 패널 | 9.50 · 12.34 · 17.41 | 4.5 |
| 메모 글자 / 메모 상자(아래가 흰색일 때) | 9.53 | 4.5 |
| 캐릭터 몸 / 외곽선 | 러너 5.46 · 가드 5.07 · 스카우트 8.81 · 괴물 5.33 · 흰 생존자 19.18 | 3 |
| 정지 칩 아이콘 / 패널 | 8.11 | 3 (아이콘) |
| 로비 · 결과 DOM 글자 (E2E 실효 대비 최저) | 로비 첫 화면 5.36 · 방 화면 5.07(비활성 버튼 `#7C8CA0`) · 결과 5.36 | 4.5 (큰 글자 3) |

### 2.6 쓰지 않는 옛 값

`render/colors.ts`의 `COLOR` · `ROLE_COLOR`는 v1 단색 도형 값(감옥 `#EF4444`, 탈출구 `#22C55E` 등)이 남아 있지만 `COLOR.background`(카메라 배경) 말고는 쓰지 않는다. 새 코드는 `palette.ts` · `mapArtGeom.ts`를 쓴다. 같은 파일의 `FOG`(3장)와 `ALPHA.badgeUnseen`(5장)은 쓰는 값이다.

---

## 3. 재질 · 조명 · 안개

### 3.1 정적 맵 (`art/mapArt.ts`, 순수 부분 `art/mapArtGeom.ts`)

시드 고정으로 한 번 굽고(배율별 캐시 2장, 로비 대기 중 미리 굽기), 매 프레임은 이미지만 그린다. 칸 채움은 기기 픽셀 정수 경계에 맞춘다.

- **바닥**: 1타일 강판(윗면 하이라이트 · 이음선 1px) + 4타일마다 큰 패널 이음선 + 시드 노이즈 + 드문 데칼(배수구 · 케이블 · 줄무늬 강판 · 저채도 사선띠). 데칼은 거점 중심 3.3타일 · 탈출구 중심 2.6타일 안에 두지 않는다
- **벽**: 칸 안 2.5D. 남쪽이 열린 칸은 아래 0.34타일이 앞면, 나머지가 윗면. 열린 쪽 가장자리에 0.075타일 테두리(빛은 왼쪽 위에서, 동쪽 테두리는 어둡게), 윗면 안쪽 덧선 · 빗금. 인접 바닥에 접촉 그림자(남쪽 0.24 · 옆 0.13타일, 알파 0.62)
- **기둥**: 판정 칸 전체가 받침이고 위에 깎은 8각 윗면(모서리 0.24) · 앞면 0.3타일 · 밝은 윗테두리
- **네온**: 0.05타일 청록 직선, 3칸 이상 이어진 벽 줄에만. 모두 벽 · 기둥 칸 안(R11)
- **감옥**: 바닥 격자 + 둥근 끝 철창(빨강 발광) + 남쪽 문 2칸. **탈출구**: 2 × 1 방폭문 + 문틀 + 상태등 + 바닥 셰브론(판정 원 안 바닥)

### 3.2 빛과 안개

| 항목 | 값 | 코드 |
|---|---|---|
| 시야 밖 밝기 하한 | `0.45` | `colors.FOG.ambient` |
| 시야 밖 틴트 (빨강을 줄여 차갑게) | `#A8C4E0` | `colors.FOG.tint` |
| 높음 경계 셰이더: 경계 띠 최대 어둡게 | `0.35` | `colors.FOG.edgeDarken` |
| 괴물 화면 자기 시야 테두리 알파 · 두께(px) | `0.6` · `2` | `colors.FOG.outlineAlpha` `colors.FOG.outlineWidth` |
| 생존자 시야 따뜻한 틴트 · 알파 | `#FFE2B8` · `0.05` | `vision.CONE_LOOK.visionTint` `vision.CONE_LOOK.visionTintAlpha` |
| 시야 경계 역할색 림 알파 · 두께(px) | `0.24` · `1.6` | `vision.CONE_LOOK.rimAlpha` `vision.CONE_LOOK.rimWidth` |

- 화면 색 = 정적 맵 × 빛 지도 (+ 테두리 리프트). 빛 지도 바탕은 하한 색이고 시야 다각형을 흰색으로 칠한다. 생존자 시야는 판정 반경 안쪽 `survivor.visionSoftEdge`(1.2타일)에서 하한으로 흐려지고(여러 시야는 최댓값 — 겹쳐도 더 밝아지지 않음), 괴물 부채꼴 · 근접 원은 판정 모양 그대로 딱 자른다
- **밝게 그린 곳 ⊆ 판정 영역**(빛 지도 해상도 경계 1텍셀 안티에일리어싱 제외). 바닥을 밝히는 빛은 시야뿐이고 시설 광원은 발광만 한다. 상대 팀 광원으로 환경을 비추지 않는다(R8)
- 실측(Canvas 1920 × 1080 배율 1): 시야 안 바닥 47.5 · 시야 밖 바닥 13.4 · 시야 밖 벽 23.4(안/밖 3.5배), WebGL GPU 경로와 ±1. 시야 밖 테두리/인접 바닥 대비: 벽 3.87 · 기둥 3.25(Canvas 낮음), 3.84 · 3.22(WebGL 높음)
- **테두리 리프트** `#222C35`: 곱하기 뒤 벽 윗면 테두리 · 기둥 윗테두리 · 탈출구 문틀에만 더한다. 시야 · 시간 · 상대와 무관한 정적 구조색이라 바닥 픽셀에는 닿지 않는다
- **시설 발광**(네온 · 철창 고리 · 단말 화면): 0.5배 해상도 발광 캔버스 하나를 모든 경로(GPU 조각 · Canvas · 미니맵)에서 정적 맵에 구워 넣는다(`static` — 따라가는 카메라부터, 예전 높음 · 중간의 ADD 이미지 `sprite`는 없앴다: 12.7). 빛 지도 곱하기 **앞**이라 어둠 속 약 30%, 빛 속 100%. 벽 · 기둥 칸 안 네온은 시야 다각형(바닥) 밖이라 시야 안에서도 하한 수준이다
- 빛 지도 해상도: 높음 16 · 중간 12 · 낮음 8 px/타일. 갱신: 생존자 화면 50ms, 괴물 화면 1/30초(33ms)마다(그 사이는 위치만 이동). 정해진 시각(시계 0부터 k × 주기)에 위상을 고정해 그 시각에 닿은 첫 프레임에 갱신한다(`render/fogMath.ts` PhaseClock, 허용 1ms): 60 · 120 · 144fps가 같은 시각에 갱신한다. 약 58fps보다 느린 프레임에서는 예전처럼 지난 갱신 프레임부터 한 주기(느린 기기에서 더 자주 다시 합성하지 않게)
- **내 빛 따라가기** (잔렉 고치기, DECISIONS 12절): 갱신 사이 프레임에는 내 시야 빛 · 틴트 · 테두리 · 괴물 부채꼴 외곽선 · 빛 속 먼지를 지금 그린 내 자리까지 옮겨 그린다(Δ = 지금 자리 − 그 갱신의 내 눈, 생존자 0.5 · 괴물 약 0.67타일 넘으면 옮기지 않음). 따라가는 카메라 아래에서 몸 둘레의 밝은 원이 1초에 20번 뒤처졌다 따라붙던 떨림을 없앤다. GPU 안개(높음 · 중간)만: 빛 지도에 내 시야를 반경 + 0.5타일로 칠하며 B 채널을 8/255 낮춰 '내 덮임'을 표시하고, 셰이더가 그 안의 내 빛을 지금 자리로 다시 계산한다(겹친 팀원 빛 아래로는 깎지 않음). 괴물 화면은 빛 지도를 통째로 옮겨 읽는다. Canvas 합성(낮음)은 예전처럼 갱신 계단. 벽 모서리의 그림자 경계는 갱신 다각형 그대로
- 합성 경로: Canvas 합성(Canvas 렌더러 · 낮음: 창 둘레 영역 Canvas2D 한 장 `multiply`, 확대 1이면 맵 전체 한 장)과 GPU 합성(WebGL 높음 · 중간: 판 전에 구운 맵 전체 그림에서 창 둘레 조각만 조각 아틀라스로 복사 · 업로드 + 작은 빛 텍스처만 갱신, 12.7). 높음은 경계 셰이더(`FogEdgePipeline`, 어둡게만 — 결과가 항상 [하한, 밝기] 안)
- 어둠 속 움직임(R9): 점령 중 스캔선 · 탈출구 활성 맥동 · 셰브론만 빛 지도에 곱해(약 35%) 시야 밖에서도 움직인다

### 3.3 부채꼴 · 범위 그림 (`render/vision.ts`)

| 항목 | 값 | 코드 |
|---|---|---|
| 생존자 화면 부채꼴 가장자리 선 알파 · 두께(px) | `0.85` · `2` | `vision.CONE_LOOK.edgeAlpha` `vision.CONE_LOOK.edgeWidth` |
| 빨강 해치 간격(타일) · 알파 · 펄스 더하기 | `0.42` · `0.2` · `0.16` | `vision.CONE_LOOK.hatchSpacing` `vision.CONE_LOOK.hatchAlpha` `vision.CONE_LOOK.hatchPulse` |
| 괴물 화면 자기 부채꼴 채움 · 근접 원 채움 | `0.11` · `0.08` | `vision.CONE_LOOK.selfFill` `vision.CONE_LOOK.nearFill` |
| 공격 준비 범위 색 · 채움 · 가장자리 | `#FFFFFF` · `0.2` · `0.85` | `vision.ATTACK_RANGE.color` `vision.ATTACK_RANGE.fill` `vision.ATTACK_RANGE.edge` |

- 생존자 화면 괴물 부채꼴: 채움 0.20 / 0.28(0장) + 가장자리 선. 빨강 상태는 조준 방향에서 45° 기운 사선 해치가 꼭짓점에서 바깥으로 0.6초에 한 칸 흐르고 펄스(`anim.ANIM.hatchPulseS`). 해치는 판정 다각형 안으로만 자른다
- 괴물 화면 자기 시야: 낮은 채움 + 부채꼴 ∪ 근접 원 합집합 경계에 노랑 60% 2px 선(빛 지도 해상도와 무관하게 판정 경계 그대로)
- 가장자리 선 · 범위 선은 접지 그림자 **위** 층(경계 근처 팀원 둘레에서 끊기지 않게), 채움 · 해치는 아래 층
- 범위는 모두 정보 항목(`InfoItem`)에서 그린다(R12): 공격 준비(부채꼴이 준비 시간에 맞춰 차오름 + 앞머리 호), 가드 밀치기 사거리 점선(능력 준비 · 괴물이 보임 · 사거리 2배 안, 막혔으면 가로막은 칸 위 ×), 구조 구역 점선(팀원 수감 중), 괴물 화면 캠핑 구역(감옥 사각형에서 `prison.campRadius`인 둥근 사각형 = 판정 모양), 포효 충격파

---

## 4. 캐릭터 · 괴물

캐릭터 스타일이 둘이다(설정 화면 그래픽 탭 '캐릭터 스타일: 새 캐릭터 / 기존', 기본 새 캐릭터 — 설정 화면 통합부터). **기존**(4.1~4.4)의 모양 원본은 `art/shapes.ts`(다각형 점 목록, 단위 = 몸 반지름 1, +x = 바라보는 방향)이고, 같은 점 목록으로 월드 텍스처(`art/atlas.ts`) · HUD 아틀라스 · 로비 인라인 SVG · 미니맵을 만든다. **새 캐릭터**(4.5)는 `art/chars/*` 그림 명령으로 월드 텍스처와 로비 · 결과 · 조작 안내 SVG를 만든다. 크기(4.1)와 문양(4.4)은 두 스타일이 같고, HUD · 미니맵 · 아바타 같은 작은 곳은 스타일과 상관없이 문양을 쓴다.

### 4.1 크기

| 항목 | 값 |
|---|---|
| 생존자 몸 반지름 (판정) | `balance.json` survivor.radius 0.3타일 → 지름 약 17.9 논리 px (1366 × 768에서 약 12.7 CSS px) |
| 괴물 몸 반지름 (판정) | monster.radius 0.35타일 |
| 생존자 앞 돌출 한도 | 기존 스타일 1.55r (`shapes.FRONT_REACH_MAX`, 모양 그대로) · 새 캐릭터 1.15r (4.5) — 역할마다 커 보이지 않게, 판정보다 커 보이지 않게 |
| 괴물 망토 | 반지름 ≈ 1(판정 반지름), 자락 끝 1.12 이내(돌진 때만 기존 1.35 · 새 캐릭터 1.15까지) |
| 외곽선 | `#05080C` 1.8 월드 px (`art/atlas.ts` ART.outlineWorldPx) |
| 접지 그림자 | 생존자 2.15r · 괴물 1.82r, 가운데 알파 0.82, 모든 생존자 공통 |
| 링 | 나 표시(흰색) 1.36r, 노출 링(역할색) 1.34r, 보호 거품 1.62r |

### 4.2 생존자 실루엣 (`shapes.SURVIVOR_SHAPES`)

같은 몸 원(반지름 1)을 공유하고 몸 가운데 0.45r 원판은 85% 이상 몸색이다(문양이 역할색 · 흰색을 가리지 않음).

| 역할 | 실루엣 | 어두운 문양 |
|---|---|---|
| 러너 | 앞이 뾰족한 물방울(끝 1.55r, 뒤는 몸 원) | 등의 » 두 줄 |
| 가드 | 몸 원 + 앞쪽 초승달 방패(반지름 1.5, 반각 1.08rad) | 등의 십자 |
| 스카우트 | 몸 원 + 앞쪽 사각 렌즈 하우징(0.6~1.44) | 렌즈 고리(0.6~0.76) + 앞 렌즈 점 |
| 괴물 화면 공통 | 몸 원 + 앞 노치(1.5) | 없음 |

- 몸: 위에서 비춘 돔 음영(가운데 원판은 역할색 그대로) + 회전하지 않는 반사광(왼쪽 위, 알파 0.3)
- 흑백 구분: 몸색 마스크(실루엣 − 어두운 문양) IoU 역할끼리 0.59~0.66, 공통 실루엣과 0.67~0.80(12.7 · 18 · 36px). 외곽만 재면 러너-공통이 0.94라 문양이 구분을 맡는다
- 생존자 화면에만 그리는 것: 부상(몸 뒤쪽 붉은 긁힘 세 줄), 질주 속도선, 나 표시 흰 링
- 괴물 화면(0장 ③): `survivor-hidden` · `foot-hidden` · `shadow-survivor` 한 벌. 음영은 무채색(`#C5CAD1`), 발 `#8B939C`. 보호 중은 알파 0.5 + 150ms 흰 테두리 깜빡임(DECISIONS D5)
- 사망: 회색 `#6B7280` → 페이드

### 4.3 괴물

위에서 본 망토: 앞은 둥근 후드, 어깨가 가장 넓고 뒤 자락은 5갈래 톱니(`shapes.CLOAK_TAILS`), 조준 쪽에 어두운 얼굴(`#1A0B0E`) + 흰 분홍 발광 눈(`#FFF1F2`, 빛 `#FB7185`), 앞 발톱 2개(`#F1E6E8`). 촉수 없음(판정이 커 보이지 않게). 몸은 조준 방향으로 돈다. 자기 빨강 부채꼴 위에서도 외곽선으로 묻히지 않는다.

### 4.4 문양 (`shapes.GLYPHS`, 정면 · 방향 없음)

러너 = » 두 줄, 가드 = 방패 + 십자, 스카우트 = 렌즈 + 사각 뷰파인더, 괴물 = 정면 후드 삼각형 + 어두운 얼굴 + 두 눈. HUD 점수판 · 조작 안내 · 로비 아바타 · 결과 표 · 괴물 화면 노출 문양이 쓴다. 노출 문양 배지는 몸 중심에서 2.35r, 반지름 0.86r(`shapes.GLYPH_PLACE`), 기본 머리 위이고 옆 몸 · 노출 링에서 0.27타일 이상 떨어진 빈 쪽(위 → 옆 → 아래)으로 옮긴다. 기절 별도 같은 방식(`shapes.starSlot`).

### 4.5 새 캐릭터 스타일 (캐릭터 리디자인, `art/chars/*` · `art/charFrames.ts`)

설정 화면 그래픽 탭 '캐릭터 스타일: 새 캐릭터 / 기존'(기본 새 캐릭터, `gfx/charStyle.ts`, 기기 저장 키 `decoy:charStyle` — 고른 값은 기본값이어도 저장하고 '기본값'으로 되돌리면 지운다, 시험 · 촬영용 주소 `?chars=new|classic`이 그 접속에 우선)으로 고른다. 그림만 바뀐다: 규칙 · 판정 · 서버 틱 · 스냅샷 · 서버로 보내는 값은 같다. 시안 · 디자인 의도는 `artifacts/characters/README.md`.

| 캐릭터 | 위에서 본 그림 (게임) | 정면 그림 (로비 · 결과 · 조작 안내) |
|---|---|---|
| 러너 | 파랑 후드티. 넓은 어깨 + 앞으로 나온 후드 머리(앞 1.50r), 후드 앞 끝 짙은 앞머리 · 밝은 챙, 등 위로 흐르는 후드 끈. 어깨 · 소매는 가늘게(가벼운 인상) | 3/4 시점(화면 오른쪽을 비스듬히), 큰 운동화, 후드 끝은 왼쪽 뒤로 |
| 가드 | 몸 앞의 두꺼운 방패 호 + 헬멧 | 큰 방패 + 헬멧, 단단한 체격 |
| 스카우트 | 렌즈 고글 고리 + 한 손의 짧은 망원경(가장 먼 점 1.39r) + 어깨 안테나 | 렌즈 고글 · 망원경(오른손) · 안테나 |
| 괴물 화면 공통 생존자 | 흰 방호복 · 둥근 두건 + 짙은 가리개 + 앞으로 나온 둥근 필터 덮개. 무채색만 | 방독면 (UI에서 쓰지 않는다) |
| 괴물 | 앞은 매끈한 두건 + 짙은 얼굴 그늘 속 실눈 빛 · 짙은 손등의 흰 발톱, 어깨가 가장 넓고 뒤는 톱니 자락 5갈래. 뿔 · 이빨 없음 | 거의 검은 깊은 두건 속 V 실눈, 붉은 림, 작은 발톱 |

- **크기**: 판정보다 눈에 띄게 커 보이지 않게 **최대 1.15배**(따라가는 카메라 3단계, 사용자 요청) — 생존자 앞 ±60° 안 1.15r · 옆 1.05r · 뒤 1.0r, 괴물 모든 자세 1.12r · 돌진 1.15r(`art/chars/measure.ts` SIZE_RULE, 굽는 모든 프레임을 단위 시험이 잰다). 위 그림은 `chars/index.ts`가 반지름을 다듬어 내보낸다: 몸 둘레(생존자 0.95r · 괴물 1.05r) 안은 그대로, 밖은 기울기 1로 이어져 1.15r에 부드럽게 다가가게(`kit.squeezeDrawing`) — 앞 돌출(후드 · 방패 · 망원경 · 필터 · 발톱 · 돌진 자락)이 몸 쪽으로 당겨져 머리 · 장비가 어깨에 붙은 굵은 실루엣이 된다. 당기면 실루엣이 둥글어져 서로 닮으므로(0장 ④) 다듬기 전 옆 폭을 러너 0.94배 · 괴물 화면 공통 생존자 0.9배로 줄인다(`chars.TOP_WIDTH`). 새 스타일 돌진은 그림이 이미 늘어난 자세라 몸을 더 늘이지 않는다(기존은 ×1.096). 정면 그림(로비 · 결과)은 그대로
- **색**: 몸 가운데는 역할색, 외곽선 `#05080C` 1.8 월드 px(기존과 같은 두께). 실제 크기에서 몸 가운데 원판(0.45r)이 기존 역할색 원판만큼 밝다 — 가드 헬멧 · 러너 몸판은 둘레 음영 · 짙은 챙이 번지는 몫만큼 한 단 밝게 칠한다(0장 ② 몸/바깥 링 3:1, 두 스타일 E2E). 공통 생존자는 무채색만(색 폭 20/255 이하). 청록 네온은 정면 그림 생존자 셋의 옷 · 장비에만(1.2 예외)
- **작은 곳은 문양**: HUD 팀 칸 · 점수판 · 플레이어 목록 · 로비 아바타 · 결과 표 · 미니맵 · 괴물 화면 능력 노출 문양 · 기절 별은 스타일과 상관없이 4.4 문양 그대로(사용자 결정 6)

**새 캐릭터 재질 색** (코드로 그리는 그림의 바탕 색. 그늘 · 밝은 면 · 그라디언트는 이 색과 역할색 · 외곽선을 섞어 만든다 — `art/chars/kit.ts` shade · tint · mix. 눈 · 렌즈 반짝임은 흰색)

| 재질 | 값 | 코드 |
|---|---|---|
| 피부 · 피부 그늘 · 정면 눈 | `#D9A27E` · `#A8725A` · `#101820` | `chars.MAT.skin` `chars.MAT.skinShade` `chars.MAT.eye` |
| 사망 회색 (4.3과 같다) | `#6B7280` | `chars.DEAD_GRAY` |
| 러너 후드티(역할색) · 그늘 · 위 그림 챙 띠 | `#3B82F6` · `#1E3A8A` · `#60A5FA` | `chars.RUNNER_COLOR.hoodie` `chars.RUNNER_COLOR.deep` `chars.RUNNER_COLOR.neon` |
| 러너 바지 · 신발 · 밑창 · 장갑 · 머리 | `#253041` · `#2B3646` · `#CBD5E1` · `#334155` · `#1B2430` | `chars.RUNNER_COLOR.pants` `chars.RUNNER_COLOR.shoe` `chars.RUNNER_COLOR.sole` `chars.RUNNER_COLOR.glove` `chars.RUNNER_COLOR.hair` |
| 가드 갑옷(역할색) · 그늘 · 방패 테 (글자용 역할색) | `#A855F7` · `#581C87` · `#C084FC` | `chars.GUARD_COLOR.armor` `chars.GUARD_COLOR.deep` `chars.GUARD_COLOR.neon` |
| 가드 금속 · 바지 · 장화 · 밑창 · 장갑 | `#2B3646` · `#253041` · `#1B2430` · `#0F151D` · `#444E5C` | `chars.GUARD_COLOR.steel` `chars.GUARD_COLOR.pants` `chars.GUARD_COLOR.boot` `chars.GUARD_COLOR.sole` `chars.GUARD_COLOR.glove` |
| 스카우트 재킷(역할색) · 그늘 · 렌즈 빛 (글자용 역할색) · 정면 재킷 | `#22C55E` · `#14532D` · `#4ADE80` · `#1DA750` | `chars.SCOUT_COLOR.jacket` `chars.SCOUT_COLOR.deep` `chars.SCOUT_COLOR.neon` `chars.SCOUT_COLOR.coat` |
| 스카우트 금속 · 어두운 금속 · 정면 배낭 · 위 그림 배낭 · 고글 끈 | `#94A79B` · `#2B3646` · `#136C34` · `#157A3A` · `#147237` | `chars.SCOUT_COLOR.steel` `chars.SCOUT_COLOR.gunmetal` `chars.SCOUT_COLOR.pack` `chars.SCOUT_COLOR.packTop` `chars.SCOUT_COLOR.band` |
| 스카우트 끈 · 바지 · 장화 · 밑창 · 장갑 · 위 그림 장갑 · 머리 · 입 | `#1B2430` · `#253041` · `#2B3646` · `#0F151D` · `#178640` · `#1DA750` · `#1B2430` · `#5B2A22` | `chars.SCOUT_COLOR.strap` `chars.SCOUT_COLOR.pants` `chars.SCOUT_COLOR.boot` `chars.SCOUT_COLOR.sole` `chars.SCOUT_COLOR.glove` `chars.SCOUT_COLOR.gloveTop` `chars.SCOUT_COLOR.hair` `chars.SCOUT_COLOR.mouth` |
| 공통 생존자 방호복(0.1 숨은 생존자 흰색) · 테 · 장갑 · 장화 · 밑창 | `#F8FAFC` · `#C5CAD1` · `#D3D8DE` · `#B7BEC6` · `#5B636C` | `chars.COMMON_COLOR.suit` `chars.COMMON_COLOR.rim` `chars.COMMON_COLOR.glove` `chars.COMMON_COLOR.boot` `chars.COMMON_COLOR.sole` |
| 공통 생존자 가리개 · 짙은 가리개 · 가리개 유리 · 솔기 | `#9AA3AD` · `#3A4048` · `#5B636C` · `#AEB5BD` | `chars.COMMON_COLOR.visor` `chars.COMMON_COLOR.visorDark` `chars.COMMON_COLOR.visorGlass` `chars.COMMON_COLOR.seam` |
| 괴물 두건(역할색) · 망토 · 깊은 망토 · 소매 | `#EF4444` · `#9E2D2D` · `#5A1219` · `#732121` | `chars.MONSTER_COLOR.hood` `chars.MONSTER_COLOR.cloak` `chars.MONSTER_COLOR.cloakDeep` `chars.MONSTER_COLOR.sleeve` |
| 괴물 뼈 · 뼈 그늘 · 손 · 얼굴 · 가장 깊은 그늘 | `#F1E6E8` · `#B59EA3` · `#2A0E12` · `#1A0B0E` · `#070203` | `chars.MONSTER_COLOR.bone` `chars.MONSTER_COLOR.boneShade` `chars.MONSTER_COLOR.hand` `chars.MONSTER_COLOR.face` `chars.MONSTER_COLOR.void` |
| 괴물 눈 · 눈빛 · 림 (글자용 역할색) | `#FFF1F2` · `#FB7185` · `#F87171` | `chars.MONSTER_COLOR.eye` `chars.MONSTER_COLOR.eyeGlow` `chars.MONSTER_COLOR.neon` |

**월드 텍스처** (`art/atlas.ts` bakeAtlas, `style: 'new'`): 고른 스타일 한 장만 굽는다(로비 대기 중 미리 굽기, 판 중 배율이 바뀌면 다시). 자세마다 한 칸이고, 앞이 긴 그림이라 직사각 칸(생존자 x −1.08~1.22 · y ±1.12, 괴물 x · y ±1.22 · ±1.2 — 1.15배 기준에 맞춰 줄였다)에 굽고 칸 안 중심을 Phaser 프레임 pivot으로 둔다(새 텍스처는 모든 프레임에 pivot). 쉬는 자세는 옛 이름 그대로(`survivor-hidden` · `survivor-runner` · `monster-idle-0` …), 자세 프레임은 옛 이름 + `~` 꼬리표(`survivor-hidden~w3`). 그림자 · 나 표시 링 · 노출 링 · 문양 · 거품 · 먼지는 기존 그림 그대로 굽고, 새 그림 안에 있는 옛 부품(발 · 윤기 · 발톱 · 눈 · 눈빛)은 빈 칸 하나를 가리켜 알파 0으로 둔다 — 캐릭터마다 이미지 2장(그림자 + 몸). 텍셀 밀도 = 확대 × 배율, 품질별 상한(높음 4 · 중간 3 · 낮음 2 텍셀 / 월드 px): 확대 3 품질 높음 1920×1080@2에서 약 7.32MiB, 전체 텍스처 30.23MiB(예산 32MiB, PERF.md 4.4 — 확대 1 · 배율 2 시절 값은 PERF 4.3: 1.74MiB · 30.98MiB)

| 대상 | 프레임 |
|---|---|
| 역할 셋 (생존자 화면) | 쉬기 · 걷기 8 · 능력 서기(러너 질주 · 스카우트 탐지 1, 가드 밀치기 0.5 · 1) · 러너 질주 걷기 8 · 수감 1 + 수감 걷기 4 · 구조 1 · 피격 젖힘 1 + 그 흰 실루엣 1 · 쉬기 흰 실루엣 1 · 사망 회색 1 (러너 28 · 가드 21 · 스카우트 20) |
| 공통 생존자 (괴물 화면) | 쉬기 · 걷기 8 · 흰 실루엣 1 (10). 수감 자세 없음(0장 ③) |
| 괴물 | 대기 망토 8 · 걷기 8(걷기 위상 = 망토 위상) · 돌진 · 기절 · 공격 준비 · 타격 · 포효 각 1 (21). 눈 깜빡임 없음(눈빛은 그림 안) |

고르기는 미리 만든 이름 표에서(프레임마다 문자열을 만들지 않는다). 생존자 우선순위: 사망 회색 > 피격 > 수감 > 구조 > 능력 > 걷기 > 쉬기, 괴물: 기절 > 돌진 > 타격 > 공격 준비 > 포효 > 망토. 능력 · 타격 · 포효는 서버 이벤트(`ability` · `attackHit` · `roar` · `roarPings`)를 받은 순간부터의 장식 길이다. 괴물 화면 생존자는 0장 ③.

| 항목 | 값 | 코드 |
|---|---|---|
| 걷기 한 주기 프레임 (품질 낮음은 짝수 칸 4) | `8` | `charFrames.WALK_FRAMES` |
| 수감 중 걷기 프레임 | `4` | `charFrames.CAPTIVE_WALK_FRAMES` |
| 괴물 망토 프레임 (대기 · 걷기 각각) | `8` | `charFrames.CLOAK_FRAMES` |
| 이 걷기 세기를 넘으면 걷기 프레임 | `0.3` | `charFrames.STEP_MIN` |
| 피격 젖힘 (ms, 흰 번쩍 80ms보다 길게) | `220` | `charFrames.NEW_POSE_MS.hit` |
| 괴물 타격 (ms, 베기 호와 같음) | `120` | `charFrames.NEW_POSE_MS.strike` |
| 괴물 포효 (ms) | `650` | `charFrames.NEW_POSE_MS.roar` |
| 가드 밀치기 (ms, 앞 30%는 반쯤 민 자세) | `380` | `charFrames.NEW_POSE_MS.shove` |
| 스카우트 탐지 (ms) | `600` | `charFrames.NEW_POSE_MS.scan` |
| 생존자 칸 상자 앞 · 뒤 · 옆 (몸 반지름 배수) | `1.22` · `-1.08` · `1.12` | `charFrames.SURVIVOR_BOX.x1` `charFrames.SURVIVOR_BOX.x0` `charFrames.SURVIVOR_BOX.y1` |
| 괴물 칸 상자 앞 · 뒤 · 옆 | `1.22` · `-1.22` · `1.2` | `charFrames.MONSTER_BOX.x1` `charFrames.MONSTER_BOX.x0` `charFrames.MONSTER_BOX.y1` |

**성능**: 새 스타일도 일의 양 예산(렌더링 최적화) 기준값 안이다 — 캐릭터마다 이미지가 5장에서 2장으로 줄어 Canvas `drawImage`가 프레임당 236 → 226(생존자 화면), WebGL 그리기 호출은 같다(`tests/e2e/perf-budget.spec.ts` · `tests/e2e/perf-budget.webgl.spec.ts`의 `-new` 장면: 새 스타일 실측 기준값과 짝 기존 장면 기준값을 함께 넘지 않는다). 굽는 시간은 이 컨테이너에서 약 90ms(기존 약 6ms)라 로비에서 미리 굽는다. 첫 화면(부팅 직후) · 봇과 연습 고르기에서도 빌드에 넣은 수치의 반지름으로 굽는다(연습은 고르자마자 판이 시작돼 로비 대기가 없다). 판 중에 배율이 바뀌면(자동 품질 하향 · 되돌림, 창 크기 · 회전) 다시 굽지만, 그림 명령은 기억해 둔 것(`charFrames.DrawingMemo`, 외곽선 두께가 반지름만의 함수라 배율과 무관)을 쓰고 래스터만 한다.
- 시험: `tests/e2e/char-style.spec.ts` 「새 캐릭터: 봇과 연습 고르기 화면에서 미리 굽고(판 시작 전에 새 아틀라스), 판 중 창 크기가 바뀌어 다시 구워도 그림 명령은 다시 만들지 않는다」

- 시험: `tests/unit/char-frames.test.ts` 「리그가 쓰는 옛 이름이 새 스타일 텍스처에 모두 있다 (없는 프레임 경고 방지)」 · 「모든 프레임 그림이 굽기 상자 안에 든다 (직사각 칸이 그림을 자르지 않게)」 · 「굽는 모든 자세가 크기 기준 안 (생존자 앞 1.15r · 옆 1.05r · 뒤 1.0r, 괴물 1.12r · 돌진 1.15r)」
- `tests/e2e/m10-fog.webgl.spec.ts` 「새 캐릭터 스타일 · 품질 높음 1920×1080@2: 자세별 캐릭터 아틀라스를 더해도 텍스처 메모리가 예산(32MB) 이하이고 콘솔이 깨끗하다」

### 4.6 의상 (메타 c, `art/chars/costume/*` — 나눠 받는 조각 `art`)

의상은 새 캐릭터 그림에 얹는 모양 장식이다(`GAME_DESIGN.md` 12.5). 역할 그림의 의상 자리(생존자 `topBack` · `topOver` · `frontBehind` · `frontTorso` · `frontNeck`, 괴물 `topCloak` · `topHead` · `frontCloak` · `frontMantle` · `frontHood` · `frontOver`)에 그리고, 기존 캐릭터 스타일 · 괴물 화면 공통 생존자에는 없다.

- **바꾸지 않는 것**: 크기 기준(4.5 — 생존자 앞 1.15r · 옆 1.05r · 뒤 1.0r, 괴물 1.12r · 돌진 1.15r), 몸 가운데 0.45r 원판은 역할색, 역할 실루엣 겹침(역할끼리 0.80 · 공통 생존자와 0.85 이하 — `scripts/char-art/costume-iou.ts`), 위 그림(게임 화면)에 청록 없음, 괴물은 뿔 · 이빨 · 가시 없음, 모든 색은 `ink()`(사망 회색 · 피격 번쩍 톤)를 거친다
- **등 의상은 크기 대신 밝기 · 대비로** 기본과 가른다(사용자 결정): 망토는 짙은 천 + 접어 올린 밝은 안감 띠, 배낭은 밝은 덮개 네모, 목도리는 머리 뒤 크림 초승달
- **괴물 의상은 생존자 화면에서 보이는 정도가 기본과 같다**(사용자 결정 '꾸미기는 유불리가 없다'): 같은 자세 · 크기(몸 지름 18 · 36px) · 방향의 기본 괴물 위 그림과 견줘 보이는 면적 ±2%, 바닥(`MAP_COLOR.floor`) 위 평균 밝기 ±5%, 외곽선 안쪽 띠(외곽 대비) ±5% — 안개 · 어둠은 빛 지도를 곱하므로 비율이 같으면 어둠 속에서도 같다(`tests/unit/costume-parity.test.ts`, Node 래스터 `measure.ts drawingRaster`). 그래서 위 그림의 깃 · 사슬은 망토와 같은 돔 음영을 따른다(검은 깃 · 짙은 쇠로 몸이 어둡게 꺼지지 않게)

| 의상 (값) | 위 그림 (게임 화면) | 정면 그림 (로비 · 결과 · 옷장) | 주요 색 |
|---|---|---|---|
| 목도리 (150) | 머리 뒤 크림 깃 + 옆 매듭 + 등 위로 흐르는 꼬리(걸음마다 S자) | 목에 두 번 감은 두 단 + 매듭 + 긴 꼬리 · 술(끝단 청록 실 한 줄) | 크림 `#EDE0C8`, 줄 = 역할색 38% 어둡게 |
| 탈출 배낭 (250) | 등의 밝은 덮개 네모 + 머리 쪽 침낭 원통 + 버클 · 주머니(스카우트는 원래 배낭 대신) | 어깨 밖으로 나오는 큰 배낭 + 머리 뒤 침낭 + 가슴 멜빵 | 카키 `#7C6A4F` · 덮개 `#A08B66` · 침낭 `#64748B` · 버클 `#CBD5E1` |
| 망토 (400) | 짙은 천(역할색 64% 어둡게) + 접어 올린 밝은 안감 띠(역할색 45~66% 밝게, 뒤 가운데 0.24~0.27r) + 어깨 띠 · 사슬 | 양옆 자락 + 어깨 망토 + 목 앞 쇠 걸쇠(청록 보석) | 러너 천 `#152F59` · 안감 `#A7C7FB`, 가드 `#3C1F59` · `#D8B3FB`, 스카우트 `#0C4722` · `#9CE5B7` |
| 긴 고깔 (150) | 두건 뒤에서 등 위로 흘러내려 끝이 굽는 천 꼬리(좁은 한 겹 그늘) | 꼭대기가 길게 자라 한쪽으로 꺾여 늘어진 고깔 | 꼬리 `#F26969` → `#E54141`, 그늘 `#3F0D12` |
| 까마귀 깃 (250) | 어깨를 두른 말굽 모양 깃 두 줄 — 망토와 같은 돔 음영의 진홍 깃 + 끝 광택 · 깃대 | 거의 검은 깃 세 줄 + 진홍 광택 · 붉은 림 | 위 `#F34C5E` · 광택 `#FFB3BA`, 정면 `#1A0B0E` · 광택 `#7F1D1D` |
| 사슬 (400) | 목 쇠고리 + 왼어깨에서 등을 비스듬히 가로지르는 사슬(끊긴 끝이 끌린다) — 쇠도 돔 음영(목 · 등 은빛, 자락 끝 어둡게) | 가슴을 가로지르는 사슬 + 쇠고리 리벳 + 두 손목 족쇄 | 쇠 `#4B5563` · 짙은 쇠 `#1F2937` · 빛 `#9CA3AF` |

**굽기**: 판 시작 명단에 나온 의상만, 그 역할 프레임과 같은 이름 · 같은 칸 · 같은 상자로 다시 그린다(텍스처 크기 그대로). 판 중에는 바뀐 칸을 프레임마다 4ms씩 나눠 그리고 한 번에 올린다(`atlas.ts` `RECOSTUME_STEP_MS`). 시안 · 비교 그림: `artifacts/characters/costumes/`(`node scripts/char-art.mjs costumes`).

---

## 5. 오브젝트

반경은 모두 `balance.json`에서 읽어 안개 주기마다 동적 레이어에 그린다(거점 패드 · 판정 원 · 눈금, 탈출구 원호). 장식 시간은 `mapArtGeom.OBJ`.

### 5.1 거점

| 항목 | 값 | 코드 |
|---|---|---|
| 판정 원 반지름 | `capturePoint.radius` 2.5타일 | |
| 바깥 눈금 수 | `24` | `mapArtGeom.OBJ.ticks` |
| 스캔선 한 바퀴(ms) | `2400` | `mapArtGeom.OBJ.scanMs` |
| 배지 자리: 패드 중심에서 위로(타일) | `-1.62` | `mapArtBadges.BADGE.pointDy` |
| 마름모 반 대각선(타일) | `0.42` | `mapArtBadges.BADGE.pointHalf` |
| 괴물 화면 점령 중 깜빡임 알파 | `0.25` | `mapArtBadges.BADGE.blinkAlpha` |

- 원형 패드 + 판정 원 + 24칸 눈금(진행만큼 시계 방향 점등) + 가운데 해독 단말 + 바닥 마름모
- 상태: 대기(흐린 글자 색, 칩 없음) · 점령 중(청록 + ▶ 칩 + 회전 스캔선) · 정지(주황 눈금 + ‖ 칩) · 완료(전부 점등 + ✓ 칩)
- 배지(마름모 + A/B + 상태 칩)는 패드 위쪽 가장자리에 두어 가운데 단말 · 서 있는 캐릭터를 비운다. 괴물 화면은 점령 중 0.5초 간격으로 깜빡인다

### 5.2 탈출구

| 항목 | 값 | 코드 |
|---|---|---|
| 판정 원 반지름 | `exit.radius` 1.5타일 (바닥 쪽 원호만) | |
| 활성 맥동 주기(ms) | `1400` | `mapArtGeom.OBJ.exitPulseMs` |
| 셰브론 차례 점등(ms) | `900` | `mapArtGeom.OBJ.chaseMs` |
| 문 열림 미닫이(ms, 장식) | `600` | `mapArtGeom.OBJ.doorSlideMs` |
| 개방 게이지 칸 수 | `8` | `mapArtGeom.OBJ.doorSegments` |

- 비활성 = 회색 소등, 활성 = 초록 띠 맥동 + 셰브론 점등, 개방 진행 = 문 칸 분할 게이지(**생존자 화면만** — 서버가 생존자에게만 보내는 값), 열림 = 미닫이 + 초록 빛 번짐. 장식 시계가 멈춰 있어도 실제 시간이 미닫이 시간을 넘으면 다 열린 모습
- 표지판(달리는 사람)은 문 오른쪽 문틀 칸(문짝 · 미닫이를 가리지 않게)

### 5.3 감옥

철창 고리 + 남쪽 문 2칸, 자물쇠 배지는 남쪽 문 칸 가운데(수감자가 서는 안쪽을 덮지 않음). 구조 진행은 구조자 발밑 청록 진행 링(`render/characters.ts` drawRescueRing, 규칙 시간 `prison.rescueTime`).

### 5.4 배지 공통

- 배지 그래픽 · A/B 글자는 **캐릭터 아래 레이어**(R15). 정보 레이어 좌표는 판정 중심 그대로
- 지금 안 보이는 곳의 배지는 알파 0.45(`colors.ALPHA.badgeUnseen`). 알파는 어두운 바닥색 `#070B11`에 미리 섞은 불투명 색으로 그린다(선이 겹친 곳이 진해지지 않게)
- 배지마다 작은 캔버스에 기기 픽셀 1:1로 굽고 상태 · 알파 · 배율이 바뀔 때만 다시 굽는다(Graphics 명령 0)

---

## 6. 애니메이션

규칙 시간은 `balance.json`에서 읽고(호출하는 쪽이 넘김), 장식 시간만 그래픽 상수(`anim.ANIM`, `mapArtGeom.OBJ`)다. 장식은 `gfxNow` 시계, 몸 자체를 바꾸는 연출(피격 번쩍 · 수감 뒤 나타남 · 탈출 · 사망 페이드)은 실제 시계를 쓴다. **품질 낮음**은 장식 시계를 15Hz로 끊고 망토 8 → 4프레임, 걷기 위상 4단계다(R10: 정보 표시는 같음).

### 6.1 장식 상수

| 항목 | 값 | 코드 |
|---|---|---|
| 숨쉬기 주기(초) · 크기 | `2.6` · `0.016` | `anim.ANIM.breathPeriodS` `anim.ANIM.breathAmp` |
| 걷기 한 주기 거리(타일, 이동 거리로 위상) | `1.1` | `anim.ANIM.strideTiles` |
| 걷기 기울기(도) | `4` | `anim.ANIM.leanDeg` |
| 피격 흰 번쩍 · 찌그러짐(ms) | `80` · `120` | `anim.ANIM.hitFlashMs` `anim.ANIM.squashMs` |
| 수감 흩어짐 · 감옥에서 나타남(ms) | `300` · `300` | `anim.ANIM.imprisonDissolveMs` `anim.ANIM.imprisonAppearMs` |
| 탈출 페이드(ms) | `400` | `anim.ANIM.escapeFadeMs` |
| 사망 회색 · 페이드(ms) | `100` · `300` | `anim.ANIM.deathGrayMs` `anim.ANIM.deathFadeMs` |
| 괴물 베기 호(ms) | `120` | `anim.ANIM.slashMs` |
| 망토 물결 주기 대기 · 걷기(초) | `1.9` · `0.75` | `anim.ANIM.cloakIdlePeriodS` `anim.ANIM.cloakWalkPeriodS` |
| 망토 프레임 수 (낮음은 절반) | `8` | `anim.ANIM.cloakFrames` |
| 눈 깜빡임 주기(초) · 감는 시간(ms) | `3.4` · `130` | `anim.ANIM.blinkPeriodS` `anim.ANIM.blinkMs` |
| 빨강 부채꼴 해치 펄스(초) | `0.6` | `anim.ANIM.hatchPulseS` |
| 보호 깜빡임 간격(ms) | `150` | `anim.ANIM.protectBlinkMs` |
| 걷기 판단(60fps 한 프레임 동안의 거리, 타일 — 시간당 빠르기로 비교) · 걷기 자세 섞기 · 멈춤 자세로(ms) | `0.002` · `120` · `160` | `anim.ANIM.walkEpsilon` `anim.ANIM.stepInMs` `anim.ANIM.stepOutMs` |

장식 연출은 프레임 수와 무관하다(렌더링 최적화): 보간 · 자세 섞기 · 부채꼴 색은 실제 시간(Phaser rawDelta, 바뀐 순간부터)으로, 연출 시작 시각은 처음 그린 프레임이 아니라 받은 이벤트 · 스냅샷 · 보간 표본 경계 시각으로, 걷기 위상은 보간 경로를 표본 시각에서 나눈 거리로 잰다. 60fps 모양은 그대로이고 120fps에서도 같은 시각에 같은 값이다(`tests/e2e/frame-independence.spec.ts`)

### 6.2 연출 표

| 연출 | 시간 | 시간 출처 | 누구 화면 | 품질 낮음 |
|---|---|---|---|---|
| 부채꼴 노랑 ↔ 빨강 | 0.1초 / 해제 0.4초 | 고정 (0장 ⑥, `fogMath.ts` nextConeRed) | 생존자 | 같음 |
| 시야 모드 전환 (부채꼴 각도 · 길이) | 0.4초 | `monster.visionModeSwitchTime` | 양쪽 | 같음 |
| 공격 준비 (발톱 들기 + 범위가 0 → 100% 차오름) | 0.4초 | `monster.attack.windup` | 양쪽 | 같음 (느린 기기는 받은 뒤 한 번은 다 찬 모습) |
| 타격 베기 호 | 120ms | 장식 | 보이는 화면 | 같음 |
| 돌진 늘어남 + 잔상 + 붉은 줄 | 0.25초 | `monster.dash.duration` | 보이는 화면 | 같음 (출처가 사라지면 즉시 제거) |
| 기절 (눈 ×, 별 회전, 자락 처짐 / 괴물 화면 회색 막) | 1.5초 | `roles.guard.stunDuration` (서버 상태) | 양쪽 | 같음 |
| 포효 충격파 (괴물 화면, 반경까지 한 번) | 0.6초 | 장식 (범위 표시, R5 예외) | 괴물 | 같음 |
| 포효 핑: 드러난 생존자 자리 흰 원 펄스 | 1.5초 | `monster.roar.revealDuration` | 괴물 | 같음 |
| 포효한 괴물 위치 주황 경고 마커 | 1초 | `monster.roar.selfRevealDuration` (서버가 그동안 위치를 보냄) | 생존자 | 같음 |
| 스카우트 탐지: 괴물 위치 초록 마름모 + 조준선 + 펄스 | 4초 | `roles.scout.trackDuration` | 생존자 | 같음 |
| 능력 노출 (괴물 화면 역할색 링 + 문양) | 1초 | `survivor.abilityRevealDuration` | 괴물 | 같음 |
| 질주 속도선 | 3초 | `roles.runner.sprintDuration` | 생존자 | 같음 |
| 보호 거품 + 반투명 + 깜빡임 | 4초 | `survivor.rescueProtection` | 양쪽 (괴물 화면은 흰색) | 같음 |
| 구조 진행 링 · 자물쇠 | 3초 | `prison.rescueTime` | 양쪽 | 같음 |
| 탈출구 개방 진행 | 3초 | `exit.openTime` | 생존자 | 같음 |
| 숨쉬기 · 걷기 · 망토 물결 · 눈 깜빡임 | 6.1 표 | 장식 | 보이는 화면 | 15Hz · 망토 4프레임 · 걷기 4단계 |
| 점령 스캔선 · 탈출구 맥동 · 셰브론 | 2.4초 · 1.4초 · 0.9초 | 장식 | 양쪽 | 같음 |
| 점령 중 거점 배지 · HUD 게이지 깜빡임 | 0.5초 간격 | 장식 | 괴물 | 같음 |
| 피격 붉은 가장자리 · 수감 페이드 · 발각 테두리 | 7.2 표 | | | |

---

## 7. 효과 · 품질별 상한

### 7.1 입자 · 이벤트 효과 (`art/fx.ts`)

| 항목 | 값 | 코드 |
|---|---|---|
| 장식 입자 알파 상한 (R4) | `0.2` | `fx.FX_LIMITS.decorAlphaMax` |
| 장식 입자 크기 상한(px) | `2` | `fx.FX_LIMITS.decorSizeMaxPx` |
| 이벤트 효과 수명 상한(초, R5) | `0.4` | `fx.FX_LIMITS.eventLifeMaxS` |
| 빛 속 먼지 개수 높음 · 중간 · 낮음 | `40` · `15` · `0` | `fx.FX_LIMITS.dust.high` `fx.FX_LIMITS.dust.medium` `fx.FX_LIMITS.dust.low` |
| 빛 속 먼지 알파 · 크기(px) | `0.12` · `1.4` | `fx.DUST.alpha` `fx.DUST.sizePx` |

| 효과 | 수명 | 알파 | 개수 | 비고 |
|---|---|---|---|---|
| 피격 불꽃 | 0.2초 | 1 | 6 | 몸 가장자리 밖으로, 따뜻한 흰색 → 주황 |
| 수감 흩어짐 | 0.3초 | 0.9 | 14 | 빨강. 괴물 화면은 같은 순간 타격 부채꼴 안에서 사라진 생존자 자리만(없으면 생략) |
| 발먼지 (장식) | 0.3초 | 0.16 | 2 | 무채색, 높음 · 중간만. 괴물 화면 생존자 모두 같은 값 |
| 밀치기 충격파 · 기절 충격 | 0.35초 · 0.3초 | 0.75 · 0.7 | 1 | 가드가 안 보이면 괴물 몸 중심에서 방향 없이 |
| 탐지 셔터 | 0.3초 | 0.8 | 1 | |
| 베기 호 | 0.12초 | 0.95 | 1 | |
| 빛 속 먼지 (장식) | 4~7초 주기 | 0.12 | 품질별 | 자기 팀 시야(판정 다각형) 안에만, 시계와 시드 해시로만 움직임, 그림 묶음 'mote' 이미지 |

### 7.2 화면 효과

| 효과 | 값 | 파일 |
|---|---|---|
| 피격 붉은 가장자리 | 0.2초, `#DC2626` 7겹 × 11px | `render/effects.ts` HIT_FLASH_MS |
| 수감 페이드 (검정에서 밝아짐) | 0.5초 | `render/effects.ts` IMPRISON_FADE_MS |
| 기절 회색 막 (괴물 화면) | `#4B5563` 알파 0.38, 맵 바로 위 · 배지와 캐릭터 아래, 두 렌더러 같음 | `render/effects.ts` STUN_VEIL |
| 발각 빛 테두리 | 3px 선 + 42px 안쪽 빛, 1.2Hz 맥동(알파 0.6~1), 깊이 38(HUD 아래) | `render/prefsFx.ts` SPOTTED_EDGE · `scenes/GameScene.ts` · HUD 아틀라스 'spot' |
| 피격 붉은 가장자리 (번쩍임 줄이기) | 길이는 같은 0.2초, 0.06초에 걸쳐 0.35배까지 오른 뒤 사라진다(맞은 순간 확 켜지지 않는다) | `render/prefsFx.ts` HIT_FLASH_REDUCED |
| 발각 빛 테두리 (번쩍임 줄이기) | 맥동 없이 알파 0.9 고정(맥동 평균 0.8보다 진하게 — 발각 정보가 흐려지지 않게) | `render/prefsFx.ts` SPOTTED_EDGE.steady |
| 잘라 옮김 (번쩍임 줄이기) | 먼 이동 · 관전 전환에 어두워졌다 밝아지는 것 없이 바로 옮긴다 | `render/cameraDirector.ts` noDip |

- **번쩍임 줄이기**(설정 화면 탭)는 장식만 바꾼다: 정보를 담은 깜빡임(점령 중인 거점의 1Hz 깜빡임 — 미니맵 · 게이지 · 화면 밖 화살표 · 배지, 탈출구 램프 맥동)은 그대로다(0장 ⑤)

| 항목 | 값 | 코드 |
|---|---|---|
| 번쩍임 줄이기 피격 가장자리 세기 · 오르는 시간 (ms) | `0.35` · `60` | `prefsFx.HIT_FLASH_REDUCED.peak` `prefsFx.HIT_FLASH_REDUCED.riseMs` |
| 발각 테두리 맥동 (Hz) · 가운데 · 폭 · 줄이기 고정 알파 | `1.2` · `0.8` · `0.2` · `0.9` | `prefsFx.SPOTTED_EDGE.pulseHz` `prefsFx.SPOTTED_EDGE.mid` `prefsFx.SPOTTED_EDGE.swing` `prefsFx.SPOTTED_EDGE.steady` |
| 돌진 잔상 | 1/30초(33ms)마다 하나 — 돌진 시작부터 시간 격자(60fps 두 프레임마다, 예전 '28ms 넘게 지난 프레임'과 60fps에서 같다), 수명 `monster.dash.duration` | `art/fx.ts` DashTrail |

### 7.3 품질 단계 (`gfx/presets.ts`)

| 항목 | 높음 | 중간 | 낮음 |
|---|---|---|---|
| 기기 픽셀 배율 · 픽셀 수 상한 | 2배 · 3840 × 2160 | 1.5배 · 2560 × 1440 | 1배 · 1920 × 1080 (터치 기기 1.25배 · 1.2MP, 백버퍼 높이 하한 450px — 하한이 올리는 배율은 1.5배까지) |
| 바닥 합성 배율 상한 | 2 | 1.5 | 1 |
| 빛 지도 (px/타일) | 16 | 12 | 8 |
| 안개 | GPU 합성 + 경계 셰이더 | GPU 합성 | Canvas 합성 |
| 시설 발광 | static (정적 맵에 구움) | static | static |
| 비네트 | postFX (WebGL) | 구운 오버레이 | 없음 |
| 색보정 | 켬 | 켬 | 끔 |
| 블룸 | 끔 (실측해서 감당될 때만) | 끔 | 끔 |
| 파티클 동시 상한 · 빛 속 먼지 | 400 · 40 | 150 · 15 | 40 · 0 |
| 발먼지 · 괴물 눈빛 ADD | 켬 | 켬 | 끔 |
| 프레임 애니메이션 | 전부 | 전부 | 절반 (15Hz) |
| **정보 요소 (캐릭터 · 범위 · 마커 · 배지 · HUD)** | **같음** | **같음** | **같음** |

| 항목 | 값 | 코드 |
|---|---|---|
| 높음 파티클 상한 | `400` | `presets.PRESETS.high.particleCap` |
| 중간 파티클 상한 | `150` | `presets.PRESETS.medium.particleCap` |
| 낮음 파티클 상한 | `40` | `presets.PRESETS.low.particleCap` |
| 낮음 프레임 절반 | `true` | `presets.PRESETS.low.halfFrameAnims` |
| 블룸 (높음) | `false` | `presets.PRESETS.high.bloom` |
| 터치 낮음 기기 픽셀 배율 | `1.25` | `presets.TOUCH_LOW_OVERRIDE.dprCap` |
| 터치 낮음 백버퍼 높이 하한(px) | `450` | `presets.TOUCH_LOW_OVERRIDE.minBackingH` |
| 터치 낮음 하한이 올리는 배율 상한 | `1.5` | `presets.TOUCH_LOW_OVERRIDE.floorDprCap` |
| 터치 낮음 픽셀 수 상한 | `1200000` | `presets.TOUCH_LOW_OVERRIDE.maxPixels` |

- Canvas 렌더러는 어느 단계든 WebGL 전용 기능(셰이더 · postFX · 색보정 · 블룸)이 0개가 되게 낮추고(postFX 비네트 → 구운 오버레이), 합성 배율을 1 이하로 둔다(`effectivePreset`)
- 자동 선택: `?quality=` > 로비에서 고른 값(localStorage `decoy:quality`) > 자동(Canvas · 소프트웨어 WebGL = 낮음, 터치 기기 = 중간(코어 4개 이하 또는 메모리 3GB 이하면 낮음), 하드웨어 WebGL PC = 높음 — PC는 코어 · 메모리로 내리지 않는다)
- 판 중 자동 하향: 예열 5초 뒤 1초 평균이 하향 기준 미만인 상태가 10초 넘게 이어지면 내린다. 하향 기준 = 60Hz 값(PC 40fps · 터치 기기 50fps) × min(목표 FPS, 120) / 60 — PC는 기준 목표의 2/3, 터치 기기는 5/6이다(120Hz에서 80 · 100, 144 · 165Hz도 기준 목표 120, `quality.minFpsFor`). 프레임 제한이 자동이고 화면 주사율에 60 이상인 약수가 더 있으면(90 · 100Hz는 절반 45 · 50) 첫 단계는 품질 대신 목표 FPS를 그 약수로(품질 그대로, 효과 확인 없음, 판당 품질 하향 한도에 세지 않음 — 120 → 60, 144 → 72, 165 → 82.5, 240 → 120 → 80 → 60, 느린 평균 FPS 이하인 가장 높은 칸까지 한 번에)이고, 그다음은 품질 한 단계(판당 한 번). 평균이 기준 위여도 늦은 프레임(간격 ≥ 목표 주기 + 반 vsync)이 5% 이상인 상태가 같은 시간 이어지면 목표를 낮춘다(잔렉 고치기, DECISIONS 12절). 고정 제한(60 · 120 · 절반)은 목표를 바꾸지 않는다. 목표 FPS는 늘 화면 주사율의 약수다(60 · 120은 가장 가까운 약수 — 144Hz에 60이면 72). 품질 하향 3초 뒤 10초 평균이 15% 또는 5fps 이상 오르지 않으면 되돌리고 그 세션에서 끈다(`quality.FPS_WATCH` · `TOUCH_FPS_WATCH` · `DOWNGRADE_CHECK`). 성능 목표(사용자 2026-10-13)는 120Hz 고사양 120fps · 중급 휴대폰 60fps 안정 · 저사양 30fps 이상이고, 터치 기준 50은 60Hz 목표의 5/6이다
- 판 중 자동 올리기 (렌더링 최적화): 자동으로 내린 단계(품질 · 목표 FPS)를 가장 최근 것부터 하나씩 되돌린다. 예열 뒤 · 마지막 변경 20초 뒤부터 1초 평균 FPS ≥ 목표 × 0.95이고 작업 시간 p95 ≤ 프레임 예산(1000 / 목표, 목표 FPS를 올릴 때는 올린 뒤 목표)의 절반인 상태가 15초 넘게 이어지면 올린다. 목표 FPS는 판 중에 바로, 품질은 다시 굽기 끊김을 피해 다음 판 시작 전에 올린다. 올린 뒤 3초(다음 판이면 예열 5초) 뒤 10초 평균이 하향 기준 미만이면 다시 내리고 그 세션에서는 더 올리지 않는다(`quality.UP_WATCH` · `UP_PROBATION`). 자동으로 내리기 전 상태(시작 단계 · 로비에서 고른 값 · `?quality=`, 시작 목표 FPS)보다 올리지 않고, 효과 없는 하향을 되돌려 꺼진 세션은 올리지도 않는다
- 판 중 측정 기억 (터치 기기만, M12): 자동 단계에서 내린 뒤 효과를 확인한 단계(유지)와 올린 뒤 확인을 통과한 단계는 localStorage `decoy:perf`에 온라인 · 연습 따로 남아 다음 접속을 그 단계로 시작한다(자동보다 낮을 때만, 그때의 자동 단계와 시작 목표 FPS가 지금과 같을 때만). 저장 형식 2판은 시작 목표 FPS를 같이 둔다(60이면 적지 않음, 1판 값은 버림). 로비에서 품질을 직접 고르면(자동 포함) 지운다. PC는 세션 단위

| 항목 | 값 | 코드 |
|---|---|---|
| 자동 하향 예열(ms) | `5000` | `quality.FPS_WATCH.warmupMs` |
| 자동 하향 기준(fps, 목표 60) | `40` | `quality.FPS_WATCH.minFps` |
| 터치 기기 자동 하향 기준(fps, 목표 60) | `50` | `quality.TOUCH_FPS_WATCH.minFps` |
| 자동 하향 지속(ms) | `10000` | `quality.FPS_WATCH.sustainMs` |
| 하향 기준을 정한 목표(Hz) | `60` | `quality.BASE_TARGET_HZ` |
| 하향 기준 목표 상한(Hz) | `120` | `quality.THRESHOLD_CAP_HZ` |
| 자동 제한 목표 사다리의 가장 낮은 칸(Hz) | `60` | `framePacing.EVEN_RATE.ladderMinHz` |
| 60 이상 약수가 화면뿐일 때 절반을 둘 하한(Hz) | `45` | `framePacing.EVEN_RATE.ladderFloorHz` |
| 늦은 프레임: 목표 주기에 더하는 vsync 비율 | `0.5` | `quality.PACING_WATCH.lateSlack` |
| 목표 FPS를 낮추는 늦은 프레임 비율 | `0.05` | `quality.PACING_WATCH.maxLateRatio` |
| 판 밖 그리기 제한(Hz, 가장 가까운 약수) | `30` | `framePacing.IDLE_CAP_HZ` |
| 제한기 위상 고정 허용(vsync 비율) | `0.5` | `framePacing.LIMITER.phaseSlack` |
| 판 중 화면 주사율이 낮아졌을 때 화면이 바뀐 것으로 볼 비율(붙잡은 값 ÷ 잰 값이 정수에서 벗어난 양) | `0.15` | `framePacing.HELD_DROP_SLACK` |
| 자동 올리기 조용한 시간(ms) | `20000` | `quality.UP_WATCH.quietMs` |
| 자동 올리기 여유 지속(ms) | `15000` | `quality.UP_WATCH.sustainMs` |
| 자동 올리기 FPS 비율(목표 대비) | `0.95` | `quality.UP_WATCH.minFpsRatio` |
| 자동 올리기 작업 시간 비율(예산 대비) | `0.5` | `quality.UP_WATCH.maxWorkRatio` |
| 올린 뒤 확인 가라앉는 시간(ms) | `3000` | `quality.UP_PROBATION.settleMs` |
| 올린 뒤 확인 측정(ms) | `10000` | `quality.UP_PROBATION.measureMs` |
| 판 중 측정 기억 저장 형식 판 | `2` | `quality.PERF_MEMORY_VERSION` |

### 7.4 후처리 대상과 레이어 순서 (R1 · R2)

월드 컨테이너(0.93배) 안, 아래 → 위:

1. `fogRoot` — 바닥 · 벽 · 시설 발광 · 거점 · 탈출구 영역 · 시야 채움 · 안개(빛 지도 곱하기) · 테두리 리프트. **후처리는 여기에만**: 높음(WebGL) = 자체 PostFX 파이프라인 하나(색보정 + 비네트, 섞기 모드 NORMAL로 되돌림), 중간 = 구운 비네트 이미지 + 색보정, Canvas 높음 · 중간 = 구운 비네트, 낮음 = 없음. 비네트는 맵 정규화 거리 0.95~√2에서만 최대 0.3(`fx.POST`), 색보정은 채도 +8% + 밝기 가중 합 0인 그늘 색 기울기
2. 기절 회색 막(괴물 화면 기절 중)
3. 바닥 정보: 배지 · A/B 글자
4. 시야 경계 림 → 빛 속 먼지 → 부채꼴 채움 · 해치(생존자 화면, DECISIONS D4) → 공격 준비 채움
5. 엔티티: 캐릭터 접지 그림자 → 돌진 잔상 → 이벤트 효과 → 부채꼴 가장자리 선 · 자기 시야 테두리 → 범위 선 → 바닥 링 → 몸 아래 표시(노출 문양 · 기절 별) → 마커(탐지 · 포효 · 포효 핑) → 발 · 몸 → 부착 표시(거품 · 진행 링 · 부상)

월드 밖(장면 깊이): 잘라 옮김 어두워짐 36 → 창 밖 가리개 37 → 발각 테두리 38 → 화면 밖 화살표 38.5~38.7 → 미니맵 39~42.5 · HUD 40~42 → 피격 가장자리 52 · 수감 페이드 55 → 배너 · 메모 60~62 → 조작 안내 · 점수판 70~72 → 선명도 탐침 1000. 캐릭터 · 범위 · 마커 · 배지 · 글자 · HUD에는 후처리가 없다(`getFxTargets()`가 장면 표시 목록 · 카메라에서 직접 모아 E2E로 확인).

---

## 8. HUD

구현: `client/src/ui/hud.ts`(위 띠 · 팀 카드 · 행동 칸), `hudArt.ts`(그림 · 순수 함수), `hudKit.ts`(아틀라스 · 부품), `banners.ts`(배너 · 메모), `overlays.ts`(조작 안내 · 점수판), `minimap.ts`, `layout.ts`(배치), `scenes/GameScene.ts`(연결 · 발각 테두리 · 디버그).

### 8.1 정보 위계

| 층 | 자리 | 무엇 | 움직임 |
|---|---|---|---|
| 1 즉시 | 가운데 · 화면 가장자리 | 발각 빛 테두리 + 발각 배너, 피격, 월드 공격 범위, 행동 칸 준비 상태, 구조 진행, 최후의 30초 | 허용 |
| 2 목표 | 위 띠 | 거점 A · B 게이지 + 타이머 틀 | 점령 중 사선 흐름 · 괴물 화면 깜빡임만 |
| 3 팀 | 왼쪽 여백 | 팀 카드 (괴물 화면: 익명 카드) | 없음 |
| 4 참조 | 오른쪽 여백 (자리가 없는 터치 배치는 맵 창 안 오른쪽 위) · 맵 창 가장자리 | 미니맵 "지도" · 화면 밖 화살표(12.4) | 괴물 화면 점령 알림 깜빡임만 |
| 5 이야기 | 맵 위쪽 | 메모 상자 (벽 글씨) | 없음 |

1층 말고는 장식 애니메이션이 없다. 늘 떠 있는 부품(위 띠 · 팀 카드 · 행동 칸 · 미니맵)은 맵 사각형과 겹치지 않고(예외: 옆 칸이 없는 터치 배치의 맵 안 미니맵, 12.6), 잠깐 뜨는 덮개(배너 · 메모 · 조작 안내 · 점수판)만 맵 위에 탈출구 · 감옥을 비켜 둔다. HUD가 보여 주는 정보의 양 · 종류는 M9와 같다(0장 ①).

### 8.2 배치 (`layout.HUD`, 논리 px)

| 부품 | 값 | 코드 |
|---|---|---|
| 타이머 틀 가운데 x · y · 폭 · 높이 | `960` · `32` · `156` · `44` | `layout.HUD.timer.x` `layout.HUD.timer.y` `layout.HUD.timer.w` `layout.HUD.timer.h` |
| 거점 게이지 배지 ◇ · 상태 칩 · 막대 폭 · 막대 높이 | `38` · `24` · `212` · `22` | `layout.HUD.gauge.dia` `layout.HUD.gauge.chip` `layout.HUD.gauge.barW` `layout.HUD.gauge.barH` |
| 게이지 전체 폭 | `288` | `layout.HUD.gauge.w` |
| 거점 A 바깥 끝 x · 거점 B 바깥 끝 x | `580` · `1340` | `layout.HUD.gaugeA.x` `layout.HUD.gaugeB.x` |
| 팀 카드 x · y · 폭 · 높이 · 익명 카드 높이 · 간격 | `14` · `78` · `218` · `124` · `96` · `10` | `layout.HUD.leftCards.x` `layout.HUD.leftCards.y` `layout.HUD.leftCards.w` `layout.HUD.leftCards.h` `layout.HUD.leftCards.hAnon` `layout.HUD.leftCards.gap` |
| 미니맵 그림 x · y · 폭 · 틀 여백 · 제목 줄 | `1686` · `102` · `222` · `6` · `30` | `layout.HUD.minimap.x` `layout.HUD.minimap.y` `layout.HUD.minimap.w` `layout.HUD.minimap.pad` `layout.HUD.minimap.title` |
| 아래 띠 가운데 y | `1048` | `layout.HUD.bottom.y` |
| 행동 칸 폭 · 간격 · 아이콘 타일 | `176` · `12` · `56` | `layout.HUD.slot.w` `layout.HUD.slot.gap` `layout.HUD.slot.tile` |
| 아래 띠 안내 줄 높이 | `42` | `layout.HUD.hint.h` |
| 배너 높이 · 알림 줄 높이 · 줄 간격 | `46` · `40` · `50` | `layout.HUD.banner.h` `layout.HUD.banner.rowH` `layout.HUD.banner.rowGap` |
| 메모 상자 글자 폭 | `900` | `layout.HUD.noteW` |
| 조작 안내 가운데 y · 점수판 가운데 y | `820.8` · `540` | `layout.HUD.tutorialY` `layout.HUD.scoreY` |

- 배너 가운데 y = 맵 y 4.2타일(약 189, 북쪽 탈출구 판정 원 아래), 메모 상자 위쪽 y = 맵 y 8.7타일(약 323, 알림 두 줄 아래 · 감옥 위)
- 위 띠 오른쪽(x 1490 이후)과 아래 띠 오른쪽은 비워 둔다(선명도 탐침 자리, `tests/e2e/m10-resolution.webgl.spec.ts`)
- 위치는 `layout.ts`에서만 읽는다(M12 터치 배치가 같은 부품을 다시 놓는다, 8.6)

### 8.3 부품

- **위 띠 — 거점 게이지**: ◇ A/B 배지 + 상태 칩 + 양 끝이 뾰족한 육각 막대(concept_06 게이지 언어). 점령 중 = 청록 채움 + 기기 픽셀 단위로 흐르는 사선(주기 12px, `gfxNow`) + ▶ 칩, 정지 = 주황 채움 + ‖ 칩, 완료 = ✓ 칩, 대기 = 칩 없음. B는 좌우 대칭(배지가 오른쪽 바깥, 채움도 배지 쪽에서). 괴물 화면은 점령 중 게이지가 0.5초 간격으로 깜빡인다(알파 0.3)
- **위 띠 — 타이머 틀**: 고정폭 숫자(글자마다 같은 폭 칸, `hudKit.ts` Digits). 보통 = 시계 아이콘, 1분 미만 = 빨강 `#F87171` + 경고 아이콘, 최후의 30초 = 주황 + 문 아이콘 + "최후"
- **팀 카드 (생존자 화면)**: 역할 순서 러너 · 가드 · 스카우트. 우물 안 역할 실루엣(−60°로 돌림, 위를 보면 러너가 ♠처럼 보여서) + 24눈금 능력 쿨타임 링, 역할 이름(글자용 역할색), '나' 태그(내 카드는 역할색 2px 테두리), 플레이어 이름(길면 …), 상태 아이콘 + 글자(정상 ♥ · 부상 금 간 하트 주황 · 수감 자물쇠 빨강 · 사망 × 흐림 · 탈출 문 초록), 연결 끊김이면 체력 칸 대신 "부상 · 연결 끊김"처럼 글자로, 체력 칸 2, 능력 아이콘 + "능력 준비 / N초", 수감 눈금 n/2
- **익명 카드 (괴물 화면)**: 흰 공통 토큰 + "생존자 N" + 상태 아이콘 · 글자 + 수감 눈금. 역할 · 이름 · 체력 · 위치 없음, 순서는 서버의 심각도 순(입장 순서와 무관)
- **아래 띠 — 행동 칸**: 56px 아이콘 타일 + 24눈금 링(쿨타임이면 지난 비율, 구조 중이면 진행) + 가운데 남은 초 + 이름 + 키캡. 생존자 = 능력(Space) · 구조(E), 괴물 = 공격(좌클릭) · 돌진(Shift) · 포효(Q) · 시야 모드(우클릭, 탐색/추적 아이콘). 상태 ready · cooldown · active · blocked는 순수 함수 `actionSlots`(M11 터치 버튼이 같이 쓴다)가 서버 판정과 같은 조건으로 정한다. 수감 · 관전 · 괴물 대기 중에는 행동 칸 대신 안내 줄. "범위 밖" 알림은 능력 칸 이름 자리에 1초 주황
- **쿨타임 링**: 24눈금(맵 거점 눈금과 같은 언어), 12시에서 시계 방향. 연속 쓸림 대신 아틀라스 프레임 교체만으로 그린다
- **배너**(`banners.ts`): 아이콘 + 제비꼬리 리본(가로 3조각). 톤: 발각 = 눈 + `#B91C1C` · 흰 글자, 경고 = 주황 + `#0B1622` 글자, 정보 = 청록 `#0E7490` + 흰 글자. 지속 한 줄(발각 > 최후의 30초 · 괴물 재접속 대기), 같은 자리에 괴물 경고 줄(캠핑 · 거점 지키기, 배너 목록에는 넣지 않음), 그 아래 일시 알림 최대 2줄(표시 시간은 `STORY_TEXT.md`, 6초 넘게 기다린 알림은 버림). 알림별 톤 · 아이콘은 `GameScene.ts` ALERT_LOOK(점령 시작 · 포효 = 경고, 점령 완료 · 탈출구 · 구조 = 정보)
- **메모 상자**: 연필 아이콘 + 왼쪽 청록 띠, `#0C1620` 알파 0.85(아래가 흰색이어도 글자 9.53:1)
- **조작 안내 · 점수판**(`overlays.ts`): 'ov' 패널(알파 0.95) + 키캡 + 줄. 첫 판 조작 안내 5초(아무 키나 누르면 닫힘, 입력을 막지 않음). 새 캐릭터 스타일이면 머리줄의 32px 역할 문양 자리에 내 역할 정면 상반신을 넣은 64px 원판(어두운 원판 + 아래 역할색 빛 + 역할색 테두리, 문양 배지와 같은 언어)을 둔다 — 안내가 보일 때 작은 캔버스에 기기 픽셀로 한 번 그려 올리고, 닫히거나 장면이 끝나면 지운다(텍스처 바이트 집계에 든다). Tab 점수판(역할 문양 · 이름 · 상태 · 수감 · 능력, 괴물 화면은 익명 열만)이 열리면 조작 안내를 닫는다(겹침 버그 수정)
- **미니맵**: 깎은 모서리 틀 + 지도 아이콘 + 제목 "지도". 바닥은 맵 전체 합성(안개 포함, 따라가는 카메라에서는 메인 화면과 같은 바닥 명령 · 빛을 맵 전체 작은 캔버스에 따로 합성)을 줄여 쓰고, 엔티티는 메인 화면에 실제로 그린 목록만 다시 찍는다(메인보다 많은 정보가 나올 수 없음). 생존자 화면은 역할 실루엣 축소판(몸 반지름 4.6px, 바라보는 방향, 나는 흰 고리), 괴물 화면은 흰 공통 실루엣, 괴물은 망토. 따라가는 카메라에서 더 그리는 것(12.6): 보이는 창 흰 사각형, 거점 다이아 상태(대기 테두리 · 점령 중 채움 깜빡임 · 정지 주황 · 완료 흐린 채움), 탈출구 상태(꺼짐 회색 · 활성 초록 테두리 · 열림 초록 채움), 관전 중인 동료 청록 고리
- 글자: HUD 최소 15 논리 px(1366 × 768에서 약 10.7 CSS px). 터치 배치는 CSS px로 보조 12 · 주요 14 이상(8.6)

### 8.4 굽기 · 성능

- HUD 그림은 모두 **아틀라스 한 장**(PC 프레임 286개, 스카이라인 배치)에 판 시작 · 백버퍼 배율이 바뀔 때만 굽는다. 터치 배치는 그림 배율 `HUD.s`(uiScale)를 곱한 배율(zoom × s)로 굽고 1텍셀 = 기기 1px로 찍어 크게 그려도 선명하다(막대 게이지 대신 링 게이지 · 큰 상태 아이콘 · 주황 눈금을 더 굽는다). 판 중 상태가 바뀌면 프레임 · 자리 · 자르기만 바꾼다. HUD에 Graphics 객체는 0개
- 크기가 바뀌는 패널은 9조각(배너 · 키캡 · 막대는 가로 3조각), 조각 경계가 기기 픽셀 정수라 이음매가 없다
- 크기: 배율 1 1024 × 210 = 0.82MiB, 1.5 = 1.73MiB, 2 = 1024 × 726 = 2.84MiB. 굽는 시간 배율 2 Canvas 약 28ms → 로비 대기 중 미리 굽는다(`prebakeHud`, 같은 배율이면 아무것도 안 함)
- 폰트를 시간 초과로 못 받은 채 판이 시작되면 고정폭 숫자 칸 폭 · 리본 폭은 다음 문구 변경 때까지 대체 글꼴 기준으로 남는다(드문 경우)

### 8.5 디버그 (`__DECOY__.getHud()`, `GameScene.hudDebug`)

| 키 | 값 |
|---|---|
| `bakes` | HUD 아틀라스 굽기 누적 횟수 (판 중 상태 변화로는 늘지 않음, 배율이 바뀌면 +1) |
| `pointA` · `pointB` | 'idle' · 'capturing' · 'paused' · 'done' |
| `pointAIcon` · `pointBIcon` | 'none' · 'play' · 'pause' · 'check' |
| `timer` · `timerText` | 'normal' · 'low' · 'grace', 표시 글자 |
| `slots` | 'id:state,…' (예: ability:ready,rescue:blocked) |
| `hint` | 아래 띠 안내 줄 글자 |
| `cardText` | 보이는 카드 글자 (카드 사이 ' \| ') |
| `scoreboard` · `scoreText` | 점수판 표시 여부 · 글자 |
| `help` | 조작 안내 표시 여부 |
| `spotted` | 발각 테두리 표시 여부 |
| `hudGraphics` | 깊이 38 이상 Graphics 수 (화면 효과 제외, 0이어야 함) |
| `panels` | 늘 떠 있는 부품 자리 JSON `[x, y, w, h][]` (+ 미니맵) |

---
### 8.6 터치 배치 (M12, `layout.layoutFor` · `layout.touchHudPlan`)

PC(`device.touch` 거짓)는 언제나 1920 × 1080 · 8.2 배치 그대로다. 터치 모드는 판 시작 직전(가로 · 전체 화면 전환을 최대 0.3초 기다린 뒤) 안전 영역 안 게임 영역 크기로 배치를 정하고 판 중에는 바꾸지 않는다(크기가 바뀌면 카메라 zoom만 다시 맞추고 터치 화면만 다시 놓는다). 맵 배율은 모든 배치에서 같다.

| 배치 | 언제 | 논리 크기 · 맵 | HUD |
|---|---|---|---|
| `touchWide` | 화면비 2:1 이상이고 맵을 높이 가득 그려도 좌우 칸 ≥ 88 CSS px | 높이 = 맵 높이(952), 폭 = 높이 × 화면비(상한 없음 — 더 넓은 화면은 좌우 칸이 넓어진다), 띠 0 | 왼쪽 칸 위쪽: 타이머 · 거점 링 게이지(넓으면 한 줄) · 팀 카드(칸 폭만큼 여러 열). 오른쪽 칸: 시스템 버튼(점수판 · 전체 화면) 아래 미니맵(자리가 있을 때). 아래쪽 좌우는 엄지 영역 |
| `touchNarrow` (16:9 · 16:10) | 그보다 좁고 좌우 칸 88을 만드는 띠가 44 이하 | 위 · 아래 띠(26 CSS px 이상, 좌우 칸이 88이 되게)를 남기고 논리 크기를 키운다 | 위 띠 가운데 타이머, 좌우 칸은 넓은 배치와 같다. 엄지 영역은 맵 아래 구석에 반투명으로 겹친다 |
| `touchNarrow` (태블릿 4:3) | 좌우 칸을 만들려면 띠가 44보다 커야 할 때 | 띠 44(맵이 폭에 들어가게 더 클 수 있다) | 위 띠에 모두: 팀 카드 한 줄 · 링 게이지 · 가운데 타이머. 미니맵은 맵 창 안 오른쪽 위(12.6) |

- **줄이거나 숨기는 규칙**(작은 화면): 왼쪽 칸이 이동 영역(이동 스틱 그림 위 16px)까지 모자라면 링 게이지를 오른쪽 칸(시스템 버튼 아래)으로, 칸이 좁으면 타이머의 '최후' 글자를 뺀다(주황 + 문 아이콘이 같은 뜻). 미니맵은 오른쪽 칸 남는 자리에 72 CSS px 이상 들어가면 그 자리에, 아니면(16:9 · 태블릿 · 가장 낮은 휴대폰 괴물) 맵 창 안 오른쪽 위 구석에 60 CSS px 이상으로 둔다(12.6 — 확대 화면에서는 맵 전체가 보이지 않아 미니맵이 필수다). 점수판이 화면에 다 들어가지 않으면 조작 안내 줄을 빼고 상태 표만
- **팀 카드**(터치): 우물 속 역할 실루엣 · 상태 아이콘(글자 대신, 끊김이면 끊김 아이콘) · 체력 칸 2 · 수감 눈금. 이름 · 상태 글자 · 능력 줄은 점수판에 있다. 내 카드는 역할색 2px 테두리. 괴물 화면은 흰 공통 토큰 · 상태 아이콘 · 수감 눈금만(익명 그대로)
- **거점 링 게이지**(터치): ◇ A/B 배지를 24눈금 링이 둘러 진행을 보인다(맵 거점 눈금 링과 같은 언어). 정지는 주황 눈금, 상태 칩(▶ ‖ ✓)은 오른쪽 아래. 괴물 화면은 점령 중 깜빡임
- **늘 떠 있는 부품**(타이머 · 게이지 · 카드 · 미니맵)은 맵 사각형 · 터치 대상(이동 영역 포함) · 이동 스틱 그림과 겹치지 않는다. 터치 화면은 이 부품 아래에서 이동 영역을 시작한다(`touchControls.touchLayout`의 avoid). **안내 줄**(수감 · 관전 · 괴물 대기)은 맨 아래 가장자리 띠 안(터치 대상이 없는 24px)에 터치 문구로. **배너 · 메모**는 맵 안 가로 범위에서 오른쪽 위 시스템 버튼이 맵에 걸치면 그 아래부터, 보이는 것만 위에서부터 쌓는다(넘치면 글자를 12px까지 줄인다)
- **판 중 위치 표시**(판 직전 터치 안내를 본 판, 처음 10초): 이동 영역 점선 판 + "여기를 누르고 끌어 이동", 스틱 · 버튼 둘레 빛 고리. 입력을 막지 않고 화면 가운데(감옥)를 가리지 않는다. 점수판이 열려 있으면 다른 터치 버튼은 흐려지고 화면 어디를 눌러도 닫힌다

| 항목 | 값 | 코드 |
|---|---|---|
| 그림 1단위 (CSS px) | `0.68` | `layout.TOUCH_UI.art` |
| 글자 보조 · 주요 · 타이머 숫자 (CSS px) | `12` · `14` · `16` | `layout.TOUCH_UI.font.small` `layout.TOUCH_UI.font.main` `layout.TOUCH_UI.font.timer` |
| 칸 안 여백 · 부품 사이 (CSS px) | `6` · `6` | `layout.TOUCH_UI.edge` `layout.TOUCH_UI.gap` |
| 16:9 띠 최소 · 좌우 칸이 없는 화면의 띠 (CSS px) | `26` · `44` | `layout.TOUCH_UI.band` `layout.TOUCH_UI.bandStack` |
| 좌우 칸 최소 폭 (CSS px) | `88` | `layout.TOUCH_UI.minSide` |
| 이동 스틱 그림 위 이동 영역 · 맨 아래 안내 줄 높이 (CSS px) | `16` · `20` | `layout.TOUCH_UI.zoneTop` `layout.TOUCH_UI.hintH` |
| 미니맵 최소 폭 (CSS px) | `72` | `layout.TOUCH_UI.minimapMin` |
| 팀 카드 폭 · 높이 (그림 단위) | `110` · `44` | `layout.TOUCH_PART.card.w` `layout.TOUCH_PART.card.h` |
| 링 게이지 한 칸 · 사이 (그림 단위) | `52` · `6` | `layout.TOUCH_PART.gauge` `layout.TOUCH_PART.gaugeGap` |
| 타이머 높이 · 여백 · 아이콘 · 사이 (그림 단위) | `34` · `9` · `20` · `4` | `layout.TOUCH_PART.timer.h` `layout.TOUCH_PART.timer.pad` `layout.TOUCH_PART.timer.icon` `layout.TOUCH_PART.timer.gap` |
| 배너 리본 높이 · 알림 줄 높이 · 사이 (그림 단위) | `36` · `32` · `6` | `layout.TOUCH_PART.ribbon.h` `layout.TOUCH_PART.ribbon.rowH` `layout.TOUCH_PART.ribbon.gap` |
| 가장자리 띠 좌우 · 아래 (CSS px, M11) | `32` · `24` | `layout.EDGE_BAND.side` `layout.EDGE_BAND.bottom` |
| 터치 대상 최소 · 간격 (CSS px, M11) | `48` · `8` | `layout.MIN_TARGET` `layout.MIN_GAP` |
| 시스템 버튼 칸 (판 중 설정 버튼까지) | `3` | `layout.SYS_SLOTS_MENU` |
| 조이스틱 크기 설정 (%) 최소 · 최대 · 한 칸 · 기본 | `80` · `130` · `5` · `100` | `prefs.STICK_SIZE.min` `prefs.STICK_SIZE.max` `prefs.STICK_SIZE.step` `prefs.STICK_SIZE.def` |
| 조이스틱 투명도 설정 (%) 최대 · 한 칸 · 기본 (불투명도 = 1 − 투명도, CSS `--stick-a`) | `60` · `10` · `0` | `prefs.STICK_CLEAR.max` `prefs.STICK_CLEAR.step` `prefs.STICK_CLEAR.def` |

- **조정**(설정 화면 통합, `layout.LayoutTuning` — 판 시작 배치에서 정해 판 중에는 바꾸지 않는다): ① 조이스틱 크기(이동 · 조준 스틱 반지름만, 버튼은 그대로) ② UI 크기(그림 단위 · 글자 · 띠 · 좌우 칸 최소 크기를 같은 배율로 — 맵이 조금 작아져도 카메라가 보는 타일 수는 같다) ③ 좌우 반전(왼손잡이, 13장 — HUD도 화면 가운데를 축으로 뒤집고 거점 A 게이지는 왼쪽 그대로) ④ 시스템 버튼 세 칸(설정 · 점수판 · 전체 화면, 12.8). 키운 값은 들어가는 만큼만: HUD가 들어가지 않으면 UI 크기를 0.05씩, 그다음 조이스틱 크기(100% 넘을 때)를 줄인다(800×360 · 915×412는 UI 1.3배 그대로). 세 칸이 맵에 걸치는 낮고 넓은 화면(802×293)은 엄지 버튼 위에 자리가 있으면 전체 화면 버튼을 점수판 아래 둘째 줄로 내린다. 배너 · 메모가 피하는 시스템 버튼 줄은 내 팀 배치 기준이다
- uiScale = 그림 1단위 × UI 크기 × (논리 px / CSS px): 그림이 화면 높이와 상관없이 같은 CSS 크기다. 휴대폰 2:1~2.4:1의 논리 폭은 1904~2282, 높이 293 휴대폰(802 × 293)은 2606
- **안전 영역**(노치 · 둥근 모서리 · 제스처 막대): `index.html` meta viewport `viewport-fit=cover`, `style.css` `--sa-t` · `--sa-r` · `--sa-b` · `--sa-l`(`env(safe-area-inset-*)`)만큼 게임 영역(`#game-root` — 캔버스 · 판 배치의 기준) · 로비 · 결과 · 알림 · 깨우기 안내를 안쪽에 둔다. 터치 화면은 M11부터 안전 영역 + 가장자리 띠 안쪽. 바깥 띠는 같은 바탕색(결과 화면은 같은 막)
- 디버그: `__DECOY__.getHudLayout()` — 보이는 HUD 글자 · 그림(깊이 39 이상, 빈 글자 제외)을 표시 목록에서 재 CSS px로(글자는 화면에 그려지는 크기), 부품 이름(`timer` · `gaugeA` · `gaugeB` · `card0`~`card2` · `minimap` · `banner` · `note` · `hint` · `score`). 검사: `tests/unit/touch-hud.test.ts` 「보조 글자 12px 이상 · 주요 글자 14px 이상 (CSS)」 · `tests/e2e/m12-screen.spec.ts` 「글자 · 겹침: 휴대폰 높이 293 · 320 · 360 · 16:9 두 가지에서 HUD 글자 12px 이상, HUD와 터치 컨트롤이 안 겹치고 화면 안」

## 9. 로비 · 결과

구현: `client/src/ui/lobby.ts` · `result.ts` · `uiArt.ts`(DOM 도우미 · 실루엣 · 문양 SVG · 설계도) · `wakeNotice.ts`, `client/src/style.css`, `client/public/wake.html`. 문구는 `client/src/data/storyText.ts` + `docs/STORY_TEXT.md` 4절. `data-testid` · 문구 · `.player` · `mine` 클래스는 M9 E2E 그대로다.

### 9.1 로비

- **배경**: 실제 맵(`MAP_ROWS`)에서 만든 설계도 SVG(벽 경계 · 기둥 8각 · 감옥 철창 · 거점 · 탈출구 셰브론 · 격자 · 눈금 틀, 청록 선 알파 4~17%, 글자 없음)를 고정 레이어에 한 번만 넣고 + 11초 주사선(합성기 transform만, `prefers-reduced-motion`이면 없음) + 비네트. 판 중에는 로비가 `display: none`이라 돌지 않는다
- **첫 화면**: 큰 로고 SVG + 글로우 + 코드로 얹은 "DECOY" 글자(`.wordmark`), 깎은 패널 안에 이름 · 서버 상태 줄 · 오류 줄 · 빠른 매칭(M13c) · 봇과 연습(M13b) · 방 만들기 · 코드 입장. 로고 · 부제 아래 단추 줄에 전체 화면(휴대폰 브라우저) · **설정**(설정 화면 통합, PC · 터치 같은 자리 — 그래픽 품질 · 프레임 제한 · 캐릭터 스타일은 설정 화면 9.5 안. 예전 PC 첫 화면 선택 상자 셋과 터치 설정 판은 없앴다). 오류는 경고 아이콘 + 글자. 상태 줄 · 오류 줄은 이름 칸 바로 아래(검토 반영 — 높이 360 이하 휴대폰 가로 · 낮은 PC 창에서도 스크롤 없이 보이게, 연습 고르기도 안내 바로 아래). 가로 화면 높이 501~860 · 폭 760 이상(태블릿 · 낮은 노트북)은 로고(96~160px)를 패널 왼쪽에 둔다(높이 500 이하 휴대폰과 같은 방식, 연습 고르기도 같다). 빠른 매칭 대기 화면은 같은 범위에서 제목 띠를 로고 옆 한 줄에 둔다(검토 반영). 로고 아래 처리방침 링크는 손가락 화면에서 높이 48px(글자 12px)
- **첫 화면은 연결과 상관없이 바로 그린다**(M13b): 가운데 깨우기 패널 대신 패널 안 상태 줄 한 줄(`.server-status`). 연결됨 = 청록 원 + 청록 글자, 깨우는 중 = 빈 청록 마름모(1.2초 깜빡임, `prefers-reduced-motion`이면 멈춤) + 흐린 글자 + 기다린 초, 연결할 수 없음 · 오프라인 = 주황 삼각 + 밝은 노랑 글자(`#FCD34D`). 점 모양이 상태마다 달라 색만으로 구분하지 않는다. 연결이 필요한 버튼(방 만들기 · 입장)은 연결 전 꺼진 모양(사선 해치), 봇과 연습은 늘 켜짐
- **봇과 연습 역할 고르기**(M13b): 첫 화면 패널 자리에 안내 한 줄 + 역할 버튼 4개(2 × 2, 높이 500 이하는 4 × 1) + 취소. 버튼 = 실루엣(84px, 낮은 화면 52px — 새 캐릭터 스타일이면 정면 그림) + 문양 + 이름(글자용 역할색), 누르면 바로 판. 좁은 휴대폰 가로(폭 720 · 높이 500 이하)는 문양을 이름 위로 올린다('스카우트'가 칸에서 잘리지 않게). 마우스를 올리거나 포커스하면 역할색 2px 테두리 + 빛
- **방 화면 위 띠**: 로고 + 초대 패널(방 코드 4칸 키 타일, 링크 + 아이콘 버튼 "링크 복사")
- **역할 카드 4장**(괴물 · 러너 · 가드 · 스카우트): 큰 실루엣(게임과 같은 모양, 위를 봄, 돔 음영 + 바닥 빛 + 점선 고리) + 문양 + 이름(글자용 역할색) + 소개 + 능력 줄(아이콘 + 키캡 + 이름 + 설명). 새 캐릭터 스타일(4.5)이면 실루엣 대신 같은 상자에 정면 캐릭터(바닥 무대 빛 + 그림자, 생존자는 청록 네온, 그림 하나 = svg 하나, 'front' 클래스). 카드가 좁으면 내 역할 카드의 정면 그림을 '내 역할' 배지 왼쪽으로 비켜 세운다(배지가 얼굴을 덮지 않게, `style.css` `.role-card.mine .rc-figure.front`). 스타일이 바뀌면(휴대폰 설정 판은 방 화면에서도 열린다) 카드를 바로 다시 그린다
  - 고른 카드: 역할색 2px 테두리 + 빛 + "✓ 내 역할" 태그(글자용 역할색 바탕 + `#0B1622` 글자, 6.59~10.46:1)
  - 남이 고른 카드: 사선 해치 + 회색 실루엣 + 주인 이름 · 준비 상태 + `aria-disabled`. 글자 대비를 떨어뜨리는 반투명은 쓰지 않는다
  - 빈 카드: 점선 원 + "비어 있음"
- **플레이어 목록**: 2 × 2(빈자리 포함), 아바타 = 역할 문양, 방장 = 왕관, 봇 태그, 준비 = 아이콘 + 글자
- **명령 줄**: 화면 가운데 아래(나가기 · 준비 · 시작 + 안내 + 오류, 오류가 없으면 숨김). "나가기"(뒤로 아이콘, 검토 반영)는 방에서 나가 첫 화면으로 가고, 다른 사람이 남은 방이면 코드 칸에 방 코드를 남긴다(마지막 사람이면 방이 바로 지워지므로 비운다, 수정 검토) — 최소 폭 없이 작게(손가락 화면 48px 높이). 괴물 조준은 마우스를 따르지만, 판 시작 뒤 캔버스 위에서 마우스를 움직이거나 누르기 전에는 지금 방향을 유지한다(로비에서 마지막으로 누른 버튼 자리를 향하지 않는다, 검토 반영 — 캔버스 둘레 레터박스 위 움직임은 세지 않는다, 수정 검토). 손가락 포인터는 조준을 바꾸지 않는다
- **낮은 창**: 높이 860 이하 촘촘하게, 620 이하(960 × 540)는 플레이어 목록 한 줄 칩 · 준비와 시작 나란히, 폭 860 이하는 카드 2열 · 목록 1열(휴대폰은 M11 맞춤 + M12 안전 영역 · 9.4)

### 9.2 결과 화면

- 작은 로고 + "DECOY" + 판 길이 칩
- 승리 팀 제목 + 팀 문장: 생존자 승리 = 생존자 셋 실루엣 + 제목 `#34D399`(탈출 초록 계열, 스카우트색 아님), 괴물 승리 = 괴물 후드 + 글자용 괴물색 `#F87171`, 무효 = 아이콘 + 흐린 글자. 새 캐릭터 스타일이면 생존자 승리 = 정면 캐릭터 셋(겹쳐 놓고 무대 빛은 뺌), 괴물 승리 = 괴물 정면 그림(기존은 문양). 결과 상자 높이는 그대로(빈 위쪽은 음수 여백으로 접는다)
- 결과 등급 배지(생존자 화면만): 완전 탈출 = 문 아이콘 3개, 탈출 성공 = 2개, 탈출 실패 = 1개 + 글자
- 결말 문구는 "기록자 메모" 패널(`STORY_TEXT.md`)
- 플레이어 표: 문양 아바타 + 이름 + 역할, 열 머리 아이콘(맞은 횟수 · 맞힌 횟수 · 구조 · 점령 기여 · 결과), 결과 = 아이콘 + 글자, 해당 없는 칸은 —, 내 역할 행 강조
- "홈으로"(뒤로 아이콘, M13b — 방에서 나가 첫 화면으로) + "다시 하기"(주 버튼 + 다시 하기 아이콘). 두 버튼 사이 12px, 좁으면 두 줄(검토 반영 — 터치 대상 48px · 8px 간격 · 가장자리 띠 밖)
- `margin: auto`: 화면이 넉넉하면 가운데, 모자라면 위에서부터 스크롤(960 × 540에서 위가 잘리지 않음), 높이 620 이하(손가락 화면은 680 이하) 촘촘하게

### 9.3 서버 깨우기 안내

방 · 판 화면의 깨우기 안내(`wakeNotice.ts`, 첫 화면은 9.1 상태 줄): 같은 깎은 패널 + 진행 띠, 로고는 PNG 1x + `logo.svg` 2x(`srcset`). 독립 페이지 `client/public/wake.html`은 서버가 잠든 동안 보이므로 외부 파일(폰트 · 로고)을 부르지 않고 CSS만으로 같은 언어(격자 배경 + 깎은 패널 + 청록 테두리 + 버튼)를 낸다. 기기가 오프라인이면 본문을 인터넷 연결 안내로 바꾼다(M12, 두 화면 같은 문구).

방 링크 · 마지막 방 복귀로 기다리는 패널에는 첫 화면으로 버튼(`.btn`, 손가락 화면 48px)을 둔다. 판 중 재연결 패널에는 없다.

### 9.4 휴대폰 로비 · 생명주기 화면 (M12, `ui/lifecycleUi.ts` · `ui/lifecycle.css`)

- 모두 불투명 패널(`var(--panel)`, 알파 0.94면 뒤 역할 카드 글자가 비쳐서), 깎은 모서리 · 청록 테두리, 안전 영역 안쪽, 터치 대상 48px 이상, 글자 12px 이상
- **판 직전 터치 안내 카드**: 준비 뒤 명령 줄 바로 위에 뜨는 비모달 카드(준비 · 시작을 가리지 않음). 역할색 테두리, 제목 + 번호 목록 + 화면 밖 화살표 한 줄(번호 없음, 13px · 높이 500 이하 12px 흐린 글자, 설정 화면 통합) + 터치 화면 자리 그림(SVG, 번호가 목록 번호와 같아 색만으로 잇지 않는다) + "알겠어요". 처음에만 등장 움직임(`prefers-reduced-motion`이면 없음). 높이 500 이하 촘촘한 배치. 새 캐릭터 스타일이면 제목 왼쪽에 내 역할 정면 그림(56px, 높이 500 이하 44px — 가장 낮은 화면에서도 세로로 쌓지 않는다)
- **설정**: 설정 화면 통합에서 PC와 같은 설정 화면(9.5)으로 바꿨다. 설정 단추(아이콘 + '설정' 글자)는 첫 화면 로고 아래 · 방 화면 · 빠른 매칭 대기 명령 줄. 진동 · 터치 조작 안내 다시 보기는 설정 화면 조작 탭에 있다
- **뒤로 가기 확인 창**(터치 · 설치 앱, 판 중 — 봇과 연습 판도): 제목 + 본문 + 계속(주 버튼) · 나가기, Esc = 계속. 제목 · 본문은 판 종류(친구 방 · 빠른 매칭 · 연습)마다 다르고 모양은 같다
- **다른 탭 안내**: 서버 문구 + "여기서 계속하기"(누르기 전에는 다시 연결하지 않음), 폭 420px 이하
- **판 중 위치 표시**(첫 판 10초, `touchControls`): 이동 영역 점선 판 + '여기를 누르고 끌어 이동', 스틱 · 버튼 빛 고리. 입력을 막지 않고(pointer-events 없음) 화면 가운데(감옥)를 가리지 않는다

### 9.5 설정 화면 (설정 화면 통합, `ui/settingsPanel.ts` · `ui/settings.css` · `settingsModel.ts` · `prefs.ts`)

PC · 휴대폰이 **같은 구성의 한 화면**이다. 여는 곳: 첫 화면 로고 아래 · 방 화면 · 빠른 매칭 대기 명령 줄의 '설정' 단추, 판 중 메뉴 버튼(12.8). 문구는 `STORY_TEXT.md` 7절.

- **모양**: 화면 전체 막(`rgba(5,8,12,0.72)`, 흐림 필터 없음 — 판이 뒤에서 매 프레임 그려진다) + 가운데 깎은 패널(`.panel`, 폭 min(660px, 화면)). 머리(아이콘 + '설정' · '닫기') · 탭 줄 · 본문(카드 안에서만 스크롤) · 아래 줄('모두 기본값으로' · 저장 실패 안내). 막 · Esc · '닫기'로 닫는다. 안전 영역 안쪽, z-index 74(로비 · 터치 화면 · 깨우기 안내 위, 뒤로 가기 확인 · 다른 탭 안내 · 세로 안내 아래)
- **탭**: 그래픽 · 화면 · 소리 · 조작. 고른 탭 = 청록 굵은 막대(가로 탭은 아래, 세로 탭은 왼쪽) + 바탕 + 굵은 흰 글자(색만으로 구분하지 않기). 좌우 화살표 키로 옮긴다. 판 중에는 조작 탭이 없고 맨 위에 경고색 막대 + '판은 멈추지 않아요' 한 줄
- **줄**: 이름 · 고르는 칸(`.segs`/`.seg`, 고른 칸 = ✓ + 청록 바탕) 또는 밀대(`input[type=range]`, 청록, 값 % 글자) · '기본값'(되돌림 아이콘 + 글자, 이미 기본값이면 흐린 글자 + 사선 해치로 꺼짐) · 아래 13px 흐린 설명. 폭 600px 이상이면 이름 · 칸 · 기본값이 한 줄, 그보다 좁으면 쌓는다
- **주소 옵션으로 잠긴 줄**: 칸이 흐린 해치 + `aria-disabled`, 줄 아래 노란 글자(`#FCD34D`) + 링크 아이콘 '주소 옵션(?quality=low)이 이번 접속에 우선해요 …'
- **낮은 가로 화면**(높이 520 이하): 탭은 왼쪽 세로 칸(148px), 본문은 오른쪽, '모두 기본값으로'는 맨 위 줄(제목 · 닫기 사이). 저장 실패 · 되돌림 안내는 카드 아래쪽 본문 위에 겹쳐 띄운다. 가장 낮은 휴대폰(802×293)에서도 카드 · 탭 넷 · 닫기가 스크롤 없이 화면 안
- **손가락 화면**: 탭 · 칸 · 기본값 · 밀대 높이 48px 이상(`pointer: coarse`)
- **UI 크기**(화면 탭): 카드 · 로비 내용(`.lobby-content`) · 결과 상자(`.result-box`)에 CSS `zoom: var(--ui-zoom)`(1 · 1.15 · 1.3). 작게는 없다(글자 하한). 터치 판 HUD는 다음 판 배치에서 같은 배율(8.6). PC 판 HUD는 1920×1080 논리 화면이 창 크기를 따라 커지므로 바꾸지 않는다
- **성능**: DOM은 앱을 열 때 한 번 만들고, 열 때 줄마다 속성 몇 개만 맞춘다. 판 중 매 프레임 건드리는 것은 없다

| 항목 | 값 | 코드 |
|---|---|---|
| UI 크기 배율 보통 · 크게 · 아주 크게 | `1` · `1.15` · `1.3` | `prefs.UI_SIZE_SCALE.normal` `prefs.UI_SIZE_SCALE.large` `prefs.UI_SIZE_SCALE.xlarge` |

### 9.6 판 밖 성장: 레벨 칩 · 결과 '내 평가' (메타 a, `ui/levelChip.ts` · `ui/resultRating.ts` · `style.css`)

규칙은 `GAME_DESIGN.md` 12장, 문구는 `STORY_TEXT.md` 8절. 판 화면(HUD · 점수판 · 미니맵)에는 아무것도 더하지 않는다(0장 ①).

- **레벨 칩**(내 레벨만, 내 기기 기록): 깎은 칩(5px) 'Lv' 청록 글자 + 숫자(`.num`) + 다음 레벨까지 막대(44 × 6px, 청록). 높이를 늘리지 않는 자리에 둔다 — 첫 화면은 이름 칸 오른쪽, 연습 역할 고르기는 '취소' 왼쪽, 방 · 빠른 매칭 대기는 내 줄 '나' 꼬리표 옆 "Lv n" 꼬리표. 남의 레벨은 어디에도 그리지 않는다
- **내 평가 패널**(결과 화면, 받는 사람 자기 평가): 넓은 결과 상자(폭 761px 이상)는 승리 팀 옆 칸(격자 `hero rate`), 좁으면 기록자 메모 아래 — 960 × 540에서 스크롤 없이 들어가고, 휴대폰에서 기록자 메모가 위쪽에 남는다. 항목 넷 = 모양 아이콘(24 격자 · 2px 선, 항목마다 다른 그림) 둥근 배지 + 이름 + 단계 칸(마름모 4개 중 채운 수 = 단계) + 단계 글자. 아래 줄 = 'Lv n' + 레벨 막대(이번 판 몫은 빗금) + '경험치 +n' 칩(+ '레벨 업! Lv n' 꼬리표) + 경험치 나눔 한 줄(높이 620 이하에서는 숨기고 칩의 title로). 이번 판에 오른 최고 단계는 칸 위 '최고 단계' 꼬리표
- **단계는 색만으로 구분하지 않는다**(0장 ④): 칸 수 0~4 + 글자(없음 · 동 · 은 · 금 · 빛)가 정보이고 테두리 색은 덧붙인 단서다. 없음은 점선 테두리 + 흐린 아이콘
- **안내 줄**: 무효 판 · 이미 받은 판 = 흐린 글자, 저장 실패 = 경고색 글자 한 줄(콘솔 경고 없음)
- **나눠 받기**: 결과 화면 코드는 조각(`result`)이라, 받지 못하면 승리 팀 + 홈으로 · 다시 하기만 있는 작은 결과 상자 + '새 버전이 있어요' 띠(10.3 패널 · 버튼 그대로)

| 항목 | 값 | 코드 |
|---|---|---|
| 단계 색 없음 · 동 · 은 · 금 · 빛 | `#3B4B5C` · `#C08457` · `#CBD5E1` · `#FACC15` · `#67E8F9` | `style.css --tier-0` `style.css --tier-1` `style.css --tier-2` `style.css --tier-3` `style.css --tier-4` |

### 9.7 판 밖 성장: 불씨 · '내 기록' 창 (메타 b, `ui/levelChip.ts` · `ui/hub.ts` · `style.css`)

- **칩이 단추가 된다**: 'Lv n' · 레벨 막대 · 불씨 아이콘(24 격자 불꽃 + 안쪽 불씨, 연한 호박색 `#FDBA74` — 경고 주황 `#F59E0B`와 다른 색, 글자는 흰색) + 불씨 수 · 받을 접속 보상이 있으면 청록 점(빛나는 8px 원 — 읽어 주기 글자로도 알린다). 누르면 '내 기록' 창. 손가락 화면 48px
- **'내 기록' 창**(나눠 받는 조각 `hub`): 설정 화면(9.5)과 같은 막 + 깎은 패널(폭 min(560px, 화면)), 머리('내 기록' + 닫기) · 요약(Lv · 막대 · 경험치 · 불씨) · 오늘의 접속 보상 카드('n일째 연속' · 불씨 +n · '받기' 주 버튼 / 받았으면 ✓ '받았어요 — 내일 또 와요') · 오늘의 도전 셋(팀 꼬리표 · 문구 · 진행 막대 · n/목표 · 불씨 보상 또는 ✓ '완료') · 아래 한 줄 '자정에 새 도전'. 막 · Esc · 닫기로 닫는다
- **끝낸 도전은 색만으로 구분하지 않는다**: ✓ 아이콘 + '완료' 글자 + 빗금 막대(+ 초록 테두리)
- **결과 화면**: 경험치 칩 안에 '· 불씨 +n', 끝낸 도전은 '도전 완료 · 문구 · 불씨 +n' 한 줄(초록), 아니면 '오늘의 도전 n개 진행' 한 줄. 한 줄이 늘어 960 × 540에서도 넘치지 않게 낮은 창(높이 620 이하)에서는 평가 칸을 가로로(아이콘 왼쪽 · 이름과 단계 칸 두 줄, 칸 높이 약 62 → 36px) 놓고 '최고 단계' 꼬리표를 숨기며, 좁기까지 하면(폭 900 이하 — 휴대폰 가로) 단계 글자 대신 칸 수(마름모)와 읽어 주기 글자로 알린다

| 항목 | 값 | 코드 |
|---|---|---|
| 불씨 아이콘 색 | `#FDBA74` | `style.css --ember` |

### 9.8 판 밖 성장: 옷장 (메타 c, `ui/hub.ts` · `ui/wardrobe.ts` · `style.css`)

- **'내 기록' 창 탭 둘**: 오늘(9.7) · 옷장. 설정 화면(9.5) 탭과 같은 모양(고른 탭 = 아래 굵은 청록 막대 + 밝은 굵은 글자 + 바탕), 낮은 화면에서도 가로 두 칸. 창은 늘 오늘 탭부터 연다
- **옷장**(나눠 받는 조각 `wardrobe`, 탭을 처음 열 때 받는다): 왼쪽 미리보기 — 정면 그림(4.5, 고른 의상) + '게임 화면' 위 그림(앞이 위, 점선 원 안 — 판에서 보이는 모습 그대로) + 생존자는 역할 칸 셋(러너 · 가드 · 스카우트), 그 아래 '꾸미기뿐 · 괴물 화면에서 생존자는 늘 흰 모습' 한 줄. 오른쪽 팀 칸(생존자 · 괴물) + 불씨 수, 의상 칸 넷(2 × 2), 행동 단추 하나, 알림 한 줄
- **의상 칸은 색만으로 구분하지 않는다**: 입는 중 = ✓ 아이콘 + '입는 중'(초록 글자), 가짐 = '가짐' 글자, 잠김 = 자물쇠 아이콘 + 불씨 아이콘 + 값(이름은 흐린 글자). 고른 칸 = 청록 테두리 + 왼쪽 굵은 막대
- **행동 단추**: 입는 중이면 꺼진 '입는 중', 가졌으면 '입기'(주 버튼), 잠겼으면 '해금 · 불씨 n' → 한 번 누르면 '한 번 더 누르면 해금 (불씨 n)'(경고 주황 아래 막대 — 불씨를 쓰는 확인), 불씨가 모자라면 꺼진 '불씨가 n 모자라요'
- 960 × 540 · 800 × 360에서 스크롤 없이 — 낮은 화면(높이 520 이하)은 탭을 제목 줄에 올리고(제목 · 탭 · 닫기) 정면 그림 104px · 위 그림 48px로 줄인다. 손가락 화면은 탭 · 팀 · 역할 · 의상 칸 48px

---

## 10. 아이콘 · 폰트 · 패널

### 10.1 아이콘 (`art/icons.ts`)

24 격자 · 선 2px · 둥근 끝과 이음의 SVG 경로. **같은 경로**를 HTML에서는 인라인 SVG(`iconSvg`, 기본 `currentColor`, 라벨이 없으면 `aria-hidden`), Phaser HUD에서는 Canvas2D로 아틀라스에 굽는다(`drawIcon`). 상태 · 행동 아이콘은 서로 다른 실루엣이다(색만으로 구분하지 않기). 역할 문양은 아이콘이 아니라 `shapes.GLYPHS`(4.4).

| 항목 | 값 | 코드 |
|---|---|---|
| 격자 | `24` | `icons.ICON_GRID` |
| 선 두께 | `2` | `icons.ICON_STROKE` |

아이콘 목록(35개, `tests/unit/visual-spec.test.ts`가 `ICONS`와 대조):

| 묶음 | 아이콘 |
|---|---|
| 괴물 행동 | `attack` 발톱 세 줄 · `dash` 화살표 + 속도선 · `roar` 입 + 음파 · `visionSearch` 넓은 부채꼴 · `visionHunt` 좁고 긴 부채꼴 |
| 생존자 능력 · 구조 | `sprint` » · `shove` 방패 + 미는 화살 · `track` 조준경 · `rescue` 열린 자물쇠 |
| 목표 · 장소 | `prison` 잠긴 자물쇠 · `point` 마름모 · `exit` 문 + 나가는 화살 · `timer` 시계 · `map` 접힌 지도 · `note` 연필 |
| 상태 | `heart` 체력 · `injured` 금 간 마음 · `dead` × 원 · `escaped` 열린 문 + 나간 방향 · `disconnected` 끊긴 연결 · `warn` 경고 삼각 · `eye` 발각 |
| 진행 · 준비 | `check` 완료 · `pause` 정지 · `play` 진행 중 · `ready` 준비 완료 · `waiting` 모래시계 |
| 로비 · 화면 | `crown` 방장 · `bot` 봇 · `link` 링크 복사 · `sliders` 설정 · `fullscreen` 전체 화면 · `back` 뒤로 · `replay` 다시 하기 · `scoreboard` 점수판(터치 버튼) |

### 10.2 UI 폰트 — Noto Sans KR 서브셋

| 항목 | 값 | 코드 |
|---|---|---|
| 글꼴 이름 | `'Noto Sans KR'` | `fonts.UI_FONT_FAMILY` |

- 파일: `client/public/fonts/noto-sans-kr-ui.woff2` 한 파일(가변 굵기 wght 100~900, 307,088B), 글자 목록 `noto-sans-kr-ui.txt`(2,490자 = ASCII 95 + KS X 1001 한글 2,350 + 기호 45), 라이선스 전문 `OFL.txt`. 빌드 결과 `/fonts/`로 나간다. 출처 · 라이선스는 `docs/CREDITS.md`
- 다시 만들기: `scripts/font-subset.mjs`(`npm run font:subset -- <NotoSansKR[wght].ttf>`, `subset-font`는 저장소 의존성이 아니라 `npm i --no-save`). 소스 · 문서 문자열 글자 + KS X 1001 한글 + ASCII 중 원본에 있는 글자만 남기고, 만든 woff2의 cmap을 다시 읽어 검증한다. 새 문구에 목록 밖 글자가 생기면 `tests/unit/fonts.test.ts`가 실패한다
- 글꼴 스택(Phaser · CSS 같은 순서): `'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`(`fonts.UI_FONT` = `style.css --font`)
- 받기: `index.html`이 `<link rel=preload crossorigin>`으로 JS와 나란히 받기 시작하고, `@font-face`는 `font-display: swap` · `unicode-range` 없음. 부팅 때 `loadUiFonts(3000)`이 굵기 400 · 500 · 700 · 800을 받고 확인한 뒤 판 장면을 만든다(먼저 만든 Phaser 글자는 대체 글꼴로 굳는다). 시간 초과면 대체 글꼴로 시작하고, 늦게 받으면 `onUiFontsLate` → 활성 장면 글자를 다시 재고 그린다(`relayoutAll`). 디버그 `__DECOY__.fonts` = `{ ready, atSceneStart }`
- 숫자는 고정폭: DOM은 `font-variant-numeric: tabular-nums`(`.num`), Phaser는 글자마다 같은 폭 칸(Digits). 한국어 줄바꿈은 `word-break: keep-all`
- 최소 글자: HUD 15 논리 px, DOM 키캡 · 작은 라벨 12~13px

### 10.3 패널 · 버튼 (DOM, `client/src/style.css`)

| 토큰 | 값 | 코드 |
|---|---|---|
| 화면 바탕 | `#0B1622` | `style.css --bg` |
| 패널 | `#0F1B27` | `style.css --panel` |
| 버튼 바탕 | `#132433` | `style.css --panel-2` |
| 입력 우물 | `#08121B` | `style.css --well` |
| 테두리 | `#1E3A4A` | `style.css --edge` |
| 버튼 테두리 | `#2C5A6E` | `style.css --edge-2` |
| 청록 | `#22D3EE` | `style.css --neon` |
| 어두운 청록 (주 버튼) | `#0E7490` | `style.css --neon-dim` |
| 청록 글자 | `#67E8F9` | `style.css --neon-text` |
| 본문 · 흐린 · 더 흐린 글자 | `#E2E8F0` · `#94A3B8` · `#7C8CA0` | `style.css --text` `style.css --text-dim` `style.css --text-faint` |
| 탈출 · 경고 · 위험 · 위험 바탕 · 위험 글자 | `#34D399` · `#F59E0B` · `#EF4444` · `#B91C1C` · `#F87171` | `style.css --exit` `style.css --warn` `style.css --danger` `style.css --danger-dark` `style.css --danger-text` |

- **깎은 모서리**: `clip-path`로 네 모서리를 45° 깎고, 1px 테두리는 `::after`의 짝홀 다각형 고리로 그려 대각선까지 이어진다(`--cut` 깎는 길이 · `--bw` 두께 · `--ring` 색). 바탕은 요소 자신의 `background-color`라 DOM 대비 E2E가 그대로 잰다. 빛은 클립 밖으로 못 나가므로 바깥 요소의 `drop-shadow`나 `inset box-shadow`로
- **패널**: `#0F1B27` 알파 0.94 + 위쪽 옅은 청록 그라디언트, 테두리 `#24475A`, 깎기 12px, 왼쪽 위 청록 눈금(36 × 2px, 빛)
- **깎기 길이**: 패널 12 · 역할 카드 14 · 기본 10 · 버튼 8 · 키 타일 7 · 입력 6 · 칩 5 px
- **버튼**: 높이 44px 이상. 주 버튼 = `#0E7490` 바탕 + `#22D3EE` 테두리 + 흰 굵은 글자(5.36:1), 위험 = `#B91C1C` + `#EF4444` 테두리 + 흰 글자, 보통 = `#132433` + `#2C5A6E`(호버 · 포커스 = 청록 테두리 + 안쪽 빛), 비활성 = 패널 바탕 + 사선 해치 + `#7C8CA0` 글자(5.07:1) + `not-allowed`
- **키캡**(DOM): `#102231` 바탕, `#3B5B70` 1px 테두리 + 아래 3px, 둥근 4px, 12px 굵게. **키 타일**(방 코드): 깎기 7px, 청록 글자 30px
- 역할색 변수(`uiArt.ts` roleVars): `--rc` 역할색 · `--rt` 글자용 역할색 · `--rf` 고른 카드 바탕 · `--rg` 빛 번짐(JS가 계산, `color-mix`를 쓰지 않음)

### 10.4 패널 (Phaser HUD, `hudArt.ts` paintPlate)

같은 언어를 아틀라스에 굽는다: `#0F1B27` 알파 0.92 + `#1E3A4A` 1 기기 px 테두리 + 깎은 왼위 모서리를 따라 청록 35% 강조 선. 카드는 왼위 · 오른아래 두 모서리만 8px 깎는다(`cut [8, 0, 8, 0]`), 오버레이는 12px · 알파 0.95. 내 카드는 역할색 2px 테두리 + 글자용 역할색 강조. HUD 키캡 = `#172736` + `#3D566B` 테두리 + 아래 그림자 줄, 깎기 3px. 거점 게이지 · 타이머는 양 끝이 뾰족한 육각 막대.

### 10.5 로고

- `docs/images/logo_decoy.png`(213 × 213, 원본, 지우지 않음): 파비콘 · 작은 크기(깨우기 안내 1x)
- `docs/images/logo_decoy.svg` = `client/public/logo.svg`(같은 파일, 원본과 같은 디자인으로 다시 그린 벡터, 외부 참조 · 스크립트 없음): 로비 · 결과 큰 로고, 기기 픽셀 배율 2 이상, 앱 아이콘(M14). 비교 213px IoU 0.996 · 평균 ΔE 2.31(`artifacts/remaster/logo-compare.png`)
- 로고 옆 "DECOY" 글자는 코드(CSS `.wordmark`)로 얹는다(로고 이미지에 글자 없음)

---

## 11. 외부 에셋 정책

- 그래픽은 코드로 그린다. 외부 에셋은 **CC0** 또는 **계획에서 승인한 라이선스**(지금은 UI 폰트 Noto Sans KR의 SIL OFL 1.1 하나)만 쓴다
- 넣는 모든 이미지 · 폰트 · 소리 파일은 `docs/CREDITS.md`에 경로 · 출처 · 라이선스를 적는다. `tests/unit/credits.test.ts`가 `client/public` · `client/src` · `docs` 아래의 이미지 · 폰트 · 소리 파일이 모두 CREDITS 표에 있는지 확인한다(새 파일이 들어오면 실패, `artifacts/`의 스크린샷은 제외)
- 라이선스가 불분명한 것(출처 없는 이미지, "무료" 표기만 있는 것, 생성형 AI 결과물의 게임 내 사용)은 쓰지 않는다
- 라이선스 전문이 필요한 것(OFL)은 배포물에 같이 싣는다(`client/public/fonts/OFL.txt` → 빌드 `/fonts/OFL.txt`)
- **컨셉 이미지**(`docs/images/concept_*.png`, 생성형 AI)는 분위기 참고만 한다. 게임 · 스토어 이미지에 쓰지 않고, 다음은 따르지 않는다: 거점별 색(역할색과 겹침), 부채꼴 노랑 · 주황 · 빨강 3단계, 괴물 여러 마리, 아이템 상자. 가져온 것은 "어두운 시설 · 청록 네온 · 붉은 후드 괴물" 분위기와 concept_06의 깎은 모서리 게이지 언어뿐이다

---

## 12. 카메라 (따라가는 카메라)

구현: `client/src/render/camera.ts`(순수: 창 · 따라가기 · 앞당김 · 흔들림), `render/cameraDirector.ts`(순수: 무엇을 따라갈지 · 관전), `scenes/GameScene.ts` updateCamera(매 프레임 창 → `layout.CAM`), `render/offscreen.ts`(순수: 화면 밖 화살표 대상 · 자리), `ui/edgeMarkers.ts`(화살표 그림), `aimHold.ts`(괴물 마우스 조준), `art/mapChunks.ts` · `art/mapArt.ts`(정적 맵 조각). 확대 수준을 고른 이유 · 후보 비교는 DECISIONS 9절과 `artifacts/camera/`.

### 12.1 보이는 창

- 맵 사각형(논리 1428 × 952, 3:2) 안에 **16 × 10.7타일**을 그린다(확대 3). 모든 기기 · 배치에서 맵 사각형이 같은 3:2라 보이는 타일 수가 같다 — 넓은 화면은 HUD 여백이 넓어질 뿐 맵을 더 보지 않는다. 플레이어는 확대 수준을 바꿀 수 없다(공정성). `?cam=1~6`은 로컬 주소(localhost · 127.0.0.1 · ::1)에서만 받는 시험 · 촬영용이다
- 창 밖(HUD 띠 · 여백)은 화면 바탕색 가리개(깊이 37)로 덮는다. 맵 밖은 보이지 않는다: 창은 늘 맵 안에 머문다(맵 끝에 붙으면 캐릭터가 화면 가운데에서 벗어난다)
- 창 자리는 기기 픽셀 격자에 맞춘다(`snapView`) — 정적 맵 · 글자 · 선이 흐려지지 않고 프레임마다 반 픽셀씩 흔들리지 않는다. **내 캐릭터**는 맞추며 옮긴 나머지(기기 1px 미만, `CameraDirector.snapResidual`)만큼 같이 옮겨 그려 화면에서는 맞추기 전 창 기준 자리에 둔다 — 따라가는 동안 화면 위 내 자리가 흔들리지 않는다(내 움직임 고르기, DECISIONS 10절). 다른 캐릭터 · 효과는 맵에 붙은 자리 그대로. 진단 주소 `?camSnap=0`은 창을 격자에 맞추지 않는다(실기기 견주기용, 기본은 맞춤 — DECISIONS 12절)

| 항목 | 값 | 코드 |
|---|---|---|
| 기본 확대 (맵 가로의 1/3) | `3` | `layout.DEFAULT_CAM_ZOOM` |
| 비교한 후보 ① 가깝게 · ② 중간 · ③ 넓게 | `4` · `3` · `2` | `camera.CAM_LEVELS.near` `camera.CAM_LEVELS.mid` `camera.CAM_LEVELS.wide` |

### 12.2 따라가기 · 괴물 앞당김

- **따라가기**: 창 가운데가 목표를 지수 감쇠로 따라간다 — 목표가 프레임 사이 곧게 움직였다고 보고 정확히 푼 식(`camera.followLinear`)이라, 같은 빠르기로 걸으면 늦음이 늘 빠르기 × τ로 프레임 간격(8.3 · 16.7ms가 섞여도)과 상관없다. 목표는 같은 프레임의 내 그린 자리(rAF 시각 기준). 따라가기가 늦어도 내 캐릭터는 창 가장자리에서 1.4타일 안으로 들어가지 않는다
- **괴물 앞당김**: 괴물 화면은 창 가운데를 조준 방향으로 민다 — 지금 시야 모드의 부채꼴 ∪ 근접 원이 창 안에 들고(괴물 몸은 가장자리에서 1.6타일 안쪽), 앞당김은 늘 **조준과 평행**이다(카메라가 움직여도 괴물은 조준선 위에서만 미끄러진다). 탐색 → 추적 전환은 앞당김 시간 상수로 부드럽게
- **조준 안정**(`aimHold.ts`): 괴물 마우스 조준은 커서가 실제로 움직였을 때 커서 아래 월드 자리를 재고, 그 사이에는 그 자리를 기준 카메라(앞당김 · 따라가기 지연 · 흔들림 없이 괴물을 가운데 두고 맵 안으로만 자른 창)를 따라 옮긴 곳을 겨눈다 — 맵 가운데에서 마우스를 가만히 두고 걸으면 같은 방향을 계속 보고, 맵 끝에 막힌 화면에서는 화면 속 괴물이 움직인 만큼 조준이 커서 쪽으로 돈다. 앞당김이 조준을 끌지 않는다(되먹임 없음). 터치 조준은 스틱 방향이라 카메라와 무관하다
- **잘라 옮기기**: 목표가 창 폭의 0.6배보다 크게 튀거나(순간 이동 · 수감 · 관전 대상 바꾸기 · 탈출 뒤 자동 관전) 한 축으로 가장자리 띠 밖까지 튀면 미끄러지지 않고 바로 옮기며, 맵 창을 잠깐 어둡게 했다가 밝힌다(어지럽지 않게). 판 시작은 첫 프레임에 바로 그 자리

| 항목 | 값 | 코드 |
|---|---|---|
| 따라가기 · 앞당김 · 관전 시간 상수 (초) | `0.12` · `0.32` · `0.2` | `camera.CAMERA.followTauS` `camera.CAMERA.lookTauS` `camera.CAMERA.spectateTauS` |
| 내 캐릭터 · 앞당김 괴물의 가장자리 여유 (타일) | `1.4` · `1.6` | `camera.CAMERA.edgeMargin` `camera.CAMERA.lookMargin` |
| 잘라 옮기는 튐 (창 폭 비율) | `0.6` | `camera.CAMERA.cutFraction` |
| 어두워짐 · 밝아짐 (ms) · 가장 어두울 때 알파 | `90` · `220` · `0.55` | `camera.CAMERA.dipOutMs` `camera.CAMERA.dipInMs` `camera.CAMERA.dipAlpha` |

### 12.3 흔들림 (한 곳에서)

화면 흔들림은 `camera.ts` ScreenShake 하나가 만든다(월드 창만 흔들고 HUD는 그대로). 세기 배율 하나(`shake.scale`)로 모두 줄인다 — OS의 '동작 줄이기'이거나 설정 화면 탭 '화면 흔들림 줄이기'가 켜져 있으면 0(`prefs.shakeScaleOf`, 판 중에 바꿔도 바로). 흔들림은 감쇠하는 매끄러운 잡음이고 동시에 4개까지 더한다.

| 언제 | 세기 (타일) · 길이 (ms) | 코드 |
|---|---|---|
| 생존자: 내가 맞음 | `0.1` · `220` | `camera.SHAKE.hitMe.amp` `camera.SHAKE.hitMe.ms` |
| 괴물: 내 공격이 맞음 | `0.05` · `140` | `camera.SHAKE.strike.amp` `camera.SHAKE.strike.ms` |
| 괴물: 내가 기절 | `0.09` · `260` | `camera.SHAKE.stunMe.amp` `camera.SHAKE.stunMe.ms` |
| 괴물: 내 포효 | `0.06` · `320` | `camera.SHAKE.roar.amp` `camera.SHAKE.roar.ms` |

### 12.4 화면 밖 화살표

창 밖 대상을 창 가장자리 안쪽 배지 + 대상 쪽 셰브론으로 가리킨다. **서버가 보낸 것만**: 대상은 이번 프레임 메인 화면에 그린 목록(팀원 · 괴물 · 탐지 · 포효 표시) · 스냅샷 세계 상태(거점 · 탈출구 · 팀원 상태) · 고정 맵 자리에서만 고른다 — 메인 화면 · 미니맵보다 많은 정보가 나올 수 없다. 출처가 사라진 프레임에 화살표도 바로 사라진다(R8).

| 화면 | 대상 | 그림 (배지 안 · 테두리 색) |
|---|---|---|
| 생존자 | 자유인 팀원 | 역할 문양 · 역할색 |
| 생존자 | 공유 시야로 보이는 괴물 | 괴물 문양 · 빨강 |
| 생존자 | 스카우트 탐지 · 포효한 괴물 자리 | 탐지 아이콘 · 스카우트 초록 / 포효 아이콘 · 주황 |
| 생존자 | 구조가 필요한 감옥(팀원 수감, 내가 자유) | 감옥 아이콘 · 감옥 빨강 |
| 생존자 | 끝나지 않은 거점 | 다이아 + A/B: 점령 중 청록 · 정지 주황 · 대기 흐림 |
| 생존자 | 활성 · 열린 탈출구 | 탈출 아이콘 · 초록 (활성은 조금 흐리게) |
| 생존자 (관전 중) | 수감 중인 내 자리 | 내 역할 문양 · 흰 테두리 |
| 괴물 | 점령 중인 거점만 | 다이아 + A/B · 주황, 0.5초 깜빡임 |
| 괴물 | 포효로 드러난 자리만 | 흰 공통 문양 · 흰 테두리 (역할 · 생존자 id 없음) |

- 자리: 창 가운데 → 대상 반직선이 안쪽 사각형(창 가장자리에서 30 그림 단위)과 만나는 점. 겹치면 둘레를 따라 밀고, 터치 엄지 대상(조준 스틱 · 버튼과 그 아래 이름표, 이동 스틱이 쉬는 고리) · 맵 안 미니맵 · 보이는 안내 줄 사각형은 둘레를 따라 비켜난다. 한 번에 8개까지(괴물 > 탐지 > 포효 > 감옥 > 팀원 > 나 > 탈출구 > 거점). 캐릭터 몸과 겹치면 흐리게
- 색만으로 구분하지 않기(0장 ④): 문양 · 아이콘 모양이 다르다. 배지 위 아이콘 대비는 그래픽 3:1 이상(`hudArt.HUD_TEXT_PAIRS` '화살표 …')

| 항목 | 값 | 코드 |
|---|---|---|
| 배지 반지름 · 테두리 · 창 가장자리에서 배지 가운데 · 배지 사이 (그림 단위) | `17` · `2.5` · `30` · `5` | `hudArt.EDGE_ART.r` `hudArt.EDGE_ART.ring` `hudArt.EDGE_ART.inset` `hudArt.EDGE_ART.gap` |
| 배지 안 문양 · 아이콘 크기 (그림 단위) | `22` · `18` | `hudArt.EDGE_GLYPH` `hudArt.EDGE_ICON` |

### 12.5 시점 돌려보기 (관전)

- 생존자가 수감 · 사망 · 탈출했을 때만: 팀 카드를 누르거나(PC 클릭 · 터치 탭) 숫자 키 1 · 2 · 3(카드 순서)으로 동료 화면으로 옮겨 본다. 내 카드 · 내 번호는 내 시점으로 돌아온다. 사망 · 탈출하면 자동으로 동료(자유인 동료 먼저)를 따라가고, 수감 중에는 내 자리(감옥)가 기본이다
- 생존자 화면은 세 명의 시야를 합쳐 보므로 창을 동료 자리로 옮겨도 서버가 이미 보낸 것만 보인다(새 정보 없음). 괴물은 관전하지 않는다
- 관전 중인 카드는 청록 테두리 + PC '보는 중' 태그 · 터치 눈 아이콘, 미니맵은 그 동료에 청록 고리, 아래 안내 줄은 바꾸는 방법(`docs/STORY_TEXT.md`). 카드는 캔버스 그림이라 DOM 터치 대상이 아니다 — 창 단위 pointerdown을 캡처해 캔버스 논리 좌표로 카드 사각형과 맞춘다(탈출한 터치 생존자의 터치 대상 0개 그대로)

### 12.6 미니맵 (확대 화면)

- 확대 화면에서는 맵 전체가 보이지 않아 미니맵이 필수다. PC · 넓은 휴대폰은 옆 칸 그대로(8.2 · 8.6), 옆 칸에 자리가 없으면(16:9 휴대폰 · 태블릿 · 가장 낮은 휴대폰의 괴물) **맵 창 안 오른쪽 위 구석**에 둔다: 맵 가로의 0.22배 · 200 CSS px 이하, 오른쪽 위 시스템 버튼이 맵에 걸치면 그 아래 또는 그 왼쪽(더 크게 들어가는 쪽), 오른쪽 아래 엄지 버튼 무리 위에서 멈춘다. 60 CSS px보다 작아지면 두지 않는다(`tests/unit/touch-hud.test.ts`)
- 판 중 창이 낮아져 엄지 버튼이 옆 칸 미니맵을 덮으면 같은 크기 틀을 맵 창 안으로 옮긴다: 오른쪽 위 구석 → 거기 걸친 시스템 버튼 아래 → 그 왼쪽(맵 오른쪽 절반 안) 순으로 엄지 · 시스템 버튼과 겹치지 않는 첫 자리(`layout.minimapFallback`). 모두 막히면(또는 확대 1이면) 숨긴다
- 정보는 같다: 바닥 = 맵 전체 합성(안개), 엔티티 = 메인 화면에 그린 목록만. 보이는 창 사각형 · 거점 · 탈출구 상태(양쪽 화면에 같이 오는 세계 상태) · 관전 고리를 더 그린다

| 항목 | 값 | 코드 |
|---|---|---|
| 맵 안 미니맵 폭 (맵 가로 비율) · 상한 (CSS px) · 맵 끝 여백 (CSS px) · 최소 (CSS px) | `0.22` · `200` · `6` · `60` | `layout.MINIMAP_INSET.frac` `layout.MINIMAP_INSET.maxCss` `layout.MINIMAP_INSET.margin` `layout.MINIMAP_INSET.min` |

- **지도 크게 보기**(설정 화면 통합): 판 중 미니맵을 누르면(PC 클릭 · 터치 탭) 맵 창 가운데에 같은 지도를 크게 띄우고, 어디를 눌러도(PC는 Esc도) 닫는다. **정보는 작은 미니맵과 같다** — 같은 바닥 합성(안개) · 같은 엔티티 목록(이번 프레임 메인 화면에 그린 것) · 같은 세계 상태. 괴물 화면의 생존자는 흰 공통 실루엣 그대로(0장 ③). 바닥은 작은 미니맵이 다시 그릴 때만 다시 그린다. 캔버스를 눌러 닫는 누름은 공격 · 관전 · 카드 고르기로 가지 않는다. 판 중 메뉴를 열면 닫힌다. PC 첫 판 조작 안내 · 설정 조작 탭에 '지도를 누르면 크게' 한 줄
- **화면 해상도 바닥**(남은 문제 정리): 열려 있는 동안 크게 본 그림이 화면에서 차지하는 기기 px(논리 폭 × 백버퍼 배율)에 맞춰 바닥을 **따로 합성**한다 — 작은 미니맵과 **같은 기록(시야 채움 · 거점 · 탈출구) · 같은 빛 지도 · 같은 테두리 리프트**를 큰 격자로, 정적 맵은 그 해상도로 **직접 굽는다**(작은 미니맵 · 본 화면과 같은 그림체 — 큰 그림을 줄이면 선이 실제 비율대로 가늘어져 흐릿해 보였다). 판 중이라 한 프레임에 `stepMs`씩 1타일 띠 · 발광 줄 단위로 나눠 굽고(맵 그림 캐시 밖 — 판 배율 · 미니맵 그림을 밀어내지 않는다. 발광은 판 전에 구운 것이 있으면 그것을 더한다) 큰 바닥 합성은 다 구운 다음 프레임에 한다. 그때까지 몇 프레임은 작은 미니맵 합성을 늘려 그린다(예전 그림). 해상도는 텍스처 예산(높음 · 중간 32MiB, 낮음 8MiB)에서 다른 텍스처를 뺀 만큼(여유 `budgetMargin`)만 올리고, 작은 미니맵 합성 폭 이하로 충분하면(휴대폰 높음 · 중간) 따로 굽지 않는다. 닫으면 바닥 캔버스 · 텍스처를 놓는다. 다 구운 바닥으로 바꿔 그리는 것 말고는 작은 미니맵이 다시 그릴 때만 다시 그린다
- 한계: 품질 높음 · PC 1920×1080 배율 2(닫혀 있어도 텍스처 약 29.4MiB)는 예산이 남은 만큼(약 954px — 화면은 1776px)만 올린다. 화면 해상도보다 낮은 백버퍼(품질 낮음 · 휴대폰 배율 상한)는 바닥도 그 백버퍼 해상도까지다(게임 화면 전체와 같다, PERF.md 7절)

| 항목 | 값 | 코드 |
|---|---|---|
| 크게 본 지도 틀 높이 (맵 창 높이 비율) · 폭 상한 (맵 창 폭 비율) | `0.66` · `0.96` | `prefsFx.MINIMAP_BIG.heightFrac` `prefsFx.MINIMAP_BIG.maxWidthFrac` |
| 크게 본 지도 표시 그림 · 보이는 창 선 배율 · 깊이 올림 | `1.6` · `1.5` · `17` | `prefsFx.MINIMAP_BIG.iconScale` `prefsFx.MINIMAP_BIG.lineScale` `prefsFx.MINIMAP_BIG.depthShift` |
| 크게 본 지도 바닥: 텍스처 예산 여유 (바이트) · 폭 상한 (텍셀) · 판 중 나눠 굽기 한 프레임 예산 (ms) | `262144` · `2048` · `4` | `prefsFx.MINIMAP_BIG_TEXELS.budgetMargin` `prefsFx.MINIMAP_BIG_TEXELS.maxW` `prefsFx.MINIMAP_BIG_TEXELS.stepMs` |
| 텍스처 예산 높음 · 중간 · 낮음 (바이트) | `33554432` · `33554432` · `8388608` | `presets.TEXTURE_BUDGET.high` `presets.TEXTURE_BUDGET.medium` `presets.TEXTURE_BUDGET.low` |

### 12.7 맵 그림 (확대 화면)

- 정적 맵 · 발광은 **판 전에** 판 배율 맵 전체 그림(CPU 캔버스)으로 나눠 굽는다: 로비 · 첫 화면의 남는 시간(requestIdleCallback)에 공통 준비(도형 · 잡음 지도 · 발광 지도)를 한 걸음씩, 그다음 2타일 띠씩. 판 장면을 만들 때 덜 구웠으면 마저 굽는다. 판 중에는 칠하지 않는다. 판 중 품질(자동 하향) · 해상도가 바뀌어 배율이 달라지면 새 배율 그림을 프레임마다 8ms씩 나눠 굽고, 다 구운 뒤에 안개 레이어를 바꾼다(그동안 지난 그림을 그대로 그린다)
- GPU(품질 높음 · 중간): 보이는 창 + 둘레 2타일의 조각(약 192 px 정사각)만 조각 아틀라스 텍스처 칸에 담는다 — 맵 전체 그림에서 복사 + 그 칸만 올리기(조각 하나 1ms 안팎), 둘레 조각은 프레임마다 1.5ms 예산 안에서 미리. Canvas(낮음): 창 + 둘레 1.5타일 정수 타일 영역만 잘라 합성한다
- 품질 단계마다 맵 그림 텍셀 상한(`presets.mapTexels`)과 캐릭터 아틀라스 텍셀 상한(`presets.charTexelCap`)을 둬 텍스처 예산 32MiB(낮음 8MiB) 안에 든다(PERF.md)

### 12.8 판 중 메뉴 · FPS 칩 (설정 화면 통합)

판 중에도 설정 화면(9.5)을 그래픽 · 화면 · 소리 탭으로 연다. **판은 멈추지 않는다**(온라인 판) — 여는 동안 판 장면이 키 · 마우스 · 터치 입력을 받지 않고(누르던 키는 뗀 것으로, 이동 0 · 버튼 0 입력을 계속 보낸다), 판 · 그리기는 그대로 흐른다. 결과 · 로비로 가면 닫힌다.

- **닫을 때 이어받기**(남은 문제 정리): 닫는 순간 실제로 누르고 있는 **이동 키**(PC — 연 전부터든 여는 동안 눌렀든)와 **이동 스틱 손가락**(터치 — 열 때 누르고 있던 손가락이 아직 닿아 있으면 같은 중심 · 지금 손가락 자리로)을 이어받아 다시 누르지 않아도 걷는다. 버튼 키(능력 · 구조 · 돌진 · 포효) · 마우스 버튼 · 조준 스틱 · 터치 버튼은 이어받지 않고 누른 신호도 만들지 않는다 — 닫으려고 누른 Esc · 닫기 클릭 · 닫기 탭 · 바깥 누르기가 게임 입력으로 새지 않는다. 여는 동안 창을 떠났으면(blur · 숨김) 이어받을 키가 없다
- **두 번째 손가락 탭**: 이동 스틱을 누른 채 다른 손가락으로 설정 화면 단추(닫기 등)를 탭하면 브라우저가 click을 만들지 않아 눌리지 않았다 — 첫 손가락이 아닌 손가락이 단추에서 눌렸다 그 단추 안에서 떼어지면 그 단추를 누른다(한 번만)

- **PC**: 위 띠 왼쪽(팀 카드 왼쪽 끝 줄)에 '설정' + `Esc` 키캡 버튼. 팀 카드 · 맵 사각형 · 거점 A 게이지와 `gapCss` 넘게 떨어지게 둔다(`matchMenuButton.menuButtonPlace`): 띠가 버튼보다 높으면 띠 가운데, 낮으면 맵 위 끝 위(띠 + 캔버스 위 여백)나 맵 왼쪽 옆(팀 카드 위 끝까지) 중 덜 줄이는 쪽, 캔버스 위 여백(레터박스, 800×600 등)에 다 들어가면 그 가운데에 원래 크기로. 들어가지 않으면 들어가는 만큼 줄인다(CSS `scale`, 하한 `minScale` — 960×540 약 0.8배 · 1024×576 약 0.85배, 1280×720 이상은 줄이지 않는다). 예전에는 960×540에서 44px 그대로 캔버스 맨 위라 팀 카드 위 테두리에 약 5px 걸쳤다. Esc: 크게 본 지도가 열려 있으면 먼저 닫고, 아니면 판 중 설정을 열고 닫는다(설정 화면 안에서 처리한 Esc는 다시 열지 않는다)
- **터치**: 오른쪽 위 시스템 버튼 줄의 '설정'(조절 아이콘, 점수판 왼쪽 — 좌우 반전이면 거울 자리). 손가락을 댈 때 열고, 손을 뗄 때 생기는 click이 새로 뜬 단추에 떨어지지 않게 설정 화면이 연 손가락의 click을 버린다. 여는 동안 터치 화면은 꺼진다(흐림)
- **FPS · 핑 칩**(화면 탭 'FPS · 핑 표시', 기본 꺼짐): 맵 창 왼쪽 위 안쪽 12px 글자 한 줄 '{fps} FPS · 핑 {ping}ms'(모르면 '-'), 누를 수 없음, 글자는 초당 2번까지만 고친다. `?debug=1` 오버레이 칩 · 터치 시스템 버튼(좌우 반전)이 같은 구석이면 그 아래. 화면 밖 화살표가 칩을 피한다

| 항목 | 값 | 코드 |
|---|---|---|
| PC 메뉴 버튼 왼쪽 (논리 px) · 높이 (CSS px) | `14` · `44` | `matchMenuButton.MENU_BUTTON.leftLogical` `matchMenuButton.MENU_BUTTON.heightCss` |
| PC 메뉴 버튼이 피할 HUD와 간격 (CSS px) · 작은 창에서 줄이는 하한 (배) | `4` · `0.4` | `matchMenuButton.MENU_BUTTON.gapCss` `matchMenuButton.MENU_BUTTON.minScale` |
| FPS 칩 글자 고치는 간격 (ms) · 맵 안쪽 여백 · 피할 것 아래 간격 (CSS px) | `500` · `6` · `4` | `perfChip.PERF_CHIP.updateMs` `perfChip.PERF_CHIP.insetCss` `perfChip.PERF_CHIP.gapCss` |

---

## 13. 조작 배치 편집 (설정 화면 통합, `controlLayout.ts` · `ui/layoutEditor.ts` · `ui/layoutEditor.css`)

터치 기기의 설정 화면 조작 탭 '조작 배치 편집'(**로비에서만**)으로 연다. 이동 스틱 · 조준 스틱 · 모든 터치 버튼(시스템 버튼 포함)을 끌어 옮기고 크기를 바꾼다. 생존자 · 괴물 배치를 따로 저장한다(`decoy:controlLayout`). 배치는 터치 화면 자리만 바꾼다 — 규칙 · 판정 · 서버와 무관하다.

- **화면**: 판과 1:1(창 CSS px). 판 중과 같은 자리 계산으로 맵 사각형 윤곽, 늘 떠 있는 HUD 미리보기(타이머 · 게이지 · 팀 카드 · 미니맵 — 조작을 놓을 수 없는 자리: 사선 무늬 + 이름표), 진짜 버튼처럼 그린 조작(아이콘 + 이름표, 스틱은 고리). 판 정보는 없다(자리 그림뿐). 명령 판(역할 · 좌우 반전 · 기본값 / 작게 · 크게 · 취소 · 저장)은 맵 안에서 조작 · HUD와 가장 덜 겹치는 자리에 뜨고 끄는 동안 흐려진다. 편집 단추는 손가락을 뗄 때 동작한다(끈 직후 탭이 사라지지 않게)
- **규칙**: 움직일 수 있는 범위(안전 영역 + 가장자리 띠 안쪽에서 엄지 여백만큼 안) 안, 다른 조작과 8px(버튼 아래 이름표까지), HUD와 8px, 이동 스틱 고리는 그쪽 화면 40% 이동 영역 안. 막힌 자리는 받지 않고(한 축으로 미끄러질 수 있으면 미끄러진다) 막은 조작 · HUD를 점선 테두리 + ! 표시(색만으로 구분하지 않기) + 안내 한 줄로 보인다. 크기는 10%씩, 터치 대상 48px 아래로는 줄지 않는다
- **저장 · 복원**: 옮긴 조작만 범위 안 비율 자리(u = (x − 범위 x) / (범위 폭 − 조작 폭), v도 같게) + 크기 배율로 저장한다 — u = 1은 어느 화면에서나 오른쪽 끝에 붙는다(16:9~21:9 휴대폰 · 4:3 태블릿 · 회전). 옮기지 않은 조작은 그 화면의 기본 자리. 판 시작 때 옮기지 않은 것은 그대로 두고 옮긴 것을 정해진 순서로 놓되, 다른 조작 · HUD와 겹치면 4px 격자로 가장 가까운 빈 자리(200px 안)로 민다. 하나라도 놓을 수 없으면 그 팀은 기본 배치(반전이면 뒤집은 것)로 돌아간다
- **좌우 반전**(왼손잡이): 조작 · HUD를 모두 화면 가운데를 축으로 뒤집는다(이동 영역은 오른쪽). 켜면 옮긴 조작도 뒤집는다(u → 1 − u)
- 저장 · 취소 · 기본값. 저장하지 못하면(브라우저 저장소가 막힘) 이번 접속에만 쓰고 저장되지 않는다고 알린다. 판 직전 터치 안내 그림 · 화면 밖 화살표가 피하는 엄지 자리 · 판 중 위치 표시는 바꾼 배치를 따른다

| 항목 | 값 | 코드 |
|---|---|---|
| 조작 크기 배율 최소 · 최대 · 한 칸 | `0.8` · `1.5` · `0.1` | `controlLayout.SIZE_SCALE.min` `controlLayout.SIZE_SCALE.max` `controlLayout.SIZE_SCALE.step` |
| 버튼 아래 이름표 높이 (겹침 판단, CSS px) | `9` | `controlLayout.CAP_BELOW` |
| 겹친 조작 밀기 격자 · 최대 거리 (CSS px) | `4` · `200` | `controlLayout.PUSH.step` `controlLayout.PUSH.reach` |
| 이동 영역 (화면 폭 비율) | `0.4` | `layout.MOVE_ZONE_RATIO` |

---

## 옛 판 장 번호

M9까지의 코드 주석 · 문서(BUILD_PLAN · PROGRESS · DECISIONS D3 · D5 · D6)가 가리키는 옛 장은 새 판에서 다음 자리다.

| 옛 판 | 새 판 |
|---|---|
| 1 원칙 | 1 원칙 · 형태 문법 |
| 2 색 | 0.1 고정 값 · 2 팔레트 |
| 3 캐릭터와 오브젝트 | 4 캐릭터 · 괴물 · 5 오브젝트 |
| 4 화면 연출 | 6.2 연출 표 · 7.2 화면 효과 |
| 5 HUD | 8 HUD |
| 6 로비 · 결과 화면 | 9 로비 · 결과 · 10.5 로고 |
