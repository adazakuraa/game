/**
 * Things left on the mountain by those who came before. Two per leg, placed a few
 * metres off the track. The diaries are fictional climbers; anything about real
 * expeditions is stated as plain history, never as invented words of real people.
 */
export interface LoreEntry {
  id: string;
  /** stageKey of the leg it lies on */
  stage: string;
  /** where along the leg (0..1) */
  at: number;
  /** what you see lying there */
  item: string;
  title: string;
  body: string;
  /** look of the object in the snow */
  look: 'notebook' | 'bottle' | 'axe' | 'flag' | 'photo' | 'carabiner';
}

export const LORE: LoreEntry[] = [
  // --- Everest
  {
    id: 'e1-a', stage: 'everest-1', at: 0.32, look: 'notebook', item: '濡れて波打った手帳',
    title: 'ある隊員の手帳（クンブ・アイスフォール）',
    body: '午前3時に出た。氷塔が月明かりで青い。シェルパが「日が当たる前に抜けろ」と何度も言う。ハシゴの上で下を見てしまった。底が見えない。次は見ない。',
  },
  {
    id: 'e1-b', stage: 'everest-1', at: 0.74, look: 'carabiner', item: '古いスチール製カラビナ',
    title: '刻印のあるカラビナ',
    body: '今のアルミ製よりずっと重い、鋼鉄のカラビナ。半世紀前の遠征で使われた型だ。アイスフォールは毎年ルートが変わる。この氷河が下へ運んできたのかもしれない。',
  },
  {
    id: 'e2-a', stage: 'everest-2', at: 0.4, look: 'photo', item: '色あせた写真',
    title: '家族写真の裏書き',
    body: '裏に鉛筆で「帰ったら海に行こう」。ウエスタン・クームは「沈黙の谷」と呼ばれる。風がなく、雪に照り返す日差しで昼は暑いほどになる。',
  },
  {
    id: 'e2-b', stage: 'everest-2', at: 0.78, look: 'flag', item: '千切れたタルチョ（祈祷旗）',
    title: '風の馬',
    body: 'タルチョには「ルンタ（風の馬）」が刷られている。風が祈りを運ぶと信じられている。色は五つ、青・白・赤・緑・黄が空・風・火・水・地を表す。',
  },
  {
    id: 'e3-a', stage: 'everest-3', at: 0.35, look: 'notebook', item: '凍った日誌',
    title: 'ローツェ・フェースの日誌',
    body: '青氷の壁。アイゼンの前爪を蹴り込み、ユマールを押し上げ、三歩ごとに休む。後ろの隊員が氷のかけらを落とした。音もなく私の横を飛んでいった。ヘルメットを貸してくれた友に感謝する。',
  },
  {
    id: 'e3-b', stage: 'everest-3', at: 0.72, look: 'bottle', item: '空の酸素ボンベ',
    title: '使い切ったボンベ',
    body: '圧力計の針はゼロ。かつて山には空のボンベが大量に捨てられていた。今は回収が進み、持ち帰った分だけデポジットが返ってくる仕組みもある。',
  },
  {
    id: 'e4-a', stage: 'everest-4', at: 0.38, look: 'axe', item: '雪に刺さったピッケル',
    title: '持ち主のいないピッケル',
    body: '柄に名前を削った跡がある。読めない。イエローバンドは石灰岩の帯で、何億年も前は海の底だった。山頂付近の岩からも、海の生き物の化石が見つかっている。',
  },
  {
    id: 'e4-b', stage: 'everest-4', at: 0.8, look: 'notebook', item: '鉛筆の走り書き',
    title: 'サウスコル手前のメモ',
    body: '明日の夜、出る。手が震えるのは寒さのせいだけじゃない。ここから上は、誰も助けに来られない。だから自分で引き返す時刻を決めた。14時。それを守る。',
  },
  {
    id: 'es-a', stage: 'everest-summit', at: 0.45, look: 'photo', item: '凍りついたお守り',
    title: '南峰のお守り',
    body: '布の袋に、小さく折った紙。「必ず帰ってきて」。1953年5月29日、テンジン・ノルゲイとエドモンド・ヒラリーがこの稜線を越えて初登頂した。二人とも、生きて帰った。',
  },
  {
    id: 'es-b', stage: 'everest-summit', at: 0.84, look: 'flag', item: '風に削られた小旗',
    title: '1924年の謎',
    body: '1924年、ジョージ・マロリーとアンドリュー・アーヴィンは北側から山頂を目指し、そのまま消息を絶った。二人が山頂に立ったのかどうかは、今も分かっていない。',
  },
  // --- K2
  {
    id: 'k1-a', stage: 'k2-1', at: 0.3, look: 'carabiner', item: '錆びたピトン',
    title: '岩に残ったピトン',
    body: 'アブルッツィ稜は、1909年にイタリアのアブルッツィ公の遠征隊が偵察したことから名づけられた。このピトンが何年のものかは分からない。',
  },
  {
    id: 'k1-b', stage: 'k2-1', at: 0.76, look: 'notebook', item: '綴じ紐の切れた手帳',
    title: 'ある隊員の手帳（K2）',
    body: 'エベレストより低いのに、誰もがこの山を恐れる。理由が分かった。どこにも平らな場所がない。テントを張るにも、まず足場を削る。',
  },
  {
    id: 'k2-a', stage: 'k2-2', at: 0.4, look: 'axe', item: '折れたアイスハンマー',
    title: 'チムニーの入口で',
    body: 'ハウスのチムニーは、1938年のアメリカ隊のビル・ハウスが初めて登った岩の割れ目。両手両足を突っ張って体を持ち上げる。ロープ無しでここを登った人がいたとは信じられない。',
  },
  {
    id: 'k2-b', stage: 'k2-2', at: 0.8, look: 'photo', item: '写真の切れ端',
    title: 'ベースキャンプの写真',
    body: '笑っている隊員たちの写真。K2のベースキャンプの近くには、この山で亡くなった人々の記念碑がある。山を見上げる場所に置かれている。',
  },
  {
    id: 'k3-a', stage: 'k2-3', at: 0.35, look: 'notebook', item: '凍った日誌',
    title: 'ブラック・ピラミッドの日誌',
    body: '黒い岩の三角形が延々と続く。アイゼンが岩にきしむ音がずっと耳に残る。落石は音より先に来る。上を見ている暇もない。',
  },
  {
    id: 'k3-b', stage: 'k2-3', at: 0.78, look: 'bottle', item: '小さなガスカートリッジ',
    title: '空のガス缶',
    body: '高所では雪を溶かして水を作るのが一日仕事だ。一人一日数リットルの水が要る。燃料が尽きれば、喉の渇きが命取りになる。',
  },
  {
    id: 'k4-a', stage: 'k2-4', at: 0.45, look: 'flag', item: 'ルート旗',
    title: 'ショルダーの竹竿',
    body: 'ホワイトアウトでもルートが分かるよう、雪面に立てられた目印の旗。この先、肩（ショルダー）を越えると、すべての視線がボトルネックの上の巨大なセラックに吸い寄せられる。',
  },
  {
    id: 'k4-b', stage: 'k2-4', at: 0.82, look: 'notebook', item: '鉛筆の走り書き',
    title: 'C4のメモ',
    body: '明日はボトルネックだ。あのセラックの真下を、何時間もかけて横切る。上を見ないこと。止まらないこと。そして、14時に引き返すこと。',
  },
  {
    id: 'ks-a', stage: 'k2-summit', at: 0.5, look: 'carabiner', item: '氷に埋まったカラビナ',
    title: '2008年8月',
    body: '2008年8月、ボトルネック上部のセラックが崩れてフィックスロープが流され、下山中の登山者たちが取り残された。この遭難では11人が亡くなった。',
  },
  {
    id: 'ks-b', stage: 'k2-summit', at: 0.86, look: 'photo', item: '雪にくるまれた写真',
    title: '1954年7月31日',
    body: '1954年7月31日、イタリア隊のアキッレ・コンパニョーニとリーノ・ラチェデッリがK2に初登頂した。下で酸素を運び上げた仲間たちの支えがあっての登頂だった。',
  },
];

const KEY = 'dz8000-lore-v1';

export function loreCollected(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Returns true if this was the first time it was found. */
export function collectLore(id: string): boolean {
  const s = loreCollected();
  if (s.has(id)) return false;
  s.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* not persisted */ }
  return true;
}
