import {
  ACESFilmicToneMapping,
  CatmullRomCurve3,
  Clock,
  Color,
  FogExp2,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

import { createMysticGlobeWorld } from "./world/createMysticGlobeWorld";
import { createPosterTexture } from "./world/posterTexture";
import { createVignettePass } from "./world/vignettePass";
import { PerfScaler } from "../util/PerfScaler";
import { clamp, lerp } from "../util/math";

type StatusHint = "quality-low" | "quality-high";
type MusicPhase = "intro" | "countdown" | "play" | "outro" | "gameover";

export type MusicController = {
  setPhase(phase: MusicPhase): void;
  setThrusting(thrusting: boolean): void;
  frame(dt: number, t: number): void;
};

export class WinterMysticExperience {
  private readonly canvas: HTMLCanvasElement;
  private readonly music: MusicController | null;

  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private composer: EffectComposer | null = null;
  private perfScaler: PerfScaler | null = null;

  private world: ReturnType<typeof createMysticGlobeWorld> | null = null;

  private clock = new Clock();
  private raf = 0;

  private running = false;
  private introActive = true;
  private introElapsed = 0;
  private readonly introDuration = 7.2;

  private playActive = false;
  private countdownActive = false;
  private countdownTime = 0;
  private countdownShown: number | null = null;
  private pressing = false;
  private gameOver = false;
  private outroActive = false;
  private outroElapsed = 0;
  private readonly outroDuration = 1.6;

  private canvasRect: DOMRect | null = null;
  private pointerNdc = new Vector2(0, 0);
  private primaryPointerType: string | null = null;
  private primaryPointerId: number | null = null;
  private lastPointerType: string | null = null;
  private smoothLookTarget = new Vector3(0, 0.9, 0);

  // Poster view (game over): pan + zoom the invite.
  private posterPan = new Vector2(0, 0);
  private posterZoom = 1;
  private posterYaw = 0;
  private posterPitch = 0;
  private posterBaseDistance = 2;
  private posterPointers = new Map<number, { x: number; y: number; mode: "rotate" | "pan" }>();
  private posterGesture:
    | { mode: "rotate"; lastX: number; lastY: number }
    | { mode: "pan"; lastX: number; lastY: number }
    | { mode: "pinch"; lastCx: number; lastCy: number; lastDist: number; lastAngle: number }
    | null = null;

  // Mobile viewport stability (iOS Safari address-bar collapse/expand).
  private visualViewport: VisualViewport | null = null;
  private resizeRaf = 0;

  private introCamCurve: CatmullRomCurve3 | null = null;
  private introTargetCurve: CatmullRomCurve3 | null = null;
  private introFovFrom = 62;
  private introFovTo = 50;
  private introExposureFrom = 1.22;
  private introExposureTo = 1.08;
  private tmpCam = new Vector3();
  private tmpTarget = new Vector3();
  private tmpPlayer = new Vector3();
  private tmpRadial = new Vector3();
  private tmpSide = new Vector3();
  private tmpUp = new Vector3(0, 1, 0);
  private outroCamPos = new Vector3();
  private playLookTarget = new Vector3(0, 0.9, 0);

  private onPerfHintCb: ((hint: StatusHint) => void) | null = null;
  private onCountdownCb: ((n: number | null) => void) | null = null;
  private lastMusicPhase: MusicPhase | null = null;
  private lastThrusting = false;

  constructor(opts: { canvas: HTMLCanvasElement; music?: MusicController | null }) {
    this.canvas = opts.canvas;
    this.music = opts.music ?? null;
  }

  onPerfHint(cb: (hint: StatusHint) => void) {
    this.onPerfHintCb = cb;
  }

  onCountdown(cb: (n: number | null) => void) {
    this.onCountdownCb = cb;
  }

  async preload(onProgress: (p: number) => void) {
    const renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });

    // Mobile-first: ensure pointer events keep flowing (no scroll/zoom hijack).
    this.canvas.style.touchAction = "none";

    // Keep the page's initial "rose" vibe consistent during rendering.
    renderer.setClearColor(new Color(0xff849a), 1);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    // @ts-expect-error three versions vary; prefer physically correct lights when available
    renderer.physicallyCorrectLights = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new Scene();
    scene.background = null;
    scene.fog = new FogExp2(new Color(0xff849a), 0.02);

    // Camera framing tuned closer to the reference demo (more centered, less skew).
    const camera = new PerspectiveCamera(55, 1, 0.05, 80);
    camera.position.set(0.0, 2.8, 9.4);
    scene.add(camera);

    const posterTexture = await createPosterTexture(renderer, onProgress);
    posterTexture.generateMipmaps = true;
    posterTexture.anisotropy = clamp(renderer.capabilities.getMaxAnisotropy(), 2, 12);

    const world = createMysticGlobeWorld({
      renderer,
      scene,
      posterTexture,
      isMobile: matchMedia("(pointer: coarse)").matches
    });

    const composer = this.maybeCreateComposer(
      renderer,
      scene,
      camera,
      this.resolvePostFX(world.shouldUsePostFX)
    );

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = composer;
    this.world = world;

    this.buildIntroCurves(world);
    this.applyIntroStartPose();

    this.perfScaler = new PerfScaler({
      minPixelRatio: 0.75,
      maxPixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      onChange: (pixelRatio, level) => {
        renderer.setPixelRatio(pixelRatio);
        world.setQualityLevel(level);
        composer?.setPixelRatio(pixelRatio);
        this.onPerfHintCb?.(level <= 0.6 ? "quality-low" : "quality-high");
      }
    });

    this.resize();
    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("orientationchange", this.onResize, { passive: true });

    // iOS Safari: visual viewport can change height without a normal window resize.
    this.visualViewport = window.visualViewport ?? null;
    this.visualViewport?.addEventListener("resize", this.onResize, { passive: true });
    this.visualViewport?.addEventListener("scroll", this.onResize, { passive: true });

    this.canvas.addEventListener("pointerdown", this.onPointerDown, { passive: true });
    this.canvas.addEventListener("pointermove", this.onPointerMove, { passive: true });
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("pointerup", this.onPointerUp, { passive: true });
    window.addEventListener("pointercancel", this.onPointerUp, { passive: true });
    window.addEventListener("blur", this.onBlur, { passive: true });

    onProgress(1);
    this.renderOnce();
  }

  begin() {
    if (!this.renderer || !this.scene || !this.camera || !this.world) return;
    if (this.running) return;

    this.running = true;
    this.introActive = true;
    this.introElapsed = 0;
    this.playActive = false;
    this.countdownActive = false;
    this.countdownTime = 0;
    this.countdownShown = null;
    this.onCountdownCb?.(null);
    this.pressing = false;
    this.gameOver = false;
    this.outroActive = false;
    this.outroElapsed = 0;
    this.world.setThrusting(false);
    this.world.recenter();
    this.pointerNdc.set(0, 0);
    this.resetPosterView();
    this.resetPosterGesture();

    this.setMusicPhase("intro");
    this.setMusicThrusting(false);

    // Ensure we start from the sky pose even if something changed.
    this.applyIntroStartPose();

    // Start wide + slightly brighter, then settle.
    this.camera.fov = this.introFovFrom;
    this.camera.updateProjectionMatrix();
    this.renderer.toneMappingExposure = this.introExposureFrom;

    this.clock.start();
    this.loop();
  }

  skipIntro() {
    this.finishIntroAndStartPlay();
  }

  recenter() {
    if (!this.camera || !this.world) return;
    this.introActive = false;

    if (this.gameOver) {
      this.resetPosterView();
      this.applyPosterViewPose();
      return;
    }

    const { recenterCameraPos } = this.world;
    this.camera.position.copy(recenterCameraPos);
    this.camera.lookAt(this.playLookTarget);
    this.smoothLookTarget.copy(this.playLookTarget);
    this.world.recenter();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.resizeRaf);

    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);

    this.visualViewport?.removeEventListener("resize", this.onResize);
    this.visualViewport?.removeEventListener("scroll", this.onResize);
    this.visualViewport = null;

    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("blur", this.onBlur);

    this.composer?.dispose();
    this.renderer?.dispose();

    this.world?.dispose();

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.world = null;
    this.perfScaler = null;
  }

  private onResize = () => {
    // Debounce resize work into the next animation frame to avoid thrashing on mobile.
    cancelAnimationFrame(this.resizeRaf);
    this.resizeRaf = requestAnimationFrame(() => this.resize());
  };
  private onContextMenu = (e: MouseEvent) => {
    if (this.running) e.preventDefault();
  };
  private onPointerDown = (e: PointerEvent) => {
    if (!this.running || !this.world) return;
    if (this.gameOver) {
      if (this.outroActive) return;
      this.canvasRect = this.canvas.getBoundingClientRect();
      const mode: "rotate" | "pan" = e.button === 2 ? "pan" : "rotate";
      this.posterPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, mode });
      this.resetPosterGesture();
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    this.pressing = true;
    this.primaryPointerType = e.pointerType;
    this.primaryPointerId = e.pointerId;
    this.canvasRect = this.canvas.getBoundingClientRect();
    if (e.isPrimary) this.canvas.setPointerCapture(e.pointerId);
    this.world.flap();
    this.onPointerMove(e);
  };
  private onPointerUp = (e: PointerEvent) => {
    if (!this.world) return;
    if (this.posterPointers.has(e.pointerId)) {
      this.posterPointers.delete(e.pointerId);
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.resetPosterGesture();
      return;
    }
    if (this.primaryPointerId === e.pointerId && this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    if (e.isPrimary || this.primaryPointerId === e.pointerId) {
      this.primaryPointerType = null;
      this.primaryPointerId = null;
    }
    this.pressing = false;
  };
  private onBlur = () => {
    this.pressing = false;
    this.primaryPointerType = null;
    this.primaryPointerId = null;
    this.posterPointers.clear();
    this.resetPosterGesture();
    this.world?.setThrusting(false);
    this.setMusicThrusting(false);
  };
  private onPointerMove = (e: PointerEvent) => {
    if (this.gameOver && this.posterPointers.has(e.pointerId)) {
      const prev = this.posterPointers.get(e.pointerId);
      if (!prev) return;
      this.posterPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, mode: prev.mode });
      this.applyPosterGesture();
      return;
    }
    if (this.primaryPointerId != null && e.pointerId !== this.primaryPointerId) return;
    this.lastPointerType = e.pointerType;
    const rect = this.canvasRect ?? this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x01 = (e.clientX - rect.left) / rect.width;
    const y01 = (e.clientY - rect.top) / rect.height;
    this.pointerNdc.set(clamp(x01 * 2 - 1, -1, 1), clamp(1 - y01 * 2, -1, 1));
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.gameOver || this.outroActive || !this.camera || !this.world) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0012);
    this.posterZoom = clamp(this.posterZoom * factor, 1, 6);
    this.applyPosterViewPose();
  };

  private resize() {
    if (!this.renderer || !this.camera) return;

    // Use bounding rect for more reliable sizing on mobile (esp. iOS Safari).
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.canvasRect = rect;

    if (this.gameOver) this.applyPosterViewPose();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.renderer || !this.scene || !this.camera || !this.world) return;

    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    this.perfScaler?.frame(t);
    this.music?.frame(dt, t);

    if (this.introActive) {
      this.introElapsed += dt;
      const u = clamp(this.introElapsed / this.introDuration, 0, 1);

      const eased = easeInOutCubic(u);

      if (this.introCamCurve && this.introTargetCurve) {
        this.introCamCurve.getPointAt(eased, this.tmpCam);
        this.introTargetCurve.getPointAt(eased, this.tmpTarget);

        // Slight cinematic drift that fades out as we settle.
        const drift = (1 - eased) * 0.18;
        this.tmpCam.x += Math.sin(t * 0.65) * drift;
        this.tmpCam.z += Math.cos(t * 0.55) * drift;

        this.camera.position.copy(this.tmpCam);
        this.camera.lookAt(this.tmpTarget);
      }

      this.camera.fov = lerp(this.introFovFrom, this.introFovTo, eased);
      this.camera.updateProjectionMatrix();
      this.renderer.toneMappingExposure = lerp(this.introExposureFrom, this.introExposureTo, eased);

      if (u >= 1) {
        this.finishIntroAndStartPlay();
      }
    }

    if (!this.introActive && this.countdownActive) {
      this.setMusicPhase("countdown");
      this.countdownTime -= dt;
      const next = this.countdownTime > 0 ? Math.ceil(this.countdownTime) : null;
      if (next !== this.countdownShown) {
        this.countdownShown = next;
        this.onCountdownCb?.(next);
      }
      if (this.countdownTime <= 0) {
        this.countdownActive = false;
        this.onCountdownCb?.(null);
        this.playActive = true;
        this.world.start();
        this.setMusicPhase("play");
      }
    }

    // Controls:
    // - Mouse: hold to thrust (keeps the original "tap/press to fly" feel).
    // - Touch: while finger is down, auto-thrust to chase the desired height (tutorial-like).
    let thrust = false;
    if (!this.introActive && !this.countdownActive && this.playActive && !this.gameOver) {
      const pointerType = this.primaryPointerType ?? this.lastPointerType;
      const allowAuto = pointerType === "mouse" || this.pressing;
      if (this.pressing && pointerType === "mouse") {
        thrust = true;
      } else if (allowAuto) {
        this.world.getPlayerPosition(this.tmpPlayer);
        const targetY = lerp(this.world.playerYMin, this.world.playerYMax, (this.pointerNdc.y + 1) * 0.5);
        thrust = targetY > this.tmpPlayer.y + 0.06;
      }
    }
    this.world.setThrusting(thrust);
    this.setMusicThrusting(thrust);

    const state = this.world.update(dt, t);
    if (!this.gameOver && state === "gameover") {
      this.gameOver = true;
      this.outroActive = true;
      this.outroElapsed = 0;
      this.pressing = false;
      this.primaryPointerType = null;
      this.primaryPointerId = null;
      this.world.setThrusting(false);
      this.setMusicThrusting(false);
      this.setMusicPhase("outro");
      this.resetPosterView();
    }

    if (this.outroActive) {
      this.outroElapsed += dt;
      const u = clamp(this.outroElapsed / this.outroDuration, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);

      // Subtle "invite focus" dolly.
      const from = this.world.recenterCameraPos;
      this.camera.position.lerpVectors(from, this.outroCamPos, eased);
      this.camera.lookAt(this.world.posterTarget);
      this.camera.fov = lerp(this.introFovTo, 46, eased);
      this.camera.updateProjectionMatrix();
      this.renderer.toneMappingExposure = lerp(this.introExposureTo, 1.12, eased);

      if (u >= 1) {
        this.outroActive = false;
        this.setMusicPhase("gameover");
      }
    } else if (this.gameOver) {
      // Hold the invite framing once the outro completes (with pan/zoom).
      this.applyPosterViewPose();
    } else if (!this.introActive) {
      // Gameplay framing: follow the player so it stays centered.
      const follow = clamp(1 - Math.exp(-dt * 10.0), 0, 1);
      this.world.getPlayerPosition(this.tmpPlayer);
      this.tmpRadial.subVectors(this.tmpPlayer, this.world.orbitCenter);
      // Keep camera motion stable: follow around the planet in XZ, not vertical.
      this.tmpRadial.y = 0;
      if (this.tmpRadial.lengthSq() < 1e-6) this.tmpRadial.set(0, 0, 1);
      this.tmpRadial.normalize();
      const camLift = 2.35 + clamp((this.tmpPlayer.y - 0.6) * 0.15, -0.3, 0.5);
      this.tmpCam
        .copy(this.tmpPlayer)
        .addScaledVector(this.tmpRadial, 5.3)
        .addScaledVector(this.tmpUp, camLift);

      // Mobile-first "follow finger" parallax: tiny look/cam offsets.
      this.tmpSide.crossVectors(this.tmpUp, this.tmpRadial).normalize();
      const px = this.pointerNdc.x;
      const py = this.pointerNdc.y;
      this.tmpCam.addScaledVector(this.tmpSide, px * 0.55).addScaledVector(this.tmpUp, py * 0.15);

      this.tmpTarget.copy(this.tmpPlayer).addScaledVector(this.tmpRadial, -1.25);
      this.tmpTarget.addScaledVector(this.tmpSide, px * 0.35).addScaledVector(this.tmpUp, py * 0.18);

      this.camera.position.lerp(this.tmpCam, follow);
      this.smoothLookTarget.lerp(this.tmpTarget, follow);
      this.camera.lookAt(this.smoothLookTarget);

      // Subtle FOV response (like the tutorial) for extra “speed” feel.
      const fovTarget = this.introFovTo + this.pointerNdc.x * 4;
      const nextFov = lerp(this.camera.fov, fovTarget, follow);
      if (Math.abs(nextFov - this.camera.fov) > 1e-3) {
        this.camera.fov = nextFov;
        this.camera.updateProjectionMatrix();
      }
    }

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private renderOnce() {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this.composer) {
      this.composer.render();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private maybeCreateComposer(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    shouldUsePostFX: boolean
  ) {
    if (!shouldUsePostFX) return null;

    // Keep post-FX minimal and optional (mobile-friendly).
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    composer.addPass(createVignettePass());
    composer.addPass(new OutputPass());
    return composer;
  }

  private resolvePostFX(defaultOn: boolean) {
    const qs = new URLSearchParams(window.location.search);
    const v = qs.get("postfx");
    if (v === "0") return false;
    if (v === "1") return true;
    return defaultOn;
  }

  private buildIntroCurves(world: { recenterCameraPos: Vector3 }) {
    // A descending swoop that reveals the rotating globe and settles into the play view.
    const tgt = this.playLookTarget.clone();
    const endCam = world.recenterCameraPos.clone();

    const camPoints = [
      tgt.clone().add(new Vector3(0.0, 9.6, 17.5)),
      tgt.clone().add(new Vector3(4.0, 6.2, 12.0)),
      tgt.clone().add(new Vector3(2.0, 3.4, 9.5)),
      endCam
    ];

    const targetPoints = [
      tgt.clone().add(new Vector3(0.0, 1.6, -1.6)),
      tgt.clone().add(new Vector3(0.15, 1.1, -1.2)),
      tgt.clone().add(new Vector3(0.06, 0.95, -0.7)),
      tgt
    ];

    this.introCamCurve = new CatmullRomCurve3(camPoints, false, "catmullrom", 0.5);
    this.introTargetCurve = new CatmullRomCurve3(targetPoints, false, "catmullrom", 0.52);
  }

  private applyIntroStartPose() {
    if (!this.camera || !this.introCamCurve || !this.introTargetCurve) return;
    this.introCamCurve.getPointAt(0, this.tmpCam);
    this.introTargetCurve.getPointAt(0, this.tmpTarget);
    this.camera.position.copy(this.tmpCam);
    this.camera.fov = this.introFovFrom;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.tmpTarget);
  }

  private finishIntroAndStartPlay() {
    if (!this.renderer || !this.camera || !this.world) return;
    this.introActive = false;

    this.renderer.toneMappingExposure = this.introExposureTo;
    this.camera.fov = this.introFovTo;
    this.camera.position.copy(this.world.recenterCameraPos);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.playLookTarget);
    this.smoothLookTarget.copy(this.playLookTarget);

    // Countdown before controls become active.
    this.playActive = false;
    this.countdownActive = true;
    this.countdownTime = 3.0;
    this.countdownShown = null;
    this.world.recenter();
    this.world.setThrusting(false);
    this.setMusicThrusting(false);
    this.setMusicPhase("countdown");
  }

  private resetPosterView() {
    this.posterPan.set(0, 0);
    this.posterZoom = 1;
    this.posterYaw = 0;
    this.posterPitch = 0;
    this.updatePosterBaseDistanceAndPose();
  }

  private resetPosterGesture() {
    this.posterGesture = null;
  }

  private updatePosterBaseDistanceAndPose() {
    if (!this.world) return;
    // Fit the poster to ~90% viewport height at zoom=1.
    const fovDeg = 46;
    const fovRad = (fovDeg * Math.PI) / 180;
    const fill = 0.9;
    this.posterBaseDistance = (this.world.posterHeight / fill) / (2 * Math.tan(fovRad / 2));
    this.outroCamPos.copy(this.world.posterTarget).add(new Vector3(0, 0, this.posterBaseDistance));
  }

  private applyPosterGesture() {
    if (!this.camera || !this.world) return;
    if (this.outroActive) return;
    const rect = this.canvasRect ?? this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const pointers = [...this.posterPointers.values()];
    if (pointers.length === 0) {
      this.resetPosterGesture();
      return;
    }

    const zoom = clamp(this.posterZoom, 1, 6);
    const dist = this.posterBaseDistance / zoom;
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const visibleH = 2 * dist * Math.tan(fovRad / 2);
    const visibleW = visibleH * this.camera.aspect;
    const unitsPerPxX = visibleW / rect.width;
    const unitsPerPxY = visibleH / rect.height;

    if (pointers.length === 1) {
      const p = pointers[0];
      if (p.mode === "pan") {
        if (!this.posterGesture || this.posterGesture.mode !== "pan") {
          this.posterGesture = { mode: "pan", lastX: p.x, lastY: p.y };
          return;
        }
        const dx = p.x - this.posterGesture.lastX;
        const dy = p.y - this.posterGesture.lastY;
        this.posterGesture.lastX = p.x;
        this.posterGesture.lastY = p.y;

        this.posterPan.x -= dx * unitsPerPxX;
        this.posterPan.y += dy * unitsPerPxY;
        this.applyPosterViewPose();
        return;
      }

      if (!this.posterGesture || this.posterGesture.mode !== "rotate") {
        this.posterGesture = { mode: "rotate", lastX: p.x, lastY: p.y };
        return;
      }
      const dx = p.x - this.posterGesture.lastX;
      const dy = p.y - this.posterGesture.lastY;
      this.posterGesture.lastX = p.x;
      this.posterGesture.lastY = p.y;

      const rotPerPx = 0.005;
      this.posterYaw = clamp(this.posterYaw - dx * rotPerPx, -1.15, 1.15);
      this.posterPitch = clamp(this.posterPitch - dy * rotPerPx, -0.85, 0.85);
      this.applyPosterViewPose();
      return;
    }

    // Use the first 2 pointers for pinch/zoom.
    const a = pointers[0];
    const b = pointers[1];
    const cx = (a.x + b.x) * 0.5;
    const cy = (a.y + b.y) * 0.5;
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (!this.posterGesture || this.posterGesture.mode !== "pinch") {
      this.posterGesture = { mode: "pinch", lastCx: cx, lastCy: cy, lastDist: d, lastAngle: ang };
      return;
    }

    const dx = cx - this.posterGesture.lastCx;
    const dy = cy - this.posterGesture.lastCy;
    const ratio = d / this.posterGesture.lastDist;
    let dAng = ang - this.posterGesture.lastAngle;
    // Wrap to [-pi, pi] to avoid jumps when crossing the branch cut.
    if (dAng > Math.PI) dAng -= Math.PI * 2;
    if (dAng < -Math.PI) dAng += Math.PI * 2;
    this.posterGesture.lastCx = cx;
    this.posterGesture.lastCy = cy;
    this.posterGesture.lastDist = d;
    this.posterGesture.lastAngle = ang;

    this.posterZoom = clamp(this.posterZoom * ratio, 1, 6);
    this.posterPan.x -= dx * unitsPerPxX;
    this.posterPan.y += dy * unitsPerPxY;
    // Optional: twist to "turn" slightly on touch.
    this.posterYaw = clamp(this.posterYaw + dAng * 0.65, -1.15, 1.15);
    this.applyPosterViewPose();
  }

  private applyPosterViewPose() {
    if (!this.camera || !this.world) return;
    if (Math.abs(this.camera.fov - 46) > 1e-3) {
      this.camera.fov = 46;
      this.camera.updateProjectionMatrix();
    }
    this.updatePosterBaseDistanceAndPose();

    const zoom = clamp(this.posterZoom, 1, 6);
    const dist = this.posterBaseDistance / zoom;

    const fovRad = (this.camera.fov * Math.PI) / 180;
    const visibleH = 2 * dist * Math.tan(fovRad / 2);
    const visibleW = visibleH * this.camera.aspect;
    const halfVisH = visibleH * 0.5;
    const halfVisW = visibleW * 0.5;

    const halfPosterH = this.world.posterHeight * 0.5;
    const halfPosterW = this.world.posterWidth * 0.5;
    const maxPanY = Math.max(0, halfPosterH - halfVisH);
    const maxPanX = Math.max(0, halfPosterW - halfVisW);
    this.posterPan.x = clamp(this.posterPan.x, -maxPanX, maxPanX);
    this.posterPan.y = clamp(this.posterPan.y, -maxPanY, maxPanY);

    this.tmpTarget.copy(this.world.posterTarget).add(new Vector3(this.posterPan.x, this.posterPan.y, 0));
    this.tmpCam.set(0, 0, dist);
    this.tmpCam.applyAxisAngle(this.tmpUp, this.posterYaw);
    this.tmpSide.set(1, 0, 0).applyAxisAngle(this.tmpUp, this.posterYaw);
    this.tmpCam.applyAxisAngle(this.tmpSide, this.posterPitch);
    this.tmpCam.add(this.tmpTarget);
    this.camera.position.copy(this.tmpCam);
    this.camera.lookAt(this.tmpTarget);
    this.smoothLookTarget.copy(this.tmpTarget);
  }

  private setMusicPhase(phase: MusicPhase) {
    if (!this.music) return;
    if (this.lastMusicPhase === phase) return;
    this.lastMusicPhase = phase;
    this.music.setPhase(phase);
  }

  private setMusicThrusting(thrusting: boolean) {
    if (!this.music) return;
    if (this.lastThrusting === thrusting) return;
    this.lastThrusting = thrusting;
    this.music.setThrusting(thrusting);
  }
}

function easeInOutCubic(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
