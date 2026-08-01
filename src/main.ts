// Entry point: minimal bootstrap. All real wiring lives in ui/app.ts.
// The old VS Code / board-studio UI was removed; the engine is untouched.

import { buildApp, type AppRefs } from './ui/app.js';

const root = document.getElementById('app');
if (!root) throw new Error('#app container missing');

const refs: AppRefs = buildApp(root);

// Auto-load the saved project on startup (non-destructive).
void refs.transport.autoLoad();

// Expose for debugging / smoke tests.
declare global {
  interface Window {
    voidstation: AppRefs;
  }
}
window.voidstation = refs;
