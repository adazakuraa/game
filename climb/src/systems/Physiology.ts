import { clamp, lerp } from '../utils/noise';

export const BOTTLE_LITERS = 1150; // ~4 L cylinder at ~290 bar

export interface PhysioContext {
  altitude: number;      // display metres
  exertion: number;      // 0 rest .. 1 hard climbing
  resting: boolean;
  windKmh: number;
  ambientC: number;
  gameMinutes: number;   // game minutes elapsed this step
  dt: number;            // real seconds
  handsExposed: boolean; // e.g. during carabiner transfer
}

export type DeathCause = 'hace' | 'hypothermia' | 'exhaustion' | null;

/** Very simplified high-altitude physiology with supplemental oxygen. */
export class Physiology {
  spo2 = 82;
  heartRate = 92;
  stamina = 100;
  coreTemp = 36.9;
  frostbite = 0;
  hace = 0;
  bottle = BOTTLE_LITERS;
  spares = 1;
  flow = 2;
  collapsed = false;
  breathPhase = 0;
  breathRate = 16;
  heartPhase = 0;
  heatBalance = 0;
  regulatorFrozen = 0;

  reset(spares: number): void {
    this.spo2 = 80;
    this.heartRate = 96;
    this.stamina = 100;
    this.coreTemp = 36.9;
    this.frostbite = 0;
    this.hace = 0;
    this.bottle = BOTTLE_LITERS;
    this.spares = spares;
    this.flow = 2;
    this.collapsed = false;
  }

  get effectiveFlow(): number {
    return this.bottle > 0 ? this.flow : 0;
  }

  /** Target saturation for an acclimatised climber at an effective altitude. */
  static spo2ForAltitude(alt: number): number {
    const table: [number, number][] = [
      [0, 98], [3000, 92], [5000, 84], [6500, 77], [7500, 71], [8000, 67], [8500, 61], [8849, 56], [9500, 48],
    ];
    if (alt <= table[0][0]) return table[0][1];
    for (let i = 0; i < table.length - 1; i++) {
      const [a0, s0] = table[i];
      const [a1, s1] = table[i + 1];
      if (alt <= a1) return lerp(s0, s1, (alt - a0) / (a1 - a0));
    }
    return table[table.length - 1][1];
  }

  update(c: PhysioContext): DeathCause {
    const dt = c.dt;
    // Oxygen: each L/min roughly "lowers" the felt altitude.
    const flow = this.effectiveFlow;
    this.bottle = Math.max(0, this.bottle - flow * c.gameMinutes);
    const effAlt = c.altitude - flow * 620;
    const target = Physiology.spo2ForAltitude(effAlt) - c.exertion * 7 + (c.resting ? 2 : 0);
    this.spo2 += (target - this.spo2) * Math.min(1, dt / 5);

    const hypoxia = this.performanceHypoxia;

    // Heart rate & breathing follow exertion and hypoxia.
    const hrTarget = 78 + c.exertion * 60 + hypoxia * 30 + (this.stamina < 25 ? 15 : 0);
    this.heartRate += (hrTarget - this.heartRate) * Math.min(1, dt / 3);
    this.heartPhase = (this.heartPhase + dt * this.heartRate / 60) % 1;
    const brTarget = 14 + c.exertion * 22 + hypoxia * 14;
    this.breathRate += (brTarget - this.breathRate) * Math.min(1, dt / 2);
    this.breathPhase = (this.breathPhase + dt * this.breathRate / 60) % 1;

    // Stamina.
    if (c.exertion > 0.05) {
      this.stamina -= dt * (0.6 + 1.6 * c.exertion) * (1 + hypoxia * 1.0) * (this.coreTemp < 35 ? 1.4 : 1);
    } else {
      const rec = (c.resting ? 10 : 6) * Math.pow(clamp(this.spo2 / 88, 0.3, 1.1), 3);
      this.stamina += dt * rec;
    }
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0) this.collapsed = true;
    if (this.collapsed && this.stamina > 30) this.collapsed = false;

    // Heat balance: moving warms you, wind and stillness strip heat.
    const produce = 0.45 + c.exertion * 0.8;
    const chill = 0.25 + Math.max(0, -c.ambientC - 25) * 0.01 + Math.pow(c.windKmh / 50, 1.3) * 0.45;
    this.heatBalance = produce - chill;
    const dT = this.heatBalance * 0.018 * dt;
    if (dT < 0 || this.coreTemp < 37) this.coreTemp = Math.min(37.0, this.coreTemp + dT);

    // Frostbite: extreme wind chill and exposed hands.
    const frostRate = Math.max(0, chill - 0.9) * 0.3 + (c.handsExposed ? 1.2 : 0) + (this.coreTemp < 35 ? 0.4 : 0);
    this.frostbite = clamp(this.frostbite + frostRate * dt, 0, 100);

    // HACE accumulates under sustained severe hypoxaemia.
    if (this.spo2 < 60) this.hace += (60 - this.spo2) * 0.045 * dt;
    else this.hace = Math.max(0, this.hace - 0.25 * dt);

    if (this.hace >= 100) return 'hace';
    if (this.coreTemp <= 32) return 'hypothermia';
    return null;
  }

  /** Visual/neurological hypoxia (tunnel vision, desaturation). */
  get hypoxia(): number {
    return clamp((72 - this.spo2) / 22, 0, 1);
  }

  /** Physical performance penalty: even 70% SpO2 noticeably slows you; more O2 flow helps. */
  get performanceHypoxia(): number {
    return clamp((80 - this.spo2) / 25, 0, 1);
  }
}

export interface WeatherState {
  windKmh: number;
  gust: number;          // 0..1 current gust strength
  gustWarning: number;   // seconds until next gust if telegraphed (<0 none)
  storm: number;         // 0..1
  ambientC: number;
  snowfall: number;      // 0..1
}

/** Wind, gusts and storms; all randomness via the seeded RNG. */
export class Weather {
  readonly state: WeatherState = { windKmh: 20, gust: 0, gustWarning: -1, storm: 0, ambientC: -30, snowfall: 0 };
  private nextGust = 20;
  private gustT = -1;
  private gustPeak = 0;
  private stormTarget = 0;
  private stormChecked = false;

  constructor(private rng: () => number, private readonly baseWind: number) {}

  reset(rng: () => number): void {
    this.rng = rng;
    this.nextGust = 25 + this.rng() * 20;
    this.gustT = -1;
    this.state.storm = 0;
    this.stormTarget = 0;
    this.stormChecked = false;
  }

  forceStorm(v: number): void {
    this.stormTarget = v;
    this.state.storm = v;
  }

  update(dt: number, hours: number, altitude: number, elapsed: number): void {
    const s = this.state;
    // Afternoon storms are a real Himalayan pattern.
    if (!this.stormChecked && hours > 11.5) {
      this.stormChecked = true;
      if (this.rng() < 0.55) this.stormTarget = 0.85;
    }
    if (hours > 14.5) this.stormTarget = Math.max(this.stormTarget, 0.9);
    s.storm += (this.stormTarget - s.storm) * Math.min(1, dt / 40);

    const diurnal = hours < 6 ? 6 : hours > 12 ? (hours - 12) * 4 : 0;
    const altK = 1 + Math.max(0, altitude - 8000) / 1500;
    const base = (this.baseWind + diurnal + Math.sin(elapsed * 0.07) * 5) * altK + s.storm * 45;

    // Gust cycle: warning -> gust -> calm
    this.nextGust -= dt;
    if (this.nextGust <= 0 && this.gustT < 0) {
      this.gustT = 0;
      this.gustPeak = 0.5 + this.rng() * 0.5 + s.storm * 0.3;
      this.nextGust = 18 + this.rng() * 26 - s.storm * 10;
    }
    if (this.gustT >= 0) {
      this.gustT += dt;
      const warn = 2.2;
      s.gustWarning = this.gustT < warn ? warn - this.gustT : -1;
      const g = this.gustT < warn ? (this.gustT / warn) * 0.25 : Math.sin(Math.min(1, (this.gustT - warn) / 2.6) * Math.PI);
      s.gust = Math.max(0, g) * this.gustPeak;
      if (this.gustT > warn + 2.6) { this.gustT = -1; s.gust = 0; s.gustWarning = -1; }
    }
    s.windKmh = base * (1 + s.gust * 1.4);
    const night = hours < 6 || hours > 18 ? 1 : 0;
    s.ambientC = -24 - (altitude - 8000) * 0.0065 - night * 8 - s.storm * 7 - s.gust * 2;
    s.snowfall = Math.min(1, s.storm * 1.1 + s.gust * 0.5 + 0.08);
  }
}
