# Argon Squash — Modular, Playable, Tunable ("Physical Chess, Wonder First")

Argon Squash delivers a modular, immediately playable 3D squash game built around the **Physical Chess, Wonder First** philosophy and governed by the engineering loop: **Build → Play → Observe → Adjust → Compare → Keep or Revert**. All uncertain physics, shot-shaping, movement, and AI parameters are exposed in a developer-facing **Live Tuning Lab** with preset management, JSON import/export, deterministic Nick Laboratory launchers, and A/B configuration comparison.

---

## 1. Modular Architecture & Explicit Interfaces

Every subsystem lives in a dedicated, replaceable ES module under `/src/squash/` with zero monolithic coupling between rendering, physics, controls, and rules:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                  DOCS/ARCHITECTURE.md  &  CHECKLIST.md                        │
│        (Authoritative Digital Twin, Invariants & Dependency-Ordered DAG)      │
└───────────────────────────────────────┬───────────────────────────────────────┘
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                     MODULAR SQUASH SUBSYSTEMS (/src/squash/)                  │
├─────────────────────────┬───────────────────────────┬─────────────────────────┤
│  1. CourtGeometry       │  2. BallPhysics           │  3. NickCollisionModel  │
│  • WSF 9.75m × 6.4m     │  • 120Hz CCD Sub-Stepping │  • Wall-Floor Junction  │
│  • Single World Coord   │  • Gravity, Drag, Magnus  │    Compression & Roll   │
│    Convention (+Z Back, │  • Front/Side/Back Wall & │  • Front-Corner Vertical│
│    -Z Front, T=(0,0.61))│    Floor Restitution      │    Bevel Glancing       │
│  • Themes: PSA Glass,   │  • Ball Temperature /     │  • Deterministic Nick   │
│    Hardwood, Studio     │    Bounciness Curve       │    Laboratory Launcher  │
├─────────────────────────┼───────────────────────────┼─────────────────────────┤
│  4. ShotController      │  5. PlayerMovement        │  6. OpponentAI          │
│  • Decoupled Prep Hold  │  • Inertia & Accel Bounds │  • Pattern-Memory Window│
│    vs Contact Execution │  • AUTO-T-RETURN: ON/OFF  │  • Preparation Reading  │
│  • Racket Face Angle &  │  • Shared-Court Clearing  │    & Split-Step Lag     │
│    Cut/Spin Shaping     │  • T-Coverage Floor Cone  │  • Positional Bias      │
├─────────────────────────┼───────────────────────────┼─────────────────────────┤
│  7. RulesEngine         │  8. IntroDirector         │  9. TuningPanel & Test  │
│  • PAR 11 / Arcade 5 /  │  • Demo A: Volley Kill    │  • Live Tuning Lab (L)  │
│    HiHo 9 Scoring       │  • Demo B: Disguised Drop │  • Presets, Copy, JSON  │
│  • Tin, Out Lines,      │  • Slow-Mo Corner Replay  │  • Deterministic Seed   │
│    Service Box & Let    │  • Dry Coaching Callouts  │    A/B Comparison & Test│
└─────────────────────────┴───────────────────────────┴─────────────────────────┘
```

---

## 2. Playable Milestones (A → F) & Verification Harness

1. **Pre-Code Blueprint (`DOCS/ARCHITECTURE.md` & `CHECKLIST.md`)**:
   - Author the digital twin specification and `kstore`-compatible dependency-ordered checklist before modifying runtime code.
2. **Milestone A — First Playable Rally**:
   - Regulation 3D four-wall court (`CourtGeometry`), two shared-court Mii athletes facing the front wall (`-Z`), continuous 120Hz `BallPhysics`, legal wall/floor rebounds, basic racket strikes, simple rally AI, and live `RulesEngine` scoring.
3. **Milestone B — Movement, Positioning & Auto-T-Return**:
   - Single documented world coordinate convention (`Z = -4.875m` Front Wall, `Z = +4.875m` Back Wall, `Z = +0.565m` Short Line, **T-Position** at `(0, 0, +0.95m)` just behind the Short Line).
   - Prominent **AUTO-T-RETURN: ON / OFF** HUD toggle + manual `WASD`/Arrow/Pose movement with realistic acceleration, inertia, and optional T-coverage floor vector guide.
4. **Milestone C — Decoupled Shot Shaping**:
   - `ShotController` decoupling preparation duration/posture from contact execution (racket-face cut angle, swing speed, direction), enabling straight drives, cross-courts, disguised hold-and-drops, volley kills, two-wall boasts, back-wall boasts, and lobs.
5. **Milestone D — Nick Laboratory & Live Tuning Lab**:
   - `NickCollisionModel` + interactive **Live Tuning Lab (`Lab / Tune` button or `L` key)** with sliders for ball physics, racket/shot mechanics, and movement/AI, plus **Preset Save/Duplicate/Switch/Reset/JSON Export-Import**, **Deterministic Nick Cannon** (test Demo A Kill vs Demo B Soft Cut from identical seeds), and **A/B Trajectory Comparison**.
6. **Milestone E — Physical Chess AI**:
   - `OpponentAI` with tunable anticipation strength, reaction delay, pattern-memory window, and drive-trance vulnerability.
7. **Milestone F — Wonder-First Introduction & Test Suite**:
   - `IntroDirector` running the playable/skippable **Demonstration A (Spectacular Volley Kill)** and **Demonstration B (Impossible Gentle Drop)** with slow-motion corner replay, plus an automated invariant test runner (`window.__argonSquashTests.runAll()`).
