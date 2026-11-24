# climb/ — DEATH ZONE 8000（構成メモ）

ルートの `CLAUDE.md` の共通ルールが前提。ここは climb 固有の情報だけを置く。

検証コマンド: `cd climb && npm install && npm run build`

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
