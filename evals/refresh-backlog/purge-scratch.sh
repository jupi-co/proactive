#!/usr/bin/env bash
# Purge refresh-backlog eval state from Neon — eval teardown.
# Deletes tasks whose signal_ref is prefixed 'eval:' and removes eval cursors
# (crawl_state rows with is_eval=true). Reads neonConnString from the
# gitignored .proactive-jupi/config.local.json. Run after every behavioral eval.
# Usage: bash evals/refresh-backlog/purge-scratch.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SHARED="$ROOT/plugins/proactive-jupi/shared"

node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { neon } from '$SHARED/node_modules/@neondatabase/serverless/index.mjs';
const cfg = JSON.parse(readFileSync('$ROOT/.proactive-jupi/config.local.json','utf8'));
// Scope every delete by tenant. The schema is shared-DB-ready: user_id is the row-level
// boundary, so an unscoped delete would purge OTHER tenants' eval rows too.
const uid = process.env.JUPI_USER_ID || cfg.jupiUserId;
if (!uid) throw new Error('no tenant id: set \$JUPI_USER_ID or jupiUserId in config.local.json');
const sql = neon(cfg.neonConnString);
const t = await sql.query(\"delete from tasks where user_id = \$1 and signal_ref like 'eval:%' returning id\", [uid]);
const c = await sql.query('delete from crawl_state where user_id = \$1 and is_eval = true returning source', [uid]);
console.log('deleted eval tasks:', t.length, '| eval cursors:', c.length);
"
echo "done."
