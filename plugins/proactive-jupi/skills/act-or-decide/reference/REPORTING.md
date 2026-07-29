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
| `n/a (perform mode)` | `mode` is perform — nothing below applies |
| `n/a (authorised: <what>)` | executes regardless of mode — `rule BR-004`, `settled decision` |
| `n/a (swept: queued <verb> <date>)` | an orphan from an earlier run; it keeps the verb it was queued with |
| the call, e.g. `gmail create_draft` | drafted — this call is the ACT's verb |
| `none → emitted as decision` | no draft call, so the action was emitted as a decision instead. **This is the conversion** |
| `n/a (nothing at stake)` | no draft call and nothing exposed — acts with its real verb |
| `not reached` | the gate returned `decide` on its own (low confidence, or high × high), so emission never got this far |

**Read the table top-down and take the first row that applies** — several can be true at once (a swept
orphan in a perform run, a rule-covered action that also exposes nothing), and without an order two runs
render the same action differently, which is what this column exists to prevent. `none → emitted as decision`
is the one a reader scans for: it's what draft mode actually *cost*.

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

**4 · Deferred** — everything in the window that didn't get worked, with its leverage and the reason. **Not
optional; "nothing deferred" is written out rather than left as an absent table.** Your own guardrails say no
silent caps, and a budget that trimmed six items reads exactly like a quiet morning otherwise.

| Item (cluster / decision) | Leverage | Cut by | Why this one |
|---|---|---|---|

**`Cut by` takes a budget name — or `do-nothing rule <id>`.** A cluster dropped because a do-nothing rule
covered it (§Negative memory) belongs in this block for the same reason a budget cut does, and arguably more:
that rule's entire job is to stop showing the user this class of work, so the run where it fires is the one
chance they get to notice it fires on the wrong thing. Give the rule id, so a mis-scoped rule can be found and
amended rather than merely resented.

**Leverage, not raw score** — the same measure Stage 2 ranked by (value unblocked across tasks per decision
raised), because that's what the cut was actually made on; a column of task scores would suggest a different
ordering than the one you applied. For a multi-task cluster, give the cluster's leverage and name its tasks.
**If an item is deferred a second consecutive run, say so** — repeated deferral is how a low-leverage item
starves silently while every report truthfully promises it comes back tomorrow.

**Failed actions belong in block 2**, marked as such with the worker's error. A row that came back
`ok:false` stays `ready` and retries next run, but an all-failed run renders exactly like a quiet one
otherwise — the same argument block 4 makes for budgets.

**Footer, two lines.** First the active `mode`, `policy`, `clusterBudget`, `decisionBudget`. Then **what this
run is leaving for the next one**: frontier items to push (count + what kind), voice profiles observed, and
any do-nothing rule proposed. One line, and it is not decoration — this is the only visible evidence that an
expensive run of searching produced anything durable, and the failure it guards against is a skill that
quietly stops compounding while every report still looks healthy.

Written in the *future* tense because it is: the report ships before Stage 6 writes any of it, so that
bookkeeping never delays the work the reader is waiting for. Stage 6 then confirms — or says what didn't
land — in one closing line after the report. In `--dry-run` nothing is written at all; say what *would* have
been pushed and saved.

**Return the whole report — it is the output, not a file.** A scheduled run has no workspace folder to write into and nobody reading a file
left in a discarded container; a local run's reader is already in the conversation. (A dry run returns the
report alone — there are no validator passes to record, since it authors no decisions.)

### The user's version of this report — yours to define, wherever it's shown

The blocks above are the **run log**, for a skill or a routine. The same run also has to be reportable **to
the user** — after a scheduled run, when they ask what you did, and at the end of setup's first dry run,
which is the first thing they ever see Jupi produce. **That version is yours, not the caller's**; setup shows
it, it doesn't get to invent it, or every surface would describe your work differently.

They've never heard of a cluster or an exposure score. But vague isn't plain — *"what I'd do"* is as useless
as *"exposure"*, because it still doesn't say what the thing **is**. **Name the artifact.** Same four blocks:

1. **What I handled on my own** — what it was, **what they'll find** ("a reply drafted in Gmail, ready to
   send"), why it didn't need them. Empty is worth saying out loud, in one line.
   - **In `--dry-run`, put ALL FOUR headings in the conditional** — *"What I'd handle on my own"*,
     *"Decisions I'd put to you"*, *"What I'd leave for next time"*. Nothing has been handled or submitted yet, and setup's first dry run is where this report is
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
(loosening the policy) isn't the one that helps. **Separate the two kinds, or you understate your own
judgement**: some questions exist only because the tool can't prepare anything, others because the call is
genuinely theirs. *"Two of these are questions only because Linear and the calendar can't prepare something
for you to look at first. The other two I'd want you to decide either way — one commits money we can't get
back."*

Close on posture, not config: *"I'm in draft mode, so nothing goes out without you sending it."*

**Two rules decide whether this lands.** Numbers only where the number changes what they'd do — "6 left for
next time" earns its place, a score of 62.1 doesn't. And **never show a person a shorter report than you
logged**: block 4 is the one they most need and would never think to ask for.

