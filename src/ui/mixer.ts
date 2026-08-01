// Mixer module: 5 analog channels — fader, pan knob, mute/solo/fx toggles,
// LED meter. Fader/pan drags update the engine in real time.

import type { AudioEngine } from '../audio/engine.js';
import { makeLed, makeTag } from './rack.js';
import { TRACK_NAMES } from './theme.js';

const TRACK_COUNT = 5;

export class Mixer {
  private engine: AudioEngine;
  private body: HTMLElement;

  private meterFills: HTMLElement[] = [];
  private lastLevels: number[] = new Array(TRACK_COUNT).fill(0);

  private onSelect: ((track: number) => void) | null = null;

  constructor(engine: AudioEngine, body: HTMLElement) {
    this.engine = engine;
    this.body = body;
    this.render();
    this.engine.onPatternChange(() => this.syncFromEngine());
    this.engine.onStepChange(() => this.pulseMeters());
  }

  // Called by the app when a track is selected elsewhere (keeps channels in sync).
  setOnSelect(cb: (track: number) => void) {
    this.onSelect = cb;
  }

  private render() {
    this.body.innerHTML = '';
    this.body.className = 'mixer';

    this.meterFills = [];
    this.engine.tracks.forEach((track, i) => {
      const ch = document.createElement('div');
      ch.className = 'mixer-channel' + (i === 0 ? ' selected' : '');

      // Header: name + LED + pan knob
      const head = document.createElement('div');
      head.className = 'mixer-head';

      const led = makeLed({ color: `var(--track-${i})` });
      led.classList.add('hw-led-channel');

      const name = document.createElement('span');
      name.className = 'mixer-name mono';
      name.textContent = TRACK_NAMES[i] ?? track.name;

      const panWrap = document.createElement('div');
      panWrap.className = 'mixer-pan';
      panWrap.appendChild(makeTag('PAN'));
      const knob = document.createElement('div');
      knob.className = 'mixer-knob';
      knob.style.setProperty('--knob-cap', `var(--track-${i})`);
      knob.addEventListener('pointerdown', (e) => this.bindKnobDrag(knob, i, e));
      panWrap.appendChild(knob);
      head.append(led, name, panWrap);

      // Meter
      const meter = document.createElement('div');
      meter.className = 'mixer-meter';
      const fill = document.createElement('div');
      fill.className = 'mixer-meter-fill';
      meter.appendChild(fill);
      this.meterFills[i] = fill;

      // Buttons: mute / solo
      const buttons = document.createElement('div');
      buttons.className = 'mixer-buttons';
      const mute = document.createElement('button');
      mute.type = 'button';
      mute.className = 'hw-btn mixer-btn mute';
      mute.textContent = 'M';
      mute.title = 'Mute';
      const solo = document.createElement('button');
      solo.type = 'button';
      solo.className = 'hw-btn mixer-btn solo';
      solo.textContent = 'S';
      solo.title = 'Solo';
      mute.addEventListener('click', () => {
        this.engine.beginHistory();
        this.engine.toggleMute(i);
        this.engine.commitHistory();
        mute.classList.toggle('active', this.engine.tracks[i].mute);
      });
      solo.addEventListener('click', () => {
        this.engine.beginHistory();
        this.engine.toggleSolo(i);
        this.engine.commitHistory();
        this.syncFromEngine();
      });
      buttons.append(mute, solo);

      // Fader
      const fader = document.createElement('div');
      fader.className = 'mixer-fader';
      fader.appendChild(makeTag('VOL'));
      const trackEl = document.createElement('div');
      trackEl.className = 'mixer-fader-track';
      const cap = document.createElement('div');
      cap.className = 'mixer-fader-cap';
      cap.style.setProperty('--cap-color', `var(--track-${i})`);
      trackEl.appendChild(cap);
      fader.appendChild(trackEl);
      const level = document.createElement('span');
      level.className = 'mixer-fader-level mono';
      fader.appendChild(level);

      ch.append(head, meter, buttons, fader);
      this.body.appendChild(ch);

      this.syncChannel(ch, i, level);
      this.setCapPosition(cap, track.volume);

      ch.addEventListener('click', () => {
        this.body.querySelectorAll('.mixer-channel').forEach((el) => el.classList.remove('selected'));
        ch.classList.add('selected');
        if (this.onSelect) this.onSelect(i);
      });

      this.bindFaderDrag(cap, i, level);
    });
  }

  private syncChannel(ch: HTMLElement, i: number, levelEl: HTMLElement) {
    const mute = ch.querySelector<HTMLButtonElement>('.mixer-btn.mute');
    const solo = ch.querySelector<HTMLButtonElement>('.mixer-btn.solo');
    if (mute) mute.classList.toggle('active', this.engine.tracks[i].mute);
    if (solo) solo.classList.toggle('active', this.engine.tracks[i].solo);
    levelEl.textContent = `${Math.round(this.engine.tracks[i].volume * 100)}%`;
  }

  private syncFromEngine() {
    const levels = this.body.querySelectorAll<HTMLElement>('.mixer-fader-level');
    const caps = this.body.querySelectorAll<HTMLElement>('.mixer-fader-cap');
    this.engine.tracks.forEach((track, i) => {
      if (levels[i]) levels[i].textContent = `${Math.round(track.volume * 100)}%`;
      if (caps[i]) this.setCapPosition(caps[i], track.volume);
    });
  }

  private setCapPosition(cap: HTMLElement, volume: number) {
    const track = cap.parentElement;
    if (!track) return;
    const h = track.clientHeight || 100;
    cap.style.bottom = `${Math.round(volume * (h - 12))}px`;
  }

  // --- Fader drag ---
  private bindFaderDrag(cap: HTMLElement, trackIndex: number, levelEl: HTMLElement) {
    const track = cap.parentElement!;
    let dragging = false;
    let startY = 0;
    let startVol = 0;

    const apply = (clientY: number) => {
      const rect = track.getBoundingClientRect();
      const h = rect.height - 12;
      const y = Math.max(0, Math.min(h, rect.bottom - clientY - 6));
      const volume = y / h;
      this.engine.setTrackVolume(trackIndex, volume);
      this.setCapPosition(cap, volume);
      levelEl.textContent = `${Math.round(volume * 100)}%`;
    };

    cap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cap.setPointerCapture(e.pointerId);
      dragging = true;
      startY = e.clientY;
      startVol = this.engine.tracks[trackIndex].volume;
      this.engine.beginHistory();
      apply(e.clientY);
    });
    cap.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      apply(e.clientY);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.engine.commitHistory();
    };
    cap.addEventListener('pointerup', end);
    cap.addEventListener('pointercancel', end);
  }

  // --- Pan knob drag (vertical: up = right) ---
  private bindKnobDrag(knob: HTMLElement, trackIndex: number, e: PointerEvent) {
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    const startPan = this.engine.tracks[trackIndex].pan;
    const startY = e.clientY;
    this.engine.beginHistory();
    const move = (me: PointerEvent) => {
      const pan = Math.max(-1, Math.min(1, startPan + (startY - me.clientY) / 90));
      this.engine.setTrackPan(trackIndex, pan);
      knob.style.setProperty('--deg', `${pan * 135}deg`);
    };
    const up = () => {
      this.engine.commitHistory();
      knob.removeEventListener('pointermove', move);
      knob.removeEventListener('pointerup', up);
      knob.removeEventListener('pointercancel', up);
    };
    knob.addEventListener('pointermove', move);
    knob.addEventListener('pointerup', up);
    knob.addEventListener('pointercancel', up);
  }

  // Cosmetic meter animation: react to the transport step.
  private pulseMeters() {
    if (!this.engine.isPlaying) {
      this.meterFills.forEach((f) => {
        if (f) f.style.height = '4%';
      });
      this.lastLevels.fill(0);
      return;
    }
    const step = this.engine.stepIndex;
    this.engine.tracks.forEach((track, i) => {
      const hit = track.pattern[step] || (track.pianoGrid.some((row) => row[step] > 0));
      const target = hit ? 40 + Math.random() * 55 : 5 + Math.random() * 12;
      const next = this.lastLevels[i] * 0.4 + target * 0.6;
      this.lastLevels[i] = next;
      const fill = this.meterFills[i];
      if (fill) fill.style.height = `${next.toFixed(1)}%`;
    });
  }
}
