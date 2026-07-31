// Instrument panel UI: waveform + ADSR controls for the active track.
// Classic script (works over file:// too, no ES module needed).

class InstrumentPanel {
  constructor(engine) {
    this.engine = engine;
    this.trackIndex = 3; // Default to Synth track
    this.el = null;
    this._inputs = {};
  }

  mount(el) {
    this.el = el;
    if (!el) return;

    this._inputs = {
      wave: el.querySelector('#instr-wave'),
      attack: el.querySelector('#instr-attack'),
      decay: el.querySelector('#instr-decay'),
      sustain: el.querySelector('#instr-sustain'),
      release: el.querySelector('#instr-release'),
    };
    this._values = {
      attack: el.querySelector('#instr-attack-val'),
      decay: el.querySelector('#instr-decay-val'),
      sustain: el.querySelector('#instr-sustain-val'),
      release: el.querySelector('#instr-release-val'),
    };

    this._inputs.wave.addEventListener('change', () => {
      this.engine.tracks[this.trackIndex].synthType = this._inputs.wave.value;
      this._preview();
    });

    Object.keys(this._inputs).forEach((key) => {
      if (key === 'wave') return;
      const input = this._inputs[key];
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        this.engine.tracks[this.trackIndex].adsr[key] = v;
        this._values[key].textContent = v.toFixed(3);
      });
      input.addEventListener('change', () => this._preview());
    });

    this.render();
  }

  // Point the panel at a specific track and refresh the controls.
  setTrack(trackIndex) {
    if (!this.engine.tracks[trackIndex]) return;
    this.trackIndex = trackIndex;
    this.render();
  }

  render() {
    if (!this.el) return;
    const track = this.engine.tracks[this.trackIndex];
    if (!track) return;

    const nameEl = this.el.querySelector('#instrument-name');
    if (nameEl) nameEl.textContent = track.name;

    const adsr = track.adsr || { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 };
    this._inputs.wave.value = track.synthType || 'sawtooth';
    this._inputs.attack.value = adsr.attack;
    this._inputs.decay.value = adsr.decay;
    this._inputs.sustain.value = adsr.sustain;
    this._inputs.release.value = adsr.release;

    this._values.attack.textContent = adsr.attack.toFixed(3);
    this._values.decay.textContent = adsr.decay.toFixed(3);
    this._values.sustain.textContent = adsr.sustain.toFixed(2);
    this._values.release.textContent = adsr.release.toFixed(2);
  }

  _preview() {
    // Play a short preview note so the user hears the current wave/ADSR
    this.engine.playSynthNote(this.trackIndex, 60, null, 0.3);
  }
}

window.InstrumentPanel = InstrumentPanel;
