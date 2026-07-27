# setup-proactive-jupi evals

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
- **Cases 1–9 run the attended prelude only.** Tell the runner: *stop at the "✋ needs-you done" boundary.*
  Every behavior under test lives in steps 1–3, and stopping there keeps the eval cheap and side-effect-free
  — no 30-day crawl, no backlog rows, no live routines.
- **Case 10 is the only full run.** It's opt-in and expensive (real crawl → real Supermemory facts, real Neon
  rows, real scheduled routines). Run `purge-scratch.sh` after it, every time.
- **Never `perform` mode.** Setup takes no external actions by design; a case that produces one is a finding,
  not a config to fix.

## The persona field

`behavioral-tasks.json` cases carry a `persona` alongside `prompt`/`expected` (the other skills' cases don't
need one). Role-play it **strictly**: answer only what that person would answer, and never volunteer what
they weren't asked. Several cases hinge on this — case 1's persona mentions their ATS *only* if the agent
proposes something like it, which is exactly how you detect an interview that never got past mail and
calendar. **If you had to tell the agent something the persona never said, the case failed.**

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

## Prerequisites

The prelude probes real services, so a run needs the same access a real setup does:

- **Jupi reachable** — it is the blocking gate; the prelude is *supposed* to stop until it answers. Verify
  with a cheap `search-decisions-tool` call (it needs `groupId` **or** `groupSlug` — a call with neither
  fails validation and is not an auth failure).
- **Supermemory + the tool MCPs** (Gmail/Calendar/Linear/…) for the inventory probes.
- **A Neon connection string** for case 9's credential + egress probe. Use a **scratch project**, not the
  real one, if you don't want an eval applying a schema to it.
- **In a fresh git worktree, `config.local.json` does not exist** — it's gitignored, so it never comes along
  with a new worktree, and `db.mjs` will fail to resolve credentials until you copy one in (or export
  `NEON_CONN_STRING` + `JUPI_USER_ID`). Same for `plugins/proactive-jupi/shared/node_modules`:
  `npm install --prefix plugins/proactive-jupi/shared`. Neither is an authorization problem — worth knowing
  before you conclude a service is down.

## Teardown

```bash
bash evals/setup-proactive-jupi/purge-scratch.sh <scratch-workspace-path>
```

Removes the scratch workspace and deletes the two eval-run scheduled routines. It **cannot** un-write
Supermemory facts a case-10 crawl created — see `evals/update-brain/README.md` for that scratch convention,
and prefer a scratch container tag if you run case 10 often.
