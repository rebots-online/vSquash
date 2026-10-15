// ============================================================================
// ARGON SQUASH — LIVE TUNING LAB & NICK LABORATORY UI (TuningPanel.js)
// Implements Sections 3, 4 & 6:
//   - Live sliders for Ball Physics, Racket/Shot Mechanics, and Movement/AI
//   - Preset save, duplicate, switch, reset module/all, JSON export/import
//   - Nick Laboratory deterministic cannon (Demo A Kill, Demo B Gentle Drop,
//     Tight Rail, Two-Wall Boast, Back-Wall Boast)
//   - Side-by-side A/B Preset Trajectory Comparison & Automated Invariant Tests
// ============================================================================

import { tuningStore } from './TuningConfig.js';
import { NickCollisionModel } from './NickCollisionModel.js';
import { BallPhysics } from './BallPhysics.js';
import { TestHarness } from './TestHarness.js';

const SLIDER_SCHEMA = {
  ballPhysics: {
    title: 'Ball Physics & Nick Model',
    fields: [
      { key: 'gravity', label: 'Gravity (m/s²)', min: 6.0, max: 14.0, step: 0.1 },
      { key: 'ballTemperatureC', label: 'Ball Temp / Bounciness (°C)', min: 18.0, max: 46.0, step: 0.5 },
      { key: 'frontWallRestitution', label: 'Front Wall Restitution', min: 0.45, max: 0.85, step: 0.01 },
      { key: 'sideWallRestitution', label: 'Side Wall Restitution', min: 0.45, max: 0.85, step: 0.01 },
      { key: 'backWallRestitution', label: 'Back Glass Restitution', min: 0.40, max: 0.86, step: 0.01 },
      { key: 'backWallSitUpLift', label: 'Back-Wall Upward Sit-Up Lift', min: 0.40, max: 1.65, step: 0.05 },
      { key: 'floorRestitution', label: 'Floor Restitution', min: 0.35, max: 0.78, step: 0.01 },
      { key: 'surfaceFriction', label: 'Surface Tangential Friction', min: 0.60, max: 0.96, step: 0.01 },
      { key: 'spinSurfaceBite', label: 'Spin-to-Wall Bite', min: 0.0, max: 0.06, step: 0.002 },
      { key: 'nickToleranceMeters', label: 'Nick Junction Tolerance (m)', min: 0.020, max: 0.085, step: 0.002 },
      { key: 'nickVerticalEnergyLoss', label: 'Nick Vertical Energy Loss', min: 0.65, max: 0.98, step: 0.01 }
    ]
  },
  shotMechanics: {
    title: 'Racket & Shot Shaping',
    fields: [
      { key: 'baseDriveSpeedMps', label: 'Base Drive Speed (m/s)', min: 16.0, max: 32.0, step: 0.5 },
      { key: 'maxKillSpeedMps', label: 'Volley Kill Speed (m/s)', min: 22.0, max: 38.0, step: 0.5 },
      { key: 'softDropSpeedMps', label: 'Soft Drop Speed (m/s)', min: 8.5, max: 16.5, step: 0.2 },
      { key: 'defaultDriveCutDeg', label: 'Drive Face Angle (°)', min: -6.0, max: 12.0, step: 1.0 },
      { key: 'defaultDropCutDeg', label: 'Open Cut Drop Angle (°)', min: 18.0, max: 48.0, step: 1.0 },
      { key: 'prepFullChargeSec', label: 'Full Prep Windup Time (s)', min: 0.20, max: 0.85, step: 0.02 },
      { key: 'placementAssistStrength', label: 'Arcade Placement Assist', min: 0.0, max: 1.0, step: 0.05 },
      { key: 'spinMagnitudeScale', label: 'Cut/Spin Magnitude Scale', min: 0.4, max: 1.8, step: 0.05 },
      { key: 'biomechUncertainThreshold', label: 'FH/BH Uncertain Threshold', min: 0.10, max: 0.45, step: 0.02 },
      { key: 'biomechLockThreshold', label: 'FH/BH Stance Lock Confidence', min: 0.30, max: 0.80, step: 0.02 }
    ]
  },
  movementAndAI: {
    title: 'Movement, T-Recovery & AI',
    fields: [
      { key: 'playerMaxSpeedMps', label: 'Max Sprint Speed (m/s)', min: 4.5, max: 9.5, step: 0.1 },
      { key: 'playerAccelerationMps2', label: 'Lunge Acceleration (m/s²)', min: 10.0, max: 30.0, step: 0.5 },
      { key: 'tRecoverySpeedScale', label: 'Auto-T Recovery Pace', min: 0.50, max: 1.15, step: 0.02 },
      { key: 'tTargetZ', label: 'T-Recovery Target Z (m)', min: 0.35, max: 1.65, step: 0.05 },
      { key: 'aiAnticipationStrength', label: 'AI Anticipation Strength', min: 0.0, max: 1.0, step: 0.05 },
      { key: 'aiReactionDelayMs', label: 'AI Disguise Split-Step Lag (ms)', min: 60, max: 380, step: 10 },
      { key: 'aiPatternMemoryLength', label: 'AI Pattern Memory (shots)', min: 2, max: 8, step: 1 },
      { key: 'aiAggression', label: 'AI Attacking Tendency', min: 0.1, max: 0.95, step: 0.05 }
    ]
  }
};

export class TuningPanel {
  constructor(engine, store = tuningStore) {
    this.engine = engine;
    this.store = store;
    this.isOpen = false;
    this.activeTab = 'ballPhysics'; // 'ballPhysics' | 'shotMechanics' | 'movementAndAI' | 'nickLab' | 'tests'
    this.lastComparisonOutput = null;
    this.lastTestReport = null;
    this.container = null;
    this._mountDOM();
    this.store.onChange(() => this._syncUIValues());
  }

  toggle(forceState) {
    this.isOpen = typeof forceState === 'boolean' ? forceState : !this.isOpen;
    if (this.container) {
      this.container.classList.toggle('hidden', !this.isOpen);
    }
    if (this.isOpen) {
      this._syncUIValues();
    }
    return this.isOpen;
  }

  _mountDOM() {
    let existing = document.getElementById('squash-tuning-lab-drawer');
    if (!existing) {
      existing = document.createElement('aside');
      existing.id = 'squash-tuning-lab-drawer';
      existing.className = 'squash-tuning-drawer hidden';
      document.body.appendChild(existing);
    }
    this.container = existing;
    this._renderFullPanel();
  }

  _renderFullPanel() {
    if (!this.container) return;
    const presetNames = Object.keys(this.store.presets);
    const presetOptionsHtml = presetNames
      .map(
        (name) =>
          `<option value="${name.replace(/"/g, '&quot;')}" ${
            name === this.store.activePresetName ? 'selected' : ''
          }>${name}</option>`
      )
      .join('');

    const compareOptionsHtml = presetNames
      .map(
        (name) =>
          `<option value="${name.replace(/"/g, '&quot;')}" ${
            name === this.store.comparePresetName ? 'selected' : ''
          }>${name}</option>`
      )
      .join('');

    this.container.innerHTML = `
      <div class="tuning-lab-header">
        <div>
          <div class="tuning-lab-kicker">BUILD • PLAY • OBSERVE • ADJUST</div>
          <h2 class="tuning-lab-title">Live Squash Tuning Lab</h2>
        </div>
        <button type="button" id="btn-close-tuning-lab" class="tuning-lab-close-btn" title="Close Lab (L)">✕</button>
      </div>

      <div class="tuning-preset-bar">
        <div class="preset-select-row">
          <label for="tuning-preset-select" class="preset-label">Active Preset</label>
          <select id="tuning-preset-select" class="tuning-select">${presetOptionsHtml}</select>
        </div>
        <div class="preset-btn-row">
          <button type="button" id="btn-preset-save" class="tuning-mini-btn">Save As…</button>
          <button type="button" id="btn-preset-dup" class="tuning-mini-btn">Duplicate</button>
          <button type="button" id="btn-preset-reset-mod" class="tuning-mini-btn">Reset Tab</button>
          <button type="button" id="btn-preset-export" class="tuning-mini-btn">Export JSON</button>
          <button type="button" id="btn-preset-import" class="tuning-mini-btn">Import JSON</button>
        </div>
      </div>

      <div class="tuning-tabs-row">
        <button type="button" class="tuning-tab-btn ${this.activeTab === 'ballPhysics' ? 'active' : ''}" data-tab="ballPhysics">Ball & Nick</button>
        <button type="button" class="tuning-tab-btn ${this.activeTab === 'shotMechanics' ? 'active' : ''}" data-tab="shotMechanics">Shot & Cut</button>
        <button type="button" class="tuning-tab-btn ${this.activeTab === 'movementAndAI' ? 'active' : ''}" data-tab="movementAndAI">Move & AI</button>
        <button type="button" class="tuning-tab-btn ${this.activeTab === 'nickLab' ? 'active' : ''}" data-tab="nickLab">Nick Lab / A-B</button>
        <button type="button" class="tuning-tab-btn ${this.activeTab === 'tests' ? 'active' : ''}" data-tab="tests">Diagnostics</button>
      </div>

      <div class="tuning-tab-body" id="tuning-tab-body">
        ${this._renderTabContent(compareOptionsHtml)}
      </div>

      <div class="tuning-telemetry-footer" id="tuning-telemetry-footer">
        <span id="telemetry-fps-readout">Sim: 120Hz Fixed</span>
        <span>·</span>
        <span id="telemetry-ball-readout">Ball: Ready</span>
        <span>·</span>
        <span id="telemetry-nick-readout">Temp COR: ${this.store.getTemperatureBounceFactor().toFixed(2)}x</span>
      </div>
    `;

    this._bindEvents();
  }

  _renderTabContent(compareOptionsHtml = '') {
    if (SLIDER_SCHEMA[this.activeTab]) {
      const schema = SLIDER_SCHEMA[this.activeTab];
      const sectionParams = this.store.params[this.activeTab] || {};
      return `
        <div class="tuning-sliders-list">
          ${schema.fields
            .map((f) => {
              const val = sectionParams[f.key] ?? 0;
              return `
                <div class="tuning-slider-item">
                  <div class="tuning-slider-top">
                    <span class="tuning-slider-label">${f.label}</span>
                    <span class="tuning-slider-val" id="val-${this.activeTab}-${f.key}">${Number(val).toFixed(
                      f.step < 0.01 ? 3 : f.step < 1 ? 2 : 0
                    )}</span>
                  </div>
                  <input
                    type="range"
                    class="tuning-range-input"
                    data-section="${this.activeTab}"
                    data-key="${f.key}"
                    min="${f.min}"
                    max="${f.max}"
                    step="${f.step}"
                    value="${val}"
                  />
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    }

    if (this.activeTab === 'nickLab') {
      return `
        <div class="nick-lab-section">
          <div class="nick-lab-card">
            <div class="nick-lab-card-title">1. Deterministic Nick Cannon (Live Viewport)</div>
            <p class="nick-lab-desc">Launch repeatable shots into the 3D court using the active physics parameters:</p>
            <div class="nick-cannon-grid">
              <button type="button" class="nick-cannon-btn highlight" data-scenario="demo_a_kill">
                <strong>Demo A: Volley Kill</strong>
                <span>105 km/h flat volley into front-left nick</span>
              </button>
              <button type="button" class="nick-cannon-btn highlight" data-scenario="demo_b_soft_drop">
                <strong>Demo B: Gentle Drop</strong>
                <span>42 km/h +36° open cut into front-left nick</span>
              </button>
              <button type="button" class="nick-cannon-btn highlight" data-scenario="off_back_wall_drive">
                <strong>Off-Back-Wall Drive Sit-Up</strong>
                <span>Bounces on floor -> pops forward &amp; up off back glass</span>
              </button>
              <button type="button" class="nick-cannon-btn" data-scenario="tight_rail">
                <strong>Tight Straight Rail</strong>
                <span>Dying length hugging the left wall</span>
              </button>
              <button type="button" class="nick-cannon-btn" data-scenario="two_wall_boast">
                <strong>Two-Wall Nick Boast</strong>
                <span>Right wall -> front wall -> left nick</span>
              </button>
              <button type="button" class="nick-cannon-btn" data-scenario="back_wall_boast">
                <strong>Back-Wall Recovery Boast</strong>
                <span>Deep rear corner -> back glass -> front wall</span>
              </button>
            </div>
          </div>

          <div class="nick-lab-card">
            <div class="nick-lab-card-title">2. A/B Preset Deterministic Comparison</div>
            <div class="preset-select-row" style="margin-bottom:8px;">
              <label class="preset-label">Compare Against</label>
              <select id="tuning-compare-select" class="tuning-select">${compareOptionsHtml}</select>
            </div>
            <button type="button" id="btn-run-ab-compare" class="tuning-action-btn">Compare Active vs Selected Preset (Seed ${this.store.params.rulesAndView.deterministicSeed})</button>
            <div id="ab-compare-results" class="ab-compare-results">
              ${this.lastComparisonOutput || '<span class="muted-note">Click above to run identical initial shots across both presets.</span>'}
            </div>
          </div>
        </div>
      `;
    }

    // Diagnostics & Invariant Test Suite Tab
    return `
      <div class="nick-lab-section">
        <div class="nick-lab-card">
          <div class="nick-lab-card-title">Automated Invariant & Physics Test Suite</div>
          <p class="nick-lab-desc">Verifies WSF court geometry, deterministic repeatability, Demo A & Demo B nick emergence, decoupled disguise, and Tin/Out rules.</p>
          <button type="button" id="btn-run-invariant-tests" class="tuning-action-btn">Run All Automated Tests</button>
          <div id="invariant-test-results" class="ab-compare-results">
            ${this._formatTestReportHTML(this.lastTestReport || TestHarness.runAll(this.engine))}
          </div>
        </div>
      </div>
    `;
  }

  _formatTestReportHTML(report) {
    if (!report) return '';
    return `
      <div class="test-summary-banner ${report.passedAll ? 'pass' : 'fail'}">
        ${report.passedAll ? '✓ ALL INVARIANTS PASSED' : '⚠ INVARIANT FAILURE'} (${report.passedCount}/${report.totalCount})
      </div>
      <div class="test-rows-list">
        ${report.results
          .map(
            (r) => `
            <div class="test-row-item">
              <span class="test-badge ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span>
              <div class="test-row-meta">
                <strong>${r.id}: ${r.name}</strong>
                <span>${r.detail}</span>
              </div>
            </div>
          `
          )
          .join('')}
      </div>
    `;
  }

  _bindEvents() {
    const closeBtn = this.container.querySelector('#btn-close-tuning-lab');
    closeBtn?.addEventListener('click', () => this.toggle(false));

    const presetSelect = this.container.querySelector('#tuning-preset-select');
    presetSelect?.addEventListener('change', (e) => {
      this.store.selectPreset(e.target.value);
      this._renderFullPanel();
    });

    this.container.querySelector('#btn-preset-save')?.addEventListener('click', () => {
      const name = window.prompt('Save current tuning preset as:', `${this.store.activePresetName} Custom`);
      if (name) {
        this.store.savePresetAs(name);
        this._renderFullPanel();
      }
    });

    this.container.querySelector('#btn-preset-dup')?.addEventListener('click', () => {
      this.store.duplicateActivePreset();
      this._renderFullPanel();
    });

    this.container.querySelector('#btn-preset-reset-mod')?.addEventListener('click', () => {
      if (SLIDER_SCHEMA[this.activeTab]) {
        this.store.resetModule(this.activeTab);
      } else {
        this.store.resetAll();
      }
      this._renderFullPanel();
    });

    this.container.querySelector('#btn-preset-export')?.addEventListener('click', () => {
      const json = this.store.exportJSON();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).catch(() => {});
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `argon-squash-preset-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    this.container.querySelector('#btn-preset-import')?.addEventListener('click', () => {
      const raw = window.prompt('Paste Argon Squash Preset JSON:');
      if (raw) {
        try {
          this.store.importJSON(raw);
          this._renderFullPanel();
        } catch (err) {
          console.warn('Invalid JSON preset:', err);
        }
      }
    });

    this.container.querySelectorAll('.tuning-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this._renderFullPanel();
      });
    });

    this.container.querySelectorAll('.tuning-range-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const section = e.target.dataset.section;
        const key = e.target.dataset.key;
        const val = parseFloat(e.target.value);
        this.store.setParam(section, key, val);
        const readout = this.container.querySelector(`#val-${section}-${key}`);
        if (readout) {
          const step = parseFloat(e.target.step || '0.1');
          readout.textContent = val.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);
        }
      });
    });

    // Nick Cannon Buttons
    this.container.querySelectorAll('.nick-cannon-btn[data-scenario]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scenarioId = btn.dataset.scenario;
        this.engine?.launchNickLabScenario?.(scenarioId);
      });
    });

    this.container.querySelector('#btn-replay-wonder-intro')?.addEventListener('click', () => {
      this.engine?.startWonderIntro?.('DEMO_A_FEED');
    });

    const compareSelect = this.container.querySelector('#tuning-compare-select');
    compareSelect?.addEventListener('change', (e) => {
      this.store.comparePresetName = e.target.value;
    });

    this.container.querySelector('#btn-run-ab-compare')?.addEventListener('click', () => {
      this._runABComparison();
    });

    this.container.querySelector('#btn-run-invariant-tests')?.addEventListener('click', () => {
      this.lastTestReport = TestHarness.runAll(this.engine);
      const box = this.container.querySelector('#invariant-test-results');
      if (box) box.innerHTML = this._formatTestReportHTML(this.lastTestReport);
    });
  }

  _runABComparison() {
    const presetA = this.store.params;
    const presetB = this.store.presets[this.store.comparePresetName] || presetA;
    const scenarios = ['demo_a_kill', 'demo_b_soft_drop', 'tight_rail'];

    const rows = scenarios.map((id) => {
      const sc = NickCollisionModel.getNickLabScenario(id);
      const simA = BallPhysics.simulateTrajectory(sc, presetA, this.store);
      const simB = BallPhysics.simulateTrajectory(sc, presetB, this.store);
      return `
        <div class="ab-row">
          <div class="ab-row-title">${sc.title}</div>
          <div class="ab-cols">
            <div>
              <em>Active (${this.store.activePresetName.slice(0, 18)})</em><br/>
              Nick: <strong>${simA.nickTriggered ? 'YES' : 'NO'}</strong> · Max Bounce: <strong>${(simA.maxBounceHeightAfterFirst * 100).toFixed(1)}cm</strong>
            </div>
            <div>
              <em>Compare (${this.store.comparePresetName.slice(0, 18)})</em><br/>
              Nick: <strong>${simB.nickTriggered ? 'YES' : 'NO'}</strong> · Max Bounce: <strong>${(simB.maxBounceHeightAfterFirst * 100).toFixed(1)}cm</strong>
            </div>
          </div>
        </div>
      `;
    });

    this.lastComparisonOutput = rows.join('');
    const box = this.container.querySelector('#ab-compare-results');
    if (box) box.innerHTML = this.lastComparisonOutput;
  }

  _syncUIValues() {
    if (!this.isOpen || !this.container) return;
    const nickReadout = this.container.querySelector('#telemetry-nick-readout');
    if (nickReadout) {
      nickReadout.textContent = `Temp COR: ${this.store.getTemperatureBounceFactor().toFixed(2)}x`;
    }
  }

  updateLiveTelemetry({ fps = 60, ballSpeedKmh = 0, lastSurface = 'Ready' } = {}) {
    if (!this.isOpen || !this.container) return;
    const fpsEl = this.container.querySelector('#telemetry-fps-readout');
    const ballEl = this.container.querySelector('#telemetry-ball-readout');
    if (fpsEl) fpsEl.textContent = `Render: ${Math.round(fps)} FPS (120Hz Physics)`;
    if (ballEl) ballEl.textContent = `Ball: ${ballSpeedKmh} km/h (${lastSurface})`;
  }
}

export default TuningPanel;
