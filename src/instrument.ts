// Instrument panel UI: waveform + ADSR controls + sample (waveform/trim) for
// the active track.

import type { AudioEngine } from './audio/engine.js';
import type { WaveformType, AdsrParams, Track } from './types.js';

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
  private _waveWrap: HTMLElement | null = null;
  private _waveCanvas: HTMLCanvasElement | null = null;
  private _waveCtx: CanvasRenderingContext2D | null = null;
  private _trimStartHandle: HTMLElement | null = null;
  private _trimEndHandle: HTMLElement | null = null;
  private _sampleFilename: HTMLElement | null = null;
  private _sampleTrimInfo: HTMLElement | null = null;
  private _previewBtn: HTMLButtonElement | null = null;
  private _clearBtn: HTMLButtonElement | null = null;
  private _fileInput: HTMLInputElement | null = null;

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
      this.engine.beginHistory();
      this.engine.tracks[this.trackIndex].synthType = this._inputs.wave.value as WaveformType;
      this.engine.commitHistory();
      this._preview();
    });

    ADSR_KEYS.forEach((key) => {
      const input = this._inputs[key];
      let gesture = false;
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        // Group the whole slider drag into a single undo entry.
        if (!gesture) {
          gesture = true;
          this.engine.beginHistory();
        }
        this.engine.tracks[this.trackIndex].adsr[key] = v;
        this._values[key].textContent = v.toFixed(3);
      });
      input.addEventListener('change', () => {
        if (gesture) {
          gesture = false;
          this.engine.commitHistory();
        }
        this._preview();
      });
    });

    this._buildSampleSection();
    this.render();
  }

  // Build the sample section (waveform + trim handles + preview/clear) that
  // lives below the synth controls in the panel.
  private _buildSampleSection() {
    const el = this.el;
    if (!el) return;

    const section = document.createElement('div');
    section.className = 'sample-section';

    const header = document.createElement('div');
    header.className = 'sample-header';
    const label = document.createElement('span');
    label.className = 'instr-label';
    label.textContent = 'SAMPLE';
    const actions = document.createElement('div');
    actions.className = 'sample-actions';
    const preview = document.createElement('button');
    preview.className = 'mini-btn';
    preview.textContent = '▶';
    preview.title = 'Preview sample';
    const clear = document.createElement('button');
    clear.className = 'mini-btn';
    clear.textContent = '×';
    clear.title = 'Remove sample';
    actions.append(preview, clear);
    header.append(label, actions);

    const wrap = document.createElement('div');
    wrap.className = 'sample-wave-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'sample-wave';
    canvas.width = 204;
    canvas.height = 52;
    const handleStart = document.createElement('div');
    handleStart.className = 'sample-trim-handle sample-trim-start';
    handleStart.title = 'Trim start (drag)';
    const handleEnd = document.createElement('div');
    handleEnd.className = 'sample-trim-handle sample-trim-end';
    handleEnd.title = 'Trim end (drag)';
    wrap.append(canvas, handleStart, handleEnd);

    const meta = document.createElement('div');
    meta.className = 'sample-meta';
    const filename = document.createElement('span');
    filename.className = 'sample-filename mono';
    const trimInfo = document.createElement('span');
    trimInfo.className = 'sample-trim-info mono';
    meta.append(filename, trimInfo);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.aiff';
    fileInput.hidden = true;

    section.append(header, wrap, meta, fileInput);
    el.appendChild(section);

    this._waveWrap = wrap;
    this._waveCanvas = canvas;
    this._waveCtx = canvas.getContext('2d');
    this._trimStartHandle = handleStart;
    this._trimEndHandle = handleEnd;
    this._sampleFilename = filename;
    this._sampleTrimInfo = trimInfo;
    this._previewBtn = preview;
    this._clearBtn = clear;
    this._fileInput = fileInput;

    preview.addEventListener('click', () => this.engine.playSample(this.trackIndex));
    clear.addEventListener('click', () => {
      this.engine.clearSample(this.trackIndex);
      this.render();
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        await this.engine.loadSample(file, this.trackIndex);
      } catch (err) {
        console.error('Failed to load sample:', err);
        if (this._sampleFilename) this._sampleFilename.textContent = 'could not load';
      }
      this.render();
    });

    // Click the waveform to preview from that position; double-click resets trim.
    canvas.addEventListener('click', (e) => {
      this.engine.playSample(this.trackIndex, this._xToSeconds(e.clientX));
    });
    canvas.addEventListener('dblclick', () => {
      const track = this.engine.tracks[this.trackIndex];
      if (!track?.sample) return;
      this.engine.beginHistory();
      this.engine.setSampleTrim(this.trackIndex, 0, track.sample.duration);
      this.engine.commitHistory();
      this._drawSample();
    });

    handleStart.addEventListener('pointerdown', (e) => this._startTrimDrag(e, 'start'));
    handleEnd.addEventListener('pointerdown', (e) => this._startTrimDrag(e, 'end'));
  }

  private _startTrimDrag(ev: PointerEvent, which: 'start' | 'end') {
    const track = this.engine.tracks[this.trackIndex];
    if (!track?.sample) return;
    ev.preventDefault();
    const handle = which === 'start' ? this._trimStartHandle : this._trimEndHandle;
    if (!handle) return;
    handle.setPointerCapture(ev.pointerId);
    this.engine.beginHistory();
    const move = (me: PointerEvent) => {
      const { start, end } = this.engine._sampleBounds(track);
      const secs = this._xToSeconds(me.clientX);
      if (which === 'start') {
        this.engine.setSampleTrim(this.trackIndex, secs, end);
      } else {
        this.engine.setSampleTrim(this.trackIndex, start, secs);
      }
      this._drawSample();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.engine.commitHistory();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  private _xToSeconds(clientX: number): number {
    const wrap = this._waveWrap;
    const track = this.engine.tracks[this.trackIndex];
    if (!wrap || !track?.sample) return 0;
    const rect = wrap.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return frac * track.sample.duration;
  }

  // Redraw the waveform, dim outside the trim window, and move the handles.
  private _drawSample() {
    const canvas = this._waveCanvas;
    const ctx = this._waveCtx;
    if (!canvas || !ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const mid = H / 2;
    ctx.clearRect(0, 0, W, H);

    const track = this.engine.tracks[this.trackIndex];
    const startHandle = this._trimStartHandle;
    const endHandle = this._trimEndHandle;
    const nameEl = this._sampleFilename;
    const trimEl = this._sampleTrimInfo;
    const previewBtn = this._previewBtn;
    const clearBtn = this._clearBtn;

    if (!track?.sample) {
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();
      if (startHandle) startHandle.style.display = 'none';
      if (endHandle) endHandle.style.display = 'none';
      if (nameEl) {
        nameEl.textContent = 'no sample';
        nameEl.classList.add('empty');
      }
      if (trimEl) trimEl.textContent = '';
      if (previewBtn) previewBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      return;
    }

    const data = track.sample.getChannelData(0);
    const dur = track.sample.duration;
    const { start, end } = this.engine._sampleBounds(track);
    const step = Math.max(1, Math.floor(data.length / W));
    const amp = H / 2 - 2;
    for (let x = 0; x < W; x++) {
      const i0 = Math.min(data.length - 1, x * step);
      const i1 = Math.min(data.length, (x + 1) * step);
      let min = 1;
      let max = -1;
      for (let i = i0; i < i1; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const sec = (x / W) * dur;
      ctx.strokeStyle = sec >= start && sec <= end ? 'rgba(0,217,208,0.85)' : 'rgba(140,148,160,0.28)';
      ctx.beginPath();
      ctx.moveTo(x, mid - max * amp);
      ctx.lineTo(x, mid - min * amp);
      ctx.stroke();
    }

    if (startHandle) {
      startHandle.style.display = 'block';
      startHandle.style.left = `${(start / dur) * W}px`;
    }
    if (endHandle) {
      endHandle.style.display = 'block';
      endHandle.style.left = `${(end / dur) * W}px`;
    }
    if (nameEl) {
      nameEl.textContent = track.sampleName || track.name;
      nameEl.classList.remove('empty');
    }
    if (trimEl) trimEl.textContent = `${start.toFixed(2)} – ${end.toFixed(2)} s`;
    if (previewBtn) previewBtn.disabled = false;
    if (clearBtn) clearBtn.disabled = false;
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

    this._drawSample();
  }

  _preview() {
    // Play a short preview note so the user hears the current wave/ADSR
    this.engine.playSynthNote(this.trackIndex, 60, null, 0.3);
  }
}
