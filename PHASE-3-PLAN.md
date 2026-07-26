# Phase 3 — Act-or-Decide + Action Planner (Implementation Plan)

> **Implementation status (2026-07-22):** ✅ **built** — `shared/schema.sql` (`ready`/`blocked` statuses +
> migrations), `shared/db.mjs` (queue write-verbs), `guardrails` config, the **`act-or-decide`** planner skill
> (+ `ORCHESTRATION.md`/`VALIDATOR.md`), the **`execute-actions`** worker skill, setup step-8 un-gate, and
> `evals/act-or-decide/`. Not yet exercised against the live Neon instance / in a real run — see §13 dogfood.
>
> **Status:** Draft v0.5 · 2026-07-22 · Owner: Anne-Claire · Living doc.
> Companion to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §5, §6, §11 and to [PHASE-2-PLAN.md](PHASE-2-PLAN.md).
> Ports the V1 `act-or-decide` (`jupi-skills` @ `auto-jupi`); the carry-over ledger (§12) tracks what must survive.
>
> **v0.5 — planning and execution are separated.** `act-or-decide` **reasons only** — it reads the world and writes
> **Neon action rows + Jupi decisions**, and **never touches the user's tools**. A new `execute-actions` worker is the
> **only** thing that touches user tools; it runs `ready` action rows, triggered **(a)** at the end of an act-or-decide
> run and **(b)** when a decision finalizes. The `actions` table is the queue between them. (v0.4 simplified to one loop
> over open-question clusters + a 2×2 gate; v0.3 set the model — confidence from open-questions, `risk → exposure`.)

---

## 1. What Phase 3 delivers (one paragraph)

Two components with a clean boundary. **`act-or-decide`** (the planner) refreshes the backlog (Phase 2's
`refresh-backlog`), reads the scored top-window (`query-window`), **clusters it by shared open-question** (a task with no
open question is a cluster of one), ranks clusters by **leverage**, and for the top ones within a per-run **budget**
**researches once**, then **gates** each candidate action on **confidence × exposure** — writing either a **`ready`**
action row (act) or a **Jupi decision** (decide) whose options live in Jupi and gate **every task in the cluster** via
`gating_decision_ids` (the coordination node). It writes **only Neon + Jupi**. **`execute-actions`** (the worker)
then runs the `ready` rows against the user's tools — in Phase 3, **draft-only**. A **dry-run flag** previews the plan
without writing anything. This closes the roadmap item "un-gate `setup-proactive-jupi`: create the `act-or-decide`
routine and fire one first run at the end of setup."

---

## 2. Steering decisions (locked through review)

| # | Fork | Choice |
|---|---|---|
| P3-1 | Task source | **Backlog-read only** — consume Phase 2's scored tasks via `query-window`. |
| P3-2 | Gate model | **Configurable 2×2 matrix** — `confidence (high/low) × exposure (low/high)`; config picks which cells ACT vs DECIDE (the parent §6 table). |
| P3-3 | Draft mode | **Global switch** — `draft`/`perform`; read by the *gate* (draft form ⇒ low exposure ⇒ more ACT) and applied by `execute-actions`, which runs draft or real with the *same* executor (§8b). Perform is a **config flip, not a build**; default `draft`. What's Phase 4 is the **closing loop** (settled-decision execution), not a perform path. |
| P3-4 | Confidence | **Binary, from `open_questions`** — none ⇒ `high` (act-eligible); a genuine open question ⇒ `low` ⇒ DECIDE. Runtime, not persisted. *(Phase 5 rules will empty open-questions upstream — §14.)* |
| P3-5 | Second axis | **`exposure`** (was "risk") — **draft-first**, then destination/sensitivity/irreversibility. Stored column stays `actions.risk` (§10). |
| P3-6 | Decision mechanism | **One mechanism** — DECIDE posts a Jupi decision (Phase 3). Options read as *"which approach?"* (low confidence) or *"do exactly this / hold / modify"* (high confidence + high exposure, can't draft) — content, not machinery. |
| P3-7 | Bound | **One per-run `actBudget`** — research the top-ranked clusters up to it; the rest wait. |
| P3-8 | **Plan/execute split** | **`act-or-decide` writes only Neon + Jupi; `execute-actions` is the only tool-writer — a draft is a tool write, so it too runs through `execute-actions`.** The `actions` table is the queue; `execute-actions` runs `ready` rows, triggered at end-of-run and on decision-finalize (§8). |

---

## 3. Prerequisite — the Phase 2 backlog (satisfied) + terminology

Phase 3 stands on merged Phase 2:
- **`refresh-backlog`** — parses signals → scored `tasks` (`status='open'`), cheap/read-only.
- **`shared/db.mjs` `query-window [K]`** — top-K open tasks by `score desc`, `user_id`-scoped.
- **Columns read:** `summary`, `signal_url` (clickable, pre-captured — **no refetch**), `external` (**an exposure
  input**, §5), `relevant_facts`, `open_questions` (the **cluster key** + confidence source), `gating_decision_ids`.

**Terminology — three axes, kept distinct** (CLAUDE.md "don't conflate"):
- **`relevance`** — task-level, Scorer: *is this real / worth surfacing?* (noise gate). Persisted.
- **confidence** — task-level, act-or-decide: *do we know how to handle it?* **Binary: are `open_questions` empty?** Runtime.
- **exposure** — **action-level**: *what's at stake if it fires?* Draft-first, then destination/irreversibility.

The gate pairs the *task's* confidence with each *action's* exposure.

---

## 4. The safety ladder — three levels across two components

Default sits at the safe end, loosens as trust builds (parent §7). Note the split: `act-or-decide` always just plans;
the ladder is really about **what `execute-actions` does** (and dry-run's short-circuit).

| Level | Flag / setting | `act-or-decide` writes | `execute-actions` does | Side effects |
|---|---|---|---|---|
| **0 · dry-run** | `--dry-run` (run arg) | *nothing* — classify only, render the table | not invoked | **None.** (§7) |
| **1 · draft (default)** | `mode:"draft"` | `ready` rows (act) + posts decisions (decide) | **creates drafts** for `ready` rows | Drafts + private decisions. No external send. |
| **2 · perform** *(config; default off)* | `mode:"perform"` | same planning | **fires the real verb** for `ready` rows | Real side effects, gate-permitting. |

**`mode` is config, not a phase.** The `execute-actions` executor runs a `ready` row's verb the same way whether it's a
draft or a real send (§8b) — so perform needs **no new execution code**; it's a config/trust flip, default `draft` for a
conservative Phase-3 dogfood. **Safe by construction:** the gate only ever marks *low-exposure* actions `ready` —
everything high-exposure is a decision (§5), whose action executes through the **closing loop (Phase 4)**. So real
*external* side-effects only ever happen via a settled decision + the closing loop (the golden rule). What Phase 4 adds
is that **closing loop** — the settle-trigger + `EXECUTED` bookkeeping (§14) — not a perform "path."

---

## 5. The gate — confidence × exposure, a configurable 2×2 (P3-2)

Confidence is **one binary value per task** (§3); exposure is tagged **per action**. The gate runs per action and its
verdict **only writes a row status** — it never executes:

```jsonc
// guardrails.policy — which cells ACT (→ a `ready` row) vs DECIDE (→ a Jupi decision; options live in Jupi).
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
1. **In the gate (`act-or-decide`):** it determines each action's verb form, hence its exposure. `draft` → draftable
   actions become their draft verb → `exposure=low` → **ACT** (a `ready` row whose `description` says "create draft…").
   Non-draftable high-exposure actions don't collapse → **DECIDE** (§5). Low-exposure reversible ones (RSVP, label,
   search) act in both modes.
2. **In the worker (`execute-actions`):** it just runs the verb the row already carries — creating the draft, or firing
   the real send — *the same tool-call either way* (§8b). No separate perform "path."

**Settled-decision actions always carry real verbs** and execute for real once chosen — the decision *was* the approval,
so draft mode caps only *immediate* acts, not the outcome of a decision.

---

## 7. Dry-run output — the classification table

`--dry-run` runs `act-or-decide` through the gate but **writes nothing** (no rows, no decisions) and **doesn't invoke
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
- Verdict reflects the current `mode`; footer notes mode + policy. Rendered to `act-or-decide/runs/run-XXX/report.md`.

---

## 8. Anatomy — two components, the `actions` table between them

> ⚠️ **Superseded by PHASE-4-PLAN §5 (v0.4).** Phase 4 refactors the worker to *purely functional*: `execute-actions` →
> **`execute-action`** performs the side-effect and returns the trace but writes **no** status; the **orchestrators** own
> bookkeeping (`act-or-decide` writes Neon `actions.status` for ACT; `act-post-decision` marks decided actions **done in
> Jupi**, never materializing them into Neon). Where this §8 says "the worker owns `actions.status`" or "materialize the
> chosen option as a `ready` row at settle," read [PHASE-4-PLAN.md](PHASE-4-PLAN.md) §2/§5 instead.

**Clean ownership: `act-or-decide` owns `tasks.status`; `execute-actions` owns `actions.status`.** Neither writes the
other's. Two state machines run in lockstep:

```
TASK   (act-or-decide):  open ──dispositioned──► done (acted) | blocked (decided) | dropped (ruled out)
                                             blocked ──its decision finalizes──► open  (recompute, Phase 4)

ACTION:  ACT    → insert a `ready` row ──execute-actions──► executed
         DECIDE → no row (options live in Jupi); the chosen option → `ready` at settle → executed
```

**The task status is the window filter.** `query-window` returns **`status='open'` only** — so the instant
`act-or-decide` dispositions a task (→ `done`/`blocked`/`dropped`) it leaves the window and is never re-picked. No
filtering on `gating_decision_ids` or execution is needed; the status carries it. A task is **`blocked`** iff it raised
a decision (any `gating_decision_ids` set); **`done`** once it acted (its `ready` rows queued) with no open decision;
**`dropped`** if ruled out.

**Pending option-actions are not stored in Neon** — they live in the Jupi decision (each option's `Action:` list).
Only rows that will *run* exist in `actions` (`ready → executed`): immediate acts, and the chosen option materialized at
settle. That drops the redundant Jupi↔Neon duplication — and the `pending_decision` / `skipped` / `candidate` statuses
with it.

### 8a. `act-or-decide` — the planner (writes only Neon + Jupi)

One skill, explicit stages. All Neon via **`${CLAUDE_PLUGIN_ROOT}/shared/db.mjs`** (never raw SQL, never the account-wide
MCP; auto-scoped by `user_id`). Clustering is **by open-question, not by task** — a task with two open questions is
gated by two decisions and unblocks only when **both** settle (`gating_decision_ids` is an array for this).

- **Boot:** read `.proactive-jupi/assets.md` (in full), `.claude/proactive-jupi.local.json` (`guardrails`, Jupi slug);
  parse `dry_run`, `mode`. No tree exploration.
- **Stage 0 — Refresh:** run `refresh-backlog` so the run reasons over a current window. **That's all** — because
  processed tasks are already out of `open` (they're `done`/`blocked`/`dropped`), there's no pile to re-read here.
  Detecting settled decisions and reopening `blocked` tasks is the **Phase 4 closing loop**, not this stage.
- **Stage 1 — Read the window:** `query-window [backlogWindowSize]` (returns `status='open'` only — §8 state machine).
- **Stage 2 — Cluster + rank + bound:** group the window by **shared open-question** (singletons for no-question tasks);
  rank clusters by **leverage** (value unblocked per decision, not per-task score); keep the **top clusters up to
  `actBudget`** (P3-7); the rest wait.
- **Stage 3 — Research each kept cluster once** (decision is the *outcome*, not the premise): deepen `relevant_facts`
  (`update-brain` targeted for gaps — never writing Facts), read past decisions (`search-decisions`), pull **≥10
  in-channel messages before any message draft** (V1 rule). Then per cluster: a singleton with no open question →
  confidence `high` (but the dig is the backstop — a hidden trade-off makes it a decision, matched to an existing one if
  one fits); an open question → research **resolves** it (→ `high`, act) **or** leaves a real trade-off (→ `low`, one
  decision).
- **Stage 4 — Action Planner (plan; emit in Stage 5):** expand each task into concrete parallel actions, each with
  `tool`, `description`, `exposure`; run the gate per action. **Decision cluster** → prepare the concrete per-task
  **option-actions for the Jupi decision** (each option's `Action:` list) — **not Neon rows**. **Act task** → prepare
  the `ready` action(s) (`decision_id` null, `exposure` tagged, verb per `mode`).
- **Stage 5 — Emit (write status; no execution):** **ACT** → `insert-action` (lands `ready`). **DECIDE** → author the
  Jupi decision (V1 HTML + validator §11), then `set-task-gating` the task(s) with its id — **no `actions` rows for
  pending options** (Jupi holds them). **Then set the task's status** (act-or-decide owns it, §8): **`blocked`** if it
  raised a decision, else **`done`** (acted / nothing to do); a ruled-out task → **`dropped`** (the V1 `_ruled-out`
  memory). This is what removes it from the `open` window. In dry-run, none of this writes — it renders the §7 table.
- **Hand-off:** on a real (non-dry) run, invoke **`execute-actions`** on the rows just set `ready` (trigger *a*).

### 8b. `execute-actions` — the worker (the only tool-writer)

Dead-simple: **`SELECT ready rows; run each; mark `executed` + `trace_ref`.`** It touches **only `actions.status`** —
never `tasks.status` (that's act-or-decide's, §8). **One path, not two** — it runs whatever verb the row carries
(`create_draft`, `send_email`, `label`, `book`…); a draft and a real send are the *same* tool-call mechanism, and the
planner already chose the verb (per `mode`). So there is no separate "draft path" vs "perform path" — the executor is
complete once built. Two triggers:
- **(a) end of an `act-or-decide` run** *(Phase 3)* — run the immediate ACTs just queued.
- **(b) decision finalize** *(Phase 4 closing loop)* — **materialize the chosen option's action as a `ready` row** (per
  gated task, faithful to the Jupi option — pending options were never stored in Neon), run them (same executor), then
  **reopen the `blocked` task (`→ open`)** so act-or-decide re-dispositions it (may act → `done`, or spawn a fresh
  decision → `blocked`). That materialize-and-reopen *is* "recompute-on-settle."

**What's actually Phase 4 is trigger (b), not a different execution path** — the scheduled poll, `set Jupi EXECUTED`, the
optional ping, the reopen — deferred because it's **blocked on the Jupi FINALIZED read + EXECUTED-write** (parent §8),
not because real verbs are harder to run.

**`mode` is config, not a phase.** The executor runs draft or real identically; Phase 3 defaults to `draft` for a
conservative dogfood. The safety invariant holds in either mode: **only low-exposure actions ever reach `ready`**
(high-exposure is always a decision, §5), so real *external* side-effects only happen via a settled decision + the
closing loop — exactly the golden rule.

**Known limitation:** factorization that only surfaces on the **deep** dig — two singletons that turn out to share a
question invisible at the shallow stage — is missed within a run; they cluster next run once the question is on record.

---

## 9. Deliverables

| # | Deliverable | New / changed |
|---|---|---|
| D1 | **`act-or-decide` skill** — planner: `skills/act-or-decide/{SKILL.md, reference/ORCHESTRATION.md, reference/VALIDATOR.md}`, ported from V1, re-anchored on `db.mjs`. Writes only Neon + Jupi (§8a). | new |
| D2 | **`shared/db.mjs` write-verbs** — `insert-action '<json>'`, `set-action-status <id> <status> [trace_ref]`, `set-task-status <id> <open\|blocked\|done\|dropped>`, `set-task-gating <task_id> '<decision_ids[]>'`, `list-actions <status\|decision_id>` (queue read for the worker). Parameterized, `user_id`-scoped. *(act-or-decide calls `set-task-status`; execute-actions calls `set-action-status` — §10 ownership.)* | changed |
| D3 | **`execute-actions` skill** — the worker: reads `ready` rows, runs **each row's verb** (draft or real — same tool-call), marks `executed`+`trace_ref`; invoked at end of an act-or-decide run (trigger *a*). The **closing loop** (trigger *b*: poll settle → run → `EXECUTED` + ping + reopen) is Phase 4 (§14). | new |
| D4 | **Gate + draft-mode + dry-run** in `act-or-decide` — §5 2×2, §6 verb form, §7 no-write table. | new |
| D5 | **Config** — `guardrails` (`mode`, `actBudget`, `policy`, `executedPing`); reuse `backlogWindowSize`. | changed |
| D6 | **Producer↔validator loop** — carry `ORCHESTRATION.md`/`VALIDATOR.md`; validator gates DECIDE drafts, and vets a real send before `execute-actions` fires it (runs when `perform` is enabled). | new/changed |
| D7 | **Un-gate `setup-proactive-jupi`** — create the `act-or-decide` routine; fire one first run as `--dry-run`. | changed |
| D8 | **`evals/act-or-decide/`** — gate classification; a coordination-node case (2+ tasks sharing a question → **one** decision); injection safety (a signal body must not drive an action/decision). Scratch-isolated. | new |
| D9 | **Doc updates** — tick Phase 3 items in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) as they land. | changed |

### Config surface (front-loaded, per CLAUDE.md)

```jsonc
// .claude/proactive-jupi.local.json + reference/proactive-jupi.local.json.template — set in setup's attended prelude
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

`shared/schema.sql` changes (all idempotent):
- **`actions.status` → `ready | executed`** — narrowed from Phase 2's `candidate|pending_decision|executed|skipped`.
  A row exists only for an action that will run (immediate act, or a settled decision's chosen option materialized at
  settle); pending options live in Jupi. Migration coerces legacy rows (`candidate → ready`, delete `pending_decision`/
  `skipped`), narrows the CHECK, sets default `ready`, and drops the vestigial `actions.confidence`.
- **`blocked` on `tasks.status`** (`candidate|open|blocked|done|dropped`) — a task awaiting a decision. This is what
  keeps `query-window` (`status='open'` only) from re-surfacing a task act-or-decide already handled — **the status is
  the filter** (§8).
- **Status ownership** (mirrors the split): **`act-or-decide` writes `tasks.status`** (`open → done|blocked|dropped`,
  and `blocked → open` on settle); **`execute-actions` writes `actions.status`** (`ready → executed`). Enforced by
  convention in the skills, not the DB. *(⚠️ Revised in Phase 4 — PHASE-4-PLAN §5: the worker writes **no** status;
  `act-or-decide` writes `actions.status`, and `act-post-decision` owns the `blocked → done|open` settle transitions.)*
- `actions.risk` **stores the *exposure* value** (P3-5); keep the column name. *(Optional rename.)*
- `decision_id`/`option_id`, `tasks.gating_decision_ids` (array → multi-gating), `tasks.external`, `tasks.signal_url`,
  `user_id` everywhere — already present.
- **Confidence isn't stored** — derived from `open_questions` each run (§3). Phase 2's `actions.confidence` is **dropped** (`alter table actions drop column if exists confidence`).
- **Conventions:** dry-run writes nothing; on settle, the chosen option is **materialized as `ready` rows** across
  **all** gated tasks (from the Jupi option — nothing was pre-stored), and the `blocked` task → `open` (§8b).

---

## 11. Producer ↔ validator loop (carried from V1)

- Every DECIDE draft passes the **validator** (opens real sources, verifies each claim; HTML breathing; links-everywhere
  — cheap now, `signal_url` pre-captured; relative dates; plain language; elevate vague actions). Max 3 iterations; never
  clears → **deliver nothing** for that item (run proceeds).
- **Also gates real sends:** before `execute-actions` fires a real (non-draft) verb, the same validator vets it —
  exercised whenever `perform` is enabled (config, not a phase). Draft ACTs and dry-run need no gate.
- Orchestrator persists `report.md`/`validation.md` (sub-agents return text, don't write files — V1 harness note).

---

## 12. Regression guard — what must survive from V1 `act-or-decide`

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

1. **D2 `db.mjs` write-verbs** + **`ready` (actions) & `blocked` (tasks) statuses** (§10) — the foundation; smoke-test each verb.
2. **D1 `act-or-decide` skeleton** — port `SKILL.md` + `reference/*`, re-anchored on `db.mjs` + the window.
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
- `mode:draft` real run → `act-or-decide` writes `ready` rows + a private decision, and sets each task's status
  (**`done`** for acted, **`blocked`** for decided); `execute-actions` turns the `ready` rows into **real drafts** in
  Gmail/Linear. Re-run → the `done`/`blocked` tasks **don't** reappear in the window (status is the filter). *(Non-draftable
  high-exposure decisions post but don't execute until Phase 4 — expected, not a defect.)*

**Out of Phase 3:** poll-detect loop, perform-path execution, trace/notify, EXECUTED write, rule authoring — Phase 4/5.

---

## 14. Deferred to Phase 4/5 (explicit seam)

- **Phase 4 — the closing loop** (trigger *b* of the *same* `execute-actions` worker; **not** a new execution path).
  Blocked on the Jupi FINALIZED read + EXECUTED-write (parent §8). Scheduled **poll-detect** of FINALIZED decisions →
  materialize the chosen option as `ready` rows (per gated task, from Jupi) → run them (same executor) → **reopen the `blocked`
  task (`→ open`)** → write the **trace** on the signal → one optional **EXECUTED ping** (`executedPing`) → set Jupi
  **`EXECUTED`**. This is what makes settled decisions — hence every high-exposure/external action (§5) — actually fire.
  *(Perform mode itself is just config on the Phase-3 executor, §4; enabling it is a trust decision, not a Phase-4 build.)*
- **Phase 5 — rule loop (how business rules come to exist).** *(Superseded by the detailed **[PHASE-5-PLAN.md](PHASE-5-PLAN.md)**,
  which promotes rules to a **hybrid store** — Jupi approves, a `businessRuleStore` holds the durable text — and adds the
  `[BR]` decision kind + read-side pre-emption. The sketch below is the original seam it grew from.)* Rules aren't authored;
  they **precipitate** from the running loop (parent §2: reactive, grounded in past decisions + habits, no proactive pass):
  1. Phases 3–4 raise + settle decisions → a Jupi log of *"when X, the owner chose Y."*
  2. Phase 5: before re-raising, `act-or-decide` spots the recurrence (`search-decisions`) and posts a **rule-decision**
     — *"When X, always Y?"* (V1 types 2/4) — bundled with the live instance.
  3. **Owner approves** → the rule is a resolved rule-decision in Jupi, **indexed in `.proactive-jupi/assets.md`**.
  4. **Read-side:** a matching task's open-question is then **pre-empted against the rules index → confidence high → act
     without asking** — "graduates from decide to act" (parent §9). Write + read need rules to exist → both Phase 5. In
     Phase 3, confidence is driven purely by the parser's `open_questions`.

---

## 15. Open items / decisions you may want to flip

- **`actBudget` default (5).** Bounds clusters researched per run; interacts with cadence. Tune on dogfood.
- **`risk → exposure` column rename** — deferred (kept `actions.risk`). Rename if the mismatch grates.
- **First setup run = `--dry-run`** — proves the loop with zero side-effect. *Flip:* a real draft-mode run.
