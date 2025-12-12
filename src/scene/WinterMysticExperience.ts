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
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import { createWinterWorld } from "./world/createWinterWorld";
import { createPosterTexture } from "./world/posterTexture";
import { createVignettePass } from "./world/vignettePass";
import { PerfScaler } from "../util/PerfScaler";
import { clamp, lerp } from "../util/math";

type StatusHint = "quality-low" | "quality-high";

export class WinterMysticExperience {
  private readonly canvas: HTMLCanvasElement;

  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private composer: EffectComposer | null = null;
  private perfScaler: PerfScaler | null = null;

  private world: ReturnType<typeof createWinterWorld> | null = null;

  private clock = new Clock();
  private raf = 0;

  private running = false;
  private introActive = true;
  private introElapsed = 0;
  private readonly introDuration = 7.2;

  private introCamCurve: CatmullRomCurve3 | null = null;
  private introTargetCurve: CatmullRomCurve3 | null = null;
  private introFovFrom = 62;
  private introFovTo = 50;
  private introExposureFrom = 1.22;
  private introExposureTo = 1.08;
  private tmpCam = new Vector3();
  private tmpTarget = new Vector3();

  private onPerfHintCb: ((hint: StatusHint) => void) | null = null;

  constructor(opts: { canvas: HTMLCanvasElement }) {
    this.canvas = opts.canvas;
  }

  onPerfHint(cb: (hint: StatusHint) => void) {
    this.onPerfHintCb = cb;
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

    renderer.setClearColor(new Color(0x06080d), 1);
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
    scene.fog = new FogExp2(new Color(0x070b12), 0.08);

    const camera = new PerspectiveCamera(50, 1, 0.05, 80);
    camera.position.set(7.2, 4.6, 8.8);

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 3.1;
    controls.maxDistance = 9.5;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.18;
    controls.maxAzimuthAngle = Math.PI * 0.58;
    controls.minAzimuthAngle = -Math.PI * 0.58;

    const posterTexture = await createPosterTexture(renderer, onProgress);
    posterTexture.generateMipmaps = true;
    posterTexture.anisotropy = clamp(renderer.capabilities.getMaxAnisotropy(), 2, 12);

    const world = createWinterWorld({
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
    this.controls = controls;
    this.composer = composer;
    this.world = world;

    this.buildIntroCurves(world);

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

    controls.target.copy(world.posterTarget);
    controls.update();

    onProgress(1);
    this.renderOnce();
  }

  begin() {
    if (!this.renderer || !this.scene || !this.camera || !this.controls || !this.world) return;
    if (this.running) return;

    this.running = true;
    this.introActive = true;
    this.introElapsed = 0;

    // Start wide + slightly brighter, then settle.
    this.camera.fov = this.introFovFrom;
    this.camera.updateProjectionMatrix();
    this.renderer.toneMappingExposure = this.introExposureFrom;

    this.clock.start();
    this.loop();
  }

  skipIntro() {
    this.recenter();
  }

  recenter() {
    if (!this.camera || !this.controls || !this.world) return;
    this.introActive = false;

    const { recenterCameraPos, posterTarget } = this.world;
    this.camera.position.copy(recenterCameraPos);
    this.controls.target.copy(posterTarget);
    this.controls.update();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);

    this.controls?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();

    this.world?.dispose();

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.composer = null;
    this.world = null;
    this.perfScaler = null;
  }

  private onResize = () => this.resize();

  private resize() {
    if (!this.renderer || !this.camera) return;

    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.renderer || !this.scene || !this.camera || !this.controls || !this.world) return;

    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    this.perfScaler?.frame(t);

    if (this.running) {
      this.controls.enabled = !this.introActive;
    }

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
        this.controls.target.copy(this.tmpTarget);
      }

      this.camera.fov = lerp(this.introFovFrom, this.introFovTo, eased);
      this.camera.updateProjectionMatrix();
      this.renderer.toneMappingExposure = lerp(this.introExposureFrom, this.introExposureTo, eased);

      if (u >= 1) {
        this.introActive = false;
        this.renderer.toneMappingExposure = this.introExposureTo;
        this.camera.fov = this.introFovTo;
        this.camera.updateProjectionMatrix();
      }
    }

    this.controls.update();
    this.world.update(dt, t);

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private renderOnce() {
    if (!this.renderer || !this.scene || !this.camera) return;
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

    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.38, 0.8, 0.92);
    composer.addPass(bloom);

    composer.addPass(createVignettePass());
    return composer;
  }

  private resolvePostFX(defaultOn: boolean) {
    const qs = new URLSearchParams(window.location.search);
    const v = qs.get("postfx");
    if (v === "0") return false;
    if (v === "1") return true;
    return defaultOn;
  }

  private buildIntroCurves(world: { posterTarget: Vector3; recenterCameraPos: Vector3 }) {
    // A descending swoop that starts high in the fog and lands on the poster.
    const tgt = world.posterTarget.clone();
    const endCam = world.recenterCameraPos.clone();

    const camPoints = [
      tgt.clone().add(new Vector3(1.2, 13.5, 22.0)),
      tgt.clone().add(new Vector3(8.5, 8.2, 14.5)),
      tgt.clone().add(new Vector3(6.8, 3.8, 8.6)),
      endCam
    ];

    const targetPoints = [
      tgt.clone().add(new Vector3(0.0, 2.1, -3.0)), // look past the poster (world reveal)
      tgt.clone().add(new Vector3(0.2, 1.9, -2.0)),
      tgt.clone().add(new Vector3(0.1, 1.45, -0.9)),
      tgt
    ];

    this.introCamCurve = new CatmullRomCurve3(camPoints, false, "catmullrom", 0.48);
    this.introTargetCurve = new CatmullRomCurve3(targetPoints, false, "catmullrom", 0.52);
  }
}

function easeInOutCubic(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
