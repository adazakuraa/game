/**
 * Rendering budget of Phase 8 (docs/PHASE8-DESIGN.md §6): how many pixels are drawn and how the
 * resolution follows the frame time.
 */
export const RENDER = {
  /** 【画素数の上限】canvas pixels never exceed this */
  maxPixels: 900_000,
  /** 【画素数の下限】the adaptive resolution stops here */
  minPixels: 300_000,
  /** pixel-ratio step of one adjustment */
  step: 0.15,
  /** frames between two checks */
  checkFrames: 90,
  /** average frame time (ms) above which the resolution drops */
  slowMs: 36,
  /** average frame time (ms) below which the resolution may rise ... */
  fastMs: 24,
  /** ... after this many checks in a row */
  fastChecks: 3,
};
