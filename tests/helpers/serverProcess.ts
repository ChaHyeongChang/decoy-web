// 실제 서버 프로세스를 띄워 테스트한다 (tsx로 소스를 바로 실행, 포트 0 = 빈 포트)
import { spawn, type ChildProcess } from 'node:child_process';

export interface RunningServer {
  port: number;
  proc: ChildProcess;
  output: string[];
  stop(): Promise<void>;
}

/** port를 주면 그 포트로 띄운다 (같은 출처로 서버를 바꿔 띄우는 서비스 워커 시험, M13d). 없으면 빈 포트 */
export async function startServer(args: string[] = [], opts: { port?: number } = {}): Promise<RunningServer> {
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', 'server/src/index.ts', `--port=${opts.port ?? 0}`, '--host=127.0.0.1', ...args],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output: string[] = [];
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`서버 시작 실패:\n${output.join('')}`)), 20_000);
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      output.push(text);
      const m = /localhost:(\d+)/.exec(text);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', (c: Buffer) => output.push(c.toString()));
    proc.on('exit', (code) => reject(new Error(`서버가 종료됨 (${code}):\n${output.join('')}`)));
  });
  return {
    port,
    proc,
    output,
    stop: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.once('exit', () => resolve());
        proc.kill('SIGTERM');
      }),
  };
}

/** 지금 비어 있는 TCP 포트 하나 (잠깐 열었다 닫는다) */
export async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
