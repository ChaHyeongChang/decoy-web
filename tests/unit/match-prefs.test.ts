// 판 중 설정 효과 (설정 화면 통합): 흔들림 · 번쩍임 줄이기의 순수 값, 지도 크게 보기 자리, FPS · 핑 칩 글자 · 자리, PC 메뉴 버튼 자리,
// 판 중 메뉴가 열린 동안 입력 멈춤(InputSampler.suspend). 기본값(설정 모두 끔)은 예전과 같은 값이어야 한다
import { describe, expect, it } from 'vitest';
import { BTN, MAP_H, MAP_W, type SurvivorView } from '@decoy/shared';
import { InputSampler, type InputEnv } from '../../client/src/input';
import { HELP_TEXT } from '../../client/src/data/storyText';
import { PREF_DEFAULTS, shakeScaleOf } from '../../client/src/prefs';
import { CAMERA, ScreenShake } from '../../client/src/render/camera';
import { CameraDirector } from '../../client/src/render/cameraDirector';
import {
  HIT_FLASH_REDUCED,
  MINIMAP_BIG,
  MINIMAP_BIG_TEXELS,
  SPOTTED_EDGE,
  bigMinimapPlace,
  bigMinimapTexels,
  hitFlashLevel,
  spottedEdgeAlpha,
} from '../../client/src/render/prefsFx';
import { MENU_BUTTON, menuButtonPlace, type MenuKeepOut } from '../../client/src/ui/matchMenuButton';
import { HUD, HUD_BAND, MAP_RECT } from '../../client/src/ui/layout';
import { PERF_CHIP, perfChipPlace, perfChipText } from '../../client/src/ui/perfChip';
import { TEXTURE_BUDGET } from '../../client/src/gfx/presets';
import { loadTestBalance } from '../helpers/fixtures';

const HIT_MS = 200;

describe('번쩍임 줄이기: 피격 붉은 가장자리', () => {
  it('끄면 예전 식 그대로 (맞은 순간 1, 0.2초 동안 선형으로 0)', () => {
    for (const t of [0, 1, 50, 99.5, 150, 199, 200, 250, 1e9])
      expect(hitFlashLevel(t, HIT_MS, false)).toBe(Math.max(0, 1 - t / HIT_MS));
  });

  it('켜면 가장 진할 때 0.35배 이하, 맞은 순간 확 켜지지 않고(서서히 오른다) 같은 0.2초에 사라진다', () => {
    let peak = 0;
    for (let t = 0; t <= 260; t += 1) peak = Math.max(peak, hitFlashLevel(t, HIT_MS, true));
    expect(peak).toBeCloseTo(HIT_FLASH_REDUCED.peak, 6);
    expect(peak).toBeLessThanOrEqual(0.35 + 1e-9);
    // 맞은 순간 0, 오르는 동안 단조 증가
    expect(hitFlashLevel(0, HIT_MS, true)).toBe(0);
    for (let t = 1; t < HIT_FLASH_REDUCED.riseMs; t += 1)
      expect(hitFlashLevel(t, HIT_MS, true)).toBeGreaterThan(hitFlashLevel(t - 1, HIT_MS, true));
    // 맞았다는 신호는 남는다 (0.1초에 아직 보인다), 끝나면 0
    expect(hitFlashLevel(100, HIT_MS, true)).toBeGreaterThan(0.1);
    expect(hitFlashLevel(HIT_MS, HIT_MS, true)).toBe(0);
    expect(hitFlashLevel(-5, HIT_MS, true)).toBe(0);
    expect(hitFlashLevel(1e9, HIT_MS, true)).toBe(0);
  });
});

describe('번쩍임 줄이기: 발각 빛 테두리 · 잘라 옮김 어두워짐', () => {
  it('발각 테두리: 끄면 1.2Hz 맥동(0.6~1, 예전 식 그대로), 켜면 맥동 없이 0.9로 늘 보인다', () => {
    for (const t of [0, 123, 416.6, 1000, 5555])
      expect(spottedEdgeAlpha(t, false)).toBe(0.8 + 0.2 * Math.cos((t / 1000) * Math.PI * 2 * 1.2));
    const seen = new Set<number>();
    for (let t = 0; t < 2000; t += 7) seen.add(spottedEdgeAlpha(t, true));
    expect([...seen]).toEqual([SPOTTED_EDGE.steady]);
    expect(SPOTTED_EDGE.steady).toBeGreaterThanOrEqual(SPOTTED_EDGE.mid);
  });

  it('잘라 옮김: noDip이면 어두워지지 않고 바로 옮긴다 (잘라 옮긴 횟수 · 창 자리는 같다)', () => {
    const balance = loadTestBalance();
    const base = {
      dtMs: 16,
      selfId: 's',
      myStatus: 'free' as const,
      survivors: new Map<string, SurvivorView>(),
      team: ['s'],
      balance,
      blend: 0,
      viewW: 16,
      viewH: 32 / 3,
      devPerTile: 40,
      role: 'runner' as const,
    };
    const run = (noDip: boolean): { cuts: number; dips: number[]; view: { x: number; y: number } } => {
      const d = new CameraDirector(16, 32 / 3);
      d.noDip = noDip;
      d.update({ ...base, nowMs: 0, me: { x: 4, y: 4, face: 0 } });
      // 먼 순간 이동 → 잘라 옮긴다
      const v = d.update({ ...base, nowMs: 16, me: { x: 44, y: 28, face: 0 } });
      const dips: number[] = [];
      for (let t = 16; t < 16 + CAMERA.dipOutMs + CAMERA.dipInMs + 40; t += 10) dips.push(d.dip(t));
      return { cuts: d.cuts, dips, view: { x: v.x, y: v.y } };
    };
    const normal = run(false);
    const reduced = run(true);
    expect(normal.cuts).toBe(1);
    expect(Math.max(...normal.dips)).toBeGreaterThan(0.3);
    expect(reduced.cuts).toBe(1);
    expect(reduced.dips.every((a) => a === 0)).toBe(true);
    expect(reduced.view).toEqual(normal.view);
  });
});

describe('흔들림 줄이기', () => {
  it('설정 · OS 동작 줄이기면 배율 0, 그때 맞거나 포효해도 화면 창이 움직이지 않는다', () => {
    expect(shakeScaleOf(false, PREF_DEFAULTS)).toBe(1);
    expect(shakeScaleOf(true, PREF_DEFAULTS)).toBe(0);
    expect(shakeScaleOf(false, { ...PREF_DEFAULTS, reduceShake: true })).toBe(0);
    const out = { x: 0, y: 0 };
    const sh = new ScreenShake();
    sh.add('hitMe', 0);
    sh.add('roar', 0);
    expect(Math.hypot(sh.offset(30, out).x, out.y)).toBeGreaterThan(0);
    sh.scale = shakeScaleOf(false, { ...PREF_DEFAULTS, reduceShake: true });
    sh.add('hitMe', 40);
    for (let t = 40; t < 400; t += 8) {
      sh.offset(t, out);
      expect(out.x).toBe(0);
      expect(out.y).toBe(0);
    }
    expect(sh.active).toBe(0);
  });
});

describe('지도 크게 보기 자리', () => {
  const PC_MAP = { x: 246, y: 64, w: 1428, h: 952 };
  it('맵 창 가운데, 틀 높이 = 맵 창 높이 × 0.66, 틀이 맵 창 안, 그림은 맵 비율(3:2)', () => {
    for (const [map, pad, title] of [
      [PC_MAP, 6, 30],
      [{ x: 120.5, y: 0, w: 900.3, h: 600.2 }, 9, 36],
      [{ x: 10, y: 40, w: 300, h: 400 }, 6, 24],
    ] as const) {
      const p = bigMinimapPlace(map, pad, title, MAP_W / MAP_H);
      const h = Math.round((p.w * MAP_H) / MAP_W);
      const frame = { x: p.x - pad, y: p.y - title, w: p.w + pad * 2, h: h + title + pad };
      expect(frame.x).toBeGreaterThanOrEqual(map.x - 1);
      expect(frame.y).toBeGreaterThanOrEqual(map.y - 1);
      expect(frame.x + frame.w).toBeLessThanOrEqual(map.x + map.w + 1);
      expect(frame.y + frame.h).toBeLessThanOrEqual(map.y + map.h + 1);
      // 가운데 (반올림 1px 안)
      expect(Math.abs(frame.x + frame.w / 2 - (map.x + map.w / 2))).toBeLessThanOrEqual(1.5);
      expect(Math.abs(frame.y + frame.h / 2 - (map.y + map.h / 2))).toBeLessThanOrEqual(1.5);
      expect(frame.h).toBeLessThanOrEqual(map.h * MINIMAP_BIG.heightFrac + 1);
      expect(frame.w).toBeLessThanOrEqual(map.w * MINIMAP_BIG.maxWidthFrac + 1);
    }
    // PC: 틀 높이 628 (맵 창 952의 0.66) — 작은 미니맵(폭 222)의 4배 남짓
    const pc = bigMinimapPlace(PC_MAP, 6, 30, MAP_W / MAP_H);
    expect(pc.w).toBe(888);
    expect(pc.w / 222).toBeGreaterThan(3.9);
  });
});

describe('FPS · 핑 칩', () => {
  it('글자: 정수 FPS · 핑, 모르면 -', () => {
    expect(perfChipText(59.6, 42.4)).toBe('60 FPS · 핑 42ms');
    expect(perfChipText(120, null)).toBe(`120 FPS · 핑 ${HELP_TEXT.perfChipUnknown}ms`);
    expect(perfChipText(null, Number.NaN)).toBe('- FPS · 핑 -ms');
  });

  it('자리: 맵 창 왼쪽 위 안쪽, 같은 구석의 ?debug=1 칩이 있으면 그 아래', () => {
    const canvas = { left: 10, top: 20, k: 0.5 };
    const map = { x: 246, y: 64 };
    const p = perfChipPlace(canvas, map, null);
    expect(p).toEqual({ left: 10 + 123 + PERF_CHIP.insetCss, top: 20 + 32 + PERF_CHIP.insetCss });
    // ?debug=1 칩 (터치: 맵 왼쪽 끝 + 6 · 화면 맨 위, 높이 20)
    const dbg = { left: p.left, top: p.top - 2, width: 90, height: 20 };
    const q = perfChipPlace(canvas, map, dbg);
    expect(q.left).toBe(p.left);
    expect(q.top).toBe(dbg.top + dbg.height + PERF_CHIP.gapCss);
    // 다른 구석(PC: 왼쪽 아래)이면 그대로
    expect(perfChipPlace(canvas, map, { left: 8, top: 500, width: 200, height: 20 })).toEqual(p);
    // 여럿 (좌우 반전 터치: 시스템 버튼 두 줄이 맵 왼쪽 위에 걸침 + ?debug=1 칩) → 위에서부터 차례로 맨 아래 것 밑
    const sys1 = { left: p.left - 30, top: p.top - 10, width: 48, height: 48 };
    const sys2 = { left: p.left - 30, top: sys1.top + 48 + 2, width: 48, height: 48 };
    const r = perfChipPlace(canvas, map, [sys2, dbg, sys1]);
    expect(r.left).toBe(p.left);
    expect(r.top).toBe(sys2.top + sys2.height + PERF_CHIP.gapCss);
    // 빈 목록 = 그대로
    expect(perfChipPlace(canvas, map, [])).toEqual(p);
  });
});

describe('지도 크게 보기 바닥 해상도 (bigMinimapTexels)', () => {
  const MiB = 1024 * 1024;
  const A = MAP_W / MAP_H;
  const bytesOf = (w: number): number => w * Math.round(w / A) * 4;

  it('화면 기기 px에 맞춘다 (컨테이너 실측 장면): PC 낮음 · 태블릿 · 휴대폰 낮음은 기기 px 그대로, 휴대폰 높음 · 중간은 작은 지도 합성 그대로(null)', () => {
    // PC 1920×1080 낮음: 그림 888px, 작은 합성 384, 나머지 텍스처 5.55MiB / 예산 8MiB
    expect(bigMinimapTexels(888, 384, A, TEXTURE_BUDGET.low, 5.55 * MiB)).toBe(888);
    // 태블릿 높음 1061px · 휴대폰 915×412 낮음 476px
    expect(bigMinimapTexels(1061, 768, A, TEXTURE_BUDGET.high, 24.76 * MiB)).toBe(1061);
    expect(bigMinimapTexels(476, 384, A, TEXTURE_BUDGET.low, 4.38 * MiB)).toBe(476);
    // 휴대폰 800×360 높음 658px < 작은 합성 768: 작은 지도 합성을 그대로 (예전과 같다)
    expect(bigMinimapTexels(658, 768, A, TEXTURE_BUDGET.high, 15.74 * MiB)).toBeNull();
    expect(bigMinimapTexels(570, 576, A, TEXTURE_BUDGET.medium, 11.47 * MiB)).toBeNull();
  });

  it('텍스처 예산을 넘지 않는다: PC 1920×1080@2 높음(나머지 29.43MiB)은 남은 만큼만(작은 합성 768보다는 크게), 남은 것이 없으면 null', () => {
    const w = bigMinimapTexels(1776, 768, A, TEXTURE_BUDGET.high, 29.43 * MiB);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThan(768);
    expect(w!).toBeLessThan(1776);
    expect(29.43 * MiB + bytesOf(w!)).toBeLessThanOrEqual(
      TEXTURE_BUDGET.high - MINIMAP_BIG_TEXELS.budgetMargin,
    );
    expect(bigMinimapTexels(1776, 768, A, TEXTURE_BUDGET.high, 31.9 * MiB)).toBeNull();
    expect(bigMinimapTexels(888, 384, A, TEXTURE_BUDGET.low, 9 * MiB)).toBeNull();
  });

  it('어떤 값이든: null이거나, 작은 합성보다 크고 필요한 기기 px · 상한 이하이며 예산 − 여유 안', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 2000; i += 1) {
      const need = rnd() * 3000;
      const base = 256 + Math.floor(rnd() * 600);
      const budget = rnd() < 0.5 ? TEXTURE_BUDGET.low : TEXTURE_BUDGET.high;
      const others = rnd() * budget;
      const w = bigMinimapTexels(need, base, A, budget, others);
      if (w === null) continue;
      expect(w).toBeGreaterThan(base);
      expect(w).toBeLessThanOrEqual(Math.ceil(need));
      expect(w).toBeLessThanOrEqual(MINIMAP_BIG_TEXELS.maxW);
      expect(others + bytesOf(w)).toBeLessThanOrEqual(budget - MINIMAP_BIG_TEXELS.budgetMargin);
    }
    expect(bigMinimapTexels(0, 384, A, TEXTURE_BUDGET.high, 0)).toBeNull();
    expect(bigMinimapTexels(Number.NaN, 384, A, TEXTURE_BUDGET.high, 0)).toBeNull();
  });
});

describe('PC 판 중 메뉴 버튼 자리', () => {
  /** 판 장면이 넘기는 값 (PC 배치) */
  const KEEP: MenuKeepOut = {
    band: HUD_BAND,
    cardTop: HUD.leftCards.y,
    mapLeft: MAP_RECT.x,
    gaugeLeft: HUD.gaugeA.x - HUD.gauge.dia / 2,
  };
  /** 실제 버튼 크기 (Noto Sans KR 15px '설정' + 아이콘 + Esc 키캡, 1920×1080에서 잰 값) */
  const SIZE = { w: 119, h: 44 };
  /** 창 크기 → 캔버스 자리 (1920×1080을 비율 그대로 맞추고 가운데) */
  const canvasOf = (w: number, h: number): { left: number; top: number; k: number } => {
    const k = Math.min(w / 1920, h / 1080);
    return { left: (w - 1920 * k) / 2, top: (h - 1080 * k) / 2, k };
  };
  type Box = { x: number; y: number; w: number; h: number };
  const hit = (a: Box, b: Box, gap: number): boolean =>
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

  it('큰 창은 예전 그대로: 1920×1080 띠 가운데(10px 아래), 1280×720 · 1366×768은 줄이지 않고 캔버스 맨 위', () => {
    expect(menuButtonPlace({ left: 0, top: 0, k: 1 }, SIZE, KEEP)).toEqual({ left: 14, top: 10, scale: 1 });
    expect(menuButtonPlace(canvasOf(1280, 720), SIZE, KEEP)).toMatchObject({ top: 0, scale: 1 });
    expect(menuButtonPlace(canvasOf(1366, 768), SIZE, KEEP)).toMatchObject({ top: 0, scale: 1 });
    expect(MENU_BUTTON.heightCss).toBeGreaterThanOrEqual(44);
  });

  it('작은 창 · 레터박스 · 필러박스: 팀 카드 · 맵 사각형 · 거점 A 게이지와 4px 넘게 떨어지고 창 안 (960×540은 줄여서 — 예전에는 카드에 5px 걸침)', () => {
    const sizes: [number, number][] = [
      [1920, 1080],
      [2560, 1440],
      [1366, 768],
      [1280, 720],
      [1138, 712],
      [1024, 768],
      [1024, 576],
      [960, 540],
      [800, 600],
      [1280, 540],
      [640, 360],
    ];
    for (const [ww, wh] of sizes) {
      const c = canvasOf(ww, wh);
      const p = menuButtonPlace(c, SIZE, KEEP);
      const b = { x: p.left, y: p.top, w: SIZE.w * p.scale, h: SIZE.h * p.scale };
      const k = c.k;
      const L = (x: number): number => c.left + x * k;
      const T = (y: number): number => c.top + y * k;
      const cards: Box = { x: L(HUD.leftCards.x), y: T(HUD.leftCards.y), w: HUD.leftCards.w * k, h: 400 * k };
      const map: Box = { x: L(MAP_RECT.x), y: T(MAP_RECT.y), w: MAP_RECT.w * k, h: MAP_RECT.h * k };
      const gauge: Box = {
        x: L(KEEP.gaugeLeft),
        y: T(0),
        w: (HUD.gauge.w + HUD.gauge.dia) * k,
        h: HUD_BAND * k,
      };
      const label = `${ww}×${wh} ${JSON.stringify(p)}`;
      expect(hit(b, cards, MENU_BUTTON.gapCss - 0.5), `${label} ↔ 팀 카드`).toBe(false);
      expect(hit(b, map, MENU_BUTTON.gapCss - 0.5), `${label} ↔ 맵`).toBe(false);
      expect(hit(b, gauge, MENU_BUTTON.gapCss - 0.5), `${label} ↔ 게이지`).toBe(false);
      expect(b.x, label).toBeGreaterThanOrEqual(0);
      expect(b.y, label).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, label).toBeLessThanOrEqual(ww);
      expect(p.scale, label).toBeGreaterThanOrEqual(MENU_BUTTON.minScale);
      expect(p.scale, label).toBeLessThanOrEqual(1);
    }
    // 960×540: 들어가는 만큼만 줄인다 (높이 35px 안팎 — 글자 약 12px), 팀 카드 위 끝(39px)보다 4px 위
    const s960 = menuButtonPlace(canvasOf(960, 540), SIZE, KEEP);
    expect(s960.scale).toBeGreaterThan(0.75);
    expect(s960.top + SIZE.h * s960.scale).toBeLessThanOrEqual(39 - MENU_BUTTON.gapCss + 0.01);
    // 800×600 (위 여백 75px): 줄이지 않고 캔버스 위 여백 가운데
    const s800 = menuButtonPlace(canvasOf(800, 600), SIZE, KEEP);
    expect(s800.scale).toBe(1);
    expect(s800.top + SIZE.h).toBeLessThanOrEqual(75);
  });

  it('크기를 아직 모르면(0) 기본 높이로 계산하고 배율은 하한 아래로 내려가지 않는다', () => {
    const p = menuButtonPlace({ left: 0, top: 0, k: 0.1 }, { w: 0, h: 0 }, KEEP);
    expect(p.scale).toBe(MENU_BUTTON.minScale);
    expect(p.top).toBe(0);
  });
});

// ── 판 중 메뉴가 열린 동안 입력 멈춤 ──

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function rig(): { sampler: InputSampler; host: EventTarget; win: EventTarget } {
  const env: InputEnv = { win: new EventTarget(), doc: new FakeDoc(), orientation: null };
  const host = new EventTarget();
  const sampler = new InputSampler();
  sampler.attach(host, { touch: null, env });
  return { sampler, host, win: env.win };
}

const keyEv = (type: 'keydown' | 'keyup', code: string, repeat = false): Event =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat });
const ptrEv = (type: string, pointerType: string, button = 0): Event =>
  Object.assign(new Event(type, { cancelable: true }), { pointerType, button });

describe('판 중 메뉴: 입력 멈춤 (InputSampler.suspend)', () => {
  it('열면 누르던 키 · 마우스를 모두 떼고, 여는 동안 키 · 클릭 · Tab을 받지 않으며 기본 동작도 막지 않는다', () => {
    const r = rig();
    r.win.dispatchEvent(keyEv('keydown', 'KeyW'));
    r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 0));
    const before = r.sampler.sample(1, 0.5);
    expect(before.my).toBe(-1);
    expect(before.held & BTN.ATTACK).toBe(BTN.ATTACK);
    r.sampler.suspend(true);
    expect(r.sampler.isSuspended).toBe(true);
    // 판 장면이 프레임마다 읽고 비운다 (여는 동안 누른 것은 조작 안내 닫기로도 세지 않는다)
    r.sampler.anyKeyPressed = false;
    const tab = keyEv('keydown', 'Tab');
    r.win.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(r.sampler.tabHeld).toBe(false);
    const space = keyEv('keydown', 'Space');
    r.win.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    r.win.dispatchEvent(keyEv('keydown', 'KeyD'));
    r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 2));
    r.win.dispatchEvent(keyEv('keydown', 'Digit2'));
    for (let seq = 2; seq < 6; seq += 1) {
      const f = r.sampler.sample(seq, 0.5);
      expect(f).toEqual({ seq, mx: 0, my: 0, aim: 0.5, held: 0, pressed: 0 });
    }
    expect(r.sampler.takeSpectatePick()).toBeNull();
    expect(r.sampler.anyKeyPressed).toBe(false);
  });

  it('닫는 순간 누르고 있는 이동 키를 이어받는다 (연 전부터 · 여는 동안 누른 키 모두, 다시 누르지 않아도 걷는다)', () => {
    const r = rig();
    r.win.dispatchEvent(keyEv('keydown', 'KeyW'));
    expect(r.sampler.sample(1, 0).my).toBe(-1);
    r.sampler.suspend(true);
    r.win.dispatchEvent(keyEv('keydown', 'KeyW', true));
    r.win.dispatchEvent(keyEv('keydown', 'KeyD'));
    expect(r.sampler.sample(2, 0)).toMatchObject({ mx: 0, my: 0 });
    r.sampler.suspend(false);
    expect(r.sampler.isSuspended).toBe(false);
    const f = r.sampler.sample(3, 0);
    expect(f.mx).toBeCloseTo(Math.SQRT1_2, 6);
    expect(f.my).toBeCloseTo(-Math.SQRT1_2, 6);
    expect([f.held, f.pressed]).toEqual([0, 0]);
    // 이어받은 키의 자동 반복은 그대로 누르고 있는 것 · 떼면 멈춘다
    r.win.dispatchEvent(keyEv('keydown', 'KeyW', true));
    r.win.dispatchEvent(keyEv('keyup', 'KeyD'));
    expect(r.sampler.sample(4, 0)).toMatchObject({ mx: 0, my: -1, pressed: 0 });
    r.win.dispatchEvent(keyEv('keyup', 'KeyW'));
    expect(r.sampler.sample(5, 0)).toMatchObject({ mx: 0, my: 0 });
    // 같은 값으로 다시 불러도 그대로 (누르던 키를 다시 떼지 않는다)
    r.win.dispatchEvent(keyEv('keydown', 'KeyS'));
    r.sampler.suspend(false);
    expect(r.sampler.sample(6, 0).my).toBe(1);
  });

  it('여는 동안 눌렀다 뗀 키 · 닫으려고 누른 Esc는 남지 않는다 (누른 신호 · 아무 키 표시도 없다)', () => {
    const r = rig();
    r.sampler.suspend(true);
    r.win.dispatchEvent(keyEv('keydown', 'KeyA'));
    r.win.dispatchEvent(keyEv('keyup', 'KeyA'));
    r.win.dispatchEvent(keyEv('keydown', 'Escape'));
    r.sampler.anyKeyPressed = false;
    // Esc를 누른 채 닫힌다 (설정 화면이 keydown에서 닫는다)
    r.sampler.suspend(false);
    expect(r.sampler.sample(1, 0)).toMatchObject({ mx: 0, my: 0, held: 0, pressed: 0 });
    // 닫은 뒤 오는 Esc 자동 반복 · keyup도 게임 입력이 아니다
    r.win.dispatchEvent(keyEv('keydown', 'Escape', true));
    r.win.dispatchEvent(keyEv('keyup', 'Escape'));
    expect(r.sampler.sample(2, 0)).toMatchObject({ mx: 0, my: 0, held: 0, pressed: 0 });
    expect(r.sampler.anyKeyPressed).toBe(false);
  });

  it('버튼 키(능력 · 구조 · 돌진 · 포효)와 Tab은 이어받지 않는다: 닫은 뒤 자동 반복으로 능력이 나가지 않고, 다시 누르면 받는다', () => {
    const r = rig();
    for (const code of ['Space', 'KeyE', 'ShiftLeft', 'KeyQ', 'KeyW', 'Tab'])
      r.win.dispatchEvent(keyEv('keydown', code));
    r.sampler.sample(1, 0);
    r.sampler.suspend(true);
    r.sampler.suspend(false);
    // 손을 떼지 않은 채 운영체제 자동 반복이 온다
    for (const code of ['Space', 'KeyE', 'ShiftLeft', 'KeyQ', 'KeyW', 'Tab'])
      r.win.dispatchEvent(keyEv('keydown', code, true));
    // 이동(W)만 이어받는다
    expect(r.sampler.sample(2, 0)).toMatchObject({ mx: 0, my: -1, held: 0, pressed: 0 });
    expect(r.sampler.tabHeld).toBe(false);
    // 떼고 다시 누르면 받는다 · 받은 뒤의 자동 반복은 그대로 누르고 있는 것
    r.win.dispatchEvent(keyEv('keyup', 'Space'));
    r.win.dispatchEvent(keyEv('keydown', 'Space'));
    r.win.dispatchEvent(keyEv('keydown', 'Space', true));
    const f = r.sampler.sample(3, 0);
    expect(f.pressed & BTN.ABILITY).toBe(BTN.ABILITY);
    expect(f.held & BTN.ABILITY).toBe(BTN.ABILITY);
    expect(r.sampler.sample(4, 0).pressed & BTN.ABILITY).toBe(0);
  });

  it('마우스 버튼은 이어받지 않는다: 닫으려고 누른 클릭이 공격으로 새지 않는다', () => {
    const r = rig();
    r.sampler.suspend(true);
    r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 0));
    r.sampler.suspend(false);
    expect(r.sampler.sample(1, 0)).toMatchObject({ held: 0, pressed: 0 });
    r.win.dispatchEvent(ptrEv('pointerup', 'mouse', 0));
    expect(r.sampler.sample(2, 0)).toMatchObject({ held: 0, pressed: 0 });
  });

  it('여는 동안 창을 떠났거나(blur) 숨겼으면 닫을 때 이어받을 키가 없다 (keyup을 못 받았을 수 있다)', () => {
    for (const leave of ['blur', 'hidden'] as const) {
      const env: InputEnv = { win: new EventTarget(), doc: new FakeDoc(), orientation: null };
      const sampler = new InputSampler();
      sampler.attach(new EventTarget(), { touch: null, env });
      env.win.dispatchEvent(keyEv('keydown', 'KeyW'));
      sampler.suspend(true);
      if (leave === 'blur') env.win.dispatchEvent(new Event('blur'));
      else {
        (env.doc as FakeDoc).visibilityState = 'hidden';
        env.doc.dispatchEvent(new Event('visibilitychange'));
      }
      sampler.suspend(false);
      expect(sampler.sample(1, 0), leave).toMatchObject({ mx: 0, my: 0 });
    }
  });

  it('떼어 내면(판 장면 끝) 멈춤도 풀린다', () => {
    const r = rig();
    r.sampler.suspend(true);
    r.sampler.detach();
    expect(r.sampler.isSuspended).toBe(false);
  });
});
