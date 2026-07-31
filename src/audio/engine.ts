// Audio engine: Web Audio context, transport, step sequencing, patterns.
// ESM module. Exposes the class via export; also kept on window during the
// migration so the classic entry (main.js) can still construct it.

import type { Track, Pattern, PatternTrackData, WaveformType, AdsrParams, ProjectState, TrackSettings } from '../types.js';

// Project shape that deserialize() accepts: v2 (current) plus the old v1
// shape that kept pattern/pianoGrid directly on the track entries.
interface SavedTrack extends TrackSettings {
  pattern?: boolean[];
  pianoGrid?: unknown;
}
interface SavedProject extends ProjectState {
  tracks: SavedTrack[];
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  bpm = 124;
  isPlaying = false;
  private _stateListeners: (() => void)[] = [];
  private _stepListeners: (() => void)[] = [];
  private _patternListeners: (() => void)[] = [];

  // Transport state
  transportTime = 0;          // current position in seconds
  nextStepTime = 0;           // when next step is due
  schedulerInterval: number | null = null;   // setInterval handle
  lookahead = 0.1;            // schedule 100ms ahead
  scheduleInterval = 25;      // scheduler tick every 25ms

  // Tracks: each track has sample, gain, panner, pattern (16 steps), pianoGrid (24x16), mute/solo/volume/pan
  tracks: Track[] = [
    { name: 'Kick',   sample: null, sampleData: null, sampleName: null, gain: null, panner: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'sine', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Snare',  sample: null, sampleData: null, sampleName: null, gain: null, panner: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'noise', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Bass',   sample: null, sampleData: null, sampleName: null, gain: null, panner: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'sawtooth', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Synth',  sample: null, sampleData: null, sampleName: null, gain: null, panner: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'square', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Pads',   sample: null, sampleData: null, sampleName: null, gain: null, panner: null, pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), volume: 1.0, mute: false, solo: false, synthType: 'triangle', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
  ];
  trackCount = 5;
  _activeTrackCount = 5;
  stepsPerBar = 16;
  stepIndex = 0;
  totalSteps = 0;
  stepDuration = 0; // seconds per step, computed from BPM

  // Patterns & playlist (FL-style). Each pattern stores per-track
  // step/note data. tracks[i].pattern / tracks[i].pianoGrid are the live
  // references to the CURRENT pattern, so editing stays in-place.
  patterns: Pattern[] = [
    { name: 'Pattern 1', tracks: this.tracks.map(() => ({ pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid() })) },
  ];
  currentPatternIndex = 0;
  playlist: (number | undefined)[] = []; // bar index -> pattern index; [] = play active pattern
  // Loop region (in bars). Playback and offline export wrap within
  // [loopStart, loopEnd). loopEnd = 0 means "auto: the whole playlist",
  // so an untouched project keeps the legacy wrap-everything behaviour.
  loopStart = 0;
  loopEnd = 0;
  loopEnabled = true;

  constructor() {
    this._loadPatternIntoLive(0);
  }

  // --- Patterns / playlist ---

  onPatternChange(listener: () => void) {
    this._patternListeners.push(listener);
  }

  _notifyPatternChange() {
    this._patternListeners.forEach(l => l());
  }

  // Point the live track references at a given pattern's data.
  _loadPatternIntoLive(index: number) {
    const pat = this.patterns[index];
    if (!pat) return;
    this.tracks.forEach((t, i) => {
      t.pattern = pat.tracks[i].pattern;
      t.pianoGrid = pat.tracks[i].pianoGrid;
    });
  }

  switchPattern(index: number) {
    if (!this.patterns[index]) return;
    this.currentPatternIndex = index;
    this._loadPatternIntoLive(index);
    this._notifyPatternChange();
  }

  addPattern(name?: string): Pattern {
    const tpl = this.patterns[this.currentPatternIndex];
    const newPat: Pattern = {
      name: name || `Pattern ${this.patterns.length + 1}`,
      tracks: tpl.tracks.map(t => ({ pattern: [...t.pattern], pianoGrid: t.pianoGrid.map(r => [...r]) })),
    };
    this.patterns.push(newPat);
    this.currentPatternIndex = this.patterns.length - 1;
    this._loadPatternIntoLive(this.currentPatternIndex);
    this._notifyPatternChange();
    return newPat;
  }

  duplicatePattern(): Pattern {
    return this.addPattern(this.patterns[this.currentPatternIndex].name + ' copy');
  }

  deletePattern(index: number) {
    if (this.patterns.length <= 1 || !this.patterns[index]) return;
    this.patterns.splice(index, 1);
    if (this.currentPatternIndex >= this.patterns.length) {
      this.currentPatternIndex = this.patterns.length - 1;
    }
    // Fix playlist references: the deleted pattern's slots become empty,
    // references after it shift down by one.
    this.playlist = this.playlist
      .map(p => (p === undefined ? undefined : p === index ? undefined : p > index ? p - 1 : p))
      .filter(p => p !== undefined);
    this._loadPatternIntoLive(this.currentPatternIndex);
    this._notifyPatternChange();
  }

  setPlaylistCell(bar: number, patternIndex?: number) {
    if (bar < 0) return;
    if (patternIndex === undefined || patternIndex < 0) {
      delete this.playlist[bar];
    } else if (this.patterns[patternIndex]) {
      this.playlist[bar] = patternIndex;
      // Assigning a clip beyond the loop point extends the loop (FL-style).
      if (this.loopEnabled && bar + 1 > this.loopEnd) this.loopEnd = bar + 1;
    }
    this._notifyPatternChange();
  }

  // Effective loop end: explicit loopEnd, or the whole playlist when the
  // region is untouched (loopEnd <= loopStart).
  _effectiveLoopEnd(): number {
    return this.loopEnd > this.loopStart ? this.loopEnd : Math.max(0, this.playlist.length);
  }

  // Map an absolute bar counter to the bar that actually plays, honoring the
  // loop region. Playback starts at loopStart, wraps within [loopStart, end).
  // When looping is disabled the whole playlist is played straight through.
  _barInLoop(absBar: number): number {
    const base = this.loopEnabled ? this.loopStart : 0;
    const end = this.loopEnabled ? this._effectiveLoopEnd() : this.playlist.length;
    const len = Math.max(1, end - base);
    return base + ((absBar % len) + len) % len;
  }

  setLoopRegion(start: number, end: number) {
    this.loopStart = Math.max(0, Math.min(start, Math.max(0, end - 1)));
    this.loopEnd = Math.max(this.loopStart + 1, end);
    this._notifyPatternChange();
  }

  toggleLoop() {
    this.loopEnabled = !this.loopEnabled;
    this._notifyPatternChange();
  }

  getPlaylistLength() {
    return this.playlist.length;
  }

  // Data source for a track at a given bar while following the playlist.
  // Empty playlist => the live (active) pattern.
  _stepSourceForBar(trackIndex: number, bar: number): PatternTrackData | null {
    if (this.playlist.length > 0) {
      const patIdx = this.playlist[bar];
      const pat = patIdx !== undefined ? this.patterns[patIdx] : null;
      if (pat && pat.tracks[trackIndex]) return pat.tracks[trackIndex];
      return null; // empty arrangement slot -> silence
    }
    return this.tracks[trackIndex]; // live references == current pattern
  }

  // Data source for a track while scheduling. Follows the playlist (loop
  // region aware) when an arrangement is set; otherwise falls back to the
  // live (active) pattern.
  _stepSourceFor(trackIndex: number): PatternTrackData | null {
    if (this.playlist.length > 0 && this.isPlaying) {
      const absBar = Math.floor(this.totalSteps / this.stepsPerBar);
      return this._stepSourceForBar(trackIndex, this._barInLoop(absBar));
    }
    return this.tracks[trackIndex]; // live references == current pattern
  }

  onStateChange(listener: () => void) {
    this._stateListeners.push(listener);
  }

  onStepChange(listener: () => void) {
    this._stepListeners.push(listener);
  }

  _notifyStateChange() {
    this._stateListeners.forEach(l => l());
  }

  _notifyStepChange() {
    this._stepListeners.forEach(l => l());
  }

  _createPianoGrid(): number[][] {
    // 24 pitch rows (0..23, 0 = B4/MIDI 71, 23 = C3/MIDI 48) x 16 steps.
    // Each cell holds the note length in steps (0 = no note). The note is
    // triggered at its head cell only; the tail is visual.
    return Array.from({ length: 24 }, () => new Array(16).fill(0));
  }

  midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  playSynthNote(trackIndex: number, midiNote: number, time: number | null = null, duration = 0.2) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const track = this.tracks[trackIndex];
    if (!track || !track.gain) return;
    const ctxTime = time !== null ? time : ctx.currentTime;
    this._buildSynthVoice(ctx, track, track.gain, midiNote, ctxTime, duration);
  }

  // Build a synth voice (oscillator / noise + ADSR envelope) in the given
  // context and connect it to destGain. Shared by live playback and the
  // offline renderer so exported audio matches what's heard.
  private _buildSynthVoice(
    ctx: BaseAudioContext,
    track: Track,
    destGain: GainNode,
    midiNote: number,
    time: number,
    duration: number
  ) {
    const adsr: AdsrParams = track.adsr;
    const peak = 0.25;
    const noteEnd = time + Math.max(0.05, duration);
    const releaseStart = noteEnd;
    const releaseEnd = releaseStart + Math.max(0.02, adsr.release);

    let source: AudioBufferSourceNode | OscillatorNode;
    if (track.synthType === 'noise') {
      // White noise buffer (2s, cached per track)
      if (!track.noiseBuffer) {
        const len = Math.round(ctx.sampleRate * 2);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        track.noiseBuffer = buf;
      }
      const src = ctx.createBufferSource();
      src.buffer = track.noiseBuffer;
      src.loop = true;
      source = src;
    } else {
      const osc = ctx.createOscillator();
      osc.type = track.synthType; // narrowed to OscillatorType-compatible waveforms
      osc.frequency.setValueAtTime(this.midiToFreq(midiNote), time);
      source = osc;
    }

    const env = ctx.createGain();

    // ADSR envelope
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + Math.max(0.001, adsr.attack));
    env.gain.linearRampToValueAtTime(peak * adsr.sustain, time + Math.max(0.001, adsr.attack) + Math.max(0.001, adsr.decay));
    // Hold at sustain until note end, then release
    env.gain.setValueAtTime(peak * adsr.sustain, releaseStart);
    env.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    source.connect(env);
    env.connect(destGain);

    source.start(time);
    source.stop(releaseEnd + 0.05);
  }

  get hasSample() {
    return this.tracks.some(t => t.sample !== null);
  }

  get hasContent() {
    return this.patterns.some(p =>
      p.tracks.some(t =>
        t.pattern.some(Boolean) ||
        (t.pianoGrid && t.pianoGrid.some(row => row.some(active => active)))
      )
    ) || this.hasSample;
  }

  // Lazily create the context. Must be called from a user gesture
  // (or a promise chain started by one) so the browser allows audio.
  ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctx: typeof AudioContext = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      // Create per-track gain + pan nodes
      this.tracks.forEach(t => {
        t.gain = this.ctx!.createGain();
        t.gain!.gain.value = t.volume;
        t.panner = this.ctx!.createStereoPanner();
        t.panner.pan.value = t.pan;
        t.gain!.connect(t.panner);
        t.panner.connect(this.master!);
      });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Load a sample into a specific track
  async loadSample(file: File, trackIndex = 0): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    if (!ctx) throw new Error('Web Audio not available');
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
  setPattern(trackIndex: number, pattern: boolean[]) {
    const track = this.tracks[trackIndex];
    if (track && pattern && pattern.length === 16) {
      // Write in place so the live reference stays linked to the pattern
      track.pattern.splice(0, 16, ...pattern);
    }
  }

  // Toggle a single step
  toggleStep(trackIndex: number, stepIndex: number) {
    const track = this.tracks[trackIndex];
    if (track && stepIndex >= 0 && stepIndex < 16) {
      track.pattern[stepIndex] = !track.pattern[stepIndex];
    }
  }

  // Set track volume (0..1)
  setTrackVolume(trackIndex: number, volume: number) {
    const track = this.tracks[trackIndex];
    if (track) {
      track.volume = Math.max(0, Math.min(1, volume));
      this._rebuildGain(trackIndex);
    }
  }

  // Set track pan (-1..1, left..right)
  setTrackPan(trackIndex: number, pan: number) {
    const track = this.tracks[trackIndex];
    if (!track) return;
    track.pan = Math.max(-1, Math.min(1, pan));
    if (track.panner) track.panner.pan.value = track.pan;
  }

  // Effective per-track gain: volume, scaled by mute/solo routing.
  private _effectiveVolume(trackIndex: number): number {
    const track = this.tracks[trackIndex];
    if (!track) return 0;
    const anySolo = this.tracks.some(t => t.solo);
    let effective = track.volume;
    if (anySolo && !track.solo) effective = 0;
    if (track.mute) effective = 0;
    return effective;
  }

  // Rebuild a track's effective gain considering volume + mute + solo
  _rebuildGain(trackIndex: number) {
    const track = this.tracks[trackIndex];
    if (!track || !track.gain) return;
    track.gain.gain.value = this._effectiveVolume(trackIndex);
  }

  // Global solo refresh (call after any toggleMute/toggleSolo)
  _rebuildAllGains() {
    this.tracks.forEach((_, i) => this._rebuildGain(i));
  }

  toggleMute(trackIndex: number) {
    const track = this.tracks[trackIndex];
    if (track) {
      track.mute = !track.mute;
      this._rebuildGain(trackIndex);
    }
  }

  toggleSolo(trackIndex: number) {
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

  setBpm(value: number) {
    this.bpm = value;
    this._updateStepDuration();
  }

  // Play a single sample on a track immediately (for preview)
  playSample(trackIndex: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const track = this.tracks[trackIndex];
    if (!track || !track.sample || !track.gain) return;
    const src = ctx.createBufferSource();
    src.buffer = track.sample;
    src.connect(track.gain);
    src.start();
  }

  // --- Transport with lookahead scheduling ---

  _scheduleStep(time: number, trackIndex: number) {
    const track = this.tracks[trackIndex];
    if (!track) return;

    // Mute/solo routing
    const anySolo = this.tracks.some(t => t.solo);
    if (anySolo && !track.solo) return;  // solo active, skip non-soloed tracks
    if (track.mute) return;                 // muted tracks silent regardless

    const srcData = this._stepSourceFor(trackIndex);
    if (!srcData) return; // empty playlist slot -> silence

    // 1) Sample playback (if sample loaded and pattern step active)
    if (track.sample && track.gain && srcData.pattern[this.stepIndex]) {
      const src = this.ctx!.createBufferSource();
      src.buffer = track.sample;
      src.connect(track.gain);
      src.start(time);
    }

    // 2) Synth note playback (if piano grid has notes on this step)
    if (srcData.pianoGrid) {
      const step = this.stepIndex;
      for (let pitch = 0; pitch < 24; pitch++) {
        const lengthSteps = srcData.pianoGrid[pitch][step];
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
      this.totalSteps++;
      this._notifyStepChange();
    }
  }

  startTransport() {
    const ctx = this.ensureContext();
    if (!ctx || this.isPlaying) return;
    this._updateStepDuration();
    this.isPlaying = true;
    this.stepIndex = 0;
    this.totalSteps = 0;
    this.nextStepTime = ctx.currentTime + 0.005; // tiny offset
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

  // Render the current loop region (or the active pattern when the playlist
  // is empty) to an AudioBuffer using an OfflineAudioContext. Mirrors the
  // live node chain: ADSR synth voices / sample buffer sources -> track
  // faders (volume + mute/solo) -> master. Renders faster than real time.
  async offlineRender(): Promise<AudioBuffer> {
    this._updateStepDuration();
    const sampleRate = this.ctx?.sampleRate || 44100;
    const hasPlaylist = this.playlist.length > 0;
    const barOffset = hasPlaylist && this.loopEnabled ? this.loopStart : 0;
    const barCount = hasPlaylist
      ? (this.loopEnabled ? this._effectiveLoopEnd() - this.loopStart : this.playlist.length)
      : 1;
    const totalSteps = barCount * this.stepsPerBar;
    const tail = Math.max(0.1, ...this.tracks.map(t => t.adsr.release)) + 0.1;
    const totalSeconds = totalSteps * this.stepDuration + tail;
    const lengthFrames = Math.ceil(totalSeconds * sampleRate);

    const offline = new OfflineAudioContext(2, lengthFrames, sampleRate);

    const master = offline.createGain();
    master.gain.value = 0.8;
    master.connect(offline.destination);

    const trackGains: GainNode[] = this.tracks.map((_, i) => {
      const g = offline.createGain();
      g.gain.value = this._effectiveVolume(i);
      const p = offline.createStereoPanner();
      p.pan.value = this.tracks[i].pan;
      g.connect(p);
      p.connect(master);
      return g;
    });

    for (let barIdx = 0; barIdx < barCount; barIdx++) {
      const bar = barOffset + barIdx;
      for (let step = 0; step < this.stepsPerBar; step++) {
        const time = (barIdx * this.stepsPerBar + step) * this.stepDuration;
        this.tracks.forEach((track, ti) => {
          const gain = trackGains[ti];
          if (!gain || gain.gain.value <= 0) return; // muted / soloed-out / zero volume
          const srcData = this._stepSourceForBar(ti, bar);
          if (!srcData) return; // empty playlist slot -> silence
          // 1) Sample playback (if sample loaded and pattern step active)
          if (track.sample && srcData.pattern[step]) {
            const src = offline.createBufferSource();
            src.buffer = track.sample;
            src.connect(gain);
            src.start(time);
          }
          // 2) Synth note playback (if piano grid has notes on this step)
          if (srcData.pianoGrid) {
            for (let pitch = 0; pitch < 24; pitch++) {
              const lengthSteps = srcData.pianoGrid[pitch][step];
              if (lengthSteps) {
                // pitch 0 = B4 (MIDI 71), pitch 23 = C3 (MIDI 48)
                const midi = 71 - pitch;
                const noteDuration = this.stepDuration * lengthSteps * 0.85;
                this._buildSynthVoice(offline, track, gain, midi, time, noteDuration);
              }
            }
          }
        });
      }
    }

    return offline.startRendering();
  }

  // --- Project serialization (localStorage) ---

  // Convert an ArrayBuffer to a base64 string (chunked to avoid call stack limits)
  _arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB chunks
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[]);
    }
    return btoa(binary);
  }

  _base64ToArrayBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // Normalize any saved pianoGrid shape into 24x16 numeric note lengths.
  _normalizePianoGrid(saved: unknown, fallback: number[][]): number[][] {
    const grid = fallback || this._createPianoGrid();
    if (!Array.isArray(saved)) return grid;
    for (let p = 0; p < 24; p++) {
      const row = saved[p];
      if (!Array.isArray(row)) continue;
      for (let s = 0; s < 16; s++) {
        const v = row[s];
        if (v) grid[p][s] = typeof v === 'number' ? v : 1;
      }
    }
    return grid;
  }

  // Return a plain JSON-serializable snapshot of the whole project.
  // Note: sample data is stored as base64 inside the snapshot (may be large).
  serialize(): ProjectState {
    return {
      version: 2,
      bpm: this.bpm,
      tracks: this.tracks.map((t) => ({
        name: t.name,
        sampleName: t.sampleName,
        sampleData: t.sampleData ? this._arrayBufferToBase64(t.sampleData) : null,
        volume: t.volume,
        mute: t.mute,
        solo: t.solo,
        pan: t.pan,
        synthType: t.synthType,
        adsr: { ...t.adsr },
      })),
      currentPatternIndex: this.currentPatternIndex,
      playlist: [...this.playlist],
      loopStart: this.loopStart,
      loopEnd: this.loopEnd,
      loopEnabled: this.loopEnabled,
      patterns: this.patterns.map((p) => ({
        name: p.name,
        tracks: p.tracks.map((t) => ({
          pattern: [...t.pattern],
          pianoGrid: t.pianoGrid.map((row) => [...row]),
        })),
      })),
    };
  }

  // Restore a project from a serialized snapshot (async because it decodes audio).
  async deserialize(state: SavedProject) {
    if (!state || !Array.isArray(state.tracks)) throw new Error('Invalid project data');

    this.stopTransport();
    this.bpm = state.bpm || 124;
    this._updateStepDuration();

    // v1 projects stored per-track pattern/pianoGrid directly on tracks;
    // wrap them into a single pattern so nothing is lost.
    let patterns: Pattern[] = Array.isArray(state.patterns) ? state.patterns : [];
    if (patterns.length === 0) {
      patterns = [{
        name: 'Pattern 1',
        tracks: this.tracks.map((_, i) => {
          const saved = state.tracks[i];
          return {
            pattern: Array.isArray(saved.pattern) ? [...saved.pattern] : new Array(16).fill(false),
            pianoGrid: this._normalizePianoGrid(saved.pianoGrid, this._createPianoGrid()),
          };
        }),
      }];
    }

    this.patterns = patterns.map(p => ({
      name: p.name || 'Pattern',
      tracks: p.tracks.map(t => ({
        pattern: Array.isArray(t.pattern) ? t.pattern.map(Boolean) : new Array(16).fill(false),
        pianoGrid: Array.isArray(t.pianoGrid)
          ? this._normalizePianoGrid(t.pianoGrid, this._createPianoGrid())
          : this._createPianoGrid(),
      })),
    }));

    this.currentPatternIndex = Math.min(state.currentPatternIndex || 0, this.patterns.length - 1);
    this.playlist = Array.isArray(state.playlist)
      ? state.playlist.map(v => (typeof v === 'number' && v >= 0 && v < this.patterns.length ? v : undefined))
      : [];
    this.loopStart = Math.max(0, state.loopStart ?? 0);
    this.loopEnd = Math.max(0, state.loopEnd ?? 0);
    this.loopEnabled = state.loopEnabled ?? true;
    if (this.loopEnd > this.loopStart) {
      this.loopStart = Math.min(this.loopStart, Math.max(0, this.loopEnd - 1));
    }

    this._loadPatternIntoLive(this.currentPatternIndex);

    for (let i = 0; i < this.tracks.length; i++) {
      const saved = state.tracks[i];
      if (!saved) continue;
      const track = this.tracks[i];
      track.name = saved.name || track.name;
      track.sampleName = saved.sampleName || null;
      track.volume = saved.volume !== undefined ? saved.volume : 1;
      track.mute = !!saved.mute;
      track.solo = !!saved.solo;
      track.pan = saved.pan !== undefined ? saved.pan : 0;
      if (track.panner) track.panner.pan.value = track.pan;
      track.synthType = saved.synthType || 'sine';
      if (saved.adsr && typeof saved.adsr === 'object') {
        track.adsr = {
          attack: saved.adsr.attack !== undefined ? saved.adsr.attack : track.adsr.attack,
          decay: saved.adsr.decay !== undefined ? saved.adsr.decay : track.adsr.decay,
          sustain: saved.adsr.sustain !== undefined ? saved.adsr.sustain : track.adsr.sustain,
          release: saved.adsr.release !== undefined ? saved.adsr.release : track.adsr.release,
        };
      }
      // Restore sample data (decode base64 -> AudioBuffer)
      track.sample = null;
      track.sampleData = null;
      if (saved.sampleData) {
        try {
          const data = this._base64ToArrayBuffer(saved.sampleData);
          const ctx = this.ensureContext();
          if (!ctx) throw new Error('Web Audio not available');
          const buffer = await ctx.decodeAudioData(data);
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
    this._notifyPatternChange();
  }

  // Reset all tracks to a blank project (keeps gain nodes / context).
  clearProject() {
    this.stopTransport();
    this.bpm = 124;
    this._updateStepDuration();
    this.tracks.forEach((t, i) => {
      const defaults: { name: string; synthType: WaveformType }[] = [
        { name: 'Kick', synthType: 'sine' },
        { name: 'Snare', synthType: 'noise' },
        { name: 'Bass', synthType: 'sawtooth' },
        { name: 'Synth', synthType: 'square' },
        { name: 'Pads', synthType: 'triangle' },
      ];
      t.name = defaults[i].name;
      t.synthType = defaults[i].synthType;
      t.adsr = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 };
      t.sample = null;
      t.sampleData = null;
      t.sampleName = null;
      t.volume = 1;
      t.mute = false;
      t.solo = false;
      t.pan = 0;
      if (t.panner) t.panner.pan.value = 0;
      t.noiseBuffer = null;
    });
    this.patterns = [{
      name: 'Pattern 1',
      tracks: this.tracks.map(() => ({ pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid() })),
    }];
    this.currentPatternIndex = 0;
    this.playlist = [];
    this.loopStart = 0;
    this.loopEnd = 0;
    this.loopEnabled = true;
    this._loadPatternIntoLive(0);
    this._rebuildAllGains();
    this._notifyStateChange();
    this._notifyPatternChange();
  }
}
