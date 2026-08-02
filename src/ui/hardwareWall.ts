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
// Performance notes:
//   - Wheel zoom events are COALESCED into a single per-frame update
//     (requestAnimationFrame). The handler itself does no layout work; all
//     reads/writes happen once per frame in flushZoom().
//   - The viewport's screen rect is cached and only refreshed on resize
//     (the wall is inset:0 inside a position:fixed #app, so it does not move
//     on scroll or zoom).
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

interface ZoomEvent {
  factor: number;
  x: number;
  y: number;
}

export class HardwareWall {
  readonly viewport: HTMLElement;
  readonly world: HTMLElement;

  private readonly WALL_W = 3400;
  private readonly WALL_H = 2800;
  private readonly MIN_ZOOM = 0.4;
  // 2.0 keeps the scaled world (3400 * 2 = 6800px) under the common
  // 8192px GPU texture limit; higher values cause re-rasterization jank.
  private readonly MAX_ZOOM = 2.0;

  private modules = new Map<string, WallModule>();
  private positions: Record<string, { x: number; y: number }> = {};
  private zoom = 1;

  private hudZoom: HTMLElement | null = null;

  // Cached viewport rect (screen position). Refreshed on window resize only.
  private viewportRect = { left: 0, top: 0, width: 0, height: 0 };

  // Coalesced zoom queue: wheel events accumulate here and are flushed once
  // per animation frame, so several events in one frame cost one layout pass.
  private zoomQueue: ZoomEvent[] = [];
  private frameScheduled = false;
  private _smoothTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.viewport = document.createElement('div');
    this.viewport.className = 'hw-wall';
    this.world = document.createElement('div');
    this.world.className = 'hw-world';
    this.world.style.width = `${this.WALL_W}px`;
    this.world.style.height = `${this.WALL_H}px`;
    this.viewport.appendChild(this.world);
    container.appendChild(this.viewport);

    this.refreshViewportRect();
    this.loadPositions();
    this.bindViewport();
    this.bindResize();
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
      this.enqueueZoom(factor, e.clientX, e.clientY);
    }, { passive: false });
  }

  private bindResize() {
    window.addEventListener('resize', () => this.refreshViewportRect());
  }

  private refreshViewportRect() {
    const r = this.viewport.getBoundingClientRect();
    this.viewportRect.left = r.left;
    this.viewportRect.top = r.top;
    this.viewportRect.width = r.width;
    this.viewportRect.height = r.height;
  }

  // Queue one zoom step; the actual work happens in the next frame.
  private enqueueZoom(factor: number, clientX: number, clientY: number) {
    this.zoomQueue.push({ factor, x: clientX, y: clientY });
    if (!this.frameScheduled) {
      this.frameScheduled = true;
      requestAnimationFrame(() => this.flushZoom());
    }
  }

  // Apply every queued zoom step in pure arithmetic (no per-event DOM access)
  // and commit zoom + scroll once. Runs at most once per frame.
  private flushZoom() {
    this.frameScheduled = false;
    const events = this.zoomQueue;
    this.zoomQueue = [];
    if (!events.length) return;

    const rect = this.viewportRect;
    let z = this.zoom;
    let sl = this.viewport.scrollLeft;
    let st = this.viewport.scrollTop;

    for (const ev of events) {
      const next = clamp(z * ev.factor, this.MIN_ZOOM, this.MAX_ZOOM);
      const wx = (sl + (ev.x - rect.left)) / z;
      const wy = (st + (ev.y - rect.top)) / z;
      z = next;
      sl = wx * z - (ev.x - rect.left);
      st = wy * z - (ev.y - rect.top);
    }

    this.zoom = z;
    this.viewport.scrollLeft = sl;
    this.viewport.scrollTop = st;
    this.applyZoom();
    this.syncHud();
  }

  setZoom(z: number) {
    // Smooth ease-out for discrete HUD button clicks (not wheel drags).
    this.world.classList.add('smooth');
    if (this._smoothTimer != null) clearTimeout(this._smoothTimer);
    this._smoothTimer = window.setTimeout(() => {
      this._smoothTimer = null;
      this.world.classList.remove('smooth');
    }, 180);
    this.enqueueZoom(
      clamp(z, this.MIN_ZOOM, this.MAX_ZOOM) / this.zoom,
      this.viewportRect.left + this.viewportRect.width / 2,
      this.viewportRect.top + this.viewportRect.height / 2
    );
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
