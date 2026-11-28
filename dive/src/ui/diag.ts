import type * as THREE from 'three';
import type { Creatures } from '../life/creatures';

/** Separate from the save: switching the readout on must not touch the player's progress. */
const KEY = 'blue-depths-diag';

type Count = { calls: number; tris: number };

/**
 * Performance readout for a real device (PHASE8-DESIGN §9.1): fps, draw calls, triangles, canvas pixels,
 * pixel ratio and creatures per level of detail, refreshed once a second. Switched on with `?diag` in the
 * URL or the button in the debug row. Frames with and without the shadow pass are counted separately.
 */
export class Diag {
  private on = false;
  private fps = 0;
  private frames = 0;
  private since = performance.now();
  private plain: Count = { calls: 0, tris: 0 };
  private shadow: Count = { calls: 0, tris: 0 };
  private shadowFrame = false;

  constructor(private el: HTMLElement, private button: HTMLButtonElement | null, private renderer: THREE.WebGLRenderer) {
    let stored = false;
    try { stored = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }
    this.set(stored || new URLSearchParams(window.location.search).has('diag'));
    button?.addEventListener('click', () => {
      this.set(!this.on);
      try { localStorage.setItem(KEY, this.on ? '1' : '0'); } catch { /* storage unavailable */ }
    });
  }

  private set(on: boolean): void {
    this.on = on;
    this.el.classList.toggle('hidden', !on);
    if (this.button) {
      this.button.textContent = on ? '診断表示を消す' : '診断表示を出す';
      this.button.setAttribute('aria-pressed', String(on));
    }
    // three resets its counters after the shadow pass; reset them by hand so that the pass is included
    this.renderer.info.autoReset = !on;
    this.frames = 0;
    this.since = performance.now();
    this.el.textContent = on ? '計測中…' : '';
  }

  beforeRender(): void {
    if (!this.on) return;
    this.shadowFrame = this.renderer.shadowMap.needsUpdate;
    this.renderer.info.reset();
  }

  afterRender(creatures: Creatures): void {
    if (!this.on) return;
    const r = this.renderer.info.render;
    const c = this.shadowFrame ? this.shadow : this.plain;
    c.calls = r.calls;
    c.tris = r.triangles;
    this.frames++;
    const now = performance.now();
    if (now - this.since < 1000) return;
    this.fps = (this.frames * 1000) / (now - this.since);
    this.frames = 0;
    this.since = now;
    const v = this.values(creatures);
    const k = (n: number) => Math.round(n / 1000) + 'k';
    this.el.textContent = [
      `fps ${v.fps.toFixed(1)}`,
      `呼び出し ${v.calls}（影あり ${v.shadowCalls}）`,
      `三角形 ${k(v.triangles)}（影あり ${k(v.shadowTriangles)}）`,
      `画素 ${(v.pixels / 10000).toFixed(1)}万（${v.width}×${v.height}）`,
      `DPR ${v.dpr.toFixed(2)}　画面 ${window.innerWidth}×${window.innerHeight}`,
      `L0/L1/L2 ${v.l0}/${v.l1}/${v.l2}`,
    ].join('\n');
  }

  /** Same numbers as on screen (also published in __THREE_GAME_DIAGNOSTICS__). fps and the split counts need the readout on. */
  values(creatures: Creatures) {
    const c = this.renderer.domElement;
    const info = this.renderer.info.render;
    return {
      on: this.on,
      fps: this.fps,
      calls: this.on ? this.plain.calls : info.calls,
      triangles: this.on ? this.plain.tris : info.triangles,
      shadowCalls: this.shadow.calls,
      shadowTriangles: this.shadow.tris,
      width: c.width,
      height: c.height,
      pixels: c.width * c.height,
      dpr: this.renderer.getPixelRatio(),
      ...creatures.lodCounts(),
    };
  }
}
