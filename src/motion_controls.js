// ============================================================================
// ARGON SQUASH — MOTION, POSE ESTIMATION (FRONT/BACK CAM), KEYBOARD & MOUSE CONTROLLER
// Supports:
//   1. Keyboard & Mouse Hold-to-Prepare (Spacebar / Left-Click) + Release Execution
//   2. Direct Shot Hotkeys (1: Drive, 2: Cut Drop, 3/B: Boast, 4: Lob, 5: Volley Kill)
//   3. Webcam Pose Estimation + Optical Flow (Front Cam & Back Cam for Big Screen TV):
//      - Full-body lateral/depth T-Position lunges (`poseLungeOffset`)
//      - Player-relative temporal Forehand/Backhand classification (`BiomechStrokeClassifier`)
//      - Decoupled stroke identity vs shot mechanics (Drive, Cut Drop, Lob, Boast, Kill)
//   4. Companion Phone Pocket Racket IMU polling
// ============================================================================

import { BiomechStrokeClassifier, STROKE_SIDES } from './squash/BiomechStrokeClassifier.js';

export class MotionController {
  constructor(options = {}) {
    this.onSwing = typeof options.onSwing === 'function' ? options.onSwing : null;
    this.onToss = typeof options.onToss === 'function' ? options.onToss : null;
    this.onPrepStart = typeof options.onPrepStart === 'function' ? options.onPrepStart : null;
    this.onPrepEnd = typeof options.onPrepEnd === 'function' ? options.onPrepEnd : null;
    this.onP2Swing = typeof options.onP2Swing === 'function' ? options.onP2Swing : null;
    this.onP2Toss = typeof options.onP2Toss === 'function' ? options.onP2Toss : null;
    this.onRoomState = typeof options.onRoomState === 'function' ? options.onRoomState : null;
    this.onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : null;
    this.onOrientation = typeof options.onOrientation === 'function' ? options.onOrientation : null;

    this.roomId = (options.roomId || 'default').trim().toLowerCase() || 'default';
    this.role = (options.role || 'p1').toLowerCase() === 'p2' ? 'p2' : 'p1';
    this.webcamCanvasId = options.webcamCanvasId || 'webcam-canvas';
    this.webcamCanvas = options.webcamCanvas || null;
    this.webcamCtx = null;

    this.flowWidth = 64;
    this.flowHeight = 48;
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = this.flowWidth;
    this.offscreenCanvas.height = this.flowHeight;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    this.prevLuma = new Float32Array(this.flowWidth * this.flowHeight);
    this.motionEnergyMap = new Float32Array(this.flowWidth * this.flowHeight);
    this.hasPrevFrame = false;

    this.videoElem = null;
    this.webcamStream = null;
    this.webcamActive = false;
    this.cameraFacingMode = 'user'; // 'user' (Front Cam) | 'environment' (Back Cam for Big Screen)
    this.kinectSplitMode = false;   // true = 2-Player Kinect Split-Zone (Left = P1, Right = P2)
    this.handedness = options.handedness === 'left' ? 'left' : 'right';
    this.strokeClassifier = new BiomechStrokeClassifier({
      handedness: this.handedness,
      facingMode: this.cameraFacingMode
    });
    this.p2StrokeClassifier = new BiomechStrokeClassifier({
      handedness: 'right',
      facingMode: this.cameraFacingMode
    });
    this.latestPoseLandmarks = null;
    this.latestPoseSeenAt = 0;

    this.smoothedCentroid = { x: 0.5, y: 0.5 };
    this.smoothedP2Centroid = { x: 0.75, y: 0.52 };
    this.smoothedBodyCenter = { x: 0.5, y: 0.55 };
    this.poseLungeOffset = { x: 0, z: 0, active: false };
    this.motionVector = { vx: 0, vy: 0, mag: 0 };
    this.p2MotionVector = { vx: 0, vy: 0, mag: 0 };
    this.lastWebcamTriggerMs = 0;
    this.lastP2WebcamTriggerMs = 0;

    this.phonePollIntervalMs = options.phonePollIntervalMs || 50;
    this.phonePollTimer = null;
    this.phoneState = {
      connected: false,
      p2Connected: false,
      lastSeenMs: -1,
      orientation: { pitch: 0, roll: 0, yaw: 0, accelMag: 0, buttonB: false },
      lastSwing: null
    };
    this.p2PhoneState = {
      connected: false,
      lastSeenMs: -1,
      orientation: { pitch: 0, roll: 0, yaw: 0, accelMag: 0, buttonB: false },
      lastSwing: null
    };
    this.lastProcessedPhoneSeq = 0;
    this.phonePollInitialized = false;
    this.lastProcessedP2PhoneSeq = 0;
    this.p2PhonePollInitialized = false;

    this.aimBiasX = 0;
    this.selectedShotType = 'topspin';
    this.cutModifierActive = false;
    this.prepHoldStartMs = 0;
    this.keysDown = new Set();
    this.pointerDrag = null;
    this.mouseTrail = [];

    this.lastVisualSwing = {
      timestamp: 0,
      dirX: 0,
      dirY: -0.5,
      speed: 0,
      shotType: 'topspin',
      source: 'ready'
    };

    this._listeners = { swing: [], toss: [], status: [], orientation: [] };
    this._rafId = null;
    this._disposed = false;

    this._initDOMBindings();
    this.startPhonePolling();
    this._startHudRenderLoop();
  }

  setRoomConfig({ roomId, role } = {}) {
    if (roomId) {
      this.roomId = String(roomId).trim().toLowerCase() || 'default';
      this.phonePollInitialized = false;
      this.p2PhonePollInitialized = false;
      this.lastProcessedPhoneSeq = 0;
      this.lastProcessedP2PhoneSeq = 0;
    }
    if (role) {
      this.role = String(role).toLowerCase() === 'p2' ? 'p2' : 'p1';
    }
  }

  on(event, fn) {
    if (this._listeners[event] && typeof fn === 'function') {
      this._listeners[event].push(fn);
    }
    return () => {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter((cb) => cb !== fn);
      }
    };
  }

  setShotType(shotType) {
    if (['topspin', 'slice', 'lob', 'smash', 'flat', 'boast', 'drop'].includes(shotType)) {
      this.selectedShotType = shotType;
      this._updateHudShotPills(shotType);
    }
  }

  setHandedness(handedness = 'right') {
    const clean = String(handedness).toLowerCase() === 'left' ? 'left' : 'right';
    this.handedness = clean;
    if (this.strokeClassifier) {
      this.strokeClassifier.setConfig({ handedness: clean });
    }
    this._updateHandednessUI();
    return this.handedness;
  }

  toggleHandedness() {
    return this.setHandedness(this.handedness === 'right' ? 'left' : 'right');
  }

  async switchCameraFacingMode() {
    // Cycle: 1P Front Cam -> 2P Kinect Split (Front/TV) -> 2P Kinect Split (Back/TV) -> 1P Back Cam
    const prevFacing = this.cameraFacingMode;
    if (this.cameraFacingMode === 'user' && !this.kinectSplitMode) {
      this.kinectSplitMode = true;
    } else if (this.cameraFacingMode === 'user' && this.kinectSplitMode) {
      this.cameraFacingMode = 'environment';
      this.kinectSplitMode = true;
    } else if (this.cameraFacingMode === 'environment' && this.kinectSplitMode) {
      this.kinectSplitMode = false;
    } else {
      this.cameraFacingMode = 'user';
      this.kinectSplitMode = false;
    }
    if (this.strokeClassifier) {
      this.strokeClassifier.setConfig({ facingMode: this.cameraFacingMode });
    }
    if (this.p2StrokeClassifier) {
      this.p2StrokeClassifier.setConfig({ facingMode: this.cameraFacingMode });
    }
    this._updateCameraFacingUI();
    if (this.webcamActive && prevFacing !== this.cameraFacingMode) {
      this.disableWebcam();
      await this.enableWebcam(this.cameraFacingMode);
    }
    return this.cameraFacingMode;
  }

  _resolveSwingSide(explicitSide, dirX = 0) {
    if (
      explicitSide === 'backhand' ||
      explicitSide === 'forehand' ||
      explicitSide === 'overhead' ||
      explicitSide === 'uncertain'
    ) {
      return explicitSide;
    }
    const domSign = this.handedness === 'left' ? -1 : 1;
    if (dirX * domSign > 0.14) return 'backhand';
    if (dirX * domSign < -0.14) return 'forehand';
    return null;
  }

  _inferShotTypeFromKinematics({
    shotType,
    dirY = -0.4,
    pitch = 0,
    roll = 0,
    speed = 1.1,
    cutModifier = false
  } = {}) {
    if (cutModifier) return 'drop';
    if (
      shotType &&
      ['topspin', 'slice', 'lob', 'smash', 'flat', 'boast', 'drop', 'back_wall_boast'].includes(
        shotType
      )
    ) {
      return shotType;
    }
    if ((dirY > 0.35 && speed > 1.22) || speed >= 1.46 || (pitch < -18 && speed >= 1.25)) {
      return 'smash';
    }
    if (dirY > 0.14 || (Math.abs(roll) > 26 && dirY > -0.15)) {
      return 'slice';
    }
    if (dirY < -0.65 || pitch > 26) {
      return 'lob';
    }
    return 'topspin';
  }

  _emitSwing(evt = {}) {
    const now = performance.now();
    const speed = Math.max(0.5, Math.min(2.0, Number(evt.speed ?? 1.1)));
    const dirX = Math.max(-1, Math.min(1, Number(evt.dirX ?? evt.angleX ?? this.aimBiasX ?? 0)));
    const dirY = Math.max(-1, Math.min(1, Number(evt.dirY ?? -0.4)));
    const pitch = Number(evt.pitch ?? this.phoneState.orientation.pitch ?? 0);
    const roll = Number(evt.roll ?? this.phoneState.orientation.roll ?? 0);
    const cutModifier = Boolean(
      evt.cutModifier ||
        this.cutModifierActive ||
        this.keysDown.has('ShiftLeft') ||
        this.keysDown.has('ShiftRight')
    );
    const side = this._resolveSwingSide(evt.side, dirX);
    const shotType = this._inferShotTypeFromKinematics({
      shotType: evt.shotType,
      dirY,
      pitch,
      roll,
      speed,
      cutModifier
    });

    const payload = {
      type: 'swing',
      role: evt.role || this.role,
      source: evt.source || 'manual',
      side,
      confidence: typeof evt.confidence === 'number' ? evt.confidence : 1.0,
      biomechClassification: evt.biomechClassification || null,
      shotType,
      cutModifier,
      prepHoldMs: Number(evt.prepHoldMs || 0),
      speed,
      dirX,
      dirY,
      angleX: dirX,
      pitch,
      roll,
      timing: evt.timing || null,
      timestamp: evt.timestamp || Date.now()
    };

    this.lastVisualSwing = {
      timestamp: now,
      side,
      confidence: payload.confidence,
      dirX,
      dirY,
      speed,
      shotType,
      source: payload.source
    };

    if (this.role === 'p2' && evt.role !== 'p1') {
      if (payload.source !== 'phone' && !evt._fromPoll) {
        fetch(`/api/racket/swing?room=${encodeURIComponent(this.roomId)}&role=p2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room: this.roomId,
            role: 'p2',
            type: 'swing',
            side,
            shotType,
            speed,
            angleX: dirX,
            dirX,
            dirY,
            pitch,
            roll,
            source: payload.source
          })
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((r) => {
            if (r && r.swing && typeof r.swing.seq === 'number') {
              this.p2PhonePollInitialized = true;
              this.lastProcessedP2PhoneSeq = Math.max(this.lastProcessedP2PhoneSeq, r.swing.seq);
            }
          })
          .catch(() => {});
      }
      return this._emitP2Swing(payload);
    }

    if (typeof this.onSwing === 'function') this.onSwing(payload);
    for (const cb of this._listeners.swing) {
      try {
        cb(payload);
      } catch (err) {
        console.error(err);
      }
    }
    return payload;
  }

  _emitToss(evt = {}) {
    const now = performance.now();
    const dirX = Number(evt.dirX ?? evt.angleX ?? 0);
    const dirY = Number(evt.dirY ?? -0.9);
    const side = this._resolveSwingSide(evt.side, dirX);
    const shotType = evt.shotType || 'lob';
    const pitch = Number(evt.pitch ?? this.phoneState.orientation.pitch ?? 0);
    const roll = Number(evt.roll ?? this.phoneState.orientation.roll ?? 0);

    const payload = {
      type: 'toss',
      role: evt.role || this.role,
      source: evt.source || 'manual',
      side,
      shotType,
      speed: Number(evt.speed ?? 1.0),
      dirX,
      dirY,
      angleX: dirX,
      pitch,
      roll,
      timestamp: evt.timestamp || Date.now()
    };

    this.lastVisualSwing = {
      timestamp: now,
      side,
      dirX,
      dirY: -0.95,
      speed: 1.1,
      shotType: 'toss',
      source: payload.source
    };

    if (this.role === 'p2' && evt.role !== 'p1') {
      if (payload.source !== 'phone' && !evt._fromPoll) {
        fetch(`/api/racket/swing?room=${encodeURIComponent(this.roomId)}&role=p2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room: this.roomId,
            role: 'p2',
            type: 'toss',
            side: payload.side,
            shotType: payload.shotType,
            speed: payload.speed,
            angleX: payload.dirX,
            dirX: payload.dirX,
            dirY: payload.dirY,
            pitch: payload.pitch,
            roll: payload.roll,
            source: payload.source
          })
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((r) => {
            if (r && r.swing && typeof r.swing.seq === 'number') {
              this.p2PhonePollInitialized = true;
              this.lastProcessedP2PhoneSeq = Math.max(this.lastProcessedP2PhoneSeq, r.swing.seq);
            }
          })
          .catch(() => {});
      }
      return this._emitP2Toss(payload);
    }

    let handled = false;
    if (typeof this.onToss === 'function') {
      handled = this.onToss(payload) !== false;
    }
    for (const cb of this._listeners.toss) {
      try {
        if (cb(payload) !== false) handled = true;
      } catch (err) {
        console.error(err);
      }
    }
    if (!handled && typeof this.onSwing === 'function') {
      this.onSwing(payload);
    }
    return payload;
  }

  _emitP2Swing(evt = {}) {
    const speed = Math.max(0.5, Math.min(2.0, Number(evt.speed ?? 1.15)));
    const dirX = Math.max(-1, Math.min(1, Number(evt.dirX ?? evt.angleX ?? 0)));
    const dirY = Math.max(-1, Math.min(1, Number(evt.dirY ?? -0.45)));
    const pitch = Number(evt.pitch ?? 0);
    const roll = Number(evt.roll ?? 0);
    const side = this._resolveSwingSide(evt.side, dirX);
    const shotType = this._inferShotTypeFromKinematics({
      shotType: evt.shotType,
      dirY,
      pitch,
      roll,
      speed
    });
    const payload = {
      type: 'swing',
      role: 'p2',
      source: evt.source || 'phone',
      side,
      shotType,
      speed,
      dirX,
      dirY,
      angleX: dirX,
      pitch,
      roll,
      timestamp: evt.timestamp || Date.now()
    };
    if (typeof this.onP2Swing === 'function') this.onP2Swing(payload);
    return payload;
  }

  _emitP2Toss(evt = {}) {
    const dirX = Number(evt.dirX ?? evt.angleX ?? 0);
    const dirY = Number(evt.dirY ?? -0.9);
    const side = this._resolveSwingSide(evt.side, dirX);
    const payload = {
      type: 'toss',
      role: 'p2',
      source: evt.source || 'phone',
      side,
      shotType: evt.shotType || 'lob',
      speed: Number(evt.speed ?? 1.1),
      dirX,
      dirY,
      angleX: dirX,
      pitch: Number(evt.pitch ?? 0),
      roll: Number(evt.roll ?? 0),
      timestamp: evt.timestamp || Date.now()
    };
    let handled = false;
    if (typeof this.onP2Toss === 'function') {
      handled = this.onP2Toss(payload) !== false;
    }
    if (!handled && typeof this.onP2Swing === 'function') {
      this.onP2Swing(payload);
    }
    return payload;
  }

  triggerSyntheticSwing(evt = {}) {
    if ((evt.type || 'swing') === 'toss') {
      return this._emitToss({
        source: evt.source || 'synthetic',
        side: evt.side || null,
        shotType: evt.shotType || 'lob',
        speed: evt.speed ?? 1.05,
        dirX: evt.dirX ?? evt.angleX ?? 0,
        dirY: evt.dirY ?? -0.9
      });
    }
    return this._emitSwing({
      source: evt.source || 'synthetic',
      side: evt.side || null,
      shotType: evt.shotType,
      speed: evt.speed ?? (evt.shotType === 'smash' ? 1.48 : 1.18),
      dirX: evt.dirX ?? evt.angleX ?? this.aimBiasX ?? 0,
      dirY: evt.dirY ?? -0.45,
      pitch: evt.pitch,
      roll: evt.roll,
      timing: evt.timing || null
    });
  }

  async _ensureMediaPipeHands() {
    if (this.mpHands || this._mpLoading) return;
    this._mpLoading = true;
    const loadScript = (url) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
          resolve();
          return;
        }
        const s = document.createElement('script');
        s.src = url;
        s.crossOrigin = 'anonymous';
        s.onload = () => resolve();
        s.onerror = (err) => reject(err);
        document.head.appendChild(s);
      });

    try {
      if (!window.Hands) {
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');
      }
      if (window.Hands) {
        const hands = new window.Hands({
          locateFile: (file) =>
            file.endsWith('.js')
              ? `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
              : `/assets/mediapipe/hands/${file}`
        });
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.4,
          minTrackingConfidence: 0.4
        });
        hands.onResults((results) => {
          this._mpBusy = false;
          if (results && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            this.latestMultiHandLandmarks = results.multiHandLandmarks;
            this.latestHandLandmarks = results.multiHandLandmarks[0];
            this.latestHandSeenAt = performance.now();
            this._hasNewHandResult = true;
          } else {
            this.latestMultiHandLandmarks = null;
            this.latestHandLandmarks = null;
          }
        });
        await hands.initialize();
        this.mpHands = hands;
      }
      if (window.Pose && !this.mpPose) {
        const pose = new window.Pose({
          locateFile: (file) =>
            file.endsWith('.js')
              ? `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
              : `/assets/mediapipe/pose/${file}`
        });
        pose.setOptions({
          modelComplexity: 0,
          smoothLandmarks: true,
          minDetectionConfidence: 0.45,
          minTrackingConfidence: 0.45
        });
        pose.onResults((results) => {
          this._mpPoseBusy = false;
          if (results && results.poseLandmarks) {
            this.latestPoseLandmarks = results.poseLandmarks;
            this.latestPoseSeenAt = performance.now();
          }
        });
        this.mpPose = pose;
      }
    } catch (err) {
      console.warn('[MotionController] MediaPipe Hands CDN fallback to Optical Flow:', err);
    } finally {
      this._mpLoading = false;
    }
  }

  async enableWebcam(facingModeOverride = null) {
    if (facingModeOverride === 'user' || facingModeOverride === 'environment') {
      this.cameraFacingMode = facingModeOverride;
      if (this.strokeClassifier) {
        this.strokeClassifier.setConfig({ facingMode: this.cameraFacingMode });
      }
      if (this.p2StrokeClassifier) {
        this.p2StrokeClassifier.setConfig({ facingMode: this.cameraFacingMode });
      }
    }
    if (this.webcamActive) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._notifyStatus({ webcam: false, error: 'Camera API unavailable in this browser' });
      return false;
    }
    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: { ideal: this.cameraFacingMode }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.webcamStream = stream;

      const domVideo = document.getElementById('webcam-video');
      this.videoElem = domVideo || this.videoElem || document.createElement('video');
      this.videoElem.playsInline = true;
      this.videoElem.muted = true;
      this.videoElem.srcObject = stream;
      await this.videoElem.play();

      this.webcamActive = true;
      this.hasPrevFrame = false;
      this.latestHandLandmarks = null;
      this.latestPoseLandmarks = null;
      this.strokeClassifier.reset();
      this.p2StrokeClassifier.reset();
      this._mpBusy = false;
      this._ensureMediaPipeHands();
      this._notifyStatus({
        webcam: true,
        facingMode: this.cameraFacingMode,
        phone: this.phoneState.connected
      });
      this._updateWebcamBadgeUI(true);
      this._updateCameraFacingUI();
      this._updateHandednessUI();
      return true;
    } catch (err) {
      console.warn('[MotionController] Webcam access denied or unavailable:', err);
      this.webcamActive = false;
      this._notifyStatus({ webcam: false, error: err.message || 'Camera permission denied' });
      this._updateWebcamBadgeUI(false);
      return false;
    }
  }

  disableWebcam() {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((t) => t.stop());
      this.webcamStream = null;
    }
    if (this.videoElem) {
      this.videoElem.srcObject = null;
    }
    this.webcamActive = false;
    this.hasPrevFrame = false;
    this.latestHandLandmarks = null;
    this.latestPoseLandmarks = null;
    this.poseLungeOffset = { x: 0, z: 0, active: false };
    this._notifyStatus({ webcam: false, phone: this.phoneState.connected });
    this._updateWebcamBadgeUI(false);
  }

  async toggleWebcam() {
    return this.webcamActive ? (this.disableWebcam(), false) : this.enableWebcam();
  }

  _processWebcamFrame() {
    if (!this.webcamActive || !this.videoElem || this.videoElem.readyState < 2) return;
    const now = performance.now();
    const isNewVideoFrame = this.videoElem.currentTime !== this._lastVideoTime;
    const isFrontCam = this.cameraFacingMode === 'user';

    if (isNewVideoFrame) {
      this._lastVideoTime = this.videoElem.currentTime;
      if (this.mpHands && !this._mpBusy) {
        this._mpBusy = true;
        this.mpHands.send({ image: this.videoElem }).catch(() => {
          this._mpBusy = false;
        });
      }
      if (this.mpPose && !this._mpPoseBusy) {
        this._mpPoseBusy = true;
        this.mpPose.send({ image: this.videoElem }).catch(() => {
          this._mpPoseBusy = false;
        });
      }
    }

    const activePose =
      this.latestPoseLandmarks && now - (this.latestPoseSeenAt || 0) < 350
        ? this.latestPoseLandmarks
        : null;

    // 1. MediaPipe Hand / Forearm Landmark Tracking (if hand detected)
    if (this.latestHandLandmarks && now - (this.latestHandSeenAt || 0) < 240) {
      if (!this._hasNewHandResult) return;
      this._hasNewHandResult = false;
      const lm = this.latestHandLandmarks;
      const wrist = lm[0];
      const midMcp = lm[9];
      const rawX = wrist.x * 0.45 + midMcp.x * 0.55;
      // Display-space coordinate for HUD reticle
      const normX = isFrontCam ? 1 - rawX : rawX;
      const normY = wrist.y * 0.45 + midMcp.y * 0.55;

      this.smoothedCentroid.x = normX;
      this.smoothedCentroid.y = normY;

      // Feed raw sensor landmarks into BiomechStrokeClassifier for player-relative anatomical ingestion
      this.strokeClassifier.ingestFrame({
        timestamp: now,
        handLandmarks: lm,
        poseLandmarks: activePose,
        bodyCenter: { x: this.smoothedBodyCenter.x, y: this.smoothedBodyCenter.y },
        coordSpace: 'raw_sensor',
        facingMode: this.cameraFacingMode,
        cameraPlacement: 'facing_player'
      });

      // Update T-position lunge offset from torso/stance lateral & depth shift
      const lungeDx = (this.strokeClassifier.torsoState.centerX || normX) - 0.5;
      const lungeDz = (this.strokeClassifier.torsoState.centerY || normY) - 0.52;
      this.poseLungeOffset = {
        active: Math.hypot(lungeDx, lungeDz) > 0.14,
        x: lungeDx * 1.65,
        z: lungeDz * 1.35
      };

      if (!this._webcamTrail || this._lastWebcamSource !== 'mediapipe') {
        this._webcamTrail = [];
      }
      this._lastWebcamSource = 'mediapipe';
      this._webcamTrail.push({ x: normX, y: normY, t: now });
      while (
        this._webcamTrail.length > 6 ||
        (this._webcamTrail.length > 2 && now - this._webcamTrail[0].t > 200)
      ) {
        this._webcamTrail.shift();
      }
      this._evaluateHandTrail(now, true);
      return;
    }

    if (!isNewVideoFrame) return;

    // 2. Optical Flow Full-Body Lunge + Arm Swing Tracking
    const w = this.flowWidth;
    const h = this.flowHeight;
    const ctx = this.offscreenCtx;
    ctx.save();
    if (isFrontCam) {
      ctx.scale(-1, 1);
      ctx.drawImage(this.videoElem, -w, 0, w, h);
    } else {
      ctx.drawImage(this.videoElem, 0, 0, w, h);
    }
    ctx.restore();

    const data = ctx.getImageData(0, 0, w, h).data;
    let totalEnergy = 0;
    let bodyMassSum = 0;
    let bodyMomentX = 0;
    let bodyMomentY = 0;

    const cols = 8;
    const rows = 6;
    const cellW = w / cols;
    const cellH = h / rows;
    const gridE = new Float32Array(cols * rows);
    const gridX = new Float32Array(cols * rows);
    const gridY = new Float32Array(cols * rows);

    for (let y = 0; y < h; y++) {
      const rIdx = Math.min(rows - 1, Math.floor(y / cellH));
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        const luma = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) / 255;
        if (this.hasPrevFrame) {
          const diff = Math.abs(luma - this.prevLuma[idx]);
          const eVal = diff > 0.11 ? diff : 0;
          this.motionEnergyMap[idx] = this.motionEnergyMap[idx] * 0.45 + eVal * 0.55;
          if (eVal > 0.13) {
            totalEnergy += eVal;
            const cIdx = Math.min(cols - 1, Math.floor(x / cellW));
            const cell = rIdx * cols + cIdx;
            gridE[cell] += eVal;
            gridX[cell] += (x / w) * eVal;
            gridY[cell] += (y / h) * eVal;
          }
          if (this.motionEnergyMap[idx] > 0.06) {
            bodyMassSum += this.motionEnergyMap[idx];
            bodyMomentX += (x / w) * this.motionEnergyMap[idx];
            bodyMomentY += (y / h) * this.motionEnergyMap[idx];
          }
        }
        this.prevLuma[idx] = luma;
      }
    }

    if (!this.hasPrevFrame) {
      this.hasPrevFrame = true;
      this._webcamTrail = [];
      return;
    }

    if (bodyMassSum > 1.2) {
      const bx = bodyMomentX / bodyMassSum;
      const by = bodyMomentY / bodyMassSum;
      this.smoothedBodyCenter.x = this.smoothedBodyCenter.x * 0.8 + bx * 0.2;
      this.smoothedBodyCenter.y = this.smoothedBodyCenter.y * 0.8 + by * 0.2;
      const dx = this.smoothedBodyCenter.x - 0.5;
      const dz = this.smoothedBodyCenter.y - 0.52;
      this.poseLungeOffset = {
        active: Math.hypot(dx, dz) > 0.12,
        x: dx * 1.75,
        z: dz * 1.4
      };
    }

    if (!this.kinectSplitMode) {
      let bestClusterE = 0;
      let bestClusterX = 0;
      let bestClusterY = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let ce = 0;
          let cx = 0;
          let cy = 0;
          for (let dr = -1; dr <= 1; dr++) {
            const nr = r + dr;
            if (nr < 0 || nr >= rows) continue;
            for (let dc = -1; dc <= 1; dc++) {
              const nc = c + dc;
              if (nc < 0 || nc >= cols) continue;
              const cell = nr * cols + nc;
              ce += gridE[cell];
              cx += gridX[cell];
              cy += gridY[cell];
            }
          }
          if (ce > bestClusterE) {
            bestClusterE = ce;
            bestClusterX = cx;
            bestClusterY = cy;
          }
        }
      }

      const concentration = totalEnergy > 0.001 ? bestClusterE / totalEnergy : 0;
      if (bestClusterE > 2.6 && concentration >= 0.40) {
        const cx = bestClusterX / bestClusterE;
        const cy = bestClusterY / bestClusterE;
        this.smoothedCentroid.x = this.smoothedCentroid.x * 0.35 + cx * 0.65;
        this.smoothedCentroid.y = this.smoothedCentroid.y * 0.35 + cy * 0.65;

        // Ingest optical-flow frame into BiomechStrokeClassifier
        this.strokeClassifier.ingestFrame({
          timestamp: now,
          handPoint: { x: this.smoothedCentroid.x, y: this.smoothedCentroid.y, visibility: Math.min(1, concentration * 1.35) },
          poseLandmarks: activePose,
          bodyCenter: { x: this.smoothedBodyCenter.x, y: this.smoothedBodyCenter.y },
          coordSpace: 'display_mirrored',
          facingMode: this.cameraFacingMode,
          cameraPlacement: 'facing_player'
        });

        if (!this._webcamTrail || this._lastWebcamSource !== 'flow') {
          this._webcamTrail = [];
        }
        this._lastWebcamSource = 'flow';
        this._webcamTrail.push({
          x: this.smoothedCentroid.x,
          y: this.smoothedCentroid.y,
          t: now
        });
        while (
          this._webcamTrail.length > 6 ||
          (this._webcamTrail.length > 2 && now - this._webcamTrail[0].t > 200)
        ) {
          this._webcamTrail.shift();
        }
        this._evaluateHandTrail(now, false);
      } else {
        this.motionVector.vx *= 0.72;
        this.motionVector.vy *= 0.72;
        this.motionVector.mag *= 0.72;
        if (
          this._webcamTrail &&
          this._webcamTrail.length > 0 &&
          now - this._webcamTrail[this._webcamTrail.length - 1].t > 150
        ) {
          this._webcamTrail = [];
        }
      }
      return;
    }

    // --- 2-PLAYER KINECT SPLIT-ZONE TRACKING (Left Half c=0..3 = P1, Right Half c=4..7 = P2) ---
    let p1BestE = 0, p1BestX = 0, p1BestY = 0;
    let p2BestE = 0, p2BestX = 0, p2BestY = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let ce = 0, cx = 0, cy = 0;
        const isP2Zone = c >= 4;
        const minC = isP2Zone ? 4 : 0;
        const maxC = isP2Zone ? 7 : 3;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const nc = c + dc;
            if (nc < minC || nc > maxC) continue;
            const cell = nr * cols + nc;
            ce += gridE[cell];
            cx += gridX[cell];
            cy += gridY[cell];
          }
        }
        if (!isP2Zone && ce > p1BestE) {
          p1BestE = ce;
          p1BestX = cx;
          p1BestY = cy;
        } else if (isP2Zone && ce > p2BestE) {
          p2BestE = ce;
          p2BestX = cx;
          p2BestY = cy;
        }
      }
    }

    if (p1BestE > 2.2) {
      const cx = p1BestX / p1BestE;
      const cy = p1BestY / p1BestE;
      this.smoothedCentroid.x = this.smoothedCentroid.x * 0.35 + cx * 0.65;
      this.smoothedCentroid.y = this.smoothedCentroid.y * 0.35 + cy * 0.65;
      this.strokeClassifier.ingestFrame({
        timestamp: now,
        handPoint: { x: this.smoothedCentroid.x, y: this.smoothedCentroid.y, visibility: 0.9 },
        bodyCenter: { x: 0.25, y: 0.52 },
        coordSpace: 'display_mirrored',
        facingMode: this.cameraFacingMode,
        cameraPlacement: 'facing_player'
      });
      if (!this._webcamTrail || this._lastWebcamSource !== 'flow_split') {
        this._webcamTrail = [];
      }
      this._lastWebcamSource = 'flow_split';
      this._webcamTrail.push({ x: this.smoothedCentroid.x, y: this.smoothedCentroid.y, t: now });
      while (this._webcamTrail.length > 6 || (this._webcamTrail.length > 2 && now - this._webcamTrail[0].t > 200)) {
        this._webcamTrail.shift();
      }
      this._evaluateHandTrail(now, false);
    } else {
      this.motionVector.vx *= 0.72;
      this.motionVector.vy *= 0.72;
      this.motionVector.mag *= 0.72;
    }

    if (p2BestE > 2.2) {
      const cx = p2BestX / p2BestE;
      const cy = p2BestY / p2BestE;
      this.smoothedP2Centroid.x = this.smoothedP2Centroid.x * 0.35 + cx * 0.65;
      this.smoothedP2Centroid.y = this.smoothedP2Centroid.y * 0.35 + cy * 0.65;
      this.p2StrokeClassifier.ingestFrame({
        timestamp: now,
        handPoint: { x: this.smoothedP2Centroid.x, y: this.smoothedP2Centroid.y, visibility: 0.9 },
        bodyCenter: { x: 0.75, y: 0.52 },
        coordSpace: 'display_mirrored',
        facingMode: this.cameraFacingMode,
        cameraPlacement: 'facing_player'
      });
      if (!this._p2WebcamTrail) {
        this._p2WebcamTrail = [];
      }
      this._p2WebcamTrail.push({ x: this.smoothedP2Centroid.x, y: this.smoothedP2Centroid.y, t: now });
      while (this._p2WebcamTrail.length > 6 || (this._p2WebcamTrail.length > 2 && now - this._p2WebcamTrail[0].t > 200)) {
        this._p2WebcamTrail.shift();
      }
      this._evaluateP2ZoneTrail(now);
    } else {
      this.p2MotionVector.vx *= 0.72;
      this.p2MotionVector.vy *= 0.72;
      this.p2MotionVector.mag *= 0.72;
    }
  }

  _evaluateP2ZoneTrail(now) {
    if (!this._p2WebcamTrail || this._p2WebcamTrail.length < 2) return;
    const first = this._p2WebcamTrail[0];
    const last = this._p2WebcamTrail[this._p2WebcamTrail.length - 1];
    const dt = Math.max(0.025, (last.t - first.t) / 1000);
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const netDisp = Math.hypot(dx, dy);

    let pathLen = 0;
    for (let i = 1; i < this._p2WebcamTrail.length; i++) {
      pathLen += Math.hypot(
        this._p2WebcamTrail[i].x - this._p2WebcamTrail[i - 1].x,
        this._p2WebcamTrail[i].y - this._p2WebcamTrail[i - 1].y
      );
    }
    const straightness = pathLen > 0.001 ? netDisp / pathLen : 0;
    const vx = dx / dt;
    const vy = dy / dt;
    this.p2MotionVector.vx = vx * 0.65;
    this.p2MotionVector.vy = vy * 0.65;
    this.p2MotionVector.mag =
      straightness >= 0.62 ? Math.hypot(this.p2MotionVector.vx, this.p2MotionVector.vy) : 0;

    if (
      netDisp >= 0.068 &&
      straightness >= 0.62 &&
      this.p2MotionVector.mag >= 0.68 &&
      now - this.lastP2WebcamTriggerMs > 310
    ) {
      this.lastP2WebcamTriggerMs = now;
      this._p2WebcamTrail = [last];

      const classification = this.p2StrokeClassifier.classifySequence();
      const side = classification.strokeSide;
      const speed = classification.shotMechanics.speedNormalized;
      const dirX = classification.shotMechanics.dirX;
      const dirY = classification.shotMechanics.dirY;
      const shotType = classification.shotMechanics.engineShotType;

      if (shotType === 'lob' && last.y < 0.35 && dy < -0.045) {
        this._emitP2Toss({ source: 'webcam_kinect_p2', side, shotType: 'lob', speed, dirX, dirY: -0.9 });
      } else {
        this._emitP2Swing({ source: 'webcam_kinect_p2', side, shotType, speed, dirX, dirY });
      }
    }
  }

  _evaluateHandTrail(now, isMediaPipe) {
    if (!this._webcamTrail || this._webcamTrail.length < 2) return;
    const first = this._webcamTrail[0];
    const last = this._webcamTrail[this._webcamTrail.length - 1];
    const dt = Math.max(0.025, (last.t - first.t) / 1000);
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const netDisp = Math.hypot(dx, dy);

    let pathLen = 0;
    for (let i = 1; i < this._webcamTrail.length; i++) {
      pathLen += Math.hypot(
        this._webcamTrail[i].x - this._webcamTrail[i - 1].x,
        this._webcamTrail[i].y - this._webcamTrail[i - 1].y
      );
    }

    const straightness = pathLen > 0.001 ? netDisp / pathLen : 0;
    const minDisp = isMediaPipe ? 0.060 : 0.090;
    const minStraight = isMediaPipe ? 0.55 : 0.64;
    const minSpeed = isMediaPipe ? 0.58 : 0.78;

    const vx = dx / dt;
    const vy = dy / dt;
    this.motionVector.vx = vx * 0.65;
    this.motionVector.vy = vy * 0.65;
    this.motionVector.mag =
      straightness >= minStraight ? Math.hypot(this.motionVector.vx, this.motionVector.vy) : 0;

    if (
      netDisp >= minDisp &&
      straightness >= minStraight &&
      this.motionVector.mag >= minSpeed &&
      now - this.lastWebcamTriggerMs > 310
    ) {
      this.lastWebcamTriggerMs = now;
      this._webcamTrail = [last];

      // Evaluate full temporal sequence via BiomechStrokeClassifier:
      // Separates anatomical stroke identity (forehand | backhand | uncertain)
      // from shot mechanics (drive | drop | cut_drop | lob | boast | volley_kill).
      const classification = this.strokeClassifier.classifySequence();
      const side = classification.strokeSide;
      const confidence = classification.confidence;
      const shotType = classification.shotMechanics.engineShotType;
      const cutMod = classification.shotMechanics.cutModifier;
      const speed = classification.shotMechanics.speedNormalized;
      const dirX = classification.shotMechanics.dirX;
      const dirY = classification.shotMechanics.dirY;

      this.detectedStanceSide = classification.lockedStrokeSide;
      this.lastBiomechClassification = classification;

      if (
        (last.y < 0.35 && dy < -0.045 && vy < -0.45) ||
        (vy < -0.85 && Math.abs(vy) > Math.abs(vx) * 1.15)
      ) {
        this._emitToss({
          source: 'webcam',
          side,
          confidence,
          biomechClassification: classification,
          shotType: 'lob',
          speed,
          dirX,
          dirY: -0.9
        });
      } else {
        this._emitSwing({
          source: 'webcam',
          side,
          confidence,
          biomechClassification: classification,
          shotType,
          cutModifier: cutMod,
          speed,
          dirX,
          dirY
        });
      }
    }
  }

  startPhonePolling() {
    if (this.phonePollTimer) return;
    const poll = async () => {
      if (this._disposed) return;
      try {
        const q = `?room=${encodeURIComponent(this.roomId || 'default')}&role=${encodeURIComponent(
          this.role || 'p1'
        )}&touch=1`;
        const res = await fetch(`/api/match/state${q}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (typeof this.onRoomState === 'function') this.onRoomState(data);

        const p1 = data.p1 || data;
        const p2 = data.p2 || null;
        const prevP1 = this.phoneState.connected;
        const prevP2 = this.p2PhoneState.connected;

        this.phoneState.connected = !!p1.connected;
        this.phoneState.lastSeenMs = Number(p1.lastSeenMs ?? -1);
        if (p2) {
          this.p2PhoneState.connected = !!p2.connected;
          this.p2PhoneState.lastSeenMs = Number(p2.lastSeenMs ?? -1);
        }

        const activePhone = this.role === 'p2' && p2 ? p2 : p1;
        if (activePhone && activePhone.orientation) {
          this.phoneState.orientation = {
            pitch: Number(activePhone.orientation.pitch || 0),
            roll: Number(activePhone.orientation.roll || 0),
            yaw: Number(activePhone.orientation.yaw || 0),
            accelMag: Number(activePhone.orientation.accelMag || 0),
            buttonB: !!activePhone.orientation.buttonB
          };
          if (typeof this.onOrientation === 'function') {
            this.onOrientation(this.phoneState.orientation);
          }
        }

        const anyConnected = this.phoneState.connected || this.p2PhoneState.connected;
        if (prevP1 !== this.phoneState.connected || prevP2 !== this.p2PhoneState.connected) {
          this._notifyStatus({
            webcam: this.webcamActive,
            phone: anyConnected,
            p1Phone: this.phoneState.connected,
            p2Phone: this.p2PhoneState.connected
          });
          this._updatePhoneBadgeUI(anyConnected);
        }

        if (p1 && p1.lastSwing && typeof p1.lastSwing.seq === 'number') {
          const seq = p1.lastSwing.seq;
          if (!this.phonePollInitialized) {
            this.phonePollInitialized = true;
            const age = Date.now() - Number(p1.lastSwing.serverTimeMs || 0);
            this.lastProcessedPhoneSeq = age < 1200 ? seq - 1 : seq;
          }
          if (seq > this.lastProcessedPhoneSeq) {
            this.lastProcessedPhoneSeq = seq;
            this.phoneState.lastSwing = p1.lastSwing;
            const sw = p1.lastSwing;
            if (sw.type === 'toss') {
              this._emitToss({
                source: 'phone',
                role: 'p1',
                side: sw.side,
                shotType: sw.shotType || 'lob',
                speed: sw.speed || 1.1,
                dirX: sw.angleX ?? sw.dirX ?? 0,
                dirY: sw.dirY ?? -0.9,
                pitch: sw.pitch,
                roll: sw.roll
              });
            } else {
              this._emitSwing({
                source: 'phone',
                role: 'p1',
                side: sw.side,
                shotType: sw.shotType,
                speed: sw.speed || 1.15,
                dirX: sw.angleX ?? sw.dirX ?? 0,
                dirY: sw.dirY ?? -0.45,
                pitch: sw.pitch,
                roll: sw.roll
              });
            }
          }
        } else if (!this.phonePollInitialized) {
          this.phonePollInitialized = true;
          this.lastProcessedPhoneSeq = 0;
        }

        if (p2 && p2.lastSwing && typeof p2.lastSwing.seq === 'number') {
          const seq = p2.lastSwing.seq;
          if (!this.p2PhonePollInitialized) {
            this.p2PhonePollInitialized = true;
            const age = Date.now() - Number(p2.lastSwing.serverTimeMs || 0);
            this.lastProcessedP2PhoneSeq = age < 1200 ? seq - 1 : seq;
          }
          if (seq > this.lastProcessedP2PhoneSeq) {
            this.lastProcessedP2PhoneSeq = seq;
            this.p2PhoneState.lastSwing = p2.lastSwing;
            const sw = p2.lastSwing;
            if (sw.type === 'toss') {
              this._emitP2Toss({
                source: 'phone',
                role: 'p2',
                side: sw.side,
                shotType: sw.shotType || 'lob',
                speed: sw.speed || 1.1,
                dirX: sw.angleX ?? sw.dirX ?? 0,
                dirY: sw.dirY ?? -0.9,
                pitch: sw.pitch,
                roll: sw.roll
              });
            } else {
              this._emitP2Swing({
                source: 'phone',
                role: 'p2',
                side: sw.side,
                shotType: sw.shotType,
                speed: sw.speed || 1.15,
                dirX: sw.angleX ?? sw.dirX ?? 0,
                dirY: sw.dirY ?? -0.45,
                pitch: sw.pitch,
                roll: sw.roll
              });
            }
          }
        } else if (!this.p2PhonePollInitialized) {
          this.p2PhonePollInitialized = true;
          this.lastProcessedP2PhoneSeq = 0;
        }
      } catch {
        // Ignore transient poll errors
      }
    };
    poll();
    this.phonePollTimer = setInterval(poll, this.phonePollIntervalMs);
  }

  stopPhonePolling() {
    if (this.phonePollTimer) {
      clearInterval(this.phonePollTimer);
      this.phonePollTimer = null;
    }
  }

  triggerHapticFeedback({
    kind = 'hit',
    grade = 'PERFECT',
    shotType = 'TOPSPIN',
    speedKmh = 165,
    intensity = 1,
    role = null
  } = {}) {
    const targetRole = role || this.role || 'p1';
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        if (kind === 'whiff' || kind === 'fault') {
          navigator.vibrate([18, 35, 18]);
        } else if (intensity >= 1.25 || /PERFECT|POWER|SMASH/i.test(grade)) {
          navigator.vibrate([45, 28, 65]);
        } else {
          navigator.vibrate([32]);
        }
      } catch {}
    }
    fetch('/api/racket/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: this.roomId || 'default',
        role: targetRole,
        kind,
        grade,
        shotType,
        speedKmh: Math.round(Number(speedKmh || 150)),
        intensity: Number(intensity || 1)
      })
    }).catch(() => {});
  }

  _initDOMBindings() {
    this._onKeyDown = (e) => {
      if (
        e.target &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT')
      ) {
        return;
      }
      const code = e.code;
      this.keysDown.add(code);

      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.cutModifierActive = true;
        return;
      }
      if (code === 'KeyQ') {
        this.aimBiasX = Math.max(-1, this.aimBiasX - 0.55);
      } else if (code === 'KeyE') {
        this.aimBiasX = Math.min(1, this.aimBiasX + 0.55);
      } else if (code === 'Digit1') {
        this.setShotType('topspin');
        this._emitSwing({
          source: 'keyboard',
          shotType: 'topspin',
          speed: 1.22,
          dirX: this.aimBiasX,
          dirY: -0.45
        });
      } else if (code === 'Digit2') {
        this.setShotType('drop');
        this._emitSwing({
          source: 'keyboard',
          shotType: 'drop',
          cutModifier: true,
          speed: 0.86,
          dirX: this.aimBiasX,
          dirY: 0.38
        });
      } else if (code === 'Digit3') {
        this.setShotType('boast');
        this._emitSwing({
          source: 'keyboard',
          shotType: 'boast',
          speed: 1.14,
          dirX: this.aimBiasX,
          dirY: 0.15
        });
      } else if (code === 'Digit4') {
        this.setShotType('lob');
        this._emitSwing({
          source: 'keyboard',
          shotType: 'lob',
          speed: 1.05,
          dirX: this.aimBiasX,
          dirY: -0.85
        });
      } else if (code === 'Digit5') {
        this.setShotType('smash');
        this._emitSwing({
          source: 'keyboard',
          shotType: 'smash',
          speed: 1.48,
          dirX: this.aimBiasX,
          dirY: 0.65
        });
      } else if (code === 'KeyB') {
        this.setShotType('boast');
        this._emitSwing({
          source: 'keyboard',
          shotType: e.shiftKey ? 'back_wall_boast' : 'boast',
          speed: 1.15,
          dirX: this.aimBiasX,
          dirY: 0.2
        });
      } else if (code === 'Space' || code === 'Enter') {
        e.preventDefault();
        if (e.repeat) return;
        this.prepHoldStartMs = performance.now();
        if (typeof this.onPrepStart === 'function') {
          this.onPrepStart({
            source: 'keyboard',
            dirX: this.aimBiasX,
            timestamp: this.prepHoldStartMs
          });
        }
      }
    };

    this._onKeyUp = (e) => {
      const code = e.code;
      this.keysDown.delete(code);
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.cutModifierActive =
          this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
      }
      if (!this.keysDown.has('KeyQ') && !this.keysDown.has('KeyE')) {
        this.aimBiasX = 0;
      }
      if ((code === 'Space' || code === 'Enter') && this.prepHoldStartMs > 0) {
        const holdMs = Math.max(0, performance.now() - this.prepHoldStartMs);
        this.prepHoldStartMs = 0;
        const isCut =
          this.cutModifierActive || e.shiftKey || this.selectedShotType === 'drop';
        const speed = isCut
          ? 0.84
          : Math.min(1.55, 1.08 + (Math.min(holdMs, 600) / 600) * 0.38);
        const shotType = isCut ? 'drop' : this.selectedShotType || 'topspin';
        if (typeof this.onPrepEnd === 'function') {
          this.onPrepEnd({ holdMs, cutModifier: isCut, shotType });
        }
        this._emitSwing({
          source: 'keyboard',
          shotType,
          cutModifier: isCut,
          prepHoldMs: holdMs,
          speed,
          dirX: this.aimBiasX,
          dirY: isCut ? 0.38 : -0.45
        });
      }
    };

    this._onContextMenu = (e) => {
      if (e.target && e.target.closest('#game-canvas, #canvas-container')) {
        e.preventDefault();
      }
    };

    this._onPointerDown = (e) => {
      if (
        e.target &&
        e.target.closest(
          'button, a, input, select, label, .hud-interactive, .control-btn, .squash-tuning-drawer, .wonder-intro-overlay, .wii-modal-backdrop'
        )
      ) {
        return;
      }
      if (e.button === 2) {
        this.cutModifierActive = true;
        this.pointerDrag = {
          startX: e.clientX,
          startY: e.clientY,
          startTime: performance.now(),
          lastX: e.clientX,
          lastY: e.clientY,
          cutModifier: true
        };
        if (typeof this.onPrepStart === 'function') {
          this.onPrepStart({ source: 'mouse', dirX: this.aimBiasX, timestamp: performance.now() });
        }
        return;
      }
      this.pointerDrag = {
        startX: e.clientX,
        startY: e.clientY,
        startTime: performance.now(),
        lastX: e.clientX,
        lastY: e.clientY,
        cutModifier: e.shiftKey || this.cutModifierActive || this.selectedShotType === 'drop'
      };
      this.mouseTrail = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      if (typeof this.onPrepStart === 'function') {
        this.onPrepStart({ source: 'mouse', dirX: this.aimBiasX, timestamp: performance.now() });
      }
    };

    this._onPointerMove = (e) => {
      if (this.pointerDrag) {
        this.pointerDrag.lastX = e.clientX;
        this.pointerDrag.lastY = e.clientY;
        this.mouseTrail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (this.mouseTrail.length > 20) this.mouseTrail.shift();
      }
    };

    this._onPointerUp = (e) => {
      if (e.button === 2) {
        this.cutModifierActive = false;
      }
      if (!this.pointerDrag) return;
      const drag = this.pointerDrag;
      this.pointerDrag = null;

      const dx = (e.clientX ?? drag.lastX) - drag.startX;
      const dy = (e.clientY ?? drag.lastY) - drag.startY;
      const holdMs = Math.max(16, performance.now() - drag.startTime);
      const dist = Math.hypot(dx, dy);
      const isCut = Boolean(
        drag.cutModifier ||
          e.button === 2 ||
          e.shiftKey ||
          this.cutModifierActive ||
          this.selectedShotType === 'drop'
      );

      if (typeof this.onPrepEnd === 'function') {
        this.onPrepEnd({ holdMs, cutModifier: isCut });
      }

      if (dist < 14) {
        const speed = isCut
          ? 0.85
          : Math.min(1.52, 1.05 + (Math.min(holdMs, 550) / 550) * 0.38);
        this._emitSwing({
          source: 'mouse',
          shotType: isCut ? 'drop' : this.selectedShotType || 'topspin',
          cutModifier: isCut,
          prepHoldMs: holdMs,
          speed,
          dirX: this.aimBiasX,
          dirY: isCut ? 0.36 : -0.45
        });
        return;
      }

      const swipeVel = dist / holdMs;
      const speed = isCut ? 0.86 : Math.min(1.65, Math.max(0.82, 0.78 + swipeVel * 0.42));
      let side = null;
      if (dx > 14) side = 'backhand';
      else if (dx < -14) side = 'forehand';

      const normX = Math.max(-1, Math.min(1, dx / 180));
      const dirX =
        side === 'backhand'
          ? Math.max(0.22, normX)
          : side === 'forehand'
          ? Math.min(-0.22, normX)
          : normX;
      const dirY = Math.max(-1, Math.min(1, dy / 150));

      let shotType = isCut ? 'drop' : this.selectedShotType || 'topspin';
      if (!isCut) {
        if (Math.abs(dx) > 130 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          shotType = 'boast';
        } else if ((dy > 38 && speed > 1.22) || speed > 1.46) {
          shotType = 'smash';
        } else if (dy > 18) {
          shotType = 'drop';
        } else if (dy < -42) {
          shotType = 'lob';
        }
      }

      this._emitSwing({
        source: 'mouse',
        side,
        shotType,
        cutModifier: isCut || shotType === 'drop',
        prepHoldMs: holdMs,
        speed,
        dirX,
        dirY
      });
    };

    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    const handBtn = typeof document !== 'undefined' ? document.getElementById('btn-handedness-toggle') : null;
    if (handBtn) {
      handBtn.addEventListener('click', () => {
        this.toggleHandedness();
      });
    }
  }

  _startHudRenderLoop() {
    const loop = () => {
      if (this._disposed) return;
      if (this.webcamActive) {
        this._processWebcamFrame();
      }
      if (!this.webcamCanvas) {
        this.webcamCanvas = document.getElementById(this.webcamCanvasId);
        if (this.webcamCanvas) {
          this.webcamCtx = this.webcamCanvas.getContext('2d');
        }
      }
      if (this.webcamCanvas && this.webcamCtx) {
        this._drawHudCanvas(
          this.webcamCtx,
          this.webcamCanvas.width,
          this.webcamCanvas.height
        );
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _drawHudCanvas(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const isFrontCam = this.cameraFacingMode === 'user';

    if (this.webcamActive && this.videoElem && this.videoElem.readyState >= 2) {
      ctx.save();
      if (isFrontCam) {
        ctx.scale(-1, 1);
        ctx.drawImage(this.videoElem, -w, 0, w, h);
      } else {
        ctx.drawImage(this.videoElem, 0, 0, w, h);
      }
      ctx.restore();

      // Draw T-Position Reference Crosshair on Camera Feed
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 0);
      ctx.lineTo(w * 0.5, h);
      ctx.moveTo(0, h * 0.52);
      ctx.lineTo(w, h * 0.52);
      ctx.stroke();

      const now = performance.now();
      if (this.latestHandLandmarks && now - (this.latestHandSeenAt || 0) < 240) {
        const lm = this.latestHandLandmarks;
        const bones = [
          [0, 1], [1, 2], [2, 3], [3, 4],
          [0, 5], [5, 6], [6, 7], [7, 8],
          [0, 9], [9, 10], [10, 11], [11, 12],
          [0, 13], [13, 14], [14, 15], [15, 16],
          [0, 17], [17, 18], [18, 19], [19, 20],
          [5, 9], [9, 13], [13, 17]
        ];
        ctx.strokeStyle = '#00e436';
        ctx.lineWidth = 2;
        for (const [a, b] of bones) {
          const pA = lm[a];
          const pB = lm[b];
          const xA = (isFrontCam ? 1 - pA.x : pA.x) * w;
          const xB = (isFrontCam ? 1 - pB.x : pB.x) * w;
          ctx.beginPath();
          ctx.moveTo(xA, pA.y * h);
          ctx.lineTo(xB, pB.y * h);
          ctx.stroke();
        }
        for (let i = 0; i < lm.length; i++) {
          const pt = lm[i];
          const px = (isFrontCam ? 1 - pt.x : pt.x) * w;
          ctx.fillStyle = i === 0 || i === 8 || i === 9 ? '#dfff00' : '#ffffff';
          ctx.beginPath();
          ctx.arc(px, pt.y * h, i === 0 || i === 9 ? 3.5 : 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const scaleX = w / this.flowWidth;
        const scaleY = h / this.flowHeight;
        ctx.fillStyle = 'rgba(223, 255, 0, 0.38)';
        for (let y = 0; y < this.flowHeight; y += 2) {
          for (let x = 0; x < this.flowWidth; x += 2) {
            if (this.motionEnergyMap[y * this.flowWidth + x] > 0.14) {
              ctx.fillRect(x * scaleX, y * scaleY, scaleX * 1.8, scaleY * 1.8);
            }
          }
        }
      }
    } else {
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 6, w * 0.5, h * 0.5, w * 0.65);
      grad.addColorStop(0, 'rgba(24, 68, 42, 0.92)');
      grad.addColorStop(1, 'rgba(10, 24, 36, 0.96)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w, h * 0.5);
      ctx.moveTo(w * 0.5, 0);
      ctx.lineTo(w * 0.5, h);
      ctx.arc(w * 0.5, h * 0.5, Math.min(w, h) * 0.32, 0, Math.PI * 2);
      ctx.stroke();
    }

    const sinceSwing = performance.now() - this.lastVisualSwing.timestamp;
    const isRecent = sinceSwing < 550;
    const cx = this.webcamActive ? this.smoothedCentroid.x * w : w * 0.5;
    const cy = this.webcamActive ? this.smoothedCentroid.y * h : h * 0.52;

    if (this.webcamActive && this.kinectSplitMode) {
      // Draw Kinect 2P Split-Zone Divider (Left = P1 Blue, Right = P2 Orange)
      ctx.save();
      ctx.strokeStyle = 'rgba(223, 255, 0, 0.78)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 0);
      ctx.lineTo(w * 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 8px sans-serif';
      ctx.fillStyle = '#00e5ff';
      ctx.fillText('P1 ZONE', 6, h - 13);
      ctx.fillStyle = '#ff9100';
      ctx.fillText('P2 ZONE', w * 0.5 + 6, h - 13);

      // Draw P2 Racket Reticle in Right Zone
      const p2x = this.smoothedP2Centroid.x * w;
      const p2y = this.smoothedP2Centroid.y * h;
      ctx.translate(p2x, p2y);
      ctx.strokeStyle = '#ff9100';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    const rollRad = ((this.phoneState.orientation.roll || this.aimBiasX * 28) * Math.PI) / 180;
    ctx.translate(cx, cy);
    ctx.rotate(rollRad);
    ctx.strokeStyle = isRecent ? '#dfff00' : '#00c8ff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(0, 28);
    ctx.stroke();
    ctx.restore();

    let vecX = this.webcamActive ? this.motionVector.vx * 26 : 0;
    let vecY = this.webcamActive ? this.motionVector.vy * 26 : 0;
    if (isRecent) {
      const fade = 1 - sinceSwing / 550;
      vecX = this.lastVisualSwing.dirX * 36 * fade;
      vecY = this.lastVisualSwing.dirY * 32 * fade;
    }

    if (Math.hypot(vecX, vecY) > 3) {
      const ex = cx + vecX;
      const ey = cy + vecY;
      const ang = Math.atan2(vecY, vecX);
      ctx.save();
      ctx.strokeStyle = '#dfff00';
      ctx.fillStyle = '#dfff00';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 7 * Math.cos(ang - 0.5), ey - 7 * Math.sin(ang - 0.5));
      ctx.lineTo(ex - 7 * Math.cos(ang + 0.5), ey - 7 * Math.sin(ang + 0.5));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    const barRatio = isRecent
      ? Math.min(1, (this.lastVisualSwing.speed / 1.6) * (1 - sinceSwing / 650))
      : Math.min(1, this.motionVector.mag / 1.4);
    const barH = 5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(6, h - barH - 5, w - 12, barH);
    ctx.fillStyle = barRatio > 0.75 ? '#dfff00' : '#00d2ff';
    ctx.fillRect(6, h - barH - 5, (w - 12) * barRatio, barH);

    ctx.fillStyle = isRecent ? '#dfff00' : 'rgba(255, 255, 255, 0.92)';
    ctx.font = 'bold 9px sans-serif';
    const stanceSummary = this.strokeClassifier
      ? this.strokeClassifier.getLiveStanceSummary()
      : { strokeSide: 'uncertain', confidence: 0, handedness: this.handedness };
    const handTag = this.handedness === 'left' ? 'LH' : 'RH';
    const liveStance =
      stanceSummary.strokeSide === STROKE_SIDES.FOREHAND
        ? `FH STANCE (${handTag})`
        : stanceSummary.strokeSide === STROKE_SIDES.BACKHAND
        ? `BH STANCE (${handTag})`
        : `HOLD / UNCERTAIN (${handTag})`;

    let label = this.webcamActive
      ? this.kinectSplitMode
        ? `KINECT 2P SPLIT • P1|P2`
        : this.cameraFacingMode === 'environment'
        ? `BACK CAM • ${liveStance}`
        : `FRONT CAM • ${liveStance}`
      : this.phoneState.connected
      ? 'POCKET RACKET LIVE'
      : 'MOTION RADAR';
    if (isRecent) {
      const sTag =
        this.lastVisualSwing.side === 'backhand'
          ? 'BACKHAND'
          : this.lastVisualSwing.side === 'forehand'
          ? 'FOREHAND'
          : this.lastVisualSwing.side === 'uncertain'
          ? 'UNCERTAIN'
          : '';
      const st = (this.lastVisualSwing.shotType || 'topspin').toUpperCase();
      label = sTag ? `${sTag} • ${st}` : st;
    }
    ctx.fillText(label, 6, 12);
  }

  _updateHandednessUI() {
    const handBtn = document.getElementById('btn-handedness-toggle');
    const handLbl = document.getElementById('handedness-btn-label');
    const isLeft = this.handedness === 'left';
    if (handLbl) {
      handLbl.textContent = isLeft ? '🤚 Left-Handed' : '🤚 Right-Handed';
    }
    if (handBtn) {
      handBtn.classList.toggle('active', isLeft);
    }
  }

  _updateCameraFacingUI() {
    const facingBtn = document.getElementById('btn-camera-facing');
    const facingLbl = document.getElementById('camera-facing-label');
    const pipLabel = document.getElementById('pip-motion-label');
    const isBack = this.cameraFacingMode === 'environment';
    if (facingLbl) {
      if (this.kinectSplitMode) {
        facingLbl.textContent = isBack ? '📺 2P Kinect (Back/TV)' : '👥 2P Kinect Split';
      } else {
        facingLbl.textContent = isBack ? '🔄 Back Cam (1P TV)' : '🔄 Front Cam (1P)';
      }
    }
    if (pipLabel) {
      if (this.kinectSplitMode) {
        pipLabel.textContent = 'Kinect 2P Split: Left=P1 | Right=P2';
      } else {
        pipLabel.textContent = isBack ? 'Back Cam: Body + Swing' : 'Front Cam: Pose + Swing';
      }
    }
    if (facingBtn) {
      facingBtn.classList.toggle('hidden', !this.webcamActive);
    }
  }

  _updateWebcamBadgeUI(active) {
    const btn =
      document.getElementById('btn-webcam-toggle') ||
      document.getElementById('webcam-status-badge') ||
      document.getElementById('btn-webcam');
    const dot = document.getElementById('webcam-status-dot');
    const lbl = document.getElementById('webcam-btn-label');
    const pipCard = document.getElementById('webcam-pip-card');
    const facingBtn = document.getElementById('btn-camera-facing');
    const setupCamBtn = document.getElementById('btn-setup-pose-cam');

    if (btn) btn.classList.toggle('active', active);
    if (dot) dot.classList.toggle('connected', active);
    if (lbl) lbl.textContent = active ? '📷 Pose Cam: ON' : '📷 Pose Cam';
    if (pipCard) pipCard.classList.toggle('hidden', !active);
    if (facingBtn) facingBtn.classList.toggle('hidden', !active);
    if (setupCamBtn) {
      setupCamBtn.classList.toggle('selected', active);
      setupCamBtn.textContent = active
        ? `📷 Pose Cam: ON (${this.cameraFacingMode === 'environment' ? 'Back/TV' : 'Front'})`
        : '📷 Enable Pose Cam (Front/Back)';
    }
  }

  _updatePhoneBadgeUI(connected) {
    const badge =
      document.getElementById('phone-status-badge') ||
      document.getElementById('phone-racket-status') ||
      document.getElementById('phone-status-label');
    const dot = document.getElementById('phone-status-dot');
    if (dot) dot.classList.toggle('connected', connected);
    if (badge) {
      badge.classList.toggle('connected', connected);
      badge.textContent = connected ? 'Pocket Racket: Connected' : 'Pocket Racket';
    }
  }

  _updateHudShotPills(shotType) {
    if (typeof document === 'undefined') return;
    const pills = document.querySelectorAll('[data-shot-type]');
    if (!pills || pills.length === 0) return;
    pills.forEach((el) => {
      el.classList.toggle('active', el.dataset.shotType === shotType);
    });
  }

  _notifyStatus(st) {
    if (typeof this.onStatusChange === 'function') this.onStatusChange(st);
    for (const cb of this._listeners.status) {
      try {
        cb(st);
      } catch (err) {
        console.error(err);
      }
    }
  }

  dispose() {
    this._disposed = true;
    this.disableWebcam();
    this.stopPhonePolling();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }
}

export default MotionController;
