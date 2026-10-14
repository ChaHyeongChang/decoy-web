// scout 새 캐릭터 (캐릭터 리디자인) — 자리 잡기용 임시 그림. 실제 디자인으로 바꾼다.
import { OUTLINE, ROLE } from '../palette';
import { Sketch, path, solid, type Drawing } from './kit';
import { domePaint, frontClothPaint, frontTorsoPath, inkFor, topArm, topRig, topShoe, topTorsoPath } from './survivorBase';
import type { ArtOptions, FrontPose, SurvivorArt, SurvivorPose } from './types';

const BASE = ROLE.scout;

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const r = topRig(p);
  for (const [fx, fy] of r.feet) topShoe(sk, fx + r.ox, fy, 0x253041, 0x0f151d, ink);
  sk.part(topTorsoPath(r), domePaint(BASE, ink), ink(OUTLINE));
  topArm(sk, r, 0, BASE, 0x2b3646, ink);
  topArm(sk, r, 1, BASE, 0x2b3646, ink);
  sk.part(path().circle(r.head[0], r.head[1], r.headR).d, domePaint(BASE, ink, 0.6), ink(OUTLINE));
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  sk.part(frontTorsoPath(0), frontClothPaint(BASE, ink), ink(OUTLINE));
  sk.part(path().circle(0, -0.4, 0.37).d, solid(ink(BASE)), ink(OUTLINE));
  return sk.drawing();
}

export const SCOUT_ART: SurvivorArt = { id: 'scout', top, front, topExtent: 1.1 };
