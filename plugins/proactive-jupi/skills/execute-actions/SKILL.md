---
name: execute-actions
description: >-
  Proactive-Jupi's executor — the ONLY skill that touches the user's tools. It drains the `ready` action
  rows act-and-decide queued in Neon and runs each one against its tool (create the Gmail/Linear draft,
  or — in perform mode — send/post/book for real), then marks it executed and records the trace. It owns
  `actions.status` (ready → executed) and never writes `tasks.status`. Use whenever queued actions need to
  run: "execute the ready actions", "run the queue", "flush the drafts", "send what act-and-decide prepared",
  or right after an act-and-decide run (which invokes it automatically). Draft actions are still actions —
  they run here, not in the planner. One executor: a draft and a real send are the same tool-call; the row
  already carries the verb. Not for: deciding WHAT to do or clustering/gating the backlog (act-and-decide),
  building or scoring the backlog (refresh-backlog), or building Facts (update-brain) — this skill only
  runs rows that are already `ready`.
disable-model-invocation: false
---

# execute-actions — the worker (the only tool-writer)

You run the `ready` action rows act-and-decide queued. **One job:** for each row, do exactly what its
`description` says via its `tool`, then mark it `executed` with a trace. **A draft and a real send are the
same operation** — the planner already chose the verb (per `mode`); you just run it.

> **You are the only skill that writes to the user's tools.** You own **`actions.status`** (`ready →
> executed`) and **never** touch `tasks.status` (that's act-and-decide's). All Neon via
> `${CLAUDE_PLUGIN_ROOT}/shared/db.mjs`.

## Contract (hard)
- ✅ **Run only `ready` rows** (the sole not-yet-run status). Skip anything already `executed`.
- ✅ Do **exactly** what the row's `description` says — no re-deciding, no re-drafting, no scope creep. The
  reasoning already happened in act-and-decide.
- ❌ **Never write `tasks.status`** and never post/settle Jupi decisions.
- ⚠️ **Perform-mode real sends pass the validator first** (`../act-and-decide/reference/VALIDATOR.md`, the
  real-send branch) before you fire them. Draft creations need no gate.

## Boot
1. `.claude/proactive-jupi.local.json` → `guardrails.mode` (`draft`/`perform`), `executedPing`.
2. Ensure the DB helper's deps (first run): `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/shared" --no-save`
   (sandbox-network-disabled fallback if egress is blocked — pre-authorized, promptless).
3. Load the tool MCP schemas you'll need (Gmail, Linear, …) via ToolSearch as you encounter them.

## The core (both triggers reduce to this)
```
rows = db.mjs list-actions status ready
for each row:
   if the verb is a real (non-draft) send → run it past the validator; if RETURN, skip + log.
   do exactly `description` via `tool`   (create_draft | send_email | label | comment | book | …)
   trace_ref = the resulting artifact ref (draft id, sent message id, Linear comment url, …)
   db.mjs set-action-status <row.id> executed <trace_ref>
```
- **Trace on the signal.** The executed action's proof lives where the work happened — the created draft,
  the sent reply in-thread, the Linear comment. Capture its ref in `trace_ref`. *(The trace IS the natural
  notification — nothing extra is pushed for it.)*
- **Robustness:** if a tool is unreachable or the call fails, **leave the row `ready`** (do not mark
  executed) and log it — the next run retries. Never lose a row; never double-run one.

## Two triggers
- **(a) End of an act-and-decide run** *(Phase 3)* — the planner invokes you to flush the `ready` rows it
  just queued (immediate acts: drafts in draft mode).
- **(b) Decision finalize** *(the closing loop — Phase 4)* — when a posted decision is settled, the closing
  loop **materializes the chosen option's action as a `ready` row** (per gated task — via act-and-decide's
  recompute, faithful to what the option promised; pending options were never stored, they lived in Jupi).
  You run those `ready` rows (same core). The loop then reopens the `blocked` task (`→ open`) for
  re-disposition, sets Jupi `EXECUTED`, and sends the one optional `executedPing`. *Phase 3 builds trigger
  (a); trigger (b) is Phase 4 (blocked on the Jupi FINALIZED read + EXECUTED-write).*

## Where you write
- **The user's tools** (drafts / sends / comments / bookings) — you are the only skill that does.
- **Neon `actions.status`** (`ready → executed`) + `trace_ref`, via `db.mjs set-action-status`.
- **Never** `tasks.status`, Jupi decisions, Supermemory, or `context`.

## Narrate + return
Narrate per row (✅ executed / ⚠️ left ready + why). Return a short summary: rows executed (with their
traces), any left `ready` (unreachable/failed), and the mode you ran in.
