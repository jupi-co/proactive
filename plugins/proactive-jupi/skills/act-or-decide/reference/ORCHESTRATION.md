# act-or-decide — ORCHESTRATION (producer ↔ validator loop)

How a DECIDE draft clears the gate before it reaches the user, **autonomously in a routine**. This is the
chaining contract for the runner. The producer is `SKILL.md`; the validator is `reference/VALIDATOR.md`.

> All data paths are **workspace-relative** (the CWD where the run executes), never plugin-relative.

---

## The loop

```
1. PRODUCER (SKILL.md) ────► decision draft (Stages 3–4: researched, actions materialized)
1b. PLAIN-LANGUAGE PASS ───► re-read every user-facing word; rewrite plain & non-cryptic, before the gate
2. VALIDATOR (reference/VALIDATOR.md) reads the draft + OPENS THE REAL SOURCES
      ├─ PASS            ──► POST it in Jupi (create-decision-tool, private, STARTED) + set-task-gating the task(s)
      └─ RETURN (flags)  ──► back to the PRODUCER with the flags
3. PRODUCER resumes: opens the sources, verifies, fixes, resubmits.
4. Loop back (return to step 2).

   Max 3 iterations. If still RETURN on the 3rd round ──► DELIVER NOTHING for this item (the run proceeds).
```

**"Deliver nothing"** — if the gate is never cleared, **no decision is posted**. We prefer to deliver
nothing over a dubious deliverable. `validation.md` keeps the trace of persistent flags for debugging.

## Also gated: a real send (perform mode)
Before `execute-actions` fires a **real (non-draft) verb**, the same validator vets that action — a real
external send is at least as consequential as a posted decision. Draft-mode ACTs and `--dry-run` need no
gate (no external effect), keeping the default path fast. *(This branch is exercised only when `mode:perform`
is enabled; the closing-loop execution of settled decisions lands in Phase 4.)*

## Files of a run

```
act-or-decide/runs/run-<id>/
├── report.md       ← the deliverable — the dry-run table, or the posted decision(s) + acted rows
├── validation.md   ← history of the validator's passes (flags, verdicts, iteration #)
└── log.md          ← the producer's narrative
```

**Harness note:** a sub-agent cannot write a report/findings file (it returns text). So the **orchestrator**
(main session / runner) persists `report.md` and `validation.md` from the texts the producer and validator
return.

## Autonomy
No human in the loop during the run: the only exit door to the user is a **PASS** (a posted decision) or a
queued `ready` row (an act). Everything else is dropped and logged.
