// Shared constants for the VOIDSTATION hardware UI.

export const TRACK_NAMES = ['Kick', 'Snare', 'Bass', 'Synth', 'Pads'];
export const TRACK_COLORS = ['#D99B7F', '#A56F63', '#4F8F93', '#C4876B', '#7E8B6F'];

export const STORAGE_KEY = 'voidstation-project-v1';
export const WALL_KEY = 'voidstation-wall-v1';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
