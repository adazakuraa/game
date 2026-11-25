import type { SpeciesDef } from '../life/species';

/**
 * The day's weather (Phase 4): fixed by the day number (no save field, so re-loading
 * cannot re-roll it). It mildly shifts which species show up (never to zero: no
 * weather-locked species, so the dex, chapters and requests can never be blocked),
 * dims the light and thickens the haze a little, and the landlady announces it
 * in the morning.
 */
export type WeatherId = 'sunny' | 'cloudy' | 'rain' | 'storm';

export const WEATHER: Record<WeatherId, { name: string; icon: string; light: number; fog: number; morning: string }> = {
  sunny: { name: '晴れ', icon: '☀', light: 1, fog: 1, morning: 'おはよう。今日はいい天気だよ。浅いところの魚がよく見えるってさ' },
  cloudy: { name: '曇り', icon: '☁', light: 0.9, fog: 1.05, morning: 'おはよう。今日は曇りだね。こういう日は沖の大きいのが寄ってくるって漁師が言ってたよ' },
  rain: { name: '雨', icon: '☂', light: 0.8, fog: 1.1, morning: 'おはよう。今日は大雨だよ。ボラが浅場に寄ってくる日さ。濡れるのは潜れば同じだけどね' },
  storm: { name: '荒天', icon: '🌀', light: 0.7, fog: 1.2, morning: 'おはよう。今日は海が荒れてるよ。深い所の大物は元気だけど、無理はしないでおくれ' },
};

/** cumulative shares: sunny 40 %, cloudy 30 %, rain 20 %, storm 10 % */
const SHARES: [WeatherId, number][] = [['sunny', 0.4], ['cloudy', 0.7], ['rain', 0.9], ['storm', 1]];

function hash01(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

function rawOf(day: number): WeatherId {
  const r = hash01(day + 1013);
  for (const [id, cum] of SHARES) if (r < cum) return id;
  return 'storm';
}

/** Day 1 (the tutorial) is always sunny; two stormy days never follow each other. */
export function weatherOf(day: number): WeatherId {
  if (day <= 1) return 'sunny';
  const w = rawOf(day);
  if (w === 'storm' && rawOf(day - 1) === 'storm') return 'cloudy';
  return w;
}

const clampM = (v: number) => Math.max(0.75, Math.min(1.35, v));

/** Presence multiplier for a species under a weather (0.75..1.35, never 0). */
export function weatherMult(def: SpeciesDef, w: WeatherId): number {
  const surface = def.hab === 'surface';
  const shallow = def.depth[1] < 5;
  const big = def.size >= 1;
  switch (w) {
    case 'sunny':
      if (surface || shallow) return clampM(1.3);
      if (def.kind === 'turtle') return clampM(1.25);
      if (big && def.depth[0] >= 30) return clampM(0.8);
      return 1;
    case 'cloudy':
      if (def.behavior === 'pelagic' || big) return clampM(1.3);
      if (def.zone === 'dropoff' && def.behavior === 'school') return clampM(1.25);
      if (surface) return clampM(0.8);
      return 1;
    case 'rain':
      if (def.name.includes('ボラ')) return clampM(1.35);
      if (def.zone === 'lagoon' || def.hab === 'sandForage') return clampM(1.25);
      if (def.when === 'night') return clampM(1.25);
      if (surface) return clampM(0.8);
      return 1;
    case 'storm':
      if (def.aggro?.kind === 'shark') return clampM(1.3);
      if (big && (def.depth[0] >= 20 || def.zone === 'dropoff' || def.zone === 'offshore')) return clampM(1.3);
      if (surface || shallow) return clampM(0.78);
      if (def.zone === 'lagoon' && def.size < 0.3) return clampM(0.8);
      return 1;
  }
}
