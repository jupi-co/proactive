# act-or-decide evals

> **Isolation + teardown rules are shared — read [`evals/README.md`](../README.md) first.** Neon: `eval:`-prefixed rows, deleted after. Supermemory: the `user_eval_scratch` test container. Jupi: the test workspace in `JUPI_EVAL_WORKSPACE`, never the real one.

Two layers, matching `evals/refresh-backlog/`.

- **`trigger-eval.json`** — should-fire prompts ("run act-or-decide", "what should Jupi do now",
  "dry-run and show the table") vs near-misses that belong to `refresh-backlog` (parse/score),
  `update-brain` (who-is / build the brain), `execute-action` (run the queue / send the drafts),
  `setup-proactive-jupi`, or the decision skills (search / log / submit-decision).
- **`evals.json`** — the gate + coordination node + the Phase-5 rule loop:
  1. ACT classification (high confidence + low exposure).
  2. Coordination node — 2+ tasks sharing a question → **one** decision.
  3. Non-draftable high-exposure → DECIDE even in draft mode; draftable → ACT. *(Cases 11–12 extend this
     to the surfaces that have no draft call at all.)*
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
  9. **Skill reuse** — a task an `assets.md` *Agents / skills* entry covers is planned as one `tool: skill`
     invoke, not recomposed by hand; an uncovered sibling still gets normal tool actions.
  10. **Skill exposure in draft mode** — a content-producing skill is `low` → ACT, but one that **may send**
     is non-draftable → DECIDE *even in draft mode* (the draft transform rewrites our verb, not someone
     else's skill), and a vaguely-described skill counts as may-send. This is the external-send hole the
     `tool: skill` action kind would otherwise open.
  11. **Draft-mode resolution** — an ACT on a surface with **no draft call** (a Linear comment) converts
     to DECIDE even after clearing the gate, carrying its prepared content in as the recommended option;
     Gmail, which has `create_draft`, still ACTs. This is the hole C1 closed: draft mode was written around
     mail and was simply undefined for everything else.
  12. **Perform mode is unchanged** — the control for 11. The same window under `--perform` gates on
     confidence × exposure alone, so the Linear comment ACTs again. If this regresses, C1 broke perform mode.
  13. **Budgets bound clusters AND decisions** — `clusterBudget`/`decisionBudget` respected, the highest-
     leverage kept, and **everything cut named in the Deferred block** with score and reason.
  14. **`actBudget` back-compat** — the deprecated key is honoured as `clusterBudget` with a rename warning,
     never as a cap on the number of actions (which it never was).
  15. **Report shape + decision links** — all four blocks with their columns; the permalink built via
     `db.mjs decision-url`, never from `get-decision`'s `url` (that's `source.url`, the decision's *origin*)
     and never from an inline slugifier.
  16. **User-facing report** — the same four blocks in the user's words at setup time: no cluster/exposure/conf
     vocabulary, each item marked *on my own* vs *I'll ask you*, Deferred still shown. This is the first thing
     a new user ever sees Jupi produce.
  17. **Draft-mode exemptions** — a business rule is an owner-approved settled decision, so a rule-covered
     action ACTs with its `rule_ref` even with no draft call (without this the whole read-side rule loop is
     dead in the default mode); a label and an RSVP ACT because they expose nothing. All marked *exempt*,
     never *converted*.
  18. **Swept orphans keep their queued verb** — a draft row picked up by a `--perform` run must not become
     a real send. Re-deriving the verb from the run's mode is the failure.

**Isolation.** Cases 1–4 and 6–7 run **`--dry-run`** → act-or-decide writes nothing (no Neon rows, no Jupi
decisions, no tool calls). Cases 5 and 8 are real **`mode:draft`** runs over fixture tasks whose `signal_ref`
is prefixed `eval:`; run `purge-scratch.sh` afterward to delete them (their `actions` cascade). **Never run a
write case in `perform` mode.** Jupi decisions from a write run live in Jupi (not Neon) — keep write runs
rare and archive stray eval decisions in Jupi by hand.

Seed fixtures via `refresh-backlog` (eval mode) or `db.mjs upsert-task` with `signal_ref` prefixed `eval:`.
**Phase-5 rule fixtures:** case 6 needs a rule in the assets.md "Business rules — index" + its
entry in the `rules` store (`rulesStoreRef`); cases 7–8 need ≥ `ruleThreshold` (2) prior FINALIZED decisions on the *same*
trade-off, settled the *same* way, in the scratch Jupi workspace.
