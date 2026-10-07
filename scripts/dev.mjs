// 개발 모드: 서버(tsx watch)와 클라이언트(Vite)를 함께 띄운다.
import { spawn } from 'node:child_process';

const procs = [
  ['server', 'npx', ['tsx', 'watch', 'server/src/index.ts', '--dev', ...process.argv.slice(2)]],
  ['client', 'npx', ['vite', '--config', 'client/vite.config.ts']],
].map(([name, cmd, args]) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const prefix = (line) => `[${name}] ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) console.log(prefix(line));
    });
  }
  child.on('exit', (code) => {
    console.log(prefix(`종료 (코드 ${code})`));
    shutdown();
  });
  return child;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) p.kill('SIGTERM');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
