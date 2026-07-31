// Audio engine: Web Audio context, sample playback, BPM value.
// No scheduling yet — Stage 1 is plain one-shot playback of a single sample.
// Loaded as a classic script (works over file:// too, no ES module needed).

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bpm = 124;
    this.sampleBuffer = null;
    this.sampleName = null;
    this.source = null;
    this.isPlaying = false;
    // Called whenever playing state changes (play/stop/ended).
    this.onStateChange = null;
  }

  get hasSample() {
    return this.sampleBuffer !== null;
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
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  async loadSample(file) {
    const ctx = this.ensureContext();
    const data = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    this.stop();
    this.sampleBuffer = buffer;
    this.sampleName = file.name;
    return buffer;
  }

  // Start playing the loaded sample. If a sample is already playing,
  // it is restarted from the beginning.
  play() {
    if (!this.ensureContext() || !this.sampleBuffer) return;
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.sampleBuffer;
    src.connect(this.master);
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        this.isPlaying = false;
        if (this.onStateChange) this.onStateChange();
      }
    };
    src.start();
    this.source = src;
    this.isPlaying = true;
    if (this.onStateChange) this.onStateChange();
  }

  stop() {
    if (this.source) {
      const src = this.source;
      this.source = null;
      src.onended = null;
      try {
        src.stop();
      } catch (err) {
        // Source already stopped.
      }
      src.disconnect();
      this.isPlaying = false;
      if (this.onStateChange) this.onStateChange();
    }
  }

  setBpm(value) {
    this.bpm = value;
  }
}

window.AudioEngine = AudioEngine;
