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
  MeshBasicMaterial,
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
import { createSnowPoints } from "./snow";

export type MysticGlobeWorld = ReturnType<typeof createMysticGlobeWorld>;

type GameState = "idle" | "playing" | "escape" | "gameover";

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
  const skyColor = new Color(0xff849a);
  scene.background = skyColor;
  // Soft fog to blend edges without looking “misty”.
  scene.fog = new FogExp2(skyColor, 0.02);

  const planetRadius = 4.1;
  // Slightly lower to frame the scene “higher” (more sky above the globe).
  // Framing tweak: raise the globe so the horizon is more visible (not top-down view).
  // Camera stays at its position, globe comes up to meet the horizon line.
  const planetCenter = new Vector3(0, -5.5, 4);
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

  // Clouds: orbit around the planet in a *tilted* plane.
  // Reference feel: we roll the whole world around Z, so the cloud pivot also rotates on Z.
  // `cloudRing` keeps a slight tilt on X for depth.
  //
  // Important: because clouds are authored with positions around the origin, we place them
  // under a pivot that is ALSO at the origin (relative to the parent `gameGroup`). Since the
  // planet itself is offset (planetCenter.y), we simply match that offset via cloudPivot.
  const cloudPivot = new Group();
  cloudPivot.position.copy(orbitCenter);

  const cloudRing = new Group();
  cloudRing.rotation.x = 0.35;
  cloudRing.add(clouds.cloudInst);

  cloudPivot.add(cloudRing);
  gameGroup.add(cloudPivot);

  // Snow particles (GPU-friendly Points) to make it feel "winter".
  const snow = createSnowPoints({
    count: isMobile ? 1700 : 3400,
    radius: 13.5,
    height: 9.5,
    // Push towards a colder / bluer snow tint.
    color: 0x1f6dff,
    blend: "diffuse",
    intensity: 1.45
  });
  // Keep the same offset relative to the orbit center even if the globe framing changes.
  snow.points.position.set(orbitCenter.x, orbitCenter.y + 0.85, orbitCenter.z);
  root.add(snow.points);

  // Layout on the planet surface.
  const dummy = new Object3D();
  const up = new Vector3(0, 1, 0);
  const n = new Vector3();
  const tangentYaw = new Vector3();
  const treeTrunkHeight = 0.38;
  const treeTierHeight = 0.32;
  const houseBaseHeight = 0.42;
  const houseDepth = 0.52;
  const houseRoofHeight = 0.36;

  // NOTE: we distribute points with a *minimum separation* so houses don’t stack/overlap.
  // We also apply yaw around the instance’s *local up* (after aligning to the surface normal)
  // to avoid the “randomly tilted sticks/leaves” bug.
  const treeNormals = generateSeparatedSurfaceNormals({
    count: treeCount,
    minAngleRad: 0.12,
    maxAttempts: 22000
  });
  const houseNormals = generateSeparatedSurfaceNormals({
    count: houseCount,
    minAngleRad: 0.58,
    maxAttempts: 22000
  });

  for (let i = 0; i < treeCount; i++) {
    n.copy(treeNormals[i]);
    const s = 0.65 + Math.random() * 0.55;

    // Oriented outward from the planet.
    const trunkScale = s;
    const tier1Scale = s * 1.05;
    const tier2Scale = s * 0.9;
    const tier3Scale = s * 0.78;

    const trunkHeightS = treeTrunkHeight * trunkScale;
    const tier1HeightS = treeTierHeight * tier1Scale;
    const tier2HeightS = treeTierHeight * tier2Scale;
    const tier3HeightS = treeTierHeight * tier3Scale;

    // Slightly sink into the planet so bases don't appear to "float".
    const trunkBottomOffset = -0.09 * s;
    const trunkCenterOffset = trunkBottomOffset + trunkHeightS / 2;
    const trunkTopOffset = trunkBottomOffset + trunkHeightS;

    const tierOverlap = 0.012 * s;
    const tierStack = 0.72;
    const tier1Base = trunkTopOffset - tierOverlap;
    const tier2Base = tier1Base + tier1HeightS * tierStack;
    const tier3Base = tier2Base + tier2HeightS * tierStack;

    const tier1CenterOffset = tier1Base + tier1HeightS / 2;
    const tier2CenterOffset = tier2Base + tier2HeightS / 2;
    const tier3CenterOffset = tier3Base + tier3HeightS / 2;

    dummy.position.copy(n).multiplyScalar(planetRadius + trunkCenterOffset);
    dummy.quaternion.setFromUnitVectors(up, n);
    // Add a random twist around the LOCAL up axis (not world normal) for variety.
    // After setFromUnitVectors, the local Y axis is aligned with the surface normal.
    dummy.rotateY(Math.random() * Math.PI * 2);
    dummy.scale.setScalar(trunkScale);
    dummy.updateMatrix();
    trees.trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.copy(n).multiplyScalar(planetRadius + tier1CenterOffset);
    dummy.scale.setScalar(tier1Scale);
    dummy.updateMatrix();
    trees.tier1Inst.setMatrixAt(i, dummy.matrix);

    dummy.position.copy(n).multiplyScalar(planetRadius + tier2CenterOffset);
    dummy.scale.setScalar(tier2Scale);
    dummy.updateMatrix();
    trees.tier2Inst.setMatrixAt(i, dummy.matrix);

    dummy.position.copy(n).multiplyScalar(planetRadius + tier3CenterOffset);
    dummy.scale.setScalar(tier3Scale);
    dummy.updateMatrix();
    trees.tier3Inst.setMatrixAt(i, dummy.matrix);
  }
  trees.trunkInst.instanceMatrix.needsUpdate = true;
  trees.tier1Inst.instanceMatrix.needsUpdate = true;
  trees.tier2Inst.instanceMatrix.needsUpdate = true;
  trees.tier3Inst.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < houseCount; i++) {
    // Use separated normals so houses don't overlap
    n.copy(houseNormals[i]);
    const s = 0.75 + Math.random() * 0.75;

    // Slightly sink into the planet so bases don't appear to "float".
    const baseBottomOffset = -0.12 * s;
    const baseCenterOffset = baseBottomOffset + (houseBaseHeight * s) / 2;
    const roofOverlap = 0.012 * s;
    const roofCenterOffset = baseBottomOffset + houseBaseHeight * s + (houseRoofHeight * s) / 2 - roofOverlap;
    const windowUpOffset = baseBottomOffset + houseBaseHeight * s * 0.55;
    const windowOutOffset = (houseDepth * s) / 2 + 0.01 * s;

    dummy.position.copy(n).multiplyScalar(planetRadius + baseCenterOffset);
    dummy.quaternion.setFromUnitVectors(up, n);
    // Rotate around local Y axis (aligned with surface normal after setFromUnitVectors)
    const houseYaw = Math.floor(Math.random() * 4) * (Math.PI / 2);
    dummy.rotateY(houseYaw);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    houses.baseInst.setMatrixAt(i, dummy.matrix);

    const baseQuat = dummy.quaternion.clone();

    dummy.position.copy(n).multiplyScalar(planetRadius + roofCenterOffset);
    // Rotate the 4-sided roof so its corners align with the box corners.
    dummy.quaternion.copy(baseQuat);
    dummy.rotateY(Math.PI / 4);
    dummy.updateMatrix();
    houses.roofInst.setMatrixAt(i, dummy.matrix);

    // Window faces "out" a bit: offset along the local forward axis.
    dummy.quaternion.copy(baseQuat);
    tangentYaw.set(0, 0, 1).applyQuaternion(baseQuat);
    dummy.position
      .copy(n)
      .multiplyScalar(planetRadius + windowUpOffset)
      .addScaledVector(tangentYaw, windowOutOffset);
    dummy.updateMatrix();
    houses.windowInst.setMatrixAt(i, dummy.matrix);
  }
  houses.baseInst.instanceMatrix.needsUpdate = true;
  houses.roofInst.instanceMatrix.needsUpdate = true;
  houses.windowInst.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < cloudCount; i++) {
    // Distribute clouds around the full planet so rotation never reveals an empty side.
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const y = 2 * v - 1; // cos(phi) in [-1..1]
    const sinPhi = Math.sqrt(Math.max(0, 1 - y * y));
    const r = 7.2 + Math.random() * 3.2;
    dummy.position.set(r * sinPhi * Math.cos(theta), r * y, r * sinPhi * Math.sin(theta));
    dummy.rotation.set(Math.random() * 0.2, Math.random() * Math.PI * 2, Math.random() * 0.2);
    dummy.scale.setScalar(0.65 + Math.random() * 1.35);
    dummy.updateMatrix();
    clouds.cloudInst.setMatrixAt(i, dummy.matrix);
  }
  clouds.cloudInst.instanceMatrix.needsUpdate = true;

  // Player.
  const player = new Group();
  gameGroup.add(player);
  const plane = new Group();
  player.add(plane);
  plane.scale.setScalar(1.05);

  const planeRadialSeg = isMobile ? 12 : 22;
  const planeSmoothSeg = isMobile ? 14 : 26;

  const fuselageMat = new MeshStandardMaterial({
    color: new Color(0xff6b5a),
    roughness: 0.48,
    metalness: 0.12
  });
  const wingMat = new MeshStandardMaterial({
    color: new Color(0xffffff),
    roughness: 0.68,
    metalness: 0.0
  });
  const accentMat = new MeshStandardMaterial({
    color: new Color(0x19213a),
    roughness: 0.42,
    metalness: 0.18
  });
  const propMat = new MeshStandardMaterial({
    color: new Color(0x2a2a2a),
    roughness: 0.52,
    metalness: 0.15
  });
  const glassMat = new MeshStandardMaterial({
    color: new Color(0x7ad9ff),
    roughness: 0.12,
    metalness: 0.0,
    transparent: true,
    opacity: 0.82
  });

  const planeFadeMats: Array<{ mat: MeshStandardMaterial; baseOpacity: number }> = [
    { mat: fuselageMat, baseOpacity: 1 },
    { mat: wingMat, baseOpacity: 1 },
    { mat: accentMat, baseOpacity: 1 },
    { mat: propMat, baseOpacity: 1 },
    { mat: glassMat, baseOpacity: glassMat.opacity }
  ];

  const fuselage = new Mesh(
    new CylinderGeometry(0.105, 0.125, 0.54, planeRadialSeg, 1, false),
    fuselageMat
  );
  fuselage.rotation.z = -Math.PI / 2;
  fuselage.castShadow = true;
  plane.add(fuselage);

  const nose = new Mesh(new ConeGeometry(0.125, 0.16, planeRadialSeg, 1, false), fuselageMat);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.35, 0, 0);
  nose.castShadow = true;
  plane.add(nose);

  const tail = new Mesh(new ConeGeometry(0.11, 0.14, planeRadialSeg, 1, false), fuselageMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-0.34, 0, 0);
  tail.castShadow = true;
  plane.add(tail);

  const cockpit = new Mesh(new SphereGeometry(0.105, planeSmoothSeg, planeSmoothSeg), glassMat);
  cockpit.position.set(0.05, 0.085, 0);
  cockpit.scale.set(1, 0.85, 0.95);
  cockpit.castShadow = true;
  plane.add(cockpit);

  const wingLeft = new Mesh(new BoxGeometry(0.22, 0.03, 0.56), wingMat);
  wingLeft.position.set(-0.02, -0.02, -0.31);
  wingLeft.rotation.x = 0.08;
  wingLeft.castShadow = true;
  plane.add(wingLeft);

  const wingRight = new Mesh(new BoxGeometry(0.22, 0.03, 0.56), wingMat);
  wingRight.position.set(-0.02, -0.02, 0.31);
  wingRight.rotation.x = -0.08;
  wingRight.castShadow = true;
  plane.add(wingRight);

  const tailWing = new Mesh(new BoxGeometry(0.12, 0.02, 0.34), wingMat);
  tailWing.position.set(-0.34, 0.03, 0);
  tailWing.castShadow = true;
  plane.add(tailWing);

  const fin = new Mesh(new BoxGeometry(0.1, 0.14, 0.02), accentMat);
  fin.position.set(-0.37, 0.1, 0);
  fin.castShadow = true;
  plane.add(fin);

  const propeller = new Group();
  propeller.position.set(0.44, 0, 0);
  plane.add(propeller);

  const hub = new Mesh(new CylinderGeometry(0.035, 0.035, 0.065, planeRadialSeg, 1, false), propMat);
  hub.rotation.z = -Math.PI / 2;
  hub.castShadow = true;
  propeller.add(hub);

  const bladeZ = new Mesh(new BoxGeometry(0.01, 0.05, 0.5), propMat);
  bladeZ.castShadow = true;
  propeller.add(bladeZ);

  const bladeY = new Mesh(new BoxGeometry(0.01, 0.5, 0.05), propMat);
  bladeY.castShadow = true;
  propeller.add(bladeY);

  // Invitation card (revealed after the world drops).
  // A4 portrait plane: width/height = 210/297 ≈ 0.707.
  const a4Height = 1.38;
  const a4Width = a4Height * (210 / 297);
  const inviteGeo = new PlaneGeometry(a4Width, a4Height, 1, 1);
  // Use an unlit material so the poster doesn't get a “white cast” from scene lighting.
  const inviteFrontMat = new MeshBasicMaterial({
    map: posterTexture,
    toneMapped: false
  });
  const inviteBackMat = new MeshBasicMaterial({
    color: new Color(0x0b0d1e),
    side: DoubleSide,
    toneMapped: false
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
  let state: GameState = "idle";
  let playElapsed = 0;
  let gameOverElapsed = 0;
  let escapeElapsed = 0;
  let escapeCharge = 0;
  let didEscape = false;

  const playerPos = new Vector3(0, 0, 0);
  const tmpV = new Vector3();
  const escapeStart = new Vector3();
  const escapeEnd = new Vector3();
  let escapeStartRotX = 0;
  let escapeStartRotY = 0;
  let escapeWobble = 0;

  // 2D-ish motion: player moves only on Y; the world motion comes from rolling the planet.
  const playerX = 0;
  // Keep the player visually "above" the globe: sit further out from the planet.
  const playerZ = planetRadius + 1.6;

  const baseY = 1.25;
  // Keep the plane from dipping fully down into the globe framing.
  const playerYMin = baseY - 0.55;
  // Allow extra headroom so you can fly high enough to "leave" the globe view.
  const playerYMax = baseY + 5.1;
  const softCeilingY = baseY + 3.85;

  // Airplane-style "lift": taps add lift, lift decays back to cruise.
  let lift = 0;
  let liftDecayHold = 0;
  let enginePulse = 0;

  // Current y position (smoothed toward a target for less "flappy" motion).
  let y = baseY;
  let yVel = 0;
  let targetAltitude = baseY;

  // Smooth pitch for realistic nose-first rotation.
  let smoothPitch = 0;

  // Visual framing: drop the planet a bit during gameplay so the plane sits more in "air".
  let planetPlayDrop = 0;

  function setQualityLevel(level: number) {
    qualityLevel = clamp(level, 0.25, 1);
    const map = qualityLevel >= 0.75 ? 1024 : 512;
    key.shadow.mapSize.set(map, map);
    key.shadow.needsUpdate = true;
    snow.setQuality(qualityLevel);
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
    escapeElapsed = 0;
    escapeCharge = 0;
    didEscape = false;
    lift = 0;
    liftDecayHold = 0;
    enginePulse = 0;
    targetAltitude = baseY;
    planetPlayDrop = 0;
    inviteGroup.visible = false;
    inviteGroup.position.copy(posterTarget);
    inviteGroup.rotation.set(0, 0, 0);
    inviteGroup.scale.setScalar(1);
    gameGroup.position.set(0, 0, 0);
    for (const { mat, baseOpacity } of planeFadeMats) {
      mat.transparent = baseOpacity < 1;
      mat.opacity = baseOpacity;
    }
    recenter();
  }

  function recenter() {
    y = baseY;
    yVel = 0;
    lift = 0;
    liftDecayHold = 0;
    enginePulse = 0;
    targetAltitude = baseY;
    planetPlayDrop = 0;
    escapeCharge = 0;
    smoothPitch = 0;
    syncPlayerPose(0);
  }

  function flap() {
    if (state !== "playing") return;
    // Taps add lift (progress) and a short engine pulse.
    // Tuned so you need several taps to climb high enough.
    lift = clamp(lift + 0.22, 0, 1);
    liftDecayHold = 0.35;
    enginePulse = 1;
  }

  function triggerGameOver() {
    if (state !== "playing") return;
    state = "gameover";
    gameOverElapsed = 0;
  }

  function triggerEscape() {
    if (state !== "playing") return;
    state = "escape";
    escapeElapsed = 0;
    escapeCharge = 0;
    didEscape = true;
    playerPos.set(playerX, y, playerZ);
    player.position.copy(playerPos);
    escapeStart.copy(player.position);
    escapeStartRotX = player.rotation.x;
    escapeStartRotY = player.rotation.y;
    escapeWobble = (Math.random() * 2 - 1) * 0.9;
    escapeEnd
      .copy(escapeStart)
      .add(new Vector3(7.2, 3.1, -5.8))
      .add(new Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2));
    targetAltitude = baseY + Math.max(0, playerYMax - baseY - 0.25);
  }

  function syncPlayerPose(dt: number) {
    // 2D-ish: fixed depth; only vertical motion.
    playerPos.set(playerX, y, playerZ);
    player.position.copy(playerPos);

    // Player model points along +X, so yaw=0 faces screen-right.
    player.rotation.set(0, 0, 0);

    // Realistic airplane pitch: nose tilts up first when climbing.
    // Positive rotation.z = nose up, negative = nose down.
    const climbIndicator = clamp(yVel * 0.6 + (targetAltitude - y) * 1.8, -3.5, 3.5);
    const targetPitch = MathUtils.clamp(climbIndicator * 0.12, -0.32, 0.45);

    // Smooth pitch that leads the motion (pitch up responds faster than pitch down).
    const followRate = targetPitch > smoothPitch ? 9.0 : 5.0;
    const follow = dt > 0 ? 1 - Math.exp(-dt * followRate) : 1;
    smoothPitch = lerp(smoothPitch, targetPitch, follow);

    player.rotation.z = smoothPitch;

    // Keep wings stable (no flapping), with a tiny "engine vibration".
    const vib = (0.006 + 0.01 * enginePulse) * Math.sin(perfT * 18.0);
    wingLeft.rotation.x = 0.08 + vib;
    wingRight.rotation.x = -0.08 - vib;
  }

  let perfT = 0;

  function update(dt: number, t: number) {
    perfT = t;

    // Shift the globe down during play/escape (plane stays where it is).
    const dropTarget = state === "playing" || state === "escape" ? 0.42 : 0;
    const dropFollow = 1 - Math.exp(-dt * 3.2);
    planetPlayDrop = lerp(planetPlayDrop, dropTarget, dropFollow);
    planetGroup.position.y = planetCenter.y - planetPlayDrop;
    cloudPivot.position.y = orbitCenter.y - planetPlayDrop;
    snow.points.position.y = orbitCenter.y + 0.85 - planetPlayDrop;
    key.target.position.set(planetCenter.x, planetCenter.y - planetPlayDrop + 1.2, planetCenter.z);
    warmFill.position.set(planetCenter.x, planetCenter.y - planetPlayDrop + 4.2, planetCenter.z + 4.0);

    // Planet rotation (main motion).
    // Reference feel: roll the world around Z (like a wheel), while the bird moves up/down.
    const targetRotSpeed = state === "gameover" ? 0.25 : state === "escape" ? 0.2 : 0.38;
    planetGroup.rotation.z += dt * targetRotSpeed;

    // Clouds roll with the world (same axis & speed) for coherence.
    cloudPivot.rotation.z += dt * targetRotSpeed;

    snow.update(dt, t);

    if (state === "playing") {
      playElapsed += dt;

      // Lift decays back to 0 (cruise) unless you keep tapping.
      if (liftDecayHold > 0) liftDecayHold = Math.max(0, liftDecayHold - dt);
      const decay = liftDecayHold > 0 ? 0.08 : 0.24;
      lift = Math.max(0, lift - decay * dt);
      enginePulse = Math.max(0, enginePulse - dt * 3.0);

      // Smoothly follow a target altitude derived from lift.
      // This avoids the "flappy bird" feel while still requiring repeated taps.
      const altitudeRange = Math.max(0, playerYMax - baseY - 0.32);
      const targetY = baseY + clamp(lift * altitudeRange, 0, altitudeRange);
      targetAltitude = targetY;
      const stiffness = 16;
      const damping = 8.5;
      yVel += (targetY - y) * stiffness * dt;
      yVel *= Math.exp(-damping * dt);
      y += yVel * dt;

      if (y <= playerYMin) {
        y = playerYMin;
        yVel = Math.max(0, yVel);
      }
      if (y >= softCeilingY) {
        const ceilingT = clamp((y - softCeilingY) / Math.max(1e-6, playerYMax - softCeilingY), 0, 1);
        yVel += (-7.2 * ceilingT) * dt;
      }
      if (y >= playerYMax) {
        y = playerYMax;
        yVel = Math.min(0, yVel);
      }

      // If you climb high enough, fly away and reveal the invite.
      const escapeLift = 0.92;
      if (lift >= escapeLift) {
        escapeCharge += dt;
      } else {
        escapeCharge = Math.max(0, escapeCharge - dt * 2.6);
      }
      if (escapeCharge >= 0.85) triggerEscape();

      // Fail-safe: auto-finish into invite after a while.
      if (playElapsed >= 90) triggerGameOver();
    }

    if (state === "playing") syncPlayerPose(dt);

    if (state === "escape") {
      escapeElapsed += dt;
      // Slower, more graceful escape animation
      const escapeDuration = 3.2;
      const u = clamp(escapeElapsed / escapeDuration, 0, 1);
      
      // Use a smoother easing curve for more natural flight
      const eased = u < 0.5 
        ? 2 * u * u  // Ease in for first half
        : 1 - Math.pow(-2 * u + 2, 2) / 2;  // Ease out for second half

      player.position.lerpVectors(escapeStart, escapeEnd, eased);
      // Add a gentle, smooth arc for realistic climb path
      const arc = Math.sin(u * Math.PI);
      const arcHeight = arc * 1.2;  // Slightly higher arc
      player.position.y += arcHeight;
      player.position.z += arc * (-0.4);  // Gentler depth change

      // Realistic airplane rotation: nose pitches UP during climb (positive Z)
      player.rotation.set(0, 0, 0);
      
      // Gentle roll tilt (x rotation) - very subtle
      player.rotation.x = lerp(escapeStartRotX, 0.15, eased) + arc * 0.03 * escapeWobble;
      
      // Yaw turn (y rotation) - plane banks slightly as it turns away
      player.rotation.y = lerp(escapeStartRotY, 0.65, eased);
      
      // Pitch (z rotation) - NOSE UP during climb, then gradually levels off
      // Start from current pitch, climb with nose up, then level out at the end
      const climbPitch = smoothPitch;  // Use the current smooth pitch as starting point
      const peakPitch = 0.55;  // Nose up during climb (positive = nose up)
      const endPitch = 0.25;   // Slightly nose up at the end
      
      // Pitch follows a natural climb pattern: increase during ascent, decrease at peak
      const pitchCurve = u < 0.4 
        ? lerp(climbPitch, peakPitch, u / 0.4)  // Pitch up during initial climb
        : lerp(peakPitch, endPitch, (u - 0.4) / 0.6);  // Gradually level off
      
      player.rotation.z = pitchCurve + arc * 0.04 * escapeWobble;

      // Gentle wing movement
      const flex = Math.sin((t + escapeElapsed) * 12.0) * 0.05 + (1 - eased) * 0.08;
      wingLeft.rotation.x = 0.08 + flex;
      wingRight.rotation.x = -0.08 - flex;

      // Slower fade out - starts later and takes longer
      const fade = clamp((u - 0.4) / 0.55, 0, 1);
      for (const { mat, baseOpacity } of planeFadeMats) {
        mat.transparent = true;
        mat.opacity = lerp(baseOpacity, 0.0, fade);
      }

      if (u >= 1) {
        state = "gameover";
        gameOverElapsed = 0;
      }
    }

    if (state === "gameover") {
      gameOverElapsed += dt;

      // Phase 1: drop the world out of view.
      const dropDuration = didEscape ? 0.55 : 0.95;
      const dropT = clamp(gameOverElapsed / dropDuration, 0, 1);
      const dropEased = 1 - Math.pow(1 - dropT, 3);
      gameGroup.position.y = lerp(0, didEscape ? -8.5 : -12.0, dropEased);
      gameGroup.rotation.z = lerp(0, didEscape ? -0.05 : -0.08, dropEased);

      // Fade the bird so the reveal reads cleanly.
      const fade = clamp(dropT * 1.25, 0, 1);
      for (const { mat, baseOpacity } of planeFadeMats) {
        mat.transparent = true;
        mat.opacity = lerp(baseOpacity, 0.0, fade);
      }

      // Phase 2: flip-spin the card into view (back -> front).
      const revealDelay = 0.05;
      const spinDuration = 1.2;
      const spinT = clamp((gameOverElapsed - dropDuration - revealDelay) / spinDuration, 0, 1);
      if (spinT > 0) inviteGroup.visible = true;

      const spinEased = 1 - Math.pow(1 - spinT, 3);
      const startPos = tmpV.copy(posterTarget).add(new Vector3(0, -0.3, -1.1));
      inviteGroup.position.lerpVectors(startPos, posterTarget, spinEased);
      const spinStartY = didEscape ? Math.PI * 5 : Math.PI;
      inviteGroup.rotation.y = lerp(spinStartY, 0.0, spinEased);
      inviteGroup.rotation.x = lerp(0.22, 0.0, spinEased);
      inviteGroup.rotation.z = Math.sin(spinEased * Math.PI) * 0.08;
      inviteGroup.scale.setScalar(lerp(0.92, 1.0, spinEased));
    }

    // Slight sky haze drift.
    if (scene.fog instanceof FogExp2) scene.fog.density = lerp(0.018, 0.024, 0.5 + 0.5 * Math.sin(t * 0.12));

    // Propeller spin (faster right after taps / during escape).
    const thrustNow = state === "escape" || enginePulse > 0.12 || yVel > 0.9;
    const propSpeed = lerp(14, 26, qualityLevel) * (thrustNow ? 1.35 : 0.75);
    propeller.rotation.x += dt * propSpeed;

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
    snow.dispose();

    inviteGeo.dispose();
    inviteFrontMat.dispose();
    inviteBackMat.dispose();

    fuselage.geometry.dispose();
    nose.geometry.dispose();
    tail.geometry.dispose();
    cockpit.geometry.dispose();
    wingLeft.geometry.dispose();
    wingRight.geometry.dispose();
    tailWing.geometry.dispose();
    fin.geometry.dispose();
    hub.geometry.dispose();
    bladeZ.geometry.dispose();
    bladeY.geometry.dispose();

    fuselageMat.dispose();
    wingMat.dispose();
    accentMat.dispose();
    propMat.dispose();
    glassMat.dispose();

    root.removeFromParent();
  }

  setQualityLevel(1);

  return {
    orbitCenter,
    posterTarget,
    posterWidth: a4Width,
    posterHeight: a4Height,
    recenterCameraPos,
    playerYMin,
    playerYMax,
    shouldUsePostFX,
    setQualityLevel,
    start,
    flap,
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

  // Base green gradient
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#92e26d");
  g.addColorStop(0.55, "#5fcd71");
  g.addColorStop(1, "#f6e2b6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Add light-blue snow patches scattered across the globe
  // These create a wintery feel with soft, organic shapes
  ctx.globalAlpha = 0.35;
  const snowColors = ["#b8e4f9", "#d0ecfa", "#c5e8fc"]; // light blue snow tints
  for (let i = 0; i < 45; i++) {
    const snowColor = snowColors[Math.floor(Math.random() * snowColors.length)];
    ctx.fillStyle = snowColor;
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    // Draw irregular snow patches using multiple overlapping circles
    const patchSize = 12 + Math.random() * 28;
    const numBlobs = 3 + Math.floor(Math.random() * 5);
    for (let j = 0; j < numBlobs; j++) {
      const bx = cx + (Math.random() - 0.5) * patchSize * 0.8;
      const by = cy + (Math.random() - 0.5) * patchSize * 0.6;
      const br = patchSize * (0.3 + Math.random() * 0.4);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Soft speckles for "flowers" / texture.
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

  // Add additional small light-blue snow dots for fine detail
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#c8eafc";
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 1.5 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates `count` unit normals (surface directions) on a sphere with a minimum
 * angular separation so that objects placed at those locations won't overlap.
 * Uses rejection sampling with a fallback to random if attempts are exhausted.
 */
function generateSeparatedSurfaceNormals(opts: {
  count: number;
  minAngleRad: number;
  maxAttempts: number;
}): Vector3[] {
  const { count, minAngleRad, maxAttempts } = opts;
  const result: Vector3[] = [];
  const minDot = Math.cos(minAngleRad); // dot threshold for "too close"

  for (let i = 0; i < count; i++) {
    let candidate: Vector3 | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Uniform point on unit sphere
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const cosP = 2 * v - 1;
      const sinP = Math.sqrt(Math.max(0, 1 - cosP * cosP));
      const c = new Vector3(sinP * Math.cos(theta), cosP, sinP * Math.sin(theta));

      // Check against all existing normals
      let valid = true;
      for (const existing of result) {
        if (c.dot(existing) > minDot) {
          valid = false;
          break;
        }
      }
      if (valid) {
        candidate = c;
        break;
      }
    }
    // Fallback: if we can't find a valid spot, just use the last attempt
    if (!candidate) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const cosP = 2 * v - 1;
      const sinP = Math.sqrt(Math.max(0, 1 - cosP * cosP));
      candidate = new Vector3(sinP * Math.cos(theta), cosP, sinP * Math.sin(theta));
    }
    result.push(candidate);
  }
  return result;
}
