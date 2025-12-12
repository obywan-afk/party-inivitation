import { clamp, lerp } from "./math";

export class PerfScaler {
  private readonly minPixelRatio: number;
  private readonly maxPixelRatio: number;
  private readonly onChange: (pixelRatio: number, qualityLevel: number) => void;

  private lastFrame = 0;
  private lastEval = 0;
  private emaFps = 60;
  private pixelRatio: number;
  private qualityLevel = 1;

  constructor(opts: {
    minPixelRatio: number;
    maxPixelRatio: number;
    onChange: (pixelRatio: number, qualityLevel: number) => void;
  }) {
    this.minPixelRatio = opts.minPixelRatio;
    this.maxPixelRatio = Math.max(opts.minPixelRatio, opts.maxPixelRatio);
    this.onChange = opts.onChange;

    this.pixelRatio = this.maxPixelRatio;
    this.qualityLevel = 1;
    this.onChange(this.pixelRatio, this.qualityLevel);
  }

  frame(nowSeconds: number) {
    const now = nowSeconds;
    if (this.lastFrame === 0) {
      this.lastFrame = now;
      this.lastEval = now;
      return;
    }

    // Called once per RAF; approximate FPS from delta.
    const dt = Math.max(0.001, now - this.lastFrame);
    this.lastFrame = now;
    const fps = 1 / dt;
    this.emaFps = lerp(this.emaFps, fps, 0.08);

    // Re-check at ~2s intervals.
    if (now - this.lastEval < 2.0) return;
    this.lastEval = now;

    // Quality heuristic with hysteresis.
    const low = this.emaFps < 48;
    const high = this.emaFps > 57;

    let next = this.pixelRatio;
    if (low) next = Math.max(this.minPixelRatio, this.pixelRatio - 0.15);
    if (high) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);

    // Map pixelRatio to [0..1] quality level.
    const q = clamp((next - this.minPixelRatio) / (this.maxPixelRatio - this.minPixelRatio || 1), 0, 1);
    const nextQuality = 0.25 + 0.75 * q;

    if (Math.abs(next - this.pixelRatio) > 0.001) {
      this.pixelRatio = next;
      this.qualityLevel = nextQuality;
      this.onChange(this.pixelRatio, this.qualityLevel);
    }
  }
}
