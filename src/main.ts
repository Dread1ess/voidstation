// Entry point: wires the transport, step sequencer, mixer, and audio engine.
// ESM module — imports every other module explicitly; loaded from index.html
// as the single runtime entry (app.js stays a classic script for static UI).

import { AudioEngine } from './audio/engine.js';
import { audioBufferToWav } from './audio/wav.js';
import { StepSequencer } from './sequencer.js';
import { PianoRoll } from './pianoRoll.js';
import { InstrumentPanel } from './instrument.js';
import { PlaylistBar } from './playlist.js';
import type { TrackEffect } from './types.js';

const STORAGE_KEY = 'voidstation-project-v1';

const engine = new AudioEngine();
const sequencer = new StepSequencer(engine);
const pianoRoll = new PianoRoll(engine);
const instrument = new InstrumentPanel(engine);
const playlist = new PlaylistBar(engine);

const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
const btnLoad = document.getElementById('btn-load')!;
const btnPlay = document.getElementById('btn-play')!;
const btnStop = document.getElementById('btn-stop')!;
const btnRec = document.getElementById('btn-rec')!;
const btnSave = document.getElementById('btn-save')!;
const btnOpen = document.getElementById('btn-open')!;
const btnNew = document.getElementById('btn-new')!;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const bpmInput = document.querySelector<HTMLInputElement>('#bpm-input')!;
const sampleName = document.getElementById('sample-name')!;
const dropOverlay = document.getElementById('drop-overlay')!;

// Current track index (0=Kick,1=Snare,2=Bass,3=Synth,4=Pads)
let currentLoadTrack = 3; // Default to Synth

// Initialize step sequencer UI
sequencer.mount(document.getElementById('step-sequencer')!);

// Initialize Piano Roll UI
const pianoGridEl = document.getElementById('piano-roll-grid');
if (pianoGridEl) {
  pianoRoll.mount(pianoGridEl);
  pianoRoll.setActiveTrack(3); // Start with Synth track
}

// Initialize Instrument panel (synth controls)
const instrumentEl = document.getElementById('instrument-panel');
if (instrumentEl) {
  instrument.mount(instrumentEl);
  instrument.setTrack(3);
}

// Initialize Pattern / Playlist bar
const playlistEl = document.getElementById('playlist-strip');
if (playlistEl) {
  playlist.mount(playlistEl);
}
// Pattern toolbar (prev/next/name/count/add/del/loop) lives in the sidebar;
// the timeline keeps only the clean bar cells.
playlist.mountPatternControls(document.getElementById('pattern-controls'));

// Per-track syntax-highlight colors (VS Code palette), used by the step
// sequencer matrix and the piano-roll note fill.
const TRACK_COLORS = ['#4ec9b0', '#ce9178', '#569cd6', '#c586c0', '#6a9955'];

// Explorer: pattern list (one tree row per pattern, click to select).
function renderPatternTree() {
  const host = document.getElementById('pattern-list');
  if (!host) return;
  host.innerHTML = '';
  engine.patterns.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'tree-item tree-file' + (i === engine.currentPatternIndex ? ' selected' : '');
    const arrow = document.createElement('span');
    arrow.textContent = '▸';
    arrow.className = i === engine.currentPatternIndex ? 'tree-color-accent' : '';
    const name = document.createElement('span');
    name.className = 'tree-name';
    if (i === engine.currentPatternIndex) name.id = 'tree-current-pattern';
    name.textContent = `${p.name}.pattern`;
    name.title = p.name;
    row.append(arrow, name);
    row.addEventListener('click', () => engine.switchPattern(i));
    host.appendChild(row);
  });
}
renderPatternTree();
engine.onPatternChange(() => renderPatternTree());

// When the active pattern changes, re-render editors that show its data
engine.onPatternChange(() => {
  sequencer.render();
  pianoRoll.render();
  syncEditorTabName();
});

// Keep the editor tab label in sync with pattern renames
playlist.onNameChange = (name) => { updateEditorTabName(name); syncStatusBar(); };

function updateEditorTabName(name: string) {
  const tabName = document.getElementById('tab-pattern-name');
  if (tabName) tabName.textContent = name;
  const treeName = document.getElementById('tree-current-pattern');
  if (treeName) treeName.textContent = name;
}
function syncEditorTabName() {
  const pat = engine.patterns[engine.currentPatternIndex];
  if (pat) updateEditorTabName(pat.name);
}

function syncStatusBar() {
  const bpmItem = document.getElementById('status-bpm');
  if (bpmItem) bpmItem.textContent = `BPM: ${engine.bpm.toFixed(2)}`;
  const patItem = document.getElementById('status-pattern');
  const pat = engine.patterns[engine.currentPatternIndex];
  if (patItem && pat) patItem.textContent = `${pat.name}.pattern`;
  const transportItem = document.getElementById('status-transport');
  if (transportItem) transportItem.textContent = engine.isPlaying ? 'Playing' : 'Stopped';
}

function syncButtons() {
  btnPlay.classList.toggle('active', engine.isPlaying);
  btnStop.classList.toggle('active', !engine.isPlaying);
  syncStatusBar();
}

function setStatus(message: string, isError = false) {
  sampleName.textContent = message;
  sampleName.classList.toggle('loaded', !isError && message !== 'no sample');
}

// --- Sample loading ---
async function loadSample(file: File | undefined, trackIndex: number = currentLoadTrack) {
  if (!file) return;
  try {
    await engine.loadSample(file, trackIndex);
    const track = engine.tracks[trackIndex];
    setStatus(`${track.name}: ${file.name}`);
    highlightCurrentTrack(trackIndex);
  } catch (err) {
    console.error('Failed to load sample:', err);
    setStatus('could not load sample', true);
  }
}

function highlightCurrentTrack(trackIndex: number) {
  currentLoadTrack = trackIndex;
  const channels = document.querySelectorAll('.channel');
  channels.forEach((ch, i) => ch.classList.toggle('selected', i === trackIndex));
  pianoRoll.setActiveTrack(trackIndex);
  instrument.setTrack(trackIndex);
  document.documentElement.style.setProperty('--note-color', TRACK_COLORS[trackIndex % TRACK_COLORS.length]);
}

btnLoad.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  loadSample(fileInput.files?.[0]);
  fileInput.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    dragDepth += 1;
    dropOverlay.classList.add('visible');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('visible');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('visible');
  if (!e.dataTransfer) return;
  const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('audio'));
  if (file) loadSample(file);
});

// --- Transport ---
btnPlay.addEventListener('click', () => {
  if (!engine.hasContent) {
    setStatus('load a sample or add notes first', true);
    return;
  }
  engine.startTransport();
});
btnStop.addEventListener('click', () => engine.stopTransport());
btnRec.addEventListener('click', () => btnRec.classList.toggle('active'));

engine.onStateChange(syncButtons);
syncButtons();

// --- BPM ---
bpmInput.addEventListener('change', () => {
  const value = parseFloat(bpmInput.value);
  if (Number.isFinite(value) && value > 0) {
    engine.beginHistory();
    engine.setBpm(value);
    engine.commitHistory();
    bpmInput.value = value.toFixed(3);
  } else {
    bpmInput.value = engine.bpm.toFixed(3);
  }
});

// --- Mixer height (drag the top edge like a window border, persisted) ---
const mixer = document.querySelector<HTMLElement>('.mixer');
const MIXER_H_KEY = 'voidstation-mixer-height';
const MIN_MIXER_H = 128;
const maxMixerH = () => Math.max(MIN_MIXER_H, window.innerHeight - 200);

if (mixer) {
  const savedH = parseInt(localStorage.getItem(MIXER_H_KEY) || '', 10);
  if (Number.isFinite(savedH)) {
    mixer.style.height = `${Math.max(MIN_MIXER_H, Math.min(savedH, maxMixerH()))}px`;
  }

  const handle = document.createElement('div');
  handle.className = 'mixer-resize-handle';
  handle.title = 'Drag to resize the mixer';
  mixer.prepend(handle);

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = mixer.getBoundingClientRect().height;
    const move = (me: PointerEvent) => {
      const h = Math.max(MIN_MIXER_H, Math.min(maxMixerH(), startH + (startY - me.clientY)));
      mixer.style.height = `${h}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      localStorage.setItem(MIXER_H_KEY, String(Math.round(mixer.getBoundingClientRect().height)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

// --- Mixer faders (drag to set volume) ---
interface FaderHandle {
  fader: HTMLElement;
  cap: HTMLElement;
  setLevel: (clientY: number) => void;
  setCapPosition: (t: number) => void;
}

const faders: FaderHandle[] = [];
document.querySelectorAll<HTMLElement>('.fader').forEach((fader, faderIndex) => {
  const cap = fader.querySelector<HTMLElement>('.fader-cap')!;
  const faderHeight = fader.clientHeight;
  const capHeight = cap.offsetHeight;
  let dragging = false;

  function setCapPosition(t: number) {
    cap.style.top = `${t * (faderHeight - capHeight)}px`;
  }

  function setLevel(clientY: number) {
    const rect = fader.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientY - rect.top - capHeight / 2) / (faderHeight - capHeight)));
    setCapPosition(t);
    engine.setTrackVolume(faderIndex, t);
    // Update meter fill proportionally
    const meterFill = fader.parentElement!.querySelector<HTMLElement>('.meter-fill');
    if (meterFill) meterFill.style.height = `${t * 100}%`;
  }

  cap.addEventListener('pointerdown', (e) => {
    fader.setPointerCapture(e.pointerId);
    dragging = true;
    engine.beginHistory();
    setLevel(e.clientY);
  });
  fader.addEventListener('pointermove', (e) => {
    if (dragging) setLevel(e.clientY);
  });
  fader.addEventListener('pointerup', () => { dragging = false; engine.commitHistory(); });
  fader.addEventListener('pointercancel', () => { dragging = false; engine.commitHistory(); });

  faders.push({ fader, cap, setLevel, setCapPosition });
});

// --- Mixer pan knobs (vertical drag, double-click resets to center) ---
interface KnobHandle {
  knob: HTMLElement;
}
const panKnobs: KnobHandle[] = [];
document.querySelectorAll<HTMLElement>('.channel').forEach((ch, i) => {
  const knob = ch.querySelector<HTMLElement>('.channel-head .knob');
  if (!knob) return;

  const applyPan = (pan: number) => {
    engine.setTrackPan(i, pan);
    knob.style.setProperty('--deg', `${pan * 135}deg`);
  };

  let dragging = false;
  let dragPan = 0;
  let dragStartY = 0;
  knob.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    dragging = true;
    dragPan = engine.tracks[i].pan;
    dragStartY = e.clientY;
    engine.beginHistory();
  });
  knob.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const pan = Math.max(-1, Math.min(1, dragPan + (dragStartY - e.clientY) / 100));
    applyPan(pan);
  });
  const endDrag = () => { dragging = false; engine.commitHistory(); };
  knob.addEventListener('pointerup', endDrag);
  knob.addEventListener('pointercancel', endDrag);
  knob.addEventListener('dblclick', () => {
    engine.beginHistory();
    applyPan(0);
    engine.commitHistory();
  });

  panKnobs.push({ knob });
});

// --- Mixer mute/solo buttons ---
const channels = Array.from(document.querySelectorAll<HTMLElement>('.channel'));
const muteButtons: (HTMLButtonElement | null)[] = [];
const soloButtons: (HTMLButtonElement | null)[] = [];
channels.forEach((ch, i) => {
  const muteBtn = ch.querySelector<HTMLButtonElement>('.mini-btn[data-mute]');
  muteButtons[i] = muteBtn;
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      engine.beginHistory();
      engine.toggleMute(i);
      engine.commitHistory();
      muteBtn.classList.toggle('active-mute', engine.tracks[i].mute);
    });
  }
  const soloBtn = ch.querySelector<HTMLButtonElement>('.mini-btn[data-solo]');
  soloButtons[i] = soloBtn;
  if (soloBtn) {
    soloBtn.addEventListener('click', () => {
      engine.beginHistory();
      engine.toggleSolo(i);
      engine.commitHistory();
      soloBtn.classList.toggle('active-solo', engine.tracks[i].solo);
    });
  }
});

// --- Insert FX panel ---
let fxTrackIndex = 0;
const fxPanel = document.getElementById('fx-panel') as HTMLElement | null;
const fxTrackName = document.getElementById('fx-track-name') as HTMLElement | null;
const fxList = document.getElementById('fx-list') as HTMLElement | null;
const fxClose = document.getElementById('fx-close') as HTMLButtonElement | null;

function updateFxButtons() {
  document.querySelectorAll<HTMLElement>('.fx-btn').forEach((btn, i) => {
    btn.classList.toggle('active-fx', engine.tracks[i]?.effects.some(e => e.enabled) ?? false);
  });
}

function formatFxValue(key: string, v: number) {
  if (key === 'low' || key === 'mid' || key === 'high') return `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`;
  return v.toFixed(2);
}

function fxParamMeta(fx: TrackEffect): { key: string; label: string; min: number; max: number; step: number; value: number }[] {
  if (fx.type === 'reverb') {
    return [{ key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, value: fx.mix }];
  }
  if (fx.type === 'delay') {
    return [
      { key: 'time', label: 'TIME', min: 0.02, max: 1.4, step: 0.01, value: fx.time },
      { key: 'feedback', label: 'FDBK', min: 0, max: 0.95, step: 0.01, value: fx.feedback },
      { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, value: fx.mix },
    ];
  }
  return [
    { key: 'low', label: 'LOW', min: -15, max: 15, step: 1, value: fx.low },
    { key: 'mid', label: 'MID', min: -15, max: 15, step: 1, value: fx.mid },
    { key: 'high', label: 'HIGH', min: -15, max: 15, step: 1, value: fx.high },
  ];
}

function openFxPanel(trackIndex: number) {
  if (!fxPanel) return;
  fxTrackIndex = trackIndex;
  if (fxTrackName) fxTrackName.textContent = engine.tracks[trackIndex]?.name ?? '';
  if (mixer) {
    const r = mixer.getBoundingClientRect();
    fxPanel.style.bottom = `${Math.max(8, window.innerHeight - r.top + 12)}px`;
  }
  fxPanel.hidden = false;
  renderFxList();
}

function closeFxPanel() {
  if (fxPanel) fxPanel.hidden = true;
}

function renderFxList() {
  if (!fxList) return;
  const effects = engine.tracks[fxTrackIndex]?.effects ?? [];
  if (!effects.length) {
    fxList.innerHTML = '<div class="fx-empty">No insert effects on this track.</div>';
    updateFxButtons();
    return;
  }
  fxList.innerHTML = effects.map((fx, i) => {
    const params = fxParamMeta(fx);
    const sliders = params.map(p => `
      <label class="fx-param">
        <span class="fx-param-label">${p.label}</span>
        <input type="range" data-fx-param="${i}:${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}">
        <span class="fx-param-val" data-fx-val="${i}:${p.key}">${formatFxValue(p.key, p.value)}</span>
      </label>`).join('');
    const preset = fx.type === 'reverb' ? `
      <select class="fx-preset" data-fx-preset="${i}" title="Reverb preset">
        <option value="room"${fx.preset === 'room' ? ' selected' : ''}>Room</option>
        <option value="hall"${fx.preset === 'hall' ? ' selected' : ''}>Hall</option>
        <option value="plate"${fx.preset === 'plate' ? ' selected' : ''}>Plate</option>
      </select>` : '';
    return `
      <div class="fx-row${fx.enabled ? '' : ' fx-disabled'}">
        <div class="fx-row-head">
          <label class="fx-enable-label">
            <input type="checkbox" class="fx-enable" data-fx-enable="${i}"${fx.enabled ? ' checked' : ''}>
            <span class="fx-type-name">${fx.type.toUpperCase()}${fx.type === 'eq' ? ' 3-BAND' : ''}</span>
          </label>
          ${preset}
          <span class="fx-spacer"></span>
          <button class="mini-btn" data-fx-up="${i}" title="Move up">▲</button>
          <button class="mini-btn" data-fx-down="${i}" title="Move down">▼</button>
          <button class="mini-btn" data-fx-remove="${i}" title="Remove">×</button>
        </div>
        <div class="fx-sliders">${sliders}</div>
      </div>`;
  }).join('');
  updateFxButtons();
}

document.querySelectorAll<HTMLElement>('.fx-btn').forEach((btn, i) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openFxPanel(i);
    highlightCurrentTrack(i);
    setStatus(`FX: ${engine.tracks[i].name}`);
  });
});

document.querySelectorAll<HTMLElement>('.fx-add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = (btn.dataset.fxAdd || 'reverb') as TrackEffect['type'];
    engine.beginHistory();
    engine.addEffect(fxTrackIndex, type);
    engine.commitHistory();
    renderFxList();
  });
});

fxClose?.addEventListener('click', closeFxPanel);

// Delegated events inside the effect list (add/remove/reorder/params).
if (fxList) {
  fxList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const up = target.closest<HTMLElement>('[data-fx-up]');
    const down = target.closest<HTMLElement>('[data-fx-down]');
    const remove = target.closest<HTMLElement>('[data-fx-remove]');
    if (up) {
      const i = Number(up.dataset.fxUp);
      engine.beginHistory();
      engine.moveEffect(fxTrackIndex, i, i - 1);
      engine.commitHistory();
      renderFxList();
    } else if (down) {
      const i = Number(down.dataset.fxDown);
      engine.beginHistory();
      engine.moveEffect(fxTrackIndex, i, i + 1);
      engine.commitHistory();
      renderFxList();
    } else if (remove) {
      const i = Number(remove.dataset.fxRemove);
      engine.beginHistory();
      engine.removeEffect(fxTrackIndex, i);
      engine.commitHistory();
      renderFxList();
    }
  });

  fxList.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    const enable = target.closest<HTMLInputElement>('.fx-enable');
    if (enable) {
      const i = Number(enable.dataset.fxEnable);
      engine.beginHistory();
      engine.setEffectEnabled(fxTrackIndex, i, enable.checked);
      engine.commitHistory();
      renderFxList();
      return;
    }
    const preset = target.closest<HTMLSelectElement>('[data-fx-preset]');
    if (preset) {
      const i = Number(preset.dataset.fxPreset);
      engine.beginHistory();
      engine.setEffectParam(fxTrackIndex, i, 'preset', preset.value);
      engine.commitHistory();
    }
  });

  // Range sliders: live param update, single undo entry per drag.
  fxList.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const param = target.dataset.fxParam;
    if (!param) return;
    const colon = param.indexOf(':');
    const idx = Number(param.slice(0, colon));
    const key = param.slice(colon + 1);
    const val = parseFloat(target.value);
    if (!(target as { _fxGesture?: boolean })._fxGesture) {
      (target as { _fxGesture?: boolean })._fxGesture = true;
      engine.beginHistory();
    }
    engine.setEffectParam(fxTrackIndex, idx, key, val);
    const readout = fxList.querySelector(`[data-fx-val="${param}"]`) as HTMLElement | null;
    if (readout) readout.textContent = formatFxValue(key, val);
  });
  fxList.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (!target.dataset.fxParam) return;
    const el = target as { _fxGesture?: boolean };
    if (el._fxGesture) {
      el._fxGesture = false;
      engine.commitHistory();
    }
  });
}

// Close the panel on an outside click or Escape.
document.addEventListener('pointerdown', (e) => {
  if (!fxPanel || fxPanel.hidden) return;
  const t = e.target as HTMLElement;
  if (fxPanel.contains(t) || t.closest('.fx-btn')) return;
  closeFxPanel();
});

// Refresh the whole UI to match current engine state (used after load/new/clear)
function refreshAllUI() {
  bpmInput.value = engine.bpm.toFixed(3);

  // Step sequencer grid
  sequencer.render();

  // Piano roll
  pianoRoll.render();

  // Instrument panel
  instrument.render();

  // Mixer faders + meters
  faders.forEach((f, i) => {
    const t = engine.tracks[i].volume;
    f.setCapPosition(t);
    const meterFill = f.fader.parentElement!.querySelector<HTMLElement>('.meter-fill');
    if (meterFill) meterFill.style.height = `${t * 100}%`;
  });

  // Pan knobs
  panKnobs.forEach((k, i) => {
    k.knob.style.setProperty('--deg', `${engine.tracks[i].pan * 135}deg`);
  });

  // Mute/solo buttons
  muteButtons.forEach((btn, i) => {
    if (btn) btn.classList.toggle('active-mute', engine.tracks[i].mute);
  });
  soloButtons.forEach((btn, i) => {
    if (btn) btn.classList.toggle('active-solo', engine.tracks[i].solo);
  });

  // Sample name readout (reflects what a LOAD would target — the active track)
  const activeTrack = engine.tracks[currentLoadTrack];
  if (activeTrack?.sampleName) {
    setStatus(`${activeTrack.name}: ${activeTrack.sampleName}`);
  } else {
    setStatus('no sample');
  }

  // Insert FX buttons + panel
  updateFxButtons();
  if (fxPanel && !fxPanel.hidden) renderFxList();

  // Playlist cells + sidebar pattern list/toolbar
  playlist.render();
  renderPatternTree();

  syncEditorTabName();
  syncStatusBar();
}

// --- Project save / load (localStorage) ---
function saveProject() {
  try {
    const json = JSON.stringify(engine.serialize());
    localStorage.setItem(STORAGE_KEY, json);
    setStatus('project saved');
  } catch (err) {
    console.error('Save failed:', err);
    setStatus('save failed (storage full?)', true);
  }
}

async function openProject() {
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) {
    setStatus('no saved project', true);
    return;
  }
  try {
    engine.beginHistory();
    await engine.deserialize(JSON.parse(json));
    engine.commitHistory();
    refreshAllUI();
    setStatus('project loaded');
  } catch (err) {
    console.error('Open failed:', err);
    setStatus('could not load project', true);
  }
}

function newProject() {
  engine.beginHistory();
  engine.clearProject();
  engine.commitHistory();
  localStorage.removeItem(STORAGE_KEY);
  refreshAllUI();
  setStatus('new project');
}

btnSave.addEventListener('click', saveProject);
btnOpen.addEventListener('click', openProject);
btnNew.addEventListener('click', newProject);

// --- WAV export (offline render) ---
btnExport.addEventListener('click', async () => {
  if (btnExport.classList.contains('busy')) return;
  if (!engine.hasContent) {
    setStatus('nothing to export yet', true);
    return;
  }
  btnExport.classList.add('busy');
  btnExport.disabled = true;
  const originalLabel = btnExport.textContent;
  btnExport.textContent = 'RENDERING…';
  try {
    const buffer = await engine.offlineRender();
    const blob = audioBufferToWav(buffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voidstation-export.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus(`exported ${blob.size} bytes`);
  } catch (err) {
    console.error('Export failed:', err);
    setStatus('export failed', true);
  } finally {
    btnExport.classList.remove('busy');
    btnExport.disabled = false;
    btnExport.textContent = originalLabel;
  }
});

// Auto-load the saved project on startup
openProject();

// --- Channel click selects the track (piano roll + instrument panel) ---
channels.forEach((ch, i) => {
  ch.addEventListener('click', () => {
    highlightCurrentTrack(i);
    setStatus(`Track: ${engine.tracks[i].name}`);
  });
});

// ============================================================
// VS Code style chrome: activity bar, sidebar, bottom panel,
// command palette
// ============================================================

const activityBar = document.getElementById('activity-bar');
const sidebar = document.getElementById('sidebar');
const sidebarSections = Array.from(document.querySelectorAll<HTMLElement>('.sidebar-section'));
const bottomPanel = document.getElementById('bottom-panel');
const bottomTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.bt-tab'));
const palette = document.getElementById('palette');
const paletteInput = document.querySelector<HTMLInputElement>('#palette-input');
const paletteList = document.getElementById('palette-list');

function showSidebarSection(name: string) {
  activityBar?.querySelectorAll('.act-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-activity') === name);
  });
  sidebarSections.forEach((sec) => {
    sec.classList.toggle('hidden', sec.getAttribute('data-section') !== name);
  });
  sidebar?.classList.remove('hidden');
}

function showBottomTab(name: string) {
  if (!bottomPanel) return;
  bottomTabs.forEach((b) => b.classList.toggle('active', b.getAttribute('data-btab') === name));
  bottomPanel.querySelectorAll<HTMLElement>('[data-btab]').forEach((el) => {
    el.hidden = el.getAttribute('data-btab') !== name;
  });
}

activityBar?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.act-btn') as HTMLElement | null;
  if (!btn) return;
  const name = btn.getAttribute('data-activity');
  if (!name) return;
  if (btn.classList.contains('active') && !sidebar?.classList.contains('hidden')) {
    sidebar?.classList.add('hidden');
    btn.classList.remove('active');
    return;
  }
  showSidebarSection(name);
});

const btnSidebarClose = document.getElementById('btn-sidebar-close');
btnSidebarClose?.addEventListener('click', () => {
  sidebar?.classList.add('hidden');
  activityBar?.querySelectorAll('.act-btn').forEach((b) => b.classList.remove('active'));
});

bottomTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.getAttribute('data-btab');
    if (!name) return;
    showBottomTab(name);
  });
});

const btnBottomClose = document.getElementById('btn-bottom-close');
btnBottomClose?.addEventListener('click', () => bottomPanel?.classList.add('hidden'));

// --- Command palette ---
interface PaletteCmd {
  title: string;
  kbd: string;
  run: () => void;
}
const paletteCommands: PaletteCmd[] = [
  { title: 'Play / Stop', kbd: 'Space', run: () => { engine.isPlaying ? engine.stop() : engine.startTransport(); syncButtons(); } },
  { title: 'New Project', kbd: '', run: () => btnNew.click() },
  { title: 'Open Project', kbd: '', run: () => btnOpen.click() },
  { title: 'Save Project', kbd: '', run: () => btnSave.click() },
  { title: 'Export WAV', kbd: '', run: () => btnExport.click() },
  { title: 'Load Sample', kbd: '', run: () => fileInput.click() },
  { title: 'Toggle Sidebar', kbd: 'Ctrl+B', run: () => sidebar?.classList.toggle('hidden') },
  { title: 'Recenter Board', kbd: 'Ctrl+J', run: () => recenterView() },
  { title: 'View: Explorer', kbd: 'Ctrl+Shift+E', run: () => showSidebarSection('explorer') },
  { title: 'View: Tracks', kbd: 'Ctrl+Shift+T', run: () => showSidebarSection('tracks') },
  { title: 'View: Source Control', kbd: 'Ctrl+Shift+G', run: () => showSidebarSection('git') },
  { title: 'View: Audio FX', kbd: 'Ctrl+Shift+X', run: () => showSidebarSection('fx') },
];

function openPalette() {
  if (!palette) return;
  palette.hidden = false;
  paletteInput?.focus();
  renderPalette(paletteCommands);
}
function closePalette() {
  if (palette) palette.hidden = true;
}
function renderPalette(cmds: PaletteCmd[]) {
  if (!paletteList) return;
  paletteList.innerHTML = '';
  if (cmds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'No matching commands';
    paletteList.appendChild(empty);
    return;
  }
  cmds.forEach((cmd) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    const label = document.createElement('span');
    label.textContent = cmd.title;
    const kbd = document.createElement('span');
    kbd.className = 'kbd';
    kbd.textContent = cmd.kbd;
    item.append(label, kbd);
    item.addEventListener('click', () => {
      closePalette();
      cmd.run();
    });
    paletteList.appendChild(item);
  });
}

paletteInput?.addEventListener('input', () => {
  const q = paletteInput.value.trim().toLowerCase();
  if (!q) { renderPalette(paletteCommands); return; }
  renderPalette(paletteCommands.filter((c) => c.title.toLowerCase().includes(q)));
});
paletteInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const sel = paletteList?.querySelector('.palette-item');
    (sel as HTMLElement | null)?.click();
  }
  if (e.key === 'Escape') closePalette();
});
palette?.addEventListener('pointerdown', (e) => {
  if (e.target === palette) closePalette();
});

// Clicking an editor tab selects the single pattern editor (placeholder for now)
const editorTab = document.querySelector('.editor-tab');
editorTab?.addEventListener('click', () => {
  document.querySelectorAll('.editor-tab').forEach((t) => t.classList.remove('active'));
  editorTab.classList.add('active');
});

// --- Keyboard shortcuts ---
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeFxPanel();
    closePalette();
  }
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (mod && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    sidebar?.classList.toggle('hidden');
    return;
  }
  if (mod && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    recenterView();
    return;
  }

  // Let text/number fields handle their own keys (native undo inside inputs).
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;

  const keys: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 };
  if (keys[e.key] !== undefined) {
    highlightCurrentTrack(keys[e.key]);
    setStatus(`Track: ${engine.tracks[keys[e.key]].name}`);
  }

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      engine.redo().then(done => { if (done) { refreshAllUI(); setStatus('redo'); } });
    } else {
      engine.undo().then(done => { if (done) { refreshAllUI(); setStatus('undo'); } });
    }
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    engine.redo().then(done => { if (done) { refreshAllUI(); setStatus('redo'); } });
  }
});

// ============================================================
// BOARD STUDIO: infinite canvas pan/zoom, draggable hardware
// units, hardware catalog, virtual patch cables
// ============================================================

const boardViewport = document.getElementById('board-viewport');
const board = document.getElementById('board');
const zoomLabel = document.getElementById('zoom-label');

const BOARD_KEY = 'voidstation-board-v1';
const BOARD_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;

let zoom = 1;
let panX = 0;
let panY = 0;
let spaceDown = false;
let panning = false;
let zCounter = 10;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

function applyBoardTransform() {
  if (!board) return;
  board.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  boardViewport?.classList.toggle('panning', panning);
}

function screenToBoard(cx: number, cy: number) {
  const r = boardViewport!.getBoundingClientRect();
  return { x: (cx - r.left - panX) / zoom, y: (cy - r.top - panY) / zoom };
}

function zoomAt(cx: number, cy: number, factor: number) {
  const r = boardViewport!.getBoundingClientRect();
  const bx = cx - r.left, by = cy - r.top;
  const wx = (bx - panX) / zoom, wy = (by - panY) / zoom;
  zoom = clampZoom(zoom * factor);
  panX = bx - wx * zoom;
  panY = by - wy * zoom;
  applyBoardTransform();
}

function recenterView() {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyBoardTransform();
  saveBoardState();
}

function centerOn(el: HTMLElement) {
  const v = boardViewport!.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const target = screenToBoard(v.left + v.width / 2, v.top + v.height / 2);
  const cur = screenToBoard(r.left + r.width / 2, r.top + r.height / 2);
  panX += (target.x - cur.x) * zoom;
  panY += (target.y - cur.y) * zoom;
  applyBoardTransform();
}

function bringToFront(el: HTMLElement) {
  el.style.zIndex = String(++zCounter);
}

// --- pan: middle-drag or Space + left-drag ---
if (boardViewport) {
  boardViewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    saveBoardState();
  }, { passive: false });

  boardViewport.addEventListener('pointerdown', (e) => {
    const middle = e.button === 1;
    if (!middle && !spaceDown) return;
    e.preventDefault();
    panning = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panStart = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    applyBoardTransform();
  });
  boardViewport.addEventListener('pointermove', (e) => {
    if (!panning) return;
    panX = panStart.px + (e.clientX - panStart.x);
    panY = panStart.py + (e.clientY - panStart.y);
    applyBoardTransform();
  });
  const endPan = () => {
    if (!panning) return;
    panning = false;
    applyBoardTransform();
    saveBoardState();
  };
  boardViewport.addEventListener('pointerup', endPan);
  boardViewport.addEventListener('pointercancel', endPan);
}
let panStart = { x: 0, y: 0, px: 0, py: 0 };

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  e.preventDefault();
  spaceDown = true;
  if (boardViewport) boardViewport.style.cursor = 'grab';
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  spaceDown = false;
  if (boardViewport) boardViewport.style.cursor = '';
});

// --- HUD controls ---
document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
  const r = boardViewport!.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25);
  saveBoardState();
});
document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
  const r = boardViewport!.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
  saveBoardState();
});
document.getElementById('btn-recenter')?.addEventListener('click', recenterView);

// --- board item dragging (via titlebar) ---
function initBoardItem(item: HTMLElement) {
  const titlebar = item.querySelector<HTMLElement>('.rack-titlebar, .unit-titlebar');
  if (titlebar) {
    titlebar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const left = parseFloat(item.style.left) || 0;
      const top = parseFloat(item.style.top) || 0;
      const s0 = screenToBoard(startX, startY);
      item.classList.add('dragging');
      item.setPointerCapture(e.pointerId);
      const move = (me: PointerEvent) => {
        const d = screenToBoard(me.clientX, me.clientY);
        item.style.left = `${left + (d.x - s0.x)}px`;
        item.style.top = `${top + (d.y - s0.y)}px`;
      };
      const up = () => {
        item.classList.remove('dragging');
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', up);
        item.removeEventListener('pointercancel', up);
        saveBoardState();
      };
      item.addEventListener('pointermove', move);
      item.addEventListener('pointerup', up);
      item.addEventListener('pointercancel', up);
    });
  }
  const close = item.querySelector<HTMLElement>('.rack-close, .unit-close');
  close?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (item.dataset.id === 'mixer' || item.dataset.id === 'seq') {
      item.classList.add('unit-hidden');
    } else {
      item.remove();
    }
    saveBoardState();
  });
}

// --- hardware catalog ---
const UNIT_SPECS: Record<string, { title: string; knobs: { label: string; cap: string; deg: number }[]; toggles?: string[]; withMeter?: boolean; withFader?: boolean }> = {
  eq: {
    title: 'GRAPHIC EQ',
    knobs: [
      { label: '125', cap: '#5db2ff', deg: 0 },
      { label: '250', cap: '#5db2ff', deg: 20 },
      { label: '500', cap: '#5db2ff', deg: 45 },
      { label: '1K', cap: '#5db2ff', deg: 70 },
      { label: '2K', cap: '#5db2ff', deg: 45 },
      { label: '4K', cap: '#5db2ff', deg: 20 },
      { label: '8K', cap: '#5db2ff', deg: 0 },
    ],
    toggles: ['EQ IN'],
    withMeter: true,
  },
  'parametric-eq': {
    title: 'PARAMETRIC EQ',
    knobs: [
      { label: 'FREQ', cap: '#2980b9', deg: 30 },
      { label: 'GAIN', cap: '#e67e22', deg: 0 },
      { label: 'Q', cap: '#f1c40f', deg: 60 },
    ],
    toggles: ['IN'],
    withMeter: true,
  },
  'tape-delay': {
    title: 'TAPE DELAY',
    knobs: [
      { label: 'TIME', cap: '#2980b9', deg: 30 },
      { label: 'FEED', cap: '#e67e22', deg: 40 },
      { label: 'MIX', cap: '#f1c40f', deg: 60 },
      { label: 'WOBBLE', cap: '#34495e', deg: 15 },
    ],
    toggles: ['SYNC', 'PING-PONG'],
    withMeter: true,
  },
  reverb: {
    title: 'REVERB',
    knobs: [
      { label: 'SIZE', cap: '#2980b9', deg: 70 },
      { label: 'DAMP', cap: '#5db2ff', deg: 30 },
      { label: 'MIX', cap: '#f1c40f', deg: 50 },
    ],
    toggles: ['PLATE'],
    withMeter: true,
  },
  compressor: {
    title: 'COMPRESSOR',
    knobs: [
      { label: 'THRESH', cap: '#e67e22', deg: 60 },
      { label: 'RATIO', cap: '#f1c40f', deg: 30 },
      { label: 'ATTACK', cap: '#5db2ff', deg: 20 },
      { label: 'RELEASE', cap: '#5db2ff', deg: 70 },
      { label: 'MAKEUP', cap: '#e67e22', deg: 45 },
    ],
    toggles: ['COMP IN'],
    withFader: true,
    withMeter: true,
  },
  synth: {
    title: 'SYNTH',
    knobs: [
      { label: 'OSC1', cap: '#f1c40f', deg: 30 },
      { label: 'OSC2', cap: '#f1c40f', deg: -30 },
      { label: 'CUTOFF', cap: '#e67e22', deg: 45 },
      { label: 'RES', cap: '#5db2ff', deg: 70 },
      { label: 'ENV', cap: '#2980b9', deg: 0 },
      { label: 'LFO', cap: '#34495e', deg: 60 },
    ],
    toggles: ['MONO', 'LEGATO'],
    withFader: true,
  },
};

let spawnCounter = 0;

function spawnUnit(kind: string, x?: number, y?: number, idOverride?: string) {
  const spec = UNIT_SPECS[kind];
  if (!spec || !board) return null;
  spawnCounter++;
  const id = idOverride || `hw-${Date.now().toString(36)}-${spawnCounter}`;
  const el = document.createElement('div');
  el.className = 'board-item unit spawned';
  el.dataset.kind = kind;
  el.dataset.id = id;
  el.style.left = `${x ?? 60 + (spawnCounter % 5) * 70}px`;
  el.style.top = `${y ?? 560 + (spawnCounter % 4) * 70}px`;
  const knobs = spec.knobs.map((k) => `
    <div class="hw-knob-cell">
      <div class="knob hw-mini" style="--cap:${k.cap};--deg:${k.deg}deg"></div>
      <span>${k.label}</span>
    </div>`).join('');
  const toggles = (spec.toggles ?? []).map((t) => `<button class="hw-toggle" data-toggle="${t}">${t}</button>`).join('');
  const meter = spec.withMeter ? `<div class="hw-led-meter"><div class="hw-led-fill"></div></div>` : '';
  const fader = spec.withFader ? `<div class="hw-fader-track"><div class="hw-fader-cap" style="top:20px"></div></div>` : '';
  const aux = (meter || fader) ? `<div class="hw-aux-row">${meter}${fader}</div>` : '';
  el.innerHTML = `
    <div class="unit-titlebar">
      <span class="unit-name">${spec.title}</span>
      <div class="unit-controls">
        <button class="mini-btn unit-close" title="Close unit">×</button>
      </div>
    </div>
    <div class="hw-body">
      <div class="hw-knobs">${knobs}</div>
      ${toggles ? `<div class="hw-toggle-row">${toggles}</div>` : ''}
      ${aux}
      <div class="hw-label-plate">${spec.title}</div>
    </div>
    <div class="unit-sockets">
      <span class="socket-label">IN</span>
      <span class="jack in" data-jack="${id}-in"></span>
      <span class="socket-label">OUT</span>
      <span class="jack out" data-jack="${id}-out"></span>
    </div>`;
  board.appendChild(el);
  initBoardItem(el);
  el.querySelectorAll<HTMLButtonElement>('.hw-toggle').forEach((b) => {
    b.addEventListener('click', () => b.classList.toggle('active'));
  });
  initJacks(el);
  saveBoardState();
  return el;
}

// --- virtual patch cables ---
interface CableLink { id: string; a: string; b: string; }
const cables: CableLink[] = [];
let cableIdCounter = 0;

let cableSvg: SVGSVGElement | null = null;
if (board) {
  cableSvg = document.createElementNS(BOARD_NS, 'svg');
  cableSvg.setAttribute('class', 'cables');
  board.appendChild(cableSvg);
}

function jackEl(jackId: string): HTMLElement | null {
  return document.querySelector(`.jack[data-jack="${jackId}"]`);
}
function jackCenter(jack: HTMLElement) {
  const r = jack.getBoundingClientRect();
  return screenToBoard(r.left + r.width / 2, r.top + r.height / 2);
}
function makeCablePath(x1: number, y1: number, x2: number, y2: number) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const sag = Math.min(130, dist * 0.4 + 22);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + sag;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}
function drawCable(g: SVGGElement, x1: number, y1: number, x2: number, y2: number) {
  const d = makeCablePath(x1, y1, x2, y2);
  g.innerHTML = '';
  for (const cls of ['cable-hit', 'cable-path', 'cable-highlight']) {
    const p = document.createElementNS(BOARD_NS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    g.appendChild(p);
  }
}

let patchStart: { jack: HTMLElement; g: SVGGElement } | null = null;

function startPatch(jack: HTMLElement) {
  const p = jackCenter(jack);
  const g = document.createElementNS(BOARD_NS, 'g');
  g.setAttribute('class', 'cable');
  drawCable(g, p.x, p.y, p.x, p.y);
  cableSvg?.appendChild(g);
  patchStart = { jack, g };
  jack.classList.add('armed');
}
function movePatch(cx: number, cy: number) {
  if (!patchStart) return;
  const p = screenToBoard(cx, cy);
  const s = jackCenter(patchStart.jack);
  drawCable(patchStart.g, s.x, s.y, p.x, p.y);
}
function endPatch(cx: number, cy: number) {
  if (!patchStart) return;
  const s = patchStart;
  s.jack.classList.remove('armed');
  const target = document.elementFromPoint(cx, cy)?.closest('.jack') as HTMLElement | null;
  if (target && target !== s.jack && target.dataset.jack) {
    const link: CableLink = { id: `c${++cableIdCounter}`, a: s.jack.dataset.jack!, b: target.dataset.jack };
    cables.push(link);
    renderCable(link, s.g);
    saveBoardState();
  } else {
    s.g.remove();
  }
  patchStart = null;
}
function renderCable(link: CableLink, g?: SVGGElement) {
  const a = jackEl(link.a), b = jackEl(link.b);
  if (!a || !b) return;
  const p1 = jackCenter(a), p2 = jackCenter(b);
  const group = g || document.createElementNS(BOARD_NS, 'g');
  group.setAttribute('class', 'cable');
  group.setAttribute('data-cable', link.id);
  drawCable(group, p1.x, p1.y, p2.x, p2.y);
  const hit = group.querySelector('.cable-hit');
  hit?.addEventListener('click', () => {
    const idx = cables.findIndex((c) => c.id === link.id);
    if (idx >= 0) cables.splice(idx, 1);
    group.remove();
    saveBoardState();
  });
  if (!g) cableSvg?.appendChild(group);
}

function initJacks(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.jack').forEach((jack) => {
    jack.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const j = e.currentTarget as HTMLElement;
      j.setPointerCapture(e.pointerId);
      startPatch(j);
    });
    jack.addEventListener('pointermove', (e) => movePatch(e.clientX, e.clientY));
    jack.addEventListener('pointerup', (e) => endPatch(e.clientX, e.clientY));
    jack.addEventListener('pointercancel', () => {
      if (patchStart) { patchStart.g.remove(); patchStart = null; }
    });
  });
}

// --- board state persistence ---
function saveBoardState() {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.board-item')).map((el) => ({
    id: el.dataset.id, unit: el.dataset.unit, kind: el.dataset.kind,
    x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0,
    hidden: el.classList.contains('unit-hidden'),
  }));
  const state = { zoom, panX, panY, cables, items };
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function loadBoardState() {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as { zoom?: number; panX?: number; panY?: number; cables?: CableLink[]; items?: { id?: string; kind?: string; x: number; y: number; hidden?: boolean }[] };
    zoom = clampZoom(s.zoom ?? 1);
    panX = s.panX ?? 0;
    panY = s.panY ?? 0;
    s.items?.forEach((it) => {
      const el = document.querySelector<HTMLElement>(`.board-item[data-id="${it.id}"]`);
      if (el) {
        el.style.left = `${it.x}px`;
        el.style.top = `${it.y}px`;
        el.classList.toggle('unit-hidden', !!it.hidden);
      } else if (it.kind) {
        const spawned = spawnUnit(it.kind, it.x, it.y, it.id);
        if (spawned && it.hidden) spawned.classList.add('unit-hidden');
      }
    });
    s.cables?.forEach((c) => renderCable(c));
    applyBoardTransform();
  } catch { /* ignore */ }
}

// --- catalog wiring ---
document.getElementById('hw-catalog')?.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest('.hw-item');
  if (!item) return;
  const kind = item.getAttribute('data-catalog');
  if (!kind) return;
  if (kind === 'mixer' || kind === 'sequencer') {
    const el = document.querySelector<HTMLElement>(`.board-item[data-id="${kind}"]`);
    if (el) {
      el.classList.remove('unit-hidden');
      bringToFront(el);
      centerOn(el);
    }
    return;
  }
  const spawned = spawnUnit(kind);
  if (spawned) bringToFront(spawned);
});

// --- init static board items ---
document.querySelectorAll<HTMLElement>('.board-item').forEach(initBoardItem);
initJacks(document.body);
loadBoardState();
applyBoardTransform();

// Expose for testing/debugging
declare global {
  interface Window {
    engine: AudioEngine;
    sequencer: StepSequencer;
    pianoRoll: PianoRoll;
    instrument: InstrumentPanel;
    playlist: PlaylistBar;
    openProject: () => Promise<void>;
    loadSample: (file: File, trackIndex?: number) => Promise<void>;
    currentLoadTrack: () => number;
    audioBufferToWav: (buffer: AudioBuffer) => Blob;
  }
}
window.engine = engine;
window.sequencer = sequencer;
window.pianoRoll = pianoRoll;
window.instrument = instrument;
window.playlist = playlist;
window.openProject = openProject;
window.loadSample = loadSample;
window.currentLoadTrack = () => currentLoadTrack;
window.audioBufferToWav = audioBufferToWav;
(window as unknown as { boardViewState?: unknown }).boardViewState = () => ({ zoom, panX, panY, cables, items: Array.from(document.querySelectorAll<HTMLElement>('.board-item')).map((el) => ({ id: el.dataset.id, left: el.style.left, top: el.style.top, hidden: el.classList.contains('unit-hidden') })) });
(window as unknown as { spawnUnit?: unknown }).spawnUnit = spawnUnit;
(window as unknown as { recenterView?: unknown }).recenterView = recenterView;
(window as unknown as { patchCable?: unknown }).patchCable = (a: string, b: string) => {
  const ja = jackEl(a), jb = jackEl(b);
  if (!ja || !jb) return false;
  const link: CableLink = { id: `c${++cableIdCounter}`, a, b };
  cables.push(link);
  renderCable(link);
  saveBoardState();
  return true;
};
(window as unknown as { zoomBoard?: unknown }).zoomBoard = (f: number) => {
  const r = boardViewport!.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  saveBoardState();
};
