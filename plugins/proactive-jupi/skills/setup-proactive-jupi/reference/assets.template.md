# Asset Map

The system's own capability inventory. **Read in full** by act-or-decide; **hand-editable**. Written/updated by the `setup` skill (steps 2–3). Not in Supermemory.

## Tools — connected MCPs + action surface
**Setup regenerates this table from what it actually probes** (step 2b — no hardcoded menu): one row per tool the user names and that resolves in the session, `Connected` ticked after a successful probe. The rows below are **illustrative examples**, not a fixed list — drop any the user doesn't use, add whatever they do.

| Tool | Connected | Action surface (what Proactive-Jupi may do) |
|---|---|---|
| Gmail | ☐ | read; draft · send (external) |
| Google Calendar | ☐ | read; create/update events |
| Google Drive | ☐ | read; comment; create docs |
| Linear | ☐ | read; comment/create/update issues (internal) |
| GitHub | ☐ | read; comment; open PRs (internal) |
| Slack | ☐ | read; reply in thread (internal) · DM |
| Jupi | ☐ | search / create / finalize decisions |
| Supermemory | ☐ | add / search Facts (via MCP) |
| Neon | ☐ | backlog / actions tables (via project-scoped conn string) |

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
Rules accrete reactively via task → decision → rule. Each entry: **rule id (Jupi)** · *when-X-always-Y* · owner · task types it unblocks.

_Empty. No business rules yet._
