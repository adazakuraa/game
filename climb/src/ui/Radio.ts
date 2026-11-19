/** Base-camp radio: weather, history of the route, pace checks and warnings. */

/** Lines keyed by stage, then by landmark index (0 = departure). */
const LORE: Record<string, Record<number, string[]>> = {
  'everest-1': {
    0: ['こちらBC。アイスフォールは日が昇ると氷が緩む。午前中に抜けろ。ハシゴはロープに確保してから渡れ。'],
    1: ['ポップコーン・フィールドだ。2014年、この先で氷塔が崩れて16人のシェルパが亡くなった。立ち止まるな。'],
    2: ['フットボール・フィールドで一息つけ。ここは比較的安全だ。'],
    3: ['ラダー帯だ。下は見るな…と言いたいが、足元はよく見ろ。アイゼンの爪を横木にかけるんだ。'],
  },
  'everest-2': {
    0: ['クームは風がないと照り返しで地獄の暑さになる。だが日陰に入れば一気に冷える。'],
    1: ['左手がヌプツェの壁、右がエベレスト西稜。正面の青い壁がローツェ・フェースだ。'],
  },
  'everest-3': {
    0: ['ローツェ・フェースは硬い青氷だ。前爪をしっかり蹴り込んで、ユマールを滑らせて登れ。'],
    1: ['ベルクシュルントだ。氷河と氷壁の境目は口を開けている。ハシゴで渡れ。'],
    2: ['上の岩帯から石が落ちてくる。音がしたら顔を上げて、横へ逃げろ。'],
  },
  'everest-4': {
    0: ['ここから酸素を吸え。流量は2リットル。帰りの分を考えろ。'],
    1: ['イエローバンドは大昔の海の底の石灰岩だ。山頂の岩からは三葉虫の化石も出る。'],
    2: ['ジュネーブ・スパー。1952年にスイス隊が越えたからこの名だ。登り切ればサウスコルだ。'],
  },
  'everest-summit': {
    0: ['サウスコル、こちらBC。いよいよだ。折り返しは14時。それを過ぎたら頂上が目の前でも引き返せ。'],
    1: ['三角フェースだ。ロープから絶対に外れるな。'],
    2: ['バルコニーだ。ここでボンベを替えるのが定石だ。デポしたボンベが置いてある。'],
    3: ['南峰だ。山頂はもう見えている。焦るな、ここからが一番危ない。'],
    4: ['コーニス・トラバース。右に落ちればチベット、左に落ちればネパールだ。どっちに落ちても死ぬ。'],
    5: ['ヒラリーステップ。1953年、ヒラリーとテンジンがここを越えた。2015年の地震で岩は崩れたが、名前は残った。'],
  },
  'k2-1': {
    0: ['こちらBC。取り付きまでは氷河歩きだ。隠れたクレバスに気をつけろ。'],
    1: ['ABCだ。ここからアブルッツィ稜。1909年にアブルッツィ公が偵察した尾根だ。'],
    2: ['リブは急だが、ロープはしっかりしている。リズムを守れ。'],
  },
  'k2-2': {
    0: ['今日はハウスのチムニーだ。1938年にビル・ハウスが初めて登った。'],
    1: ['チムニーの中は狭い。ザックが擦れるぞ。落石にも気をつけろ。'],
  },
  'k2-3': {
    0: ['ブラック・ピラミッドはK2で一番技術的な区間だ。岩と氷のミックスだ。'],
    1: ['古いロープが何本もかかっているが、新しい赤いロープを使え。'],
  },
  'k2-4': {
    0: ['ここから酸素を使え。ショルダーまでは雪の大斜面だ。'],
    1: ['この斜面は雪崩の巣だ。立ち止まらずに抜けろ。'],
  },
  'k2-summit': {
    0: ['ショルダー、こちらBC。ここから先がK2の本番だ。2008年、ボトルネックで11人が亡くなった。'],
    1: ['ボトルネックだ。頭上のセラックは何十年もそこにぶら下がっている。'],
    2: ['トラバースだ。セラックの真下だ。走れとは言わないが、止まるな。'],
    3: ['頂上雪田だ。深い雪だが、もう少しだ。'],
  },
};

export class Radio {
  private readonly el = document.getElementById('radio')!;
  private readonly fromEl = document.getElementById('radio-from')!;
  private readonly textEl = document.getElementById('radio-text')!;
  private queue: { from: string; text: string }[] = [];
  private showing = 0;
  private typed = 0;
  private current = '';
  private cooldown = 0;
  private said = new Set<string>();
  onTransmit: () => void = () => undefined;

  reset(): void {
    this.queue = [];
    this.showing = 0;
    this.cooldown = 3;
    this.said.clear();
    this.el.classList.add('hidden');
  }

  /** Cut the current transmission (something more urgent is on screen). */
  interrupt(hold = 8): void {
    this.showing = 0;
    this.cooldown = Math.max(this.cooldown, hold);
    this.el.classList.add('hidden');
  }

  /** Queue a line once per key (keys reset each leg). */
  say(key: string, text: string, from = 'BC'): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.queue.push({ from, text });
  }

  lore(stageKey: string, landmark: number): void {
    const lines = LORE[stageKey]?.[landmark];
    if (lines) this.say(`lore-${landmark}`, lines[0]);
  }

  update(dt: number): void {
    if (this.showing > 0) {
      this.showing -= dt;
      if (this.typed < this.current.length) {
        this.typed = Math.min(this.current.length, this.typed + dt * 28);
        this.textEl.textContent = this.current.slice(0, Math.floor(this.typed));
      }
      if (this.showing <= 0) this.el.classList.add('hidden');
      return;
    }
    this.cooldown -= dt;
    if (this.cooldown > 0 || !this.queue.length) return;
    const m = this.queue.shift()!;
    this.current = m.text;
    this.typed = 0;
    this.fromEl.textContent = m.from;
    this.textEl.textContent = '';
    this.showing = 3.5 + m.text.length * 0.07;
    this.cooldown = 4;
    this.el.classList.remove('hidden');
    this.onTransmit();
  }
}
