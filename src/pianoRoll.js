// Piano Roll UI: 24 pitch rows x 16 step columns grid for synth notes.
// Classic script (works over file:// too, no ES module needed).

class PianoRoll {
  constructor(engine) {
    this.engine = engine;
    this.container = null;
    this.activeTrackIndex = 3; // Default to Synth track (index 3)
    this.gridElements = []; // [pitchIndex][stepIndex] -> element
    this.currentStep = -1;
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
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.container.className = 'piano-roll-grid';

    const track = this.engine.tracks[this.activeTrackIndex];
    if (!track) return;

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
        cell.dataset.pitch = pitch;
        cell.dataset.step = step;

        if (track.pianoGrid[pitch] && track.pianoGrid[pitch][step]) {
          cell.classList.add('active');
        }

        cell.addEventListener('mousedown', (e) => {
          if (e.buttons === 1) {
            this._toggleNote(pitch, step, cell);
          }
        });

        this.gridElements[pitch][step] = cell;
        row.appendChild(cell);
      }

      this.container.appendChild(row);
    }
  }

  _toggleNote(pitch, step, cell) {
    const track = this.engine.tracks[this.activeTrackIndex];
    if (!track) return;

    const isActive = !track.pianoGrid[pitch][step];
    track.pianoGrid[pitch][step] = isActive;
    cell.classList.toggle('active', isActive);

    // Play preview note when adding a note
    if (isActive) {
      const midi = 71 - pitch; // pitch 0 = MIDI 71 (B4)
      this.engine.playSynthNote(this.activeTrackIndex, midi, null, 0.2);
    }
  }

  _wirePianoKeys() {
    const keysContainer = document.getElementById('keys');
    if (!keysContainer) return;

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
    } else {
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

window.PianoRoll = PianoRoll;
