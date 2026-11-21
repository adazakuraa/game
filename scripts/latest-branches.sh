#!/usr/bin/env bash
# フォルダ（ゲーム）ごとに、最新のコミットを持っているリモートブランチを表示する。
# マージせずに作業ブランチで遊ぶ運用なので、main が最新とは限らない。
# 使い方: bash scripts/latest-branches.sh [フォルダ ...]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null || echo "(fetch 失敗: ローカルの情報で表示)" >&2
dirs=("$@")
[ ${#dirs[@]} -eq 0 ] && dirs=(climb racing dive kanken CLAUDE.md)
branches=$(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v -E '^origin(/HEAD)?$')
for d in "${dirs[@]}"; do
  best=""; best_t=0; best_c=""
  for b in $branches; do
    c=$(git log -1 --format='%H' "$b" -- "$d" 2>/dev/null || true)
    [ -z "$c" ] && continue
    t=$(git log -1 --format='%ct' "$c")
    if [ "$t" -gt "$best_t" ]; then best_t=$t; best=$b; best_c=$c; fi
  done
  if [ -z "$best" ]; then echo "$d: (どのブランチにもない)"; continue; fi
  # 同じ最新コミットを含むブランチを全部並べる（どれをマージしても同じ）
  same=$(for b in $branches; do git merge-base --is-ancestor "$best_c" "$b" 2>/dev/null && echo -n "$b "; done; true)
  printf '%-10s %s  %s\n           含むブランチ: %s\n' "$d:" "$(git log -1 --format='%ci' "$best_c")" "$(git log -1 --format='%s' "$best_c")" "$same"
done
