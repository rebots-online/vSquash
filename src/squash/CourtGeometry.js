// ============================================================================
// ARGON SQUASH — COURT GEOMETRY & TACTICAL FLOOR OVERLAY
// Canonical World Coordinates:
//   Front Wall: Z = -4.875m | Back Wall: Z = +4.875m | Width: X in [-3.20m, +3.20m]
//   Short Line: Z = +0.565m (5.44m from Front Wall, 4.31m from Back Wall)
//   Canonical T-Position: (0, 0, +0.92m)
// ============================================================================

import * as THREE from 'three';

export const COURT_SPECS = Object.freeze({
  LENGTH: 9.75,
  HALF_LENGTH: 4.875,
  FRONT_WALL_Z: -4.875,
  BACK_WALL_Z: 4.875,
  WIDTH: 6.40,
  HALF_WIDTH: 3.20,
  LEFT_WALL_X: -3.20,
  RIGHT_WALL_X: 3.20,
  FRONT_WALL_OUT_Y: 4.57,
  BACK_WALL_OUT_Y: 2.13,
  SERVICE_LINE_Y: 1.78,
  TIN_HEIGHT_Y: 0.48,
  SHORT_LINE_Z: 0.565,
  SERVICE_BOX_SIZE: 1.60,
  T_INTERSECTION: Object.freeze({ x: 0, y: 0, z: 0.565 }),
  T_POS: Object.freeze({ x: 0, y: 0, z: 0.92 }),
  LINE_WIDTH: 0.05,
  BALL_RADIUS: 0.020
});

export function getSideWallOutHeightAtZ(z) {
  const t = THREE.MathUtils.clamp(
    (z - COURT_SPECS.FRONT_WALL_Z) / COURT_SPECS.LENGTH,
    0,
    1
  );
  return THREE.MathUtils.lerp(COURT_SPECS.FRONT_WALL_OUT_Y, COURT_SPECS.BACK_WALL_OUT_Y, t);
}

function createHardwoodFloorTexture(theme = 'psa_glass') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  if (theme === 'neon_studio') {
    ctx.fillStyle = '#0c1322';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 512; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 0; y <= 512; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
  } else if (theme === 'hardwood_club') {
    ctx.fillStyle = '#d8a878';
    ctx.fillRect(0, 0, 512, 512);
    const planks = 16;
    const w = 512 / planks;
    for (let i = 0; i < planks; i++) {
      const shade = (i % 3 === 0 ? -8 : i % 2 === 0 ? 5 : 0);
      ctx.fillStyle = `rgb(${214 + shade}, ${166 + shade}, ${118 + shade})`;
      ctx.fillRect(i * w, 0, w - 1, 512);
      ctx.fillStyle = 'rgba(90, 55, 25, 0.16)';
      ctx.fillRect((i + 1) * w - 1, 0, 1, 512);
    }
  } else {
    // PSA Glass Show-Court: matte tournament sapphire-slate wood grain
    ctx.fillStyle = '#1c3554';
    ctx.fillRect(0, 0, 512, 512);
    const planks = 16;
    const w = 512 / planks;
    for (let i = 0; i < planks; i++) {
      const delta = (i % 3 === 0 ? -5 : i % 2 === 0 ? 4 : 0);
      ctx.fillStyle = `rgb(${28 + delta}, ${54 + delta}, ${86 + delta})`;
      ctx.fillRect(i * w, 0, w - 1, 512);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect((i + 1) * w - 1, 0, 1, 512);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 6);
  return tex;
}

export class CourtGeometry {
  constructor(scene, renderer, options = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.theme = options.theme || 'psa_glass';
    this.tinHeight = options.tinHeight || COURT_SPECS.TIN_HEIGHT_Y;

    this.root = new THREE.Group();
    this.root.name = 'ArgonSquashCourt';
    this.materials = {};
    this.lineMeshes = [];
    this.wallImpactRings = [];
    this.bounceSpots = [];
    this.tGuideGroup = new THREE.Group();
    this.tRecoveryArrow = null;
    this.tTargetRing = null;
    this.tinMesh = null;
    this.tinBorderLine = null;
  }

  build() {
    this._createMaterials();
    this._buildArenaBackdrop();
    this._buildCourtFloor();
    this._buildWallsAndTin();
    this._buildCourtMarkings();
    this._buildTZoneGuide();
    this._buildImpactIndicators();
    this.applyTheme(this.theme);
    this.scene.add(this.root);
    return this.root;
  }

  _createMaterials() {
    this.materials.floor = new THREE.MeshStandardMaterial({
      map: createHardwoodFloorTexture(this.theme),
      roughness: 0.58,
      metalness: 0.06
    });

    this.materials.arenaFloor = new THREE.MeshStandardMaterial({
      color: 0x09101c,
      roughness: 0.85,
      metalness: 0.1
    });

    this.materials.frontWall = new THREE.MeshPhysicalMaterial({
      color: 0x162c46,
      roughness: 0.25,
      metalness: 0.08,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25
    });

    this.materials.sideWall = new THREE.MeshPhysicalMaterial({
      color: 0x1c3858,
      transparent: true,
      opacity: 0.42,
      roughness: 0.18,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.materials.backGlass = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      roughness: 0.12,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.materials.tinPlate = new THREE.MeshStandardMaterial({
      color: 0xd9dee8,
      roughness: 0.35,
      metalness: 0.55
    });

    this.materials.tinRedStrip = new THREE.MeshBasicMaterial({
      color: 0xef4444
    });

    this.materials.courtLine = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

    this.materials.outLine = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

    this.materials.structuralFrame = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.4,
      metalness: 0.75
    });
  }

  _buildArenaBackdrop() {
    const arenaFloorGeo = new THREE.PlaneGeometry(46, 46);
    arenaFloorGeo.rotateX(-Math.PI / 2);
    const arenaFloor = new THREE.Mesh(arenaFloorGeo, this.materials.arenaFloor);
    arenaFloor.position.y = -0.015;
    arenaFloor.receiveShadow = true;
    this.root.add(arenaFloor);
  }

  _buildCourtFloor() {
    const floorGeo = new THREE.PlaneGeometry(COURT_SPECS.WIDTH, COURT_SPECS.LENGTH);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMesh = new THREE.Mesh(floorGeo, this.materials.floor);
    floorMesh.position.y = 0.0;
    floorMesh.receiveShadow = true;
    this.root.add(floorMesh);
  }

  _buildWallsAndTin() {
    const W = COURT_SPECS.WIDTH;
    const L = COURT_SPECS.LENGTH;
    const frontH = 5.2;
    const backH = COURT_SPECS.BACK_WALL_OUT_Y;

    // 1. Front Wall (Z = -4.875m)
    const frontWallGeo = new THREE.BoxGeometry(W + 0.16, frontH, 0.14);
    const frontWall = new THREE.Mesh(frontWallGeo, this.materials.frontWall);
    frontWall.position.set(0, frontH * 0.5, COURT_SPECS.FRONT_WALL_Z - 0.07);
    frontWall.receiveShadow = true;
    frontWall.castShadow = true;
    this.root.add(frontWall);

    // 2. Tin Plate on Front Wall (Y in [0, tinHeight])
    const tinGeo = new THREE.BoxGeometry(W, this.tinHeight, 0.035);
    this.tinMesh = new THREE.Mesh(tinGeo, this.materials.tinPlate);
    this.tinMesh.position.set(0, this.tinHeight * 0.5, COURT_SPECS.FRONT_WALL_Z + 0.018);
    this.tinMesh.receiveShadow = true;
    this.root.add(this.tinMesh);

    const tinBevelGeo = new THREE.BoxGeometry(W, 0.05, 0.045);
    this.tinBorderLine = new THREE.Mesh(tinBevelGeo, this.materials.tinRedStrip);
    this.tinBorderLine.position.set(0, this.tinHeight, COURT_SPECS.FRONT_WALL_Z + 0.022);
    this.root.add(this.tinBorderLine);

    // 3. Sloped Side Walls (X = -3.20m and X = +3.20m)
    const buildSideWallGeometry = () => {
      const shape = new THREE.Shape();
      // Local X will map to world Z (-4.875 to +4.875)
      shape.moveTo(-COURT_SPECS.HALF_LENGTH, 0);
      shape.lineTo(COURT_SPECS.HALF_LENGTH, 0);
      shape.lineTo(COURT_SPECS.HALF_LENGTH, backH);
      shape.lineTo(-COURT_SPECS.HALF_LENGTH, COURT_SPECS.FRONT_WALL_OUT_Y);
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      return geo;
    };

    const leftWallGeo = buildSideWallGeometry();
    leftWallGeo.rotateY(Math.PI / 2);
    // Note: after rotateY(+PI/2), shape X (+4.875) points to -Z, so we flip X in shape or rotateY(-PI/2)
    const sideShape = new THREE.Shape();
    sideShape.moveTo(COURT_SPECS.FRONT_WALL_Z, 0);
    sideShape.lineTo(COURT_SPECS.BACK_WALL_Z, 0);
    sideShape.lineTo(COURT_SPECS.BACK_WALL_Z, backH);
    sideShape.lineTo(COURT_SPECS.FRONT_WALL_Z, COURT_SPECS.FRONT_WALL_OUT_Y);
    sideShape.closePath();

    const sideGeo = new THREE.ShapeGeometry(sideShape);
    // Convert (x=Z, y=Y, z=0) -> (x=0, y=Y, z=Z)
    const posAttr = sideGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const zCoord = posAttr.getX(i);
      const yCoord = posAttr.getY(i);
      posAttr.setXYZ(i, 0, yCoord, zCoord);
    }
    sideGeo.computeVertexNormals();

    const leftWall = new THREE.Mesh(sideGeo, this.materials.sideWall);
    leftWall.position.x = COURT_SPECS.LEFT_WALL_X;
    leftWall.renderOrder = 2;
    this.root.add(leftWall);

    const rightWall = new THREE.Mesh(sideGeo, this.materials.sideWall);
    rightWall.position.x = COURT_SPECS.RIGHT_WALL_X;
    rightWall.renderOrder = 2;
    this.root.add(rightWall);

    // 4. Back Glass Wall (Z = +4.875m, height = 2.13m)
    const backWallGeo = new THREE.PlaneGeometry(W, backH);
    const backWall = new THREE.Mesh(backWallGeo, this.materials.backGlass);
    backWall.position.set(0, backH * 0.5, COURT_SPECS.BACK_WALL_Z);
    backWall.renderOrder = 3;
    this.root.add(backWall);

    // 5. Architectural Glass Fin Posts at Corners & Mid-Wall
    const postGeo = new THREE.BoxGeometry(0.12, frontH, 0.18);
    [-COURT_SPECS.HALF_WIDTH - 0.06, COURT_SPECS.HALF_WIDTH + 0.06].forEach((px) => {
      const frontPost = new THREE.Mesh(postGeo, this.materials.structuralFrame);
      frontPost.position.set(px, frontH * 0.5, COURT_SPECS.FRONT_WALL_Z);
      this.root.add(frontPost);

      const backPostGeo = new THREE.BoxGeometry(0.10, backH, 0.14);
      const backPost = new THREE.Mesh(backPostGeo, this.materials.structuralFrame);
      backPost.position.set(px, backH * 0.5, COURT_SPECS.BACK_WALL_Z);
      this.root.add(backPost);
    });
  }

  _buildCourtMarkings() {
    const lw = COURT_SPECS.LINE_WIDTH;
    const W = COURT_SPECS.WIDTH;
    const shortZ = COURT_SPECS.SHORT_LINE_Z;
    const backZ = COURT_SPECS.BACK_WALL_Z;

    const addFloorStrip = (cx, cz, width, length) => {
      const geo = new THREE.PlaneGeometry(width, length);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.materials.courtLine);
      mesh.position.set(cx, 0.004, cz);
      mesh.renderOrder = 1;
      this.root.add(mesh);
      this.lineMeshes.push(mesh);
    };

    // 1. Short Line (Z = +0.565m across full width)
    addFloorStrip(0, shortZ, W, lw);

    // 2. Half-Court Line (X = 0, from Short Line Z=+0.565m to Back Wall Z=+4.875m)
    const halfLen = backZ - shortZ;
    addFloorStrip(0, shortZ + halfLen * 0.5, lw, halfLen);

    // 3. Left & Right Service Boxes (1.60m x 1.60m inside rear corners of Short Line)
    const boxSize = COURT_SPECS.SERVICE_BOX_SIZE;
    const boxRearZ = shortZ + boxSize;
    // Left Service Box inner X = -3.20 + 1.60 = -1.60
    addFloorStrip(-COURT_SPECS.HALF_WIDTH + boxSize * 0.5, boxRearZ, boxSize, lw);
    addFloorStrip(-COURT_SPECS.HALF_WIDTH + boxSize, shortZ + boxSize * 0.5, lw, boxSize);

    // Right Service Box inner X = +3.20 - 1.60 = +1.60
    addFloorStrip(COURT_SPECS.HALF_WIDTH - boxSize * 0.5, boxRearZ, boxSize, lw);
    addFloorStrip(COURT_SPECS.HALF_WIDTH - boxSize, shortZ + boxSize * 0.5, lw, boxSize);

    // 4. Front Wall Service Line (Y = 1.78m) & Out Line (Y = 4.57m)
    const serviceLineGeo = new THREE.BoxGeometry(W, lw, 0.02);
    const serviceLine = new THREE.Mesh(serviceLineGeo, this.materials.courtLine);
    serviceLine.position.set(0, COURT_SPECS.SERVICE_LINE_Y, COURT_SPECS.FRONT_WALL_Z + 0.01);
    this.root.add(serviceLine);

    const frontOutGeo = new THREE.BoxGeometry(W, lw * 1.2, 0.025);
    const frontOut = new THREE.Mesh(frontOutGeo, this.materials.outLine);
    frontOut.position.set(0, COURT_SPECS.FRONT_WALL_OUT_Y, COURT_SPECS.FRONT_WALL_Z + 0.012);
    this.root.add(frontOut);

    // 5. Back Wall Out Line (Y = 2.13m, Z = +4.875m)
    const backOutGeo = new THREE.BoxGeometry(W, lw, 0.025);
    const backOut = new THREE.Mesh(backOutGeo, this.materials.outLine);
    backOut.position.set(0, COURT_SPECS.BACK_WALL_OUT_Y, COURT_SPECS.BACK_WALL_Z);
    this.root.add(backOut);

    // 6. Sloped Side Wall Out Lines
    const dZ = COURT_SPECS.LENGTH;
    const dY = COURT_SPECS.FRONT_WALL_OUT_Y - COURT_SPECS.BACK_WALL_OUT_Y;
    const slopeLen = Math.hypot(dZ, dY);
    const slopeAngle = Math.atan2(dY, dZ);
    const sideOutGeo = new THREE.BoxGeometry(0.025, lw * 1.1, slopeLen);

    [-COURT_SPECS.HALF_WIDTH, COURT_SPECS.HALF_WIDTH].forEach((sx) => {
      const sideOut = new THREE.Mesh(sideOutGeo, this.materials.outLine);
      sideOut.position.set(
        sx,
        (COURT_SPECS.FRONT_WALL_OUT_Y + COURT_SPECS.BACK_WALL_OUT_Y) * 0.5,
        0
      );
      sideOut.rotation.x = slopeAngle;
      this.root.add(sideOut);
    });
  }

  _buildTZoneGuide() {
    this.tGuideGroup.position.set(0, 0.008, 0);

    // Subtle T-Pos target ring at (0, 0, +0.92m)
    const ringGeo = new THREE.RingGeometry(0.32, 0.42, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.tTargetRing = new THREE.Mesh(ringGeo, ringMat);
    this.tTargetRing.position.set(COURT_SPECS.T_POS.x, 0, COURT_SPECS.T_POS.z);
    this.tGuideGroup.add(this.tTargetRing);

    // Dynamic recovery line from player to T-Pos
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, COURT_SPECS.T_POS.z),
      new THREE.Vector3(0, 0.01, COURT_SPECS.T_POS.z)
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.55
    });
    this.tRecoveryArrow = new THREE.Line(lineGeo, lineMat);
    this.tGuideGroup.add(this.tRecoveryArrow);

    this.root.add(this.tGuideGroup);
  }

  _buildImpactIndicators() {
    // Wall & Floor bounce diagnostic spots
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.RingGeometry(0.06, 0.16, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.root.add(mesh);
      this.wallImpactRings.push({ mesh, age: 0, maxAge: 0.65, active: false });
    }
  }

  setTinHeight(tinHeightMeters) {
    this.tinHeight = THREE.MathUtils.clamp(Number(tinHeightMeters) || 0.48, 0.35, 0.60);
    if (this.tinMesh) {
      this.tinMesh.scale.y = this.tinHeight / COURT_SPECS.TIN_HEIGHT_Y;
      this.tinMesh.position.y = this.tinHeight * 0.5;
    }
    if (this.tinBorderLine) {
      this.tinBorderLine.position.y = this.tinHeight;
    }
  }

  applyTheme(themeId = 'psa_glass') {
    this.theme = themeId;
    if (this.materials.floor) {
      this.materials.floor.map = createHardwoodFloorTexture(themeId);
      this.materials.floor.needsUpdate = true;
    }
    if (themeId === 'hardwood_club') {
      this.materials.frontWall.color.setHex(0xf1f5f9);
      this.materials.sideWall.color.setHex(0xe2e8f0);
      this.materials.sideWall.opacity = 0.52;
      this.materials.courtLine.color.setHex(0xdc2626);
      this.materials.outLine.color.setHex(0xb91c1c);
      this.materials.arenaFloor.color.setHex(0x1e1b18);
    } else if (themeId === 'neon_studio') {
      this.materials.frontWall.color.setHex(0x091326);
      this.materials.sideWall.color.setHex(0x0ea5e9);
      this.materials.sideWall.opacity = 0.24;
      this.materials.courtLine.color.setHex(0x38bdf8);
      this.materials.outLine.color.setHex(0xf43f5e);
      this.materials.arenaFloor.color.setHex(0x050811);
    } else {
      // psa_glass
      this.materials.frontWall.color.setHex(0x132a46);
      this.materials.sideWall.color.setHex(0x1e3a5f);
      this.materials.sideWall.opacity = 0.34;
      this.materials.courtLine.color.setHex(0xffffff);
      this.materials.outLine.color.setHex(0xef4444);
      this.materials.arenaFloor.color.setHex(0x09101c);
    }
  }

  updateTZoneGuide(playerPos, { visible = true, autoTEnabled = true, tTarget = COURT_SPECS.T_POS } = {}) {
    this.tGuideGroup.visible = !!visible;
    if (!visible || !playerPos) return;

    this.tTargetRing.position.set(tTarget.x, 0, tTarget.z);
    const distToT = Math.hypot(playerPos.x - tTarget.x, playerPos.z - tTarget.z);
    const colorHex = autoTEnabled ? (distToT < 0.55 ? 0x4ade80 : 0x38bdf8) : 0xfbbf24;
    this.tTargetRing.material.color.setHex(colorHex);
    this.tRecoveryArrow.material.color.setHex(colorHex);

    const posAttr = this.tRecoveryArrow.geometry.attributes.position;
    posAttr.setXYZ(0, playerPos.x, 0.012, playerPos.z);
    posAttr.setXYZ(1, tTarget.x, 0.012, tTarget.z);
    posAttr.needsUpdate = true;
  }

  spawnSurfaceImpact(surface, pos, { isNick = false, isFault = false } = {}) {
    const slot = this.wallImpactRings.find((r) => !r.active) || this.wallImpactRings[0];
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.maxAge = isNick ? 1.1 : 0.55;
    slot.mesh.visible = true;
    slot.mesh.position.copy(pos);
    slot.mesh.rotation.set(0, 0, 0);

    if (surface === 'floor' || surface === 'nick') {
      slot.mesh.rotation.x = -Math.PI / 2;
      slot.mesh.position.y = 0.012;
    } else if (surface === 'side_wall_left' || surface === 'side_wall_right') {
      slot.mesh.rotation.y = Math.PI / 2;
    }

    slot.mesh.material.color.setHex(isFault ? 0xef4444 : isNick ? 0x22d3ee : 0xfef08a);
    slot.mesh.scale.setScalar(isNick ? 1.25 : 0.7);
    slot.mesh.material.opacity = 0.92;
  }

  update(dt) {
    for (const r of this.wallImpactRings) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.maxAge;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
      } else {
        r.mesh.scale.setScalar(0.7 + t * 2.1);
        r.mesh.material.opacity = (1 - t) * 0.85;
      }
    }
  }
}

export default CourtGeometry;
