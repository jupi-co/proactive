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
Before `execute-action` fires a **real (non-draft) verb**, the same validator vets that action — a real
external send is at least as consequential as a posted decision. Draft-mode ACTs and `--dry-run` need no
gate (no external effect), keeping the default path fast. *(This branch is exercised only when `mode:perform`
is enabled; the closing-loop execution of settled decisions lands in Phase 4.)*

## What a run produces

Three texts, all **returned, never written to disk**:

- **report** — the deliverable: the dry-run table, or the posted decision(s) + acted rows
- **validation** — the validator's passes (flags, verdicts, iteration #)
- **narrative** — the producer's log

**Why not files.** A sub-agent can't write one anyway (it returns text), and the orchestrator shouldn't
either: under a scheduled routine there is no workspace folder, and anything written to the run's own
container is discarded with it. The orchestrator assembles the texts the producer and validator return and
hands them up — the routine's run record (`db.mjs run-open`/`run-close`) is what persists, and the durable
substance is already in Neon and Jupi.

## Autonomy
No human in the loop during the run: the only exit door to the user is a **PASS** (a posted decision) or a
queued `ready` row (an act). Everything else is dropped and logged.
