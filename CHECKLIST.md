---
checklist_id: "ARGON-SQUASH-DAG-001"
version: "2.1.0"
status: "COMPLETED"
architecture_ref: "DOCS/ARCHITECTURE.md"
target_executor: "GLM-5.3 / Non-Reasoning Execution Agent"
kstore_meta:
  namespace: "argon.squash.v2.tasks"
  execution_policy: "sequential_dag_verified"
  rollback_strategy: "module_level_preset_snapshot"
  deterministic_seed_default: 20261015
---

# ARGON SQUASH — EXECUTION CHECKLIST (`CHECKLIST.md`)

This document is the dependency-ordered execution recipe for **Argon Squash — Physical Chess, Wonder First**. Each task specifies explicit module ownership, dependencies, acceptance gates, and verification commands.

---

## Orchestration Task Graph (DAG)

```
[TASK-01: TuningConfig & Presets]
       │
       ├──► [TASK-02: CourtGeometry (WSF 4-Wall + Tin + T-Guide)]
       │           │
       ├──► [TASK-03: NickCollisionModel & BallPhysics (120Hz CCD)]
       │           │
       ├──► [TASK-04: RulesEngine (PAR 11 / Arcade 5 / Tin / Out)]
       │           │
       │           ▼
       ├──► [TASK-05: Milestone A — First Playable Rally Integration]
       │           │
       │           ▼
       ├──► [TASK-06: Milestone B — PlayerMovement & AUTO-T-RETURN Toggle]
       │           │
       │           ▼
       ├──► [TASK-07: Milestone C — ShotController (Decoupled Prep & Disguise)]
       │           │
       │           ▼
       ├──► [TASK-08: Milestone D — Nick Laboratory & Live Tuning Panel]
       │           │
       │           ▼
       ├──► [TASK-09: Milestone E — Physical Chess OpponentAI]
       │           │
       │           ▼
       ├──► [TASK-10: Milestone F — Wonder-First IntroDirector & TestHarness]
       │           │
       │           ▼
       ├──► [TASK-11: BiomechStrokeClassifier Core Module (Player-Relative & Temporal)]
       │           │
       │           ▼
       ├──► [TASK-12: MediaPipe Pose + Hands & Mirrored/Unmirrored Camera Integration]
       │           │
       │           ▼
       ├──► [TASK-13: HUD Stance/Uncertainty Feedback & Handedness Tuning Controls]
       │           │
       │           ▼
       └──► [TASK-14: Reproducible Biomechanical Stroke Validation Suite (Gate F)]
```

---

## Ordered Tasks & Acceptance Gates

### `TASK-01` — Tunable Parameter Store, Presets & Deterministic RNG
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/TuningConfig.js`
- **Depends On**: `[]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-01`
- **Deliverables**:
  - Central reactive configuration store separating fixed WSF dimensions from tunable **Ball Physics**, **Racket & Shot Mechanics**, and **Movement & AI** parameters.
  - Built-in presets (`"Default Physical Chess"`, `"Arcade Accessible"`, `"PSA Tour Pro"`, `"Warm Bouncy Ball"`, `"Cold Dead Ball"`).
  - Preset operations: `savePreset`, `duplicatePreset`, `selectPreset`, `resetModule`, `resetAll`, `exportJSON`, `importJSON`, plus seeded PRNG (`mulberry32`).
- **Acceptance Gate**: Mutating any parameter immediately notifies listeners; JSON export/import round-trips without data loss.

### `TASK-02` — 3D Four-Wall Squash Court Geometry & Tactical Floor Guide
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/CourtGeometry.js`
- **Depends On**: `["TASK-01"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-02`
- **Deliverables**:
  - Regulation `9.75m × 6.40m` 3D court with Front Wall (`Z = -4.875m`), Back Glass Wall (`Z = +4.875m`), Side Walls (`X = ±3.20m`), Tin (`Y = 0.48m`), Service Line (`Y = 1.78m`), Front Out Line (`Y = 4.57m`), Sloped Side Out Lines (`4.57m -> 2.13m`), Short Line (`Z = +0.565m`), Half-Court Line, Service Boxes (`1.60m × 1.60m`), and T-Position marker (`(0, 0, +0.92m)`).
  - Switchable themes (`psa_glass`, `hardwood_club`, `neon_studio`) and dynamic T-Recovery path & coverage cone visualization.
- **Acceptance Gate**: `COURT_SPECS.SHORT_LINE_Z === 0.565` and `COURT_SPECS.T_POS.z === 0.92`; zero Z-fighting on court lines.

### `TASK-03` — 120Hz Ball Physics & Wall-Floor Nick Collision Model
- **Status**: `[x] COMPLETED`
- **Owner Modules**: `src/squash/NickCollisionModel.js`, `src/squash/BallPhysics.js`
- **Depends On**: `["TASK-01", "TASK-02"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-03`
- **Deliverables**:
  - Continuous collision detection (4 sub-steps per 120Hz tick) against Front Wall, Tin, Side Walls, Back Wall, and Floor.
  - Spin-coupled rebound friction (open-face underspin cuts sit down and lose forward pace; topspin drives carry deep).
  - Wall-floor nick junction solver (`evaluateWallFloorNick`) and front-corner vertical junction bevel deflection (`evaluateFrontCornerJunction`).
  - Trajectory predictor & deterministic A/B simulator (`simulateTrajectoryWithConfig`).
- **Acceptance Gate**: Both high-speed volley kill (`Demo A`) and low-speed floating cut drop (`Demo B`) into the side-wall/floor junction produce a rollout nick (`bounce apex < 0.06m`) via the same physics solver.

### `TASK-04` — Squash Rules Engine & Scoring Modes
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/RulesEngine.js`
- **Depends On**: `["TASK-02", "TASK-03"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-04`
- **Deliverables**:
  - Full enforcement of Front Wall requirement before second bounce, Tin fault (`Y <= tinHeight`), Out lines, service box cross-court target rules, and double floor bounce winners.
  - Selectable scoring rules: `PAR_11` (Point-A-Rally to 11, win by 2), `ARCADE_5` (Quick 5-point games), and `HIHO_9` (Hand-In/Hand-Out to 9), plus Let/Stroke interference checks.
- **Acceptance Gate**: Hitting the Tin immediately awards the point to the non-hitter with `"Tin / Down"` callout; hitting the side wall before the front wall (boast) remains legal until it strikes the front wall above the Tin.

### `TASK-05` — Milestone A: First Playable Rally Integration
- **Status**: `[x] COMPLETED`
- **Owner Modules**: `src/game_engine.js`, `src/audio_engine.js`, `src/hud_ui.js`
- **Depends On**: `["TASK-02", "TASK-03", "TASK-04"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-05`
- **Deliverables**:
  - Shared-court Mii placement (Player 1 and Opponent side-by-side facing `-Z`), squash ball visual & restrained flight ribbon, squash wall/tin/nick/shoe acoustics, and continuous legal rallying.
- **Acceptance Gate**: Game boots cleanly with zero console errors; player and AI rally off all four walls with live scoreboard updates.

### `TASK-06` — Milestone B: Player Movement & Prominent `AUTO-T-RETURN: ON/OFF`
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/PlayerMovement.js`
- **Depends On**: `["TASK-05"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-06`
- **Deliverables**:
  - Prominent HUD & Setup toggle for **`AUTO-T-RETURN: ON / OFF`**.
  - Realistic acceleration, max speed, momentum, and shared-court clearing around the T (`(0, 0, +0.92m)`).
  - Manual positioning via `WASD`/Arrow keys, mouse court-step, or webcam body pose lunges when `AUTO-T-RETURN` is `OFF` (or manual override when `ON`).
- **Acceptance Gate**: With `AUTO-T-RETURN: ON`, the player recovers toward `(0, 0, +0.92m)` after striking at physical running speed; with `OFF`, leaving the corner unrecovered leaves the opposite corner open.

### `TASK-07` — Milestone C: Decoupled Shot Shaping & Disguise Controller
- **Status**: `[x] COMPLETED`
- **Owner Modules**: `src/squash/ShotController.js`, `src/racket_kinematics.js`, `src/motion_controls.js`
- **Depends On**: `["TASK-05", "TASK-06"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-07`
- **Deliverables**:
  - Independent **Preparation (Hold/Windup)** vs **Execution (Racket-Face Cut Angle, Swing Velocity, Direction)**.
  - Support for Straight Drive, Cross-Court Drive, Disguised Drop, Volley Drop, Volley Kill, Two-Wall Boast, Back-Wall Boast, and High Lob without 8 separate shot buttons.
- **Acceptance Gate**: Player can hold preparation (`Spacebar` or Left-Click hold) to show a full drive windup, then either release cleanly for a deep drive or apply Cut/Feather release (`Shift` / Right-Click / Upward-Open flick) for a disguised soft drop.

### `TASK-08` — Milestone D: Nick Laboratory & Live Tuning Lab UI
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/TuningPanel.js`
- **Depends On**: `["TASK-01", "TASK-03", "TASK-07"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-08`
- **Deliverables**:
  - Developer/Lab Drawer (`Lab / Tune (L)` button in HUD) with live sliders for Ball Physics, Racket/Shot Mechanics, and Movement/AI.
  - Preset management (Save, Duplicate, Switch, Reset, JSON Export/Import).
  - Interactive **Nick Laboratory Cannon** (fire repeatable `Demo A Kill`, `Demo B Soft Cut`, `Tight Rail`, `2-Wall Boast`, `Back-Wall Boast` shots) and **A/B Preset Comparison** table.
- **Acceptance Gate**: Clicking `"Fire Demo A: Volley Kill"` or `"Fire Demo B: Gentle Drop"` in the Nick Lab launches the exact trajectory in the live 3D viewport and logs the resulting bounce height and nick classification.

### `TASK-09` — Milestone E: Physical Chess Opponent AI
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/OpponentAI.js`
- **Depends On**: `["TASK-06", "TASK-07"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-09`
- **Deliverables**:
  - Pattern-memory tracking (lulling the AI into a deep-drive rhythm) and preparation-posture reading with tunable `reactionDelayMs` and `anticipationStrength`.
  - Respects identical physical speed and acceleration constraints as the player.
- **Acceptance Gate**: Establishing 3+ consecutive straight drives shifts the AI's anticipation bias deeper behind the T, making a disguised hold-and-drop measurably harder for the AI to reach.

### `TASK-10` — Milestone F: Wonder-First Intro Director & Automated Test Harness
- **Status**: `[x] COMPLETED`
- **Owner Modules**: `src/squash/IntroDirector.js`, `src/squash/TestHarness.js`
- **Depends On**: `["TASK-08", "TASK-09"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-10`
- **Deliverables**:
  - Playable, optionally skippable two-part signature intro (**Demo A: Spectacular Kill** → *"BUT IT DIDN'T EVEN BOUNCE! DO I GET A MULLIGAN?!"* and **Demo B: Impossible Gentle Drop** → *"Too fast for you? Okay, I'll do it slowly." ... tap ... roll ... "WHAT?! STILL CAN'T GET IT FROM THE BACK?!"*) with slow-motion corner replay inspection.
  - Automated physical and rules verification suite (`window.__argonSquashTests.runAll()`).
- **Acceptance Gate**: `npm run build` succeeds with zero errors; `window.__argonSquashTests.runAll()` passes 100% of invariant checks.

### `TASK-11` — Biomechanical Stroke Classifier Core Module (`BiomechStrokeClassifier.js`)
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/BiomechStrokeClassifier.js`
- **Depends On**: `["TASK-07"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-11`
- **Deliverables**:
  - Standalone, VirtuaSquash-reusable module separating `strokeSide` (`'forehand' | 'backhand' | 'uncertain'`) from `shotMechanics` (`drive | drop | cut_drop | lob | boast | volley_kill`), `swingKinematics`, `racquetFaceOrientation`, and `confidence`.
  - Player-centric coordinate frame transformation (`s_dom(t)`) invariant to screen-left/right translation, camera mirroring (`user` vs `environment`), and player handedness (`right` vs `left`).
  - Temporal phase segmentation (`IDLE -> PREPARATION -> BACKSWING_APEX -> FORWARD_SWING -> INFERRED_CONTACT -> FOLLOW_THROUGH`) that locks preparation/apex & hitting-arm geometry so cross-body follow-throughs or late wrist snaps cannot reverse stroke identity.
  - 3D palm normal estimation ($\mathbf{n}_{palm} = (\mathbf{P}_9 - \mathbf{P}_0) \times (\mathbf{P}_5 - \mathbf{P}_{17})$) with perspective foreshortening & occlusion confidence degradation.
- **Acceptance Gate**: Legitimate forehand and backhand strokes that travel opposite to naive `vx` thresholds are classified accurately with `confidence >= 0.60`; degraded/ambiguous frames return `'uncertain'` without flickering.

### `TASK-12` — MediaPipe Pose + Hands & Camera Perspective Integration (`motion_controls.js`)
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/motion_controls.js`
- **Depends On**: `["TASK-11"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-12`
- **Deliverables**:
  - Integrate `BiomechStrokeClassifier` into `MotionController` for both 1P and 2P Kinect Split-Zone modes.
  - Support optional MediaPipe Pose / upper-body shoulder-elbow-torso landmarks (`lm[11..16]`, `lm[23..24]`) alongside MediaPipe Hands (`lm[0..20]`) and Optical Flow torso/hand tracking.
  - Consistent coordinate normalization for front-facing mirrored (`facingMode: 'user'`) and rear-facing unmirrored (`facingMode: 'environment'`) cameras before biomechanical classification.
- **Acceptance Gate**: Both front-cam and rear-cam feeds produce identical anatomical `strokeSide` classifications for right-handed and left-handed players across the camera frame.

### `TASK-13` — HUD Stance/Uncertainty Feedback & Handedness Controls (`TuningConfig.js`, `TuningPanel.js`, `index.html`, `game_engine.js`)
- **Status**: `[x] COMPLETED`
- **Owner Modules**: `src/squash/TuningConfig.js`, `src/squash/TuningPanel.js`, `src/motion_controls.js`, `src/game_engine.js`, `index.html`
- **Depends On**: `["TASK-12"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-13`
- **Deliverables**:
  - Add `handedness` (`'right' | 'left'`) and biomechanical confidence thresholds to `TuningConfig` and `TuningPanel`, plus a quick Handedness toggle (`🤚 Right-Handed` / `🤚 Left-Handed`) in the HUD/Setup controls.
  - Update Pose Cam PiP overlay to display stabilized stance (`FH STANCE`, `BH STANCE`, or `HOLD / UNCERTAIN` when confidence is low) without rapid label flickering.
  - Preserve 3D Mii swing animations and gameplay mappings, falling back cleanly to court-ball geometry only when `strokeSide === 'uncertain'`.
- **Acceptance Gate**: Switching handedness between Right and Left immediately inverts the dominant anatomical axis $\hat{\mathbf{u}}_{dom}$ and updates the Pose Cam HUD and Mii stroke animations.

### `TASK-14` — Reproducible Biomechanical Stroke Validation Suite (`TestHarness.js`)
- **Status**: `[x] COMPLETED`
- **Owner Module**: `src/squash/TestHarness.js`
- **Depends On**: `["TASK-11", "TASK-12", "TASK-13"]`
- **kstore Key**: `argon.squash.v2.tasks.TASK-14`
- **Deliverables**:
  - Reproducible multi-frame landmark trajectory test cases in `TestHarness.js` validating:
    1. Standard Forehand & Backhand Drives (`TEST-BIOMECH-01`)
    2. Forehand & Backhand Drops, Vertical Chops/Cut Drops (`vx ≈ 0`), and High Lobs (`TEST-BIOMECH-02`)
    3. Cross-Body Follow-Throughs & Deceptive Late Wrist Changes (`TEST-BIOMECH-03`)
    4. Contradictory `vx` Sign Strokes (Inside-Out Forehand with `vx > 0` and Inside-Out Backhand with `vx < 0`) (`TEST-BIOMECH-04`)
    5. Left-Handed Player Equivalents & Mirrored (`user`) vs. Unmirrored (`environment`) Camera Invariance (`TEST-BIOMECH-05`)
    6. Partial Hand Occlusion & Missing Landmark Graceful Degradation to `'uncertain'` (`TEST-BIOMECH-06`)
- **Acceptance Gate**: All 6 biomechanical test suites (plus all 6 existing physics/rules suites) pass 100% in `TestHarness.runAll()`.

