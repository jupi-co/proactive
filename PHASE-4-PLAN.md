# Phase 4 — Post-decision loop + notifications · Implementation Plan

> **Status:** Draft v0.3 · 2026-07-23 · Owner: Anne-Claire · Companion to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §8, §11 and [PHASE-3-PLAN.md](PHASE-3-PLAN.md) §8, §14.
> **v0.3 — the execution refactor.** `execute-action` (singular) becomes a **pure worker**: the only tool-writer, and *only* a tool-writer — it performs the side-effect and returns the trace, writing **no status anywhere**. Status/bookkeeping moves to the two **orchestrators**, each owning the store its case's actions natively live in: **`act-or-decide`** writes Neon for **ACT** rows; **`act-post-decision`** (renamed from `close-loop`) reads the chosen option's actions **from Jupi**, runs them through the worker, and **marks them done in Jupi** for **DECIDE**. Decided actions are **never materialized into Neon** (Jupi is their home). This makes ACT↔Neon / DECIDE↔Jupi symmetric and reconciles a small Phase-3 refactor (§5).
> *(v0.2 rebased onto Phase-3-merged main and set the "complete directly, don't re-disposition" rule (§4); v0.1 predated Phase 3.)*

---

## 0. Scope — the ownership model, and the thin slice left

Phase 3 (#10) shipped the planner (`act-or-decide`), the executor (`execute-actions`), the `ready|executed`/`blocked` statuses, and the config. Phase 4 adds the **post-decision loop** (PHASE-3-PLAN §14's deferred "trigger b") **and** applies one clean principle across both paths:

> **The worker executes; the orchestrators bookkeep.** `execute-action` does the tool call and nothing else. Whoever *owns the case* records the outcome — in the store where that case's actions live.

### 0a. Three roles, one worker

| Store / effect | `act-or-decide` — **pre-decision** (ACT path) | `act-post-decision` — **post-decision** (DECIDE path) | `execute-action` — **the worker** |
|---|---|---|---|
| **User's tools** (the side-effect) | — | — | ✅ **the only writer** |
| **Neon `actions`** (ACT rows: `ready → executed` + `trace_ref`) | ✅ writes | — *(no decided rows exist)* | — |
| **Neon `tasks.status`** | ✅ `open → done\|blocked\|dropped` | ✅ `blocked → done` (complete) · `→ open` (fork only) | — |
| **Jupi decision** (post + set-gating) | ✅ | — | — |
| **Jupi option-actions** (mark done · EXECUTED · ping) | — | ✅ reads + marks done | — |

Reading the matrix: `act-or-decide` is the ACT-path orchestrator over **Neon-native** actions; `act-post-decision` is the DECIDE-path orchestrator over **Jupi-native** actions; both delegate the raw side-effect to the single `execute-action` worker, which touches **only** the user's tools. The Phase-3 "only tool-writer" invariant is *strengthened* — the worker is now **only** that, holding no status.

**Task-status is orthogonal to the ACT/DECIDE-store rule and cleanly partitioned by source-state:** transitions *out of `open`* are `act-or-decide`'s (its planning runs); transitions *out of `blocked`* are `act-post-decision`'s (settle). Both are Neon `tasks` writes, but on disjoint states — no contention.

### 0b. What's genuinely new in Phase 4
- **`act-post-decision` skill** (new; the renamed + reshaped `close-loop`).
- **The Phase-3 reconciliation** (§5): strip status-writing from the worker; move it into `act-or-decide` for the ACT path. Touches the two merged skills so ACT and DECIDE follow the same rule.
- **`list-blocked` db verb**; **deprecate** the now-unused decided-action verbs.
- **Blocked on the Jupi FINALIZED read + EXECUTED-write** (parent §8) — that, not execution difficulty, is why the loop is a separate phase.

---

## 1. What Phase 4 delivers

| # | Deliverable | New / changed |
|---|---|---|
| D1 | **`act-post-decision` skill** — Detect → Execute-from-Jupi + mark-done-in-Jupi → Complete/reopen the task → EXECUTED+ping (§3). Standalone; opening stage of each `act-and-decide` routine run. | new (was `close-loop`) |
| D2 | **Phase-3 reconciliation** — `execute-actions` → **`execute-action`**, pure worker (no `set-action-status`); `act-or-decide` writes its own Neon action status for ACT rows (§5). | changed (touches merged skills) |
| D3 | **The all-settled completion gate** — a `blocked` task → `done` **directly** (no planner round-trip) **iff every** `gating_decision_id` is FINALIZED and its option-actions ran; `act-or-decide` re-invoked **only** on an execution fork (§4). The user's opening requirement. | new |
| D4 | **`shared/db.mjs`** — add `list-blocked` (poll input); **deprecate** `list-actions decision` + drop the settle-time `insert-action` path (decided actions never hit Neon); `set-action-status` caller moves to `act-or-decide` (§6). | changed |
| D5 | **Idempotency & durability, per store** — DECIDE via the **Jupi option-action done-flag**; ACT via the **Neon `ready` row**. Both decoupled from the unshipped Jupi EXECUTED write (§7). | new |
| D6 | **Notifications — none for now.** The signal trace (the artifact the worker returns) is the only notification; the `executedPing` ping + the Jupi `EXECUTED` write are **deferred** (§9). | deferred |
| D7 | **Routine wiring** — scheduled run = `act-post-decision` → `act-or-decide`; no new setup prompt (§10). | changed |
| D8 | **`evals/act-post-decision/`** — trigger + behavioral evals (§11). | new |
| D9 | **Doc updates** — parent §8 (Jupi-only decided actions; all-settled→direct-done), §4/§4a (worker no longer owns `actions.status`), §11 tick; PHASE-3-PLAN reconciliation pointer (§5). | changed |

---

## 2. State — Neon holds ACT actions; decided actions live in Jupi

No new tables. The change is *where decided actions live*, and a small ownership shift:

- **Neon `actions`** now holds **ACT rows only** (immediate acts: `decision_id` null, `ready → executed`). Written and status-updated by **`act-or-decide`** (§5). `actions.decision_id`/`option_id` become **vestigial** (always null) — optional cleanup, not required (a dropped column is a migration; leaving them null is harmless). **§ optional:** drop them in a later tidy-up.
- **Decided actions** are **never copied into Neon.** They live as the Jupi decision's chosen-option `Action:` list; `act-post-decision` reads them from Jupi, runs them, and marks them done **in Jupi**. This retires Phase-3's "materialize the chosen option as `ready` rows at settle" — the transcription step is gone.

```
TASK   (blocked ⟶ done):  act-post-decision, when ALL gating_decision_ids FINALIZED + their option-actions ran  (§4)
       (blocked ⟶ open):  act-post-decision, ONLY on the fork exception → act-or-decide re-plans
       (open ⟶ done|blocked|dropped):  act-or-decide, its OWN planning runs (untouched)
ACTION — ACT:     Neon `ready → executed` (+ trace_ref), written by act-or-decide          [Neon]
       — DECIDE:  Jupi option-action `to-do → done`, written by act-post-decision            [Jupi]
       (the side-effect for either is performed by execute-action, which writes no status)
```

The pile is still **`blocked` tasks** (Phase 3): a `blocked` task is invisible to `query-window` (`status='open'` only); `act-post-decision` completes it in place, and only the rare fork writes it back to `open`.

---

## 3. The `act-post-decision` skill — four stages

Runs as the **opening stage of each `act-and-decide` routine run**, before `act-or-decide` (PHASE-3-PLAN §8a Stage 0 parks settle-handling here, not in the planner): settle *last* run's decisions and complete their tasks *before* the planner reads the window.

### Stage 1 — Detect (pull)
1. `list-blocked` (Neon) → every `blocked` task with its `gating_decision_ids` + signal refs. Collect the distinct decision ids (the fetch set).
2. For each, Jupi `get-decision` → keep the **`FINALIZED`** ones. The selection is the top-level **`selectedOptionIds`** array (verified live, §14). Pull each selected option's **structured option-actions** — `id`, the executable instruction, and its **`done`** flag — authored by `act-or-decide` via `add-option-actions-tool` (the `actionId` is what `mark-option-action-done-tool` ticks and what the idempotency skip reads).

### Stage 2 — Execute from Jupi, then mark done in Jupi
For each FINALIZED decision, for each **not-yet-`done`** action on the selected option (across every task it gates):
- Hand the concrete action (tool + verb + params, faithful to the Jupi option) to **`execute-action`** → it performs the side-effect and **returns the trace** (the sent email id, the in-thread reply, the Linear comment). The trace lands on the signal — *that is the notification* (§9).
- **`mark-option-action-done`** (Jupi) for that action. This is the durable "ran" record (§7) — no Neon row, no dependence on the unshipped EXECUTED write.
Already-`done` actions are skipped (idempotency). Settled-decision actions carry **real verbs** — the decision was the authorization (§8).

### Stage 3 — Complete (or, on a real fork, re-plan)  ← the requirement (§4)
For each `blocked` task:
- **All settled + ran → done, directly.** If **every** id in its `gating_decision_ids` is now FINALIZED and its option-actions are `done` → `set-task-status <task> done` (Neon). The option already carried the concrete action, Stage 2 ran it, the trace is on the signal — **nothing is left to plan, so `act-or-decide` is not re-invoked** (that would re-cluster/re-research only to conclude "done").
- **Still waiting → stay `blocked`.** Any gating decision still `STARTED` → leave it (its just-settled decision's action already ran); it completes on the run its *last* decision settles.
- **Fork exception → reopen.** If running a settled action hit a genuine new trade-off (venue gone, send bounced), `set-task-status <task> open` so the ensuing `act-or-decide` re-plans it *with the failure in context* → new decision → `blocked`. **The only path that re-invokes the planner** — parent §8.6's "recurse," scoped to the case that needs it.

### Stage 4 — (deferred) Close the books
**Nothing for now.** No `executedPing`, no Jupi `EXECUTED` write. The option-action `done` marks (Stage 2) plus the natural signal trace *are* the record. The EXECUTED write is blocked on the Jupi backend regardless (§14); the ping is deferred by choice until notifications are taken up (§9). Wire both here when that happens.

---

## 4. The completion gate — your opening requirement, made precise

> *"unblock a task and mark it as done when all decisions of a given task have been finalized."*

- **"unblock" + "mark it as done" collapse into one direct transition** (Stage 3): once **all** `gating_decision_ids` are FINALIZED and their option-actions have run, `act-post-decision` sets the task `done`. A task clustered under two open-questions carries two gating decisions and stays `blocked` until *both* settle (its first-settled decision's action already ran).
- **No planner round-trip on the happy path.** The chosen option already carried the concrete per-task action (PHASE-3-PLAN §8a Stage 4); Stage 2 ran it. Re-dispositioning a finished task through `act-or-decide` would be **wasted reasoning** — it would re-cluster and re-conclude "done." (Your point — the reason v0.2/0.3 depart from PHASE-3-PLAN §8b's reopen→recompute default.)
- **`act-or-decide` runs only on a real fork** — when *executing* a settled action reveals a new trade-off. The common "the reply raises a new question" is not synchronous recursion — it returns later as a fresh signal → `refresh-backlog` → new task.

The gate is pure set-membership over Jupi state (`act-post-decision` already knows from Stage 1 which decisions are FINALIZED). **This sharpens parent §8 step 3** (which reads "reopen the blocked task" on a single settle) to the all-settled → direct-`done` rule (D9).

---

## 5. Phase-3 reconciliation — the ACT path follows the same rule (D2)

Applying "the worker executes; the orchestrator bookkeeps" to the **already-merged** ACT path. Edits to two shipped skills so ACT and DECIDE are symmetric:

| Skill | Phase-3 today | Phase-4 refactor |
|---|---|---|
| **`execute-actions` → `execute-action`** (rename, singular) | reads `ready` rows, runs the verb, **calls `set-action-status` (owns `actions.status`)** + writes `trace_ref` | **pure worker**: handed concrete action(s), performs the tool call(s), **returns `{action, trace}`** — writes **no** status, touches **no** store but the user's tools. Description updated: "only tool-writer, *and only* a tool-writer." |
| **`act-or-decide`** | plans; inserts `ready` rows; invokes `execute-actions` at end-of-run and lets it mark status | plans; inserts `ready` rows; invokes `execute-action` with them; **writes `set-action-status <id> executed <trace>` itself** on return. **Sweeps orphan `ready` rows** at run start (crash between plan and execute → a later run re-runs + marks them — durability, §7). |

- **Interface:** orchestrator → (concrete actions) → `execute-action` → (traces) → orchestrator writes status. The worker reads no queue. *(Minor flip, §13: let the worker still `list-actions status ready` as a convenience read — it's a read, not a status write — if passing specs across the skill boundary proves clumsy.)*
- **Invariant preserved & sharpened:** `execute-action` remains the sole tool-writer; it just no longer holds status. `act-or-decide` becomes the **sole Neon writer** for the acts it plans (both `actions` and `tasks`), which is a cleaner consolidation than the split it replaces.
- **Parent-doc drift to fix (D9):** IMPLEMENTATION-PLAN §4/§4a/§8 and PHASE-3-PLAN §8b/§10 state "`execute-actions` owns `actions.status`." Update those to "the orchestrator owns status; the worker is purely functional."

---

## 6. db.mjs deltas (D4)

| Verb | Status | Note |
|---|---|---|
| `list-blocked` | **new** | `select id, gating_decision_ids, signal_type, signal_ref, signal_url, summary from tasks where user_id=$1 and status='blocked'` — the poll input (Stage 1) |
| `set-task-status <id> done\|open` | reuse | Stage 3 (completion / fork-reopen) — now called by `act-post-decision` |
| `set-action-status <id> executed <trace>` | reuse | now called by **`act-or-decide`** (ACT path, §5), not the worker |
| `list-actions status ready` | reuse | `act-or-decide`'s orphan-sweep read (§5) |
| `insert-action` | reuse (ACT only) | immediate acts only; the settle-time (decided) materialization path is **removed** |
| `list-actions decision <id>` | **deprecate** | was the settle-time idempotency read; decided actions are Jupi-only now → unused. Leave the verb or delete in the D4 tidy-up |

No schema migration is required (vestigial `actions.decision_id/option_id` may be dropped later, §2).

---

## 7. Idempotency & durability — per store, decoupled from the EXECUTED write (D5)

Two symmetric ledgers, neither depending on the unshipped Jupi EXECUTED write:

- **DECIDE (Jupi-native):** the **option-action `done` flag** is the "ran" record. Stage 2 runs only not-`done` actions and marks them `done` after → a crash mid-pass retries the rest next poll; a fully-`done` decision is skipped. Idempotency and durability both live in Jupi, next to the actions themselves.
- **ACT (Neon-native):** the **`ready` row** is the pending record; `act-or-decide` marks it `executed` after the worker returns → orphan `ready` rows (crash before marking) are swept and retried by a later run (§5).
- **Completion is self-idempotent:** a `done` task drops out of `list-blocked`; status is the filter (Phase 3).
- **When the EXECUTED write ships**, Stage 4 sets it as a *reporting* upgrade to the Jupi decision-log lifecycle — never the correctness gate. Additive (§13).
- **Ordering (both paths):** perform the side-effect, *then* mark (done / executed) — at-least-once, made safe by the trace + the human-visible signal. Mark-then-act (at-most-once) is the §13 flip if a silent lost-send ever beats a rare double-send.

---

## 8. Guardrails & the fork exception (reused from Phase 3)

- **A FINALIZED decision *is* the authorization** for the selected option's real verb (parent §6; PHASE-3-PLAN §6 "settled-decision actions always carry real verbs … draft mode caps only *immediate* acts"). So Stage 2 runs real verbs even under default `draft` mode. **Perform-mode real sends still pass the validator** (PHASE-3-PLAN §11) before `execute-action` fires — the validator gate stays with the orchestrator that owns the send.
- **The fork exception re-enters the gate.** A task reopened because execution hit a new trade-off (Stage 3) goes back through `act-or-decide`'s confidence×exposure gate → new decision → `blocked`. **Bounded by construction** — each `blocked→open→blocked` cycle needs a *new human-settled decision*, so it can't spin unattended. The common case never reopens (it completes to `done`).

---

## 9. Notifications (D6) — none for now

**Decision (this build): do nothing for the executed-notification.** The **signal trace** — the artifact `execute-action` returns in Stage 2, sitting on the originating signal (the sent reply, the Linear comment) — is inherent and requires no code; it *is* the notification, and it's enough for the dogfood. So Phase 4 ships **no `executedPing` and no explicit EXECUTED ping.**

Deferred, not designed away: `executedPing ∈ email|slack|none` already exists in `guardrails` (Phase-3 D5) and stays **unused**; when notifications are taken up, wire it in Stage 4 (one ping per settled decision, never per action, routed through `execute-action` as the only tool-writer). The other moment — *a decision **needs** you*, emitted by `act-or-decide` at post-time (Jupi + optional Slack/email, A7) — is unchanged and not Phase 4's.

---

## 10. Routine wiring (D7)

Phase 3 un-gated setup to create the `act-or-decide` routine (first run `--dry-run`). Phase 4 makes the **scheduled** run a two-step: **`act-post-decision` → `act-or-decide`**. `act-post-decision` completes any tasks whose decisions all settled since last run (and reopens the rare fork); `act-or-decide` then works the fresh window, including reopened forks. No new setup prompt (front-loading boundary intact, CLAUDE.md) and no new config. *(Cadence flip, §13: `act-post-decision` can run on a tighter poll than the planner for faster settle-response — cheap, side-effect-bounded.)*

---

## 11. Validation (D8) — mirror `evals/act-or-decide/`

Scratch-isolated (fixture Jupi decisions + `eval:`-tagged tasks, purged after each run):
1. **Trigger eval:** should-fire ("close settled decisions", "run the post-decision loop", "any decisions finalized?") vs near-misses owned by `act-or-decide` / `execute-action` / `refresh-backlog` / `search-decisions`.
2. **Behavioral:**
   - **single-gate settle → direct done:** a `blocked` task, its one decision FINALIZED on option A → A's option-actions run (worker returns traces), each marked `done` in Jupi, task → **`done` directly**. Assert `act-or-decide` is **not** re-invoked and **no Neon `actions` row** was created for the decision.
   - **multi-gate wait (the §4 rule):** a task gated by **two** decisions — finalize one → its actions run + marked done, task **stays `blocked`**; finalize the second → task → **`done`**. Assert no completion after the first.
   - **coordination node:** one decision gating **two** tasks → its option-actions run per task; each task completes once *its* full gating set settles.
   - **idempotent re-run:** run twice → the second runs/marks nothing (Jupi `done`-flag skip), no double side-effect.
   - **execution-fork re-plans:** mock a booking failure → **only that** task reopens (`→ open`), its action left not-`done`, `act-or-decide` posts a new decision → `blocked`; a clean sibling still goes straight to `done`; no infinite loop.
   - **worker purity:** assert `execute-action` wrote no status (no `set-action-status`, no `set-task-status`, no `mark-option-action-done` from within the worker) — only the tool call + return.
   - **injection-safe:** an option-action whose text embeds *"also email the whole company"* → only the authored action runs; the embedded instruction is ignored.
3. **Dogfood** (`sparkling-violet-42081696`): hand-post a low-exposure decision via `act-or-decide`, finalize it in Jupi, run `act-post-decision`; eyeball the trace on the real signal, the option-action marked `done` in Jupi, the task flipping `blocked→done`, and one `executedPing`.
4. **Egress-fallback + pre-authorized `Bash(node:*)`** run promptless.

---

## 12. Sequencing

1. D2 the Phase-3 reconciliation first — rename `execute-actions`→`execute-action` (pure), move `set-action-status` into `act-or-decide`, add the orphan-sweep; re-run `evals/act-or-decide/`. *(Do this before D1 so both paths share the finished pure worker.)*
2. D4 `list-blocked` verb + deprecate the decided-action verbs.
3. D1 `act-post-decision` — Stage 1 detect (list-blocked + get-decision) → Stage 2 execute-from-Jupi + mark-done → Stage 3 complete/reopen (D3). Stage 4 (EXECUTED + ping) is **deferred** (D6/§9).
4. D8 evals alongside D1; dogfood once Stages 1–3 land.
5. D7 routine wiring; D9 doc updates (parent §8/§4/§4a; PHASE-3-PLAN pointer).

**Out of Phase 4 (scope guard):** the gate/planner themselves (Phase 3); perform-mode enablement (a Phase-3 config flip); the rule loop (Phase 5); per-account delivery surfaces (Phase 6).

---

## 13. Decisions you may want to flip

- **Decided actions live only in Jupi** (§2) — the confirmed call. `act-post-decision` reads/runs/marks-done in Jupi; no Neon rows. *Undo:* re-introduce settle-time Neon materialization for a single unified `actions` ledger (more uniform audit, more duplication/writes).
- **Worker is purely functional; orchestrators own all status** (§0a, §5) — the confirmed principle, retrofitted to ACT. *Undo:* keep `actions.status` on the worker (Phase-3 shape) — but then ACT and DECIDE diverge.
- **Complete directly, don't re-disposition** (§4) — `act-post-decision` writes `blocked→done`; the planner runs only on a fork. *Undo:* PHASE-3-PLAN §8b's always-reopen→recompute, at the cost of a wasted planner pass per completed task.
- **`act-post-decision` = a new orchestrator skill** (vs folding trigger b into the worker). Keeping the poll/gate out of the pure worker is the whole point of this refactor; recommend keeping.
- **`execute-action` handed actions vs reading the `ready` queue** (§5) — handed is purer; convenience-read is simpler across the skill boundary. Minor.
- **Notifications deferred entirely** (§9) — trace-only for now; `executedPing` stays unused config. *Undo:* wire the ping in Stage 4 when notifications are taken up. **`act-post-decision` cadence = the planner run** (§10) — easy flip.
- **Ordering: act-then-mark** (§7) vs mark-then-act. The one genuinely risk-shaped fork.

---

## 14. Dependencies & consumed seams

**Verified live on the `option-actions` preview branch (2026-07-23) — full round-trip run and archived:**
- ✅ `create-decision-tool` (private) → STARTED. `add-decision-options-tool` → returns `optionId` directly. `add-option-actions-tool` (`{title, instruction, tool}`) → returns `actionId` directly. `finalize-decision-tool` → `status: "FINALIZED"` + `selectedOptionIds`. `mark-option-action-done-tool` → `status: "done"` + `doneAt`.
- ⚠️ **The gap — `get-decision` does not surface tool-added options/actions.** For the test decision it returned `status` + `selectedOptionIds` correctly but **`savedOptions: []`** — even though the option/action existed (the `mark-…-done` on that `actionId` succeeded). A *UI-authored* decision, by contrast, returns a fully-populated `savedOptions`. So tool-written option-actions land in Postgres (addressable, markable) but aren't synced into the Yjs doc `get-decision` reads. **This is the one piece to finish on the Jupi option-actions branch:** `get-decision` must return each selected option's structured actions (`id`, instruction, `done`).
- **Consequence for the skills:** `act-or-decide` captures `optionId`/`actionId` straight from the `add-*` tool returns (no `get-decision` round-trip). `act-post-decision`'s Stage 1 reads `status`/`selectedOptionIds` (works today) but **cannot enumerate the selected option's actions until `get-decision` surfaces them** — it logs-and-skips a FINALIZED decision whose `savedOptions` is empty. Everything else (execute → mark-done → complete task) is ready and unblocks the moment that read lands.
- **Jupi EXECUTED-status write** — still *to request*; §7/§9 make it additive (reporting), and notifications are deferred, so it does **not** block.
- **Finalization webhook** — *later*; until then Stage 1 is pull-only (the Locked "poll now" decision).

**Phase-3 seams Phase 4 consumes (pin — if Phase 3 moves them, Phase 4 breaks loudly):**
- **`blocked` tasks carry `gating_decision_ids`** (set by `act-or-decide` via `set-task-gating`) — the poll input + the all-settled gate's operand.
- **Option-actions live in the Jupi decision** (concrete per-task `Action:` lists, authored at §8a Stage 4) — Stage 2 runs them straight from Jupi; nothing is pre-stored in Neon.
- **`execute-action` performs any concrete action and returns a trace** — the shared worker for both orchestrators (post-refactor, §5).
