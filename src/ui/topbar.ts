// TopBar — the fixed header above the wall. It is NOT part of the canvas:
// it holds the brand plate and the always-visible transport controls
// (play/stop, BPM, loop, pattern, status). The transport module mounts its
// bar body into `transportHost`; the wall never sees the top bar.
//
// The bar also hosts the toggle that slides the Sampler drawer out from the
// left edge, so the sampler is never "lost" somewhere on the wall.

export class TopBar {
  readonly el: HTMLElement;
  readonly transportHost: HTMLElement;
  readonly samplerToggle: HTMLButtonElement;

  private onSamplerToggle: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('header');
    this.el.className = 'hw-topbar';

    const brand = document.createElement('span');
    brand.className = 'hw-topbar-brand';
    brand.textContent = 'VOIDSTATION';

    this.transportHost = document.createElement('div');
    this.transportHost.className = 'hw-topbar-host';

    const samplerWrap = document.createElement('div');
    samplerWrap.className = 'hw-topbar-sampler';

    this.samplerToggle = document.createElement('button');
    this.samplerToggle.type = 'button';
    this.samplerToggle.className = 'hw-btn hw-sampler-toggle';
    this.samplerToggle.id = 'btn-sampler';
    this.samplerToggle.textContent = 'SAMPLER';
    this.samplerToggle.title = 'Open the sampler panel';
    this.samplerToggle.addEventListener('click', () => this.onSamplerToggle?.());

    samplerWrap.appendChild(this.samplerToggle);
    this.el.append(brand, this.transportHost, samplerWrap);
  }

  setSamplerToggleHandler(handler: () => void) {
    this.onSamplerToggle = handler;
  }
}
