// Instrument panel UI: waveform + ADSR controls for the active track.

import type { AudioEngine } from './audio/engine.js';
import type { WaveformType, AdsrParams } from './types.js';

interface InstrInputs {
  wave: HTMLSelectElement;
  attack: HTMLInputElement;
  decay: HTMLInputElement;
  sustain: HTMLInputElement;
  release: HTMLInputElement;
}
interface InstrValues {
  attack: HTMLElement;
  decay: HTMLElement;
  sustain: HTMLElement;
  release: HTMLElement;
}
const ADSR_KEYS = ['attack', 'decay', 'sustain', 'release'] as const;

export class InstrumentPanel {
  engine: AudioEngine;
  trackIndex = 3; // Default to Synth track
  el: HTMLElement | null = null;
  _inputs: InstrInputs;
  _values: InstrValues;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this._inputs = {
      wave: document.createElement('select'),
      attack: document.createElement('input'),
      decay: document.createElement('input'),
      sustain: document.createElement('input'),
      release: document.createElement('input'),
    };
    this._values = {
      attack: document.createElement('span'),
      decay: document.createElement('span'),
      sustain: document.createElement('span'),
      release: document.createElement('span'),
    };
  }

  mount(el: HTMLElement) {
    this.el = el;
    if (!el) return;

    this._inputs = {
      wave: el.querySelector<HTMLSelectElement>('#instr-wave')!,
      attack: el.querySelector<HTMLInputElement>('#instr-attack')!,
      decay: el.querySelector<HTMLInputElement>('#instr-decay')!,
      sustain: el.querySelector<HTMLInputElement>('#instr-sustain')!,
      release: el.querySelector<HTMLInputElement>('#instr-release')!,
    };
    this._values = {
      attack: el.querySelector('#instr-attack-val')!,
      decay: el.querySelector('#instr-decay-val')!,
      sustain: el.querySelector('#instr-sustain-val')!,
      release: el.querySelector('#instr-release-val')!,
    };

    this._inputs.wave.addEventListener('change', () => {
      this.engine.tracks[this.trackIndex].synthType = this._inputs.wave.value as WaveformType;
      this._preview();
    });

    ADSR_KEYS.forEach((key) => {
      const input = this._inputs[key];
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        this.engine.tracks[this.trackIndex].adsr[key] = v;
        this._values[key].textContent = v.toFixed(3);
      });
      input.addEventListener('change', () => this._preview());
    });

    this.render();
  }

  // Point the panel at a specific track and refresh the controls.
  setTrack(trackIndex: number) {
    if (!this.engine.tracks[trackIndex]) return;
    this.trackIndex = trackIndex;
    this.render();
  }

  render() {
    if (!this.el) return;
    const track = this.engine.tracks[this.trackIndex];
    if (!track) return;

    const nameEl = this.el.querySelector('#instrument-name');
    if (nameEl) nameEl.textContent = track.name;

    const adsr: AdsrParams = track.adsr;
    this._inputs.wave.value = track.synthType;
    this._inputs.attack.value = String(adsr.attack);
    this._inputs.decay.value = String(adsr.decay);
    this._inputs.sustain.value = String(adsr.sustain);
    this._inputs.release.value = String(adsr.release);

    this._values.attack.textContent = adsr.attack.toFixed(3);
    this._values.decay.textContent = adsr.decay.toFixed(3);
    this._values.sustain.textContent = adsr.sustain.toFixed(2);
    this._values.release.textContent = adsr.release.toFixed(2);
  }

  _preview() {
    // Play a short preview note so the user hears the current wave/ADSR
    this.engine.playSynthNote(this.trackIndex, 60, null, 0.3);
  }
}
