/**
 * Camp: the arrival celebration and the evening at camp (meal, the dog, the logbook,
 * oxygen loadout before the summit push). Pure DOM/SVG so it stays light on phones.
 */
export type MealId = 'ramen' | 'dalbhat' | 'choco' | 'tea';

export interface Meal {
  id: MealId;
  name: string;
  price: number;
  /** cook tent only (base camp / C2) */
  full?: boolean;
  effect: string;
  sound: 'slurp' | 'munch' | 'gulp';
}

export const MEALS: Meal[] = [
  { id: 'ramen', name: 'カップラーメン', price: 400, effect: '体が芯から温まる。次の区間、体温が下がりにくい', sound: 'slurp' },
  { id: 'dalbhat', name: 'ダルバート', price: 700, full: true, effect: '「ダルバート・パワー」。次の区間、体力の回復が速い＋高度順応+100m', sound: 'munch' },
  { id: 'choco', name: 'チョコバー', price: 200, effect: '手軽な高カロリー。次の区間、体力の減りが少ない', sound: 'munch' },
  { id: 'tea', name: 'ミルクティー', price: 250, effect: '指先に血が通う。凍傷が回復し、次の区間は凍傷が進みにくい', sound: 'gulp' },
];

export const TREAT = { name: 'ヤクのチーズ（チュルピ）', price: 300 };
export const DOG_NAMES = ['モモ', 'ツェリン', 'ヒマール'];

export interface DogState { name: string; affection: number }

export interface CampData {
  kicker: string;
  title: string;
  desc: string;
  money: number;
  grade: { name: string; tone: string; isNew: boolean; praise: string } | null;
  rows: [string, string][];
  kitchen: 'full' | 'basic';
  ateTonight: MealId | null;
  dog: DogState | null;
  dogMeet: boolean;
  pettedTonight: boolean;
  /** spare-bottle choice when the next leg is the summit push */
  loadout: number | null;
  departLabel: string;
  lore: { got: Set<string>; list: { id: string; title: string; body: string; item: string; stage: string }[] };
}

export interface CampActions {
  data(): CampData;
  eat(id: MealId): boolean;
  treat(): boolean;
  pet(): void;
  adopt(name: string): void;
  spares(n: number): void;
  depart(): void;
  rest(): void;
  quit(): void;
  sound(kind: 'slurp' | 'munch' | 'gulp' | 'bark' | 'coin' | 'stamp' | 'fanfare' | 'clink'): void;
}

export interface ArrivalInfo {
  kicker: string;
  title: string;
  sub: string;
  grade: { name: string; tone: string; isNew: boolean } | null;
  reward: number;
  dogName: string | null;
}

/** Dog affection tiers: each unlocks something you can feel on the mountain. */
export function dogTier(a: number): { hearts: number; perk: string; next: string } {
  if (a >= 60) return { hearts: 3, perk: '崩落や落石の直前に吠えて知らせる', next: '' };
  if (a >= 30) return { hearts: 2, perk: '休むと寄り添って、体温が下がりにくい', next: '♥3 (60) で、崩落や落石の直前に吠えて知らせる' };
  return { hearts: 1, perk: '一緒に歩く', next: '♥2 (30) で、休むと寄り添って体温が下がりにくい' };
}

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const yen = (n: number) => `${n.toLocaleString('en-US')} ルピー`;

// ---------------------------------------------------------------- SVG art
const FOOD_SVG: Record<MealId, string> = {
  ramen: `
    <g class="food-ramen">
      <path d="M118 150 L202 150 L194 222 L126 222 Z" fill="#f4f1ea"/>
      <path d="M121 170 L199 170 L197 186 L123 186 Z" fill="#d8402f"/>
      <text x="160" y="182" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="sans-serif">ラーメン</text>
      <ellipse cx="160" cy="150" rx="42" ry="9" fill="#e9b66b"/>
      <ellipse class="broth" cx="160" cy="151" rx="38" ry="7" fill="#c98b3c"/>
      <path class="noodles" d="M130 150 q6 -5 12 0 t12 0 t12 0 t12 0 t12 0" stroke="#f6dc87" stroke-width="3" fill="none"/>
      <g class="sticks"><line x1="150" y1="148" x2="214" y2="70" stroke="#a5713f" stroke-width="4" stroke-linecap="round"/><line x1="160" y1="150" x2="222" y2="76" stroke="#8d5f33" stroke-width="4" stroke-linecap="round"/>
        <path class="lift" d="M154 144 q3 -12 0 -24 q-3 -12 2 -22" stroke="#f6dc87" stroke-width="3" fill="none"/></g>
    </g>`,
  dalbhat: `
    <g class="food-dalbhat">
      <ellipse cx="160" cy="196" rx="74" ry="24" fill="#b8bec6"/>
      <ellipse cx="160" cy="192" rx="68" ry="20" fill="#d9dde2"/>
      <ellipse class="bite b1" cx="140" cy="186" rx="26" ry="11" fill="#fbfaf5"/>
      <ellipse class="bite b2" cx="186" cy="182" rx="14" ry="7" fill="#e7b43a"/>
      <ellipse class="bite b3" cx="185" cy="198" rx="13" ry="6" fill="#5f9a4a"/>
      <ellipse cx="128" cy="200" rx="9" ry="4" fill="#d6532f"/>
    </g>`,
  choco: `
    <g class="food-choco">
      <rect x="112" y="168" width="96" height="30" rx="4" fill="#3d2414"/>
      <rect class="wrap" x="150" y="164" width="62" height="38" rx="3" fill="#b8312d"/>
      <text x="181" y="188" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" font-family="sans-serif">ENERGY</text>
      <rect class="eaten" x="104" y="160" width="0" height="46" fill="url(#sceneBg)"/>
    </g>`,
  tea: `
    <g class="food-tea">
      <path d="M130 160 L190 160 L186 222 L134 222 Z" fill="#e4e8ec"/>
      <path d="M190 172 q22 4 18 24 q-4 16 -20 14" stroke="#e4e8ec" stroke-width="7" fill="none"/>
      <ellipse class="tea-level" cx="160" cy="162" rx="28" ry="5" fill="#c99b6d"/>
    </g>`,
};

const DOG_SVG = `
  <g id="sc-dog" class="sc-dog">
    <g class="tail"><path d="M26 0 q18 -10 12 -26 q-4 -8 -10 -2" stroke="#b4865a" stroke-width="7" fill="none" stroke-linecap="round"/></g>
    <ellipse cx="0" cy="0" rx="30" ry="20" fill="#b4865a"/>
    <ellipse cx="-4" cy="-8" rx="20" ry="10" fill="#5a3d26"/>
    <ellipse cx="-24" cy="10" rx="12" ry="16" fill="#e9e1d4"/>
    <rect x="-34" y="8" width="9" height="24" rx="4" fill="#b4865a"/><rect x="-20" y="8" width="9" height="24" rx="4" fill="#b4865a"/>
    <ellipse cx="-29" cy="32" rx="7" ry="4" fill="#e9e1d4"/><ellipse cx="-15" cy="32" rx="7" ry="4" fill="#e9e1d4"/>
    <ellipse cx="18" cy="16" rx="14" ry="10" fill="#b4865a"/>
    <g class="head">
      <ellipse cx="-30" cy="-22" rx="16" ry="14" fill="#b4865a"/>
      <ellipse cx="-42" cy="-17" rx="9" ry="6" fill="#e9e1d4"/>
      <circle cx="-49" cy="-19" r="3" fill="#1b1512"/>
      <circle cx="-34" cy="-26" r="2.2" fill="#1b1512"/>
      <path d="M-24 -32 l6 -14 l4 14 z" fill="#5a3d26"/><path d="M-36 -33 l2 -14 l7 12 z" fill="#5a3d26"/>
      <path class="tongue" d="M-44 -12 q2 7 5 0" fill="#e06b78"/>
    </g>
  </g>`;

function sceneSvg(dog: boolean): string {
  return `
  <svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="sceneBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1422"/><stop offset="0.7" stop-color="#1e3652"/><stop offset="1" stop-color="#2b4361"/></linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb35c" stop-opacity="0.55"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="320" height="240" fill="url(#sceneBg)"/>
    <g fill="#fff" opacity="0.8"><circle cx="30" cy="22" r="1"/><circle cx="90" cy="40" r="0.8"/><circle cx="150" cy="16" r="1.1"/><circle cx="230" cy="30" r="0.9"/><circle cx="290" cy="12" r="1"/><circle cx="260" cy="58" r="0.7"/></g>
    <path d="M0 150 L60 90 L95 118 L150 50 L200 110 L240 84 L320 140 L320 240 L0 240 Z" fill="#c9d6e4" opacity="0.9"/>
    <path d="M150 50 L172 76 L160 74 L150 88 L140 72 L130 76 Z" fill="#fff"/>
    <path d="M0 190 Q160 168 320 186 L320 240 L0 240 Z" fill="#e8eef5"/>
    <g class="tent"><path d="M206 196 L262 118 L318 196 Z" fill="#f2a516"/><path d="M262 118 L250 196 L274 196 Z" fill="#7a4a06"/><path d="M262 118 L318 196" stroke="#222" stroke-width="2"/></g>
    <circle cx="246" cy="186" r="46" fill="url(#glow)"/>
    <g class="stove"><rect x="236" y="196" width="22" height="10" rx="2" fill="#444"/><path class="flame" d="M247 196 q-6 -8 0 -16 q6 8 0 16" fill="#5fb8ff"/></g>
    ${dog ? `<g transform="translate(78 186) scale(0.9)">${DOG_SVG}</g>` : ''}
    <g id="sc-hearts"></g>
    <g id="sc-food"></g>
    <g id="sc-steam"></g>
  </svg>
  <div id="sc-pop"></div>`;
}

export class CampScreen {
  private actions: CampActions | null = null;
  private tab: 'meal' | 'dog' | 'log' | 'result' = 'result';
  private anim: { finish: () => void } | null = null;
  private arriveDone: (() => void) | null = null;
  private arriveTimers: number[] = [];

  constructor() {
    $('arrive').addEventListener('click', () => this.finishArrival());
    $('camp-scene').addEventListener('click', () => this.anim?.finish());
  }

  // ------------------------------------------------------------ arrival
  /** Prayer flags, a slammed grade stamp and the sponsor money counting up. */
  celebrate(info: ArrivalInfo, sound: CampActions['sound'], done: () => void): void {
    const el = $('arrive');
    this.arriveDone = done;
    $('arrive-kicker').textContent = info.kicker;
    $('arrive-title').textContent = info.title;
    $('arrive-sub').textContent = info.sub;
    const stamp = $('arrive-stamp');
    stamp.className = '';
    stamp.innerHTML = info.grade ? `${esc(info.grade.name)}${info.grade.isNew ? '<small>自己ベスト更新</small>' : ''}` : '';
    if (info.grade) stamp.classList.add(info.grade.tone);
    const money = $('arrive-money');
    money.textContent = '';
    const flags = $('arrive-flags');
    const cols = ['#2f6fd0', '#f4f4f4', '#d8402f', '#3d9a4f', '#f2c014'];
    flags.innerHTML = [0, 1].map((row) => `<div class="flagline r${row}">${Array.from({ length: 22 }, (_, i) =>
      `<i style="background:${cols[i % 5]};animation-delay:${(i * 0.04 + row * 0.2).toFixed(2)}s"></i>`).join('')}</div>`).join('');
    const dog = $('arrive-dog');
    dog.classList.toggle('hidden', !info.dogName);
    dog.textContent = info.dogName ? `${info.dogName}「ワン！」` : '';
    el.classList.remove('hidden', 'play');
    void el.offsetWidth;
    el.classList.add('play');
    sound('fanfare');
    const T = (ms: number, fn: () => void) => this.arriveTimers.push(window.setTimeout(fn, ms));
    if (info.grade) T(900, () => { stamp.classList.add('hit'); sound('stamp'); });
    if (info.dogName) T(1200, () => sound('bark'));
    if (info.reward > 0) {
      T(1400, () => {
        const steps = 14;
        for (let i = 1; i <= steps; i++) {
          T(i * 55, () => {
            money.textContent = `スポンサー報奨金 +${Math.round((info.reward * i) / steps).toLocaleString('en-US')} ルピー`;
            if (i % 2 === 0 || i === steps) sound('coin');
          });
        }
      });
    }
    T(4200, () => this.finishArrival());
  }

  private finishArrival(): void {
    if (!this.arriveDone) return;
    for (const t of this.arriveTimers) clearTimeout(t);
    this.arriveTimers = [];
    $('arrive').classList.add('hidden');
    const d = this.arriveDone;
    this.arriveDone = null;
    d();
  }

  // ------------------------------------------------------------ camp
  open(actions: CampActions): void {
    this.actions = actions;
    const d = actions.data();
    this.tab = d.dogMeet ? 'dog' : d.grade ? 'result' : 'meal';
    $('camp-scene').innerHTML = sceneSvg(!!d.dog);
    this.render();
    $('camp').classList.remove('hidden');
    if (d.dog) this.hearts(1);
  }

  close(): void {
    this.anim?.finish();
    $('camp').classList.add('hidden');
    this.actions = null;
  }

  get isOpen(): boolean { return !$('camp').classList.contains('hidden'); }
  get celebrating(): boolean { return this.arriveDone !== null; }

  private render(): void {
    const a = this.actions;
    if (!a) return;
    const d = a.data();
    // the dog appears in the scene once adopted
    if (d.dog && !document.getElementById('sc-dog')) $('camp-scene').innerHTML = sceneSvg(true);
    const tabs: [typeof this.tab, string][] = [
      ['result', '今日の記録'], ['meal', '食事'], ['dog', d.dog ? d.dog.name : d.dogMeet ? '犬？' : '犬'], ['log', '記録帳'],
    ];
    const side = $('camp-side');
    side.innerHTML = `
      <p class="kicker">${esc(d.kicker)}</p>
      <h2>${esc(d.title)}</h2>
      <div class="camp-money">${yen(d.money)}</div>
      <div class="camp-tabs">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === this.tab ? 'on' : ''}${k === 'dog' && d.dogMeet ? ' ping' : ''}">${esc(l)}</button>`).join('')}</div>
      <div class="camp-body">${this.body(d)}</div>
      <div class="camp-foot">
        <button type="button" class="primary" data-act="depart">${esc(d.departLabel)}</button>
        <div class="camp-foot2"><button type="button" data-act="rest">休養（+1日・順応+）</button><button type="button" data-act="quit">山を選び直す</button></div>
      </div>`;
    side.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab as typeof this.tab; this.render(); }));
    side.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act!, b.dataset.arg)));
  }

  private body(d: CampData): string {
    if (this.tab === 'result') {
      return `
        ${d.grade ? `<div class="grade ${d.grade.tone}">${esc(d.grade.name)}${d.grade.isNew ? '<span class="new">自己ベスト</span>' : ''}</div><p class="praise">${esc(d.grade.praise)}</p>` : ''}
        <p class="desc">${esc(d.desc)}</p>
        <dl class="camp-stats">${d.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${d.loadout !== null ? this.loadoutHtml(d.loadout) : ''}`;
    }
    if (this.tab === 'meal') {
      const meals = MEALS.filter((m) => !m.full || d.kitchen === 'full');
      return `
        <p class="desc">${d.kitchen === 'full' ? 'キッチンテントがある。温かい食事が出せる。' : '雪を溶かしてお湯を沸かす。食べられるのは持ち上げた物だけ。'}${d.ateTonight ? '' : '<br>今夜の一食を選ぶ（効果は次の区間）。'}</p>
        <div class="shop">${meals.map((m) => {
          const ate = d.ateTonight === m.id;
          const dis = !!d.ateTonight || d.money < m.price;
          return `<button type="button" class="item${ate ? ' ate' : ''}" data-act="eat" data-arg="${m.id}" ${dis ? 'disabled' : ''}>
            <b>${esc(m.name)}</b><span class="price">${ate ? '食べた' : yen(m.price)}</span><small>${esc(m.effect)}</small></button>`;
        }).join('')}</div>`;
    }
    if (this.tab === 'dog') {
      if (!d.dog && d.dogMeet) {
        return `<p class="desc">テントの外で、薄茶色の犬がじっとこちらを見ている。ベースキャンプから登山者の後をついてきたらしい。ラーメンの匂いにつられたのかもしれない。</p>
          <p class="desc">名前をつけて、連れていく？</p>
          <div class="names">${DOG_NAMES.map((n) => `<button type="button" data-act="adopt" data-arg="${n}">${esc(n)}</button>`).join('')}</div>`;
      }
      if (!d.dog) return '<p class="desc">犬の姿はない。</p>';
      const t = dogTier(d.dog.affection);
      const hearts = [1, 2, 3].map((i) => `<i class="${i <= t.hearts ? 'on' : ''}">♥</i>`).join('');
      return `
        <div class="dog-head"><b>${esc(d.dog.name)}</b><span class="hearts">${hearts}</span><span class="aff">なつき度 ${Math.round(d.dog.affection)}</span></div>
        <div class="aff-bar"><div style="width:${Math.min(100, d.dog.affection)}%"></div><i style="left:30%"></i><i style="left:60%"></i></div>
        <p class="desc">いまの効果：${esc(t.perk)}${t.next ? `<br><small>次：${esc(t.next)}</small>` : ''}</p>
        <div class="shop">
          <button type="button" class="item" data-act="treat" ${d.money < TREAT.price ? 'disabled' : ''}><b>${esc(TREAT.name)}</b><span class="price">${yen(TREAT.price)}</span><small>ヒマラヤの犬の大好物。なつき度 +20</small></button>
          <button type="button" class="item" data-act="pet" ${d.pettedTonight ? 'disabled' : ''}><b>なでる</b><span class="price">${d.pettedTonight ? '今夜はもうなでた' : '無料'}</span><small>なつき度 +5（1晩に1回）</small></button>
        </div>`;
    }
    // logbook
    const got = d.lore.list.filter((l) => d.lore.got.has(l.id));
    return `<p class="desc">山で拾った、先人たちの遺した物。${got.length} / ${d.lore.list.length}</p>
      <div class="log">${d.lore.list.map((l) => d.lore.got.has(l.id)
        ? `<details><summary>${esc(l.title)}</summary><p><small>${esc(l.item)}</small><br>${esc(l.body)}</p></details>`
        : '<div class="locked">？？？</div>').join('')}</div>`;
  }

  private loadoutHtml(cur: number): string {
    const opts: [number, string, string][] = [
      [0, '予備 0本 — 軽い', '歩く速さ +6%。使っている1本が尽きたら無酸素'],
      [1, '予備 1本 — 標準', '速さ ±0。往復ぎりぎりの量'],
      [2, '予備 2本 — 重い', '歩く速さ −6%。酸素に余裕、流量を上げられる'],
    ];
    return `<div class="load-h">山頂アタックに持つ酸素ボンベ</div><div class="load">${opts.map(([v, a, b]) =>
      `<button type="button" class="${v === cur ? 'sel' : ''}" data-act="spares" data-arg="${v}"><b>${a}</b><small>${b}</small></button>`).join('')}</div>`;
  }

  private act(act: string, arg?: string): void {
    const a = this.actions;
    if (!a) return;
    switch (act) {
      case 'eat': {
        const m = MEALS.find((x) => x.id === arg);
        if (m && a.eat(m.id)) { this.render(); this.playMeal(m); }
        break;
      }
      case 'treat':
        if (a.treat()) { this.render(); this.playTreat(); }
        break;
      case 'pet':
        a.pet(); this.render(); this.hearts(2); a.sound('bark');
        break;
      case 'adopt':
        if (arg) { a.adopt(arg); this.render(); this.hearts(3); a.sound('bark'); }
        break;
      case 'spares': a.spares(Number(arg)); this.render(); break;
      case 'depart': this.anim?.finish(); a.depart(); break;
      case 'rest': this.anim?.finish(); a.rest(); break;
      case 'quit': this.anim?.finish(); a.quit(); break;
    }
  }

  // ------------------------------------------------------------ animations
  private pop(text: string, cls = ''): void {
    const p = document.createElement('div');
    p.className = `pop ${cls}`;
    p.textContent = text;
    $('sc-pop').appendChild(p);
    window.setTimeout(() => p.remove(), 1400);
  }

  private hearts(n: number): void {
    const g = document.getElementById('sc-hearts');
    if (!g) return;
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => {
        const h = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        h.setAttribute('x', String(60 + Math.random() * 30));
        h.setAttribute('y', '150');
        h.setAttribute('class', 'heart');
        h.textContent = '♥';
        g.appendChild(h);
        window.setTimeout(() => h.remove(), 1500);
      }, i * 220);
    }
  }

  /** Steam, three bites with sound and a word each, the level going down, then the effect. */
  private playMeal(m: Meal): void {
    this.anim?.finish();
    const a = this.actions!;
    const food = $('sc-food');
    const steam = $('sc-steam');
    food.innerHTML = `<g transform="translate(-60 -70) scale(1.38)">${FOOD_SVG[m.id]}</g>`;
    food.setAttribute('class', `eating ${m.id}`);
    steam.innerHTML = m.id === 'choco' ? '' : [0, 1, 2].map((i) =>
      `<path class="wisp" style="animation-delay:${i * 0.45}s" d="M${144 + i * 16} 128 q-8 -14 0 -28 q8 -14 0 -28" stroke="#fff" stroke-width="3" fill="none" opacity="0"/>`).join('');
    const words = m.sound === 'slurp' ? ['ずずっ', 'ずるずる…', 'ふーっ'] : m.sound === 'gulp' ? ['ごくっ', 'ごくごく', 'はぁ…'] : ['もぐもぐ', 'ぱくっ', 'もぐ…'];
    const timers: number[] = [];
    let bite = 0;
    const doBite = () => {
      bite += 1;
      food.setAttribute('class', `eating ${m.id} bite${bite}`);
      a.sound(m.sound);
      this.pop(words[bite - 1]);
    };
    [500, 1300, 2100].forEach((t) => timers.push(window.setTimeout(doBite, t)));
    const end = () => {
      timers.forEach(clearTimeout);
      food.setAttribute('class', `eating ${m.id} bite3 done`);
      this.pop('ごちそうさま', 'big');
      this.pop(m.effect, 'effect');
      a.sound('clink');
      window.setTimeout(() => { food.innerHTML = ''; steam.innerHTML = ''; }, 900);
      this.anim = null;
    };
    timers.push(window.setTimeout(end, 2900));
    this.anim = { finish: () => { if (this.anim) end(); } };
  }

  private playTreat(): void {
    const a = this.actions!;
    const dog = document.getElementById('sc-dog');
    dog?.classList.remove('chew');
    void (dog as unknown as HTMLElement | null)?.getBoundingClientRect();
    dog?.classList.add('chew');
    a.sound('munch');
    window.setTimeout(() => a.sound('munch'), 350);
    window.setTimeout(() => { a.sound('bark'); this.hearts(4); this.pop('なつき度 +20', 'effect'); }, 800);
  }
}
