// 서버 실행 옵션과 balance.json 로드
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateBalance, type Balance } from '@decoy/shared';

export interface ServerOptions {
  port: number;
  host: string;
  /** 왕복(RTT) 기준 인위적 지연 ms. 0이면 끔 */
  lag: number;
  seed: number;
  /** 테스트 전용 명령(위치 지정 · 정답 기록)을 받는다. 프로덕션에서는 꺼져 있다 */
  testHooks: boolean;
  dev: boolean;
  balancePath: string;
  staticDir: string;
  truthLogPath: string | null;
}

function argValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  return argv.includes(`--${name}`) ? 'true' : undefined;
}

export function parseOptions(argv: string[], env: NodeJS.ProcessEnv): ServerOptions {
  const num = (v: string | undefined, fallback: number): number => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : fallback;
  };
  return {
    port: num(argValue(argv, 'port') ?? env.PORT, 8080),
    host: argValue(argv, 'host') ?? env.HOST ?? '0.0.0.0',
    lag: num(argValue(argv, 'lag'), 0),
    seed: num(argValue(argv, 'seed'), Date.now() % 2147483647),
    testHooks: argValue(argv, 'test-hooks') === 'true',
    dev: argValue(argv, 'dev') === 'true',
    balancePath: resolve(argValue(argv, 'balance') ?? env.DECOY_BALANCE ?? 'config/balance.json'),
    staticDir: resolve(argValue(argv, 'static') ?? 'client/dist'),
    truthLogPath: argValue(argv, 'truth-log') ?? null,
  };
}

export function loadBalance(path: string): Balance {
  const text = readFileSync(path, 'utf8');
  return validateBalance(JSON.parse(text));
}
