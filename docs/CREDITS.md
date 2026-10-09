# 저작권 · 출처 (CREDITS)

DECOY의 그래픽은 **코드로 그린다**. 저장소에 들어 있는 이미지 · 폰트 파일은 아래 표가 전부이고, 게임에 실리는 외부 에셋은 UI 폰트(Noto Sans KR, SIL OFL 1.1) 하나다. 에셋 정책은 `docs/VISUAL_SPEC.md` 11장.

`tests/unit/credits.test.ts`가 `client/public` · `client/src` · `docs` 아래의 이미지 · 폰트 · 소리 파일(png · jpg · jpeg · webp · gif · avif · ico · svg · woff · woff2 · ttf · otf · mp3 · ogg · wav · m4a)이 모두 이 표에 경로 · 출처 · 라이선스와 함께 있는지, 이 문서에 적은 파일이 실제로 있는지 확인한다. 새 파일을 넣으면 이 표에 한 줄을 더한다. `artifacts/`(전후 비교 · 최종 보고 스크린샷, 게임 화면을 찍은 것)는 대상이 아니다.

## 1. 저장소의 이미지 · 폰트 파일

| 파일 | 무엇 | 출처 | 라이선스 | 게임에 실림 |
|---|---|---|---|---|
| `client/public/fonts/noto-sans-kr-ui.woff2` | UI 폰트 Noto Sans KR 서브셋 (가변 굵기 100~900, 307,088B) | Google Fonts `NotoSansKR[wght].ttf` 2.004에서 글자만 줄임 (2절) | SIL Open Font License 1.1 | 예 (`/fonts/`) |
| `docs/images/logo_decoy.png` | 게임 로고 원본 (213 × 213, 원형, 배경 투명) | 사용자 제공 (프로젝트 로고) | 프로젝트 소유 | 예 (파비콘 · 작은 로고, 빌드 때 해시 이름으로 복사) |
| `docs/images/logo_decoy.svg` | 로고 벡터판 (원본과 같은 디자인으로 다시 그림, 512 격자) | 이 프로젝트에서 원본 PNG를 보고 손으로 다시 그림 (M10a) | 프로젝트 소유 (원본 로고와 같음) | 아니오 (원본 보관용) |
| `client/public/logo.svg` | `docs/images/logo_decoy.svg`와 같은 파일 (`tests/unit/logo-svg.test.ts`가 같은지 확인) | 위와 같음 | 프로젝트 소유 | 예 (로비 · 결과 큰 로고, 깨우기 안내 2x) |
| `docs/images/concept_01_survivor_fog.png` | 컨셉 이미지: 생존자 시야 · 안개 | 기획 단계에 생성형 AI로 만든 이미지 (사용자 제공) | 문서 참고용. 게임 · 스토어에 쓰지 않음 | 아니오 |
| `docs/images/concept_02_map_reference.png` | 컨셉 이미지: 맵 참고 | 위와 같음 | 문서 참고용. 게임 · 스토어에 쓰지 않음 | 아니오 |
| `docs/images/concept_04_decoy_play.png` | 컨셉 이미지: 플레이 장면 | 위와 같음 | 문서 참고용. 게임 · 스토어에 쓰지 않음 | 아니오 |
| `docs/images/concept_05_shared_vision.png` | 컨셉 이미지: 공유 시야 | 위와 같음 | 문서 참고용. 게임 · 스토어에 쓰지 않음 | 아니오 |
| `docs/images/concept_06_hud_sheet.png` | 컨셉 이미지: HUD 시트 | 위와 같음 | 문서 참고용. 게임 · 스토어에 쓰지 않음 | 아니오 |

컨셉 이미지는 분위기 참고만 한다. 거점별 색 · 부채꼴 3단계 · 괴물 여러 마리 · 아이템 상자는 v1 초기 안이라 따르지 않는다(`docs/VISUAL_SPEC.md` 11장).

## 2. UI 폰트 — Noto Sans KR

- 이름: Noto Sans KR (서브셋 파일 안의 글꼴 이름도 'Noto Sans KR')
- 저작권 줄 (원본 폰트 name 표 그대로): `Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.`
- 상표: Noto is a trademark of Google Inc.
- 라이선스: SIL Open Font License 1.1. 전문은 `client/public/fonts/OFL.txt`(빌드 결과 `/fonts/OFL.txt`로 폰트와 함께 배포). <https://openfontlicense.org>
- 원본: <https://github.com/google/fonts/tree/main/ofl/notosanskr> 의 `NotoSansKR[wght].ttf`(버전 2.004, 확인한 파일 sha256 `194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252`)
- 수정 (서브셋): 글자만 줄였다. ASCII 95자 + KS X 1001 상용 한글 2,350자 + 게임 문구에 쓰는 기호 45자 = 2,490자, 가변 굵기 축(wght 100~900)은 그대로. 만든 방법은 `scripts/font-subset.mjs`(`npm i --no-save subset-font@2.9.0` 뒤 `npm run font:subset -- <NotoSansKR[wght].ttf 경로>`), 들어간 글자 목록은 `client/public/fonts/noto-sans-kr-ui.txt`. 결과 파일 sha256 `8bd2729f4f064fd48c880618ef6cdad50ab15f033218325d8d4d7ab61826a311`
- 예약 글꼴 이름: 원본에 Reserved Font Name 'Source'가 있다. 수정본(서브셋)의 글꼴 이름은 'Noto Sans KR'이라 'Source'를 쓰지 않으므로 OFL 3항을 지킨다(`tests/unit/fonts.test.ts`가 서브셋의 name 표를 확인)
- 조건: 라이선스 전문 동봉(`OFL.txt`), 폰트만 따로 팔지 않는다, 수정본에 예약 이름을 쓰지 않는다

## 3. 코드로 그린 것 (외부 에셋 아님)

아래는 모두 이 저장소의 코드가 실행 중에 그리거나 만든다. 외부 이미지 · 스프라이트 시트 · 텍스처 파일을 쓰지 않는다.

| 대상 | 코드 |
|---|---|
| 맵 재질 (강판 바닥 · 2.5D 벽 · 기둥 · 감옥 · 거점 · 탈출구 · 네온 · 발광) | `client/src/art/mapArt.ts` · `mapArtGeom.ts` · `noise.ts`, `client/src/render/fogPaint.ts` · `fogGpu.ts` · `baseLayer.ts` · `objects.ts` |
| 안개 · 빛 지도 · 후처리(비네트 · 색보정 셰이더) | `client/src/render/fogMath.ts` · `fogPaint.ts` · `fogGpu.ts` · `effects.ts` |
| 캐릭터 · 괴물 실루엣 · 문양 · 애니메이션 프레임 | `client/src/art/shapes.ts` · `atlas.ts` · `anim.ts`, `client/src/render/characters.ts` |
| 입자 · 화면 효과 | `client/src/art/fx.ts`, `client/src/render/effects.ts` · `worldRenderer.ts` |
| 배지 | `client/src/art/mapArtBadges.ts`, `client/src/render/objects.ts` |
| 부채꼴 · 범위 표시 | `client/src/render/vision.ts` |
| UI 아이콘 (SVG 경로, HTML · Phaser 공용) | `client/src/art/icons.ts` |
| HUD 패널 · 게이지 · 리본 · 미니맵 그림 | `client/src/ui/hudArt.ts` · `hudKit.ts` · `minimap.ts` |
| 로비 · 결과의 실루엣 · 문양 SVG · 맵 설계도 배경 | `client/src/ui/uiArt.ts` |
| 화면 스타일 (깎은 모서리 패널 · 버튼 · 해치) | `client/src/style.css`, `client/public/wake.html`(CSS만) |
| 색 | `client/src/art/palette.ts` |

## 4. 소리

효과음은 녹음 파일 없이 WebAudio로 합성한다(`client/src/audio.ts`). 소리 파일을 넣게 되면 1절 표에 적는다.

## 5. 새 에셋을 넣을 때

1. CC0 또는 계획에서 승인한 라이선스인지 원문으로 확인한다. 라이선스가 불분명하면 넣지 않는다
2. 1절 표에 `경로` · 무엇 · 출처(URL) · 라이선스를 적고, 전문 동봉이 필요하면 파일과 같이 배포한다
3. `npm test`(credits · fonts · visual-spec 테스트)가 통과하는지 본다
