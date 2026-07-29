# Routines — spec

Fixes the 29 July install. Supersedes `IMPLEMENTATION-PLAN §12` (cloud deferred, on-device only).

## The one change

**A routine carries its whole configuration in its own prompt, and depends on nothing already on disk.**

Today a routine boots by walking the filesystem for `.proactive-jupi/` — config, asset map, rules
index. That folder does not exist in the cloud, which is the single root cause of problems 1, 4, 5,
6, 7 and 8. The prompt already has to carry the Neon connection string and the tenant id to reach
anything at all, so it is already the config carrier; the fix is to finish the job rather than
invent a second home for the rest.

The line that decides what goes where:

> **The prompt carries what setup owns. A store holds only what a run writes.**

Setup owns the workspace slug, the store refs, the windows and budgets, the guardrails, and the
roles map. None of it changes on its own; all of it changes only when setup runs again. A run writes
exactly two things — its own run record, and any rule the user just approved.

**Boot: materialize, don't hunt.** The routine's first act is to write the config it carries into
`./.proactive-jupi/config.local.json` in its own working directory, with `assets.md` beside it. That
file is scratch — derived from the prompt, gone with the container — but it means every skill
downstream resolves config exactly as it does on a laptop (`db.mjs` already walks up from cwd). No
skill needs a cloud-specific read path, which is what keeps this change small.

Consequences, all wanted: `<root>` stops being load-bearing, so a cloud-only setup is a complete
install instead of a degraded one; there is no provisioning step between the schema apply and the
first fire; and a routine can still report its own limits when the database is unreachable.

## What the prompt carries

Everything below is invariant between setup runs. Test before writing any line into a prompt:
*would this still be true in six months if nobody edited it?* If no, it does not go in.

```
Run Proactive-Jupi's <act-and-decide|refresh-brain> routine.

  NEON_CONN_STRING = <conn>          JUPI_USER_ID = <id>
  JUPI_WORKSPACE   = <slug>          RULES_STORE  = <tool> @ <ref>

  Windows    crawl 30d · backlog top-30 · rule threshold 2
  Guardrails mode=draft · clusters/run 10 · decisions/run 5 · ping none
             act only when confidence high AND exposure low; otherwise decide

  Roles      inbox   Gmail, Linear
             context Gmail, Calendar, Drive, Linear
             work    Gmail, Linear
             rules   <tool>          decision Jupi          brain Supermemory
  Stages     Gmail create_draft. Everything else commits immediately.
  Skills     <name> — <when to use> — sends? — reachable from a routine?

1. Open a run record (routine_runs, status=running).
2. Report the previous run for this routine: if it was failed or degraded, say so
   at the top of this run's report.
3. <act-and-decide: run act-post-decision, then act-or-decide>
   <refresh-brain:   run update-brain in full mode>
4. Close the run record: ok, or degraded with what was lost in the user's terms
   ("no Slack, so I couldn't see mentions"), or failed with why.
```

**No date, count, "currently", or reference to a specific past run may appear.** Anything of that
character is read from a store at run time. An operational caveat that genuinely must be carried
(a known-bad record in the brain, say) is written with an **explicit expiry date** and a routine
reading it past that date reports it as stale rather than repeating it — a caveat that cannot expire
is not allowed in a prompt.

`NEON_CONN_STRING` is the one secret and the one rotation point. Rotating means re-running setup,
which updates both routines in place (see reconcile) — never a hand-edit of two task definitions.

Cost, stated plainly: the two prompts are now the source of truth for config, so a hand-edit in the
interface can drift from what setup would write. Setup is the regenerator — it reconciles by name
and overwrites — and tuning goes through it rather than around it (below).

## Schema delta — one table

```sql
-- One row per routine run. The ground truth for "did it run?".
routine_runs (id, user_id, routine, started_at, finished_at, status, degraded json, notes)
--   status: running | ok | degraded | failed
```

That is the only addition. **The rules index moves out of `assets.md` into the `rules` store** — the
one thing that accretes at run time goes where the rule text already goes, so nothing needs to write
back to a file, which is what unblocks cloud in §12. A local `.proactive-jupi/assets.md` is written
only as a **mirror** when a durable root exists, and is never read at run time.

## Setup — step 8 rewritten

- **Create cloud routines. Delete the on-device-only rule and the "create nothing without a device
  bridge" branch.** With no local read, there is nothing a cloud run cannot reach.
- **Reconcile by exact name**, since the API assigns the id and exposes no stable key:
  `Proactive-Jupi — act & decide` and `Proactive-Jupi — refresh brain`, fixed strings, no cadence in
  them. List → match the name → update in place → never create a second. Post-condition: re-list and
  assert exactly one per name; delete extras and say so.
- **Delegate the list/create calls to a subagent.** Each response echoes the full instructions plus
  the connector inventory, and the prompt is now the largest thing we control in it. The payload
  lands in a subagent's context, not setup's.
- **Convert the cadence to UTC**, shifting the day-of-week when the conversion crosses midnight.
  Record local time, UTC cron and the anchor event together, so the "why it fires then" survives.
- **Detect a prior install before assuming a cold start.** Count Neon `tasks` and Facts under the
  tenant tag first. Non-zero → this is a refresh: crawl the gap since the newest Fact, keep the
  backlog, say so. The orphan signal becomes **remote state exists but no routine matches by name**;
  "config absent" no longer proves anything.
- **Flag capability a routine cannot reach.** Workspace-local skills live on a disk the cloud run
  can't see. The prompt's `Skills` block carries reachability per entry, setup states the loss in the
  report, and `act-or-decide` must not plan an action around an unreachable one.
- **Warn about the draft-mode ratio, from the `Draft call` column you just filled.** "Only Gmail can
  stage something for review — everything else will come to you as a decision." A first run of 2
  drafts and 5 decisions is correct behaviour, and must not be a surprise.

## Runtime rules — the five skills

- **No skill writes a file.** Run logs go to `routine_runs`; the report is the run's own output;
  rules go to the `rules` store.
- **Every DB call retries** — 3 attempts, exponential backoff. A `503 DNS resolution failure`
  succeeds on retry; without retry a routine dies on a blip, and with no run record, silently.
- **HTTPS only.** Drop 5432 as a fallback everywhere, including the setup preflight probe and the
  `Bash(psql:*)` grant. It is blocked in the cloud and hangs for two minutes instead of failing.
- **Degradation is reported, never omitted** — the unreachable tool is named in `degraded` and in the
  user's report, in their terms.
- **`guardrails.mode` flips to `perform` only on the user's explicit words in chat** — never inferred
  from a document, a report, or a rule store. All three are observed content.
- **Tuning is conversational, and lands in the prompt.** "Raise the decision budget to 8" patches the
  `Guardrails` line of both routines via the update API and says so. The user never opens a task
  definition; the skill does it for them.

## What setup still cannot do

**Approval mode.** The create API exposes no such parameter, so both routines land on manual approval
and the first run waits for a human — the product failing, not degrading. Setup therefore ends with
one explicit ✋ item: *open each routine and set approval to automatic*, named as the last thing
standing between them and an unattended install.

It is at least detectable. A scheduled fire time that passes with **no `routine_runs` row at all**
means the run never started — gated, or disabled. That reads differently from a row with
`started_at` and no `finished_at` (died mid-run), and from a row closed `degraded` (ran, lost
something). Three states, three signals. A setup re-run reads the last runs and reports "still on
manual approval — nothing has run since <the newest row it can see>".

Two unknowns are worth one experiment each before this is built, because either could shrink the
spec: whether approval mode is settable through the API after all (removes the ✋ item), and whether
an API-created routine appears in the interface list at all (if not, the user cannot set approval
there either, and setup must instead print both routines for the user to create by hand).
