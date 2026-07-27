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
        │   ├── with_skill/{outputs/, grading.json, timing.json}
        │   └── without_skill/{outputs/, grading.json, timing.json}
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
skill. Capture each subagent's `total_tokens`/`duration_ms` into `timing.json` **as its notification
arrives** — that data isn't persisted anywhere else. Then grade each run into `grading.json`
(`expectations[]` entries with `text`/`passed`/`evidence` — the viewer depends on those exact field names),
`benchmark`, and `view`.

For interactive skills (`setup-proactive-jupi`) the executor also plays the scripted persona; see that set's
README for the protocol that keeps it honest.

Proactive-Jupi's evals touch three live stores, and each has its own isolation mechanism. **A run that
can't be undone in all three isn't isolated — it's a production write with good intentions.**

| Store | Isolation | Teardown |
|---|---|---|
| **Neon** (tasks, actions, cursors) | Same project, but every fixture row carries a **`signal_ref` prefixed `eval:`**, and cursor writes go to **`crawl_state` rows with `is_eval=true`** | **Delete after.** `bash evals/<skill>/purge-scratch.sh` — deletes `eval:%` tasks (their `actions` cascade) and `is_eval` cursors. Run it after every behavioral eval, not at the end of the day |
| **Supermemory** (Facts) | A **dedicated test container tag — `user_eval_scratch`** — never the real `user_<jupiUserId>`. The skills never read this tag, so a stray eval Fact can't leak into a real run | `bash evals/update-brain/purge-scratch.sh` bulk-deletes the container via the HTTP API (the connector's `forget` is unreliable — see that README) |
| **Jupi** (decisions) | A **dedicated test workspace**, addressed by `groupSlug` from **`JUPI_EVAL_WORKSPACE`** — never the real workspace in `config.jupiWorkspace` | Decisions are archived **in the test workspace**, where a leftover is harmless. Nothing needs deleting from the real one because nothing was written there |

**Why the asymmetry** — Neon rows are cheap to delete precisely, so evals share the project and clean up by
tag. Supermemory can't reliably delete an individual memory, so isolation has to happen at the container
level, up front. Jupi decisions are the record other people read, so they don't belong in the real workspace
at all, even briefly, even archived.

## Set these before a live run

Both live in **`.proactive-jupi/.env`** (gitignored; copy from `.env.template` in a fresh worktree):

```
JUPI_EVAL_WORKSPACE=test        # the eval Jupi workspace — never config.jupiWorkspace
SUPERMEMORY_API_KEY=sm_...      # admin key the container purge needs
```

At Jupi today the eval workspace slug is **`test`**. Sanity-check it before a run — pass it as `groupSlug`
to `search-decisions-tool`; a real-but-empty workspace returns `{"items":[]}` while a wrong slug errors with
`Group <slug> not found`, so an empty result is confirmation, not a silent miss.

Eval-only settings stay in the environment — **never in `config.local.json`**, which is the product's config,
gets mirrored into unattended/cloud run CWDs, and must not grow eval keys.

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
