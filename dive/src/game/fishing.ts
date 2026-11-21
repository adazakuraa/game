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
    hand: { name: '手銛', range: 2.2, reload: 1.1, maxKg: 8 },
    gun: { name: '水中銃', range: 6, reload: 2.4, maxKg: 200 },
  },
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

export type DishId = 'nitsuke' | 'sashimi' | 'shioyaki' | 'karaage' | 'nabe';
/** Each kind of fish has its dish; eating it yourself gives a power-up for the next dive. */
export const DISH: Record<DishId, { name: string; buff: string; short: string }> = {
  nitsuke: { name: '煮付け', buff: '体が芯から温まる：冷たい海でのエアの減りが半分', short: '寒さに強い' },
  sashimi: { name: '刺身', buff: '息が長続き：エアの減りが15%少ない', short: 'エア長持ち' },
  shioyaki: { name: '塩焼き', buff: '体が軽い：泳ぐ速さ +15%', short: '泳ぎが速い' },
  karaage: { name: '唐揚げ', buff: '手元が冴える：銛の命中率 +15%', short: '銛が当たる' },
  nabe: { name: '鍋', buff: 'みんなで食べて元気百倍：エア容量 +20%', short: 'エア容量UP' },
};
export const CAT_DISH: Record<Cat, DishId> = { shiro: 'nitsuke', ao: 'sashimi', iso: 'shioyaki', ika: 'karaage' };
/** a fish this heavy (kg) is cooked as a pot for everyone */
export const BIG_KG = 6;

export type Catch = { id: string; kg: number };

const AO = /アジ|サバ|イワシ|カツオ|マグロ|ブリ|カンパチ|ヒラマサ|サワラ|シイラ|トビウオ|サヨリ|ダツ|カマス|タカサゴ|グルクン|ムロ|ハマチ|サンマ|ニシン|キハダ|ハナムロ|ウルメ|ニシン|コノシロ|ボラ/;
const SHIRO = /タイ|ハタ|フエ|メバル|カサゴ|ソイ|アイナメ|ホッケ|タラ|カレイ|ヒラメ|スズキ|イサキ|ムツ|キンメ|アマダイ|クエ|ブダイ|ベラ|コチ|ハゼ|メジナ|イシダイ|イシガキ|ヒメジ|オジサン|バス|ギンポ|ゲンゲ|カジカ|アブラコ/;
const POISON = /ドクウツボ|フグ|ハリセンボン|キタマクラ|ソウシハギ|ハコフグ|オニダルマオコゼ/;
const PROTECTED = /ナポレオン|メガネモチノウオ|タツノオトシゴ|ヒポカンパス|シーラカンス|ジャイアントシーバス|ガリバルディ|ジンベエ|マンボウ|ヨウジウオ/;
const NOT_FISH = /ザメ|^サメ|サメ$|シャチ|クジラ|イルカ|アシカ|アザラシ|オットセイ|ラッコ|トド|ペンギン|ウミヘビ|エイ$|マンタ|ウミガメ|タイマイ/;

export type Edible = { ok: true; cat: Cat } | { ok: false; reason: string };

/** Can this species be speared and cooked, and as what? */
export function edibleInfo(def: SpeciesDef): Edible {
  if (def.zone === 'deep') return { ok: false, reason: '深海の生き物は研究用。撮るだけにしよう' };
  if (/ヒョウモンダコ/.test(def.name)) return { ok: false, reason: '猛毒のタコ。絶対に触らない' };
  if (def.kind === 'squid' || def.kind === 'octopus') return { ok: true, cat: 'ika' };
  if (def.kind === 'ray' && def.ray?.flounder) return { ok: true, cat: 'shiro' };
  if (def.kind !== 'fish') return { ok: false, reason: '銛で獲るものではない' };
  const n = def.name;
  if (def.rarity >= 4) return { ok: false, reason: '伝説の生き物は撮るだけにしよう' };
  if (def.fish?.tail === 'flukes' || NOT_FISH.test(n) || def.fish?.tail === 'hetero') return { ok: false, reason: '獲ってはいけない生き物' };
  if (PROTECTED.test(n)) return { ok: false, reason: '保護されている魚。撮るだけにしよう' };
  if (POISON.test(n)) return { ok: false, reason: '毒がある。食べられない' };
  if (def.behavior === 'anemone' || def.hab === 'cleaner') return { ok: false, reason: '海の仲間の暮らしを守ろう（獲らない）' };
  if (AO.test(n)) return { ok: true, cat: 'ao' };
  if (SHIRO.test(n)) return { ok: true, cat: 'shiro' };
  if ((def.mat?.metal ?? 0) >= 0.3 && def.behavior !== 'static') return { ok: true, cat: 'ao' };
  return { ok: true, cat: def.size >= 0.3 || def.zone === 'cold' ? 'shiro' : 'iso' };
}

/** Weight (kg) of one individual of body length `len` (m): deeper, thicker bodies weigh more. */
export function weightOf(def: SpeciesDef, len: number): number {
  if (def.kind === 'squid' || def.kind === 'octopus') return Math.max(0.05, 9 * len ** 3 * (def.kind === 'octopus' ? 1.6 : 1));
  const H = def.fish?.H ?? 0.3, W = def.fish?.W ?? 0.14;
  const k = 0.011 * (H / 0.3) * Math.sqrt(W / 0.14);
  return Math.max(0.01, 1000 * k * len ** 3);
}

export const fmtKg = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)}g` : `${kg.toFixed(kg < 10 ? 1 : 0)}kg`);

/** Which dish a catch becomes. */
export function dishFor(def: SpeciesDef, kg: number): DishId {
  const e = edibleInfo(def);
  if (kg >= BIG_KG) return 'nabe';
  return e.ok ? CAT_DISH[e.cat] : 'shioyaki';
}

export function marketPrice(def: SpeciesDef, kg: number): number {
  const e = edibleInfo(def);
  const per = e.ok ? FISHING.market[e.cat] : 0;
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
export const STORY: { title: string; text: string }[] = [
  { title: 'しおさい亭', text: '港町の小さな食堂「しおさい亭」。女将のハルさんが腰を痛めてしまい、ダイバーのあなたが店を手伝うことになった。「魚は海で獲ってきておくれ。手銛なら物置にあるよ。注文票の料理を作れば、お客さんは喜ぶからね」' },
  { title: '噂が広がる', text: '「しおさい亭が再開したらしい」と町に噂が広がり、お客さんが増えてきた。ダイブショップにクーラーボックスが入荷した。' },
  { title: '組合長の来店', text: '漁協の組合長が店に来た。「あんたの腕なら、漁業権を取って水中銃を使ってもいい」— 夜の漁にも慣れてきた。ボートで昼の海・夜の海を選べるようになった。' },
  { title: '町の宴会', text: '町の集まりの料理を頼まれるようになった。大きな魚を運べる大型クーラーが入荷した。' },
  { title: '評論家の舌', text: '料理評論家がお忍びで来店。「この島でしか食べられない魚を」と、珍しい魚の注文が届くようになった。' },
  { title: '雑誌に載った！', text: 'しおさい亭が旅の雑誌に載った！ 腰の治ったハルさんが笑う。「これからも一緒に店をやろう。海のことは、あんたに任せたよ」' },
];

/** Today's orders: more guests and harder dishes as the diner's reputation grows. */
export function makeOrders(level: number, pool: SpeciesDef[], rnd: () => number = Math.random): Order[] {
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
  if (kg < o.minKg) return false;
  if (o.dish === 'nabe') return true;
  const e = edibleInfo(def);
  if (!o.cat) return e.ok;
  return e.ok && e.cat === o.cat;
}
