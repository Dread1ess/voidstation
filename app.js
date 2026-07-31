/* VOIDSTATION — static DAW skeleton.
   Pure visual: class toggles + fader drag. No audio, no state. */

const BARS = 20;
const BEAT = 40;
const BAR = BEAT * 4;
const RULER_H = 26;
const TRACK_H = 56;

const ruler = document.getElementById('ruler');
const piano = document.getElementById('piano');
const keys = document.getElementById('keys');
const playhead = document.getElementById('playhead');

/* ---------- ruler: bar numbers ---------- */
for (let b = 0; b < BARS; b++) {
  const t = document.createElement('div');
  t.className = 'ruler-tick';
  t.style.width = BAR + 'px';
  t.textContent = String(b + 1).padStart(2, '0');
  ruler.appendChild(t);
}

/* ---------- lanes, one per track ---------- */
document.querySelectorAll('.track-row').forEach((row) => {
  const lane = document.createElement('div');
  lane.className = 'lane';
  lane.style.setProperty('--lane-c', row.dataset.color);
  piano.appendChild(lane);
});

/* ---------- piano keys strip (2 octaves, bottom = C3) ---------- */
const BLACK = new Set([1, 3, 6, 8, 10]);
for (let i = 0; i < 24; i++) {
  const row = document.createElement('div');
  row.className = 'key-row';

  const white = document.createElement('div');
  white.className = 'key-white';
  if (i % 12 === 0) {
    white.classList.add('c-label');
    white.textContent = 'C' + (3 + Math.floor(i / 12));
  }
  row.appendChild(white);

  if (BLACK.has(i % 12)) {
    const black = document.createElement('div');
    black.className = 'key-black';
    row.appendChild(black);
  }
  keys.appendChild(row);
}

/* ---------- playhead: static position at bar 09 ---------- */
playhead.style.left = 8 * BAR + 'px';

/* ---------- mute / solo toggles ---------- */
document.querySelectorAll('.mini-btn[data-mute]').forEach((b) => {
  b.addEventListener('click', () => b.classList.toggle('active-mute'));
});
document.querySelectorAll('.mini-btn[data-solo]').forEach((b) => {
  b.addEventListener('click', () => {
    b.classList.toggle('active-solo');
    const row = b.closest('.track-row');
    row.querySelector('.mini-btn[data-mute]').classList.remove('active-mute');
  });
});

/* ---------- fader drag (visual only) ---------- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

document.querySelectorAll('.fader').forEach((fader) => {
  const cap = fader.querySelector('.fader-cap');
  const track = () => fader.clientHeight - cap.offsetHeight;
  let dragging = false;

  cap.addEventListener('pointerdown', (e) => {
    dragging = true;
    fader.setPointerCapture(e.pointerId);
  });
  fader.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = fader.getBoundingClientRect();
    const top = clamp(e.clientY - rect.top - cap.offsetHeight / 2, 0, track());
    cap.style.top = top + 'px';
    fader.style.setProperty('--level', (top / track()).toFixed(3));
  });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    fader.addEventListener(ev, () => { dragging = false; })
  );
});

/* ---------- channel select (visual) ---------- */
document.querySelectorAll('.channel').forEach((ch) => {
  ch.addEventListener('click', () => {
    document.querySelectorAll('.channel').forEach((c) => c.classList.remove('selected'));
    ch.classList.add('selected');
  });
});
