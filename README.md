# VOIDSTATION — Web DAW UI Skeleton

A static UI mockup of a DAW (FL Studio style) built with plain HTML/CSS/JS.
Visual only: no audio, no backend.

## Run

Serve the folder and open it in a browser:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000 — or just open `index.html` directly.

## Features

- Transport bar: play / stop / record, BPM and time readouts
- Track list with dusty-pastel color plates and mute/solo toggles
- Timeline: ruler, beat/bar grid, piano keys strip and a playhead
- Mixer mockup: pan knobs, level meters and draggable faders

## Structure

- `index.html` — markup
- `styles.css` — matte hardware skin (CSS variables)
- `app.js` — ruler/lane/key generation and minimal visual interactivity

## Design

Muted cold-dark base (`#2a2d33`), slightly lighter panels (`#34373e`),
dusty pastel track colors, and a single teal accent (`#00d9d0`) used only
on active elements. Hardware feel comes from inset/outset gradients,
rounded knobs with indicator lines, and dark soft shadows — no neon glow.
