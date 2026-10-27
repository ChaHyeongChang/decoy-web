// 생존자 스카우트 몸 가운데 0.45r 원판 점검 (기준 · 크기 · 화면 · 이유는 costume-parity-disc.test.ts 머리 주석). 역할마다 파일 하나 —
// vitest가 나란히 돌린다 (공용 식: tests/helpers/parity.ts describeSurvivorDisc)
import { describeSurvivorDisc } from '../helpers/parity';

describeSurvivorDisc('scout');
