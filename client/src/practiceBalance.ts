// 빌드에 넣은 수치 (봇과 연습 · welcome 전 첫 화면 미리 굽기). 기기 안 연습 서버(localServer.ts)는 나눠 받는 조각 'practice'라
// 첫 묶음이 쓰는 이 값은 따로 둔다 (DECISIONS 11절 '나눠 받기')
import balanceJson from '../../config/balance.json';
import { validateBalance, type Balance } from '@decoy/shared';

/** 빌드에 넣은 수치 (서버의 welcome과 같은 값이 온다) */
export const PRACTICE_BALANCE: Balance = validateBalance(balanceJson);
