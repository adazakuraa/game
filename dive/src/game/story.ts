/**
 * The main thread: a beginner underwater photographer working for the marine magazine 『月刊うみなか』,
 * aiming for the cover. Each chapter is one clear goal the player can read on the boat; finishing it pays,
 * praises, and hands over the next goal (and sometimes a chart to a place that is hard to find alone).
 * Some chapters ask for a special sight (a 特別な光景): staged the first time so the player is sure to
 * meet it, then left to chance.
 */

export type SceneId = 'whalesleep' | 'spawning' | 'baitball' | 'mantatrain' | 'whaleshark' | 'humpback' | 'dolphins' | 'hammers' | 'noctiluca' | 'orcas' | 'tornado';

/**
 * Rare, photogenic sights (achievements). Each has the dive points where it can happen, day or night,
 * the chance per dive and the species that stars in it. Two are staged once by the story; the rest are
 * met by luck. Seeing one is announced ("something is out there…") before it comes into view.
 */
export const SCENES: Record<SceneId, { name: string; desc: string; pay: number; chance: number; points: string[]; night?: boolean; star?: string; n?: number; hint: string; sense: string }> = {
  whalesleep: { name: '縦になって眠るマッコウクジラ', desc: '沖の水深15m付近で、数頭のマッコウクジラが頭を上にして立ったまま眠っている。息継ぎの合間の、ほんの十数分の眠り。', pay: 20000, chance: 0.12, points: ['dropoff'], star: 'makkou', n: 3, hint: '沖の大海原・昼', sense: '青い海の向こうに、黒い柱のような影が立っている…' },
  spawning: { name: 'サンゴの一斉産卵', desc: '初夏の満月の夜、サンゴ礁のサンゴが一斉に卵の粒を放ち、海がピンクの雪のように舞い上がる。', pay: 16000, chance: 0.2, points: ['reef'], night: true, hint: 'サンゴ礁・夜', sense: '水の中に、ピンク色の粒が舞いはじめた…' },
  baitball: { name: 'イワシのベイトボール', desc: '大型魚に追われたマイワシの大群が、身を守るためにぎゅっと固まって球になり、銀色に渦巻く。', pay: 12000, chance: 0.14, points: ['dropoff'], star: 'sardine', n: 200, hint: 'ドロップオフ／沖・昼', sense: '遠くで何かが銀色にきらめいている…' },
  mantatrain: { name: 'マンタトレイン', desc: '繁殖期の雄のマンタたちが、雌の後ろに一列になってついて泳ぐ「トレイン」。', pay: 14000, chance: 0.1, points: ['dropoff', 'reef'], star: 'manta', n: 4, hint: 'ドロップオフ・サンゴ礁', sense: '大きな影がいくつも連なって近づいてくる…' },
  whaleshark: { name: '立ち泳ぎで食事するジンベエザメ', desc: '水面近くで体を縦にして、口を大きく開けて海水ごとプランクトンを吸い込む。', pay: 14000, chance: 0.1, points: ['dropoff'], star: 'whaleshark', n: 1, hint: '沖の大海原・昼', sense: '水面の近くに、巨大な影が縦に浮かんでいる…' },
  humpback: { name: 'ザトウクジラの親子', desc: '冬の暖かい海で生まれた子クジラが、母クジラに寄り添ってゆっくり泳ぐ。', pay: 15000, chance: 0.08, points: ['dropoff'], star: 'humpback', n: 2, hint: '沖の大海原', sense: '遠くからクジラの歌が聞こえる…' },
  dolphins: { name: 'イルカと泳ぐ', desc: '好奇心の強いミナミハンドウイルカの群れが、ダイバーのまわりをくるくる泳ぎまわる。', pay: 9000, chance: 0.12, points: ['dropoff', 'reef', 'lagoon'], star: 'dolphin', n: 5, hint: '浅瀬からドロップオフ・昼', sense: 'キュイキュイという鳴き声が聞こえる…' },
  hammers: { name: 'ハンマーヘッドの群れ', desc: '深場で何十匹ものアカシュモクザメが群れをつくってゆっくり回る。昼の間だけ集まる不思議な群れ。', pay: 16000, chance: 0.08, points: ['dropoff', 'bluehole'], star: 'hammerhead', n: 9, hint: 'ドロップオフの深場・ブルーホール', sense: '深いところに、たくさんのサメの影が回っている…' },
  noctiluca: { name: '夜光虫の青い光', desc: '夜の海で手を動かすと、夜光虫が青白く光って星空のように瞬く。', pay: 8000, chance: 0.25, points: ['lagoon', 'reef', 'rocky', 'kelp'], night: true, hint: '浅い海・夜', sense: '体のまわりで、何かが青く光った…' },
  orcas: { name: 'シャチの家族', desc: '群れごとに独自の言葉をもつシャチの家族が、一列になって通り過ぎていく。', pay: 16000, chance: 0.08, points: ['cold', 'dropoff'], star: 'shachi', n: 3, hint: '流氷の入り江・沖', sense: '白と黒の背びれが水面を切っていく…' },
  tornado: { name: 'ギンガメアジのトルネード', desc: '何百匹ものギンガメアジが、竜巻のように渦を巻いて泳ぐ。', pay: 11000, chance: 0.14, points: ['dropoff', 'reef', 'rocky'], star: 'giganmeaji', n: 50, hint: 'サンゴ礁・岩礁・ドロップオフ・昼', sense: '中層に、銀色の柱が渦巻いている…' },
};

export type StoryState = {
  dives: number;
  found: number;
  sCount: number;
  nightFound: number;
  scenes: Partial<Record<SceneId, unknown>>;
  rare3S: number;
};

export type Chapter = {
  title: string;
  /** what the editor says when the chapter starts */
  intro: string;
  goal: string;
  done: (s: StoryState) => boolean;
  progress?: (s: StoryState) => string;
  reward: number;
  /** a chart handed over when the chapter is finished */
  map?: string;
  /** a special sight that is staged while this chapter is the current one */
  scene?: SceneId;
  title2: string;
};

export const CHAPTERS: Chapter[] = [
  {
    title: 'はじめての海', title2: '駆け出しの写真家',
    intro: '海洋雑誌『月刊うみなか』の編集長から連絡が来た。「島に着いたね。まずは浅瀬で体を慣らして。泳ぎ方とエアの見方、それに写真の撮り方を覚えたら、仕事を頼むよ」',
    goal: '浅瀬ラグーンで最初のダイブをして、生き物を撮って帰る', done: (s) => s.dives >= 1, reward: 0,
  },
  {
    title: '編集長の課題', title2: '新人写真家',
    intro: '編集長「いい滑り出し。次は数だ。いろんな生き物を撮ってきて」',
    goal: '図鑑を15種にする', done: (s) => s.found >= 15, progress: (s) => `${Math.min(15, s.found)}/15種`, reward: 3000,
  },
  {
    title: 'S評価の一枚', title2: '期待の新人',
    intro: '編集長「誌面に載せるなら一枚の質だ。近くで、真横から、全身が入るように。評価Sの写真を見せてほしい」',
    goal: 'S評価の写真を1枚撮る', done: (s) => s.sCount >= 1, reward: 5000,
  },
  {
    title: '夜の海', title2: '夜を知る写真家',
    intro: '編集長「夜の海は別の世界だよ。ライトを頼りに、夜にしか会えない生き物を撮ってきて」',
    goal: '夜行性の生き物を撮る（夜の海で）', done: (s) => s.nightFound >= 1, reward: 6000, map: 'cave',
  },
  {
    title: '眠る巨人', title2: '巨人を撮った写真家', scene: 'whalesleep',
    intro: '編集長「漁師さんから珍しい話を聞いた。沖の大海原で、マッコウクジラが縦になって眠っているらしい。地図に印をつけておく。驚かさないように、そっと近づいて」',
    goal: '沖で縦になって眠るマッコウクジラを撮る', done: (s) => !!s.scenes.whalesleep, reward: 0,
  },
  {
    title: '海の満月', title2: '海の神秘を撮る写真家', scene: 'spawning',
    intro: '編集長「今夜は満月。サンゴ礁でサンゴの一斉産卵が始まるかもしれない。夜のサンゴ礁へ行って、その瞬間を撮って」',
    goal: '夜のサンゴ礁でサンゴの一斉産卵を撮る', done: (s) => !!s.scenes.spawning, reward: 0,
  },
  {
    title: '表紙を飾れ', title2: '表紙の写真家',
    intro: '編集長「いよいよ表紙だ。めったに会えない★3の生き物を、S評価で。あなたにしか撮れない一枚を」',
    goal: '★3の生き物をS評価で撮る', done: (s) => s.rare3S >= 1, reward: 30000,
  },
];

export const ENDING = '『月刊うみなか』の表紙に、あなたの写真が載った。編集長「おめでとう。もう立派な海中写真家だ。海はまだまだ広い。図鑑の空欄、全部埋めてみせて」';

/**
 * First dive tutorial: one thing at a time, learned by doing, each step praised the moment it is done.
 * The coach panel shows only the current step.
 */
export type TutStep = { text: string; done: (t: TutCtx) => boolean; praise: string; hold?: number };
export type TutCtx = { moved: number; looked: number; depth: number; airShown: number; shots: number; species: number; surfaceNear: boolean; t: number; alt: number };

export const TUTORIAL: TutStep[] = [
  { text: '画面の左側をドラッグして、前へ泳いでみよう', done: (t) => t.moved > 4, praise: 'いいね！' },
  { text: '右側をドラッグして、まわりを見回そう', done: (t) => t.looked > 1.6, praise: 'その調子！' },
  { text: '▼ボタンで、海底の近くまで潜ってみよう', done: (t) => t.alt < 1.6 || t.depth > 6, praise: '上手！' },
  { text: '右上の丸いメーターがエア（空気）の残り。深く潜るほど、速く泳ぐほど早く減る。0になると気絶して救助され、稼ぎが減ってしまう。半分を切ったら戻り始めよう', done: (t) => t.airShown > 7, praise: 'エアはいつも気にしておこう', hold: 7 },
  { text: '生き物を照準の枠に入れて、カメラボタンで撮ろう。近く・真横から・全身が入ると高評価', done: (t) => t.shots >= 1, praise: 'ナイスショット！' },
  { text: 'あと2種類、ちがう生き物を撮ってみよう', done: (t) => t.species >= 3, praise: 'すばらしい！' },
  { text: 'ボートへ戻ろう。▲で水面近く（水深1.6mより浅く）まで上がると「浮上」ボタンが出る', done: (t) => t.surfaceNear, praise: '浮上ボタンを押してダイブ終了！' },
];
