import { SPECIES, type SpeciesDef } from '../life/species';

/**
 * The day's weather (Phase 4): fixed by the day number (no save field, so re-loading
 * cannot re-roll it). It mildly shifts which species show up, dims the light, thickens the
 * haze (visibility: sunny = cloudy > rain > storm) and the landlady announces it in the morning.
 * 修正バッチ2 F11 (32)：天気限定の種が 8 種いる（`SpeciesDef.weather`）。章・依頼の対象にはせず、
 * 雨・荒天は 7 日以内に必ず来るように `weatherOf` が調整する。
 */
export type WeatherId = 'sunny' | 'cloudy' | 'rain' | 'storm';

/** 修正バッチ2 F11 (48)：視程は fog で割る。晴れ＝曇り（1）＞雨（約 20% 減）＞荒天（約 33% 減） */
const FOG = { rain: 1.25, storm: 1.5 };

export const WEATHER: Record<WeatherId, { name: string; icon: string; light: number; fog: number; morning: string }> = {
  sunny: { name: '晴れ', icon: '☀', light: 1, fog: 1, morning: 'おはよう。今日はいい天気だよ。浅いところの魚がよく見えるってさ' },
  cloudy: { name: '曇り', icon: '☁', light: 0.9, fog: 1, morning: 'おはよう。今日は曇りだね。こういう日は沖の大きいのが寄ってくるって漁師が言ってたよ' },
  rain: { name: '雨', icon: '☂', light: 0.8, fog: FOG.rain, morning: 'おはよう。今日は大雨だよ。ボラが浅場に寄ってくる日さ。濡れるのは潜れば同じだけどね' },
  storm: { name: '荒天', icon: '🌀', light: 0.7, fog: FOG.storm, morning: 'おはよう。今日は海が荒れてるよ。深い所の大物は元気だけど、無理はしないでおくれ' },
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

/**
 * 天気限定の種がいる天気（雨・荒天）は、どの連続 7 日にも必ず 1 回来る。直近でその天気から WEATHER_GAP 日あいたら、その日をその天気にする。
 * 荒天を先に決めるので、同じ日に両方が必要なら雨は翌日にずれる。その分、雨だけ 1 日早めに（6）決める。
 */
export const WEATHER_GAP: Partial<Record<WeatherId, number>> = { storm: 7, rain: 6 };
const WEATHER_FORCED: WeatherId[] = ['storm', 'rain'];
const days: WeatherId[] = [];
const last: Partial<Record<WeatherId, number>> = {};

/**
 * Day 1 (the tutorial) is always sunny; two stormy days never follow each other.
 * F11：雨と荒天は、どの連続 7 日にも必ず 1 回ある（来ない期間が 6 日を超えない。同じ日に両方必要なら荒天を先に、雨は翌日）。
 */
export function weatherOf(day: number): WeatherId {
  if (day <= 1) return 'sunny';
  for (let d = days.length + 1; d <= day; d++) {
    let w: WeatherId = d <= 1 ? 'sunny' : rawOf(d);
    if (d > 1) {
      if (w === 'storm' && days[d - 2] === 'storm') w = 'cloudy';
      for (const f of WEATHER_FORCED) {
        if (w !== f && d - (last[f] ?? 0) >= WEATHER_GAP[f]! && days[d - 2] !== f && !(f === 'rain' && w === 'storm')) { w = f; break; }
      }
    }
    days.push(w);
    last[w] = d;
  }
  return days[day - 1];
}

/** 女将さんの朝のひとこと：天気＋その天気限定の生き物（その日の分から 2 種まで） */
export function weatherMorning(day: number): string {
  const w = weatherOf(day);
  const only = SPECIES.filter((s) => s.weather?.includes(w));
  if (!only.length) return WEATHER[w].morning;
  const names = [0, 1].map((k) => only[(day + k) % only.length].name).filter((n, i, a) => a.indexOf(n) === i);
  return `${WEATHER[w].morning}。${names.join('や')}が出るかもね`;
}

const clampM = (v: number) => Math.max(0.75, Math.min(1.35, v));

/** Presence multiplier for a species under a weather (0.75..1.35; 0 only for a weather-only species on another weather). */
export function weatherMult(def: SpeciesDef, w: WeatherId): number {
  if (def.weather) return def.weather.includes(w) ? 1.35 : 0;
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
