// 프레임당 일의 양 세기 (렌더링 최적화 2, docs/PERF.md 4.2). 시간이 아니라 '몇 번 했나'를 세므로 기계 · 부하와 상관없이
// 가상 시계(tests/helpers/virtualClock.ts) 아래에서 같은 판이면 같은 수가 나온다 → 최적화 전후를 정확히 견주고(tests/perf/work-counts.spec.ts)
// 늘어나면 막는다(tests/e2e/perf-budget.spec.ts).
//  - 2D 캔버스: 경로(moveTo · lineTo · arc …) · 칠하기(fill · stroke · drawImage · fillText …) · 읽기(getImageData) · 상태(save · restore ·
//    setTransform …) · 글자 재기(measureText). 화면에 붙은 캔버스(Canvas 렌더러의 게임 화면)와 화면 밖 캔버스(안개 · 미니맵 · 글자 텍스처)를 따로
//  - 캔버스 크기 바꾸기(width · height 대입: 비트맵을 다시 잡는다)
//  - WebGL: 그리기 호출(drawArrays · drawElements · 인스턴스판), 텍스처 올리기 횟수와 화소 수(texImage2D · texSubImage2D),
//    버퍼 올리기 바이트(bufferData · bufferSubData), 프로그램 · 프레임버퍼 바꾸기
// 화면 코드와 상관없이 브라우저 API 원형에 끼우므로 최적화 전 빌드도 같은 방법으로 센다.
// installWorkCounts는 context.addInitScript로 페이지 안에서 돈다: 바깥 변수를 쓰지 않는다.

/** 누계 (페이지 안 window.__WORK__) */
export interface WorkCounts {
  /** 화면에 붙은 2D 캔버스 / 화면 밖 2D 캔버스의 경로 명령 */
  pathMain: number;
  pathOff: number;
  /** 칠하기 명령 (fill · stroke · fillRect · strokeRect · clearRect · drawImage · putImageData · fillText · strokeText) */
  paintMain: number;
  paintOff: number;
  /** 상태 명령 (save · restore · setTransform · transform · translate · rotate · scale · resetTransform · clip) */
  stateMain: number;
  stateOff: number;
  /** drawImage만 (텍스처 · 캐시 캔버스 붙이기) */
  drawImage: number;
  /** 글자 그리기(fillText · strokeText) · 재기(measureText) */
  text: number;
  measure: number;
  /** getImageData (GPU → CPU 읽기, 비싸다) */
  readback: number;
  /** 캔버스 width · height 대입 */
  resize: number;
  /** WebGL 그리기 호출 */
  draws: number;
  /** 텍스처 올리기 횟수 · 화소 수 */
  uploads: number;
  uploadPx: number;
  /** 버퍼 올리기 바이트 */
  bufferBytes: number;
  /** useProgram · bindFramebuffer */
  programs: number;
  framebuffers: number;
}

export const WORK_KEYS: readonly (keyof WorkCounts)[] = [
  'pathMain',
  'pathOff',
  'paintMain',
  'paintOff',
  'stateMain',
  'stateOff',
  'drawImage',
  'text',
  'measure',
  'readback',
  'resize',
  'draws',
  'uploads',
  'uploadPx',
  'bufferBytes',
  'programs',
  'framebuffers',
];

declare global {
  interface Window {
    __WORK__?: WorkCounts;
  }
}

export function installWorkCounts(): void {
  const c: WorkCounts = {
    pathMain: 0,
    pathOff: 0,
    paintMain: 0,
    paintOff: 0,
    stateMain: 0,
    stateOff: 0,
    drawImage: 0,
    text: 0,
    measure: 0,
    readback: 0,
    resize: 0,
    draws: 0,
    uploads: 0,
    uploadPx: 0,
    bufferBytes: 0,
    programs: 0,
    framebuffers: 0,
  };
  window.__WORK__ = c;
  type AnyFn = (...args: unknown[]) => unknown;
  /** proto[name]을 감싸 부를 때마다 count(this, args)를 부른다 */
  const wrap = (proto: object, name: string, count: (self: unknown, args: unknown[]) => void): void => {
    const p = proto as Record<string, unknown>;
    const orig = p[name];
    if (typeof orig !== 'function') return;
    const fn = orig as AnyFn;
    p[name] = function (this: unknown, ...args: unknown[]): unknown {
      count(this, args);
      return fn.apply(this, args);
    };
  };
  const onScreen = (self: unknown): boolean => {
    const canvas = (self as { canvas?: unknown }).canvas;
    return canvas instanceof HTMLCanvasElement && canvas.isConnected;
  };
  const ctx2d = CanvasRenderingContext2D.prototype;
  const PATH = [
    'beginPath',
    'moveTo',
    'lineTo',
    'arc',
    'arcTo',
    'bezierCurveTo',
    'quadraticCurveTo',
    'closePath',
    'rect',
    'ellipse',
  ];
  const PAINT = [
    'fill',
    'stroke',
    'fillRect',
    'strokeRect',
    'clearRect',
    'drawImage',
    'putImageData',
    'fillText',
    'strokeText',
  ];
  const STATE = [
    'save',
    'restore',
    'setTransform',
    'transform',
    'translate',
    'rotate',
    'scale',
    'resetTransform',
    'clip',
  ];
  for (const n of PATH)
    wrap(ctx2d, n, (s) => {
      if (onScreen(s)) c.pathMain += 1;
      else c.pathOff += 1;
    });
  for (const n of PAINT)
    wrap(ctx2d, n, (s) => {
      if (onScreen(s)) c.paintMain += 1;
      else c.paintOff += 1;
    });
  for (const n of STATE)
    wrap(ctx2d, n, (s) => {
      if (onScreen(s)) c.stateMain += 1;
      else c.stateOff += 1;
    });
  wrap(ctx2d, 'drawImage', () => {
    c.drawImage += 1;
  });
  for (const n of ['fillText', 'strokeText'])
    wrap(ctx2d, n, () => {
      c.text += 1;
    });
  wrap(ctx2d, 'measureText', () => {
    c.measure += 1;
  });
  wrap(ctx2d, 'getImageData', () => {
    c.readback += 1;
  });
  // OffscreenCanvas 2D도 화면 밖으로 센다 (있으면)
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    const off = OffscreenCanvasRenderingContext2D.prototype;
    for (const n of PATH)
      wrap(off, n, () => {
        c.pathOff += 1;
      });
    for (const n of PAINT)
      wrap(off, n, () => {
        c.paintOff += 1;
      });
    for (const n of STATE)
      wrap(off, n, () => {
        c.stateOff += 1;
      });
  }
  // 캔버스 크기 바꾸기
  for (const prop of ['width', 'height'] as const) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
    if (!d?.set || !d.get) continue;
    const set = d.set;
    Object.defineProperty(HTMLCanvasElement.prototype, prop, {
      ...d,
      set(this: HTMLCanvasElement, v: number) {
        c.resize += 1;
        set.call(this, v);
      },
    });
  }
  // WebGL 1 · 2
  const glProtos: object[] = [WebGLRenderingContext.prototype];
  if (typeof WebGL2RenderingContext !== 'undefined') glProtos.push(WebGL2RenderingContext.prototype);
  /** texImage2D · texSubImage2D 인자에서 화소 수 (너비 · 높이를 준 꼴, 아니면 원본의 크기) */
  const pixels = (args: unknown[], sub: boolean): number => {
    const nums = args.filter((a): a is number => typeof a === 'number');
    const src = args.find((a) => typeof a === 'object' && a !== null) as
      { width?: number; height?: number; videoWidth?: number } | undefined;
    if (src && typeof src.width === 'number' && typeof src.height === 'number' && !ArrayBuffer.isView(src))
      return src.width * src.height;
    // (target, level, [x, y,] internalformat?, width, height, ...)
    const w = sub ? nums[4] : nums[3];
    const h = sub ? nums[5] : nums[4];
    return typeof w === 'number' && typeof h === 'number' ? w * h : 0;
  };
  for (const proto of glProtos) {
    for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
      wrap(proto, n, () => {
        c.draws += 1;
      });
    wrap(proto, 'texImage2D', (_s, args) => {
      c.uploads += 1;
      c.uploadPx += pixels(args, false);
    });
    wrap(proto, 'texSubImage2D', (_s, args) => {
      c.uploads += 1;
      c.uploadPx += pixels(args, true);
    });
    for (const n of ['bufferData', 'bufferSubData'])
      wrap(proto, n, (_s, args) => {
        const data = args.find((a) => ArrayBuffer.isView(a) || a instanceof ArrayBuffer) as
          ArrayBufferView | ArrayBuffer | undefined;
        if (data) c.bufferBytes += data.byteLength;
      });
    wrap(proto, 'useProgram', () => {
      c.programs += 1;
    });
    wrap(proto, 'bindFramebuffer', () => {
      c.framebuffers += 1;
    });
  }
  // ANGLE_instanced_arrays (WebGL 1 확장)의 인스턴스 그리기
  const getExt = WebGLRenderingContext.prototype.getExtension;
  WebGLRenderingContext.prototype.getExtension = function (this: WebGLRenderingContext, name: string) {
    const ext = getExt.call(this, name) as Record<string, unknown> | null;
    if (ext && name === 'ANGLE_instanced_arrays' && !(ext as { __counted?: boolean }).__counted) {
      for (const n of ['drawArraysInstancedANGLE', 'drawElementsInstancedANGLE'])
        wrap(ext, n, () => {
          c.draws += 1;
        });
      (ext as { __counted?: boolean }).__counted = true;
    }
    return ext;
  } as typeof getExt;
}

/** 두 누계의 차이를 frames · 초로 나눈 값 */
export function perFrame(
  a: WorkCounts,
  b: WorkCounts,
  frames: number,
  seconds: number,
): Record<string, number> {
  const out: Record<string, number> = { frames, seconds };
  const r = (v: number): number => Math.round(v * 100) / 100;
  for (const k of WORK_KEYS) {
    const d = b[k] - a[k];
    out[`${k}PerFrame`] = r(d / Math.max(1, frames));
    out[`${k}PerSec`] = r(d / Math.max(0.001, seconds));
  }
  return out;
}
