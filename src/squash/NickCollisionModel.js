// ============================================================================
// ARGON SQUASH — NICK COLLISION MODEL & NICK LABORATORY SCENARIOS
// Models experimental wall-floor junction nicks, front-wall/side-wall vertical
// bevels, and deterministic Nick Laboratory launches (Demo A Kill & Demo B Drop).
// ============================================================================

import * as THREE from 'three';
import { COURT_SPECS } from './CourtGeometry.js';

export class NickCollisionModel {
  /**
   * Evaluates whether a ball approaching or contacting the side-wall/floor
   * or front-wall/floor junction strikes the physical "nick" bevel.
   *
   * Both a high-speed aggressive volley kill (Demonstration A) and a gentle,
   * open-faced cut drop (Demonstration B) can trigger a nick rollout if their
   * trajectory intersects the wall-floor junction within `nickToleranceMeters`
   * with sufficient downward and into-wall incidence.
   */
  static evaluateWallFloorNick(ball, params = {}) {
    const bp = params.ballPhysics || {};
    const radius = COURT_SPECS.BALL_RADIUS * 1.65; // visual/collision radius (~0.033m)
    const nickTol = Number(bp.nickToleranceMeters ?? 0.048);
    const vertEnergyLoss = Number(bp.nickVerticalEnergyLoss ?? 0.91);
    const rollBoost = Number(bp.nickLateralRollBoost ?? 1.18);

    const absX = Math.abs(ball.pos.x);
    const distToSideWall = Math.max(0, COURT_SPECS.HALF_WIDTH - radius - absX);
    const distToFloor = Math.max(0, ball.pos.y - radius);
    const distToFrontWall = Math.max(0, ball.pos.z - (COURT_SPECS.FRONT_WALL_Z + radius));

    // Check side-wall/floor nick junction (most iconic squash nick in front corners)
    const sideFloorBevelDist = Math.hypot(distToSideWall, distToFloor);
    const movingIntoSideWall =
      (ball.pos.x < 0 && ball.vel.x < -0.35) ||
      (ball.pos.x > 0 && ball.vel.x > 0.35) ||
      distToSideWall <= nickTol * 0.65;
    const movingDownward = ball.vel.y < -0.35;

    // Must already have struck the front wall in the current shot (valid squash shot)
    if (
      ball.hitFrontWallThisShot &&
      sideFloorBevelDist <= nickTol &&
      movingDownward &&
      movingIntoSideWall
    ) {
      const precision = 1.0 - sideFloorBevelDist / Math.max(0.005, nickTol);
      const isRollout = precision >= 0.32;
      const wallSign = ball.pos.x >= 0 ? 1 : -1;

      // Dual-surface simultaneous compression absorbs vertical bounce energy
      const residualVerticalFactor = Math.max(0.02, (1.0 - vertEnergyLoss) * (1.0 - precision * 0.75));
      const incomingSpeedXZ = Math.hypot(ball.vel.x, ball.vel.z);

      // Snap ball to floor height and reverse X velocity into a low horizontal rollout
      ball.pos.y = radius + 0.002;
      ball.pos.x = wallSign * (COURT_SPECS.HALF_WIDTH - radius - 0.004);

      const newVelY = Math.min(0.28, Math.abs(ball.vel.y) * residualVerticalFactor);
      const newVelX = -wallSign * Math.max(1.6, Math.abs(ball.vel.x) * 0.74 * rollBoost);
      const newVelZ = ball.vel.z * 0.82;

      ball.vel.set(newVelX, newVelY, newVelZ);
      // Impart heavy rolling spin along floor
      ball.spin.set(0, 0, wallSign * 28);

      return {
        triggered: true,
        quality: isRollout ? 'ROLLOUT_NICK' : 'CLING_NICK',
        precision,
        corner: distToFrontWall < 1.85 ? 'FRONT_CORNER_NICK' : 'SIDE_NICK',
        incomingSpeedMps: incomingSpeedXZ,
        reboundApexEstimateMeters: (newVelY * newVelY) / (2 * (bp.gravity || 9.81))
      };
    }

    return { triggered: false, quality: 'NONE', precision: 0 };
  }

  /**
   * Evaluates tight front-corner vertical junction (where Front Wall Z=-4.875m
   * meets Left/Right Side Wall X=±3.20m).
   */
  static evaluateFrontCornerJunction(ball, params = {}) {
    const bp = params.ballPhysics || {};
    const bevel = Number(bp.cornerBevelMeters ?? 0.055);
    const radius = COURT_SPECS.BALL_RADIUS * 1.65;

    const distFront = Math.abs(ball.pos.z - (COURT_SPECS.FRONT_WALL_Z + radius));
    const distSide = Math.abs(COURT_SPECS.HALF_WIDTH - radius - Math.abs(ball.pos.x));

    if (distFront <= bevel && distSide <= bevel && ball.pos.y > (params.rulesAndView?.tinHeightMeters ?? 0.48)) {
      // Corner bevel deadens normal rebound slightly, keeping ball tight to the corner
      ball.vel.multiplyScalar(0.86);
      return { triggered: true, distFront, distSide };
    }
    return { triggered: false };
  }

  /**
   * Returns deterministic initial ball conditions for the Nick Laboratory &
   * Wonder-First Intro Demonstrations.
   * Crucially: Both 'demo_a_kill' (fast power volley kill) and 'demo_b_soft_drop'
   * (gentle open-faced cut drop) resolve through the exact same BallPhysics solver!
   */
  static getNickLabScenario(scenarioId = 'demo_a_kill') {
    switch (scenarioId) {
      case 'demo_a_kill':
        // Demonstration A — The Spectacular Volley Kill:
        // Struck from high mid-court volley (-0.55, 1.42, -0.35), blistering pace
        // hitting the front wall low at (-2.78, 0.66, -4.84) and diving straight
        // into the front-left side-wall/floor nick junction at X = -3.167, Y = 0.033.
        return {
          id: 'demo_a_kill',
          title: 'Demo A — Spectacular Volley Kill',
          subtitle: 'High-speed flat kill catching the front-left nick after front wall impact',
          hitter: 'opponent',
          shotType: 'KILL',
          cutAngleDeg: 3,
          pos: new THREE.Vector3(-0.55, 1.38, -0.35),
          vel: new THREE.Vector3(-7.28, -1.55, -24.2),
          spin: new THREE.Vector3(8, -6, 0)
        };

      case 'demo_b_soft_drop':
        // Demonstration B — The Impossible Gentle Drop:
        // Struck from the exact same mid-court preparation zone (-0.55, 1.12, -0.35)
        // with an open 36° cut face and soft wrist deceleration. Floats gently to the
        // front wall at (-2.68, 0.84, -4.84), loses pace from underspin bite, and
        // kisses the exact front-left side-wall/floor nick junction at ~42 km/h!
        return {
          id: 'demo_b_soft_drop',
          title: 'Demo B — Impossible Gentle Drop',
          subtitle: 'Disguised open-face (+36° cut) soft drop floating into the front-left nick',
          hitter: 'opponent',
          shotType: 'DISGUISED_DROP',
          cutAngleDeg: 36,
          pos: new THREE.Vector3(-0.55, 1.12, -0.35),
          vel: new THREE.Vector3(-3.85, 1.48, -10.35),
          spin: new THREE.Vector3(-24, -8, 0)
        };

      case 'tight_rail':
        // Classic deep straight length clinging within 10cm of the left wall
        return {
          id: 'tight_rail',
          title: 'Deep Dying Length (Tight Rail)',
          subtitle: 'Straight drive hugging the left wall whose second bounce dies before the back glass',
          hitter: 'player',
          shotType: 'DRIVE',
          cutAngleDeg: 4,
          pos: new THREE.Vector3(-2.45, 0.95, 1.25),
          vel: new THREE.Vector3(-0.92, 3.35, -21.8),
          spin: new THREE.Vector3(10, 0, 0)
        };

      case 'two_wall_boast':
        // Attacking 2-wall boast struck into the right side wall first, deflecting
        // across the front wall straight into the opposite left side-wall/floor nick.
        return {
          id: 'two_wall_boast',
          title: 'Attacking Side-Front-Nick Boast',
          subtitle: 'Angled off the right side wall onto the front wall and rolling dead in the opposite left nick',
          hitter: 'player',
          shotType: 'BOAST',
          cutAngleDeg: 24,
          pos: new THREE.Vector3(1.65, 0.88, 1.85),
          vel: new THREE.Vector3(24.15, 0.94, -23.77),
          spin: new THREE.Vector3(-12, 14, 0)
        };

      case 'off_back_wall_drive':
        // Deep straight drive that bounces once in the rear quarter, hits the back glass wall,
        // and pops forward & upward into the receiver's rising strike zone!
        return {
          id: 'off_back_wall_drive',
          title: 'Deep Drive → Off-Back-Wall Rising Return',
          subtitle: 'Bounces once on floor, hits Back Glass (+Z=4.875m), and pops forward & upward for a rising strike',
          hitter: 'opponent',
          shotType: 'DRIVE',
          cutAngleDeg: 2,
          pos: new THREE.Vector3(-2.35, 0.95, 1.15),
          vel: new THREE.Vector3(-0.75, 3.65, -24.6),
          spin: new THREE.Vector3(14, 0, 0)
        };

      case 'back_wall_boast':
        // Defensive recovery boast struck forcefully into the back glass wall (+Z)
        // when trapped deep in the back-left corner, rebounding off back + side wall to reach the front wall.
        return {
          id: 'back_wall_boast',
          title: 'Back-Wall Recovery Boast',
          subtitle: 'Struck into the rear glass wall (+Z) & side wall when trapped at the back to reach the front wall',
          hitter: 'player',
          shotType: 'BACK_WALL_BOAST',
          cutAngleDeg: 28,
          pos: new THREE.Vector3(-2.35, 0.85, 3.55),
          vel: new THREE.Vector3(-6.8, 5.15, 33.5),
          spin: new THREE.Vector3(-14, -8, 0)
        };

      default:
        return this.getNickLabScenario('demo_a_kill');
    }
  }
}

export default NickCollisionModel;
