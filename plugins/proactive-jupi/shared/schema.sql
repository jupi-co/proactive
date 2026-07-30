-- Proactive-Jupi backlog store — Neon Postgres.
-- The plugin's DB contract; applied by the setup skill (step 5). Idempotent.
--
-- Five tables: TASKS (the backlog) · ACTIONS (units of execution) · CRAWL_STATE
-- (incremental cursors, shared with update-brain) · CRAWL_FRONTIER (the queue of
-- things worth looking up, pushed by whoever trips over them) · ROUTINE_RUNS (did
-- the scheduled routine run? — the one thing a routine writes about itself).
-- There is no decision_registry: the canonical decision + its lifecycle
-- (STARTED → FINALIZED → EXECUTED) live in Jupi. The "pile" is just the
-- gated action rows — each carries the Jupi decision/option it depends on
-- and the executable instruction in its description.
--
-- ── TENANCY ───────────────────────────────────────────────────────────
-- Every row carries `user_id` — the tenant key. **Jupi is the reference for
-- identity:** `user_id` is the authenticated caller's Jupi user id, resolved
-- once at setup and cached as `jupiUserId` in `.proactive-jupi/config.local.json`. The
-- SAME id keys the brain's Supermemory container tag (`user_<jupiUserId>`), so
-- Jupi, Neon, and Supermemory share one identity with nothing to reconcile.
-- Each workspace also gets its own project-scoped connection string (a
-- *physical* boundary); `user_id` is the *row-level* boundary that lets a
-- shared DB separate users cleanly. The driver connects with a full-privilege
-- conn string, so EVERY query the skills issue MUST filter by `user_id`
-- (isolation is enforced in the queries, not by the grant). db.mjs reads
-- `jupiUserId` from config and scopes every verb by it automatically.

create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- ── TASKS ─────────────────────────────────────────────────────────────
-- The backlog. One row = one unit of input (from a signal via the parser).
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,                       -- tenant key = Jupi user id
  short_label     text not null,                       -- <20-word summary
  summary         text not null,                       -- standalone long description (no overlap with Facts)
  signal_ref      text,                                -- stable source signal id (gmail thread, linear JUP-123, cal event, slack channel:ts) — dedup + refetch key
  signal_type     text,                                -- gmail | calendar | linear | slack | github | drive
  signal_url      text,                                -- permalink to the signal, captured at parse time (clickable <a href> for Phase-3 decisions)
  status          text not null default 'candidate'
                    -- candidate → open (scored) → blocked (awaiting a decision) | done | dropped.
                    -- act-or-decide owns this column; 'blocked' is what keeps query-window
                    -- (status='open' only) from re-surfacing a task it already handled.
                    check (status in ('candidate','open','blocked','done','dropped')),
  -- observed signal facts (parser) — feed the computed urgency
  signal_at       timestamptz,                         -- when the ball entered your court (last inbound / assigned / event time) — drives urgency's age
  external        boolean not null default false,      -- counterparty outside the org — feeds urgency AND the Phase-3 risk gate
  deadline        timestamptz,                         -- hard due date if any — urgency override
  -- scorer axes (§6). score = impact · relevance · urgency · bottleneck (product: any low axis tanks it)
  impact          text check (impact in ('low','medium','high')),        -- intrinsic value of the outcome (LLM)
  relevance       text check (relevance in ('low','medium','high')),     -- is this a real, worth-surfacing task — noise gate (LLM). NOT the act-gate confidence, which lives on actions
  bottleneck      text check (bottleneck in ('low','medium','high')),    -- leverage: who/what is blocked until you do this (LLM). low = nothing waiting
  parse_confidence text not null default 'high'                          -- how sure the Parser is it READ the signal right (LLM). Discounts score; NOT relevance, NOT the act-gate confidence
                    check (parse_confidence in ('low','medium','high')),
  urgency         numeric,                             -- COMPUTED by db.mjs = 1 + 2·max(staleness, deadline_u), 1..3; refreshes each run
  score           numeric,                             -- derived priority = impact · relevance · urgency · bottleneck, for ORDER BY
  relevant_facts  jsonb not null default '[]',         -- [{summary, source}] — light Supermemory recall refs (read-only; update-brain owns writes)
  open_questions  jsonb not null default '[]',         -- [{uncertainty_pct, description}] — candidate decisions
  gating_decision_ids uuid[] not null default '{}',    -- Jupi decision ids this task's actions wait on; the poll fetches these
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
-- Backlog queries always scope to one user, then ORDER BY score.
create index if not exists tasks_user_status_score_idx on tasks (user_id, status, score desc);
-- Per-user dedup key: enables the parser's ON CONFLICT upsert. Scoped by user_id
-- so the same signal_ref can't collide across users in a shared DB. Postgres
-- allows multiple NULLs, so hand-made tasks (no signal) are unaffected.
create unique index if not exists tasks_user_signal_uniq on tasks (user_id, signal_type, signal_ref);

-- ── ACTIONS ───────────────────────────────────────────────────────────
-- Units of execution. ONE task can fan out into several parallel actions.
-- A row exists ONLY for an immediate ACT action (act-or-decide, decision_id null).
-- DECIDED actions are NOT stored here at all — they live in the Jupi decision's
-- option `Action:` lists and are run straight from Jupi by act-post-decision at
-- settle (Phase 4: no Neon materialization of what Jupi already holds).
--   decision_id/option_id: VESTIGIAL as of Phase 4 (decided actions are Jupi-only,
--                          so these are always null on the rows now written). Retained
--                          for back-compat; safe to drop in a later tidy-up.
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
  risk          text check (risk in ('low','high')),   -- EXPOSURE (Phase-3 name): draft-first, then destination/irreversibility. Column kept as `risk`.
  -- (no confidence column: confidence is a TASK-level, runtime judgment derived from
  --  open_questions each run — never stored on an action.)
  -- A row is queued the moment it exists: ready (to run) → executed. Nothing else —
  -- decided actions live in Jupi, not here. act-or-decide owns this column: it inserts
  -- `ready`, then — after the pure execute-action worker performs the side-effect and
  -- returns a trace — writes `executed` + trace_ref. The worker writes no status.
  status        text not null default 'ready'
                  check (status in ('ready','executed')),
  trace_ref     text,                                  -- execution trace on the signal (slack msg, email id…)
  created_at    timestamptz not null default now(),
  executed_at   timestamptz
);
create index if not exists actions_user_task_idx     on actions (user_id, task_id);
create index if not exists actions_user_status_idx   on actions (user_id, status);
create index if not exists actions_user_decision_idx on actions (user_id, decision_id);

-- ── CRAWL_STATE ───────────────────────────────────────────────────────
-- Incremental cursors, shared by update-brain and refresh-backlog. Each crawler
-- reads only content NEWER than last_cursor for its (user_id, consumer, source),
-- then advances it — dedup + credit control (esp. for the Supermemory connector,
-- which has no customId). Separated by explicit columns:
--   user_id  : tenant key = Jupi user id (without it, 'gmail' collides across users)
--   consumer : which crawler owns the cursor — 'brain' | 'backlog'
--   source   : the tool — 'gmail' | 'calendar' | 'linear' | …
--   is_eval  : true for eval runs, so tests never advance real cursors
-- PK (user_id, consumer, source, is_eval): brain's gmail cursor, backlog's gmail
-- cursor, and each of their eval variants are distinct rows — no cross-eating.
--
-- Migration: crawl_state shipped in earlier shapes (single-column PK `source`,
-- then `(user_id, source)`), neither with the consumer/is_eval split. Drop iff
-- it's an OLD, EMPTY table (never drop data); the create below builds the new
-- shape. A populated legacy table would need additive alters — not a live case.
--
-- The emptiness check is NESTED rather than a third `and` on the outer condition,
-- and that is load-bearing on a FRESH database. PL/pgSQL prepares each statement
-- as a whole when it first executes it, so `select 1 from crawl_state` sitting in
-- the same IF expression gets parsed even when the earlier "does the table exist"
-- conjunct is false — SQL's `and` gives no parse-time short-circuit. On a brand-new
-- DB that raised `relation "crawl_state" does not exist` and the statement failed.
-- It was survivable only because apply-schema.mjs continues past a failed statement,
-- so every fresh install quietly reported `failed: 1`. Nesting defers the inner
-- query to a branch that is only reached once the table is known to exist.
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='crawl_state')
     and (not exists (select 1 from information_schema.columns
                      where table_name='crawl_state' and column_name='consumer')
          or not exists (select 1 from information_schema.columns
                         where table_name='crawl_state' and column_name='user_id'))
  then
    if not exists (select 1 from crawl_state) then
      drop table crawl_state;
    end if;
  end if;
end $$;
create table if not exists crawl_state (
  user_id      text not null,          -- tenant key = Jupi user id
  consumer     text not null,          -- 'brain' | 'backlog'
  source       text not null,          -- 'gmail' | 'calendar' | 'linear' | …
  is_eval      boolean not null default false,
  last_cursor  text,                   -- last-ingested marker (ISO timestamp / id / page token)
  last_run_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, consumer, source, is_eval)
);

-- ── CRAWL_FRONTIER ────────────────────────────────────────────────────
-- The frontier: what is worth looking up next, pushed by whichever skill tripped
-- over it. crawl_state is the *visited set* ("don't re-read this window"); on its
-- own that makes update-brain a crawler that only ever walks forward in time. The
-- frontier is the other half — the reason knowledge converges instead of merely
-- accumulating: act-or-decide meets an entity it can't resolve mid-plan, pushes it
-- here, and the next full brain crawl drains it as priority work.
--
-- It holds REQUESTS TO LOOK, never Facts. That keeps update-brain the single writer
-- of the brain: a pusher says "someone should find out who Batch's procurement
-- contact is", and update-brain is still the one that reads the tools and authors
-- the Fact. A row is spent once drained — this is a queue, not a knowledge store.
--   kind     : routing hint for the drainer — 'entity' (who/what is this?),
--              'voice' (how does the user write to X in channel Y?), 'topic'
--              (a subject area worth a sweep)
--   entity   : the thing to look up, when there is a nameable one. Used for
--              best-effort dedup so the same unknown pushed on five runs is one row.
--   note     : "explore X because found Y (src)" — the *why*, which is what makes a
--              drained item researchable months later by someone who wasn't there.
--   pushed_by: which skill pushed it, so a noisy pusher is visible in the data.
create table if not exists crawl_frontier (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,                       -- tenant key = Jupi user id
  kind        text not null default 'entity'
                check (kind in ('entity','voice','topic')),
  entity      text,                                -- nameable target, if any (dedup key)
  note        text not null,                       -- why it's worth looking at, with its source
  source_ref  text,                                -- where it was seen (task id, gmail thread, issue)
  pushed_by   text not null,                       -- 'act-or-decide' | 'update-brain' | 'refresh-backlog'
  status      text not null default 'pending'
                check (status in ('pending','done','dropped')),
  is_eval     boolean not null default false,      -- eval pushes never enter the real frontier
  created_at  timestamptz not null default now(),
  drained_at  timestamptz
);
-- The only read shape: this tenant's pending items, oldest first (FIFO — an item
-- pushed three runs ago has been waiting three runs).
create index if not exists crawl_frontier_user_status_idx
  on crawl_frontier (user_id, is_eval, status, created_at);
-- Dedup is done in the INSERT (db.mjs `push-frontier` guards on a pending same-entity
-- row) rather than by a unique index on purpose: a duplicate push is harmless noise,
-- but a unique violation raised inside an unattended routine is a failed run. Cheap
-- de-noising, no new failure mode.

-- ── ROUTINE_RUNS ──────────────────────────────────────────────────────
-- The ground truth for "did the routine run?". A scheduled routine leaves no
-- other trace: a run that wrote some rows and stopped is indistinguishable from
-- one still working, one that died, and one that never started because it was
-- waiting on an approval nobody saw. Three states, one observation — so each
-- routine opens a row before it does anything and closes it on the way out.
-- Reading the rows back distinguishes all of them:
--   no row for a fire time that has passed → never started (gated, or disabled)
--   started_at set, finished_at null, old   → died mid-run
--   status 'degraded'                       → ran, lost something (see `degraded`)
-- A run also READS the previous row for its routine at boot, so a run following
-- a failure says so instead of silently starting clean.
--   routine  : 'act-and-decide' | 'refresh-brain' — the two scheduled routines
--   degraded : [{what, cost}] — what was unreachable, in the USER's terms
--              ("Slack" / "couldn't see mentions"), so the report writes itself
create table if not exists routine_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,                       -- tenant key = Jupi user id
  routine      text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running'
                 check (status in ('running','ok','degraded','failed')),
  degraded     jsonb not null default '[]',
  notes        text                                 -- one line: why it failed, or what it did
);
-- The only query shape: the latest runs for one routine, one tenant.
create index if not exists routine_runs_user_routine_idx
  on routine_runs (user_id, routine, started_at desc);

-- ── MIGRATIONS ─────────────────────────────────────────────────────────
-- Idempotent reconciliation for a tasks table created before the current shape.
-- No-ops on a fresh install (columns already correct) and on re-runs.
-- `create table if not exists` above never alters an existing table, so these
-- carry each change to an already-applied instance. (user_id backfill on an
-- existing instance is left to the operator — it needs the workspace's jupiUserId.)
alter table tasks   add column if not exists user_id text;
alter table actions add column if not exists user_id text;

-- v1: confidence → relevance (misleading name on a task)
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name='tasks' and column_name='confidence')
     and not exists (select 1 from information_schema.columns
                     where table_name='tasks' and column_name='relevance') then
    alter table tasks rename column confidence to relevance;
  end if;
end $$;
alter table tasks add column if not exists signal_url text;

-- v2: scorer v2 — add bottleneck + urgency's observed inputs; urgency becomes a
-- COMPUTED numeric (db.mjs), so convert it away from the old low/med/high enum.
alter table tasks add column if not exists bottleneck text
  check (bottleneck in ('low','medium','high'));
alter table tasks add column if not exists signal_at timestamptz;
alter table tasks add column if not exists external boolean not null default false;
alter table tasks add column if not exists deadline timestamptz;
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_name='tasks' and column_name='urgency') then
    alter table tasks add column urgency numeric;
  elsif exists (select 1 from information_schema.columns
                where table_name='tasks' and column_name='urgency' and data_type <> 'numeric') then
    alter table tasks drop constraint if exists tasks_urgency_check;
    alter table tasks alter column urgency type numeric
      using (case urgency when 'low' then 1 when 'medium' then 2 when 'high' then 3 else null end);
  end if;
end $$;

-- v3 (Phase 3): widen the status CHECKs on an already-applied instance —
--   tasks: add 'blocked' (task awaiting a decision; act-or-decide parks it there).
--   actions: add 'ready' (immediate ACT, run by the execute-action worker).
-- A CHECK can only be widened by drop + re-add; drop-if-exists keeps it idempotent
-- (on a fresh install the inline CHECK above is already correct — this re-adds the
-- identical constraint, a no-op in effect). The inline name Postgres assigns to an
-- unnamed column CHECK is <table>_<column>_check.
alter table tasks   drop constraint if exists tasks_status_check;
alter table tasks   add  constraint tasks_status_check
  check (status in ('candidate','open','blocked','done','dropped'));
-- actions hold only rows that will run: ready → executed. Pending option-actions
-- live in Jupi (not Neon), so coerce any legacy rows, then narrow the CHECK + default.
update actions set status = 'ready' where status = 'candidate';
delete from actions where status in ('pending_decision','skipped');  -- redundant with Jupi
alter table actions drop constraint if exists actions_status_check;
alter table actions add  constraint actions_status_check
  check (status in ('ready','executed'));
alter table actions alter column status set default 'ready';
-- Drop the vestigial actions.confidence (Phase 2 shipped it; the Phase-3 gate reads
-- confidence at the TASK level from open_questions, never off an action row).
alter table actions drop column if exists confidence;

-- v4: parse confidence — how sure the Parser is it READ the signal correctly. Distinct
-- from `relevance` (is this a real task worth surfacing) and from the act-gate
-- confidence (do we know how to handle it). Without it a task is either in the backlog
-- at full weight or absent, so a misread signal competes on equal terms with a verified
-- one; it discounts the score instead (db.mjs § parseFactor). Defaults to 'high' so
-- every existing row keeps the weight it already had.
alter table tasks add column if not exists parse_confidence text not null default 'high';
alter table tasks drop constraint if exists tasks_parse_confidence_check;
alter table tasks add  constraint tasks_parse_confidence_check
  check (parse_confidence in ('low','medium','high'));

-- ── OPTIONAL HARDENING: Row-Level Security ────────────────────────────
-- Filtering by user_id in every query is sufficient for the single-writer skill
-- model. If a DB is ever genuinely shared, layer RLS for defense-in-depth (enable
-- per table; policy `user_id = current_setting('app.user_id', true)`; driver runs
-- `set app.user_id = $1` at connect) so a forgotten WHERE can't leak rows.
-- Deferred — see IMPLEMENTATION-PLAN Phase 6.
