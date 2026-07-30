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
//       json: impact, relevance, bottleneck ('low'|'medium'|'high'), parse_confidence?
//       ('low'|'medium'|'high', default 'high'). urgency + score computed here from the
//       row's signal_at/external/deadline (§ scoring model below), and status → 'open'.
//   query-window    [K]                             → [ {task}, … ]  (default K from BACKLOG_WINDOW_SIZE or 30)
//   list-open-refs  <signal_type>                   → [ {signal_type, signal_ref, status}, … ]
//   decision-url    <groupSlug|-> <title> <id>      → { url }   (no DB; '-' = config.jupiWorkspace)
//   ── Phase 3: the actions queue + status writes ──
//   insert-action   '<json>'                        → { id, status }   (act-or-decide, Stage 4)
//       json: task_id, tool, description, exposure ('low'|'high' → stored in `risk`),
//             decision_id?, option_id? (provenance for a settled option), rule_ref?, status? (default 'ready')
//   set-action-status <id> <status> [trace_ref]     → { id, status }   (act-or-decide: 'ready'→'executed' after the worker runs it — Phase 4)
//   set-task-status   <id> <status>                 → { id, status }   (act-or-decide: open→blocked|done|dropped · act-post-decision: blocked→done|open)
//   set-task-gating   <task_id> '<uuid[] json>'     → { id, gating_decision_ids }   (act-or-decide, Stage 5)
//   list-actions      <status|decision> <value>     → [ {action}, … ]  (act-or-decide reads status='ready'; the 'decision' branch is deprecated — Phase 4)
//   list-blocked                                    → [ {task}, … ]    (act-post-decision poll: blocked tasks + gating_decision_ids)
//   ── Routine run records: the only thing a routine writes about itself ──
//   run-open        <routine>                       → { id, routine, started_at, status }
//   run-close       <id> <ok|degraded|failed> ['<degraded json>'] [notes]
//                                                   → { id, status, … }
//       degraded json: [{what, cost}] — what was unreachable and what it cost the user
//   run-last        <routine> [N]                   → [ {run, stalled}, … ] (newest first)
//   get-cursor      <consumer> <source> [eval]      → { consumer, source, is_eval, last_cursor, last_run_at } | null
//   advance-cursor  <consumer> <source> <cursor> [eval] → { consumer, source, is_eval, last_cursor }
//     consumer = 'brain' | 'backlog'; pass a truthy 4th/3rd arg ('eval'|'true'|'1') for eval runs.
//   ── The crawl frontier: what to look up next (crawl_state is the visited set) ──
//   push-frontier   '<json>'                        → { id, kind, entity, … } | { deduped: true }
//       json: note (required — the WHY + source), kind? ('entity'|'voice'|'topic', default
//             'entity'), entity?, source_ref?, pushed_by?, is_eval?
//       Refuses at `frontierMaxPending` (default 50) → { capped: true, pending, cap } — an
//       unbounded queue buries the items that mattered under the ones that merely occurred.
//   list-frontier   [N] [eval]                      → [ {id, kind, entity, note, …}, … ] (oldest first)
//   close-frontier  <id> <done|dropped>             → { id, kind, entity, status }
//   frontier-stats  [days] [eval]                   → { pending, pushed_recent, drained_recent, growth_ratio, verdict }
//   list-dropped    [days] [N]                      → [ {task}, … ]  (drops, newest first — the
//       evidence base for a `[BR] When X, do nothing` rule; defaults 90 days / 50 rows)
//
// Config resolution — connection string + tenant id (first hit wins):
//   1. $NEON_CONN_STRING / $DATABASE_URL  and  $JUPI_USER_ID  (the sanctioned path
//      for scheduled / cloud runs, where the repo isn't on the container's fs)
//   2. walk up from cwd looking for .proactive-jupi/config.local.json
//      → "neonConnString" / "jupiUserId"
// The same walk also captures the NEAREST config object whole, so the tunables below
// (`scoring`, `jupiWorkspace`) are read from it even when the credentials came from env.
// A SCHEDULED routine has no repo on its container, so it carries its config in its own
// prompt and writes it to ./.proactive-jupi/config.local.json before doing anything —
// path 2 then resolves normally and the tunables travel with it. That file is scratch,
// not state: it is derived from the prompt and dies with the container, which is why a
// routine can be re-created from setup alone and why nothing here reads durable state
// off a disk that may not exist.
// Keys beginning with `_` in that file are documentation and are never read.
// EVERY verb is scoped by user_id = jupiUserId — the Jupi-resolved tenant key
// (setup step 2). Isolation is enforced in the queries, not by the DB grant.
//
// Output: JSON on stdout. Errors: JSON {error} on stderr, exit 1.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_WINDOW = Number(process.env.BACKLOG_WINDOW_SIZE) || 30;
// How many pending frontier items before pushes are refused (config:
// `frontierMaxPending`). Sized so a full queue is still drainable in a handful of
// normal runs — a cap you can never work off is the same as no cap, just later.
const DEFAULT_FRONTIER_CAP = 50;

// ── Scoring model ─────────────────────────────────────────────────────────
//   score = impact^Wi · relevance^Wr · urgency · bottleneck^Wb · parse_factor
//     (product: any low axis tanks it)
//   urgency = 1 + 2·max(staleness, deadline_u), continuous 1..3, recomputed each run:
//     staleness  = 1 − exp(−age_days / T),  T = turnaround{External,Internal}Days
//     deadline_u = 1 if a hard deadline is ≤ deadlineGuardDays away (can't be buried),
//                  else clamp((deadlineHorizonDays − days_to_deadline) / deadlineHorizonDays, 0, 1)
//
// EVERY constant below is a DEFAULT, overridable per-install from the `scoring` block of
// .proactive-jupi/config.local.json — retuning the model must never require a code edit.
// The defaults are the retuned curve: a deadline inside the working week pins urgency,
// and deadlines start pulling three weeks out. The pre-retune 7/2 pair ranked a hard
// cutoff five days away BELOW an untouched thread nobody had answered in a month, because
// at 4.8 days out it scored (7 − 4.8)/7 = 0.32 while pure staleness had already reached
// ~0.95. Commitment should outrank rot; that is what these numbers encode.
const LEVEL = { low: 1, medium: 2, high: 3 };
const SCORING_DEFAULTS = {
  deadlineHorizonDays: 21, // days out at which a deadline starts pulling urgency up
  deadlineGuardDays: 5, // a hard deadline this close pins urgency to max
  turnaroundExternalDays: 2, // expected turnaround — you owe external counterparties a faster reply
  turnaroundInternalDays: 5,
  weights: { impact: 1, relevance: 1, bottleneck: 1 }, // per-axis exponents
  parseConfidenceFloor: 0.6, // multiplier for a task whose parse the Scorer flagged shaky
};

// Merge the config `scoring` block over the defaults. Shallow per key, one level deep for
// `weights`, so an install can override a single dial without restating the whole model.
function scoringModel() {
  const s = (loadWorkspaceConfig() || {}).scoring || {};
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    deadlineHorizonDays: num(s.deadlineHorizonDays, SCORING_DEFAULTS.deadlineHorizonDays),
    deadlineGuardDays: num(s.deadlineGuardDays, SCORING_DEFAULTS.deadlineGuardDays),
    turnaroundExternalDays: num(s.turnaroundExternalDays, SCORING_DEFAULTS.turnaroundExternalDays),
    turnaroundInternalDays: num(s.turnaroundInternalDays, SCORING_DEFAULTS.turnaroundInternalDays),
    parseConfidenceFloor: num(s.parseConfidenceFloor, SCORING_DEFAULTS.parseConfidenceFloor),
    weights: {
      impact: num(s.weights?.impact, SCORING_DEFAULTS.weights.impact),
      relevance: num(s.weights?.relevance, SCORING_DEFAULTS.weights.relevance),
      bottleneck: num(s.weights?.bottleneck, SCORING_DEFAULTS.weights.bottleneck),
    },
  };
}

// Continuous urgency in [1,3] from the observed facts, evaluated at `now`.
export function computeUrgency({ signal_at, external, deadline }, now, model = scoringModel()) {
  const DAY = 86400000;
  let staleness = 0;
  if (signal_at) {
    const age = Math.max(0, (now - new Date(signal_at)) / DAY);
    const T = external ? model.turnaroundExternalDays : model.turnaroundInternalDays;
    staleness = 1 - Math.exp(-age / T);
  }
  let deadlineU = 0;
  if (deadline) {
    const dtl = (new Date(deadline) - now) / DAY;
    const H = model.deadlineHorizonDays;
    deadlineU = dtl <= model.deadlineGuardDays ? 1 : Math.max(0, Math.min(1, (H - dtl) / H));
  }
  return 1 + 2 * Math.max(staleness, deadlineU);
}

// How much a shaky parse discounts the score. A misread signal should sink, not vanish —
// the Parser's reading can be wrong while the underlying signal still matters, so this
// demotes rather than suppresses. `high` (the default) costs nothing.
function parseFactor(level, model) {
  const floor = Math.max(0, Math.min(1, model.parseConfidenceFloor));
  if (level === "low") return floor;
  if (level === "medium") return (1 + floor) / 2;
  return 1;
}

const clean = (v) => (v && !String(v).includes("<") ? v : null);

// The nearest .proactive-jupi/config.local.json walking up from cwd, parsed once.
// Returns null when there is none (env-only runs) — every caller must tolerate that.
let _workspaceConfig; // undefined = not looked up yet; null = looked up, none found
function loadWorkspaceConfig() {
  if (_workspaceConfig !== undefined) return _workspaceConfig;
  let dir = process.cwd();
  _workspaceConfig = null;
  for (let i = 0; i < 8; i++) {
    const p = join(dir, ".proactive-jupi", "config.local.json");
    if (existsSync(p)) {
      try {
        _workspaceConfig = JSON.parse(readFileSync(p, "utf8"));
      } catch (e) {
        throw new Error(`${p} is not valid JSON (${e.message}). Note it is parsed strictly — '//' comments are not allowed; the '_'-prefixed keys in the template are the comment convention.`);
      }
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return _workspaceConfig;
}

function loadConfig() {
  const cfg = loadWorkspaceConfig() || {};
  const connString = process.env.NEON_CONN_STRING || process.env.DATABASE_URL || clean(cfg.neonConnString);
  const userId = process.env.JUPI_USER_ID || clean(cfg.jupiUserId);
  if (!connString)
    throw new Error("no Neon connection string: set $NEON_CONN_STRING or add neonConnString to .proactive-jupi/config.local.json");
  if (!userId)
    throw new Error("no tenant id: set $JUPI_USER_ID or add jupiUserId to .proactive-jupi/config.local.json (setup step 2 resolves it)");
  return { connString, userId };
}

// ── Decision permalinks (C7) ──────────────────────────────────────────────
// The ONE slugifier in the codebase. No Jupi MCP tool returns a decision URL today —
// `get-decision` returns `source.url`, which is the decision's ORIGIN (a meeting
// transcript, a thread), not the decision. So every consumer would otherwise
// reconstruct the permalink, and every copy would drift the day Jupi changes slugging.
// Slug rule, validated against live digest URLs: lowercase → every char outside
// [a-z0-9] → '-' → collapse runs → trim. Non-ASCII becomes a hyphen rather than being
// dropped, so "Guénard" → "gu-nard".
//
// Two known limits, both inherent to reconstructing rather than being told:
//   · it silently breaks if Jupi changes its slug rule;
//   · it yields a stale (though usually still-resolving) URL once a title is edited.
// The fix is upstream — have the Jupi tools return the url, or groupSlug + slug.
// Tracked in TECH-459. When it lands, delete this pair and the `decision-url` verb,
// and have the skills read `url` off the tool result instead.
export function slugifyDecisionTitle(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function decisionUrl(groupSlug, title, id) {
  const slug = slugifyDecisionTitle(title);
  return `https://jupi.co/${groupSlug}/decision/${slug ? `${slug}-` : ""}${id}`;
}

async function getDb() {
  // The Neon serverless driver talks HTTP via the global `fetch`, which only
  // exists on Node ≥18. On older Node it fails deep in the driver with a cryptic
  // "fetch is not defined" — catch it here with an actionable message instead.
  // (package.json also declares "engines": { "node": ">=18" }.)
  if (typeof fetch === "undefined") {
    throw new Error(
      `Neon's serverless driver needs a global fetch, absent on Node ${process.version}. ` +
        `Use Node ≥18 (e.g. \`nvm use 20\`) before running the routines.`,
    );
  }
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
  const raw = neon(cfg.connString);
  // Wrap at the driver so EVERY verb inherits the retry — a scheduled routine has
  // nobody to re-run it, so a transient blip is an unattended run lost.
  return { sql: { query: (text, params) => withRetry(() => raw.query(text, params)) }, userId: cfg.userId };
}

// ── Transient-fault retry ─────────────────────────────────────────────────
// Neon over HTTPS occasionally returns a DNS/socket-level failure that succeeds
// moments later (observed live: `503 DNS resolution failure` mid-session, fine on
// the next attempt). Interactively that's a shrug; inside a routine it's the run,
// gone — and with no human watching, silently. So retry the faults that are
// genuinely transient and let everything else fail immediately: a constraint
// violation or a bad credential will not fix itself, and retrying it just delays
// an error the caller needs to see.
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

function isTransient(e) {
  const m = String(e?.message || e).toLowerCase();
  return /dns|fetch failed|network|socket|econnreset|etimedout|enotfound|eai_again|\b(502|503|504)\b|timed? ?out/.test(m);
}

async function withRetry(fn) {
  let last;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || attempt === RETRY_ATTEMPTS) throw e;
      last = e;
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
    }
  }
  throw last;
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

  // Write the LLM judgments (impact/relevance/bottleneck/parse_confidence), COMPUTE
  // urgency + score from the row's observed facts, and promote candidate → open.
  async "score-task"(sql, [id, jsonArg], userId) {
    const s = JSON.parse(jsonArg);
    const cur = await sql.query(
      `select signal_at, external, deadline from tasks where id = $1 and user_id = $2`,
      [id, userId],
    );
    if (!cur[0]) return { id: null, error: "no such task for this user" };
    const model = scoringModel();
    const parseConfidence = s.parse_confidence ?? "high";
    const urgency = computeUrgency(cur[0], new Date(), model);
    const score =
      LEVEL[s.impact] ** model.weights.impact *
      LEVEL[s.relevance] ** model.weights.relevance *
      LEVEL[s.bottleneck] ** model.weights.bottleneck *
      urgency *
      parseFactor(parseConfidence, model);
    const rows = await sql.query(
      `update tasks
          set impact = $3, relevance = $4, bottleneck = $5, parse_confidence = $8,
              urgency = $6, score = $7, status = 'open', updated_at = now()
        where id = $1 and user_id = $2
      returning id`,
      [id, userId, s.impact, s.relevance, s.bottleneck, round2(urgency), round2(score), parseConfidence],
    );
    return {
      id: rows[0].id,
      urgency: round2(urgency),
      score: round2(score),
      parse_confidence: parseConfidence,
    };
  },

  // The top window act-or-decide reads. NULL scores sort last.
  // The tiebreak is deterministic on purpose: two tasks at an identical score used to
  // come back in whatever order the planner happened to see, so the TOP of the backlog
  // — the part that actually gets worked — was arbitrary and unreproducible between
  // runs. Soonest real deadline first, then the one whose ball has been in the user's
  // court longest, then id as a total order so the sequence is stable.
  async "query-window"(sql, [k], userId) {
    const limit = Number(k) || DEFAULT_WINDOW;
    return sql.query(
      `select id, short_label, summary, signal_type, signal_ref, signal_url,
              signal_at, external, deadline,
              impact, relevance, bottleneck, parse_confidence, urgency, score,
              relevant_facts, open_questions, gating_decision_ids
         from tasks
        where user_id = $1 and status = 'open'
        order by score desc nulls last,
                 deadline asc nulls last,
                 signal_at asc nulls last,
                 id asc
        limit $2`,
      [userId, limit],
    );
  },

  // Build a decision permalink without touching the DB (§ Decision permalinks).
  // groupSlug '-' means "use config.jupiWorkspace" — the common case.
  async "decision-url"(_sql, [groupSlug, title, id]) {
    const slug =
      !groupSlug || groupSlug === "-" ? clean((loadWorkspaceConfig() || {}).jupiWorkspace) : groupSlug;
    if (!slug)
      return {
        error:
          "no workspace slug: pass one as the first argument, or set jupiWorkspace in .proactive-jupi/config.local.json",
      };
    if (!id) return { error: "decision-url: usage `decision-url <groupSlug|-> <title> <id>`" };
    return { url: decisionUrl(slug, title, id) };
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
      "id, task_id, decision_id, option_id, tool, description, rule_ref, risk, status, trace_ref, created_at";
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

  // ── Crawl frontier ─────────────────────────────────────────────────────
  // The other half of the crawler. `crawl_state` is the visited set; this is the
  // frontier — what's worth looking up next, pushed by whoever tripped over it.
  // Rows are REQUESTS TO LOOK, never Facts, so pushing one doesn't make you a
  // writer of the brain (update-brain still authors everything that lands there).
  //
  // Dedup is best-effort and lives here rather than in a unique index: pushing the
  // same unknown on five consecutive runs should collapse to one row, but a unique
  // violation inside an unattended routine would fail the whole run over a
  // duplicate note. So the insert simply declines when an identical pending entity
  // is already queued, and reports `deduped: true` instead of erroring.
  async "push-frontier"(sql, [jsonArg], userId) {
    const f = JSON.parse(jsonArg);
    if (!f.note) return { id: null, error: "push-frontier: `note` is required (the WHY, with its source)" };
    const kind = f.kind ?? "entity";
    // Backpressure. A queue nothing bounds is not a queue, it is a landfill: one
    // measured 5-item brain sweep pushed 12 frontier items while a ~1/3 drain
    // budget retires under 2 per run, so pending grows ~6x faster than it falls
    // and the items that mattered end up buried under the ones that merely
    // occurred. Refusing at the cap (rather than inserting and hoping someone
    // notices) makes the pressure visible AT THE PUSH, to the skill best placed
    // to decide what is worth queueing — and the refusal is reported, never silent.
    const cap = Number((loadWorkspaceConfig() || {}).frontierMaxPending) || DEFAULT_FRONTIER_CAP;
    const [{ count: pending }] = await sql.query(
      `select count(*)::int from crawl_frontier
        where user_id = $1 and is_eval = $2 and status = 'pending'`,
      [userId, truthy(f.is_eval)],
    );
    if (pending >= cap)
      return {
        id: null,
        capped: true,
        pending,
        cap,
        entity: f.entity ?? null,
        kind,
        error:
          `frontier is full (${pending}/${cap} pending) — not queued. Drain it (update-brain full mode) ` +
          `or raise frontierMaxPending. Report this: the discovery rate is outrunning the drain rate.`,
      };
    const rows = await sql.query(
      `insert into crawl_frontier (user_id, kind, entity, note, source_ref, pushed_by, is_eval)
       select $1, $2, $3, $4, $5, $6, $7
        where $3::text is null
           or not exists (
             select 1 from crawl_frontier
              where user_id = $1 and is_eval = $7 and status = 'pending'
                and kind = $2 and lower(entity) = lower($3))
       returning id, kind, entity, status, created_at`,
      [
        userId,                       // $1
        kind,                         // $2
        f.entity ?? null,             // $3
        f.note,                       // $4
        f.source_ref ?? null,         // $5
        f.pushed_by ?? "unknown",     // $6
        truthy(f.is_eval),            // $7
      ],
    );
    return rows[0] ?? { id: null, deduped: true, entity: f.entity, kind };
  },

  // What update-brain drains at the top of a `full` run, oldest first. FIFO on
  // purpose: an item pushed three runs ago has been waiting three runs, and a
  // frontier that keeps serving the newest push is one where old gaps never close.
  async "list-frontier"(sql, [limitArg, isEval], userId) {
    const limit = Math.min(Number(limitArg) || 20, 200);
    return sql.query(
      `select id, kind, entity, note, source_ref, pushed_by, created_at
         from crawl_frontier
        where user_id = $1 and is_eval = $2 and status = 'pending'
        order by created_at asc
        limit $3`,
      [userId, truthy(isEval), limit],
    );
  },

  // Spend a frontier item: `done` (looked at it — whether or not it yielded a Fact)
  // or `dropped` (not worth it / no longer meaningful). Both take it out of the
  // queue; the split is so a drainer that keeps dropping items is visible.
  async "close-frontier"(sql, [id, status], userId) {
    if (!["done", "dropped"].includes(status))
      throw new Error(`close-frontier status must be done|dropped, got '${status}'`);
    const rows = await sql.query(
      `update crawl_frontier
          set status = $3, drained_at = now()
        where id = $1 and user_id = $2
      returning id, kind, entity, status`,
      [id, userId, status],
    );
    return rows[0] ?? { id: null, error: "no such frontier item for this user" };
  },

  // Is the frontier keeping up? `pending` alone can't tell you: a steady 40 looks
  // identical whether nothing is being pushed and nothing drained, or twelve are
  // pushed and twelve drained every run. The drained/pushed split over a recent
  // window is what says whether the queue is converging, and it is what update-brain
  // sizes its frontier budget from.
  async "frontier-stats"(sql, [daysArg, isEval], userId) {
    const days = Math.min(Number(daysArg) || 7, 365);
    const [row] = await sql.query(
      `select
         count(*) filter (where status = 'pending')::int as pending,
         count(*) filter (where status = 'done'    and drained_at > now() - make_interval(days => $3))::int as drained_recent,
         count(*) filter (where status = 'dropped' and drained_at > now() - make_interval(days => $3))::int as dropped_recent,
         count(*) filter (where created_at > now() - make_interval(days => $3))::int as pushed_recent,
         min(created_at) filter (where status = 'pending') as oldest_pending
       from crawl_frontier
      where user_id = $1 and is_eval = $2`,
      [userId, truthy(isEval), days],
    );
    const cap = Number((loadWorkspaceConfig() || {}).frontierMaxPending) || DEFAULT_FRONTIER_CAP;
    const retired = row.drained_recent + row.dropped_recent;
    return {
      ...row,
      window_days: days,
      cap,
      // >1 means the queue is growing. Named rather than left to the caller so two
      // skills can't disagree about which direction "healthy" is.
      growth_ratio: retired > 0 ? round2(row.pushed_recent / retired) : row.pushed_recent > 0 ? null : 0,
      verdict:
        row.pending >= cap ? "full — pushes are being refused"
        : retired === 0 && row.pushed_recent > 0 ? "growing, nothing drained"
        : row.pushed_recent > retired ? "growing"
        : "keeping up",
    };
  },

  // The negative memory's evidence base. A task ruled "nothing to do" is `dropped`
  // and leaves the window — which is right, but it also means the SAME recurring
  // noise gets re-parsed, re-scored and re-investigated from scratch every run,
  // because nothing accumulates across the drops. This read is what lets
  // act-or-decide notice "I have dropped this same shape four times" and propose a
  // `[BR] When X, do nothing` rule. Recurrence for ordinary rules is counted from
  // settled Jupi decisions; drops never reach Jupi, so they are counted here.
  async "list-dropped"(sql, [daysArg, limitArg], userId) {
    const days = Math.min(Number(daysArg) || 90, 730);
    const limit = Math.min(Number(limitArg) || 50, 500);
    return sql.query(
      `select id, short_label, summary, signal_type, signal_ref, closed_at
         from tasks
        where user_id = $1 and status = 'dropped'
          and closed_at > now() - make_interval(days => $2)
        order by closed_at desc
        limit $3`,
      [userId, days, limit],
    );
  },

  // ── Routine run records ────────────────────────────────────────────────
  // A scheduled routine's only self-report. Open before doing anything, close on
  // the way out; `run-last` is what lets a run say "the previous one failed"
  // instead of starting clean as if nothing had happened.
  async "run-open"(sql, [routine], userId) {
    const rows = await sql.query(
      `insert into routine_runs (user_id, routine) values ($1, $2)
       returning id, routine, started_at, status`,
      [userId, routine],
    );
    return rows[0];
  },

  // status: ok | degraded | failed. `degraded` is [{what, cost}] in the user's
  // terms — the run's report is written from it, so "slack" alone is not enough:
  // what the user lost ("couldn't see mentions") is the half that means anything.
  async "run-close"(sql, [id, status, degradedJson, notes], userId) {
    if (!["ok", "degraded", "failed"].includes(status))
      throw new Error(`run-close status must be ok|degraded|failed, got '${status}'`);
    // `-` is the documented placeholder for "nothing degraded, but I do have notes"
    // — positional args leave no way to skip one. Without this it reaches the
    // ::jsonb cast as the literal string and the close fails, which loses the run
    // record for exactly the runs most worth recording: the ones that failed.
    const degraded = degradedJson && degradedJson !== "-" ? degradedJson : null;
    if (degraded) {
      try {
        JSON.parse(degraded);
      } catch {
        throw new Error(
          `run-close degraded must be JSON like '[{"what":"Slack","cost":"couldn't see mentions"}]' — got ${degradedJson}`,
        );
      }
    }
    const rows = await sql.query(
      `update routine_runs
          set finished_at = now(), status = $3,
              degraded = coalesce($4::jsonb, degraded), notes = coalesce($5, notes)
        where id = $1 and user_id = $2
       returning id, routine, started_at, finished_at, status, degraded, notes`,
      [id, userId, status, degraded, notes && notes !== "-" ? notes : null],
    );
    if (!rows[0]) throw new Error(`no routine_runs row ${id} for this tenant`);
    return rows[0];
  },

  // The previous run for a routine. `stalled` is the inference the caller would
  // otherwise re-derive: still 'running' long after it started means it died or
  // was interrupted, not that it is working — no routine runs for hours.
  async "run-last"(sql, [routine, limitArg], userId) {
    const limit = Math.min(Number(limitArg) || 1, 20);
    const rows = await sql.query(
      `select id, routine, started_at, finished_at, status, degraded, notes
         from routine_runs where user_id = $1 and routine = $2
        order by started_at desc limit $3`,
      [userId, routine, limit],
    );
    const STALL_MS = 2 * 60 * 60 * 1000;
    return rows.map((r) => ({
      ...r,
      stalled: r.status === "running" && Date.now() - Date.parse(r.started_at) > STALL_MS,
    }));
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

// Verbs that touch no database. Routing these around getDb() keeps them usable in the
// one place they're most needed — a run that has a title and an id in hand but no Neon
// credentials (a dry-run report, a cloud session, a skill formatting a link).
const PURE_VERBS = new Set(["decision-url"]);

async function main() {
  const [verb, ...args] = process.argv.slice(2);
  const fn = VERBS[verb];
  if (!fn) {
    process.stderr.write(
      JSON.stringify({ error: `unknown verb '${verb}'`, verbs: Object.keys(VERBS) }) + "\n",
    );
    process.exit(1);
  }
  const { sql, userId } = PURE_VERBS.has(verb) ? { sql: null, userId: null } : await getDb();
  const out = await fn(sql, args, userId);
  process.stdout.write(JSON.stringify(out) + "\n");
}

// Only run the CLI when invoked as one. The scoring + permalink helpers above are
// exported so a Node consumer can `import` them without the CLI firing on import.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((e) => {
    process.stderr.write(JSON.stringify({ error: String(e.message || e) }) + "\n");
    process.exit(1);
  });
}
