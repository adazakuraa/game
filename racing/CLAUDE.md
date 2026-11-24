# racing/ — APEX LINE（構成メモ）

ルートの `CLAUDE.md` の共通ルールが前提。ここは racing 固有の情報だけを置く。

検証: ビルドなし。ブラウザで起動して画面が出ることを確認する。

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
