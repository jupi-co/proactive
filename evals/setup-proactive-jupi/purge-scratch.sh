#!/usr/bin/env bash
# Purge setup-proactive-jupi eval state — eval teardown.
#
# Setup writes into its CWD, so the bulk of teardown is removing the scratch
# workspace you ran it in. Cases 1-9 (prelude only) leave nothing else behind.
# A case-10 full run additionally creates: Neon rows (via refresh-backlog),
# Supermemory facts (via update-brain), and two scheduled routines.
#
# Usage: bash evals/setup-proactive-jupi/purge-scratch.sh <scratch-workspace-path>
set -euo pipefail

WS="${1:-}"
if [[ -z "$WS" ]]; then
  echo "usage: $0 <scratch-workspace-path>" >&2; exit 2
fi

# Refuse to delete anything that isn't a throwaway: a scratch workspace lives
# under a temp dir and must not be the real repo. Deleting the user's actual
# workspace is the one unrecoverable mistake this script could make.
ROOT="$(git rev-parse --show-toplevel)"
WS_ABS="$(cd "$WS" && pwd)"
case "$WS_ABS" in
  /tmp/*|/private/var/folders/*|/var/folders/*) : ;;
  *) echo "refusing: '$WS_ABS' is not under a temp dir — pass the mktemp -d path you ran the eval in" >&2; exit 2 ;;
esac
if [[ "$WS_ABS" == "$ROOT" || "$ROOT" == "$WS_ABS"/* ]]; then
  echo "refusing: '$WS_ABS' contains the real repo" >&2; exit 2
fi

echo "scratch workspace: $WS_ABS"
[[ -d "$WS_ABS/.proactive-jupi" ]] && echo "  (had .proactive-jupi/ — setup ran here)"
rm -rf "$WS_ABS"
echo "removed scratch workspace."

cat <<'NOTE'

Case 10 (full run) also leaves state OUTSIDE the workspace. Clear it by hand:
  - Scheduled routines  — delete `proactive-jupi-refresh-brain` and
                          `proactive-jupi-act-and-decide` in the scheduler you ran under
                          (list them first; they use stable, cadence-free taskIds).
  - Neon rows           — bash evals/refresh-backlog/purge-scratch.sh
                          (deletes tasks with signal_ref like 'eval:%'; only meaningful
                          if the run's fixtures were eval-prefixed)
  - Supermemory facts   — NOT reversible from here. See evals/update-brain/README.md;
                          prefer a scratch container tag if you run case 10 often.
NOTE
