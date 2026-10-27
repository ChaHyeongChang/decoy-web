// 의상 그림 묶음 (판 밖 메타 c): 의상 그림 모듈을 모아 등록한다. 나눠 받는 묶음 — 판에 의상이 나오거나 옷장 · 로비 미리보기를
// 열 때 불러온다(costume/registry.ts가 첫 화면 묶음에 남는 작은 등록부).
import { CAPE_ART } from './cape';
import { CHAINS_ART } from './chains';
import { FEATHERS_ART } from './feathers';
import { HOOD_ART } from './hood';
import { PACK_ART } from './pack';
import { registerCostumeArt } from './registry';
import { SCARF_ART } from './scarf';

export const SURVIVOR_COSTUME_ART = [SCARF_ART, PACK_ART, CAPE_ART] as const;
export const MONSTER_COSTUME_ART = [HOOD_ART, FEATHERS_ART, CHAINS_ART] as const;

/** 의상 그림을 등록한다 (여러 번 불러도 같다) */
export function registerAllCostumeArt(): void {
  registerCostumeArt(SURVIVOR_COSTUME_ART, MONSTER_COSTUME_ART);
}
