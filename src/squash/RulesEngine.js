// ============================================================================
// ARGON SQUASH — RULES ENGINE (PAR 11, ARCADE 5, HIHO 9, TIN, OUT, LET/STROKE)
// Enforces WSF squash rules, service box transitions, and point/game state.
// ============================================================================

import { COURT_SPECS } from './CourtGeometry.js';

export class RulesEngine {
  constructor(options = {}) {
    this.scoringMode = options.scoringMode || 'PAR_11'; // 'PAR_11' | 'ARCADE_5' | 'HIHO_9'
    this.gamesToWin = options.gamesToWin || 2;
    this.interferenceRule = options.interferenceRule || 'LET_STROKE';
    this.resetMatch();
  }

  resetMatch({ gamesToWin = this.gamesToWin, scoringMode = this.scoringMode } = {}) {
    this.gamesToWin = gamesToWin;
    this.scoringMode = scoringMode;
    this.score = {
      playerPoints: 0,
      opponentPoints: 0,
      playerGames: 0,
      opponentGames: 0,
      server: 'player',
      serviceSide: 'right', // 'right' or 'left' service box
      handOutJustOccurred: false
    };
    return this.score;
  }

  getTargetPointsToWinGame() {
    if (this.scoringMode === 'ARCADE_5') return 5;
    if (this.scoringMode === 'HIHO_9') return 9;
    return 11; // PAR_11
  }

  /**
   * Resets per-shot tracking flags on the ball whenever a player or opponent strikes it.
   */
  onStrokeHit(ball, hitterRole, { isServe = false, shotType = 'DRIVE', isDisguised = false } = {}) {
    ball.inPlay = true;
    ball.lastHitter = hitterRole;
    ball.isServeShot = !!isServe;
    ball.hitFrontWallThisShot = false;
    ball.hitBackWallThisShot = false;
    ball.bounceCountOnFloor = 0;
    ball.wallHitCountThisShot = 0;
    ball.lastBounceWasNick = false;
    ball.shotType = shotType;
    ball.isDisguised = !!isDisguised;
    ball.rallyStrokeCount = isServe ? 1 : (ball.rallyStrokeCount || 0) + 1;
  }

  /**
   * Evaluates a collision event from BallPhysics and determines if the rally has ended.
   */
  evaluateCollision(evt, ball) {
    if (!ball || !ball.inPlay) return { rallyEnded: false };

    const hitter = ball.lastHitter || 'player';
    const receiver = hitter === 'player' ? 'opponent' : 'player';

    // 1. Tin Fault (Down)
    if (evt.surface === 'tin' || evt.isTin) {
      return {
        rallyEnded: true,
        winner: receiver,
        reason: 'Tin',
        callout: 'Down! (Tin)',
        bannerStyle: 'style-fault'
      };
    }

    // 2. Out of Court Fault (Above Front, Side, or Back Wall Out Line)
    if (evt.isOut) {
      return {
        rallyEnded: true,
        winner: receiver,
        reason: 'Out',
        callout: 'Out!',
        bannerStyle: 'style-fault'
      };
    }

    // 3. Floor or Nick Contact
    if (evt.surface === 'floor' || evt.surface === 'nick') {
      // If the ball hits the floor BEFORE reaching the Front Wall -> Fault ("Not Up / Down")
      if (!ball.hitFrontWallThisShot) {
        return {
          rallyEnded: true,
          winner: receiver,
          reason: 'Short',
          callout: 'Not Up! (Missed Front Wall)',
          bannerStyle: 'style-fault'
        };
      }

      // If it's a true Rollout Nick on 1st bounce and rebound apex is essentially unplayable (< 2.5cm)
      if (evt.isNick && evt.nickData?.quality === 'ROLLOUT_NICK' && evt.nickData.reboundApexEstimateMeters < 0.025) {
        return {
          rallyEnded: true,
          winner: hitter,
          reason: 'Nick Winner',
          callout: 'NICK! Rolled Dead!',
          bannerStyle: 'style-gold'
        };
      }

      // Second bounce on floor -> Point to Hitter!
      if (ball.bounceCountOnFloor >= 2) {
        const isNickWinner = !!ball.lastBounceWasNick;
        return {
          rallyEnded: true,
          winner: hitter,
          reason: isNickWinner ? 'Nick Winner' : 'Two Bounces',
          callout: isNickWinner ? 'NICK ROLLER!' : 'Not Up! (Two Bounces)',
          bannerStyle: 'style-gold'
        };
      }
    }

    return { rallyEnded: false };
  }

  /**
   * Optional Let / Stroke interference evaluation when the incoming receiver is
   * physically blocked by the last hitter within the direct path to the ball.
   */
  evaluateInterference(receiverActor, hitterActor, ball) {
    if (this.interferenceRule === 'ARCADE_NO_FAULT' || !ball || !ball.inPlay || !ball.hitFrontWallThisShot) {
      return { interference: false };
    }
    const distBetweenActors = Math.hypot(
      receiverActor.pos.x - hitterActor.pos.x,
      receiverActor.pos.z - hitterActor.pos.z
    );
    const distReceiverToBall = Math.hypot(
      ball.pos.x - receiverActor.pos.x,
      ball.pos.z - receiverActor.pos.z
    );
    const distHitterToBall = Math.hypot(
      ball.pos.x - hitterActor.pos.x,
      ball.pos.z - hitterActor.pos.z
    );

    // If players collide closely while the ball is within strike range and the hitter is closer to the ball
    if (distBetweenActors < 0.52 && distReceiverToBall < 1.35 && distHitterToBall < distReceiverToBall) {
      // If ball is directly in front of the front wall cone -> Stroke; otherwise Let
      const isDirectFrontAccessBlocked = Math.abs(hitterActor.pos.x - ball.pos.x) < 0.45 && hitterActor.pos.z < receiverActor.pos.z;
      return {
        interference: true,
        decision: isDirectFrontAccessBlocked ? 'STROKE' : 'LET',
        winner: isDirectFrontAccessBlocked ? receiverActor.role : null,
        callout: isDirectFrontAccessBlocked ? 'Stroke to Receiver!' : 'Let Please — Play a Let!'
      };
    }

    return { interference: false };
  }

  /**
   * Updates score state for the point winner according to PAR_11, ARCADE_5, or HIHO_9.
   */
  awardPoint(winnerRole) {
    const prevServer = this.score.server;
    const serviceChanged = winnerRole !== prevServer;
    let pointScored = true;

    if (this.scoringMode === 'HIHO_9' && serviceChanged) {
      // Hand-In / Hand-Out: receiver wins service ("Hand Out") without incrementing point score
      this.score.server = winnerRole;
      this.score.handOutJustOccurred = true;
      this.score.serviceSide = 'right';
      pointScored = false;
    } else {
      this.score.handOutJustOccurred = serviceChanged;
      if (winnerRole === 'player') {
        this.score.playerPoints += 1;
      } else {
        this.score.opponentPoints += 1;
      }
      if (!serviceChanged) {
        // Server won the rally -> alternate service box (Right <-> Left)
        this.score.serviceSide = this.score.serviceSide === 'right' ? 'left' : 'right';
      } else {
        // Hand out -> new server chooses box (defaults to right on even, left on odd)
        this.score.server = winnerRole;
        const pts = winnerRole === 'player' ? this.score.playerPoints : this.score.opponentPoints;
        this.score.serviceSide = pts % 2 === 0 ? 'right' : 'left';
      }
    }

    const target = this.getTargetPointsToWinGame();
    const p = this.score.playerPoints;
    const o = this.score.opponentPoints;
    const winBy = this.scoringMode === 'ARCADE_5' ? 1 : 2;

    let gameWonBy = null;
    let matchWonBy = null;
    const finalPointScore = { playerPoints: p, opponentPoints: o };

    if ((p >= target || o >= target) && Math.abs(p - o) >= winBy) {
      gameWonBy = p > o ? 'player' : 'opponent';
      if (gameWonBy === 'player') {
        this.score.playerGames += 1;
      } else {
        this.score.opponentGames += 1;
      }
      this.score.playerPoints = 0;
      this.score.opponentPoints = 0;
      this.score.server = gameWonBy;
      this.score.serviceSide = 'right';
      this.score.handOutJustOccurred = false;

      if (
        this.score.playerGames >= this.gamesToWin ||
        this.score.opponentGames >= this.gamesToWin
      ) {
        matchWonBy = this.score.playerGames > this.score.opponentGames ? 'player' : 'opponent';
      }
    }

    return {
      pointScored,
      serviceChanged,
      gameWonBy,
      matchWonBy,
      finalPointScore,
      score: { ...this.score }
    };
  }

  formatScoreHUD() {
    const p = String(this.score.playerPoints).padStart(2, '0');
    const o = String(this.score.opponentPoints).padStart(2, '0');
    const target = this.getTargetPointsToWinGame();
    const isDeuce =
      this.scoringMode !== 'ARCADE_5' &&
      this.score.playerPoints >= target - 1 &&
      this.score.opponentPoints >= target - 1 &&
      this.score.playerPoints === this.score.opponentPoints;

    return {
      playerScoreText: p,
      opponentScoreText: o,
      deuceLabel: isDeuce ? `${this.score.playerPoints}-ALL` : null,
      bannerScoreText: this.score.handOutJustOccurred
        ? `Handout • ${this.score.playerPoints} - ${this.score.opponentPoints}`
        : `${this.score.playerPoints} - ${this.score.opponentPoints}`
    };
  }

  /**
   * Builds an authentic WSF/PSA Squash Referee spoken callout string.
   * Examples:
   *   - "Down! Handout, five-four."
   *   - "Not up! Six-four."
   *   - "Out! Handout, three all."
   *   - "Nick! Eight-six, game ball."
   */
  formatRefereeCallout(outcome = {}, reason = '') {
    const numToWord = (n) => {
      const words = [
        'love', 'one', 'two', 'three', 'four', 'five', 'six',
        'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
        'eighteen', 'nineteen', 'twenty'
      ];
      return words[n] ?? String(n);
    };

    const parts = [];
    const r = String(reason || '').toLowerCase();

    // 1. Fault / Winner Call Prefix
    if (r.includes('tin') || r.includes('down')) {
      parts.push('Down!');
    } else if (r.includes('out')) {
      parts.push('Out!');
    } else if (r.includes('not up') || r.includes('two bounces') || r.includes('short')) {
      parts.push('Not up!');
    } else if (r.includes('nick')) {
      parts.push('Nick!');
    } else if (r.includes('stroke')) {
      parts.push('Stroke!');
    } else if (r.includes('let')) {
      parts.push('Yes, let!');
    }

    // 2. Match / Game completion
    if (outcome.matchWonBy) {
      const winnerPts = outcome.finalPointScore
        ? Math.max(outcome.finalPointScore.playerPoints, outcome.finalPointScore.opponentPoints)
        : 11;
      const loserPts = outcome.finalPointScore
        ? Math.min(outcome.finalPointScore.playerPoints, outcome.finalPointScore.opponentPoints)
        : 0;
      parts.push(`Game and match! ${numToWord(winnerPts)}-${numToWord(loserPts)}.`);
      return parts.join(' ');
    }

    if (outcome.gameWonBy) {
      const winnerPts = outcome.finalPointScore
        ? Math.max(outcome.finalPointScore.playerPoints, outcome.finalPointScore.opponentPoints)
        : 11;
      const loserPts = outcome.finalPointScore
        ? Math.min(outcome.finalPointScore.playerPoints, outcome.finalPointScore.opponentPoints)
        : 0;
      parts.push(`Game! ${numToWord(winnerPts)}-${numToWord(loserPts)}.`);
      return parts.join(' ');
    }

    // 3. Handout + Server-First Score Callout
    const server = this.score.server || 'player';
    const serverPts = server === 'player' ? this.score.playerPoints : this.score.opponentPoints;
    const receiverPts = server === 'player' ? this.score.opponentPoints : this.score.playerPoints;

    const scorePhrase =
      serverPts === receiverPts
        ? `${numToWord(serverPts)} all`
        : `${numToWord(serverPts)}-${numToWord(receiverPts)}`;

    if (outcome.serviceChanged || this.score.handOutJustOccurred) {
      parts.push(`Handout, ${scorePhrase}.`);
    } else {
      parts.push(`${scorePhrase.charAt(0).toUpperCase() + scorePhrase.slice(1)}.`);
    }

    // 4. High Stakes Suffix (Game Ball / Match Ball)
    const highStakes = this.getHighStakesLabel();
    if (highStakes) {
      parts.push(`${highStakes}!`);
    }

    return parts.join(' ');
  }

  getHighStakesLabel() {
    const target = this.getTargetPointsToWinGame();
    const winBy = this.scoringMode === 'ARCADE_5' ? 1 : 2;
    const p = this.score.playerPoints;
    const o = this.score.opponentPoints;

    const pAtGamePt = p >= target - 1 && p - o >= winBy - 1;
    const oAtGamePt = o >= target - 1 && o - p >= winBy - 1;

    if (pAtGamePt) {
      return this.score.playerGames + 1 >= this.gamesToWin ? 'Match Ball' : 'Game Ball';
    }
    if (oAtGamePt) {
      return this.score.opponentGames + 1 >= this.gamesToWin ? 'Match Ball' : 'Game Ball';
    }
    return null;
  }
}

export default RulesEngine;

