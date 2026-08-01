// Playlist module: pattern clip arrangement + loop region.
// - Click a bar cell   -> assign the current pattern to that bar
// - Right-click a cell -> clear it
// - Drag a clip        -> move it along the timeline (swap if occupied)
// - Teal band marks the loop region; its edges are draggable.

import type { AudioEngine } from '../audio/engine.js';
import { makeBtn, makeReadout } from './rack.js';

const BAR_W = 96;
const BARS = 20;

export class Playlist {
  private engine: AudioEngine;
  private body: HTMLElement;

  private cells: HTMLElement[] = [];
  private band: HTMLElement | null = null;
  private handleStart: HTMLElement | null = null;
  private handleEnd: HTMLElement | null = null;
  private patternEl: HTMLInputElement | null = null;
  private countEl: HTMLElement | null = null;
  private loopBtn: HTMLButtonElement | null = null;

  private currentBar = -1;
  private lastDragAt = 0;

  constructor(engine: AudioEngine, body: HTMLElement) {
    this.engine = engine;
    this.body = body;
    this.render();
    this.engine.onPatternChange(() => { this.render(); this.syncControls(); });
    this.engine.onStepChange(() => this.syncPlayState());
  }

  private render() {
    this.body.innerHTML = '';

    // --- Toolbar: pattern prev/next/name/count/add/del/loop ---
    const toolbar = document.createElement('div');
    toolbar.className = 'pl-toolbar';

    const prev = makeBtn('◀');
    prev.addEventListener('click', () => this.switchBy(-1));
    const next = makeBtn('▶');
    next.addEventListener('click', () => this.switchBy(1));

    const name = document.createElement('input');
    name.className = 'pl-name mono';
    name.value = this.engine.patterns[this.engine.currentPatternIndex]?.name ?? '';
    name.addEventListener('change', () => {
      const val = name.value.trim() || 'Pattern';
      this.engine.beginHistory();
      this.engine.patterns[this.engine.currentPatternIndex].name = val;
      this.engine.commitHistory();
      this.syncControls();
    });
    this.patternEl = name;

    this.countEl = makeReadout('', 'pl-count');

    const add = makeBtn('+');
    add.title = 'Duplicate current pattern';
    add.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.duplicatePattern();
      this.engine.commitHistory();
      this.syncControls();
    });

    const del = makeBtn('×');
    del.title = 'Delete current pattern';
    del.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.deletePattern(this.engine.currentPatternIndex);
      this.engine.commitHistory();
      this.syncControls();
    });

    this.loopBtn = makeBtn('L');
    this.loopBtn.title = 'Loop region on/off';
    this.loopBtn.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.toggleLoop();
      this.engine.commitHistory();
      this.syncControls();
    });

    toolbar.append(prev, next, name, this.countEl, add, del, this.loopBtn);
    this.body.appendChild(toolbar);

    // --- Bar cells ---
    const strip = document.createElement('div');
    strip.className = 'pl-strip';

    const cellsRow = document.createElement('div');
    cellsRow.className = 'pl-cells';

    this.cells = [];
    for (let bar = 0; bar < BARS; bar++) {
      const cell = document.createElement('div');
      cell.className = 'pl-cell';
      cell.dataset.bar = String(bar);
      cell.style.width = `${BAR_W}px`;

      const num = document.createElement('span');
      num.className = 'pl-cell-num mono';
      num.textContent = String(bar + 1);
      const val = document.createElement('span');
      val.className = 'pl-cell-val mono';
      this.setCellValue(val, bar);

      cell.append(num, val);
      cell.addEventListener('click', () => this.onCellClick(bar));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.engine.beginHistory();
        this.engine.setPlaylistCell(bar, undefined);
        this.engine.commitHistory();
        this.render();
      });
      cell.addEventListener('pointerdown', (e) => this.onCellDown(e, bar));

      cellsRow.appendChild(cell);
      this.cells[bar] = cell;
    }

    // --- Loop region overlay ---
    this.band = document.createElement('div');
    this.band.className = 'pl-loop-band';
    this.handleStart = document.createElement('div');
    this.handleStart.className = 'pl-loop-handle pl-loop-start';
    this.handleEnd = document.createElement('div');
    this.handleEnd.className = 'pl-loop-handle pl-loop-end';
    cellsRow.append(this.band, this.handleStart, this.handleEnd);
    this.attachHandleDrag(cellsRow, this.handleStart, 'start');
    this.attachHandleDrag(cellsRow, this.handleEnd, 'end');

    strip.appendChild(cellsRow);
    this.body.appendChild(strip);

    this.syncControls();
    this.syncPlayState();
  }

  private switchBy(delta: number) {
    const n = this.engine.patterns.length;
    const idx = (this.engine.currentPatternIndex + delta + n) % n;
    this.engine.switchPattern(idx);
  }

  private setCellValue(el: HTMLElement, bar: number) {
    const idx = this.engine.playlist[bar];
    if (idx !== undefined && this.engine.patterns[idx]) {
      el.textContent = `P${idx + 1}`;
      el.classList.add('assigned');
    } else {
      el.textContent = '·';
      el.classList.remove('assigned');
    }
  }

  private onCellClick(bar: number) {
    if (performance.now() - this.lastDragAt < 300) return;
    const cur = this.engine.playlist[bar];
    this.engine.beginHistory();
    if (cur === this.engine.currentPatternIndex) {
      this.engine.setPlaylistCell(bar, undefined);
    } else {
      this.engine.setPlaylistCell(bar, this.engine.currentPatternIndex);
    }
    this.engine.commitHistory();
    this.render();
  }

  // --- Clip drag & drop ---
  private dragClip: { fromBar: number; targetBar: number; active: boolean; startX: number; startY: number } | null = null;

  private onCellDown(e: PointerEvent, bar: number) {
    if (this.dragClip) return;
    const idx = this.engine.playlist[bar];
    if (idx === undefined) return;
    e.preventDefault();
    const cell = e.currentTarget as HTMLElement;
    cell.setPointerCapture(e.pointerId);
    this.dragClip = { fromBar: bar, targetBar: bar, active: false, startX: e.clientX, startY: e.clientY };

    const move = (me: PointerEvent) => {
      const d = this.dragClip;
      if (!d) return;
      if (!d.active && Math.hypot(me.clientX - d.startX, me.clientY - d.startY) >= 6) {
        d.active = true;
        this.cells[d.fromBar]?.classList.add('dragging');
      }
      const strip = cell.parentElement;
      if (strip) {
        const rect = strip.getBoundingClientRect();
        const target = Math.max(0, Math.min(BARS - 1, Math.floor((me.clientX - rect.left) / BAR_W)));
        if (target !== d.targetBar) {
          this.toggleDropTarget(d.targetBar, false);
          d.targetBar = target;
          this.toggleDropTarget(target, true);
        }
      }
    };
    const up = () => {
      const d = this.dragClip;
      if (!d) return;
      this.dragClip = null;
      this.toggleDropTarget(d.targetBar, false);
      this.cells[d.fromBar]?.classList.remove('dragging');
      if (d.active && d.targetBar !== d.fromBar) {
        this.engine.beginHistory();
        this.engine.movePlaylistClip(d.fromBar, d.targetBar);
        this.engine.commitHistory();
        this.render();
      }
      this.lastDragAt = d.active ? performance.now() : 0;
      cell.removeEventListener('pointermove', move);
      cell.removeEventListener('pointerup', up);
      cell.removeEventListener('pointercancel', up);
    };
    cell.addEventListener('pointermove', move);
    cell.addEventListener('pointerup', up);
    cell.addEventListener('pointercancel', up);
  }

  private toggleDropTarget(bar: number, on: boolean) {
    this.cells[bar]?.classList.toggle('drop-target', on);
  }

  // --- Loop region ---
  private syncControls() {
    const pat = this.engine.patterns[this.engine.currentPatternIndex];
    if (!pat) return;
    if (this.patternEl) this.patternEl.value = pat.name;
    if (this.countEl) this.countEl.textContent = `${this.engine.currentPatternIndex + 1}/${this.engine.patterns.length}`;
    if (this.loopBtn) this.loopBtn.classList.toggle('active', this.engine.loopEnabled);
    this.updateLoopVisuals();
  }

  private updateLoopVisuals() {
    const e = this.engine;
    const band = this.band, hs = this.handleStart, he = this.handleEnd;
    if (!band || !hs || !he) return;
    const visible = e.playlist.length > 0 && e.loopEnabled;
    band.style.display = visible ? 'block' : 'none';
    hs.style.display = visible ? 'block' : 'none';
    he.style.display = visible ? 'block' : 'none';
    if (visible) {
      const start = e.loopStart;
      const end = e._effectiveLoopEnd();
      band.style.left = `${start * BAR_W}px`;
      band.style.width = `${(end - start) * BAR_W}px`;
      hs.style.left = `${start * BAR_W - 3}px`;
      he.style.left = `${end * BAR_W - 3}px`;
    }
    const dimFrom = e.playlist.length > 0 && e.loopEnabled ? e._effectiveLoopEnd() : Infinity;
    this.cells.forEach((cell, bar) => cell.classList.toggle('beyond', bar >= dimFrom));
  }

  private attachHandleDrag(container: HTMLElement, handle: HTMLElement, which: 'start' | 'end') {
    handle.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      handle.setPointerCapture(ev.pointerId);
      this.engine.beginHistory();
      const move = (me: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const bar = Math.max(0, Math.min(BARS, Math.round((me.clientX - rect.left) / BAR_W)));
        if (which === 'start') {
          const end = this.engine._effectiveLoopEnd();
          this.engine.loopStart = Math.max(0, Math.min(bar, end - 1));
        } else {
          this.engine.loopEnd = Math.max(this.engine.loopStart + 1, bar);
        }
        this.updateLoopVisuals();
      };
      const up = () => {
        this.engine.setLoopRegion(this.engine.loopStart, this.engine.loopEnd);
        this.engine.commitHistory();
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  private syncPlayState() {
    if (!this.engine.isPlaying) {
      if (this.currentBar >= 0) {
        this.cells[this.currentBar]?.classList.remove('playing');
        this.currentBar = -1;
      }
      return;
    }
    const absBar = Math.floor(this.engine.totalSteps / this.engine.stepsPerBar);
    const mapped = this.engine.playlist.length > 0 ? this.engine._barInLoop(absBar) : absBar;
    const bar = mapped % BARS;
    if (bar !== this.currentBar) {
      if (this.currentBar >= 0) this.cells[this.currentBar]?.classList.remove('playing');
      this.cells[bar]?.classList.add('playing');
      this.currentBar = bar;
    }
  }
}
