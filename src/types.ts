// Базовые типы и интерфейсы проекта.
// ESM-модуль: все модули явно импортируют типы отсюда (import type).
// На этапе компиляции типы видимы, в рантайме остаётся только код утилит
// (DEFAULT_VELOCITY, createNote) — интерфейсы стираются.

export type WaveformType = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';

export interface AdsrParams {
  attack: number;   // seconds
  decay: number;    // seconds
  sustain: number;  // 0..1
  release: number;  // seconds
}

// Одна нота в piano roll. Внутри хранится компактно: в клетке pianoGrid
// лежит длина (шагов), голова ноты — клетка, где длина > 0.
export interface Note {
  pitch: number;    // 0 = B4 (MIDI 71), 23 = C3 (MIDI 48)
  step: number;     // 0..15
  length: number;   // длина в шагах (0 = нет ноты)
  velocity: number; // громкость ноты 0..1
}

export const DEFAULT_VELOCITY = 100;

export function createNote(pitch: number, step: number, length: number, velocity = DEFAULT_VELOCITY): Note {
  return { pitch, step, length, velocity };
}

// Данные одного трека ВНУТРИ паттерна.
// pattern и pianoGrid — это ДВА НЕЗАВИСИМЫХ слоя одного трека, не выбор
// одного из двух: pattern[16] триггерит загруженный СЭМПЛ, а pianoGrid
// играет СИНТ-ноты. Трек может использовать оба слоя одновременно
// (сэмпл-паттерн + мелодия синтом).
export interface PatternTrackData {
  pattern: boolean[];   // 16 шагов (сэмпл-слой)
  pianoGrid: number[][]; // 24 питча x 16 шагов, значение = длина ноты в шагах (0 = пусто) (синт-слой)
}

export interface Pattern {
  name: string;
  tracks: PatternTrackData[];
}

// Инструмент (синт-секция трека).
export interface Instrument {
  synthType: WaveformType;
  adsr: AdsrParams;
}

// Канал микшера.
export interface MixerChannel {
  name: string;
  volume: number; // 0..1
  mute: boolean;
  solo: boolean;
  pan: number;    // -1..1 (left..right), применяется через StereoPannerNode
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

// Трек целиком: аудио-состояние + «живые» ссылки на данные текущего паттерна
// (pattern/pianoGrid перепривязываются при switchPattern).
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
  pattern: boolean[];   // ссылка на данные активного паттерна (сэмпл-слой)
  pianoGrid: number[][]; // ссылка на данные активного паттерна (синт-слой)
  synthType: WaveformType;
  adsr: AdsrParams;
  noiseBuffer: AudioBuffer | null; // внутренний кеш буфера белого шума
}

// Аудио-настройки трека в сериализованном проекте (без pattern-данных).
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

// Сериализованный проект в localStorage (version: 2).
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
