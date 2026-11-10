// 탈출구 자물쇠 판 (플레이테스트 a-9)의 순수 부분 (DOM · Phaser 없음): 무엇을 그릴지(판 서명 · 판 뷰) · 자리 · 7세그먼트 도형.
// 판정이 아니다 — 서버가 이미 보낸 값(탈출구 상태, 생존자에게만 오는 개방 진행 · 거점 메모 숫자)을 그림으로 옮길 뿐이다.
// 괴물 화면은 개방 진행이 null이라 숫자 · 입력 자리 수를 그리는 길이 없다(조각을 넘겨도 빈 칸, 이중 잠금).
// 그리는 코드는 render/keypad.ts(ExitKeypads)이고 판 서명 수(keypadCode)만 쓴다: 판 중 프레임마다 부르므로 객체를 만들지 않는다.
// 판 뷰(keypadView · keypadText)는 같은 서명을 풀어 쓴 것이다(시험 · 문서용).
import { EXITS, type ExitId, type ExitState, type GameEvent } from '@decoy/shared';

/** 숫자 칸 수 (조각 2개 × 두 자리) */
const DIGITS = 4;

/** 자물쇠 판 상수 (타일 · 판 왼쪽 위 기준). 장식 값이다 — 열리는 시간 · 인원은 balance.json `exit` */
export const KEYPAD = {
  digits: DIGITS,
  /** 개방 진행을 나누는 단계 (입력 4 + 확인 1): 진행 20 · 40 · 60 · 80%에 한 자리씩, 마지막 20%는 확인 */
  steps: 5,
  /** 판 폭 · 높이 */
  w: 2.5,
  h: 0.84,
  /** 문 왼쪽 문틀 칸과 판 오른쪽 끝 사이 */
  gap: 0.05,
  /** 숫자 첫 칸 왼쪽 자리 · 칸 간격 · 숫자 너비 · 높이 · 획 굵기 */
  digitX: 0.66,
  pitch: 0.46,
  glyphW: 0.3,
  glyphH: 0.6,
  stroke: 0.075,
  /** 앞 두 칸(첫 조각)과 뒤 두 칸(둘째 조각) 사이를 더 띄운다 */
  pairGap: 0.06,
  /** 자물쇠 몸통 (왼쪽 · 위 · 너비 · 높이) */
  lockX: 0.12,
  lockY: 0.36,
  lockW: 0.32,
  lockH: 0.34,
} as const;

export type KeypadCell = 'empty' | 'unknown' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
/** idle = 켜졌지만 입력 없음(괴물 화면은 늘 이것 아니면 open), typing = 한 자리 이상 입력됨, open = 열림 */
export type KeypadMode = 'idle' | 'typing' | 'open';
export interface KeypadView {
  mode: KeypadMode;
  /** 왼쪽부터 네 칸 (앞 두 칸 = 첫 조각, 뒤 두 칸 = 둘째 조각) */
  cells: KeypadCell[];
}
/** 받은 조각 (앞 = NOTE_FIRST, 뒤 = NOTE_SECOND). 못 받은 조각은 null */
export type KeypadCodes = [string | null, string | null];

const MODES: readonly KeypadMode[] = ['idle', 'typing', 'open'];
/** 서명의 칸 번호 → 글자: 빈칸 0 '_' · 모름 1 '•' · 숫자 d는 2 + d */
const CELL_CHARS = '_•0123456789';
/** 서명 한 자리의 밑 (칸 번호 0~11) */
const BASE = 12;
const TWO_DIGITS = /^\d\d$/;

/** 거점 메모 하나를 조각 자리에 넣는다. 자리는 이벤트 id로 정한다(도착 순서가 아니다 — 한쪽만 와도 맞는 칸). 메모가 아니면 그대로 */
export function takeCode(codes: KeypadCodes, ev: GameEvent): void {
  if (ev.k !== 'text' || ev.code === undefined) return;
  if (ev.id === 'NOTE_FIRST') codes[0] = ev.code;
  else if (ev.id === 'NOTE_SECOND') codes[1] = ev.code;
}

/** 받은 이벤트들에서 조각 둘 */
export function collectedCodes(events: readonly GameEvent[]): KeypadCodes {
  const out: KeypadCodes = [null, null];
  for (const ev of events) takeCode(out, ev);
  return out;
}

/** 개방 진행 0~1 → 입력된 자리 수 0~4 (20%마다 한 자리, 4에서 멈춤). null · NaN · 0 이하는 0 */
export function keypadFilled(progress: number | null): number {
  return progress !== null && progress > 0 ? Math.min(DIGITS, Math.floor(progress * KEYPAD.steps + 1e-6)) : 0;
}

/**
 * 판 서명 수 (꺼진 탈출구 −1): 모드 × 12⁴ + Σ 칸 번호 × 12^i (칸 번호: 빈칸 0 · 모름 1 · 숫자 d는 2 + d). 그림이 같으면 같은 수다.
 * 입력 중(typing)은 첫 자리가 들어간 뒤부터 — 그 전은 빈 판과 같은 그림. progress가 null(괴물 화면)이면 상태만 본다:
 * 활성 = 빈 판, 열림 = 열린 빈 판 (codes를 받았더라도 보지 않는다). 조각이 두 자리 숫자가 아니면(못 받음) 두 칸 모두 모름
 */
export function keypadCode(
  state: ExitState,
  progress: number | null,
  codes: readonly (string | null)[],
): number {
  if (state === 'inactive') return -1;
  const filled = keypadFilled(progress);
  const mode = state === 'open' ? 2 : filled > 0 ? 1 : 0;
  const n = progress === null ? 0 : mode === 2 ? DIGITS : filled;
  let code = mode * BASE ** DIGITS;
  for (let i = 0; i < n; i += 1) {
    const c = codes[i >> 1];
    code += (c && TWO_DIGITS.test(c) ? c.charCodeAt(i & 1) - 46 : 1) * BASE ** i;
  }
  return code;
}

/** 서명의 칸 i 번호. i = 칸 수(4)이면 모드 번호(MODES 순서: 0 idle · 1 typing · 2 open) */
export function codeCell(code: number, i: number): number {
  return Math.floor(code / BASE ** i) % BASE;
}

/** 정보 레이어 값 '모드:네 칸' (예 'typing:07__' — 숫자 · '•' 모름 · '_' 빈칸) */
export function keypadLabel(code: number): string {
  let s = `${MODES[codeCell(code, DIGITS)]}:`;
  for (let i = 0; i < DIGITS; i += 1) s += CELL_CHARS.charAt(codeCell(code, i));
  return s;
}

/** 서명 수 → 판 뷰 (−1이면 null) */
export function keypadViewOf(code: number): KeypadView | null {
  if (code < 0) return null;
  const cells: KeypadCell[] = [];
  for (let i = 0; i < DIGITS; i += 1) {
    const c = codeCell(code, i);
    cells.push(c === 0 ? 'empty' : c === 1 ? 'unknown' : (String(c - 2) as KeypadCell));
  }
  return { mode: MODES[codeCell(code, DIGITS)] ?? 'idle', cells };
}

/**
 * 자물쇠 판 (keypadCode를 풀어 쓴 것). 꺼진 탈출구면 없음(null). progress가 null(괴물 화면)이면 codes를 받았더라도 숫자 · 입력
 * 자리 수가 없다: 활성 = 빈 판, 열림 = 열린 빈 판. 생존자 화면은 입력 중 왼쪽부터 keypadFilled칸, 열림이면 네 칸 모두
 */
export function keypadView(
  state: ExitState,
  progress: number | null,
  codes: readonly (string | null)[],
): KeypadView | null {
  return keypadViewOf(keypadCode(state, progress, codes));
}

/** 시험용 글자: 숫자 · '•'(모르는 숫자) · '_'(빈칸) */
export function keypadText(v: KeypadView | null): string {
  return v ? v.cells.map((c) => (c === 'empty' ? '_' : c === 'unknown' ? '•' : c)).join('') : '';
}

/** 판 사각형 (타일): 문 왼쪽 문틀 칸의 왼쪽 벽 칸, 문 줄 가운데. 북 · 남 모두 외벽 줄이라 캐릭터가 설 수 없다 */
export function keypadAt(id: ExitId): { x0: number; y0: number; x1: number; y1: number } {
  const d = EXITS[id].door;
  const x1 = d.x0 - 1 - KEYPAD.gap;
  const y0 = (d.y0 + d.y1 - KEYPAD.h) / 2;
  return { x0: x1 - KEYPAD.w, y0, x1, y1: y0 + KEYPAD.h };
}

/** 숫자 칸 i의 왼쪽 위 (판 왼쪽 위 기준, 타일) */
export function digitAt(i: number): { x: number; y: number } {
  return {
    x: KEYPAD.digitX + i * KEYPAD.pitch + (i >= DIGITS / 2 ? KEYPAD.pairGap : 0),
    y: (KEYPAD.h - KEYPAD.glyphH) / 2,
  };
}

/** 7세그먼트 획 a~g의 켜짐 (비트 a = 1 … g = 64), 숫자 0~9 */
export const SEGMENTS: readonly number[] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** 획 a~g의 자리 [열, 줄]: 열 0 왼쪽 · 1 오른쪽 · 2 가로 획, 줄 = 세로 획은 0 위 · 1 아래, 가로 획은 0 위 · 1 가운데 · 2 아래 */
const SEG_AT: readonly (readonly [number, number])[] = [
  [2, 0],
  [1, 0],
  [1, 1],
  [2, 2],
  [0, 1],
  [0, 0],
  [2, 1],
];

/**
 * 획 k(0 = a … 6 = g)의 사각형 [x, y, w, h]: 숫자 칸 (x, y) · 너비 w · 높이 h · 굵기 t 기준.
 * a 위 · b 오른쪽 위 · c 오른쪽 아래 · d 아래 · e 왼쪽 아래 · f 왼쪽 위 · g 가운데. 이웃 획끼리 겹치지 않는다
 */
export function segmentRect(
  k: number,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
): [number, number, number, number] {
  const [col, row] = SEG_AT[k] ?? [2, 1];
  return col === 2
    ? [x + t, y + (row * (h - t)) / 2, w - 2 * t, t]
    : [x + col * (w - t), y + t + row * (h / 2 - t / 2), t, h / 2 - 1.5 * t];
}
