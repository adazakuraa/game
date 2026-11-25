# BLUE DEPTHS 残作業（設計）

対象: /home/user/game/dive。ブランチ ccr-2bee8574-gjeaau（origin/main から作り直し済み）。コミット・push・ブランチ操作はしない。

## 1. オキザヨリの突進が当たってエア −8bar になることを確認（直す必要があれば直す）
実装: `src/life/creatures.ts` 1025〜1075 行付近（aggro の mode 0→1→2、`ag.kind === 'light'`）、`NIGHT`（261 行）、`Game.ts` の `handleEncounters`（hit で `this.air -= bite`）。
- 既知の小さなバグ: mode 2 で `ag.kind === 'light' && !this.lightOn` のとき mode=3 にするが、そのまま下の else（突進・hit 判定）に落ちて同じフレームで hit を出しうる。light が消えたらその分岐で処理を終える（else-if にする）よう直す。
- **決定的なテスト**で確認する（前回は実時間の Playwright が遅くて当たる前に止まった）。Playwright でゲームを起動し（`npx vite --port 5190 --host 127.0.0.1` をバックグラウンド、swiftshader 引数: `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`、参考スクリプト: /tmp/claude-0/-home-user-game/735f118a-3008-55dc-97a6-992b6baae810/scratchpad/surf.cjs）、`window.__THREE_GAME_TEST_HOOKS__.game`（Game インスタンス、private も JS からは触れる）を使って:
  1. 夜のダイブ状態にする（`setState` の候補やテストフックを確認。夜は `env.night=1`, `creatures.night=true`、ライト所持 `save.owned` に 'torch'、`env.lightOn=true`。水深 3m 程度、ラグーン）。必要なら `setPausedForScreenshot(true)` などで実時間ループを止めて、`page.evaluate` 内で **固定 dt=1/30 のループ**（例 300 ステップ）で `game.creatures.lightOn = true; game.creatures.update(dt, cam.position, game.vel, dir)` → `game.handleEncounters()` を手動で回す（ループが止まっていないと二重更新になるので、止め方を Game.tick を見て決める。updateDiver が handleEncounters を呼ぶ場所も確認）。
  2. オキザヨリ（id `okizayori`）の 1 個体を aggro=true にしてダイバーの 8m 先に置く（agent の p を直接設定、group absent=false）。
  3. mode が 0→1→2 と進み、hit イベントが出て `game.air` がちょうど 8 減ることを確認（前後の値をログ）。toast 文言「オキザヨリのくちばしが刺さった！ エア −8bar」も確認。
  4. 突進中（mode 2）にライトを消したら hit せず mode 3 になることも同様に確認。
  - 当たらない場合は原因（目標点・速度上限・y のクランプ・resolveSphere・距離しきい値 `def.size*0.45+0.55` など）を特定して直す。
- このテストは `dive/tests/` などに残す必要はない（scratchpad に置く）。ただし後で再利用しやすいよう、テストフックに `okizayoriTest()` のような関数を足すのは可（任意）。

## 2. ヒカリキンメダイの光景を予定どおりに（30 匹＋点滅）
- `story.ts` の `flashlight`（star `hikarikinme`, n 30）。staging は `Math.min(S.n, rt.agents.length)` なので、`species5.ts` 91 行 `hikarikinme` の個体数 12 → **30** にする（f() ヘルパーの引数の意味を確認。群れ数は必要に応じて調整）。昼の出現が多少増えるのは許容。
- **点滅**: 現在の発光は `creatures.ts` の halo（`THREE.Points`、`PointsMaterial` で opacity 一律、558〜576 行、`writeInstance` 645 行で位置を書く）。個体ごとに点滅させる:
  - SpeciesDef の `mat` に `blink?: true` を追加（species.ts の型と、species5 の f() / species9 の F() が mat にどう渡しているか確認）。`hikarikinme` と洞窟の `hikarikinme2` の両方に付ける。
  - blink の種は halo geometry に `color` 属性（Float32Array count*3）を持たせ、`PointsMaterial({ vertexColors: true, ... })`。加算合成なので黒＝消灯。
  - `writeInstance` で halo 位置と一緒に色を書く: `k = blink(time, a.ph)`、color = glow 色 × k。点滅パターン: 個体ごとの周期 1.2〜2.6s（a.ph から決定）、周期の約 25% の間だけ消える（発光器を回転させて隠す動き）。縁は 0.08s 程度でなめらかに。全員がばらばらに瞬くように位相をずらす。color 属性の `needsUpdate` を position と同じ場所で立てる。
  - 光の位置: 体の中心ではなく目の下の発光器に。`lureOffset`（angler で使っている仕組み）と同様に、体の前方・やや下にオフセット（目安 `(0, -0.03, 0.35)` を体長スケールで、前方が +z か確認）。
  - 体の発光（シェーダの uGlowCol）は一律のままでよい。halo の点滅で十分明滅して見えればよい。暗い夜の海で見て分かるか、halo のサイズ（今 size*2 で 0.4）を必要なら少し大きく。
- 確認: Playwright で夜にして flashlight の光景を開始し（前回のエージェントは `game.scenes.start(['flashlight'], pos)` 相当で確認した）、近く（3〜5m）から見て **staged 個体が 30** であること（`creatures.stage.get('hikarikinme').length`）、スクリーンショットを時間をずらして 2〜3 枚撮り、点いている光の位置が変わる（点滅している）ことを目視。洞窟の hikarikinme2 にもエラーがないこと。

## 3. 共通
- `npm run build`（tsc 込み）と `npm run artifact` が通る。コンソールエラーなし。
- `dive/README.md` / `dive/DESIGN.md` に短く追記（DESIGN は「原則 → 問題 → 直したこと」形式。例: 演出の約束を守る → 光景名は「明滅」なのに光らない・数が少ない → 30 匹・個体ごとの点滅）。オキザヨリの修正があればそれも。
- スクリーンショットは /tmp/claude-0/-home-user-game/735f118a-3008-55dc-97a6-992b6baae810/scratchpad/shots2/ に。
