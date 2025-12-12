import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Texture,
  Vector3,
  WebGLRenderer
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { createSnowPoints } from "./snow";
import { createRuneTexture } from "./runes";
import { clamp, lerp } from "../../util/math";

export type WinterWorld = ReturnType<typeof createWinterWorld>;

export function createWinterWorld(opts: {
  renderer: WebGLRenderer;
  scene: Scene;
  posterTexture: Texture;
  isMobile: boolean;
}) {
  const { renderer, scene, posterTexture, isMobile } = opts;

  const root = new Group();
  scene.add(root);

  const pmrem = new PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  const posterTarget = new Vector3(0.0, 1.25, -0.25);
  const recenterCameraPos = new Vector3(4.6, 2.3, 4.9);

  const shouldUsePostFX = !isMobile && (window.devicePixelRatio || 1) <= 2;

  // Sky dome to prevent seeing "end of world".
  const sky = createSkyDome();
  root.add(sky);

  // Lighting: cold moon + warm lantern accents.
  const hemi = new HemisphereLight(0x6b7fa8, 0x020409, 0.22);
  root.add(hemi);

  const moon = new DirectionalLight(0xaecbff, 1.7);
  moon.position.set(7.2, 9.6, 6.8);
  moon.target.position.set(0, 0.6, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.near = 0.5;
  moon.shadow.camera.far = 30;
  moon.shadow.camera.left = -8;
  moon.shadow.camera.right = 8;
  moon.shadow.camera.top = 8;
  moon.shadow.camera.bottom = -8;
  moon.shadow.bias = -0.00025;
  root.add(moon);
  root.add(moon.target);

  const rim = new DirectionalLight(0x8ef0ff, 0.55);
  rim.position.set(-10, 5.5, -10);
  rim.target.position.set(0, 1, 0);
  root.add(rim);
  root.add(rim.target);

  // Ground / snow (large disk so edges stay hidden in fog).
  const groundGeo = new CircleGeometry(80, isMobile ? 48 : 72);
  const groundMat = new MeshStandardMaterial({
    color: new Color(0xcdd7e5),
    roughness: 0.98,
    metalness: 0.0
  });
  const ground = new Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Subtle frozen stone platform.
  const plinthGeo = new BoxGeometry(7.6, 0.35, 6.2, 1, 1, 1);
  const stoneMat = new MeshStandardMaterial({
    color: new Color(0x6d7380),
    roughness: 0.92,
    metalness: 0.02
  });
  const plinth = new Mesh(plinthGeo, stoneMat);
  plinth.position.set(0, 0.17, 0);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);

  // Poster slab (stone tablet) + inset poster plane.
  const slab = new Group();
  slab.position.set(0, 0.02, -0.1);
  root.add(slab);

  const slabFrameGeo = new BoxGeometry(1.25, 1.75, 0.22, 1, 1, 1);
  const slabFrame = new Mesh(slabFrameGeo, stoneMat);
  slabFrame.position.set(0, 1.24, -0.95);
  slabFrame.castShadow = true;
  slabFrame.receiveShadow = true;
  slab.add(slabFrame);

  const insetGeo = new BoxGeometry(0.92, 1.34, 0.06, 1, 1, 1);
  const insetMat = new MeshStandardMaterial({
    color: new Color(0x1a212c),
    roughness: 0.65,
    metalness: 0
  });
  const inset = new Mesh(insetGeo, insetMat);
  inset.position.copy(slabFrame.position).add(new Vector3(0, 0, 0.11));
  inset.castShadow = true;
  inset.receiveShadow = true;
  slab.add(inset);

  // A4 portrait plane: width/height = 210/297 ≈ 0.707.
  const a4Height = 1.18;
  const a4Width = a4Height * (210 / 297);
  const posterPlaneGeo = new PlaneGeometry(a4Width, a4Height, 1, 1);
  const posterMat = new MeshStandardMaterial({
    map: posterTexture,
    roughness: 0.65,
    metalness: 0.0,
    emissive: new Color(0x0a111a),
    emissiveIntensity: 0.18
  });
  const posterPlane = new Mesh(posterPlaneGeo, posterMat);
  posterPlane.position.copy(slabFrame.position).add(new Vector3(0, 0.02, 0.145));
  posterPlane.rotation.y = 0;
  posterPlane.castShadow = false;
  posterPlane.receiveShadow = false;
  slab.add(posterPlane);

  posterTarget.copy(posterPlane.getWorldPosition(new Vector3()));

  // Rune gate / frame behind slab to add depth.
  const gate = new Group();
  gate.position.set(0, 0, -2.8);
  root.add(gate);

  const gateMat = new MeshStandardMaterial({
    color: new Color(0x4d5560),
    roughness: 0.9,
    metalness: 0.02
  });
  const pillarGeo = new BoxGeometry(0.7, 3.2, 0.7);
  const lintelGeo = new BoxGeometry(3.4, 0.7, 0.7);

  const leftPillar = new Mesh(pillarGeo, gateMat);
  leftPillar.position.set(-1.5, 1.6, 0);
  leftPillar.castShadow = true;
  leftPillar.receiveShadow = true;
  gate.add(leftPillar);

  const rightPillar = new Mesh(pillarGeo, gateMat);
  rightPillar.position.set(1.5, 1.6, 0);
  rightPillar.castShadow = true;
  rightPillar.receiveShadow = true;
  gate.add(rightPillar);

  const lintel = new Mesh(lintelGeo, gateMat);
  lintel.position.set(0, 3.0, 0);
  lintel.castShadow = true;
  lintel.receiveShadow = true;
  gate.add(lintel);

  const runeTexture = createRuneTexture();
  runeTexture.colorSpace = SRGBColorSpace;
  runeTexture.anisotropy = clamp(renderer.capabilities.getMaxAnisotropy(), 2, 10);

  const runeMat = new MeshStandardMaterial({
    color: new Color(0x1b232e),
    roughness: 0.8,
    metalness: 0.0,
    emissive: new Color(0x88d8ff),
    emissiveMap: runeTexture,
    emissiveIntensity: 0.7
  });
  const runePlaque = new Mesh(new PlaneGeometry(3.0, 0.8), runeMat);
  runePlaque.position.set(0, 3.0, 0.36);
  gate.add(runePlaque);

  // Lanterns.
  const lanternPositions = [new Vector3(-2.8, 0, 1.8), new Vector3(2.8, 0, 1.6)];
  for (const p of lanternPositions) {
    const post = new Mesh(new BoxGeometry(0.12, 1.2, 0.12), gateMat);
    post.position.set(p.x, 0.6, p.z);
    post.castShadow = true;
    post.receiveShadow = true;
    root.add(post);

    const bulb = new Mesh(
      new SphereGeometry(0.14, 18, 14),
      new MeshStandardMaterial({
        color: new Color(0x141214),
        roughness: 0.2,
        metalness: 0.0,
        emissive: new Color(0xffd29a),
        emissiveIntensity: 1.1
      })
    );
    bulb.position.set(p.x, 1.06, p.z);
    bulb.castShadow = false;
    root.add(bulb);

    const light = new PointLight(0xffc994, 14, 7.5, 2.1);
    light.position.set(p.x, 1.1, p.z);
    light.castShadow = false;
    root.add(light);
  }

  // Forest ring (instanced low-poly trees). Push farther out so fog hides bounds.
  const treeCount = isMobile ? 30 : 48;
  const trunkGeo = new BoxGeometry(0.18, 1.25, 0.18);
  const canopyGeo = new BoxGeometry(0.9, 1.1, 0.9);
  const trunkMat = new MeshStandardMaterial({
    color: new Color(0x2c2b2d),
    roughness: 0.95,
    metalness: 0
  });
  const canopyMat = new MeshStandardMaterial({
    color: new Color(0x131e22),
    roughness: 0.98,
    metalness: 0
  });

  const trunkInst = new InstancedMesh(trunkGeo, trunkMat, treeCount);
  const canopyInst = new InstancedMesh(canopyGeo, canopyMat, treeCount);
  trunkInst.castShadow = true;
  trunkInst.receiveShadow = true;
  canopyInst.castShadow = true;
  canopyInst.receiveShadow = true;
  root.add(trunkInst, canopyInst);

  const dummy = new Object3D();
  for (let i = 0; i < treeCount; i++) {
    const a = (i / treeCount) * Math.PI * 2;
    const r = 14.5 + (Math.sin(i * 1.7) * 0.6 + 0.6) * 3.0;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = 0.9 + (i % 7) * 0.06;

    dummy.position.set(x, 0.62, z);
    dummy.scale.setScalar(s);
    dummy.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), a + Math.PI);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, 1.65, z);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    canopyInst.setMatrixAt(i, dummy.matrix);
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  canopyInst.instanceMatrix.needsUpdate = true;

  // Snow particles (GPU-friendly Points).
  const snow = createSnowPoints({
    count: isMobile ? 1400 : 2400,
    radius: 18.0,
    height: 7.5
  });
  root.add(snow.points);

  // Quality knobs.
  let qualityLevel = 1;
  function setQualityLevel(level: number) {
    qualityLevel = clamp(level, 0.25, 1);
    const map = qualityLevel >= 0.75 ? 1024 : 512;
    moon.shadow.mapSize.set(map, map);
    moon.shadow.needsUpdate = true;
    snow.setQuality(qualityLevel);
  }

  function update(dt: number, t: number) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.65);
    moon.intensity = lerp(1.55, 1.8, pulse * 0.25);
    snow.update(dt, t);

    // Subtle rune shimmer.
    runeMat.emissiveIntensity = lerp(0.58, 0.82, 0.5 + 0.5 * Math.sin(t * 0.9));

    // Keep fog density slightly breathing.
    if (scene.fog instanceof FogExp2) {
      scene.fog.density = lerp(0.074, 0.088, 0.5 + 0.5 * Math.sin(t * 0.12));
    }
  }

  function dispose() {
    envTex.dispose();
    runeTexture.dispose();
    posterTexture.dispose();
    (sky.material as MeshBasicMaterial).map?.dispose();
    sky.geometry.dispose();
    (sky.material as MeshBasicMaterial).dispose();
    groundGeo.dispose();
    groundMat.dispose();
    plinthGeo.dispose();
    stoneMat.dispose();
    slabFrameGeo.dispose();
    insetGeo.dispose();
    insetMat.dispose();
    posterPlaneGeo.dispose();
    posterMat.dispose();
    pillarGeo.dispose();
    lintelGeo.dispose();
    gateMat.dispose();
    runePlaque.geometry.dispose();
    runeMat.dispose();
    trunkGeo.dispose();
    canopyGeo.dispose();
    trunkMat.dispose();
    canopyMat.dispose();
    trunkInst.dispose();
    canopyInst.dispose();
    snow.dispose();
    root.removeFromParent();
  }

  // First-quality set.
  setQualityLevel(1);

  return {
    posterTarget,
    recenterCameraPos,
    shouldUsePostFX,
    setQualityLevel,
    update,
    dispose
  };
}

function createSkyDome() {
  const tex = createSkyTexture();
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;

  const mat = new MeshBasicMaterial({
    map: tex,
    side: 1, // BackSide
    fog: false
  });
  const geo = new SphereGeometry(70, 48, 28);
  const dome = new Mesh(geo, mat);
  dome.position.set(0, 0, 0);
  return dome;
}

function createSkyTexture() {
  const w = 1024;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable.");

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#02040b");
  g.addColorStop(0.35, "#050814");
  g.addColorStop(0.7, "#070b12");
  g.addColorStop(1, "#0a0f18");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Subtle "moon haze" spot.
  const rg = ctx.createRadialGradient(w * 0.72, h * 0.22, 10, w * 0.72, h * 0.22, h * 0.55);
  rg.addColorStop(0, "rgba(166,215,255,0.16)");
  rg.addColorStop(0.35, "rgba(166,215,255,0.06)");
  rg.addColorStop(1, "rgba(166,215,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);

  // Very subtle stars/noise.
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * w;
    const y = Math.random() * (h * 0.55);
    const r = Math.random() < 0.95 ? 1 : 1.6;
    ctx.fillStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.25})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  return new CanvasTexture(c);
}
