import { BOTTLE_LITERS } from '../systems/Physiology';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

export interface HudData {
  altitude: number;
  hours: number;
  turnaround: number;
  turnLabel: string;
  hasO2: boolean;
  nextName: string;
  nextDist: number;
  progress: number;
  spo2: number;
  hr: number;
  stamina: number;
  temp: number;
  frost: number;
  bottle: number;
  spares: number;
  flow: number;
  wind: number;
  ambient: number;
  clipState: 'on' | 'off' | 'need';
  clipText: string;
  clipBtn: 'ready' | 'urgent' | 'normal';
  clipLabel: string;
  restLabel: string;
  restAxe: boolean;
  interact: string | null;
  prompt: string;
  /** Pace against the guide standard (empty = hidden). */
  paceText: string;
  paceTone: '' | 'ahead' | 'behind';
}

export function formatClock(hours: number): string {
  // Hours may be negative (the night before, e.g. -1 = 23:00) or run past midnight.
  const wrapped = ((hours % 24) + 24) % 24;
  const h = Math.floor(wrapped);
  const m = Math.floor((wrapped - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class Hud {
  readonly root = $('hud');
  private readonly el = {
    alt: $('alt-value'), clock: $('clock-value'), turn: $('turn-value'), pace: $('pace-value'), nextName: $('next-name'),
    nextDist: $('next-dist'), progFill: $('progress-fill'), progMarks: $('progress-marks'),
    spo2: $('spo2-value'), hr: $('hr-value'), stam: $('stam-fill'), temp: $('temp-value'), frost: $('frost-value'),
    o2: $('o2-fill'), spare: $('spare-value'), flow: $('flow-value'), wind: $('wind-value'), amb: $('temp-amb'),
    vSpo2: $('v-spo2'), vStam: $('v-stam'), vTemp: $('v-temp'), vO2: $('v-o2'), vWind: $('v-wind'),
    clipStatus: $('clip-status'), clipText: $('clip-text'), clipBtn: $('clip-btn'), clipLabel: $('clip-label'),
    restBtn: $('rest-btn'), restLabel: $('rest-label'), interact: $('interact-btn'), prompt: $('prompt'), banner: $('banner'),
  };
  private cache = new Map<string, string>();
  private bannerTimer = 0;

  private set(key: string, el: HTMLElement, text: string): void {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }

  private cls(key: string, el: HTMLElement, value: string, classes: string[]): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    for (const c of classes) el.classList.remove(c);
    if (value) el.classList.add(value);
  }

  setMarks(fractions: number[]): void {
    this.el.progMarks.innerHTML = fractions.map((f) => `<i style="left:${(f * 100).toFixed(1)}%"></i>`).join('');
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  update(d: HudData): void {
    const e = this.el;
    this.set('alt', e.alt, Math.round(d.altitude).toLocaleString('en-US'));
    this.set('clock', e.clock, formatClock(d.hours));
    const late = d.hours >= d.turnaround;
    this.set('turn', e.turn, late ? `${d.turnLabel}を過ぎた` : `${d.turnLabel} ${formatClock(d.turnaround)}`);
    this.cls('o2vis', this.root, d.hasO2 ? '' : 'no-o2', ['no-o2']);
    this.cls('turnc', e.turn, late ? 'late' : '', ['late']);
    this.set('pace', e.pace, d.paceText);
    this.cls('pacec', e.pace, d.paceTone, ['ahead', 'behind']);
    this.set('nextName', e.nextName, d.nextName);
    this.set('nextDist', e.nextDist, `${Math.max(0, Math.round(d.nextDist))}m`);
    e.progFill.style.width = `${(d.progress * 100).toFixed(1)}%`;

    this.set('spo2', e.spo2, String(Math.round(d.spo2)));
    this.set('hr', e.hr, `♥${Math.round(d.hr)}`);
    this.cls('vspo2', e.vSpo2, d.spo2 < 55 ? 'danger' : d.spo2 < 64 ? 'warn' : '', ['warn', 'danger']);
    e.stam.style.width = `${d.stamina.toFixed(0)}%`;
    this.cls('vstam', e.vStam, d.stamina < 15 ? 'danger' : d.stamina < 35 ? 'warn' : '', ['warn', 'danger']);
    this.set('temp', e.temp, d.temp.toFixed(1));
    this.set('frost', e.frost, d.frost > 15 ? `凍傷${Math.round(d.frost)}` : '');
    this.cls('vtemp', e.vTemp, d.temp < 34 ? 'danger' : d.temp < 35.5 || d.frost > 50 ? 'warn' : '', ['warn', 'danger']);
    const o2 = d.bottle / BOTTLE_LITERS;
    e.o2.style.width = `${(o2 * 100).toFixed(0)}%`;
    this.set('spare', e.spare, `+${d.spares}`);
    this.cls('vo2', e.vO2, d.bottle <= 0 ? 'danger' : o2 < 0.2 ? 'warn' : '', ['warn', 'danger']);
    this.set('flow', e.flow, '');
    if (this.cache.get('flowv') !== d.flow.toFixed(1)) {
      this.cache.set('flowv', d.flow.toFixed(1));
      e.flow.innerHTML = `${d.flow.toFixed(1)}<small>L/分</small>`;
    }
    this.set('wind', e.wind, String(Math.round(d.wind)));
    this.set('amb', e.amb, `${Math.round(d.ambient)}°`);
    this.cls('vwind', e.vWind, d.wind > 75 ? 'danger' : d.wind > 50 ? 'warn' : '', ['warn', 'danger']);

    this.cls('clips', e.clipStatus, d.clipState === 'off' ? '' : d.clipState, ['on', 'need']);
    this.set('clipt', e.clipText, d.clipText);
    this.cls('clipb', e.clipBtn, d.clipBtn === 'normal' ? '' : d.clipBtn, ['ready', 'urgent']);
    this.set('clipl', e.clipLabel, d.clipLabel);
    this.set('restl', e.restLabel, d.restLabel);
    this.cls('resta', e.restBtn, d.restAxe ? 'axe' : '', ['axe']);
    if (d.interact) {
      e.interact.classList.remove('hidden');
      this.set('inter', e.interact, d.interact);
    } else e.interact.classList.add('hidden');
    if (this.cache.get('prompt') !== d.prompt) {
      this.cache.set('prompt', d.prompt);
      e.prompt.innerHTML = d.prompt;
      e.prompt.classList.toggle('show', !!d.prompt);
    }
  }

  banner(text: string, sub = '', tone: '' | 'danger' | 'good' = '', ms = 3200): void {
    const b = this.el.banner;
    b.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
    b.classList.remove('danger', 'good');
    if (tone) b.classList.add(tone);
    b.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), ms);
  }

  clearBanner(): void {
    this.el.banner.classList.remove('show');
  }
}
