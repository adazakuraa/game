/**
 * Small games at the diner: short, readable at a glance, with an immediate, physical answer to every tap
 * (a pop for a good urchin, a shake and lost seconds for a spiny one).
 */

export const SORT = {
  /** 【ウニの選別】seconds, cells on the tray, time lost when grabbing a stinging one */
  time: 25, cells: 12, sting: 3,
  /** points: ムラサキウニ 1, アカウニ 2 */
  yenPerPoint: 80, repAt: 14,
};

type UType = 'murasaki' | 'aka' | 'gangaze' | 'rappa';
const PTS: Record<UType, number> = { murasaki: 1, aka: 2, gangaze: 0, rappa: 0 };

/** A top-down urchin. The two edible ones differ only a little (colour and spine length). */
export function urchinSvg(t: UType, seed: number): string {
  const rnd = (k: number) => { const x = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const S = {
    murasaki: { body: '#2a1832', spine: '#3c2648', len: 19, n: 44, w: 1.6 },
    aka: { body: '#4e2422', spine: '#6e3428', len: 15, n: 48, w: 1.7 },
    gangaze: { body: '#141018', spine: '#1e1a24', len: 34, n: 30, w: 0.9 },
    rappa: { body: '#c8a0ac', spine: '#a87884', len: 6, n: 60, w: 2.4 },
  }[t];
  let lines = '';
  for (let i = 0; i < S.n; i++) {
    const a = (i / S.n) * Math.PI * 2 + rnd(i) * 0.2;
    const l = S.len * (0.75 + rnd(i + 50) * 0.45);
    const r0 = 13;
    lines += `<line x1="${(50 + Math.cos(a) * r0).toFixed(1)}" y1="${(50 + Math.sin(a) * r0).toFixed(1)}" x2="${(50 + Math.cos(a) * (r0 + l)).toFixed(1)}" y2="${(50 + Math.sin(a) * (r0 + l)).toFixed(1)}"/>`;
  }
  let extra = '';
  if (t === 'rappa') {
    for (let i = 0; i < 16; i++) {
      const a = rnd(i + 100) * Math.PI * 2, r = rnd(i + 200) * 14;
      extra += `<circle cx="${(50 + Math.cos(a) * r).toFixed(1)}" cy="${(50 + Math.sin(a) * r).toFixed(1)}" r="2.6" fill="${i % 3 ? '#f4dce4' : '#f0f0f0'}"/>`;
    }
  }
  if (t === 'gangaze') extra = '<circle cx="50" cy="50" r="3.5" fill="#d87a2a"/>';
  return `<svg viewBox="0 0 100 100" style="transform:rotate(${Math.round(rnd(7) * 360)}deg)"><g stroke="${S.spine}" stroke-width="${S.w}" stroke-linecap="round">${lines}</g><circle cx="50" cy="50" r="15" fill="${S.body}"/>${extra}</svg>`;
}

function pick(): UType {
  const r = Math.random();
  return r < 0.4 ? 'murasaki' : r < 0.56 ? 'aka' : r < 0.8 ? 'gangaze' : 'rappa';
}

/** Tap only the edible urchins on the tray before time runs out. */
export function runUrchinSort(root: HTMLElement, done: (points: number, aka: number, stings: number) => void): void {
  let t = SORT.time, points = 0, aka = 0, stings = 0, seed = 1;
  root.innerHTML = `<div class="mg-head"><b>ウニの選別</b><span id="mg-score">0点</span><span id="mg-time"></span></div>
    <div class="mg-bar"><i id="mg-bar"></i></div>
    <p class="mg-note">食べられるのは<b>ムラサキウニ</b>（黒紫・トゲ長め・1点）と<b>アカウニ</b>（赤茶色・トゲ少し短め・2点）だけ。<br>トゲがとても長いガンガゼと、花のような桃色のラッパウニに触ると痛い（-${SORT.sting}秒）</p>
    <div class="mg-tray" id="mg-tray"></div>`;
  const tray = root.querySelector<HTMLElement>('#mg-tray')!;
  const fill = (cell: HTMLButtonElement) => {
    const ty = pick();
    cell.dataset.t = ty;
    cell.innerHTML = urchinSvg(ty, seed++);
    cell.classList.remove('got', 'ouch');
  };
  for (let i = 0; i < SORT.cells; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mg-cell';
    fill(b);
    b.addEventListener('click', () => {
      if (t <= 0 || b.classList.contains('got')) return;
      const ty = b.dataset.t as UType;
      if (PTS[ty] > 0) {
        points += PTS[ty];
        if (ty === 'aka') aka++;
        b.classList.add('got');
        window.setTimeout(() => fill(b), 260);
      } else {
        stings++;
        t = Math.max(0, t - SORT.sting);
        b.classList.remove('ouch');
        void b.offsetWidth;
        b.classList.add('ouch');
      }
      root.querySelector('#mg-score')!.textContent = `${points}点`;
    });
    tray.appendChild(b);
  }
  let last = performance.now();
  const step = () => {
    const now = performance.now();
    t -= (now - last) / 1000;
    last = now;
    const bar = root.querySelector<HTMLElement>('#mg-bar');
    if (!bar) return; // closed
    bar.style.width = `${Math.max(0, (t / SORT.time) * 100)}%`;
    root.querySelector('#mg-time')!.textContent = `残り${Math.max(0, Math.ceil(t))}秒`;
    if (t > 0) requestAnimationFrame(step);
    else done(points, aka, stings);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ fugu licence

const QUIZ: { q: string; a: string[]; ok: number }[] = [
  { q: 'フグの毒の名前は？', a: ['テトロドトキシン', 'シガトキシン', 'ヒスタミン'], ok: 0 },
  { q: 'フグ毒は加熱するとどうなる？', a: ['よく煮れば消える', '加熱しても消えない', '冷凍すれば消える'], ok: 1 },
  { q: '免許があっても料理してはいけないフグは？', a: ['トラフグ', 'ヒガンフグ', 'コクテンフグ'], ok: 2 },
  { q: '取り除いた毒のある部位はどうする？', a: ['鍵のかかる容器に入れて処分する', '海に捨てる', '市場に売る'], ok: 0 },
];
const PARTS: { name: string; edible: boolean; note: string }[] = [
  { name: '身（筋肉）', edible: true, note: 'てっさ・てっちりになる' },
  { name: '皮', edible: true, note: 'トラフグの皮は湯引きにする' },
  { name: '白子（精巣）', edible: true, note: '冬のごちそう' },
  { name: 'ひれ', edible: true, note: '乾かしてひれ酒に' },
  { name: '肝臓（キモ）', edible: false, note: '猛毒。どんなにおいしそうでも食べない' },
  { name: '卵巣（真子）', edible: false, note: '猛毒' },
  { name: '腸', edible: false, note: '毒がある' },
  { name: '目（眼球）', edible: false, note: '毒がある' },
];

/** Written questions, then the practical: sort the parts of a トラフグ. One mistake fails. */
export function runFuguExam(root: HTMLElement, done: (passed: boolean, why: string) => void): void {
  const quiz = [...QUIZ].sort(() => Math.random() - 0.5).slice(0, 3);
  const parts = [...PARTS].sort(() => Math.random() - 0.5);
  let qi = 0, pi = 0;
  const showQuiz = () => {
    const q = quiz[qi];
    root.innerHTML = `<div class="mg-head"><b>ふぐ調理師試験</b><span>学科 ${qi + 1}/${quiz.length}</span></div><p class="mg-q">${q.q}</p><div class="mg-choices">${q.a.map((a, i) => `<button type="button" class="btn sec" data-i="${i}">${a}</button>`).join('')}</div>`;
    root.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => {
      if (+b.dataset.i! !== q.ok) { done(false, `学科で不正解：「${q.q}」の答えは「${q.a[q.ok]}」`); return; }
      qi++;
      if (qi < quiz.length) showQuiz(); else showPart();
    }));
  };
  const showPart = () => {
    const p = parts[pi];
    root.innerHTML = `<div class="mg-head"><b>ふぐ調理師試験</b><span>実技 ${pi + 1}/${parts.length}</span></div><p class="mg-q">トラフグをさばいている。この部位は？</p><div class="mg-part">${p.name}</div><div class="mg-choices two"><button type="button" class="btn pri" data-e="1">食べられる</button><button type="button" class="btn sec" data-e="0">毒がある・捨てる</button></div>`;
    root.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => b.addEventListener('click', () => {
      if ((b.dataset.e === '1') !== p.edible) { done(false, `実技で不合格：「${p.name}」は${p.edible ? '食べられる' : '毒がある'}（${p.note}）`); return; }
      pi++;
      if (pi < parts.length) showPart(); else done(true, '');
    }));
  };
  showQuiz();
}
