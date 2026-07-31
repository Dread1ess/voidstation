// Entry point: wires the transport UI to the audio engine.
// Classic script (loaded after src/audio/engine.js), works over file:// too.

const engine = new window.AudioEngine();

const fileInput = document.getElementById('file-input');
const btnLoad = document.getElementById('btn-load');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnRec = document.getElementById('btn-rec');
const bpmInput = document.getElementById('bpm-input');
const sampleName = document.getElementById('sample-name');
const dropOverlay = document.getElementById('drop-overlay');

function syncButtons() {
  btnPlay.classList.toggle('active', engine.isPlaying);
  btnStop.classList.toggle('active', !engine.isPlaying);
}

function setStatus(message, isError = false) {
  sampleName.textContent = message;
  sampleName.classList.toggle('loaded', !isError && message !== 'no sample');
}

async function loadSample(file) {
  if (!file) return;
  try {
    await engine.loadSample(file);
    setStatus(file.name);
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

// --- transport: play / stop ---
btnPlay.addEventListener('click', () => {
  if (!engine.hasSample) {
    setStatus('load a sample first', true);
    return;
  }
  engine.play();
});

btnStop.addEventListener('click', () => {
  engine.stop();
});

btnRec.addEventListener('click', () => {
  btnRec.classList.toggle('active');
});

engine.onStateChange = syncButtons;
syncButtons();

// --- BPM (number only for now, no sync) ---
bpmInput.addEventListener('change', () => {
  const value = parseFloat(bpmInput.value);
  if (Number.isFinite(value) && value > 0) {
    engine.setBpm(value);
    bpmInput.value = value.toFixed(3);
  } else {
    bpmInput.value = engine.bpm.toFixed(3);
  }
});
