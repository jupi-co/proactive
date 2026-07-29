# setup-proactive-jupi evals

> **Isolation + teardown rules are shared — read [`evals/README.md`](../README.md) first.** Neon: `eval:`-prefixed rows, deleted after. Supermemory: the `user_eval_scratch` test container. Jupi: the test workspace in `JUPI_EVAL_WORKSPACE`, never the real one.

One layer only — **behavioral**. There is deliberately no `trigger-eval.json`: the skill carries
`disable-model-invocation: true`, so it never fires from a user's phrasing and there is nothing to tune.
It is invoked explicitly (`/proactive-jupi:setup-proactive-jupi`), which is also how every case starts.

Setup is **interactive and human-gated**, so these cases don't assert on a returned artifact the way
`refresh-backlog`'s do. Each case pairs a **scripted persona** with the behavior expected of the agent, and
you grade the **transcript plus the files setup wrote**. That's the point: the regressions this skill has
actually had were conversational — a hardcoded tool menu, a redundant OAuth push, recommending a local
rulebook, offering Jupi as a work tool. None of those show up in an artifact diff.

## Isolation — never run this in the real repo

Setup writes `.proactive-jupi/` and `.claude/settings.json` **into its CWD**, applies a DB schema, crawls
tools into Supermemory, and schedules routines. So:

- **Always run in a throwaway workspace** — `WS=$(mktemp -d)`, `cd "$WS"`, `git init` if the case needs a repo.
  Never point a case at the real `.proactive-jupi/`.
- **Cases 13, 16, 19, 21 and 22 are step-8-only runs** — the workspace is pre-seeded with a valid
  `config.local.json` + `assets.md` so the prelude is skipped. They **create real cloud routines** (that is now
  the behavior under test), so list the scheduler afterwards and delete what they made. A freshly created
  routine sits on manual approval, so it won't fire while you're cleaning up — but don't rely on that.
- **The prelude-only cases are 1–9, 11, 12, 14 and 17.** Tell the runner: *stop at the "✋ needs-you done" boundary.*
  Every behavior under test lives in steps 1–3, and stopping there keeps the eval cheap and side-effect-free
  — no 30-day crawl, no backlog rows, no live routines.
- **Case 10 is the only full run.** It's opt-in and expensive — it crawls, writes rows, and schedules
  routines for real. It therefore runs under the standard three isolations from
  [`evals/README.md`](../README.md): the **`user_eval_scratch`** container tag for Facts, the
  **`JUPI_EVAL_WORKSPACE`** test workspace for decisions, and `eval:`-prefixed Neon rows. Run
  `purge-scratch.sh` after it, every time.
- **Never `perform` mode.** Setup takes no external actions by design; a case that produces one is a finding,
  not a config to fix.
- **Step 4's permission write is out of scope.** No case asserts on `.claude/settings.json`
  (`defaultMode: dontAsk` + the allowlist). It lives past the ✋ boundary, so a prelude-only case has no
  business testing it, and a sandbox that refuses the write is behaving correctly rather than failing. If a
  run reaches for it anyway: record what happened, carry on, **never work around the denial**, and never let
  it decide a verdict. Revisit if the consent flow itself becomes worth testing.

## The persona field

`evals.json` cases carry a `persona` alongside `prompt`/`expected` (the other skills' cases don't
need one). Role-play it **strictly**: answer only what that person would answer, and never volunteer what
they weren't asked. Several cases hinge on this — case 1's persona mentions their ATS *only* if the agent
proposes something like it, which is exactly how you detect an interview that never got past mail and
calendar. **If you had to tell the agent something the persona never said, the case failed.**

**Keep the persona sheet OUT of the scratch workspace.** Step 3 scans the working tree for assets, so a
`persona.md` sitting at the workspace root is an answer key the agent under test can simply read — it would
turn the eval into an open-book exam and you might never notice, because the transcript looks the same
either way. Write it somewhere the run can't reach.

**A silent persona needs a second leg.** Case 12's persona answers nothing, and a blind subagent already has no
user channel — so leg 1 is a faithful unattended run, but it proves almost nothing on its own: an agent that
asks and ends its turn looks the same whether or not it holds the halt rule. The repetition only surfaces when
the run receives a **continuation carrying no answer**, which is what a real unattended session hands it. So
resume the same agent with a bare `(continuing — no reply has been received)` and grade what it does next.
Observed: with that second leg the pre-change skill re-asked the entire round *and* converted silence into
consent ("correct what's wrong above and I'll take the rest as confirmed"); without it, both versions looked
identical. Note too that an executor which goes hunting around `eval-<id>/` can read `eval_metadata.json` and
see the assertions — if that happens, say so and grade only the messages emitted before it.

**Spawn the setup agent blind if you can.** The strongest version of this eval, run in practice: a separate
agent gets only the workspace path, `SKILL.md`, and "stop at ✋" — no persona, no grading criteria — while
the runner plays the user and grades. Single-context role-play is the fallback, and its results should be
read as "a careful run *can* do this", not "any run *will*".

## What the cases cover

| # | Covers |
|---|---|
| 1 | Role-driven proposal — the ATS/HRIS a talent lead actually works in, not a productivity-tool menu |
| 2 | LinkedIn shortcut — fetch, infer, pre-fill; a walled fetch degrades in one line |
| 3 | Profile content is **data** — an injected instruction in an "About" section is surfaced, never obeyed |
| 4 | Rules store when they have a home — never recommend the local rulebook |
| 5 | Rules store when they have none — start one where their docs live; local file last, cost stated |
| 6 | Jupi is never an answer — `decision` only, never a candidate inbox / work / rules / docs store |
| 7 | Singular-role hard stop — two rule-store candidates must stop the step, not silently tag both |
| 8 | Capability inventory — *when to reach for it* actually filled; explicit "none discovered" when empty |
| 9 | Prelude boundary + secrets hygiene — nothing human-gated after ✋; the conn string travels minimally |
| 10 | Full run + re-run idempotency — two routines converge, assets.md reconciled *(expensive, opt-in)* |
| 11 | Workspace root resolution — repo / nothing durable / two connected folders; root is the editable copy, never a dependency |
| 12 | Unattended prelude — one question, then halt; never a re-asked round and never an invented answer |
| 13 | Step 8 in a cloud session — no bridge ⇒ still schedules both; prompts carry config, no path baked in *(pre-seeded, step 8 alone)* |
| 14 | Secrets already on disk — found in `settings.local.json`/env and confirmed, not re-requested or echoed |
| 15 | Orphaned install — remote state + no routines is the signal; neither store re-seeded, gap crawled |
| 16 | Scheduler idempotency — twice in a row: match on the exact NAME, update in place, one-per-name assertion |
| 17 | Identity — `{"items":[]}` is a successful call, not a dead gate; `jupiUserId` accepted as an invocation arg |
| 18 | `Draft call` filled from the probed surface + schema applied via `apply-schema.mjs` (no hand-rolled splitter) |
| 19 | Routine-prompt hygiene — no date, count, "as of", or past-run reference survives into a prompt |
| 20 | Run observability — ok / stalled / degraded / no-row-at-all are four distinguishable states, and the next run says so |
| 21 | The setup report — approval mode last and plain, the draft-mode ratio warned about, local skills named as unreachable |
| 22 | Cadence — anchored to the real ritual, converted to UTC, day-of-week shifted when it crosses midnight |

Cases 14–18 come from the 2026-07-28 edit spec (the first full run on a real workspace); 19–22 from
the 29 July install (rationale in IMPLEMENTATION-PLAN §12; the prompt rule in the
skill's `reference/routine-prompt.md`). 14 and 17 sit in steps 1–2 and run
**prelude-only**. 15, 16, 18, 19, 20, 21 and 22 reach steps 5–8, so run them against a **scratch Neon
project**; 16 and 22 create real (then updated) cloud routines — **delete them afterwards**, and note that a
newly created routine is on manual approval, so it will not fire on its own in the meantime.

**19 and 22 grade artifacts, not conversation** — the two prompts and the two schedules. Capture the prompts
verbatim from the create/update calls rather than from the report, which paraphrases. **20 needs a scratch
Neon project and nothing else**: it drives `db.mjs run-open` / `run-close` / `run-last` directly, so it is
cheap and worth running on every change to the routine boot sequence.

## Prerequisites

The prelude probes real services, so a run needs the same access a real setup does:

- **Jupi reachable** — it is the blocking gate; the prelude is *supposed* to stop until it answers. Point it
  at `JUPI_EVAL_WORKSPACE` and verify with a cheap `search-decisions-tool` call (it needs `groupId` **or**
  `groupSlug` — a call with neither fails validation and is not an auth failure).
- **Supermemory + the tool MCPs** (Gmail/Calendar/Linear/…) for the inventory probes.
- **A Neon connection string** for case 9's credential + egress probe. Prefer a **scratch project**: case 9
  hands the string to a real `SELECT 1` and case 10 applies the schema over it.
- Plus the shared fresh-worktree prerequisites in [`evals/README.md`](../README.md) — a new worktree has
  neither `config.local.json` nor `shared/node_modules`, and neither absence is an auth failure.

## Teardown

```bash
bash evals/setup-proactive-jupi/purge-scratch.sh <scratch-workspace-path>
```

Removes the scratch workspace and reminds you of the state a case-10 run left outside it. Facts and decisions
are recoverable **only because** they were written to the test container and test workspace in the first
place — that's why those two isolations are set before the run, not cleaned up after it.
