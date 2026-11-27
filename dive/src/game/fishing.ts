import type { SpeciesDef } from '../life/species';

/**
 * Spearfishing and the seaside diner (しおさい亭).
 *
 * Why the player dives with a spear: the diner on land has guests with orders (a clear goal), the catch
 * becomes money and reputation (the reward), and the reputation moves the story and unlocks gear (the
 * next goal). Eating a dish yourself (まかない) powers up the next dive, so the land feeds the sea and the
 * sea feeds the land. Risk sits next to reward: the cooler has a weight limit, blood draws sharks, and a
 * blackout loses the catch.
 * All tuning values live in FISHING.
 */
export const FISHING = {
  /** 【道具】reach (m), reload time (s), largest fish it can hold (kg) */
  tools: {
    hand: { name: '手銛', range: 2.2, reload: 1.1, maxKg: 8, tier: 0 },
    gun: { name: '水中銃', range: 6, reload: 2.4, maxKg: 60, tier: 1 },
    big: { name: '大物用水中銃', range: 7, reload: 3, maxKg: 400, tier: 2 },
  },
  /**
   * 【撃退】a well-timed thrust at a charging aggro animal (mode 2) turns it away instead of taking it.
   * Window: body-surface distance (distance − size×0.45) ≤ the tool's range and the animal has not reached
   * hit distance (size×0.45 + 0.55). Tier needed: 0 territory / light (any spear), 1 ordinary sharks (gun),
   * 2 every species incl. the legendary Dunkleosteus / Megalodon (big-game gun).
   * cooldown: seconds the animal will not go aggro again; just: a thrust within `justBand` m of the hit distance.
   */
  repel: { cooldown: 30, justCooldown: 90, justBand: 1.2, hitBase: 0.55 },
  /** 【クーラーの容量】kg: net bag / cooler / big cooler */
  bag: [5, 15, 40],
  /** 【小さすぎる魚】fish lighter than this are let go (kg) */
  minKg: 0.08,
  /** 【血の匂い】chance that each roaming shark within range comes to circle after a catch */
  bloodChance: 0.35,
  bloodRange: 45,
  /** 【市場の買い取り】yen per kg by kind of fish; what is left in the cooler at night goes here */
  market: { shiro: 600, ao: 450, iso: 250, ika: 700 },
  /** 【評判レベル】reputation points needed for Lv1..6 */
  repLevels: [0, 3, 8, 15, 25, 40],
  /** 【夜になる時刻】seconds of diving in a day before dusk begins, and how long dusk lasts */
  duskAt: 600,
  duskLen: 180,
  /** 【夜を選べるようになる評判レベル】 */
  nightFreeLevel: 3,
};

export type Cat = 'shiro' | 'ao' | 'iso' | 'ika';
export const CAT_NAME: Record<Cat, string> = { shiro: '白身魚', ao: '青魚', iso: '磯の魚', ika: 'イカ・タコ' };

export type DishId = 'nitsuke' | 'sashimi' | 'shioyaki' | 'karaage' | 'nabe' | 'fugu';
/** Each kind of fish has its dish; eating it yourself gives a power-up for the next dive. */
export const DISH: Record<DishId, { name: string; buff: string; short: string }> = {
  nitsuke: { name: '煮付け', buff: '体が芯から温まる：冷たい海でのエアの減りが半分', short: '寒さに強い' },
  sashimi: { name: '刺身', buff: '息が長続き：エアの減りが15%少ない', short: 'エア長持ち' },
  shioyaki: { name: '塩焼き', buff: '体が軽い：泳ぐ速さ +15%', short: '泳ぎが速い' },
  karaage: { name: '唐揚げ', buff: '手元が冴える：銛の命中率 +15%', short: '銛が当たる' },
  nabe: { name: '鍋', buff: 'みんなで食べて元気百倍：エア容量 +20%', short: 'エア容量UP' },
  fugu: { name: 'ふぐ料理（てっさ）', buff: 'ふぐで精がつく：エアの減り -10%・泳ぐ速さ +10%', short: 'エア長持ち＋速い' },
};
export const CAT_DISH: Record<Cat, DishId> = { shiro: 'nitsuke', ao: 'sashimi', iso: 'shioyaki', ika: 'karaage' };
/** a fish this heavy (kg) is cooked as a pot for everyone */
export const BIG_KG = 6;

export type Catch = { id: string; kg: number };

const AO = /アジ|サバ|イワシ|カツオ|マグロ|ブリ|カンパチ|ヒラマサ|サワラ|シイラ|トビウオ|サヨリ|ダツ|カマス|タカサゴ|グルクン|ムロ|ハマチ|サンマ|ニシン|キハダ|ハナムロ|ウルメ|ニシン|コノシロ|ボラ/;
const SHIRO = /タイ|ハタ|フエ|メバル|カサゴ|ソイ|アイナメ|ホッケ|タラ|カレイ|ヒラメ|スズキ|イサキ|ムツ|キンメ|アマダイ|クエ|ブダイ|ベラ|コチ|ハゼ|メジナ|イシダイ|イシガキ|ヒメジ|オジサン|バス|ギンポ|ゲンゲ|カジカ|アブラコ/;
const POISON = /ドクウツボ|フグ|ハリセンボン|キタマクラ|ソウシハギ|ハコフグ|オニダルマオコゼ/;
const PROTECTED = /アオウミガメ|タイマイ|ナポレオン|メガネモチノウオ|タツノオトシゴ|ヒポカンパス|シーラカンス|ジャイアントシーバス|ガリバルディ|ジンベエ|マンボウ|ヨウジウオ/;
/** Phase 9: protected by exact name (the substring regex above would hit other species). アカメ is the estuary's guardian, オオサンショウウオ the river's. */
const PROTECTED_EXACT = new Set(['アカメ', 'オオサンショウウオ']);
const NOT_FISH = /ザメ|^サメ|サメ$|シャチ|クジラ|イルカ|アシカ|アザラシ|オットセイ|ラッコ|トド|ペンギン|ウミヘビ|エイ$|マンタ|ウミガメ|タイマイ/;

/**
 * What happens if this species is speared. Some things can be taken but cost you later (the diner's
 * rules, learnt from Haru when the first order comes in):
 *  - protected species and sea turtles: confiscated on the boat, a fine and the diner's reputation falls
 *  - poisonous fish: whoever eats them gets food poisoning (hospital bill, guests lose trust)
 *  - sharks: too strong for anything but the big-game gun
 */
export type Edible =
  | { ok: true; cat: Cat; poison?: boolean; protected?: boolean; shark?: boolean }
  | { ok: false; reason: string };

const SHARKISH = (def: SpeciesDef) => def.fish?.tail === 'hetero' || /ザメ|^サメ|サメ$|ブカ$/.test(def.name);
const PROTECTED_SHARK = /ジンベエ|ホホジロ|ウバザメ|メガマウス|ミツクリ|ラブカ/;

/** Spear tier needed to repel this aggro species (0 hand spear, 1 gun, 2 big-game gun). */
export function repelTier(def: SpeciesDef): number {
  const ag = def.aggro;
  if (!ag || ag.kind !== 'shark') return 0;
  return ag.lethal || def.rarity >= 4 ? 2 : 1;
}

/** Can this species be speared, and as what? */
export function edibleInfo(def: SpeciesDef): Edible {
  if (def.zone === 'deep') return { ok: false, reason: '深海の生き物は研究用。撮るだけにしよう' };
  if (def.rarity >= 4) return { ok: false, reason: '伝説の生き物は撮るだけにしよう' };
  const n = def.name;
  if (def.kind === 'turtle') return { ok: true, cat: 'shiro', protected: true };
  if (/ヒョウモンダコ/.test(n)) return { ok: true, cat: 'ika', poison: true };
  if (def.kind === 'squid' || def.kind === 'octopus') return { ok: true, cat: 'ika' };
  if (def.kind === 'ray' && def.ray?.flounder) return { ok: true, cat: 'shiro' };
  if (def.kind !== 'fish' && PROTECTED_EXACT.has(n)) return { ok: true, cat: 'shiro', protected: true }; // オオサンショウウオ（川のヌシ）
  if (def.kind !== 'fish') return { ok: false, reason: '銛で獲るものではない' };
  if (def.fish?.tail === 'flukes' || /シャチ|クジラ|イルカ|アシカ|アザラシ|オットセイ|ラッコ|トド|ペンギン/.test(n)) return { ok: false, reason: '海の哺乳類や鳥は撃てない' };
  if (/ウミヘビ/.test(n)) return { ok: false, reason: '猛毒のウミヘビ。近寄らない' };
  if (SHARKISH(def)) return PROTECTED_SHARK.test(n) ? { ok: true, cat: 'shiro', shark: true, protected: true } : { ok: true, cat: 'shiro', shark: true };
  const cat: Cat = AO.test(n) ? 'ao' : SHIRO.test(n) ? 'shiro' : (def.mat?.metal ?? 0) >= 0.3 && def.behavior !== 'static' ? 'ao' : def.size >= 0.3 || def.zone === 'cold' ? 'shiro' : 'iso';
  if (PROTECTED.test(n) || PROTECTED_EXACT.has(n) || def.behavior === 'anemone' || def.hab === 'cleaner') return { ok: true, cat, protected: true };
  if (POISON.test(n)) return { ok: true, cat, poison: true };
  return { ok: true, cat };
}

/**
 * Pufferfish a licensed fugu cook may prepare (the poisonous organs removed). Box-fish, sharp-nosed
 * puffers and the reef Arothron stay off the menu even with a licence.
 */
const FUGU_OK = /トラフグ|ヒガンフグ|クサフグ|イシガキフグ|ハリセンボン/;
export const isFugu = (def: SpeciesDef) => FUGU_OK.test(def.name);
/** 【ふぐ調理師免許】exam fee (yen), reputation level at which the exam can be taken */
export const FUGU_EXAM = { fee: 5000, level: 2, marketPerKg: 3000 };
/** Is it poisonous for this cook? (a licence makes the listed fugu safe) */
export const poisonFor = (def: SpeciesDef, licensed: boolean) => { const e = edibleInfo(def); return e.ok && !!e.poison && !(licensed && isFugu(def)); };

/** A fish that is fine to catch, cook and sell. */
export const isGoodCatch = (def: SpeciesDef) => { const e = edibleInfo(def); return e.ok && !e.poison && !e.protected && !e.shark; };

/** 【ペナルティ】 */
export const PENALTY = {
  /** protected species brought back: fine (yen) and reputation lost, per animal */
  protectedFine: 5000, protectedRep: 3,
  /** a guest served a poisonous fish: compensation = order reward × this, reputation lost */
  poisonServeMult: 2, poisonServeRep: 4,
  /** eating one yourself: hospital bill */
  hospital: 4000,
  /** 【獲物の重さとエア】air use rises with the catch carried: +this per kg (capped) */
  carryAirPerKg: 0.04, carryAirMax: 1.0,
  /** hauling a fish in after the hit costs air: base + per kg (bar) */
  haulBar: 2, haulBarPerKg: 1.2,
};

/** Weight (kg) of one individual of body length `len` (m): deeper, thicker bodies weigh more. */
export function weightOf(def: SpeciesDef, len: number): number {
  if (def.kind === 'turtle') return 120 * len ** 3;
  if (def.kind === 'squid' || def.kind === 'octopus') return Math.max(0.05, 9 * len ** 3 * (def.kind === 'octopus' ? 1.6 : 1));
  const H = def.fish?.H ?? 0.3, W = def.fish?.W ?? 0.14;
  const k = 0.011 * (H / 0.3) * Math.sqrt(W / 0.14);
  return Math.max(0.01, 1000 * k * len ** 3);
}

export const fmtKg = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)}g` : `${kg.toFixed(kg < 10 ? 1 : 0)}kg`);

/** Which dish a catch becomes. */
export function dishFor(def: SpeciesDef, kg: number): DishId {
  if (isFugu(def)) return 'fugu';
  const e = edibleInfo(def);
  if (kg >= BIG_KG) return 'nabe';
  return e.ok ? CAT_DISH[e.cat] : 'shioyaki';
}

export function marketPrice(def: SpeciesDef, kg: number, licensed = false): number {
  if (licensed && isFugu(def)) return Math.round((FUGU_EXAM.marketPerKg * kg) / 10) * 10;
  const e = edibleInfo(def);
  const per = e.ok && !e.poison && !e.protected ? FISHING.market[e.cat] : 0;
  return Math.round((per * kg * (1 + (def.rarity - 1) * 0.5)) / 10) * 10;
}

export function repLevel(rep: number): number {
  let l = 1;
  FISHING.repLevels.forEach((t, i) => { if (rep >= t) l = i + 1; });
  return l;
}

/** 0 = day, 1 = full night, by seconds dived today. */
export function nightOf(clock: number): number {
  return Math.min(1, Math.max(0, (clock - FISHING.duskAt) / FISHING.duskLen));
}
export function timeLabel(clock: number): string {
  return clock < 240 ? '朝' : clock < FISHING.duskAt ? '昼' : clock < FISHING.duskAt + FISHING.duskLen ? '夕方' : '夜';
}

// ------------------------------------------------------------------ orders & story

export type Order = { id: string; guest: string; text: string; dish: DishId; cat?: Cat; species?: string; minKg: number; reward: number; rep: number; hint?: string };

const GUESTS = ['漁師のゲンさん', '民宿のミナミさん', '小学生のソラくん', '役場のタカハシ課長', '観光客の二人連れ', '郵便屋のユキさん', '診療所の先生', '釣り好きのおじいさん'];

/** The chapters of the diner's story, shown once when the reputation level is reached. */
export const STORY: { title: string; text: string; rules?: string[]; map?: string }[] = [
  { title: 'しおさい亭', text: '手銛を買ってきたあなたを見て、泊まっている「しおさい亭」の女将ハルさんが切り出した。「実はね、腰を痛めて漁に出られなくて、店を半分閉めてたんだよ。銛が使えるなら、魚を獲ってきてくれないかい。お客さんの注文どおりに料理を出せば、お代はあんたの稼ぎだ。これからは店でも頼みごとをさせてもらうよ。ただし、海の決まりは守っておくれ」',
    rules: [
      'ウミガメ・ナポレオンフィッシュ・タツノオトシゴなど保護されている生き物や、クマノミ・ホンソメワケベラは獲ってはいけない決まり',
      '10cmにも満たない小さな魚は逃がしてあげる',
    ] },
  { title: '噂が広がる', text: '「しおさい亭が再開したらしい」と町に噂が広がり、お客さんが増えてきた。ダイブショップにクーラーボックスが入荷した。常連の漁師ゲンさんが、お礼にと手描きの海図をくれた。「西の浅瀬に、底の見えねえ青い穴がある」', map: 'bluehole' },
  { title: '組合長の来店', text: '漁協の組合長が店に来た。「あんたの腕なら、漁業権を取って水中銃を使ってもいい」' },
  { title: '町の宴会', text: '町の集まりの料理を頼まれるようになった。大きな魚を運べる大型クーラーが入荷した。' },
  { title: '評論家の舌', text: '料理評論家がお忍びで来店。「この島でしか食べられない魚を」と、珍しい魚の注文が届くようになった。' },
  { title: '雑誌に載った！', text: 'しおさい亭が旅の雑誌に載った！ 腰の治ったハルさんが笑う。「これからも一緒に店をやろう。海のことは、あんたに任せたよ」' },
];

/** Today's orders: more guests and harder dishes as the diner's reputation grows. */
export function makeOrders(level: number, pool: SpeciesDef[], rnd: () => number = Math.random, fugu = false): Order[] {
  const n = Math.min(4, 2 + Math.floor(level / 2));
  const out: Order[] = [];
  const guests = [...GUESTS].sort(() => rnd() - 0.5);
  const cats: Cat[] = ['shiro', 'ao', 'iso', 'ika'];
  for (let i = 0; i < n; i++) {
    const guest = guests[i % guests.length];
    const r = rnd();
    if (level <= 2 && i === 0) {
      // always one easy order: any fish will do
      out.push({ id: `o${i}-${Date.now()}`, guest: '女将のハルさん', text: 'どんな魚でもいいから1匹、塩焼きに', dish: 'shioyaki', minKg: FISHING.minKg, reward: 500, rep: 1, hint: '銛ボタンで持ち替えて、10cmより大きな魚に近づいて突こう' });
      continue;
    }
    if (level >= 4 && i === n - 1 && r < 0.6) {
      const kg = BIG_KG + Math.round(rnd() * 4);
      out.push({ id: `o${i}-${Date.now()}`, guest: '町内会', text: `宴会に${kg}kg以上の大物で鍋を`, dish: 'nabe', minKg: kg, reward: 9000 + kg * 500, rep: 3, hint: '沖やドロップオフの大きな魚。手銛では重すぎることも' });
      continue;
    }
    if (fugu && i === 1 && r < 0.7) {
      out.push({ id: `o${i}-${Date.now()}`, guest: '旅館の板長', text: 'ふぐ料理（てっさ）を一人前', dish: 'fugu', minKg: 0, reward: 4500, rep: 2, hint: 'トラフグ・ヒガンフグは岩礁、クサフグは浅瀬ラグーン' });
      continue;
    }
    const rare = level >= 5 && r < 0.35;
    if ((level >= 2 && r < 0.45) || rare) {
      const maxR = rare ? 3 : Math.min(2, 1 + Math.floor(level / 3));
      const cand = pool.filter((d) => d.rarity <= maxR && (!rare || d.rarity === 3));
      const sp = cand[Math.floor(rnd() * cand.length)];
      if (sp) {
        const dish = DISH[dishFor(sp, 0.5)];
        out.push({ id: `o${i}-${Date.now()}`, guest: rare ? '料理評論家' : guest, text: `${sp.name}の${dish.name}が食べたい`, dish: dishFor(sp, 0.5), species: sp.id, minKg: 0, reward: [0, 1400, 3000, 7000][sp.rarity], rep: sp.rarity + 1, hint: sp.hint });
        continue;
      }
    }
    const cat = cats[Math.floor(rnd() * (level >= 2 ? 4 : 3))];
    const minKg = Math.round((0.1 + rnd() * (0.15 + 0.3 * (level - 1))) * 10) / 10;
    const dish = CAT_DISH[cat];
    out.push({ id: `o${i}-${Date.now()}`, guest, text: `${CAT_NAME[cat]}（${fmtKg(minKg)}以上）の${DISH[dish].name}を`, dish, cat, minKg, reward: Math.round((500 + minKg * 900) / 10) * 10, rep: 1 });
  }
  return out;
}

/** Does this catch satisfy the order? */
export function fits(o: Order, def: SpeciesDef, kg: number): boolean {
  if (o.species) return o.species === def.id;
  if (o.dish === 'fugu') return isFugu(def);
  if (kg < o.minKg) return false;
  if (o.dish === 'nabe') return true;
  const e = edibleInfo(def);
  if (!o.cat) return e.ok;
  return e.ok && e.cat === o.cat;
}
