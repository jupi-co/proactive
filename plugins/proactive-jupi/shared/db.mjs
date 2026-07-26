#!/usr/bin/env node
// Proactive-Jupi — Neon data-access helper (shared).
//
// A THIN, parameterized wrapper over @neondatabase/serverless — NOT an ORM.
// schema.sql (same dir) is the authoritative schema; this file never defines it.
// Every verb uses bound parameters ($1,$2,…): signal text is untrusted data and
// must never be string-interpolated into SQL.
//
// Consumers: setup (schema apply is separate), refresh-backlog (Parser/Scorer),
// act-or-decide (planner: queue + status writes), act-post-decision (the
// post-decision loop: `list-blocked` poll + task completion). update-brain may
// adopt the crawl_state verbs to drop its inline driver access.
//
// Usage:  node db.mjs <verb> [args...]
//   upsert-task     '<json>'                        → { id, prior_status }
//       json: short_label, summary, signal_type, signal_ref, signal_url,
//             signal_at (ISO), external (bool), deadline (ISO), relevant_facts[], open_questions[]
//   score-task      <id> '<json>'                   → { id, urgency, score }
//       json: impact, relevance, bottleneck ('low'|'medium'|'high'). urgency + score computed here
//       from the row's signal_at/external/deadline (§ scoring model below), and status → 'open'.
//   query-window    [K]                             → [ {task}, … ]  (default K from BACKLOG_WINDOW_SIZE or 30)
//   list-open-refs  <signal_type>                   → [ {signal_type, signal_ref, status}, … ]
//   ── Phase 3: the actions queue + status writes ──
//   insert-action   '<json>'                        → { id, status }   (act-or-decide, Stage 4)
//       json: task_id, tool, description, exposure ('low'|'high' → stored in `risk`),
//             decision_id?, option_id? (provenance for a settled option), rule_ref?, status? (default 'ready')
//   set-action-status <id> <status> [trace_ref]     → { id, status }   (act-or-decide: 'ready'→'executed' after the worker runs it — Phase 4)
//   set-task-status   <id> <status>                 → { id, status }   (act-or-decide: open→blocked|done|dropped · act-post-decision: blocked→done|open)
//   set-task-gating   <task_id> '<uuid[] json>'     → { id, gating_decision_ids }   (act-or-decide, Stage 5)
//   list-actions      <status|decision> <value>     → [ {action}, … ]  (act-or-decide reads status='ready'; the 'decision' branch is deprecated — Phase 4)
//   list-blocked                                    → [ {task}, … ]    (act-post-decision poll: blocked tasks + gating_decision_ids)
//   get-cursor      <consumer> <source> [eval]      → { consumer, source, is_eval, last_cursor, last_run_at } | null
//   advance-cursor  <consumer> <source> <cursor> [eval] → { consumer, source, is_eval, last_cursor }
//     consumer = 'brain' | 'backlog'; pass a truthy 4th/3rd arg ('eval'|'true'|'1') for eval runs.
//
// Config resolution — connection string + tenant id (first hit wins):
//   1. $NEON_CONN_STRING / $DATABASE_URL  and  $JUPI_USER_ID  (the sanctioned path
//      for scheduled / cloud runs, where the repo isn't on the container's fs)
//   2. walk up from cwd looking for .proactive-jupi/config.local.json
//      → "neonConnString" / "jupiUserId"
// EVERY verb is scoped by user_id = jupiUserId — the Jupi-resolved tenant key
// (setup step 2). Isolation is enforced in the queries, not by the DB grant.
//
// Output: JSON on stdout. Errors: JSON {error} on stderr, exit 1.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_WINDOW = Number(process.env.BACKLOG_WINDOW_SIZE) || 30;

// ── Scoring model (all tunable) ───────────────────────────────────────────
//   score = impact^Wi · relevance^Wr · urgency · bottleneck^Wb   (product: any low axis tanks it)
//   urgency = 1 + 2·max(staleness, deadline_u), continuous 1..3, recomputed each run:
//     staleness  = 1 − exp(−age_days / T),  T = external ? T_EXTERNAL : T_INTERNAL
//     deadline_u = 1 if a hard deadline is ≤ DEADLINE_GUARD_DAYS away (can't be buried),
//                  else clamp((DEADLINE_HORIZON − days_to_deadline) / DEADLINE_HORIZON, 0, 1)
const LEVEL = { low: 1, medium: 2, high: 3 };
const W = { impact: 1, relevance: 1, bottleneck: 1 }; // per-axis exponents; bump impact to weight value higher
const T_EXTERNAL = 2; // expected turnaround (days) — you owe external counterparties a faster reply
const T_INTERNAL = 5;
const DEADLINE_HORIZON = 7; // days out at which a deadline starts pulling urgency up
const DEADLINE_GUARD_DAYS = 2; // a hard deadline this close pins urgency to max

// Continuous urgency in [1,3] from the observed facts, evaluated at `now`.
function computeUrgency({ signal_at, external, deadline }, now) {
  const DAY = 86400000;
  let staleness = 0;
  if (signal_at) {
    const age = Math.max(0, (now - new Date(signal_at)) / DAY);
    staleness = 1 - Math.exp(-age / (external ? T_EXTERNAL : T_INTERNAL));
  }
  let deadlineU = 0;
  if (deadline) {
    const dtl = (new Date(deadline) - now) / DAY;
    deadlineU = dtl <= DEADLINE_GUARD_DAYS ? 1 : Math.max(0, Math.min(1, (DEADLINE_HORIZON - dtl) / DEADLINE_HORIZON));
  }
  return 1 + 2 * Math.max(staleness, deadlineU);
}

const clean = (v) => (v && !String(v).includes("<") ? v : null);

function loadConfig() {
  let connString = process.env.NEON_CONN_STRING || process.env.DATABASE_URL || null;
  let userId = process.env.JUPI_USER_ID || null;
  let dir = process.cwd();
  for (let i = 0; i < 8 && (!connString || !userId); i++) {
    const p = join(dir, ".proactive-jupi", "config.local.json");
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      connString = connString || clean(cfg.neonConnString);
      userId = userId || clean(cfg.jupiUserId);
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!connString)
    throw new Error("no Neon connection string: set $NEON_CONN_STRING or add neonConnString to .proactive-jupi/config.local.json");
  if (!userId)
    throw new Error("no tenant id: set $JUPI_USER_ID or add jupiUserId to .proactive-jupi/config.local.json (setup step 2 resolves it)");
  return { connString, userId };
}

async function getDb() {
  let neon;
  try {
    ({ neon } = await import("@neondatabase/serverless"));
  } catch {
    throw new Error(
      "@neondatabase/serverless not installed — run `npm install` in plugins/proactive-jupi/shared (see package.json)",
    );
  }
  const cfg = loadConfig();
  // HTTP/443 driver: one statement per call, bound params via sql.query(text, params).
  return { sql: neon(cfg.connString), userId: cfg.userId };
}

// ── verbs ───────────────────────────────────────────────────────────────
const VERBS = {
  // Insert or update a task keyed on (signal_type, signal_ref). Returns the
  // prior status so the Parser can apply the reopen / no-resurrect rule (§5)
  // in-skill — the SQL layer stays policy-free.
  async "upsert-task"(sql, [jsonArg], userId) {
    const t = JSON.parse(jsonArg);
    // Param order ($1..$11) is consistent across the CTE and the INSERT.
    const rows = await sql.query(
      `with prior as (
         select status from tasks where user_id = $1 and signal_type = $4 and signal_ref = $5
       )
       insert into tasks (user_id, short_label, summary, signal_type, signal_ref, signal_url,
                          signal_at, external, deadline, relevant_facts, open_questions, status)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, false), $9, $10::jsonb, $11::jsonb, 'candidate')
       on conflict (user_id, signal_type, signal_ref) do update
         set short_label    = excluded.short_label,
             summary        = excluded.summary,
             signal_url     = coalesce(excluded.signal_url, tasks.signal_url),
             signal_at      = coalesce(excluded.signal_at, tasks.signal_at),
             external       = excluded.external,
             deadline       = coalesce(excluded.deadline, tasks.deadline),
             relevant_facts = excluded.relevant_facts,
             open_questions = excluded.open_questions,
             updated_at     = now()
       returning id, (select status from prior) as prior_status`,
      [
        userId,                                     // $1
        t.short_label,                              // $2
        t.summary,                                  // $3
        t.signal_type ?? null,                      // $4
        t.signal_ref ?? null,                       // $5
        t.signal_url ?? null,                       // $6
        t.signal_at ?? null,                        // $7
        t.external ?? null,                         // $8  (→ coalesce false)
        t.deadline ?? null,                         // $9
        JSON.stringify(t.relevant_facts ?? []),     // $10
        JSON.stringify(t.open_questions ?? []),     // $11
      ],
    );
    const r = rows[0];
    return { id: r.id, prior_status: r.prior_status ?? null };
  },

  // Write the LLM judgments (impact/relevance/bottleneck), COMPUTE urgency + score
  // from the row's observed facts, and promote candidate → open.
  async "score-task"(sql, [id, jsonArg], userId) {
    const s = JSON.parse(jsonArg);
    const cur = await sql.query(
      `select signal_at, external, deadline from tasks where id = $1 and user_id = $2`,
      [id, userId],
    );
    if (!cur[0]) return { id: null, error: "no such task for this user" };
    const urgency = computeUrgency(cur[0], new Date());
    const score =
      LEVEL[s.impact] ** W.impact *
      LEVEL[s.relevance] ** W.relevance *
      LEVEL[s.bottleneck] ** W.bottleneck *
      urgency;
    const rows = await sql.query(
      `update tasks
          set impact = $3, relevance = $4, bottleneck = $5,
              urgency = $6, score = $7, status = 'open', updated_at = now()
        where id = $1 and user_id = $2
      returning id`,
      [id, userId, s.impact, s.relevance, s.bottleneck, round2(urgency), round2(score)],
    );
    return { id: rows[0].id, urgency: round2(urgency), score: round2(score) };
  },

  // The top window act-or-decide reads. NULL scores sort last.
  async "query-window"(sql, [k], userId) {
    const limit = Number(k) || DEFAULT_WINDOW;
    return sql.query(
      `select id, short_label, summary, signal_type, signal_ref, signal_url,
              signal_at, external, deadline,
              impact, relevance, bottleneck, urgency, score,
              relevant_facts, open_questions, gating_decision_ids
         from tasks
        where user_id = $1 and status = 'open'
        order by score desc nulls last, updated_at desc
        limit $2`,
      [userId, limit],
    );
  },

  // Parser dedup pre-check: what's already on file for a source.
  async "list-open-refs"(sql, [signalType], userId) {
    return sql.query(
      `select signal_type, signal_ref, status, updated_at
         from tasks where user_id = $1 and signal_type = $2`,
      [userId, signalType],
    );
  },

  // ── Phase 3: actions queue + status writes ──────────────────────────────
  // Materialize one action row that will RUN — an immediate act, or a settled
  // decision's chosen option (at settle). Defaults to status 'ready'. `exposure` is
  // stored in the `risk` column (Phase-3 rename; DB column kept as `risk`).
  // INSERT ... SELECT guards tenant integrity: written only if task_id is this user's.
  async "insert-action"(sql, [jsonArg], userId) {
    const a = JSON.parse(jsonArg);
    const rows = await sql.query(
      `insert into actions (user_id, task_id, decision_id, option_id, tool, description, rule_ref, risk, status)
       select $1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, 'ready')
        where exists (select 1 from tasks where id = $2 and user_id = $1)
       returning id, status`,
      [
        userId,                         // $1
        a.task_id,                      // $2
        a.decision_id ?? null,          // $3
        a.option_id ?? null,            // $4
        a.tool,                         // $5
        a.description,                  // $6
        a.rule_ref ?? null,             // $7
        a.exposure ?? a.risk ?? null,   // $8  → risk column (the exposure value)
        a.status ?? "ready",            // $9  (defaults to ready — a queued action)
      ],
    );
    return rows[0] ?? { id: null, error: "no such task for this user" };
  },

  // act-or-decide owns this (Phase 4): ready → executed (+ trace_ref, executed_at),
  // written after the pure execute-action worker performs the side-effect.
  async "set-action-status"(sql, [id, status, traceRef], userId) {
    const rows = await sql.query(
      `update actions
          set status = $3,
              trace_ref = coalesce($4, trace_ref),
              executed_at = case when $3 = 'executed' then now() else executed_at end
        where id = $1 and user_id = $2
      returning id, status`,
      [id, userId, status, traceRef ?? null],
    );
    return rows[0] ?? { id: null, error: "no such action for this user" };
  },

  // act-or-decide owns this: open → blocked | done | dropped (and blocked → open on settle).
  async "set-task-status"(sql, [id, status], userId) {
    const rows = await sql.query(
      `update tasks
          set status = $3,
              updated_at = now(),
              closed_at = case when $3 in ('done','dropped') then now() else closed_at end
        where id = $1 and user_id = $2
      returning id, status`,
      [id, userId, status],
    );
    return rows[0] ?? { id: null, error: "no such task for this user" };
  },

  // Record the Jupi decisions this task's actions wait on (act-or-decide, Stage 5).
  // act-post-decision polls these (via list-blocked) to detect settled decisions.
  async "set-task-gating"(sql, [taskId, idsJson], userId) {
    const ids = JSON.parse(idsJson); // array of uuid strings
    const rows = await sql.query(
      `update tasks set gating_decision_ids = $3::uuid[], updated_at = now()
        where id = $1 and user_id = $2
      returning id, gating_decision_ids`,
      [taskId, userId, ids],
    );
    return rows[0] ?? { id: null, error: "no such task for this user" };
  },

  // The ACT queue read for act-or-decide: `list-actions status ready` (its own
  // rows to run + the orphan-sweep of `ready` rows a prior run left behind).
  // NOTE: `list-actions decision <id>` is DEPRECATED as of Phase 4 — decided
  // actions live only in Jupi now (never materialized into Neon), so nothing
  // queries actions by decision_id. Kept for back-compat; safe to delete.
  async "list-actions"(sql, [kind, value], userId) {
    const cols =
      "id, task_id, decision_id, option_id, tool, description, risk, status, trace_ref, created_at";
    if (kind === "status")
      return sql.query(
        `select ${cols} from actions where user_id = $1 and status = $2 order by created_at`,
        [userId, value],
      );
    if (kind === "decision")
      return sql.query(
        `select ${cols} from actions where user_id = $1 and decision_id = $2 order by created_at`,
        [userId, value],
      );
    return { error: "list-actions: first arg must be 'status' or 'decision'" };
  },

  // act-post-decision's poll input (Phase 4): every `blocked` task with the Jupi
  // decision ids its actions wait on, plus signal refs for the trace. The loop
  // fetches those decisions from Jupi, runs the settled ones, and completes a
  // task (`blocked → done`) once ALL its gating decisions are FINALIZED.
  async "list-blocked"(sql, [], userId) {
    return sql.query(
      `select id, gating_decision_ids, signal_type, signal_ref, signal_url, summary
         from tasks
        where user_id = $1 and status = 'blocked'
        order by updated_at`,
      [userId],
    );
  },

  async "get-cursor"(sql, [consumer, source, isEval], userId) {
    const rows = await sql.query(
      `select consumer, source, is_eval, last_cursor, last_run_at
         from crawl_state
        where user_id = $1 and consumer = $2 and source = $3 and is_eval = $4`,
      [userId, consumer, source, truthy(isEval)],
    );
    return rows[0] ?? null;
  },

  async "advance-cursor"(sql, [consumer, source, cursor, isEval], userId) {
    // Guard against advancing to a FUTURE marker. A cursor is a high-water mark of
    // *observed* content ("only read newer than this"), never a lookahead-window
    // bound — setting it ahead of now would blind the next crawl until real time
    // catches up (the calendar bug: cursor = window-end swallowed all near-term
    // activity). Only ISO-timestamp cursors are checkable; ids/page tokens pass through.
    const SKEW_MS = 5 * 60 * 1000; // tolerate small clock skew
    let effective = cursor;
    let warning = null;
    if (cursor != null) {
      const t = Date.parse(cursor);
      if (!Number.isNaN(t) && t > Date.now() + SKEW_MS) {
        effective = new Date().toISOString();
        warning = `cursor '${cursor}' is in the future — clamped to '${effective}'. A cursor marks observed content, not a lookahead bound (see shared/signal-sources.md).`;
      }
    }
    const rows = await sql.query(
      `insert into crawl_state (user_id, consumer, source, is_eval, last_cursor, last_run_at, updated_at)
       values ($1, $2, $3, $4, $5, now(), now())
       on conflict (user_id, consumer, source, is_eval) do update
         set last_cursor = excluded.last_cursor,
             last_run_at = now(),
             updated_at  = now()
       returning consumer, source, is_eval, last_cursor`,
      [userId, consumer, source, truthy(isEval), effective],
    );
    return warning ? { ...rows[0], warning } : rows[0];
  },
};

// Truthy flag for the optional eval argument (hoisted; used by the cursor verbs).
function truthy(v) {
  return v === true || v === "true" || v === "eval" || v === "1";
}

// 2-decimal rounding for stored urgency/score (hoisted).
function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const [verb, ...args] = process.argv.slice(2);
  const fn = VERBS[verb];
  if (!fn) {
    process.stderr.write(
      JSON.stringify({ error: `unknown verb '${verb}'`, verbs: Object.keys(VERBS) }) + "\n",
    );
    process.exit(1);
  }
  const { sql, userId } = await getDb();
  const out = await fn(sql, args, userId);
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((e) => {
  process.stderr.write(JSON.stringify({ error: String(e.message || e) }) + "\n");
  process.exit(1);
});
