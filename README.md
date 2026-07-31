# VOIDSTATION — Web DAW

An FL Studio–style web DAW built with plain HTML/CSS/JS and the Web Audio
API. No backend: the project lives in memory (localStorage later).

## Run

Serve the folder and open it in a browser (ES modules require HTTP):

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Status

- **Stage 1 — Audio engine (done).** Lazy `AudioContext`, load one sample
  via button or drag & drop, play/stop through the transport, editable BPM
  (value only, no scheduling yet).
- Stage 2 — step sequencer (16 steps, Web Audio scheduling) — next.

## Features

- Transport bar: play / stop, sample loading, editable BPM
- Track list with dusty-pastel color plates and mute/solo toggles
- Timeline: ruler, beat/bar grid, piano keys strip and a playhead
- Mixer mockup: pan knobs, level meters and draggable faders

## Structure

- `index.html` — markup
- `styles.css` — matte hardware skin (CSS variables)
- `app.js` — ruler/lane/key generation and visual interactivity
- `src/main.js` — entry point: wires the transport to the engine
- `src/audio/engine.js` — Web Audio context, sample playback, BPM

## Design

Muted cold-dark base (`#2a2d33`), slightly lighter panels (`#34373e`),
dusty pastel track colors, and a single teal accent (`#00d9d0`) used only
on active elements. Hardware feel comes from inset/outset gradients,
rounded knobs with indicator lines, and dark soft shadows — no neon glow.
