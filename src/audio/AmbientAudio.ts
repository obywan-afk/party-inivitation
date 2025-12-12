export class AmbientAudio {
  muted = false;

  private readonly fileUrl = "/ambient.mp3";
  private readonly envUrl =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_AMBIENT_URL ?? null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sceneGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private drive: GainNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private delay: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayWet: GainNode | null = null;

  private acidOsc: OscillatorNode | null = null;
  private acidFilter: BiquadFilterNode | null = null;
  private acidGain: GainNode | null = null;

  private baseGain = 0.4;
  private isGenerated = false;

  private phase: MusicPhase = "intro";
  private thrusting = false;
  private energy = 0;
  private energyTarget = 0.25;
  private nextStepTime = 0;
  private stepIndex = 0;
  private lastDriveCurveAmount = 0;

  async start() {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }

    const ctx = new AudioContext();
    this.ctx = ctx;

    const masterGain = ctx.createGain();
    this.masterGain = masterGain;
    this.baseGain = 0.4;
    masterGain.gain.value = this.muted ? 0 : this.baseGain;

    const sceneGain = ctx.createGain();
    this.sceneGain = sceneGain;
    sceneGain.gain.value = 1;

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
    this.isGenerated = kind === "generated";
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.source = src;

    // Make external/music files more transparent, keep generated slightly filtered.
    if (kind === "file") {
      this.baseGain = 0.26;
      masterGain.gain.value = this.muted ? 0 : this.baseGain;
      filter.frequency.value = 16000;
      filter.Q.value = 0.6;
    }

    // Add some “warehouse” grit (only for the generated techno).
    const drive = ctx.createGain();
    this.drive = drive;
    drive.gain.value = 1.0;

    const shaper = ctx.createWaveShaper();
    this.shaper = shaper;
    shaper.curve = makeDriveCurve(1.35);
    shaper.oversample = "4x";

    if (this.isGenerated) {
      src.connect(drive);
      drive.connect(shaper);
      shaper.connect(filter);
    } else {
      src.connect(filter);
    }

    filter.connect(comp);
    comp.connect(sceneGain);
    sceneGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Subtle feedback delay for space (more noticeable on outro).
    const delay = ctx.createDelay(0.6);
    this.delay = delay;
    const delayFeedback = ctx.createGain();
    this.delayFeedback = delayFeedback;
    const delayWet = ctx.createGain();
    this.delayWet = delayWet;
    delayWet.gain.value = 0;
    delayFeedback.gain.value = 0.22;
    delay.delayTime.value = 0.17;
    sceneGain.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(masterGain);

    // Occasional acid stabs (only for generated).
    if (this.isGenerated) {
      const acidOsc = ctx.createOscillator();
      this.acidOsc = acidOsc;
      acidOsc.type = "sawtooth";
      acidOsc.frequency.value = 110;

      const acidFilter = ctx.createBiquadFilter();
      this.acidFilter = acidFilter;
      acidFilter.type = "lowpass";
      acidFilter.frequency.value = 700;
      acidFilter.Q.value = 10;

      const acidGain = ctx.createGain();
      this.acidGain = acidGain;
      acidGain.gain.value = 0.0001;

      acidOsc.connect(acidFilter);
      acidFilter.connect(acidGain);
      // Mix into the same drive/distortion path so it glues to the track.
      acidGain.connect(drive);
    }

    await ctx.resume();
    src.start();
    this.acidOsc?.start();

    this.nextStepTime = ctx.currentTime + 0.05;
    this.stepIndex = 0;
    this.energy = 0;
    this.setPhase(this.phase);
  }

  toggleMuted() {
    this.muted = !this.muted;
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.baseGain;
  }

  setPhase(phase: MusicPhase) {
    this.phase = phase;
    const ctx = this.ctx;
    if (!ctx) return;

    // Reset phrase when we “drop” into play.
    if (phase === "play") {
      this.nextStepTime = ctx.currentTime + 0.05;
      this.stepIndex = 0;
    }

    // Targets tuned for a hard/fast warehouse feel.
    switch (phase) {
      case "intro":
        this.energyTarget = 0.25;
        break;
      case "countdown":
        this.energyTarget = 0.5;
        break;
      case "play":
        this.energyTarget = 0.92;
        break;
      case "outro":
        this.energyTarget = 0.55;
        break;
      case "gameover":
        this.energyTarget = 0.35;
        break;
    }
  }

  setThrusting(thrusting: boolean) {
    this.thrusting = thrusting;
  }

  frame(dt: number, _t: number) {
    const ctx = this.ctx;
    if (!ctx) return;

    // Smooth energy to avoid zipper noise when we change phase/thrust.
    const follow = 1 - Math.exp(-dt * 6.5);
    this.energy += (this.energyTarget - this.energy) * follow;

    const thrustBoost = this.thrusting ? 0.16 : 0;
    const e = clamp01(this.energy + thrustBoost);
    const now = ctx.currentTime;

    // Filter: darker on intro, wide open at peak-time.
    const cutoff = lerp(1100, 15500, Math.pow(e, 1.25));
    this.filter?.frequency.setTargetAtTime(cutoff, now, 0.06);
    this.filter?.Q.setTargetAtTime(0.7 + e * 0.6, now, 0.08);

    // Distortion drive.
    if (this.drive && this.shaper && this.isGenerated) {
      this.drive.gain.setTargetAtTime(lerp(0.95, 2.05, e), now, 0.06);
      const amount = lerp(1.15, 2.2, e);
      if (Math.abs(amount - this.lastDriveCurveAmount) > 0.06) {
        this.lastDriveCurveAmount = amount;
        this.shaper.curve = makeDriveCurve(amount);
      }
    }

    // Scene mix (doesn't affect mute).
    const sceneLevel =
      this.phase === "play" ? 1 : this.phase === "countdown" ? 0.72 : this.phase === "outro" ? 0.62 : 0.55;
    this.sceneGain?.gain.setTargetAtTime(sceneLevel, now, 0.08);

    // Delay: more “space” after gameover/outro.
    const delayWetTarget =
      (this.phase === "outro" || this.phase === "gameover" ? 0.06 : 0.02) * (0.35 + e * 0.65);
    this.delayWet?.gain.setTargetAtTime(delayWetTarget, now, 0.12);
    if (this.delay) {
      // Slightly tempo-ish; keep subtle to avoid “echo techno”.
      const base = 0.17;
      this.delay.delayTime.setTargetAtTime(base + (this.thrusting ? 0.01 : 0), now, 0.12);
    }

    this.scheduleAcid(now, e);
  }

  dispose() {
    try {
      this.source?.stop();
    } catch {
      // ignore
    }
    try {
      this.acidOsc?.stop();
    } catch {
      // ignore
    }
    this.source?.disconnect();
    this.filter?.disconnect();
    this.compressor?.disconnect();
    this.sceneGain?.disconnect();
    this.delayWet?.disconnect();
    this.delayFeedback?.disconnect();
    this.delay?.disconnect();
    this.shaper?.disconnect();
    this.drive?.disconnect();
    this.acidFilter?.disconnect();
    this.acidGain?.disconnect();
    this.masterGain?.disconnect();
    void this.ctx?.close();
    this.source = null;
    this.filter = null;
    this.compressor = null;
    this.sceneGain = null;
    this.delayWet = null;
    this.delayFeedback = null;
    this.delay = null;
    this.shaper = null;
    this.drive = null;
    this.acidOsc = null;
    this.acidFilter = null;
    this.acidGain = null;
    this.masterGain = null;
    this.ctx = null;
  }

  private createAmbientBuffer(ctx: AudioContext, bars: number) {
    const sr = ctx.sampleRate;
    // Tempo: keep steps sample-aligned for a tight loop.
    const bpm = 155;
    const stepsPerBar16 = 16;
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
        if (tBeat < spb * 0.62) {
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
        const envR = Math.exp(-tBeat * 3.0);
        const sub = Math.sin(TAU * 46 * t) * envR * 0.12;
        rumbleLP += (sub - rumbleLP) * aRumbleLP;
        const rumble = rumbleLP;

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
    // Generated hard-techno loop (bar-aligned).
    return { buffer: this.createAmbientBuffer(ctx, 8), kind: "generated" };
  }

  private scheduleAcid(now: number, energy: number) {
    if (!this.ctx || !this.acidOsc || !this.acidFilter || !this.acidGain) return;
    if (!this.isGenerated) return;
    if (this.phase !== "play") return;

    const bpm = 155;
    const step = 60 / bpm / 4; // 16ths
    const lookahead = 0.16;

    while (this.nextStepTime < now + lookahead) {
      const idx = this.stepIndex % acidPatternSemitones.length;
      const semi = acidPatternSemitones[idx];
      if (semi != null) {
        const t0 = this.nextStepTime;
        const freq = 55 * Math.pow(2, semi / 12);

        const amp = lerp(0.02, 0.07, energy) * (this.thrusting ? 1.25 : 1);
        const cutoff = lerp(550, 2400, energy) + (this.thrusting ? 550 : 0);

        this.acidOsc.frequency.setTargetAtTime(freq, t0, 0.004);
        this.acidFilter.frequency.cancelScheduledValues(t0);
        this.acidFilter.frequency.setValueAtTime(cutoff, t0);
        this.acidFilter.frequency.setTargetAtTime(cutoff * 2.0, t0 + 0.01, 0.03);
        this.acidFilter.Q.setTargetAtTime(lerp(7.5, 14.0, energy), t0, 0.05);

        this.acidGain.gain.cancelScheduledValues(t0);
        this.acidGain.gain.setValueAtTime(0.0001, t0);
        this.acidGain.gain.linearRampToValueAtTime(amp, t0 + 0.01);
        this.acidGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      }

      this.stepIndex++;
      this.nextStepTime += step;
    }
  }
}

function mod(x: number, m: number) {
  return ((x % m) + m) % m;
}

type MusicPhase = "intro" | "countdown" | "play" | "outro" | "gameover";

const acidPatternSemitones: Array<number | null> = [
  // 4 bars @ 16ths. Sparse “peak-time” stabs to avoid becoming melodic.
  0, null, null, null, 12, null, 3, null, null, null, 5, null, 0, null, -2, null,
  null, null, 0, null, 12, null, null, null, 3, null, null, null, 5, null, null, null,
  0, null, null, null, 12, null, 3, null, null, null, 5, null, 0, null, -2, null,
  null, null, null, null, 12, null, null, null, 3, null, null, null, 5, null, null, null
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function makeDriveCurve(amount: number) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = Math.max(0.0001, amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k);
  }
  return curve;
}
