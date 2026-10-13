// Phaser 글자는 모두 여기서 만든다 (MOBILE_PLAN M10a 4번).
//  - 글자 텍스처 해상도 = 카메라 zoom (백버퍼 1px = 텍셀 1개). Phaser는 해상도를 주지 않으면 1로 굳힌다
//  - 텍스처 크기를 정수 텍셀로 맞춘다: 소수 크기면 캔버스는 잘리고 사각형은 소수라 글자 전체가 다시 샘플된다
//  - 화면 위치(왼쪽 위)를 백버퍼 픽셀 격자에 맞춘다. 기준 위치를 따로 기억해 setText · setOrigin을 반복해도 오차가 쌓이지 않는다
//  - 색 · 배경색이 같은 값이면 다시 그리지 않는다 (HUD가 매 프레임 setColor를 불러도 텍스처를 다시 그려 올리지 않게)
// 직접 scene.add.text를 쓰면 이 처리가 빠진다 → 소스 검사 테스트가 막는다 (tests/unit/resolution.test.ts)
import Phaser from 'phaser';
import type { TextAudit } from '@decoy/shared';
import { UI_FONT } from './fonts';
import { RENDER_SCALE } from './layout';
import { textBoxSize } from './textSize';

/** UI 글꼴 스택 (원본은 fonts.ts. 기존 import 경로를 지키려고 다시 내보낸다) */
export { UI_FONT };

/** 선명도 검사 글자의 깊이 (HUD · 배너 · 안내보다 위) */
export const PROBE_DEPTH = 1000;

/** 텍셀 크기를 정수로 올릴 때의 여유 (부동소수 곱셈이 n − ε가 되어 캔버스가 한 텍셀 잘리지 않게) */
const TEXEL_EPS = 1e-4;

interface SnapState {
  /** 사용자가 준 위치 (논리 px). 실제 x · y는 여기에 격자 보정을 더한 값 */
  baseX: number;
  baseY: number;
  /** 마지막으로 크기를 잰 배치 (글자 · 글꼴 · 해상도 · 여백 …) */
  sig: string;
  /** 정수 텍셀로 맞춘 고정 크기 (0이면 고정하지 않음) */
  fixedW: number;
  fixedH: number;
  busy: boolean;
}

// 상태는 인스턴스 필드 대신 WeakMap에 둔다: Phaser Text 생성자가 setPosition · updateText를 부르는 시점에는
// 하위 클래스 필드가 아직 초기화되지 않는다(ES2022 클래스 필드 의미론)
const states = new WeakMap<CrispText, SnapState>();

/** 디버그 계수 (textAudit): 글자 텍스처를 다시 그린 횟수, 그중 배치(글자 · 글꼴 · 해상도 …)가 바뀐 횟수 */
const counters = { redraws: 0, relayouts: 0 };

/** 장면별 선명도 검사 글자 (drawProbeText) */
const probes = new WeakMap<Phaser.Scene, CrispText>();

function stateOf(t: CrispText): SnapState {
  let s = states.get(t);
  if (!s) {
    s = { baseX: t.x, baseY: t.y, sig: '', fixedW: 0, fixedH: 0, busy: false };
    states.set(t, s);
  }
  return s;
}

/** 크기에 영향을 주는 값들 (색 · 배경색만 바뀌면 다시 재지 않는다) */
function layoutSig(t: CrispText): string {
  const st = t.style;
  const p = t.padding;
  return [
    t.text,
    st.fontStyle,
    st.fontSize,
    st.fontFamily,
    st.resolution,
    st.wordWrapWidth ?? 0,
    st.strokeThickness,
    st.maxLines,
    t.lineSpacing,
    t.letterSpacing,
    p.left,
    p.right,
    p.top,
    p.bottom,
  ].join('\u0001');
}

/** 정수 텍셀 · 기기 픽셀 격자에 맞춰 그리는 글자 */
export class CrispText extends Phaser.GameObjects.Text {
  /** 같은 색이면 아무것도 하지 않는다 (Phaser는 같은 값이어도 글자를 다시 그리고 텍스처를 다시 올린다) */
  override setColor(color: string | CanvasGradient | CanvasPattern): this {
    if (this.style && this.style.color === color) return this;
    return super.setColor(color);
  }

  override setFill(color: string | CanvasGradient | CanvasPattern): this {
    if (this.style && this.style.color === color) return this;
    return super.setFill(color);
  }

  /** 같은 배경색이면 아무것도 하지 않는다 */
  override setBackgroundColor(color: string): this {
    if (this.style && this.style.backgroundColor === color) return this;
    return super.setBackgroundColor(color);
  }

  override setPosition(x = 0, y: number = x, z = 0, w = 0): this {
    const s = stateOf(this);
    s.baseX = x;
    s.baseY = y;
    super.setPosition(x, y, z, w);
    this.snapPosition();
    return this;
  }

  override setX(value = 0): this {
    stateOf(this).baseX = value;
    super.setX(value);
    this.snapPosition();
    return this;
  }

  override setY(value = 0): this {
    stateOf(this).baseY = value;
    super.setY(value);
    this.snapPosition();
    return this;
  }

  override setOrigin(x?: number, y?: number): this {
    super.setOrigin(x, y);
    this.snapPosition();
    return this;
  }

  override updateText(): this {
    const s = states.get(this);
    // 생성자 안(스타일 · 텍스처가 아직 없음)이거나 아래에서 다시 들어온 경우는 Phaser 그대로
    if (!s || s.busy || !this.style || !this.frame) return super.updateText();
    s.busy = true;
    counters.redraws += 1;
    try {
      const st = this.style;
      const res = st.resolution;
      const sig = layoutSig(this);
      if (sig !== s.sig) {
        counters.relayouts += 1;
        // 자연 크기를 잰다: 줄바꿈 없는 글자는 그리지 않고 재고(textSize.ts, Phaser와 같은 식), 줄바꿈 글자는 고정 크기를
        // 풀고 한 번 그린다 (렌더링 최적화 2: 소수 배율에서 바뀔 때마다 두 번 그리고 올리던 것을 한 번으로)
        const nat = this.naturalSize();
        let nw: number;
        let nh: number;
        if (nat) {
          nw = nat.width;
          nh = nat.height;
        } else {
          st.fixedWidth = 0;
          st.fixedHeight = 0;
          super.updateText();
          nw = this.width;
          nh = this.height;
        }
        s.sig = sig;
        const tw = nw * res;
        const th = nh * res;
        const exact = Math.abs(tw - Math.round(tw)) < 1e-6 && Math.abs(th - Math.round(th)) < 1e-6;
        s.fixedW = exact ? 0 : (Math.ceil(tw - 1e-6) + TEXEL_EPS) / res;
        s.fixedH = exact ? 0 : (Math.ceil(th - 1e-6) + TEXEL_EPS) / res;
        // 이미 자연 크기로 그렸고 그 크기가 정수 텍셀이면 끝
        if (exact && !nat) return this.afterUpdate();
      }
      st.fixedWidth = s.fixedW;
      st.fixedHeight = s.fixedH;
      super.updateText();
      return this.afterUpdate();
    } finally {
      s.busy = false;
    }
  }

  /**
   * 고정 크기 없이 그릴 때의 width · height (그리지 않고 잰다). 줄바꿈 글자는 null (Phaser의 줄 나누기를 거친다).
   * 글꼴은 Phaser가 그리기 전에 하듯 이 글자의 캔버스 문맥에 맞춘다
   */
  private naturalSize(): { width: number; height: number } | null {
    const st = this.style;
    if (st.wordWrapWidth || st.wordWrapCallback) return null;
    st.syncFont(this.canvas, this.context);
    const re = this.splitRegExp;
    const lines = this.text.split(re instanceof RegExp ? re : /(?:\r\n|\r|\n)/);
    const ctx = this.context;
    return textBoxSize(lines, (t) => ctx.measureText(t).width, {
      fontSize: st.getTextMetrics().fontSize,
      strokeThickness: st.strokeThickness,
      maxLines: st.maxLines,
      wordWrap: Boolean(Reflect.get(st, 'wordWrap')),
      letterSpacing: this.letterSpacing,
      lineSpacing: this.lineSpacing,
      padding: this.padding,
    });
  }

  /** 격자 위치를 다시 맞춘다 (카메라 zoom이 바뀐 뒤) */
  resnap(): this {
    this.snapPosition();
    return this;
  }

  private afterUpdate(): this {
    // 사각형 크기를 실제 캔버스(정수 텍셀)와 같게: WebGL은 frame 크기 / 해상도로 사각형을 그린다
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (this.frame.width !== cw || this.frame.height !== ch) this.frame.setSize(cw, ch);
    // Canvas 렌더러는 텍스처 소스의 해상도로 크기를 나눈다. Phaser는 이 값을 생성할 때만 넣으므로 같이 맞춘다
    this.frame.source.resolution = this.style.resolution;
    this.snapPosition();
    return this;
  }

  private snapPosition(): void {
    const s = states.get(this);
    // 컨테이너 안이면 부모 변환이 붙어 여기서 맞출 수 없다 (글자는 컨테이너에 넣지 않는다)
    if (!s || !this.style || this.parentContainer) return;
    const z = RENDER_SCALE;
    const left = s.baseX - this.displayOriginX;
    const top = s.baseY - this.displayOriginY;
    this.x = s.baseX + (Math.round(left * z) / z - left);
    this.y = s.baseY + (Math.round(top * z) / z - top);
  }
}

/** 글자를 만든다. 해상도는 지금 카메라 zoom으로 정한다 (style.resolution은 무시) */
export function makeText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
): CrispText {
  const t = new CrispText(scene, x, y, text, { ...style, resolution: RENDER_SCALE });
  scene.add.existing(t);
  return t;
}

/** 장면의 모든 CrispText (Container · Layer 안, 숨긴 글자 포함) */
function crispTexts(scene: Phaser.Scene): CrispText[] {
  const out: CrispText[] = [];
  const visit = (list: readonly Phaser.GameObjects.GameObject[]): void => {
    for (const o of list) {
      if (o instanceof CrispText) out.push(o);
      else if (o instanceof Phaser.GameObjects.Container || o instanceof Phaser.GameObjects.Layer)
        visit(o.list);
    }
  };
  visit(scene.children.list);
  return out;
}

/** 카메라 zoom이 바뀐 뒤 장면의 모든 글자를 새 해상도로 다시 그리고 격자에 맞춘다 */
export function retextAll(scene: Phaser.Scene): number {
  const texts = crispTexts(scene);
  for (const o of texts) {
    if (o.style.resolution !== RENDER_SCALE) o.setResolution(RENDER_SCALE);
    else o.resnap();
  }
  return texts.length;
}

/** 왼쪽 위 화면 위치 × zoom이 정수(백버퍼 픽셀 격자)에서 벗어난 정도. 컨테이너 안 글자는 부모 변환이 붙어 재지 않는다(null) */
export function gridError(
  t: Pick<CrispText, 'x' | 'y' | 'displayOriginX' | 'displayOriginY' | 'parentContainer'>,
  zoom: number,
): number | null {
  if (t.parentContainer) return null;
  const off = (v: number): number => Math.abs(v * zoom - Math.round(v * zoom));
  return Math.max(off(t.x - t.displayOriginX), off(t.y - t.displayOriginY));
}

interface TextSample {
  styleRes: number;
  sourceRes: number;
  grid: number | null;
  probe: boolean;
}

/** 글자 표본들을 TextAudit로 모은다 (순수 계산, 단위 테스트) */
export function summarizeTexts(
  samples: readonly TextSample[],
  totals: { redraws: number; relayouts: number },
): TextAudit {
  const style = samples.map((t) => t.styleRes);
  const source = samples.map((t) => t.sourceRes);
  const grids = samples.map((t) => t.grid).filter((g): g is number => g !== null);
  const probe = samples.find((t) => t.probe);
  const min = (v: number[]): number => (v.length > 0 ? Math.min(...v) : 0);
  const max = (v: number[]): number => (v.length > 0 ? Math.max(...v) : 0);
  return {
    count: samples.length,
    styleResMin: min(style),
    styleResMax: max(style),
    sourceResMin: min(source),
    sourceResMax: max(source),
    gridErrMax: max(grids),
    probeRes: probe ? probe.styleRes : null,
    redraws: totals.redraws,
    relayouts: totals.relayouts,
  };
}

/**
 * 글자 점검 (디버그 훅 textAudit): 주어진 장면들의 모든 CrispText에서 글자 해상도(style) · 텍스처 소스 해상도 ·
 * 격자 어긋남을 모은다. 창 크기 · DPR · 품질이 바뀐 뒤 retextAll이 기존 글자를 새 해상도로 다시 그렸는지 본다
 */
export function auditTexts(scenes: readonly Phaser.Scene[], zoom: number = RENDER_SCALE): TextAudit {
  const samples: TextSample[] = [];
  for (const scene of scenes) {
    const probe = probes.get(scene);
    for (const t of crispTexts(scene)) {
      samples.push({
        styleRes: t.style.resolution,
        sourceRes: t.frame.source.resolution,
        grid: gridError(t, zoom),
        probe: t === probe,
      });
    }
  }
  return summarizeTexts(samples, counters);
}

/** 선명도 검사: HUD 위(카메라 효과가 없는 곳)에 알려진 글자를 그린다. 빈 문자열이면 숨긴다 */
export function drawProbeText(scene: Phaser.Scene, text: string, x: number, y: number, px: number): void {
  let t = probes.get(scene);
  if (!t || !t.scene) {
    t = makeText(scene, x, y, text, {
      fontFamily: UI_FONT,
      fontSize: `${px}px`,
      fontStyle: 'bold',
      color: '#E2E8F0',
    }).setDepth(PROBE_DEPTH);
    probes.set(scene, t);
  } else {
    t.setFontSize(px);
    t.setText(text);
    t.setPosition(x, y);
  }
  t.setVisible(text !== '');
}

/** 글꼴을 다 받은 뒤 장면의 모든 글자를 다시 재고 그린다 (글꼴 이름이 같아 배치 서명은 그대로라도 글자 폭 · 높이가 바뀐다) */
export function relayoutAll(scene: Phaser.Scene): number {
  const texts = crispTexts(scene);
  for (const o of texts) {
    const s = states.get(o);
    if (s) s.sig = '';
    o.style.update(true);
  }
  return texts.length;
}
