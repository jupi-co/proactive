#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
fail=0

for manifest in plugins/*/.claude-plugin/plugin.json; do
  [ -e "$manifest" ] || continue
  plugin_dir="$(dirname "$(dirname "$manifest")")"

  # 1) manifest is valid JSON and has a name
  if ! python3 -c "import json,sys;d=json.load(open('$manifest'));sys.exit(0 if d.get('name') else 1)" 2>/dev/null; then
    echo "ERROR: $manifest — invalid JSON or missing 'name'"; fail=1
  fi

  # 2) no angle-bracket XML tags in any skill description (Cowork rule)
  while IFS= read -r skill; do
    desc="$(awk '/^---/{c++; next} c==1' "$skill" \
            | awk '/^[A-Za-z_]+:/{f=($1=="description:")} f')"
    if printf '%s' "$desc" | grep -qE '<[^ >]+>'; then
      echo "ERROR: ${skill}: description contains XML-like tag(s):"
      printf '%s\n' "$desc" | grep -nE '<[^ >]+>'
      fail=1
    fi
  done < <(find "$plugin_dir/skills" -name SKILL.md 2>/dev/null)
done

[ "$fail" -eq 0 ] && echo "validation OK" || { echo "validation FAILED"; exit 1; }
