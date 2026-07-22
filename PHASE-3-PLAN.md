# Phase 3 — Act-or-Decide + Action Planner (Implementation Plan)

> **Status:** Draft v0.2 · 2026-07-22 · Owner: Anne-Claire · Living doc.
> Companion to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §5, §6, §11 and to [PHASE-2-PLAN.md](PHASE-2-PLAN.md).
> Builds the **downstream half** of the `act-and-decide` pipeline — coordination-node pass → confidence×risk gate →
> Action Planner → act (draft/perform) or post a Jupi decision — on top of the scored Neon backlog Phase 2 shipped.
> Ports the V1 `act-and-decide` (`jupi-skills` @ `auto-jupi`, `plugins/jupi/skills/act-and-decide/`); the carry-over
> ledger (§12) tracks what must survive.
>
> **v0.2 reconciles with merged Phase 2** (#7 user separation, #8 `refresh-backlog` + `shared/db.mjs`): the backlog
> contract is now *satisfied*, so the earlier "backlog seeder" mitigation is dropped (§3). New load-bearing facts from
> the shipped schema/helper — `query-window`, `tasks.external`, `tasks.signal_url`, `user_id` tenancy — are folded in.

---

## 1. What Phase 3 delivers (one paragraph)

The **`act-and-decide`** skill: it opens by refreshing the backlog (Phase 2's `refresh-backlog` as its cheap upstream
stage), reads the scored top-window from Neon (`query-window`), then runs the **coordination-node pass** — its opening move and
intellectual core: find the **single decision that resolves the most tasks at once** (the *factorizing* decision) and
commit the run to that highest-leverage cluster. It gathers deep context (no blind spots), then for each candidate
action runs the **confidence × risk gate** — **acting** when the task's confidence is high and the action is low-risk,
or **posting the structured Jupi decision** when unsure or risky. Acting is governed by a **draft-mode switch** (draft vs. perform) and previewable via a **dry-run flag**
(classify only, touch nothing). The **Action Planner** — downstream of that selection — expands the chosen task(s) into N parallel `actions` rows in
Neon (via new `db.mjs` write-verbs), each carrying its `decision_id`/`option_id` and executable instruction, and
**recomputes** every task the settled decision touched. The V1 producer↔validator gate is retained. This closes the roadmap item "un-gate
`setup-proactive-jupi`: create the `act-and-decide` routine and fire one first run at the end of setup."

---

## 2. Steering decisions (locked this session)

| # | Fork | Choice | Consequence |
|---|---|---|---|
| P3-1 | Task source | **Backlog-read only** — consume Phase 2's scored tasks via `query-window`. No self-scan inside act-and-decide. | Now fully satisfied by merged Phase 2 (§3). |
| P3-2 | Gate threshold model | **Configurable matrix cells** — categorical `confidence (low/med/high) × risk (low/high)`; config decides which cells ACT vs DECIDE. | The "threshold" *is* the policy matrix (§5). No numeric scoring. |
| P3-3 | Draft mode | **Global switch, gate always applies** — one setting (`draft`/`perform`); draft caps every act at its draft verb (lowers risk → more ACT); perform still routes genuinely high-risk actions to DECIDE. | Draft mode changes the *verb*, never bypasses the gate (§6). |

---

## 3. Prerequisite — the Phase 2 backlog (now satisfied)

P3-1 relies on a scored backlog. **Phase 2 (#8) shipped it**, so the earlier "blocking dependency + minimal seeder"
worry is **resolved** — dropped from this revision. What Phase 3 stands on:

- **`refresh-backlog` skill** — parses signals → scored `tasks` (`status='open'`), cheap/read-only.
- **`shared/db.mjs` `query-window [K]`** — returns the top-K open tasks by `score desc`, already `user_id`-scoped.
- **Columns Phase 3 reads off each task:** `summary`, `signal_url` (clickable link, pre-captured — **no refetch**),
  `external` (**feeds the risk gate**, §5), `relevant_facts` (light recall to deepen), `open_questions`
  (`uncertainty_pct` → a confidence input, §5), `gating_decision_ids` (the pile to drain, §8).

**Contract seam:** act-and-decide **runs `refresh-backlog` as its opening stage** (Phase 2 §8 designates it so), then
`query-window`. In the daily routine the two chain; on a manual run act-and-decide triggers the refresh itself so it
never reasons over a stale window. *(Phase 2 §8 flags a possible future refactor: absorb `refresh-backlog` inline as
act-and-decide's first stage if run-length argues for it — a Phase-3 option, not required.)*

Terminology — **two distinct task-level axes, don't conflate them** (CLAUDE.md):
- **`relevance`** (Scorer, cheap, upstream; renamed from `confidence` in #8) — the **noise gate**: is this a real,
  worth-surfacing task? Persisted on `tasks`.
- **act-gate confidence** (act-or-decide, reasoned, downstream) — **"do I understand this task well enough to handle
  it autonomously?"** Judged **per task** *after* the deep-context dig (§8 Stage 3), not upstream.

Both are **task-level**. The **only per-action axis is `risk`** (destination — §5). The gate pairs the *task's*
confidence with each *action's* risk. *(This diverges from Phase 2's `actions.confidence` assumption — see §10.)*

---

## 4. The safety ladder — three flags, one story

The three requested controls are the same axis at three depths of side-effect. Default sits at the safe end and
loosens as trust builds (parent §7: *"Default conservative (draft-only), loosen as trust builds"*).

| Level | Flag / setting | ACT branch does | DECIDE branch does | Side effects |
|---|---|---|---|---|
| **0 · dry-run** | `--dry-run` (run arg) | *nothing* — classified "Act" in the table | *nothing* — decision **not** created | **None.** Reads only. Emits the classification table (§7). |
| **1 · draft (default)** | `guardrails.mode: "draft"` | create the **draft** (Gmail draft, Linear draft comment, doc draft…) | **create the STARTED Jupi decision** + gated action rows | No external send. Drafts + private decisions only. |
| **2 · perform** | `guardrails.mode: "perform"` | **execute** the real action (send/post/commit) — *iff the gate still says ACT* | same as level 1 | Real external side effects, gate-permitting. |

**dry-run is orthogonal to mode:** `--dry-run` short-circuits *before* any write regardless of `mode`, so it previews
either policy. `mode` only matters on a real (non-dry) run.

---

## 5. The gate — a configurable policy matrix (P3-2)

**Confidence is task-level; risk is action-level.** Act-or-decide evaluates **one confidence per task** (after the
context dig — "do I know how to handle this?"). The Action Planner then tags **each action** with its own `risk`
(destination). The gate runs **per action**, pairing the parent *task's* confidence with *that action's* risk — a
lookup into a config-supplied matrix:

```jsonc
// guardrails.policy — which cells auto-ACT vs DECIDE. Shipped default is conservative (parent §7).
{
  "high":   { "low": "act",    "high": "decide" },   // confident + safe → act; confident + risky → decide
  "medium": { "low": "act",    "high": "decide" },
  "low":    { "low": "decide", "high": "decide" }     // unsure → always decide
}
```

- **Risk is destination, not verb** (parent §6). Inputs, in order: draft form → `low`; else read **`tasks.external`**
  (shipped for exactly this — external counterparty → lean `high`), recipient sensitivity (peer < manager < CEO <
  external), and irreversibility (commit, booking, payment → `high`). Internal Slack/Linear to a peer → `low`.
- **Confidence is the task's content/approach certainty** — is there a single obvious way to handle this task (`high`)
  or a genuine open question (`low`)? One value **per task**, seeded from `open_questions[].uncertainty_pct` and firmed
  up during the deep-context dig (§8 Stage 3). A whole-row `low` (unsure) → every action DECIDEs, regardless of risk —
  which is exactly the §6 "hesitating on what to say → decide" case. *(v1 heuristic — see §15 open items.)*
- A **business rule** (Phase 5) can lower a class's effective risk → a DECIDE cell graduates to ACT. Phase 3 **reads**
  `actions.rule_ref` if present but does not author rules.
- **This matrix is the "configurable threshold."** Tighten = flip cells to `decide`; loosen = flip to `act`. Lives in
  config (§9), editable without touching the skill.

---

## 6. Draft mode mechanics (P3-3)

`mode: "draft"` transforms the Action Planner's output, *before* the gate lookup:

1. Every action whose verb has a draft form is **rewritten to its draft** (`send_email → create_draft`,
   `post_slack → draft-in-thread-note`, `merge_pr → open-draft-PR`).
2. Drafting sets `risk = "low"` (nothing leaves) → the matrix almost always returns **ACT**.
3. Net effect: in draft mode the user gets **ready-to-send drafts for nearly everything**, and Jupi decisions only for
   genuine *content/approach* trade-offs (low confidence), not for *destination* risk.

`mode: "perform"`: the Planner emits the real verb; `risk` is computed from destination (incl. `tasks.external`);
high-risk external actions hit the DECIDE cell. **Draft mode never bypasses the gate** — a low-confidence action is
DECIDE in either mode (you can't safely draft what you don't know how to write). Actions with no draft form (calendar
RSVP, a label, a search) are intrinsically low-risk/reversible and act in both modes.

---

## 7. Dry-run output — the classification table

`--dry-run` runs the full pipeline (refresh → window → coordination pass → gate) but **stops before any write** — no
Jupi decision, no draft, no `actions` row inserted. One row per candidate action:

| Task | conf (task) | Action (what would happen) | risk | Verdict | If DECIDE: decision title / options |
|---|---|---|---|---|---|
| Reply to Alice re: pricing | high | Draft email to alice@x.com confirming Tue 2pm | low | **ACT** | — |
| Sharpist brief | high | Create "Sharpist Brief" doc in GTM project | low | **ACT** | — |
| | | Share the doc with Paul | low | **ACT** | — |
| Renewal outreach to CEO | high | Send renewal email to ceo@bigco.com | high | **DECIDE** | *"How to frame the BigCo renewal?"* → 2 options |
| Ambiguous Linear triage | low | Reassign JUPI-530 | low | **DECIDE** | *"Who owns JUPI-530?"* → 3 options |

- **Confidence is a task attribute** (one value per task, blank on continuation rows); **risk + verdict are per
  action**. The Sharpist row shows a task fanning into two actions that share the task's confidence (§8 Stage 4).
  The Linear row shows how a task-level `low` confidence forces DECIDE even on a low-risk action.
- The **Verdict** reflects the *current* `mode`, so the table doubles as a preview of a real run. Footer notes the mode
  + the active policy matrix.
- Rendered to `act-and-decide/runs/run-XXX/report.md` and returned as the caller summary. *(A read-only in-memory
  plan — the §10 no-write guarantee.)*

---

## 8. `act-and-decide` anatomy — the coordination-node pass at its center

**The headline mechanic is not the per-task loop — it's leverage across tasks.** The Scorer already ordered the
backlog by per-task priority; act-or-decide's job is the thing prioritization *can't* do: find the **single decision
that resolves the most tasks at once** — the *factorizing* decision, the "coordination node." This is precisely what
V1 deferred as "an orchestration layer for later," and what the parent §4 diagram puts as act-or-decide's **opening
move**. The Action Planner and the gate are downstream of it. Concretely, over the window we look for a decision that
**several windowed tasks share** — e.g. three inbound threads all blocked on *"what's our Q3 pricing?"*: one decision
unblocks all three. We pick the task **cluster** with the highest such leverage, not the single top-scored task in
isolation.

**The schema already supports this** (no change): one Jupi `decision_id` can appear in **many tasks'**
`gating_decision_ids`, and `actions` rows across **different `task_id`s** can carry the **same** `decision_id` /
`option_id`. So a factorizing decision is one Jupi decision gating a fan of actions spanning multiple tasks — settle it
once, and Stage 6 recomputes every task it touched.

One skill, explicit stages (parent §4 note). All Neon access is through **`${CLAUDE_PLUGIN_ROOT}/shared/db.mjs`** —
never hand-written SQL, never the account-wide Neon MCP (Phase 2 house rule); `db.mjs` auto-scopes every verb by
`user_id`. Same npm-bootstrap + egress-fallback discipline as `refresh-backlog` (§9).

- **Boot (fast):** read `proactive-jupi/assets.md` (Asset Map, in full), the `guardrails` config, the Jupi workspace
  slug. Parse run args → `dry_run`, `mode` override. **No tree exploration** (V1 rule).
- **Stage 0 — Refresh + drain the pile:** run `refresh-backlog` (opening stage), then gather `gating_decision_ids`
  across open tasks and fetch those decisions from Jupi; take **FINALIZED-not-yet-EXECUTED**. *Phase 3 builds the read
  + recompute (Stage 6); the execute/notify half is Phase 4 (§14).* In dry-run, list what would drain.
- **Stage 1 — Read the window:** `db.mjs query-window [backlogWindowSize]`.
- **Stage 2 — Coordination-node pass (the centerpiece):** value-based selection lives *here*, not upstream (parent §4;
  Phase 2 §6 left the *global* bottleneck to us). Three moves:
  1. **Light cross-window sketch** — for each windowed task, cheaply sketch *what resolving it would take*: the
     candidate action(s) and, if it hides a trade-off, the **gating decision** it would raise. Shallow on purpose (no
     deep dig yet — that's Stage 3); just enough to see structure.
  2. **Find the coordination node** — look for a **single decision shared by multiple tasks** (the factorizing
     decision), and for decisions that unblock the highest-value / most-bottlenecked cluster. Leverage = *value
     unblocked across tasks per decision raised*, not per-task score. One decision resolving three tasks beats three
     top-scored tasks needing three separate decisions.
  3. **Select the cluster** — commit the run to that task (or task cluster) and its factorizing decision. Everything
     downstream (Stages 3–6) operates on the cluster, and a decision raised in Stage 5 can gate actions across **all**
     tasks in it.
  *(If nothing factorizes, this degrades gracefully to "take the top-scored task" — the pass never costs correctness,
  only finds leverage when it exists.)*
- **Stage 3 — Gather context (no blind spot — carried from V1) + judge task confidence:** for every
  person/org/project/tool the task touches, read Facts (deepen `relevant_facts`); for gaps, delegate to **`update-brain`
  targeted** (never write Facts here — parent golden rule). **Pull ≥10 recent messages in-channel before any message
  draft** (V1 messaging rule — Phase 2 deferred this depth to us). **Output one `confidence` for the task** — how sure
  we are of the approach now that context is in hand.
- **Stage 4 — Action Planner:** expand the task (+ any settled decisions) into **N concrete parallel actions**, each
  tagged `tool`, `description` (executable instruction), and its own **`risk`** (destination). Apply the **draft-mode
  transform** (§6). Insert via new `db.mjs insert-action` (`status='candidate'`). *(Confidence is the parent task's, not
  re-judged per action.)*
- **Stage 5 — Gate each action (§5):** matrix lookup on **(task confidence, action risk)** →
  - **ACT** → (dry-run: table only) · (draft/perform: execute per §4) → `db.mjs set-action-status executed` + `trace_ref`.
  - **DECIDE** → author the Jupi decision (one per real trade-off; V1 HTML format + validator §11), set the option's
    action rows to `pending_decision` with `decision_id`/`option_id` (`db.mjs`), and record `gating_decision_ids` on
    the task. Mark the task `done`/`dropped` when fully resolved.
- **Stage 6 — Recompute-on-settle (the seam):** the Planner is a pure function of `(task, settled_decisions)`; when
  Stage 0 finds a newly-FINALIZED decision, re-run Stages 4–5 for that task with the chosen option folded in — may
  spawn new actions/decisions (recursion). *Phase 3 ships the function; Phase 4 wires the poll trigger + the executor
  that runs the resulting ACT rows and skips siblings.*

---

## 9. Deliverables

| # | Deliverable | New / changed |
|---|---|---|
| D1 | **`act-and-decide` skill** — `plugins/proactive-jupi/skills/act-and-decide/{SKILL.md, reference/ORCHESTRATION.md, reference/VALIDATOR.md}`, ported from V1, re-anchored on `db.mjs`. Its **centerpiece is the coordination-node pass** (§8 Stage 2 — the factorizing-decision selection V1 deferred as "an orchestration layer for later"); the Action Planner (Stage 4) and gate (Stage 5) are downstream of it. | new |
| D2 | **`shared/db.mjs` write-verbs** — the current helper is read/parse-oriented; Phase 3 adds: `insert-action '<json>'`, `set-action-status <id> <status> [trace_ref]`, `set-task-gating <task_id> '<decision_ids[]>'`, `close-task <id> <done\|dropped>`, `list-actions-by-decision <decision_id>` (pile drain). All parameterized, `user_id`-scoped, matching the existing verb style. | changed |
| D3 | **Gate + draft-mode + dry-run logic** in `SKILL.md` — the §5 matrix lookup, §6 verb-capping, §7 no-write table. | new |
| D4 | **Config** — `guardrails` block in `setup.local.json` + template (`mode`, `policy`, `executedPing`); reuse existing `backlogWindowSize` for the window (do **not** duplicate). | changed |
| D5 | **Producer↔validator loop** — carry `ORCHESTRATION.md` + `VALIDATOR.md`; extend the validator to also gate perform-mode sends (§11). | new/changed |
| D6 | **Un-gate `setup-proactive-jupi`** — create the `act-and-decide` routine; fire one first run as `--dry-run` (§12-setup). | changed |
| D7 | **`evals/act-and-decide/`** — trigger + behavioral evals mirroring `evals/refresh-backlog/`, incl. a gate-classification behavioral case and a prompt-injection safety case (signal body must not drive an action/decision). Scratch-isolated (`is_eval`, `eval:` refs). | new |
| D8 | **Doc updates** — §11 roadmap already linked; tick Phase 3 items in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) as they land. | changed |

### Config surface (front-loaded, per CLAUDE.md)

```jsonc
// .claude/setup.local.json (gitignored) + reference/setup.local.json.template — set in setup's attended prelude
"guardrails": {
  "mode": "draft",              // "draft" (default, conservative) | "perform"
  "policy": {                   // the configurable act/decide matrix (§5)
    "high":   { "low": "act",    "high": "decide" },
    "medium": { "low": "act",    "high": "decide" },
    "low":    { "low": "decide", "high": "decide" }
  },
  "executedPing": "none"        // "email" | "slack" | "none" — the one closing ping (Phase 4)
}
// window size reuses the EXISTING top-level "backlogWindowSize" (default 30) — no new key.
```

- `--dry-run` is a **run argument**, not persisted config. `mode` can also be overridden per-invocation
  (`/act-and-decide --perform`) without editing config.
- Defaults ship **conservative**: `draft` + only-confident-and-safe auto-acts.

---

## 10. Schema touchpoints

`shared/schema.sql` **already supports Phase 3** — `actions.risk/decision_id/option_id/status`
(`candidate|pending_decision|executed|skipped`), `tasks.gating_decision_ids`, `tasks.external`, `tasks.signal_url`,
`user_id` on both tables all exist. **No migration strictly needed.**

**One divergence to resolve (confidence placement).** Phase 2 shipped `actions.confidence` and documented "act-gate
confidence lives on actions." Per the confirmed model (§3, §5), **confidence is task-level** — so:
- **Recommended:** add `tasks.act_confidence text check (… low/med/high)` (distinct from the Scorer's `relevance`),
  written by act-or-decide in Stage 3; treat `actions.confidence` as a **denormalized copy** of the parent task's value
  (or drop it). One idempotent `alter table tasks add column if not exists act_confidence …` — cheap.
- **Or:** keep confidence purely **runtime** (act-or-decide recomputes it each run from context; nothing persisted) and
  leave `actions.confidence` unused. Simpler, but the dry-run table's `conf` column then isn't queryable after the fact.

Two conventions the skill enforces regardless (behavior, not DDL):

- **Dry-run writes nothing** — no `insert-action`, no status flips. Plan computed in-memory, rendered as the table.
- **Sibling skip on settle** — on finalize, non-selected options' rows → `status='skipped'`; only the selected option's
  rows execute. The recompute contract (§8 Stage 6), realized through D2's verbs.

*(Optional, defer unless needed: a nullable `actions.mode` column recording drafted-vs-performed for audit — the verb
in `description` already implies it.)*

---

## 11. Producer ↔ validator loop (carried from V1)

Keep `reference/ORCHESTRATION.md` + `reference/VALIDATOR.md`:

- Every DECIDE draft passes the **validator** (opens real sources, verifies each claim; checks HTML breathing,
  links-everywhere — now cheap since `signal_url` is pre-captured — relative dates, plain language; elevates vague
  actions). Max 3 iterations; never clears → **deliver nothing** for that item (the run proceeds).
- **New for Phase 3:** the validator also gates **ACT-in-perform** actions before execution — an external send is at
  least as consequential as a posted decision. Draft-mode ACTs and dry-run need no gate (no external effect), keeping
  the default path fast.
- Orchestrator persists `report.md` / `validation.md` (sub-agents return text, don't write files — V1 harness note).

---

## 12. Regression guard — what must survive from V1 `act-and-decide`

Per [CLAUDE.md](CLAUDE.md), diff against the reference (`jupi-skills` @ `auto-jupi`) so nothing regresses silently.
Phase 2 (§5) deferred several V1 behaviors *to Phase 3* — this is where they land:

| V1 behavior | Phase 3 home | Verdict |
|---|---|---|
| Act-or-decide unit: one action, gather its context, derive 0/1/N decisions | Stages 3–5 | **Preserved** (now over a backlog window, not a live scan) |
| "No-blind-spot" deep context dig | Stage 3 | **Now owned here** (Phase 2 deferred it) |
| Pull ≥10 in-channel messages before a message draft; mirror voice; be minimal | Stage 3 + Action Planner | **Now owned here** (Phase 2 deferred it) |
| Coordination-node pass (value-based selection) | Stage 2 | **Now owned here** (Phase 2 §0 explicitly moved it out of Phase 2) |
| Decisions posted **private** (`allowWorkspaceContributions:false`), STARTED, never finalized | Stage 5 | **Preserved** |
| Jupi HTML format + breathing + links-everywhere + relative dates | Validator (§11) | **Preserved** |
| Producer↔validator loop; max 3; "deliver nothing" on persistent flags | §11 | **Preserved** |
| The pile = gated `actions` rows drained each run (closing-loop read) | Stage 0 / Stage 6 | **Read+recompute here; execute in Phase 4** |
| Pattern watchlist / `_ruled-out` as a *rule* engine | Rule loop (Phase 5) | **Deferred, not dropped** — Phase 3 reads `rule_ref`, doesn't author |
| `_ruled-out` negative memory (a signal judged "nothing to do") | Phase 2 already maps this to `status='dropped'` + no-resurrect | **Preserved upstream**; Stage 5 sets `dropped` when act-or-decide rules a task out |

---

## 13. Build sequence

1. **D2 `db.mjs` write-verbs** — foundation; unblocks the Planner and gate. Extend `evals`/smoke-test each verb.
2. **D1 skill skeleton** — port `SKILL.md` + `reference/*` from V1, re-anchored on `db.mjs` + the backlog window.
3. **D4 config** — `guardrails` in template + live `setup.local.json`; skill reads it.
4. **Stages 0–2** — refresh + pile-read; `query-window`; coordination-node pass.
5. **Stage 3** — deep-context dig + messaging-history pull (the V1 carry-overs).
6. **D3 Stage 4–5** — Action Planner (insert actions, tag each action's risk, draft-transform) + the gate (pair task
   confidence × action risk → ACT vs DECIDE post).
7. **Dry-run** — the table + no-write guarantee (§7, §10).
8. **D5 validator loop** — wire producer↔validator; extend to gate perform-ACTs.
9. **Stage 6** — recompute-on-settle *function* (poll/execute deferred to Phase 4).
10. **D6 setup un-gating** — routine + first dry-run.  **D7 evals** alongside D1/D3.  **D8 doc ticks.**

**Dogfood checkpoints (on `sparkling-violet-42081696`):**
- `refresh-backlog` → `--dry-run` act-and-decide → eyeball the table: ACT/DECIDE sane under the default matrix?
- Flip one policy cell → re-run dry-run → verdict changes as expected.
- `mode: draft` real run → drafts in Gmail/Linear, one private Jupi decision for a genuine trade-off, `actions` rows
  in Neon with correct status + `user_id`.
- Finalize that decision in Jupi by hand → Stage 6 recompute produces the selected option's action row(s); siblings
  `skipped`.

**Out of Phase 3 (scope guard):** poll-detect loop, executor/trace/notify, EXECUTED-status write, rule authoring — all
Phase 4/5 (§14).

---

## 14. Deferred to Phase 4/5 (explicit seam)

- **Phase 4** — scheduled poll-detect of FINALIZED decisions; the executor that runs the selected option's ACT rows
  after settle, writes the trace on the originating signal, sends the one optional EXECUTED ping (`executedPing`), sets
  Jupi `EXECUTED` (backend write still "to request" — parent §8).
- **Phase 5** — reactive rule authoring during execution; Phase 3 only *reads* `actions.rule_ref`.

---

## 15. Open items / decisions you may want to flip

- **Task confidence — source + placement.** v1 heuristic: single obvious approach = high; a task `open_questions`
  entry with high `uncertainty_pct` = low. It's **one judgment per task** (§5), made in Stage 3. Placement is the §10
  divergence — persist as `tasks.act_confidence` (recommended) vs runtime-only. *Flip:* derive a numeric confidence if
  the categorical gate misfires (would also enable a scalar threshold, which you declined for now — P3-2).
- **First setup run = `--dry-run`** (not a live draft run) — proves the loop end-to-end with zero side-effect on first
  contact; the user flips `mode` to `perform` when they trust it. *Flip:* fire a real draft-mode run instead.
- **`refresh-backlog` invoked by act-and-decide vs. only chained by the routine** — plan assumes act-and-decide
  triggers it so a manual run is never stale. *Flip:* make it routine-only if double-refresh in the chained path is
  wasteful.
- **Coordination-node pass cost** — reasoning over the window every run; cap window (`backlogWindowSize`) or cache if
  runs get long.
- **Perform-mode validator latency** — gating every external send adds a round-trip; fine at low volume, revisit at scale.
