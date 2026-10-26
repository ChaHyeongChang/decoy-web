// 미니맵 (우측 상단). 메인 화면과 같은 정보 규칙: 바닥은 메인 화면의 바닥 합성(안개 포함 — 시야 밖은 어두운
// 구조, 시야 안은 밝게)을 줄여 쓰고, 엔티티는 메인 화면에 실제로 그린 목록만 다시 찍는다. 그래서 메인 화면보다
// 많은 정보가 나올 수 없다. 캔버스는 백버퍼 배율로 그리고 이미지는 1/배율로 표시해 화면에 1:1로 찍힌다.
// M10c: 깎은 모서리 틀 + 제목, 엔티티는 역할 실루엣 축소판(생존자 화면) / 흰 공통 실루엣(괴물 화면) / 괴물 망토.
// 엔티티 그림은 HUD 아틀라스 프레임을 쓰는 이미지라 매 프레임 자리 · 방향만 바꾼다 (Graphics 없음)
// 렌더링 최적화 2: 바닥은 안개 그림이 바뀐 다음 프레임에 그린다(안개 합성과 같은 프레임에 겹치지 않게, hudGate.ts
// BaseRefreshPacer). 엔티티 줄은 매 프레임 새 배열 · 사본 · 닫힘 함수를 만들지 않는다(디버그 drawn은 읽을 때 사본)
// M12 터치 배치: 오른쪽 칸 남는 자리(HUD.touch 역할별 minimap)에 둔다. 판 중 창이 낮아져 엄지 버튼이 덮으면 숨긴다(setHidden).
// 따라가는 카메라: 확대 화면에서는 맵 전체가 보이지 않으므로 미니맵이 필수다 — 옆 칸에 자리가 없는 배치(16:9 휴대폰 column ·
// 태블릿 band · 가장 낮은 휴대폰 괴물)는 맵 창 안 오른쪽 위에 둔다(layout minimapInset, R15의 예외: DECISIONS). 확대 1이면 맵 전체가
// 보여 예전처럼 자리가 없으면 만들지 않는다. 보이는 창 사각형 · 거점 · 탈출구 상태(양쪽 화면에 같은 세계 상태) · 관전 중인 동료
// 고리를 더 그린다 — 엔티티는 여전히 메인 화면에 그린 목록만이라 정보 규칙이 같다
// 설정 화면 통합 — 지도 크게 보기: 판 중 지도를 누르면 같은 클래스의 두 번째 미니맵(big)을 맵 창 가운데에 크게 띄운다. 판 장면이
// 작은 미니맵과 같은 값(메인 그림 목록 · 세계 상태 · 보이는 창 · 깜빡임)을 같은 프레임에 넘기고, 바닥은 작은 미니맵이 다시 그린
// 그 프레임에 같은 합성 그림(이미 합성된 캔버스)을 그린다 — 큰 지도는 작은 지도보다 많은 것을 보일 수 없다. 큰 지도의 캔버스는
// 바닥 합성과 같은 해상도(늘리는 것은 렌더러)라 다시 그릴 때 줄이기 · 늘리기가 없다. 처음 열 때 만들고 닫으면 숨긴다
import Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_CENTER,
  type DrawnEntity,
  type ExitView,
  type PointView,
  type Role,
} from '@decoy/shared';
import { HUD_TEXT } from '../data/storyText';
import { NEON, UI } from '../art/palette';
import { gfxState, onGfxChange } from '../gfx/state';
import { minimapScaleFor } from '../render/fogMath';
import {
  createCanvasTexture,
  removeCanvasTexture,
  resizeCanvasTexture,
  uploadCanvasTexture,
} from '../render/fogPaint';
import { FR } from './hudArt';
import { BaseRefreshPacer } from './hudGate';
import type { HudKit, Slice, Spr } from './hudKit';
import type { CrispText } from './text';
import { CAM_ZOOM, HUD } from './layout';
import { MINIMAP_BIG } from '../render/prefsFx';

/** 미니맵 자리 (논리 px): 그림 왼쪽 위 · 폭, 틀 여백 · 제목 줄 */
export interface Place {
  x: number;
  y: number;
  w: number;
  pad: number;
  title: number;
}

/** 이 판의 미니맵 자리 (터치 배치에서 자리가 없고 확대 1이면 null). inset = 맵 창 안 */
function placeFor(monster: boolean): (Place & { inset: boolean }) | null {
  const t = HUD.touch;
  if (!t) return { ...HUD.minimap, inset: false };
  const m = (monster ? t.monster : t.survivor).minimap;
  const k = HUD.s;
  if (m) return { ...m, pad: HUD.minimap.pad * k, title: HUD.minimap.title * k, inset: false };
  // 따라가는 카메라: 옆 칸에 자리가 없으면 맵 창 안 오른쪽 위 (layout.insetCss가 엄지 · 시스템 버튼을 피해 정한 자리)
  const inset = (monster ? t.monster : t.survivor).minimapInset;
  if (CAM_ZOOM <= 1 || !inset) return null;
  return { ...inset, pad: HUD.minimap.pad * k, title: HUD.minimap.title * k, inset: true };
}

const MINIMAP_KEY = 'minimap';
/** 크게 본 지도의 텍스처 키 · 표시 이름 */
const MINIMAP_BIG_KEY = 'minimap-big';
const BIG_TAG = 'minimapBig';

/** 지도 크게 보기 (판 중 지도를 누르면): 자리 · 제목 줄 오른쪽 덧말 (Minimap 생성자) */
export interface MinimapBigOptions {
  place: Place;
  /** 제목 줄 오른쪽 덧말 ('눌러서 닫기') */
  caption: string;
}
/**
 * 확대 화면에서 바닥을 다시 그리는 최소 간격 (ms): 미니맵 바닥은 맵 전체 작은 합성(안개)을 따로 만들어야 해서(fogMini.ts)
 * 안개 주기마다 그리면 화면 밖 그리기 일이 두 배가 된다. 엔티티 · 창 사각형은 매 프레임 그대로
 */
export const MINIMAP_BASE_MS = 200;
/** 미니맵 그림 프레임 이름 (프레임마다 만들지 않는다) */
const MM = {
  track: FR.mm('track'),
  roarSelf: FR.mm('roarSelf'),
  roarPing: FR.mm('roarPing'),
  monster: FR.mm('monster'),
  self: FR.mm('self'),
  hidden: FR.mm('hidden'),
  runner: FR.mm('runner'),
  guard: FR.mm('guard'),
  scout: FR.mm('scout'),
  watch: FR.mm('watch'),
} as const;
/** 거점 · 탈출구 상태 그림 */
const MM_POINT: Readonly<Record<PointView['state'], string>> = {
  idle: FR.mm('point'),
  capturing: FR.mm('point:capturing'),
  blocked: FR.mm('point:blocked'),
  done: FR.mm('point:done'),
};
const MM_EXIT: Readonly<Record<ExitView['state'], string>> = {
  inactive: FR.mm('exit:off'),
  active: FR.mm('exit:active'),
  open: FR.mm('exit'),
};

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.Texture | null = null;
  private readonly image: Phaser.GameObjects.Image | null = null;
  /** 자리 (null = 터치 배치에 자리가 없어 그리지 않는다) */
  private readonly at: Place | null;
  /** 처음 자리가 맵 창 안인가 (layout minimapInset) */
  private readonly homeInset: boolean;
  /** 거점 A · B, 탈출구 N · S 그림 (상태별 프레임) */
  private readonly pointMarks: Spr[] = [];
  private readonly exitMarks: Spr[] = [];
  /** 보이는 창 사각형 (확대 화면: 선 사각형 하나 — 9조각 8장보다 그리기가 적다) · 관전 중인 동료 고리 */
  private viewBox: Phaser.GameObjects.Rectangle | null = null;
  private watchRing: Spr | null = null;
  /** 엔티티 그림 (재사용) */
  private readonly pool: Spr[] = [];
  /** 이번 프레임에 이 미니맵이 다시 찍은 메인 화면 엔티티 (배열 재사용, 디버그 drawn이 읽을 때 사본을 만든다) */
  private readonly src: DrawnEntity[] = [];
  /** 엔티티 그림을 몇 개 썼는가 (update 안) */
  private used = 0;
  /** 바닥을 그릴 프레임 (안개 그림이 바뀐 다음 프레임, hudGate.ts) */
  private readonly pacer = new BaseRefreshPacer();
  readonly w: number;
  readonly h: number;
  /** 캔버스 배율 (백버퍼 px / 논리 px) */
  private scale: number;
  /** 백버퍼 배율이 바뀌어 다음 갱신 때 캔버스 크기를 다시 잡는다 */
  private resizePending = false;
  /** 틀 · 제목 · 늘 표시 위치 (숨길 때 함께) */
  private readonly chrome: (Slice | Spr | CrispText | Phaser.GameObjects.Rectangle)[] = [];
  /** 엄지 버튼이 덮어 숨겼다 (판 중 창이 낮아짐) */
  private hidden = false;
  /** 숨긴 동안 바닥을 갱신하지 않았다: 다시 보이면 바로 한 번 그린다 */
  stale = false;
  /** 맵 창 안에 둔 미니맵의 틀 사각형 (논리 px, 화면 밖 화살표가 피한다). 맵 밖 자리면 null */
  insetRect: { x: number; y: number; w: number; h: number } | null = null;
  /** 옮긴 만큼 (논리 px, relocate — 판 중 창이 낮아져 엄지 버튼이 덮을 때 맵 창 안으로) */
  private ox = 0;
  private oy = 0;
  /** 옮길 때 다시 놓는 늘 그대로인 그림: 틀 · 제목 아이콘 · 제목 글자 · 감옥 표시 */
  private frameSlice: Slice | null = null;
  private titleIcon: Spr | null = null;
  private titleText: CrispText | null = null;
  private prisonMark: Spr | null = null;
  /** 크게 본 지도인가 (big 옵션): 깊이 · 그림 배율 · 텍스처 키 · 이름이 다르고, 캔버스는 바닥 합성과 같은 해상도 */
  private readonly big: boolean;
  /** 깊이 올림 (크게 본 지도 MINIMAP_BIG.depthShift, 작은 지도 0) */
  private readonly dz: number;
  /** 엔티티 · 표시 그림 배율 (크게 본 지도 MINIMAP_BIG.iconScale, 작은 지도 1) */
  private readonly iconScale: number;
  private readonly texKey: string;
  /** 이번 프레임 엔티티마다 몸 그림 이름 (src와 같은 순서, 디버그 drawnFrames — 괴물 화면 흰 공통 실루엣 검사) */
  private readonly srcFrames: string[] = [];
  /** 크게 본 지도: 제목 줄 오른쪽 덧말 */
  private captionText: CrispText | null = null;

  /** bigOpts = 지도 크게 보기 (판 장면이 처음 열 때 만든다). 없으면 판 배치의 미니맵 */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly kit: HudKit,
    monster = false,
    bigOpts: MinimapBigOptions | null = null,
  ) {
    const big = bigOpts !== null;
    const M = bigOpts ? { ...bigOpts.place, inset: false } : placeFor(monster);
    this.big = big;
    this.dz = big ? MINIMAP_BIG.depthShift : 0;
    this.iconScale = big ? MINIMAP_BIG.iconScale : 1;
    this.texKey = big ? MINIMAP_BIG_KEY : MINIMAP_KEY;
    const tag = big ? BIG_TAG : 'minimap';
    const dz = this.dz;
    this.at = M;
    this.homeInset = M?.inset ?? false;
    this.w = M?.w ?? 0;
    this.h = Math.round((this.w * MAP_H) / MAP_W);
    this.scale = big ? 1 : minimapScaleFor(gfxState.zoom);
    if (!big) gfxState.minimapScale = this.scale;
    this.canvas = document.createElement('canvas');
    // 크게 본 지도: 처음 바닥을 그릴 때 바닥 합성 크기로 다시 잡는다 (refreshBase)
    this.canvas.width = big ? 1 : Math.max(1, Math.round(this.w * this.scale));
    this.canvas.height = big ? 1 : Math.max(1, Math.round(this.h * this.scale));
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('미니맵 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    if (!M) return;
    // 이전 판의 같은 키는 지우고, getImageData 사본을 만드는 addCanvas 대신 사본 없이 올린다
    this.texture = createCanvasTexture(scene.textures, this.texKey, this.canvas);
    kit.named(tag, () => {
      const c = this.chrome;
      // 틀: 깎은 모서리 패널 + 제목 (지도 아이콘 + 글자)
      this.frameSlice = kit.slice(39 + dz);
      c.push(this.frameSlice);
      this.titleIcon = kit.spr(41 + dz);
      c.push(this.titleIcon);
      this.titleText = kit
        .text(0, 0, HUD.font.mapTitle, NEON, 42 + dz, true)
        .setOrigin(0, 0.5)
        .setText(HUD_TEXT.minimap);
      c.push(this.titleText);
      // 크게 본 지도: 제목 줄 오른쪽에 닫는 법
      if (bigOpts) {
        this.captionText = kit
          .text(0, 0, HUD.font.mapTitle, UI.textDim, 42 + dz)
          .setOrigin(1, 0.5)
          .setText(bigOpts.caption);
        c.push(this.captionText);
      }
      // 늘 표시 위치: 거점 · 감옥 · 탈출구 (거점 · 탈출구는 상태에 따라 프레임만 바꾼다)
      const mark = (f: string, x: number, y: number): Spr => {
        const sp = kit.spr(41 + dz).set(f, this.px(x), this.py(y));
        c.push(sp);
        return sp;
      };
      for (const id of ['A', 'B'] as const)
        this.pointMarks.push(mark(MM_POINT.idle, CAPTURE_POINTS[id].x, CAPTURE_POINTS[id].y));
      this.prisonMark = mark(FR.mm('prison'), PRISON_CENTER.x, PRISON_CENTER.y);
      for (const id of ['N', 'S'] as const)
        this.exitMarks.push(mark(MM_EXIT.inactive, EXITS[id].center.x, EXITS[id].center.y));
      // 보이는 창 (확대 화면에서만, 엔티티 아래) · 관전 중인 동료 고리 (엔티티 위)
      if (CAM_ZOOM > 1) this.watchRing = kit.spr(42.5 + dz, false);
    });
    if (CAM_ZOOM > 1) {
      // 보이는 창: 흰 선 사각형 (논리 px, 미니맵 그림 위 · 엔티티 아래)
      this.viewBox = scene.add
        .rectangle(M.x, M.y, 1, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(Math.max(1, 1.5 * HUD.s * (big ? MINIMAP_BIG.lineScale : 1)), UI.white, 0.85)
        .setDepth(41.5 + dz)
        .setName(tag);
      this.chrome.push(this.viewBox);
    }
    this.image = scene.add
      .image(M.x, M.y, this.texKey)
      .setOrigin(0, 0)
      .setDepth(40 + dz)
      .setScale(this.w / this.canvas.width, this.h / this.canvas.height)
      .setName(tag);
    this.placeChrome();
    this.scaleMarks();
    // 크게 본 지도의 캔버스는 바닥 합성 크기를 따른다 (백버퍼 배율과 무관)
    if (big) return;
    const off = onGfxChange(() => {
      this.resizePending = true;
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }

  /** 크게 본 지도: 늘 표시 위치 그림(거점 · 감옥 · 탈출구)을 iconScale배로. HUD 아틀라스를 다시 구우면 apply가 되돌리므로 매 프레임 */
  private scaleMarks(): void {
    if (this.iconScale === 1) return;
    const k = this.iconScale / this.kit.dev;
    for (const sp of this.pointMarks) sp.img.setScale(k);
    for (const sp of this.exitMarks) sp.img.setScale(k);
    this.prisonMark?.img.setScale(k);
  }

  /** 틀 사각형 (논리 px, 제목 · 여백 포함 — 누르는 자리). 그리지 않으면 null */
  get frameRect(): { x: number; y: number; w: number; h: number } | null {
    const M = this.at;
    if (!M || this.hidden) return null;
    const f = this.frameSize!;
    return { x: M.x + this.ox - M.pad, y: M.y + this.oy - M.title, w: f.w, h: f.h };
  }

  /** 지도 그림 사각형 (논리 px, 틀 · 제목 안쪽 — 선명도 시험). 그리지 않으면 null */
  get imageRect(): { x: number; y: number; w: number; h: number } | null {
    const M = this.at;
    if (!M || this.hidden) return null;
    return { x: M.x + this.ox, y: M.y + this.oy, w: this.w, h: this.h };
  }

  /** 틀 (제목 · 여백 포함) 크기 (논리 px). 자리가 없으면 null */
  get frameSize(): { w: number; h: number } | null {
    const M = this.at;
    return M ? { w: this.w + M.pad * 2, h: this.h + M.title + M.pad } : null;
  }

  /** 늘 그대로인 그림(틀 · 제목 · 감옥 표시 · 바닥 이미지)을 지금 자리(집 + 옮긴 만큼)에 놓고 피할 사각형을 정한다 */
  private placeChrome(): void {
    const M = this.at;
    if (!M) return;
    const k = HUD.s;
    const x = M.x + this.ox;
    const y = M.y + this.oy;
    const f = this.frameSize!;
    this.frameSlice?.set('mm', x - M.pad, y - M.title, f.w, f.h);
    this.titleIcon?.set(FR.icon('map', NEON, 18), x + 11 * k, y - M.title / 2 - 1 * k);
    this.titleText?.setPosition(x + 26 * k, y - M.title / 2 - 1 * k);
    this.captionText?.setPosition(x + this.w - 2 * k, y - M.title / 2 - 1 * k);
    this.prisonMark?.set(FR.mm('prison'), this.px(PRISON_CENTER.x), this.py(PRISON_CENTER.y));
    this.image?.setPosition(x, y);
    // 맵 창 안이면(처음부터 안쪽 자리 · 옮김) 화면 밖 화살표가 피한다
    this.insetRect =
      this.homeInset || this.ox !== 0 || this.oy !== 0
        ? { x: x - M.pad, y: y - M.title, w: f.w, h: f.h }
        : null;
  }

  /**
   * 틀 왼쪽 위를 to(논리 px)로 옮긴다 (null = 처음 자리). 판 중 창이 낮아져 엄지 버튼이 옆 칸 미니맵을 덮으면 확대 화면에서는
   * 숨기지 않고 맵 창 안 빈 구석으로 옮긴다(GameScene, layout.minimapFallback). 엔티티 · 상태 · 창 사각형은 다음 프레임 px · py로
   */
  relocate(to: { x: number; y: number } | null): void {
    const M = this.at;
    if (!M) return;
    const ox = to ? to.x - (M.x - M.pad) : 0;
    const oy = to ? to.y - (M.y - M.title) : 0;
    if (ox === this.ox && oy === this.oy) return;
    this.ox = ox;
    this.oy = oy;
    this.placeChrome();
  }

  /** 옮겨 둔 자리인가 (디버그 · 시험) */
  get relocated(): boolean {
    return this.ox !== 0 || this.oy !== 0;
  }

  /** 미니맵을 그리는가 (터치 배치에 자리가 없거나 숨겼으면 아니다) */
  get shown(): boolean {
    return this.at !== null && !this.hidden;
  }

  /** 숨기기 · 다시 보이기 (그림 · 틀 · 제목 · 표시 위치 · 엔티티 모두). 숨긴 동안은 그리지도 갱신하지도 않는다 */
  setHidden(on: boolean): void {
    if (on === this.hidden || !this.at) return;
    this.hidden = on;
    if (on) this.stale = true;
    this.image?.setVisible(!on);
    for (const p of this.chrome) {
      if ('show' in p) p.show(!on);
      else p.setVisible(!on);
    }
    for (const s of this.pool) s.show(false);
    this.watchRing?.show(false);
    this.src.length = 0;
  }

  /**
   * 디버그 · 테스트: 미니맵에 다시 찍은 엔티티 (layer = 'minimap' 사본). 마지막 update 때 메인 화면 목록에서 고른 것이다 —
   * update는 메인 그리기 바로 뒤 매 프레임 불리므로 그 항목은 지금도 마지막 메인 그림 그대로다
   */
  get drawn(): DrawnEntity[] {
    return this.src.map((d) => ({ ...d, layer: 'minimap' }));
  }

  /** 디버그 · 테스트: drawn과 같은 순서로 엔티티마다 그린 몸 그림 이름 (괴물 화면 생존자 = 흰 공통 실루엣 'm:hidden') */
  get drawnFrames(): string[] {
    return this.srcFrames.slice();
  }

  /** 백버퍼 배율이 바뀌었으면 캔버스를 그 배율로 다시 잡는다 (다음 바닥 갱신 때 다시 그려진다) */
  private applyScale(): void {
    this.resizePending = false;
    if (this.big) return;
    const s = minimapScaleFor(gfxState.zoom);
    gfxState.minimapScale = s;
    if (s === this.scale || !this.texture || !this.image) return;
    this.scale = s;
    resizeCanvasTexture(
      MINIMAP_KEY,
      this.texture,
      this.canvas,
      Math.round(this.w * s),
      Math.round(this.h * s),
    );
    this.image.setSizeToFrame(this.texture.get());
    this.image.setScale(this.w / this.canvas.width, this.h / this.canvas.height);
  }

  /**
   * 프레임마다 (메인 그리기 뒤): 메인 바닥 합성(안개)이 바뀌었으면 줄여 그린다. 바뀐 프레임에는 미루고 다음 프레임에 그려
   * 안개 합성 · 업로드와 한 프레임에 겹치지 않게 한다(BaseRefreshPacer). 숨겼다가 다시 보이면 바로 그린다.
   * 미니맵이 없거나 숨었으면 축소 합성 원본(baseCanvas)을 읽지 않는다 — 읽을 때 합성되므로 그 비용도 없다
   */
  syncBase(changed: boolean, world: { readonly baseCanvas: HTMLCanvasElement }, nowMs = 0): boolean {
    if (!this.shown) return false;
    // 그릴 차례(안개가 바뀐 다음 프레임)가 오면 갱신 대기로 두고, 확대 화면에서는 지난 갱신에서 MINIMAP_BASE_MS가 지난 뒤 그린다
    if (this.pacer.frame(changed, this.stale)) this.deferred = true;
    if (!this.deferred) return false;
    if (CAM_ZOOM > 1 && !this.stale && nowMs - this.baseAt < MINIMAP_BASE_MS) return false;
    this.deferred = false;
    this.baseAt = nowMs;
    this.refreshBase(world.baseCanvas);
    // 이번 프레임에 바닥을 다시 그렸다 (크게 본 지도가 같은 합성 그림을 같은 프레임에 그린다)
    return true;
  }

  /** 마지막 바닥 갱신 시각 · 간격 때문에 미룬 갱신이 있다 */
  private baseAt = Number.NEGATIVE_INFINITY;
  private deferred = false;

  /** 디버그 · 테스트: 안개 그림이 바뀌었는데 아직 미니맵 바닥에 그리지 않았다 */
  get basePending(): boolean {
    return this.pacer.waiting || this.deferred;
  }

  /**
   * 메인 바닥 합성을 줄여 그린다. count = 바닥 다시 그린 횟수(bakes)에 센다 — 크게 본 지도가 화면 해상도 정적 맵을 다 구워
   * 바꿔 그릴 때는 세지 않는다(작은 지도와 같은 때에만 다시 그리는지 보는 시험)
   */
  refreshBase(base: HTMLCanvasElement, count = true): void {
    if (!this.texture) return;
    this.stale = false;
    if (this.resizePending) this.applyScale();
    // 크게 본 지도: 캔버스를 바닥 합성 크기로 (처음 · 품질이 바뀌어 합성 해상도가 달라졌을 때만) — 그대로 옮겨 그린다
    if (this.big && this.image && (this.canvas.width !== base.width || this.canvas.height !== base.height)) {
      resizeCanvasTexture(this.texKey, this.texture, this.canvas, base.width, base.height, false);
      this.image.setSizeToFrame(this.texture.get());
      this.image.setScale(this.w / this.canvas.width, this.h / this.canvas.height);
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(base, 0, 0, this.canvas.width, this.canvas.height);
    uploadCanvasTexture(this.texture);
    if (count) this.bakes += 1;
  }

  /** 바닥을 다시 그린 횟수 (디버그 · 시험: 크게 본 지도가 작은 지도와 같은 때에만 다시 그리는지) */
  bakes = 0;

  /** 바닥 텍스처 크기 (텍셀 — 크게 본 지도는 바닥 합성 크기를 따른다. 디버그 · 텍스처 예산 계산) */
  get texSize(): { w: number; h: number } {
    return { w: this.canvas.width, h: this.canvas.height };
  }

  /**
   * 크게 본 지도를 닫을 때: 바닥 캔버스 · 텍스처를 1 × 1로 줄여 놓는다 (텍스처 예산에서 빠진다). 다시 열면 refreshBase가 바닥 합성
   * 크기로 다시 잡는다. 작은 지도는 아무것도 하지 않는다
   */
  releaseBase(): void {
    if (!this.big || !this.texture || !this.image) return;
    if (this.canvas.width === 1 && this.canvas.height === 1) return;
    resizeCanvasTexture(this.texKey, this.texture, this.canvas, 1, 1, false);
    this.image.setSizeToFrame(this.texture.get());
    this.image.setScale(this.w, this.h);
  }

  private px(x: number): number {
    return (this.at?.x ?? 0) + this.ox + (x / MAP_W) * this.w;
  }

  private py(y: number): number {
    return (this.at?.y ?? 0) + this.oy + (y / MAP_H) * this.h;
  }

  private sprite(i: number): Spr {
    let s = this.pool[i];
    if (!s) {
      s = this.kit.named(this.big ? BIG_TAG : 'minimap', () => this.kit.spr(42 + this.dz, false));
      this.pool[i] = s;
    }
    return s;
  }

  /** 엔티티 그림 하나를 다음 칸에 놓는다 */
  private put(frame: string, x: number, y: number, rot: number): void {
    const s = this.sprite(this.used);
    this.used += 1;
    s.set(frame, x, y).show(true);
    s.img.setRotation(rot);
    if (this.iconScale !== 1) s.img.setScale(this.iconScale / this.kit.dev);
  }

  /**
   * 거점 · 탈출구 상태와 보이는 창 · 관전 중인 동료 (프레임마다, update 전). 세계 상태는 양쪽 화면에 같이 오는 값이고, 관전
   * 고리는 메인 화면에 그린 동료에만 붙는다(update가 그 자리를 찾는다)
   */
  setWorld(
    points: readonly PointView[],
    exits: readonly ExitView[],
    view: { x: number; y: number; w: number; h: number } | null,
    watching: string | null,
    blinkOff: boolean,
  ): void {
    this.watching = watching;
    if (!this.shown) return;
    for (const p of points) {
      const sp = this.pointMarks[p.id === 'A' ? 0 : 1];
      // 괴물 화면 · 생존자 화면 모두: 점령 중은 깜빡이며 채워진 다이아 (상단 게이지와 같은 깜빡임)
      const f = p.state === 'capturing' && blinkOff ? MM_POINT.idle : MM_POINT[p.state];
      const c = p.id === 'A' ? CAPTURE_POINTS.A : CAPTURE_POINTS.B;
      sp?.set(f, this.px(c.x), this.py(c.y));
    }
    for (const e of exits) {
      const sp = this.exitMarks[e.id === 'N' ? 0 : 1];
      const c = EXITS[e.id].center;
      sp?.set(MM_EXIT[e.state], this.px(c.x), this.py(c.y));
    }
    this.scaleMarks();
    const vb = this.viewBox;
    if (vb) {
      if (view) {
        const x0 = this.px(view.x);
        const y0 = this.py(view.y);
        vb.setPosition(x0, y0)
          .setSize(this.px(view.x + view.w) - x0, this.py(view.y + view.h) - y0)
          .setVisible(true);
      } else vb.setVisible(false);
    }
  }

  /** 관전 중인 동료 id (setWorld) */
  private watching: string | null = null;

  /** 메인 화면에 그린 엔티티만 다시 찍는다 (프레임마다: 새 배열 · 사본 · 닫힘 함수 없이) */
  update(mainDrawn: readonly DrawnEntity[], myRole: Role, roleOf: (id: string) => Role | null): void {
    if (!this.shown) return;
    let ring = false;
    const src = this.src;
    src.length = 0;
    this.srcFrames.length = 0;
    this.used = 0;
    for (const d of mainDrawn) {
      if (d.layer === 'minimap') continue;
      const x = this.px(d.x);
      const y = this.py(d.y);
      let body: string;
      if (d.kind === 'mark') {
        body = d.tag === 'track' ? MM.track : d.tag === 'roarSelf' ? MM.roarSelf : MM.roarPing;
        this.put(body, x, y, 0);
      } else if (d.kind === 'monster' || (d.kind === 'self' && myRole === 'monster')) {
        body = MM.monster;
        this.put(body, x, y, d.face);
      } else {
        // 생존자 화면: 역할 실루엣 (나는 흰 고리를 아래에). 괴물 화면: 흰 공통 실루엣 (역할 · 체력 없음)
        const role = d.kind === 'self' ? myRole : myRole === 'monster' ? null : roleOf(d.id);
        if (d.kind === 'self') this.put(MM.self, x, y, 0);
        body = role && role !== 'monster' ? MM[role] : MM.hidden;
        this.put(body, x, y, d.face);
        if (d.kind === 'survivor' && d.id === this.watching && this.watchRing) {
          this.watchRing.set(MM.watch, x, y).show(true);
          if (this.iconScale !== 1) this.watchRing.img.setScale(this.iconScale / this.kit.dev);
          ring = true;
        }
      }
      src.push(d);
      this.srcFrames.push(body);
    }
    if (!ring) this.watchRing?.show(false);
    for (let i = this.used; i < this.pool.length; i += 1) this.pool[i]?.show(false);
  }

  destroy(): void {
    this.image?.destroy();
    // 크게 본 지도는 판마다 처음 열 때 만든다: 판 장면이 끝나면 텍스처도 지운다 (작은 지도 키는 다음 판이 덮어쓴다)
    if (this.big) removeCanvasTexture(this.scene.textures, this.texKey);
  }
}
