// 테스트 전용 정답 상태 파일 기록 (--truth-log). 정답 상태 자체는 shared/src/sim/truth.ts
import { appendFileSync, writeFileSync } from 'node:fs';
import { truthOf, type Room } from '@decoy/shared/sim';

export class TruthLog {
  constructor(private readonly path: string) {
    writeFileSync(path, '');
  }

  record(room: Room): void {
    const frame = truthOf(room);
    if (frame) appendFileSync(this.path, `${JSON.stringify(frame)}\n`);
  }
}
