// 미니맵 (우측 상단). 메인 화면과 같은 정보 규칙: 바닥은 메인 화면의 바닥 합성(안개 포함 — 시야 밖은 어두운
// 구조, 시야 안은 밝게)을 줄여 쓰고, 엔티티는 메인 화면에 실제로 그린 목록만 다시 찍는다. 그래서 메인 화면보다
// 많은 정보가 나올 수 없다. 캔버스는 백버퍼 배율로 그리고 이미지는 1/배율로 표시해 화면에 1:1로 찍힌다.
// M10c: 깎은 모서리 틀 + 제목, 엔티티는 역할 실루엣 축소판(생존자 화면) / 흰 공통 실루엣(괴물 화면) / 괴물 망토.
// 엔티티 그림은 HUD 아틀라스 프레임을 쓰는 이미지라 매 프레임 자리 · 방향만 바꾼다 (Graphics 없음)
// 렌더링 최적화 2: 바닥은 안개 그림이 바뀐 다음 프레임에 그린다(안개 합성과 같은 프레임에 겹치지 않게, hudGate.ts
// BaseRefreshPacer). 엔티티 줄은 매 프레임 새 배열 · 사본 · 닫힘 함수를 만들지 않는다(디버그 drawn은 읽을 때 사본)
// M12 터치 배치: 오른쪽 칸 남는 자리(HUD.touch 역할별 minimap)에 둔다. 자리가 없으면 만들지 않는다 — 터치 배치는 판 화면
// 전체가 늘 보여 같은 정보다(축소 합성도 하지 않아 그만큼 싸다). 판 중 창이 낮아져 엄지 버튼이 덮으면 숨긴다(setHidden, 같은 이유)
import Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  PRISON_CENTER,
  type DrawnEntity,
  type Role,
} from '@decoy/shared';
import { HUD_TEXT } from '../data/storyText';
import { NEON } from '../art/palette';
import { gfxState, onGfxChange } from '../gfx/state';
import { minimapScaleFor } from '../render/fogMath';
import { createCanvasTexture, resizeCanvasTexture, uploadCanvasTexture } from '../render/fogPaint';
import { FR } from './hudArt';
import { BaseRefreshPacer } from './hudGate';
import type { HudKit, Slice, Spr } from './hudKit';
import type { CrispText } from './text';
import { HUD } from './layout';

/** 미니맵 자리 (논리 px): 그림 왼쪽 위 · 폭, 틀 여백 · 제목 줄 */
interface Place {
  x: number;
  y: number;
  w: number;
  pad: number;
  title: number;
}

/** 이 판의 미니맵 자리 (터치 배치에서 자리가 없으면 null) */
function placeFor(monster: boolean): Place | null {
  const t = HUD.touch;
  if (!t) return HUD.minimap;
  const m = (monster ? t.monster : t.survivor).minimap;
  const k = HUD.s;
  return m ? { ...m, pad: HUD.minimap.pad * k, title: HUD.minimap.title * k } : null;
}

const MINIMAP_KEY = 'minimap';
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
} as const;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.Texture | null = null;
  private readonly image: Phaser.GameObjects.Image | null = null;
  /** 자리 (null = 터치 배치에 자리가 없어 그리지 않는다) */
  private readonly at: Place | null;
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
  private readonly chrome: (Slice | Spr | CrispText)[] = [];
  /** 엄지 버튼이 덮어 숨겼다 (판 중 창이 낮아짐) */
  private hidden = false;
  /** 숨긴 동안 바닥을 갱신하지 않았다: 다시 보이면 바로 한 번 그린다 */
  stale = false;

  constructor(
    scene: Phaser.Scene,
    private readonly kit: HudKit,
    monster = false,
  ) {
    const M = placeFor(monster);
    this.at = M;
    this.w = M?.w ?? 0;
    this.h = Math.round((this.w * MAP_H) / MAP_W);
    this.scale = minimapScaleFor(gfxState.zoom);
    gfxState.minimapScale = this.scale;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(this.w * this.scale));
    this.canvas.height = Math.max(1, Math.round(this.h * this.scale));
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('미니맵 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    if (!M) return;
    const k = HUD.s;
    // 이전 판의 같은 키는 지우고, getImageData 사본을 만드는 addCanvas 대신 사본 없이 올린다
    this.texture = createCanvasTexture(scene.textures, MINIMAP_KEY, this.canvas);
    kit.named('minimap', () => {
      const c = this.chrome;
      // 틀: 깎은 모서리 패널 + 제목 (지도 아이콘 + 글자)
      c.push(
        kit.slice(39).set('mm', M.x - M.pad, M.y - M.title, this.w + M.pad * 2, this.h + M.title + M.pad),
      );
      c.push(kit.spr(41).set(FR.icon('map', NEON, 18), M.x + 11 * k, M.y - M.title / 2 - 1 * k));
      c.push(
        kit
          .text(M.x + 26 * k, M.y - M.title / 2 - 1 * k, HUD.font.mapTitle, NEON, 42, true)
          .setOrigin(0, 0.5)
          .setText(HUD_TEXT.minimap),
      );
      // 늘 표시 위치: 거점 · 감옥 · 탈출구
      const mark = (f: string, x: number, y: number): number =>
        c.push(kit.spr(41).set(f, this.px(x), this.py(y)));
      for (const p of Object.values(CAPTURE_POINTS)) mark(FR.mm('point'), p.x, p.y);
      mark(FR.mm('prison'), PRISON_CENTER.x, PRISON_CENTER.y);
      for (const e of Object.values(EXITS)) mark(FR.mm('exit'), e.center.x, e.center.y);
    });
    this.image = scene.add
      .image(M.x, M.y, MINIMAP_KEY)
      .setOrigin(0, 0)
      .setDepth(40)
      .setScale(this.w / this.canvas.width, this.h / this.canvas.height)
      .setName('minimap');
    const off = onGfxChange(() => {
      this.resizePending = true;
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
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
    this.src.length = 0;
  }

  /**
   * 디버그 · 테스트: 미니맵에 다시 찍은 엔티티 (layer = 'minimap' 사본). 마지막 update 때 메인 화면 목록에서 고른 것이다 —
   * update는 메인 그리기 바로 뒤 매 프레임 불리므로 그 항목은 지금도 마지막 메인 그림 그대로다
   */
  get drawn(): DrawnEntity[] {
    return this.src.map((d) => ({ ...d, layer: 'minimap' }));
  }

  /** 백버퍼 배율이 바뀌었으면 캔버스를 그 배율로 다시 잡는다 (다음 바닥 갱신 때 다시 그려진다) */
  private applyScale(): void {
    this.resizePending = false;
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
  syncBase(changed: boolean, world: { readonly baseCanvas: HTMLCanvasElement }): void {
    if (!this.shown) return;
    if (this.pacer.frame(changed, this.stale)) this.refreshBase(world.baseCanvas);
  }

  /** 디버그 · 테스트: 안개 그림이 바뀌었는데 아직 미니맵 바닥에 그리지 않았다 */
  get basePending(): boolean {
    return this.pacer.waiting;
  }

  /** 메인 바닥 합성을 줄여 그린다 */
  refreshBase(base: HTMLCanvasElement): void {
    if (!this.texture) return;
    this.stale = false;
    if (this.resizePending) this.applyScale();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(base, 0, 0, this.canvas.width, this.canvas.height);
    uploadCanvasTexture(this.texture);
  }

  private px(x: number): number {
    return (this.at?.x ?? 0) + (x / MAP_W) * this.w;
  }

  private py(y: number): number {
    return (this.at?.y ?? 0) + (y / MAP_H) * this.h;
  }

  private sprite(i: number): Spr {
    let s = this.pool[i];
    if (!s) {
      s = this.kit.named('minimap', () => this.kit.spr(42, false));
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
  }

  /** 메인 화면에 그린 엔티티만 다시 찍는다 (프레임마다: 새 배열 · 사본 · 닫힘 함수 없이) */
  update(mainDrawn: readonly DrawnEntity[], myRole: Role, roleOf: (id: string) => Role | null): void {
    if (!this.shown) return;
    const src = this.src;
    src.length = 0;
    this.used = 0;
    for (const d of mainDrawn) {
      if (d.layer === 'minimap') continue;
      const x = this.px(d.x);
      const y = this.py(d.y);
      if (d.kind === 'mark') {
        this.put(d.tag === 'track' ? MM.track : d.tag === 'roarSelf' ? MM.roarSelf : MM.roarPing, x, y, 0);
      } else if (d.kind === 'monster' || (d.kind === 'self' && myRole === 'monster')) {
        this.put(MM.monster, x, y, d.face);
      } else {
        // 생존자 화면: 역할 실루엣 (나는 흰 고리를 아래에). 괴물 화면: 흰 공통 실루엣 (역할 · 체력 없음)
        const role = d.kind === 'self' ? myRole : myRole === 'monster' ? null : roleOf(d.id);
        if (d.kind === 'self') this.put(MM.self, x, y, 0);
        this.put(role && role !== 'monster' ? MM[role] : MM.hidden, x, y, d.face);
      }
      src.push(d);
    }
    for (let i = this.used; i < this.pool.length; i += 1) this.pool[i]?.show(false);
  }

  destroy(): void {
    this.image?.destroy();
  }
}
