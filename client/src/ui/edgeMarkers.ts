// 화면 밖 화살표 그리기 (따라가는 카메라). 무엇을 어디에 놓을지는 순수 모듈(render/offscreen.ts)이 정하고, 여기서는 HUD
// 아틀라스 그림(배지 · 셰브론 · 문양 · 아이콘)을 재사용 풀로 놓기만 한다(매 프레임 Graphics · 텍스처 없음).
// 깊이 38.5~38.7: 창 밖 가리개(37) · 발각 테두리(38) 위, HUD 패널(39~) 아래 — 맵 사각형 안 표시라 HUD 패널 목록에 들지 않는다.
// 그림 고르기(색만으로 구분하지 않기)는 순수 모듈 edgeLook.ts에 있다.
// 괴물 화면의 포효 핑은 흰 공통 문양(역할 없음)이고, 이 화살표만 크게(EDGE_ART.pingScale배) + 흰 펄스 고리(월드 핑과 같은
// 박자, prefsFx.pingPulse)를 그린다 — 대상 · 자리 · 수명은 그대로이고 핑마다 같은 그림이다
import type { OffscreenMarkerDebug } from '@decoy/shared';
import { UI } from '../art/palette';
import { EDGE_ART, FR } from './hudArt';
import { EDGE_HALO, chevBack, edgeLook, haloScale } from './edgeLook';
import { setText, type HudKit, type Spr } from './hudKit';
import type { CrispText } from './text';
import { HUD } from './layout';
import type { EdgeMarker } from '../render/offscreen';
import type { PingPulse } from '../render/prefsFx';

/** 깊이 (창 밖 가리개 37 · 발각 테두리 38 위, HUD 39 아래). 펄스 고리는 배지 바로 아래 */
const DEPTH = { halo: 38.45, badge: 38.5, icon: 38.6, text: 38.7 } as const;
/** 몸과 겹친 화살표 · 깜빡임 꺼진 위상의 알파 */
const FADED_ALPHA = 0.35;
const BLINK_MS = 500;

interface Item {
  badge: Spr;
  chev: Spr;
  icon: Spr;
  /** 포효 핑 펄스 고리 (다른 화살표에서는 숨긴다) */
  halo: Spr;
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
        halo: k.spr(DEPTH.halo, false),
      }));
      this.items[i] = it;
    }
    return it;
  }

  /**
   * 프레임마다: 놓인 화살표를 그린다 (나머지는 숨긴다). pulse = 이번 프레임 포효 핑 펄스 고리 값(prefsFx.pingPulse — 판 장면이
   * 미니맵과 같은 값을 넘긴다. 살아 있는 핑이 없으면 알파 0)
   */
  update(
    markers: readonly EdgeMarker[],
    monsterScreen: boolean,
    nowMs: number,
    pulse: Readonly<PingPulse>,
  ): void {
    this.used = 0;
    this.shown.length = 0;
    const blinkOff = Math.floor(nowMs / BLINK_MS) % 2 === 1;
    const z = this.kit.dev;
    let showA = false;
    let showB = false;
    for (const m of markers) {
      const it = this.item(this.used);
      this.used += 1;
      const look = edgeLook(m, monsterScreen);
      const alpha = m.faded || (look.blink && blinkOff) ? FADED_ALPHA : look.dim ? 0.85 : 1;
      // 큰 화살표(포효 핑): 배지 · 문양 · 셰브론을 scale배로. 셰브론은 끝이 창 가장자리를 넘지 않게 배지 쪽으로 당긴다
      const k = m.scale;
      const back = k === 1 ? 0 : chevBack(k) * HUD.s;
      it.badge.set(FR.edge('badge', look.color), m.x, m.y).show(true);
      it.chev
        .set(FR.edge('chev', look.color), m.x - Math.cos(m.dir) * back, m.y - Math.sin(m.dir) * back)
        .show(true);
      it.chev.img.setRotation(m.dir);
      // 거점은 다이아 아이콘 안에 글자
      it.icon.set(look.inner, m.x, m.y).show(true);
      // 풀로 다시 쓰는 그림이라 배율 · 알파를 매 프레임 다시 건다: set은 같은 값이면 아무것도 하지 않고, apply는 배율만 되돌린다 —
      // 포효 핑에 썼던 칸이 다음 프레임에 거점 화살표가 되어도 커진 채 남지 않게
      it.badge.img.setScale(k / z).setAlpha(alpha);
      it.chev.img.setScale(k / z).setAlpha(alpha);
      it.icon.img.setScale(k / z).setAlpha(alpha);
      if (look.pulse && pulse.alpha > 0) {
        // 몸과 겹쳐 흐려진 화살표는 고리도 같이 흐리게 (R15)
        it.halo.set(EDGE_HALO, m.x, m.y).show(true);
        it.halo.img.setScale(haloScale(pulse.t) / z).setAlpha(pulse.alpha * (m.faded ? FADED_ALPHA : 1));
      } else it.halo.show(false);
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
    it.halo.show(false);
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
      // 배율 · 고리는 그림에 실제로 걸린 값을 읽는다 (HUD.s배로 구운 그림: 1텍셀 = 기기 1px)
      const z = this.kit.dev;
      const halo = item.halo.img;
      out.push({
        kind: m.kind,
        id: m.id,
        tx: m.tx,
        ty: m.ty,
        x: item.badge.img.x,
        y: item.badge.img.y,
        dir: item.chev.img.rotation,
        scale: item.badge.img.scaleX * z,
        halo: halo.visible ? { scale: halo.scaleX * z, alpha: halo.alpha } : null,
        chev: { x: item.chev.img.x, y: item.chev.img.y },
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
