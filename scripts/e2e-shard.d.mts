// scripts/e2e-shard.mjs의 타입 (단위 테스트 tests/unit/ci-config.test.ts가 불러온다)
export declare const DEFAULT_SECONDS: number;
export declare const E2E_DIR: string;
export declare function specFiles(dir?: string): string[];
export declare function planShards(
  files: readonly string[],
  seconds: Readonly<Record<string, number>>,
  n: number,
): { files: string[]; seconds: number }[];
export declare function fileFilter(file: string, dir?: string): string;
