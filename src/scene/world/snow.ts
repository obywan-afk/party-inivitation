import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Texture,
  Vector3
} from "three";
import { clamp } from "../../util/math";

function createSnowSpriteTexture(): Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable.");

  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(c);
}

export function createSnowPoints(opts: { count: number; radius: number; height: number }) {
  const baseCount = opts.count;
  const radius = opts.radius;
  const height = opts.height;

  const positions = new Float32Array(baseCount * 3);
  const velocities = new Float32Array(baseCount);
  const drift = new Float32Array(baseCount);

  for (let i = 0; i < baseCount; i++) {
    const idx = i * 3;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    positions[idx + 0] = Math.cos(a) * r;
    positions[idx + 1] = Math.random() * height;
    positions[idx + 2] = Math.sin(a) * r;

    velocities[i] = 0.35 + Math.random() * 0.55;
    drift[i] = (Math.random() - 0.5) * 0.45;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));

  const sprite = createSnowSpriteTexture();
  sprite.colorSpace = SRGBColorSpace;

  const mat = new PointsMaterial({
    size: 0.055,
    map: sprite,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    blending: AdditiveBlending,
    color: 0xbfd6ff
  });

  const points = new Points(geo, mat);
  points.position.set(0, 0.2, 0);

  let quality = 1;
  function setQuality(level: number) {
    quality = clamp(level, 0.25, 1);
    mat.size = 0.04 + 0.03 * quality;
    mat.opacity = 0.42 + 0.28 * quality;
    mat.needsUpdate = true;
  }

  const tmp = new Vector3();
  function update(dt: number, t: number) {
    const a = geo.getAttribute("position") as Float32BufferAttribute;
    const array = a.array as Float32Array;

    const windX = Math.sin(t * 0.12) * 0.22;
    const windZ = Math.cos(t * 0.1) * 0.18;
    const fallScale = 1.0;

    const activeCount = Math.floor(baseCount * (0.55 + 0.45 * quality));

    for (let i = 0; i < activeCount; i++) {
      const idx = i * 3;

      array[idx + 0] += (windX + drift[i]) * dt;
      array[idx + 1] -= velocities[i] * dt * fallScale;
      array[idx + 2] += windZ * dt;

      if (array[idx + 1] < 0) {
        const rr = Math.sqrt(Math.random()) * radius;
        const aa = Math.random() * Math.PI * 2;
        array[idx + 0] = Math.cos(aa) * rr;
        array[idx + 1] = height;
        array[idx + 2] = Math.sin(aa) * rr;
      }

      // Soft bounds.
      tmp.set(array[idx + 0], 0, array[idx + 2]);
      if (tmp.length() > radius) {
        tmp.normalize().multiplyScalar(radius * 0.98);
        array[idx + 0] = tmp.x;
        array[idx + 2] = tmp.z;
      }
    }

    a.needsUpdate = true;
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
    sprite.dispose();
  }

  setQuality(1);
  return { points, update, setQuality, dispose };
}
