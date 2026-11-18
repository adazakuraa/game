// Mountain definitions. World units are metres horizontally; vertical world
// units are compressed: displayAltitude = campAltitude + y * altScale.
// Every ridge is a polyline of [x, z, crestHeight]. Ridge 0 is the climbing route
// ridge; `route` lists the walking line from camp to summit.

export type Vec3Tuple = [number, number, number];

export interface Landmark {
  name: string;
  /** index into the route polyline */
  routeIndex: number;
  note: string;
}

export interface Crevasse {
  /** fractional route waypoint index where the crack crosses the route */
  at: number;
  width: number;
  length: number;
  /** extra rotation of the crack relative to perpendicular-to-route (radians) */
  angle?: number;
}

/** One leg of an expedition, from one camp to the next (or the summit push). */
export interface MountainDef {
  id: 'everest' | 'k2';
  stageKey: string;
  /** stage display name, e.g. クンブ・アイスフォール */
  stageName: string;
  /** end point name of this leg (next camp or summit) */
  goalName: string;
  goal: 'camp' | 'summit';
  startHours: number;
  /** oxygen: none, one bottle for this leg, or the summit-push supply chosen on the title */
  o2: 'none' | 'stage' | 'summit';
  /** approximate cloud-sea top altitude (display metres) */
  cloudAlt: number;
  valley?: boolean;
  /** ridge indices that are broad glacier plains rather than sharp ridges */
  flatRidges?: number[];
  crevasses?: Crevasse[];
  rockfallZone?: [number, number];
  seracField?: boolean;
  bandColor?: [number, number, number];
  name: string;
  subtitle: string;
  summitAltitude: number;
  campAltitude: number;
  campName: string;
  routeName: string;
  /** vertical world height between camp (y=0) and summit */
  worldHeight: number;
  faceSlope: number;
  crestWidth: number;
  floor: number;
  ridges: Vec3Tuple[][];
  route: Vec3Tuple[];
  landmarks: Landmark[];
  /** route index ranges [from, to) that carry fixed ropes */
  ropeSections: [number, number][];
  /** extra hazard tags by route index range */
  seracZone?: [number, number];
  /** rock band altitude (display metres) for the "Yellow Band" style strata */
  rockBand: [number, number];
  baseWind: number;
  seed: number;
  description: string;
  difficulty: string;
}

const SUMMIT_STAGES: Record<'everest' | 'k2', MountainDef> = {
  everest: {
    id: 'everest',
    stageKey: 'everest-summit',
    stageName: 'サミットプッシュ',
    goalName: '山頂',
    goal: 'summit',
    startHours: 3,
    o2: 'summit',
    cloudAlt: 6900,
    name: 'エベレスト',
    subtitle: 'Everest / Chomolungma',
    summitAltitude: 8849,
    campAltitude: 7950,
    campName: 'C4 サウスコル',
    routeName: '南東稜ルート',
    worldHeight: 300,
    faceSlope: 1.05,
    crestWidth: 7,
    floor: -560,
    seed: 8849,
    baseWind: 28,
    rockBand: [8280, 8560],
    difficulty: '★★★☆',
    description:
      '世界最高峰。サウスコルを深夜に出発し、三角フェース、バルコニー、南峰、ナイフリッジ、ヒラリーステップを越えて頂へ。帰りの酸素を残せるか。',
    route: [
      [520, 490, 0],
      [488, 458, 0],
      [420, 390, 30],
      [338, 315, 90],
      [265, 240, 170],
      [248, 225, 172],
      [172, 150, 225],
      [98, 90, 270],
      [48, 45, 281],
      [40, 38, 292],
      [0, 0, 300],
    ],
    landmarks: [
      { name: 'C4 サウスコル', routeIndex: 0, note: '7,950m 最終キャンプ' },
      { name: '三角フェース', routeIndex: 3, note: '急な雪壁。フィックスロープ必須' },
      { name: 'バルコニー', routeIndex: 4, note: '8,400m 小さな雪棚。ボンベ交換の定番地点' },
      { name: '南峰', routeIndex: 7, note: '8,750m 頂上が見える' },
      { name: 'コーニス・トラバース', routeIndex: 8, note: '両側が切れ落ちたナイフリッジ' },
      { name: 'ヒラリーステップ', routeIndex: 9, note: 'ほぼ垂直の岩段' },
      { name: '山頂', routeIndex: 10, note: '8,849m' },
    ],
    ropeSections: [[2, 5], [6, 10]],
    ridges: [
      // 0: SE ridge (route) continuing across the South Col to Lhotse
      [
        [0, 0, 300], [40, 38, 292], [48, 45, 281], [98, 90, 270], [172, 150, 225],
        [248, 225, 172], [265, 240, 170], [338, 315, 90], [420, 390, 30],
        [488, 458, 0], [530, 500, -2], [640, 600, 110], [750, 720, 189],
      ],
      // 1: NE ridge
      [[0, 0, 300], [-200, -150, 190], [-450, -320, 70], [-800, -560, -150], [-1300, -900, -480]],
      // 2: W ridge
      [[0, 0, 300], [-250, 120, 165], [-600, 260, -60], [-1100, 450, -420]],
      // 3: Lhotse - Nuptse wall
      [[750, 720, 189], [450, 900, 70], [100, 1000, 40], [-100, 1050, 75], [-500, 1100, -220], [-900, 1150, -480]],
      // 4: Lhotse east ridge
      [[750, 720, 189], [1150, 720, -40], [1600, 650, -420]],
      // 5: Kangshung side spur
      [[338, 315, 60], [600, 150, -120], [950, 0, -450]],
    ],
  },
  k2: {
    id: 'k2',
    stageKey: 'k2-summit',
    stageName: 'サミットプッシュ',
    goalName: '山頂',
    goal: 'summit',
    startHours: 3,
    o2: 'summit',
    cloudAlt: 6500,
    name: 'K2',
    subtitle: 'K2 / Chhogori',
    summitAltitude: 8611,
    campAltitude: 7600,
    campName: 'C4 ショルダー',
    routeName: 'アブルッツィ稜ルート',
    worldHeight: 300,
    faceSlope: 1.4,
    crestWidth: 6,
    floor: -720,
    seed: 8611,
    baseWind: 34,
    rockBand: [8000, 8150],
    difficulty: '★★★★',
    description:
      '「非情の山」。ショルダーから急峻なボトルネックのクーロワールを登り、頭上に覆い被さる巨大セラックの下をトラバースする。崩落の音を聞き逃すな。',
    route: [
      [430, 460, -3],
      [400, 430, 0],
      [330, 360, 25],
      [270, 300, 50],
      [205, 240, 135],
      [150, 250, 150],
      [110, 200, 175],
      [70, 120, 235],
      [30, 45, 280],
      [0, 0, 300],
    ],
    landmarks: [
      { name: 'C4 ショルダー', routeIndex: 0, note: '7,600m 最終キャンプ' },
      { name: 'ボトルネック', routeIndex: 3, note: '8,200m 急峻なクーロワール' },
      { name: 'トラバース', routeIndex: 4, note: 'セラック直下の危険地帯。立ち止まるな' },
      { name: '頂上雪田', routeIndex: 7, note: '深い雪のラッセル' },
      { name: '山頂', routeIndex: 9, note: '8,611m' },
    ],
    ropeSections: [[3, 7], [8, 9]],
    seracZone: [4, 6],
    ridges: [
      [
        [0, 0, 300], [30, 45, 280], [70, 120, 235], [110, 200, 175], [150, 250, 150],
        [205, 240, 135], [270, 300, 50], [330, 360, 25], [400, 430, 0], [430, 460, -3],
        [550, 600, -120], [800, 850, -450], [1100, 1150, -720],
      ],
      [[0, 0, 300], [-50, -300, 120], [-100, -700, -250], [-150, -1200, -720]],
      [[0, 0, 300], [-300, -100, 130], [-700, -200, -250], [-1200, -300, -720]],
      [[0, 0, 300], [-250, 300, 120], [-600, 650, -250], [-900, 1000, -720]],
      // Shoulder flank so the camp sits on a broad shelf
      [[330, 360, 18], [480, 330, -40], [700, 250, -300]],
    ],
  },
};

// ------------------------------------------------------------------ stage helpers
type P = Vec3Tuple;

/** Two parallel valley walls offset to either side of the route's overall direction. */
function walls(route: P[], offset: number, above: number, rise = 0): P[][] {
  const a = route[0];
  const b = route[route.length - 1];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz);
  const ux = dx / l, uz = dz / l;
  const px = -uz, pz = ux;
  const out: P[][] = [];
  for (const side of [1, -1]) {
    const w: P[] = [];
    const ext = 500;
    w.push([a[0] - ux * ext + px * offset * side, a[1] - uz * ext + pz * offset * side, a[2] + above - 120]);
    for (const p of route) w.push([p[0] + px * offset * side, p[1] + pz * offset * side, p[2] + above]);
    w.push([b[0] + ux * ext + px * offset * side, b[1] + uz * ext + pz * offset * side, b[2] + above + rise]);
    out.push(w);
  }
  return out;
}

/** Route extended past both ends (so the terrain continues beyond the leg). */
function extend(route: P[], before: P[], after: P[]): P[] {
  return [...before, ...route, ...after];
}

const EVEREST_STAGES: MountainDef[] = [
  (() => {
    const route: P[] = [
      [560, 330, 0], [500, 300, 10], [430, 250, 45], [380, 240, 80], [320, 190, 115],
      [260, 170, 150], [200, 120, 180], [150, 90, 192], [100, 70, 215], [50, 30, 228], [0, 0, 234],
    ];
    return {
      ...SUMMIT_STAGES.everest,
      stageKey: 'everest-1', stageName: 'クンブ・アイスフォール', goalName: 'C1', goal: 'camp', startHours: 4,
      o2: 'none', cloudAlt: 4700, valley: true, seracField: true,
      campAltitude: 5364, summitAltitude: 6065, campName: 'ベースキャンプ', routeName: 'クンブ氷河',
      worldHeight: 234, faceSlope: 1.15, crestWidth: 30, floor: -420, seed: 5364, baseWind: 14,
      rockBand: [9000, 9100],
      route,
      ridges: [
        extend(route, [[1400, 800, -380], [900, 520, -150]], [[-300, -150, 262], [-700, -350, 330]]),
        ...walls(route, 400, 340, 250),
      ],
      landmarks: [
        { name: 'ベースキャンプ', routeIndex: 0, note: '5,364m 遠征の出発点' },
        { name: 'ポップコーン・フィールド', routeIndex: 3, note: '崩れた氷塊が転がる迷路' },
        { name: 'フットボール・フィールド', routeIndex: 6, note: '比較的平らな休憩地点' },
        { name: 'ラダー帯', routeIndex: 8, note: 'クレバスに架かるハシゴ。必ずロープに確保' },
        { name: 'C1', routeIndex: 10, note: '6,065m ウエスタン・クームの入口' },
      ],
      ropeSections: [[2, 4], [7, 10]],
      seracZone: [3, 5],
      crevasses: [
        { at: 1.5, width: 3.6, length: 70 }, { at: 4.4, width: 4.2, length: 60, angle: 0.3 },
        { at: 7.5, width: 4.5, length: 70, angle: -0.2 }, { at: 8.6, width: 3.8, length: 60, angle: 0.25 },
      ],
      description: '崩れ続ける氷河の滝。巨大な氷塔の間を縫い、クレバスにハシゴを架けて越える。日が昇る前に抜けろ。',
      difficulty: '★★☆☆',
    };
  })(),
  (() => {
    const route: P[] = [
      [600, 60, 0], [480, 40, 15], [360, 30, 40], [240, 30, 65], [120, 15, 90], [0, 0, 112],
    ];
    return {
      ...SUMMIT_STAGES.everest,
      stageKey: 'everest-2', stageName: 'ウエスタン・クーム', goalName: 'C2', goal: 'camp', startHours: 6,
      o2: 'none', cloudAlt: 5300, valley: true,
      campAltitude: 6065, summitAltitude: 6400, campName: 'C1', routeName: 'ウエスタン・クーム',
      worldHeight: 112, faceSlope: 1.2, crestWidth: 40, floor: -300, seed: 6065, baseWind: 10,
      rockBand: [9000, 9100],
      route,
      ridges: [
        extend(route, [[1000, 120, -90], [800, 90, -30]], [[-200, -10, 140]]),
        ...walls(route, 420, 380, 0),
        // Lhotse face closing the head of the valley
        [[-300, -500, 520], [-280, 0, 480], [-300, 500, 520]],
      ],
      landmarks: [
        { name: 'C1', routeIndex: 0, note: '6,065m' },
        { name: '沈黙の谷', routeIndex: 2, note: '風のない日は灼熱の氷の谷' },
        { name: 'C2', routeIndex: 5, note: '6,400m ABC。ローツェ・フェースの麓' },
      ],
      ropeSections: [],
      crevasses: [
        { at: 1.0, width: 4.0, length: 80, angle: 0.2 }, { at: 2.6, width: 4.6, length: 90, angle: -0.25 },
        { at: 4.1, width: 3.8, length: 70 },
      ],
      description: 'ヌプツェとエベレストに挟まれた巨大な氷の谷。昼は照り返しで灼熱、隠れたクレバスが口を開ける。',
      difficulty: '★☆☆☆',
    };
  })(),
  (() => {
    const route: P[] = [
      [330, 220, 0], [290, 195, 8], [260, 175, 30], [180, 120, 105], [100, 66, 175], [40, 26, 225], [0, 0, 253],
    ];
    return {
      ...SUMMIT_STAGES.everest,
      stageKey: 'everest-3', stageName: 'ローツェ・フェース', goalName: 'C3', goal: 'camp', startHours: 5,
      o2: 'none', cloudAlt: 5600,
      campAltitude: 6400, summitAltitude: 7160, campName: 'C2', routeName: 'ローツェ・フェース',
      flatRidges: [1],
      worldHeight: 253, faceSlope: 0.95, crestWidth: 38, floor: -260, seed: 6400, baseWind: 22,
      rockBand: [6900, 7000], bandColor: [0.32, 0.3, 0.29],
      route,
      ridges: [
        extend(route, [[420, 280, -4]], [[-120, -80, 330], [-260, -170, 450]]),
        // Western Cwm floor around C2
        [[900, 400, -30], [330, 220, -6], [100, 600, -20]],
        [[-260, -170, 450], [-150, 400, 420], [-100, 900, 300]],
        [[-260, -170, 450], [200, -500, 360], [500, -900, 200]],
      ],
      landmarks: [
        { name: 'C2', routeIndex: 0, note: '6,400m' },
        { name: 'ベルクシュルント', routeIndex: 1, note: '氷河と氷壁の境の大きな裂け目' },
        { name: 'ローツェ・フェース', routeIndex: 3, note: '青く硬い氷の大斜面。落石に注意' },
        { name: 'C3', routeIndex: 6, note: '7,160m 氷壁に刻んだ狭いテント場' },
      ],
      ropeSections: [[1, 6]],
      rockfallZone: [3, 5],
      crevasses: [{ at: 1.0, width: 3.4, length: 90, angle: 0.15 }],
      description: '1,000mを超える青氷の壁。フィックスロープにユマールをかけ、ひたすら登る。頭上からの落石に注意。',
      difficulty: '★★★☆',
    };
  })(),
  (() => {
    const route: P[] = [
      [380, 120, 0], [300, 90, 40], [220, 70, 95], [150, 60, 150], [90, 40, 205], [40, 15, 250], [0, 0, 263],
    ];
    return {
      ...SUMMIT_STAGES.everest,
      stageKey: 'everest-4', stageName: 'イエローバンド', goalName: 'C4 サウスコル', goal: 'camp', startHours: 6,
      o2: 'stage', cloudAlt: 6200,
      campAltitude: 7160, summitAltitude: 7950, campName: 'C3', routeName: 'ジュネーブ・スパー経由',
      worldHeight: 263, faceSlope: 1.0, crestWidth: 22, floor: -330, seed: 7160, baseWind: 26,
      rockBand: [7400, 7650],
      route,
      ridges: [
        extend(route, [[470, 160, -40]], [[-60, -30, 0], [-300, -260, 300], [-500, -500, 500]]),
        [[-60, -30, 0], [-200, 150, 180], [-350, 330, 240]],
        [[470, 160, -40], [500, -150, 40], [600, -500, -100]],
      ],
      landmarks: [
        { name: 'C3', routeIndex: 0, note: '7,160m ここから酸素を使う' },
        { name: 'イエローバンド', routeIndex: 2, note: '黄色い石灰岩の帯。アイゼンが岩を噛む' },
        { name: 'ジュネーブ・スパー', routeIndex: 4, note: '黒い岩の稜。登り切ればサウスコル' },
        { name: 'C4 サウスコル', routeIndex: 6, note: '7,950m 最終キャンプ' },
      ],
      ropeSections: [[0, 6]],
      description: 'ローツェ・フェースを左へトラバースし、黄色い岩の帯とジュネーブ・スパーを越えて最終キャンプへ。',
      difficulty: '★★★☆',
    };
  })(),
  { ...SUMMIT_STAGES.everest },
];

const K2_STAGES: MountainDef[] = [
  (() => {
    const route: P[] = [
      [700, 250, 0], [560, 220, 5], [440, 180, 18], [380, 160, 60], [300, 125, 130], [220, 90, 195],
      [140, 55, 250], [70, 25, 290], [0, 0, 312],
    ];
    return {
      ...SUMMIT_STAGES.k2,
      stageKey: 'k2-1', stageName: 'アブルッツィ稜 下部', goalName: 'C1', goal: 'camp', startHours: 5,
      o2: 'none', cloudAlt: 4600,
      campAltitude: 5000, summitAltitude: 6050, campName: 'ベースキャンプ', routeName: 'ゴドウィン・オースティン氷河',
      flatRidges: [1],
      worldHeight: 312, faceSlope: 1.3, crestWidth: 9, floor: -260, seed: 5000, baseWind: 12,
      rockBand: [5600, 5900], bandColor: [0.36, 0.33, 0.3],
      route,
      ridges: [
        extend(route, [[900, 300, -20]], [[-80, -30, 360], [-300, -120, 700]]),
        // Glacier floor
        [[1400, 700, -60], [700, 250, -4], [480, 190, 6], [300, -400, -10], [100, -1000, -60]],
        [[-300, -120, 700], [-500, 300, 450], [-800, 700, 100]],
        [[-300, -120, 700], [100, -500, 420], [300, -900, 100]],
      ],
      landmarks: [
        { name: 'ベースキャンプ', routeIndex: 0, note: '5,000m 氷河上の遠征基地' },
        { name: 'ABC', routeIndex: 2, note: '取り付き。ここからロープが始まる' },
        { name: 'アブルッツィ稜', routeIndex: 4, note: '急な雪と岩のリブ' },
        { name: 'C1', routeIndex: 8, note: '6,050m 狭い岩棚' },
      ],
      ropeSections: [[3, 8]],
      crevasses: [{ at: 1.0, width: 3.6, length: 70, angle: 0.2 }, { at: 1.7, width: 3.2, length: 60, angle: -0.3 }],
      description: '氷河を渡り、アブルッツィ稜の取り付きへ。そこから急なリブをロープ伝いに登る。',
      difficulty: '★★☆☆',
    };
  })(),
  (() => {
    const route: P[] = [
      [300, 150, 0], [230, 115, 50], [170, 85, 100], [140, 70, 140], [125, 62, 168], [70, 35, 182], [0, 0, 193],
    ];
    return {
      ...SUMMIT_STAGES.k2,
      stageKey: 'k2-2', stageName: 'ハウスのチムニー', goalName: 'C2', goal: 'camp', startHours: 5,
      o2: 'none', cloudAlt: 5300,
      campAltitude: 6050, summitAltitude: 6700, campName: 'C1', routeName: 'アブルッツィ稜',
      worldHeight: 193, faceSlope: 1.5, crestWidth: 5, floor: -320, seed: 6050, baseWind: 24,
      rockBand: [6100, 6650], bandColor: [0.38, 0.33, 0.28],
      route,
      ridges: [
        extend(route, [[380, 190, -40]], [[-60, -30, 240], [-260, -130, 520]]),
        [[-260, -130, 520], [-450, 250, 300], [-700, 600, 0]],
        [[-260, -130, 520], [100, -450, 300], [300, -800, 0]],
      ],
      landmarks: [
        { name: 'C1', routeIndex: 0, note: '6,050m' },
        { name: 'ハウスのチムニー', routeIndex: 3, note: '垂直に近い岩の割れ目。ロープ頼み' },
        { name: 'C2', routeIndex: 6, note: '6,700m 強風の吹きさらし' },
      ],
      ropeSections: [[0, 6]],
      rockfallZone: [1, 3],
      description: '鋭い岩稜と、垂直に近い岩の割れ目「ハウスのチムニー」。落石が多い。',
      difficulty: '★★★☆',
    };
  })(),
  (() => {
    const route: P[] = [
      [260, 130, 0], [200, 100, 40], [140, 70, 85], [80, 40, 120], [0, 0, 148],
    ];
    return {
      ...SUMMIT_STAGES.k2,
      stageKey: 'k2-3', stageName: 'ブラック・ピラミッド', goalName: 'C3', goal: 'camp', startHours: 5,
      o2: 'none', cloudAlt: 5800,
      campAltitude: 6700, summitAltitude: 7200, campName: 'C2', routeName: 'ブラック・ピラミッド',
      worldHeight: 148, faceSlope: 1.45, crestWidth: 7, floor: -360, seed: 6700, baseWind: 28,
      rockBand: [6720, 7150], bandColor: [0.12, 0.11, 0.11],
      route,
      ridges: [
        extend(route, [[340, 170, -40]], [[-70, -30, 190], [-280, -130, 440]]),
        [[-280, -130, 440], [-450, 250, 250], [-700, 600, -50]],
        [[-280, -130, 440], [100, -450, 250], [300, -800, -50]],
      ],
      landmarks: [
        { name: 'C2', routeIndex: 0, note: '6,700m' },
        { name: 'ブラック・ピラミッド', routeIndex: 2, note: '黒い岩のピラミッド。技術的な核心部' },
        { name: 'C3', routeIndex: 4, note: '7,200m 雪崩に注意' },
      ],
      ropeSections: [[0, 4]],
      rockfallZone: [1, 3],
      description: '黒い岩のピラミッドを、ミックス・クライミングで抜ける。手掛かりは古いロープだけ。',
      difficulty: '★★★☆',
    };
  })(),
  (() => {
    const route: P[] = [
      [320, 140, 0], [240, 110, 35], [160, 75, 70], [80, 35, 100], [0, 0, 119],
    ];
    return {
      ...SUMMIT_STAGES.k2,
      stageKey: 'k2-4', stageName: 'ショルダー', goalName: 'C4 ショルダー', goal: 'camp', startHours: 6,
      o2: 'stage', cloudAlt: 6200,
      campAltitude: 7200, summitAltitude: 7600, campName: 'C3', routeName: 'アブルッツィ稜 上部',
      worldHeight: 119, faceSlope: 1.2, crestWidth: 18, floor: -380, seed: 7200, baseWind: 32,
      rockBand: [9000, 9100],
      route,
      ridges: [
        extend(route, [[400, 180, -30]], [[-60, -20, 125], [-260, -120, 420]]),
        [[-260, -120, 420], [-450, 250, 200], [-700, 600, -100]],
        [[-260, -120, 420], [100, -450, 200], [300, -800, -100]],
      ],
      landmarks: [
        { name: 'C3', routeIndex: 0, note: '7,200m' },
        { name: '雪の大斜面', routeIndex: 2, note: '雪崩の巣。立ち止まるな' },
        { name: 'C4 ショルダー', routeIndex: 4, note: '7,600m 最終キャンプ' },
      ],
      ropeSections: [[0, 2]],
      description: '広い雪の斜面を登り、K2の肩（ショルダー）へ。風が一段と強まる。',
      difficulty: '★★☆☆',
    };
  })(),
  { ...SUMMIT_STAGES.k2 },
];

export interface ExpeditionDef {
  id: 'everest' | 'k2';
  name: string;
  subtitle: string;
  summitAltitude: number;
  baseAltitude: number;
  routeName: string;
  description: string;
  difficulty: string;
  stages: MountainDef[];
}

export const EXPEDITIONS: Record<'everest' | 'k2', ExpeditionDef> = {
  everest: {
    id: 'everest', name: 'エベレスト', subtitle: 'Everest / Chomolungma', summitAltitude: 8849, baseAltitude: 5364,
    routeName: '南東稜ルート',
    description: 'ベースキャンプからクンブ・アイスフォール、ウエスタン・クーム、ローツェ・フェースを越えてサウスコルへ。最後は深夜のサミットプッシュ。',
    difficulty: '★★★☆', stages: EVEREST_STAGES,
  },
  k2: {
    id: 'k2', name: 'K2', subtitle: 'K2 / Chhogori', summitAltitude: 8611, baseAltitude: 5000,
    routeName: 'アブルッツィ稜ルート',
    description: '「非情の山」。ハウスのチムニー、ブラック・ピラミッドを越え、巨大セラック直下のボトルネックへ。',
    difficulty: '★★★★', stages: K2_STAGES,
  },
};

/** Summit-push stage per mountain (kept for tests and older code paths). */
export const MOUNTAINS = SUMMIT_STAGES;

export function displayAltitude(m: MountainDef, y: number): number {
  const scale = (m.summitAltitude - m.campAltitude) / m.worldHeight;
  return m.campAltitude + y * scale;
}

export function altitudeToWorldY(m: MountainDef, alt: number): number {
  const scale = (m.summitAltitude - m.campAltitude) / m.worldHeight;
  return (alt - m.campAltitude) / scale;
}
