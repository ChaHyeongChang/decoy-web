// 괴물 의상 'chains' 유불리 점검: 생존자 화면에서 기본 괴물과 같게 보이는가 (기준 · 이유는 costume-parity.test.ts 머리 주석).
// 21프레임 × 크기 열 10개 × 화면(방향 · 위상) — 크기 묶음 셋을 시험 셋으로 (공용 식: tests/helpers/parity.ts)
import { describeMonsterParity } from '../helpers/parity';

describeMonsterParity('chains');
