// Phaser 글자는 모두 여기서 만든다 (MOBILE_PLAN M10a 4번).
//  - 글자 텍스처 해상도 = 카메라 zoom (백버퍼 1px = 텍셀 1개). Phaser는 해상도를 주지 않으면 1로 굳힌다
//  - 텍스처 크기를 정수 텍셀로 맞춘다: 소수 크기면 캔버스는 잘리고 사각형은 소수라 글자 전체가 다시 샘플된다
//  - 화면 위치(왼쪽 위)를 백버퍼 픽셀 격자에 맞춘다. 기준 위치를 따로 기억해 setText · setOrigin을 반복해도 오차가 쌓이지 않는다
// 직접 scene.add.text를 쓰면 이 처리가 빠진다 → 소스 검사 테스트가 막는다 (tests/unit/resolution.test.ts)
import Phaser from 'phaser';
import { RENDER_SCALE } from './layout';

export const UI_FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

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
    try {
      const st = this.style;
      const res = st.resolution;
      const sig = layoutSig(this);
      if (sig !== s.sig) {
        // 자연 크기를 잰다 (고정 크기를 풀고 한 번 그린다)
        st.fixedWidth = 0;
        st.fixedHeight = 0;
        super.updateText();
        s.sig = sig;
        const tw = this.width * res;
        const th = this.height * res;
        const exact = Math.abs(tw - Math.round(tw)) < 1e-6 && Math.abs(th - Math.round(th)) < 1e-6;
        s.fixedW = exact ? 0 : (Math.ceil(tw - 1e-6) + TEXEL_EPS) / res;
        s.fixedH = exact ? 0 : (Math.ceil(th - 1e-6) + TEXEL_EPS) / res;
        if (exact) return this.afterUpdate();
      }
      st.fixedWidth = s.fixedW;
      st.fixedHeight = s.fixedH;
      super.updateText();
      return this.afterUpdate();
    } finally {
      s.busy = false;
    }
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

/** 카메라 zoom이 바뀐 뒤 장면의 모든 글자를 새 해상도로 다시 그리고 격자에 맞춘다 */
export function retextAll(scene: Phaser.Scene): number {
  let n = 0;
  const visit = (list: readonly Phaser.GameObjects.GameObject[]): void => {
    for (const o of list) {
      if (o instanceof CrispText) {
        if (o.style.resolution !== RENDER_SCALE) o.setResolution(RENDER_SCALE);
        else o.resnap();
        n += 1;
      } else if (o instanceof Phaser.GameObjects.Container || o instanceof Phaser.GameObjects.Layer) {
        visit(o.list);
      }
    }
  };
  visit(scene.children.list);
  return n;
}

const probes = new WeakMap<Phaser.Scene, CrispText>();

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
