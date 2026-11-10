// 공격 버튼 방식 (플레이테스트 반영 a-2, 설정 조작 탭 '끌어서 조준 / 누르면 바로')에 따라 고르는 문구:
// 터치 점수판 조작 안내(controlsText) · 판 직전 터치 안내 본문(tutorialLines) · 설정 줄 문구.
// 방식 자체(저장 · 복원 · 되돌리기)는 prefs.test.ts · settings-model.test.ts, 입력 해석은 touch-input.test.ts
import { describe, expect, it } from 'vitest';
import {
  CONTROLS,
  CONTROLS_TOUCH,
  CONTROLS_TOUCH_INSTANT,
  SETTINGS_TEXT,
  TOUCH_TEXT,
  controlsText,
  tutorialLines,
} from '../../client/src/data/storyText';
import { parseControl } from '../../client/src/ui/hudArt';

describe('조작 안내 (점수판): 공격 버튼 방식에 맞는 줄', () => {
  it('PC · 터치 생존자는 방식과 무관하게 그대로', () => {
    for (const attack of ['drag', 'instant'] as const) {
      expect(controlsText('monster', 'keyboard', attack)).toBe(CONTROLS.monster);
      expect(controlsText('survivor', 'keyboard', attack)).toBe(CONTROLS.survivor);
      expect(controlsText('survivor', 'touch', attack)).toBe(CONTROLS_TOUCH.survivor);
    }
  });

  it("터치 괴물 '끌어서 조준'(기본): 놓으면 공격 줄에 '짧게 탭 = 보는 방향'이 둘째 칸으로 있다", () => {
    expect(controlsText('monster', 'touch')).toBe(CONTROLS_TOUCH.monster);
    expect(controlsText('monster', 'touch', 'drag')).toBe(CONTROLS_TOUCH.monster);
    const line = CONTROLS_TOUCH.monster[1]!;
    expect(line).toContain('놓으면');
    expect(line).toContain('되돌리면 취소');
    // 짧은 탭은 첫 칸 설명에 붙이지 않고 둘째 칸(첫 줄 '오른쪽 스틱  조준' 아래)으로 둔다 — 조작 안내 블록은 열 단위로 폭을 재서
    // 첫 칸이 길어지면 점수판 패널 전체가 넓어진다(작은 휴대폰 + UI 크기 큼에서 화면 밖, attack-button.spec 점수판 시험)
    expect(parseControl(line)).toEqual({
      kind: 'keys',
      pairs: [
        { key: '오른쪽 스틱을 놓으면', note: '', desc: '공격 (되돌리면 취소)' },
        { key: '짧게 탭', note: '', desc: '보는 방향' },
      ],
    });
  });

  it("터치 괴물 '누르면 바로': 조준 스틱 · 놓기 · 취소 말이 없고 누르면 바로 공격, 나머지 줄(돌진 · 점수판 · 목표)은 같다", () => {
    const lines = controlsText('monster', 'touch', 'instant');
    expect(lines).toHaveLength(CONTROLS_TOUCH.monster.length);
    expect(lines.slice(0, 2)).toEqual([...CONTROLS_TOUCH_INSTANT]);
    expect(lines.slice(2)).toEqual(CONTROLS_TOUCH.monster.slice(2));
    const head = lines.slice(0, 2).join(' ');
    expect(head).toContain('누르면 바로');
    expect(head).toContain('보는 방향');
    for (const word of ['오른쪽 스틱', '놓으면', '취소', '조준']) expect(head, word).not.toContain(word);
    // 원본 배열을 고치지 않는다 (다음 판에 방식을 되돌리면 예전 줄)
    expect(CONTROLS_TOUCH.monster[1]).toContain('놓으면');
  });

  it('두 방식의 모든 줄이 키캡 줄로 나뉘고 글자를 잃지 않는다 (마지막 목표 문장만 문장 줄)', () => {
    for (const attack of ['drag', 'instant'] as const) {
      const lines = controlsText('monster', 'touch', attack);
      lines.forEach((line, i) => {
        const r = parseControl(line);
        expect(r.kind, line).toBe(i === lines.length - 1 ? 'goal' : 'keys');
        const words =
          r.kind === 'goal' ? r.text : r.pairs.map((p) => `${p.key} ${p.note} ${p.desc}`).join(' ');
        for (const w of line.split(/\s+/).filter((x) => x !== '·')) expect(words, line).toContain(w);
      });
    }
    // 누르면 바로: 키캡 '공격 버튼' + 설명
    expect(parseControl(CONTROLS_TOUCH_INSTANT[1]!)).toEqual({
      kind: 'keys',
      pairs: [{ key: '공격 버튼', note: '', desc: '누르면 바로 보는 방향으로 공격' }],
    });
  });
});

describe('판 직전 터치 안내 본문: 공격 버튼 방식에 맞는 둘째 줄', () => {
  it('생존자는 방식과 무관하다', () => {
    for (const attack of ['drag', 'instant'] as const) {
      expect(tutorialLines('survivor', false, attack)).toBe(TOUCH_TEXT.tutorialSurvivor);
      expect(tutorialLines('survivor', true, attack)).toBe(TOUCH_TEXT.tutorialSurvivorCustom);
    }
  });

  it("괴물 '끌어서 조준'(기본): 조준 스틱 줄에 '짧게 누르면 보는 방향으로'가 있다 (기본 배치 · 바꾼 배치)", () => {
    expect(tutorialLines('monster', false)).toBe(TOUCH_TEXT.tutorialMonster);
    expect(tutorialLines('monster', true, 'drag')).toBe(TOUCH_TEXT.tutorialMonsterCustom);
    for (const lines of [TOUCH_TEXT.tutorialMonster, TOUCH_TEXT.tutorialMonsterCustom]) {
      expect(lines[1]).toContain('조준 스틱은 짧게 누르면 보는 방향으로 공격');
      expect(lines[1]).toContain('끌어 놓으면 그쪽으로');
      expect(lines[1]).toContain('되돌리면 취소');
    }
  });

  it("괴물 '누르면 바로': 둘째 줄만 공격 버튼 줄로 바뀐다 (그림 번호 2 = 같은 자리), 바꾼 배치에는 자리 말이 없다", () => {
    const plain = tutorialLines('monster', false, 'instant');
    const custom = tutorialLines('monster', true, 'instant');
    expect(plain).toHaveLength(4);
    expect(custom).toHaveLength(4);
    expect(plain[1]).toBe(TOUCH_TEXT.tutorialAttackInstant);
    expect(custom[1]).toBe(TOUCH_TEXT.tutorialAttackInstantCustom);
    for (const i of [0, 2, 3]) {
      expect(plain[i]).toBe(TOUCH_TEXT.tutorialMonster[i]);
      expect(custom[i]).toBe(TOUCH_TEXT.tutorialMonsterCustom[i]);
    }
    for (const line of [plain[1]!, custom[1]!]) {
      expect(line).toContain('누르면 바로');
      for (const word of ['끌어', '놓으면', '취소', '조준 스틱']) expect(line, word).not.toContain(word);
    }
    expect(plain[1]).toContain('오른쪽');
    expect(custom[1]).not.toMatch(/오른쪽|왼쪽|위|아래/);
    // 원본을 고치지 않는다
    expect(TOUCH_TEXT.tutorialMonster[1]).toContain('조준 스틱');
  });
});

describe('설정 조작 탭 문구', () => {
  it("'공격 버튼' · '끌어서 조준' · '누르면 바로', 안내는 해요체로 두 방식과 '다음 판부터 적용돼요'", () => {
    expect(SETTINGS_TEXT.attackButton).toBe('공격 버튼');
    expect(SETTINGS_TEXT.attackButtonDrag).toBe('끌어서 조준');
    expect(SETTINGS_TEXT.attackButtonInstant).toBe('누르면 바로');
    const hint = SETTINGS_TEXT.attackButtonHint;
    expect(hint).toContain(SETTINGS_TEXT.attackButtonDrag);
    expect(hint).toContain(SETTINGS_TEXT.attackButtonInstant);
    expect(hint).toContain('짧게 누르면 보는 방향');
    expect(hint).toContain('다음 판부터 적용돼요');
    // 게임 문구는 '단추'가 아니라 '버튼'
    for (const t of [hint, ...CONTROLS_TOUCH_INSTANT, TOUCH_TEXT.tutorialAttackInstant])
      expect(t).not.toContain('단추');
  });
});
