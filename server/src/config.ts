// 서버 실행 옵션과 balance.json 로드
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateBalance, type Balance } from '@decoy/shared';

/** 헬스 체크 경로 (Docker HEALTHCHECK · render.yaml healthCheckPath · 깨우기 화면이 같이 쓴다) */
export const HEALTH_PATH = '/healthz';
/** 이 서버가 보낸 응답이라는 표시. 깨우기 화면(sw.js)이 호스팅 서비스의 로딩 페이지와 구별하는 데 쓴다 */
export const SERVER_MARK_HEADER = 'x-decoy-server';
/** 테스트 훅 /test/stall이 붙잡을 수 있는 최대 시간 (ms) */
export const MAX_STALL_MS = 60_000;

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
    // 빈 값('')은 Number로 0이 되므로 없는 값으로 본다 (PORT=''이면 아무 포트에나 뜨는 일을 막는다)
    if (v === undefined || v.trim() === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    // 호스팅 서비스(Render 등)가 주는 PORT 환경 변수를 쓴다. --port가 있으면 그쪽이 우선
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
