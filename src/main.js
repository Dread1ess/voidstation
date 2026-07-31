// Entry point: wires the transport, step sequencer, mixer, and audio engine.
// Classic script (loaded after src/audio/engine.js, src/sequencer.js), works over file:// too.

const engine = new window.AudioEngine();
const sequencer = new window.StepSequencer(engine);
const pianoRoll = new window.PianoRoll(engine);

const fileInput = document.getElementById('file-input');
const btnLoad = document.getElementById('btn-load');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnRec = document.getElementById('btn-rec');
const bpmInput = document.getElementById('bpm-input');
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

function highlightCurrentTrack(trackIndex) {
  const channels = document.querySelectorAll('.channel');
  channels.forEach((ch, i) => ch.classList.toggle('selected', i === trackIndex));
  pianoRoll.setActiveTrack(trackIndex);
}

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
    engine.setBpm(value);
    bpmInput.value = value.toFixed(3);
  } else {
    bpmInput.value = engine.bpm.toFixed(3);
  }
});

// --- Mixer faders (drag to set volume) ---
document.querySelectorAll('.fader').forEach((fader, faderIndex) => {
  const cap = fader.querySelector('.fader-cap');
  const faderHeight = fader.clientHeight;
  const capHeight = cap.offsetHeight;

  function setLevel(clientY) {
    const rect = fader.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientY - rect.top - capHeight / 2) / (faderHeight - capHeight)));
    cap.style.top = `${t * (faderHeight - capHeight)}px`;
    engine.setTrackVolume(faderIndex, t);
    // Update meter fill proportionally
    const meterFill = fader.parentElement.querySelector('.meter-fill');
    if (meterFill) meterFill.style.height = `${t * 100}%`;
  }

  cap.addEventListener('pointerdown', (e) => {
    fader.setPointerCapture(e.pointerId);
    cap._dragging = true;
    setLevel(e.clientY);
  });
  fader.addEventListener('pointermove', (e) => {
    if (cap._dragging) setLevel(e.clientY);
  });
  fader.addEventListener('pointerup', () => { cap._dragging = false; });
  fader.addEventListener('pointercancel', () => { cap._dragging = false; });
});

// --- Mixer mute/solo buttons ---
document.querySelectorAll('.mini-btn[data-mute]').forEach((btn) => {
  const channel = btn.closest('.channel');
  const index = Array.from(document.querySelectorAll('.channel')).indexOf(channel);
  btn.addEventListener('click', () => {
    engine.toggleMute(index);
    btn.classList.toggle('active-mute', engine.tracks[index].mute);
  });
});
document.querySelectorAll('.mini-btn[data-solo]').forEach((btn) => {
  const channel = btn.closest('.channel');
  const index = Array.from(document.querySelectorAll('.channel')).indexOf(channel);
  btn.addEventListener('click', () => {
    engine.toggleSolo(index);
    btn.classList.toggle('active-solo', engine.tracks[index].solo);
  });
});

// --- Track selector via keyboard ---
window.addEventListener('keydown', (e) => {
  const keys = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 };
  if (keys[e.key] !== undefined) {
    highlightCurrentTrack(keys[e.key]);
    setStatus(`Track: ${engine.tracks[keys[e.key]].name}`);
  }
});

// Expose for testing/debugging
window.engine = engine;
window.sequencer = sequencer;
window.pianoRoll = pianoRoll;