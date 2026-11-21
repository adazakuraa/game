import type * as THREE from 'three';
import type { Player, PlayerEvent } from '../player/Player';
import type { Physiology, Weather } from '../systems/Physiology';
import type { Route } from '../world/Route';
import { clamp } from '../utils/noise';

/** What the coach needs from the game. Everything it touches is the practice stage only. */
export interface CoachHost {
  mobile: boolean;
  player: Player;
  physio: Physiology;
  weather: Weather;
  route: Route;
  windDir: THREE.Vector3;
  banner(text: string, sub?: string, tone?: '' | 'danger' | 'good', ms?: number): void;
  say(key: string, text: string): void;
  chime(): void;
  stumble(): void;
  /** Put the player back at route distance s (and steady the body). */
  respawn(s: number): void;
  mapOpen(): boolean;
}

interface Lesson {
  title: string;
  /** route distance at which the lesson begins (once the previous one is done) */
  at: number;
  /** passing this distance completes the lesson silently (optional lessons and ones that cannot be missed) */
  skipAt?: number;
  /** where a fatal mistake puts you back, and which lesson to resume from */
  retreat: number;
  back?: number;
  /** HUD parts revealed when it begins */
  flags?: string[];
  pulse?: string[];
  start?: string;
  done?: string;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/**
 * The Kosciuszko practice climb: twelve short lessons taught on the real mountain.
 * A small card names the current one; the game never stops. Nothing here writes a save.
 */
export class Coach {
  static readonly KEY = 'dz8000-tutorial-done';
  static done(): boolean {
    try { return localStorage.getItem(Coach.KEY) === '1'; } catch { return false; }
  }

  readonly lessons: Lesson[];
  idx = 0;
  started = false;
  finished = false;
  private t = 0;
  private phase = 0;
  private doneT = 0;
  private startS = 0;
  private minStam = 100;
  private gustTime = 0;
  private gustRest = 0;
  private gustSeen = false;
  private gustTries = 0;
  private slideT = -1;
  private axeUsed = false;
  private slipArmed = 0;
  private flowOk = false;
  private signRead = false;
  private cardKey = '';
  private readonly card = $('coach');
  private readonly hud = $('hud');

  constructor(private readonly h: CoachHost) {
    const W = h.route.waypointS;
    const len = h.route.length;
    this.lessons = [
      { title: '歩く・見回す', at: 0, retreat: 0, start: 'あれが頂上だ。行こう。', done: 'その調子だ。' },
      { title: '地図（見なくてもよい）', at: 0, retreat: 0, flags: ['map'], pulse: ['map-btn'], start: 'ルートは地図で確かめられる。迷ったら見ろ。', skipAt: W[1] + 20, done: '' },
      { title: '体力と休む', at: W[1] + 12, skipAt: W[2] + 25, retreat: W[1] + 10, flags: ['stam', 'rest'], pulse: ['v-stam', 'rest-btn'], start: '登ると体力が減る。息が上がる前に休め。', done: 'いい休み方だ。無理せず休め。' },
      { title: '体の数字', at: 0, retreat: W[1] + 10, flags: ['body'], pulse: ['v-spo2'], start: 'この数字を覚えておけ。高い所ほど SpO₂ は下がる。', done: '' },
      { title: '突風', at: W[2] + 2, skipAt: W[3] - 24, retreat: W[2] - 2, done: '身を低くできたな。それでいい。' },
      { title: 'フィックスロープ', at: W[3] - 24, retreat: W[3] - 12, flags: ['clip'], pulse: ['clip-btn', 'clip-status'], start: 'この先は急すぎて、確保なしでは登れない。ロープにクリップしろ。', done: 'よし、体をロープに預けて登れ。' },
      { title: 'アンカーで付け替え', at: 0, retreat: W[3] - 12, back: 5, start: '', done: '付け替えは確実に。1か所ずつだ。' },
      { title: 'ロープを外す', at: 0, retreat: W[3] - 12, back: 5, done: '外した。ここからは自分の足だ。' },
      { title: '滑落停止', at: W[6] + 2, skipAt: W[7] + 4, retreat: W[6] - 3, start: 'この斜面で、わざと足を滑らせるぞ。', done: '止まった。それが命綱だ。' },
      { title: '酸素ボンベ', at: W[7] - 2, skipAt: len - 50, retreat: W[7] - 3, flags: ['o2'], pulse: ['v-o2'], start: '練習用のボンベだ。残りはわずかだぞ。', done: '酸素の管理も登山のうちだ。' },
      { title: '調べる（見なくてもよい）', at: len - 50, skipAt: len - 6, retreat: len - 52, done: '' },
      { title: '時刻と基準', at: 0, retreat: len - 52, flags: ['clock'], pulse: ['hud-alt'], start: '本番は日没と折返の時刻が期限だ。基準との差で自分のペースを見ろ。', done: '' },
    ];
    this.hud.classList.remove('s-map', 's-rest', 's-stam', 's-body', 's-clip', 's-clock', 's-o2');
    this.hud.classList.add('coach');
    h.physio.mods.drain = 0.5;
    h.weather.calm = true;
  }

  /** The signpost can be read only during its lesson. */
  get signActive(): boolean { return !this.finished && this.idx === 10 && this.started; }
  read(): void { this.signRead = true; }

  dispose(): void {
    this.hud.classList.remove('coach', 's-map', 's-rest', 's-stam', 's-body', 's-clip', 's-clock', 's-o2');
    this.card.classList.add('hidden');
    this.h.physio.mods.drain = 1;
    this.h.weather.calm = false;
  }

  private setFlags(f: string[]): void {
    for (const k of f) this.hud.classList.add(`s-${k}`);
  }

  private pulse(ids: string[]): void {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      window.setTimeout(() => el.classList.remove('pulse'), 4800);
    }
  }

  // ------------------------------------------------------------ text of the card (changes with the phase)
  private text(): string {
    const m = this.h.mobile;
    switch (this.idx) {
      case 0: return m ? '左側をドラッグで歩く。右側をドラッグで見回す。' : 'WASD で歩く。マウスで見回す。';
      case 1: return m ? '右上の地図ボタンで、ルートと標高が見られる。' : 'M キーで、ルートと標高が見られる。';
      case 2: return this.phase === 0
        ? '登ると体力（⚡）が減っていく。60% を切るまで登ろう。'
        : (m ? '休むボタンを長押しして体力を戻そう（85% まで）。' : 'Space を長押しして体力を戻そう（85% まで）。');
      case 3: {
        const k = Math.min(2, Math.floor(this.t / 3.5));
        return ['SpO₂：血中の酸素。ここ（2,200m）は 95% 前後。8,000m では 60% 台まで下がる。',
          '体温：36〜37℃が目安。風と寒さで下がる。',
          '風：強いほど体温を奪う。突風は転倒のもと。'][k];
      }
      case 4: return this.phase <= 1
        ? '風が変わってきた…突風が来る。'
        : (m ? '突風！ 休むボタンを長押しして身を低くしろ。' : '突風！ Space を長押しして身を低くしろ。');
      case 5: return m ? '急すぎて登れない。赤いロープに近づいて「クリップ」で確保。' : '急すぎて登れない。赤いロープに近づいて E キーで確保。';
      case 6: return m ? 'ロープをたどって登る。アンカーで止まったら、もう一度「クリップ」で付け替え。' : 'ロープをたどって登る。アンカーで止まったら、もう一度 E キーで付け替え。';
      case 7: return m ? '上のロープの終端で「クリップ」を押して外す。' : '上のロープの終端で E キーを押して外す。';
      case 8: return this.phase === 0
        ? '斜面を登ろう。途中でガイドがわざと足を滑らせる。'
        : (m ? '滑った！ 休むボタンを長押ししてピッケルを打ち込め。' : '滑った！ Space を長押ししてピッケルを打ち込め。');
      case 9: return this.phase === 0
        ? (m ? '流量の「＋」を押して 2 L/分 以上にする。SpO₂ が上がる。' : 'X キーで流量を 2 L/分 以上にする。SpO₂ が上がる。')
        : (m ? 'ボンベが空に近い。「交換」ボタンで予備に替える。' : 'ボンベが空に近い。F キーで予備に替える。');
      case 10: return m ? '道標に近づいて「調べる」。山の名の由来が分かる。' : '道標に近づいて F キーで調べる。山の名の由来が分かる。';
      default: return '時刻と「基準 ±分」（ガイドの目安との差）を見よう。もうすぐ山頂だ。';
    }
  }

  private progress(): number {
    const p = this.h.player, ph = this.h.physio;
    switch (this.idx) {
      case 0: return (p.routeS - this.startS) / 8;
      case 1: return (p.routeS - this.startS) / 40;
      case 2: return this.phase === 0 ? clamp((100 - ph.stamina) / 40, 0, 1) * 0.5 : 0.5 + 0.5 * clamp((ph.stamina - this.minStam) / Math.max(1, 85 - this.minStam), 0, 1);
      case 3: return this.t / 10.5;
      case 9: return (this.flowOk ? 0.5 : clamp(ph.flow / 2, 0, 1) * 0.5) + (this.phase === 1 ? clamp(1 - ph.bottle / 14, 0, 1) * 0.5 : 0);
      case 11: return this.t / 6;
      default: return 0;
    }
  }

  private render(): void {
    const L = this.lessons[this.idx];
    const done = this.doneT > 0;
    const body = done ? (L.done || 'できた！') : this.text();
    const key = `${this.idx}|${done}|${body}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      $('coach-count').textContent = `${this.idx + 1} / ${this.lessons.length}`;
      $('coach-title').textContent = L.title;
      $('coach-body').textContent = body;
      this.card.classList.toggle('done', done);
    }
    this.card.classList.remove('hidden');
    const bar = $('coach-bar').firstElementChild as HTMLElement;
    bar.style.width = `${((done ? 1 : clamp(this.progress(), 0, 1)) * 100).toFixed(0)}%`;
  }

  // ------------------------------------------------------------ flow
  private begin(): void {
    const L = this.lessons[this.idx];
    this.started = true;
    this.t = 0;
    this.phase = 0;
    this.startS = this.h.player.routeS;
    this.minStam = 100;
    this.gustSeen = false;
    this.slideT = -1;
    this.axeUsed = false;
    this.slipArmed = 0;
    this.gustTries = 0;
    this.flowOk = false;
    if (L.flags) this.setFlags(L.flags);
    if (L.pulse) this.pulse(L.pulse);
    if (L.start) this.h.say(`coach-${this.idx}`, L.start);
    if (this.idx === 9) {
      const ph = this.h.physio;
      ph.hasO2 = true;
      ph.spares = 1;
      ph.bottle = 14;
      ph.flow = 0.5;
    }
    this.cardKey = '';
    this.render();
  }

  private finish(silent = false): void {
    const L = this.lessons[this.idx];
    if (L.flags) this.setFlags(L.flags);
    this.h.physio.mods.drain = 0.5;
    if (!silent) {
      this.h.chime();
      this.h.banner(`✓ ${L.title}`, '', 'good', 1400);
      if (L.done) this.h.say(`coach-done-${this.idx}`, L.done);
      this.doneT = 2.2;
      this.cardKey = '';
      this.render();
    }
    this.idx += 1;
    this.started = false;
    if (this.idx >= this.lessons.length) { this.card.classList.add('hidden'); this.finished = true; }
  }

  /** The summit is the end: anything still pending counts as seen. */
  complete(): void {
    this.finished = true;
    this.card.classList.add('hidden');
    this.h.physio.mods.drain = 1;
  }

  /** A fatal mistake: no death screen, straight back to a safe spot and the lesson to redo. */
  fail(): void {
    const L = this.lessons[this.idx] ?? this.lessons[this.lessons.length - 1];
    this.h.respawn(L.retreat);
    this.h.banner('もう一度', '練習だ。何度でもやり直せる', '', 2200);
    if (L.back !== undefined && L.back < this.idx) { this.idx = L.back; }
    this.started = false;
    this.begin();
  }

  update(dt: number): void {
    if (this.finished) return;
    const h = this.h, p = h.player, ph = h.physio, s = p.routeS;
    const ev: PlayerEvent[] = p.events;
    // while a lesson is showing its tick, nothing else starts
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) { this.card.classList.add('hidden'); this.cardKey = ''; }
      return;
    }
    let L = this.lessons[this.idx];
    if (!this.started) {
      if (L.skipAt !== undefined && s >= L.skipAt) { this.finish(true); return; }
      if (s >= L.at) this.begin();
      else return;
      L = this.lessons[this.idx];
    }
    this.t += dt;
    switch (this.idx) {
      case 0: if (s - this.startS >= 8) this.finish(); break;
      case 1: if (h.mapOpen() || s - this.startS >= 40) this.finish(); break;
      case 2:
        ph.mods.drain = this.phase === 0 ? 4 : 0.5;
        this.minStam = Math.min(this.minStam, ph.stamina);
        if (this.phase === 0 && ph.stamina < 60) { this.phase = 1; this.h.banner('体力が減った', '休むと回復する', '', 2000); }
        else if (this.phase === 1 && ph.stamina >= 85) this.finish();
        break;
      case 3: if (this.t >= 10.5) this.finish(); else if (Math.floor(this.t / 3.5) !== Math.floor((this.t - dt) / 3.5)) this.pulse([['v-spo2', 'v-temp', 'v-wind'][Math.min(2, Math.floor(this.t / 3.5))]]); break;
      case 4: this.gust(dt); break;
      case 5: if (p.clip) this.finish(); break;
      case 6:
        if (ev.some((e) => e.type === 'transferred')) this.finish();
        else if (!p.clip && s > h.route.waypointS[5]) this.finish(true);
        break;
      case 7:
        if (ev.some((e) => e.type === 'unclipped') || (!p.clip && s > h.route.waypointS[5])) this.finish();
        break;
      case 8: this.slide(dt, ev); break;
      case 9: this.oxygen(); break;
      case 10: if (this.signRead) this.finish(); break;
      default: if (this.t >= 6) this.finish();
    }
    if (!this.finished) this.render();
  }

  private gust(dt: number): void {
    const h = this.h, p = h.player, w = h.weather, g = w.state;
    if (this.phase === 0 && this.t > 1.8) { w.triggerGust(0.85); this.phase = 1; h.banner('突風が来る', '休むボタンで身を低くして耐えろ', '', 2600); }
    else if (this.phase === 1 && (g.gust > 0.05 || g.gustWarning > 0)) { this.phase = 2; this.gustSeen = true; this.gustTime = 0; this.gustRest = 0; }
    if (this.phase === 2) {
      if (g.gust > 0.3) { this.gustTime += dt; if (p.resting) this.gustRest += dt; }
      if (g.gust <= 0.02 && g.gustWarning < 0 && this.gustSeen && this.gustTime > 0) {
        if (this.gustRest >= this.gustTime * 0.6 || this.gustTries >= 1) { this.finish(); this.gustTries = 0; return; }
        // knocked about, nothing worse: one more try
        this.gustTries += 1;
        p.pos.x += h.windDir.x * 1.1;
        p.pos.z += h.windDir.z * 1.1;
        p.shake = 1;
        h.stumble();
        h.banner('よろけた！', '休むボタンを長押しして、もう一度', 'danger', 2400);
        this.phase = 0; this.t = 0;
      }
    }
  }

  private slide(dt: number, ev: PlayerEvent[]): void {
    const h = this.h, p = h.player;
    const W = h.route.waypointS;
    if (ev.some((e) => e.type === 'axe')) this.axeUsed = true;
    if (this.phase === 0) {
      if (p.routeS >= W[6] + 22 && p.mode === 'walk') {
        this.slipArmed += dt;
        if (this.slipArmed < 0.1) h.banner('足を滑らせるぞ！', 'すぐピッケルを打ち込め', 'danger', 1600);
        if (this.slipArmed > 1.1) { p.slip(false); this.phase = 1; this.slideT = 0; this.axeUsed = false; }
      }
    } else {
      this.slideT += dt;
      if (ev.some((e) => e.type === 'arrest')) {
        if (this.axeUsed) this.finish();
        else this.fail();
      } else if (this.slideT > 2.6 && !this.axeUsed) {
        p.mode = 'walk'; p.slideVel.set(0, 0, 0);
        this.fail();
      }
    }
  }

  private oxygen(): void {
    const ph = this.h.physio;
    if (!this.flowOk && ph.flow >= 2) { this.flowOk = true; this.phase = 1; this.pulse(['v-o2']); }
    if (this.flowOk && ph.spares === 0 && ph.bottle > 200) this.finish();
  }
}
