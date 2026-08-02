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
  private bpmInput!: HTMLInputElement;
  private loopBtn!: HTMLButtonElement;
  private patternEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private exportBtn!: HTMLButtonElement;

  constructor(engine: AudioEngine, barBody: HTMLElement, filesBody: HTMLElement) {
    this.engine = engine;
    this.barBody = barBody;
    this.filesBody = filesBody;
    this.buildBar();
    this.buildFiles();
    this.sync();
    this.engine.onStateChange(() => this.sync());
    this.engine.onPatternChange(() => this.sync());
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
    this.statusEl = makeReadout('ready', 'hw-status');
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
    this.loopBtn.classList.toggle('active', this.engine.loopEnabled);
    this.patternEl.textContent = this.engine.patterns[this.engine.currentPatternIndex]?.name ?? '—';
    this.bpmInput.value = String(Math.round(this.engine.bpm));
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

  private bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        this.playBtn.click();
      }
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); this.saveProject(); }
        if (k === 'o') { e.preventDefault(); this.openProject(); }
        if (k === 'n') { e.preventDefault(); this.newProject(); }
        if (k === 'z') { e.preventDefault(); this.engine.undo(); }
        if (k === 'y') { e.preventDefault(); this.engine.redo(); }
      }
    });
  }
}
