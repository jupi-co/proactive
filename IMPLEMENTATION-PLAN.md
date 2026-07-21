# Auto-Jupi MVP — Implementation Plan

> **Status:** Draft v0.2 · 2026-07-21 · Owner: Anne-Claire · Living doc.
> Reconciles three sources — Nick's value-prop doc, the review-with-Claude, and the running `BRIEF.md` — **with Anne-Claire's architecture diagram as the authority on structure.** Where sources disagreed, this plan follows the review; the divergences (and how to undo each) are in §10.

---

## 1. What we are building (one paragraph)

A **proactive engine** that does the user's founder/GTM work ahead of being asked. Incoming **signals** become scored **tasks** in a backlog; a picker selects the task(s) that unlock the most value; for each, the engine either **acts** (when it's confident and the action is low-risk) or **poses a structured Jupi decision** (when it's unsure or the action is risky). Settling a decision triggers execution (the closing loop). Undocumented know-how becomes **business rules** through that same loop, so over time more tasks resolve without asking. v1 dogfoods on the owner's founder/GTM stack; it's built to port to one design partner later.

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
| A9 | Noise control | **Confidence × risk gate inside act-or-decide** (not a volume cap). See §6. |

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
                                                    │    on confidence × risk:        │
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
LAYER          └── read by every automation stage; written by update-context / provisioning / the loops
```

### 4a. Where state lives — three homes, by data character

| State | Home | Why there |
|---|---|---|
| **Facts & relationships** (people/orgs/projects/processes) | **Supermemory** | built for semantic recall; written by `update-context` |
| **Task backlog** + **actions** (each action carries its `decision_id`/`option_id` + the executable instruction) | **Neon Postgres** (serverless) — `tasks` + `actions` tables (no separate registry). **Flat-file fallback** for data-wall accounts. | mutable, ordered, exactly-enumerated, recomputed each run — a DB does `ORDER BY score` / `WHERE status='open'` / transactional updates natively; an LLM rewriting a markdown table each run is brittle |
| **Asset Map** (tools + action surfaces, agents-for-reuse, rules index) | **`assets.md`** — flat markdown, read in full, hand-edited. **No Supermemory mirror.** | config you enumerate in full and edit by hand; markdown is the right size |
| **Decisions + full lifecycle** (incl. EXECUTED) | **Jupi** | Jupi is the decision log (§8) |
| **Business rules** (*when X, always Y*) | Jupi (resolved rule-decisions) → indexed in `assets.md` | empty today; accretes reactively via task→decision→rule |

**`assets.md` is plain markdown, no Supermemory mirror.** You read an asset map *in full* and edit it by hand — never top-K semantic retrieval — so markdown is the right size; act-or-decide just reads the whole (small) file. *Upgrade trigger:* revisit only if the map grows large, needs programmatic filtering, or goes multi-user.

**Backlog + decision registry → Neon Postgres (serverless).** The backlog is the one genuinely structured-mutable store (scores/statuses recomputed each run) — exactly where a file is weakest and a DB strongest. Neon is trivial to stand up and **matches Jupi's own Postgres**, so we build the real store once and scale to a partner with **no migration**. It also dissolves the file-explosion worry: done tasks carry `status='done'` and drop out of the active `WHERE status='open'` query — dedup + audit history retained for free, no wiping. Access via the Neon MCP / serverless driver (*confirm at build time*). **Data-wall accounts** that refuse cloud keep a flat-file backlog fallback.

**Only Facts live in Supermemory** — the backlog (Neon) and `assets.md` *read* Facts from it but don't live there.

**Execution leaves a trace where the work happened.** Every executed action writes its proof next to the originating signal (the Slack reply, the sent email or draft, the Linear comment) — so any random check finds *why* and *what*, in place (§8).

> **Note — there is no separate "Picker."** Value-based selection (which decision unlocks the most) *requires* deriving the tasks' actions and gating decisions, which is act-or-decide's own reasoning — so it lives **inside** act-or-decide as its opening move (the coordination-node pass). The only thing upstream is the **cheap Scorer**, whose sole job is to order the backlog and narrow to a top window so expensive reasoning doesn't scan the whole backlog every run. Split by **cost**, not by responsibility.

**Two engines still exist**, but the interface between them is the **Knowledge layer**, not a folder:
- **`update-context`** — maintains Facts & relationships in **Supermemory** (crawler model: coverage + backlog of topics to investigate).
- **`act-and-decide`** — the automation pipeline above (parse → score → pick → act-or-decide → plan → execute).

*(Whether the pipeline stages are one skill with clear stages or several specialized skills is an implementation choice — leaning one skill with explicit stages for coherence, revisit if runs get too long.)*

---

## 5. The task → action model (the correction that matters)

1. **Parser**: signal → a Task (short label + standalone summary + relevant facts + candidate open questions).
2. **Scorer** *(cheap, upstream)*: impact × confidence, giving the backlog its order and narrowing to a **top window**. No reasoning about decisions here — pure prioritization. This is the only "picking" done outside act-or-decide, and it exists purely to bound cost.
3. **Act-or-Decide** *(over the window)*: its **opening move is the coordination-node pass** — find the decision that unblocks the most actions across the windowed tasks (value-based selection lives here, not upstream). Then, per candidate action, run the **confidence × risk gate** (§6): act now, or raise the decision.
4. **Action Planner**: expand the task (+ any settled decisions) into **one or several concrete parallel actions**. The action set is **not fixed** — a settled decision can spawn new actions and new decisions, so it's recomputed as decisions resolve.
5. **Execute**: run the actions (gated by guardrails), notify, log.

---

## 6. The confidence × risk gate (act OR decide)

The noise control. For each candidate action:

| | **Low risk** — internal / reversible (draft, label, note, Slack to a peer) | **High risk** — external or sensitive (email to a client, msg to the CEO, commit, irreversible) |
|---|---|---|
| **High confidence** | **ACT** — just do it | **DECIDE** (or act only if a rule authorizes it) |
| **Low confidence** | **DECIDE** — content/approach is genuinely open | **DECIDE** |

- *Example:* the reply's content is known → **act**: draft the email (low risk, nothing sent). Hesitating on what to say → **decide**: raise the trade-off.
- **Risk is mostly about *destination*, not the verb.** Drafting is always low-risk (nothing leaves). The real gate on *send/post* is **internal vs external**: an internal Slack to a peer is low-risk; an external email to a client is high-risk. Refine further by **recipient sensitivity** — peer < manager < CEO < external counterparty. Irreversibility compounds it.
- A **rule** can lower the effective risk of a class of actions → they graduate from "decide every time" to "act."
- Result: the user is interrupted **only for genuine trade-offs.** No artificial per-day cap.

---

## 7. Provisioning module (the Phase-0 build you picked)

Stands up a workspace from cold — the formalized "cold-start" the review demanded. Steps:

1. **Connect tools (MCP):** Gmail · Calendar · Drive · Linear · GitHub · Jupi · Slack · **Supermemory**. Pre-authorize; verify each connection's action surface.
2. **Discover existing assets → write the Asset Map:** inventory connected tools/MCPs (+ each one's action surface), existing agents/skills, and any documented rules/playbooks. Record them in the **Asset Map** (§4a). *Register discovered agents for reuse* (A4 — reuse, not lifecycle). **At Jupi today there are no rules → skip rule-discovery, go straight to bootstrap.** At a partner, crawl their docs.
3. **Seed the brain:** run `update-context` **full** crawl into Supermemory from **the last 1 month** of tool history to start (widen later once the loop is stable) — facts about people, orgs, projects, processes, tools.
4. **Initialize the backlog:** parse recent signals into candidate tasks; score them.
5. **Set cadence / triggers:** schedule runs (tie to one recurring ritual; cadence decides the responsiveness).
6. **Set guardrails:** the initial confidence×risk policy — which action classes may auto-act vs always-decide. **Default conservative** (draft-only), loosen as trust builds.

**Outputs:** connected tools · seeded Supermemory · initial scored backlog · schedule · guardrail config. → I can scaffold this as the first module (see §11).

---

## 8. The closing loop (net-new)

**Decision lifecycle — in Jupi:** `STARTED → FINALIZED (user settles) → EXECUTED (loop ran the action)`. **EXECUTED is a status on the Jupi decision itself** (a Jupi backend addition to request), so the full lifecycle lives in the decision log. **No separate registry:** the executable instruction lives in the **`actions` rows** (each gated by `decision_id` + `option_id`); the decision + authoritative status live in Jupi. This is what stops a finalized decision being missed or run twice.

1. **The pile = gated action rows:** for each created decision, its options' actions sit in `actions` with `status='pending_decision'` (`decision_id` + `option_id` set) and the instruction in `description`.
2. **Detect (pull):** each run, gather `gating_decision_ids` across `open` tasks and fetch those decisions from Jupi; take the **FINALIZED** ones not yet **EXECUTED** (finalized-status read arriving in ~1–2 days). Push later = Jupi POSTs the routine's run endpoint (§ execution model).
3. **Execute:** run the actions matching the **selected** option (guardrail-gated per §6); skip siblings on other options; then **set the Jupi decision to EXECUTED**.
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

- **Human is upstream (sets rules, gets only real trade-offs)**, not a downstream approval inbox. → *Undo:* route every action through a decision instead of the confidence×risk gate.
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
- ✅ Scaffolded `proactive/` as a **Claude plugin** (marketplace `auto-jupi`, plugin `jupi`, per jupi-skills PR #7): `setup` skill at `plugins/jupi/skills/setup/` with bundled `reference/schema.sql`; packaging + validate scripts + `post-commit` hook; `dist/jupi.zip` builds for Cowork **Local uploads**.
- ✅ Exercised `/setup` partway: Gmail/Calendar/Linear/Drive/Jupi probed; **Supermemory connected via MCP**; **Neon schema applied** to `sparkling-violet-42081696` via project-scoped conn string (not the account-wide MCP).
- **Next: `update-context` skill**, then finish `/setup` steps 5–8 (the fresh 30-day Gmail+Cal+Linear crawl into Supermemory).

**Phase 1 — Brain on Supermemory**
- Integrate Supermemory API; port `update-context` to write facts there; validate against the existing 61-entity dataset as fixtures.

**Phase 2 — Backlog pipeline**
- Parser → Scorer → Backlog → Picker (coordination-node pass).

**Phase 3 — Act-or-Decide + Action Planner**
- Confidence×risk gate; task→N-actions expansion; recompute-on-settle.

**Phase 4 — Closing loop + notifications**
- Poll-detect → execute → Slack/email → log → recurse.

**Phase 5 — Rule loop**
- Reactive rule-decisions during execution; owner-approval path → Business rules store.

**Phase 6 — Partner-readiness**
- Delivery surface per-account; data-location qualification; concierge-capacity check.

---

## 12. Open items

- **Concierge capacity** — concurrent pilots at ~2×15min + 30min/week each + our auditing.
- **Change management** — disclosure norms; the person whose task type goes automatic.
- **Nick sign-off** — react to §10 before Phase 2/3 harden the rescope.
- **Supermemory specifics** — data model / retrieval API (pull docs at Phase 1).
```
