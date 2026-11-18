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
  private lastBreath = 0;
  private breathBus!: GainNode;
  breathOn = true;
  /** whether the climber is breathing through an oxygen mask */
  masked = false;
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

    // Breathing has its own bus so it can be switched off in settings.
    this.breathBus = ctx.createGain();
    this.breathBus.gain.value = this.breathOn ? 1 : 0;
    this.breathBus.connect(this.master);

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

  setBreathing(on: boolean): void {
    this.breathOn = on;
    if (this.ctx) this.breathBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1);
  }

  /**
   * One breath: filtered noise shaped like an inhale or exhale. Through a mask it is
   * muffled with a demand-valve click; open-mouthed it is brighter and rougher.
   */
  private breathe(inhale: boolean, dur: number, effort: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = inhale ? 0.95 : 0.75;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = inhale ? 1500 + effort * 500 : 700 + effort * 250;
    f1.Q.value = inhale ? 1.1 : 0.9;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = inhale ? 3200 : 1700;
    f2.Q.value = 1.4;
    const shape = ctx.createBiquadFilter();
    shape.type = 'lowpass';
    shape.frequency.value = this.masked ? 1400 : 5200;
    const g = ctx.createGain();
    const peak = (inhale ? 0.16 : 0.22) * (0.45 + effort * 0.9) * (this.masked ? 1.25 : 1);
    // Natural envelope: inhale swells then stops; exhale bursts out then trails off.
    const n = 24;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const env = inhale ? Math.pow(Math.sin(Math.min(1, x * 1.15) * Math.PI * 0.5), 1.6) * (1 - Math.pow(x, 6)) : Math.pow(1 - x, 1.7) * Math.min(1, x * 9);
      curve[i] = Math.max(0.0001, env * peak * (0.9 + Math.random() * 0.2));
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueCurveAtTime(curve, t, dur);
    const mix = ctx.createGain();
    mix.gain.value = 1;
    src.connect(f1).connect(mix);
    const f2g = ctx.createGain();
    f2g.gain.value = 0.45;
    src.connect(f2).connect(f2g).connect(mix);
    mix.connect(shape).connect(g).connect(this.breathBus);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.1);
    if (this.masked) {
      // Demand valve: a soft click and hiss at the start of each breath.
      const c = ctx.createBufferSource();
      c.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3500;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(inhale ? 0.05 : 0.035, t + 0.01);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + (inhale ? 0.18 : 0.08));
      c.connect(hp).connect(cg).connect(this.breathBus);
      c.start(t, Math.random() * 2);
      c.stop(t + 0.25);
    }
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

    // Breathing: inhale at phase 0, exhale at 0.45 of each breath cycle.
    this.masked = p.flow > 0;
    const ph = p.breathPhase;
    if (ph < this.lastBreath) {
      this.breathe(true, Math.min(1.3, (60 / p.breathRate) * 0.42), p.effort);
    }
    if (this.lastBreath < 0.45 && ph >= 0.45) {
      this.breathe(false, Math.min(1.5, (60 / p.breathRate) * 0.52), p.effort);
    }
    this.lastBreath = ph;

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
