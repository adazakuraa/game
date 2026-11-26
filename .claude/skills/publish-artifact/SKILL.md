---
name: publish-artifact
description: Build and publish (or update) the claude.ai artifact for a game in this repository (climb, racing, dive, kanken). Use at the end of a session after committing and pushing, or whenever the playable artifact needs updating.
---

# アーティファクトの公開

- 新しい URL は作らない。「0. ゲーム一覧」の表にある既存の URL を `url` に渡して上書きする。
- 別の会話で作ったアーティファクトなので、先に `Artifact` の `action: "read"` で読んでから publish する（読まずに publish すると拒否される）。

## 手順

| ゲーム | 作り方 | 公開のしかた |
| --- | --- | --- |
| climb | `cd climb && npm install && npm run build && node scripts/make-artifact.mjs dist dist/artifact.html` | `dist/artifact.html` を 1 ファイルで publish（JS/CSS をインライン化済み） |
| dive | `cd dive && npm install && npm run artifact` | `dist/artifact.html` を 1 ファイルで publish（画像も `assetsInlineLimit` でインライン化される） |
| racing | ビルドなし | **複数ファイル**で publish：`file_path` = `racing/index.html`、`files` に `style.css`・`js/**/*.js`・`vendor/three.module.min.js`・`vendor/Sky.js` を同じ相対パスで渡す（今の公開版もこの 34 ファイル構成）。`index.html` の importmap が `./vendor/three.module.min.js` を指している |
| kanken | ビルドなし | 公開するなら `kanken/index.html` ＋ `files` に `kanji-data.js`・`kanji-detail.json`（詳細は `fetch('kanji-detail.json')` で遅延読み込み） |

- dive の `play.html`（GitHub Pages 版。https://adazakuraa.github.io/game/dive/play.html ）は、アーティファクト用の出力をそのままコピーしない。`npm run artifact` の後に `node scripts/make-artifact.mjs dist dist/play.html --page`（`meta charset` と `meta viewport` が付く）を実行し、`dist/play.html` を `dive/play.html` にコピーする。アーティファクトに publish するのは `--page` を付けない `dist/artifact.html`。
- `dist/` は `.gitignore` 済み。コミットしない。
- 外部 CDN は使っていない（three は npm か `racing/vendor/` 同梱）。アーティファクトでもそのまま動く。
