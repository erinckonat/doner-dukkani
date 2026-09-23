export type SfxName = 'pickup' | 'drop' | 'serve' | 'register' | 'tick' | 'unlock' | 'trash' | 'order' | 'moto';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Public-domain recording of a busy restaurant (stephan, PDSounds via Wikimedia Commons),
// crossfaded into a seamless loop.
const CROWD_URL = `${import.meta.env.BASE_URL}sfx/restaurant.mp4`;

/**
 * Synthesized sound: noise- and partial-based effects through a small room reverb,
 * plus ambience — a recorded restaurant crowd that swells with the number of customers, and the spit's sizzle.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private out!: GainNode;
  private crowd!: GainNode;
  private sizzle!: GainNode;
  private noise!: AudioBuffer;
  private last: Partial<Record<SfxName, number>> = {};
  private crowdLayers: GainNode[] = [];
  private _enabled = true;

  get enabled() { return this._enabled; }
  set enabled(v: boolean) {
    this._enabled = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.build(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private build(ctx: AudioContext) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this._enabled ? 1 : 0;
    this.master.connect(comp);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Short room reverb from a decaying noise impulse.
    const len = Math.floor(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    reverb.connect(wet).connect(this.master);

    this.out = ctx.createGain();
    this.out.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    this.out.connect(send).connect(reverb);

    // Crowd bus: the recording already carries its own room, so only a light send.
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    this.crowd.connect(lp);
    lp.connect(this.master);
    const crowdSend = ctx.createGain();
    crowdSend.gain.value = 0.12;
    lp.connect(crowdSend).connect(reverb);
    void this.loadCrowd(ctx);

    // Continuous sizzle from the döner spit.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowpass';
    shelf.frequency.value = 9000;
    this.sizzle = ctx.createGain();
    this.sizzle.gain.value = 0;
    src.connect(hp).connect(shelf).connect(this.sizzle).connect(this.master);
    src.start();
  }

  // ---------- building blocks ----------

  private burst(o: { dur: number; freq: number; q?: number; vol: number; type?: BiquadFilterType; delay?: number; freqEnd?: number; dest?: AudioNode }) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f).connect(g).connect(o.dest ?? this.out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.02);
  }

  private tone(freq: number, dur: number, vol: number, o: { type?: OscillatorType; delay?: number; slideTo?: number } = {}) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Inharmonic partials: coins, bells. */
  private metal(base: number, dur: number, vol: number, delay = 0) {
    const partials = [1, 2.76, 5.4, 8.93];
    partials.forEach((p, i) => this.tone(base * p, dur / (1 + i * 0.6), vol / (1 + i * 1.4), { delay }));
  }

  private thud(freq: number, vol: number, delay = 0) {
    this.tone(freq, 0.12, vol, { slideTo: freq * 0.5, delay });
    this.burst({ dur: 0.03, freq: 1200, q: 0.7, vol: vol * 0.4, delay });
  }

  // ---------- effects ----------

  play(name: SfxName, pitch = 1, throttleMs = 45) {
    if (!this._enabled || !this.ctx) return;
    const now = performance.now();
    if (now - (this.last[name] ?? 0) < throttleMs) return;
    this.last[name] = now;
    switch (name) {
      case 'pickup': // paper wrap rustle + soft hand thump
        this.burst({ dur: 0.08, freq: 2600 * pitch, q: 0.9, vol: 0.22, freqEnd: 4200 * pitch });
        this.thud(170, 0.12);
        break;
      case 'drop': // wrap set down on the counter
        this.thud(130, 0.25);
        this.burst({ dur: 0.05, freq: 2200, q: 1, vol: 0.12, delay: 0.01 });
        break;
      case 'serve':
        this.burst({ dur: 0.12, freq: 1800, q: 0.6, vol: 0.18, freqEnd: 3500 });
        break;
      case 'register': // drawer slide + bell
        this.burst({ dur: 0.14, freq: 600, q: 0.5, vol: 0.2, type: 'lowpass', freqEnd: 1400 });
        this.metal(1760, 0.9, 0.1, 0.08);
        for (let i = 0; i < 3; i++) this.metal(rand(2500, 3400), 0.25, 0.04, 0.12 + rand(0, 0.08));
        break;
      case 'tick': // single coin dropping into the tile
        this.metal(1800 * pitch, 0.18, 0.06);
        break;
      case 'trash': // crumple then bin thump
        for (let i = 0; i < 4; i++) this.burst({ dur: 0.04, freq: rand(1200, 4500), q: 1.5, vol: 0.16, delay: i * 0.03 });
        this.thud(95, 0.2, 0.13);
        break;
      case 'order': // tablet notification: two soft chimes
        this.metal(1320, 0.5, 0.08);
        this.metal(1760, 0.6, 0.08, 0.16);
        break;
      case 'moto': // scooter pulling away: rising engine buzz + exhaust hiss
        this.tone(55, 1.4, 0.12, { type: 'sawtooth', slideTo: 110 });
        this.tone(110, 1.4, 0.05, { type: 'square', slideTo: 190 });
        this.burst({ dur: 1.2, freq: 300, q: 0.7, vol: 0.08, type: 'lowpass', freqEnd: 900 });
        break;
      case 'unlock': // whoosh + bell arpeggio
        this.burst({ dur: 0.5, freq: 400, q: 0.8, vol: 0.12, freqEnd: 4000 });
        [1047, 1319, 1568, 2093].forEach((f, i) => this.metal(f, 1.1, 0.09, 0.1 + i * 0.09));
        break;
    }
  }

  // ---------- ambience ----------

  /**
   * Two copies of the loop, offset in time and slightly detuned so they never line up.
   * The first is the regular hum; the second fades in when the shop gets busy.
   */
  private async loadCrowd(ctx: AudioContext) {
    try {
      const buf = await ctx.decodeAudioData(await (await fetch(CROWD_URL)).arrayBuffer());
      [[0, -0.2, 1], [0.47, 0.35, 0.97]].forEach(([offset, panV, rate]) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.playbackRate.value = rate;
        const g = ctx.createGain();
        g.gain.value = 0;
        const pan = ctx.createStereoPanner();
        pan.pan.value = panV;
        src.connect(g).connect(pan).connect(this.crowd);
        src.start(0, offset * buf.duration);
        this.crowdLayers.push(g);
      });
    } catch {
      /* no crowd ambience if the file can't load */
    }
  }

  /** people: customers around; kitchen: 0..1 closeness to the spits; spits: count. */
  update(dt: number, people: number, kitchen: number, spits: number) {
    const ctx = this.ctx;
    if (!ctx || !this._enabled) return;
    const now = ctx.currentTime;
    const [base, busy] = this.crowdLayers;
    base?.gain.setTargetAtTime(people ? Math.min(1, 0.3 + people * 0.06) : 0, now, 1.2);
    busy?.gain.setTargetAtTime(Math.max(0, Math.min(0.8, (people - 6) / 10)), now, 1.5);
    this.sizzle.gain.setTargetAtTime(spits ? (0.012 + spits * 0.006) * (0.35 + kitchen * 0.65) : 0, now, 0.3);

    if (Math.random() < dt * spits * 5 * kitchen) {
      this.burst({ dur: 0.012, freq: rand(4000, 8000), q: 2, vol: rand(0.03, 0.07), type: 'highpass' });
    }
  }
}
