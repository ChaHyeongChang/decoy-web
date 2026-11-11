// 입체감 나눠 받는 조각 'depth' (VISUAL_SPEC 14장): 그리는 코드(depthLayer) · 맵 계산(art/depthGeom). 첫 묶음에는 받는 쪽
// (render/depthLoader.ts)만 남는다 — 품질 높음 · 중간의 WebGL에서 설정이 켜져 있을 때 판 밖 쉬는 시간에 받는다
export { DepthLayer } from './depthLayer';
export { DEPTH, DEPTH_LOOKS, lanternWarm, objectiveDisks } from '../art/depthGeom';
