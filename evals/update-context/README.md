# update-context — eval workflow (repeatable)

Two eval layers, both isolated so they never pollute real Facts.

## Isolation — never touch real state
- **Scratch container tag `user_eval_scratch`** — all eval writes go here, never the real `user_<userId>`. The skills never read this tag.
- **`full`-mode runs also isolate the Neon cursor:** use eval-prefixed `crawl_state.source` keys (e.g. `gmail-eval`) so real cursors aren't advanced. (`targeted`-mode runs don't touch cursors.)
- **Teardown — one command:** `bash evals/update-context/purge-scratch.sh [tag]` (default `user_eval_scratch`). Bulk-deletes the container via the Supermemory HTTP API, reading the key from the gitignored `.claude/setup.local.json`. **Run it after every behavioral eval.**

## 1. Triggering eval — does the skill fire on the right prompts?
- Set: [`trigger-eval.json`](trigger-eval.json) — 10 should-trigger + 10 should-not (near-misses vs setup / act-and-decide / search-decisions).
- Run (needs the `claude` CLI; no side effects — only tests triggering), from the skill-creator dir:
  ```
  python -m scripts.run_loop \
    --eval-set <repo>/evals/update-context/trigger-eval.json \
    --skill-path <repo>/plugins/proactive-jupi/skills/update-context \
    --model claude-opus-4-8 --max-iterations 5 --verbose
  ```

## 2. Behavioral eval — does the skill produce good Facts?
- Set: [`behavioral-tasks.json`](behavioral-tasks.json).
- Per task, run the skill against the **scratch tag** and check: entity-centric Facts, **provenance inline**, retrievable via `recall`, and a good summary.
- **Blind version** (skill-creator): spawn with-skill vs baseline subagents per task, grade, then `generate_review.py` for the viewer. Point every write at `user_eval_scratch`.
- **Always run `purge-scratch.sh` when done.**

## Known Supermemory findings (connector), verified 2026-07-21
- **`forget` is unreliable** — needs ≥0.85 similarity to Supermemory's *rewritten* stored form and there is no delete-by-id → correction/deletion is **HTTP-API-only** (that's what `purge-scratch.sh` uses).
- **`save` is async-rewritten/retitled** and extracted into *multiple* memories (one test: 4 saved docs → 11 memories).
