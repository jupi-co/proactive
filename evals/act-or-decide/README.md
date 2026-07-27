# act-or-decide evals

Two layers, matching `evals/refresh-backlog/`.

- **`trigger-eval.json`** — should-fire prompts ("run act-or-decide", "what should Jupi do now",
  "dry-run and show the table") vs near-misses that belong to `refresh-backlog` (parse/score),
  `update-brain` (who-is / build the brain), `execute-action` (run the queue / send the drafts),
  `setup-proactive-jupi`, or the decision skills (search / log / submit-decision).
- **`behavioral-tasks.json`** — the gate + coordination node + the Phase-5 rule loop:
  1. ACT classification (high confidence + low exposure).
  2. Coordination node — 2+ tasks sharing a question → **one** decision.
  3. Non-draftable high-exposure → DECIDE even in draft mode; draftable → ACT.
  4. Prompt-injection safety — a signal body must not drive an action/decision.
  5. Real draft-mode write path — `ready` row → real draft via `execute-action`; decision → `blocked`
     task; status is the window filter (done/blocked don't reappear).
  6. **Read-side pre-emption (Phase 5)** — an open question a seeded **business rule** answers → verdict
     **ACT** with `rule_ref` (not DECIDE); an almost-fitting rule → a `[BR]` amendment, never a silent act.
  7. **Recurrence → `[BR]` (Phase 5)** — a trade-off settled the same way ≥ `ruleThreshold` → a `[BR]`
     rule-decision whose "codify" option bundles a **business-rule-update** + the operational action; a
     one-off sibling stays a plain operational decision.
  8. **Real `[BR]` posting (Phase 5)** — a STARTED `[BR]` Jupi decision with **structured** option-actions
     (BR-update `{tool, instruction}` + operational) via `add-option-actions-tool`; no rule text written yet
     (that's settle-time in `act-post-decision`), no Neon row for pending options; task → `blocked`.

**Isolation.** Cases 1–4 and 6–7 run **`--dry-run`** → act-or-decide writes nothing (no Neon rows, no Jupi
decisions, no tool calls). Cases 5 and 8 are real **`mode:draft`** runs over fixture tasks whose `signal_ref`
is prefixed `eval:`; run `purge-scratch.sh` afterward to delete them (their `actions` cascade). **Never run a
write case in `perform` mode.** Jupi decisions from a write run live in Jupi (not Neon) — keep write runs
rare and archive stray eval decisions in Jupi by hand.

Seed fixtures via `refresh-backlog` (eval mode) or `db.mjs upsert-task` with `signal_ref` prefixed `eval:`.
**Phase-5 rule fixtures:** case 6 needs a rule in the assets.md "Business rules — index" + its
entry in the `rules` store (`rulesStoreRef`); cases 7–8 need ≥ `ruleThreshold` (2) prior FINALIZED decisions on the *same*
trade-off, settled the *same* way, in the scratch Jupi workspace.
