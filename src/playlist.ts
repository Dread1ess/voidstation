// Pattern / Playlist bar (FL-style). Sits at the top of the timeline:
// pattern controls on the left (sticky), a row of bar cells for the
// arrangement to the right, aligned with the ruler.
//
// - Click a bar cell to assign the CURRENT pattern to that bar.
// - Right-click (or click the same assigned pattern again) clears the cell.
// - An empty playlist plays the active pattern on a loop (legacy behaviour).
// - The teal band marks the loop region (bars loopStart..loopEnd-1); its
//   edges are draggable and the L button toggles looping.

import type { AudioEngine } from './audio/engine.js';

interface PlaylistCell {
  cell: HTMLElement;
  value: HTMLElement;
}

const BAR_W = 160; // bar width in px, keep in sync with .pl-cell / --beat-w * 4

export class PlaylistBar {
  engine: AudioEngine;
  container: HTMLElement | null = null;
  cells: PlaylistCell[] = [];
  PL_BARS = 20; // keep in sync with --bars (20 bars, 160px each)
  _currentBar = -1;
  private _loopBand: HTMLElement | null = null;
  private _loopHandleStart: HTMLElement | null = null;
  private _loopHandleEnd: HTMLElement | null = null;
  private _loopRange: HTMLElement | null = null;

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

    const loopBtn = document.createElement('button');
    loopBtn.className = 'pl-btn pl-loop';
    loopBtn.title = 'Loop region on/off';
    loopBtn.textContent = 'L';
    loopBtn.classList.toggle('active', this.engine.loopEnabled);
    loopBtn.addEventListener('click', () => {
      this.engine.toggleLoop();
      this.render();
    });

    const loopRange = document.createElement('span');
    loopRange.className = 'pl-loop-range mono';
    this._loopRange = loopRange;

    controls.append(prev, next, name, count, add, del, loopBtn, loopRange);

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

    // --- Loop region overlay (band + draggable start/end handles) ---
    const band = document.createElement('div');
    band.className = 'loop-region';
    const hStart = document.createElement('div');
    hStart.className = 'loop-handle loop-start';
    hStart.title = 'Loop start (drag)';
    const hEnd = document.createElement('div');
    hEnd.className = 'loop-handle loop-end';
    hEnd.title = 'Loop end / playlist length (drag)';
    cells.append(band, hStart, hEnd);
    this._loopBand = band;
    this._loopHandleStart = hStart;
    this._loopHandleEnd = hEnd;
    this._attachHandleDrag(cells, hStart, 'start');
    this._attachHandleDrag(cells, hEnd, 'end');

    el.append(controls, cells);
    this._updateLoopVisuals();
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

  // Position the loop band/handles, refresh the range readout and dim cells
  // beyond the loop end. Called on every render and during handle drags
  // (in place, so a drag is not interrupted by a rebuild).
  _updateLoopVisuals() {
    const e = this.engine;
    const visible = e.playlist.length > 0 && e.loopEnabled;
    const band = this._loopBand;
    const hStart = this._loopHandleStart;
    const hEnd = this._loopHandleEnd;
    if (!band || !hStart || !hEnd) return;

    band.style.display = visible ? 'block' : 'none';
    hStart.style.display = visible ? 'block' : 'none';
    hEnd.style.display = visible ? 'block' : 'none';

    if (visible) {
      const start = e.loopStart;
      const end = e._effectiveLoopEnd();
      band.style.left = `${start * BAR_W}px`;
      band.style.width = `${(end - start) * BAR_W}px`;
      hStart.style.left = `${start * BAR_W - 3}px`;
      hEnd.style.left = `${end * BAR_W - 3}px`;
    }

    if (this._loopRange) {
      if (e.playlist.length === 0) {
        this._loopRange.textContent = '—';
      } else {
        this._loopRange.textContent = `${e.loopStart + 1}–${e._effectiveLoopEnd()}`;
      }
    }

    const dimFrom = e.playlist.length > 0 && e.loopEnabled ? e._effectiveLoopEnd() : Infinity;
    this.cells.forEach(({ cell }, bar) => {
      cell.classList.toggle('beyond', bar >= dimFrom);
    });
  }

  _attachHandleDrag(container: HTMLElement, handle: HTMLElement, which: 'start' | 'end') {
    handle.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      handle.setPointerCapture(ev.pointerId);

      // Update engine fields in place and refresh visuals only — a full
      // render() here would rebuild the handles mid-drag and lose capture.
      const move = (me: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const bar = Math.max(0, Math.min(this.PL_BARS, Math.round((me.clientX - rect.left) / BAR_W)));
        if (which === 'start') {
          const end = this.engine._effectiveLoopEnd();
          this.engine.loopStart = Math.max(0, Math.min(bar, end - 1));
        } else {
          this.engine.loopEnd = Math.max(this.engine.loopStart + 1, bar);
        }
        this._updateLoopVisuals();
      };

      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        // Finalize + notify listeners (pattern change re-renders the strip).
        this.engine.setLoopRegion(this.engine.loopStart, this.engine.loopEnd);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
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
    const absBar = Math.floor(this.engine.totalSteps / this.engine.stepsPerBar);
    const mapped = this.engine.playlist.length > 0 ? this.engine._barInLoop(absBar) : absBar;
    const bar = mapped % this.PL_BARS;
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
