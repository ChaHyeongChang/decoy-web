// 출시 전 검토 반영 (클라이언트 흐름): PC 괴물 조준이 판 장면에서 캔버스 포인터를 받은 뒤에만 커서를 따르는지,
// 판 중 뒤로 가기 확인 문구가 판 종류(친구 방 · 빠른 매칭 · 연습)에 맞는지. DOM 없이(jsdom 없음) 최소한의 EventTarget으로 본다
import { describe, expect, it } from 'vitest';
import { InputSampler, type InputEnv } from '../../client/src/input';
import { TouchInput } from '../../client/src/touchInput';
import { APP_TEXT } from '../../client/src/data/storyText';
import { leaveKindFor } from '../../client/src/lifecycle';
import { leaveTextFor } from '../../client/src/ui/lifecycleUi';

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function rig(touch: TouchInput | null): { sampler: InputSampler; host: EventTarget; win: EventTarget } {
  const env: InputEnv = { win: new EventTarget(), doc: new FakeDoc(), orientation: new EventTarget() };
  const host = new EventTarget();
  const sampler = new InputSampler();
  sampler.attach(host, { touch, touchAim: touch !== null, env });
  return { sampler, host, win: env.win };
}

const ptrEv = (type: string, pointerType: string, button = 0): Event =>
  Object.assign(new Event(type, { cancelable: true }), { pointerType, button });

describe('PC 괴물 조준: 판 장면에서 캔버스 포인터를 받기 전에는 지금 방향 (검토 반영)', () => {
  it('붙인 직후에는 커서 조준을 쓰지 않는다 — 포인터 자리는 로비에서 누른 버튼 자리다', () => {
    const r = rig(null);
    expect(r.sampler.aimPointerReady).toBe(false);
    // 창 단위 이벤트(로비 · 판 밖)는 세지 않는다
    r.win.dispatchEvent(ptrEv('pointermove', 'mouse'));
    expect(r.sampler.aimPointerReady).toBe(false);
  });

  it('캔버스 위 마우스 · 펜이 움직이거나 누르면 커서를 따른다. 손가락은 세지 않는다(터치스크린 노트북)', () => {
    const moved = rig(null);
    moved.host.dispatchEvent(ptrEv('pointermove', 'touch'));
    moved.host.dispatchEvent(ptrEv('pointerdown', 'touch'));
    expect(moved.sampler.aimPointerReady).toBe(false);
    moved.host.dispatchEvent(ptrEv('pointermove', 'mouse'));
    expect(moved.sampler.aimPointerReady).toBe(true);
    const pen = rig(null);
    pen.host.dispatchEvent(ptrEv('pointermove', 'pen'));
    expect(pen.sampler.aimPointerReady).toBe(true);
    const clicked = rig(null);
    clicked.host.dispatchEvent(ptrEv('pointerdown', 'mouse'));
    expect(clicked.sampler.aimPointerReady).toBe(true);
  });

  it('새 판(다시 붙임)마다 처음부터', () => {
    const r = rig(null);
    r.host.dispatchEvent(ptrEv('pointermove', 'mouse'));
    expect(r.sampler.aimPointerReady).toBe(true);
    r.sampler.detach();
    const env: InputEnv = { win: new EventTarget(), doc: new FakeDoc(), orientation: null };
    r.sampler.attach(new EventTarget(), { env });
    expect(r.sampler.aimPointerReady).toBe(false);
  });

  it('터치 모드는 지금처럼 실제 마우스를 쓴 뒤에만 (창 어디서든)', () => {
    const r = rig(new TouchInput());
    expect(r.sampler.aimPointerReady).toBe(false);
    r.win.dispatchEvent(ptrEv('pointermove', 'touch'));
    expect(r.sampler.aimPointerReady).toBe(false);
    r.win.dispatchEvent(ptrEv('pointermove', 'mouse'));
    expect(r.sampler.aimPointerReady).toBe(true);
  });
});

describe('판 중 뒤로 가기 확인 문구 (검토 반영 F10 · F16)', () => {
  it('빠른 매칭 판은 바로 판정된다는 안내(30초 유예 없음), 친구 방은 30초 유예 안내', () => {
    expect(leaveTextFor('quick').body).toBe(APP_TEXT.leaveBodyQuick);
    expect(leaveTextFor('quick').body).not.toContain('30초');
    expect(leaveTextFor('quick').body).toContain('바로');
    expect(leaveTextFor('match').body).toBe(APP_TEXT.leaveBody);
    expect(leaveTextFor('match').body).toContain('30초');
    expect(leaveTextFor('match').title).toBe(APP_TEXT.leaveTitle);
    expect(leaveTextFor('quick').title).toBe(APP_TEXT.leaveTitle);
  });

  it('연습 판은 연습 문구(첫 화면으로) — 온라인 판의 유예 · 판정 안내가 섞이지 않는다', () => {
    const t = leaveTextFor('practice');
    expect(t).toEqual({ title: APP_TEXT.leaveTitlePractice, body: APP_TEXT.leaveBodyPractice });
    expect(t.title).toContain('연습');
    expect(t.title).toContain('첫 화면');
    for (const online of [APP_TEXT.leaveTitle, APP_TEXT.leaveBody, APP_TEXT.leaveBodyQuick])
      expect([t.title, t.body]).not.toContain(online);
    expect(`${t.title} ${t.body}`).not.toMatch(/30초|사망|무효/);
  });

  it('판 종류: 연습(기기 안 서버)이 먼저, 그다음 빠른 매칭 방, 나머지는 친구 방', () => {
    // 연습 방도 로비 상태(kind 'practice')를 갖는다 — 연습 중이면 방 종류와 상관없이 연습
    expect(leaveKindFor(true, 'practice')).toBe('practice');
    expect(leaveKindFor(true, null)).toBe('practice');
    expect(leaveKindFor(true, 'quick')).toBe('practice');
    expect(leaveKindFor(false, 'quick')).toBe('quick');
    expect(leaveKindFor(false, 'code')).toBe('match');
    expect(leaveKindFor(false, null)).toBe('match');
  });
});
