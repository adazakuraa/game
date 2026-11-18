/** Coach-mark tutorial: highlights each HUD element and explains what the number means. */
interface Step {
  target: string | null;
  title: string;
  body: string;
  /** shown only on touch or only on desktop */
  only?: 'touch' | 'desktop';
}

const STEPS: Step[] = [
  {
    target: null,
    title: '画面の見かた',
    body: 'ここはベースキャンプ。山頂まではキャンプを4つ経由する長い遠征です。まず画面の数字の意味を確認しましょう。ゲームは止まっています。',
  },
  {
    target: '#alt-value',
    title: '標高',
    body: 'いま立っている場所の標高（m）。8,000mを超えると「デスゾーン」。空気中の酸素は地上の1/3しかありません。',
  },
  {
    target: '.alt-sub',
    title: '時刻と期限',
    body: 'ゲーム内の時刻（現実の約40倍の速さで進みます）。右は期限です。キャンプへの移動日は「日没」、山頂アタックの日は「折返」。期限を過ぎると暗闇と嵐の中を進むことになります。',
  },
  {
    target: '#next-mark',
    title: '次の目標と進み具合',
    body: '次の地点の名前と、そこまでの道のりの距離。下のバーはこの区間の進み具合で、縦線は途中の目印です。',
  },
  {
    target: '#v-spo2',
    title: 'SpO₂（血中酸素）と心拍',
    body: '血液中の酸素の割合。平地では98%前後、8,000mでは60%台まで下がります。60%を切り続けると高所脳浮腫（HACE）が進み、視界が揺れ、やがて死亡します。♥の数字は心拍数で、登ったり酸素が足りないと上がります。',
  },
  {
    target: '#v-stam',
    title: '体力',
    body: '歩くと減り、立ち止まる・「休む」で回復します。急な登りほど早く減り、酸素が薄いほど回復が遅い。0になると息が上がって動けなくなります。',
  },
  {
    target: '#v-temp',
    title: '体温と凍傷',
    body: '体の中心の温度。37℃が平常、35℃を下回ると震えが止まらず、32℃で低体温症により死亡します。動くと温まり、強風の中で立ち止まると冷えます。横に「凍傷」の数値が出たら指先が凍りかけています。',
  },
  {
    target: '#v-wind',
    title: '風速と気温',
    body: '風速（km/h）と気温。風が強いほど体温を奪われます。「突風が来る」と出たら「休む」で身を低くして耐えましょう。午後は天気が崩れやすくなります。',
  },
  {
    target: '#v-o2',
    title: '酸素ボンベ',
    body: 'C3から上では酸素ボンベを使います。バーは使用中のボンベの残量、「+1」は予備の本数です。空になったら「交換」で予備に替えます。',
  },
  {
    target: '.flow-row',
    title: '酸素の流量',
    body: '1分あたりに吸う酸素の量（L/分）。上げるほどSpO₂が上がって楽になりますが、ボンベが早く空になります。帰りの分を残すのが鉄則です。',
  },
  {
    target: '#clip-status',
    title: '確保の状態',
    body: 'フィックスロープにつながっているかどうか。緑は確保中。赤く点滅したら、急斜面なのにロープにつながっていない危険な状態です。',
  },
  {
    target: '#clip-btn',
    title: 'クリップ',
    body: 'ロープの近くで押すと確保します。アンカー（杭）に着いたら押して次のロープへ付け替え。ハシゴでクレバスを渡る前も必ず確保を。',
    only: 'touch',
  },
  {
    target: '#rest-btn',
    title: '休む／ピッケル',
    body: '押している間、立ち止まって呼吸を整えます。滑落したときは長押しでピッケルを打ち込み、滑落を止めます。',
    only: 'touch',
  },
  {
    target: null,
    title: '操作（キーボード）',
    body: 'WASD：移動　マウス：視点　Space長押し：休む／ピッケル　E：クリップ・付け替え　F：ボンベの回収・交換　Z / X：酸素流量　M：地図　Esc：一時停止',
    only: 'desktop',
  },
  {
    target: '#map-btn',
    title: '地図',
    body: 'タップすると地図を開きます。ルート、ロープ、ハシゴ、危険地帯、自分の位置と向き、遠征全体の高度図が見られます。',
  },
  {
    target: null,
    title: '出発',
    body: 'キャンプに着くたびに進み具合は保存されます。この説明は一時停止メニューの「画面の見かた」からいつでも見直せます。気をつけて。',
  },
];

export class Tutorial {
  private readonly root = document.getElementById('tutorial')!;
  private readonly spot = document.getElementById('tut-spot')!;
  private readonly card = document.getElementById('tut-card')!;
  private readonly titleEl = document.getElementById('tut-title')!;
  private readonly bodyEl = document.getElementById('tut-body')!;
  private readonly countEl = document.getElementById('tut-count')!;
  private readonly prevBtn = document.getElementById('tut-prev') as HTMLButtonElement;
  private readonly nextBtn = document.getElementById('tut-next') as HTMLButtonElement;
  private steps: Step[] = [];
  private index = 0;
  open = false;
  private onDone: () => void = () => undefined;

  constructor(private readonly touch: boolean) {
    this.prevBtn.addEventListener('click', () => this.go(this.index - 1));
    this.nextBtn.addEventListener('click', () => this.go(this.index + 1));
    document.getElementById('tut-skip')!.addEventListener('click', () => this.close());
    window.addEventListener('resize', () => { if (this.open) this.place(); });
  }

  start(onDone: () => void): void {
    this.onDone = onDone;
    this.steps = STEPS.filter((s) => !s.only || (s.only === 'touch') === this.touch);
    this.open = true;
    this.root.classList.remove('hidden');
    this.go(0);
  }

  private close(): void {
    this.open = false;
    this.root.classList.add('hidden');
    try { localStorage.setItem('dz8000-tutorial-done', '1'); } catch { /* ignore */ }
    this.onDone();
  }

  static seen(): boolean {
    try { return localStorage.getItem('dz8000-tutorial-done') === '1'; } catch { return false; }
  }

  private go(i: number): void {
    if (i >= this.steps.length) { this.close(); return; }
    this.index = Math.max(0, i);
    const st = this.steps[this.index];
    this.titleEl.textContent = st.title;
    this.bodyEl.textContent = st.body;
    this.countEl.textContent = `${this.index + 1} / ${this.steps.length}`;
    this.prevBtn.disabled = this.index === 0;
    this.nextBtn.textContent = this.index === this.steps.length - 1 ? '始める' : '次へ';
    this.place();
  }

  private place(): void {
    const st = this.steps[this.index];
    const el = st.target ? document.querySelector<HTMLElement>(st.target) : null;
    const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (r && r.width > 0) {
      const pad = 6;
      Object.assign(this.spot.style, {
        display: 'block',
        left: `${r.left - pad}px`, top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
      });
      // Card goes below the target if there is room, else above.
      const cw = Math.min(360, W - 24);
      let left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), W - cw - 12);
      this.card.style.width = `${cw}px`;
      this.card.style.left = `${left}px`;
      const ch = this.card.offsetHeight || 160;
      let top = r.bottom + 14;
      if (top + ch > H - 8) top = r.top - ch - 14;
      if (top < 8) { top = Math.max(8, H / 2 - ch / 2); left = Math.min(W - cw - 12, Math.max(12, r.right + 14)); this.card.style.left = `${left}px`; }
      this.card.style.top = `${top}px`;
      this.root.classList.remove('dim');
    } else {
      this.spot.style.display = 'none';
      const cw = Math.min(400, W - 24);
      this.card.style.width = `${cw}px`;
      this.card.style.left = `${(W - cw) / 2}px`;
      const ch = this.card.offsetHeight || 180;
      this.card.style.top = `${Math.max(12, (H - ch) / 2)}px`;
      this.root.classList.add('dim');
    }
  }
}
