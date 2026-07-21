#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
mkdir -p dist

TARGET="${1:-}"   # optional plugin name to scope the build
built=0

for manifest in plugins/*/.claude-plugin/plugin.json; do
  [ -e "$manifest" ] || continue
  plugin_dir="$(dirname "$(dirname "$manifest")")"   # plugins/<name>
  name="$(basename "$plugin_dir")"
  [ -z "$TARGET" ] || [ "$TARGET" = "$name" ] || continue

  out="dist/$name.zip"
  rm -f "$out"

  if git rev-parse --verify HEAD >/dev/null 2>&1 && git cat-file -e "HEAD:$plugin_dir" 2>/dev/null; then
    # Deterministic: archive the committed tree, contents at archive root.
    git archive --format=zip -o "$out" "HEAD:$plugin_dir"
  else
    # Fallback: archive the working tree deterministically.
    ( cd "$plugin_dir" && zip -rqX "$REPO_ROOT/$out" . -x '*.DS_Store' -x '__MACOSX*' )
  fi

  echo "built $out"
  built=$((built + 1))
done

[ "$built" -gt 0 ] || { echo "no plugins found under plugins/*/.claude-plugin/plugin.json" >&2; exit 1; }
