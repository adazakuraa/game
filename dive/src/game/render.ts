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
  /** longest the dive's black screen waits for shaders to compile (ms) */
  warmMaxMs: 2500,
};

/** 【影を落とすもの】§6.3-①: only what is near casts a sun shadow */
export const SHADOW = {
  /** half width (m) of the square the sun's shadow camera covers */
  half: 15,
  /** flora cells closer than this cast */
  floraDist: 30,
  /** creatures at least this long (m) ... */
  creatureSize: 0.6,
  /** ... with an individual closer than this cast */
  creatureDist: 20,
};

/** 【植生の遠景】§6.3-②: scatter cells and the distance where the coarse geometry takes over */
export const FLORA_LOD = { maxCell: 35, farDist: 25 };

/** 【小物の表示距離】§6.3-④: chests, finds and request boxes beyond this are not drawn */
export const PROP_VIEW = 60;

/** 【生成済みの種】§6.3-⑥: meshes kept at once, and how long a species must have been away to be dropped */
export const KEEP = { species: 120, idleSec: 90 };

/** 【遠い個体の間引き】§6.3-⑦: beyond `mid` every 2nd frame, beyond `far` every 4th (time is accumulated) */
export const THIN = { mid: 25, far: 45, maxDt: 0.2 };

/**
 * 【生き物の LOD】§1.1: level by the body's height on screen (px at the highest resolution of the device):
 * L0 from `l0` up, L1 between, L2 (atlas card) below `l2`. Going down needs `hyst` less (102 / 20 px).
 */
export const LOD = { l0: 120, l2: 24, hyst: 0.15 };

/** 【遠景のカード】§1.3: the shared atlas (cells of 128×64), cells drawn per frame, first capacity, card margin */
export const IMPOSTOR = { atlasW: 2048, atlasH: 1024, cols: 16, rows: 16, supersample: 2, perFrame: 4, capacity: 1024, margin: 0.05, gain: 1.25 };
