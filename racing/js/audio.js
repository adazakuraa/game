// Web Audio によるエンジン音・スキール音・風切り音・衝突音の合成
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // ノイズバッファ
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // エンジン
    const eng = ctx.createGain();
    eng.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.4;
    const mk = (type, g) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(shaper);
      o.start();
      return o;
    };
    this.oscs = [mk('sawtooth', 0.35), mk('square', 0.22), mk('sawtooth', 0.12), mk('triangle', 0.3)];
    shaper.connect(lp).connect(eng).connect(this.master);
    this.engGain = eng;
    this.engLP = lp;
    // 吸気ノイズ
    const intake = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    const ig = ctx.createGain();
    ig.gain.value = 0;
    intake.connect(bp).connect(ig).connect(this.master);
    this.intakeBP = bp;
    this.intakeGain = ig;
    // スキール
    const sq = this.noise();
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 1100;
    sbp.Q.value = 9;
    const sbp2 = ctx.createBiquadFilter();
    sbp2.type = 'bandpass';
    sbp2.frequency.value = 1700;
    sbp2.Q.value = 12;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    sq.connect(sbp).connect(sg);
    sq.connect(sbp2).connect(sg);
    sg.connect(this.master);
    this.squealGain = sg;
    this.squealBP = sbp;
    // 風切り
    const wn = this.noise();
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 700;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    wn.connect(wlp).connect(wg).connect(this.master);
    this.windGain = wg;
    this.windLP = wlp;
    // 路面ゴロゴロ（芝・縁石）
    const rn = this.noise();
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 160;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    rn.connect(rlp).connect(rg).connect(this.master);
    this.rumbleGain = rg;
    // 雨
    const rainN = this.noise();
    const rhp = ctx.createBiquadFilter();
    rhp.type = 'highpass';
    rhp.frequency.value = 2500;
    const rag = ctx.createGain();
    rag.gain.value = 0;
    rainN.connect(rhp).connect(rag).connect(this.master);
    this.rainGain = rag;
    // 他車
    const ao = ctx.createOscillator();
    ao.type = 'sawtooth';
    const alp = ctx.createBiquadFilter();
    alp.type = 'lowpass';
    alp.frequency.value = 900;
    const ag = ctx.createGain();
    ag.gain.value = 0;
    ao.connect(alp).connect(ag).connect(this.master);
    ao.start();
    this.aiOsc = ao;
    this.aiGain = ag;
  }

  noise() {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    n.start(0, Math.random() * 1.5);
    return n;
  }

  // 毎フレーム
  update(p) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.05;
    const on = p.active ? 1 : 0;
    const eng = p.engine ?? 1; // 0 にするとエンジン音なし（自転車）
    const f = (p.rpm / 60) * 3;
    this.oscs[0].frequency.setTargetAtTime(f, t, 0.02);
    this.oscs[1].frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.oscs[2].frequency.setTargetAtTime(f * 2.01, t, 0.02);
    this.oscs[3].frequency.setTargetAtTime(f * 0.25, t, 0.02);
    this.engLP.frequency.setTargetAtTime(380 + p.throttle * 2600 + p.rpm * 0.25, t, k);
    this.engGain.gain.setTargetAtTime(on * eng * (0.1 + p.throttle * 0.16), t, k);
    this.intakeBP.frequency.setTargetAtTime(f * 4, t, k);
    this.intakeGain.gain.setTargetAtTime(on * eng * p.throttle * (p.rpm / 8000) * 0.12, t, k);
    this.squealGain.gain.setTargetAtTime(on * Math.min(0.5, p.squeal * 0.5), t, 0.04);
    this.squealBP.frequency.setTargetAtTime(950 + p.squeal * 300, t, 0.1);
    const sp = Math.min(1, p.speed / 75);
    this.windGain.gain.setTargetAtTime(on * sp * sp * 0.22, t, 0.1);
    this.windLP.frequency.setTargetAtTime(400 + sp * 1600, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(on * Math.min(1, p.rumble) * Math.min(1, p.speed / 15) * 0.6, t, 0.03);
    this.rainGain.gain.setTargetAtTime(on * (p.rain ? 0.07 : 0), t, 0.3);
    this.aiOsc.frequency.setTargetAtTime((p.aiRpm / 60) * 3, t, 0.05);
    this.aiGain.gain.setTargetAtTime(on * Math.min(0.1, p.aiNear * 0.1), t, 0.05);
  }

  impact(power) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + power * 80;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const v = Math.min(1, 0.25 + power * 0.06);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(lp).connect(g).connect(this.master);
    src.stop(t + 0.4);
  }

  beep(freq, dur = 0.18, vol = 0.25) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
