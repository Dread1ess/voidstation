// Базовые типы и интерфейсы проекта.
// ESM-модуль: все модули явно импортируют типы отсюда (import type).
// На этапе компиляции типы видимы, в рантайме остаётся только код утилит
// (DEFAULT_VELOCITY, createNote) — интерфейсы стираются.
export const DEFAULT_VELOCITY = 100;
export function createNote(pitch, step, length, velocity = DEFAULT_VELOCITY) {
    return { pitch, step, length, velocity };
}
