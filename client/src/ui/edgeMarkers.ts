// 화면 밖 화살표 그리기 (따라가는 카메라). 무엇을 어디에 놓을지는 순수 모듈(render/offscreen.ts)이 정하고, 여기서는 HUD
// 아틀라스 그림(배지 · 셰브론 · 문양 · 아이콘)을 재사용 풀로 놓기만 한다(매 프레임 Graphics · 텍스처 없음).
// 깊이 38.5~38.7: 창 밖 가리개(37) · 발각 테두리(38) 위, HUD 패널(39~) 아래 — 맵 사각형 안 표시라 HUD 패널 목록에 들지 않는다.
// 색만으로 구분하지 않기: 역할 = 문양 모양 + 색, 괴물 = 괴물 문양, 탐지 · 포효 · 감옥 · 탈출구 · 거점 = 아이콘 모양 + 색.
// 괴물 화면의 포효 핑은 흰 공통 문양(역할 없음)이다
import type { OffscreenMarkerDebug, Role } from '@decoy/shared';
import { EXIT_GO, HIDDEN_SURVIVOR, NEON, PRISON_RED, ROLE, UI, WARN } from '../art/palette';
import type { IconId } from '../art/icons';
import { EDGE_ART, EDGE_GLYPH, EDGE_ICON, FR } from './hudArt';
import { setText, type HudKit, type Spr } from './hudKit';
import type { CrispText } from './text';
import { HUD } from './layout';
import type { EdgeMarker } from '../render/offscreen';

/** 깊이 (창 밖 가리개 37 · 발각 테두리 38 위, HUD 39 아래) */
const DEPTH = { badge: 38.5, icon: 38.6, text: 38.7 } as const;
/** 몸과 겹친 화살표 · 깜빡임 꺼진 위상의 알파 */
const FADED_ALPHA = 0.35;
const BLINK_MS = 500;

interface Item {
  badge: Spr;
  chev: Spr;
  icon: Spr;
}

/** 화살표 하나의 그림 (강조색 · 배지 안 그림 · 글자) */
export interface EdgeLook {
  color: number;
  /** 배지 안 그림 프레임 */
  inner: string;
  /** 배지 안 글자 (거점 A/B) */
  label: string;
  labelColor: number;
  /** 깜빡임 (괴물 화면 점령 알림) */
  blink: boolean;
  /** 낮은 강조 (대기 거점 · 활성(닫힌) 탈출구) */
  dim: boolean;
}

const icon = (id: IconId, color: number, size = EDGE_ICON): string => FR.icon(id, color, size);

/** 화살표 그림을 고른다 (순수: hud.test가 프레임이 아틀라스에 있는지 본다) */
export function edgeLook(m: EdgeMarker, monsterScreen: boolean): EdgeLook {
  const base = { label: '', labelColor: UI.text, blink: false, dim: false };
  const roleColor = (r: Role | null): number => (r ? ROLE[r] : HIDDEN_SURVIVOR);
  switch (m.kind) {
    case 'monster':
      return { ...base, color: ROLE.monster, inner: FR.glyph('monster', EDGE_GLYPH) };
    case 'track':
      return { ...base, color: ROLE.scout, inner: icon('track', ROLE.scout) };
    case 'roar':
      return { ...base, color: WARN, inner: icon('roar', WARN) };
    case 'roarPing':
      return { ...base, color: HIDDEN_SURVIVOR, inner: FR.glyph('hidden', EDGE_GLYPH) };
    case 'prison':
      return { ...base, color: PRISON_RED, inner: icon('prison', PRISON_RED) };
    case 'teammate': {
      const r = m.role && m.role !== 'monster' ? m.role : null;
      return {
        ...base,
        color: roleColor(r),
        inner: r ? FR.glyph(r, EDGE_GLYPH) : FR.glyph('hidden', EDGE_GLYPH),
      };
    }
    case 'self': {
      const r = m.role && m.role !== 'monster' ? m.role : null;
      return {
        ...base,
        color: HIDDEN_SURVIVOR,
        inner: r ? FR.glyph(r, EDGE_GLYPH) : FR.glyph('hidden', EDGE_GLYPH),
      };
    }
    case 'exit':
      return { ...base, color: EXIT_GO, inner: icon('exit', EXIT_GO), dim: m.state !== 'open' };
    case 'point': {
      // 괴물 화면: 점령 중 경고(주황 깜빡임). 생존자 화면: 점령 중 청록 · 정지 주황 · 대기 흐림
      const col = monsterScreen || m.state === 'blocked' ? WARN : m.state === 'capturing' ? NEON : UI.textDim;
      return {
        ...base,
        color: col,
        inner: icon('point', col, EDGE_ICON + 4),
        label: m.id,
        labelColor: col,
        blink: monsterScreen,
        dim: !monsterScreen && m.state === 'idle',
      };
    }
  }
}

export class EdgeMarkers {
  private readonly items: Item[] = [];
  private used = 0;
  /** 이번 프레임에 놓은 화살표 (디버그는 그림 자리를 읽는다) */
  private readonly shown: { m: EdgeMarker; item: Item }[] = [];

  /**
   * 거점 글자 A · B (거점 화살표는 둘뿐이라 글자도 둘을 만들 때 한 번 만들어 둔다: 풀 칸마다 글자를 바꿔 쓰면 글자
   * 캔버스를 프레임마다 다시 그리고 크기를 바꾼다)
   */
  private readonly labels: Readonly<Record<'A' | 'B', CrispText>>;

  constructor(private readonly kit: HudKit) {
    const make = (ch: string): CrispText =>
      kit.named('edge', () => {
        const t = kit.text(0, 0, Math.round(12 * HUD.s), UI.text, DEPTH.text, true).setOrigin(0.5, 0.5);
        setText(t, ch);
        return t.setVisible(false);
      });
    this.labels = { A: make('A'), B: make('B') };
  }

  private item(i: number): Item {
    let it = this.items[i];
    if (!it) {
      const k = this.kit;
      it = k.named('edge', () => ({
        badge: k.spr(DEPTH.badge),
        chev: k.spr(DEPTH.badge, false),
        icon: k.spr(DEPTH.icon),
      }));
      this.items[i] = it;
    }
    return it;
  }

  /** 프레임마다: 놓인 화살표를 그린다 (나머지는 숨긴다) */
  update(markers: readonly EdgeMarker[], monsterScreen: boolean, nowMs: number): void {
    this.used = 0;
    this.shown.length = 0;
    const blinkOff = Math.floor(nowMs / BLINK_MS) % 2 === 1;
    let showA = false;
    let showB = false;
    for (const m of markers) {
      const it = this.item(this.used);
      this.used += 1;
      const look = edgeLook(m, monsterScreen);
      const alpha = m.faded || (look.blink && blinkOff) ? FADED_ALPHA : look.dim ? 0.85 : 1;
      it.badge.set(FR.edge('badge', look.color), m.x, m.y).show(true);
      it.chev.set(FR.edge('chev', look.color), m.x, m.y).show(true);
      it.chev.img.setRotation(m.dir);
      // 거점은 다이아 아이콘 안에 글자
      it.icon.set(look.inner, m.x, m.y).show(true);
      it.badge.img.setAlpha(alpha);
      it.chev.img.setAlpha(alpha);
      it.icon.img.setAlpha(alpha);
      if (look.label === 'A' || look.label === 'B') {
        const t = this.labels[look.label];
        setText(t, look.label, look.labelColor);
        t.setPosition(m.x, m.y + 0.5 * HUD.s)
          .setAlpha(alpha)
          .setVisible(true);
        if (look.label === 'A') showA = true;
        else showB = true;
      }
      this.shown.push({ m, item: it });
    }
    if (!showA) this.labels.A.setVisible(false);
    if (!showB) this.labels.B.setVisible(false);
    for (let i = this.used; i < this.items.length; i += 1) this.hideItem(this.items[i]);
  }

  private hideItem(it: Item | undefined): void {
    if (!it) return;
    it.badge.show(false);
    it.chev.show(false);
    it.icon.show(false);
  }

  hide(): void {
    this.used = 0;
    this.shown.length = 0;
    for (const it of this.items) this.hideItem(it);
    this.labels.A.setVisible(false);
    this.labels.B.setVisible(false);
  }

  /** 디버그 · 시험: 실제로 보이는 화살표 (그림의 자리 · 회전을 읽는다) */
  debug(): OffscreenMarkerDebug[] {
    const out: OffscreenMarkerDebug[] = [];
    for (const { m, item } of this.shown) {
      if (!item.badge.img.visible) continue;
      out.push({
        kind: m.kind,
        id: m.id,
        tx: m.tx,
        ty: m.ty,
        x: item.badge.img.x,
        y: item.badge.img.y,
        dir: item.chev.img.rotation,
      });
    }
    return out;
  }
}

/** 배치 값 (논리 px): 배지 반지름 · 창 가장자리에서 배지 가운데 · 배지 사이 틈 */
export function edgeMetrics(): { r: number; inset: number; gap: number } {
  const s = HUD.s;
  return { r: EDGE_ART.r * s, inset: EDGE_ART.inset * s, gap: EDGE_ART.gap * s };
}
