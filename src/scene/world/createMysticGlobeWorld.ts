import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  MeshLambertMaterial,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  SphereGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { clamp, lerp } from "../../util/math";

export type MysticGlobeWorld = ReturnType<typeof createMysticGlobeWorld>;

type GameState = "idle" | "playing" | "gameover";

export function createMysticGlobeWorld(opts: {
  renderer: WebGLRenderer;
  scene: Scene;
  posterTexture: Texture;
  isMobile: boolean;
}) {
  const { renderer, scene, posterTexture, isMobile } = opts;

  const root = new Group();
  scene.add(root);

  const gameGroup = new Group();
  root.add(gameGroup);

  // Environment (cheap but gives nice spec highlights).
  const pmrem = new PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  // Low‑poly planet framing (like the reference screenshot).
  const skyColor = new Color(0x4a4fc4);
  scene.background = skyColor;
  // Soft fog to blend edges without looking “misty”.
  scene.fog = new FogExp2(skyColor, 0.02);

  const planetRadius = 4.1;
  const planetCenter = new Vector3(0, -2.65, 0);
  const orbitCenter = planetCenter.clone();

  // Invite settles above the planet.
  const posterTarget = new Vector3(0, 0.85, -0.8);
  const recenterCameraPos = new Vector3(0.0, 2.15, 8.2);

  const shouldUsePostFX = !isMobile && (window.devicePixelRatio || 1) <= 2;

  // Planet group: positioned at the planet center; rotations happen here so the planet
  // spins in-place (not orbiting around the world origin).
  const planetGroup = new Group();
  planetGroup.position.copy(planetCenter);
  gameGroup.add(planetGroup);

  // Planet mesh (simple shaded look).
  const planetGeo = new SphereGeometry(planetRadius, isMobile ? 18 : 28, isMobile ? 12 : 18);
  const planetTex = createPlanetTexture();
  planetTex.colorSpace = SRGBColorSpace;
  planetTex.needsUpdate = true;
  const planetMat = new MeshLambertMaterial({
    map: planetTex,
    color: new Color(0xffffff)
  });
  const planet = new Mesh(planetGeo, planetMat);
  planet.position.set(0, 0, 0);
  planet.castShadow = false;
  planet.receiveShadow = true;
  planetGroup.add(planet);

  // Lighting: colorful key + warm practicals.
  const hemi = new HemisphereLight(0xffffff, 0x7b7fe0, 0.85);
  root.add(hemi);

  const key = new DirectionalLight(0xfff0d8, 1.35);
  key.position.set(6.8, 8.6, 7.2);
  key.target.position.copy(planetCenter).add(new Vector3(0, 1.2, 0));
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 26;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.00022;
  root.add(key);
  gameGroup.add(key.target);

  // Warm “cozy” bounce.
  const warmFill = new PointLight(0xffc27a, 0.85, 18, 2);
  warmFill.position.copy(planetCenter).add(new Vector3(0, 4.2, 4.0));
  warmFill.castShadow = false;
  root.add(warmFill);

  // --- Placeable components (instanced) ---
  const treeCount = isMobile ? 80 : 150;
  const houseCount = isMobile ? 10 : 20;
  const cloudCount = isMobile ? 18 : 32;

  const trees = createLowPolyTrees(treeCount);
  const houses = createLowPolyHouses(houseCount);
  const clouds = createLowPolyClouds(cloudCount);

  planetGroup.add(
    trees.trunkInst,
    trees.tier1Inst,
    trees.tier2Inst,
    trees.tier3Inst,
    houses.baseInst,
    houses.roofInst,
    houses.windowInst
  );
  gameGroup.add(clouds.cloudInst);

  // Layout on the planet surface.
  const dummy = new Object3D();
  const up = new Vector3(0, 1, 0);
  const n = new Vector3();
  const tangentYaw = new Vector3();

  for (let i = 0; i < treeCount; i++) {
    const p = randomPointOnPlanet(planetRadius, 0.05);
    n.copy(p).normalize();
    const s = 0.65 + Math.random() * 0.55;

    // Oriented outward from the planet.
    dummy.position.copy(n).multiplyScalar(planetRadius + 0.03);
    dummy.quaternion.setFromUnitVectors(up, n);
    // Add a random twist around the normal for variety.
    dummy.rotateOnAxis(n, Math.random() * Math.PI * 2);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    trees.trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.copy(n).multiplyScalar(planetRadius + 0.45 * s);
    dummy.updateMatrix();
    trees.tier1Inst.setMatrixAt(i, dummy.matrix);

    dummy.position.copy(n).multiplyScalar(planetRadius + 0.72 * s);
    dummy.updateMatrix();
    trees.tier2Inst.setMatrixAt(i, dummy.matrix);

    dummy.position.copy(n).multiplyScalar(planetRadius + 0.98 * s);
    dummy.updateMatrix();
    trees.tier3Inst.setMatrixAt(i, dummy.matrix);
  }
  trees.trunkInst.instanceMatrix.needsUpdate = true;
  trees.tier1Inst.instanceMatrix.needsUpdate = true;
  trees.tier2Inst.instanceMatrix.needsUpdate = true;
  trees.tier3Inst.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < houseCount; i++) {
    const p = randomPointOnPlanet(planetRadius, 0.03);
    n.copy(p).normalize();
    const s = 0.75 + Math.random() * 0.75;

    dummy.position.copy(n).multiplyScalar(planetRadius + 0.06);
    dummy.quaternion.setFromUnitVectors(up, n);
    dummy.rotateOnAxis(n, Math.random() * Math.PI * 2);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    houses.baseInst.setMatrixAt(i, dummy.matrix);

    dummy.position.copy(n).multiplyScalar(planetRadius + 0.42 * s);
    dummy.updateMatrix();
    houses.roofInst.setMatrixAt(i, dummy.matrix);

    // Window faces “out” a bit: offset along the local forward axis.
    tangentYaw.set(0, 0, 1).applyQuaternion(dummy.quaternion);
    dummy.position
      .copy(n)
      .multiplyScalar(planetRadius + 0.22 * s)
      .addScaledVector(tangentYaw, 0.18 * s);
    dummy.updateMatrix();
    houses.windowInst.setMatrixAt(i, dummy.matrix);
  }
  houses.baseInst.instanceMatrix.needsUpdate = true;
  houses.roofInst.instanceMatrix.needsUpdate = true;
  houses.windowInst.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < cloudCount; i++) {
    // Clouds sit above the horizon.
    const theta = Math.random() * Math.PI * 2;
    const r = 7.2 + Math.random() * 3.2;
    const y = 2.2 + Math.random() * 3.2;
    dummy.position.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
    dummy.rotation.set(Math.random() * 0.2, Math.random() * Math.PI * 2, Math.random() * 0.2);
    dummy.scale.setScalar(0.65 + Math.random() * 1.35);
    dummy.updateMatrix();
    clouds.cloudInst.setMatrixAt(i, dummy.matrix);
  }
  clouds.cloudInst.instanceMatrix.needsUpdate = true;

  // Player.
  const player = new Group();
  gameGroup.add(player);
  const birdBody = new Mesh(
    new BoxGeometry(0.38, 0.22, 0.22),
    new MeshLambertMaterial({ color: new Color(0xff6b5a) })
  );
  birdBody.castShadow = true;
  player.add(birdBody);
  const birdHead = new Mesh(
    new BoxGeometry(0.18, 0.16, 0.16),
    new MeshLambertMaterial({ color: new Color(0xffffff) })
  );
  birdHead.position.set(0.26, 0.02, 0);
  birdHead.castShadow = true;
  player.add(birdHead);
  const birdWing = new Mesh(
    new BoxGeometry(0.18, 0.06, 0.42),
    new MeshLambertMaterial({ color: new Color(0xff8a7d) })
  );
  birdWing.position.set(-0.02, -0.02, 0);
  birdWing.castShadow = true;
  player.add(birdWing);

  // Invitation card (revealed after the world drops).
  // A4 portrait plane: width/height = 210/297 ≈ 0.707.
  const a4Height = 1.38;
  const a4Width = a4Height * (210 / 297);
  const inviteGeo = new PlaneGeometry(a4Width, a4Height, 1, 1);
  const inviteFrontMat = new MeshStandardMaterial({
    map: posterTexture,
    roughness: 0.5,
    metalness: 0.0,
    emissive: new Color(0x0a0b12),
    emissiveIntensity: 0.35
  });
  const inviteBackMat = new MeshStandardMaterial({
    color: new Color(0x0b0d1e),
    roughness: 0.9,
    metalness: 0.0,
    emissive: new Color(0x05060f),
    emissiveIntensity: 0.2,
    side: DoubleSide
  });

  const inviteGroup = new Group();
  inviteGroup.visible = false;
  inviteGroup.position.copy(posterTarget);
  root.add(inviteGroup);

  const inviteFront = new Mesh(inviteGeo, inviteFrontMat);
  const inviteBack = new Mesh(inviteGeo, inviteBackMat);
  inviteFront.castShadow = false;
  inviteFront.receiveShadow = false;
  inviteBack.castShadow = false;
  inviteBack.receiveShadow = false;
  inviteBack.rotation.y = Math.PI;
  inviteBack.position.z = -0.001;
  inviteGroup.add(inviteFront, inviteBack);

  // Gameplay state.
  let qualityLevel = 1;
  let thrusting = false;
  let state: GameState = "idle";
  let playElapsed = 0;
  let gameOverElapsed = 0;

  const playerPos = new Vector3(0, 0, 0);
  const orbitOffset = new Vector3();
  const tmpV = new Vector3();
  let velPhi = 0;
  const boundsPhi = 0.28;
  let dangerT = 0;

  let theta = 0;
  let phi = 0.96;
  const basePhi = 0.96;
  const orbitRadius = planetRadius + 2.35;
  const phiMin = 0.55;
  const phiMax = 1.25;
  const playerYMin = orbitCenter.y + orbitRadius * Math.cos(phiMax);
  const playerYMax = orbitCenter.y + orbitRadius * Math.cos(phiMin);

  function setQualityLevel(level: number) {
    qualityLevel = clamp(level, 0.25, 1);
    const map = qualityLevel >= 0.75 ? 1024 : 512;
    key.shadow.mapSize.set(map, map);
    key.shadow.needsUpdate = true;
    const tCount = Math.floor(treeCount * clamp(0.72 + qualityLevel * 0.28, 0.72, 1));
    trees.trunkInst.count = tCount;
    trees.tier1Inst.count = tCount;
    trees.tier2Inst.count = tCount;
    trees.tier3Inst.count = tCount;
  }

  function start() {
    state = "playing";
    playElapsed = 0;
    gameOverElapsed = 0;
    dangerT = 0;
    inviteGroup.visible = false;
    inviteGroup.position.copy(posterTarget);
    inviteGroup.rotation.set(0, 0, 0);
    inviteGroup.scale.setScalar(1);
    gameGroup.position.set(0, 0, 0);
    recenter();
  }

  function setThrusting(next: boolean) {
    thrusting = next;
  }

  function recenter() {
    velPhi = 0;
    dangerT = 0;
    theta = 0;
    phi = basePhi;
    syncPlayerPose(0);
  }

  function triggerGameOver() {
    if (state !== "playing") return;
    state = "gameover";
    gameOverElapsed = 0;
  }

  function syncPlayerPose(dt: number) {
    // Spherical coordinates around the planet center.
    const orbitSpeed = state === "playing" ? 0.55 : state === "gameover" ? 0.25 : 0.0;
    theta += dt * orbitSpeed;

    orbitOffset.setFromSphericalCoords(orbitRadius, phi, theta);
    playerPos.copy(orbitCenter).add(orbitOffset);
    player.position.copy(playerPos);

    // Face direction of motion (tangent).
    const tx = Math.cos(theta);
    const tz = -Math.sin(theta);
    const yaw = Math.atan2(tx, tz);
    player.rotation.set(0, yaw, 0);

    // Tilt like flappy bird.
    player.rotation.z = MathUtils.clamp(velPhi * 0.55, -0.65, 0.55);
    birdWing.rotation.x = Math.sin(perfT * 10.5) * 0.22;
  }

  let perfT = 0;

  function update(dt: number, t: number) {
    perfT = t;
    // Planet rotation (main motion).
    const targetRotSpeed = state === "gameover" ? 0.25 : 0.38;
    planetGroup.rotation.z += dt * targetRotSpeed;
    planetGroup.rotation.y = Math.sin(t * 0.08) * 0.08;

    if (state === "playing") {
      playElapsed += dt;

      // "Hold to flap": adjust spherical phi (down is increasing phi).
      const upAccel = 1.65;
      const gravity = 1.9;
      const accelPhi = thrusting ? -upAccel : gravity;
      velPhi = clamp(velPhi + accelPhi * dt, -1.35, 1.35);
      velPhi *= Math.pow(0.992, dt * 60);
      phi = clamp(phi + velPhi * dt, phiMin, phiMax);

      // Soft lose condition: only fail if you're out of safe band for a moment.
      const out = Math.abs(phi - basePhi) > boundsPhi;
      dangerT = out ? dangerT + dt : Math.max(0, dangerT - dt * 1.25);
      if (dangerT >= 0.85 || playElapsed >= 20) triggerGameOver();
    }

    if (state !== "gameover") syncPlayerPose(dt);

    if (state === "gameover") {
      gameOverElapsed += dt;

      // Phase 1: drop the world out of view.
      const dropDuration = 0.95;
      const dropT = clamp(gameOverElapsed / dropDuration, 0, 1);
      const dropEased = 1 - Math.pow(1 - dropT, 3);
      gameGroup.position.y = lerp(0, -12.0, dropEased);
      gameGroup.rotation.z = lerp(0, -0.08, dropEased);

      // Fade the bird so the reveal reads cleanly.
      const fade = clamp(dropT * 1.25, 0, 1);
      (birdBody.material as MeshLambertMaterial).transparent = true;
      (birdHead.material as MeshLambertMaterial).transparent = true;
      (birdWing.material as MeshLambertMaterial).transparent = true;
      (birdBody.material as MeshLambertMaterial).opacity = lerp(1, 0.0, fade);
      (birdHead.material as MeshLambertMaterial).opacity = lerp(1, 0.0, fade);
      (birdWing.material as MeshLambertMaterial).opacity = lerp(1, 0.0, fade);

      // Phase 2: flip-spin the card into view (back -> front).
      const revealDelay = 0.05;
      const spinDuration = 1.2;
      const spinT = clamp((gameOverElapsed - dropDuration - revealDelay) / spinDuration, 0, 1);
      if (spinT > 0) inviteGroup.visible = true;

      const spinEased = 1 - Math.pow(1 - spinT, 3);
      const startPos = tmpV.copy(posterTarget).add(new Vector3(0, -0.3, -1.1));
      inviteGroup.position.lerpVectors(startPos, posterTarget, spinEased);
      inviteGroup.rotation.y = lerp(Math.PI, 0.0, spinEased);
      inviteGroup.rotation.x = lerp(0.22, 0.0, spinEased);
      inviteGroup.rotation.z = Math.sin(spinEased * Math.PI) * 0.08;
      inviteGroup.scale.setScalar(lerp(0.92, 1.0, spinEased));
    }

    // Slight sky haze drift.
    if (scene.fog instanceof FogExp2) scene.fog.density = lerp(0.018, 0.024, 0.5 + 0.5 * Math.sin(t * 0.12));

    return state;
  }

  function dispose() {
    envTex.dispose();
    posterTexture.dispose();

    planetGeo.dispose();
    planetTex.dispose();
    planetMat.dispose();

    trees.dispose();
    houses.dispose();
    clouds.dispose();

    inviteGeo.dispose();
    inviteFrontMat.dispose();
    inviteBackMat.dispose();

    birdBody.geometry.dispose();
    (birdBody.material as MeshLambertMaterial).dispose();
    birdHead.geometry.dispose();
    (birdHead.material as MeshLambertMaterial).dispose();
    birdWing.geometry.dispose();
    (birdWing.material as MeshLambertMaterial).dispose();

    root.removeFromParent();
  }

  setQualityLevel(1);

  return {
    orbitCenter,
    posterTarget,
    recenterCameraPos,
    playerYMin,
    playerYMax,
    shouldUsePostFX,
    setQualityLevel,
    start,
    setThrusting,
    recenter,
    triggerGameOver,
    getPlayerPosition: (out: Vector3) => out.copy(player.position),
    update,
    dispose
  };
}

function createLowPolyTrees(count: number) {
  const trunkGeo = new CylinderGeometry(0.06, 0.08, 0.38, 6, 1);
  const tierGeo = new ConeGeometry(0.28, 0.32, 6, 1);

  const trunkMat = new MeshLambertMaterial({ color: new Color(0x6f4a2f) });
  const tier1Mat = new MeshLambertMaterial({ color: new Color(0x3ad37a) });
  const tier2Mat = new MeshLambertMaterial({ color: new Color(0x2bbf68) });
  const tier3Mat = new MeshLambertMaterial({ color: new Color(0x23a85b) });

  const trunkInst = new InstancedMesh(trunkGeo, trunkMat, count);
  const tier1Inst = new InstancedMesh(tierGeo, tier1Mat, count);
  const tier2Inst = new InstancedMesh(tierGeo, tier2Mat, count);
  const tier3Inst = new InstancedMesh(tierGeo, tier3Mat, count);
  trunkInst.castShadow = true;
  trunkInst.receiveShadow = true;
  tier1Inst.castShadow = true;
  tier2Inst.castShadow = true;
  tier3Inst.castShadow = true;
  tier1Inst.receiveShadow = true;
  tier2Inst.receiveShadow = true;
  tier3Inst.receiveShadow = true;

  function dispose() {
    trunkGeo.dispose();
    tierGeo.dispose();
    trunkMat.dispose();
    tier1Mat.dispose();
    tier2Mat.dispose();
    tier3Mat.dispose();
    trunkInst.dispose();
    tier1Inst.dispose();
    tier2Inst.dispose();
    tier3Inst.dispose();
  }

  return { trunkInst, tier1Inst, tier2Inst, tier3Inst, dispose };
}

function createLowPolyHouses(count: number) {
  const baseGeo = new BoxGeometry(0.56, 0.42, 0.52);
  const roofGeo = new ConeGeometry(0.46, 0.36, 4, 1);
  const winGeo = new PlaneGeometry(0.22, 0.16);

  const baseMat = new MeshLambertMaterial({ color: new Color(0xffcf6a) });
  const roofMat = new MeshLambertMaterial({ color: new Color(0xff6bb0) });
  const winMat = new MeshLambertMaterial({ color: new Color(0xffffff) });

  const baseInst = new InstancedMesh(baseGeo, baseMat, count);
  const roofInst = new InstancedMesh(roofGeo, roofMat, count);
  const windowInst = new InstancedMesh(winGeo, winMat, count);
  baseInst.castShadow = true;
  baseInst.receiveShadow = true;
  roofInst.castShadow = true;
  roofInst.receiveShadow = true;
  windowInst.castShadow = false;
  windowInst.receiveShadow = false;

  function dispose() {
    baseGeo.dispose();
    roofGeo.dispose();
    winGeo.dispose();
    baseMat.dispose();
    roofMat.dispose();
    winMat.dispose();
    baseInst.dispose();
    roofInst.dispose();
    windowInst.dispose();
  }

  return { baseInst, roofInst, windowInst, dispose };
}

function createLowPolyClouds(count: number) {
  const cloudGeo = new DodecahedronGeometry(0.35, 0);
  const cloudMat = new MeshLambertMaterial({ color: new Color(0xf6f2e8) });
  const cloudInst = new InstancedMesh(cloudGeo, cloudMat, count);
  cloudInst.castShadow = false;
  cloudInst.receiveShadow = false;

  function dispose() {
    cloudGeo.dispose();
    cloudMat.dispose();
    cloudInst.dispose();
  }

  return { cloudInst, dispose };
}

function createPlanetTexture() {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable.");

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#92e26d");
  g.addColorStop(0.55, "#5fcd71");
  g.addColorStop(1, "#f6e2b6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Soft speckles for “flowers” / texture.
  ctx.globalAlpha = 0.18;
  const dots = [
    { c: "#ff6b5a", n: 280 },
    { c: "#ffd34f", n: 280 },
    { c: "#ffffff", n: 220 }
  ];
  for (const d of dots) {
    ctx.fillStyle = d.c;
    for (let i = 0; i < d.n; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 1 + Math.random() * 2.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function randomPointOnPlanet(radius: number, jitter: number) {
  // Biased toward the “top” hemisphere so the visible area looks populated.
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(clamp(lerp(0.2, 1, v) * 2 - 1, -1, 1));
  const r = radius + (Math.random() * 2 - 1) * jitter;
  return new Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    Math.abs(r * Math.cos(phi)),
    r * Math.sin(phi) * Math.sin(theta)
  );
}
