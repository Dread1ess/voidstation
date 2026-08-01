// FX Rack module: per-track insert effects (reverb / delay / EQ) for the
// currently selected mixer channel. Add, enable, reorder, remove and tweak
// params live; slider drags commit a single undo entry.

import type { AudioEngine } from '../audio/engine.js';
import type { TrackEffect } from '../types.js';
import { makeBtn, makeReadout, makeTag } from './rack.js';
import { TRACK_NAMES } from './theme.js';

interface FxParam { key: string; label: string; min: number; max: number; step: number; get: (fx: TrackEffect) => number }

const FX_PARAMS: Record<TrackEffect['type'], FxParam[]> = {
  reverb: [
    { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, get: (fx) => (fx as TrackEffect & { mix: number }).mix },
  ],
  delay: [
    { key: 'time', label: 'TIME', min: 0.02, max: 1.4, step: 0.01, get: (fx) => (fx as TrackEffect & { time: number }).time },
    { key: 'feedback', label: 'FDBK', min: 0, max: 0.95, step: 0.01, get: (fx) => (fx as TrackEffect & { feedback: number }).feedback },
    { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, get: (fx) => (fx as TrackEffect & { mix: number }).mix },
  ],
  eq: [
    { key: 'low', label: 'LOW', min: -15, max: 15, step: 1, get: (fx) => (fx as TrackEffect & { low: number }).low },
    { key: 'mid', label: 'MID', min: -15, max: 15, step: 1, get: (fx) => (fx as TrackEffect & { mid: number }).mid },
    { key: 'high', label: 'HIGH', min: -15, max: 15, step: 1, get: (fx) => (fx as TrackEffect & { high: number }).high },
  ],
};

const FX_LABELS: Record<TrackEffect['type'], string> = {
  reverb: 'REVERB',
  delay: 'DELAY',
  eq: 'EQ 3-BAND',
};

function formatValue(key: string, value: number): string {
  if (key === 'time') return `${value.toFixed(2)}s`;
  if (key === 'feedback' || key === 'mix') return `${Math.round(value * 100)}%`;
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}dB`;
}

export class FxRack {
  private engine: AudioEngine;
  private body: HTMLElement;

  private trackIndex = 0;
  private trackNameEl!: HTMLElement;
  private listEl!: HTMLElement;
  private emptyEl!: HTMLElement;

  constructor(engine: AudioEngine, body: HTMLElement) {
    this.engine = engine;
    this.body = body;
    this.render();
    this.engine.onPatternChange(() => this.renderList());
  }

  setTrack(index: number) {
    this.trackIndex = index;
    this.trackNameEl.textContent = `${index + 1}. ${TRACK_NAMES[index] ?? this.engine.tracks[index]?.name ?? ''}`;
    this.renderList();
  }

  private render() {
    this.body.innerHTML = '';
    this.body.className = 'fx';

    // Header: selected track name + add buttons
    const header = document.createElement('div');
    header.className = 'fx-header';
    this.trackNameEl = makeReadout('1. KICK', 'fx-track');
    header.appendChild(this.trackNameEl);
    const addRow = document.createElement('div');
    addRow.className = 'fx-add-row';
    addRow.appendChild(makeTag('ADD'));
    const addBtns = document.createElement('div');
    addBtns.className = 'fx-add-buttons';
    (['reverb', 'delay', 'eq'] as const).forEach((type) => {
      const btn = makeBtn(FX_LABELS[type], 'fx-add');
      btn.dataset.fxAdd = type;
      btn.addEventListener('click', () => this.addEffect(type));
      addBtns.appendChild(btn);
    });
    addRow.appendChild(addBtns);
    header.append(this.trackNameEl, addRow);
    this.body.appendChild(header);

    // List of effects for the selected track
    this.listEl = document.createElement('div');
    this.listEl.className = 'fx-list';
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'fx-empty';
    this.emptyEl.textContent = 'No insert effects on this track.';
    this.body.appendChild(this.listEl);

    this.renderList();
  }

  private addEffect(type: TrackEffect['type']) {
    this.engine.beginHistory();
    this.engine.addEffect(this.trackIndex, type);
    this.engine.commitHistory();
    this.renderList();
  }

  // --- List rendering (delegated events) -----------------------------------

  private renderList() {
    const effects = this.engine.tracks[this.trackIndex]?.effects ?? [];
    this.listEl.innerHTML = '';
    if (!effects.length) {
      this.listEl.appendChild(this.emptyEl);
      return;
    }
    effects.forEach((fx, i) => {
      this.listEl.appendChild(this.buildRow(fx, i));
    });
  }

  private buildRow(fx: TrackEffect, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fx-row' + (fx.enabled ? '' : ' fx-disabled');

    // Head: enable toggle + type name + reverb preset + reorder/remove
    const head = document.createElement('div');
    head.className = 'fx-row-head';

    const enableLabel = document.createElement('label');
    enableLabel.className = 'fx-enable-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'fx-enable';
    checkbox.checked = fx.enabled;
    checkbox.addEventListener('change', () => {
      this.engine.beginHistory();
      this.engine.setEffectEnabled(this.trackIndex, index, checkbox.checked);
      this.engine.commitHistory();
      row.classList.toggle('fx-disabled', !checkbox.checked);
    });
    const typeName = document.createElement('span');
    typeName.className = 'fx-type-name mono';
    typeName.textContent = FX_LABELS[fx.type];
    enableLabel.append(checkbox, typeName);
    head.appendChild(enableLabel);

    if (fx.type === 'reverb') {
      const preset = document.createElement('select');
      preset.className = 'fx-preset';
      preset.title = 'Reverb preset';
      (['room', 'hall', 'plate'] as const).forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
        opt.selected = fx.preset === p;
        preset.appendChild(opt);
      });
      preset.addEventListener('change', () => {
        this.engine.beginHistory();
        this.engine.setEffectParam(this.trackIndex, index, 'preset', preset.value);
        this.engine.commitHistory();
      });
      head.appendChild(preset);
    }

    head.appendChild(this.orderButtons(index));
    row.appendChild(head);

    // Params sliders
    const sliders = document.createElement('div');
    sliders.className = 'fx-sliders';
    FX_PARAMS[fx.type].forEach((p) => {
      sliders.appendChild(this.buildSlider(fx, index, p));
    });
    row.appendChild(sliders);

    return row;
  }

  private orderButtons(index: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'fx-order';
    const up = makeBtn('▲');
    up.title = 'Move up';
    up.addEventListener('click', () => this.move(index, index - 1));
    const down = makeBtn('▼');
    down.title = 'Move down';
    down.addEventListener('click', () => this.move(index, index + 1));
    const remove = makeBtn('×');
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      this.engine.beginHistory();
      this.engine.removeEffect(this.trackIndex, index);
      this.engine.commitHistory();
      this.renderList();
    });
    wrap.append(up, down, remove);
    return wrap;
  }

  private move(from: number, to: number) {
    const effects = this.engine.tracks[this.trackIndex]?.effects ?? [];
    if (to < 0 || to >= effects.length || from === to) return;
    this.engine.beginHistory();
    this.engine.moveEffect(this.trackIndex, from, to);
    this.engine.commitHistory();
    this.renderList();
  }

  private buildSlider(fx: TrackEffect, index: number, p: FxParam): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'fx-param';

    const label = document.createElement('span');
    label.className = 'fx-param-label';
    label.textContent = p.label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(p.min);
    slider.max = String(p.max);
    slider.step = String(p.step);
    slider.value = String(p.get(fx));

    const readout = document.createElement('span');
    readout.className = 'fx-param-val mono';
    readout.textContent = formatValue(p.key, p.get(fx));

    const el = slider as HTMLInputElement & { _fxGesture?: boolean };
    slider.addEventListener('input', () => {
      if (!el._fxGesture) {
        el._fxGesture = true;
        this.engine.beginHistory();
      }
      const val = parseFloat(slider.value);
      this.engine.setEffectParam(this.trackIndex, index, p.key, val);
      readout.textContent = formatValue(p.key, val);
    });
    slider.addEventListener('change', () => {
      if (el._fxGesture) {
        el._fxGesture = false;
        this.engine.commitHistory();
      }
    });

    wrap.append(label, slider, readout);
    return wrap;
  }
}
