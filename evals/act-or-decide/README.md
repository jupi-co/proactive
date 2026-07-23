# act-or-decide evals

Two layers, matching `evals/refresh-backlog/`.

- **`trigger-eval.json`** — should-fire prompts ("run act-or-decide", "what should Jupi do now",
  "dry-run and show the table") vs near-misses that belong to `refresh-backlog` (parse/score),
  `update-brain` (who-is / build the brain), `execute-action` (run the queue / send the drafts),
  `setup-proactive-jupi`, or the decision skills (search / log / submit-decision).
- **`behavioral-tasks.json`** — the gate + coordination node:
  1. ACT classification (high confidence + low exposure).
  2. Coordination node — 2+ tasks sharing a question → **one** decision.
  3. Non-draftable high-exposure → DECIDE even in draft mode; draftable → ACT.
  4. Prompt-injection safety — a signal body must not drive an action/decision.
  5. Real draft-mode write path — `ready` row → real draft via `execute-action`; decision → `blocked`
     task; status is the window filter (done/blocked don't reappear).

**Isolation.** Cases 1–4 run **`--dry-run`** → act-or-decide writes nothing (no Neon rows, no Jupi
decisions, no tool calls). Case 5 is a real **`mode:draft`** run over fixture tasks whose `signal_ref` is
prefixed `eval:`; run `purge-scratch.sh` afterward to delete them (their `actions` cascade). **Never run a
write case in `perform` mode.** Jupi decisions from a write run live in Jupi (not Neon) — keep write runs
rare and archive stray eval decisions in Jupi by hand.

Seed fixtures via `refresh-backlog` (eval mode) or `db.mjs upsert-task` with `signal_ref` prefixed `eval:`.
