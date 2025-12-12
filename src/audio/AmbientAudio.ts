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
      gain.gain.value = this.muted ? 0 : 0.26;
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

    // Generated "rolling techno" (kick + hats + bass) with wind/shimmer bed.
    const TAU = Math.PI * 2;
    const seam = Math.max(1, Math.floor(sr * 0.05));
    const bpm = 120;
    const spb = 60 / bpm; // seconds per beat
    const step16 = spb / 4;
    const step8 = spb / 2;
    const bar = spb * 4;

    const bassPatternHz = [
      55.0, 55.0, 65.41, 55.0, 73.42, 55.0, 82.41, 73.42,
      55.0, 65.41, 55.0, 73.42, 55.0, 82.41, 73.42, 65.41,
      55.0, 55.0, 65.41, 55.0, 73.42, 55.0, 82.41, 73.42,
      55.0, 65.41, 55.0, 98.0, 82.41, 73.42, 65.41, 55.0
    ];

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

      // Precompute longer "wind whistle" accents (subtle, musical timing).
      const whistleEvents: Array<{
        start: number;
        dur: number;
        f0: number;
        f1: number;
        phase: number;
        rate: number;
        amp: number;
      }> = [];
      // Intentionally avoid the loop seam window.
      const starts = [0.75, 2.85, 5.25];
      for (let w = 0; w < starts.length; w++) {
        const start = Math.min(seconds - 1.9, starts[w] + (Math.random() - 0.5) * 0.18);
        const dur = 0.95 + Math.random() * 0.75;
        const f0 = 760 + Math.random() * 260;
        const f1 = 1120 + Math.random() * 520;
        const phase = Math.random() * TAU;
        const rate = 4.2 + Math.random() * 2.2;
        const amp = 0.016 + Math.random() * 0.018;
        whistleEvents.push({ start, dur, f0, f1, phase, rate, amp });
      }

      let brown = 0;
      let lp = 0;
      let hpLp = 0;

      // Hat highpass.
      let hatHpLp = 0;
      const hatHpCut = 5200;
      const aHatHP = 1 - Math.exp((-TAU * hatHpCut) / sr);

      // Bass oscillator.
      let bassPhase = ch === 0 ? 0.13 : 0.37;
      let bassFreq = bassPatternHz[0];
      let lastBassStep = -1;

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
        let out = wind * (0.24 * lfo);

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
        out += shimmer * 0.8;

        // Wind whistles (gliss + slight vibrato).
        let whistle = 0;
        for (let w = 0; w < whistleEvents.length; w++) {
          const ev = whistleEvents[w];
          const dt = t - ev.start;
          if (dt < 0 || dt > ev.dur) continue;
          const u = dt / ev.dur;
          const win = Math.sin(Math.PI * u);
          const env = win * win;
          const k = (ev.f1 - ev.f0) / ev.dur;
          const phaseMod = 0.38 * Math.sin(TAU * ev.rate * t + ev.phase);
          const ph = TAU * (ev.f0 * dt + 0.5 * k * dt * dt) + ev.phase + phaseMod;
          // Gentle harmonic for "whistle" character.
          const s = Math.sin(ph) + 0.22 * Math.sin(ph * 2.0);
          // Breathiness rides on wind level.
          const breath = (0.7 + 0.6 * lfo) * (0.8 + 0.2 * Math.sin(TAU * 0.2 * t + ch));
          whistle += s * env * ev.amp * breath;
        }
        out += whistle;

        // --- Techno layer ---
        const tBeat = t % spb; // time since last beat
        const tBar = t % bar;

        // Kick on every beat.
        let kick = 0;
        if (tBeat < 0.28) {
          const env = Math.exp(-tBeat * 13.5);
          const fStart = 150;
          const fEnd = 46;
          const k = 18;
          const phase = TAU * (((fStart - fEnd) * (1 - Math.exp(-k * tBeat))) / k + fEnd * tBeat);
          kick = Math.tanh(Math.sin(phase) * env * 3.0) * 0.42;
        }

        // Clap/noise burst on beats 2 and 4 (t=spb, 3*spb in each bar).
        let clap = 0;
        const dtC2 = mod(tBar - spb, bar);
        const dtC4 = mod(tBar - spb * 3, bar);
        const dtC = Math.min(dtC2, dtC4);
        if (dtC < 0.12) {
          const env = Math.exp(-dtC * 32);
          // Simple "bandpass-ish" by subtracting a lowpassed noise.
          const n = Math.random() * 2 - 1;
          hatHpLp += (n - hatHpLp) * (1 - Math.exp((-TAU * 1800) / sr));
          const bp = n - hatHpLp;
          clap = Math.tanh(bp * 1.6) * env * 0.1;
        }

        // 16th hats (bright, rolling).
        let hat = 0;
        const dt16 = t % step16;
        if (dt16 < 0.03) {
          const env = Math.exp(-dt16 * 110);
          const n = Math.random() * 2 - 1;
          // Highpass to get "tss".
          hatHpLp += (n - hatHpLp) * aHatHP;
          const hp = n - hatHpLp;
          // Accents on off-16ths.
          const step = Math.floor(t / step16) % 16;
          const accent = step % 4 === 2 ? 1.22 : 1.0;
          hat = Math.tanh(hp * 2.0) * env * 0.052 * accent;
        }

        // Rolling bass on 8ths.
        const bassStep = Math.floor(t / step8);
        if (bassStep !== lastBassStep) {
          lastBassStep = bassStep;
          bassFreq = bassPatternHz[bassStep % bassPatternHz.length];
        }
        const dtBass = t % step8;
        const bassEnv = Math.exp(-dtBass * 10.5);
        bassPhase = (bassPhase + bassFreq / sr) % 1;
        const saw = bassPhase * 2 - 1;
        const bass = Math.tanh(saw * 1.6) * bassEnv * 0.11;

        // Stereo width: tiny phase offset on hats/shimmer.
        const pan = ch === 0 ? -1 : 1;
        out += kick + clap + bass + hat * (0.9 + 0.1 * pan);

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
    // 8s @ 120bpm = clean 4-bar loop.
    return { buffer: this.createAmbientBuffer(ctx, 8.0), kind: "generated" };
  }
}

function mod(x: number, m: number) {
  return ((x % m) + m) % m;
}
