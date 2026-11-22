# CLAUDE.md — このリポジトリで作業する AI へ

ブラウザゲーム集。オーナーは **作業ブランチをマージせず、claude.ai のアーティファクトに公開した版で遊んでいる**。
なので「`main` が最新」とは限らない。作業を始める前に、必ず下の「1. 作業の始め方」を読むこと。

返答・コミットメッセージ・ドキュメント・ゲーム内の文言は **日本語**（既存コミットには英語もあるが、新規は日本語でよい）。

---

## 0. ゲーム一覧と最新ブランチ（2026-11-22 時点）

| フォルダ | タイトル | アーティファクト URL | 最新コードのブランチ | `main` との関係 |
| --- | --- | --- | --- | --- |
| `climb/` | DEATH ZONE 8000（高所登山） | https://claude.ai/artifact/Y6AmowkXBB8HND5EP9osHX | `main` | main に統合済み（2026-11-22、PR #11。キャンプ・犬・遺品・評価・コジオスコのチュートリアルなど） |
| `racing/` | APEX LINE（GT・ラリー・ロードバイク） | https://claude.ai/artifact/UB1cbzTRiNqA9dTLkbRodb | `main` | main に統合済み（2026-11-22、PR #10・#12。ラリー・バイク・ガレージ・ドリフト・性能パーツ・金メダル基準の難易度・ジャンプ着地のカメラ・CPUコーナー最終調整など） |
| `dive/` | BLUE DEPTHS（ダイビング図鑑） | https://claude.ai/artifact/WFpZNDxWq6nFYMsetBYKjk | `main` | main に統合済み（2026-11-22、PR #10。ナイトダイブのリスク・水中ライト・夜専用種と光景・ウミガメ追従・1ダイブ1種1回の売上・海面の見え方など） |
| `kanken/` | 漢検ランダム漢字 | （未公開） | `main` | 同じ |
| このドキュメント | README.md / CLAUDE.md / scripts/ | — | `main` | 統合済み |

**この表は古くなる**。実際の最新は次のコマンドで確かめる（フォルダごとに、最新コミットを含むリモートブランチを表示）：

```bash
bash scripts/latest-branches.sh            # climb racing dive kanken CLAUDE.md
bash scripts/latest-branches.sh climb      # 1 つだけ
```

> このファイル自体が `main` にない場合、新しいセッションでは自動で読み込まれない。
> オーナーが新しいセッションで「CLAUDE.md を読んで」と言ったら `bash scripts/latest-branches.sh CLAUDE.md`、
> または `git fetch origin && git show origin/ccr-79abba39-cmnsno:CLAUDE.md` で探すこと。

---

## 1. 作業の始め方（毎回）

1. セッションには専用の作業ブランチ（`ccr-xxxxxxxx-xxxxxx`）が割り当てられている。コミットとプッシュはそこだけに行う。`main` や他のセッションのブランチには push しない。
2. 触るゲームの**最新ブランチを自分の作業ブランチにマージ**してから始める：
   ```bash
   bash scripts/latest-branches.sh <フォルダ>
   git fetch origin <最新ブランチ>
   git merge --no-edit FETCH_HEAD
   ```
   - ゲームごとにフォルダが分かれているので、別のゲームの最新ブランチ同士をマージしても普通は衝突しない。
   - README.md / CLAUDE.md が最新のブランチも一緒にマージしておくと、ドキュメントも最新になる。
3. 古い `main` のまま作業すると、すでにアーティファクトに入っている機能を消してしまう。**必ず最新ブランチの上で作業すること。**
4. プルリクエストは頼まれない限り作らない。マージもしない。

## 2. 作業の終わり方（毎回）

1. 動作確認（ビルドが通る・ブラウザで起動して画面が出る。Playwright と Chromium はクラウド環境に入っている）。
2. コミットして自分の作業ブランチに push。
3. **アーティファクトを更新する**（下の「3. アーティファクトの公開」）。新しい URL を作らず、上の表の URL を `url` に渡して上書きする。別の会話で作ったアーティファクトなので、先に `Artifact` の `action: "read"` で読んでから publish する（読まずに publish すると拒否される）。
4. そのゲームの `README.md`（遊び方・仕組み）を変更内容に合わせて直す。設計上の判断は `DESIGN.md` に。
5. この CLAUDE.md の「0. ゲーム一覧と最新ブランチ」の表を、**今の作業ブランチ名**に書き換えてコミットする（次のセッションがどこから始めればよいか分かるように）。新しいゲームを足したら表と「4. ゲームごとの構成」に追記する。

## 3. アーティファクトの公開

| ゲーム | 作り方 | 公開のしかた |
| --- | --- | --- |
| climb | `cd climb && npm install && npm run build && node scripts/make-artifact.mjs dist dist/artifact.html` | `dist/artifact.html` を 1 ファイルで publish（JS/CSS をインライン化済み） |
| dive | `cd dive && npm install && npm run artifact` | `dist/artifact.html` を 1 ファイルで publish（画像も `assetsInlineLimit` でインライン化される） |
| racing | ビルドなし | **複数ファイル**で publish：`file_path` = `racing/index.html`、`files` に `style.css`・`js/**/*.js`・`vendor/three.module.min.js`・`vendor/Sky.js` を同じ相対パスで渡す（今の公開版もこの 34 ファイル構成）。`index.html` の importmap が `./vendor/three.module.min.js` を指している |
| kanken | ビルドなし | 公開するなら `kanken/index.html` ＋ `files` に `kanji-data.js`・`kanji-detail.json`（詳細は `fetch('kanji-detail.json')` で遅延読み込み） |

- `dist/` は `.gitignore` 済み。コミットしない。
- 外部 CDN は使っていない（three は npm か `racing/vendor/` 同梱）。アーティファクトでもそのまま動く。
- セーブは `localStorage`（アーティファクトの URL ごとに別保存）。キー: climb `dz8000-expedition-v1`、dive `blue-depths-save-v1`、racing `apexline.*`（`js/store.js`）。セーブ形式を変えるときは旧データからの移行か、キーの版を上げること（遊んでいるデータが消えないように）。

## 4. ゲームごとの構成

共通の方針：
- **スマホのタッチ操作が主**、PC（キーボード・マウス）も対応。縦横どちらでも崩れないように。
- **アセットは手続き生成**（モデル・テクスチャ・音は Web Audio で合成）。例外は dive の CC0/パブリックドメイン画像（`dive/src/assets/**/CREDITS.md` に出典）。有料素材・外部 API は使わない。
- ゲーム性の調整は「桜井政博のゲーム作るには」の原則（[kociden/sakurai-skill](https://github.com/kociden/sakurai-skill)）を参考にしていて、各 `README.md` / `DESIGN.md` に「原則 → 問題 → 直したこと」の形で記録している。新しい調整も同じ形で追記する。
- 制作の流れは [majidmanzarpour/threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills)（director / gameplay-systems / aaa-graphics-builder / game-ui-designer / qa-release）を参考にしている。
- シミュレーション（数値・ルール）と描画（Three.js）を分ける。調整値は定数オブジェクトにまとめる（例: dive `PHOTO` / `SHOP`、racing `DIFFICULTY` / `DRIFT`）。

### climb/ — DEATH ZONE 8000（Three.js + TypeScript + Vite、port 5188）

一人称でエベレスト南東稜・K2 アブルッツィ稜を登る。酸素流量と SpO₂、体温・凍傷、HACE、フィックスロープのクリップ／付け替え、滑落停止、天候、セラック崩落、キャンプ（食事・報奨金）、犬、遺品と記録帳、区間評価と自己ベスト、チェックポイント再開。
説明: `climb/README.md`、設計と桜井流レビュー: `climb/DESIGN.md`。以下は `main` の構成。

| ファイル | 役割 |
| --- | --- |
| `src/main.ts` | 起動 |
| `src/game/Game.ts` | ゲーム本体（約 2100 行）。状態遷移・ループ・死亡と再開・ハザード・キャンプ遷移・テストフック |
| `src/game/Mountains.ts` | 山と遠征の定義（尾根のポリライン、ランドマーク、クレバス、標高の圧縮 `altScale`） |
| `src/game/Scoring.ts` | 区間のガイド基準タイムと評価（シェルパ級〜公募隊の顧客級）、自己ベスト |
| `src/game/Lore.ts` | 遺品（各区間 2 つ・全 20）の文章と取得状態 |
| `src/player/Player.ts` | 移動・ロープ作業・滑落・休憩・荷重による速度 |
| `src/player/Body.ts` | 足元のブーツと脚・影 |
| `src/player/Viewmodel.ts` | 一人称の腕・ピッケル・ユマール・カラビナ |
| `src/systems/Physiology.ts` | 生理（SpO₂・体力・体温・凍傷・HACE・順応・食事効果）と天候 `Weather`、ボンベ容量 |
| `src/systems/Audio.ts` | Web Audio の手続き音（風・心音・アイゼン・金具） |
| `src/systems/PostFX.ts` | ポストエフェクト（AgX トーンマップ、低酸素の周辺ぼけ） |
| `src/ui/Hud.ts` | HUD（時刻・基準との差・酸素など） |
| `src/ui/CampScreen.ts` / `CampScene3D.ts` | キャンプ画面（到着演出・食事・犬・記録帳・C4 の酸素選択）と 3D の夜のキャンプ |
| `src/ui/MapView.ts` | ルート地図と標高プロファイル |
| `src/ui/Radio.ts` | BC 無線のセリフ |
| `src/game/Coach.ts` | コジオスコ練習ステージのレッスン（12 個）とカード。`Mountains.ts` の `TUTORIAL_STAGE` が地形 |
| `src/world/Terrain.ts` / `TerrainTextures.ts` / `NearGround.ts` | 山の高さ場（尾根＋ノイズ＋クレバス）、地形テクスチャ、足元の細かい起伏 |
| `src/world/Route.ts` | 歩くライン・フィックスロープ・アンカー・ランドマーク位置 |
| `src/world/Props.ts` | 岩・セラック・テント・ハシゴ・ボンベなどの配置とハザード |
| `src/world/Environment.ts` | 空・太陽・薄明・星・霧 |
| `src/world/Snow.ts` / `Breath.ts` / `Plume.ts` / `Ambient.ts` | 雪煙、吐く息、山頂の雪煙、遠くの雪崩・鳥・流れ星 |
| `src/world/Dog.ts` / `DogModel.ts` | 犬の振る舞いとモデル |
| `src/world/Sculpt.ts` / `CampModels.ts` | 手続きスカルプト用の道具（sweep/lathe/strand）とキャンプの食べ物モデル |
| `src/core/Input.ts` | キー・マウス・タッチを「意図（intent）」に変換 |
| `src/utils/random.ts` | シード付き乱数。**ゲーム中の乱数は必ずここを通す**（`Math.random` を使わない。テストの再現性のため） |
| `tests/visual.spec.ts` | Playwright の見た目確認。`bot-playtest.template.ts` は自動プレイのひな形 |
| `scripts/make-artifact.mjs` | ビルドを 1 ファイルの HTML にまとめる |

テスト用フック: `window.__THREE_GAME_TEST_HOOKS__.setState(name)` で `title` / `night-start` / `active-play` / `ridge` / `k2-bottleneck` / `storm` / `fail` / `summit`、チュートリアルの `tutorial` / `tutorial-summit` に直接移動できる。

### racing/ — APEX LINE（Three.js + 素の JS ES モジュール、ビルドなし）

GT サーキット（レース／ゴースト付きタイムアタック）、ラリー（路面とペースノート）、ロードバイク（W' とスリップストリーム）。ドリフトターボ、ショートカット、ジャンプ台、自動復帰、コインとガレージ（見た目のみ）。
説明: `racing/README.md`。以下は `main` の構成。

| ファイル | 役割 |
| --- | --- |
| `index.html` / `style.css` | 画面（メニュー・HUD・設定・ガレージ）と見た目。importmap で three を `vendor/` から読む |
| `js/main.js` | メニュー・ループ・カメラ・HUD・ゴースト。デバッグ用に `window.__apex` |
| `js/genres.js` | ジャンルとコースの一覧（メニューと起動はここを通る） |
| `js/game/base.js` | ゲームクラスの共通部分（固定ステップ、追従カメラ、一時停止） |
| `js/game/circuit.js` / `rally.js` / `bike.js` | ジャンルごとのゲーム |
| `js/game/common.js` | 共有オブジェクト `C`、DOM ヘルパー、ミニマップ |
| `js/sim/car.js` | GT カーの物理（2 輪モデル・荷重移動・摩擦円・パワートレイン）と `DRIFT` |
| `js/sim/track.js` / `trackdata.js` | コース生成（Catmull-Rom、壁、レーシングライン、速度プロファイル、路面）とコース定義（`zones`、`medals`） |
| `js/sim/race.js` | レース進行・順位・接触、難易度 `DIFFICULTY`、CPU の較正 |
| `js/sim/ai.js` / `bot.js` | CPU ドライバー、自動ドライバー（難易度の基準とゴール後の自動走行） |
| `js/sim/rally.js` / `rallydata.js` | ラリーの計時・ペースノート・ステージ定義 |
| `js/sim/bike.js` / `bikedata.js` | ロードバイクの物理（パワーと W'）・集団の AI・コース |
| `js/sim/recovery.js` | 壁に引っかかる・逆走したときの自動復帰 |
| `js/render/world.js` | コース・地形・空・照明・背景（約 1300 行） |
| `js/render/rallyworld.js` / `bikeworld.js` | ラリーとバイクのステージ描画 |
| `js/render/carmodel.js` / `bikemodel.js` | 車（断面ロフト）と自転車・選手のモデル |
| `js/render/textures.js` / `effects.js` | 手続きテクスチャ、スキッド・煙・火花・雨 |
| `js/garage.js` / `js/ui/garageview.js` | 見た目パーツと性能パーツ（`PARTS`・`STATS`）のカタログ・所持と装備・報酬計算、ガレージの 3D プレビューと性能バー |
| `js/ui/input.js` | タッチ（スライド・ボタン・傾き）・キーボード・ゲームパッド |
| `js/audio.js` | エンジン音などの合成 |
| `js/store.js` | localStorage ラッパー（キーは `apexline.` で始まる） |

### dive/ — BLUE DEPTHS（Three.js + TypeScript + Vite、port 5190）

ボートから潜って生き物（600 種）を撮影し図鑑を埋める。写真の評価と売上、装備とタンク強化、ストーリー 7 章、特別な光景（実績）、拾い物、潜水中の依頼、銛漁としおさい亭（食堂・ウニの選別・ふぐ調理師試験）、昼夜とナイトダイブ、多数のエリア。
説明: `dive/README.md`、設計: `dive/DESIGN.md`。

| ファイル | 役割 |
| --- | --- |
| `src/game/Game.ts` | ゲーム本体（約 1800 行）。セーブ、ボート画面、潜水ループ、テストフック `__THREE_GAME_TEST_HOOKS__` |
| `src/game/photoScore.ts` | 撮影の評価と値段 `PHOTO`、ショップ `SHOP`、タンク強化 `AIR_TANK` |
| `src/game/story.ts` / `scenes.ts` | ストーリーの章・チュートリアル・特別な光景の定義と演出 |
| `src/game/missions.ts` | 潜水中の依頼（ウニ漁・ごみ拾い・撮影依頼・カメラ探し…）`MISSION`・`URCHINS` |
| `src/game/finds.ts` | 海底の拾い物 |
| `src/game/fishing.ts` / `kitchen.ts` / `kitchenGames.ts` / `gearModels.ts` | 銛漁のルールとペナルティ、食堂、食堂のミニゲーム、銛・水中銃のモデル |
| `src/life/species*.ts` | 生き物の定義（`species.ts` が型と集約。2〜12 は追加分：魚・無脊椎・流氷・哺乳類と古生物・遺跡と洞窟・海藻の森・ふぐ） |
| `src/life/creatures.ts` | 生き物の行動（くらし・警戒・群れ・攻撃的な個体） |
| `src/life/models.ts` / `paint.ts` | 手続きモデルと体の模様 |
| `src/life/photoFish.ts` / `photoProfiles.ts` | 写真テクスチャを使う 31 種（`scripts/photo_fish.py` で生成） |
| `src/world/layout.ts` | 世界の座標とエリア配置（z が沖方向）、沈没船・噴出孔など |
| `src/world/terrain.ts` / `flora.ts` / `scatter.ts` / `colliders.ts` / `surface.ts` | 地形チャンク、サンゴ・海藻、インスタンス配置、当たり判定、足元の高さ |
| `src/world/environment.ts` | 水中の霧・深度による光・水面・光芒・マリンスノー |
| `src/render/underwater.ts` / `textures.ts` / `baked.ts` | 水中シェーダの共通部分、手続きテクスチャ、焼いたテクスチャと PBR |
| `src/ui/minimap.ts` | ミニマップと海図 |
| `src/core/input.ts` / `audio.ts` | 入力、水中の音 |
| `scripts/` | テクスチャや魚写真の前処理（Python）、`make-artifact.mjs` |

### kanken/ — 漢検ランダム漢字（1 ページの HTML）

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面とロジック全部（範囲の選択、1 級のみ、ランダム表示、読み・熟語の表示、weblio へのリンク） |
| `kanji-data.js` | 出題範囲の漢字列（`JOYO` 常用 / `JUN1` 準 1 級の目安 / `ICHI` 1 級のみの目安） |
| `kanji-detail.json` | 漢字ごとの音読み・訓読み・熟語（約 900KB、初めて開いたときだけ読み込む） |

---

## 5. 新しいゲームを足すとき

- リポジトリ直下に新しいフォルダを作る（他のゲームのフォルダは触らない）。
- アーティファクトで動くように：外部 CDN を使わない、1 ファイルにまとめられるか（Vite なら climb/dive の `make-artifact.mjs` を流用）、複数ファイルで公開できる構成にする。
- フォルダに `README.md`（遊び方・操作表・仕組み）を置き、このファイルの表・「3. アーティファクトの公開」・「4. ゲームごとの構成」とリポジトリ直下の `README.md` の表に追記する。

---

Token Efficiency Rules

トークン消費を抑えながら、実装品質・正確性・安全性を維持すること。

1. Context Management

- 作業に必要なファイルだけを読み込む。
- 関連性のないファイルやディレクトリ全体を無目的に調査しない。
- 既に確認済みの情報を繰り返し読み込まない。
- 大量のログやコードを出力せず、必要な部分だけ確認する。
- 長時間の作業では、適切なタイミングで "/compact" を利用する。
- 別機能・別タスクに移る際は、必要な情報を保存してから会話をリセットする。

2. Implementation

- 依頼された機能に必要な最小限の変更を行う。
- 不要なリファクタリングや過剰な抽象化を避ける。
- 既存の実装や共通処理を優先的に再利用する。
- 一度に関連する変更をまとめ、無意味な試行錯誤を減らす。
- 実装前の過剰な分析や、必要以上に細かい計画の出力を避ける。

3. Investigation & Debugging

- 不具合の再現条件と関連箇所を絞って調査する。
- 原因を特定する前に、無関係な箇所まで変更しない。
- エラーが発生した場合、エラー全文を何度も出力せず、原因に関係する部分を中心に確認する。
- 修正後は関連するテストを優先して実行する。
- 解決済みの問題を不必要に再調査しない。

4. Output

- 回答は簡潔かつ具体的にする。
- 作業中の逐次的な状況報告は最小限にする。
- コード全体を回答に貼り付けず、変更箇所と変更内容を中心に報告する。
- 完了時は変更ファイル・変更内容・テスト結果・未解決事項を簡潔にまとめる。
- 既知の情報や仕様を繰り返し説明しない。

5. Model & Agent Usage

- 単純な実装・修正・調査にはSonnetを優先する。
- Opusは複雑な設計、難易度の高い問題分析、大規模な変更などに限定する。
- サブエージェントは並列調査など、明確なメリットがある場合のみ使用する。
- サブエージェントへの指示には必要な情報だけを渡す。
- エージェントの調査結果は要点をまとめ、不要な全文転送を避ける。

6. Priority

トークン節約を理由に、以下を犠牲にしてはならない。

- 実装の正確性
- 既存機能との互換性
- セキュリティ
- 必要なテスト
- 重要な仕様の確認

不確実な状態での実装や、必要な調査・検証の省略によってトークンを節約しないこと。
