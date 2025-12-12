export class AmbientAudio {
  muted = false;

  private readonly fileUrl = "/ambient.mp3";
  private readonly envUrl =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_AMBIENT_URL ?? null;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;

  async start() {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }

    const ctx = new AudioContext();
    this.ctx = ctx;

    const gain = ctx.createGain();
    this.gain = gain;
    gain.gain.value = this.muted ? 0 : 0.4;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.01;
    comp.release.value = 0.22;
    this.compressor = comp;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    filter.Q.value = 0.7;
    this.filter = filter;

    const { buffer, kind } = await this.loadWithFallback(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.source = src;

    // Slightly lower gain for external/music files.
    if (kind === "file") gain.gain.value = this.muted ? 0 : 0.26;

    src.connect(filter);
    filter.connect(comp);
    comp.connect(gain);
    gain.connect(ctx.destination);

    await ctx.resume();
    src.start();
  }

  toggleMuted() {
    this.muted = !this.muted;
    if (this.gain) this.gain.gain.value = this.muted ? 0 : 0.4;
  }

  dispose() {
    try {
      this.source?.stop();
    } catch {
      // ignore
    }
    this.source?.disconnect();
    this.filter?.disconnect();
    this.compressor?.disconnect();
    this.gain?.disconnect();
    void this.ctx?.close();
    this.source = null;
    this.filter = null;
    this.compressor = null;
    this.gain = null;
    this.ctx = null;
  }

  private createAmbientBuffer(ctx: AudioContext, seconds: number) {
    const sr = ctx.sampleRate;
    const length = Math.floor(sr * seconds);
    const buffer = ctx.createBuffer(2, length, sr);

    // Generate a "wind + shimmer" ambience (no constant low hum).
    const TAU = Math.PI * 2;
    const fade = Math.max(1, Math.floor(sr * 0.06));

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);

      // One-pole filters (simple, fast, stable).
      const lpCut = 1200;
      const hpCut = 120;
      const aLP = 1 - Math.exp((-TAU * lpCut) / sr);
      const aHP = 1 - Math.exp((-TAU * hpCut) / sr);

      // Precompute shimmer events.
      const eventCount = 12;
      const events: Array<{
        start: number;
        dur: number;
        freq: number;
        phase: number;
        rate: number;
        amp: number;
      }> = [];
      for (let e = 0; e < eventCount; e++) {
        const start = Math.random() * (seconds - 0.8);
        const dur = 0.35 + Math.random() * 0.9;
        const freq = 320 + Math.random() * 720;
        const phase = Math.random() * TAU;
        const rate = 3.5 + Math.random() * 3.5;
        const amp = 0.03 + Math.random() * 0.05;
        events.push({ start, dur, freq, phase, rate, amp });
      }

      let brown = 0;
      let lp = 0;
      let hpLp = 0;

      for (let i = 0; i < length; i++) {
        const t = i / sr;

        // Brown-ish noise (wind base).
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.02 * white) * 0.985;

        // Highpass to remove rumble/DC (prevents "engine" hum).
        hpLp += (brown - hpLp) * aHP;
        let wind = brown - hpLp;

        // Soften with lowpass.
        lp += (wind - lp) * aLP;
        wind = lp;

        // Slow breathing motion.
        const lfo = 0.55 + 0.45 * Math.sin(TAU * (0.045 + ch * 0.006) * t + ch * 1.1);
        let out = wind * (0.32 * lfo);

        // Distant shimmer / icy sparkle.
        let shimmer = 0;
        for (let e = 0; e < events.length; e++) {
          const ev = events[e];
          const dt = t - ev.start;
          if (dt < 0 || dt > ev.dur) continue;
          const u = dt / ev.dur;
          const win = Math.sin(Math.PI * u); // smooth in/out
          const vib = 1 + 0.004 * Math.sin(TAU * ev.rate * t + ev.phase);
          const s = Math.sin(TAU * (ev.freq * vib) * t + ev.phase);
          shimmer += s * win * win * ev.amp;
        }
        out += shimmer;

        // Clamp to avoid harshness before compression.
        data[i] = Math.max(-0.95, Math.min(0.95, out));
      }

      // Equal-power fade to avoid loop clicks.
      for (let i = 0; i < fade; i++) {
        const g = Math.sin((i / fade) * (Math.PI / 2));
        data[i] *= g;
        data[length - 1 - i] *= g;
      }
    }

    return buffer;
  }

  private async tryLoadAudioFile(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      return await ctx.decodeAudioData(data);
    } catch {
      return null;
    }
  }

  private async loadWithFallback(ctx: AudioContext): Promise<{ buffer: AudioBuffer; kind: "file" | "generated" }> {
    const file =
      (this.envUrl ? await this.tryLoadAudioFile(ctx, this.envUrl) : null) ??
      (await this.tryLoadAudioFile(ctx, this.fileUrl));
    if (file) return { buffer: file, kind: "file" };
    return { buffer: this.createAmbientBuffer(ctx, 6.0), kind: "generated" };
  }
}
