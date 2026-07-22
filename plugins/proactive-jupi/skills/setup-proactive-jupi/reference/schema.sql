-- Proactive-Jupi backlog store — Neon Postgres.
-- Applied by the setup skill (step 4). Idempotent.
--
-- Two tables: TASKS (the backlog) and ACTIONS (units of execution).
-- There is no decision_registry: the canonical decision + its lifecycle
-- (STARTED → FINALIZED → EXECUTED) live in Jupi. The "pile" is just the
-- gated action rows — each carries the Jupi decision/option it depends on
-- and the executable instruction in its description.

create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- ── TASKS ─────────────────────────────────────────────────────────────
-- The backlog. One row = one unit of input (from a signal via the parser).
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
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
create index if not exists tasks_status_score_idx on tasks (status, score desc);

-- ── ACTIONS ───────────────────────────────────────────────────────────
-- Units of execution. ONE task can fan out into several parallel actions.
-- An action is either:
--   • immediate       — decision_id null → act now (confident + low-risk, or a rule authorizes it)
--   • decision-gated  — decision_id + option_id set → executes ONLY if that Jupi option is the one selected
-- On finalize: actions matching the selected option execute; siblings on other options are skipped.
create table if not exists actions (
  id            uuid primary key default gen_random_uuid(),
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
create index if not exists actions_task_idx     on actions (task_id);
create index if not exists actions_status_idx   on actions (status);
create index if not exists actions_decision_idx on actions (decision_id);

-- ── CRAWL_STATE ───────────────────────────────────────────────────────
-- update-context's incremental cursor. One row per source: the crawler only
-- ingests content NEWER than last_cursor, then advances it. This is our dedup
-- + credit control on the Supermemory connector (which has no customId): we
-- never re-read or re-ingest the same window twice.
create table if not exists crawl_state (
  source       text primary key,      -- 'gmail' | 'calendar' | 'linear' | finer key
  last_cursor  text,                   -- last-ingested marker (ISO timestamp / id / page token)
  last_run_at  timestamptz,
  updated_at   timestamptz not null default now()
);
