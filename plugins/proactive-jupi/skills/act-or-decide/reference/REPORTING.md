# Reporting — the run report

The full spec for the four blocks `act-or-decide` reports every run. Two audiences: the **run log**
(everything up to the footer) and **the user's version** (last section) — same four blocks, same content,
different words. The shape is fixed here rather than left to judgement because on the reference run these
tables existed only because a human asked for them afterwards.

**1 · Clusters** — first, or the coordination node is invisible: three rows sharing a decision title read
identically whether one decision gates three tasks or three duplicates were raised.

| Cluster | Tasks | Shared open question | conf |
|---|---|---|---|

**2 · Actions** — one row per candidate action, grouped by task. **Draft-mode effect** takes one of the values
below and no other — a *converted* action must be distinguishable from one that was always a decision:

| Value | When |
|---|---|
| the call, e.g. `gmail create_draft` | passed both questions — this call is the ACT's verb |
| `none → DECIDE` | no call passed, so the gate's `act` was overridden. **A conversion.** |
| `not reached` | the gate already returned `decide`, so the draft check never ran. **Not** a conversion — it'd be a decision in perform mode too. |
| `n/a (perform mode)` | `mode` is perform |
| `n/a (exempt: <reason>)` | one of the four exemptions above — `rule BR-004`, `settled decision`, `nothing at stake` |
| `n/a (skill: <name>)` | a `tool: skill` action — draftability was judged from what the skill does (Stage 4), not from a call |

`not reached` is the common case; getting it right is what lets a reader find what draft mode *cost* by
scanning for `none → DECIDE`.

| Task | conf (task) | Action | Tool | exposure | Verdict | Draft-mode effect | Why |
|---|---|---|---|---|---|---|---|

**3 · Decisions** — what now sits with a human, and what it's holding up. The **link** is the permalink from
§Decision links; a decision the user can't click through to is one they won't settle. **In `--dry-run` no
decision exists, so there is no id and no link** — write *"not created (dry run)"* rather than a fabricated
URL, and say once that links appear on a real run. This is the founder's first report, so a dead link there
is worse than an honest blank.

| Title | Link | Assignee | Tasks unblocked | Why it needs a human |
|---|---|---|---|---|

**4 · Deferred** — everything cut by `clusterBudget` or `decisionBudget`, with its leverage and the reason. **Not
optional; "nothing deferred" is written out rather than left as an absent table.** Your own guardrails say no
silent caps, and a budget that trimmed six items reads exactly like a quiet morning otherwise.

| Item (cluster / decision) | Leverage | Cut by | Why this one |
|---|---|---|---|

**Leverage, not raw score** — the same measure Stage 2 ranked by (value unblocked across tasks per decision
raised), because that's what the cut was actually made on; a column of task scores would suggest a different
ordering than the one you applied. For a multi-task cluster, give the cluster's leverage and name its tasks.
**If an item is deferred a second consecutive run, say so** — repeated deferral is how a low-leverage item
starves silently while every report truthfully promises it comes back tomorrow.

**Failed actions belong in block 2**, marked as such with the worker's error. A row that came back
`ok:false` stays `ready` and retries next run, but an all-failed run renders exactly like a quiet one
otherwise — the same argument block 4 makes for budgets.

Footer: the active `mode`, `policy`, `clusterBudget`, `decisionBudget`. Write the whole report to
`act-or-decide/runs/run-<id>/report.md` and return it — a dry run writes `report.md` only (there are no
validator passes to record, since it authors no decisions).

### The user's version of this report — yours to define, wherever it's shown

The blocks above are the **run log**, for a skill or a routine. The same run also has to be reportable **to
the user** — after a scheduled run, when they ask what you did, and at the end of setup's first dry run,
which is the first thing they ever see Jupi produce. **That version is yours, not the caller's**; setup shows
it, it doesn't get to invent it, or every surface would describe your work differently.

They've never heard of a cluster or an exposure score. But vague isn't plain — *"what I'd do"* is as useless
as *"exposure"*, because it still doesn't say what the thing **is**. **Name the artifact.** Same four blocks:

1. **What I handled on my own** — what it was, **what they'll find** ("a reply drafted in Gmail, ready to
   send"), why it didn't need them. Empty is worth saying out loud, in one line.
   - **In `--dry-run`, put it in the conditional** — *"What I'd handle on my own"*, *"Decisions I'd put to
     you"*. Nothing has been handled or submitted yet, and setup's first dry run is where this report is
     most often read: past tense there has Jupi taking credit for work it hasn't done, which is the worst
     possible first impression to give someone deciding whether to trust it.
2. **Decisions I've submitted that need your input** — the title as it reads in Jupi, **a link they can
   click**, what it's holding up ("this also unblocks 2 other things"), why it's theirs to call. This is the
   block they act on: near the top, never compressed to a count.
3. **Where one answer covers several things** — only when you actually grouped something. Skip it rather
   than print a table of one.
4. **What I've left for next time** — and **say if a limit is why** ("I stop at 5 decisions a run, and 6
   more qualified today"), which is how they learn a setting is too low.

**Say why so much is a question, when it is.** In draft mode most items become questions because the tool
has no draft — Linear posts a comment the moment you call it — not because the work was risky or Jupi was
unsure. Left unexplained, a report that's mostly questions reads as timid, and the fix they'll reach for
(loosening the policy) isn't the one that helps. One line: *"Three of these are questions only because
Linear and the calendar can't prepare something for you to look at first."*

Close on posture, not config: *"I'm in draft mode, so nothing goes out without you sending it."*

**Two rules decide whether this lands.** Numbers only where the number changes what they'd do — "6 left for
next time" earns its place, a score of 62.1 doesn't. And **never show a person a shorter report than you
logged**: block 4 is the one they most need and would never think to ask for.

