export type OverlayStatus = "loading" | "ready" | "running" | "error";
export type PerfHint = "quality-low" | "quality-high" | null;

export type OverlayUI = {
  setStatus(status: OverlayStatus, errorMessage?: string): void;
  setProgress(p: number): void;
  setPerfHint(hint: PerfHint): void;
  dispose(): void;
};

export function createOverlayUI(opts: {
  root: HTMLElement;
  onEnter: () => void | Promise<void>;
  onRecenter: () => void;
  onMuteToggle: () => void;
  onSkipIntro: () => void;
  getMuted: () => boolean;
}): OverlayUI {
  const root = opts.root;

  const overlay = document.createElement("div");
  overlay.className = "overlay";

  const overlayInner = document.createElement("div");
  overlayInner.className = "overlay-inner";
  overlay.appendChild(overlayInner);

  const panel = document.createElement("div");
  panel.className = "panel";
  overlayInner.appendChild(panel);

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = "Winter Mystic Invite";
  panel.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "muted";
  desc.textContent = "Loading the world…";
  panel.appendChild(desc);

  const progressWrap = document.createElement("div");
  progressWrap.className = "progress";
  panel.appendChild(progressWrap);

  const progressBar = document.createElement("div");
  progressWrap.appendChild(progressBar);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.innerHTML =
    '<span>1‑finger rotate • pinch zoom</span><span><span class="kbd">Recenter</span> keeps you on the invite</span>';
  panel.appendChild(hint);

  const row = document.createElement("div");
  row.className = "row";
  panel.appendChild(row);

  const enterBtn = document.createElement("button");
  enterBtn.className = "button primary";
  enterBtn.type = "button";
  enterBtn.textContent = "Tap to Begin";
  row.appendChild(enterBtn);

  const muteBtn = document.createElement("button");
  muteBtn.className = "button";
  muteBtn.type = "button";
  muteBtn.textContent = "Mute";
  row.appendChild(muteBtn);

  const topbar = document.createElement("div");
  topbar.className = "topbar";

  const chipLeft = document.createElement("div");
  chipLeft.className = "chip";
  chipLeft.textContent = "Cinematic • winter mystic";
  topbar.appendChild(chipLeft);

  const chipRight = document.createElement("div");
  chipRight.className = "chip";
  chipRight.textContent = "Auto quality";
  topbar.appendChild(chipRight);

  root.appendChild(topbar);
  root.appendChild(overlay);

  const ui = document.createElement("div");
  ui.className = "ui";
  root.appendChild(ui);

  const recenterBtn = document.createElement("button");
  recenterBtn.className = "button";
  recenterBtn.type = "button";
  recenterBtn.textContent = "Recenter";
  ui.appendChild(recenterBtn);

  const skipBtn = document.createElement("button");
  skipBtn.className = "button";
  skipBtn.type = "button";
  skipBtn.textContent = "Skip intro";
  ui.appendChild(skipBtn);

  let status: OverlayStatus = "loading";
  let disposed = false;
  let introTimeout = 0;

  function refreshMuteLabel() {
    muteBtn.textContent = opts.getMuted() ? "Unmute" : "Mute";
  }

  function setProgress(p: number) {
    const clamped = Math.max(0, Math.min(1, p));
    progressBar.style.width = `${Math.round(clamped * 100)}%`;
  }

  function setPerfHint(h: PerfHint) {
    if (!h) {
      chipRight.textContent = "Auto quality";
      return;
    }
    chipRight.textContent = h === "quality-low" ? "Auto quality • lowered" : "Auto quality • high";
  }

  async function enter() {
    if (status !== "ready") return;
    setStatus("running");
    refreshMuteLabel();
    await opts.onEnter();

    // Show skip for the intro window, then hide.
    skipBtn.style.display = "inline-flex";
    window.clearTimeout(introTimeout);
    introTimeout = window.setTimeout(() => {
      skipBtn.style.display = "none";
    }, 8000);
  }

  function setStatus(next: OverlayStatus, errorMessage?: string) {
    status = next;
    if (status === "loading") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      topbar.style.display = "none";
      ui.style.display = "none";
      desc.textContent = "Loading the world…";
      enterBtn.disabled = true;
      enterBtn.textContent = "Loading…";
      muteBtn.style.display = "none";
      skipBtn.style.display = "none";
      return;
    }

    if (status === "ready") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      topbar.style.display = "none";
      ui.style.display = "none";
      desc.textContent = "Tap to begin (starts audio). You’ll land gently on the invite.";
      enterBtn.disabled = false;
      enterBtn.textContent = "Tap to Begin";
      muteBtn.style.display = "inline-flex";
      refreshMuteLabel();
      skipBtn.style.display = "none";
      return;
    }

    if (status === "running") {
      overlay.style.opacity = "0";
      topbar.style.display = "flex";
      ui.style.display = "flex";
      muteBtn.style.display = "inline-flex";
      refreshMuteLabel();
      window.setTimeout(() => {
        if (status === "running") overlay.style.display = "none";
      }, 540);
      return;
    }

    overlay.style.display = "grid";
    overlay.style.opacity = "1";
    topbar.style.display = "none";
    ui.style.display = "none";
    desc.textContent = errorMessage ? `Error: ${errorMessage}` : "Something went wrong.";
    enterBtn.disabled = true;
    enterBtn.textContent = "Unavailable";
    muteBtn.style.display = "none";
    skipBtn.style.display = "none";
  }

  enterBtn.addEventListener("click", () => {
    void enter();
  });
  muteBtn.addEventListener("click", () => {
    opts.onMuteToggle();
    refreshMuteLabel();
  });
  recenterBtn.addEventListener("click", () => {
    opts.onRecenter();
  });
  skipBtn.addEventListener("click", () => {
    opts.onSkipIntro();
    skipBtn.style.display = "none";
  });

  // Defaults
  setProgress(0);
  setStatus("loading");

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(introTimeout);
    overlay.remove();
    topbar.remove();
    ui.remove();
  }

  return { setStatus, setProgress, setPerfHint, dispose };
}
