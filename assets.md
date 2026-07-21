# Asset Map

The system's own capability inventory. **Read in full** by act-or-decide; **hand-editable**. Written/updated by the `provision` skill (steps 2–3). Not in Supermemory (see plan §4a).

## Tools — connected MCPs + action surface
`Connected` is set by provisioning after a successful probe. `Risk default` seeds the confidence × risk gate (plan §6).

| Tool | Connected | Action surface (what Auto-Jupi may do) | Risk default |
|---|---|---|---|
| Gmail | ☑ | read; **draft** (low) · send (high — external) | draft-only |
| Google Calendar | ☑ | read; create/update events | draft-only |
| Google Drive | ☑ | read; comment; create docs | read-only |
| Linear | ☑ | read; comment/create/update issues (internal) | draft-only |
| GitHub | ☐ | read; comment; open PRs (internal) | read-only |
| Slack | ☐ | read; **reply in thread** (internal, low) · DM | draft-only |
| Jupi | ☑ | search / create / finalize decisions | enabled |
| Supermemory | ☑ | add / search Facts (via MCP) | enabled |
| Neon | ☐ | backlog / actions tables (via project-scoped conn string, **not** the account-wide MCP) | enabled |

*Probed 2026-07-21: Gmail, Calendar, Linear, Drive, Jupi, Supermemory respond. Linear teams: Jupi / GTM / Tech. Primary calendar `a@jupi.co` (Europe/Paris). Supermemory user `a@jupi.co`, default project. **Neon access = project-scoped connection string via a driver, NOT the Neon MCP** — the MCP's account-wide OAuth would expose Jupi production; the conn string is scoped to project `sparkling-violet-42081696` only. GitHub + Slack not needed for the core-subset seed.*

## Agents / skills — discovered, for reuse
*(A4: reuse only, no lifecycle registry.)* Populated by provisioning step 3.

_None discovered yet._

## Business rules — index
Rules accrete reactively via task → decision → rule (plan §2). Each entry: **rule id (Jupi)** · *when-X-always-Y* · owner · task types it unblocks.

_Empty. No business rules at Jupi today._
