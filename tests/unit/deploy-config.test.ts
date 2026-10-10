// 배포 설정: render.yaml(Render Blueprint) · PORT 환경 변수 · 깨우기 화면과 서버가 같은 약속을 쓰는지
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  DEFAULT_MAX_BOT_ROOMS,
  HEALTH_PATH,
  SERVER_MARK_HEADER,
  parseOptions,
} from '../../server/src/config';

interface RenderEnvVar {
  key: string;
  value?: string;
}

interface RenderService {
  type: string;
  name: string;
  runtime: string;
  plan: string;
  region: string;
  numInstances: number;
  branch: string;
  dockerfilePath: string;
  dockerContext: string;
  healthCheckPath: string;
  autoDeployTrigger: string;
  envVars: RenderEnvVar[];
}

const blueprint = parse(readFileSync('render.yaml', 'utf8')) as { services: RenderService[] };

describe('render.yaml (Render Blueprint)', () => {
  it('Docker 웹 서비스 하나: 싱가포르 · 무료 · 인스턴스 1개', () => {
    expect(blueprint.services).toHaveLength(1);
    const svc = blueprint.services[0]!;
    expect(svc.type).toBe('web');
    expect(svc.runtime).toBe('docker');
    expect(svc.plan).toBe('free');
    expect(svc.region).toBe('singapore');
    // 방 상태가 메모리에 있어 둘 이상이면 같은 방 코드로 서로 다른 서버에 붙는다
    expect(svc.numInstances).toBe(1);
    expect(svc.branch).toBe('main');
  });

  it('Dockerfile 경로가 실제 파일이고, 헬스 체크 경로가 서버와 같다', () => {
    const svc = blueprint.services[0]!;
    expect(existsSync(svc.dockerfilePath)).toBe(true);
    expect(existsSync(svc.dockerContext)).toBe(true);
    expect(svc.healthCheckPath).toBe(HEALTH_PATH);
  });

  it('검사를 통과한 커밋만 배포하고, PORT를 숫자로 준다', () => {
    const svc = blueprint.services[0]!;
    expect(svc.autoDeployTrigger).toBe('checksPass');
    const port = svc.envVars.find((v) => v.key === 'PORT');
    expect(port?.value).toMatch(/^\d+$/);
    expect(parseOptions([], { PORT: port?.value }).port).toBe(Number(port?.value));
  });
});

describe('서버 포트 · 주소 옵션', () => {
  it('호스팅 서비스가 주는 PORT 환경 변수로 뜬다', () => {
    expect(parseOptions([], { PORT: '10000' }).port).toBe(10000);
  });

  it('--port가 PORT보다 우선하고, 둘 다 없으면 8080', () => {
    expect(parseOptions(['--port=3000'], { PORT: '10000' }).port).toBe(3000);
    expect(parseOptions([], {}).port).toBe(8080);
  });

  it('빈 PORT · 숫자가 아닌 PORT는 무시한다 (아무 포트에나 뜨지 않게)', () => {
    expect(parseOptions([], { PORT: '' }).port).toBe(8080);
    expect(parseOptions([], { PORT: '  ' }).port).toBe(8080);
    expect(parseOptions([], { PORT: 'abc' }).port).toBe(8080);
  });

  it('동시 봇 방 상한 (M13c): 기본값, DECOY_MAX_BOT_ROOMS · --max-bot-rooms로 바꾸고, 잘못된 값은 기본값 · 음수는 0', () => {
    expect(parseOptions([], {}).maxBotRooms).toBe(DEFAULT_MAX_BOT_ROOMS);
    expect(parseOptions([], { DECOY_MAX_BOT_ROOMS: '12' }).maxBotRooms).toBe(12);
    expect(parseOptions(['--max-bot-rooms=3'], { DECOY_MAX_BOT_ROOMS: '12' }).maxBotRooms).toBe(3);
    expect(parseOptions([], { DECOY_MAX_BOT_ROOMS: '' }).maxBotRooms).toBe(DEFAULT_MAX_BOT_ROOMS);
    expect(parseOptions([], { DECOY_MAX_BOT_ROOMS: 'x' }).maxBotRooms).toBe(DEFAULT_MAX_BOT_ROOMS);
    expect(parseOptions([], { DECOY_MAX_BOT_ROOMS: '-2' }).maxBotRooms).toBe(0);
    expect(parseOptions([], { DECOY_MAX_BOT_ROOMS: '2.7' }).maxBotRooms).toBe(2);
  });

  it('컨테이너 밖에서 접속할 수 있게 기본 주소는 0.0.0.0', () => {
    expect(parseOptions([], {}).host).toBe('0.0.0.0');
    expect(parseOptions([], { HOST: '127.0.0.1' }).host).toBe('127.0.0.1');
  });
});

describe('깨우기 화면 (client/public)', () => {
  const sw = readFileSync('client/public/sw.js', 'utf8');
  const wake = readFileSync('client/public/wake.html', 'utf8');

  it('서비스 워커와 깨우기 화면이 서버와 같은 표시 헤더를 본다', () => {
    expect(sw).toContain(`'${SERVER_MARK_HEADER}'`);
    expect(wake).toContain(`'${SERVER_MARK_HEADER}'`);
  });

  it('깨우기 화면은 서버의 헬스 체크 경로로 깨어났는지 확인한다 (상대 경로)', () => {
    expect(wake).toContain(`fetch('${HEALTH_PATH.slice(1)}'`);
  });

  it('서비스 워커는 깨우기 화면을 미리 받아 둔다', () => {
    expect(sw).toContain(`'wake.html'`);
  });
});
