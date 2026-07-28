# refresh-backlog — eval workflow (repeatable)

> **Isolation + teardown rules are shared — read [`evals/README.md`](../README.md) first.** Neon: `eval:`-prefixed rows, deleted after. Supermemory: the `user_eval_scratch` test container. Jupi: the test workspace in `JUPI_EVAL_WORKSPACE`, never the real one.

Two eval layers, both isolated so they never pollute the real backlog. Mirrors
`evals/update-brain/`.

## Isolation — never touch real state
- **Eval cursors:** pass the eval flag so cursor writes land in `crawl_state` rows with
  `is_eval=true` (`advance-cursor backlog <source> <cursor> eval`), leaving the real
  `backlog` cursors untouched.
- **Eval task tag:** every fixture task's `signal_ref` is prefixed `eval:` so teardown can
  find and remove exactly the eval rows.
- **Teardown — one command:** `bash evals/refresh-backlog/purge-scratch.sh` — deletes
  `tasks` with `signal_ref like 'eval:%'` and `crawl_state` rows with `is_eval=true`, via the
  project-scoped `neonConnString`. **Run it after every behavioral eval.**
- refresh-backlog is **read-only on the tools and never writes Facts**, so there's no
  Supermemory scratch to purge (unlike update-brain).

## 1. Triggering eval — does the skill fire on the right prompts?
- Set: [`trigger-eval.json`](trigger-eval.json) — 10 should-trigger + 10 should-not
  (near-misses vs `update-brain` / `act-or-decide` / setup / search-decisions).
- Run (needs the `claude` CLI; no side effects — only tests triggering), from the
  skill-creator dir:
  ```
  python -m scripts.run_loop \
    --eval-set <repo>/evals/refresh-backlog/trigger-eval.json \
    --skill-path <repo>/plugins/proactive-jupi/skills/refresh-backlog \
    --model claude-opus-4-8 --max-iterations 5 --verbose
  ```

## 2. Behavioral eval — does the skill produce a good backlog?
- Set: [`evals.json`](evals.json).
- Per task, run the skill **eval-isolated** (eval cursor keys + `eval:` signal_ref prefix)
  and check: candidate tasks with `short_label` + standalone `summary` + `signal_ref`/
  `signal_url`; scored on impact × relevance × urgency (product) and promoted to `open`;
  **idempotent re-run** (no dupes); a `dropped` task **not** resurrected; **prompt-injection**
  body treated as content, no action taken; unreachable tool handled gracefully; **shallow
  rules-index tag (Phase 5)** — a signal matching a seeded rule gets a candidate `rule_ref`
  hint on its `open_question`, without opening the store or touching Jupi; **relevance vs role** —
  two comparable threads score differently depending on whether they fall inside the
  accountabilities in `assets.md`'s *Who this is*, and a missing section degrades to
  signal-only scoring instead of stalling.
- **Cases 8–10 (2026-07-28 edit spec):**
  - **8 · Deadline extraction from prose** — "before Friday" resolved against `signal_at` (not the run
    date), a calendar event's start used as its deadline, and a dateless signal left without one rather
    than given a guess. Only 8 of 38 tasks on the reference backlog carried a deadline, which made the
    urgency model effectively staleness-only.
  - **9 · Parse confidence** — an ambiguous mid-thread signal scored `low`/`medium` and *discounted*, not
    dropped, and never conflated with `relevance`. The reference run had a misparse sitting at #4 on full
    weight, which then propagated into a Fact.
  - **10 · Deterministic tiebreak** — two runs over an exact score tie return the same order, from
    `query-window`'s SQL (score desc → deadline asc → signal_at asc → id), not from prose re-sorting.
- **Always run `purge-scratch.sh` when done.**

## Prerequisites
- Neon schema applied (`plugins/proactive-jupi/shared/schema.sql`) with the Phase-2 columns.
- DB helper deps installed: `npm install --prefix plugins/proactive-jupi/shared`.
- `.proactive-jupi/config.local.json` with `neonConnString` (gitignored).
