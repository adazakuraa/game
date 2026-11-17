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

export interface MountainDef {
  id: 'everest' | 'k2';
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

export const MOUNTAINS: Record<'everest' | 'k2', MountainDef> = {
  everest: {
    id: 'everest',
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
    ropeSections: [[3, 7]],
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

export function displayAltitude(m: MountainDef, y: number): number {
  const scale = (m.summitAltitude - m.campAltitude) / m.worldHeight;
  return m.campAltitude + y * scale;
}

export function altitudeToWorldY(m: MountainDef, alt: number): number {
  const scale = (m.summitAltitude - m.campAltitude) / m.worldHeight;
  return (alt - m.campAltitude) / scale;
}
