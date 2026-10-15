// ============================================================================
// ARGON SQUASH — PLAYER MOVEMENT & AUTO-T-RETURN CONTROLLER
// Implements Section 10: Prominent AUTO-T-RETURN: ON / OFF toggle, realistic
// acceleration, inertia, court boundary clamping, and shared-court clearing.
// ============================================================================

import * as THREE from 'three';
import { COURT_SPECS } from './CourtGeometry.js';

const _desiredVel = new THREE.Vector3();

export class PlayerMovement {
  /**
   * Computes the canonical T-Position recovery target from `params.movementAndAI`.
   */
  static getTRecoveryPosition(params = {}, offsetRole = 'player') {
    const ma = params.movementAndAI || {};
    const tx = Number(ma.tTargetX ?? COURT_SPECS.T_POS.x);
    const tz = Number(ma.tTargetZ ?? COURT_SPECS.T_POS.z);
    // Slight natural staggered offset so both shared-court players don't stand on the exact same millimeter
    const roleOffsetX = offsetRole === 'player' ? -0.18 : 0.18;
    const roleOffsetZ = offsetRole === 'player' ? 0.08 : -0.08;
    return new THREE.Vector3(tx + roleOffsetX, 0, tz + roleOffsetZ);
  }

  /**
   * Updates an actor's target position during a rally based on whether they are:
   * - The Receiver (moving to intercept the incoming ball after front-wall rebound), OR
   * - The Hitter (recovering toward the T if AUTO-T-RETURN is ON, or holding position if OFF).
   */
  static updatePlayerRallyTarget({
    player,
    opponent,
    ball,
    keysDown,
    poseLungeOffset,
    params,
    interceptPoint,
    predictedTrajectory
  }) {
    const ma = params.movementAndAI || {};
    const autoT = ma.autoTReturn !== false;

    // 1. Check for manual keyboard locomotion (WASD / Arrow keys)
    let manualX = 0;
    let manualZ = 0;
    if (keysDown) {
      if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) manualX -= 1;
      if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) manualX += 1;
      if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) manualZ -= 1;
      if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) manualZ += 1;
    }

    const hasManualInput = manualX !== 0 || manualZ !== 0;

    if (hasManualInput) {
      const len = Math.hypot(manualX, manualZ) || 1;
      player.targetPos.set(
        THREE.MathUtils.clamp(player.pos.x + (manualX / len) * 1.4, -2.78, 2.78),
        0,
        THREE.MathUtils.clamp(player.pos.z + (manualZ / len) * 1.4, -4.1, 4.48)
      );
      return;
    }

    // 2. Check for live full-body webcam pose lunge offset around the T
    if (poseLungeOffset && poseLungeOffset.active) {
      const tPos = this.getTRecoveryPosition(params, 'player');
      player.targetPos.set(
        THREE.MathUtils.clamp(tPos.x + poseLungeOffset.x * 2.6, -2.78, 2.78),
        0,
        THREE.MathUtils.clamp(tPos.z + poseLungeOffset.z * 2.5, -3.8, 4.42)
      );
      return;
    }

    // 3. When opponent just hit the ball -> Player is Receiver
    if (ball && ball.inPlay && ball.lastHitter === 'opponent') {
      if (autoT) {
        // Check if this is a deep drive that will hit the Back Glass Wall before bouncing twice
        const willComeOffBackWall = Boolean(
          predictedTrajectory?.willHitBackWallBeforeSecondBounce &&
            predictedTrajectory?.optimalBackWallStrikePos
        );

        let targetBallPos = interceptPoint || ball.pos;
        if (ball.hitBackWallThisShot && ball.vel.z < 0) {
          // Ball has already rebounded forward off the back wall — step into the rising ball!
          targetBallPos = ball.pos;
        } else if (willComeOffBackWall) {
          // Let the deep drive hit the back wall first and wait at the rising forward rebound pocket!
          targetBallPos = predictedTrajectory.optimalBackWallStrikePos;
        } else if (predictedTrajectory?.optimalInterceptPos) {
          targetBallPos = predictedTrajectory.optimalInterceptPos;
        }

        // Stand slightly beside the ball's path (~0.42m lateral spacing) for clean racket swing clearance
        const strikeSpacingX = targetBallPos.x >= 0 ? -0.42 : 0.42;
        const zOffset = willComeOffBackWall || ball.hitBackWallThisShot ? 0.12 : 0.18;
        player.targetPos.set(
          THREE.MathUtils.clamp(targetBallPos.x + strikeSpacingX, -2.78, 2.78),
          0,
          THREE.MathUtils.clamp(targetBallPos.z + zOffset, -4.1, 4.46)
        );
      }
      return;
    }

    // 4. When Player just hit the ball -> Recovery Phase!
    if (ball && ball.inPlay && ball.lastHitter === 'player') {
      if (autoT) {
        const tPos = this.getTRecoveryPosition(params, 'player');
        player.targetPos.copy(tPos);
      } else {
        // AUTO-T-RETURN: OFF -> Player remains where they played the shot unless manually moved!
        player.targetPos.copy(player.pos);
      }
    }
  }

  /**
   * Steps physical locomotion with acceleration, inertia, T-recovery speed scaling,
   * court boundary clamping, and subtle shared-court body clearing.
   */
  static stepActorLocomotion(actor, otherActor, dt, params = {}, isRecoveringToT = false) {
    const ma = params.movementAndAI || {};
    const baseMaxSpeed = Number(ma.playerMaxSpeedMps ?? 6.8);
    const accel = Number(ma.playerAccelerationMps2 ?? 18.5);
    const recoveryScale = isRecoveringToT ? Number(ma.tRecoverySpeedScale ?? 0.86) : 1.0;
    const maxSpeed = Math.min(baseMaxSpeed, actor.maxSpeed || baseMaxSpeed) * recoveryScale;

    const dx = actor.targetPos.x - actor.pos.x;
    const dz = actor.targetPos.z - actor.pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.04) {
      // Smooth arrival deceleration within 0.55m of target
      const arrivalRamp = Math.min(1.0, dist / 0.55);
      const targetSpeed = maxSpeed * arrivalRamp;
      _desiredVel.set((dx / dist) * targetSpeed, 0, (dz / dist) * targetSpeed);
    } else {
      _desiredVel.set(0, 0, 0);
    }

    // Apply physical acceleration/inertia limit (dv <= accel * dt)
    const dvX = _desiredVel.x - actor.vel.x;
    const dvZ = _desiredVel.z - actor.vel.z;
    const dvMag = Math.hypot(dvX, dvZ);
    const maxDv = accel * dt;

    if (dvMag > maxDv && dvMag > 1e-5) {
      actor.vel.x += (dvX / dvMag) * maxDv;
      actor.vel.z += (dvZ / dvMag) * maxDv;
    } else {
      actor.vel.x = _desiredVel.x;
      actor.vel.z = _desiredVel.z;
    }

    // Subtle body-clearing repulsion so players step around each other in shared court
    if (otherActor && otherActor !== actor) {
      const sepX = actor.pos.x - otherActor.pos.x;
      const sepZ = actor.pos.z - otherActor.pos.z;
      const sepDist = Math.hypot(sepX, sepZ);
      const minPersonalSpace = 0.62;
      if (sepDist > 0.001 && sepDist < minPersonalSpace) {
        const push = (minPersonalSpace - sepDist) * 3.2 * dt;
        actor.pos.x += (sepX / sepDist) * push;
        actor.pos.z += (sepZ / sepDist) * push;
      }
    }

    actor.pos.x += actor.vel.x * dt;
    actor.pos.z += actor.vel.z * dt;

    // Clamp strictly inside the 4 walls (allowing players to step into the back corners for off-back-wall digs)
    const wallMarginX = 0.40;
    const wallMarginBackZ = 0.34;
    actor.pos.x = THREE.MathUtils.clamp(
      actor.pos.x,
      COURT_SPECS.LEFT_WALL_X + wallMarginX,
      COURT_SPECS.RIGHT_WALL_X - wallMarginX
    );
    actor.pos.z = THREE.MathUtils.clamp(
      actor.pos.z,
      COURT_SPECS.FRONT_WALL_Z + 0.65,
      COURT_SPECS.BACK_WALL_Z - wallMarginBackZ
    );

    const actualSpeed = Math.hypot(actor.vel.x, actor.vel.z);
    if (actualSpeed > 0.12) {
      actor.stridePhase = (actor.stridePhase || 0) + actualSpeed * dt * 4.4;
    }

    // Both actors face the Front Wall (-Z => rotation.y = 0) with subtle turn toward ball/movement
    const targetYaw = THREE.MathUtils.clamp(-actor.vel.x * 0.06, -0.35, 0.35);
    actor.root.rotation.y = THREE.MathUtils.lerp(actor.root.rotation.y, targetYaw, 1 - Math.exp(-10 * dt));
    actor.root.position.copy(actor.pos);
  }
}

export default PlayerMovement;
