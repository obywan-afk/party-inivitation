import { WinterMysticExperience } from "../scene/WinterMysticExperience";
import { createOverlayUI } from "../ui/overlay";
import { AmbientAudio } from "../audio/AmbientAudio";

export type AppHandle = {
  start(): void;
  dispose(): void;
};

export function createApp(opts: { canvas: HTMLCanvasElement; uiRoot: HTMLDivElement }): AppHandle {
  const audio = new AmbientAudio();
  const experience = new WinterMysticExperience({ canvas: opts.canvas, music: audio });

  const ui = createOverlayUI({
    root: opts.uiRoot,
    onEnter: async () => {
      await audio.start();
      audio.setPhase("intro");
      experience.begin();
    },
    onMuteToggle: () => audio.toggleMuted(),
    getMuted: () => audio.muted
  });

  let disposed = false;

  async function start() {
    try {
      ui.setStatus("loading");
      ui.setProgress(0.02);

      await experience.preload((p) => ui.setProgress(p));

      ui.setProgress(1);
      ui.setStatus("ready");

      experience.onPerfHint((hint) => ui.setPerfHint(hint));
      experience.onCountdown((n) => ui.setCountdown(n));
    } catch (err) {
      ui.setStatus("error", err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    ui.dispose();
    experience.dispose();
    audio.dispose();
  }

  return { start, dispose };
}
