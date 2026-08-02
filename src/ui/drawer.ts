// Drawer — a slide-out panel from the left edge that sits on top of the wall
// (the wall is not resized). The Sampler module mounts its body into `body`.
// Open via the top bar toggle; close via the toggle, the close button, the
// backdrop, or the Escape key.

export interface DrawerOptions {
  width?: number;
}

export class Drawer {
  readonly el: HTMLElement;
  readonly body: HTMLElement;

  private backdrop: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private opened = false;

  private readonly onCloseHandlers: (() => void)[] = [];

  constructor(options: DrawerOptions = {}) {
    const width = options.width ?? 340;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'hw-drawer-backdrop';
    this.backdrop.addEventListener('click', () => this.close());

    this.el = document.createElement('aside');
    this.el.className = 'hw-drawer';
    this.el.style.width = `${width}px`;
    this.el.style.transform = `translateX(-${width}px)`;

    const header = document.createElement('header');
    header.className = 'hw-drawer-header';
    const title = document.createElement('span');
    title.className = 'hw-drawer-title';
    title.textContent = 'SAMPLER';
    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'hw-btn hw-drawer-close';
    this.closeBtn.textContent = '×';
    this.closeBtn.title = 'Close';
    this.closeBtn.addEventListener('click', () => this.close());
    header.append(title, this.closeBtn);

    this.body = document.createElement('div');
    this.body.className = 'hw-drawer-body';

    this.el.append(header, this.body);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.opened) this.close();
    });
  }

  mount(parent: HTMLElement) {
    parent.append(this.backdrop, this.el);
  }

  isOpen(): boolean {
    return this.opened;
  }

  toggle() {
    this.opened ? this.close() : this.open();
  }

  open() {
    this.opened = true;
    this.backdrop.classList.add('visible');
    this.el.classList.add('open');
    this.el.style.transform = 'translateX(0)';
    this.closeBtn.focus();
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    this.backdrop.classList.remove('visible');
    this.el.classList.remove('open');
    const width = this.el.style.width;
    this.el.style.transform = `translateX(-${width})`;
    this.onCloseHandlers.forEach((h) => h());
  }

  onClose(handler: () => void) {
    this.onCloseHandlers.push(handler);
  }
}
