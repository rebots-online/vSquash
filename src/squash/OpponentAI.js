// ============================================================================
// ARGON SQUASH — PHYSICAL CHESS OPPONENT AI
// Implements Section 4 & Milestone E:
//   - Pattern-memory window (can be lulled into a deep straight-drive rhythm)
//   - Preparation reading & split-step reaction lag when player disguises a shot
//   - Respects identical physical speed, acceleration, and T-recovery rules
//   - Tactically mixes deep rails, cross-courts, boasts, drops, and volley kills
// ============================================================================

import * as THREE from 'three';
import { COURT_SPECS } from './CourtGeometry.js';
import { PlayerMovement } from './PlayerMovement.js';
import { SQUASH_SHOT_TYPES } from './ShotController.js';

export class OpponentAI {
  constructor(role = 'opponent') {
    this.role = role;
    this.resetMemory();
  }

  resetMemory() {
    this.playerShotHistory = []; // Rolling window of opponent shot types & depths
    this.anticipatedBiasZ = 0;   // Positive = leaning deep behind T; Negative = creeping forward
    this.anticipatedBiasX = 0;
    this.reactionTimerSec = 0;   // Split-step delay when caught wrong-footed or disguised
    this.currentIntercept = new THREE.Vector3(0, 0.8, 1.8);
    this.hasValidIntercept = false;
    this.lastObservedStrokeCount = -1;
  }

  /**
   * Records a shot struck by the other player to update the AI's short-term pattern memory.
   */
  recordPlayerShot(shotResult, ballState, params = {}) {
    const ma = params.movementAndAI || {};
    const maxWindow = Math.max(1, Number(ma.aiPatternMemoryLength ?? 4));
    const antStrength = Number(ma.aiAnticipationStrength ?? 0.68);
    const baseDelaySec = Number(ma.aiReactionDelayMs ?? 195) / 1000;

    const isDeepDrive =
      shotResult.shotId === SQUASH_SHOT_TYPES.STRAIGHT_DRIVE ||
      shotResult.shotId === SQUASH_SHOT_TYPES.CROSS_DRIVE ||
      shotResult.shotId === SQUASH_SHOT_TYPES.OFF_BACK_WALL_DRIVE ||
      shotResult.shotId === SQUASH_SHOT_TYPES.HIGH_LOB;

    const isShortAttack =
      shotResult.shotId === SQUASH_SHOT_TYPES.DISGUISED_DROP ||
      shotResult.shotId === SQUASH_SHOT_TYPES.COUNTER_DROP ||
      shotResult.shotId === SQUASH_SHOT_TYPES.TWO_WALL_BOAST ||
      shotResult.shotId === SQUASH_SHOT_TYPES.BACK_WALL_BOAST ||
      shotResult.shotId === SQUASH_SHOT_TYPES.VOLLEY_KILL;

    // Check if the AI was lulled into expecting a deep drive and got hit with a disguised short shot!
    const recentDeepCount = this.playerShotHistory.filter((s) => s.isDeepDrive).length;
    const wasLulledDeep = recentDeepCount >= 2 && this.anticipatedBiasZ > 0.22;

    if (isShortAttack && (shotResult.isDisguised || wasLulledDeep)) {
      // Caught wrong-footed by disguise or drive rhythm!
      this.reactionTimerSec = baseDelaySec * (1.35 + antStrength * 0.45);
    } else {
      this.reactionTimerSec = baseDelaySec * 0.55;
    }

    this.playerShotHistory.push({
      shotId: shotResult.shotId,
      isDeepDrive,
      isShortAttack,
      sideX: Math.sign(ballState.pos.x || 1)
    });
    while (this.playerShotHistory.length > maxWindow) {
      this.playerShotHistory.shift();
    }

    // Recompute anticipation bias around the T for the NEXT rally exchange
    const deepRatio =
      this.playerShotHistory.filter((s) => s.isDeepDrive).length /
      Math.max(1, this.playerShotHistory.length);
    const shortRatio =
      this.playerShotHistory.filter((s) => s.isShortAttack).length /
      Math.max(1, this.playerShotHistory.length);

    const creepScale = Number(ma.aiFrontCourtCreep ?? 0.38);
    this.anticipatedBiasZ = (deepRatio * 0.62 - shortRatio * creepScale) * antStrength;
  }

  /**
   * Reads the other player's live preparation windup before contact.
   * When the hitter coils into a full backswing, the AI shifts slightly deeper
   * anticipating a hard drive—setting up the tactical payoff of a disguised drop.
   */
  observePlayerPreparation(opponentActor, playerActor, prepState, params = {}) {
    if (!prepState || !prepState.active) return;
    const selfRole = opponentActor?.role || this.role || 'opponent';
    const antStrength = Number(params.movementAndAI?.aiAnticipationStrength ?? 0.68);
    if (prepState.chargeNormalized > 0.55) {
      const tPos = PlayerMovement.getTRecoveryPosition(params, selfRole);
      const driftZ = 0.35 * prepState.chargeNormalized * antStrength;
      opponentActor.targetPos.set(
        tPos.x - Math.sign(playerActor.pos.x || 1) * 0.25,
        0,
        THREE.MathUtils.clamp(tPos.z + this.anticipatedBiasZ + driftZ, -1.5, 3.2)
      );
    }
  }

  /**
   * Updates AI target position and decides when/how to strike the ball.
   * Works for either 'opponent' or 'player' actor (enabling AI vs AI spectator matches).
   */
  updateAI({
    opponent,
    player,
    ball,
    dt,
    params,
    predictedTrajectory,
    onExecuteAIShot
  }) {
    if (!ball || !ball.inPlay || !opponent) return;
    const selfRole = opponent.role || this.role || 'opponent';

    // 1. If this AI actor just hit the ball -> Recover toward the T (with pattern-memory bias)
    if (ball.lastHitter === selfRole) {
      const tPos = PlayerMovement.getTRecoveryPosition(params, selfRole);
      opponent.targetPos.set(
        THREE.MathUtils.clamp(tPos.x + this.anticipatedBiasX, -1.8, 1.8),
        0,
        THREE.MathUtils.clamp(tPos.z + this.anticipatedBiasZ, -1.2, 2.8)
      );
      return;
    }

    // 2. Other player hit the ball -> This AI actor is Receiver
    if (this.reactionTimerSec > 0) {
      this.reactionTimerSec = Math.max(0, this.reactionTimerSec - dt);
      return;
    }

    const willComeOffBackWall = Boolean(
      predictedTrajectory?.willHitBackWallBeforeSecondBounce &&
        predictedTrajectory?.optimalBackWallStrikePos
    );

    // Update target intercept from predicted trajectory (preferring rising Off-Back-Wall pocket on deep drives!)
    if (ball.hitBackWallThisShot && ball.vel.z < 0) {
      this.currentIntercept.copy(ball.pos);
      const spacingX = this.currentIntercept.x >= 0 ? -0.38 : 0.38;
      opponent.targetPos.set(
        THREE.MathUtils.clamp(this.currentIntercept.x + spacingX, -2.78, 2.78),
        0,
        THREE.MathUtils.clamp(this.currentIntercept.z + 0.12, -3.9, 4.45)
      );
    } else if (willComeOffBackWall) {
      this.currentIntercept.copy(predictedTrajectory.optimalBackWallStrikePos);
      const spacingX = this.currentIntercept.x >= 0 ? -0.38 : 0.38;
      opponent.targetPos.set(
        THREE.MathUtils.clamp(this.currentIntercept.x + spacingX, -2.78, 2.78),
        0,
        THREE.MathUtils.clamp(this.currentIntercept.z + 0.12, -3.9, 4.45)
      );
    } else if (predictedTrajectory && predictedTrajectory.samples?.length > 0) {
      const viableSample =
        predictedTrajectory.samples.find(
          (s) => s.pos.z > -3.2 && s.pos.y >= 0.30 && s.pos.y <= 1.32 && s.bounceCount >= 1
        ) ||
        (predictedTrajectory.firstFloorBouncePos
          ? { pos: predictedTrajectory.firstFloorBouncePos }
          : predictedTrajectory.samples[predictedTrajectory.samples.length - 1]);

      if (viableSample && viableSample.pos) {
        this.currentIntercept.copy(viableSample.pos);
        const spacingX = this.currentIntercept.x >= 0 ? -0.38 : 0.38;
        opponent.targetPos.set(
          THREE.MathUtils.clamp(this.currentIntercept.x + spacingX, -2.78, 2.78),
          0,
          THREE.MathUtils.clamp(this.currentIntercept.z + 0.15, -3.9, 4.45)
        );
      }
    }

    // 3. Check if ball has already struck the front wall and is within physical strike reach
    if (!ball.hitFrontWallThisShot || opponent.swingCooldown > 0) return;

    // Authentic Squash Off-the-Back-Wall Discipline:
    // If a deep drive is heading to the back glass wall and is already past mid-court (Z > +0.85m),
    // let it hit the back glass first and strike it as it returns forward (vel.z < 0) and upwards!
    if (willComeOffBackWall && !ball.hitBackWallThisShot && ball.pos.z > 0.85 && ball.vel.z > 2.2) {
      return;
    }

    // Once it hits the back wall, wait a brief moment for it to pop forward & upward off the glass
    if (
      ball.hitBackWallThisShot &&
      ball.vel.z < 0 &&
      COURT_SPECS.BACK_WALL_Z - ball.pos.z < 0.32 &&
      ball.vel.y > 0.45
    ) {
      return;
    }

    const distXZ = Math.hypot(ball.pos.x - opponent.pos.x, ball.pos.z - opponent.pos.z);
    const reachableY = ball.pos.y >= 0.12 && ball.pos.y <= 2.15;
    const isComingOffBackWall = Boolean(ball.hitBackWallThisShot && ball.vel.z < 0);
    const movingTowardBackOrSlow =
      isComingOffBackWall || ball.vel.z > -2.5 || ball.bounceCountOnFloor >= 1;

    if (distXZ <= 1.72 && reachableY && movingTowardBackOrSlow) {
      const choice = this.chooseTacticalShot({ opponent, player, ball, params });
      if (typeof onExecuteAIShot === 'function') {
        onExecuteAIShot(choice);
      }
    }
  }

  /**
   * Chooses a tactical squash shot based on court geometry and where the other player is standing.
   */
  chooseTacticalShot({ opponent, player, ball, params = {} }) {
    const aggression = Number(params.movementAndAI?.aiAggression ?? 0.55);
    const playerDistFromFront = player.pos.z - COURT_SPECS.FRONT_WALL_Z; // > 6.5m means other player is deep!
    const playerLateralGap = Math.abs(player.pos.x - opponent.pos.x);
    const isFrontCourtBall = ball.pos.z < 0.45;
    const isHighVolley = ball.bounceCountOnFloor === 0 && ball.pos.y > 1.15 && ball.pos.z < 0.9;
    const isComingOffBackWall = Boolean(ball.hitBackWallThisShot && ball.vel.z < 0);

    // 1. If ball is returning forward & upward off the Back Glass Wall -> Classic Off-Back-Wall Drive!
    if (isComingOffBackWall) {
      const playCross = playerLateralGap < 0.9 && Math.random() < 0.35;
      return {
        shotType: playCross ? 'cross' : 'topspin',
        speed: 1.18,
        dirX: playCross ? (ball.pos.x >= 0 ? -0.55 : 0.55) : (ball.pos.x >= 0 ? 0.35 : -0.35),
        prepCharge: 0.82
      };
    }

    // 2. If other player left a loose high ball in mid-court and is deep -> Volley Kill
    if (isHighVolley && Math.random() < aggression * 0.85) {
      return {
        shotType: 'kill',
        speed: 1.32,
        dirX: ball.pos.x >= 0 ? 0.65 : -0.65,
        prepCharge: 0.35
      };
    }

    // 3. If other player is stranded deep behind the T (Z > +1.6m) -> Disguised Drop or Attacking 2-Wall Nick Boast!
    if (playerDistFromFront > 6.45 && isFrontCourtBall && Math.random() < aggression) {
      if (Math.abs(ball.pos.x) > 1.35 && Math.random() < 0.42) {
        return {
          shotType: 'boast',
          speed: 1.16,
          dirX: ball.pos.x >= 0 ? 0.75 : -0.75,
          prepCharge: 0.72
        };
      }
      return {
        shotType: 'disguised_drop',
        cutModifier: true,
        speed: 0.92,
        dirX: ball.pos.x >= 0 ? 0.55 : -0.55,
        prepCharge: 0.85 // Full backswing disguise!
      };
    }

    // 4. If AI is stretched wide in mid/rear corners -> Sidewall-Frontwall-Nick Boast (or Back-Wall Boast if trapped deep) or High Lob
    if (ball.pos.z > 1.75 && Math.abs(ball.pos.x) > 1.85 && Math.random() < 0.45) {
      const isTrappedAtBack = opponent.pos.z >= 3.25 || ball.pos.z >= 3.15;
      const useBoast = Math.random() < 0.65;
      return {
        shotType: useBoast ? (isTrappedAtBack ? 'back_wall_boast' : 'boast') : 'lob',
        speed: 1.15,
        dirX: ball.pos.x >= 0 ? 0.85 : -0.85,
        prepCharge: 0.65
      };
    }

    // 5. Default "Physical Chess" foundation: Tight Straight Drive (or Cross-Court if other player is hugging same wall)
    const playCross = playerLateralGap < 0.85 && Math.random() < 0.42;
    return {
      shotType: playCross ? 'cross' : 'topspin',
      speed: 1.16,
      dirX: playCross ? (ball.pos.x >= 0 ? -0.55 : 0.55) : (ball.pos.x >= 0 ? 0.35 : -0.35),
      prepCharge: 0.78
    };
  }
}

export default OpponentAI;
