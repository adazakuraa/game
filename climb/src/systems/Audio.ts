/** Fully procedural Web Audio: wind, breathing through a mask, heartbeat, crampons, hardware. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windHigh!: GainNode;
  private windHighFilter!: BiquadFilterNode;
  private hissGain!: GainNode;
  private droneGain!: GainNode;
  private lastHeart = 0;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 3;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // slightly pinked noise
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w;
      d[i] = w * 0.6 + b * 3.0;
    }

    // Wind: low roar + high whistle.
    const wsrc = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wsrc.connect(this.windFilter).connect(this.windGain).connect(this.master);

    const hsrc = this.loopNoise();
    this.windHighFilter = ctx.createBiquadFilter();
    this.windHighFilter.type = 'bandpass';
    this.windHighFilter.frequency.value = 1200;
    this.windHighFilter.Q.value = 6;
    this.windHigh = ctx.createGain();
    this.windHigh.gain.value = 0;
    hsrc.connect(this.windHighFilter).connect(this.windHigh).connect(this.master);

    // Regulator hiss
    const rsrc = this.loopNoise();
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 5000;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    rsrc.connect(rf).connect(this.hissGain).connect(this.master);

    // Very quiet drone pad (dawn/summit mood)
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    for (const f of [110, 164.8, 220, 277.2]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(g).connect(lp);
      o.start();
    }
    lp.connect(this.droneGain).connect(this.master);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  private loopNoise(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    src.start(0, Math.random() * 2);
    return src;
  }

  private burst(opts: {
    t?: number; dur: number; freq: number; q?: number; type?: BiquadFilterType; gain: number;
    attack?: number; rate?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = opts.t ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', t?: number, slide?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = t ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** Continuous layers, call every frame. */
  update(p: {
    wind: number; gust: number; storm: number; flow: number; breathPhase: number; breathRate: number;
    effort: number; heartPhase: number; heartRate: number; heartLoud: number; drone: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const w = Math.min(1.4, p.wind / 70);
    this.windGain.gain.setTargetAtTime(0.08 + w * 0.42, now, 0.3);
    this.windFilter.frequency.setTargetAtTime(220 + w * 700 + p.gust * 500, now, 0.3);
    this.windHigh.gain.setTargetAtTime(p.gust * 0.05 + p.storm * 0.04 + w * 0.012, now, 0.2);
    this.windHighFilter.frequency.setTargetAtTime(900 + p.gust * 900 + Math.sin(now * 0.7) * 200, now, 0.4);
    this.hissGain.gain.setTargetAtTime(p.flow > 0 ? 0.004 + p.flow * 0.0015 : 0, now, 0.2);
    this.droneGain.gain.setTargetAtTime(p.drone * 0.18, now, 2.0);

    // Breathing sounds were removed at the player's request; heartbeat stays.

    if (p.heartLoud > 0.02 && p.heartPhase < this.lastHeart) {
      this.tone(58, 0.16, 0.25 * p.heartLoud, 'sine', now, 40);
      this.tone(52, 0.14, 0.18 * p.heartLoud, 'sine', now + 0.17, 38);
    }
    this.lastHeart = p.heartPhase;
  }

  step(surface: 'snow' | 'rock', heavy: number): void {
    if (!this.ctx) return;
    if (surface === 'snow') {
      this.burst({ dur: 0.18, freq: 2400, q: 0.6, gain: 0.07 + heavy * 0.05, attack: 0.008, rate: 1.4 });
      this.burst({ dur: 0.12, freq: 500, q: 0.9, gain: 0.08, attack: 0.004, rate: 0.6 });
    } else {
      this.burst({ dur: 0.08, freq: 3800, q: 3, gain: 0.06, attack: 0.002 });
      this.tone(2900 + Math.random() * 600, 0.08, 0.02, 'triangle');
    }
  }

  clink(): void {
    this.tone(2620, 0.35, 0.07, 'sine');
    this.tone(4180, 0.25, 0.04, 'sine');
    this.tone(1880, 0.15, 0.03, 'triangle');
  }

  zip(): void {
    this.burst({ dur: 0.5, freq: 3000, q: 2, gain: 0.05, attack: 0.05 });
  }

  slip(): void {
    this.burst({ dur: 0.9, freq: 900, q: 0.5, gain: 0.25, attack: 0.02, rate: 1.2 });
  }

  impact(): void {
    this.burst({ dur: 0.5, freq: 160, q: 0.6, gain: 0.6, attack: 0.003, type: 'lowpass' });
    this.tone(70, 0.4, 0.3, 'sine', undefined, 35);
  }

  axe(): void {
    this.burst({ dur: 0.25, freq: 2500, q: 1.5, gain: 0.15, attack: 0.002 });
  }

  crack(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      this.burst({ t: t + i * 0.09 + Math.random() * 0.05, dur: 0.12, freq: 1200 + Math.random() * 2000, q: 2, gain: 0.25, attack: 0.002 });
    }
    this.burst({ t: t + 0.3, dur: 3.5, freq: 120, q: 0.5, gain: 0.7, attack: 0.4, type: 'lowpass', rate: 0.5 });
  }

  /** Radio squelch + beep before a base-camp call. */
  radio(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({ t, dur: 0.25, freq: 2200, q: 0.6, gain: 0.08, attack: 0.005 });
    this.tone(1250, 0.09, 0.05, 'square', t + 0.05);
    this.tone(1650, 0.09, 0.04, 'square', t + 0.16);
    this.burst({ t: t + 0.3, dur: 2.4, freq: 1800, q: 0.4, gain: 0.012, attack: 0.1 });
  }

  /** Far-off avalanche roar; quieter the farther away. */
  avalanche(distance: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = Math.max(0.12, 0.6 - distance / 1500);
    this.burst({ t, dur: 7, freq: 90, q: 0.5, gain: g, attack: 1.2, type: 'lowpass', rate: 0.4 });
    this.burst({ t: t + 0.4, dur: 6, freq: 350, q: 0.5, gain: g * 0.4, attack: 1.5, type: 'lowpass', rate: 0.6 });
  }

  /** Glacier ice settling: a sharp crack and a low boom. */
  iceCrack(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({ t, dur: 0.09, freq: 2600, q: 3, gain: 0.3, attack: 0.001 });
    this.tone(60, 0.6, 0.25, 'sine', t + 0.02, 30);
    this.burst({ t: t + 0.05, dur: 0.8, freq: 180, q: 0.7, gain: 0.25, attack: 0.01, type: 'lowpass' });
  }

  rockfall(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 9; i++) {
      this.burst({ t: t + i * 0.13 + Math.random() * 0.08, dur: 0.07, freq: 700 + Math.random() * 1500, q: 4, gain: 0.3, attack: 0.002 });
    }
    this.burst({ t: t + 0.2, dur: 1.8, freq: 300, q: 0.6, gain: 0.25, attack: 0.1, type: 'lowpass' });
  }

  valve(): void {
    this.burst({ dur: 0.6, freq: 6000, q: 0.8, gain: 0.08, attack: 0.02, type: 'highpass' });
    this.tone(900, 0.08, 0.04, 'square');
  }

  alarm(): void {
    this.tone(880, 0.12, 0.05, 'triangle');
    this.tone(660, 0.12, 0.05, 'triangle', (this.ctx?.currentTime ?? 0) + 0.15);
  }

  /** Short rising chime: a tense moment is over (praise). */
  cleared(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(587.3, 0.35, 0.07, 'triangle', t);
    this.tone(880, 0.6, 0.07, 'triangle', t + 0.12);
  }

  /** "Wan!" — a short bark from the dog (pitch slides down, a little throaty noise). */
  bark(near = 1): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [dt, f] of [[0, 620], [0.2, 560]] as const) {
      this.tone(f, 0.13, 0.09 * near, 'sawtooth', t + dt, f * 0.55);
      this.burst({ t: t + dt, dur: 0.12, freq: 900, q: 1.2, gain: 0.08 * near, attack: 0.005 });
    }
  }

  /** Noodle slurp: a rising airy whoosh. */
  slurp(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({ t, dur: 0.55, freq: 1800, q: 2.5, gain: 0.09, attack: 0.08, rate: 1.4 });
    this.burst({ t: t + 0.15, dur: 0.4, freq: 2600, q: 3, gain: 0.06, attack: 0.05, rate: 1.7 });
  }

  /** Crunch / chew. */
  munch(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({ t, dur: 0.08, freq: 2400, q: 0.8, gain: 0.1, attack: 0.003 });
    this.burst({ t: t + 0.11, dur: 0.07, freq: 2000, q: 0.8, gain: 0.08, attack: 0.003 });
  }

  /** Warm gulp of tea. */
  gulp(): void {
    this.tone(180, 0.18, 0.08, 'sine', undefined, 120);
  }

  /** Coin counter tick. */
  coin(): void {
    this.tone(1568, 0.08, 0.035, 'square');
    this.tone(2093, 0.12, 0.03, 'triangle');
  }

  /** Camp arrival: a short bright fanfare. */
  fanfare(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[523.3, 0], [659.3, 0.12], [784, 0.24], [1046.5, 0.4]].forEach(([f, d]) => this.tone(f, d === 0.4 ? 1.4 : 0.3, 0.07, 'triangle', t + d));
    [261.6, 329.6, 392].forEach((f) => this.tone(f, 1.8, 0.035, 'sine', t + 0.4));
  }

  /** The grade stamp hitting the paper. */
  stamp(): void {
    this.burst({ dur: 0.18, freq: 220, q: 0.7, gain: 0.35, attack: 0.002, type: 'lowpass' });
    this.tone(90, 0.2, 0.15, 'sine', undefined, 55);
  }

  summit(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [220, 277.2, 329.6, 440].forEach((f, i) => this.tone(f, 4, 0.06, 'triangle', t + i * 0.25));
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
