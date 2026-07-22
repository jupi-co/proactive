#!/usr/bin/env bash
# Purge refresh-backlog eval state from Neon — eval teardown.
# Deletes tasks whose signal_ref is prefixed 'eval:' and removes eval cursors
# (crawl_state rows with is_eval=true). Reads neonConnString from the
# gitignored .claude/setup.local.json. Run after every behavioral eval.
# Usage: bash evals/refresh-backlog/purge-scratch.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SHARED="$ROOT/plugins/proactive-jupi/shared"

node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { neon } from '$SHARED/node_modules/@neondatabase/serverless/index.mjs';
const cfg = JSON.parse(readFileSync('$ROOT/.claude/setup.local.json','utf8'));
const sql = neon(cfg.neonConnString);
const t = await sql.query(\"delete from tasks where signal_ref like 'eval:%' returning id\");
const c = await sql.query('delete from crawl_state where is_eval = true returning source');
console.log('deleted eval tasks:', t.length, '| eval cursors:', c.length);
"
echo "done."
