// Step Sequencer module: 16-step x 5-track rubber pad matrix.
// Click a pad to toggle that step; the active column follows playback.
// Right-click (or SHIFT+click) an active pad to cycle its velocity accent.

import type { AudioEngine } from '../audio/engine.js';
import { TRACK_NAMES } from './theme.js';

const STEPS = 16;
// Velocity levels, cycled by right-click / SHIFT+click. 1.0 = full accent.
const VELOCITIES = [1, 0.7, 0.45];

export class StepSequencer {
  private engine: AudioEngine;
  private body: HTMLElement;
  private pads: HTMLButtonElement[][] = [];
  private currentStep = -1;
  private grid: HTMLElement | null = null;

  constructor(engine: AudioEngine, body: HTMLElement) {
    this.engine = engine;
    this.body = body;
    this.render();
    this.engine.onPatternChange(() => this.render());
    this.engine.onStepChange(() => this.syncPlayState());
  }

  // Next accent level after `current` (unknown values wrap from full accent).
  private nextVelocity(current: number): number {
    const idx = VELOCITIES.indexOf(current);
    return VELOCITIES[(Math.max(0, idx) + 1) % VELOCITIES.length];
  }

  // Reflect the step's on/off state + accent on a pad (active, --vel).
  private applyPadState(pad: HTMLButtonElement, trackIndex: number, step: number) {
    const track = this.engine.tracks[trackIndex];
    pad.classList.toggle('active', track.pattern[step]);
    pad.style.setProperty('--vel', String(track.velocity[step] ?? 1));
  }

  private cycleVelocity(trackIndex: number, step: number) {
    const track = this.engine.tracks[trackIndex];
    this.engine.setStepVelocity(trackIndex, step, this.nextVelocity(track.velocity[step]));
  }

  private render() {
    this.body.innerHTML = '';
    this.grid = document.createElement('div');
    this.grid.className = 'seq';

    // Header row: step numbers (1..16).
    const header = document.createElement('div');
    header.className = 'seq-header';
    const corner = document.createElement('span');
    corner.className = 'seq-corner';
    corner.textContent = '';
    header.appendChild(corner);
    for (let s = 0; s < STEPS; s++) {
      const num = document.createElement('span');
      num.className = 'seq-num mono';
      num.textContent = String(s + 1);
      header.appendChild(num);
    }
    this.grid.appendChild(header);

    this.pads = [];
    this.engine.tracks.forEach((track, ti) => {
      const row = document.createElement('div');
      row.className = 'seq-row';

      const name = document.createElement('span');
      name.className = 'seq-track mono';
      name.textContent = TRACK_NAMES[ti] ?? track.name;
      row.appendChild(name);

      this.pads[ti] = [];
      for (let s = 0; s < STEPS; s++) {
        const pad = document.createElement('button');
        pad.type = 'button';
        pad.className = 'seq-pad';
        pad.style.setProperty('--pad', `var(--track-${ti})`);
        this.applyPadState(pad, ti, s);
        pad.addEventListener('click', (e) => {
          // SHIFT+click cycles the velocity of an active step instead of toggling.
          if (e.shiftKey) {
            if (this.engine.tracks[ti].pattern[s]) {
              this.engine.beginHistory();
              this.cycleVelocity(ti, s);
              this.engine.commitHistory();
              this.applyPadState(pad, ti, s);
            }
            return;
          }
          this.engine.beginHistory();
          this.engine.toggleStep(ti, s);
          this.engine.commitHistory();
          this.applyPadState(pad, ti, s);
        });
        pad.addEventListener('contextmenu', (e) => {
          // Right-click cycles the velocity of an active step.
          e.preventDefault();
          if (!this.engine.tracks[ti].pattern[s]) return;
          this.engine.beginHistory();
          this.cycleVelocity(ti, s);
          this.engine.commitHistory();
          this.applyPadState(pad, ti, s);
        });
        this.pads[ti][s] = pad;
        row.appendChild(pad);
      }
      this.grid!.appendChild(row);
    });

    this.body.appendChild(this.grid);
    this.currentStep = -1;
  }

  private syncPlayState() {
    if (!this.grid) return;
    if (this.currentStep >= 0) {
      this.grid.querySelectorAll('.seq-pad.playing').forEach((el) => el.classList.remove('playing'));
    }
    if (this.engine.isPlaying) {
      this.currentStep = this.engine.stepIndex;
      this.pads.forEach((row) => {
        const pad = row[this.engine.stepIndex];
        if (pad) pad.classList.add('playing');
      });
    } else {
      this.currentStep = -1;
    }
  }
}
