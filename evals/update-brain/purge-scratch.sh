#!/usr/bin/env bash
# Inspect and purge Supermemory container tags — eval teardown AND real-data cleanup.
#
#   bash evals/update-brain/purge-scratch.sh                 # purge user_eval_scratch (eval teardown, immediate)
#   bash evals/update-brain/purge-scratch.sh --list           # list every tag: counts + date range
#   bash evals/update-brain/purge-scratch.sh <tag>            # DRY RUN — show what purging <tag> would remove
#   bash evals/update-brain/purge-scratch.sh <tag> --confirm   # actually delete every document under <tag>
#
# The scratch tag is disposable, so teardown stays ONE command with no prompt. Any OTHER tag is
# real data: it dry-runs first and needs --confirm. The canonical brain tag (user_<jupiUserId>
# from config) is refused outright unless --force-canonical, so a typo can't nuke the brain.
#
# --list exists because the brain is keyed by one tag, `user_<jupiUserId>`. A run that derived
# identity from somewhere else (e.g. Supermemory's whoAmI) writes a SECOND tag whose stale Facts
# then shadow the real brain. --list surfaces that split; the dry run shows what removing it takes.
#
# Reads SUPERMEMORY_API_KEY from the gitignored .proactive-jupi/.env
# (cp .proactive-jupi/.env.template .proactive-jupi/.env). Correction/deletion is HTTP-API-only —
# the connector's `forget` is unreliable and there is no delete-by-id.
#
# DELETION IS PERMANENT — there is no undo.
set -euo pipefail

SCRATCH_TAG="user_eval_scratch"
ROOT="$(git rev-parse --show-toplevel)"

[ -f "$ROOT/.proactive-jupi/.env" ] && { set -a; . "$ROOT/.proactive-jupi/.env"; set +a; }
[ -n "${SUPERMEMORY_API_KEY:-}" ] || {
  echo "ERROR: no SUPERMEMORY_API_KEY in $ROOT/.proactive-jupi/.env — run 'cp .proactive-jupi/.env.template .proactive-jupi/.env' and fill it in (key from app.supermemory.ai)" >&2
  exit 1
}

TAG=""; LIST=0; CONFIRM=0; FORCE_CANONICAL=0
for arg in "$@"; do
  case "$arg" in
    --list)            LIST=1 ;;
    --confirm)         CONFIRM=1 ;;
    --force-canonical) FORCE_CANONICAL=1 ;;
    -*)                echo "ERROR: unknown flag $arg" >&2; exit 1 ;;
    *)                 TAG="$arg" ;;
  esac
done

# Canonical tag from config, if setup has resolved jupiUserId (blank is fine — guard just can't fire).
CANONICAL="$(node -e "
try { const c = require('$ROOT/.proactive-jupi/config.local.json');
      process.stdout.write(c.jupiUserId ? 'user_' + c.jupiUserId : '') } catch { process.stdout.write('') }
")"

# Shared lister: prints '<count>\t<tag>\t<earliest>\t<latest>' per tag, or per-doc titles for one tag.
list_docs () {  # $1 = tag ("" = all), $2 = mode (tags|titles)
  TAG_FILTER="$1" MODE="$2" node --input-type=module -e '
const key = process.env.SUPERMEMORY_API_KEY, tag = process.env.TAG_FILTER;
const body = { limit: 200, ...(tag ? { containerTags: [tag] } : {}) };
const r = await fetch("https://api.supermemory.ai/v3/documents/list", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify(body) });
if (!r.ok) { console.error(`ERROR: list failed HTTP ${r.status}${r.status === 401 ? " (key invalid or revoked)" : ""}`); process.exit(1) }
const docs = (await r.json()).memories ?? [];
if (process.env.MODE === "titles") {
  const days = docs.map(d => (d.createdAt ?? "").slice(0,10)).filter(Boolean).sort();
  console.log(`COUNT\t${docs.length}\t${days[0] ?? "?"}\t${days.at(-1) ?? "?"}`);
  for (const d of docs) console.log(`TITLE\t${(d.title ?? "(untitled)").slice(0,78)}`);
} else {
  const g = {};
  for (const d of docs) for (const t of (d.containerTags?.length ? d.containerTags : ["(no tag)"])) (g[t] ??= []).push(d);
  for (const [t, ds] of Object.entries(g).sort((a,b) => b[1].length - a[1].length)) {
    const days = ds.map(d => (d.createdAt ?? "").slice(0,10)).filter(Boolean).sort();
    console.log(`${ds.length}\t${t}\t${days[0] ?? "?"}\t${days.at(-1) ?? "?"}`);
  }
}'
}

# ── --list ───────────────────────────────────────────────────────────────────
if [ "$LIST" -eq 1 ]; then
  echo "Supermemory container tags:"
  echo
  list_docs "" tags | while IFS=$'\t' read -r n t first last; do
    mark=""; [ -n "$CANONICAL" ] && [ "$t" = "$CANONICAL" ] && mark="  <- canonical (config jupiUserId)"
    range="$first"; [ "$first" != "$last" ] && range="$first -> $last"
    printf '%4s  %s%s\n        %s\n' "$n" "$t" "$mark" "$range"
  done
  [ -n "$CANONICAL" ] || echo $'\nNote: config.local.json has no jupiUserId, so no tag could be marked canonical.'
  echo
  echo "Dry-run a cleanup:  bash evals/update-brain/purge-scratch.sh <tag>"
  exit 0
fi

TAG="${TAG:-$SCRATCH_TAG}"

# ── guard: never purge the canonical brain by accident ───────────────────────
if [ -n "$CANONICAL" ] && [ "$TAG" = "$CANONICAL" ] && [ "$FORCE_CANONICAL" -eq 0 ]; then
  echo "ERROR: $TAG is the CANONICAL brain tag (config jupiUserId). Refusing." >&2
  echo "       That's the real brain, not an orphan. Pass --force-canonical only if you truly mean it." >&2
  exit 1
fi

# The scratch tag is disposable → teardown deletes with no ceremony. Anything else needs --confirm.
if [ "$TAG" = "$SCRATCH_TAG" ] || [ "$CONFIRM" -eq 1 ]; then
  echo "Purging Supermemory container tag: $TAG"
  curl -sS -X DELETE "https://api.supermemory.ai/v3/documents/bulk" \
    -H "Authorization: Bearer $SUPERMEMORY_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"containerTags\": [\"$TAG\"]}"
  echo
  # Verify — but never let a FAILED re-list masquerade as "empty". Capture status separately:
  # if the list call itself errors, say so rather than printing a reassuring zero.
  if VERIFY="$(list_docs "$TAG" titles)"; then
    LEFT="$(printf '%s\n' "$VERIFY" | grep -c '^TITLE' || true)"
    if [ "$LEFT" -eq 0 ]; then echo "done — tag is now empty."
    else echo "done, but $LEFT document(s) still present — re-run to retry."; fi
  else
    echo "delete was sent, but the verification re-list FAILED — cannot confirm the tag is empty." >&2
    echo "Re-run '--list' once the API is reachable to check." >&2
    exit 1
  fi
  exit 0
fi

# ── dry run (any non-scratch tag without --confirm) ──────────────────────────
OUT="$(list_docs "$TAG" titles)"
COUNT="$(printf '%s\n' "$OUT" | awk -F'\t' '$1=="COUNT"{print $2}')"
if [ "${COUNT:-0}" -eq 0 ]; then
  echo "No documents under $TAG — nothing to do."
  exit 0
fi
printf '%s\n' "$OUT" | awk -F'\t' '$1=="COUNT"{ r=$3; if ($3!=$4) r=$3" -> "$4; print "DRY RUN - would delete "$2" document(s) under '"$TAG"'"; print "Created: "r; print "" }'
printf '%s\n' "$OUT" | awk -F'\t' '$1=="TITLE"{ if (++n<=15) print "  - "$2 } END{ if (n>15) print "  ... and "n-15" more" }'
echo
echo "Nothing was deleted. To go ahead (PERMANENT, no undo):"
echo "  bash evals/update-brain/purge-scratch.sh $TAG --confirm"
