// app.ts — builds the whole VOIDSTATION hardware UI.
// Responsibilities:
//   - create the AudioEngine
//   - create the TopBar (outside the canvas) and mount transport bar controls
//   - create the HardwareWall and register every wall module
//   - create each feature module and mount it into its rack body
//   - create the Sampler drawer (slide-out from the left) and mount the sampler
//   - wire cross-module signals (mixer channel click -> piano roll track)

import { AudioEngine } from '../audio/engine.js';
import { TopBar } from './topbar.js';
import { HardwareWall } from './hardwareWall.js';
import { Drawer } from './drawer.js';
import { Transport } from './transport.js';
import { StepSequencer } from './stepSequencer.js';
import { PianoRoll } from './pianoRoll.js';
import { Playlist } from './playlist.js';
import { Mixer } from './mixer.js';
import { FxRack } from './fx.js';
import { Sampler } from './sampler.js';

export interface AppRefs {
    engine: AudioEngine;
    wall: HardwareWall;
    transport: Transport;
    sequencer: StepSequencer;
    pianoRoll: PianoRoll;
    playlist: Playlist;
    mixer: Mixer;
    fxRack: FxRack;
    sampler: Sampler;
}

export function buildApp(container: HTMLElement): AppRefs {
    const engine = new AudioEngine();

    // Top bar: fixed header OUTSIDE the canvas. Transport mounts here.
    const topbar = new TopBar();
    container.appendChild(topbar.el);

    // The wall (canvas) fills the space below the bar.
    const wall = new HardwareWall(container);

    // Register racks with sensible default positions on the wall.
    const filesMod = wall.addModule('transport-files', 'PROJECT FILE OPS', 30, 30);
    const seqMod = wall.addModule('sequencer', 'STEP SEQUENCER', 30, 150);
    const prMod = wall.addModule('piano-roll', 'PIANO ROLL', 30, 470);
    const plMod = wall.addModule('playlist', 'PATTERN ARRANGER', 30, 780);
    const mixMod = wall.addModule('mixer', 'MIXING CONSOLE', 1030, 30);
    const fxMod = wall.addModule('fx-rack', 'FX RACK', 1030, 420);

    // Sampler drawer: slide-out panel from the left edge, overlaying the wall.
    const drawer = new Drawer();
    drawer.mount(container);

    // Mount feature modules: transport splits between the top bar and the
    // file-ops rack; the sampler lives in the drawer instead of the wall.
    const transport = new Transport(engine, topbar.transportHost, filesMod.body);
    const sequencer = new StepSequencer(engine, seqMod.body);
    const pianoRoll = new PianoRoll(engine, prMod.body);
    const playlist = new Playlist(engine, plMod.body);
    const mixer = new Mixer(engine, mixMod.body);
    const fxRack = new FxRack(engine, fxMod.body);
    const sampler = new Sampler(engine, drawer.body);

    // The top bar toggle opens/closes the sampler drawer.
    topbar.setSamplerToggleHandler(() => drawer.toggle());

    // Selecting a mixer channel focuses the piano roll, FX rack and sampler.
    mixer.setOnSelect((track) => {
        pianoRoll.setTrack(track);
        fxRack.setTrack(track);
        sampler.setTrack(track);
    });

    return { engine, wall, transport, sequencer, pianoRoll, playlist, mixer, fxRack, sampler };
}
