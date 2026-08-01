// rack.ts — small hardware-UI primitives shared by every feature module.
// Kept intentionally dependency-free: each helper returns a plain element
// that the caller appends into its module body.

export interface LedOptions {
  color?: string;
  glow?: boolean;
  title?: string;
}

// A small panel strip (metal faceplate) with a caption.
export function makePanel(caption: string, className = 'hw-panel'): HTMLElement {
  const panel = document.createElement('div');
  panel.className = className;
  const label = document.createElement('span');
  label.className = 'hw-panel-caption';
  label.textContent = caption;
  panel.appendChild(label);
  return panel;
}

// A round indicator LED. Color is a CSS color; `on` toggles the glow state.
export function makeLed(options: LedOptions = {}): HTMLElement {
  const led = document.createElement('span');
  led.className = 'hw-led';
  if (options.color) led.style.setProperty('--led-color', options.color);
  if (options.glow) led.classList.add('on');
  if (options.title) led.title = options.title;
  return led;
}

// A push button (tactile). `label` is its text; className adds to 'hw-btn'.
export function makeBtn(label: string, className = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `hw-btn ${className}`.trim();
  btn.textContent = label;
  return btn;
}

// A 7-segment style readout. `value` is text; className adds to 'hw-readout'.
export function makeReadout(value = '--', className = 'hw-readout'): HTMLElement {
  const el = document.createElement('span');
  el.className = `mono ${className}`.trim();
  el.textContent = value;
  return el;
}

// A caption tag used above groups of controls (e.g. "BPM", "PAN").
export function makeTag(text: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'hw-tag';
  tag.textContent = text;
  return tag;
}

// A labeled group: tag above, contents below.
export function makeGroup(tag: string, ...children: HTMLElement[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'hw-group';
  group.appendChild(makeTag(tag));
  children.forEach((c) => group.appendChild(c));
  return group;
}
