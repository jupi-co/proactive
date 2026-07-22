#!/usr/bin/env bash
# Purge act-and-decide eval state from Neon — eval teardown.
# Deletes tasks whose signal_ref is prefixed 'eval:' (their actions cascade via the
# FK on delete cascade). Reads neonConnString from the gitignored
# .claude/proactive-jupi.local.json. Run after the write-path behavioral eval (case 5).
# NOTE: Jupi decisions posted by a non-dry run are NOT purged here (they live in Jupi,
# not Neon) — run write cases sparingly and archive stray eval decisions in Jupi by hand.
# Usage: bash evals/act-and-decide/purge-scratch.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SHARED="$ROOT/plugins/proactive-jupi/shared"

node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { neon } from '$SHARED/node_modules/@neondatabase/serverless/index.mjs';
const cfg = JSON.parse(readFileSync('$ROOT/.claude/proactive-jupi.local.json','utf8'));
const sql = neon(cfg.neonConnString);
const t = await sql.query(\"delete from tasks where signal_ref like 'eval:%' returning id\");
console.log('deleted eval tasks:', t.length, '(their actions cascaded)');
"
echo "done."
