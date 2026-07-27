#!/usr/bin/env bash
# Drive skill-creator's eval tooling against this repo's eval sets.
#
# skill-creator's scripts must run as modules from ITS directory (`python -m
# scripts.x`), and its path is session-specific, so this wrapper locates it once
# and does the path bookkeeping. It does not run the cases themselves — spawning
# the executor/grader subagents is the model's job (see evals/README.md).
#
#   ./evals/run-eval.sh layout   <skill> [iteration]  # create the workspace tree
#   ./evals/run-eval.sh benchmark <skill> [iteration] # aggregate grading.json -> benchmark.json
#   ./evals/run-eval.sh view      <skill> [iteration] # build the static review HTML
#   ./evals/run-eval.sh trigger   <skill>             # description-triggering loop (needs `claude` CLI)
#
# SKILL_CREATOR_DIR overrides autodiscovery.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMD="${1:-}"; SKILL="${2:-}"; ITER="${3:-1}"

usage() { sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
[[ -z "$CMD" || -z "$SKILL" ]] && usage

EVAL_DIR="$ROOT/evals/$SKILL"
[[ -d "$EVAL_DIR" ]] || { echo "no eval set at $EVAL_DIR" >&2; exit 2; }
WS="$EVAL_DIR/workspace/iteration-$ITER"

find_skill_creator() {
  if [[ -n "${SKILL_CREATOR_DIR:-}" ]]; then echo "$SKILL_CREATOR_DIR"; return; fi
  # The plugin ships skill-creator under a session-scoped path; take the newest.
  local base="$HOME/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin"
  local hit
  hit="$(find "$base" -maxdepth 4 -type d -name skill-creator 2>/dev/null | head -1 || true)"
  [[ -n "$hit" ]] || { echo "skill-creator not found — set SKILL_CREATOR_DIR" >&2; exit 3; }
  echo "$hit"
}

case "$CMD" in
  layout)
    # One directory per eval id, each with a with_skill and a baseline run. The
    # baseline is the same prompt without the skill — it is what makes a pass
    # rate mean anything, since a case Claude passes unaided measures nothing.
    ids=$(python3 -c "
import json;print(' '.join(str(e['id']) for e in json.load(open('$EVAL_DIR/evals.json'))['evals']))")
    for id in $ids; do
      for cfg in with_skill without_skill; do
        mkdir -p "$WS/eval-$id/$cfg/outputs"
      done
      python3 - "$EVAL_DIR/evals.json" "$WS/eval-$id/eval_metadata.json" "$id" <<'PY'
import json, sys
src, dst, eid = sys.argv[1], sys.argv[2], int(sys.argv[3])
e = next(x for x in json.load(open(src))['evals'] if x['id'] == eid)
json.dump({"eval_id": eid,
           "eval_name": f"{eid}-{'-'.join(e['prompt'].split()[:4]).lower().strip('.,:')}",
           "prompt": e['prompt'],
           "assertions": e.get('expectations', [])}, open(dst, 'w'), indent=2)
PY
    done
    echo "laid out $WS for ids: $ids"
    echo "next: spawn one executor subagent per eval id per config, then grade -> grading.json"
    ;;
  benchmark)
    SC="$(find_skill_creator)"
    ( cd "$SC" && python3 -m scripts.aggregate_benchmark "$WS" --skill-name "$SKILL" )
    echo "wrote $WS/benchmark.json + benchmark.md"
    ;;
  view)
    SC="$(find_skill_creator)"
    OUT="$WS/review.html"
    prev="$EVAL_DIR/workspace/iteration-$((ITER-1))"
    args=( "$WS" --skill-name "$SKILL" --static "$OUT" )
    [[ -f "$WS/benchmark.json" ]] && args+=( --benchmark "$WS/benchmark.json" )
    [[ -d "$prev" ]] && args+=( --previous-workspace "$prev" )
    ( cd "$SC" && python3 eval-viewer/generate_review.py "${args[@]}" )
    echo "open $OUT"
    ;;
  trigger)
    command -v claude >/dev/null || {
      echo "the trigger loop shells out to 'claude -p' and the CLI is not on PATH." >&2
      echo "install: npm i -g @anthropic-ai/claude-code" >&2; exit 3; }
    SC="$(find_skill_creator)"
    ( cd "$SC" && python3 -m scripts.run_loop \
        --eval-set "$EVAL_DIR/trigger-eval.json" \
        --skill-path "$ROOT/plugins/proactive-jupi/skills/$SKILL" \
        --model "${EVAL_MODEL:-claude-opus-5}" --max-iterations 5 --verbose )
    ;;
  *) usage ;;
esac
