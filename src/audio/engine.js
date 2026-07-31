// Audio engine: Web Audio context, transport, step sequencing.
// Classic script (works over file:// too, no ES module needed).

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bpm = 124;
    this.isPlaying = false;
    this._stateListeners = [];
    this._stepListeners = [];

    // Transport state
    this.transportTime = 0;          // current position in seconds
    this.nextStepTime = 0;           // when next step is due
    this.schedulerInterval = null;   // setInterval handle
    this.lookahead = 0.1;            // schedule 100ms ahead
    this.scheduleInterval = 25;      // scheduler tick every 25ms

    // Tracks: each track has sample, gain, pattern (16 steps), pianoGrid (24x16), mute/solo/volume
    this.tracks = [
      { name: 'Kick',   sample: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'sine' },
      { name: 'Snare',  sample: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'noise' },
      { name: 'Bass',   sample: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'sawtooth' },
      { name: 'Synth',  sample: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'square' },
      { name: 'Pads',   sample: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'triangle' },
    ];
    this.trackCount = 5;
    this._activeTrackCount = 5;
    this.stepsPerBar = 16;
    this.stepIndex = 0;
    this.stepDuration = 0; // seconds per step, computed from BPM
  }

  onStateChange(listener) {
    this._stateListeners.push(listener);
  }

  onStepChange(listener) {
    this._stepListeners.push(listener);
  }

  _notifyStateChange() {
    this._stateListeners.forEach(l => l());
  }

  _notifyStepChange() {
    this._stepListeners.forEach(l => l());
  }

  _createPianoGrid() {
    // 24 pitch rows (0..23, 0 = B4/MIDI 71, 23 = C3/MIDI 48) x 16 steps
    return Array.from({ length: 24 }, () => new Array(16).fill(false));
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  playSynthNote(trackIndex, midiNote, time = null, duration = 0.2) {
    if (!this.ensureContext()) return;
    const track = this.tracks[trackIndex];
    if (!track) return;

    const ctxTime = time !== null ? time : this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = track.synthType || 'sawtooth';
    osc.frequency.setValueAtTime(this.midiToFreq(midiNote), ctxTime);

    // Envelope (Attack - Release)
    env.gain.setValueAtTime(0.0001, ctxTime);
    env.gain.linearRampToValueAtTime(0.25, ctxTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, ctxTime + Math.max(0.05, duration));

    osc.connect(env);
    env.connect(track.gain);

    osc.start(ctxTime);
    osc.stop(ctxTime + Math.max(0.05, duration) + 0.05);
  }

  get hasSample() {
    return this.tracks.some(t => t.sample !== null);
  }

  get hasContent() {
    return this.tracks.some(t =>
      t.sample !== null ||
      (t.pianoGrid && t.pianoGrid.some(row => row.some(active => active)))
    );
  }

  // Lazily create the context. Must be called from a user gesture
  // (or a promise chain started by one) so the browser allows audio.
  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      // Create per-track gain nodes
      this.tracks.forEach(t => {
        t.gain = this.ctx.createGain();
        t.gain.gain.value = t.volume;
        t.gain.connect(this.master);
      });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Load a sample into a specific track (0 or 1)
  async loadSample(file, trackIndex = 0) {
    const ctx = this.ensureContext();
    const data = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    const track = this.tracks[trackIndex];
    track.sample = buffer;
    track.name = file.name.replace(/\.[^.]+$/, '');
    return buffer;
  }

  // Set pattern for a track (array of 16 booleans)
  setPattern(trackIndex, pattern) {
    const track = this.tracks[trackIndex];
    if (track && pattern.length === 16) {
      track.pattern = [...pattern];
    }
  }

  // Toggle a single step
  toggleStep(trackIndex, stepIndex) {
    const track = this.tracks[trackIndex];
    if (track && stepIndex >= 0 && stepIndex < 16) {
      track.pattern[stepIndex] = !track.pattern[stepIndex];
    }
  }

  // Set track volume (0..1)
  setTrackVolume(trackIndex, volume) {
    const track = this.tracks[trackIndex];
    if (track) {
      track.volume = Math.max(0, Math.min(1, volume));
      // Don't override gain here if mute/solo logic overrides it;
      // setGainByRouting() handles the actual routing value.
      this._rebuildGain(trackIndex);
    }
  }

  // Rebuild a track's effective gain considering volume + mute + solo
  _rebuildGain(trackIndex) {
    const track = this.tracks[trackIndex];
    if (!track || !track.gain) return;
    const anySolo = this.tracks.some(t => t.solo);
    let effective = track.volume;
    if (anySolo && !track.solo) effective = 0;
    if (track.mute) effective = 0;
    track.gain.gain.value = effective;
  }

  // Global solo refresh (call after any toggleMute/toggleSolo)
  _rebuildAllGains() {
    this.tracks.forEach((_, i) => this._rebuildGain(i));
  }

  toggleMute(trackIndex) {
    const track = this.tracks[trackIndex];
    if (track) {
      track.mute = !track.mute;
      this._rebuildGain(trackIndex);
    }
  }

  toggleSolo(trackIndex) {
    const track = this.tracks[trackIndex];
    if (track) {
      track.solo = !track.solo;
      this._rebuildAllGains();
    }
  }

  // Compute step duration from BPM (16 steps per bar, 4 beats per bar)
  _updateStepDuration() {
    const beatsPerMinute = this.bpm;
    const secondsPerBeat = 60 / beatsPerMinute;
    const secondsPerBar = secondsPerBeat * 4;
    this.stepDuration = secondsPerBar / this.stepsPerBar;
  }

  setBpm(value) {
    this.bpm = value;
    this._updateStepDuration();
  }

  // Play a single sample on a track immediately (for preview)
  playSample(trackIndex) {
    if (!this.ensureContext()) return;
    const track = this.tracks[trackIndex];
    if (!track.sample) return;
    const src = this.ctx.createBufferSource();
    src.buffer = track.sample;
    src.connect(track.gain);
    src.start();
  }

  // --- Transport with lookahead scheduling ---

  _scheduleStep(time, trackIndex) {
    const track = this.tracks[trackIndex];
    if (!track) return;

    // Mute/solo routing
    const anySolo = this.tracks.some(t => t.solo);
    if (anySolo && !track.solo) return;  // solo active, skip non-soloed tracks
    if (track.mute) return;                 // muted tracks silent regardless

    // 1) Sample playback (if sample loaded and pattern step active)
    if (track.sample && track.pattern[this.stepIndex]) {
      const src = this.ctx.createBufferSource();
      src.buffer = track.sample;
      src.connect(track.gain);
      src.start(time);
    }

    // 2) Synth note playback (if piano grid has notes on this step)
    if (track.pianoGrid) {
      const step = this.stepIndex;
      const noteDuration = this.stepDuration * 0.85;
      for (let pitch = 0; pitch < 24; pitch++) {
        if (track.pianoGrid[pitch][step]) {
          // pitch 0 = B4 (MIDI 71), pitch 23 = C3 (MIDI 48)
          const midi = 71 - pitch;
          this.playSynthNote(trackIndex, midi, time, noteDuration);
        }
      }
    }
  }

  _schedulerTick() {
    if (!this.isPlaying || !this.ctx) return;

    const now = this.ctx.currentTime;
    // Schedule all steps that fall within the lookahead window
    while (this.nextStepTime < now + this.lookahead) {
      // Schedule this step for all tracks
      this.tracks.forEach((_, i) => this._scheduleStep(this.nextStepTime, i));
      // Advance
      this.nextStepTime += this.stepDuration;
      this.stepIndex = (this.stepIndex + 1) % this.stepsPerBar;
      this._notifyStepChange();
    }
  }

  startTransport() {
    if (!this.ensureContext() || this.isPlaying) return;
    this._updateStepDuration();
    this.isPlaying = true;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.005; // tiny offset
    this._notifyStateChange();
    // Scheduler loop
    this.schedulerInterval = setInterval(() => this._schedulerTick(), this.scheduleInterval);
  }

  stopTransport() {
    this.isPlaying = false;
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    this.transportTime = 0;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this._notifyStateChange();
  }

  // Stop everything (transport + any one-shots)
  stop() {
    this.stopTransport();
  }
}

window.AudioEngine = AudioEngine;