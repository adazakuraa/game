/** Unified keyboard/mouse/touch input that emits game intents. */
export interface Intents {
  moveX: number;
  moveY: number;
  lookX: number; // accumulated radians since last consume
  lookY: number;
  rest: boolean;
  clipPressed: boolean;
  interactPressed: boolean;
  o2Up: boolean;
  o2Down: boolean;
  pausePressed: boolean;
  mapPressed: boolean;
}

export class Input {
  readonly intents: Intents = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, rest: false,
    clipPressed: false, interactPressed: false, o2Up: false, o2Down: false, pausePressed: false, mapPressed: false,
  };
  private keys = new Set<string>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private restTouch = false;
  private disposers: (() => void)[] = [];
  enabled = false;
  sensitivity = 1;

  constructor(
    private readonly surface: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly stickBase: HTMLElement,
    private readonly stickKnob: HTMLElement,
  ) {
    this.on(window, 'keydown', (e: Event) => this.onKey(e as KeyboardEvent, true));
    this.on(window, 'keyup', (e: Event) => this.onKey(e as KeyboardEvent, false));
    this.on(window, 'blur', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    this.on(document, 'mousemove', (e: Event) => {
      const m = e as MouseEvent;
      if (document.pointerLockElement === this.canvas) {
        this.intents.lookX -= m.movementX * 0.0024 * this.sensitivity;
        this.intents.lookY -= m.movementY * 0.0024 * this.sensitivity;
      }
    });
    this.on(surface, 'pointerdown', (e: Event) => this.onDown(e as PointerEvent));
    this.on(surface, 'pointermove', (e: Event) => this.onMove(e as PointerEvent));
    this.on(surface, 'pointerup', (e: Event) => this.onUp(e as PointerEvent));
    this.on(surface, 'pointercancel', (e: Event) => this.onUp(e as PointerEvent));
    this.on(surface, 'lostpointercapture', (e: Event) => this.onUp(e as PointerEvent));
  }

  private on(t: EventTarget, type: string, fn: (e: Event) => void): void {
    t.addEventListener(type, fn, { passive: false });
    this.disposers.push(() => t.removeEventListener(type, fn));
  }

  /** Bind a DOM button to an intent (press edge or hold). */
  bindButton(el: HTMLElement, kind: 'clip' | 'interact' | 'rest' | 'o2Up' | 'o2Down' | 'pause' | 'map'): void {
    const down = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('pressed');
      if (kind === 'clip') this.intents.clipPressed = true;
      else if (kind === 'interact') this.intents.interactPressed = true;
      else if (kind === 'rest') this.restTouch = true;
      else if (kind === 'o2Up') this.intents.o2Up = true;
      else if (kind === 'o2Down') this.intents.o2Down = true;
      else if (kind === 'pause') this.intents.pausePressed = true;
      else if (kind === 'map') this.intents.mapPressed = true;
      try { (el as HTMLElement).setPointerCapture((e as PointerEvent).pointerId); } catch { /* ignore */ }
    };
    const up = (e: Event) => {
      e.stopPropagation();
      el.classList.remove('pressed');
      if (kind === 'rest') this.restTouch = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
    });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    if (down) {
      if (!this.keys.has(code)) {
        if (code === 'KeyE') this.intents.clipPressed = true;
        if (code === 'KeyF') this.intents.interactPressed = true;
        if (code === 'KeyX' || code === 'Equal') this.intents.o2Up = true;
        if (code === 'KeyZ' || code === 'Minus') this.intents.o2Down = true;
        if (code === 'Escape' || code === 'KeyP') this.intents.pausePressed = true;
        if (code === 'KeyM') this.intents.mapPressed = true;
      }
      this.keys.add(code);
      if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
    } else {
      this.keys.delete(code);
    }
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement !== this.canvas) {
        try {
          const r = this.canvas.requestPointerLock?.() as unknown;
          if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
        } catch { /* pointer lock unavailable: drag-to-look below */ }
        // Drag-to-look fallback while unlocked.
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
        try { this.surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      return;
    }
    e.preventDefault();
    const w = this.surface.clientWidth;
    if (e.clientX < w * 0.45 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickVec = { x: 0, y: 0 };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('active');
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
    try { this.surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      e.preventDefault();
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const r = 52;
      const len = Math.hypot(dx, dy);
      const k = len > r ? r / len : 1;
      this.stickVec = { x: (dx * k) / r, y: (dy * k) / r };
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.intents.lookX -= dx * 0.0052 * this.sensitivity;
      this.intents.lookY -= dy * 0.0052 * this.sensitivity;
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      this.stickBase.classList.remove('active');
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.stickId = null;
    this.lookId = null;
    this.stickVec = { x: 0, y: 0 };
    this.restTouch = false;
    this.stickBase.classList.remove('active');
  }

  /** Refresh continuous intents from held state. */
  poll(): Intents {
    const i = this.intents;
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    x += this.stickVec.x;
    y -= this.stickVec.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    i.moveX = this.enabled ? x : 0;
    i.moveY = this.enabled ? y : 0;
    i.rest = this.enabled && (this.keys.has('Space') || this.restTouch);
    return i;
  }

  consumeEdges(): void {
    const i = this.intents;
    i.clipPressed = false;
    i.interactPressed = false;
    i.o2Up = false;
    i.o2Down = false;
    i.pausePressed = false;
    i.mapPressed = false;
    i.lookX = 0;
    i.lookY = 0;
  }

  /** Test hook: inject a held move vector. */
  setVirtualStick(x: number, y: number): void {
    this.stickVec = { x, y: -y };
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
