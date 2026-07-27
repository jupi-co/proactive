#!/usr/bin/env bash
# Purge every Supermemory memory in a container tag — eval teardown.
# Reads SUPERMEMORY_API_KEY from the gitignored .env at the repo root (never committed).
# This is a dev-tooling key: the runtime pipeline uses the Supermemory MCP connector and
# never needs it, so it stays OUT of .proactive-jupi/config.local.json — that file gets
# mirrored into unattended/cloud run CWDs, and shipping an admin key there is needless
# secret propagation.
# Usage: bash evals/update-brain/purge-scratch.sh [containerTag]   (default: user_eval_scratch)
set -euo pipefail

TAG="${1:-user_eval_scratch}"
ROOT="$(git rev-parse --show-toplevel)"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
KEY="${SUPERMEMORY_API_KEY:-}"
[ -n "$KEY" ] || { echo "ERROR: no SUPERMEMORY_API_KEY in $ROOT/.env (get a key from app.supermemory.ai)" >&2; exit 1; }

echo "Purging Supermemory container tag: $TAG"
curl -sS -X DELETE "https://api.supermemory.ai/v3/documents/bulk" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"containerTags\": [\"$TAG\"]}"
echo
echo "done."
