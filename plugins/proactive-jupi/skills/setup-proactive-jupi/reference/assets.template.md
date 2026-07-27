# Asset Map

The system's own capability inventory. **Read in full** by act-or-decide; **hand-editable**. Written/updated by the `setup` skill (steps 2–3). Not in Supermemory.

## Tools — connected MCPs + role + action surface
**Setup regenerates this table from what it actually probes** (step 2b — no hardcoded menu): one row per tool the user names and that resolves in the session, `Connected` ticked after a successful probe. The rows below are **illustrative examples**, not a fixed list — drop any the user doesn't use, add whatever they do.

The **Role** column records *why the tool matters to the user*, from step 2b's three questions — and a connector can hold **more than one**:
- **inbox** — where things that need the user land, and what they check to know what to work on (step 2b·a). These are the signals `refresh-backlog` and `update-brain` crawl — the **inbox** set is what `config.seedTools` should list, so the two can't drift.
- **work** — where the user actually gets things done (step 2b·b). These are the surfaces `execute-action` writes to (draft, send, comment, book, create doc).
- **both** — most tools are both: Gmail is where mail arrives *and* where replies are drafted; Linear is a "my list" *and* where issues get worked. Tag every role a tool genuinely plays; don't force it into one.

System stores (Jupi/Supermemory/Neon) are neither — they're Proactive-Jupi's own plumbing, marked `—`.

| Tool | Connected | Role | Action surface (what Proactive-Jupi may do) |
|---|---|---|---|
| Gmail | ☐ | inbox + work | read; draft · send (external) |
| Google Calendar | ☐ | inbox + work | read; create/update events |
| Google Drive | ☐ | work | read; comment; create docs |
| Linear | ☐ | inbox + work | read; comment/create/update issues (internal) |
| GitHub | ☐ | inbox + work | read; comment; open PRs (internal) |
| Slack | ☐ | inbox + work | read; reply in thread (internal) · DM |
| Jupi | ☐ | — (system) | search / create / finalize decisions |
| Supermemory | ☐ | — (system) | add / search Facts (via MCP) |
| Neon | ☐ | — (system) | backlog / actions tables (via project-scoped conn string) |

## Routines — cadence + why
Populated by setup step 8. Each routine is anchored to a **real ritual the crawl discovered**, so the user sees *why* it fires when it does. Each entry: **routine** · **schedule** · **anchor event** (the ritual it's timed to).

| Routine | Schedule | Anchored to |
|---|---|---|
| _e.g. act-or-decide_ | _~45 min before daily standup_ | _standup 11:40_ |
| _e.g. update-brain_ | _daily, before the workday_ | _— (pre-day)_ |

_Empty until setup runs._

## Agents / skills — discovered, for reuse
*(Reuse only, no lifecycle registry.)* Populated by setup step 3.

_None discovered yet._

## Business rules — index
**Store:** `<businessRuleStore.location>` — the durable, updatable rule text lives here (set at setup; default `.proactive-jupi/business-rules.md`). This section is the **index** read in full by the context searches (shallow tags a candidate `rule_ref`; the deep dig opens the store entry to confirm and pre-empt the open question → confidence high → act).

Rules accrete reactively via task → recurring decision → rule: `act-or-decide` posts a `[BR]` rule-decision, the owner approves it in Jupi, `act-post-decision` runs its business-rule-update action (writes the store) and appends the entry here. Each entry: **rule id (Jupi decision)** · *when-X-always-Y* · owner · task types it unblocks · store ref (anchor / block id).

_Empty. No business rules yet._
