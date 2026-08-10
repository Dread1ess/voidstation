// Audio engine: Web Audio context, transport, step sequencing, patterns.
// ESM module. Exposes the class via export; also kept on window during the
// migration so the classic entry (main.js) can still construct it.

import type { Track, Pattern, PatternTrackData, WaveformType, AdsrParams, ProjectState, TrackSettings, TrackEffect, EffectHandle, ReverbPreset } from '../types.js';
import { createEffect, createReverbEffect, createDelayEffect, createEqEffect } from '../types.js';

// Project shape that deserialize() accepts: v2 (current) plus the old v1
// shape that kept pattern/pianoGrid directly on the track entries.
interface SavedTrack extends TrackSettings {
  pattern?: boolean[];
  pianoGrid?: unknown;
  velocity?: unknown;
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
  // Live insert-effect graphs per track: all nodes (for disconnect) plus
  // per-effect handles (for cheap in-place param updates during a drag).
  private _fxGraphs = new Map<number, { nodes: AudioNode[]; handles: Map<number, EffectHandle> }>();
  // Impulse response cache per track+preset (keyed with the sample rate so the
  // offline renderer never reuses an IR whose rate differs from its context).
  private _irCache = new Map<string, AudioBuffer>();

  // Transport state
  transportTime = 0;          // current position in seconds
  nextStepTime = 0;           // when next step is due
  schedulerInterval: number | null = null;   // setInterval handle
  lookahead = 0.1;            // schedule 100ms ahead
  scheduleInterval = 25;      // scheduler tick every 25ms

  // Tracks: each track has sample, gain, panner, insert fx chain, pattern
  // (16 steps), pianoGrid (24x16), mute/solo/volume/pan.
  tracks: Track[] = [
    { name: 'Kick',   sample: null, sampleData: null, sampleName: null, sampleStart: 0, sampleEnd: Infinity, gain: null, panner: null, effects: [], fxIn: null, fxOut: null, fxNodes: [], pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), velocity: new Array(16).fill(1), volume: 1.0, mute: false, solo: false, synthType: 'sine', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Snare',  sample: null, sampleData: null, sampleName: null, sampleStart: 0, sampleEnd: Infinity, gain: null, panner: null, effects: [], fxIn: null, fxOut: null, fxNodes: [], pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), velocity: new Array(16).fill(1), volume: 1.0, mute: false, solo: false, synthType: 'noise', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Bass',   sample: null, sampleData: null, sampleName: null, sampleStart: 0, sampleEnd: Infinity, gain: null, panner: null, effects: [], fxIn: null, fxOut: null, fxNodes: [], pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), velocity: new Array(16).fill(1), volume: 1.0, mute: false, solo: false, synthType: 'sawtooth', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Synth',  sample: null, sampleData: null, sampleName: null, sampleStart: 0, sampleEnd: Infinity, gain: null, panner: null, effects: [], fxIn: null, fxOut: null, fxNodes: [], pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), velocity: new Array(16).fill(1), volume: 1.0, mute: false, solo: false, synthType: 'square', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
    { name: 'Pads',   sample: null, sampleData: null, sampleName: null, sampleStart: 0, sampleEnd: Infinity, gain: null, panner: null, effects: [], fxIn: null, fxOut: null, fxNodes: [], pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), velocity: new Array(16).fill(1), volume: 1.0, mute: false, solo: false, synthType: 'triangle', adsr: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 }, pan: 0, noiseBuffer: null },
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
    { name: 'Pattern 1', tracks: this.tracks.map(() => ({ pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), velocity: new Array(16).fill(1) })) },
  ];
  currentPatternIndex = 0;
  playlist: (number | undefined)[] = []; // bar index -> pattern index; [] = play active pattern
  // Loop region (in bars). Playback and offline export wrap within
  // [loopStart, loopEnd). loopEnd = 0 means "auto: the whole playlist",
  // so an untouched project keeps the legacy wrap-everything behaviour.
  loopStart = 0;
  loopEnd = 0;
  loopEnabled = true;
  // Live-only metronome click (never rendered offline). Session preference,
  // not a project edit: the transport toggle does NOT commit a history entry
  // (still persisted so the user's preference survives a reload).
  metronome = false;

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
      t.velocity = pat.tracks[i].velocity;
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
      tracks: tpl.tracks.map(t => ({ pattern: [...t.pattern], pianoGrid: t.pianoGrid.map(r => [...r]), velocity: [...t.velocity] })),
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

  // Move a clip from one bar to another. If the destination is occupied the
  // two clips swap; otherwise the source bar becomes empty. Extends the loop
  // region when the clip lands beyond its end.
  movePlaylistClip(fromBar: number, toBar: number) {
    if (fromBar < 0 || toBar < 0 || fromBar === toBar) return;
    const clip = this.playlist[fromBar];
    if (clip === undefined) return;
    const existing = this.playlist[toBar];
    this.playlist[toBar] = clip;
    if (existing !== undefined) {
      this.playlist[fromBar] = existing; // swap
    } else {
      delete this.playlist[fromBar];     // move
    }
    if (this.loopEnabled && toBar + 1 > this.loopEnd) this.loopEnd = toBar + 1;
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

  toggleMetronome() {
    this.metronome = !this.metronome;
    this._notifyStateChange();
  }

  // --- Undo / redo (snapshot-based transactions) ---
  private _undoStack: string[] = [];
  private _redoStack: string[] = [];
  private _txBase: string | null = null;
  readonly historyLimit = 20;

  get canUndo() { return this._undoStack.length > 0; }
  get canRedo() { return this._redoStack.length > 0; }

  // Remember the project state at the start of a user gesture.
  beginHistory() {
    this._txBase = JSON.stringify(this.serialize());
  }

  // End a gesture: if the state changed, the pre-gesture snapshot becomes an
  // undo entry (capped at historyLimit); unchanged gestures are discarded.
  // Any new action clears the redo stack.
  commitHistory() {
    if (this._txBase === null) return;
    const before = this._txBase;
    this._txBase = null;
    if (JSON.stringify(this.serialize()) !== before) {
      this._undoStack.push(before);
      if (this._undoStack.length > this.historyLimit) this._undoStack.shift();
      this._redoStack.length = 0;
    }
  }

  async undo(): Promise<boolean> {
    const snapshot = this._undoStack.pop();
    if (snapshot === undefined) return false;
    this._redoStack.push(JSON.stringify(this.serialize()));
    await this.deserialize(JSON.parse(snapshot));
    return true;
  }

  async redo(): Promise<boolean> {
    const snapshot = this._redoStack.pop();
    if (snapshot === undefined) return false;
    this._undoStack.push(JSON.stringify(this.serialize()));
    await this.deserialize(JSON.parse(snapshot));
    return true;
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

  playSynthNote(trackIndex: number, midiNote: number, time: number | null = null, duration = 0.2, velocity = 1) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const track = this.tracks[trackIndex];
    const dest = this._voiceDest(track);
    if (!track || !dest) return;
    const ctxTime = time !== null ? time : ctx.currentTime;
    this._buildSynthVoice(ctx, track, dest, midiNote, ctxTime, duration, velocity);
  }

  // Build a synth voice (oscillator / noise + ADSR envelope) in the given
  // context and connect it to destGain. Shared by live playback and the
  // offline renderer so exported audio matches what's heard. `velocity`
  // (0..1) scales the envelope peak.
  private _buildSynthVoice(
    ctx: BaseAudioContext,
    track: Track,
    destGain: GainNode,
    midiNote: number,
    time: number,
    duration: number,
    velocity = 1
  ) {
    const adsr: AdsrParams = track.adsr;
    const peak = 0.25 * Math.max(0, Math.min(1, velocity));
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
      // Create per-track gain + pan nodes, then the insert effect chains
      this.tracks.forEach((t, i) => {
        t.gain = this.ctx!.createGain();
        t.gain!.gain.value = t.volume;
        t.panner = this.ctx!.createStereoPanner();
        t.panner.pan.value = t.pan;
        t.gain!.connect(t.panner);
        t.panner.connect(this.master!);
        this._rebuildFxChain(i);
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
    const stored = data.slice(0); // decodeAudioData() detaches its input — keep a copy
    const buffer = await ctx.decodeAudioData(data);
    const track = this.tracks[trackIndex];
    track.sample = buffer;
    track.sampleData = stored;
    track.sampleName = file.name;
    track.name = file.name.replace(/\.[^.]+$/, '');
    track.sampleStart = 0;     // fresh trim = whole file
    track.sampleEnd = Infinity;
    this._notifyPatternChange();
    return buffer;
  }

  // Resolve the effective trim window for a loaded sample (seconds).
  _sampleBounds(track: Track): { start: number; end: number } {
    const dur = track.sample?.duration || 0;
    const start = Math.max(0, Math.min(track.sampleStart, dur - 0.001));
    const end = Math.max(start + 0.001, Math.min(track.sampleEnd, dur));
    return { start, end };
  }

  // Set the trim window for a loaded sample (seconds). Clamps to the buffer.
  // Deliberately does NOT notify listeners: trim drags fire per-move and the
  // instrument panel redraws itself; no other view reads the trim.
  setSampleTrim(trackIndex: number, start: number, end: number) {
    const track = this.tracks[trackIndex];
    if (!track || !track.sample) return;
    const dur = track.sample.duration;
    track.sampleStart = Math.max(0, Math.min(start, dur - 0.001));
    track.sampleEnd = Math.max(track.sampleStart + 0.001, Math.min(end, dur));
  }

  // Remove the loaded sample (and trim) from a track.
  clearSample(trackIndex: number) {
    const track = this.tracks[trackIndex];
    if (!track) return;
    track.sample = null;
    track.sampleData = null;
    track.sampleName = null;
    track.sampleStart = 0;
    track.sampleEnd = Infinity;
    this._notifyPatternChange();
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

  // Set the per-step velocity (accent) of a single step (0..1).
  setStepVelocity(trackIndex: number, stepIndex: number, velocity: number) {
    const track = this.tracks[trackIndex];
    if (track && stepIndex >= 0 && stepIndex < 16) {
      track.velocity[stepIndex] = Math.max(0, Math.min(1, velocity));
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

  // --- Insert effects (per-track chain: reverb / delay / EQ) ---

  // Destination node for a track's voices: the top of the insert chain when
  // one exists, otherwise the track gain (bypass).
  _voiceDest(track: Track): GainNode | null {
    return track.fxIn ?? track.gain;
  }

  // Synthesize a short low-passed noise burst as a stereo impulse response.
  _generateImpulse(ctx: BaseAudioContext, preset: ReverbPreset): AudioBuffer {
    const sr = ctx.sampleRate;
    const seconds = preset === 'room' ? 0.7 : preset === 'hall' ? 2.5 : 1.4;
    const len = Math.round(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    // Room dies fast, hall decays slowly, plate rings bright.
    const decay = preset === 'room' ? 6 : preset === 'hall' ? 3.5 : 8;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.75 + (Math.random() * 2 - 1) * 0.25;
        d[i] = lp * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _impulseFor(trackIndex: number, ctx: BaseAudioContext, preset: ReverbPreset): AudioBuffer {
    const key = `${trackIndex}:${preset}:${ctx.sampleRate}`;
    let buf = this._irCache.get(key);
    if (!buf) {
      buf = this._generateImpulse(ctx, preset);
      this._irCache.set(key, buf);
    }
    return buf;
  }

  // Build one effect's node group in series after `prev`. Returns the group's
  // output node, all created nodes (for disconnect) and a typed handle (used
  // by the live graph for in-place param updates; ignored offline).
  private _buildEffectNodes(
    ctx: BaseAudioContext,
    trackIndex: number,
    prev: AudioNode,
    fx: TrackEffect
  ): { out: AudioNode; nodes: AudioNode[]; handle: EffectHandle } {
    const clampMix = (m: number) => Math.max(0, Math.min(1, m));
    if (fx.type === 'reverb') {
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const conv = ctx.createConvolver();
      const out = ctx.createGain();
      conv.buffer = this._impulseFor(trackIndex, ctx, fx.preset);
      dry.gain.value = clampMix(1 - fx.mix);
      wet.gain.value = clampMix(fx.mix);
      prev.connect(dry);
      prev.connect(conv);
      conv.connect(wet);
      dry.connect(out);
      wet.connect(out);
      return { out, nodes: [dry, wet, conv, out], handle: { kind: 'reverb', dry, wet, conv } };
    }
    if (fx.type === 'delay') {
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const dl = ctx.createDelay(1.5);
      const fb = ctx.createGain();
      const out = ctx.createGain();
      dry.gain.value = clampMix(1 - fx.mix);
      wet.gain.value = clampMix(fx.mix);
      dl.delayTime.value = Math.max(0.02, Math.min(1.4, fx.time));
      fb.gain.value = Math.max(0, Math.min(0.95, fx.feedback));
      prev.connect(dry);
      prev.connect(dl);
      dl.connect(fb);
      fb.connect(dl); // feedback loop
      dl.connect(wet);
      dry.connect(out);
      wet.connect(out);
      return { out, nodes: [dry, dl, fb, wet, out], handle: { kind: 'delay', dry, wet, delay: dl, feedback: fb } };
    }
    // EQ (3-band)
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 250;
    low.gain.value = Math.max(-15, Math.min(15, fx.low));
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.9;
    mid.gain.value = Math.max(-15, Math.min(15, fx.mid));
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 4000;
    high.gain.value = Math.max(-15, Math.min(15, fx.high));
    prev.connect(low);
    low.connect(mid);
    mid.connect(high);
    return { out: high, nodes: [low, mid, high], handle: { kind: 'eq', low, mid, high } };
  }

  // Rebuild the live insert chain for one track from its enabled effects and
  // rewire it so voices flow through it before the track fader. When nothing
  // is enabled, voices go straight to the gain node.
  _rebuildFxChain(trackIndex: number) {
    const track = this.tracks[trackIndex];
    if (!track || !this.ctx || !track.gain) return;
    track.fxNodes.forEach(n => { try { n.disconnect(); } catch { /* already gone */ } });
    track.fxNodes = [];
    track.fxIn = null;
    track.fxOut = null;
    this._fxGraphs.delete(trackIndex);

    const enabled = track.effects.filter(e => e.enabled);
    if (!enabled.length) return;

    const inGain = this.ctx.createGain();
    let prev: AudioNode = inGain;
    const nodes: AudioNode[] = [inGain];
    const handles = new Map<number, EffectHandle>();
    track.effects.forEach((fx, i) => {
      if (!fx.enabled) return;
      const built = this._buildEffectNodes(this.ctx!, trackIndex, prev, fx);
      prev = built.out;
      nodes.push(...built.nodes);
      handles.set(i, built.handle);
    });
    track.fxIn = inGain;
    track.fxOut = prev;
    track.fxNodes = nodes;
    this._fxGraphs.set(trackIndex, { nodes, handles });
    prev.connect(track.gain);
  }

  _rebuildAllFxChains() {
    if (!this.ctx) return;
    this.tracks.forEach((_, i) => this._rebuildFxChain(i));
  }

  setEffectEnabled(trackIndex: number, effectIndex: number, enabled: boolean) {
    const track = this.tracks[trackIndex];
    const fx = track?.effects[effectIndex];
    if (!track || !fx || fx.enabled === enabled) return;
    fx.enabled = enabled;
    this._rebuildFxChain(trackIndex);
  }

  // Change one effect parameter. Applies to the live chain in place (no
  // rebuild), so slider drags don't cut the sound. Value is a number
  // (mix/time/feedback/dB) or a string (reverb preset).
  setEffectParam(trackIndex: number, effectIndex: number, key: string, value: number | string) {
    const track = this.tracks[trackIndex];
    const fx = track?.effects[effectIndex];
    if (!track || !fx) return;
    const graph = this._fxGraphs.get(trackIndex);
    const handle = graph?.handles.get(effectIndex);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (fx.type === 'reverb') {
      if (key === 'mix') {
        fx.mix = clamp(Number(value), 0, 1);
        if (handle && handle.kind === 'reverb') {
          handle.dry.gain.value = 1 - fx.mix;
          handle.wet.gain.value = fx.mix;
        }
      } else if (key === 'preset') {
        fx.preset = value as ReverbPreset;
        if (handle && handle.kind === 'reverb' && this.ctx) {
          handle.conv.buffer = this._impulseFor(trackIndex, this.ctx, fx.preset);
        }
      }
    } else if (fx.type === 'delay') {
      if (key === 'time') {
        fx.time = clamp(Number(value), 0.02, 1.4);
        if (handle && handle.kind === 'delay') handle.delay.delayTime.value = fx.time;
      } else if (key === 'feedback') {
        fx.feedback = clamp(Number(value), 0, 0.95);
        if (handle && handle.kind === 'delay') handle.feedback.gain.value = fx.feedback;
      } else if (key === 'mix') {
        fx.mix = clamp(Number(value), 0, 1);
        if (handle && handle.kind === 'delay') {
          handle.dry.gain.value = 1 - fx.mix;
          handle.wet.gain.value = fx.mix;
        }
      }
    } else if (fx.type === 'eq') {
      if (key === 'low') {
        fx.low = clamp(Number(value), -15, 15);
        if (handle && handle.kind === 'eq') handle.low.gain.value = fx.low;
      } else if (key === 'mid') {
        fx.mid = clamp(Number(value), -15, 15);
        if (handle && handle.kind === 'eq') handle.mid.gain.value = fx.mid;
      } else if (key === 'high') {
        fx.high = clamp(Number(value), -15, 15);
        if (handle && handle.kind === 'eq') handle.high.gain.value = fx.high;
      }
    }
  }

  addEffect(trackIndex: number, type: TrackEffect['type']) {
    const track = this.tracks[trackIndex];
    if (!track) return;
    track.effects.push(createEffect(type));
    this._rebuildFxChain(trackIndex);
  }

  removeEffect(trackIndex: number, effectIndex: number) {
    const track = this.tracks[trackIndex];
    if (!track || track.effects[effectIndex] === undefined) return;
    track.effects.splice(effectIndex, 1);
    this._rebuildFxChain(trackIndex);
  }

  moveEffect(trackIndex: number, from: number, to: number) {
    const track = this.tracks[trackIndex];
    if (!track || from === to || from < 0 || to < 0 || from >= track.effects.length || to >= track.effects.length) return;
    const [fx] = track.effects.splice(from, 1);
    track.effects.splice(to, 0, fx);
    this._rebuildFxChain(trackIndex);
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
  playSample(trackIndex: number, offset = 0) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const track = this.tracks[trackIndex];
    const dest = this._voiceDest(track);
    if (!track || !track.sample || !dest) return;
    const src = ctx.createBufferSource();
    src.buffer = track.sample;
    src.connect(dest);
    const { start, end } = this._sampleBounds(track);
    const begin = Math.min(Math.max(offset, start), end);
    src.start(0, begin, end - begin);
  }

  // --- Transport with lookahead scheduling ---

  // Live-only metronome tick: a short click (square oscillator + fast gain
  // envelope) routed to the master. `accent` marks the beat steps
  // (0, 4, 8, 12) with a higher pitch and louder hit. Deliberately NOT used
  // in offlineRender() so exported audio stays clean.
  _metronomeClick(time: number, accent: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1600 : 1000;
    const env = ctx.createGain();
    const peak = accent ? 0.35 : 0.2;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(env);
    env.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  // Per-step accent for a step in a pattern's track data (0..1, default 1).
  private _stepVelocity(srcData: PatternTrackData | null, step: number): number {
    const v = srcData?.velocity?.[step];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  }

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
    if (track.sample && srcData.pattern[this.stepIndex]) {
      const dest = this._voiceDest(track);
      if (dest) {
        const velocity = this._stepVelocity(srcData, this.stepIndex);
        const src = this.ctx!.createBufferSource();
        src.buffer = track.sample;
        const gain = this.ctx!.createGain();
        gain.gain.value = velocity;
        src.connect(gain);
        gain.connect(dest);
        const { start, end } = this._sampleBounds(track);
        src.start(time, start, end - start);
      }
    }

    // 2) Synth note playback (if piano grid has notes on this step)
    if (srcData.pianoGrid) {
      const step = this.stepIndex;
      const velocity = this._stepVelocity(srcData, step);
      for (let pitch = 0; pitch < 24; pitch++) {
        const lengthSteps = srcData.pianoGrid[pitch][step];
        if (lengthSteps) {
          // pitch 0 = B4 (MIDI 71), pitch 23 = C3 (MIDI 48)
          const midi = 71 - pitch;
          const noteDuration = this.stepDuration * lengthSteps * 0.85;
          this.playSynthNote(trackIndex, midi, time, noteDuration, velocity);
        }
      }
    }
  }

  _schedulerTick() {
    if (!this.isPlaying || !this.ctx) return;

    const now = this.ctx.currentTime;
    // Schedule all steps that fall within the lookahead window
    while (this.nextStepTime < now + this.lookahead) {
      // Metronome tick each step, accenting the beat steps (0, 4, 8, 12).
      // Live-only: offlineRender() never schedules this.
      if (this.metronome) {
        this._metronomeClick(this.nextStepTime, this.stepIndex % 4 === 0);
      }
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

    // Mirror the live insert chains: enabled effects sit between the voices
    // and each track's fader. The returned node is what voices connect to.
    const trackIns: GainNode[] = this.tracks.map((_, i) => {
      const enabled = this.tracks[i].effects.filter(e => e.enabled);
      if (!enabled.length) return trackGains[i];
      const inGain = offline.createGain();
      let prev: AudioNode = inGain;
      for (const fx of enabled) {
        prev = this._buildEffectNodes(offline, i, prev, fx).out;
      }
      prev.connect(trackGains[i]);
      return inGain;
    });

    for (let barIdx = 0; barIdx < barCount; barIdx++) {
      const bar = barOffset + barIdx;
      for (let step = 0; step < this.stepsPerBar; step++) {
        const time = (barIdx * this.stepsPerBar + step) * this.stepDuration;
        this.tracks.forEach((track, ti) => {
          const gain = trackGains[ti];
          if (!gain || gain.gain.value <= 0) return; // muted / soloed-out / zero volume
          const dest = trackIns[ti];
          if (!dest) return;
          const srcData = this._stepSourceForBar(ti, bar);
          if (!srcData) return; // empty playlist slot -> silence
          // 1) Sample playback (if sample loaded and pattern step active)
          if (track.sample && srcData.pattern[step]) {
            const velocity = this._stepVelocity(srcData, step);
            const src = offline.createBufferSource();
            src.buffer = track.sample;
            const gain = offline.createGain();
            gain.gain.value = velocity;
            src.connect(gain);
            gain.connect(dest);
            const { start, end } = this._sampleBounds(track);
            src.start(time, start, end - start);
          }
          // 2) Synth note playback (if piano grid has notes on this step)
          if (srcData.pianoGrid) {
            const velocity = this._stepVelocity(srcData, step);
            for (let pitch = 0; pitch < 24; pitch++) {
              const lengthSteps = srcData.pianoGrid[pitch][step];
              if (lengthSteps) {
                // pitch 0 = B4 (MIDI 71), pitch 23 = C3 (MIDI 48)
                const midi = 71 - pitch;
                const noteDuration = this.stepDuration * lengthSteps * 0.85;
                this._buildSynthVoice(offline, track, dest, midi, time, noteDuration, velocity);
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

  // Normalize a saved per-track velocity array into 16 values in 0..1.
  // Old saves have no velocity data -> fall back to all-1.0 (full accent).
  _normalizeVelocity(saved: unknown): number[] {
    const fallback = new Array(16).fill(1);
    if (!Array.isArray(saved) || saved.length !== 16) return fallback;
    return saved.map(v => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1));
  }

  // Validate + fill defaults for effects loaded from a saved project.
  private _sanitizeEffects(saved: unknown): TrackEffect[] {
    if (!Array.isArray(saved)) return [];
    const out: TrackEffect[] = [];
    for (const raw of saved) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Partial<TrackEffect> & { type?: string };
      const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      if (e.type === 'reverb') {
        const def = createReverbEffect();
        out.push({
          type: 'reverb',
          enabled: e.enabled !== undefined ? !!e.enabled : def.enabled,
          preset: (e.preset === 'room' || e.preset === 'hall' || e.preset === 'plate') ? e.preset : def.preset,
          mix: has(e.mix) ? clamp(e.mix, 0, 1) : def.mix,
        });
      } else if (e.type === 'delay') {
        const def = createDelayEffect();
        out.push({
          type: 'delay',
          enabled: e.enabled !== undefined ? !!e.enabled : def.enabled,
          time: has(e.time) ? clamp(e.time, 0.02, 1.4) : def.time,
          feedback: has(e.feedback) ? clamp(e.feedback, 0, 0.95) : def.feedback,
          mix: has(e.mix) ? clamp(e.mix, 0, 1) : def.mix,
        });
      } else if (e.type === 'eq') {
        const def = createEqEffect();
        out.push({
          type: 'eq',
          enabled: e.enabled !== undefined ? !!e.enabled : def.enabled,
          low: has(e.low) ? clamp(e.low, -15, 15) : def.low,
          mid: has(e.mid) ? clamp(e.mid, -15, 15) : def.mid,
          high: has(e.high) ? clamp(e.high, -15, 15) : def.high,
        });
      }
    }
    return out;
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
        sampleStart: t.sampleStart,
        sampleEnd: Number.isFinite(t.sampleEnd) ? t.sampleEnd : undefined,
        volume: t.volume,
        mute: t.mute,
        solo: t.solo,
        pan: t.pan,
        synthType: t.synthType,
        adsr: { ...t.adsr },
        effects: t.effects.map(e => ({ ...e })),
      })),
      currentPatternIndex: this.currentPatternIndex,
      playlist: [...this.playlist],
      loopStart: this.loopStart,
      loopEnd: this.loopEnd,
      loopEnabled: this.loopEnabled,
      metronome: this.metronome,
      patterns: this.patterns.map((p) => ({
        name: p.name,
        tracks: p.tracks.map((t) => ({
          pattern: [...t.pattern],
          pianoGrid: t.pianoGrid.map((row) => [...row]),
          velocity: [...t.velocity],
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
            velocity: this._normalizeVelocity(saved.velocity),
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
        velocity: this._normalizeVelocity(t.velocity),
      })),
    }));

    this.currentPatternIndex = Math.min(state.currentPatternIndex || 0, this.patterns.length - 1);
    this.playlist = Array.isArray(state.playlist)
      ? state.playlist.map(v => (typeof v === 'number' && v >= 0 && v < this.patterns.length ? v : undefined))
      : [];
    this.loopStart = Math.max(0, state.loopStart ?? 0);
    this.loopEnd = Math.max(0, state.loopEnd ?? 0);
    this.loopEnabled = state.loopEnabled ?? true;
    this.metronome = state.metronome ?? false;
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
      // Restore per-track insert effects (defaults for missing/partial entries)
      track.effects = this._sanitizeEffects(saved.effects);
      // Restore sample data (decode base64 -> AudioBuffer)
      track.sample = null;
      track.sampleData = null;
      track.sampleStart = typeof saved.sampleStart === 'number' ? saved.sampleStart : 0;
      track.sampleEnd = typeof saved.sampleEnd === 'number' ? saved.sampleEnd : Infinity;
      if (saved.sampleData) {
        try {
          const data = this._base64ToArrayBuffer(saved.sampleData);
          const stored = data.slice(0); // decodeAudioData() detaches its input
          const ctx = this.ensureContext();
          if (!ctx) throw new Error('Web Audio not available');
          const buffer = await ctx.decodeAudioData(data);
          track.sample = buffer;
          track.sampleData = stored;
        } catch (err) {
          console.warn(`Failed to decode saved sample for track ${i}:`, err);
          track.sample = null;
          track.sampleData = null;
        }
      }
    }

    this._rebuildAllGains();
    this._rebuildAllFxChains();
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
      t.sampleStart = 0;
      t.sampleEnd = Infinity;
      t.volume = 1;
      t.mute = false;
      t.solo = false;
      t.pan = 0;
      if (t.panner) t.panner.pan.value = 0;
      t.effects = [];
      t.noiseBuffer = null;
    });
    this.patterns = [{
      name: 'Pattern 1',
      tracks: this.tracks.map(() => ({ pattern: new Array(16).fill(false), pianoGrid: this._createPianoGrid(), velocity: new Array(16).fill(1) })),
    }];
    this.currentPatternIndex = 0;
    this.playlist = [];
    this.loopStart = 0;
    this.loopEnd = 0;
    this.loopEnabled = true;
    this.metronome = false;
    this._loadPatternIntoLive(0);
    this._rebuildAllGains();
    this._rebuildAllFxChains();
    this._notifyStateChange();
    this._notifyPatternChange();
  }
}
