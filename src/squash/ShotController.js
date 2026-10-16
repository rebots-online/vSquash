// ============================================================================
// ARGON SQUASH — SHOT CONTROLLER (DECOUPLED PREPARATION vs EXECUTION)
// Separates Backswing Preparation (Hold / Disguise) from Contact Execution
// (Racket-Face Cut Angle, Forearm Pronation, Swing Velocity, and Aim).
//
// Core Invariant (Section 5):
//   Do NOT equate long charging with power and short charging with drops.
//   A player can hold a full backswing preparation and execute a feather-soft
//   disguised drop (+36° cut) OR snap an aggressive volley kill from minimal prep.
// ============================================================================

import * as THREE from 'three';
import { COURT_SPECS } from './CourtGeometry.js';
import { BallPhysics } from './BallPhysics.js';

export const SQUASH_SHOT_TYPES = Object.freeze({
  STRAIGHT_DRIVE: 'STRAIGHT_DRIVE',
  CROSS_DRIVE: 'CROSS_DRIVE',
  OFF_BACK_WALL_DRIVE: 'OFF_BACK_WALL_DRIVE',
  VOLLEY_KILL: 'VOLLEY_KILL',
  DISGUISED_DROP: 'DISGUISED_DROP',
  COUNTER_DROP: 'COUNTER_DROP',
  TWO_WALL_BOAST: 'TWO_WALL_BOAST',
  BACK_WALL_BOAST: 'BACK_WALL_BOAST',
  HIGH_LOB: 'HIGH_LOB',
  SERVE: 'SERVE'
});

export class ShotController {
  constructor() {
    this.prepStates = {
      player: this._createPrepState(),
      opponent: this._createPrepState()
    };
  }

  _createPrepState() {
    return {
      active: false,
      startedAt: 0,
      durationSec: 0,
      chargeNormalized: 0, // 0..1 backswing coil (visual posture & disguise)
      intendedFaceMode: 'AUTO', // 'AUTO' | 'DRIVE_FLAT' | 'OPEN_CUT' | 'BOAST_ANGLE' | 'LOB_LIFT'
      aimBiasX: 0
    };
  }

  getPrepState(role = 'player') {
    return this.prepStates[role] || this.prepStates.player;
  }

  beginPreparation(role = 'player', nowSec = 0, options = {}) {
    const st = this.getPrepState(role);
    st.active = true;
    st.startedAt = nowSec;
    st.durationSec = 0;
    st.chargeNormalized = 0.15;
    if (options.faceMode) st.intendedFaceMode = options.faceMode;
    return st;
  }

  updatePreparation(role = 'player', dt = 0.016, params = {}) {
    const st = this.getPrepState(role);
    if (!st.active) return st;
    const fullSec = Number(params.shotMechanics?.prepFullChargeSec ?? 0.42);
    st.durationSec += dt;
    st.chargeNormalized = Math.min(1.0, st.durationSec / Math.max(0.1, fullSec));
    return st;
  }

  clearPreparation(role = 'player') {
    const st = this.getPrepState(role);
    const snapshot = { ...st };
    st.active = false;
    st.durationSec = 0;
    st.chargeNormalized = 0;
    return snapshot;
  }

  /**
   * Computes a legal squash serve from the Left or Right Service Box onto the
   * Front Wall above the Service Line (Y > 1.78m) rebounding into the opposite
   * rear quarter court.
   */
  computeServeExecution({ actor, serviceSide = 'right', inputEvent = {}, params = {} }) {
    const sm = params.shotMechanics || {};
    const speedMult = THREE.MathUtils.clamp(Number(inputEvent.speed ?? 1.15), 0.85, 1.55);
    const isLeftBox = serviceSide === 'left';
    const targetSideSign = isLeftBox ? 1 : -1; // Serve cross-court to opposite rear quarter

    const startPos = actor.pos.clone().add(new THREE.Vector3(isLeftBox ? 0.25 : -0.25, 1.18, -0.18));
    const frontWallHitX = targetSideSign * (0.45 + Math.abs(Number(inputEvent.dirX || 0)) * 0.65);
    const frontWallHitY = inputEvent.shotType === 'lob' ? 3.25 : 2.38;
    const dz = COURT_SPECS.FRONT_WALL_Z - startPos.z;
    const dx = frontWallHitX - startPos.x;
    const dy = frontWallHitY - startPos.y;

    const flightToWallSec = THREE.MathUtils.clamp(0.32 / Math.pow(speedMult, 0.7), 0.22, 0.42);
    const g = Number(params.ballPhysics?.gravity ?? 9.81);

    const vx = dx / flightToWallSec;
    const vz = dz / flightToWallSec;
    const vy = (dy + 0.5 * g * flightToWallSec * flightToWallSec) / flightToWallSec;

    return {
      shotId: SQUASH_SHOT_TYPES.SERVE,
      label: inputEvent.shotType === 'lob' ? 'LOB SERVE' : 'CRISP SERVE',
      vel: new THREE.Vector3(vx, vy, vz),
      spin: new THREE.Vector3(6, targetSideSign * 4, 0),
      cutAngleDeg: 8,
      forearmPronationDegPerSec: 420 * speedMult,
      isDisguised: false,
      timingGrade: 'SWEET SPOT',
      speedKmh: Math.round(Math.hypot(vx, vy, vz) * 3.6)
    };
  }

  /**
   * Resolves the squash stroke at impact by combining:
   * 1. Preparation State (was the player coiled in a full windup?)
   * 2. Racket-Face Orientation & Cut Angle (Open Cut vs Flat Drive vs Boast vs Lob)
   * 3. Swing Velocity & Contact Height (Volley vs Low Corner Recovery)
   * 4. Timing Quality (Early Cross / Sweet Spot Tight / Late Straight)
   */
  computeShotExecution({
    actor,
    ball,
    opponent,
    inputEvent = {},
    prepSnapshot = null,
    params = {}
  }) {
    const sm = params.shotMechanics || {};
    const bp = params.ballPhysics || {};
    const g = Number(bp.gravity ?? 9.81);
    const spinScale = Number(sm.spinMagnitudeScale ?? 1.0);
    const assist = THREE.MathUtils.clamp(Number(sm.placementAssistStrength ?? 0.45), 0, 1);

    const prepCharge = prepSnapshot
      ? prepSnapshot.chargeNormalized
      : Number(inputEvent.prepCharge ?? 0.45);

    const contactPos = ball.pos.clone();
    contactPos.y = THREE.MathUtils.clamp(contactPos.y, 0.24, Number(sm.contactHeightReachMeters ?? 2.15));

    const playerSideSign = contactPos.x >= 0 ? 1 : -1;
    const isVolley = (ball.bounceCountOnFloor || 0) === 0 && contactPos.z < COURT_SPECS.SHORT_LINE_Z + 0.85;
    const isDeepBackCorner = contactPos.z > 2.65 && Math.abs(contactPos.x) > 1.55;
    const isOffBackWall = Boolean(ball.hitBackWallThisShot && ball.vel.z < 0);
    const isRisingOffBackWall = Boolean(isOffBackWall && ball.vel.y >= -0.35);

    // Determine desired tactical family from explicit modifier, gesture kinematics, or shot mode
    const rawRequested = String(inputEvent.shotType || '').toLowerCase();
    const isCutModifier =
      !!inputEvent.cutModifier ||
      rawRequested === 'slice' ||
      rawRequested === 'drop' ||
      rawRequested === 'disguised_drop' ||
      (Number(inputEvent.dirY ?? 0) > 0.25 && Number(inputEvent.speed ?? 1.0) < 1.18);

    const isBoastRequest =
      rawRequested === 'boast' ||
      rawRequested === 'two_wall_boast' ||
      rawRequested === 'back_wall_boast' ||
      Math.abs(Number(inputEvent.dirX ?? 0)) > 0.72;

    const isLobRequest =
      rawRequested === 'lob' ||
      (Number(inputEvent.dirY ?? 0) < -0.62 && !isVolley);

    const isKillRequest =
      rawRequested === 'smash' ||
      rawRequested === 'kill' ||
      (isVolley && contactPos.y > 1.12 && Number(inputEvent.speed ?? 1.15) >= 1.25 && !isCutModifier);

    const isCrossRequest =
      rawRequested === 'cross' ||
      (Number(inputEvent.dirX ?? 0) * playerSideSign < -0.28 && !isBoastRequest);

    // Disguise detection: player held a full drive preparation (prepCharge >= 0.65)
    // and then opened the racket face into a soft cut/drop or boast!
    const isDisguised = prepCharge >= 0.65 && (isCutModifier || isBoastRequest);

    let shotId = SQUASH_SHOT_TYPES.STRAIGHT_DRIVE;
    let label = 'STRAIGHT DRIVE';
    let cutAngleDeg = Number(sm.defaultDriveCutDeg ?? 2.0);
    let forearmPronationDegPerSec = 540;
    let vel = new THREE.Vector3();
    let spin = new THREE.Vector3();

    const dzToFront = COURT_SPECS.FRONT_WALL_Z - contactPos.z; // negative value

    const isTrappedAtBack =
      rawRequested === 'back_wall_boast' ||
      (contactPos.z >= 3.10 && !isOffBackWall && Math.abs(contactPos.x) > 1.15) ||
      contactPos.z >= 3.48;

    if (isBoastRequest && isTrappedAtBack) {
      // --- BACK-WALL RECOVERY BOAST (Trapped at Back of Court -> Back Glass + Side Wall + Front Wall) ---
      shotId = SQUASH_SHOT_TYPES.BACK_WALL_BOAST;
      label = 'BACK-WALL BOAST';
      cutAngleDeg = 28;
      forearmPronationDegPerSec = 390;
      const dzToBack = Math.max(0.45, COURT_SPECS.BACK_WALL_Z - contactPos.z);
      // Launch into Back Glass Wall + Near Side Wall with sufficient pace & loft to reach Front Wall above Tin
      vel.set(
        playerSideSign * 6.8,
        5.15 + Math.max(0, (0.85 - contactPos.y) * 1.4),
        Math.max(33.5, 29.0 + dzToBack * 2.2)
      );
      spin.set(-14 * spinScale, playerSideSign * 8 * spinScale, 0);
    } else if (isBoastRequest) {
      // --- ATTACKING SIDEWALL -> FRONTWALL -> NICK BOAST ---
      shotId = SQUASH_SHOT_TYPES.TWO_WALL_BOAST;
      label = isDisguised
        ? 'DISGUISED NICK BOAST'
        : isOffBackWall
        ? 'OFF-BACK-WALL NICK BOAST'
        : 'SIDE-FRONT NICK BOAST';
      cutAngleDeg = 24;
      forearmPronationDegPerSec = 430;

      const boastSol = this._computeSideFrontNickBoastVector(contactPos, playerSideSign, params);
      vel.copy(boastSol.vel);
      spin.copy(boastSol.spin);
    } else if (isCutModifier) {
      // --- OPEN-FACED CUT DROP / DISGUISED HOLD-AND-DROP ---
      shotId = isDisguised ? SQUASH_SHOT_TYPES.DISGUISED_DROP : SQUASH_SHOT_TYPES.COUNTER_DROP;
      label = isDisguised
        ? 'DISGUISED DROP'
        : isOffBackWall
        ? 'BACK-WALL DROP'
        : isVolley
        ? 'VOLLEY DROP'
        : 'SOFT CUT DROP';
      cutAngleDeg = Number(sm.defaultDropCutDeg ?? 34.0);
      forearmPronationDegPerSec = 185; // Soft decelerated wrist with open face

      // Aim toward front corner nick zone
      const targetCornerSign =
        Math.abs(Number(inputEvent.dirX ?? 0)) > 0.25
          ? Math.sign(Number(inputEvent.dirX))
          : playerSideSign;
      const targetX = targetCornerSign * THREE.MathUtils.lerp(2.42, 2.68, assist);
      const targetFrontY = THREE.MathUtils.lerp(0.88, 0.82, assist);

      const dropSpeed = Number(sm.softDropSpeedMps ?? 11.4);
      const flightSec = THREE.MathUtils.clamp(Math.abs(dzToFront) / dropSpeed, 0.36, 0.62);
      const dx = targetX - contactPos.x;
      const dy = targetFrontY - contactPos.y;

      vel.set(
        dx / flightSec,
        (dy + 0.5 * g * flightSec * flightSec) / flightSec,
        dzToFront / flightSec
      );
      // Underspin (negative spin.x) makes the ball bite downward off the front wall toward the nick
      spin.set(-22 * spinScale, -targetCornerSign * 8 * spinScale, 0);
    } else if (isLobRequest) {
      // --- HIGH DEFENSIVE / ATTACKING LOB ---
      shotId = SQUASH_SHOT_TYPES.HIGH_LOB;
      label = isOffBackWall ? 'BACK-WALL LOB' : 'HIGH LOB';
      cutAngleDeg = Number(sm.lobLaunchAngleDeg ?? 38.0);
      forearmPronationDegPerSec = 240;

      const targetX = -playerSideSign * 2.35;
      const targetFrontY = 3.75;
      const flightSec = THREE.MathUtils.clamp(Math.abs(dzToFront) / 11.5, 0.48, 0.78);
      const dx = targetX - contactPos.x;
      const dy = targetFrontY - contactPos.y;

      vel.set(
        dx / flightSec,
        (dy + 0.5 * g * flightSec * flightSec) / flightSec,
        dzToFront / flightSec
      );
      spin.set(-10 * spinScale, 0, 0);
    } else if (isKillRequest) {
      // --- AGGRESSIVE VOLLEY KILL (Nick Hunter) ---
      shotId = SQUASH_SHOT_TYPES.VOLLEY_KILL;
      label = 'VOLLEY KILL';
      cutAngleDeg = 3.0;
      forearmPronationDegPerSec = 780;

      const targetCornerSign =
        Math.abs(Number(inputEvent.dirX ?? 0)) > 0.2
          ? Math.sign(Number(inputEvent.dirX))
          : playerSideSign;
      const targetX = targetCornerSign * THREE.MathUtils.lerp(2.58, 2.76, assist);
      const targetFrontY = THREE.MathUtils.lerp(0.72, 0.66, assist);
      const killSpeed = Number(sm.maxKillSpeedMps ?? 31.0);
      const flightSec = THREE.MathUtils.clamp(Math.abs(dzToFront) / killSpeed, 0.16, 0.28);

      const dx = targetX - contactPos.x;
      const dy = targetFrontY - contactPos.y;
      vel.set(
        dx / flightSec,
        (dy + 0.5 * g * flightSec * flightSec) / flightSec,
        dzToFront / flightSec
      );
      spin.set(10 * spinScale, -targetCornerSign * 6 * spinScale, 0);
    } else {
      // --- DEEP STRAIGHT DRIVE (TIGHT RAIL), CROSS-COURT DRIVE, OR RISING OFF-BACK-WALL DRIVE ---
      shotId = isOffBackWall
        ? SQUASH_SHOT_TYPES.OFF_BACK_WALL_DRIVE
        : isCrossRequest
        ? SQUASH_SHOT_TYPES.CROSS_DRIVE
        : SQUASH_SHOT_TYPES.STRAIGHT_DRIVE;

      if (isOffBackWall) {
        label = isRisingOffBackWall
          ? isCrossRequest
            ? 'RISING BACK-WALL CROSS'
            : 'RISING OFF-BACK-WALL DRIVE'
          : isCrossRequest
          ? 'OFF-BACK-WALL CROSS'
          : 'OFF-BACK-WALL DRIVE';
      } else {
        label = isCrossRequest ? 'CROSS-COURT DRIVE' : 'TIGHT RAIL DRIVE';
      }

      cutAngleDeg = Number(sm.defaultDriveCutDeg ?? 2.0);
      forearmPronationDegPerSec = isRisingOffBackWall ? 660 : 610;

      const railX = playerSideSign * THREE.MathUtils.lerp(2.65, 2.92, assist);
      const crossX = -playerSideSign * THREE.MathUtils.lerp(2.25, 2.65, assist);
      const targetX = isCrossRequest ? crossX : railX;

      // Hit high and crisp enough on the front wall (~1.68m - 1.98m) so a good drive carries deep
      // past the service box, bounces once in the back quarter, and reaches the Back Glass Wall!
      const risingBonus = isRisingOffBackWall ? 1.07 : 1.0;
      const baseSpeed =
        Number(sm.baseDriveSpeedMps ?? 24.5) *
        THREE.MathUtils.clamp(Number(inputEvent.speed ?? 1.12), 0.92, 1.32) *
        risingBonus;
      const targetFrontY = THREE.MathUtils.clamp(
        (isOffBackWall ? 1.82 : 1.72) + (24.5 / baseSpeed) * 0.22,
        1.42,
        2.28
      );
      const flightSec = THREE.MathUtils.clamp(Math.abs(dzToFront) / baseSpeed, 0.24, 0.44);

      const dx = targetX - contactPos.x;
      const dy = targetFrontY - contactPos.y;
      vel.set(
        dx / flightSec,
        (dy + 0.5 * g * flightSec * flightSec) / flightSec,
        dzToFront / flightSec
      );
      spin.set(14 * spinScale, 0, 0);
    }

    const speedKmh = Math.round(vel.length() * 3.6);
    const timingGrade = isRisingOffBackWall
      ? 'RISING OFF BACK WALL ★'
      : isOffBackWall
      ? 'OFF BACK WALL RETURN'
      : isDisguised
      ? 'DISGUISED HOLD!'
      : Math.abs(cutAngleDeg) >= 24
      ? `OPEN CUT ${Math.round(cutAngleDeg)}°`
      : 'SWEET SPOT';

    return {
      shotId,
      label,
      vel,
      spin,
      cutAngleDeg,
      forearmPronationDegPerSec,
      isDisguised,
      isOffBackWall,
      isRisingOffBackWall,
      prepDurationSec: prepSnapshot ? prepSnapshot.durationSec : 0,
      timingGrade,
      speedKmh
    };
  }

  /**
   * Computes the exact 2-cushion attacking boast launch vector so the ball:
   *   1. Strikes the near Side Wall (`X = ±3.20m`)
   *   2. Angles across onto the Front Wall (`Z = -4.875m`, above the 0.48m Tin)
   *   3. Lands directly into the opposite Side-Wall / Floor Nick junction (`X = ∓3.20m, Y = 0`).
   */
  _computeSideFrontNickBoastVector(contactPos, sideSign, params = {}) {
    const bp = params.ballPhysics || {};
    const tempFactor = Math.max(0.76, Math.min(1.18, 1.0 + ((bp.ballTemperatureC ?? 36) - 36) * 0.011));
    const corSide = Math.min(0.86, (bp.sideWallRestitution ?? 0.66) * tempFactor);
    const friction = Number(bp.surfaceFriction ?? 0.80);
    const spinScale = Number(params.shotMechanics?.spinMagnitudeScale ?? 1.0);
    const spin = new THREE.Vector3(-12 * spinScale, sideSign * 14 * spinScale, 0);

    const radius = COURT_SPECS.BALL_RADIUS * 1.65;
    const sideLimitX = COURT_SPECS.HALF_WIDTH - radius; // 3.167m
    const frontLimitZ = COURT_SPECS.FRONT_WALL_Z + radius; // -4.842m

    const dx1 = Math.max(0.35, sideLimitX - sideSign * contactPos.x);
    const dzFront = Math.max(1.8, contactPos.z - frontLimitZ);
    const dxAcross = 2 * sideLimitX; // 6.334m across court from near side wall to opposite nick

    const tFront = THREE.MathUtils.clamp(dzFront / 19.5, 0.25, 0.42);
    const tAfterFront = 0.17;
    const K = dxAcross / (dx1 * corSide * 0.96);
    const t1 = (tFront + friction * tAfterFront) / (1 + K);

    const baseVx = sideSign * (dx1 / t1) * 1.005;
    const baseVz = -(dzFront / (t1 + friction * (tFront - t1))) * 1.02;
    const baseVy = (0.72 - contactPos.y) / tFront + 0.5 * 9.81 * (tFront + tAfterFront) * 0.56;

    let bestVel = new THREE.Vector3(baseVx, baseVy, baseVz);
    let bestScore = 1e9;

    for (const dvy of [-0.55, -0.35, -0.18, 0, 0.18, 0.36, 0.55, 0.75]) {
      const candVel = new THREE.Vector3(baseVx, baseVy + dvy, baseVz);
      const sim = BallPhysics.simulateTrajectory(
        { pos: contactPos, vel: candVel, spin },
        params,
        null,
        { maxTimeSec: 0.75 }
      );
      const sideHit = sim.events.find((c) => c.surface.startsWith('side_wall'));
      const frontHit = sim.events.find((c) => c.surface === 'front_wall');
      const firstBounce = sim.events.find((c) => c.surface === 'nick' || c.surface === 'floor');
      if (!sideHit || !frontHit || !firstBounce || frontHit.isTin || frontHit.isOut) continue;
      if (sim.events.indexOf(sideHit) > sim.events.indexOf(frontHit)) continue;
      const targetNickX = -sideSign * sideLimitX;
      const xErr = Math.abs(firstBounce.pos.x - targetNickX);
      const nickBonus = firstBounce.isNick ? -2.0 : 0;
      const score = xErr + nickBonus;
      if (score < bestScore) {
        bestScore = score;
        bestVel = candVel;
      }
      if (firstBounce.isNick) break;
    }

    return { vel: bestVel, spin };
  }
}

export default ShotController;
