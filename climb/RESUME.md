# RESUME — climb（現状サマリー。追記せず毎回書き直す）

- 現状：コジオスコ見た目仕上げ4点は実装・自動プレイ確認・アーティファクト更新（Version 19）まで完了。人の確認待ち。
- 見るファイル：`climb/design/kosciuszko-visual.md`、`climb/IMPROVEMENT_TRACKER.md`「追加依頼：コジオスコ練習ステージの見た目仕上げ」、`src/world/Environment.ts`（setDistantStyle）、`src/world/Props.ts`（buildPracticeCamp / buildPracticeSummit）
- ケルン再確認（2026-11-25）：暗くした後の色は強い雪の照り返しで一様な明るい灰色に見えていた。石ごとの明るさの幅を広げ（線形 0.22〜0.46＋わずかな暖寒）、近景・遠景のスクショで確認済み。さらに暗くすると影の面が紺〜黒になるため不採用。この修正はアーティファクト未反映（Version 19 のまま）。
- 次の一手：ユーザーの実機確認の結果を待つ。次の作業はトラッカー Phase 1〜6（すべて未着手）から選ぶ。
- 判断待ち：凍結湖を足すか／メイン・レンジをもっと目立たせるか（ユーザーの見た目確認しだい）。基準タイム調整（ユーザー）。
- 教訓：MeshStandardMaterial の白は地形シェーダの雪より暗く灰色に見える。雪の小物は弱い白の自己発光で地形に合わせる。
- 引き継ぎ：`climb/reports/2026-11-25_handoff_kosciuszko-visual.md`
