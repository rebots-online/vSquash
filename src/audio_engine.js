// ============================================================================
// ARGON SQUASH — AUDIO ENGINE, DEEP MALE REFEREE VOICE & MUSIC JUKEBOX
// Features:
//   1. "Welcome to Virtual Squash!" arcade announcer intro
//   2. Deep Male WSF/PSA Squash Referee Voice ("Down! Handout, five-four", etc.)
//      with toggleable state, deep baritone pitch selection, and PA resonance
//   3. Full 7-Track Music Jukebox (4 Lyria 3 Studio Tracks + 3 Procedural
//      Web-Audio Arcade/Synthwave Sequencer Tracks) with Auto/Lock/Shuffle modes
// ============================================================================

export const LYRIA_TRACKS = {
  match_rally: {
    id: 'match_rally',
    title: 'Physical Chess Rally (Lyria 3)',
    shortTitle: 'Physical Chess Rally',
    subtitle: 'Active Squash Atmosphere • 124 BPM',
    genre: 'Lyria 3 Soundtrack',
    type: 'audio',
    src: 'https://www.gstatic.com/aistudio/starter-apps/tennis/audio/match_rally.mp3',
    loop: true,
    baseVolume: 0.36
  },
  menu_theme: {
    id: 'menu_theme',
    title: 'Glass Showcourt Prelude (Lyria 3)',
    shortTitle: 'Showcourt Prelude',
    subtitle: 'Title & Club Select Theme • 108 BPM',
    genre: 'Lyria 3 Soundtrack',
    type: 'audio',
    src: 'https://www.gstatic.com/aistudio/starter-apps/tennis/audio/menu_theme.mp3',
    loop: true,
    baseVolume: 0.42
  },
  court_intro: {
    id: 'court_intro',
    title: 'PSA Glass Arena Flyover (Lyria 3)',
    shortTitle: 'Arena Flyover',
    subtitle: 'Showcourt Intro Fanfare • 120 BPM',
    genre: 'Lyria 3 Soundtrack',
    type: 'audio',
    src: 'https://www.gstatic.com/aistudio/starter-apps/tennis/audio/court_intro.mp3',
    loop: false,
    baseVolume: 0.48
  },
  victory_fanfare: {
    id: 'victory_fanfare',
    title: 'Championship Glass Trophy (Lyria 3)',
    shortTitle: 'Championship Trophy',
    subtitle: 'Match Victory Celebration • 126 BPM',
    genre: 'Lyria 3 Soundtrack',
    type: 'audio',
    src: 'https://www.gstatic.com/aistudio/starter-apps/tennis/audio/victory_fanfare.mp3',
    loop: false,
    baseVolume: 0.50
  },
  virtua_arcade_95: {
    id: 'virtua_arcade_95',
    title: "Virtual Squash '95 (Arcade Synth)",
    shortTitle: "Virtual Squash '95",
    subtitle: '90s Virtua Arcade FM Brass & Bass • 132 BPM',
    genre: 'Arcade FM Synth',
    type: 'synth',
    bpm: 132,
    loop: true,
    baseVolume: 0.44
  },
  t_zone_cyber: {
    id: 't_zone_cyber',
    title: 'T-Zone Cyber Pulse (128 BPM)',
    shortTitle: 'T-Zone Cyber Pulse',
    subtitle: 'Driving Electro-Squash Mid-Court Arp • 128 BPM',
    genre: 'Cyber Electro',
    type: 'synth',
    bpm: 128,
    loop: true,
    baseVolume: 0.42
  },
  cairo_glass_finals: {
    id: 'cairo_glass_finals',
    title: 'Cairo Glass Finals (Deep Groove)',
    shortTitle: 'Cairo Glass Finals',
    subtitle: 'Championship Sub-Bass & Glass Percussion • 118 BPM',
    genre: 'Deep Breakbeat',
    type: 'synth',
    bpm: 118,
    loop: true,
    baseVolume: 0.44
  }
};

export const JUKEBOX_TRACK_LIST = Object.values(LYRIA_TRACKS);

const STATE_TO_TRACK = {
  title: 'menu_theme',
  menu: 'menu_theme',
  select: 'menu_theme',
  intro: 'court_intro',
  court_intro: 'court_intro',
  flyover: 'court_intro',
  start: 'court_intro',
  serve: 'match_rally',
  serve_wait: 'match_rally',
  serve_toss: 'match_rally',
  rally: 'match_rally',
  playing: 'match_rally',
  match: 'match_rally',
  point: 'match_rally',
  gamepoint: 'match_rally',
  replay: 'match_rally',
  victory: 'victory_fanfare',
  win: 'victory_fanfare',
  game_won: 'victory_fanfare',
  match_over: 'victory_fanfare',
  celebration: 'victory_fanfare',
  menu_theme: 'menu_theme',
  match_rally: 'match_rally',
  victory_fanfare: 'victory_fanfare',
  virtua_arcade_95: 'virtua_arcade_95',
  t_zone_cyber: 't_zone_cyber',
  cairo_glass_finals: 'cairo_glass_finals'
};

export const GEMINI_TTS_CLIPS = {};

export class AudioEngine {
  constructor(options = {}) {
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicSynthGain = null;
    this.reverbSend = null;

    this.muted = Boolean(options.muted ?? false);
    this.musicVolume = Number(options.musicVolume ?? 0.65);
    this.sfxVolume = Number(options.sfxVolume ?? 0.88);

    // Deep Male Referee Voice Configuration
    this.refereeVoiceEnabled = options.refereeVoiceEnabled !== false;
    this.refereeVoicePitch = Number(options.refereeVoicePitch ?? 0.72); // Deep resonant male baritone
    this.refereeVoiceRate = Number(options.refereeVoiceRate ?? 0.95);
    this._cachedMaleVoice = null;
    this._welcomePlayed = false;
    this.lastRefereeCallout = 'Welcome to Virtual Squash!';

    // Jukebox State
    this.jukeboxMode = 'auto'; // 'auto' | 'locked' | 'shuffle'
    this.audioElements = new Map();
    this.ttsAudioElements = new Map();
    this._activeVoiceAudio = null;
    this._voiceTimers = [];
    this.currentTrackId = null;
    this.desiredTrackId = 'menu_theme';
    this.unlocked = false;

    // Procedural Synth Sequencer State
    this._synthTimer = null;
    this._synthStep = 0;

    this.onTrackChange = typeof options.onTrackChange === 'function' ? options.onTrackChange : null;
    this.onRefereeCallout = typeof options.onRefereeCallout === 'function' ? options.onRefereeCallout : null;

    this._noiseBuffer = null;
    this._pinkNoiseBuffer = null;
    this._fadeTimers = new Map();

    this._preloadTracks();
    this._initSpeechVoices();
    this._attachAutoplayUnlock();
  }

  _preloadTracks() {
    for (const [id, track] of Object.entries(LYRIA_TRACKS)) {
      if (track.type !== 'audio' || !track.src) continue;
      const el = new Audio();
      el.src = track.src;
      el.loop = track.loop;
      el.preload = 'auto';
      el.volume = 0;
      el.crossOrigin = 'anonymous';
      if (id === 'court_intro' || id === 'victory_fanfare') {
        el.addEventListener('ended', () => {
          if (this.currentTrackId === id) {
            if (this.jukeboxMode === 'shuffle') {
              this.nextJukeboxTrack({ fromShuffle: true });
            } else if (this.jukeboxMode === 'locked') {
              el.currentTime = 0;
              el.play().catch(() => {});
            } else if (id === 'court_intro') {
              this.playMusicForState('rally');
            }
          }
        });
      }
      this.audioElements.set(id, el);
    }
  }

  _initSpeechVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      this._cachedMaleVoice = this._selectDeepMaleVoice();
    };
    loadVoices();
    if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  /**
   * Selects the best available deep male English voice from browser SpeechSynthesis.
   */
  _selectDeepMaleVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;

    const enVoices = voices.filter((v) => /^en(-|_|$)/i.test(v.lang || ''));
    const pool = enVoices.length ? enVoices : voices;

    const preferredMalePatterns = [
      /Google UK English Male/i,
      /Daniel/i,
      /Arthur/i,
      /Oliver/i,
      /Microsoft George/i,
      /Microsoft Ryan/i,
      /Microsoft Guy/i,
      /Microsoft Christopher/i,
      /Microsoft David/i,
      /Microsoft Mark/i,
      /Alex/i,
      /Fred/i,
      /Aaron/i,
      /Tom/i,
      /English.*Male/i,
      /\bMale\b/i
    ];

    const avoidFemalePatterns = /Female|Samantha|Victoria|Karen|Moira|Tessa|Zira|Hazel|Susan|Catherine|Serena|Martha/i;

    for (const pattern of preferredMalePatterns) {
      const match = pool.find((v) => pattern.test(v.name));
      if (match) return match;
    }

    const nonFemale = pool.find((v) => !avoidFemalePatterns.test(v.name));
    return nonFemale || pool[0];
  }

  _attachAutoplayUnlock() {
    const onFirstGesture = () => {
      const wasUnlocked = this.unlocked;
      this.unlock();
      if (!wasUnlocked && !this._welcomePlayed) {
        this.playWelcomeIntro();
      }
    };
    window.addEventListener('pointerdown', onFirstGesture, { passive: true });
    window.addEventListener('keydown', onFirstGesture, { passive: true });
    window.addEventListener('touchstart', onFirstGesture, { passive: true });
  }

  _ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.masterGain);

      this.musicSynthGain = this.ctx.createGain();
      this.musicSynthGain.gain.value = this.musicVolume * 0.42;
      this.musicSynthGain.connect(this.masterGain);

      const delay = this.ctx.createDelay(0.5);
      delay.delayTime.value = 0.095;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.24;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;

      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.22;
      this.reverbSend.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.masterGain);

      this._buildNoiseBuffers();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _buildNoiseBuffers() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const len = sr * 2;
    this._noiseBuffer = this.ctx.createBuffer(1, len, sr);
    const white = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) white[i] = Math.random() * 2 - 1;

    this._pinkNoiseBuffer = this.ctx.createBuffer(1, len, sr);
    const pink = this._pinkNoiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      pink[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.045;
      b6 = w * 0.115926;
    }
  }

  unlock() {
    this._ensureContext();
    this.unlocked = true;
    const targetId = this.currentTrackId || this.desiredTrackId;
    if (targetId && !this.muted) {
      const track = LYRIA_TRACKS[targetId];
      if (track?.type === 'synth') {
        if (!this._synthTimer) this._startSynthSequencer(targetId);
      } else {
        const el = this.audioElements.get(targetId);
        if (!el || el.paused) {
          this._crossfadeToTrack(targetId);
        }
      }
    }
  }

  /**
   * Plays the signature "Welcome to Virtual Squash!" announcer callout.
   */
  playWelcomeIntro({ force = false, withLoveAll = false } = {}) {
    if (this._welcomePlayed && !force) return;
    this._welcomePlayed = true;
    if (this.muted) return;

    const ctx = this._ensureContext();
    if (ctx) {
      // Warm Virtua Arcade brass fanfare chord (D9 -> Gmaj7)
      const now = ctx.currentTime;
      const notes = [146.83, 220.0, 293.66, 369.99, 440.0, 587.33];
      notes.forEach((freq, idx) => {
        const t = now + idx * 0.045;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc2.detune.setValueAtTime(8, t);
        osc1.frequency.setValueAtTime(freq, t);
        osc2.frequency.setValueAtTime(freq, t);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(650, t);
        filter.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
        filter.frequency.exponentialRampToValueAtTime(980, t + 0.55);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.045, t + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.62);
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        if (this.reverbSend) gain.connect(this.reverbSend);
        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.65);
        osc2.stop(t + 0.65);
      });
    }

    const phrase = withLoveAll
      ? 'Welcome to Virtual Squash! Love all. Play!'
      : 'Welcome to Virtual Squash!';
    this.playVoiceCallout(phrase, { delayMs: 90, clearQueue: true, forceReferee: true });
  }

  // ==========================================================================
  // MUSIC JUKEBOX & STATE SOUNDTRACK CONTROLLER
  // ==========================================================================

  getJukeboxTracks() {
    return JUKEBOX_TRACK_LIST.map((t) => ({
      ...t,
      active: (this.currentTrackId || this.desiredTrackId) === t.id
    }));
  }

  setJukeboxMode(mode = 'auto') {
    if (['auto', 'locked', 'shuffle'].includes(mode)) {
      this.jukeboxMode = mode;
    }
    this._notifyTrackChange();
    return this.jukeboxMode;
  }

  selectJukeboxTrack(trackId, { lock = true } = {}) {
    if (!LYRIA_TRACKS[trackId]) return this.getCurrentTrackInfo();
    if (lock) {
      this.jukeboxMode = 'locked';
    }
    this.desiredTrackId = trackId;
    this._crossfadeToTrack(trackId);
    return this.getCurrentTrackInfo();
  }

  nextJukeboxTrack({ fromShuffle = false } = {}) {
    const ids = Object.keys(LYRIA_TRACKS);
    const curIdx = Math.max(0, ids.indexOf(this.currentTrackId || this.desiredTrackId || 'match_rally'));
    let nextIdx = (curIdx + 1) % ids.length;
    if (fromShuffle || this.jukeboxMode === 'shuffle') {
      nextIdx = (curIdx + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length;
    } else if (this.jukeboxMode === 'auto') {
      this.jukeboxMode = 'locked';
    }
    const nextId = ids[nextIdx];
    this.desiredTrackId = nextId;
    this._crossfadeToTrack(nextId);
    return this.getCurrentTrackInfo();
  }

  prevJukeboxTrack() {
    const ids = Object.keys(LYRIA_TRACKS);
    const curIdx = Math.max(0, ids.indexOf(this.currentTrackId || this.desiredTrackId || 'match_rally'));
    const prevIdx = (curIdx - 1 + ids.length) % ids.length;
    if (this.jukeboxMode === 'auto') {
      this.jukeboxMode = 'locked';
    }
    const prevId = ids[prevIdx];
    this.desiredTrackId = prevId;
    this._crossfadeToTrack(prevId);
    return this.getCurrentTrackInfo();
  }

  playMusicForState(stateName) {
    if (this.jukeboxMode === 'locked' && this.currentTrackId) {
      return this.getCurrentTrackInfo();
    }
    const key = String(stateName || 'rally').toLowerCase().trim();
    const trackId = STATE_TO_TRACK[key] || 'match_rally';
    this.desiredTrackId = trackId;
    if (this.currentTrackId === trackId) {
      const track = LYRIA_TRACKS[trackId];
      if (track?.type === 'audio') {
        const el = this.audioElements.get(trackId);
        if (el && el.paused && !this.muted) {
          el.play().catch(() => {});
        }
      }
      return this.getCurrentTrackInfo();
    }
    this._crossfadeToTrack(trackId);
    return this.getCurrentTrackInfo();
  }

  _crossfadeToTrack(targetTrackId) {
    const prevId = this.currentTrackId;
    this.currentTrackId = targetTrackId;

    // Stop previous audio element or synth sequencer
    if (prevId && prevId !== targetTrackId) {
      const prevEl = this.audioElements.get(prevId);
      if (prevEl) this._fadeAudio(prevEl, 0, 380, true);
    }
    this._stopSynthSequencer();

    const targetTrack = LYRIA_TRACKS[targetTrackId];
    if (!targetTrack) return;

    if (targetTrack.type === 'synth') {
      // Fade out any playing HTML5 audio elements
      for (const el of this.audioElements.values()) {
        if (!el.paused) this._fadeAudio(el, 0, 260, true);
      }
      if (!this.muted) {
        this._startSynthSequencer(targetTrackId);
      }
    } else {
      const el = this.audioElements.get(targetTrackId);
      if (el) {
        const targetVol = this.muted ? 0 : Math.min(1, targetTrack.baseVolume * this.musicVolume);
        if (!targetTrack.loop) {
          try {
            el.currentTime = 0;
          } catch {}
        }
        el.play()
          .then(() => {
            this._fadeAudio(el, targetVol, 440, false);
          })
          .catch(() => {});
      }
    }

    this._notifyTrackChange();
  }

  _notifyTrackChange() {
    const info = this.getCurrentTrackInfo();
    this._updateHudMusicBadge(info);
    if (typeof this.onTrackChange === 'function') {
      this.onTrackChange(info);
    }
  }

  // ==========================================================================
  // PROCEDURAL WEB-AUDIO ARCADE / SYNTHWAVE SEQUENCER FOR JUKEBOX TRACKS
  // ==========================================================================

  _stopSynthSequencer() {
    if (this._synthTimer) {
      clearInterval(this._synthTimer);
      this._synthTimer = null;
    }
  }

  _startSynthSequencer(trackId) {
    this._stopSynthSequencer();
    const ctx = this._ensureContext();
    if (!ctx) return;

    const track = LYRIA_TRACKS[trackId] || LYRIA_TRACKS.virtua_arcade_95;
    const bpm = track.bpm || 128;
    const stepMs = Math.round((60 / bpm / 4) * 1000); // 16th-note step interval
    this._synthStep = 0;

    if (this.musicSynthGain) {
      this.musicSynthGain.gain.setValueAtTime(
        this.muted ? 0 : Math.min(1, this.musicVolume * track.baseVolume),
        ctx.currentTime
      );
    }

    this._synthTimer = setInterval(() => {
      if (this.muted || !this.ctx || this.currentTrackId !== trackId) return;
      this._playSynthStep(trackId, this._synthStep);
      this._synthStep = (this._synthStep + 1) % 64;
      if (this._synthStep === 0 && this.jukeboxMode === 'shuffle') {
        // Every 4 bars in shuffle mode, 25% chance to advance
        if (Math.random() < 0.25) {
          this.nextJukeboxTrack({ fromShuffle: true });
        }
      }
    }, stepMs);
  }

  _playSynthStep(trackId, step) {
    const ctx = this.ctx;
    if (!ctx || !this.musicSynthGain) return;
    const now = ctx.currentTime;
    const s16 = step % 16;

    // 1. Kick Drum on beats 0, 4, 8, 12 (or breakbeat pattern for Cairo Glass)
    const isBreakbeat = trackId === 'cairo_glass_finals';
    const kickHit = isBreakbeat
      ? s16 === 0 || s16 === 6 || s16 === 10
      : s16 % 4 === 0;

    if (kickHit) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.11);
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain).connect(this.musicSynthGain);
      osc.start(now);
      osc.stop(now + 0.15);
    }

    // 2. Snare / Rimshot on 4 and 12
    if (s16 === 4 || s16 === 12) {
      if (this._noiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(isBreakbeat ? 1850 : 1350, now);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        src.connect(bp).connect(gain).connect(this.musicSynthGain);
        src.start(now, 0.1, 0.1);
      }
    }

    // 3. Hi-Hat on 16th notes
    if (this._noiseBuffer && (s16 % 2 === 1 || trackId === 't_zone_cyber')) {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(6500, now);
      const gain = ctx.createGain();
      const accent = s16 % 4 === 2 ? 0.065 : 0.028;
      gain.gain.setValueAtTime(accent, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      src.connect(hp).connect(gain).connect(this.musicSynthGain);
      src.start(now, 0.2, 0.04);
    }

    // 4. Bassline + Lead Arpeggio by track identity
    if (trackId === 'virtua_arcade_95') {
      // Virtua Squash '95: energetic A-minor -> F -> G -> E7 arcade bass & brass lead
      const bassProg = [110, 110, 220, 110, 87.31, 87.31, 174.61, 87.31, 98.0, 98.0, 196.0, 98.0, 82.41, 98.0, 110.0, 123.47];
      const leadProg = [440, 523.25, 659.25, 587.33, 523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 783.99, 880.0, 659.25, 587.33, 523.25, 493.88];
      const bFreq = bassProg[s16];
      if (bFreq) {
        const osc = ctx.createOscillator();
        const flt = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(bFreq, now);
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(920, now);
        flt.frequency.exponentialRampToValueAtTime(240, now + 0.11);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(flt).connect(gain).connect(this.musicSynthGain);
        osc.start(now);
        osc.stop(now + 0.13);
      }
      if (s16 % 2 === 0 || s16 === 7 || s16 === 15) {
        const lFreq = leadProg[s16];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(lFreq, now);
        gain.gain.setValueAtTime(0.065, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain).connect(this.musicSynthGain);
        if (this.reverbSend) gain.connect(this.reverbSend);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } else if (trackId === 't_zone_cyber') {
      // T-Zone Cyber Pulse: D-minor driving electro arp
      const arp = [146.83, 293.66, 349.23, 440.0, 293.66, 349.23, 523.25, 440.0, 130.81, 261.63, 349.23, 392.0, 174.61, 349.23, 440.0, 587.33];
      const freq = arp[s16];
      const osc = ctx.createOscillator();
      const flt = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      flt.type = 'bandpass';
      flt.Q.setValueAtTime(2.4, now);
      flt.frequency.setValueAtTime(600 + (step % 32) * 45, now);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
      osc.connect(flt).connect(gain).connect(this.musicSynthGain);
      osc.start(now);
      osc.stop(now + 0.11);
    } else if (trackId === 'cairo_glass_finals') {
      // Cairo Glass Finals: Phrygian dominant / deep showcourt sub & glass marimba
      const scale = [110.0, 116.54, 138.59, 146.83, 164.81, 174.61, 196.0, 220.0];
      if (s16 === 0 || s16 === 3 || s16 === 6 || s16 === 10 || s16 === 14) {
        const sub = scale[(s16 + Math.floor(step / 16)) % scale.length];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(sub, now);
        gain.gain.setValueAtTime(0.20, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
        osc.connect(gain).connect(this.musicSynthGain);
        osc.start(now);
        osc.stop(now + 0.20);

        // Glass harmonic overtone
        const bell = ctx.createOscillator();
        const bGain = ctx.createGain();
        bell.type = 'sine';
        bell.frequency.setValueAtTime(sub * 4, now);
        bGain.gain.setValueAtTime(0.045, now);
        bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        bell.connect(bGain).connect(this.musicSynthGain);
        if (this.reverbSend) bGain.connect(this.reverbSend);
        bell.start(now);
        bell.stop(now + 0.23);
      }
    }
  }

  _fadeAudio(el, targetVol, durationMs, pauseOnZero = false) {
    if (this._fadeTimers.has(el)) {
      clearInterval(this._fadeTimers.get(el));
    }
    const steps = 12;
    const stepTime = Math.max(16, Math.floor(durationMs / steps));
    const startVol = el.volume;
    let curStep = 0;
    const timer = setInterval(() => {
      curStep++;
      const t = curStep / steps;
      el.volume = Math.max(0, Math.min(1, startVol + (targetVol - startVol) * t));
      if (curStep >= steps) {
        clearInterval(timer);
        this._fadeTimers.delete(el);
        el.volume = Math.max(0, Math.min(1, targetVol));
        if (pauseOnZero && targetVol <= 0.001) {
          el.pause();
        }
      }
    }, stepTime);
    this._fadeTimers.set(el, timer);
  }

  getCurrentTrackInfo() {
    const id = this.currentTrackId || this.desiredTrackId || 'menu_theme';
    const track = LYRIA_TRACKS[id] || LYRIA_TRACKS.menu_theme;
    return {
      ...track,
      muted: this.muted,
      musicVolume: this.musicVolume,
      sfxVolume: this.sfxVolume,
      jukeboxMode: this.jukeboxMode,
      refereeVoiceEnabled: this.refereeVoiceEnabled,
      refereeVoicePitch: this.refereeVoicePitch
    };
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 1, this.ctx.currentTime);
    }
    const curId = this.currentTrackId || this.desiredTrackId;
    const track = LYRIA_TRACKS[curId];
    if (track?.type === 'synth') {
      if (this.muted) {
        this._stopSynthSequencer();
      } else {
        this._startSynthSequencer(curId);
      }
    } else {
      const el = this.audioElements.get(curId);
      if (el && track) {
        if (this.muted) {
          el.volume = 0;
        } else {
          el.volume = Math.min(1, track.baseVolume * this.musicVolume);
          if (el.paused) el.play().catch(() => {});
        }
      }
    }
    this._notifyTrackChange();
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setMusicVolume(vol) {
    this.musicVolume = Math.max(0, Math.min(1, Number(vol)));
    const curId = this.currentTrackId || this.desiredTrackId;
    const track = LYRIA_TRACKS[curId];
    if (this.musicSynthGain && this.ctx && track) {
      this.musicSynthGain.gain.setValueAtTime(
        this.muted ? 0 : Math.min(1, this.musicVolume * track.baseVolume),
        this.ctx.currentTime
      );
    }
    if (!this.muted && curId && track?.type === 'audio') {
      const el = this.audioElements.get(curId);
      if (el) {
        el.volume = Math.min(1, track.baseVolume * this.musicVolume);
      }
    }
    this._notifyTrackChange();
  }

  setSfxVolume(vol) {
    this.sfxVolume = Math.max(0, Math.min(1, Number(vol)));
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
  }

  setRefereeVoiceEnabled(enabled) {
    this.refereeVoiceEnabled = Boolean(enabled);
    if (!this.refereeVoiceEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this._notifyTrackChange();
    return this.refereeVoiceEnabled;
  }

  toggleRefereeVoice() {
    const next = this.setRefereeVoiceEnabled(!this.refereeVoiceEnabled);
    if (next) {
      this.playVoiceCallout('Down! Handout, five-four.', { clearQueue: true, forceReferee: true });
    }
    return next;
  }

  setRefereeVoicePitch(pitch) {
    this.refereeVoicePitch = Math.max(0.5, Math.min(1.2, Number(pitch) || 0.72));
    return this.refereeVoicePitch;
  }

  _updateHudMusicBadge(info) {
    const el = document.getElementById('hud-music-title') || document.getElementById('music-track-label');
    if (el && info) {
      el.textContent = info.muted ? `\u{1F507} ${info.shortTitle || info.title}` : `\u266A ${info.shortTitle || info.title}`;
    }
  }

  // ==========================================================================
  // DEEP MALE REFEREE VOICE & STADIUM PA FORMANT SYNTHESIS
  // ==========================================================================

  /**
   * Plays a subtle low-baritone stadium PA vocal formant cadence so every
   * referee call has physical show-court microphone presence.
   */
  _playRefereeBaritonePA(text = '') {
    const ctx = this._ensureContext();
    if (!ctx || this.muted) return;

    const words = String(text)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    if (!words.length) return;

    const now = ctx.currentTime;
    const basePitchHz = 98 * (this.refereeVoicePitch / 0.72); // Deep ~98Hz male chest fundamental

    words.forEach((w, idx) => {
      const start = now + idx * 0.14;
      const dur = 0.11;
      const isExclaim = w.includes('!') || /down|out|nick|game|welcome|squash/i.test(w);
      const f0 = isExclaim ? basePitchHz * 1.12 : basePitchHz * (idx % 2 === 0 ? 1.0 : 0.88);

      const osc = ctx.createOscillator();
      const formant1 = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.86, start + dur);

      formant1.type = 'bandpass';
      formant1.frequency.setValueAtTime(isExclaim ? 580 : 460, start);
      formant1.Q.setValueAtTime(3.2, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + dur);

      osc.connect(formant1).connect(gain).connect(this.sfxGain);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(start);
      osc.stop(start + dur + 0.01);
    });
  }

  announceScore(text, { delayMs = 0, playChime = true, forceReferee = false } = {}) {
    if (this.muted || !text) return;
    if (!this.refereeVoiceEnabled && !forceReferee) return;

    const raw = String(text).trim();
    const ctx = this._ensureContext();
    if (ctx && playChime) {
      const start = ctx.currentTime + delayMs / 1000;
      const isFault = /down|out|not up/i.test(raw);
      const isMajor = /game|match|welcome|nick/i.test(raw);
      const chord = isFault
        ? [349.23, 293.66] // Authoritative referee low-fourth fault cadence
        : isMajor
          ? [523.25, 659.25, 783.99]
          : [440.0, 554.37];

      chord.forEach((freq, idx) => {
        const t = start + idx * 0.06;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc2.detune.setValueAtTime(8, t);
        osc1.frequency.setValueAtTime(freq, t);
        osc2.frequency.setValueAtTime(freq, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
        osc1.connect(g);
        osc2.connect(g);
        g.connect(this.sfxGain);
        if (this.reverbSend) g.connect(this.reverbSend);
        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.24);
        osc2.stop(t + 0.24);
      });
    }

    this.playVoiceCallout(raw, {
      delayMs,
      clearQueue: delayMs === 0,
      forceReferee
    });
  }

  playVoiceCallout(text, { delayMs = 0, clearQueue = false, forceReferee = false } = {}) {
    if (this.muted || !text) return;
    if (!this.refereeVoiceEnabled && !forceReferee) return;

    const norm = String(text).trim().toLowerCase();
    if (clearQueue && this._voiceTimers.length > 0) {
      this._voiceTimers.forEach((id) => clearTimeout(id));
      this._voiceTimers = [];
    }

    const speakNow = () => {
      if (this.muted) return;
      if (!this.refereeVoiceEnabled && !forceReferee) return;

      let spokenText = String(text);
      if (norm === 'start' || norm === 'match_start') {
        spokenText = this._welcomePlayed
          ? 'Love all. Play!'
          : 'Welcome to Virtual Squash! Love all. Play!';
        this._welcomePlayed = true;
      } else if (norm === 'welcome') {
        spokenText = 'Welcome to Virtual Squash!';
        this._welcomePlayed = true;
      } else if (norm === 'game set and match' || norm === 'game_set_match') {
        spokenText = 'Game and match!';
      } else {
        spokenText = spokenText
          .replace(/\b00\b/g, 'love')
          .replace(/\(Tin\)/gi, '')
          .replace(/\(Two Bounces\)/gi, '')
          .replace(/\(Missed Front Wall\)/gi, '')
          .replace(/•/g, ',')
          .replace(/\s*-\s*/g, ' ');
      }

      this.lastRefereeCallout = spokenText;
      if (typeof this.onRefereeCallout === 'function') {
        this.onRefereeCallout(spokenText);
      }

      // Play subtle baritone PA backing resonance
      this._playRefereeBaritonePA(spokenText);

      // Speak with Deep Male Referee SpeechSynthesis voice
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(spokenText);
          const maleVoice = this._cachedMaleVoice || this._selectDeepMaleVoice();
          if (maleVoice) {
            this._cachedMaleVoice = maleVoice;
            utter.voice = maleVoice;
          }
          utter.lang = maleVoice?.lang || 'en-GB';
          utter.pitch = this.refereeVoicePitch; // Deep male baritone (default 0.72)
          utter.rate = this.refereeVoiceRate;   // Measured referee cadence (default 0.95)
          utter.volume = Math.min(1, this.sfxVolume * 0.98);
          window.speechSynthesis.speak(utter);
        } catch {}
      }
    };

    if (delayMs > 0) {
      const timer = setTimeout(speakNow, delayMs);
      this._voiceTimers.push(timer);
    } else {
      speakNow();
    }
  }

  // ==========================================================================
  // COURT & RACKET SOUND EFFECTS
  // ==========================================================================

  playSwingWhoosh(speed = 1) {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx || !this._pinkNoiseBuffer) return;
    const now = ctx.currentTime;
    const spd = Math.max(0.6, Math.min(1.8, Number(speed || 1)));
    const dur = 0.16;

    const src = ctx.createBufferSource();
    src.buffer = this._pinkNoiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(1.6, now);
    bp.frequency.setValueAtTime(320 * spd, now);
    bp.frequency.exponentialRampToValueAtTime(1380 * spd, now + dur * 0.55);
    bp.frequency.exponentialRampToValueAtTime(420, now + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.11 * Math.min(1.2, spd), now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(bp).connect(g).connect(this.sfxGain);
    src.start(now, Math.random() * 0.5, dur + 0.02);

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(175 * spd, now);
    osc.frequency.exponentialRampToValueAtTime(92, now + dur);
    og.gain.setValueAtTime(0.001, now);
    og.gain.linearRampToValueAtTime(0.055, now + 0.02);
    og.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(og).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  playRacketHit(shotType = 'topspin', quality = 'good') {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx || !this._noiseBuffer) return;
    const now = ctx.currentTime;
    const st = String(shotType || 'topspin').toLowerCase();
    const isKill = st === 'smash' || st === 'power_smash';
    const isSweet = quality === 'perfect' || quality === 'sweet_spot' || isKill;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(st === 'slice' ? 3600 : 2450, now);
    bp.Q.setValueAtTime(1.75, now);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.001, now);
    ng.gain.linearRampToValueAtTime(isKill ? 0.14 : 0.1, now + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
    src.connect(bp).connect(ng).connect(this.sfxGain);
    src.start(now, Math.random() * 0.5, 0.035);

    let fStart = 320, fEnd = 132, dur = 0.14;
    if (st === 'slice') {
      fStart = 460; fEnd = 185; dur = 0.16;
    } else if (st === 'lob') {
      fStart = 250; fEnd = 165; dur = 0.19;
    } else if (isKill) {
      fStart = 395; fEnd = 98; dur = 0.21;
    }

    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'triangle';
    o2.type = 'sine';
    o2.detune.setValueAtTime(12, now);
    o1.frequency.setValueAtTime(fStart, now);
    o1.frequency.exponentialRampToValueAtTime(fEnd, now + dur);
    o2.frequency.setValueAtTime(fStart * 1.5, now);
    o2.frequency.exponentialRampToValueAtTime(fEnd, now + dur * 0.85);

    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.001, now);
    tg.gain.linearRampToValueAtTime(isKill ? 0.13 : 0.095, now + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o1.connect(tg);
    o2.connect(tg);
    tg.connect(this.sfxGain);
    if (this.reverbSend) tg.connect(this.reverbSend);
    o1.start(now);
    o2.start(now);
    o1.stop(now + dur + 0.01);
    o2.stop(now + dur + 0.01);

    if (isSweet) {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const t = now + idx * 0.026;
        const c1 = ctx.createOscillator();
        const c2 = ctx.createOscillator();
        c1.type = 'sine';
        c2.type = 'triangle';
        c2.detune.setValueAtTime(10, t);
        c1.frequency.setValueAtTime(freq, t);
        c2.frequency.setValueAtTime(freq, t);
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0.001, t);
        cg.gain.linearRampToValueAtTime(0.048, t + 0.006);
        cg.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
        c1.connect(cg);
        c2.connect(cg);
        cg.connect(this.sfxGain);
        if (this.reverbSend) cg.connect(this.reverbSend);
        c1.start(t);
        c2.start(t);
        c1.stop(t + 0.25);
        c2.stop(t + 0.25);
      });
    }
  }

  playBallBounce(intensity = 1) {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const amp = Math.max(0.4, Math.min(1.2, Number(intensity || 1)));
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.095);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.11 * amp, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.11);

    if (this._pinkNoiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this._pinkNoiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(950, now);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.001, now);
      ng.gain.linearRampToValueAtTime(0.045 * amp, now + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      src.connect(lp).connect(ng).connect(this.sfxGain);
      src.start(now, Math.random() * 0.4, 0.05);
    }
  }

  playServeToss() {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.22;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sine';
    o2.type = 'sine';
    o2.detune.setValueAtTime(9, now);
    o1.frequency.setValueAtTime(290, now);
    o1.frequency.exponentialRampToValueAtTime(680, now + dur);
    o2.frequency.setValueAtTime(290, now);
    o2.frequency.exponentialRampToValueAtTime(680, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.075, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o1.connect(g);
    o2.connect(g);
    g.connect(this.sfxGain);
    o1.start(now);
    o2.start(now);
    o1.stop(now + dur + 0.01);
    o2.stop(now + dur + 0.01);
  }

  playCrowdReaction(type = 'cheer') {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx || !this._pinkNoiseBuffer) return;
    const now = ctx.currentTime;
    const kind = String(type || 'cheer').toLowerCase();

    if (kind === 'gasp' || kind === 'ooh') {
      const src = ctx.createBufferSource();
      src.buffer = this._pinkNoiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.setValueAtTime(2.4, now);
      bp.frequency.setValueAtTime(720, now);
      bp.frequency.exponentialRampToValueAtTime(410, now + 0.55);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      src.connect(bp).connect(g).connect(this.sfxGain);
      if (this.reverbSend) g.connect(this.reverbSend);
      src.start(now, 0, 0.6);
      return;
    }

    const dur = kind === 'polite_clap' ? 0.85 : 1.35;
    const src = ctx.createBufferSource();
    src.buffer = this._pinkNoiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(1.1, now);
    bp.frequency.setValueAtTime(650, now);
    bp.frequency.exponentialRampToValueAtTime(1250, now + dur * 0.35);
    bp.frequency.exponentialRampToValueAtTime(780, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(kind === 'polite_clap' ? 0.075 : 0.115, now + 0.14);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(bp).connect(g).connect(this.sfxGain);
    if (this.reverbSend) g.connect(this.reverbSend);
    src.start(now, 0, dur + 0.05);
  }

  playUiClick() {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.045);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.05, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(g).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  playWallHit(surface = 'front_wall', speedRatio = 1) {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const amp = Math.max(0.35, Math.min(1.5, Number(speedRatio || 1)));
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    const f0 = surface === 'back_wall' ? 185 : surface === 'front_wall' ? 152 : 168;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.085);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.14 * amp, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g).connect(this.sfxGain);
    if (this.reverbSend) g.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.095);

    if (this._pinkNoiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this._pinkNoiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(surface === 'back_wall' ? 1450 : 1150, now);
      bp.Q.setValueAtTime(1.8, now);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.001, now);
      ng.gain.linearRampToValueAtTime(0.065 * amp, now + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      src.connect(bp).connect(ng).connect(this.sfxGain);
      src.start(now, Math.random() * 0.4, 0.05);
    }
  }

  playTinClank() {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [420, 785, 1190].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'square';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.82, now + 0.24);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(idx === 0 ? 0.11 : 0.045, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(g).connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.26);
    });
  }

  playNickRoll() {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(68, now + 0.055);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.095, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(g).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  playShoeSqueak() {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2450 + Math.random() * 380, now);
    osc.frequency.exponentialRampToValueAtTime(1950, now + 0.065);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.022, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(g).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.075);
  }
}

export default AudioEngine;
