// ============================================================================
// ARGON SQUASH — INTRO DIRECTOR ("WONDER FIRST" TWO-PART NICK DEMONSTRATION)
// Implements Section 2 & 3:
//   - Demonstration A: The Spectacular Volley Kill
//     ("BUT IT DIDN'T EVEN BOUNCE! DO I GET A MULLIGAN?!")
//   - Demonstration B: The Impossible Gentle Drop
//     ("Too fast for you? Okay, I'll do it slowly." ... tap ... roll ...
//      "WHAT?! STILL CAN'T GET IT FROM THE BACK?!")
//   - Optional Slow-Motion Corner Replay showing exact ball-wall-floor physics
//   - Both demonstrations resolve through the live BallPhysics & NickCollisionModel!
// ============================================================================

import * as THREE from 'three';
import { NickCollisionModel } from './NickCollisionModel.js';
import { COURT_SPECS } from './CourtGeometry.js';

export class IntroDirector {
  constructor(engine) {
    this.engine = engine;
    this.active = false;
    this.step = 'IDLE';
    this.stepTimer = 0;
    this.slowMoReplayActive = false;
    this.recordedFrames = [];
    this.replayCursor = 0;
    this.currentScenarioId = 'demo_a_kill';
  }

  /**
   * Starts the two-part Wonder-First intro sequence (or directly launches Demo A or Demo B).
   */
  startIntro(startAt = 'DEMO_A_FEED') {
    this.active = true;
    this.slowMoReplayActive = false;
    this.recordedFrames = [];
    this.replayCursor = 0;
    this.engine.phase = 'WONDER_INTRO';
    this.engine.hud?.hideTitleModal();
    this._enterStep(startAt);
  }

  skipToPlayableMatch() {
    this.active = false;
    this.slowMoReplayActive = false;
    this.engine.hud?.hideIntroOverlay?.();
    this.engine.startNewMatch({ showStartBanner: true });
  }

  triggerSlowMoReplay() {
    if (this.recordedFrames.length < 5) return;
    this.slowMoReplayActive = true;
    this.replayCursor = 0;
    this.engine.cameraMode = 'CORNER_NICK_CAM';
    this.engine.hud?.showCenterBanner('SLOW-MO CORNER INSPECTION', {
      style: 'style-start',
      subText: 'Observe the Front-Wall rebound into the Side-Wall / Floor Nick bevel',
      durationMs: 2800
    });
  }

  _enterStep(stepName) {
    this.step = stepName;
    this.stepTimer = 0;
    const { player, opponent, ball, hud, racketKinematics, facialFX, audioEngine } = this.engine;

    if (stepName === 'DEMO_A_FEED') {
      this.currentScenarioId = 'demo_a_kill';
      this.recordedFrames = [];
      this.engine.cameraMode = 'RALLY_CAM';

      // Position player at back right having just hit a loose floating return
      player.pos.set(1.45, 0, 2.35);
      player.targetPos.set(0.35, 0, 1.35);
      opponent.pos.set(-0.55, 0, -0.35);
      opponent.targetPos.set(-0.55, 0, -0.35);

      // Loose ball rising toward opponent's high volley strike zone
      ball.pos.set(-0.55, 1.52, -0.20);
      ball.vel.set(0, 0.35, -0.45);
      ball.spin.set(0, 0, 0);
      ball.inPlay = false;

      if (racketKinematics) {
        racketKinematics.initActor(opponent);
        opponent.racketKinematics.anticipationCharge = 0.85;
        opponent.racketKinematics.anticipationSide = 'forehand';
      }

      hud?.showCenterBanner('Part 1: The Loose Ball', {
        style: 'style-start',
        subText: 'You leave a ball floating mid-court. Watch what the Club Pro does...',
        durationMs: 2200
      });
      hud?.updateIntroOverlay?.({
        visible: true,
        stepTitle: 'DEMONSTRATION A — THE SPECTACULAR KILL',
        commentary: 'A loose mid-court ball invites an early volley interception...',
        canReplay: false,
        nextLabel: 'Skip to Match ▸'
      });
    } else if (stepName === 'DEMO_A_STRIKE') {
      // Opponent strikes the high volley kill using NickCollisionModel's exact physical vector
      const scenario = NickCollisionModel.getNickLabScenario('demo_a_kill');
      ball.pos.copy(scenario.pos);
      ball.vel.copy(scenario.vel);
      ball.spin.copy(scenario.spin);
      this.engine.rulesEngine.onStrokeHit(ball, 'opponent', {
        isServe: false,
        shotType: 'VOLLEY_KILL',
        isDisguised: false
      });
      this.engine.ballTrail.clear();
      this.engine.ballTrail.setStyle('KILL', true);
      this.engine.ballTrail.pushPoint(ball.pos);

      opponent.swingType = 'smash';
      opponent.swingDuration = 0.30;
      opponent.swingTimer = 0.30;
      racketKinematics?.triggerSwing(opponent, {
        shotType: 'smash',
        side: 'forehand',
        speed: 1.42,
        timing: 'sweet'
      });
      facialFX?.setExpression(opponent, 'effort_shout', 1.2);
      audioEngine?.playSwingWhoosh(1.4);
      audioEngine?.playRacketHit('smash', 'perfect');

      // Player scrambles forward trying to reach it
      player.targetPos.set(-1.85, 0, -2.45);
    } else if (stepName === 'DEMO_B_RHYTHM') {
      this.currentScenarioId = 'demo_b_soft_drop';
      this.recordedFrames = [];
      this.slowMoReplayActive = false;
      this.engine.cameraMode = 'RALLY_CAM';

      // Place player deep in back-left corner after exchanging straight drives
      player.pos.set(-1.65, 0, 3.15);
      player.targetPos.set(-1.35, 0, 2.85);
      opponent.pos.set(-0.55, 0, -0.35);
      opponent.targetPos.set(-0.55, 0, -0.35);

      ball.pos.set(-0.55, 1.18, -0.30);
      ball.vel.set(0, 0.2, 0);
      ball.inPlay = false;

      // Crucial: Opponent shows the EXACT same full drive windup preparation!
      if (racketKinematics) {
        racketKinematics.initActor(opponent);
        opponent.racketKinematics.anticipationCharge = 1.0;
        opponent.racketKinematics.anticipationSide = 'forehand';
      }

      hud?.showCenterBanner('"Too fast for you? Okay, I\'ll do it slowly."', {
        style: 'style-gold',
        subText: 'Watch the opponent\'s racket preparation: identical windup, open 36° cut face...',
        durationMs: 2500
      });
      hud?.updateIntroOverlay?.({
        visible: true,
        stepTitle: 'DEMONSTRATION B — THE IMPOSSIBLE GENTLE DROP',
        commentary: '"Too fast for you? Okay, I\'ll do it slowly." Same windup preparation... then open the racket face (+36° cut).',
        canReplay: false,
        nextLabel: 'Skip to Match ▸'
      });
    } else if (stepName === 'DEMO_B_STRIKE') {
      const scenario = NickCollisionModel.getNickLabScenario('demo_b_soft_drop');
      ball.pos.copy(scenario.pos);
      ball.vel.copy(scenario.vel);
      ball.spin.copy(scenario.spin);
      this.engine.rulesEngine.onStrokeHit(ball, 'opponent', {
        isServe: false,
        shotType: 'DISGUISED_DROP',
        isDisguised: true
      });
      this.engine.ballTrail.clear();
      this.engine.ballTrail.setStyle('SLICE', false);
      this.engine.ballTrail.pushPoint(ball.pos);

      opponent.swingType = 'forehand';
      opponent.swingDuration = 0.38;
      opponent.swingTimer = 0.38;
      racketKinematics?.triggerSwing(opponent, {
        shotType: 'slice',
        side: 'forehand',
        speed: 0.88,
        timing: 'sweet'
      });
      facialFX?.setExpression(opponent, 'happy_grin', 1.5);
      audioEngine?.playSwingWhoosh(0.75);
      audioEngine?.playRacketHit('slice', 'good');

      // Player lunges desperately from the back corner
      player.targetPos.set(-2.35, 0, -3.2);
    }
  }

  update(dt) {
    if (!this.active) return;
    this.stepTimer += dt;
    const { ball, player, opponent, hud, facialFX } = this.engine;

    if (this.slowMoReplayActive) {
      this.replayCursor += dt * 32; // 0.27x slow-motion playback of 120Hz frames
      const idx = Math.min(this.recordedFrames.length - 1, Math.floor(this.replayCursor));
      const frame = this.recordedFrames[idx];
      if (frame) {
        ball.pos.copy(frame.ballPos);
        ball.vel.copy(frame.ballVel);
        this.engine.ballTrail.pushPoint(ball.pos);
      }
      if (idx >= this.recordedFrames.length - 1 && this.stepTimer > 3.2) {
        this.slowMoReplayActive = false;
        this.engine.cameraMode = 'RALLY_CAM';
      }
      return;
    }

    if (this.step === 'DEMO_A_FEED' && this.stepTimer >= 1.35) {
      this._enterStep('DEMO_A_STRIKE');
      return;
    }

    if (this.step === 'DEMO_A_STRIKE') {
      this.recordedFrames.push({
        ballPos: ball.pos.clone(),
        ballVel: ball.vel.clone()
      });
      if (ball.lastBounceWasNick || this.stepTimer >= 1.25) {
        this.step = 'DEMO_A_REACTION';
        this.stepTimer = 0;
        facialFX?.setExpression(player, 'wide_eyed_panic', 2.4);
        facialFX?.spawnSweatDrops(player, 5);
        hud?.showCenterBanner('"BUT IT DIDN\'T EVEN BOUNCE!"', {
          style: 'style-gold',
          subText: '"DO I GET A MULLIGAN?!" — It caught the side-wall/floor Nick junction.',
          durationMs: 3200
        });
        hud?.updateIntroOverlay?.({
          visible: true,
          stepTitle: 'DEMONSTRATION A — ROLLOUT NICK!',
          commentary: '"BUT IT DIDN\'T EVEN BOUNCE! DO I GET A MULLIGAN?!" You might think raw power did that. Watch Part 2...',
          canReplay: true,
          nextStepAction: 'DEMO_B_RHYTHM',
          nextLabel: 'Watch Part 2: Gentle Drop ▸'
        });
      }
      return;
    }

    if (this.step === 'DEMO_A_REACTION' && this.stepTimer >= 3.6) {
      this._enterStep('DEMO_B_RHYTHM');
      return;
    }

    if (this.step === 'DEMO_B_RHYTHM' && this.stepTimer >= 1.55) {
      this._enterStep('DEMO_B_STRIKE');
      return;
    }

    if (this.step === 'DEMO_B_STRIKE') {
      this.recordedFrames.push({
        ballPos: ball.pos.clone(),
        ballVel: ball.vel.clone()
      });
      if (ball.lastBounceWasNick || this.stepTimer >= 1.65) {
        this.step = 'DEMO_B_REVELATION';
        this.stepTimer = 0;
        facialFX?.setExpression(player, 'shocked_loss', 2.6);
        hud?.showCenterBanner('tap ... roll.', {
          style: 'style-gold',
          subText: '"WHAT?! STILL CAN\'T GET IT FROM THE BACK?!" — Geometry, Disguise & Touch > Pure Power.',
          durationMs: 4200
        });
        hud?.updateIntroOverlay?.({
          visible: true,
          stepTitle: 'PHYSICAL CHESS — THE REVELATION',
          commentary: 'tap ... roll. "WHAT?! STILL CAN\'T GET IT FROM THE BACK?!" It wasn\'t power—it was disguise, geometry, and leaving the T unprotected.',
          canReplay: true,
          nextStepAction: 'START_MATCH',
          nextLabel: 'Try It Yourself — Start Rallying! 🎾'
        });
      }
    }
  }
}

export default IntroDirector;
