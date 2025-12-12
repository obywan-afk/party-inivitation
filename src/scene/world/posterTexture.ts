import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  WebGLRenderer
} from "three";
import { clamp } from "../../util/math";

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const BASE_URL = (ENV?.BASE_URL ?? "/").replace(/\/?$/, "/");
const POSTER_URL = `${BASE_URL}poster.png`;
const ENV_POSTER_URL = ENV?.VITE_POSTER_URL;

export async function createPosterTexture(
  renderer: WebGLRenderer,
  onProgress?: (p: number) => void
): Promise<Texture> {
  onProgress?.(0.08);

  if (ENV_POSTER_URL) {
    const fromEnv = await tryLoadPosterFromPublic(ENV_POSTER_URL);
    if (fromEnv) {
      fromEnv.colorSpace = SRGBColorSpace;
      fromEnv.minFilter = LinearMipmapLinearFilter;
      fromEnv.generateMipmaps = true;
      fromEnv.anisotropy = clamp(renderer.capabilities.getMaxAnisotropy(), 2, 12);
      onProgress?.(0.95);
      return fromEnv;
    }
  }

  const loaded = await tryLoadPosterFromPublic(POSTER_URL);
  if (loaded) {
    loaded.colorSpace = SRGBColorSpace;
    loaded.minFilter = LinearMipmapLinearFilter;
    loaded.generateMipmaps = true;
    loaded.anisotropy = clamp(renderer.capabilities.getMaxAnisotropy(), 2, 12);
    onProgress?.(0.95);
    return loaded;
  }

  const generated = generatePosterCanvasTexture();
  generated.colorSpace = SRGBColorSpace;
  generated.minFilter = LinearMipmapLinearFilter;
  generated.generateMipmaps = true;
  generated.anisotropy = clamp(renderer.capabilities.getMaxAnisotropy(), 2, 12);
  onProgress?.(0.95);
  return generated;
}

function tryLoadPosterFromPublic(url: string): Promise<Texture | null> {
  return new Promise((resolve) => {
    const loader = new TextureLoader();
    // Needed for WebGL textures loaded from another origin (e.g. Vercel Blob).
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tex: Texture) => resolve(tex),
      undefined,
      () => resolve(null)
    );
  });
}

function generatePosterCanvasTexture(): CanvasTexture {
  const a4 = 210 / 297;
  const height = 1600;
  const width = Math.round(height * a4);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable.");

  // Background.
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "#0c1320");
  g.addColorStop(0.6, "#0a101a");
  g.addColorStop(1, "#070b12");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // Subtle icy noise.
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() * 1.6;
    ctx.fillStyle = `rgba(166,215,255,${0.12 + Math.random() * 0.25})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const margin = Math.round(width * 0.08);
  const innerW = width - margin * 2;

  // Border.
  ctx.strokeStyle = "rgba(166,215,255,0.35)";
  ctx.lineWidth = 6;
  ctx.strokeRect(margin, margin, innerW, height - margin * 2);

  ctx.strokeStyle = "rgba(255,226,168,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(margin + 14, margin + 14, innerW - 28, height - margin * 2 - 28);

  // Typography.
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.94)";

  const titleY = margin + 160;
  ctx.font = "700 86px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillText("WINTER MYSTIC", width / 2, titleY);

  ctx.font = "600 44px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillStyle = "rgba(166,215,255,0.95)";
  ctx.fillText("An Evening Invitation", width / 2, titleY + 70);

  // Divider line.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - innerW * 0.28, titleY + 115);
  ctx.lineTo(width / 2 + innerW * 0.28, titleY + 115);
  ctx.stroke();

  // Details block.
  const bodyTop = titleY + 190;
  const left = margin + 80;
  const right = width - margin - 80;

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "700 38px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillText("DATE", left, bodyTop);
  ctx.fillText("TIME", left, bodyTop + 130);
  ctx.fillText("LOCATION", left, bodyTop + 260);
  ctx.fillText("DRESS", left, bodyTop + 430);
  ctx.fillText("RSVP", left, bodyTop + 560);

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "500 38px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.textAlign = "right";
  ctx.fillText("Saturday • Feb 22", right, bodyTop);
  ctx.fillText("20:00 — late", right, bodyTop + 130);
  ctx.fillText("The Frost Shrine Clearing", right, bodyTop + 260);
  ctx.fillText("Midnight tones • warm layers", right, bodyTop + 430);
  ctx.fillText("Text: (555) 123‑4567", right, bodyTop + 560);

  // Footer.
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,226,168,0.82)";
  ctx.font = "600 32px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillText("Bring curiosity. Leave with a story.", width / 2, height - margin - 90);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "500 24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillText("Add public/poster.png or set VITE_POSTER_URL", width / 2, height - margin - 48);

  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
