# Phase 3 — Act-or-Decide + Action Planner (Implementation Plan)

> **Status:** Draft v0.5 · 2026-07-22 · Owner: Anne-Claire · Living doc.
> Companion to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §5, §6, §11 and to [PHASE-2-PLAN.md](PHASE-2-PLAN.md).
> Ports the V1 `act-and-decide` (`jupi-skills` @ `auto-jupi`); the carry-over ledger (§12) tracks what must survive.
>
> **v0.5 — planning and execution are separated.** `act-and-decide` **reasons only** — it reads the world and writes
> **Neon action rows + Jupi decisions**, and **never touches the user's tools**. A new `execute-actions` worker is the
> **only** thing that touches user tools; it runs `ready` action rows, triggered **(a)** at the end of an act-and-decide
> run and **(b)** when a decision finalizes. The `actions` table is the queue between them. (v0.4 simplified to one loop
> over open-question clusters + a 2×2 gate; v0.3 set the model — confidence from open-questions, `risk → exposure`.)

---

## 1. What Phase 3 delivers (one paragraph)

Two components with a clean boundary. **`act-and-decide`** (the planner) refreshes the backlog (Phase 2's
`refresh-backlog`), reads the scored top-window (`query-window`), **clusters it by shared open-question** (a task with no
open question is a cluster of one), ranks clusters by **leverage**, and for the top ones within a per-run **budget**
**researches once**, then **gates** each candidate action on **confidence × exposure** — writing either a **`ready`**
action row (act) or a **Jupi decision** with `pending_decision` rows (decide), where one decision can gate rows across
**every task in a cluster** (the coordination node). It writes **only Neon + Jupi**. **`execute-actions`** (the worker)
then runs the `ready` rows against the user's tools — in Phase 3, **draft-only**. A **dry-run flag** previews the plan
without writing anything. This closes the roadmap item "un-gate `setup-proactive-jupi`: create the `act-and-decide`
routine and fire one first run at the end of setup."

---

## 2. Steering decisions (locked through review)

| # | Fork | Choice |
|---|---|---|
| P3-1 | Task source | **Backlog-read only** — consume Phase 2's scored tasks via `query-window`. |
| P3-2 | Gate model | **Configurable 2×2 matrix** — `confidence (high/low) × exposure (low/high)`; config picks which cells ACT vs DECIDE (the parent §6 table). |
| P3-3 | Draft mode | **Global switch** — `draft`/`perform`; read by the *gate* (draft form ⇒ low exposure ⇒ more ACT) and applied by `execute-actions`. Draft is Phase 3-operational; perform activates with Phase 4's executor. |
| P3-4 | Confidence | **Binary, from `open_questions`** — none ⇒ `high` (act-eligible); a genuine open question ⇒ `low` ⇒ DECIDE. Runtime, not persisted. *(Phase 5 rules will empty open-questions upstream — §14.)* |
| P3-5 | Second axis | **`exposure`** (was "risk") — **draft-first**, then destination/sensitivity/irreversibility. Stored column stays `actions.risk` (§10). |
| P3-6 | Decision mechanism | **One mechanism** — DECIDE posts a Jupi decision (Phase 3). Options read as *"which approach?"* (low confidence) or *"do exactly this / hold / modify"* (high confidence + high exposure, can't draft) — content, not machinery. |
| P3-7 | Bound | **One per-run `actBudget`** — research the top-ranked clusters up to it; the rest wait. |
| P3-8 | **Plan/execute split** | **`act-and-decide` writes only Neon + Jupi; `execute-actions` is the only tool-writer.** The `actions` table is the queue; `execute-actions` runs `ready` rows, triggered at end-of-run and on decision-finalize (§8). |

---

## 3. Prerequisite — the Phase 2 backlog (satisfied) + terminology

Phase 3 stands on merged Phase 2:
- **`refresh-backlog`** — parses signals → scored `tasks` (`status='open'`), cheap/read-only.
- **`shared/db.mjs` `query-window [K]`** — top-K open tasks by `score desc`, `user_id`-scoped.
- **Columns read:** `summary`, `signal_url` (clickable, pre-captured — **no refetch**), `external` (**an exposure
  input**, §5), `relevant_facts`, `open_questions` (the **cluster key** + confidence source), `gating_decision_ids`.

**Terminology — three axes, kept distinct** (CLAUDE.md "don't conflate"):
- **`relevance`** — task-level, Scorer: *is this real / worth surfacing?* (noise gate). Persisted.
- **confidence** — task-level, act-and-decide: *do we know how to handle it?* **Binary: are `open_questions` empty?** Runtime.
- **exposure** — **action-level**: *what's at stake if it fires?* Draft-first, then destination/irreversibility.

The gate pairs the *task's* confidence with each *action's* exposure.

---

## 4. The safety ladder — three levels across two components

Default sits at the safe end, loosens as trust builds (parent §7). Note the split: `act-and-decide` always just plans;
the ladder is really about **what `execute-actions` does** (and dry-run's short-circuit).

| Level | Flag / setting | `act-and-decide` writes | `execute-actions` does | Side effects |
|---|---|---|---|---|
| **0 · dry-run** | `--dry-run` (run arg) | *nothing* — classify only, render the table | not invoked | **None.** (§7) |
| **1 · draft (default)** | `mode:"draft"` | `ready`/`pending_decision` rows + posts decisions | **creates drafts** for `ready` rows | Drafts + private decisions. No external send. |
| **2 · perform** *(Phase 4)* | `mode:"perform"` | same planning | **fires the real verb** for `ready` rows | Real side effects, gate-permitting. |

**Phase 3 is draft-operational; perform activates in Phase 4** — the executor's real-verb path (sends/posts/bookings) +
trace/notify + the on-finalize trigger are the Phase 4 build (§14). Phase 3's `execute-actions` is **safe by
construction**: the gate only ever marks *draftable / low-exposure* actions `ready` — everything risky is a decision
(§5), so there's nothing dangerous in the queue.

---

## 5. The gate — confidence × exposure, a configurable 2×2 (P3-2)

Confidence is **one binary value per task** (§3); exposure is tagged **per action**. The gate runs per action and its
verdict **only writes a row status** — it never executes:

```jsonc
// guardrails.policy — which cells ACT (→ a `ready` row) vs DECIDE (→ a decision + `pending_decision` rows).
{
  "high": { "low": "act",    "high": "decide" },   // confident + safe → act; confident + exposed → decide (authorize)
  "low":  { "low": "decide", "high": "decide" }     // open question → decide (approach), whatever the exposure
}
```

- **Confidence** — no open question ⇒ `high`; a live trade-off ⇒ `low` ⇒ DECIDE regardless of exposure (parent §6
  "hesitating on what to say → decide").
- **Exposure — draft-first (P3-5)**, but **draft-first only helps actions with a draft form.** A **non-draftable**
  action (book a venue, raise a budget, submit a payment, merge a PR) is scored by destination directly —
  `tasks.external`, recipient sensitivity (peer < manager < CEO < external), irreversibility → `high` when any bites.
- **The `high × high` cell** → **DECIDE** (*authorize*, posted like any decision). It fires in **draft mode** whenever the
  action **can't be drafted**; in **perform mode** also for draftable actions sent for real. The *decision* is Phase 3;
  *executing* the authorized action is Phase 4.
- **This matrix is the "configurable threshold."** Tighten = flip cells to `decide`. Config, §9.

---

## 6. Draft mode — read by the gate, applied by the worker (P3-3)

`mode` matters in **two** places, which is why it's plain config both read:
1. **In the gate (`act-and-decide`):** it determines each action's verb form, hence its exposure. `draft` → draftable
   actions become their draft verb → `exposure=low` → **ACT** (a `ready` row whose `description` says "create draft…").
   Non-draftable high-exposure actions don't collapse → **DECIDE** (§5). Low-exposure reversible ones (RSVP, label,
   search) act in both modes.
2. **In the worker (`execute-actions`):** it just runs the verb the row already carries — creating the draft (draft
   mode) or firing the real send (perform mode, Phase 4).

**Settled-decision actions always carry real verbs** and execute for real once chosen — the decision *was* the approval,
so draft mode caps only *immediate* acts, not the outcome of a decision.

---

## 7. Dry-run output — the classification table

`--dry-run` runs `act-and-decide` through the gate but **writes nothing** (no rows, no decisions) and **doesn't invoke
`execute-actions`**:

| Task | conf | Action (what would happen) | exposure | Verdict | Decision |
|---|---|---|---|---|---|
| Reply to Alice re: pricing | high | Draft email to alice@x.com confirming Tue 2pm | low | **ACT** | — |
| Sharpist brief | high | Create "Sharpist Brief" doc in GTM project | low | **ACT** | — |
| | | Share the doc with Paul | low | **ACT** | — |
| Renewal to CEO | high | Draft renewal email to ceo@bigco.com | low | **ACT** | — *(perform: send → exposure high → DECIDE)* |
| Book the Q3 offsite venue | high | Reserve venue for 2026-09-15 | high | **DECIDE** | *authorize* → "Book Vault SF?" — **no draft form** |
| Q3 pricing *(3 threads)* | low | *(clustered)* reply to each thread | low | **DECIDE** | *approach* → "What's our Q3 pricing?" → gates **3 tasks** |

- **Confidence is a task attribute** (blank on continuation rows); **exposure + verdict are per action**.
- Pricing row = the **coordination node** (one decision, three tasks). Venue row = **non-draftable high-exposure** →
  authorize decision even in draft mode. CEO row = draftable high-exposure that draft mode collapses to ACT.
- Verdict reflects the current `mode`; footer notes mode + policy. Rendered to `act-and-decide/runs/run-XXX/report.md`.

---

## 8. Anatomy — two components, the `actions` table between them

**The `actions.status` state machine is the contract.** `act-and-decide` moves rows *into* `ready`/`pending_decision`;
`execute-actions` moves `ready` *out* to `executed`:

```
candidate ──gate:ACT──────────────► ready ──execute-actions──► executed
    └─────gate:DECIDE──► pending_decision ──decision finalize──► ready (chosen) | skipped (siblings)
```

### 8a. `act-and-decide` — the planner (writes only Neon + Jupi)

One skill, explicit stages. All Neon via **`${CLAUDE_PLUGIN_ROOT}/shared/db.mjs`** (never raw SQL, never the account-wide
MCP; auto-scoped by `user_id`). Clustering is **by open-question, not by task** — a task with two open questions is
gated by two decisions and unblocks only when **both** settle (`gating_decision_ids` is an array for this).

- **Boot:** read `assets.md` (in full), `guardrails`, Jupi slug; parse `dry_run`, `mode`. No tree exploration.
- **Stage 0 — Refresh + read the pile:** run `refresh-backlog` (fresh window); read the statuses of decisions this task
  set previously posted so the run doesn't re-post a decision for a task already awaiting one. *(The standing poll +
  execution of settled decisions is the Phase 4 closing loop.)*
- **Stage 1 — Read the window:** `query-window [backlogWindowSize]`.
- **Stage 2 — Cluster + rank + bound:** group the window by **shared open-question** (singletons for no-question tasks);
  rank clusters by **leverage** (value unblocked per decision, not per-task score); keep the **top clusters up to
  `actBudget`** (P3-7); the rest wait.
- **Stage 3 — Research each kept cluster once** (decision is the *outcome*, not the premise): deepen `relevant_facts`
  (`update-brain` targeted for gaps — never writing Facts), read past decisions (`search-decisions`), pull **≥10
  in-channel messages before any message draft** (V1 rule). Then per cluster: a singleton with no open question →
  confidence `high` (but the dig is the backstop — a hidden trade-off makes it a decision, matched to an existing one if
  one fits); an open question → research **resolves** it (→ `high`, act) **or** leaves a real trade-off (→ `low`, one
  decision).
- **Stage 4 — Action Planner (materialize fully):** **decision cluster** → for **each option**, plan the per-task
  action(s) and insert **all** as `pending_decision` rows (`decision_id`+`option_id`, own `exposure`). **Act task** →
  insert the action(s) directly (`decision_id` null, `exposure` tagged), verb per `mode`.
- **Stage 5 — Gate + emit (status only, no execution):** per action `(confidence × exposure)` → **ACT** sets the row
  `ready`; **DECIDE** authors the Jupi decision (V1 HTML + validator §11) and leaves its rows `pending_decision` with
  `gating_decision_ids` set. Resolve tasks `done`/`dropped` (a ruled-out task → `dropped`, the V1 `_ruled-out` memory).
  In dry-run, none of this writes — it renders the §7 table.
- **Hand-off:** on a real (non-dry) run, invoke **`execute-actions`** on the rows just set `ready` (trigger *a*).

### 8b. `execute-actions` — the worker (the only tool-writer)

Dead-simple: **`SELECT ready rows; run each; mark `executed` + `trace_ref`.`** Runs the verb the row carries — draft
(Phase 3) or real send (perform, Phase 4). Two triggers, same core:
- **(a) end of an `act-and-decide` run** — the immediate ACTs just queued.
- **(b) decision finalize** *(Phase 4 closing loop)* — flip the chosen option's rows `pending_decision → ready`, siblings
  → `skipped`, then run. If executing surfaces a new trade-off, **re-invoke `act-and-decide` on that task** (recursion) —
  that's "recompute-on-settle," just a scoped planner run.

*Phase 3 builds trigger (a) with the **draft path**. Phase 4 adds the **real-verb path**, trigger (b), the trace on the
signal, the EXECUTED ping, and Jupi `EXECUTED` (§14).*

**Known limitation:** factorization that only surfaces on the **deep** dig — two singletons that turn out to share a
question invisible at the shallow stage — is missed within a run; they cluster next run once the question is on record.

---

## 9. Deliverables

| # | Deliverable | New / changed |
|---|---|---|
| D1 | **`act-and-decide` skill** — planner: `skills/act-and-decide/{SKILL.md, reference/ORCHESTRATION.md, reference/VALIDATOR.md}`, ported from V1, re-anchored on `db.mjs`. Writes only Neon + Jupi (§8a). | new |
| D2 | **`shared/db.mjs` write-verbs** — `insert-action '<json>'`, `set-action-status <id> <status> [trace_ref]`, `set-task-gating <task_id> '<decision_ids[]>'`, `close-task <id> <done\|dropped>`, `list-actions <status\|decision_id>` (queue read for the worker). Parameterized, `user_id`-scoped. | changed |
| D3 | **`execute-actions` skill** — the worker: reads `ready` rows, runs the draft path, marks `executed`+`trace_ref`; invoked at end of an act-and-decide run. Perform path + finalize trigger + trace/notify are Phase 4 (§14). | new |
| D4 | **Gate + draft-mode + dry-run** in `act-and-decide` — §5 2×2, §6 verb form, §7 no-write table. | new |
| D5 | **Config** — `guardrails` (`mode`, `actBudget`, `policy`, `executedPing`); reuse `backlogWindowSize`. | changed |
| D6 | **Producer↔validator loop** — carry `ORCHESTRATION.md`/`VALIDATOR.md`; validator gates DECIDE drafts (perform-send gating → Phase 4). | new/changed |
| D7 | **Un-gate `setup-proactive-jupi`** — create the `act-and-decide` routine; fire one first run as `--dry-run`. | changed |
| D8 | **`evals/act-and-decide/`** — gate classification; a coordination-node case (2+ tasks sharing a question → **one** decision); injection safety (a signal body must not drive an action/decision). Scratch-isolated. | new |
| D9 | **Doc updates** — tick Phase 3 items in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) as they land. | changed |

### Config surface (front-loaded, per CLAUDE.md)

```jsonc
// .claude/setup.local.json + reference/setup.local.json.template — set in setup's attended prelude
"guardrails": {
  "mode": "draft",            // "draft" (default) | "perform"  — read by the gate, applied by execute-actions
  "actBudget": 5,             // max clusters researched + resolved per run (P3-7); rest wait
  "policy": {                 // the configurable confidence × exposure 2×2 (§5)
    "high": { "low": "act",    "high": "decide" },
    "low":  { "low": "decide", "high": "decide" }
  },
  "executedPing": "none"      // "email" | "slack" | "none" — the one closing ping (Phase 4)
}
// window reuses the EXISTING top-level "backlogWindowSize" (default 30).
```

---

## 10. Schema touchpoints

`shared/schema.sql` needs **one small change** — a `ready` status:
- **Add `ready`** to `actions.status` (`candidate|ready|pending_decision|executed|skipped`) — the queue handoff between
  the planner and the worker (§8). One idempotent CHECK-constraint update.
- `actions.risk` **stores the *exposure* value** (P3-5); keep the column name, prose says "exposure." *(Optional rename.)*
- `decision_id`/`option_id`, `tasks.gating_decision_ids` (array → multi-gating), `tasks.external`, `tasks.signal_url`,
  `user_id` everywhere — all already present.
- **Confidence isn't stored** — derived from `open_questions` each run (§3). Phase 2's `actions.confidence` is redundant;
  leave unused.
- **Conventions:** dry-run writes nothing; on settle, chosen option's rows (across **all** gated tasks) → `ready`,
  siblings → `skipped` (§8b).

---

## 11. Producer ↔ validator loop (carried from V1)

- Every DECIDE draft passes the **validator** (opens real sources, verifies each claim; HTML breathing; links-everywhere
  — cheap now, `signal_url` pre-captured; relative dates; plain language; elevate vague actions). Max 3 iterations; never
  clears → **deliver nothing** for that item (run proceeds).
- **Extends in Phase 4:** the validator also gates real sends before `execute-actions` fires them (designed here,
  exercised when perform activates). In Phase 3 it gates DECIDE drafts only; draft-path ACTs and dry-run need no gate.
- Orchestrator persists `report.md`/`validation.md` (sub-agents return text, don't write files — V1 harness note).

---

## 12. Regression guard — what must survive from V1 `act-and-decide`

| V1 behavior | Phase 3 home | Verdict |
|---|---|---|
| Derive 0/1/N decisions from context; obvious → just act (Case-0) | §8a Stage 3 + Stage 5 | **Preserved** — the "no-open-question" cluster of one |
| Actions live **inside decision options** (or a lone Case-0 act), never free-standing on a task | §8a Stage 4 | **Preserved** — the earlier conflation, fixed |
| "No-blind-spot" deep dig; ≥10 in-channel messages before a draft; mirror voice; minimal | §8a Stage 3 | **Now owned here** (Phase 2 deferred it) |
| Coordination nodes ("orchestration layer for later") | §8a Stage 2–3 | **Now built** — research-once + ask-once across shared questions |
| Decisions **private**, STARTED, never finalized | §8a Stage 5 | **Preserved** |
| Jupi HTML format + breathing + links + relative dates; producer↔validator; "deliver nothing" | §11 | **Preserved** |
| **Execution is a distinct step** (V1 drained a pile, then acted) | `execute-actions` (§8b) | **Sharpened** — now its own worker, two triggers |
| `_ruled-out` negative memory | `status='dropped'` + no-resurrect (Phase 2) | **Preserved**; Stage 5 sets `dropped` on rule-out |
| Pattern → *rule* engine | Rule loop (Phase 5) | **Deferred** — Phase 3 has no rules (§14) |

---

## 13. Build sequence

1. **D2 `db.mjs` write-verbs** + **`ready` status** (§10) — the foundation; smoke-test each verb.
2. **D1 `act-and-decide` skeleton** — port `SKILL.md` + `reference/*`, re-anchored on `db.mjs` + the window.
3. **D5 config** — `guardrails`.
4. **§8a Stages 0–2** — refresh + pile-read; `query-window`; cluster + rank + `actBudget`.
5. **§8a Stage 3** — research-once per cluster; the resolve/flip logic both ways.
6. **D4 Stages 4–5** — full materialization + the 2×2 gate (status only, no execution).
7. **Dry-run** — table + no-write guarantee (§7, §10).
8. **D3 `execute-actions`** — the draft-path worker + end-of-run trigger.
9. **D6 validator loop** — gate DECIDE drafts.
10. **D7 setup un-gating**; **D8 evals**; **D9 doc ticks**.

**Dogfood checkpoints (`sparkling-violet-42081696`):**
- `--dry-run` → table: ACT/DECIDE sane under the default 2×2?
- Seed **two tasks sharing a question** → confirm **one** decision gating both.
- Flip a policy cell → verdict changes. `actBudget:1` → only the top cluster is resolved.
- `mode:draft` real run → `act-and-decide` writes `ready` rows + a private decision; `execute-actions` turns the `ready`
  rows into **real drafts** in Gmail/Linear. *(Non-draftable high-exposure decisions post but don't execute until
  Phase 4 — expected, not a defect.)*

**Out of Phase 3:** poll-detect loop, perform-path execution, trace/notify, EXECUTED write, rule authoring — Phase 4/5.

---

## 14. Deferred to Phase 4/5 (explicit seam)

- **Phase 4 — closing loop + perform mode**, all in `execute-actions`. Scheduled **poll-detect** of FINALIZED decisions →
  flip chosen rows `pending_decision → ready`, siblings `skipped` (trigger *b*); the **real-verb path** (sends/posts/
  bookings) so `mode:"perform"` and settled-decision actions actually fire; the **trace** on the signal; one optional
  **EXECUTED ping** (`executedPing`); set Jupi **`EXECUTED`** (backend write still "to request", parent §8);
  validator-gated sends (§11). One worker, extended — not rebuilt.
- **Phase 5 — rule loop (how business rules come to exist).** Rules aren't authored; they **precipitate** from the
  running loop (parent §2: reactive, grounded in past decisions + habits, no proactive pass):
  1. Phases 3–4 raise + settle decisions → a Jupi log of *"when X, the owner chose Y."*
  2. Phase 5: before re-raising, `act-and-decide` spots the recurrence (`search-decisions`) and posts a **rule-decision**
     — *"When X, always Y?"* (V1 types 2/4) — bundled with the live instance.
  3. **Owner approves** → the rule is a resolved rule-decision in Jupi, **indexed in `proactive-jupi/assets.md`**.
  4. **Read-side:** a matching task's open-question is then **pre-empted against the rules index → confidence high → act
     without asking** — "graduates from decide to act" (parent §9). Write + read need rules to exist → both Phase 5. In
     Phase 3, confidence is driven purely by the parser's `open_questions`.

---

## 15. Open items / decisions you may want to flip

- **`actBudget` default (5).** Bounds clusters researched per run; interacts with cadence. Tune on dogfood.
- **`execute-actions` scope in Phase 3** — plan builds the **draft path** so dogfooding shows real drafts. *Flip:* make
  `execute-actions` entirely Phase 4 (Phase 3 stops at `ready` rows, no drafts) for a strictly side-effect-free planner.
- **`risk → exposure` column rename** — deferred (kept `actions.risk`). Rename if the mismatch grates.
- **First setup run = `--dry-run`** — proves the loop with zero side-effect. *Flip:* a real draft-mode run.
