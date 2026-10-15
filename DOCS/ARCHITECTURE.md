---
doc_id: "ARGON-SQUASH-ARCH-001"
title: "Argon Squash — Physical Chess, Wonder First: Modular Architecture & Digital Twin"
version: "2.1.0"
status: "COMPLETED"
updated_at: "2026-10-15T16:06:00-07:00"
target_execution_model: "GLM-5.3 / Non-Reasoning Deterministic Executor"
kstore_namespace: "argon.squash.v2"
kstore_schema_version: "1.3"
governing_principle: "Build -> Play -> Observe -> Adjust -> Compare -> Keep or Revert"
depends_on: []
owns_modules:
  - "src/squash/TuningConfig.js"
  - "src/squash/CourtGeometry.js"
  - "src/squash/NickCollisionModel.js"
  - "src/squash/BallPhysics.js"
  - "src/squash/RulesEngine.js"
  - "src/squash/ShotController.js"
  - "src/squash/BiomechStrokeClassifier.js"
  - "src/squash/PlayerMovement.js"
  - "src/squash/OpponentAI.js"
  - "src/squash/IntroDirector.js"
  - "src/squash/TuningPanel.js"
  - "src/squash/TestHarness.js"
---

# ARGON SQUASH — AUTHORITATIVE ARCHITECTURE (`DOCS/ARCHITECTURE.md`)

## 1. Governing Philosophy & Scope

Argon Squash transforms the 3D arcade racket engine into a modular, tunable 3D Squash simulation and arcade experience guided by **"Physical Chess, Wonder First"**.

1. **Immediate Playability (< 30s)**: Newcomers can rally within 30 seconds of page load, experiencing authentic 4-wall rebounds without memorizing complex button combinations.
2. **Wonder First Onboarding**: Demonstrates two contrasting front-corner nick winners—**Demonstration A (The Spectacular Volley Kill)** and **Demonstration B (The Impossible Gentle Drop)**—using the exact same underlying physics engine, showing that placement, geometry, disguise, and touch are as lethal as raw power.
3. **Hypothesis-Driven Tunability**: All non-fixed physical, biomechanical, and AI parameters live in a hot-reloadable configuration store (`TuningConfig`) exposed via a developer-facing **Live Tuning Lab (`TuningPanel`)** with preset management, deterministic Nick Laboratory cannon testing, JSON import/export, and A/B trajectory comparison.

---

## 2. Canonical World Coordinate System & Fixed WSF Dimensions

All modules (`CourtGeometry`, `BallPhysics`, `NickCollisionModel`, `PlayerMovement`, `OpponentAI`, `RulesEngine`, `ShotController`, `IntroDirector`) MUST obey this single right-handed world coordinate convention:

```
                      FRONT WALL (Z = -4.875m)
         (-3.20m, -4.875m)                (+3.20m, -4.875m)
               ┌────────────────────────────────────┐
               │  Tin: Y <= 0.48m                   │
               │  Service Line: Y = 1.78m           │
               │  Front Out Line: Y = 4.57m         │
               │                                    │
    LEFT WALL  │               FRONT                │  RIGHT WALL
   X = -3.20m  │               COURT                │  X = +3.20m
               │                                    │
               ├─────────────────┬──────────────────┤  SHORT LINE (Z = +0.565m)
               │  LEFT BOX       │      RIGHT BOX   │  T-INTERSECTION: (0, 0, +0.565m)
               ├──────┐   ★ T-RECOVERY POS   ┌──────┤  CANONICAL T-POS: (0, 0, +0.92m)
               │1.6×1.6│    (0, 0, +0.92m)   │1.6×1.6│
               ├──────┘          │           └──────┤  Z = +2.165m
               │                 │                  │
               │   BACK LEFT     │    BACK RIGHT    │
               │    QUARTER      │     QUARTER      │
               │                 │                  │
               └─────────────────┴──────────────────┘
         (-3.20m, +4.875m)                (+3.20m, +4.875m)
                      BACK GLASS WALL (Z = +4.875m)
                      Back Out Line: Y = 2.13m
                      Camera Default: Z ≈ +11.8m looking -Z
```

### 2.1 Fixed Physical Constants (`COURT_SPECS`)
| Constant | Value (Meters) | Description |
| :--- | :--- | :--- |
| `LENGTH` | `9.75` | Total internal length (`Z` from `-4.875` to `+4.875`) |
| `HALF_LENGTH` | `4.875` | `FRONT_WALL_Z = -4.875`, `BACK_WALL_Z = +4.875` |
| `WIDTH` | `6.40` | Total internal width (`X` from `-3.20` to `+3.20`) |
| `HALF_WIDTH` | `3.20` | `LEFT_WALL_X = -3.20`, `RIGHT_WALL_X = +3.20` |
| `FRONT_WALL_OUT_Y` | `4.57` | Front wall out line height |
| `BACK_WALL_OUT_Y` | `2.13` | Back glass wall out line height |
| `SERVICE_LINE_Y` | `1.78` | Front wall service cut line height |
| `TIN_HEIGHT_Y` | `0.48` | Front wall metallic tin height (0.48m club / 0.43m PSA tunable) |
| `SHORT_LINE_Z` | `0.565` | `4.875 - 4.31 = +0.565m` (5.44m from Front Wall, 4.31m from Back Wall) |
| `T_POS` | `(0, 0, +0.92)` | Ideal tactical T-recovery standing position (`0.35m` behind Short Line) |
| `SERVICE_BOX_SIZE` | `1.60` | `X ∈ [±1.60, ±3.20]`, `Z ∈ [+0.565, +2.165]` |
| `BALL_RADIUS` | `0.020` | Physical squash ball radius (`20mm`, visually scaled for readability) |

---

## 3. Modular Subsystem Interfaces

### 3.1 `CourtGeometry` (`src/squash/CourtGeometry.js`)
- **Responsibility**: Builds and updates the 3D four-wall squash court mesh hierarchy, markings, tin, glass reflections, T-zone tactical floor indicator, and visual themes (`psa_glass`, `hardwood_club`, `neon_studio`).
- **Interface**:
  - `COURT_SPECS`: Frozen object of canonical court coordinates.
  - `class CourtGeometry`:
    - `constructor(scene, renderer, options)`
    - `build()` -> `THREE.Group`
    - `setTheme(themeId)` -> Updates materials in-place (`psa_glass`, `hardwood_club`, `neon_studio`).
    - `setTZoneGuideVisible(visible, playerPos, autoTEnabled)` -> Updates the floor T-recovery vector and coverage ring.
    - `flashWallImpact(wallId, pos, isFault)` -> Triggers subtle ripple/glow on wall/tin hit.
    - `sideWallOutHeightAtZ(z)` -> Linearly interpolates side wall out-line height between `Z = -4.875 (4.57m)` and `Z = +4.875 (2.13m)`.

### 3.2 `NickCollisionModel` (`src/squash/NickCollisionModel.js`)
- **Responsibility**: Evaluates experimental wall-floor nick junctions, front-wall/side-wall vertical corner glancing interactions, and deterministic Nick Laboratory ball launches.
- **Interface**:
  - `evaluateWallFloorNick(ball, params)` -> `{ triggered: boolean, quality: 'ROLLOUT_NICK' | 'CLING_NICK' | 'NONE', normalImpulse, lateralRollVel }`
  - `evaluateFrontCornerJunction(ball, params)` -> Handles tight sequential front-wall/side-wall bevel interactions.
  - `getNickLabScenario(scenarioId, params)` -> Returns deterministic initial state `{ pos, vel, spin, description }` for:
    - `'demo_a_kill'` (High volley aggressive kill into front-left nick)
    - `'demo_b_soft_drop'` (Floating open-face cut drop into front-left nick)
    - `'tight_rail'` (Clinging straight drive along left wall)
    - `'two_wall_boast'` (Side-wall to front-wall nick boast)
    - `'back_wall_boast'` (Rear glass recovery boast)

### 3.3 `BallPhysics` (`src/squash/BallPhysics.js`)
- **Responsibility**: Fixed-timestep (`120Hz` with 4x CCD sub-stepping) 3D ball integration, aerodynamic drag, Magnus spin coupling, squash-ball temperature/bounciness scaling, wall/floor restitution, and collision event emission.
- **Interface**:
  - `stepBallPhysics(ball, dt, params, courtSpecs, nickModel, callbacks)`
  - Emits structured collision events: `{ surface: 'front_wall' | 'side_wall_left' | 'side_wall_right' | 'back_wall' | 'floor' | 'tin', pos, speed, isNick, isOut }`.
  - `predictBallTrajectory(initialState, params, maxTimeSec, stepDt)` -> Returns array of `{ t, pos, vel, surfaceHit, bounceCount }` for AI interception and A/B Tuning Lab comparison.

### 3.4 `RulesEngine` (`src/squash/RulesEngine.js`)
- **Responsibility**: Enforces squash rally rules, service box legality, front-wall requirement before second floor bounce, Tin faults (`Y <= tinHeight`), Out lines (front, side sloped, back wall), double-bounce winners, and scoring systems (`PAR_11`, `ARCADE_5`, `HIHO_9`), plus optional Let/Stroke interference checks.
- **Interface**:
  - `class RulesEngine`:
    - `onStrokeHit(hitterRole, isServe, ballState)`
    - `onSurfaceCollision(collisionEvt, ballState)` -> `{ rallyEnded: boolean, winner: 'player' | 'opponent' | null, reason: string, callout: string }`
    - `awardPoint(winnerRole, reason)` -> Updates points, games, hand-in/hand-out server state, and service box side (`left` / `right`).

### 3.5 `ShotController` (`src/squash/ShotController.js`)
- **Responsibility**: Decouples **Preparation (Windup & Hold)** from **Execution (Racket-Face Cut Angle, Forearm Pronation, Swing Speed, and Directional Aim)**.
- **Key Invariant**: Preparation duration does NOT force high power or prevent soft drops. A player can hold a full backswing preparation (`prepCharge = 1.0`) and execute either a `185 km/h` flat drive OR a `44 km/h` `+36°` open-face disguised drop.
- **Interface**:
  - `class ShotController`:
    - `beginPreparation(actor, inputMeta)` -> Enters coiled backswing hold state.
    - `updatePreparation(actor, dt, inputMeta)` -> Updates visual windup hold & disguise posture.
    - `computeShotExecution({ actor, ball, opponent, inputEvent, prepState, params })` -> Returns `{ shotId, label, vel, spin, cutAngleDeg, forearmPronationDegPerSec, isDisguised, targetLanding, timingGrade }`.

### 3.6 `PlayerMovement` (`src/squash/PlayerMovement.js`)
- **Responsibility**: Handles shared-court locomotion for both actors with acceleration, inertia, court boundary clamping, subtle body-clearing around the opponent, manual movement (`WASD` / Arrows / Pose Lunges), and the prominent **AUTO-T-RETURN: ON / OFF** toggle.
- **Interface**:
  - `class PlayerMovement`:
    - `updateActorMovement(actor, otherActor, dt, context)`
    - `setAutoTReturn(enabled)`
    - `computeTRecoveryTarget(actor, ball, params)` -> Returns tactical recovery point near `COURT_SPECS.T_POS` (`(0, 0, +0.92m)`).

### 3.7 `OpponentAI` (`src/squash/OpponentAI.js`)
- **Responsibility**: Implements the "Physical Chess" opponent AI with pattern-memory tracking (detecting repeated straight drives vs drops), preparation reading (reacting to player's windup disguise with configurable `reactionDelayMs` and `anticipationStrength`), T-recovery discipline, and tactical shot selection.
- **Interface**:
  - `class OpponentAI`:
    - `recordPlayerShot(shotDescriptor)` -> Updates pattern memory window.
    - `observePlayerPreparation(playerActor, prepState)` -> May bias AI deeper when player shows full drive windup.
    - `updateAI(opponentActor, playerActor, ball, dt, params, callbacks)`

### 3.8 `IntroDirector` (`src/squash/IntroDirector.js`)
- **Responsibility**: Orchestrates the playable, skippable two-part signature onboarding (**Demonstration A: The Spectacular Volley Kill** and **Demonstration B: The Impossible Gentle Drop**), dry coaching commentary banners, and interactive slow-motion corner nick replay inspection.
- **Interface**:
  - `class IntroDirector`:
    - `startIntroSequence(mode = 'full')` (`'demo_a'`, `'demo_b'`, `'full'`)
    - `skipIntro()`
    - `triggerSlowMoInspection()`
    - `update(dt)`

### 3.9 `TuningPanel` & `TestHarness` (`src/squash/TuningPanel.js`, `src/squash/TestHarness.js`)
- **Responsibility**: Renders the toggleable **Live Tuning Lab** (`Lab / Tune` button or `L` key) with:
  1. Live sliders for **Ball Physics**, **Racket & Shot Mechanics**, **Movement & AI**, and **Biomechanical Stroke Classifier** (`handedness`, confidence hysteresis, temporal weights).
  2. **Preset Manager**: Save named preset, Duplicate preset, Switch preset, Reset module/all, JSON Export/Import.
  3. **Nick Laboratory & Deterministic A/B Comparator**: Launch repeatable shots (`Demo A Kill`, `Demo B Floating Drop`, `Tight Rail`, `Boast`, `Off-Back-Wall Drive`) and compare Preset A vs Preset B trajectories side-by-side with identical seeds.
  4. **Automated Invariant Test Runner**: Runs and displays pass/fail status for court bounds, wall/tin rules, nick physics, Auto-T-Return, decoupled shot disguise, and biomechanical Forehand/Backhand classification.

---

### 3.10 `BiomechStrokeClassifier` (`src/squash/BiomechStrokeClassifier.js`) — Player-Relative Temporal Forehand/Backhand Classification

#### 3.10.1 Legacy Classifier Audit (Actual Implementation Deficiencies)
The legacy classifier inside `MotionController._evaluateHandTrail` relied on three fragile heuristics:
1. **Horizontal Swing Velocity Sign (`vx < -0.14` = Forehand; `vx > +0.14` = Backhand)**: Conflated finishing swing vector with anatomical stroke identity. Legitimate forehand inside-out drives, forehand open-faced cut drops carving outward, and left-handed cross-body strokes violate this rule; conversely, cross-body follow-throughs or late wrist snaps reversed stroke identity mid-swing.
2. **2D Index/Pinky MCP Horizontal Ordering (`idxX < pnkX`)**: Treated 2D screen projection of `lm[5].x` vs `lm[17].x` as definitive evidence of pronation/supination without accounting for forearm elevation, wrist flexion, camera perspective foreshortening, or handedness.
3. **Static Screen Centerline Fallback (`first.x < bodyCenterX`)**: Ignored torso rotation, hitting-shoulder/elbow lever geometry, temporal preparation history, and confidence degradation under partial occlusion.

#### 3.10.2 Approved Biomechanical Architecture & Separation of Concerns
`BiomechStrokeClassifier` is a standalone, zero-DOM-coupled biomechanical classifier module (reusable across both **Argon Squash** and **VirtuaSquash**) that strictly separates **Stroke Identity** from **Shot Mechanics**:

- **Independent Output Contract (`StrokeClassificationResult`)**:
  ```ts
  interface StrokeClassificationResult {
    strokeSide: 'forehand' | 'backhand' | 'uncertain'; // Canonical anatomical stroke identity
    lockedStrokeSide: 'forehand' | 'backhand' | 'uncertain'; // Hysteresis-stabilized side
    confidence: number; // [0.0 .. 1.0] overall biomechanical confidence
    phase: 'IDLE' | 'PREPARATION' | 'BACKSWING_APEX' | 'FORWARD_SWING' | 'INFERRED_CONTACT' | 'FOLLOW_THROUGH';
    handedness: 'right' | 'left';
    shotMechanics: {
      shotType: 'drive' | 'drop' | 'cut_drop' | 'lob' | 'boast' | 'volley_kill';
      cutModifier: boolean;
      isDeceptiveLateRelease: boolean;
      speedNormalized: number;
      dirX: number;
      dirY: number;
    };
    swingKinematics: {
      peakSpeed: number;
      contactVelocity: { vx: number; vy: number; vz: number };
      peakAcceleration: number;
      followThroughVector: { dx: number; dy: number };
      isCrossBodyFollowThrough: boolean;
    };
    racquetFaceOrientation: {
      normal3D: { nx: number; ny: number; nz: number };
      openFaceCutDeg: number;
      pronationState: 'supinated_open' | 'neutral_square' | 'pronated_closed' | 'uncertain';
      orientationConfidence: number; // Degrades gracefully to 0 under foreshortening/occlusion
    };
    playerGeometry: {
      sDomPrep: number;      // Preparation lateral offset in dominant-shoulder units (+ = Forehand side, - = Backhand side)
      sDomApex: number;      // Backswing apex lateral offset in dominant-shoulder units
      sDomContact: number;   // Inferred contact lateral offset in dominant-shoulder units
      elbowLeverageScore: number; // Hitting wrist vs elbow/shoulder anatomical configuration [-1..+1]
      torsoYawDeg: number;   // Estimated upper-torso coil angle
    };
    evidenceBreakdown: {
      prepApexScore: number;     // [-1 (BH) .. +1 (FH)]
      contactZoneScore: number;  // [-1 (BH) .. +1 (FH)]
      armChainScore: number;     // [-1 (BH) .. +1 (FH)]
      palmNormalScore: number;   // [-1 (BH) .. +1 (FH)]
      kinematicSupportScore: number; // [-1 (BH) .. +1 (FH)]
    };
  }
  ```

#### 3.10.3 Canonical Player-Centric Coordinate Transformation
Before any biomechanical calculation, raw camera landmarks `(u, v, z)` are transformed into the **True Player Anatomical Frame**:
1. **Camera Perspective Normalization**:
   - Let `u_raw ∈ [0, 1]` be raw image horizontal coordinate.
   - We transform into **Player-Facing Physical Coordinates** where `+X_phys` always corresponds to the player's **Anatomical Right Side** when facing the camera/TV:
     - For `facingMode === 'user'` (Front-facing camera): in raw unmirrored sensor space, the player's anatomical right arm is at smaller `u_raw` (`x_phys = 0.5 - u_raw`); in already-mirrored display space (`u_mirrored = 1 - u_raw`), `x_phys = u_mirrored - 0.5`. `BiomechStrokeClassifier.normalizePoint()` explicitly accepts `{ coordSpace: 'raw_sensor' | 'display_mirrored', facingMode: 'user' | 'environment' }` so mirrored and unmirrored feeds map to the exact same anatomical frame.
2. **Torso Origin, Shoulder Width & Dominant-Side Basis Vector ($\hat{\mathbf{u}}_{dom}$)**:
   - From MediaPipe Pose landmarks (`left_shoulder [11]`, `right_shoulder [12]`, `left_elbow [13]`, `right_elbow [14]`, `left_hip [23]`, `right_hip [24]`) or adaptive upper-body torso tracking:
     - Torso Center: $\mathbf{C}_{torso}(t) = \frac{1}{2}(\mathbf{S}_L(t) + \mathbf{S}_R(t))$
     - Shoulder Span: $W_{sh}(t) = \max(0.10, \|\mathbf{S}_R(t) - \mathbf{S}_L(t)\|)$
     - Dominant Lateral Axis:
       $$\hat{\mathbf{u}}_{dom} = \begin{cases} +1 \cdot \hat{\mathbf{u}}_{right} & \text{if handedness = 'right'} \\ -1 \cdot \hat{\mathbf{u}}_{right} & \text{if handedness = 'left'} \end{cases}$$
   - Any hitting-hand/wrist position $\mathbf{H}(t)$ is projected into **Dominant-Shoulder Normalized Coordinates**:
     $$s_{dom}(t) = \frac{(\mathbf{H}(t) - \mathbf{C}_{torso}(t)) \cdot \hat{\mathbf{u}}_{dom}(t)}{W_{sh}(t)}$$
     - **$s_{dom}(t) > 0$**: Hitting hand is on the player's **Dominant / Open (Forehand) side** of their torso centerline.
     - **$s_{dom}(t) < 0$**: Hitting hand is across the midline on the player's **Non-Dominant (Backhand) side** of their torso centerline.

#### 3.10.4 Temporal Sequence Classification (`Preparation → Backswing → Forward Swing → Contact → Follow-Through`)
Instead of classifying from a single 2-point velocity delta, `BiomechStrokeClassifier` maintains a sliding temporal buffer (`600ms` window) and segments each stroke into phases:
1. **`PREPARATION` & `BACKSWING_APEX`** (Primary Weight: `0.55`):
   - Records where the racket/hand is loaded (`sDomPrep`) and reaches peak coil (`sDomApex`) before forward acceleration begins.
   - Once forward acceleration peaks (`FORWARD_SWING`), the preparation/backswing evidence is **latched** so that a cross-body follow-through (`FOLLOW_THROUGH` crossing into negative `s_dom`) or a deceptive late wrist flick cannot overwrite the preparation side.
2. **`INFERRED_CONTACT` & Hitting-Arm Chain Geometry** (Secondary Weight: `0.30`):
   - Evaluates the hand's player-relative position at peak speed (`sDomContact`) and, when Pose elbow/shoulder landmarks are present, the **Elbow-to-Wrist Lever Configuration** (whether the hitting wrist is loaded lateral to the hitting shoulder/elbow in an open forehand slot or across the chest/lead shoulder in a backhand slot).
3. **3D Palm Surface Normal & Supporting Kinematics** (Supporting Weight: `0.15`):
   - Computes the 3D cross-product palm normal $\mathbf{n}_{palm} = (\mathbf{P}_9 - \mathbf{P}_0) \times (\mathbf{P}_5 - \mathbf{P}_{17})$ weighted by `foreshorteningConfidence` (downweighting edge-on or occluded views).
   - Uses horizontal velocity only as a weak supporting cue (`weight <= 0.08`), ensuring that an inside-out Forehand (`vx` moving toward the dominant side) or a vertical Forehand/Backhand Cut Drop (`vx ≈ 0`) is classified accurately by its player-relative preparation and contact geometry.
4. **Confidence & Anti-Flicker Hysteresis**:
   - If total weighted evidence magnitude $|E_{total}| < \theta_{uncertain}$ (default `0.22`) or landmark visibility is degraded, `strokeSide` reports `'uncertain'`, and `lockedStrokeSide` retains the last high-confidence stance (`>= 0.52`) with exponential decay rather than flickering rapidly between `FH` and `BH`.

---

## 4. Acceptance Criteria & Verification Gates

1. **Gate A (Playable Rally)**: Ball launches legally off the front wall (`Z = -4.875m`, `1.78m < Y < 4.57m` on serve; `0.48m < Y < 4.57m` in rally), rebounds into shared court, and both Mii characters rally continuously with visible PAR 11 scoring.
2. **Gate B (Coordinate & Auto-T-Return Integrity)**: T-Position is at `(0, 0, +0.92m)` just behind the Short Line (`Z = +0.565m`). Toggling `AUTO-T-RETURN: ON/OFF` immediately switches between physical auto-recovery to the T and full manual positioning.
3. **Gate C (Decoupled Disguise & Shot Shaping)**: A full preparation windup (`prepDuration >= 0.45s`) can produce both a `>165 km/h` flat drive AND a `<55 km/h` open-face (`+34° cut`) disguised drop shot.
4. **Gate D (Physical Nick Emergence)**: Both Demonstration A (fast volley kill) and Demonstration B (slow open-face drop) achieve a wall-floor nick rollout (`max rebound height < 0.06m`) through `NickCollisionModel` + `BallPhysics` without scripted teleportation.
5. **Gate E (Live Tuning Lab & Determinism)**: Adjusting any parameter in `TuningPanel` updates the running game immediately; running the same Nick Lab seed twice produces identical trajectories (`Δpos < 1e-6m`).
6. **Gate F (Biomechanical Forehand/Backhand Stroke Classification)**: `BiomechStrokeClassifier` passes 100% of reproducible stroke suites across right-handed, left-handed, mirrored front-cam, unmirrored rear-cam, vertical drops/lobs, cross-body follow-throughs, late deceptive wrist changes, partial occlusion (`uncertain` degradation), and strokes whose horizontal `vx` sign contradicts naive screen-direction rules.

