#!/usr/bin/env bash
# Proactive-Jupi — make shared/db.mjs runnable. THE authoritative dependency path.
#
# shared/package.json declares @neondatabase/serverless but no node_modules ships with
# the plugin, so invoked from its install path the driver doesn't resolve. Every skill
# used to carry its own prose version of the fix, which is how the reference run ended
# up symlinking a session's node_modules into shared/ — container-local, and gone the
# next cold scheduled run. This script is the one place that knows how to do it.
#
# Idempotent and quiet on the happy path: exits immediately if the driver already
# resolves. Safe to call at the top of every run.
#
# Usage:  bash "${CLAUDE_PLUGIN_ROOT}/shared/ensure-deps.sh"
# Exit 0 = db.mjs will run. Exit 1 = it won't, with the reason on stderr.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolves() {
  node -e 'import("@neondatabase/serverless").then(()=>process.exit(0),()=>process.exit(1))' \
    --input-type=module 2>/dev/null
}

# Node ≥18 is a hard requirement — the driver talks HTTP via the global fetch, absent
# on 16. Checking here turns a cryptic failure deep in the driver into one clear line.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "proactive-jupi: Node $(node -v 2>/dev/null || echo '?') is too old — db.mjs needs Node >=18 for the global fetch (e.g. \`nvm use 20\`)." >&2
  exit 1
fi

cd "$HERE" || exit 1

if [ -d "$HERE/node_modules/@neondatabase/serverless" ] && resolves; then
  exit 0
fi

echo "proactive-jupi: installing shared deps into $HERE …" >&2
if npm install --prefix "$HERE" --no-save --no-audit --no-fund >/dev/null 2>&1; then
  resolves && exit 0
fi

# npm egress is the usual culprit in a sandbox. The caller (a skill) is the one that can
# retry with the sandbox network disabled — that fallback is pre-authorized by setup
# step 4 — so report precisely rather than guessing at a workaround here.
echo "proactive-jupi: npm install failed in $HERE. If this is a sandboxed run, retry this same command with the sandbox network disabled (setup step 4 pre-authorizes it). Otherwise check npm egress." >&2
exit 1
