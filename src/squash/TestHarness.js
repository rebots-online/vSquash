// ============================================================================
// ARGON SQUASH — AUTOMATED INVARIANT & DETERMINISTIC PHYSICS TEST HARNESS
// Distinguishes objective physical/rules correctness tests from subjective
// gameplay tuning experiments. Exposed at `window.__argonSquashTests`.
// ============================================================================

import * as THREE from 'three';
import { COURT_SPECS, getSideWallOutHeightAtZ } from './CourtGeometry.js';
import { BallPhysics } from './BallPhysics.js';
import { NickCollisionModel } from './NickCollisionModel.js';
import { RulesEngine } from './RulesEngine.js';
import { ShotController, SQUASH_SHOT_TYPES } from './ShotController.js';
import { OpponentAI } from './OpponentAI.js';
import { PlayerMovement } from './PlayerMovement.js';
import { BiomechStrokeClassifier, STROKE_SIDES } from './BiomechStrokeClassifier.js';
import { DEFAULT_TUNING_PARAMS, TuningConfigStore } from './TuningConfig.js';

export class TestHarness {
  static runAll(liveEngine = null) {
    const results = [];
    const assert = (id, name, condition, detail = '') => {
      results.push({ id, name, passed: !!condition, detail });
    };

    // 1. Canonical WSF Court Geometry & T-Position Invariants
    assert(
      'TEST-GEOM-01',
      'WSF Court Dimensions & Short Line / T-Position Coordinates',
      COURT_SPECS.LENGTH === 9.75 &&
        COURT_SPECS.WIDTH === 6.40 &&
        Math.abs(COURT_SPECS.SHORT_LINE_Z - 0.565) < 1e-4 &&
        Math.abs(COURT_SPECS.T_POS.z - 0.92) < 1e-4,
      `ShortLineZ=${COURT_SPECS.SHORT_LINE_Z}m, T_POS=(${COURT_SPECS.T_POS.x}, ${COURT_SPECS.T_POS.z})m`
    );

    assert(
      'TEST-GEOM-02',
      'Sloped Side Wall Out-Line Interpolation (4.57m Front -> 2.13m Back)',
      Math.abs(getSideWallOutHeightAtZ(COURT_SPECS.FRONT_WALL_Z) - 4.57) < 1e-4 &&
        Math.abs(getSideWallOutHeightAtZ(COURT_SPECS.BACK_WALL_Z) - 2.13) < 1e-4,
      `Front=${getSideWallOutHeightAtZ(-4.875).toFixed(2)}m, Back=${getSideWallOutHeightAtZ(4.875).toFixed(2)}m`
    );

    // 2. Deterministic Simulation Reproducibility
    const store = new TuningConfigStore();
    const params = structuredClone(DEFAULT_TUNING_PARAMS);
    const scenarioA = NickCollisionModel.getNickLabScenario('demo_a_kill');
    const sim1 = BallPhysics.simulateTrajectory(scenarioA, params, store);
    const sim2 = BallPhysics.simulateTrajectory(scenarioA, params, store);
    const posDelta = sim1.finalPos.distanceTo(sim2.finalPos);

    assert(
      'TEST-DET-01',
      'Deterministic Fixed-Step Trajectory Reproducibility (Δpos < 1e-6m)',
      posDelta < 1e-6,
      `Δpos=${posDelta.toExponential(2)}m across ${sim1.samples.length} samples`
    );

    // 3. Demonstration A (Volley Kill) & Demonstration B (Gentle Drop) Nick Emergence
    const scenarioB = NickCollisionModel.getNickLabScenario('demo_b_soft_drop');
    const simB = BallPhysics.simulateTrajectory(scenarioB, params, store);

    assert(
      'TEST-NICK-01',
      'Demo A (Fast Volley Kill) Achieves Physical Front-Corner Nick Rollout',
      sim1.nickTriggered && sim1.maxBounceHeightAfterFirst < 0.08,
      `nickTriggered=${sim1.nickTriggered}, maxReboundY=${sim1.maxBounceHeightAfterFirst.toFixed(3)}m`
    );

    assert(
      'TEST-NICK-02',
      'Demo B (Gentle Open-Face Drop) Achieves Physical Front-Corner Nick Rollout',
      simB.nickTriggered && simB.maxBounceHeightAfterFirst < 0.08,
      `nickTriggered=${simB.nickTriggered}, maxReboundY=${simB.maxBounceHeightAfterFirst.toFixed(3)}m`
    );

    // 4. Decoupled Preparation vs Execution (Disguise Invariant)
    const shotCtrl = new ShotController();
    const dummyActor = { pos: new THREE.Vector3(-1.2, 0, 1.1) };
    const dummyBall = { pos: new THREE.Vector3(-1.0, 0.95, 0.8), bounceCountOnFloor: 1 };
    const dummyOpponent = { pos: new THREE.Vector3(0.2, 0, 1.2) };

    const fullPrep = { active: true, durationSec: 0.55, chargeNormalized: 1.0 };
    const driveFromFullPrep = shotCtrl.computeShotExecution({
      actor: dummyActor,
      ball: dummyBall,
      opponent: dummyOpponent,
      inputEvent: { shotType: 'topspin', speed: 1.2 },
      prepSnapshot: fullPrep,
      params
    });

    const disguisedDropFromFullPrep = shotCtrl.computeShotExecution({
      actor: dummyActor,
      ball: dummyBall,
      opponent: dummyOpponent,
      inputEvent: { shotType: 'drop', cutModifier: true, speed: 0.9 },
      prepSnapshot: fullPrep,
      params
    });

    assert(
      'TEST-SHOT-01',
      'Decoupled Preparation vs Execution (Full Windup -> Both Hard Drive & Disguised Soft Drop)',
      driveFromFullPrep.shotId === SQUASH_SHOT_TYPES.STRAIGHT_DRIVE &&
        disguisedDropFromFullPrep.shotId === SQUASH_SHOT_TYPES.DISGUISED_DROP &&
        disguisedDropFromFullPrep.isDisguised === true &&
        disguisedDropFromFullPrep.cutAngleDeg >= 25 &&
        driveFromFullPrep.vel.length() > disguisedDropFromFullPrep.vel.length() * 1.4,
      `Drive=${driveFromFullPrep.speedKmh}km/h (${driveFromFullPrep.cutAngleDeg}°), DisguisedDrop=${disguisedDropFromFullPrep.speedKmh}km/h (${disguisedDropFromFullPrep.cutAngleDeg}° cut)`
    );

    // 5. Rules Engine Tin, Out, and PAR 11 Scoring + Referee Callout Invariants
    const rules = new RulesEngine({ scoringMode: 'PAR_11', gamesToWin: 2 });
    rules.score.playerPoints = 4;
    rules.score.opponentPoints = 4;
    rules.score.server = 'player';
    const testBall = { inPlay: true };
    rules.onStrokeHit(testBall, 'player', { isServe: false });
    const tinDecision = rules.evaluateCollision(
      { surface: 'tin', isTin: true, pos: new THREE.Vector3(0, 0.25, -4.875) },
      testBall
    );
    const tinOutcome = rules.awardPoint(tinDecision.winner);
    const refCallout = rules.formatRefereeCallout(tinOutcome, tinDecision.reason);

    assert(
      'TEST-RULES-01',
      'Tin Contact Immediately Awards Point to Receiver & Formats Referee Call ("Down! Handout, five-four.")',
      tinDecision.rallyEnded === true &&
        tinDecision.winner === 'opponent' &&
        tinDecision.reason === 'Tin' &&
        refCallout === 'Down! Handout, five-four.',
      `winner=${tinDecision.winner}, refCallout="${refCallout}"`
    );

    // 6. Off-the-Back-Wall Drive Sit-Up & Rising Return Invariant
    const backWallScenario = NickCollisionModel.getNickLabScenario('off_back_wall_drive');
    const simBackWall = BallPhysics.simulateTrajectory(backWallScenario, params, store);
    const risingBallAtBack = {
      pos: simBackWall.optimalBackWallStrikePos
        ? simBackWall.optimalBackWallStrikePos.clone()
        : new THREE.Vector3(-2.35, 0.72, 3.65),
      vel: new THREE.Vector3(0.2, 1.25, -5.4),
      bounceCountOnFloor: 1,
      hitBackWallThisShot: true
    };
    const offBackWallShot = shotCtrl.computeShotExecution({
      actor: { pos: new THREE.Vector3(-1.95, 0, 3.75) },
      ball: risingBallAtBack,
      opponent: dummyOpponent,
      inputEvent: { shotType: 'topspin', speed: 1.18 },
      prepSnapshot: fullPrep,
      params
    });

    assert(
      'TEST-BACKWALL-01',
      'Deep Drive Rebounds Forward & Upward Off Back Glass for Rising Off-Back-Wall Drive Return',
      simBackWall.willHitBackWallBeforeSecondBounce === true &&
        Boolean(simBackWall.optimalBackWallStrikePos) &&
        simBackWall.optimalBackWallStrikePos.y >= 0.42 &&
        offBackWallShot.shotId === SQUASH_SHOT_TYPES.OFF_BACK_WALL_DRIVE &&
        offBackWallShot.isRisingOffBackWall === true,
      `willHitBackWall=${simBackWall.willHitBackWallBeforeSecondBounce}, strikeZ=${simBackWall.optimalBackWallStrikePos?.z.toFixed(2)}m, strikeY=${simBackWall.optimalBackWallStrikePos?.y.toFixed(2)}m, shot="${offBackWallShot.label}"`
    );

    // =========================================================================
    // 7. BIOMECHANICAL FOREHAND / BACKHAND STROKE CLASSIFICATION SUITE (Gate F)
    // =========================================================================
    const runStrokeSequence = (frames, config = {}) => {
      const clf = new BiomechStrokeClassifier(config);
      for (const f of frames) {
        clf.ingestFrame(f);
      }
      return clf.classifySequence();
    };

    const basePoseCentered = {
      11: { x: 0.38, y: 0.46, z: 0, visibility: 0.95 }, // Left shoulder
      12: { x: 0.62, y: 0.46, z: 0, visibility: 0.95 }  // Right shoulder
    };

    // 7.1 Standard Forehand & Backhand Drives (Right-Handed)
    const fhDriveRes = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.72, y: 0.45 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.68, y: 0.50, visibility: 0.9 } } },
      { timestamp: 130, handPoint: { x: 0.78, y: 0.44 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.71, y: 0.49, visibility: 0.9 } } },
      { timestamp: 160, handPoint: { x: 0.66, y: 0.48 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.65, y: 0.51, visibility: 0.9 } } },
      { timestamp: 190, handPoint: { x: 0.54, y: 0.50 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.59, y: 0.52, visibility: 0.9 } } }
    ], { handedness: 'right' });

    const bhDriveRes = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.30, y: 0.46 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.42, y: 0.50, visibility: 0.9 } } },
      { timestamp: 130, handPoint: { x: 0.24, y: 0.45 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.38, y: 0.49, visibility: 0.9 } } },
      { timestamp: 160, handPoint: { x: 0.36, y: 0.48 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.45, y: 0.51, visibility: 0.9 } } },
      { timestamp: 190, handPoint: { x: 0.52, y: 0.50 }, poseLandmarks: { ...basePoseCentered, 14: { x: 0.53, y: 0.52, visibility: 0.9 } } }
    ], { handedness: 'right' });

    assert(
      'TEST-BIOMECH-01',
      'Standard Forehand & Backhand Drives Classified from Player-Relative Hitting Geometry',
      fhDriveRes.strokeSide === STROKE_SIDES.FOREHAND &&
        fhDriveRes.shotMechanics.shotType === 'drive' &&
        fhDriveRes.confidence >= 0.60 &&
        bhDriveRes.strokeSide === STROKE_SIDES.BACKHAND &&
        bhDriveRes.shotMechanics.shotType === 'drive' &&
        bhDriveRes.confidence >= 0.60,
      `FH=(${fhDriveRes.strokeSide}, conf=${fhDriveRes.confidence}, shot=${fhDriveRes.shotMechanics.shotType}), BH=(${bhDriveRes.strokeSide}, conf=${bhDriveRes.confidence}, shot=${bhDriveRes.shotMechanics.shotType})`
    );

    // 7.2 Vertical Chops / Cut Drops (vx = 0) & High Lobs Separate Stroke Identity from Shot Type
    const fhVerticalCutDrop = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.68, y: 0.36 }, poseLandmarks: basePoseCentered },
      { timestamp: 135, handPoint: { x: 0.68, y: 0.42 }, poseLandmarks: basePoseCentered },
      { timestamp: 170, handPoint: { x: 0.68, y: 0.53 }, poseLandmarks: basePoseCentered },
      { timestamp: 205, handPoint: { x: 0.68, y: 0.60 }, poseLandmarks: basePoseCentered }
    ], { handedness: 'right' });

    const bhVerticalCutDrop = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.32, y: 0.36 }, poseLandmarks: basePoseCentered },
      { timestamp: 135, handPoint: { x: 0.32, y: 0.42 }, poseLandmarks: basePoseCentered },
      { timestamp: 170, handPoint: { x: 0.32, y: 0.53 }, poseLandmarks: basePoseCentered },
      { timestamp: 205, handPoint: { x: 0.32, y: 0.60 }, poseLandmarks: basePoseCentered }
    ], { handedness: 'right' });

    const fhHighLob = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.69, y: 0.68 }, poseLandmarks: basePoseCentered },
      { timestamp: 130, handPoint: { x: 0.69, y: 0.58 }, poseLandmarks: basePoseCentered },
      { timestamp: 160, handPoint: { x: 0.68, y: 0.40 }, poseLandmarks: basePoseCentered },
      { timestamp: 190, handPoint: { x: 0.67, y: 0.28 }, poseLandmarks: basePoseCentered }
    ], { handedness: 'right' });

    assert(
      'TEST-BIOMECH-02',
      'Forehand/Backhand Vertical Cut Drops (vx=0) & High Lobs Preserve Stroke Side Independently of Shot Mechanics',
      fhVerticalCutDrop.strokeSide === STROKE_SIDES.FOREHAND &&
        fhVerticalCutDrop.shotMechanics.cutModifier === true &&
        bhVerticalCutDrop.strokeSide === STROKE_SIDES.BACKHAND &&
        bhVerticalCutDrop.shotMechanics.cutModifier === true &&
        fhHighLob.strokeSide === STROKE_SIDES.FOREHAND &&
        fhHighLob.shotMechanics.shotType === 'lob',
      `FH_Drop=(${fhVerticalCutDrop.strokeSide}, ${fhVerticalCutDrop.shotMechanics.shotType}), BH_Drop=(${bhVerticalCutDrop.strokeSide}, ${bhVerticalCutDrop.shotMechanics.shotType}), FH_Lob=(${fhHighLob.strokeSide}, ${fhHighLob.shotMechanics.shotType})`
    );

    // 7.3 Cross-Body Follow-Through & Deceptive Late Wrist Release Do Not Reverse Stroke Identity
    const fhCrossBodyWrap = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.74, y: 0.44 }, poseLandmarks: basePoseCentered }, // Prep on FH side
      { timestamp: 130, handPoint: { x: 0.79, y: 0.43 }, poseLandmarks: basePoseCentered }, // Backswing Apex on FH side
      { timestamp: 160, handPoint: { x: 0.62, y: 0.48 }, poseLandmarks: basePoseCentered }, // Peak speed at Contact on FH side
      { timestamp: 200, handPoint: { x: 0.44, y: 0.51 }, poseLandmarks: basePoseCentered }, // Follow-through crosses midline
      { timestamp: 250, handPoint: { x: 0.34, y: 0.53 }, poseLandmarks: basePoseCentered }  // Deep wrap on BH side
    ], { handedness: 'right' });

    const fhDeceptiveLateDrop = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.75, y: 0.42 }, poseLandmarks: basePoseCentered }, // Full FH preparation
      { timestamp: 135, handPoint: { x: 0.70, y: 0.44 }, poseLandmarks: basePoseCentered }, // Forward swing initiation
      { timestamp: 165, handPoint: { x: 0.66, y: 0.55 }, poseLandmarks: basePoseCentered }, // Late downward/outward wrist check at contact
      { timestamp: 200, handPoint: { x: 0.71, y: 0.62 }, poseLandmarks: basePoseCentered }  // Outward slice follow-through
    ], { handedness: 'right' });

    assert(
      'TEST-BIOMECH-03',
      'Temporal Classifier Locks Preparation/Apex so Cross-Body Follow-Throughs & Late Wrist Changes Keep True Stroke Side',
      fhCrossBodyWrap.strokeSide === STROKE_SIDES.FOREHAND &&
        fhCrossBodyWrap.swingKinematics.isCrossBodyFollowThrough === true &&
        fhDeceptiveLateDrop.strokeSide === STROKE_SIDES.FOREHAND &&
        fhDeceptiveLateDrop.shotMechanics.cutModifier === true,
      `CrossBodyWrap=(${fhCrossBodyWrap.strokeSide}, crossBody=${fhCrossBodyWrap.swingKinematics.isCrossBodyFollowThrough}), DeceptiveLateDrop=(${fhDeceptiveLateDrop.strokeSide}, cut=${fhDeceptiveLateDrop.shotMechanics.cutModifier})`
    );

    // 7.4 Contradictory vx Sign Strokes (Inside-Out Forehand with vx > 0 & Inside-Out Backhand with vx < 0)
    // Legacy classifier rule: vx > +0.14 => backhand, vx < -0.14 => forehand.
    // Here an Inside-Out Forehand moves rightward (vx > +0.80) on the dominant right side,
    // and an Inside-Out Backhand moves leftward (vx < -0.80) on the non-dominant left side!
    const insideOutForehand = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.62, y: 0.46 }, poseLandmarks: basePoseCentered },
      { timestamp: 130, handPoint: { x: 0.65, y: 0.47 }, poseLandmarks: basePoseCentered },
      { timestamp: 160, handPoint: { x: 0.74, y: 0.50 }, poseLandmarks: basePoseCentered }, // vx > 0!
      { timestamp: 190, handPoint: { x: 0.82, y: 0.52 }, poseLandmarks: basePoseCentered }
    ], { handedness: 'right' });

    const insideOutBackhand = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.38, y: 0.46 }, poseLandmarks: basePoseCentered },
      { timestamp: 130, handPoint: { x: 0.35, y: 0.47 }, poseLandmarks: basePoseCentered },
      { timestamp: 160, handPoint: { x: 0.26, y: 0.50 }, poseLandmarks: basePoseCentered }, // vx < 0!
      { timestamp: 190, handPoint: { x: 0.18, y: 0.52 }, poseLandmarks: basePoseCentered }
    ], { handedness: 'right' });

    assert(
      'TEST-BIOMECH-04',
      'Strokes Contradicting Naive vx Sign Rules (Inside-Out FH with vx > 0 & Inside-Out BH with vx < 0) Classify Correctly',
      insideOutForehand.strokeSide === STROKE_SIDES.FOREHAND &&
        insideOutForehand.swingKinematics.contactVelocity.vx > 0.20 &&
        insideOutBackhand.strokeSide === STROKE_SIDES.BACKHAND &&
        insideOutBackhand.swingKinematics.contactVelocity.vx < -0.20,
      `InsideOutFH=(${insideOutForehand.strokeSide}, vx=${insideOutForehand.swingKinematics.contactVelocity.vx}), InsideOutBH=(${insideOutBackhand.strokeSide}, vx=${insideOutBackhand.swingKinematics.contactVelocity.vx})`
    );

    // 7.5 Left-Handed Player Equivalents, Off-Center Torso Translation & Mirrored/Unmirrored Camera Invariance
    const poseShiftedLeftOfFrame = {
      11: { x: 0.14, y: 0.48, z: 0, visibility: 0.95 }, // Torso centered at x = 0.25!
      12: { x: 0.36, y: 0.48, z: 0, visibility: 0.95 }
    };
    const leftyForehandShifted = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.08, y: 0.46 }, poseLandmarks: poseShiftedLeftOfFrame },
      { timestamp: 130, handPoint: { x: 0.05, y: 0.45 }, poseLandmarks: poseShiftedLeftOfFrame },
      { timestamp: 160, handPoint: { x: 0.15, y: 0.49 }, poseLandmarks: poseShiftedLeftOfFrame },
      { timestamp: 190, handPoint: { x: 0.24, y: 0.51 }, poseLandmarks: poseShiftedLeftOfFrame }
    ], { handedness: 'left' });

    const leftyBackhandShifted = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.42, y: 0.46 }, poseLandmarks: poseShiftedLeftOfFrame },
      { timestamp: 130, handPoint: { x: 0.45, y: 0.45 }, poseLandmarks: poseShiftedLeftOfFrame },
      { timestamp: 160, handPoint: { x: 0.35, y: 0.49 }, poseLandmarks: poseShiftedLeftOfFrame },
      { timestamp: 190, handPoint: { x: 0.26, y: 0.51 }, poseLandmarks: poseShiftedLeftOfFrame }
    ], { handedness: 'left' });

    // Raw sensor Front Cam ('user') vs Rear TV Cam ('environment') invariance
    const rawFrontCamFH = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.24, y: 0.45 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'user' },
      { timestamp: 130, handPoint: { x: 0.20, y: 0.44 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'user' },
      { timestamp: 160, handPoint: { x: 0.34, y: 0.48 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'user' },
      { timestamp: 190, handPoint: { x: 0.46, y: 0.50 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'user' }
    ], { handedness: 'right', facingMode: 'user' });

    const rawRearTvCamFH = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.24, y: 0.45 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'environment' },
      { timestamp: 130, handPoint: { x: 0.20, y: 0.44 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'environment' },
      { timestamp: 160, handPoint: { x: 0.34, y: 0.48 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'environment' },
      { timestamp: 190, handPoint: { x: 0.46, y: 0.50 }, bodyCenter: { x: 0.5, y: 0.5 }, coordSpace: 'raw_sensor', facingMode: 'environment' }
    ], { handedness: 'right', facingMode: 'environment' });

    assert(
      'TEST-BIOMECH-05',
      'Left-Handed Equivalents, Off-Center Torso Translation, and Front/Rear Camera Coordinate Invariance',
      leftyForehandShifted.strokeSide === STROKE_SIDES.FOREHAND &&
        leftyBackhandShifted.strokeSide === STROKE_SIDES.BACKHAND &&
        rawFrontCamFH.strokeSide === STROKE_SIDES.FOREHAND &&
        rawRearTvCamFH.strokeSide === STROKE_SIDES.FOREHAND,
      `LeftyFH=${leftyForehandShifted.strokeSide}, LeftyBH=${leftyBackhandShifted.strokeSide}, FrontCamFH=${rawFrontCamFH.strokeSide}, RearTvCamFH=${rawRearTvCamFH.strokeSide}`
    );

    // 7.6 Partial Occlusion, Missing Landmarks & Anti-Flicker Uncertain Degradation
    const occludedSeq = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.72, y: 0.45 }, visibility: 0.12, poseLandmarks: basePoseCentered },
      { timestamp: 130, handPoint: { x: 0.60, y: 0.48 }, visibility: 0.15, poseLandmarks: basePoseCentered }
    ], { handedness: 'right' });

    const ambiguousMidlineSeq = runStrokeSequence([
      { timestamp: 100, handPoint: { x: 0.505, y: 0.46 }, poseLandmarks: basePoseCentered },
      { timestamp: 130, handPoint: { x: 0.502, y: 0.52 }, poseLandmarks: basePoseCentered },
      { timestamp: 160, handPoint: { x: 0.498, y: 0.58 }, poseLandmarks: basePoseCentered }
    ], { handedness: 'right' });

    assert(
      'TEST-BIOMECH-06',
      'Partial Hand Occlusion & Ambiguous Midline Hover Degrade Gracefully to UNCERTAIN Without False Certainty',
      occludedSeq.strokeSide === STROKE_SIDES.UNCERTAIN &&
        ambiguousMidlineSeq.strokeSide === STROKE_SIDES.UNCERTAIN,
      `Occluded=${occludedSeq.strokeSide} (conf=${occludedSeq.confidence}), AmbiguousMidline=${ambiguousMidlineSeq.strokeSide} (conf=${ambiguousMidlineSeq.confidence})`
    );

    // 8. Continuous AI vs AI Spectator Match Simulation (playerAI + opponentAI with real physics)
    const p1AI = new OpponentAI('player');
    const p2AI = new OpponentAI('opponent');
    const p1Actor = {
      role: 'player',
      pos: new THREE.Vector3(1.4, 0, 1.8),
      vel: new THREE.Vector3(),
      targetPos: new THREE.Vector3(1.4, 0, 1.8),
      maxSpeed: 7.1,
      swingCooldown: 0,
      root: { position: new THREE.Vector3(), rotation: { y: 0 } }
    };
    const p2Actor = {
      role: 'opponent',
      pos: new THREE.Vector3(-1.1, 0, 1.2),
      vel: new THREE.Vector3(),
      targetPos: new THREE.Vector3(-1.1, 0, 1.2),
      maxSpeed: 7.1,
      swingCooldown: 0,
      root: { position: new THREE.Vector3(), rotation: { y: 0 } }
    };
    const simBall = {
      pos: new THREE.Vector3(1.35, 0.92, -0.5),
      vel: new THREE.Vector3(0.3, 2.5, -21.0),
      spin: new THREE.Vector3(12, 0, 0),
      inPlay: true,
      lastHitter: 'player',
      hitFrontWallThisShot: false,
      hitBackWallThisShot: false,
      bounceCountOnFloor: 0,
      wallHitCountThisShot: 0
    };
    let predicted = BallPhysics.simulateTrajectory(simBall, params, store);
    let p1Hits = 0;
    let p2Hits = 0;
    const simDt = 1 / 120;
    for (let step = 0; step < 720 && simBall.inPlay; step++) {
      p1Actor.swingCooldown = Math.max(0, p1Actor.swingCooldown - simDt);
      p2Actor.swingCooldown = Math.max(0, p2Actor.swingCooldown - simDt);
      BallPhysics.stepBallPhysics(simBall, simDt, params, store);
      p1AI.updateAI({
        opponent: p1Actor,
        player: p2Actor,
        ball: simBall,
        dt: simDt,
        params,
        predictedTrajectory: predicted,
        onExecuteAIShot: (choice) => {
          const s = shotCtrl.computeShotExecution({
            actor: p1Actor,
            ball: simBall,
            opponent: p2Actor,
            inputEvent: choice,
            prepSnapshot: fullPrep,
            params
          });
          simBall.vel.copy(s.vel);
          simBall.spin.copy(s.spin);
          simBall.lastHitter = 'player';
          simBall.hitFrontWallThisShot = false;
          simBall.hitBackWallThisShot = false;
          simBall.bounceCountOnFloor = 0;
          p1Actor.swingCooldown = 0.2;
          p2AI.recordPlayerShot(s, simBall, params);
          predicted = BallPhysics.simulateTrajectory(simBall, params, store);
          p1Hits++;
        }
      });
      p2AI.updateAI({
        opponent: p2Actor,
        player: p1Actor,
        ball: simBall,
        dt: simDt,
        params,
        predictedTrajectory: predicted,
        onExecuteAIShot: (choice) => {
          const s = shotCtrl.computeShotExecution({
            actor: p2Actor,
            ball: simBall,
            opponent: p1Actor,
            inputEvent: choice,
            prepSnapshot: fullPrep,
            params
          });
          simBall.vel.copy(s.vel);
          simBall.spin.copy(s.spin);
          simBall.lastHitter = 'opponent';
          simBall.hitFrontWallThisShot = false;
          simBall.hitBackWallThisShot = false;
          simBall.bounceCountOnFloor = 0;
          p2Actor.swingCooldown = 0.2;
          p1AI.recordPlayerShot(s, simBall, params);
          predicted = BallPhysics.simulateTrajectory(simBall, params, store);
          p2Hits++;
        }
      });
      PlayerMovement.stepActorLocomotion(p1Actor, p2Actor, simDt, params, simBall.lastHitter === 'player');
      PlayerMovement.stepActorLocomotion(p2Actor, p1Actor, simDt, params, simBall.lastHitter === 'opponent');
    }

    assert(
      'TEST-SPECTATOR-AI-01',
      'Dual Tactical AI (Player 1 AI vs Player 2 AI) Continuous Rally Exchange with Real Physics & T-Recovery',
      p2Hits >= 1 && p1Hits >= 1,
      `p2AIHits=${p2Hits}, p1AIHits=${p1Hits}, p1Pos=(${p1Actor.pos.x.toFixed(2)}, ${p1Actor.pos.z.toFixed(2)}), p2Pos=(${p2Actor.pos.x.toFixed(2)}, ${p2Actor.pos.z.toFixed(2)})`
    );

    const passedCount = results.filter((r) => r.passed).length;
    return {
      passedAll: passedCount === results.length,
      passedCount,
      totalCount: results.length,
      timestamp: new Date().toISOString(),
      results
    };
  }
}

if (typeof window !== 'undefined') {
  window.__argonSquashTests = TestHarness;
}

export default TestHarness;

