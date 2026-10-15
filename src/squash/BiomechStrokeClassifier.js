// ============================================================================
// ARGON SQUASH & VIRTUASQUASH — BIOMECHANICAL STROKE CLASSIFIER
// Module: src/squash/BiomechStrokeClassifier.js
// Architecture Ref: DOCS/ARCHITECTURE.md Section 3.10 (v2.1.0)
//
// Core Responsibilities:
//   1. Separate Stroke Identity (forehand | backhand | uncertain) from Shot
//      Mechanics (drive | drop | cut_drop | lob | boast | volley_kill).
//   2. Transform raw camera coordinates into a canonical Player-Relative
//      Anatomical Coordinate Frame invariant to screen translation, torso yaw,
//      camera mirroring (front 'user' vs rear TV 'environment'), and player
//      handedness ('right' vs 'left').
//   3. Temporal Stroke Segmentation (IDLE -> PREPARATION -> BACKSWING_APEX ->
//      FORWARD_SWING -> INFERRED_CONTACT -> FOLLOW_THROUGH) so cross-body
//      follow-throughs and late deceptive wrist snaps never reverse stroke side.
//   4. 3D MediaPipe Hands Palm Surface Normal estimation using vector cross
//      products with foreshortening/occlusion confidence degradation.
// ============================================================================

export const STROKE_SIDES = Object.freeze({
  FOREHAND: 'forehand',
  BACKHAND: 'backhand',
  UNCERTAIN: 'uncertain'
});

export const STROKE_PHASES = Object.freeze({
  IDLE: 'IDLE',
  PREPARATION: 'PREPARATION',
  BACKSWING_APEX: 'BACKSWING_APEX',
  FORWARD_SWING: 'FORWARD_SWING',
  INFERRED_CONTACT: 'INFERRED_CONTACT',
  FOLLOW_THROUGH: 'FOLLOW_THROUGH'
});

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function vec3Sub(a, b) {
  return {
    x: (a.x || 0) - (b.x || 0),
    y: (a.y || 0) - (b.y || 0),
    z: (a.z || 0) - (b.z || 0)
  };
}

function vec3Cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function vec3Len(v) {
  return Math.hypot(v.x || 0, v.y || 0, v.z || 0);
}

function vec3Normalize(v) {
  const len = vec3Len(v);
  if (len < 1e-6) return { x: 0, y: 0, z: 0, len: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len, len };
}

export class BiomechStrokeClassifier {
  constructor(options = {}) {
    this.handedness = options.handedness === 'left' ? 'left' : 'right';
    this.facingMode = options.facingMode === 'environment' ? 'environment' : 'user';
    this.uncertainThreshold = Number(options.uncertainThreshold ?? 0.20);
    this.lockConfidenceThreshold = Number(options.lockConfidenceThreshold ?? 0.48);
    this.windowMs = Number(options.windowMs ?? 650);

    // Smoothed anatomical torso reference in Player-Physical Coordinates
    // (+X = player's anatomical right side when facing the camera/screen)
    this.torsoState = {
      centerX: 0.5,
      centerY: 0.52,
      centerZ: 0.0,
      shoulderSpan: 0.24,
      rightAxisX: 1.0,
      rightAxisY: 0.0,
      torsoYawDeg: 0.0,
      poseConfidence: 0.0,
      lastUpdatedMs: 0
    };

    // Temporal sample buffer for active stroke trajectory
    this.samples = [];

    // Latched preparation/backswing state for the current active stroke
    this.latchedPrep = null;

    // Anti-flicker hysteresis state for HUD & animation stability
    this.lockedStrokeSide = STROKE_SIDES.UNCERTAIN;
    this.lockedConfidence = 0.0;
    this.lastLockedAtMs = 0;
    this.currentPhase = STROKE_PHASES.IDLE;
  }

  setConfig({ handedness, facingMode, uncertainThreshold, lockConfidenceThreshold } = {}) {
    if (handedness === 'left' || handedness === 'right') {
      if (this.handedness !== handedness) {
        this.handedness = handedness;
        this.lockedStrokeSide = STROKE_SIDES.UNCERTAIN;
        this.lockedConfidence = 0;
      }
    }
    if (facingMode === 'user' || facingMode === 'environment') {
      this.facingMode = facingMode;
    }
    if (typeof uncertainThreshold === 'number' && !Number.isNaN(uncertainThreshold)) {
      this.uncertainThreshold = clamp(uncertainThreshold, 0.08, 0.55);
    }
    if (typeof lockConfidenceThreshold === 'number' && !Number.isNaN(lockConfidenceThreshold)) {
      this.lockConfidenceThreshold = clamp(lockConfidenceThreshold, 0.25, 0.85);
    }
  }

  reset() {
    this.samples = [];
    this.latchedPrep = null;
    this.lockedStrokeSide = STROKE_SIDES.UNCERTAIN;
    this.lockedConfidence = 0.0;
    this.currentPhase = STROKE_PHASES.IDLE;
  }

  /**
   * Transforms a point from raw camera sensor space or mirrored display space into
   * canonical Player-Facing Physical Coordinates where:
   *   +x = Toward the player's anatomical RIGHT side
   *   -x = Toward the player's anatomical LEFT side
   *   +y = Downward (0 = top of frame, 1 = bottom of frame)
   *   +z = Depth away from camera
   *
   * Note on Camera Geometry:
   * - When a player stands facing a Front Camera ('user'), in raw unmirrored sensor
   *   coordinates their anatomical right hand is on the left of the sensor (u < 0.5).
   *   Once mirrored (x = 1 - u), their anatomical right hand is at x > 0.5.
   * - When a Rear Camera ('environment') is mounted below the TV facing the player,
   *   the optical geometry is identical to a front camera facing the player (raw sensor
   *   has player's right hand on the left of the image), UNLESS the rear camera is held
   *   behind the player pointing toward the TV ('behind_player').
   * - To handle both conventions unambiguously:
   *   - `coordSpace: 'player_physical'`: already in canonical player-right = +X space.
   *   - `coordSpace: 'display_mirrored'`: already horizontally flipped for front cam.
   *   - `coordSpace: 'raw_sensor'`: raw landmark [0..1] from MediaPipe/camera.
   */
  normalizePoint(pt, {
    coordSpace = 'player_physical',
    facingMode = this.facingMode,
    cameraPlacement = 'facing_player'
  } = {}) {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') {
      return null;
    }
    let x = pt.x;
    const y = pt.y;
    const z = typeof pt.z === 'number' ? pt.z : 0;
    const visibility = typeof pt.visibility === 'number' ? pt.visibility : 1.0;

    if (coordSpace === 'raw_sensor') {
      if (cameraPlacement === 'facing_player' && facingMode === 'user') {
        // Flip raw front-camera sensor so +x is player's anatomical right side
        x = 1.0 - pt.x;
      } else if (cameraPlacement === 'facing_player' && facingMode === 'environment') {
        // TV-mounted rear camera facing the player also sees player's right on sensor left
        x = 1.0 - pt.x;
      }
    } else if (coordSpace === 'display_mirrored') {
      // Display is mirrored when facingMode === 'user', unmirrored when 'environment'
      if (facingMode === 'environment' && cameraPlacement === 'facing_player') {
        x = 1.0 - pt.x;
      }
    }

    return { x, y, z, visibility };
  }

  /**
   * Updates the player's torso coordinate frame from MediaPipe Pose landmarks
   * (or partial upper-body landmarks / optical-flow body center).
   */
  updateTorsoFrame({
    poseLandmarks = null,
    bodyCenter = null,
    coordSpace = 'player_physical',
    facingMode = this.facingMode,
    cameraPlacement = 'facing_player',
    timestamp = performance.now()
  } = {}) {
    // MediaPipe Pose indices:
    // 11: left_shoulder, 12: right_shoulder, 13: left_elbow, 14: right_elbow,
    // 15: left_wrist, 16: right_wrist, 23: left_hip, 24: right_hip
    if (poseLandmarks && poseLandmarks[11] && poseLandmarks[12]) {
      const lSh = this.normalizePoint(poseLandmarks[11], { coordSpace, facingMode, cameraPlacement });
      const rSh = this.normalizePoint(poseLandmarks[12], { coordSpace, facingMode, cameraPlacement });

      if (lSh && rSh && lSh.visibility >= 0.35 && rSh.visibility >= 0.35) {
        const cx = 0.5 * (lSh.x + rSh.x);
        const cy = 0.5 * (lSh.y + rSh.y);
        const cz = 0.5 * (lSh.z + rSh.z);
        const dx = rSh.x - lSh.x;
        const dy = rSh.y - lSh.y;
        const dz = rSh.z - lSh.z;
        const span2D = Math.hypot(dx, dy);
        const span3D = Math.hypot(dx, dy, dz);

        if (span2D >= 0.05) {
          // Smoothly update torso frame while tracking movement across the camera frame
          const alpha = this.torsoState.poseConfidence > 0.3 ? 0.45 : 1.0;
          this.torsoState.centerX = this.torsoState.centerX * (1 - alpha) + cx * alpha;
          this.torsoState.centerY = this.torsoState.centerY * (1 - alpha) + cy * alpha;
          this.torsoState.centerZ = this.torsoState.centerZ * (1 - alpha) + cz * alpha;
          this.torsoState.shoulderSpan = clamp(span2D, 0.09, 0.55);

          // Ensure rightAxis points from anatomical left shoulder toward anatomical right shoulder
          const invSpan = 1 / Math.max(0.05, span2D);
          this.torsoState.rightAxisX = dx * invSpan;
          this.torsoState.rightAxisY = dy * invSpan;
          this.torsoState.torsoYawDeg = Math.atan2(dz, Math.max(0.05, dx)) * (180 / Math.PI);
          this.torsoState.poseConfidence = clamp(0.5 * (lSh.visibility + rSh.visibility) * (span2D / Math.max(0.08, span3D)), 0.25, 1.0);
          this.torsoState.lastUpdatedMs = timestamp;
          this.torsoState.rawPose = { lSh, rSh, poseLandmarks, coordSpace, facingMode, cameraPlacement };
          return this.torsoState;
        }
      }
    }

    // Fallback: Optical-flow or upper-body centroid tracking when full Pose is unavailable
    if (bodyCenter && typeof bodyCenter.x === 'number' && typeof bodyCenter.y === 'number') {
      const normC = this.normalizePoint(bodyCenter, { coordSpace, facingMode, cameraPlacement });
      if (normC) {
        this.torsoState.centerX = this.torsoState.centerX * 0.75 + normC.x * 0.25;
        this.torsoState.centerY = this.torsoState.centerY * 0.75 + normC.y * 0.25;
        this.torsoState.rightAxisX = 1.0;
        this.torsoState.rightAxisY = 0.0;
        this.torsoState.poseConfidence = Math.max(0.35, this.torsoState.poseConfidence * 0.85);
        this.torsoState.lastUpdatedMs = timestamp;
      }
    }

    return this.torsoState;
  }

  /**
   * Computes hitting-arm chain score [-1 (Backhand) .. +1 (Forehand)] from shoulder,
   * elbow, and wrist landmarks when available.
   */
  _computeArmChainEvidence(handPt, poseContext) {
    if (!poseContext || !poseContext.poseLandmarks) {
      return { score: 0, confidence: 0 };
    }
    const lm = poseContext.poseLandmarks;
    const isLeftHanded = this.handedness === 'left';
    const shRaw = isLeftHanded ? lm[11] : lm[12];
    const elRaw = isLeftHanded ? lm[13] : lm[14];

    if (!shRaw || !elRaw) return { score: 0, confidence: 0 };
    const sh = this.normalizePoint(shRaw, poseContext);
    const el = this.normalizePoint(elRaw, poseContext);
    if (!sh || !el || (sh.visibility ?? 1) < 0.3 || (el.visibility ?? 1) < 0.3) {
      return { score: 0, confidence: 0 };
    }

    const domSign = isLeftHanded ? -1 : 1;
    const span = Math.max(0.09, this.torsoState.shoulderSpan);

    // Vector from hitting shoulder to elbow and hitting elbow to wrist projected along dominant lateral axis
    const elbowRelShoulderDom =
      ((el.x - sh.x) * this.torsoState.rightAxisX + (el.y - sh.y) * this.torsoState.rightAxisY) *
      domSign /
      span;
    const wristRelElbowDom =
      ((handPt.x - el.x) * this.torsoState.rightAxisX + (handPt.y - el.y) * this.torsoState.rightAxisY) *
      domSign /
      span;
    const wristRelShoulderDom =
      ((handPt.x - sh.x) * this.torsoState.rightAxisX + (handPt.y - sh.y) * this.torsoState.rightAxisY) *
      domSign /
      span;

    // On a forehand, the hitting wrist & elbow open toward or stay on the dominant side of the hitting shoulder/torso;
    // on a backhand, the hitting elbow & wrist reach across the torso midline (negative dominant offset).
    const rawArmScore = clamp(
      0.45 * (wristRelShoulderDom / 0.55) +
      0.35 * (wristRelElbowDom / 0.45) +
      0.20 * (elbowRelShoulderDom / 0.40),
      -1,
      1
    );
    const conf = clamp(0.5 * ((sh.visibility ?? 1) + (el.visibility ?? 1)), 0, 1);
    return { score: rawArmScore, confidence: conf };
  }

  /**
   * Estimates 3D Palm / Racquet-Face orientation from MediaPipe Hands landmarks (0..20)
   * using the 3D cross product of the axial palm vector (wrist[0] -> middle_mcp[9])
   * and transverse knuckle vector (pinky_mcp[17] -> index_mcp[5]), degrading confidence
   * gracefully when the hand is edge-on, occluded, or missing landmarks.
   */
  estimateHandOrientation(handLandmarks, {
    coordSpace = 'player_physical',
    facingMode = this.facingMode,
    cameraPlacement = 'facing_player'
  } = {}) {
    if (!Array.isArray(handLandmarks) || handLandmarks.length < 18) {
      return {
        normal3D: { nx: 0, ny: 0, nz: 0 },
        openFaceCutDeg: 0,
        pronationState: 'uncertain',
        palmSideScore: 0,
        orientationConfidence: 0
      };
    }

    const w0 = this.normalizePoint(handLandmarks[0], { coordSpace, facingMode, cameraPlacement });
    const i5 = this.normalizePoint(handLandmarks[5], { coordSpace, facingMode, cameraPlacement });
    const m9 = this.normalizePoint(handLandmarks[9], { coordSpace, facingMode, cameraPlacement });
    const p17 = this.normalizePoint(handLandmarks[17], { coordSpace, facingMode, cameraPlacement });

    if (!w0 || !i5 || !m9 || !p17) {
      return {
        normal3D: { nx: 0, ny: 0, nz: 0 },
        openFaceCutDeg: 0,
        pronationState: 'uncertain',
        palmSideScore: 0,
        orientationConfidence: 0
      };
    }

    const minVis = Math.min(
      w0.visibility ?? 1,
      i5.visibility ?? 1,
      m9.visibility ?? 1,
      p17.visibility ?? 1
    );
    if (minVis < 0.25) {
      return {
        normal3D: { nx: 0, ny: 0, nz: 0 },
        openFaceCutDeg: 0,
        pronationState: 'uncertain',
        palmSideScore: 0,
        orientationConfidence: 0
      };
    }

    const vAxial = vec3Sub(m9, w0);
    const vTrans = vec3Sub(i5, p17);
    const axialLen2D = Math.hypot(vAxial.x, vAxial.y);
    const transLen2D = Math.hypot(vTrans.x, vTrans.y);

    // If hand is too small, partially occluded, or severely foreshortened (edge-on),
    // degrade orientationConfidence smoothly rather than inventing certainty.
    if (axialLen2D < 0.018 || transLen2D < 0.008) {
      return {
        normal3D: { nx: 0, ny: 0, nz: 0 },
        openFaceCutDeg: 0,
        pronationState: 'uncertain',
        palmSideScore: 0,
        orientationConfidence: 0.05
      };
    }

    const foreshorteningRatio = clamp(transLen2D / Math.max(0.02, axialLen2D), 0, 1.2);
    const rawCross = vec3Cross(vAxial, vTrans);
    const normCross = vec3Normalize(rawCross);

    const domSign = this.handedness === 'left' ? -1 : 1;
    // In Player-Physical frame, palm normal z component and lateral tilt indicate supination/pronation
    const palmFacingSign = normCross.z * domSign;
    const openFaceCutDeg = clamp(Math.asin(clamp(-normCross.y, -1, 1)) * (180 / Math.PI), -35, 55);

    const orientationConfidence = clamp(
      minVis * clamp((foreshorteningRatio - 0.18) / 0.55, 0, 1),
      0,
      0.95
    );

    let pronationState = 'uncertain';
    if (orientationConfidence >= 0.35) {
      if (openFaceCutDeg > 14 || palmFacingSign > 0.22) {
        pronationState = 'supinated_open';
      } else if (palmFacingSign < -0.25) {
        pronationState = 'pronated_closed';
      } else {
        pronationState = 'neutral_square';
      }
    }

    const palmSideScore = orientationConfidence >= 0.35 ? clamp(palmFacingSign * 0.85, -1, 1) : 0;

    return {
      normal3D: { nx: normCross.x, ny: normCross.y, nz: normCross.z },
      openFaceCutDeg,
      pronationState,
      palmSideScore,
      orientationConfidence
    };
  }

  /**
   * Projects a normalized hand position into Dominant-Shoulder Normalized Coordinates:
   *   sDom > 0 => Player's Anatomical Forehand (Dominant) Side of Torso
   *   sDom < 0 => Player's Anatomical Backhand (Non-Dominant) Side of Torso
   */
  computePlayerRelativeCoords(handPt) {
    const dx = handPt.x - this.torsoState.centerX;
    const dy = handPt.y - this.torsoState.centerY;
    const span = Math.max(0.09, this.torsoState.shoulderSpan);
    const domSign = this.handedness === 'left' ? -1 : 1;

    // Project onto torso lateral right axis, then multiply by domSign
    const sRight = (dx * this.torsoState.rightAxisX + dy * this.torsoState.rightAxisY) / span;
    const sDom = sRight * domSign;
    const sVert = ( -dy * this.torsoState.rightAxisX + dx * this.torsoState.rightAxisY ) / span;

    return { sDom, sVert, sRight };
  }

  /**
   * Pushes a single temporal frame into the classifier and updates live stance & phase.
   */
  ingestFrame({
    timestamp = performance.now(),
    handPoint = null,
    handLandmarks = null,
    poseLandmarks = null,
    bodyCenter = null,
    visibility = 1.0,
    coordSpace = 'player_physical',
    facingMode = this.facingMode,
    cameraPlacement = 'facing_player'
  } = {}) {
    this.updateTorsoFrame({
      poseLandmarks,
      bodyCenter,
      coordSpace,
      facingMode,
      cameraPlacement,
      timestamp
    });

    // Resolve hitting hand point from either explicit handPoint, MediaPipe handLandmarks, or Pose wrist
    let resolvedHand = null;
    let resolvedVis = visibility;

    if (handPoint && typeof handPoint.x === 'number' && typeof handPoint.y === 'number') {
      resolvedHand = this.normalizePoint(handPoint, { coordSpace, facingMode, cameraPlacement });
      resolvedVis = Math.min(visibility, resolvedHand.visibility ?? 1.0);
    } else if (Array.isArray(handLandmarks) && handLandmarks.length >= 10) {
      const w0 = this.normalizePoint(handLandmarks[0], { coordSpace, facingMode, cameraPlacement });
      const m9 = this.normalizePoint(handLandmarks[9], { coordSpace, facingMode, cameraPlacement });
      if (w0 && m9) {
        resolvedHand = {
          x: w0.x * 0.45 + m9.x * 0.55,
          y: w0.y * 0.45 + m9.y * 0.55,
          z: w0.z * 0.45 + m9.z * 0.55,
          visibility: Math.min(w0.visibility ?? 1, m9.visibility ?? 1)
        };
        resolvedVis = Math.min(visibility, resolvedHand.visibility);
      }
    } else if (poseLandmarks) {
      const wristIdx = this.handedness === 'left' ? 15 : 16;
      if (poseLandmarks[wristIdx]) {
        resolvedHand = this.normalizePoint(poseLandmarks[wristIdx], { coordSpace, facingMode, cameraPlacement });
        resolvedVis = Math.min(visibility, resolvedHand?.visibility ?? 1.0);
      }
    }

    if (!resolvedHand || resolvedVis < 0.22) {
      // Missing or occluded hand — degrade confidence smoothly without inventing certainty
      this.lockedConfidence *= 0.85;
      if (this.lockedConfidence < this.uncertainThreshold) {
        this.lockedStrokeSide = STROKE_SIDES.UNCERTAIN;
      }
      return this.getLiveStanceSummary();
    }

    const { sDom, sVert, sRight } = this.computePlayerRelativeCoords(resolvedHand);
    const palmInfo = this.estimateHandOrientation(handLandmarks, {
      coordSpace,
      facingMode,
      cameraPlacement
    });
    const armChain = this._computeArmChainEvidence(
      resolvedHand,
      this.torsoState.rawPose || (poseLandmarks ? { poseLandmarks, coordSpace, facingMode, cameraPlacement } : null)
    );

    const prev = this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
    const dt = prev ? Math.max(0.008, (timestamp - prev.t) / 1000) : 0.016;
    const vx = prev ? (resolvedHand.x - prev.x) / dt : 0;
    const vy = prev ? (resolvedHand.y - prev.y) / dt : 0;
    const vDom = prev ? (sDom - prev.sDom) / dt : 0;
    const speed = prev ? Math.hypot(vx, vy) : 0;
    const accel = prev ? (speed - prev.speed) / dt : 0;

    const sample = {
      t: timestamp,
      x: resolvedHand.x,
      y: resolvedHand.y,
      z: resolvedHand.z || 0,
      sDom,
      sVert,
      sRight,
      vx,
      vy,
      vDom,
      speed,
      accel,
      visibility: resolvedVis,
      palmInfo,
      armChain
    };

    this.samples.push(sample);
    while (this.samples.length > 28 || (this.samples.length > 2 && timestamp - this.samples[0].t > this.windowMs)) {
      this.samples.shift();
    }

    // Update live stance hysteresis when player is preparing or holding position
    const instantGeomScore = clamp(
      0.68 * clamp(sDom / 0.35, -1, 1) +
      0.22 * armChain.score * armChain.confidence +
      0.10 * palmInfo.palmSideScore * palmInfo.orientationConfidence,
      -1,
      1
    );
    const instantConf = clamp(Math.abs(instantGeomScore) * resolvedVis * 1.25, 0, 1);
    const candidateSide =
      Math.abs(instantGeomScore) < this.uncertainThreshold
        ? STROKE_SIDES.UNCERTAIN
        : instantGeomScore > 0
        ? STROKE_SIDES.FOREHAND
        : STROKE_SIDES.BACKHAND;

    if (candidateSide !== STROKE_SIDES.UNCERTAIN && instantConf >= this.lockConfidenceThreshold) {
      this.lockedStrokeSide = candidateSide;
      this.lockedConfidence = instantConf;
      this.lastLockedAtMs = timestamp;
    } else if (timestamp - this.lastLockedAtMs > 480) {
      this.lockedConfidence *= 0.9;
      if (this.lockedConfidence < this.uncertainThreshold) {
        this.lockedStrokeSide = STROKE_SIDES.UNCERTAIN;
      }
    }

    return this.getLiveStanceSummary();
  }

  getLiveStanceSummary() {
    const latest = this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
    return {
      strokeSide: this.lockedStrokeSide,
      confidence: Number(this.lockedConfidence.toFixed(3)),
      handedness: this.handedness,
      sDom: latest ? Number(latest.sDom.toFixed(3)) : 0,
      phase: this.currentPhase
    };
  }

  /**
   * Evaluates the temporal sequence of samples (Preparation -> Backswing Apex ->
   * Forward Swing -> Inferred Contact -> Follow-Through) to classify the completed
   * or active stroke.
   *
   * Key Biomechanical Guarantee:
   * - Stroke side ('forehand' | 'backhand' | 'uncertain') is determined primarily
   *   from player-relative preparation, backswing apex, contact zone, and hitting-arm
   *   geometry (`sDomPrep`, `sDomApex`, `sDomContact`, `armChain`), NOT from screen `vx`.
   * - Shot mechanics (`drive`, `drop`, `cut_drop`, `lob`, `boast`, `volley_kill`) are
   *   computed independently around the inferred contact window so a Forehand Drop or
   *   Inside-Out Forehand Drive remains a Forehand regardless of finishing direction.
   */
  classifySequence(customSamples = null) {
    const seq = Array.isArray(customSamples) && customSamples.length > 0 ? customSamples : this.samples;

    if (!seq || seq.length < 2) {
      return this._buildUncertainResult('insufficient_samples');
    }

    // Check overall visibility / landmark integrity
    const avgVis = seq.reduce((acc, s) => acc + (s.visibility ?? 1), 0) / seq.length;
    if (avgVis < 0.30) {
      return this._buildUncertainResult('low_visibility_occlusion');
    }

    // 1. Identify Inferred Contact Frame (frame of peak hand speed after preparation)
    let peakSpeedIdx = 1;
    let peakSpeed = -1;
    let peakAccel = 0;

    for (let i = 1; i < seq.length; i++) {
      const sp = seq[i].speed ?? 0;
      const ac = seq[i].accel ?? 0;
      if (ac > peakAccel) peakAccel = ac;
      // Prefer speed peaks that are not the very last decelerating follow-through frame if a clear peak exists earlier
      if (sp > peakSpeed) {
        peakSpeed = sp;
        peakSpeedIdx = i;
      }
    }

    const totalDisp = Math.hypot(
      seq[seq.length - 1].x - seq[0].x,
      seq[seq.length - 1].y - seq[0].y
    );
    if (peakSpeed < 0.18 || totalDisp < 0.035) {
      return this._buildUncertainResult('sub_threshold_motion');
    }

    // 2. Segment Temporal Phases:
    // - Preparation window: frames [0 .. max(0, peakSpeedIdx - 1)]
    // - Backswing Apex: frame in [0 .. peakSpeedIdx] with maximum absolute lateral coil |sDom|
    // - Contact window: frames around peakSpeedIdx
    // - Follow-through window: frames [peakSpeedIdx + 1 .. seq.length - 1]
    const prepEndIdx = Math.max(0, peakSpeedIdx - 1);
    const prepSlice = seq.slice(0, prepEndIdx + 1);
    const sDomPrep = prepSlice.reduce((acc, s) => acc + s.sDom, 0) / prepSlice.length;

    let apexSample = seq[0];
    for (let i = 0; i <= peakSpeedIdx; i++) {
      if (Math.abs(seq[i].sDom) > Math.abs(apexSample.sDom)) {
        apexSample = seq[i];
      }
    }
    const sDomApex = apexSample.sDom;

    const contactSample = seq[peakSpeedIdx];
    const sDomContact = contactSample.sDom;

    const endSample = seq[seq.length - 1];
    const sDomFollowThrough = endSample.sDom;

    // Detect whether follow-through crossed the body midline opposite to preparation/apex
    const prepSign = Math.sign(0.45 * sDomPrep + 0.55 * sDomApex);
    const isCrossBodyFollowThrough =
      Math.abs(sDomApex) > 0.12 &&
      prepSign !== 0 &&
      Math.sign(sDomFollowThrough) !== prepSign &&
      Math.abs(sDomFollowThrough - sDomApex) > 0.30;

    // Detect deceptive late wrist / pace change between forward swing initiation (apex -> contact) and post-contact release
    let isDeceptiveLateRelease = false;
    if (peakSpeedIdx >= 1 && peakSpeedIdx < seq.length - 1) {
      const fwdStart = seq[Math.max(0, peakSpeedIdx - 1)];
      const contactPt = seq[peakSpeedIdx];
      const postPt = seq[Math.min(seq.length - 1, peakSpeedIdx + 1)];
      const vFwdX = contactPt.x - fwdStart.x;
      const vFwdY = contactPt.y - fwdStart.y;
      const vPostX = postPt.x - contactPt.x;
      const vPostY = postPt.y - contactPt.y;
      const magProd = Math.hypot(vFwdX, vFwdY) * Math.hypot(vPostX, vPostY);
      if (magProd > 1e-4) {
        const cosAngle = (vFwdX * vPostX + vFwdY * vPostY) / magProd;
        // If wrist abruptly redirects downward/outward at contact (angle > ~48 deg) with downward cut
        if (cosAngle < 0.66 && vPostY > 0.03) {
          isDeceptiveLateRelease = true;
        }
      }
    }

    // 3. Compute Player-Relative Biomechanical Evidence Scores [-1 (Backhand) .. +1 (Forehand)]
    // Primary Signal A: Preparation + Backswing Apex Lateral Position relative to Torso
    const prepApexRaw = 0.45 * sDomPrep + 0.55 * sDomApex;
    const prepApexScore = clamp(prepApexRaw / 0.32, -1, 1);

    // Primary Signal B: Contact Zone Lateral Position relative to Torso
    // If contact is already crossing midline on a late contact, weight Apex higher
    const contactZoneScore = clamp(sDomContact / 0.35, -1, 1);

    // Secondary Signal C: Hitting-Arm Chain (Shoulder -> Elbow -> Wrist lever) during Prep/Contact
    let armChainSum = 0;
    let armChainWeightSum = 0;
    for (let i = 0; i <= peakSpeedIdx; i++) {
      const ac = seq[i].armChain;
      if (ac && ac.confidence > 0.2) {
        armChainSum += ac.score * ac.confidence;
        armChainWeightSum += ac.confidence;
      }
    }
    const armChainScore = armChainWeightSum > 0 ? clamp(armChainSum / armChainWeightSum, -1, 1) : 0;
    const hasArmChain = armChainWeightSum > 0.25;

    // Supporting Signal D: 3D Palm Surface Normal (weighted by foreshortening confidence)
    const contactPalm = contactSample.palmInfo || apexSample.palmInfo || {
      palmSideScore: 0,
      orientationConfidence: 0,
      normal3D: { nx: 0, ny: 0, nz: 0 },
      openFaceCutDeg: 0,
      pronationState: 'uncertain'
    };
    const palmNormalScore = contactPalm.palmSideScore || 0;
    const palmConf = contactPalm.orientationConfidence || 0;

    // Supporting Signal E: Initial Forward Swing Release Vector (weak supporting prior only!)
    // On a standard cross-body swing, vDom at contact is negative for Forehand (moving from dominant
    // side toward centerline) and positive for Backhand. However, inside-out drives and vertical
    // drops violate this, so its weight is capped at <= 0.06 so it NEVER overrides preparation geometry.
    const kinematicSupportScore = clamp(-contactSample.vDom / 2.5, -1, 1);

    // Fuse Evidence with Biomechanical Hierarchy:
    // Preparation & Apex (0.56) + Contact Zone (0.24) + Arm Chain (0.12) + Palm Normal (0.05) + Kinematics (0.03)
    const wPrep = hasArmChain ? 0.56 : 0.64;
    const wContact = hasArmChain ? 0.24 : 0.28;
    const wArm = hasArmChain ? 0.12 : 0.0;
    const wPalm = 0.05 * palmConf;
    const wKin = 0.03;

    const totalWeight = wPrep + wContact + wArm + wPalm + wKin;
    const compositeScore =
      (wPrep * prepApexScore +
        wContact * contactZoneScore +
        wArm * armChainScore +
        wPalm * palmNormalScore +
        wKin * kinematicSupportScore) /
      totalWeight;

    const rawMagnitude = Math.abs(compositeScore);
    const confidence = clamp(rawMagnitude * avgVis * 1.28, 0, 1);

    let strokeSide = STROKE_SIDES.UNCERTAIN;
    if (confidence >= this.uncertainThreshold && rawMagnitude >= this.uncertainThreshold) {
      strokeSide = compositeScore > 0 ? STROKE_SIDES.FOREHAND : STROKE_SIDES.BACKHAND;
    }

    if (strokeSide !== STROKE_SIDES.UNCERTAIN && confidence >= this.lockConfidenceThreshold) {
      this.lockedStrokeSide = strokeSide;
      this.lockedConfidence = confidence;
      this.lastLockedAtMs = contactSample.t;
    }

    // 4. Independently Determine Shot Mechanics from Contact Kinematics & Racquet-Face Cut Angle
    // Measure effective stroke vector across the forward swing -> contact window (not post-contact wrap)
    const swingStartIdx = Math.max(0, peakSpeedIdx - 2);
    const swingEndIdx = Math.min(seq.length - 1, peakSpeedIdx + 1);
    const dtSwing = Math.max(0.02, (seq[swingEndIdx].t - seq[swingStartIdx].t) / 1000);
    const contactVx = (seq[swingEndIdx].x - seq[swingStartIdx].x) / dtSwing;
    const contactVy = (seq[swingEndIdx].y - seq[swingStartIdx].y) / dtSwing;

    // In normalized screen units/sec, a typical drive is ~2.0-4.2 u/s, soft drop ~1.2-2.6 u/s, kill > 5.0 u/s
    const speedNormalized = clamp(0.74 + peakSpeed * 0.11, 0.72, 1.68);
    // Map horizontal direction to court aim [-1..+1]
    const dirX = clamp(contactVx * 0.42, -1, 1);
    const dirY = clamp(contactVy * 0.42, -1, 1);

    const openFaceCutDeg =
      contactPalm.orientationConfidence >= 0.35
        ? contactPalm.openFaceCutDeg
        : contactVy > 0.35
        ? clamp(contactVy * 14, 14, 42)
        : 4;

    let shotType = 'drive';
    let cutModifier = false;

    if (contactVy < -0.65 && Math.abs(contactVy) >= Math.abs(contactVx) * 0.85) {
      shotType = 'lob';
    } else if (speedNormalized >= 1.44 && contactVy > 0.45) {
      shotType = 'volley_kill';
    } else if (
      (contactVy > 0.85 && Math.abs(contactVy) > Math.abs(contactVx) * 0.75 && speedNormalized < 1.38) ||
      (openFaceCutDeg >= 18 && speedNormalized < 1.25) ||
      (isDeceptiveLateRelease && contactVy > 0.40)
    ) {
      shotType = contactVy > 1.1 || openFaceCutDeg >= 22 ? 'cut_drop' : 'drop';
      cutModifier = true;
    } else if (
      Math.abs(sDomApex) > 0.85 &&
      Math.abs(contactVx) > 5.8 &&
      Math.abs(contactVx) > Math.abs(contactVy) * 4.0 &&
      speedNormalized >= 1.32
    ) {
      shotType = 'boast';
    } else {
      shotType = 'drive';
    }

    this.currentPhase = isCrossBodyFollowThrough
      ? STROKE_PHASES.FOLLOW_THROUGH
      : STROKE_PHASES.INFERRED_CONTACT;

    return {
      strokeSide,
      lockedStrokeSide: this.lockedStrokeSide,
      confidence: Number(confidence.toFixed(3)),
      phase: this.currentPhase,
      handedness: this.handedness,
      shotMechanics: {
        shotType,
         engineShotType:
          shotType === 'cut_drop' || shotType === 'drop'
            ? 'drop'
            : shotType === 'volley_kill'
            ? 'smash'
            : shotType === 'drive'
            ? 'topspin'
            : shotType,
        cutModifier,
        isDeceptiveLateRelease,
        speedNormalized: Number(speedNormalized.toFixed(3)),
        dirX: Number(dirX.toFixed(3)),
        dirY: Number(dirY.toFixed(3))
      },
      swingKinematics: {
        peakSpeed: Number(peakSpeed.toFixed(3)),
        contactVelocity: {
          vx: Number(contactVx.toFixed(3)),
          vy: Number(contactVy.toFixed(3)),
          vz: 0
        },
        peakAcceleration: Number(peakAccel.toFixed(3)),
        followThroughVector: {
          dx: Number((endSample.x - contactSample.x).toFixed(3)),
          dy: Number((endSample.y - contactSample.y).toFixed(3))
        },
        isCrossBodyFollowThrough
      },
      racquetFaceOrientation: {
        normal3D: contactPalm.normal3D,
        openFaceCutDeg: Number(openFaceCutDeg.toFixed(1)),
        pronationState: contactPalm.pronationState,
        orientationConfidence: Number((contactPalm.orientationConfidence || 0).toFixed(3))
      },
      playerGeometry: {
        sDomPrep: Number(sDomPrep.toFixed(3)),
        sDomApex: Number(sDomApex.toFixed(3)),
        sDomContact: Number(sDomContact.toFixed(3)),
        elbowLeverageScore: Number(armChainScore.toFixed(3)),
        torsoYawDeg: Number(this.torsoState.torsoYawDeg.toFixed(1))
      },
      evidenceBreakdown: {
        prepApexScore: Number(prepApexScore.toFixed(3)),
        contactZoneScore: Number(contactZoneScore.toFixed(3)),
        armChainScore: Number(armChainScore.toFixed(3)),
        palmNormalScore: Number(palmNormalScore.toFixed(3)),
        kinematicSupportScore: Number(kinematicSupportScore.toFixed(3)),
        compositeScore: Number(compositeScore.toFixed(3))
      }
    };
  }

  _buildUncertainResult(reason = 'low_confidence') {
    return {
      strokeSide: STROKE_SIDES.UNCERTAIN,
      lockedStrokeSide: this.lockedStrokeSide,
      confidence: 0,
      reason,
      phase: STROKE_PHASES.IDLE,
      handedness: this.handedness,
      shotMechanics: {
        shotType: 'drive',
        engineShotType: 'topspin',
        cutModifier: false,
        isDeceptiveLateRelease: false,
        speedNormalized: 1.0,
        dirX: 0,
        dirY: -0.4
      },
      swingKinematics: {
        peakSpeed: 0,
        contactVelocity: { vx: 0, vy: 0, vz: 0 },
        peakAcceleration: 0,
        followThroughVector: { dx: 0, dy: 0 },
        isCrossBodyFollowThrough: false
      },
      racquetFaceOrientation: {
        normal3D: { nx: 0, ny: 0, nz: 0 },
        openFaceCutDeg: 0,
        pronationState: 'uncertain',
        orientationConfidence: 0
      },
      playerGeometry: {
        sDomPrep: 0,
        sDomApex: 0,
        sDomContact: 0,
        elbowLeverageScore: 0,
        torsoYawDeg: 0
      },
      evidenceBreakdown: {
        prepApexScore: 0,
        contactZoneScore: 0,
        armChainScore: 0,
        palmNormalScore: 0,
        kinematicSupportScore: 0,
        compositeScore: 0
      }
    };
  }
}

export default BiomechStrokeClassifier;
