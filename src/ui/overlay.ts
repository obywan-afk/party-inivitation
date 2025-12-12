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

  // ---- Overlay (loading / tap-to-begin) ----
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  const overlayInner = document.createElement("div");
  overlayInner.className = "overlay-inner";
  overlay.appendChild(overlayInner);

  const hero = document.createElement("div");
  hero.className = "hero";
  overlayInner.appendChild(hero);

  const brand = document.createElement("div");
  brand.className = "brand";
  hero.appendChild(brand);

  const sigil = document.createElement("div");
  sigil.className = "sigil";
  sigil.setAttribute("aria-hidden", "true");
  brand.appendChild(sigil);

  const brandCopy = document.createElement("div");
  brandCopy.className = "brand-copy";
  brand.appendChild(brandCopy);

  const brandTitle = document.createElement("div");
  brandTitle.className = "brand-title";
  brandTitle.textContent = "Winter Mystic Invite";
  brandCopy.appendChild(brandTitle);

  const brandSub = document.createElement("div");
  brandSub.className = "brand-sub";
  brandSub.textContent = "A cinematic winter shrine • A4 poster invite";
  brandCopy.appendChild(brandSub);

  const playWrap = document.createElement("div");
  playWrap.className = "play-wrap panel";
  hero.appendChild(playWrap);

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
  playWrap.appendChild(enterBtn);

  const ctaLabel = document.createElement("div");
  ctaLabel.className = "cta-label";
  ctaLabel.textContent = "Loading…";
  playWrap.appendChild(ctaLabel);

  const loadingText = document.createElement("div");
  loadingText.className = "loading-text";
  loadingText.textContent = "Loading…";
  playWrap.appendChild(loadingText);

  const progressWrap = document.createElement("div");
  progressWrap.className = "progress";
  playWrap.appendChild(progressWrap);

  const progressBar = document.createElement("div");
  progressWrap.appendChild(progressBar);

  const helperText = document.createElement("div");
  helperText.className = "helper-text";
  helperText.textContent = "1-finger orbit • pinch to zoom • recenter anytime";
  playWrap.appendChild(helperText);

  // ---- Topbar (in-experience HUD controls) ----
  const topbar = document.createElement("div");
  topbar.className = "topbar";

  const left = document.createElement("div");
  left.className = "chip";
  left.setAttribute("data-quality", "auto");
  left.innerHTML = `
    <span class="chip-dot" aria-hidden="true"></span>
    <span class="chip-text">Auto quality</span>
  `;
  topbar.appendChild(left);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "10px";
  right.style.pointerEvents = "auto";
  topbar.appendChild(right);

  const skipBtn = document.createElement("button");
  skipBtn.className = "button ghost";
  skipBtn.type = "button";
  skipBtn.textContent = "Skip intro";
  right.appendChild(skipBtn);

  const muteBtn = document.createElement("button");
  muteBtn.className = "button";
  muteBtn.type = "button";
  muteBtn.textContent = "Mute";
  right.appendChild(muteBtn);

  const recenterBtn = document.createElement("button");
  recenterBtn.className = "button primary";
  recenterBtn.type = "button";
  recenterBtn.textContent = "Recenter";
  right.appendChild(recenterBtn);

  const hudHint = document.createElement("div");
  hudHint.className = "hud-hint";
  hudHint.setAttribute("aria-hidden", "true");
  hudHint.textContent = "Tip: Keep the poster centered — tap Recenter if you drift.";

  root.appendChild(topbar);
  root.appendChild(hudHint);
  root.appendChild(overlay);

  let status: OverlayStatus = "loading";
  let disposed = false;
  let introTimeout = 0;
  let hintTimeout = 0;

  const ringBar = enterBtn.querySelector<SVGCircleElement>(".play-ring-bar");
  const ringRadius = 52;
  const ringCircumference = 2 * Math.PI * ringRadius;
  if (ringBar) {
    ringBar.style.strokeDasharray = `${ringCircumference}`;
    ringBar.style.strokeDashoffset = `${ringCircumference}`;
  }

  function refreshMuteLabel() {
    muteBtn.textContent = opts.getMuted() ? "Unmute" : "Mute";
  }

  function setProgress(p: number) {
    const clamped = Math.max(0, Math.min(1, p));
    progressBar.style.width = `${Math.round(clamped * 100)}%`;
    loadingText.textContent = `Loading… ${Math.round(clamped * 100)}%`;
    if (ringBar) {
      ringBar.style.strokeDashoffset = `${ringCircumference * (1 - clamped)}`;
    }
  }

  function setPerfHint(h: PerfHint) {
    const text = left.querySelector<HTMLElement>(".chip-text");
    if (!h) {
      left.setAttribute("data-quality", "auto");
      if (text) text.textContent = "Auto quality";
      return;
    }
    if (h === "quality-low") {
      left.setAttribute("data-quality", "low");
      if (text) text.textContent = "Auto quality • lowered";
    } else {
      left.setAttribute("data-quality", "high");
      if (text) text.textContent = "Auto quality • high";
    }
  }

  async function enter() {
    if (status !== "ready") return;
    setStatus("running");
    refreshMuteLabel();
    await opts.onEnter();
    window.clearTimeout(introTimeout);
    window.clearTimeout(hintTimeout);

    // Offer a brief "skip intro" affordance, then get out of the way.
    skipBtn.classList.remove("is-hidden");
    introTimeout = window.setTimeout(() => skipBtn.classList.add("is-hidden"), 8200);

    hudHint.classList.add("show");
    hintTimeout = window.setTimeout(() => hudHint.classList.remove("show"), 6800);
  }

  function setStatus(next: OverlayStatus, errorMessage?: string) {
    status = next;
    if (status === "loading") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      topbar.style.display = "none";
      ctaLabel.textContent = "Loading…";
      loadingText.textContent = "Loading…";
      enterBtn.disabled = true;
      enterBtn.classList.remove("is-ready");
      muteBtn.style.display = "none";
      recenterBtn.style.display = "none";
      skipBtn.style.display = "none";
      return;
    }

    if (status === "ready") {
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      topbar.style.display = "none";
      ctaLabel.textContent = "Tap to Begin";
      loadingText.textContent = "Audio starts after tap (autoplay rules).";
      enterBtn.disabled = false;
      enterBtn.classList.add("is-ready");
      muteBtn.style.display = "none";
      recenterBtn.style.display = "none";
      skipBtn.style.display = "none";
      return;
    }

    if (status === "running") {
      overlay.style.opacity = "0";
      topbar.style.display = "flex";
      skipBtn.style.display = "inline-flex";
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
    ctaLabel.textContent = "Unavailable";
    loadingText.textContent = errorMessage ? `Error: ${errorMessage}` : "Something went wrong.";
    enterBtn.disabled = true;
    enterBtn.setAttribute("aria-label", "Unavailable");
    enterBtn.classList.remove("is-ready");
    muteBtn.style.display = "none";
    recenterBtn.style.display = "none";
    skipBtn.style.display = "none";
  }

  enterBtn.addEventListener("click", () => {
    void enter();
  });
  skipBtn.addEventListener("click", () => {
    opts.onSkipIntro();
    skipBtn.classList.add("is-hidden");
  });
  muteBtn.addEventListener("click", () => {
    opts.onMuteToggle();
    refreshMuteLabel();
  });
  recenterBtn.addEventListener("click", () => {
    opts.onRecenter();
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
    window.clearTimeout(introTimeout);
    window.clearTimeout(hintTimeout);
    window.removeEventListener("keydown", onKeydown);
    overlay.remove();
    topbar.remove();
    hudHint.remove();
  }

  return { setStatus, setProgress, setPerfHint, dispose };
}
