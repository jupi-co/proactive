#!/usr/bin/env bash
# Purge act-or-decide eval state from Neon — eval teardown.
# Deletes tasks whose signal_ref is prefixed 'eval:' (their actions cascade via the
# FK on delete cascade). Reads neonConnString from the gitignored
# .proactive-jupi/config.local.json. Run after the write-path behavioral eval (case 5).
# NOTE: Jupi decisions posted by a non-dry run are NOT purged here (they live in Jupi,
# not Neon) — run write cases sparingly and archive stray eval decisions in Jupi by hand.
# Usage: bash evals/act-or-decide/purge-scratch.sh
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
console.log('deleted eval tasks:', t.length, '(their actions cascaded)');
"
echo "done."
