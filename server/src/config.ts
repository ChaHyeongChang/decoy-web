// 서버 실행 옵션과 balance.json 로드
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateBalance, type Balance } from '@decoy/shared';

/** 헬스 체크 경로 (Docker HEALTHCHECK · render.yaml healthCheckPath · 깨우기 화면이 같이 쓴다) */
export const HEALTH_PATH = '/healthz';
/** 이 서버가 보낸 응답이라는 표시. 깨우기 화면(sw.js)이 호스팅 서비스의 로딩 페이지와 구별하는 데 쓴다 */
export const SERVER_MARK_HEADER = 'x-decoy-server';
/** 서버(와 함께 빌드한 화면)의 빌드 ID (M13d). 서비스 워커가 앱 셸 사전 캐시를 이 값으로 확인한다 */
export const BUILD_HEADER = 'x-decoy-build';
/** 빌드 ID 파일 (Vite 플러그인이 client/dist에 쓴다, client/vite.config.ts) */
export const BUILD_ID_FILE = 'build-id.json';
/** 테스트 훅 /test/stall이 붙잡을 수 있는 최대 시간 (ms) */
export const MAX_STALL_MS = 60_000;
/**
 * 동시에 봇을 채워 판을 할 수 있는 빠른 매칭 방 수 (M13c). 실전 봇 방 하나의 비용을 재서 "빠른 매칭 봇 방 비용 ≤ Render
 * 무료 CPU(0.1개)의 50%"로 정했다: 방 하나가 판 1초에 CPU 약 2.5ms(scripts/measure-bot-rooms.ts), 코어 속도 2배 여유
 * (측정 · 계산은 DECISIONS M13c). 넘으면 그 방은 "사람만 기다리는 중". --max-bot-rooms · DECOY_MAX_BOT_ROOMS로 바꾼다(유료 플랜).
 * 세는 것은 빠른 매칭 봇 방뿐이다: 기기 안 연습은 서버를 쓰지 않고, 개발용 봇 방(?bots=1)은 배포 서버에서 꺼져 있다(devBots)
 */
export const DEFAULT_MAX_BOT_ROOMS = 6;

export interface ServerOptions {
  port: number;
  host: string;
  /** 왕복(RTT) 기준 인위적 지연 ms. 0이면 끔 */
  lag: number;
  seed: number;
  /** 테스트 전용 명령(위치 지정 · 정답 기록)을 받는다. 프로덕션에서는 꺼져 있다 */
  testHooks: boolean;
  /** 개발 서버 (npm run dev가 붙인다) */
  dev: boolean;
  /**
   * 개발용 봇 방(`?bots=1`)을 받는가 (출시 전 검토): --dev · --test-hooks · DECOY_DEV_BOTS=1일 때만. 배포 서버는 꺼져 있어
   * join.bots를 무시한다 (연결 하나가 봇 판을 상한 밖에서 계속 만들지 못하게)
   */
  devBots: boolean;
  balancePath: string;
  staticDir: string;
  truthLogPath: string | null;
  /** 동시 봇 방 상한 (빠른 매칭, M13c) */
  maxBotRooms: number;
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
  const testHooks = argValue(argv, 'test-hooks') === 'true';
  const dev = argValue(argv, 'dev') === 'true';
  return {
    // 호스팅 서비스(Render 등)가 주는 PORT 환경 변수를 쓴다. --port가 있으면 그쪽이 우선
    port: num(argValue(argv, 'port') ?? env.PORT, 8080),
    host: argValue(argv, 'host') ?? env.HOST ?? '0.0.0.0',
    lag: num(argValue(argv, 'lag'), 0),
    seed: num(argValue(argv, 'seed'), Date.now() % 2147483647),
    testHooks,
    dev,
    devBots: dev || testHooks || env.DECOY_DEV_BOTS === '1',
    balancePath: resolve(argValue(argv, 'balance') ?? env.DECOY_BALANCE ?? 'config/balance.json'),
    staticDir: resolve(argValue(argv, 'static') ?? 'client/dist'),
    truthLogPath: argValue(argv, 'truth-log') ?? null,
    maxBotRooms: Math.max(
      0,
      Math.floor(num(argValue(argv, 'max-bot-rooms') ?? env.DECOY_MAX_BOT_ROOMS, DEFAULT_MAX_BOT_ROOMS)),
    ),
  };
}

export function loadBalance(path: string): Balance {
  const text = readFileSync(path, 'utf8');
  return validateBalance(JSON.parse(text));
}

/** 정적 파일 폴더의 빌드 ID (`{"id": "..."}`). 파일이 없거나 깨졌으면 null — 그러면 빌드 비교를 하지 않는다 */
export function readBuildId(staticDir: string): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(resolve(staticDir, BUILD_ID_FILE), 'utf8'));
    const id = raw !== null && typeof raw === 'object' ? (raw as { id?: unknown }).id : null;
    return typeof id === 'string' && /^[0-9a-z]{6,40}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
