#!/usr/bin/env bash
# Purge refresh-backlog eval state from Neon — eval teardown.
# Deletes tasks whose signal_ref is prefixed 'eval:' and removes eval cursors
# (crawl_state rows with is_eval=true). Reads neonConnString from the
# gitignored .proactive-jupi/config.local.json. Run after every behavioral eval.
# Usage: bash evals/refresh-backlog/purge-scratch.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SHARED="$ROOT/plugins/proactive-jupi/shared"

# The driver has to resolve before the heredoc below imports it by path. Without this the script
# dies with ERR_MODULE_NOT_FOUND on any checkout that has never run a skill — which is exactly the
# state you are in when a run went wrong and you need to purge.
bash "$SHARED/ensure-deps.sh" || { echo "purge: shared deps unavailable — see above" >&2; exit 1; }

node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { neon } from '$SHARED/node_modules/@neondatabase/serverless/index.mjs';
// Config resolution mirrors db.mjs: env first (a scratch run often has no config file
// at the repo root at all — it lives in the scratch workspace), then the repo's own.
let cfg = {};
try { cfg = JSON.parse(readFileSync(process.env.PROACTIVE_CONFIG || '$ROOT/.proactive-jupi/config.local.json','utf8')); } catch {}
const conn = process.env.NEON_CONN_STRING || process.env.DATABASE_URL || cfg.neonConnString;
if (!conn) throw new Error('no connection string: set \$NEON_CONN_STRING, or \$PROACTIVE_CONFIG to the scratch config path');
// Scope every delete by tenant. The schema is shared-DB-ready: user_id is the row-level
// boundary, so an unscoped delete would purge OTHER tenants' eval rows too.
const uid = process.env.JUPI_USER_ID || cfg.jupiUserId;
if (!uid) throw new Error('no tenant id: set \$JUPI_USER_ID or jupiUserId in config.local.json');
const sql = neon(conn);
const t = await sql.query(\"delete from tasks where user_id = \$1 and signal_ref like 'eval:%' returning id\", [uid]);
const c = await sql.query('delete from crawl_state where user_id = \$1 and is_eval = true returning source', [uid]);
console.log('deleted eval tasks:', t.length, '| eval cursors:', c.length);
"
echo "done."
