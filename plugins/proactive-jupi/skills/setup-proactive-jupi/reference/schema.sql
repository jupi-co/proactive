-- Proactive-Jupi backlog store — Neon Postgres.
-- Applied by the setup skill (step 5). Idempotent.
--
-- Three tables: TASKS (the backlog), ACTIONS (units of execution), and
-- CRAWL_STATE (update-brain's cursor). There is no decision_registry: the
-- canonical decision + its lifecycle (STARTED → FINALIZED → EXECUTED) live in
-- Jupi. The "pile" is just the gated action rows — each carries the Jupi
-- decision/option it depends on and the executable instruction in its
-- description.
--
-- ── TENANCY ───────────────────────────────────────────────────────────
-- Every row carries `user_id` — the tenant key. **Jupi is the reference for
-- identity:** `user_id` is the authenticated caller's Jupi user id, resolved
-- once at setup and cached as `jupiUserId` in `.claude/setup.local.json`. The
-- SAME id keys the brain's Supermemory container tag (`user_<jupiUserId>`), so
-- Jupi, Neon, and Supermemory share one identity with nothing to reconcile.
-- Each workspace also gets its own project-scoped connection string (a
-- *physical* boundary); `user_id` is the *row-level* boundary that lets a
-- shared DB — the "matches Jupi's own Postgres, scale to a partner with no
-- migration" path — separate users cleanly. The driver connects with a
-- full-privilege conn string, so EVERY query the skills issue MUST filter by
-- `user_id` (isolation is enforced in the queries, not by the grant).

create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- ── TASKS ─────────────────────────────────────────────────────────────
-- The backlog. One row = one unit of input (from a signal via the parser).
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,                       -- tenant key = Jupi user id
  short_label     text not null,                       -- <20-word summary
  summary         text not null,                       -- standalone long description (no overlap with Facts)
  signal_ref      text,                                -- source signal id (gmail msg, linear issue, slack ts…)
  signal_type     text,                                -- gmail | calendar | linear | slack | github | drive
  status          text not null default 'candidate'
                    check (status in ('candidate','open','done','dropped')),
  impact          text check (impact in ('low','medium','high')),
  confidence      text check (confidence in ('low','medium','high')),
  score           numeric,                             -- derived priority, for ORDER BY
  relevant_facts  jsonb not null default '[]',         -- [{summary, source}] — context refs
  open_questions  jsonb not null default '[]',         -- [{uncertainty_pct, description}] — candidate decisions
  gating_decision_ids uuid[] not null default '{}',    -- Jupi decision ids this task's actions wait on; the poll fetches these
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
-- Backlog queries always scope to one user, then ORDER BY score.
create index if not exists tasks_user_status_score_idx on tasks (user_id, status, score desc);

-- ── ACTIONS ───────────────────────────────────────────────────────────
-- Units of execution. ONE task can fan out into several parallel actions.
-- An action is either:
--   • immediate       — decision_id null → act now (confident + low-risk, or a rule authorizes it)
--   • decision-gated  — decision_id + option_id set → executes ONLY if that Jupi option is the one selected
-- On finalize: actions matching the selected option execute; siblings on other options are skipped.
-- `user_id` is denormalized from the parent task so action queries filter by
-- tenant directly (no join) and RLS can apply uniformly.
create table if not exists actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,                         -- tenant key = Jupi user id (== parent task's)
  task_id       uuid not null references tasks(id) on delete cascade,
  decision_id   uuid,                                  -- Jupi decision gating this action; null = act immediately
  option_id     uuid,                                  -- Jupi option this action realizes (execute iff selected)
  tool          text not null,                         -- where the action runs
  description   text not null,                         -- the executable action-instruction ("send email to X saying Y")
  rule_ref      text,                                  -- business rule (Jupi) that justified acting, if any
  risk          text check (risk in ('low','high')),   -- internal/reversible vs external/sensitive
  confidence    text check (confidence in ('low','medium','high')),
  status        text not null default 'candidate'
                  check (status in ('candidate','pending_decision','executed','skipped')),
  trace_ref     text,                                  -- execution trace on the signal (slack msg, email id…)
  created_at    timestamptz not null default now(),
  executed_at   timestamptz
);
create index if not exists actions_user_task_idx     on actions (user_id, task_id);
create index if not exists actions_user_status_idx   on actions (user_id, status);
create index if not exists actions_user_decision_idx on actions (user_id, decision_id);

-- ── CRAWL_STATE ───────────────────────────────────────────────────────
-- update-brain's incremental cursor. One row per (user, source): the crawler
-- only ingests content NEWER than last_cursor, then advances it. This is our
-- dedup + credit control on the Supermemory connector (which has no customId):
-- we never re-read or re-ingest the same window twice. The PK is (user_id,
-- source) — without user_id in the key, `source='gmail'` would collide across
-- users in a shared DB and one user's cursor would suppress another's crawl.
create table if not exists crawl_state (
  user_id      text not null,         -- tenant key = Jupi user id
  source       text not null,         -- 'gmail' | 'calendar' | 'linear' | finer key
  last_cursor  text,                  -- last-ingested marker (ISO timestamp / id / page token)
  last_run_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, source)
);

-- ── OPTIONAL HARDENING: Row-Level Security ────────────────────────────
-- Filtering by user_id in every query is sufficient for the single-writer
-- skill model. If a DB is ever genuinely shared, layer RLS for defense-in-depth
-- (enable per table; policy `user_id = current_setting('app.user_id', true)`;
-- driver runs `set app.user_id = $1` at connect) so a forgotten WHERE can't
-- leak rows. Deferred — see IMPLEMENTATION-PLAN Phase 6.
