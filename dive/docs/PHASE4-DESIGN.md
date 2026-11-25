# Phase 4 設計：魚のAI・生態・撮影・行動イベント

作成: 2026-11-25（作業ブランチ `claude/focused-lamport-zo5rwl`）。実装は Muse 側で行う（§9 が実装手順）。
依頼の正は `dive/IMPROVEMENT_TRACKER.md` の Phase 4。この文書は「どこをどう変えるか」の決定の正。迷った点は §8「確認が必要な点」に残し、仮の決定で進める。

調整値はすべて定数オブジェクトにまとめる（`SPREAD` / `CURIOUS` / `BAIT` / `OCTO` / `WEATHER`、§各節）。セーブキーは `blue-depths-save-v1` のまま、追加フィールドはすべて省略可（無い＝旧動作）なので移行は不要。

---

## 0. 現状調査（ベースライン）

計測：`dist/artifact.html` を Playwright（swiftshader）で開き、`setState('reef')` の6秒後、ダイバーから半径40m内を数えた（スクリプトは実装時に `dive/scripts/probe-phase4.cjs` として残す）。

| 指標 | 値 |
| --- | --- |
| 40m内の目に見えるサンゴ群体（半径0.5〜6m） | 414 |
| そのうち 半径+2m 以内に魚が1匹もいないサンゴ | **239（58%）** |
| 5m四方のマスで魚・生き物が4種類以上いるマス | **19 / 99** |
| 1マスの最大種数 | **11種** |

ゾーン別の種数（`SPECIES`、613種）：サンゴ礁 231、岩礁 100、ラグーン 60、深海 52、沖 49、寒冷 49、ドロップオフ 35、ケルプ 23、ブルーホール 6、洞窟 5、遺跡 3。

原因として確認したこと：

1. **魚のいないサンゴ**：魚の生息点（`Homes.coralTops`／`reefSpots` 各180、`underTables` 140）は「濃いサンゴの頭」と「テーブルサンゴ」だけ。画面に並ぶ脳サンゴ 420・枝サンゴ 600・ハナヤサイサンゴ 900 などには生息点が無い。さらに coralTops に住む種は「群れ数が少なく1群れが大きい」（例：デバスズメダイ 200匹/16群れ＝1か所に12匹）。
2. **一箇所に集まりすぎ**：生息点の割り振り（`pickSpread`）は「同じ点の重複」だけを避けていて、**近くの別の点**に何種でも重なる。範囲指定（box）の種はランダム座標で、混み具合を見ていない。
3. **近寄ると一箇所に固まる**：
   - `coralHover`／`under` の魚は、ダイバーが近いと「隠れる」動作で目標が `g.home + a.off × 0.15` になり、群れ全員が**同じ1点**（サンゴの頭）に吸い込まれる。
   - 逃げる方向 `fleeDir` は「今進んでいる側の接線」で、群れの全員・近くの別種まで同じ側へ流れ、ダイバーの横の一点に寄る。警戒中（watch）の個体は `acc -= 0.35 × 目標` で群れに戻らず、ダイバーの周りにたまる。
4. **居場所が決まっている魚が逃げすぎる**：群れ単位の逃走（`g.v += fleeDir`）にホームへの戻りが無く、`reefRoam`／`wall`／`coralPick` などは数十m流される。
5. **イルカが回り続ける**：`curious` の種は、ダイバーが32m以内にいる間ずっと `g.t = player + 円周(time)` で**時間制限なし**に周回する（イルカ・ウミガメ・アザラシ・シャチなど16種）。
6. **見えない魚に「???」**：`findTarget` は60m以内・写真枠内なら、霞んで見えない（`murky`）・真っ暗（`dark`）・岩の向こう（`hidden`）でも候補にし、ラベルに「？？？」を出す。遮蔽判定は**地形の高さだけ**で、岩・サンゴ・沈没船（当たり判定 `colliders`）は見ていない。また中心点が枠内なら体のほとんどが枠外でも反応する。
7. タコは `static`（岩の上）で、近づくと逃げる（flee 2〜2.5m）だけ。
8. 天候の仕組みは無い。女将さんの一言は `Kitchen.say(ev)`（`back`／`morning`／`toNight`、島の話 `LORE` を1回に1つ）。

---

## 1. 魚の分布・群れ・逃走

### 1.1 魚のいないサンゴを減らす（トラッカー：サンゴの周りに魚）

- `flora.ts`：脳サンゴ・枝サンゴ（一般）・テーブル・ハナヤサイ（大きめのもの、半径 0.6m 以上）の位置と頂上の高さを、新しい生息点 **`Homes.coralAll`** に登録する（既存の `coralTops` などはそのまま）。
- サンゴ住まいの種（`hab` が `coralHover`／`coralPick`／`under`／`cleaner` で、`region` が `coralTops`／`bommieSpots`）は、**個体数（count）はそのままで群れ数（groups）を増やす**：`groups = max(groups, ceil(count / SPREAD.coralGroupSize))`（`coralGroupSize = 4`）。
  - 例：デバスズメダイ 200匹/16群れ → 50群れ（1か所4匹）。
  - 個体数・メッシュ・ドローコールは増えない（増えるのは群れの中心の計算だけ）。
- 増やした群れの生息点は `coralTops`＋`coralAll` から選ぶ（`coralTops` 種のみ）。`underTables`（テーブルの下、140か所しかない）の種は群れ数を増やさない（実装時の計測で、増やすとテーブルの下が混みすぎた）。
- 目標：上の指標で「魚のいないサンゴ」を **30%以下**。

### 1.2 一箇所に集まりすぎない・集まるなら2〜3種まで

- **混み具合の地図** `spotMix`（5m四方のマス → そのマスに住む「泳ぐ生き物」（fish／ray／squid／turtle）の種の集合）を `Creatures` に持たせる。ダイブ開始（`reshuffle`）で作り直し、`relocate`／`pickHome` で生息点を決めるたびに登録・解除する。
- `pickSpread` は候補を選ぶとき、**そのマスにすでに `SPREAD.maxSpecies`（3）種いる点を避ける**（同じ種なら可）。候補が全部埋まっていたら一番すいている点。box（範囲指定）の種の `relocate` も同じ判定で座標を引き直す（最大30回）。
- 移動する群れ（`reefRoam`／`midwater`／回遊）は動くので完全には保証できない。生息点の決め方で偏りを無くすところまでとし、指標（4種以上のマス）の**半減以下**を目標にする。
- 底生の無脊椎（ウニ・ヒトデ・貝など、kind `inv`／`nudi` など）は「魚の種類」に数えない。

### 1.3 近寄ると一箇所に固まる問題

- 隠れる動作：目標を `g.home + a.off × 0.15` → **`g.home + a.off × SPREAD.hideSpread(0.7)`**（個体ごとの位置を保ったままサンゴの表面へ寄る）。y は従来どおり。
- 逃げ方向：`fleeDir` の接線の向きを「進んでいる側」だけで決めず、**個体ごとに固定の左右（`a.ph` の符号）**を混ぜる（群れの半分ずつが左右に分かれて、ダイバーの横の一点に集まらない）。
- 警戒中（watch）の「群れに戻らない」力 `-0.35` を **`-0.15`** に弱め、ダイバーから `watchR` を超えたら群れの位置に戻る。

### 1.4 居場所が決まっている魚は逃げすぎない

- 「居場所が決まっている魚」＝ `hab` がある種（`coralHover`／`coralPick`／`under`／`cleaner`／`wall`／`reefRoam`／`rockyRoam`／`sandForage`／`seagrass`）と `region` が生息点リスト（`coralTops`／`rockSpots`／`wallSpots` など）の種。回遊（`pelagic`）・漂う（`drift`）・box で広く泳ぐ種は対象外。
- **つなぎ（leash）**：群れの中心がホームから `SPREAD.leash = 4 + size × 3` m を超えたら、逃走より戻る力を優先（逃走の力を 0 に、ホームへの速度を加える）。
- 逃げ始める距離をこの種に限って `× SPREAD.residentFlee(0.75)`。

### 1.5 サンゴ礁の種類の偏りを、他の環境の魚を増やして均す

- サンゴ礁の種は減らさない。**他の環境の魚の個体数と群れ数を増やす**（`species.ts` の集約で、`ZONE_BOOST` を掛ける後処理 `balanceZones()`）：

  | ゾーン | 個体数 × | 群れ数 × |
  | --- | --- | --- |
  | ラグーン | 1.5 | 1.5 |
  | ケルプの森 | 1.5 | 1.5 |
  | 岩礁 | 1.3 | 1.3 |
  | 寒冷の入り江 | 1.3 | 1.3 |
  | ドロップオフ | 1.2 | 1.2 |
  | 遺跡・ブルーホール・洞窟・沖・深海 | 1.0（据え置き） | 1.0 |

  対象は kind `fish` で `rarity ≤ 2`、`behavior` が `school`／`solo`／`bottom`（固定配置・巣穴・イソギンチャク・岩の割れ目・伝説種は除く）。
- 描画負荷：増える個体は全体 7,732 のうち約 +700（+9%）。描画は近くの個体だけ・種ごと1ドローコール（`maxDrawn = 70` の上限も既存）で、**ドローコールとポリゴンの種類は増えない**。増えるのは近くの個体のインスタンス行列だけ。Phase 8 の LOD はメッシュ側の話なので前提を崩さない。
- 実装後に 縦 390×844 の swiftshader で reef・lagoon・rocky のフレーム時間を前後比較し、悪化が大きければ倍率を下げる。
- 海底遺跡・ブルーホール・洞窟は「種類が多少少なくてよい」ので据え置き（増やさない・減らさない）。
- 新しい**種**を他の環境に足すのは Phase 12（生物追加）で行う（§8-Q）。

---

## 2. イルカ（好奇心のある種）

定数 `CURIOUS = { startR: 25, follow: 30, leaveR: 45, cooldown: 120, side: 5 }`（`creatures.ts`）。

- 状態を群れごとに持つ：`g.cur`：0＝気にしていない、1＝ついてくる（残り秒 `g.curT`）、2＝離れていく（クールダウン）。
- **ついてくる条件**：状態 0 で、ダイバーとの距離 < `startR`（25m）かつクールダウンが終わっている。
- **ついてくる間**：ダイバーの**横**（進行方向に対して右か左、群れごとに固定）`side + size` m・やや前・やや下の点を目標にする。周回の角度 `time × 0.2` は使わない（＝ぐるぐる回らない）。ダイバーが止まっていれば、その点の付近をゆっくり行き来する。
- **離れる条件**（どれか）：①ついてきてから `follow`（30秒）、②ダイバーとの距離 > `leaveR`（45m、置いていかれた）、③ダイバーが ADS（深海）に入った。
- **離れるとき**：ダイバーから外向きに 60m 先の点を目標にして泳ぎ去り、`cooldown`（120秒）は再び寄ってこない。その後は普段どおり回遊。
- 対象：`curious: true` の全種（イルカ・ウミガメ・アザラシ・シャチ・クジラなど16種。周回の不具合は全種共通のため）。時間はトラッカーの「イルカは30秒くらい」に合わせて全種 30 秒（種ごとに変える必要があれば定数を分ける）。
- ウミガメ救出の連れ（`companion`）は別の仕組みなので変えない。

---

## 3. 餌・魚の誘引

新ファイル `src/game/bait.ts`（餌の定義・食べる魚の判定）＋ `creatures.ts` に誘引の処理。

### 3.1 餌の種類と対応表

| id | 名前 | 価格（3回分） | 寄ってくる魚（`dietOf(def)`） |
| --- | --- | --- | --- |
| `krill` | オキアミ | ¥300 | プランクトンを食べる小魚：スズメダイ・ハナダイ・ハナゴイ・キンギョハナダイ・タカサゴ・イワシ・アジの仲間など（名前の語、なければ「群れで泳ぐ 0.15m 未満の魚」） |
| `chunk` | 魚の切り身 | ¥500 | 肉食の魚：ハタ・フエダイ・ベラ・カサゴ・メバル・ソイ・タイ・イサキ・フグ・カワハギ・モンガラ・カマスなど（名前の語、なければ「0.15m 以上の単独・底の魚」） |
| `weed` | 海藻だんご | ¥300 | 海藻を食べる魚：ハギ・ブダイ・アイゴ・メジナ・ニザダイ・イスズミ・ハコフグ・オヤビッチャなど（名前の語） |

- 判定は `bait.ts` の `DIET_WORDS`（名前に含まれる語 → 食性）と、上の大きさ・行動の決まりで決める（種データに食性の欄は無いので、Phase 12 で種を足すときは語の表に追記する）。
- サメ（`aggro.kind === 'shark'`）・攻撃的な個体・固定配置・巣穴・イソギンチャク・洞窟の割れ目の魚・伝説種（rarity 4）は寄ってこない。切り身で寄るサメは作らない（銛の血 `bloodIn` と混ざるため）。
- 価格の根拠：Phase 2 の写真報酬（1/7）で、ふつうの写真1枚 ¥100〜¥400・依頼 ¥500〜。1回分 ¥100〜¥170 なら「1回まけば1〜2枚の未撮影種が狙える」程度（**仮置き、§8-R**）。

### 3.2 買い方（食堂）

- しおさい亭に「釣具の棚：餌」を追加（`#k-work` の下に `#k-bait`）。手銛の前（宿だけの状態）でも表示する。各餌に「買う（3回分）」ボタンと手持ち数。
- 所持は `LandSave.bait?: { krill?: number; chunk?: number; weed?: number }`（無い＝0）。
- 解禁：食堂が開いた時点（チュートリアル後）から。

### 3.3 海中で使う

- 手持ちがあるとき（チュートリアル後・ADS 以外）、HUD に**餌ボタン**（`#btn-bait`、銛の持ち替えボタンの上）を出す。**タップでまく**。ボタン下に「オキアミ×3」のように種類と残り回数。2種類以上持っているときだけ、その上に小さな切替ボタン（`#btn-bait-kind`、34px）を出し、タップで手持ちの種類を順に切り替える（長押し操作は使わない）。
- まくと、目の前 1.5m に餌の雲（小さな粒の `Points`、40秒で消える）。手持ちを1減らしてセーブ。
- **誘引**：餌の点から `BAIT.radius`（15m）以内の、その餌を食べる種の個体を選ぶ。
  - 上限：**`BAIT.maxFish`（10匹）・`BAIT.maxSpecies`（3種）**（「寄ってくる魚が多すぎない」＋ §1.2 の「集まるなら2〜3種」）。近い個体から。
  - 寄った個体は餌の点のまわり 0.4〜1.2m を小さく回り、ダイバーへの警戒距離を `× 0.3`（餌に夢中）。2秒ごとに枠が空いていれば補充。
  - 餌が消えたら群れに戻る。
- 1ダイブにまける回数は手持ち次第。同時に雲は1つ（新しくまくと古い雲は消える）。

---

## 4. カメラ・撮影判定（見えない魚に反応しない）

`Creatures.findTarget` を次のように変える。「候補にしない」＝ラベルも「？？？」も出ない。

1. **霞んで見えない距離は候補にしない**：`dist > clear × PHOTO_VIS.fogCut(1.3)` は除外（FogExp2 で残る見え方が約3割を切る距離）。`clear`〜`1.3 clear` は従来どおり「濁って霞んでいる・近づく」。
2. **暗くて見えないものは候補にしない**：暗い場所で、ライトの光の中でも光る種の 9m 以内でもないものは除外。ただし 4m 以内は影が見えるので従来の「暗くて写らない・ライトで照らす」を残す。
3. **さえぎられているものは候補にしない**：遮蔽判定 `occluded` を、地形の高さに加えて**当たり判定（岩・サンゴの頭・沈没船・遺跡の柱）**でも見る（`colliders.ts` に線分判定 `segmentBlocked(from, to)` を追加：線上を 0.5m 刻みで `insideAny`）。体の頭・中央・尾の3点を調べ、**3点とも隠れていれば除外**、一部なら「岩陰で一部が隠れている」（`hidden`）。
4. **写真の枠に体が映っているものだけ**：中心点が枠内でも、体の輪郭の点（既存の 7 点サンプル `fit`）が **`PHOTO_VIS.minFit(0.4)` 未満**なら除外。
5. 重い遮蔽判定は、ほかの条件を通った候補を点数順に並べ、上から最大8体だけ調べる（1フレームの負荷を抑える）。
- 銛の狙い（`findSpearTarget`）も同じ遮蔽判定（当たり判定込み）を使う。
- 依頼の「撮影」判定（`aim()`）は `inRange` の候補だけなので、自動的に同じ基準になる。

---

## 5. タコ（絡まれる）

定数 `OCTO`（`creatures.ts`）。

- 対象：kind `octopus` で `size ≥ 0.3` の種（マダコ・ワモンダコ・ミズダコ・ミミックオクトパス・species11 の `octo` 型）。ヒョウモンダコ（0.12m）とメンダコ（`dumbo`）は対象外。
- 逃げ方の変更：タコは**速く近づいたとき（ダイバーの速さ > 0.9m/s）だけ**逃げる。ゆっくり近づくと逃げずにその場にいる（撮影もできる）。
- **絡まれる**：タコから `OCTO.grabR = 0.5 + size × 0.8` m 以内に `OCTO.dwell`（1.0秒）とどまると、腕で絡まれる。その手前（`grabR × 2`）に入ったら一度だけ「タコの腕がこちらに伸びてきた…近づきすぎ注意」のトースト。
- **絡まれている間**：
  - 最初に **−3bar**、以後 **−1.5bar/秒**（ミズダコなど size ≥ 1 は ×1.5）。
  - 泳ぐ速さ ×0.25、画面を軽く揺らし、照準ラベルに「タコに絡まれた！ シャッター連打で振りほどく（あと◯回）」。
  - **抜け出し方**：シャッターを `OCTO.taps`（6回、size ≥ 1 は 9回）押す。または `OCTO.maxHold`（6秒）で自然に離す。
  - 離すとタコは墨を吐いて 3m ほど逃げ（既存の `alarm` の逃げ）、`OCTO.cooldown`（20秒）は同じタコに絡まれない。
- **既存の仕様との整合**：一撃の被害は オキザヨリ −8bar、ガンガゼ −10、ラッパウニ −14。タコは「最初 −3 ＋ 連打が遅いほど増える」で、すぐ抜ければ約 −4〜5bar、放っておくと最大 −3 + 1.5×6 = **−12bar**（ミズダコ −16.5）。単発の最悪（−14）と同じくらいに収める。エアは既存と同じく 1bar 未満にはならない（`Math.max(1, …)`）。
- 描画：新しいモデルは作らない（タコの体をダイバーの正面下へ寄せ、腕の揺れを強める）。

---

## 6. 天候と出現

新ファイル `src/game/weather.ts`。

### 6.1 その日の天候

- 4種類：`sunny` 晴れ・`cloudy` 曇り・`rain` 雨・`storm` 荒天。
- その日の天候は **日数から決める**（`weatherOf(day)`：日数のハッシュで、晴れ 40%・曇り 30%・雨 20%・荒天 10%）。**1日目は晴れ固定**（チュートリアル）。2日続けて荒天にはしない。
- セーブの追加は不要（`day` から毎回同じ天候が出る。やり直しで天候を引き直せない）。

### 6.2 出現への影響（極端にしない）

- 出現率（`presence(rarity)`）に掛ける倍率 `WEATHER.mult(def, w)` を、種の性質から決める。**範囲は 0.75〜1.35**、出現率の上限は 0.95。**どの天候でも出現率が 0 になる種は作らない**（＝天候限定の種は無い）。

  | 天候 | 増える（×1.25〜1.35） | 減る（×0.75〜0.85） |
  | --- | --- | --- |
  | 晴れ | 水面・浅場（`hab: surface`、深さの上限 < 5m）の魚、ウミガメ | 深場から上がってくる大物 |
  | 曇り | 回遊魚・大物（`pelagic`、size ≥ 1）、ドロップオフの群れ | 水面の魚 |
  | 雨 | ボラ・ボラの仲間、ラグーン・砂地の魚、夜行性の種（夜ダイブ時） | 水面の魚（オキザヨリなど） |
  | 荒天 | 深場・ドロップオフ・沖の大物、サメ（`aggro.kind === 'shark'`） | 水面・浅場の魚、ラグーンの小魚 |

- rarity 1 の種は今まで通り「最低1群れは出る」。
- 図鑑・依頼への影響の確認：天候は日数ごとに変わり、どの種も全天候で出る（最低でも普段の 0.75 倍）ので、図鑑・編集長の章・掲示板の依頼が止まることはない。依頼の撮影対象は「近くにいる種」から選ぶ（`randomNear`）ので天候の影響を受けない。
- 見た目：曇り・雨・荒天で水中の光を少し暗く（日光 ×0.9／0.8／0.7）、霧（`fog.density`）を少し濃く（×1.05／1.1／1.2）。写真の「はっきり写る距離」もこれに合わせて少し短くなる（荒天で約 −17%）。海況（波・流れ）の表現は Phase 5/10 に回す。

### 6.3 女将さんのアナウンス

- **朝（`ev === 'morning'`）**の一言を天候の一言にする（島の話 `LORE` は次の来店へ回す）。依頼掲示板の紹介の日は「天候の一言＋掲示板の紹介」をつなげる。
  - 例：晴れ「おはよう。今日はいい天気だよ。浅いところの魚がよく見えるってさ」、曇り「おはよう。今日は曇りだね。こういう日は沖の大きいのが寄ってくるって漁師が言ってたよ」、雨「おはよう。今日は大雨だよ。ボラが浅場に寄ってくる日さ。濡れるのは潜れば同じだけどね」、荒天「おはよう。今日は海が荒れてるよ。深い所の大物は元気だけど、無理はしないでおくれ」。
- 朝以外に来店したときも、店の状態行（`#k-status`）に「天気：☂ 雨」を出す。
- ボート画面の日付・時刻の表示（あれば）にも天気のアイコンを足す（女将さんに会わずに潜る人向けの補助）。
- Phase 1 の仕組み（`okami.ev`、1回に1つ）を崩さない：天候は `morning` の時だけ優先し、`back` などは従来どおり。

---

## 7. 実装の割り当てと検証

| 変更 | ファイル |
| --- | --- |
| サンゴの生息点 `coralAll` | `src/world/flora.ts` |
| 群れ数・ゾーンの倍率 `balanceZones` | `src/life/species.ts` |
| 分散 `SPREAD`・好奇心 `CURIOUS`・誘引・タコ `OCTO`・撮影判定・天候の倍率を受け取る `weatherMult` | `src/life/creatures.ts` |
| 線分の遮蔽判定 `segmentBlocked` | `src/world/colliders.ts` |
| 餌 `BAIT`・食性 `dietOf` | `src/game/bait.ts`（新規） |
| 天候 `WEATHER`・`weatherOf` | `src/game/weather.ts`（新規） |
| 食堂の餌の棚・天候のアナウンス | `src/game/kitchen.ts`、`index.html` |
| 餌ボタン・タコの絡み・天候の反映・テストフック | `src/game/Game.ts`、`index.html` |

テストフック（`__THREE_GAME_TEST_HOOKS__`）に追加：`spreadStats()`（§0 の指標）、`curiousState(id)`、`dropBait(kind)`／`baitStats()`、`octoGrab()`（絡まれ状態）、`setWeather(w)`／`weather()`、`targetInfo()`。

確認（Playwright、`dive/scripts/probe-phase4.cjs`）：
- 群れの分散：§0 の指標（魚のいないサンゴ 30%以下、4種以上のマス 半減）。ダイバーが近づいたときに 1.5m 以内に集まる個体数が前より減る。
- イルカ：近づいて30秒前後でついてくる状態が終わり、離れていく（周回が続かない）。
- 餌：まいた後 10匹以下・3種以下が寄り、餌の種類で寄る種が変わる。
- 撮影判定：岩の向こう・霞の向こう・暗闇の魚で target が null。
- タコ：近づいてとどまると絡まれ、エアが減り、連打で抜ける。
- 天候：天候ごとに出現の倍率が変わり、朝の女将さんの一言が天候になる。

---

## 8. 確認が必要な点（仮の決定で進める）

- **Q**：「サンゴ礁の魚の種類が多すぎるため、他の環境の魚を増やして」は、Phase 4 では**他の環境の既存種の個体数・群れ数を増やす**こととした（§1.5）。他の環境に**新しい種**を足す意味なら Phase 12 で行う（種の追加は Phase 12 の重複確認の手順に乗せるため）。
- **R**：餌の価格（オキアミ・海藻だんご ¥300、切り身 ¥500、各3回分）・上限（10匹・3種）・効果時間（40秒）は仮。Phase 11 の経済確認で見直す。
- **S**：餌の食性は種データに欄が無いため、名前の語と大きさ・行動で決めた（§3.1）。図鑑に「好きな餌」を出すかは Phase 7。
- **T**：好奇心のある種の「ついてくる30秒」は、イルカだけでなくウミガメ・アザラシ・クジラなど全16種に同じ値を使った。
- **U**：タコの被害（最初 −3bar、−1.5bar/秒、最大6秒、シャッター6回で抜ける）は仮。
- **V**：天候は日数から決め、やり直しで引き直せない。天候の割合（晴40・曇30・雨20・荒10）と倍率（0.75〜1.35）は仮。荒天でも潜れる（潜れなくする案は採らない：ゲームが止まるため）。
- **W**：天候の見た目は光と霞の少しの変化だけ。波・雨粒・流れの強さなどの演出は Phase 5/10。

---

## 9. 実装手順（実装担当向け）

設計セッションで方針を確かめるために短い試作を行い、§0 の計測と同じ方法で次の値を確認した（試作のコードはコミットしていない。数値は実装の目安）。

| 指標（reef、半径40m） | 変更前 | 試作後（2回） |
| --- | --- | --- |
| 魚のいないサンゴ | 57〜58% | 23〜29% |
| 泳ぐ生き物が4種以上いる5mマス | 15 | 4〜7 |
| 1マスの泳ぐ生き物の最大種数 | 11 | 5 |

試作で分かった注意点：
- **`underTables` の種は群れ数を増やさない**（増やすとテーブルの下が混み、4種以上のマスが 9〜12 にしか減らなかった）。
- 生息点選び `pickSpread` は、種 id を渡したとき試行回数を 2 倍（8→16）にしないと混雑回避が効きにくい。
- `flora.ts` で `coralAll` を登録するとき、乱数 `r()` を呼ぶ順番を変えないこと（変えるとサンゴの配置が全部変わる）。色 → 大きさ → `placeMatrix` の順のまま、大きさを変数に取り出すだけにする。

### 9.1 種データ（`src/life/species.ts` の末尾、`SPECIES.push(...)` の後）

```ts
export const SPREAD_DATA = {
  coralGroupSize: 4,
  zoneBoost: { lagoon: 1.5, kelp: 1.5, rocky: 1.3, cold: 1.3, dropoff: 1.2 },
};
function balanceZones() {
  for (const d of SPECIES) {
    const coralHab = d.hab === 'coralHover' || d.hab === 'coralPick' || d.hab === 'under' || d.hab === 'cleaner';
    const coralReg = d.region === 'coralTops' || d.region === 'bommieSpots';   // underTables は除く
    if (coralHab && coralReg && !['anemone', 'static', 'buried'].includes(d.behavior))
      d.groups = Math.max(d.groups, Math.ceil(d.count / SPREAD_DATA.coralGroupSize));
    const k = SPREAD_DATA.zoneBoost[d.zone];
    if (k && d.kind === 'fish' && d.rarity <= 2 && ['school', 'solo', 'bottom'].includes(d.behavior) && !d.aggro) {
      d.count = Math.round(d.count * k);
      d.groups = Math.min(d.count, Math.ceil(d.groups * k));
    }
  }
}
balanceZones();
```
`Creatures` の生成より前に走ること（`species.ts` の読み込み時でよい）。

### 9.2 サンゴの生息点（`src/world/flora.ts`）

- `Homes` 型に `coralAll: THREE.Vector3[]` を追加、`homes` の初期値にも `coralAll: []`。
- 登録する場所（いずれも `new THREE.Vector3(x, heightAt(x, z) + 頂上, z)`）：
  - 脳サンゴ `brains`：頂上 = `sc × brainG.boundingBox.max.y × 0.9`（`sc = 0.5 + r()*1.1`）
  - 枝サンゴ一般 `pts`（`stagVariants` の各 `vi`）：頂上 = `sc × topY × 0.9`
  - テーブル `tables`：頂上 = `sc × 0.9`
  - ハナヤサイ `bushes`：`sc > 0.4` のものだけ、頂上 = `sc × bushG.boundingBox.max.y × 0.9`

### 9.3 生き物の行動（`src/life/creatures.ts`）

定数（ファイル上部、`NIGHT` の近く）：
```ts
export const SPREAD = { cell: 5, maxSpecies: 3, hideSpread: 0.7, linger: 0.15, residentFlee: 0.75, leash: 4, leashSize: 3 };
export const CURIOUS = { startR: 25, follow: 30, leaveR: 45, cooldown: 120, side: 5, away: 60 };
export const OCTO = { minSize: 0.3, grabR: 0.5, grabRSize: 0.8, dwell: 1.0, fleeSpeed: 0.9, first: 3, perSec: 1.5, big: 1.5, taps: 6, tapsBig: 9, maxHold: 6, cooldown: 20 };
export const PHOTO_VIS = { fogCut: 1.3, darkSeen: 4, minFit: 0.4, occTests: 8 };
export const LURE = { radius: 15, maxFish: 10, maxSpecies: 3, refill: 2, fear: 0.3 };
```

型の追加：
- `Group` に `cell?: string`（混み具合の登録先）、`cur?: number; curT?: number; curSide?: number`（好奇心）。
- `Agent` に `lured?: boolean`、`octT?: number; octCd?: number; octWarned?: boolean`。
- `CreatureEvent.type` に `'octoWarn' | 'grab'`。
- `Creatures` に `weatherMult: (def) => number = () => 1`、`bait: {p, t, kind, eats, fish: Set<Agent>, species: Set<string>, refill} | null`、`grab: {rt, a, t, taps, need} | null`。

**§1.2 混み具合**：
- `spotMix: Map<string, Map<string, number>>`（マス → 種 id → 群れ数）。マスのキーは `floor(x/5),floor(z/5)`。数えるのは kind `fish`／`ray`／`squid`／`turtle` だけ。
- `mixFull(id, x, z)`：そのマスの種数が 3 以上で、`id` が含まれていなければ true。
- `mixSet(def, g, p)`：群れ `g` の古い登録を外し（`g.cell`）、`p` のマスに登録。`spawn` で群れを作ったとき・`relocate` で `g.home` を変える直前に呼ぶ。`reshuffle` で全消去はしない（動かない群れの登録が消えるため）。
- `pickSpread(arr, ok, tries, id?)`：`id` があれば `tries *= 2`、候補の評価値 `u` に `mixFull` なら `+50`（＝最後の手段）。`pickHome` の `fromList` と `relocate` の文字列 region で `def.id` を渡す。
- box region：`pickHome` の座標引き直しループ（40回）で `k ≤ 30` の間は `mixFull` なら引き直し。`relocate` のループ（30回）では `k < 24` の間は `mixFull` なら `continue`。
- `homeList(reg)`：`'coralTops'` のとき `[...homes.coralTops, ...homes.coralAll]`（一度作ってキャッシュ）、それ以外は `homes[reg]`。`pickHome`（`reg === 'coralTops'`）と `relocate` で使う。

**§1.3 固まらない**：
- `fleeDir(away, vel, radialW, out, side = 0)`：`side` が 0 でなければ、接線の向きを `side < 0` で反転（進行方向による選択の代わり）。
- 個体の逃走・警戒（swimmers の `if (dPlayer < fr)` と `else if (pFast < 0.6)`）で `side = (a.ph % 2) < 1 ? 1 : -1` を渡す。群れ中心の逃走は従来どおり `side` なし。
- 隠れる目標：`g.home + a.off × 0.15` → `× SPREAD.hideSpread`。
- 警戒中の `acc.addScaledVector(_v, -0.35 …)` → `-SPREAD.linger`。

**§1.4 居場所の決まった魚**：
- `resident(def)`：`pelagic`／`drift`／`curious` は false。`hab` があり `midwater`／`surface`／`perch`／`burrow` 以外なら true。それ以外は `typeof region === 'string'`。
- 群れ中心：`resident` なら `gFlee = fleeR × 0.75`、`leash = 4 + size × 3`。ホームからの水平距離 > `leash` なら逃走をやめ `g.v += normalize(home − c) × dt × speed × 2.5`。
- 個体：`fr = lured ? fleeR × LURE.fear : resident ? fleeR × 0.75 : fleeR` を作り、個体ループ内の `fleeR` を全部 `fr` に置き換える（hiding・watchR・逃走・最高速度）。

**§2 好奇心**：
- 群れ中心ループの `curiousNear` 分岐を置き換え：`def.curious` なら `curiousStep()` を毎フレーム呼ぶ。
  - `cur=0`：距離 < 25m かつ 距離 > `size × 1.5 + 2` かつ `curT ≤ 0` かつ出現中 → `cur=1, curT=30, curSide=±1`（乱数）。
  - `cur=1`：`curT ≤ 0` または距離 > 45m → `cur=2, curT=120`、`g.t = g.c + 水平(g.c − player) 正規化 × 60`、`g.timer = 120`。
  - `cur=2`：`curT ≤ 0` → `cur=0, curT=0, timer=0`。
- `cur=1` の目標：進行方向 `f`（`playerVel` の水平成分、0.3m/s 未満なら視線 `viewDir`）に対し、横 `sd = (5 + size) × curSide`、前 `1.5 + sin(time×0.25 + home.x) × 2` → `g.t = (player.x + f.z×sd + f.x×ahead, player.y − 1 + sin(time×0.3 + home.z)×0.8, player.z − f.x×sd + f.z×ahead)`。
- `cur=2` の間は目標を引き直さない（`dist < 1 || timer ≤ 0` の分岐に入らない）。
- `relocate` で群れを移したら `cur = 0, curT = 0`。

**§3 餌（誘引）**：
- `dropBait(p, kind, eats, life)`：古い雲を `clearBait()`（全個体の `lured=false`）してから作る。
- `update()` の冒頭（`time += dt` の直後）で `baitStep(dt)`：`t` を減らし 0 で `clearBait`。2秒ごとに、捕られた個体を外し、空きがあれば候補を集める：`rt.active` で `lurable(def)`（kind fish、rarity < 4、aggro なし、curious でない、behavior が school／solo／bottom、`benthic` でない、`stage` 中でない）かつ `eats(def)`、出現中・未捕獲・aggro でない個体で、餌から 15m 以内。近い順に、10匹・3種の上限まで `lured = true`。
- swimmers の目標計算の後（aggro 処理の前）：`lured` なら `t = time × (0.7 + (ph % 1) × 0.6) + ph × 5`、`rr = 0.4 + (ph % 0.8)` で `target = bait.p + (cos t × rr, sin(1.3t) × 0.3, sin t × rr)`。`hiding` は `!lured` のときだけ。加速係数 `k` は lured なら 1.8、`watchR` は `max(fr × 2.6, lured ? 1.2 : 2.6)`、最高速度に `+0.4`。
- `baitInfo()`：`{kind, t, fish, species, near（餌から2.5m以内の数）}`（テスト・表示用）。

**§4 撮影判定**（`findTarget` を2段に）：
1. 全個体を走査して候補を集める（従来の条件＋）：`dist > clear × 1.3` は除外。暗所で光の中でも発光9m以内でもなければ、4m 超は除外・4m 以内は `dark`。点数は従来の式。
2. 点数順に並べ、上位8体まで：体の7点サンプルで `fit`（従来の計算）を出し `fit < 0.4` は除外。頭・中央・尾（`a.p + 体軸 × a.s × {−0.4, 0, 0.4}`）への視線を `occluded(cp, 点, a.s×0.3+0.25)` で調べ、3点とも遮られたら除外、一部なら `ok → hidden`。最初に `inRange`（ok）になった候補を返す。なければ最初に通った候補（ok 以外の理由つき）、それもなければ null。
- `occluded(from, to, skip = 0.3)`：従来の地形チェック（10分割）に加えて `segmentBlocked(from, to, skip)`。銛の `findSpearTarget` も同じ関数を使う。
- `src/world/colliders.ts` に追加：
```ts
export function segmentBlocked(a, b, skipEnd = 0.3): boolean {
  // a→b を 0.5m 刻み（最初の 0.3m と最後の skipEnd m は見ない）。各点で grid のセルの collider を見て、
  // sphere は中心距離 < r、円柱は y0 ≤ y ≤ y1 かつ 水平距離 < r なら true
}
```

**§5 タコ**：
- `grabber(def)`：kind `octopus` かつ `size ≥ 0.3`。
- static 分岐の先頭で `octoStep()`。true が返ればその個体は `writeInstance` して次へ。
  - 絡んでいる個体：`a.p` を `player + 視線水平 × 0.55 − (0, 0.45, 0)` へ `lerp(dt × 6)`、姿勢は揺らす（pitch `0.4 + sin(7t)×0.12`、yaw はダイバーの方、roll `sin(6t)×0.15`）。
  - それ以外：`alarm > 0`・`octCd > 0`・ほかに絡まれ中 なら何もしない。`reach = 0.5 + size × 0.8`。距離 < `reach × 2` で一度だけ `octoWarn` イベント（`reach × 3` を離れたら再び出せる）。距離 < `reach` かつ ダイバーの速さ ≤ 0.9 の間 `octT += dt`、1.0秒で `grab = {rt, a, t: 0, taps: 0, need: size ≥ 1 ? 9 : 6}` と `grab` イベント。外れたら `octT = 0`。
- 逃げる条件に `(!grabber || playerVel.length() > 0.9)` を追加。
- `releaseGrab(from)`：`grab = null`、`octCd = 20`、`alarm = 3.5`、`v = 水平(a.p − from) 正規化 × 2.2`、`gx = undefined`。

**天候**：`presence(rarity)` を `presence(def)` に変え、`min(0.95, base × weatherMult(def))`。呼び出し3か所（`reshuffle`・遠い群れの再配置・`nightFall`）。

### 9.4 新規ファイル

- `src/game/bait.ts`：`BAIT = { life: 40, pack: 3, kinds: [{id:'krill', name:'オキアミ', price:300, diet:'plankton', color:'#f0a080'}, {id:'chunk', name:'魚の切り身', price:500, diet:'meat', color:'#e8d0c0'}, {id:'weed', name:'海藻だんご', price:300, diet:'weed', color:'#7aa050'}] }`、`dietOf(def)`（§3.1：名前の語の表 `DIET_WORDS` を順に見て最初に当たった語で決める。草食の語（ハギ・ブダイ・アイゴ・メジナ・ニザダイ・イスズミ・ハコフグ・オヤビッチャ）を「タイ」「ハタ」より先に置くこと。当たらなければ「school かつ 0.15m 未満 → plankton」「0.15〜2.5m → meat」「それ以外 → 寄らない」）、`eatsBait(id)`。
- `src/game/weather.ts`：`WEATHER`（割合・名前・アイコン ☀☁☂🌀・光 `{1, 0.9, 0.8, 0.7}`・霧 `{1, 1.05, 1.1, 1.2}`・朝の一言 §6.3）、`weatherOf(day)`（1日目は晴れ。`hash(day + 1013)` を累積割合で引く。前日も荒天なら曇り）、`weatherMult(def, w)`（§6.2 の表。範囲 0.75〜1.35 で clamp）。

### 9.5 ゲーム側（`src/game/Game.ts`・`kitchen.ts`・`environment.ts`・`index.html`・`styles.css`）

- `environment.ts`：`weatherLight = 1; weatherFog = 1` を追加。`vis /= weatherFog`（`fog.density` の計算前）、`sun.intensity *= weatherLight`、`hemi.intensity *= 0.6 + 0.4 × weatherLight`。
- `startDive`：`reshuffle` の前に `weather = ads ? 'sunny' : weatherOf(save.day)`、`creatures.weatherMult`・`env.weatherLight/Fog` を設定、`clearBait()`・`grab = null`。エントリーのトーストに「天気：☂雨」。
- ボートの日付表示 `renderDaytime`：「N日目・時刻・☂雨」。
- 入力：`bindButton($('btn-bait'), 'bait')`・`bindButton($('btn-bait-kind'), 'baitKind')`。`consume('baitKind')` で切替、`consume('bait')` でまく（目の前1.5m、海底+0.5m より上。手持ちを1減らしてセーブ、粒60個の `THREE.Points` を雲として表示し、毎フレーム少し沈ませ、残り8秒から薄くする）。
- 絡まれ中：泳ぐ速さ ×0.25。シャッター処理の最初で `grab` を処理（`air -= 1.5 × (size≥1 ? 1.5 : 1) × dt`、最低 1bar。`consume('shutter')` で `taps++`。`taps ≥ need` または `t ≥ 6` で `releaseGrab` と「振りほどいた！」／「腕をほどいて離れていった」）。照準ラベル「◯◯に絡まれた！ シャッター連打で振りほどく（あと n 回）」。
- `handleEncounters`：`octoWarn` →「◯◯の腕がこちらに伸びてきた… 近づきすぎ注意（ゆっくり離れよう）」（warn）。`grab` → `air −= round(3 × big)`、揺れ 0.8、警告音、振動、「◯◯に吸盤で絡まれた！ エア −3bar　シャッター連打で振りほどこう」（danger）。
- `kitchen.ts`：`LandSave.bait?: Partial<Record<BaitId, number>>`。`say()`：朝は `WEATHER.morning[weatherOf(day)]`（掲示板の紹介の日は「天候の一言。」＋紹介文から「おはよう。」を除いたもの）。島の話 `LORE` は `lore > 0` の朝には出さず、次の来店（`back`）へ。状態行 `#k-status` に「天気 ☂ 雨」。`#k-bait` に3種の棚（手持ち回数・説明・「買う ¥300」、所持金不足なら disabled）、`buyBait(id)` で所持金を引き `pack` 回分足す。
- `index.html`：`#k-buff` の後に `<h3 class="k-h">釣具の棚：餌</h3><div id="k-bait" class="k-list k-board"></div>`（`k-shop` クラスを付けない＝手銛の前でも出る）。`#controls` の `#btn-shutter` の前に `#btn-bait`（粒のアイコン＋`<small id="bait-label">`）と `#btn-bait-kind`（`ctl mini`）。
- `styles.css`：`#btn-bait { position:absolute; right:100%; bottom:72px; margin-right:12px; flex-direction:column; color:var(--bait) }`、`#btn-bait-kind { position:absolute; right:calc(100% + 12px); bottom:136px; width:34px; height:34px }`。

### 9.6 テストフックと確認スクリプト

`__THREE_GAME_TEST_HOOKS__` に追加するもの：
- `spreadStats(R=40)`：§0 の指標（サンゴ数・魚のいないサンゴ %・4種以上のマス・最大種数）。サンゴは `flora.group` の InstancedMesh のインスタンスのうち 半径 0.5〜6m・z 125〜345・ダイバーから R 以内。
- `clump(r=8)`：r 以内の魚の数と、1.5m 以内に集まる最大数。
- `curiousState(id)`・`callCurious(id)`（群れ0をダイバーの 12m 横へ）。
- `giveBait(n)`・`dropBait(kind)`・`baitInfo()`。
- `placeOcto(id)`（目の前 2.5m の海底へ）・`octo()`（絡まれ状態とエア）。
- `weather()`・`weatherMult(id, w)`・`targetInfo()`。

確認は `dive/scripts/probe-phase4.cjs`（Playwright、`dist/artifact.html` を file:// で開く）。headless の swiftshader は 1〜6 fps なので、待つときは時刻でなく `waitForFunction(() => game.time > t0 + 秒)` を使う。合格の目安：
- reef の `spreadStats`：魚のいないサンゴ ≤ 30%、4種以上のマス ≤ 変更前の半分（変更前 15）。
- イルカ：`callCurious('dolphin')` → `cur` が 1 になってから 2 になるまで 30 ±2 秒（ゲーム内時間）。その後 15 秒で距離が広がっている。
- 餌：3種それぞれで `baitInfo().fish ≤ 10`、`species.length ≤ 3`、種の顔ぶれが餌ごとに違う。手持ちが 1 ずつ減る。
- 撮影判定：目の前 3m は `ok`、`clear×1.15` は `murky`、`clear×1.6` は null、暗所 8m は null・3m は `dark`、サンゴの頭の向こうは null。
- タコ：`placeOcto` の上でゆっくり止まると 1 秒後に絡まれ、エアが 3bar＋1.5bar/秒で減り、シャッター6回で外れる。
- 天候：朝にすると女将さんの一言が天候の文になり、状態行に天気。`weatherMult` が 0.75〜1.35 に収まる。
- ページエラー 0、横 844×390・縦 390×844 で餌ボタンが他のボタンに重ならない。
