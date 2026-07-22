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
stage), reads the scored top-window from Neon (`query-window`), runs the **coordination-node pass** to pick the
highest-value work across the window, gathers deep context (no blind spots), then for each candidate action runs the
**confidence × risk gate** — **acting** when confident and safe, or **posting a structured Jupi decision** when unsure
or risky. Acting is governed by a **draft-mode switch** (draft vs. perform) and previewable via a **dry-run flag**
(classify only, touch nothing). The **Action Planner** expands one task into N parallel `actions` rows in Neon (via new
`db.mjs` write-verbs), each carrying its `decision_id`/`option_id` and executable instruction, and **recomputes** when a
decision settles. The V1 producer↔validator gate is retained. This closes the roadmap item "un-gate
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

Terminology fix vs v0.1: the task axis is **`relevance`** (renamed from `confidence` in #8), the noise gate — **not**
the act-gate confidence. **Act-gate `confidence` lives on `actions`** and is assigned by the Action Planner (§5), never
read from the task.

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

Each candidate **action** (not task) is tagged by the Action Planner with `confidence ∈ {low,med,high}` and
`risk ∈ {low,high}` (both already `actions` columns). The gate is a lookup into a config-supplied matrix:

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
- **Confidence is content/approach certainty** — is there a single obvious way to do it (`high`) or a genuine open
  question (`low`)? Seeded from the task's `open_questions[].uncertainty_pct` and firmed up during the deep-context dig
  (§8 Stage 3). *(v1 heuristic — see §13 open items.)*
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

| Task | Action (what would happen) | conf | risk | Verdict | If DECIDE: decision title / options |
|---|---|---|---|---|---|
| Reply to Alice re: pricing | Draft email to alice@x.com confirming Tue 2pm | high | low | **ACT** | — |
| Sharpist brief | Create "Sharpist Brief" doc in GTM project | med | low | **ACT** | — |
| Renewal outreach to CEO | Send renewal email to ceo@bigco.com | high | high | **DECIDE** | *"How to frame the BigCo renewal?"* → 2 options |
| Ambiguous Linear triage | Reassign JUPI-530 | low | low | **DECIDE** | *"Who owns JUPI-530?"* → 3 options |

- **Grouped by task** so fan-out is visible (one task → several action rows — §8 Stage 4).
- The **Verdict** reflects the *current* `mode`, so the table doubles as a preview of a real run. Footer notes the mode
  + the active policy matrix.
- Rendered to `act-and-decide/runs/run-XXX/report.md` and returned as the caller summary. *(A read-only in-memory
  plan — the §10 no-write guarantee.)*

---

## 8. `act-and-decide` anatomy (stages)

One skill, explicit stages (parent §4 note). All Neon access is through **`${CLAUDE_PLUGIN_ROOT}/shared/db.mjs`** —
never hand-written SQL, never the account-wide Neon MCP (Phase 2 house rule); `db.mjs` auto-scopes every verb by
`user_id`. Same npm-bootstrap + egress-fallback discipline as `refresh-backlog` (§9).

- **Boot (fast):** read `proactive-jupi/assets.md` (Asset Map, in full), the `guardrails` config, the Jupi workspace
  slug. Parse run args → `dry_run`, `mode` override. **No tree exploration** (V1 rule).
- **Stage 0 — Refresh + drain the pile:** run `refresh-backlog` (opening stage), then gather `gating_decision_ids`
  across open tasks and fetch those decisions from Jupi; take **FINALIZED-not-yet-EXECUTED**. *Phase 3 builds the read
  + recompute (Stage 6); the execute/notify half is Phase 4 (§14).* In dry-run, list what would drain.
- **Stage 1 — Read the window:** `db.mjs query-window [backlogWindowSize]`.
- **Stage 2 — Coordination-node pass:** over the window, find the decision/action that **unblocks the most value
  across tasks** (value-based selection lives *here*, not upstream — parent §4; Phase 2 §6 deliberately left the
  *global* bottleneck to us). Pick the subject(s).
- **Stage 3 — Gather context (no blind spot — carried from V1):** for every person/org/project/tool the action
  touches, read Facts (deepen the task's `relevant_facts`); for gaps, delegate to **`update-brain` targeted** (never
  write Facts here — parent golden rule). **Pull ≥10 recent messages in-channel before any message draft** (V1
  messaging rule — Phase 2 explicitly deferred this depth to us).
- **Stage 4 — Action Planner:** expand the task (+ any settled decisions) into **N concrete parallel actions**, each
  tagged `tool`, `description` (executable instruction), `confidence`, `risk`. Apply the **draft-mode transform** (§6).
  Insert via new `db.mjs insert-action` (`status='candidate'`).
- **Stage 5 — Gate each action (§5):** matrix lookup →
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
| D1 | **`act-and-decide` skill** — `plugins/proactive-jupi/skills/act-and-decide/{SKILL.md, reference/ORCHESTRATION.md, reference/VALIDATOR.md}`, ported from V1, re-anchored on `db.mjs`. | new |
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

`shared/schema.sql` **already supports Phase 3** — `actions.confidence/risk/decision_id/option_id/status`
(`candidate|pending_decision|executed|skipped`), `tasks.gating_decision_ids`, `tasks.external`, `tasks.signal_url`,
`user_id` on both tables all exist. **No migration needed.** Two conventions the skill enforces (behavior, not DDL):

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
6. **D3 Stage 4–5** — Action Planner (insert actions, tag conf/risk, draft-transform) + the gate (ACT vs DECIDE post).
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

- **Per-action confidence source** — v1 heuristic: single obvious approach = high; a task `open_questions` entry with
  high `uncertainty_pct` = low. *Flip:* derive a numeric confidence if the categorical gate misfires (would also
  enable a scalar threshold, which you declined for now — P3-2).
- **First setup run = `--dry-run`** (not a live draft run) — proves the loop end-to-end with zero side-effect on first
  contact; the user flips `mode` to `perform` when they trust it. *Flip:* fire a real draft-mode run instead.
- **`refresh-backlog` invoked by act-and-decide vs. only chained by the routine** — plan assumes act-and-decide
  triggers it so a manual run is never stale. *Flip:* make it routine-only if double-refresh in the chained path is
  wasteful.
- **Coordination-node pass cost** — reasoning over the window every run; cap window (`backlogWindowSize`) or cache if
  runs get long.
- **Perform-mode validator latency** — gating every external send adds a round-trip; fine at low volume, revisit at scale.
