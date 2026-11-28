/**
 * 修正バッチ2 F4：吹き出し（会話）の基盤。
 * - 大きい版：画面下寄りに話し手の顔・名前・本文。吹き出し以外は半透明の黒。指す先がある段では、その要素の周りだけ穴を開けて明るく見せ、脈打つ輪を重ねる。
 *   段の種類：話（どこをタップしても次へ）／選ぶ（吹き出しの中のボタン。結果を Promise で返す）／操作させる（指した要素だけ押せる。押したら次の段へ）。
 * - 小型版（mini）：暗くしない。上部（#coach と同じ場所）、タップで閉じる・数秒で消える。潜水中用。
 * 台本は game/talks.ts。ここは見た目と進行だけ。
 */

export type Who = 'editor' | 'okami' | 'gen';

export type TalkLine = {
  who: Who;
  text: string;
  /** CSS セレクタ。指す先（穴を開けて輪を重ねる） */
  target?: string;
  /** 'tap'（既定）＝どこをタップしても次へ／'click'＝指した要素を押したら次へ／'event:名前'＝emit(名前) で次へ */
  wait?: 'tap' | 'click' | `event:${string}`;
  /** 選ぶ段：吹き出しの中のボタン（押した id が結果の choice になる） */
  choices?: { id: string; label: string }[];
  /** この段に入る前に呼ぶ処理の名前（run の hooks から引く。例：しおさい亭を閉じる） */
  pre?: string;
};

export type TalkResult = { done: boolean; skipped: boolean; choice?: string };
export type TalkHooks = Record<string, () => void | Promise<void>>;

export const WHO: Record<Who, { name: string }> = {
  editor: { name: '編集長' },
  okami: { name: '女将のハルさん' },
  gen: { name: '漁師のゲンさん' },
};

/** 手続き描画の簡単な似顔（SVG）。 */
export function faceSvg(who: Who): string {
  const skin = '#f3cfae';
  const base = (inner: string, bg: string) => `<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="28" fill="${bg}"/>${inner}</svg>`;
  const eyes = '<circle cx="21" cy="29" r="2" fill="#2a2a2a"/><circle cx="35" cy="29" r="2" fill="#2a2a2a"/>';
  if (who === 'editor') {
    return base(`<path d="M10 56c2-12 10-16 18-16s16 4 18 16z" fill="#34506a"/><path d="M24 40l4 8 4-8z" fill="#fff"/><ellipse cx="28" cy="29" rx="12" ry="13.5" fill="${skin}"/><path d="M15 26c0-10 7-14 13-14s13 4 13 14c-3-5-8-7-13-7s-10 2-13 7z" fill="#3a2e28"/>${eyes}<g fill="none" stroke="#222" stroke-width="1.6"><circle cx="21" cy="29" r="5"/><circle cx="35" cy="29" r="5"/><path d="M26 29h4"/></g><path d="M23 38q5 3 10 0" fill="none" stroke="#8a4b3a" stroke-width="1.6" stroke-linecap="round"/>`, '#2c6a8a');
  }
  if (who === 'okami') {
    return base(`<path d="M10 56c2-12 10-16 18-16s16 4 18 16z" fill="#e8e0d0"/><path d="M20 42h16l2 14H18z" fill="#fff"/><ellipse cx="28" cy="29" rx="12" ry="13.5" fill="${skin}"/><path d="M15 28c-1-11 6-17 13-17s14 6 13 17c-2-6-7-9-13-9s-11 3-13 9z" fill="#5a4636"/><circle cx="28" cy="9" r="5" fill="#5a4636"/>${eyes}<circle cx="19" cy="34" r="2.6" fill="#f0a090" opacity=".6"/><circle cx="37" cy="34" r="2.6" fill="#f0a090" opacity=".6"/><path d="M23 37q5 4 10 0" fill="none" stroke="#a04a3a" stroke-width="1.6" stroke-linecap="round"/>`, '#8a5a3a');
  }
  return base(`<path d="M10 56c2-12 10-16 18-16s16 4 18 16z" fill="#c8602a"/><ellipse cx="28" cy="29" rx="12" ry="13.5" fill="#d9a67e"/><path d="M14 24c0-9 6-13 14-13s14 4 14 13z" fill="#27465a"/><path d="M12 24h32l-3 3H15z" fill="#1c3444"/>${eyes}<path d="M17 34c2 10 9 12 11 12s9-2 11-12c-3 3-7 4-11 4s-8-1-11-4z" fill="#d8d8d8"/><path d="M23 37q5 2 10 0" fill="none" stroke="#8a4b3a" stroke-width="1.4" stroke-linecap="round"/>`, '#3a6a52');
}

/** 吹き出し 1 つに収まらない長さを、句点で 2〜3 段に分ける（自動）。 */
export function splitText(text: string, max = 46): string[] {
  const sentences = text.match(/[^。！？]+[。！？]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  for (let lim = max; lim < 400; lim += 8) {
    const out: string[] = [];
    for (const s of sentences) {
      if (out.length && out[out.length - 1].length + s.length <= lim) out[out.length - 1] += s;
      else out.push(s);
    }
    if (out.length <= 3) return out;
  }
  return [text];
}

type Run = { lines: TalkLine[]; i: number; res: (r: TalkResult) => void; hooks?: TalkHooks; choice?: string; shownAt: number; missing: number };

export class TalkUI {
  private root: HTMLElement;
  private mini: HTMLElement;
  private cur: Run | null = null;
  private miniTimer = 0;
  private raf = 0;
  private lastRect = '';
  private waitSel: string | null = null;
  private waitEvent: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'talk';
    this.root.className = 'hidden';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', '会話');
    this.root.innerHTML = '<div class="tk-dim"></div><div class="tk-ring"></div><div class="tk-box"><button type="button" class="tk-skip">スキップ</button><div class="tk-head"><span class="tk-face"></span><b class="tk-name"></b></div><p class="tk-text"></p><div class="tk-choices"></div><span class="tk-next" aria-hidden="true">▼</span></div>';
    parent.appendChild(this.root);
    this.mini = document.createElement('div');
    this.mini.id = 'talk-mini';
    this.mini.className = 'hidden';
    this.mini.setAttribute('role', 'status');
    this.mini.setAttribute('aria-live', 'polite');
    this.mini.innerHTML = '<span class="tk-face"></span><div><b class="tk-name"></b><p class="tk-text"></p></div>';
    parent.appendChild(this.mini);

    const tap = (e: Event) => {
      if (!this.cur) return;
      const L = this.cur.lines[this.cur.i];
      if (!L || (L.choices && L.choices.length)) return;
      if (this.waitSel || this.waitEvent) return;
      if (performance.now() - this.cur.shownAt < 220) return;
      e.stopPropagation();
      void this.next();
    };
    this.root.querySelector('.tk-dim')!.addEventListener('click', tap);
    this.root.querySelector('.tk-box')!.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) tap(e); });
    this.root.querySelector('.tk-skip')!.addEventListener('click', (e) => { e.stopPropagation(); this.end(true); });
    // 「操作させる」段：指した要素を押したら次へ（要素が描き直されても追えるよう、document の捕捉で見る）
    document.addEventListener('click', (e) => {
      if (!this.cur || !this.waitSel) return;
      const t = e.target as Element | null;
      if (t && t.closest(this.waitSel)) window.setTimeout(() => void this.next(), 0);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!this.cur) return;
      const L = this.cur.lines[this.cur.i];
      if (e.key === 'Escape') { this.end(true); return; }
      if ((e.key === 'Enter' || e.key === ' ') && L && !L.choices?.length && !this.waitSel && !this.waitEvent && !(document.activeElement as HTMLElement | null)?.closest('.tk-skip')) { e.preventDefault(); void this.next(); }
    });
    this.mini.addEventListener('click', () => this.hideMini());
  }

  get active(): boolean { return !!this.cur; }

  /** 台本を最初から出す。終わる（またはスキップされる）と解決する。 */
  run(lines: TalkLine[], hooks?: TalkHooks): Promise<TalkResult> {
    if (this.cur) this.end(true);
    return new Promise((res) => {
      this.cur = { lines, i: -1, res, hooks, shownAt: 0, missing: 0 };
      this.root.classList.remove('hidden');
      this.loop();
      void this.next();
    });
  }

  /** 「event:名前」の段を進める。 */
  emit(name: string): void {
    if (this.cur && this.waitEvent === name) void this.next();
  }

  /** 強制的に閉じる（スキップ扱い）。 */
  abort(): void { if (this.cur) this.end(true); this.hideMini(); }

  private async next(): Promise<void> {
    const c = this.cur;
    if (!c) return;
    c.i++;
    this.waitSel = null; this.waitEvent = null;
    if (c.i >= c.lines.length) { this.end(false); return; }
    const L = c.lines[c.i];
    if (L.pre) await c.hooks?.[L.pre]?.();
    if (this.cur !== c) return;
    this.show(c, L);
  }

  private show(c: Run, L: TalkLine): void {
    c.shownAt = performance.now(); c.missing = 0; this.lastRect = '';
    const r = this.root;
    r.querySelector('.tk-face')!.innerHTML = faceSvg(L.who);
    r.querySelector('.tk-name')!.textContent = WHO[L.who].name;
    r.querySelector('.tk-text')!.textContent = L.text;
    const box = r.querySelector<HTMLElement>('.tk-choices')!;
    box.innerHTML = '';
    for (const ch of L.choices ?? []) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn ' + (ch === L.choices![0] ? 'pri' : 'sec'); b.textContent = ch.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); c.choice = ch.id; void this.next(); });
      box.appendChild(b);
    }
    const wait = L.wait ?? (L.target && !L.choices ? 'tap' : 'tap');
    if (!L.choices?.length) {
      if (wait === 'click' && L.target) this.waitSel = L.target;
      else if (wait.startsWith('event:')) this.waitEvent = wait.slice(6);
    }
    r.classList.toggle('choosing', !!L.choices?.length);
    r.classList.toggle('acting', !!this.waitSel || !!this.waitEvent);
    r.classList.toggle('pointing', !!L.target);
    if (L.target) document.querySelector(L.target)?.scrollIntoView({ block: 'nearest' });
    this.place();
  }

  private end(skipped: boolean): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null; this.waitSel = null; this.waitEvent = null;
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    c.res({ done: !skipped, skipped, choice: c.choice });
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const f = () => { if (!this.cur) return; this.place(); this.raf = requestAnimationFrame(f); };
    this.raf = requestAnimationFrame(f);
  }

  /** 穴・輪・吹き出しの位置（毎フレーム。レイアウトが動いても追う）。 */
  private place(): void {
    const c = this.cur;
    if (!c || c.i < 0 || c.i >= c.lines.length) return;
    const L = c.lines[c.i];
    const dim = this.root.querySelector<HTMLElement>('.tk-dim')!;
    const ring = this.root.querySelector<HTMLElement>('.tk-ring')!;
    const box = this.root.querySelector<HTMLElement>('.tk-box')!;
    const el = L.target ? document.querySelector<HTMLElement>(L.target) : null;
    const rc = el ? el.getBoundingClientRect() : null;
    const ok = !!rc && rc.width > 2 && rc.height > 2 && getComputedStyle(el!).visibility !== 'hidden';
    if (!ok) {
      ring.style.display = 'none'; dim.style.clipPath = ''; dim.classList.remove('clear');
      this.root.classList.remove('lit');
      box.classList.remove('top');
      // 操作させる段で指す先がいつまでも見つからないときは、詰まらないよう「話」に落とす
      if (L.target && this.waitSel && ++c.missing > 90) { this.waitSel = null; this.root.classList.remove('acting'); }
      return;
    }
    c.missing = 0;
    const pad = 6;
    const x = rc!.left - pad, y = rc!.top - pad, w = rc!.width + pad * 2, h = rc!.height + pad * 2;
    const key = `${x | 0},${y | 0},${w | 0},${h | 0},${innerWidth},${innerHeight},${this.waitSel ? 1 : 0}`;
    if (key !== this.lastRect) {
      this.lastRect = key;
      ring.style.display = 'block';
      ring.style.left = `${x}px`; ring.style.top = `${y}px`; ring.style.width = `${w}px`; ring.style.height = `${h}px`;
      this.root.classList.add('lit');
      // 押させる段は、穴の部分だけ暗幕を抜いて指が通るようにする（それ以外は暗幕が受け止める）
      if (this.waitSel) {
        dim.classList.add('clear');
        dim.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
      } else { dim.classList.add('clear'); dim.style.clipPath = ''; }
      box.classList.toggle('top', y + h / 2 > innerHeight * 0.52);
    }
  }

  // ------------------------------------------------------------ 小型版（潜水中）
  /** 暗くしない小さな吹き出し。タップで閉じる・sec 秒で消える。 */
  showMini(who: Who, text: string, sec = 6): void {
    this.mini.querySelector('.tk-face')!.innerHTML = faceSvg(who);
    this.mini.querySelector('.tk-name')!.textContent = WHO[who].name;
    this.mini.querySelector('.tk-text')!.textContent = text;
    this.mini.classList.remove('hidden');
    window.clearTimeout(this.miniTimer);
    this.miniTimer = window.setTimeout(() => this.hideMini(), sec * 1000);
  }

  hideMini(): void {
    window.clearTimeout(this.miniTimer);
    this.mini.classList.add('hidden');
  }

  get miniOpen(): boolean { return !this.mini.classList.contains('hidden'); }
}
