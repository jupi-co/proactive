# Phase 3 — Act-or-Decide + Action Planner (Implementation Plan)

> **Status:** Draft v0.3 · 2026-07-22 · Owner: Anne-Claire · Living doc.
> Companion to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §5, §6, §11 and to [PHASE-2-PLAN.md](PHASE-2-PLAN.md).
> Builds the **downstream half** of the `act-and-decide` pipeline on top of Phase 2's scored Neon backlog. Ports the V1
> `act-and-decide` (`jupi-skills` @ `auto-jupi`, `plugins/jupi/skills/act-and-decide/`); the carry-over ledger (§12)
> tracks what must survive.
>
> **v0.3 — the model settled through review.** Two corrections shape everything below: **(1)** confidence is
> *task-level* and driven by open-questions **after** rules/habits pre-empt them; **(2)** the second gate axis is renamed
> **exposure** (draft-first, then destination). And the pipeline is **one path with two branches** off a single
> question — *does this task have a genuinely-open question?* — where the coordination node's value is to **research and
> ask a shared question once** across the tasks it blocks. (v0.2 reconciled with merged Phase 2: #7 tenancy, #8
> `refresh-backlog` + `shared/db.mjs`; the backlog contract is satisfied — §3.)

---

## 1. What Phase 3 delivers (one paragraph)

The **`act-and-decide`** skill. It refreshes the backlog (Phase 2's `refresh-backlog`), reads the scored top-window
(`query-window`), and splits it on one question — **does the task carry a genuinely-open question** (after rules/habits
were consulted)? **Tasks with an open question** are clustered by the **coordination node** — tasks that *share* a
question — and each cluster is **researched once**; that research either **resolves** the question (the cluster's tasks
act) or leaves a real trade-off, raised as **one Jupi decision gating per-task actions across the whole cluster**.
**Tasks without an open question** take the high-confidence fast path: the top-scored ones (up to a per-run budget) get
a deep-context dig, then either an action (via the Action Planner) or — if the dig surfaces a hidden trade-off, or the
action is high-**exposure** — a decision. Acting is governed by a **draft-mode switch** (draft vs. perform) and
previewable via a **dry-run flag** (classify only, touch nothing). The V1 producer↔validator gate is retained. This
closes the roadmap item "un-gate `setup-proactive-jupi`: create the `act-and-decide` routine and fire one first run at
the end of setup."

---

## 2. Steering decisions (locked through review)

| # | Fork | Choice | Consequence |
|---|---|---|---|
| P3-1 | Task source | **Backlog-read only** — consume Phase 2's scored tasks via `query-window`. | Satisfied by merged Phase 2 (§3). |
| P3-2 | Gate model | **Configurable matrix cells** — categorical `confidence × exposure`; config decides which cells ACT vs DECIDE. | The "threshold" *is* the policy matrix (§5). |
| P3-3 | Draft mode | **Global switch, gate always applies** — `draft`/`perform`; draft caps every act at its draft verb (drops exposure → more ACT); perform still routes high-exposure to DECIDE. | Draft mode changes the *verb*, never bypasses the gate (§6). |
| P3-4 | Confidence source | **Open-questions, after rules/habits pre-empt them.** `refresh-backlog` empties any `open_question` a rule/habit answers (upstream); the deep dig is the backstop. | Rules/habits raise **confidence**, not lower exposure. Empty open-questions ⇒ high confidence (§5). |
| P3-5 | Second axis name | **`exposure`** (was "risk") — **draft-first**, then destination/sensitivity/irreversibility. | "Risk" over-claimed; confidence owns *are-we-right*, exposure owns *what's-at-stake*. Stored column stays `actions.risk` (§10). |
| P3-6 | Two decision *kinds* | **approach** (triggered by low confidence — "which way?") vs **authorization** (high confidence + high exposure — "do exactly this?"). | Same DECIDE branch, different framing/options (§5). |
| P3-7 | Act-branch bound | **Per-run budget** — deep-dig + act only the top-scored no-open-question tasks up to `actBudget`; the rest wait. | The act branch's "picker"; keeps deep work bounded (§8). |

---

## 3. Prerequisite — the Phase 2 backlog (satisfied) + terminology

Phase 3 stands on merged Phase 2:
- **`refresh-backlog`** — parses signals → scored `tasks` (`status='open'`), cheap/read-only.
- **`shared/db.mjs` `query-window [K]`** — top-K open tasks by `score desc`, already `user_id`-scoped.
- **Columns Phase 3 reads:** `summary`, `signal_url` (clickable, pre-captured — **no refetch**), `external` (**an
  exposure input**, §5), `relevant_facts` (light recall to deepen), `open_questions` (the branch key + cluster key,
  §8), `gating_decision_ids` (the pile, §8).

**Contract seam:** act-and-decide runs `refresh-backlog` as its opening stage; the daily routine chains them (§15 flags
the double-refresh trade-off).

**Terminology — three axes, kept distinct** (CLAUDE.md "don't conflate"):
- **`relevance`** — task-level, Scorer, cheap: *is this real / worth surfacing?* (the noise gate). Persisted.
- **confidence** — task-level, act-or-decide: *do we know how to handle it?* **= are `open_questions` empty after
  rules/habits pre-empted them (P3-4)?** Empty ⇒ high; a genuine open question ⇒ low. The deep dig can still flip it.
- **exposure** — **action-level**, act-or-decide: *what's at stake if this fires?* Draft-first, then
  destination/sensitivity/irreversibility (P3-5).

The gate pairs the *task's* confidence with each *action's* exposure.

---

## 4. The safety ladder — three flags, one story

Default sits at the safe end, loosens as trust builds (parent §7: *"Default conservative (draft-only)"*).

| Level | Flag / setting | ACT branch does | DECIDE branch does | Side effects |
|---|---|---|---|---|
| **0 · dry-run** | `--dry-run` (run arg) | *nothing* — "Act" in the table | *nothing* — decision **not** created | **None.** Reads only. Table (§7). |
| **1 · draft (default)** | `guardrails.mode:"draft"` | create the **draft** | **create the STARTED Jupi decision** + gated action rows | No external send. |
| **2 · perform** | `guardrails.mode:"perform"` | **execute** the real action — *iff the gate says ACT* | same as level 1 | Real side effects, gate-permitting. |

`--dry-run` short-circuits *before* any write regardless of `mode`, so it previews either policy.

---

## 5. The gate — confidence × exposure, a configurable matrix (P3-2)

Confidence is **one value per task** (§3); exposure is tagged **per action**. The gate runs per action, pairing them:

```jsonc
// guardrails.policy — which cells auto-ACT vs DECIDE. Shipped default is conservative (parent §7).
{
  "high":   { "low": "act",    "high": "decide" },   // confident + safe → act; confident + exposed → decide (authorization)
  "medium": { "low": "act",    "high": "decide" },
  "low":    { "low": "decide", "high": "decide" }     // unsure → decide (approach), whatever the exposure
}
```

- **Confidence = open-questions after rules (P3-4).** No open question (or a rule/habit answers it) ⇒ `high` ⇒ act-eligible.
  A live trade-off ⇒ `low` ⇒ DECIDE regardless of exposure — the parent §6 "hesitating on what to say → decide" case.
- **Exposure = draft-first, then destination (P3-5).** A **draft exposes nothing** → `low`, whatever the recipient.
  A real send/post/commit → read `tasks.external`, recipient sensitivity (peer < manager < CEO < external), and
  irreversibility (commit, booking, payment) → `high` when any bites.
- **Two decision *kinds* out of the one DECIDE branch (P3-6):**
  - **low confidence → an _approach_ decision** — options are genuinely different ways to do it ("frame the renewal as
    X / as Y").
  - **high confidence + high exposure → an _authorization_ decision** — we know exactly what to do; options are
    *"send exactly this" · "hold" · "edit first"* (and a natural **candidate-rule** moment: *"always auto-do this?"*).
    In **draft mode** this usually never appears — drafting drops exposure to `low` → ACT.
- A **business rule** (Phase 5) authorizes a class of high-exposure actions → the authorization decision stops firing
  for it. Phase 3 **reads** `actions.rule_ref`; it does not author rules.
- **This matrix is the "configurable threshold."** Tighten = flip cells to `decide`; loosen = to `act`. Config, §9.

---

## 6. Draft mode mechanics (P3-3)

`mode:"draft"` transforms the Action Planner's output *before* the gate:
1. Every action with a draft form is **rewritten to its draft** (`send_email → create_draft`, `post_slack →
   draft-note`, `merge_pr → draft-PR`).
2. Drafting sets `exposure = low` (nothing leaves) → the matrix returns **ACT** for anything confident.
3. Net: the user gets **ready-to-send drafts for nearly everything**; decisions appear only for genuine *approach*
   trade-offs (low confidence), not for *exposure*.

`mode:"perform"`: the Planner emits the real verb; exposure is computed from destination; high-exposure confident
actions become **authorization** decisions (§5). **Draft mode never bypasses the gate** — a low-confidence action is an
approach DECIDE in either mode. Actions with no draft form (RSVP, label, search) are intrinsically low-exposure and act
in both modes.

---

## 7. Dry-run output — the classification table

`--dry-run` runs the full pipeline (refresh → window → branch/cluster → dig → gate) but **stops before any write**:

| Task | conf (task) | Action (what would happen) | exposure | Verdict | Decision (kind → title / options) |
|---|---|---|---|---|---|
| Reply to Alice re: pricing | high | Draft email to alice@x.com confirming Tue 2pm | low | **ACT** | — |
| Sharpist brief | high | Create "Sharpist Brief" doc in GTM project | low | **ACT** | — |
| | | Share the doc with Paul | low | **ACT** | — |
| Renewal outreach to CEO | high | Send renewal email to ceo@bigco.com | high | **DECIDE** | *authorization* → "Send the BigCo renewal email?" |
| Q3 pricing (3 threads) | low | *(clustered)* reply to each thread | low | **DECIDE** | *approach* → "What's our Q3 pricing?" → 3 options, gates **3 tasks** |

- **Confidence is a task attribute** (blank on continuation rows); **exposure + verdict are per action**.
- The last row shows the **coordination node**: one *approach* decision gating actions across three tasks.
- The CEO row shows an **authorization** decision (high confidence, high exposure) — which would collapse to **ACT** in
  draft mode.
- Verdict reflects the *current* `mode`; footer notes mode + policy matrix. Rendered to
  `act-and-decide/runs/run-XXX/report.md`, returned as the caller summary (a read-only in-memory plan — §10).

---

## 8. `act-and-decide` anatomy — one path, two branches, the node in the middle

**The pipeline is one algorithm** — `research → confidence×exposure gate → act, or decide (approach|authorization)` —
where a task's `open_questions` are a **router + cluster-enabler**, not a separate code path. Two branches fall out of
the single question *"is there a genuinely-open question?"*, and the **coordination node's** payoff is that a question
**shared** by several tasks is **researched once and asked once**.

The schema already supports the node (no change): one `decision_id` sits in **many tasks'** `gating_decision_ids`, and
`actions` rows across **different `task_id`s** carry the **same** `decision_id`/`option_id`. **Clustering is by
*question*, not by task** — a task with two open questions is gated by two decisions and unblocks only when **both**
settle (`gating_decision_ids` is an array for exactly this).

One skill, explicit stages. All Neon access via **`${CLAUDE_PLUGIN_ROOT}/shared/db.mjs`** — never hand-written SQL,
never the account-wide MCP (Phase 2 rule); auto-scoped by `user_id`; same npm-bootstrap + egress-fallback as
`refresh-backlog`.

- **Boot:** read `assets.md` (Asset Map, in full — incl. the **rules index**), `guardrails` config, Jupi slug. Parse
  run args → `dry_run`, `mode`. No tree exploration.
- **Stage 0 — Refresh + drain the pile:** run `refresh-backlog` (which now also **pre-empts `open_questions` against the
  rules index**, D9); then gather `gating_decision_ids` across open tasks, fetch them from Jupi, take
  **FINALIZED-not-yet-EXECUTED**. *Read + recompute here; execute/notify is Phase 4.*
- **Stage 1 — Read the window:** `db.mjs query-window [backlogWindowSize]`.
- **Stage 2 — Route + cluster (the coordination node):**
  - **Split** the window: tasks **with** open questions → *decide-candidates*; tasks **without** → *act-candidates*.
  - **Cluster the decide-candidates by shared open-question** — a question several tasks hold in common is a
    coordination node. Leverage = *value unblocked across tasks per decision*, not per-task score.
  - **Bound the act-candidates:** keep the **top-scored up to `actBudget`** (P3-7); the rest wait for a later run.
  - *(Degrades gracefully: nothing shared → single-task "clusters"; still correct, just no factorization.)*
- **Stage 3 — Research (decision is the *outcome*, not the premise):**
  - **Per decide-cluster: research the shared question ONCE** — brain (deepen `relevant_facts`; `update-brain` targeted
    for gaps, never writing Facts), business rules, **past decisions** (`search-decisions`). Then:
    - research **resolves** it (a rule/prior decision answers it, or context makes it obvious) → the cluster's tasks
      **flip to act-candidates**; **or**
    - a real trade-off remains → keep it; confidence `low` for those tasks.
  - **Per act-candidate (within budget): deep dig** — the V1 "no-blind-spot" context + **≥10 in-channel messages before
    any message draft**. This both (a) is the backstop that can **surface a hidden question** (→ becomes a
    decide-candidate; **match to an existing open decision** via `search-decisions`, else a new one) and (b) supplies
    the context to draft well. Confidence `high` if it stays clean.
- **Stage 4 — Action Planner (materialize fully):**
  - **Decide-clusters:** for **each option**, plan the concrete per-task action(s) across the cluster and **insert all
    of them** as `actions` (`status='pending_decision'`, `decision_id`+`option_id`, its own `exposure`). *(We keep full
    up-front materialization — the schema's sibling-skip model assumes every option's rows exist; settle flips the
    winner to execute and the rest to `skipped`.)*
  - **Act-tasks:** materialize the action(s) directly (`status='candidate'`, `decision_id` null, `exposure` tagged).
    Apply the **draft-mode transform** (§6).
- **Stage 5 — Gate + emit:**
  - **Act-tasks** → per-action `(high confidence × exposure)` lookup: `low` → **ACT** (dry-run: table; else draft/perform
    → `set-action-status executed` + `trace_ref`); `high` → **authorization DECIDE** (or ACT if a rule authorizes / if
    draft-mode already dropped exposure).
  - **Decide-clusters** → author the **approach** decision in Jupi (V1 HTML format + validator §11), set the cluster's
    action rows' `gating_decision_ids` (`db.mjs`). One decision, many tasks.
  - Set tasks `done`/`dropped` as resolved; a ruled-out task → `dropped` (the V1 `_ruled-out` memory, §12).
- **Stage 6 — Recompute-on-settle:** Planner is a pure function of `(task, settled_decision, chosen_option)`. When
  Stage 0 finds a newly-FINALIZED decision: the chosen option's actions **across every task it gated** become
  executable, siblings → `skipped`, and each touched task is recomputed (may spawn new actions/decisions — recursion).
  *Phase 3 ships the function; Phase 4 wires the poll + executor.*

**Known limitation (write it down):** factorization that only surfaces on the **deep** dig — two act-candidates that
turn out to share a question invisible at the shallow stage — is **missed within a run**. They'll cluster on a later run
once the question is on record. Acceptable; named so it's a known edge, not a silent gap.

---

## 9. Deliverables

| # | Deliverable | New / changed |
|---|---|---|
| D1 | **`act-and-decide` skill** — `skills/act-and-decide/{SKILL.md, reference/ORCHESTRATION.md, reference/VALIDATOR.md}`, ported from V1, re-anchored on `db.mjs`. Centerpiece: the route+cluster+research-once coordination node (§8 Stage 2–3). | new |
| D2 | **`shared/db.mjs` write-verbs** — `insert-action '<json>'`, `set-action-status <id> <status> [trace_ref]`, `set-task-gating <task_id> '<decision_ids[]>'`, `close-task <id> <done\|dropped>`, `list-actions-by-decision <decision_id>`. Parameterized, `user_id`-scoped. | changed |
| D3 | **Gate + draft-mode + dry-run** in `SKILL.md` — §5 matrix (confidence × exposure, two decision kinds), §6 verb-capping, §7 no-write table. | new |
| D4 | **Config** — `guardrails` block (`mode`, `policy`, `actBudget`, `executedPing`); reuse existing `backlogWindowSize`. | changed |
| D5 | **Producer↔validator loop** — carry `ORCHESTRATION.md`/`VALIDATOR.md`; extend the validator to gate perform-mode sends. | new/changed |
| D6 | **Un-gate `setup-proactive-jupi`** — create the `act-and-decide` routine; fire one first run as `--dry-run`. | changed |
| D7 | **`evals/act-and-decide/`** — trigger + behavioral evals (gate classification; a coordination-node case: 2+ tasks sharing a question → **one** decision; injection safety: a signal body must not drive an action/decision). Scratch-isolated. | new |
| D8 | **Doc updates** — tick Phase 3 items in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) as they land. | changed |
| D9 | **`refresh-backlog` (Phase-2 skill) — rules pre-emption** — when emitting `open_questions`, drop/mark any a rules-index (`assets.md`) rule answers, so downstream "no open question ⇒ high confidence" holds (P3-4). Cheap, per-run. *(Upstream change; near-no-op until Phase-5 rules exist, but the hook must be there.)* | changed |

### Config surface (front-loaded, per CLAUDE.md)

```jsonc
// .claude/setup.local.json + reference/setup.local.json.template — set in setup's attended prelude
"guardrails": {
  "mode": "draft",              // "draft" (default) | "perform"
  "actBudget": 5,               // max no-open-question tasks deep-dug + acted per run (P3-7); rest wait
  "policy": {                   // the configurable confidence × exposure matrix (§5)
    "high":   { "low": "act",    "high": "decide" },
    "medium": { "low": "act",    "high": "decide" },
    "low":    { "low": "decide", "high": "decide" }
  },
  "executedPing": "none"        // "email" | "slack" | "none" — the one closing ping (Phase 4)
}
// window reuses the EXISTING top-level "backlogWindowSize" (default 30) — no new key.
```

`--dry-run` is a run argument, not persisted; `mode` also overridable per-invocation (`/act-and-decide --perform`).

---

## 10. Schema touchpoints

`shared/schema.sql` **already supports Phase 3** — `actions.risk/decision_id/option_id/status`
(`candidate|pending_decision|executed|skipped`), `tasks.gating_decision_ids` (array — multi-gating, §8),
`tasks.external`, `tasks.signal_url`, `user_id` everywhere. **No migration strictly needed.**

- **`actions.risk` stores the *exposure* value (P3-5).** We keep the column name to avoid a migration; prose says
  "exposure." *(Optional later rename `risk → exposure` if the mismatch grates — one idempotent `alter`.)*
- **Confidence placement.** It's now largely **derivable** — "are `open_questions` empty after rules?" — so it needn't
  be a new column. Judge it in Stage 3; **optionally** persist `tasks.act_confidence` for a queryable dry-run/audit.
  Phase 2's `actions.confidence`, under this model, is redundant (confidence is task-level) — leave unused or drop.
- **Behavioral conventions (not DDL):** dry-run writes nothing; on settle, non-selected options' rows → `skipped`,
  winner's rows (across **all** gated tasks) → execute (§8 Stage 6).

---

## 11. Producer ↔ validator loop (carried from V1)

- Every DECIDE draft passes the **validator** (opens real sources, verifies each claim; HTML breathing;
  links-everywhere — cheap now, `signal_url` pre-captured; relative dates; plain language; elevate vague actions). Max
  3 iterations; never clears → **deliver nothing** for that item (run proceeds).
- **New:** the validator also gates **ACT-in-perform** actions before execution (an external send is as consequential
  as a posted decision). Draft-mode ACTs and dry-run need no gate.
- Orchestrator persists `report.md`/`validation.md` (sub-agents return text, don't write files — V1 harness note).

---

## 12. Regression guard — what must survive from V1 `act-and-decide`

| V1 behavior | Phase 3 home | Verdict |
|---|---|---|
| Derive **0/1/N decisions from an action**; obvious → just act (Case-0) | Stage 3 backstop + Stage 5 act-branch | **Preserved** — now the "no-open-question" fast path |
| Actions live **inside decision options** (or a lone Case-0 act), never free-standing on a task | Stage 4 | **Preserved** — this was the earlier conflation, now fixed |
| "No-blind-spot" deep context dig; ≥10 in-channel messages before a draft; mirror voice; minimal | Stage 3 | **Now owned here** (Phase 2 deferred it) |
| Coordination nodes ("orchestration layer for later") | Stage 2–3 | **Now built** — research-once + ask-once across shared questions |
| Decisions **private** (`allowWorkspaceContributions:false`), STARTED, never finalized | Stage 5 | **Preserved** |
| Jupi HTML format + breathing + links + relative dates | Validator (§11) | **Preserved** |
| Producer↔validator; max 3; "deliver nothing" | §11 | **Preserved** |
| The pile = gated `actions` rows drained each run | Stage 0 / Stage 6 | **Read+recompute here; execute Phase 4** |
| `_ruled-out` negative memory | `status='dropped'` + Parser no-resurrect (Phase 2) | **Preserved**; Stage 5 sets `dropped` on rule-out |
| Pattern → *rule* engine | Rule loop (Phase 5) | **Deferred** — Phase 3 reads `rule_ref`, doesn't author |

---

## 13. Build sequence

1. **D9 `refresh-backlog` rules pre-emption** — small upstream change; makes "no open question ⇒ high confidence" true.
2. **D2 `db.mjs` write-verbs** — foundation; smoke-test each.
3. **D1 skill skeleton** — port `SKILL.md` + `reference/*`, re-anchored on `db.mjs` + the window.
4. **D4 config** — `guardrails` (`mode`, `actBudget`, `policy`, `executedPing`).
5. **Stages 0–2** — refresh + pile-read; `query-window`; route + cluster + `actBudget` bound.
6. **Stage 3** — research-once per cluster; budgeted deep dig for act-candidates; the resolve/flip logic both ways.
7. **D3 Stage 4–5** — full materialization (all options) + the gate (confidence × exposure; two decision kinds).
8. **Dry-run** — table + no-write guarantee (§7, §10).
9. **D5 validator loop** — wire it; gate perform-ACTs.
10. **Stage 6** — recompute-on-settle function (poll/execute → Phase 4).
11. **D6 setup un-gating**; **D7 evals** alongside D1/D3; **D8 doc ticks**.

**Dogfood checkpoints (`sparkling-violet-42081696`):**
- `refresh-backlog` → `--dry-run` → table: ACT/DECIDE sane? kinds right (approach vs authorization)?
- Seed **two tasks sharing a question** → confirm **one** decision gating both (the node).
- Flip a policy cell → verdict changes. Set `actBudget:1` → only the top no-open-question task is dug/acted.
- `mode:draft` real run → drafts appear; one private approach decision; `actions` rows correct + `user_id`.
- Finalize by hand → Stage 6: winner's actions across **all** gated tasks execute; siblings `skipped`.

**Out of Phase 3:** poll-detect loop, executor/trace/notify, EXECUTED write, rule authoring — Phase 4/5 (§14).

---

## 14. Deferred to Phase 4/5 (explicit seam)

- **Phase 4** — scheduled poll-detect; executor (run the chosen option's ACT rows post-settle, write the trace on the
  signal, one optional EXECUTED ping, set Jupi `EXECUTED` — backend write still "to request", parent §8).
- **Phase 5** — reactive rule authoring (incl. the "always auto-do this?" candidate-rule moment from §5's authorization
  decisions); Phase 3 only *reads* `rule_ref` and *consumes* the rules index for pre-emption (D9).

---

## 15. Open items / decisions you may want to flip

- **`actBudget` default (5).** Bounds deep digs per run; interacts with cadence (parent §7). Too low → slow throughput;
  too high → expensive runs. Tune on dogfood.
- **Rules pre-emption upstream vs downstream.** D9 puts the cheap rules-index check in `refresh-backlog`; the expensive
  prior-decision/context-dependent check stays in Stage 3. *Flip:* move all rule-matching downstream if the parser
  shouldn't grow a rules dependency.
- **Confidence persistence.** Derivable from open-questions; persist `tasks.act_confidence` only if you want it
  queryable (§10). *Flip:* numeric confidence if the categorical gate misfires (also enables a scalar threshold, P3-2).
- **`risk → exposure` column rename** — deferred (kept `actions.risk` as the store). Rename if the prose/DDL mismatch grates.
- **First setup run = `--dry-run`** — proves the loop with zero side-effect. *Flip:* a real draft-mode run.
- **Perform-mode validator latency** — a round-trip per external send; fine at low volume, revisit at scale.
