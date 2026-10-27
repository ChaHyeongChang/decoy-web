// 의상 시안 그림 (판 밖 메타 c, 브라우저 쪽): 의상마다 정면 · 위(옆으로 걷기) · 실제 크기 시트, 내 화면 · 동료 화면 · 괴물 화면
// 비교, 걷기 GIF 프레임. scripts/char-art.mjs의 costumes · costume-gifs 명령이 esbuild로 묶어 Chromium에서 부른다.
// 게임 코드는 바꾸지 않는다 (의상 그림 모듈을 등록만 한다).
import { MONSTER_COSTUMES, SURVIVOR_COSTUMES, validateBalance } from '@decoy/shared';
import balanceJson from '../../config/balance.json';
import { ANIM } from '../../client/src/art/anim';
import { registerAllCostumeArt } from '../../client/src/art/chars/costume/art';
import type { CharId, RoleCharId } from '../../client/src/art/chars/types';
import {
  BG,
  DEVICES,
  NAMES,
  R_TILES,
  TEXT_COLOR,
  backingRadiusPx,
  canvas,
  deviceRow,
  floor,
  newFront,
  newTop,
  radiusPx,
  text,
  zoomCopy,
  type AnyPose,
  type Ctx,
} from './draw';

registerAllCostumeArt();

const TAU = Math.PI * 2;
const B = validateBalance(balanceJson);
const ROLES: readonly RoleCharId[] = ['runner', 'guard', 'scout'];

/** 의상 이름 · 값(불씨) · 설명 (시안 — 확정되면 storyText · progression.json으로 옮긴다) */
export const COSTUME_INFO: Record<string, { name: string; price: number; desc: string }> = {
  scarf: {
    name: '목도리',
    price: 150,
    desc: '두툼한 줄무늬 목도리. 목을 두 번 감고 긴 꼬리 하나가 등 뒤로 날린다',
  },
  pack: {
    name: '탈출 배낭',
    price: 250,
    desc: '침낭을 얹은 큰 배낭. 위에서 보면 등에 네모난 짐이 얹혀 있다 (스카우트는 원래 배낭 대신)',
  },
  cape: {
    name: '망토',
    price: 400,
    desc: '어깨를 덮고 등까지 내려오는 짧은 망토. 목 앞 걸쇠, 걸으면 아랫단이 흔들린다',
  },
  hood: {
    name: '긴 고깔',
    price: 150,
    desc: '끝이 길게 굽은 고깔 두건. 위에서 보면 두건 끝이 망토 위로 흘러내린다',
  },
  feathers: {
    name: '까마귀 깃',
    price: 250,
    desc: '어깨를 덮는 검은 깃털 목도리 망토. 가장자리가 둥근 깃으로 겹친다 (가시처럼 보이지 않게)',
  },
  chains: {
    name: '사슬',
    price: 400,
    desc: '목에 쇠고리, 등을 가로지르는 사슬, 손목에 끊어진 족쇄. 걸으면 사슬 끝이 끌린다',
  },
};

function teamOfCostume(id: string): 'survivor' | 'monster' {
  return (MONSTER_COSTUMES as readonly string[]).includes(id) ? 'monster' : 'survivor';
}

function panel(ctx: Ctx, x: number, y: number, w: number, h: number, label?: string): void {
  ctx.fillStyle = '#0f1b27';
  ctx.fillRect(x, y, w, h);
  if (label) text(ctx, label, x + 14, y + 24, 14, '#94a3b8', 700);
}

/** 판정 원 점선 */
function hitCircle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.save();
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = 'rgba(148,163,184,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** 걷기 위상 (실제 빠르기로 t초 걸었을 때) */
function walkAt(t: number, id: CharId): number {
  const v = id === 'monster' ? B.monster.moveSpeed : B.survivor.moveSpeed;
  return ((TAU * v * t) / ANIM.strideTiles) % TAU;
}

function cloakAt(t: number, moving: boolean): number {
  return ((TAU * t) / (moving ? ANIM.cloakWalkPeriodS : ANIM.cloakIdlePeriodS)) % TAU;
}

/** 한 캐릭터 줄: 정면 기본 · 정면 의상 · 상반신 · 위 큰 그림 · 옆으로 걷기 넷 · 휴대폰 실제 크기 */
function row(ctx: Ctx, c: HTMLCanvasElement, id: CharId, costume: string, y: number, h: number): void {
  const col = TEXT_COLOR[id];
  const isM = id === 'monster';
  text(ctx, NAMES[id], 36, y + 26, 22, col, 800);
  // 정면: 기본 · 의상
  panel(ctx, 36, y + 38, 250, h - 50, '기본');
  newFront(ctx, id, { t: 0.4 }, 161, y + 38 + (h - 50) / 2 + 6, 210, 3.5);
  panel(ctx, 292, y + 38, 250, h - 50, COSTUME_INFO[costume]?.name);
  newFront(ctx, id, { t: 0.4, costume }, 417, y + 38 + (h - 50) / 2 + 6, 210, 3.5);
  // 상반신 (로비 카드 · 결과 화면 크기 96 · 64px)
  panel(ctx, 548, y + 38, 150, h - 50, '상반신');
  newFront(ctx, id, { bust: true, costume }, 623, y + 120, 96, 2.4);
  newFront(ctx, id, { bust: true, costume }, 623, y + 210, 64, 2);
  // 위에서 본 큰 그림 (위쪽 = 바라보는 방향)
  const tx = 704;
  const tw = 260;
  floor(ctx, tx, y + 38, tw, h - 50, 64);
  text(ctx, '위 (게임 화면, 위쪽 = 앞)', tx + 12, y + 60, 13, '#e2e8f0', 700);
  const rBig = isM ? 88 : 80;
  const cx = tx + tw / 2;
  const cy = y + 38 + (h - 50) / 2 + 12;
  newTop(ctx, id, { costume, ...(isM ? { cloak: 1.2 } : {}) }, cx, cy, rBig, -Math.PI / 2);
  hitCircle(ctx, cx, cy, rBig);
  // 옆으로 걷기: 오른쪽을 보고 걷는 위 그림 네 자세
  const wx = 972;
  const ww = 440;
  floor(ctx, wx, y + 38, ww, h - 50, 64);
  text(ctx, '옆으로 걷기 (오른쪽으로, 위에서 본 그림)', wx + 12, y + 60, 13, '#e2e8f0', 700);
  const rw = isM ? 46 : 44;
  for (let i = 0; i < 4; i += 1) {
    const walk = (i * Math.PI) / 2 + Math.PI / 4;
    const pose: AnyPose = isM
      ? { walk, stride: 1, cloak: walk * 1.4, costume }
      : { walk, stride: 1, costume };
    newTop(ctx, id, pose, wx + 60 + i * 106, y + 38 + (h - 50) / 2 + 14, rw, 0);
  }
  // 휴대폰 실제 크기 (품질 '높음' 조건) 세 방향 + 3배 최근접 확대
  const px = 1418;
  panel(ctx, px, y + 38, 346, h - 50, '휴대폰 실제 크기 · 3배 확대');
  const dev = DEVICES.phone2;
  const dirs = [-Math.PI / 2, 0, Math.PI * 0.75];
  const rr = deviceRow(
    ctx,
    px + 12,
    y + 76,
    dev,
    dirs.map((rot) => ({ id, rot, pose: { costume } })),
  );
  zoomCopy(ctx, c, px + 12, y + 76, rr.w, rr.h, px + 12, y + 86 + rr.h, 3);
}

/** 의상 시트 하나 (생존자: 세 역할 줄, 괴물: 한 줄 + 동작) */
export function costumeSheet(costume: string): string {
  const team = teamOfCostume(costume);
  const ids: CharId[] = team === 'monster' ? ['monster'] : [...ROLES];
  const rowH = 330;
  const W = 1800;
  const H = 150 + ids.length * (rowH + 16) + (team === 'monster' ? 280 : 0);
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const info = COSTUME_INFO[costume];
  text(
    ctx,
    `${info?.name ?? costume} — ${team === 'monster' ? '괴물' : '생존자'} 의상 · ${info?.price ?? 0} 불씨`,
    36,
    62,
    40,
    '#f8fafc',
    800,
  );
  text(ctx, info?.desc ?? '', 36, 100, 18, '#cbd5e1', 500);
  text(
    ctx,
    team === 'monster'
      ? '괴물 의상은 모두에게 보인다. 판정 원 · 크기 · 빠르기 · 소리는 기본과 같다'
      : '내 화면과 동료(생존자) 화면에만 보인다. 괴물 화면에서는 기본 흰 모양 그대로. 판정 원 · 크기 · 빠르기 · 소리는 기본과 같다',
    36,
    128,
    15,
    '#94a3b8',
    500,
  );
  ids.forEach((id, i) => row(ctx, c, id, costume, 150 + i * (rowH + 16), rowH));
  if (team === 'monster') {
    // 동작 (공격 준비 · 타격 · 돌진 · 포효 · 기절) — 발톱 · 눈이 의상에 묻히지 않는지
    const y = 150 + rowH + 16;
    floor(ctx, 36, y, W - 72, 260, 64);
    text(ctx, '동작 (발톱 · 눈 · 앞 단서가 의상에 묻히지 않는지)', 52, y + 26, 14, '#e2e8f0', 700);
    const acts: { label: string; pose: AnyPose }[] = [
      { label: '서기', pose: {} },
      { label: '공격 준비', pose: { windup: 1 } },
      { label: '타격', pose: { strike: 1 } },
      { label: '돌진', pose: { dash: 1 } },
      { label: '포효', pose: { roar: 1 } },
      { label: '기절', pose: { stun: 1, eyes: 'stun' } },
      { label: '피격 번쩍', pose: { tone: 'flash' } },
    ];
    acts.forEach((a, i) => {
      const x = 130 + i * 240;
      newTop(ctx, 'monster', { ...a.pose, costume, cloak: 0.8 }, x, y + 135, 62, -Math.PI / 2);
      text(ctx, a.label, x, y + 240, 14, '#e2e8f0', 700, 'center');
    });
  }
  return c.toDataURL('image/png');
}

/** 생존자 · 괴물 위 그림 한 칸 (화면 비교용) */
interface Actor {
  id: CharId;
  costume?: string;
  x: number;
  y: number;
  rot: number;
  label: string;
  me?: boolean;
}

/** 화면 비교 장면의 생존자 반지름 (px) */
const SCENE_R = 46;

function scene(
  ctx: Ctx,
  x0: number,
  y0: number,
  w: number,
  h: number,
  actors: Actor[],
  title: string,
  note: string,
): void {
  const rS = SCENE_R;
  floor(ctx, x0, y0, w, h, (rS / R_TILES.survivor) * 1);
  text(ctx, title, x0 + 16, y0 + 30, 20, '#f8fafc', 800);
  text(ctx, note, x0 + 16, y0 + 54, 13, '#cbd5e1', 500);
  for (const a of actors) {
    const r = a.id === 'monster' ? (rS * R_TILES.monster) / R_TILES.survivor : rS;
    const pose: AnyPose = { walk: 1.1, stride: 0.8, ...(a.costume ? { costume: a.costume } : {}) };
    if (a.id === 'monster') Object.assign(pose, { cloak: 1.2 });
    newTop(ctx, a.id, pose, x0 + a.x, y0 + a.y, r, a.rot);
    if (a.me) {
      ctx.save();
      ctx.strokeStyle = 'rgba(248,250,252,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x0 + a.x, y0 + a.y, r * 1.45, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    text(
      ctx,
      a.label,
      x0 + a.x,
      y0 + a.y + r * 1.45 + 20,
      13,
      a.me ? '#f8fafc' : '#cbd5e1',
      a.me ? 800 : 600,
      'center',
    );
  }
}

/**
 * 내 화면 · 동료 화면 · 괴물 화면: 같은 순간을 세 사람이 본다. 생존자 셋이 다른 의상(목도리 · 배낭 · 망토), 괴물은 사슬.
 * 괴물 화면의 생존자 셋은 기본 흰 모양 그대로 (서버가 괴물에게 생존자 의상을 보내지 않는다)
 */
export function screensBoard(): string {
  const W = 1800;
  const H = 880;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  text(ctx, '같은 순간, 세 사람의 화면 — 생존자 의상은 생존자끼리만 보인다', 36, 56, 32, '#f8fafc', 800);
  text(
    ctx,
    `러너 = 목도리 · 가드 = 탈출 배낭 · 스카우트 = 망토 · 괴물 = 사슬. 보급형 휴대폰 화면의 약 ${Math.round(SCENE_R / radiusPx('survivor', DEVICES.phone2))}배로 키웠다(아래 줄이 실제 크기). 흰 테 = 나. 로비 · 결과 화면의 정면 그림은 내 의상만 보인다`,
    36,
    88,
    16,
    '#cbd5e1',
    500,
  );
  const pw = 560;
  const ph = 520;
  const top = 110;
  const pos = {
    runner: { x: 140, y: 290, rot: -0.2 },
    guard: { x: 300, y: 420, rot: -0.5 },
    scout: { x: 270, y: 170, rot: 0.3 },
    monster: { x: 460, y: 290, rot: Math.PI - 0.15 },
  } as const;
  const survivors = (me: RoleCharId | null, costumes: boolean): Actor[] =>
    ROLES.map((id) => ({
      id: costumes ? id : 'common',
      ...(costumes ? { costume: { runner: 'scarf', guard: 'pack', scout: 'cape' }[id] } : {}),
      ...pos[id],
      label: costumes
        ? `${me === id ? '나 · ' : '동료 · '}${NAMES[id]} · ${COSTUME_INFO[{ runner: 'scarf', guard: 'pack', scout: 'cape' }[id]]?.name}`
        : '생존자 (누군지 모름)',
      me: me === id,
    }));
  const monster = (me: boolean): Actor => ({
    id: 'monster',
    costume: 'chains',
    ...pos.monster,
    label: me ? '나 · 괴물 · 사슬' : '괴물 · 사슬',
    me,
  });
  scene(
    ctx,
    36,
    top,
    pw,
    ph,
    [...survivors('runner', true), monster(false)],
    '내 화면 (러너)',
    '내 목도리 + 동료 둘의 의상이 보인다',
  );
  scene(
    ctx,
    36 + pw + 24,
    top,
    pw,
    ph,
    [...survivors('guard', true), monster(false)],
    '동료 화면 (가드)',
    '내 목도리가 동료 화면에도 그대로 보인다',
  );
  scene(
    ctx,
    36 + 2 * (pw + 24),
    top,
    pw,
    ph,
    [...survivors(null, false), monster(true)],
    '괴물 화면',
    '생존자 셋은 의상과 상관없이 기본 흰 모양 — 서로 같다',
  );
  // 실제 크기 (휴대폰 360pt · 배율 2)
  const dev = DEVICES.phone2;
  const y = top + ph + 30;
  text(
    ctx,
    `실제 크기 (${dev.name}, 품질 '높음') — 왼쪽부터 내 화면 셋 · 괴물 화면 셋 · 괴물, 오른쪽 3배 확대`,
    36,
    y,
    15,
    '#94a3b8',
    700,
  );
  const cells = [
    { id: 'runner' as CharId, rot: -0.2, pose: { costume: 'scarf', walk: 1.1, stride: 0.8 } },
    { id: 'guard' as CharId, rot: -0.5, pose: { costume: 'pack', walk: 1.1, stride: 0.8 } },
    { id: 'scout' as CharId, rot: 0.3, pose: { costume: 'cape', walk: 1.1, stride: 0.8 } },
    { id: 'common' as CharId, rot: -0.2, pose: { walk: 1.1, stride: 0.8 } },
    { id: 'common' as CharId, rot: -0.5, pose: { walk: 1.1, stride: 0.8 } },
    { id: 'common' as CharId, rot: 0.3, pose: { walk: 1.1, stride: 0.8 } },
    { id: 'monster' as CharId, rot: Math.PI, pose: { costume: 'chains', cloak: 1.2 } },
  ];
  const rr = deviceRow(ctx, 36, y + 14, dev, cells);
  zoomCopy(ctx, c, 36, y + 14, rr.w, rr.h, 36 + rr.w + 30, y + 14, 3);
  // 로비 역할 카드 · 결과 화면의 정면 그림: 각자 자기 화면에서 자기 의상만 (남의 의상은 로비 · 결과에 보내지 않는다)
  const fx = 1010;
  text(ctx, '로비 역할 카드 · 결과 화면 (정면) — 각자 자기 화면에서 자기 의상만', fx, y, 15, '#94a3b8', 700);
  const fronts: { id: CharId; costume: string }[] = [
    { id: 'runner', costume: 'scarf' },
    { id: 'guard', costume: 'pack' },
    { id: 'scout', costume: 'cape' },
    { id: 'monster', costume: 'chains' },
  ];
  fronts.forEach((f, i) => {
    const x = fx + 90 + i * 190;
    panel(ctx, x - 85, y + 14, 170, 170);
    // 로비 카드처럼 칸 밖은 자른다 (상반신 그림은 아래가 칸에 잘리게 그린다)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 85, y + 14, 170, 170);
    ctx.clip();
    newFront(ctx, f.id, { bust: true, costume: f.costume }, x, y + 99, 160, 3);
    ctx.restore();
  });
  void backingRadiusPx;
  return c.toDataURL('image/png');
}

/** 걷기 GIF 프레임: 위 줄 = 정면 (숨쉬기 · 바람), 아래 줄 = 위 그림이 오른쪽으로 걷기 (실제 빠르기) */
export function walkFrames(costume: string, fps: number, from: number, count: number): string[] {
  const team = teamOfCostume(costume);
  const ids: CharId[] = team === 'monster' ? ['monster'] : [...ROLES];
  const colW = 300;
  const W = Math.max(600, ids.length * colW + 40);
  const H = 560;
  const out: string[] = [];
  for (let f = from; f < from + count; f += 1) {
    const t = f / fps;
    const { c, ctx } = canvas(W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    text(
      ctx,
      `${COSTUME_INFO[costume]?.name ?? costume} — 정면 (로비 · 결과) / 위에서 본 걷기 (게임 화면)`,
      20,
      30,
      16,
      '#f8fafc',
      800,
    );
    floor(ctx, 20, 300, W - 40, 240, 64);
    ids.forEach((id, i) => {
      const x = 20 + colW / 2 + i * colW + (W - 40 - ids.length * colW) / 2;
      newFront(ctx, id, { t, costume }, x, 170, 240, 3.5);
      const isM = id === 'monster';
      const pose: AnyPose = isM
        ? { walk: walkAt(t, id), stride: 1, cloak: cloakAt(t, true), costume }
        : { walk: walkAt(t, id), stride: 1, costume };
      newTop(ctx, id, pose, x, 420, isM ? 64 : 60, 0);
    });
    out.push(c.toDataURL('image/png'));
  }
  return out;
}

export function costumeList(): { id: string; team: string }[] {
  return [
    ...SURVIVOR_COSTUMES.filter((k) => k !== 'basic').map((id) => ({ id, team: 'survivor' })),
    ...MONSTER_COSTUMES.filter((k) => k !== 'basic').map((id) => ({ id, team: 'monster' })),
  ];
}

export async function loadFont(dataUrl: string): Promise<void> {
  for (const weight of ['400', '500', '700', '800']) {
    const f = new FontFace('Noto Sans KR', `url(${dataUrl})`, { weight });
    await f.load();
    document.fonts.add(f);
  }
}

declare global {
  interface Window {
    CHAR_COSTUME: unknown;
  }
}

window.CHAR_COSTUME = { loadFont, costumeSheet, screensBoard, walkFrames, costumeList };
