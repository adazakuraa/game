import { CampScene3D } from './CampScene3D';

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

export class CampScreen {
  private actions: CampActions | null = null;
  private tab: 'meal' | 'dog' | 'log' | 'result' = 'result';
  private anim: { finish: () => void } | null = null;
  private arriveDone: (() => void) | null = null;
  private arriveTimers: number[] = [];
  private readonly scene3d = new CampScene3D();

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
    const host = $('camp-scene');
    host.innerHTML = '<div id="sc-pop"></div><div id="sc-hearts"></div>';
    $('camp').classList.remove('hidden');
    this.scene3d.mount(host);
    this.scene3d.setDog(!!d.dog);
    this.render();
    if (d.dog) window.setTimeout(() => this.hearts(1), 400);
  }

  close(): void {
    this.anim?.finish();
    this.scene3d.unmount();
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
    if (d.dog) this.scene3d.setDog(true);
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
        a.pet(); this.render(); this.scene3d.dogPet(); this.hearts(2); a.sound('bark');
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
    const layer = document.getElementById('sc-hearts');
    if (!layer) return;
    const at = this.scene3d.dogScreen();
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => {
        const h = document.createElement('i');
        h.className = 'heart';
        h.textContent = '♥';
        h.style.left = `${(at.x * 100 + (Math.random() - 0.5) * 8).toFixed(1)}%`;
        h.style.top = `${(at.y * 100 - 6).toFixed(1)}%`;
        layer.appendChild(h);
        window.setTimeout(() => h.remove(), 1500);
      }, i * 220);
    }
  }

  /** The camera leans in, three bites with sound and a word each, the level drops, then the effect. */
  private playMeal(m: Meal): void {
    this.anim?.finish();
    const a = this.actions!;
    this.scene3d.showFood(m.id);
    const words = m.sound === 'slurp' ? ['ずずっ', 'ずるずる…', 'ふーっ'] : m.sound === 'gulp' ? ['ごくっ', 'ごくごく', 'はぁ…'] : ['もぐもぐ', 'ぱくっ', 'もぐ…'];
    const timers: number[] = [];
    let bite = 0;
    const doBite = () => {
      bite += 1;
      this.scene3d.bite(bite);
      window.setTimeout(() => a.sound(m.sound), 300);
      window.setTimeout(() => this.pop(words[bite - 1]), 300);
    };
    [900, 1900, 2900].forEach((t) => timers.push(window.setTimeout(doBite, t)));
    const end = () => {
      timers.forEach(clearTimeout);
      if (bite < 3) this.scene3d.bite(3);
      this.pop('ごちそうさま', 'big');
      this.pop(m.effect, 'effect');
      a.sound('clink');
      window.setTimeout(() => this.scene3d.clearFood(), 1200);
      this.anim = null;
    };
    timers.push(window.setTimeout(end, 4000));
    this.anim = { finish: () => { if (this.anim) end(); } };
  }

  private playTreat(): void {
    const a = this.actions!;
    this.scene3d.dogTreat();
    a.sound('munch');
    window.setTimeout(() => a.sound('munch'), 350);
    window.setTimeout(() => { a.sound('bark'); this.hearts(4); this.pop('なつき度 +20', 'effect'); }, 900);
  }
}
