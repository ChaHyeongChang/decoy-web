// 앱 셸 빌드 도우미 (M13d, client/vite.config.ts가 빌드 끝에 쓴다 · 단위 시험이 같이 쓴다).
// dist 전체 파일 목록을 모으고, public/sw.js의 자리 표시 두 줄(빌드 ID · 셸 목록)을 빌드 값으로 바꾼다
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 앱 셸 사전 캐시에서 빼는 dist 파일: 워커 자신, 깨우기 화면(따로 캐시), 서버가 읽는 빌드 ID 파일 */
export const SHELL_EXCLUDE: readonly string[] = ['sw.js', 'wake.html', 'build-id.json'];

const BUILD_LINE = /^const BUILD = null;.*$/m;
const SHELL_LINE = /^const SHELL = \[\];.*$/m;

/** sw.js 원문에 빌드 ID와 셸 목록을 넣는다. 자리 표시가 없으면 빌드를 멈춘다(워커가 옛 모양으로 나가지 않게) */
export function swWithBuild(source: string, id: string, shell: readonly string[]): string {
  if (!BUILD_LINE.test(source) || !SHELL_LINE.test(source))
    throw new Error('sw.js에 빌드 자리 표시(const BUILD = null; · const SHELL = [];)가 없습니다');
  return source
    .replace(BUILD_LINE, `const BUILD = ${JSON.stringify(id)};`)
    .replace(SHELL_LINE, `const SHELL = ${JSON.stringify(shell)};`);
}

/** dist 아래 모든 파일(하위 폴더 포함, '/' 구분 상대 경로, 정렬)에서 SHELL_EXCLUDE를 뺀 앱 셸 목록 */
export function listShellFiles(outDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(outDir, full).split(sep).join('/'));
    }
  };
  walk(outDir);
  return files.filter((f) => !SHELL_EXCLUDE.includes(f)).sort();
}
