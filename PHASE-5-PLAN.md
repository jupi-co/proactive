# Phase 5 — Business rules (the rule loop) (Implementation Plan)

> **Status:** Draft v0.2 · 2026-07-23 · Owner: Anne-Claire · Living doc.
> Companion to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §2/§6/§9, [PHASE-3-PLAN.md](PHASE-3-PLAN.md) §14
> (the original Phase-5 seam), and **[PHASE-4-PLAN.md](PHASE-4-PLAN.md)** (the post-decision loop this builds on).
>
> **v0.2 — rebased onto Phase-4-merged main (c6130dc).** Phase 4 landed the **post-decision loop** and a **pure-worker
> refactor**, which reshapes Phase 5's write-side: decided actions now live **only in Jupi** (the "materialize the chosen
> option as Neon `ready` rows at settle" step is *gone*); the worker is renamed **`execute-action`** (singular) and does
> **only** the tool call, returning a trace; **`act-post-decision`** is the DECIDE-path orchestrator that reads the
> chosen option's actions from Jupi, runs them through the worker, marks them done in Jupi, and completes the task
> `blocked → done` directly. Phase 5's `[BR]` decision is just a *new kind* of decision whose settled option carries a
> **business-rule-update option-action** — it needs no new execution path.
>
> **What changed vs the §14 sketch.** §14 kept rules living **only** as resolved Jupi rule-decisions indexed in
> `assets.md`. Phase 5 promotes them to a **hybrid store**: Jupi still *approves* each rule (the `[BR]` decision — owner
> sign-off + the decision-log trace of *why*), but the durable, human-readable, **updatable** rule text lives in a
> **business-rule store** the user names at setup, indexed in `.proactive-jupi/assets.md`. Rules become a thing the
> engine can **find, read, and write** — which is what makes the three moving parts below concrete.

---

## 1. What Phase 5 delivers (one paragraph)

The **rule loop** — how undocumented know-how becomes a standing rule, so over time more tasks act without asking
(the parent §1 promise, the §9 kill-criterion). Three moving parts. **(a) Setup** asks — precisely — **where business
rules live and how to update them**, tagging that tool **`rules`** in `assets.md` and recording the id/path that opens it as `rulesStoreRef` in config, pointing the
`assets.md` rules index at it. **(b) Context searches read it:** both the shallow recall (`refresh-backlog` Stage 3)
and the deep dig (`act-or-decide` Stage 3) consult the store, so an open question a rule already answers is **pre-empted
→ confidence `high` → act** (a task *graduates from decide to act*, parent §9). **(c) `act-or-decide` gains a second
decision kind:** besides an **operational decision** (one-off trade-off — *which discount for this client?*), on a
**recurring** trade-off it raises a **`[BR]` rule-decision** (*when X, always Y?*), whose chosen option carries a
**business-rule-update option-action** that writes the rule into the store — bundled, in the same option, with the
operational option-action that settles the instance at hand. On approval, `act-post-decision` runs both through
`execute-action` and completes the task directly. Reactive, grounded in past decisions + habits; no proactive authoring
pass (locked decision, parent §2 "Rule bootstrap").

---

## 2. Steering decisions (locked with the user 2026-07-23)

| # | Fork | Choice |
|---|---|---|
| P5-1 | **Where rules live** | **Hybrid.** Jupi *approves* (the `[BR]` decision — owner sign-off + the "why" trace); the **business-rule store** (named at setup) holds the durable, updatable rule text; `assets.md` **indexes** it. Reconciles "find *and* update rules" + a write-action with §14's owner-approval step. |
| P5-2 | **Recurrence → what's raised** | **One `[BR]` decision** ("when X, always Y?"). Its chosen option bundles **two option-actions** — the BR-update write **and** the operational action — so approving it **writes the rule AND unblocks the current instance** (Phase-4 completion gate: `blocked → done` directly once both ran). No double-ask. Operational decisions stay the default for one-off, non-recurring trade-offs. |
| P5-3 | **BR-update is decision-gated only** | A business-rule-update action is **always** a Jupi option-action on a settled `[BR]` decision, run by `act-post-decision` → **never** an immediate Neon act. Structural under Phase 4: decided actions never touch Neon, so a BR-update can't appear as an immediate-act row. Writing a standing rule only fires post-approval. |
| P5-4 | **Default store** | `.proactive-jupi/business-rules.md` — a local, in-full-readable, hand-editable **markdown rulebook** (same philosophy as `assets.md`). The user may tag an external store `rules` instead (Drive folder / Notion / a docs dir); partners crawl their existing SOPs. |
| P5-5 | **Recurrence detector** | **`search-decisions` over the Jupi log** — the same trade-off settled the same way ≥ `ruleThreshold` times (config, default 2). Rides `act-or-decide`'s **existing** Stage-3 `search-decisions-tool` read (SKILL.md:116) — no new read. Grounded in past decisions + habits; no proactive scan. |
| P5-6 | **Title convention** | The rule-decision's Jupi title is **prefixed `[BR]`** — a cheap, human- and machine-legible marker distinguishing it from operational decisions in the log and the poll. |
| P5-7 | **Index bookkeeping owner** | `act-post-decision` owns the `assets.md` **rules-index** line (it already reads `assets.md` and owns DECIDE-path bookkeeping). `execute-action` performs only the store write (the domain side-effect) and returns a trace; the index entry is orchestrator bookkeeping, keeping the worker pure. *(Minor flip — §10.)* |

---

## 3. Prerequisites — Phase 4 is landed; one shared Jupi blocker remains

- **Phase 4 (the post-decision loop) is merged** (c6130dc). A `[BR]` decision's outcome fires through **exactly** its
  path — `act-post-decision` Stage 2 reads the chosen option's structured actions from Jupi, hands each to
  `execute-action`, marks it done. Phase 5 adds a *new kind of option-action* (the BR-update write), **no new execution
  path**.
- **The one blocker is shared with Phase 4 — and its fix is merged (2026-07-23), deploying.** `get-decision` did
  **not** surface tool-authored option-actions (PHASE-4-PLAN §14 — they land in Postgres, addressable/markable, but
  weren't synced into the Yjs doc `get-decision` reads), so `act-post-decision` couldn't enumerate a tool-posted
  decision's actions. The Jupi-side fix is now merged and deploying; once confirmed live, Phase 5's **write-side**
  (running a settled `[BR]` option's actions) unblocks with no skill change — `act-post-decision` keeps its defensive
  log-and-skip as a fallback until the read is verified. Phase 5's **read-side** never depended on it (§5) and ships
  immediately.
- **Existing hooks Phase 5 makes concrete:** `actions.rule_ref` (schema.sql:84 — survives Phase 4), the `assets.md`
  "Business rules — index" section (`assets.template.md`), and the §14 read-side sketch ("open-question pre-empted
  against the rules index → confidence high"). `actions.decision_id/option_id` are **vestigial** post-Phase-4 (decided
  actions are Jupi-only) — Phase 5 does not revive them.

---

## 4. Part (a) — Setup: ask where rules live and how to update them

**The precise question, front-loaded.** Today setup step 3 does a generic unattended scan for "documented
rules/playbooks" and records "none" for Jupi. Phase 5 adds an **explicit, human-gated question** — which therefore
belongs in the **attended prelude** (step 2b, with the stack-discovery questions), not the unattended step 3:

> *"Where do your business rules / playbooks / SOPs live today — and where should Jupi write a new one when you approve
> it? (e.g. a Notion page, a Drive folder, or I can keep a simple `business-rules.md` in this workspace.)"*

- **The store is named by the `rules` role in `assets.md`**; config carries only the id/path that opens it, `rulesStoreRef` in `.proactive-jupi/config.local.json`. *(Superseded shape — the original draft put `location`/`tool`/`readable` in config; config no longer names a tool.)*
  ```jsonc
  "rulesStoreRef": ".proactive-jupi/business-rules.md",
  "ruleThreshold": 2                                    // recurrence count that triggers a [BR] decision (P5-5)
  ```
  Default (no external repo named) → the local markdown rulebook (P5-4). Template ships this default so setup needn't
  block on it.
- **`assets.md` rules index points at the store.** The "Business rules — index" header records the `location`; each
  approved rule adds a one-line entry (rule id in Jupi · *when-X-always-Y* · owner · task types it unblocks · store ref).
- **Step 3 (unattended) then *inventories* the store**, not asks about it: read the named store, seed the index with any
  rules already there. At Jupi today the default store is empty → index stays "none" until the loop precipitates one.
- **Parity:** this replaces the vague "documented rules/playbooks" clause in step 3 and adds one prelude question — keep
  the front-load discipline (CLAUDE.md "Setup-skill parity": all human prompts in the attended prelude; nothing
  downstream re-prompts).

---

## 5. Part (b) — Context searches read the store (read-side, pre-emption)

Both search depths consult the store so a rule that already answers a trade-off collapses the open question. **Note the
store ≠ the Jupi decision log:** the log is *past decisions* (already read by the deep search — SKILL.md:116); the store
is the durable *rule text*. This adds a **new** read on the deep side and a **cheap index read** on the shallow side —
and, critically, **keeps the shallow stage off Jupi** (refresh-backlog's contract forbids Jupi reads, SKILL.md:33/149).

- **Shallow — `refresh-backlog` Stage 3** (deliberately cheap; stays shallow, stays off Jupi). Read the **`assets.md`
  rules index** (small, in-full — it already loads `assets.md` at boot, SKILL.md:45; no deep store read, no Jupi). If an
  index entry plainly matches a candidate `open_question`, **tag the open-question with the candidate `rule_ref`** rather
  than resolving it — the authoritative pre-emption stays downstream.
- **Deep — `act-or-decide` Stage 3** (research each cluster once). Add a research step **alongside** `recall` Facts and
  `search-decisions`: **open the matching rule in the store** (via the `rules`-tagged tool) and confirm it applies to
  *this* instance. If it does → the open question is **pre-empted → confidence `high` → ACT**, and the emitted `ready`
  row carries `rule_ref` = the rule (schema.sql:84). This is the §14 read-side, now reading the real store. If the rule
  *almost* applies but the instance has a wrinkle the rule doesn't cover → it stays a trade-off (decide), possibly a
  `[BR]` amendment (§6.4).

**Net effect:** a task whose trade-off a rule covers no longer raises a decision — it acts (an immediate Neon ACT row,
Phase-4 ACT path), traced to the rule. That is the "graduate from decide to act" metric (parent §9).

---

## 6. Part (c) — `act-or-decide`: two decision kinds

A task can be gated by either kind; `act-or-decide` chooses in Stage 3/4.

### 6.1 Operational decision (the existing kind — unchanged)
A one-off trade-off (which discount for *this* client, which slot for *this* meeting). Options carry operational
option-actions; settling gates only the task(s) at hand; **no rule persists.** This stays the default.

### 6.2 `[BR]` rule-decision (new)
Raised when the trade-off **recurs** (§6.3). Instead of re-raising the one-off, `act-or-decide` proposes to **codify** it,
authored through the *same* Jupi mechanism it already uses (`add-decision-options-tool` → `add-option-actions-tool`,
SKILL.md:201):

- **Title prefixed `[BR]`** (P5-6), e.g. `[BR] When a strategic client asks for a discount under 15%, approve it`.
- **Framing:** *"When X, always Y?"* — the standing rule, bundled with the live instance that triggered it (so the owner
  sees the concrete case they're generalizing from).
- **The "codify" option carries two structured option-actions** (Fork P5-2), each an `add-option-actions-tool`
  `{title, instruction, tool}`:
  1. a **business-rule-update action** — `tool` = the `rules`-tagged tool; instruction *"write rule 'when X → Y' to
     `<rulesStoreRef>`"*.
  2. the **operational action** that satisfies the current instance (the discount draft/send, etc.) — so approving the
     rule **also unblocks this task**.
- **A "don't-codify" option** carries only the operational action, leaving the store untouched. Options thus read as
  *"make it a rule (strict / with exceptions) vs just handle this one"* — content, not machinery.
- **Gating & lifecycle** are identical to any DECIDE: `set-task-gating` the task with the `[BR]` decision id; task →
  `blocked`. At settle, `act-post-decision` runs the chosen option's actions from Jupi and — since both gating conditions
  are met — completes the task **`blocked → done` directly** (PHASE-4-PLAN §4). No new state machine, no Neon
  materialization.

### 6.3 Detecting recurrence (Stage 3 addition — no new read)
Ride `act-or-decide`'s existing Stage-3 `search-decisions-tool` read (already there for "has this trade-off been settled
before?", SKILL.md:116). Count prior **FINALIZED** decisions on the same trade-off: ≥ `ruleThreshold` with a
*consistent* chosen outcome → raise `[BR]`; below threshold, or inconsistent outcomes → operational (not yet a rule).
Conservative and reactive by construction.

### 6.4 Amendment (a rule that almost fits)
A task matching an existing rule but with a genuine wrinkle (§5) → not a silent override: raise a `[BR]` **amendment**
decision (options: apply-as-is / add-exception / supersede). Keeps the store owner-governed.

---

## 7. Part (c′) — running a settled `[BR]` decision (`act-post-decision` + `execute-action`)

Under the Phase-4 ownership model this is almost free — a `[BR]` option's actions are ordinary Jupi option-actions;
`act-post-decision` already reads, runs, and marks them. The Phase-5 specifics:

- **`execute-action` (pure worker) performs the store write.** Handed the BR-update action, it writes the rule into
  the `rules` store via its tool (`file` → the markdown rulebook; `drive`/`notion` → the connector) and **returns the
  trace** (the rulebook section anchor, the Notion block id). Symmetric with any other content side-effect; it writes
  **no** status (Phase-4 purity).
- **`act-post-decision` owns the bookkeeping** (P5-7): after the worker returns `ok`, it (i) `mark-option-action-done` in
  Jupi (as for any option-action), and (ii) **appends the `assets.md` rules-index line** (rule id · when-X-always-Y ·
  owner · store ref) — a Proactive-Jupi-owned config write, the same category as the Neon/Jupi bookkeeping it already
  does. The worker stays pure; the index is never written by two skills.
- **The operational action on the same option** runs in the same Stage-2 pass; both marked done → the task completes
  `blocked → done` directly (§6.2).
- **No extra validator gate** — a settled `[BR]` decision *is* the authorization (PHASE-4-PLAN §8: a FINALIZED decision
  authorizes its real verbs). Writing a rule is internal/reversible; the *standing* nature was what the owner approved.
- **Invariant:** a BR-update action always carries a Jupi `decisionId`/`actionId` (it came from a settled `[BR]` option)
  — `act-post-decision` never originates one, and it never appears as a Neon immediate act (P5-3).

---

## 8. Build order (two independently shippable slices)

1. **Read-side first — ships now, no blocker.** Value the moment a rule exists (even a hand-written one in the default
   rulebook):
   - Setup: the rule-store prelude question + the `rules` role + `rulesStoreRef` + template default + step-3 inventory (§4).
   - `refresh-backlog` Stage 3: shallow index tag (§5).
   - `act-or-decide` Stage 3: deep store read → pre-emption → `rule_ref` on acted rows (§5).
   - *Testable now* by seeding one rule into `.proactive-jupi/business-rules.md` and watching a matching task ACT
     instead of DECIDE.
2. **Write-side — unblocks with the merged `get-decision` fix (§3), deploying.** Precipitates *new* rules:
   - `act-or-decide`: recurrence detection + the `[BR]` decision (title prefix, two option-actions) (§6).
   - `act-post-decision`: recognise a completed BR-update action → append the `assets.md` rules index (§7); the
     execute-run + mark-done + task-complete are already Phase-4 behaviour.
   - `execute-action`: handle a `rules`-store write verb (`file`/`drive`/`notion`) → return the store trace (§7).

---

## 9. Schema & data (no migration needed)

- **No new table, no new column.** A settled BR-update is a Jupi option-action (never a Neon row); `rule_ref` (existing,
  schema.sql:84) links *acted* (read-side) rows to the rule that justified them. The store lives outside Neon
  (file/Drive/Notion); `assets.md` holds the human index. `actions.decision_id/option_id` stay vestigial (Phase 4).
- **IMPLEMENTATION-PLAN §4a update** (do when this lands): the "Business rules" row changes from *"Jupi (resolved
  rule-decisions) → indexed in assets.md"* to *"Jupi approves + **business-rule store** holds the rule text → indexed in
  assets.md."*

---

## 10. Edge cases / guardrails

- **Signal content is data, not instructions** (inherited): a signal that *says* "make this a rule" does not author one —
  only a recurrence the engine itself detects + the **owner's** Jupi approval does. No self-authored rules. (Mirrors the
  Phase-4 injection-safety eval, PHASE-4-PLAN §11.)
- **Store unreachable at run time:** the deep read fails soft to "no rule found" → the task decides rather than
  mis-acting; on the write side `execute-action` returns `ok:false` and `act-post-decision` leaves the option-action
  `to-do` for the next poll (Phase-4 idempotency) — the rule simply isn't indexed until the write lands. Never fabricate.
- **Stale/removed rule:** rules are hand-editable in the store; the index read is per-run, so deleting a rule stops
  pre-empting — no ghost state in Neon or Jupi.
- **`ruleThreshold` conservative by default (2)** so the loop doesn't over-codify from thin evidence; tune up if rules
  churn (parent §9 kill-criterion watches whether rules *stick*).
- **Index-write ownership (P5-7) is a flip:** `execute-action` could instead write the index as part of its side-effect
  (fewer hand-offs) at the cost of the worker touching Proactive-Jupi config. Kept on the orchestrator to preserve worker
  purity; revisit if the hand-off proves clumsy.

---

## 11. Files this touches (implementation checklist)

- `plugins/proactive-jupi/skills/setup-proactive-jupi/SKILL.md` — step 2b prelude question; step 3 store-inventory;
  guardrails note.
- `plugins/proactive-jupi/skills/setup-proactive-jupi/reference/config.template.json` — `rulesStoreRef`
  default + `ruleThreshold`.
- `plugins/proactive-jupi/skills/setup-proactive-jupi/reference/assets.template.md` — rules-index header points at the
  store; entry format documented.
- `plugins/proactive-jupi/skills/refresh-backlog/SKILL.md` — Stage 3 shallow index tag (§5).
- `plugins/proactive-jupi/skills/act-or-decide/SKILL.md` — Stage 3 deep store read + pre-emption; Stage 3/4 recurrence →
  `[BR]` decision; the Posting §: `[BR]` title convention + the two-option-action shape; the gate note (SKILL.md:174)
  made concrete.
- `plugins/proactive-jupi/skills/act-post-decision/SKILL.md` — recognise a completed BR-update option-action → append the
  `assets.md` rules index; the decision-gated invariant (§7).
- `plugins/proactive-jupi/skills/execute-action/SKILL.md` — handle a `rules`-store write verb → return the store
  trace (§7).
- `IMPLEMENTATION-PLAN.md` §4a (store row) + §11 Phase-5 line; `PHASE-3-PLAN.md` §14 (mark superseded-by-this-doc).
- New default store file created lazily at first rule (or an empty `.proactive-jupi/business-rules.md` seeded by setup).

---

## 12. Open items

- **`get-decision` surfacing tool-authored option-actions** — the shared blocker for Phase 5's write-side (§3,
  PHASE-4-PLAN §14). **Fix merged 2026-07-23, deploying** — verify the first live settle returns the selected option's
  structured actions, then the defensive log-and-skip in `act-post-decision` can be retired.
- **External-store write ergonomics** — the `file` default is trivial; Drive/Notion writes need the connector's
  create/update surface confirmed per partner (defer to Phase 6 partner-readiness; dogfood on the markdown file).
- **Rule granularity** — one prose *"when X → Y"* entry per rule (LLM-read) to start; add structured conditions only if
  matching gets unreliable.
- **Index vs full-store read cost** — if the rulebook grows past in-full read, add a retrieval step (mirror the
  `assets.md` "upgrade trigger", IMPLEMENTATION-PLAN §4a). Not a launch concern.
