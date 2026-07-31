// Pattern / Playlist bar (FL-style). Sits at the top of the timeline:
// pattern controls on the left (sticky), a row of bar cells for the
// arrangement to the right, aligned with the ruler.
//
// - Click a bar cell to assign the CURRENT pattern to that bar.
// - Right-click (or click the same assigned pattern again) clears the cell.
// - Drag an assigned clip to another bar to move it (swaps if the target is
//   occupied).
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
  private _cellsEl: HTMLElement | null = null;
  private _lastDragAt = 0;
  private _dragClip: {
    fromBar: number;
    patternIndex: number;
    startX: number;
    startY: number;
    active: boolean;
    targetBar: number;
    ghost: HTMLElement | null;
  } | null = null;
  private readonly _dragThreshold = 8; // px of movement before a drag starts

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.render();
    // Widen the shared left gutter (--gutter-w) to match the sticky pattern
    // controls so they never cover the first playlist bars. The cells, ruler
    // corner and piano grid all align to this same gutter.
    const controls = container.querySelector('.pl-controls');
    const w = controls?.getBoundingClientRect().width;
    if (w && w > 0) {
      document.documentElement.style.setProperty('--gutter-w', `${Math.ceil(w)}px`);
    }
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
      const next = name.value.trim() || 'Pattern';
      this.engine.beginHistory();
      this.engine.patterns[this.engine.currentPatternIndex].name = next;
      this.engine.commitHistory();
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
      this.engine.beginHistory();
      this.engine.duplicatePattern();
      this.engine.commitHistory();
      this.render();
    });

    const del = document.createElement('button');
    del.className = 'pl-btn pl-del';
    del.title = 'Delete current pattern';
    del.textContent = '×';
    del.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.deletePattern(this.engine.currentPatternIndex);
      this.engine.commitHistory();
      this.render();
    });

    const loopBtn = document.createElement('button');
    loopBtn.className = 'pl-btn pl-loop';
    loopBtn.title = 'Loop region on/off';
    loopBtn.textContent = 'L';
    loopBtn.classList.toggle('active', this.engine.loopEnabled);
    loopBtn.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.toggleLoop();
      this.engine.commitHistory();
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
        this.engine.beginHistory();
        this.engine.setPlaylistCell(bar, undefined);
        this.engine.commitHistory();
        this.render();
      });
      cell.addEventListener('pointerdown', (e) => this._onCellPointerDown(e, bar));

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
    this._cellsEl = cells;
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
    // The browser synthesizes a click after a drag ends; it targets the common
    // ancestor of press/release (never a cell), so only suppress clicks that
    // arrive immediately after an actual drag (e.g. drag out and back to the
    // same cell, which would otherwise toggle it).
    if (performance.now() - this._lastDragAt < 300) return;
    const cur = this.engine.playlist[bar];
    this.engine.beginHistory();
    // Clicking the same assigned pattern clears it; otherwise assign current.
    if (cur === this.engine.currentPatternIndex) {
      this.engine.setPlaylistCell(bar, undefined);
    } else {
      this.engine.setPlaylistCell(bar, this.engine.currentPatternIndex);
    }
    this.engine.commitHistory();
    this.render();
  }

  // --- Clip drag & drop (move clips along the timeline) ---
  _onCellPointerDown(ev: PointerEvent, bar: number) {
    if (this._dragClip) return; // already dragging
    const patIdx = this.engine.playlist[bar];
    if (patIdx === undefined) return; // only assigned clips are draggable
    ev.preventDefault(); // avoid text selection / native drag
    const cell = ev.currentTarget as HTMLElement;
    cell.setPointerCapture(ev.pointerId);
    this._dragClip = {
      fromBar: bar,
      patternIndex: patIdx,
      startX: ev.clientX,
      startY: ev.clientY,
      active: false,
      targetBar: bar,
      ghost: null,
    };
    const move = (me: PointerEvent) => this._onCellDragMove(me, cell);
    const up = () => {
      cell.removeEventListener('pointermove', move);
      cell.removeEventListener('pointerup', up);
      cell.removeEventListener('pointercancel', cancel);
      this._endDrag();
    };
    const cancel = () => {
      cell.removeEventListener('pointermove', move);
      cell.removeEventListener('pointerup', up);
      cell.removeEventListener('pointercancel', cancel);
      this._cancelDrag();
    };
    cell.addEventListener('pointermove', move);
    cell.addEventListener('pointerup', up);
    cell.addEventListener('pointercancel', cancel);
  }

  _onCellDragMove(ev: PointerEvent, cell: HTMLElement) {
    const d = this._dragClip;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < this._dragThreshold) return;
      d.active = true;
      d.ghost = this._createGhost(d.patternIndex, ev.clientX, ev.clientY);
      const src = this.cells[d.fromBar]?.cell;
      if (src) src.classList.add('dragging');
    }
    const ghost = d.ghost;
    if (ghost) {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    }
    const cellsEl = this._cellsEl;
    if (cellsEl) {
      const rect = cellsEl.getBoundingClientRect();
      const bar = Math.max(0, Math.min(this.PL_BARS - 1, Math.floor((ev.clientX - rect.left) / BAR_W)));
      if (bar !== d.targetBar) {
        this._toggleDropTarget(d.targetBar, false);
        d.targetBar = bar;
        this._toggleDropTarget(bar, true);
      }
    }
    ev.preventDefault();
  }

  _endDrag() {
    const d = this._dragClip;
    if (!d) return;
    if (d.ghost) {
      d.ghost.remove();
      d.ghost = null;
    }
    this._dragClip = null;
    this._toggleDropTarget(d.targetBar, false);
    const src = this.cells[d.fromBar]?.cell;
    if (src) src.classList.remove('dragging');
    if (d.active && d.targetBar !== d.fromBar) {
      this.engine.beginHistory();
      this.engine.movePlaylistClip(d.fromBar, d.targetBar);
      this.engine.commitHistory();
      this.render();
    }
    this._lastDragAt = d.active ? performance.now() : 0;
  }

  _cancelDrag() {
    const d = this._dragClip;
    if (!d) return;
    if (d.ghost) {
      d.ghost.remove();
      d.ghost = null;
    }
    this._dragClip = null;
    this._toggleDropTarget(d.targetBar, false);
    const src = this.cells[d.fromBar]?.cell;
    if (src) src.classList.remove('dragging');
    this._lastDragAt = d.active ? performance.now() : 0;
  }

  _createGhost(patternIndex: number, x: number, y: number): HTMLElement {
    const ghost = document.createElement('div');
    ghost.className = 'ghost-clip mono';
    ghost.textContent = `P${patternIndex + 1}`;
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    document.body.appendChild(ghost);
    return ghost;
  }

  _toggleDropTarget(bar: number, on: boolean) {
    const c = this.cells[bar]?.cell;
    if (c) c.classList.toggle('drop-target', on);
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
      this.engine.beginHistory();

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
        this.engine.commitHistory();
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
