// Entry point: wires the transport, step sequencer, mixer, and audio engine.
// ESM module — imports every other module explicitly; loaded from index.html
// as the single runtime entry (app.js stays a classic script for static UI).
import { AudioEngine } from './audio/engine.js';
import { audioBufferToWav } from './audio/wav.js';
import { StepSequencer } from './sequencer.js';
import { PianoRoll } from './pianoRoll.js';
import { InstrumentPanel } from './instrument.js';
import { PlaylistBar } from './playlist.js';
const STORAGE_KEY = 'voidstation-project-v1';
const engine = new AudioEngine();
const sequencer = new StepSequencer(engine);
const pianoRoll = new PianoRoll(engine);
const instrument = new InstrumentPanel(engine);
const playlist = new PlaylistBar(engine);
const fileInput = document.querySelector('#file-input');
const btnLoad = document.getElementById('btn-load');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnRec = document.getElementById('btn-rec');
const btnSave = document.getElementById('btn-save');
const btnOpen = document.getElementById('btn-open');
const btnNew = document.getElementById('btn-new');
const btnExport = document.getElementById('btn-export');
const bpmInput = document.querySelector('#bpm-input');
const sampleName = document.getElementById('sample-name');
const dropOverlay = document.getElementById('drop-overlay');
// Current track index (0=Kick,1=Snare,2=Bass,3=Synth,4=Pads)
let currentLoadTrack = 3; // Default to Synth
// Initialize step sequencer UI
sequencer.mount(document.getElementById('step-sequencer'));
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
// When the active pattern changes, re-render editors that show its data
engine.onPatternChange(() => {
    sequencer.render();
    pianoRoll.render();
});
function syncButtons() {
    btnPlay.classList.toggle('active', engine.isPlaying);
    btnStop.classList.toggle('active', !engine.isPlaying);
}
function setStatus(message, isError = false) {
    sampleName.textContent = message;
    sampleName.classList.toggle('loaded', !isError && message !== 'no sample');
}
// --- Sample loading ---
async function loadSample(file, trackIndex = currentLoadTrack) {
    if (!file)
        return;
    try {
        await engine.loadSample(file, trackIndex);
        const track = engine.tracks[trackIndex];
        setStatus(`${track.name}: ${file.name}`);
        highlightCurrentTrack(trackIndex);
    }
    catch (err) {
        console.error('Failed to load sample:', err);
        setStatus('could not load sample', true);
    }
}
function highlightCurrentTrack(trackIndex) {
    currentLoadTrack = trackIndex;
    const channels = document.querySelectorAll('.channel');
    channels.forEach((ch, i) => ch.classList.toggle('selected', i === trackIndex));
    pianoRoll.setActiveTrack(trackIndex);
    instrument.setTrack(trackIndex);
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
    if (dragDepth === 0)
        dropOverlay.classList.remove('visible');
});
window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('visible');
    if (!e.dataTransfer)
        return;
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('audio'));
    if (file)
        loadSample(file);
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
    }
    else {
        bpmInput.value = engine.bpm.toFixed(3);
    }
});
// --- Mixer height (drag the top edge like a window border, persisted) ---
const mixer = document.querySelector('.mixer');
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
        const move = (me) => {
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
const faders = [];
document.querySelectorAll('.fader').forEach((fader, faderIndex) => {
    const cap = fader.querySelector('.fader-cap');
    const faderHeight = fader.clientHeight;
    const capHeight = cap.offsetHeight;
    let dragging = false;
    function setCapPosition(t) {
        cap.style.top = `${t * (faderHeight - capHeight)}px`;
    }
    function setLevel(clientY) {
        const rect = fader.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (clientY - rect.top - capHeight / 2) / (faderHeight - capHeight)));
        setCapPosition(t);
        engine.setTrackVolume(faderIndex, t);
        // Update meter fill proportionally
        const meterFill = fader.parentElement.querySelector('.meter-fill');
        if (meterFill)
            meterFill.style.height = `${t * 100}%`;
    }
    cap.addEventListener('pointerdown', (e) => {
        fader.setPointerCapture(e.pointerId);
        dragging = true;
        engine.beginHistory();
        setLevel(e.clientY);
    });
    fader.addEventListener('pointermove', (e) => {
        if (dragging)
            setLevel(e.clientY);
    });
    fader.addEventListener('pointerup', () => { dragging = false; engine.commitHistory(); });
    fader.addEventListener('pointercancel', () => { dragging = false; engine.commitHistory(); });
    faders.push({ fader, cap, setLevel, setCapPosition });
});
const panKnobs = [];
document.querySelectorAll('.channel').forEach((ch, i) => {
    const knob = ch.querySelector('.channel-head .knob');
    if (!knob)
        return;
    const applyPan = (pan) => {
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
        if (!dragging)
            return;
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
const channels = Array.from(document.querySelectorAll('.channel'));
const muteButtons = [];
const soloButtons = [];
channels.forEach((ch, i) => {
    const muteBtn = ch.querySelector('.mini-btn[data-mute]');
    muteButtons[i] = muteBtn;
    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            engine.beginHistory();
            engine.toggleMute(i);
            engine.commitHistory();
            muteBtn.classList.toggle('active-mute', engine.tracks[i].mute);
        });
    }
    const soloBtn = ch.querySelector('.mini-btn[data-solo]');
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
const fxPanel = document.getElementById('fx-panel');
const fxTrackName = document.getElementById('fx-track-name');
const fxList = document.getElementById('fx-list');
const fxClose = document.getElementById('fx-close');
function updateFxButtons() {
    document.querySelectorAll('.fx-btn').forEach((btn, i) => {
        btn.classList.toggle('active-fx', engine.tracks[i]?.effects.some(e => e.enabled) ?? false);
    });
}
function formatFxValue(key, v) {
    if (key === 'low' || key === 'mid' || key === 'high')
        return `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`;
    return v.toFixed(2);
}
function fxParamMeta(fx) {
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
function openFxPanel(trackIndex) {
    if (!fxPanel)
        return;
    fxTrackIndex = trackIndex;
    if (fxTrackName)
        fxTrackName.textContent = engine.tracks[trackIndex]?.name ?? '';
    if (mixer) {
        const r = mixer.getBoundingClientRect();
        fxPanel.style.bottom = `${Math.max(8, window.innerHeight - r.top + 12)}px`;
    }
    fxPanel.hidden = false;
    renderFxList();
}
function closeFxPanel() {
    if (fxPanel)
        fxPanel.hidden = true;
}
function renderFxList() {
    if (!fxList)
        return;
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
document.querySelectorAll('.fx-btn').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFxPanel(i);
        highlightCurrentTrack(i);
        setStatus(`FX: ${engine.tracks[i].name}`);
    });
});
document.querySelectorAll('.fx-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const type = (btn.dataset.fxAdd || 'reverb');
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
        const target = e.target;
        const up = target.closest('[data-fx-up]');
        const down = target.closest('[data-fx-down]');
        const remove = target.closest('[data-fx-remove]');
        if (up) {
            const i = Number(up.dataset.fxUp);
            engine.beginHistory();
            engine.moveEffect(fxTrackIndex, i, i - 1);
            engine.commitHistory();
            renderFxList();
        }
        else if (down) {
            const i = Number(down.dataset.fxDown);
            engine.beginHistory();
            engine.moveEffect(fxTrackIndex, i, i + 1);
            engine.commitHistory();
            renderFxList();
        }
        else if (remove) {
            const i = Number(remove.dataset.fxRemove);
            engine.beginHistory();
            engine.removeEffect(fxTrackIndex, i);
            engine.commitHistory();
            renderFxList();
        }
    });
    fxList.addEventListener('change', (e) => {
        const target = e.target;
        const enable = target.closest('.fx-enable');
        if (enable) {
            const i = Number(enable.dataset.fxEnable);
            engine.beginHistory();
            engine.setEffectEnabled(fxTrackIndex, i, enable.checked);
            engine.commitHistory();
            renderFxList();
            return;
        }
        const preset = target.closest('[data-fx-preset]');
        if (preset) {
            const i = Number(preset.dataset.fxPreset);
            engine.beginHistory();
            engine.setEffectParam(fxTrackIndex, i, 'preset', preset.value);
            engine.commitHistory();
        }
    });
    // Range sliders: live param update, single undo entry per drag.
    fxList.addEventListener('input', (e) => {
        const target = e.target;
        const param = target.dataset.fxParam;
        if (!param)
            return;
        const colon = param.indexOf(':');
        const idx = Number(param.slice(0, colon));
        const key = param.slice(colon + 1);
        const val = parseFloat(target.value);
        if (!target._fxGesture) {
            target._fxGesture = true;
            engine.beginHistory();
        }
        engine.setEffectParam(fxTrackIndex, idx, key, val);
        const readout = fxList.querySelector(`[data-fx-val="${param}"]`);
        if (readout)
            readout.textContent = formatFxValue(key, val);
    });
    fxList.addEventListener('change', (e) => {
        const target = e.target;
        if (!target.dataset.fxParam)
            return;
        const el = target;
        if (el._fxGesture) {
            el._fxGesture = false;
            engine.commitHistory();
        }
    });
}
// Close the panel on an outside click or Escape.
document.addEventListener('pointerdown', (e) => {
    if (!fxPanel || fxPanel.hidden)
        return;
    const t = e.target;
    if (fxPanel.contains(t) || t.closest('.fx-btn'))
        return;
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
        const meterFill = f.fader.parentElement.querySelector('.meter-fill');
        if (meterFill)
            meterFill.style.height = `${t * 100}%`;
    });
    // Pan knobs
    panKnobs.forEach((k, i) => {
        k.knob.style.setProperty('--deg', `${engine.tracks[i].pan * 135}deg`);
    });
    // Mute/solo buttons
    muteButtons.forEach((btn, i) => {
        if (btn)
            btn.classList.toggle('active-mute', engine.tracks[i].mute);
    });
    soloButtons.forEach((btn, i) => {
        if (btn)
            btn.classList.toggle('active-solo', engine.tracks[i].solo);
    });
    // Sample name readout (reflects what a LOAD would target — the active track)
    const activeTrack = engine.tracks[currentLoadTrack];
    if (activeTrack?.sampleName) {
        setStatus(`${activeTrack.name}: ${activeTrack.sampleName}`);
    }
    else {
        setStatus('no sample');
    }
    // Insert FX buttons + panel
    updateFxButtons();
    if (fxPanel && !fxPanel.hidden)
        renderFxList();
}
// --- Project save / load (localStorage) ---
function saveProject() {
    try {
        const json = JSON.stringify(engine.serialize());
        localStorage.setItem(STORAGE_KEY, json);
        setStatus('project saved');
    }
    catch (err) {
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
    }
    catch (err) {
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
    if (btnExport.classList.contains('busy'))
        return;
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
    }
    catch (err) {
        console.error('Export failed:', err);
        setStatus('export failed', true);
    }
    finally {
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
// --- Keyboard shortcuts ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape')
        closeFxPanel();
    // Let text/number fields handle their own keys (native undo inside inputs).
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'))
        return;
    const keys = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 };
    if (keys[e.key] !== undefined) {
        highlightCurrentTrack(keys[e.key]);
        setStatus(`Track: ${engine.tracks[keys[e.key]].name}`);
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
            engine.redo().then(done => { if (done) {
                refreshAllUI();
                setStatus('redo');
            } });
        }
        else {
            engine.undo().then(done => { if (done) {
                refreshAllUI();
                setStatus('undo');
            } });
        }
    }
    else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        engine.redo().then(done => { if (done) {
            refreshAllUI();
            setStatus('redo');
        } });
    }
});
window.engine = engine;
window.sequencer = sequencer;
window.pianoRoll = pianoRoll;
window.instrument = instrument;
window.playlist = playlist;
window.openProject = openProject;
window.loadSample = loadSample;
window.currentLoadTrack = () => currentLoadTrack;
window.audioBufferToWav = audioBufferToWav;
