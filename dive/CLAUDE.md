# dive/ — BLUE DEPTHS（構成メモ）

ルートの `CLAUDE.md` の共通ルールが前提。ここは dive 固有の情報だけを置く。

検証コマンド: `cd dive && npm install && npm run artifact`（ビルドを含む）

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
