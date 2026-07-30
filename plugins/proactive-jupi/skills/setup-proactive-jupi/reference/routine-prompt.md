# The routine prompt — template + the rule that governs it

Read this in step 8, before creating or updating either scheduled routine.

## The rule

**The prompt carries what setup owns. A store holds only what a run writes.**

A scheduled routine runs on a container with no repo, no workspace folder and no
device bridge. Everything it needs, it brings. So the prompt carries the config — and
because a prompt is written once and read forever, it may carry **only things that stay
true indefinitely**.

Test every line before you write it: *would this still be true in six months if nobody
edited it?* Budgets, roles, store refs and thresholds pass — they change only when setup
runs again, which is exactly when the prompt gets rewritten. Dates, counts, "currently",
"the brain has existed since…", last run's numbers, one specific corrupt record: none of
them pass, and they fail **silently** — a routine repeating a stale caveat reads exactly
like one reasoning correctly. Anything of that character is read from a store at run time.

The one exception is an operational caveat that genuinely has to be carried (a known-bad
record in the brain, a connector quirk). Write it with an **explicit expiry date** so a
routine reading it afterwards reports it as stale rather than repeating it. A caveat that
cannot expire does not belong in a prompt at all.

## Boot: materialize, don't hunt

The first thing a routine does is write the config it carries to
`./.proactive-jupi/config.local.json` in its own working directory. That file is
**scratch, derived from the prompt, gone with the container** — it is not state, and
nothing durable may ever be read from or written to it. What it buys is that every skill
downstream resolves config exactly as it does on a laptop (`db.mjs` walks up from cwd),
so nothing in the pipeline needs a cloud-specific read path.

Write `assets.md` next to it the same way, from the `Roles` and `Skills` blocks.

## The template

Fill every `<…>`. Keep the whole thing under ~60 lines: each `list` and `create` call
echoes the full prompt back, and prompt size is the one part of that payload we control.

```
Run Proactive-Jupi's <act-and-decide | refresh-brain> routine. You are running
unattended — nobody is watching, so never wait for input: if something is missing,
close the run record saying so and stop.

## Config (carried — write it to ./.proactive-jupi/config.local.json before anything else)
{
  "jupiWorkspace": "<slug>",
  "jupiUserId": "<id>",
  "neonConnString": "<conn>",
  "rulesStoreRef": "<id/path that opens the rules store>",
  "crawlWindowDays": <n>, "backlogWindowSize": <n>, "ruleThreshold": <n>,
  "frontierMaxPending": <n>,
  "scoring": <the scoring block, verbatim from config.local.json>,
  "guardrails": <the guardrails block, verbatim from config.local.json>
}

## Asset map (carried — write it to ./.proactive-jupi/assets.md before anything else)
<the finished assets.md: Who this is · Tools/roles/draft-call · Agents-skills with
 their Reachable column · an empty Business rules index pointing at the rules store>

## Run
1. Write both files above. Then open a run record:
   node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" run-open <act-and-decide|refresh-brain>
   If that command cannot run — the plugin isn't installed on this runner, or Neon is
   unreachable after its retries — stop and say so plainly in your output. You have no
   run record to write to, so the output is the only place the failure can land.
2. Read the previous run:
   node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" run-last <routine> 1
   If it failed, degraded, or is still 'running' (stalled), open your report by saying
   so. A run that follows a bad run and doesn't mention it is how a persistent breakage
   goes unnoticed for a week.
3. <act-and-decide: run act-post-decision, then act-or-decide>
   <refresh-brain:   run update-brain in full mode>
4. Close the run record with what actually happened:
   run-close <id> ok
   run-close <id> degraded '[{"what":"Slack","cost":"couldn'\''t see mentions"}]'
   run-close <id> failed - "<one line: what stopped it>"
   Degraded means it ran and lost something — name the loss in the user's terms, not as
   a missing integration. Never close 'ok' over a tool that didn't answer.
```

## Naming, and why it is load-bearing

The scheduling API assigns its own id and gives you no stable key of your own, so the
**exact name is the only thing a re-run can match on**. Use these two, unchanged:

- `Proactive-Jupi — act & decide`
- `Proactive-Jupi — refresh brain`

No cadence, day or version in the name (`…-daily`, `…-v2`). A cadence-suffixed name is
what made a re-run create a *second* "refresh the brain" card at the same slot instead of
updating the first — the reconcile matched nothing, so it created.

## Rotation

`neonConnString` is the one secret in a prompt and the one rotation point. Rotating it
means **re-running setup**, which updates both routines in place. It is never a hand-edit
of two task definitions, and the string must not be pasted anywhere else.
