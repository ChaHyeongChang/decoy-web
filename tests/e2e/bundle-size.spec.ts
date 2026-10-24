// JS 번들 크기 예산 (MOBILE_PLAN M10 성능 · 비용): 휴대폰 첫 접속 시간을 지킨다.
// 빌드 결과(client/dist, test:e2e가 먼저 빌드한다)의 모든 JS를 zlib 기본 수준으로 압축해 더한다.
// M10c부터 배포 빌드는 Phaser 사용자 빌드(client/src/phaserCore.js)라 리마스터 전보다 작다. 예산은 그 기준에서 잰다
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

/** M10 시작 전(7d79dee) 같은 방법으로 잰 값 (바이트). Vite 표시로는 348.45kB */
const BEFORE_M10 = 346_679;
/**
 * 늘 지키는 상한 (휴대폰 첫 접속): M10 전 값 + 2KiB (DECISIONS 8절 '번들 예산'). 캐릭터 리디자인(PR #21)에서 처음 M10 전 값을
 * 넘었다(실측 347,785B = M10 전 +1.1KiB, 새 캐릭터 그림 명령 gzip 약 21.6KB). 따라가는 카메라에서 M10 전 + 18KiB로 올린다
 * (카메라 · 맵 조각 굽기 · 화면 밖 표시 · 관전 · 미니맵, DECISIONS 9절 '번들 예산'). 설정 화면 통합에서 M10 전 + 36KiB로 올린다
 * (설정 화면 · 조작 배치 편집 · 판 중 설정 효과, DECISIONS 11절 '번들 예산')
 */
const CAP = BEFORE_M10 + 36 * 1024;
/**
 * 마일스톤마다의 예산: 직전 마일스톤 병합 값에서 이번 마일스톤이 더 쓸 수 있는 양 (DECISIONS M11 "번들 예산").
 * M10c는 Phaser 사용자 빌드 직후 243,281B에서 +25KiB였다. 다음 마일스톤에서 기준을 그 병합 값으로 옮긴다
 */
// 출시 전 검토(M13~M15 PR #11~#16): 늦은 옛 방 메시지 거르기 · 방 나가기 · 연습 뒤로 가기 확인 · 연타 가드 · 연습 측정 모드 등 약 +1.1KiB
// 렌더링 최적화 1(PR #19): 프레임 페이싱(주사율 재기 · 제한기) · 프레임 측정 · ?debug=1 오버레이 확장(배포 빌드) · 적응형 품질 ·
// 프레임 제한 설정 화면 · 프레임 독립성 (DECISIONS 7절 '번들 예산') — PR #18 병합 306,806B에서 +9.5KiB
// 렌더링 최적화 2(PR #20): 할당을 없앤 재사용 그릇 · 풀, 안개 주기 캐시 · 평평한 재생, 배지 아틀라스, 부채 채우기 · 먼지 칸 캐시,
// HUD 게이트 · 글자 크기 재기 · 숫자 글자 묶음 (DECISIONS 7절 '번들 예산 (렌더링 최적화 2)')
// 캐릭터 리디자인(PR #21): 새 캐릭터 그림 명령(art/chars · charFrames, gzip 약 21.6KB) · 스타일 설정 · 아틀라스 자세 프레임 ·
// 정면 그림 UI (DECISIONS 8절 '번들 예산')
// 따라가는 카메라: 카메라 · 감독(관전) · 맵 조각 아틀라스 · 화면 영역 합성 · 화면 밖 표시 · 미니맵 (DECISIONS 9절 '번들 예산')
// 설정 화면 통합: 탭 넷 설정 화면 · 설정 저장소 · 조작 배치(비율 좌표 · 겹침 막기 · 좌우 반전) 편집 화면 · 판 중 메뉴 · 흔들림 ·
// 번쩍임 줄이기 · FPS 칩 · 지도 크게 보기 · 소리 묶음 (DECISIONS 11절 '번들 예산') — PR #23 병합 363,451B에서
const MILESTONE = { name: '설정 화면 통합', base: 363_451, baseName: 'PR #23 병합', budget: 18 * 1024 };

test('JS 번들 gzip: 마일스톤 예산 이하, 상한(리마스터 전 + 36KiB) 아래', { tag: '@core' }, () => {
  const dir = join(process.cwd(), 'client/dist/assets');
  let total = 0;
  for (const f of readdirSync(dir))
    if (f.endsWith('.js')) total += gzipSync(readFileSync(join(dir, f))).length;
  const kib = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1024).toFixed(1)}KiB`;
  const M = MILESTONE;
  console.log(
    `[번들] JS gzip ${total}B (${M.baseName} ${M.base}B ${kib(total - M.base)} / ${M.name} 예산 +${M.budget / 1024}KiB, M10 전 ${BEFORE_M10}B ${kib(total - BEFORE_M10)}, 상한 ${CAP}B)`,
  );
  expect(total).toBeGreaterThan(M.base / 2);
  expect(total - M.base).toBeLessThanOrEqual(M.budget);
  expect(total).toBeLessThan(CAP);
});
