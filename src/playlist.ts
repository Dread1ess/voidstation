// Pattern / Playlist bar (FL-style). Sits at the top of the timeline:
// pattern controls on the left (sticky), a row of bar cells for the
// arrangement to the right, aligned with the ruler.
//
// - Click a bar cell to assign the CURRENT pattern to that bar.
// - Right-click (or click the same assigned pattern again) clears the cell.
// - An empty playlist plays the active pattern on a loop (legacy behaviour).

import type { AudioEngine } from './audio/engine.js';

interface PlaylistCell {
  cell: HTMLElement;
  value: HTMLElement;
}

export class PlaylistBar {
  engine: AudioEngine;
  container: HTMLElement | null = null;
  cells: PlaylistCell[] = [];
  PL_BARS = 20; // keep in sync with --bars (20 bars, 160px each)
  _currentBar = -1;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.render();
    this.engine.onPatternChange(() => this.render());
    this.engine.onStepChange(() => this._syncPlayState());
    this.engine.onStateChange(() => this._syncPlayState());
  }

  render() {
    if (!this.container) return;
    const el = this.container;
    el.innerHTML = '';
    el.classList.add('playlist-strip');

    // --- Pattern controls (sticky left) ---
    const controls = document.createElement('div');
    controls.className = 'pl-controls';

    const prev = document.createElement('button');
    prev.className = 'pl-btn';
    prev.title = 'Previous pattern';
    prev.textContent = '◀';
    prev.addEventListener('click', () => {
      const next = (this.engine.currentPatternIndex - 1 + this.engine.patterns.length) % this.engine.patterns.length;
      this.engine.switchPattern(next);
    });

    const next = document.createElement('button');
    next.className = 'pl-btn';
    next.title = 'Next pattern';
    next.textContent = '▶';
    next.addEventListener('click', () => {
      const nextIdx = (this.engine.currentPatternIndex + 1) % this.engine.patterns.length;
      this.engine.switchPattern(nextIdx);
    });

    const name = document.createElement('input');
    name.className = 'pl-name mono';
    name.value = this.engine.patterns[this.engine.currentPatternIndex].name;
    name.title = 'Pattern name';
    name.addEventListener('change', () => {
      this.engine.patterns[this.engine.currentPatternIndex].name = name.value.trim() || 'Pattern';
      name.value = this.engine.patterns[this.engine.currentPatternIndex].name;
      this.render();
    });

    const count = document.createElement('span');
    count.className = 'pl-count mono';
    count.textContent = `${this.engine.currentPatternIndex + 1}/${this.engine.patterns.length}`;

    const add = document.createElement('button');
    add.className = 'pl-btn';
    add.title = 'Duplicate current pattern';
    add.textContent = '+';
    add.addEventListener('click', () => {
      this.engine.duplicatePattern();
      this.render();
    });

    const del = document.createElement('button');
    del.className = 'pl-btn pl-del';
    del.title = 'Delete current pattern';
    del.textContent = '×';
    del.addEventListener('click', () => {
      this.engine.deletePattern(this.engine.currentPatternIndex);
      this.render();
    });

    controls.append(prev, next, name, count, add, del);

    // --- Playlist cells ---
    const cells = document.createElement('div');
    cells.className = 'pl-cells';

    this.cells = [];
    for (let bar = 0; bar < this.PL_BARS; bar++) {
      const cell = document.createElement('div');
      cell.className = 'pl-cell';
      cell.dataset.bar = String(bar);

      const label = document.createElement('span');
      label.className = 'pl-cell-num mono';
      label.textContent = String(bar + 1);

      const value = document.createElement('span');
      value.className = 'pl-cell-val mono';
      this._setCellValue(value, bar);

      cell.append(label, value);

      cell.addEventListener('click', () => this._onCellClick(bar));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.engine.setPlaylistCell(bar, undefined);
        this.render();
      });

      cells.appendChild(cell);
      this.cells.push({ cell, value });
    }

    el.append(controls, cells);
    this._syncPlayState();
  }

  _setCellValue(el: HTMLElement, bar: number) {
    const patIdx = this.engine.playlist[bar];
    if (patIdx !== undefined && this.engine.patterns[patIdx]) {
      el.textContent = `P${patIdx + 1}`;
      el.classList.add('assigned');
    } else {
      el.textContent = '·';
      el.classList.remove('assigned');
    }
  }

  _onCellClick(bar: number) {
    const cur = this.engine.playlist[bar];
    // Clicking the same assigned pattern clears it; otherwise assign current.
    if (cur === this.engine.currentPatternIndex) {
      this.engine.setPlaylistCell(bar, undefined);
    } else {
      this.engine.setPlaylistCell(bar, this.engine.currentPatternIndex);
    }
    this.render();
  }

  _syncPlayState() {
    if (!this.engine.isPlaying) {
      if (this._currentBar >= 0) {
        const prev = this.cells[this._currentBar];
        if (prev) prev.cell.classList.remove('playing');
        this._currentBar = -1;
      }
      return;
    }
    const bar = Math.floor(this.engine.totalSteps / this.engine.stepsPerBar) % this.PL_BARS;
    if (bar !== this._currentBar) {
      if (this._currentBar >= 0) {
        const prev = this.cells[this._currentBar];
        if (prev) prev.cell.classList.remove('playing');
      }
      const cur = this.cells[bar];
      if (cur) cur.cell.classList.add('playing');
      this._currentBar = bar;
    }
  }
}

declare global {
  interface Window {
    PlaylistBar: typeof PlaylistBar;
  }
}
window.PlaylistBar = PlaylistBar;
