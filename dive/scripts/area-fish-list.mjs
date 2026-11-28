// エリア（ゾーン）ごとの魚リストを生成する: node scripts/area-fish-list.mjs  (dive/ で実行。先に npm install)
// 種定義 (src/life/species*.ts) を rolldown で束ね、node で読み込んで集計し docs/AREA-FISH-LIST.md を書く。
// ゲーム本体は変更しない。出現確率・夜の係数は creatures.ts のソースから読み取り（転記しない）。
import { build } from 'rolldown';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(join(tmpdir(), 'area-fish-'));
try {
  // --- 1. 種定義と地形のゾーン名を束ねて読み込む（species.ts の集約・バランス調整・MAP_MOVES 適用後の最終状態）
  const entry = join(tmp, 'entry.ts');
  const p = (f) => JSON.stringify(join(root, f));
  await writeFile(entry, `export { SPECIES, ZONE_ORDER } from ${p('src/life/species.ts')};\nexport { ZONE_NAMES } from ${p('src/world/layout.ts')};\n`);
  await build({ input: entry, output: { file: join(tmp, 'bundle.mjs'), format: 'esm' }, platform: 'node', logLevel: 'silent' });
  const { SPECIES, ZONE_ORDER, ZONE_NAMES } = await import(pathToFileURL(join(tmp, 'bundle.mjs')).href);

  // --- 2. 出現確率の定数を creatures.ts から読み取る
  const cre = await readFile(join(root, 'src/life/creatures.ts'), 'utf8');
  const pm = cre.match(/const base = def\.rarity >= 4 \? ([\d.]+) : def\.rarity === 3 \? ([\d.]+) : def\.rarity === 2 \? ([\d.]+) : ([\d.]+);/);
  const nm = cre.match(/dayPresence: ([\d.]+)/);
  if (!pm || !nm) throw new Error('creatures.ts の presence / NIGHT.dayPresence が読み取れない（書式が変わった？）');
  const PRES = { 4: +pm[1], 3: +pm[2], 2: +pm[3], 1: +pm[4] };
  const DAY_AT_NIGHT = +nm[1];

  // --- 3. 魚類の判定: kind が fish / ray / gardenEel のうち、哺乳類・爬虫類・鳥類を属名で除外
  const NOT_FISH_GENERA = {
    Tursiops: '哺乳類', Stenella: '哺乳類', Grampus: '哺乳類', Orcinus: '哺乳類', Megaptera: '哺乳類', Balaenoptera: '哺乳類', Physeter: '哺乳類',
    Dugong: '哺乳類', Eumetopias: '哺乳類', Zalophus: '哺乳類', Callorhinus: '哺乳類', Phoca: '哺乳類', Enhydra: '哺乳類',
    Laticauda: '爬虫類', Aptenodytes: '鳥類', Eudyptes: '鳥類',
  };
  const FISH_KINDS = new Set(['fish', 'ray', 'gardenEel']);
  const excluded = [];
  const fish = [];
  for (const s of SPECIES) {
    if (!FISH_KINDS.has(s.kind)) continue;
    const g = s.sci.split(' ')[0];
    if (NOT_FISH_GENERA[g]) excluded.push(s); else fish.push(s);
  }
  const unused = Object.keys(NOT_FISH_GENERA).filter((g) => !excluded.some((s) => s.sci.startsWith(g + ' ')));
  if (unused.length) throw new Error('除外リストに該当種がない属: ' + unused.join(','));

  // --- 4. 期待個体数（1 ダイブあたり）
  // 群れ（groups）は rarity に応じた確率 presence で出現し、個体は群れに均等配分 (i % groups) される。
  // よって 期待個体数 = count × presence。夜は昼の種に NIGHT.dayPresence を掛ける（when:'night' の種は昼 0、aggro:'light' は夜 1）。
  // 天候補正（weatherMult）は日替わりなので 1 として扱う。
  const expDay = (s) => (s.when === 'night' ? 0 : s.count * PRES[s.rarity]);
  const expNight = (s) => (s.when === 'night' ? s.count * PRES[s.rarity] : s.aggro?.kind === 'light' ? s.count : s.count * PRES[s.rarity] * DAY_AT_NIGHT);
  const timeOf = (s) => (s.when === 'night' ? '夜のみ' : s.aggro?.kind === 'light' ? '昼夜（夜は光に集まる）' : '昼夜（夜は減る）');
  const regionOf = (s) => (typeof s.region === 'string' ? s.region : `矩形[${s.region.join(',')}]`);
  const RARITY = { 1: '★1 普通', 2: '★2', 3: '★3 稀', 4: '★4 伝説' };
  const pct = (v, t) => (t > 0 ? (v / t * 100).toFixed(1) + '%' : '-');

  const out = [];
  out.push('# エリア別 魚リスト（BLUE DEPTHS）', '');
  out.push('> このファイルは `node scripts/area-fish-list.mjs`（dive/ で実行）で自動生成される。手で編集しない。', '');
  out.push('## 読み方（出現率の定義）', '');
  out.push('- **対象は魚（魚類）のみ**。カニ・エビ・貝・ウニ・ナマコ・ウミウシ・イカ・タコ・クラゲ・ウミガメ・ホヤなど魚以外は対象外。');
  out.push(`  種定義の \`kind\` が \`fish\` / \`ray\` / \`gardenEel\` のものから、哺乳類・爬虫類・鳥類（クジラ・イルカ・アシカ・アザラシ・ラッコ・ジュゴン・ウミヘビ・ペンギン。${excluded.length} 種）を除いた **${fish.length} 種**。`);
  out.push('- **エリア**は種定義の `zone`（図鑑の `ZONE_ORDER` 順）。`species.ts` の `MAP_MOVES` による移動（遺跡・ブルーホール・洞窟・河口）と `balanceZones()`（浅場などの個体数補正）を適用した最終値。');
  out.push('- **個体数 / 群れ数**は種定義の `count` / `groups`。**レア度**は `rarity`（1 普通〜3 稀、4 伝説）。');
  out.push(`- **群れの出現確率**（\`creatures.ts\` の \`presence\`）はレア度で決まる: ★1=${PRES[1]}、★2=${PRES[2]}、★3=${PRES[3]}、★4=${PRES[4]}（群れ単位で潜るたびに抽選）。`);
  out.push('- **期待個体数** = 個体数 × 群れの出現確率（群れに個体が均等配分されるため）。**出現率（昼）** = その魚の期待個体数 ÷ エリア内の全魚の期待個体数の合計。');
  out.push(`- **出現率（夜）**はナイトダイブ時。昼の魚は ×${DAY_AT_NIGHT}（\`NIGHT.dayPresence\`）、夜専用（\`when:'night'\`）は夜のみ出現、光に反応する攻撃的な個体（\`aggro:'light'\`）は夜は確率 1。`);
  out.push('- 天候補正（日替わり 0.75〜1.35 倍）は 1 として扱う。★1 の種は全群れが不在でも 1 群れは必ず出る補正があるが、ここでは無視した。');
  out.push('- 群れの置き場所（生息点 `region`）は文字列（`reefSpots` など）か矩形 `[x0,x1,z0,z1]`。実際の出現位置は `flora.ts` の Homes から選ばれるので、割合は出さず元の値のまま載せた。深度は種定義の `depth`（m）。', '');

  out.push('## エリア別の概要', '');
  out.push('| エリア | 魚の種数 | 個体数の合計 | 期待個体数（昼） | 期待個体数（夜） |', '| --- | ---: | ---: | ---: | ---: |');
  const byZone = new Map(ZONE_ORDER.map((z) => [z, []]));
  for (const s of fish) {
    if (!byZone.has(s.zone)) throw new Error('未知のゾーン ' + s.zone);
    byZone.get(s.zone).push(s);
  }
  for (const z of ZONE_ORDER) {
    const l = byZone.get(z);
    out.push(`| ${ZONE_NAMES[z]}（\`${z}\`） | ${l.length} | ${l.reduce((a, s) => a + s.count, 0)} | ${l.reduce((a, s) => a + expDay(s), 0).toFixed(1)} | ${l.reduce((a, s) => a + expNight(s), 0).toFixed(1)} |`);
  }
  out.push('');
  for (const z of ZONE_ORDER) {
    const l = byZone.get(z).slice().sort((a, b) => expDay(b) - expDay(a) || expNight(b) - expNight(a) || a.name.localeCompare(b.name, 'ja'));
    const td = l.reduce((a, s) => a + expDay(s), 0), tn = l.reduce((a, s) => a + expNight(s), 0);
    out.push(`## ${ZONE_NAMES[z]}（\`${z}\`）— 魚 ${l.length} 種`, '');
    if (!l.length) { out.push('このエリアに定義された魚はいない。', ''); continue; }
    out.push('| 魚の名前 | 出現率（昼） | 出現率（夜） | 出現時間帯 | レア度 | 個体数 | 群れ数 | 深度(m) | 生息点 |', '| --- | ---: | ---: | --- | --- | ---: | ---: | --- | --- |');
    for (const s of l)
      out.push(`| ${s.name} | ${pct(expDay(s), td)} | ${pct(expNight(s), tn)} | ${timeOf(s)} | ${RARITY[s.rarity]} | ${s.count} | ${s.groups} | ${s.depth[0]}〜${s.depth[1]} | \`${regionOf(s)}\` |`);
    out.push('');
  }
  // 修正バッチ2 F11 (32)：天気限定の種（魚以外も含む。上の出現率の表は天気を考えていない）
  const WN = { sunny: '晴れ', cloudy: '曇り', rain: '雨', storm: '荒天' };
  const wo = SPECIES.filter((s) => s.weather);
  out.push(`## 天気限定の種（${wo.length} 種）`, '');
  out.push('`SpeciesDef.weather` を持つ種は、その天気の日だけ現れる（ほかの天気では出現 0）。★2 以下だけで、章・撮影依頼・標識の依頼・食堂の注文の対象にならない。雨と荒天は `weatherOf` が 7 日以内に必ず 1 回来るようにしてある（曇りは約 30% で、まず途切れない）。上の各エリアの表の出現率は天気を考えていない（その天気の日の出現率として読む）。', '');
  out.push('| 魚・生き物 | 天気 | エリア | レア度 | 個体数 | 群れ数 | 深度(m) |', '| --- | --- | --- | --- | ---: | ---: | --- |');
  for (const s of wo) out.push(`| ${s.name} | ${s.weather.map((w) => WN[w]).join('・')} | ${ZONE_NAMES[s.zone]} | ${RARITY[s.rarity]} | ${s.count} | ${s.groups} | ${s.depth[0]}〜${s.depth[1]} |`);
  out.push('');
  out.push('## 対象外にした種（魚類以外で kind が fish / ray の種定義）', '');
  out.push(excluded.map((s) => `${s.name}（${NOT_FISH_GENERA[s.sci.split(' ')[0]]}）`).join('、'), '');
  await writeFile(join(root, 'docs/AREA-FISH-LIST.md'), out.join('\n'));
  console.log(`魚 ${fish.length} 種 / 除外 ${excluded.length} 種 → docs/AREA-FISH-LIST.md`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
