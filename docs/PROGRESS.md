# 진행 기록

`docs/BUILD_PLAN.md` 마일스톤별 결과. 막힌 항목은 `> 보류:`로 표시한다.

## M0 — 뼈대와 도구 (완료)
- npm 워크스페이스(shared · server · client · tests), TypeScript strict(`noUncheckedIndexedAccess` 포함), ESLint(any 금지, shared/server에서 Phaser import 금지), Prettier
- 스크립트: `dev`(서버 tsx watch + Vite), `build`(Vite + esbuild 서버 번들), `start`, `test`(Vitest), `test:e2e`(빌드 후 Playwright), `typecheck`, `lint`, `check`
- `config/balance.json`을 서버가 읽어 검증한다(`shared/src/balance.ts`). 문서에 없던 값 11개 추가(변경 이력 참고)
- 검증: typecheck · lint · format · 단위 3개 · E2E 스모크 2개(설치된 Chromium 사용 확인, 캔버스 · 콘솔 에러 0) 통과
