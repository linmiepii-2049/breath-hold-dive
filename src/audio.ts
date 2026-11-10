export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private drone: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private beatAcc = 0;
  private waveAcc = 5;

  unlock(): void {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  setUnderwater(on: boolean, depth: number): void {
    if (!this.ctx || !this.ambience || !this.drone || !this.filter) return;
    const now = this.ctx.currentTime;
    this.ambience.gain.setTargetAtTime(on ? 0.28 : 0.07, now, 0.35);
    this.drone.gain.setTargetAtTime(on ? 0.05 : 0.02, now, 0.4);
    const freq = on ? Math.max(180, 760 - depth * 16) : 1600;
    this.filter.frequency.setTargetAtTime(freq, now, 0.3);
  }

  heartbeat(dt: number, bpm: number, enabled: boolean): void {
    if (!enabled || !this.ctx || this.muted) {
      this.beatAcc = 0;
      return;
    }
    this.beatAcc += dt;
    const interval = 60 / Math.max(40, bpm);
    if (this.beatAcc >= interval) {
      this.beatAcc -= interval;
      const t = this.ctx.currentTime;
      this.thump(t, 0.62);
      this.thump(t + 0.12, 0.34);
    }
  }

  shoreWave(dt: number, enabled: boolean): void {
    if (!enabled || !this.ctx || this.muted) return;
    this.waveAcc += dt;
    if (this.waveAcc > 8) {
      this.waveAcc = 0;
      this.noiseBurst(this.ctx.currentTime, 0.6, 500, 0.08);
    }
  }

  shutter(): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.tone(t, 1800, 0.03, 0.08, 'square');
    this.noiseBurst(t, 0.045, 2500, 0.12);
  }

  bubbles(): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const when = t + i * 0.045;
      const freq = 380 + Math.random() * 520;
      this.tone(when, freq, 0.07, 0.045, 'sine');
    }
  }

  private build(): void {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.996 * b0 + 0.004 * white;
      b1 = 0.97 * b1 + 0.03 * white;
      data[i] = b0 * 0.85 + b1 * 0.35;
    }
    this.noise = buffer;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 480;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0;
    src.connect(this.filter);
    this.filter.connect(this.ambience);
    this.ambience.connect(this.master);
    src.start();

    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sine';
    o2.type = 'sine';
    o1.frequency.value = 52;
    o2.frequency.value = 78;
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    o1.connect(this.drone);
    o2.connect(this.drone);
    this.drone.connect(this.master);
    o1.start();
    o2.start();
  }

  private thump(when: number, amp: number): void {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(78, when);
    o.frequency.exponentialRampToValueAtTime(36, when + 0.14);
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
    o.connect(g);
    g.connect(this.master);
    o.start(when);
    o.stop(when + 0.2);
  }

  private tone(when: number, freq: number, dur: number, amp: number, type: OscillatorType): void {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(when);
    o.stop(when + dur + 0.02);
  }

  private noiseBurst(when: number, dur: number, freq: number, amp: number): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(when);
    src.stop(when + dur + 0.02);
  }
}
