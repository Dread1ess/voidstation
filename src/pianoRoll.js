// Piano Roll UI: 24 pitch rows x 16 step columns grid for synth notes.
//
// Note model: engine.tracks[t].pianoGrid[pitch][step] holds the note length
// in steps (0 = no note). A note is triggered at its head cell; the tail cells
// are drawn visually as an extension of the head.
//
// Mouse behavior:
//   - left-drag across empty cells   -> draw a note spanning those cells
//   - click on a note head           -> erase that note
//   - right-click (or left-drag the head's right edge) -> resize / erase
export class PianoRoll {
    constructor(engine) {
        this.container = null;
        this.activeTrackIndex = 3; // Default to Synth track (index 3)
        this.gridElements = []; // [pitchIndex][stepIndex] -> element
        this.currentStep = -1;
        // Drag state
        this._drag = null;
        this.engine = engine;
    }
    setActiveTrack(trackIndex) {
        if (this.engine.tracks[trackIndex]) {
            this.activeTrackIndex = trackIndex;
            this.render();
        }
    }
    mount(container) {
        this.container = container;
        this.render();
        // Listen to engine transport steps for playback highlight
        this.engine.onStepChange(() => this._syncPlayState());
        // Wire preview notes to piano keys on the left strip
        this._wirePianoKeys();
        // Drag handling across the whole grid
        this.container.addEventListener('mousedown', (e) => this._onMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._onRightClick(e);
        });
    }
    // ---- Grid rendering ----
    render() {
        if (!this.container)
            return;
        this.container.innerHTML = '';
        this.container.className = 'piano-roll-grid';
        const track = this.engine.tracks[this.activeTrackIndex];
        if (!track)
            return;
        this.gridElements = [];
        // 24 pitch rows (pitch 0 = B4, pitch 23 = C3)
        for (let pitch = 0; pitch < 24; pitch++) {
            const row = document.createElement('div');
            row.className = 'pr-row';
            if ([1, 3, 6, 8, 10].includes((23 - pitch) % 12)) {
                row.classList.add('black-key-row');
            }
            this.gridElements[pitch] = [];
            for (let step = 0; step < 16; step++) {
                const cell = document.createElement('div');
                cell.className = 'pr-cell';
                cell.dataset.pitch = String(pitch);
                cell.dataset.step = String(step);
                this._applyCellState(cell, pitch, step);
                this.gridElements[pitch][step] = cell;
                row.appendChild(cell);
            }
            this.container.appendChild(row);
        }
    }
    // Set the visual classes of one cell based on the note data.
    // States: 'empty' | 'head' | 'tail' (tail = note covers this cell but starts earlier).
    _applyCellState(cell, pitch, step) {
        const grid = this.engine.tracks[this.activeTrackIndex].pianoGrid;
        cell.classList.remove('active', 'tail');
        if (grid[pitch] && grid[pitch][step] > 0) {
            cell.classList.add('active');
            return;
        }
        // Is this cell covered by a note starting earlier in the same row?
        for (let s = step - 1; s >= 0; s--) {
            const len = grid[pitch] && grid[pitch][s];
            if (len > 0) {
                if (s + len > step) {
                    cell.classList.add('tail');
                }
                break;
            }
        }
    }
    // ---- Interaction ----
    _onMouseDown(e) {
        if (e.button !== 0)
            return; // left button only
        const cell = this._cellFromEvent(e);
        if (!cell)
            return;
        e.preventDefault();
        const pitch = parseInt(cell.dataset.pitch, 10);
        const step = parseInt(cell.dataset.step, 10);
        const grid = this.engine.tracks[this.activeTrackIndex].pianoGrid;
        this.engine.beginHistory();
        if (grid[pitch][step] > 0) {
            // Note head: right-half click resizes, otherwise erase on mouseup.
            const cellRect = cell.getBoundingClientRect();
            const inRightHalf = (e.clientX - cellRect.left) > cellRect.width / 2;
            this._drag = { pitch, startStep: step, mode: inRightHalf ? 'resize' : 'erase', noteLength: grid[pitch][step] };
        }
        else {
            // Empty cell: start drawing a note from this step.
            grid[pitch][step] = 1;
            this._drag = { pitch, startStep: step, mode: 'draw', noteLength: 1 };
            this._refreshCell(pitch, step);
            this._previewNote(pitch);
        }
    }
    _onMouseMove(e) {
        if (!this._drag)
            return;
        const cell = this._cellFromEvent(e);
        if (!cell)
            return;
        const pitch = parseInt(cell.dataset.pitch, 10);
        const step = parseInt(cell.dataset.step, 10);
        const drag = this._drag;
        const grid = this.engine.tracks[this.activeTrackIndex].pianoGrid;
        if (drag.mode === 'erase') {
            // Erasing while dragging over a note head
            if (pitch === drag.pitch && grid[pitch][step] > 0) {
                this._eraseNote(pitch, step);
                drag.mode = 'draw'; // continue drawing? No - erase only the clicked note. Keep simple.
                this._drag = null;
            }
            return;
        }
        if (drag.mode === 'resize') {
            if (pitch !== drag.pitch)
                return;
            const minStep = drag.startStep;
            // Extend from startStep to the current step (clamp to grid)
            const endStep = Math.max(minStep, Math.min(15, step));
            const newLength = endStep - minStep + 1;
            if (newLength !== drag.noteLength) {
                drag.noteLength = newLength;
                grid[drag.pitch][drag.startStep] = newLength;
                this._refreshCell(drag.pitch, drag.startStep);
                for (let s = minStep; s <= endStep; s++)
                    this._refreshCell(drag.pitch, s);
            }
            return;
        }
        if (drag.mode === 'draw') {
            if (pitch !== drag.pitch)
                return;
            const endStep = Math.max(drag.startStep, Math.min(15, step));
            const newLength = endStep - drag.startStep + 1;
            // Clear any tails extending beyond (keep only contiguous from startStep)
            grid[drag.pitch][drag.startStep] = newLength;
            for (let s = 0; s < 16; s++) {
                if (s !== drag.startStep) {
                    grid[drag.pitch][s] = 0;
                }
            }
            for (let s = 0; s < 16; s++)
                this._refreshCell(drag.pitch, s);
        }
    }
    _onMouseUp(_e) {
        if (!this._drag)
            return;
        const drag = this._drag;
        if (drag.mode === 'erase') {
            // Click without drag on a note head -> erase it
            this._eraseNote(drag.pitch, drag.startStep);
        }
        this._drag = null;
        this.engine.commitHistory();
    }
    _onRightClick(e) {
        const cell = this._cellFromEvent(e);
        if (!cell)
            return;
        const pitch = parseInt(cell.dataset.pitch, 10);
        const step = parseInt(cell.dataset.step, 10);
        if (this.engine.tracks[this.activeTrackIndex].pianoGrid[pitch][step] > 0) {
            this.engine.beginHistory();
            this._eraseNote(pitch, step);
            this.engine.commitHistory();
        }
    }
    _cellFromEvent(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        return el instanceof HTMLElement && el.classList.contains('pr-cell') ? el : null;
    }
    _refreshCell(pitch, step) {
        const cell = this.gridElements[pitch] && this.gridElements[pitch][step];
        if (cell)
            this._applyCellState(cell, pitch, step);
    }
    _eraseNote(pitch, step) {
        const grid = this.engine.tracks[this.activeTrackIndex].pianoGrid;
        if (!grid[pitch] || grid[pitch][step] === 0)
            return;
        grid[pitch][step] = 0;
        // Refresh the whole row in case a tail depended on this note
        for (let s = 0; s < 16; s++)
            this._refreshCell(pitch, s);
    }
    _previewNote(pitch) {
        const midi = 71 - pitch; // pitch 0 = MIDI 71 (B4)
        this.engine.playSynthNote(this.activeTrackIndex, midi, null, 0.2);
    }
    _wirePianoKeys() {
        const keysContainer = document.getElementById('keys');
        if (!keysContainer)
            return;
        const keyRows = keysContainer.querySelectorAll('.key-row');
        keyRows.forEach((keyRow, i) => {
            // i = 0 is top key (B4, MIDI 71), i = 23 is bottom key (C3, MIDI 48)
            const midi = 71 - i;
            keyRow.style.cursor = 'pointer';
            keyRow.addEventListener('mousedown', () => {
                this.engine.playSynthNote(this.activeTrackIndex, midi, null, 0.25);
            });
        });
    }
    _syncPlayState() {
        if (this.engine.isPlaying) {
            // Clear previous step highlight
            if (this.currentStep >= 0) {
                for (let p = 0; p < 24; p++) {
                    if (this.gridElements[p] && this.gridElements[p][this.currentStep]) {
                        this.gridElements[p][this.currentStep].classList.remove('playing');
                    }
                }
            }
            // Highlight current step
            const step = this.engine.stepIndex;
            this.currentStep = step;
            for (let p = 0; p < 24; p++) {
                if (this.gridElements[p] && this.gridElements[p][step]) {
                    this.gridElements[p][step].classList.add('playing');
                }
            }
        }
        else {
            // Stopped
            if (this.currentStep >= 0) {
                for (let p = 0; p < 24; p++) {
                    if (this.gridElements[p] && this.gridElements[p][this.currentStep]) {
                        this.gridElements[p][this.currentStep].classList.remove('playing');
                    }
                }
                this.currentStep = -1;
            }
        }
    }
}
