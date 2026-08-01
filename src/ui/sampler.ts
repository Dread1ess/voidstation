// Sampler module: load a sample onto any track, preview it, and trim the
// waveform with draggable handles. Draws the waveform by hand on a canvas
// (no external dependencies).

import type { AudioEngine } from '../audio/engine.js';
import { makeBtn, makeReadout, makeTag } from './rack.js';
import { TRACK_NAMES } from './theme.js';

const CANVAS_W = 300;
const CANVAS_H = 64;

export class Sampler {
  private engine: AudioEngine;
  private body: HTMLElement;

  private trackIndex = 0;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private wrap!: HTMLElement;
  private startHandle!: HTMLElement;
  private endHandle!: HTMLElement;
  private fileNameEl!: HTMLElement;
  private trimInfoEl!: HTMLElement;
  private trackSelect!: HTMLSelectElement;

  constructor(engine: AudioEngine, body: HTMLElement) {
    this.engine = engine;
    this.body = body;
    this.render();
    this.engine.onPatternChange(() => this.redraw());
  }

  setTrack(index: number) {
    this.trackIndex = index;
    this.trackSelect.value = String(index);
    this.redraw();
  }

  private render() {
    this.body.innerHTML = '';
    this.body.className = 'sampler';

    // --- Track selector ---
    const trackGroup = document.createElement('div');
    trackGroup.className = 'hw-group';
    trackGroup.appendChild(makeTag('TRACK'));
    this.trackSelect = document.createElement('select');
    this.trackSelect.className = 'sampler-track';
    this.engine.tracks.forEach((track, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${TRACK_NAMES[i] ?? track.name}`;
      this.trackSelect.appendChild(opt);
    });
    this.trackSelect.addEventListener('change', () => {
      this.trackIndex = parseInt(this.trackSelect.value, 10);
      this.redraw();
    });
    trackGroup.appendChild(this.trackSelect);
    this.body.appendChild(trackGroup);

    // --- File loading ---
    const loadGroup = document.createElement('div');
    loadGroup.className = 'hw-group';
    loadGroup.appendChild(makeTag('LOAD'));
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.aiff';
    fileInput.hidden = true;
    const loadBtn = makeBtn('LOAD SAMPLE');
    loadBtn.id = 'btn-load-sample';
    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        await this.engine.loadSample(file, this.trackIndex);
        this.fileNameEl.textContent = file.name;
        this.fileNameEl.classList.remove('error');
      } catch (err) {
        console.error('Failed to load sample:', err);
        this.fileNameEl.textContent = 'could not load';
        this.fileNameEl.classList.add('error');
      }
      this.redraw();
    });
    loadGroup.append(loadBtn, fileInput);
    this.body.appendChild(loadGroup);

    // --- Waveform + trim handles ---
    const waveGroup = document.createElement('div');
    waveGroup.className = 'hw-group';
    waveGroup.appendChild(makeTag('WAVEFORM'));
    this.wrap = document.createElement('div');
    this.wrap.className = 'sampler-wave';
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.startHandle = document.createElement('div');
    this.startHandle.className = 'sampler-handle sampler-handle-start';
    this.startHandle.title = 'Trim start (drag)';
    this.endHandle = document.createElement('div');
    this.endHandle.className = 'sampler-handle sampler-handle-end';
    this.endHandle.title = 'Trim end (drag)';
    this.wrap.append(this.canvas, this.startHandle, this.endHandle);
    waveGroup.appendChild(this.wrap);
    this.body.appendChild(waveGroup);

    // --- Sample meta ---
    const meta = document.createElement('div');
    meta.className = 'sampler-meta';
    this.fileNameEl = makeReadout('no sample', 'sampler-file');
    this.trimInfoEl = makeReadout('', 'sampler-trim');
    meta.append(this.fileNameEl, this.trimInfoEl);
    this.body.appendChild(meta);

    // --- Preview / clear ---
    const actions = document.createElement('div');
    actions.className = 'sampler-actions';
    const preview = makeBtn('▶ PREVIEW');
    preview.addEventListener('click', () => this.engine.playSample(this.trackIndex));
    const clear = makeBtn('CLEAR');
    clear.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.clearSample(this.trackIndex);
      this.engine.commitHistory();
      this.fileNameEl.textContent = 'no sample';
      this.fileNameEl.classList.remove('error');
      this.redraw();
    });
    actions.append(preview, clear);
    this.body.appendChild(actions);

    // --- Waveform interactions ---
    this.canvas.addEventListener('click', (e) => {
      this.engine.playSample(this.trackIndex, this.xToSeconds(e.clientX));
    });
    this.canvas.addEventListener('dblclick', () => {
      const track = this.engine.tracks[this.trackIndex];
      if (!track?.sample) return;
      this.engine.beginHistory();
      this.engine.setSampleTrim(this.trackIndex, 0, track.sample.duration);
      this.engine.commitHistory();
      this.redraw();
    });
    this.startHandle.addEventListener('pointerdown', (e) => this.startTrimDrag(e, 'start'));
    this.endHandle.addEventListener('pointerdown', (e) => this.startTrimDrag(e, 'end'));

    this.redraw();
  }

  private xToSeconds(clientX: number): number {
    const track = this.engine.tracks[this.trackIndex];
    if (!track?.sample) return 0;
    const rect = this.wrap.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return frac * track.sample.duration;
  }

  private startTrimDrag(ev: PointerEvent, which: 'start' | 'end') {
    const track = this.engine.tracks[this.trackIndex];
    if (!track?.sample) return;
    ev.preventDefault();
    const handle = which === 'start' ? this.startHandle : this.endHandle;
    handle.setPointerCapture(ev.pointerId);
    this.engine.beginHistory();
    const move = (me: PointerEvent) => {
      const { start, end } = this.engine._sampleBounds(track);
      const secs = this.xToSeconds(me.clientX);
      if (which === 'start') {
        this.engine.setSampleTrim(this.trackIndex, secs, end);
      } else {
        this.engine.setSampleTrim(this.trackIndex, start, secs);
      }
      this.redraw();
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

  // Downsample the audio into N peak segments and draw them.
  private redraw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = CANVAS_W;
    const H = CANVAS_H;
    const mid = H / 2;
    ctx.clearRect(0, 0, W, H);

    const track = this.engine.tracks[this.trackIndex];
    if (track.sample) {
      const data = track.sample.getChannelData(0);
      const n = data.length;
      const step = Math.floor(n / W);
      const peak = new Float32Array(W);
      if (step > 0) {
        for (let i = 0; i < n; i += step) {
          let max = 0;
          const end = Math.min(i + step, n);
          for (let j = i; j < end; j++) {
            const v = Math.abs(data[j]);
            if (v > max) max = v;
          }
          peak[i / step] = max;
        }
      } else {
        for (let i = 0; i < W; i++) peak[i] = Math.abs(data[i] || 0);
      }

      // Track background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 0, W, H);

      // Dim outside the trim window
      const { start, end } = this.engine._sampleBounds(track);
      const dur = track.sample.duration || 1;
      const sx = (start / dur) * W;
      const ex = (end / dur) * W;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, sx, H);
      ctx.fillRect(ex, 0, W - ex, H);

      // Waveform peaks (inside the trim window highlighted)
      ctx.lineWidth = 1;
      for (let i = 0; i < W; i++) {
        const amp = peak[i];
        if (i < sx || i > ex) {
          ctx.strokeStyle = 'rgba(154, 139, 127, 0.6)';
        } else {
          ctx.strokeStyle = i === Math.floor(sx) ? 'var(--accent-bright, #D99B7F)' : 'var(--track-' + this.trackIndex + ', #D99B7F)';
        }
        ctx.beginPath();
        ctx.moveTo(i + 0.5, mid - amp * (H / 2 - 2));
        ctx.lineTo(i + 0.5, mid + amp * (H / 2 - 2));
        ctx.stroke();
      }

      // Trim handles
      this.startHandle.style.display = 'block';
      this.endHandle.style.display = 'block';
      this.startHandle.style.left = `${sx}px`;
      this.endHandle.style.left = `${ex}px`;
      this.trimInfoEl.textContent = `${start.toFixed(2)}s–${end.toFixed(2)}s`;
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(154, 139, 127, 0.5)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO SAMPLE', W / 2, H / 2 + 3);
      this.startHandle.style.display = 'none';
      this.endHandle.style.display = 'none';
      this.trimInfoEl.textContent = '';
    }
  }
}
