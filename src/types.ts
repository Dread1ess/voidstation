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
  pan: number;    // -1..1 (зарезервировано, пока не используется)
}

// Трек целиком: аудио-состояние + «живые» ссылки на данные текущего паттерна
// (pattern/pianoGrid перепривязываются при switchPattern).
export interface Track extends MixerChannel {
  sample: AudioBuffer | null;
  sampleData: ArrayBuffer | null;
  sampleName: string | null;
  gain: GainNode | null;
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
  volume: number;
  mute: boolean;
  solo: boolean;
  synthType: WaveformType;
  adsr: AdsrParams;
}

// Сериализованный проект в localStorage (version: 2).
export interface ProjectState {
  version: number;
  bpm: number;
  tracks: TrackSettings[];
  currentPatternIndex: number;
  playlist: (number | undefined)[];
  patterns: Pattern[];
}
