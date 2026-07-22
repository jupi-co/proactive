-- Proactive-Jupi backlog store — Neon Postgres.
-- Applied by the setup skill (step 4). Idempotent.
--
-- Three tables: TASKS (the backlog), ACTIONS (units of execution), and
-- CRAWL_STATE (update-brain's cursor). There is no decision_registry: the
-- canonical decision + its lifecycle (STARTED → FINALIZED → EXECUTED) live in
-- Jupi. The "pile" is just the gated action rows — each carries the Jupi
-- decision/option it depends on and the executable instruction in its
-- description.
--
-- ── TENANCY ───────────────────────────────────────────────────────────
-- Every row carries `user_id` — the tenant key. It is the SAME identity the
-- brain keys on: `whoAmI.userId` (the value update-brain turns into the
-- Supermemory container tag `user_<userId>`), so one identity spans Neon +
-- Supermemory with nothing to reconcile. Today each workspace still gets its
-- own project-scoped connection string (a physical boundary); `user_id` is the
-- row-level boundary that lets a shared DB — the "matches Jupi's own Postgres,
-- scale to a partner with no migration" path — separate users cleanly. EVERY
-- query the skills issue MUST filter by `user_id`; the driver connects with a
-- full-privilege conn string, so isolation is enforced in the queries (and,
-- optionally, RLS — see the note at the bottom), not by the grant.

create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- ── TASKS ─────────────────────────────────────────────────────────────
-- The backlog. One row = one unit of input (from a signal via the parser).
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,                       -- tenant key = whoAmI.userId
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
  user_id       text not null,                         -- tenant key = whoAmI.userId (== parent task's)
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
  user_id      text not null,         -- tenant key = whoAmI.userId
  source       text not null,         -- 'gmail' | 'calendar' | 'linear' | finer key
  last_cursor  text,                  -- last-ingested marker (ISO timestamp / id / page token)
  last_run_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, source)
);

-- ── MIGRATION (existing DBs) ──────────────────────────────────────────
-- `create table if not exists` never alters a table that already exists, so a
-- DB created before tenancy keeps the old shape. These steps converge it
-- idempotently. The column is added NULLABLE (an unconditional add always
-- succeeds); the setup skill, which holds whoAmI.userId at runtime, then
-- backfills existing rows and enforces NOT NULL — see setup SKILL step 5:
--
--   alter table tasks       add column if not exists user_id text;
--   alter table actions     add column if not exists user_id text;
--   update tasks   set user_id = $1 where user_id is null;   -- $1 = whoAmI.userId
--   update actions set user_id = $1 where user_id is null;
--   alter table tasks   alter column user_id set not null;
--   alter table actions alter column user_id set not null;
--
-- crawl_state's PK change is handled the same way (add column, backfill, then
-- rebuild the PK to (user_id, source)); on the dogfood single-user DB there is
-- one implicit tenant, so the backfill is a single value. Fresh installs skip
-- all of this — the create-table statements above already have the final shape.
alter table if exists tasks       add column if not exists user_id text;
alter table if exists actions     add column if not exists user_id text;
alter table if exists crawl_state add column if not exists user_id text;
-- crawl_state's PK rebuild to (user_id, source) is left to setup: it must
-- backfill user_id first (a bare `source` PK still holds until then), so on a
-- pre-tenancy DB setup runs, after the backfill:
--   alter table crawl_state drop constraint crawl_state_pkey;
--   alter table crawl_state add primary key (user_id, source);
--   alter table crawl_state alter column user_id set not null;

-- ── OPTIONAL HARDENING: Row-Level Security ────────────────────────────
-- The queries filter by user_id, which is sufficient for the single-writer
-- skill model. For defense-in-depth in a shared DB, enable RLS and have the
-- driver set `app.user_id` per session so a forgotten WHERE can't leak rows:
--
--   alter table tasks       enable row level security;
--   alter table actions     enable row level security;
--   alter table crawl_state enable row level security;
--   create policy tenant_isolation on tasks
--     using (user_id = current_setting('app.user_id', true));
--   -- (repeat per table; driver runs `set app.user_id = $1` at connect)
--
-- Deferred until a DB is genuinely shared — see IMPLEMENTATION-PLAN Phase 6.
