/**
 * The main thread: a beginner underwater photographer working for the marine magazine 『月刊うみなか』,
 * aiming for the cover. Each chapter is one clear goal the player can read on the boat; finishing it pays,
 * praises, and hands over the next goal (and sometimes a chart to a place that is hard to find alone).
 * Some chapters ask for a special sight (a 特別な光景): staged the first time so the player is sure to
 * meet it, then left to chance.
 */

export type SceneId = 'whalesleep' | 'spawning' | 'baitball' | 'mantatrain' | 'whaleshark' | 'humpback' | 'dolphins' | 'hammers' | 'noctiluca' | 'orcas' | 'tornado' | 'mantanight' | 'lanternrise' | 'flashlight';

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
  // ---- night-only sights (light-dependent, so they are never met by day)
  mantanight: { name: 'ライトに集まるマンタ', desc: '夜、ダイバーのライトにプランクトンが集まると、それを食べに大きなマンタが現れて、光の中で宙返りを繰り返す。', pay: 15000, chance: 0.18, points: ['reef', 'dropoff'], night: true, star: 'manta', n: 2, hint: 'サンゴ礁・ドロップオフ・夜（ライトが必要）', sense: 'ライトの光の中を、大きな影がよぎった…' },
  lanternrise: { name: 'ハダカイワシの日周鉛直移動', desc: '夜になると、深みにいる無数の小さな発光魚がエサを求めて浮上してくる。光の粒が柱のように立ちのぼる。', pay: 12000, chance: 0.2, points: ['dropoff'], night: true, star: 'hadakaiwashi', n: 60, hint: 'ドロップオフ・夜', sense: '足元の暗い深みから、小さな光の粒が昇ってくる…' },
  flashlight: { name: 'ヒカリキンメダイの群れの明滅', desc: '目の下の発光器をまばたきさせる魚たちが、夜の岩のそばで青白い光を点けたり消したりしている。', pay: 13000, chance: 0.18, points: ['reef', 'rocky'], night: true, star: 'hikarikinme', n: 30, hint: 'サンゴ礁・岩礁・夜', sense: '暗闇の中で、青白い光がいくつも点いたり消えたりしている…' },
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
  /** what the editor says when the chapter is cleared */
  praise?: string;
  /** a chart handed over when the chapter is finished */
  map?: string;
  /** a special sight that is staged while this chapter is the current one */
  scene?: SceneId;
  title2: string;
};

export const CHAPTERS: Chapter[] = [
  {
    title: 'はじめての海', title2: '腕利きの趣味ダイバー',
    intro: 'あなたは長年、趣味で海に潜っては海の中の写真を撮ってきたダイバー。ネットに載せていたその写真が、海洋雑誌『月刊うみなか』の編集長の目に留まった。「あなたの腕を見せてほしい。島の宿は、港の食堂『しおさい亭』に頼んである」——そうして呼ばれた島の、最初の海。まずは浅瀬ラグーンで試し撮りだ。',
    goal: '浅瀬ラグーンで試し撮りをして、生き物を撮って帰る', done: (s) => s.dives >= 1, reward: 1000,
    praise: '編集長「流石だな。噂どおりの腕だ。今日の写真は全部買わせてもらうよ。試し撮りのお礼も入れておいた」',
  },
  {
    title: '編集長の課題', title2: '新人写真家',
    intro: '編集長「あの腕なら任せられる。正式に仕事を頼みたい。まずは数だ。いろんな生き物を撮ってきてほしい。写真の代金とは別に、課題をこなすたびに報酬を払うよ」',
    goal: '図鑑を15種にする', done: (s) => s.found >= 15, progress: (s) => `${Math.min(15, s.found)}/15種`, reward: 3000,
    praise: '編集長「15種、もう揃えたのか。仕事が早いね」',
  },
  {
    title: 'S評価の一枚', title2: '期待の新人',
    intro: '編集長「誌面に載せるなら一枚の質だ。近くで、真横から、全身が入るように。評価Sの写真を見せてほしい」',
    goal: 'S評価の写真を1枚撮る', done: (s) => s.sCount >= 1, reward: 5000,
    praise: '編集長「これだよ、これ。誌面で映える一枚だ」',
  },
  {
    title: '夜の海', title2: '夜を知る写真家',
    intro: '編集長「夜の海は別の世界だよ。ライトを頼りに、夜にしか会えない生き物を撮ってきて」',
    goal: '夜行性の生き物を撮る（夜の海で）', done: (s) => s.nightFound >= 1, reward: 6000, map: 'cave',
    praise: '編集長「夜の海でも落ち着いて撮れている。さすがだ。お礼に、漁師さんから聞いた洞窟の場所を教えるよ」',
  },
  {
    title: '眠る巨人', title2: '巨人を撮った写真家', scene: 'whalesleep',
    intro: '編集長「漁師さんから珍しい話を聞いた。沖の大海原で、マッコウクジラが縦になって眠っているらしい。地図に印をつけておく。驚かさないように、そっと近づいて」',
    goal: '沖で縦になって眠るマッコウクジラを撮る', done: (s) => !!s.scenes.whalesleep, reward: 8000,
    praise: '編集長「眠る巨人…！ 編集部がざわついているよ」',
  },
  {
    title: '海の満月', title2: '海の神秘を撮る写真家', scene: 'spawning',
    intro: '編集長「今夜は満月。サンゴ礁でサンゴの一斉産卵が始まるかもしれない。夜のサンゴ礁へ行って、その瞬間を撮って」',
    goal: '夜のサンゴ礁でサンゴの一斉産卵を撮る', done: (s) => !!s.scenes.spawning, reward: 8000,
    praise: '編集長「あの一瞬をよく撮った。特集が組めるよ」',
  },
  {
    title: '表紙を飾れ', title2: '表紙の写真家',
    intro: '編集長「いよいよ表紙だ。めったに会えない★3の生き物を、S評価で。あなたにしか撮れない一枚を」',
    goal: '★3の生き物をS評価で撮る', done: (s) => s.rare3S >= 1, reward: 30000,
  },
];

export const ENDING = '『月刊うみなか』の表紙に、あなたの写真が載った。編集長「おめでとう。もう立派な海中写真家だ。海はまだまだ広い。図鑑の空欄、全部埋めてみせて」';

/**
 * First dive tutorial (the test dive the editor asked for): one thing at a time, learned by doing, each step
 * praised the moment it is done. Order: move, look, descend, shoot, photos are money, the second-photo rule,
 * air, surface. The coach panel shows only the current step.
 */
export type TutStep = { text: string; done: (t: TutCtx) => boolean; praise: string; hold?: number; hl?: 'air' | 'surface' };
export type TutCtx = { moved: number; looked: number; depth: number; depth0: number; down: number; airShown: number; shots: number; species: number; repeat: number; surfaceNear: boolean; t: number; alt: number };

export const TUTORIAL: TutStep[] = [
  { text: '画面の左側をドラッグして、前へ泳いでみよう', done: (t) => t.moved > 4, praise: 'いいね！' },
  { text: '右側をドラッグして、まわりを見回そう', done: (t) => t.looked > 1.6, praise: 'その調子！' },
  // needs the ▼ button itself: in the shallow lagoon the floor may already be close when this step begins
  { text: '▼ボタンを押して、海底の近くまで潜ってみよう', done: (t) => t.down >= 0.6 && (t.alt < 1.2 || t.depth >= t.depth0 + 1.5), praise: '上手！' },
  { text: '生き物を照準の枠に入れて、カメラボタンで撮ろう。近く・真横から・全身が入ると高評価', done: (t) => t.shots >= 1, praise: 'ナイスショット！' },
  { text: '撮った写真は、浮上したときに雑誌社が買い取ってくれる。評価が高いほど高く売れる。あと2種類、ちがう生き物を撮ってみよう', done: (t) => t.species >= 3, praise: 'すばらしい！' },
  { text: '同じ生き物の2枚目からは、より良い評価なら図鑑の写真が差し替わる。ただし売れるのは1回のダイブで1種1枚だけ。また売るには潜り直そう', done: (t) => t.repeat >= 1 || t.t > 9, praise: '次はエアの見方だ', hold: 9 },
  { text: '右上の丸いメーターがエア（空気）の残り。深く潜るほど、速く泳ぐほど早く減る。0になると気絶して救助され、稼ぎが減ってしまう。半分を切ったら戻り始めよう', done: (t) => t.airShown > 7, praise: 'エアはいつも気にしておこう', hold: 7, hl: 'air' },
  { text: 'ボートへ戻ろう。▲で水面近く（水深1.6mより浅く）まで上がると「浮上」ボタンが出る', done: (t) => t.surfaceNear, praise: '浮上ボタンを押してダイブ終了！', hl: 'surface' },
];
