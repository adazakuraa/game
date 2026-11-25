# RESUME — dive（BLUE DEPTHS）引き継ぎメモ

最終更新: 2026-11-25（作業ブランチ `muse/phase5-impl`）

## 現状
- **Phase 5（マップ・探索・地形・景観・宝箱）を実装・確認した**。設計は Claude（Opus）＝`dive/docs/PHASE5-DESIGN.md`（決定の正、§9 が実装手順、§8 が確認点 X〜AG）、実装と検証は Muse。トラッカー28項目すべて確認済み（写真スポットの4項目は Phase 3 で実装し Phase 5 で再確認）。
  - 地形関数：`layout.ts` の本体を `heightCore`＋モジュール変数 `MODE`（0 実地形／1 見える地表／2 海図用自然地形）に分け、`heightAt`／`surfaceTopAt`／`chartHeightAt` を export。遺跡は `pyramidAt`（正方形5段 `PYR_W`／`PYR_H`、壁は内側へ1.5m傾斜、大階段は北面の直線スロープ、道の溝は `RUINS.z + 31` から。MODE 2 ではピラミッド・スロープ・道・沈没船の掘れ跡を付けない）。洞窟の溝は MODE 0 かセノーテ軸の近く（`CENOTE.r + 2`）だけ彫る。`BLUEHOLE` を (300, 600, r27, 深さ55) へ移動し `blueWeight`／`blueHeight` を新設、`westWeight` は2帯（遺跡 388–665・洞窟 765〜）、`zoneAt` は `blueWeight > 0.5` を deep より先に判定し、西は `z < 700` で ruins・以南は cave。`caveTopAt` 追加。`DIVE_POINTS` の bluehole は (300, 545)。
  - 海図：`minimap.ts` に余白 `M = 120`m。`buildChart` を航空写真風に書き直し（`chartHeightAt` の深さ→水の色、`bottomMaterial` を detail＝exp(−d/9) で混合、底色は2px間引きサンプルで生成 1,909ms→1,082ms（VM計測））。ケルプの天蓋・流氷片・波紋を重ね、等深線・陰影・ゾーン色味はなし。余白は南＝浜→陸、他は縁の深さを延長。`update` の外側は `#0b3a78`、コンパス所持で円の縁にボート方向のオレンジ三角。`drawBig` は世界部分基準で余白込み表示。`ZONE_LABELS` の bluehole は (300, 610)。
  - 地形メッシュ・洞窟・遺跡：`terrain.ts` は `surfaceTopAt` で頂点・法線・AO（チャンクのカリング範囲は ±135 に拡大）。`flora.ts`：柱の輪は円形（rr = 36 + (k % 3) * 8）、落下ブロックはピラミッドの外だけ、大階段の段箱27段＋袖壁（solid）、頂上に神殿（solid、北に幅2.4m・高さ2.4mの入口、土台は遺跡中心の `heightAt` ≈ −6m）。洞窟は上面シートを廃止し、内側の床リボン（幅は通路幅+3、セノーテ軸付近は除く）を新設。`Homes.caveTopSpots`（台地の上40点）を採取。
  - 宝箱：新規 `src/game/chests.ts`（10個、開封半径1.8m、きらめき12m、蓋の開き0.8s）。限定装備は `CHEST_GEAR`（`oldreg` 年代物のレギュレーター＝エア −10%／`goldfins` 古代の黄金のフィン＝速さ +10%／`compass` 探検家のコンパス＝ミニマップの矢印）。配置は沈没船＝oldreg、神殿＝goldfins、洞窟の奥＝compass、他7つは手記のヒント（未撮影の光景を 同マップ＋未ヒント→同マップ→未ヒント→残り の優先で選び `save.sceneHints` へ。全て撮影済みなら銀貨 ¥1,000）。依頼の宝箱も `gearModels.ts` の `chestModel()` に統一。`story.ts` の `SCENES` に手記 `note` 14件。アルバムはヒント済みの光景に名前と手記を出し、未発見マップのスポット行は出さず分母は「？」。食堂に「宝物の装備」の棚（所持分だけ表示）。セーブ追加は `chests`／`sceneHints`（キーは v1 のまま）。
  - 端・メニュー：マップ端12m以内で外向きの速度を押し戻し、壁際（3m未満）で理由トースト（浜側は「ここから先は浜」、他は「潮の流れが強い…」）。**押し戻しだけではクランプに届かないため、トーストは「押し戻しで壁に留められたとき」にも出すよう実装時に条件を広げた**。ボートの未発見行は常時「未発見のポイント ×？」。
  - マリンスノー：`environment.ts` で `snowK`＝120mから出始め170mで最大にし、`uAmb`・`uLight` に掛ける。浅い沖・ブルーホールでは出ない。夜光虫の青（uGlow）は残置。
  - 種の移動：`species.ts` の `MAP_MOVES` 20種（遺跡+7・ブルーホール+5・洞窟は caveSpots +4／caveTopSpots +4）を `balanceZones()` の前に適用。`ZONE_ORDER` は11マップ（確認点AF）。洞窟の上の砂地魚は `Region` の `caveTopSpots`＋`creatures.ts` の `groundY` で台地の上に配置。集計（§6.1 の方法、rolldown で束ねて node 集計）は遺跡10・ブルーホール10・洞窟11、他の全マップも10種以上。**注意：`species11.ts` の `ZR` テーブルに旧ブルーホール座標が残り、固有種2種（ナガハナダイ・フタイロハナゴイ）が旧位置に残っていた。集計で検出し、`BLUEHOLE` 相対に直した。**
  - 図鑑の数表示の削除（2026-11-25 ユーザー追加指示）：HUDチップ・図鑑画面・タイトル・ボートの行き先行から「○/○」形式を削除（アイコンと +new バッジ、絶対数の表示は残置）。**注意：`startDive` 内に `$('dex-total')` への書き込みが残り、潜るたびに null エラーになった。書き込みを削除して解消。要素を消すときは書き込み側も一緒に消すこと。**
  - テストフック追加：`chests`／`openChest`／`goChest`（宝箱の1.2m横・0.7m上に立つ）。検証プローブは `dive/scripts/probe-phase5.cjs`〜`probe-phase5d.cjs`（項目別）と `probe-phase5v.cjs`（3D の目視）。**プローブの注意：`updateDiver` は冒頭で `input.poll()` が moveX／moveY を実デバイスから再計算するので、合成入力は poll をスタブしないと消える。`page.screenshot` は SwiftShader で古い合成フレームを掴むので、3D の目視確認は `renderer.render`＋`domElement.toDataURL` の同期キャプチャを使うこと。ヘッドレスでは実フレームが数秒に1枚しか進まないため、`env.update` のような毎フレーム処理の確認は直接呼んで行う。**
  - 検証：`npm run artifact` 通過。海図は数値（遺跡上のばらつき std 3.5 対 海底 31.4、洞窟の溝と台地の色差は最大1）と目視（ピラミッド正面・洞窟の上・洞窟内・ブルーホール）で確認。宝箱は全フロー（対象表示・ヒント・即時セーブ・二重開封なし・限定装備2種・銀貨）、装備効果は実測（エア ×0.900・速さ ×1.100）、端は押し戻しと両トースト、マリンスノーは浅場 uAmb=0・深海 0.15、図鑑11マップ見出し、ページエラー 0。
- **Phase 4（魚のAI・生態・撮影・行動イベント）を実装・確認した**。設計は Claude（Opus）＝`dive/docs/PHASE4-DESIGN.md`（決定の正、§9 が実装手順）、実装と検証は Muse。分担は監督の指示で変更されたもの（設計＝Claude、実装＝Muse が今後の基本形）。
  - 分布：生息点を全サンゴに拡大（`flora.ts` の `Homes.coralAll`）、群れの分割（4個体ごとに群れを分ける）、5mマスの混雑マップ `spotMix`（新規配置は3種まで）、逃走の固まり解消と居場所のある魚のリーシュ（`creatures.ts`）、環境ごとの個体数ブースト（`species.ts` の `balanceZones()`、遺跡・ブルーホール・洞窟は対象外）。
  - 好奇心：`CURIOUS`（横について30秒→離れて60m先へ、クールダウン120秒。全16種共通）。
  - 餌：新規 `src/game/bait.ts`（オキアミ／切り身／海藻だんご、各3回分）。食性は名前の語＋大きさ・行動で推定。食堂の「釣具の棚：餌」で購入（`kitchen.ts`）、海中は餌ボタン＋切替ボタン（`Game.ts`／`index.html`／`styles.css`）。誘引は上限10匹・3種、雲は40秒。
  - 撮影判定：`findTarget` を2段階化（霞・暗所・枠外を候補から除外し、上位候補だけ遮蔽判定）。遮蔽は地形＋ `colliders.ts` の `segmentBlocked`。**注意：洞窟内では地形（海底面）が屋根の上にあるため、両端が屋根より下の区間は地形判定を外した**（素通りすると洞窟内で何も撮れなくなる。旧仕様は遮蔽＝理由が hidden になるだけで除外ではなかった）。
  - タコ：`octoStep`（大きめのタコに低速で接近し1秒留まると絡まれる。最初 −3bar、−1.5bar/秒、シャッター6回連打で脱出、6秒で自動解放、墨を吐いて逃げる）。
  - 天候：新規 `src/game/weather.ts`（日数から決定的に決定、再抽選なし）。出現倍率0.75〜1.35（0にはならない）、光と霞に反映（`environment.ts`）。朝は女将さんが天気を言う（その朝は LORE は進まない）。食堂の状態行と船の日付表示にも天気。
  - セーブキーは `blue-depths-save-v1` のまま。追加は `LandSave.bait`（餌の手持ち回数）のみ（無い＝0として扱う）。
  - テストフック追加：`spreadStats` / `curiousState` / `callCurious` / `giveBait` / `dropBait` / `baitInfo` / `placeOcto` / `octo` / `weather` / `setWeather` / `weatherMult`。
  - 検証：`npm run artifact` 通過。Playwright（`dive/scripts/probe-phase4.cjs`、HTTP 配信＋charset 指定で読むこと。artifact は meta charset を含まないので file:// 直読みは文字化けする）で確認：魚のいないサンゴ 58%→11〜12%、4種以上のマス 19→7〜11・最大種数 11→5〜6（計測方法の差と実行ごとのばらつきあり）、イルカ追従→32秒で離脱・距離拡大、餌3種で寄る種が分離・上限10匹3種・手持ち減算、餌ボタンの重なりなし（縦横）、撮影（3m ok／霞距離 murky／霞の向こう null／洞窟の暗所 8m 候補外・3m dark）、タコ（絡み・−3bar・継続減少・連打で脱出）、天候倍率の範囲と変化、食堂（朝の天気の一言・状態行の天気・餌の棚・購入で+3回分と −¥300）。ページエラー 0。暗所だけの切り分けは `dive/scripts/probe-phase4-dark.cjs`。
  - 注意：headless の swiftshader は 1fps 未満のことがある。プローブはプロローグを閉じてからゲームを止め、`creatures.update` / `updateDiver` を手で進める方式。静止種はメッシュ未生成だと `findTarget` の対象外（実機では接近時に生成されるので問題なし。テストで配置する場合は本拠地で生成してから運ぶ）。
- Phase 3 までの状態（前回の引き継ぎ）：
  - トラッカー **Phase 3（依頼・イベント・報酬・光景）を実装・確認した**。設計は `dive/docs/PHASE3-DESIGN.md`（決定の正）。
    - 編集長：章クリアで報酬は自動加算せず `save.storyClaim` に積み、ボートの章カードの「報酬 ¥◯ を受け取る」で受け取る（失効なし、進行は止めない）。第3章・第7章に「Sを取るコツ」、その章の間は撮影直後に足りない点を一言。第4章は「夜の魚を撮る」。
    - 掲示板：「やめる」で同じ依頼が掲示板の先頭に戻る。掲示板＋受注中＝3枠で、達成で1件 NEW 付き追加。手銛があれば「しおさい亭の注文 ◯件」＋「しおさい亭へ」。島民の依頼は食堂へ移さない（確認点L）。
    - 海中：ウミガメは60秒後から10秒ごと5%・連続ダイブで出ない。円のある依頼は円の中だけ残り時間表示と減少。ウミガメはそばでシャッター→ナイフを3回振ると救出。
    - 新マップ通知：専用バナー `#map-found`（キュー）。`save.visited` で判定。
    - 光景：金色の円、初回報酬 pay × 1/3、2回目以降は 1/7×0.2。
    - 写真スポット：`src/game/spots.ts` の9か所（¥300〜2,000）。最初の1回だけ（`save.spots`）。
  - セーブキーは `blue-depths-save-v1` のまま。追加 `storyClaim` / `visited` / `spots` / `Quest.fresh`。
  - 検証：`npm run artifact` 通過、Playwright で各項目を確認（詳細は git 履歴と PHASE3-DESIGN）。

## 次の一手
- Phase 6（ダイビングシステム・水深・エア・アクティビティ）の設計・実装（Muse が基本。分担は 2026-11-25 夜の合意：設計・実装とも Muse が基本、難しい新規システムの設計だけ Opus、各フェーズのマージ前に Sonnet の読み取り専用レビューを1回挟む）。Phase が終わったら次の Phase も続けて進める（ユーザー指示）。
- アーティファクト更新は節目のみで、動作確認は GitHub Pages のビルド済み単体ファイル（https://adazakuraa.github.io/game/dive/play.html 。セーブはアーティファクト版と別。旧 /game/dive/ はソース表示のみでゲームは動かない）で行う。フェーズごとに `npm run artifact` → `dist/artifact.html` を `dive/play.html` にコピーして main へ push する。

## 判断待ち事項
- Phase 1（PHASE1-DESIGN §9）：A ウニ漁後の夜／D 掲示板の解禁時期。（B は Phase 3 で結論→確認点L、C は Phase 2 で確定）
- Phase 2（PHASE2-DESIGN §6）：F「魚の数」＝図鑑の全種数／G ライト待ちで第4章が止まる／H 中盤＝45・60種／I シグナルフロート（仮）／J 装備価格・依頼報酬は据え置き。（E は Phase 3 で見直し）
- Phase 3（PHASE3-DESIGN §8）：K 円の外では時間も止める／L 島民の依頼は食堂へ移さない／M 写真スポットの場所・額は仮／N 光景の初回 1/3／O 夜の魚＝魚の仲間だけ／P ウミガメの頻度は仮。
- Phase 4（PHASE4-DESIGN §8）：Q 他の環境は既存種の個体数・群れ数で増やす（新種は Phase 12）／R 餌の価格・上限・時間は仮／S 食性は名前の語で判定／T 好奇心の30秒は全16種共通／U タコの被害は仮／V 天候は日数から決定・割合と倍率は仮／W 天候の演出は光と霞のみ。
- Phase 5（PHASE5-DESIGN §8）：X 地図にブルーホールの円とセノーテの点は出す／Y 地図の南の外は島の浜と陸／Z 遺跡の沈没船3隻は動かさない／AA 限定装備の効果は仮／AB 手記は出現率を上げない／AC マリンスノーは深海120m〜だけ／AD ラグーンの sandSpots 種は直さない／AE ヒカリキンメダイ二重登録は Phase 12／AF 図鑑に5マップを追加／AG 固有種10種の数え方・ブルーホールの移動先・ピラミッド寸法は仮。
- まとめはリポジトリルートの `要確認事項.md`、実機で見てほしい点は `ユーザ確認リスト.md`。

## アーティファクト
- Version 25（Phase 3 まで）。Phase 4・5 は未反映（節目にまとめて更新する）。
- https://claude.ai/artifact/WFpZNDxWq6nFYMsetBYKjk
