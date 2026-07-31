// Базовые типы и интерфейсы проекта.
// ESM-модуль: все модули явно импортируют типы отсюда (import type).
// На этапе компиляции типы видимы, в рантайме остаётся только код утилит
// (DEFAULT_VELOCITY, createNote) — интерфейсы стираются.
export const DEFAULT_VELOCITY = 100;
export function createNote(pitch, step, length, velocity = DEFAULT_VELOCITY) {
    return { pitch, step, length, velocity };
}
export function createReverbEffect(preset = 'room') {
    return { type: 'reverb', enabled: true, preset, mix: 0.35 };
}
export function createDelayEffect() {
    return { type: 'delay', enabled: true, time: 0.28, feedback: 0.4, mix: 0.25 };
}
export function createEqEffect() {
    return { type: 'eq', enabled: true, low: 0, mid: 0, high: 0 };
}
export function createEffect(type) {
    if (type === 'reverb')
        return createReverbEffect();
    if (type === 'delay')
        return createDelayEffect();
    return createEqEffect();
}
