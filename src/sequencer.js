// Step Sequencer UI: 16-step grid for 2 tracks, click to toggle, visual playback.

class StepSequencer {
  constructor(engine) {
    this.engine = engine;
    this.container = null;
    this.stepElements = []; // [trackIndex][stepIndex] -> element
    this.currentStep = -1;
  }

  // Build the step grid inside the given container element
  mount(container) {
    this.container = container;
    container.innerHTML = '';
    container.classList.add('step-sequencer');

    // Header row with step numbers
    const header = document.createElement('div');
    header.className = 'seq-header';
    header.innerHTML = '<div class="seq-track-label">TRACK</div>' +
      Array.from({ length: 16 }, (_, i) => `<div class="seq-step-num">${i + 1}</div>`).join('');
    container.appendChild(header);

    // Track rows
    this.engine.tracks.forEach((track, trackIndex) => {
      const row = document.createElement('div');
      row.className = 'seq-row';
      row.dataset.track = trackIndex;

      const label = document.createElement('div');
      label.className = 'seq-track-name';
      label.textContent = track.name;
      row.appendChild(label);

      this.stepElements[trackIndex] = [];

      for (let step = 0; step < 16; step++) {
        const btn = document.createElement('button');
        btn.className = 'seq-step';
        btn.dataset.track = trackIndex;
        btn.dataset.step = step;
        btn.type = 'button';
        if (this.engine.tracks[trackIndex].pattern[step]) {
          btn.classList.add('active');
        }
        btn.addEventListener('click', () => this._onStepClick(trackIndex, step, btn));
        this.stepElements[trackIndex][step] = btn;
        row.appendChild(btn);
      }
      container.appendChild(row);
    });

    // Listen for engine transport to highlight current step
    this.engine.onStepChange(() => this._syncPlayState());
  }

  _onStepClick(trackIndex, stepIndex, btn) {
    this.engine.toggleStep(trackIndex, stepIndex);
    btn.classList.toggle('active', this.engine.tracks[trackIndex].pattern[stepIndex]);
  }

  _syncPlayState() {
    if (this.engine.isPlaying) {
      // Clear previous highlight
      if (this.currentStep >= 0) {
        this.stepElements.forEach(trackSteps => {
          if (trackSteps[this.currentStep]) {
            trackSteps[this.currentStep].classList.remove('playing');
          }
        });
      }
      // Highlight current step
      const step = this.engine.stepIndex;
      this.currentStep = step;
      this.stepElements.forEach(trackSteps => {
        if (trackSteps[step]) {
          trackSteps[step].classList.add('playing');
        }
      });
    } else {
      // Stopped - clear all highlights
      if (this.currentStep >= 0) {
        this.stepElements.forEach(trackSteps => {
          if (trackSteps[this.currentStep]) {
            trackSteps[this.currentStep].classList.remove('playing');
          }
        });
        this.currentStep = -1;
      }
    }
  }

  // Clear all steps
  clear() {
    this.engine.tracks.forEach((track, ti) => {
      track.pattern.fill(false);
      this.stepElements[ti].forEach(btn => btn.classList.remove('active'));
    });
  }

  // Load pattern from array of arrays
  loadPattern(patterns) {
    patterns.forEach((pattern, ti) => {
      if (this.engine.tracks[ti]) {
        this.engine.tracks[ti].pattern = [...pattern];
        this.stepElements[ti].forEach((btn, si) => {
          btn.classList.toggle('active', pattern[si]);
        });
      }
    });
  }
}

window.StepSequencer = StepSequencer;