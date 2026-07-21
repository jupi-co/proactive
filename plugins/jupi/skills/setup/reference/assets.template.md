# Asset Map

The system's own capability inventory. **Read in full** by act-or-decide; **hand-editable**. Written/updated by the `setup` skill (steps 2–3). Not in Supermemory.

## Tools — connected MCPs + action surface
`Connected` is ticked by setup after a successful probe. `Risk default` seeds the confidence × risk gate.

| Tool | Connected | Action surface (what Auto-Jupi may do) | Risk default |
|---|---|---|---|
| Gmail | ☐ | read; draft (low) · send (high — external) | draft-only |
| Google Calendar | ☐ | read; create/update events | draft-only |
| Google Drive | ☐ | read; comment; create docs | read-only |
| Linear | ☐ | read; comment/create/update issues (internal) | draft-only |
| GitHub | ☐ | read; comment; open PRs (internal) | read-only |
| Slack | ☐ | read; reply in thread (internal, low) · DM | draft-only |
| Jupi | ☐ | search / create / finalize decisions | enabled |
| Supermemory | ☐ | add / search Facts (via MCP) | enabled |
| Neon | ☐ | backlog / actions tables (via project-scoped conn string) | enabled |

## Agents / skills — discovered, for reuse
*(Reuse only, no lifecycle registry.)* Populated by setup step 3.

_None discovered yet._

## Business rules — index
Rules accrete reactively via task → decision → rule. Each entry: **rule id (Jupi)** · *when-X-always-Y* · owner · task types it unblocks.

_Empty. No business rules yet._
