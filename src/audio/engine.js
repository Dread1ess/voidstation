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
      { name: 'Kick',   sample: null, sampleData: null, sampleName: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'sine', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 } },
      { name: 'Snare',  sample: null, sampleData: null, sampleName: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'noise', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 } },
      { name: 'Bass',   sample: null, sampleData: null, sampleName: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'sawtooth', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 } },
      { name: 'Synth',  sample: null, sampleData: null, sampleName: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'square', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 } },
      { name: 'Pads',   sample: null, sampleData: null, sampleName: null, gain: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'triangle', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 } },
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
    // 24 pitch rows (0..23, 0 = B4/MIDI 71, 23 = C3/MIDI 48) x 16 steps.
    // Each cell holds the note length in steps (0 = no note). The note is
    // triggered at its head cell only; the tail is visual.
    return Array.from({ length: 24 }, () => new Array(16).fill(0));
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  playSynthNote(trackIndex, midiNote, time = null, duration = 0.2) {
    if (!this.ensureContext()) return;
    const track = this.tracks[trackIndex];
    if (!track) return;

    const ctxTime = time !== null ? time : this.ctx.currentTime;
    const adsr = track.adsr || { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 };
    const peak = 0.25;
    const noteEnd = ctxTime + Math.max(0.05, duration);
    const releaseStart = noteEnd;
    const releaseEnd = releaseStart + Math.max(0.02, adsr.release);

    let source;
    if (track.synthType === 'noise') {
      // White noise buffer (2s, cached per track)
      if (!track._noiseBuffer) {
        const len = this.ctx.sampleRate * 2;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        track._noiseBuffer = buf;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = track._noiseBuffer;
      src.loop = true;
      source = src;
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = track.synthType || 'sawtooth';
      osc.frequency.setValueAtTime(this.midiToFreq(midiNote), ctxTime);
      source = osc;
    }

    const env = this.ctx.createGain();

    // ADSR envelope
    env.gain.setValueAtTime(0.0001, ctxTime);
    env.gain.linearRampToValueAtTime(peak, ctxTime + Math.max(0.001, adsr.attack));
    env.gain.linearRampToValueAtTime(peak * adsr.sustain, ctxTime + Math.max(0.001, adsr.attack) + Math.max(0.001, adsr.decay));
    // Hold at sustain until note end, then release
    env.gain.setValueAtTime(peak * adsr.sustain, releaseStart);
    env.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    source.connect(env);
    env.connect(track.gain);

    source.start(ctxTime);
    source.stop(releaseEnd + 0.05);
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
    track.sampleData = data;
    track.sampleName = file.name;
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
      for (let pitch = 0; pitch < 24; pitch++) {
        const lengthSteps = track.pianoGrid[pitch][step];
        if (lengthSteps) {
          // pitch 0 = B4 (MIDI 71), pitch 23 = C3 (MIDI 48)
          const midi = 71 - pitch;
          const noteDuration = this.stepDuration * lengthSteps * 0.85;
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

  // --- Project serialization (localStorage) ---

  // Convert an ArrayBuffer to a base64 string (chunked to avoid call stack limits)
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB chunks
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  _base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // Return a plain JSON-serializable snapshot of the whole project.
  // Note: sample data is stored as base64 inside the snapshot (may be large).
  serialize() {
    return {
      version: 1,
      bpm: this.bpm,
      tracks: this.tracks.map((t) => ({
        name: t.name,
        sampleName: t.sampleName,
        sampleData: t.sampleData ? this._arrayBufferToBase64(t.sampleData) : null,
        pattern: [...t.pattern],
        pianoGrid: t.pianoGrid.map((row) => [...row]),
        volume: t.volume,
        mute: t.mute,
        solo: t.solo,
        synthType: t.synthType,
        adsr: { ...t.adsr },
      })),
    };
  }

  // Restore a project from a serialized snapshot (async because it decodes audio).
  async deserialize(state) {
    if (!state || !Array.isArray(state.tracks)) throw new Error('Invalid project data');

    this.stopTransport();
    this.bpm = state.bpm || 124;
    this._updateStepDuration();

    for (let i = 0; i < this.tracks.length; i++) {
      const saved = state.tracks[i];
      if (!saved) continue;
      const track = this.tracks[i];
      track.name = saved.name || track.name;
      track.sampleName = saved.sampleName || null;
      track.pattern = Array.isArray(saved.pattern) ? [...saved.pattern] : new Array(16).fill(false);
      track.volume = saved.volume !== undefined ? saved.volume : 1;
      track.mute = !!saved.mute;
      track.solo = !!saved.solo;
      track.synthType = saved.synthType || 'sine';
      if (saved.adsr && typeof saved.adsr === 'object') {
        track.adsr = {
          attack: saved.adsr.attack !== undefined ? saved.adsr.attack : track.adsr.attack,
          decay: saved.adsr.decay !== undefined ? saved.adsr.decay : track.adsr.decay,
          sustain: saved.adsr.sustain !== undefined ? saved.adsr.sustain : track.adsr.sustain,
          release: saved.adsr.release !== undefined ? saved.adsr.release : track.adsr.release,
        };
      }
      if (Array.isArray(saved.pianoGrid)) {
        for (let p = 0; p < 24; p++) {
          for (let s = 0; s < 16; s++) {
            // Keep numeric length (0 = empty). Old saves stored booleans.
            const v = saved.pianoGrid[p] && saved.pianoGrid[p][s];
            track.pianoGrid[p][s] = v ? (typeof v === 'number' ? v : 1) : 0;
          }
        }
      }
      // Restore sample data (decode base64 -> AudioBuffer)
      track.sample = null;
      track.sampleData = null;
      if (saved.sampleData) {
        try {
          const data = this._base64ToArrayBuffer(saved.sampleData);
          const buffer = await this.ensureContext().decodeAudioData(data);
          track.sample = buffer;
          track.sampleData = data;
        } catch (err) {
          console.warn(`Failed to decode saved sample for track ${i}:`, err);
          track.sample = null;
          track.sampleData = null;
        }
      }
    }

    this._rebuildAllGains();
    this._notifyStateChange();
  }

  // Reset all tracks to a blank project (keeps gain nodes / context).
  clearProject() {
    this.stopTransport();
    this.bpm = 124;
    this._updateStepDuration();
    this.tracks.forEach((t, i) => {
      const defaults = [
        { name: 'Kick', synthType: 'sine' },
        { name: 'Snare', synthType: 'noise' },
        { name: 'Bass', synthType: 'sawtooth' },
        { name: 'Synth', synthType: 'square' },
        { name: 'Pads', synthType: 'triangle' },
      ][i];
      t.name = defaults.name;
      t.synthType = defaults.synthType;
      t.adsr = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 };
      t.sample = null;
      t.sampleData = null;
      t.sampleName = null;
      t.pattern = new Array(16).fill(false);
      t.pianoGrid = this._createPianoGrid();
      t.volume = 1;
      t.mute = false;
      t.solo = false;
    });
    this._rebuildAllGains();
    this._notifyStateChange();
  }
}

window.AudioEngine = AudioEngine;