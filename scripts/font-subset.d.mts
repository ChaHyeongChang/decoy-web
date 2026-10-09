// scripts/font-subset.mjs의 타입 (단위 테스트 tests/unit/fonts.test.ts가 불러온다)
export declare const FONT_DIR: string;
export declare const FONT_FILE: string;
export declare const CHARS_FILE: string;
export declare function ksx1001Hangul(): string;
export declare function wantedChars(): Set<string>;
export declare function cmapCodepoints(buf: Buffer, off: number): Set<number>;
export declare function sfntCodepoints(buf: Buffer): Set<number>;
export declare function woff2Tables(buf: Buffer): Map<string, Buffer>;
export declare function woff2Codepoints(buf: Buffer): Set<number>;
export declare function charsOf(codepoints: Iterable<number>): string;
