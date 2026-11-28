/** Procedural underwater soundscape: regulator breathing, exhale bubbles, ambient rumble,
 *  reef crackle (snapping shrimp), whale song, deep drone, camera shutter and discovery chime. */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private crackle!: GainNode;
  private drone!: GainNode;
  private noiseBuf!: AudioBuffer;
  private breathT = 0;
  private crackT = 0;
  private songT = 8;
  muted = false;
  onExhale: (() => void) | null = null;
  breathRate = 1;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // underwater: everything through a gentle low-pass
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    this.master.connect(lp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = (b + 0.02 * w) / 1.02; // brown-ish
      d[i] = b * 3.5 * 0.6 + w * 0.4 * 0.08;
    }
    // ambient rumble
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.35;
    src.connect(f).connect(this.amb).connect(this.master);
    src.start();
    this.crackle = ctx.createGain();
    this.crackle.gain.value = 0;
    this.crackle.connect(this.master);
    // deep drone
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    for (const fr of [43, 64.5, 86.3]) {
      const o = ctx.createOscillator();
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(this.drone);
      o.start();
    }
    this.drone.connect(this.master);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.05, out: AudioNode = this.master) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 1 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  private exhale(t: number) {
    const ctx = this.ctx!;
    this.noise(t, 1.6, 'lowpass', 520, 0.8, 0.5, 0.08);
    for (let i = 0; i < 22; i++) {
      const tt = t + 0.05 + Math.random() * 1.3;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 260 + Math.random() * 700;
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.8, tt + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.07, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
      o.connect(g).connect(this.master);
      o.start(tt);
      o.stop(tt + 0.1);
    }
  }

  shutter(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.05, 'highpass', 3000, 0.7, 0.4, 0.003);
    this.noise(t + 0.08, 0.06, 'bandpass', 1800, 2, 0.3, 0.003);
  }

  chime(big = false): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [659.25, 987.77];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const tt = t + i * 0.09;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.16, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.4);
      o.connect(g).connect(this.master);
      o.start(tt);
      o.stop(tt + 1.5);
    });
  }

  warn(strong = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < (strong ? 6 : 3); i++) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = strong ? 1800 : 1400;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.18);
      g.gain.linearRampToValueAtTime(strong ? 0.08 : 0.05, t + i * 0.18 + 0.01);
      g.gain.linearRampToValueAtTime(0, t + i * 0.18 + 0.09);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.1);
    }
  }

  private whaleSong(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 180 + Math.random() * 220;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * (1.4 + Math.random()), t + 1.2);
    o.frequency.linearRampToValueAtTime(base * 0.7, t + 2.6);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vg = ctx.createGain();
    vg.gain.value = 9;
    vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14 * vol, t + 0.5);
    g.gain.linearRampToValueAtTime(0.0, t + 2.8);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    vib.start(t);
    o.stop(t + 3);
    vib.stop(t + 3);
  }

  /** F7 (17)(29)：ボートで向かう間の音（Web Audio で合成）。エンジン（低いのこぎり波＋ぽこぽこ揺れ・回転が上がる）と波のざわめき */
  travel(sec: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + 0.18);
    out.gain.setValueAtTime(1, t + Math.max(0.2, sec - 0.35));
    out.gain.linearRampToValueAtTime(0, t + sec);
    out.connect(this.master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.linearRampToValueAtTime(520, t + sec * 0.5);
    const eg = ctx.createGain();
    eg.gain.value = 0.15;
    lp.connect(eg).connect(out);
    for (const [type, f] of [['sawtooth', 52], ['sawtooth', 52.8], ['square', 26]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * 0.8, t);
      o.frequency.linearRampToValueAtTime(f * 1.3, t + sec * 0.45);
      o.connect(lp);
      o.start(t);
      o.stop(t + sec + 0.05);
    }
    // ぽこぽこ（エンジンの揺れ）
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lg = ctx.createGain();
    lg.gain.value = 0.06;
    lfo.connect(lg).connect(eg.gain);
    lfo.start(t);
    lfo.stop(t + sec + 0.05);
    // 波のざわめき（帯域ノイズを、ゆっくりの波で揺らす）
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.1;
    const wl = ctx.createOscillator();
    wl.frequency.value = 1.1;
    const wlg = ctx.createGain();
    wlg.gain.value = 0.07;
    wl.connect(wlg).connect(wg.gain);
    n.connect(bp).connect(wg).connect(out);
    n.start(t);
    n.stop(t + sec + 0.05);
    wl.start(t);
    wl.stop(t + sec + 0.05);
  }

  /** F7 (10)：夜明けのやわらかい音（小さな鐘と波） */
  dawn(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.5;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx!.createGain();
      const tt = t + i * 0.22;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.1, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.3);
      o.connect(g).connect(this.master);
      o.start(tt);
      o.stop(tt + 1.4);
    });
  }

  /** Per-frame: breathing cycle and zone ambience. */
  update(dt: number, s: { diving: boolean; depth: number; reef: number; whale: number; deep: number; air: number }): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.amb.gain.setTargetAtTime(s.diving ? 0.35 + Math.min(0.3, s.depth / 200) : 0.15, t, 0.5);
    this.crackle.gain.value = s.reef;
    this.drone.gain.setTargetAtTime(s.deep * 0.5, t, 1.5);
    if (s.diving && s.air > 0) {
      this.breathT -= dt * this.breathRate;
      if (this.breathT <= 0) {
        this.breathT = 5.2;
        // no inhale hiss (Phase 10: the "sha" noise while diving was unwanted); the exhale
        // bubbles and the onExhale timing below carry the breathing cycle on their own
        this.exhale(t + 1.9);
        window.setTimeout(() => this.onExhale?.(), 1900 / this.breathRate);
      }
    }
    if (s.reef > 0.01) {
      this.crackT -= dt;
      while (this.crackT <= 0) {
        this.crackT += 0.008 + Math.random() * 0.05;
        this.noise(t + Math.random() * 0.05, 0.02, 'highpass', 3500 + Math.random() * 3000, 0.5, 0.25 + Math.random() * 0.35, 0.001, this.crackle);
      }
    }
    if (s.whale > 0.02) {
      this.songT -= dt;
      if (this.songT <= 0) {
        this.songT = 4 + Math.random() * 6;
        this.whaleSong(t, s.whale);
      }
    }
  }
}
