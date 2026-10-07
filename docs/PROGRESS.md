# 진행 기록

`docs/BUILD_PLAN.md` 마일스톤별 결과. 막힌 항목은 `> 보류:`로 표시한다.

## M0 — 뼈대와 도구 (완료)
- npm 워크스페이스(shared · server · client · tests), TypeScript strict(`noUncheckedIndexedAccess` 포함), ESLint(any 금지, shared/server에서 Phaser import 금지), Prettier
- 스크립트: `dev`(서버 tsx watch + Vite), `build`(Vite + esbuild 서버 번들), `start`, `test`(Vitest), `test:e2e`(빌드 후 Playwright), `typecheck`, `lint`, `check`
- `config/balance.json`을 서버가 읽어 검증한다(`shared/src/balance.ts`). 문서에 없던 값 11개 추가(변경 이력 참고)
- 검증: typecheck · lint · format · 단위 3개 · E2E 스모크 2개(설치된 Chromium 사용 확인, 캔버스 · 콘솔 에러 0) 통과

## M1 — 접속과 이동 동기화 (완료)
- 방 만들기 · 코드 입장 · 링크 입장(`/?room=ABCD`), 4인 로비(HTML), 역할 선택(중복 불가), 준비, 방장 시작, 방장 이전. 자리 토큰은 탭별 sessionStorage + 보조 localStorage(DECISIONS D2)
- 서버 고정 틱 30Hz · 스냅샷 20Hz, 입력 `seq` 고정 1/30초 샘플링(렌더 프레임과 분리된 타이머), 입력 크레딧(틱당 평균 1개, 최대 3개 — 속도 핵 방지)
- 내 캐릭터 예측 + 보정(`shared/movement.ts` 공용, 오차는 150ms에 걸쳐 줄이고 1.5타일 넘게 어긋나면 바로 맞춤), 다른 캐릭터 100ms 보간(서버 시각 기준, ping 시계 동기화), `--lag` / `?lag`(왕복 ms, ±20ms, 순서 보존)
- `window.__DECOY__` 디버그 훅(`?debug=hook`), `?debug=1` 오버레이(FPS · 핑 · 서버 틱 · 예측 오차 · 밸런스 해시), 테스트 전용 서버 옵션 `--test-hooks`(위치 지정 · `/test/state`) · `--truth-log`
- 검증: 단위 21개(지연 큐 순서, 예측 = 서버 결과, 보간 공백 처리, 입력 크레딧, 로비 규칙, 스냅샷 20Hz) + E2E 4개(4 컨텍스트 동기화 오차 자기 0.05 · 남 0.1타일 이하, lag=200에서 80ms 안에 내 위치 반영 후 수렴, 한 브라우저 탭 4개 = 4자리 · 새로고침 복귀, 잘못된 방 코드 안내)
- 발견: 헤드리스 컨테이너(GPU 없음)에서 WebGL 탭 4개는 1~3FPS라, 여러 탭 E2E는 Canvas 렌더러(`?renderer=canvas`)로 돌린다
