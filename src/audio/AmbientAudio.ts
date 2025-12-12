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

    // A low, cinematic bed: two detuned sines + soft noise, with slow amplitude motion.
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);

      let noise = 0;
      for (let i = 0; i < length; i++) {
        const t = i / sr;

        const f1 = 55.0 * (1 + 0.002 * Math.sin(t * 0.4));
        const f2 = 110.0 * (1 + 0.002 * Math.cos(t * 0.33));
        const detune = ch === 0 ? -0.12 : 0.09;

        const s1 = Math.sin((t * (f1 + detune)) * Math.PI * 2);
        const s2 = Math.sin((t * (f2 - detune)) * Math.PI * 2);

        // Brown-ish noise (leaky integrator).
        const white = Math.random() * 2 - 1;
        noise = (noise + 0.02 * white) * 0.985;

        const lfo = 0.65 + 0.35 * Math.sin(t * 0.18 + ch * 0.9);
        const bed = (s1 * 0.22 + s2 * 0.12) * lfo;
        const air = noise * 0.12;

        data[i] = (bed + air) * 0.9;
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
