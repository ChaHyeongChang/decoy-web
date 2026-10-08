import type { DecoyDebug } from '@decoy/shared';

declare global {
  interface Window {
    __DECOY__?: DecoyDebug;
  }
}
