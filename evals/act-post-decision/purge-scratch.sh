#!/usr/bin/env bash
# Purge act-post-decision eval state from Neon — eval teardown.
# Deletes tasks whose signal_ref is prefixed 'eval:' (their actions cascade via the
# FK on delete cascade). Reads neonConnString from the gitignored
# .proactive-jupi/config.local.json. Run after any behavioral case.
# NOTE: fixture Jupi decisions used by these evals are NOT purged here (they live in
# Jupi, not Neon) — use a scratch Jupi workspace and archive stray eval decisions by hand.
# Usage: bash evals/act-post-decision/purge-scratch.sh
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
console.log('deleted eval tasks:', t.length, '(their actions cascaded)');
"
echo "done."
