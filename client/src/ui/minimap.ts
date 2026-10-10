// 미니맵 (우측 상단). 메인 화면과 같은 정보 규칙: 바닥은 메인 화면의 바닥 합성(안개 포함 — 시야 밖은 어두운
// 구조, 시야 안은 밝게)을 줄여 쓰고, 엔티티는 메인 화면에 실제로 그린 목록만 다시 찍는다. 그래서 메인 화면보다
// 많은 정보가 나올 수 없다. 캔버스는 백버퍼 배율로 그리고 이미지는 1/배율로 표시해 화면에 1:1로 찍힌다.
// M10c: 깎은 모서리 틀 + 제목, 엔티티는 역할 실루엣 축소판(생존자 화면) / 흰 공통 실루엣(괴물 화면) / 괴물 망토.
// 엔티티 그림은 HUD 아틀라스 프레임을 쓰는 이미지라 매 프레임 자리 · 방향만 바꾼다 (Graphics 없음)
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

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Phaser.Textures.Texture | null = null;
  private readonly image: Phaser.GameObjects.Image | null = null;
  /** 자리 (null = 터치 배치에 자리가 없어 그리지 않는다) */
  private readonly at: Place | null;
  /** 엔티티 그림 (재사용) */
  private readonly pool: Spr[] = [];
  readonly w: number;
  readonly h: number;
  drawn: DrawnEntity[] = [];
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
    this.drawn = [];
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

  /** 메인 바닥 합성이 갱신될 때 함께 줄여 그린다 */
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

  /** 메인 화면에 그린 엔티티만 다시 찍는다 */
  update(mainDrawn: readonly DrawnEntity[], myRole: Role, roleOf: (id: string) => Role | null): void {
    if (!this.shown) return;
    const out: DrawnEntity[] = [];
    let n = 0;
    const put = (frame: string, x: number, y: number, rot: number): void => {
      const s = this.sprite(n);
      n += 1;
      s.set(frame, x, y).show(true);
      s.img.setRotation(rot);
    };
    for (const d of mainDrawn) {
      if (d.layer === 'minimap') continue;
      const x = this.px(d.x);
      const y = this.py(d.y);
      if (d.kind === 'mark') {
        put(FR.mm(d.tag === 'track' || d.tag === 'roarSelf' ? d.tag : 'roarPing'), x, y, 0);
      } else if (d.kind === 'monster' || (d.kind === 'self' && myRole === 'monster')) {
        put(FR.mm('monster'), x, y, d.face);
      } else {
        // 생존자 화면: 역할 실루엣 (나는 흰 고리를 아래에). 괴물 화면: 흰 공통 실루엣 (역할 · 체력 없음)
        const role = d.kind === 'self' ? myRole : myRole === 'monster' ? null : roleOf(d.id);
        if (d.kind === 'self') put(FR.mm('self'), x, y, 0);
        put(FR.mm(role && role !== 'monster' ? role : 'hidden'), x, y, d.face);
      }
      out.push({ ...d, layer: 'minimap' });
    }
    for (let i = n; i < this.pool.length; i += 1) this.pool[i]?.show(false);
    this.drawn = out;
  }

  destroy(): void {
    this.image?.destroy();
  }
}
