# Proactive-Jupi MVP — Implementation Plan

> **Status:** Draft v0.4 · 2026-07-23 · Owner: Anne-Claire · Living doc.
> Reconciles three sources — Nick's value-prop doc, the review-with-Claude, and the running `BRIEF.md` — **with Anne-Claire's architecture diagram as the authority on structure.** Where sources disagreed, this plan follows the review; the divergences (and how to undo each) are in §10.
> **v0.3:** reconciled §2/§4/§5/§6/§7/§8/§11 with the Phase-3 model refinements — **risk → exposure**, and the **`act-or-decide` (planner) / `execute-actions` (worker) split** (planner writes Neon + Jupi; worker is the only tool-writer; `perform` mode → Phase 4). Details in [PHASE-3-PLAN.md](PHASE-3-PLAN.md).
> **v0.4 (Phase-4 design):** the **execution refactor** — the worker (**`execute-action`**, singular) becomes *purely functional* (performs the side-effect, returns the trace, writes **no** status); the **orchestrators own bookkeeping**, each in the store its case lives in — `act-or-decide` writes Neon for **ACT**, **`act-post-decision`** (renamed from the closing loop) reads/runs/marks-done in **Jupi** for **DECIDE**. **Decided actions are never materialized into Neon.** Details in [PHASE-4-PLAN.md](PHASE-4-PLAN.md).

---

## 1. What we are building (one paragraph)

A **proactive engine** that does the user's founder/GTM work ahead of being asked. Incoming **signals** become scored **tasks** in a backlog; the coordination-node pass selects the task(s) that unlock the most value (one decision can gate many); for each, the engine either **acts** (when it's confident and the action is low-exposure) or **poses a structured Jupi decision** (when it's unsure or the action is high-exposure). Settling a decision triggers execution (the closing loop). Undocumented know-how becomes **business rules** through that same loop, so over time more tasks resolve without asking. v1 dogfoods on the owner's founder/GTM stack; it's built to port to one design partner later.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| A1 | Starting point | **Blend + rescope** — keep the engine's guts, re-scope the surface per the review. |
| A2 | Where it runs | **Hybrid** — cloud brain + thin local plugin for execution / data-wall accounts. |
| A3 | Human's role | **Provision + discover rules; gaps via task→decision→rule.** Human upstream *by outcome*. |
| A4 | Idea 3 (agent ownership registry) | **Out this cycle.** Agent *reuse/discovery* stays in; lifecycle mgmt does not. |
| A5 | Pilot target | **Dogfood → partner**, timed to a real pilot. |
| A6 | v1 function | **Founder / GTM ops.** |
| A7 | Delivery surface | **Decisions:** Jupi (+ optional Slack/email ping). **Execution:** traces flow up on the signal itself; at most one optional EXECUTED ping (email/Slack/none). No digest. |
| A8 | Memory / brain layer | **Supermemory (hosted)** — the Facts & relationships store. |
| A9 | Noise control | **Confidence × exposure gate inside act-or-decide** (not a volume cap). See §6. *(Renamed from "risk" during Phase-3 review — confidence owns "are we right," exposure owns "what's at stake." DB column stays `actions.risk`.)* |

### Finalized build decisions (Jupi)
| Fork | Choice | Note |
|---|---|---|
| [Task selection](https://jupi.co/jupi/decision/auto-jupi-how-should-the-engine-select-tasks-each-run-718a91b9-914d-4e6d-960c-be29e3b88f5d) | **C — backlog + coordination-node pass** | Cheap Scorer orders the backlog + narrows the window; the coordination-node pass (value-based selection) lives **inside act-or-decide**, not as a separate picker. Prioritization ≠ the factorizing value. |
| [Closing-loop detection](https://jupi.co/jupi/decision/auto-jupi-how-does-the-closing-loop-detect-a-settled-jupi-decision-5797c2f0-c3dd-4431-a05a-5fd776185774) | **C — poll now, webhook later** | Finalized-status read from Jupi MCP lands in ~1–2 days (unblocks polling). |
| [Rule bootstrap](https://jupi.co/jupi/decision/auto-jupi-how-aggressively-do-we-bootstrap-business-rules-from-observed-habits-30e448b4-8d41-4170-b746-69adfcd4408d) | **Reactive during execution**, grounded in past decisions + habits | No proactive pass, no cap. Rules emerge only when execution needs them. |

---

## 3. Vocabulary (fixed — these were conflated before)

| Term | Definition |
|---|---|
| **Signal** | Ephemeral trigger: new email, meeting, Slack ping, Linear issue, PR, doc. Never persisted. |
| **Task** | The **input** — one unit of the **backlog**. Produced by the parser from a signal. Scored, selectable. |
| **Action** | A **unit of execution**. **One task can fan out into several actions run in parallel.** |
| **Decision** | A Jupi decision raised only when act-or-decide can't safely act. Each option = an executable action-instruction. |
| **Rule** | *"When X, always Y"* — a resolved rule-decision, approved by an owner. Lets future tasks act without asking. |
| **Fact** | Knowledge about people/orgs/projects, stored in Supermemory. |

---

## 4. Architecture (matches the diagram — 4 layers)

**The spine is the task backlog, not `context/`.** The Knowledge layer is a set of *resources* every stage reads/writes.

```
SIGNAL LAYER   Meeting · Slack · Email · Tool inbox ─────────┐ triggers
                                                             ▼
AUTOMATION     Task Parser ──► Task Scorer ──► [ BACKLOG ] ──► top window
LAYER          (signal→task)   (CHEAP: order    (scored tasks)  (top-K by score)
                                by impact×conf;                      │
                                narrows window)                      ▼
                                                    ┌──────── Act-or-Decide ─────────┐
                                                    │ 1. coordination-node pass:      │
                                                    │    over the window, find the    │
                                                    │    decision unlocking the most  │
                                                    │    value across tasks           │
                                                    │ 2. per candidate action, gate   │
                                                    │    on confidence × exposure:    │
                                          act ◄─────┤      confident + safe           │
                                                    │      unsure OR risky ───────────┼──► Decision (Jupi)
                                                    └─────────────────────────────────┘         │
                                                                   │                             │ user settles
                                                                   ▼                             ▼
                                                            Action Planner ◄──────── closing loop (poll)
                                                            (task[+decisions] → N parallel actions)
                                                                   │
                                                                   ▼
                                                            Execute ──► Slack/email notify ──► log
ARBITRAGE      User (arbitrates decisions) · Owner (approves business rules)
LAYER

KNOWLEDGE      Facts (Supermemory) · Asset Map · Decision log (= Jupi) · Business rules
LAYER          └── read by every automation stage; written by update-brain / provisioning / the loops
```

> *Diagram note: drawn before two Phase-3 refinements — the **risk → exposure** rename, and the **planner/worker split**. "Act-or-Decide" is the `act-or-decide` planner (writes Neon + Jupi only); "Execute" is the separate `execute-actions` worker. See §4a, §6, and [PHASE-3-PLAN.md](PHASE-3-PLAN.md) §8.*

### 4a. Where state lives — three homes, by data character

| State | Home | Why there |
|---|---|---|
| **Facts & relationships** (people/orgs/projects/processes) | **Supermemory** | built for semantic recall; written by `update-brain` |
| **Task backlog** + **actions** (each action carries its `decision_id`/`option_id` + the executable instruction) | **Neon Postgres** (serverless) — `tasks` + `actions` tables (no separate registry). **Flat-file fallback** for data-wall accounts. | mutable, ordered, exactly-enumerated, recomputed each run — a DB does `ORDER BY score` / `WHERE status='open'` / transactional updates natively; an LLM rewriting a markdown table each run is brittle |
| **Asset Map** (tools + action surfaces, agents-for-reuse, rules index) | **`.proactive-jupi/assets.md`** — flat markdown, read in full, hand-edited. **No Supermemory mirror.** | config you enumerate in full and edit by hand; markdown is the right size |
| **Decisions + full lifecycle** (incl. EXECUTED) | **Jupi** | Jupi is the decision log (§8) |
| **Business rules** (*when X, always Y*) | Jupi **approves** (the `[BR]` rule-decision) + the **`rules`-tagged store** holds the durable rule text → indexed in `.proactive-jupi/assets.md` | empty today; accretes reactively via task→recurring decision→rule (Phase 5) |

**`.proactive-jupi/assets.md` is plain markdown, no Supermemory mirror.** You read an asset map *in full* and edit it by hand — never top-K semantic retrieval — so markdown is the right size; act-or-decide just reads the whole (small) file. *Upgrade trigger:* revisit only if the map grows large, needs programmatic filtering, or goes multi-user.

**Backlog + decision registry → Neon Postgres (serverless).** The backlog is the one genuinely structured-mutable store (scores/statuses recomputed each run) — exactly where a file is weakest and a DB strongest. Neon is trivial to stand up and **matches Jupi's own Postgres**, so we build the real store once and scale to a partner with **no migration**. It also dissolves the file-explosion worry: done tasks carry `status='done'` and drop out of the active `WHERE status='open'` query — dedup + audit history retained for free, no wiping. Access via the Neon MCP / serverless driver (*confirm at build time*). **Data-wall accounts** that refuse cloud keep a flat-file backlog fallback.

**Only Facts live in Supermemory** — the backlog (Neon) and `.proactive-jupi/assets.md` *read* Facts from it but don't live there.

**Execution leaves a trace where the work happened.** Every executed action writes its proof next to the originating signal (the Slack reply, the sent email or draft, the Linear comment) — so any random check finds *why* and *what*, in place (§8).

> **Note — there is no separate "Picker."** Value-based selection (which decision unlocks the most) *requires* deriving the tasks' actions and gating decisions, which is act-or-decide's own reasoning — so it lives **inside** act-or-decide as its opening move (the coordination-node pass). The only thing upstream is the **cheap Scorer**, whose sole job is to order the backlog and narrow to a top window so expensive reasoning doesn't scan the whole backlog every run. Split by **cost**, not by responsibility.

**The engines**, interfaced through the **Knowledge layer** + the Neon queue, not a folder:
- **`update-brain`** — maintains Facts & relationships in **Supermemory** (crawler model: coverage + backlog of topics to investigate).
- **`refresh-backlog`** *(Phase 2)* — signal → scored task (parse → score); the cheap upstream stage.
- **`act-or-decide`** *(Phase 3, planner)* — cluster → research-once → act-or-decide → plan. **Writes only Neon + Jupi; never touches user tools.**
- **`execute-actions`** *(Phase 3)* — the **only tool-writer**; **one executor** that runs a `ready` row's verb (draft or real — same tool-call), triggered at end-of-run. The **post-decision loop** (settle-trigger + `EXECUTED` bookkeeping) is Phase 4; `perform` mode is config on the same executor, not a separate build. *(Phase 4 refactors this into **`execute-action`**, a **purely functional** worker — it performs the side-effect and returns the trace but writes **no status**; the orchestrators (`act-or-decide` for ACT / `act-post-decision` for DECIDE) own the bookkeeping. PHASE-4-PLAN §5.)*

*(The split by responsibility — planner writes the queue, worker drains it — replaces the earlier "one skill, execute inline" leaning: separating them keeps the planner side-effect-free and lets the closing loop reuse the same worker. See PHASE-3-PLAN §8.)*

---

## 5. The task → action model (the correction that matters)

1. **Parser**: signal → a Task (short label + standalone summary + relevant facts + candidate open questions).
2. **Scorer** *(cheap, upstream)*: impact × confidence, giving the backlog its order and narrowing to a **top window**. No reasoning about decisions here — pure prioritization. This is the only "picking" done outside act-or-decide, and it exists purely to bound cost.
3. **Act-or-Decide** *(over the window)*: its **opening move is the coordination-node pass** — cluster the windowed tasks by **shared open-question** so one decision can gate actions across many (value-based selection lives here, not upstream). Then, per candidate action, run the **confidence × exposure gate** (§6): mark it `ready` to act, or raise the decision.
4. **Action Planner**: expand the task (+ any settled decisions) into **one or several concrete parallel actions**, materialized as Neon `actions` rows. The set is **not fixed** — a settled decision can spawn new actions/decisions, recomputed as decisions resolve.
5. **Execute** *(separate `execute-actions` worker — PHASE-3-PLAN §8b)*: runs the `ready` rows against the user's tools (draft or, in `perform`/Phase 4, real send), notify, log. Triggered at the end of an act-or-decide run and on decision-finalize.

---

## 6. The confidence × exposure gate (act OR decide)

The noise control. Confidence is **task-level** (do we know how to handle it? — binary: are the open questions empty?); exposure is **per action** (what's at stake if it fires?). For each candidate action:

| | **Low exposure** — internal / reversible (draft, label, note, Slack to a peer) | **High exposure** — external or sensitive (email to a client, msg to the CEO, commit, booking, payment, irreversible) |
|---|---|---|
| **High confidence** | **ACT** — just do it | **DECIDE** — *authorize* ("do exactly this?"), or act if a rule authorizes it |
| **Low confidence** | **DECIDE** — *approach* (content/approach is genuinely open) | **DECIDE** |

- *Example:* the reply's content is known → **act**: draft the email (drafting exposes nothing). Hesitating on what to say → **decide**: raise the trade-off.
- **Exposure is draft-first, then destination.** A **draft exposes nothing** → low, whatever the recipient — *but only actions that **have** a draft form collapse this way*. A **non-draftable** high-exposure action (book a venue, raise a budget, submit a payment, merge a PR) stays high even in draft mode → DECIDE. For real sends, refine by **internal vs external**, **recipient sensitivity** (peer < manager < CEO < external), and **irreversibility**.
  - **"Has a draft form" is resolved per action, at run time** (2026-07-28 edit spec, C1). In `draft` mode an action may be ACTed only when the tool call it would issue has a **draft call** — a call on that surface that *stages* the side-effect. Everything else becomes a DECIDE carrying the prepared content as its recommended option. Draftability belongs to the *operation*, not the vendor (one connector can expose both a staging call and a committing one, and its surface changes under us), so `assets.md`'s `Draft call` column is a **recorded observation** setup writes from the probed surface, not an authority; `unknown` resolves to `no`. This closed a real hole: draft mode was written around mail and was undefined for the surfaces without a draft object — four of five gate-cleared acts on the first real workspace. Accepted consequence: **draft mode is materially tighter than perform**, and `decisionBudget` becomes the binding constraint; the way out is flipping to `perform`, not relaxing the rule.
- A **rule** (Phase 5) raises **confidence** by pre-empting the open question → a task graduates from "decide every time" to "act." *(Earlier framed as lowering risk; the Phase-3 model routes it through confidence instead.)*
- Result: the user is interrupted **only for genuine trade-offs.** No artificial per-day cap.

*Phase-3 refinements (PHASE-3-PLAN §5): the gate is a **configurable 2×2** (`guardrails.policy`); an ACT writes a `ready` Neon row and a DECIDE posts a Jupi decision (its options live in Jupi, not Neon) — the `act-or-decide` planner never executes; `execute-actions` does (§4a, §11 Phase 3).*

---

## 7. Provisioning module (the Phase-0 build you picked)

Stands up a workspace from cold — the formalized "cold-start" the review demanded. Steps:

1. **Connect tools (MCP):** Gmail · Calendar · Drive · Linear · GitHub · Jupi · Slack · **Supermemory**. Pre-authorize; verify each connection's action surface.
2. **Discover existing assets → write the Asset Map:** inventory connected tools/MCPs (+ each one's action surface), existing agents/skills, and any documented rules/playbooks. Record them in the **Asset Map** (§4a). *Register discovered agents for reuse* (A4 — reuse, not lifecycle). **At Jupi today there are no rules → skip rule-discovery, go straight to bootstrap.** At a partner, crawl their docs.
3. **Seed the brain:** run `update-brain` **full** crawl into Supermemory from **the last 1 month** of tool history to start (widen later once the loop is stable) — facts about people, orgs, projects, processes, tools.
4. **Initialize the backlog:** parse recent signals into candidate tasks; score them.
5. **Set cadence / triggers:** schedule runs (tie to one recurring ritual; cadence decides the responsiveness).
6. **Set guardrails:** the initial confidence×exposure policy (the configurable 2×2) — which action classes may auto-act vs always-decide, plus the `mode` (draft/perform), `clusterBudget` (clusters processed per run) and `decisionBudget` (decisions raised per run). **Default conservative** (draft-only), loosen as trust builds. *(`actBudget` was the original name for `clusterBudget`; it always bounded clusters, never actions. Still read as an alias, with a deprecation warning.)*

**Outputs:** connected tools · seeded Supermemory · initial scored backlog · schedule · guardrail config. → I can scaffold this as the first module (see §11).

---

## 8. The closing loop (net-new)

**Decision lifecycle — in Jupi:** `STARTED → FINALIZED (user settles) → EXECUTED (loop ran the action)`. **EXECUTED is a status on the Jupi decision itself** (a Jupi backend addition to request), so the full lifecycle lives in the decision log. **No separate registry:** the executable instruction lives in the **`actions` rows** (each gated by `decision_id` + `option_id`); the decision + authoritative status live in Jupi. This is what stops a finalized decision being missed or run twice.

1. **The pile = `blocked` tasks:** each carries `gating_decision_ids`. The options' actions are **not** duplicated in Neon — they live in the Jupi decision (each option's `Action:` list), and stay there: on settle, `act-post-decision` **reads the chosen option's actions straight from Jupi**, runs them, and marks them **done in Jupi** (Phase-4 refinement — no Neon materialization; PHASE-4-PLAN §2).
2. **Detect (pull):** each run, gather `gating_decision_ids` across **`blocked`** tasks (those awaiting a decision — `act-or-decide` parked them there, PHASE-3-PLAN §8) and fetch those decisions from Jupi; take the **FINALIZED** ones not yet **EXECUTED** (finalized-status read arriving in ~1–2 days). Push later = Jupi POSTs the routine's run endpoint (§ execution model).
3. **Execute + complete** *(`act-post-decision`, delegating the side-effect to the pure `execute-action` worker)*: run the selected option's actions straight from Jupi, mark each **done in Jupi**, then **mark the `blocked` task `done` directly in Neon once *every* one of its `gating_decision_ids` is FINALIZED** — a task clustered under two open-questions carries two gating decisions and keeps waiting until both settle (its already-settled decision's action still fired). No planner round-trip: the settled option already carried the concrete action, so re-dispositioning a finished task would be wasted reasoning; `act-or-decide` is re-invoked **only** if executing a settled action surfaces a fresh trade-off (then that task reopens `→ open`). Then **set the Jupi decision to EXECUTED**. The worker is the same one immediate acts use (PHASE-4-PLAN §3–§5).
4. **Trace = the natural notification.** The execution writes its result **on the originating signal itself** — a reply in the Slack thread, the sent email, the Linear comment. That *is* the notification: it flows up naturally to whoever is on that signal. Nothing extra is pushed for it.
5. **At most one explicit ping** on the FINALIZED→EXECUTED transition, to the user: **email, Slack, or none** (configurable). The only proactive closing notification — no digest, no per-action spam.
6. **Recurse:** if execution surfaces a new trade-off, raise a new decision.

> **Two notification moments, kept distinct:** *(a)* a decision **needs** you — delivered via Jupi (+ optional Slack/email), the A7 delivery surface; *(b)* a decision was **executed** — at most one optional ping (above) + the natural signal trace. This §8 clarification only prunes moment *(b)*.

**Jupi backend dependencies:** (1) finalized-status + chosen-option read — *arriving ~1–2 days*; (2) **EXECUTED status write** — *to request*; (3) finalization webhook — *later*.

---

## 9. Metrics & kill criteria (defaults)

- **Weekly usage;** engine runs and decisions get settled.
- **Conformity, not ROI** — every executed action traces to a rule or an explicit decision. No provable-savings promise to a buyer.
- **Rule loop** — N rules confirmed by week 4; ≥1 task type graduating from "decide every time" to "act with exceptions."
- **Cost:** Jupi pays tokens (cloud tier); track cost/run.
- **Kill:** after 4 weeks, if no task type graduates and no rules stick, the rule-loop hypothesis is unsupported.

---

## 10. Where we followed the review over Nick's doc (plain list + the undo)

*"Blend + rescope" = I followed your review. None of these is permanent — here's the one thing to flip to switch each back, so Nick can react without a rebuild.*

- **Human is upstream (sets rules, gets only real trade-offs)**, not a downstream approval inbox. → *Undo:* route every action through a decision instead of the confidence×exposure gate.
- **We promise conformity, not savings.** → *Undo:* re-surface the ROI estimate to the buyer (the ranking math stays either way).
- **One function (GTM ops), not five engines.** → *Undo:* widen scope — additive, not a rebuild (engines are bought/borrowed: Claude connectors, Supermemory, skills).
- **Decisions reach people via Jupi + Slack/email**, not "open Jupi." → *Undo:* turn off the notification layer.
- **Brain is cloud (Supermemory) + thin plugin**, not in-plugin. → *Undo:* run fully local for data-wall accounts (path retained).
- **Idea 3 (agent ownership) deferred.** → *Undo:* add the registry later — additive, nothing blocks it.

---

## 11. Roadmap

**Phase 0 — Foundations (now)**
- ✅ 3 build decisions finalized.
- Confirm the Jupi finalized-status read when it ships (~1–2 days).
- Rotate the leaked GitHub PAT + Tavily key in `work/.mcp.json`.
- ✅ Scaffolded `proactive/` as a **Claude plugin** (marketplace `proactive-jupi`, plugin `proactive-jupi`, per jupi-skills PR #7): `setup-proactive-jupi` skill at `plugins/proactive-jupi/skills/setup-proactive-jupi/` with bundled `reference/schema.sql`; packaging + validate scripts + `post-commit` hook; `dist/proactive-jupi.zip` builds for Cowork **Local uploads**.
- ✅ Exercised `/setup-proactive-jupi` partway: Gmail/Calendar/Linear/Drive/Jupi probed; **Supermemory connected via MCP**; **Neon schema applied** to `sparkling-violet-42081696` via project-scoped conn string (not the account-wide MCP).
- **Next: `update-brain` skill**, then finish `/setup-proactive-jupi` steps 5–8 (the fresh 30-day Gmail+Cal+Linear crawl into Supermemory).

**Phase 1 — Brain on Supermemory**
- Integrate Supermemory API; port `update-brain` to write facts there; validate against the existing 61-entity dataset as fixtures.
- Un-gate `setup-proactive-jupi` step 8: now that `update-brain` exists, actually create its user-visible daily routine (not just describe it).

**Phase 2 — Backlog pipeline** *(detailed plan: [PHASE-2-PLAN.md](PHASE-2-PLAN.md))*
- Parser → Scorer → Backlog. **Ends at a scored, deduped, ordered top-window** (`query-window`). **No separate Picker** — the coordination-node pass is act-or-decide's opening move (Phase 3), per §4. Built as a standalone `refresh-backlog` skill + a shared `plugins/proactive-jupi/shared/` (`schema.sql`, `db.mjs`, `apply-schema.mjs`, `ensure-deps.sh`, `signal-sources.md`); scorer axes are impact × relevance × urgency; un-gates `setup-proactive-jupi` step 7.
  - **Scoring is config, not code** (2026-07-28 edit spec, C3/C4): the `scoring` block in `config.local.json` carries the weights, turnaround constants, deadline horizon/guard and the parse-confidence floor; `db.mjs` holds only defaults. The curve was retuned — **guard 2 → 5 days, horizon 7 → 21** — because the original ranked a hard cutoff five days out *below* a thread nobody had touched in a month: commitment lost to rot. Two supporting changes: the Parser now **extracts deadlines from prose** (only 8 of 38 tasks carried one, so the deadline term was inert for most of the backlog) and records **`parse_confidence`**, which discounts rather than drops a signal it may have misread.

**Phase 3 — Act-or-Decide + Action Planner** ✅ *built (not yet run against live Neon)* → detailed plan: [PHASE-3-PLAN.md](PHASE-3-PLAN.md)
- **Two skills, split by responsibility (PHASE-3-PLAN §8):** **`act-or-decide`** (the *planner* — writes only Neon + Jupi, never touches user tools) and **`execute-actions`** (the *worker* — the only tool-writer; runs `ready` action rows). The `actions` table is the queue between them.
- **`act-or-decide`:** cluster the window by **shared open-question** (the coordination node — one decision can gate actions across many tasks; a task with no open question is a cluster of one), rank by leverage, **research each kept cluster once** (bounded by a per-run `clusterBudget`, with `decisionBudget` bounding how many decisions one run may raise), then the **confidence × exposure 2×2 gate** (§6) writes either a `ready` row or a Jupi decision. Confidence is binary (open-question or not); exposure is draft-first, then destination.
- **`execute-actions`:** **one executor** — runs a `ready` row's verb (draft or real, same tool-call), triggered at the end of an act-or-decide run. Phase 3 defaults to `draft`; `perform` is a config flip on the *same* executor. What lands in **Phase 4 is the closing loop** (poll settled decisions → execute → `EXECUTED` + ping + reopen the `blocked` task), which is what makes high-exposure/external actions fire.
- **Safety ladder:** `--dry-run` (classify only, no writes) → `draft` (default; planner writes rows/decisions, worker drafts) → `perform` (Phase 4).
- Un-gate `setup-proactive-jupi`: create the `act-or-decide` routine and fire one first (dry-run) run at the end of setup, so onboarding proves the loop end-to-end.

**Phase 4 — Post-decision loop + notifications** *(detailed plan: [PHASE-4-PLAN.md](PHASE-4-PLAN.md))* (the settle-triggered other half of the loop; blocked on the Jupi FINALIZED read + EXECUTED-write). **Also refactors the worker to purely functional** (§4a/§8): `execute-actions` → **`execute-action`** (only tool-writer, *no* status); orchestrators own bookkeeping.
- Scheduled **poll-detect** of FINALIZED decisions (`act-post-decision`) → **run the chosen option's actions straight from Jupi** via the pure worker → trace on the signal → **mark each action done in Jupi** → **mark the `blocked` task `done` directly once *all* its `gating_decision_ids` are FINALIZED** (a multi-gated task keeps waiting; §8 step 3) — no planner round-trip, since the option already carried the concrete action; `act-or-decide` is re-invoked **only** if executing a settled action surfaces a fresh fork → optional EXECUTED ping → set Jupi `EXECUTED`. Decided actions are **never materialized into Neon** — Jupi is their home. This is what makes settled decisions — hence every high-exposure/external action — fire.
- *(`perform` mode is config on the Phase-3 executor, not a Phase-4 build; validator-gated sends run whenever it's enabled.)*

**Phase 5 — Business rules (the rule loop)** *(detailed plan: [PHASE-5-PLAN.md](PHASE-5-PLAN.md))*
- **Hybrid store:** Jupi **approves** each rule (the `[BR]` rule-decision — owner sign-off + the "why" trace); a store **tagged `rules`** at setup holds the durable, updatable rule text; `.proactive-jupi/assets.md` **indexes** it.
- **(a) Setup** asks — precisely — where rules live and how to update them (the `rules` role in `assets.md` + `rulesStoreRef` + `ruleThreshold`). **(b) Context searches read it:** shallow (`refresh-backlog`) tags a candidate `rule_ref` off the index; deep (`act-or-decide`) opens the store entry → **pre-empts the open question → confidence high → act** (a task graduates from decide to act). **(c) A second decision kind:** on a recurring trade-off (≥ `ruleThreshold`), `act-or-decide` raises a **`[BR]` rule-decision** whose "codify" option bundles a **business-rule-update** write + the operational action — so approving the rule writes it **and** unblocks the instance; `act-post-decision` runs both (via `execute-action`) and appends the rule to the index.
- **Read-side ships now; write-side rides Phase 4's post-decision loop** — no new execution path, only a new option-action kind; **shares Phase 4's one open blocker** (`get-decision` surfacing tool-authored option-actions).

**Phase 6 — Partner-readiness**
- Delivery surface per-account; data-location qualification; concierge-capacity check.

---

## 12. Open items

- **Concierge capacity** — concurrent pilots at ~2×15min + 30min/week each + our auditing.
- **Change management** — disclosure norms; the person whose task type goes automatic.
- **Nick sign-off** — react to §10 before Phase 2/3 harden the rescope.
- **Supermemory specifics** — data model / retrieval API (pull docs at Phase 1).
- **Cloud-scheduled routines — RESOLVED 2026-07-29.** The deferral held while a routine *read* `<root>` on every fire, which a cloud run can't reach. It no longer does: the routine **carries** its config in its own prompt and materializes it into its own working directory at boot, so nothing durable is read from disk — and the rules index, the one thing that accreted at run time, moved out of `assets.md` into the `rules` store, which removes the write-back half too. The rule that decides what may travel in a prompt (**the prompt carries what setup owns; a store holds only what a run writes**, and nothing that can go stale) lives in `setup-proactive-jupi/reference/routine-prompt.md`, next to the template it governs. `setup-proactive-jupi` step 8 now schedules in the cloud unconditionally; the on-device-only rule and the device-bridge check are gone.
- **Two things about the routine environment are still unknown**, and either would change the above. **(1) Approval mode:** the create API exposes no approval parameter, so both routines land on manual approval and the user must switch them to automatic — setup ends on that as an explicit ✋, and `routine_runs` makes the gated state observable (a fire time that passes with no row at all) rather than silent. If a later API exposes it, set it and drop the notice. **(2) Whether an API-created routine appears in the interface list at all** — if it doesn't, the user can't set approval there either, and setup must print both routines for manual creation instead. Both are one experiment each, and worth running before building further on this. A third assumption sits underneath both: the plugin has to be installed at **account** level, or a cloud routine can reach neither the pipeline skills nor `shared/db.mjs` — the routine fails loudly on this rather than silently.
```
