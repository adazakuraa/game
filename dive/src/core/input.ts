/** Unified input: touch (virtual stick + look drag + buttons), mouse drag look, keyboard. Emits intents only. */
export class Input {
  moveX = 0;
  moveY = 0;
  lookDX = 0;
  lookDY = 0;
  up = false;
  down = false;
  boost = false;
  private keys = new Set<string>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private held = new Map<string, boolean>();
  private pressed = new Set<string>();
  sensitivity = 1;
  enabled = true;

  constructor(private surface: HTMLElement, private stickEl: HTMLElement, private knobEl: HTMLElement) {
    surface.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => document.hidden && this.reset());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const map: Record<string, string> = { KeyE: 'shutter', Enter: 'shutter', KeyF: 'shutter', KeyL: 'light', KeyM: 'dex', Tab: 'dex', KeyN: 'map', Escape: 'menu', KeyR: 'surface' };
      if (map[e.code]) {
        this.pressed.add(map[e.code]);
        if (e.code === 'Tab') e.preventDefault();
      }
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** Bind a DOM button to a held flag and/or a pressed edge. */
  bindButton(el: HTMLElement, name: string, hold = false): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('pressed');
      if (hold) this.held.set(name, true);
      else this.pressed.add(name);
    };
    const up = (e: PointerEvent) => {
      el.classList.remove('pressed');
      if (hold) this.held.set(name, false);
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', () => {
      el.classList.remove('pressed');
      if (hold) this.held.set(name, false);
    });
  }

  consume(name: string): boolean {
    const had = this.pressed.has(name);
    this.pressed.delete(name);
    return had;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (isTouch && e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickVec = { x: 0, y: 0 };
      this.stickEl.style.left = e.clientX + 'px';
      this.stickEl.style.top = e.clientY + 'px';
      this.stickEl.classList.add('active');
      this.knobEl.style.transform = 'translate(-50%,-50%)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const R = 56;
      const l = Math.hypot(dx, dy);
      const k = l > R ? R / l : 1;
      this.stickVec = { x: (dx * k) / R, y: (dy * k) / R };
      this.knobEl.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      e.preventDefault();
    } else if (e.pointerId === this.lookId) {
      const sc = e.pointerType === 'mouse' ? 0.0032 : 0.0055;
      this.lookDX += (e.clientX - this.lookLast.x) * sc * this.sensitivity;
      this.lookDY += (e.clientY - this.lookLast.y) * sc * this.sensitivity;
      this.lookLast = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      this.stickEl.classList.remove('active');
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  };

  reset(): void {
    this.stickId = null;
    this.lookId = null;
    this.stickVec = { x: 0, y: 0 };
    this.stickEl.classList.remove('active');
    this.keys.clear();
    for (const k of this.held.keys()) this.held.set(k, false);
  }

  /** Call once per frame before reading. */
  poll(): void {
    const k = this.keys;
    let x = this.stickVec.x;
    let y = -this.stickVec.y;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    // small dead zone on the stick
    if (l < 0.12 && this.stickId !== null) { x = 0; y = 0; }
    this.moveX = x;
    this.moveY = y;
    this.up = k.has('Space') || !!this.held.get('up');
    this.down = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC') || !!this.held.get('down');
    this.boost = k.has('KeyQ') || !!this.held.get('boost');
  }

  takeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }
}
