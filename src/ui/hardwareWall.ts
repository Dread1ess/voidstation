// HardwareWall: the canvas "studio room" that the hardware modules live in.
//
// Design goals (learned from the legacy board):
//   - Use native scrolling (overflow: auto) on a fixed-size wall instead of a
//     custom pan offset, so panning is smooth and never lags.
//   - Zoom = a single transform: scale() on the world, with the cursor point
//     kept anchored under the mouse.
//   - Modules are absolutely-positioned hardware units, draggable by header,
//     positions persisted to localStorage.
//
// One wall -> many modules. Each module is built by rack.ts (chassis) and its
// body is filled by the feature class (transport / sequencer / piano roll /
// playlist / mixer).

import { WALL_KEY, clamp } from './theme.js';

export interface WallModule {
  el: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
}

export class HardwareWall {
  readonly viewport: HTMLElement;
  readonly world: HTMLElement;

  private readonly WALL_W = 3400;
  private readonly WALL_H = 2800;

  private modules = new Map<string, WallModule>();
  private positions: Record<string, { x: number; y: number }> = {};
  private zoom = 1;

  private hudZoom: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.viewport = document.createElement('div');
    this.viewport.className = 'hw-wall';
    this.world = document.createElement('div');
    this.world.className = 'hw-world';
    this.world.style.width = `${this.WALL_W}px`;
    this.world.style.height = `${this.WALL_H}px`;
    this.viewport.appendChild(this.world);
    container.appendChild(this.viewport);

    this.loadPositions();
    this.bindViewport();
    this.buildHud();
    this.applyZoom();
  }

  // --- Module creation -----------------------------------------------------

  addModule(id: string, title: string, defX: number, defY: number): WallModule {
    const el = document.createElement('section');
    el.className = 'hw-module';
    el.dataset.module = id;

    const pos = this.positions[id] || { x: defX, y: defY };
    this.positions[id] = pos;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    const header = document.createElement('header');
    header.className = 'hw-header';
    header.innerHTML = `<span class="hw-title">${title}</span><span class="hw-screw hw-screw-l"></span><span class="hw-screw hw-screw-r"></span>`;

    const body = document.createElement('div');
    body.className = 'hw-body';

    el.append(header, body);
    this.world.appendChild(el);

    this.bindModuleDrag(header, el, id);
    this.modules.set(id, { el, header, body });
    return { el, header, body };
  }

  getModule(id: string): WallModule | undefined {
    return this.modules.get(id);
  }

  // --- Viewport: native scroll + ctrl+wheel zoom ---------------------------

  private bindViewport() {
    this.viewport.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // let native scroll do its thing
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });
  }

  private zoomAt(factor: number, clientX: number, clientY: number) {
    const next = clamp(this.zoom * factor, 0.4, 2.5);
    const rect = this.viewport.getBoundingClientRect();
    // World point under the cursor before the zoom.
    const wx = (this.viewport.scrollLeft + (clientX - rect.left)) / this.zoom;
    const wy = (this.viewport.scrollTop + (clientY - rect.top)) / this.zoom;
    this.zoom = next;
    this.applyZoom();
    // Keep that world point under the cursor after the zoom.
    this.viewport.scrollLeft = wx * this.zoom - (clientX - rect.left);
    this.viewport.scrollTop = wy * this.zoom - (clientY - rect.top);
    this.syncHud();
  }

  setZoom(z: number) {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(clamp(z, 0.4, 2.5) / this.zoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  recenter() {
    this.viewport.scrollLeft = 80;
    this.viewport.scrollTop = 60;
  }

  private applyZoom() {
    this.world.style.transform = `scale(${this.zoom})`;
    this.world.style.transformOrigin = '0 0';
  }

  // --- Module drag (by header) ---------------------------------------------

  private bindModuleDrag(header: HTMLElement, el: HTMLElement, id: string) {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('button, input, select')) return;
      e.preventDefault();
      header.setPointerCapture(e.pointerId);
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(el.style.left, 10);
      startTop = parseInt(el.style.top, 10);
      el.classList.add('dragging');
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startX) / this.zoom;
      const dy = (e.clientY - startY) / this.zoom;
      el.style.left = `${Math.round(startLeft + dx)}px`;
      el.style.top = `${Math.round(startTop + dy)}px`;
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      const p = this.positions[id];
      p.x = parseInt(el.style.left, 10);
      p.y = parseInt(el.style.top, 10);
      this.savePositions();
    };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  }

  // --- HUD (zoom readout / buttons) ----------------------------------------

  private buildHud() {
    const hud = document.createElement('div');
    hud.className = 'hw-hud';

    const out = document.createElement('button');
    out.className = 'hw-hud-btn';
    out.textContent = '−';
    out.addEventListener('click', () => this.setZoom(this.zoom - 0.2));

    const label = document.createElement('span');
    label.className = 'hw-hud-label mono';
    this.hudZoom = label;

    const zin = document.createElement('button');
    zin.className = 'hw-hud-btn';
    zin.textContent = '+';
    zin.addEventListener('click', () => this.setZoom(this.zoom + 0.2));

    const home = document.createElement('button');
    home.className = 'hw-hud-btn';
    home.textContent = '⌂';
    home.title = 'Recenter';
    home.addEventListener('click', () => this.recenter());

    hud.append(out, label, zin, home);
    this.viewport.appendChild(hud);
    this.syncHud();
  }

  private syncHud() {
    if (this.hudZoom) this.hudZoom.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  // --- Persistence ----------------------------------------------------------

  private loadPositions() {
    try {
      const raw = localStorage.getItem(WALL_KEY);
      if (raw) this.positions = JSON.parse(raw) || {};
    } catch {
      this.positions = {};
    }
  }

  private savePositions() {
    try {
      localStorage.setItem(WALL_KEY, JSON.stringify(this.positions));
    } catch { /* storage full — non fatal */ }
  }
}
