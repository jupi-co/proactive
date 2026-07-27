#!/usr/bin/env bash
# Purge every Supermemory memory in a container tag — eval teardown.
# Reads the API key from the gitignored .proactive-jupi/config.local.json (never committed).
# Usage: bash evals/update-brain/purge-scratch.sh [containerTag]   (default: user_eval_scratch)
set -euo pipefail

TAG="${1:-user_eval_scratch}"
ROOT="$(git rev-parse --show-toplevel)"
KEY="$(node -e "process.stdout.write(require('$ROOT/.proactive-jupi/config.local.json').supermemoryApiKey || '')")"
[ -n "$KEY" ] || { echo "ERROR: no supermemoryApiKey in .proactive-jupi/config.local.json (copy from the template)" >&2; exit 1; }

echo "Purging Supermemory container tag: $TAG"
curl -sS -X DELETE "https://api.supermemory.ai/v3/documents/bulk" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"containerTags\": [\"$TAG\"]}"
echo
echo "done."
