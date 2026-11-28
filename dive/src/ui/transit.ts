/**
 * 修正バッチ2 F7：場面の切り替えの演出。
 * - Dawn（(10)）：寝たとき・夜の潜水の後。0.6 秒で暗転 → 中央に「◯日目の朝」と天気のアイコンを 1.2 秒 → 明けてボート画面へ。タップで早送り。
 * - BoatTravel（(17)(29)）：海図の上をボートが走る 2D の演出（1.2〜2.0 秒、ウニ漁は 1.0 秒）。タップで飛ばせる。
 *   潜水の準備（シェーダの事前コンパイル・生き物の生成）はこの演出の裏で進める（onPrepare）。
 * 時間は定数 TRAVEL / DAWN にまとめる。
 */
import type { Minimap } from './minimap';

export const DAWN = {
  /** 暗転にかかる時間 s */
  fadeIn: 0.6,
  /** 「◯日目の朝」を出している時間 s */
  hold: 1.2,
  /** 明けてボート画面が見えるまで s */
  fadeOut: 0.5,
  /** タップで早送りしたときの明けるまで s */
  skipOut: 0.2,
};

export const TRAVEL = {
  /** 距離に応じた長さ s：近い所 min、遠い所 max（distFar m 以上で max） */
  min: 1.2, max: 2.0, distFar: 650,
  /** ウニ漁（店の前から岩礁へ）s */
  urchin: 1.0,
  /** 潜水の準備を始める時刻 s（最初の数コマは演出だけ描く） */
  prepareAt: 0.3,
  /** 最後に暗転する時間 s（この間に画面は真っ暗になって潜水へ） */
  fadeOut: 0.3,
  /** 最初に海図が現れる時間 s */
  fadeIn: 0.2,
};

/** 港（しおさい亭の前）。海図の南の岸辺 */
export const PORT = { x: -10, z: -62 };

export function travelSeconds(from: { x: number; z: number }, to: { x: number; z: number }, urchin = false): number {
  if (urchin) return TRAVEL.urchin;
  const d = Math.hypot(from.x - to.x, from.z - to.z);
  return TRAVEL.min + (TRAVEL.max - TRAVEL.min) * Math.min(1, d / TRAVEL.distFar);
}

const $ = (id: string) => document.getElementById(id)!;

export class Dawn {
  private timers: number[] = [];
  private finish: (() => void) | null = null;
  get active(): boolean { return this.finish !== null; }

  constructor(private root: HTMLElement) {
    root.addEventListener('click', () => this.finish?.());
  }

  /** onBlack：真っ暗になった時点で呼ぶ（画面の切り替え：しおさい亭を閉じる・ボート画面を出す）。終わったら resolve */
  play(info: { day: number; icon: string; weather: string }, onBlack: () => void): Promise<void> {
    return new Promise((resolve) => {
      const r = this.root;
      r.style.setProperty('--dw-in', `${DAWN.fadeIn}s`);
      r.style.setProperty('--dw-out', `${DAWN.fadeOut}s`);
      $('dw-day').textContent = `${info.day}日目の朝`;
      $('dw-weather').innerHTML = `<span class="dw-icon">${info.icon}</span><span>${info.weather}</span>`;
      r.classList.remove('hidden', 'card', 'on');
      void r.offsetWidth;
      r.classList.add('on');
      let black = false;
      const toBlack = () => { if (!black) { black = true; onBlack(); } };
      const clear = () => { this.timers.forEach((t) => window.clearTimeout(t)); this.timers = []; };
      const end = () => { clear(); r.classList.add('hidden'); r.classList.remove('on', 'card', 'quick'); this.finish = null; resolve(); };
      const later = (ms: number, f: () => void) => this.timers.push(window.setTimeout(f, ms));
      // 暗転が終わってから「◯日目の朝」を出し、そこから hold 秒（画面の切り替えで時間がかかっても、カードは hold 秒ぶん見える）
      later(DAWN.fadeIn * 1000, () => {
        toBlack();
        r.classList.add('card');
        later(DAWN.hold * 1000, () => {
          r.classList.remove('card', 'on');
          later(DAWN.fadeOut * 1000, end);
        });
      });
      // タップで早送り：暗転を済ませ、すぐ明ける
      this.finish = () => {
        clear();
        toBlack();
        r.classList.add('quick');
        r.classList.remove('card', 'on');
        this.finish = () => undefined;
        this.timers.push(window.setTimeout(end, DAWN.skipOut * 1000 + 30));
      };
    });
  }
}

export type TravelInfo = { from: { x: number; z: number }; to: { x: number; z: number }; name: string; depth: number; sec: number; urchin?: boolean };

export class BoatTravel {
  private raf = 0;
  private skip: (() => void) | null = null;
  get active(): boolean { return this.skip !== null; }

  constructor(private root: HTMLElement, private canvas: HTMLCanvasElement, private getMap: () => Minimap, private sound: (sec: number) => void) {
    root.addEventListener('click', () => this.skip?.());
  }

  /** onPrepare：潜水の準備を始める合図（prepareAt 秒後、または飛ばしたとき）。resolve は画面が真っ暗になって演出が終わったとき */
  play(info: TravelInfo, onPrepare: () => void): Promise<void> {
    return new Promise((resolve) => {
      const r = this.root;
      r.classList.remove('hidden');
      $('tv-name').textContent = info.name;
      $('tv-depth').textContent = info.urchin ? '岩礁のウニ漁' : `水深 ${info.depth}m`;
      $('tv-name').parentElement!.classList.remove('show');
      this.sound(info.sec);
      const map = this.getMap();
      const t0 = performance.now();
      let prepared = false;
      let tEnd = info.sec;
      let skipped = false;
      const prepare = () => { if (!prepared) { prepared = true; onPrepare(); } };
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        const k = Math.min(1, t / Math.max(0.1, tEnd - TRAVEL.fadeOut));
        // 船は出だしがゆっくり、中ほどで速く、着く手前で緩む
        const e = k * k * (3 - 2 * k);
        const dark = Math.max(Math.min(1, 1 - t / TRAVEL.fadeIn), Math.min(1, (t - (tEnd - TRAVEL.fadeOut)) / TRAVEL.fadeOut), 0);
        map.drawRoute(this.canvas, info.from, info.to, e, { dark, name: info.name, port: info.from.x === PORT.x && info.from.z === PORT.z });
        if (e > 0.55) $('tv-name').parentElement!.classList.add('show');
        if (t >= TRAVEL.prepareAt) prepare();
        if (t >= tEnd) { done(); return; }
        this.raf = requestAnimationFrame(frame);
      };
      const done = () => {
        cancelAnimationFrame(this.raf);
        this.skip = null;
        prepare();
        r.classList.add('hidden');
        resolve();
      };
      this.skip = () => {
        if (skipped) return;
        skipped = true;
        // 飛ばす：準備を始めて、すぐ暗転して終わる
        prepare();
        tEnd = Math.min(tEnd, (performance.now() - t0) / 1000 + TRAVEL.fadeOut * 0.6);
      };
      this.raf = requestAnimationFrame(frame);
    });
  }
}
