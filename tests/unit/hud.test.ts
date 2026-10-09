// HUD (M10c, VISUAL_SPEC 8장): 행동 칸 값(M11 터치 버튼과 공유) · 거점 게이지 · 타이머 · 팀 카드 · 상태 표시(색만으로 구분하지 않기) ·
// 글자 대비 · 9조각 배치 · 아틀라스 목록 · 조작 안내 줄 나누기
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import { createMoveState } from '../../shared/src/movement';
import { RESCUE_POINT } from '../../shared/src/map';
import type { Snapshot, SurvivorView } from '../../shared/src/types';
import { CONTROLS } from '../../client/src/data/storyText';
import { TEXT_PAIRS, UI, WARN, WARN_TEXT, contrastRatio } from '../../client/src/art/palette';
import {
  GAUGE_ICON,
  HUD_TEXT_PAIRS,
  STATUS_LOOK,
  TICKS,
  TIMER_LOOK,
  TONE,
  actionSlots,
  fmtTime,
  gaugeState,
  hudSpecs,
  litTicks,
  packShelves,
  parseControl,
  sliceSpans,
  statusKey,
  teamCards,
  tickAngle,
  slotIconFrame,
  timerView,
  type ActionSlot,
} from '../../client/src/ui/hudArt';
import { HUD, MAP_RECT, VIEW_W } from '../../client/src/ui/layout';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

function snapshot(role: Snapshot['you']['role'], patch: (s: Snapshot) => void = () => {}): Snapshot {
  const s: Snapshot = {
    tick: 0,
    st: 0,
    ack: 0,
    you: {
      id: 'me',
      role,
      move: createMoveState({ x: 10, y: 10 }, 0),
      surv:
        role === 'monster'
          ? null
          : {
              status: 'free',
              hp: 2,
              imprisonCount: 0,
              protectLeft: 0,
              abilityCd: 0,
              abilityActive: 0,
              rescue: 0,
              spotted: false,
            },
      mon:
        role === 'monster'
          ? {
              attackCd: 0,
              windup: 0,
              dashCd: 0,
              roarCd: 0,
              mode: 'search',
              blend: 0,
              camp: 0,
              blockWarn: null,
            }
          : null,
    },
    survivors: [],
    monster: null,
    marks: [],
    world: {
      timeLeft: 600,
      grace: null,
      monsterWait: 0,
      paused: null,
      points: [],
      exits: [],
      imprisoned: 0,
      statusList: null,
    },
    events: [],
  };
  patch(s);
  return s;
}

function mate(id: string, role: SurvivorView['role'], extra: Partial<SurvivorView> = {}): SurvivorView {
  return {
    id,
    x: 0,
    y: 0,
    face: 0,
    role,
    status: 'free',
    protected: false,
    hp: 2,
    imprisonCount: 0,
    abilityCd: 0,
    rescue: 0,
    spotted: false,
    connected: true,
    ...extra,
  };
}

const byId = (list: ActionSlot[], id: ActionSlot['id']): ActionSlot => {
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error(`칸 없음: ${id}`);
  return s;
};

describe('행동 칸 actionSlots (순수 함수, M11 터치 버튼과 공유)', () => {
  it('생존자: 능력(Space) · 구조(E) 두 칸, 지금 문구 그대로', () => {
    const slots = actionSlots(snapshot('runner'), balance, 'runner');
    expect(slots.map((s) => [s.id, s.key, s.label])).toEqual([
      ['ability', 'Space', '질주'],
      ['rescue', 'E', '구조'],
    ]);
    expect(actionSlots(snapshot('guard'), balance, 'guard')[0]?.label).toBe('밀치기');
    expect(actionSlots(snapshot('scout'), balance, 'scout')[0]?.label).toBe('탐지');
    const a = byId(slots, 'ability');
    expect([a.state, a.fill, a.cd, a.accent, a.icon]).toEqual(['ready', 1, 0, 'runner', 'sprint']);
  });

  it('나올 수 있는 모든 행동 칸 아이콘(역할 · 탐색/추적 · 네 상태)이 아틀라스에 구워져 있다', () => {
    const names = new Set(hudSpecs().map((x) => x.name));
    const cases: [Snapshot['you']['role'], Snapshot][] = [
      ['runner', snapshot('runner')],
      ['guard', snapshot('guard')],
      ['scout', snapshot('scout')],
      ['monster', snapshot('monster')],
      [
        'monster',
        snapshot('monster', (x) => {
          if (x.you.mon) x.you.mon.mode = 'hunt';
        }),
      ],
    ];
    const states: ActionSlot['state'][] = ['ready', 'cooldown', 'active', 'blocked'];
    const missing: string[] = [];
    let checked = 0;
    for (const [role, snap] of cases) {
      for (const slot of actionSlots(snap, balance, role)) {
        for (const state of states) {
          const frame = slotIconFrame({ ...slot, state });
          checked += 1;
          if (!names.has(frame)) missing.push(`${role} ${slot.id} ${slot.icon} ${state} → ${frame}`);
        }
      }
    }
    expect(checked).toBe((2 * 3 + 4 * 2) * states.length);
    expect(missing).toEqual([]);
  });

  it('쿨타임 비율 = 지난 시간 / 쿨타임, 남은 초는 그대로', () => {
    const cd = balance.roles.guard.cooldown;
    const s = snapshot('guard', (x) => {
      if (x.you.surv) x.you.surv.abilityCd = cd / 4;
    });
    const a = byId(actionSlots(s, balance, 'guard'), 'ability');
    expect(a.state).toBe('cooldown');
    expect(a.fill).toBeCloseTo(0.75, 9);
    expect(a.cd).toBeCloseTo(cd / 4, 9);
    expect(litTicks(a.fill)).toBe(18);
  });

  it('효과 중 · 사용 불가 조건 (수감 · 사망 · 탈출 · 판 멈춤)', () => {
    const active = snapshot('runner', (x) => {
      if (x.you.surv) {
        x.you.surv.abilityActive = 2;
        x.you.surv.abilityCd = 19;
      }
    });
    expect(byId(actionSlots(active, balance, 'runner'), 'ability').state).toBe('active');
    for (const status of ['imprisoned', 'dead', 'escaped'] as const) {
      const s = snapshot('scout', (x) => {
        if (x.you.surv) x.you.surv.status = status;
      });
      const a = byId(actionSlots(s, balance, 'scout'), 'ability');
      expect([status, a.state, a.fill]).toEqual([status, 'blocked', 0]);
    }
    const paused = snapshot('scout', (x) => {
      x.world.paused = 20;
    });
    expect(actionSlots(paused, balance, 'scout').map((s) => s.state)).toEqual(['blocked', 'blocked']);
  });

  it('구조: 팀원이 수감 중이고 구조 구역 안일 때만 ready, 구조 중이면 진행이 링 채움', () => {
    const inZone = (x: Snapshot): void => {
      x.you.move.x = RESCUE_POINT.x;
      x.you.move.y = RESCUE_POINT.y + balance.prison.rescueRadius * 0.9;
    };
    expect(byId(actionSlots(snapshot('runner', inZone), balance, 'runner'), 'rescue').state).toBe('blocked');
    const jailed = (x: Snapshot): void => {
      inZone(x);
      x.survivors = [mate('g', 'guard', { status: 'imprisoned' })];
    };
    expect(byId(actionSlots(snapshot('runner', jailed), balance, 'runner'), 'rescue').state).toBe('ready');
    const far = snapshot('runner', (x) => {
      jailed(x);
      x.you.move.y = RESCUE_POINT.y + balance.prison.rescueRadius + 0.2;
    });
    expect(byId(actionSlots(far, balance, 'runner'), 'rescue').state).toBe('blocked');
    const doing = snapshot('runner', (x) => {
      jailed(x);
      if (x.you.surv) x.you.surv.rescue = 0.45;
    });
    const r = byId(actionSlots(doing, balance, 'runner'), 'rescue');
    expect([r.state, r.fill, r.label]).toEqual(['active', 0.45, '구조 중 45%']);
  });

  it('괴물: 공격 · 돌진 · 포효 · 시야 모드 네 칸과 키캡', () => {
    const slots = actionSlots(snapshot('monster'), balance, 'monster');
    expect(slots.map((s) => [s.id, s.key, s.label, s.state])).toEqual([
      ['attack', '좌클릭', '공격', 'ready'],
      ['dash', 'Shift', '돌진', 'ready'],
      ['roar', 'Q', '포효', 'ready'],
      ['mode', '우클릭', '탐색', 'ready'],
    ]);
    const s = snapshot('monster', (x) => {
      if (!x.you.mon) return;
      x.you.mon.dashCd = balance.monster.dash.cooldown / 2;
      x.you.mon.roarCd = balance.monster.roar.cooldown;
      x.you.mon.mode = 'hunt';
    });
    const list = actionSlots(s, balance, 'monster');
    expect(byId(list, 'dash').fill).toBeCloseTo(0.5, 9);
    expect(byId(list, 'roar').fill).toBe(0);
    expect(byId(list, 'roar').state).toBe('cooldown');
    expect([byId(list, 'mode').state, byId(list, 'mode').label, byId(list, 'mode').icon]).toEqual([
      'active',
      '추적',
      'visionHunt',
    ]);
  });

  it('괴물 사용 불가: 시작 대기 · 기절 · 돌진 중 · 공격 준비 중 (기절만 시야 전환도 막는다)', () => {
    const cases: [string, (x: Snapshot) => void, string[]][] = [
      ['대기', (x) => void (x.you.move.frozen = 3), ['blocked', 'blocked', 'blocked', 'ready']],
      ['기절', (x) => void (x.you.move.stun = 1), ['blocked', 'blocked', 'blocked', 'blocked']],
      ['돌진', (x) => void (x.you.move.dash = 0.1), ['blocked', 'active', 'blocked', 'ready']],
      [
        '공격 준비',
        (x) => {
          if (x.you.mon) x.you.mon.windup = 0.2;
        },
        ['active', 'blocked', 'blocked', 'ready'],
      ],
    ];
    for (const [name, patch, want] of cases)
      expect([
        name,
        ...actionSlots(snapshot('monster', patch), balance, 'monster').map((s) => s.state),
      ]).toEqual([name, ...want]);
  });
});

describe('거점 게이지 · 타이머 · 상태 표시', () => {
  it('거점 상태: 서버 blocked = 정지, 점령 중 · 정지 · 완료는 서로 다른 칩 아이콘 (색만으로 구분하지 않기)', () => {
    expect(gaugeState('blocked')).toBe('paused');
    expect(gaugeState('capturing')).toBe('capturing');
    const icons = (['capturing', 'paused', 'done'] as const).map((s) => GAUGE_ICON[s]);
    expect(icons).toEqual(['play', 'pause', 'check']);
    expect(GAUGE_ICON.idle).toBeNull();
  });

  it('타이머: 최후의 30초 > 1분 미만 > 보통, 모드마다 아이콘도 다르다', () => {
    expect(fmtTime(720)).toBe('12:00');
    expect(fmtTime(59.2)).toBe('1:00');
    expect(fmtTime(-3)).toBe('0:00');
    expect(timerView({ timeLeft: 300, grace: null })).toEqual({ mode: 'normal', text: '5:00' });
    expect(timerView({ timeLeft: 59.5, grace: null })).toEqual({ mode: 'low', text: '1:00' });
    expect(timerView({ timeLeft: 10, grace: 12.1 })).toEqual({ mode: 'grace', text: '0:13' });
    const icons = new Set(Object.values(TIMER_LOOK).map((l) => l.icon));
    expect(icons.size).toBe(3);
  });

  it('생존자 상태는 아이콘이 모두 다르고, 상태 이름은 지금 문구 그대로', () => {
    expect(statusKey({ status: 'free', hp: 1 }, 2)).toBe('injured');
    expect(statusKey({ status: 'free', hp: 2 }, 2)).toBe('normal');
    expect(statusKey({ status: 'free', hp: null }, 2)).toBe('normal');
    expect(statusKey({ status: 'imprisoned', hp: 2 }, 2)).toBe('imprisoned');
    const icons = Object.values(STATUS_LOOK).map((l) => l.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).not.toContain('disconnected');
  });

  it('팀 카드: 역할 순서(러너 · 가드 · 스카우트), 나 표시, 로스터 이름, 수감 · 사망이면 체력 칸 0', () => {
    const s = snapshot('guard', (x) => {
      x.you.id = 'g';
      x.survivors = [
        mate('s', 'scout', { status: 'dead', hp: 2 }),
        mate('r', 'runner', { hp: 1, imprisonCount: 1, abilityCd: 5, connected: false }),
      ];
    });
    const roster = [
      { id: 'g', name: '가', role: 'guard' as const, bot: false },
      { id: 'r', name: '나나', role: 'runner' as const, bot: false },
      { id: 's', name: '다', role: 'scout' as const, bot: false },
    ];
    const cards = teamCards(s, roster, balance);
    expect(cards.map((c) => [c.role, c.me, c.name, c.status, c.hp, c.jail, c.cd, c.connected])).toEqual([
      ['runner', false, '나나', 'injured', 1, 1, 5, false],
      ['guard', true, '가', 'normal', 2, 0, 0, true],
      ['scout', false, '다', 'dead', 0, 0, 0, true],
    ]);
  });

  it('눈금 링: 12시에서 시계 방향, 채움 → 켜진 눈금 수', () => {
    expect(tickAngle(0)).toBeCloseTo(-Math.PI / 2 + Math.PI / TICKS, 9);
    expect(tickAngle(TICKS / 4)).toBeGreaterThan(0 - 1e-9);
    expect([litTicks(0), litTicks(0.5), litTicks(0.999), litTicks(1), litTicks(2)]).toEqual([
      0, 12, 23, 24, 24,
    ]);
  });
});

describe('글자 대비 (HUD에서 새로 쓰는 쌍)', () => {
  it('HUD 글자 쌍은 모두 기준 이상 (글자 4.5:1, 아이콘 3:1)', () => {
    for (const p of HUD_TEXT_PAIRS) expect(contrastRatio(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(p.min);
  });

  it('배너 톤 글자: 경고 배너는 #0B1622 (8.49:1), 발각 · 정보는 흰 글자 (palette.TEXT_PAIRS)', () => {
    expect(TONE.warn).toEqual({ bg: WARN, text: WARN_TEXT });
    for (const t of Object.values(TONE)) expect(contrastRatio(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(TEXT_PAIRS.some((p) => p.fg === UI.textDim)).toBe(true);
  });
});

describe('9조각 · 아틀라스 · 배치', () => {
  it('9조각 한 축: 양 끝 조각 크기는 그대로, 가운데가 나머지, 좁으면 가운데 0', () => {
    expect(sliceSpans(10, 110, 12, 8)).toEqual([
      [10, 12],
      [22, 80],
      [102, 8],
    ]);
    expect(sliceSpans(0, 15, 12, 8)).toEqual([
      [0, 12],
      [12, 0],
      [12, 8],
    ]);
  });

  it('선반 채우기: 겹치지 않고 폭 안에 들어간다', () => {
    const sizes = Array.from({ length: 60 }, (_, i) => ({ w: 5 + ((i * 37) % 90), h: 3 + ((i * 53) % 40) }));
    const { at, w, h } = packShelves(sizes, 256, 2);
    expect(w).toBeLessThanOrEqual(256);
    sizes.forEach((a, i) => {
      const p = at[i]!;
      expect(p.x + a.w).toBeLessThanOrEqual(w);
      expect(p.y + a.h).toBeLessThanOrEqual(h);
      sizes.forEach((b, j) => {
        if (j <= i) return;
        const q = at[j]!;
        const sep = p.x + a.w <= q.x || q.x + b.w <= p.x || p.y + a.h <= q.y || q.y + b.h <= p.y;
        expect(sep, `${i} · ${j}`).toBe(true);
      });
    });
  });

  it('아틀라스 목록: 이름이 겹치지 않고 범위 · 조각 크기가 올바르다', () => {
    const specs = hudSpecs();
    const names = specs.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(specs.length).toBeGreaterThan(150);
    for (const s of specs) {
      if (s.kind === 'frame') {
        expect(s.x1 > s.x0 && s.y1 > s.y0, s.name).toBe(true);
      } else {
        expect(Math.min(s.l, s.r, s.t), s.name).toBeGreaterThan(0);
        if (s.v) expect(s.b, s.name).toBeGreaterThan(0);
      }
    }
    // 그림마다 그리기 함수가 실제로 돈다 (가짜 2D 컨텍스트)
    const calls = paintAll(specs);
    expect(calls).toBeGreaterThan(specs.length);
  });

  it('늘 떠 있는 HUD 자리는 맵 사각형과 겹치지 않는다 (위 띠 · 왼쪽 카드 · 아래 띠 · 미니맵)', () => {
    const G = HUD.gauge;
    const rects: [string, number, number, number, number][] = [
      ['게이지 A', HUD.gaugeA.x, HUD.gaugeA.y - G.dia / 2, G.w, G.dia],
      ['게이지 B', HUD.gaugeB.x - G.w, HUD.gaugeB.y - G.dia / 2, G.w, G.dia],
      ['타이머', HUD.timer.x - HUD.timer.w / 2, HUD.timer.y - HUD.timer.h / 2, HUD.timer.w, HUD.timer.h],
      [
        '카드',
        HUD.leftCards.x,
        HUD.leftCards.y,
        HUD.leftCards.w,
        3 * HUD.leftCards.h + 2 * HUD.leftCards.gap,
      ],
      ['행동 칸', VIEW_W / 2 - 400, HUD.bottom.y - HUD.slot.tile / 2, 800, HUD.slot.tile],
      ['미니맵', HUD.minimap.x - HUD.minimap.pad, HUD.minimap.y - HUD.minimap.title, HUD.minimap.w + 12, 160],
    ];
    const m = MAP_RECT;
    for (const [name, x, y, w, h] of rects) {
      const apart = x + w <= m.x || m.x + m.w <= x || y + h <= m.y || m.y + m.h <= y;
      expect(apart, name).toBe(true);
    }
    // 위 띠 오른쪽(선명도 탐침 자리 x 1490~)은 비운다
    expect(HUD.gaugeB.x).toBeLessThan(1490);
  });
});

describe('조작 안내 줄 나누기', () => {
  it('키캡 · 덧말 · 설명으로 나누고, 원래 글자를 잃지 않는다', () => {
    expect(parseControl('E (누르고 있기)  감옥 문 앞에서 구조')).toEqual({
      kind: 'keys',
      pairs: [{ key: 'E', note: '(누르고 있기)', desc: '감옥 문 앞에서 구조' }],
    });
    expect(parseControl('Tab (누르고 있기)  점수판 · 상태')).toEqual({
      kind: 'keys',
      pairs: [{ key: 'Tab', note: '(누르고 있기)', desc: '점수판 · 상태' }],
    });
    expect(parseControl('WASD  이동 · 마우스  조준')).toEqual({
      kind: 'keys',
      pairs: [
        { key: 'WASD', note: '', desc: '이동' },
        { key: '마우스', note: '', desc: '조준' },
      ],
    });
    for (const team of ['survivor', 'monster'] as const)
      for (const line of CONTROLS[team]) {
        const r = parseControl(line);
        const words =
          r.kind === 'goal' ? r.text : r.pairs.map((p) => `${p.key} ${p.note} ${p.desc}`).join(' ');
        for (const w of line.split(/\s+/).filter((x) => x !== '·')) expect(words, line).toContain(w);
      }
  });
});

/** 모든 그림을 기록용 가짜 컨텍스트로 그려 본다 (예외 없음). 부른 그리기 명령 수를 돌려준다 */
function paintAll(specs: ReturnType<typeof hudSpecs>): number {
  let calls = 0;
  const gradient = { addColorStop: (): void => {} };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
        return (..._a: unknown[]): void => {
          calls += 1;
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  const g = globalThis as { Path2D?: unknown };
  const had = g.Path2D;
  g.Path2D = class {
    constructor(readonly d?: string) {}
  };
  try {
    for (const s of specs) {
      if (s.kind === 'frame') s.paint(ctx, 1.5);
      else s.paint(ctx, s.l + s.r + 4, s.v ? s.t + s.b + 4 : s.t, 1.5);
    }
  } finally {
    g.Path2D = had;
  }
  return calls;
}
