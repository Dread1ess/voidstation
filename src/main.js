// Entry point: wires the transport, step sequencer, and audio engine.
// Classic script (loaded after src/audio/engine.js, src/sequencer.js), works over file:// too.

const engine = new window.AudioEngine();
const sequencer = new window.StepSequencer(engine);

const fileInput = document.getElementById('file-input');
const btnLoad = document.getElementById('btn-load');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnRec = document.getElementById('btn-rec');
const bpmInput = document.getElementById('bpm-input');
const sampleName = document.getElementById('sample-name');
const dropOverlay = document.getElementById('drop-overlay');

// Track mapping: 0 = Kick, 1 = Snare
let currentTrack = 0; // 0 = Kick, 1 = Snare

// Initialize step sequencer UI
sequencer.mount(document.getElementById('step-sequencer'));

function syncButtons() {
  btnPlay.classList.toggle('active', engine.isPlaying);
  btnStop.classList.toggle('active', !engine.isPlaying);
}

function setStatus(message, isError = false) {
  sampleName.textContent = message;
  sampleName.classList.toggle('loaded', !isError && message !== 'no sample');
}

function setCurrentTrack(index) {
  currentTrack = index;
  // Visual feedback: could highlight track selector later
}

async function loadSample(file, trackIndex = currentTrack) {
  if (!file) return;
  try {
    await engine.loadSample(file, trackIndex);
    const track = engine.tracks[trackIndex];
    setStatus(`${track.name}: ${file.name}`);
  } catch (err) {
    console.error('Failed to load sample:', err);
    setStatus('could not load sample', true);
  }
}

// --- sample loading: button + drag & drop ---
btnLoad.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  loadSample(fileInput.files[0]);
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
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('audio'));
  if (file) loadSample(file);
});

// --- transport: start/stop transport (sequencer) ---
btnPlay.addEventListener('click', () => {
  if (!engine.hasSample) {
    setStatus('load a sample first', true);
    return;
  }
  engine.startTransport();
});

btnStop.addEventListener('click', () => {
  engine.stopTransport();
});

btnRec.addEventListener('click', () => {
  btnRec.classList.toggle('active');
});

engine.onStateChange(syncButtons);
syncButtons();

// --- BPM ---
bpmInput.addEventListener('change', () => {
  const value = parseFloat(bpmInput.value);
  if (Number.isFinite(value) && value > 0) {
    engine.setBpm(value);
    bpmInput.value = value.toFixed(3);
  } else {
    bpmInput.value = engine.bpm.toFixed(3);
  }
});

// Track selector buttons (Kick/Snare) - could be added to UI later
// For now, keyboard shortcuts: 1 = Kick, 2 = Snare
window.addEventListener('keydown', (e) => {
  if (e.key === '1') { setCurrentTrack(0); setStatus('Track: Kick'); }
  else if (e.key === '2') { setCurrentTrack(1); setStatus('Track: Snare'); }
});

// Expose for testing/debugging
window.engine = engine;
window.sequencer = sequencer;