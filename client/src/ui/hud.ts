// 판 화면 HUD (M10c, VISUAL_SPEC 8장). 맵과 겹치지 않게 위 · 아래 띠와 왼쪽 여백에 둔다 (DECISIONS D3). 위치는 layout.ts HUD.
//  위 띠: 왼쪽부터 거점 A · B 게이지 · 타이머 틀 · 거점 C 게이지(깎은 육각 막대 · 진행 숫자 % · 점령 중 흐르는 사선 · 정지 주황 + ‖ 칩 ·
//         완료 ✓ 칩 · 꺼짐 회색 + ⊘ 칩, 채움 · 숫자 없음)와 타이머(고정폭 숫자, 1분 미만 = 빨강 + 경고 아이콘, 최후의 30초 = 주황 + 문
//         아이콘). 괴물 화면은 점령 중 게이지가 깜빡이고 진행 숫자가 없다(hudArt.PCT_FOR_MONSTER)
//  왼쪽: 생존자 화면 = 팀 카드(역할 실루엣 + 능력 쿨타임 눈금 링, 역할 이름, '나', 플레이어 이름, 상태 아이콘 + 글자, 체력 칸, 수감 눈금)
//        괴물 화면 = 익명 카드(공통 흰 토큰 + 상태 아이콘 + 글자 + 수감 눈금. 순서 · 역할 · 이름 없음 — 지금 규칙 그대로)
//  아래 띠: 행동 칸(아이콘 타일 + 쿨타임 눈금 링 + 가운데 남은 초 + 이름 + 키캡). 수감 · 관전 · 괴물 대기 중에는 안내 줄
// 그림은 HUD 아틀라스 프레임(hudKit.ts)이라 상태가 바뀌어도 다시 굽지 않는다. 글자는 바뀔 때만 다시 그린다.
// M12 터치 배치(layout.HUD.touch): 그림 HUD.s배 · 글자 CSS 12px 이상. 타이머 · 거점 줄 게이지(글자 + 상태 아이콘 + 진행 숫자 % + 채움 띠) ·
// 팀 카드(실루엣 + 상태 아이콘 + 체력 칸 + 수감 눈금, 이름 · 상태 글자 생략)를 좌우 칸 위쪽(16:9는 타이머만 위 띠)에 두고,
// 행동 칸은 그리지 않는다(터치 버튼). 안내 줄은 맨 아래 가장자리 띠(터치 대상이 없는 곳)에 입력 방식 문구로
// 렌더링 최적화 2: 값은 새 스냅샷(20Hz) · 짧은 안내 · 글꼴 세대 · 배율이 바뀐 프레임에만 다시 계산하고(HudGate), 그 사이 프레임은
// 시간 연출(흐르는 사선 · 깜빡임)만 움직인다. 눈금 링은 같은 값이면 아무것도 하지 않는다
import type { AnonStatus, Balance, MatchInfo, PointView, Snapshot } from '@decoy/shared';
import { gfxNow } from '../gfx/state';
import { HUD_TEXT, ROLE_CARDS, UI_TEXT } from '../data/storyText';
import { NEON, UI, WARN } from '../art/palette';
import {
  ABILITY_ICON,
  ACCENT,
  FR,
  GAUGE_ICON,
  HC,
  STATUS_LOOK,
  STRIPE_P,
  TICKS,
  TIMER_LOOK,
  actionSlots,
  slotIconFrame,
  gaugeShowsProgress,
  gaugeState,
  litTicks,
  pctFrames,
  pctShown,
  pctTone,
  pointOf,
  pointPercent,
  teamCards,
  timerView,
  type Accent,
  type ActionSlot,
  type GaugeState,
  type TimerMode,
} from './hudArt';
import { Digits, fitText, setText, type HudKit, type Slice, type Spr } from './hudKit';
import { fontGeneration } from './fonts';
import { HudGate } from './hudGate';
import { newAnonCells } from '../juice';
import { hitFlashLevel } from '../render/prefsFx';
import {
  GAUGE_IDS,
  HUD,
  RENDER_SCALE,
  TOUCH_PART,
  VIEW_W,
  type GaugeSpot,
  type Rect,
  type TouchHudPlan,
} from './layout';
import type { CrispText } from './text';

/** HUD 깊이: 패널 40 · 그림 41 · 글자 42 */
const D_PANEL = 40;
/** 괴물 화면 익명 칸 펄스 길이 (ms, 수감 · 구조 완료 때 새로 생긴 칸만). 번쩍임 줄이기면 0.35배 · 60ms 상승 (prefsFx.hitFlashLevel) */
export const ANON_PULSE_MS = 300;
const D_ART = 41;
const D_TEXT = 42;
/** 점령 중 사선 흐름 속도 (논리 px / 초) */
const STRIPE_SPEED = 26;
/** 행동 칸 없음 (수감 · 관전 · 대기 안내 중, 터치) */
const NO_SLOTS: readonly ActionSlot[] = [];

/** 쿨타임 눈금 링: 꺼진 링 위에 켜진 눈금, 또는 다 켜진 링 한 장 */
class Ring {
  private readonly base: Spr;
  private readonly ticks: Spr[] = [];
  /** 부품 이름 (나중에 만드는 눈금에도) */
  private readonly tag: string;
  /** 마지막 set 값 (같으면 아무것도 하지 않는다). show가 부르면 지운다 — 그 뒤 같은 값의 set도 다시 그린다 */
  private last: { accent: Accent; lit: number; x: number; y: number } | null = null;
  /** 지금 알파 (나중에 만드는 눈금에도) */
  private alpha = 1;

  constructor(private readonly kit: HudKit) {
    this.base = kit.spr(D_ART);
    this.tag = kit.tag;
  }

  /** lit = 켜진 눈금 수 (TICKS면 다 켜진 링, −1이면 숨김) */
  set(accent: Accent, lit: number, x: number, y: number): void {
    const m = this.last;
    if (m && m.accent === accent && m.lit === lit && m.x === x && m.y === y) return;
    if (m) {
      m.accent = accent;
      m.lit = lit;
      m.x = x;
      m.y = y;
    } else this.last = { accent, lit, x, y };
    if (lit < 0) {
      this.base.show(false);
      for (const t of this.ticks) t.show(false);
      return;
    }
    const full = lit >= TICKS;
    this.base.set(FR.ring(full ? accent : 'off'), x, y).show(true);
    for (let i = 0; i < TICKS; i += 1) {
      const on = !full && i < lit;
      let t = this.ticks[i];
      if (!on) {
        t?.show(false);
        continue;
      }
      if (!t) {
        t = this.kit.named(this.tag, () => this.kit.spr(D_ART + 0.5));
        t.img.setAlpha(this.alpha);
        this.ticks[i] = t;
      }
      t.set(FR.tick(accent, i), x, y).show(true);
    }
  }

  show(on: boolean): void {
    this.last = null;
    this.base.show(on);
    if (!on) for (const t of this.ticks) t.show(false);
  }

  setAlpha(a: number): void {
    if (a === this.alpha) return;
    this.alpha = a;
    this.base.img.setAlpha(a);
    for (const t of this.ticks) t.img.setAlpha(a);
  }
}

/**
 * 거점 진행 숫자 (플레이테스트 a-7): 아틀라스에 구워 둔 숫자 그림 두 장(십의 자리 · 일의 자리 + %)의 프레임만 바꾼다 — 판 중에
 * 글자를 그리거나 텍스처를 올리지 않는다(일의 양 예산). 값은 스냅샷 거점 한 칸에서만 나온다 (hudArt.pointPercent)
 */
class Pct {
  private readonly tens: Spr;
  private readonly ones: Spr;
  /** 지금 보이는 숫자 (숫자를 보이지 않는 화면이면 null) */
  value: number | null = null;

  constructor(
    kit: HudKit,
    /** 이 화면에 숫자를 보이는가 (hudArt.pctShown — 괴물 화면 스위치) */
    private readonly on: boolean,
  ) {
    this.tens = kit.spr(D_ART + 0.4);
    this.ones = kit.spr(D_ART + 0.4);
  }

  /** 기준점 (x, y): PC = 숫자 칸 오른쪽 끝 · 세로 가운데, 터치 = 줄 왼쪽 위. 꺼진 거점은 숫자를 숨긴다 (gaugeShowsProgress) */
  set(p: PointView, s: GaugeState, x: number, y: number): void {
    if (!this.on) return;
    if (!gaugeShowsProgress(s)) {
      this.value = null;
      this.tens.show(false);
      this.ones.show(false);
      return;
    }
    const n = pointPercent(p);
    const f = pctFrames(n, pctTone(s, n));
    this.value = n;
    this.tens.set(f[0], x, y);
    this.ones.set(f[1], x, y);
  }

  setAlpha(a: number): void {
    this.tens.img.setAlpha(a);
    this.ones.img.setAlpha(a);
  }

  /** 일의 자리 그림에 실제로 건 프레임 (디버그 — 색이 이름에 들어 있다. 보이지 않으면 '') */
  get frame(): string {
    return this.ones.shown ? this.ones.frameName : '';
  }
}

/**
 * PC 거점 게이지: ◇ 배지 + 상태 칩 + 진행 숫자 + 육각 막대 (자리 = layout.HUD.gauges — side 1 = 배지가 왼쪽(A · B), −1 = 오른쪽(C),
 * 채움은 배지 쪽에서). 진행 숫자를 보이지 않는 화면(괴물)은 막대를 칩 옆으로 당겨 빈 칸이 게이지 안쪽 끝(타이머 쪽)에 남는다
 */
class Gauge {
  /** 막대 틀 (가로 3조각 — 폭 HUD.gauge.barW) */
  private readonly frame: Slice;
  private readonly dia: Spr;
  readonly chip: Spr;
  private readonly fill: Spr;
  private readonly stripe: Spr;
  private readonly letter: CrispText;
  readonly pct: Pct;
  private readonly bar: { x: number; y: number };
  private readonly diaX: number;
  private readonly chipX: number;
  /** 숫자 칸 오른쪽 끝 (두 게이지 모두 칸 안 오른쪽 맞춤 — 숫자가 바뀌어도 '%' 자리가 그대로다) */
  private readonly pctX: number;
  private readonly side: 1 | -1;
  /** 세로 가운데 y */
  private readonly y: number;
  /** 거점 id */
  readonly id: string;
  state: GaugeState = 'idle';

  constructor(
    private readonly kit: HudKit,
    /** 자리 · 거점 id (스냅샷 world.points에서 이 id로 값을 찾는다 — hudArt.pointOf) */
    o: GaugeSpot,
    showPct: boolean,
  ) {
    const G = HUD.gauge;
    const side = o.side;
    this.id = o.id;
    this.side = side;
    this.y = o.y;
    this.diaX = o.x + side * (G.dia / 2);
    this.chipX = o.x + side * (G.dia + G.gap + G.chip / 2);
    // 칩 다음에 숫자 칸, 그다음 막대 (배지 쪽에서 안쪽으로). 숫자를 보이지 않으면 숫자 칸 없이 막대
    const cell = G.dia + G.gap + G.chip + G.pctGap;
    this.pctX = side === 1 ? o.x + cell + G.pctW : o.x - cell;
    const inner = o.x + side * (cell + (showPct ? G.pctW + G.pctGap : 0));
    this.bar = { x: side === 1 ? inner : inner - G.barW, y: o.y - G.barH / 2 };
    this.frame = kit.slice(D_PANEL);
    this.fill = kit.spr(D_ART);
    this.stripe = kit.spr(D_ART + 0.2);
    this.dia = kit.spr(D_ART);
    this.chip = kit.spr(D_ART);
    this.pct = new Pct(kit, showPct);
    this.letter = kit
      .text(this.diaX, o.y, HUD.font.gaugeLetter, UI.text, D_TEXT, true)
      .setOrigin(0.5, 0.5)
      .setText(o.id);
  }

  /** 사선 구간 (점령 중 · 보일 때, 논리 px). null = 사선 없음. 스냅샷마다 update가 정하고 animate가 매 프레임 흘린다 */
  private stripeAt: { x: number; y: number; a: number; b: number } | null = null;
  /** 괴물 화면 · 점령 중이라 깜빡이는가 (update가 정한다) */
  private blinkable = false;
  private alpha = -1;

  /** 스냅샷 값: 상태 · 채움 · 사선 구간 (새 스냅샷 · 글꼴 · 배율이 바뀐 프레임에만) */
  update(p: PointView | undefined, blinkable: boolean): void {
    if (!p) return;
    const G = HUD.gauge;
    const s = gaugeState(p.state);
    this.state = s;
    this.blinkable = blinkable;
    const y = this.y;
    this.frame.set(`gbar:${s}`, this.bar.x, this.bar.y, G.barW, G.barH);
    this.dia.set(`dia:${s}`, this.diaX, y);
    this.chip.set(GAUGE_ICON[s] ? `chip:${s}` : '', this.chipX, y);
    this.pct.set(p, s, this.pctX, y);
    // 채움: 안쪽 3px, 배지 쪽에서 진행만큼 (꺼진 거점은 채움 없이 회색 틀)
    const fw = G.barW - 6;
    const fx = this.bar.x + 3;
    const fy = this.bar.y + 3;
    const prog = gaugeShowsProgress(s) ? Math.max(0, Math.min(1, p.progress)) : 0;
    const a = this.side === 1 ? 0 : fw * (1 - prog);
    const b = this.side === 1 ? fw * prog : fw;
    if (prog > 0) this.fill.set(s === 'paused' ? 'gfill:warn' : 'gfill:neon', fx, fy).crop(a, b);
    else this.fill.show(false);
    // 점령 중: 끝 뾰족한 곳을 뺀 직사각 부분에만 흐르는 사선 (기기 픽셀 단위로 흘러 선명하다)
    const tip = (G.barH - 6) / 2;
    const sa = Math.max(a, tip);
    const sb = Math.min(b, fw - tip);
    this.stripeAt = s === 'capturing' && sb > sa ? { x: fx, y: fy, a: sa, b: sb } : null;
  }

  /** 매 프레임: 흐르는 사선 · 깜빡임 (시간만의 함수) */
  animate(blinkOff: boolean): void {
    const st = this.stripeAt;
    if (st) {
      const z = this.kit.zoom;
      const period = Math.round(STRIPE_P * z);
      const n = Math.floor((gfxNow() / 1000) * STRIPE_SPEED * z) % period;
      this.stripe.set('gstripe', st.x, st.y).crop(st.a, st.b, this.side === 1 ? period - n : n);
    } else {
      this.stripe.show(false);
    }
    const alpha = this.blinkable && blinkOff ? 0.3 : 1;
    if (alpha === this.alpha) return;
    this.alpha = alpha;
    this.frame.setAlpha(alpha);
    this.fill.img.setAlpha(alpha);
    this.stripe.img.setAlpha(alpha);
    this.dia.img.setAlpha(alpha);
    this.chip.img.setAlpha(alpha);
    this.letter.setAlpha(alpha);
    this.pct.setAlpha(alpha);
  }
}

/**
 * 터치 거점 줄 게이지 한 줄 (플레이테스트 a-7 — 예전 링 게이지 한 쌍과 같은 사각형을 줄 수만큼 나눈다): 판(틀 색 테두리 —
 * gaugeFrameColor, 상태색이 아니다) 위에 거점 글자 · 상태 아이콘(상태색 gaugeColor — 점령 중 ▶ · 정지 ‖ · 완료 ✓ · 꺼짐 ⊘, 대기는
 * 없음) · 진행 숫자, 판 왼쪽부터 진행만큼 어두운 채움 + 아래 밝은 띠.
 * 정지는 주황, 괴물 화면은 점령 중 깜빡인다. 그림은 모두 아틀라스 프레임이고 줄 왼쪽 위 한 점이 기준이다(같은 기기 픽셀에
 * 놓인다). 줄 간격은 기기 픽셀 정수로 맞춰 줄마다 같은 그림이 나오고 맞닿은 줄끼리 그림이 겹치지 않는다
 */
class RowGauge {
  private readonly plate: Spr;
  private readonly fill: Spr;
  private readonly letter: Spr;
  readonly chip: Spr;
  readonly pct: Pct;
  state: GaugeState = 'idle';

  constructor(
    private readonly kit: HudKit,
    /** 거점 id (스냅샷 world.points에서 이 id로 값을 찾는다 — hudArt.pointOf) */
    readonly id: string,
    /** 줄 차례 (GAUGE_IDS 차례 = rows 차례) */
    private readonly index: number,
    /** 모든 줄의 사각형 (논리 px, TouchHudPlan.gauges — 세로로 쌓였거나 위 띠에 가로로 늘어놓았다) */
    private readonly rows: readonly Rect[],
    showPct: boolean,
  ) {
    this.plate = kit.spr(D_PANEL);
    this.fill = kit.spr(D_ART);
    this.letter = kit.spr(D_ART + 0.2);
    this.chip = kit.spr(D_ART + 0.2);
    this.pct = new Pct(kit, showPct);
  }

  /** 괴물 화면 · 점령 중이라 깜빡이는가 (update가 정한다) */
  private blinkable = false;
  private alpha = -1;

  /** 스냅샷 값 (새 스냅샷 · 글꼴 · 배율이 바뀐 프레임에만) */
  update(p: PointView | undefined, blinkable: boolean): void {
    if (!p) return;
    const s = gaugeState(p.state);
    this.state = s;
    this.blinkable = blinkable;
    const rows = this.rows;
    const r = rows[this.index];
    if (!r) return;
    // 줄 위치: 세로로 맞닿아 쌓인 줄은 그 덩어리 맨 윗줄 위 끝과 줄 간격을 기기 픽셀 정수로 — 줄마다 같은 그림, 맞닿은 줄끼리 그림이
    // 겹치지 않는다 (배율이 바뀌면 이 함수가 다시 불린다 — HudGate). 가로로 늘어놓은 줄은 제자리
    const z = this.kit.dev;
    let k = 0;
    for (let i = this.index; i > 0; i -= 1) {
      const u = rows[i - 1];
      const v = rows[i];
      if (!u || !v || Math.abs(u.x - v.x) > 1e-6 || Math.abs(u.y + u.h - v.y) > 1e-6) break;
      k += 1;
    }
    const top = rows[this.index - k] ?? r;
    const x = r.x;
    const y = (Math.round(top.y * z) + k * Math.round(r.h * z)) / z;
    this.plate.set(`grow:${s}`, x, y);
    // 진행은 상태와 따로 보인다 (PC 막대와 같이: 아무도 없어 멈춘 진행도 남아 보인다). 꺼진 거점은 채움 · 숫자 없이 회색 판 + ⊘
    const prog = !gaugeShowsProgress(s) ? 0 : s === 'done' ? 1 : Math.max(0, Math.min(1, p.progress));
    if (prog > 0) this.fill.set(s === 'paused' ? 'growfill:warn' : 'growfill:neon', x, y).crop(0, r.w * prog);
    else this.fill.show(false);
    this.letter.set(`gltr:${this.id}`, x, y);
    this.chip.set(GAUGE_ICON[s] ? `gicon:${s}` : '', x, y);
    this.pct.set(p, s, x, y);
  }

  /** 매 프레임: 깜빡임 */
  animate(blinkOff: boolean): void {
    const alpha = this.blinkable && blinkOff ? 0.3 : 1;
    if (alpha === this.alpha) return;
    this.alpha = alpha;
    this.plate.img.setAlpha(alpha);
    this.fill.img.setAlpha(alpha);
    this.letter.img.setAlpha(alpha);
    this.chip.img.setAlpha(alpha);
    this.pct.setAlpha(alpha);
  }
}

/** 거점 게이지 하나 (PC 막대 · 터치 줄): 디버그 · 시험이 읽는 값 */
export interface GaugePart {
  readonly id: string;
  /** 지금 상태 (스냅샷 거점 상태 — blocked = paused) */
  readonly state: GaugeState;
  /** 상태 칩 · 아이콘 그림 */
  readonly chip: Spr;
  /** 진행 숫자 */
  readonly pct: { readonly value: number | null; readonly frame: string };
  /** 스냅샷 값 (새 스냅샷 · 글꼴 · 배율이 바뀐 프레임에만) */
  update(p: PointView | undefined, blinkable: boolean): void;
  /** 매 프레임: 흐르는 사선 · 깜빡임 */
  animate(blinkOff: boolean): void;
}

/**
 * 거점 게이지를 만든다: 자리 차례는 GAUGE_IDS(거점 수만큼), 값은 스냅샷 world.points에서 id로 찾는다(Hud.drawTop). 터치는 줄 게이지
 * (plan.gauges — 세로로 쌓거나 위 띠에 가로로), PC는 위 띠 A · B · 타이머 · C(layout.HUD.gauges). 진행 숫자는 생존자 화면만(pctShown) —
 * 괴물 화면은 받는 값과 무관하게 숫자 그림을 걸지 않는다
 */
export function makeGauges(kit: HudKit, isMonster: boolean, plan: TouchHudPlan | null): GaugePart[] {
  const showPct = pctShown(isMonster);
  if (plan)
    return plan.gauges.map((_, i) => {
      const id = GAUGE_IDS[i] ?? String(i);
      return kit.named(`gauge${id}`, () => new RowGauge(kit, id, i, plan.gauges, showPct));
    });
  return HUD.gauges.map((o) => kit.named(`gauge${o.id}`, () => new Gauge(kit, o, showPct)));
}

interface CardParts {
  panel: Slice;
  well: Spr;
  sil: Spr;
  ring: Ring;
  name: CrispText;
  tag: Slice;
  tagText: CrispText;
  sub: CrispText;
  stIcon: Spr;
  stText: CrispText;
  hp: Spr[];
  hr: Slice;
  abIcon: Spr;
  abText: CrispText;
  jailText: CrispText;
  jail: Spr[];
  /** 익명 칸 펄스 (괴물 화면, 카드 위 흰 테두리) */
  pulse: Slice;
}

export class Hud {
  private readonly isMonster: boolean;
  /** 터치 배치의 자리 (PC는 null) */
  private readonly plan: TouchHudPlan | null;
  private readonly gauges: GaugePart[];
  private readonly timerFrame: Slice;
  private readonly timerIcon: Spr;
  private readonly timerLabel: CrispText;
  private readonly digits: Digits;
  private timerMode: TimerMode = 'normal';
  private readonly cards: CardParts[] = [];
  private readonly slots: {
    tile: Slice;
    ring: Ring;
    icon: Spr;
    secs: CrispText;
    label: CrispText;
    keycap: Slice;
    key: CrispText;
  }[] = [];
  private slotState: readonly ActionSlot[] = [];
  private readonly hint: { panel: Slice; icon: Spr; text: CrispText };
  private hintText = '';
  /** 지금 스냅샷의 행동 칸 (안내 줄과 무관하게 계산, 터치 버튼이 같이 쓴다). 다시 계산한 프레임에만 새 배열 — 같은 배열이면 같은 값 */
  lastSlots: ActionSlot[] = [];
  private toast: { text: string; until: number } | null = null;
  /** 다시 계산할 프레임인가 (스냅샷 · 짧은 안내 · 글꼴 세대 · 아틀라스 · 백버퍼 배율) */
  private readonly gate = new HudGate();
  /** 괴물 화면 익명 칸 펄스: 지난 목록(제자리 그릇) · 다음 목록에서 새 칸을 고를 시각 · 칸마다 펄스 시작 · 펄스 중 */
  private readonly anonPrev: AnonStatus[] = [];
  private pulseWanted: number | null = null;
  private readonly pulseAt = [-1e9, -1e9, -1e9];
  private pulsing = false;
  /** 펄스한 칸 수 (디버그 누계) */
  private pulses = 0;
  /** 번쩍임 줄이기 (판 장면이 설정을 따라 바꾼다) */
  reduceFlash = false;

  constructor(
    private readonly kit: HudKit,
    private readonly info: MatchInfo,
    private readonly balance: Balance,
    /** 터치 모드: 아래 띠 행동 칸(키캡)은 그리지 않는다 — 터치 버튼이 같은 상태를 보인다 (M11). 문구는 터치 문구 (M12) */
    private readonly touchMode = false,
  ) {
    this.isMonster = info.role === 'monster';
    const t = HUD.touch;
    this.plan = t ? (this.isMonster ? t.monster : t.survivor) : null;
    const plan = this.plan;
    const F = HUD.font;
    this.gauges = makeGauges(kit, this.isMonster, plan);
    [this.timerFrame, this.timerIcon, this.timerLabel, this.digits] = kit.named('timer', () => [
      kit.slice(D_PANEL),
      kit.spr(D_ART),
      kit.text(0, HUD.timer.y, F.timerLabel, WARN, D_TEXT, true).setOrigin(0, 0.5),
      new Digits(kit, F.timer, D_TEXT),
    ]);
    const c = HUD.leftCards;
    for (let i = 0; i < 3; i += 1) {
      this.cards.push(
        kit.named(`card${i}`, () => ({
          panel: kit.slice(D_PANEL),
          well: kit.spr(D_ART),
          sil: kit.spr(D_ART + 0.2),
          ring: new Ring(kit),
          name: kit.text(c.x + 68, 0, F.cardName, UI.text, D_TEXT, true),
          tag: kit.slice(D_ART),
          tagText: kit.text(0, 0, F.small, UI.background, D_TEXT, true).setOrigin(0.5, 0.5),
          sub: kit.text(c.x + 68, 0, F.small, UI.text, D_TEXT),
          stIcon: kit.spr(D_ART),
          stText: kit.text(c.x + 86, 0, F.small, UI.text, D_TEXT, true),
          hp: [kit.spr(D_ART), kit.spr(D_ART)],
          hr: kit.slice(D_ART),
          abIcon: kit.spr(D_ART),
          abText: kit.text(c.x + 30, 0, F.small, UI.textDim, D_TEXT),
          jailText: kit.text(0, 0, F.small, UI.textDim, D_TEXT).setOrigin(this.isMonster ? 0 : 1, 0),
          jail: [kit.spr(D_ART), kit.spr(D_ART)],
          pulse: kit.slice(D_PANEL + 0.5),
        })),
      );
    }
    // 터치는 행동 칸을 그리지 않는다 (터치 버튼이 같은 상태를 보인다)
    if (!touchMode)
      kit.named('slot', () => {
        for (let i = 0; i < 4; i += 1)
          this.slots.push({
            tile: kit.slice(D_PANEL),
            ring: new Ring(kit),
            icon: kit.spr(D_ART + 0.2),
            secs: kit.text(0, 0, F.slotSecs, UI.white, D_TEXT + 0.5, true).setOrigin(0.5, 0.5),
            label: kit.text(0, 0, F.slotLabel, UI.text, D_TEXT, true),
            keycap: kit.slice(D_ART),
            key: kit.text(0, 0, F.small, UI.text, D_TEXT, true).setOrigin(0.5, 0.5),
          });
      });
    this.hint = kit.named('hint', () => ({
      panel: kit.slice(D_PANEL),
      icon: kit.spr(D_ART),
      text: kit.text(0, HUD.bottom.y, F.hint, UI.text, D_TEXT, true).setOrigin(0, 0.5),
    }));
  }

  /** 괴물 화면: 다음에 그리는 익명 목록에서 새로 생긴 칸을 펄스한다 (수감 · 구조 완료 이벤트를 받은 스냅샷) */
  pulseAnon(nowMs: number): void {
    if (this.isMonster) this.pulseWanted = nowMs;
  }

  /** 짧은 안내 (예: 밀치기 범위 밖): 능력 칸 이름 자리에 잠깐 */
  flash(text: string, ms: number, nowMs: number): void {
    this.toast = { text, until: nowMs + ms };
  }

  /**
   * 매 프레임. HUD 값은 스냅샷(20Hz) · 짧은 안내 · 글꼴 세대 · 백버퍼 배율로만 정해지므로 그중 하나가 바뀐 프레임에만 다시
   * 계산한다(hudGate.ts HudGate). 시간 연출(흐르는 사선 · 괴물 화면 깜빡임)은 매 프레임 (렌더링 최적화 2)
   */
  update(snap: Snapshot, nowMs: number): void {
    const toast = this.toast && nowMs < this.toast.until ? this.toast.text : '';
    if (this.gate.fresh(snap, toast, fontGeneration(), this.kit.key, RENDER_SCALE)) {
      this.drawTop(snap);
      if (this.isMonster) {
        const list = snap.world.statusList ?? [];
        this.drawAnon(list);
        this.notePulse(list);
      } else this.drawTeam(snap);
      const hint = this.persistentHint(snap);
      this.drawHint(hint);
      this.lastSlots = actionSlots(snap, this.balance, snap.you.role);
      const slots = hint ? NO_SLOTS : this.lastSlots;
      this.drawSlots(this.touchMode ? NO_SLOTS : slots, toast);
      this.slotState = slots;
    }
    const blinkOff = Math.floor(nowMs / 500) % 2 === 1;
    for (const g of this.gauges) g.animate(blinkOff);
    if (this.pulsing) this.animatePulse(nowMs);
  }

  /** 익명 칸 펄스: 카드 자리에 흰 테두리를 알파로 한 번 (자리는 카드 그대로 — 칸이 옮겨 가는 것은 그리지 않는다) */
  private animatePulse(nowMs: number): void {
    let any = false;
    this.cards.forEach((p, i) => {
      const k = hitFlashLevel(nowMs - (this.pulseAt[i] ?? -1e9), ANON_PULSE_MS, this.reduceFlash);
      if (k <= 0 || !p.panel.shown) {
        p.pulse.show(false);
        return;
      }
      any = true;
      const b = p.panel.bounds;
      p.pulse.set('card:pulse', b.x, b.y, b.w, b.h).setAlpha(Math.round(k * 50) / 50);
    });
    this.pulsing = any;
  }

  /** 익명 목록을 그린 뒤: 펄스를 기다리면 새 칸을 고르고, 지난 목록 그릇을 제자리에서 고친다 */
  private notePulse(list: readonly AnonStatus[]): void {
    if (this.pulseWanted !== null) {
      for (const i of newAnonCells(this.anonPrev, list))
        if (i < this.pulseAt.length) {
          this.pulseAt[i] = this.pulseWanted;
          this.pulses += 1;
        }
      this.pulseWanted = null;
      this.pulsing = true;
    }
    const prev = this.anonPrev;
    list.forEach((a, i) => {
      const q = prev[i];
      if (q) {
        q.state = a.state;
        q.imprisonCount = a.imprisonCount;
      } else prev.push({ state: a.state, imprisonCount: a.imprisonCount });
    });
    prev.length = list.length;
  }

  private persistentHint(snap: Snapshot): { text: string; icon: string } | null {
    const st = snap.you.surv?.status;
    // 관전 안내는 확대 화면(따라가는 카메라)에서만: 확대 1이면 맵 전체가 보여 옮겨 볼 것이 없다
    const watch = this.watchable;
    if (st === 'imprisoned') {
      if (watch && this.watching !== null)
        return {
          text: this.touchMode ? HUD_TEXT.watchingMateTouch : HUD_TEXT.watchingMate,
          icon: FR.icon('eye', UI.textDim, 20),
        };
      const text = watch
        ? this.touchMode
          ? HUD_TEXT.imprisonedWatchHintTouch
          : HUD_TEXT.imprisonedWatchHint
        : this.touchMode
          ? HUD_TEXT.imprisonedHintTouch
          : HUD_TEXT.imprisonedHint;
      return { text, icon: FR.icon('prison', HC.red, 20) };
    }
    if (st === 'dead' || st === 'escaped')
      return {
        text: !watch
          ? HUD_TEXT.spectatingPlain
          : this.touchMode
            ? HUD_TEXT.spectatingTouch
            : HUD_TEXT.spectating,
        icon: FR.icon('eye', UI.textDim, 20),
      };
    // 판 시작 카운트다운 동안에는 띄우지 않는다: 괴물 대기 5초는 "시작!" 뒤부터 센다 (멈춘 5초 숫자가 고장처럼 보이지 않게)
    if (this.isMonster && snap.world.monsterWait > 0 && !(snap.world.countdown > 0))
      return {
        text: `${UI_TEXT.monsterWait} ${Math.ceil(snap.world.monsterWait)}초`,
        icon: FR.icon('timer', WARN, 20),
      };
    return null;
  }

  private drawTop(snap: Snapshot): void {
    const w = snap.world;
    for (const g of this.gauges) {
      const p = pointOf(w.points, g.id);
      g.update(p, this.isMonster && p?.state === 'capturing');
    }
    // 타이머: [아이콘] [최후] 0:00 — 가운데 정렬. 터치는 자리가 모자라면 '최후' 글자 없이 (색 + 문 아이콘)
    const T = this.plan?.timer ?? HUD.timer;
    const k = HUD.s;
    const v = timerView(w);
    this.timerMode = v.mode;
    const look = TIMER_LOOK[v.mode];
    const frameH = HUD.timer.h * k;
    this.timerFrame.set(`timer:${v.mode}`, T.x - T.w / 2, T.y - frameH / 2, T.w, frameH);
    const label = v.mode === 'grace' && (this.plan?.timer.label ?? true);
    setText(this.timerLabel, label ? HUD_TEXT.last30 : '');
    this.timerLabel.setVisible(label);
    const labelW = label ? this.timerLabel.width + 6 * k : 0;
    const icon = (this.plan ? TOUCH_PART.timer.icon : 20) * k;
    const gap = (this.plan ? TOUCH_PART.timer.gap : 7) * k;
    const total = icon + gap + labelW + this.digits.measure(v.text);
    const x0 = T.x - total / 2;
    this.timerIcon.set(FR.icon(look.icon, look.color, 20), x0 + icon / 2, T.y);
    if (label) this.timerLabel.setPosition(x0 + icon + gap, T.y);
    this.digits.set(v.text, x0 + icon + gap + labelW, T.y, look.text);
  }

  /** 팀 카드 id (카드 순서, 생존자 화면에서 drawTeam이 채운다. 괴물 화면 · 빈 칸은 null) */
  readonly cardIds: (string | null)[] = [null, null, null];
  /** 관전 중인 동료 (그 카드를 청록 테두리 · '보는 중'으로) */
  private watching: string | null = null;
  /** 관전 할 수 있는 상태 (안내 줄 문구) */
  private watchable = false;

  /** 관전 중인 동료 · 관전할 수 있는가를 알린다 (바뀌면 다음 프레임에 다시 그린다) */
  setWatching(id: string | null, canSpectate: boolean): void {
    if (id === this.watching && canSpectate === this.watchable) return;
    this.watching = id;
    this.watchable = canSpectate;
    this.gate.reset();
  }

  /** 팀 카드 i의 사각형 (논리 px, 그린 자리와 같다): 관전 카드 고르기 판정. 그리지 않는 칸 · 괴물 화면이면 null */
  cardRect(i: number): { x: number; y: number; w: number; h: number } | null {
    if (this.isMonster || (this.cardIds[i] ?? null) === null) return null;
    if (this.plan) {
      const C = this.plan.cards;
      return {
        x: C.x + (i % C.cols) * (C.w + C.gap),
        y: C.y + Math.floor(i / C.cols) * (C.h + C.gap),
        w: C.w,
        h: C.h,
      };
    }
    const c = HUD.leftCards;
    return { x: c.x, y: c.y + i * (c.h + c.gap), w: c.w, h: c.h };
  }

  /** 카드 사이 간격 (논리 px): 판정 사각형을 반씩 넓혀 칸 사이 빈틈이 없게 */
  get cardGap(): number {
    return this.plan ? this.plan.cards.gap : HUD.leftCards.gap;
  }

  private drawTeam(snap: Snapshot): void {
    const list = teamCards(snap, this.info.roster, this.balance);
    for (let i = 0; i < 3; i += 1) this.cardIds[i] = list[i]?.id ?? null;
    if (this.plan) {
      this.cards.forEach((p, i) => this.drawTouchCard(p, i, list[i] ?? null, null));
      return;
    }
    const c = HUD.leftCards;
    const maxJail = this.balance.survivor.maxImprisonments;
    this.cards.forEach((p, i) => {
      const s = list[i];
      if (!s) {
        this.hideCard(p);
        return;
      }
      const x = c.x;
      const y = c.y + i * (c.h + c.gap);
      const alive = s.status === 'normal' || s.status === 'injured' || s.status === 'imprisoned';
      const watched = !s.me && s.id === this.watching;
      p.panel.set(s.me ? `card:${s.role}` : watched ? 'card:watch' : 'card', x, y, c.w, c.h);
      const dx = x + 34;
      const dy = y + 44;
      p.well.set('well', dx, dy);
      p.sil.set(FR.sil(s.role, alive), dx, dy);
      // 능력 쿨타임 링: 자유 상태에서만 채운다 (수감 · 사망 · 탈출이면 꺼진 링)
      const total = this.balance.roles[s.role].cooldown;
      const free = s.status === 'normal' || s.status === 'injured';
      p.ring.set(s.role, !free ? 0 : s.cd > 0 ? litTicks(1 - s.cd / total) : TICKS, dx, dy);
      setText(p.name, ROLE_CARDS[s.role].name, ACCENT[s.role].text);
      p.name.setPosition(x + 68, y + 11);
      if (s.me || watched) {
        setText(p.tagText, s.me ? HUD_TEXT.me : HUD_TEXT.watchTag);
        const tw = Math.ceil(p.tagText.width) + 12;
        p.tag.set('tag', x + c.w - 10 - tw, y + 12, tw, 20);
        p.tagText.setPosition(x + c.w - 10 - tw / 2, y + 22).setVisible(true);
      } else {
        p.tag.show(false);
        p.tagText.setVisible(false);
      }
      // 플레이어 이름 · 상태 (연결이 끊긴 팀원은 끊김 아이콘 + 글자)
      fitText(p.sub, s.name, c.w - 68 - 10);
      p.sub.setPosition(x + 68, y + 35).setVisible(true);
      const look = STATUS_LOOK[s.status];
      const off = !s.connected;
      p.stIcon.set(
        off ? FR.icon('disconnected', UI.textDim, 16) : FR.icon(look.icon, look.color, 16),
        x + 76,
        y + 70,
      );
      setText(
        p.stText,
        `${HUD_TEXT.status[s.status]}${off ? ` · ${HUD_TEXT.offline}` : ''}`,
        off ? UI.textDim : look.color,
      );
      p.stText.setPosition(x + 88, y + 60).setVisible(true);
      // 체력 칸 (연결이 끊긴 팀원은 상태 글자가 길어 숨긴다. 부상 여부는 상태 글자에 있다)
      const maxHp = this.balance.survivor.maxHp;
      p.hp.forEach((h, k) => {
        if (off || k >= maxHp) h.show(false);
        else h.set(k < s.hp ? `hp:${s.role}` : 'hp:off', x + c.w - 22 - (maxHp - 1 - k) * 20, y + 70);
      });
      p.hr.set('hr', x + 10, y + 89, c.w - 20, 2);
      // 아래 줄: 능력 준비 / 남은 초 · 수감 눈금
      const ready = free && s.cd <= 0;
      p.abIcon.set(FR.icon(ABILITY_ICON[s.role], ready ? ACCENT[s.role].text : HC.off, 16), x + 22, y + 107);
      setText(
        p.abText,
        `능력 ${s.cd > 0 ? `${Math.ceil(s.cd)}초` : '준비'}`,
        ready ? ACCENT[s.role].text : UI.textDim,
      );
      p.abText.setPosition(x + 34, y + 97).setVisible(true);
      this.drawJail(p, x, y + 107, s.jail, maxJail);
    });
  }

  /**
   * 터치 팀 카드 (그림 단위 110 × 44): 우물 속 역할 실루엣 · 상태 아이콘(끊김이면 끊김 아이콘) · 체력 칸 2 · 수감 눈금.
   * 이름 · 상태 글자 · 능력 줄은 생략한다(점수판에 있다). 내 카드는 역할색 테두리. 괴물 화면(anon)은 흰 공통 토큰 · 상태 · 수감만
   */
  private drawTouchCard(
    p: CardParts,
    i: number,
    s: ReturnType<typeof teamCards>[number] | null,
    anon: AnonStatus | null,
  ): void {
    const plan = this.plan;
    if (!plan || (!s && !anon)) {
      this.hideCard(p);
      return;
    }
    const C = plan.cards;
    const k = HUD.s;
    const x = C.x + (i % C.cols) * (C.w + C.gap);
    const y = C.y + Math.floor(i / C.cols) * (C.h + C.gap);
    const cy = y + 22 * k;
    const maxJail = this.balance.survivor.maxImprisonments;
    const status = s ? s.status : (anon?.state ?? 'normal');
    const alive = status === 'normal' || status === 'injured' || status === 'imprisoned';
    const watched = s !== null && !s.me && s.id === this.watching;
    p.panel.set(s?.me ? `card:${s.role}` : watched ? 'card:watch' : 'card', x, y, C.w, C.h);
    p.well.set('well', x + 22 * k, cy);
    p.sil.set(FR.sil(s ? s.role : 'hidden', alive), x + 22 * k, cy);
    const look = STATUS_LOOK[status];
    const off = s !== null && !s.connected;
    p.stIcon.set(
      off ? FR.icon('disconnected', UI.textDim, 20) : FR.icon(look.icon, look.color, 20),
      x + 55 * k,
      cy,
    );
    // 체력 칸 (괴물 화면 · 끊긴 팀원은 없음) 위, 수감 눈금 아래. 익명 카드는 수감 눈금만 가운데 줄에
    const maxHp = this.balance.survivor.maxHp;
    p.hp.forEach((h, n) => {
      if (!s || off || n >= maxHp) h.show(false);
      else h.set(n < s.hp ? `hp:${s.role}` : 'hp:off', x + (79 + n * 18) * k, y + 15 * k);
    });
    const jail = s ? s.jail : (anon?.imprisonCount ?? 0);
    const jy = s ? y + 31 * k : cy;
    p.jail.forEach((j, n) =>
      j.set(n < jail ? 'jail:on' : 'jail:off', x + (75 + n * 12) * k, jy).show(n < maxJail),
    );
    p.ring.show(false);
    p.tag.show(false);
    p.hr.show(false);
    // 관전 중인 동료: 우물 왼쪽 위에 눈 아이콘 (색만으로 구분하지 않게 — 테두리 색 + 모양)
    if (watched) p.abIcon.set(FR.icon('eye', NEON, 16), x + 8 * k, y + 8 * k).show(true);
    else p.abIcon.show(false);
    for (const t of [p.name, p.tagText, p.sub, p.stText, p.abText, p.jailText]) t.setVisible(false);
  }

  /** 수감 눈금: 팀 카드는 오른쪽 끝에 맞추고, 익명 카드는 글자 줄(left)에서 시작한다 */
  private drawJail(p: CardParts, x: number, y: number, n: number, max: number, left?: number): void {
    const c = HUD.leftCards;
    setText(p.jailText, `수감 ${n}/${max}`, n > 0 ? HC.red : UI.textDim);
    const cx0 = left !== undefined ? left + Math.ceil(p.jailText.width) + 14 : x + c.w - 18 - (max - 1) * 13;
    p.jail.forEach((j, k) => j.set(k < n ? 'jail:on' : 'jail:off', cx0 + k * 13, y).show(k < max));
    // 원점은 만들 때 정한다 (팀 카드 = 오른쪽 끝 기준, 익명 카드 = 왼쪽)
    p.jailText.setPosition(left ?? cx0 - 12, y - 10).setVisible(true);
  }

  private hideCard(p: CardParts): void {
    p.panel.show(false);
    p.pulse.show(false);
    p.tag.show(false);
    p.hr.show(false);
    p.ring.show(false);
    for (const s of [p.well, p.sil, p.stIcon, p.abIcon, ...p.hp, ...p.jail]) s.show(false);
    for (const t of [p.name, p.tagText, p.sub, p.stText, p.abText, p.jailText]) t.setVisible(false);
  }

  /** 괴물 화면: 익명 상태 목록 (서버가 정렬해 보낸 순서 그대로, 역할 · 이름 · 체력 없음) */
  private drawAnon(list: readonly AnonStatus[]): void {
    if (this.plan) {
      this.cards.forEach((p, i) => this.drawTouchCard(p, i, null, list[i] ?? null));
      return;
    }
    const c = HUD.leftCards;
    const maxJail = this.balance.survivor.maxImprisonments;
    this.cards.forEach((p, i) => {
      const s = list[i];
      if (!s) {
        this.hideCard(p);
        return;
      }
      const x = c.x;
      const y = c.y + i * (c.hAnon + c.gap);
      p.panel.set('card', x, y, c.w, c.hAnon);
      const dx = x + 34;
      const dy = y + 40;
      p.well.set('well', dx, dy);
      p.sil.set(FR.sil('hidden', s.state !== 'dead' && s.state !== 'escaped'), dx, dy);
      p.ring.show(false);
      setText(p.name, `생존자 ${i + 1}`, UI.text);
      p.name.setPosition(x + 68, y + 12);
      p.tag.show(false);
      p.tagText.setVisible(false);
      p.sub.setVisible(false);
      const look = STATUS_LOOK[s.state];
      p.stIcon.set(FR.icon(look.icon, look.color, 16), x + 76, y + 50);
      setText(p.stText, HUD_TEXT.status[s.state], look.color);
      p.stText.setPosition(x + 88, y + 40).setVisible(true);
      for (const h of p.hp) h.show(false);
      p.hr.show(false);
      p.abIcon.show(false);
      p.abText.setVisible(false);
      this.drawJail(p, x, y + 74, s.imprisonCount, maxJail, x + 68);
    });
  }

  /** 보이는 안내 줄 패널 사각형 (논리 px, 없으면 null): 화면 밖 화살표가 그 아래로 숨지 않게 피한다 (넓은 터치 배치는 맵이 화면 높이 가득) */
  get hintRect(): { x: number; y: number; w: number; h: number } | null {
    return this.hintText === '' ? null : this.hint.panel.bounds;
  }

  /** 안내 줄: PC는 아래 띠 가운데(행동 칸 자리), 터치는 맨 아래 가장자리 띠(터치 대상이 없는 곳) */
  private drawHint(h: { text: string; icon: string } | null): void {
    const H = this.hint;
    if (!h) {
      H.panel.show(false);
      H.icon.show(false);
      H.text.setVisible(false);
      this.hintText = '';
      return;
    }
    const k = HUD.s;
    setText(H.text, h.text);
    const w = (18 + 22 + 10) * k + Math.ceil(H.text.width) + 22 * k;
    const x0 = VIEW_W / 2 - w / 2;
    const hh = HUD.hint.h * k;
    H.panel.set('hint', x0, HUD.bottom.y - hh / 2, w, hh);
    H.icon.set(h.icon, x0 + (18 + 11) * k, HUD.bottom.y);
    H.text.setPosition(x0 + (18 + 22 + 10) * k, HUD.bottom.y).setVisible(true);
    this.hintText = h.text;
  }

  /** 행동 칸. toast = 지금 보이는 짧은 안내 ('' = 없음) */
  private drawSlots(list: readonly ActionSlot[], toast: string): void {
    const S = HUD.slot;
    const total = list.length * S.w + Math.max(0, list.length - 1) * S.gap;
    const x0 = VIEW_W / 2 - total / 2;
    const cy = HUD.bottom.y;
    this.slots.forEach((p, i) => {
      const s = list[i];
      if (!s) {
        p.tile.show(false);
        p.keycap.show(false);
        p.ring.show(false);
        p.icon.show(false);
        for (const t of [p.secs, p.label, p.key]) t.setVisible(false);
        return;
      }
      const left = x0 + i * (S.w + S.gap);
      const tx = left + S.tile / 2;
      const on = s.state === 'ready' || s.state === 'active';
      const acc = ACCENT[s.accent];
      p.tile.set(
        s.state === 'active' ? `tile:${s.accent}:a` : s.state === 'ready' ? `tile:${s.accent}` : 'tile:off',
        left,
        cy - S.tile / 2,
        S.tile,
        S.tile,
      );
      const lit = s.state === 'blocked' ? 0 : s.fill >= 1 ? TICKS : litTicks(s.fill);
      p.ring.set(s.accent, lit, tx, cy);
      p.icon.set(slotIconFrame(s), tx, cy);
      const secs = s.state === 'cooldown' ? String(Math.ceil(s.cd)) : '';
      setText(p.secs, secs);
      p.secs.setPosition(tx, cy).setVisible(secs !== '');
      // 이름 (토스트가 있으면 능력 칸 이름 자리에 주황으로) + 키캡
      const showToast = i === 0 && toast !== '';
      setText(p.label, showToast ? toast : s.label, showToast ? WARN : on ? acc.text : UI.textDim);
      p.label.setPosition(left + S.tile + 10, cy - 25).setVisible(true);
      setText(p.key, s.key);
      const kw = Math.max(28, Math.ceil(p.key.width) + 16);
      p.keycap.set('kc', left + S.tile + 10, cy + 1, kw, 24);
      p.key.setPosition(left + S.tile + 10 + kw / 2, cy + 12.5).setVisible(true);
    });
  }

  /** 디버그 · 테스트 값 (hudDebug) */
  debug(): Record<string, number | boolean | string> {
    const points: Record<string, number | string> = {};
    for (const g of this.gauges) {
      const id = g.id;
      points[`point${id}`] = g.state;
      // 상태에서 다시 계산하지 않고 칩에 실제로 건 프레임 (보이지 않으면 '')
      points[`point${id}Chip`] = g.chip.shown ? g.chip.frameName : '';
      // 지금 보이는 진행 숫자 (정수 %, 숫자를 보이지 않는 화면이면 '')
      points[`point${id}Pct`] = g.pct.value ?? '';
      points[`point${id}PctFrame`] = g.pct.frame;
    }
    return {
      ...points,
      anonPulses: this.pulses,
      timer: this.timerMode,
      timerText: this.digits.text,
      timerFontGen: this.digits.measuredGen,
      slots: this.slotState.map((s) => `${s.id}:${s.state}`).join(','),
      hint: this.hintText,
      cardText: this.cards
        .filter((p) => p.panel.shown)
        .map((p) =>
          [p.name, p.tagText, p.sub, p.stText, p.abText, p.jailText]
            .filter((t) => t.visible)
            .map((t) => t.text)
            .join(' '),
        )
        .join(' | '),
    };
  }
}
