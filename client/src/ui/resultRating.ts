// 결과 화면 '내 평가' (GAME_DESIGN 12장, VISUAL_SPEC 9.6): 평가 넷(모양 아이콘 + 단계 칸 + 단계 글자) · 경험치 · 레벨 막대 · 레벨 업.
// 결과 화면 묶음(나눠 받는 `result` 조각)에만 들어 있다 — 첫 화면에는 필요 없다. 받는 사람 자기 평가만 그린다(서버도 자기 것만 보낸다).
// 단계는 색만으로 구분하지 않는다: 칸 수(0~4) + 글자(없음 · 동 · 은 · 금 · 빛) + 테두리 색
import type { EmblemId, EmblemTier } from '@decoy/shared';
import type { LevelInfo } from '@decoy/shared/meta';
import { META_TEXT } from '../data/storyText';
import type { RatingApplied } from '../meta/meta';
import { h } from './uiArt';

function fill(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? ''));
}

/**
 * 평가 아이콘 (24 격자 · 2px 선, art/icons.ts와 같은 문법). 모양이 항목마다 다르다:
 * 점령 = 거점 링 + 깃발, 구조 = 열린 자물쇠, 생존 = 문 + 나가는 화살, 회피 = 지그재그 발자국 길,
 * 사냥 = 발톱 셋, 저지 = 막는 방패 + 가로대, 추적 = 눈, 문지기 = 철창 문
 */
const EMBLEM_PATHS: Record<EmblemId, string> = {
  capture: 'M5 19a7 3 0 1 0 14 0a7 3 0 1 0 -14 0M12 19V4M12 4l6 3l-6 3',
  rescue: 'M7 11V8a5 5 0 0 1 9.6-2M5 11h14v9H5zM12 14v3',
  survive: 'M4 20V4h9v16M13 12h7M17 9l3 3l-3 3M9 12h.01',
  evade: 'M4 18l4-4l3 3l4-6l5 3M15 5h5v5',
  hunt: 'M6 4c3 4 3 10 1 16M12 3c2 5 2 11 0 17M18 4c-3 4-3 10-1 16',
  deny: 'M12 3l7 3v6c0 4-3 7-7 9c-4-2-7-5-7-9V6zM8 12h8',
  track: 'M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7s-7-2-10-7zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  gate: 'M4 21V8a8 5 0 0 1 16 0v13M4 21h16M8 9v12M12 7v14M16 9v12',
};

function emblemSvg(id: EmblemId): string {
  return (
    `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">` +
    `<path d="${EMBLEM_PATHS[id]}" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

/** 단계 칸 넷 (채운 칸 = 단계) */
function pips(tier: EmblemTier): HTMLElement {
  const box = h('span', { class: 'rate-pips', 'aria-hidden': 'true' });
  for (let i = 1; i <= 4; i += 1) box.append(h('span', { class: i <= tier ? 'pip on' : 'pip' }));
  return box;
}

function tile(id: EmblemId, tier: EmblemTier, best: boolean): HTMLElement {
  const text = META_TEXT.emblems[id];
  const tierName = META_TEXT.tiers[tier];
  const el = h(
    'li',
    {
      class: `rate-tile tier-${tier}`,
      'data-testid': `rate-${id}`,
      'data-tier': String(tier),
      'aria-label': fill(META_TEXT.tierAria, { name: text.name, tier: tierName, desc: text.desc }),
      title: text.desc,
    },
    h('span', { class: 'rate-badge' }),
    h('span', { class: 'rate-name' }, text.name),
    h('span', { class: 'rate-tier' }, pips(tier), h('span', { class: 'rate-tier-name' }, tierName)),
  );
  const badge = el.querySelector('.rate-badge');
  if (badge) badge.innerHTML = emblemSvg(id);
  if (best && tier > 0) el.append(h('span', { class: 'tag tag-best' }, META_TEXT.newBest));
  return el;
}

function levelBar(info: LevelInfo, fromRatio: number | null): HTMLElement {
  const ratio = info.max ? 1 : info.need > 0 ? info.into / info.need : 0;
  const bar = h('span', { class: 'xp-bar', 'aria-hidden': 'true' });
  // 이번 판 전 몫(같은 레벨일 때만)과 이번 판에 오른 몫을 다른 무늬로
  const before = fromRatio === null ? 0 : Math.min(fromRatio, ratio);
  const old = h('span', { class: 'xp-old' });
  old.style.width = `${Math.round(before * 100)}%`;
  const add = h('span', { class: 'xp-add' });
  add.style.left = `${Math.round(before * 100)}%`;
  add.style.width = `${Math.round(Math.max(0, ratio - before) * 100)}%`;
  bar.append(old, add);
  return bar;
}

/** 결과 화면 '내 평가' 패널: 항목 넷 → 레벨 막대 · 경험치(레벨 업) → 경험치 나눔 → 안내 */
export function ratingPanel(applied: RatingApplied): HTMLElement {
  const { rating, gain, saved } = applied;
  const list = h('ul', { class: 'rate-list' });
  for (const e of rating.emblems) list.append(tile(e.id, e.tier, gain?.newBest.includes(e.id) ?? false));
  const panel = h(
    'section',
    { class: 'rating cut', 'data-testid': 'rating', 'aria-label': META_TEXT.ratingTitle },
    h('div', { class: 'rate-title' }, META_TEXT.ratingTitle),
    list,
  );
  if (gain) {
    const leveled = gain.after.level > gain.before.level;
    const fromRatio = leveled || gain.before.need === 0 ? null : gain.before.into / gain.before.need;
    const parts = fill(META_TEXT.xpParts, { base: gain.xp.base, tiers: gain.xp.tiers, win: gain.xp.win });
    panel.append(
      h(
        'div',
        { class: 'xp-row' },
        h(
          'span',
          { class: 'xp-level num', 'data-testid': 'xp-level' },
          `${META_TEXT.levelShort} ${gain.after.level}`,
        ),
        levelBar(gain.after, fromRatio),
        h(
          'span',
          { class: 'chip xp-chip num', 'data-testid': 'xp-gain', title: parts },
          fill(META_TEXT.xpGain, { n: gain.xp.total }),
        ),
        ...(leveled
          ? [
              h(
                'span',
                { class: 'tag level-up', 'data-testid': 'level-up', role: 'status' },
                fill(META_TEXT.levelUp, { level: gain.after.level }),
              ),
            ]
          : []),
      ),
      h('div', { class: 'xp-parts' }, parts),
    );
    if (rating.outcome === 'void') panel.append(h('div', { class: 'rate-note' }, META_TEXT.voidHalf));
  } else {
    panel.append(h('div', { class: 'rate-note', 'data-testid': 'rate-already' }, META_TEXT.alreadyGot));
  }
  if (!saved) {
    panel.append(
      h(
        'div',
        { class: 'rate-note warn', role: 'status', 'data-testid': 'rate-not-saved' },
        META_TEXT.notSaved,
      ),
    );
  }
  return panel;
}
