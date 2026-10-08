// 서버를 esbuild로 한 파일(server/dist/index.js)로 묶는다. shared 소스도 함께 들어간다.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'server/dist/index.js',
  external: ['ws'],
  sourcemap: true,
  logLevel: 'info',
});
