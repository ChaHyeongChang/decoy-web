// HUD 아틀라스와 부품 (M10c): hudArt.ts의 그림을 캔버스 한 장에 기기 픽셀 1:1로 굽고(판 시작 · 백버퍼 배율이 바뀔 때만),
// 부품은 그 프레임을 쓰는 이미지다. 판 중 상태가 바뀌면 프레임 · 자리 · 자르기만 바꾼다(다시 굽기 · 텍스처 다시 올리기 없음,
// Graphics 없음 — WebGL Graphics는 그릴 때마다 다시 테셀레이션한다, DECISIONS M10b 검토).
//  - Spr: 고정 크기 그림 하나. 기준점을 기기 픽셀 격자에 맞춘다(회전하는 미니맵 그림은 맞추지 않는다)
//  - Slice: 늘어나는 패널 (9조각 또는 가로 3조각). 조각 경계도 기기 픽셀 정수라 이음매 · 번짐이 없다
//  - Digits: 고정폭 숫자 (글자마다 같은 폭 칸, 남은 시간이 흔들리지 않게)
// 글자는 모두 text.ts makeText (해상도 = zoom)
// M12: 터치 배치는 그림을 HUD.s배(uiScale)로 키운다. 아틀라스를 zoom × s로 굽고 1텍셀 = 기기 1px로 찍어 선명하다
// (아틀라스 배율 zoom × s, 기기 배율 dev = zoom. PC는 s = 1이라 둘이 같다).
// 부품마다 이름(kit.named)을 달아 디버그 getHudLayout이 읽는다 (timer · gaugeA · card0 · minimap · banner …)
import Phaser from 'phaser';
import { gfxState } from '../gfx/state';
import { createCanvasTexture, makeCanvas, nextFogKey, removeCanvasTexture } from '../render/fogPaint';
import { fontGeneration } from './fonts';
import { hudSpecs, packShelves, sliceSpans, type AtlasSpec } from './hudArt';
import { HUD } from './layout';
import { UI_FONT, makeText, type CrispText } from './text';

/** 프레임 (텍셀): 기준점에서 왼위 모서리까지 X0 · Y0, 크기 W · H */
interface FrameInfo {
  X0: number;
  Y0: number;
  W: number;
  H: number;
}

/** 9조각 (텍셀): 양 끝 조각 크기, 가운데 조각은 1텍셀 안쪽 MID − 2 */
interface KitInfo {
  l: number;
  r: number;
  t: number;
  b: number;
  v: boolean;
}

/** 가운데 조각을 굽는 폭 (텍셀): 가운데는 균일하므로 안쪽 2텍셀만 늘려 쓴다 */
const MID = 4;
const ATLAS_MAX_W = 1024;

interface Atlas {
  key: string;
  /** 굽는 배율 (텍셀 / 그림 단위) = dev × HUD.s */
  zoom: number;
  /** 기기 배율 (기기 px / 논리 px) */
  dev: number;
  /** 그림 목록 서명 (배치마다 굽는 크기가 다르다) */
  sig: string;
  frames: Map<string, FrameInfo>;
  kits: Map<string, KitInfo>;
}

/** 아틀라스는 게임 전역 텍스처라 판이 바뀌어도 같은 배율 · 배치면 다시 쓴다 */
let shared: Atlas | null = null;
let specCache: { sig: string; specs: AtlasSpec[] } | null = null;

/** 굽는 그림이 달라지는 배치 값 (터치 · 크기) */
function specSig(): string {
  return [
    HUD.touch ? 't' : 'p',
    HUD.gauge.dia,
    HUD.gauge.chip,
    HUD.timer.h,
    HUD.hint.h,
    HUD.banner.h,
    HUD.banner.rowH,
  ].join(',');
}
/** 누적 굽기 횟수 (디버그 hud.bakes) */
let bakeCount = 0;

function bakeAtlas(textures: Phaser.Textures.TextureManager, dev: number, sig: string): Atlas {
  const t0 = performance.now();
  const z = dev * HUD.s;
  if (specCache?.sig !== sig) specCache = { sig, specs: hudSpecs() };
  const specs = specCache.specs;
  const frames = new Map<string, FrameInfo>();
  const kits = new Map<string, KitInfo>();
  const sizes = specs.map((s) => {
    if (s.kind === 'frame') {
      const X0 = Math.floor(s.x0 * z) - 1;
      const Y0 = Math.floor(s.y0 * z) - 1;
      const f = { X0, Y0, W: Math.ceil(s.x1 * z) + 1 - X0, H: Math.ceil(s.y1 * z) + 1 - Y0 };
      frames.set(s.name, f);
      return { w: f.W, h: f.H };
    }
    const k: KitInfo = {
      l: Math.round(s.l * z),
      r: Math.round(s.r * z),
      t: Math.round(s.t * z),
      b: s.v ? Math.round(s.b * z) : 0,
      v: s.v,
    };
    kits.set(s.name, k);
    return { w: k.l + MID + k.r, h: s.v ? k.t + MID + k.b : k.t };
  });
  const pack = packShelves(sizes, ATLAS_MAX_W);
  const { canvas, ctx } = makeCanvas(pack.w, pack.h);
  specs.forEach((s, i) => {
    const at = pack.at[i];
    const size = sizes[i];
    if (!at || !size) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(at.x, at.y, size.w, size.h);
    ctx.clip();
    if (s.kind === 'frame') {
      const f = frames.get(s.name);
      if (f) {
        ctx.setTransform(z, 0, 0, z, at.x - f.X0, at.y - f.Y0);
        s.paint(ctx, z);
      }
    } else {
      ctx.setTransform(z, 0, 0, z, at.x, at.y);
      s.paint(ctx, size.w / z, size.h / z, z);
    }
    ctx.restore();
  });
  const key = nextFogKey('hud');
  const tex = createCanvasTexture(textures, key, canvas);
  specs.forEach((s, i) => {
    const at = pack.at[i];
    if (!at) return;
    if (s.kind === 'frame') {
      const f = frames.get(s.name);
      if (f) tex.add(s.name, 0, at.x, at.y, f.W, f.H);
      return;
    }
    const k = kits.get(s.name);
    if (!k) return;
    const xs = [at.x, at.x + k.l + 1, at.x + k.l + MID];
    const ws = [k.l, MID - 2, k.r];
    const ys = k.v ? [at.y, at.y + k.t + 1, at.y + k.t + MID] : [at.y];
    const hs = k.v ? [k.t, MID - 2, k.b] : [k.t];
    ys.forEach((y, row) =>
      xs.forEach((x, col) => tex.add(`${s.name}:${row * 3 + col}`, 0, x, y, ws[col] ?? 0, hs[row] ?? 0)),
    );
  });
  bakeCount += 1;
  gfxState.features.hudBakes = bakeCount;
  gfxState.features.hudBakeMs = Math.round((performance.now() - t0) * 10) / 10;
  return { key, zoom: z, dev, sig, frames, kits };
}

/**
 * 지금 백버퍼 배율의 아틀라스 (있으면 그대로, 없으면 굽는다). 옛 배율 아틀라스는 지금 쓰는 부품이 새 것으로 옮겨진 뒤
 * (같은 동기 흐름이 끝난 뒤) 지운다
 */
function atlasNow(textures: Phaser.Textures.TextureManager): Atlas {
  const dev = gfxState.zoom;
  const sig = specSig();
  if (
    shared &&
    shared.dev === dev &&
    shared.zoom === dev * HUD.s &&
    shared.sig === sig &&
    textures.exists(shared.key)
  )
    return shared;
  const old = shared;
  shared = bakeAtlas(textures, dev, sig);
  if (old && old.key !== shared.key) {
    const k = old.key;
    queueMicrotask(() => removeCanvasTexture(textures, k));
  }
  return shared;
}

/** 로비 대기 중 미리 굽기 (main.ts schedulePrebake에서 부르면 판 시작 때 굽는 시간이 없다. 같은 배율이면 아무것도 안 한다) */
export function prebakeHud(textures: Phaser.Textures.TextureManager): void {
  atlasNow(textures);
}

interface Prim {
  apply(): void;
}

/** 판 장면 하나의 HUD 아틀라스 사용자: 부품을 만들고, 배율이 바뀌면 다시 굽고 모든 부품을 새 프레임으로 다시 놓는다 */
export class HudKit {
  private atlas: Atlas;
  private readonly prims = new Set<Prim>();

  constructor(readonly scene: Phaser.Scene) {
    this.atlas = atlasNow(scene.textures);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.prims.clear());
  }

  /** 매 프레임 처음에: 백버퍼 배율이 바뀌었으면 다시 굽고 모든 부품을 다시 놓는다 */
  sync(): void {
    const a = atlasNow(this.scene.textures);
    if (a === this.atlas) return;
    this.atlas = a;
    for (const p of this.prims) p.apply();
  }

  get key(): string {
    return this.atlas.key;
  }

  /** 굽는 배율 (텍셀 / 그림 단위) */
  get zoom(): number {
    return this.atlas.zoom;
  }

  /** 기기 배율 (기기 px = 텍셀 / 논리 px) */
  get dev(): number {
    return this.atlas.dev;
  }

  /** 지금 만드는 부품의 이름 (named 안에서). 표시 객체 name으로 붙는다 */
  tag = '';

  /** fn 안에서 만든 부품(그림 · 패널 · 글자)에 이름을 붙인다 */
  named<T>(tag: string, fn: () => T): T {
    const prev = this.tag;
    this.tag = tag;
    try {
      return fn();
    } finally {
      this.tag = prev;
    }
  }

  /** 아틀라스에 없는 프레임을 요청한 이름들 (조용히 숨겨지므로 디버그 · E2E로 잡는다) */
  readonly missing = new Set<string>();

  /** 페이지를 연 뒤 HUD 아틀라스를 구운 누적 횟수 */
  get bakes(): number {
    return bakeCount;
  }

  frame(name: string): FrameInfo | undefined {
    return this.atlas.frames.get(name);
  }

  kitInfo(name: string): KitInfo | undefined {
    return this.atlas.kits.get(name);
  }

  track<T extends Prim>(p: T): T {
    this.prims.add(p);
    return p;
  }

  spr(depth: number, snap = true): Spr {
    return this.track(new Spr(this, depth, snap));
  }

  slice(depth: number): Slice {
    return this.track(new Slice(this, depth));
  }

  /** 글자 (UI 글꼴). origin 기본 왼쪽 위 */
  text(x: number, y: number, size: number, color: number, depth: number, bold = false): CrispText {
    return makeText(this.scene, x, y, '', {
      fontFamily: UI_FONT,
      fontSize: `${size}px`,
      fontStyle: bold ? 'bold' : 'normal',
      color: hexColor(color),
    })
      .setOrigin(0, 0)
      .setDepth(depth)
      .setName(this.tag);
  }
}

export function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

const colorOf = new WeakMap<CrispText, number>();

/** 같은 문자열 · 색이면 다시 그리지 않는다 (색 문자열도 만들지 않는다) */
export function setText(t: CrispText, value: string, color?: number): void {
  if (t.text !== value) t.setText(value);
  if (color !== undefined && colorOf.get(t) !== color) {
    colorOf.set(t, color);
    t.setColor(hexColor(color));
  }
}

const fitOf = new WeakMap<CrispText, { gen: number; value: string }>();

/** 이름이 칸보다 길면 뒤를 줄인다 (이름이 바뀔 때만) */
export function fitText(t: CrispText, value: string, maxW: number): void {
  // 폰트 세대도 본다: 늦게 받은 폰트로 폭이 바뀌면 다시 줄인다 (열쇠 문자열 · 데이터 관리자 없이)
  const gen = fontGeneration();
  const last = fitOf.get(t);
  if (last && last.gen === gen && last.value === value) return;
  if (last) {
    last.gen = gen;
    last.value = value;
  } else fitOf.set(t, { gen, value });
  t.setText(value);
  let s = value;
  while (t.width > maxW && s.length > 1) {
    s = s.slice(0, -1);
    t.setText(`${s}…`);
  }
}

/** 고정 크기 그림 하나 (기준점 = 프레임의 0, 0) */
export class Spr implements Prim {
  readonly img: Phaser.GameObjects.Image;
  private name = '';
  private x = 0;
  private y = 0;
  /** 보이기로 한 상태 (다시 구운 뒤 apply가 숨긴 그림을 되살리지 않게) */
  private on = false;
  /** 가로 자르기 (기준점에서 논리 px, null = 자르지 않음) */
  private cut: { from: number; to: number; dx: number } | null = null;

  constructor(
    private readonly kit: HudKit,
    depth: number,
    private readonly snap: boolean,
  ) {
    this.img = kit.scene.add.image(0, 0, kit.key).setDepth(depth).setVisible(false).setName(kit.tag);
  }

  /** 프레임과 기준점 (논리 px)에 보인다. 빈 이름이면 숨긴다 */
  set(name: string, x: number, y: number): this {
    const on = name !== '';
    if (name === this.name && x === this.x && y === this.y && on === this.on) return this;
    this.name = name;
    this.x = x;
    this.y = y;
    this.on = on;
    this.apply();
    return this;
  }

  /** 가로로 잘라 기준점에서 from~to(논리 px) 부분만 보인다. dx = 무늬를 흘리는 텍셀(= 기기 px) 수 (보이는 자리는 그대로) */
  crop(from: number, to: number, dx = 0): this {
    const c = this.cut;
    if (c && c.from === from && c.to === to && c.dx === dx) return this;
    // 흐르는 사선은 프레임마다 dx만 바뀐다: 객체를 새로 만들지 않고 고쳐 쓴다
    if (c) {
      c.from = from;
      c.to = to;
      c.dx = dx;
    } else this.cut = { from, to, dx };
    this.apply();
    return this;
  }

  apply(): void {
    const f = this.kit.frame(this.name);
    const img = this.img;
    if (this.on && !f) this.kit.missing.add(this.name);
    if (!f || !this.on) {
      img.setVisible(false);
      return;
    }
    // 1텍셀 = 기기 1px (그림은 HUD.s배로 구워져 있다)
    const z = this.kit.dev;
    if (img.texture.key !== this.kit.key || img.frame.name !== this.name)
      img.setTexture(this.kit.key, this.name);
    img.setOrigin(-f.X0 / f.W, -f.Y0 / f.H).setScale(1 / z);
    const px = this.snap ? Math.round(this.x * z) / z : this.x;
    const py = this.snap ? Math.round(this.y * z) / z : this.y;
    const c = this.cut;
    if (c) {
      const a = Math.round(c.from * z) - f.X0;
      const b = Math.round(c.to * z) - f.X0;
      img.setCrop(a + c.dx, 0, Math.max(0, Math.min(f.W, b + c.dx) - a - c.dx), f.H);
      img.setPosition(px - c.dx / z, py);
    } else {
      img.setPosition(px, py);
    }
    img.setVisible(true);
  }

  show(on: boolean): this {
    const want = on && this.name !== '';
    if (want === this.on) return this;
    this.on = want;
    this.apply();
    return this;
  }

  get shown(): boolean {
    return this.on;
  }

  get frameName(): string {
    return this.name;
  }
}

/** 늘어나는 패널 (9조각 · 가로 3조각) */
export class Slice implements Prim {
  private readonly imgs: Phaser.GameObjects.Image[] = [];
  private name = '';
  private readonly rect = { x: 0, y: 0, w: 0, h: 0 };
  private on = false;
  private alpha = 1;
  /** 가운데 조각을 그리지 않는다 (발각 테두리처럼 가운데가 빈 것) */
  hollow = false;
  /** 조각 이미지 이름 (만들 때의 kit.tag) */
  private readonly tag: string;

  constructor(
    private readonly kit: HudKit,
    private readonly depth: number,
  ) {
    this.tag = kit.tag;
  }

  set(name: string, x: number, y: number, w: number, h: number): this {
    const r = this.rect;
    if (name === this.name && x === r.x && y === r.y && w === r.w && h === r.h && this.on) return this;
    this.name = name;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    this.on = true;
    this.apply();
    return this;
  }

  /** 지금 자리 (논리 px) */
  get bounds(): { x: number; y: number; w: number; h: number } {
    return { ...this.rect };
  }

  apply(): void {
    const k = this.kit.kitInfo(this.name);
    if (this.on && !k) this.kit.missing.add(this.name);
    if (!k || !this.on) {
      for (const i of this.imgs) i.setVisible(false);
      return;
    }
    const z = this.kit.dev;
    const { x, y, w, h } = this.rect;
    const cols = sliceSpans(Math.round(x * z), Math.round((x + w) * z), k.l, k.r);
    const rows: [number, number][] = k.v
      ? sliceSpans(Math.round(y * z), Math.round((y + h) * z), k.t, k.b)
      : [[Math.round(y * z), k.t]];
    let n = 0;
    rows.forEach(([py, ph], ri) =>
      cols.forEach(([px, pw], ci) => {
        let img = this.imgs[n];
        if (!img) {
          img = this.kit.scene.add
            .image(0, 0, this.kit.key)
            .setOrigin(0, 0)
            .setDepth(this.depth)
            .setName(this.tag);
          img.setAlpha(this.alpha);
          this.imgs.push(img);
        }
        n += 1;
        const idx = ri * 3 + ci;
        const fw = ci === 1 ? MID - 2 : ci === 0 ? k.l : k.r;
        const fh = !k.v ? k.t : ri === 1 ? MID - 2 : ri === 0 ? k.t : k.b;
        const empty = pw <= 0 || ph <= 0 || (this.hollow && idx === 4);
        img.setVisible(!empty);
        if (empty) return;
        img.setTexture(this.kit.key, `${this.name}:${idx}`);
        img.setOrigin(0, 0).setPosition(px / z, py / z);
        img.setScale(pw / fw / z, ph / fh / z);
      }),
    );
    for (let i = n; i < this.imgs.length; i += 1) this.imgs[i]?.setVisible(false);
  }

  show(on: boolean): this {
    if (on === this.on) return this;
    this.on = on;
    this.apply();
    return this;
  }

  get shown(): boolean {
    return this.on;
  }

  /** 이 패널의 조각 이미지인가 (후처리 검사의 레이어 분류) */
  owns(o: unknown): boolean {
    return this.imgs.some((i) => i === o);
  }

  setAlpha(a: number): this {
    if (a === this.alpha) return this;
    this.alpha = a;
    for (const i of this.imgs) i.setAlpha(a);
    return this;
  }
}

/** 고정폭 숫자의 한 자리: 이 자리에 나온 글자마다 글자 객체 하나 (보이기만 바꾼다) */
interface DigitCell {
  glyphs: Map<string, CrispText>;
  /** 지금 보이는 글자 객체 */
  shown: CrispText | null;
}

/**
 * 고정폭 숫자: 글자 하나에 칸 하나 (칸 폭 = 그 글꼴에서 가장 넓은 숫자). 자리마다 처음 나온 글자의 글자 객체를 만들어 두고
 * 다음부터는 보이기만 바꾼다 — 남은 시간이 1초마다 바뀌어도 글자를 다시 그리거나 올리지 않는다(렌더링 최적화 2. 자리 · 글자 ·
 * 글꼴 · 해상도가 같은 글자 객체라 그림은 예전처럼 한 칸 글자를 다시 그리던 것과 같다)
 */
export class Digits {
  private readonly cells: DigitCell[] = [];
  /** 글자 객체마다 마지막으로 놓은 자리 · 색 (같으면 다시 놓지 · 칠하지 않는다) */
  private readonly at = new Map<CrispText, number>();
  private readonly colors = new Map<CrispText, number>();
  private digitW = 0;
  private sepW = 0;
  /** 칸 폭을 잰 폰트 세대 (늦게 받은 폰트면 다시 잰다) */
  private gen = -1;
  private value = '';
  /** 보이는 칸 수 (value의 글자 수) */
  private count = 0;
  /** 칸 글자 이름 (만들 때의 kit.tag) */
  private readonly tag: string;
  width = 0;

  constructor(
    private readonly kit: HudKit,
    private readonly size: number,
    private readonly depth: number,
  ) {
    this.tag = kit.tag;
    this.remeasure();
  }

  /** 지금 글꼴로 숫자 · 구분자 칸 폭을 잰다 (세대가 같으면 그대로) */
  private remeasure(): void {
    const gen = fontGeneration();
    if (gen === this.gen) return;
    this.gen = gen;
    const { ctx } = makeCanvas(1, 1);
    ctx.font = `bold ${this.size}px ${UI_FONT}`;
    let w = 0;
    for (let d = 0; d <= 9; d += 1) w = Math.max(w, ctx.measureText(String(d)).width);
    this.digitW = Math.ceil(w);
    this.sepW = Math.ceil(ctx.measureText(':').width + this.size * 0.08);
    this.at.clear();
  }

  private cellW(ch: string): number {
    return ch >= '0' && ch <= '9' ? this.digitW : this.sepW;
  }

  /** 글자 폭 (배치 계산용) */
  measure(text: string): number {
    this.remeasure();
    let w = 0;
    for (const ch of text) w += this.cellW(ch);
    return w;
  }

  /** i번째 칸에 ch를 쓰는 글자 객체 (처음이면 만든다) */
  private glyph(i: number, ch: string, color: number): CrispText {
    let cell = this.cells[i];
    if (!cell) {
      cell = { glyphs: new Map(), shown: null };
      this.cells[i] = cell;
    }
    let t = cell.glyphs.get(ch);
    if (!t) {
      t = this.kit.text(0, 0, this.size, color, this.depth, true).setOrigin(0.5, 0.5).setName(this.tag);
      t.setText(ch);
      this.colors.set(t, color);
      cell.glyphs.set(ch, t);
    }
    return t;
  }

  /** 왼쪽 x에서 시작, 세로 가운데 y */
  set(text: string, x: number, y: number, color: number): void {
    this.remeasure();
    let cx = x;
    let i = 0;
    for (const ch of text) {
      const t = this.glyph(i, ch, color);
      const cell = this.cells[i];
      if (cell && cell.shown !== t) {
        cell.shown?.setVisible(false);
        cell.shown = t;
      }
      const w = this.cellW(ch);
      if (this.colors.get(t) !== color) {
        this.colors.set(t, color);
        t.setColor(hexColor(color));
      }
      const key = (cx + w / 2) * 4096 + y;
      if (this.at.get(t) !== key) {
        this.at.set(t, key);
        t.setPosition(cx + w / 2, y);
      }
      t.setVisible(true);
      cx += w;
      i += 1;
    }
    for (let j = i; j < this.cells.length; j += 1) {
      const cell = this.cells[j];
      if (cell?.shown) {
        cell.shown.setVisible(false);
        cell.shown = null;
      }
    }
    this.value = text;
    this.count = i;
    this.width = cx - x;
  }

  get text(): string {
    return this.value;
  }

  /** 칸 폭을 잰 폰트 세대 (디버그 · E2E: 늦게 받은 폰트로 다시 쟀는가) */
  get measuredGen(): number {
    return this.gen;
  }

  show(on: boolean): void {
    this.cells.forEach((c, i) => c.shown?.setVisible(on && i < this.count));
  }
}
