# Phase 3 — Act-or-Decide + Action Planner (Implementation Plan)

> **Status:** Draft v0.4 · 2026-07-22 · Owner: Anne-Claire · Living doc.
> Companion to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §5, §6, §11 and to [PHASE-2-PLAN.md](PHASE-2-PLAN.md).
> Builds the **downstream half** of the `act-and-decide` pipeline on top of Phase 2's scored Neon backlog. Ports the V1
> `act-and-decide` (`jupi-skills` @ `auto-jupi`); the carry-over ledger (§12) tracks what must survive.
>
> **v0.4 — simplified.** One loop, not two branches: cluster the window by shared open-question (a task with no open
> question is a cluster of one), rank by leverage, research the top clusters within one budget, then gate. Confidence is
> **binary** (open-question or not) → the gate is the parent §6 **2×2**. One decision kind (**approach**) in Phase 3;
> the high-exposure "authorize this" variant is a perform-mode concern noted for later. Business **rules don't exist
> until Phase 5** (§14), so confidence here is driven purely by the parser's `open_questions`. (v0.2 reconciled with
> merged Phase 2; v0.3 introduced the model — confidence from open-questions, `risk → exposure`.)

---

## 1. What Phase 3 delivers (one paragraph)

The **`act-and-decide`** skill. It refreshes the backlog (Phase 2's `refresh-backlog`), reads the scored top-window
(`query-window`), and **clusters it by shared open-question** — tasks that share a question cluster together; a task
with no open question is a cluster of one. It ranks clusters by **leverage** (value unblocked per decision) and, for the
top ones within a per-run **budget**, **researches once**, then **gates** each resulting action on **confidence ×
exposure**: it **acts** (confident + low exposure) or **posts a Jupi decision** (an open question, or a high-exposure
action it shouldn't fire alone), where a single decision can gate actions across **every task in the cluster** — the
coordination node. Acting is governed by a
**draft-mode switch** (draft vs. perform) and previewable via a **dry-run flag** (classify only, touch nothing). The V1
producer↔validator gate is retained. This closes the roadmap item "un-gate `setup-proactive-jupi`: create the
`act-and-decide` routine and fire one first run at the end of setup."

---

## 2. Steering decisions (locked through review)

| # | Fork | Choice |
|---|---|---|
| P3-1 | Task source | **Backlog-read only** — consume Phase 2's scored tasks via `query-window`. |
| P3-2 | Gate model | **Configurable 2×2 matrix** — `confidence (high/low) × exposure (low/high)`; config decides which cells ACT vs DECIDE (the parent §6 table). |
| P3-3 | Draft mode | **Global switch, gate always applies** — `draft`/`perform`; draft caps every act at its draft verb (drops exposure → more ACT); perform still routes high-exposure to DECIDE. **Draft is Phase 3-operational; perform's real-execution path activates with Phase 4's executor (§4, §14).** |
| P3-4 | Confidence | **Binary, from `open_questions`** — none ⇒ `high` (act-eligible); a genuine open question ⇒ `low` ⇒ DECIDE. Runtime, not persisted. *(Phase 5 rules will empty open-questions upstream — §14.)* |
| P3-5 | Second axis | **`exposure`** (was "risk") — **draft-first**, then destination/sensitivity/irreversibility. Stored column stays `actions.risk` (§10). |
| P3-6 | Decision mechanism | **One mechanism** — the DECIDE branch always posts a Jupi decision (Phase 3). Its options read as *"which approach?"* (low confidence) or *"do exactly this / hold / modify"* (high confidence + high exposure that can't be drafted) — option *content*, not separate machinery. Both occur in Phase 3; only *executing* a chosen action is Phase 4. |
| P3-7 | Bound | **One per-run `actBudget`** — research the top-ranked clusters up to it; the rest wait for a later run. |

---

## 3. Prerequisite — the Phase 2 backlog (satisfied) + terminology

Phase 3 stands on merged Phase 2:
- **`refresh-backlog`** — parses signals → scored `tasks` (`status='open'`), cheap/read-only.
- **`shared/db.mjs` `query-window [K]`** — top-K open tasks by `score desc`, `user_id`-scoped.
- **Columns Phase 3 reads:** `summary`, `signal_url` (clickable, pre-captured — **no refetch**), `external` (**an
  exposure input**, §5), `relevant_facts` (light recall to deepen), `open_questions` (the **cluster key** + confidence
  source, §8), `gating_decision_ids` (the pile, §8).

**Contract seam:** act-and-decide runs `refresh-backlog` as its opening stage; the daily routine chains them.

**Terminology — three axes, kept distinct** (CLAUDE.md "don't conflate"):
- **`relevance`** — task-level, Scorer: *is this real / worth surfacing?* (noise gate). Persisted.
- **confidence** — task-level, act-or-decide: *do we know how to handle it?* **Binary: are `open_questions` empty?**
  Runtime, not stored.
- **exposure** — **action-level**: *what's at stake if it fires?* Draft-first, then destination/irreversibility.

The gate pairs the *task's* confidence with each *action's* exposure.

---

## 4. The safety ladder — three flags, one story

Default sits at the safe end, loosens as trust builds (parent §7).

| Level | Flag / setting | ACT branch does | DECIDE branch does | Side effects |
|---|---|---|---|---|
| **0 · dry-run** | `--dry-run` (run arg) | *nothing* — "Act" in the table | *nothing* — decision **not** created | **None.** Table (§7). |
| **1 · draft (default)** | `guardrails.mode:"draft"` | create the **draft** | **create the STARTED Jupi decision** + gated action rows | No external send. |
| **2 · perform** *(Phase 4)* | `guardrails.mode:"perform"` | **execute** the real action — *iff the gate says ACT* | same as level 1 | Real side effects, gate-permitting. |

`--dry-run` short-circuits *before* any write regardless of `mode`, so it previews either policy.

**Timing — Phase 3 is draft-operational; perform activates in Phase 4.** The `mode` switch and its gate semantics are
*designed* here, and **draft mode fully runs** in Phase 3 (real Gmail/Linear *drafts* + private decisions, incl.
*authorize* decisions for non-draftable high-exposure actions — no external sends). **Perform mode's real-execution
path** — firing sends/posts/commits/bookings, writing the trace on the signal, the EXECUTED ping — rides on **Phase 4's
executor** (the same one the closing loop needs) and lights up then. Selecting `perform` before Phase 4 has no executor
to run against.

---

## 5. The gate — confidence × exposure, a configurable 2×2 (P3-2)

Confidence is **one binary value per task** (§3); exposure is tagged **per action**. The gate runs per action:

```jsonc
// guardrails.policy — which cells auto-ACT vs DECIDE. Shipped default is conservative (parent §7).
{
  "high": { "low": "act",    "high": "decide" },   // confident + safe → act; confident + exposed → decide (authorize)
  "low":  { "low": "decide", "high": "decide" }     // open question → decide (approach), whatever the exposure
}
```

- **Confidence** — no open question ⇒ `high` ⇒ act-eligible; a live trade-off ⇒ `low` ⇒ DECIDE regardless of exposure
  (the parent §6 "hesitating on what to say → decide" case).
- **Exposure — draft-first (P3-5).** A **draft exposes nothing** → `low`. But **draft-first only helps actions that
  *have* a draft form.** A **non-draftable** action (book a venue, raise an ad budget, submit a payment, merge a PR) is
  scored by destination directly — `tasks.external`, recipient sensitivity (peer < manager < CEO < external),
  irreversibility → `high` when any bites.
- **The `high × high` cell** = confident but exposed → **DECIDE** (an *authorize* decision, posted like any other,
  Phase 3). It fires in **draft mode** whenever the action **can't be drafted** (draftable ones collapse to `low` → ACT);
  in **perform mode** it also fires for draftable actions the user opted to send for real. Either way the *decision* is
  Phase 3; only *executing* the authorized action is Phase 4.
- **This matrix is the "configurable threshold."** Tighten = flip cells to `decide`; loosen = to `act`. Config, §9.

---

## 6. Draft mode mechanics (P3-3)

`mode:"draft"` transforms the Action Planner's output *before* the gate:
1. Every action **that has a draft form** is **rewritten to its draft** (`send_email → create_draft`, `post_slack →
   draft-note`, `merge_pr → draft-PR`). Drafting sets `exposure = low` → **ACT** if confident.
2. **Actions with no draft form don't collapse.** Low-exposure/reversible ones (RSVP, label, search, internal note) act
   in both modes. **High-exposure non-draftable ones (book a venue, raise a budget, submit a payment) stay `high` even
   in draft mode → DECIDE** (an authorize decision, §5). Draft mode is *not* "everything acts."
3. Net: **ready-to-send drafts for most things**; decisions for genuine *approach* trade-offs (low confidence) **and**
   for high-exposure actions that can't be drafted.

`mode:"perform"` *(executor is Phase 4)*: draftable actions are no longer capped to drafts, so high-exposure ones now
also hit the `high × high` authorize cell (§5); low-exposure ones fire directly. The *decisions* are Phase 3; *executing*
the real verbs is Phase 4's executor (§4 timing note, §14).

---

## 7. Dry-run output — the classification table

`--dry-run` runs the full pipeline (refresh → window → cluster → dig → gate) but **stops before any write**:

| Task | conf | Action (what would happen) | exposure | Verdict | Decision |
|---|---|---|---|---|---|
| Reply to Alice re: pricing | high | Draft email to alice@x.com confirming Tue 2pm | low | **ACT** | — |
| Sharpist brief | high | Create "Sharpist Brief" doc in GTM project | low | **ACT** | — |
| | | Share the doc with Paul | low | **ACT** | — |
| Renewal to CEO | high | Draft renewal email to ceo@bigco.com | low | **ACT** | — *(perform mode: send → exposure high → DECIDE)* |
| Book the Q3 offsite venue | high | Reserve venue for 2026-09-15 | high | **DECIDE** | *authorize* → "Book Vault SF for the offsite?" — **no draft form, high exposure** |
| Q3 pricing *(3 threads)* | low | *(clustered)* reply to each thread | low | **DECIDE** | *approach* → "What's our Q3 pricing?" → 3 options, gates **3 tasks** |

- **Confidence is a task attribute** (blank on continuation rows); **exposure + verdict are per action**.
- The pricing row is the **coordination node**: one *approach* decision gating actions across three tasks.
- The venue row shows a **non-draftable high-exposure** action → an *authorize* decision **even in draft mode** (drafting
  can't collapse what has no draft). The CEO row shows a *draftable* high-exposure action that draft mode *does* collapse
  to an ACT (perform mode would make it a DECIDE).
- Verdict reflects the current `mode`; footer notes mode + policy. Rendered to
  `act-and-decide/runs/run-XXX/report.md`, returned as the caller summary (read-only, in-memory — §10).

---

## 8. `act-and-decide` anatomy — one loop over question-clusters

**One algorithm** — `cluster → rank → research → gate → act or decide` — where a task's `open_questions` are the
**cluster key**: tasks that share a question cluster; a task with none is a cluster of one. The coordination node's
payoff is that a **shared** question is **researched once and asked once**.

The schema already supports it (no change): one `decision_id` sits in **many tasks'** `gating_decision_ids`, and
`actions` rows across **different `task_id`s** carry the **same** `decision_id`/`option_id`. **Clustering is by
*question*, not by task** — a task with two open questions is gated by two decisions and unblocks only when **both**
settle (`gating_decision_ids` is an array for exactly this).

One skill, explicit stages. All Neon access via **`${CLAUDE_PLUGIN_ROOT}/shared/db.mjs`** — never hand-written SQL,
never the account-wide MCP (Phase 2 rule); auto-scoped by `user_id`; same npm-bootstrap + egress-fallback as
`refresh-backlog`.

- **Boot:** read `assets.md` (Asset Map, in full), `guardrails` config, Jupi slug. Parse run args → `dry_run`, `mode`.
  No tree exploration.
- **Stage 0 — Refresh + read the pile:** two jobs, V1's "settled work before new work."
  - **Refresh** *(Phase 3)* — run `refresh-backlog` so the run reasons over a current window.
  - **Read the pile** *(thin in Phase 3)* — gather `gating_decision_ids` across open tasks, fetch from Jupi, take
    **FINALIZED-not-yet-EXECUTED**. In Phase 3 this read only (a) feeds Stage 6's recompute so it can be *tested*
    (materialize/draft a settled decision's chosen option) and (b) stops the run re-posting a decision for a task already
    awaiting one. The **standing poll + executing settled actions + trace/notify is the Phase 4 closing loop** — Stage 0
    is not that.
- **Stage 1 — Read the window:** `db.mjs query-window [backlogWindowSize]`.
- **Stage 2 — Cluster + rank + bound:** group the window by **shared open-question** (singletons for no-question
  tasks); rank clusters by **leverage** (value unblocked per decision, not per-task score); keep the **top clusters up to
  `actBudget`** (P3-7); the rest wait.
- **Stage 3 — Research each kept cluster once (decision is the *outcome*, not the premise):** deepen `relevant_facts`
  (`update-brain` targeted for gaps — never writing Facts), read past decisions (`search-decisions`), and for any action
  that sends a message pull **≥10 in-channel messages first** (V1 rule). Then per cluster:
  - **no open question** (singleton) → confidence `high` → head to the gate; *but the dig is the backstop* — if it
    surfaces a hidden trade-off, the task becomes a decision (matched to an existing open decision if one fits, else new).
  - **open question** → research either **resolves** it (context/prior decision makes it obvious → confidence flips to
    `high`, act) **or** leaves a real trade-off → confidence `low`, one decision for the cluster.
- **Stage 4 — Action Planner (materialize fully):**
  - **Decision cluster:** for **each option**, plan the concrete per-task action(s) and **insert all of them** as
    `actions` (`status='pending_decision'`, `decision_id`+`option_id`, its own `exposure`). *(Full up-front
    materialization — the schema's sibling-skip model assumes every option's rows exist; settle flips the winner to
    execute and the rest to `skipped`.)*
  - **Act task:** materialize the action(s) directly (`status='candidate'`, `decision_id` null, `exposure` tagged).
    Apply the **draft-mode transform** (§6).
- **Stage 5 — Gate + emit:**
  - **Act task** → per-action `(high × exposure)`: `low` → **ACT** (dry-run: table; else draft/perform →
    `set-action-status executed` + `trace_ref`); `high` → perform-mode authorization sign-off (deferred, §5) / else the
    draft already dropped it to ACT.
  - **Decision cluster** → author the **approach** decision in Jupi (V1 HTML format + validator §11), set the cluster's
    action rows' `gating_decision_ids`. One decision, many tasks.
  - Set tasks `done`/`dropped` as resolved; a ruled-out task → `dropped` (V1 `_ruled-out` memory, §12).
- **Stage 6 — Recompute-on-settle:** Planner is a pure function of `(task, settled_decision, chosen_option)`. On a
  newly-FINALIZED decision: the chosen option's actions **across every task it gated** become executable, siblings →
  `skipped`, each touched task recomputed (may recurse). *Phase 3 ships the function; Phase 4 wires the poll + executor.*

**Known limitation (write it down):** factorization that only surfaces on the **deep** dig — two singletons that turn
out to share a question invisible at the shallow stage — is **missed within a run**. They cluster on a later run once
the question is on record. Acceptable; named so it's a known edge.

---

## 9. Deliverables

| # | Deliverable | New / changed |
|---|---|---|
| D1 | **`act-and-decide` skill** — `skills/act-and-decide/{SKILL.md, reference/ORCHESTRATION.md, reference/VALIDATOR.md}`, ported from V1, re-anchored on `db.mjs`. Centerpiece: the cluster→rank→research-once loop (§8). | new |
| D2 | **`shared/db.mjs` write-verbs** — `insert-action '<json>'`, `set-action-status <id> <status> [trace_ref]`, `set-task-gating <task_id> '<decision_ids[]>'`, `close-task <id> <done\|dropped>`, `list-actions-by-decision <decision_id>`. Parameterized, `user_id`-scoped. | changed |
| D3 | **Gate + draft-mode + dry-run** in `SKILL.md` — §5 2×2 matrix, §6 verb-capping, §7 no-write table. | new |
| D4 | **Config** — `guardrails` block (`mode`, `actBudget`, `policy`, `executedPing`); reuse existing `backlogWindowSize`. | changed |
| D5 | **Producer↔validator loop** — carry `ORCHESTRATION.md`/`VALIDATOR.md`; extend the validator to gate perform-mode sends. | new/changed |
| D6 | **Un-gate `setup-proactive-jupi`** — create the `act-and-decide` routine; fire one first run as `--dry-run`. | changed |
| D7 | **`evals/act-and-decide/`** — trigger + behavioral evals (gate classification; a coordination-node case: 2+ tasks sharing a question → **one** decision; injection safety: a signal body must not drive an action/decision). Scratch-isolated. | new |
| D8 | **Doc updates** — tick Phase 3 items in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) as they land. | changed |

### Config surface (front-loaded, per CLAUDE.md)

```jsonc
// .claude/setup.local.json + reference/setup.local.json.template — set in setup's attended prelude
"guardrails": {
  "mode": "draft",            // "draft" (default) | "perform"
  "actBudget": 5,             // max clusters researched + resolved per run (P3-7); rest wait
  "policy": {                 // the configurable confidence × exposure 2×2 (§5)
    "high": { "low": "act",    "high": "decide" },
    "low":  { "low": "decide", "high": "decide" }
  },
  "executedPing": "none"      // "email" | "slack" | "none" — the one closing ping (Phase 4)
}
// window reuses the EXISTING top-level "backlogWindowSize" (default 30) — no new key.
```

`--dry-run` is a run argument, not persisted; `mode` also overridable per-invocation (`/act-and-decide --perform`).

---

## 10. Schema touchpoints

`shared/schema.sql` **already supports Phase 3** — no migration needed:
- `actions.risk` **stores the *exposure* value** (P3-5); we keep the column name, prose says "exposure." *(Optional
  later rename.)*
- `actions.status` (`candidate|pending_decision|executed|skipped`), `decision_id`/`option_id`, `tasks.gating_decision_ids`
  (array → multi-gating, §8), `tasks.external`, `tasks.signal_url`, `user_id` everywhere.
- **Confidence isn't stored** — it's derived from `open_questions` each run (§3). Phase 2's `actions.confidence` is
  redundant under this model; leave unused.
- **Behavioral conventions (not DDL):** dry-run writes nothing; on settle, non-selected options' rows → `skipped`,
  winner's rows (across **all** gated tasks) → execute (§8 Stage 6).

---

## 11. Producer ↔ validator loop (carried from V1)

- Every DECIDE draft passes the **validator** (opens real sources, verifies each claim; HTML breathing;
  links-everywhere — cheap now, `signal_url` pre-captured; relative dates; plain language; elevate vague actions). Max 3
  iterations; never clears → **deliver nothing** for that item (run proceeds).
- **Extends in Phase 4:** the validator will also gate **ACT-in-perform** actions before real execution (designed here,
  exercised when perform activates — §4, §14). In Phase 3 it gates DECIDE drafts only; draft-mode ACTs and dry-run need
  no gate.
- Orchestrator persists `report.md`/`validation.md` (sub-agents return text, don't write files — V1 harness note).

---

## 12. Regression guard — what must survive from V1 `act-and-decide`

| V1 behavior | Phase 3 home | Verdict |
|---|---|---|
| Derive 0/1/N decisions from context; obvious → just act (Case-0) | Stage 3 backstop + Stage 5 act path | **Preserved** — the "no-open-question" cluster of one |
| Actions live **inside decision options** (or a lone Case-0 act), never free-standing on a task | Stage 4 | **Preserved** — the earlier conflation, fixed |
| "No-blind-spot" deep dig; ≥10 in-channel messages before a draft; mirror voice; minimal | Stage 3 | **Now owned here** (Phase 2 deferred it) |
| Coordination nodes ("orchestration layer for later") | Stage 2–3 | **Now built** — research-once + ask-once across shared questions |
| Decisions **private**, STARTED, never finalized | Stage 5 | **Preserved** |
| Jupi HTML format + breathing + links + relative dates; producer↔validator; "deliver nothing" | §11 | **Preserved** |
| The pile = gated `actions` rows drained each run | Stage 0 / Stage 6 | **Read+recompute here; execute Phase 4** |
| `_ruled-out` negative memory | `status='dropped'` + no-resurrect (Phase 2) | **Preserved**; Stage 5 sets `dropped` on rule-out |
| Pattern → *rule* engine | Rule loop (Phase 5) | **Deferred** — Phase 3 has no rules (§14) |

---

## 13. Build sequence

1. **D2 `db.mjs` write-verbs** — foundation; smoke-test each.
2. **D1 skill skeleton** — port `SKILL.md` + `reference/*`, re-anchored on `db.mjs` + the window.
3. **D4 config** — `guardrails` (`mode`, `actBudget`, `policy`, `executedPing`).
4. **Stages 0–2** — refresh + pile-read; `query-window`; cluster + rank + `actBudget` bound.
5. **Stage 3** — research-once per cluster; the resolve/flip logic both ways (singleton backstop; question-resolves).
6. **D3 Stage 4–5** — full materialization + the 2×2 gate.
7. **Dry-run** — table + no-write guarantee (§7, §10).
8. **D5 validator loop** — wire it to gate DECIDE drafts (perform-ACT gating lands with Phase 4's executor).
9. **Stage 6** — recompute-on-settle function (poll/execute → Phase 4).
10. **D6 setup un-gating**; **D7 evals** alongside D1/D3; **D8 doc ticks**.

**Dogfood checkpoints (`sparkling-violet-42081696`):**
- `refresh-backlog` → `--dry-run` → table: ACT/DECIDE sane under the default 2×2?
- Seed **two tasks sharing a question** → confirm **one** decision gating both (the node).
- Flip a policy cell → verdict changes. Set `actBudget:1` → only the top cluster is researched/resolved.
- `mode:draft` real run → drafts appear; one private approach decision; `actions` rows correct + `user_id`.
- Finalize by hand → Stage 6: winner's actions across **all** gated tasks execute; siblings `skipped`.

**Out of Phase 3:** poll-detect loop, executor/trace/notify, EXECUTED write, rule authoring — Phase 4/5 (§14).

---

## 14. Deferred to Phase 4/5 (explicit seam)

- **Phase 4 — closing loop + perform mode.** Scheduled poll-detect; the **executor** (run a chosen option's ACT rows
  post-settle — including the authorized action from a Phase-3 *authorize* decision — write the trace on the signal, one
  optional EXECUTED ping, set Jupi `EXECUTED` — backend write still "to request", parent §8). **Perform mode activates
  here**: the same executor also fires immediate perform-ACTs (real sends/posts/commits), so `mode:"perform"` becomes
  operational, with validator-gated sends (§11). Phase 3 ships and dogfoods **draft-only** and posts the decisions
  (approach *and* authorize); one executor serves both immediate perform-ACTs and the settled-decision closing loop, so
  it's built once, here.
- **Phase 5 — rule loop (how business rules come to exist).** Rules aren't authored; they **precipitate** from the
  running loop (parent §2: reactive, grounded in past decisions + habits, no proactive pass):
  1. Phases 3–4 raise + settle approach decisions → a Jupi log of *"when X, the owner chose Y."*
  2. Phase 5: before raising the same decision again, act-and-decide spots the recurrence (`search-decisions`) and
     instead posts a **rule-decision** — *"When X, always Y?"* (V1 types 2/4) — bundled with the live instance.
  3. **Owner approves** → the rule is a resolved rule-decision in Jupi, **indexed in `proactive-jupi/assets.md`** (empty
     today).
  4. **Read-side** (the deferred "D9"): a matching task's open-question is then **pre-empted against the rules index →
     confidence high → act without asking** — the task type "graduates from decide to act" (parent §9). Write side and
     read side are one feature; both need rules to exist → both Phase 5. In Phase 3, confidence is driven purely by the
     parser's `open_questions`, which is complete on its own.

---

## 15. Open items / decisions you may want to flip

- **`actBudget` default (5).** Bounds clusters researched per run; interacts with cadence (parent §7). Tune on dogfood.
- **`risk → exposure` column rename** — deferred (kept `actions.risk` as the store). Rename if the prose/DDL mismatch grates.
- **First setup run = `--dry-run`** — proves the loop with zero side-effect. *Flip:* a real draft-mode run.
- **Perform-mode validator latency** — a round-trip per external send; fine at low volume, revisit at scale.
