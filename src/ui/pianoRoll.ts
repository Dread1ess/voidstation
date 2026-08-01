// Piano Roll module: 24 pitch rows (B4..C3) x 16 steps.
// - left-drag across empty cells      -> draw a note across those cells
// - drag from a note head's right edge -> resize
// - click a note head                 -> erase
// - click a key on the left           -> preview the note

import type { AudioEngine } from '../audio/engine.js';

const PITCHES = 24;
const STEPS = 16;

export class PianoRoll {
  private engine: AudioEngine;
  private body: HTMLElement;
  private activeTrack = 3;

  private cells: HTMLElement[][] = [];
  private currentStep = -1;

  private drag: { pitch: number; startStep: number; mode: 'draw' | 'resize' | 'erase'; length: number } | null = null;

  constructor(engine: AudioEngine, body: HTMLElement) {
    this.engine = engine;
    this.body = body;
    this.render();
    this.engine.onPatternChange(() => this.render());
    this.engine.onStepChange(() => this.syncPlayState());
  }

  setTrack(index: number) {
    this.activeTrack = index;
    this.render();
  }

  private render() {
    this.body.innerHTML = '';
    this.body.className = 'pr';

    const keys = document.createElement('div');
    keys.className = 'pr-keys';

    const grid = document.createElement('div');
    grid.className = 'pr-grid';

    this.cells = [];
    for (let pitch = 0; pitch < PITCHES; pitch++) {
      // Left key strip (pitch 0 = top = B4, pitch 23 = bottom = C3)
      const midi = 71 - pitch;
      const key = document.createElement('div');
      key.className = 'pr-key' + (this.isBlack(midi) ? ' black' : '');
      if (midi % 12 === 0) {
        key.classList.add('c-label');
        key.textContent = `C${Math.floor(midi / 12) - 1}`;
      }
      key.addEventListener('mousedown', () => {
        this.engine.playSynthNote(this.activeTrack, midi, null, 0.2);
      });
      keys.appendChild(key);

      // Grid row
      const row = document.createElement('div');
      row.className = 'pr-row' + (this.isBlack(midi) ? ' black' : '');
      this.cells[pitch] = [];
      for (let step = 0; step < STEPS; step++) {
        const cell = document.createElement('div');
        cell.className = 'pr-cell';
        cell.dataset.pitch = String(pitch);
        cell.dataset.step = String(step);
        this.applyCellState(cell, pitch, step);
        cell.addEventListener('mousedown', (e) => this.onCellDown(e, pitch, step, cell));
        cell.addEventListener('mouseenter', () => this.onCellEnter(pitch, step));
        this.cells[pitch][step] = cell;
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }

    this.body.append(keys, grid);

    window.addEventListener('mouseup', () => {
      if (this.drag) {
        this.engine.commitHistory();
        this.drag = null;
      }
    });
    this.currentStep = -1;
  }

  private isBlack(midi: number): boolean {
    return [1, 3, 6, 8, 10].includes(midi % 12);
  }

  private applyCellState(cell: HTMLElement, pitch: number, step: number) {
    const grid = this.engine.tracks[this.activeTrack].pianoGrid;
    cell.classList.remove('active', 'tail');
    if (grid[pitch] && grid[pitch][step] > 0) {
      cell.classList.add('active');
      return;
    }
    for (let s = step - 1; s >= 0; s--) {
      const len = grid[pitch] && grid[pitch][s];
      if (len > 0) {
        if (s + len > step) cell.classList.add('tail');
        break;
      }
    }
  }

  private onCellDown(e: MouseEvent, pitch: number, step: number, cell: HTMLElement) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grid = this.engine.tracks[this.activeTrack].pianoGrid;
    this.engine.beginHistory();

    if (grid[pitch][step] > 0) {
      const rect = cell.getBoundingClientRect();
      const inRightHalf = e.clientX - rect.left > rect.width / 2;
      this.drag = { pitch, startStep: step, mode: inRightHalf ? 'resize' : 'erase', length: grid[pitch][step] };
    } else {
      grid[pitch][step] = 1;
      this.drag = { pitch, startStep: step, mode: 'draw', length: 1 };
      this.refreshRow(pitch);
    }
  }

  private onCellEnter(pitch: number, step: number) {
    const d = this.drag;
    if (!d || d.pitch !== pitch) return;
    const grid = this.engine.tracks[this.activeTrack].pianoGrid;

    if (d.mode === 'resize') {
      const minStep = d.startStep;
      if (step >= minStep) {
        grid[pitch][minStep] = step - minStep + 1;
        this.refreshRow(pitch);
      }
      return;
    }

    if (d.mode === 'erase') {
      if (grid[pitch][step] > 0) {
        grid[pitch][step] = 0;
        this.drag = null;
        this.refreshRow(pitch);
      }
      return;
    }

    if (d.mode === 'draw') {
      const start = d.startStep;
      for (let s = start; s <= step; s++) {
        if (!grid[pitch][s]) grid[pitch][s] = 1;
      }
      grid[pitch][start] = step - start + 1;
      this.refreshRow(pitch);
    }
  }

  private refreshRow(pitch: number) {
    for (let s = 0; s < STEPS; s++) {
      const cell = this.cells[pitch] && this.cells[pitch][s];
      if (cell) this.applyCellState(cell, pitch, s);
    }
  }

  private syncPlayState() {
    if (this.currentStep >= 0) {
      this.cells.forEach((row) => {
        const cell = row[this.currentStep];
        if (cell) cell.classList.remove('playing');
      });
    }
    if (this.engine.isPlaying) {
      this.currentStep = this.engine.stepIndex;
      this.cells.forEach((row) => {
        const cell = row[this.engine.stepIndex];
        if (cell) cell.classList.add('playing');
      });
    } else {
      this.currentStep = -1;
    }
  }
}
