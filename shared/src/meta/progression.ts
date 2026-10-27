// 판 밖 성장 · 보상 수치 (config/progression.json)의 타입과 검증. 규칙 · 판정 수치(balance.json)와 따로 둔다:
// 꾸미기 보상뿐이라 판 안에는 영향이 없다(GAME_DESIGN 12장). 서버(평가)와 클라이언트(보상 · 저장)가 빌드에 넣은 같은 파일을 쓴다
import { MONSTER_EMBLEMS, SURVIVOR_EMBLEMS, type EmblemId, type RatingStatId, type Team } from '../types';
import progressionJson from '../../../config/progression.json';

export interface EmblemDef {
  team: Team;
  name: string;
  desc: string;
  /** 점수 = Σ 가중치 × 판 기록 수치 */
  weights: Partial<Record<RatingStatId, number>>;
  /** 등급 1~4의 최소 점수 (오름차순 넷) */
  tiers: [number, number, number, number];
}

export interface Progression {
  version: number;
  /** 등급 이름 (0 없음 · 1 동 · 2 은 · 3 금 · 4 빛) */
  tierNames: [string, string, string, string, string];
  emblems: Record<EmblemId, EmblemDef>;
  xp: {
    /** 판을 끝까지 하면 */
    base: number;
    /** 평가 등급 1마다 */
    perTier: number;
    /** 이긴 팀 */
    win: number;
    /** 무효 판은 이 배율 (승리 보너스 없음) */
    voidScale: number;
  };
  /** 레벨 L → L+1 필요 경험치 = min(first + step × (L-1), cap). max 레벨에서 멈춘다 */
  level: { first: number; step: number; cap: number; max: number };
}

const STAT_IDS: readonly RatingStatId[] = [
  'captureSec',
  'exitSec',
  'rescues',
  'freed',
  'rescueSec',
  'escaped',
  'surviveRatio',
  'cleanEscape',
  'imprisons',
  'died',
  'hitsTaken',
  'chaseSec',
  'evades',
  'abilityUses',
  'abilityGood',
  'hits',
  'jails',
  'kills',
  'seeSec',
  'finds',
  'roarFinds',
  'blockSec',
  'pointStops',
  'pointsLeft',
  'zoneHits',
  'kept',
  'exitStops',
  'exitHoldSec',
];

export function isRatingStatId(v: unknown): v is RatingStatId {
  return typeof v === 'string' && (STAT_IDS as readonly string[]).includes(v);
}

function fail(path: string, why: string): never {
  throw new Error(`progression.json ${path}: ${why}`);
}

function num(v: unknown, path: string, min = -Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(path, `수가 아니거나 ${min}보다 작다`);
  return v;
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, '객체가 아니다');
  return v as Record<string, unknown>;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, '빈 글자이거나 글자가 아니다');
  return v;
}

function validateEmblem(id: EmblemId, raw: unknown, team: Team): EmblemDef {
  const o = obj(raw, `emblems.${id}`);
  if (o.team !== team) fail(`emblems.${id}.team`, `${team}이어야 한다`);
  const weights: Partial<Record<RatingStatId, number>> = {};
  const w = obj(o.weights, `emblems.${id}.weights`);
  if (Object.keys(w).length === 0) fail(`emblems.${id}.weights`, '비었다');
  for (const [k, v] of Object.entries(w)) {
    if (!isRatingStatId(k)) fail(`emblems.${id}.weights.${k}`, '모르는 판 기록 수치');
    weights[k] = num(v, `emblems.${id}.weights.${k}`);
  }
  const t = o.tiers;
  if (!Array.isArray(t) || t.length !== 4) fail(`emblems.${id}.tiers`, '수 넷이어야 한다');
  const tiers = t.map((v, i) => num(v, `emblems.${id}.tiers[${i}]`, 0)) as EmblemDef['tiers'];
  for (let i = 1; i < 4; i += 1) {
    if (tiers[i]! <= tiers[i - 1]!) fail(`emblems.${id}.tiers`, '오름차순이어야 한다');
  }
  if (tiers[0] <= 0) fail(`emblems.${id}.tiers[0]`, '0보다 커야 한다 (0점은 등급 없음)');
  return {
    team,
    name: str(o.name, `emblems.${id}.name`),
    desc: str(o.desc, `emblems.${id}.desc`),
    weights,
    tiers,
  };
}

/** 읽은 JSON을 검증한다 (틀리면 어디가 틀렸는지 예외) */
export function validateProgression(raw: unknown): Progression {
  const o = obj(raw, '(최상위)');
  const version = num(o.version, 'version', 1);
  const tn = o.tierNames;
  if (!Array.isArray(tn) || tn.length !== 5) fail('tierNames', '이름 다섯이어야 한다');
  const tierNames = tn.map((v, i) => str(v, `tierNames[${i}]`)) as Progression['tierNames'];
  const e = obj(o.emblems, 'emblems');
  const emblems = {} as Record<EmblemId, EmblemDef>;
  for (const id of SURVIVOR_EMBLEMS) emblems[id] = validateEmblem(id, e[id], 'survivor');
  for (const id of MONSTER_EMBLEMS) emblems[id] = validateEmblem(id, e[id], 'monster');
  for (const k of Object.keys(e)) {
    if (!(k in emblems)) fail(`emblems.${k}`, '모르는 평가 항목');
  }
  const x = obj(o.xp, 'xp');
  const xp = {
    base: num(x.base, 'xp.base', 0),
    perTier: num(x.perTier, 'xp.perTier', 0),
    win: num(x.win, 'xp.win', 0),
    voidScale: num(x.voidScale, 'xp.voidScale', 0),
  };
  if (xp.voidScale > 1) fail('xp.voidScale', '1 이하여야 한다');
  const l = obj(o.level, 'level');
  const level = {
    first: num(l.first, 'level.first', 1),
    step: num(l.step, 'level.step', 0),
    cap: num(l.cap, 'level.cap', 1),
    max: num(l.max, 'level.max', 2),
  };
  if (level.cap < level.first) fail('level.cap', 'first 이상이어야 한다');
  if (!Number.isInteger(level.max)) fail('level.max', '정수여야 한다');
  return { version, tierNames, emblems, xp, level };
}

/** 빌드에 넣은 수치 (서버 · 클라이언트 같은 파일) */
export const PROGRESSION: Progression = validateProgression(progressionJson);
