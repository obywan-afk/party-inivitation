# Winter Mystic 3D Party Invite (Mobile‑First)

Moody, cinematic winter 3D world (Three.js) with an A4 invite “poster” integrated as a stone tablet. Mobile‑first touch controls, bounded navigation, recenter, cinematic intro (skippable), and ambient audio that starts only after a user gesture.

## Tech

- Vite + TypeScript
- Three.js (vanilla, no React)

## Install & Run

```bash
npm install
npm run dev
```

Open the printed local URL on your phone (same Wi‑Fi) or desktop.

## Build & Deploy

```bash
npm run build
npm run preview
```

Deploy the `dist/` folder to any static host (Netlify / Vercel static / Cloudflare Pages / S3, etc.).

## Controls (Mobile‑First)

- 1‑finger drag: orbit/rotate around the invite
- Pinch: zoom
- `Recenter`: returns you to the intended framing

Navigation is constrained (distance + angles) so the poster remains the focal point.

## Replace the A4 Poster

Option A (recommended for git-based deploys): set a URL via env var:

- Create `.env.local` (ignored by git) with:
  - `VITE_POSTER_URL=https://your-cdn.example.com/poster.png`

Option B (local file, can be ignored by git):

1. Add your image at `public/poster.png` (this repo ignores it by default)
2. Rebuild/redeploy

Notes:
- Keep A4 portrait aspect (`210/297 ≈ 0.707` width/height) to avoid stretching.
- Recommended: `1600×2263` (A4 @ ~200dpi) or `2048×2896`.

If `public/poster.png` is missing, the project generates a readable placeholder invite texture in-code (`src/scene/world/posterTexture.ts`).

## Replace Ambient Audio

Option A (recommended for git-based deploys): set a URL via env var:

- Create `.env.local` (ignored by git) with:
  - `VITE_AMBIENT_URL=https://your-cdn.example.com/ambient.mp3`

Option B (local file, can be ignored by git):

1. Add an MP3 at `public/ambient.mp3` (this repo ignores it by default)
2. Rebuild/redeploy

If `public/ambient.mp3` is missing, a lightweight generated ambient loop is used (`src/audio/AmbientAudio.ts`). Audio starts only after “Tap to Begin” to respect autoplay policies.

## Important Privacy Note

If the poster/audio must be visible/audible to visitors, it can’t be truly “secret” in a purely static client app—visitors will ultimately download it. The workflow above keeps assets out of GitHub, but the hosted URL still needs to be accessible to clients.

## Performance Notes / Tuning

- Auto quality scaling adjusts device pixel ratio based on measured FPS (`src/util/PerfScaler.ts`).
- Post‑FX is minimal and auto-disabled on mobile by default (`src/scene/WinterMysticExperience.ts`). Toggle via URL: `?postfx=0` (off) / `?postfx=1` (on).
- Shadows are tuned for mobile (shadow map size adapts with quality).
- Snow uses a conservative GPU-friendly `Points` system with quality LOD (`src/scene/world/snow.ts`).

## Project Structure

- `src/scene/WinterMysticExperience.ts` — renderer, camera, controls, intro, render loop
- `src/scene/world/*` — scene construction (winter world, poster texture, runes, snow, vignette)
- `src/ui/overlay.ts` — loading/enter UI, recenter, mute, skip intro
- `src/audio/AmbientAudio.ts` — autoplay-safe ambient audio (file or generated)
