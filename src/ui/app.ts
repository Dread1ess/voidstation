// app.ts — builds the whole VOIDSTATION hardware UI.
// Responsibilities:
//   - create the AudioEngine
//   - create the HardwareWall and register every module with a default position
//   - create each feature module and mount it into its rack body
//   - wire cross-module signals (mixer channel click -> piano roll track)

import { AudioEngine } from '../audio/engine.js';
import { HardwareWall } from './hardwareWall.js';
import { Transport } from './transport.js';
import { StepSequencer } from './stepSequencer.js';
import { PianoRoll } from './pianoRoll.js';
import { Playlist } from './playlist.js';
import { Mixer } from './mixer.js';
import { FxRack } from './fx.js';

export interface AppRefs {
  engine: AudioEngine;
  wall: HardwareWall;
  transport: Transport;
  sequencer: StepSequencer;
  pianoRoll: PianoRoll;
  playlist: Playlist;
  mixer: Mixer;
  fxRack: FxRack;
}

export function buildApp(container: HTMLElement): AppRefs {
  const engine = new AudioEngine();
  const wall = new HardwareWall(container);

  // Register racks with sensible default positions on the wall.
  const transportMod = wall.addModule('transport', 'VOIDSTATION · TRANSPORT', 30, 30);
  const seqMod = wall.addModule('sequencer', 'STEP SEQUENCER', 30, 150);
  const prMod = wall.addModule('piano-roll', 'PIANO ROLL', 30, 470);
  const plMod = wall.addModule('playlist', 'PATTERN ARRANGER', 30, 780);
  const mixMod = wall.addModule('mixer', 'MIXING CONSOLE', 1030, 30);
  const fxMod = wall.addModule('fx-rack', 'FX RACK', 1030, 420);

  // Mount feature modules into their rack bodies.
  const transport = new Transport(engine, transportMod.body);
  const sequencer = new StepSequencer(engine, seqMod.body);
  const pianoRoll = new PianoRoll(engine, prMod.body);
  const playlist = new Playlist(engine, plMod.body);
  const mixer = new Mixer(engine, mixMod.body);
  const fxRack = new FxRack(engine, fxMod.body);

  // Selecting a mixer channel focuses the piano roll and FX rack on that track.
  mixer.setOnSelect((track) => {
    pianoRoll.setTrack(track);
    fxRack.setTrack(track);
  });

  return { engine, wall, transport, sequencer, pianoRoll, playlist, mixer, fxRack };
}
