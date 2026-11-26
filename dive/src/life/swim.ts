import type { SpeciesDef } from './species';

/**
 * 泳ぎ v2（PHASE8-DESIGN §4.2）：背骨の線で曲げるうねりの型と調整値。
 * 振幅の分布 A(s) は s＝0 頭 … 1 尾（体長比）。シェーダには A(1)＝1 に正規化した係数と、尾の振幅を別に渡す。
 */
export type SwimMode = 'anguilliform' | 'subcarangiform' | 'carangiform' | 'thunniform' | 'labriform';

type ModeDef = {
  /** A(q) = a0 + a1 q + a2 q²、q = max(0, (s − s0) / (1 − s0))（設計の表の係数そのまま） */
  a: [number, number, number];
  s0: number;
  /** 波長（体長比） */
  lambda: number;
  /** 尾の片振幅（体長比） */
  tail: number;
  /** 胸びれの羽ばたきの強さ（体長比。胸びれ型が主、他は 0.3 倍） */
  flap: number;
};

export const SWIM_MODES: Record<SwimMode, ModeDef> = {
  anguilliform: { a: [0.04, 0.04, 0], s0: 0, lambda: 0.6, tail: 0.08, flap: 0.012 },
  subcarangiform: { a: [0.02, -0.08, 0.16], s0: 0, lambda: 1.0, tail: 0.1, flap: 0.012 },
  carangiform: { a: [0.01, -0.05, 0.14], s0: 0, lambda: 1.1, tail: 0.09, flap: 0.012 },
  // 尾柄から後ろだけ（s > 0.75）。前は 0.05 倍でほぼ動かない
  thunniform: { a: [0.05, 0, 0.95], s0: 0.75, lambda: 1.2, tail: 0.08, flap: 0.012 },
  // 体はほぼ止める（0.01）。胸びれの羽ばたきが主
  labriform: { a: [0.01, 0, 0.01], s0: 0, lambda: 1.0, tail: 0.02, flap: 0.04 },
};

/** 個体ごとの泳ぎの調整値（目視で決めた最終値。§10.3） */
export const SWIM = {
  /** 尾の振りの周波数の範囲（Hz）。小魚の実際の 10Hz 超は震えに見えるため 4Hz で頭打ち（BH） */
  fMin: 0.6,
  fMax: 4,
  /** 1 回の振りで進む距離（体長比）：f = f0 + U / (stride·L) */
  stride: 0.7,
  /** 速さによる振幅の倍率 ampK の範囲 */
  ampLo: 0.6,
  ampHi: 1.0,
  /** 「振って→滑る」：滑空の長さ（秒）と滑空中の ampK、振る長さ（秒） */
  glide: [0.4, 1.2] as [number, number],
  glideAmp: 0.15,
  beat: [0.6, 1.6] as [number, number],
  /** 止まり気味とみなす速さ（m/s、def.speed に対する割合と下限） */
  slowK: 0.3,
  slowMin: 0.05,
  /** 向きの変化率（rad/s）の頭打ちと、C 字の曲げの強さ κ（体長比 / (rad/s)） */
  turnMax: 2,
  kappa: 0.07,
  /** 逃げ始めの C スタート：秒数と曲げ・振幅の強め */
  cStart: 0.2,
  cStartTurn: 2.5,
  cStartAmp: 1.25,
  /** 型の表の振幅に掛ける全体の倍率（目視で調整：表の値そのままでは尾が大きく振れすぎて見えた） */
  ampScale: 0.8,
  /** 写真魚は板に近いので尾の振幅を下げる */
  photoTail: 0.8,
  /** def.swim の振幅（旧値）を倍率に読み替えるときの基準（F() の既定値）と範囲 */
  ampRef: [0.05, 0.04] as [number, number],
  ampMul: [0.3, 1.6] as [number, number],
};

/** S3 の試験（5 体型だけ）から全体型へ広げるスイッチ */
const SWIM_V2_ALL = false;

const ANGUILLA = /ウツボ|アナゴ|ウナギ|ハモ|ヤガラ|ダツ|ギンポ|ヌタウナギ|ラブカ/;
const THUNNUS = /マグロ|カツオ|サワラ|サバ|カジキ|サメ|ザメ|ブカ$/;
const CARANX = /アジ|カマス|ブリ|カンパチ|ヒラマサ|ツムブリ|シイラ|イワシ|ニシン|サヨリ|トビウオ/;
const LABRUS = /ベラ|ブダイ|フグ|ハリセンボン|ハギ|モンガラ|ハコ|マンボウ/;

/**
 * 泳ぎ方の型。体型テンプレートに書いた `fish.swimMode` が優先、なければ kind・体型・名前から推定。
 * null は旧来の動き（魚以外、縦に振る海の哺乳類 `bendY`、砂から出るチンアナゴ）。
 */
export function swimModeOf(def: SpeciesDef): SwimMode | null {
  if (def.kind !== 'fish' || !def.fish) return null;
  const f = def.fish;
  if (f.bendY || f.tail === 'flukes') return null;
  if (f.swimMode) return f.swimMode;
  if (!SWIM_V2_ALL) return null;
  if (ANGUILLA.test(def.name)) return 'anguilliform';
  if (f.tail === 'none' || (f.H <= 0.1 && f.W <= 0.1)) return 'anguilliform';
  if (THUNNUS.test(def.name) || f.tail === 'hetero') return 'thunniform';
  if (LABRUS.test(def.name)) return 'labriform';
  if (CARANX.test(def.name)) return 'carangiform';
  if (f.tail === 'lunate' && (f.ped ?? 0.1) <= 0.05) return 'thunniform';
  return 'subcarangiform';
}

/** シェーダの uniform 用：A(1)＝1 に正規化した係数 */
export function swimUniforms(mode: SwimMode, def: SpeciesDef, photo: boolean) {
  const m = SWIM_MODES[mode];
  const a1 = m.a[0] + m.a[1] + m.a[2];
  const sw = def.swim;
  const ref = def.size < 0.4 ? SWIM.ampRef[0] : SWIM.ampRef[1];
  const mul = sw ? Math.min(SWIM.ampMul[1], Math.max(SWIM.ampMul[0], sw[1] / ref)) : 1;
  return {
    a: [m.a[0] / a1, m.a[1] / a1, m.a[2] / a1, m.s0] as [number, number, number, number],
    k: (2 * Math.PI) / m.lambda,
    tail: m.tail * SWIM.ampScale * mul * (photo ? SWIM.photoTail : 1),
    flap: m.flap,
  };
}

/** 周波数の下限 f0（Hz）：def.swim の周波数（rad/s）を読み替える。なければ F() の既定と同じ式 */
export function swimF0(def: SpeciesDef): number {
  const w = def.swim ? def.swim[0] : Math.max(0.8, 5.5 - def.size * 4);
  return w / (2 * Math.PI);
}

/** 個体の速さ U（m/s）と体長 L（m）からの周波数（Hz） */
export function swimFreq(f0: number, U: number, L: number): number {
  return Math.min(SWIM.fMax, Math.max(SWIM.fMin, f0 + U / (SWIM.stride * Math.max(0.02, L))));
}
