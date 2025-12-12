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

  const playWrap = document.createElement("div");
  playWrap.className = "play-wrap";
  overlayInner.appendChild(playWrap);

  const enterBtn = document.createElement("button");
  enterBtn.className = "play";
  enterBtn.type = "button";
  enterBtn.setAttribute("aria-label", "Play");
  enterBtn.innerHTML = '<div class="play-icon"></div>';
  playWrap.appendChild(enterBtn);

  const loadingText = document.createElement("div");
  loadingText.className = "loading-text";
  loadingText.textContent = "Loading…";
  playWrap.appendChild(loadingText);

  const progressWrap = document.createElement("div");
  progressWrap.className = "progress";
  playWrap.appendChild(progressWrap);

  const progressBar = document.createElement("div");
  progressWrap.appendChild(progressBar);

  const topbar = document.createElement("div");
  topbar.className = "topbar";

  const left = document.createElement("div");
  left.className = "chip";
  left.textContent = "Auto quality";
  topbar.appendChild(left);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "10px";
  right.style.pointerEvents = "auto";
  topbar.appendChild(right);

  const muteBtn = document.createElement("button");
  muteBtn.className = "button";
  muteBtn.type = "button";
  muteBtn.textContent = "Mute";
  right.appendChild(muteBtn);

  const recenterBtn = document.createElement("button");
  recenterBtn.className = "button";
  recenterBtn.type = "button";
  recenterBtn.textContent = "Recenter";
  right.appendChild(recenterBtn);

  root.appendChild(topbar);
  root.appendChild(overlay);

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
      left.textContent = "Auto quality";
      return;
    }
    left.textContent = h === "quality-low" ? "Auto quality • lowered" : "Auto quality • high";
  }

  async function enter() {
    if (status !== "ready") return;
    setStatus("running");
    refreshMuteLabel();
    await opts.onEnter();
    // Keep controls minimal; no skip UI (still skippable via recenter).
    window.clearTimeout(introTimeout);
  }

  function setStatus(next: OverlayStatus, errorMessage?: string) {
    status = next;
    if (status === "loading") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      topbar.style.display = "none";
      loadingText.textContent = "Loading…";
      enterBtn.disabled = true;
      muteBtn.style.display = "none";
      recenterBtn.style.display = "none";
      return;
    }

    if (status === "ready") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      topbar.style.display = "none";
      loadingText.textContent = "";
      enterBtn.disabled = false;
      muteBtn.style.display = "none";
      recenterBtn.style.display = "none";
      return;
    }

    if (status === "running") {
      overlay.style.opacity = "0";
      topbar.style.display = "flex";
      muteBtn.style.display = "inline-flex";
      recenterBtn.style.display = "inline-flex";
      refreshMuteLabel();
      window.setTimeout(() => {
        if (status === "running") overlay.style.display = "none";
      }, 540);
      return;
    }

    overlay.style.display = "grid";
    overlay.style.opacity = "1";
    topbar.style.display = "none";
    loadingText.textContent = errorMessage ? `Error: ${errorMessage}` : "Something went wrong.";
    enterBtn.disabled = true;
    enterBtn.setAttribute("aria-label", "Unavailable");
    muteBtn.style.display = "none";
    recenterBtn.style.display = "none";
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

  // Defaults
  setProgress(0);
  setStatus("loading");

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(introTimeout);
    overlay.remove();
    topbar.remove();
  }

  return { setStatus, setProgress, setPerfHint, dispose };
}
