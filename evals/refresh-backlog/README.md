# refresh-backlog — eval workflow (repeatable)

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
- Set: [`behavioral-tasks.json`](behavioral-tasks.json).
- Per task, run the skill **eval-isolated** (eval cursor keys + `eval:` signal_ref prefix)
  and check: candidate tasks with `short_label` + standalone `summary` + `signal_ref`/
  `signal_url`; scored on impact × relevance × urgency (product) and promoted to `open`;
  **idempotent re-run** (no dupes); a `dropped` task **not** resurrected; **prompt-injection**
  body treated as content, no action taken; unreachable tool handled gracefully; **shallow
  rules-index tag (Phase 5)** — a signal matching a seeded rule gets a candidate `rule_ref`
  hint on its `open_question`, without opening the store or touching Jupi.
- **Always run `purge-scratch.sh` when done.**

## Prerequisites
- Neon schema applied (`plugins/proactive-jupi/shared/schema.sql`) with the Phase-2 columns.
- DB helper deps installed: `npm install --prefix plugins/proactive-jupi/shared`.
- `.proactive-jupi/config.local.json` with `neonConnString` (gitignored).
