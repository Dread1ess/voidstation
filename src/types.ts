// Shared project types and interfaces.
// ESM module: every module explicitly imports its types from here
// (import type). Types are erased at compile time, leaving only the
// utility code (DEFAULT_VELOCITY, createNote) in the runtime.

export type WaveformType = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';

export interface AdsrParams {
  attack: number;   // seconds
  decay: number;    // seconds
  sustain: number;  // 0..1
  release: number;  // seconds
}

// A single note in the piano roll, stored compactly: the cell of pianoGrid
// holds the note length (in steps); the note head is the cell where
// length > 0.
export interface Note {
  pitch: number;    // 0 = B4 (MIDI 71), 23 = C3 (MIDI 48)
  step: number;     // 0..15
  length: number;   // note length in steps (0 = no note)
  velocity: number; // note velocity 0..1
}

export const DEFAULT_VELOCITY = 100;

export function createNote(pitch: number, step: number, length: number, velocity = DEFAULT_VELOCITY): Note {
  return { pitch, step, length, velocity };
}

// Data for one track INSIDE a pattern.
// pattern and pianoGrid are TWO INDEPENDENT layers of one track, not an
// either/or choice: pattern[16] triggers the loaded SAMPLE, while pianoGrid
// plays SYNTH notes. A track can use both layers at once
// (sample pattern + synth melody).
export interface PatternTrackData {
  pattern: boolean[];   // 16 steps (sample layer)
  pianoGrid: number[][]; // 24 pitches x 16 steps, value = note length in steps (0 = empty) (synth layer)
}

export interface Pattern {
  name: string;
  tracks: PatternTrackData[];
}

// Instrument (the synth section of a track).
export interface Instrument {
  synthType: WaveformType;
  adsr: AdsrParams;
}

// Mixer channel.
export interface MixerChannel {
  name: string;
  volume: number; // 0..1
  mute: boolean;
  solo: boolean;
  pan: number;    // -1..1 (left..right), applied via StereoPannerNode
}

// --- Per-track insert effects ---

export type ReverbPreset = 'room' | 'hall' | 'plate';

export interface ReverbEffect {
  type: 'reverb';
  enabled: boolean;
  preset: ReverbPreset;
  mix: number; // 0..1 wet level
}

export interface DelayEffect {
  type: 'delay';
  enabled: boolean;
  time: number;     // seconds
  feedback: number; // 0..0.95
  mix: number;      // 0..1 wet level
}

export interface EqEffect {
  type: 'eq';
  enabled: boolean;
  low: number;  // dB, lowshelf
  mid: number;  // dB, peaking
  high: number; // dB, highshelf
}

export type TrackEffect = ReverbEffect | DelayEffect | EqEffect;

// Engine-side handle for one built effect node group (in-place param updates).
export interface ReverbHandle { kind: 'reverb'; dry: GainNode; wet: GainNode; conv: ConvolverNode }
export interface DelayHandle { kind: 'delay'; dry: GainNode; wet: GainNode; delay: DelayNode; feedback: GainNode }
export interface EqHandle { kind: 'eq'; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode }
export type EffectHandle = ReverbHandle | DelayHandle | EqHandle;

export function createReverbEffect(preset: ReverbPreset = 'room'): ReverbEffect {
  return { type: 'reverb', enabled: true, preset, mix: 0.35 };
}
export function createDelayEffect(): DelayEffect {
  return { type: 'delay', enabled: true, time: 0.28, feedback: 0.4, mix: 0.25 };
}
export function createEqEffect(): EqEffect {
  return { type: 'eq', enabled: true, low: 0, mid: 0, high: 0 };
}
export function createEffect(type: TrackEffect['type']): TrackEffect {
  if (type === 'reverb') return createReverbEffect();
  if (type === 'delay') return createDelayEffect();
  return createEqEffect();
}

// A whole track: audio state + "live" references to the current pattern's
// data (pattern/pianoGrid are re-bound on switchPattern).
export interface Track extends MixerChannel {
  sample: AudioBuffer | null;
  sampleData: ArrayBuffer | null;
  sampleName: string | null;
  sampleStart: number; // trim: start offset in seconds (0 = from the top)
  sampleEnd: number;   // trim: end offset in seconds (Infinity = to the tail)
  gain: GainNode | null;
  panner: StereoPannerNode | null;
  effects: TrackEffect[]; // per-track insert chain (order matters)
  fxIn: GainNode | null;  // first node of the live insert chain (null when empty)
  fxOut: AudioNode | null; // last node of the live insert chain (null when empty)
  fxNodes: AudioNode[];   // all live chain nodes (for disconnect on rebuild)
  pattern: boolean[];   // reference to the active pattern's data (sample layer)
  pianoGrid: number[][]; // reference to the active pattern's data (synth layer)
  synthType: WaveformType;
  adsr: AdsrParams;
  noiseBuffer: AudioBuffer | null; // internal white-noise buffer cache
}

// A track's audio settings in a serialized project (no pattern data).
export interface TrackSettings {
  name: string;
  sampleName: string | null;
  sampleData: string | null; // base64
  sampleStart?: number; // trim (optional so older saves still load)
  sampleEnd?: number;
  volume: number;
  mute: boolean;
  solo: boolean;
  pan: number;
  synthType: WaveformType;
  adsr: AdsrParams;
  effects?: TrackEffect[]; // optional so older saves still load
}

// Serialized project in localStorage (version: 2).
export interface ProjectState {
  version: number;
  bpm: number;
  tracks: TrackSettings[];
  currentPatternIndex: number;
  playlist: (number | undefined)[];
  patterns: Pattern[];
  // Loop region (in bars) — optional so older saved projects still load.
  loopStart?: number;
  loopEnd?: number;
  loopEnabled?: boolean;
}
