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
- **Cases 6–8 (the crawler's second half):**
  - **6 · Frontier drain** — seeded `crawl_frontier` items are drained **before** the window sweep, on an
    announced frontier/window budget split, and every drained item is **closed** (`done` even when the lookup
    found nothing). An item left `pending` is one the next run pays for again; the window running first means
    a planner's evidenced gap lost to a guess about what matters.
  - **7 · Voice observation** — an observation handed over by `act-or-decide` is written **without re-reading
    the sent history**, with the date inside the sentence. Re-verifying it burns the exact cost the path
    exists to remove; grade the tool calls, not just the Fact.
  - **8 · Push on discovery** — unknowns met mid-sweep are **queued, not chased**, with notes that say where
    and why. Chasing them blows the budget on whatever was noticed first.
  - **Fixtures + teardown for 6 and 8:** seed/inspect with `db.mjs push-frontier '<json>'` (pass
    `"is_eval": true`) and `list-frontier N eval`; delete them afterwards with
    `evals/act-or-decide/purge-scratch.sh`, which clears `is_eval` frontier rows. Neon frontier rows are
    **not** covered by this directory's Supermemory purge.
- **Cases 7, 9–12 (the 2026-07-29 fixes) — each one exists because a run found the original wrong.** A voice
  profile is an ordinary `[Process]` Fact saved via the connector — no keyed store, no HTTP path, no second
  secret (that over-reach was reverted); the guard is a cheap spot-check, not special storage.
  - **7 · Hand-over agrees** — one filtered spot-check confirms it → save the `[Process]` Fact, timeless.
  - **9 · Spot-check catches a wrong hand-over** — the first version said to record a handed-over observation
    unchecked, to save the ten-message re-read. A run that re-read found it wrong on *language* and
    *sign-off*. Grade the **tool calls**: exactly one cheap filtered check, not zero and not a re-read; the
    saved Fact is what the source showed.
  - **10 · Uncheckable hand-over** — saves it anyway, but the **Fact sentence itself** says it is unchecked,
    since there is no metadata field to carry that and the prose is what a semantic reader gets.
  - **11 · Backpressure at the cap** — the frontier is bounded; a refused push must be *reported*, because a
    silent refusal is strictly worse than the unbounded queue it replaced.
  - **12 · Budget scales with the queue** — a fixed one-third against a queue growing 6× is a rule that
    guarantees non-convergence. Measured: one 5-item sweep pushed 12.
- **Blind version** (skill-creator): spawn with-skill vs baseline subagents per task, grade, then `generate_review.py` for the viewer. Point every write at `user_eval_scratch`.
- **Always run `purge-scratch.sh` when done.**

## Known Supermemory findings (connector), verified 2026-07-21
- **`forget` is unreliable** — needs ≥0.85 similarity to Supermemory's *rewritten* stored form and there is no delete-by-id → correction/deletion is **HTTP-API-only** (that's what `purge-scratch.sh` uses).
- **`save` is async-rewritten/retitled** and extracted into *multiple* memories (one test: 4 saved docs → 11 memories).
