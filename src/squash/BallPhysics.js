// ============================================================================
// ARGON SQUASH — 120HZ CONTINUOUS COLLISION DETECTION (CCD) BALL PHYSICS
// Handles gravity, aerodynamic drag, Magnus spin coupling, ball temperature
// restitution scaling, 4-wall + tin + floor rebounds, and deterministic
// trajectory prediction for AI and A/B Tuning Lab comparison.
// ============================================================================

import * as THREE from 'three';
import { COURT_SPECS, getSideWallOutHeightAtZ } from './CourtGeometry.js';
import { NickCollisionModel } from './NickCollisionModel.js';

const _subStepVel = new THREE.Vector3();

export class BallPhysics {
  /**
   * Advances the squash ball by `dt` seconds using 4 CCD sub-steps so high-speed
   * drives and corner nick junctions never tunnel through walls or the floor.
   */
  static stepBallPhysics(ball, dt, params, tuningStoreRef, callbacks = {}) {
    if (!ball || !ball.inPlay) return [];

    const bp = params.ballPhysics || {};
    const rv = params.rulesAndView || {};
    const tempFactor = tuningStoreRef
      ? tuningStoreRef.getTemperatureBounceFactor(params)
      : Math.max(0.76, Math.min(1.18, 1.0 + ((bp.ballTemperatureC ?? 36) - 36) * 0.011));

    const gravity = Number(bp.gravity ?? 9.81);
    const airDrag = Number(bp.airDrag ?? 0.018);
    const magnus = Number(bp.magnusSpinCoupling ?? 0.012);
    const friction = Number(bp.surfaceFriction ?? 0.80);
    const spinBite = Number(bp.spinSurfaceBite ?? 0.024);
    const tinHeight = Number(rv.tinHeightMeters ?? COURT_SPECS.TIN_HEIGHT_Y);
    const radius = COURT_SPECS.BALL_RADIUS * 1.65; // ~0.033m collision radius

    const subSteps = 4;
    const subDt = dt / subSteps;
    const collisions = [];

    for (let s = 0; s < subSteps; s++) {
      const speed = ball.vel.length();
      const dragFactor = Math.max(0, 1.0 - airDrag * speed * subDt);
      ball.vel.multiplyScalar(dragFactor);

      // Gravity + Magnus vertical/lateral spin coupling
      // spin.x > 0 = topspin (pushes ball down faster); spin.x < 0 = underspin/cut (floats ball slightly)
      ball.vel.y -= (gravity + ball.spin.x * magnus * 8.5) * subDt;
      ball.vel.x += ball.spin.y * magnus * 6.0 * subDt;

      _subStepVel.copy(ball.vel).multiplyScalar(subDt);
      ball.pos.add(_subStepVel);

      // 1. Check Front Wall (Z = -4.875m)
      const frontLimitZ = COURT_SPECS.FRONT_WALL_Z + radius;
      if (ball.pos.z <= frontLimitZ && ball.vel.z < 0) {
        const impactPos = ball.pos.clone();
        impactPos.z = COURT_SPECS.FRONT_WALL_Z;
        const impactSpeed = Math.abs(ball.vel.z);

        const hitTin = ball.pos.y <= tinHeight + radius * 0.5;
        const hitOut = ball.pos.y >= COURT_SPECS.FRONT_WALL_OUT_Y;

        ball.pos.z = frontLimitZ + 0.002;
        const cor = Math.min(0.88, (bp.frontWallRestitution ?? 0.68) * tempFactor);
        ball.vel.z = -ball.vel.z * (hitTin ? 0.32 : cor);
        ball.vel.x *= friction;

        // Spin bite on front wall: underspin (spin.x < 0) makes the ball rebound lower off the front wall!
        ball.vel.y = ball.vel.y * friction + ball.spin.x * spinBite;
        ball.spin.multiplyScalar(0.68);

        ball.hitFrontWallThisShot = !hitTin && !hitOut;
        ball.wallHitCountThisShot = (ball.wallHitCountThisShot || 0) + 1;

        NickCollisionModel.evaluateFrontCornerJunction(ball, params);

        const evt = {
          surface: hitTin ? 'tin' : 'front_wall',
          pos: impactPos,
          speed: impactSpeed,
          isTin: hitTin,
          isOut: hitOut,
          isNick: false
        };
        collisions.push(evt);
        if (callbacks.onCollision) callbacks.onCollision(evt);
      }

      // 2. Check Side Walls (X = -3.20m and X = +3.20m)
      const sideLimitX = COURT_SPECS.HALF_WIDTH - radius;
      if (Math.abs(ball.pos.x) >= sideLimitX) {
        const isRight = ball.pos.x > 0;
        if ((isRight && ball.vel.x > 0) || (!isRight && ball.vel.x < 0)) {
          const impactPos = ball.pos.clone();
          impactPos.x = isRight ? COURT_SPECS.RIGHT_WALL_X : COURT_SPECS.LEFT_WALL_X;
          const impactSpeed = Math.abs(ball.vel.x);
          const maxWallY = getSideWallOutHeightAtZ(ball.pos.z);
          const hitOut = ball.pos.y >= maxWallY;

          // First check if this side-wall contact is simultaneously a Wall-Floor Nick!
          const nickEval = NickCollisionModel.evaluateWallFloorNick(ball, params);
          if (nickEval.triggered) {
            ball.bounceCountOnFloor = (ball.bounceCountOnFloor || 0) + 1;
            ball.lastBounceWasNick = true;
            const evt = {
              surface: 'nick',
              pos: impactPos,
              speed: impactSpeed,
              isTin: false,
              isOut: false,
              isNick: true,
              nickData: nickEval
            };
            collisions.push(evt);
            if (callbacks.onCollision) callbacks.onCollision(evt);
            continue;
          }

          ball.pos.x = (isRight ? 1 : -1) * (sideLimitX - 0.002);
          const cor = Math.min(0.86, (bp.sideWallRestitution ?? 0.66) * tempFactor);
          ball.vel.x = -ball.vel.x * cor;
          ball.vel.z *= friction;
          ball.vel.y *= friction;
          ball.spin.multiplyScalar(0.75);
          ball.wallHitCountThisShot = (ball.wallHitCountThisShot || 0) + 1;

          const evt = {
            surface: isRight ? 'side_wall_right' : 'side_wall_left',
            pos: impactPos,
            speed: impactSpeed,
            isTin: false,
            isOut: hitOut,
            isNick: false
          };
          collisions.push(evt);
          if (callbacks.onCollision) callbacks.onCollision(evt);
        }
      }

      // 3. Check Back Glass Wall (Z = +4.875m)
      const backLimitZ = COURT_SPECS.BACK_WALL_Z - radius;
      if (ball.pos.z >= backLimitZ && ball.vel.z > 0) {
        const impactPos = ball.pos.clone();
        impactPos.z = COURT_SPECS.BACK_WALL_Z;
        const impactSpeed = Math.abs(ball.vel.z);
        const hitOut = ball.pos.y >= COURT_SPECS.BACK_WALL_OUT_Y;

        ball.pos.z = backLimitZ - 0.002;
        const cor = Math.min(0.86, (bp.backWallRestitution ?? 0.64) * tempFactor);
        ball.vel.z = -ball.vel.z * cor;
        ball.vel.x *= friction;

        // Authentic Squash Back-Wall Rebound Physics:
        // When a deep drive bounces once on the floor and hits the back glass wall,
        // its forward topspin roll bites against the glass and pops the ball UPWARD
        // as it returns forward (vel.z < 0, vel.y > 0), allowing the receiver to
        // strike the ball coming upwards off the back wall!
        const sitUpScale = Number(bp.backWallSitUpLift ?? 1.05);
        if ((ball.bounceCountOnFloor || 0) <= 1 && !hitOut && sitUpScale > 0) {
          const forwardRoll = Math.max(0, ball.spin.x);
          const upwardKick =
            (1.95 + Math.min(1.4, impactSpeed * 0.14 + forwardRoll * 0.045)) *
            sitUpScale *
            tempFactor;
          ball.vel.y = Math.max(ball.vel.y * friction + 1.35, upwardKick);
          // Ensure sufficient forward rebound speed so the ball steps out into the playable back pocket
          ball.vel.z = Math.min(ball.vel.z, -Math.max(4.5, impactSpeed * cor));
        } else {
          ball.vel.y *= friction * 0.92;
        }

        ball.spin.multiplyScalar(0.72);
        ball.hitBackWallThisShot = !hitOut;
        ball.wallHitCountThisShot = (ball.wallHitCountThisShot || 0) + 1;

        const evt = {
          surface: 'back_wall',
          pos: impactPos,
          speed: impactSpeed,
          isTin: false,
          isOut: hitOut,
          isNick: false
        };
        collisions.push(evt);
        if (callbacks.onCollision) callbacks.onCollision(evt);
      }

      // 4. Check Floor (Y = 0) & Wall-Floor Nick Junction
      if (ball.pos.y <= radius && ball.vel.y < 0) {
        const impactPos = ball.pos.clone();
        impactPos.y = 0;
        const impactSpeed = Math.abs(ball.vel.y);

        // Evaluate Wall-Floor Nick first
        const nickEval = NickCollisionModel.evaluateWallFloorNick(ball, params);
        if (nickEval.triggered) {
          ball.bounceCountOnFloor = (ball.bounceCountOnFloor || 0) + 1;
          ball.lastBounceWasNick = true;
          const evt = {
            surface: 'nick',
            pos: impactPos,
            speed: impactSpeed,
            isTin: false,
            isOut: false,
            isNick: true,
            nickData: nickEval
          };
          collisions.push(evt);
          if (callbacks.onCollision) callbacks.onCollision(evt);
          continue;
        }

        ball.pos.y = radius;
        const cor = Math.min(0.82, (bp.floorRestitution ?? 0.56) * tempFactor);
        // Underspin (spin.x < 0) checks forward velocity and lowers bounce
        const spinZCheck = ball.spin.x < 0 ? 0.84 : 0.94;
        ball.vel.y = -ball.vel.y * cor;
        ball.vel.x *= friction;
        ball.vel.z *= friction * spinZCheck;

        // Forward floor travel imparts natural topspin roll toward the back wall
        if (ball.vel.z > 3.0 && ball.spin.x >= -4) {
          ball.spin.x = Math.max(ball.spin.x * 0.75, Math.min(20, ball.vel.z * 1.05));
        } else {
          ball.spin.multiplyScalar(0.65);
        }

        ball.bounceCountOnFloor = (ball.bounceCountOnFloor || 0) + 1;

        const evt = {
          surface: 'floor',
          pos: impactPos,
          speed: impactSpeed,
          isTin: false,
          isOut: false,
          isNick: false,
          bounceNumber: ball.bounceCountOnFloor
        };
        collisions.push(evt);
        if (callbacks.onCollision) callbacks.onCollision(evt);
      }
    }

    return collisions;
  }

  /**
   * Deterministic forward trajectory predictor used by OpponentAI for interception
   * AND by the Live Tuning Lab for side-by-side A/B preset comparison.
   * Explicitly identifies when a deep drive will reach the back wall and computes
   * the optimal rising off-the-back-wall strike position (`optimalBackWallStrikePos`).
   */
  static simulateTrajectory(initialBall, params, tuningStoreRef = null, { maxTimeSec = 2.8, dt = 1 / 120 } = {}) {
    const simBall = {
      pos: initialBall.pos.clone(),
      vel: initialBall.vel.clone(),
      spin: initialBall.spin ? initialBall.spin.clone() : new THREE.Vector3(),
      inPlay: true,
      hitFrontWallThisShot: !!initialBall.hitFrontWallThisShot,
      hitBackWallThisShot: !!initialBall.hitBackWallThisShot,
      bounceCountOnFloor: Number(initialBall.bounceCountOnFloor || 0),
      wallHitCountThisShot: Number(initialBall.wallHitCountThisShot || 0),
      lastBounceWasNick: false
    };

    const samples = [];
    const events = [];
    let firstFloorBouncePos = null;
    let secondFloorBouncePos = null;
    let backWallImpactPos = null;
    let willHitBackWallBeforeSecondBounce = false;
    let optimalBackWallStrikePos = null;
    let maxBounceHeightAfterFirst = 0;
    let nickTriggered = false;
    let nickInfo = null;

    const steps = Math.floor(maxTimeSec / dt);
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      this.stepBallPhysics(simBall, dt, params, tuningStoreRef, {
        onCollision: (evt) => {
          events.push({ t, ...evt });
          if (evt.isNick) {
            nickTriggered = true;
            nickInfo = evt.nickData;
            if (!firstFloorBouncePos) firstFloorBouncePos = evt.pos.clone();
          } else if (evt.surface === 'back_wall' && !evt.isOut) {
            if (!backWallImpactPos) backWallImpactPos = evt.pos.clone();
            if (simBall.bounceCountOnFloor <= 1) {
              willHitBackWallBeforeSecondBounce = true;
            }
          } else if (evt.surface === 'floor') {
            if (evt.bounceNumber === 1 && !firstFloorBouncePos) {
              firstFloorBouncePos = evt.pos.clone();
            } else if (evt.bounceNumber === 2 && !secondFloorBouncePos) {
              secondFloorBouncePos = evt.pos.clone();
            }
          }
        }
      });

      if (simBall.bounceCountOnFloor === 1 && simBall.pos.y > maxBounceHeightAfterFirst) {
        maxBounceHeightAfterFirst = simBall.pos.y;
      }

      // Capture optimal strike point AFTER the ball rebounds off the back wall and is rising/cresting forward
      if (
        willHitBackWallBeforeSecondBounce &&
        simBall.hitBackWallThisShot &&
        simBall.bounceCountOnFloor <= 1 &&
        simBall.vel.z < 0
      ) {
        // Prefer the point where the ball has stepped 0.70m - 1.35m forward off the back glass while rising/at crest
        const distFromBackGlass = COURT_SPECS.BACK_WALL_Z - simBall.pos.z;
        if (
          !optimalBackWallStrikePos ||
          (distFromBackGlass >= 0.65 && distFromBackGlass <= 1.45 && simBall.vel.y >= -0.15)
        ) {
          optimalBackWallStrikePos = simBall.pos.clone();
        }
      }

      if (i % 2 === 0) {
        samples.push({
          t,
          pos: simBall.pos.clone(),
          vel: simBall.vel.clone(),
          bounceCount: simBall.bounceCountOnFloor,
          hitBackWall: !!simBall.hitBackWallThisShot
        });
      }

      if (simBall.bounceCountOnFloor >= 2 && samples.length > 20) {
        break;
      }
    }

    // Determine best tactical intercept target:
    // If the shot is a deep drive that hits the back wall before its second bounce,
    // the optimal squash return is AFTER it rebounds forward & upward off the back wall!
    const optimalInterceptPos =
      willHitBackWallBeforeSecondBounce && optimalBackWallStrikePos
        ? optimalBackWallStrikePos.clone()
        : firstFloorBouncePos
          ? firstFloorBouncePos.clone()
          : samples.length > 0
            ? samples[samples.length - 1].pos.clone()
            : initialBall.pos.clone();

    return {
      samples,
      events,
      firstFloorBouncePos,
      secondFloorBouncePos,
      backWallImpactPos,
      willHitBackWallBeforeSecondBounce,
      optimalBackWallStrikePos,
      optimalInterceptPos,
      maxBounceHeightAfterFirst,
      nickTriggered,
      nickInfo,
      finalPos: simBall.pos.clone()
    };
  }
}

export default BallPhysics;
