export type OverlayStatus = "loading" | "ready" | "running" | "error";
export type PerfHint = "quality-low" | "quality-high" | null;

export type OverlayUI = {
  setStatus(status: OverlayStatus, errorMessage?: string): void;
  setProgress(p: number): void;
  setPerfHint(hint: PerfHint): void;
  setCountdown(n: number | null): void;
  dispose(): void;
};

export function createOverlayUI(opts: {
  root: HTMLElement;
  onEnter: () => void | Promise<void>;
  onMuteToggle: () => void;
  getMuted: () => boolean;
}): OverlayUI {
  const root = opts.root;

  // ---- Overlay (loading / tap-to-begin) ----
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  const overlayInner = document.createElement("div");
  overlayInner.className = "overlay-inner";
  overlay.appendChild(overlayInner);

  const enterBtn = document.createElement("button");
  enterBtn.className = "play";
  enterBtn.type = "button";
  enterBtn.setAttribute("aria-label", "Tap to begin");
  enterBtn.innerHTML = `
    <svg class="play-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle class="play-ring-track" cx="60" cy="60" r="52"></circle>
      <circle class="play-ring-bar" cx="60" cy="60" r="52"></circle>
    </svg>
    <div class="play-core" aria-hidden="true">
      <div class="play-icon"></div>
    </div>
  `;
  overlayInner.appendChild(enterBtn);

  // ---- Topbar (in-experience HUD controls) ----
  const topbar = document.createElement("div");
  topbar.className = "topbar";

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "10px";
  right.style.pointerEvents = "auto";
  topbar.appendChild(right);

  const countdown = document.createElement("div");
  countdown.className = "countdown";
  countdown.style.display = "none";

  root.appendChild(topbar);
  root.appendChild(countdown);
  root.appendChild(overlay);

  let status: OverlayStatus = "loading";
  let disposed = false;

  const ringBar = enterBtn.querySelector<SVGCircleElement>(".play-ring-bar");
  const ringRadius = 52;
  const ringCircumference = 2 * Math.PI * ringRadius;
  if (ringBar) {
    ringBar.style.strokeDasharray = `${ringCircumference}`;
    ringBar.style.strokeDashoffset = `${ringCircumference}`;
  }

  function setProgress(p: number) {
    const clamped = Math.max(0, Math.min(1, p));
    if (ringBar) {
      ringBar.style.strokeDashoffset = `${ringCircumference * (1 - clamped)}`;
    }
  }

  function setPerfHint(h: PerfHint) {
    void h;
  }

  function setCountdown(n: number | null) {
    if (n == null) {
      countdown.style.display = "none";
      countdown.textContent = "";
      return;
    }
    countdown.textContent = String(n);
    countdown.style.display = "grid";
    countdown.classList.remove("pop");
    // force reflow so the animation retriggers
    void countdown.offsetWidth;
    countdown.classList.add("pop");
  }

  async function enter() {
    if (status !== "ready") return;
    setStatus("running");
    await opts.onEnter();
  }

  function setStatus(next: OverlayStatus, errorMessage?: string) {
    status = next;
    if (status === "loading") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      overlay.style.pointerEvents = "auto";
      topbar.style.display = "none";
      enterBtn.disabled = true;
      enterBtn.classList.remove("is-ready");
      enterBtn.setAttribute("aria-label", "Loading");
      enterBtn.title = "Loading…";
      return;
    }

    if (status === "ready") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      overlay.style.pointerEvents = "auto";
      topbar.style.display = "none";
      enterBtn.disabled = false;
      enterBtn.classList.add("is-ready");
      enterBtn.setAttribute("aria-label", "Tap to begin");
      enterBtn.title = "Tap to begin";
      return;
    }

    if (status === "running") {
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
      topbar.style.display = "flex";
      window.setTimeout(() => {
        if (status === "running") overlay.style.display = "none";
      }, 540);
      return;
    }

    overlay.style.display = "grid";
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "auto";
    topbar.style.display = "none";
    enterBtn.disabled = true;
    enterBtn.setAttribute("aria-label", "Unavailable");
    enterBtn.title = errorMessage ? `Error: ${errorMessage}` : "Something went wrong.";
    enterBtn.classList.remove("is-ready");
  }

  enterBtn.addEventListener("click", () => {
    void enter();
  });

  function onKeydown(e: KeyboardEvent) {
    if (status !== "ready") return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void enter();
    }
  }
  window.addEventListener("keydown", onKeydown, { passive: false });

  // Defaults
  setProgress(0);
  setStatus("loading");

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("keydown", onKeydown);
    overlay.remove();
    topbar.remove();
    countdown.remove();
  }

  return { setStatus, setProgress, setPerfHint, setCountdown, dispose };
}
