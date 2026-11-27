import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../life/species';
import { BAIT, type BaitId } from './bait';
import { WEATHER, weatherOf } from './weather';
import { runFuguExam } from './kitchenGames';
import { CAT_NAME, DISH, FISHING, FUGU_EXAM, PENALTY, STORY, nightOf, dishFor, edibleInfo, fits, isFugu, isGoodCatch, poisonFor, fmtKg, makeOrders, marketPrice, repLevel, timeLabel, type Catch, type DishId, type Order } from './fishing';
import { yen } from './photoScore';

/** The land half of the game lives in the save next to the dex. */
export type LandSave = {
  money?: number;
  owned?: string[];
  /** diner reputation points */
  rep?: number;
  orders?: Order[];
  /** fish brought back and not used yet */
  cooler?: Catch[];
  day?: number;
  /** seconds dived today (dusk and night follow from it) */
  clock?: number;
  /** dish eaten for the next dive */
  buff?: DishId | null;
  /** last story chapter the player has read (reputation level) */
  story?: number;
  /** day on which the urchin sorting was last done */
  uniDay?: number;
  /** the landlady: how far her talk about the island has got, and what just happened (back from a dive / a new morning) */
  okami?: { lore: number; ev?: 'back' | 'morning' };
  /** bait in stock, in uses (Phase 4) */
  bait?: Partial<Record<BaitId, number>>;
  /** the notice board has been mentioned by the landlady */
  boardOn?: boolean;
};

type Progress = { found: number; chapter: number; spear: boolean };

/**
 * The landlady's talk about the island, told a little at a time, one piece per visit (never all at once).
 * The gear hint only says what works, never that something will be sold later.
 */
const LORE: { ok: (p: Progress) => boolean; text: string }[] = [
  { ok: () => true, text: 'あんたが編集長さんの言ってた写真家さんだね。あたしはハル、ここの女将さ。部屋は二階を使っておくれ。好きなだけ泊まっていきな' },
  { ok: () => true, text: 'この島はね、不思議と世界中の魚が集まってくるんだよ。南の派手な魚も、北の海の魚もね。理由？ 島の年寄りでも誰も知らないのさ' },
  { ok: (p) => p.found >= 10, text: 'ちょっと泳いだら寒い海にもいけるんだよ。流氷が流れ着く入り江まであるんだから、おかしな島だろう？' },
  { ok: (p) => p.found >= 15, text: 'すばしっこい魚はね、気づかれにくい格好で潜ると、近くまで寄らせてくれるって。昔泊まってたダイバーさんが言ってたよ' },
  { ok: (p) => p.chapter >= 3, text: '沖の深い所には、昔の町が沈んでるって言い伝えがあってね。石の柱を見たって漁師もいるんだよ。……まあ、酒の席の話だけどね' },
  { ok: (p) => p.found >= 20, text: '島の東の浜にはね、川が流れこんでるのさ。干潮のときは干潟が広がるんだよ' },
  { ok: (p) => p.found >= 25, text: '川を上ると滝があってね。山の神様のヌシが滝つぼに住んでるって、年寄りは言うね' },
];

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const LINES = {
  back: ['おかえり。今日の海はどうだった？', 'おかえり、冷えたろう。あったかいお茶があるよ', 'おかえり。無事に帰ってくるのが一番さ', 'おかえり。ほら、髪がまだ濡れてるよ'],
  backNew: ['いい顔してるね。いい写真が撮れたんだろう？', 'おかえり。その顔は、何か珍しいのに会ったね？'],
  morning: ['おはよう。今日もいい凪だよ', 'おはよう。朝ごはん、しっかり食べていきな', 'おはよう。今日はどこに潜るんだい？'],
  nightDark: ['夜の海は暗くて危ないよ。今日はもうゆっくり休みな', 'もう日が暮れたね。続きはまた明日さ'],
  day: ['気をつけて行っておいで', 'ここはいつでも開いてるからね', '潜る前は、ちゃんと水を飲んでおくんだよ'],
  toNight: ['夜の海に行くのかい？ ライトを忘れずにね', '夜は昼と別の魚が起きてくるからね。気をつけて'],
  board: ['おはよう。そうそう、島の人から依頼が来ているよ。ボートの「依頼の掲示板」に貼っておいたから、見てごらん'],
};

type Host = {
  save: LandSave;
  write: () => void;
  toast: (text: string, kind?: '' | 'warn' | 'danger', dur?: number) => void;
  chime: (big: boolean) => void;
  /** title screen needs a refresh (money, badges) */
  changed: () => void;
  known: (id: string) => boolean;
  /** a chart handed over in the story */
  grantMap: (id: string) => void;
  /** go diving straight away for the urchin harvest */
  urchinDive: () => void;
  hasTorch: () => boolean;
  progress: () => Progress;
};

const $ = (id: string) => document.getElementById(id)!;

/** しおさい亭: orders, the cooler, cooking, eating, and the end of the day. */
export class Kitchen {
  constructor(private host: Host) {
    $('k-close').addEventListener('click', () => this.close());
    $('k-sleep').addEventListener('click', () => this.timeButton());
  }

  /** what the landlady said on this visit (kept while the diner stays open) */
  private line = '';
  /** Phase 6: set right after an urchin harvest — using the time button then
      leaves the diner and returns to the menu, as the tracker asks. */
  leaveOnTimeChange = false;

  /** One word from the landlady: a piece of the island's story if one is due, else a greeting for the moment. */
  private say(ev?: 'back' | 'morning' | 'toNight'): void {
    const s = this.host.save;
    const o = (s.okami ??= { lore: 0 });
    const p = this.host.progress();
    if (ev === 'morning') {
      // Phase 4: the morning word is the day's weather (the island talk waits for the next visit);
      // on the morning the notice board is introduced, the two are told together
      const w = WEATHER[weatherOf(s.day ?? 1)];
      if (!s.boardOn) {
        s.boardOn = true;
        this.line = w.morning + LINES.board[0].replace(/^おはよう。/, ' ');
        this.host.write();
        return;
      }
      this.line = w.morning;
      return;
    }
    const L = LORE[o.lore];
    if (L && L.ok(p) && (o.lore === 0 || ev === 'back')) {
      this.line = L.text;
      o.lore++;
      this.host.write();
      return;
    }
    const night = nightOf(s.clock ?? 0) >= 0.5;
    this.line = pick(ev === 'toNight' ? LINES.toNight : ev === 'back' ? (this.newToday ? LINES.backNew : LINES.back) : night && !this.host.hasTorch() ? LINES.nightDark : LINES.day);
  }

  /** set by the game after a dive that found something new */
  newToday = false;

  /** The one time button: at night it is "sleep till morning", by day (with a light) it is "go out at night". */
  private timeButton(): void {
    const s = this.host.save;
    if (nightOf(s.clock ?? 0) >= 0.5) { this.sleep(); return; }
    if (!this.host.hasTorch()) return;
    s.clock = FISHING.duskAt + FISHING.duskLen;
    this.host.write();
    this.host.toast('日が暮れた。夜の海に潜れる', '', 2.5);
    this.say('toNight');
    if (this.leaveOnTimeChange) { this.leaveOnTimeChange = false; this.close(); this.host.changed(); return; }
    this.render();
  }

  /** Species that can turn up in an order: edible and found in waters a scuba diver can reach. */
  private pool(level: number): SpeciesDef[] {
    return SPECIES.filter((d) => isGoodCatch(d) && d.zone !== 'deep' && d.zone !== 'river' && d.depth[0] < 40 && (level >= FISHING.nightFreeLevel || d.when !== 'night'));
  }

  get licensed(): boolean {
    return !!this.host.save.owned?.includes('fugulicense');
  }

  get level(): number {
    return repLevel(this.host.save.rep ?? 0);
  }

  ensureOrders(): void {
    const s = this.host.save;
    if (!s.orders) s.orders = makeOrders(this.level, this.pool(this.level), Math.random, this.licensed);
    s.cooler ??= [];
    s.day ??= 1;
    s.clock ??= 0;
    s.rep ??= 0;
    s.story ??= 0;
  }

  /** Orders that a fish in the cooler can fill right now. */
  readyCount(): number {
    const s = this.host.save;
    return (s.orders ?? []).filter((o) => (s.cooler ?? []).some((c) => fits(o, SPECIES_BY_ID.get(c.id)!, c.kg))).length;
  }

  open(): void {
    this.ensureOrders();
    const o = (this.host.save.okami ??= { lore: 0 });
    const ev = o.ev;
    o.ev = undefined;
    this.say(ev);
    this.newToday = false;
    $('kitchen').classList.remove('hidden');
    this.render();
  }

  close(): void {
    $('kitchen').classList.add('hidden');
    this.host.changed();
  }

  get isOpen(): boolean {
    return !$('kitchen').classList.contains('hidden');
  }

  render(): void {
    const s = this.host.save;
    const lv = this.level;
    const rep = s.rep ?? 0;
    const next = FISHING.repLevels[lv];
    const prev = FISHING.repLevels[lv - 1];
    const stars = '★'.repeat(lv) + '☆'.repeat(FISHING.repLevels.length - lv);
    // before the hand spear the diner is only where the diver stays: no orders, no cooler yet
    const inn = !this.host.progress().spear;
    $('kitchen').classList.toggle('inn', inn);
    $('k-okami').innerHTML = `<b>女将のハルさん</b>「${this.line}」`;
    const wToday = WEATHER[weatherOf(s.day ?? 1)];
    $('k-status').innerHTML = inn ? `<span>${s.day}日目・<b>${timeLabel(s.clock ?? 0)}</b></span><span>天気 ${wToday.icon} <b>${wToday.name}</b></span><span>所持金 <b>${yen(s.money ?? 0)}</b></span>` : `<span>評判 <span class="stars">${stars}</span> Lv<b>${lv}</b></span><span>${s.day}日目・<b>${timeLabel(s.clock ?? 0)}</b></span><span>天気 ${wToday.icon} <b>${wToday.name}</b></span><span>所持金 <b>${yen(s.money ?? 0)}</b></span>` +
      (next !== undefined ? `<span>次のLvまで評判 <b>${next - rep}</b></span><div class="k-bar"><i style="width:${((rep - prev) / (next - prev)) * 100}%"></i></div>` : '<span>評判 最高！</span>');

    // story: one chapter per reputation level, shown until read
    const story = $('k-story');
    const unread = !inn && (s.story ?? 0) < lv;
    story.classList.toggle('hidden', !unread);
    if (unread) {
      const ch = STORY[(s.story ?? 0)];
      story.innerHTML = `<h4>第${(s.story ?? 0) + 1}話　${ch.title}</h4>${ch.text}${ch.rules ? `<ul class="k-rules">${ch.rules.map((r) => `<li>${r}</li>`).join('')}</ul>` : ''}${ch.map ? '<div class="k-map">海図を手に入れた！ ボートから直接行けるようになった</div>' : ''}<br><button type="button" class="btn sec" id="k-read">${(s.story ?? 0) + 1 < lv ? '次の話へ' : 'わかった'}</button>`;
      $('k-read').addEventListener('click', () => { if (ch.map) this.host.grantMap(ch.map); s.story = (s.story ?? 0) + 1; this.host.write(); this.render(); });
    }

    const cooler = s.cooler ?? [];
    const orders = s.orders ?? [];
    $('k-orders').innerHTML = orders.length
      ? orders.map((o) => {
          const ok = cooler.some((c) => fits(o, SPECIES_BY_ID.get(c.id)!, c.kg));
          return `<div class="k-item ${ok ? 'ready' : ''}"><div><div class="who">${o.guest}</div><div class="what">「${o.text}」</div><div class="pay">${yen(o.reward)}・評判+${o.rep}</div></div>
            <div class="acts"><button type="button" class="btn ${ok ? 'pri' : 'sec'}" data-serve="${o.id}" ${ok ? '' : 'disabled'}>${ok ? '作って出す' : '魚がない'}</button></div>
            ${!ok && o.hint ? `<div class="hint">ヒント：${o.hint}</div>` : ''}</div>`;
        }).join('')
      : '<div class="k-empty">今日の注文はぜんぶ出した！ 休めば明日の注文が届く。</div>';

    const buffNow = s.buff;
    $('k-cooler').innerHTML = cooler.length
      ? cooler.map((c, i) => {
          const def = SPECIES_BY_ID.get(c.id)!;
          const e = edibleInfo(def);
          const dish = DISH[dishFor(def, c.kg)];
          const knownPoison = false;
          void poisonFor;
          const fuguOk = this.licensed && isFugu(def);
          return `<div class="k-item ${knownPoison ? 'poison' : ''}"><div><div class="what">${this.host.known(def.id) ? def.name : '名前の分からない魚'}　${fmtKg(c.kg)}${knownPoison ? '　<span class="k-warn">毒あり</span>' : ''}${fuguOk ? '　<span class="k-ok">免許でさばける</span>' : ''}</div><div class="who">${e.ok ? CAT_NAME[e.cat] : ''} → ${dish.name}（食べると：${dish.short}）</div></div>
            <div class="acts"><button type="button" class="btn sec" data-eat="${i}">まかないで食べる</button><button type="button" class="btn sec" data-sell="${i}">市場へ${knownPoison ? '（処分）' : ' ' + yen(marketPrice(def, c.kg, this.licensed))}</button></div></div>`;
        }).join('')
      : '<div class="k-empty">クーラーは空っぽ。ボートから潜って、銛ボタンで魚を獲ってこよう。</div>';
    $('k-buff').innerHTML = buffNow
      ? `次のダイブ：まかないの<b>${DISH[buffNow].name}</b>で「${DISH[buffNow].buff}」`
      : '';
    const lv2 = this.level;
    const sortDone = s.uniDay === s.day;
    const work: string[] = [];
    work.push(`<div class="k-item"><div><div class="what">今日の仕込み：ウニ漁</div><div class="who">ウニ丼用のウニを獲りに、店の前の岩場へすぐ潜る（1日1回）</div></div><div class="acts"><button type="button" class="btn ${sortDone ? 'sec' : 'pri'}" id="k-sort" ${sortDone ? 'disabled' : ''}>${sortDone ? '今日は済んだ' : '海へ'}</button></div></div>`);
    if (this.licensed) work.push(`<div class="k-item"><div><div class="what">ふぐ調理師免許 <span class="k-ok">取得済み</span></div><div class="who">トラフグ・ヒガンフグ・クサフグなどをさばいて出せる（ほかの毒魚はだめ）</div></div></div>`);
    else if (lv2 >= FUGU_EXAM.level) work.push(`<div class="k-item"><div><div class="what">ふぐ調理師試験</div><div class="who">学科と実技。合格するとフグ料理を出せる（受験料 ${yen(FUGU_EXAM.fee)}・1問でも間違えると不合格）</div></div><div class="acts"><button type="button" class="btn sec" id="k-exam">受験する</button></div></div>`);

    $('k-work').innerHTML = work.join('');
    document.getElementById('k-sort')?.addEventListener('click', () => this.playSort());
    document.getElementById('k-exam')?.addEventListener('click', () => this.playExam());
    // one button, by the hour: sleep till morning at night; by day, go out at night once the diver has a light
    const night = nightOf(s.clock ?? 0) >= 0.5;
    $('k-sleep').className = `btn ${night ? 'pri' : 'sec'} k-time`;
    $('k-sleep').classList.toggle('hidden', !night && !this.host.hasTorch());
    $('k-sleep').innerHTML = night ? `☾→☀ 朝にする<small>${inn ? '部屋で寝る' : '店を閉めて寝る'}（${(s.day ?? 1) + 1}日目の朝へ）</small>` : '☀→☾ 夜にする<small>夜の海に潜れるようにする</small>';

    // Phase 4: the tackle shelf — bait for luring fish, sold in packs of BAIT.pack uses
    $('k-bait').innerHTML = BAIT.kinds.map((k) => {
      const have = s.bait?.[k.id] ?? 0;
      const afford = (s.money ?? 0) >= k.price;
      return `<div class="k-item"><div><div class="what">${k.name}　<span class="who">手持ち ${have}回分</span></div><div class="who">${k.desc}（${BAIT.pack}回分）</div></div>
        <div class="acts"><button type="button" class="btn sec" data-bait="${k.id}" ${afford ? '' : 'disabled'}>買う ${yen(k.price)}</button></div></div>`;
    }).join('');

    $('k-orders').querySelectorAll<HTMLButtonElement>('[data-serve]').forEach((b) => b.addEventListener('click', () => this.serve(b.dataset.serve!)));
    $('k-cooler').querySelectorAll<HTMLButtonElement>('[data-eat]').forEach((b) => b.addEventListener('click', () => this.eat(+b.dataset.eat!)));
    $('k-cooler').querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) => b.addEventListener('click', () => this.sell(+b.dataset.sell!)));
    $('k-bait').querySelectorAll<HTMLButtonElement>('[data-bait]').forEach((b) => b.addEventListener('click', () => this.buyBait(b.dataset.bait as BaitId)));
  }

  /** Buy a pack of bait at the tackle shelf. */
  buyBait(id: BaitId): void {
    const s = this.host.save;
    const k = BAIT.kinds.find((x) => x.id === id)!;
    if ((s.money ?? 0) < k.price) { this.host.toast(`所持金が足りない（${yen(k.price)}）`, 'warn'); return; }
    s.money = (s.money ?? 0) - k.price;
    (s.bait ??= {})[id] = (s.bait?.[id] ?? 0) + BAIT.pack;
    this.host.write();
    this.host.toast(`「${k.name}」を買った（${BAIT.pack}回分）。海中で餌ボタンからまける`, '', 3);
    this.render();
  }

  private mgOpen(): HTMLElement {
    $('mg').classList.remove('hidden');
    return $('mg-box');
  }

  private mgResult(html: string, bad = false): void {
    const box = $('mg-box');
    box.innerHTML = `<div class="mg-result ${bad ? 'bad' : ''}">${html}</div><button type="button" class="btn pri" id="mg-ok">店に戻る</button>`;
    $('mg-ok').addEventListener('click', () => { $('mg').classList.add('hidden'); box.innerHTML = ''; this.render(); });
  }

  private playSort(): void {
    const s = this.host.save;
    if (s.uniDay === s.day) return;
    s.uniDay = s.day;
    this.host.write();
    this.host.urchinDive();
  }

  /** Back from the urchin harvest. */
  harvestResult(ok: boolean, earned: number): void {
    this.mgOpen();
    this.mgResult(ok ? `仕込み完了！<br><b>ウニ丼が出せる</b><br>売上 +${yen(earned)}　評判+1` : `時間切れ…<br><b>ウニが足りなかった</b><br>${earned ? `売上 +${yen(earned)}` : 'また明日がんばろう'}`, !ok);
    if (ok) this.host.chime(true);
  }

  private playExam(): void {
    const s = this.host.save;
    if ((s.money ?? 0) < FUGU_EXAM.fee) { this.host.toast(`受験料 ${yen(FUGU_EXAM.fee)} が足りない`, 'warn'); return; }
    s.money = (s.money ?? 0) - FUGU_EXAM.fee;
    this.host.write();
    runFuguExam(this.mgOpen(), (ok, why) => {
      if (ok) {
        (s.owned ??= []).push('fugulicense');
        this.host.write();
        this.host.chime(true);
        this.mgResult('合格！<br><b>ふぐ調理師免許</b>を手に入れた<br>トラフグ・ヒガンフグ・クサフグなどをさばいて出せるようになった。ふぐ料理の注文も来るようになる');
      } else {
        this.mgResult(`不合格…<br><b>${why}</b><br>受験料を払えば、また受けられる`, true);
      }
    });
  }

  /** Big praise for a finished dish (hit-stop-like pop, chime, count). */
  private pop(dish: string, sub: string, big: boolean, bad = false): void {
    const el = $('cook-pop');
    el.classList.toggle('bad', bad);
    $('cp-dish').textContent = dish;
    $('cp-sub').textContent = sub;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    if (!bad) this.host.chime(big);
  }

  serve(orderId: string): void {
    const s = this.host.save;
    const o = s.orders?.find((x) => x.id === orderId);
    if (!o) return;
    // use the lightest fish that fills the order, keep bigger ones for later
    const idx = (s.cooler ?? [])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => fits(o, SPECIES_BY_ID.get(c.id)!, c.kg))
      .sort((a, b) => a.c.kg - b.c.kg)[0]?.i;
    if (idx === undefined) return;
    const c = s.cooler!.splice(idx, 1)[0];
    const def = SPECIES_BY_ID.get(c.id)!;
    const before = this.level;
    if (poisonFor(def, this.licensed)) {
      // the guest gets food poisoning: pay the hospital and compensation, the diner's name suffers
      const pay = o.reward * PENALTY.poisonServeMult;
      s.money = Math.max(0, (s.money ?? 0) - pay);
      s.rep = Math.max(0, (s.rep ?? 0) - PENALTY.poisonServeRep);
      s.orders = s.orders!.filter((x) => x !== o);
      this.pop('食中毒が出てしまった…', `${def.name}には毒があった。${o.guest}は病院へ。慰謝料 -${yen(pay)}　評判-${PENALTY.poisonServeRep}`, false, true);
      this.host.write();
      this.render();
      return;
    }
    s.money = (s.money ?? 0) + o.reward;
    s.rep = (s.rep ?? 0) + o.rep;
    s.orders = s.orders!.filter((x) => x !== o);
    const up = this.level > before;
    this.pop(`${def.name}の${DISH[o.dish].name}`, `${o.guest}「おいしい！」　+${yen(o.reward)}　評判+${o.rep}${up ? `　評判Lv${this.level}に！` : ''}`, up || o.rep >= 3);
    this.host.write();
    this.render();
  }

  eat(i: number): void {
    const s = this.host.save;
    const c = s.cooler?.[i];
    if (!c) return;
    const def = SPECIES_BY_ID.get(c.id)!;
    const d = dishFor(def, c.kg);
    s.cooler!.splice(i, 1);
    if (poisonFor(def, this.licensed)) {
      s.money = Math.max(0, (s.money ?? 0) - PENALTY.hospital);
      s.buff = null;
      this.pop('食中毒で病院へ…', `${def.name}には毒があった。治療費 -${yen(PENALTY.hospital)}`, false, true);
      this.host.write();
      this.render();
      return;
    }
    s.buff = d;
    this.pop(`${def.name}の${DISH[d].name}`, `いただきます！ 次のダイブ：${DISH[d].short}`, false);
    if (d === 'nabe') { s.rep = (s.rep ?? 0) + 1; }
    this.host.write();
    this.render();
  }

  sell(i: number): void {
    const s = this.host.save;
    const c = s.cooler?.[i];
    if (!c) return;
    const def = SPECIES_BY_ID.get(c.id)!;
    const v = marketPrice(def, c.kg, this.licensed);
    s.cooler!.splice(i, 1);
    s.money = (s.money ?? 0) + v;
    const bad = poisonFor(def, this.licensed);
    this.host.toast(bad ? `市場「${def.name}は毒魚だ。引き取れないよ」— 処分した` : `市場に卸した　+${yen(v)}`, bad ? 'warn' : '');
    this.host.write();
    this.render();
  }

  /** End of the day: leftovers go to the market, the clock returns to morning, new guests come tomorrow. */
  sleep(): void {
    const s = this.host.save;
    if (nightOf(s.clock ?? 0) < 0.5) return;
    const left = s.cooler ?? [];
    const v = left.reduce((a, c) => a + marketPrice(SPECIES_BY_ID.get(c.id)!, c.kg), 0);
    s.money = (s.money ?? 0) + v;
    s.cooler = [];
    s.day = (s.day ?? 1) + 1;
    s.clock = 0;
    s.orders = makeOrders(this.level, this.pool(this.level), Math.random, this.licensed);
    this.host.write();
    this.host.toast(`${s.day}日目の朝。${this.host.progress().spear ? '新しい注文が届いた' : 'よく眠れた'}${left.length ? `（残りの魚は市場へ +${yen(v)}）` : ''}`, '', 3.5);
    this.say('morning');
    if (this.leaveOnTimeChange) { this.leaveOnTimeChange = false; this.close(); this.host.changed(); return; }
    this.render();
  }
}
