# update-brain — eval workflow (repeatable)

> **Isolation + teardown rules are shared — read [`evals/README.md`](../README.md) first.** Neon: `eval:`-prefixed rows, deleted after. Supermemory: the `user_eval_scratch` test container. Jupi: the test workspace in `JUPI_EVAL_WORKSPACE`, never the real one.

Two eval layers, both isolated so they never pollute real Facts.

## Isolation — never touch real state
- **Scratch container tag `user_eval_scratch`** — all eval writes go here, never the real `user_<userId>`. The skills never read this tag.
- **`full`-mode runs also isolate the Neon cursor:** pass the eval flag so writes land in `crawl_state` rows with `is_eval=true` (`db.mjs … get-cursor brain <source> eval` / `advance-cursor brain <source> <cursor> eval`), leaving real cursors untouched. (`targeted`-mode runs don't touch cursors.)
- **Teardown — one command:** `bash evals/update-brain/purge-scratch.sh` (defaults to `user_eval_scratch`). Bulk-deletes the container via the Supermemory HTTP API, reading `SUPERMEMORY_API_KEY` from the gitignored `.proactive-jupi/.env`. **Run it after every behavioral eval.**
  - The scratch tag purges immediately, no prompt. The same script also handles **real** tags, with guards: `--list` shows every tag with counts + dates, a non-scratch tag **dry-runs** until you add `--confirm`, and the canonical brain tag (`user_<jupiUserId>`) is refused unless `--force-canonical`.

## 1. Triggering eval — does the skill fire on the right prompts?
- Set: [`trigger-eval.json`](trigger-eval.json) — 10 should-trigger + 10 should-not (near-misses vs setup / act-or-decide / search-decisions).
- Run (needs the `claude` CLI; no side effects — only tests triggering), from the skill-creator dir:
  ```
  python -m scripts.run_loop \
    --eval-set <repo>/evals/update-brain/trigger-eval.json \
    --skill-path <repo>/plugins/proactive-jupi/skills/update-brain \
    --model claude-opus-4-8 --max-iterations 5 --verbose
  ```

## 2. Behavioral eval — does the skill produce good Facts?
- Set: [`evals.json`](evals.json).
- Per task, run the skill against the **scratch tag** and check: entity-centric Facts, **provenance inline**, retrievable via `recall`, and a good summary.
- **Cases 4–5 (2026-07-28 edit spec):**
  - **4 · Degenerate-Fact detection** — a returned Fact that is a ~2KB repeated-token loop is caught by the
    post-write screen (repeated-token ratio + length) and reported with counts. This is the one that needs
    care to grade: recall-verification **passes** on a degenerate Fact — it does come back, it's just
    garbage — so "the Facts are retrievable" is not evidence the case succeeded.
  - **5 · Provenance to the source task** — a Fact derived from a `parse_confidence: low` task names the
    originating task id and carries the hedge **inside the sentence**, so a corrected parse has a path to
    the derived Fact and the brain can't silently corroborate a misreading.
- **Blind version** (skill-creator): spawn with-skill vs baseline subagents per task, grade, then `generate_review.py` for the viewer. Point every write at `user_eval_scratch`.
- **Always run `purge-scratch.sh` when done.**

## Known Supermemory findings (connector), verified 2026-07-21
- **`forget` is unreliable** — needs ≥0.85 similarity to Supermemory's *rewritten* stored form and there is no delete-by-id → correction/deletion is **HTTP-API-only** (that's what `purge-scratch.sh` uses).
- **`save` is async-rewritten/retitled** and extracted into *multiple* memories (one test: 4 saved docs → 11 memories).
