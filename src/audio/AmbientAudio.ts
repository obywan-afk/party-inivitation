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
  private baseGain = 0.4;

  async start() {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }

    const ctx = new AudioContext();
    this.ctx = ctx;

    const gain = ctx.createGain();
    this.gain = gain;
    this.baseGain = 0.4;
    gain.gain.value = this.muted ? 0 : this.baseGain;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.01;
    comp.release.value = 0.22;
    this.compressor = comp;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 4200;
    filter.Q.value = 0.7;
    this.filter = filter;

    const { buffer, kind } = await this.loadWithFallback(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.source = src;

    // Make external/music files more transparent, keep generated slightly filtered.
    if (kind === "file") {
      this.baseGain = 0.26;
      gain.gain.value = this.muted ? 0 : this.baseGain;
      filter.frequency.value = 16000;
      filter.Q.value = 0.6;
    }

    src.connect(filter);
    filter.connect(comp);
    comp.connect(gain);
    gain.connect(ctx.destination);

    await ctx.resume();
    src.start();
  }

  toggleMuted() {
    this.muted = !this.muted;
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.baseGain;
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
    // Tempo: keep steps sample-aligned for a tight loop.
    const bpm = 132;
    const stepsPerBar16 = 16;
    const bars = Math.max(1, Math.round((seconds * bpm) / 240)); // ~4 bars for default seconds
    const step16Samples = Math.max(1, Math.round((sr * 60) / (bpm * 4)));
    const total16 = stepsPerBar16 * bars;
    const length = total16 * step16Samples;

    const buffer = ctx.createBuffer(2, length, sr);

    // Generated dark rolling techno (kick + hats + rolling bass).
    const TAU = Math.PI * 2;
    const seam = Math.max(1, Math.min(length, Math.floor(sr * 0.05)));

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);

      const spb = (step16Samples * 4) / sr; // actual seconds per beat (derived from integer step)
      const step16 = step16Samples / sr;
      const step8 = step16 * 2;
      const bar = spb * 4;

      // Dark minor-ish bass movement around A (55Hz).
      const bassPatternHz = [
        55.0, 55.0, 55.0, 65.41, 55.0, 55.0, 73.42, 55.0,
        55.0, 82.41, 55.0, 73.42, 55.0, 65.41, 55.0, 55.0
      ];

      // One-pole filters.
      const aNoiseLP = 1 - Math.exp((-TAU * 1800) / sr);
      const aNoiseHP = 1 - Math.exp((-TAU * 7000) / sr);
      const aRumbleLP = 1 - Math.exp((-TAU * 180) / sr);

      // Noise state (for hats/percs).
      let noiseLP = 0;
      let noiseHP = 0;

      // Rumble filter state.
      let rumbleLP = 0;

      // Bass oscillator phases (slightly detuned reese).
      let bassPhaseA = ch === 0 ? 0.11 : 0.41;
      let bassPhaseB = ch === 0 ? 0.33 : 0.07;
      let bassFreq = bassPatternHz[0];
      let lastBassStep = -1;

      for (let i = 0; i < length; i++) {
        const t = i / sr;
        let out = 0;

        // --- Techno layer ---
        const tBeat = t % spb;
        const tBar = t % bar;

        // Sidechain-style ducking driven by the kick.
        const duck = 1 - 0.55 * Math.exp(-tBeat * 8.5);

        // Kick on every beat.
        let kick = 0;
        if (tBeat < 0.42) {
          const env = Math.exp(-tBeat * 10.8);
          const clickEnv = Math.exp(-tBeat * 70);
          const fStart = 170;
          const fEnd = 44;
          const k = 20;
          const phase = TAU * (((fStart - fEnd) * (1 - Math.exp(-k * tBeat))) / k + fEnd * tBeat);
          const body = Math.sin(phase) * env;
          const click = Math.sin(TAU * 2800 * t) * clickEnv * 0.25;
          kick = Math.tanh((body * 3.6 + click) * 1.2) * 0.44;
        }

        // Rumble tail (sub) derived from kick timing.
        let rumble = 0;
        if (tBeat < 0.9) {
          const env = Math.exp(-tBeat * 3.0);
          const sub = Math.sin(TAU * 46 * t) * env * 0.12;
          rumbleLP += (sub - rumbleLP) * aRumbleLP;
          rumble = rumbleLP;
        }

        // Snare/noise burst on beats 2 and 4.
        let sn = 0;
        const dtC2 = mod(tBar - spb, bar);
        const dtC4 = mod(tBar - spb * 3, bar);
        const dtC = Math.min(dtC2, dtC4);
        if (dtC < 0.16) {
          const env = Math.exp(-dtC * 26);
          const n = Math.random() * 2 - 1;
          noiseLP += (n - noiseLP) * (1 - Math.exp((-TAU * 2400) / sr));
          const bp = n - noiseLP;
          sn = Math.tanh(bp * 1.9) * env * 0.12;
        }

        // 16th hats (bright, rolling).
        let hat = 0;
        const dt16 = t % step16;
        if (dt16 < 0.03) {
          const env = Math.exp(-dt16 * 120);
          const n = Math.random() * 2 - 1;
          noiseLP += (n - noiseLP) * aNoiseLP;
          noiseHP += (noiseLP - noiseHP) * aNoiseHP;
          const hp = noiseLP - noiseHP;
          const step = Math.floor(t / step16) % 16;
          const accent = step % 4 === 2 ? 1.28 : 1.0;
          hat = Math.tanh(hp * 2.3) * env * 0.05 * accent;
        }

        // Open hat on off-beats.
        let openHat = 0;
        const dtOh = mod(tBeat - spb / 2, spb);
        if (dtOh < 0.08) {
          const env = Math.exp(-dtOh * 18);
          const n = Math.random() * 2 - 1;
          noiseLP += (n - noiseLP) * aNoiseLP;
          noiseHP += (noiseLP - noiseHP) * aNoiseHP;
          const hp = noiseLP - noiseHP;
          openHat = Math.tanh(hp * 1.9) * env * 0.03;
        }

        // Rolling bass on 8ths (dark reese with slight movement).
        const bassStep = Math.floor(t / step8);
        if (bassStep !== lastBassStep) {
          lastBassStep = bassStep;
          bassFreq = bassPatternHz[bassStep % bassPatternHz.length];
        }
        const dtBass = t % step8;
        const bassEnv = Math.exp(-dtBass * 8.8);
        const detA = 1.0 + 0.007;
        const detB = 1.0 - 0.009;
        bassPhaseA = (bassPhaseA + (bassFreq * detA) / sr) % 1;
        bassPhaseB = (bassPhaseB + (bassFreq * detB) / sr) % 1;
        const sawA = bassPhaseA * 2 - 1;
        const sawB = bassPhaseB * 2 - 1;
        const reese = (sawA + sawB) * 0.5;
        const bass = Math.tanh(reese * 2.2) * bassEnv * 0.13;

        // Stereo width: tiny phase offset on hats/shimmer.
        const pan = ch === 0 ? -1 : 1;
        const hats = (hat * (0.9 + 0.1 * pan) + openHat) * duck;
        const bassDucked = bass * duck;
        out += kick + rumble + sn + bassDucked + hats;

        // Clamp to avoid harshness before compression.
        data[i] = Math.max(-0.95, Math.min(0.95, out));
      }

      // Seamless loop: equal-power crossfade the first/last region.
      for (let i = 0; i < seam; i++) {
        const a = i / Math.max(1, seam - 1);
        const wIn = Math.sin(a * (Math.PI / 2));
        const wOut = Math.cos(a * (Math.PI / 2));
        const s0 = data[i];
        const s1 = data[length - seam + i];
        const m = s0 * wIn + s1 * wOut;
        data[i] = m;
        data[length - seam + i] = m;
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
    // Generate a short, sample-aligned loop.
    return { buffer: this.createAmbientBuffer(ctx, 8.0), kind: "generated" };
  }
}

function mod(x: number, m: number) {
  return ((x % m) + m) % m;
}
