# game

ブラウザで遊ぶ自作ゲーム・アプリ置き場。どれもスマホのブラウザを主な対象にしていて、**claude.ai のアーティファクト**に公開して遊んでいる。

> AI（Claude Code など）に修正や追加を頼むときの手順は [`CLAUDE.md`](CLAUDE.md) にまとめてある。ブランチの扱いも CLAUDE.md を見ること。

## 収録しているもの

| フォルダ | タイトル | 内容 | 技術 | アーティファクト | 最新コードのブランチ |
| --- | --- | --- | --- | --- | --- |
| [`climb/`](climb/) | **DEATH ZONE 8000** | 一人称の高所登山サバイバル（エベレスト南東稜・K2）。酸素・体温・ロープ・キャンプ・犬 | Three.js / TypeScript / Vite | [開く](https://claude.ai/artifact/Y6AmowkXBB8HND5EP9osHX) | `ccr-1b79a73c-q3y30y` |
| [`racing/`](racing/) | **APEX LINE** | 3D レース（GT サーキット・ラリー・ロードバイク）、ガレージで見た目カスタマイズ | Three.js / 素の JS（ES モジュール、ビルドなし） | [開く](https://claude.ai/artifact/UB1cbzTRiNqA9dTLkbRodb) | `ccr-91ff027e-e8eh53` |
| [`dive/`](dive/) | **BLUE DEPTHS** | 3D ダイビング＆写真図鑑（600 種）、銛漁と食堂、ストーリー | Three.js / TypeScript / Vite | [開く](https://claude.ai/artifact/WFpZNDxWq6nFYMsetBYKjk) | `main`（`ccr-15ad1488-xpaney` はマージ済み） |
| [`kanken/`](kanken/) | **漢検ランダム漢字** | 漢検の配当漢字をランダム表示。読み・熟語つき | 素の HTML/JS（1 ページ） | なし | `main` |

各ゲームの詳しい説明は、それぞれのフォルダの `README.md`（遊び方・仕組み）と `DESIGN.md`（設計メモ）にある。
**climb と racing は `main` の中身が古い**。最新版はそれぞれ上の表のブランチにある（2026-11-21 時点）。

## 運用のしかた

- 作業は Claude Code のクラウドセッションで行い、セッションごとに `ccr-xxxxxxxx-xxxxxx` という作業ブランチができる。
- **基本的にマージはしない。** 遊ぶのはアーティファクト（claude.ai に公開したページ）で、変更したら同じ URL のアーティファクトを更新してもらう。
- そのため「最新のコード＝最後にそのゲームを触った作業ブランチ」になる。どのブランチが最新かは CLAUDE.md の表で管理する。

## ローカルで動かす

```bash
# climb / dive（Vite）
cd climb && npm install && npm run dev     # http://127.0.0.1:5188
cd dive  && npm install && npm run dev     # http://127.0.0.1:5190

# racing / kanken（ビルド不要の静的ファイル）
python3 -m http.server 8000                # リポジトリ直下で。/racing/ と /kanken/ を開く
```
