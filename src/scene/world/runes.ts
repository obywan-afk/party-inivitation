import { CanvasTexture } from "three";

export function createRuneTexture() {
  const w = 1024;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable.");

  ctx.clearRect(0, 0, w, h);

  // Background scratches / noise.
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 6 + Math.random() * 22;
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Runes.
  ctx.translate(w / 2, h / 2);
  const runeCount = 11;
  const spacing = 74;
  for (let i = -Math.floor(runeCount / 2); i <= Math.floor(runeCount / 2); i++) {
    const x = i * spacing;
    drawRune(ctx, x, 0, 30 + (i % 3) * 4);
  }

  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function drawRune(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((Math.random() - 0.5) * 0.12);

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const p = (dx: number, dy: number) => [dx * s, dy * s] as const;
  const segs = [
    [p(-0.2, -0.7), p(-0.2, 0.7)],
    [p(-0.2, -0.2), p(0.4, -0.55)],
    [p(-0.2, 0.15), p(0.35, 0.55)],
    [p(0.15, -0.75), p(0.55, -0.35)],
    [p(0.1, 0.75), p(0.55, 0.35)]
  ];

  for (const [a, b] of segs) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  ctx.restore();
}

