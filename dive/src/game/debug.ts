/**
 * テスト用デバッグ機能（実機検証用。完成版では丸ごと削除する。除去手順は dive/RESUME.md の「デバッグ機能の除去手順」）。
 *
 * 方針：セーブ形式は変えない。ここは既存のセーブ項目（money / found / storyMain / rep / day / clock …）へ書き込んで
 * ページを読み直すだけ。ゲーム本体との接点は Game.ts の installDebugPanel() 1 行（マーカー DEBUG-PANEL で囲んである）。
 * 誤操作防止は既存の流儀：ボタン内 2 タップ確認（1 回目で文言が変わり、3.5 秒以内にもう一度押すと実行）。
 * UI は index.html の DEBUG-PANEL ブロック、見た目は styles.css の DEBUG-PANEL ブロック。
 */
import type { Save } from './Game';
import { CHAPTERS } from './story';
import { FISHING, STORY, repLevel } from './fishing';
import { AIR_TANK, SHOP } from './photoScore';
import { CHEST_GEAR } from './chests';
import { DIVE_POINTS } from '../world/layout';
import { SPECIES, ZONE_ORDER } from '../life/species';

export const DEBUG_SAVE_KEY = 'blue-depths-save-v1';

type Host = { save: Save; write: () => void };

/** 図鑑の並び（図鑑画面と同じ：エリア順 → 定義順） */
const DEX_ORDER = [...ZONE_ORDER.flatMap((z) => SPECIES.filter((s) => s.zone === z)), ...SPECIES.filter((s) => !ZONE_ORDER.includes(s.zone))];

/** 時間帯 → その日の経過秒（nightOf / timeLabel と同じ境目） */
const CLOCK = { morning: 0, noon: 240, dusk: FISHING.duskAt, night: FISHING.duskAt + FISHING.duskLen };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const num = (id: string, fallback: number) => {
  const v = Number($<HTMLInputElement>(id)?.value);
  return Number.isFinite(v) ? v : fallback;
};

/** 発見済みの種を、図鑑の並びの先頭から pct% 分にそろえる（足りなければ先頭の未発見から足し、多ければ末尾の発見から消す） */
export function setDexPercent(sv: Save, pct: number): void {
  const want = Math.round((Math.min(100, Math.max(0, pct)) / 100) * DEX_ORDER.length);
  let have = DEX_ORDER.filter((s) => sv.found[s.id]).length;
  if (have < want) {
    for (const s of DEX_ORDER) {
      if (have >= want) break;
      if (!sv.found[s.id]) { sv.found[s.id] = { photo: '', depth: 0, t: Date.now() }; have++; }
    }
  } else if (have > want) {
    for (let i = DEX_ORDER.length - 1; i >= 0 && have > want; i--) {
      if (sv.found[DEX_ORDER[i].id]) { delete sv.found[DEX_ORDER[i].id]; have--; }
    }
  }
}

type Action = { armed: string; run: (sv: Save) => void };

const ACTIONS: Record<string, Action> = {
  // 既存：全部解禁（「最大」）
  'unlock-all': {
    armed: '本当に全解禁する？',
    run: (sv) => {
      sv.owned = [...new Set([...(sv.owned ?? []), ...SHOP.map((g) => g.id), 'fugulicense'])];
      sv.discovered = DIVE_POINTS.map((d) => d.id);
      sv.money = Math.max(sv.money ?? 0, 999999);
      sv.rep = Math.max(sv.rep ?? 0, FISHING.repLevels[FISHING.repLevels.length - 1]);
      sv.story = STORY.length;
      sv.storyMain = CHAPTERS.length;
      sv.storyRead = CHAPTERS.length;
      sv.airLv = AIR_TANK.length - 1;
      sv.tutorial = true;
      sv.boardOn = true;
      sv.dives = Math.max(sv.dives, 1);
    },
  },
  'money-set': { armed: '本当に設定する？', run: (sv) => { sv.money = Math.max(0, Math.round(num('dbg-money', sv.money ?? 0))); } },
  'money-add10k': { armed: '本当に +10,000？', run: (sv) => { sv.money = (sv.money ?? 0) + 10000; } },
  'money-add100k': { armed: '本当に +100,000？', run: (sv) => { sv.money = (sv.money ?? 0) + 100000; } },
  'dex-set': { armed: '本当にこの割合にする？', run: (sv) => setDexPercent(sv, num('dbg-dex', 0)) },
  'chapter-set': {
    armed: '本当にこの章にする？',
    run: (sv) => {
      const n = Math.min(CHAPTERS.length, Math.max(0, Math.round(num('dbg-chapter', 0))));
      sv.storyMain = n;
      sv.storyRead = n >= CHAPTERS.length ? n : n - 1; // 今の章のブリーフィングは未読（通常の進行と同じ）
      sv.storyClaim = [];
      if (n >= 1) { sv.tutorial = true; sv.dives = Math.max(sv.dives, 1); }
      else sv.dives = 0; // 第 1 章の条件は「ダイブ 1 回」。残すとすぐ第 1 章がクリアされ直す
      for (let k = 0; k < n; k++) { const m = CHAPTERS[k].map; if (m && !(sv.discovered ??= ['lagoon']).includes(m)) sv.discovered.push(m); }
    },
  },
  'rep-set': {
    armed: '本当にこの評判にする？',
    run: (sv) => {
      const lv = Math.min(FISHING.repLevels.length, Math.max(1, Math.round(num('dbg-rep', 1))));
      sv.rep = FISHING.repLevels[lv - 1];
      sv.story = Math.min(sv.story ?? 0, lv); // 上げたときは女将さんの話が未読で出る／下げたときは既読を超えない
    },
  },
  'gear-all': {
    armed: '本当に全装備を持つ？',
    run: (sv) => {
      sv.owned = [...new Set([...(sv.owned ?? []), ...SHOP.map((g) => g.id), 'fugulicense', ...Object.keys(CHEST_GEAR)])];
      sv.airLv = AIR_TANK.length - 1;
    },
  },
  'gear-none': { armed: '本当に装備を手放す？', run: (sv) => { sv.owned = []; sv.airLv = 0; } },
  'maps-all': { armed: '本当に全マップを発見済みにする？', run: (sv) => { const ids = DIVE_POINTS.map((d) => d.id); sv.discovered = ids; sv.visited = [...ids]; } },
  'maps-none': { armed: '本当に発見を戻す？', run: (sv) => { sv.discovered = ['lagoon']; sv.visited = ['lagoon']; } },
  'chests-reset': { armed: '本当に宝箱を戻す？', run: (sv) => { sv.chests = []; sv.sceneHints = []; } },
  'scenes-reset': { armed: '本当に光景を戻す？', run: (sv) => { sv.scenes = {}; } },
  'spots-reset': { armed: '本当にスポットを戻す？', run: (sv) => { sv.spots = []; } },
  'day-set': { armed: '本当に日数を変える？', run: (sv) => { sv.day = Math.max(1, Math.round(num('dbg-day', sv.day ?? 1))); } },
  'time-morning': { armed: '本当に朝にする？', run: (sv) => { sv.clock = CLOCK.morning; } },
  'time-noon': { armed: '本当に昼にする？', run: (sv) => { sv.clock = CLOCK.noon; } },
  'time-dusk': { armed: '本当に夕方にする？', run: (sv) => { sv.clock = CLOCK.dusk; } },
  'time-night': { armed: '本当に夜にする？', run: (sv) => { sv.clock = CLOCK.night; } },
};

/** ボタン内 2 タップ確認（Phase 7 と同じ流儀。window.confirm はアーティファクトの iframe で塞がれる） */
function armTap(b: HTMLButtonElement, armedLabel: string, run: () => void): void {
  const label = b.textContent;
  let armed = false;
  let timer = 0;
  b.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      b.textContent = armedLabel;
      timer = window.setTimeout(() => { armed = false; b.textContent = label; }, 3500);
      return;
    }
    window.clearTimeout(timer);
    run();
  });
}

function fill(sv: Save): void {
  const st = $('dbg-state');
  const have = DEX_ORDER.filter((s) => sv.found[s.id]).length;
  if (st) {
    st.textContent = `いま：所持金 ${(sv.money ?? 0).toLocaleString('ja-JP')}　図鑑 ${have}/${DEX_ORDER.length}（${Math.round((have / DEX_ORDER.length) * 100)}%）　章 ${sv.storyMain ?? 0}/${CHAPTERS.length}　評判 Lv${repLevel(sv.rep ?? 0)}（${sv.rep ?? 0}pt）　${sv.day ?? 1}日目・clock ${Math.round(sv.clock ?? 0)}　装備 ${(sv.owned ?? []).length}　マップ ${(sv.discovered ?? []).length}/${DIVE_POINTS.length}　宝箱 ${(sv.chests ?? []).length}　光景 ${Object.keys(sv.scenes ?? {}).length}　スポット ${(sv.spots ?? []).length}`;
  }
  const set = (id: string, v: string | number) => { const e = $<HTMLInputElement>(id); if (e) e.value = String(v); };
  set('dbg-money', sv.money ?? 0);
  set('dbg-dex', Math.round((have / DEX_ORDER.length) * 100));
  set('dbg-day', sv.day ?? 1);
  const ch = $<HTMLSelectElement>('dbg-chapter');
  if (ch) {
    ch.innerHTML = ['0 章（はじめから）', ...CHAPTERS.map((c, i) => `${i + 1} 章までクリア（${c.title}）`)].map((t, i) => `<option value="${i}">${t}</option>`).join('');
    ch.value = String(Math.min(sv.storyMain ?? 0, CHAPTERS.length));
  }
  const rp = $<HTMLSelectElement>('dbg-rep');
  if (rp) {
    rp.innerHTML = FISHING.repLevels.map((t, i) => `<option value="${i + 1}">Lv${i + 1}（${t}pt〜）</option>`).join('');
    rp.value = String(repLevel(sv.rep ?? 0));
  }
}

/** デバッグ用ボタンをつなぐ（Game のコンストラクタから 1 回だけ呼ぶ）。実行後はセーブを書いてページを読み直す。 */
export function installDebugPanel(host: Host): void {
  const reset = $<HTMLButtonElement>('reset-save');
  if (reset) {
    armTap(reset, '本当にリセットする？', () => {
      try { localStorage.removeItem(DEBUG_SAVE_KEY); } catch { /* storage unavailable */ }
      window.location.reload();
    });
  }
  const unlock = $<HTMLButtonElement>('unlock-all');
  if (unlock) {
    armTap(unlock, ACTIONS['unlock-all'].armed, () => { ACTIONS['unlock-all'].run(host.save); applyAndReload(host); });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-dbg]').forEach((b) => {
    const a = ACTIONS[b.dataset.dbg ?? ''];
    if (a) armTap(b, a.armed, () => { a.run(host.save); applyAndReload(host); });
  });
  fill(host.save);
}

function applyAndReload(host: Host): void {
  host.write();
  window.location.reload();
}
