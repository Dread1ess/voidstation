// Transport: the controls the user touches constantly live in the top bar
// (play/stop, BPM, loop, pattern name, status). The rare file operations
// (save/open/new/export) live in a wall module so the bar stays uncluttered.

import type { AudioEngine } from '../audio/engine.js';
import { audioBufferToWav } from '../audio/wav.js';
import { makeBtn, makeReadout, makeTag } from './rack.js';
import { STORAGE_KEY } from './theme.js';

export class Transport {
  private engine: AudioEngine;
  private barBody: HTMLElement;
  private filesBody: HTMLElement;

  private playBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private bpmInput!: HTMLInputElement;
  private loopBtn!: HTMLButtonElement;
  private mtrnBtn!: HTMLButtonElement;
  private patternEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private posEl!: HTMLElement;
  private exportBtn!: HTMLButtonElement;

  // Timestamps of recent TAP clicks (in ms), used to average tempo.
  private taps: number[] = [];

  constructor(engine: AudioEngine, barBody: HTMLElement, filesBody: HTMLElement) {
    this.engine = engine;
    this.barBody = barBody;
    this.filesBody = filesBody;
    this.buildBar();
    this.buildFiles();
    this.sync();
    this.updatePosition();
    this.engine.onStateChange(() => this.sync());
    this.engine.onPatternChange(() => this.sync());
    this.engine.onStepChange(() => this.updatePosition());
  }

  private buildBar() {
    // --- Transport cluster ---
    const cluster = document.createElement('div');
    cluster.className = 'hw-group hw-transport-cluster';

    this.playBtn = makeBtn('PLAY');
    this.playBtn.id = 'btn-play';
    this.playBtn.classList.add('hw-play');
    this.playBtn.addEventListener('click', () => {
      if (!this.engine.hasContent) {
        this.setStatus('add notes or a sample first', true);
        return;
      }
      if (this.engine.isPlaying) {
        this.engine.stopTransport();
      } else {
        this.engine.startTransport();
      }
    });

    const stopBtn = makeBtn('STOP');
    stopBtn.id = 'btn-stop';
    stopBtn.classList.add('hw-stop');
    stopBtn.addEventListener('click', () => this.engine.stopTransport());

    cluster.append(this.playBtn, stopBtn);
    this.barBody.appendChild(cluster);

    // --- Position readout (BAR:STEP, live from the transport) ---
    const posGroup = document.createElement('div');
    posGroup.className = 'hw-group hw-position-group';
    posGroup.appendChild(makeTag('POS'));
    this.posEl = makeReadout('01:01');
    posGroup.appendChild(this.posEl);
    this.barBody.appendChild(posGroup);

    // --- Undo / redo (history transaction buttons) ---
    const historyGroup = document.createElement('div');
    historyGroup.className = 'hw-group hw-history-group';
    historyGroup.appendChild(makeTag('HISTORY'));

    this.undoBtn = makeBtn('↶ UNDO');
    this.undoBtn.id = 'btn-undo';
    this.undoBtn.title = 'Undo last change';
    this.undoBtn.addEventListener('click', () => {
      void this.engine.undo().then(() => this.sync());
    });

    this.redoBtn = makeBtn('↷ REDO');
    this.redoBtn.id = 'btn-redo';
    this.redoBtn.title = 'Redo last change';
    this.redoBtn.addEventListener('click', () => {
      void this.engine.redo().then(() => this.sync());
    });

    historyGroup.append(this.undoBtn, this.redoBtn);
    this.barBody.appendChild(historyGroup);

    // --- BPM group ---
    const bpmGroup = document.createElement('div');
    bpmGroup.className = 'hw-group hw-bpm-group';
    bpmGroup.appendChild(makeTag('BPM'));

    this.bpmInput = document.createElement('input');
    this.bpmInput.type = 'number';
    this.bpmInput.className = 'hw-readout mono';
    this.bpmInput.id = 'bpm-input';
    this.bpmInput.min = '20';
    this.bpmInput.max = '300';
    this.bpmInput.step = '1';
    this.bpmInput.addEventListener('change', () => {
      const value = parseFloat(this.bpmInput.value);
      if (Number.isFinite(value) && value > 0 && value <= 300) {
        this.engine.beginHistory();
        this.engine.setBpm(value);
        this.engine.commitHistory();
      }
      this.bpmInput.value = String(Math.round(this.engine.bpm));
    });
    bpmGroup.appendChild(this.bpmInput);

    // Tap tempo: average the last 4-8 taps, commit as a history transaction.
    const tapBtn = makeBtn('TAP');
    tapBtn.id = 'btn-tap';
    tapBtn.classList.add('hw-tap');
    tapBtn.title = 'Tap tempo to set BPM';
    tapBtn.addEventListener('click', () => this.onTapTempo());
    bpmGroup.appendChild(tapBtn);

    this.barBody.appendChild(bpmGroup);

    // --- Loop group ---
    const loopGroup = document.createElement('div');
    loopGroup.className = 'hw-group hw-loop-group';
    loopGroup.appendChild(makeTag('LOOP'));
    this.loopBtn = makeBtn('L');
    this.loopBtn.title = 'Loop region on/off';
    this.loopBtn.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.toggleLoop();
      this.engine.commitHistory();
      this.sync();
    });
    loopGroup.appendChild(this.loopBtn);
    this.barBody.appendChild(loopGroup);

    // --- Metronome toggle (live click only, history-transacted) ---
    const mtrnGroup = document.createElement('div');
    mtrnGroup.className = 'hw-group hw-mtrn-group';
    mtrnGroup.appendChild(makeTag('MTRN'));
    this.mtrnBtn = makeBtn('MTRN');
    this.mtrnBtn.id = 'btn-metronome';
    this.mtrnBtn.title = 'Toggle metronome (M)';
    this.mtrnBtn.addEventListener('click', () => this.toggleMetronome());
    mtrnGroup.appendChild(this.mtrnBtn);
    this.barBody.appendChild(mtrnGroup);

    // --- Pattern name readout ---
    const patGroup = document.createElement('div');
    patGroup.className = 'hw-group hw-pattern-group';
    patGroup.appendChild(makeTag('PATTERN'));
    this.patternEl = makeReadout('—');
    patGroup.appendChild(this.patternEl);
    this.barBody.appendChild(patGroup);

    // --- Status readout ---
    const statusGroup = document.createElement('div');
    statusGroup.className = 'hw-group hw-status-group';
    statusGroup.appendChild(makeTag('STATUS'));
    this.statusEl = makeReadout('ready', 'hw-readout hw-status');
    statusGroup.appendChild(this.statusEl);
    this.barBody.appendChild(statusGroup);
  }

  private buildFiles() {
    // --- File operations (wall module: rare actions stay out of the bar) ---
    const fileGroup = document.createElement('div');
    fileGroup.className = 'hw-group hw-file-group';

    const saveBtn = makeBtn('SAVE');
    saveBtn.id = 'btn-save';
    saveBtn.addEventListener('click', () => this.saveProject());

    const openBtn = makeBtn('OPEN');
    openBtn.id = 'btn-open';
    openBtn.addEventListener('click', () => this.openProject());

    const newBtn = makeBtn('NEW');
    newBtn.id = 'btn-new';
    newBtn.addEventListener('click', () => this.newProject());

    this.exportBtn = makeBtn('EXPORT');
    this.exportBtn.id = 'btn-export';
    this.exportBtn.classList.add('hw-export');
    this.exportBtn.addEventListener('click', () => this.exportWav());

    fileGroup.append(saveBtn, openBtn, newBtn, this.exportBtn);
    this.filesBody.appendChild(fileGroup);

    this.bindShortcuts();
  }

  private setStatus(message: string, isError = false) {
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('error', isError);
  }

  private sync() {
    this.playBtn.classList.toggle('active', this.engine.isPlaying);
    this.playBtn.textContent = this.engine.isPlaying ? 'STOP' : 'PLAY';
    this.undoBtn.disabled = !this.engine.canUndo;
    this.redoBtn.disabled = !this.engine.canRedo;
    this.loopBtn.classList.toggle('active', this.engine.loopEnabled);
    this.mtrnBtn.classList.toggle('active', this.engine.metronome);
    this.patternEl.textContent = this.engine.patterns[this.engine.currentPatternIndex]?.name ?? '—';
    this.bpmInput.value = String(Math.round(this.engine.bpm));
    this.updatePosition();
  }

  // Live BAR:STEP readout, refreshed from the engine's per-step tick.
  private updatePosition() {
    const steps = Math.max(1, this.engine.totalSteps);
    const bar = Math.ceil(steps / this.engine.stepsPerBar);
    const step = ((steps - 1) % this.engine.stepsPerBar) + 1;
    this.posEl.textContent = `${String(bar).padStart(2, '0')}:${String(step).padStart(2, '0')}`;
  }

  // Tap tempo: average the interval of the last 4-8 taps into a BPM value.
  private onTapTempo() {
    const now = performance.now();
    const last = this.taps[this.taps.length - 1];
    // A pause of 3s+ starts a fresh burst; ignore straggler taps.
    if (last !== undefined && now - last > 3000) this.taps.length = 0;
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();

    if (this.taps.length < 4) {
      this.setStatus(`tap ${4 - this.taps.length} more`);
      return;
    }

    const n = this.taps.length;
    const avgMs = (this.taps[n - 1] - this.taps[0]) / (n - 1);
    const bpm = Math.min(300, Math.max(20, Math.round(60000 / avgMs)));

    this.engine.beginHistory();
    this.engine.setBpm(bpm);
    this.engine.commitHistory();
    this.setStatus(`tap ${bpm} BPM`);
    this.sync();
  }

  // --- Project persistence ---------------------------------------------------

  private saveProject() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.engine.serialize()));
      this.setStatus('project saved');
    } catch (err) {
      console.error('Save failed:', err);
      this.setStatus('save failed (storage full?)', true);
    }
  }

  // Load the saved project on startup without recording an undo entry.
  async autoLoad() {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return;
    try {
      await this.engine.deserialize(JSON.parse(json));
      this.setStatus('project loaded');
    } catch (err) {
      console.error('Auto-load failed:', err);
    }
  }

  private async openProject() {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) {
      this.setStatus('no saved project', true);
      return;
    }
    try {
      this.engine.beginHistory();
      await this.engine.deserialize(JSON.parse(json));
      this.engine.commitHistory();
      this.setStatus('project loaded');
    } catch (err) {
      console.error('Open failed:', err);
      this.setStatus('could not load project', true);
    }
  }

  private newProject() {
    this.engine.beginHistory();
    this.engine.clearProject();
    this.engine.commitHistory();
    localStorage.removeItem(STORAGE_KEY);
    this.setStatus('new project');
  }

  private async exportWav() {
    if (!this.engine.hasContent) {
      this.setStatus('nothing to export yet', true);
      return;
    }
    this.exportBtn.classList.add('busy');
    this.exportBtn.disabled = true;
    const original = this.exportBtn.textContent;
    this.exportBtn.textContent = 'RENDER…';
    try {
      const buffer = await this.engine.offlineRender();
      const blob = audioBufferToWav(buffer);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'voidstation-export.wav';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.setStatus(`exported ${blob.size} bytes`);
    } catch (err) {
      console.error('Export failed:', err);
      this.setStatus('export failed', true);
    } finally {
      this.exportBtn.classList.remove('busy');
      this.exportBtn.disabled = false;
      this.exportBtn.textContent = original;
    }
  }

  // --- Keyboard shortcuts ------------------------------------------------------

  private toggleMetronome() {
    // Metronome is a session preference, not a project edit: no history
    // transaction so the undo stack stays clean.
    this.engine.toggleMetronome();
    this.sync();
  }

  private bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      // Ignore global shortcuts while typing in a field or an editable region.
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      // Space triggers play/stop globally, EXCEPT when a button is focused:
      // then the native button activation handles it and the pad button would
      // otherwise fire twice.
      if (e.code === 'Space' && !typing && el?.tagName !== 'BUTTON') {
        e.preventDefault();
        this.playBtn.click();
      }
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); this.saveProject(); }
        if (k === 'o') { e.preventDefault(); this.openProject(); }
        if (k === 'n') { e.preventDefault(); this.newProject(); }
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) this.engine.redo(); else this.engine.undo(); }
        if (k === 'y') { e.preventDefault(); this.engine.redo(); }
        if (k === 'm') { e.preventDefault(); this.toggleMetronome(); }
      }
    });
  }
}
