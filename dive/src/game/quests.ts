import { SPECIES, type SpeciesDef } from '../life/species';
import { DIVE_POINTS, heightAt, zoneAt, ZONE_NAMES, type ZoneId } from '../world/layout';

/**
 * Requests taken on land (the notice board at the harbour). Each has a place, marked on the chart;
 * the instructions appear when the diver gets there. Happenings met by chance at sea (a netted turtle)
 * are not requests and never show up here.
 */
export type QuestKind = 'urchin' | 'trash' | 'lost' | 'treasure' | 'tag' | 'photo' | 'survey';

export type Quest = {
  id: string;
  kind: QuestKind;
  giver: string;
  title: string;
  desc: string;
  zone: ZoneId;
  x: number;
  z: number;
  reward: number;
  species?: string;
  /** newly put up on the board (shown as NEW until the board is looked at) — Phase 3 */
  fresh?: boolean;
};

/** 【依頼】offers on the board, requests held at once, reward per kind (yen) */
export const QUEST = {
  /** 【掲示板の枠】board + held together (Phase 3): taking or dropping moves a request, clearing one frees a slot and one new request is put up */
  board: 3,
  maxHeld: 2,
  /** distance (m) at which the instructions appear and a timed request begins */
  arrive: 22,
  reward: { urchin: 1500, trash: 1200, lost: 2500, treasure: 4500, tag: 3000, survey: 2200, photo: 0 } as Record<QuestKind, number>,
  photoMult: 4,
  surveyNeed: 3,
};

const pointOf = (zone: ZoneId) => DIVE_POINTS.find((d) => d.id === (zone === 'offshore' ? 'dropoff' : zone));

/** A place inside a zone, near its dive point, at a diveable depth. */
function placeIn(zone: ZoneId, rnd: () => number, minD = zone === 'estuary' ? -8 : zone === 'river' ? -6 : -26, maxD = zone === 'estuary' ? -1.5 : zone === 'river' ? -1.2 : -3): { x: number; z: number } | null {
  const dp = pointOf(zone);
  if (!dp) return null;
  for (let k = 0; k < 60; k++) {
    const a = rnd() * Math.PI * 2, d = 25 + rnd() * 70;
    const x = dp.x + Math.cos(a) * d, z = dp.z + Math.sin(a) * d;
    const z0 = zoneAt(x, z);
    const h = heightAt(x, z);
    if ((z0 === zone || (zone === 'dropoff' && z0 === 'offshore')) && h > minD && h < maxD) return { x, z };
  }
  return { x: dp.x, z: dp.z };
}

export function makeQuest(known: Set<string>, rnd: () => number = Math.random, taken: QuestKind[] = []): Quest | null {
  const has = (z: string) => known.has(z);
  const kinds: QuestKind[] = ['photo', 'survey'];
  if (has('rocky') || has('kelp') || has('cold')) kinds.push('urchin', 'urchin');
  if (has('lagoon') || has('reef') || has('estuary') || has('river')) kinds.push('trash');
  if (has('reef') || has('dropoff')) kinds.push('lost', 'tag');
  if (has('ruins')) kinds.push('treasure', 'treasure');
  const pool = kinds.filter((k) => taken.filter((t) => t === k).length < 1);
  const kind = (pool.length ? pool : kinds)[Math.floor(rnd() * (pool.length ? pool : kinds).length)];
  const id = `q${Date.now().toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const zones = (list: ZoneId[]) => list.filter((z) => has(z === 'offshore' ? 'dropoff' : z));
  const base = (zone: ZoneId) => ({ id, kind, zone, ...(placeIn(zone, rnd) ?? { x: 0, z: 0 }) });
  switch (kind) {
    case 'urchin': {
      const zone = pick(zones(['rocky', 'kelp', 'cold']));
      return { ...base(zone), giver: '漁協', title: 'ウニ漁', desc: '増えすぎたウニを獲ってほしい。漁協のヤスを貸すので、食べられるウニだけを突いてはがしてくる（夜に潜ると報酬 ×1.5）', reward: QUEST.reward.urchin * (zone === 'cold' ? 1.5 : 1) };
    }
    case 'trash': {
      const zone = pick(zones(['lagoon', 'reef', 'estuary', 'river']));
      return { ...base(zone), giver: '町内会', title: '海のごみ拾い', desc: '流れ着いたごみが海底にたまっている場所がある。拾い集めてきてほしい', reward: QUEST.reward.trash };
    }
    case 'lost': {
      const zone = pick(zones(['reef', 'dropoff']));
      return { ...base(zone), giver: '観光客のダイバー', title: '落とし物の水中カメラ', desc: '潜っているときにカメラを落としてしまった。だいたいこのあたりのはず', reward: QUEST.reward.lost };
    }
    case 'treasure':
      return { ...base('ruins'), giver: '骨董屋', title: '遺跡の宝探し', desc: '古い地図によると、遺跡のこのあたりに箱が沈んでいるらしい', reward: QUEST.reward.treasure };
    case 'tag': {
      const zone = pick(zones(['reef', 'dropoff']));
      const big = SPECIES.filter((s) => (s.zone === zone || (zone === 'dropoff' && s.zone === 'offshore')) && s.size >= 0.8 && s.size < 8 && s.rarity <= 2 && s.kind !== 'none' && !s.weather);
      const sp = pick(big.length ? big : SPECIES.filter((s) => s.id === 'turtle'));
      return { ...base(zone), giver: '海洋研究所', title: `${sp.name}の標識読み取り`, desc: `このあたりにいる${sp.name}に研究用の標識をつけてある。近づいて番号を読み取ってきてほしい`, reward: QUEST.reward.tag, species: sp.id };
    }
    case 'survey': {
      const zone = pick(zones(['lagoon', 'reef', 'rocky', 'dropoff', 'kelp', 'cold', 'ruins', 'estuary', 'river']).concat('lagoon'));
      const dp = pointOf(zone)!;
      return { id, kind, zone, x: dp.x, z: dp.z, giver: '海洋研究所', title: `${ZONE_NAMES[zone]}の生き物調査`, desc: `${ZONE_NAMES[zone]}で、ちがう種類の生き物を${QUEST.surveyNeed}種類、B評価以上で撮ってきてほしい`, reward: QUEST.reward.survey };
    }
    default: {
      const zone = pick(zones(['lagoon', 'reef', 'rocky', 'dropoff', 'kelp', 'cold', 'estuary', 'river']).concat('lagoon'));
      const cand: SpeciesDef[] = SPECIES.filter((s) => (s.zone === zone || (zone === 'dropoff' && s.zone === 'offshore')) && s.rarity <= 2 && s.kind !== 'none' && s.when !== 'night' && !s.weather);
      const sp = pick(cand);
      const dp = pointOf(zone)!;
      return { id, kind: 'photo', zone, x: dp.x, z: dp.z, giver: '月刊うみなか 編集部', title: `${sp.name}の写真`, desc: `誌面で使う${sp.name}の写真がほしい。B評価以上で撮ってきてほしい`, reward: [0, 300, 900, 2400, 8000][sp.rarity] * QUEST.photoMult, species: sp.id };
    }
  }
}
