# Evals — the standing rules

Read this before running any eval in this directory. The per-skill READMEs cover *what* each set checks;
this covers *how a run works* and *how it isolates itself* — the same everywhere, and not to be reinvented
per skill.

## Layout + tooling — standard `skill-creator`

Each set follows `skill-creator`'s conventions so its scripts work unmodified:

```
evals/<skill>/
├── evals.json          # the cases: {id, prompt, expected_output, files, expectations[]}
├── trigger-eval.json   # [{query, should_trigger}] for the description loop
├── README.md           # what this set covers
├── purge-scratch.sh    # teardown
└── workspace/          # run artifacts (gitignored, regenerable)
    └── iteration-N/
        ├── eval-<id>/
        │   ├── eval_metadata.json
        │   ├── with_skill/run-1/{outputs/, grading.json, timing.json}
        │   └── without_skill/run-1/{outputs/, grading.json, timing.json}
        ├── benchmark.json + benchmark.md
        └── review.html
```

`expectations[]` is what the grader checks — one objectively verifiable statement each. `expected_output` is
the human-readable description of success. Sets live at the repo root rather than inside the skill
directories on purpose: `plugins/` is packaged into the shipped `.plugin`, and eval fixtures have no business
travelling to users.

**`evals/run-eval.sh` does the path bookkeeping** (skill-creator's scripts must run as modules from its own
session-scoped directory; set `SKILL_CREATOR_DIR` to override autodiscovery):

```bash
./evals/run-eval.sh layout    <skill> [iteration]   # scaffold the workspace + eval_metadata.json
./evals/run-eval.sh benchmark <skill> [iteration]   # grading.json -> benchmark.json + .md
./evals/run-eval.sh view      <skill> [iteration]   # static review.html (adds --previous-workspace if it exists)
./evals/run-eval.sh trigger   <skill>               # description-triggering loop (needs the `claude` CLI)
```

**The run itself is agent work, not a script.** Per iteration: `layout`, then spawn **one executor subagent
per case per configuration — `with_skill` and the baseline, in the same turn** so they finish together. The
baseline is what makes a pass rate mean anything: a case Claude passes unaided measures nothing about the
skill. **Pick the baseline that answers the question you're asking.** For a *new* skill it's `without_skill`
— no skill at all. For an *edit* to a skill that already works, no-skill measures the wrong gap: snapshot the
pre-change `SKILL.md` (`git show <base>:… > workspace/iteration-N/skill-snapshot/SKILL.md`) and run the
baseline against that, in a config dir named `old_skill/`. The aggregator discovers config names
dynamically, so nothing needs renaming — but note it sorts them alphabetically, which puts `old_skill`
first and therefore reports the delta as *baseline − new*. Read the two pass rates, not the sign.

**Keep the `run-N` level even with a single run.** `aggregate_benchmark` only recognises a config directory
that has a `run-*` child; a flat `with_skill/grading.json` is skipped without error and the whole benchmark
comes out `0% ± 0%`, which looks like total collapse and is really a missing directory. Capture each subagent's `total_tokens`/`duration_ms` into `timing.json` **as its notification
arrives** — that data isn't persisted anywhere else. Then grade each run into `grading.json`
(`expectations[]` entries with `text`/`passed`/`evidence` — the viewer depends on those exact field names),
`benchmark`, and `view`.

For interactive skills (`setup-proactive-jupi`) the executor also plays the scripted persona; see that set's
README for the protocol that keeps it honest.

Proactive-Jupi's evals touch three live stores, and each has its own isolation mechanism. **A run that
can't be undone in all three isn't isolated — it's a production write with good intentions.**

| Store | Isolation | Teardown |
|---|---|---|
| **Neon** (tasks, actions, cursors) | Same project, but the scratch workspace's config sets a **synthetic `jupiUserId`** (e.g. `eval-scratch-<skill>`), and fixture rows additionally carry a **`signal_ref` prefixed `eval:`** with cursors at `is_eval=true` | **Delete after.** `bash evals/<skill>/purge-scratch.sh` (pass `JUPI_USER_ID=<synthetic id>`) — deletes `eval:%` tasks (their `actions` cascade) and `is_eval` cursors. Run it after every behavioral eval, not at the end of the day |
| **Supermemory** (Facts) | A **dedicated test container tag — `user_eval_scratch`** — never the real `user_<jupiUserId>`. The skills never read this tag, so a stray eval Fact can't leak into a real run | `bash evals/update-brain/purge-scratch.sh` bulk-deletes the container via the HTTP API (the connector's `forget` is unreliable — see that README) |
| **Jupi** (decisions) | A **dedicated test workspace** — set `jupiWorkspace` to the eval slug **in the scratch workspace's own `config.local.json`**, because that is the only thing the skills read | Decisions are archived **in the test workspace**, where a leftover is harmless. Nothing needs deleting from the real one because nothing was written there |
| **The user's tools** (Gmail, Linear, Calendar…) | **Withhold the `work` role and set every `Draft call` to `none`** in the scratch `assets.md` (`evals/seed-scratch.mjs` does this). The connectors reachable in a session are the *real* ones — there is no test Gmail — so the only lever is to give `execute-action` nothing to write to. Reads stay on, so research and the gate are still exercised | **There is none — that is the point.** A draft in a real mailbox cannot be rolled back by a purge script, and the Gmail connector exposes no delete-draft call |

> **The tools row is newer than the other three, and it exists because of a specific failure.** On 2026-07-29
> a write-path `act-or-decide` eval created a **real Gmail draft addressed to a counterparty that existed only
> in a fixture** (`camille.roux@serena.vc`, invented for eval case 24). Nothing malfunctioned: the skill
> scored a draft as low-exposure and queued it, and `execute-action` did exactly its job. The isolation table
> simply had no row for tools, so a fixture's fictional recipient reached a live mailbox by construction.
> **A case that genuinely needs a real tool write does not belong in this directory** — assert on the queued
> `ready` row instead, which is the artifact `act-or-decide` is actually responsible for.

> **The `eval:` prefix makes rows *deletable*. Only a synthetic `jupiUserId` makes them *isolated*.** Nothing
> filters reads by prefix — `query-window` returns the top-K open tasks for the tenant, full stop. So a
> scratch config that keeps the real `jupiUserId` hands the skill under test **the user's real backlog**, and
> a write-path eval then drafts real mail to real counterparties. `user_id` is the row-level boundary the
> schema was built around (the shared-DB path in CLAUDE.md); use it. Caught the hard way on 2026-07-28: a
> correctly `eval:`-prefixed seed produced a window of 38 production tasks and 4 fixtures.
>
> Corollary for **any read verb** — `query-window`, `list-blocked`, `list-actions`, `list-open-refs` — the
> tenant is the only thing separating you from production. Check the window before you run the skill, not
> after.

**Why the asymmetry** — Neon rows are cheap to delete precisely, so evals share the project and clean up by
tenant and tag. Supermemory can't reliably delete an individual memory, so isolation has to happen at the container
level, up front. Jupi decisions are the record other people read, so they don't belong in the real workspace
at all, even briefly, even archived.

## Set these before a live run

**The eval Jupi workspace slug is `test`.** Point runs at it by writing it into the **scratch workspace's**
`config.local.json` — `"jupiWorkspace": "test"` — *not* by exporting a variable. **No skill reads
`JUPI_EVAL_WORKSPACE`**; every one of them resolves the workspace from `config.jupiWorkspace`, so a scratch
config that copies the real value verbatim will post eval decisions **into the real workspace**. A dry-run
hides this, because it posts nothing at all; the first write-mode case is where it bites. `.env.template`
keeps `JUPI_EVAL_WORKSPACE` as the place the slug is *recorded* for humans and scripts — it is not a
mechanism the skills honour.

Sanity-check the slug before a run: pass it as `groupSlug` to `search-decisions-tool`. A real-but-empty
workspace returns `{"items":[]}` while a wrong slug errors `Group <slug> not found`, so an empty result is
confirmation, not a silent miss.

`SUPERMEMORY_API_KEY` (the container purge needs it) stays in **`.proactive-jupi/.env`**, gitignored — copy
from `.env.template` in a fresh worktree. **Note the connector writes on read:** a plain `recall` was observed
persisting a memory of the query itself, so run every case against `user_eval_scratch` even when the skill
under test only reads.

## Rules that hold for every set

- **Dry-run first, and prefer it.** Where a skill has `--dry-run` (act-or-decide), those cases write
  *nothing* — no rows, no decisions, no tool calls — so they're the cheapest signal available. Run them
  before any write case.
- **Never `perform` mode.** Every behavioral eval runs in `draft` (or dry-run). A case that produces a real
  external send is a finding, not a mode to switch.
- **Teardown belongs to the run, not to later.** The purge scripts are idempotent and fast; run one at the
  end of each case rather than accumulating state across a session.
- **A skipped isolation step invalidates the result, so say so.** If you ran without the eval prefix, or
  against the real container tag or workspace, report that with the result instead of quietly counting it.
- **Grade the transcript, not just the artifact.** Most regressions this plugin has actually had were
  behavioral — a hardcoded tool menu, a redundant OAuth push, a rule store recommended that shouldn't be.
  None of those appear in a diff of what was written.
- **Never stage the real connection string into a fixture file.** A case that needs a credential gets it by
  shell copy straight into the scratch `config.local.json`, or from a scratch Neon project — not written to
  something like `from-user/neon-conn.txt` for the run to pick up. Observed in a real run: a scratch
  workspace ended up holding the live database password in plaintext, outside any `.gitignore`. It was
  throwaway, so nothing leaked — but the same improvisation one directory over is a committed secret, and
  the skill under test is the one that preaches this hygiene.

## Fresh-worktree prerequisites (this bites every time)

A new git worktree does **not** carry the things a live run needs, because they're gitignored:

- **`.proactive-jupi/config.local.json`** — copy it in from the main checkout, or export `NEON_CONN_STRING`
  + `JUPI_USER_ID`. Without it `db.mjs` can't resolve credentials.
- **`plugins/proactive-jupi/shared/node_modules`** — `npm install --prefix plugins/proactive-jupi/shared`.

Neither is an authorization failure. Check both before concluding a service is unreachable — and note that
`search-decisions-tool` returns a *validation* error when called without `groupId`/`groupSlug`, which also
isn't an auth failure.

## The sets

| Skill | Trigger eval | Behavioral | Notes |
|---|---|---|---|
| [`refresh-backlog`](refresh-backlog/) | ✅ | ✅ 7 cases | Read-only on tools; writes Neon rows |
| [`update-brain`](update-brain/) | ✅ | ✅ | Owns the Supermemory scratch-tag convention + purge script |
| [`act-or-decide`](act-or-decide/) | ✅ | ✅ 10 cases | Most cases are `--dry-run` (write nothing) |
| [`act-post-decision`](act-post-decision/) | ✅ | ✅ | Needs FINALIZED fixture decisions in the test workspace |
| [`execute-action`](execute-action/) | ✅ | ⛔ none yet | The only tool-writer — behavioral coverage is a known gap |
| [`setup-proactive-jupi`](setup-proactive-jupi/) | ⛔ n/a | ✅ 10 cases | `disable-model-invocation`, so nothing to trigger-tune; runs in a scratch workspace |
